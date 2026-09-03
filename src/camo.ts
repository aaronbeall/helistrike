import type Phaser from "phaser";
import type { Biome } from "./world";

export type CamoKind = "woodland" | "desert" | "urban" | "snow" | "digital";

/** Biome-linked patterns (not digital). */
export const CAMO_KINDS: CamoKind[] = ["woodland", "desert", "urban", "snow"];

const PATTERNS: Record<Exclude<CamoKind, "digital">, { seed: number; colors: string[] }> = {
  woodland: { seed: 11029, colors: ["#3a5230", "#2a3a22", "#5a6a38", "#4a3a24"] },
  desert: { seed: 44117, colors: ["#c4a06a", "#a88854", "#8a7044", "#d8c08a"] },
  urban: { seed: 77231, colors: ["#6a6c66", "#4a4c48", "#8a8882", "#3a3c38"] },
  snow: { seed: 99013, colors: ["#e6e4dc", "#c4c6c0", "#9aa298", "#d0d4cc"] },
};

const DIGITAL = {
  seed: 55019,
  colors: ["#3a4638", "#2a322c", "#52604a", "#1c241e", "#6a7860", "#485248"],
};

/** Bases that only get digital (LAV-AA) skins, not biome camo. */
const DIGITAL_CAMO_BASES = [
  "enemy_lav",
  "enemy_lav_hulk",
  "building_tower_aa",
  "building_tower_aa_hulk",
] as const;

export function camoPatternKey(kind: CamoKind): string {
  return `camo_${kind}`;
}

export function skinnedKey(base: string, camo?: CamoKind): string {
  return camo ? `${base}__${camo}` : base;
}

export function stripCamoSuffix(key: string): string {
  return key.replace(/__(woodland|desert|urban|snow|digital)$/, "");
}

export function camoForBiome(biome: Biome): CamoKind {
  if (biome === "forest" || biome === "grass") return "woodland";
  if (biome === "rock") return "urban";
  if (biome === "peak") return "snow";
  return "desert";
}

export function resolveSkin(
  textures: Phaser.Textures.TextureManager,
  base: string,
  camo?: CamoKind
): string {
  if (!camo) return base;
  const key = skinnedKey(base, camo);
  return textures.exists(key) ? key : base;
}

const CAMO_BASES = ["building_tent", "enemy_pickup", "enemy_truck", "enemy_troop_officer"] as const;

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

function drawDigitalCamo(size = 128): HTMLCanvasElement {
  const rand = rng(DIGITAL.seed);
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const g = c.getContext("2d")!;
  const [br, bg, bb] = hexRgb(DIGITAL.colors[0]!);
  g.fillStyle = `rgb(${br},${bg},${bb})`;
  g.fillRect(0, 0, size, size);
  const spots = DIGITAL.colors.slice(1);
  for (let i = 0; i < 72; i++) {
    const [r, gv, b] = hexRgb(spots[i % spots.length]!);
    const cell = 4 + Math.floor(rand() * 3) * 4;
    const w = cell * (1 + Math.floor(rand() * 3));
    const h = cell * (1 + Math.floor(rand() * 2));
    const x = Math.floor(rand() * size / cell) * cell;
    const y = Math.floor(rand() * size / cell) * cell;
    g.fillStyle = `rgba(${r},${gv},${b},${0.78 + rand() * 0.22})`;
    for (const ox of [-size, 0, size]) {
      for (const oy of [-size, 0, size]) {
        g.fillRect(x + ox, y + oy, w, h);
      }
    }
  }
  const pix = g.getImageData(0, 0, size, size);
  const d = pix.data;
  const n2 = rng(DIGITAL.seed ^ 0x9e3779b9);
  for (let i = 0; i < d.length; i += 4) {
    const j = (n2() - 0.5) * 10;
    d[i] = Math.max(0, Math.min(255, d[i]! + j));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1]! + j));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2]! + j));
  }
  g.putImageData(pix, 0, 0);
  return c;
}

function drawCamo(kind: CamoKind, size = 128): HTMLCanvasElement {
  if (kind === "digital") return drawDigitalCamo(size);
  const { seed, colors } = PATTERNS[kind];
  const rand = rng(seed);
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const g = c.getContext("2d")!;
  const [br, bg, bb] = hexRgb(colors[0]!);
  g.fillStyle = `rgb(${br},${bg},${bb})`;
  g.fillRect(0, 0, size, size);
  const spots = colors.slice(1);
  for (let i = 0; i < 48; i++) {
    const [r, gv, b] = hexRgb(spots[i % spots.length]!);
    const cx = rand() * size;
    const cy = rand() * size;
    const rx = 7 + rand() * 22;
    const ry = 6 + rand() * 18;
    const rot = rand() * Math.PI;
    g.fillStyle = `rgba(${r},${gv},${b},${0.72 + rand() * 0.28})`;
    for (const ox of [-size, 0, size]) {
      for (const oy of [-size, 0, size]) {
        g.beginPath();
        g.ellipse(cx + ox, cy + oy, rx, ry, rot, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
  const pix = g.getImageData(0, 0, size, size);
  const d = pix.data;
  const n2 = rng(seed ^ 0x9e3779b9);
  for (let i = 0; i < d.length; i += 4) {
    const j = (n2() - 0.5) * 14;
    d[i] = Math.max(0, Math.min(255, d[i]! + j));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1]! + j));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2]! + j));
  }
  g.putImageData(pix, 0, 0);
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
  const g = c.getContext("2d")!;
  g.drawImage(img, 0, 0);
  return c;
}

function blendCamo(src: HTMLCanvasElement, camo: HTMLCanvasElement, ox: number, oy: number): HTMLCanvasElement {
  const w = src.width;
  const h = src.height;
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const sg = src.getContext("2d")!;
  const cg = camo.getContext("2d")!;
  const sp = sg.getImageData(0, 0, w, h).data;
  const cp = cg.getImageData(0, 0, camo.width, camo.height).data;
  const dest = sg.createImageData(w, h);
  const d = dest.data;
  const cw = camo.width;
  const ch = camo.height;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = sp[i + 3]!;
      d[i + 3] = a;
      if (a < 8) continue;
      const r = sp[i]!;
      const g = sp[i + 1]!;
      const b = sp[i + 2]!;
      const redMark = r > 115 && r - Math.max(g, b) > 42 && Math.max(g, b) < 110;
      if (redMark) {
        d[i] = r;
        d[i + 1] = g;
        d[i + 2] = b;
        continue;
      }
      const cx = ((x + ox) % cw + cw) % cw;
      const cy = ((y + oy) % ch + ch) % ch;
      const ci = (cy * cw + cx) * 4;
      const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 148;
      d[i] = Math.max(0, Math.min(255, cp[ci]! * lum));
      d[i + 1] = Math.max(0, Math.min(255, cp[ci + 1]! * lum));
      d[i + 2] = Math.max(0, Math.min(255, cp[ci + 2]! * lum));
    }
  }
  out.getContext("2d")!.putImageData(dest, 0, 0);
  return out;
}

function put(textures: Phaser.Textures.TextureManager, key: string, c: HTMLCanvasElement): void {
  if (textures.exists(key)) textures.remove(key);
  textures.addCanvas(key, c);
}

function bakeBaseKinds(
  textures: Phaser.Textures.TextureManager,
  bases: readonly string[],
  kinds: readonly CamoKind[]
): void {
  for (const base of bases) {
    const src = srcCanvas(textures, base);
    if (!src) continue;
    const h = hash(base);
    for (const kind of kinds) {
      const camo = srcCanvas(textures, camoPatternKey(kind));
      if (!camo) continue;
      const ox = h % camo.width;
      const oy = (h >>> 8) % camo.height;
      put(textures, skinnedKey(base, kind), blendCamo(src, camo, ox, oy));
    }
  }
}

export function bakeCamo(textures: Phaser.Textures.TextureManager): void {
  for (const kind of CAMO_KINDS) put(textures, camoPatternKey(kind), drawCamo(kind));
  put(textures, camoPatternKey("digital"), drawDigitalCamo());
  bakeBaseKinds(textures, CAMO_BASES, CAMO_KINDS);
  bakeBaseKinds(textures, DIGITAL_CAMO_BASES, ["digital"]);
}
