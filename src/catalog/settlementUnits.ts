/** Settlement roster: civilian buildings and boats placed by the settlement generator. */
import type { UnitKind, UnitSpec } from "../sim/roster";
import { building, civilianBoat, OFFSHORE } from "./buildingSpec";

export const SETTLEMENT_UNITS = {
  house: building("house", "HOUSE", 36, 22, 30, 22),
  warehouse: building("warehouse", "WAREHOUSE", 70, 32, 44, 30),
  dock_shed: building("dock_shed", "DOCK SHED", 64, 31, 45, 26),
  // Pylon height just under heli cruise AGL (46): cruise clears, ground-hugging risks the wires.
  pylon: building("pylon", "POWER PYLON", 40, 10, 46, 38, {
    texture: "building_pylon_base",
    hulk: "building_pylon_base_hulk",
    deathFx: "zap",
    wreckScale: 0.45,
    debris: "mech",
    // Popped top: the bent, broken cross-arm wreck art.
    roof: { tex: "building_pylon", hulk: "building_pylon_hulk" }
  }),
  // Bridge deck segment: the deck is a roof `height` above the unit base (spawned at deck level - height).
  // Normal building death; its wreck stays at deck height (no sinking).
  bridge: building("bridge", "BRIDGE", 60, 9, 31, 6, {
    deck: true,
    breakApart: true,
    wreckJitter: 0.22,
    water: true,
    noCrater: true,
    roof: { tex: "building_bridge", noBody: true }
  }),
  // Two-lane steel span on paved roads: wider and tougher than the plank bridge.
  // Twice the plank bridge's width; length keeps the art's aspect (two truss panels per segment).
  bridge_steel: building("bridge_steel", "STEEL BRIDGE", 110, 18, 64, 6, {
    deck: true,
    breakApart: true,
    wreckJitter: 0.18,
    water: true,
    noCrater: true,
    debris: "mech",
    roof: { tex: "building_bridge_steel", noBody: true }
  }),
  // Pier deck: roof just above the water, like a bridge segment.
  pier: building("pier", "PIER", 50, 8, 47, 5, {
    deck: true,
    breakApart: true,
    water: true,
    noCrater: true,
    roof: { tex: "building_pier", noBody: true }
  }),
  power_station: building("power_station", "POWER STATION", 90, 22, 40, 28, { deathFx: "sparks", debris: "mech" }),
  silo: building("silo", "GRAIN SILOS", 50, 24, 49.5, 70, { debris: "mech" }),
  silo_single: building("silo_single", "GRAIN SILO", 36, 22, 22, 70, { debris: "mech" }),
  oil_rig: building("oil_rig", "OIL RIG", 150, 88, 118, 90, { ...OFFSHORE, deathFx: "inferno", debris: "mech" }),
  heli_platform: building("heli_platform", "HELI PLATFORM", 220, 42, 48, 40, { ...OFFSHORE, debris: "mech" }),
  dock_building: building("dock_building", "DOCK HOUSE", 50, 30, 50, 26, OFFSHORE),
  fishing_boat: civilianBoat("fishing_boat", "FISHING BOAT", 24, 10, 32, 14),
  yacht: civilianBoat("yacht", "YACHT", 24, 10, 36, 12),
} satisfies Partial<Record<UnitKind, UnitSpec>>;
