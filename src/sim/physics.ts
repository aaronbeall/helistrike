import Phaser from "phaser";
import type { Debris, Unit } from "./combat";
import { groundSlope, type WorldData } from "../worldgen/world";

/** Mech death FX bias: shot vel × (killDmg/maxHp) boost + unit velocity. */
export function deathBurstImpulse(u: Unit): { dx: number; dy: number; dz: number; power: number } {
  // Finishing blow relative to toughness — chain-gun chip on a bunker ≈ 0; same shot on a jeep ≈ 1+.
  const dmgScale = Phaser.Math.Clamp((u.killDmg ?? 0) / Math.max(1, u.max), 0, 1.5);
  // Stronger kill-impact pull than unit coasting.
  const shotPush = dmgScale * 2.4;
  const dx = (u.killDx ?? 0) * shotPush + u.vx;
  const dy = (u.killDy ?? 0) * shotPush + u.vy;
  const dz = (u.killDz ?? 0) * shotPush + 48;
  const impact = Math.hypot(dx, dy, dz);
  if (impact < 24) return { dx: 0, dy: 0, dz: 1, power: 0.55 };
  const power = Phaser.Math.Clamp(impact / 340, 0.55, 2.4);
  return { dx, dy, dz, power };
}

/**
 * Spring whip — lags base accel / yaw, overshoots rest on stop, then settles.
 * `faceAng` is the heading the rest tip leans aft of (turret aim or hull yaw).
 */
export function tickWhipAntenna(
  tip:
    | {
        x: number;
        y: number;
        z: number;
        vx: number;
        vy: number;
        vz: number;
        bx: number;
        by: number;
        bz: number;
        bvx: number;
        bvy: number;
        angle: number;
      }
    | undefined,
  base: { x: number; y: number; z: number },
  faceAng: number,
  cfg: {
    length?: number;
    aft?: number;
    stiffness?: number;
    damping?: number;
    yawWhip?: number;
    lag?: number;
  },
  dt: number
): NonNullable<typeof tip> {
  const rest = whipAntennaRest(base, faceAng, cfg);
  if (!tip) {
    return {
      x: rest.x,
      y: rest.y,
      z: rest.z,
      vx: 0,
      vy: 0,
      vz: 0,
      bx: base.x,
      by: base.y,
      bz: base.z,
      bvx: 0,
      bvy: 0,
      angle: faceAng,
    };
  }
  const invDt = 1 / Math.max(1e-4, dt);
  const bvx = (base.x - tip.bx) * invDt;
  const bvy = (base.y - tip.by) * invDt;
  const ax = (bvx - tip.bvx) * invDt;
  const ay = (bvy - tip.bvy) * invDt;
  const omega = Phaser.Math.Angle.Wrap(faceAng - tip.angle) * invDt;

  const k = cfg.stiffness ?? 26;
  const c = cfg.damping ?? 2.4;
  const lag = cfg.lag ?? 1.6;
  const whip = cfg.yawWhip ?? 12;
  const len = cfg.length ?? 12;

  tip.vx += ((rest.x - tip.x) * k - tip.vx * c) * dt;
  tip.vy += ((rest.y - tip.y) * k - tip.vy * c) * dt;
  tip.vz += ((rest.z - tip.z) * k - tip.vz * c) * dt;
  tip.vx -= ax * lag * dt;
  tip.vy -= ay * lag * dt;
  tip.vx += -Math.sin(faceAng) * omega * whip * len * dt;
  tip.vy += Math.cos(faceAng) * omega * whip * len * dt;

  tip.x += tip.vx * dt;
  tip.y += tip.vy * dt;
  tip.z += tip.vz * dt;

  {
    const dx = tip.x - base.x;
    const dy = tip.y - base.y;
    const dz = tip.z - base.z;
    const span = Math.hypot(dx, dy, dz);
    const maxLen = len * 1.28;
    if (span > maxLen && span > 1e-4) {
      const s = maxLen / span;
      tip.x = base.x + dx * s;
      tip.y = base.y + dy * s;
      tip.z = base.z + dz * s;
      const rv = tip.vx * dx + tip.vy * dy + tip.vz * dz;
      if (rv > 0) {
        const inv = 1 / (span * span);
        tip.vx -= dx * rv * inv;
        tip.vy -= dy * rv * inv;
        tip.vz -= dz * rv * inv;
      }
    }
  }

  tip.bx = base.x;
  tip.by = base.y;
  tip.bz = base.z;
  tip.bvx = bvx;
  tip.bvy = bvy;
  tip.angle = faceAng;
  return tip;
}

export function whipAntennaRest(
  base: { x: number; y: number; z: number },
  faceAng: number,
  cfg: { length?: number; aft?: number }
): { x: number; y: number; z: number } {
  const len = cfg.length ?? 12;
  const aft = cfg.aft ?? 2;
  return {
    x: base.x - Math.cos(faceAng) * aft,
    y: base.y - Math.sin(faceAng) * aft,
    z: base.z + len,
  };
}

/**
 * Reflect debris off the height-map slope (same field as wheel roll / rivers).
 * strength 1 = full wheel bounce; ~0.3 nudges trajectory without redirecting it.
 */
export function bounceDebrisSlope(world: WorldData, f: Debris, strength: number): void {
  const s = Phaser.Math.Clamp(strength, 0, 1);
  const sl = groundSlope(world, f.x, f.y);
  let nx = -sl.dx;
  let ny = -sl.dy;
  let nz = 1;
  const nlen = Math.hypot(nx, ny, nz) || 1;
  nx /= nlen;
  ny /= nlen;
  nz /= nlen;
  const vin = f.vx * nx + f.vy * ny + f.vz * nz;
  const e = Phaser.Math.Linear(0.14, 0.42, s);
  if (vin < 0) {
    // Scale the horizontal part of the kick down at low strength so path barely turns.
    const kick = (1 + e) * vin;
    const hMul = Phaser.Math.Linear(0.28, 1, s);
    f.vx -= kick * nx * hMul;
    f.vy -= kick * ny * hMul;
    f.vz -= kick * nz;
  } else {
    f.vz = -f.vz * e;
  }
  const fric = Phaser.Math.Linear(0.68, 0.78, s);
  f.vx *= fric;
  f.vy *= fric;
  f.vz *= Phaser.Math.Linear(0.88, 0.92, s);
  const steep = Math.hypot(sl.dx, sl.dy);
  if (steep > 1e-4) {
    const dx = -sl.dx / steep;
    const dy = -sl.dy / steep;
    const shove =
      Math.min(140, 38 + steep * 900) *
      Phaser.Math.Clamp(-f.vz / 220, 0.35, 1.2) *
      Phaser.Math.Linear(0.18, 1, s);
    f.vx += dx * shove;
    f.vy += dy * shove;
  }
}
