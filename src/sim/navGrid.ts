import { bedZ, isDeepWater, isWater, WORLD, type WorldData } from "../worldgen/world";
import { CLIFF_GRADE } from "./navigation";

/** Nav cell size (world units) and cells per side. */
export const NAV_CELL = 28;
export const NAV_N = Math.ceil(WORLD / NAV_CELL);
/** Cells inside the map edge that count as blocked (map rim). */
const RIM_CELLS = 2;
/** Clearance is counted up to this many cells. */
const CLEAR_CAP = 6;
/** Land class per cell. */
export const LAND_BLOCKED = 0;
export const LAND_DRY = 1;
export const LAND_SHALLOW = 2;
/** Route cost multiplier through shallow water (avoided, not blocked). */
const SHALLOW_COST = 2.5;
/** Passable cells — land: every ground unit (wades shallows, walks decks) · seabed: underwater hulls (+ deep water) · water: boats. */
export type NavLayer = "land" | "seabed" | "water";

/** What a route is for: which cells are passable, and the steepest crossing (grade) it may take. Interned per pair. */
export interface NavMode {
  readonly layer: NavLayer;
  readonly maxGrade: number;
  readonly key: string;
}

const modes = new Map<string, NavMode>();
export function navMode(layer: NavLayer, maxGrade: number): NavMode {
  const key = `${layer}:${maxGrade}`;
  let m = modes.get(key);
  if (!m) modes.set(key, (m = { layer, maxGrade, key }));
  return m;
}
/** Default ground hull, and boats. */
export const LAND_MODE = navMode("land", CLIFF_GRADE);
export const WATER_MODE = navMode("water", Infinity);

/** Anything that can be routed: a unit or a ground remote. */
export interface NavAgent {
  x: number;
  y: number;
  angle: number;
  route?: UnitNav;
}

/** Per-unit route state. */
export interface UnitNav {
  /** Cells start → goal of the current route (empty = going direct). */
  path: number[];
  pi: number;
  goal: number;
  /** Seconds until the route may be recomputed / direct line rechecked. */
  repathT: number;
  checkT: number;
  direct: boolean;
  /** Frame `route` last ran for this agent (stuck only counts while being routed). */
  frame: number;
  /** Stuck detection: last sample position, time since it, no-progress time, recovery time left. */
  lastX: number;
  lastY: number;
  sampleT: number;
  stuckAcc: number;
  stuckT: number;
  /** Committed flee point + time left. */
  fleeX: number;
  fleeY: number;
  fleeT: number;
}

// Neighbour offsets, clockwise from east; opposite = (d + 4) & 7.
const DX = [1, 1, 0, -1, -1, -1, 0, 1];
const DY = [0, 1, 1, 1, 0, -1, -1, -1];
const STEP = [1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2];

const NO_DECKS: readonly number[] = [];

/** Coarse walkable grid: land / water passability, crossing grades, connected regions + clearance per mode, bridge decks, capped A*. */
export class NavGrid {
  readonly n = NAV_N;
  /** LAND_BLOCKED / LAND_DRY / LAND_SHALLOW, with live decks as dry. */
  readonly land = new Uint8Array(NAV_N * NAV_N);
  /** Land class before decks. */
  private readonly landBase = new Uint8Array(NAV_N * NAV_N);
  /** 1 = navigable water. */
  readonly water = new Uint8Array(NAV_N * NAV_N);
  /** Bed grade of each crossing to neighbours 0–3 (E, SE, S, SW; the other four read the neighbour's), per cell. */
  private readonly grades = new Float32Array(NAV_N * NAV_N * 4);
  /** Steepest crossing touching each cell. */
  private readonly steep = new Float32Array(NAV_N * NAV_N);
  /** Per mode: region id per cell (−1 blocked) and cells to the nearest blocked cell / too-steep edge (capped). */
  private readonly modeData = new Map<string, { mode: NavMode; region: Int32Array; clear: Uint8Array }>();
  /** Deck unit indices touching each cell (segments overlap at seams), or undefined. */
  private readonly decks: (number[] | undefined)[] = new Array(NAV_N * NAV_N);
  /** Live decks per cell (hot-loop check). */
  private readonly deckCount = new Uint8Array(NAV_N * NAV_N);
  /** Bumped whenever passability changes (deck destroyed). */
  version = 0;
  /** A* searches run since the last `takeSearches`. */
  searches = 0;

  private readonly g = new Float32Array(NAV_N * NAV_N);
  private readonly parent = new Int32Array(NAV_N * NAV_N);
  private readonly seen = new Uint32Array(NAV_N * NAV_N);
  private readonly closed = new Uint32Array(NAV_N * NAV_N);
  private stamp = 0;
  private heapI = new Int32Array(4096);
  private heapF = new Float32Array(4096);
  private heapN = 0;
  private readonly queue = new Int32Array(NAV_N * NAV_N);

  constructor(world: WorldData) {
    const n = NAV_N;
    const z = new Float32Array(n * n);
    for (let cy = 0; cy < n; cy++) {
      for (let cx = 0; cx < n; cx++) {
        const c = cy * n + cx;
        const x = (cx + 0.5) * NAV_CELL;
        const y = (cy + 0.5) * NAV_CELL;
        z[c] = bedZ(world, x, y);
        if (cx < RIM_CELLS || cy < RIM_CELLS || cx >= n - RIM_CELLS || cy >= n - RIM_CELLS) continue;
        const wet = isWater(world, x, y);
        // Boats: any of centre + 4 quarter points wet, so narrow rivers stay connected.
        const q = NAV_CELL * 0.25;
        this.water[c] =
          wet || isWater(world, x - q, y - q) || isWater(world, x + q, y - q) || isWater(world, x - q, y + q) || isWater(world, x + q, y + q)
            ? 1
            : 0;
        this.landBase[c] = wet ? (isDeepWater(world, x, y) ? LAND_BLOCKED : LAND_SHALLOW) : LAND_DRY;
      }
    }
    this.land.set(this.landBase);
    // Crossing grade: steepest half (centre → midpoint → centre), so a narrow drop isn't averaged away.
    for (let cy = 0; cy < n; cy++) {
      for (let cx = 0; cx < n; cx++) {
        const c = cy * n + cx;
        for (let d = 0; d < 4; d++) {
          const nx = cx + DX[d]!;
          const ny = cy + DY[d]!;
          if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
          const j = ny * n + nx;
          const half = (STEP[d]! * NAV_CELL) / 2;
          const zm = bedZ(world, (cx + 0.5 + DX[d]! / 2) * NAV_CELL, (cy + 0.5 + DY[d]! / 2) * NAV_CELL);
          const grade = Math.max(Math.abs(zm - z[c]!), Math.abs(z[j]! - zm)) / half;
          this.grades[c * 4 + d] = grade;
          if (grade > this.steep[c]!) this.steep[c] = grade;
          if (grade > this.steep[j]!) this.steep[j] = grade;
        }
      }
    }
  }

  cellAt(x: number, y: number): number {
    const cx = Math.min(NAV_N - 1, Math.max(0, Math.floor(x / NAV_CELL)));
    const cy = Math.min(NAV_N - 1, Math.max(0, Math.floor(y / NAV_CELL)));
    return cy * NAV_N + cx;
  }

  centerX(c: number): number {
    return ((c % NAV_N) + 0.5) * NAV_CELL;
  }

  centerY(c: number): number {
    return (((c / NAV_N) | 0) + 0.5) * NAV_CELL;
  }

  passable(mode: NavMode, c: number): boolean {
    if (mode.layer === "water") return this.water[c] === 1;
    return this.land[c]! !== LAND_BLOCKED || (mode.layer === "seabed" && this.water[c] === 1);
  }

  region(mode: NavMode, c: number): number {
    return this.data(mode).region[c]!;
  }

  clearAt(mode: NavMode, c: number): number {
    return this.data(mode).clear[c]!;
  }

  /** Number of connected regions for `mode`. */
  regionCount(mode: NavMode): number {
    let n = 0;
    for (const r of this.data(mode).region) if (r + 1 > n) n = r + 1;
    return n;
  }

  /** Bed grade of the crossing from cell c toward neighbour direction d (0 off the map). */
  crossingGrade(c: number, d: number): number {
    if (d < 4) return this.grades[c * 4 + d]!;
    const x = (c % NAV_N) + DX[d]!;
    const y = ((c / NAV_N) | 0) + DY[d]!;
    if (x < 0 || y < 0 || x >= NAV_N || y >= NAV_N) return 0;
    return this.grades[(y * NAV_N + x) * 4 + d - 4]!;
  }

  /** Crossing from c in direction d to j is open: water always; ground if no steeper than the mode allows (decks always). */
  private open(mode: NavMode, c: number, d: number, j: number): boolean {
    if (mode.layer === "water") return true;
    return this.hasDeck(c) || this.hasDeck(j) || this.crossingGrade(c, d) <= mode.maxGrade;
  }

  /** Build `mode`'s regions + clearance now (at load) instead of on first use. */
  prepare(mode: NavMode): void {
    this.data(mode);
  }

  /** Regions + clearance for `mode`, built on first use. */
  private data(mode: NavMode): { mode: NavMode; region: Int32Array; clear: Uint8Array } {
    let d = this.modeData.get(mode.key);
    if (!d) {
      d = { mode, region: new Int32Array(NAV_N * NAV_N), clear: new Uint8Array(NAV_N * NAV_N) };
      this.labelRegions(mode, d.region);
      this.clearance(mode, d.clear);
      this.modeData.set(mode.key, d);
    }
    return d;
  }

  /** A live deck touches this cell. */
  hasDeck(c: number): boolean {
    return this.deckCount[c]! > 0;
  }

  /** Deck unit indices touching this cell (empty when none). */
  decksAt(c: number): readonly number[] {
    return this.decks[c] ?? NO_DECKS;
  }

  /** Mark cells as a walkable deck for unit `index`. */
  setDeck(cells: readonly number[], index: number): void {
    for (const c of cells) {
      (this.decks[c] ??= []).push(index);
      this.deckCount[c]!++;
      this.land[c] = LAND_DRY;
    }
  }

  /** Deck `index` gone: cells no other deck covers fall back to their base class; land regions + clearance rebuilt. */
  clearDeck(index: number): boolean {
    let hit = false;
    for (let c = 0; c < this.decks.length; c++) {
      const list = this.decks[c];
      const k = list ? list.indexOf(index) : -1;
      if (k < 0) continue;
      list!.splice(k, 1);
      this.deckCount[c] = list!.length;
      if (!list!.length) this.land[c] = this.landBase[c]!;
      hit = true;
    }
    if (hit) this.rebuildLand();
    return hit;
  }

  /** Ground passability changed (decks): rebuild every ground mode's regions + clearance. */
  rebuildLand(): void {
    for (const d of this.modeData.values()) {
      if (d.mode.layer === "water") continue;
      this.labelRegions(d.mode, d.region);
      this.clearance(d.mode, d.clear);
    }
    this.version++;
  }

  private labelRegions(mode: NavMode, out: Int32Array): void {
    out.fill(-1);
    const q = this.queue;
    let id = 0;
    for (let s = 0; s < out.length; s++) {
      if (out[s]! >= 0 || !this.passable(mode, s)) continue;
      let qh = 0;
      let qt = 0;
      q[qt++] = s;
      out[s] = id;
      while (qh < qt) {
        const c = q[qh++]!;
        const cx = c % NAV_N;
        const cy = (c / NAV_N) | 0;
        for (let d = 0; d < 8; d += 2) {
          const nx = cx + DX[d]!;
          const ny = cy + DY[d]!;
          if (nx < 0 || ny < 0 || nx >= NAV_N || ny >= NAV_N) continue;
          const j = ny * NAV_N + nx;
          if (out[j]! >= 0 || !this.passable(mode, j) || !this.open(mode, c, d, j)) continue;
          out[j] = id;
          q[qt++] = j;
        }
      }
      id++;
    }
  }

  private clearance(mode: NavMode, out: Uint8Array): void {
    const q = this.queue;
    let qt = 0;
    for (let c = 0; c < out.length; c++) {
      if (!this.passable(mode, c)) {
        out[c] = 0;
        q[qt++] = c;
      } else if (mode.layer !== "water" && this.steep[c]! > mode.maxGrade && !this.hasDeck(c)) {
        out[c] = 1;
        q[qt++] = c;
      } else out[c] = CLEAR_CAP;
    }
    let qh = 0;
    while (qh < qt) {
      const c = q[qh++]!;
      const v = out[c]! + 1;
      if (v >= CLEAR_CAP) continue;
      const cx = c % NAV_N;
      const cy = (c / NAV_N) | 0;
      for (let d = 0; d < 8; d += 2) {
        const nx = cx + DX[d]!;
        const ny = cy + DY[d]!;
        if (nx < 0 || ny < 0 || nx >= NAV_N || ny >= NAV_N) continue;
        const j = ny * NAV_N + nx;
        if (out[j]! <= v) continue;
        out[j] = v;
        q[qt++] = j;
      }
    }
  }

  /** Straight walk from a to b stays on passable cells through open crossings. */
  lineClear(mode: NavMode, x0: number, y0: number, x1: number, y1: number): boolean {
    const dist = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.ceil(dist / (NAV_CELL * 0.5));
    let prev = this.cellAt(x0, y0);
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      const c = this.cellAt(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
      if (c === prev) continue;
      if (!this.passable(mode, c)) return false;
      if (mode.layer !== "water") {
        const d = dirOf(prev, c);
        if (d >= 0 && !this.open(mode, prev, d, c)) return false;
      }
      prev = c;
    }
    return true;
  }

  /** Nearest cell to `c` in `region` (ring search up to `maxR` cells), or -1. */
  nearestInRegion(mode: NavMode, region: number, c: number, maxR: number): number {
    if (this.region(mode, c) === region) return c;
    const cx = c % NAV_N;
    const cy = (c / NAV_N) | 0;
    for (let r = 1; r <= maxR; r++) {
      let best = -1;
      let bestClear = -1;
      for (let oy = -r; oy <= r; oy++) {
        for (let ox = -r; ox <= r; ox++) {
          if (Math.abs(ox) !== r && Math.abs(oy) !== r) continue;
          const x = cx + ox;
          const y = cy + oy;
          if (x < 0 || y < 0 || x >= NAV_N || y >= NAV_N) continue;
          const j = y * NAV_N + x;
          if (this.region(mode, j) !== region) continue;
          const cl = this.clearAt(mode, j);
          if (cl > bestClear) {
            bestClear = cl;
            best = j;
          }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  /** First cell in `region` walking from cell `to` back toward cell `from` (the reachable end of the approach), or `from`. */
  nearestAlong(mode: NavMode, region: number, from: number, to: number): number {
    const x0 = this.centerX(to);
    const y0 = this.centerY(to);
    const x1 = this.centerX(from);
    const y1 = this.centerY(from);
    const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (NAV_CELL * 0.5));
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      const c = this.cellAt(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
      if (this.region(mode, c) === region) return c;
    }
    return from;
  }

  /** Nearest passable cell to `c` (ring search up to `maxR`), preferring open ones, or -1. */
  nearestPassable(mode: NavMode, c: number, maxR: number): number {
    if (this.passable(mode, c)) return c;
    const cx = c % NAV_N;
    const cy = (c / NAV_N) | 0;
    for (let r = 1; r <= maxR; r++) {
      let best = -1;
      let bestClear = -1;
      for (let oy = -r; oy <= r; oy++) {
        for (let ox = -r; ox <= r; ox++) {
          if (Math.abs(ox) !== r && Math.abs(oy) !== r) continue;
          const x = cx + ox;
          const y = cy + oy;
          if (x < 0 || y < 0 || x >= NAV_N || y >= NAV_N) continue;
          const j = y * NAV_N + x;
          if (!this.passable(mode, j)) continue;
          const cl = this.clearAt(mode, j);
          if (cl > bestClear) {
            bestClear = cl;
            best = j;
          }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  /**
   * Capped A* from `from` to `to`; fills `out` with cells start → goal (or toward the closest cell reached when
   * capped). Shallow water costs more; low clearance costs a little more (keeps routes off shores / cliff lips).
   */
  findPath(mode: NavMode, from: number, to: number, out: number[], maxExpand = 1600): boolean {
    this.searches++;
    out.length = 0;
    if (from === to) {
      out.push(to);
      return true;
    }
    const st = ++this.stamp;
    const tx = to % NAV_N;
    const ty = (to / NAV_N) | 0;
    const h = (c: number) => {
      const dx = Math.abs((c % NAV_N) - tx);
      const dy = Math.abs(((c / NAV_N) | 0) - ty);
      return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy);
    };
    this.heapN = 0;
    this.g[from] = 0;
    this.seen[from] = st;
    this.parent[from] = -1;
    this.push(from, h(from));
    let best = from;
    let bestH = h(from);
    let expanded = 0;
    let found = false;
    while (this.heapN > 0 && expanded < maxExpand) {
      const c = this.pop();
      if (this.closed[c] === st) continue;
      this.closed[c] = st;
      expanded++;
      if (c === to) {
        found = true;
        best = c;
        break;
      }
      const hc = h(c);
      if (hc < bestH) {
        bestH = hc;
        best = c;
      }
      const cx = c % NAV_N;
      const cy = (c / NAV_N) | 0;
      for (let d = 0; d < 8; d++) {
        const nx = cx + DX[d]!;
        const ny = cy + DY[d]!;
        if (nx < 0 || ny < 0 || nx >= NAV_N || ny >= NAV_N) continue;
        const j = ny * NAV_N + nx;
        if (this.closed[j] === st || !this.passable(mode, j) || !this.open(mode, c, d, j)) continue;
        // Diagonals need both side cells passable (no corner cutting).
        if (d & 1 && (!this.passable(mode, cy * NAV_N + nx) || !this.passable(mode, ny * NAV_N + cx))) continue;
        let cost = STEP[d]!;
        if (mode.layer !== "water" && this.land[j] === LAND_SHALLOW) cost *= SHALLOW_COST;
        if (this.clearAt(mode, j) <= 1) cost *= 1.6;
        const ng = this.g[c]! + cost;
        if (this.seen[j] === st && ng >= this.g[j]!) continue;
        this.seen[j] = st;
        this.g[j] = ng;
        this.parent[j] = c;
        this.push(j, ng + h(j));
      }
    }
    for (let c = best; c >= 0; c = this.parent[c]!) out.push(c);
    out.reverse();
    return found;
  }

  takeSearches(): number {
    const n = this.searches;
    this.searches = 0;
    return n;
  }

  private push(i: number, f: number): void {
    if (this.heapN >= this.heapI.length) {
      const ni = new Int32Array(this.heapI.length * 2);
      const nf = new Float32Array(this.heapF.length * 2);
      ni.set(this.heapI);
      nf.set(this.heapF);
      this.heapI = ni;
      this.heapF = nf;
    }
    let k = this.heapN++;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (this.heapF[p]! <= f) break;
      this.heapI[k] = this.heapI[p]!;
      this.heapF[k] = this.heapF[p]!;
      k = p;
    }
    this.heapI[k] = i;
    this.heapF[k] = f;
  }

  private pop(): number {
    const top = this.heapI[0]!;
    const n = --this.heapN;
    const li = this.heapI[n]!;
    const lf = this.heapF[n]!;
    let k = 0;
    for (;;) {
      let c = k * 2 + 1;
      if (c >= n) break;
      if (c + 1 < n && this.heapF[c + 1]! < this.heapF[c]!) c++;
      if (this.heapF[c]! >= lf) break;
      this.heapI[k] = this.heapI[c]!;
      this.heapF[k] = this.heapF[c]!;
      k = c;
    }
    this.heapI[k] = li;
    this.heapF[k] = lf;
    return top;
  }
}

/** Direction index from cell a to an adjacent cell b, or -1. */
function dirOf(a: number, b: number): number {
  const dx = (b % NAV_N) - (a % NAV_N);
  const dy = ((b / NAV_N) | 0) - ((a / NAV_N) | 0);
  for (let d = 0; d < 8; d++) if (DX[d] === dx && DY[d] === dy) return d;
  return -1;
}
