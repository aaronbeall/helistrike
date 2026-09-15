import type { CraftKind } from "./craft";
import { craftOf } from "./craft";
import {
  craftCountermeasure,
  playerLoadoutFromSockets,
  type CountermeasureId,
  type WpnId,
} from "./combat";
import { missionOf } from "./mission";
import type { UnitKind } from "./roster";
import type { WorldGenProfile } from "./world";

/** Broad enemy buckets for tip filtering when exact kinds are unknown. */
export type EnemyGroup = "armor" | "soft" | "aa" | "air" | "naval" | "infantry" | "static";

/** Cross-cutting game systems (not a specific weapon / craft). */
export type MechanicId =
  | "flight"
  | "map"
  | "laser"
  | "lock"
  | "smoke"
  | "stun"
  | "ammo"
  | "crew";

export type TipTag =
  | { kind: "global" }
  | { kind: "weapon"; weapons: WpnId[] }
  | { kind: "craft"; crafts: CraftKind[] }
  | { kind: "cm"; cms: CountermeasureId[] }
  | { kind: "enemy"; enemies: UnitKind[] }
  | { kind: "enemyGroup"; groups: EnemyGroup[] }
  | { kind: "forceMix"; mixes: WorldGenProfile["forceMix"][] }
  | { kind: "mechanic"; mechanics: MechanicId[] };

export interface TacticalTip {
  id: string;
  text: string;
  /** Empty / only `global` → always eligible. Otherwise eligible if any tag matches context. */
  tags: TipTag[];
}

export interface TipContext {
  craft?: CraftKind;
  weapons?: readonly WpnId[];
  countermeasure?: CountermeasureId;
  forceMix?: WorldGenProfile["forceMix"];
  /** Known or likely enemy kinds for this mission. */
  enemies?: readonly UnitKind[];
}

const ENEMY_GROUPS: Record<EnemyGroup, readonly UnitKind[]> = {
  armor: ["tank", "lav"],
  soft: ["pickup", "truck", "tanker", "motorcycle", "tent", "barn"],
  aa: ["lav_aa", "sam", "stinger", "tower"],
  air: ["drone", "heli", "heli_small", "heli_heavy"],
  naval: ["boat", "ptboat", "battleship"],
  infantry: ["soldier", "rpg", "gunner", "mounted_mg", "stinger", "mechanic", "officer"],
  static: ["tower", "bunker", "radar", "lookout", "fob", "sam", "barn", "tent"],
};

/** Kinds a force mix is likely to spawn (for load-screen tips before the map exists). */
export function enemiesLikelyForForceMix(mix: WorldGenProfile["forceMix"]): UnitKind[] {
  if (mix === "heavy") {
    return [
      "tank",
      "lav",
      "lav_aa",
      "sam",
      "tower",
      "truck",
      "soldier",
      "rpg",
      "gunner",
      "stinger",
    ];
  }
  if (mix === "naval") {
    return [
      "battleship",
      "ptboat",
      "boat",
      "lav_aa",
      "pickup",
      "motorcycle",
      "lookout",
      "drone",
      "heli",
      "heli_small",
      "heli_heavy",
      "soldier",
      "gunner",
      "stinger",
    ];
  }
  return [
    "tank",
    "lav",
    "lav_aa",
    "sam",
    "pickup",
    "motorcycle",
    "truck",
    "tanker",
    "tower",
    "lookout",
    "drone",
    "heli",
    "heli_small",
    "heli_heavy",
    "boat",
    "ptboat",
    "battleship",
    "soldier",
    "rpg",
    "gunner",
    "mounted_mg",
    "stinger",
    "officer",
    "tent",
    "barn",
  ];
}

function enemyGroupOf(kind: UnitKind): EnemyGroup[] {
  const out: EnemyGroup[] = [];
  for (const [group, kinds] of Object.entries(ENEMY_GROUPS) as [EnemyGroup, readonly UnitKind[]][]) {
    if (kinds.includes(kind)) out.push(group);
  }
  return out;
}

function tagMatches(tag: TipTag, ctx: TipContext): boolean {
  if (tag.kind === "global") return true;
  if (tag.kind === "weapon") {
    const have = ctx.weapons ?? [];
    return tag.weapons.some((id) => have.includes(id));
  }
  if (tag.kind === "craft") {
    return !!ctx.craft && tag.crafts.includes(ctx.craft);
  }
  if (tag.kind === "cm") {
    return !!ctx.countermeasure && tag.cms.includes(ctx.countermeasure);
  }
  if (tag.kind === "enemy") {
    const have = ctx.enemies ?? [];
    return tag.enemies.some((k) => have.includes(k));
  }
  if (tag.kind === "enemyGroup") {
    const have = ctx.enemies ?? [];
    const present = new Set(have.flatMap(enemyGroupOf));
    return tag.groups.some((g) => present.has(g));
  }
  if (tag.kind === "forceMix") {
    return !!ctx.forceMix && tag.mixes.includes(ctx.forceMix);
  }
  if (tag.kind === "mechanic") {
    return false;
  }
  return false;
}

/** Tip is shown if global, mechanic-only, or any concrete (non-mechanic) tag matches. */
export function tipMatches(tip: TacticalTip, ctx: TipContext): boolean {
  if (!tip.tags.length) return true;
  if (tip.tags.some((t) => t.kind === "global")) return true;
  const concrete = tip.tags.filter((t) => t.kind !== "mechanic");
  // Mechanic-only tips are always-on systems help (flight, map, laser, …).
  if (!concrete.length) return true;
  return concrete.some((t) => tagMatches(t, ctx));
}

export function tipsForContext(ctx: TipContext, catalog: readonly TacticalTip[] = TACTICAL_TIPS): TacticalTip[] {
  return catalog.filter((tip) => tipMatches(tip, ctx));
}

export function tipContextFromSelection(enemies?: readonly UnitKind[]): TipContext {
  const craft = craftOf();
  const mission = missionOf();
  return {
    craft: craft.kind,
    weapons: playerLoadoutFromSockets(craft.sockets).map((w) => w.id),
    countermeasure: craftCountermeasure(craft.countermeasure),
    forceMix: mission.profile.forceMix,
    enemies: enemies ?? enemiesLikelyForForceMix(mission.profile.forceMix),
  };
}

export function pickRandomTip(ctx: TipContext, catalog: readonly TacticalTip[] = TACTICAL_TIPS): TacticalTip {
  const pool = tipsForContext(ctx, catalog);
  const list = pool.length ? pool : catalog.filter((t) => t.tags.some((x) => x.kind === "global"));
  return list[(Math.random() * list.length) | 0] ?? catalog[0]!;
}

/** @deprecated Prefer `TACTICAL_TIPS` + `tipsForContext`. Flat strings for legacy callers. */
export const LOAD_TIPS: string[] = [];

export const TACTICAL_TIPS: TacticalTip[] = [
  // —— Global / flight / map ——
  {
    id: "flight_popup",
    text: "Pop-up (SPACE) to dodge incoming fire — climb, slide, drop back into cover.",
    tags: [{ kind: "global" }, { kind: "mechanic", mechanics: ["flight"] }],
  },
  {
    id: "flight_ridge",
    text: "Use pop-up to clear ridgelines and hit targets tucked behind terrain.",
    tags: [{ kind: "global" }, { kind: "mechanic", mechanics: ["flight"] }],
  },
  {
    id: "flight_noe",
    text: "Nap-of-earth (SHIFT) through ravines and river beds to break enemy line of sight.",
    tags: [{ kind: "global" }, { kind: "mechanic", mechanics: ["flight"] }],
  },
  {
    id: "flight_strafe",
    text: "Strafe (A/D) and rise or dive (SPACE/SHIFT) both throw off enemy aim — don’t sit still under fire.",
    tags: [{ kind: "global" }, { kind: "mechanic", mechanics: ["flight"] }],
  },
  {
    id: "flight_low_quiet",
    text: "Low and slow is quiet until it isn’t — pop up only for the shot, then get back in the dirt.",
    tags: [{ kind: "global" }, { kind: "mechanic", mechanics: ["flight"] }],
  },
  {
    id: "map_mark",
    text: "M opens the theater map. Mark high-value sites before you commit to a gun run.",
    tags: [{ kind: "global" }, { kind: "mechanic", mechanics: ["map"] }],
  },
  {
    id: "laser_sight",
    text: "Watch your laser sight — it shows where rounds will land, and clips on terrain before they do.",
    tags: [{ kind: "mechanic", mechanics: ["laser"] }],
  },
  {
    id: "crew_auto",
    text: "Automatic crew guns track on their own — select their slot to take the stick and fire yourself.",
    tags: [{ kind: "mechanic", mechanics: ["crew"] }],
  },

  // —— Countermeasures ——
  {
    id: "cm_flares",
    text: "E dumps flares — heat seekers peel off the decoys. Stay mobile while the cloud burns.",
    tags: [{ kind: "cm", cms: ["flares"] }],
  },
  {
    id: "cm_timewarp",
    text: "Timewarp slows the battlefield. Hit E again to drop out early — cooldown only charges for the time you used.",
    tags: [{ kind: "cm", cms: ["timewarp"] }, { kind: "craft", crafts: ["cyberhawk"] }],
  },
  {
    id: "cm_cloak",
    text: "Phase Cloak lets rounds pass through you, but you cannot shoot until it ends. Cancel early with E to save cooldown.",
    tags: [{ kind: "cm", cms: ["phase_cloak"] }, { kind: "craft", crafts: ["prometheus"] }],
  },
  {
    id: "cm_emp",
    text: "EMP stuns mech on screen and kills airborne missiles. Troops keep moving — finish stunned armor with Low-RCS or rockets.",
    tags: [{ kind: "cm", cms: ["emp"] }, { kind: "mechanic", mechanics: ["stun"] }],
  },

  // —— Craft-unique ——
  {
    id: "craft_stealthhawk",
    text: "Stealth Hawk cuts enemy spot and chase range — hug the dirt for an extra awareness cut, then EMP and smoke to set up Low-RCS.",
    tags: [{ kind: "craft", crafts: ["stealthhawk"] }],
  },
  {
    id: "craft_cyberhawk",
    text: "Cyber Hawk pairs a paced Railgun with Starstreak hose and a long Tesla coil — Timewarp buys aim time on tough targets.",
    tags: [{ kind: "craft", crafts: ["cyberhawk"] }],
  },
  {
    id: "craft_murder_drone",
    text: "Murder Drone is tiny and twitchy — short Tesla reach, EMP on E, and mini Hellfires for punch when the coil won’t reach.",
    tags: [{ kind: "craft", crafts: ["quad_drone"] }],
  },
  {
    id: "craft_prometheus",
    text: "Prometheus Phase Cloak is a panic button, not a gun run — cloak, reposition, decloak, then dump ordnance.",
    tags: [{ kind: "craft", crafts: ["prometheus"] }],
  },
  {
    id: "craft_apache",
    text: "Apache is the heavy gunship — Chain Gun for soft, Hydras for clusters, Hellfires and Spike for armor.",
    tags: [{ kind: "craft", crafts: ["apache"] }],
  },
  {
    id: "craft_cobra",
    text: "Cobra is the classic hot-rod — fat Hydras, Sidewinders, and TOW wire work. Fast and thin; don’t trade blows.",
    tags: [{ kind: "craft", crafts: ["cobra"] }],
  },
  {
    id: "craft_viper",
    text: "Viper keeps Cobra’s TOW feel and adds Hellfires — near-Cobra agility with real AT punch.",
    tags: [{ kind: "craft", crafts: ["viper"] }],
  },
  {
    id: "craft_little_bird",
    text: "Little Bird is a knife fighter — miniguns shred soft targets; don’t trade with SAMs at altitude.",
    tags: [{ kind: "craft", crafts: ["little_bird"] }],
  },
  {
    id: "craft_chinook",
    text: "Chinook crew guns cover the doors — fly the ship, let gunners hose the flanks.",
    tags: [{ kind: "craft", crafts: ["chinook"] }, { kind: "mechanic", mechanics: ["crew"] }],
  },
  {
    id: "craft_blackhawk",
    text: "Black Hawk brings door guns and pods — keep altitude honest or AA will walk tracers into the cabin.",
    tags: [{ kind: "craft", crafts: ["blackhawk"] }],
  },
  {
    id: "craft_gunship",
    text: "Gunship flies the orbit — W/S trim speed, A/D hold to turn, mouse aims the side guns.",
    tags: [{ kind: "craft", crafts: ["gunship"] }],
  },
  {
    id: "craft_plane",
    text: "Fixed-wing birds need airspeed — don’t stall the turn while lining a gun run.",
    tags: [{ kind: "craft", crafts: ["lightning_ii", "warthog"] }],
  },

  // —— Guns ——
  {
    id: "wpn_chain",
    text: "Chain gun eats soft targets; save rockets and missiles for armor and emplacements.",
    tags: [{ kind: "weapon", weapons: ["chain_gun"] }, { kind: "enemyGroup", groups: ["soft", "infantry"] }],
  },
  {
    id: "wpn_minigun",
    text: "Minigun is pure volume — walk the stream across soft clusters and don’t waste it on heavy armor.",
    tags: [{ kind: "weapon", weapons: ["minigun"] }, { kind: "enemyGroup", groups: ["soft", "infantry"] }],
  },
  {
    id: "wpn_gatling",
    text: "20mm Gatling snaps flat and fast — ideal for shredding light vehicles and infantry before they dig in.",
    tags: [{ kind: "weapon", weapons: ["gatling"] }],
  },
  {
    id: "wpn_mg",
    text: "Door / cabin machine guns are volume tools — keep the nose honest and let the hose do the work.",
    tags: [{ kind: "weapon", weapons: ["machine_gun", "heavy_machine_gun"] }],
  },
  {
    id: "wpn_heavy_cal",
    text: "Heavy cal pods throw readable slugs — walk them onto soft armor and trucks, not main battle tanks.",
    tags: [{ kind: "weapon", weapons: ["heavy_cal_pod"] }],
  },
  {
    id: "wpn_low_rcs",
    text: "Low-RCS hits harder on stunned or smoke-blinded targets — EMP or smoke first, then hose the deafened mech.",
    tags: [
      { kind: "weapon", weapons: ["concealed_cannon"] },
      { kind: "mechanic", mechanics: ["stun", "smoke"] },
    ],
  },
  {
    id: "wpn_railgun",
    text: "Railgun is paced penetrator fire — line the shot, punch armor, let Starstreak or Tesla finish soft escorts.",
    tags: [{ kind: "weapon", weapons: ["railgun"] }, { kind: "enemyGroup", groups: ["armor"] }],
  },
  {
    id: "wpn_plasma",
    text: "Plasma Helix fires a quick three-round burst — each strand rides a phase-offset helix so they braid with depth.",
    tags: [{ kind: "weapon", weapons: ["plasma_cannon"] }],
  },
  {
    id: "wpn_tesla",
    text: "Tesla stun lingers after the arc leaves — a tap is ~1s, a long cook builds toward several seconds of freeze.",
    tags: [{ kind: "weapon", weapons: ["tesla_beam"] }, { kind: "mechanic", mechanics: ["stun"] }],
  },
  {
    id: "wpn_tesla_cyber",
    text: "Cyber Hawk Tesla reaches far — paint ARC on a target and hold fire; the barrel heats while the coil cooks them.",
    tags: [
      { kind: "weapon", weapons: ["tesla_beam"] },
      { kind: "craft", crafts: ["cyberhawk"] },
    ],
  },
  {
    id: "wpn_tesla_murder",
    text: "Murder Drone Tesla is point-blank — close the gap, lock ARC, and don’t waste ammo into empty air past the envelope.",
    tags: [
      { kind: "weapon", weapons: ["tesla_beam"] },
      { kind: "craft", crafts: ["quad_drone"] },
    ],
  },
  {
    id: "wpn_medium_gatling",
    text: "Equalizer SAPHEI punches and pops — hold the gun run and watch the dusty HE bite on soft targets.",
    tags: [{ kind: "weapon", weapons: ["medium_gatling_cannon"] }],
  },
  {
    id: "wpn_medium_cannon",
    text: "Medium cannon is a paced explosive slap — good vs light armor when missiles are dry.",
    tags: [{ kind: "weapon", weapons: ["medium_cannon"] }],
  },
  {
    id: "wpn_light_cannon",
    text: "Light cannon lob 105mm arcs — lead the fall and don’t expect sniper precision.",
    tags: [{ kind: "weapon", weapons: ["light_cannon", "heavy_artillery"] }],
  },
  {
    id: "wpn_heavy_cannon",
    text: "Avenger combat mix is four API and one HEI — commit to the run; every fifth round kicks up a real splash.",
    tags: [{ kind: "weapon", weapons: ["heavy_cannon"] }],
  },

  // —— Rockets ——
  {
    id: "wpn_hydra",
    text: "Hydras shred soft clusters — dump a ripple into infantry, trucks, and light armor, not dug-in tanks.",
    tags: [{ kind: "weapon", weapons: ["rocket"] }, { kind: "enemyGroup", groups: ["soft", "infantry"] }],
  },
  {
    id: "wpn_micros",
    text: "Micros gently steer toward the reticle and hug the ground — walk the pair into soft targets, don’t expect Hellfire punch.",
    tags: [{ kind: "weapon", weapons: ["guided_rockets"] }],
  },
  {
    id: "wpn_starstreak",
    text: "Starstreak is a jittered dart hose — walk the neon stream onto a target and let the bomblets finish the spray.",
    tags: [{ kind: "weapon", weapons: ["swarm_missile"] }],
  },
  {
    id: "wpn_refractor",
    text: "Refractor always forks at about a third of the way to the reticle into a spray of child beams — ground hits shatter those into a few smaller beams in random directions.",
    tags: [{ kind: "weapon", weapons: ["laser_rocket"] }],
  },

  // —— Missiles / bombs ——
  {
    id: "wpn_hellfire",
    text: "Hellfires lock onto fast movers — keep the box steady, then let them run.",
    tags: [
      { kind: "weapon", weapons: ["hellfire_missile", "mini_hellfire_missile"] },
      { kind: "mechanic", mechanics: ["lock"] },
    ],
  },
  {
    id: "wpn_tow",
    text: "TOWs are ideal for killing AA from outside their envelope — stay long and wire-guide in.",
    tags: [
      { kind: "weapon", weapons: ["tow_missile"] },
      { kind: "enemyGroup", groups: ["aa"] },
    ],
  },
  {
    id: "wpn_tow_height",
    text: "While a TOW is in flight, SPACE raises the missile and SHIFT drops it — steer height as well as aim.",
    tags: [{ kind: "weapon", weapons: ["tow_missile"] }],
  },
  {
    id: "wpn_spike",
    text: "Spike soft-locks, then second-click commits the dive — keep the diamond honest before you send it.",
    tags: [{ kind: "weapon", weapons: ["tv_missile"] }, { kind: "mechanic", mechanics: ["lock"] }],
  },
  {
    id: "wpn_stinger",
    text: "Stinger is a low-signature heat seeker — pick the hottest air or vehicle pip and fire-and-forget.",
    tags: [
      { kind: "weapon", weapons: ["stinger_missile"] },
      { kind: "enemyGroup", groups: ["air"] },
      { kind: "mechanic", mechanics: ["lock"] },
    ],
  },
  {
    id: "wpn_sidewinder",
    text: "Sidewinder is a snap HEAT / FOX-2 rail dart — wide air cone, tight vehicle heat, one-shots heavy helis.",
    tags: [
      { kind: "weapon", weapons: ["sidewinder_missile"] },
      { kind: "enemyGroup", groups: ["air"] },
    ],
  },
  {
    id: "wpn_smoke",
    text: "Smoke bombs dive on the reticle — stack puffs to blind enemy vision, then push Low-RCS or close for Tesla.",
    tags: [
      { kind: "weapon", weapons: ["smoke_bomb"] },
      { kind: "mechanic", mechanics: ["smoke"] },
    ],
  },
  {
    id: "wpn_spectre",
    text: "Spectre is a real drone — fly it with WASD in its view. Switch weapons and keep firing from the bird; Q or right-click drops the camera, and selecting the Spectre slot jumps you back. Click Spectre again in its view to detonate.",
    tags: [{ kind: "weapon", weapons: ["attack_drone"] }],
  },
  {
    id: "wpn_photon",
    text: "Photon kicks then burns at extreme speed — lock, fire, and let the triple neon ribbons track the kill.",
    tags: [{ kind: "weapon", weapons: ["photon_missile"] }, { kind: "mechanic", mechanics: ["lock"] }],
  },
  {
    id: "wpn_warp",
    text: "Warp Bomb flies the Spike path — soft-lock, second-click commit. Constant-speed photonic orb; the blast slows time in the pocket.",
    tags: [{ kind: "weapon", weapons: ["warp_bomb"] }],
  },
  {
    id: "wpn_gps_bomb",
    text: "GPS bombs fall on a latched aim point — designate, release, and don’t babysit the drop.",
    tags: [{ kind: "weapon", weapons: ["gps_bomb", "gps_missile", "light_gps_missile", "bomb", "mini_bomb", "heavy_bomb"] }],
  },
  {
    id: "wpn_cluster",
    text: "Rockeye dispenser pop is light — the kill is the bomblet carpet. Drop over soft clusters, not single hard points.",
    tags: [
      { kind: "weapon", weapons: ["cluster_bomb"] },
      { kind: "enemyGroup", groups: ["soft", "infantry"] },
    ],
  },
  {
    id: "wpn_light_gps_missile",
    text: "Pyros is a light GPS AG missile — latch, kick, and burn onto soft targets. Griffin hits harder; JDAM is the heavy bomb pin.",
    tags: [{ kind: "weapon", weapons: ["light_gps_missile", "gps_missile", "gps_bomb"] }],
  },
  {
    id: "wpn_maverick",
    text: "Maverick is AG laser lock for armor — vehicles and buildings only; it will not soft-lock air or troops.",
    tags: [{ kind: "weapon", weapons: ["heavy_guided_missile"] }],
  },

  // —— Enemies ——
  {
    id: "enemy_infantry",
    text: "Wounded infantry crawl and bleed out if left alone — or finish them before they dig in and return fire.",
    tags: [{ kind: "enemyGroup", groups: ["infantry"] }],
  },
  {
    id: "enemy_battleship",
    text: "Battleships pack mixed batteries. Prioritize the AA mount before you linger overhead.",
    tags: [{ kind: "enemy", enemies: ["battleship"] }, { kind: "enemyGroup", groups: ["naval"] }],
  },
  {
    id: "enemy_drone",
    text: "Drones charge when lined up. Sidestep the run, then hit them while they turn.",
    tags: [{ kind: "enemy", enemies: ["drone"] }, { kind: "enemyGroup", groups: ["air"] }],
  },
  {
    id: "enemy_heli",
    text: "Enemy helis orbit and shoot — don’t sit under their ring; pop up, trade, then NOE out.",
    tags: [{ kind: "enemy", enemies: ["heli", "heli_small", "heli_heavy"] }, { kind: "enemyGroup", groups: ["air"] }],
  },
  {
    id: "enemy_aa",
    text: "SAMs and AA LAVs own open sky — kill them with TOWs, Hellfires, or stand-off before you linger.",
    tags: [{ kind: "enemyGroup", groups: ["aa"] }],
  },
  {
    id: "enemy_tank",
    text: "Tanks shrug small-caliber fire — use Hellfires, Spike, Railgun, or heavy bombs, not Chain Gun mag dumps.",
    tags: [{ kind: "enemyGroup", groups: ["armor"] }],
  },
  {
    id: "enemy_naval_mix",
    text: "Island Chain means water fights — PT boats and battleships, plus coastal AA. Stay off the deck guns’ noses.",
    tags: [{ kind: "forceMix", mixes: ["naval"] }, { kind: "enemyGroup", groups: ["naval"] }],
  },
  {
    id: "enemy_heavy_mix",
    text: "Highland Siege stacks armor and emplacements — plan pop-up shots and don’t cruise over SAMs.",
    tags: [{ kind: "forceMix", mixes: ["heavy"] }, { kind: "enemyGroup", groups: ["armor", "aa", "static"] }],
  },
  {
    id: "enemy_soft_road",
    text: "Trucks, pickups, and bikes flee when they spot you — cut them off early or they’ll scatter into cover.",
    tags: [{ kind: "enemyGroup", groups: ["soft"] }],
  },
];

// Keep LOAD_TIPS populated for any stray string-only reads.
LOAD_TIPS.push(...TACTICAL_TIPS.map((t) => t.text));
