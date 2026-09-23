/**
 * Procedural art generators: registry + param harness + concrete gens.
 * Boot (`bake.ts`) and the Art Gen rig both consume this module.
 *
 * Heavy toon-blast math stays in `toonBlast.ts`; everything else lives here.
 */
import type Phaser from "phaser";
import {
  TOON_BLAST_DEFAULTS,
  TOON_EASE_NAMES,
  bakeToonBlast,
  ensureToonBlastAnims,
  makeToonClusters,
  mulberry32,
  renderToonBlastFrame,
  toonBlastParams,
  type ToonBlastParams,
  type ToonCluster,
} from "../render/toonBlast";
import { bakeThermalHeatFromAlpha, registerArt } from "./sprites";
import { drawTracerShape, type TracerShapeOpts } from "../render/tracerArt";

// ─── Registry ───────────────────────────────────────────────────────────────

export type ArtGenParamMeta = {
  step: number;
  stepFast: number;
  /** Randomize range only — nudge is unbounded unless clamp is set. */
  min: number;
  max: number;
  decimals?: number;
  hex?: boolean;
  /** Soft clamp after nudge (rare — most params stay unbounded). */
  clamp?: boolean;
  /** Named enum — param value is a string; ←→ cycles choices. */
  choices?: readonly string[];
  desc: string;
};

export type ArtGenParamMap = Record<string, number | string>;
export type ArtGenMetaMap = Record<string, ArtGenParamMeta>;

/** Coerce a param to number (choice strings stay out of numeric math). */
export function artGenNum(v: number | string | undefined, fallback = 0): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

export type ArtGenBakeCtx = {
  textures: Phaser.Textures.TextureManager;
  anims?: Phaser.Animations.AnimationManager;
};

export type ArtGenDef = {
  id: string;
  label: string;
  blurb: string;
  animated: boolean;
  loopSec?: number;
  /** Preferred preview zoom when this gen is selected (art gen rig). */
  defaultZoom?: number;
  params: ArtGenParamMap;
  defaults: ArtGenParamMap;
  meta: ArtGenMetaMap;
  prepare?: (
    seed: number,
    params: ArtGenParamMap,
    textures?: Phaser.Textures.TextureManager
  ) => unknown;
  render: (
    t: number,
    seed: number,
    params: ArtGenParamMap,
    canvas: HTMLCanvasElement,
    g: CanvasRenderingContext2D,
    prepared?: unknown
  ) => HTMLCanvasElement;
  bake: (ctx: ArtGenBakeCtx) => void;
  ensureAnims?: (
    anims: Phaser.Animations.AnimationManager,
    textures: Phaser.Textures.TextureManager,
    force?: boolean
  ) => void;
  afterNudge?: (key: string, params: ArtGenParamMap) => void;
  afterRandomize?: (params: ArtGenParamMap) => void;
};

const REGISTRY: ArtGenDef[] = [];

export function registerArtGen(def: ArtGenDef): ArtGenDef {
  if (REGISTRY.some((d) => d.id === def.id)) {
    throw new Error(`art gen already registered: ${def.id}`);
  }
  REGISTRY.push(def);
  return def;
}

export function artGens(): readonly ArtGenDef[] {
  return REGISTRY;
}

export function artGenById(id: string): ArtGenDef | undefined {
  return REGISTRY.find((d) => d.id === id);
}

export function resetArtGen(def: ArtGenDef): void {
  Object.assign(def.params, def.defaults);
}

export function formatArtGenValue(def: ArtGenDef, key: string): string {
  const meta = def.meta[key];
  const v = def.params[key];
  if (!meta) return String(v ?? "");
  if (meta.choices) return String(v ?? meta.choices[0] ?? "");
  const n = typeof v === "number" ? v : Number(v) || 0;
  if (meta.hex) return `#${(n >>> 0).toString(16).padStart(6, "0")}`;
  if (meta.decimals != null) return n.toFixed(meta.decimals);
  if (Number.isInteger(meta.step) && meta.decimals == null) return String(Math.round(n));
  return n.toFixed(2);
}

export function nudgeArtGenParam(def: ArtGenDef, key: string, dir: number, fast: boolean): void {
  const meta = def.meta[key];
  if (!meta || !(key in def.params)) return;
  if (meta.choices?.length) {
    const list = meta.choices;
    const cur = String(def.params[key] ?? list[0]);
    let i = list.indexOf(cur);
    if (i < 0) i = 0;
    const step = (fast ? Math.max(1, Math.round(meta.stepFast)) : 1) * dir;
    i = ((i + step) % list.length + list.length) % list.length;
    def.params[key] = list[i]!;
    def.afterNudge?.(key, def.params);
    return;
  }
  const step = (fast ? meta.stepFast : meta.step) * dir;
  let next = (typeof def.params[key] === "number" ? (def.params[key] as number) : 0) + step;
  if (meta.hex) next = (next >>> 0) & 0xffffff;
  else if (Number.isInteger(meta.step) && meta.decimals == null) next = Math.round(next);
  if (meta.clamp) next = Math.min(meta.max, Math.max(meta.min, next));
  def.params[key] = next;
  def.afterNudge?.(key, def.params);
}

export function randomizeArtGen(def: ArtGenDef): void {
  for (const key of Object.keys(def.meta)) {
    const meta = def.meta[key]!;
    if (meta.choices?.length) {
      def.params[key] = meta.choices[(Math.random() * meta.choices.length) | 0]!;
      continue;
    }
    const lo = Math.min(meta.min, meta.max);
    const hi = Math.max(meta.min, meta.max);
    let v = lo + Math.random() * (hi - lo);
    if (meta.hex) v = (Math.round(v) >>> 0) & 0xffffff;
    else if (meta.decimals != null) {
      const p = 10 ** meta.decimals;
      v = Math.round(v * p) / p;
    } else if (Number.isInteger(meta.step)) v = Math.round(v);
    def.params[key] = v;
  }
  def.afterRandomize?.(def.params);
}

export function bakeAllArtGens(textures: Phaser.Textures.TextureManager): void {
  for (const def of REGISTRY) {
    def.bake({ textures });
  }
}

export function ensureAllArtGenAnims(
  anims: Phaser.Animations.AnimationManager,
  textures: Phaser.Textures.TextureManager
): void {
  for (const def of REGISTRY) {
    def.ensureAnims?.(anims, textures);
  }
}

// ─── Canvas helpers ─────────────────────────────────────────────────────────

type Ctx = CanvasRenderingContext2D;

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function ctxOf(c: HTMLCanvasElement): Ctx {
  const g = c.getContext("2d", { willReadFrequently: true });
  if (!g) throw new Error("2d");
  g.imageSmoothingEnabled = true;
  return g;
}

function roundRect(g: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

function putCanvas(textures: Phaser.Textures.TextureManager, key: string, c: HTMLCanvasElement): void {
  if (textures.exists(key)) textures.remove(key);
  textures.addCanvas(key, c);
  registerArt(key, "generated");
}

// ─── Toon blast ─────────────────────────────────────────────────────────────

const TOON_META = {
  size: { step: 8, stepFast: 32, min: 64, max: 320, desc: "Explosion bake/preview canvas size (px)." },
  frames: { step: 1, stepFast: 4, min: 8, max: 64, desc: "Spritesheet frame count when baking." },
  cutStart: { step: 0.02, stepFast: 0.08, min: 0, max: 0.8, decimals: 2, desc: "Time when blob layer cutaways begin (0–1)." },
  easePower: { step: 0.5, stepFast: 1, min: 1, max: 10, decimals: 1, desc: "Exponent shared by cluster / spark / cut easings (higher = punchier)." },
  easeCluster: {
    step: 1,
    stepFast: 1,
    min: 0,
    max: 2,
    choices: TOON_EASE_NAMES,
    desc: "Cluster travel / blob spread: out | in | inOut.",
  },
  easeSpark: {
    step: 1,
    stepFast: 1,
    min: 0,
    max: 2,
    choices: TOON_EASE_NAMES,
    desc: "Spark travel + shrink + wipe: out | in | inOut.",
  },
  easeCut: {
    step: 1,
    stepFast: 1,
    min: 0,
    max: 2,
    choices: TOON_EASE_NAMES,
    desc: "Layer cutaway holes: out | in | inOut.",
  },
  easeCool: {
    step: 1,
    stepFast: 1,
    min: 0,
    max: 2,
    choices: TOON_EASE_NAMES,
    desc: "Fire→smoke cool curve: out | in | inOut.",
  },
  easeDust: {
    step: 1,
    stepFast: 1,
    min: 0,
    max: 2,
    choices: TOON_EASE_NAMES,
    desc: "Late dust blob stretch: out | in | inOut.",
  },
  coolAmount: { step: 0.05, stepFast: 0.15, min: 0, max: 1.5, decimals: 2, desc: "How fast fire cools into smoke then dust (0=hot, 1=full cool)." },
  bloomStrength: { step: 0.02, stepFast: 0.1, min: 0, max: 1, decimals: 2, desc: "Soft outer glow early; fades as the blast cools." },
  bloomSize: { step: 0.05, stepFast: 0.15, min: 0.8, max: 2, decimals: 2, desc: "Bloom radius relative to blob span." },
  edgeBlur: { step: 0.1, stepFast: 0.5, min: 0, max: 6, decimals: 1, desc: "Blur before palette clamp — softens hard cel outlines into curves." },
  edgeBands: { step: 1, stepFast: 1, min: 1, max: 6, desc: "Alpha steps after blur (1=hard cut, 3=slight banded rim)." },

  largeClusters: { step: 1, stepFast: 1, min: 0, max: 8, desc: "Count of large clusters in the explosion." },
  smallClusters: { step: 1, stepFast: 1, min: 0, max: 8, desc: "Count of small clusters / late dust lobes." },
  clusterAngJitter: { step: 0.02, stepFast: 0.1, min: 0, max: 1.5, decimals: 2, desc: "Cluster ring angle noise (radians)." },
  clusterDist0Max: { step: 0.5, stepFast: 2, min: 0, max: 20, decimals: 1, desc: "Cluster max start distance from center." },
  clusterDist1Base: { step: 1, stepFast: 4, min: 4, max: 120, desc: "Cluster base outer travel distance." },
  clusterDist1Jitter: { step: 1, stepFast: 4, min: 0, max: 60, desc: "Random add to cluster outer travel." },
  clusterDist1LargeBonus: { step: 1, stepFast: 4, min: 0, max: 40, desc: "Extra travel for large clusters." },
  clusterMotionMin: { step: 0.02, stepFast: 0.1, min: 0.2, max: 1.5, decimals: 2, desc: "Fastest cluster travel remap." },
  clusterMotionMax: { step: 0.02, stepFast: 0.1, min: 0.2, max: 1.5, decimals: 2, desc: "Slowest cluster travel remap." },
  clusterLifeMin: { step: 0.02, stepFast: 0.1, min: 0.1, max: 1.2, decimals: 2, desc: "Shortest cluster cut life." },
  clusterLifeMax: { step: 0.02, stepFast: 0.1, min: 0.1, max: 1.5, decimals: 2, desc: "Longest cluster cut life." },
  clusterBlobSpreadStart: { step: 0.02, stepFast: 0.1, min: 0.2, max: 1.5, decimals: 2, desc: "Blob spacing inside a cluster at start." },
  clusterBlobSpreadEnd: { step: 0.02, stepFast: 0.1, min: 0.2, max: 2, decimals: 2, desc: "Blob spacing inside a cluster at full spread." },
  clusterVerticalBias: { step: 0.05, stepFast: 0.15, min: 0, max: 1.5, decimals: 2, desc: "Early upward stretch (fire column); eases later." },

  blobsMin: { step: 1, stepFast: 1, min: 1, max: 8, desc: "Min blobs (particles) per cluster." },
  blobsMax: { step: 1, stepFast: 1, min: 1, max: 10, desc: "Max blobs (particles) per cluster." },
  blobRLargeMin: { step: 1, stepFast: 4, min: 4, max: 80, desc: "Min smoke-layer radius for large-cluster blobs." },
  blobRLargeMax: { step: 1, stepFast: 4, min: 4, max: 100, desc: "Max smoke-layer radius for large-cluster blobs." },
  blobRSmallMin: { step: 1, stepFast: 4, min: 4, max: 60, desc: "Min smoke-layer radius for small-cluster blobs." },
  blobRSmallMax: { step: 1, stepFast: 4, min: 4, max: 80, desc: "Max smoke-layer radius for small-cluster blobs." },
  blobLocalDistLargeMin: { step: 0.5, stepFast: 2, min: 0, max: 40, decimals: 1, desc: "Min blob offset from large cluster center." },
  blobLocalDistLargeSpan: { step: 0.5, stepFast: 2, min: 0, max: 40, decimals: 1, desc: "Random span for blob offsets in large clusters." },
  blobLocalDistSmallMin: { step: 0.5, stepFast: 2, min: 0, max: 30, decimals: 1, desc: "Min blob offset from small cluster center." },
  blobLocalDistSmallSpan: { step: 0.5, stepFast: 2, min: 0, max: 30, decimals: 1, desc: "Random span for blob offsets in small clusters." },
  blobScaleStart: { step: 0.02, stepFast: 0.1, min: 0.1, max: 1, decimals: 2, desc: "Birth scale of each blob." },
  blobScaleEnd: { step: 0.02, stepFast: 0.1, min: 0.5, max: 1.5, decimals: 2, desc: "Peak scale before cutaway." },
  blobDurMin: { step: 0.02, stepFast: 0.1, min: 0.4, max: 1, decimals: 2, desc: "Shortest blob lifetime (relative)." },
  blobDurMax: { step: 0.02, stepFast: 0.1, min: 0.6, max: 1, decimals: 2, desc: "Longest blob lifetime." },
  sparkCount: { step: 1, stepFast: 1, min: 0, max: 12, desc: "Thin yellow/orange wisps early in the blast." },
  sparkLen: { step: 1, stepFast: 4, min: 4, max: 64, desc: "Initial length of spark streaks." },
  sparkWid: { step: 0.25, stepFast: 1, min: 1, max: 8, decimals: 2, desc: "Thickness of spark streaks." },
  sparkDist: { step: 2, stepFast: 8, min: 20, max: 200, desc: "How far sparks fly from center (fast travel)." },

  layerSmokeScale: { step: 0.02, stepFast: 0.1, min: 0.6, max: 1.4, decimals: 2, desc: "Outer smoke/dust silhouette scale." },
  layerOrangeScale: { step: 0.02, stepFast: 0.1, min: 0.3, max: 1, decimals: 2, desc: "Mid fire band nested inside smoke." },
  layerYellowScale: { step: 0.02, stepFast: 0.1, min: 0.15, max: 0.9, decimals: 2, desc: "Hot core nested inside orange." },
  layerOrangeInset: { step: 0.01, stepFast: 0.05, min: 0, max: 0.5, decimals: 2, desc: "Pull orange toward blob center." },
  layerYellowInset: { step: 0.01, stepFast: 0.05, min: 0, max: 0.6, decimals: 2, desc: "Pull yellow core further inward." },
  layerShadowOffset: { step: 0.02, stepFast: 0.1, min: 0, max: 0.6, decimals: 2, desc: "Underside crescent offset for cel volume." },
  layerShadowScale: { step: 0.02, stepFast: 0.1, min: 0.2, max: 1, decimals: 2, desc: "Size of underside shadow crescents." },
  layerYellowCutStart: { step: 0.01, stepFast: 0.05, min: 0, max: 1, decimals: 2, desc: "When yellow cores begin cutting away." },
  layerYellowCutEnd: { step: 0.01, stepFast: 0.05, min: 0, max: 1, decimals: 2, desc: "When yellow cores finish cutting." },
  layerOrangeCutStart: { step: 0.01, stepFast: 0.05, min: 0, max: 1, decimals: 2, desc: "When orange bands begin cutting." },
  layerOrangeCutEnd: { step: 0.01, stepFast: 0.05, min: 0, max: 1, decimals: 2, desc: "When orange bands finish cutting." },
  layerSmokeCutStart: { step: 0.01, stepFast: 0.05, min: 0, max: 1, decimals: 2, desc: "When smoke/dust silhouette begins cutting." },
  layerSmokeCutEnd: { step: 0.01, stepFast: 0.05, min: 0, max: 1, decimals: 2, desc: "When smoke/dust finishes (holes open late)." },
  layerRoughness: { step: 0.01, stepFast: 0.05, min: 0, max: 0.5, decimals: 2, desc: "Outline jitter — keep low for round soft bumps." },
  layerHoleScale: { step: 0.1, stepFast: 0.4, min: 0.5, max: 4, decimals: 1, desc: "How aggressively late smoke opens holes / fragments." },

  colYellow: { step: 0x010101, stepFast: 0x101010, min: 0, max: 0xffffff, hex: true, desc: "Hot core color (0xRRGGBB)." },
  colOrange: { step: 0x010101, stepFast: 0x101010, min: 0, max: 0xffffff, hex: true, desc: "Mid fire color (0xRRGGBB)." },
  colSmoke: { step: 0x010101, stepFast: 0x101010, min: 0, max: 0xffffff, hex: true, desc: "Smoke/dust color (0xRRGGBB)." },
  colShadow: { step: 0x010101, stepFast: 0x101010, min: 0, max: 0xffffff, hex: true, desc: "Crevice shadow color (0xRRGGBB)." },
} satisfies ArtGenMetaMap & Record<keyof ToonBlastParams, ArtGenMetaMap[string]>;

function syncBlobBounds(p: ArtGenParamMap): void {
  if (artGenNum(p.blobsMax) < artGenNum(p.blobsMin)) {
    const t = p.blobsMin;
    p.blobsMin = p.blobsMax;
    p.blobsMax = t;
  }
}

registerArtGen({
  id: "toon_blast",
  label: "TOON BLAST",
  blurb: "Cel fireball → rolling smoke sheets (fx_toon_blast_*)",
  animated: true,
  loopSec: 1.15,
  params: toonBlastParams as unknown as ArtGenParamMap,
  defaults: TOON_BLAST_DEFAULTS as unknown as ArtGenParamMap,
  meta: TOON_META,
  prepare: (seed, params) => makeToonClusters(mulberry32(seed), params as unknown as ToonBlastParams),
  render: (t, _seed, params, canvas, g, prepared) => {
    const clusters = (prepared as ToonCluster[] | undefined) ?? [];
    const size = Math.max(32, Math.round(artGenNum(params.size, 192)));
    return renderToonBlastFrame(clusters, t, size, params as unknown as ToonBlastParams, canvas, g);
  },
  bake: ({ textures }) => bakeToonBlast(textures),
  ensureAnims: ensureToonBlastAnims,
  afterNudge: (key, p) => {
    if (key === "blobsMin" && (p.blobsMax ?? 0) < (p.blobsMin ?? 0)) p.blobsMax = p.blobsMin;
    if (key === "blobsMax" && (p.blobsMin ?? 0) > (p.blobsMax ?? 0)) p.blobsMin = p.blobsMax;
  },
  afterRandomize: syncBlobBounds,
});

// ─── Tracks ─────────────────────────────────────────────────────────────────

export type TrackKind = "tread" | "tire" | "dual" | "wide" | "mono";
export const TRACK_KINDS: TrackKind[] = ["tread", "tire", "dual", "wide", "mono"];

function drawTrack(
  kind: TrackKind,
  opts?: { w?: number; h?: number; alpha?: number }
): HTMLCanvasElement {
  const w = opts?.w ?? 32;
  const h = opts?.h ?? 22;
  const a = opts?.alpha ?? 0.5;
  const c = canvas(w, h);
  const g = ctxOf(c);
  const dirt = (mul: number) => `rgba(32,26,16,${a * mul})`;
  if (kind === "tread") {
    g.fillStyle = dirt(1);
    for (let y = 2; y < h - 2; y += 4) {
      g.fillRect(2, y, w * 0.31, 2.2);
      g.fillRect(w * 0.62, y, w * 0.31, 2.2);
    }
    return c;
  }
  if (kind === "tire") {
    g.fillStyle = dirt(0.84);
    g.fillRect(w * 0.16, 3, 3.2, h - 6);
    g.fillRect(w * 0.75, 3, 3.2, h - 6);
    g.fillStyle = dirt(0.44);
    for (let y = 4; y < h - 4; y += 5) {
      g.fillRect(w * 0.16, y, 3.2, 1.1);
      g.fillRect(w * 0.75, y, 3.2, 1.1);
    }
    return c;
  }
  if (kind === "mono") {
    g.fillStyle = dirt(0.96);
    g.fillRect(w * 0.44, 2, 4.2, h - 4);
    g.fillStyle = dirt(0.48);
    for (let y = 4; y < h - 3; y += 5) g.fillRect(w * 0.44, y, 4.2, 1.15);
    return c;
  }
  if (kind === "dual") {
    g.fillStyle = dirt(0.88);
    g.fillRect(2, 3, 3, h - 6);
    g.fillRect(6.5, 3, 3, h - 6);
    g.fillRect(w - 10, 3, 3, h - 6);
    g.fillRect(w - 5, 3, 3, h - 6);
    return c;
  }
  g.fillStyle = dirt(0.92);
  g.fillRect(3, 2, 8, h - 4);
  g.fillRect(w - 11, 2, 8, h - 4);
  g.fillStyle = dirt(0.4);
  for (let y = 4; y < h - 3; y += 6) {
    g.fillRect(3, y, 8, 1.2);
    g.fillRect(w - 11, y, 8, 1.2);
  }
  return c;
}

const TRACK_DEFAULTS = { kind: 0, alpha: 0.5, width: 32, height: 22 };
const trackParams = { ...TRACK_DEFAULTS };

registerArtGen({
  id: "tracks",
  label: "TRACKS",
  blurb: "Vehicle dirt track stamps (fx_track_*)",
  animated: false,
  params: trackParams,
  defaults: { ...TRACK_DEFAULTS },
  meta: {
    kind: {
      step: 1,
      stepFast: 1,
      min: 0,
      max: TRACK_KINDS.length - 1,
      clamp: true,
      desc: `Track style index: ${TRACK_KINDS.join(", ")}.`,
    },
    alpha: { step: 0.02, stepFast: 0.08, min: 0.15, max: 0.85, decimals: 2, desc: "Dirt opacity." },
    width: { step: 2, stepFast: 8, min: 16, max: 64, desc: "Canvas width (px)." },
    height: { step: 2, stepFast: 8, min: 12, max: 48, desc: "Canvas height (px)." },
  },
  render: (_t, _seed, params, dest) => {
    const kind = TRACK_KINDS[Math.max(0, Math.min(TRACK_KINDS.length - 1, Math.round(artGenNum(params.kind))))]!;
    const art = drawTrack(kind, {
      w: Math.max(8, Math.round(artGenNum(params.width, 32))),
      h: Math.max(8, Math.round(artGenNum(params.height, 22))),
      alpha: artGenNum(params.alpha, 0.5),
    });
    dest.width = art.width;
    dest.height = art.height;
    const g = dest.getContext("2d")!;
    g.clearRect(0, 0, dest.width, dest.height);
    g.drawImage(art, 0, 0);
    return dest;
  },
  bake: ({ textures }) => {
    for (const kind of TRACK_KINDS) {
      putCanvas(
        textures,
        `fx_track_${kind}`,
        drawTrack(kind, {
          w: Math.max(8, Math.round(trackParams.width)),
          h: Math.max(8, Math.round(trackParams.height)),
          alpha: trackParams.alpha,
        })
      );
    }
  },
});

// ─── Shells ─────────────────────────────────────────────────────────────────

function drawShell(variant: number): HTMLCanvasElement {
  const w = 14;
  const h = 6;
  const c = canvas(w, h);
  const g = ctxOf(c);
  const cy = h / 2;
  const palettes = [
    { brass: [208, 162, 86], dark: [110, 78, 36], rim: [242, 214, 140] },
    { brass: [196, 148, 72], dark: [92, 64, 28], rim: [232, 198, 120] },
    { brass: [168, 124, 58], dark: [78, 54, 24], rim: [210, 172, 98] },
    { brass: [138, 98, 48], dark: [62, 42, 20], rim: [178, 138, 78] },
    { brass: [112, 78, 38], dark: [48, 32, 16], rim: [148, 110, 62] },
  ];
  const pal = palettes[variant % palettes.length]!;
  const { brass, dark, rim } = pal;
  const rgb = (ch: number[], a = 1) => `rgba(${ch[0]},${ch[1]},${ch[2]},${a})`;

  g.fillStyle = rgb(brass);
  roundRect(g, 1.5, 1.1, 10.5, h - 2.2, 1.2);
  g.fill();
  const hiA = variant >= 3 ? 0.28 : variant >= 2 ? 0.4 : 0.55;
  g.fillStyle = rgb(rim, hiA);
  roundRect(g, 2.2, 1.4, 8.5, 1.2, 0.6);
  g.fill();
  g.fillStyle = rgb(dark);
  g.beginPath();
  g.ellipse(2.2, cy, 1.35, h * 0.38, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = rgb(rim, variant >= 3 ? 0.4 : 0.7);
  g.beginPath();
  g.ellipse(2.2, cy, 0.55, h * 0.18, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = rgb(dark, 0.85);
  g.beginPath();
  g.ellipse(12.2, cy, 0.95, h * 0.32, 0, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = rgb(brass, 0.9);
  g.lineWidth = 0.6;
  g.beginPath();
  g.ellipse(12.2, cy, 0.95, h * 0.32, 0, 0, Math.PI * 2);
  g.stroke();
  return c;
}

const SHELL_DEFAULTS = { variant: 0 };
const shellParams = { ...SHELL_DEFAULTS };

registerArtGen({
  id: "shells",
  label: "SHELLS",
  blurb: "Brass casing stamps (fx_shell*)",
  animated: false,
  params: shellParams,
  defaults: { ...SHELL_DEFAULTS },
  meta: {
    variant: { step: 1, stepFast: 1, min: 0, max: 4, clamp: true, desc: "Brass palette variant (0–4)." },
  },
  render: (_t, _seed, params, dest) => {
    const art = drawShell(Math.round(artGenNum(params.variant)));
    dest.width = art.width;
    dest.height = art.height;
    const g = dest.getContext("2d")!;
    g.clearRect(0, 0, dest.width, dest.height);
    g.drawImage(art, 0, 0);
    return dest;
  },
  bake: ({ textures }) => {
    for (let i = 0; i < 5; i++) {
      const art = drawShell(i);
      const key = i === 0 ? "fx_shell" : `fx_shell_${i}`;
      putCanvas(textures, key, art);
      putCanvas(textures, `${key}_heat`, bakeThermalHeatFromAlpha(art));
    }
  },
});

// ─── Road / bridge stamps (terrain polyline paint) ───────────────────────────

export const FX_ROAD = "fx_road";
export const FX_BRIDGE = "fx_bridge";

function unpackRgb(c: number): [number, number, number] {
  const n = c >>> 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function cssRgb(c: number, a = 1): string {
  const [r, g, b] = unpackRgb(c);
  return `rgba(${r},${g},${b},${a})`;
}

const ROAD_DEFAULTS = {
  width: 64,
  height: 20,
  dirtDark: 0x5a4630,
  dirtMid: 0x6e5638,
  speckDark: 0x4a3a28,
  speckLight: 0x7a6244,
  speckCount: 48,
  edgeAlpha: 0.35,
};
const roadParams = { ...ROAD_DEFAULTS };

/** Dirt road stamp used when painting terrain roads. */
export function drawRoadStamp(p: ArtGenParamMap = roadParams): HTMLCanvasElement {
  const w = Math.max(16, Math.round(artGenNum(p.width, 64)));
  const h = Math.max(8, Math.round(artGenNum(p.height, 20)));
  const c = canvas(w, h);
  const g = ctxOf(c);
  const pad = Math.max(1, Math.round(h * 0.1));
  g.fillStyle = cssRgb(artGenNum(p.dirtDark, ROAD_DEFAULTS.dirtDark));
  g.fillRect(0, pad, w, h - pad * 2);
  g.fillStyle = cssRgb(artGenNum(p.dirtMid, ROAD_DEFAULTS.dirtMid));
  g.fillRect(0, pad * 2, w, h - pad * 4);
  const n = Math.max(0, Math.round(artGenNum(p.speckCount, 48)));
  for (let i = 0; i < n; i++) {
    const x = (i * 17 + 3) % w;
    const y = pad * 2 + ((i * 9) % Math.max(1, h - pad * 4));
    g.fillStyle = cssRgb(
      i % 3 === 0
        ? artGenNum(p.speckDark, ROAD_DEFAULTS.speckDark)
        : artGenNum(p.speckLight, ROAD_DEFAULTS.speckLight)
    );
    g.fillRect(x, y, 2, 2);
  }
  g.fillStyle = `rgba(30, 22, 14,${artGenNum(p.edgeAlpha, 0.35)})`;
  g.fillRect(0, pad, w, 1);
  g.fillRect(0, h - pad - 1, w, 1);
  return c;
}

registerArtGen({
  id: "road",
  label: "ROAD",
  blurb: "Dirt road stamp for terrain polylines (fx_road)",
  animated: false,
  params: roadParams,
  defaults: { ...ROAD_DEFAULTS },
  meta: {
    width: { step: 4, stepFast: 16, min: 32, max: 128, desc: "Stamp canvas width (px)." },
    height: { step: 2, stepFast: 8, min: 10, max: 48, desc: "Stamp canvas height (px)." },
    dirtDark: { step: 0x010101, stepFast: 0x101010, min: 0, max: 0xffffff, hex: true, desc: "Outer dirt band (0xRRGGBB)." },
    dirtMid: { step: 0x010101, stepFast: 0x101010, min: 0, max: 0xffffff, hex: true, desc: "Inner dirt band (0xRRGGBB)." },
    speckDark: { step: 0x010101, stepFast: 0x101010, min: 0, max: 0xffffff, hex: true, desc: "Dark grit speck color." },
    speckLight: { step: 0x010101, stepFast: 0x101010, min: 0, max: 0xffffff, hex: true, desc: "Light grit speck color." },
    speckCount: { step: 4, stepFast: 16, min: 0, max: 120, desc: "Number of grit specks." },
    edgeAlpha: { step: 0.05, stepFast: 0.15, min: 0, max: 1, decimals: 2, desc: "Dark edge line opacity." },
  },
  render: (_t, _seed, params, dest) => {
    const art = drawRoadStamp(params);
    dest.width = art.width;
    dest.height = art.height;
    const g = dest.getContext("2d")!;
    g.clearRect(0, 0, dest.width, dest.height);
    g.drawImage(art, 0, 0);
    return dest;
  },
  bake: ({ textures }) => putCanvas(textures, FX_ROAD, drawRoadStamp(roadParams)),
});

const BRIDGE_DEFAULTS = {
  width: 72,
  height: 24,
  deck: 0x3a2e22,
  plankA: 0x8a6e48,
  plankB: 0x7a5e3c,
  rail: 0x2a2218,
  highlight: 0xc4a46a,
  planks: 9,
};
const bridgeParams = { ...BRIDGE_DEFAULTS };

/** Plank bridge stamp for water road segments. */
export function drawBridgeStamp(p: ArtGenParamMap = bridgeParams): HTMLCanvasElement {
  const w = Math.max(24, Math.round(artGenNum(p.width, 72)));
  const h = Math.max(12, Math.round(artGenNum(p.height, 24)));
  const c = canvas(w, h);
  const g = ctxOf(c);
  const pad = Math.max(2, Math.round(h * 0.12));
  g.fillStyle = cssRgb(artGenNum(p.deck, BRIDGE_DEFAULTS.deck));
  g.fillRect(0, pad, w, h - pad * 2);
  const n = Math.max(2, Math.round(artGenNum(p.planks, 9)));
  const plankW = w / n;
  for (let i = 0; i < n; i++) {
    g.fillStyle = cssRgb(
      i % 2 === 0
        ? artGenNum(p.plankA, BRIDGE_DEFAULTS.plankA)
        : artGenNum(p.plankB, BRIDGE_DEFAULTS.plankB)
    );
    g.fillRect(i * plankW, pad + 2, Math.max(1, plankW - 1), h - pad * 2 - 4);
    g.fillStyle = "rgba(20, 14, 8, 0.35)";
    g.fillRect(i * plankW + plankW - 1, pad + 2, 1, h - pad * 2 - 4);
  }
  g.fillStyle = cssRgb(artGenNum(p.rail, BRIDGE_DEFAULTS.rail));
  g.fillRect(0, pad, w, 2);
  g.fillRect(0, h - pad - 2, w, 2);
  g.fillStyle = cssRgb(artGenNum(p.highlight, BRIDGE_DEFAULTS.highlight));
  g.fillRect(1, pad - 1, w - 2, 1);
  g.fillRect(1, h - pad, w - 2, 1);
  return c;
}

registerArtGen({
  id: "bridge",
  label: "BRIDGE",
  blurb: "Plank bridge stamp for water crossings (fx_bridge)",
  animated: false,
  params: bridgeParams,
  defaults: { ...BRIDGE_DEFAULTS },
  meta: {
    width: { step: 4, stepFast: 16, min: 40, max: 128, desc: "Stamp canvas width (px)." },
    height: { step: 2, stepFast: 8, min: 12, max: 48, desc: "Stamp canvas height (px)." },
    deck: { step: 0x010101, stepFast: 0x101010, min: 0, max: 0xffffff, hex: true, desc: "Deck under-color." },
    plankA: { step: 0x010101, stepFast: 0x101010, min: 0, max: 0xffffff, hex: true, desc: "Even plank color." },
    plankB: { step: 0x010101, stepFast: 0x101010, min: 0, max: 0xffffff, hex: true, desc: "Odd plank color." },
    rail: { step: 0x010101, stepFast: 0x101010, min: 0, max: 0xffffff, hex: true, desc: "Side rail color." },
    highlight: { step: 0x010101, stepFast: 0x101010, min: 0, max: 0xffffff, hex: true, desc: "Rail highlight color." },
    planks: { step: 1, stepFast: 2, min: 3, max: 16, desc: "Number of deck planks." },
  },
  render: (_t, _seed, params, dest) => {
    const art = drawBridgeStamp(params);
    dest.width = art.width;
    dest.height = art.height;
    const g = dest.getContext("2d")!;
    g.clearRect(0, 0, dest.width, dest.height);
    g.drawImage(art, 0, 0);
    return dest;
  },
  bake: ({ textures }) => putCanvas(textures, FX_BRIDGE, drawBridgeStamp(bridgeParams)),
});

// ─── Cannon tracers ─────────────────────────────────────────────────────────

export const TRACER_SHAPES = ["tear", "bolt", "orb"] as const;

/** M62 7.62 defaults — same recipe as combat.ts TRACER_762. */
const TRACER_DEFAULTS = {
  w: 44,
  h: 6,
  core: 0xffdcaa,
  mid: 0xff822d,
  rim: 0xbe3c16,
  blunt: 0,
  glow: 0.36,
  twin: 0,
  shape: 0,
};
const tracerParams = { ...TRACER_DEFAULTS };

export function tracerOptsFromParams(p: ArtGenParamMap = tracerParams): TracerShapeOpts {
  const shapeIdx = Math.max(0, Math.min(TRACER_SHAPES.length - 1, Math.round(artGenNum(p.shape))));
  return {
    w: Math.max(8, Math.round(artGenNum(p.w, TRACER_DEFAULTS.w))),
    h: Math.max(2, Math.round(artGenNum(p.h, TRACER_DEFAULTS.h))),
    core: unpackRgb(artGenNum(p.core, TRACER_DEFAULTS.core)),
    mid: unpackRgb(artGenNum(p.mid, TRACER_DEFAULTS.mid)),
    rim: unpackRgb(artGenNum(p.rim, TRACER_DEFAULTS.rim)),
    blunt: artGenNum(p.blunt, TRACER_DEFAULTS.blunt),
    glow: artGenNum(p.glow, TRACER_DEFAULTS.glow),
    twin: artGenNum(p.twin) >= 0.5,
    shape: TRACER_SHAPES[shapeIdx],
  };
}

/** Live preview / bake of a procedural cannon tracer streak. */
export function drawTracerStamp(p: ArtGenParamMap = tracerParams): HTMLCanvasElement {
  return drawTracerShape(tracerOptsFromParams(p));
}

registerArtGen({
  id: "tracer",
  label: "TRACER",
  blurb: "Procedural cannon streak (shot_cannon_* / combat art.tracer)",
  animated: false,
  defaultZoom: 8,
  params: tracerParams,
  defaults: { ...TRACER_DEFAULTS },
  meta: {
    w: { step: 2, stepFast: 8, min: 16, max: 160, desc: "Canvas width (px) — streak length." },
    h: { step: 1, stepFast: 2, min: 3, max: 36, desc: "Canvas height (px) — streak thickness." },
    core: { step: 0x010101, stepFast: 0x101010, min: 0, max: 0xffffff, hex: true, desc: "Hot nose / core color." },
    mid: { step: 0x010101, stepFast: 0x101010, min: 0, max: 0xffffff, hex: true, desc: "Mid-body color." },
    rim: { step: 0x010101, stepFast: 0x101010, min: 0, max: 0xffffff, hex: true, desc: "Tail / rim glow color." },
    blunt: { step: 0.05, stepFast: 0.15, min: 0, max: 1, decimals: 2, desc: "0 = soft tear tip, 1 = blunt slug." },
    glow: { step: 0.05, stepFast: 0.15, min: 0, max: 1.5, decimals: 2, desc: "White highlight strength on the nose." },
    twin: { step: 1, stepFast: 1, min: 0, max: 1, clamp: true, desc: "0 = single streak, 1 = twin stacked." },
    shape: {
      step: 1,
      stepFast: 1,
      min: 0,
      max: 2,
      clamp: true,
      desc: "0 tear · 1 bolt (rail) · 2 orb (plasma).",
    },
  },
  render: (_t, _seed, params, dest) => {
    const art = drawTracerStamp(params);
    dest.width = art.width;
    dest.height = art.height;
    const g = dest.getContext("2d")!;
    g.clearRect(0, 0, dest.width, dest.height);
    g.drawImage(art, 0, 0);
    return dest;
  },
  // Preview-only — weapon tracers bake from combat.ts art.tracer at boot.
  bake: () => {},
});
