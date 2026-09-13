import { lookupSpriteOrigin, lookupSpritePoints, mountsOf } from "./spriteOrigin";
import {
  numberMountLabels,
  type HullMount,
  type HullMountRole,
} from "./roster";
import { weaponMountTex } from "./combat";

const DEFAULT_ORIGIN = { x: 0.5, y: 0.5 };

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

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
export type SocketClass = "fixed" | "turret" | "hardpoint";

/** Body UV role used to emit / attach from this socket. */
export type SocketPointRole = "gun" | "muzzle" | "hardpoint";

/** Aesthetic crew-served role for automatic turret stations (HUD / hangar). */
export type CrewRole = "door" | "ramp" | "belly";

/** Body gun UV this socket owns, with optional per-mount rest aim. */
export interface SocketMount {
  /** `SPRITE_SPECS[body].points` id with `role: "gun"`. */
  id: string;
  /** Preferred aim degrees off craft nose for this mount (overrides socket `heading`). */
  heading?: number;
}

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
   * turret→gun, fixed→muzzle, hardpoint→hardpoint.
   */
  points?: SocketPointRole;
  /**
   * Body gun points this socket owns. Omit on a lone turret → every gun UV.
   * Required when multiple turret sockets share the hull. List order = barrel order.
   */
  mounts?: SocketMount[];
  /**
   * Shared rest / preferred aim in degrees off craft nose (0 = forward).
   * Used when `mounts[i].heading` is omitted — handy for a single-gun socket
   * without stuffing heading into `mounts: [{ id, heading }]`.
   */
  heading?: number;
  /** Fire cone width in degrees, centered on that barrel’s heading (or 0). Omit = unrestricted. */
  traverse?: number;
  /** Authored multi-muzzle policy belongs to this installation, not the weapon identity. */
  muzzleFire?: "single" | "alternate" | "simultaneous";
  /** Crew-served station flavor (door / ramp / belly gunners) — not a technical "auto" tag. */
  crew?: CrewRole;
  /** Extra capacity on this station, on top of craft `ammoScale`. */
  ammoMul?: number;
  /**
   * Gravity-bomb release for this hardpoint. Socket wins over craft-level `bombDrop`.
   * Lower `momentum` = more aim-directed (Chinook); higher = carry craft velocity (Lightning).
   */
  bombDrop?: CraftBombDrop;
}

/** Per-socket / per-craft gravity-bomb launcher (momentum inherit + capped corrective boost). */
export interface CraftBombDrop {
  /** Fraction of craft horizontal velocity inherited (0–1). */
  momentum: number;
  /** Max horizontal boost toward aim the launcher can add (world units / sec). */
  maxBoost: number;
  /** Base upward release impulse (world units / sec). */
  loft: number;
  /** Optional higher loft when more range is needed (uses the vertical arc). */
  loftMax?: number;
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
  /**
   * Blade mass / inertia relative to Apache (= 1). Drives spool duration and
   * spin rate (mission + previews). Omit → derived from `rotorDrawSpan`.
   * Tiny (Murder Drone ~0.3) = near-instant spool + fast spin; Chinook >1 = slower.
   */
  rotorInertia?: number;
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
   * Fallback gravity-bomb release when a socket omits `bombDrop`.
   * Prefer authoring on the bomb hardpoint itself.
   */
  bombDrop?: CraftBombDrop;
  /**
   * Weapon installs: geometry + policy + default weapon.
   * Hangar loadouts assign any catalog weapon whose `fits` includes `socket.class`.
   */
  sockets: CraftSocket[];
  /** Enemy gun-laying accuracy multiplier; lower is harder to hit. */
  enemyAimMul?: number;
  /** Enemy seeker acquisition/tracking multiplier; lower is harder to lock. */
  enemySeekerMul?: number;
  /** Enemy spotting / awareness range multiplier. Does not change aim, fire, or chase. */
  enemyAwareMul?: number;
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
      { id: "chin_turret", class: "turret", controller: "pilot", weapon: "chain_gun", points: "gun", traverse: 240 },
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
      { id: "wing_hardpoint_2", class: "hardpoint", controller: "pilot", weapon: "stinger_missile", points: "hardpoint" },
      { id: "wing_hardpoint_3", class: "hardpoint", controller: "pilot", weapon: "heavy_cal_pod", points: "hardpoint" },
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
      { id: "chin_turret", class: "turret", controller: "pilot", weapon: "gatling", points: "gun", traverse: 280 },
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
      { id: "chin_turret", class: "turret", controller: "pilot", weapon: "gatling", points: "gun", traverse: 280 },
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
      // Door guns: explicit mount ↔ heading.
      {
        id: "cabin_doors",
        class: "turret",
        controller: "automatic",
        weapon: "machine_gun",
        points: "gun",
        mounts: [
          { id: "door_l", heading: -75 },
          { id: "door_r", heading: 75 },
        ],
        traverse: 270,
        crew: "door",
      },
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
    forwardThrust: 520, strafeThrust: 280, maxSpeed: 310, minSpeed: 0, yawRate: 0.72, yawAccel: 3.4, drag: 1.65,
    verticalThrust: 340, cruiseThrust: 34, cruiseAgl: 48, maxAgl: 125,
    liftClass: "heavy",
    sockets: [
      // Forward cabin guns: explicit mount ↔ heading (same multi-mount model as Black Hawk doors).
      {
        id: "cabin_forward",
        class: "turret",
        controller: "automatic",
        weapon: "machine_gun",
        points: "gun",
        mounts: [
          { id: "fwd_l", heading: -50 },
          { id: "fwd_r", heading: 50 },
        ],
        traverse: 240,
      },
      // Heavy lift: low momentum inherit so hover / reverse drops can go where aimed.
      {
        id: "bomb_bay_1",
        class: "hardpoint",
        controller: "pilot",
        weapon: "heavy_bomb",
        points: "hardpoint",
        bombDrop: { momentum: 0.28, maxBoost: 240, loft: 130, loftMax: 230 },
      },
      {
        id: "bomb_bay_2",
        class: "hardpoint",
        controller: "pilot",
        weapon: "cluster_bomb",
        points: "hardpoint",
        bombDrop: { momentum: 0.28, maxBoost: 240, loft: 130, loftMax: 230 },
      },
      // Ramp gun faces aft.
      {
        id: "cabin_ramp",
        class: "turret",
        controller: "automatic",
        weapon: "heavy_machine_gun",
        points: "gun",
        mounts: [{ id: "ramp", heading: 180 }],
        traverse: 270,
        crew: "ramp",
      },
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
      {
        id: "belly_turret",
        class: "turret",
        controller: "automatic",
        weapon: "minigun",
        points: "gun",
        mounts: [{ id: "belly" }],
        traverse: 360,
        crew: "belly",
      },
      { id: "wing_hardpoint_1", class: "hardpoint", controller: "pilot", weapon: "guided_rockets", points: "hardpoint", ammoMul: 1.25 },
      { id: "wing_hardpoint_2", class: "hardpoint", controller: "pilot", weapon: "hellfire_missile", points: "hardpoint" },
      {
        id: "cabin_ramp",
        class: "turret",
        controller: "automatic",
        weapon: "heavy_machine_gun",
        points: "gun",
        mounts: [{ id: "ramp", heading: 180 }],
        traverse: 270,
        crew: "ramp",
      },
    ],
  },
  stealthhawk: {
    kind: "stealthhawk",
    name: "Stealth Hawk",
    fullName: "XH-60 Stealth Hawk",
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
      { id: "chin_turret", class: "turret", controller: "pilot", weapon: "concealed_cannon", points: "gun", traverse: 220 },
      { id: "wing_hardpoint_1", class: "hardpoint", controller: "pilot", weapon: "guided_rockets", points: "hardpoint", ammoMul: 0.75 },
      { id: "wing_hardpoint_2", class: "hardpoint", controller: "pilot", weapon: "stinger_missile", points: "hardpoint" },
      { id: "wing_hardpoint_3", class: "hardpoint", controller: "pilot", weapon: "smoke_bomb", points: "hardpoint" },
    ],
    enemyAimMul: 0.55,
    enemySeekerMul: 0.42,
    enemyAwareMul: 0.55,
  },
  cyberhawk: {
    kind: "cyberhawk",
    name: "Cyber Hawk",
    fullName: "XH-88 Cyber Hawk",
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
      {
        id: "chin_turret",
        class: "turret",
        controller: "pilot",
        weapon: "railgun",
        points: "gun",
        mounts: [{ id: "chin" }],
        traverse: 150,
      },
      { id: "wing_hardpoint", class: "hardpoint", controller: "pilot", weapon: "swarm_missile", points: "hardpoint" },
      { id: "bomb_bay", class: "hardpoint", controller: "pilot", weapon: "attack_drone", points: "hardpoint" },
      {
        id: "chin_aux",
        class: "turret",
        controller: "pilot",
        weapon: "emp",
        points: "gun",
        mounts: [{ id: "chin" }],
        traverse: 120,
      },
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
    rotorScale: 0.26,
    rotOff: Math.PI / 2,
    forwardThrust: 760, strafeThrust: 700, maxSpeed: 440, minSpeed: 0, yawRate: 4.35, yawAccel: 23.5, drag: 1.05,
    verticalThrust: 650, cruiseThrust: 60, cruiseAgl: 38, maxAgl: 105,
    sockets: [
      { id: "belly_gun", class: "fixed", controller: "pilot", weapon: "machine_gun", points: "muzzle" },
      { id: "belly_coil", class: "fixed", controller: "pilot", weapon: "tesla_beam", points: "muzzle" },
      { id: "wing_hardpoint", class: "hardpoint", controller: "pilot", weapon: "mini_hellfire_missile", points: "hardpoint" },
      {
        id: "bomb_bay",
        class: "hardpoint",
        controller: "pilot",
        weapon: "mini_bomb",
        points: "hardpoint",
        bombDrop: { momentum: 0.45, maxBoost: 160, loft: 110, loftMax: 190 },
      },
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
      { id: "internal_bay_1", class: "hardpoint", controller: "pilot", weapon: "long_range_missile", points: "hardpoint" },
      { id: "wing_hardpoint", class: "hardpoint", controller: "pilot", weapon: "sidewinder_missile", points: "hardpoint" },
      // Fast attack: bombs carry craft speed; little corrective throw.
      {
        id: "internal_bay_2",
        class: "hardpoint",
        controller: "pilot",
        weapon: "gps_bomb",
        points: "hardpoint",
        bombDrop: { momentum: 0.92, maxBoost: 70, loft: 85, loftMax: 150 },
      },
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
      {
        id: "cabin_gun_1",
        class: "turret",
        controller: "automatic",
        weapon: "heavy_artillery",
        points: "gun",
        mounts: [{ id: "side" }],
        heading: 90,
        traverse: 160,
      },
      {
        id: "cabin_gun_2",
        class: "turret",
        controller: "automatic",
        weapon: "medium_cannon",
        points: "gun",
        mounts: [{ id: "side" }],
        heading: 90,
        traverse: 160,
      },
      {
        id: "cabin_gun_3",
        class: "turret",
        controller: "automatic",
        weapon: "light_cannon",
        points: "gun",
        mounts: [{ id: "side" }],
        heading: 90,
        traverse: 160,
      },
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
      {
        id: "bomb_bay_1",
        class: "hardpoint",
        controller: "pilot",
        weapon: "bomb",
        points: "hardpoint",
        bombDrop: { momentum: 0.78, maxBoost: 110, loft: 100, loftMax: 180 },
      },
      {
        id: "bomb_bay_2",
        class: "hardpoint",
        controller: "pilot",
        weapon: "gps_bomb",
        points: "hardpoint",
        bombDrop: { momentum: 0.85, maxBoost: 90, loft: 90, loftMax: 160 },
      },
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
      { id: "belly_turret", class: "turret", controller: "pilot", weapon: "plasma_cannon", points: "gun", traverse: 260 },
      { id: "nose_rail_1", class: "fixed", controller: "pilot", weapon: "laser_rocket", points: "muzzle" },
      { id: "nose_rail_2", class: "fixed", controller: "pilot", weapon: "photon_missile", points: "muzzle" },
      { id: "bomb_bay", class: "hardpoint", controller: "pilot", weapon: "warp_bomb", points: "hardpoint" },
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

const DEFAULT_BOMB_DROP: CraftBombDrop = {
  momentum: 0.55,
  maxBoost: 160,
  loft: 125,
  loftMax: 210,
};

/** Gravity-bomb release tune: socket → craft → defaults. */
export function craftBombDrop(
  c: CraftSpec = craftOf(),
  socket?: CraftSocket | null
): CraftBombDrop {
  const d = socket?.bombDrop ?? c.bombDrop;
  if (!d) return { ...DEFAULT_BOMB_DROP };
  return {
    momentum: d.momentum,
    maxBoost: d.maxBoost,
    loft: d.loft,
    loftMax: d.loftMax ?? d.loft * 1.7,
  };
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
  const sockMul = c.sockets[socketIndex]?.ammoMul ?? 1;
  return Math.max(1, Math.round(base * craftSocketBarrelCount(c, socketIndex) * sockMul));
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
  /**
   * Gun rest pose for nose-up composite previews (Phaser rotation).
   * Barrel-up art at 0; door/side mounts get craft→mount outward yaw.
   */
  heading?: number;
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

/** Apache main-rotor draw span — inertia reference (= 1). */
export const APACHE_ROTOR_SPAN = rotorDrawSpan("craft_apache_rotor", 1);

/** Largest on-screen rotor diameter for a craft (main disc, not tip tanks). */
export function craftRotorDrawSpan(c: CraftSpec = craftOf()): number {
  if (!c.rotor) return APACHE_ROTOR_SPAN;
  const base = c.rotorScale ?? 1;
  const mounts = rotorMountsOf(c.body);
  if (!mounts.length) return rotorDrawSpan(c.rotor, base);
  let best = 0;
  for (const m of mounts) {
    const span = rotorDrawSpan(c.rotor, base * (m.scale ?? 1));
    if (span > best) best = span;
  }
  return best || rotorDrawSpan(c.rotor, base);
}

/**
 * Blade inertia relative to Apache (1). Authored `rotorInertia` wins; otherwise
 * derived from effective rotor draw span.
 */
export function craftRotorInertia(c: CraftSpec = craftOf()): number {
  if (c.rotorInertia != null) return clamp(c.rotorInertia, 0.12, 3);
  if (!c.rotor) return 1;
  return clamp(craftRotorDrawSpan(c) / APACHE_ROTOR_SPAN, 0.15, 2.5);
}

/** Reference spool / flight rates at Apache inertia (= 1). */
const ROTOR_SPOOL_DUR_REF = 2.35;
const ROTOR_FLIGHT_REF = 32;
const ROTOR_SPOOL_PEAK_REF = 26;

/** Seconds to wind up before lift-off prompt. */
export function craftRotorSpoolDur(c: CraftSpec = craftOf()): number {
  const i = craftRotorInertia(c);
  return clamp(ROTOR_SPOOL_DUR_REF * Math.pow(i, 1.15), 0.22, 4.5);
}

/** Steady flight rotor angular speed. */
export function craftRotorFlightSpeed(c: CraftSpec = craftOf()): number {
  const i = craftRotorInertia(c);
  return clamp(ROTOR_FLIGHT_REF / Math.pow(i, 0.45), 18, 72);
}

/** Peak angular speed at end of spool (before easing up to flight). */
export function craftRotorSpoolPeak(c: CraftSpec = craftOf()): number {
  return craftRotorFlightSpeed(c) * (ROTOR_SPOOL_PEAK_REF / ROTOR_FLIGHT_REF);
}

/** Menu / help idle: ms per full revolution (Apache ≈ 60s). */
export function craftRotorPreviewSpinMs(c: CraftSpec = craftOf()): number {
  return Math.round(60000 * Math.pow(craftRotorInertia(c), 0.85));
}

/**
 * Screen-space disc lean vs body pitch/roll (Apache = 1).
 * Smaller / lighter discs shift less; keeps the fake parallax in proportion.
 */
export function craftRotorTiltMul(c: CraftSpec = craftOf()): number {
  return clamp(craftRotorInertia(c), 0.14, 1.35);
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
 * Prefers PlayerWpnSpec.mount for the first turret socket that has mount art.
 */
export function craftGunTexture(c: CraftSpec = craftOf()): string | undefined {
  if (c.gunVisible === false) return undefined;
  const sock = c.sockets.find(
    (s) => (s.class === "turret") && !!weaponMountTex(s.weapon)
  );
  return sock ? weaponMountTex(sock.weapon) : undefined;
}

/** Socket indices that own a visible gun overlay (matches `craftComposite(...).guns` order).
 * Multi-barrel turret sockets repeat their slot index once per barrel. */
export function craftGunSocketSlots(c: CraftSpec = craftOf()): number[] {
  if (c.gunVisible === false) return [];
  const out: number[] = [];
  for (let i = 0; i < c.sockets.length; i++) {
    const s = c.sockets[i]!;
    if ((s.class === "turret") && weaponMountTex(s.weapon)) {
      const n = craftSocketBarrelCount(c, i);
      for (let b = 0; b < n; b++) out.push(i);
    }
  }
  return out;
}

/**
 * How many independently aimed barrels a socket owns.
 * Lone turret socket → every gun UV. Multiple turret sockets → explicit `mounts` ids only.
 * Non-gun sockets → 1 (fire/ammo bookkeeping). Turret with mount art but no resolved
 * points (missing `mounts` on a shared hull) → 0.
 */
export function craftSocketBarrelCount(c: CraftSpec, socketIndex: number): number {
  const socket = c.sockets[socketIndex];
  if (!socket) return 1;
  if (socket.class !== "turret" || !weaponMountTex(socket.weapon)) return 1;
  return craftSocketGunPoints(c, socketIndex).length;
}

/** Turret socket indices that have mount art (visible gun overlays). */
function turretGunSocketIdxs(c: CraftSpec): number[] {
  const out: number[] = [];
  for (let i = 0; i < c.sockets.length; i++) {
    const s = c.sockets[i]!;
    if (s.class === "turret" && weaponMountTex(s.weapon)) out.push(i);
  }
  return out;
}

/**
 * Resolved body gun UVs for a socket (overlay / fire order).
 * - `mounts` listed → those point ids in list order (even on a lone turret).
 * - Else exactly one turret gun socket → all `role: "gun"` points.
 * - Else (shared hull, no mounts) → none.
 */
export function craftSocketGunPoints(
  c: CraftSpec,
  socketIndex: number
): { x: number; y: number; id?: string }[] {
  const socket = c.sockets[socketIndex];
  if (!socket || socket.class !== "turret" || !weaponMountTex(socket.weapon)) return [];
  const raw = lookupSpritePoints(c.body, "gun");
  if (!raw.length) return [];
  const byId = new Map<string, { x: number; y: number; id?: string }>();
  for (const p of raw) {
    if (p.id) byId.set(p.id, { x: p.x, y: p.y, id: p.id });
  }
  if (socket.mounts?.length) {
    const out: { x: number; y: number; id?: string }[] = [];
    for (const m of socket.mounts) {
      const p = byId.get(m.id);
      if (p) out.push(p);
    }
    return out;
  }
  const gunSocks = turretGunSocketIdxs(c);
  if (gunSocks.length === 1 && gunSocks[0] === socketIndex) {
    return raw.map((p) => ({ x: p.x, y: p.y, id: p.id }));
  }
  return [];
}

/** Every authored player gun mount, in firing / overlay order (socket groups). */
export function craftGunMounts(c: CraftSpec = craftOf()): { x: number; y: number }[] {
  const ordered: { x: number; y: number }[] = [];
  for (let i = 0; i < c.sockets.length; i++) {
    for (const p of craftSocketGunPoints(c, i)) {
      ordered.push({ x: p.x, y: p.y });
    }
  }
  if (ordered.length) return ordered;
  return mountsOf(c.body, "gun");
}

/**
 * Preferred aim degrees off craft nose for a barrel:
 * `mounts[barrel].heading` → socket `heading` → 0.
 */
export function craftGunPreferDegrees(c: CraftSpec, slot: number, barrel = 0): number {
  const socket = c.sockets[slot];
  if (!socket) return 0;
  return socket.mounts?.[barrel]?.heading ?? socket.heading ?? 0;
}

/** Preferred aim offset in radians (overlay / station init). */
export function craftGunPreferOffset(c: CraftSpec, slot: number, barrel = 0): number {
  return (craftGunPreferDegrees(c, slot, barrel) * Math.PI) / 180;
}

/** Body gun UV for a socket barrel (same order as `craftComposite(...).guns`). */
export function craftGunMountForBarrel(
  c: CraftSpec,
  slot: number,
  barrel = 0
): { x: number; y: number } {
  const mounts = craftGunMounts(c);
  const slots = craftGunSocketSlots(c);
  let seen = 0;
  for (let i = 0; i < slots.length; i++) {
    if (slots[i] !== slot) continue;
    if (seen === barrel) return mounts[i] ?? mounts[0] ?? craftOrigin(c);
    seen++;
  }
  return mounts[0] ?? craftOrigin(c);
}

/** Authoritative visual parts and mounts for composing a craft in any view. */
export function craftComposite(c: CraftSpec = craftOf()): CraftComposite {
  const rotorTex = craftRotorTex(c);
  const gunMounts = craftGunMounts(c);
  const gunSlots = craftGunSocketSlots(c);
  const barrelOf = new Map<number, number>();
  return {
    body: { tex: c.body, origin: craftOrigin(c) },
    guns:
      c.gunVisible === false
        ? []
        : gunSlots.map((slot, i) => {
            const sock = c.sockets[slot]!;
            const tex = weaponMountTex(sock.weapon)!;
            const barrel = barrelOf.get(slot) ?? 0;
            barrelOf.set(slot, barrel + 1);
            // Barrel-up gun art: Phaser rot = prefer offset (nose → 0).
            const heading = craftGunPreferOffset(c, slot, barrel);
            return {
              kind: "gun" as const,
              tex,
              origin: lookupSpriteOrigin(tex) ?? craftGunOrigin(c),
              mount: gunMounts[i] ?? gunMounts[0] ?? craftOrigin(c),
              layer: "below" as const,
              heading,
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
  if (socket.class === "turret") return "gun";
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

/** True when the craft aims a turret gun independently of the hull. */
export function craftAimsWithTurret(c: CraftSpec = craftOf()): boolean {
  return c.sockets.some((s) => s.class === "turret");
}

/** Default weapon ids in HUD / fire order. */
export function craftSocketWeapons(c: CraftSpec = craftOf()): string[] {
  return c.sockets.map((s) => s.weapon);
}

/**
 * How many barrels / installs a socket represents for loadout UI.
 * Dual wing guns (multi-muzzle fixed) and multi-mount turret pairs count.
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
  if (socket.class === "turret") {
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
