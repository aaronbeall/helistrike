import { heightOf, COUNTERMEASURES, craftCountermeasure, nextId, shotBehaviorOf, exhaustIsEnergy, exhaustRibbons, PLAYER_WPNS, wpnIdOf, type Shot, type Unit, type PlayerWpnSpec, type WeaponPayload, type EnergyTrailNode } from "../../sim/combat";
import { ZOff } from "../../render/depth";
import { craftBombDrop, craftOf, socketHullPlacement, craftAimsWithTurret, craftGunId, craftGunScale, craftControlScheme, socketPointsOnKey } from "../../sim/crafts";
import Phaser from "phaser";
import { AI_AIM_NARROW_BASE, AI_AIM_WIDE_MUL } from "./tuning";
import { projectileFxScale, playerMuzzleFxMul, scaledProjectileFxCount } from "../../render/fxScale";
import { launchGravity, targetingMode, specIsShellGun, specIsRocketPod, hardpointAmmoIndex, collapseSightTips, advanceAimHold, aimPrecisionSpread } from "../../sim/weaponRuntime";
import { payloadIsCallStrike, payloadIsHostFire } from "../../sim/payload";
import { type RemoteCraft } from "../../sim/remote";
import { range } from "../../util/rng";
import { lookupSpriteMuzzles, lookupSpritePoints } from "../../art/spriteOrigin";
import { spriteUvPos } from "../../art/sprites";
import { groundZ, worldToScreen, screenToWorldAtZ } from "../../worldgen/world";
import type { MissionScene } from "../missionScene";

/** Remote weapon fire: AI/pilot guns, POV loadout weapons, drops + kick motors, muzzle tips and FX. */
export class RemoteWeapons {

  constructor(readonly s: MissionScene) {}

  /** Onboard remote gun — hold-fire in POV, or AI auto-fire toward aim. */
  fireRemoteGun(
    drone: RemoteCraft,
    dt: number,
    aimAt?: { x: number; y: number },
    targetId = drone.aiTargetId
  ): void {
    const gunId = craftGunId(drone.spec);
    if (!gunId) return;
    const spec = PLAYER_WPNS[gunId];
    if (!spec) return;
    // AI (not player-piloted POV): aim jitter narrows the longer it's held on the same target.
    const isAi = aimAt != null;
    if (isAi) {
      const sameTarget = drone.aimHoldTargetId === targetId;
      drone.aimHoldTargetId = targetId;
      drone.aimHoldT = advanceAimHold(drone.aimHoldT ?? 0, dt, sameTarget);
    }
    drone.gunCd = (drone.gunCd ?? 0) - dt;
    if (drone.gunCd > 0) return;
    drone.gunCd = spec.fireCd;

    const aim = aimAt ?? this.s.worldPointer();
    const baseJitter = spec.fire?.jitter ?? 0.08;
    const jitterAmp = isAi
      ? aimPrecisionSpread(drone.aimHoldT ?? 0, AI_AIM_NARROW_BASE, baseJitter * AI_AIM_WIDE_MUL, baseJitter)
      : baseJitter;
    const sockets = drone.spec.sockets;
    let slot = sockets?.findIndex((s) => s.weapon === gunId && s.class === "fixed") ?? -1;
    if (slot < 0) slot = sockets?.findIndex((s) => s.weapon === gunId) ?? -1;
    const socket = slot >= 0 ? sockets![slot] : undefined;
    const hull = drone.spec.craftLook ? craftOf(drone.spec.craftLook) : undefined;
    // Plane remotes shoot along the nose (Skiff has no sockets — still fixed-forward).
    const planeFixed =
      !!hull &&
      craftControlScheme(hull) === "plane" &&
      socket?.class !== "turret";
    const wantAng = planeFixed
      ? drone.angle
      : Math.atan2(aim.y - drone.y, aim.x - drone.x);
    // Turrets keep slewed gunAngle (pilot/AI); do not snap to want on fire.
    const turret =
      socket?.class === "turret" || (!!hull && craftAimsWithTurret(hull) && socket?.class !== "fixed");
    if (planeFixed) drone.gunAngle = drone.angle;
    else if (!turret) drone.gunAngle = wantAng;
    const baseAng = planeFixed ? drone.angle : (drone.gunAngle ?? wantAng);

    const tips =
      slot >= 0
        ? this.remoteFireTips(drone, slot)
        : (() => {
            const bodyMuzzles = lookupSpritePoints(drone.spec.body, "muzzle");
            if (bodyMuzzles.length > 1) {
              const leaveZ = this.remoteMuzzleZ(drone);
              return bodyMuzzles.map((uv) => {
                const p = this.s.remoteVisuals.remoteBodyMountWorldPos(drone, uv);
                return { x: p.x, y: p.y, z: leaveZ };
              });
            }
            return [this.remoteGunMuzzle(drone)];
          })();
    const fxInterval = spec.fireCd / Math.max(1, tips.length);

    for (const muzzle of tips) {
      const mx = muzzle.x;
      const my = muzzle.y;
      const mz = muzzle.z;
      const aimAng = baseAng + (Math.random() - 0.5) * jitterAmp;
      const spd = spec.speed;
      const clip = this.s.playerSightAimWorld(mx, my, mz, aimAng, undefined, aim);
      const dx = clip.x - mx;
      const dy = clip.y - my;
      const dz = clip.z - mz;
      const dist3 = Math.max(8, Math.hypot(dx, dy, dz));
      const hFrac = Math.hypot(dx, dy) / dist3;
      const beh = shotBehaviorOf(spec);
      const aimVel = this.s.muzzleAimVelocity({
        dx,
        dy,
        dz,
        z0: mz,
        tz: clip.z,
        spd,
        vx: Math.cos(aimAng) * spd * hFrac,
        vy: Math.sin(aimAng) * spd * hFrac,
      });
      this.s.spawnShot({
        from: "player",
        id: nextId(),
        wpnId: gunId,
        beh,
        st: { age: 0, launchAngle: aimAng },
        x: mx,
        y: my,
        z: mz,
        vx: Math.cos(aimAng) * spd * hFrac,
        vy: Math.sin(aimAng) * spd * hFrac,
        vz: aimVel.vz,
        angle: aimAng,
        // Match heli guns: flight time from aim distance, not the catalog tracer life
        // (minigun life ~0.08s is a short-range heli cue — it truncates AGV shots early).
        life: aimVel.life,
        blast: beh.blast,
        dmg: beh.dmg,
        look: spec.art.look,
        scale: spec.art.scale * 0.85,
        fxInterval,
        energyTrail: exhaustIsEnergy(spec.exhaust) ? [] : undefined,
      });
      this.emitRemoteMuzzleFx(drone, spec, mx, my, mz, aimAng, fxInterval);
    }
  }

  /** Remote gun muzzle FX (sparks, flash, light, casing) — shared by AI and POV fire. */
  emitRemoteMuzzleFx(
    drone: RemoteCraft,
    spec: PlayerWpnSpec,
    mx: number,
    my: number,
    mz: number,
    aimAng: number,
    fxInterval: number
  ): void {
    const muzzleMul = playerMuzzleFxMul(spec);
    const gunSc = craftGunScale(drone.spec);
    const fxScale = projectileFxScale("player", fxInterval) * 0.7;
    this.s.emitVisualBurst(mx, my, mz, {
      n: scaledProjectileFxCount(12, fxScale),
      spdMin: 35,
      spdMax: 420,
      bx: Math.cos(aimAng),
      by: Math.sin(aimAng),
      bz: 0.2,
      tight: 0.84,
      scaleMul: 0.3,
      stretchMul: 2.8,
      coneHalf: (260 * Math.PI) / 360,
    }, this.s.muzzleBurst);
    const flashMul = 0.95 * muzzleMul * range(0.9, 1.12);
    this.s.showMuzzle({
      life: 0.12,
      ang: aimAng,
      scaleMul: flashMul,
      // Keep bloom tiny — flash sprite can be large without a huge soft circle.
      glowMul: 7 * gunSc,
      worldX: mx,
      worldY: my,
      worldZ: mz,
    });
    const at = worldToScreen(mx, my, mz);
    this.s.spawnMuzzleLight(at.x, at.y, mz, 18 * at.scale);
    this.s.emitVisualBurst(mx, my, mz, {
      n: 4,
      spdMin: 8,
      spdMax: 90,
      bx: Math.cos(aimAng),
      by: Math.sin(aimAng),
      bz: 0,
      tight: 0.85,
      scaleMul: 0.28,
      stretchMul: 1.4,
      coneHalf: (220 * Math.PI) / 360,
      depthOff: ZOff.shot,
    }, this.s.muzzleBurst);
    if (specIsShellGun(spec)) {
      const gunIm = this.s.remoteVisuals.remoteGunImage(drone);
      const gunTips = gunIm ? lookupSpriteMuzzles(gunIm.texture.key) : [];
      const side = this.s.shellEjectSide({ muzzleUv: gunTips[0] });
      const ejectAt = gunIm
        ? screenToWorldAtZ(gunIm.x, gunIm.y, mz)
        : { x: mx, y: my };
      this.s.spawnShellEject({
        x: ejectAt.x,
        y: ejectAt.y,
        z: drone.spec.ground ? drone.z + drone.spec.height * 0.7 : mz - 4,
        barrelAng: aimAng,
        designation: spec.designation,
        scale: spec.art.scale,
        dmg: spec.dmg,
        side,
        aerial: !drone.spec.ground,
        fireCd: fxInterval,
      });
    }
  }

  /**
   * POV remote loadout fire — same control modes / catalog weapons as the bird HUD.
   */
  handlePovRemoteFire(
    drone: RemoteCraft,
    dt: number,
    ptr: { x: number; y: number },
    down: boolean,
    pressed: boolean,
    released: boolean
  ): void {
    const loadout = drone.loadout;
    const ammo = drone.ammo;
    if (!loadout?.length || !ammo) return;
    const slot = Phaser.Math.Clamp(drone.weapon ?? 0, 0, loadout.length - 1);
    drone.weapon = slot;
    const spec = loadout[slot]!;
    drone.fireCd = Math.max(0, (drone.fireCd ?? 0) - dt);

    let wantFire = false;
    if (spec.control.mode === "hold_mouse_down") wantFire = down;
    else if (spec.control.mode === "click" || spec.control.mode === "click_then_click_to_commit") {
      wantFire = pressed;
    } else if (spec.control.mode === "lock_then_click") {
      wantFire = (pressed || down) && !!this.s.player.lockTarget;
    } else if (spec.control.mode === "click_to_set_target") {
      if (pressed) this.s.designateLatch = { x: ptr.x, y: ptr.y };
      if (down && this.s.designateLatch) this.s.designateLatch = { x: ptr.x, y: ptr.y };
      wantFire = released && !!this.s.designateLatch;
      if (wantFire) this.s.designateLatch = null;
    }

    if (!wantFire || (drone.fireCd ?? 0) > 0) return;

    const hostWpn = this.s.remoteCore.remoteHostAmmoWeapon(spec);
    if (hostWpn) {
      // Barrage owns the howitzer — no spot fire or new strike until it finishes.
      if (this.s.hostWeaponStrikeActive(hostWpn)) return;
      const hostLeft = this.s.hostWeaponAmmoLeft(hostWpn);
      if (hostLeft == null) return;
      if (!this.s.debugMenu.infAmmo && Number.isFinite(hostLeft) && hostLeft <= 0) return;

      // Spot howitzer: real station fire + shared CD (not the flare / call-strike path).
      if (payloadIsHostFire(spec.payload)) {
        if (!this.s.hostStationFireReady(hostWpn)) return;
        const ok = this.s.fireHostWeaponAt(hostWpn, ptr);
        if (ok) {
          const hostSpec = PLAYER_WPNS[hostWpn];
          drone.fireCd = hostSpec?.fireCd ?? spec.fireCd;
        }
        return;
      }
      // Call-strike: spend remote flare ammo below; howitzer bank must still have shells.
    }

    if (!this.s.debugMenu.infAmmo && Number.isFinite(ammo[slot]!) && ammo[slot]! <= 0) return;

    drone.fireCd = spec.fireCd;
    if (!this.s.debugMenu.infAmmo && Number.isFinite(ammo[slot]!)) ammo[slot]!--;
    this.fireRemoteLoadoutWeapon(drone, slot, spec, ptr);
  }

  /** Spawn one remote-loadout round from the remote (or host, for call-strike / hostFire). */
  fireRemoteLoadoutWeapon(
    drone: RemoteCraft,
    slot: number,
    spec: PlayerWpnSpec,
    ptr: { x: number; y: number }
  ): void {
    const socket = drone.spec.sockets?.[slot];
    const hull = drone.spec.craftLook ? craftOf(drone.spec.craftLook) : undefined;
    const planeFixed =
      !!hull &&
      craftControlScheme(hull) === "plane" &&
      socket?.class === "fixed";
    const wantAng = planeFixed
      ? drone.angle
      : Math.atan2(ptr.y - drone.y, ptr.x - drone.x);
    // Turret stations fire along the slewed barrel; hardpoints / observers may face aim.
    if (planeFixed) {
      drone.gunAngle = drone.angle;
    } else if (socket?.class === "turret" && hull && craftAimsWithTurret(hull)) {
      // Keep current slewed angle from tickRemoteCraftPilot / AI.
    } else {
      drone.gunAngle = wantAng;
    }
    const aimAng =
      socket?.class === "turret" && hull && craftAimsWithTurret(hull)
        ? (drone.gunAngle ?? wantAng)
        : wantAng;

    if (payloadIsHostFire(spec.payload)) {
      const ok = this.s.fireHostWeaponAt(spec.payload.hostFire!.weapon, ptr);
      if (!ok) {
        // Mount missing / dry — clear remote CD so the player can retry.
        drone.fireCd = 0;
      }
      return;
    }

    const launch = spec.launch;

    if (launch.mode === "kick_motor") {
      this.fireRemoteKickMotor(drone, slot, spec, aimAng);
      return;
    }

    if (launch.mode === "drop") {
      this.fireRemoteDropShot(drone, slot, spec, ptr);
      return;
    }

    // Hardpoint rails use the same leave as the host craft (loft, catalog life, flash).
    const fireAng =
      socket?.class === "hardpoint" && hull && craftControlScheme(hull) === "plane"
        ? drone.angle
        : aimAng;
    const rocketPod = specIsRocketPod(spec);
    const railMuzzle =
      !rocketPod &&
      socket?.class === "hardpoint" &&
      (launch.mode === "muzzle" || launch.mode === "beam");
    if (rocketPod || railMuzzle) {
      const tips = this.remoteFireTips(drone, slot);
      const beh = shotBehaviorOf(spec);
      const fxInterval = spec.fireCd / Math.max(1, tips.length);
      const guided = spec.guidance;
      const lockOn = targetingMode(guided) === "lock_on";
      const lockId = lockOn ? this.s.player.lockTarget?.id : undefined;
      for (const muzzle of tips) {
        const jitter = spec.fire?.jitter ?? 0;
        const ang = fireAng + (jitter ? (Math.random() - 0.5) * jitter : 0);
        this.s.spawnCraftMuzzleShot({
          spec,
          beh,
          st: {
            age: 0,
            launchAngle: ang,
            callStrikeFromHost: spec.payload.callStrike ? true : undefined,
          },
          slot,
          x: muzzle.x,
          y: muzzle.y,
          z0: muzzle.z,
          ang,
          pitchJit: jitter ? (Math.random() - 0.5) * jitter * 0.45 : 0,
          side: 1,
          craftVx: drone.vx,
          craftVy: drone.vy,
          craftVz: drone.vz,
          lockOn,
          lockId,
          aimAt: ptr,
          fxInterval,
          depthOff:
            socket && socketHullPlacement(socket) === "above" ? ZOff.turret + 0.25 : undefined,
        });
      }
      return;
    }

    // Fixed / turret guns — barrel tips, not a pylon rail.
    const tips = this.remoteFireTips(drone, slot);
    const fxInterval = spec.fireCd / Math.max(1, tips.length);
    const launchInherit =
      spec.launch.mode === "muzzle" && "inheritMomentum" in launch
        ? launch.inheritMomentum
        : 0;
    const planeish = hull?.flightModel === "plane" || hull?.flightModel === "vtol";
    const inherit = planeish ? Math.min(1, launchInherit + 0.28) : launchInherit;
    for (const muzzle of tips) {
      const jitter = (Math.random() - 0.5) * (spec.fire?.jitter ?? 0.04);
      const ang = fireAng + jitter;
      const spd = spec.speed;
      const origin = this.s.playerShotOrigin(muzzle, ang, spec);
      const mx = origin.x;
      const my = origin.y;
      const mz = origin.z;
      const clip = this.s.playerSightAimWorld(mx, my, mz, ang, undefined, ptr);
      const dx = clip.x - mx;
      const dy = clip.y - my;
      const dz = clip.z - mz;
      const dist3 = Math.max(8, Math.hypot(dx, dy, dz));
      const hFrac = Math.hypot(dx, dy) / dist3;
      const beh = shotBehaviorOf(spec);
      const grav = launchGravity(spec.launch);
      const aimVel = this.s.muzzleAimVelocity({
        dx,
        dy,
        dz,
        z0: mz,
        tz: clip.z,
        spd,
        vx: Math.cos(ang) * spd * hFrac,
        vy: Math.sin(ang) * spd * hFrac,
        grav,
      });
      const fromHost = !!spec.payload.callStrike;
      this.s.spawnShot({
        from: "player",
        id: nextId(),
        wpnId: wpnIdOf(spec),
        slot,
        beh,
        st: {
          age: 0,
          launchAngle: ang,
          callStrikeFromHost: fromHost || undefined,
        },
        x: mx,
        y: my,
        z: mz,
        vx: Math.cos(ang) * spd * hFrac + drone.vx * inherit,
        vy: Math.sin(ang) * spd * hFrac + drone.vy * inherit,
        vz: aimVel.vz,
        angle: ang,
        life: payloadIsCallStrike(spec.payload) ? spec.life : aimVel.life,
        blast: beh.blast,
        dmg: beh.dmg,
        look: spec.art.look,
        scale: spec.art.scale * (payloadIsCallStrike(spec.payload) ? 1 : 0.85),
        fxInterval,
        energyTrail: exhaustIsEnergy(spec.exhaust) ? [] : undefined,
        energyTrails:
          exhaustRibbons(spec.exhaust) > 1
            ? Array.from({ length: exhaustRibbons(spec.exhaust) }, () => [] as EnergyTrailNode[])
            : undefined,
      });
      if (spec.fire?.muzzleFlash ?? true) this.emitRemoteMuzzleFx(drone, spec, mx, my, mz, ang, fxInterval);
    }
  }

  /** Gravity bomb from a remote bay. */
  fireRemoteDropShot(
    drone: RemoteCraft,
    slot: number,
    spec: PlayerWpnSpec,
    ptr: { x: number; y: number }
  ): void {
    const launch = spec.launch;
    if (launch.mode !== "drop") return;
    const tip = this.remoteFireTips(drone, slot)[0] ?? {
      x: drone.x,
      y: drone.y,
      z: drone.z,
    };
    const release = this.remoteBombReleaseVelocity(drone, spec, tip.x, tip.y, ptr, slot);
    const dropZ = tip.z;
    const grav = launchGravity(spec.launch);
    const beh = shotBehaviorOf(spec);
    const fallT = this.s.estimateBombFallTime(
      dropZ,
      release.vz,
      groundZ(this.s.world, ptr.x, ptr.y),
      grav?.acceleration ?? 210,
      grav?.terminalVelocity ?? 520
    );
    this.s.spawnShot({
      from: "player",
      id: nextId(),
      wpnId: wpnIdOf(spec),
      slot,
      beh,
      st: {
        age: 0,
        launchAngle: release.angle,
        gx: ptr.x,
        gy: ptr.y,
      },
      x: tip.x,
      y: tip.y,
      z: dropZ,
      vx: release.vx,
      vy: release.vy,
      vz: release.vz,
      angle: release.angle,
      life: Math.max(spec.life, fallT + 1.2),
      blast: beh.blast,
      dmg: beh.dmg,
      look: spec.art.look,
      scale: spec.art.scale,
      fxInterval: spec.fireCd,
    });
  }

  /** Photon / hardpoint kick-motor from a remote hull. */
  fireRemoteKickMotor(
    drone: RemoteCraft,
    slot: number,
    spec: PlayerWpnSpec,
    aimAng: number
  ): void {
    const launch = spec.launch;
    if (launch.mode !== "kick_motor") return;
    const beh = shotBehaviorOf(spec);
    const kick = launch.kickSpeed;
    const inherit = launch.inheritMomentum;
    const g = spec.guidance;
    const lockId =
      targetingMode(g) === "lock_on" || targetingMode(g) === "steer_commit"
        ? this.s.player.lockTarget?.id
        : undefined;
    const side = Math.random() < 0.5 ? -1 : 1;
    const tips = this.remoteFireTips(drone, slot);
    for (const muzzle of tips) {
      this.s.spawnShot({
        from: "player",
        id: nextId(),
        wpnId: wpnIdOf(spec),
        slot,
        beh,
        st: { age: 0, launchAngle: aimAng },
        x: muzzle.x,
        y: muzzle.y,
        z: muzzle.z,
        vx: drone.vx * inherit + Math.cos(aimAng) * kick,
        vy: drone.vy * inherit + Math.sin(aimAng) * kick,
        vz: drone.vz * inherit,
        angle: aimAng,
        life: spec.life,
        targetId: lockId,
        blast: beh.blast,
        dmg: beh.dmg,
        look: spec.art.look,
        scale: spec.art.scale,
        fxInterval: spec.fireCd,
        povCam: spec.cam.povCam || undefined,
        motor: -launch.igniteDelay,
        cruise: spec.speed,
        loft: launch.softLoft,
        yaw:
          side *
          (launch.yawMul ??
            (targetingMode(g) === "lock_on" ? 1.05 + Math.random() * 0.45 : 0.42 + Math.random() * 0.22)),
        tint: spec.art.tint,
        energyTrail: exhaustIsEnergy(spec.exhaust) ? [] : undefined,
        energyTrails:
          exhaustRibbons(spec.exhaust) > 1
            ? Array.from({ length: exhaustRibbons(spec.exhaust) }, () => [] as EnergyTrailNode[])
            : undefined,
      });
      this.s.missileMuzzle(
        muzzle.x,
        muzzle.y,
        muzzle.z,
        aimAng,
        projectileFxScale("player", spec.fireCd)
      );
    }
  }

  /**
   * Socket emit UVs on the remote look sprite (not hull.body — Skiff overrides look).
   * Same resolver as host craftSocketPoints soft path (`socketPointsOnKey`).
   */
  remoteSocketPoints(
    drone: RemoteCraft,
    socket: { class: string; points?: { id: string }[] }
  ): { x: number; y: number; id?: string }[] {
    return socketPointsOnKey(drone.spec.body, socket);
  }

  /**
   * Fire origins for a remote socket — simultaneous / alternate body muzzles,
   * hardpoint ammo-phase (same as host `hardpointPylon`), or turret tips.
   * Leave Z matches host `playerMuzzleZ` (hullPlacement); turret XY plane matches `gunTip` (base Z).
   */
  remoteFireTips(
    drone: RemoteCraft,
    slot: number
  ): { x: number; y: number; z: number }[] {
    const leaveZ = this.remoteMuzzleZ(drone, slot);
    const socket = drone.spec.sockets?.[slot];
    if (socket && (socket.class === "fixed" || socket.class === "hardpoint")) {
      const authored = this.remoteSocketPoints(drone, socket);
      if (authored.length) {
        let uvs = authored;
        if (socket.class === "hardpoint") {
          // Match host: ammo already spent in handlePovRemoteFire.
          uvs = [authored[hardpointAmmoIndex(drone.ammo?.[slot] ?? 0, authored.length, true)]!];
        } else if (socket.muzzleFire === "simultaneous") {
          uvs = authored;
        } else if (socket.muzzleFire === "alternate") {
          uvs = [authored[this.s.playerGunSide++ % authored.length]!];
        } else {
          uvs = [authored[0]!];
        }
        return uvs.map((uv) => {
          const p = this.s.remoteVisuals.remoteBodyMountWorldPos(drone, uv);
          return { x: p.x, y: p.y, z: leaveZ };
        });
      }
    }
    if (socket?.class === "turret") {
      const gunIm = this.s.remoteVisuals.remoteGunImage(drone);
      const bodyIm = this.s.remoteVisuals.remoteBodyImage(drone);
      if (gunIm && bodyIm?.visible) {
        const pose = this.s.remoteVisuals.remoteBodyDrawPose(bodyIm);
        this.s.remoteVisuals.poseRemoteGun(drone, pose, bodyIm.texture.key, gunIm);
        const tips = lookupSpriteMuzzles(gunIm.texture.key);
        // Match host gunTip: unproject at hull base Z, stamp leave Z separately.
        const planeZ = drone.z;
        if (tips.length > 1 && socket.muzzleFire === "simultaneous") {
          return tips.map((tipUv) => {
            const scr = spriteUvPos(gunIm, tipUv.x, tipUv.y);
            const at = screenToWorldAtZ(scr.x, scr.y, planeZ);
            return { x: at.x, y: at.y, z: leaveZ };
          });
        }
        if (tips.length > 1 && socket.muzzleFire === "alternate") {
          const tipUv = tips[this.s.playerGunSide++ % tips.length]!;
          const scr = spriteUvPos(gunIm, tipUv.x, tipUv.y);
          const at = screenToWorldAtZ(scr.x, scr.y, planeZ);
          return [{ x: at.x, y: at.y, z: leaveZ }];
        }
      }
    }
    return [this.remoteGunMuzzle(drone, slot)];
  }

  /**
   * Sight emit tips for a remote socket — same rules as host craft:
   * multi-barrel guns collapse to one beam; hardpoints follow ammo phase.
   */
  remoteSightOrigins(
    drone: RemoteCraft,
    slot: number
  ): { x: number; y: number; z: number }[] {
    const leaveZ = this.remoteMuzzleZ(drone, slot);
    const socket = drone.spec.sockets?.[slot];
    if (socket && (socket.class === "fixed" || socket.class === "hardpoint")) {
      const authored = this.remoteSocketPoints(drone, socket);
      if (authored.length) {
        let uvs = authored;
        if (socket.class === "hardpoint") {
          uvs = [authored[hardpointAmmoIndex(drone.ammo?.[slot] ?? 0, authored.length)]!];
        }
        // fixed (incl. simultaneous duals): all ports, then collapse like cannonSightOrigins
        const tips = uvs.map((uv) => {
          const p = this.s.remoteVisuals.remoteBodyMountWorldPos(drone, uv);
          return { x: p.x, y: p.y, z: leaveZ };
        });
        return collapseSightTips(tips);
      }
    }
    if (socket?.class === "turret") {
      const gunIm = this.s.remoteVisuals.remoteGunImage(drone);
      const bodyIm = this.s.remoteVisuals.remoteBodyImage(drone);
      if (gunIm && bodyIm?.visible) {
        const pose = this.s.remoteVisuals.remoteBodyDrawPose(bodyIm);
        this.s.remoteVisuals.poseRemoteGun(drone, pose, bodyIm.texture.key, gunIm);
        const muzzles = lookupSpriteMuzzles(gunIm.texture.key);
        if (muzzles.length) {
          const planeZ = drone.z;
          const tips = muzzles.map((tipUv) => {
            const scr = spriteUvPos(gunIm, tipUv.x, tipUv.y);
            const at = screenToWorldAtZ(scr.x, scr.y, planeZ);
            return { x: at.x, y: at.y, z: leaveZ };
          });
          return collapseSightTips(tips);
        }
      }
    }
    return [this.remoteGunMuzzle(drone, slot)];
  }

  /** Barrel tip for a remote gun — matches the overlay muzzle UV (not a hull-radius offset). */
  remoteGunMuzzle(drone: RemoteCraft, slot?: number): { x: number; y: number; z: number } {
    const leaveZ = this.remoteMuzzleZ(drone, slot);
    const gunAng = drone.gunAngle ?? drone.angle;
    const gunIm = this.s.remoteVisuals.remoteGunImage(drone);
    const bodyIm = this.s.remoteVisuals.remoteBodyImage(drone);
    if (gunIm && bodyIm?.visible) {
      const pose = this.s.remoteVisuals.remoteBodyDrawPose(bodyIm);
      this.s.remoteVisuals.poseRemoteGun(drone, pose, bodyIm.texture.key, gunIm);
      const tips = lookupSpriteMuzzles(gunIm.texture.key);
      const tipUv = tips[0] ?? { x: 0.5, y: 0.05 };
      // Match host gunTip: unproject at hull base Z.
      const scr = spriteUvPos(gunIm, tipUv.x, tipUv.y);
      const at = screenToWorldAtZ(scr.x, scr.y, drone.z);
      return { x: at.x, y: at.y, z: leaveZ };
    }
    // Body muzzle fallback when there is no gun overlay (Raptor fixed nose guns).
    const bodyMuzzles = lookupSpritePoints(drone.spec.body, "muzzle");
    if (bodyMuzzles.length) {
      const p = this.s.remoteVisuals.remoteBodyMountWorldPos(drone, bodyMuzzles[0]!);
      return { x: p.x, y: p.y, z: leaveZ };
    }
    // Fallback before the first sprite sync: hub + short barrel reach.
    const reach = drone.spec.radius * 0.7;
    return {
      x: drone.x + Math.cos(gunAng) * reach,
      y: drone.y + Math.sin(gunAng) * reach,
      z: leaveZ,
    };
  }

  /** Bomb arc from a POV remote bay (Raptor). */
  drawRemoteBombTrajectory(
    drone: RemoteCraft,
    slot: number,
    spec: PlayerWpnSpec,
    aim: { x: number; y: number }
  ): void {
    const tip = this.remoteSightOrigins(drone, slot)[0] ?? {
      x: drone.x,
      y: drone.y,
      z: drone.z,
    };
    const release = this.remoteBombReleaseVelocity(drone, spec, tip.x, tip.y, aim, slot);
    this.s.reticleHud.drawTrajectoryArc(tip, release, spec, aim, drone.y);
  }

  /** Bomb release from a remote hull — same loft search as player craft. */
  remoteBombReleaseVelocity(
    drone: RemoteCraft,
    spec: PlayerWpnSpec,
    ox: number,
    oy: number,
    aim: { x: number; y: number },
    slot: number
  ): { vx: number; vy: number; vz: number; angle: number } {
    const hull = drone.spec.craftLook ? craftOf(drone.spec.craftLook) : undefined;
    const socket = drone.spec.sockets?.[slot];
    const tune = hull
      ? craftBombDrop(hull, socket)
      : { momentum: 0.4, maxBoost: 70, loft: 90, loftMax: 160 };
    return this.s.bombReleaseFrom(spec, ox, oy, aim, 0, {
      vx: drone.vx,
      vy: drone.vy,
      vz: drone.vz ?? 0,
      z0: drone.z + drone.spec.height * 0.4,
      angle: drone.angle,
      tune,
    });
  }

  /** World Z for remote muzzle leave — same hullPlacement rules as the host craft. */
  remoteMuzzleZ(drone: RemoteCraft, slot?: number, barrel = 0): number {
    const sockets = drone.spec.sockets;
    const sock =
      slot != null
        ? sockets?.[slot]
        : sockets?.find((s) => s.class === "turret") ?? sockets?.[0];
    let z = this.s.craftMuzzleLeaveZ(drone.z, drone.spec.height, socketHullPlacement(sock, barrel));
    // Dirt-locked AGVs skim the heightmap — lift leave so tracers clear micro-relief
    // that a heli chin gun never meets (same aim-at-ground dive, much less clearance).
    if (drone.spec.ground) {
      z += Math.max(6, drone.spec.height * 0.45);
    }
    return z;
  }

  /**
   * Spider drone: steer toward the mouse at low AGL; if a hostile enters
   * engage range, latch and dash onto it until contact / blast.
   */
  tickSpiderDroneShot(
    s: Shot,
    beh: NonNullable<Shot["beh"]>,
    spider: NonNullable<WeaponPayload["spider"]>,
    dt: number,
    ptr: { x: number; y: number }
  ): void {
    const flight = beh.guidance?.flight;
    const loft = flight?.loft;
    const cruiseAgl =
      loft && typeof loft.cruise === "object" && "agl" in loft.cruise ? loft.cruise.agl : 5;

    let tx = ptr.x;
    let ty = ptr.y;
    let dash = false;
    let prey: Unit | undefined;

    if (s.targetId != null) {
      prey = this.s.unitSim.unitById(s.targetId);
      if (!prey || prey.dead) {
        s.targetId = undefined;
        prey = undefined;
      } else {
        tx = prey.x;
        ty = prey.y;
        dash = true;
      }
    }

    if (!dash) {
      let best: Unit | undefined;
      let bestD = spider.engageRange;
      for (const u of this.s.units) {
        if (u.dead) continue;
        const d = Math.hypot(u.x - s.x, u.y - s.y);
        if (d < bestD) {
          bestD = d;
          best = u;
        }
      }
      if (best) {
        s.targetId = best.id;
        prey = best;
        tx = best.x;
        ty = best.y;
        dash = true;
      }
    }

    const want = Math.atan2(ty - s.y, tx - s.x);
    const turnRate = dash ? 16 : (flight?.turnRate ?? 6.2);
    const maxA = dash ? Math.PI : (flight?.maxAngle ?? 1.4);
    const da = Phaser.Math.Angle.Wrap(want - s.angle);
    s.angle += Phaser.Math.Clamp(Phaser.Math.Clamp(da, -maxA, maxA), -turnRate * dt, turnRate * dt);

    const base = beh.cruiseSpeed;
    const target = dash ? base * (spider.dashMul ?? 1.5) : base;
    let spd = Math.hypot(s.vx, s.vy);
    if (dash) {
      // Ramp into the pounce — no instant speed snap.
      const accel = spider.dashAccel ?? 380;
      if (spd < target) spd = Math.min(target, Math.max(base * 0.85, spd) + accel * dt);
      else spd = target;
    } else {
      spd = target;
    }
    s.vx = Math.cos(s.angle) * spd;
    s.vy = Math.sin(s.angle) * spd;

    const gnd = groundZ(this.s.world, s.x, s.y);
    if (dash && prey) {
      const impactZ = prey.z + heightOf(prey.kind) * 0.35;
      s.vz = (impactZ - s.z) * 7;
    } else {
      const rest = gnd + cruiseAgl;
      s.vz += (rest - s.z) * 10 * dt;
      s.vz *= Math.pow(0.12, dt);
    }
    const floor = gnd + (loft?.clear?.coast ?? loft?.clear?.near ?? 2.5);
    if (s.z < floor) {
      s.z = floor;
      if (s.vz < 0) s.vz = 0;
    }
    s.life = Math.max(s.life, 0.35);
  }

  /** Smoke screen on a piloted remote (HOUND). Own cooldown, cloud stays on the vehicle. */
  tryRemoteCountermeasure(r: RemoteCraft): void {
    const id = craftCountermeasure(r.spec.countermeasure);
    if (id !== "smoke_screen" || (r.cmCd ?? 0) > 0 || (r.smokeT ?? 0) > 0) return;
    const spec = COUNTERMEASURES.smoke_screen;
    r.cmCd = spec.cooldown;
    r.smokeT = spec.duration;
    this.s.fireSmokeScreen(3, r);
  }
}
