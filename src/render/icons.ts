import Phaser from "phaser";
import { fillCircleFast, fillRoundedRectFast, lineQuadFast, strokeCircleFast, strokeRoundedRectFast } from "./fastShapes";

type Gfx = Phaser.GameObjects.Graphics;

/** Named vector icons drawn by `drawIcon`. */
export type IconName = "star" | "flag" | "rotor" | "tire" | "bolt" | "blind" | "check" | "cross" | "dash" | "clock" | "crosshair";

/** Eye outline segments for "blind". */
const EYE_SEGS = 12;

/** Vector icon centered on (cx, cy), about `size` px across; triangles only (allocation-free, safe every frame). */
export function drawIcon(g: Gfx, name: IconName, cx: number, cy: number, color: number, size = 10, alpha = 1): void {
  const k = size / 10;
  const w = Math.max(1, 1.5 * k);
  const thin = Math.max(1, k);
  g.fillStyle(color, alpha);
  switch (name) {
    case "star": {
      for (let i = 0; i < 10; i++) {
        const a0 = -Math.PI / 2 + (i * Math.PI) / 5;
        const a1 = a0 + Math.PI / 5;
        const r0 = (i % 2 ? 2.2 : 5) * k;
        const r1 = (i % 2 ? 5 : 2.2) * k;
        g.fillTriangle(cx, cy, cx + Math.cos(a0) * r0, cy + Math.sin(a0) * r0, cx + Math.cos(a1) * r1, cy + Math.sin(a1) * r1);
      }
      break;
    }
    case "flag":
      seg(g, cx, cy, k, -3, -5, -3, 5, thin);
      g.fillTriangle(cx - 2.5 * k, cy - 5 * k, cx + 4.5 * k, cy - 2.5 * k, cx - 2.5 * k, cy);
      break;
    case "rotor":
      for (let i = 0; i < 3; i++) {
        const a = -Math.PI / 2 + (i * Math.PI * 2) / 3;
        seg(g, cx, cy, k, 0, 0, Math.cos(a) * 5, Math.sin(a) * 5, w);
      }
      fillCircleFast(g, cx, cy, 1.6 * k);
      break;
    case "tire":
      strokeCircleFast(g, cx, cy, 4.2 * k, w, color, alpha);
      fillCircleFast(g, cx, cy, 1.6 * k);
      break;
    case "bolt":
      // Concave outline split into two quads.
      tri(g, cx, cy, k, 1.5, -5, -3, 1, -0.2, 1);
      tri(g, cx, cy, k, 1.5, -5, -0.2, 1, 0.2, -1);
      tri(g, cx, cy, k, 0.2, -1, -0.2, 1, -1.5, 5);
      tri(g, cx, cy, k, 0.2, -1, -1.5, 5, 3, -1);
      break;
    case "blind":
      for (let i = 0; i < EYE_SEGS; i++) {
        const a0 = (i / EYE_SEGS) * Math.PI * 2;
        const a1 = ((i + 1) / EYE_SEGS) * Math.PI * 2;
        seg(g, cx, cy, k, Math.cos(a0) * 5, Math.sin(a0) * 3, Math.cos(a1) * 5, Math.sin(a1) * 3, thin);
      }
      fillCircleFast(g, cx, cy, 1.4 * k);
      seg(g, cx, cy, k, -4.5, 4, 4.5, -4, w);
      break;
    case "check":
      seg(g, cx, cy, k, -4, 0, -1.2, 3, w);
      seg(g, cx, cy, k, -1.2, 3, 4, -3.5, w);
      break;
    case "cross":
      seg(g, cx, cy, k, -3.5, -3.5, 3.5, 3.5, w);
      seg(g, cx, cy, k, -3.5, 3.5, 3.5, -3.5, w);
      break;
    case "dash":
      seg(g, cx, cy, k, -4, 0, 4, 0, w);
      break;
    case "clock":
      strokeCircleFast(g, cx, cy, 4.5 * k, thin, color, alpha);
      seg(g, cx, cy, k, 0, 0, 0, -3, thin);
      seg(g, cx, cy, k, 0, 0, 2.2, 1, thin);
      break;
    case "crosshair":
      strokeCircleFast(g, cx, cy, 3.5 * k, thin, color, alpha);
      seg(g, cx, cy, k, -5.5, 0, -2, 0, thin);
      seg(g, cx, cy, k, 2, 0, 5.5, 0, thin);
      seg(g, cx, cy, k, 0, -5.5, 0, -2, thin);
      seg(g, cx, cy, k, 0, 2, 0, 5.5, thin);
      break;
  }
}

/** Line in icon units (10 = icon size), current fill style. */
function seg(g: Gfx, cx: number, cy: number, k: number, x1: number, y1: number, x2: number, y2: number, width: number): void {
  lineQuadFast(g, cx + x1 * k, cy + y1 * k, cx + x2 * k, cy + y2 * k, width);
}

/** Triangle in icon units, current fill style. */
function tri(g: Gfx, cx: number, cy: number, k: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): void {
  g.fillTriangle(cx + x1 * k, cy + y1 * k, cx + x2 * k, cy + y2 * k, cx + x3 * k, cy + y3 * k);
}

/** Battery icon width (body + nub) at scale 1. */
export const BATTERY_ICON_W = 26.4;

/** Segmented battery icon (remote overhead + HUD pool); x/y = top-left, width BATTERY_ICON_W × zs. */
export function drawBatteryIcon(time: Phaser.Time.Clock, g: Gfx, x: number, y: number, frac: number, zs: number): void {
  const segs = 4;
  const bodyW = 24 * zs;
  const bodyH = 8 * zs;
  const nubW = 2.4 * zs;
  const nubH = 4.2 * zs;
  const pad = 1.5 * zs;
  const gap = 1.15 * zs;
  const rBody = 1.5 * zs;
  const innerW = bodyW - pad * 2;
  const innerH = bodyH - pad * 2;
  const segW = (innerW - gap * (segs - 1)) / segs;
  const ratio = Phaser.Math.Clamp(frac, 0, 1);
  const filled = ratio > 0.001 ? Math.min(segs, Math.max(1, Math.ceil(ratio * segs - 1e-6))) : 0;
  const low = filled <= 1;
  const col = low ? 0xff2a18 : filled >= 3 ? 0x5caa3a : 0xe8c44a;
  const pulse = low ? 0.38 + 0.62 * (0.5 + 0.5 * Math.sin(time.now * 0.022)) : 1;
  g.fillStyle(0x10100c, 0.72 * pulse);
  fillRoundedRectFast(g, x, y, bodyW, bodyH, rBody);
  g.lineStyle(Math.max(1, 1.15 * zs), low ? col : 0xd8d8cc, 0.92 * pulse);
  strokeRoundedRectFast(g, x, y, bodyW, bodyH, rBody, Math.max(1, 1.15 * zs), low ? col : 0xd8d8cc, 0.92 * pulse);
  g.fillStyle(low ? col : 0xd8d8cc, 0.92 * pulse);
  fillRoundedRectFast(g, x + bodyW - 0.4 * zs, y + (bodyH - nubH) / 2, nubW, nubH, 0.7 * zs);
  for (let i = 0; i < segs; i++) {
    const sx = x + pad + i * (segW + gap);
    const sy = y + pad;
    g.fillStyle(0x080806, 0.85);
    g.fillRect(sx, sy, segW, innerH);
    if (i >= filled) continue;
    g.fillStyle(col, pulse);
    g.fillRect(sx, sy, segW, innerH);
  }
}
