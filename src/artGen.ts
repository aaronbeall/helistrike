/**
 * Formal art-generation registry: parameterized procedural chrome shared by
 * bake + the Art Gen rig (toon blast, tracks, stamps, shells, …).
 */
import type Phaser from "phaser";

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
  desc: string;
};

export type ArtGenParamMap = Record<string, number>;
export type ArtGenMetaMap = Record<string, ArtGenParamMeta>;

export type ArtGenBakeCtx = {
  textures: Phaser.Textures.TextureManager;
  anims?: Phaser.Animations.AnimationManager;
};

export type ArtGenDef = {
  id: string;
  label: string;
  /** One-line catalog blurb. */
  blurb: string;
  /** Multi-frame / time-based preview. */
  animated: boolean;
  /** Preview loop length in seconds (animated only). */
  loopSec?: number;
  /** Live mutable params (shared with bake). */
  params: ArtGenParamMap;
  defaults: ArtGenParamMap;
  meta: ArtGenMetaMap;
  /**
   * Optional heavy layout rebuild when seed/params change.
   * Return value is passed back into `render` as `prepared`.
   */
  prepare?: (seed: number, params: ArtGenParamMap) => unknown;
  /** Paint one preview frame. `t` is 0–1 for animated gens. */
  render: (
    t: number,
    seed: number,
    params: ArtGenParamMap,
    canvas: HTMLCanvasElement,
    g: CanvasRenderingContext2D,
    prepared?: unknown
  ) => HTMLCanvasElement;
  /** Write runtime textures (and optional anims if ctx.anims present). */
  bake: (ctx: ArtGenBakeCtx) => void;
  ensureAnims?: (
    anims: Phaser.Animations.AnimationManager,
    textures: Phaser.Textures.TextureManager
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
  const v = def.params[key] ?? 0;
  if (!meta) return String(v);
  if (meta.hex) return `#${(v >>> 0).toString(16).padStart(6, "0")}`;
  if (meta.decimals != null) return v.toFixed(meta.decimals);
  if (Number.isInteger(meta.step) && meta.decimals == null) return String(Math.round(v));
  return v.toFixed(2);
}

export function nudgeArtGenParam(def: ArtGenDef, key: string, dir: number, fast: boolean): void {
  const meta = def.meta[key];
  if (!meta || !(key in def.params)) return;
  const step = (fast ? meta.stepFast : meta.step) * dir;
  let next = def.params[key]! + step;
  if (meta.hex) next = (next >>> 0) & 0xffffff;
  else if (Number.isInteger(meta.step) && meta.decimals == null) next = Math.round(next);
  if (meta.clamp) next = Math.min(meta.max, Math.max(meta.min, next));
  def.params[key] = next;
  def.afterNudge?.(key, def.params);
}

export function randomizeArtGen(def: ArtGenDef): void {
  for (const key of Object.keys(def.meta)) {
    const meta = def.meta[key]!;
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

/** Bake every registered generator into the texture cache. */
export function bakeAllArtGens(textures: Phaser.Textures.TextureManager): void {
  for (const def of REGISTRY) {
    def.bake({ textures });
  }
}

/** Register one-shot anims for any gen that provides them. */
export function ensureAllArtGenAnims(
  anims: Phaser.Animations.AnimationManager,
  textures: Phaser.Textures.TextureManager
): void {
  for (const def of REGISTRY) {
    def.ensureAnims?.(anims, textures);
  }
}
