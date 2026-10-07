import type Phaser from "phaser";
import type { Biome } from "../worldgen/world";
import { registerArt, type ArtSource } from "../art/sprites";
import { UNIT_SPECS } from "../catalog/units";

import { stripCamoSuffix, type CamoKind } from "../catalog/camo";
export { stripCamoSuffix, type CamoKind } from "../catalog/camo";

/** Biome-linked patterns. */
export const CAMO_KINDS: CamoKind[] = ["woodland", "desert", "urban", "snow"];

const PATTERNS: Record<Exclude<CamoKind, "digital" | "dazzle">, { seed: number; colors: string[] }> = {
  woodland: { seed: 11029, colors: ["#3a5230", "#2a3a22", "#5a6a38", "#4a3a24"] },
  desert: { seed: 44117, colors: ["#c4a06a", "#a88854", "#8a7044", "#d8c08a"] },
  urban: { seed: 77231, colors: ["#6a6c66", "#4a4c48", "#8a8882", "#3a3c38"] },
  snow: { seed: 99013, colors: ["#e6e4dc", "#c4c6c0", "#9aa298", "#d0d4cc"] },
  naval: { seed: 33091, colors: ["#5a6a7c", "#3a4a5e", "#7a8c9e", "#26323f"] },
};

const DIGITAL = {
  seed: 55019,
  colors: ["#3a4638", "#2a322c", "#52604a", "#1c241e", "#6a7860", "#485248"],
};

/** Dazzle stripe pairs: light vs dark navy greys. */
const DAZZLE = {
  seed: 63211,
  pairs: [
    ["#e6e8e6", "#2c3236"],
    ["#a8b0b4", "#1c2226"],
    ["#e6e8e6", "#5c6a78"],
    ["#c4ccd0", "#3c4650"],
    ["#a8b0b4", "#5c6a78"],
  ],
};

export function camoPatternKey(kind: CamoKind): string {
  return `camo_${kind}`;
}

export function skinnedKey(base: string, camo?: CamoKind): string {
  return camo ? `${base}__${camo}` : base;
}

export function camoForBiome(biome: Biome): CamoKind {
  if (biome === "forest" || biome === "grass") return "woodland";
  if (biome === "rock") return "urban";
  if (biome === "peak") return "snow";
  return "desert";
}

/**
 * Resolve a skinned live texture. Hulks are never camo-suffixed — callers that
 * pass a hulk base always get the plain hulk (e.g. building_tower_aa_hulk, not
 * building_tower_aa_hulk__digital).
 */
export function resolveSkin(
  textures: Phaser.Textures.TextureManager,
  base: string,
  camo?: CamoKind
): string {
  if (!camo) return base;
  if (stripCamoSuffix(base).endsWith("_hulk")) return stripCamoSuffix(base);
  const key = skinnedKey(base, camo);
  return textures.exists(key) ? key : base;
}


function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Tileable value noise: lattice `period` cells across the tile, smooth (quintic) interpolation, 0..1. */
function tileNoise(seed: number, period: number): (u: number, v: number) => number {
  const rand = rng(seed);
  const lattice = Float32Array.from({ length: period * period }, () => rand());
  const at = (x: number, y: number) => lattice[(((y % period) + period) % period) * period + (((x % period) + period) % period)]!;
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  return (u, v) => {
    const x = u * period;
    const y = v * period;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = fade(x - x0);
    const fy = fade(y - y0);
    const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * fx;
    const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * fx;
    return a + (b - a) * fy;
  };
}

/** Tileable fractal noise (octaves double the lattice period), roughly 0..1. */
function tileFbm(seed: number, period: number, octaves: number): (u: number, v: number) => number {
  const layers = Array.from({ length: octaves }, (_, o) => tileNoise(seed + o * 7919, period << o));
  return (u, v) => {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    for (const n of layers) {
      sum += n(u, v) * amp;
      norm += amp;
      amp *= 0.5;
    }
    return sum / norm;
  };
}

/** Patch coverage of each accent color (fraction of the tile), back to front. */
const CAMO_COVER = [0.42, 0.34, 0.22];

/** Pattern tile size (px); patterns are continuous, so skins sample them at any scale. */
const CAMO_TILE = 128;

type Rgb = readonly [number, number, number];
type CamoSampler = (u: number, v: number) => Rgb;

/** Layered camo: per accent color, a warped fractal noise field thresholded to its coverage; `block` > 1 = digital cells. */
function patchSampler(seed: number, colors: string[], block: number): CamoSampler {
  const warpX = tileFbm(seed ^ 0x51, 3, 3);
  const warpY = tileFbm(seed ^ 0xa7, 3, 3);
  const accents = colors.slice(1).map((hex, i) => ({ rgb: hexRgb(hex), field: tileFbm(seed + 101 * (i + 1), 4, 4) }));
  const warp = (u: number, v: number) => [u + (warpX(u, v) - 0.5) * 0.32, v + (warpY(u, v) - 0.5) * 0.32] as const;
  // Threshold per field from its own value distribution, so each color covers its share.
  const cuts = accents.map((acc, i) => {
    const vals: number[] = [];
    for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) {
      const [u, v] = warp(x / 48, y / 48);
      vals.push(acc.field(u, v));
    }
    vals.sort((p, q) => p - q);
    return vals[Math.floor(vals.length * (1 - (CAMO_COVER[i] ?? 0.2)))]!;
  });
  const base = hexRgb(colors[0]!);
  const cell = block / CAMO_TILE;
  return (u, v) => {
    if (block > 1) {
      u = (Math.floor(u / cell) + 0.5) * cell;
      v = (Math.floor(v / cell) + 0.5) * cell;
    }
    const [wu, wv] = warp(u, v);
    let rgb: Rgb = base;
    for (let i = 0; i < accents.length; i++) if (accents[i]!.field(wu, wv) > cuts[i]!) rgb = accents[i]!.rgb;
    return rgb;
  };
}

/** Dazzle: periodic Voronoi regions, each striped at an integer (tileable) angle in a two-tone navy pair. */
function dazzleSampler(seed: number, pairs: string[][]): CamoSampler {
  const rand = rng(seed);
  const pal = pairs.map((p) => p.map(hexRgb));
  const regions = Array.from({ length: 7 }, () => {
    let a = 0;
    let b = 0;
    while (Math.hypot(a, b) < 3 || Math.hypot(a, b) > 7) {
      a = Math.round((rand() - 0.5) * 14);
      b = Math.round((rand() - 0.5) * 14);
    }
    const [c0, c1] = pal[Math.floor(rand() * pal.length)]!;
    return { x: rand(), y: rand(), a, b, phase: rand(), solid: rand() < 0.15, c0: c0!, c1: c1! };
  });
  const wrap = (d: number) => d - Math.round(d);
  return (u, v) => {
    let best = regions[0]!;
    let bd = Infinity;
    for (const r of regions) {
      const dx = wrap(u - r.x);
      const dy = wrap(v - r.y);
      const d = dx * dx + dy * dy;
      if (d < bd) {
        bd = d;
        best = r;
      }
    }
    if (best.solid) return best.c0;
    const t = best.a * u + best.b * v + best.phase;
    return t - Math.floor(t) < 0.5 ? best.c0 : best.c1;
  };
}

const samplers = new Map<CamoKind, { sample: CamoSampler; seed: number; grain: number }>();

function camoSampler(kind: CamoKind): { sample: CamoSampler; seed: number; grain: number } {
  let s = samplers.get(kind);
  if (!s) {
    if (kind === "dazzle") s = { sample: dazzleSampler(DAZZLE.seed, DAZZLE.pairs), seed: DAZZLE.seed, grain: 8 };
    else {
      const { seed, colors } = kind === "digital" ? DIGITAL : PATTERNS[kind];
      s = { sample: patchSampler(seed, colors, kind === "digital" ? 4 : 1), seed, grain: kind === "digital" ? 10 : 14 };
    }
    samplers.set(kind, s);
  }
  return s;
}

/** Reference tile of a pattern (sprite rig / thumbnails). */
function drawCamo(kind: CamoKind, size = CAMO_TILE): HTMLCanvasElement {
  const { sample, seed, grain } = camoSampler(kind);
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  const img = g.createImageData(size, size);
  const d = img.data;
  const noise = rng(seed ^ 0x9e3779b9);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const rgb = sample(x / size, y / size);
      const j = (noise() - 0.5) * grain;
      const i = (y * size + x) * 4;
      d[i] = Math.max(0, Math.min(255, rgb[0] + j));
      d[i + 1] = Math.max(0, Math.min(255, rgb[1] + j));
      d[i + 2] = Math.max(0, Math.min(255, rgb[2] + j));
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function srcCanvas(textures: Phaser.Textures.TextureManager, key: string): HTMLCanvasElement | null {
  if (!textures.exists(key)) return null;
  const img = textures.get(key).getSourceImage() as CanvasImageSource;
  const w = (img as HTMLImageElement).width;
  const h = (img as HTMLImageElement).height;
  if (!w || !h) return null;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(img, 0, 0);
  return c;
}

/** Most the pattern is shrunk on a small sprite (tiny troops would turn to noise). */
const CAMO_MAX_DENSITY = 4;

/** Repaint `src` with camo `kind` (shading kept via luminance, red markings kept); `k` = tile px per sprite px. */
function blendCamo(src: HTMLCanvasElement, kind: CamoKind, ox: number, oy: number, k: number): HTMLCanvasElement {
  const { sample, seed, grain } = camoSampler(kind);
  const w = src.width;
  const h = src.height;
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const sg = src.getContext("2d", { willReadFrequently: true })!;
  const sp = sg.getImageData(0, 0, w, h).data;
  const dest = sg.createImageData(w, h);
  const d = dest.data;
  const noise = rng(seed ^ (ox * 73856093) ^ (oy * 19349663));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = sp[i + 3]!;
      d[i + 3] = a;
      if (a < 8) continue;
      const r = sp[i]!;
      const g = sp[i + 1]!;
      const b = sp[i + 2]!;
      const redMark = r > 115 && r - Math.max(g, b) > 42 && Math.max(g, b) < 110 && Math.abs(g - b) < 28;
      if (redMark) {
        d[i] = r;
        d[i + 1] = g;
        d[i + 2] = b;
        continue;
      }
      const rgb = sample((x * k + ox) / CAMO_TILE, (y * k + oy) / CAMO_TILE);
      // Half grain: per-pixel noise reads as speckle on small sprites.
      const j = (noise() - 0.5) * grain * 0.5;
      const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 148;
      d[i] = Math.max(0, Math.min(255, (rgb[0] + j) * lum));
      d[i + 1] = Math.max(0, Math.min(255, (rgb[1] + j) * lum));
      d[i + 2] = Math.max(0, Math.min(255, (rgb[2] + j) * lum));
    }
  }
  out.getContext("2d", { willReadFrequently: true })!.putImageData(dest, 0, 0);
  return out;
}

function put(textures: Phaser.Textures.TextureManager, key: string, c: HTMLCanvasElement, source: ArtSource): void {
  if (textures.exists(key)) textures.remove(key);
  textures.addCanvas(key, c);
  registerArt(key, source);
}

function bakeBaseKinds(textures: Phaser.Textures.TextureManager, bases: readonly string[], kinds: readonly CamoKind[]): void {
  for (const base of bases) {
    if (base.endsWith("_hulk")) continue; // never bake camo hulks
    const src = srcCanvas(textures, base);
    if (!src) continue;
    const h = hash(base);
    // One tile across the sprite's long side: a few patches on every vehicle.
    const k = Math.min(CAMO_MAX_DENSITY, Math.max(1, CAMO_TILE / Math.max(src.width, src.height)));
    for (const kind of kinds) put(textures, skinnedKey(base, kind), blendCamo(src, kind, h % CAMO_TILE, (h >>> 8) % CAMO_TILE, k), "image");
  }
}

/** Textures to skin, from the unit specs: each camo'd unit's body + `camo` parts, with the patterns it can wear. */
export function camoSkinBases(): Map<string, CamoKind[]> {
  const out = new Map<string, CamoKind[]>();
  const add = (tex: string, kinds: readonly CamoKind[]) => {
    const have = out.get(tex) ?? [];
    for (const k of kinds) if (!have.includes(k)) have.push(k);
    out.set(tex, have);
  };
  for (const sp of Object.values(UNIT_SPECS)) {
    const kinds = sp.camo === "biome" ? CAMO_KINDS : (sp.camo ?? []).filter((k) => k !== "none");
    if (!kinds.length) continue;
    add(sp.texture, kinds);
    for (const g of sp.guns) if (g.camo) add(g.tex, kinds);
  }
  return out;
}

export function bakeCamo(textures: Phaser.Textures.TextureManager): void {
  for (const kind of [...CAMO_KINDS, "digital", "naval", "dazzle"] as const) put(textures, camoPatternKey(kind), drawCamo(kind), "generated");
  for (const [base, kinds] of camoSkinBases()) bakeBaseKinds(textures, [base], kinds);
}
