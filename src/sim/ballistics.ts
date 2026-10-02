/** Projectile flight maths: missile steering, motor speed, guided flight step. */
import Phaser from "phaser";
import { norm3 } from "../util/vec";
import { type Shot } from "./combat";

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
