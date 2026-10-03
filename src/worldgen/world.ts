import { fbm } from "./noise";
import { baseHeight, makeShape, type MapShape, type ShapeField } from "./shape";
import { applyDunes, applyLandforms, type Landforms } from "./landforms";
import { lookColor, themedTiles, themeOf, waterBandLooks, type TerrainTheme, type ThemeSpec } from "./theme";
import { Rng } from "../util/rng";
import { pickTroop, type UnitKind } from "../sim/roster";
import { UNIT_SPECS } from "../catalog/units";
import { drawBridgeStamp, drawRoadStamp } from "../art/artGen";

export const WORLD = 5600;
export const TEX = 1800;
export const SCALE = WORLD / TEX;
export const WRECK_TEX = 4096;

export type Biome = "water" | "river" | "sand" | "grass" | "forest" | "rock" | "peak";

export type HvKind = "bunker" | "radar" | "tower" | "fob" | "lookout" | "officer";

export interface HvSpec {
  id: string;
  name: string;
  kind: HvKind;
  x: number;
  y: number;
}

export interface Spawn {
  kind: UnitKind;
  x: number;
  y: number;
  hv?: string;
}

export type DecorKind =
  | "tree"
  | "pine"
  | "palm"
  | "cactus"
  | "cactus2"
  | "bush"
  | "shrub"
  | "rock"
  | "boulder"
  | "reed"
  | "dead"
  | "snowrock";

export function doodadTex(kind: DecorKind): string {
  return `doodad_${kind}`;
}

export interface Decor {
  kind: DecorKind;
  x: number;
  y: number;
  size: number;
  rot: number;
}

export interface RoadNode {
  x: number;
  y: number;
  /** True when this node sits on water / river (bridge span). */
  water: boolean;
}

export interface Road {
  /** Ordered world-space path (objectives + intermediate waypoints). */
  nodes: RoadNode[];
  width: number;
  fromHv: string;
  toHv: string;
  /** Narrower spur linking a trunk road to a secondary building. */
  spur?: boolean;
}

export interface WorldData {
  seed: number;
  missionId: string;
  theme: TerrainTheme;
  /** Ground / bed height (under water this is the bottom). */
  height: Float32Array;
  /** Water surface height per texel, -1 where dry. Sea, lakes and rivers each sit at their own level. */
  water: Float32Array;
  biome: Uint8Array;
  spawnX: number;
  spawnY: number;
  hv: HvSpec[];
  spawns: Spawn[];
  trees: { x: number; y: number }[];
  rocks: { x: number; y: number }[];
  decor: Decor[];
  roads: Road[];
  canvas: HTMLCanvasElement;
}

export type WorldGen = Omit<WorldData, "canvas"> & { terrain: ImageData };
export type WorldProgress = (t: number, label: string) => void;

export type ObjectiveSiting = "scattered" | "tactical";

export const OBJECTIVE_SITINGS: { id: ObjectiveSiting; label: string; description: string }[] = [
  { id: "scattered", label: "SCATTERED", description: "Objectives dropped at random open spots across the map, anywhere on dry ground." },
  { id: "tactical", label: "TACTICAL", description: "Objectives sited by terrain: air defense on high ground, bases by the shore, HQs dug in deep." },
];

export interface WorldGenProfile {
  id: string;
  /** Positive values expose more land; negative values produce more open water. */
  landBias: number;
  /** Contrast around mid elevation; higher values create sharper relief. */
  relief: number;
  /** Strength of the world-edge drop toward water. */
  edgeFalloff: number;
  /** Macro land/sea silhouette the noise details. */
  shape: MapShape;
  /** Domain warp strength (0 = none): twists ridges and coastlines. */
  warp: number;
  /** Terrain palette + tiles + decor (visual only). */
  theme: TerrainTheme;
  /** Drainage network density (0 = none): higher shows streams from smaller catchments. */
  riverTarget: number;
  /** Long trunk rivers that carve their own valley to the sea (tributaries join them). */
  mainRivers: number;
  /** Landform stamp counts (mesas, craters, volcanoes, dune fields). */
  landforms: Landforms;
  objectiveCount: number;
  /** Objective placement: random legal spots, or by terrain role (high ground, shore, cover…). */
  siting: ObjectiveSiting;
  garrisonScale: number;
  patrolCount: number;
  waterPatrolBias: number;
  forceMix: "mixed" | "naval" | "heavy";
  /** Roads: 0 = none; otherwise trunks between objectives + spurs to lookouts/towers within roadDensity × ROAD_SPUR_MAX. */
  roadDensity: number;
  /** Cloud cover multiplier (visual only; 0 = clear, 1 = standard, 2 = heavy). Not used by world gen. */
  clouds: number;
}

export const DEFAULT_WORLD_PROFILE: WorldGenProfile = {
  id: "river_run",
  landBias: 0,
  relief: 1,
  edgeFalloff: 0.18,
  shape: "open",
  warp: 0,
  theme: "temperate",
  riverTarget: 50,
  mainRivers: 0,
  landforms: { mesa: 0, crater: 0, volcano: 0, dunes: 0 },
  objectiveCount: 4,
  siting: "tactical",
  garrisonScale: 1,
  patrolCount: 22,
  waterPatrolBias: 1,
  forceMix: "mixed",
  roadDensity: 1,
  clouds: 1,
};

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

const BIOME_ID: Record<Biome, number> = {
  water: 0,
  river: 1,
  sand: 2,
  grass: 3,
  forest: 4,
  rock: 5,
  peak: 6,
};

const H_WATER = 0.34;
/** Sea level on the height scale (biome water below it). */
export const WATER_LEVEL = H_WATER;
/** Lake depth → shading depth (lakes are shallower than the sea). Beds stay natural, at least LAKE_MIN_DEPTH down. */
const LAKE_SHADE_DEPTH = 2.5;
const LAKE_MIN_DEPTH = 0.003;
/** Bed relief gain from the un-terraced height (lakes: depth below level; rivers: local bumps). */
const LAKE_BED_GAIN = 1.2;
const RIVER_BED_GAIN = 2.5;
/** River channel length (texels) over which its bed rises to meet a lake's shallow edge. */
const RIVER_LAKE_FADE = 24;
/** River half-width assumed for a lake's carve depth when no river touches it. */
const LAKE_DEFAULT_RAD = 3;
/** River surface = local ground smoothed over this radius (texels), then dropped into a ravine (riverRavine). */
const RIVER_SURF_BLUR = 6;

/** How far a river's surface sits below the surrounding ground (banks become the ravine walls), by half-width. */
function riverRavine(rad: number): number {
  return 0.13 + rad * 0.007;
}

/** Max rise (height per texel) of a river surface away from lower water it touches. */
const RIVER_JOIN_SLOPE = 0.0012;

/**
 * Smooth junctions: a river surface may rise at most RIVER_JOIN_SLOPE per texel above adjacent lower water.
 * Chamfer sweeps lower river texels only (lakes and sea stay flat), so tributaries, lake inlets and mouths ease
 * into the level they meet instead of stepping.
 */
function gradeRiverJoins(biome: Uint8Array, water: Float32Array): void {
  const s1 = RIVER_JOIN_SLOPE;
  const s2 = RIVER_JOIN_SLOPE * Math.SQRT2;
  // Lowered toward lower adjacent water.
  const relax = (i: number, j: number, k: number): boolean => {
    const wj = water[j]!;
    if (wj < 0) return false;
    if (water[i]! > wj + k) {
      water[i] = wj + k;
      return true;
    }
    return false;
  };
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    for (let y = 1; y < TEX - 1; y++) {
      for (let x = 1; x < TEX - 1; x++) {
        const i = y * TEX + x;
        if (biome[i] !== BIOME_ID.river || water[i]! < 0) continue;
        changed = relax(i, i - 1, s1) || changed;
        changed = relax(i, i - TEX, s1) || changed;
        changed = relax(i, i - TEX - 1, s2) || changed;
        changed = relax(i, i - TEX + 1, s2) || changed;
      }
    }
    for (let y = TEX - 2; y >= 1; y--) {
      for (let x = TEX - 2; x >= 1; x--) {
        const i = y * TEX + x;
        if (biome[i] !== BIOME_ID.river || water[i]! < 0) continue;
        changed = relax(i, i + 1, s1) || changed;
        changed = relax(i, i + TEX, s1) || changed;
        changed = relax(i, i + TEX + 1, s2) || changed;
        changed = relax(i, i + TEX - 1, s2) || changed;
      }
    }
    if (!changed) break;
  }
}

/**
 * Water can't stand above the dry ground beside it: lower any surface that tops a dry neighbor,
 * then keep every bed at least `minDepth` under its surface. Runs before bridge decks are laid.
 */
function settleWaterSurfaces(
  height: Float32Array,
  water: Float32Array,
  minDepth: number,
  lakeGroup: Int32Array,
  biome: Uint8Array
): void {
  const settleTexels = () => {
    for (let pass = 0; pass < 2; pass++) {
      for (let y = 1; y < TEX - 1; y++) {
        for (let x = 1; x < TEX - 1; x++) {
          const i = y * TEX + x;
          if (lakeGroup[i]! >= 0) continue;
          let w = water[i]!;
          if (w < 0) continue;
          for (const j of [i - 1, i + 1, i - TEX, i + TEX]) if (water[j]! < 0 && height[j]! < w) w = height[j]!;
          water[i] = w;
        }
      }
    }
  };
  // Lakes lower as a whole so they stay flat: to their lowest leaking rim, and to their outflow (a lake can't
  // stand above the river draining it). Inflows then grade down into it.
  const lowerLakes = () => {
    const groupLow = new Map<number, number>();
    for (let y = 1; y < TEX - 1; y++) {
      for (let x = 1; x < TEX - 1; x++) {
        const i = y * TEX + x;
        const g = lakeGroup[i]!;
        if (g < 0) continue;
        let w = groupLow.get(g) ?? water[i]!;
        for (const j of [i - 1, i + 1, i - TEX, i + TEX]) {
          if (water[j]! < 0 && height[j]! < w) w = height[j]!;
          else if (biome[j] === BIOME_ID.river && water[j]! >= 0 && water[j]! < w) w = water[j]!;
        }
        groupLow.set(g, w);
      }
    }
    for (let i = 0; i < water.length; i++) {
      const g = lakeGroup[i]!;
      if (g >= 0) water[i] = Math.min(water[i]!, groupLow.get(g)!);
    }
  };
  // Alternate: lakes to rim / outflow, rivers settle, rivers re-grade into what they meet.
  for (let round = 0; round < 4; round++) {
    lowerLakes();
    settleTexels();
    gradeRiverJoins(biome, water);
  }
  settleTexels();
  for (let i = 0; i < height.length; i++) {
    const w = water[i]!;
    if (w >= 0) height[i] = Math.min(height[i]!, w - minDepth);
  }
}

/** Channel depth below a river's surface, by half-width (texels). */
function riverDepth(rad: number): number {
  return 0.006 + rad * 0.0014;
}
/** River texels within this distance (texels, along the channel) of open water blend toward its color. */
const RIVER_MOUTH_BLEND = 36;

/** 0..1 river→water color blend per texel: 1 at the outlet, 0 by RIVER_MOUTH_BLEND up the channel. */
function riverMouthBlend(biome: Uint8Array): Float32Array {
  const out = new Float32Array(TEX * TEX);
  const dist = new Int32Array(TEX * TEX).fill(-1);
  const q: number[] = [];
  for (let y = 1; y < TEX - 1; y++) {
    for (let x = 1; x < TEX - 1; x++) {
      const i = y * TEX + x;
      if (biome[i] !== BIOME_ID.river) continue;
      const W = BIOME_ID.water;
      if (biome[i - 1] === W || biome[i + 1] === W || biome[i - TEX] === W || biome[i + TEX] === W) {
        dist[i] = 0;
        q.push(i);
      }
    }
  }
  for (let h = 0; h < q.length; h++) {
    const i = q[h]!;
    const d = dist[i]! + 1;
    if (d > RIVER_MOUTH_BLEND) continue;
    for (const j of [i - 1, i + 1, i - TEX, i + TEX]) {
      if (j < 0 || j >= TEX * TEX || biome[j] !== BIOME_ID.river || dist[j]! >= 0) continue;
      dist[j] = d;
      q.push(j);
    }
  }
  for (const i of q) {
    const t = dist[i]! / RIVER_MOUTH_BLEND;
    out[i] = 1 - t * t * (3 - 2 * t);
  }
  return out;
}
const H_SAND = 0.4;
/** Underwater shelf edge: shallow band [H_SHELF, H_WATER), deep below. Paint + terrace only (still water). */
const H_SHELF = 0.305;
const H_ROCK = 0.62;
const H_PEAK = 0.72;
/** Moisture field at normalized coords (drives forest). */
export function moistureAt(nx: number, ny: number, seed: number): number {
  return fbm(nx * 5.4 + 40, ny * 5.4, seed + 17, 4);
}

/** Biome id from pre-terrace height + moisture (rivers/lakes are stamped separately). */
export function classifyBiome(h: number, m: number): number {
  if (h < H_WATER) return BIOME_ID.water;
  if (h < H_SAND) return BIOME_ID.sand;
  if (h > H_PEAK) return BIOME_ID.peak;
  if (h > H_ROCK) return BIOME_ID.rock;
  if (m > 0.58 && h < 0.58) return BIOME_ID.forest;
  return BIOME_ID.grass;
}

/** Terrain base color for a biome before tiles + lighting. `wet` = river-bank wetness (sand), `n` = fine color noise. */
export function baseTerrainColor(theme: ThemeSpec, b: number, h: number, wet = 0, n = 0): [number, number, number] {
  let lk = theme.looks[b]!;
  let t = 0;
  if (b === BIOME_ID.water) {
    // Shallow shelf and deep water: separate gradients, so the shelf edge reads as a drop-off.
    const bands = waterBandLooks(lk);
    if (h >= H_SHELF) {
      lk = bands.shallow;
      t = clamp((H_WATER - h) / (H_WATER - H_SHELF), 0, 1);
    } else {
      lk = bands.deep;
      t = clamp((H_SHELF - h) * 4, 0, 1);
    }
  } else if (b === BIOME_ID.sand) t = wet;
  else if (b === BIOME_ID.peak) t = (h - 0.74) * 8;
  else if (b === BIOME_ID.grass || b === BIOME_ID.forest) t = h;
  const shade = 0.82 + h * 0.35;
  return [
    clamp((lookColor(lk, t, 0) + n * lk.nz[0]) * shade, 0, 255),
    clamp((lookColor(lk, t, 1) + n * lk.nz[1]) * shade, 0, 255),
    clamp((lookColor(lk, t, 2) + n * lk.nz[2]) * shade, 0, 255),
  ];
}

/** Terrain hillshade from height gradient (the game's light): multiplier + specular add. */
export function terrainLight(dHx: number, dHy: number, out: { lit: number; spec: number }): void {
  const dx = dHx * 52;
  const dy = dHy * 52;
  let nx = -dx;
  let ny = -dy;
  let nz = 1;
  const len = Math.hypot(nx, ny, nz) || 1;
  nx /= len;
  ny /= len;
  nz /= len;
  const ndot = clamp(nx * -0.64 + ny * -0.44 + nz * 0.62, 0, 1);
  out.lit = 0.38 + Math.pow(ndot, 1.15) * 0.82;
  out.spec = Math.pow(Math.max(0, ndot - 0.48), 1.85) * 72;
}

const LIGHT = { lit: 1, spec: 0 };

/** Bank width as a multiple of local river half-width (2 = full river width each side). */
export const RIVER_BANK_MUL = 4.4;
export const RIVER_BANK_MIN = 6.5;
/** Lake shore width range (texels): low-frequency noise picks sharp vs gradual per stretch of shoreline. */
const LAKE_SHORE_MIN = 3;
const LAKE_SHORE_MAX = 29;
/** Shore fraction (near the water) that becomes sand beach; the rest keeps its ground biome. */
const LAKE_BEACH = 0.35;

/**
 * Lake shores: distance out from the water, normalized by a shore width that varies along the shoreline
 * (some stretches drop sharply, some shelve gently). Returns t (0 at the water → 1 at the shore's outer
 * edge, -1 = not shore); the nearest band becomes sand. Rock / peak shores stay as they are.
 */
function stampLakeShores(biome: Uint8Array, lake: Float32Array, seed: number): { t: Float32Array; near: Int32Array } {
  const out = new Float32Array(TEX * TEX).fill(-1);
  const near = new Int32Array(TEX * TEX).fill(-1);
  const dist = new Float32Array(TEX * TEX).fill(Infinity);
  const q: number[] = [];
  for (let i = 0; i < lake.length; i++) {
    if (!lake[i]) continue;
    dist[i] = 0;
    near[i] = i;
    q.push(i);
  }
  if (!q.length) return { t: out, near };
  // Chamfer-ish BFS outward over land (orthogonal 1, diagonal √2), capped at the widest shore.
  const nb: [number, number, number][] = [
    [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
    [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
  ];
  for (let h = 0; h < q.length; h++) {
    const i = q[h]!;
    const x = i % TEX;
    const y = (i / TEX) | 0;
    for (const [dx, dy, w] of nb) {
      const xx = x + dx;
      const yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= TEX || yy >= TEX) continue;
      const j = yy * TEX + xx;
      const b = biome[j]!;
      if (b === BIOME_ID.water || b === BIOME_ID.river) continue;
      const d = dist[i]! + w;
      if (d >= dist[j]! || d > LAKE_SHORE_MAX) continue;
      dist[j] = d;
      near[j] = near[i]!;
      q.push(j);
    }
  }
  // Grid-step distance only slopes in 8 directions (lighting shows facets); blur it, water included.
  const touched: number[] = [];
  for (let i = 0; i < dist.length; i++) if (dist[i]! < Infinity) touched.push(i);
  blurTouched(dist, touched, 2);
  for (const i of touched) {
    if (lake[i]) continue;
    const d = dist[i]!;
    const x = i % TEX;
    const y = (i / TEX) | 0;
    const width = LAKE_SHORE_MIN + (LAKE_SHORE_MAX - LAKE_SHORE_MIN) * clamp((fbm(x * 0.011, y * 0.011, seed + 601, 3) - 0.3) / 0.4, 0, 1);
    if (d >= width) continue;
    const t = d / width;
    out[i] = t;
    const b = biome[i]!;
    if (t < LAKE_BEACH && (b === BIOME_ID.grass || b === BIOME_ID.forest)) biome[i] = BIOME_ID.sand;
  }
  return { t: out, near };
}
/** Bank width cap (texels) so trunk rivers don't get huge sand belts. */
const RIVER_BANK_MAX = 26;
/** How much bank width wanders (0 = smooth, 1 = wild). */
export const RIVER_BANK_WOBBLE = 0.62;
/** Extra height jitter on the ramp. */
export const RIVER_BANK_ROUGH = 0.038;
const HEIGHT_BANDS: { lo: number; hi: number; k: number }[] = [
  { lo: 0, hi: H_SHELF, k: 2.7 },
  { lo: H_SHELF, hi: H_WATER, k: 2.4 },
  { lo: H_WATER, hi: H_SAND, k: 2.35 },
  { lo: H_SAND, hi: H_ROCK, k: 2.9 },
  { lo: H_ROCK, hi: H_PEAK, k: 2.55 },
  { lo: H_PEAK, hi: 1.08, k: 2.45 },
];

export interface Relief {
  height: Float32Array;
  moisture: Float32Array;
  biome: Uint8Array;
  riverRad: Float32Array;
  field: ShapeField;
  hint: { x: number; y: number };
}

/** Pre-river terrain: shape + noise heights, landform stamps, trunk rivers. Shared by world gen and the terrain rig. */
export function buildRelief(seed: number, profile: WorldGenProfile, onProgress?: WorldProgress, withMoisture = false): Relief {
  const height = new Float32Array(TEX * TEX);
  const moisture = new Float32Array(withMoisture ? TEX * TEX : 0);
  const biome = new Uint8Array(TEX * TEX);
  onProgress?.(0.02, "relief");
  const field = makeShape(profile.shape, seed);
  for (let y = 0; y < TEX; y++) {
    if (y % 150 === 0) onProgress?.(0.02 + (y / TEX) * 0.28, "relief");
    for (let x = 0; x < TEX; x++) {
      const i = y * TEX + x;
      const nx = x / TEX;
      const ny = y / TEX;
      height[i] = baseHeight(nx, ny, seed, profile, field);
      if (withMoisture) moisture[i] = moistureAt(nx, ny, seed);
    }
  }
  const hint = { x: field.spawnX * TEX, y: field.spawnY * TEX };
  applyLandforms(height, TEX, profile.landforms, seed, hint, H_WATER);
  onProgress?.(0.32, "river carve");
  const riverRad = new Float32Array(TEX * TEX);
  carveMainRivers(height, biome, riverRad, seed, profile.mainRivers);
  return { height, moisture, biome, riverRad, field, hint };
}

/** carveDrainage internals on its coarse grid (n × n, DRAIN_STEP texels per cell), for the terrain rig. */
export interface DrainageTrace {
  n: number;
  step: number;
  /** Routing surface (terrain + routing jitter). */
  gh: Float32Array;
  /** 0 = drains onward, else OUTLET_WATER / OUTLET_TRUNK / OUTLET_EDGE. */
  outlet: Uint8Array;
  /** Spill level after pit filling (≥ gh). */
  fill: Float32Array;
  /** Cell each cell drains into (-1 = outlet). */
  down: Int32Array;
  /** Drainage area in cells. */
  area: Float32Array;
  minArea: number;
  /** Kept lake id per cell (≥ 0), or < 0. */
  lakeOf: Int32Array;
  /** Fill above ground that counts as flooded. */
  floodEps: number;
}

/** The drainage pipeline's steps, in order (what carveDrainage does; the terrain rig steps through these). */
export const DRAINAGE_STAGES = [
  { id: "terrain", label: "TERRAIN", description: "Input relief: shape + noise + landforms, with trunk rivers carved." },
  { id: "outlets", label: "OUTLETS", description: "Where water leaves: sea and existing water, trunk river channels, the map edge." },
  { id: "filled", label: "FILLED", description: "Pit fill from the outlets: every hollow flooded to its spill level, so all land drains." },
  { id: "area", label: "DRAINAGE AREA", description: "Cells draining through each cell; at or above the threshold becomes a stream." },
  { id: "streams", label: "STREAMS + LAKES", description: "Stream cells plus lakes kept (deep enough, big enough, fed by a real stream)." },
  { id: "result", label: "RESULT", description: "Branches traced, smoothed and stamped at full res; lakes flooded to real shorelines." },
] as const;
export type DrainageStage = (typeof DRAINAGE_STAGES)[number]["id"];

export interface DrainagePreview {
  relief: Relief;
  /** Trunk-river channels only (relief.biome also gets the drainage streams). */
  trunk: Uint8Array;
  trace: DrainageTrace | null;
  /** Lake water level (pre-terrace height) per texel (0 = not lake). */
  lake: Float32Array;
}

/** Same relief + drainage code as world gen, stopping before biomes; returns every intermediate for preview. */
export function previewDrainage(seed: number, profile: WorldGenProfile): DrainagePreview {
  const relief = buildRelief(seed, profile);
  const trunk = new Uint8Array(relief.biome);
  const lake = new Float32Array(TEX * TEX);
  let trace: DrainageTrace | null = null;
  carveDrainage(relief.height, relief.biome, relief.riverRad, seed, profile.riverTarget, lake, (t) => (trace = t));
  return { relief, trunk, trace, lake };
}

export function generateWorld(
  seed: number,
  tiles?: (ImageData | null)[],
  onProgress?: WorldProgress,
  profile: WorldGenProfile = DEFAULT_WORLD_PROFILE
): WorldGen {
  const rng = new Rng(seed);
  const { height, moisture, biome, riverRad, field, hint } = buildRelief(seed, profile, onProgress, true);
  const lake = new Float32Array(TEX * TEX);
  carveDrainage(height, biome, riverRad, seed, profile.riverTarget, lake);
  onProgress?.(0.52, "biomes");

  for (let i = 0; i < TEX * TEX; i++) {
    // Lakes win over the river channels that run through them.
    if (lake[i]) {
      biome[i] = BIOME_ID.water;
      continue;
    }
    if (biome[i] === BIOME_ID.river) continue;
    biome[i] = classifyBiome(height[i]!, moisture[i]!);
  }

  onProgress?.(0.58, "river banks");
  const { t: bankT, near: bankNear } = stampRiverBanks(biome, riverRad, seed);
  const { t: shore, near: shoreNear } = stampLakeShores(biome, lake, seed);
  onProgress?.(0.74, "elevation");

  const raw = new Float32Array(height);
  for (let i = 0; i < height.length; i++) height[i] = remapBand(height[i]!);
  // Water surfaces: sea at sea level; rivers sunk into a ravine relative to the local ground (channel cut
  // below); lakes sunk by the same ravine depth as their rivers. Nothing is dug below sea level.
  const water = new Float32Array(TEX * TEX).fill(-1);
  const riverCells: number[] = [];
  // Lakes sink by the same ravine depth as the widest river touching them (a lake's texels share its level).
  const lakeRad = new Map<number, number>();
  for (let i = TEX; i < height.length - TEX; i++) {
    if (biome[i] !== BIOME_ID.river || lake[i]) continue;
    for (const j of [i - 1, i + 1, i - TEX, i + TEX]) {
      const lv = lake[j]!;
      if (lv) lakeRad.set(lv, Math.max(lakeRad.get(lv) ?? 0, riverRad[i]!));
    }
  }
  // Lakes touching each other share the lowest of their surfaces (one water body, one level).
  const lakeSurf = new Map<number, number>();
  const parent = new Map<number, number>();
  const find = (v: number): number => {
    let r = v;
    while (parent.get(r) !== undefined && parent.get(r) !== r) r = parent.get(r)!;
    parent.set(v, r);
    return r;
  };
  for (let i = 0; i < height.length; i++) {
    const lv = lake[i]!;
    if (!lv || lakeSurf.has(lv)) continue;
    lakeSurf.set(lv, Math.max(H_WATER, remapBand(lv) - riverRavine(lakeRad.get(lv) ?? LAKE_DEFAULT_RAD)));
    parent.set(lv, lv);
  }
  for (let i = TEX; i < height.length - TEX; i++) {
    const lv = lake[i]!;
    if (!lv) continue;
    for (const j of [i + 1, i + TEX]) {
      const lj = lake[j]!;
      if (!lj || lj === lv) continue;
      const a = find(lv);
      const b = find(lj);
      if (a !== b) parent.set(a, b);
    }
  }
  const groupSurf = new Map<number, number>();
  // Merged lakes measure basin depth from one reference (the lowest natural level) so their beds don't step.
  const groupRef = new Map<number, number>();
  for (const [lv, sf] of lakeSurf) {
    const r = find(lv);
    groupSurf.set(r, Math.min(groupSurf.get(r) ?? Infinity, sf));
    groupRef.set(r, Math.min(groupRef.get(r) ?? Infinity, lv));
  }
  const lakeGroup = new Int32Array(TEX * TEX).fill(-1);
  const lakeBed = new Float32Array(TEX * TEX);
  const groupId = new Map<number, number>();
  for (let i = 0; i < height.length; i++) {
    if (!lake[i]) continue;
    const r = find(lake[i]!);
    if (!groupId.has(r)) groupId.set(r, groupId.size);
    lakeGroup[i] = groupId.get(r)!;
  }
  for (let i = 0; i < height.length; i++) {
    if (lake[i]) {
      const surf = groupSurf.get(find(lake[i]!))!;
      // Bed (set after levels settle) from the un-terraced relief: its real depth below the natural level.
      water[i] = surf;
      lakeBed[i] = Math.max(0, groupRef.get(find(lake[i]!))! - raw[i]!) * LAKE_BED_GAIN;
    } else if (biome[i] === BIOME_ID.river) {
      riverCells.push(i);
    } else if (biome[i] === BIOME_ID.water) {
      water[i] = H_WATER;
    }
  }
  const riverSurf = new Float32Array(height);
  blurTouched(riverSurf, riverCells, RIVER_SURF_BLUR);
  // Deep enough to hide a craft in; lowland ravines bottom out at sea level rather than sinking below it.
  for (const i of riverCells) water[i] = Math.max(H_WATER, riverSurf[i]! - riverRavine(riverRad[i]!));
  gradeRiverJoins(biome, water);
  for (let i = 0; i < height.length; i++) {
    if (bankT[i]! >= 0) {
      const t = bankT[i]!;
      const x = i % TEX;
      const y = (i / TEX) | 0;
      const n1 = fbm(x * 0.09, y * 0.09, seed + 61, 4);
      const n2 = fbm(x * 0.28, y * 0.28, seed + 77, 3);
      let s = t * t * (3 - 2 * t);
      s = clamp(s + (n1 - 0.5) * 0.42, 0, 1);
      // Bank eases down to its river's surface (not sea level).
      const nr = bankNear[i]!;
      const edge = nr >= 0 && water[nr]! >= 0 ? water[nr]! : height[i]!;
      height[i] = lerp(edge, height[i]!, s);
      height[i] += (n2 - 0.5) * RIVER_BANK_ROUGH * (1 - Math.abs(t * 2 - 1));
    } else if (shore[i]! >= 0) {
      // Soft lake shore: ease down to the lake's own surface (sharp or gradual per shore width).
      const t = shore[i]!;
      const nl = shoreNear[i]!;
      const edge = nl >= 0 && water[nl]! >= 0 ? water[nl]! : height[i]!;
      height[i] = lerp(edge, height[i]!, t * t * (3 - 2 * t));
    }
  }
  settleWaterSurfaces(height, water, LAKE_MIN_DEPTH, lakeGroup, biome);
  // Beds against the settled surfaces. Lakes: natural basin depth. Rivers: channel depth + local relief,
  // fading to the lake's shallow edge where they run into a lake so the floor doesn't step.
  for (let i = 0; i < height.length; i++) if (lakeGroup[i]! >= 0) height[i] = water[i]! - LAKE_MIN_DEPTH - lakeBed[i]!;
  const fromLake = new Int32Array(TEX * TEX).fill(-1);
  const lakeEdgeBed = new Float32Array(TEX * TEX);
  const lq: number[] = [];
  for (const i of riverCells) {
    let edge = Infinity;
    for (const j of [i - 1, i + 1, i - TEX, i + TEX]) {
      if (j < 0 || j >= height.length || lakeGroup[j]! < 0) continue;
      edge = Math.min(edge, height[j]!);
    }
    if (edge === Infinity) continue;
    fromLake[i] = 0;
    lakeEdgeBed[i] = edge;
    lq.push(i);
  }
  for (let h = 0; h < lq.length; h++) {
    const i = lq[h]!;
    const d = fromLake[i]! + 1;
    if (d > RIVER_LAKE_FADE) continue;
    for (const j of [i - 1, i + 1, i - TEX, i + TEX]) {
      if (j < 0 || j >= height.length || biome[j] !== BIOME_ID.river || fromLake[j]! >= 0 || lakeGroup[j]! >= 0) continue;
      fromLake[j] = d;
      lakeEdgeBed[j] = lakeEdgeBed[i]!;
      lq.push(j);
    }
  }
  const rawSmooth = new Float32Array(raw);
  blurTouched(rawSmooth, riverCells, RIVER_SURF_BLUR);
  for (const i of riverCells) {
    if (water[i]! < 0) continue;
    const t = fromLake[i]! < 0 ? 1 : fromLake[i]! / RIVER_LAKE_FADE;
    const f = t * t * (3 - 2 * t);
    let bed = water[i]! - riverDepth(riverRad[i]!) + (raw[i]! - rawSmooth[i]!) * RIVER_BED_GAIN;
    // Near a lake: blend toward the lake bed it meets (not a generic depth).
    if (f < 1) bed = lerp(Math.min(lakeEdgeBed[i]!, water[i]! - LAKE_MIN_DEPTH), bed, f);
    height[i] = Math.min(height[i]!, bed, water[i]! - LAKE_MIN_DEPTH);
  }
  applyDunes(height, TEX, profile.landforms.dunes, seed, hint, (i) => {
    const b = biome[i]!;
    return (b === BIOME_ID.sand || b === BIOME_ID.grass) && bankT[i]! < 0 && shore[i]! < 0;
  });

  onProgress?.(0.82, "terrain paint");
  const theme = themeOf(profile.theme);
  const mouth = riverMouthBlend(biome);
  const terrain = paintTerrain(raw, biome, seed, theme, themedTiles(theme, tiles), bankT, onProgress, lake, mouth, shore);
  onProgress?.(0.96, "force laydown");
  const { spawnX, spawnY } = findSpawn(height, biome, rng, field.spawnX, field.spawnY);
  const { hv, spawns } = placeForces(height, biome, rng, spawnX, spawnY, profile, field.keep);
  const roads = makeRoads(hv, spawns, height, biome, rng, profile.roadDensity);
  applyRoadBridgeHeights(height, water, roads);
  // Road sprites stamp on the main-thread canvas (worker has no document canvas).
  const decor = placeDecor(biome, rng, theme);
  const trees = decor.filter((d) => d.kind === "tree" || d.kind === "pine" || d.kind === "palm").map((d) => ({ x: d.x, y: d.y }));
  const rocks = decor.filter((d) => d.kind === "rock" || d.kind === "boulder" || d.kind === "snowrock").map((d) => ({ x: d.x, y: d.y }));

  onProgress?.(0.97, "laydown");
  return { seed, missionId: profile.id, theme: theme.id, height, water, biome, spawnX, spawnY, hv, spawns, trees, rocks, decor, roads, terrain };
}

export function imageDataToCanvas(img: ImageData): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  c.getContext("2d", { willReadFrequently: true })!.putImageData(img, 0, 0);
  return c;
}

export function worldFromGen(g: WorldGen): WorldData {
  const { terrain, ...rest } = g;
  const canvas = imageDataToCanvas(terrain);
  paintRoadsOntoCanvas(canvas, rest.roads);
  return { ...rest, canvas };
}

export function generateWorldAsync(
  seed: number,
  tiles: (ImageData | null)[],
  onProgress?: WorldProgress,
  profile: WorldGenProfile = DEFAULT_WORLD_PROFILE
): Promise<WorldData> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./world.worker.ts", import.meta.url), { type: "module" });
    const fail = (err: unknown) => {
      worker.terminate();
      reject(err instanceof Error ? err : new Error(String(err)));
    };
    worker.onmessage = (ev: MessageEvent<{ type: "progress"; t: number; label: string } | { type: "done"; world: WorldGen }>) => {
      const msg = ev.data;
      if (msg.type === "progress") {
        onProgress?.(msg.t, msg.label);
        return;
      }
      try {
        worker.terminate();
        // Canvas + road paint are DOM-only — must run on main after the worker returns.
        onProgress?.(0.98, "roads");
        const world = worldFromGen(msg.world);
        onProgress?.(1, "ready");
        resolve(world);
      } catch (err) {
        fail(err);
      }
    };
    worker.onmessageerror = (ev) => fail(ev.data ?? "world worker messageerror");
    worker.onerror = (err) => fail(err.message || err);
    try {
      worker.postMessage({ seed, tiles, profile });
    } catch (err) {
      fail(err);
    }
  });
}

/** Top surface at texel i: water surface where there's water above the ground, else ground. */
export function surfaceHeightAt(world: WorldData, i: number): number {
  const w = world.water[i]!;
  const h = world.height[i]!;
  return w > h ? w : h;
}

/** Top surface height (ground, or water where it lies above the ground), bilinear. */
export function sampleHeight(world: WorldData, x: number, y: number): number {
  const tx = clamp((x / WORLD) * TEX, 0, TEX - 1.001);
  const ty = clamp((y / WORLD) * TEX, 0, TEX - 1.001);
  const x0 = Math.floor(tx);
  const y0 = Math.floor(ty);
  const fx = tx - x0;
  const fy = ty - y0;
  const x1 = Math.min(x0 + 1, TEX - 1);
  const y1 = Math.min(y0 + 1, TEX - 1);
  const h00 = surfaceHeightAt(world, y0 * TEX + x0);
  const h10 = surfaceHeightAt(world, y0 * TEX + x1);
  const h01 = surfaceHeightAt(world, y1 * TEX + x0);
  const h11 = surfaceHeightAt(world, y1 * TEX + x1);
  return lerp(
    lerp(h00, h10, fx),
    lerp(h01, h11, fx),
    fy
  );
}

export function isWater(world: WorldData, x: number, y: number): boolean {
  const b = sampleBiomeId(world, x, y);
  return b === BIOME_ID.water || b === BIOME_ID.river;
}

export function sampleBiome(world: WorldData, x: number, y: number): Biome {
  const id = sampleBiomeId(world, x, y);
  return (
    (["water", "river", "sand", "grass", "forest", "rock", "peak"] as const)[id] ?? "grass"
  );
}

function sampleBiomeId(world: WorldData, x: number, y: number): number {
  const tx = clamp(Math.floor((x / WORLD) * TEX), 0, TEX - 1);
  const ty = clamp(Math.floor((y / WORLD) * TEX), 0, TEX - 1);
  return world.biome[ty * TEX + tx]!;
}

/** Shared chase-camera tuning. The eye follows `Camera25D.focus` at this offset. */
export const CamTune = {
  /** Vertical eye distance above the focus. */
  cam: 900,
  /** Final Phaser framing zoom. Perspective itself lives in `worldToScreen`. */
  zoom0: 1.45,
  /** Eye setback along +Y per unit of vertical eye distance. */
  pitch: 0.05,
};
/** Near-plane clamp so scale/zoom stay finite as Z → cam. */
export const Z_SCALE_NEAR = 160;
/** Maximum coarse ray-march spacing, roughly half a rendered terrain cell. */
const TERRAIN_RAY_STEP = 12;
/** Height-map value at or below this becomes groundZ 0. */
export const GROUND_H_ZERO = 0.16;
/** World Z per unit of height-map above GROUND_H_ZERO. Peak ≈ (0.94 - GROUND_H_ZERO) * this. */
export const GROUND_Z_SCALE = 258;

export type ScreenPos = { x: number; y: number; scale: number };
export type Camera25DPose = {
  focusX: number;
  focusY: number;
  focusZ: number;
  eyeY: number;
  eyeZ: number;
  forwardY: number;
  forwardZ: number;
  downY: number;
  downZ: number;
  focal: number;
};

/**
 * Mutable once-per-frame camera pose. Projection helpers read this object so
 * hot draw paths need no camera allocation or argument plumbing.
 */
export const Camera25D: Camera25DPose = {
  focusX: 0,
  focusY: 0,
  focusZ: 0,
  eyeY: 0,
  eyeZ: CamTune.cam,
  forwardY: 0,
  forwardZ: -1,
  downY: 1,
  downZ: 0,
  focal: CamTune.cam,
};

/** Move the virtual eye with its focus, keeping focus scale exactly 1. */
export function setCamera25DFocus(x: number, y: number, z: number): void {
  const setback = CamTune.cam * CamTune.pitch;
  const invLen = 1 / Math.hypot(CamTune.cam, setback);
  Camera25D.focusX = x;
  Camera25D.focusY = y;
  Camera25D.focusZ = z;
  Camera25D.eyeY = y + setback;
  Camera25D.eyeZ = z + CamTune.cam;
  Camera25D.forwardY = -setback * invLen;
  Camera25D.forwardZ = -CamTune.cam * invLen;
  Camera25D.downY = CamTune.cam * invLen;
  Camera25D.downZ = -setback * invLen;
  Camera25D.focal = 1 / invLen;
}

/** Unclamped perspective depth from the eye. X does not affect depth. */
export function rawCamDepth(z: number, y = Camera25D.focusY): number {
  const ry = y - Camera25D.eyeY;
  const rz = z - Camera25D.eyeZ;
  return ry * Camera25D.forwardY + rz * Camera25D.forwardZ;
}

/** Perspective depth clamped only for finite projection math. */
export function camDepth(z: number, y = Camera25D.focusY): number {
  return Math.max(Z_SCALE_NEAR, rawCamDepth(z, y));
}

/** Points at or behind the near plane are not valid render/target candidates. */
export function cameraPointVisible(z: number, y = Camera25D.focusY): boolean {
  return rawCamDepth(z, y) > Z_SCALE_NEAR;
}

/** Camera-relative sprite scale. At the chase focus this is exactly 1. */
export function zScale(z: number, y = Camera25D.focusY): number {
  return Camera25D.focal / camDepth(z, y);
}

/** Zero-alloc projected screen Y (`worldToScreen(…).y`). Prefer this in hot loops. */
export function projectY(y: number, z: number): number {
  const ry = y - Camera25D.eyeY;
  const rz = z - Camera25D.eyeZ;
  const down = ry * Camera25D.downY + rz * Camera25D.downZ;
  return Camera25D.focusY + down * (Camera25D.focal / camDepth(z, y));
}

/** Zero-alloc projected screen X (`worldToScreen(…).x`). */
export function projectX(x: number, y: number, z: number): number {
  return Camera25D.focusX + (x - Camera25D.focusX) * (Camera25D.focal / camDepth(z, y));
}

/**
 * World → Phaser draw space. Sim/collision stay in world; sprites/FX use this.
 * Pass `out` to reuse a buffer in hot paths; otherwise returns a fresh object
 * (never a shared scratch — callers often keep results across later projections).
 */
export function worldToScreen(x: number, y: number, z: number, out?: ScreenPos): ScreenPos {
  const target = out ?? { x: 0, y: 0, scale: 1 };
  const scale = zScale(z, y);
  const ry = y - Camera25D.eyeY;
  const rz = z - Camera25D.eyeZ;
  target.x = Camera25D.focusX + (x - Camera25D.focusX) * scale;
  target.y = Camera25D.focusY + (ry * Camera25D.downY + rz * Camera25D.downZ) * scale;
  target.scale = scale;
  return target;
}

/** Inverse of `worldToScreen` for a known absolute Z.
 * Pass `out` to write into a reusable buffer; otherwise returns a fresh object
 * (never a shared scratch — callers often keep the result across later unprojects).
 */
export function screenToWorldAtZ(
  sx: number,
  sy: number,
  z: number,
  out?: { x: number; y: number; z: number }
): { x: number; y: number; z: number } {
  const target = out ?? { x: 0, y: 0, z: 0 };
  const dx = (sx - Camera25D.focusX) / Camera25D.focal;
  const dy = (sy - Camera25D.focusY) / Camera25D.focal;
  const rayX = dx;
  const rayY = Camera25D.forwardY + dy * Camera25D.downY;
  const rayZ = Camera25D.forwardZ + dy * Camera25D.downZ;
  const t = (z - Camera25D.eyeZ) / rayZ;
  target.x = Camera25D.focusX + rayX * t;
  target.y = Camera25D.eyeY + rayY * t;
  target.z = z;
  return target;
}

/**
 * Unproject Phaser coords onto the height-map surface (iterated ground Z).
 * Use for cursor / reticle terrain aim. Pass `out` for a reusable buffer.
 */
export function screenToWorldOnGround(
  world: WorldData,
  sx: number,
  sy: number,
  out?: { x: number; y: number; z: number }
): { x: number; y: number; z: number } {
  const target = out ?? { x: 0, y: 0, z: 0 };
  const dx = (sx - Camera25D.focusX) / Camera25D.focal;
  const dy = (sy - Camera25D.focusY) / Camera25D.focal;
  const rayX = dx;
  const rayY = Camera25D.forwardY + dy * Camera25D.downY;
  const rayZ = Camera25D.forwardZ + dy * Camera25D.downZ;
  const rayEnd = Math.max(0, -Camera25D.eyeZ / Math.min(-1e-6, rayZ));
  const horizontalLength = Math.hypot(rayX, rayY) * rayEnd;
  const marchSteps = Math.max(8, Math.min(128, Math.ceil(horizontalLength / TERRAIN_RAY_STEP)));
  let lo = 0;
  let hi = rayEnd;
  // Bracket the nearest crossing first: relief can put several terrain
  // intersections along one ray, which whole-ray bisection cannot distinguish.
  for (let i = 1; i <= marchSteps; i++) {
    const t = rayEnd * (i / marchSteps);
    const x = Camera25D.focusX + rayX * t;
    const y = Camera25D.eyeY + rayY * t;
    const z = Camera25D.eyeZ + rayZ * t;
    if (z <= groundZ(world, x, y)) {
      lo = rayEnd * ((i - 1) / marchSteps);
      hi = t;
      break;
    }
  }
  for (let i = 0; i < 10; i++) {
    const t = (lo + hi) * 0.5;
    const x = Camera25D.focusX + rayX * t;
    const y = Camera25D.eyeY + rayY * t;
    const z = Camera25D.eyeZ + rayZ * t;
    if (z > groundZ(world, x, y)) lo = t;
    else hi = t;
  }
  const t = (lo + hi) * 0.5;
  target.x = Camera25D.focusX + rayX * t;
  target.y = Camera25D.eyeY + rayY * t;
  target.z = Camera25D.eyeZ + rayZ * t;
  return target;
}

/** Screen-space velocity Y: analytic derivative of the chase projection. */
export function screenVelY(vy: number, vz: number, z: number, y = Camera25D.focusY): number {
  const ry = y - Camera25D.eyeY;
  const rz = z - Camera25D.eyeZ;
  const depth = camDepth(z, y);
  const down = ry * Camera25D.downY + rz * Camera25D.downZ;
  const dDepth = vy * Camera25D.forwardY + vz * Camera25D.forwardZ;
  const dDown = vy * Camera25D.downY + vz * Camera25D.downZ;
  return Camera25D.focal * (dDown * depth - down * dDepth) / (depth * depth);
}

/** Projected X velocity at a complete world position. */
export function screenVelX(
  vx: number,
  vy: number,
  vz: number,
  x: number,
  y: number,
  z: number
): number {
  const depth = camDepth(z, y);
  const dDepth = vy * Camera25D.forwardY + vz * Camera25D.forwardZ;
  return Camera25D.focal *
    (vx * depth - (x - Camera25D.focusX) * dDepth) /
    (depth * depth);
}

/** Project a world-XY heading into the camera plane at a point. */
export function projectHeading(
  angle: number,
  x: number,
  y: number,
  z: number
): number {
  const vx = Math.cos(angle);
  const vy = Math.sin(angle);
  return Math.atan2(
    screenVelY(vy, 0, z, y),
    screenVelX(vx, vy, 0, x, y, z)
  );
}

/** Projected velocity. Pass the source position for perspective-correct X/Y. */
export function screenVel(
  vx: number,
  vy: number,
  vz: number,
  z: number,
  x = Camera25D.focusX,
  y = Camera25D.focusY
): { x: number; y: number } {
  return {
    x: screenVelX(vx, vy, vz, x, y, z),
    y: screenVelY(vy, vz, z, y),
  };
}

/**
 * Final framing zoom. Chase-camera perspective already keeps focus scale stable.
 */
export function camZoomAt(_z: number): number {
  return CamTune.zoom0;
}

/** Surface z: ground, or the water surface over water — what things rest on, hit and cast onto. */
export function groundZ(world: WorldData, x: number, y: number): number {
  const h = sampleHeight(world, x, y);
  return Math.max(0, (h - GROUND_H_ZERO) * GROUND_Z_SCALE);
}

/** Floating craft ride this Z on water; bed under the water is still `groundZ`. */
/** Bottom under any water (true ground / sea floor / lake + river bed), bilinear — what the terrain mesh draws. */
export function bedZ(world: WorldData, x: number, y: number): number {
  const tx = clamp((x / WORLD) * TEX, 0, TEX - 1.001);
  const ty = clamp((y / WORLD) * TEX, 0, TEX - 1.001);
  const x0 = Math.floor(tx);
  const y0 = Math.floor(ty);
  const x1 = Math.min(x0 + 1, TEX - 1);
  const y1 = Math.min(y0 + 1, TEX - 1);
  const h = world.height;
  const top = lerp(h[y0 * TEX + x0]!, h[y0 * TEX + x1]!, tx - x0);
  const bottom = lerp(h[y1 * TEX + x0]!, h[y1 * TEX + x1]!, tx - x0);
  return Math.max(0, (lerp(top, bottom, ty - y0) - GROUND_H_ZERO) * GROUND_Z_SCALE);
}

export function castZ(world: WorldData, x: number, y: number, z: number): number {
  return Math.max(0, z - groundZ(world, x, y));
}

/** `underwater` = water depth (z) above the hit point when the shadow lands on a bed under water, else 0. */
export type ShadowHit = { x: number; y: number; z: number; cast: number; underwater: number };

/**
 * Intersect a directional sun ray with the heightfield. The light direction is
 * expressed in world units, so camera pitch/zoom never leak into shadow offset.
 * Pass `out` to reuse a buffer; otherwise returns a fresh object.
 */
/**
 * Shadow hit along the light ray. Casters in the air land on the top surface (ground or water);
 * casters on / under the water land on the bed below it.
 */
export function castShadowToGround(
  world: WorldData,
  x: number,
  y: number,
  z: number,
  out?: ShadowHit
): ShadowHit {
  const target = out ?? { x: 0, y: 0, z: 0, cast: 0, underwater: 0 };
  const lightX = 0.24;
  const lightY = 0.58;
  const floorAt = z > groundZ(world, x, y) + 0.25 ? groundZ : bedZ;
  const sourceGround = floorAt(world, x, y);
  if (z <= sourceGround + 0.25) {
    target.x = x;
    target.y = y;
    target.z = sourceGround;
    target.cast = 0;
    target.underwater = floorAt === bedZ ? Math.max(0, groundZ(world, x, y) - sourceGround) : 0;
    return target;
  }
  const rayEnd = Math.max(0, z);
  const horizontalLength = Math.hypot(lightX, lightY) * rayEnd;
  const marchSteps = Math.max(4, Math.min(96, Math.ceil(horizontalLength / TERRAIN_RAY_STEP)));
  let lo = 0;
  let hi = rayEnd;
  for (let i = 1; i <= marchSteps; i++) {
    const cast = rayEnd * (i / marchSteps);
    const rx = x + lightX * cast;
    const ry = y + lightY * cast;
    const rz = z - cast;
    if (rz <= floorAt(world, rx, ry)) {
      lo = rayEnd * ((i - 1) / marchSteps);
      hi = cast;
      break;
    }
  }
  for (let i = 0; i < 8; i++) {
    const cast = (lo + hi) * 0.5;
    const rx = x + lightX * cast;
    const ry = y + lightY * cast;
    const rz = z - cast;
    if (rz > floorAt(world, rx, ry)) lo = cast;
    else hi = cast;
  }
  const cast = (lo + hi) * 0.5;
  const rx = x + lightX * cast;
  const ry = y + lightY * cast;
  target.x = rx;
  target.y = ry;
  target.z = z - cast;
  target.cast = cast;
  target.underwater = floorAt === bedZ ? Math.max(0, groundZ(world, rx, ry) - target.z) : 0;
  return target;
}

export function groundSlope(world: WorldData, x: number, y: number): { dx: number; dy: number } {
  const e = 14;
  return {
    dx: (groundZ(world, x + e, y) - groundZ(world, x - e, y)) / (2 * e),
    dy: (groundZ(world, x, y + e) - groundZ(world, x, y - e)) / (2 * e),
  };
}

const DRAIN_STEP = 3;
/** Drainage area (coarse cells) for a stream to show, at RIVERS = 1; density divides it. */
const DRAIN_AREA = 60000;
/** Hollow depth (height) worth a lake, and lake size limits (coarse cells). */
const LAKE_DEPTH = 0.02;
const LAKE_MIN = 40;
const LAKE_MAX = 2600;
/** How far (coarse cells) a lake's full-res flood may reach beyond its own cells. */
const LAKE_REACH = 3;
/** Routing-only height noise: breaks up parallel flow on flats so streams merge. */
const DRAIN_JITTER = 0.006;
/** Fill above ground that counts as flooded (a hollow). */
const DRAIN_FLOOD_EPS = 1e-4;
/** Outlet kinds in DrainageTrace.outlet (0 = drains onward). */
export const OUTLET_WATER = 1;
export const OUTLET_TRUNK = 2;
export const OUTLET_EDGE = 3;

/**
 * Drainage-network rivers: fill pits from the outlets (sea, water, trunk rivers, map edge), route every
 * cell downhill, accumulate drainage area, and draw cells above a threshold as rivers (width by area).
 * Hollows the network flows through become lakes filled to their spill level. Reads terrain, never reshapes it.
 */
function carveDrainage(
  height: Float32Array,
  biome: Uint8Array,
  riverRad: Float32Array,
  seed: number,
  density: number,
  lake: Float32Array,
  trace?: (t: DrainageTrace) => void
): void {
  if (density <= 0) return;
  const n = Math.floor(TEX / DRAIN_STEP);
  const N = n * n;
  const half = DRAIN_STEP >> 1;
  const jitter = (cx: number, cy: number) => (fbm(cx * 0.05, cy * 0.05, seed + 401, 3) - 0.5) * 2 * DRAIN_JITTER;
  const gh = new Float32Array(N);
  const outlet = new Uint8Array(N);
  for (let cy = 0; cy < n; cy++) {
    for (let cx = 0; cx < n; cx++) {
      const i = (cy * DRAIN_STEP + half) * TEX + cx * DRAIN_STEP + half;
      const c = cy * n + cx;
      gh[c] = height[i]! + jitter(cx, cy);
      // Biomes aren't assigned yet (all 0 = water), so water comes from height; river = trunk channels.
      if (gh[c]! < H_WATER) outlet[c] = OUTLET_WATER;
      else if (biome[i] === BIOME_ID.river) outlet[c] = OUTLET_TRUNK;
      else if (cx === 0 || cy === 0 || cx === n - 1 || cy === n - 1) outlet[c] = OUTLET_EDGE;
    }
  }
  // Priority-flood: `fill` = spill level, `down` = cell this one drains into, `order` = pop order (downstream first).
  const fill = new Float32Array(N).fill(Infinity);
  const down = new Int32Array(N).fill(-1);
  const order = new Int32Array(N);
  let popped = 0;
  const heap: HeapItem[] = [];
  for (let c = 0; c < N; c++) {
    if (!outlet[c]) continue;
    fill[c] = gh[c]!;
    heapPush(heap, { h: gh[c]!, i: c });
  }
  const done = new Uint8Array(N);
  for (let it = heapPop(heap); it; it = heapPop(heap)) {
    const c = it.i;
    if (done[c]) continue;
    done[c] = 1;
    order[popped++] = c;
    const cx = c % n;
    const cy = (c / n) | 0;
    for (let k = 0; k < 8; k++) {
      const xx = cx + DRAIN_NB[k * 2]!;
      const yy = cy + DRAIN_NB[k * 2 + 1]!;
      if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
      const j = yy * n + xx;
      if (done[j] || fill[j]! < Infinity) continue;
      // Tiny rise per step keeps filled flats draining toward their outlet.
      fill[j] = Math.max(gh[j]!, fill[c]! + 1e-6);
      down[j] = c;
      heapPush(heap, { h: fill[j]!, i: j });
    }
  }
  // Drainage area: walk upstream-first, pushing area downhill.
  const area = new Float32Array(N).fill(1);
  for (let k = popped - 1; k >= 0; k--) {
    const c = order[k]!;
    const d = down[c]!;
    if (d >= 0) area[d] = area[d]! + area[c]!;
  }
  const minArea = DRAIN_AREA / density;
  const isRiver = (c: number) => !outlet[c] && area[c]! >= minArea;

  // Lakes: flooded hollows (fill above ground) that a river runs through.
  const lakeOf = new Int32Array(N).fill(-1);
  const q = new Int32Array(N);
  const lakeLevel: number[] = [];
  for (let c0 = 0; c0 < N; c0++) {
    if (lakeOf[c0]! !== -1 || outlet[c0] || fill[c0]! - gh[c0]! < DRAIN_FLOOD_EPS) continue;
    let qh = 0;
    let qt = 0;
    q[qt++] = c0;
    lakeOf[c0] = -2;
    let deep = 0;
    let level = 0;
    let fed = false;
    while (qh < qt) {
      const c = q[qh++]!;
      deep = Math.max(deep, fill[c]! - gh[c]!);
      level = Math.max(level, fill[c]!);
      if (area[c]! >= minArea * 3) fed = true;
      const cx = c % n;
      const cy = (c / n) | 0;
      for (let k = 0; k < 8; k++) {
        const xx = cx + DRAIN_NB[k * 2]!;
        const yy = cy + DRAIN_NB[k * 2 + 1]!;
        if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
        const j = yy * n + xx;
        if (lakeOf[j]! !== -1 || outlet[j] || fill[j]! - gh[j]! < DRAIN_FLOOD_EPS) continue;
        lakeOf[j] = -2;
        q[qt++] = j;
      }
    }
    const keep = fed && deep >= LAKE_DEPTH && qt >= LAKE_MIN && qt <= LAKE_MAX;
    const id = keep ? lakeLevel.length : -3;
    if (keep) lakeLevel.push(level);
    for (let k = 0; k < qt; k++) lakeOf[q[k]!] = id;
  }
  // Fill lakes at full res: flood out from each lake's cells over texels below its spill level, so the
  // shoreline follows the real ground (not coarse cells). Each lake reaches at most LAKE_REACH coarse
  // cells past its own, never past its spill, never into trunk channels or ground below sea level.
  const near = new Int32Array(N).fill(-1);
  const lakeCells: number[][] = lakeLevel.map(() => []);
  for (let c = 0; c < N; c++) {
    const id = lakeOf[c]!;
    if (id < 0) continue;
    lakeCells[id]!.push(c);
    const cx = c % n;
    const cy = (c / n) | 0;
    for (let oy = -LAKE_REACH; oy <= LAKE_REACH; oy++) {
      for (let ox = -LAKE_REACH; ox <= LAKE_REACH; ox++) {
        const xx = cx + ox;
        const yy = cy + oy;
        if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
        if (near[yy * n + xx]! < 0) near[yy * n + xx] = id;
      }
    }
  }
  const surf = (tx: number, ty: number) => height[ty * TEX + tx]! + jitter((tx - half) / DRAIN_STEP, (ty - half) / DRAIN_STEP);
  // Own cells, or rim cells that stand at/above the lake level (ground there drains back into it);
  // cells filled lower drain elsewhere (past the spill), so the lake stops instead of spreading there.
  const floodable = (tx: number, ty: number, id: number, level: number) => {
    const i = ty * TEX + tx;
    if (lake[i] || biome[i] === BIOME_ID.river || height[i]! < H_WATER) return false;
    const cx = Math.min(n - 1, (tx / DRAIN_STEP) | 0);
    const cy = Math.min(n - 1, (ty / DRAIN_STEP) | 0);
    const c = cy * n + cx;
    return near[c] === id && (lakeOf[c] === id || fill[c]! >= level);
  };
  const tq: number[] = [];
  for (let id = 0; id < lakeLevel.length; id++) {
    const level = lakeLevel[id]!;
    tq.length = 0;
    for (const c of lakeCells[id]!) {
      const tx = (c % n) * DRAIN_STEP + half;
      const ty = ((c / n) | 0) * DRAIN_STEP + half;
      const sv = surf(tx, ty);
      if (sv < level && floodable(tx, ty, id, level)) {
        lake[ty * TEX + tx] = level;
        tq.push(ty * TEX + tx);
      }
    }
    for (let h = 0; h < tq.length; h++) {
      const i = tq[h]!;
      const tx = i % TEX;
      const ty = (i / TEX) | 0;
      for (const [dx, dy] of LAKE_NB) {
        const xx = tx + dx;
        const yy = ty + dy;
        if (xx < 1 || yy < 1 || xx > TEX - 2 || yy > TEX - 2) continue;
        const sv = surf(xx, yy);
        if (sv >= level || !floodable(xx, yy, id, level)) continue;
        lake[yy * TEX + xx] = level;
        tq.push(yy * TEX + xx);
      }
    }
  }

  // Trace each branch from its head down to a confluence / outlet, smooth it, stamp it.
  const traced = new Uint8Array(N);
  const hasUp = new Uint8Array(N);
  for (let c = 0; c < N; c++) if (isRiver(c) && down[c]! >= 0) hasUp[down[c]!] = 1;
  const rng = new Rng((seed ^ 0xd7a1e) >>> 0);
  const radAt = (c: number) => Math.min(10, 0.6 + 1.1 * Math.sqrt(area[c]! / minArea));
  for (let k = popped - 1; k >= 0; k--) {
    const head = order[k]!;
    if (!isRiver(head) || hasUp[head] || traced[head]) continue;
    let pts: { x: number; y: number; r: number }[] = [];
    let c = head;
    for (;;) {
      pts.push({ x: (c % n) * DRAIN_STEP + half, y: ((c / n) | 0) * DRAIN_STEP + half, r: radAt(c) });
      const d = down[c]!;
      if (d < 0) break;
      if (traced[c]) break;
      traced[c] = 1;
      if (outlet[d] || traced[d]) {
        pts.push({ x: (d % n) * DRAIN_STEP + half, y: ((d / n) | 0) * DRAIN_STEP + half, r: radAt(c) });
        break;
      }
      c = d;
    }
    if (pts.length < 2) continue;
    for (let it = 0; it < 4; it++) {
      const sm = [pts[0]!];
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i]!;
        const b = pts[i + 1]!;
        sm.push(
          { x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25, r: a.r * 0.75 + b.r * 0.25 },
          { x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75, r: a.r * 0.25 + b.r * 0.75 }
        );
      }
      sm.push(pts[pts.length - 1]!);
      pts = sm;
    }
    const wob = rng.range(0, 1000);
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
      const dl = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      for (let s = 0; s < steps; s++) {
        const u = s / steps;
        // Light wander off the grid path; pinned at the ends so confluences stay joined.
        const endFade = Math.min(1, i / 16, (pts.length - 1 - i) / 16);
        const off = (fbm((i + u) * 0.03 + wob, 3.7, seed + 311, 2) - 0.5) * 7 * endFade;
        const x = Math.round(a.x + (b.x - a.x) * u - ((b.y - a.y) / dl) * off);
        const y = Math.round(a.y + (b.y - a.y) * u + ((b.x - a.x) / dl) * off);
        if (x < 1 || y < 1 || x >= TEX - 1 || y >= TEX - 1) continue;
        stampRiver(biome, riverRad, x, y, a.r + (b.r - a.r) * u);
      }
    }
  }
  trace?.({ n, step: DRAIN_STEP, gh, outlet, fill, down, area, minArea, lakeOf, floodEps: DRAIN_FLOOD_EPS });
}

const DRAIN_NB = [1, 0, -1, 0, 0, 1, 0, -1, 1, 1, 1, -1, -1, 1, -1, -1];
const LAKE_NB = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

const MAIN_STEP = 6;
/** Trunk channel edge raggedness: noise frequency (per texel) and radius swing. */
const MAIN_EDGE_FREQ = 0.11;
const MAIN_EDGE_JAG = 0.22;

/** stampRiver with a ragged edge: each texel's cutoff radius varies with 2D noise at that texel. */
function stampRiverRagged(biome: Uint8Array, riverRad: Float32Array, x: number, y: number, rad: number, seed: number): void {
  const r = Math.max(rad, 0.5);
  const outer = r * (1 + MAIN_EDGE_JAG);
  const inner = r * (1 - MAIN_EDGE_JAG);
  const ir = Math.ceil(outer);
  for (let oy = -ir; oy <= ir; oy++) {
    for (let ox = -ir; ox <= ir; ox++) {
      const xx = x + ox;
      const yy = y + oy;
      if (xx < 0 || yy < 0 || xx >= TEX || yy >= TEX) continue;
      const d = Math.hypot(ox, oy);
      if (d > outer) continue;
      const i = yy * TEX + xx;
      if (d > inner) {
        const jag = (fbm(xx * MAIN_EDGE_FREQ, yy * MAIN_EDGE_FREQ, seed + 507, 2) - 0.5) * 2 * MAIN_EDGE_JAG;
        if (d > r * (1 + jag)) continue;
      }
      biome[i] = BIOME_ID.river;
      if (r > riverRad[i]!) riverRad[i] = r;
    }
  }
}

/** Blur radius (texels) for the trunk valley's along-river parameter. */
const MAIN_T_BLUR = 20;

/** Box-blur `v` over only the `touched` texels (others neither read nor written), radius r. */
function blurTouched(v: Float32Array, touched: number[], r: number): void {
  if (!touched.length) return;
  let x0 = TEX;
  let y0 = TEX;
  let x1 = 0;
  let y1 = 0;
  for (const i of touched) {
    const x = i % TEX;
    const y = (i / TEX) | 0;
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const sv = new Float64Array((w + 1) * (h + 1));
  const sw = new Float64Array((w + 1) * (h + 1));
  const mask = new Uint8Array(w * h);
  for (const i of touched) mask[(((i / TEX) | 0) - y0) * w + (i % TEX) - x0] = 1;
  for (let y = 0; y < h; y++) {
    let rv = 0;
    let rw = 0;
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) {
        rv += v[(y + y0) * TEX + x + x0]!;
        rw += 1;
      }
      const o = (y + 1) * (w + 1) + x + 1;
      sv[o] = sv[o - (w + 1)]! + rv;
      sw[o] = sw[o - (w + 1)]! + rw;
    }
  }
  const box = (a: Float64Array, ax: number, ay: number, bx: number, by: number) =>
    a[by * (w + 1) + bx]! - a[ay * (w + 1) + bx]! - a[by * (w + 1) + ax]! + a[ay * (w + 1) + ax]!;
  for (const i of touched) {
    const x = (i % TEX) - x0;
    const y = ((i / TEX) | 0) - y0;
    const ax = Math.max(0, x - r);
    const ay = Math.max(0, y - r);
    const bx = Math.min(w, x + r + 1);
    const by = Math.min(h, y + r + 1);
    const n = box(sw, ax, ay, bx, by);
    if (n > 0) v[i] = box(sv, ax, ay, bx, by) / n;
  }
}
/** Trunk half-width (texels) at source → mouth. */
const MAIN_W0 = 4;
const MAIN_W1 = 14;

/** Long meandering trunk rivers from high ground to the sea (or map edge), each in its own carved valley. */
function carveMainRivers(height: Float32Array, biome: Uint8Array, riverRad: Float32Array, seed: number, count: number): void {
  if (count <= 0) return;
  const rng = new Rng((seed ^ 0x3a1b7) >>> 0);
  const n = Math.floor(TEX / MAIN_STEP);
  const N = n * n;
  const gh = new Float32Array(N);
  for (let cy = 0; cy < n; cy++)
    for (let cx = 0; cx < n; cx++) gh[cy * n + cx] = height[(cy * MAIN_STEP + 3) * TEX + cx * MAIN_STEP + 3]!;
  // Water bodies (to find the sea); with no sea, rivers run off the map edge.
  const wet = new Int32Array(N).fill(-1);
  const wetSize: number[] = [];
  const q = new Int32Array(N);
  for (let c0 = 0; c0 < N; c0++) {
    if (gh[c0]! >= H_WATER || wet[c0]! >= 0) continue;
    const id = wetSize.length;
    let qh = 0;
    let qt = 0;
    q[qt++] = c0;
    wet[c0] = id;
    while (qh < qt) {
      const c = q[qh++]!;
      const cx = c % n;
      const cy = (c / n) | 0;
      for (const k of [cx > 0 ? c - 1 : -1, cx < n - 1 ? c + 1 : -1, cy > 0 ? c - n : -1, cy < n - 1 ? c + n : -1])
        if (k >= 0 && gh[k]! < H_WATER && wet[k]! < 0) (wet[k] = id), (q[qt++] = k);
    }
    wetSize.push(qt);
  }
  // Mouth: the largest water body (the sea), when there is one worth reaching.
  let sea = -1;
  for (let id = 0; id < wetSize.length; id++) if (wetSize[id]! >= 150 && (sea < 0 || wetSize[id]! > wetSize[sea]!)) sea = id;
  const sink = (c: number) => sea >= 0 && wet[c] === sea;
  const dist = new Float32Array(N).fill(Infinity);
  const parent = new Int32Array(N).fill(-1);
  const heap: HeapItem[] = [];
  for (let c = 0; c < N; c++) {
    const cx = c % n;
    const cy = (c / n) | 0;
    const edgeCell = cx === 0 || cy === 0 || cx === n - 1 || cy === n - 1;
    const d0 = sink(c) ? 0 : edgeCell && sea < 0 ? 0 : Infinity;
    if (d0 < Infinity) {
      dist[c] = d0;
      heapPush(heap, { h: d0, i: c });
    }
  }
  const nb = [1, 0, -1, 0, 0, 1, 0, -1, 1, 1, 1, -1, -1, 1, -1, -1];
  for (let it = heapPop(heap); it; it = heapPop(heap)) {
    const c = it.i;
    if (it.h > dist[c]!) continue;
    const cx = c % n;
    const cy = (c / n) | 0;
    for (let k = 0; k < 16; k += 2) {
      const xx = cx + nb[k]!;
      const yy = cy + nb[k + 1]!;
      if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
      const j = yy * n + xx;
      if (sink(j)) continue;
      const lift = Math.max(0, gh[j]! - H_WATER);
      const wobble = 0.75 + 0.5 * fbm(xx * 0.07, yy * 0.07, seed + 301, 2);
      const step = (k < 8 ? 1 : Math.SQRT2) * (0.25 + 30 * lift * lift) * wobble;
      const nd = dist[c]! + step;
      if (nd < dist[j]!) {
        dist[j] = nd;
        parent[j] = c;
        heapPush(heap, { h: nd, i: j });
      }
    }
  }
  const taken: { x: number; y: number }[] = [];
  const dMin = new Float32Array(TEX * TEX).fill(Infinity);
  const tAt = new Float32Array(TEX * TEX);
  for (let r = 0; r < count; r++) {
    // Source: longest route down from mid/high ground, clear of other trunks.
    let src = -1;
    let best = -Infinity;
    for (let c = 0; c < N; c++) {
      const h = gh[c]!;
      if (h < 0.46 || h > 0.7 || !(dist[c]! < Infinity) || parent[c]! < 0) continue;
      const cx = c % n;
      const cy = (c / n) | 0;
      if (cx < 8 || cy < 8 || cx > n - 9 || cy > n - 9) continue;
      if (taken.some((p) => Math.hypot(p.x - cx, p.y - cy) < n * 0.14)) continue;
      const score = dist[c]! * (0.85 + rng.next() * 0.3);
      if (score > best) {
        best = score;
        src = c;
      }
    }
    if (src < 0) break;
    let pts: { x: number; y: number }[] = [];
    for (let c = src; c >= 0 && !sink(c); c = parent[c]!) {
      pts.push({ x: (c % n) * MAIN_STEP + 3, y: ((c / n) | 0) * MAIN_STEP + 3 });
      taken.push({ x: c % n, y: (c / n) | 0 });
    }
    if (pts.length < 20) continue;
    // Chaikin smoothing.
    for (let k = 0; k < 3; k++) {
      const sm: { x: number; y: number }[] = [pts[0]!];
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i]!;
        const b = pts[i + 1]!;
        sm.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 }, { x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
      }
      sm.push(pts[pts.length - 1]!);
      pts = sm;
    }
    // Arc length, then meanders sized to channel width (wavelength ~12 widths).
    const arc: number[] = [0];
    for (let i = 1; i < pts.length; i++) arc.push(arc[i - 1]! + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y));
    const L = arc[arc.length - 1]!;
    const widthAt = (t: number) => MAIN_W0 + (MAIN_W1 - MAIN_W0) * Math.pow(t, 0.7);
    const phase0 = rng.range(0, Math.PI * 2);
    let ph = phase0;
    const bent: { x: number; y: number; t: number }[] = [];
    for (let i = 0; i < pts.length; i++) {
      const t = arc[i]! / L;
      const w = widthAt(t);
      if (i > 0) ph += ((arc[i]! - arc[i - 1]!) / (24 * w)) * Math.PI * 2;
      const a = pts[Math.max(0, i - 1)]!;
      const b = pts[Math.min(pts.length - 1, i + 1)]!;
      const dl = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const amp = 5 * w * (0.5 + fbm(arc[i]! * 0.004, 7, seed + 307, 2)) * Math.min(1, t * 6, (1 - t) * 8);
      const off = Math.sin(ph) * amp;
      bent.push({ x: pts[i]!.x - ((b.y - a.y) / dl) * off, y: pts[i]!.y + ((b.x - a.x) / dl) * off, t });
    }
    const samples = resample(bent);
    const center = resample(pts.map((p, i) => ({ x: p.x, y: p.y, t: arc[i]! / L })));
    // Valley around the centerline (meanders stay inside a flat floodplain), lowered toward a stepped-down floor.
    const plainW = (w: number) => 5 * w * 1.5 + 2.4 * w + 10;
    const valleyW = (w: number) => plainW(w) + 4 * w + 36;
    const srcH = gh[src]!;
    const touched: number[] = [];
    // Distance to segments between sparse centerline samples (exact, so no radial creases between samples).
    for (let k = 0; k < center.length - 1; ) {
      const a = center[k]!;
      const step = Math.max(2, Math.round(valleyW(widthAt(a.t)) / 10));
      const b = center[Math.min(center.length - 1, k + step)]!;
      k += step;
      const V = Math.max(valleyW(widthAt(a.t)), valleyW(widthAt(b.t)));
      const sx = b.x - a.x;
      const sy = b.y - a.y;
      const sl = sx * sx + sy * sy || 1;
      const x0 = Math.max(1, Math.floor(Math.min(a.x, b.x) - V));
      const x1 = Math.min(TEX - 2, Math.ceil(Math.max(a.x, b.x) + V));
      const y0 = Math.max(1, Math.floor(Math.min(a.y, b.y) - V));
      const y1 = Math.min(TEX - 2, Math.ceil(Math.max(a.y, b.y) + V));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const u = clamp(((x - a.x) * sx + (y - a.y) * sy) / sl, 0, 1);
          const d = Math.hypot(x - (a.x + sx * u), y - (a.y + sy * u));
          if (d > V) continue;
          const i = y * TEX + x;
          if (dMin[i] === Infinity) touched.push(i);
          if (d < dMin[i]!) {
            dMin[i] = d;
            tAt[i] = a.t + (b.t - a.t) * u;
          }
        }
      }
    }
    // Nearest-segment t jumps where two stretches are equally close (bend medial axis); blur it so
    // the stepped-down floodplain has no creases there.
    blurTouched(tAt, touched, MAIN_T_BLUR);
    for (const i of touched) {
      const t = tAt[i]!;
      const w = widthAt(t);
      const top = Math.min(srcH - 0.02, 0.5);
      const flood = top + (H_WATER + 0.025 - top) * Math.pow(t, 0.6);
      const target = flood + (height[i]! - flood) * smooth01(plainW(w), valleyW(w), dMin[i]!);
      if (target < height[i]!) height[i] = target;
      dMin[i] = Infinity;
    }
    for (let k = 0; k < samples.length; k++) {
      const sp = samples[k]!;
      const x = Math.round(sp.x);
      const y = Math.round(sp.y);
      if (x < 1 || y < 1 || x >= TEX - 1 || y >= TEX - 1) continue;
      // Slow width wander along the arc; the ragged edge itself comes from 2D noise in the stamp.
      const wander = 1 + (fbm(k * 0.012, 1.7, seed + 501, 2) - 0.5) * 0.24;
      stampRiverRagged(biome, riverRad, x, y, widthAt(sp.t) * wander, seed);
    }
  }
}

/** Polyline → ~1-texel samples, interpolating t. */
function resample(pts: { x: number; y: number; t: number }[]): { x: number; y: number; t: number }[] {
  const out: { x: number; y: number; t: number }[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
    for (let k = 0; k < steps; k++) {
      const u = k / steps;
      out.push({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, t: a.t + (b.t - a.t) * u });
    }
  }
  return out;
}

function smooth01(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

type HeapItem = { h: number; i: number };

function heapPush(heap: HeapItem[], x: HeapItem): void {
  heap.push(x);
  let i = heap.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (heap[p]!.h <= heap[i]!.h) break;
    const t = heap[p]!;
    heap[p] = heap[i]!;
    heap[i] = t;
    i = p;
  }
}

function heapPop(heap: HeapItem[]): HeapItem | undefined {
  const top = heap[0];
  const last = heap.pop();
  if (!last || heap.length === 0) return top;
  heap[0] = last;
  let i = 0;
  for (;;) {
    let s = i;
    const l = i * 2 + 1;
    const r = l + 1;
    if (l < heap.length && heap[l]!.h < heap[s]!.h) s = l;
    if (r < heap.length && heap[r]!.h < heap[s]!.h) s = r;
    if (s === i) break;
    const t = heap[i]!;
    heap[i] = heap[s]!;
    heap[s] = t;
    i = s;
  }
  return top;
}

function slopeAccel(height: Float32Array, fx: number, fy: number): { ax: number; ay: number } {
  const e = 2.4;
  const ax = (sampleH(height, fx - e, fy) - sampleH(height, fx + e, fy)) / (2 * e);
  const ay = (sampleH(height, fx, fy - e) - sampleH(height, fx, fy + e)) / (2 * e);
  return { ax, ay };
}

function sampleH(height: Float32Array, x: number, y: number): number {
  const tx = clamp(x, 0, TEX - 1.001);
  const ty = clamp(y, 0, TEX - 1.001);
  const x0 = Math.floor(tx);
  const y0 = Math.floor(ty);
  const x1 = Math.min(x0 + 1, TEX - 1);
  const y1 = Math.min(y0 + 1, TEX - 1);
  const fx = tx - x0;
  const fy = ty - y0;
  const h00 = height[y0 * TEX + x0]!;
  const h10 = height[y0 * TEX + x1]!;
  const h01 = height[y1 * TEX + x0]!;
  const h11 = height[y1 * TEX + x1]!;
  return lerp(lerp(h00, h10, fx), lerp(h01, h11, fx), fy);
}

function stampRiver(biome: Uint8Array, riverRad: Float32Array, x: number, y: number, rad: number): void {
  const r = Math.max(rad, 0.5);
  const ir = Math.ceil(r);
  const r2 = r * r;
  for (let oy = -ir; oy <= ir; oy++) {
    for (let ox = -ir; ox <= ir; ox++) {
      if (ox * ox + oy * oy > r2) continue;
      const xx = x + ox;
      const yy = y + oy;
      if (xx < 0 || yy < 0 || xx >= TEX || yy >= TEX) continue;
      const i = yy * TEX + xx;
      biome[i] = BIOME_ID.river;
      if (r > riverRad[i]!) riverRad[i] = r;
    }
  }
}

function stampRiverBanks(biome: Uint8Array, riverRad: Float32Array, seed: number): { t: Float32Array; near: Int32Array } {
  const near = new Int32Array(TEX * TEX).fill(-1);
  const dist = new Float32Array(TEX * TEX);
  const wid = new Float32Array(TEX * TEX);
  dist.fill(1e9);
  const reach = 1 + RIVER_BANK_WOBBLE + 0.2;
  for (let y = 0; y < TEX; y++) {
    for (let x = 0; x < TEX; x++) {
      const i = y * TEX + x;
      if (biome[i] !== BIOME_ID.river) continue;
      // Interior texels are never the nearest river texel to a bank.
      if (
        x > 0 && y > 0 && x < TEX - 1 && y < TEX - 1 &&
        biome[i - 1] === BIOME_ID.river && biome[i + 1] === BIOME_ID.river &&
        biome[i - TEX] === BIOME_ID.river && biome[i + TEX] === BIOME_ID.river
      )
        continue;
      const base = Math.min(RIVER_BANK_MAX, Math.max(riverRad[i]! * RIVER_BANK_MUL, RIVER_BANK_MIN));
      const ir = Math.ceil(base * reach);
      for (let oy = -ir; oy <= ir; oy++) {
        for (let ox = -ir; ox <= ir; ox++) {
          const d = Math.hypot(ox, oy);
          if (d < 0.001 || d > base * reach) continue;
          const xx = x + ox;
          const yy = y + oy;
          if (xx < 0 || yy < 0 || xx >= TEX || yy >= TEX) continue;
          const j = yy * TEX + xx;
          const b = biome[j]!;
          if (b === BIOME_ID.river || b === BIOME_ID.water || b === BIOME_ID.peak) continue;
          if (d < dist[j]!) {
            dist[j] = d;
            wid[j] = base;
            near[j] = i;
          }
        }
      }
    }
  }
  const tOut = new Float32Array(TEX * TEX);
  tOut.fill(-1);
  for (let i = 0; i < tOut.length; i++) {
    if (dist[i]! >= 1e8) continue;
    const x = i % TEX;
    const y = (i / TEX) | 0;
    const wob = fbm(x * 0.065, y * 0.065, seed + 41, 4);
    const scallop = fbm(x * 0.17 + 8, y * 0.17, seed + 53, 3);
    const localW = wid[i]! * (1 + (wob * 2 - 1) * RIVER_BANK_WOBBLE + (scallop - 0.5) * 0.4);
    if (dist[i]! > localW) continue;
    tOut[i] = dist[i]! / Math.max(localW, 1e-6);
    biome[i] = BIOME_ID.sand;
  }
  return { t: tOut, near };
}

function terrace(t: number, k: number): number {
  const u = clamp(t, 0, 1) * 2 - 1;
  const a = Math.abs(u);
  if (a < 1e-8) return 0.5;
  return 0.5 + 0.5 * Math.sign(u) * Math.pow(a, k);
}

function remapBand(h: number): number {
  const x = clamp(h, 0, 1);
  for (let i = 0; i < HEIGHT_BANDS.length; i++) {
    const b = HEIGHT_BANDS[i]!;
    if (x < b.hi || i === HEIGHT_BANDS.length - 1) {
      const t = (x - b.lo) / Math.max(1e-6, b.hi - b.lo);
      return b.lo + terrace(t, b.k) * (b.hi - b.lo);
    }
  }
  return x;
}

function biomeSolid(biome: Uint8Array, x: number, y: number, id: number): boolean {
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const xx = x + ox;
      const yy = y + oy;
      if (xx < 0 || yy < 0 || xx >= TEX || yy >= TEX) return false;
      if (biome[yy * TEX + xx] !== id) return false;
    }
  }
  return true;
}

function shadeTerrainTexel(
  raw: Float32Array,
  biome: Uint8Array,
  seed: number,
  theme: ThemeSpec,
  tiles: (ImageData | null)[] | undefined,
  bankT: Float32Array | undefined,
  x: number,
  y: number,
  lakeDepth?: Float32Array,
  mouth?: Float32Array,
  shore?: Float32Array
): [number, number, number] {
  const i = y * TEX + x;
  const raw0 = raw[i]!;
  const b = biome[i]!;
  // Lakes sit above sea level in `raw`; shade them by depth below their own level so they grade like the sea.
  const depth = lakeDepth && lakeDepth[i]! > 0 ? Math.max(1e-4, lakeDepth[i]! - raw0) : 0;
  const h = b === BIOME_ID.water && depth > 0 ? H_WATER - depth * LAKE_SHADE_DEPTH : raw0;
  const n = fbm(x * 0.08, y * 0.08, seed + 99, 2) * 18 - 9;
  const wet = b === BIOME_ID.sand && bankT && bankT[i]! >= 0 ? 1 - bankT[i]! : 0;
  let rgb = baseTerrainColor(theme, b, h, wet, n);
  const tile = tiles?.[b];
  const riverBed = b === BIOME_ID.river && tile;
  const bank = !!(bankT && bankT[i]! >= 0);
  const sandTile = tiles?.[BIOME_ID.sand];
  if (riverBed) {
    const tw = tile.width;
    const th = tile.height;
    const to = ((y % th) * tw + (x % tw)) * 4;
    rgb = [
      overlayChan(rgb[0], tile.data[to]!, 0.7),
      overlayChan(rgb[1], tile.data[to + 1]!, 0.7),
      overlayChan(rgb[2], tile.data[to + 2]!, 0.7),
    ];
    // Near the outlet, fade into the open-water look it flows into (shallow water + water tile).
    const m = mouth ? mouth[i]! : 0;
    if (m > 0) {
      let wrgb = baseTerrainColor(theme, BIOME_ID.water, H_WATER - 0.004, 0, n);
      const wt = tiles?.[BIOME_ID.water];
      if (wt) {
        const wo = ((y % wt.height) * wt.width + (x % wt.width)) * 4;
        wrgb = [
          overlayChan(wrgb[0], wt.data[wo]!, 0.52),
          overlayChan(wrgb[1], wt.data[wo + 1]!, 0.52),
          overlayChan(wrgb[2], wt.data[wo + 2]!, 0.52),
        ];
      }
      rgb = [lerp(rgb[0], wrgb[0], m), lerp(rgb[1], wrgb[1], m), lerp(rgb[2], wrgb[2], m)];
    }
  } else if (bank && sandTile) {
    const tw = sandTile.width;
    const th = sandTile.height;
    const to = ((y % th) * tw + (x % tw)) * 4;
    const ta = 0.48 + (1 - bankT![i]!) * 0.28;
    rgb = [
      overlayChan(rgb[0], sandTile.data[to]!, ta),
      overlayChan(rgb[1], sandTile.data[to + 1]!, ta),
      overlayChan(rgb[2], sandTile.data[to + 2]!, ta),
    ];
  } else if (tile && biomeSolid(biome, x, y, b)) {
    const tw = tile.width;
    const th = tile.height;
    const to = ((y % th) * tw + (x % tw)) * 4;
    rgb = [
      overlayChan(rgb[0], tile.data[to]!, 0.52),
      overlayChan(rgb[1], tile.data[to + 1]!, 0.52),
      overlayChan(rgb[2], tile.data[to + 2]!, 0.52),
    ];
  }
  // Lake shore: fade from wet sand at the water back to the ground's own look across the shore.
  const st = shore ? shore[i]! : -1;
  if (st >= 0 && b !== BIOME_ID.water && b !== BIOME_ID.river) {
    const k = 1 - smooth01(0, 0.6, st);
    if (k > 0) {
      const wetSand = baseTerrainColor(theme, BIOME_ID.sand, h, 1, n);
      rgb = [lerp(rgb[0], wetSand[0], k * 0.85), lerp(rgb[1], wetSand[1], k * 0.85), lerp(rgb[2], wetSand[2], k * 0.85)];
    }
  }
  return rgb;
}

function overlayChan(base: number, tex: number, a: number): number {
  const b = base / 255;
  const t = tex / 255;
  const o = b < 0.5 ? 2 * b * t : 1 - 2 * (1 - b) * (1 - t);
  return clamp((b * (1 - a) + o * a) * 255, 0, 255);
}


function paintTerrain(
  raw: Float32Array,
  biome: Uint8Array,
  seed: number,
  theme: ThemeSpec,
  tiles?: (ImageData | null)[],
  bankT?: Float32Array,
  onProgress?: WorldProgress,
  lakeDepth?: Float32Array,
  mouth?: Float32Array,
  shore?: Float32Array
): ImageData {
  const img = new ImageData(TEX, TEX);
  const d = img.data;
  for (let y = 0; y < TEX; y++) {
    if (y % 150 === 0) onProgress?.(0.82 + (y / TEX) * 0.13, "terrain paint");
    for (let x = 0; x < TEX; x++) {
      const rgb = shadeTerrainTexel(raw, biome, seed, theme, tiles, bankT, x, y, lakeDepth, mouth, shore);
      const o = (y * TEX + x) * 4;
      d[o] = rgb[0];
      d[o + 1] = rgb[1];
      d[o + 2] = rgb[2];
      d[o + 3] = 255;
    }
  }
  return img;
}

function lightTerrainPixel(
  d: Uint8ClampedArray,
  height: Float32Array,
  x: number,
  y: number,
  stride: number,
  ox: number,
  oy: number
): void {
  const i = y * TEX + x;
  terrainLight(height[i + 1]! - height[i - 1]!, height[i + TEX]! - height[i - TEX]!, LIGHT);
  const lit = LIGHT.lit;
  const spec = LIGHT.spec;
  const o = ((y - oy) * stride + (x - ox)) * 4;
  d[o] = clamp(d[o]! * lit + spec, 0, 255);
  d[o + 1] = clamp(d[o + 1]! * lit + spec * 0.92, 0, 255);
  d[o + 2] = clamp(d[o + 2]! * lit + spec * 0.78, 0, 255);
}

export function applyTerrainLight(canvas: HTMLCanvasElement, height: Float32Array): void {
  const g = canvas.getContext("2d", { willReadFrequently: true })!;
  const img = g.getImageData(0, 0, TEX, TEX);
  const d = img.data;
  for (let y = 1; y < TEX - 1; y++) {
    for (let x = 1; x < TEX - 1; x++) {
      lightTerrainPixel(d, height, x, y, TEX, 0, 0);
    }
  }
  g.putImageData(img, 0, 0);
}

function texelInBiome(biome: Uint8Array, tx: number, ty: number, id: number): boolean {
  if (tx < 2 || ty < 2 || tx >= TEX - 2 || ty >= TEX - 2) return false;
  return biome[ty * TEX + tx] === id;
}

function pickBiomeTexel(biome: Uint8Array, rng: Rng, id: number): { tx: number; ty: number } | null {
  for (let k = 0; k < 80; k++) {
    const tx = rng.int(10, TEX - 11);
    const ty = rng.int(10, TEX - 11);
    if (!texelInBiome(biome, tx, ty, id)) continue;
    let n = 0;
    for (let oy = -4; oy <= 4; oy++) {
      for (let ox = -4; ox <= 4; ox++) {
        if (biome[(ty + oy) * TEX + (tx + ox)] === id) n++;
      }
    }
    if (n > 55) return { tx, ty };
  }
  return null;
}

function pushGroup(
  out: Decor[],
  biome: Uint8Array,
  rng: Rng,
  id: number,
  kinds: DecorKind[],
  count: number,
  spacing: number,
  sizeMin: number,
  sizeMax: number,
  at?: { tx: number; ty: number },
  swap?: ThemeSpec["decor"]
): void {
  const c = at ?? pickBiomeTexel(biome, rng, id);
  if (!c) return;
  const cols = Math.max(2, Math.ceil(Math.sqrt(count)));
  const origin = -((cols - 1) * spacing) / 2;
  for (let i = 0; i < count; i++) {
    const gx = i % cols;
    const gy = (i / cols) | 0;
    const jit = spacing * 0.22;
    const tx = Math.round(c.tx + origin + gx * spacing + rng.range(-jit, jit));
    const ty = Math.round(c.ty + origin + gy * spacing + rng.range(-jit, jit));
    if (!texelInBiome(biome, tx, ty, id)) continue;
    const kind = rng.pick(kinds);
    const alt = swap?.[kind];
    out.push({
      kind: alt ? rng.pick(alt) : kind,
      x: (tx + 0.5) * SCALE,
      y: (ty + 0.5) * SCALE,
      size: rng.range(sizeMin, sizeMax),
      rot: rng.range(0, Math.PI * 2),
    });
  }
}

function placeDecor(biome: Uint8Array, rng: Rng, theme: ThemeSpec): Decor[] {
  const out: Decor[] = [];
  const u = TEX / 1400;
  for (let i = 0; i < 52; i++)
    pushGroup(out, biome, rng, BIOME_ID.forest, ["tree", "tree", "pine", "bush"], 6 + rng.int(0, 5), 7 * u, 5.5 * u, 13 * u, undefined, theme.decor);
  for (let i = 0; i < 22; i++)
    pushGroup(out, biome, rng, BIOME_ID.grass, ["tree", "bush", "shrub"], 4 + rng.int(0, 4), 9 * u, 4.5 * u, 10 * u, undefined, theme.decor);
  for (let i = 0; i < 18; i++)
    pushGroup(out, biome, rng, BIOME_ID.grass, ["shrub", "bush", "rock"], 5 + rng.int(0, 3), 6 * u, 3.5 * u, 7 * u, undefined, theme.decor);
  for (let i = 0; i < 24; i++)
    pushGroup(out, biome, rng, BIOME_ID.sand, ["cactus", "cactus2", "shrub"], 3 + rng.int(0, 4), 8 * u, 4 * u, 9.5 * u, undefined, theme.decor);
  for (let i = 0; i < 10; i++)
    pushGroup(out, biome, rng, BIOME_ID.sand, ["rock", "boulder"], 3 + rng.int(0, 2), 7 * u, 4 * u, 8 * u, undefined, theme.decor);
  for (let i = 0; i < 8; i++)
    pushGroup(out, biome, rng, BIOME_ID.sand, ["palm"], 3 + rng.int(0, 2), 11 * u, 6 * u, 12 * u, undefined, theme.decor);
  for (let i = 0; i < 26; i++)
    pushGroup(out, biome, rng, BIOME_ID.rock, ["boulder", "rock", "rock"], 3 + rng.int(0, 3), 6 * u, 4.5 * u, 9 * u, undefined, theme.decor);
  for (let i = 0; i < 8; i++)
    pushGroup(out, biome, rng, BIOME_ID.rock, ["pine", "dead"], 3 + rng.int(0, 2), 10 * u, 5 * u, 11 * u, undefined, theme.decor);
  for (let i = 0; i < 16; i++)
    pushGroup(out, biome, rng, BIOME_ID.peak, ["snowrock", "boulder"], 3 + rng.int(0, 3), 7 * u, 4 * u, 8.5 * u, undefined, theme.decor);
  for (let i = 0; i < 14; i++) {
    const c = pickBiomeTexel(biome, rng, BIOME_ID.sand);
    if (!c) continue;
    let shore = false;
    for (let oy = -3; oy <= 3 && !shore; oy++) {
      for (let ox = -3; ox <= 3; ox++) {
        const b = biome[(c.ty + oy) * TEX + (c.tx + ox)]!;
        if (b === BIOME_ID.water || b === BIOME_ID.river) shore = true;
      }
    }
    if (!shore) continue;
    pushGroup(out, biome, rng, BIOME_ID.sand, ["reed", "shrub"], 5 + rng.int(0, 4), 5 * u, 3.2 * u, 6.5 * u, c, theme.decor);
  }
  return out;
}

export function paintHeightMap(height: Float32Array, roads?: Road[]): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = TEX;
  c.height = TEX;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  const img = g.createImageData(TEX, TEX);
  const d = img.data;
  for (let y = 0; y < TEX; y++) {
    for (let x = 0; x < TEX; x++) {
      const i = y * TEX + x;
      const v = clamp(height[i]!, 0, 1) * 255;
      const o = i * 4;
      d[o] = v;
      d[o + 1] = v;
      d[o + 2] = v;
      d[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  if (roads?.length) paintRoadNodesDebug(g, roads);
  return c;
}

export function paintHeightMapRect(
  canvas: HTMLCanvasElement,
  height: Float32Array,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  roads?: Road[]
): void {
  const g = canvas.getContext("2d", { willReadFrequently: true })!;
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const img = g.createImageData(w, h);
  const d = img.data;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const v = clamp(height[y * TEX + x]!, 0, 1) * 255;
      const o = ((y - y0) * w + (x - x0)) * 4;
      d[o] = v;
      d[o + 1] = v;
      d[o + 2] = v;
      d[o + 3] = 255;
    }
  }
  g.putImageData(img, x0, y0);
  if (roads?.length) paintRoadNodesDebug(g, roads);
}

/** Raw road graph on the height debug map (amber land / cyan water). */
function paintRoadNodesDebug(g: CanvasRenderingContext2D, roads: Road[]): void {
  for (const road of roads) {
    g.strokeStyle = road.spur ? "rgba(200, 160, 80, 0.4)" : "rgba(255, 170, 40, 0.55)";
    g.lineWidth = road.spur ? 0.8 : 1;
    g.beginPath();
    for (let i = 0; i < road.nodes.length; i++) {
      const n = road.nodes[i]!;
      const x = n.x / SCALE;
      const y = n.y / SCALE;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
    for (const n of road.nodes) {
      g.fillStyle = n.water ? "rgba(80, 220, 255, 0.95)" : road.spur ? "rgba(220, 180, 60, 0.75)" : "rgba(255, 140, 20, 0.9)";
      const s = road.spur ? 1.6 : 2.4;
      g.fillRect(n.x / SCALE - s * 0.5, n.y / SCALE - s * 0.5, s, s);
    }
  }
}

export type HeightStamp = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

function sampleMask(mask: Float32Array, w: number, h: number, u: number, v: number): number {
  if (u < 0 || v < 0 || u > 1 || v > 1) return 0;
  const x = clamp(u, 0, 1) * (w - 1.001);
  const y = clamp(v, 0, 1) * (h - 1.001);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const x1 = Math.min(x0 + 1, w - 1);
  const y1 = Math.min(y0 + 1, h - 1);
  const a = mask[y0 * w + x0]!;
  const b = mask[y0 * w + x1]!;
  const c = mask[y1 * w + x0]!;
  const d = mask[y1 * w + x1]!;
  return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
}

export function stampHeightBrush(
  height: Float32Array,
  mask: Float32Array,
  mw: number,
  mh: number,
  wx: number,
  wy: number,
  size: number,
  rot: number,
  offX: number,
  offY: number,
  invert: boolean,
  strength: number
): HeightStamp {
  const tx = wx / SCALE;
  const ty = wy / SCALE;
  const rad = Math.max(4, size / SCALE);
  const c = Math.cos(-rot);
  const s = Math.sin(-rot);
  const x0 = clamp(Math.floor(tx - rad - 2), 1, TEX - 2);
  const y0 = clamp(Math.floor(ty - rad - 2), 1, TEX - 2);
  const x1 = clamp(Math.ceil(tx + rad + 2), 1, TEX - 2);
  const y1 = clamp(Math.ceil(ty + rad + 2), 1, TEX - 2);
  const k = clamp(strength, 0, 1);
  const target = invert ? 0 : 1;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const lx = (x + 0.5 - tx) / rad;
      const ly = (y + 0.5 - ty) / rad;
      const rx = lx * c - ly * s - offX;
      const ry = lx * s + ly * c - offY;
      const u = (rx + 1) * 0.5;
      const v = (ry + 1) * 0.5;
      const m = sampleMask(mask, mw, mh, u, v);
      const a = m * k;
      if (a < 0.004) continue;
      const i = y * TEX + x;
      height[i] = clamp(lerp(height[i]!, target, a), 0, 1);
    }
  }
  return { x0, y0, x1, y1 };
}

function assignBiomeFromHeight(biome: Uint8Array, height: Float32Array, water: Float32Array, seed: number, x: number, y: number): void {
  const i = y * TEX + x;
  const h = height[i]!;
  // Still under its own water surface (lake / river / sea): stays water.
  if (water[i]! >= 0 && h < water[i]!) return;
  if (biome[i] === BIOME_ID.river && h < H_SAND) return;
  biome[i] = classifyBiome(h, moistureAt(x / TEX, y / TEX, seed));
}

export function rebuildWorldPatch(
  world: WorldData,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  tiles: (ImageData | null)[],
  restamp?: (g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) => void
): void {
  x0 = clamp(Math.floor(x0), 1, TEX - 2);
  y0 = clamp(Math.floor(y0), 1, TEX - 2);
  x1 = clamp(Math.ceil(x1), 1, TEX - 2);
  y1 = clamp(Math.ceil(y1), 1, TEX - 2);
  if (x1 < x0 || y1 < y0) return;
  const theme = themeOf(world.theme);
  const themed = themedTiles(theme, tiles);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      assignBiomeFromHeight(world.biome, world.height, world.water, world.seed, x, y);
    }
  }
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const img = new ImageData(w, h);
  const d = img.data;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const rgb = shadeTerrainTexel(world.height, world.biome, world.seed, theme, themed, undefined, x, y);
      const o = ((y - y0) * w + (x - x0)) * 4;
      d[o] = rgb[0];
      d[o + 1] = rgb[1];
      d[o + 2] = rgb[2];
      d[o + 3] = 255;
    }
  }
  const g = world.canvas.getContext("2d", { willReadFrequently: true })!;
  g.putImageData(img, x0, y0);
  restamp?.(g, x0, y0, x1, y1);
  const lit = g.getImageData(x0, y0, w, h);
  const ly0 = Math.max(1, y0);
  const ly1 = Math.min(TEX - 2, y1);
  const lx0 = Math.max(1, x0);
  const lx1 = Math.min(TEX - 2, x1);
  for (let y = ly0; y <= ly1; y++) {
    for (let x = lx0; x <= lx1; x++) {
      lightTerrainPixel(lit.data, world.height, x, y, w, x0, y0);
    }
  }
  g.putImageData(lit, x0, y0);
}

function findSpawn(
  height: Float32Array,
  biome: Uint8Array,
  rng: Rng,
  hintX: number,
  hintY: number
): { spawnX: number; spawnY: number } {
  const cx = clamp(hintX, 0.12, 0.88);
  const cy = clamp(hintY, 0.12, 0.88);
  for (let i = 0; i < 400; i++) {
    const tx = rng.int(TEX * (cx - 0.085), TEX * (cx + 0.085));
    const ty = rng.int(TEX * (cy - 0.085), TEX * (cy + 0.085));
    const b = biome[ty * TEX + tx]!;
    const h = height[ty * TEX + tx]!;
    if (b === BIOME_ID.grass || b === BIOME_ID.sand) {
      if (h > 0.4 && h < 0.55)
        return { spawnX: (tx + 0.5) * SCALE, spawnY: (ty + 0.5) * SCALE };
    }
  }
  // Water-heavy maps: nearest valid pad to the hint anywhere on the map.
  const prefX = TEX * cx;
  const prefY = TEX * cy;
  let best = -1;
  let bestD = Infinity;
  for (let ty = 60; ty < TEX - 60; ty += 6) {
    for (let tx = 60; tx < TEX - 60; tx += 6) {
      const i = ty * TEX + tx;
      const b = biome[i]!;
      const h = height[i]!;
      if (b !== BIOME_ID.grass && b !== BIOME_ID.sand) continue;
      if (h <= 0.4 || h >= 0.55) continue;
      const d = Math.hypot(tx - prefX, ty - prefY);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
  }
  if (best >= 0) return { spawnX: ((best % TEX) + 0.5) * SCALE, spawnY: (Math.floor(best / TEX) + 0.5) * SCALE };
  return { spawnX: WORLD * 0.22, spawnY: WORLD * 0.22 };
}

/** Raise water crossings just above the waterline for bridge decks. */
const ROAD_BRIDGE_CLEAR = 0.018;
/** Min spacing between stored road nodes (texels). */
const ROAD_NODE_STEP = 4.5;
/** Secondary buildings farther than this from a trunk are skipped. */
const ROAD_SPUR_MAX = 420;
/** Spur only to permanent satellite hard-sites near the network (not tents). */
const ROAD_SPUR_KINDS = new Set<UnitKind>(["lookout", "tower"]);

/**
 * MST between HV objectives, then spur roads to secondary building installs.
 * Paths use river-style momentum (stiffer, contour-biased) for smoothness.
 */
function makeRoads(
  hv: HvSpec[],
  spawns: Spawn[],
  height: Float32Array,
  biome: Uint8Array,
  rng: Rng,
  density = 1
): Road[] {
  const roads: Road[] = [];
  if (density <= 0) return roads;
  if (hv.length >= 2) {
    const connected = new Set<number>([0]);
    const remaining = new Set<number>();
    for (let i = 1; i < hv.length; i++) remaining.add(i);

    while (remaining.size) {
      let bestFrom = -1;
      let bestTo = -1;
      let bestD = Infinity;
      for (const fi of connected) {
        const a = hv[fi]!;
        for (const ti of remaining) {
          const b = hv[ti]!;
          const d = Math.hypot(b.x - a.x, b.y - a.y);
          if (d < bestD) {
            bestD = d;
            bestFrom = fi;
            bestTo = ti;
          }
        }
      }
      if (bestFrom < 0 || bestTo < 0) break;
      const from = hv[bestFrom]!;
      const to = hv[bestTo]!;
      const nodes = traceFlowRoad(from.x, from.y, to.x, to.y, height, biome, rng);
      roads.push({
        nodes,
        width: rng.range(11, 15),
        fromHv: from.id,
        toHv: to.id,
      });
      connected.add(bestTo);
      remaining.delete(bestTo);
    }
  }

  // Spur roads to garrison lookouts / AA towers near the trunk (permanent sites).
  const spurMax = ROAD_SPUR_MAX * density;
  let siteN = 0;
  for (const s of spawns) {
    if (s.hv || !ROAD_SPUR_KINDS.has(s.kind)) continue;
    const hitch = nearestTrunkAttach(roads, hv, s.x, s.y);
    if (!hitch || hitch.dist > spurMax) continue;
    if (hitch.dist < 28) continue;
    const nodes = traceFlowRoad(hitch.x, hitch.y, s.x, s.y, height, biome, rng, {
      stiff: 1.15,
      meander: 0.55,
    });
    roads.push({
      nodes,
      width: rng.range(6.5, 9.5),
      fromHv: hitch.fromId,
      toHv: `site-${siteN++}`,
      spur: true,
    });
  }
  return roads;
}

function waterAtTex(biome: Uint8Array, tx: number, ty: number): boolean {
  const x = clamp(Math.round(tx), 0, TEX - 1);
  const y = clamp(Math.round(ty), 0, TEX - 1);
  const b = biome[y * TEX + x]!;
  return b === BIOME_ID.water || b === BIOME_ID.river;
}

function nearestTrunkAttach(
  roads: Road[],
  hv: HvSpec[],
  x: number,
  y: number
): { x: number; y: number; dist: number; fromId: string } | null {
  let best: { x: number; y: number; dist: number; fromId: string } | null = null;
  const consider = (px: number, py: number, fromId: string) => {
    const d = Math.hypot(px - x, py - y);
    if (!best || d < best.dist) best = { x: px, y: py, dist: d, fromId };
  };
  for (const h of hv) consider(h.x, h.y, h.id);
  for (const road of roads) {
    if (road.spur) continue;
    // Stride nodes — trunk polylines are dense; full scan is needless.
    const stride = Math.max(1, (road.nodes.length / 48) | 0);
    for (let i = stride; i < road.nodes.length; i += stride) {
      const a = road.nodes[i - stride]!;
      const b = road.nodes[i]!;
      const abx = b.x - a.x;
      const aby = b.y - a.y;
      const len2 = abx * abx + aby * aby || 1;
      const t = clamp(((x - a.x) * abx + (y - a.y) * aby) / len2, 0, 1);
      consider(a.x + abx * t, a.y + aby * t, road.fromHv);
    }
  }
  return best;
}

type FlowRoadOpts = { stiff?: number; meander?: number };

/**
 * River-style momentum marble steered toward a goal, with stiff contour bias
 * (prefer level travel) and light meander — smoother than coarse A* cells.
 */
function traceFlowRoad(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  height: Float32Array,
  biome: Uint8Array,
  rng: Rng,
  opts: FlowRoadOpts = {}
): RoadNode[] {
  const stiff = opts.stiff ?? 1;
  const meanderMul = opts.meander ?? 1;
  let fx = ax / SCALE;
  let fy = ay / SCALE;
  const gx = bx / SCALE;
  const gy = by / SCALE;
  let dx = gx - fx;
  let dy = gy - fy;
  let dist0 = Math.hypot(dx, dy) || 1;
  let vx = (dx / dist0) * 0.55;
  let vy = (dy / dist0) * 0.55;
  const meanderSeed = rng.next() * 1000;

  // Stiffer than rivers: stronger goal pull, higher drag, weaker wander.
  const GOAL_G = 0.16 * stiff;
  const CONTOUR = 0.48;
  const PEAK_REPEL = 0.04;
  const drag = 0.94;
  const maxSpd = 1.05;
  const meanderAmp = 0.022 * meanderMul;

  const samples: { x: number; y: number }[] = [{ x: fx, y: fy }];
  let still = 0;
  let bestRem = dist0;
  let noProgress = 0;
  // Budget scales with distance but stays well below the old 16k×fbm freeze.
  const maxSteps = Math.min(2800, Math.ceil(dist0 * 3.2) + 120);

  for (let step = 0; step < maxSteps; step++) {
    const toX = gx - fx;
    const toY = gy - fy;
    const rem = Math.hypot(toX, toY);
    if (rem < 2.5) break;

    if (rem < bestRem - 0.35) {
      bestRem = rem;
      noProgress = 0;
    } else if (++noProgress > 90) {
      // Stuck in a contour bowl — abandon flow and finish with a short chord.
      break;
    }

    const ux = toX / rem;
    const uy = toY / rem;
    const near = rem < 40 ? 1.45 : 1;
    // Escalate goal pull when stalled so we don't burn the step budget.
    const stuckBoost = noProgress > 35 ? 1.8 : 1;
    vx += ux * GOAL_G * near * stuckBoost;
    vy += uy * GOAL_G * near * stuckBoost;

    const { ax: sax, ay: say } = slopeAccel(height, fx, fy);
    const slen = Math.hypot(sax, say);
    const contourAmt = noProgress > 35 ? CONTOUR * 0.35 : CONTOUR;
    if (slen > 1e-6) {
      const nx = sax / slen;
      const ny = say / slen;
      const along = vx * nx + vy * ny;
      vx -= nx * along * contourAmt;
      vy -= ny * along * contourAmt;
      const h = sampleH(height, fx, fy);
      if (h > 0.64) {
        vx -= nx * (h - 0.64) * PEAK_REPEL * 40;
        vy -= ny * (h - 0.64) * PEAK_REPEL * 40;
      }
    }

    // Cheap meander (hash noise every few steps) — full fbm each tick froze load.
    if ((step & 3) === 0) {
      const n = fbm(fx * 0.038 + meanderSeed, fy * 0.038, meanderSeed, 2) - 0.5;
      vx += -uy * n * meanderAmp;
      vy += ux * n * meanderAmp;
    }

    vx *= drag;
    vy *= drag;
    let spd = Math.hypot(vx, vy);
    if (spd > maxSpd) {
      vx = (vx / spd) * maxSpd;
      vy = (vy / spd) * maxSpd;
      spd = maxSpd;
    }
    if (spd < 0.08) {
      still++;
      vx += ux * 0.28;
      vy += uy * 0.28;
      if (still > 10) {
        vx += ux * 0.4;
        vy += uy * 0.4;
      }
    } else still = 0;

    fx += vx;
    fy += vy;
    fx = clamp(fx, 2, TEX - 3);
    fy = clamp(fy, 2, TEX - 3);

    const last = samples[samples.length - 1]!;
    if (Math.hypot(fx - last.x, fy - last.y) >= 1.4) {
      samples.push({ x: fx, y: fy });
    }
  }
  // If flow bailed early, don't leave a single huge chord — paint/AI both hate that.
  {
    const last = samples[samples.length - 1]!;
    const rem = Math.hypot(gx - last.x, gy - last.y);
    if (rem > 1.4) {
      const steps = Math.min(48, Math.ceil(rem / 6));
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        samples.push({ x: last.x + (gx - last.x) * t, y: last.y + (gy - last.y) * t });
      }
    } else {
      samples.push({ x: gx, y: gy });
    }
  }

  // Light neighbor smooth (stiffer than river jitter — just round corners).
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 1; i < samples.length - 1; i++) {
      const a = samples[i - 1]!;
      const b = samples[i]!;
      const c = samples[i + 1]!;
      b.x = b.x * 0.55 + (a.x + c.x) * 0.225;
      b.y = b.y * 0.55 + (a.y + c.y) * 0.225;
    }
  }

  const nodes: RoadNode[] = [];
  const pushNode = (tx: number, ty: number) => {
    nodes.push({
      x: tx * SCALE,
      y: ty * SCALE,
      water: waterAtTex(biome, tx, ty),
    });
  };
  pushNode(ax / SCALE, ay / SCALE);
  for (const s of samples) {
    const last = nodes[nodes.length - 1]!;
    if (Math.hypot(s.x * SCALE - last.x, s.y * SCALE - last.y) < ROAD_NODE_STEP * SCALE) continue;
    pushNode(s.x, s.y);
  }
  const end = nodes[nodes.length - 1]!;
  if (Math.hypot(end.x - bx, end.y - by) > 3) pushNode(bx / SCALE, by / SCALE);
  else {
    end.x = bx;
    end.y = by;
    end.water = waterAtTex(biome, bx / SCALE, by / SCALE);
  }
  return nodes;
}

/** Raise bridge decks slightly above water on the heightfield. */
function applyRoadBridgeHeights(height: Float32Array, water: Float32Array, roads: Road[]): void {
  const rad = 2.2;
  for (const road of roads) {
    for (let i = 0; i < road.nodes.length; i++) {
      const n = road.nodes[i]!;
      const next = road.nodes[i + 1];
      const span = n.water || next?.water;
      if (!span) continue;
      const stamps = next
        ? Math.max(1, Math.ceil(Math.hypot(next.x - n.x, next.y - n.y) / (SCALE * 2)))
        : 1;
      for (let s = 0; s <= stamps; s++) {
        const t = stamps === 0 ? 0 : s / stamps;
        const wx = next ? lerp(n.x, next.x, t) : n.x;
        const wy = next ? lerp(n.y, next.y, t) : n.y;
        const cx = wx / SCALE;
        const cy = wy / SCALE;
        const x0 = Math.max(0, Math.floor(cx - rad));
        const x1 = Math.min(TEX - 1, Math.ceil(cx + rad));
        const y0 = Math.max(0, Math.floor(cy - rad));
        const y1 = Math.min(TEX - 1, Math.ceil(cy + rad));
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) {
            if (Math.hypot(x - cx, y - cy) > rad) continue;
            const i = y * TEX + x;
            // Deck just above whatever water it spans.
            if (water[i]! >= 0) height[i] = Math.max(height[i]!, water[i]! + ROAD_BRIDGE_CLEAR);
          }
        }
      }
    }
  }
}

/** Warp road / bridge sprites along stored nodes onto the terrain color canvas. */
export function paintRoadsOntoCanvas(
  canvas: HTMLCanvasElement,
  roads: Road[],
  clip?: { x0: number; y0: number; x1: number; y1: number }
): void {
  const g = canvas.getContext("2d", { willReadFrequently: true })!;
  g.imageSmoothingEnabled = true;
  if (clip) {
    g.save();
    g.beginPath();
    g.rect(clip.x0, clip.y0, clip.x1 - clip.x0 + 1, clip.y1 - clip.y0 + 1);
    g.clip();
  }
  const roadSpr = drawRoadStamp();
  const bridgeSpr = drawBridgeStamp();

  // Trunk first, then spurs so junctions read cleanly.
  const ordered = [...roads].sort((a, b) => Number(!!a.spur) - Number(!!b.spur));
  for (const road of ordered) {
    const halfW = road.width / SCALE;
    let u = 0; // distance along polyline (texels) for continuous texture U
    for (let p = 1; p < road.nodes.length; p++) {
      const a = road.nodes[p - 1]!;
      const b = road.nodes[p]!;
      const ax = a.x / SCALE;
      const ay = a.y / SCALE;
      const bx = b.x / SCALE;
      const by = b.y / SCALE;
      const dx = bx - ax;
      const dy = by - ay;
      const len = Math.hypot(dx, dy) || 1e-6;
      if (clip) {
        const pad = halfW + 4;
        const minX = Math.min(ax, bx) - pad;
        const maxX = Math.max(ax, bx) + pad;
        const minY = Math.min(ay, by) - pad;
        const maxY = Math.max(ay, by) + pad;
        if (maxX < clip.x0 || minX > clip.x1 || maxY < clip.y0 || minY > clip.y1) {
          u += len;
          continue;
        }
      }
      const ang = Math.atan2(dy, dx);
      const waterSeg = a.water || b.water;
      const spr = waterSeg ? bridgeSpr : roadSpr;
      const h = halfW * (waterSeg ? 1.15 : 1) * 2;
      // World length that matches one stamp at this road width (preserve aspect).
      const tile = Math.max(6, (spr.width / Math.max(1, spr.height)) * h);
      const drawLen = len + (p < road.nodes.length - 1 ? 0.45 : 0);
      g.save();
      g.translate(ax, ay);
      g.rotate(ang);
      g.globalAlpha = waterSeg ? 0.92 : road.spur ? 0.72 : 0.8;
      // Warp the stamp as a continuous ribbon along the polyline (no radial stamps).
      // At a tile seam, leftover room can be ~0 so piece never advances — that froze
      // the load bar at 100% on long chords. Always consume at least half a texel.
      let drawn = 0;
      const maxIters = Math.max(8, Math.ceil(drawLen) + 8);
      for (let iter = 0; iter < maxIters && drawn < drawLen - 1e-3; iter++) {
        const u0 = u + drawn;
        let phase = u0 % tile;
        if (phase < 0) phase += tile;
        const toWrap = tile - phase;
        let piece = Math.min(drawLen - drawn, toWrap);
        if (piece < 0.5) {
          drawn += Math.min(drawLen - drawn, 0.5);
          continue;
        }
        const srcStart = (phase / tile) * spr.width;
        const srcW = Math.max(0.5, (piece / tile) * spr.width);
        g.drawImage(spr, srcStart, 0, srcW, spr.height, drawn, -h * 0.5, piece, h);
        drawn += piece;
      }
      g.restore();
      u += len;
    }
  }
  g.globalAlpha = 1;
  if (clip) g.restore();
}

/** Repaint road sprites after a terrain-editor patch rebuild. */
export function paintRoadsRect(
  world: WorldData,
  g: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): void {
  void g;
  x0 = clamp(Math.floor(x0), 0, TEX - 1);
  y0 = clamp(Math.floor(y0), 0, TEX - 1);
  x1 = clamp(Math.ceil(x1), 0, TEX - 1);
  y1 = clamp(Math.ceil(y1), 0, TEX - 1);
  if (x1 < x0 || y1 < y0) return;
  paintRoadsOntoCanvas(world.canvas, world.roads, { x0, y0, x1, y1 });
}

/** Max ground-height span (world z) across a footprint, as a fraction of its radius. */
const FIT_SLOPE_BUILDING = 0.28;
const FIT_SLOPE_GROUND = 0.7;

function footprintR(kind: UnitKind): number {
  const sp = UNIT_SPECS[kind];
  return sp.box ? Math.max(sp.box.halfW, sp.box.halfL) : sp.radius;
}

/** Whole footprint on legal ground: dry + not across a cliff (land), open water (boats), anything (air). */
function spawnFits(height: Uint8Array | Float32Array, biome: Uint8Array, kind: UnitKind, x: number, y: number): boolean {
  const sp = UNIT_SPECS[kind];
  if (sp.aerial) return true;
  const r = footprintR(kind) * (sp.water ? 1.4 : 1);
  let lo = Infinity;
  let hi = -Infinity;
  for (let k = 0; k < 17; k++) {
    const ring = k === 0 ? 0 : k <= 8 ? r : r * 0.5;
    const a = (k % 8) * (Math.PI / 4) + (k > 8 ? Math.PI / 8 : 0);
    const tx = Math.floor((x + Math.cos(a) * ring) / SCALE);
    const ty = Math.floor((y + Math.sin(a) * ring) / SCALE);
    if (tx < 1 || ty < 1 || tx >= TEX - 1 || ty >= TEX - 1) return false;
    const i = ty * TEX + tx;
    const b = biome[i]!;
    const wet = b === BIOME_ID.water || b === BIOME_ID.river;
    if (wet !== !!sp.water) return false;
    const h = height[i]!;
    if (h < lo) lo = h;
    if (h > hi) hi = h;
  }
  if (sp.water) return true;
  const span = (hi - lo) * GROUND_Z_SCALE;
  return span <= Math.max(4, r * (sp.building ? FIT_SLOPE_BUILDING : FIT_SLOPE_GROUND));
}

/** Objective terrain preference: high ground, deep + flat, by the water, under cover. */
type SiteRole = "high" | "stronghold" | "shore" | "hidden";

/** Coarse terrain features for objective siting. */
interface SiteGrid {
  n: number;
  h: Float32Array;
  prom: Float32Array;
  slope: Float32Array;
  shore: Float32Array;
  forest: Float32Array;
  comp: Int32Array;
  compSize: Int32Array;
  largestComp: number;
  /** One landmass holds most of the land (vs an archipelago). */
  mainland: boolean;
  hasWater: boolean;
  compAt(x: number, y: number): number;
}

const SITE_STEP = 6;
const SITE_PROM_R = 16;
const SITE_FOREST_R = 3;
/** Smallest landmass (cells) worth an objective + garrison. */
const SITE_MIN_COMP = 160;
const SITE_MAX_SLOPE = 0.05;

function boxMean(src: Float32Array, n: number, r: number): Float32Array {
  const sat = new Float64Array((n + 1) * (n + 1));
  for (let y = 0; y < n; y++) {
    let row = 0;
    for (let x = 0; x < n; x++) {
      row += src[y * n + x]!;
      sat[(y + 1) * (n + 1) + x + 1] = sat[y * (n + 1) + x + 1]! + row;
    }
  }
  const out = new Float32Array(n * n);
  for (let y = 0; y < n; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(n, y + r + 1);
    for (let x = 0; x < n; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(n, x + r + 1);
      const sum = sat[y1 * (n + 1) + x1]! - sat[y0 * (n + 1) + x1]! - sat[y1 * (n + 1) + x0]! + sat[y0 * (n + 1) + x0]!;
      out[y * n + x] = sum / ((y1 - y0) * (x1 - x0));
    }
  }
  return out;
}

function buildSiteGrid(height: Float32Array, biome: Uint8Array): SiteGrid {
  const n = Math.floor(TEX / SITE_STEP);
  const N = n * n;
  const h = new Float32Array(N);
  const land = new Uint8Array(N);
  const forestF = new Float32Array(N);
  const slope = new Float32Array(N);
  let hasWater = false;
  for (let cy = 0; cy < n; cy++) {
    for (let cx = 0; cx < n; cx++) {
      const tx = cx * SITE_STEP + (SITE_STEP >> 1);
      const ty = cy * SITE_STEP + (SITE_STEP >> 1);
      const i = ty * TEX + tx;
      const c = cy * n + cx;
      h[c] = height[i]!;
      const b = biome[i]!;
      land[c] = b === BIOME_ID.water || b === BIOME_ID.river ? 0 : 1;
      if (!land[c]) hasWater = true;
      forestF[c] = b === BIOME_ID.forest ? 1 : 0;
      const xa = clamp(tx - SITE_STEP, 0, TEX - 1);
      const xb = clamp(tx + SITE_STEP, 0, TEX - 1);
      const ya = clamp(ty - SITE_STEP, 0, TEX - 1);
      const yb = clamp(ty + SITE_STEP, 0, TEX - 1);
      slope[c] = Math.hypot(height[ty * TEX + xb]! - height[ty * TEX + xa]!, height[yb * TEX + tx]! - height[ya * TEX + tx]!);
    }
  }
  const mean = boxMean(h, n, SITE_PROM_R);
  const prom = new Float32Array(N);
  for (let c = 0; c < N; c++) prom[c] = h[c]! - mean[c]!;
  // Distance to water (cells), multi-source BFS.
  const shore = new Float32Array(N).fill(1e9);
  const q = new Int32Array(N);
  let qh = 0;
  let qt = 0;
  for (let c = 0; c < N; c++) if (!land[c]) (shore[c] = 0), (q[qt++] = c);
  while (qh < qt) {
    const c = q[qh++]!;
    const cx = c % n;
    const cy = (c / n) | 0;
    const d = shore[c]! + 1;
    if (cx > 0 && shore[c - 1]! > d) (shore[c - 1] = d), (q[qt++] = c - 1);
    if (cx < n - 1 && shore[c + 1]! > d) (shore[c + 1] = d), (q[qt++] = c + 1);
    if (cy > 0 && shore[c - n]! > d) (shore[c - n] = d), (q[qt++] = c - n);
    if (cy < n - 1 && shore[c + n]! > d) (shore[c + n] = d), (q[qt++] = c + n);
  }
  // Landmass ids.
  const comp = new Int32Array(N).fill(-1);
  const sizes: number[] = [];
  for (let c0 = 0; c0 < N; c0++) {
    if (!land[c0] || comp[c0]! >= 0) continue;
    const id = sizes.length;
    let size = 0;
    qh = qt = 0;
    q[qt++] = c0;
    comp[c0] = id;
    while (qh < qt) {
      const c = q[qh++]!;
      size++;
      const cx = c % n;
      const cy = (c / n) | 0;
      const nb = [cx > 0 ? c - 1 : -1, cx < n - 1 ? c + 1 : -1, cy > 0 ? c - n : -1, cy < n - 1 ? c + n : -1];
      for (const k of nb) if (k >= 0 && land[k] && comp[k]! < 0) (comp[k] = id), (q[qt++] = k);
    }
    sizes.push(size);
  }
  const largestComp = sizes.reduce((a, b) => Math.max(a, b), 0);
  const landTotal = sizes.reduce((a, b) => a + b, 0);
  const compSize = new Int32Array(N);
  for (let c = 0; c < N; c++) compSize[c] = comp[c]! >= 0 ? sizes[comp[c]!]! : 0;
  const forest = boxMean(forestF, n, SITE_FOREST_R);
  const compAt = (x: number, y: number) => {
    const cx = clamp(Math.floor(x / SCALE / SITE_STEP), 0, n - 1);
    const cy = clamp(Math.floor(y / SCALE / SITE_STEP), 0, n - 1);
    return comp[cy * n + cx]!;
  };
  return { n, h, prom, slope, shore, forest, comp, compSize, largestComp, mainland: largestComp > landTotal * 0.6, hasWater, compAt };
}

function siteScore(g: SiteGrid, c: number, role: SiteRole, spawnN: number): number {
  const hN = clamp((g.h[c]! - H_SAND) / (H_PEAK - H_SAND), 0, 1);
  const promN = clamp(g.prom[c]! / 0.08, -1, 1);
  const flat = 1 - clamp(g.slope[c]! / SITE_MAX_SLOPE, 0, 1);
  const shoreN = g.hasWater ? Math.exp(-g.shore[c]! / 6) : 0;
  switch (role) {
    case "high":
      return 1.2 * promN + 0.6 * hN + 0.3 * flat;
    case "stronghold":
      return 1.1 * spawnN + 0.7 * flat + 0.3 * hN - 0.4 * shoreN;
    case "shore":
      return (g.hasWater ? 1.1 * shoreN : 0) + 0.5 * flat + 0.6 * (1 - Math.abs(spawnN - 0.4) * 2);
    case "hidden":
      return 1.2 * g.forest[c]! - 0.4 * promN + 0.3 * spawnN;
  }
}

/** Best-scoring legal site for a role (with jitter), or null. */
function pickSite(
  g: SiteGrid,
  role: SiteRole,
  rng: Rng,
  spawnX: number,
  spawnY: number,
  used: { x: number; y: number }[],
  usedComps: Set<number>,
  fits: (x: number, y: number) => boolean,
  keep?: { x: number; y: number }
): { x: number; y: number } | null {
  const n = g.n;
  const margin = Math.ceil(80 / SITE_STEP);
  const reach = WORLD * 0.9;
  let best = -Infinity;
  let bx = 0;
  let by = 0;
  for (let cy = margin; cy < n - margin; cy++) {
    for (let cx = margin; cx < n - margin; cx++) {
      const c = cy * n + cx;
      if (g.comp[c]! < 0 || g.compSize[c]! < SITE_MIN_COMP) continue;
      if (g.h[c]! > H_PEAK || g.slope[c]! > SITE_MAX_SLOPE || g.shore[c]! < 2) continue;
      const x = (cx * SITE_STEP + SITE_STEP * 0.5) * SCALE;
      const y = (cy * SITE_STEP + SITE_STEP * 0.5) * SCALE;
      const spawnD = Math.hypot(x - spawnX, y - spawnY);
      if (spawnD < 700) continue;
      let near = false;
      for (const u of used) if (Math.hypot(u.x - x, u.y - y) < 900) (near = true);
      if (near) continue;
      let score = siteScore(g, c, role, spawnD / reach) + rng.range(0, 0.35);
      // Archipelago: spread across islands. Mainland: stay off stray islets.
      if (!g.mainland) score += usedComps.has(g.comp[c]!) ? 0 : 0.6;
      else if (g.compSize[c]! < g.largestComp * 0.25) score -= 0.8;
      if (keep && role === "stronghold") score += 1.2 * Math.exp(-((Math.hypot(x / WORLD - keep.x, y / WORLD - keep.y) / 0.12) ** 2));
      if (score > best && fits(x, y)) {
        best = score;
        bx = x;
        by = y;
      }
    }
  }
  return best > -Infinity ? { x: bx, y: by } : null;
}

const SPAWN_TRIES = 6;

/** Original siting: first random dry, non-peak spot clear of spawn + other objectives. */
function scatterSite(
  height: Float32Array,
  biome: Uint8Array,
  rng: Rng,
  spawnX: number,
  spawnY: number,
  used: { x: number; y: number }[],
  fits: (x: number, y: number) => boolean
): { x: number; y: number } | null {
  for (let t = 0; t < 200; t++) {
    const tx = rng.int(80, TEX - 81);
    const ty = rng.int(80, TEX - 81);
    const b = biome[ty * TEX + tx]!;
    const h = height[ty * TEX + tx]!;
    const x = (tx + 0.5) * SCALE;
    const y = (ty + 0.5) * SCALE;
    if (b === BIOME_ID.water || b === BIOME_ID.river || h > 0.74) continue;
    if (Math.hypot(x - spawnX, y - spawnY) < 700) continue;
    if (used.some((u) => Math.hypot(u.x - x, u.y - y) < 900)) continue;
    if (!fits(x, y)) continue;
    return { x, y };
  }
  return null;
}

function placeForces(
  height: Float32Array,
  biome: Uint8Array,
  rng: Rng,
  spawnX: number,
  spawnY: number,
  profile: WorldGenProfile,
  keep?: { x: number; y: number }
): { hv: HvSpec[]; spawns: Spawn[] } {
  const hv: HvSpec[] = [];
  const spawns: Spawn[] = [];
  const names: [HvKind, string, SiteRole][] = [
    ["bunker", "Command Bunker", "stronghold"],
    ["radar", "Radar Site", "high"],
    ["tower", "AA Battery", "high"],
    ["fob", "Forward Base", "shore"],
    ["lookout", "Lookout Post", "high"],
    ["officer", "Field Officer", "hidden"],
    ["bunker", "Ammo Dump", "stronghold"],
    ["radar", "Forward HQ", "shore"],
  ];
  for (let i = names.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    const tmp = names[i]!;
    names[i] = names[j]!;
    names[j] = tmp;
  }

  const used: { x: number; y: number }[] = [{ x: spawnX, y: spawnY }];
  const buildings: { x: number; y: number; r: number }[] = [];
  // Footprint on legal ground, and buildings clear of each other (units may stand anywhere off them).
  const placeable = (kind: UnitKind, px: number, py: number) => {
    if (!spawnFits(height, biome, kind, px, py)) return false;
    const r = footprintR(kind);
    for (const b of buildings) if (Math.hypot(b.x - px, b.y - py) < b.r + r + 6) return false;
    return true;
  };
  const sites = buildSiteGrid(height, biome);
  const usedComps = new Set<number>([sites.compAt(spawnX, spawnY)]);
  const count = profile.objectiveCount;
  for (let i = 0; i < count; i++) {
    let x = 0,
      y = 0,
      ok = false;
    const hvKind = names[i]![0];
    const fits = (fx: number, fy: number) => spawnFits(height, biome, hvKind, fx, fy);
    const pick =
      profile.siting === "scattered"
        ? scatterSite(height, biome, rng, spawnX, spawnY, used, fits)
        : pickSite(sites, names[i]![2], rng, spawnX, spawnY, used, usedComps, fits, keep);
    if (pick) {
      x = pick.x;
      y = pick.y;
      ok = true;
    }
    if (!ok) {
      let bestScore = -Infinity;
      for (let ty = 60; ty < TEX - 60; ty += 18) {
        for (let tx = 60; tx < TEX - 60; tx += 18) {
          const b = biome[ty * TEX + tx]!;
          const h = height[ty * TEX + tx]!;
          if (b === BIOME_ID.water || b === BIOME_ID.river || b === BIOME_ID.peak || h > 0.78) continue;
          const wx = (tx + 0.5) * SCALE;
          const wy = (ty + 0.5) * SCALE;
          const spawnD = Math.hypot(wx - spawnX, wy - spawnY);
          if (spawnD < 500) continue;
          if (!fits(wx, wy)) continue;
          let spacing = spawnD;
          for (const p of used) spacing = Math.min(spacing, Math.hypot(wx - p.x, wy - p.y));
          if (spacing > bestScore) {
            bestScore = spacing;
            x = wx;
            y = wy;
          }
        }
      }
      ok = bestScore > 0;
    }
    if (!ok) continue;
    used.push({ x, y });
    usedComps.add(sites.compAt(x, y));
    const [kind, name] = names[i]!;
    const id = `hv-${i}`;
    hv.push({ id, name, kind, x, y });
    spawns.push({ kind, x, y, hv: id });
    buildings.push({ x, y, r: footprintR(kind) });
    const garrison = Math.max(3, Math.round((8 + rng.int(0, 6)) * profile.garrisonScale));
    for (let k = 0; k < garrison; k++) {
      const gk = pickGarrison(rng, profile.forceMix);
      for (let t = 0; t < SPAWN_TRIES; t++) {
        const a = rng.range(0, Math.PI * 2);
        // Widen on retries so cramped sites (benches, islets) still get their garrison.
        const d = rng.range(60, 280 + t * 90);
        const gx = x + Math.cos(a) * d;
        const gy = y + Math.sin(a) * d;
        if (!placeable(gk, gx, gy)) continue;
        spawns.push({ kind: gk, x: gx, y: gy });
        if (UNIT_SPECS[gk].building) buildings.push({ x: gx, y: gy, r: footprintR(gk) });
        break;
      }
    }
    if (rng.chance(0.55)) {
      const bk: UnitKind = rng.chance(0.5) ? "tent" : "barn";
      for (let t = 0; t < SPAWN_TRIES; t++) {
        const bx = x + rng.range(-90, 90) * (1 + t * 0.4);
        const by = y + rng.range(-90, 90) * (1 + t * 0.4);
        if (!placeable(bk, bx, by)) continue;
        spawns.push({ kind: bk, x: bx, y: by });
        buildings.push({ x: bx, y: by, r: footprintR(bk) });
        break;
      }
    }
    if (rng.chance(0.7)) {
      spawns.push({
        kind: pickAir(rng),
        x: x + rng.range(-200, 200),
        y: y + rng.range(-200, 200),
      });
    }
  }

  for (let i = 0; i < profile.patrolCount; i++) {
    const tx = rng.int(60, TEX - 61);
    const ty = rng.int(60, TEX - 61);
    const b = biome[ty * TEX + tx]!;
    const x = (tx + 0.5) * SCALE;
    const y = (ty + 0.5) * SCALE;
    if (Math.hypot(x - spawnX, y - spawnY) < 400) continue;
    if (b === BIOME_ID.water || b === BIOME_ID.river) {
      if (rng.chance(Math.min(1, profile.waterPatrolBias))) {
        const wk = pickWater(rng);
        if (placeable(wk, x, y)) spawns.push({ kind: wk, x, y });
      }
    } else if (b !== BIOME_ID.peak) {
      if (rng.chance(Math.min(1, 1 / Math.max(0.1, profile.waterPatrolBias)))) {
        const pk = pickPatrol(rng, profile.forceMix);
        if (placeable(pk, x, y)) spawns.push({ kind: pk, x, y });
      }
    }
  }
  return { hv, spawns };
}

function pickGarrison(rng: Rng, mix: WorldGenProfile["forceMix"] = "mixed"): UnitKind {
  const r = rng.next();
  if (mix === "heavy") {
    if (r < 0.3) return "tank";
    if (r < 0.48) return "lav";
    if (r < 0.62) return "lav_aa";
    if (r < 0.74) return "sam";
    if (r < 0.84) return "tower";
    return pickTroop(() => rng.next());
  }
  if (mix === "naval") {
    if (r < 0.16) return "lav_aa";
    if (r < 0.3) return "pickup";
    if (r < 0.42) return "motorcycle";
    if (r < 0.52) return "lookout";
    return pickTroop(() => rng.next());
  }
  if (r < 0.12) return "tank";
  if (r < 0.17) return "lav";
  if (r < 0.22) return "lav_aa";
  if (r < 0.26) return "sam";
  if (r < 0.34) return "pickup";
  if (r < 0.4) return "motorcycle";
  if (r < 0.46) return "truck";
  if (r < 0.5) return "tanker";
  if (r < 0.54) return "tower";
  if (r < 0.58) return "lookout";
  return pickTroop(() => rng.next());
}

function pickPatrol(rng: Rng, mix: WorldGenProfile["forceMix"] = "mixed"): UnitKind {
  const r = rng.next();
  if (mix === "heavy") {
    if (r < 0.34) return "tank";
    if (r < 0.52) return "lav";
    if (r < 0.65) return "lav_aa";
    if (r < 0.75) return "sam";
    if (r < 0.84) return "truck";
    return pickTroop(() => rng.next());
  }
  if (mix === "naval") {
    if (r < 0.22) return pickAir(rng);
    if (r < 0.38) return "pickup";
    if (r < 0.5) return "motorcycle";
    if (r < 0.62) return "lav_aa";
    return pickTroop(() => rng.next());
  }
  if (r < 0.16) return "tank";
  if (r < 0.21) return "lav";
  if (r < 0.26) return "lav_aa";
  if (r < 0.32) return "pickup";
  if (r < 0.4) return "motorcycle";
  if (r < 0.46) return "truck";
  if (r < 0.5) return "tanker";
  if (r < 0.56) return pickAir(rng);
  if (r < 0.8) return pickTroop(() => rng.next());
  if (r < 0.86) return "tent";
  if (r < 0.9) return "barn";
  return pickTroop(() => rng.next());
}

function pickAir(rng: Rng): UnitKind {
  const r = rng.next();
  if (r < 0.28) return "drone";
  if (r < 0.5) return "heli_small";
  if (r < 0.68) return "heli_heavy";
  return "heli";
}

function pickWater(rng: Rng): UnitKind {
  const r = rng.next();
  if (r < 0.18) return "battleship";
  if (r < 0.55) return "ptboat";
  return "boat";
}
