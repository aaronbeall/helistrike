import { MAP_AIR_SOFT } from "../../../sim/craft";
import type { Unit } from "../../../sim/combat";
import { isGroundVehicle, specOf } from "../../../sim/roster";
import { SlotList, SpatialGrid } from "../../../sim/spatialGrid";
import { circumRadiusOf } from "../../../render/footprint";
import { WORLD } from "../../../worldgen/world";
import type { MissionScene } from "../../missionScene";

/** Unit categories in the index: ground solids (as `unitSim` steers around them) and everything else. */
export const SP_STATIC = 1;
export const SP_VEHICLE = 2;
export const SP_INFANTRY = 4;
export const SP_OTHER = 8;
export const SP_SOLID = SP_STATIC | SP_VEHICLE | SP_INFANTRY;
export const SP_ANY = SP_SOLID | SP_OTHER;

export const SPATIAL_CELL = 128;
/** Drift a mover may make between index updates (another unit nudging it mid-frame). */
const MOVER_SLACK = 24;
/** Float rounding at the reach boundary. */
const STATIC_SLACK = 0.01;

/** Category of a live unit right now (ground-solid rules match `unitSim` steering). */
export function spatialMask(u: Unit): number {
  if (u.pinId != null) return SP_OTHER;
  const sp = specOf(u.kind);
  if (sp.aerial || sp.water || sp.behavior === "patrol_boat") return SP_OTHER;
  if (sp.building || sp.behavior === "static_hold") return SP_STATIC;
  if (isGroundVehicle(u.kind)) return SP_VEHICLE;
  if (sp.behavior === "attack_infantry" || sp.behavior === "flee_infantry") return SP_INFANTRY;
  return SP_OTHER;
}

/** Pooled query result: `n` units in `s.units` order via `at(i)`; `done()` returns it to the pool. */
export class UnitHits {
  n = 0;
  readonly slots = new SlotList();
  constructor(private readonly owner: SpatialIndex) {}

  at(i: number): Unit {
    return this.owner.s.units[this.slots.a[i]!]!;
  }

  /** Add a live unit the query missed (kept in `s.units` order). */
  include(u: Unit): void {
    const slot = this.owner.slotOf(u);
    if (slot < 0) return;
    const a = this.slots;
    let k = 0;
    while (k < a.n && a.a[k]! < slot) k++;
    if (k < a.n && a.a[k] === slot) return;
    a.push(0);
    a.a.copyWithin(k + 1, k, a.n - 1);
    a.a[k] = slot;
    this.n = a.n;
  }

  /** Index into `s.units`. */
  slot(i: number): number {
    return this.slots.a[i]!;
  }

  /** Category at the last `sync`. */
  mask(i: number): number {
    return this.owner.maskOf(this.slots.a[i]!);
  }

  /** Circum radius. */
  radius(i: number): number {
    return this.owner.radiusOf(this.slots.a[i]!);
  }

  done(): void {
    this.owner.release(this);
  }
}

/** Debug counters since the last `takeStats()`. */
export interface SpatialStats {
  queries: number;
  hits: number;
  scanned: number;
  misses: number;
}

/** Spatial index over `s.units`: buildings in a static grid (never touched per frame), the rest in a mover grid. */
export class SpatialIndex {
  statics!: SpatialGrid;
  movers!: SpatialGrid;
  /** Brute-force cross-check of every query (debug overlay). */
  check = false;
  /** Recent query circles (x, y, r) and misses (x, y) for the overlay; filled only while `check` is on. */
  readonly recent: number[] = [];
  readonly missAt: number[] = [];
  /** Last miss, described (debug). */
  lastMiss = "";
  stats: SpatialStats = { queries: 0, hits: 0, scanned: 0, misses: 0 };
  private moverSlots: number[] = [];
  private slots = new Map<Unit, number>();
  private known = 0;
  /** `s.units` and its last indexed unit at the previous sync (dev append-only check). */
  private listRef?: Unit[];
  private lastRef?: Unit;
  private pool: UnitHits[] = [];
  private depth = 0;

  constructor(readonly s: MissionScene) {}

  reset(): void {
    const lo = -MAP_AIR_SOFT;
    const hi = WORLD + MAP_AIR_SOFT;
    this.statics = new SpatialGrid(lo, lo, hi, hi, SPATIAL_CELL, STATIC_SLACK);
    this.movers = new SpatialGrid(lo, lo, hi, hi, SPATIAL_CELL, MOVER_SLACK);
    this.moverSlots = [];
    this.slots = new Map();
    this.known = 0;
    this.listRef = undefined;
    this.lastRef = undefined;
    this.depth = 0;
    this.check = false;
    this.recent.length = 0;
    this.missAt.length = 0;
    this.lastMiss = "";
  }

  /** Index new units, drop dead movers, refresh mover positions + categories. */
  sync(): void {
    const units = this.s.units;
    if (import.meta.env.DEV) this.checkAppendOnly(units);
    if (units.length < this.known) this.reset();
    for (let i = this.known; i < units.length; i++) {
      const u = units[i]!;
      this.slots.set(u, i);
      if (u.dead) continue;
      if (specOf(u.kind).building) {
        this.statics.insert(i, u.x, u.y, circumRadiusOf(u.kind), spatialMask(u));
      } else {
        this.movers.insert(i, u.x, u.y, circumRadiusOf(u.kind), spatialMask(u));
        this.moverSlots.push(i);
      }
    }
    this.known = units.length;
    this.listRef = units;
    this.lastRef = units[units.length - 1];
    const slots = this.moverSlots;
    for (let k = 0; k < slots.length; ) {
      const i = slots[k]!;
      const u = units[i]!;
      if (u.dead) {
        this.movers.remove(i);
        slots[k] = slots[slots.length - 1]!;
        slots.pop();
        continue;
      }
      this.movers.move(i, u.x, u.y);
      this.movers.setMask(i, spatialMask(u));
      k++;
    }
  }

  /** `s.units` may only grow at its end (`MissionScene.addUnits`); anything else breaks index-keyed state. */
  private checkAppendOnly(units: Unit[]): void {
    if (!this.known) return;
    if (units === this.listRef && units.length >= this.known && units[this.known - 1] === this.lastRef) return;
    console.error("[spatial] s.units changed other than by appending: add units with MissionScene.addUnits and never remove them");
  }

  /** Unit `i` just moved (position only; categories refresh in `sync`). */
  moved(i: number, u: Unit): void {
    if (this.movers.has(i)) this.movers.move(i, u.x, u.y);
  }

  /** Live units with `mask` whose centre is within `r` + their circum radius of (x, y), plus slack; s.units order. */
  near(x: number, y: number, r: number, mask = SP_ANY): UnitHits {
    const h = (this.pool[this.depth] ??= new UnitHits(this));
    this.depth++;
    const out = h.slots;
    out.n = 0;
    this.statics.query(x, y, r, mask, out);
    const nStatic = out.n;
    this.movers.query(x, y, r, mask, out);
    const units = this.s.units;
    let w = 0;
    for (let k = 0; k < out.n; k++) {
      const i = out.a[k]!;
      if (units[i]!.dead) {
        if (k < nStatic) this.statics.remove(i);
        continue;
      }
      out.a[w++] = i;
    }
    out.n = w;
    out.sort();
    h.n = w;
    if (this.check) this.verify(x, y, r, mask, h);
    return h;
  }

  slotOf(u: Unit): number {
    return this.slots.get(u) ?? -1;
  }

  maskOf(i: number): number {
    return this.statics.has(i) ? this.statics.maskOf(i) : this.movers.maskOf(i);
  }

  radiusOf(i: number): number {
    return this.statics.has(i) ? this.statics.radiusOf(i) : this.movers.radiusOf(i);
  }

  release(h: UnitHits): void {
    this.depth--;
    if (import.meta.env.DEV && this.pool[this.depth] !== h) console.error("[spatial] hits released out of order");
  }

  takeStats(): SpatialStats {
    const st = this.stats;
    this.stats = { queries: 0, hits: 0, scanned: 0, misses: 0 };
    return st;
  }

  /** Every live unit the brute-force scan would accept must be in `h`. */
  private verify(x: number, y: number, r: number, mask: number, h: UnitHits): void {
    const units = this.s.units;
    const st = this.stats;
    st.queries++;
    st.hits += h.n;
    st.scanned += units.length;
    if (this.recent.length < 3 * 600) this.recent.push(x, y, Number.isFinite(r) ? r : 0);
    let k = 0;
    for (let i = 0; i < units.length; i++) {
      const u = units[i]!;
      if (u.dead) continue;
      while (k < h.n && h.slots.a[k]! < i) k++;
      const inIndex = k < h.n && h.slots.a[k] === i;
      const m = this.statics.has(i) || this.movers.has(i) ? this.maskOf(i) : SP_ANY;
      if (!(m & mask)) continue;
      const lim = r + circumRadiusOf(u.kind);
      if (Math.hypot(u.x - x, u.y - y) > lim || inIndex) continue;
      st.misses++;
      if (this.missAt.length < 2 * 200) this.missAt.push(u.x, u.y);
      const grid = this.statics.has(i) ? this.statics : this.movers.has(i) ? this.movers : undefined;
      const at = grid?.posOf(i);
      const drift = at ? Math.hypot(u.x - at.x, u.y - at.y).toFixed(1) : "unindexed";
      this.lastMiss = `${u.kind}#${i} ${grid === this.statics ? "static" : "mover"} drift ${drift} r ${r.toFixed(0)} m ${mask} pin ${u.pinId ?? "-"} ai ${u.aiState ?? "-"} v ${Math.hypot(u.vx, u.vy).toFixed(0)} hp ${u.health.toFixed(0)}`;
    }
  }
}
