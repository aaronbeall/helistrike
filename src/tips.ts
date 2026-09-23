import type { CraftKind } from "./craft";
import { craftOf } from "./craft";
import {
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

export interface TacticalTip {
  id: string;
  text: string;
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

  // —— Special weapon behavior / tactics ——
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
    id: "wpn_spike",
    text: "Spike soft-locks, then a second click commits the dive — keep the diamond honest before you send it.",
    context: { weapons: ["tv_missile"] },
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
    id: "wpn_micros",
    text: "Micros gently steer toward the reticle and arc into the ground.",
    context: { weapons: ["guided_rockets"] },
  },
  {
    id: "wpn_warp",
    text: "The Warp Bomb nearly stops time while in flight.",
    context: { weapons: ["warp_bomb"] },
  },
  {
    id: "wpn_griffin",
    text: "Griffin Missiles are hold-to-steer. Extra effective against air targets.",
    context: { weapons: ["gps_missile"] },
  },
  {
    id: "wpn_maverick",
    text: "Maverick Missiles only locks vehicles and buildings — it will not lock air or troops.",
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
    text: "Hellfires can target both air and ground, but are ideal for armor and emplacements — lock, fire, and forget.",
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
    text: "Photon Missiles are both beautiful and never misses.",
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
    text: "Tanks shrug small-caliber fire — use Hellfires, Spike, Railgun, or heavy bombs, not mag dumps.",
    context: { forEnemy: (k) => specOf(k).behavior === "orbit_attack_vehicle" },
  },
  {
    id: "enemy_soft_road",
    text: "Trucks, pickups, and bikes flee when they spot you — take them out before they can escape.",
    context: { enemies: ["truck", "pickup", "motorcycle", "tanker"] },
  },
];
