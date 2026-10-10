/** Enemy unit catalog. */
import { lookupSpriteMuzzles, lookupSpriteOrigin, mountOf, mountsOf } from "../art/spriteOrigin";
import type { PartMount, UnitKind, UnitSpec, WeaponSpec } from "../sim/roster";
import { WPN, wpn } from "./enemyWeapons";
import { building, MILITARY, OFFSHORE, roundBuilding } from "./buildingSpec";
import { SETTLEMENT_UNITS } from "./settlementUnits";

export const gun = (
  tex: string,
  originY = 0.22,
  mount = { x: 0.5, y: 0.48 },
  hulk?: string,
  weapon?: WeaponSpec
): PartMount => {
  const tips = lookupSpriteMuzzles(tex);
  if (!tips.length) throw new Error(`gun(${tex}): missing SPRITE_SPECS muzzle points`);
  return {
    tex,
    hulk: hulk ?? `${tex}_hulk`,
    origin: lookupSpriteOrigin(tex) ?? { x: 0.5, y: originY },
    mount,
    muzzles: tips,
    weapon
  };
};

/**
 * HP is a Chain Gun hit-budget (28 dmg / 0.096s). No armor soak — roles are HP.
 *   1        troops, bike, drone
 *   2–4      soft skin / canvas
 *   5–8      light armor, boats, scouts, SAM, gunship
 *   12       MBT baseline (~1.15s clean burst)
 *   13       heavy heli (a little above a tank)
 *   14–20    hardened buildings
 *   40       battleship
 */
/** Enemy roster: every hostile unit and building. */
const ENEMY_UNITS = {
  tank: {
    label: "TANK",
    health: 336,
    radius: 22,
    box: { halfW: 19, halfL: 34 },
    height: 20,
    texture: "enemy_tank",
    camo: "biome",
    hulk: "enemy_tank_hulk",
    debris: "mech",
    rotOff: Math.PI / 2,
    behavior: "orbit_attack_vehicle",
    terrain: { climb: "medium" },
    drive: { maxSpd: 32, accel: 16, brake: 22, turn: 0.7, track: "tread", trackGap: 15, trackScale: 1.05 },
    throwGuns: true,
    wreckScale: 1.25,
    weapon: wpn("he", { fireCd: 2.05, range: 520}),
    guns: [gun("enemy_tank_gun", 0.78, mountOf("enemy_tank", "gun"), "enemy_tank_gun_hulk")],
    rotors: []
  },
  soldier: {
    label: "INFANTRY",
    health: 8,
    radius: 10,
    height: 9,
    texture: "enemy_troop_soldier",
    hulk: "enemy_troop_soldier_hulk",
    debris: "organic",
    rotOff: Math.PI / 2,
    behavior: "attack_infantry",
    organic: true,
    fixedAim: true,
    weapon: wpn("mg", { scale: 0.529 }),
    guns: [],
    rotors: []
  },
  heli: {
    label: "GUNSHIP",
    health: 224,
    radius: 22,
    height: 16,
    flyZ: 48,
    texture: "enemy_heli",
    camo: "biome",
    hulk: "enemy_heli_hulk",
    debris: "mech",
    rotOff: Math.PI / 2,
    behavior: "orbit_attack_heli",
    aerial: true,
    noCrater: true,
    strafeAim: true,
    combatMood: { strikesBeforeFlee: 4, fleeDuration: [1.8, 2.4], fleeAsOrbit: true },
    rotorSpinRate: 28,
    weapon: wpn("he", { fireCd: 1.4, range: 640, speed: 520, dmg: 3, blast: 8, burst: 3, burstGap: 0.13 }),
    secondary: {
      wpn: WPN.seeker,
      mounts: mountsOf("enemy_heli", "hardpoint"),
      mountFire: "alternate",
      fireCdMin: 5.5,
      fireCdMax: 9.5,
      scale: 0.72,
      motor: -0.06
    },
    guns: [gun("enemy_heli_gun", 0.72, mountOf("enemy_heli", "gun"))],
    rotors: [
      {
        tex: "enemy_heli_rotor",
        hulk: "enemy_heli_rotor_hulk",
        origin: { x: 0.5, y: 0.5 },
        mount: mountOf("enemy_heli", "rotor"),
        scale: 1
      },
    ]
  },
  boat: {
    label: "PATROL BOAT",
    health: 168,
    radius: 28,
    box: { halfW: 13, halfL: 44 },
    height: 16,
    texture: "enemy_boat",
    camo: ["naval", "dazzle", "none"],
    sonar: true,
    // Bow tube: fires only at submerged targets, any bearing (the torpedo turns itself).
    secondary: { wpn: WPN.torpedo, mounts: [{ x: 0.5, y: 0.22 }], mountFire: "alternate", fireCdMin: 6, fireCdMax: 10, minRange: 60, aimCone: Math.PI },
    hulk: "enemy_boat_hulk",
    debris: "mech",
    rotOff: Math.PI / 2,
    behavior: "patrol_boat",
    water: true,
    noCrater: true,
    throwGuns: true,
    boatYaw: 0.85,
    boatSpeed: 22,
    boatReact: { seen: "pursue", hurt: "retreat" },
    weapon: wpn("he", { fireCd: 1.15, range: 480}),
    guns: [],
    rotors: [],
    // Deck mount rolls a cannon, an AA gun or a seeker launcher (tower turret art).
    partsRoll: {
      mode: "pick",
      mount: mountOf("enemy_boat", "gun"),
      fallback: "cannon",
      weights: [
        ["cannon", 50],
        ["aa", 25],
        ["sam", 25],
      ],
      options: {
        cannon: { tex: "enemy_boat_gun", originY: 0.74, w: wpn("he", { fireCd: 1.15, range: 480 }), label: "boat_cannon" },
        aa: { tex: "building_tower_aa", originY: 1.36, w: WPN.aa, label: "aa", scale: 0.83 },
        sam: { tex: "building_tower_sam", originY: 1.25, w: WPN.seeker, label: "seeker", scale: 0.83 }
      }
    }
  },
  tower: building("tower", "AA TOWER", 280, 34, 37, 48, {
    ...MILITARY,
    radius: 28,
    throwGuns: true,
    spawnYaw: (5 * Math.PI) / 180,
    weapon: WPN.tower_cannon,
    partsRoll: {
      mode: "pick",
      mount: mountOf("building_tower", "gun"),
      fallback: "arty",
      weights: [
        ["arty", 34],
        ["aa", 33],
        ["sam", 33],
      ],
      options: {
        arty: { tex: "building_tower_gun", originY: 1.39, w: WPN.tower_cannon, label: "tower_cannon" },
        aa: { tex: "building_tower_aa", originY: 1.36, w: WPN.aa, label: "aa" },
        sam: { tex: "building_tower_sam", originY: 1.25, w: WPN.seeker, label: "seeker" }
      }
    }
  }),
  bunker: roundBuilding("bunker", "BUNKER", 560, 54, 32, {
    ...MILITARY,
    spawnYaw: (45 * Math.PI) / 180,
    crew: { mounts: mountsOf("building_bunker", "troop"), mode: "leash", leashR: 38 }
  }),
  radar: building("radar", "RADAR", 392, 57, 104, 56, {
    ...MILITARY,
    radius: 72,
    spawnYaw: (5 * Math.PI) / 180,
    dish: {
      tex: "building_radar_disk",
      hulk: "building_radar_disk_hulk",
      origin: { x: 0.5, y: 0.5 },
      mount: mountOf("building_radar", "dish"),
      scale: 1
    }
  }),
  pickup: {
    label: "PICKUP",
    health: 70,
    radius: 18,
    box: { halfW: 11, halfL: 28 },
    height: 14,
    texture: "enemy_pickup",
    hulk: "enemy_pickup_hulk",
    camo: "biome",
    debris: "mech",
    rotOff: Math.PI / 2,
    behavior: "flee_vehicle",
    drive: { maxSpd: 92, accel: 48, brake: 40, turn: 1.55, track: "tire", trackGap: 13, trackScale: 0.78 },
    wheels: 2,
    wheelDebrisScale: [0.68, 0.82],
    guns: [],
    rotors: [],
    crew: { mounts: [mountOf("enemy_pickup", "troop")], mode: "snap", chance: 0.33 }
  },
  truck: {
    label: "TRUCK",
    health: 84,
    radius: 20,
    box: { halfW: 14, halfL: 32 },
    height: 16,
    texture: "enemy_truck",
    hulk: "enemy_truck_hulk",
    camo: "biome",
    debris: "mech",
    rotOff: Math.PI / 2,
    behavior: "flee_vehicle",
    drive: { maxSpd: 68, accel: 28, brake: 26, turn: 0.85, track: "dual", trackGap: 15, trackScale: 0.95 },
    wheels: 2,
    guns: [],
    rotors: []
  },
  tanker: {
    label: "TANKER",
    health: 112,
    radius: 22,
    box: { halfW: 13, halfL: 33 },
    height: 16,
    texture: "enemy_tanker",
    camo: "biome",
    hulk: "enemy_tanker_hulk",
    debris: "mech",
    rotOff: Math.PI / 2,
    behavior: "flee_vehicle",
    drive: { maxSpd: 52, accel: 18, brake: 22, turn: 0.62, track: "wide", trackGap: 16, trackScale: 1.12 },
    wheels: 2,
    guns: [],
    rotors: []
  },
  motorcycle: {
    label: "MOTORCYCLE",
    health: 8,
    radius: 12,
    height: 10,
    texture: "enemy_motorcycle",
    terrain: { slopeSlow: 0.25 },
    hulk: "enemy_motorcycle_hulk",
    debris: "mech",
    rotOff: Math.PI / 2,
    behavior: "flee_vehicle",
    drive: { maxSpd: 138, accel: 72, brake: 48, turn: 2.35, track: "mono", trackGap: 16, trackScale: 0.7 },
    softBlood: true,
    wheels: 2,
    crashPop: true,
    fleeReactRange: 1200,
    minTurnSpd: 24,
    wheelDebrisScale: [0.48, 0.58],
    guns: [],
    rotors: []
  },
  lav: {
    label: "LAV",
    health: 168,
    radius: 18,
    box: { halfW: 13, halfL: 27 },
    height: 16,
    texture: "enemy_lav",
    camo: "biome",
    hulk: "enemy_lav_hulk",
    debris: "mech",
    rotOff: Math.PI / 2,
    behavior: "orbit_attack_vehicle",
    terrain: { climb: "medium" },
    drive: { maxSpd: 48, accel: 28, brake: 32, turn: 1.15, track: "tire", trackGap: 14, trackScale: 0.82 },
    throwGuns: true,
    wheels: 2,
    weapon: wpn("he", { fireCd: 1.15, range: 440, dmg: 6, blast: 12}),
    guns: [gun("enemy_lav_gun", 0.76, mountOf("enemy_lav", "gun"))],
    rotors: []
  },
  lav_aa: {
    label: "LAV-AA",
    health: 140,
    radius: 18,
    box: { halfW: 13, halfL: 27 },
    height: 18,
    texture: "enemy_lav",
    hulk: "enemy_lav_hulk",
    debris: "mech",
    rotOff: Math.PI / 2,
    behavior: "orbit_attack_vehicle",
    terrain: { climb: "medium" },
    drive: { maxSpd: 42, accel: 24, brake: 30, turn: 1.05, track: "tire", trackGap: 14, trackScale: 0.82 },
    throwGuns: true,
    wheels: 2,
    camo: ["digital"],
    weapon: WPN.aa,
    guns: [
      {
        ...gun("building_tower_aa", 0.9, mountOf("enemy_lav", "gun")),
        scale: 0.83
      },
    ],
    rotors: []
  },
  sam: {
    label: "SAM",
    health: 196,
    radius: 22,
    box: { halfW: 15, halfL: 32 },
    height: 20,
    texture: "enemy_sam",
    camo: "biome",
    hulk: "enemy_sam_hulk",
    debris: "mech",
    rotOff: Math.PI / 2,
    behavior: "orbit_attack_vehicle",
    terrain: { climb: "medium" },
    drive: { maxSpd: 24, accel: 12, brake: 18, turn: 0.55, track: "dual", trackGap: 16, trackScale: 1 },
    throwGuns: true,
    weapon: wpn("seeker", {
      fireCd: 3.4,
      range: 780,
      speed: 280,
      dmg: 22,
      blast: 28
    }),
    guns: [gun("enemy_sam_gun", 0.7, mountOf("enemy_sam", "gun"))],
    rotors: []
  },
  ptboat: {
    label: "PT BOAT",
    health: 70,
    radius: 14,
    box: { halfW: 7, halfL: 24 },
    height: 12,
    texture: "enemy_ptboat",
    camo: ["naval", "dazzle", "none"],
    sonar: true,
    // Bow tube: fires only at submerged targets, any bearing (the torpedo turns itself).
    secondary: { wpn: WPN.torpedo, mounts: [{ x: 0.5, y: 0.22 }], mountFire: "alternate", fireCdMin: 6, fireCdMax: 10, minRange: 60, aimCone: Math.PI },
    hulk: "enemy_ptboat_hulk",
    debris: "mech",
    rotOff: Math.PI / 2,
    behavior: "patrol_boat",
    water: true,
    noCrater: true,
    throwGuns: true,
    boatYaw: 1.55,
    boatSpeed: 38,
    boatReact: { seen: "retreat" },
    weapon: wpn("mg", { fireCd: 0.85, range: 420, speed: 560, dmg: 3, blast: 6, burst: 3, burstGap: 0.09 }),
    guns: [gun("enemy_ptboat_gun", 0.74, mountOf("enemy_ptboat", "gun"))],
    rotors: []
  },
  battleship: {
    label: "BATTLESHIP",
    health: 1120,
    radius: 92,
    box: { halfW: 28, halfL: 133 },
    height: 40,
    texture: "enemy_battleship",
    camo: ["naval", "dazzle", "none"],
    sonar: true,
    // Bow tube: fires only at submerged targets, any bearing (the torpedo turns itself).
    secondary: { wpn: WPN.torpedo, mounts: [{ x: 0.5, y: 0.22 }], mountFire: "alternate", fireCdMin: 6, fireCdMax: 10, minRange: 60, aimCone: Math.PI },
    hulk: "enemy_battleship_hulk",
    debris: "mech",
    rotOff: Math.PI / 2,
    behavior: "static_hold",
    water: true,
    noCrater: true,
    throwGuns: true,
    weapon: WPN.arty,
    guns: [],
    rotors: [],
    partsRoll: {
      mode: "fixed",
      options: {
        arty: { tex: "enemy_battleship_gun", originY: 0.8, w: WPN.arty, label: "arty" },
        aa: { tex: "enemy_battleship_gun_aa", originY: 0.72, w: WPN.aa, label: "aa" },
        sam: { tex: "enemy_battleship_gun_sam", originY: 0.7, w: WPN.seeker, label: "seeker" }
      },
      slots: [
        { id: "arty", mount: mountOf("enemy_battleship", "gun", 0) },
        { id: "aa", mount: mountOf("enemy_battleship", "gun", 1) },
        { id: "sam", mount: mountOf("enemy_battleship", "gun", 2) },
        { id: "arty", mount: mountOf("enemy_battleship", "gun", 3) },
      ]
    }
  },
  rpg: {
    label: "RPG TROOP",
    health: 9,
    radius: 10,
    height: 9,
    texture: "enemy_troop_rpg",
    hulk: "enemy_troop_rpg_hulk",
    debris: "organic",
    rotOff: Math.PI / 2,
    behavior: "attack_infantry",
    organic: true,
    fixedAim: true,
    weapon: {
      kind: "rocket",
      look: "shot_rocket",
      scale: 0.66,
      trailScale: 0.34,
      fireCd: 2.6,
      range: 360,
      speed: 260,
      dmg: 14,
      blast: 22,
      jitter: 0.04,
    },
    guns: [],
    rotors: []
  },
  gunner: {
    label: "GUNNER TROOP",
    health: 10,
    radius: 11,
    height: 9,
    texture: "enemy_troop_gunner",
    hulk: "enemy_troop_gunner_hulk",
    debris: "organic",
    rotOff: Math.PI / 2,
    behavior: "attack_infantry",
    organic: true,
    fixedAim: true,
    weapon: wpn("mg", {
      fireCd: 1.35,
      range: 380,
      speed: 560,
      dmg: 1,
      blast: 4,
      burst: 10,
      burstGap: 0.05,
      look: "shot_cannon_enemy_mg",
      scale: 0.38,
      jitter: 0.045
    }),
    guns: [],
    rotors: []
  },
  mounted_mg: {
    label: "MOUNTED MG TROOP",
    health: 36,
    radius: 12,
    height: 12,
    texture: "enemy_troop_mounted_mg",
    hulk: "enemy_troop_mounted_mg_hulk",
    debris: "organic",
    rotOff: Math.PI / 2,
    behavior: "static_hold",
    organic: true,
    fixedAim: true,
    weapon: wpn("mg", {
      fireCd: 1.15,
      range: 460,
      speed: 600,
      dmg: 1,
      blast: 4,
      burst: 12,
      burstGap: 0.045,
      look: "shot_cannon_enemy_mg",
      scale: 0.38,
      jitter: 0.04
    }),
    guns: [],
    rotors: []
  },
  stinger: {
    label: "STINGER TROOP",
    health: 9,
    radius: 10,
    height: 9,
    texture: "enemy_troop_stinger",
    hulk: "enemy_troop_stinger_hulk",
    debris: "organic",
    rotOff: Math.PI / 2,
    behavior: "attack_infantry",
    organic: true,
    fixedAim: true,
    weapon: wpn("seeker", {
      fireCd: 3.1,
      range: 520,
      speed: 320,
      dmg: 16,
      blast: 18,
      scale: 0.7,
      trailScale: 0.4,
    }),
    guns: [],
    rotors: []
  },
  mechanic: {
    label: "MECHANIC TROOP",
    health: 7,
    radius: 10,
    height: 9,
    texture: "enemy_troop_mechanic",
    hulk: "enemy_troop_mechanic_hulk",
    debris: "organic",
    rotOff: Math.PI / 2,
    behavior: "flee_infantry",
    organic: true,
    guns: [],
    rotors: []
  },
  officer: {
    label: "OFFICER TROOP",
    health: 11,
    radius: 10,
    height: 9,
    texture: "enemy_troop_officer",
    hulk: "enemy_troop_officer_hulk",
    camo: "biome",
    debris: "organic",
    rotOff: Math.PI / 2,
    behavior: "flee_infantry",
    organic: true,
    hv: true,
    fleeRunSpeed: 36,
    guns: [],
    rotors: []
  },
  barn: building("barn", "BARN", 196, 23, 41, 28, { neutral: false, radius: 34 }),
  tent: building("tent", "TENT", 50, 18, 30, 14, { neutral: false, radius: 20, camo: "biome" }),
  fob: building("fob", "FOB", 448, 61, 53, 28, { ...MILITARY, radius: 52, hv: true, camo: "biome", spawnYaw: (20 * Math.PI) / 180 }),
  lookout: building("lookout", "LOOKOUT", 168, 23, 25, 56, {
    neutral: false,
    radius: 22,
    hv: true,
    spawnYaw: (5 * Math.PI) / 180,
    crew: { mounts: [mountOf("building_lookout", "troop")], mode: "leash", leashR: 17 }
  }),
  // Military site buildings (settlement art; hostile).
  hangar: building("hangar", "HANGAR", 280, 44, 70, 34, MILITARY),
  control_tower: building("control_tower", "CONTROL TOWER", 200, 21, 21, 60, MILITARY),
  // Base heli platform: same art as the settlement platform; land or sea by where the base lands.
  military_heli_platform: building("heli_platform", "HELI PLATFORM", 220, 42, 48, 40, { ...MILITARY, debris: "mech" }),
  military_heli_platform_sea: building("heli_platform", "HELI PLATFORM", 220, 42, 48, 40, { ...OFFSHORE, ...MILITARY, debris: "mech" }),
  drone: {
    label: "DRONE",
    health: 24,
    radius: 6,
    height: 6,
    flyZ: 36,
    texture: "enemy_drone",
    hulk: "enemy_drone_hulk",
    debris: "mech",
    rotOff: Math.PI / 2,
    behavior: "suicide_attack_heli",
    aerial: true,
    noCrater: true,
    empCrashes: true,
    rotorSpinRate: 42,
    guns: [],
    rotors: mountsOf("enemy_drone", "rotor").map((m) => ({
      tex: "enemy_drone_rotor",
      hulk: "enemy_drone_rotor_hulk",
      origin: { x: 0.5, y: 0.5 },
      mount: { ...m },
      scale: 1
    }))
  },
  heli_small: {
    label: "SCOUT HELI",
    health: 112,
    radius: 14,
    height: 12,
    flyZ: 44,
    texture: "enemy_heli_small",
    camo: "biome",
    hulk: "enemy_heli_small_hulk",
    debris: "mech",
    rotOff: Math.PI / 2,
    behavior: "kite_attack_heli",
    aerial: true,
    noCrater: true,
    fixedAim: true,
    strafeAim: true,
    combatMood: { strikesBeforeFlee: 3, fleeDuration: [2.6, 3.4] },
    rotorSpinRate: 28,
    weapon: wpn("mg", {
      fireCd: 1.15,
      range: 700,
      speed: 680,
      dmg: 3,
      blast: 8,
      burst: 6,
      burstGap: 0.09,
      look: "shot_cannon_enemy_mg",
      scale: 0.42,
      jitter: 0.04,
      muzzleFire: "simultaneous"
    }),
    // Fixed wing guns are baked into the hull; body muzzles fire both L/R together.
    guns: [],
    rotors: [
      {
        tex: "enemy_heli_rotor",
        hulk: "enemy_heli_rotor_hulk",
        origin: { x: 0.5, y: 0.5 },
        mount: mountOf("enemy_heli_small", "rotor"),
        scale: 0.62
      },
    ]
  },
  heli_heavy: {
    label: "HEAVY HELI",
    health: 364,
    radius: 40,
    height: 24,
    flyZ: 52,
    texture: "enemy_heli_heavy",
    camo: "biome",
    hulk: "enemy_heli_heavy_hulk",
    debris: "mech",
    rotOff: Math.PI / 2,
    behavior: "orbit_attack_heli",
    aerial: true,
    noCrater: true,
    throwGuns: true,
    strafeAim: false,
    rotorSpinRate: 28,
    weapon: wpn("mg", {
      fireCd: 0.55,
      range: 700,
      speed: 680,
      dmg: 3,
      blast: 8,
      burst: 14,
      burstGap: 0.07,
      look: "shot_cannon_enemy_mg",
      scale: 0.48,
      jitter: 0.04
    }),
    secondary: {
      wpn: WPN.seeker,
      mounts: mountsOf("enemy_heli_heavy", "hardpoint"),
      mountFire: "alternate",
      fireCdMin: 5.5,
      fireCdMax: 9.5,
      scale: 0.72,
      motor: -0.06
    },
    // Side door guns: each covers its own flank, not through the fuselage.
    guns: mountsOf("enemy_heli_heavy", "gun").map((m) => ({
      ...gun("enemy_heli_heavy_gun", 0.78, { ...m }),
      scale: 0.58,
      traverse: { arc: 200, center: m.x < 0.5 ? -90 : 90 }
    })),
    rotors: mountsOf("enemy_heli_heavy", "rotor").map((m) => ({
      tex: "enemy_heli_rotor",
      hulk: "enemy_heli_rotor_hulk",
      origin: { x: 0.5, y: 0.5 },
      mount: { ...m },
      scale: 1.25
    }))
  }
} satisfies Partial<Record<UnitKind, UnitSpec>>;

/** Every unit spec: the enemy roster plus the civilian settlement roster (same spec shape). */
export const UNIT_SPECS: Record<UnitKind, UnitSpec> = { ...ENEMY_UNITS, ...SETTLEMENT_UNITS };


export const TROOP_WEIGHTS: [UnitKind, number][] = [
  ["soldier", 40],
  ["rpg", 22],
  ["gunner", 14],
  ["mechanic", 10],
  ["stinger", 7],
  ["mounted_mg", 4],
  ["officer", 2],
];
