import type Phaser from "phaser";
import { registerArt } from "./sprites";

/**
 * Cel-shaded blast hierarchy (top → bottom):
 *   explosion → cluster → blob → layer (smoke, orange, yellow)
 *
 * Reference sequence: hot yellow/orange fire → brown smoke wraps → dust fragments.
 * Hard cel bands, soft outer bloom, crescent cutaways; cools over the clip.
 */

export const TOON_BLAST_KEY = "fx_toon_blast";
export const TOON_BLAST_VARIANTS = 7;

export function toonBlastKey(variant = 0): string {
  return `${TOON_BLAST_KEY}_${variant}`;
}

export type ToonBlastParams = {
  // —— explosion ——
  size: number;
  frames: number;
  cutStart: number;
  easePower: number;
  /** 0 = stays hot; 1 = fully cools to dust by end. */
  coolAmount: number;
  /** Soft bloom strength early in the clip. */
  bloomStrength: number;
  bloomSize: number;

  // —— cluster ——
  largeClusters: number;
  smallClusters: number;
  clusterAngJitter: number;
  clusterDist0Max: number;
  clusterDist1Base: number;
  clusterDist1Jitter: number;
  clusterDist1LargeBonus: number;
  clusterMotionMin: number;
  clusterMotionMax: number;
  clusterLifeMin: number;
  clusterLifeMax: number;
  clusterBlobSpreadStart: number;
  clusterBlobSpreadEnd: number;
  /** Early vertical bias (1 = tall column, 0 = round). */
  clusterVerticalBias: number;

  // —— blob ——
  blobsMin: number;
  blobsMax: number;
  blobRLargeMin: number;
  blobRLargeMax: number;
  blobRSmallMin: number;
  blobRSmallMax: number;
  blobLocalDistLargeMin: number;
  blobLocalDistLargeSpan: number;
  blobLocalDistSmallMin: number;
  blobLocalDistSmallSpan: number;
  blobScaleStart: number;
  blobScaleEnd: number;
  blobDurMin: number;
  blobDurMax: number;
  /** Extra skinny ejecta count. */
  sparkCount: number;
  sparkLen: number;
  sparkWid: number;
  /** How far sparks travel (px from center). */
  sparkDist: number;

  // —— layer ——
  layerSmokeScale: number;
  layerOrangeScale: number;
  layerYellowScale: number;
  layerOrangeInset: number;
  layerYellowInset: number;
  layerShadowOffset: number;
  layerShadowScale: number;
  layerYellowCutStart: number;
  layerYellowCutEnd: number;
  layerOrangeCutStart: number;
  layerOrangeCutEnd: number;
  layerSmokeCutStart: number;
  layerSmokeCutEnd: number;
  layerRoughness: number;
  layerHoleScale: number;

  // —— colors (0xRRGGBB) ——
  colYellow: number;
  colOrange: number;
  colSmoke: number;
  colShadow: number;
};

export const TOON_BLAST_DEFAULTS: ToonBlastParams = {
  size: 192,
  frames: 36,
  cutStart: 0.2,
  easePower: 5,
  coolAmount: 1,
  bloomStrength: 0.45,
  bloomSize: 1.35,

  largeClusters: 3,
  smallClusters: 3,
  clusterAngJitter: 0.28,
  clusterDist0Max: 3,
  clusterDist1Base: 26,
  clusterDist1Jitter: 10,
  clusterDist1LargeBonus: 6,
  clusterMotionMin: 0.8,
  clusterMotionMax: 1,
  clusterLifeMin: 0.35,
  clusterLifeMax: 1,
  clusterBlobSpreadStart: 0.7,
  clusterBlobSpreadEnd: 1.15,
  clusterVerticalBias: 0.55,

  blobsMin: 3,
  blobsMax: 5,
  blobRLargeMin: 28,
  blobRLargeMax: 42,
  blobRSmallMin: 14,
  blobRSmallMax: 24,
  blobLocalDistLargeMin: 3,
  blobLocalDistLargeSpan: 11,
  blobLocalDistSmallMin: 2,
  blobLocalDistSmallSpan: 7,
  blobScaleStart: 0.42,
  blobScaleEnd: 1,
  blobDurMin: 0.75,
  blobDurMax: 1,
  sparkCount: 3,
  sparkLen: 26,
  sparkWid: 3.2,
  sparkDist: 88,

  layerSmokeScale: 1,
  layerOrangeScale: 0.72,
  layerYellowScale: 0.48,
  layerOrangeInset: 0.12,
  layerYellowInset: 0.22,
  layerShadowOffset: 0.22,
  layerShadowScale: 0.55,
  layerYellowCutStart: 0,
  layerYellowCutEnd: 0.9,
  layerOrangeCutStart: 0.04,
  layerOrangeCutEnd: 0.94,
  layerSmokeCutStart: 0.08,
  layerSmokeCutEnd: 1,
  layerRoughness: 0.14,
  layerHoleScale: 2.2,

  colYellow: 0xffeb5a,
  colOrange: 0xff781c,
  colSmoke: 0x6e5848,
  colShadow: 0x483830,
};

export const toonBlastParams: ToonBlastParams = { ...TOON_BLAST_DEFAULTS };
export const TOON_BLAST_SIZE = TOON_BLAST_DEFAULTS.size;
export const TOON_BLAST_FRAMES = TOON_BLAST_DEFAULTS.frames;

export type ToonLayerId = "smoke" | "orange" | "yellow";

export type ToonBlob = {
  localAng: number;
  localDist: number;
  rMax: number;
  orient: number;
  durScale: number;
  seed: number;
  /** 1 = normal blob, >1 lengthens along orient (spark). */
  stretch: number;
};

export type ToonCluster = {
  ang: number;
  dist0: number;
  dist1: number;
  motionScale: number;
  lifeScale: number;
  large: boolean;
  /** Skinny ejecta — orange/yellow only, outward cut, rounds to a tip. */
  spark: boolean;
  blobs: ToonBlob[];
};

const LAYER_ORDER: ToonLayerId[] = ["smoke", "orange", "yellow"];

function easeOutHeavy(t: number, power: number): number {
  const x = Math.max(0, Math.min(1, t));
  return 1 - Math.pow(1 - x, power);
}

function easeInHeavy(t: number, power: number): number {
  const x = Math.max(0, Math.min(1, t));
  return Math.pow(x, power);
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function unpackRgb(c: number): [number, number, number] {
  const n = c >>> 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgb(r: number, g: number, b: number, a = 1): string {
  return `rgba(${r | 0},${g | 0},${b | 0},${a})`;
}

function rgbHex(c: number, a = 1): string {
  const [r, g, b] = unpackRgb(c);
  return rgb(r, g, b, a);
}

function layerScaleOf(p: ToonBlastParams, layer: ToonLayerId, heat: number): number {
  if (layer === "smoke") {
    // Smoke grows as fire cools.
    return p.layerSmokeScale * (0.75 + 0.35 * (1 - heat));
  }
  if (layer === "orange") return p.layerOrangeScale * (0.35 + 0.65 * heat);
  return p.layerYellowScale * heat;
}

function layerInsetOf(p: ToonBlastParams, layer: ToonLayerId): number {
  if (layer === "orange") return p.layerOrangeInset;
  if (layer === "yellow") return p.layerYellowInset;
  return 0;
}

function layerCutOf(p: ToonBlastParams, layer: ToonLayerId): { start: number; end: number } {
  if (layer === "yellow") return { start: p.layerYellowCutStart, end: p.layerYellowCutEnd };
  if (layer === "orange") return { start: p.layerOrangeCutStart, end: p.layerOrangeCutEnd };
  return { start: p.layerSmokeCutStart, end: p.layerSmokeCutEnd };
}

function layerColor(p: ToonBlastParams, layer: ToonLayerId): number {
  if (layer === "yellow") return p.colYellow;
  if (layer === "orange") return p.colOrange;
  return p.colSmoke;
}

/** Global heat 1→0 over the clip (drives fire→smoke→dust). */
function heatAt(t: number, p: ToonBlastParams): number {
  return 1 - p.coolAmount * easeInHeavy(t, 1.6);
}

export function makeToonClusters(rng: () => number, p: ToonBlastParams = toonBlastParams): ToonCluster[] {
  const kinds: boolean[] = [
    ...Array.from({ length: Math.max(0, Math.round(p.largeClusters)) }, () => true),
    ...Array.from({ length: Math.max(0, Math.round(p.smallClusters)) }, () => false),
  ];
  for (let i = kinds.length - 1; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    const tmp = kinds[i]!;
    kinds[i] = kinds[j]!;
    kinds[j] = tmp;
  }

  const blobsLo = Math.max(1, Math.round(p.blobsMin));
  const blobsHi = Math.max(blobsLo, Math.round(p.blobsMax));
  const clusters: ToonCluster[] = [];

  for (let i = 0; i < kinds.length; i++) {
    const large = kinds[i]!;
    let ang = (i / Math.max(1, kinds.length)) * Math.PI * 2 + (rng() - 0.5) * p.clusterAngJitter;
    // Bias some travel upward early (vertical fire column feel).
    if (p.clusterVerticalBias > 0.01) {
      const up = -Math.PI / 2;
      ang = ang * (1 - p.clusterVerticalBias * 0.45) + up * p.clusterVerticalBias * 0.45;
    }
    const blobN = blobsLo + ((rng() * (blobsHi - blobsLo + 1)) | 0);
    const blobs: ToonBlob[] = [];
    for (let b = 0; b < blobN; b++) {
      blobs.push({
        localAng: rng() * Math.PI * 2,
        localDist: large
          ? p.blobLocalDistLargeMin + rng() * p.blobLocalDistLargeSpan
          : p.blobLocalDistSmallMin + rng() * p.blobLocalDistSmallSpan,
        rMax: large
          ? p.blobRLargeMin + rng() * (p.blobRLargeMax - p.blobRLargeMin)
          : p.blobRSmallMin + rng() * (p.blobRSmallMax - p.blobRSmallMin),
        orient: rng() * Math.PI * 2,
        durScale: p.blobDurMin + rng() * (p.blobDurMax - p.blobDurMin),
        seed: rng() * 100,
        stretch: 1,
      });
    }
    clusters.push({
      ang,
      dist0: rng() * p.clusterDist0Max,
      dist1:
        p.clusterDist1Base +
        rng() * p.clusterDist1Jitter +
        (large ? p.clusterDist1LargeBonus : 0),
      motionScale: p.clusterMotionMin + rng() * (p.clusterMotionMax - p.clusterMotionMin),
      lifeScale: p.clusterLifeMin + rng() * (p.clusterLifeMax - p.clusterLifeMin),
      large,
      spark: false,
      blobs,
    });
  }

  // Thin spark ejecta: one heavily eased shoot → shrink → wipe (no separate phases).
  const sparks = Math.max(0, Math.round(p.sparkCount));
  for (let s = 0; s < sparks; s++) {
    const ang = rng() * Math.PI * 2;
    clusters.push({
      ang,
      dist0: 0,
      dist1: p.sparkDist * (0.85 + rng() * 0.3),
      motionScale: 1,
      // Life = how much of the clip the single spark gesture occupies.
      lifeScale: 0.42 + rng() * 0.22,
      large: false,
      spark: true,
      blobs: [
        {
          localAng: 0,
          localDist: 0,
          rMax: p.sparkWid * (0.85 + rng() * 0.4),
          orient: ang,
          durScale: 0.9 + rng() * 0.15,
          seed: rng() * 100,
          stretch: Math.max(2.2, p.sparkLen / Math.max(1, p.sparkWid)),
        },
      ],
    });
  }
  return clusters;
}

function fillLayerShape(
  g: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rot: number,
  seed: number,
  roughness: number
): void {
  const n = 22;
  const pts: { x: number; y: number }[] = [];
  const ca = Math.cos(rot);
  const sa = Math.sin(rot);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const wob =
      1 +
      roughness * 0.5 * Math.sin(a * 2 + seed) +
      roughness * 0.28 * Math.sin(a * 3 + seed * 1.3) +
      roughness * 0.1 * Math.sin(a * 4 + seed * 0.5);
    const lx = Math.cos(a) * rx * wob;
    const ly = Math.sin(a) * ry * wob;
    pts.push({ x: cx + lx * ca - ly * sa, y: cy + lx * sa + ly * ca });
  }
  const mid = (i: number) => {
    const a = pts[((i % n) + n) % n]!;
    const b = pts[((i + 1) % n + n) % n]!;
    return { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 };
  };
  g.beginPath();
  const m0 = mid(n - 1);
  g.moveTo(m0.x, m0.y);
  for (let i = 0; i < n; i++) {
    const pt = pts[i]!;
    const m = mid(i);
    g.quadraticCurveTo(pt.x, pt.y, m.x, m.y);
  }
  g.closePath();
  g.fill();
}

type BlobState = {
  x: number;
  y: number;
  r: number;
  stretch: number;
  orient: number;
  towardX: number;
  towardY: number;
  cutT: Record<ToonLayerId, number>;
  seed: number;
  spark: boolean;
};

function blobAt(
  cluster: ToonCluster,
  blob: ToonBlob,
  t: number,
  cx: number,
  cy: number,
  p: ToonBlastParams
): BlobState {
  const flightX = Math.cos(cluster.ang);
  const flightY = Math.sin(cluster.ang);

  // —— Sparks: single heavily eased progress drives travel + shrink + wipe ——
  if (cluster.spark) {
    const life = Math.max(0.08, cluster.lifeScale * blob.durScale);
    const u = easeOutHeavy(Math.min(1, t / life), Math.max(4, p.easePower));

    const tipDist = cluster.dist0 + (cluster.dist1 - cluster.dist0) * u;
    // Base starts at center and catches the tip — length collapses with the same u.
    const baseDist = tipDist * u;
    const length = Math.max(0.01, tipDist - baseDist);
    const mid = (baseDist + tipDist) * 0.5;

    const r = blob.rMax * (1 - u * 0.65);
    const stretch = Math.max(1, length / Math.max(0.35, r * 2));
    const towardX = flightX;
    const towardY = flightY;

    const cutT = { smoke: 1, orange: u, yellow: u } as Record<ToonLayerId, number>;
    return {
      x: cx + flightX * mid,
      y: cy + flightY * mid,
      r,
      stretch,
      orient: cluster.ang,
      towardX,
      towardY,
      cutT,
      seed: blob.seed,
      spark: true,
    };
  }

  const spread = easeOutHeavy(Math.min(1, t / Math.max(0.05, cluster.motionScale)), p.easePower);
  const dist = cluster.dist0 + (cluster.dist1 - cluster.dist0) * spread;
  const bias = p.clusterVerticalBias * (1 - spread * 0.65);
  const dx = flightX * dist * (1 - bias * 0.25);
  const dy = flightY * dist * (1 + bias * 0.85);
  const ccx = cx + dx;
  const ccy = cy + dy;

  const localSpread =
    p.clusterBlobSpreadStart + (p.clusterBlobSpreadEnd - p.clusterBlobSpreadStart) * spread;
  const x = ccx + Math.cos(blob.localAng) * blob.localDist * localSpread;
  const y = ccy + Math.sin(blob.localAng) * blob.localDist * localSpread;
  const scaleMul = p.blobScaleStart + (p.blobScaleEnd - p.blobScaleStart) * spread;
  const r = blob.rMax * scaleMul;
  const dustStretch = 1 + easeInHeavy(t, 2.2) * 0.35;
  const stretch = blob.stretch * dustStretch;

  const towardX = Math.cos(blob.orient);
  const towardY = Math.sin(blob.orient);

  const cutT = { smoke: 0, orange: 0, yellow: 0 } as Record<ToonLayerId, number>;
  if (t > p.cutStart) {
    const local =
      (t - p.cutStart) / ((1 - p.cutStart) * Math.max(0.05, cluster.lifeScale * blob.durScale));
    for (const layer of LAYER_ORDER) {
      const { start, end } = layerCutOf(p, layer);
      const span = Math.max(0.001, end - start);
      cutT[layer] = easeOutHeavy((local - start) / span, p.easePower);
    }
  }

  return {
    x,
    y,
    r,
    stretch,
    orient: blob.orient,
    towardX,
    towardY,
    cutT,
    seed: blob.seed,
    spark: false,
  };
}

function drawBlobLayer(
  tmp: HTMLCanvasElement,
  gTmp: CanvasRenderingContext2D,
  state: BlobState,
  layer: ToonLayerId,
  p: ToonBlastParams,
  heat: number
): boolean {
  // Sparks are fire-only (orange + yellow).
  if (state.spark && layer === "smoke") return false;

  const cut = state.cutT[layer];
  if (cut >= 0.995) return false;
  const scale = layerScaleOf(p, layer, heat);
  // Sparks stay hot (ignore cool fade on fire layers).
  const sparkScale =
    state.spark && layer !== "smoke"
      ? layer === "yellow"
        ? p.layerYellowScale
        : p.layerOrangeScale
      : scale;
  if (sparkScale < 0.06) return false;
  const lr = state.r * sparkScale;
  if (lr < 0.5) return false;

  gTmp.clearRect(0, 0, tmp.width, tmp.height);
  const inset = layerInsetOf(p, layer) * state.r;
  const lx = state.x + state.towardX * inset;
  const ly = state.y + state.towardY * inset;
  const rx = lr * state.stretch;
  const ry = lr;

  gTmp.globalCompositeOperation = "source-over";
  gTmp.fillStyle = rgbHex(layerColor(p, layer));
  fillLayerShape(
    gTmp,
    lx,
    ly,
    rx,
    ry,
    state.orient,
    state.seed + layer.length * 2.1,
    state.spark ? p.layerRoughness * 0.45 : p.layerRoughness
  );

  // Cel underside shadow on smoke (and mild on orange) — not on sparks.
  if (!state.spark && (layer === "smoke" || (layer === "orange" && heat < 0.55))) {
    const sh = layer === "smoke" ? 1 : 0.45;
    gTmp.fillStyle = rgbHex(p.colShadow, 0.92 * sh);
    const sox = lx + state.r * p.layerShadowOffset * 0.85;
    const soy = ly + state.r * p.layerShadowOffset;
    fillLayerShape(
      gTmp,
      sox,
      soy,
      rx * p.layerShadowScale,
      ry * p.layerShadowScale,
      state.orient,
      state.seed + 4.2,
      p.layerRoughness * 0.85
    );
  }

  if (cut > 0.001) {
    // Cut face always points outward along flight / toward.
    const along = state.spark ? rx : lr;
    const edgeX = lx + state.towardX * along;
    const edgeY = ly + state.towardY * (state.spark ? ry : along);
    // Sparks share the same u for wipe — keep hole moderate so shrink+wipe stay one gesture.
    const holeR = cut * lr * p.layerHoleScale * (state.spark ? 0.7 : 1);
    const holeRx = state.spark ? holeR : holeR * state.stretch;
    const holeRy = holeR;
    gTmp.globalCompositeOperation = "destination-out";
    gTmp.fillStyle = "#000";
    fillLayerShape(
      gTmp,
      edgeX,
      edgeY,
      holeRx,
      holeRy,
      state.orient,
      state.seed + 9.3 + layer.length,
      state.spark ? 0.05 : p.layerRoughness
    );
    gTmp.globalCompositeOperation = "source-over";
  }
  return true;
}

function drawBloom(
  g: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  strength: number,
  p: ToonBlastParams
): void {
  if (strength < 0.02 || radius < 4) return;
  const grd = g.createRadialGradient(cx, cy, radius * 0.15, cx, cy, radius * p.bloomSize);
  grd.addColorStop(0, rgbHex(p.colOrange, 0.35 * strength));
  grd.addColorStop(0.45, rgbHex(p.colYellow, 0.16 * strength));
  grd.addColorStop(1, rgbHex(p.colOrange, 0));
  g.fillStyle = grd;
  g.beginPath();
  g.arc(cx, cy, radius * p.bloomSize, 0, Math.PI * 2);
  g.fill();
}

export function renderToonBlastFrame(
  clusters: ToonCluster[],
  t: number,
  size: number,
  p: ToonBlastParams = toonBlastParams,
  tmp?: HTMLCanvasElement,
  gTmp?: CanvasRenderingContext2D
): HTMLCanvasElement {
  const scratch = tmp ?? document.createElement("canvas");
  if (scratch.width !== size || scratch.height !== size) {
    scratch.width = size;
    scratch.height = size;
  }
  const gScratch = gTmp ?? scratch.getContext("2d")!;

  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const g = c.getContext("2d")!;
  g.imageSmoothingEnabled = true;
  const cx = size * 0.5;
  const cy = size * 0.5;
  const heat = heatAt(t, p);

  const states: BlobState[] = [];
  let span = 0;
  for (const cluster of clusters) {
    for (const blob of cluster.blobs) {
      const st = blobAt(cluster, blob, t, cx, cy, p);
      states.push(st);
      span = Math.max(span, Math.hypot(st.x - cx, st.y - cy) + st.r * st.stretch);
    }
  }

  // Soft bloom behind (fades as it cools).
  drawBloom(g, cx, cy, Math.max(24, span * 0.9), p.bloomStrength * heat, p);

  for (const layer of LAYER_ORDER) {
    for (const state of states) {
      if (drawBlobLayer(scratch, gScratch, state, layer, p, heat)) {
        g.drawImage(scratch, 0, 0);
      }
    }
  }
  return c;
}

const VARIANT_SEEDS = [0xb1a57e, 0x4c2f91, 0x88d03a, 0x1fe6c4, 0x9a4412, 0x57c8e0, 0xd3a019];

function bakeOneVariant(
  textures: Phaser.Textures.TextureManager,
  key: string,
  seed: number,
  p: ToonBlastParams,
  tmp: HTMLCanvasElement,
  gTmp: CanvasRenderingContext2D
): void {
  const size = Math.max(32, Math.round(p.size));
  const frames = Math.max(2, Math.round(p.frames));
  const clusters = makeToonClusters(mulberry32(seed), p);
  const sheet = document.createElement("canvas");
  sheet.width = size * frames;
  sheet.height = size;
  const g = sheet.getContext("2d")!;

  for (let i = 0; i < frames; i++) {
    const t = i / (frames - 1);
    const frame = renderToonBlastFrame(clusters, t, size, p, tmp, gTmp);
    g.drawImage(frame, i * size, 0);
  }

  if (textures.exists(key)) textures.remove(key);
  textures.addSpriteSheet(key, sheet as unknown as HTMLImageElement, {
    frameWidth: size,
    frameHeight: size,
    endFrame: frames - 1,
  });
  registerArt(key, "generated");
}

export function bakeToonBlast(textures: Phaser.Textures.TextureManager): void {
  const p = toonBlastParams;
  const size = Math.max(32, Math.round(p.size));
  const tmp = document.createElement("canvas");
  tmp.width = size;
  tmp.height = size;
  const gTmp = tmp.getContext("2d")!;

  for (let v = 0; v < TOON_BLAST_VARIANTS; v++) {
    const seed = VARIANT_SEEDS[v] ?? (0xb1a57e + v * 0x9e3779b9);
    bakeOneVariant(textures, toonBlastKey(v), seed >>> 0, p, tmp, gTmp);
  }
  bakeOneVariant(textures, TOON_BLAST_KEY, VARIANT_SEEDS[0]!, p, tmp, gTmp);
}

export function resetToonBlastParams(): void {
  Object.assign(toonBlastParams, TOON_BLAST_DEFAULTS);
}

export function toonBlastAnimKey(variant = 0): string {
  return `${toonBlastKey(variant)}_anim`;
}

/** Register one-shot anims for baked variant sheets (idempotent). */
export function ensureToonBlastAnims(
  anims: Phaser.Animations.AnimationManager,
  textures: Phaser.Textures.TextureManager
): void {
  const frames = Math.max(2, Math.round(toonBlastParams.frames) || TOON_BLAST_FRAMES);
  const rate = Math.max(12, Math.round(frames / 1.15));
  const register = (tex: string, animKey: string) => {
    if (!textures.exists(tex)) return;
    if (anims.exists(animKey)) anims.remove(animKey);
    anims.create({
      key: animKey,
      frames: anims.generateFrameNumbers(tex, { start: 0, end: frames - 1 }),
      frameRate: rate,
      hideOnComplete: true,
    });
  };
  for (let v = 0; v < TOON_BLAST_VARIANTS; v++) {
    register(toonBlastKey(v), toonBlastAnimKey(v));
  }
  register(TOON_BLAST_KEY, `${TOON_BLAST_KEY}_anim`);
}
