import { type Unit } from "./combat";
import { CAMO_SUFFIX, type CamoRoll } from "../catalog/camo";
import { ENEMY_WPNS } from "../catalog/enemyWeapons";
import { gun, TROOP_WEIGHTS, UNIT_SPECS } from "../catalog/units";

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
  | "heli_heavy"
  | "house"
  | "warehouse"
  | "hangar"
  | "control_tower"
  | "dock_shed"
  | "pylon"
  | "power_station"
  | "bridge"
  | "bridge_steel"
  | "pier"
  | "silo"
  | "silo_single"
  | "oil_rig"
  | "heli_platform"
  | "military_heli_platform"
  | "military_heli_platform_sea"
  | "dock_building"
  | "fishing_boat"
  | "yacht";

export type DebrisCat = "mech" | "struct" | "organic";

/** Projectile texture key (= Phaser texture name). */
export type ShotLook = string;

/** Projectile flight behavior (independent of art `look`). */
export type ShotKind = "cannon" | "rocket" | "lock-on-missile" | "guided-missile" | "beam";

export type UnitBehavior =
  | "orbit_attack_vehicle"
  | "flee_vehicle"
  | "flee_infantry"
  | "attack_infantry"
  | "orbit_attack_heli"
  | "kite_attack_heli"
  | "suicide_attack_heli"
  | "patrol_boat"
  | "static_hold";

export type TrackKind = "tread" | "tire" | "dual" | "wide" | "mono";

export interface CombatMood {
  strikesBeforeFlee: number;
  /** Flee duration range in seconds [lo, hi]. */
  fleeDuration: [number, number];
  /** While fleeing, switch to orbit driving (gunship) instead of kite flee. */
  fleeAsOrbit?: boolean;
}

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
  /**
   * Turret traverse limit (degrees): `arc` total width centered on `center` (0 = hull nose,
   * −90 = left, +90 = right). Omit = full 360° — same model as player turret stations.
   */
  traverse?: { arc: number; center: number };
}

export type MuzzleFireMode = "alternate" | "simultaneous";

export interface WeaponSpec {
  fireCd: number;
  range: number;
  speed: number;
  dmg: number;
  blast: number;
  /** Flight behavior: ballistic cannon, rocket, lock-on missile, TOW. */
  kind: ShotKind;
  /** Projectile texture key. */
  look: ShotLook;
  /** Projectile draw scale (baked size for this preset). */
  scale: number;
  /** Trail puff scale vs projectile draw scale (rockets/missiles). */
  trailScale?: number;
  burst?: number;
  burstGap?: number;
  jitter?: number;
  /**
   * Explicit muzzle-tip firing pattern; omitted weapons fire from the first tip.
   * "alternate" cycles one tip per shot; "simultaneous" fires every tip at once.
   */
  muzzleFire?: "alternate" | "simultaneous";
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
export type HullMountRole = "gun" | "rotor" | "dish" | "troop" | "hardpoint" | "exhaust" | "wingtip";

export interface HullMount {
  x: number;
  y: number;
  role: HullMountRole;
  /** Authored point id, else role — same string sockets bind with. */
  label: string;
  id?: string;
}

/** Shared marker colors for sprite / roster rigs. */
export const HULL_MOUNT_COLOR: Record<HullMountRole, number> = {
  gun: 0x6adf6a,
  rotor: 0x5ec8ff,
  dish: 0xe8b84a,
  troop: 0xd878ff,
  hardpoint: 0xffe066,
  exhaust: 0xb04aff,
  wingtip: 0xc8f0ff,
};

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
  /** AI locomotion / engagement profile. */
  behavior: UnitBehavior;
  /** Ground locomotion (tank / vehicle). Omitted for non-driving kinds. */
  drive?: DriveSpec;
  /**
   * Fire → kite → flee mood cycle (scout / gunship helis).
   * Omit for always-orbit heavies.
   */
  combatMood?: CombatMood;
  /** Strafe-turn hull while engaging (false for heavy heli). Default true for heli behaviors. */
  strafeAim?: boolean;
  /** Flee-vehicle react radius (motorcycle 1200; default 520). */
  fleeReactRange?: number;
  /** Max sight range before stealth / low-flight scaling; default: widest weapon or role react range. */
  sightRange?: number;
  /** Min forward speed required to yaw (motorcycle 24; wheeled default 14). */
  minTurnSpd?: number;
  /** Flee infantry run speed override (officer 36; non-organic default 90). */
  fleeRunSpeed?: number;
  /** Patrol boat yaw rate (ptboat 1.55; boat 0.85). */
  boatYaw?: number;
  /** Patrol boat cruise speed (ptboat 38; boat 22). */
  boatSpeed?: number;
  /** Rotor spin rad/s (drone 42; heli default 28). */
  rotorSpinRate?: number;
  /** Bake broken-apart variants of the wreck at load (`hulkBreak`); each death picks one at random. */
  breakApart?: boolean;
  /** Random wreck rotation (± radians), e.g. bridge segments landing askew so a span reads as broken apart. */
  wreckJitter?: number;
  /** Death blast scale mul (tank 1.25). */
  wreckScale?: number;
  /** Wheel debris draw scale range [lo, hi]. */
  wheelDebrisScale?: [number, number];
  /** Camo paint roll at spawn. Omit = no camo. */
  camo?: CamoRoll;
  weapon?: WeaponSpec;
  /**
   * Optional hull hardpoint ordnance (seeker missiles, etc.).
   * Fired by scenes from `mounts` (SPRITE `hardpoint` UVs) — not via SPECS.guns.
   */
  secondary?: SecondaryWpnSpec;
  guns: PartMount[];
  rotors: PartMount[];
  dish?: PartMount;
  building?: boolean;
  /** Civilian: destructible, but no health bar, gray on the map, never auto-targeted or run by AI. */
  neutral?: boolean;
  /**
   * Roof sprite drawn at the top of the building (`z + height`), above the body; the shadow is cast from it.
   * `noBody` = roof-only structure. `hulk` = the roof part thrown clear on death (like a gun turret).
   */
  roof?: { tex: string; hulk?: string; noBody?: boolean };
  /**
   * Death spectacle: `inferno` = chained fireballs (fuel); `sparks` = normal blast + electrical short;
   * `zap` = no HE fireball — a metal structure shorting out (zaps, sparks, dirt kick, a little fire).
   * `collapse` = light structure coming down: modest fire, heavy dust, slow low debris, no fireball or spark shower.
   */
  deathFx?: "inferno" | "sparks" | "zap" | "collapse";
  aerial?: boolean;
  water?: boolean;
  organic?: boolean;
  /** Soft blood hit spray / death streaks in addition to normal wreck FX (e.g. motorcycle rider). */
  softBlood?: boolean;
  hv?: boolean;
  noCrater?: boolean;
  /** EMP fries electronics outright (freefall crash + boom) instead of a mid-air stun. */
  empCrashes?: boolean;
  throwGuns?: boolean;
  /**
   * Light-vehicle death: hulk launches in a spinning flaming arc (impact-biased),
   * then stamps wreck + crater + embers on landing — not an instant on-spot hulk.
   */
  crashPop?: boolean;
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
  /** Part draw scale (turret art borrowed from a larger host). */
  scale?: number;
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

/** Gun-part emit tips. */
export function muzzlesOfGun(gun: Pick<PartMount, "muzzles">): { x: number; y: number }[] {
  if (!gun.muzzles?.length) throw new Error("muzzlesOfGun: empty muzzles");
  return gun.muzzles;
}

export { ENEMY_WPNS, WPN, wpn, type EnemyWpnId } from "../catalog/enemyWeapons";
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
  const part = gun(opt.tex, opt.originY, mount, undefined, opt.w);
  return opt.scale != null ? { ...part, scale: opt.scale } : part;
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

/** AA / seeker weapon — blind to a dirt-locked combat focus (HOUND), engages the host instead. */
export function weaponIsAa(wpn: { kind?: string; look?: string } | undefined): boolean {
  if (!wpn) return false;
  return wpn.kind === "lock-on-missile" || /aa|seeker|aam/i.test(wpn.look ?? "");
}

/** Rolled parts, else the spec's guns (roll defaults are baked into `spec.guns` at load). */
export function gunsOf(u: { kind: UnitKind; parts?: PartMount[] }): PartMount[] {
  return u.parts ?? UNIT_SPECS[u.kind].guns;
}


/** `partsRoll` owns SPECS.guns for those units — the single default `gunsOf` falls back to. */
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

export { TROOP_WEIGHTS } from "../catalog/units";

export function pickTroop(rand = Math.random): UnitKind {
  const r = rand() * TROOP_WEIGHTS.reduce((s, [, w]) => s + w, 0);
  let acc = 0;
  for (const [kind, w] of TROOP_WEIGHTS) {
    acc += w;
    if (r < acc) return kind;
  }
  return "soldier";
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

export function isNeutral(kind: UnitKind): boolean {
  return !!UNIT_SPECS[kind].neutral;
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
  const b = UNIT_SPECS[kind].behavior;
  return b === "attack_infantry" || b === "flee_infantry" || UNIT_SPECS[kind].organic === true;
}

export function isGroundVehicle(kind: UnitKind): boolean {
  const b = UNIT_SPECS[kind].behavior;
  return b === "orbit_attack_vehicle" || b === "flee_vehicle";
}

export function isHeliBehavior(b: UnitBehavior): boolean {
  return (
    b === "orbit_attack_heli" ||
    b === "kite_attack_heli" ||
    b === "suicide_attack_heli"
  );
}

export function isAirBehavior(b: UnitBehavior): boolean {
  return isHeliBehavior(b);
}

export function isInfantryBehavior(b: UnitBehavior): boolean {
  return b === "attack_infantry" || b === "flee_infantry";
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
  "shot_aam",
  "shot_canister",
  "shot_mini_rocket",
  "shot_laser_guided",
  "shot_rocket",
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

/** Fixed-sprite troops: `angle` = move base, `turret` = aim / draw facing. */
export function troopSoftTurret(u: Unit): boolean {
  const sp = specOf(u.kind);
  return !gunsOf(u).length && (sp.behavior === "attack_infantry" || sp.behavior === "flee_infantry");
}
