import { lookupSpriteMuzzles, lookupSpriteOrigin, mountOf, mountsOf } from "./spriteOrigin";

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

export type DebrisCat = "mech" | "struct" | "organic";

/** Projectile texture key (= Phaser texture name). */
export type ShotLook = string;

/** Projectile flight behavior (independent of art `look`). */
export type ShotKind = "cannon" | "rocket" | "lock-on-missile" | "guided-missile";

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
  /** Emit tips on this part texture (gun) — empty/omit → default single tip. */
  muzzles?: { x: number; y: number }[];
  scale?: number;
  weapon?: WeaponSpec;
}

export type MuzzleFireMode = "alternate" | "simultaneous";

export interface WeaponSpec {
  fireCd: number;
  range: number;
  speed: number;
  dmg: number;
  blast: number;
  /** Flight behavior: ballistic cannon, rocket, seeking hellfire, TOW. */
  kind: ShotKind;
  /** Projectile texture key. */
  look: ShotLook;
  /** Projectile draw scale (baked size for this preset). */
  scale: number;
  burst?: number;
  burstGap?: number;
  jitter?: number;
  /** Explicitly cycle authored muzzle tips; omitted weapons fire from the first tip. */
  muzzleFire?: "alternate";
}

/**
 * Hull hardpoint ordnance (e.g. seeker missiles). Separate from body `weapon` / `guns`.
 * Cadence rolls between fireCdMin/Max; mount firing behavior is explicit.
 * Geometry uses SPRITE_SPECS `hardpoint` points.
 */
export interface SecondaryWpnSpec {
  wpn: WeaponSpec;
  mounts: { x: number; y: number }[];
  mountFire: MuzzleFireMode;
  fireCdMin: number;
  fireCdMax: number;
  /** Multiplier on `wpn.scale` for this hardpoint. */
  scale?: number;
  /** Pre-ignite motor timer (negative = delay before burn). */
  motor?: number;
  /** Home on the player (default true). */
  homePlayer?: boolean;
  /** Min engagement range (default 80). */
  minRange?: number;
  /** Max |aim error| rad to fire (default π/2). */
  aimCone?: number;
}

/**
 * Tagged hull UV roles (SPRITE_SPECS point roles minus muzzle).
 * Shared by craft mounts and rig overlays.
 */
export type HullMountRole = "gun" | "rotor" | "dish" | "troop" | "hardpoint" | "exhaust";

export interface HullMount {
  x: number;
  y: number;
  role: HullMountRole;
  label: string;
}

/** Shared marker colors for sprite / roster rigs. */
export const HULL_MOUNT_COLOR: Record<HullMountRole, number> = {
  gun: 0x6adf6a,
  rotor: 0x5ec8ff,
  dish: 0xe8b84a,
  troop: 0xd878ff,
  hardpoint: 0xff8c42,
  exhaust: 0xb04aff
};

/** Suffix labels when a role appears more than once (`gun 1`, `secondary 2`). */
export function numberMountLabels(list: { role: string; label: string }[]): void {
  const total = new Map<string, number>();
  for (const m of list) total.set(m.role, (total.get(m.role) ?? 0) + 1);
  const seen = new Map<string, number>();
  for (const m of list) {
    if ((total.get(m.role) ?? 0) <= 1) continue;
    const i = (seen.get(m.role) ?? 0) + 1;
    seen.set(m.role, i);
    m.label = `${m.label} ${i}`;
  }
}

export interface UnitSpec {
  /** Display name (roster / HUD). */
  label: string;
  health: number;
  /** Visual / FX size (craters, death blast, UI). Hit uses `box` when set, else this. */
  radius: number;
  /**
   * Oriented rectangle footprint (length along facing). When set, shot/sep/reticle
   * use this instead of a circle. Does not change `radius` (keep radius as visual size).
   */
  box?: { halfW: number; halfL: number };
  height: number;
  flyZ?: number;
  texture: string;
  hulk: string;
  debris: DebrisCat;
  rotOff: number;
  move: MoveKind;
  /** Ground locomotion (tank / vehicle). Omitted for non-driving kinds. */
  drive?: DriveSpec;
  weapon?: WeaponSpec;
  /**
   * Optional hull hardpoint ordnance (seeker missiles, etc.).
   * Fired by scenes from `mounts` (SPRITE `hardpoint` UVs) — not via SPECS.guns.
   */
  secondary?: SecondaryWpnSpec;
  guns: PartMount[];
  /** Explicitly cycle separate gun mounts after each completed burst. */
  gunFire?: "alternate";
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
  /**
   * Optional gun parts roll. When set, owns live spawn guns (`rollParts`) and
   * SPECS.guns preview — no separate PARTS_ROLLS table.
   * `pick` = weighted random; `fixed` = declared mounts.
   */
  partsRoll?: PartsRoll;
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

export type GunRollId = string;

export type GunRollSpec = {
  tex: string;
  originY: number;
  w: WeaponSpec;
  /** Short id for rigs / used-by (defaults to option key). */
  label?: string;
};

/** Weighted pick: one option chosen at spawn via `rollParts`. */
export type PartsPickRoll = {
  mode: "pick";
  weights: [GunRollId, number][];
  options: Record<GunRollId, GunRollSpec>;
  mount: { x: number; y: number };
  /** SPECS.guns / preview fallback (defaults to first weight). */
  fallback?: GunRollId;
};

/** Fixed slots: each mount gets a declared option (not random). */
export type PartsFixedRoll = {
  mode: "fixed";
  options: Record<GunRollId, GunRollSpec>;
  slots: { id: GunRollId; mount: { x: number; y: number } }[];
};

export type PartsRoll = PartsPickRoll | PartsFixedRoll;

const gun = (
  tex: string,
  originY = 0.22,
  mount = { x: 0.5, y: 0.48 },
  hulk?: string,
  weapon?: WeaponSpec
): PartMount => {
  const tips = lookupSpriteMuzzles(tex);
  return {
    tex,
    hulk: hulk ?? `${tex}_hulk`,
    origin: lookupSpriteOrigin(tex) ?? { x: 0.5, y: originY },
    mount,
    muzzles: tips.length ? tips : [{ x: 0.5, y: 0.08 }],
    weapon
  };
};

/** Gun-part emit tips (always ≥1). */
export function muzzlesOfGun(gun: Pick<PartMount, "muzzles">): { x: number; y: number }[] {
  return gun.muzzles?.length ? gun.muzzles : [{ x: 0.5, y: 0.08 }];
}

export type EnemyWpnId = "he" | "mg" | "arty" | "aa" | "seeker" | "tower_cannon";

/**
 * Shared named enemy weapons — combat rig iterates this list.
 * Each `w` is a stable identity for usesOfWeapon / SPECS refs.
 */
export const ENEMY_WPNS: { id: EnemyWpnId; label: string; w: WeaponSpec }[] = [
  {
    id: "he",
    label: "HE SHELL",
    w: {
      kind: "cannon",
      fireCd: 0.9,
      range: 500,
      speed: 420,
      dmg: 8,
      blast: 16,
      look: "shot_shell",
      scale: 0.72,
    },
  },
  {
    id: "mg",
    label: "LMG",
    w: {
      kind: "cannon",
      fireCd: 1.05,
      range: 280,
      speed: 380,
      dmg: 1,
      blast: 5,
      look: "shot_small",
      scale: 0.46,
      burst: 3,
      burstGap: 0.075,
      jitter: 0.05,
    },
  },
  {
    id: "arty",
    label: "ARTY",
    w: {
      kind: "cannon",
      fireCd: 1.35,
      range: 860,
      speed: 480,
      dmg: 16,
      blast: 22,
      look: "shot_shell",
      scale: 0.72,
      muzzleFire: "alternate",
    },
  },
  {
    id: "aa",
    label: "AA BURST",
    w: {
      kind: "cannon",
      fireCd: 3.1,
      range: 680,
      speed: 820,
      dmg: 1,
      blast: 3,
      look: "shot_aa",
      scale: 0.95,
      burst: 28,
      burstGap: 0.035,
      jitter: 0.04,
      muzzleFire: "alternate",
    },
  },
  {
    id: "seeker",
    label: "SEEKER",
    w: {
      kind: "lock-on-missile",
      fireCd: 2.8,
      range: 820,
      speed: 300,
      dmg: 18,
      blast: 22,
      look: "shot_hellfire",
      scale: 1,
      jitter: 0.02,
      muzzleFire: "alternate",
    },
  },
  {
    id: "tower_cannon",
    label: "TOWER CANNON",
    w: {
      kind: "cannon",
      fireCd: 0.5,
      range: 700,
      speed: 920,
      dmg: 12,
      blast: 10,
      look: "shot_aa",
      scale: 0.95,
    },
  },
];

/** Stable refs into ENEMY_WPNS (`WPN.arty`, `WPN.aa`, …). */
export const WPN = Object.fromEntries(ENEMY_WPNS.map((p) => [p.id, p.w])) as {
  [K in EnemyWpnId]: WeaponSpec;
};

/** Fork a named preset (new object). */
export function wpn(id: EnemyWpnId, over: Partial<WeaponSpec> = {}): WeaponSpec {
  return { ...WPN[id], ...over };
}

export function partsRollOf(kind: UnitKind): PartsRoll | undefined {
  return UNIT_SPECS[kind].partsRoll;
}

export function weaponPresetId(w: WeaponSpec): string {
  for (const p of ENEMY_WPNS) {
    if (p.w === w) return p.id;
  }
  return w.look;
}

function pickWeighted(weights: [GunRollId, number][], rand = Math.random): GunRollId {
  const total = weights.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [id, w] of weights) {
    r -= w;
    if (r < 0) return id;
  }
  return weights[weights.length - 1]![0];
}

function partFromOption(opt: GunRollSpec, mount: { x: number; y: number }): PartMount {
  return gun(opt.tex, opt.originY, mount, undefined, opt.w);
}

function gunsFromPartsRoll(roll: PartsRoll): PartMount[] {
  if (roll.mode === "pick") {
    const id = roll.fallback ?? roll.weights[0]![0];
    return [partFromOption(roll.options[id]!, { ...roll.mount })];
  }
  return roll.slots.map((s) => partFromOption(roll.options[s.id]!, { ...s.mount }));
}

/** SPECS.guns fallback / roster preview from unit `partsRoll` (not a live roll). */
export function defaultGunsFromRoll(kind: UnitKind): PartMount[] | undefined {
  const roll = partsRollOf(kind);
  return roll ? gunsFromPartsRoll(roll) : undefined;
}

/** Pick-mode option ids in weight order (then any extras). Empty if no pick roll. */
export function partsRollPickIds(kind: UnitKind): string[] {
  const roll = partsRollOf(kind);
  if (!roll || roll.mode !== "pick") return [];
  const ids = roll.weights.map(([id]) => id);
  for (const id of Object.keys(roll.options)) {
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** Preview / inspect guns for one pick-mode option (undefined if missing). */
export function gunsForPartsRollOption(kind: UnitKind, optionId: string): PartMount[] | undefined {
  const roll = partsRollOf(kind);
  if (!roll || roll.mode !== "pick") return undefined;
  const opt = roll.options[optionId];
  if (!opt) return undefined;
  return [partFromOption(opt, { ...roll.mount })];
}

/**
 * Where this exact WeaponSpec object is referenced (SPECS body/secondary/guns + partsRoll).
 * Empty → factory template / unused shared ref.
 */
export function usesOfWeapon(w: WeaponSpec): string[] {
  const uses: string[] = [];
  for (const kind of Object.keys(UNIT_SPECS) as UnitKind[]) {
    const sp = UNIT_SPECS[kind];
    if (sp.weapon === w) uses.push(`${kind} body`);
    if (sp.secondary?.wpn === w) uses.push(`${kind} secondary`);
    if (sp.partsRoll) {
      for (const [id, opt] of Object.entries(sp.partsRoll.options)) {
        if (opt.w !== w) continue;
        const tag = opt.label ?? id;
        if (sp.partsRoll.mode === "pick") {
          const wt = sp.partsRoll.weights.find(([k]) => k === id)?.[1];
          uses.push(wt != null ? `${kind} roll:${tag} w${wt}` : `${kind} roll:${tag}`);
        } else {
          const mounts = sp.partsRoll.slots
            .map((s, i) => (s.id === id ? i : -1))
            .filter((i) => i >= 0);
          uses.push(
            mounts.length ? `${kind} mount:${tag} [${mounts.join(",")}]` : `${kind} mount:${tag}`
          );
        }
      }
      continue;
    }
    sp.guns.forEach((g, i) => {
      if (g.weapon === w) uses.push(`${kind} gun[${i}]`);
    });
  }
  return uses;
}

const CAMO_SUFFIX = /__(woodland|desert|urban|snow|digital)$/;

function texKeyBase(tex: string): string {
  return tex.replace(CAMO_SUFFIX, "");
}

/**
 * Roster unit labels that reference this texture (hull / hulk / gun / rotor / dish / partsRoll).
 * Camo suffixes are stripped for matching. Empty → art-only / player craft / unused.
 */
export function usesOfTexture(tex: string): string[] {
  const k = texKeyBase(tex);
  const uses: string[] = [];
  const hit = (t: string) => texKeyBase(t) === k;
  /** Default hulk key when PartMount / GunRollSpec omits `hulk` (see `gun()`). */
  const hitGun = (gunTex: string, hulk?: string) => hit(gunTex) || hit(hulk ?? `${gunTex}_hulk`);
  for (const kind of Object.keys(UNIT_SPECS) as UnitKind[]) {
    const sp = UNIT_SPECS[kind];
    let used =
      hit(sp.texture) ||
      hit(sp.hulk) ||
      sp.rotors.some((r) => hitGun(r.tex, r.hulk)) ||
      !!(sp.dish && hitGun(sp.dish.tex, sp.dish.hulk));
    if (!used && sp.partsRoll) {
      used = Object.values(sp.partsRoll.options).some((opt) => hitGun(opt.tex));
    } else if (!used) {
      used = sp.guns.some((g) => hitGun(g.tex, g.hulk));
    }
    if (used) uses.push(sp.label);
  }
  return uses;
}

/** Live spawn guns from unit `partsRoll` (undefined → use SPECS.guns). */
export function rollParts(kind: UnitKind): PartMount[] | undefined {
  const roll = partsRollOf(kind);
  if (!roll) return undefined;
  if (roll.mode === "pick") {
    const id = pickWeighted(roll.weights);
    return [partFromOption(roll.options[id]!, { ...roll.mount })];
  }
  return roll.slots.map((s) => partFromOption(roll.options[s.id]!, { ...s.mount }));
}

export function gunsOf(u: { kind: UnitKind; parts?: PartMount[] }): PartMount[] {
  return u.parts ?? defaultGunsFromRoll(u.kind) ?? UNIT_SPECS[u.kind].guns;
}

const UNIT_SPECS: Record<UnitKind, UnitSpec> = {
  tank: {
    label: "TANK",
    health: 90,
    radius: 22,
    box: { halfW: 19, halfL: 34 },
    height: 20,
    texture: "enemy_tank",
    hulk: "enemy_tank_hulk",
    debris: "mech",
    rotOff: Math.PI / 2,
    move: "tank",
    drive: { maxSpd: 32, accel: 16, brake: 22, turn: 0.7, track: "tread", trackGap: 15, trackScale: 1.05 },
    throwGuns: true,
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
    move: "inf",
    organic: true,
    fixedAim: true,
    weapon: wpn("mg", { scale: 0.529 }),
    guns: [],
    rotors: []
  },
  heli: {
    label: "GUNSHIP",
    health: 80,
    radius: 22,
    height: 16,
    flyZ: 48,
    texture: "enemy_heli",
    hulk: "enemy_heli_hulk",
    debris: "mech",
    rotOff: Math.PI / 2,
    move: "heli",
    aerial: true,
    noCrater: true,
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
    health: 70,
    radius: 28,
    box: { halfW: 13, halfL: 44 },
    height: 16,
    texture: "enemy_boat",
    hulk: "enemy_boat_hulk",
    debris: "mech",
    rotOff: Math.PI / 2,
    move: "boat",
    water: true,
    noCrater: true,
    throwGuns: true,
    weapon: wpn("he", { fireCd: 1.15, range: 480}),
    guns: [gun("enemy_boat_gun", 0.74, mountOf("enemy_boat", "gun"))],
    rotors: []
  },
  tower: {
    label: "AA TOWER",
    health: 110,
    radius: 28,
    box: { halfW: 34, halfL: 37 },
    height: 48,
    texture: "building_tower",
    hulk: "building_tower_hulk",
    debris: "struct",
    rotOff: Math.PI / 2,
    move: "static",
    building: true,
    throwGuns: true,
    spawnYaw: (5 * Math.PI) / 180,
    weapon: WPN.tower_cannon,
    guns: [],
    rotors: [],
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
  },
  bunker: {
    label: "BUNKER",
    health: 260,
    radius: 54,
    height: 32,
    texture: "building_bunker",
    hulk: "building_bunker_hulk",
    debris: "struct",
    rotOff: Math.PI / 2,
    move: "static",
    building: true,
    spawnYaw: (45 * Math.PI) / 180,
    guns: [],
    rotors: [],
    crew: { mounts: mountsOf("building_bunker", "troop"), mode: "leash", leashR: 38 }
  },
  radar: {
    label: "RADAR",
    health: 200,
    radius: 72,
    box: { halfW: 57, halfL: 104 },
    height: 56,
    texture: "building_radar",
    hulk: "building_radar_hulk",
    debris: "struct",
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
      mount: mountOf("building_radar", "dish"),
      scale: 1
    }
  },
  pickup: {
    label: "PICKUP",
    health: 42,
    radius: 18,
    box: { halfW: 11, halfL: 28 },
    height: 14,
    texture: "enemy_pickup",
    hulk: "enemy_pickup_hulk",
    debris: "mech",
    rotOff: Math.PI / 2,
    move: "vehicle",
    drive: { maxSpd: 92, accel: 48, brake: 40, turn: 1.55, track: "tire", trackGap: 13, trackScale: 0.78 },
    wheels: 2,
    guns: [],
    rotors: [],
    crew: { mounts: [mountOf("enemy_pickup", "troop")], mode: "snap", chance: 0.33 }
  },
  truck: {
    label: "TRUCK",
    health: 55,
    radius: 20,
    box: { halfW: 14, halfL: 32 },
    height: 16,
    texture: "enemy_truck",
    hulk: "enemy_truck_hulk",
    debris: "mech",
    rotOff: Math.PI / 2,
    move: "vehicle",
    drive: { maxSpd: 68, accel: 28, brake: 26, turn: 0.85, track: "dual", trackGap: 15, trackScale: 0.95 },
    wheels: 2,
    guns: [],
    rotors: []
  },
  tanker: {
    label: "TANKER",
    health: 70,
    radius: 22,
    box: { halfW: 13, halfL: 33 },
    height: 16,
    texture: "enemy_tanker",
    hulk: "enemy_tanker_hulk",
    debris: "mech",
    rotOff: Math.PI / 2,
    move: "vehicle",
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
    hulk: "enemy_motorcycle_hulk",
    debris: "mech",
    rotOff: Math.PI / 2,
    move: "vehicle",
    drive: { maxSpd: 138, accel: 72, brake: 48, turn: 2.35, track: "mono", trackGap: 16, trackScale: 0.7 },
    softBlood: true,
    wheels: 2,
    guns: [],
    rotors: []
  },
  lav: {
    label: "LAV",
    health: 62,
    radius: 18,
    box: { halfW: 13, halfL: 27 },
    height: 16,
    texture: "enemy_lav",
    hulk: "enemy_lav_hulk",
    debris: "mech",
    rotOff: Math.PI / 2,
    move: "tank",
    drive: { maxSpd: 48, accel: 28, brake: 32, turn: 1.15, track: "tire", trackGap: 14, trackScale: 0.82 },
    throwGuns: true,
    wheels: 2,
    weapon: wpn("he", { fireCd: 1.15, range: 440, dmg: 6, blast: 12}),
    guns: [gun("enemy_lav_gun", 0.76, mountOf("enemy_lav", "gun"))],
    rotors: []
  },
  lav_aa: {
    label: "LAV-AA",
    health: 54,
    radius: 18,
    box: { halfW: 13, halfL: 27 },
    height: 18,
    texture: "enemy_lav",
    hulk: "enemy_lav_hulk",
    debris: "mech",
    rotOff: Math.PI / 2,
    move: "tank",
    drive: { maxSpd: 42, accel: 24, brake: 30, turn: 1.05, track: "tire", trackGap: 14, trackScale: 0.82 },
    throwGuns: true,
    wheels: 2,
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
    health: 80,
    radius: 22,
    box: { halfW: 15, halfL: 32 },
    height: 20,
    texture: "enemy_sam",
    hulk: "enemy_sam_hulk",
    debris: "mech",
    rotOff: Math.PI / 2,
    move: "tank",
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
    health: 48,
    radius: 14,
    box: { halfW: 7, halfL: 24 },
    height: 12,
    texture: "enemy_ptboat",
    hulk: "enemy_ptboat_hulk",
    debris: "mech",
    rotOff: Math.PI / 2,
    move: "boat",
    water: true,
    noCrater: true,
    throwGuns: true,
    weapon: wpn("mg", { fireCd: 0.85, range: 420, speed: 560, dmg: 3, blast: 6, burst: 3, burstGap: 0.09 }),
    guns: [gun("enemy_ptboat_gun", 0.74, mountOf("enemy_ptboat", "gun"))],
    rotors: []
  },
  battleship: {
    label: "BATTLESHIP",
    health: 420,
    radius: 92,
    box: { halfW: 28, halfL: 133 },
    height: 40,
    texture: "enemy_battleship",
    hulk: "enemy_battleship_hulk",
    debris: "mech",
    rotOff: Math.PI / 2,
    move: "static",
    water: true,
    noCrater: true,
    throwGuns: true,
    weapon: WPN.arty,
    gunFire: "alternate",
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
    move: "inf",
    organic: true,
    fixedAim: true,
    weapon: {
      kind: "rocket",
      look: "shot_rocket",
      scale: 0.66,
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
    move: "inf",
    organic: true,
    fixedAim: true,
    weapon: wpn("mg", {
      fireCd: 1.35,
      range: 380,
      speed: 560,
      dmg: 1,
      blast: 4,
      burst: 17,
      burstGap: 0.038,
      look: "shot_chain",
      scale: 0.232,
      jitter: 0.045
    }),
    guns: [],
    rotors: []
  },
  mounted_mg: {
    label: "MOUNTED MG TROOP",
    health: 12,
    radius: 12,
    height: 12,
    texture: "enemy_troop_mounted_mg",
    hulk: "enemy_troop_mounted_mg_hulk",
    debris: "organic",
    rotOff: Math.PI / 2,
    move: "static",
    organic: true,
    fixedAim: true,
    weapon: wpn("mg", {
      fireCd: 1.15,
      range: 460,
      speed: 600,
      dmg: 1,
      blast: 4,
      burst: 20,
      burstGap: 0.034,
      look: "shot_chain",
      scale: 0.232,
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
    move: "inf",
    organic: true,
    fixedAim: true,
    weapon: wpn("seeker", {
      fireCd: 3.1,
      range: 520,
      speed: 320,
      dmg: 16,
      blast: 18,
      scale: 0.7
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
    move: "flee",
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
    debris: "organic",
    rotOff: Math.PI / 2,
    move: "flee",
    organic: true,
    hv: true,
    guns: [],
    rotors: []
  },
  barn: {
    label: "BARN",
    health: 140,
    radius: 34,
    box: { halfW: 23, halfL: 41 },
    height: 28,
    texture: "building_barn",
    hulk: "building_barn_hulk",
    debris: "struct",
    rotOff: Math.PI / 2,
    move: "static",
    building: true,
    guns: [],
    rotors: []
  },
  tent: {
    label: "TENT",
    health: 40,
    radius: 20,
    box: { halfW: 18, halfL: 30 },
    height: 14,
    texture: "building_tent",
    hulk: "building_tent_hulk",
    debris: "struct",
    rotOff: Math.PI / 2,
    move: "static",
    building: true,
    guns: [],
    rotors: []
  },
  fob: {
    label: "FOB",
    health: 220,
    radius: 52,
    box: { halfW: 61, halfL: 53 },
    height: 28,
    texture: "building_fob",
    hulk: "building_fob_hulk",
    debris: "struct",
    rotOff: Math.PI / 2,
    move: "static",
    building: true,
    hv: true,
    spawnYaw: (20 * Math.PI) / 180,
    guns: [],
    rotors: []
  },
  lookout: {
    label: "LOOKOUT",
    health: 90,
    radius: 22,
    box: { halfW: 23, halfL: 25 },
    height: 56,
    texture: "building_lookout",
    hulk: "building_lookout_hulk",
    debris: "struct",
    rotOff: Math.PI / 2,
    move: "static",
    building: true,
    hv: true,
    spawnYaw: (5 * Math.PI) / 180,
    guns: [],
    rotors: [],
    crew: { mounts: [mountOf("building_lookout", "troop")], mode: "leash", leashR: 17 }
  },
  drone: {
    label: "DRONE",
    health: 22,
    radius: 6,
    height: 6,
    flyZ: 36,
    texture: "enemy_drone",
    hulk: "enemy_drone_hulk",
    debris: "mech",
    rotOff: Math.PI / 2,
    move: "drone",
    aerial: true,
    noCrater: true,
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
    health: 48,
    radius: 14,
    height: 12,
    flyZ: 44,
    texture: "enemy_heli_small",
    hulk: "enemy_heli_small_hulk",
    debris: "mech",
    rotOff: Math.PI / 2,
    move: "heli",
    aerial: true,
    noCrater: true,
    fixedAim: true,
    weapon: wpn("mg", {
      fireCd: 1.15,
      range: 700,
      speed: 680,
      dmg: 3,
      blast: 8,
      burst: 6,
      burstGap: 0.09,
      look: "shot_chain",
      scale: 0.58,
      jitter: 0.04,
      muzzleFire: "alternate"
    }),
    // Fixed wing guns are baked into the hull; body muzzles alternate L/R.
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
    health: 160,
    radius: 40,
    height: 24,
    flyZ: 52,
    texture: "enemy_heli_heavy",
    hulk: "enemy_heli_heavy_hulk",
    debris: "mech",
    rotOff: Math.PI / 2,
    move: "heli",
    aerial: true,
    noCrater: true,
    throwGuns: true,
    weapon: wpn("mg", {
      fireCd: 0.4,
      range: 700,
      speed: 680,
      dmg: 3,
      blast: 8,
      burst: 40,
      burstGap: 0.055,
      look: "shot_chain",
      scale: 0.58,
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
    guns: mountsOf("enemy_heli_heavy", "gun").map((m) => ({
      ...gun("enemy_heli_heavy_gun", 0.78, { ...m }),
      scale: 0.58
    })),
    rotors: mountsOf("enemy_heli_heavy", "rotor").map((m) => ({
      tex: "enemy_heli_rotor",
      hulk: "enemy_heli_rotor_hulk",
      origin: { x: 0.5, y: 0.5 },
      mount: { ...m },
      scale: 1.25
    }))
  }
};

/** `partsRoll` owns SPECS.guns for those units (preview / gunsOf fallback). */
for (const kind of Object.keys(UNIT_SPECS) as UnitKind[]) {
  const guns = defaultGunsFromRoll(kind);
  if (guns) UNIT_SPECS[kind].guns = guns;
}

export function specOf(kind: UnitKind): UnitSpec {
  return UNIT_SPECS[kind];
}

/** World heading at spawn. Buildings with `spawnYaw` jitter around as-drawn facing. */
export function spawnAngle(kind: UnitKind): number {
  const sp = UNIT_SPECS[kind];
  if (sp.spawnYaw == null) return Math.random() * Math.PI * 2;
  return -sp.rotOff + (Math.random() * 2 - 1) * sp.spawnYaw;
}

export const TROOP_WEIGHTS: [UnitKind, number][] = [
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
  return UNIT_SPECS[kind].crew;
}

export function allSpecs(): UnitSpec[] {
  return Object.values(UNIT_SPECS);
}

export function allKinds(): UnitKind[] {
  return Object.keys(UNIT_SPECS) as UnitKind[];
}

export function isAerial(kind: UnitKind): boolean {
  return !!UNIT_SPECS[kind].aerial;
}

export function isBuilding(kind: UnitKind): boolean {
  return !!UNIT_SPECS[kind].building;
}

export function isOrganic(kind: UnitKind): boolean {
  return !!UNIT_SPECS[kind].organic;
}

/** Soft blood hit spray / death streaks (troops, or vehicles with a rider like motorcycle). */
export function hasSoftBlood(kind: UnitKind): boolean {
  return !!UNIT_SPECS[kind].organic || !!UNIT_SPECS[kind].softBlood;
}

export function isWaterCraft(kind: UnitKind): boolean {
  return !!UNIT_SPECS[kind].water;
}

export function isInfantry(kind: UnitKind): boolean {
  return UNIT_SPECS[kind].move === "inf" || UNIT_SPECS[kind].organic === true;
}

export function isGroundVehicle(kind: UnitKind): boolean {
  const m = UNIT_SPECS[kind].move;
  return m === "tank" || m === "vehicle";
}

export function labelOf(kind: UnitKind): string {
  return UNIT_SPECS[kind].label;
}

/** Fallback when a kind has no `drive` (non-ground movers). */
export const DEFAULT_DRIVE: DriveSpec = {
  maxSpd: 36,
  accel: 20,
  brake: 24,
  turn: 0.8,
  track: "tire",
  trackGap: 14,
  trackScale: 0.85
};

export function driveOf(kind: UnitKind): DriveSpec {
  return UNIT_SPECS[kind].drive ?? DEFAULT_DRIVE;
}

export const ROSTER_TEX: string[] = [
  ...new Set(
    Object.values(UNIT_SPECS).flatMap((s) => [
      s.texture,
      s.hulk,
      ...s.guns.flatMap((g) => [g.tex, g.hulk ?? ""]),
      ...s.rotors.flatMap((r) => [r.tex, r.hulk ?? ""]),
      s.dish?.tex ?? "",
      s.dish?.hulk ?? "",
    ])
  ),
  "shot_aa",
  "shot_shell",
  "shot_small",
  "shot_chain",
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
