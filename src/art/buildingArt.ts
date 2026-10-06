/** Art for every building + civilian boat, keyed by texture; one bake rule for all (`bakeBuildings`, sprites.ts). */

/** A cell of a sprite sheet (row-major), with an optional matching hulk sheet. */
export interface SheetCell {
  file: string;
  hulk?: string;
  cols: number;
  rows: number;
  cell: number;
}

/** Texture key of a building or civilian-boat art entry. */
export type BuildingArtKey = `building_${string}` | `civilian_${string}`;

export interface BuildingArtSpec {
  /** Live art (path under public/); or `sheet` / `crop`. */
  file?: string;
  /** Authored hulk at the live art's pixel scale (same canvas, or evenly padded for spilled debris); centered on it. */
  hulk?: string;
  sheet?: SheetCell;
  /** Slice `x0`–`x1` (fractions of width) of another entry's art and hulk. */
  crop?: { from: BuildingArtKey; x0: number; x1: number };
  /** Magenta background keyed out. */
  magenta?: boolean;
  /** Crop to content (4px pad) before scaling. */
  trim?: boolean;
  /** Hulk drawn at another scale or shape: stretch it over the live art's bounds instead of matching its pixel scale. */
  hulkFit?: "fill";
  /** Source long axis runs along +x; rotated long-axis-up like the unit footprint. */
  landscape?: boolean;
  /** World length of the long side. Default: the footprint's long side of the unit using this texture. */
  len?: number;
}

const B = "sprites/buildings/building_";
const STRUCTURES: SheetCell = { file: `${B}structures.png`, hulk: `${B}structures_hulk.png`, cols: 2, rows: 2, cell: 0 };
/** Settlement art: landscape, long axis = footprint length. */
const town = (kind: string, hulk = true): BuildingArtSpec => ({
  file: `${B}${kind}.png`,
  ...(hulk ? { hulk: `${B}${kind}_hulk.png` } : {}),
  landscape: true,
});
/** Enemy roster art: magenta-keyed, upright, sized in world units. */
const roster = (kind: string, len: number, trim = true): BuildingArtSpec => ({
  file: `${B}${kind}.png`,
  hulk: `${B}${kind}_hulk.png`,
  magenta: true,
  trim,
  len,
});
const cell = (i: number, len: number): BuildingArtSpec => ({ sheet: { ...STRUCTURES, cell: i }, magenta: true, len });

export const BUILDING_ART: Record<BuildingArtKey, BuildingArtSpec> = {
  building_bunker: roster("bunker", 128),
  building_tower: roster("tower", 78),
  building_radar: roster("radar", 220),
  building_barn: cell(0, 86),
  building_tent: cell(1, 64),
  building_fob: cell(2, 128),
  building_lookout: cell(3, 70),
  building_house: town("house"),
  building_warehouse: town("warehouse"),
  building_hangar: town("hangar"),
  building_control_tower: town("control_tower"),
  building_dock_shed: town("dock_shed"),
  building_dock_building: town("dock_building"),
  building_pier: town("pier", false),
  building_power_station: town("power_station"),
  building_oil_rig: town("oil_rig"),
  building_heli_platform: town("heli_platform"),
  building_silo: town("silo"),
  building_silo_single: { crop: { from: "building_silo", x0: 0, x1: 0.48 }, landscape: true },
  building_bridge: { ...town("bridge"), hulkFit: "fill" },
  building_bridge_steel: town("bridge_steel"),
  building_pylon: town("pylon"),
  building_pylon_base: { ...town("pylon_base"), len: 28 },
  civilian_fishing_boat: { file: "sprites/units/civilian_fishing_boat.png", hulk: "sprites/units/civilian_fishing_boat_hulk.png", landscape: true },
  civilian_yacht: { file: "sprites/units/civilian_yacht.png", hulk: "sprites/units/civilian_yacht_hulk.png", landscape: true },
};
