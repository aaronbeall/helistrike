/** Small 3D vector helpers. */
import Phaser from "phaser";

export function biasedDir(
  bx: number,
  by: number,
  bz: number,
  tight: number,
  reverse: boolean
): { x: number; y: number; z: number } {
  const len = Math.hypot(bx, by, bz) || 1;
  const sx = (reverse ? -bx : bx) / len;
  const sy = (reverse ? -by : by) / len;
  const sz = (reverse ? -bz : bz) / len;
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(Math.random() * 2 - 1);
  const rx = Math.sin(phi) * Math.cos(theta);
  const ry = Math.sin(phi) * Math.sin(theta);
  const rz = Math.cos(phi);
  const t = Phaser.Math.Clamp(tight, 0, 1);
  const x = sx * t + rx * (1 - t);
  const y = sy * t + ry * (1 - t);
  const z = sz * t + rz * (1 - t);
  const n = Math.hypot(x, y, z) || 1;
  return { x: x / n, y: y / n, z: z / n };
}

/**
 * Sample a unit direction inside a cone of half-angle `half` about (bx,by,bz).
 * Density pdf ∝ exp(k · align) truncated to the cone; `edge` is that CDF value
 * (0 = rim, 1 = forward) so callers can share the same falloff for speed.
 */
export function coneDir(
  bx: number,
  by: number,
  bz: number,
  half: number,
  k = 4
): { x: number; y: number; z: number; align: number; edge: number } {
  const len = Math.hypot(bx, by, bz) || 1;
  const sx = bx / len;
  const sy = by / len;
  const sz = bz / len;
  const cosMin = Math.cos(Phaser.Math.Clamp(half, 1e-3, Math.PI));
  const kk = Math.max(1e-4, k);
  const edge = Math.random();
  const align = Math.log(
    Math.exp(kk * cosMin) + edge * (Math.exp(kk) - Math.exp(kk * cosMin))
  ) / kk;
  const sinT = Math.sqrt(Math.max(0, 1 - align * align));
  const azi = Math.random() * Math.PI * 2;
  let ax = 0;
  let ay = 1;
  let az = 0;
  if (Math.abs(sy) > 0.9) {
    ax = 1;
    ay = 0;
  }
  let px = ay * sz - az * sy;
  let py = az * sx - ax * sz;
  let pz = ax * sy - ay * sx;
  const pn = Math.hypot(px, py, pz) || 1;
  px /= pn;
  py /= pn;
  pz /= pn;
  const qx = sy * pz - sz * py;
  const qy = sz * px - sx * pz;
  const qz = sx * py - sy * px;
  const ca = Math.cos(azi);
  const sa = Math.sin(azi);
  const x = sx * align + (px * ca + qx * sa) * sinT;
  const y = sy * align + (py * ca + qy * sa) * sinT;
  const z = sz * align + (pz * ca + qz * sa) * sinT;
  const n = Math.hypot(x, y, z) || 1;
  return { x: x / n, y: y / n, z: z / n, align, edge };
}

/** Sample a unit direction with pdf ∝ exp(k · cosθ) about (bx,by,bz). align = cosθ ∈ [-1,1]. */
export function expBiasDir(
  bx: number,
  by: number,
  bz: number,
  k: number
): { x: number; y: number; z: number; align: number } {
  const len = Math.hypot(bx, by, bz) || 1;
  const sx = bx / len;
  const sy = by / len;
  const sz = bz / len;
  const u = Math.random();
  const kk = Math.max(1e-4, k);
  const align = Math.log(Math.exp(-kk) + u * (Math.exp(kk) - Math.exp(-kk))) / kk;
  const sinT = Math.sqrt(Math.max(0, 1 - align * align));
  const azi = Math.random() * Math.PI * 2;
  // Orthonormal basis with s as the polar axis.
  let ax = 0;
  let ay = 1;
  let az = 0;
  if (Math.abs(sy) > 0.9) {
    ax = 1;
    ay = 0;
  }
  let px = ay * sz - az * sy;
  let py = az * sx - ax * sz;
  let pz = ax * sy - ay * sx;
  const pn = Math.hypot(px, py, pz) || 1;
  px /= pn;
  py /= pn;
  pz /= pn;
  const qx = sy * pz - sz * py;
  const qy = sz * px - sx * pz;
  const qz = sx * py - sy * px;
  const ca = Math.cos(azi);
  const sa = Math.sin(azi);
  const x = sx * align + (px * ca + qx * sa) * sinT;
  const y = sy * align + (py * ca + qy * sa) * sinT;
  const z = sz * align + (pz * ca + qz * sa) * sinT;
  const n = Math.hypot(x, y, z) || 1;
  return { x: x / n, y: y / n, z: z / n, align };
}

export function norm3(x: number, y: number, z: number): { x: number; y: number; z: number } {
  const n = Math.hypot(x, y, z);
  if (n < 1e-6) return { x: 1, y: 0, z: 0 };
  return { x: x / n, y: y / n, z: z / n };
}

export function projectAlong(x: number, y: number, ang: number, tx: number, ty: number): number {
  const dx = tx - x;
  const dy = ty - y;
  return Math.max(0, dx * Math.cos(ang) + dy * Math.sin(ang));
}

/**
 * Catmull-Rom smoothing of `n` points into `outX` / `outY` (no allocation); returns the count. Each segment gets
 * up to `steps` samples, fewer when shorter than `steps * minSegLen`.
 */
export function smoothPolylineInto(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  n: number,
  outX: Float32Array,
  outY: Float32Array,
  steps = 4,
  minSegLen = 0
): number {
  if (n < 3) {
    for (let i = 0; i < n; i++) {
      outX[i] = xs[i]!;
      outY[i] = ys[i]!;
    }
    return n;
  }
  outX[0] = xs[0]!;
  outY[0] = ys[0]!;
  let m = 1;
  for (let i = 0; i < n - 1; i++) {
    const a = i > 0 ? i - 1 : i;
    const d = i + 2 < n ? i + 2 : i + 1;
    const len = minSegLen > 0 ? Math.hypot(xs[i + 1]! - xs[i]!, ys[i + 1]! - ys[i]!) : 0;
    const k = minSegLen > 0 ? Math.max(1, Math.min(steps, Math.ceil(len / minSegLen))) : steps;
    for (let s = 1; s <= k; s++) {
      const t = s / k;
      outX[m] = catmull(xs[a]!, xs[i]!, xs[i + 1]!, xs[d]!, t);
      outY[m] = catmull(ys[a]!, ys[i]!, ys[i + 1]!, ys[d]!, t);
      m++;
    }
  }
  return m;
}

function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}
