import Phaser from "phaser";
import { heightOf, type Unit } from "../../../sim/combat";
import { groundZ, worldToScreen } from "../../../worldgen/world";
import { Layer } from "../../../render/depth";
import type { Craft } from "../../../sim/craft";
import type { MissionScene } from "../../missionScene";

/** Re-check each unit's sight line about this often (ms), jittered per unit so checks spread across frames. */
const LOS_REFRESH_MS = 350;
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

interface Sight {
  target: object;
  ok: boolean;
  /** Target was inside sight range at the last check (debug draws traced lines only). */
  inReach: boolean;
  /** Next recheck time (ms). */
  due: number;
  /** World point where terrain blocked the line (debug). */
  bx: number;
  by: number;
}

/**
 * Enemy line of sight: cheap terrain-occlusion rays from units to their combat focus (player craft / piloted
 * remote), refreshed on a staggered budget rather than every frame. A blocked line zeroes the unit's vision.
 */
export class LineOfSight {
  debugOn = false;
  private gfx!: Phaser.GameObjects.Graphics;
  private sights = new WeakMap<Unit, Sight>();
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
   * Has `u` sight of `target`? Out of `reach` (max sight range): never. Entering range or switching target starts
   * unsighted; budgeted terrain checks then set it and keep it current. A check overdue this long skips the budget.
   */
  sees(u: Unit, target: Craft, reach: number): boolean {
    let sight = this.sights.get(u);
    if (!sight) this.sights.set(u, (sight = { target, ok: false, inReach: false, due: 0, bx: 0, by: 0 }));
    if (Math.hypot(target.x - u.x, target.y - u.y) > reach) {
      sight.ok = false;
      sight.inReach = false;
      return false;
    }
    const now = this.s.time.now;
    if (!sight.inReach || sight.target !== target) {
      sight.inReach = true;
      sight.target = target;
      sight.ok = false;
      sight.due = now;
    }
    const frame = this.s.game.loop.frame;
    if (frame !== this.frame) {
      this.frame = frame;
      this.spent = 0;
    }
    if (now >= sight.due && (this.spent < LOS_BUDGET || now >= sight.due + LOS_OVERDUE_MS)) {
      this.spent++;
      this.trace(u, target, sight);
      sight.due = now + LOS_REFRESH_MS * (0.75 + Math.random() * 0.5);
    }
    return sight.ok;
  }

  /** Cached result only (no trace): false when `u`'s last check was out of sight range or blocked by terrain; true otherwise / unknown. */
  lastSaw(u: Unit): boolean {
    return this.sights.get(u)?.ok ?? true;
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
      const sight = this.sights.get(u);
      if (!sight?.inReach) continue;
      const t = sight.target as Craft;
      if (Math.hypot(t.x - u.x, t.y - u.y) > LOS_DEBUG_RANGE) continue;
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
}
