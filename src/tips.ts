import type { CraftKind } from "./craft";
import { craftOf, craftRotorIsProp } from "./craft";
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
import { isInfantry, specOf, type UnitKind } from "./roster";
import type { WorldGenProfile } from "./world";

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

export const TACTICAL_TIPS: TacticalTip[] = [
  // —— General ——
  {
    id: "obj_hv",
    text: "High-value objectives (HV) are marked distinctly on the map and HUD.",
  },
  // —— Flight / theater ——
  {
    id: "flight_popup",
    text: "Pop-up (SPACE) or dive (SHIFT) to dodge incoming fire.",
  },
  {
    id: "flight_ridge",
    text: "Use pop-up (SHIFT) to clear ridgelines and hit targets tucked behind terrain.",
  },
  {
    id: "flight_noe",
    text: "Nap-of-earth (SHIFT) through ravines and river beds to break enemy line of sight.",
  },
  {
    id: "laser_sight",
    text: "Watch your laser sight — it shows where rounds will land, and clips on terrain before they do.",
  },
  {
    id: "crew_auto",
    text: "Automatic crew guns track on their own — select their slot (1–5) to take the stick and fire yourself.",
    context: {
      forCraft: (c) => craftOf(c).sockets.some((s) => s.controller === "automatic"),
    },
  },
  {
    id: "craft_stealth",
    text: "Stealth Hawk cuts spot and chase range — hug the dirt for an extra awareness cut before you EMP or smoke.",
    context: { crafts: ["stealthhawk"] },
  },
  {
    id: "craft_low_profile",
    text: "Hovering low to the ground (SHIFT) reduces your visibility to enemy radar and line-of-sight weapons.",
    context: {
      forCraft: (c) => craftOf(c).flightModel === "heli"
    }
  },
  {
    id: "roadkill_rotor",
    text: "Flying low enough for the rotor disc to reach standing troops will mow them down.",
    context: {
      forCraft: (c) => craftOf(c).flightModel === "heli" && !!craftOf(c).rotor && !craftRotorIsProp(craftOf(c)),
    },
  },
  {
    id: "roadkill_hull",
    text: (t) => `${t.craftNames} kills infantry just by driving over them.`,
    context: { forCraft: (c) => !!craftOf(c).crushesInfantry },
  },

  // —— Countermeasures ——
  {
    id: "cm_flares",
    text: "Flares redirect heat seekers. Stay mobile while the cloud burns.",
    context: { cms: ["flares"] },
  },
  {
    id: "cm_timewarp",
    text: "Timewarp slows the battlefield. You can exit and resume at will.",
    context: { cms: ["timewarp"] },
  },
  {
    id: "cm_cloak",
    text: "Phase Cloak lets rounds pass through you, but primary guns stay dark until it ends — hardpoints still fire. You can enter and exit cloaking at will.",
    context: { cms: ["phase_cloak"] },
  },
  {
    id: "cm_emp",
    text: "EMP stuns mech on screen, drops enemy drones into freefall, and kills airborne missiles.",
    context: { cms: ["emp"] },
  },
  {
    id: "cm_reactive_armor",
    text: "Reactive Armor cuts incoming damage to a fraction for its duration — pop it before you eat a hit you can't dodge.",
    context: { cms: ["reactive_armor"] },
  },
  {
    id: "cm_smoke_screen",
    text: "Smoke Screen blinds nearby gun lines and cuts their range — lay it and keep moving through the cloud.",
    context: { cms: ["smoke_screen"] },
  },

  // —— Special weapon behavior / tactics ——
  {
    id: "wpn_anti_armor",
    text: (t) => `${t.weaponNames} ${t.weapons.length > 1 ? "tear" : "tears"} into vehicles and buildings — troops take a lot less of the hit.`,
    context: {
      forWeapon: (w) => {
        const d = wpnOf(w).dmgMul;
        return !!d && (d.vehicle ?? 1) > 1 && (d.building ?? 1) > 1 && (d.troop ?? 1) < 1;
      },
    },
  },
  {
    id: "wpn_anti_air",
    text: (t) => `Airborne targets are where ${t.weaponNames} really ${t.weapons.length > 1 ? "shine" : "shines"} — vehicles take noticeably less damage.`,
    context: {
      forWeapon: (w) => {
        const d = wpnOf(w).dmgMul;
        return !!d && (d.air ?? 1) > 1 && (d.vehicle ?? 1) < 1;
      },
    },
  },
  {
    id: "wpn_anti_soft",
    text: (t) => `${t.weaponNames} ${t.weapons.length > 1 ? "cut" : "cuts"} down infantry fast, but armor eats a lot more of the impact.`,
    context: {
      forWeapon: (w) => {
        const d = wpnOf(w).dmgMul;
        return !!d && (d.troop ?? 1) > 1 && (d.vehicle ?? 1) < 1;
      },
    },
  },
  {
    id: "wpn_penetration",
    text: (t) => `${t.weaponNames} punches through — line up a row of infantry or light vehicles and let one shot walk the whole file.`,
    // Sub-1 penetration is armor-effectiveness flavor only; the shot needs a whole
    // point to survive a hit and continue (missionScene pierce check: `pierce >= 1`).
    context: { forWeapon: (w) => (wpnOf(w).payload.penetration ?? 0) >= 1 },
  },
  {
    id: "wpn_guided_lock",
    text: (t) => `Hold the lock box on target with ${t.weaponNames} until it locks, then look elsewhere — it flies itself in from there.`,
    context: { forWeapon: (w) => wpnOf(w).guidance?.targeting.mode === "lock_on" },
  },
  {
    id: "wpn_guided_wire",
    text: (t) => `Fire ${t.weaponNames} and it curves toward your cursor for the whole flight — there's no ballistic mode, just keep aiming.`,
    context: { forWeapon: (w) => wpnOf(w).guidance?.targeting.mode === "steer" },
  },
  {
    id: "wpn_guided_commit",
    text: (t) => `Soft-lock with ${t.weaponNames}, then commit the dive with a second click — keep it honest before you send it.`,
    context: { forWeapon: (w) => wpnOf(w).guidance?.targeting.mode === "steer_commit" },
  },
  {
    id: "wpn_guided_waypoint",
    text: (t) => `Click a ground point for ${t.weaponNames} and it steers itself there on the way down.`,
    context: { forWeapon: (w) => wpnOf(w).guidance?.targeting.mode === "waypoint" },
  },
  {
    id: "wpn_remote_general",
    text: (t) => `Piloting ${t.weaponNames}? Q always drops you back to the host aircraft. Left alone, autonomous remotes fight and return to the bay on their own.`,
    context: { forWeapon: (w) => !!wpnOf(w).payload.remote },
  },
  {
    id: "wpn_whisper",
    text: "Stunned or smoke-blinded enemies take extra damage from Whisper — EMP or smoke first, then hose them.",
    context: { weapons: ["concealed_cannon"] },
  },
  {
    id: "wpn_sidewinder",
    text: "Sidewinders lock ground and air, but deal far more damage to aircraft — save FOX-2 for helis and jets.",
    context: { weapons: ["sidewinder_missile"] },
  },
  {
    id: "wpn_spectre",
    text: "While observing the enemy from the Spectre you can switch to heli weapons and fire from a distance.",
    context: { weapons: ["attack_drone"] },
  },
  {
    id: "wpn_tow_height",
    text: "While a TOW is in flight, SPACE raises the missile and SHIFT drops it — steer height as well as aim.",
    context: { weapons: ["tow_missile"] },
  },
  {
    id: "wpn_tow_aa",
    text: "TOWs are ideal for killing AA from outside their envelope — stay long and wire-guide in.",
    context: {
      weapons: ["tow_missile"],
      enemies: ["lav_aa", "sam", "stinger", "tower"],
    },
  },
  {
    id: "wpn_smoke",
    text: "Smoke bombs blind enemy vision and fire range, and amplify damage from Whisper rounds.",
    context: { weapons: ["smoke_bomb"] },
  },
  {
    id: "wpn_tesla",
    text: "Tesla stun lingers after the arc leaves.",
    context: { weapons: ["tesla_beam"] },
  },
  {
    id: "wpn_agv_aa",
    text: "HOUND runs under the AA envelope — SAMs and AA guns will not target the ground pod.",
    context: { weapons: ["agv_drop"] },
  },
  {
    id: "wpn_skiff",
    text: "Skiffs auto-launch from the Leviathan when enemies enter awareness. They share observations and follow the Airship or Raptor.",
    context: { weapons: ["wingman_drone"] },
  },
  {
    id: "wpn_raptor",
    text: "Skiffs follow the Raptor when in flight.",
    context: { weapons: ["fighter_pod"] },
  },
  {
    id: "wpn_warp",
    text: "The Warp Bomb nearly stops time while in flight.",
    context: { weapons: ["warp_bomb"] },
  },
  {
    id: "wpn_griffin",
    text: "Griffin does extra work against aircraft — prioritize helis and jets whenever you've got the lock.",
    context: { weapons: ["gps_missile"] },
  },
  {
    id: "wpn_maverick",
    text: "Maverick will only lock vehicles and buildings — don't waste time trying it on aircraft or troops.",
    context: { weapons: ["heavy_guided_missile"] },
  },
  {
    id: "bomb_drop",
    text: "Bombs drop with an arc, inheriting the velocity of the aircraft with limited range.",
    context: {
      // Only bomb-drop-style weapons — excludes agv_drop (vehicle deploy, not ordnance).
      forWeapon: (w) => wpnOf(w).launch.mode === "drop" && !wpnOf(w).payload.remote,
    },
  },
  {
    id: "wpn_hydra",
    text: "Hydras are pound for pound one of the best weapons for quickly shredding clusters of enemies.",
    context: { weapons: ["rocket"] },
  },
  {
    id: "wpn_hellfire",
    text: "Hellfires can hit both air and ground, but they're built for armor and emplacements — save them for the tough stuff.",
    context: { weapons: ["hellfire_missile", "mini_hellfire_missile"] },
  },
  {
    id: "wpn_avenger",
    text: "The Avenger cannon fires 1 HE round for every 4 AP rounds, shredding whatever your heart desires.",
    context: { weapons: ["heavy_cannon"] },
  },
  {
    id: "wpn_howitzer",
    text: "Howitzer rounds lob on an arc — lead the fall; don’t expect sniper precision.",
    context: { weapons: ["heavy_artillery"] },
  },
  {
    id: "wpn_remote_howitzer",
    text: "HOUND’s Howitzer and Artillery Strike both fire the Marauder’s howitzer. Sneak up with the HOUND and bombard from a safe distance.",
    context: { weapons: ["remote_howitzer", "artillery_strike"] },
  },
  {
    id: "wpn_photon",
    text: "Photon missiles are both gorgeous, and they never miss.",
    context: { weapons: ["photon_missile"] },
  },

  // —— Enemies / force mix ——
  {
    id: "enemy_infantry",
    text: "Wounded infantry crawl and bleed out — finish them before they dig in and return fire.",
    context: { forEnemy: isInfantry },
  },
  {
    id: "enemy_battleship",
    text: "Battleships pack mixed batteries. Prioritize the AA mount before you linger overhead.",
    context: { enemies: ["battleship"] },
  },
  {
    id: "enemy_drone",
    text: "Drones charge when lined up. Sidestep the run, then hit them while they turn.",
    context: { enemies: ["drone"] },
  },
  {
    id: "enemy_heli",
    text: "Enemy helis orbit and shoot guns and missiles.",
    context: { enemies: ["heli", "heli_small", "heli_heavy"] },
  },
  {
    id: "enemy_aa",
    text: "SAMs and AA LAVs guard the open sky — kill them with stand-off (TOWs, Hellfires) or sneak up using terrain coverage.",
    context: { enemies: ["lav_aa", "sam", "stinger", "tower"] },
  },
  {
    id: "enemy_tank",
    text: (t) => `${t.enemyNames} shrug small-caliber fire — use Hellfires, Spike, Railgun, or heavy bombs, not mag dumps.`,
    context: { forEnemy: (k) => specOf(k).behavior === "orbit_attack_vehicle" },
  },
  {
    id: "enemy_soft_road",
    text: "Trucks, pickups, and bikes flee when they spot you — take them out before they can escape.",
    context: { enemies: ["truck", "pickup", "motorcycle", "tanker"] },
  },
];
