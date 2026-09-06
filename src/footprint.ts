/**
 * Body footprints for hit / separation.
 * Default is a circle of `radius`; optional oriented rect (length along facing).
 */

import Phaser from "phaser";
import { specOf, type UnitKind } from "./roster";

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
function circumRadiusOf(kind: UnitKind): number {
  const box = specOf(kind).box;
  if (box) return Math.hypot(box.halfW, box.halfL);
  return specOf(kind).radius;
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
