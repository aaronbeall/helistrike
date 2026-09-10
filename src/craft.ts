import { lookupSpriteOrigin, lookupSpritePoints, mountsOf } from "./spriteOrigin";
import {
  numberMountLabels,
  type HullMount,
  type HullMountRole,
} from "./roster";
import { weaponMountTex } from "./combat";

const DEFAULT_ORIGIN = { x: 0.5, y: 0.5 };

/**
 * Playable / selectable craft.
 * UV layout lives in SPRITE_SPECS for body/gun textures — craft only names textures
 * and gameplay fields. Pick via `selectCraft` / `craftOf(kind)`.
 */
export type CraftKind =
  | "apache"
  | "blackhawk"
  | "little_bird"
  | "quad_drone"
  | "cobra"
  | "viper"
  | "chinook"
  | "osprey"
  | "stealthhawk"
  | "cyberhawk"
  | "prometheus"
  | "lightning_ii"
  | "gunship"
  | "warthog";

/** Physical install class — also the weapon compatibility key (`fits`). */
export type SocketClass = "fixed" | "turret" | "cabin" | "hardpoint" | "bay";

/** Body UV role used to emit / attach from this socket. */
export type SocketPointRole = "gun" | "muzzle" | "hardpoint";

/** Aesthetic crew-served role for automatic cabin/turret stations (HUD / hangar). */
export type CrewRole = "door" | "ramp" | "belly";

export interface CraftSocket {
  /** Stable physical install id (hangar / save) — location, not weapon. */
  id: string;
  /** Mount class — drives aim policy and weapon fit. */
  class: SocketClass;
  controller: "pilot" | "automatic";
  /** Default installed weapon; hangar may reassign any catalog weapon in `fits`. */
  weapon: string;
  /**
   * Body point role for emit/attach. Defaults from `class`:
   * turret/cabin→gun, fixed→muzzle, hardpoint/bay→hardpoint.
   */
  points?: SocketPointRole;
  /**
   * Aim cone for turret/cabin guns only (not fixed muzzles). Arc width in degrees;
   * center is craft→mount heading at runtime (optional `center` only if mount ≈ origin).
   * `side` further restricts to a craft-relative hemisphere.
   */
  traverse?: { arc: number; center?: number; side?: "left" | "right" | "both" };
  /** Authored multi-muzzle policy belongs to this installation, not the weapon identity. */
  muzzleFire?: "single" | "alternate" | "simultaneous";
  /** Crew-served station flavor (door / ramp / belly gunners) — not a technical "auto" tag. */
  crew?: CrewRole;
}

export interface CraftSpec {
  kind: CraftKind;
  name: string;
  fullName: string;
  flightModel: "heli" | "vtol" | "plane";
  /** Largest real-world plan-view envelope in meters; Apache baseline for fictional craft. */
  sizeM: number;
  /** Capacity multiplier for finite-ammo weapons. */
  ammoScale: number;
  health: number;
  /** Collision / silhouette radius (roster marks / future). */
  radius: number;
  /** Collision / aim height (world units). */
  height: number;
  /** Body texture key. */
  body: string;
  hulk: string;
  /** False for craft whose weapons are baked into the body and use authored muzzles. */
  gunVisible?: boolean;
  /**
   * Rotor / thruster overlay texture. Omit for fixed-wing (gunship / warthog).
   * Spin bake is `${rotor}_spin` when present.
   */
  rotor?: string;
  rotorHulk?: string;
  /** Draw multiplier for the rotor overlay relative to its baked texture size. */
  rotorScale?: number;
  /** Rotor wind-up duration before lift-off; defaults to global heli spool. */
  spoolDur?: number;
  /** Steady flight rotor angular speed; defaults to global heli rotor flight speed. */
  rotorFlight?: number;
  /** Sprite nose-up offset (world aim 0 is +X). */
  rotOff: number;
  forwardThrust: number;
  /** Optional backward thrust; defaults to forwardThrust. */
  reverseThrust?: number;
  strafeThrust: number;
  maxSpeed: number;
  /** Optional cap on velocity opposite the nose; defaults to maxSpeed. */
  maxReverseSpeed?: number;
  /** Fixed-wing floor; zero for craft that can hover. */
  minSpeed: number;
  yawRate: number;
  yawAccel: number;
  drag: number;
  verticalThrust: number;
  cruiseThrust: number;
  cruiseAgl: number;
  maxAgl: number;
  /** Future pickup/place capability; no cargo gameplay exists yet. */
  liftClass?: "medium" | "heavy";
  /**
   * Weapon installs: geometry + policy + default weapon.
   * Hangar loadouts assign any catalog weapon whose `fits` includes `socket.class`.
   */
  sockets: CraftSocket[];
  /** Enemy gun-laying accuracy multiplier; lower is harder to hit. */
  enemyAimMul?: number;
  /** Enemy seeker acquisition/tracking multiplier; lower is harder to lock. */
  enemySeekerMul?: number;
}

/** Catalog of player-selectable craft. */
export const CRAFTS: Record<CraftKind, CraftSpec> = {
  apache: {
    kind: "apache",
    name: "Apache",
    fullName: "AH-64E Apache",
    flightModel: "heli",
    sizeM: 14.7,
    ammoScale: 1,
    health: 100,
    radius: 20,
    height: 14,
    body: "craft_apache",
    hulk: "craft_apache_hulk",
    rotor: "craft_apache_rotor",
    rotorHulk: "craft_apache_rotor_hulk",
    rotOff: Math.PI / 2,
    forwardThrust: 520, strafeThrust: 340, maxSpeed: 340, minSpeed: 0, yawRate: 2.55, yawAccel: 11, drag: 1.65,
    verticalThrust: 340, cruiseThrust: 36, cruiseAgl: 46, maxAgl: 118,
    sockets: [
      { id: "chin_turret", class: "turret", controller: "pilot", weapon: "chain_gun", points: "gun", traverse: { arc: 240 } },
      { id: "wing_hardpoint_1", class: "hardpoint", controller: "pilot", weapon: "rocket", points: "hardpoint" },
      { id: "wing_hardpoint_2", class: "hardpoint", controller: "pilot", weapon: "hellfire_missile", points: "hardpoint" },
      { id: "wing_hardpoint_3", class: "hardpoint", controller: "pilot", weapon: "tv_missile", points: "hardpoint" },
    ],
  },
  little_bird: {
    kind: "little_bird",
    name: "Little Bird",
    fullName: "AH-6 Little Bird",
    flightModel: "heli",
    sizeM: 9.94,
    ammoScale: 0.7,
    health: 70,
    radius: 14,
    height: 8,
    body: "craft_littlebird",
    hulk: "craft_littlebird_hulk",
    gunVisible: false,
    rotor: "craft_littlebird_rotor",
    rotorHulk: "craft_littlebird_rotor_hulk",
    rotorScale: 0.71,
    rotOff: Math.PI / 2,
    forwardThrust: 660, strafeThrust: 560, maxSpeed: 390, minSpeed: 0, yawRate: 4.1, yawAccel: 22, drag: 1.25,
    verticalThrust: 520, cruiseThrust: 52, cruiseAgl: 46, maxAgl: 118,
    sockets: [
      { id: "wing_gun_l", class: "fixed", controller: "pilot", weapon: "minigun", points: "muzzle", muzzleFire: "simultaneous" },
      { id: "wing_hardpoint_1", class: "hardpoint", controller: "pilot", weapon: "rocket", points: "hardpoint" },
      { id: "wing_hardpoint_2", class: "hardpoint", controller: "pilot", weapon: "hellfire_missile", points: "hardpoint" },
      { id: "wing_hardpoint_3", class: "hardpoint", controller: "pilot", weapon: "tow_missile", points: "hardpoint" },
    ],
  },
  cobra: {
    kind: "cobra",
    name: "Cobra",
    fullName: "AH-1 Cobra",
    flightModel: "heli",
    sizeM: 17.75,
    ammoScale: 1.1,
    health: 95,
    radius: 16,
    height: 13,
    body: "craft_cobra",
    hulk: "craft_cobra_hulk",
    rotor: "craft_cobra_rotor",
    rotorHulk: "craft_cobra_rotor_hulk",
    rotorScale: 1.24,
    rotOff: Math.PI / 2,
    forwardThrust: 600, strafeThrust: 410, maxSpeed: 375, minSpeed: 0, yawRate: 3.25, yawAccel: 16.5, drag: 1.45,
    verticalThrust: 410, cruiseThrust: 42, cruiseAgl: 46, maxAgl: 118,
    sockets: [
      { id: "chin_turret", class: "turret", controller: "pilot", weapon: "gatling", points: "gun", traverse: { arc: 280 } },
      { id: "wing_hardpoint_1", class: "hardpoint", controller: "pilot", weapon: "rocket", points: "hardpoint" },
      { id: "wing_hardpoint_2", class: "hardpoint", controller: "pilot", weapon: "sidewinder_missile", points: "hardpoint" },
      { id: "wing_hardpoint_3", class: "hardpoint", controller: "pilot", weapon: "tow_missile", points: "hardpoint" },
    ],
  },
  viper: {
    kind: "viper",
    name: "Viper",
    fullName: "AH-1Z Viper",
    flightModel: "heli",
    sizeM: 17.8,
    ammoScale: 1.15,
    health: 110,
    radius: 17,
    height: 13,
    body: "craft_viper",
    hulk: "craft_viper_hulk",
    rotor: "craft_viper_rotor",
    rotorHulk: "craft_viper_rotor_hulk",
    rotorScale: 1.24,
    rotOff: Math.PI / 2,
    forwardThrust: 610, strafeThrust: 430, maxSpeed: 390, minSpeed: 0, yawRate: 3.3, yawAccel: 17, drag: 1.4,
    verticalThrust: 420, cruiseThrust: 43, cruiseAgl: 48, maxAgl: 122,
    sockets: [
      { id: "chin_turret", class: "turret", controller: "pilot", weapon: "gatling", points: "gun", traverse: { arc: 280 } },
      { id: "wing_hardpoint_1", class: "hardpoint", controller: "pilot", weapon: "rocket", points: "hardpoint" },
      { id: "wing_hardpoint_2", class: "hardpoint", controller: "pilot", weapon: "sidewinder_missile", points: "hardpoint" },
      { id: "wing_hardpoint_3", class: "hardpoint", controller: "pilot", weapon: "tow_missile", points: "hardpoint" },
    ],
  },
  blackhawk: {
    kind: "blackhawk",
    name: "Black Hawk",
    fullName: "UH-60M Black Hawk",
    flightModel: "heli",
    sizeM: 19.76,
    ammoScale: 1.3,
    health: 135,
    radius: 27,
    height: 15,
    body: "craft_blackhawk",
    hulk: "craft_blackhawk_hulk",
    rotor: "craft_blackhawk_rotor",
    rotorHulk: "craft_blackhawk_rotor_hulk",
    rotorScale: 1.39,
    rotOff: Math.PI / 2,
    forwardThrust: 450, strafeThrust: 260, maxSpeed: 280, minSpeed: 0, yawRate: 1.95, yawAccel: 8, drag: 1.85,
    verticalThrust: 300, cruiseThrust: 32, cruiseAgl: 46, maxAgl: 118,
    liftClass: "medium",
    sockets: [
      { id: "wing_guns", class: "fixed", controller: "pilot", weapon: "gatling", points: "muzzle", muzzleFire: "simultaneous" },
      { id: "wing_hardpoint_1", class: "hardpoint", controller: "pilot", weapon: "rocket", points: "hardpoint" },
      { id: "wing_hardpoint_2", class: "hardpoint", controller: "pilot", weapon: "hellfire_missile", points: "hardpoint" },
      { id: "cabin_doors", class: "cabin", controller: "automatic", weapon: "door_machine_gun", points: "gun", traverse: { arc: 270 }, crew: "door" },
    ],
  },
  chinook: {
    kind: "chinook",
    name: "Chinook",
    fullName: "CH-47F Chinook",
    flightModel: "heli",
    sizeM: 30.1,
    ammoScale: 1.6,
    health: 420,
    radius: 41,
    height: 25,
    body: "craft_chinook",
    hulk: "craft_chinook_hulk",
    rotor: "craft_chinook_rotor",
    rotorHulk: "craft_chinook_rotor_hulk",
    rotorScale: 1.55,
    rotOff: Math.PI / 2,
    forwardThrust: 520, strafeThrust: 280, maxSpeed: 310, minSpeed: 0, yawRate: 1.75, yawAccel: 8, drag: 1.65,
    verticalThrust: 340, cruiseThrust: 34, cruiseAgl: 48, maxAgl: 125,
    liftClass: "heavy",
    sockets: [
      { id: "cabin_forward", class: "cabin", controller: "automatic", weapon: "machine_gun", points: "gun", traverse: { arc: 240 } },
      { id: "bomb_bay_1", class: "bay", controller: "pilot", weapon: "heavy_bomb", points: "hardpoint" },
      { id: "bomb_bay_2", class: "bay", controller: "pilot", weapon: "cluster_bomb", points: "hardpoint" },
      { id: "cabin_ramp_auto", class: "cabin", controller: "automatic", weapon: "auto_machine_gun", points: "gun", traverse: { arc: 270 }, crew: "ramp" },
    ],
  },
  osprey: {
    kind: "osprey",
    name: "Osprey",
    fullName: "MV-22B Osprey",
    flightModel: "vtol",
    sizeM: 25.8,
    ammoScale: 1.4,
    health: 140,
    radius: 35,
    height: 20,
    body: "craft_osprey",
    hulk: "craft_osprey_hulk",
    rotor: "craft_osprey_rotor",
    rotorHulk: "craft_osprey_rotor_hulk",
    rotorScale: 0.98,
    rotOff: Math.PI / 2,
    forwardThrust: 700, strafeThrust: 230, maxSpeed: 430, minSpeed: 0, yawRate: 1.7, yawAccel: 7, drag: 1.4,
    verticalThrust: 380, cruiseThrust: 40, cruiseAgl: 70, maxAgl: 170,
    liftClass: "heavy",
    sockets: [
      { id: "cabin_ramp", class: "cabin", controller: "automatic", weapon: "minigun", points: "gun", traverse: { arc: 270 }, crew: "ramp" },
      { id: "wing_hardpoint_1", class: "hardpoint", controller: "pilot", weapon: "guided_rockets", points: "hardpoint" },
      { id: "wing_hardpoint_2", class: "hardpoint", controller: "pilot", weapon: "hellfire_missile", points: "hardpoint" },
      { id: "belly_turret_auto", class: "turret", controller: "automatic", weapon: "auto_machine_gun", points: "gun", traverse: { arc: 300 }, crew: "belly" },
    ],
  },
  stealthhawk: {
    kind: "stealthhawk",
    name: "Stealthhawk",
    fullName: "XH-60 Stealthhawk",
    flightModel: "heli",
    sizeM: 14.7,
    ammoScale: 1,
    health: 110,
    radius: 20,
    height: 14,
    body: "craft_stealthhawk",
    hulk: "craft_stealthhawk_hulk",
    rotor: "craft_stealthhawk_rotor",
    rotorHulk: "craft_stealthhawk_rotor_hulk",
    rotorScale: 1.24,
    rotOff: Math.PI / 2,
    forwardThrust: 475, strafeThrust: 310, maxSpeed: 305, minSpeed: 0, yawRate: 2.45, yawAccel: 10.5, drag: 1.65,
    verticalThrust: 340, cruiseThrust: 36, cruiseAgl: 46, maxAgl: 118,
    sockets: [
      { id: "chin_turret", class: "turret", controller: "pilot", weapon: "concealed_cannon", points: "gun", traverse: { arc: 220 } },
      { id: "wing_hardpoint_1", class: "hardpoint", controller: "pilot", weapon: "guided_rockets", points: "hardpoint" },
      { id: "wing_hardpoint_2", class: "hardpoint", controller: "pilot", weapon: "smoke_bomb", points: "hardpoint" },
      { id: "wing_hardpoint_3", class: "hardpoint", controller: "pilot", weapon: "stinger_missile", points: "hardpoint" },
    ],
    enemyAimMul: 0.55,
    enemySeekerMul: 0.42,
  },
  cyberhawk: {
    kind: "cyberhawk",
    name: "Cyberhawk",
    fullName: "XH-88 Cyberhawk",
    flightModel: "heli",
    sizeM: 14.7,
    ammoScale: 1.05,
    health: 120,
    radius: 20,
    height: 14,
    body: "craft_cyberhawk",
    hulk: "craft_cyberhawk_hulk",
    rotor: "craft_cyberhawk_rotor",
    rotorHulk: "craft_cyberhawk_rotor_hulk",
    rotorScale: 1.24,
    rotOff: Math.PI / 2,
    forwardThrust: 740, strafeThrust: 500, maxSpeed: 500, minSpeed: 0, yawRate: 3.35, yawAccel: 16, drag: 1.2,
    verticalThrust: 480, cruiseThrust: 48, cruiseAgl: 46, maxAgl: 118,
    sockets: [
      { id: "chin_turret", class: "turret", controller: "pilot", weapon: "railgun", points: "gun", traverse: { arc: 150 } },
      { id: "wing_hardpoint", class: "hardpoint", controller: "pilot", weapon: "swarm_missile", points: "hardpoint" },
      { id: "bomb_bay", class: "bay", controller: "pilot", weapon: "attack_drone", points: "hardpoint" },
      { id: "chin_aux", class: "turret", controller: "pilot", weapon: "emp", points: "gun", traverse: { arc: 120 } },
    ],
  },
  quad_drone: {
    kind: "quad_drone",
    name: "Murder Drone",
    fullName: "MQ-27 Murder Drone",
    flightModel: "heli",
    sizeM: 1.9,
    ammoScale: 0.65,
    health: 45,
    radius: 4.5,
    height: 3.2,
    body: "craft_quad_drone",
    hulk: "craft_quad_drone_hulk",
    gunVisible: false,
    rotor: "craft_quad_drone_rotor",
    rotorHulk: "craft_quad_drone_rotor_hulk",
    rotorScale: 0.4,
    spoolDur: 0.55,
    rotorFlight: 52,
    rotOff: Math.PI / 2,
    forwardThrust: 760, strafeThrust: 700, maxSpeed: 440, minSpeed: 0, yawRate: 4.35, yawAccel: 23.5, drag: 1.05,
    verticalThrust: 650, cruiseThrust: 60, cruiseAgl: 38, maxAgl: 105,
    sockets: [
      { id: "belly_gun", class: "fixed", controller: "pilot", weapon: "light_machine_gun", points: "muzzle" },
      { id: "belly_coil", class: "fixed", controller: "pilot", weapon: "tesla_beam", points: "muzzle" },
      { id: "wing_hardpoint", class: "hardpoint", controller: "pilot", weapon: "mini_hellfire_missile", points: "hardpoint" },
      { id: "bomb_bay", class: "bay", controller: "pilot", weapon: "mini_bomb", points: "hardpoint" },
    ],
  },
  lightning_ii: {
    kind: "lightning_ii",
    name: "Lightning II",
    fullName: "F-35B Lightning II",
    flightModel: "vtol",
    sizeM: 15.7,
    ammoScale: 1.5,
    health: 165,
    radius: 31,
    height: 13,
    body: "craft_lightning_ii",
    hulk: "craft_lightning_ii_hulk",
    gunVisible: false,
    rotOff: Math.PI / 2,
    forwardThrust: 1050, reverseThrust: 130, strafeThrust: 260, maxSpeed: 680, maxReverseSpeed: 65, minSpeed: 0, yawRate: 2.35, yawAccel: 10, drag: 1.15,
    verticalThrust: 380, cruiseThrust: 40, cruiseAgl: 210, maxAgl: 420,
    sockets: [
      { id: "nose_gun", class: "fixed", controller: "pilot", weapon: "medium_gatling_cannon", points: "muzzle" },
      { id: "internal_bay_1", class: "bay", controller: "pilot", weapon: "long_range_missile", points: "hardpoint" },
      { id: "wing_hardpoint", class: "hardpoint", controller: "pilot", weapon: "sidewinder_missile", points: "hardpoint" },
      { id: "internal_bay_2", class: "bay", controller: "pilot", weapon: "gps_bomb", points: "hardpoint" },
    ],
  },
  gunship: {
    kind: "gunship",
    name: "Gunship",
    fullName: "AC-130 Gunship",
    flightModel: "plane",
    sizeM: 39.7,
    ammoScale: 2,
    health: 320,
    radius: 100,
    height: 35,
    body: "craft_gunship",
    hulk: "craft_gunship_hulk",
    rotor: "craft_osprey_rotor",
    rotorHulk: "craft_osprey_rotor_hulk",
    rotorScale: 0.24,
    rotOff: Math.PI / 2,
    forwardThrust: 500, strafeThrust: 0, maxSpeed: 300, minSpeed: 190, yawRate: 0.7, yawAccel: 2, drag: 1.5,
    verticalThrust: 90, cruiseThrust: 14, cruiseAgl: 320, maxAgl: 520,
    sockets: [
      { id: "cabin_gun_1", class: "cabin", controller: "automatic", weapon: "heavy_artillery", points: "gun", traverse: { arc: 250, side: "left" } },
      { id: "cabin_gun_2", class: "cabin", controller: "automatic", weapon: "medium_cannon", points: "gun", traverse: { arc: 250, side: "left" } },
      { id: "cabin_gun_3", class: "cabin", controller: "automatic", weapon: "light_cannon", points: "gun", traverse: { arc: 250, side: "left" } },
      { id: "wing_hardpoint", class: "hardpoint", controller: "pilot", weapon: "gps_missile", points: "hardpoint" },
    ],
  },
  warthog: {
    kind: "warthog",
    name: "Warthog",
    fullName: "A-10C Warthog",
    flightModel: "plane",
    sizeM: 17.42,
    ammoScale: 1.3,
    health: 150,
    radius: 40,
    height: 13,
    body: "craft_warthog",
    hulk: "craft_warthog_hulk",
    rotOff: Math.PI / 2,
    forwardThrust: 1200, strafeThrust: 0, maxSpeed: 760, minSpeed: 300, yawRate: 1.25, yawAccel: 5.5, drag: 0.75,
    verticalThrust: 180, cruiseThrust: 24, cruiseAgl: 280, maxAgl: 560,
    sockets: [
      { id: "nose_gun", class: "fixed", controller: "pilot", weapon: "heavy_cannon", points: "muzzle" },
      { id: "wing_hardpoint", class: "hardpoint", controller: "pilot", weapon: "heavy_guided_missile", points: "hardpoint" },
      { id: "bomb_bay_1", class: "bay", controller: "pilot", weapon: "bomb", points: "hardpoint" },
      { id: "bomb_bay_2", class: "bay", controller: "pilot", weapon: "gps_bomb", points: "hardpoint" },
    ],
  },
  prometheus: {
    kind: "prometheus",
    name: "Prometheus",
    fullName: "XV-99 Prometheus",
    flightModel: "vtol",
    sizeM: 14.7,
    ammoScale: 1.2,
    health: 130,
    radius: 36,
    height: 14,
    body: "craft_prometheus",
    hulk: "craft_prometheus_hulk",
    // No rotor — hover via energy FX later.
    rotOff: Math.PI / 2,
    forwardThrust: 900, strafeThrust: 760, maxSpeed: 600, minSpeed: 0, yawRate: 4.5, yawAccel: 25, drag: 0.95,
    verticalThrust: 700, cruiseThrust: 65, cruiseAgl: 90, maxAgl: 240,
    liftClass: "heavy",
    sockets: [
      { id: "belly_turret", class: "turret", controller: "pilot", weapon: "plasma_cannon", points: "gun", traverse: { arc: 260 } },
      { id: "nose_rail_1", class: "fixed", controller: "pilot", weapon: "laser_rocket", points: "muzzle" },
      { id: "nose_rail_2", class: "fixed", controller: "pilot", weapon: "photon_missile", points: "muzzle" },
      { id: "bomb_bay", class: "bay", controller: "pilot", weapon: "warp_bomb", points: "hardpoint" },
    ],
  },
};

export const DEFAULT_CRAFT: CraftKind = "apache";
export const APACHE_SIZE_M = CRAFTS.apache.sizeM;

let selected: CraftKind = DEFAULT_CRAFT;

export function selectCraft(kind: CraftKind): void {
  selected = kind;
}

export function craftKind(): CraftKind {
  return selected;
}

/** Active craft, or a named one. */
export function craftOf(kind: CraftKind = selected): CraftSpec {
  return CRAFTS[kind];
}

export function allCrafts(): CraftSpec[] {
  return Object.values(CRAFTS);
}

export function allCraftKinds(): CraftKind[] {
  return Object.keys(CRAFTS) as CraftKind[];
}

/** Real-world plan-view scale relative to the Apache. */
export function craftSizeScale(c: CraftSpec = craftOf()): number {
  return c.sizeM / APACHE_SIZE_M;
}

/** Softer inverse framing adjustment: large craft zoom out, small craft zoom in. */
export function craftCameraScale(c: CraftSpec = craftOf()): number {
  return Math.max(0.62, Math.min(1.24, 1 / Math.sqrt(craftSizeScale(c))));
}

/** Starting capacity for a weapon; unlimited guns remain unlimited. */
export function craftStartingAmmo(baseAmmo: number, c: CraftSpec = craftOf()): number {
  return Number.isFinite(baseAmmo) ? Math.max(1, Math.round(baseAmmo * c.ammoScale)) : Infinity;
}

/** Socket capacity — multi-barrel crew stations keep one shared pool sized for all barrels. */
export function craftSocketStartingAmmo(
  baseAmmo: number,
  c: CraftSpec,
  socketIndex: number
): number {
  const base = craftStartingAmmo(baseAmmo, c);
  if (!Number.isFinite(base)) return base;
  return Math.max(1, Math.round(base * craftSocketBarrelCount(c, socketIndex)));
}

/** Composite handling rating used by the craft selector and field manual. */
export function craftAgility(c: CraftSpec = craftOf()): number {
  return Math.min(
    1,
    0.45 * (c.yawRate / 4.5) +
      0.25 * (c.yawAccel / 25) +
      0.2 * (c.strafeThrust / 760) +
      0.1 * (0.95 / c.drag)
  );
}

/** Capability hook for the future object/friendly pickup and placement system. */
export function craftCanLift(c: CraftSpec = craftOf()): boolean {
  return c.liftClass != null;
}

/** Live rotor texture key, or undefined for fixed-wing. */
export function craftRotorTex(c: CraftSpec = craftOf()): string | undefined {
  return c.rotor;
}

/** Spin-disc texture for a craft rotor (when baked). */
export function craftRotorSpinTex(c: CraftSpec = craftOf()): string | undefined {
  return c.rotor ? `${c.rotor}_spin` : undefined;
}

export type CraftCompositePart = {
  kind: "gun" | "rotor";
  tex: string;
  spinTex?: string;
  origin: { x: number; y: number };
  mount: { x: number; y: number };
  layer: "below" | "above";
  /** Normalized texture span before the body's display scale is applied. */
  drawSpan?: number;
  /** +1 CW / −1 CCW from above (Phaser rotation sign). */
  spinSign?: 1 | -1;
};

export type CraftComposite = {
  body: { tex: string; origin: { x: number; y: number } };
  guns: CraftCompositePart[];
  rotors: CraftCompositePart[];
};

/** Shared live-rotor diameter policy used by world rendering and previews. */
export function rotorDrawSpan(tex: string, partScale = 1): number {
  if (tex === "craft_apache_rotor") return 124 * 1.08 * partScale;
  if (tex.includes("rotor") && tex !== "enemy_drone_rotor") return 108 * partScale;
  return 108 * partScale;
}

/**
 * Phaser spin sign for a rotor mount (+1 CW, −1 CCW), viewed from above.
 * Western single mains → CCW. Tandem / side-by-side / quad use counter-rotation.
 */
export function rotorSpinSign(
  rotors: { x: number; y: number; id?: string; spin?: 1 | -1 }[],
  index: number
): 1 | -1 {
  const n = rotors.length;
  const p = rotors[index];
  if (!p || n < 1) return -1;
  if (p.spin === 1 || p.spin === -1) return p.spin;
  if (p.id === "tail" || p.id?.startsWith("tail")) return 1;
  if (n === 1) return -1;

  const xs = rotors.map((r) => r.x);
  const ys = rotors.map((r) => r.y);
  const xSpan = Math.max(...xs) - Math.min(...xs);
  const ySpan = Math.max(...ys) - Math.min(...ys);

  if (n === 2 && ySpan > xSpan * 1.15) {
    // Chinook-style tandem: forward CCW, aft CW (CH-47 from above).
    let front = 0;
    for (let i = 1; i < n; i++) if (rotors[i]!.y < rotors[front]!.y) front = i;
    return index === front ? -1 : 1;
  }
  if (n === 2 && xSpan > ySpan * 1.15) {
    // Osprey-style: left CW, right CCW from above.
    let left = 0;
    for (let i = 1; i < n; i++) if (rotors[i]!.x < rotors[left]!.x) left = i;
    return index === left ? 1 : -1;
  }
  if (n >= 3 && xSpan > ySpan * 2.2) {
    // Wing props in a row (gunship): adjacent counter-rotate, outer-left CW.
    const order = rotors.map((_, i) => i).sort((a, b) => rotors[a]!.x - rotors[b]!.x);
    const rank = order.indexOf(index);
    return rank % 2 === 0 ? 1 : -1;
  }
  if (n >= 4) {
    // Quad X: FL+RR CW, FR+RL CCW (nose = smaller y).
    const midX = (Math.min(...xs) + Math.max(...xs)) * 0.5;
    const midY = (Math.min(...ys) + Math.max(...ys)) * 0.5;
    const left = p.x < midX;
    const nose = p.y < midY;
    if (nose && left) return 1;
    if (nose && !left) return -1;
    if (!nose && left) return -1;
    return 1;
  }
  return index % 2 === 0 ? -1 : 1;
}

/** Rotor UVs for a hull texture (craft body or unit). */
export function rotorMountsOf(
  texKey: string
): { x: number; y: number; scale?: number; id?: string; spin?: 1 | -1 }[] {
  const mounts = lookupSpritePoints(texKey)
    .filter((point) => point.role === "rotor")
    .map((point) => ({
      x: point.x,
      y: point.y,
      ...(point.scale != null ? { scale: point.scale } : {}),
      ...(point.id != null ? { id: point.id } : {}),
      ...(point.spin === 1 || point.spin === -1 ? { spin: point.spin } : {}),
    }));
  return mounts.length ? mounts : [{ x: 0.5, y: 0.5 }];
}

/** Authored rotor centers and optional per-mount scales; body center if none authored. */
export function craftRotorMounts(c: CraftSpec = craftOf()): {
  x: number;
  y: number;
  scale?: number;
  id?: string;
  spin?: 1 | -1;
}[] {
  return rotorMountsOf(c.body);
}

/**
 * Visible gun overlay texture for a craft.
 * Prefers PlayerWpnSpec.mount for the first turret/cabin socket that has mount art.
 */
export function craftGunTexture(c: CraftSpec = craftOf()): string | undefined {
  if (c.gunVisible === false) return undefined;
  const sock = c.sockets.find(
    (s) => (s.class === "turret" || s.class === "cabin") && !!weaponMountTex(s.weapon)
  );
  return sock ? weaponMountTex(sock.weapon) : undefined;
}

/** Socket indices that own a visible gun overlay (matches `craftComposite(...).guns` order).
 * Multi-barrel cabin/turret sockets repeat their slot index once per barrel. */
export function craftGunSocketSlots(c: CraftSpec = craftOf()): number[] {
  if (c.gunVisible === false) return [];
  const out: number[] = [];
  for (let i = 0; i < c.sockets.length; i++) {
    const s = c.sockets[i]!;
    if ((s.class === "turret" || s.class === "cabin") && weaponMountTex(s.weapon)) {
      const n = craftSocketBarrelCount(c, i);
      for (let b = 0; b < n; b++) out.push(i);
    }
  }
  return out;
}

/**
 * How many independently aimed barrels a socket owns.
 * A lone multi-mount cabin/turret socket (e.g. Black Hawk door pair) owns every gun UV;
 * when several gun sockets share the hull, each owns one mount in order.
 */
export function craftSocketBarrelCount(c: CraftSpec, socketIndex: number): number {
  const socket = c.sockets[socketIndex];
  if (!socket) return 1;
  if (socket.class === "turret" || socket.class === "cabin") {
    if (!weaponMountTex(socket.weapon)) return 1;
    const gunSockIdxs: number[] = [];
    for (let i = 0; i < c.sockets.length; i++) {
      const s = c.sockets[i]!;
      if ((s.class === "turret" || s.class === "cabin") && weaponMountTex(s.weapon)) {
        gunSockIdxs.push(i);
      }
    }
    const mounts = craftGunMounts(c);
    if (gunSockIdxs.length === 1 && gunSockIdxs[0] === socketIndex) {
      return Math.max(1, mounts.length);
    }
    return 1;
  }
  return 1;
}

/** Authoritative visual parts and mounts for composing a craft in any view. */
export function craftComposite(c: CraftSpec = craftOf()): CraftComposite {
  const rotorTex = craftRotorTex(c);
  const gunMounts = craftGunMounts(c);
  const gunSlots = craftGunSocketSlots(c);
  return {
    body: { tex: c.body, origin: craftOrigin(c) },
    guns:
      c.gunVisible === false
        ? []
        : gunSlots.map((slot, i) => {
            const sock = c.sockets[slot]!;
            const tex = weaponMountTex(sock.weapon)!;
            return {
              kind: "gun" as const,
              tex,
              origin: lookupSpriteOrigin(tex) ?? craftGunOrigin(c),
              mount: gunMounts[i] ?? gunMounts[0] ?? craftOrigin(c),
              layer: "below" as const,
            };
          }),
    rotors: rotorTex
      ? craftRotorMounts(c).map((mount, i, mounts) => ({
          kind: "rotor",
          tex: rotorTex,
          spinTex: craftRotorSpinTex(c),
          origin: lookupSpriteOrigin(rotorTex) ?? DEFAULT_ORIGIN,
          mount,
          layer: "above",
          spinSign: rotorSpinSign(mounts, i),
          drawSpan: rotorDrawSpan(
            rotorTex,
            (c.rotorScale ?? 1) * (mount.scale ?? 1)
          ),
        }))
      : [],
  };
}

/** Scale a composite part consistently against a body view scale. */
export function craftCompositePartScale(
  part: { drawSpan?: number },
  textureWidth: number,
  bodyScale: number
): number {
  return part.drawSpan == null
    ? bodyScale
    : (part.drawSpan / Math.max(1, textureWidth)) * bodyScale;
}

/**
 * Fit a craft body texture into a UI box without upscaling past native pixels.
 * Shared by selection / help / other UI previews — not the roster zoom path.
 */
export function craftPreviewFitScale(
  bodyW: number,
  bodyH: number,
  boxW: number,
  boxH: number,
  maxScale = 1
): number {
  return Math.min(maxScale, boxW / Math.max(1, bodyW), boxH / Math.max(1, bodyH));
}

/** Exhaust glow display scale paired with a preview body scale. */
export function craftPreviewExhaustScale(bodyScale: number): { x: number; y: number } {
  const s = bodyScale * 0.55;
  return { x: s * 0.75, y: s };
}

/** Per-craft exhaust glow tint for UI previews. */
export function craftPreviewExhaustTint(kind: CraftKind | string): number {
  if (kind === "prometheus") return 0xc86cff;
  if (kind === "warthog") return 0xff8a2c;
  if (kind === "lightning_ii") return 0xbfeaff;
  return 0x70d8ff;
}

/** Body origin from SPRITE_SPECS. */
export function craftOrigin(c: CraftSpec = craftOf()): { x: number; y: number } {
  return lookupSpriteOrigin(c.body) ?? DEFAULT_ORIGIN;
}

/** Chin gun attach UV on the body. */
export function craftGunMount(c: CraftSpec = craftOf()): { x: number; y: number } {
  return craftGunMounts(c)[0] ?? craftOrigin(c);
}

/** Every authored player gun mount, in firing order. */
export function craftGunMounts(c: CraftSpec = craftOf()): { x: number; y: number }[] {
  return mountsOf(c.body, "gun");
}

/** Fixed gun muzzle UVs authored directly on the craft body. */
export function craftFixedMuzzles(c: CraftSpec = craftOf()): { x: number; y: number }[] {
  return mountsOf(c.body, "muzzle");
}

/** Pivot on the gun sprite. */
export function craftGunOrigin(c: CraftSpec = craftOf()): { x: number; y: number } {
  const tex = craftGunTexture(c);
  return (tex ? lookupSpriteOrigin(tex) : undefined) ?? DEFAULT_ORIGIN;
}

/** Default body UV role for a socket class. */
export function socketPointRole(socket: CraftSocket): SocketPointRole {
  if (socket.points) return socket.points;
  if (socket.class === "turret" || socket.class === "cabin") return "gun";
  if (socket.class === "fixed") return "muzzle";
  return "hardpoint";
}

/** Emit / attach UVs for a socket (role primary, then related hull roles). */
export function craftSocketPoints(
  c: CraftSpec,
  socket: CraftSocket
): { x: number; y: number }[] {
  const role = socketPointRole(socket);
  const primary = mountsOf(c.body, role);
  if (primary.length) return primary;
  if (role === "muzzle") {
    const gun = mountsOf(c.body, "gun");
    if (gun.length) return gun;
  }
  if (role === "gun") {
    const muzzle = mountsOf(c.body, "muzzle");
    if (muzzle.length) return muzzle;
  }
  return mountsOf(c.body, "hardpoint");
}

/** Wing / store hardpoint UVs — left → right. */
export function craftHardpointMounts(c: CraftSpec = craftOf()): { x: number; y: number }[] {
  return mountsOf(c.body, "hardpoint");
}

/** True when the craft aims a chin/cabin gun independently of the hull. */
export function craftAimsWithTurret(c: CraftSpec = craftOf()): boolean {
  return c.sockets.some((s) => s.class === "turret" || s.class === "cabin");
}

/** Default weapon ids in HUD / fire order. */
export function craftSocketWeapons(c: CraftSpec = craftOf()): string[] {
  return c.sockets.map((s) => s.weapon);
}

/**
 * How many barrels / installs a socket represents for loadout UI.
 * Dual wing guns (multi-muzzle fixed) and multi-mount cabin/turret pairs count.
 */
export function craftSocketMultiplicity(c: CraftSpec, socketIndex: number): number {
  const socket = c.sockets[socketIndex];
  if (!socket) return 1;
  if (socket.class === "fixed") {
    const pts = craftSocketPoints(c, socket);
    if (
      pts.length > 1 &&
      (socket.muzzleFire === "simultaneous" || socket.muzzleFire === "alternate")
    ) {
      return pts.length;
    }
  }
  if (socket.class === "turret" || socket.class === "cabin") {
    return craftSocketBarrelCount(c, socketIndex);
  }
  return 1;
}

const CREW_LOADOUT_SUFFIX: Record<CrewRole, string> = {
  door: "DOOR GUNNERS",
  ramp: "RAMP GUNNER",
  belly: "BELLY GUNNER",
};

const CREW_HUD_TAG: Record<CrewRole, string> = {
  door: "DOOR",
  ramp: "RAMP",
  belly: "BELLY",
};

/** Short HUD tag for crew-served stations (replaces technical "AUTO"). */
export function craftCrewHudTag(socket: CraftSocket): string | undefined {
  return socket.crew ? CREW_HUD_TAG[socket.crew] : socket.controller === "automatic" ? "CREW" : undefined;
}

/** Loadout label parts — weapon name vs crew designation (for multi-color UI). */
export function craftLoadoutParts(
  c: CraftSpec,
  socketIndex: number,
  fullName: string
): { base: string; crew?: string } {
  const socket = c.sockets[socketIndex];
  const n = craftSocketMultiplicity(c, socketIndex);
  const base = n <= 1 ? fullName : `${n}× ${fullName}`;
  if (!socket?.crew) return { base };
  return { base, crew: ` · ${CREW_LOADOUT_SUFFIX[socket.crew]}` };
}

/** Loadout label with 2× / N× and optional crew designation. */
export function craftLoadoutLabel(
  c: CraftSpec,
  socketIndex: number,
  fullName: string
): string {
  const { base, crew } = craftLoadoutParts(c, socketIndex, fullName);
  return crew ? `${base}${crew}` : base;
}

/** Authored visual exhaust emit points on the craft body. */
export function craftExhaustMounts(c: CraftSpec = craftOf()): { x: number; y: number }[] {
  return mountsOf(c.body, "exhaust");
}

/** Pivot for a craft texture (body origin or gun origin). */
export function craftPivot(key: string): { x: number; y: number } | undefined {
  const k = key.replace(/__(woodland|desert|urban|snow|digital)$/, "");
  for (const c of allCrafts()) {
    if (c.body === k || c.hulk === k) return craftOrigin(c);
  }
  return undefined;
}

/** Tagged hull mounts for a craft — from SPRITE_SPECS body points. */
export function craftMountsOf(sp: CraftSpec): HullMount[] {
  const roles: HullMountRole[] = ["gun", "rotor", "hardpoint", "exhaust"];
  const tagged: HullMount[] = [];
  for (const role of roles) {
    for (const p of mountsOf(sp.body, role)) {
      tagged.push({ x: p.x, y: p.y, role, label: role });
    }
  }
  numberMountLabels(tagged);
  return tagged;
}
