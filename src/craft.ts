import { lookupSpriteOrigin, lookupSpritePoints, mountsOf } from "./spriteOrigin";
import {
  numberMountLabels,
  type HullMount,
  type HullMountRole,
} from "./roster";

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

export interface CraftStationSpec {
  /** Installation policy; the weapon identity remains in the parallel loadout slot. */
  mount?: "fixed" | "turret" | "cabin" | "hardpoint" | "bay";
  controller?: "pilot" | "gunner" | "automatic";
  /** Traverse is measured in degrees around craft-forward; cabin guns use a 180° side arc. */
  traverse?: { center: number; arc: number; side?: "left" | "right" | "both" };
  /** Installation label when it differs from the shared weapon identity. */
  displayName?: string;
  /** Authored multi-muzzle policy belongs to this installation, not the weapon identity. */
  muzzleFire?: "single" | "alternate" | "simultaneous";
}

export type CraftStations = [
  CraftStationSpec | null,
  CraftStationSpec | null,
  CraftStationSpec | null,
  CraftStationSpec | null,
];

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
  /** Chin / turret gun texture (shared `heli_gun` for most). */
  gun: string;
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
  gunMode: "turret" | "fixed";
  loadout: [string, string, string, string];
  /** Optional installation metadata parallel to the four legacy string loadout slots. */
  stations?: CraftStations;
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
    body: "heli_body",
    hulk: "heli_body_hulk",
    gun: "heli_gun",
    rotor: "heli_rotor",
    rotorHulk: "heli_rotor_hulk",
    rotOff: Math.PI / 2,
    forwardThrust: 520, strafeThrust: 340, maxSpeed: 340, minSpeed: 0, yawRate: 2.55, yawAccel: 11, drag: 1.65,
    verticalThrust: 340, cruiseThrust: 36, cruiseAgl: 46, maxAgl: 118,
    gunMode: "turret",
    loadout: ["chain_gun", "rocket", "hellfire_missile", "tv_missile"],
    stations: [
      { mount: "turret", controller: "pilot", displayName: "M230" },
      { mount: "hardpoint", controller: "pilot", displayName: "HYDRA 70" },
      { mount: "hardpoint", controller: "pilot", displayName: "HELLFIRE" },
      { mount: "hardpoint", controller: "pilot", displayName: "SPIKE NLOS" },
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
    gun: "heli_gun",
    gunVisible: false,
    rotor: "craft_littlebird_rotor",
    rotorHulk: "craft_littlebird_rotor_hulk",
    rotorScale: 0.71,
    rotOff: Math.PI / 2,
    forwardThrust: 660, strafeThrust: 560, maxSpeed: 390, minSpeed: 0, yawRate: 4.1, yawAccel: 22, drag: 1.25,
    verticalThrust: 520, cruiseThrust: 52, cruiseAgl: 46, maxAgl: 118,
    gunMode: "fixed",
    loadout: ["minigun", "rocket", "hellfire_missile", "heavy_machine_gun"],
    stations: [
      { mount: "fixed", controller: "pilot", traverse: { center: 0, arc: 12 }, displayName: "DUAL M134", muzzleFire: "simultaneous" },
      { mount: "hardpoint", controller: "pilot" },
      { mount: "hardpoint", controller: "pilot" },
      { mount: "fixed", controller: "pilot", traverse: { center: 0, arc: 12 } },
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
    gun: "heli_gun",
    gunVisible: false,
    rotor: "craft_quad_drone_rotor",
    rotorHulk: "craft_quad_drone_rotor_hulk",
    rotorScale: 0.4,
    spoolDur: 0.55,
    rotorFlight: 52,
    rotOff: Math.PI / 2,
    forwardThrust: 760, strafeThrust: 700, maxSpeed: 440, minSpeed: 0, yawRate: 4.35, yawAccel: 23.5, drag: 1.05,
    verticalThrust: 650, cruiseThrust: 60, cruiseAgl: 38, maxAgl: 105,
    gunMode: "fixed",
    loadout: ["light_machine_gun", "tesla_beam", "mini_hellfire_missile", "mini_bomb"],
    stations: [
      { mount: "turret", controller: "pilot" },
      { mount: "turret", controller: "pilot" },
      { mount: "hardpoint", controller: "pilot" },
      { mount: "bay", controller: "pilot" },
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
    gun: "heli_gun",
    rotor: "craft_cobra_rotor",
    rotorHulk: "craft_cobra_rotor_hulk",
    rotorScale: 1.24,
    rotOff: Math.PI / 2,
    forwardThrust: 600, strafeThrust: 410, maxSpeed: 375, minSpeed: 0, yawRate: 3.25, yawAccel: 16.5, drag: 1.45,
    verticalThrust: 410, cruiseThrust: 42, cruiseAgl: 46, maxAgl: 118,
    gunMode: "turret",
    loadout: ["light_gatling_cannon", "rocket", "tow_missile", "sidewinder_missile"],
    stations: [
      { mount: "turret", controller: "pilot", displayName: "M197" },
      { mount: "hardpoint", controller: "pilot", displayName: "HYDRA 70" },
      { mount: "hardpoint", controller: "pilot", displayName: "TOW" },
      { mount: "hardpoint", controller: "pilot", displayName: "SIDEWINDER" },
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
    gun: "heli_gun",
    rotor: "craft_viper_rotor",
    rotorHulk: "craft_viper_rotor_hulk",
    rotorScale: 1.24,
    rotOff: Math.PI / 2,
    forwardThrust: 610, strafeThrust: 430, maxSpeed: 390, minSpeed: 0, yawRate: 3.3, yawAccel: 17, drag: 1.4,
    verticalThrust: 420, cruiseThrust: 43, cruiseAgl: 48, maxAgl: 122,
    gunMode: "turret",
    loadout: ["light_gatling_cannon", "rocket", "tow_missile", "sidewinder_missile"],
    stations: [
      { mount: "turret", controller: "pilot", displayName: "M197" },
      { mount: "hardpoint", controller: "pilot", displayName: "HYDRA 70" },
      { mount: "hardpoint", controller: "pilot", displayName: "TOW" },
      { mount: "hardpoint", controller: "pilot", displayName: "SIDEWINDER" },
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
    gun: "enemy_heli_gun",
    rotor: "craft_blackhawk_rotor",
    rotorHulk: "craft_blackhawk_rotor_hulk",
    rotorScale: 1.39,
    rotOff: Math.PI / 2,
    forwardThrust: 450, strafeThrust: 260, maxSpeed: 280, minSpeed: 0, yawRate: 1.95, yawAccel: 8, drag: 1.85,
    verticalThrust: 300, cruiseThrust: 32, cruiseAgl: 46, maxAgl: 118,
    liftClass: "medium",
    gunMode: "turret",
    loadout: ["minigun", "rocket", "hellfire_missile", "tow_missile"],
    stations: [
      { mount: "cabin", controller: "gunner", traverse: { center: 90, arc: 180, side: "both" }, displayName: "DUAL M134" },
      { mount: "hardpoint", controller: "pilot" },
      { mount: "hardpoint", controller: "pilot" },
      { mount: "hardpoint", controller: "pilot" },
    ],
  },
  chinook: {
    kind: "chinook",
    name: "Chinook",
    fullName: "CH-47F Chinook",
    flightModel: "heli",
    sizeM: 30.1,
    ammoScale: 1.6,
    health: 240,
    radius: 41,
    height: 25,
    body: "craft_chinook",
    hulk: "craft_chinook_hulk",
    gun: "enemy_heli_gun",
    rotor: "craft_chinook_rotor",
    rotorHulk: "craft_chinook_rotor_hulk",
    rotorScale: 1.55,
    rotOff: Math.PI / 2,
    forwardThrust: 360, strafeThrust: 170, maxSpeed: 220, minSpeed: 0, yawRate: 1.05, yawAccel: 4, drag: 2.2,
    verticalThrust: 240, cruiseThrust: 24, cruiseAgl: 46, maxAgl: 118,
    liftClass: "heavy",
    gunMode: "turret",
    loadout: ["machine_gun", "heavy_bomb", "cluster_bomb", "minigun"],
    stations: [
      { mount: "cabin", controller: "gunner", traverse: { center: 90, arc: 180, side: "both" }, displayName: "DUAL M240D" },
      { mount: "bay", controller: "pilot" },
      { mount: "bay", controller: "pilot" },
      { mount: "cabin", controller: "automatic", traverse: { center: 180, arc: 180, side: "both" }, displayName: "AUTO M134" },
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
    gun: "heli_gun",
    rotor: "craft_osprey_rotor",
    rotorHulk: "craft_osprey_rotor_hulk",
    rotorScale: 0.98,
    rotOff: Math.PI / 2,
    forwardThrust: 700, strafeThrust: 230, maxSpeed: 430, minSpeed: 0, yawRate: 1.7, yawAccel: 7, drag: 1.4,
    verticalThrust: 380, cruiseThrust: 40, cruiseAgl: 70, maxAgl: 170,
    liftClass: "heavy",
    gunMode: "turret",
    loadout: ["minigun", "guided_rockets", "hellfire_missile", "auto_machine_gun"],
    stations: [
      { mount: "cabin", controller: "gunner", traverse: { center: 180, arc: 180, side: "both" }, displayName: "GAU-17/A" },
      { mount: "hardpoint", controller: "pilot" },
      { mount: "hardpoint", controller: "pilot" },
      { mount: "turret", controller: "automatic", displayName: "AUTO M2" },
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
    gun: "heli_gun",
    rotor: "craft_stealthhawk_rotor",
    rotorHulk: "craft_stealthhawk_rotor_hulk",
    rotorScale: 1.24,
    rotOff: Math.PI / 2,
    forwardThrust: 475, strafeThrust: 310, maxSpeed: 305, minSpeed: 0, yawRate: 2.45, yawAccel: 10.5, drag: 1.65,
    verticalThrust: 340, cruiseThrust: 36, cruiseAgl: 46, maxAgl: 118,
    gunMode: "turret",
    loadout: ["concealed_cannon", "hellfire_missile", "smoke_bomb", "stinger_missile"],
    enemyAimMul: 0.55,
    enemySeekerMul: 0.42,
    stations: [
      { mount: "turret", controller: "pilot", displayName: "LOW-RCS CANNON" },
      { mount: "hardpoint", controller: "pilot", displayName: "HELLFIRE" },
      { mount: "hardpoint", controller: "pilot", displayName: "SMOKE NLOS" },
      { mount: "hardpoint", controller: "pilot", displayName: "STINGER" },
    ],
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
    gun: "heli_gun",
    rotor: "craft_cyberhawk_rotor",
    rotorHulk: "craft_cyberhawk_rotor_hulk",
    rotorScale: 1.24,
    rotOff: Math.PI / 2,
    forwardThrust: 740, strafeThrust: 500, maxSpeed: 500, minSpeed: 0, yawRate: 3.35, yawAccel: 16, drag: 1.2,
    verticalThrust: 480, cruiseThrust: 48, cruiseAgl: 46, maxAgl: 118,
    gunMode: "turret",
    loadout: ["railgun", "swarm_missile", "attack_drone", "emp"],
    stations: [
      { mount: "turret", controller: "pilot", displayName: "RAILGUN" },
      { mount: "hardpoint", controller: "pilot", displayName: "STARSTREAK" },
      { mount: "bay", controller: "pilot", displayName: "SPECTER" },
      { mount: "turret", controller: "pilot", displayName: "EMP" },
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
    gun: "heli_gun",
    // No rotor — hover via energy FX later.
    rotOff: Math.PI / 2,
    forwardThrust: 900, strafeThrust: 760, maxSpeed: 600, minSpeed: 0, yawRate: 4.5, yawAccel: 25, drag: 0.95,
    verticalThrust: 700, cruiseThrust: 65, cruiseAgl: 90, maxAgl: 240,
    liftClass: "heavy",
    gunMode: "fixed",
    loadout: ["plasma_cannon", "laser_rocket", "photon_missile", "warp_bomb"],
    stations: [
      { mount: "turret", controller: "pilot" },
      { mount: "fixed", controller: "pilot", traverse: { center: 0, arc: 12 } },
      { mount: "fixed", controller: "pilot", traverse: { center: 0, arc: 12 } },
      { mount: "bay", controller: "pilot" },
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
    gun: "heli_gun",
    gunVisible: false,
    rotOff: Math.PI / 2,
    forwardThrust: 1050, reverseThrust: 130, strafeThrust: 260, maxSpeed: 680, maxReverseSpeed: 65, minSpeed: 0, yawRate: 2.35, yawAccel: 10, drag: 1.15,
    verticalThrust: 430, cruiseThrust: 45, cruiseAgl: 120, maxAgl: 300,
    gunMode: "fixed",
    loadout: ["medium_gatling_cannon", "long_range_missile", "sidewinder_missile", "gps_bomb"],
    stations: [
      { mount: "fixed", controller: "pilot", traverse: { center: 0, arc: 12 } },
      { mount: "bay", controller: "pilot" },
      { mount: "hardpoint", controller: "pilot" },
      { mount: "bay", controller: "pilot" },
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
    gun: "heli_gun",
    rotor: "craft_osprey_rotor",
    rotorHulk: "craft_osprey_rotor_hulk",
    rotorScale: 0.24,
    rotOff: Math.PI / 2,
    forwardThrust: 500, strafeThrust: 0, maxSpeed: 300, minSpeed: 190, yawRate: 0.7, yawAccel: 2, drag: 1.5,
    verticalThrust: 180, cruiseThrust: 22, cruiseAgl: 120, maxAgl: 300,
    gunMode: "turret",
    loadout: ["heavy_artillery", "medium_cannon", "light_cannon", "gps_missile"],
    stations: [
      { mount: "cabin", controller: "gunner", traverse: { center: -90, arc: 180, side: "left" } },
      { mount: "cabin", controller: "gunner", traverse: { center: -90, arc: 180, side: "left" } },
      { mount: "cabin", controller: "gunner", traverse: { center: -90, arc: 180, side: "left" } },
      { mount: "hardpoint", controller: "pilot" },
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
    gun: "heli_gun",
    rotOff: Math.PI / 2,
    forwardThrust: 1200, strafeThrust: 0, maxSpeed: 760, minSpeed: 300, yawRate: 1.25, yawAccel: 5.5, drag: 0.75,
    verticalThrust: 260, cruiseThrust: 32, cruiseAgl: 150, maxAgl: 360,
    gunMode: "fixed",
    loadout: ["heavy_cannon", "heavy_guided_missile", "bomb", "gps_bomb"],
    stations: [
      { mount: "fixed", controller: "pilot", traverse: { center: 0, arc: 10 }, displayName: "GAU-8" },
      { mount: "hardpoint", controller: "pilot", displayName: "MAVERICK" },
      { mount: "bay", controller: "pilot", displayName: "MK82" },
      { mount: "bay", controller: "pilot", displayName: "JDAM" },
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
};

export type CraftComposite = {
  body: { tex: string; origin: { x: number; y: number } };
  guns: CraftCompositePart[];
  rotors: CraftCompositePart[];
};

/** Shared live-rotor diameter policy used by world rendering and previews. */
export function rotorDrawSpan(tex: string, partScale = 1): number {
  if (tex === "heli_rotor") return 124 * 1.08 * partScale;
  if (tex.includes("rotor") && tex !== "enemy_drone_rotor") return 108 * partScale;
  return 108 * partScale;
}

/** Authored rotor centers and optional per-mount scales; one center fallback for legacy craft. */
export function craftRotorMounts(c: CraftSpec = craftOf()): { x: number; y: number; scale?: number }[] {
  const mounts = lookupSpritePoints(c.body)
    .filter((point) => point.role === "rotor")
    .map((point) => ({ x: point.x, y: point.y, ...(point.scale != null ? { scale: point.scale } : {}) }));
  return mounts.length ? mounts : [{ x: 0.5, y: 0.5 }];
}

/** Authoritative visual parts and mounts for composing a craft in any view. */
export function craftComposite(c: CraftSpec = craftOf()): CraftComposite {
  const rotorTex = craftRotorTex(c);
  return {
    body: { tex: c.body, origin: craftOrigin(c) },
    guns:
      c.gunVisible === false
        ? []
        : craftGunMounts(c).map((mount) => ({
            kind: "gun",
            tex: c.gun,
            origin: craftGunOrigin(c),
            mount,
            layer: "below",
          })),
    rotors: rotorTex
      ? craftRotorMounts(c).map((mount) => ({
          kind: "rotor",
          tex: rotorTex,
          spinTex: craftRotorSpinTex(c),
          origin: lookupSpriteOrigin(rotorTex) ?? DEFAULT_ORIGIN,
          mount,
          layer: "above",
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

/** Craft whose body/gun/hulk/rotor texture matches `key` (bare, no camo suffix). */
export function craftByTexture(key: string): CraftSpec | undefined {
  const k = key.replace(/__(woodland|desert|urban|snow|digital)$/, "");
  return allCrafts().find(
    (c) =>
      c.body === k ||
      c.hulk === k ||
      c.gun === k ||
      c.rotor === k ||
      c.rotorHulk === k
  );
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
  return lookupSpriteOrigin(c.gun) ?? DEFAULT_ORIGIN;
}

/** Wing hardpoint UVs (missile / rocket / TOW) — left → right. */
export function craftSecondaryMounts(c: CraftSpec = craftOf()): { x: number; y: number }[] {
  return mountsOf(c.body, "secondary");
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
    if (c.gun === k) return craftGunOrigin(c);
  }
  return undefined;
}

/** Tagged hull mounts for a craft — from SPRITE_SPECS body points. */
export function craftMountsOf(sp: CraftSpec): HullMount[] {
  const roles: HullMountRole[] = ["gun", "rotor", "secondary", "exhaust"];
  const tagged: HullMount[] = [];
  for (const role of roles) {
    for (const p of mountsOf(sp.body, role)) {
      tagged.push({ x: p.x, y: p.y, role, label: role });
    }
  }
  numberMountLabels(tagged);
  return tagged;
}
