import Phaser from "phaser";
import { BLAST_RING_FRAMES } from "../../../render/blastRing";
import { shotTrailScale, troopMissileTrail } from "../../../render/fxScale";
import { steerDir, motorizedSpeed, flyMissile } from "../../../sim/ballistics";
import { REACTIVE_ARMOR_RADIUS_MUL } from "./countermeasures";
import { shotIsGunOrBeam, shotFacesHeading } from "../../../render/spritePose";
import { norm3 } from "../../../util/vec";
import { applyThermalHeat } from "../../../render/thermal";
import { projectileFxScale, scaledProjectileFxCount } from "../../../render/fxScale";
import { launchGravity, targetingMode } from "../../../sim/weaponRuntime";
import { payloadIsCluster, payloadIsSmoke, payloadIsCallStrike, payloadIsHe, payloadIsKinetic } from "../../../sim/payload";
import { heightOf, SHOT_ORIGIN, SHOT_TAIL, payloadDustMul, payloadHeBlend, guidanceIsLockOn, exhaustWarpMotes, exhaustIsSignalFlare, stunUnit, unitStunned, type Shot, type ShotState, type Unit, type WpnId } from "../../../sim/combat";
import { heatClassOf } from "../../../sim/weaponRuntime";
import { ZOff, worldDepth } from "../../../render/depth";
import { range } from "../../../util/rng";
import { Craft } from "../../../sim/craft";
import { isAerial, isOrganic, hasSoftBlood, specOf, type ShotKind, type ShotLook } from "../../../sim/roster";
import { circumRadiusOf, distToFootprint, footprintInto, pointInFootprint } from "../../../render/footprint";
import { craftHardpointMounts } from "../../../sim/crafts";
import { groundZ, worldToScreen, cameraPointVisible, screenVelX, screenVelY, projectHeading, castZ, isWater } from "../../../worldgen/world";
import type { MissionScene } from "../../missionScene";

function hitSimParticleFx(dmg: number): { n: number; spd: number; size: number } {
  const t = Phaser.Math.Clamp(Math.pow(Math.max(0.35, dmg) / 8, 0.32), 0.28, 1.5);
  return {
    n: t,
    spd: 0.86 + 0.1 * t,
    size: Phaser.Math.Clamp(0.4 + 0.58 * t, 0.4, 1.26),
  };
}

/** Legacy explode() kind tag for HE vs kinetic FX when payload is absent. */
function shotKindForExplode(s: Shot): ShotKind {
  if (shotIsGunOrBeam(s)) return s.beh?.launch.mode === "beam" ? "beam" : "cannon";
  if (s.homePlayer || s.motor != null) return "lock-on-missile";
  if (s.beh?.exhaust?.kind === "particles" && s.beh.exhaust.smoke === "rocket") return "rocket";
  if (s.povCam || s.wire) return "guided-missile";
  return "rocket";
}

function shotLookOf(s: Shot): ShotLook {
  if (!s.look) throw new Error(`shot ${s.id ?? "?"} missing look`);
  return s.look;
}

/** Bomb / missile / rocket ground scars get embers; guns and beams do not. */
function shotWantsEmberCrater(shot: Shot | undefined, kind: ShotKind): boolean {
  if (shot) {
    if (shotIsGunOrBeam(shot)) return false;
    const mode = shot.beh?.launch.mode;
    if (mode === "beam") return false;
    if (mode === "drop" || mode === "kick_motor") return true;
    if (shot.beh?.guidance || shot.motor != null) return true;
    if (shot.beh?.exhaust) return true;
    const look = shot.look ?? shot.beh?.art.look ?? "";
    if (/bomb|rocket|missile|photon|mini_rocket/i.test(look)) return true;
    if (shot.st?.bomblet && !!shot.beh?.payload?.detonate) return true;
    return false;
  }
  return kind === "rocket" || kind === "lock-on-missile" || kind === "guided-missile";
}

/** Layers per Photon: glow, H×2, cross H, diag×3, core. */
const PHOTON_FX_LAYERS = 8;

/** Projectiles: shot spawn + per-frame sim (player flight, homing, ignite, deadfall), bomblets, tow wires, explosions + blast damage, shot + photon sprites. */
export class Projectiles {
  shotG!: Phaser.GameObjects.Group;
  /** Additive Photon lens-flare layers (glow / streams / core). */
  photonFxG!: Phaser.GameObjects.Group;

  constructor(readonly s: MissionScene) {}

  spawnShot(s: Shot): void {
    const look = shotLookOf(s);
    const nudge = this.shotTipNudge(look, s.angle, s.x, s.y, s.z, s.scale ?? 1);
    s.x += nudge.x;
    s.y += nudge.y;
    if (!s.look) s.look = look;
    this.s.shots.push(s);
  }

  /** XY after tip-origin nudge — use for flight time so aim matches spawn. */
  shotSpawnXY(
    x: number,
    y: number,
    angle: number,
    z: number,
    look: ShotLook,
    scale = 1
  ): { x: number; y: number } {
    const n = this.shotTipNudge(look, angle, x, y, z, scale);
    return { x: x + n.x, y: y + n.y };
  }

  /** Forward shift so tip-origin art’s nose clears the muzzle (not the whole streak). */
  shotTipNudge(
    look: ShotLook,
    angle: number,
    x: number,
    y: number,
    z: number,
    scale = 1
  ): { x: number; y: number } {
    const at = worldToScreen(x, y, z);
    const img = this.s.textures.exists(look)
      ? (this.s.textures.get(look).getSourceImage() as { width: number; height: number })
      : { width: 48, height: 10 };
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    const projectedX = screenVelX(ca, sa, 0, x, y, z);
    const projectedY = screenVelY(sa, 0, z, y);
    const projectedUnit = Math.max(1e-6, Math.hypot(projectedX, projectedY));
    // Spawn is the tip-biased SHOT_ORIGIN; only push the remaining nose past the barrel.
    // (Using ox×length parked the whole tracer ahead of long guns like Spooky.)
    const screenDistance = (1 - SHOT_ORIGIN.x) * img.width * scale * at.scale;
    const d = screenDistance / projectedUnit;
    return { x: ca * d, y: sa * d };
  }

  /** World position of the shot exhaust / tail UV (matches trail emit + TOW wire tip). */
  shotTailWorldPos(s: Shot): { x: number; y: number; z: number } {
    const look = shotLookOf(s);
    const at = worldToScreen(s.x, s.y, s.z);
    const img = this.s.textures.exists(look)
      ? (this.s.textures.get(look).getSourceImage() as { width: number; height: number })
      : { width: 48, height: 10 };
    const sc = s.scale ?? 1;
    const horiz = Math.hypot(s.vx, s.vy);
    const pitchN = Phaser.Math.Clamp(Math.abs(s.vz) / Math.max(90, Math.hypot(horiz, s.vz)), 0, 1);
    const along = 1 - pitchN * 0.52;
    const spd = Math.hypot(s.vx, s.vy, s.vz);
    const fx = spd > 1e-3 ? s.vx / spd : Math.cos(s.angle);
    const fy = spd > 1e-3 ? s.vy / spd : Math.sin(s.angle);
    const fz = spd > 1e-3 ? s.vz / spd : 0;
    const projectedX = screenVelX(fx, fy, fz, s.x, s.y, s.z);
    const projectedY = screenVelY(fy, fz, s.z, s.y);
    const projectedUnit = Math.hypot(projectedX, projectedY);
    // Edge-on / tiny projection → stay at center (avoids huge world offsets that kill the wire).
    if (projectedUnit < 1e-3) return { x: s.x, y: s.y, z: s.z };
    const screenDistance =
      (SHOT_ORIGIN.x - SHOT_TAIL.x) * img.width * sc * at.scale * along;
    const d = Math.min(screenDistance / projectedUnit, 64);
    return {
      x: s.x - fx * d,
      y: s.y - fy * d,
      z: s.z - fz * d,
    };
  }

  /** Screen XY of a UV on the shot sprite (matches syncShotSprites scale/origin). */
  shotUvScreenPos(
    s: Shot,
    uvx: number,
    uvy: number,
    x = s.x,
    y = s.y,
    z = s.z
  ): { x: number; y: number } {
    const look = shotLookOf(s);
    const img = this.s.textures.exists(look)
      ? (this.s.textures.get(look).getSourceImage() as { width: number; height: number })
      : { width: 48, height: 10 };
    const sc = s.scale ?? 1;
    const base = worldToScreen(x, y, z);
    const zs = base.scale;
    const horiz = Math.hypot(s.vx, s.vy);
    const pitchN = Phaser.Math.Clamp(Math.abs(s.vz) / Math.max(90, Math.hypot(horiz, s.vz)), 0, 1);
    const along = 1 - pitchN * 0.52;
    const across = 1 + pitchN * 0.06;
    const dw = img.width * sc * zs * along;
    const dh = img.height * sc * zs * across;
    const lx = (uvx - SHOT_ORIGIN.x) * dw;
    const ly = (uvy - SHOT_ORIGIN.y) * dh;
    const drawRot = this.shotDrawRotation(s, x, y, z);
    const ca = Math.cos(drawRot);
    const sa = Math.sin(drawRot);
    return {
      x: base.x + lx * ca - ly * sa,
      y: base.y + lx * sa + ly * ca,
    };
  }

  /**
   * Screen rotation for a projectile sprite.
   * Self-propelled missiles face thrust/guidance (`s.angle`); ballistic shots face travel.
   */
  shotDrawRotation(s: Shot, x = s.x, y = s.y, z = s.z): number {
    if (shotFacesHeading(s)) {
      // Yaw from heading (thrust / steer), pitch from actual climb or dive.
      if (Math.abs(s.vz) < 1e-3) return projectHeading(s.angle, x, y, z);
      const h = Math.hypot(s.vx, s.vy);
      const hx = Math.cos(s.angle) * h;
      const hy = Math.sin(s.angle) * h;
      return Math.atan2(screenVelY(hy, s.vz, z, y), screenVelX(hx, hy, s.vz, x, y, z));
    }
    return Math.atan2(
      screenVelY(s.vy, s.vz, z, y),
      screenVelX(s.vx, s.vy, s.vz, x, y, z)
    );
  }

  /**
   * Enemy AA height cull — follows the player's altitude so high craft
   * (Gunship / Warthog / Lightning) stay hittable. Pad clears the hull.
   */
  enemyShotCeilZ(pad = 56): number {
    return this.s.player.z + Math.max(40, this.s.player.height * 0.55) + pad;
  }

  enemyShotExpired(s: Shot): boolean {
    const view = this.s.cameras.main.worldView;
    const pad = 96;
    const at = worldToScreen(s.x, s.y, s.z);
    if (
      at.x < view.x - pad ||
      at.x > view.right + pad ||
      at.y < view.y - pad ||
      at.y > view.bottom + pad
    ) {
      return true;
    }
    // lock_on missiles soft-clamp instead of hard expire (see updateShots).
    if (s.homePlayer || s.motor != null) return false;
    return s.z > this.enemyShotCeilZ();
  }

  updateShots(dt: number): void {
    const ptr = this.s.worldPointer();
    const focusSpec = this.s.targeting.combatFocus().spec;
    // Seekers read jet exhaust easily (big boost) but struggle against ground-hugging hulls (nerf).
    const seekClassMul = focusSpec.flightModel === "plane" ? 1.6 : focusSpec.crushesInfantry ? 0.55 : 1;
    const seekMul =
      this.s.countermeasures.cloakT > 0 ? 0 : (focusSpec.enemySeekerMul ?? 1) * seekClassMul;
    let w = 0;
    const shots = this.s.shots;
    for (let si = 0; si < shots.length; si++) {
      const s = shots[si]!;
      const beh = s.from === "player" ? s.beh : undefined;
      const st = s.from === "player" ? s.st : undefined;
      if (st) st.age = (st.age ?? 0) + dt;

      if (s.deadfall) {
        s.vx *= Math.pow(0.62, dt);
        s.vy *= Math.pow(0.62, dt);
        s.vz -= 440 * dt;
        if (s.vz < -920) s.vz = -920;
        if (s.yaw) s.angle += s.yaw * dt;
      } else {
        if (s.motor != null) {
          const was = s.motor;
          s.motor += dt;
          if (was < 0 && s.motor >= 0) this.missileIgnite(s);
        }
        const lit = s.motor == null || s.motor >= 0;
        const lofting = lit && (s.loft ?? 0) > 0;
        if (lofting) s.loft = (s.loft ?? 0) - dt;

        // --- Spec-driven player guidance / motor ---
        if (beh && st) {
          this.updatePlayerShotFlight(s, beh, st, dt, ptr);
        } else {
        // --- Legacy enemy (and any untagged) flight ---
        const lockOnHome = lit && !s.seekDisabled && s.targetId != null && !s.homePlayer;
        const stingerHome = lit && !s.seekDisabled && !!s.homePlayer;
        if (lockOnHome) {
          const cur = Math.hypot(s.vx, s.vy, s.vz);
          const burn = s.motor ?? 0;
          const cruise = s.cruise ?? 420;
          const accel = 480 + Phaser.Math.Clamp(burn, 0, 1.6) * 220;
          const spd = Math.min(cruise, cur + accel * dt);
          const seeking = (s.loft ?? 0) <= 0;
          if (seeking) {
            const u = s.targetId != null ? this.s.unitSim.unitById(s.targetId) : undefined;
            const tx = u ? u.x : s.x + s.vx;
            const ty = u ? u.y : s.y + s.vy;
            const tz = u ? u.z + heightOf(u.kind) * 0.5 : groundZ(this.s.world, s.x, s.y);
            const home = norm3(tx - s.x, ty - s.y, tz - s.z);
            const dir0 =
              cur < 8
                ? { x: Math.cos(s.angle), y: Math.sin(s.angle), z: 0.55 }
                : { x: s.vx, y: s.vy, z: s.vz };
            const d = steerDir(dir0.x, dir0.y, dir0.z, home.x, home.y, home.z, 9.5 * seekMul * dt);
            s.angle = Math.atan2(d.y, d.x);
            s.vx = d.x * spd;
            s.vy = d.y * spd;
            s.vz = d.z * spd;
          } else if (cur > 8) {
            s.vx = (s.vx / cur) * spd;
            s.vy = (s.vy / cur) * spd;
            s.vz = (s.vz / cur) * spd;
          } else {
            s.vx = Math.cos(s.angle) * spd;
            s.vy = Math.sin(s.angle) * spd;
          }
        }
        if (stingerHome) {
          const cur = Math.hypot(s.vx, s.vy, s.vz);
          const decoy = this.s.countermeasures.closestFlare(s.x, s.y, s.z);
          const seekTgt = this.s.targeting.enemySeekerTarget(s);
          const tx = decoy ? decoy.x : seekTgt.x;
          const ty = decoy ? decoy.y : seekTgt.y;
          const tz = decoy ? decoy.z : seekTgt.z + seekTgt.height * 0.45;
          const home = norm3(tx - s.x, ty - s.y, tz - s.z);
          const dir0 =
            cur < 8
              ? { x: Math.cos(s.angle), y: Math.sin(s.angle), z: 0.12 }
              : { x: s.vx, y: s.vy, z: s.vz };
          const age = Math.max(0, s.motor ?? 0);
          const steerRate = Phaser.Math.Linear(1.4, 0.5, Phaser.Math.Clamp(age / 5.5, 0, 1));
          const d = steerDir(dir0.x, dir0.y, dir0.z, home.x, home.y, home.z, steerRate * seekMul * dt);
          s.angle = Math.atan2(d.y, d.x);
          const cruise = s.cruise ?? 380;
          const burn = Math.max(0, s.motor ?? 0);
          const accel = 320 + Phaser.Math.Clamp(burn, 0, 2.2) * 180;
          const spd = Math.min(cruise, cur + accel * dt);
          s.vx = d.x * spd;
          s.vy = d.y * spd;
          s.vz = d.z * spd;
        }
        if (lit && s.povCam) {
          const tgt = this.s.fireControl.reticleUnit() ?? this.s.fireControl.hoverAerial();
          const want = Math.atan2(ptr.y - s.y, ptr.x - s.x);
          const da = Phaser.Math.Angle.Wrap(want - s.angle);
          s.angle += Phaser.Math.Clamp(da, -2.2 * dt, 2.2 * dt);
          const dist = Math.hypot(ptr.x - s.x, ptr.y - s.y);
          const hold = Phaser.Math.Clamp(dist / 360, 0, 1);
          const gndAim = groundZ(this.s.world, ptr.x, ptr.y);
          const tz = tgt
            ? tgt.z + heightOf(tgt.kind) * 0.3
            : Phaser.Math.Linear(gndAim, this.s.player.z, hold);
          s.vz = (tz - s.z) * 3.2;
          s.life = Math.max(s.life, 0.6);
        }
        if (s.motor != null && s.motor < 0) {
          const drag = s.povCam || s.wire ? Math.pow(0.12, dt) : Math.pow(0.07, dt);
          s.vx *= drag;
          s.vy *= drag;
          s.vz *= Math.pow(0.22, dt);
          if (s.yaw) s.angle += s.yaw * dt;
          const spd = Math.hypot(s.vx, s.vy);
          if (spd > 6) {
            s.vx = Math.cos(s.angle) * spd;
            s.vy = Math.sin(s.angle) * spd;
          }
        } else if (lockOnHome || stingerHome) {
          /* vx/vy/vz already steered in 3D */
        } else if (s.cruise != null && s.motor != null) {
          const cur = Math.hypot(s.vx, s.vy);
          const ramp = Phaser.Math.Clamp(s.motor / 0.16, 0, 1);
          const k = ramp * ramp * (3 - 2 * ramp);
          const spd = Phaser.Math.Linear(Math.max(cur, 50), s.cruise, k);
          s.vx = Math.cos(s.angle) * spd;
          s.vy = Math.sin(s.angle) * spd;
        } else if (s.povCam) {
          const spd = 300;
          s.vx = Math.cos(s.angle) * spd;
          s.vy = Math.sin(s.angle) * spd;
        }
        }
      }

      // Plasma helix visual offset (base position restored after trail/hit tests via cx/cy).
      let helixDx = 0;
      let helixDy = 0;
      let helixDz = 0;
      if (!s.deadfall && st?.helixOff != null && st.helixFreq != null) {
        const freq = st.helixFreq;
        const phase = st.helixPhase ?? 0;
        const wave = st.age * freq + phase;
        const lat = Math.sin(wave) * st.helixOff;
        helixDz = Math.cos(wave) * st.helixOff * 0.62;
        const px = -Math.sin(s.angle);
        const py = Math.cos(s.angle);
        helixDx = px * lat;
        helixDy = py * lat;
      }

      const x0 = s.x;
      const y0 = s.y;
      const z0 = s.z;
      const g0 = groundZ(this.s.world, x0, y0);
      // Warp missiles move on wall-clock so they look normal while the world crawls.
      const moveDt =
        s.warpTimeScale != null && this.s.frameWallDt > 0 ? this.s.frameWallDt : dt;
      s.x += s.vx * moveDt;
      s.y += s.vy * moveDt;
      s.z += s.vz * moveDt;
      if (s.homePlayer && s.from !== "player") {
        const ceil = this.enemyShotCeilZ(96);
        if (s.z > ceil) {
          s.z = ceil;
          if (s.vz > 0) s.vz = 0;
        }
      }
      s.life -= dt;
      if (s.wire && !s.deadfall) this.simulateTowWire(s, dt);
      if (!s.deadfall && st?.helixOff != null && st.helixFreq != null) {
        // Recompute spiral tip after move so the ribbon tracks the braid.
        const wave = st.age * st.helixFreq + (st.helixPhase ?? 0);
        const lat = Math.sin(wave) * st.helixOff;
        const hz = Math.cos(wave) * st.helixOff * 0.62;
        const px = -Math.sin(s.angle);
        const py = Math.cos(s.angle);
        helixDx = px * lat;
        helixDy = py * lat;
        helixDz = hz;
        this.s.trails.simulateHelixRibbon(s, dt, s.x + helixDx, s.y + helixDy, s.z + helixDz);
      } else if (s.energyTrail || s.energyTrails) {
        this.s.trails.simulateEnergyTrail(s, dt);
      }

      const kickPre =
        beh?.launch.mode === "kick_motor" && s.motor != null && s.motor < 0;
      const preIgnite =
        kickPre ||
        ((s.homePlayer || s.povCam || s.wire || s.motor != null) &&
          s.from === "player" &&
          s.motor != null &&
          s.motor < 0 &&
          !beh);
      if (preIgnite) {
        const gRepel = groundZ(this.s.world, s.x, s.y) + 8;
        if (s.z < gRepel) {
          s.z = gRepel;
          if (s.vz < 60) s.vz = 60;
        }
      }

      const g1 = groundZ(this.s.world, s.x, s.y);
      const a0 = z0 - g0;
      const a1 = s.z - g1;
      let hit = !s.deadfall && s.from !== "enemy" && s.life <= 0;
      const clusterOpen =
        !s.deadfall &&
        !!st &&
        !st.bomblet &&
        !st.opened &&
        payloadIsCluster(beh?.payload);
      const openAge = clusterOpen ? st!.openAge : undefined;

      if (preIgnite && a1 > 0) {
        /* skip ground collision during pre-ignition repel */
      } else if (openAge != null && (st!.age ?? 0) >= openAge && a1 > 4) {
        // Mid-air dispense at authored fraction of predicted flight time.
        hit = true;
      } else if (openAge != null && a1 <= 0) {
        // Reached ground before open age — still pop just above so bomblets can spray.
        s.z = g1 + 14;
        hit = true;
      } else if (a0 > 0.05 && a1 <= 0) {
        const u = a0 / (a0 - a1);
        s.x = x0 + (s.x - x0) * u;
        s.y = y0 + (s.y - y0) * u;
        s.z = g0 + (g1 - g0) * u;
        hit = true;
      } else if (a1 <= 0 && a0 <= 0.05) {
        s.z = g1;
        hit = true;
      }

      let victim: Unit | undefined;
      let hitPlayer = false;
      if (!s.deadfall && s.from === "enemy") {
        const tryHit = (tgt: Craft, isHost: boolean): boolean => {
          if (tgt.phase !== "flight" && tgt.phase !== "grounded") return false;
          // Shadow remotes stay in "flight" phase; host must be airborne.
          if (isHost && this.s.player.phase !== "flight") return false;
          const hitR =
            isHost && this.s.countermeasures.reactiveArmorT > 0
              ? tgt.spec.radius * REACTIVE_ARMOR_RADIUS_MUL
              : tgt.spec.radius;
          if (Math.hypot(s.x - tgt.x, s.y - tgt.y) >= hitR) return false;
          if (s.z > tgt.z + tgt.height || s.z < tgt.z) return false;
          const dmg = s.dmg * 0.65 * (this.s.countermeasures.reactiveArmorT > 0 && isHost ? 0.22 : 1);
          this.s.targeting.damageTarget(tgt, dmg, s.vx, s.vy);
          if (this.s.countermeasures.reactiveArmorT > 0 && isHost) {
            this.s.fx.spawnImpactFlash(tgt.x, tgt.y, tgt.z + 8, 0xffcc66, 48, 0.9, 140);
            this.s.countermeasures.fireReactiveArmorImpactBurst(s.vx, s.vy);
          }
          return true;
        };
        // Any live remote can be struck; AA seekers ignore dirt-locked ones.
        for (const r of this.s.remotes) {
          if (!this.s.targeting.remoteTargetable(r) || (s.homePlayer && r.spec.ground)) continue;
          const c = this.s.targeting.remoteTargetCraft(r);
          if (c && tryHit(c, false)) {
            hit = true;
            hitPlayer = true;
            break;
          }
        }
        if (!hitPlayer && this.s.countermeasures.cloakT <= 0 && tryHit(this.s.player, true)) {
          hit = true;
          hitPlayer = true;
        }
      }
      if (!s.deadfall && s.from === "player") {
        for (const u of this.s.units) {
          if (u.dead) continue;
          if (st?.hitIds?.includes(u.id)) continue;
          const hr = circumRadiusOf(u.kind) + 8;
          const dx = s.x + helixDx - u.x;
          const dy = s.y + helixDy - u.y;
          if (dx * dx + dy * dy > hr * hr) continue;
          if (!pointInFootprint(s.x + helixDx, s.y + helixDy, footprintInto(u, 8, 0))) continue;
          const top = u.z + heightOf(u.kind);
          const hz = s.z + helixDz;
          if (hz > top + 2) continue;
          if (hz < u.z - 2) continue;
          // Kinetic pierce: whole points only (fractional pen like 0.55 is AP feel, not a free pass).
          if (st && (st.pierce ?? 0) >= 1 && payloadIsKinetic(beh?.payload, beh?.launch)) {
            st.pierce! -= 1;
            st.hitIds = st.hitIds ?? [];
            st.hitIds.push(u.id);
            this.hurt(u, this.weaponDamageMul(s, u, s.dmg), false);
            // Through-shot still sprays blood/sparks at the contact point.
            this.explode(
              s.x + helixDx,
              s.y + helixDy,
              s.z + helixDz,
              0,
              s.dmg,
              u,
              s.vx,
              s.vy,
              s.vz,
              true,
              shotKindForExplode(s),
              projectileFxScale(s.from, s.fxInterval),
              s,
              true
            );
            continue;
          }
          hit = true;
          victim = u;
          break;
        }
        // Proximity fuse — safety net only (prefer real body impact).
        // Arms when we have already passed the lock in XY while still above the hit box,
        // or when skimming inside a very tight 3D pocket.
        if (
          !hit &&
          s.targetId != null &&
          beh?.guidance &&
          guidanceIsLockOn(beh.guidance) &&
          beh.guidance.targeting.proxFuse
        ) {
          const u = this.s.unitSim.unitById(s.targetId);
          const fuse = beh.guidance.targeting.proxFuse;
          if (u && !u.dead) {
            const top = u.z + heightOf(u.kind);
            const aimZ = u.z + heightOf(u.kind) * 0.45;
            const toX = u.x - s.x;
            const toY = u.y - s.y;
            const hx = Math.hypot(toX, toY);
            const fuseXy = circumRadiusOf(u.kind) + fuse.xy;
            const d3 = Math.hypot(toX, toY, aimZ - s.z);
            const closing = s.vx * toX + s.vy * toY;
            const above = s.z > top + 2;
            const overshot = hx < fuseXy && closing < 0 && above;
            const skim = d3 < circumRadiusOf(u.kind) + (fuse.z ?? fuse.xy);
            if (overshot || skim) {
              hit = true;
              victim = u;
            }
          }
        }
      }
      if (hit) {
        this.s.trails.releaseEnergyTrail(s);
        // Linger policy (hold lengths; cam.linger not authored yet):
        // - thermal + povCam: long + keep sensor palette
        // - wire: medium
        // - other povCam: short
        // - warp (timeScale): separate path below, hold stretched by timeScale
        const lingerThermal =
          s.from === "player" && !!beh?.cam.thermal && !!beh.cam.povCam;
        const lingerWire =
          s.from === "player" && !!beh?.guidance?.wire && !!s.wire;
        const lingerPov =
          s.from === "player" &&
          !!beh?.cam.povCam &&
          !lingerThermal &&
          !lingerWire &&
          s.warpTimeScale == null;
        if (lingerThermal || lingerWire || lingerPov) {
          let hold = lingerThermal ? 1.65 : lingerWire ? 0.95 : 0.55;
          if (s.warpTimeScale != null) {
            hold = Math.min(8, hold / Math.max(0.08, s.warpTimeScale));
          }
          this.s.camera.beginImpactCamLinger(s.x, s.y, {
            thermal: lingerThermal ? this.s.thermal.craftSensorPalette() : undefined,
            hold,
          });
        }
        if (s.from === "player" && s.warpTimeScale != null) {
          this.s.warpLingerScale = s.warpTimeScale;
          // Ensure linger runs even if steer_commit / thermal / wire didn't arm the cam hold.
          if (this.s.camera.povCamLookHold <= 0) {
            this.s.camera.beginImpactCamLinger(s.x, s.y, {
              hold: Math.min(8, 1.65 / Math.max(0.08, s.warpTimeScale)),
            });
          }
        }
        // Cluster open at impact / airburst
        if (payloadIsCluster(beh?.payload) && st && !st.bomblet && !st.opened) {
          st.opened = true;
          const cl = beh!.payload.cluster!;
          if (cl.break === "cone_hop") {
            this.spawnStarstreakBomblets(s, cl.bomblets, cl.spread);
          } else {
            this.spawnClusterBomblets(s, cl.bomblets, cl.spread);
          }
        }
        if (payloadIsSmoke(beh?.payload)) {
          this.s.countermeasures.spawnSmokePuffs(s.x, s.y, s.z, beh!.payload.smoke!.radius, beh!.payload.smoke!.duration);
        }
        if (payloadIsCallStrike(beh?.payload) && st && !st.opened && !st.bomblet) {
          st.opened = true;
          const cs = { ...beh!.payload.callStrike! };
          let spawnFrom: { x: number; y: number; z: number } | undefined;
          let hostWeapon: WpnId | undefined;
          if (st.callStrikeFromHost) {
            // POV remote observer — walk the host howitzer onto the mark.
            const h = this.s.player;
            spawnFrom = {
              x: h.x,
              y: h.y,
              z: Math.max(h.z + 140, 420),
            };
            hostWeapon = cs.hostWeapon;
          }
          this.s.callStrike.arm(s.x, s.y, s.z, cs, spawnFrom, hostWeapon);
        }
        // Canister dispense is a light pop — bomblets carry the damage.
        // Only for mid-air `openAt` dispensers (Rockeye); impact clusters keep full pop.
        const canisterPop =
          payloadIsCluster(beh?.payload) &&
          !!st &&
          !st.bomblet &&
          beh!.payload.cluster!.openAt != null;
        this.explode(
          s.x + helixDx,
          s.y + helixDy,
          s.z + helixDz,
          canisterPop ? Math.min(16, s.blast * 0.55) : s.blast,
          canisterPop ? Math.min(6, s.dmg * 0.55) : s.dmg,
          canisterPop ? undefined : victim,
          s.vx,
          s.vy,
          s.vz,
          canisterPop ? false : !!victim || hitPlayer,
          shotKindForExplode(s),
          projectileFxScale(s.from, s.fxInterval) * (canisterPop ? 0.45 : 1),
          s
        );
        continue;
      }
      if (s.from === "enemy" && !s.deadfall && this.enemyShotExpired(s)) continue;
      // Temporarily apply helix for trail emit position
      if (helixDx || helixDy || helixDz) {
        s.x += helixDx;
        s.y += helixDy;
        s.z += helixDz;
        this.s.trails.emitShotTrail(s, x0 + helixDx, y0 + helixDy, z0 + helixDz);
        s.x -= helixDx;
        s.y -= helixDy;
        s.z -= helixDz;
      } else {
        this.s.trails.emitShotTrail(s, x0, y0, z0);
      }
      if (!s.deadfall && exhaustWarpMotes(s.beh?.exhaust)) {
        this.s.trails.emitWarpTrailFx(s, x0, y0, z0);
      }
      if (!s.deadfall && exhaustIsSignalFlare(s.beh?.exhaust)) {
        this.s.trails.emitSignalFlareTrailFx(s, x0, y0, z0);
      }
      shots[w++] = s;
    }
    shots.length = w;
    this.s.trails.ageEnergyLinger(dt);
    this.s.refractor.tick(dt);
    if (this.s.perf.enabled) {
      const t = performance.now();
      this.syncShotSprites();
      this.syncPhotonFlares();
      this.s.perf.current![6] = performance.now() - t;
    } else {
      this.syncShotSprites();
      this.syncPhotonFlares();
    }
  }

  /** Spec-driven motor, gravity, and guidance for player shots with `beh`. */
  updatePlayerShotFlight(
    s: Shot,
    beh: NonNullable<Shot["beh"]>,
    st: ShotState,
    dt: number,
    ptr: { x: number; y: number }
  ): void {
    const lit = s.motor == null || s.motor >= 0;
    const g = beh.guidance;
    const tMode = targetingMode(g);
    const flight = g?.flight;
    const grav = launchGravity(beh.launch);

    // Gravity for drops and ballistic artillery shells
    if (grav && (beh.launch.mode === "drop" || (beh.launch.mode === "muzzle" && !!grav))) {
      s.vz += -grav.acceleration * dt;
      if (grav.terminalVelocity != null && s.vz < -grav.terminalVelocity) {
        s.vz = -grav.terminalVelocity;
      }
    }

    // Pre-ignite drag / yaw — keep enough of craft+kick speed that soft-launch still reads as a throw.
    if (s.motor != null && s.motor < 0) {
      const drag = Math.pow(tMode === "steer" ? 0.28 : 0.42, dt);
      s.vx *= drag;
      s.vy *= drag;
      s.vz *= Math.pow(0.35, dt);
      if (s.yaw) s.angle += s.yaw * dt;
      const spd = Math.hypot(s.vx, s.vy);
      if (spd > 6) {
        s.vx = Math.cos(s.angle) * spd;
        s.vy = Math.sin(s.angle) * spd;
      }
      return;
    }

    // Spider drones: mouse crawl + proximity dash onto hostiles.
    const spider = beh.payload.spider;
    if (spider && lit) {
      this.s.remoteBody.tickSpiderDroneShot(s, beh, spider, dt, ptr);
      return;
    }

    // lock_on: shared motor/rail ramp, then loft coast or 3D home.
    if (g && guidanceIsLockOn(g) && lit) {
      const targeting = g.targeting;
      const seeking = (s.loft ?? 0) <= 0;
      const cur = Math.hypot(s.vx, s.vy, s.vz);
      const spd = motorizedSpeed(s, beh, dt);
      const loftProfile = flight?.loft;
      if (seeking && s.targetId != null) {
        const u = this.s.unitSim.unitById(s.targetId);
        const tx = u ? u.x : s.x + s.vx;
        const ty = u ? u.y : s.y + s.vy;
        const impactZ = u ? u.z + heightOf(u.kind) * 0.45 : groundZ(this.s.world, s.x, s.y);
        // Photon-style loft: cruise AGL + dive from flight.loft (no weapon-id branch).
        if (loftProfile && typeof loftProfile.cruise === "object" && "agl" in loftProfile.cruise) {
          const gnd = groundZ(this.s.world, s.x, s.y);
          const peakAgl = loftProfile.cruise.agl;
          const cruiseZ = gnd + peakAgl;
          const horiz = Math.hypot(tx - s.x, ty - s.y);
          const diveRange = loftProfile.dive.range;
          const dive = Math.pow(
            1 - Phaser.Math.Clamp(horiz / diveRange, 0, 1),
            loftProfile.dive.power
          );
          const holdZ = Math.max(s.z, cruiseZ);
          const wantZ = Phaser.Math.Linear(holdZ, impactZ, dive);
          const home = norm3(tx - s.x, ty - s.y, wantZ - s.z);
          const prox = targeting.proxTurn;
          const turnRate = prox
            ? Phaser.Math.Linear(
                prox.near,
                prox.far,
                Phaser.Math.Clamp(horiz / Math.max(40, prox.nearDist), 0, 1)
              )
            : (flight?.turnRate ?? 18);
          const turn = Phaser.Math.Linear(turnRate * 0.85, turnRate * 1.7, dive) * dt;
          flyMissile(s, home, turn, spd);
          const clearFar = loftProfile.clear?.far ?? 240;
          const clearNear = loftProfile.clear?.near ?? 22;
          const minAgl = Phaser.Math.Linear(clearFar, clearNear, dive);
          const floor = gnd + minAgl;
          if (s.z < floor) {
            s.z = floor;
            if (s.vz < 0) s.vz = Math.max(40, -s.vz * 0.25);
          }
          return;
        }
        const home = norm3(tx - s.x, ty - s.y, impactZ - s.z);
        const dist = Math.hypot(tx - s.x, ty - s.y, impactZ - s.z);
        const prox = targeting.proxTurn;
        const turnRate = prox
          ? Phaser.Math.Linear(
              prox.near,
              prox.far,
              Phaser.Math.Clamp(dist / Math.max(40, prox.nearDist), 0, 1)
            )
          : (flight?.turnRate ?? 7.4);
        flyMissile(s, home, turnRate * dt, spd);
      } else {
        // Loft coast: scale the full 3D velocity so the launch pitch holds (no per-frame flattening).
        if (cur > 1e-3) {
          const k = spd / cur;
          s.vx *= k;
          s.vy *= k;
          s.vz *= k;
        } else {
          s.vx = Math.cos(s.angle) * spd;
          s.vy = Math.sin(s.angle) * spd;
        }
        if (loftProfile && typeof loftProfile.cruise === "object" && "agl" in loftProfile.cruise) {
          const gnd = groundZ(this.s.world, s.x, s.y);
          const floor = gnd + (loftProfile.clear?.coast ?? 120);
          if (s.z < floor) {
            s.z = floor;
            if (s.vz < 80) s.vz = 120;
          }
        }
      }
      return;
    }

    // Kick motor acceleration toward cruise
    if (beh.launch.mode === "kick_motor" && lit && s.motor != null) {
      const cur = Math.hypot(s.vx, s.vy, s.vz);
      const spd = motorizedSpeed(s, beh, dt);

      if (g && tMode === "steer_commit") {
        const targeting = g.targeting;
        const steerDt =
          s.warpTimeScale != null && this.s.frameWallDt > 0 ? this.s.frameWallDt : dt;
        const breakR =
          targeting.mode === "steer_commit" ? (targeting.breakLockRadius ?? 0) : 0;
        const lockRadius =
          targeting.mode === "steer_commit" ? targeting.lockRadius : 60;
        if (!st?.terminal && breakR > 0) {
          if (s.targetId != null) {
            const u = this.s.unitSim.unitById(s.targetId);
            if (!u || u.dead || Math.hypot(ptr.x - u.x, ptr.y - u.y) > breakR) {
              s.targetId = undefined;
            }
          } else {
            let best: Unit | undefined;
            let bd = lockRadius;
            for (const u of this.s.units) {
              if (u.dead) continue;
              const d = Math.hypot(u.x - ptr.x, u.y - ptr.y);
              if (d < bd) {
                bd = d;
                best = u;
              }
            }
            if (best) s.targetId = best.id;
          }
        }
        if (st?.terminal) {
          const u = s.targetId != null ? this.s.unitSim.unitById(s.targetId) : undefined;
          const tx = u ? u.x : st.gx ?? s.x + s.vx;
          const ty = u ? u.y : st.gy ?? s.y + s.vy;
          const tz = u
            ? u.z + heightOf(u.kind) * 0.35
            : groundZ(this.s.world, tx, ty);
          const home = norm3(tx - s.x, ty - s.y, tz - s.z);
          const turn = (flight?.commitTurnRate ?? flight?.turnRate ?? 8) * steerDt;
          const launchAccel = beh.launch.acceleration;
          const burnT = beh.launch.burnTime;
          const burnAge = s.motor ?? 0;
          const termAccel =
            launchAccel * 1.3 + Phaser.Math.Clamp(burnAge, 0, burnT) * 0.5 * launchAccel;
          const termSpd = Math.min(beh.cruiseSpeed * 1.7, cur + termAccel * steerDt);
          flyMissile(s, home, turn, termSpd, { slowThresh: 8 });
        } else {
          const locked = s.targetId != null ? this.s.unitSim.unitById(s.targetId) : undefined;
          const soft = !!(locked && !locked.dead);
          const aimX = soft ? locked!.x : ptr.x;
          const aimY = soft ? locked!.y : ptr.y;
          const want = Math.atan2(aimY - s.y, aimX - s.x);
          const da = Phaser.Math.Angle.Wrap(want - s.angle);
          const rate = flight?.turnRate ?? 3.4;
          const gndHere = groundZ(this.s.world, s.x, s.y);
          const playerAgl = Math.max(28, this.s.player.z - this.s.player.gndSmooth);
          const cruiseZ = gndHere + playerAgl;
          const dive = flight?.loft?.dive;
          if (soft) {
            const impactZ = locked!.z + heightOf(locked!.kind) * 0.45;
            const dist = Math.hypot(aimX - s.x, aimY - s.y);
            const diveRange = dive?.range ?? 340;
            const divePower = dive?.power ?? 2.05;
            const diveAmt = Math.pow(1 - Phaser.Math.Clamp(dist / diveRange, 0, 1), divePower);
            const dropT = Phaser.Math.Clamp(diveAmt * 1.5, 0, 1);
            const wantZ = Phaser.Math.Linear(cruiseZ + 36, impactZ, dropT);
            const turn = rate * (1.15 + diveAmt * 2.4) * steerDt;
            s.angle += Phaser.Math.Clamp(da, -turn, turn);
            s.vx = Math.cos(s.angle) * spd;
            s.vy = Math.sin(s.angle) * spd;
            s.vz = (wantZ - s.z) * (1.45 + diveAmt * 7.5);
            s.life = Math.max(s.life, 0.6);
          } else {
            s.angle += Phaser.Math.Clamp(da, -rate * steerDt, rate * steerDt);
            s.vx = Math.cos(s.angle) * spd;
            s.vy = Math.sin(s.angle) * spd;
            s.vz = (cruiseZ - s.z) * 1.55;
          }
        }
        return;
      }

      if (g && tMode === "steer") {
        const want = Math.atan2(ptr.y - s.y, ptr.x - s.x);
        const da = Phaser.Math.Angle.Wrap(want - s.angle);
        const maxA = flight?.maxAngle ?? 0.75;
        const rate = flight?.turnRate ?? 2.2;
        const clampedWant = s.angle + Phaser.Math.Clamp(da, -maxA, maxA);
        const d2 = Phaser.Math.Angle.Wrap(clampedWant - s.angle);
        s.angle += Phaser.Math.Clamp(d2, -rate * dt, rate * dt);
        const distPtr = Math.hypot(ptr.x - s.x, ptr.y - s.y);
        const gndAim = groundZ(this.s.world, ptr.x, ptr.y);
        const tgt = this.s.fireControl.reticleUnit() ?? this.s.fireControl.hoverAerial();
        const gndHere = groundZ(this.s.world, s.x, s.y);
        const playerAgl = Math.max(28, this.s.player.z - this.s.player.gndSmooth);
        const impactZ = tgt ? tgt.z + heightOf(tgt.kind) * 0.3 : gndAim;
        const groundish = !tgt || !isAerial(tgt.kind);
        const groundDive = flight?.loft?.cruise === "player_descend";
        const cruiseZ =
          groundDive && groundish
            ? gndHere +
              Phaser.Math.Clamp(32 + distPtr * 0.11, 40, Math.min(playerAgl, 150))
            : gndHere + playerAgl;
        const diveInner = flight?.loft?.dive.inner ?? 45;
        const diveRange = flight?.loft?.dive.range ?? 280;
        const divePower = flight?.loft?.dive.power ?? 2.85;
        const outside = Math.max(0, distPtr - diveInner);
        const closeness = 1 - Phaser.Math.Clamp(outside / Math.max(1, diveRange - diveInner), 0, 1);
        const dive = Math.pow(closeness, divePower);
        const tz = Phaser.Math.Linear(cruiseZ, impactZ, dive);
        const zGain = 2.2 + dive * 9.5 + (groundDive && groundish ? dive * 4.5 : 0);
        s.vz = (tz - s.z) * zGain;
        s.vx = Math.cos(s.angle) * spd;
        s.vy = Math.sin(s.angle) * spd;
        s.life = Math.max(s.life, 0.6);
        return;
      }

      if (tMode === "waypoint" && st.gx != null && st.gy != null) {
        const gndImpact = groundZ(this.s.world, st.gx, st.gy);
        const home = norm3(st.gx - s.x, st.gy - s.y, gndImpact - s.z);
        const turn = (flight?.turnRate ?? 1.5) * dt;
        flyMissile(s, home, turn, spd, { noseZ: -0.35, slowThresh: 8 });
        return;
      }

      s.vx = Math.cos(s.angle) * spd;
      s.vy = Math.sin(s.angle) * spd;
      return;
    }

    // Muzzle rockets with pointer (Micros / Starscream / Banshee)
    if (g && tMode === "steer" && lit) {
      const rate = flight?.turnRate ?? 0.55;
      const maxA = flight?.maxAngle ?? 0.16;
      const loftLeave =
        beh.launch.mode === "muzzle" &&
        beh.launch.leaveVz != null &&
        beh.launch.leaveVz > 0;
      if (loftLeave) {
        // Two-beat loft: climb hard (visible up), then pitch over and crash onto reticle.
        const age = st.age ?? 0;
        const loftHold = 0.72;
        const leaveUp =
          beh.launch.mode === "muzzle" && beh.launch.leaveVz != null
            ? beh.launch.leaveVz
            : 480;
        const tgt = this.s.fireControl.reticleUnit();
        const impactZ = tgt
          ? tgt.z + heightOf(tgt.kind) * 0.35
          : groundZ(this.s.world, ptr.x, ptr.y) + 10;
        if (age < loftHold) {
          // Hold the climb — only soft yaw toward the reticle, keep vz up.
          const want = Math.atan2(ptr.y - s.y, ptr.x - s.x);
          const da = Phaser.Math.Angle.Wrap(want - s.angle);
          s.angle += Phaser.Math.Clamp(da, -rate * 0.28 * dt, rate * 0.28 * dt);
          const hSpd = Math.min(beh.cruiseSpeed * 0.2, 140 + age * 90);
          s.vx = Math.cos(s.angle) * hSpd;
          s.vy = Math.sin(s.angle) * hSpd;
          // Bleed climb slowly so the pop stays readable the whole hold.
          const climbFloor = leaveUp * Phaser.Math.Linear(0.95, 0.45, age / loftHold);
          s.vz = Math.max(climbFloor, s.vz - 55 * dt);
        } else {
          // Pitch-over dive onto aim — full turn authority.
          const dive = Phaser.Math.Clamp((age - loftHold) / 0.55, 0, 1);
          const ease = dive * dive * (3 - 2 * dive);
          const home = norm3(ptr.x - s.x, ptr.y - s.y, impactZ - s.z);
          const spd3 = Math.max(
            Math.hypot(s.vx, s.vy, s.vz),
            beh.cruiseSpeed * 0.65
          );
          flyMissile(s, home, rate * (1.15 + ease * 1.1) * dt, spd3);
        }
      } else {
        const want = Math.atan2(ptr.y - s.y, ptr.x - s.x);
        const da = Phaser.Math.Angle.Wrap(want - s.angle);
        s.angle += Phaser.Math.Clamp(Phaser.Math.Clamp(da, -maxA, maxA), -rate * dt, rate * dt);
        const spd = Math.hypot(s.vx, s.vy) || beh.cruiseSpeed;
        s.vx = Math.cos(s.angle) * spd;
        s.vy = Math.sin(s.angle) * spd;
      }
    }

    // Waypoint steering while falling
    if (tMode === "waypoint" && st.gx != null && st.gy != null && beh.launch.mode === "drop") {
      const want = Math.atan2(st.gy - s.y, st.gx - s.x);
      const da = Phaser.Math.Angle.Wrap(want - s.angle);
      const rate = flight?.turnRate ?? 1.5;
      s.angle += Phaser.Math.Clamp(da, -rate * dt, rate * dt);
      const horiz = Math.hypot(s.vx, s.vy);
      const spd = Math.max(horiz, 40);
      s.vx = Math.cos(s.angle) * spd;
      s.vy = Math.sin(s.angle) * spd;
    }

    // Muzzle boost (Hydra / AA rail / APKWS): accel toward cruise, then coast if burnTime set.
    if (
      lit &&
      (!g || tMode === "steer") &&
      beh.launch.mode === "muzzle" &&
      beh.launch.acceleration != null
    ) {
      const cur = Math.hypot(s.vx, s.vy, s.vz);
      const spd = motorizedSpeed(s, beh, dt);
      if (cur > 1) {
        s.vx = (s.vx / cur) * spd;
        s.vy = (s.vy / cur) * spd;
        s.vz = (s.vz / cur) * spd;
      } else {
        s.vx = Math.cos(s.angle) * spd;
        s.vy = Math.sin(s.angle) * spd;
      }
    }
  }

  /**
   * Starscream break: prefer a ballistic hop onto a living unit inside the
   * forward launch cone; otherwise keep the old random spray.
   */
  spawnStarstreakBomblets(parent: Shot, count: number, spread: number): void {
    const beh = parent.beh;
    if (!beh || !payloadIsCluster(beh.payload)) return;
    const { bombletDmg, bombletBlast } = beh.payload.cluster!;
    const grav = 380;
    const term = 820;
    const ox = parent.x;
    const oy = parent.y;
    const oz = parent.z + 10;
    const face = parent.angle;
    const coneHalf = 1.25;
    const minRange = 14;
    const maxRange = spread * 2.45;
    const claimed = new Set<number>();

    const candidates: { u: Unit; score: number }[] = [];
    for (const u of this.s.units) {
      if (u.dead) continue;
      const dx = u.x - ox;
      const dy = u.y - oy;
      const d = Math.hypot(dx, dy);
      if (d < minRange || d > maxRange) continue;
      const off = Math.abs(Phaser.Math.Angle.Wrap(Math.atan2(dy, dx) - face));
      if (off > coneHalf) continue;
      candidates.push({ u, score: off * 55 + d });
    }
    candidates.sort((a, b) => a.score - b.score);

    for (let i = 0; i < count; i++) {
      let tgt: Unit | undefined;
      for (const c of candidates) {
        if (claimed.has(c.u.id)) continue;
        tgt = c.u;
        claimed.add(c.u.id);
        break;
      }
      if (!tgt && candidates.length) {
        tgt = candidates[Math.floor(Math.random() * candidates.length)]!.u;
      }

      if (tgt) {
        const jit = 12 + Math.random() * 18;
        const jang = Math.random() * Math.PI * 2;
        const ax = tgt.x + Math.cos(jang) * jit;
        const ay = tgt.y + Math.sin(jang) * jit;
        const gnd = groundZ(this.s.world, ax, ay);
        const arc = this.starstreakBombletArc(ox, oy, oz, ax, ay, gnd, grav, term, spread);
        if (arc) {
          const a = arc.angle;
          this.spawnShot({
            from: "player",
            wpnId: parent.wpnId,
            slot: parent.slot,
            beh: {
              ...beh,
              payload: beh.payload.cluster?.bombletDetonate
                ? { detonate: beh.payload.cluster.bombletDetonate }
                : { detonate: { look: "fire" } },
              guidance: undefined,
              exhaust: undefined,
              launch: {
                mode: "muzzle",
                inheritMomentum: 0,
                gravity: { acceleration: grav, terminalVelocity: term },
              },
            },
            st: { age: 0, launchAngle: a, bomblet: true, opened: true },
            x: ox + Math.cos(a) * 6,
            y: oy + Math.sin(a) * 6,
            z: oz,
            vx: arc.vx,
            vy: arc.vy,
            vz: arc.vz,
            angle: a,
            life: arc.life,
            blast: bombletBlast,
            dmg: bombletDmg,
            look: beh.payload.cluster!.look,
            scale: (parent.scale ?? 1) * 0.48,
            fxInterval: 0.2,
            energyTrail: [],
          });
          continue;
        }
      }

      const a = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.8;
      const spd = spread * (0.7 + Math.random() * 0.9);
      const loft = 110 + Math.random() * 90;
      this.spawnShot({
        from: "player",
        wpnId: parent.wpnId,
        slot: parent.slot,
        beh: {
          ...beh,
          payload: beh.payload.cluster?.bombletDetonate
            ? { detonate: beh.payload.cluster.bombletDetonate }
            : { detonate: { look: "energy" } },
          guidance: undefined,
          exhaust: undefined,
          launch: {
            mode: "muzzle",
            inheritMomentum: 0,
            gravity: { acceleration: grav, terminalVelocity: term },
          },
        },
        st: { age: 0, launchAngle: a, bomblet: true, opened: true },
        x: ox + Math.cos(a) * 6,
        y: oy + Math.sin(a) * 6,
        z: oz,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd,
        vz: loft,
        angle: a,
        life: 0.7 + Math.random() * 0.45,
        blast: bombletBlast,
        dmg: bombletDmg,
        look: beh.payload.cluster!.look,
        scale: (parent.scale ?? 1) * 0.48,
        fxInterval: 0.2,
        energyTrail: [],
      });
    }
  }

  /** Lofted hop that lands near `ax,ay` within spray speed budget; null if unreachable. */
  starstreakBombletArc(
    ox: number,
    oy: number,
    oz: number,
    ax: number,
    ay: number,
    gnd: number,
    grav: number,
    term: number,
    spread: number
  ): { vx: number; vy: number; vz: number; angle: number; life: number } | null {
    const dx = ax - ox;
    const dy = ay - oy;
    const dist = Math.hypot(dx, dy);
    if (dist < 8) return null;
    const loftLo = 115;
    const loftHi = 215;
    const maxSpd = spread * 1.9;
    let best: { vx: number; vy: number; vz: number; angle: number; life: number; loft: number } | null =
      null;
    for (let i = 0; i < 10; i++) {
      const loft = loftLo + ((loftHi - loftLo) * i) / 9;
      const fallT = this.s.fireControl.estimateBombFallTime(oz, loft, gnd, grav, term);
      const vh = dist / Math.max(0.2, fallT);
      if (vh > maxSpd) continue;
      const angle = Math.atan2(dy, dx);
      const cand = {
        vx: Math.cos(angle) * vh,
        vy: Math.sin(angle) * vh,
        vz: loft,
        angle,
        life: fallT + 0.28,
        loft,
      };
      // Prefer a visible arc when several lofts reach.
      if (!best || loft > best.loft) best = cand;
    }
    return best;
  }

  spawnClusterBomblets(parent: Shot, count: number, spread: number): void {
    const beh = parent.beh;
    if (!beh) return;
    const cluster = beh.payload.cluster;
    const bombletDmg = cluster?.bombletDmg ?? parent.dmg * 0.22;
    const bombletBlast = cluster?.bombletBlast ?? parent.blast * 0.28;
    const face =
      Math.hypot(parent.vx, parent.vy) > 12
        ? Math.atan2(parent.vy, parent.vx)
        : parent.angle;
    // Keep some of the canister's motion so the carpet still drifts with the drop.
    const inherit = 0.45;
    for (let i = 0; i < count; i++) {
      // Mild heading bias — mostly random eject cone.
      const bias = (Math.random() + Math.random() - 1);
      const a = face + bias * Math.PI * 1.15;
      const eject = spread * (0.22 + Math.random() * 0.38);
      const bx = parent.x + Math.cos(a) * range(2, 10);
      const by = parent.y + Math.sin(a) * range(2, 10);
      const vx = parent.vx * inherit + Math.cos(a) * eject;
      const vy = parent.vy * inherit + Math.sin(a) * eject;
      // Randomized loft with an upward bias (arcade bloom before rain).
      const vz = parent.vz * 0.15 + range(40, 100);
      this.spawnShot({
        from: "player",
        wpnId: parent.wpnId,
        slot: parent.slot,
        beh: {
          ...beh,
          payload: { detonate: { look: "fire" } },
          guidance: undefined,
          exhaust: cluster?.bombletExhaust,
        },
        st: {
          age: 0,
          launchAngle: a,
          bomblet: true,
          opened: true,
        },
        x: bx,
        y: by,
        z: parent.z + 6,
        vx,
        vy,
        vz,
        angle: Math.atan2(vy, vx),
        life: 2.0 + Math.random() * 0.85,
        blast: bombletBlast,
        dmg: bombletDmg,
        look: cluster?.look ?? parent.look,
        scale: (parent.scale ?? 1) * 0.42,
        fxInterval: 0.2,
      });
    }
  }

  missileIgnite(s: Shot): void {
    const beh = s.from === "player" ? s.beh : undefined;
    const g = beh?.guidance;
    const launch = beh?.launch;
    if (s.from === "player" && g && guidanceIsLockOn(g)) {
      const pitch =
        launch?.mode === "kick_motor" && launch.pitch != null ? launch.pitch : 0.92;
      const spd = Math.max(Math.hypot(s.vx, s.vy), 90);
      s.vx = Math.cos(s.angle) * spd * Math.cos(pitch);
      s.vy = Math.sin(s.angle) * spd * Math.cos(pitch);
      s.vz = spd * Math.sin(pitch);
      s.loft = g.targeting.seekDelay;
    } else if (s.from === "player" && launch?.mode === "kick_motor") {
      if (launch.softLoft != null) {
        s.vz += 180;
        s.loft = launch.softLoft;
      } else if (launch.leaveVz != null) {
        s.vz += launch.leaveVz;
      }
    }
    const sc = shotTrailScale(s);
    const small = troopMissileTrail(s);
    const n = small ? Math.max(2, Math.round(5 * sc)) : Math.max(2, Math.round(8 * sc));
    const tail = this.shotUvScreenPos(s, SHOT_TAIL.x, SHOT_TAIL.y);
    this.s.fx.withTrail(sc, () => {
      const { fire, smoke } = this.s.fx.pair(s.z, s.y, this.s.fx.burn, this.s.fx.shortTrailSmoke, ZOff.fire, ZOff.smoke);
      this.s.fx.emitBudgeted("fire", fire, tail.x, tail.y, n);
      this.s.fx.emitBudgeted("smoke", smoke, tail.x, tail.y, Math.max(1, Math.round((small ? 3 : 6) * sc)));
      if (!small) {
        this.s.fx.blastFire.setDepth(worldDepth(s.z, ZOff.fire + 0.2, s.y));
        this.s.fx.emitBudgeted("fire", this.s.fx.blastFire, tail.x, tail.y, Math.max(1, Math.round(4 * sc)));
      }
    });
    this.s.fx.emitVisualBurst(s.x, s.y, s.z, {
      n: Math.max(4, Math.round(10 * sc)),
      spdMin: 80,
      spdMax: 240,
      bx: -Math.cos(s.angle),
      by: -Math.sin(s.angle),
      bz: 0.1,
      tight: 0.55,
      scaleMul: sc,
    }, this.s.fx.muzzleBurst);
  }

  /** Sagging command wire: trail points relax toward wing→missile chord (87ea78e). */
  simulateTowWire(s: Shot, dt: number): void {
    const player = this.towWing(s.wireSide ?? 1);
    const missile = { x: s.x, y: s.y, z: s.z };
    if (!s.wire) s.wire = [];
    const trail = s.wire;
    if (trail.length === 0) {
      trail.push({ ...missile });
      return;
    }
    const last = trail[trail.length - 1]!;
    if (Math.hypot(missile.x - last.x, missile.y - last.y, missile.z - last.z) > 12) {
      trail.push({ ...missile });
    }
    const n = trail.length;
    for (let i = 0; i < n; i++) {
      const t = n <= 1 ? 1 : i / (n - 1);
      const p = trail[i]!;
      const tx = player.x + (missile.x - player.x) * t;
      const ty = player.y + (missile.y - player.y) * t;
      const tz = player.z + (missile.z - player.z) * t;
      const rate = 8 * Math.pow(1 - t, 1.35);
      const a = rate <= 0 ? 0 : 1 - Math.exp(-rate * dt);
      p.x += (tx - p.x) * a;
      p.y += (ty - p.y) * a;
      p.z += (tz - p.z) * a;
    }
    s.wireTrim = (s.wireTrim ?? 0) + dt;
    const trimEvery = 0.08;
    while ((s.wireTrim ?? 0) >= trimEvery && trail.length > 2) {
      trail.shift();
      s.wireTrim = (s.wireTrim ?? 0) - trimEvery;
    }
  }

  towWing(side: number): { x: number; y: number; z: number } {
    const mounts = craftHardpointMounts(this.s.player.spec);
    const index = mounts.length > 1 ? (side < 0 ? 0 : 1) : 0;
    const mount = mounts[index] ?? mounts[0]!;
    return { ...this.s.fireControl.hardpointWorldPos(mount), z: this.s.player.z + ZOff.shot };
  }

  deadfallShot(s: Shot): void {
    if (s.deadfall) return;
    if (shotIsGunOrBeam(s)) return;
    s.deadfall = true;
    s.homePlayer = false;
    s.targetId = undefined;
    s.seekDisabled = true;
    s.povCam = false;
    // exhaust silenced via energy/deadfall flags
    s.energyTrail = undefined;
    s.energyTrails = undefined;
    s.wire = undefined;
    s.motor = undefined;
    s.loft = 0;
    // Pitch up for air time — dump dive, loft into a short arc before freefall.
    s.vz = Math.max(0, s.vz * 0.25) + range(140, 260);
    s.yaw = s.yaw ?? (Math.random() - 0.5) * 5.5;
    if (s.st) {
      s.st.seeking = false;
      s.st.terminal = true;
      s.st.helixOff = undefined;
    }
  }

  explode(
    x: number,
    y: number,
    z: number,
    blast: number,
    dmg: number,
    direct: Unit | undefined,
    dx: number,
    dy: number,
    dz: number,
    objectHit: boolean,
    kind: ShotKind,
    impactFxScale: number,
    shot?: Shot,
    /** When true, only spray impact FX (pierce through already applied hurt). */
    fxOnly = false
  ): void {
    const markId = shot?.st?.callStrikeMarkId;
    if (markId != null) this.s.callStrike.noteImpact(markId);
    const payload = shot?.beh?.payload;
    if (payloadIsSmoke(payload)) {
      const at = worldToScreen(x, y, z);
      this.s.fx.spawnImpactFlash(at.x, at.y, z, 0xf0e0a0, 16 * at.scale, 0.35, 55);
      this.s.fx.emitVisualBurst(
        x,
        y,
        z + 2,
        {
          n: 5,
          spdMin: 18,
          spdMax: 58,
          bx: dx,
          by: dy,
          bz: Math.max(10, dz),
          tight: 0.72,
          scaleMul: 0.28,
          gravity: 150,
        },
        this.s.fx.shortBurst
      );
      this.s.camera.shake = Math.min(3.2, this.s.camera.shake + 0.45);
      if (!fxOnly) this.applyBlastDamage(x, y, z, blast, dmg, direct, dx, dy, dz, true, shot);
      return;
    }
    if (payloadIsCallStrike(payload)) {
      // Marker rest: soft pink pop only — barrage carries the damage.
      const at = worldToScreen(x, y, z);
      this.s.fx.spawnImpactFlash(at.x, at.y, z, 0xff4068, 28 * at.scale, 0.72, 140);
      this.s.fx.emitVisualBurst(
        x,
        y,
        z + 4,
        {
          n: 8,
          spdMin: 40,
          spdMax: 160,
          bx: 0,
          by: -0.55,
          bz: 1,
          tight: 0.4,
          scaleMul: 0.55,
          gravity: 80,
        },
        this.s.fx.signalFlareSpark
      );
      this.s.camera.shake = Math.min(2.8, this.s.camera.shake + 0.35);
      return;
    }
    const water = isWater(this.s.world, x, y);
    // Kinetic / beam stay ballistic; everything else uses HE blast treatment.
    const he =
      payload != null
        ? !payloadIsKinetic(payload, shot?.beh?.launch) && (shot?.beh?.launch.mode !== "beam")
        : kind !== "cannon" && kind !== "beam";
    const heBlend = he ? 0 : payloadHeBlend(payload);
    const dustMul = payloadDustMul(payload);
    const fx = hitSimParticleFx(dmg);
    const travel = Math.hypot(dx, dy, dz) || 1;
    const simParticleBx = dx;
    const simParticleBy = dy;
    const simParticleBz = he || heBlend > 0.2 ? dz : Math.max(22, dz);
    const missileBias = he ? 2.4 : heBlend > 0 ? 1.2 + heBlend * 1.2 : undefined;
    const mechGunBias = !he && objectHit && !(direct && isOrganic(direct.kind)) ? 2.1 : undefined;
    const expBias = missileBias ?? mechGunBias;
    // Soft-target blood spray is chain-gun only; rockets/missiles always use mech-style object hits.
    // Motorcycle keeps mech sparks and also gets rider blood.
    const softBloodHit = objectHit && !he && direct && hasSoftBlood(direct.kind);
    if (softBloodHit) {
      const graze = Phaser.Math.Clamp(Math.hypot(dx, dy) / travel, 0, 1);
      const distN = Phaser.Math.Clamp(Math.hypot(x - this.s.player.x, y - this.s.player.y) / 780, 0, 1);
      const acute = Math.max(graze, distN);
      this.s.fx.spawnDirtParticles(x, y, z + 3, {
        n: 22,
        spdMin: Phaser.Math.Linear(36, 200, acute * acute),
        spdMax: Phaser.Math.Linear(200, 520, acute * acute),
        bx: simParticleBx,
        by: simParticleBy,
        bz: Phaser.Math.Linear(110, 40, acute),
        tight: Phaser.Math.Linear(0.28, 0.72, acute),
        blood: true,
      });
    }
    if (objectHit) {
      // Troops: blood only. Motorcycle: blood + mech sparks. Everything else: mech sparks.
      if (!softBloodHit || !isOrganic(direct!.kind)) {
        this.s.fx.emitVisualBurst(x, y, z + 4, {
          n: scaledProjectileFxCount(
            Math.min(56, Math.round((he ? 36 : 18) * fx.n)),
            impactFxScale
          ),
          spdMin: (he ? 110 : 90) * fx.spd,
          spdMax: (he ? 480 : 340) * fx.spd,
          bx: simParticleBx,
          by: simParticleBy,
          bz: simParticleBz,
          tight: he ? 0.28 : 0.52,
          scaleMul: fx.size,
          expBias,
          gravity: 180,
        }, this.s.fx.shortBurst);
      }
    } else if (water) {
      this.s.fx.emitVisualBurst(x, y, z + 3, {
        n: Math.min(80, Math.round(20 * fx.n)),
        spdMin: 50 * fx.spd,
        spdMax: 220 * fx.spd,
        bx: simParticleBx,
        by: simParticleBy,
        bz: he ? Math.max(simParticleBz, 20) : Math.max(40, dz),
        tight: 0.48,
        scaleMul: fx.size,
        expBias: missileBias,
        gravity: 240,
      }, this.s.fx.splashBurst);
    } else {
      const graze = Phaser.Math.Clamp(Math.hypot(dx, dy) / travel, 0, 1);
      const distN = Phaser.Math.Clamp(Math.hypot(x - this.s.player.x, y - this.s.player.y) / 780, 0, 1);
      const acute = Math.max(graze, distN);
      const heDirt = he || heBlend > 0;
      if (heDirt) {
        const blend = he ? 1 : heBlend;
        const total = Math.min(
          110,
          Math.round(Phaser.Math.Linear(26, 62, blend) * fx.n * dustMul)
        );
        const baseSparkN = Math.max(1, Math.round(total * (he ? 0.02 : 0.035)));
        const sparkN = scaledProjectileFxCount(baseSparkN, impactFxScale);
        this.s.fx.spawnDirtParticles(x, y, z + 3, {
          n: Math.max(0, total - baseSparkN),
          spdMin: Phaser.Math.Linear(50, 160, acute) * fx.spd,
          spdMax: Phaser.Math.Linear(220, 420, acute) * fx.spd,
          bx: simParticleBx,
          by: simParticleBy,
          bz: Phaser.Math.Linear(Phaser.Math.Linear(90, 22, acute), simParticleBz, blend),
          tight: Phaser.Math.Linear(Phaser.Math.Linear(0.28, 0.72, acute), 0.22, blend),
          scaleMul: fx.size * Phaser.Math.Linear(1, 1.08, blend),
          expBias: missileBias,
        });
        this.s.fx.emitVisualBurst(x, y, z + 3, {
          n: sparkN,
          spdMin: Phaser.Math.Linear(50, 160, acute) * fx.spd,
          spdMax: Phaser.Math.Linear(220, 420, acute) * fx.spd,
          bx: simParticleBx, by: simParticleBy, bz: simParticleBz,
          tight: 0.22, scaleMul: fx.size * 0.42, expBias: missileBias, gravity: 180,
        }, this.s.fx.shortBurst);
      } else {
        const total = Math.min(80, Math.round(26 * fx.n * dustMul));
        const baseSparkN = Math.max(1, Math.round(total * 0.04));
        const sparkN = scaledProjectileFxCount(baseSparkN, impactFxScale);
        this.s.fx.spawnDirtParticles(x, y, z + 3, {
          n: Math.max(0, total - baseSparkN),
          spdMin: Phaser.Math.Linear(36, 200, acute * acute) * fx.spd,
          spdMax: Phaser.Math.Linear(200, 520, acute * acute) * fx.spd,
          bx: simParticleBx,
          by: simParticleBy,
          bz: Phaser.Math.Linear(90, 22, acute),
          tight: Phaser.Math.Linear(0.28, 0.72, acute),
          scaleMul: fx.size,
        });
        this.s.fx.emitVisualBurst(x, y, z + 3, {
          n: sparkN,
          spdMin: Phaser.Math.Linear(36, 200, acute * acute) * fx.spd,
          spdMax: Phaser.Math.Linear(200, 520, acute * acute) * fx.spd,
          bx: simParticleBx, by: simParticleBy, bz: Phaser.Math.Linear(90, 22, acute),
          tight: Phaser.Math.Linear(0.28, 0.72, acute), scaleMul: fx.size * 0.42, gravity: 180,
        }, this.s.fx.shortBurst);
      }
    }
    const impactAt = worldToScreen(x, y, z);
    const impactX = impactAt.x;
    const impactY = impactAt.y;
    const impactScale = impactAt.scale;
    if (he || heBlend > 0.05) {
      const detLook = shot?.beh?.payload.detonate?.look ?? shot?.beh?.payload.cluster?.bombletDetonate?.look;
      const photonic = detLook === "photonic";
      const energyHit = detLook === "energy" || photonic;
      const bomblet = !!shot?.st?.bomblet;
      const blend = he ? 1 : heBlend;
      const dropHeBomb =
        he && !bomblet && shot?.beh?.launch.mode === "drop" && payloadIsHe(shot.beh.payload);
      const bigBoom =
        dropHeBomb || !!(he && shot?.beh?.payload.detonate?.bigBoom);
      if (photonic && !fxOnly) {
        this.s.fx.emitPhotonImpactSparks(x, y, z, dx, dy, dz, blast);
      }
      if (energyHit && !photonic && !fxOnly && shot?.beh?.payload.stun) {
        const zapN = 5;
        for (let i = 0; i < zapN; i++) {
          const a = (i / zapN) * Math.PI * 2 + range(-0.25, 0.25);
          const r = blast * (0.15 + Math.random() * 0.55);
          this.s.tesla.spawnZap(x + Math.cos(a) * r, y + Math.sin(a) * r, z + range(-10, 20), range(0.6, 1.1), range(1.1, 1.9));
        }
      }
      this.s.fx.heFireBurst(
        x,
        y,
        z,
        dx,
        dy,
        dz,
        blast,
        false,
        bigBoom ? 1.18 : photonic ? 1.55 : 1,
        Phaser.Math.Clamp((blast - 8) / 170, bomblet && !bigBoom ? 0.04 : 0.16, 1) *
          blend *
          (bigBoom ? 1.12 : photonic ? 1.45 : 1),
        1,
        0,
        undefined,
        energyHit
          ? {
              spark: this.s.fx.energyStreakBurst,
              flash: photonic ? 0xe8c0ff : 0xc4ffff,
              flashMin: bomblet ? 22 : photonic ? 160 : 110,
              visMul: bomblet ? 0.32 : photonic ? 1.45 : 1,
              noFire: photonic,
              noTrails: photonic,
            }
          : he
            ? undefined
            : { visMul: 0.35 + blend * 0.45, flashMin: 28 + blend * 40 }
      );
      // Drop bombs / authored big-boom HE get the cel fireball + shockwave.
      if (bigBoom) {
        const building = !!direct && !!specOf(direct.kind).building;
        this.s.fx.spawnToonBlast(x, y, z + (building ? 10 : 4), {
          building,
          size01: Phaser.Math.Clamp((blast - 36) / 320, 0.38, 1),
          waveMul: building ? 1.22 : 1.18,
        });
        if (blast >= 120) {
          const boomZ = z + (building ? 14 : 6);
          const boomSize = Phaser.Math.Clamp((blast - 80) / 280, 0.45, 1);
          this.s.fx.emitBigBoomSparks(x, y, boomZ, boomSize, dx, dy, dz);
          this.s.fx.emitBigBoomDebris(x, y, boomZ, boomSize, dx, dy, dz);
        }
        // Own ring sized to the weapon blast — not the victim’s body radius.
        this.spawnBlastRing(x, y, z, Math.max(48, blast * 0.32), {
          expand: 3.2,
          alpha: 0.48,
          duration: 280,
        });
      }
    }
    if (!water && !objectHit) {
      if (he) {
        const raw = (blast / 72) * range(0.55, 1.05);
        this.s.groundMarks.stampBlastCrater(x, y, raw);
        if (shotWantsEmberCrater(shot, kind)) {
          this.s.groundMarks.spawnCraterEmbers(x, y, this.s.groundMarks.softCapBlastCraterScale(raw));
        }
      } else {
        this.s.fx.stampCannonScar(x, y, dx, dy, dz);
        if (heBlend > 0.25) {
          const raw = (blast / 95) * heBlend * range(0.4, 0.75);
          this.s.groundMarks.stampBlastCrater(x, y, raw, 0.55 + heBlend * 0.35);
        }
      }
    }
    if (!water) {
      this.s.fx.smoke.setDepth(worldDepth(z, 0.2, y));
      this.s.fx.emitBudgeted(
        "smoke",
        this.s.fx.smoke,
        impactX,
        impactY + 12,
        he ? (shot?.st?.bomblet ? 4 : 16) : objectHit ? 6 : Math.round(8 * Math.max(1, dustMul * 0.85 + heBlend))
      );
    }
    this.s.camera.shake = Math.min(8, this.s.camera.shake + blast * (he ? 0.055 : 0.028 + heBlend * 0.02));
    if (!he) this.s.fx.spawnImpactFlash(impactX, impactY, z, 0xffc878, 34 * impactScale, 0.85, 160);
    // HE already splashed — skip a second death splash. Chain gun should still run vehicle death splash.
    if (!fxOnly) this.applyBlastDamage(x, y, z, blast, dmg, direct, dx, dy, dz, he, shot);
  }

  /** Splash hurt to units in radius (and light heli damage when low/close). */
  applyBlastDamage(
    x: number,
    y: number,
    z: number,
    blast: number,
    dmg: number,
    direct: Unit | undefined,
    dx: number,
    dy: number,
    dz: number,
    skipDeathSplash = false,
    shot?: Shot
  ): void {
    this.pushBlastRing(x, y, z, blast);
    for (const u of this.s.units) {
      if (u.dead) continue;
      const d = distToFootprint(x, y, footprintInto(u, 0, 0));
      if (u === direct || d < blast) {
        u.killDx = dx;
        u.killDy = dy;
        u.killDz = dz;
        const fall = u === direct ? dmg : dmg * (1 - d / blast);
        const dealt = this.weaponDamageMul(shot, u, fall);
        u.killDmg = dealt;
        this.hurt(u, dealt, skipDeathSplash);
        const stunDur = shot?.beh?.payload.stun;
        if (stunDur && !u.dead) {
          const cls = heatClassOf(u);
          if (cls === "vehicle" || cls === "building") {
            stunUnit(u, stunDur);
            this.s.unitSim.spawnStunZaps(u);
          }
        }
      }
    }
    const focus = this.s.targeting.combatFocus();
    const hd = Math.hypot(focus.x - x, focus.y - y);
    if (hd < blast * 0.55) {
      if (focus === this.s.player) {
        const agl = castZ(this.s.world, this.s.player.x, this.s.player.y, this.s.player.z);
        if (this.s.countermeasures.cloakT <= 0 && agl < 30) this.s.player.damage(dmg * 0.25, dx, dy);
      } else {
        this.s.targeting.damageCombatFocus(dmg * 0.25, dx, dy);
      }
    }
    // Enemy blasts also catch autonomous remotes.
    if (shot?.from === "enemy") {
      const focusRem = this.s.targeting.combatFocusRemote();
      for (const r of this.s.remotes) {
        if (r === focusRem || !this.s.targeting.remoteTargetable(r)) continue;
        if (Math.hypot(r.x - x, r.y - y) < blast * 0.55) this.s.targeting.damageRemote(r, dmg * 0.25, dx, dy);
      }
    }
  }

  /** Stunned (EMP/Tesla) or fully smoke-blinded (player in thick smoke). */
  unitIsCombatDebuffed(u: Unit): boolean {
    if (unitStunned(u)) return true;
    return this.s.targeting.enemySmokeVision(u) <= 0;
  }

  /** Weapon-specific damage multipliers (debuff mul, class bag, …). */
  weaponDamageMul(shot: Shot | undefined, u: Unit, dmg: number): number {
    let out = dmg;
    const debuffMul = shot?.beh?.debuffDmgMul;
    if (debuffMul != null && debuffMul !== 1 && this.unitIsCombatDebuffed(u)) {
      out *= debuffMul;
    }
    const bag = shot?.beh?.dmgMul;
    if (bag) {
      const mul = bag[heatClassOf(u)];
      if (mul != null && mul !== 1) out *= mul;
    }
    return out;
  }

  pushBlastRing(x: number, y: number, z: number, blast: number): void {
    if (!this.s.overlays.blastOn || blast <= 0) return;
    this.s.overlays.blastRings.push({
      x,
      y,
      z,
      r: blast,
      heliR: blast * 0.55,
      life: 3.2,
      max: 3.2,
    });
    this.s.overlays.redrawBlastRings();
  }

  spawnBlastRing(
    x: number,
    y: number,
    z: number,
    targetRadius: number,
    opts?: { tint?: number; alpha?: number; duration?: number; expand?: number }
  ): void {
    if (targetRadius <= 0) return;
    const at = worldToScreen(x, y, z);
    const textureRadius = 64;
    const startRadius = targetRadius * at.scale;
    const endRadius = targetRadius * (opts?.expand ?? 4) * at.scale;
    const tint = opts?.tint ?? 0xffffff;
    const alpha0 = opts?.alpha ?? 0.4;
    const duration = opts?.duration ?? 220;
    const ring = this.s.add
      .image(at.x, at.y, "fx_blast_ring", 0)
      .setTint(tint)
      .setScale(startRadius / textureRadius)
      .setAlpha(alpha0)
      .setDepth(worldDepth(z, ZOff.fire + 2, y))
      .setBlendMode(Phaser.BlendModes.ADD);
    const ringLife = { t: 0 };
    this.s.tweens.add({
      targets: ringLife,
      t: 1,
      duration,
      ease: "Linear",
      onUpdate: () => {
        const t = ringLife.t;
        const expand = t >= 1 ? 1 : (1 - Math.pow(2, -14 * t)) / (1 - Math.pow(2, -14));
        const radius = Phaser.Math.Linear(startRadius, endRadius, expand);
        ring
          .setScale(radius / textureRadius)
          .setAlpha(alpha0 * (1 - t * t))
          .setFrame(Math.min(BLAST_RING_FRAMES - 1, Math.floor(t * BLAST_RING_FRAMES)));
      },
      onComplete: () => ring.destroy(),
    });
  }

  hurt(u: Unit, dmg: number, fromBlast = false): void {
    u.health -= dmg;
    if (u.health <= 0) {
      this.s.destruction.destroyUnit(u, false, fromBlast);
      return;
    }
    if (isOrganic(u.kind) && specOf(u.kind).weapon && u.health > 1) {
      u.aware = true;
      this.s.unitSim.rollSoldierMood(u, true);
    }
  }

  syncShotSprites(): void {
    while (this.shotG.getLength() < this.s.shots.length * 2) {
      this.shotG.add(this.s.add.image(0, 0, "fx_shadow"));
      this.shotG.add(this.s.add.image(0, 0, "shot_rocket"));
    }
    const kids = this.shotG.getChildren() as Phaser.GameObjects.Image[];
    for (const k of kids) k.setVisible(false);
    this.s.shots.forEach((s, i) => {
      const sh = kids[i * 2]!;
      const im = kids[i * 2 + 1]!;
      if (!cameraPointVisible(s.z, s.y)) return;
      const st = s.st;
      const key = shotLookOf(s);
      const rot = s.angle;
      let wx = s.x;
      let wy = s.y;
      let wz = s.z;
      if (st?.helixOff != null && st.helixFreq != null) {
        const wave = st.age * st.helixFreq + (st.helixPhase ?? 0);
        const lat = Math.sin(wave) * st.helixOff;
        wz += Math.cos(wave) * st.helixOff * 0.62;
        wx += -Math.sin(s.angle) * lat;
        wy += Math.cos(s.angle) * lat;
      }
      const at = worldToScreen(wx, wy, wz);
      const drawX = at.x;
      const drawY = at.y;
      if (!this.s.camera.projectedInView(drawX, drawY, 120)) return;
      const drawRot = this.shotDrawRotation(s, wx, wy, wz);
      const photon = key === "shot_photon";
      const ox = SHOT_ORIGIN.x;
      const sc = (s.scale ?? 1) * (st?.helixOff ? 1.06 : 1);
      const energy = !!(s.energyTrail || s.energyTrails);
      sh.setVisible(true).setOrigin(ox, 0.5);
      this.s.hostCraft.applyCastShadow(sh, wx, wy, wz, key, rot, sc);
      if (photon) {
        // Composite lens-flare drawn in syncPhotonFlares — body sprite stays hidden.
        return;
      }
      const zs = at.scale;
      // Foreshorten along the barrel when climbing/diving (non-zero vz).
      const horiz = Math.hypot(s.vx, s.vy);
      const pitchN = Phaser.Math.Clamp(Math.abs(s.vz) / Math.max(90, Math.hypot(horiz, s.vz)), 0, 1);
      const along = 1 - pitchN * 0.52;
      const across = 1 + pitchN * 0.06;
      const shotDepth = worldDepth(wz, 0, wy);
      im.setVisible(true);
      if (this.s.textures.exists(key) && im.texture.key !== key) im.setTexture(key);
      im.setOrigin(ox, 0.5)
        .setPosition(drawX, drawY)
        .setRotation(drawRot)
        .setScale(sc * zs * along, sc * zs * across)
        .setAlpha(1);
      const tracer = key.startsWith("shot_cannon_") || !!st?.helixOff || energy;
      if (s.tint != null) im.setTint(s.tint);
      else if (energy) im.setTint(0x9af6ff);
      else if (st?.helixOff) im.setTint(0x66ff44);
      else im.clearTint();
      im.setBlendMode(tracer ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL);
      applyThermalHeat(im, this.s.thermal.on, shotIsGunOrBeam(s) ? 0.9 : 1, s.tint);
      if (im.depth !== shotDepth) im.setDepth(shotDepth);
    });
  }

  syncPhotonFlares(): void {
    const layerN = PHOTON_FX_LAYERS;
    const have = {
      glow: this.s.textures.exists("shot_photon_glow"),
      h: this.s.textures.exists("shot_photon_stream_h"),
      diag: this.s.textures.exists("shot_photon_stream_diag"),
      core: this.s.textures.exists("shot_photon_core"),
    };
    if (!have.core) return;

    const photons: Shot[] = [];
    for (const s of this.s.shots) {
      if (shotLookOf(s) !== "shot_photon") continue;
      if (!cameraPointVisible(s.z, s.y)) continue;
      photons.push(s);
    }

    while (this.photonFxG.getLength() < photons.length * layerN) {
      const slot = this.photonFxG.getLength() % layerN;
      const tex =
        slot === 7
          ? "shot_photon_core"
          : slot === 0
            ? "shot_photon_glow"
            : slot <= 3
              ? "shot_photon_stream_h"
              : "shot_photon_stream_diag";
      const key = this.s.textures.exists(tex) ? tex : "shot_photon_core";
      this.photonFxG.add(
        this.s.add
          .image(0, 0, key)
          .setVisible(false)
          .setBlendMode(Phaser.BlendModes.ADD)
          .setOrigin(0.5, 0.5)
      );
    }

    const kids = this.photonFxG.getChildren() as Phaser.GameObjects.Image[];
    for (const k of kids) k.setVisible(false);

    const cam = this.s.cameras.main;
    const t = this.s.time.now * 0.001;
    const cx = cam.worldView.centerX;
    const cy = cam.worldView.centerY;

    photons.forEach((s, i) => {
      const at = worldToScreen(s.x, s.y, s.z);
      if (!this.s.camera.projectedInView(at.x, at.y, 140)) return;
      const sc = (s.scale ?? 1) * at.scale;
      const depth = worldDepth(s.z, ZOff.shot + 0.4, s.y);
      // Lens flare spokes: angle from camera center → light (not missile heading / mouse).
      const viewAng = Math.atan2(at.y - cy, at.x - cx);
      // Per-shot seed so each flare stack has slightly different spoke offsets.
      const seed = ((s.id ?? i) * 0.73 + i * 1.17) % (Math.PI * 2);
      const flick =
        0.78 +
        0.22 *
          (0.5 +
            0.5 *
              Math.sin(t * 13.7 + i * 2.3) *
              Math.sin(t * 8.1 + i * 1.1 + s.x * 0.01));
      const flick2 =
        0.72 +
        0.28 * (0.5 + 0.5 * Math.sin(t * 17.2 + i * 3.1) * Math.sin(t * 5.4 + i));

      const base = i * layerN;
      const glow = kids[base]!;
      const streamH0 = kids[base + 1]!;
      const streamH1 = kids[base + 2]!;
      const streamHx = kids[base + 3]!;
      const streamD0 = kids[base + 4]!;
      const streamD1 = kids[base + 5]!;
      const streamD2 = kids[base + 6]!;
      const core = kids[base + 7]!;

      const place = (
        im: Phaser.GameObjects.Image,
        tex: string,
        rot: number,
        sx: number,
        sy: number,
        alpha: number,
        zOff: number
      ) => {
        if (this.s.textures.exists(tex) && im.texture.key !== tex) im.setTexture(tex);
        im.setVisible(true)
          .setOrigin(0.5, 0.5)
          .setPosition(at.x, at.y)
          .setRotation(rot)
          .setScale(sx, sy)
          .setAlpha(alpha)
          .setBlendMode(Phaser.BlendModes.ADD)
          .setDepth(depth + zOff);
        if (s.tint != null) im.setTint(s.tint);
        else im.clearTint();
        applyThermalHeat(im, this.s.thermal.on, 1, s.tint);
      };

      // Soft bloom stays screen-aligned (never tracks missile heading).
      if (have.glow) {
        place(glow, "shot_photon_glow", 0, sc * 2.05 * flick, sc * 2.05 * flick, 0.5 * flick, -0.02);
      }
      if (have.h) {
        // Long needles — bake already collapsed fat hubs; sy mostly follows the thin strip.
        place(
          streamH0,
          "shot_photon_stream_h",
          viewAng + Math.sin(seed) * 0.06,
          sc * 3.6 * flick,
          sc * (0.95 + 0.2 * flick2),
          0.92 * flick,
          0
        );
        place(
          streamH1,
          "shot_photon_stream_h",
          viewAng + 0.11 + Math.cos(seed * 1.3) * 0.05,
          sc * 2.9 * flick2,
          sc * (0.75 + 0.15 * flick),
          0.65 * flick2,
          0.005
        );
        place(
          streamHx,
          "shot_photon_stream_h",
          viewAng + Math.PI * 0.5 + Math.sin(seed * 0.7) * 0.08,
          sc * 3.1 * flick,
          sc * (0.7 + 0.15 * flick2),
          0.72 * flick,
          0.008
        );
      }
      if (have.diag) {
        // Diag art is already a thin diagonal needle after bake — keep scale near-uniform.
        place(
          streamD0,
          "shot_photon_stream_diag",
          viewAng + Math.cos(seed) * 0.07,
          sc * 2.9 * flick2,
          sc * 2.9 * flick2,
          0.78 * flick2,
          0.01
        );
        place(
          streamD1,
          "shot_photon_stream_diag",
          viewAng + Math.PI * 0.5 + Math.sin(seed * 1.9) * 0.06,
          sc * 2.55 * flick,
          sc * 2.55 * flick,
          0.7 * flick,
          0.015
        );
        place(
          streamD2,
          "shot_photon_stream_diag",
          viewAng + 0.18 + Math.cos(seed * 0.5) * 0.09,
          sc * 2.2 * flick2,
          sc * 2.2 * flick2,
          0.58 * flick2,
          0.02
        );
      }
      // Core never rotates — fixed screen orientation.
      place(core, "shot_photon_core", 0, sc * (1.05 + 0.1 * flick), sc * (1.05 + 0.1 * flick2), 0.95 + 0.05 * flick, 0.04);
    });
  }
}
