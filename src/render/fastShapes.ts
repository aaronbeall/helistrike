/**
 * Allocation-free Graphics shapes: triangles + rects only (Phaser's arcs allocate ~100 points and earcut every frame).
 * Fills use the current fill style; strokes take width + color and leave the fill style set to it.
 */
import type Phaser from "phaser";

type Gfx = Phaser.GameObjects.Graphics;

/** Max chord error (px) when approximating a circle with straight segments. */
const CHORD_ERR = 0.25;
const MIN_SEGS = 8;
const MAX_SEGS = 64;
const TAU = Math.PI * 2;

/** Segments for a full circle of radius `r`. */
export function circleSegments(r: number): number {
  if (r <= CHORD_ERR * 2) return MIN_SEGS;
  const n = Math.ceil(Math.PI / Math.acos(1 - CHORD_ERR / r));
  return Math.max(MIN_SEGS, Math.min(MAX_SEGS, n));
}

function arcSegments(r: number, sweep: number): number {
  return Math.max(1, Math.ceil((circleSegments(r) * Math.abs(sweep)) / TAU));
}

/** Filled circle (current fill style). */
export function fillCircleFast(g: Gfx, x: number, y: number, r: number): void {
  fillArcFast(g, x, y, r, 0, TAU);
}

/** Filled pie slice from `a0` to `a1` (radians, current fill style). */
export function fillArcFast(g: Gfx, x: number, y: number, r: number, a0: number, a1: number): void {
  if (r <= 0) return;
  const n = arcSegments(r, a1 - a0);
  const step = (a1 - a0) / n;
  let px = x + Math.cos(a0) * r;
  let py = y + Math.sin(a0) * r;
  for (let i = 1; i <= n; i++) {
    const a = a0 + step * i;
    const qx = x + Math.cos(a) * r;
    const qy = y + Math.sin(a) * r;
    g.fillTriangle(x, y, px, py, qx, qy);
    px = qx;
    py = qy;
  }
}

/** Stroked arc from `a0` to `a1`, centered on radius `r`. */
export function strokeArcFast(
  g: Gfx,
  x: number,
  y: number,
  r: number,
  a0: number,
  a1: number,
  width: number,
  color: number,
  alpha = 1
): void {
  if (r <= 0 || width <= 0) return;
  g.fillStyle(color, alpha);
  const ri = Math.max(0, r - width / 2);
  const ro = r + width / 2;
  const n = arcSegments(ro, a1 - a0);
  const step = (a1 - a0) / n;
  let c = Math.cos(a0);
  let s = Math.sin(a0);
  for (let i = 1; i <= n; i++) {
    const a = a0 + step * i;
    const c2 = Math.cos(a);
    const s2 = Math.sin(a);
    const ix0 = x + c * ri;
    const iy0 = y + s * ri;
    const ox1 = x + c2 * ro;
    const oy1 = y + s2 * ro;
    g.fillTriangle(ix0, iy0, x + c * ro, y + s * ro, ox1, oy1);
    g.fillTriangle(ix0, iy0, ox1, oy1, x + c2 * ri, y + s2 * ri);
    c = c2;
    s = s2;
  }
}

/** Stroked circle, centered on radius `r`. */
export function strokeCircleFast(g: Gfx, x: number, y: number, r: number, width: number, color: number, alpha = 1): void {
  strokeArcFast(g, x, y, r, 0, TAU, width, color, alpha);
}

/** Straight line as a quad (`width` across, flat ends). */
export function lineFast(g: Gfx, x1: number, y1: number, x2: number, y2: number, width: number, color: number, alpha = 1): void {
  if (width <= 0 || (x1 === x2 && y1 === y2)) return;
  g.fillStyle(color, alpha);
  lineQuadFast(g, x1, y1, x2, y2, width);
}

/** `lineFast` in the current fill style (callers batching many segments of one style). */
export function lineQuadFast(g: Gfx, x1: number, y1: number, x2: number, y2: number, width: number): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len <= 0 || width <= 0) return;
  const nx = (-dy / len) * (width / 2);
  const ny = (dx / len) * (width / 2);
  g.fillTriangle(x1 + nx, y1 + ny, x2 + nx, y2 + ny, x2 - nx, y2 - ny);
  g.fillTriangle(x1 + nx, y1 + ny, x2 - nx, y2 - ny, x1 - nx, y1 - ny);
}

/** Filled rounded rect (current fill style). */
export function fillRoundedRectFast(g: Gfx, x: number, y: number, w: number, h: number, r: number): void {
  if (w <= 0 || h <= 0) return;
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  if (rr <= 0) {
    g.fillRect(x, y, w, h);
    return;
  }
  g.fillRect(x + rr, y, w - rr * 2, h);
  g.fillRect(x, y + rr, rr, h - rr * 2);
  g.fillRect(x + w - rr, y + rr, rr, h - rr * 2);
  const q = Math.PI / 2;
  fillArcFast(g, x + rr, y + rr, rr, Math.PI, Math.PI + q);
  fillArcFast(g, x + w - rr, y + rr, rr, -q, 0);
  fillArcFast(g, x + w - rr, y + h - rr, rr, 0, q);
  fillArcFast(g, x + rr, y + h - rr, rr, q, Math.PI);
}

/** Stroked rounded rect, the stroke centered on the outline. */
export function strokeRoundedRectFast(
  g: Gfx,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  width: number,
  color: number,
  alpha = 1
): void {
  if (w <= 0 || h <= 0 || width <= 0) return;
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  const hw = width / 2;
  g.fillStyle(color, alpha);
  g.fillRect(x + rr, y - hw, w - rr * 2, width);
  g.fillRect(x + rr, y + h - hw, w - rr * 2, width);
  g.fillRect(x - hw, y + rr, width, h - rr * 2);
  g.fillRect(x + w - hw, y + rr, width, h - rr * 2);
  if (rr <= 0) {
    g.fillRect(x - hw, y - hw, width, width);
    g.fillRect(x + w - hw, y - hw, width, width);
    g.fillRect(x + w - hw, y + h - hw, width, width);
    g.fillRect(x - hw, y + h - hw, width, width);
    return;
  }
  const q = Math.PI / 2;
  strokeArcFast(g, x + rr, y + rr, rr, Math.PI, Math.PI + q, width, color, alpha);
  strokeArcFast(g, x + w - rr, y + rr, rr, -q, 0, width, color, alpha);
  strokeArcFast(g, x + w - rr, y + h - rr, rr, 0, q, width, color, alpha);
  strokeArcFast(g, x + rr, y + h - rr, rr, q, Math.PI, width, color, alpha);
}
