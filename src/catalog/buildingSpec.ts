/** Shared building / civilian-boat spec builders for the enemy and settlement rosters. */
import type { UnitSpec } from "../sim/roster";

/** Building spec: art `building_<art>` (+ `_hulk`), box in world units. Civilian (neutral) unless `extra` says otherwise. */
export const building = (
  art: string,
  label: string,
  health: number,
  halfW: number,
  halfL: number,
  height: number,
  extra: Partial<UnitSpec> = {}
): UnitSpec => ({
  label,
  health,
  radius: Math.round(Math.max(halfW, halfL) * 0.85),
  box: { halfW, halfL },
  height,
  texture: `building_${art}`,
  hulk: `building_${art}_hulk`,
  debris: "struct",
  rotOff: Math.PI / 2,
  behavior: "static_hold",
  building: true,
  neutral: true,
  deathFx: "collapse",
  guns: [],
  rotors: [],
  ...extra,
});

/** Building with a circular footprint (no box). */
export const roundBuilding = (art: string, label: string, health: number, radius: number, height: number, extra: Partial<UnitSpec> = {}): UnitSpec => ({
  ...building(art, label, health, radius, radius, height),
  box: undefined,
  radius,
  ...extra,
});

/** Civilian boat spec: art `civilian_<art>` (+ `_hulk`); sinks when destroyed. */
export const civilianBoat = (art: string, label: string, health: number, halfW: number, halfL: number, height: number): UnitSpec => ({
  ...building(art, label, health, halfW, halfL, height, { ...WET, building: false, deathFx: undefined, debris: "mech" }),
  texture: `civilian_${art}`,
  hulk: `civilian_${art}_hulk`,
});

/** Patrol / civilian boat movement on water. */
export const WET: Partial<UnitSpec> = { behavior: "patrol_boat", water: true, noCrater: true };
/** Military site building: hostile, with hardened-building toughness. */
export const MILITARY: Partial<UnitSpec> = { neutral: false, deathFx: undefined };
/** Sea structure: normal building death, wreck stays at the surface. */
export const OFFSHORE: Partial<UnitSpec> = { water: true, noCrater: true };
