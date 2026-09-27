import Phaser from "phaser";
import { heatClassCategory, heatClassScore, type HeatClass, type SmokePuff, type Unit } from "./combat";
import { isAerial, isGroundVehicle, isOrganic, specOf } from "./roster";

/** Classify a unit for heat-seeker preference ordering. */
export function heatClassOf(u: Unit): HeatClass {
  if (isAerial(u.kind)) return "air";
  if (specOf(u.kind).building) return "building";
  if (isOrganic(u.kind)) return "troop";
  if (isGroundVehicle(u.kind)) return "vehicle";
  return "vehicle";
}

/**
 * AI gun-aim precision: jitter spread narrows from `wide` toward `tight` (eased) as `holdT`
 * (seconds continuously tracking the same target) approaches `narrowTime`.
 */
export function aimPrecisionSpread(holdT: number, narrowTime: number, wide: number, tight: number): number {
  const t = Phaser.Math.Clamp(narrowTime > 0 ? holdT / narrowTime : 1, 0, 1);
  return Phaser.Math.Linear(wide, tight, t * t);
}

/** Seconds of narrow-time for gun-aim precision, scaled by a craft's awareness mul (harder to spot narrows slower). */
export function aimNarrowTime(base: number, awareMul: number): number {
  return base / Math.max(0.05, awareMul);
}

/** Seconds required to charge missile lock, scaled by a craft's seeker mul (harder to lock takes longer). */
export function lockAcquireTime(base: number, seekerMul: number): number {
  return base / Math.max(0.05, seekerMul);
}

/** 0..1 progress toward a hold-time threshold (aim narrowing or lock charge), for debug/HUD display. */
export function holdProgress(holdT: number, requiredT: number): number {
  return requiredT > 0 ? Phaser.Math.Clamp(holdT / requiredT, 0, 1) : 1;
}

/** Accumulate aim-hold time while still tracking the same target; reset to 0 the instant tracking breaks. */
export function advanceAimHold(prevT: number, dt: number, continueHolding: boolean): number {
  return continueHolding ? prevT + dt : 0;
}

/** Whether a lock acquire category list accepts this unit. */
export function heatCategoryOk(
  u: Unit,
  categories: readonly ("air" | "ground" | "vehicle")[]
): boolean {
  return categories.includes(heatClassCategory(heatClassOf(u)));
}

export type StationTraverse = {
  /** Cone width in degrees. */
  arc: number;
  /** Cone center in degrees off craft nose (from socket/mount heading). */
  center: number;
};

/**
 * Aim angle within socket traverse arc (relative to craft heading).
 * Cone is ±arc/2 around `traverse.center`.
 */
export function aimInStationArc(
  aimWorld: number,
  craftHeading: number,
  traverse: StationTraverse
): boolean {
  const rel = Phaser.Math.Angle.Wrap(aimWorld - craftHeading);
  const center = (traverse.center * Math.PI) / 180;
  const half = ((traverse.arc * Math.PI) / 180) * 0.5;
  return Math.abs(Phaser.Math.Angle.Wrap(rel - center)) <= half;
}

/** Snap an aim bearing into a station traverse cone. */
export function clampAimToStationArc(
  aimWorld: number,
  craftHeading: number,
  traverse: StationTraverse
): number {
  const rel = Phaser.Math.Angle.Wrap(aimWorld - craftHeading);
  const center = (traverse.center * Math.PI) / 180;
  const half = ((traverse.arc * Math.PI) / 180) * 0.5;
  const err = Phaser.Math.Angle.Wrap(rel - center);
  const clamped = center + Phaser.Math.Clamp(err, -half, half);
  return Phaser.Math.Angle.Wrap(craftHeading + clamped);
}

/** Closest distance from point P to segment AB. */
export function distPointToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const ab2 = abx * abx + aby * aby;
  if (ab2 < 1e-8) return Math.hypot(apx, apy);
  const t = Phaser.Math.Clamp((apx * abx + apy * aby) / ab2, 0, 1);
  return Math.hypot(apx - abx * t, apy - aby * t);
}

/** How many live screen-smoke actors overlap a point (optional unit-radius pad). */
export function smokeCoverAt(
  puffs: readonly SmokePuff[],
  x: number,
  y: number,
  pad = 0
): number {
  let n = 0;
  for (const p of puffs) {
    if (p.t <= 0) continue;
    if (Math.hypot(p.x - x, p.y - y) <= p.radius + pad) n++;
  }
  return n;
}

/** 1 = full vision, 0 = cannot see. Saturates at a few overlapping puffs. */
export function smokeVisionMul(cover: number, saturate = 3): number {
  if (cover <= 0) return 1;
  return Phaser.Math.Clamp(1 - cover / saturate, 0, 1);
}

/** Heat-seeker score: prefer class, then health, then closer aim angle. */
export function heatSeekScore(
  u: Unit,
  aimAng: number,
  craftHeading: number
): number {
  const classN = heatClassScore(heatClassOf(u));
  const off = Math.abs(Phaser.Math.Angle.Wrap(aimAng - craftHeading));
  return classN * 1e6 + u.max * 10 - off * 40;
}
