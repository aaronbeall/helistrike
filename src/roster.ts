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
  | "motorcycle"
  | "lav"
  | "lav_aa"
  | "sam"
  | "ptboat"
  | "battleship"
  | "rpg"
  | "gunner"
  | "mounted_mg"
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

export type TrackKind = "tread" | "tire" | "dual" | "wide" | "mono";

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
  weapon?: WeaponSpec;
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
  /** Soft blood hit spray / death streaks in addition to normal wreck FX (e.g. motorcycle rider). */
  softBlood?: boolean;
  hv?: boolean;
  noCrater?: boolean;
  throwGuns?: boolean;
  /** Spawn 1–2 rolling wheel debris on death (wheeled vehicles). */
  wheels?: number;
  /** Hull/body aim only; cannot traverse a turret. Must face the target to fire. */
  fixedAim?: boolean;
  spawnYaw?: number;
  /**
   * Optional pinned crew seats on this hull.
   * `snap` = glued to mount UV (moving vehicles); `leash` = roam within leashR (static posts).
   */
  crew?: CrewSpec;
}

export type PinMode = "snap" | "leash";

export interface CrewSpec {
  mounts: { x: number; y: number }[];
  mode: PinMode;
  /** Fill probability per mount (default 1). */
  chance?: number;
  /** Leash roam radius; defaults to host unit radius when omitted. */
  leashR?: number;
}

const gun = (
  tex: string,
  originY = 0.22,
  mount = { x: 0.5, y: 0.48 },
  hulk?: string,
  weapon?: WeaponSpec
): PartMount => {
  const muzzles = lookupSpriteMuzzles(tex);
  return {
    tex,
    hulk: hulk ?? `${tex}_hulk`,
    origin: lookupSpriteOrigin(tex) ?? { x: 0.5, y: originY },
    mount,
    muzzle: muzzles[0] ?? { x: 0.5, y: 0.08 },
    muzzles: muzzles.length ? muzzles : undefined,
    weapon,
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

/** Shared named presets — same object refs as SPECS / roll tables (combat rig scans these). */
export const WPN_ARTY = shell({ fireCd: 1.35, range: 860, speed: 480, dmg: 16, blast: 22, muzzleLen: 32 });
export const WPN_AA = small({
  fireCd: 3.1,
  range: 680,
  speed: 820,
  dmg: 1,
  blast: 3,
  burst: 28,
  burstGap: 0.035,
  tracer: "aa",
  muzzleLen: 18,
  jitter: 0.04,
});
export const WPN_SAM: WeaponSpec = {
  fireCd: 2.8,
  range: 820,
  speed: 300,
  dmg: 18,
  blast: 22,
  tracer: "shell",
  shot: "hellfire",
  jitter: 0.02,
  muzzleLen: 16,
};
/** Tower “arty” roll + default tower body — not WPN_ARTY. */
export const WPN_TOWER_CANNON = shell({
  fireCd: 0.5,
  range: 700,
  speed: 920,
  dmg: 12,
  blast: 10,
  tracer: "aa",
  muzzleLen: 24,
});

/** Factory templates (fresh objects — SPECS usually call shell/small with overrides). */
export const WPN_SHELL_DEFAULT = shell();
export const WPN_SMALL_DEFAULT = small();

export type GunRollId = "arty" | "aa" | "sam";

export type GunRollSpec = { tex: string; originY: number; w: WeaponSpec };

/** Tower `rollParts` options — weapon refs drive combat-rig “used by”. */
export const TOWER_GUN_ROLLS: Record<GunRollId, GunRollSpec> = {
  arty: { tex: "building_tower_gun", originY: 1.39, w: WPN_TOWER_CANNON },
  aa: { tex: "building_tower_aa", originY: 1.36, w: WPN_AA },
  sam: { tex: "building_tower_sam", originY: 1.25, w: WPN_SAM },
};

/** Battleship fixed mounts / `shipGun` options. */
export const SHIP_GUN_ROLLS: Record<GunRollId, GunRollSpec> = {
  arty: { tex: "enemy_battleship_gun", originY: 0.8, w: WPN_ARTY },
  aa: { tex: "enemy_battleship_gun_aa", originY: 0.72, w: WPN_AA },
  sam: { tex: "enemy_battleship_gun_sam", originY: 0.7, w: WPN_SAM },
};

/** Battleship mount order (indices match SPRITE_MOUNT.enemy_battleship). */
export const BATTLESHIP_MOUNT_ROLLS: GunRollId[] = ["arty", "aa", "sam", "arty"];

/** Named enemy weapon presets shown in the combat rig (stats + live used-by). */
export const ENEMY_WPN_PRESETS: { id: string; label: string; w: WeaponSpec }[] = [
  { id: "shell", label: "SHELL (default)", w: WPN_SHELL_DEFAULT },
  { id: "small", label: "SMALL (default)", w: WPN_SMALL_DEFAULT },
  { id: "arty", label: "ARTY", w: WPN_ARTY },
  { id: "aa", label: "AA BURST", w: WPN_AA },
  { id: "sam", label: "SAM", w: WPN_SAM },
  { id: "tower_cannon", label: "TOWER CANNON", w: WPN_TOWER_CANNON },
];

/**
 * Where this exact WeaponSpec object is referenced (SPECS body/guns + roll tables).
 * Empty → factory template / unused shared ref.
 */
export function usesOfWeapon(w: WeaponSpec): string[] {
  const uses: string[] = [];
  for (const kind of Object.keys(SPECS) as UnitKind[]) {
    const sp = SPECS[kind];
    if (sp.weapon === w) uses.push(`${kind} body`);
    sp.guns.forEach((g, i) => {
      if (g.weapon === w) uses.push(`${kind} gun[${i}]`);
    });
  }
  for (const id of Object.keys(TOWER_GUN_ROLLS) as GunRollId[]) {
    if (TOWER_GUN_ROLLS[id]!.w === w) uses.push(`tower roll:${id}`);
  }
  for (const id of Object.keys(SHIP_GUN_ROLLS) as GunRollId[]) {
    if (SHIP_GUN_ROLLS[id]!.w === w) {
      const mounts = BATTLESHIP_MOUNT_ROLLS.map((r, i) => (r === id ? i : -1)).filter((i) => i >= 0);
      uses.push(
        mounts.length
          ? `battleship mount:${id} [${mounts.join(",")}]`
          : `battleship mount:${id}`
      );
    }
  }
  return uses;
}

/** Projectile texture for a WeaponSpec / shot kind (combat + roster previews). */
export function shotTexture(shot: WeaponSpec["shot"], tracer?: WeaponSpec["tracer"]): string {
  if (shot === "rocket") return "rocket";
  if (shot === "hellfire") return "hellfire";
  if (tracer === "aa") return "tracer_aa";
  if (tracer === "small") return "tracer_sm";
  if (tracer === "shell") return "shell";
  if (tracer === "chain") return "cannon";
  return "cannon";
}

function pickGunVar(): GunRollId {
  const r = Math.random();
  if (r < 0.34) return "arty";
  if (r < 0.67) return "aa";
  return "sam";
}

function shipGun(v: GunRollId, mount: { x: number; y: number }): PartMount {
  const r = SHIP_GUN_ROLLS[v]!;
  return gun(r.tex, r.originY, mount, undefined, r.w);
}

function towerGun(v: GunRollId): PartMount {
  const r = TOWER_GUN_ROLLS[v]!;
  return gun(r.tex, r.originY, { ...SPRITE_MOUNT.building_tower }, undefined, r.w);
}

export function rollParts(kind: UnitKind): PartMount[] | undefined {
  if (kind === "tower") return [towerGun(pickGunVar())];
  if (kind === "battleship") {
    const m = SPRITE_MOUNT.enemy_battleship;
    return BATTLESHIP_MOUNT_ROLLS.map((roll, i) => shipGun(roll, { ...m[i]! }));
  }
  return undefined;
}

export function gunsOf(u: { kind: UnitKind; parts?: PartMount[] }): PartMount[] {
  return u.parts ?? SPECS[u.kind].guns;
}

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
    guns: [gun("enemy_tank_gun", 0.78, { ...SPRITE_MOUNT.enemy_tank }, "enemy_tank_gun_hulk")],
    rotors: [],
  },
  soldier: {
    health: 8,
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
    weapon: shell({ fireCd: 1.4, range: 640, speed: 520, dmg: 3, blast: 8, muzzleLen: 18, burst: 3, burstGap: 0.13 }),
    guns: [gun("enemy_heli_gun", 0.72, { ...SPRITE_MOUNT.enemy_heli })],
    rotors: [{ tex: "enemy_heli_rotor", hulk: "enemy_heli_rotor_hulk", origin: { x: 0.5, y: 0.5 }, mount: { x: 0.497, y: 0.411 }, scale: 1 }],
  },
  boat: {
    health: 70,
    radius: 28,
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
    guns: [gun("enemy_boat_gun", 0.74, { ...SPRITE_MOUNT.enemy_boat })],
    rotors: [],
  },
  tower: {
    health: 110,
    radius: 28,
    height: 48,
    texture: "building_tower",
    hulk: "building_tower_hulk",
    frag: "struct",
    rotOff: Math.PI / 2,
    move: "static",
    building: true,
    throwGuns: true,
    spawnYaw: (5 * Math.PI) / 180,
    weapon: WPN_TOWER_CANNON,
    guns: [gun("building_tower_gun", 1.39, { ...SPRITE_MOUNT.building_tower })],
    rotors: [],
  },
  bunker: {
    health: 260,
    radius: 48,
    height: 32,
    texture: "building_bunker",
    hulk: "building_bunker_hulk",
    frag: "struct",
    rotOff: Math.PI / 2,
    move: "static",
    building: true,
    spawnYaw: (45 * Math.PI) / 180,
    guns: [],
    rotors: [],
    crew: { mounts: [...SPRITE_MOUNT.building_bunker], mode: "leash", leashR: 38 },
  },
  radar: {
    health: 200,
    radius: 72,
    height: 56,
    texture: "building_radar",
    hulk: "building_radar_hulk",
    frag: "struct",
    rotOff: Math.PI / 2,
    move: "static",
    building: true,
    spawnYaw: (5 * Math.PI) / 180,
    guns: [],
    rotors: [],
    dish: {
      tex: "building_radar_disk",
      hulk: "building_radar_disk_hulk",
      origin: { x: 0.5, y: 0.5 },
      mount: { ...SPRITE_MOUNT.building_radar },
      scale: 1,
    },
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
    wheels: 2,
    guns: [],
    rotors: [],
    crew: { mounts: [{ ...SPRITE_MOUNT.enemy_pickup }], mode: "snap", chance: 0.33 },
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
    wheels: 2,
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
    wheels: 2,
    guns: [],
    rotors: [],
  },
  motorcycle: {
    health: 8,
    radius: 12,
    height: 10,
    texture: "enemy_motorcycle",
    hulk: "enemy_motorcycle_hulk",
    frag: "mech",
    rotOff: Math.PI / 2,
    move: "vehicle",
    softBlood: true,
    wheels: 2,
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
    wheels: 2,
    weapon: shell({ fireCd: 1.15, range: 440, dmg: 6, blast: 12, muzzleLen: 20 }),
    guns: [gun("enemy_lav_gun", 0.76, { ...SPRITE_MOUNT.enemy_lav })],
    rotors: [],
  },
  lav_aa: {
    health: 54,
    radius: 18,
    height: 18,
    texture: "enemy_lav",
    hulk: "enemy_lav_hulk",
    frag: "mech",
    rotOff: Math.PI / 2,
    move: "tank",
    throwGuns: true,
    wheels: 2,
    weapon: WPN_AA,
    guns: [
      {
        ...gun("building_tower_aa", 0.9, { ...SPRITE_MOUNT.enemy_lav }),
        scale: 0.83,
      },
    ],
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
    radius: 14,
    height: 12,
    texture: "enemy_ptboat",
    hulk: "enemy_ptboat_hulk",
    frag: "mech",
    rotOff: Math.PI / 2,
    move: "boat",
    water: true,
    noCrater: true,
    throwGuns: true,
    weapon: small({ fireCd: 0.85, range: 420, speed: 560, dmg: 3, blast: 6, muzzleLen: 16, burst: 3, burstGap: 0.09 }),
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
    move: "static",
    water: true,
    noCrater: true,
    throwGuns: true,
    weapon: WPN_ARTY,
    guns: (() => {
      const m = SPRITE_MOUNT.enemy_battleship;
      return [
        shipGun("arty", { ...m[0]! }),
        shipGun("aa", { ...m[1]! }),
        shipGun("sam", { ...m[2]! }),
        shipGun("arty", { ...m[3]! }),
      ];
    })(),
    rotors: [],
  },
  rpg: {
    health: 9,
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
    health: 10,
    radius: 11,
    height: 9,
    texture: "enemy_troop_gunner",
    hulk: "enemy_troop_gunner_hulk",
    frag: "organic",
    rotOff: Math.PI / 2,
    move: "inf",
    organic: true,
    fixedAim: true,
    weapon: small({
      fireCd: 1.35,
      range: 380,
      speed: 560,
      dmg: 1,
      blast: 4,
      burst: 17,
      burstGap: 0.038,
      muzzleLen: 14,
      tracer: "chain",
      jitter: 0.045,
    }),
    guns: [],
    rotors: [],
  },
  mounted_mg: {
    health: 12,
    radius: 12,
    height: 12,
    texture: "enemy_troop_mounted_mg",
    hulk: "enemy_troop_mounted_mg_hulk",
    frag: "organic",
    rotOff: Math.PI / 2,
    move: "static",
    organic: true,
    fixedAim: true,
    weapon: small({
      fireCd: 1.15,
      range: 460,
      speed: 600,
      dmg: 1,
      blast: 4,
      burst: 20,
      burstGap: 0.034,
      muzzleLen: 16,
      tracer: "chain",
      jitter: 0.04,
    }),
    guns: [],
    rotors: [],
  },
  stinger: {
    health: 9,
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
      jitter: 0.02,
      muzzleLen: 12,
    },
    guns: [],
    rotors: [],
  },
  mechanic: {
    health: 7,
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
    health: 11,
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
    radius: 52,
    height: 28,
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
    radius: 22,
    height: 56,
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
    crew: { mounts: [{ ...SPRITE_MOUNT.building_lookout }], mode: "leash", leashR: 17 },
  },
  drone: {
    health: 22,
    radius: 6,
    height: 6,
    flyZ: 36,
    texture: "enemy_drone",
    hulk: "enemy_drone_hulk",
    frag: "mech",
    rotOff: Math.PI / 2,
    move: "drone",
    aerial: true,
    noCrater: true,
    guns: [],
    rotors: SPRITE_MOUNT.enemy_drone.map((m) => ({
      tex: "enemy_drone_rotor",
      hulk: "enemy_drone_rotor_hulk",
      origin: { x: 0.5, y: 0.5 },
      mount: { ...m },
      scale: 1,
    })),
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
    weapon: small({
      fireCd: 1.15,
      range: 700,
      speed: 680,
      dmg: 3,
      blast: 8,
      burst: 5,
      burstGap: 0.1,
      muzzleLen: 14,
      tracer: "chain",
      jitter: 0.04,
    }),
    guns: [],
    rotors: [{ tex: "enemy_heli_rotor", hulk: "enemy_heli_rotor_hulk", origin: { x: 0.5, y: 0.5 }, mount: { x: 0.5, y: 0.42 }, scale: 0.62 }],
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
    weapon: small({
      fireCd: 0.4,
      range: 700,
      speed: 680,
      dmg: 3,
      blast: 8,
      burst: 40,
      burstGap: 0.055,
      muzzleLen: 16,
      tracer: "chain",
      jitter: 0.04,
    }),
    guns: SPRITE_MOUNT.enemy_heli_heavy_gun.map((m) => ({
      ...gun("enemy_heli_heavy_gun", 0.78, { ...m }),
      scale: 0.58,
    })),
    rotors: SPRITE_MOUNT.enemy_heli_heavy_rotor.map((m) => ({
      tex: "enemy_heli_rotor",
      hulk: "enemy_heli_rotor_hulk",
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

const TROOP_WEIGHTS: [UnitKind, number][] = [
  ["soldier", 40],
  ["rpg", 22],
  ["gunner", 14],
  ["mechanic", 10],
  ["stinger", 7],
  ["mounted_mg", 4],
  ["officer", 2],
];

export function pickTroop(rand = Math.random): UnitKind {
  const r = rand() * TROOP_WEIGHTS.reduce((s, [, w]) => s + w, 0);
  let acc = 0;
  for (const [kind, w] of TROOP_WEIGHTS) {
    acc += w;
    if (r < acc) return kind;
  }
  return "soldier";
}

export function pickLookoutTroop(): UnitKind {
  return pickTroop();
}

export function pickPickupTroop(): UnitKind {
  return pickTroop();
}

export function crewOf(kind: UnitKind): CrewSpec | undefined {
  return SPECS[kind].crew;
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

/** Soft blood hit spray / death streaks (troops, or vehicles with a rider like motorcycle). */
export function hasSoftBlood(kind: UnitKind): boolean {
  return !!SPECS[kind].organic || !!SPECS[kind].softBlood;
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
  motorcycle: "MOTORCYCLE",
  lav: "LAV",
  lav_aa: "LAV-AA",
  sam: "SAM",
  ptboat: "PT BOAT",
  battleship: "BATTLESHIP",
  rpg: "RPG TROOP",
  gunner: "GUNNER TROOP",
  mounted_mg: "MOUNTED MG TROOP",
  stinger: "STINGER TROOP",
  mechanic: "MECHANIC TROOP",
  officer: "OFFICER TROOP",
  barn: "BARN",
  tent: "TENT",
  fob: "FOB",
  lookout: "LOOKOUT",
  drone: "DRONE",
  heli_small: "SCOUT HELI",
  heli_heavy: "HEAVY HELI",
};

export function labelOf(kind: UnitKind): string {
  return KIND_LABEL[kind] ?? kind.replace(/_/g, " ").toUpperCase();
}

export function driveOf(kind: UnitKind): DriveSpec {
  switch (kind) {
    case "tank":
      return { maxSpd: 32, accel: 16, brake: 22, turn: 0.7, track: "tread", trackGap: 15, trackScale: 1.05 };
    case "lav":
      return { maxSpd: 48, accel: 28, brake: 32, turn: 1.15, track: "tire", trackGap: 14, trackScale: 0.82 };
    case "lav_aa":
      return { maxSpd: 42, accel: 24, brake: 30, turn: 1.05, track: "tire", trackGap: 14, trackScale: 0.82 };
    case "sam":
      return { maxSpd: 24, accel: 12, brake: 18, turn: 0.55, track: "dual", trackGap: 16, trackScale: 1 };
    case "pickup":
      return { maxSpd: 92, accel: 48, brake: 40, turn: 1.55, track: "tire", trackGap: 13, trackScale: 0.78 };
    case "motorcycle":
      return { maxSpd: 138, accel: 72, brake: 48, turn: 2.35, track: "mono", trackGap: 16, trackScale: 0.7 };
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
      ...s.rotors.flatMap((r) => [r.tex, r.hulk ?? ""]),
      s.dish?.tex ?? "",
      s.dish?.hulk ?? "",
    ])
  ),
  "tracer_aa",
  "enemy_battleship_gun_aa",
  "enemy_battleship_gun_sam",
  "enemy_battleship_gun_aa_hulk",
  "enemy_battleship_gun_sam_hulk",
  "building_tower_aa",
  "building_tower_sam",
  "building_tower_aa_hulk",
  "building_tower_sam_hulk",
  "enemy_drone_rotor",
  "enemy_drone_rotor_hulk",
  "enemy_heli_rotor_hulk",
].filter(Boolean);
