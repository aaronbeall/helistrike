/**
 * Body footprints for hit / separation.
 * Default is a circle of `radius`; optional oriented rect (length along facing).
 */

import Phaser from "phaser";
import { specOf, type UnitKind } from "../sim/roster";

export type FootprintCircle = {
  shape: "circle";
  x: number;
  y: number;
  r: number;
};

export type FootprintRect = {
  shape: "rect";
  x: number;
  y: number;
  /** Half-extent along facing (length). */
  halfL: number;
  /** Half-extent perpendicular to facing (width). */
  halfW: number;
  angle: number;
};

export type Footprint = FootprintCircle | FootprintRect;

export type BodyPos = { kind: UnitKind; x: number; y: number; angle: number };

/** Circumradius for broadphase / FX (rect → hypot of half-extents). */
export function circumRadiusOf(kind: UnitKind): number {
  const box = specOf(kind).box;
  if (box) return Math.hypot(box.halfW, box.halfL);
  return specOf(kind).radius;
}

const _fp0c: FootprintCircle = { shape: "circle", x: 0, y: 0, r: 0 };
const _fp0r: FootprintRect = { shape: "rect", x: 0, y: 0, halfL: 0, halfW: 0, angle: 0 };
const _fp1c: FootprintCircle = { shape: "circle", x: 0, y: 0, r: 0 };
const _fp1r: FootprintRect = { shape: "rect", x: 0, y: 0, halfL: 0, halfW: 0, angle: 0 };

/** Hot-path footprint into shared scratch (`slot` 0|1). Do not store across calls. */
export function footprintInto(u: BodyPos, pad = 0, slot: 0 | 1 = 0): Footprint {
  const sp = specOf(u.kind);
  if (sp.box) {
    const out = slot ? _fp1r : _fp0r;
    out.x = u.x;
    out.y = u.y;
    out.halfL = sp.box.halfL + pad;
    out.halfW = sp.box.halfW + pad;
    out.angle = u.angle;
    return out;
  }
  const out = slot ? _fp1c : _fp0c;
  out.x = u.x;
  out.y = u.y;
  out.r = circumRadiusOf(u.kind) + pad;
  return out;
}

export function footprintOf(u: BodyPos, pad = 0): Footprint {
  const sp = specOf(u.kind);
  if (sp.box) {
    return {
      shape: "rect",
      x: u.x,
      y: u.y,
      halfL: sp.box.halfL + pad,
      halfW: sp.box.halfW + pad,
      angle: u.angle,
    };
  }
  return { shape: "circle", x: u.x, y: u.y, r: circumRadiusOf(u.kind) + pad };
}

/** Local coords: +along = facing, +side = right of facing. */
export function worldToLocal(
  px: number,
  py: number,
  x: number,
  y: number,
  angle: number
): { along: number; side: number } {
  const dx = px - x;
  const dy = py - y;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { along: dx * c + dy * s, side: -dx * s + dy * c };
}

export function localToWorld(
  along: number,
  side: number,
  x: number,
  y: number,
  angle: number
): { x: number; y: number } {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: x + along * c - side * s, y: y + along * s + side * c };
}

export function pointInFootprint(px: number, py: number, fp: Footprint): boolean {
  if (fp.shape === "circle") {
    return Math.hypot(px - fp.x, py - fp.y) <= fp.r;
  }
  const { along, side } = worldToLocal(px, py, fp.x, fp.y, fp.angle);
  return Math.abs(along) <= fp.halfL && Math.abs(side) <= fp.halfW;
}

/**
 * First hit of a 2D ray (ox,oy)+(dx,dy)*t against a footprint, for t in [0, range].
 * `dx,dy` need not be normalized in XY — t is in the same units as the 3D ray parameter
 * when (dx,dy,dz) is a unit 3D direction.
 */
export function rayHitFootprint(
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  range: number,
  fp: Footprint
): number | null {
  const span = rayHitFootprintInterval(ox, oy, dx, dy, range, fp);
  return span ? span.t0 : null;
}

/** Enter/exit parameter interval of a 2D ray against a footprint, clipped to [0, range]. */
export function rayHitFootprintInterval(
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  range: number,
  fp: Footprint
): { t0: number; t1: number } | null {
  if (range < 0) return null;

  if (fp.shape === "circle") {
    const a = dx * dx + dy * dy;
    const fx = ox - fp.x;
    const fy = oy - fp.y;
    const c0 = fx * fx + fy * fy - fp.r * fp.r;
    if (a < 1e-10) {
      if (c0 > 0) return null;
      return { t0: 0, t1: range };
    }
    const b = 2 * (fx * dx + fy * dy);
    const disc = b * b - 4 * a * c0;
    if (disc < 0) return null;
    const s = Math.sqrt(disc);
    const inv = 0.5 / a;
    let t0 = (-b - s) * inv;
    let t1 = (-b + s) * inv;
    if (t0 > t1) {
      const tmp = t0;
      t0 = t1;
      t1 = tmp;
    }
    t0 = Math.max(0, t0);
    t1 = Math.min(range, t1);
    if (t0 > t1) return null;
    return { t0, t1 };
  }

  const c = Math.cos(fp.angle);
  const s = Math.sin(fp.angle);
  const oA = (ox - fp.x) * c + (oy - fp.y) * s;
  const oS = -(ox - fp.x) * s + (oy - fp.y) * c;
  const dA = dx * c + dy * s;
  const dS = -dx * s + dy * c;

  let tMin = 0;
  let tMax = range;

  const slab = (o: number, d: number, lo: number, hi: number): boolean => {
    if (Math.abs(d) < 1e-10) {
      return o >= lo && o <= hi;
    }
    let t1 = (lo - o) / d;
    let t2 = (hi - o) / d;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    return tMin <= tMax;
  };

  if (!slab(oA, dA, -fp.halfL, fp.halfL)) return null;
  if (!slab(oS, dS, -fp.halfW, fp.halfW)) return null;
  if (tMin < 0) tMin = 0;
  if (tMax > range) tMax = range;
  if (tMin > tMax) return null;
  return { t0: tMin, t1: tMax };
}

/**
 * Uniform random point inside a footprint, inset by `inset` so a disk of that
 * radius stays inside the body (clamped; collapses to center if inset eats all).
 */
export function randomInFootprint(fp: Footprint, inset = 0): { x: number; y: number } {
  const pad = Math.max(0, inset);
  if (fp.shape === "circle") {
    const r = Math.max(0, fp.r - pad);
    if (r < 1e-4) return { x: fp.x, y: fp.y };
    const a = Math.random() * Math.PI * 2;
    const d = Math.sqrt(Math.random()) * r;
    return { x: fp.x + Math.cos(a) * d, y: fp.y + Math.sin(a) * d };
  }
  const halfL = Math.max(0, fp.halfL - pad);
  const halfW = Math.max(0, fp.halfW - pad);
  if (halfL < 1e-4 && halfW < 1e-4) return { x: fp.x, y: fp.y };
  const along = (Math.random() * 2 - 1) * halfL;
  const side = (Math.random() * 2 - 1) * halfW;
  return localToWorld(along, side, fp.x, fp.y, fp.angle);
}

/** Distance from point to footprint surface (0 if inside). */
export function distToFootprint(px: number, py: number, fp: Footprint): number {
  if (fp.shape === "circle") {
    return Math.max(0, Math.hypot(px - fp.x, py - fp.y) - fp.r);
  }
  const { along, side } = worldToLocal(px, py, fp.x, fp.y, fp.angle);
  const cx = Math.abs(along) - fp.halfL;
  const cy = Math.abs(side) - fp.halfW;
  if (cx <= 0 && cy <= 0) return 0;
  if (cx > 0 && cy > 0) return Math.hypot(cx, cy);
  return Math.max(cx, cy);
}

/** Closest point on footprint boundary/interior to (px,py). */
export function closestOnFootprint(px: number, py: number, fp: Footprint): { x: number; y: number } {
  if (fp.shape === "circle") {
    const dx = px - fp.x;
    const dy = py - fp.y;
    const d = Math.hypot(dx, dy);
    if (d < 1e-6) return { x: fp.x + fp.r, y: fp.y };
    if (d <= fp.r) return { x: px, y: py };
    return { x: fp.x + (dx / d) * fp.r, y: fp.y + (dy / d) * fp.r };
  }
  const { along, side } = worldToLocal(px, py, fp.x, fp.y, fp.angle);
  const ca = Math.max(-fp.halfL, Math.min(fp.halfL, along));
  const cs = Math.max(-fp.halfW, Math.min(fp.halfW, side));
  return localToWorld(ca, cs, fp.x, fp.y, fp.angle);
}

/**
 * Soft overlap between two footprints.
 * Returns outward normal from b → a and penetration depth when overlapping.
 */
export function footprintOverlap(
  a: Footprint,
  b: Footprint
): { hit: boolean; nx: number; ny: number; depth: number } {
  if (a.shape === "circle" && b.shape === "circle") {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const d = Math.hypot(dx, dy);
    const sep = a.r + b.r;
    if (d >= sep) return { hit: false, nx: 0, ny: 0, depth: 0 };
    if (d < 1e-4) return { hit: true, nx: 1, ny: 0, depth: sep };
    return { hit: true, nx: dx / d, ny: dy / d, depth: sep - d };
  }

  // Circle ↔ rect: closest point on rect to circle center.
  if (a.shape === "circle" && b.shape === "rect") {
    return circleVsRect(a, b);
  }
  if (a.shape === "rect" && b.shape === "circle") {
    const o = circleVsRect(b, a);
    return { hit: o.hit, nx: -o.nx, ny: -o.ny, depth: o.depth };
  }

  // Rect ↔ rect: SAT on facing/side axes.
  return rectVsRect(a as FootprintRect, b as FootprintRect);
}

function circleVsRect(
  c: FootprintCircle,
  r: FootprintRect
): { hit: boolean; nx: number; ny: number; depth: number } {
  const closest = closestOnFootprint(c.x, c.y, r);
  const dx = c.x - closest.x;
  const dy = c.y - closest.y;
  const d = Math.hypot(dx, dy);
  const inside = pointInFootprint(c.x, c.y, r);
  if (!inside && d >= c.r) return { hit: false, nx: 0, ny: 0, depth: 0 };
  if (inside) {
    // Push out along nearest face.
    const { along, side } = worldToLocal(c.x, c.y, r.x, r.y, r.angle);
    const dl = r.halfL - Math.abs(along);
    const dw = r.halfW - Math.abs(side);
    const ca = Math.cos(r.angle);
    const sa = Math.sin(r.angle);
    if (dl < dw) {
      const sign = along >= 0 ? 1 : -1;
      return { hit: true, nx: ca * sign, ny: sa * sign, depth: dl + c.r };
    }
    const sign = side >= 0 ? 1 : -1;
    // side axis = right = (-sin, cos)
    return { hit: true, nx: -sa * sign, ny: ca * sign, depth: dw + c.r };
  }
  return { hit: true, nx: dx / d, ny: dy / d, depth: c.r - d };
}

function rectVsRect(
  a: FootprintRect,
  b: FootprintRect
): { hit: boolean; nx: number; ny: number; depth: number } {
  const axes = [
    { x: Math.cos(a.angle), y: Math.sin(a.angle) },
    { x: -Math.sin(a.angle), y: Math.cos(a.angle) },
    { x: Math.cos(b.angle), y: Math.sin(b.angle) },
    { x: -Math.sin(b.angle), y: Math.cos(b.angle) },
  ];
  let minDepth = Infinity;
  let bestNx = 1;
  let bestNy = 0;
  for (const axis of axes) {
    const pa = projectRect(a, axis.x, axis.y);
    const pb = projectRect(b, axis.x, axis.y);
    const overlap = Math.min(pa.max, pb.max) - Math.max(pa.min, pb.min);
    if (overlap <= 0) return { hit: false, nx: 0, ny: 0, depth: 0 };
    if (overlap < minDepth) {
      minDepth = overlap;
      // Normal from b toward a along this axis.
      const acx = a.x - b.x;
      const acy = a.y - b.y;
      const sign = acx * axis.x + acy * axis.y >= 0 ? 1 : -1;
      bestNx = axis.x * sign;
      bestNy = axis.y * sign;
    }
  }
  return { hit: true, nx: bestNx, ny: bestNy, depth: minDepth };
}

function projectRect(
  r: FootprintRect,
  ax: number,
  ay: number
): { min: number; max: number } {
  const c = Math.cos(r.angle);
  const s = Math.sin(r.angle);
  const ex = r.halfL * c;
  const ey = r.halfL * s;
  const fx = -r.halfW * s;
  const fy = r.halfW * c;
  let min = Infinity;
  let max = -Infinity;
  for (const [ox, oy] of [
    [ex + fx, ey + fy],
    [ex - fx, ey - fy],
    [-ex + fx, -ey + fy],
    [-ex - fx, -ey - fy],
  ] as const) {
    const p = (r.x + ox) * ax + (r.y + oy) * ay;
    min = Math.min(min, p);
    max = Math.max(max, p);
  }
  return { min, max };
}

/** Stroke footprint outline into a Phaser graphics (world XY). */
export function strokeFootprint(
  g: Phaser.GameObjects.Graphics,
  fp: Footprint,
  color = 0x5ec8ff,
  alpha = 0.9
): void {
  g.lineStyle(1.25, color, alpha);
  if (fp.shape === "circle") {
    g.strokeCircle(fp.x, fp.y, fp.r);
    return;
  }
  const corners = [
    localToWorld(fp.halfL, fp.halfW, fp.x, fp.y, fp.angle),
    localToWorld(fp.halfL, -fp.halfW, fp.x, fp.y, fp.angle),
    localToWorld(-fp.halfL, -fp.halfW, fp.x, fp.y, fp.angle),
    localToWorld(-fp.halfL, fp.halfW, fp.x, fp.y, fp.angle),
  ];
  g.beginPath();
  g.moveTo(corners[0]!.x, corners[0]!.y);
  for (let i = 1; i < 4; i++) g.lineTo(corners[i]!.x, corners[i]!.y);
  g.closePath();
  g.strokePath();
}
