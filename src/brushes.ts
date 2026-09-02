import { fbm } from "./noise";

export type BrushId = "plateau" | "peak" | "ridge";

export interface HeightBrush {
  id: BrushId;
  name: string;
  mask: Float32Array;
  w: number;
  h: number;
  canvas: HTMLCanvasElement | null;
}

export const BRUSH_RES = 192;

export const HEIGHT_BRUSHES: HeightBrush[] = [
  { id: "plateau", name: "PLATEAU", mask: new Float32Array(1), w: 1, h: 1, canvas: null },
  { id: "peak", name: "PEAK", mask: new Float32Array(1), w: 1, h: 1, canvas: null },
  { id: "ridge", name: "RIDGE", mask: new Float32Array(1), w: 1, h: 1, canvas: null },
];

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function smooth(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / Math.max(1e-6, e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

function maskToCanvas(mask: Float32Array, n: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = n;
  c.height = n;
  const g = c.getContext("2d")!;
  const img = g.createImageData(n, n);
  const d = img.data;
  for (let i = 0; i < n * n; i++) {
    const a = Math.round(clamp(mask[i]!, 0, 1) * 255);
    const o = i * 4;
    d[o] = 255;
    d[o + 1] = 255;
    d[o + 2] = 255;
    d[o + 3] = a;
  }
  g.putImageData(img, 0, 0);
  return c;
}

function genPeak(n: number): Float32Array {
  const out = new Float32Array(n * n);
  const seed = 2207;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const nx = x / (n - 1);
      const ny = y / (n - 1);
      const dx = nx - 0.5;
      const dy = ny - 0.5;
      const r = Math.hypot(dx, dy) * 2;
      let h = fbm(nx * 6.2, ny * 6.2, seed, 6, 2.05, 0.52);
      const ridge = 1 - Math.abs(fbm(nx * 3.1 + 20, ny * 3.1, seed + 9, 4) * 2 - 1);
      const cone = Math.pow(Math.max(0, 1 - r), 2.65);
      const spike = Math.pow(Math.max(0, 1 - r * 3.8), 5.2);
      h = (h * 0.38 + ridge * 0.22) * cone;
      h += spike * 0.85;
      const grit = (fbm(nx * 18, ny * 18, seed + 21, 3) - 0.5) * 0.06;
      h += grit * cone;
      const env = 1 - smooth(0.82, 1.05, r);
      out[y * n + x] = clamp(h * env, 0, 1);
    }
  }
  return out;
}

function genPlateau(n: number): Float32Array {
  const out = new Float32Array(n * n);
  const seed = 1103;
  const wobble = 0.62;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const nx = x / (n - 1);
      const ny = y / (n - 1);
      const dx = nx - 0.5;
      const dy = ny - 0.5;
      const r = Math.hypot(dx, dy) * 2;
      const wob = fbm(nx * 3.4, ny * 3.4, seed + 41, 4);
      const scallop = fbm(nx * 9.2 + 8, ny * 9.2, seed + 53, 3);
      const rad = 0.72 * (1 + (wob * 2 - 1) * wobble * 0.42 + (scallop - 0.5) * 0.22);
      const inner = rad * 0.52;
      const outer = rad;
      let v = 0;
      if (r <= inner) {
        const n1 = fbm(nx * 5.4, ny * 5.4, seed + 17, 4);
        v = 0.9 + (n1 - 0.5) * 0.08;
      } else if (r < outer) {
        let t = (r - inner) / Math.max(1e-6, outer - inner);
        t = clamp(t + (wob - 0.5) * 0.18, 0, 1);
        const s = t * t * (3 - 2 * t);
        const n2 = fbm(nx * 14, ny * 14, seed + 77, 3);
        v = (1 - s) * 0.92;
        v += (n2 - 0.5) * 0.038 * (1 - Math.abs(t * 2 - 1));
      }
      const env = 1 - smooth(0.92, 1.12, r);
      out[y * n + x] = clamp(v * env, 0, 1);
    }
  }
  return out;
}

function genRidge(n: number): Float32Array {
  const out = new Float32Array(n * n);
  const seed = 3319;
  const wobble = 0.62;
  for (let y = 0; y < n; y++) {
    const ny = y / (n - 1);
    const cx =
      0.5 +
      (fbm(0.22, ny * 3.4, seed, 4) - 0.5) * 0.5 +
      (fbm(1.4, ny * 9.1, seed + 6, 3) - 0.5) * 0.12;
    const flow = 0.35 + fbm(0.8, ny * 2.6, seed + 11, 3) * 0.55;
    const half = Math.max(0.09, 0.07 + Math.sqrt(flow) * 0.08);
    for (let x = 0; x < n; x++) {
      const nx = x / (n - 1);
      const dx = nx - 0.5;
      const dy = ny - 0.5;
      const r = Math.hypot(dx, dy) * 2;
      const wob = fbm(nx * 6.5, ny * 6.5, seed + 41, 4);
      const scallop = fbm(nx * 17 + 8, ny * 17, seed + 53, 3);
      const localW = half * (1 + (wob * 2 - 1) * wobble + (scallop - 0.5) * 0.4);
      const d = Math.abs(nx - cx);
      let v = 0;
      if (d < localW) {
        let t = d / Math.max(localW, 1e-6);
        t = clamp(t, 0, 1);
        const s = 1 - t * t * (3 - 2 * t);
        const n2 = fbm(nx * 16, ny * 16, seed + 77, 3);
        v = Math.pow(s, 1.15);
        v += (n2 - 0.5) * 0.038 * (1 - Math.abs(t * 2 - 1));
      }
      const env = 1 - smooth(0.9, 1.12, r);
      const along = smooth(-0.02, 0.1, ny) * (1 - smooth(0.9, 1.02, ny));
      out[y * n + x] = clamp(v * env * along, 0, 1);
    }
  }
  return out;
}

export function bakeHeightBrushes(): HeightBrush[] {
  const gens: Record<BrushId, () => Float32Array> = {
    plateau: () => genPlateau(BRUSH_RES),
    peak: () => genPeak(BRUSH_RES),
    ridge: () => genRidge(BRUSH_RES),
  };
  for (const b of HEIGHT_BRUSHES) {
    b.mask = gens[b.id]();
    b.w = BRUSH_RES;
    b.h = BRUSH_RES;
    b.canvas = maskToCanvas(b.mask, BRUSH_RES);
  }
  return HEIGHT_BRUSHES;
}
