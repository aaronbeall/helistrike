import { footprintInto, pointInFootprint } from "../../../render/footprint";
import { heightOf, type Unit } from "../../../sim/combat";
import type { RemoteCraft } from "../../../sim/remote";
import { LAND_MODE, NAV_CELL, NAV_N, NavGrid, navMode, WATER_MODE, type NavAgent, type NavMode, type UnitNav } from "../../../sim/navGrid";
import { specOf } from "../../../sim/roster";
import { bedZ, isDeepWater } from "../../../worldgen/world";
import { groundHull, hullOf, onGroundHull, pickBoatWaypoint, type GroundHull } from "../../../sim/navigation";
import { allRemoteKinds, remoteSpecOf } from "../../../sim/remote";
import { craftOf } from "../../../sim/crafts";
import type { MissionScene } from "../../missionScene";

/** A* searches allowed per frame (the rest go direct until a later frame). */
const SEARCH_BUDGET = 2;
/** Re-route at most this often (s), and when the goal moves this many cells. */
const REPATH_EVERY = 2.5;
const GOAL_DRIFT = 4;
/** Direct-line recheck interval (s). */
const CHECK_EVERY = 0.3;
/** Target outside the unit's region: search this many cells for a reachable stand-in (else the reachable end of the approach). */
const CLAMP_CELLS = 10;
/** Within this of its target an agent is arriving, not stuck (slowing down is expected). */
const ARRIVE_DIST = NAV_CELL * 1.5;
/** Stranded in the wrong medium: search this many cells for a way out. */
const ESCAPE_CELLS = 6;
/** Stuck: sampled every STUCK_SAMPLE s; slower than STUCK_SPEED (or jammed) adds no-progress time; STUCK_AFTER of it → recover for STUCK_FOR. */
const STUCK_SAMPLE = 0.25;
const STUCK_SPEED = 8;
const STUCK_AFTER = 0.8;
const STUCK_FOR = 1.1;
/** Flee: candidate angles across ±FLEE_SPREAD of straight away, point this far out, held for FLEE_HOLD s. */
const FLEE_SPREAD = 1.9;
const FLEE_DIST = 320;
const FLEE_HOLD = 2.2;
/** Clearance at or below this pushes the steer target off shores / cliff lips. */
const REPEL_CLEAR = 1;
const REPEL_PUSH = 60;
/** Deck footprint pad (world) for standing on it, and the stamping sample step (≤ pad, so no touched cell is missed). */
const DECK_PAD = 2;
const DECK_SAMPLE = 2;

const hullModes = new WeakMap<GroundHull, NavMode>();
/** Routing mode for a hull: its climb grade, seabed if it drives underwater. */
function hullMode(h: GroundHull): NavMode {
  let m = hullModes.get(h);
  if (!m) hullModes.set(h, (m = navMode(h.underwater ? "seabed" : "land", h.maxGrade)));
  return m;
}

/** Unit navigation: the walkable grid, routes to targets (direct when clear, capped A* when not), flee picks, stuck recovery, bridge decks. */
export class Nav {
  grid!: NavGrid;
  private searchesLeft = SEARCH_BUDGET;
  private frame = 0;
  /** Shared result of every point-returning method: read it before the next `s.nav` call. */
  private out = { x: 0, y: 0 };

  constructor(readonly s: MissionScene) {}

  reset(): void {
    this.frame = 0;
  }

  /** After spawn: build the grid and lay the bridge decks. */
  build(): void {
    this.grid = new NavGrid(this.s.world);
    const units = this.s.units;
    let decks = 0;
    for (let i = 0; i < units.length; i++) {
      const u = units[i]!;
      if (u.dead || !specOf(u.kind).deck) continue;
      this.grid.setDeck(deckCells(this.grid, u), i);
      decks++;
    }
    if (decks) this.grid.rebuildLand();
    // Prebuild every mode in play, so the first router of a mode doesn't build it mid-frame.
    const modes = new Set<NavMode>([LAND_MODE, WATER_MODE]);
    for (const u of units) if (onGroundHull(u)) modes.add(this.modeOf(u));
    for (const k of allRemoteKinds()) {
      const spec = remoteSpecOf(k);
      if (spec.ground) modes.add(hullMode(hullOf(craftOf(spec.craftLook))));
    }
    for (const m of modes) this.grid.prepare(m);
  }

  beginFrame(): void {
    this.searchesLeft = SEARCH_BUDGET;
    this.frame++;
  }

  /** A deck died: its cells stop being walkable. */
  onUnitDead(u: Unit): void {
    if (!specOf(u.kind).deck || !this.grid) return;
    const i = this.s.units.indexOf(u);
    if (i >= 0) this.grid.clearDeck(i);
  }

  /** Live deck under this point (exact footprint; the highest where segments overlap), or undefined. */
  deckAt(x: number, y: number): Unit | undefined {
    if (!this.grid) return undefined;
    let best: Unit | undefined;
    for (const di of this.grid.decksAt(this.grid.cellAt(x, y))) {
      const d = this.s.units[di];
      if (!d || d.dead || !pointInFootprint(x, y, footprintInto(d, DECK_PAD, 1))) continue;
      if (!best || d.z + heightOf(d.kind) > best.z + heightOf(best.kind)) best = d;
    }
    return best;
  }

  /** Ground unit standing height: deck top on a bridge, else the bed. */
  surfaceZ(x: number, y: number): number {
    const d = this.deckAt(x, y);
    return d ? d.z + heightOf(d.kind) : bedZ(this.s.world, x, y);
  }

  readonly onDeck = (x: number, y: number): boolean => this.deckAt(x, y) != null;

  /** Ground hull in deep water it can't survive (not underwater-capable, not on a deck): it drowns. Boats never do. */
  drowns(a: Unit | RemoteCraft): boolean {
    return onGroundHull(a) && !groundHull(a).underwater && this.submerged(a.x, a.y);
  }

  /** Under deep water (not on a deck): where underwater hulls drive, can't fire, and leave no surface splash. */
  submerged(x: number, y: number): boolean {
    return isDeepWater(this.s.world, x, y) && !this.onDeck(x, y);
  }

  /** Routing mode for a ground unit / ground remote: its hull's climb grade, seabed if it drives underwater. */
  modeOf(u: Unit | RemoteCraft): NavMode {
    return hullMode(groundHull(u));
  }

  /** Recovering from a jam while being routed (drivers pick the manoeuvre: see `turnsInPlace`). */
  stuck(u: NavAgent): boolean {
    const nav = u.route;
    return !!nav && nav.stuckT > 0 && nav.frame >= this.frame - 1;
  }

  /** Way out for an agent standing where its layer can't be (a boat aground), or undefined. */
  escapePoint(u: NavAgent, mode: NavMode): { x: number; y: number } | undefined {
    const g = this.grid;
    if (!g) return undefined;
    const c = g.cellAt(u.x, u.y);
    if (g.passable(mode, c)) return undefined;
    const e = g.nearestPassable(mode, c, ESCAPE_CELLS);
    if (e < 0) return undefined;
    this.out.x = g.centerX(e);
    this.out.y = g.centerY(e);
    return this.out;
  }

  /**
   * Steer point toward (tx, ty): the target itself when the straight line is walkable, else the next corner of a
   * cached route; the target is first pulled into the unit's own connected region (nearest reachable cell, else the
   * reachable end of the approach).
   */
  route(u: NavAgent, tx: number, ty: number, mode: NavMode, dt: number): { x: number; y: number } {
    const g = this.grid;
    const o = this.out;
    o.x = tx;
    o.y = ty;
    if (!g) return o;
    const nav = (u.route ??= newNav(u));
    nav.frame = this.frame;
    const uc = g.cellAt(u.x, u.y);
    const region = g.region(mode, uc);
    if (region < 0) return o;
    let goal = g.cellAt(tx, ty);
    if (g.region(mode, goal) !== region) {
      const near = g.nearestInRegion(mode, region, goal, CLAMP_CELLS);
      goal = near >= 0 ? near : g.nearestAlong(mode, region, uc, goal);
      o.x = g.centerX(goal);
      o.y = g.centerY(goal);
    }
    this.trackStuck(u, nav, dt, Math.hypot(o.x - u.x, o.y - u.y) < ARRIVE_DIST);
    if (nav.stuckT > 0) return this.unstick(u, uc, mode);
    nav.repathT -= dt;
    nav.checkT -= dt;
    if (nav.checkT <= 0) {
      nav.checkT = CHECK_EVERY * (0.8 + Math.random() * 0.4);
      nav.direct = g.lineClear(mode, u.x, u.y, o.x, o.y);
    }
    if (nav.direct || goal === uc) {
      nav.path.length = 0;
      return o;
    }
    const drift = cellDist(goal, nav.goal);
    if ((!nav.path.length || nav.repathT <= 0 || drift > GOAL_DRIFT) && this.searchesLeft > 0) {
      this.searchesLeft--;
      g.findPath(mode, uc, goal, nav.path);
      nav.pi = 0;
      nav.goal = goal;
      nav.repathT = REPATH_EVERY * (0.8 + Math.random() * 0.4);
    }
    const path = nav.path;
    if (!path.length) return o;
    // Advance past corners we're on or can already see past.
    while (nav.pi < path.length - 1 && path[nav.pi] === uc) nav.pi++;
    if (nav.pi < path.length - 1 && nav.checkT >= CHECK_EVERY * 0.75) {
      const nx = g.centerX(path[nav.pi + 1]!);
      const ny = g.centerY(path[nav.pi + 1]!);
      if (g.lineClear(mode, u.x, u.y, nx, ny)) nav.pi++;
    }
    const c = path[Math.min(nav.pi, path.length - 1)]!;
    if (c === goal) return o;
    o.x = g.centerX(c);
    o.y = g.centerY(c);
    return o;
  }

  /** Flee point: reachable, open ground roughly away from (fx, fy), held for a few seconds. */
  fleePoint(u: NavAgent, fx: number, fy: number, mode: NavMode, dt: number): { x: number; y: number } {
    const g = this.grid;
    const nav = (u.route ??= newNav(u));
    nav.fleeT -= dt;
    const o = this.out;
    const away = Math.atan2(u.y - fy, u.x - fx);
    if (nav.fleeT > 0 && g) {
      // Keep the commitment unless the threat now sits between us and it.
      const toF = Math.atan2(nav.fleeY - u.y, nav.fleeX - u.x);
      if (Math.cos(toF - away) > -0.2) {
        o.x = nav.fleeX;
        o.y = nav.fleeY;
        return o;
      }
    }
    let bx = u.x + Math.cos(away) * FLEE_DIST;
    let by = u.y + Math.sin(away) * FLEE_DIST;
    if (g) {
      const region = g.region(mode, g.cellAt(u.x, u.y));
      let best = -Infinity;
      for (let k = 0; k < 9; k++) {
        const a = away + (k / 8 - 0.5) * 2 * FLEE_SPREAD;
        const px = u.x + Math.cos(a) * FLEE_DIST;
        const py = u.y + Math.sin(a) * FLEE_DIST;
        const c = g.cellAt(px, py);
        if (g.region(mode, c) !== region) continue;
        const score = g.clearAt(mode, c) * 40 + Math.cos(a - away) * 120 + Math.hypot(px - fx, py - fy) * 0.15;
        if (score > best) {
          best = score;
          bx = px;
          by = py;
        }
      }
    }
    nav.fleeX = bx;
    nav.fleeY = by;
    nav.fleeT = FLEE_HOLD;
    o.x = bx;
    o.y = by;
    return o;
  }

  /** Boat patrol waypoint: a random open cell in the boat's own water body (falls back to the old wet-point pick). */
  pickWaterWaypoint(u: Unit): void {
    const g = this.grid;
    if (g) {
      const region = g.region(WATER_MODE, g.cellAt(u.x, u.y));
      if (region >= 0) {
        for (let i = 0; i < 16; i++) {
          const a = Math.random() * Math.PI * 2;
          const d = 180 + Math.random() * 520;
          const c = g.cellAt(u.x + Math.cos(a) * d, u.y + Math.sin(a) * d);
          if (g.region(WATER_MODE, c) !== region || g.clearAt(WATER_MODE, c) < 2) continue;
          u.aiTx = g.centerX(c);
          u.aiTy = g.centerY(c);
          return;
        }
      }
    }
    pickBoatWaypoint(this.s.world, u);
  }

  /** Steer push off low-clearance cells (shores, cliff lips, map rim), along the clearance gradient. */
  repel(u: NavAgent, wx: number, wy: number, mode: NavMode): { x: number; y: number } {
    const g = this.grid;
    const o = this.out;
    o.x = wx;
    o.y = wy;
    if (!g) return o;
    const c = g.cellAt(u.x, u.y);
    if (g.clearAt(mode, c) > REPEL_CLEAR) return o;
    const n = g.n;
    const cx = c % n;
    const cy = (c / n) | 0;
    const at = (x: number, y: number) => (x < 0 || y < 0 || x >= n || y >= n ? 0 : g.clearAt(mode, y * n + x));
    const gx = at(cx + 1, cy) - at(cx - 1, cy);
    const gy = at(cx, cy + 1) - at(cx, cy - 1);
    const gl = Math.hypot(gx, gy);
    if (gl < 1e-3) return o;
    o.x += (gx / gl) * REPEL_PUSH;
    o.y += (gy / gl) * REPEL_PUSH;
    return o;
  }

  /** Collision jam (pressed into a solid): counts toward stuck like no progress does. */
  noteJam(u: NavAgent, dt: number): void {
    (u.route ??= newNav(u)).stuckAcc += dt;
  }

  private trackStuck(u: NavAgent, nav: UnitNav, dt: number, arriving: boolean): void {
    if (nav.stuckT > 0) {
      nav.stuckT -= dt;
      if (nav.stuckT <= 0) {
        nav.path.length = 0;
        nav.repathT = 0;
        nav.checkT = 0;
        nav.lastX = u.x;
        nav.lastY = u.y;
        nav.sampleT = 0;
      }
      return;
    }
    nav.sampleT += dt;
    if (nav.sampleT >= STUCK_SAMPLE) {
      const moved = Math.hypot(u.x - nav.lastX, u.y - nav.lastY);
      if (!arriving && moved < STUCK_SPEED * nav.sampleT) nav.stuckAcc += nav.sampleT;
      else nav.stuckAcc = Math.max(0, nav.stuckAcc - nav.sampleT);
      nav.lastX = u.x;
      nav.lastY = u.y;
      nav.sampleT = 0;
    }
    if (nav.stuckAcc >= STUCK_AFTER) {
      nav.stuckAcc = 0;
      nav.stuckT = STUCK_FOR;
      nav.fleeT = 0;
    }
  }

  /** Recovery target: the most open neighbouring cell. */
  private unstick(u: NavAgent, uc: number, mode: NavMode): { x: number; y: number } {
    const g = this.grid;
    const n = g.n;
    const cx = uc % n;
    const cy = (uc / n) | 0;
    let best = uc;
    let bestScore = -Infinity;
    for (let oy = -2; oy <= 2; oy++) {
      for (let ox = -2; ox <= 2; ox++) {
        if (!ox && !oy) continue;
        const x = cx + ox;
        const y = cy + oy;
        if (x < 0 || y < 0 || x >= n || y >= n) continue;
        const j = y * n + x;
        if (!g.passable(mode, j)) continue;
        // Prefer open cells behind the hull (backing out of the jam).
        const behind = -(ox * Math.cos(u.angle) + oy * Math.sin(u.angle));
        const score = g.clearAt(mode, j) * 2 + behind * 0.6;
        if (score > bestScore) {
          bestScore = score;
          best = j;
        }
      }
    }
    this.out.x = g.centerX(best);
    this.out.y = g.centerY(best);
    return this.out;
  }
}

function newNav(u: NavAgent): UnitNav {
  return {
    path: [],
    pi: 0,
    goal: -1,
    frame: -1,
    repathT: 0,
    checkT: 0,
    direct: false,
    lastX: u.x,
    lastY: u.y,
    sampleT: 0,
    stuckAcc: 0,
    stuckT: 0,
    fleeX: u.x,
    fleeY: u.y,
    fleeT: 0,
  };
}

function cellDist(a: number, b: number): number {
  if (b < 0) return Infinity;
  return Math.max(Math.abs((a % NAV_N) - (b % NAV_N)), Math.abs(((a / NAV_N) | 0) - ((b / NAV_N) | 0)));
}

/** Nav cells under a deck's footprint (points over its bounding circle, kept when inside the footprint). */
function deckCells(g: NavGrid, u: Unit): number[] {
  // Same padded footprint `deckAt` tests, sampled finer than any sliver it could put in a cell.
  const fp = footprintInto(u, DECK_PAD, 1);
  const out: number[] = [];
  const add = (x: number, y: number) => {
    const c = g.cellAt(x, y);
    if (!out.includes(c)) out.push(c);
  };
  if (fp.shape === "circle") {
    const step = DECK_SAMPLE;
    for (let oy = -fp.r; oy <= fp.r; oy += step) {
      for (let ox = -fp.r; ox <= fp.r; ox += step) if (ox * ox + oy * oy <= fp.r * fp.r) add(u.x + ox, u.y + oy);
    }
    return out;
  }
  // Rect: sample along / across in its own frame, both edges included.
  const c = Math.cos(fp.angle);
  const s = Math.sin(fp.angle);
  const step = DECK_SAMPLE;
  const nl = Math.ceil((fp.halfL * 2) / step);
  const nw = Math.ceil((fp.halfW * 2) / step);
  for (let i = 0; i <= nl; i++) {
    const a = -fp.halfL + (i / nl) * fp.halfL * 2;
    for (let j = 0; j <= nw; j++) {
      const w = -fp.halfW + (j / nw) * fp.halfW * 2;
      add(u.x + a * c - w * s, u.y + a * s + w * c);
    }
  }
  return out;
}
