/** Load-screen / Field Manual tactical tips. */
import { craftHasLiftRotors, craftOf } from "../sim/crafts";
import { isInfantry, specOf } from "../sim/roster";
import { wpnGuidedFamily, wpnIsAntiArmor, wpnIsAntiAir, wpnIsAntiSoft, wpnPierces, wpnIsBombDrop, wpnIsRemoteDeploy } from "../sim/weaponTags";
import type { TacticalTip } from "../sim/tips";

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
      forCraft: (c) => craftHasLiftRotors(craftOf(c)),
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
    text: "Timewarp slows the battlefield to a crawl while your craft keeps much of its speed. You can exit and resume at will.",
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
    context: { forWeapon: wpnIsAntiArmor },
  },
  {
    id: "wpn_anti_air",
    text: (t) => `Airborne targets are where ${t.weaponNames} really ${t.weapons.length > 1 ? "shine" : "shines"} — vehicles take noticeably less damage.`,
    context: { forWeapon: wpnIsAntiAir },
  },
  {
    id: "wpn_anti_soft",
    text: (t) => `${t.weaponNames} ${t.weapons.length > 1 ? "cut" : "cuts"} down infantry fast, but armor eats a lot more of the impact.`,
    context: { forWeapon: wpnIsAntiSoft },
  },
  {
    id: "wpn_penetration",
    text: (t) => `${t.weaponNames} punches through — line up a row of infantry or light vehicles and let one shot walk the whole file.`,
    context: { forWeapon: wpnPierces },
  },
  {
    id: "wpn_guided_lock",
    text: (t) => `Hold the lock box on target with ${t.weaponNames} until it locks, then look elsewhere — it flies itself in from there.`,
    context: { forWeapon: (w) => wpnGuidedFamily(w) === "lock_on" },
  },
  {
    id: "wpn_guided_wire",
    text: (t) => `Fire ${t.weaponNames} and it curves toward your cursor for the whole flight — there's no ballistic mode, just keep aiming.`,
    context: { forWeapon: (w) => wpnGuidedFamily(w) === "steer" },
  },
  {
    id: "wpn_guided_commit",
    text: (t) => `Soft-lock with ${t.weaponNames}, then commit the dive with a second click — keep it honest before you send it.`,
    context: { forWeapon: (w) => wpnGuidedFamily(w) === "steer_commit" },
  },
  {
    id: "wpn_guided_waypoint",
    text: (t) => `Click a ground point for ${t.weaponNames} and it steers itself there on the way down.`,
    context: { forWeapon: (w) => wpnGuidedFamily(w) === "waypoint" },
  },
  {
    id: "wpn_remote_general",
    text: (t) => `Piloting ${t.weaponNames}? Q always drops you back to the host aircraft. Left alone, autonomous remotes fight and return to the bay on their own.`,
    context: { forWeapon: wpnIsRemoteDeploy },
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
    context: { forWeapon: wpnIsBombDrop },
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
