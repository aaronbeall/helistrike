import type { DoodadKind } from "../worldgen/world";

/** decor = printed into the terrain; foliage = a live object (cover, destructible). */
export type DoodadLayer = "decor" | "foliage";

/** A doodad kind's layer; foliage also has a top height (× its size, capped at FOLIAGE_TOP_MAX) and health. */
export interface DoodadSpec {
  layer: DoodadLayer;
  height: number;
  health: number;
}

/** Tallest foliage top above the ground (z): always over a troop, sometimes a vehicle, never a cruising heli. */
export const FOLIAGE_TOP_MAX = 24;

const TREE: DoodadSpec = { layer: "foliage", height: 0.55, health: 70 };
const BUSH: DoodadSpec = { layer: "foliage", height: 0.35, health: 15 };
const CACTUS: DoodadSpec = { layer: "foliage", height: 0.5, health: 30 };
const DECOR: DoodadSpec = { layer: "decor", height: 0, health: 0 };

export const DOODAD_SPECS: Record<DoodadKind, DoodadSpec> = {
  tree: TREE,
  pine: TREE,
  palm: TREE,
  tree_amber: TREE,
  tree_red: TREE,
  tree_gold: TREE,
  tree_olive: TREE,
  tree_swamp: TREE,
  tree_ash: TREE,
  tree_teal: TREE,
  tree_violet: TREE,
  tree_magenta: TREE,
  bush: BUSH,
  shrub: BUSH,
  bush_rust: BUSH,
  bush_dry: BUSH,
  bush_swamp: BUSH,
  bush_magenta: BUSH,
  cactus: CACTUS,
  cactus2: CACTUS,
  dead: DECOR,
  reed: DECOR,
  rock: DECOR,
  boulder: DECOR,
  snowrock: DECOR,
};
