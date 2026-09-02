/** Laplace scale on [0, 1]; smaller → tighter around the midpoint. */
const RANGE_B = 0.26;
const RANGE_ALPHA = Math.exp(-0.5 / RANGE_B);
const RANGE_Z = 1 - RANGE_ALPHA;
/** Sampled support vs the passed [min, max] core band (peaked at the midpoint). */
const RANGE_WIDEN = 1.85;

/**
 * Sample around the midpoint of `[min, max]` with a truncated Laplace density.
 * The passed bounds are the core band; actual samples can reach about
 * `RANGE_WIDEN` times farther from the center so outliers stay rare but stronger.
 */
export function range(min: number, max: number): number {
  if (min === max) return min;
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  const mid = (lo + hi) * 0.5;
  const half = (hi - lo) * 0.5 * RANGE_WIDEN;
  const a = mid - half;
  const b = mid + half;
  const u = Math.random();
  const t =
    u < 0.5
      ? 0.5 + RANGE_B * Math.log(RANGE_ALPHA + 2 * RANGE_Z * u)
      : 0.5 - RANGE_B * Math.log(RANGE_ALPHA + 2 * RANGE_Z * (1 - u));
  const v = a + (b - a) * t;
  return lo >= 0 ? Math.max(0, v) : v;
}

export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 1;
  }
  next(): number {
    this.s = (1664525 * this.s + 1013904223) >>> 0;
    return this.s / 4294967296;
  }
  range(a: number, b: number): number {
    return a + this.next() * (b - a);
  }
  int(a: number, b: number): number {
    return Math.floor(this.range(a, b + 1));
  }
  pick<T>(arr: T[]): T {
    return arr[Math.floor(this.next() * arr.length)]!;
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
}
