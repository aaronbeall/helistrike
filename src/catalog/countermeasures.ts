/** Countermeasure catalog. */
import type { CountermeasureSpec } from "../sim/combat";

export const COUNTERMEASURES_DEFS = {
  flares: {
    id: "flares", name: "FLARES", duration: 12, cooldown: 8,
    description: "Blazing decoy flares that bloom behind the airframe, luring heat-seeking missiles off into the burning sky.",
  },
  timewarp: {
    id: "timewarp", name: "TIMEWARP", duration: 14, cooldown: 6,
    description: "An experimental chrono-drive that bends time around the airframe, leaving the battlefield crawling while the craft slips through it.",
  },
  phase_cloak: {
    id: "phase_cloak", name: "PHASE CLOAK", duration: 5.5, cooldown: 16,
    description: "A phase-shift field that knocks the craft half out of reality, letting incoming fire pass straight through the shimmer.",
  },
  emp: {
    id: "emp", name: "EMP", duration: 4, cooldown: 11,
    description: "A focused electromagnetic pulse that fries nearby electronics, stalling war machines and swatting missiles out of the air.",
  },
  reactive_armor: {
    id: "reactive_armor", name: "REACTIVE ARMOR", duration: 6, cooldown: 10,
    description: "Explosive reactive plating that detonates outward against incoming blasts, shrugging off hits that would gut a bare hull.",
  },
  smoke_screen: {
    id: "smoke_screen", name: "SMOKE SCREEN", duration: 8, cooldown: 12,
    description: "Rapid-fire smoke dischargers that wrap the vehicle in a thick, blinding cloud and break the enemy's line of fire.",
  },
} satisfies Record<string, CountermeasureSpec>;

/** Countermeasure identity — literal union of COUNTERMEASURES keys. */
export type CountermeasureId = keyof typeof COUNTERMEASURES_DEFS;

export const COUNTERMEASURES: Record<CountermeasureId, CountermeasureSpec> = COUNTERMEASURES_DEFS;
