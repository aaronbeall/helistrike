import { lookupSpriteMuzzles, lookupSpriteOrigin, lookupSpritePoints, mountsOf, spritePointLabel } from "./spriteOrigin";
import {
  type HullMount,
  type HullMountRole,
  type TrackKind,
} from "./roster";
import { weaponMountTex, type CountermeasureId, type WpnId } from "./combat";

const DEFAULT_ORIGIN = { x: 0.5, y: 0.5 };

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Playable / selectable craft.
 * UV layout lives in SPRITE_SPECS for body/gun textures — craft only names textures
 * and gameplay fields. Pick via `selectCraft` / `craftOf(kind)`.
 * `CraftKind` is derived from `CRAFTS` keys below.
 */

/** Physical install class — also the weapon compatibility key (`fits`). */
export type SocketClass = "fixed" | "turret" | "hardpoint";

/** Aesthetic crew-served role for automatic turret stations (HUD / hangar). */
export type CrewRole = "door" | "ramp" | "belly";

/** Body UV this socket owns, with optional per-barrel rest aim (turrets). */
export interface SocketPoint {
  /** `SPRITE_SPECS[body].points` id within the class→role set. */
  id: string;
  /** Preferred aim degrees off craft nose (overrides socket `heading`). */
  heading?: number;
  /** Per-barrel draw layer (overrides socket `gunLayer`). */
  layer?: "below" | "above";
}

export interface CraftSocket {
  /** Stable physical install id (hangar / save) — location, not weapon. */
  id: string;
  /** Mount class — drives aim policy and weapon fit. */
  class: SocketClass;
  controller: "pilot" | "automatic";
  /** Default installed weapon; hangar may reassign any catalog weapon in `fits`. */
  weapon: WpnId;
  /**
   * Body UVs this socket owns, by id, in fire / overlay order.
   * Resolved only within class→role (turret→gun, fixed→muzzle, hardpoint→hardpoint).
   * Omit → all points of that role (several turrets may share the same gun UVs).
   * Specify only to partition a multi-gun hull (e.g. Gunship spooky/bofors/howitzer).
   */
  points?: SocketPoint[];
  /**
   * Shared rest / preferred aim in degrees off craft nose (0 = forward).
   * Used when `points[i].heading` is omitted — handy for a single-gun socket
   * without stuffing heading into `points: [{ id, heading }]`.
   */
  heading?: number;
  /** Fire cone width in degrees, centered on that barrel’s heading (or 0). Omit = unrestricted. */
  traverse?: number;
  /** Authored multi-muzzle policy belongs to this installation, not the weapon identity. */
  muzzleFire?: "single" | "alternate" | "simultaneous";
  /**
   * Optional turret overlay texture (default: weapon `art.mount`).
   * Use for craft-specific turrets (e.g. hover tank dual-rail cupola).
   */
  gunTex?: string;
  /** Draw turret above the hull (default below for heli chin guns). */
  gunLayer?: "below" | "above";
  /** Extra draw scale for this turret overlay (× craft `gunOverlayScale`). */
  gunScale?: number;
  /**
   * Shell-gun reverse thrust on this station (same impulse path as craft `cannonInherit`).
   * Use when only one mount should kick — e.g. Marauder howitzer, not crew miniguns.
   */
  recoil?: boolean;
  /** Crew-served station flavor (door / ramp / belly gunners) — not a technical "auto" tag. */
  crew?: CrewRole;
  /** Extra capacity on this station, on top of craft `ammoScale`. */
  ammoMul?: number;
  /**
   * Multiplies fire rate (shots / time). Omit = 1.
   * Cooldown applied at fire = catalog `fireCd / fireRateMul`.
   */
  fireRateMul?: number;
  /**
   * Engage / beam envelope override in world units (Tesla coil muzzle reach).
   * Omit → weapon catalog `launch.range`.
   */
  range?: number;
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

/**
 * How the player steers the hull (orthogonal to flightModel dynamics).
 * - aim: nose follows reticle (default helis / most VTOL)
 * - plane: mouse aim + A/D circle offset; banked yaw / gun-brake / jet aim clamp
 * - orbit: hold A/D yaw, W/S speed trim; mouse aims weapons only (AC-130)
 */
export type ControlScheme = "aim" | "plane" | "orbit";

/** Authored exhaust plume for craft with nozzle FX. */
export interface CraftExhaustProfile {
  rate: number;
  speed: number;
  tint: number;
  smoke: number;
  sx: number;
  sy: number;
  life: number;
  flame: number;
  gap: number;
  /** Degrees from warm exhaust art; 0 keeps source orange. */
  flameHue?: number;
  /** Dense ribbon particle counts (jets). */
  ribbonDense?: boolean;
  /** Glow oval follows hull pose instead of jet angle (Prometheus). */
  glowFollowsHull?: boolean;
}

export interface CraftSpec {
  /** Catalog key — must match the CRAFTS entry name. */
  kind: string;
  name: string;
  fullName: string;
  /** Short fantasy combat identity shown on the craft profile (hangar / help). */
  role: string;
  /**
   * Hangar / mission-select roster. Omit or true → playable player craft.
   * False → hull used by remotes / pods only (still `craftOf`-able for Heli).
   */
  playable?: boolean;
  flightModel: "heli" | "vtol" | "plane" | "ground";
  /** Player hull-steer mapping; omit → aim. */
  controlScheme?: ControlScheme;
  /** Cannon muzzle impulse inherits craft velocity. */
  cannonInherit?: boolean;
  /** Chin/turret overlay draw scale (cobra/viper 0.42). */
  gunOverlayScale?: number;
  /**
   * Elastic whip antenna — base UV role `antenna` on the gun overlay (or body).
   * Tip springs upright and wobbles with hull / turret motion.
   */
  antenna?: {
    length?: number;
    aft?: number;
    stiffness?: number;
    damping?: number;
    yawWhip?: number;
    lag?: number;
  };
  /**
   * Extra framing mul on size-based camera scale (<1 zooms out).
   * Use for low ground-huggers that need more theater around the hull.
   */
  cameraScale?: number;
  /** Exhaust nozzle plume; omit → no craft exhaust FX. */
  exhaustProfile?: CraftExhaustProfile;
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
  /** T / sensor-cam thermal look. Omit → white_hot. */
  sensorPalette?: "white_hot" | "full_spectrum" | "black_hot" | "night_vision";
  /**
   * Flat hover plate: no yaw bank lean, no roll foreshorten on the body.
   * Use for ground-huggers (Wraith / HOUND) and heavy sky haulers (Leviathan / Marauder).
   * Omit → normal bank lean / squash.
   */
  flatHull?: boolean;
  /**
   * Ground track prints while moving (tread / tire / …).
   * Used by craft-backed remotes (HOUND) and any dirt-locked hull.
   */
  track?: TrackKind;
  trackGap?: number;
  trackScale?: number;
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
   * Tiny (Murder Hornet ~0.3) = near-instant spool + fast spin; Chinook >1 = slower.
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
  /** Enemy spotting / chase-engage range multiplier. Does not change aim accuracy or weapon fire range. Helis also get a slight extra cut at low AGL. */
  enemyAwareMul?: number;
  /** Countermeasure on E. Omit → flares. */
  countermeasure?: CountermeasureId;
}

/** Catalog of player-selectable craft. */
const CRAFTS_DEFS = {
  apache: {
    kind: "apache",
    name: "Apache",
    fullName: "AH-64E Apache",
    role: "Heavy Gunship",
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
      { id: "chin_turret", class: "turret", controller: "pilot", weapon: "chain_gun", traverse: 240 },
      { id: "wing_hardpoint_1", class: "hardpoint", controller: "pilot", weapon: "rocket" },
      { id: "wing_hardpoint_2", class: "hardpoint", controller: "pilot", weapon: "hellfire_missile" },
      { id: "wing_hardpoint_3", class: "hardpoint", controller: "pilot", weapon: "tv_missile" },
    ],
  },
  little_bird: {
    kind: "little_bird",
    name: "Little Bird",
    fullName: "AH-6 Little Bird",
    role: "Knife Fighter",
    flightModel: "heli",
    sizeM: 9.94,
    ammoScale: 0.7,
    health: 70,
    radius: 14,
    height: 8,
    body: "craft_littlebird",
    hulk: "craft_littlebird_hulk",
    rotor: "craft_littlebird_rotor",
    rotorHulk: "craft_littlebird_rotor_hulk",
    rotorScale: 0.71,
    rotOff: Math.PI / 2,
    forwardThrust: 660, strafeThrust: 560, maxSpeed: 390, minSpeed: 0, yawRate: 4.1, yawAccel: 22, drag: 1.25,
    verticalThrust: 520, cruiseThrust: 52, cruiseAgl: 46, maxAgl: 118,
    sockets: [
      { id: "wing_gun_l", class: "fixed", controller: "pilot", weapon: "minigun", muzzleFire: "simultaneous" },
      { id: "wing_hardpoint_1", class: "hardpoint", controller: "pilot", weapon: "rocket" },
      { id: "wing_hardpoint_2", class: "hardpoint", controller: "pilot", weapon: "stinger_missile" },
      { id: "wing_hardpoint_3", class: "hardpoint", controller: "pilot", weapon: "heavy_cal_pod" },
    ],
  },
  cobra: {
    kind: "cobra",
    name: "Cobra",
    fullName: "AH-1 Cobra",
    role: "Classic Striker",
    flightModel: "heli",
    // IRL AH-1 shorter than Apache; keep under Apache's sizeM baseline.
    sizeM: 13.4,
    ammoScale: 1.05,
    health: 82,
    radius: 16,
    height: 13,
    // Slimmer silhouette → slightly harder for enemies to notice than Apache.
    enemyAwareMul: 0.92,
    body: "craft_cobra",
    hulk: "craft_cobra_hulk",
    sensorPalette: "night_vision",
    rotor: "craft_cobra_rotor",
    rotorHulk: "craft_cobra_rotor_hulk",
    rotorScale: 1.24,
    rotOff: Math.PI / 2,
    gunOverlayScale: 0.42,
    // Hot-rod classic: snappier than Apache/Viper, thinner skin.
    forwardThrust: 640, strafeThrust: 450, maxSpeed: 395, minSpeed: 0, yawRate: 3.45, yawAccel: 18.5, drag: 1.35,
    verticalThrust: 440, cruiseThrust: 46, cruiseAgl: 46, maxAgl: 118,
    sockets: [
      { id: "chin_turret", class: "turret", controller: "pilot", weapon: "gatling", traverse: 280 },
      { id: "wing_hardpoint_1", class: "hardpoint", controller: "pilot", weapon: "rocket", ammoMul: 1.45 },
      { id: "wing_hardpoint_2", class: "hardpoint", controller: "pilot", weapon: "sidewinder_missile" },
      { id: "wing_hardpoint_3", class: "hardpoint", controller: "pilot", weapon: "tow_missile" },
    ],
  },
  viper: {
    kind: "viper",
    name: "Viper",
    fullName: "AH-1Z Viper",
    role: "Modern Striker",
    flightModel: "heli",
    // Same silhouette class as Cobra; under Apache sizeM.
    sizeM: 13.4,
    ammoScale: 1.2,
    health: 90,
    radius: 16,
    height: 13,
    enemyAwareMul: 0.92,
    body: "craft_viper",
    hulk: "craft_viper_hulk",
    rotor: "craft_viper_rotor",
    rotorHulk: "craft_viper_rotor_hulk",
    rotorScale: 1.24,
    gunOverlayScale: 0.42,
    rotOff: Math.PI / 2,
    // Between Cobra and Apache: slightly less snap than Cobra, still a striker.
    forwardThrust: 620, strafeThrust: 430, maxSpeed: 385, minSpeed: 0, yawRate: 3.3, yawAccel: 17, drag: 1.38,
    verticalThrust: 425, cruiseThrust: 44, cruiseAgl: 48, maxAgl: 122,
    sockets: [
      { id: "chin_turret", class: "turret", controller: "pilot", weapon: "gatling", traverse: 280 },
      { id: "wing_hardpoint_1", class: "hardpoint", controller: "pilot", weapon: "rocket" },
      { id: "wing_hardpoint_2", class: "hardpoint", controller: "pilot", weapon: "hellfire_missile" },
      { id: "wing_hardpoint_3", class: "hardpoint", controller: "pilot", weapon: "tow_missile", ammoMul: 8 / 7 },
    ],
  },
  blackhawk: {
    kind: "blackhawk",
    name: "Black Hawk",
    fullName: "UH-60M Black Hawk",
    role: "Assault Transport",
    flightModel: "heli",
    sizeM: 19.76,
    ammoScale: 1.3,
    health: 135,
    radius: 27,
    height: 15,
    body: "craft_blackhawk",
    hulk: "craft_blackhawk_hulk",
    sensorPalette: "black_hot",
    rotor: "craft_blackhawk_rotor",
    rotorHulk: "craft_blackhawk_rotor_hulk",
    rotorScale: 1.39,
    rotOff: Math.PI / 2,
    forwardThrust: 450, strafeThrust: 260, maxSpeed: 280, minSpeed: 0, yawRate: 1.95, yawAccel: 8, drag: 1.85,
    verticalThrust: 300, cruiseThrust: 32, cruiseAgl: 46, maxAgl: 118,
    liftClass: "medium",
    sockets: [
      { id: "wing_guns", class: "fixed", controller: "pilot", weapon: "gatling", muzzleFire: "simultaneous" },
      { id: "wing_hardpoint_1", class: "hardpoint", controller: "pilot", weapon: "rocket" },
      { id: "wing_hardpoint_2", class: "hardpoint", controller: "pilot", weapon: "hellfire_missile" },
      // Door guns: explicit points ↔ heading.
      {
        id: "cabin_doors",
        class: "turret",
        controller: "automatic",
        weapon: "machine_gun",
        points: [
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
    role: "Heavy Lift",
    flightModel: "heli",
    sizeM: 30.1,
    ammoScale: 1.6,
    health: 420,
    radius: 41,
    height: 25,
    body: "craft_chinook",
    hulk: "craft_chinook_hulk",
    sensorPalette: "black_hot",
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
        points: [
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
        bombDrop: { momentum: 0.28, maxBoost: 240, loft: 130, loftMax: 230 },
      },
      {
        id: "bomb_bay_2",
        class: "hardpoint",
        controller: "pilot",
        weapon: "cluster_bomb",
        bombDrop: { momentum: 0.28, maxBoost: 240, loft: 130, loftMax: 230 },
      },
      // Ramp gun faces aft.
      {
        id: "cabin_ramp",
        class: "turret",
        controller: "automatic",
        weapon: "heavy_machine_gun",
        points: [{ id: "ramp", heading: 180 }],
        traverse: 270,
        crew: "ramp",
      },
    ],
  },
  osprey: {
    kind: "osprey",
    name: "Osprey",
    fullName: "MV-22B Osprey",
    role: "Tiltrotor Assault",
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
        points: [{ id: "belly" }],
        traverse: 360,
        crew: "belly",
      },
      { id: "wing_hardpoint_1", class: "hardpoint", controller: "pilot", weapon: "guided_rockets", ammoMul: 1.25 },
      { id: "wing_hardpoint_2", class: "hardpoint", controller: "pilot", weapon: "hellfire_missile" },
      {
        id: "cabin_ramp",
        class: "turret",
        controller: "automatic",
        weapon: "heavy_machine_gun",
        points: [{ id: "ramp", heading: 180 }],
        traverse: 270,
        crew: "ramp",
      },
    ],
  },
  stealthhawk: {
    kind: "stealthhawk",
    name: "Stealth Hawk",
    fullName: "XH-60 Stealth Hawk",
    role: "Stealth Striker",
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
      { id: "chin_turret", class: "turret", controller: "pilot", weapon: "concealed_cannon", traverse: 220 },
      { id: "wing_hardpoint_1", class: "hardpoint", controller: "pilot", weapon: "guided_rockets", ammoMul: 0.75 },
      { id: "wing_hardpoint_2", class: "hardpoint", controller: "pilot", weapon: "stinger_missile" },
      { id: "wing_hardpoint_3", class: "hardpoint", controller: "pilot", weapon: "smoke_bomb" },
    ],
    enemyAimMul: 0.55,
    enemySeekerMul: 0.42,
    enemyAwareMul: 0.32,
    countermeasure: "emp",
  },
  cyberhawk: {
    kind: "cyberhawk",
    name: "Cyber Hawk",
    fullName: "XH-88 Cyber Hawk",
    role: "Tech Gunship",
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
    rotorScale: 1,
    rotOff: Math.PI / 2,
    forwardThrust: 740, strafeThrust: 500, maxSpeed: 500, minSpeed: 0, yawRate: 3.35, yawAccel: 16, drag: 1.2,
    verticalThrust: 480, cruiseThrust: 48, cruiseAgl: 46, maxAgl: 118,
    exhaustProfile: {
      rate: 32, speed: 105, tint: 0x70d8ff, smoke: 0x485761, sx: 1.05, sy: 0.26, life: 1180, flame: 0.5, gap: 9, flameHue: 172,
    },
    sockets: [
      // Single chin rail — snappier than the catalog / hover dual.
      { id: "chin_turret", class: "turret", controller: "pilot", weapon: "railgun", traverse: 150, fireRateMul: 1.55 },
      { id: "wing_hardpoint", class: "hardpoint", controller: "pilot", weapon: "swarm_missile" },
      { id: "tesla_coil", class: "turret", controller: "pilot", weapon: "tesla_beam", traverse: 150, range: 260 },
      { id: "bomb_bay", class: "hardpoint", controller: "pilot", weapon: "attack_drone" },
    ],
    countermeasure: "timewarp",
    sensorPalette: "full_spectrum",
  },
  quad_drone: {
    kind: "quad_drone",
    name: "Murder Hornet",
    fullName: "MQ-27 Murder Hornet",
    role: "Kill Drone",
    flightModel: "heli",
    sizeM: 1.9,
    ammoScale: 0.65,
    health: 45,
    radius: 4.5,
    height: 3.2,
    body: "craft_quad_drone",
    hulk: "craft_quad_drone_hulk",
    rotor: "craft_quad_drone_rotor",
    rotorHulk: "craft_quad_drone_rotor_hulk",
    rotorScale: 0.26,
    rotOff: Math.PI / 2,
    forwardThrust: 760, strafeThrust: 700, maxSpeed: 440, minSpeed: 0, yawRate: 8.7, yawAccel: 47, drag: 1.05,
    verticalThrust: 650, cruiseThrust: 60, cruiseAgl: 38, maxAgl: 105,
    sockets: [
      { id: "belly_gun", class: "fixed", controller: "pilot", weapon: "machine_gun",
        points: [{ id: "pod0" }, { id: "pod1" }], muzzleFire: "simultaneous" },
      { id: "belly_coil", class: "fixed", controller: "pilot", weapon: "tesla_beam",
        points: [{ id: "coil" }], range: 138 },
      { id: "wing_hardpoint", class: "hardpoint", controller: "pilot", weapon: "mini_hellfire_missile" },
      {
        id: "bomb_bay",
        class: "hardpoint",
        controller: "pilot",
        weapon: "mini_bomb",
        bombDrop: { momentum: 0.45, maxBoost: 160, loft: 110, loftMax: 190 },
      },
    ],
    countermeasure: "emp",
  },
  lightning_ii: {
    kind: "lightning_ii",
    name: "Lightning II",
    fullName: "F-35B Lightning II",
    role: "Fast Attack",
    flightModel: "vtol",
    controlScheme: "plane",
    cannonInherit: true,
    sizeM: 15.7,
    ammoScale: 1.5,
    health: 165,
    radius: 31,
    height: 13,
    body: "craft_lightning_ii",
    hulk: "craft_lightning_ii_hulk",
    rotOff: Math.PI / 2,
    forwardThrust: 1050, reverseThrust: 130, strafeThrust: 260, maxSpeed: 680, maxReverseSpeed: 65, minSpeed: 0, yawRate: 2.35, yawAccel: 10, drag: 1.15,
    verticalThrust: 380, cruiseThrust: 40, cruiseAgl: 210, maxAgl: 420,
    exhaustProfile: {
      rate: 56, speed: 160, tint: 0xbfeaff, smoke: 0x3b4145, sx: 1.22, sy: 0.3, life: 1320, flame: 0.72, gap: 6,
      flameHue: 185, ribbonDense: true,
    },
    sockets: [
      { id: "nose_gun", class: "fixed", controller: "pilot", weapon: "medium_gatling_cannon" },
      { id: "internal_bay_1", class: "hardpoint", controller: "pilot", weapon: "light_gps_missile" },
      { id: "wing_hardpoint", class: "hardpoint", controller: "pilot", weapon: "sidewinder_missile" },
      // Fast attack: bombs carry craft speed; little corrective throw.
      {
        id: "internal_bay_2",
        class: "hardpoint",
        controller: "pilot",
        weapon: "gps_bomb",
        // JDAM: less carry, more aim throw — fins do the rest in flight.
        bombDrop: { momentum: 0.48, maxBoost: 185, loft: 105, loftMax: 190 },
      },
    ],
  },
  warthog: {
    kind: "warthog",
    name: "Warthog",
    fullName: "A-10C Warthog",
    role: "Tank Buster",
    flightModel: "plane",
    controlScheme: "plane",
    cannonInherit: true,
    sizeM: 17.42,
    ammoScale: 1.3,
    health: 150,
    radius: 40,
    height: 13,
    body: "craft_warthog",
    hulk: "craft_warthog_hulk",
    rotOff: Math.PI / 2,
    forwardThrust: 1200, strafeThrust: 0, maxSpeed: 760, minSpeed: 400, yawRate: 1.85, yawAccel: 8.2, drag: 0.75,
    verticalThrust: 180, cruiseThrust: 24, cruiseAgl: 280, maxAgl: 560,
    exhaustProfile: {
      rate: 52, speed: 145, tint: 0xff8a2c, smoke: 0x3d3935, sx: 1.35, sy: 0.34, life: 1420, flame: 0.7, gap: 7,
      flameHue: 0, ribbonDense: true,
    },
    sockets: [
      { id: "nose_gun", class: "fixed", controller: "pilot", weapon: "heavy_cannon" },
      {
        id: "bomb_bay_1",
        class: "hardpoint",
        controller: "pilot",
        weapon: "cluster_bomb",
        // Dumb iron: same craft carry as before, weaker aim correction (vs JDAM bay).
        bombDrop: { momentum: 0.45, maxBoost: 85, loft: 110, loftMax: 195 },
      },
      { id: "wing_hardpoint", class: "hardpoint", controller: "pilot", weapon: "heavy_guided_missile" },
      {
        id: "bomb_bay_2",
        class: "hardpoint",
        controller: "pilot",
        weapon: "gps_bomb",
        bombDrop: { momentum: 0.52, maxBoost: 170, loft: 100, loftMax: 180 },
      },
    ],
  },
  gunship: {
    kind: "gunship",
    name: "Gunship",
    fullName: "AC-130 Gunship",
    role: "Loiter Gunship",
    flightModel: "plane",
    controlScheme: "orbit",
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
    forwardThrust: 580, strafeThrust: 0, maxSpeed: 340, minSpeed: 200, yawRate: 0.95, yawAccel: 2.6, drag: 1.25,
    verticalThrust: 90, cruiseThrust: 14, cruiseAgl: 320, maxAgl: 520,
    sockets: [
      {
        id: "cabin_gun_1",
        class: "turret",
        controller: "automatic",
        weapon: "heavy_artillery",
        points: [{ id: "howitzer" }],
        heading: -90,
        traverse: 160,
      },
      {
        id: "cabin_gun_2",
        class: "turret",
        controller: "automatic",
        weapon: "medium_cannon",
        points: [{ id: "bofors" }],
        heading: -90,
        traverse: 160,
      },
      {
        id: "cabin_gun_3",
        class: "turret",
        controller: "automatic",
        weapon: "light_cannon",
        points: [{ id: "spooky" }],
        heading: -90,
        traverse: 160,
      },
      {
        id: "wing_hardpoint",
        class: "hardpoint",
        controller: "pilot",
        weapon: "gps_missile",
      },
    ],
    sensorPalette: "black_hot",
  },
  prometheus: {
    kind: "prometheus",
    name: "Prometheus",
    fullName: "XV-99 Prometheus",
    role: "Phase Striker",
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
    exhaustProfile: {
      rate: 26, speed: 72, tint: 0xc86cff, smoke: 0x6b3a78, sx: 0.98, sy: 0.28, life: 1320, flame: 0.58, gap: 10,
      flameHue: 248, glowFollowsHull: true,
    },
    sockets: [
      // Helix + Refractor share the belly gun UV (same pattern as Cyberhawk chin).
      { id: "belly_turret", class: "turret", controller: "pilot", weapon: "plasma_cannon", traverse: 260 },
      { id: "belly_beam", class: "turret", controller: "pilot", weapon: "laser_rocket", traverse: 260 },
      { id: "body_hardpoint", class: "hardpoint", controller: "pilot", weapon: "photon_missile" },
      { id: "bomb_bay", class: "hardpoint", controller: "pilot", weapon: "warp_bomb" },
    ],
    countermeasure: "phase_cloak",
    sensorPalette: "full_spectrum",
  },
  airship: {
    kind: "airship",
    name: "Leviathan",
    fullName: "Leviathan Airship",
    role: "Sky Fortress",
    // Gunship-style loiter: A/D yaw, W/S trim, mouse aims stores.
    flightModel: "plane",
    controlScheme: "orbit",
    sizeM: 68,
    ammoScale: 2.4,
    health: 480,
    radius: 118,
    height: 72,
    body: "craft_airship",
    hulk: "craft_airship_hulk",
    // Propellers are composited (nacelle + stern + bow mounts) — not painted into body art.
    rotor: "craft_osprey_rotor",
    rotorHulk: "craft_osprey_rotor_hulk",
    rotorScale: 0.34,
    rotorInertia: 0.55,
    // Sky fortress stays upright — no A/D bank lean.
    flatHull: true,
    rotOff: Math.PI / 2,
    forwardThrust: 280, strafeThrust: 0, maxSpeed: 160, minSpeed: 70, yawRate: 0.55, yawAccel: 1.4, drag: 1.85,
    verticalThrust: 70, cruiseThrust: 16, cruiseAgl: 220, maxAgl: 380,
    liftClass: "heavy",
    // Twin stern vents — warm steampunk wash (UVs on craft_airship).
    // flameHue 0 = source orange sheet (`fx_flame`); only 172/185/248 are pre-baked.
    exhaustProfile: {
      rate: 16,
      speed: 48,
      tint: 0xd4a878,
      smoke: 0x5a5048,
      sx: 1.35,
      sy: 0.48,
      life: 1680,
      flame: 0.38,
      gap: 16,
      flameHue: 0,
      glowFollowsHull: true,
    },
    sockets: [
      // Top-center revolving grenade lob — pilot turret, iron-bomb arc.
      {
        id: "grenade_turret",
        class: "turret",
        controller: "pilot",
        weapon: "grenade_launcher",
        points: [{ id: "grenade" }],
        traverse: 240,
        gunLayer: "above",
        gunScale: 1.05,
        bombDrop: { momentum: 0.2, maxBoost: 290, loft: 150, loftMax: 270 },
      },
      // Four deck .50s — one HUD slot; each barrel aims/fires independently.
      {
        id: "deck_fifties",
        class: "turret",
        controller: "automatic",
        weapon: "heavy_machine_gun",
        points: [
          { id: "bow_l", heading: -20 },
          { id: "bow_r", heading: 20 },
          { id: "flank_l", heading: -90 },
          { id: "flank_r", heading: 90 },
        ],
        traverse: 220,
        gunLayer: "above",
        gunScale: 0.85,
        crew: "door",
      },
      {
        id: "banshee_racks",
        class: "hardpoint",
        controller: "pilot",
        weapon: "banshee",
        points: [
          { id: "star_l0" },
          { id: "star_r0" },
          { id: "star_l1" },
          { id: "star_r1" },
          { id: "star_l2" },
          { id: "star_r2" },
          { id: "star_l3" },
          { id: "star_r3" },
          { id: "star_l4" },
          { id: "star_r4" },
        ],
      },
      {
        id: "skiff_bay",
        class: "hardpoint",
        controller: "pilot",
        weapon: "wingman_drone",
        points: [{ id: "skiff" }],
        // Catalog ammo × airship ammoScale 2.4 → cap the bay at 6 Skiffs.
        ammoMul: 6 / Math.round(6 * 2.4),
      },
      {
        id: "fighter_bay",
        class: "hardpoint",
        controller: "pilot",
        weapon: "fighter_pod",
        points: [{ id: "skiff" }],
      },
    ],
    sensorPalette: "black_hot",
  },
  biplane: {
    kind: "biplane",
    name: "Red Baron",
    fullName: "Fokker Dr.I",
    role: "Dogfighter",
    flightModel: "plane",
    controlScheme: "plane",
    sizeM: 7.2,
    ammoScale: 0.55,
    health: 55,
    radius: 16,
    height: 6,
    body: "craft_biplane",
    hulk: "craft_biplane_hulk",
    rotor: "craft_osprey_rotor",
    rotorHulk: "craft_osprey_rotor_hulk",
    rotorScale: 0.16,
    rotorInertia: 0.22,
    sensorPalette: "night_vision",
    rotOff: Math.PI / 2,
    // Slow but agile: little thrust differential; plane yaw a touch slower than the snap gun.
    forwardThrust: 420, reverseThrust: 380, strafeThrust: 0, maxSpeed: 280, minSpeed: 90, yawRate: 3.15, yawAccel: 13, drag: 1.45,
    verticalThrust: 110, cruiseThrust: 20, cruiseAgl: 90, maxAgl: 220,
    sockets: [
      { id: "nose_guns", class: "fixed", controller: "pilot", weapon: "machine_gun", muzzleFire: "simultaneous" },
      {
        id: "observer",
        class: "turret",
        controller: "pilot",
        weapon: "artillery_strike",
        points: [{ id: "cockpit" }],
        gunLayer: "above",
        gunScale: 0.52,
      },
      {
        id: "wing_rockets",
        class: "hardpoint",
        controller: "pilot",
        weapon: "incendiary_rocket",
        points: [{ id: "wing_l" }, { id: "wing_r" }],
      },
      {
        id: "bomb_bay",
        class: "hardpoint",
        controller: "pilot",
        weapon: "bomb",
        points: [{ id: "bay" }],
        bombDrop: { momentum: 0.4, maxBoost: 70, loft: 90, loftMax: 160 },
      },
    ],
    countermeasure: "smoke_screen",
    enemySeekerMul: 0.72,
  },
  // Leviathan wingman — remote-only hull (not hangar-selectable).
  skiff: {
    kind: "skiff",
    name: "Skiff",
    fullName: "SKIFF Wingman",
    role: "AI Wingman",
    playable: false,
    flightModel: "plane",
    controlScheme: "plane",
    sizeM: 6.4,
    ammoScale: 0.55,
    health: 36,
    radius: 14,
    height: 5,
    body: "craft_skiff",
    hulk: "craft_skiff_hulk",
    rotor: "craft_osprey_rotor",
    rotorHulk: "craft_osprey_rotor_hulk",
    rotorScale: 0.14,
    rotorInertia: 0.2,
    rotOff: Math.PI / 2,
    // Faster boom-and-zoom than the hangar biplane.
    forwardThrust: 520, reverseThrust: 360, strafeThrust: 0, maxSpeed: 380, minSpeed: 110, yawRate: 3.2, yawAccel: 13.5, drag: 1.3,
    verticalThrust: 120, cruiseThrust: 22, cruiseAgl: 160, maxAgl: 320,
    sockets: [
      { id: "nose_guns", class: "fixed", controller: "pilot", weapon: "machine_gun", muzzleFire: "simultaneous" },
    ],
    countermeasure: "smoke_screen",
    enemySeekerMul: 0.72,
  },
  // Steampunk fighter pod — same plane scheme as biplane; launched from Leviathan.
  // Not hangar-selectable — remote roster owns lifecycle (`remoteSpecOf("fighter")`).
  raptor: {
    kind: "raptor",
    name: "Raptor",
    fullName: "Raptor Fighter",
    role: "Escort Fighter",
    playable: false,
    flightModel: "plane",
    controlScheme: "plane",
    sizeM: 8.4,
    // Mild POV pull-in vs Leviathan (size scale already zooms small hulls).
    cameraScale: 1.05,
    ammoScale: 0.7,
    health: 48,
    radius: 14,
    height: 6,
    body: "craft_raptor",
    hulk: "craft_raptor_hulk",
    rotor: "craft_osprey_rotor",
    rotorHulk: "craft_osprey_rotor_hulk",
    rotorScale: 0.18,
    rotorInertia: 0.22,
    rotOff: Math.PI / 2,
    forwardThrust: 520, reverseThrust: 320, strafeThrust: 0, maxSpeed: 400, minSpeed: 150, yawRate: 3.4, yawAccel: 14, drag: 1.2,
    // Match Leviathan operating band so the pod doesn't dive to biplane cruise.
    verticalThrust: 140, cruiseThrust: 24, cruiseAgl: 200, maxAgl: 380,
    // Light aft flame — steampunk single nozzle (UV on craft_raptor).
    exhaustProfile: {
      rate: 16,
      speed: 64,
      tint: 0xd4a878,
      smoke: 0x5a5550,
      sx: 0.52,
      sy: 0.18,
      life: 700,
      flame: 0.3,
      gap: 7,
      flameHue: 0,
    },
    sockets: [
      {
        id: "nose_guns",
        class: "fixed",
        controller: "pilot",
        weapon: "machine_gun",
        muzzleFire: "simultaneous",
      },
      {
        id: "wing_rockets",
        class: "hardpoint",
        controller: "pilot",
        weapon: "incendiary_rocket",
        points: [{ id: "wing_l" }, { id: "wing_r" }],
      },
      {
        id: "bomb_bay",
        class: "hardpoint",
        controller: "pilot",
        weapon: "bomb",
        points: [{ id: "bay" }],
        bombDrop: { momentum: 0.4, maxBoost: 70, loft: 90, loftMax: 160 },
      },
    ],
    countermeasure: "smoke_screen",
    enemySeekerMul: 0.68,
  },
  reaper: {
    kind: "reaper",
    name: "Reaper",
    fullName: "MQ-9 Reaper",
    role: "Loiter Hunter",
    flightModel: "plane",
    controlScheme: "orbit",
    sizeM: 20,
    ammoScale: 1.1,
    health: 90,
    radius: 36,
    height: 8,
    body: "craft_reaper",
    hulk: "craft_reaper_hulk",
    rotOff: Math.PI / 2,
    // Orbit loiter like Gunship: A/D turn, W/S trim; mouse aims stores.
    // Cruise above tank/building lob ceilings; helis can still climb to meet.
    forwardThrust: 480, strafeThrust: 0, maxSpeed: 360, minSpeed: 160, yawRate: 1.05, yawAccel: 3.2, drag: 0.95,
    verticalThrust: 70, cruiseThrust: 14, cruiseAgl: 620, maxAgl: 820,
    enemyAwareMul: 0.55,
    exhaustProfile: {
      rate: 14, speed: 78, tint: 0xa8c4d8, smoke: 0x5a6570, sx: 0.72, sy: 0.22, life: 980, flame: 0.32, gap: 12, flameHue: 172,
    },
    sockets: [
      { id: "wing_hardpoint_1", class: "hardpoint", controller: "pilot", weapon: "hellfire_missile" },
      { id: "wing_hardpoint_2", class: "hardpoint", controller: "pilot", weapon: "hellfire_missile" },
      { id: "wing_hardpoint_3", class: "hardpoint", controller: "pilot", weapon: "gps_missile" },
      { id: "sensor_bay", class: "hardpoint", controller: "pilot", weapon: "tv_missile" },
    ],
    sensorPalette: "white_hot",
  },
  hover_tank: {
    kind: "hover_tank",
    name: "Wraith",
    fullName: "MHT-7 Wraith",
    role: "Loiter Assault",
    flightModel: "vtol",
    controlScheme: "orbit",
    sizeM: 9.5,
    ammoScale: 1.15,
    health: 220,
    radius: 28,
    height: 10,
    body: "craft_hover_tank",
    hulk: "craft_hover_tank_hulk",
    gunOverlayScale: 1.15,
    // Ground-hugger reads small on screen — pull the chase cam back.
    cameraScale: 0.72,
    flatHull: true,
    rotOff: Math.PI / 2,
    // Orbit yaw (A/D) + heli thrust (W/S). Reverse is deliberately weak — forward assault hull.
    forwardThrust: 640, reverseThrust: 280, strafeThrust: 0, maxSpeed: 260, maxReverseSpeed: 95, minSpeed: 0, yawRate: 2.4, yawAccel: 12, drag: 1.8,
    verticalThrust: 380, cruiseThrust: 48, cruiseAgl: 18, maxAgl: 48,
    exhaustProfile: {
      rate: 22, speed: 88, tint: 0x70d8ff, smoke: 0x485761, sx: 0.95, sy: 0.28, life: 1100, flame: 0.48, gap: 10, flameHue: 172,
      // Rear vents are painted on the hull — keep the glow oval on body axes.
      glowFollowsHull: true,
    },
    sockets: [
      {
        id: "main_turret",
        class: "turret",
        controller: "pilot",
        weapon: "railgun",
        points: [{ id: "main" }],
        muzzleFire: "simultaneous",
        // Dual rails, slow volleys — cadence clearly below Cyber Hawk's chin rail.
        // 2 × (catalog / 0.48) ≈ similar DPS, much heavier pulse.
        fireRateMul: 0.48,
        gunTex: "craft_hover_tank_turret",
        gunLayer: "above",
        // Cupola rail — print larger than the coax MG on the same mount.
        gunScale: 1.35,
        // Kick opposite turret aim (not hull heading).
        recoil: true,
      },
      {
        id: "coax_mg",
        class: "turret",
        controller: "automatic",
        weapon: "heavy_machine_gun",
        points: [{ id: "coax" }],
        // Draw above the rail turret on the shared cupola.
        gunLayer: "above",
        gunScale: 0.72,
      },
      {
        id: "spider_ports",
        class: "fixed",
        controller: "pilot",
        weapon: "spider_drone",
        muzzleFire: "alternate",
      },
      {
        id: "banshee_rack",
        class: "hardpoint",
        controller: "pilot",
        weapon: "banshee",
        points: [{ id: "wing_l" }, { id: "wing_r" }],
      },
    ],
    // Whip on the rail cupola — wobbles with hull + turret yaw.
    antenna: { length: 12, aft: 1.6, stiffness: 28, damping: 2.8, yawWhip: 12, lag: 1.8 },
    countermeasure: "reactive_armor",
    sensorPalette: "full_spectrum",
  },
  // Dropship AGV pod — dirt-locked tank drive; same Heli path as other remotes.
  // Not hangar-selectable — remote roster owns lifecycle (`remoteSpecOf("agv")`).
  hound: {
    kind: "hound",
    name: "Hound",
    fullName: "HOUND AGV",
    role: "Ground Escort",
    playable: false,
    // Heading-locked tank drive (A/D yaw, W/S along nose — no slide).
    flightModel: "ground",
    controlScheme: "orbit",
    sizeM: 4.2,
    ammoScale: 0.85,
    health: 140,
    radius: 14,
    // Tall enough that roof-turret leave clears dirt ripples (was 8 → skim kills).
    height: 14,
    body: "craft_hound",
    hulk: "craft_hound",
    gunOverlayScale: 0.88,
    cameraScale: 0.78,
    flatHull: true,
    track: "tread",
    trackGap: 8,
    trackScale: 0.82,
    rotOff: Math.PI / 2,
    // Orbit yaw + forward thrust; dirt-hugger (pad AGL enforced by remote snap).
    forwardThrust: 300, reverseThrust: 220, strafeThrust: 0, maxSpeed: 130, maxReverseSpeed: 70, minSpeed: 0, yawRate: 2.4, yawAccel: 12, drag: 1.85,
    verticalThrust: 200, cruiseThrust: 40, cruiseAgl: 3.5, maxAgl: 14,
    sockets: [
      {
        id: "turret",
        class: "turret",
        controller: "pilot",
        weapon: "minigun",
        points: [{ id: "main" }],
        traverse: 360,
        gunTex: "gun_minigun",
        gunScale: 0.88,
        gunLayer: "above",
      },
      {
        id: "missile_rack",
        class: "hardpoint",
        controller: "pilot",
        weapon: "photon_missile",
        ammoMul: 4 / 12,
      },
      {
        id: "howitzer_spot",
        class: "turret",
        controller: "pilot",
        weapon: "remote_howitzer",
      },
      {
        id: "strike_observer",
        class: "turret",
        controller: "pilot",
        weapon: "artillery_strike",
      },
    ],
    countermeasure: "smoke_screen",
  },
  vtol_dropship: {
    kind: "vtol_dropship",
    name: "Marauder",
    fullName: "UD-92 Marauder",
    role: "Heavy Dropship",
    flightModel: "vtol",
    sizeM: 16,
    ammoScale: 1.5,
    health: 400,
    radius: 40,
    height: 16,
    body: "craft_vtol_dropship_v2",
    hulk: "craft_vtol_dropship_v2_hulk",
    rotor: "craft_osprey_rotor",
    rotorHulk: "craft_osprey_rotor_hulk",
    rotorScale: 0.52,
    rotorInertia: 1.35,
    // Heavy hauler stays upright — no strafe bank lean.
    flatHull: true,
    rotOff: Math.PI / 2,
    // Tough hauler: Chinook-class armor feel, sluggish turn / strafe — lumbering escort pace.
    // Reverse is weak — big VTOL backs up carefully.
    forwardThrust: 360, reverseThrust: 180, strafeThrust: 160, maxSpeed: 150, maxReverseSpeed: 70, minSpeed: 0, yawRate: 0.85, yawAccel: 3.6, drag: 1.9,
    verticalThrust: 380, cruiseThrust: 36, cruiseAgl: 70, maxAgl: 180,
    liftClass: "heavy",
    exhaustProfile: {
      rate: 20, speed: 92, tint: 0xa8c4d8, smoke: 0x5a6570, sx: 0.88, sy: 0.26, life: 1050, flame: 0.42, gap: 11, flameHue: 172,
    },
    sockets: [
      {
        id: "chin_gun",
        class: "turret",
        controller: "automatic",
        weapon: "chain_gun",
        points: [{ id: "chin" }],
        traverse: 240,
        muzzleFire: "simultaneous",
        gunTex: "gun_dual_chain",
        gunScale: 0.5,
        crew: "belly",
      },
      {
        id: "miniguns",
        class: "turret",
        controller: "automatic",
        weapon: "minigun",
        // One HUD slot; AI aims each barrel independently.
        points: [
          { id: "side_l", heading: -70, layer: "below" },
          { id: "side_r", heading: 70, layer: "below" },
          { id: "dorsal", layer: "above" },
        ],
        traverse: 240,
        muzzleFire: "simultaneous",
        gunScale: 0.5,
        crew: "door",
      },
      {
        id: "howitzer_turret",
        class: "turret",
        controller: "automatic",
        weapon: "heavy_artillery",
        points: [{ id: "howitzer" }],
        traverse: 200,
        gunLayer: "above",
        recoil: true,
      },
      {
        id: "starstreak_racks",
        class: "hardpoint",
        controller: "pilot",
        weapon: "swarm_missile",
        points: [
          { id: "wing_l0" },
          { id: "wing_r0" },
          { id: "wing_l1" },
          { id: "wing_r1" },
        ],
      },
      { id: "cargo_bay", class: "hardpoint", controller: "pilot", weapon: "agv_drop", points: [{ id: "ramp" }] },
    ],
    countermeasure: "smoke_screen",
  },
} satisfies Record<string, CraftSpec>;

/** Playable craft identity — literal union of CRAFTS keys. */
export type CraftKind = keyof typeof CRAFTS_DEFS;

/** Homogeneous catalog (keys stay literal via CraftKind). */
export const CRAFTS: Record<CraftKind, CraftSpec> = CRAFTS_DEFS;

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
export function craftOf(kind: CraftKind = selected): CraftSpec & { kind: CraftKind } {
  return CRAFTS[kind] as CraftSpec & { kind: CraftKind };
}

/** Player hull-steer scheme (orthogonal to flightModel). */
export function craftControlScheme(c: CraftSpec | CraftKind): ControlScheme {
  const spec = typeof c === "string" ? craftOf(c) : c;
  return spec.controlScheme ?? "aim";
}

/** Hull noses toward the reticle (helis / jets). Orbit scheme is false — keys yaw, mouse aims. */
export function craftNoseFollowsAim(c: CraftSpec = craftOf()): boolean {
  return craftControlScheme(c) !== "orbit";
}

/**
 * Altitude cloud look from cruise AGL (all craft).
 * Higher cruise → smaller / more distant parallax on screen.
 * sizeMul is world scale compensated by craftCameraScale so zoom-out
 * (orbit gunship) doesn't double-shrink clouds vs helis.
 */
export function craftCloudParallax(c: CraftSpec | CraftKind): {
  sizeMul: number;
  alphaMul: number;
  /** 0 = distant sky banks (low scroll), 1 = near-field (scroll toward 1). */
  nearness: number;
} {
  const spec = typeof c === "string" ? craftOf(c) : c;
  const cruise = spec.cruiseAgl;
  // ~heli 40 → gunship 320
  const t = clamp((cruise - 40) / 280, 0, 1);
  // Screen-relative size: heli a bit larger than gunship, not 2×+.
  const screenMul = 0.48 - t * (0.48 - 0.38);
  return {
    sizeMul: screenMul / craftCameraScale(spec),
    alphaMul: 0.82 + t * 0.18,
    nearness: 1 - t,
  };
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

export function allCrafts(): Array<CraftSpec & { kind: CraftKind }> {
  return allCraftKinds().map((k) => craftOf(k));
}

/** Hangar / mission-select craft — excludes remote-only hulls (`playable: false`). */
export function allCraftKinds(): CraftKind[] {
  return (Object.keys(CRAFTS) as CraftKind[]).filter((k) => CRAFTS[k]!.playable !== false);
}

/** Every CRAFTS key including remote-only hulls (bake / craftOf / Heli). */
export function allCraftHullKinds(): CraftKind[] {
  return Object.keys(CRAFTS) as CraftKind[];
}

/** Real-world plan-view scale relative to the Apache. */
export function craftSizeScale(c: CraftSpec = craftOf()): number {
  return c.sizeM / APACHE_SIZE_M;
}

/** Softer inverse framing adjustment: large craft zoom out, small craft zoom in. */
export function craftCameraScale(c: CraftSpec = craftOf()): number {
  const size = Math.max(0.62, Math.min(1.24, 1 / Math.sqrt(craftSizeScale(c))));
  return size * (c.cameraScale ?? 1);
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

/** Catalog fire cooldown scaled by this socket's `fireRateMul` (higher mul = shorter CD). */
export function craftSocketFireCd(
  baseFireCd: number,
  c: CraftSpec,
  socketIndex: number
): number {
  const mul = c.sockets[socketIndex]?.fireRateMul ?? 1;
  return baseFireCd / Math.max(0.05, mul);
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
 * Along-fuselage scale for rotor/prop discs (local Y after hull heading).
 * Forward-facing props (gunship wings, biplane nose) foreshorten so they read
 * as tilted discs, not top-down pads.
 */
export function craftRotorAlongScale(c: CraftSpec | CraftKind = craftOf()): number {
  const spec = typeof c === "string" ? craftOf(c) : c;
  if (craftControlScheme(spec) === "orbit") return 0.34;
  if (spec.flightModel === "plane" && spec.rotor) return 0.34;
  return 1;
}

/** True when rotor overlays are angled prop discs (not top-down lift rotors). */
export function craftRotorIsProp(c: CraftSpec | CraftKind = craftOf()): boolean {
  return craftRotorAlongScale(c) < 0.999;
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
  const sock = c.sockets.find(
    (s) => (s.class === "turret") && !!(s.gunTex || weaponMountTex(s.weapon))
  );
  return sock ? sock.gunTex ?? weaponMountTex(sock.weapon) : undefined;
}

/** Socket indices that own a visible gun overlay (matches `craftComposite(...).guns` order).
 * Multi-barrel turret sockets repeat their slot index once per barrel.
 * Fixed / hardpoint stations never contribute — hull-baked muzzles have no overlay. */
export function craftGunSocketSlots(c: CraftSpec = craftOf()): number[] {
  const out: number[] = [];
  for (let i = 0; i < c.sockets.length; i++) {
    const s = c.sockets[i]!;
    if ((s.class === "turret") && (s.gunTex || weaponMountTex(s.weapon))) {
      const n = craftSocketBarrelCount(c, i);
      for (let b = 0; b < n; b++) out.push(i);
    }
  }
  return out;
}

/**
 * Overlay barrel count for a turret socket with mount art.
 * Omit `points` → every `role: "gun"` UV (shared across turrets is fine).
 */
export function craftSocketBarrelCount(c: CraftSpec, socketIndex: number): number {
  const socket = c.sockets[socketIndex];
  if (!socket) return 1;
  if (socket.class !== "turret" || !(socket.gunTex || weaponMountTex(socket.weapon))) return 1;
  return craftSocketGunPoints(c, socketIndex).length;
}

/**
 * Resolved body gun UVs for a socket (overlay / fire order).
 * - `points` listed → those gun ids in list order.
 * - Else → all `role: "gun"` points (multiple turrets may share them).
 */
export function craftSocketGunPoints(
  c: CraftSpec,
  socketIndex: number
): { x: number; y: number; id?: string }[] {
  const socket = c.sockets[socketIndex];
  if (!socket || socket.class !== "turret" || !(socket.gunTex || weaponMountTex(socket.weapon))) return [];
  if (socket.points?.length) {
    return resolveSocketPointIds(c, socket, "gun");
  }
  return lookupSpritePoints(c.body, "gun").map((p) => ({ x: p.x, y: p.y, id: p.id }));
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
 * `points[barrel].heading` → socket `heading` → 0.
 */
export function craftGunPreferDegrees(c: CraftSpec, slot: number, barrel = 0): number {
  const socket = c.sockets[slot];
  if (!socket) return 0;
  return socket.points?.[barrel]?.heading ?? socket.heading ?? 0;
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
    guns: gunSlots.map((slot, i) => {
      const sock = c.sockets[slot]!;
      const tex = sock.gunTex ?? weaponMountTex(sock.weapon)!;
      const barrel = barrelOf.get(slot) ?? 0;
      barrelOf.set(slot, barrel + 1);
      // Barrel-up gun art: Phaser rot = prefer offset (nose → 0).
      const heading = craftGunPreferOffset(c, slot, barrel);
      return {
        kind: "gun" as const,
        tex,
        origin: lookupSpriteOrigin(tex) ?? craftGunOrigin(c),
        mount: gunMounts[i] ?? gunMounts[0] ?? craftOrigin(c),
        layer: (sock.points?.[barrel]?.layer ?? sock.gunLayer ?? "below") as "below" | "above",
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

/** Exhaust glow display scale — compact wash at the nozzle base. */
export function craftPreviewExhaustScale(bodyScale: number): { x: number; y: number } {
  const s = bodyScale * 0.42;
  return { x: s, y: s * 0.85 };
}

/** Per-craft exhaust glow tint for UI previews. */
export function craftPreviewExhaustTint(kind: CraftKind | string): number {
  if (typeof kind === "string" && kind in CRAFTS) {
    return CRAFTS[kind as CraftKind].exhaustProfile?.tint ?? 0x70d8ff;
  }
  return 0x70d8ff;
}

/**
 * Hue rotation (degrees) from the authored warm exhaust/flame art toward each
 * craft's look. 0 keeps the source orange grading intact.
 * Nozzle Images use runtime ColorMatrix; trail particles use pre-baked sheets
 * (`craftExhaustFlameSheet`) because ParticleEmitter has no preFX.
 */
export function craftExhaustFlameHue(kind: CraftKind | string): number {
  if (typeof kind === "string" && kind in CRAFTS) {
    return CRAFTS[kind as CraftKind].exhaustProfile?.flameHue ?? 172;
  }
  return 172;
}

/** Non-zero trail flame hues that must exist as `fx_flame_hue_<n>` sheets. */
export const EXHAUST_TRAIL_FLAME_HUES: readonly number[] = [172, 185, 248];

/** Particle texture for craft exhaust trails (graded flame, hue pre-baked). */
export function craftExhaustFlameSheet(kind: CraftKind | string): string {
  const hue = craftExhaustFlameHue(kind);
  if (hue === 0) return "fx_flame";
  // Only EXHAUST_TRAIL_FLAME_HUES are baked — missing keys show as green boxes.
  if ((EXHAUST_TRAIL_FLAME_HUES as readonly number[]).includes(hue)) {
    return `fx_flame_hue_${hue}`;
  }
  return "fx_flame";
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

/** Body UV role derived from socket class: turret→gun, fixed→muzzle, hardpoint→hardpoint. */
function socketPointRole(socket: { class: string }): "gun" | "muzzle" | "hardpoint" {
  if (socket.class === "turret") return "gun";
  if (socket.class === "fixed") return "muzzle";
  return "hardpoint";
}

/** Resolve `socket.points` ids against body UVs of the given role (throws on miss). */
function resolveSocketPointIds(
  c: CraftSpec,
  socket: CraftSocket,
  role: "gun" | "muzzle" | "hardpoint"
): { x: number; y: number; id?: string }[] {
  const refs = socket.points;
  if (!refs?.length) return [];
  const byId = new Map<string, { x: number; y: number; id?: string }>();
  for (const p of lookupSpritePoints(c.body, role)) {
    if (p.id) byId.set(p.id, { x: p.x, y: p.y, id: p.id });
  }
  return refs.map((ref) => {
    const p = byId.get(ref.id);
    if (!p) {
      throw new Error(`${c.kind} socket "${socket.id}": no ${role} point id "${ref.id}"`);
    }
    return p;
  });
}

/**
 * Soft socket UV resolve on any texture key (host body or remote `look` override).
 * Missing point ids fall through to role / gun↔muzzle / hardpoint fallbacks.
 */
export function socketPointsOnKey(
  key: string,
  socket: { class: string; points?: { id: string }[] }
): { x: number; y: number; id?: string }[] {
  const role = socketPointRole(socket);
  if (socket.points?.length) {
    const byId = new Map<string, { x: number; y: number; id?: string }>();
    for (const p of lookupSpritePoints(key, role)) {
      if (p.id) byId.set(p.id, { x: p.x, y: p.y, id: p.id });
    }
    const resolved = socket.points
      .map((ref) => byId.get(ref.id))
      .filter((p): p is { x: number; y: number; id?: string } => !!p);
    if (resolved.length) return resolved;
  }
  const primary = lookupSpritePoints(key, role);
  if (primary.length) return primary.map((p) => ({ x: p.x, y: p.y, id: p.id }));
  if (role === "muzzle") {
    const gun = lookupSpritePoints(key, "gun");
    if (gun.length) return gun.map((p) => ({ x: p.x, y: p.y, id: p.id }));
  }
  if (role === "gun") {
    const muzzle = lookupSpritePoints(key, "muzzle");
    if (muzzle.length) return muzzle.map((p) => ({ x: p.x, y: p.y, id: p.id }));
  }
  return lookupSpritePoints(key, "hardpoint").map((p) => ({ x: p.x, y: p.y, id: p.id }));
}

/**
 * Emit / attach UVs for a socket on the craft body texture.
 * Optional `points` partitions ids within class→role (strict — throws on miss);
 * omit → all of role (+ gun↔muzzle / hardpoint fallbacks when empty).
 */
export function craftSocketPoints(
  c: CraftSpec,
  socket: CraftSocket
): { x: number; y: number; id?: string }[] {
  const role = socketPointRole(socket);
  if (socket.points?.length) {
    return resolveSocketPointIds(c, socket, role);
  }
  return socketPointsOnKey(c.body, socket);
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
export function craftSocketWeapons(c: CraftSpec = craftOf()): WpnId[] {
  return c.sockets.map((s) => s.weapon);
}

/**
 * How many barrels / installs a socket represents for loadout UI.
 * Simultaneous multi-muzzle (fixed body tips or turret gun-tex tips) count;
 * alternate tips are one weapon (they cycle, not fire as a pair).
 */
export function craftSocketMultiplicity(c: CraftSpec, socketIndex: number): number {
  const socket = c.sockets[socketIndex];
  if (!socket) return 1;
  if (socket.class === "fixed") {
    const pts = craftSocketPoints(c, socket);
    if (pts.length > 1 && socket.muzzleFire === "simultaneous") {
      return pts.length;
    }
    return 1;
  }
  if (socket.class === "turret") {
    const mounts = craftSocketBarrelCount(c, socketIndex);
    if (socket.muzzleFire === "simultaneous") {
      const tex = socket.gunTex ?? weaponMountTex(socket.weapon);
      const tips = tex ? lookupSpriteMuzzles(tex).length : 1;
      if (tips > 1) return mounts * tips;
    }
    return mounts;
  }
  return 1;
}

/**
 * How many concurrent fire streams a socket contributes to sustained DPS.
 * Simultaneous multi-muzzle and automatic multi-barrel turrets count fully;
 * alternate muzzles are one stream (tips cycle, same cadence).
 */
export function craftSocketFireStreams(c: CraftSpec, socketIndex: number): number {
  const socket = c.sockets[socketIndex];
  if (!socket) return 1;
  if (socket.class === "fixed") {
    const pts = craftSocketPoints(c, socket);
    if (pts.length > 1 && socket.muzzleFire === "simultaneous") return pts.length;
    return 1;
  }
  if (socket.class === "turret") {
    const mounts = Math.max(1, craftSocketBarrelCount(c, socketIndex));
    if (socket.muzzleFire === "simultaneous") {
      const tex = socket.gunTex ?? weaponMountTex(socket.weapon);
      const tips = tex ? lookupSpriteMuzzles(tex).length : 1;
      if (tips > 1) return mounts * tips;
    }
    if (socket.controller === "automatic") return mounts;
    return 1;
  }
  return 1;
}

/** Gun stations (chin / fixed / crew) vs hardpoint ordnance. */
export function craftSocketIsPrimary(socket: CraftSocket): boolean {
  return socket.class === "turret" || socket.class === "fixed";
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

/** Wingtip UVs for bank contrails (jets). */
export function craftWingTipMounts(c: CraftSpec = craftOf()): { x: number; y: number; id?: string }[] {
  return lookupSpritePoints(c.body, "wingtip");
}

/** Pivot for a craft texture (body origin or gun origin). */
export function craftPivot(key: string): { x: number; y: number } | undefined {
  const k = key.replace(/__(woodland|desert|urban|snow|digital)$/, "");
  for (const c of allCrafts()) {
    if (c.body === k || c.hulk === k) return craftOrigin(c);
  }
  return undefined;
}

/** Tagged hull mounts for a craft — from SPRITE_SPECS body points (ids preserved). */
export function craftMountsOf(sp: CraftSpec): HullMount[] {
  const roles: HullMountRole[] = ["gun", "rotor", "hardpoint", "exhaust", "wingtip"];
  const tagged: HullMount[] = [];
  for (const role of roles) {
    for (const p of lookupSpritePoints(sp.body, role)) {
      tagged.push({
        x: p.x,
        y: p.y,
        role,
        label: spritePointLabel(p),
        id: p.id,
      });
    }
  }
  return tagged;
}
