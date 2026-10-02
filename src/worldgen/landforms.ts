/** Landform stamps: mesas + buttes, impact craters, volcanoes, dune fields. */
import { fbm } from "./noise";
import { Rng } from "../util/rng";

export type LandformKind = "mesa" | "crater" | "volcano" | "dunes";
export type Landforms = Record<LandformKind, number>;

export const NO_LANDFORMS: Landforms = { mesa: 0, crater: 0, volcano: 0, dunes: 0 };

export const LANDFORM_KINDS: { id: LandformKind; label: string; max: number; description: string }[] = [
  { id: "mesa", label: "MESAS", max: 10, description: "Flat-topped rock mesas with sheer cliff walls, often flanked by smaller eroded buttes." },
  { id: "crater", label: "CRATERS", max: 8, description: "Impact craters: a raised rim around a sunken bowl that often holds a small lake." },
  { id: "volcano", label: "VOLCANOES", max: 3, description: "Volcanic cones with gullied flanks; in open sea each rises as its own island." },
  { id: "dunes", label: "DUNES", max: 5, description: "Fields of wind-driven sand dunes: long rippling crests with steep slip faces." },
];

type Stamp = { x: number; y: number; r: number };

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Free spot for a stamp of radius r (texels), or null. */
function place(
  rng: Rng,
  n: number,
  r: number,
  placed: Stamp[],
  avoid: { x: number; y: number },
  ok: (x: number, y: number) => boolean
): Stamp | null {
  for (let t = 0; t < 60; t++) {
    const x = rng.range(r + 20, n - r - 20);
    const y = rng.range(r + 20, n - r - 20);
    if (Math.hypot(x - avoid.x, y - avoid.y) < r + n * 0.09) continue;
    if (placed.some((p) => Math.hypot(p.x - x, p.y - y) < (p.r + r) * 0.9)) continue;
    if (!ok(x, y)) continue;
    return { x, y, r };
  }
  return null;
}

/** Noisy edge radius multiplier around a stamp. */
function edge(ang: number, seed: number, amt: number): number {
  return 1 + (fbm(Math.cos(ang) * 1.6 + 7, Math.sin(ang) * 1.6 + 3, seed, 3) - 0.5) * 2 * amt;
}

/** Loop reach for a profile that ends at q = qMax with edge wobble `amt` (edge() tops out at 1 + amt). */
function reach(qMax: number, amt: number): number {
  return qMax * (1 + amt) + 0.02;
}

function forBox(n: number, s: Stamp, k: number, fn: (i: number, d: number, ang: number) => void): void {
  const rr = s.r * k;
  const x0 = Math.max(1, Math.floor(s.x - rr));
  const x1 = Math.min(n - 2, Math.ceil(s.x + rr));
  const y0 = Math.max(1, Math.floor(s.y - rr));
  const y1 = Math.min(n - 2, Math.ceil(s.y + rr));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - s.x;
      const dy = y - s.y;
      const d = Math.hypot(dx, dy);
      if (d > rr) continue;
      fn(y * n + x, d, Math.atan2(dy, dx));
    }
  }
}

/** Caprock height: mesas always top out in the rock band. */
const MESA_CAP = 0.64;
const MESA_EDGE = 0.28;
/** Apron end (in mesa radii). */
const MESA_APRON = 2.1;
const VOLCANO_EDGE = 0.12;
const DUNE_EDGE = 0.3;
/** Crest height range (pre-light height units); kept low, taller fields read harsh. */
const DUNE_AMP_LO = 0.012;
const DUNE_AMP_HI = 0.017;
/** Crest position in each wavelength (windward share); the rest is the slip face. */
const DUNE_CREST = 0.65;
/** Dune fade-in distance (texels) from non-dune ground (rock, water, banks). */
const DUNE_FADE = 5;

function stampMesa(height: Float32Array, n: number, s: Stamp, seed: number, rise: number): void {
  const base = height[Math.round(s.y) * n + Math.round(s.x)]!;
  const top = Math.max(base + rise, MESA_CAP);
  forBox(n, s, reach(MESA_APRON, MESA_EDGE), (i, d, ang) => {
    const q = d / (s.r * edge(ang, seed, MESA_EDGE));
    // Flat cap, near-vertical wall, then a talus apron easing out to the ground.
    const tail = 1 - smooth(1.1, MESA_APRON, q);
    const lift = q < 1 ? 1 : q < 1.1 ? 1 - smooth(1, 1.1, q) * 0.72 : 0.28 * tail * tail;
    const cap = q < 1 ? (fbm((i % n) * 0.05, ((i / n) | 0) * 0.05, seed + 5, 2) - 0.5) * 0.01 : 0;
    // Ease from local ground toward the cap: lift 0 leaves the terrain exactly as it was.
    const h = height[i]!;
    height[i] = h + Math.max(0, top + cap - h) * lift;
  });
}

function stampCrater(height: Float32Array, n: number, s: Stamp, seed: number): void {
  const rim = (s.r / n) * 2.1;
  const bowl = rim * 1.7;
  forBox(n, s, 2.2, (i, d, ang) => {
    const q = d / (s.r * edge(ang, seed, 0.1));
    height[i] = height[i]! + (q < 1 ? -bowl * (1 - q * q) + rim * q ** 4 : rim * Math.exp(-(((q - 1) / 0.38) ** 2)));
  });
}

function stampVolcano(height: Float32Array, n: number, s: Stamp, seed: number, summit: number): void {
  const base = height[Math.round(s.y) * n + Math.round(s.x)]!;
  const rise = Math.max(0.12, summit - base);
  forBox(n, s, reach(1, VOLCANO_EDGE), (i, d, ang) => {
    const q = d / (s.r * edge(ang, seed, VOLCANO_EDGE));
    if (q >= 1) return;
    // Cone with radial gullies, and a summit crater.
    // Sample on a circle (cos/sin), not raw angle, so there's no seam where atan2 wraps at ±π.
    const gully = 1 + (fbm(Math.cos(ang) * 2.2 + 11, Math.sin(ang) * 2.2 + 3 + q * 1.2, seed + 3, 2) - 0.5) * 0.5 * q;
    // Concave cone, faded out over the outer skirt so the base meets the ground without a crease.
    let lift = (1 - q) ** 1.35 * gully * (1 - smooth(0.78, 1, q));
    if (q < 0.13) lift -= 0.16 * (1 - q / 0.13) ** 2;
    height[i] = height[i]! + rise * lift;
  });
}

/** Mesas, craters, volcanoes: pre-river relief (they shape biomes, lakes and rivers). Coords in texels. */
export function applyLandforms(
  height: Float32Array,
  n: number,
  lf: Landforms,
  seed: number,
  avoid: { x: number; y: number },
  waterH: number
): void {
  const rng = new Rng((seed ^ 0x1a4df) >>> 0);
  const placed: Stamp[] = [];
  const at = (x: number, y: number) => height[Math.round(y) * n + Math.round(x)]!;
  const dry = (x: number, y: number) => at(x, y) > waterH + 0.03;
  for (let k = 0; k < lf.volcano; k++) {
    // Rise from open sea as its own island when there's room; else anywhere.
    const r = n * rng.range(0.085, 0.115);
    const sea = (x: number, y: number) => at(x, y) < waterH - 0.08 && at(x + r * 0.7, y) < waterH && at(x - r * 0.7, y) < waterH;
    const s = place(rng, n, r, placed, avoid, sea) ?? place(rng, n, r, placed, avoid, () => true);
    if (!s) continue;
    placed.push(s);
    stampVolcano(height, n, s, seed + 31 * k, 0.9);
  }
  for (let k = 0; k < lf.mesa; k++) {
    const s = place(rng, n, n * rng.range(0.025, 0.05), placed, avoid, dry);
    if (!s) continue;
    placed.push(s);
    stampMesa(height, n, s, seed + 17 * k, rng.range(0.1, 0.15));
    // Buttes: eroded outliers beside the mesa.
    const buttes = rng.int(0, 2);
    for (let b = 0; b < buttes; b++) {
      const a = rng.range(0, Math.PI * 2);
      const d = s.r * rng.range(1.9, 2.6);
      const bs = { x: s.x + Math.cos(a) * d, y: s.y + Math.sin(a) * d, r: s.r * rng.range(0.22, 0.38) };
      if (bs.x < bs.r + 4 || bs.y < bs.r + 4 || bs.x > n - bs.r - 4 || bs.y > n - bs.r - 4 || !dry(bs.x, bs.y)) continue;
      if (Math.hypot(bs.x - avoid.x, bs.y - avoid.y) < bs.r + n * 0.06) continue;
      stampMesa(height, n, bs, seed + 17 * k + 5 + b, rng.range(0.08, 0.13));
    }
  }
  for (let k = 0; k < lf.crater; k++) {
    const s = place(rng, n, n * rng.range(0.018, 0.045), placed, avoid, dry);
    if (!s) continue;
    placed.push(s);
    stampCrater(height, n, s, seed + 23 * k);
  }
}

/** Dune fields: fine post-terrace relief on open ground (`open(i)`), so they never change biomes. */
export function applyDunes(
  height: Float32Array,
  n: number,
  count: number,
  seed: number,
  avoid: { x: number; y: number },
  open: (i: number) => boolean
): void {
  if (count <= 0) return;
  const rng = new Rng((seed ^ 0xd00e5) >>> 0);
  const wind = rng.range(0, Math.PI * 2);
  const wx = Math.cos(wind);
  const wy = Math.sin(wind);
  const placed: Stamp[] = [];
  for (let k = 0; k < count; k++) {
    const s = place(rng, n, n * rng.range(0.12, 0.2), placed, { x: -1e9, y: -1e9 }, (x, y) => open(Math.round(y) * n + Math.round(x)));
    if (!s) continue;
    placed.push(s);
    const lambda = rng.range(15, 22);
    forBox(n, s, reach(1, DUNE_EDGE), (i, d, ang) => {
      if (!open(i)) return;
      const q = d / (s.r * edge(ang, seed + k, DUNE_EDGE));
      const x = i % n;
      const y = (i / n) | 0;
      // Soft edge against ground that never gets dunes.
      let near = 0;
      for (let a = 0; a < 8; a++) {
        const sx = Math.round(x + Math.cos(a * (Math.PI / 4)) * DUNE_FADE);
        const sy = Math.round(y + Math.sin(a * (Math.PI / 4)) * DUNE_FADE);
        if (sx >= 0 && sy >= 0 && sx < n && sy < n && open(sy * n + sx)) near++;
      }
      const m = (1 - smooth(0.55, 1, q)) * smooth(2, 8, near);
      if (m <= 0) return;
      // Clear the pad area.
      const spawnFade = smooth(n * 0.05, n * 0.09, Math.hypot(x - avoid.x, y - avoid.y));
      const u = x * wx + y * wy;
      const v = -x * wy + y * wx;
      const phase = u / lambda + 1.4 * fbm(v * 0.012, u * 0.004, seed + 41, 2);
      const p = phase - Math.floor(phase);
      // Gentle windward slope, steeper slip face; smoothstep both sides so crests and troughs round off.
      const prof = p < DUNE_CREST ? smooth(0, DUNE_CREST, p) : 1 - smooth(DUNE_CREST, 1, p);
      const amp = DUNE_AMP_LO + (DUNE_AMP_HI - DUNE_AMP_LO) * fbm(x * 0.006, y * 0.006, seed + 43, 2);
      height[i] = height[i]! + amp * prof * m * spawnFade;
    });
  }
}
