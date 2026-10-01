import Phaser from "phaser";
import { GUN_STATION_TURN_RATE } from "./tuning";
import { PLAYER_WPNS, type Unit } from "../../sim/combat";
import { remoteSpecOf, type EscortNav, type EscortNavState, type RemoteCraft } from "../../sim/remote";
import { isGroundVehicle, specOf } from "../../sim/roster";
import { circumRadiusOf, closestOnFootprint, distToFootprint, footprintInto } from "../../render/footprint";
import { craftAimsWithTurret, craftGunId, craftControlScheme, craftOf, craftSocketBarrelCount, craftSocketFireCd } from "../../sim/crafts";
import { isWater } from "../../worldgen/world";
import type { MissionScene } from "../missionScene";

/** Auto-launch skips the bay until a remote has at least this battery fraction. */
const AUTO_LAUNCH_MIN_BATTERY = 0.25;

/** Autonomous remote behavior: wingman orbit/attack, ground gun + Humvee escort drive, auto-scramble, water rules. */
export class RemoteAi {

  constructor(readonly s: MissionScene) {}

  /**
   * Map AI face angle + throttle (−1..1) onto the same stick/aim Craft.update expects.
   * Orbit/ground: A/D yaw + W/S thrust. Plane/aim: nose follows aim, W/S throttle.
   */
  remoteAiStickAim(
    drone: RemoteCraft,
    faceAng: number,
    throttle: number
  ): {
    stick: { up: boolean; down: boolean; left: boolean; right: boolean };
    aim: { x: number; y: number };
  } {
    const aim = {
      x: drone.x + Math.cos(faceAng) * 220,
      y: drone.y + Math.sin(faceAng) * 220,
    };
    const hull = craftOf(drone.spec.craftLook);
    if (craftControlScheme(hull) === "orbit") {
      const err = Phaser.Math.Angle.Wrap(faceAng - drone.angle);
      return {
        aim,
        stick: {
          left: err < -0.06,
          right: err > 0.06,
          up: throttle > 0.2,
          down: throttle < -0.2,
        },
      };
    }
    return {
      aim,
      stick: {
        up: throttle > 0.2,
        down: throttle < -0.2,
        left: false,
        right: false,
      },
    };
  }

  tickRemoteAi(drone: RemoteCraft, dt: number): void {
    // Ground + turret AI (HOUND) — mouse-park + orbit/shoot; same shadow Craft as piloted.
    if (drone.spec.ground && craftGunId(drone.spec) && !drone.spec.orbitEscort) {
      this.tickGroundGunAi(drone, dt);
      return;
    }
    // Ground fire-support escort (HUMVEE): tight leash-follow the host, orbit-attack
    // a point between host and target when engaged. Own dedicated AI, not the wingman ring.
    if (drone.spec.orbitEscort) {
      this.tickHumveeEscortAi(drone, dt);
      return;
    }
    // Sensor-net air AI (Skiff boom-pass / Raptor strafe) — not Spectre orbit.
    if (drone.spec.sensorNet && !drone.spec.ground) {
      this.tickWingmanAi(drone, dt);
      return;
    }
    const h = this.s.player;
    const spec = drone.spec;
    drone.orbit = (drone.orbit ?? 0) + dt * (spec.ground ? 0.7 : 1.15);
    let tx = h.x;
    let ty = h.y;
    if (spec.ground) {
      let best: Unit | undefined;
      let bestD = 520;
      for (const u of this.s.units) {
        if (u.dead) continue;
        const d = Math.hypot(u.x - drone.x, u.y - drone.y);
        if (d < bestD) {
          bestD = d;
          best = u;
        }
      }
      if (best) {
        tx = best.x;
        ty = best.y;
      } else {
        tx = h.x + Math.cos(drone.orbit) * 40;
        ty = h.y + Math.sin(drone.orbit) * 40;
      }
    } else {
      const ring = 110 + Math.sin(drone.orbit * 0.7) * 35;
      tx = h.x + Math.cos(drone.orbit) * ring;
      ty = h.y + Math.sin(drone.orbit) * ring;
    }
    const want = Math.atan2(ty - drone.y, tx - drone.x);
    const near = Math.hypot(tx - drone.x, ty - drone.y);
    const throttle = near < 40 ? 0.35 : 1;
    const { stick, aim } = this.remoteAiStickAim(drone, want, throttle);
    this.s.remoteCore.driveRemoteCraft(drone, dt, stick, aim, { syncGun: false });
    drone.gunAngle = want;
    if (spec.dockable && drone.life < 8) {
      const d = Math.hypot(drone.x - h.x, drone.y - h.y, drone.z - h.z);
      if (d < 100) drone.dock = true;
    }
  }

  /** Host a wingman orbits — prefer a live sensor-net remote that isn't orbit-preferring (Raptor), else the airship/heli. */
  wingmanOrbitHost(drone: RemoteCraft): { x: number; y: number; z: number; radius: number } {
    if (drone.spec.orbitPreferRemote) {
      const prefer = this.s.remotes.find(
        (r) =>
          r !== drone &&
          !r.detonate &&
          !r.dock &&
          r.spec.sensorNet &&
          !r.spec.orbitPreferRemote
      );
      if (prefer) {
        return {
          x: prefer.x,
          y: prefer.y,
          z: prefer.z,
          radius: prefer.spec.radius,
        };
      }
    }
    const h = this.s.player;
    return { x: h.x, y: h.y, z: h.z, radius: h.spec.radius };
  }

  /** Friendly sensor net: heli + live remotes flagged `sensorNet`. */
  remoteFriendlySensors(): { x: number; y: number }[] {
    const out: { x: number; y: number }[] = [{ x: this.s.player.x, y: this.s.player.y }];
    for (const r of this.s.remotes) {
      if (r.detonate || r.dock || !r.spec.sensorNet) continue;
      out.push({ x: r.x, y: r.y });
    }
    return out;
  }

  /** True when any friendly is within `awareRange` of the unit. */
  unitKnownToFriendlies(u: Unit, awareRange: number): boolean {
    for (const f of this.remoteFriendlySensors()) {
      if (Math.hypot(u.x - f.x, u.y - f.y) <= awareRange) return true;
    }
    return false;
  }

  /**
   * Scramble Skiffs from the bay when any hostile enters the friendly awareness net.
   * Obeys hangar ammo + the Skiff slot fire cooldown (shared with manual launch).
   */
  tickAutoSkiffLaunch(): void {
    const h = this.s.player;
    if (h.phase !== "flight" || !this.s.canFire) return;
    let slot = -1;
    for (let i = 0; i < this.s.loadout.length; i++) {
      const remote = this.s.loadout[i]?.payload?.remote;
      if (remote && remoteSpecOf(remote.kind).autoLaunch) {
        slot = i;
        break;
      }
    }
    if (slot < 0 || this.s.weaponSlotDisabled(slot) || !this.s.hasAmmo(slot)) return;
    const spec = this.s.loadout[slot]!;
    const remoteKind = spec.payload!.remote!.kind;
    const remoteFlags = remoteSpecOf(remoteKind);
    const n = craftSocketBarrelCount(h.spec, slot);
    const cds =
      this.s.stationFireCd[slot] ??
      (this.s.stationFireCd[slot] = Array.from({ length: n }, () => 0));
    if ((cds[0] ?? 0) > 0) return;
    // Launch picks the fullest bay remote — hold the scramble while even that one is low.
    if (remoteFlags.dockable && !remoteFlags.unlimitedLife) {
      const lifeMax = Math.max(0.1, spec.payload!.remote!.duration);
      const best = this.s.remoteBay.bayRoster(slot).reduce((m, b) => Math.max(m, b.life), 0);
      if (best / lifeMax < AUTO_LAUNCH_MIN_BATTERY) return;
    }

    const aware = remoteFlags.awareRange ?? 560;
    let threat = false;
    for (const u of this.s.units) {
      if (u.dead) continue;
      if (this.unitKnownToFriendlies(u, aware)) {
        threat = true;
        break;
      }
    }
    if (!threat) return;

    const cd = craftSocketFireCd(spec.fireCd, h.spec, slot);
    cds[0] = cd;
    if (h.weapon === slot) h.fireCd = Math.max(h.fireCd, cd);
    this.s.firePlayerWeapon(slot, spec, this.s.worldPointer());
  }

  /**
   * Skiff / unpiloted Raptor AI:
   * - Idle wide orbit around Raptor (when one is live) or the airship.
   * - Engage enemies known to friendlies within max attack range (slightly past screen).
   * - Skiff: fixed-gun attack passes (line up → fire → overshoot → turn).
   * - Raptor AI: strafe ring (turret-lean) while unpiloted.
   */
  tickWingmanAi(drone: RemoteCraft, dt: number): void {
    const spec = drone.spec;
    const host = this.wingmanOrbitHost(drone);
    const maxEngage = this.wingmanMaxEngageRange();
    const aware = spec.awareRange ?? 560;
    const strafeR = spec.orbitRange ?? 160;
    const escortR = (spec.escortRange ?? 240) + host.radius;

    let target: Unit | undefined =
      drone.aiTargetId != null ? this.s.unitSim.unitById(drone.aiTargetId) : undefined;
    if (
      !target ||
      target.dead ||
      !this.unitKnownToFriendlies(target, aware) ||
      Math.hypot(target.x - host.x, target.y - host.y) > maxEngage
    ) {
      let best: Unit | undefined;
      let bestD = maxEngage;
      for (const u of this.s.units) {
        if (u.dead) continue;
        if (!this.unitKnownToFriendlies(u, aware)) continue;
        const dHost = Math.hypot(u.x - host.x, u.y - host.y);
        if (dHost > maxEngage) continue;
        const d = Math.hypot(u.x - drone.x, u.y - drone.y);
        if (d < bestD) {
          bestD = d;
          best = u;
        }
      }
      target = best;
      drone.aiTargetId = best?.id;
      if (!target) drone.aiPass = undefined;
    }

    drone.orbit = (drone.orbit ?? 0) + dt * (target ? 1.05 : 0.85);
    if (target && spec.attackPass) {
      this.tickSkiffAttackPass(drone, dt, target);
    } else if (target) {
      const lead = (drone.orbit ?? 0) + drone.id * 0.7;
      const tx = target.x + Math.cos(lead) * strafeR;
      const ty = target.y + Math.sin(lead) * strafeR;
      const pathWant = Math.atan2(ty - drone.y, tx - drone.x);
      const aimWant = Math.atan2(target.y - drone.y, target.x - drone.x);
      // Bank into the strafe ring; nose leans toward the hostile for guns.
      const blend = Phaser.Math.Angle.Wrap(aimWant - pathWant);
      const face = pathWant + Phaser.Math.Clamp(blend, -0.85, 0.85);
      const near = Math.hypot(tx - drone.x, ty - drone.y);
      const throttle = near < 40 ? 0.35 : 1;
      const { stick, aim } = this.remoteAiStickAim(drone, face, throttle);
      this.s.remoteCore.driveRemoteCraft(drone, dt, stick, aim, {
        gunAim: { x: target.x, y: target.y },
      });
      const aimErr = Math.abs(Phaser.Math.Angle.Wrap(drone.angle - aimWant));
      if (aimErr < 0.7 || Math.hypot(target.x - drone.x, target.y - drone.y) < maxEngage * 0.45) {
        this.s.remoteWeapons.fireRemoteGun(drone, dt, { x: target.x, y: target.y });
      } else {
        drone.aimHoldT = 0; // out of cone/range — aim precision resets to max.
      }
    } else {
      const ring = escortR + Math.sin((drone.orbit ?? 0) * 0.55 + drone.id) * 55;
      const tx = host.x + Math.cos(drone.orbit ?? 0) * ring;
      const ty = host.y + Math.sin(drone.orbit ?? 0) * ring;
      const want = Math.atan2(ty - drone.y, tx - drone.x);
      const near = Math.hypot(tx - drone.x, ty - drone.y);
      const catchUp = near > escortR * 0.85;
      const throttle = near < 50 ? 0 : catchUp ? 1 : 0.35;
      const { stick, aim } = this.remoteAiStickAim(drone, want, throttle);
      this.s.remoteCore.driveRemoteCraft(drone, dt, stick, aim, { syncGun: false });
      drone.gunAngle = drone.angle;
    }

    // Soft climb toward host altitude band (Craft seeks hull cruiseAgl; AI biases to host).
    const band = host.z + Phaser.Math.Clamp(spec.cruiseAgl - 30, -20, 40);
    drone.vz += (band - drone.z) * 1.8 * dt;
    drone.vz *= Math.pow(0.25, dt);

    if (spec.dockable && drone.life < 8 && this.s.remoteCore.remoteNearHost(drone)) {
      drone.dock = true;
    }
  }

  /**
   * Skiff fixed-gun boom pass: steer onto the target, fire when lined up,
   * fly through a long overshoot, then break-turn for another run.
   */
  tickSkiffAttackPass(drone: RemoteCraft, dt: number, target: Unit): void {
    const dx = target.x - drone.x;
    const dy = target.y - drone.y;
    const dist = Math.hypot(dx, dy);
    const ca = Math.cos(drone.angle);
    const sa = Math.sin(drone.angle);
    // >0 when the target is still ahead of the nose.
    const ahead = dx * ca + dy * sa;
    const gunId = craftGunId(drone.spec);
    const bulletSpd = gunId ? PLAYER_WPNS[gunId]?.speed ?? 900 : 900;
    // Lead the nose for a collision course; shots still leave along heading.
    const leadT = Phaser.Math.Clamp(dist / Math.max(280, bulletSpd * 0.4), 0.04, 0.45);
    const aimX = target.x + target.vx * leadT;
    const aimY = target.y + target.vy * leadT;
    const aimWant = Math.atan2(aimY - drone.y, aimX - drone.x);
    const aimErr = Math.abs(Phaser.Math.Angle.Wrap(drone.angle - aimWant));
    // World units past the target before the Skiff is allowed to reverse.
    const overshoot = 280;

    if (!drone.aiPass) drone.aiPass = "run";

    if (drone.aiPass === "run") {
      const { stick, aim } = this.remoteAiStickAim(drone, aimWant, 1);
      this.s.remoteCore.driveRemoteCraft(drone, dt, stick, aim, { syncGun: false });
      drone.gunAngle = drone.angle;
      // Fire window: nose on target, not too close to clip through the burst.
      const fireMax = Math.min(420, this.wingmanMaxEngageRange() * 0.55);
      const fireMin = 55;
      if (ahead > 0 && aimErr < 0.22 && dist < fireMax && dist > fireMin) {
        this.s.remoteWeapons.fireRemoteGun(drone, dt, { x: aimX, y: aimY });
      } else {
        drone.aimHoldT = 0; // out of the fire window — aim precision resets to max.
      }
      // Passed abeam — leave `run` and start the outbound overshoot.
      if (ahead < -20 || (dist < 52 && ahead < 0)) {
        drone.aiPass = "break";
      }
    } else if (dist < overshoot) {
      // Egress: keep flying away until comfortably past, don't yank back early.
      const away = Math.atan2(drone.y - target.y, drone.x - target.x);
      const blend = Phaser.Math.Angle.Wrap(away - drone.angle);
      const outbound = drone.angle + Phaser.Math.Clamp(blend, -0.55, 0.55);
      const { stick, aim } = this.remoteAiStickAim(drone, outbound, 1);
      this.s.remoteCore.driveRemoteCraft(drone, dt, stick, aim, { syncGun: false });
      drone.gunAngle = drone.angle;
    } else {
      // Far enough out — reverse and re-commit when the nose is back on target.
      const { stick, aim } = this.remoteAiStickAim(drone, aimWant, 0.95);
      this.s.remoteCore.driveRemoteCraft(drone, dt, stick, aim, { syncGun: false });
      drone.gunAngle = drone.angle;
      if (ahead > Math.max(110, dist * 0.4) && aimErr < 0.5) {
        drone.aiPass = "run";
      }
    }
  }

  /** Attack leash — roughly the longer screen edge + a little past (world units). */
  wingmanMaxEngageRange(): number {
    const v = this.s.cameras.main.worldView;
    return Math.max(v.width, v.height) * 0.52 + 80;
  }

  /**
   * Ground + turret remote autonomous (currently just HOUND): orbit/shoot hostiles
   * near the reticle; if leashed too far from the mouse, drive back while the turret
   * keeps firing.
   */
  tickGroundGunAi(drone: RemoteCraft, dt: number): void {
    const spec = drone.spec;
    const ptr = this.s.worldPointer();
    const engage = spec.engageRange ?? 320;
    const stopR = spec.mouseStopRange ?? 48;
    const leashR = spec.mouseLeashRange ?? 200;
    const strafeR = spec.orbitRange ?? 95;
    const toMouse = Math.hypot(ptr.x - drone.x, ptr.y - drone.y);

    let target = drone.aiTargetId != null ? this.s.unitSim.unitById(drone.aiTargetId) : undefined;
    if (!target || target.dead || Math.hypot(target.x - drone.x, target.y - drone.y) > engage) {
      let best: Unit | undefined;
      let bestD = engage;
      for (const u of this.s.units) {
        if (u.dead) continue;
        const d = Math.hypot(u.x - drone.x, u.y - drone.y);
        if (d < bestD) {
          bestD = d;
          best = u;
        }
      }
      target = best;
      drone.aiTargetId = best?.id;
    }

    const gunAim = target
      ? { x: target.x, y: target.y }
      : { x: ptr.x, y: ptr.y };
    if (target) {
      const aimWant = Math.atan2(target.y - drone.y, target.x - drone.x);
      if (craftAimsWithTurret(spec)) {
        drone.gunAngle = Phaser.Math.Angle.RotateTo(
          drone.gunAngle ?? drone.angle,
          aimWant,
          GUN_STATION_TURN_RATE * dt
        );
      } else {
        drone.gunAngle = aimWant;
      }
      const aimErr = Math.abs(Phaser.Math.Angle.Wrap((drone.gunAngle ?? 0) - aimWant));
      if (aimErr < 0.22 || Math.hypot(target.x - drone.x, target.y - drone.y) < engage * 0.45) {
        this.s.remoteWeapons.fireRemoteGun(drone, dt, { x: target.x, y: target.y });
      } else {
        drone.aimHoldT = 0; // out of cone/range — aim precision resets to max.
      }
    } else {
      const idleWant = Math.atan2(ptr.y - drone.y, ptr.x - drone.x);
      if (craftAimsWithTurret(spec)) {
        drone.gunAngle = Phaser.Math.Angle.RotateTo(
          drone.gunAngle ?? drone.angle,
          idleWant,
          GUN_STATION_TURN_RATE * dt
        );
      } else {
        drone.gunAngle = idleWant;
      }
    }

    let want: number;
    let throttle: number;
    // Orbit a hostile while the reticle is still nearby; past the leash, return to the mouse.
    if (target && toMouse <= leashR) {
      const dist = Math.hypot(target.x - drone.x, target.y - drone.y);
      const away = Math.atan2(drone.y - target.y, drone.x - target.x);
      if (dist < strafeR * 0.75) {
        want = away;
        throttle = 0.65;
      } else if (dist < strafeR * 1.35) {
        want = away + Math.PI / 2;
        throttle = 0.5;
      } else {
        drone.orbit = (drone.orbit ?? 0) + dt * 0.9;
        const lead = (drone.orbit ?? 0) + drone.id * 0.7;
        const tx = target.x + Math.cos(lead) * strafeR;
        const ty = target.y + Math.sin(lead) * strafeR;
        want = Math.atan2(ty - drone.y, tx - drone.x);
        throttle = 0.75;
      }
    } else {
      // Reach a wide ring around the reticle, then idle. Don't nose in once inside.
      const spd = Math.hypot(drone.vx, drone.vy);
      const coast = Math.max(90, (spec.maxSpeed / Math.max(0.1, spec.drag ?? 1)) * 1.8);
      if (toMouse > stopR) {
        const ux = (drone.x - ptr.x) / toMouse;
        const uy = (drone.y - ptr.y) / toMouse;
        const tx = ptr.x + ux * stopR;
        const ty = ptr.y + uy * stopR;
        want = Math.atan2(ty - drone.y, tx - drone.x);
        const remain = toMouse - stopR;
        if (remain < coast) {
          const safeSpeed = (remain / coast) * spec.maxSpeed;
          throttle = spd > safeSpeed + 12 ? -0.6 : 0;
        } else {
          throttle = toMouse < leashR ? 0.55 : 0.75;
        }
      } else {
        want = drone.angle;
        throttle = spd > 12 ? -0.6 : 0;
      }
    }
    if (throttle > 0) want = this.waterSteerWant(drone, want);
    const { stick, aim } = this.remoteAiStickAim(drone, want, throttle);
    this.s.remoteCore.driveRemoteCraft(drone, dt, stick, aim, {
      syncGun: false,
      gunAim,
    });
  }

  /**
   * HUMVEE fire-support escort AI (unpiloted, fully autonomous):
   * - Idle: tight leash-follow on the host — rests inside `followInnerRadius`, only
   *   drives back in once past `followOuterRadius`.
   * - Engaged: circles a point on the host→target line biased toward the target
   *   (`attackBias`), radius a fraction of the host↔target distance (`attackOrbitFrac`),
   *   clamped so the near edge keeps `attackStandoff` from the target and the orbit
   *   point itself never strays past `pursueRadius` from the host.
   */
  tickHumveeEscortAi(drone: RemoteCraft, dt: number): void {
    const spec = drone.spec;
    const host = this.wingmanOrbitHost(drone);
    const maxEngage = this.wingmanMaxEngageRange();
    const aware = spec.awareRange ?? 480;

    let target: Unit | undefined =
      drone.aiTargetId != null ? this.s.unitSim.unitById(drone.aiTargetId) : undefined;
    if (
      !target ||
      target.dead ||
      !this.unitKnownToFriendlies(target, aware) ||
      Math.hypot(target.x - host.x, target.y - host.y) > maxEngage
    ) {
      let best: Unit | undefined;
      let bestD = maxEngage;
      for (const u of this.s.units) {
        if (u.dead) continue;
        if (!this.unitKnownToFriendlies(u, aware)) continue;
        const dHost = Math.hypot(u.x - host.x, u.y - host.y);
        if (dHost > maxEngage) continue;
        const d = Math.hypot(u.x - drone.x, u.y - drone.y);
        if (d < bestD) {
          bestD = d;
          best = u;
        }
      }
      target = best;
      drone.aiTargetId = best?.id;
    }

    // Gun picks its own target near the Humvee — aim / fire never depend on the move target,
    // so it keeps shooting while following or chasing. Prefers the move target when in range.
    const inGunRange = (u: Unit | undefined): u is Unit =>
      !!u &&
      !u.dead &&
      this.unitKnownToFriendlies(u, aware) &&
      Math.hypot(u.x - drone.x, u.y - drone.y) <= maxEngage;
    let gunTarget: Unit | undefined = inGunRange(target)
      ? target
      : drone.gunTargetId != null
        ? this.s.unitSim.unitById(drone.gunTargetId)
        : undefined;
    if (!inGunRange(gunTarget)) {
      gunTarget = undefined;
      let bestD = maxEngage;
      for (const u of this.s.units) {
        if (!inGunRange(u)) continue;
        const d = Math.hypot(u.x - drone.x, u.y - drone.y);
        if (d < bestD) {
          bestD = d;
          gunTarget = u;
        }
      }
    }
    drone.gunTargetId = gunTarget?.id;

    const aimWant = gunTarget
      ? Math.atan2(gunTarget.y - drone.y, gunTarget.x - drone.x)
      : drone.angle;
    if (craftAimsWithTurret(spec)) {
      drone.gunAngle = Phaser.Math.Angle.RotateTo(drone.gunAngle ?? drone.angle, aimWant, GUN_STATION_TURN_RATE * dt);
    } else {
      drone.gunAngle = aimWant;
    }
    if (gunTarget) {
      const aimErr = Math.abs(Phaser.Math.Angle.Wrap((drone.gunAngle ?? 0) - aimWant));
      if (aimErr < 0.22 || Math.hypot(gunTarget.x - drone.x, gunTarget.y - drone.y) < maxEngage * 0.45) {
        this.s.remoteWeapons.fireRemoteGun(drone, dt, { x: gunTarget.x, y: gunTarget.y }, gunTarget.id);
      } else {
        drone.aimHoldT = 0; // out of cone/range — aim precision resets to max.
      }
    }

    let want: number;
    let throttle: number;
    let state: EscortNavState = "PARKED";
    let goalX = drone.x;
    let goalY = drone.y;

    if (target) {
      const hostTargetDist = Math.hypot(target.x - host.x, target.y - host.y) || 1;
      const bias = Phaser.Math.Clamp(spec.attackBias ?? 0.75, 0, 1);
      const centerX = host.x + (target.x - host.x) * bias;
      const centerY = host.y + (target.y - host.y) * bias;
      const centerToTargetDist = hostTargetDist * (1 - bias);
      const standoff = spec.attackStandoff ?? 60;
      const desiredR = hostTargetDist * (spec.attackOrbitFrac ?? 0.5);
      const orbitR = Math.min(desiredR, Math.max(20, centerToTargetDist - standoff));
      drone.orbit = (drone.orbit ?? 0) + dt * 0.9;
      const lead = (drone.orbit ?? 0) + drone.id * 0.7;
      let ox = centerX + Math.cos(lead) * orbitR;
      let oy = centerY + Math.sin(lead) * orbitR;
      const pursueR = spec.pursueRadius ?? 500;
      const hostToPoint = Math.hypot(ox - host.x, oy - host.y) || 1;
      if (hostToPoint > pursueR) {
        const s = pursueR / hostToPoint;
        ox = host.x + (ox - host.x) * s;
        oy = host.y + (oy - host.y) * s;
      }
      want = Math.atan2(oy - drone.y, ox - drone.x);
      const near = Math.hypot(ox - drone.x, oy - drone.y);
      throttle = near < 40 ? 0.35 : 1;
      state = "ATTACK";
      goalX = ox;
      goalY = oy;
    } else {
      const dx = host.x - drone.x;
      const dy = host.y - drone.y;
      const d = Math.hypot(dx, dy) || 1;
      const innerR = spec.followInnerRadius ?? 90;
      const outerR = spec.followOuterRadius ?? 220;
      if (d > outerR || (drone.nav?.follow && d > innerR)) {
        const tx = host.x - (dx / d) * innerR;
        const ty = host.y - (dy / d) * innerR;
        want = Math.atan2(ty - drone.y, tx - drone.x);
        throttle = 1;
        state = "FOLLOW";
        goalX = tx;
        goalY = ty;
      } else {
        // Inside the rest radius — park and hold, same as HOUND's idle stillness.
        const spd = Math.hypot(drone.vx, drone.vy);
        want = drone.angle;
        throttle = spd > 12 ? -0.6 : 0;
      }
    }

    this.driveGroundEscort(drone, dt, want, throttle, state, goalX, goalY, target ? { x: target.x, y: target.y } : undefined);

    if (spec.dockable && drone.life < 8 && this.s.remoteCore.remoteNearHost(drone)) {
      drone.dock = true;
    }
  }

  /** Deepest solid ground obstacle overlapping a circle (vehicles, buildings, ground remotes, landed player). */
  groundObstacleAt(
    self: RemoteCraft,
    x: number,
    y: number,
    r: number,
    pad = 0
  ): { depth: number; nx: number; ny: number; px: number; py: number } | null {
    let best: { depth: number; nx: number; ny: number; px: number; py: number } | null = null;
    const consider = (depth: number, nx: number, ny: number, px: number, py: number) => {
      if (depth > 0 && (!best || depth > best.depth)) best = { depth, nx, ny, px, py };
    };
    const circle = (cx: number, cy: number, cr: number) => {
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.hypot(dx, dy);
      const nx = d > 1e-6 ? dx / d : 1;
      const ny = d > 1e-6 ? dy / d : 0;
      consider(r + pad + cr - d, nx, ny, cx + nx * cr, cy + ny * cr);
    };
    for (const o of this.s.units) {
      if (o.dead || o.pinId != null) continue;
      const osp = specOf(o.kind);
      if (osp.aerial || osp.water || osp.behavior === "patrol_boat") continue;
      if (!(osp.building || osp.behavior === "static_hold" || isGroundVehicle(o.kind))) continue;
      const dx = x - o.x;
      const dy = y - o.y;
      const maxR = circumRadiusOf(o.kind) + r + pad + 2;
      if (dx * dx + dy * dy > maxR * maxR) continue;
      const fp = footprintInto(o, 0, 1);
      const d = distToFootprint(x, y, fp);
      if (d >= r + pad) continue;
      const cp = closestOnFootprint(x, y, fp);
      const cdx = x - cp.x;
      const cdy = y - cp.y;
      const cd = Math.hypot(cdx, cdy);
      if (cd > 1e-6) consider(r + pad - d, cdx / cd, cdy / cd, cp.x, cp.y);
      else {
        const dd = Math.hypot(dx, dy) || 1;
        consider(r + pad, dx / dd, dy / dd, o.x, o.y);
      }
    }
    for (const q of this.s.remotes) {
      if (q === self || !q.spec.ground || q.detonate || q.dock || q.airborne) continue;
      circle(q.x, q.y, q.spec.radius);
    }
    if (this.s.player.phase !== "flight") circle(this.s.player.x, this.s.player.y, this.s.player.spec.radius);
    return best;
  }

  /** Push a ground remote out of solids and cancel velocity into them; returns total penetration. */
  resolveGroundRemote(drone: RemoteCraft): number {
    const r = drone.spec.radius;
    const x0 = drone.x;
    const y0 = drone.y;
    let total = 0;
    for (let i = 0; i < 3; i++) {
      const hit = this.groundObstacleAt(drone, drone.x, drone.y, r);
      if (!hit) break;
      drone.x += hit.nx * hit.depth;
      drone.y += hit.ny * hit.depth;
      const vn = drone.vx * hit.nx + drone.vy * hit.ny;
      if (vn < 0) {
        drone.vx -= hit.nx * vn;
        drone.vy -= hit.ny * vn;
      }
      total += hit.depth;
    }
    this.gateGroundRemoteWater(drone, x0, y0);
    return total;
  }

  /** Car-style ground drive: goal heading + avoidance probe + stuck→reverse recovery; writes nav debug state. */
  driveGroundEscort(
    drone: RemoteCraft,
    dt: number,
    want: number,
    throttle: number,
    state: EscortNavState,
    goalX: number,
    goalY: number,
    gunAim?: { x: number; y: number }
  ): void {
    const nav: EscortNav = (drone.nav ??= {
      state,
      follow: false,
      goalX,
      goalY,
      rawWant: want,
      steerWant: want,
      probeX: drone.x,
      probeY: drone.y,
      probeHit: false,
      throttle: 0,
      steer: 0,
      avoidT: 0,
      avoidOs: 0,
      stuckT: 0,
      sampleT: 0,
      lastX: drone.x,
      lastY: drone.y,
      reverseT: 0,
      reverseSteer: 0,
    });
    const r = drone.spec.radius;
    const ca = Math.cos(drone.angle);
    const sa = Math.sin(drone.angle);
    const spd = Math.hypot(drone.vx, drone.vy);
    const moving = throttle > 0.2;
    nav.follow = state === "FOLLOW";
    nav.goalX = goalX;
    nav.goalY = goalY;
    nav.rawWant = want;
    nav.probeHit = false;
    nav.probeX = drone.x + ca * (r + 22);
    nav.probeY = drone.y + sa * (r + 22);

    nav.sampleT += dt;
    if (nav.sampleT >= 0.25) {
      const moved = Math.hypot(drone.x - nav.lastX, drone.y - nav.lastY);
      if (moving && nav.reverseT <= 0 && moved < 5) nav.stuckT += nav.sampleT;
      else nav.stuckT = Math.max(0, nav.stuckT - nav.sampleT);
      nav.lastX = drone.x;
      nav.lastY = drone.y;
      nav.sampleT = 0;
    }
    if (nav.reverseT <= 0 && nav.stuckT >= 0.6) {
      nav.stuckT = 0;
      nav.reverseT = 0.9;
      const ahead = this.groundObstacleAt(drone, drone.x + ca * (r + 6), drone.y + sa * (r + 6), r, 8);
      if (ahead) {
        const side = -(ahead.px - drone.x) * sa + (ahead.py - drone.y) * ca;
        nav.reverseSteer = side >= 0 ? 1 : -1;
      } else {
        nav.reverseSteer = Phaser.Math.Angle.Wrap(want - drone.angle) >= 0 ? -1 : 1;
      }
    }

    let stick: { up: boolean; down: boolean; left: boolean; right: boolean };
    let aim: { x: number; y: number };
    if (nav.reverseT > 0) {
      nav.reverseT -= dt;
      nav.state = "REVERSE";
      nav.steerWant = drone.angle;
      nav.throttle = -1;
      ({ stick, aim } = this.remoteAiStickAim(drone, drone.angle, -1));
      stick.left = nav.reverseSteer < 0;
      stick.right = nav.reverseSteer > 0;
      if (nav.reverseT <= 0) {
        nav.avoidT = 0.5;
        nav.avoidOs = nav.reverseSteer;
      }
    } else {
      let steerWant = moving ? this.waterSteerWant(drone, want) : want;
      let thr = throttle;
      nav.state = state;
      if (moving || spd > 20) {
        const look = r + 22 + spd * 0.55;
        nav.probeX = drone.x + ca * look;
        nav.probeY = drone.y + sa * look;
        for (const f of [0.4, 0.75, 1]) {
          const hit = this.groundObstacleAt(drone, drone.x + ca * look * f, drone.y + sa * look * f, r, 4);
          if (!hit) continue;
          const side = -(hit.px - drone.x) * sa + (hit.py - drone.y) * ca;
          const goalSide = Math.sign(Phaser.Math.Angle.Wrap(want - drone.angle)) || 1;
          nav.avoidOs = Math.abs(side) < r * 0.3 ? -goalSide : Math.sign(side);
          nav.avoidT = 0.35;
          nav.probeHit = true;
          nav.probeX = drone.x + ca * look * f;
          nav.probeY = drone.y + sa * look * f;
          break;
        }
      }
      if (nav.probeHit || nav.avoidT > 0) {
        steerWant = drone.angle - nav.avoidOs * (nav.probeHit ? 1.0 : 0.5);
        nav.state = "AVOID";
        nav.avoidT = Math.max(0, nav.avoidT - dt);
      }
      if (moving) {
        // Keep rolling so the wheels can turn; coast (never stop) when the heading error is large.
        const err = Math.abs(Phaser.Math.Angle.Wrap(steerWant - drone.angle));
        thr = (err > 1.0 || nav.probeHit) && spd > 60 ? 0 : 1;
      } else if (thr >= -0.2 && spd < 12) {
        drone.vx *= Math.pow(0.02, dt);
        drone.vy *= Math.pow(0.02, dt);
      }
      nav.steerWant = steerWant;
      nav.throttle = thr;
      ({ stick, aim } = this.remoteAiStickAim(drone, steerWant, thr));
    }
    nav.steer = stick.right ? 1 : stick.left ? -1 : 0;

    this.s.remoteCore.driveRemoteCraft(drone, dt, stick, aim, { syncGun: false, gunAim });
    const pen = this.resolveGroundRemote(drone);
    if (pen > 0.5 && moving) nav.stuckT += dt;
  }

  /** Bend an autonomous ground remote's heading away from water ahead (shared enemy look-ahead). */
  waterSteerWant(drone: RemoteCraft, want: number): number {
    const tx = drone.x + Math.cos(want) * 120;
    const ty = drone.y + Math.sin(want) * 120;
    const p = this.s.unitSim.terrainSteer(drone.x, drone.y, tx, ty, false, drone.angle);
    return Math.atan2(p.y - drone.y, p.x - drone.x);
  }

  /** Wet samples over the hull footprint (center + ring), heading-independent. */
  groundRemoteWetness(drone: RemoteCraft, x: number, y: number): number {
    const r = drone.spec.radius * 0.75;
    let n = isWater(this.s.world, x, y) ? 1 : 0;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      if (isWater(this.s.world, x + Math.cos(a) * r, y + Math.sin(a) * r)) n++;
    }
    return n;
  }

  /** True when a ground move leaves more of the hull over water (only drying moves allowed once wet). */
  groundRemoteEntersWater(drone: RemoteCraft, x0: number, y0: number, x1: number, y1: number): boolean {
    if (Math.abs(x1 - x0) < 1e-4 && Math.abs(y1 - y0) < 1e-4) return false;
    const wet1 = this.groundRemoteWetness(drone, x1, y1);
    if (wet1 === 0) return false;
    return wet1 >= this.groundRemoteWetness(drone, x0, y0);
  }

  /** Revert a ground remote's move that would put it (further) over water. */
  gateGroundRemoteWater(drone: RemoteCraft, x0: number, y0: number): void {
    if (!drone.spec.ground || drone.airborne) return;
    if (!this.groundRemoteEntersWater(drone, x0, y0, drone.x, drone.y)) return;
    drone.x = x0;
    drone.y = y0;
    drone.vx = 0;
    drone.vy = 0;
  }
}
