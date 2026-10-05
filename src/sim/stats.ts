/**
 * Player stats model: fact tables ("cubes") kept at their finest grain, so any rollup or combination
 * (per craft, map, weapon, enemy, enemy weapon, countermeasure, or any mix) is derived by query.
 * Pure data, no storage.
 */
import { ENEMY_WPNS } from "../catalog/enemyWeapons";
import { UNIT_SPECS } from "../catalog/units";
import type { WeaponSpec } from "./roster";

/**
 * A fact table: one row per distinct combination of `dims` values, each row a bag of summed measures.
 * Rows are keyed by the dim values joined with `KEY_SEP`.
 */
export interface Cube<D extends string, M extends string> {
  dims: readonly D[];
  rows: Record<string, Partial<Record<M, number>>>;
}

/** Who was in control: the player (incl. piloting a remote), or AI (autonomous remotes, automatic crew guns). */
export type Control = "player" | "ai";
export const PLAYER: Control = "player";
export const AI: Control = "ai";

/**
 * Player offense: shots (enemy "" = not aimed at anything), hits, kills, damage dealt.
 * `craft` is whatever fired (host craft or remote kind); `control` who was driving it.
 */
export type OffenseDim = "craft" | "control" | "map" | "weapon" | "enemy";
export type OffenseMeasure = "shots" | "hits" | "kills" | "damageDealt";
/** What hurt the player's side: hits and damage taken, and the killing blow (deaths); `craft` is what got hit. */
export type DefenseDim = "craft" | "control" | "map" | "enemy" | "enemyWeapon";
export type DefenseMeasure = "hitsTaken" | "damageTaken" | "deaths" | "seekersFired" | "seekersDodged";
/** Missions flown: outcomes and objectives (host craft); time (seconds) for the host and each remote. */
export type SortieDim = "craft" | "control" | "map";
export type SortieMeasure = "started" | "succeeded" | "failed" | "abandoned" | "objectives" | "timeFlown" | "timePlayed";
/** Countermeasure activations. */
export type CmDim = "craft" | "control" | "map" | "countermeasure";
export type CmMeasure = "uses";
/** Kills with context: shooter-to-target range band, line of sight from where it was fired, target debuff. */
export type KillDim = "craft" | "control" | "map" | "weapon" | "enemy" | "range" | "sight" | "debuff";
export type KillMeasure = "kills";
/** Remotes launched, by the host craft that launched them. */
export type RemoteLaunchDim = "craft" | "map" | "remote";
export type RemoteLaunchMeasure = "launches";

export type KillRange = "close" | "mid" | "long";
export type KillSight = "los" | "nlos";
export type KillDebuff = "none" | "stunned" | "blinded" | "both";
/** Kill range bands (world units, shooter to target): close below the first, long at or past the second. */
export const KILL_RANGE_CLOSE = 200;
export const KILL_RANGE_LONG = 500;

export function killRange(dist: number): KillRange {
  return dist < KILL_RANGE_CLOSE ? "close" : dist < KILL_RANGE_LONG ? "mid" : "long";
}

export type OffenseCube = Cube<OffenseDim, OffenseMeasure>;
export type DefenseCube = Cube<DefenseDim, DefenseMeasure>;
export type SortieCube = Cube<SortieDim, SortieMeasure>;
export type CmCube = Cube<CmDim, CmMeasure>;
export type KillCube = Cube<KillDim, KillMeasure>;
export type RemoteLaunchCube = Cube<RemoteLaunchDim, RemoteLaunchMeasure>;

const OFFENSE_DIMS = ["craft", "control", "map", "weapon", "enemy"] as const;
const DEFENSE_DIMS = ["craft", "control", "map", "enemy", "enemyWeapon"] as const;
const SORTIE_DIMS = ["craft", "control", "map"] as const;
const CM_DIMS = ["craft", "control", "map", "countermeasure"] as const;
const KILL_DIMS = ["craft", "control", "map", "weapon", "enemy", "range", "sight", "debuff"] as const;
const REMOTE_LAUNCH_DIMS = ["craft", "map", "remote"] as const;

const KEY_SEP = "|";

/** Dim value for "not applicable" (shots that hit nothing, damage with no unit behind it). */
export const NO_DIM = "";
/** Player damage with no catalog weapon. */
export const UNKNOWN_WEAPON = "unknown";
/** Player damage taken from something other than an enemy unit. */
export const ENVIRONMENT = "environment";

export type MissionOutcome = "succeeded" | "failed" | "abandoned";

/** End-of-mission summary (percentages 0..1 of what the map started with). */
export interface MissionResult {
  map: string;
  craft: string;
  outcome: MissionOutcome;
  /** Seconds from start to end. */
  time: number;
  enemyKillPct: number;
  neutralKillPct: number;
  buildingKillPct: number;
  objectivePct: number;
  /** Wall-clock end time (ms since epoch). */
  at: number;
}

/** Every fact table, for one run or the lifetime book. */
export interface StatTables {
  offense: OffenseCube;
  defense: DefenseCube;
  sorties: SortieCube;
  countermeasures: CmCube;
  killContext: KillCube;
  remoteLaunches: RemoteLaunchCube;
}

/** Saved stats format; records or books of any other version are discarded (no migration). */
export const STATS_VERSION = 4;

/** One mission's stats, kept in memory until the mission ends. */
export interface MissionRun extends StatTables {
  craft: string;
  map: string;
  result?: MissionResult;
}

/** A finished mission as saved in the history: its summary plus its full fact tables. */
export interface MissionRecord extends StatTables {
  version: number;
  result: MissionResult;
}

/** Lifetime totals: every recorded mission's tables summed (rebuildable from the history). */
export interface StatsBook extends StatTables {
  version: number;
  /** Missions summed in (to spot a book out of step with the history). */
  missions: number;
}

function cube<D extends string, M extends string>(dims: readonly D[]): Cube<D, M> {
  return { dims, rows: {} };
}

function emptyTables(): StatTables {
  return {
    offense: cube(OFFENSE_DIMS),
    defense: cube(DEFENSE_DIMS),
    sorties: cube(SORTIE_DIMS),
    countermeasures: cube(CM_DIMS),
    killContext: cube(KILL_DIMS),
    remoteLaunches: cube(REMOTE_LAUNCH_DIMS),
  };
}

export function emptyBook(): StatsBook {
  return { version: STATS_VERSION, missions: 0, ...emptyTables() };
}

const TABLES = ["offense", "defense", "sorties", "countermeasures", "killContext", "remoteLaunches"] as const;

/** Fresh tables holding `saved`'s rows; dims always come from code, so tables added since start empty. */
export function restoreTables(saved: Partial<Record<keyof StatTables, { rows?: Record<string, object> }>>): StatTables {
  const tables = emptyTables();
  for (const name of TABLES) (tables[name] as Cube<string, string>).rows = (saved[name]?.rows ?? {}) as Cube<string, string>["rows"];
  return tables;
}

/** Sum every table of `from` into `into`. */
export function addTables(into: StatTables, from: StatTables): void {
  for (const name of TABLES) mergeCube(into[name] as Cube<string, string>, from[name] as Cube<string, string>);
}

/** A finished run as a history record (undefined until it has a result). */
export function recordOf(run: MissionRun): MissionRecord | undefined {
  if (!run.result) return undefined;
  const tables: StatTables = { ...emptyTables() };
  for (const name of TABLES) (tables[name] as Cube<string, string>).rows = run[name].rows;
  return { version: STATS_VERSION, result: run.result, ...tables };
}

/** Lifetime totals from a mission history. */
export function bookOf(records: readonly MissionRecord[]): StatsBook {
  const book = emptyBook();
  for (const r of records) addTables(book, r);
  book.missions = records.length;
  return book;
}

export function newRun(craft: string, map: string): MissionRun {
  return { craft, map, ...emptyTables() };
}

/** Row key for `at` (cache it for hot paths and bump with `bumpKey`). */
export function rowKey<D extends string>(c: Cube<D, string>, at: Record<D, string>): string {
  return c.dims.map((d) => at[d]).join(KEY_SEP);
}

/** Add `n` of `measure` at the row for `at`. */
export function bump<D extends string, M extends string>(c: Cube<D, M>, at: Record<D, string>, measure: M, n = 1): void {
  bumpKey(c, rowKey(c, at), measure, n);
}

/** `bump` by a precomputed row key (no allocation once the row exists). */
export function bumpKey<M extends string>(c: Cube<string, M>, key: string, measure: M, n = 1): void {
  if (!n) return;
  const row = (c.rows[key] ??= {});
  row[measure] = (row[measure] ?? 0) + n;
}

/** Sum every row of `from` into `into` (same dims). */
export function mergeCube<D extends string, M extends string>(into: Cube<D, M>, from: Cube<D, M>): void {
  for (const [k, row] of Object.entries(from.rows) as [string, Partial<Record<M, number>>][]) {
    const dst = (into.rows[k] ??= {});
    for (const [m, n] of Object.entries(row) as [M, number][]) dst[m] = (dst[m] ?? 0) + n;
  }
}

/** Which rows a query covers: fixed dim values, and/or a predicate on the row's dims. */
export type Where<D extends string> = Partial<Record<D, string>> | ((at: Record<D, string>) => boolean);

export interface QueryRow<D extends string, M extends string> {
  /** Values of the grouped dims. */
  at: Partial<Record<D, string>>;
  m: Record<M, number>;
}

function rowDims<D extends string>(c: Cube<D, string>, key: string): Record<D, string> {
  const vals = key.split(KEY_SEP);
  const at = {} as Record<D, string>;
  c.dims.forEach((d, i) => (at[d] = vals[i] ?? NO_DIM));
  return at;
}

function matches<D extends string>(at: Record<D, string>, where: Where<D> | undefined): boolean {
  if (!where) return true;
  if (typeof where === "function") return where(at);
  for (const [d, v] of Object.entries(where) as [D, string][]) if (at[d] !== v) return false;
  return true;
}

/**
 * Roll up a cube: rows matching `where`, summed per distinct value of the `by` dims (none = one grand total).
 * E.g. kills by enemy for one craft on one map: `query(book.offense, { craft, map }, ["enemy"])`.
 */
export function query<D extends string, M extends string>(c: Cube<D, M>, where?: Where<D>, by: readonly D[] = []): QueryRow<D, M>[] {
  const groups = new Map<string, QueryRow<D, M>>();
  for (const [key, row] of Object.entries(c.rows) as [string, Partial<Record<M, number>>][]) {
    const at = rowDims(c, key);
    if (!matches(at, where)) continue;
    const gk = by.map((d) => at[d]).join(KEY_SEP);
    let g = groups.get(gk);
    if (!g) {
      const gat: Partial<Record<D, string>> = {};
      for (const d of by) gat[d] = at[d];
      g = { at: gat, m: {} as Record<M, number> };
      groups.set(gk, g);
    }
    for (const [m, n] of Object.entries(row) as [M, number][]) g.m[m] = (g.m[m] ?? 0) + n;
  }
  return [...groups.values()];
}

/** One measure summed over the rows matching `where`. */
export function total<D extends string, M extends string>(c: Cube<D, M>, measure: M, where?: Where<D>): number {
  let sum = 0;
  for (const [key, row] of Object.entries(c.rows) as [string, Partial<Record<M, number>>][]) {
    if (where && !matches(rowDims(c, key), where)) continue;
    sum += row[measure] ?? 0;
  }
  return sum;
}

/** Offense `weapon` keys for roadkills: rotor-blade strikes and hull crushes. */
export const ROTOR_KILL = "rotor";
export const CRUSH_KILL = "crush";
/** Offense weapons that aren't a real weapon (excluded from favorite weapon). */
const NON_WEAPONS: ReadonlySet<string> = new Set([ROTOR_KILL, CRUSH_KILL, UNKNOWN_WEAPON]);

/** One host craft's lifetime record (all controls: its crew guns count too). */
export interface CraftCareer {
  started: number;
  succeeded: number;
  failed: number;
  objectives: number;
  timeFlown: number;
  /** Hostile kills. */
  kills: number;
  shots: number;
  hits: number;
  deaths: number;
  /** Hostile kills of stunned / blinded targets ("both" counts in each). */
  stunnedKills: number;
  blindedKills: number;
  rotorKills: number;
  roadKills: number;
}

export interface Career {
  crafts: Map<string, CraftCareer>;
  /** Most flight time among host crafts. */
  favoriteCraft?: string;
  /** Most player-controlled hostile kills among real weapons. */
  favoriteWeapon?: string;
}

function emptyCraftCareer(): CraftCareer {
  return {
    started: 0, succeeded: 0, failed: 0, objectives: 0, timeFlown: 0, kills: 0, shots: 0, hits: 0, deaths: 0,
    stunnedKills: 0, blindedKills: 0, rotorKills: 0, roadKills: 0,
  };
}

/** Every row's dim values (key split once) with its measures. */
function eachRow<D extends string, M extends string>(c: Cube<D, M>, fn: (dim: (d: D) => string, row: Partial<Record<M, number>>) => void): void {
  const idx = new Map(c.dims.map((d, i) => [d, i]));
  for (const [key, row] of Object.entries(c.rows) as [string, Partial<Record<M, number>>][]) {
    const vals = key.split(KEY_SEP);
    fn((d) => vals[idx.get(d)!] ?? NO_DIM, row);
  }
}

/** Lifetime per-craft summaries and favorites, in one pass over each table. */
export function careerOf(book: StatTables): Career {
  const crafts = new Map<string, CraftCareer>();
  const of = (craft: string) => {
    let c = crafts.get(craft);
    if (!c) crafts.set(craft, (c = emptyCraftCareer()));
    return c;
  };
  eachRow(book.sorties, (dim, r) => {
    // Remotes only log flight time here; a host craft has sorties started.
    if (dim("control") !== PLAYER || !r.started) return;
    const c = of(dim("craft"));
    c.started += r.started ?? 0;
    c.succeeded += r.succeeded ?? 0;
    c.failed += r.failed ?? 0;
    c.objectives += r.objectives ?? 0;
    c.timeFlown += r.timeFlown ?? 0;
  });
  const weaponKills = new Map<string, number>();
  eachRow(book.offense, (dim, r) => {
    const c = crafts.get(dim("craft"));
    const hostile = isHostileEnemy(dim("enemy"));
    const weapon = dim("weapon");
    if (c) {
      c.shots += r.shots ?? 0;
      c.hits += r.hits ?? 0;
      if (hostile) c.kills += r.kills ?? 0;
      if (weapon === ROTOR_KILL) c.rotorKills += r.kills ?? 0;
      else if (weapon === CRUSH_KILL) c.roadKills += r.kills ?? 0;
    }
    if (hostile && r.kills && dim("control") === PLAYER && !NON_WEAPONS.has(weapon)) {
      weaponKills.set(weapon, (weaponKills.get(weapon) ?? 0) + r.kills);
    }
  });
  eachRow(book.defense, (dim, r) => {
    const c = crafts.get(dim("craft"));
    if (c) c.deaths += r.deaths ?? 0;
  });
  eachRow(book.killContext, (dim, r) => {
    const c = crafts.get(dim("craft"));
    if (!c || !isHostileEnemy(dim("enemy"))) return;
    const debuff = dim("debuff");
    if (debuff === "stunned" || debuff === "both") c.stunnedKills += r.kills ?? 0;
    if (debuff === "blinded" || debuff === "both") c.blindedKills += r.kills ?? 0;
  });
  return { crafts, favoriteCraft: argMax(crafts, (c) => c.timeFlown), favoriteWeapon: argMax(weaponKills, (n) => n) };
}

/** Key with the highest positive score (undefined when none). */
function argMax<V>(m: Map<string, V>, score: (v: V) => number): string | undefined {
  let best: string | undefined;
  let bestN = 0;
  for (const [k, v] of m) {
    const n = score(v);
    if (n > bestN) {
      best = k;
      bestN = n;
    }
  }
  return best;
}

/** a / b, or 0 when b is 0 (accuracy = hits / shots, success rate = succeeded / (succeeded + failed)). */
export function ratio(a: number, b: number): number {
  return b > 0 ? a / b : 0;
}

/** True for an offense `enemy` value that is a hostile unit kind (not a neutral civilian, not NO_DIM). */
export function isHostileEnemy(enemy: string): boolean {
  const spec = (UNIT_SPECS as Record<string, { neutral?: boolean } | undefined>)[enemy];
  return !!spec && !spec.neutral;
}

const enemyWeaponKeys = new WeakMap<WeaponSpec, string>();

/** Stable key for an enemy weapon: its catalog id when shared, else its shot look (unit-specific variants). */
export function enemyWeaponKey(w: WeaponSpec): string {
  let key = enemyWeaponKeys.get(w);
  if (key === undefined) enemyWeaponKeys.set(w, (key = ENEMY_WPNS.find((e) => e.w === w)?.id ?? w.look ?? w.kind));
  return key;
}
