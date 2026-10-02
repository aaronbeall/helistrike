import type { PlayerWpnSpec, Shot } from "./combat";
import { craftBombDrop, craftOf, type CraftBombDrop } from "./crafts";
import { groundZ, type WorldData } from "../worldgen/world";
import { shotIsGunOrBeam } from "../render/spritePose";
import { launchGravity } from "./weaponRuntime";
import { type RemoteCraft } from "./remote";
import { range } from "../util/rng";
/** Projectile flight maths: missile steering, motor speed, guided flight step. */
import Phaser from "phaser";
import { norm3 } from "../util/vec";

/** Shared rail / kick-motor / Hydra boost cruise ramp for powered player shots. */
export function motorizedSpeed(s: Shot, beh: NonNullable<Shot["beh"]>, dt: number): number {
  const cur = Math.hypot(s.vx, s.vy, s.vz);
  if (beh.launch.mode === "kick_motor" && beh.launch.acceleration === 0) {
    s.cruise = beh.cruiseSpeed;
    return beh.cruiseSpeed;
  }
  const launch = beh.launch;
  if (launch.mode === "muzzle" && launch.acceleration != null) {
    const burnT = launch.burnTime;
    const age = s.st?.age ?? 0;
    // Boost-then-coast rockets: hold speed after motor burnout.
    if (burnT != null && age >= burnT) {
      s.cruise = beh.cruiseSpeed;
      return cur;
    }
    const spd = Math.min(beh.cruiseSpeed * 1.05, cur + launch.acceleration * dt);
    s.cruise = beh.cruiseSpeed;
    return spd;
  }
  if (launch.mode === "kick_motor" && s.motor != null) {
    const burn = s.motor;
    const accel =
      launch.acceleration +
      Phaser.Math.Clamp(burn, 0, launch.burnTime) * 0.35 * launch.acceleration;
    const spd = Math.min(beh.cruiseSpeed * 1.15, cur + accel * dt);
    s.cruise = beh.cruiseSpeed;
    return spd;
  }
  const cruise = s.cruise ?? beh.cruiseSpeed;
  const spd = Math.min(cruise * 1.08, Math.max(cur, cruise * 0.72) + 140 * dt);
  s.cruise = cruise;
  return spd;
}

/** 3D steer toward a unit home vector, then fly at `spd`. */
export function flyMissile(
  s: Shot,
  home: { x: number; y: number; z: number },
  turn: number,
  spd: number,
  opts?: { noseZ?: number; slowThresh?: number }
): void {
  const noseZ = opts?.noseZ ?? 0.2;
  const slowThresh = opts?.slowThresh ?? 40;
  const cur = Math.hypot(s.vx, s.vy, s.vz);
  const dir0 =
    cur < slowThresh
      ? { x: Math.cos(s.angle), y: Math.sin(s.angle), z: noseZ }
      : { x: s.vx, y: s.vy, z: s.vz };
  const d = steerDir(dir0.x, dir0.y, dir0.z, home.x, home.y, home.z, turn);
  s.angle = Math.atan2(d.y, d.x);
  s.vx = d.x * spd;
  s.vy = d.y * spd;
  s.vz = d.z * spd;
}

export function steerDir(
  cx: number,
  cy: number,
  cz: number,
  wx: number,
  wy: number,
  wz: number,
  maxAng: number
): { x: number; y: number; z: number } {
  const c = norm3(cx, cy, cz);
  let w = norm3(wx, wy, wz);
  const dot = Phaser.Math.Clamp(c.x * w.x + c.y * w.y + c.z * w.z, -1, 1);
  const ang = Math.acos(dot);
  if (ang < 1e-5 || ang <= maxAng) return w;
  if (dot < -0.999) w = norm3(-c.y, c.x, 0);
  const t = maxAng / Math.max(ang, 1e-5);
  return norm3(c.x + (w.x - c.x) * t, c.y + (w.y - c.y) * t, c.z + (w.z - c.z) * t);
}

/** Bomb release from a remote hull — same loft search as player craft. */
export function remoteBombReleaseVelocity(world: WorldData, 
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
  return bombReleaseFrom(world, spec, ox, oy, aim, 0, {
    vx: drone.vx,
    vy: drone.vy,
    vz: drone.vz ?? 0,
    z0: drone.z + drone.spec.height * 0.4,
    angle: drone.angle,
    tune,
  });
}

/**
 * Sample altitude after `t` seconds under the same gravity model as flight
 * (`vz -= g*dt`, clamp to `-terminalVelocity`).
 */
export function sampleBallisticAltitude(
  z0: number,
  vz0: number,
  t: number,
  grav: number,
  term: number
): number {
  let z = z0;
  let vz = vz0;
  let left = Math.max(0, t);
  const step = 1 / 60;
  while (left > 1e-4) {
    const dt = Math.min(step, left);
    vz = Math.max(-term, vz - grav * dt);
    z += vz * dt;
    left -= dt;
  }
  return z;
}

/** Shared bomb release solver for host and remote hulls. */
export function bombReleaseFrom(world: WorldData, 
  spec: PlayerWpnSpec,
  ox: number,
  oy: number,
  aim: { x: number; y: number },
  yawOff: number,
  kin: {
    vx: number;
    vy: number;
    vz: number;
    z0: number;
    angle: number;
    tune: CraftBombDrop;
    /** When set (gun-mounted lob), boost only along this world heading. */
    barrelHeading?: number;
  }
): { vx: number; vy: number; vz: number; angle: number } {
  const grav = launchGravity(spec.launch)?.acceleration ?? 210;
  const term = launchGravity(spec.launch)?.terminalVelocity ?? 520;
  const { tune } = kin;
  const baseVx = kin.vx * tune.momentum;
  const baseVy = kin.vy * tune.momentum;
  const barrel = kin.barrelHeading;
  const bc = barrel != null ? Math.cos(barrel) : 0;
  const bs = barrel != null ? Math.sin(barrel) : 0;
  // Gun lob: aim is projected onto the barrel ray (range only); free drop keeps full XY.
  let wantDx = aim.x - ox;
  let wantDy = aim.y - oy;
  if (barrel != null) {
    const along = Math.max(12, wantDx * bc + wantDy * bs);
    wantDx = bc * along;
    wantDy = bs * along;
  }
  const landAimX = ox + wantDx;
  const landAimY = oy + wantDy;
  const gnd = groundZ(world, landAimX, landAimY);
  const aimAng =
    Math.hypot(wantDx, wantDy) > 1e-3
      ? Math.atan2(wantDy, wantDx)
      : kin.angle + yawOff;

  const loftLo = tune.loft;
  const loftHi = Math.max(loftLo, tune.loftMax ?? loftLo);
  let best: {
    vx: number;
    vy: number;
    vz: number;
    miss: number;
    loft: number;
  } | null = null;

  for (let i = 0; i < 9; i++) {
    const loft = loftLo + ((loftHi - loftLo) * i) / 8;
    const vz = Math.max(0, kin.vz) + loft;
    const fallT = estimateBombFallTime(kin.z0, vz, gnd, grav, term);
    const wantVx = wantDx / fallT;
    const wantVy = wantDy / fallT;
    let bx = wantVx - baseVx;
    let by = wantVy - baseVy;
    if (barrel != null) {
      // Impulse only along the barrel — never invent a sideways throw.
      let boost = bx * bc + by * bs;
      // Same as free drop: never brake along-track.
      if (boost < 0) boost = 0;
      if (boost > tune.maxBoost) boost = tune.maxBoost;
      bx = bc * boost;
      by = bs * boost;
    } else {
      const bMag = Math.hypot(bx, by);
      if (bMag > tune.maxBoost && bMag > 1e-6) {
        const s = tune.maxBoost / bMag;
        bx *= s;
        by *= s;
      }
    }
    const vx = baseVx + bx;
    const vy = baseVy + by;
    const landX = ox + vx * fallT;
    const landY = oy + vy * fallT;
    const miss = Math.hypot(landX - landAimX, landY - landAimY);
    if (
      !best ||
      miss < best.miss - 5 ||
      (miss <= best.miss + 16 && loft > best.loft)
    ) {
      best = { vx, vy, vz, miss, loft };
    }
    if (miss < 10) break;
  }

  const pick = best!;
  return {
    vx: pick.vx,
    vy: pick.vy,
    vz: pick.vz,
    angle:
      barrel != null
        ? barrel
        : Math.hypot(pick.vx, pick.vy) > 1e-3
          ? Math.atan2(pick.vy, pick.vx)
          : aimAng,
  };
}

/** Lofted hop that lands near `ax,ay` within spray speed budget; null if unreachable. */
export function starstreakBombletArc(
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
    const fallT = estimateBombFallTime(oz, loft, gnd, grav, term);
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

export function deadfallShot(s: Shot): void {
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

/** Approximate time for a gravity bomb to reach ground from release. */
export function estimateBombFallTime(
  z0: number,
  vz0: number,
  gnd: number,
  grav: number,
  term: number
): number {
  let z = z0;
  let vz = vz0;
  let t = 0;
  const step = 1 / 30;
  for (let i = 0; i < 120; i++) {
    vz = Math.max(-term, vz - grav * step);
    z += vz * step;
    t += step;
    if (z <= gnd + 4) return Math.max(0.2, t);
  }
  return Math.max(0.2, t);
}
