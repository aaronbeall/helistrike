/** Terrain themes: per-biome palette, tile texture + tint, and decor swaps. Visual only; biome rules are unchanged. */
import type { DecorKind } from "./world";

export type TerrainTheme = "temperate" | "arctic" | "desert" | "tropic" | "coastal";
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
  /** Decor substitutions (picked at random when several). */
  decor: Partial<Record<DecorKind, DecorKind[]>>;
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
    decor: {},
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
    decor: {
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
    decor: {
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
    decor: {
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
    decor: {
      cactus: ["shrub"],
      cactus2: ["bush"],
      pine: ["tree", "pine"],
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
