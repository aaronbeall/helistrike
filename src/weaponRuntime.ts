import Phaser from "phaser";
import { heatClassCategory, heatClassScore, type HeatClass, type SmokeVolume, type Unit } from "./combat";
import { isAerial, isGroundVehicle, isOrganic, specOf } from "./roster";

/** Classify a unit for heat-seeker preference ordering. */
export function heatClassOf(u: Unit): HeatClass {
  if (isAerial(u.kind)) return "air";
  if (specOf(u.kind).building) return "building";
  if (isOrganic(u.kind)) return "troop";
  if (isGroundVehicle(u.kind)) return "vehicle";
  return "vehicle";
}

/** Whether a heat-seeker guidance category list accepts this unit. */
export function heatCategoryOk(
  u: Unit,
  categories: readonly ("air" | "ground" | "vehicle")[]
): boolean {
  return categories.includes(heatClassCategory(heatClassOf(u)));
}

/**
 * Aim angle within station traverse arc (relative to craft heading).
 * Cabin side left/right further restricts to that hemisphere.
 */
export function aimInStationArc(
  aimWorld: number,
  craftHeading: number,
  traverse: { center: number; arc: number; side?: "left" | "right" | "both" }
): boolean {
  const rel = Phaser.Math.Angle.Wrap(aimWorld - craftHeading);
  const center = (traverse.center * Math.PI) / 180;
  const half = ((traverse.arc * Math.PI) / 180) * 0.5;
  if (Math.abs(Phaser.Math.Angle.Wrap(rel - center)) > half) return false;
  if (traverse.side === "left") return rel > 0 || Math.abs(rel) < 1e-3;
  if (traverse.side === "right") return rel < 0 || Math.abs(rel) < 1e-3;
  return true;
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

/** True when unit→heli line of sight intersects a smoke volume. */
export function smokeBlocksLos(
  volumes: readonly SmokeVolume[],
  ax: number,
  ay: number,
  bx: number,
  by: number
): boolean {
  for (const s of volumes) {
    if (s.t <= 0) continue;
    if (distPointToSegment(s.x, s.y, ax, ay, bx, by) <= s.radius) return true;
  }
  return false;
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
