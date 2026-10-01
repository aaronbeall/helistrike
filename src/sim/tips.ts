import type { CraftKind } from "./crafts";
import { craftOf } from "./crafts";
import {
  COUNTERMEASURES,
  craftCountermeasure,
  playerLoadoutFromSockets,
  wpnIdOf,
  wpnOf,
  type CountermeasureId,
  type WpnId,
} from "./combat";
import { missionOf } from "./mission";
import { specOf, type UnitKind } from "./roster";
import type { WorldGenProfile } from "../worldgen/world";
import { TACTICAL_TIPS } from "../catalog/tips";
export { wpnGuidedFamily, wpnIsAntiArmor, wpnIsAntiAir, wpnIsAntiSoft, wpnPierces, wpnIsBombDrop, wpnIsRemoteDeploy, type GuidedFamily } from "./weaponTags";
export { TACTICAL_TIPS } from "../catalog/tips";

export type ForceMix = WorldGenProfile["forceMix"];

/**
 * Whitelists of existing ids + optional per-item checkers.
 * Filtering only drops a tip when a tip field and matching context field
 * are both present and fail (no whitelist overlap / no checker pass).
 */
export interface TipContext {
  weapons?: WpnId[];
  crafts?: CraftKind[];
  enemies?: UnitKind[];
  cms?: CountermeasureId[];
  forceMixes?: ForceMix[];
  forWeapon?: (weapon: WpnId) => boolean;
  forCraft?: (craft: CraftKind) => boolean;
  forEnemy?: (enemy: UnitKind) => boolean;
  forCm?: (cm: CountermeasureId) => boolean;
  forForceMix?: (mix: ForceMix) => boolean;
}

/**
 * Args passed to a `text` callback: the ids that actually matched this tip's
 * context for the current screen (whitelist overlap ∪ predicate hits), pre-joined
 * into readable names, plus `list` to format a custom subset the same way.
 */
export interface TipArgs {
  weapons: readonly WpnId[];
  crafts: readonly CraftKind[];
  enemies: readonly UnitKind[];
  cms: readonly CountermeasureId[];
  /** Matched weapon names, e.g. "Chain Gun", "Chain Gun and Sidewinder". */
  weaponNames: string;
  craftNames: string;
  enemyNames: string;
  cmNames: string;
  /** "X" / "X and Y" / "X, Y, and Z" — for a caller-picked subset of names. */
  list(names: readonly string[]): string;
}

export interface TacticalTip {
  id: string;
  text: string | ((args: TipArgs) => string);
  context?: TipContext;
}

/** Known facts for the current screen / mission. Omit a field to skip that filter. */
export interface TipKnown {
  weapons?: readonly WpnId[];
  crafts?: readonly CraftKind[];
  enemies?: readonly UnitKind[];
  cms?: readonly CountermeasureId[];
  forceMixes?: readonly ForceMix[];
}

function dimOk<T>(
  tipList: readonly T[] | undefined,
  tipCheck: ((x: T) => boolean) | undefined,
  have: readonly T[] | undefined
): boolean {
  if (have == null || have.length === 0) return true;
  if (tipList != null && tipList.length > 0 && !tipList.some((id) => have.includes(id))) {
    return false;
  }
  if (tipCheck && !have.some(tipCheck)) return false;
  return true;
}

/** Items from `have` this tip's context actually keys on (whitelist ∪ predicate hits). */
function dimMatched<T>(
  tipList: readonly T[] | undefined,
  tipCheck: ((x: T) => boolean) | undefined,
  have: readonly T[] | undefined
): T[] {
  if (have == null || (tipList == null && tipCheck == null)) return [];
  return have.filter((x) => (tipList?.includes(x) ?? false) || !!tipCheck?.(x));
}

/** "X" / "X and Y" / "X, Y, and Z". */
function listNames(names: readonly string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

/** Catalog rows use HUD-style ALL CAPS names — title-case for prose, keep known acronyms. */
const NAME_ACRONYMS = new Set(["AA", "EMP", "FOB", "HE", "JDAM", "LAV", "LMG", "MG", "MOAB", "PT", "RPG", "SAM", "TOW"]);
function prettyName(raw: string): string {
  return raw
    .split(" ")
    .map((word) =>
      word
        .split("-")
        .map((tok) => (NAME_ACRONYMS.has(tok) ? tok : tok.charAt(0) + tok.slice(1).toLowerCase()))
        .join("-")
    )
    .join(" ");
}

function tipArgs(tip: TacticalTip, known: TipKnown): TipArgs {
  const t = tip.context ?? {};
  const weapons = dimMatched(t.weapons, t.forWeapon, known.weapons);
  const crafts = dimMatched(t.crafts, t.forCraft, known.crafts);
  const enemies = dimMatched(t.enemies, t.forEnemy, known.enemies);
  const cms = dimMatched(t.cms, t.forCm, known.cms);
  return {
    weapons,
    crafts,
    enemies,
    cms,
    weaponNames: listNames(weapons.map((id) => prettyName(wpnOf(id).name))),
    craftNames: listNames(crafts.map((id) => craftOf(id).name)),
    enemyNames: listNames(enemies.map((id) => prettyName(specOf(id).label))),
    cmNames: listNames(cms.map((id) => prettyName(COUNTERMEASURES[id].name))),
    list: listNames,
  };
}

/** Resolve a tip's display text for the current screen (runs `text` callbacks). */
export function tipText(tip: TacticalTip, known: TipKnown): string {
  return typeof tip.text === "function" ? tip.text(tipArgs(tip, known)) : tip.text;
}

export function tipMatches(tip: TacticalTip, known: TipKnown): boolean {
  const t = tip.context ?? {};
  return (
    dimOk(t.weapons, t.forWeapon, known.weapons) &&
    dimOk(t.crafts, t.forCraft, known.crafts) &&
    dimOk(t.enemies, t.forEnemy, known.enemies) &&
    dimOk(t.cms, t.forCm, known.cms) &&
    dimOk(t.forceMixes, t.forForceMix, known.forceMixes)
  );
}

export function tipsForKnown(known: TipKnown, catalog: readonly TacticalTip[] = TACTICAL_TIPS): TacticalTip[] {
  return catalog.filter((tip) => tipMatches(tip, known));
}

/**
 * Tips explicitly scoped to this weapon (whitelist or `forWeapon` matched it) —
 * unlike `tipsForKnown`, generic tips with no weapon context are excluded rather
 * than passing vacuously. For a weapon's own "related tips" list.
 */
export function tipsForWeapon(id: WpnId, catalog: readonly TacticalTip[] = TACTICAL_TIPS): TacticalTip[] {
  return catalog.filter((tip) => !!tip.context?.weapons?.includes(id) || !!tip.context?.forWeapon?.(id));
}

/** Role / fantasy description for a countermeasure (tips carry the mechanics). */
export function cmDescription(id: CountermeasureId): string {
  return COUNTERMEASURES[id].description;
}

/** Selection + mission profile. Pass `enemies` only when kinds are known. */
export function tipKnownFromSelection(enemies?: readonly UnitKind[]): TipKnown {
  const craft = craftOf();
  const mission = missionOf();
  return {
    crafts: [craft.kind],
    weapons: playerLoadoutFromSockets(craft.sockets).map(wpnIdOf),
    cms: [craftCountermeasure(craft.countermeasure)],
    forceMixes: [mission.profile.forceMix],
    enemies: enemies?.length ? enemies : undefined,
  };
}

export function pickRandomTip(known: TipKnown, catalog: readonly TacticalTip[] = TACTICAL_TIPS): TacticalTip {
  const pool = tipsForKnown(known, catalog);
  const list = pool.length ? pool : catalog.filter((t) => !t.context || Object.keys(t.context).length === 0);
  return list[(Math.random() * list.length) | 0] ?? catalog[0]!;
}
