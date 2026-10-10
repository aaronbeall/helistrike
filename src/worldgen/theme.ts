/** Terrain themes: per-biome palette, tile texture + tint, and doodad swaps. Visual only; biome rules are unchanged. */
import type { DoodadKind } from "./world";

export type TerrainTheme =
  | "temperate"
  | "autumn"
  | "arctic"
  | "desert"
  | "tropic"
  | "coastal"
  | "savanna"
  | "swamp"
  | "volcanic"
  | "alien";
export type RGB = [number, number, number];

/** Biome slot order matches world BIOME_ID: water, river, sand, grass, forest, rock, peak. */
export interface BiomeLook {
  /** Base color at t = 0 (shallow water, dry sand, low ground, snow line). */
  lo: RGB;
  /** Base color at t = 1 (deep water, wet sand, high ground, full snow). */
  hi: RGB;
  /** Per-channel weight of the fine color noise. */
  nz: RGB;
  /** Source tile, by biome slot. */
  tile: number;
  /** Recolor the tile to this mean color (keeps its detail). */
  tint?: RGB;
}

export interface ThemeSpec {
  id: TerrainTheme;
  label: string;
  description: string;
  looks: BiomeLook[];
  /** Doodad substitutions (picked at random when several). */
  doodads: Partial<Record<DoodadKind, DoodadKind[]>>;
}

const look = (lo: RGB, hi: RGB, nz: RGB, tile: number, tint?: RGB): BiomeLook => ({ lo, hi, nz, tile, tint });
const N1: RGB = [1, 1, 0];

export const TERRAIN_THEMES: Record<TerrainTheme, ThemeSpec> = {
  temperate: {
    id: "temperate",
    label: "TEMPERATE",
    description: "Green grassland and forest, rocky highlands and snow-capped peaks.",
    looks: [
      look([28, 72, 92], [28, 50, 82], [0.3, 0, 0], 0),
      look([48, 52, 40], [48, 52, 40], [0.25, 0.2, 0], 1),
      look([196, 168, 112], [124, 120, 94], [1, 0.6, 0], 2),
      look([110, 124, 62], [150, 152, 62], [1, 0.5, 0], 3),
      look([42, 78, 44], [42, 98, 44], [0.4, 0, 0], 4),
      look([92, 86, 78], [92, 86, 78], N1, 5),
      look([140, 138, 132], [220, 218, 222], N1, 6),
    ],
    doodads: {},
  },
  autumn: {
    id: "autumn",
    label: "AUTUMN",
    description: "Golden grass, rust and amber woods, bare trees and evergreens, cool grey water and rugged bare peaks.",
    looks: [
      look([34, 64, 78], [24, 46, 66], [0.3, 0.1, 0], 0),
      look([52, 50, 40], [52, 50, 40], [0.25, 0.2, 0], 1),
      look([176, 150, 104], [118, 108, 86], [1, 0.6, 0.2], 2),
      look([132, 118, 66], [160, 136, 72], [1, 0.6, 0.2], 3, [146, 128, 72]),
      look([146, 70, 34], [180, 100, 40], [0.6, 0.4, 0], 4, [164, 84, 38]),
      look([104, 92, 82], [104, 92, 82], N1, 5),
      look([86, 80, 74], [128, 118, 106], N1, 5, [100, 92, 84]),
    ],
    doodads: {
      tree: ["tree_amber", "tree_red", "tree_gold", "tree_amber", "pine", "dead"],
      bush: ["bush_rust", "shrub", "bush_rust"],
      palm: ["pine"],
      cactus: ["shrub"],
      cactus2: ["dead"],
      snowrock: ["boulder"],
    },
  },
  arctic: {
    id: "arctic",
    label: "ARCTIC",
    description: "Snowfields and pine taiga, icy shores, cold dark water and frozen summits.",
    looks: [
      look([46, 80, 100], [28, 54, 78], [0.3, 0.3, 0.3], 0, [72, 104, 124]),
      look([62, 80, 92], [62, 80, 92], [0.25, 0.25, 0.25], 1, [90, 112, 124]),
      look([170, 176, 182], [116, 124, 132], [0.6, 0.6, 0.6], 2, [186, 192, 198]),
      look([168, 176, 188], [222, 228, 238], [0.5, 0.5, 0.5], 6, [222, 228, 236]),
      look([46, 70, 50], [60, 88, 62], [0.4, 0.4, 0.3], 4, [70, 94, 70]),
      look([100, 102, 108], [100, 102, 108], N1, 5, [118, 120, 126]),
      look([196, 206, 218], [250, 252, 255], [0.6, 0.6, 0.6], 6),
    ],
    doodads: {
      tree: ["pine"],
      palm: ["pine"],
      bush: ["snowrock", "pine"],
      shrub: ["dead", "snowrock"],
      cactus: ["snowrock"],
      cactus2: ["dead"],
      reed: ["dead"],
      rock: ["snowrock"],
    },
  },
  desert: {
    id: "desert",
    label: "DESERT",
    description: "Dunes and sun-baked hardpan, oasis scrub, red rock and pale caprock.",
    looks: [
      look([44, 112, 114], [30, 80, 94], [0.3, 0.2, 0], 0),
      look([70, 92, 80], [70, 92, 80], [0.25, 0.2, 0], 1),
      look([216, 182, 126], [160, 130, 92], [1, 0.7, 0.3], 2),
      look([170, 134, 88], [206, 170, 114], [1, 0.7, 0.3], 3, [190, 156, 106]),
      look([104, 106, 60], [124, 122, 68], [0.5, 0.4, 0], 4, [112, 110, 64]),
      look([156, 98, 64], [156, 98, 64], [1, 0.7, 0.4], 5),
      look([186, 146, 106], [216, 184, 142], [1, 0.8, 0.5], 5, [204, 166, 124]),
    ],
    doodads: {
      tree: ["palm", "dead", "cactus"],
      pine: ["dead", "palm"],
      bush: ["shrub", "cactus2"],
      reed: ["shrub"],
      snowrock: ["boulder"],
    },
  },
  tropic: {
    id: "tropic",
    label: "TROPIC",
    description: "Turquoise water, white beaches, dense jungle and dark volcanic peaks.",
    looks: [
      look([36, 128, 130], [20, 72, 104], [0.3, 0.2, 0], 0),
      look([52, 86, 62], [52, 86, 62], [0.25, 0.2, 0], 1),
      look([228, 214, 172], [170, 156, 120], [0.8, 0.7, 0.4], 2, [230, 216, 176]),
      look([66, 116, 48], [92, 148, 58], [0.6, 0.6, 0], 3, [80, 132, 56]),
      look([22, 66, 30], [28, 90, 38], [0.4, 0.4, 0], 4, [32, 84, 38]),
      look([68, 76, 58], [68, 76, 58], N1, 5, [80, 86, 66]),
      look([78, 72, 68], [108, 102, 98], N1, 5, [86, 80, 76]),
    ],
    doodads: {
      tree: ["tree", "palm"],
      pine: ["palm", "tree"],
      cactus: ["bush"],
      cactus2: ["shrub"],
      dead: ["tree"],
      snowrock: ["boulder"],
    },
  },
  coastal: {
    id: "coastal",
    label: "COASTAL",
    description: "Sandy beaches, green hills, olive woods and pale limestone ridges.",
    looks: [
      look([30, 92, 112], [20, 58, 90], [0.3, 0.2, 0], 0),
      look([46, 62, 52], [46, 62, 52], [0.25, 0.2, 0], 1),
      look([214, 196, 150], [148, 136, 106], [1, 0.7, 0.3], 2, [216, 200, 158]),
      look([98, 128, 62], [132, 152, 70], [1, 0.6, 0], 3),
      look([34, 82, 42], [40, 104, 50], [0.4, 0.3, 0], 4, [40, 92, 46]),
      look([150, 146, 132], [150, 146, 132], N1, 5, [158, 152, 138]),
      look([172, 168, 156], [216, 214, 206], N1, 6),
    ],
    doodads: {
      cactus: ["shrub"],
      cactus2: ["bush"],
      pine: ["tree", "pine"],
      snowrock: ["boulder"],
    },
  },
  savanna: {
    id: "savanna",
    label: "SAVANNA",
    description: "Golden grassland, red earth, lone olive-green trees, dry scrub and rust-red rock.",
    looks: [
      look([52, 92, 88], [36, 66, 70], [0.3, 0.2, 0], 0),
      look([70, 78, 56], [70, 78, 56], [0.25, 0.2, 0], 1),
      look([184, 120, 76], [140, 96, 66], [1, 0.6, 0.3], 2, [180, 118, 78]),
      look([178, 150, 82], [204, 176, 98], [1, 0.7, 0.2], 3, [190, 160, 88]),
      look([112, 112, 58], [132, 128, 66], [0.6, 0.5, 0], 4, [120, 116, 62]),
      look([138, 92, 64], [138, 92, 64], [1, 0.7, 0.4], 5, [142, 94, 66]),
      look([160, 116, 82], [186, 146, 108], [1, 0.7, 0.4], 5, [170, 128, 92]),
    ],
    doodads: {
      tree: ["tree_olive", "tree_olive", "dead", "shrub"],
      pine: ["tree_olive", "dead"],
      palm: ["tree_olive"],
      bush: ["bush_dry", "shrub"],
      cactus: ["shrub"],
      cactus2: ["bush_dry"],
      reed: ["shrub"],
      snowrock: ["boulder"],
    },
  },
  swamp: {
    id: "swamp",
    label: "SWAMP",
    description: "Murky green water, mudflats and reed beds, drooping dark woods and mossy stone.",
    looks: [
      look([56, 72, 50], [34, 48, 36], [0.2, 0.3, 0], 0, [60, 76, 52]),
      look([56, 64, 44], [56, 64, 44], [0.25, 0.2, 0], 1, [62, 70, 48]),
      look([98, 90, 62], [72, 68, 50], [0.6, 0.5, 0.2], 2, [96, 88, 62]),
      look([86, 104, 56], [104, 118, 62], [0.8, 0.6, 0], 3, [92, 108, 58]),
      look([34, 58, 34], [40, 70, 40], [0.4, 0.3, 0], 4, [38, 62, 36]),
      look([80, 84, 68], [80, 84, 68], N1, 5, [84, 88, 70]),
      look([96, 100, 84], [120, 122, 104], N1, 5, [104, 108, 90]),
    ],
    doodads: {
      tree: ["tree_swamp", "tree_swamp", "dead", "tree"],
      pine: ["tree_swamp", "dead"],
      palm: ["tree_swamp"],
      bush: ["bush_swamp", "reed"],
      shrub: ["reed", "bush_swamp"],
      cactus: ["reed"],
      cactus2: ["reed"],
      snowrock: ["boulder"],
    },
  },
  volcanic: {
    id: "volcanic",
    label: "VOLCANIC",
    description: "Molten seas, black sand, ash plains, dead and scorched woods, basalt ridges and smouldering summits.",
    looks: [
      // Lava-coloured water: looks only, still behaves as water.
      look([148, 50, 12], [96, 22, 8], [0.4, 0.2, 0], 0, [170, 64, 18]),
      look([150, 60, 20], [150, 60, 20], [0.4, 0.2, 0], 1, [160, 64, 20]),
      look([62, 58, 56], [44, 42, 42], [0.5, 0.5, 0.5], 2, [64, 60, 58]),
      look([92, 90, 80], [112, 108, 96], [0.6, 0.6, 0.5], 3, [98, 96, 86]),
      look([58, 64, 46], [66, 72, 52], [0.4, 0.3, 0], 4, [60, 66, 48]),
      look([46, 44, 44], [46, 44, 44], N1, 5, [52, 50, 50]),
      look([40, 36, 36], [96, 56, 40], [0.8, 0.5, 0.3], 5, [46, 42, 42]),
    ],
    doodads: {
      tree: ["dead", "tree_ash", "dead"],
      pine: ["dead", "tree_ash"],
      palm: ["dead"],
      bush: ["shrub", "rock"],
      shrub: ["shrub", "dead"],
      cactus: ["rock"],
      cactus2: ["dead"],
      reed: ["dead"],
      snowrock: ["boulder"],
    },
  },
  alien: {
    id: "alien",
    label: "ALIEN",
    description: "Glowing teal seas, violet plains, magenta fronds, indigo rock and crystal peaks.",
    looks: [
      look([24, 110, 120], [18, 50, 90], [0.3, 0.3, 0.3], 0, [40, 120, 130]),
      look([40, 60, 80], [40, 60, 80], [0.25, 0.25, 0.25], 1, [52, 72, 96]),
      look([176, 156, 190], [124, 108, 140], [0.7, 0.6, 0.8], 2, [172, 152, 188]),
      look([118, 72, 138], [146, 92, 160], [0.8, 0.5, 0.8], 3, [128, 80, 148]),
      look([26, 96, 96], [30, 120, 116], [0.3, 0.6, 0.6], 4, [30, 104, 104]),
      look([70, 64, 96], [70, 64, 96], [0.6, 0.6, 0.8], 5, [76, 70, 104]),
      look([120, 170, 190], [200, 236, 240], [0.5, 0.7, 0.7], 6, [170, 214, 224]),
    ],
    doodads: {
      tree: ["tree_teal", "tree_violet", "tree_violet"],
      pine: ["tree_teal"],
      palm: ["tree_magenta"],
      dead: ["tree_violet"],
      bush: ["bush_magenta", "tree_teal"],
      shrub: ["bush_magenta"],
      cactus: ["tree_magenta"],
      cactus2: ["bush_magenta"],
      reed: ["bush_magenta"],
      snowrock: ["boulder"],
    },
  },
};

export const TERRAIN_THEME_IDS = Object.keys(TERRAIN_THEMES) as TerrainTheme[];

export function themeOf(id: TerrainTheme | undefined): ThemeSpec {
  return TERRAIN_THEMES[id ?? "temperate"] ?? TERRAIN_THEMES.temperate;
}

const scaleRGB = (c: RGB, k: number, lift = 0): RGB => c.map((v) => Math.min(255, v * k + lift)) as RGB;

/**
 * Two underwater paint bands from a theme's water look: a light shallow shelf and the darker deep beyond it.
 * Each is its own lo (shallow end) → hi (deep end) gradient.
 */
const bandCache = new WeakMap<BiomeLook, { shallow: BiomeLook; deep: BiomeLook }>();

export function waterBandLooks(water: BiomeLook): { shallow: BiomeLook; deep: BiomeLook } {
  let out = bandCache.get(water);
  if (!out) {
    out = {
      shallow: { ...water, lo: scaleRGB(water.lo, 1.55, 14), hi: scaleRGB(water.lo, 1.15, 4) },
      deep: { ...water, lo: scaleRGB(water.lo, 0.9), hi: scaleRGB(water.hi, 0.62) },
    };
    bandCache.set(water, out);
  }
  return out;
}

/** Mean colour of a theme's open water (what sunk wrecks take on). */
export function waterColor(theme: ThemeSpec): RGB {
  const w = theme.looks[0]!;
  return [(w.lo[0] + w.hi[0]) / 2, (w.lo[1] + w.hi[1]) / 2, (w.lo[2] + w.hi[2]) / 2];
}

/** Multiply tint for things lying in a theme's shallows: white, `t` of the way to the shallow-water colour. */
export function shallowTint(theme: ThemeSpec, t: number): number {
  const c = waterBandLooks(theme.looks[0]!).shallow.lo;
  const ch = (v: number) => Math.round(255 + (Math.min(255, v) - 255) * t);
  return (ch(c[0]) << 16) | (ch(c[1]) << 8) | ch(c[2]);
}

/** Water depth (z) at which a submerged hull reaches its full tint. */
const UNDERWATER_TINT_DEPTH = 36;
/** Most a submerged hull is tinted toward the water colour (it stays readable). */
const UNDERWATER_TINT_MAX = 0.8;
/** Tint the moment a hull goes under, so the change reads immediately. */
const UNDERWATER_TINT_MIN = 0.15;

/** Multiply tint for a hull under `depth` (z) of water: white → the theme's water colour, deeper = more. */
export function underwaterTint(theme: ThemeSpec, depth: number): number {
  if (depth <= 0) return 0xffffff;
  const t = UNDERWATER_TINT_MIN + (UNDERWATER_TINT_MAX - UNDERWATER_TINT_MIN) * Math.min(1, depth / UNDERWATER_TINT_DEPTH);
  const c = waterColor(theme);
  const ch = (v: number) => Math.round(255 + (Math.min(255, v) - 255) * t);
  return (ch(c[0]) << 16) | (ch(c[1]) << 8) | ch(c[2]);
}

/** Look color at t (extrapolates, like the original per-biome ramps). */
export function lookColor(l: BiomeLook, t: number, ch: 0 | 1 | 2): number {
  return l.lo[ch] + (l.hi[ch] - l.lo[ch]) * t;
}

function tintTile(src: ImageData, tint: RGB): ImageData {
  const d = src.data;
  let sum = 0;
  for (let o = 0; o < d.length; o += 4) sum += d[o]! * 0.3 + d[o + 1]! * 0.59 + d[o + 2]! * 0.11;
  const mean = sum / (d.length / 4) || 1;
  const out = new ImageData(src.width, src.height);
  const od = out.data;
  for (let o = 0; o < d.length; o += 4) {
    const k = (d[o]! * 0.3 + d[o + 1]! * 0.59 + d[o + 2]! * 0.11) / mean;
    od[o] = tint[0] * k;
    od[o + 1] = tint[1] * k;
    od[o + 2] = tint[2] * k;
    od[o + 3] = 255;
  }
  return out;
}

const tileCache = new WeakMap<(ImageData | null)[], Map<TerrainTheme, (ImageData | null)[]>>();

/** Per-biome-slot tiles for a theme, from the raw slot tiles (cached per source array). */
export function themedTiles(theme: ThemeSpec, raw: (ImageData | null)[] | undefined): (ImageData | null)[] | undefined {
  if (!raw) return raw;
  let byTheme = tileCache.get(raw);
  if (!byTheme) tileCache.set(raw, (byTheme = new Map()));
  let out = byTheme.get(theme.id);
  if (!out) {
    out = theme.looks.map((l) => {
      const src = raw[l.tile] ?? null;
      return src && l.tint ? tintTile(src, l.tint) : src;
    });
    byTheme.set(theme.id, out);
  }
  return out;
}
