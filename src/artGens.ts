/**
 * Concrete art generators registered into `artGen.ts`.
 * Import this module once from bake / ArtGenRig so the registry fills.
 */
import {
  registerArtGen,
  type ArtGenMetaMap,
  type ArtGenParamMap,
} from "./artGen";
import {
  TOON_BLAST_DEFAULTS,
  bakeToonBlast,
  ensureToonBlastAnims,
  makeToonClusters,
  mulberry32,
  renderToonBlastFrame,
  toonBlastParams,
  type ToonBlastParams,
  type ToonCluster,
} from "./toonBlast";
import {
  drawShellCasingArt,
  drawTrackArt,
  TRACK_KINDS,
} from "./bakeArt";
import { bakeThermalHeatFromAlpha, registerArt } from "./sprites";

// —— Toon blast (cel fireball sheets) ——

const TOON_META = {
  size: { step: 8, stepFast: 32, min: 64, max: 320, desc: "Explosion bake/preview canvas size (px)." },
  frames: { step: 1, stepFast: 4, min: 8, max: 64, desc: "Spritesheet frame count when baking." },
  cutStart: { step: 0.02, stepFast: 0.08, min: 0, max: 0.8, decimals: 2, desc: "Time when blob layer cutaways begin (0–1)." },
  easePower: { step: 0.5, stepFast: 1, min: 1, max: 10, decimals: 1, desc: "Ease-out exponent for cluster motion and cuts." },
  coolAmount: { step: 0.05, stepFast: 0.15, min: 0, max: 1.5, decimals: 2, desc: "How fast fire cools into smoke then dust (0=hot, 1=full cool)." },
  bloomStrength: { step: 0.02, stepFast: 0.1, min: 0, max: 1, decimals: 2, desc: "Soft outer glow early; fades as the blast cools." },
  bloomSize: { step: 0.05, stepFast: 0.15, min: 0.8, max: 2, decimals: 2, desc: "Bloom radius relative to blob span." },

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
  if ((p.blobsMax ?? 0) < (p.blobsMin ?? 0)) {
    const t = p.blobsMin!;
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
    const size = Math.max(32, Math.round(params.size ?? 192));
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

// —— Tracks ——

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
  render: (_t, _seed, params, canvas) => {
    const kind = TRACK_KINDS[Math.max(0, Math.min(TRACK_KINDS.length - 1, Math.round(params.kind ?? 0)))]!;
    const art = drawTrackArt(kind, {
      w: Math.max(8, Math.round(params.width ?? 32)),
      h: Math.max(8, Math.round(params.height ?? 22)),
      alpha: params.alpha ?? 0.5,
    });
    canvas.width = art.width;
    canvas.height = art.height;
    const g = canvas.getContext("2d")!;
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.drawImage(art, 0, 0);
    return canvas;
  },
  bake: ({ textures }) => {
    for (const kind of TRACK_KINDS) {
      const art = drawTrackArt(kind, {
        w: Math.max(8, Math.round(trackParams.width)),
        h: Math.max(8, Math.round(trackParams.height)),
        alpha: trackParams.alpha,
      });
      const key = `fx_track_${kind}`;
      if (textures.exists(key)) textures.remove(key);
      textures.addCanvas(key, art);
      registerArt(key, "generated");
    }
  },
});

// —— Shell casings ——

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
  render: (_t, _seed, params, canvas) => {
    const art = drawShellCasingArt(Math.round(params.variant ?? 0));
    canvas.width = art.width;
    canvas.height = art.height;
    const g = canvas.getContext("2d")!;
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.drawImage(art, 0, 0);
    return canvas;
  },
  bake: ({ textures }) => {
    for (let i = 0; i < 5; i++) {
      const art = drawShellCasingArt(i);
      const key = i === 0 ? "fx_shell" : `fx_shell_${i}`;
      if (textures.exists(key)) textures.remove(key);
      textures.addCanvas(key, art);
      registerArt(key, "generated");
      const heat = bakeThermalHeatFromAlpha(art);
      const heatKey = `${key}_heat`;
      if (textures.exists(heatKey)) textures.remove(heatKey);
      textures.addCanvas(heatKey, heat);
      registerArt(heatKey, "generated");
    }
  },
});

/** Side-effect import hook so callers can force registry init. */
export function ensureArtGensRegistered(): void {
  /* module load registers all gens */
}
