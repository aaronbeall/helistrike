import Phaser from "phaser";
import { range } from "../util/rng";
import { spritePivot } from "../art/sprites";
import { groundSlope, type WorldData } from "../worldgen/world";

/**
 * Soft-cap crater stamp scale so 88px scorches don't go fuzzy on huge blasts.
 * Approaches `hard` asymptotically past `soft`.
 */
export function softCapBlastCraterScale(raw: number, soft = 1.28, hard = 2.05, k = 1.7): number {
  if (!(raw > soft)) return Math.max(0.04, raw);
  return soft + (hard - soft) * (1 - Math.exp(-(raw - soft) / k));
}

export function debrisStampOrigin(key: string): { x: number; y: number } {
  return spritePivot(key);
}



/** Flame particle size multiplier: unchanged up to the knee, compressed above (big flames stop becoming blobs). */
export function flameSizeCap(v: number, knee = 0.55, slope = 0.15, hard = 0.8): number {
  return v <= knee ? v : Math.min(hard, knee + (v - knee) * slope);
}

/** Emit-rate boost for a capped flame: the size it lost comes back as more (area-spread) particles. */
export function flameDensityMul(v: number): number {
  return v > 0 ? Math.max(1, v / flameSizeCap(v)) : 1;
}

/** Particle life multiplier — mid (~1) unchanged; large debris leave a long tail. */
export function debrisTrailLifeMul(size: number): number {
  const over = Math.max(0, size - 1.05);
  // Linear near mid stays mild; quadratic stretches big radar-scale trails further.
  return 1 + over * 0.4 + over * over * 1.65;
}

/** World-space decal scale with optional travel-grade squash. */
export function wreckDrawScale(world: WorldData, 
  x: number,
  y: number,
  _z: number,
  scale = 1,
  slope = false,
  angle = 0
): { sx: number; sy: number } {
  if (!slope) return { sx: scale, sy: scale };
  const sl = groundSlope(world, x, y);
  const grade = Phaser.Math.Clamp(sl.dx * Math.cos(angle) + sl.dy * Math.sin(angle), -0.4, 0.4);
  return {
    sx: scale * (1 + Math.abs(grade) * 0.05),
    sy: scale * (1 - grade * 0.12),
  };
}

/** Track print darkness: soft/hard ground patches by world position, plus per-print jitter. */
export function trackPrintAlpha(base: number, x: number, y: number): number {
  const patch = 0.5 + 0.5 * Math.sin(x * 0.011 + y * 0.017) * Math.sin(x * 0.023 - y * 0.013 + 1.3);
  // Only lightens: the darkest print matches the old uniform `base`.
  return Phaser.Math.Clamp(base * Phaser.Math.Linear(0.25, 1, patch) * range(0.65, 1), 0.06, base);
}
