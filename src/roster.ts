import { lookupSpriteMuzzles, lookupSpriteOrigin, SPRITE_MOUNT } from "./spriteOrigin";

export type UnitKind =
  | "tank"
  | "soldier"
  | "heli"
  | "boat"
  | "tower"
  | "bunker"
  | "radar"
  | "pickup"
  | "truck"
  | "tanker"
  | "lav"
  | "sam"
  | "ptboat"
  | "battleship"
  | "rpg"
  | "gunner"
  | "stinger"
  | "mechanic"
  | "officer"
  | "barn"
  | "tent"
  | "fob"
  | "lookout"
  | "drone"
  | "heli_small"
  | "heli_heavy";

export type FragCat = "mech" | "struct" | "organic";
export type TracerStyle = "chain" | "shell" | "small" | "aa";
export type MoveKind =
  | "static"
  | "tank"
  | "vehicle"
  | "boat"
  | "flee"
  | "inf"
  | "heli"
  | "drone";

export type TrackKind = "tread" | "tire" | "dual" | "wide";

export interface DriveSpec {
  maxSpd: number;
  accel: number;
  brake: number;
  turn: number;
  track: TrackKind;
  trackGap: number;
  trackScale: number;
}

export interface PartMount {
  tex: string;
  hulk?: string;
  origin: { x: number; y: number };
  mount: { x: number; y: number };
  muzzle?: { x: number; y: number };
  muzzles?: { x: number; y: number }[];
  scale?: number;
}

export interface WeaponSpec {
  fireCd: number;
  range: number;
  speed: number;
  dmg: number;
  blast: number;
  tracer: TracerStyle;
  shot: "cannon" | "rocket" | "hellfire";
  burst?: number;
  burstGap?: number;
  jitter?: number;
  muzzleLen: number;
}

export interface UnitSpec {
  health: number;
  radius: number;
  height: number;
  flyZ?: number;
  texture: string;
  hulk: string;
  frag: FragCat;
  rotOff: number;
  move: MoveKind;
  weapon?: WeaponSpec;
  guns: PartMount[];
  rotors: PartMount[];
  dish?: PartMount;
  building?: boolean;
  aerial?: boolean;
  water?: boolean;
  organic?: boolean;
  hv?: boolean;
  noCrater?: boolean;
  throwGuns?: boolean;
  /** Hull/body aim only; cannot traverse a turret. Must face the target to fire. */
  fixedAim?: boolean;
  spawnYaw?: number;
}

const gun = (
  tex: string,
  originY = 0.22,
  mount = { x: 0.5, y: 0.48 },
  hulk?: string
): PartMount => {
  const muzzles = lookupSpriteMuzzles(tex);
  return {
    tex,
    hulk: hulk ?? `${tex}_hulk`,
    origin: lookupSpriteOrigin(tex) ?? { x: 0.5, y: originY },
    mount,
    muzzle: muzzles[0] ?? { x: 0.5, y: 0.08 },
    muzzles: muzzles.length ? muzzles : undefined,
  };
};

const shell = (over: Partial<WeaponSpec> = {}): WeaponSpec => ({
  fireCd: 0.9,
  range: 500,
  speed: 420,
  dmg: 8,
  blast: 16,
  tracer: "shell",
  shot: "cannon",
  muzzleLen: 22,
  ...over,
});

const small = (over: Partial<WeaponSpec> = {}): WeaponSpec => ({
  fireCd: 1.05,
  range: 280,
  speed: 380,
  dmg: 1,
  blast: 5,
  tracer: "small",
  shot: "cannon",
  burst: 3,
  burstGap: 0.075,
  jitter: 0.05,
  muzzleLen: 9,
  ...over,
});

const SPECS: Record<UnitKind, UnitSpec> = {
  tank: {
    health: 90,
    radius: 22,
    height: 20,
    texture: "enemy_tank",
    hulk: "enemy_tank_hulk",
    frag: "mech",
    rotOff: Math.PI / 2,
    move: "tank",
    throwGuns: true,
    weapon: shell({ fireCd: 2.05, range: 520, muzzleLen: 28 }),
    guns: [gun("enemy_tank_gun", 0.78, { x: 0.5, y: 0.4 }, "enemy_tank_gun_hulk")],
    rotors: [],
  },
  soldier: {
    health: 18,
    radius: 10,
    height: 9,
    texture: "enemy_troop_soldier",
    hulk: "enemy_troop_soldier_hulk",
    frag: "organic",
    rotOff: Math.PI / 2,
    move: "inf",
    organic: true,
    fixedAim: true,
    weapon: small(),
    guns: [],
    rotors: [],
  },
  heli: {
    health: 80,
    radius: 22,
    height: 16,
    flyZ: 48,
    texture: "enemy_heli",
    hulk: "enemy_heli_hulk",
    frag: "mech",
    rotOff: Math.PI / 2,
    move: "heli",
    aerial: true,
    noCrater: true,
    weapon: shell({ fireCd: 0.85, range: 640, speed: 520, muzzleLen: 18 }),
    guns: [gun("enemy_heli_gun", 0.72, { x: 0.5, y: 0.62 })],
    rotors: [{ tex: "enemy_heli_rotor", origin: { x: 0.5, y: 0.5 }, mount: { x: 0.497, y: 0.411 }, scale: 1 }],
  },
  boat: {
    health: 70,
    radius: 24,
    height: 16,
    texture: "enemy_boat",
    hulk: "enemy_boat_hulk",
    frag: "mech",
    rotOff: Math.PI / 2,
    move: "boat",
    water: true,
    noCrater: true,
    throwGuns: true,
    weapon: shell({ fireCd: 1.15, range: 480, muzzleLen: 20 }),
    guns: [gun("enemy_boat_gun", 0.74, { x: 0.62, y: 0.5 })],
    rotors: [],
  },
  tower: {
    health: 110,
    radius: 20,
    height: 38,
    texture: "building_tower",
    hulk: "building_tower_hulk",
    frag: "struct",
    rotOff: Math.PI / 2,
    move: "static",
    building: true,
    throwGuns: true,
    spawnYaw: (5 * Math.PI) / 180,
    weapon: shell({ fireCd: 0.5, range: 700, speed: 920, dmg: 12, blast: 10, tracer: "aa", muzzleLen: 24 }),
    guns: [gun("building_tower_gun", 0.8, { x: 0.5, y: 0.5 })],
    rotors: [],
  },
  bunker: {
    health: 260,
    radius: 36,
    height: 26,
    texture: "building_bunker",
    hulk: "building_bunker_hulk",
    frag: "struct",
    rotOff: Math.PI / 2,
    move: "static",
    building: true,
    spawnYaw: (45 * Math.PI) / 180,
    guns: [],
    rotors: [],
  },
  radar: {
    health: 200,
    radius: 32,
    height: 34,
    texture: "building_radar",
    hulk: "building_radar_hulk",
    frag: "struct",
    rotOff: Math.PI / 2,
    move: "static",
    building: true,
    spawnYaw: (45 * Math.PI) / 180,
    guns: [],
    rotors: [],
    dish: { tex: "building_radar_disk", origin: { x: 0.5, y: 0.55 }, mount: { ...SPRITE_MOUNT.building_radar }, scale: 1 },
  },
  pickup: {
    health: 42,
    radius: 18,
    height: 14,
    texture: "enemy_pickup",
    hulk: "enemy_pickup_hulk",
    frag: "mech",
    rotOff: Math.PI / 2,
    move: "vehicle",
    guns: [],
    rotors: [],
  },
  truck: {
    health: 55,
    radius: 20,
    height: 16,
    texture: "enemy_truck",
    hulk: "enemy_truck_hulk",
    frag: "mech",
    rotOff: Math.PI / 2,
    move: "vehicle",
    guns: [],
    rotors: [],
  },
  tanker: {
    health: 70,
    radius: 22,
    height: 16,
    texture: "enemy_tanker",
    hulk: "enemy_tanker_hulk",
    frag: "mech",
    rotOff: Math.PI / 2,
    move: "vehicle",
    guns: [],
    rotors: [],
  },
  lav: {
    health: 62,
    radius: 18,
    height: 16,
    texture: "enemy_lav",
    hulk: "enemy_lav_hulk",
    frag: "mech",
    rotOff: Math.PI / 2,
    move: "tank",
    throwGuns: true,
    weapon: shell({ fireCd: 1.15, range: 440, dmg: 6, blast: 12, muzzleLen: 20 }),
    guns: [gun("enemy_lav_gun", 0.76, { ...SPRITE_MOUNT.enemy_lav })],
    rotors: [],
  },
  sam: {
    health: 80,
    radius: 22,
    height: 20,
    texture: "enemy_sam",
    hulk: "enemy_sam_hulk",
    frag: "mech",
    rotOff: Math.PI / 2,
    move: "tank",
    throwGuns: true,
    weapon: {
      fireCd: 3.4,
      range: 780,
      speed: 280,
      dmg: 22,
      blast: 28,
      tracer: "shell",
      shot: "hellfire",
      muzzleLen: 18,
    },
    guns: [gun("enemy_sam_gun", 0.7, { ...SPRITE_MOUNT.enemy_sam })],
    rotors: [],
  },
  ptboat: {
    health: 48,
    radius: 18,
    height: 12,
    texture: "enemy_ptboat",
    hulk: "enemy_ptboat_hulk",
    frag: "mech",
    rotOff: Math.PI / 2,
    move: "boat",
    water: true,
    noCrater: true,
    throwGuns: true,
    weapon: shell({ fireCd: 0.7, range: 420, speed: 560, dmg: 5, blast: 10, muzzleLen: 16 }),
    guns: [gun("enemy_ptboat_gun", 0.74, { ...SPRITE_MOUNT.enemy_ptboat })],
    rotors: [],
  },
  battleship: {
    health: 420,
    radius: 92,
    height: 40,
    texture: "enemy_battleship",
    hulk: "enemy_battleship_hulk",
    frag: "mech",
    rotOff: Math.PI / 2,
    move: "boat",
    water: true,
    noCrater: true,
    throwGuns: true,
    weapon: shell({ fireCd: 1.35, range: 860, speed: 480, dmg: 16, blast: 22, muzzleLen: 32 }),
    guns: SPRITE_MOUNT.enemy_battleship.map((m) => gun("enemy_battleship_gun", 0.8, { ...m })),
    rotors: [],
  },
  rpg: {
    health: 20,
    radius: 10,
    height: 9,
    texture: "enemy_troop_rpg",
    hulk: "enemy_troop_rpg_hulk",
    frag: "organic",
    rotOff: Math.PI / 2,
    move: "inf",
    organic: true,
    fixedAim: true,
    weapon: {
      fireCd: 2.6,
      range: 360,
      speed: 260,
      dmg: 14,
      blast: 22,
      tracer: "shell",
      shot: "rocket",
      jitter: 0.04,
      muzzleLen: 12,
    },
    guns: [],
    rotors: [],
  },
  gunner: {
    health: 22,
    radius: 11,
    height: 9,
    texture: "enemy_troop_gunner",
    hulk: "enemy_troop_gunner_hulk",
    frag: "organic",
    rotOff: Math.PI / 2,
    move: "inf",
    organic: true,
    fixedAim: true,
    weapon: small({ fireCd: 0.85, range: 340, burst: 6, burstGap: 0.055, muzzleLen: 12 }),
    guns: [],
    rotors: [],
  },
  stinger: {
    health: 20,
    radius: 10,
    height: 9,
    texture: "enemy_troop_stinger",
    hulk: "enemy_troop_stinger_hulk",
    frag: "organic",
    rotOff: Math.PI / 2,
    move: "inf",
    organic: true,
    fixedAim: true,
    weapon: {
      fireCd: 3.1,
      range: 520,
      speed: 320,
      dmg: 16,
      blast: 18,
      tracer: "shell",
      shot: "hellfire",
      jitter: 0.03,
      muzzleLen: 12,
    },
    guns: [],
    rotors: [],
  },
  mechanic: {
    health: 16,
    radius: 10,
    height: 9,
    texture: "enemy_troop_mechanic",
    hulk: "enemy_troop_mechanic_hulk",
    frag: "organic",
    rotOff: Math.PI / 2,
    move: "flee",
    organic: true,
    guns: [],
    rotors: [],
  },
  officer: {
    health: 28,
    radius: 10,
    height: 9,
    texture: "enemy_troop_officer",
    hulk: "enemy_troop_officer_hulk",
    frag: "organic",
    rotOff: Math.PI / 2,
    move: "flee",
    organic: true,
    hv: true,
    guns: [],
    rotors: [],
  },
  barn: {
    health: 140,
    radius: 34,
    height: 28,
    texture: "building_barn",
    hulk: "building_barn_hulk",
    frag: "struct",
    rotOff: Math.PI / 2,
    move: "static",
    building: true,
    guns: [],
    rotors: [],
  },
  tent: {
    health: 40,
    radius: 20,
    height: 14,
    texture: "building_tent",
    hulk: "building_tent_hulk",
    frag: "struct",
    rotOff: Math.PI / 2,
    move: "static",
    building: true,
    guns: [],
    rotors: [],
  },
  fob: {
    health: 220,
    radius: 40,
    height: 22,
    texture: "building_fob",
    hulk: "building_fob_hulk",
    frag: "struct",
    rotOff: Math.PI / 2,
    move: "static",
    building: true,
    hv: true,
    spawnYaw: (20 * Math.PI) / 180,
    guns: [],
    rotors: [],
  },
  lookout: {
    health: 90,
    radius: 16,
    height: 46,
    texture: "building_lookout",
    hulk: "building_lookout_hulk",
    frag: "struct",
    rotOff: Math.PI / 2,
    move: "static",
    building: true,
    hv: true,
    spawnYaw: (5 * Math.PI) / 180,
    guns: [],
    rotors: [],
  },
  drone: {
    health: 22,
    radius: 12,
    height: 8,
    flyZ: 36,
    texture: "enemy_drone",
    hulk: "enemy_drone_hulk",
    frag: "mech",
    rotOff: Math.PI / 2,
    move: "drone",
    aerial: true,
    noCrater: true,
    guns: [],
    rotors: [],
  },
  heli_small: {
    health: 48,
    radius: 14,
    height: 12,
    flyZ: 44,
    texture: "enemy_heli_small",
    hulk: "enemy_heli_small_hulk",
    frag: "mech",
    rotOff: Math.PI / 2,
    move: "heli",
    aerial: true,
    noCrater: true,
    fixedAim: true,
    weapon: shell({ fireCd: 0.7, range: 520, speed: 560, dmg: 5, blast: 10, tracer: "small", muzzleLen: 14 }),
    guns: [],
    rotors: [{ tex: "enemy_heli_rotor", origin: { x: 0.5, y: 0.5 }, mount: { x: 0.5, y: 0.42 }, scale: 0.62 }],
  },
  heli_heavy: {
    health: 160,
    radius: 40,
    height: 24,
    flyZ: 52,
    texture: "enemy_heli_heavy",
    hulk: "enemy_heli_heavy_hulk",
    frag: "mech",
    rotOff: Math.PI / 2,
    move: "heli",
    aerial: true,
    noCrater: true,
    throwGuns: true,
    weapon: small({ fireCd: 0.55, range: 700, speed: 640, dmg: 3, blast: 8, burst: 8, burstGap: 0.05, muzzleLen: 16 }),
    guns: SPRITE_MOUNT.enemy_heli_heavy_gun.map((m) => gun("enemy_heli_heavy_gun", 0.78, { ...m })),
    rotors: SPRITE_MOUNT.enemy_heli_heavy_rotor.map((m) => ({
      tex: "enemy_heli_rotor",
      origin: { x: 0.5, y: 0.5 },
      mount: { ...m },
      scale: 1.25,
    })),
  },
};

export function specOf(kind: UnitKind): UnitSpec {
  return SPECS[kind];
}

/** World heading at spawn. Buildings with `spawnYaw` jitter around as-drawn facing. */
export function spawnAngle(kind: UnitKind): number {
  const sp = SPECS[kind];
  if (sp.spawnYaw == null) return Math.random() * Math.PI * 2;
  return -sp.rotOff + (Math.random() * 2 - 1) * sp.spawnYaw;
}

const LOOKOUT_TROOPS: UnitKind[] = ["soldier", "rpg", "gunner", "stinger"];

export function pickLookoutTroop(): UnitKind {
  return LOOKOUT_TROOPS[(Math.random() * LOOKOUT_TROOPS.length) | 0]!;
}

export function allSpecs(): UnitSpec[] {
  return Object.values(SPECS);
}

export function allKinds(): UnitKind[] {
  return Object.keys(SPECS) as UnitKind[];
}

export function isAerial(kind: UnitKind): boolean {
  return !!SPECS[kind].aerial;
}

export function isBuilding(kind: UnitKind): boolean {
  return !!SPECS[kind].building;
}

export function isOrganic(kind: UnitKind): boolean {
  return !!SPECS[kind].organic;
}

export function isWaterCraft(kind: UnitKind): boolean {
  return !!SPECS[kind].water;
}

export function isInfantry(kind: UnitKind): boolean {
  return SPECS[kind].move === "inf" || SPECS[kind].organic === true;
}

export function isGroundVehicle(kind: UnitKind): boolean {
  const m = SPECS[kind].move;
  return m === "tank" || m === "vehicle";
}

const KIND_LABEL: Record<UnitKind, string> = {
  tank: "TANK",
  soldier: "INFANTRY",
  heli: "GUNSHIP",
  boat: "PATROL BOAT",
  tower: "AA TOWER",
  bunker: "BUNKER",
  radar: "RADAR",
  pickup: "PICKUP",
  truck: "TRUCK",
  tanker: "TANKER",
  lav: "LAV",
  sam: "SAM",
  ptboat: "PT BOAT",
  battleship: "BATTLESHIP",
  rpg: "RPG",
  gunner: "GUNNER",
  stinger: "STINGER",
  mechanic: "MECHANIC",
  officer: "OFFICER",
  barn: "BARN",
  tent: "TENT",
  fob: "FOB",
  lookout: "LOOKOUT",
  drone: "DRONE",
  heli_small: "SCOUT HELI",
  heli_heavy: "HEAVY HELI",
};

export function labelOf(kind: UnitKind): string {
  return KIND_LABEL[kind];
}

export function driveOf(kind: UnitKind): DriveSpec {
  switch (kind) {
    case "tank":
      return { maxSpd: 32, accel: 16, brake: 22, turn: 0.7, track: "tread", trackGap: 15, trackScale: 1.05 };
    case "lav":
      return { maxSpd: 48, accel: 28, brake: 32, turn: 1.15, track: "tire", trackGap: 14, trackScale: 0.82 };
    case "sam":
      return { maxSpd: 24, accel: 12, brake: 18, turn: 0.55, track: "dual", trackGap: 16, trackScale: 1 };
    case "pickup":
      return { maxSpd: 92, accel: 48, brake: 40, turn: 1.55, track: "tire", trackGap: 13, trackScale: 0.78 };
    case "truck":
      return { maxSpd: 68, accel: 28, brake: 26, turn: 0.85, track: "dual", trackGap: 15, trackScale: 0.95 };
    case "tanker":
      return { maxSpd: 52, accel: 18, brake: 22, turn: 0.62, track: "wide", trackGap: 16, trackScale: 1.12 };
    default:
      return { maxSpd: 36, accel: 20, brake: 24, turn: 0.8, track: "tire", trackGap: 14, trackScale: 0.85 };
  }
}

export const ROSTER_TEX: string[] = [
  ...new Set(
    Object.values(SPECS).flatMap((s) => [
      s.texture,
      s.hulk,
      ...s.guns.flatMap((g) => [g.tex, g.hulk ?? ""]),
      ...s.rotors.map((r) => r.tex),
      s.dish?.tex ?? "",
    ])
  ),
  "tracer_aa",
].filter(Boolean);
