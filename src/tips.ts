import type { CraftKind } from "./craft";
import { craftControlScheme, craftOf } from "./craft";
import { craftHasForcedUTurn } from "./heli";
import {
  craftCountermeasure,
  playerLoadoutFromSockets,
  wpnIdOf,
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

/** @deprecated Prefer `TACTICAL_TIPS` + `tipsForKnown`. Flat strings for legacy callers. */
export const LOAD_TIPS: string[] = [];

export const TACTICAL_TIPS: TacticalTip[] = [
  // —— Flight / theater ——
  {
    id: "flight_popup",
    text: "Pop-up (SPACE) to dodge incoming fire — climb, slide, drop back into cover.",
  },
  {
    id: "flight_ridge",
    text: "Use pop-up to clear ridgelines and hit targets tucked behind terrain.",
  },
  {
    id: "flight_noe",
    text: "Nap-of-earth (SHIFT) through ravines and river beds to break enemy line of sight.",
  },
  {
    id: "flight_strafe",
    text: "Diving (SHIFT) is a good way to dodge incoming fire.",
  },
  {
    id: "map_mark",
    text: "M opens the theater map. Mark high-value sites before you commit to a gun run.",
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
    id: "craft_plane",
    text: "Fixed-wing birds need airspeed — don’t stall the turn while lining a gun run.",
    context: {
      forCraft: (c) => craftHasForcedUTurn(craftOf(c)),
    },
  },
  {
    id: "craft_gunship",
    text: "Orbit loiter: W/S trim speed, hold A/D to turn, mouse aims weapons.",
    context: {
      forCraft: (c) => craftControlScheme(craftOf(c)) === "orbit",
    },
  },
  {
    id: "craft_stealth",
    text: "Stealth Hawk cuts spot and chase range — hug the dirt for an extra awareness cut before you EMP or smoke.",
    context: { crafts: ["stealthhawk"] },
  },

  // —— Countermeasures ——
  {
    id: "cm_flares",
    text: "E dumps flares — heat seekers peel off the decoys. Stay mobile while the cloud burns.",
    context: { cms: ["flares"] },
  },
  {
    id: "cm_timewarp",
    text: "Timewarp slows the battlefield. Hit E again to drop out early — cooldown only charges for the time you used.",
    context: { cms: ["timewarp"] },
  },
  {
    id: "cm_cloak",
    text: "Phase Cloak lets rounds pass through you, but primary guns stay dark until it ends — hardpoints still fire. Cancel early with E to save cooldown.",
    context: { cms: ["phase_cloak"] },
  },
  {
    id: "cm_emp",
    text: "EMP stuns mech on screen, drops enemy drones into freefall, and kills airborne missiles. Troops keep moving — finish stunned armor with Whisper or rockets.",
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
    text: "While flying the Spectre, you can still switch weapons and fire from the bird. Q or RMB drops the camera; select Spectre again to return, or LMB in its view to detonate.",
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
    text: "Smoke bombs blind enemy vision and fire range — stack puffs, then push Whisper or close for Tesla.",
    context: { weapons: ["smoke_bomb"] },
  },
  {
    id: "wpn_tesla",
    text: "Tesla stun lingers after the arc leaves — a tap is ~1s; a long cook builds toward several seconds of freeze.",
    context: { weapons: ["tesla_beam"] },
  },
  {
    id: "wpn_refractor",
    text: "Refractor forks about a third of the way to the reticle into child beams — ground hits shatter those into smaller beams in random directions.",
    context: { weapons: ["laser_rocket"] },
  },
  {
    id: "wpn_spider_drone",
    text: "Spider Drones crawl toward the mouse — get them near a hostile and they dash onto it and detonate.",
    context: { weapons: ["spider_drone"] },
  },
  {
    id: "wpn_agv_drop",
    text: "HOUND drops from the rear ramp, then locks to the dirt. Select its slot to take its own loadout HUD (minigun, Photon, Howitzer spot, artillery strike) — same orbit drive as a player craft; F toggles dropship FOLLOW/HOLD (default HOLD); Q exits back to the bird.",
    context: { weapons: ["agv_drop"] },
  },
  {
    id: "wpn_skiff",
    text: "Skiffs are Leviathan’s AI wingmen — launch several (LIVE ×N). They orbit wide, strafe enemies spotted by the airship / Skiffs / Raptor, and Q recalls them all to dock.",
    context: { weapons: ["wingman_drone"] },
  },
  {
    id: "wpn_raptor",
    text: "Raptor is a force-forward fighter with its own POV loadout. Q exits (docks when near the Leviathan). Unpiloted, it escorts like a Skiff; Skiffs idle-orbit a live Raptor.",
    context: { weapons: ["fighter_pod"] },
  },
  {
    id: "wpn_micros",
    text: "Micros gently steer toward the reticle and arc into the ground — walk the pair into soft targets, not heavy armor.",
    context: { weapons: ["guided_rockets"] },
  },
  {
    id: "wpn_starstreak",
    text: "Starstreak is a jittered dart hose — walk the neon stream onto a target and let the bomblets finish the spray.",
    context: { weapons: ["swarm_missile"] },
  },
  {
    id: "wpn_plasma",
    text: "Plasma Helix fires a quick three-round burst — each strand rides a phase-offset helix so they braid with depth.",
    context: { weapons: ["plasma_cannon"] },
  },
  {
    id: "wpn_warp",
    text: "Warp Bomb flies the Spike path — soft-lock, second-click commit. The blast slows time in the pocket while it flies.",
    context: { weapons: ["warp_bomb"] },
  },
  {
    id: "wpn_griffin",
    text: "Griffin is hold-to-steer — walk it onto helis and other movers. Extra effective against air targets.",
    context: { weapons: ["gps_missile"] },
  },
  {
    id: "wpn_maverick",
    text: "Maverick only soft-locks vehicles and buildings — it will not lock air or troops.",
    context: { weapons: ["heavy_guided_missile"] },
  },
  {
    id: "wpn_gps",
    text: "GPS bombs and Pyros latch an aim point on click — designate, release, and don’t babysit the drop.",
    context: { weapons: ["gps_bomb", "light_gps_missile"] },
  },
  {
    id: "wpn_cluster",
    text: "Rockeye’s canister pops ~60% of the way along the drop path — bomblets spray forward along the trajectory. Drop over soft clusters, not single hard points.",
    context: { weapons: ["cluster_bomb"] },
  },
  {
    id: "wpn_hydra",
    text: "Hydras shred soft clusters — dump a ripple into infantry, trucks, and light armor, not dug-in tanks.",
    context: { weapons: ["rocket"] },
  },
  {
    id: "wpn_incendiary",
    text: "Incendiary rockets spray wild — fat fireballs that cook troops and air, not armor. Lead wide and accept the scatter.",
    context: { weapons: ["incendiary_rocket"] },
  },
  {
    id: "wpn_hellfire",
    text: "Hellfires for armor and emplacements — keep the lock box steady, then let them run.",
    context: { weapons: ["hellfire_missile", "mini_hellfire_missile"] },
  },
  {
    id: "wpn_avenger",
    text: "Avenger combat mix is four API and one HEI — commit to the run; every fifth round kicks a real splash.",
    context: { weapons: ["heavy_cannon"] },
  },
  {
    id: "wpn_howitzer",
    text: "Howitzer rounds lob on an arc — lead the fall; don’t expect sniper precision.",
    context: { weapons: ["heavy_artillery"] },
  },
  {
    id: "wpn_artillery_strike",
    text: "Artillery strike: plant the flare and clear out — shells start walking immediately; watch the ETA on the mark.",
    context: { weapons: ["artillery_strike"] },
  },
  {
    id: "wpn_remote_howitzer",
    text: "HOUND’s Howitzer and Artillery Strike both fire the Marauder’s real howitzer and share its ammo — spot is one shell; strike flares then walks the same cannon onto the mark.",
    context: { weapons: ["remote_howitzer", "artillery_strike"] },
  },
  {
    id: "wpn_photon",
    text: "Photon kicks then burns at extreme speed — lock, fire, and let the neon ribbons track the kill.",
    context: { weapons: ["photon_missile"] },
  },

  // —— Enemies / force mix ——
  {
    id: "enemy_infantry",
    text: "Wounded infantry crawl and bleed out if left alone — or finish them before they dig in and return fire.",
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
    text: "Enemy helis orbit and shoot — don’t sit under their ring; pop up, trade, then NOE out.",
    context: { enemies: ["heli", "heli_small", "heli_heavy"] },
  },
  {
    id: "enemy_aa",
    text: "SAMs and AA LAVs own open sky — kill them with stand-off (TOWs, Hellfires) before you linger.",
    context: { enemies: ["lav_aa", "sam", "stinger", "tower"] },
  },
  {
    id: "enemy_tank",
    text: "Tanks shrug small-caliber fire — use Hellfires, Spike, Railgun, or heavy bombs, not mag dumps.",
    context: { forEnemy: (k) => specOf(k).behavior === "orbit_attack_vehicle" },
  },
  {
    id: "enemy_soft_road",
    text: "Trucks, pickups, and bikes flee when they spot you — cut them off early or they’ll scatter into cover.",
    context: { enemies: ["truck", "pickup", "motorcycle", "tanker"] },
  },
  {
    id: "enemy_naval_mix",
    text: "Island Chain means water fights — PT boats and battleships, plus coastal AA. Stay off the deck guns’ noses.",
    context: { forceMixes: ["naval"] },
  },
  {
    id: "enemy_heavy_mix",
    text: "Highland Siege stacks armor and emplacements — plan pop-up shots and don’t cruise over SAMs.",
    context: { forceMixes: ["heavy"] },
  },
];

LOAD_TIPS.push(...TACTICAL_TIPS.map((t) => t.text));
