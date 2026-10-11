import Phaser from "phaser";
import { heightOf, type Unit } from "../../../sim/combat";
import { groundZ, worldToScreen } from "../../../worldgen/world";
import { Layer } from "../../../render/depth";
import type { Craft } from "../../../sim/craft";
import type { MissionScene } from "../../missionScene";

/** Re-check a clear sight line about this often (ms), jittered per unit so checks spread across frames. */
const LOS_REFRESH_MS = 350;
/** Re-check a blocked (or newly in-range) line after a random wait in this range (ms): staggered noticing, fewer rays. */
const LOS_BLOCKED_MIN_MS = 800;
const LOS_BLOCKED_MAX_MS = 1500;
/** Spotting: vision ramps 0 → 1 over this long (ms) once the line clears; a hit skips it. */
const SPOT_MS = 1200;
/** Most sight checks per frame (the rest keep their current state). */
const LOS_BUDGET = 24;
/** A check this late (ms past due) skips the budget, so no unit starves. */
const LOS_OVERDUE_MS = 700;
/** Terrain sample spacing along a sight line (world units). */
const LOS_STEP = 28;
/** Don't test near either end (a unit's own hillside / the target's own pad). */
const LOS_END_SKIP = 40;
/** Terrain must rise this far (z) above the line to block it. */
const LOS_CLEAR = 3;
/** Debug view only draws units within this range of the target. */
const LOS_DEBUG_RANGE = 1800;
/** Sight lines cached per unit: its focus + one other weapon target. */
const SIGHT_SLOTS = 2;

interface Sight {
  target: object;
  ok: boolean;
  /** Target was inside sight range at the last check (debug draws traced lines only). */
  inReach: boolean;
  /** Next recheck time (ms). */
  due: number;
  /** Frame last queried (least recent slot is reused). */
  used: number;
  /** When the line last turned clear (ms): the spotting ramp starts here. */
  seenAt: number;
  /** Last terrain trace (ms). */
  checkedAt: number;
  /** World point where terrain blocked the line (debug). */
  bx: number;
  by: number;
}

/**
 * Enemy line of sight: cheap terrain-occlusion rays from units to their combat focus (player craft / piloted
 * remote), refreshed on a staggered budget rather than every frame, and only inside sight range. A blocked line
 * zeroes the unit's vision; a clear one ramps it up over the spotting time.
 */
export class LineOfSight {
  debugOn = false;
  private gfx!: Phaser.GameObjects.Graphics;
  private sights = new WeakMap<Unit, Sight[]>();
  private frame = -1;
  private spent = 0;

  constructor(readonly s: MissionScene) {}

  reset(): void {
    this.sights = new WeakMap();
    this.debugOn = false;
  }

  create(): void {
    this.gfx = this.s.add.graphics().setDepth(Layer.FIELD + 8);
  }

  /**
   * How well `u` has spotted `target` (0 = not at all, 1 = fully). Out of `reach` (max sight range): 0, no ray.
   * Entering range or switching target starts unsighted with a staggered first check; budgeted terrain checks then
   * keep it current. A check overdue this long skips the budget.
   */
  sight(u: Unit, target: Craft, reach: number): number {
    const frame = this.s.game.loop.frame;
    if (frame !== this.frame) {
      this.frame = frame;
      this.spent = 0;
    }
    const sight = this.slot(u, target, frame);
    if (Math.hypot(target.x - u.x, target.y - u.y) > reach) {
      sight.ok = false;
      sight.inReach = false;
      return 0;
    }
    const now = this.s.time.now;
    if (!sight.inReach) {
      sight.inReach = true;
      sight.ok = false;
      sight.due = now + Math.random() * LOS_BLOCKED_MAX_MS;
    }
    if (now >= sight.due && (this.spent < LOS_BUDGET || now >= sight.due + LOS_OVERDUE_MS)) {
      this.spent++;
      this.check(u, target, sight, now);
    }
    return sight.ok ? Math.min(1, (now - sight.seenAt) / SPOT_MS) : 0;
  }

  /** `u` was hit: inside sight range, check the line now (no budget, unless just checked); clear = fully spotted at once. */
  alert(u: Unit, target: Craft, reach: number): void {
    if (Math.hypot(target.x - u.x, target.y - u.y) > reach) return;
    const now = this.s.time.now;
    const sight = this.slot(u, target, this.s.game.loop.frame);
    if (!sight.inReach) {
      sight.inReach = true;
      sight.ok = false;
    }
    if (now - sight.checkedAt >= LOS_REFRESH_MS) this.check(u, target, sight, now);
    if (sight.ok) sight.seenAt = now - SPOT_MS;
  }

  /** Trace now and schedule the next check: soon while clear, later while blocked. */
  private check(u: Unit, target: Craft, sight: Sight, now: number): void {
    const was = sight.ok;
    this.trace(u, target, sight);
    if (sight.ok && !was) sight.seenAt = now;
    sight.checkedAt = now;
    sight.due = sight.ok
      ? now + LOS_REFRESH_MS * (0.75 + Math.random() * 0.5)
      : now + LOS_BLOCKED_MIN_MS + Math.random() * (LOS_BLOCKED_MAX_MS - LOS_BLOCKED_MIN_MS);
  }

  /** Cached result only (no trace): false when every cached sight of `u` is out of range or blocked; true otherwise / unknown. */
  lastSaw(u: Unit): boolean {
    const list = this.sights.get(u);
    return !list || list.some((s) => s.ok);
  }

  /** `u`'s cached sight of `target`; a new target takes a free or the least recently used slot, unsighted. */
  private slot(u: Unit, target: object, frame: number): Sight {
    let list = this.sights.get(u);
    if (!list) this.sights.set(u, (list = []));
    let lru: Sight | undefined;
    for (const s of list) {
      if (s.target === target) {
        s.used = frame;
        return s;
      }
      if (!lru || s.used < lru.used) lru = s;
    }
    if (list.length < SIGHT_SLOTS || !lru) {
      const s: Sight = { target, ok: false, inReach: false, due: 0, used: frame, seenAt: 0, checkedAt: -Infinity, bx: 0, by: 0 };
      list.push(s);
      return s;
    }
    lru.target = target;
    lru.ok = false;
    lru.inReach = false;
    lru.used = frame;
    lru.checkedAt = -Infinity;
    return lru;
  }

  /** Ray from the unit's eye to the target; blocked where the ground rises above it. */
  private trace(u: Unit, target: Craft, out: Sight): void {
    const x0 = u.x;
    const y0 = u.y;
    const z0 = u.z + heightOf(u.kind) * 0.8;
    const dx = target.x - x0;
    const dy = target.y - y0;
    const dz = target.z - z0;
    const len = Math.hypot(dx, dy);
    out.ok = true;
    if (len < LOS_END_SKIP * 2) return;
    const steps = Math.min(80, Math.ceil(len / LOS_STEP));
    const t0 = LOS_END_SKIP / len;
    const t1 = 1 - LOS_END_SKIP / len;
    for (let i = 0; i <= steps; i++) {
      const t = t0 + ((t1 - t0) * i) / steps;
      const x = x0 + dx * t;
      const y = y0 + dy * t;
      if (groundZ(this.s.world, x, y) > z0 + dz * t + LOS_CLEAR) {
        out.ok = false;
        out.bx = x;
        out.by = y;
        return;
      }
    }
  }

  setDebug(on: boolean): void {
    this.debugOn = on;
    if (!on) this.gfx.clear();
    this.s.debugMenu.sync();
  }

  /** Debug: green line = sees the target, red = blocked (with the blocking point marked). Cached results only. */
  drawDebug(): void {
    this.gfx.clear();
    if (!this.debugOn || this.s.camera.mapWorldHidden) return;
    for (const u of this.s.units) {
      if (u.dead) continue;
      const list = this.sights.get(u);
      if (list) for (const sight of list) this.drawSight(u, sight);
    }
  }

  private drawSight(u: Unit, sight: Sight): void {
    if (!sight.inReach) return;
    const t = sight.target as Craft;
    if (Math.hypot(t.x - u.x, t.y - u.y) > LOS_DEBUG_RANGE) return;
    const a = worldToScreen(u.x, u.y, u.z + heightOf(u.kind) * 0.8);
    const b = worldToScreen(t.x, t.y, t.z);
    if (sight.ok) {
      this.gfx.lineStyle(1, 0x6dff8a, 0.45);
      this.gfx.lineBetween(a.x, a.y, b.x, b.y);
    } else {
      const hz = groundZ(this.s.world, sight.bx, sight.by);
      const h = worldToScreen(sight.bx, sight.by, hz);
      this.gfx.lineStyle(1, 0xff4a3a, 0.75);
      this.gfx.lineBetween(a.x, a.y, h.x, h.y);
      this.gfx.lineStyle(1, 0xff4a3a, 0.2);
      this.gfx.lineBetween(h.x, h.y, b.x, b.y);
      this.gfx.fillStyle(0xff4a3a, 0.9);
      this.gfx.fillCircle(h.x, h.y, 2.5);
    }
  }
}
