/**
 * Runtime "broken apart" wreck variants: cut a hulk texture into pieces along its long axis with jagged, splintered,
 * charred breaks (optionally snapped ends), then nudge the pieces apart. Tuned live in the art rig (HULK BREAK).
 */
import type Phaser from "phaser";
import { UNIT_SPECS } from "../catalog/units";

export const HULK_BREAK_DEFAULTS = {
  /** Variants baked per breakable wreck. */
  variants: 4,
  /** Most cuts across the long axis (1…this). */
  cuts: 2,
  /** Gap width range, fraction of the long axis. */
  gapMin: 0.05,
  gapMax: 0.16,
  /** Low-frequency ragged edge amplitude, fraction of the long axis. */
  jag: 0.06,
  /** High-frequency splinter spikes, fraction of the long axis. */
  splinter: 0.035,
  /** Chance each end snaps off. */
  endBreak: 0.55,
  /** Snapped end depth, fraction of the long axis. */
  endDepth: 0.1,
  /** Charring strength and reach (fraction of the long axis) along breaks. */
  char: 0.55,
  charWidth: 0.05,
  /** Pieces drift apart (fraction of the long axis) and tilt (radians). */
  drift: 0.025,
  tilt: 0.07,
};
export type HulkBreakParams = typeof HULK_BREAK_DEFAULTS;
/** Live params (art rig nudges these; B re-bakes). */
export const hulkBreakParams: Record<keyof HulkBreakParams, number> = { ...HULK_BREAK_DEFAULTS };

/** Texture key of break variant `i` (1-based) of a hulk. */
export function breakVariantKey(hulk: string, i: number): string {
  return `${hulk}__brk${i}`;
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 1D value noise over [0, 1] from `n` random knots, smoothstepped. */
function noise1(r: () => number, n: number): (v: number) => number {
  const k = Array.from({ length: n + 1 }, () => r() * 2 - 1);
  return (v) => {
    const x = Math.min(0.9999, Math.max(0, v)) * n;
    const i = Math.floor(x);
    const f = x - i;
    const s = f * f * (3 - 2 * f);
    return k[i]! + (k[i + 1]! - k[i]!) * s;
  };
}

/** One broken-apart variant of `src` (same canvas size). */
export function breakApart(
  src: CanvasImageSource & { width: number; height: number },
  seed: number,
  p: Record<keyof HulkBreakParams, number> = hulkBreakParams
): HTMLCanvasElement {
  const W = src.width;
  const H = src.height;
  const vertical = H >= W;
  const L = vertical ? H : W;
  const S = vertical ? W : H;
  const r = rng(seed * 2654435761);
  const base = document.createElement("canvas");
  base.width = W;
  base.height = H;
  const bg = base.getContext("2d", { willReadFrequently: true })!;
  bg.drawImage(src, 0, 0);
  const pix = bg.getImageData(0, 0, W, H).data;

  // Breaks: each is a [lo(v), hi(v)] band along the long axis that gets removed.
  type Edge = (v: number) => number;
  const edge = (at: number): Edge => {
    const low = noise1(r, 5);
    const high = noise1(r, 22);
    return (v) => at + (low(v) * p.jag + high(v) * p.splinter) * L;
  };
  const breaks: { lo: Edge; hi: Edge; mid: number }[] = [];
  const nCuts = 1 + Math.floor(r() * Math.max(1, Math.round(p.cuts)));
  const centers = Array.from({ length: nCuts }, (_, k) => (k + 0.5 + (r() - 0.5) * 0.6) / nCuts).map((t) => 0.15 + t * 0.7);
  for (const c of centers.sort((a, b) => a - b)) {
    const gap = (p.gapMin + r() * Math.max(0, p.gapMax - p.gapMin)) * L;
    breaks.push({ lo: edge(c * L - gap / 2), hi: edge(c * L + gap / 2), mid: c * L });
  }
  const snapStart = r() < p.endBreak ? edge(r() * p.endDepth * L) : null;
  const snapEnd = r() < p.endBreak ? edge(L - r() * p.endDepth * L) : null;

  // Assign each opaque pixel to a piece (or drop it), charring near breaks.
  const pieces = Array.from({ length: breaks.length + 1 }, () => new ImageData(W, H));
  const sums = pieces.map(() => ({ x: 0, y: 0, n: 0 }));
  const charW = Math.max(1, p.charWidth * L);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (pix[i + 3]! < 4) continue;
      const u = vertical ? y : x;
      const v = (vertical ? x : y) / Math.max(1, S - 1);
      let near = Infinity;
      if (snapStart) {
        const e = snapStart(v);
        if (u < e) continue;
        near = Math.min(near, u - e);
      }
      if (snapEnd) {
        const e = snapEnd(v);
        if (u > e) continue;
        near = Math.min(near, e - u);
      }
      let piece = 0;
      let gone = false;
      for (const b of breaks) {
        const lo = b.lo(v);
        const hi = b.hi(v);
        if (u >= lo && u <= hi) {
          gone = true;
          break;
        }
        if (u > hi) piece++;
        near = Math.min(near, u < lo ? lo - u : u - hi);
      }
      if (gone) continue;
      const burn = near < charW ? 1 - p.char * (1 - near / charW) : 1;
      const d = pieces[piece]!.data;
      d[i] = pix[i]! * burn;
      d[i + 1] = pix[i + 1]! * burn * 0.96;
      d[i + 2] = pix[i + 2]! * burn * 0.9;
      d[i + 3] = pix[i + 3]!;
      const sm = sums[piece]!;
      sm.x += x;
      sm.y += y;
      sm.n++;
    }
  }

  // Compose: each piece drifts away from the middle of the wreck and tilts a little.
  const out = document.createElement("canvas");
  out.width = W;
  out.height = H;
  const og = out.getContext("2d")!;
  const tmp = document.createElement("canvas");
  tmp.width = W;
  tmp.height = H;
  const tg = tmp.getContext("2d")!;
  pieces.forEach((img, k) => {
    const sm = sums[k]!;
    if (!sm.n) return;
    tg.clearRect(0, 0, W, H);
    tg.putImageData(img, 0, 0);
    const cx = sm.x / sm.n;
    const cy = sm.y / sm.n;
    const side = (vertical ? cy : cx) < L / 2 ? -1 : 1;
    const along = side * p.drift * L * (0.5 + r());
    const across = (r() - 0.5) * p.drift * S;
    og.save();
    og.translate(cx + (vertical ? across : along), cy + (vertical ? along : across));
    og.rotate((r() * 2 - 1) * p.tilt);
    og.drawImage(tmp, -cx, -cy);
    og.restore();
  });
  return out;
}

/** Bake break variants for every unit whose spec has `breakApart` (skips wrecks not loaded yet). */
export function bakeHulkBreakVariants(textures: Phaser.Textures.TextureManager): void {
  const n = Math.max(1, Math.round(hulkBreakParams.variants));
  for (const sp of Object.values(UNIT_SPECS)) {
    if (!sp.breakApart || !textures.exists(sp.hulk)) continue;
    const img = textures.get(sp.hulk).getSourceImage() as HTMLCanvasElement;
    for (let i = 1; i <= n; i++) {
      const key = breakVariantKey(sp.hulk, i);
      if (textures.exists(key)) textures.remove(key);
      textures.addCanvas(key, breakApart(img, i * 7919 + sp.hulk.length));
    }
    // Drop stale variants left from a larger count.
    for (let i = n + 1; textures.exists(breakVariantKey(sp.hulk, i)); i++) textures.remove(breakVariantKey(sp.hulk, i));
  }
}

/** Variant keys available for a hulk (only those baked). */
export function hulkBreakKeys(textures: Phaser.Textures.TextureManager, hulk: string): string[] {
  const out: string[] = [];
  for (let i = 1; textures.exists(breakVariantKey(hulk, i)); i++) out.push(breakVariantKey(hulk, i));
  return out;
}
