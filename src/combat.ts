import { specOf, type DebrisCat, type ShotLook, type UnitKind, type PartMount } from "./roster";
import type { SocketClass } from "./craft";
import type { CamoKind } from "./camo";
import type { RemoteKind } from "./remote";

export type { DebrisCat, UnitKind } from "./roster";

/** Tip-biased UV origin for all projectile art (nose-along-+X). */
export const SHOT_ORIGIN = { x: 0.84, y: 0.5 } as const;

/** Exhaust / trail emit UV (rear of projectile art, nose-along-+X). */
export const SHOT_TAIL = { x: 0.06, y: 0.5 } as const;

/** Shared ordnance projectile keys under public/sprites/shots/. */
const ORD = {
  rocket: "shot_rocket",
  laserGuided: "shot_laser_guided",
  guided: "shot_guided",
  missile: "shot_missile",
  aa: "shot_aam",
  miniRocket: "shot_mini_rocket",
  bomb: "shot_bomb",
  wingedBomb: "shot_winged_bomb",
  canister: "shot_canister",
  photon: "shot_photon",
  artilleryShell: "shot_artillery_shell",
} as const;

function ordLook(key: keyof typeof ORD): ShotLook {
  return ORD[key];
}

/** Runtime-baked cannon tracer keys (procedural; not authored PNGs). */
function cannonLook(id: string): ShotLook {
  return `shot_cannon_${id}`;
}

export type LockCategory = "air" | "ground" | "vehicle";

export type LockAcquire =
  /** Nearest-ish unit under the aim point within lockRadius (size-biased). */
  | {
      policy: "reticle";
      /** Omit = any unit. Maverick AG: ground + vehicle only. */
      categories?: readonly LockCategory[];
    }
  /** Prefer hotter signature classes inside a nose cone. */
  | {
      policy: "signature";
      categories: readonly LockCategory[];
      minHealth: number;
      /** Max angle from craft heading (radians) that can soft-lock. */
      maxOffBoresight: number;
      /** Tighter cone for vehicle-class heat (omit = use maxOffBoresight). */
      vehicleMaxOffBoresight?: number;
    };

/** Alias — same acquire policies under the retired naming. */
export type WeaponAcquire = LockAcquire;

export type WeaponArt = {
  look: ShotLook;
  scale: number;
  mount?: string;
  tracer?: CannonTracerBake;
  tint?: number;
  face: "heading" | "velocity";
};

export type ExhaustTrail =
  | {
      kind: "particles";
      fire?: "burn" | "hotFlame";
      /**
       * Emit fire only for this many seconds after launch (motor flash),
       * then continue with smoke alone. Omit = fire for the whole flight.
       */
      fireFor?: number;
      smoke?: "linger" | "short" | "rocket";
      /** Thin pale stretched smoke like jet wingtip contrails (JDAM). */
      contrail?: boolean;
      align?: "heading";
      size?: number;
      /**
       * Particle scale for motor fire only. Omit = use `size` (same as smoke).
       * Coast rockets use a smaller fireSize so the plume stays dense without
       * bloating the long smoke.
       */
      fireSize?: number;
      /** Multiplier on trail particle emit rate (bombs use sparse <1). */
      density?: number;
      /** Override trail emit UV (default SHOT_TAIL). */
      emitUv?: { x: number; y: number };
    }
  | {
      kind: "energy";
      ribbons?: number;
      hue?: "cyan" | "green" | "magenta";
      warpMotes?: boolean | { density?: number };
    }
  /** Signal-flare pellet: pink/red flame-smoke loft + fast red sparks. */
  | {
      kind: "signalFlare";
      size?: number;
      density?: number;
    };

export type WeaponCam = {
  reticle: "round" | "square";
  look: { pull: number; max: number; rate: number };
  povCam?: boolean;
  thermal?: boolean;
  /** When false, skip plane look-ahead mul (Sidewinder). Omit = apply mul. */
  planeLookMul?: false;
  lockHud?: { seeking: string; locked: string; color: number; textColor: string };
  /**
   * Laser aim mode. Default boresight (project mouse along gun/nose).
   * `mouse` = free aim at the reticle from socket mounts (spiders, laser/command AG).
   */
  sight?: "mouse" | "boresight";
};

export type HeDetonate = {
  look: "fire" | "energy" | "photonic";
  dustMul?: number;
  /** Drop-bomb style toon blast + big-boom sparks/debris (MOAB / arty shells). */
  bigBoom?: boolean;
};

export type WeaponPayload = {
  penetration?: number;
  dustMul?: number;
  detonate?: HeDetonate;
  he?: { every?: number; blend?: number };
  stun?: number;
  cluster?: {
    bomblets: number;
    spread: number;
    bombletDmg: number;
    bombletBlast: number;
    /** Projectile art for each bomblet (e.g. shot_mini_rocket). */
    look: ShotLook;
    break?: "spray" | "cone_hop";
    /**
     * Mid-air open after this fraction of predicted flight time to impact
     * (same ballistic estimate as the drop path preview). Omit = open on impact.
     */
    openAt?: number;
    bombletDetonate?: HeDetonate;
  };
  smoke?: { duration: number; radius: number };
  remote?: { kind: RemoteKind; duration: number };
  /**
   * Ground skimmer: steer to mouse; when an enemy enters engageRange, latch and
   * dash onto them (spider drones).
   */
  spider?: {
    engageRange: number;
    /** Dash top speed as × cruise (default 1.5). */
    dashMul?: number;
    /** Horizontal accel toward dash top speed (world u/s²; default 380). */
    dashAccel?: number;
  };
  warp?: { timeScale: number };
  helix?: { strands: number };
  split?: { at: number; count: number };
  bounce?: { maxBounces: number };
  /**
   * Mark-then-call: marker settles, then off-map shells rain onto the mark
   * with XY jitter. Reusable across any craft socket.
   */
  callStrike?: {
    /** Seconds after marker rest before the first shell. Omit / 0 = fire immediately. */
    delay?: number;
    rounds: number;
    /** Seconds between shells. */
    interval: number;
    /** Uniform disk radius around the mark (world units). */
    jitter: number;
    shellDmg: number;
    shellBlast: number;
    /** Inbound shell projectile art. */
    shellLook: ShotLook;
    /** Constant inbound speed of each shell (world u/s). */
    shellSpeed?: number;
    /** Keep flare FX until this many shells have impacted (default 3). */
    flareUntilHits?: number;
  };
  /**
   * POV remote spot — one click fires `weapon` from the host craft mount
   * (e.g. HOUND calling the dropship howitzer onto aim).
   */
  hostFire?: { weapon: string };
};

export type WeaponFire = {
  muzzleFlash: boolean;
  jitter: number;
  salvo?: { count: number; interval: number; spread?: number };
};

export type WeaponControl =
  | { mode: "hold_mouse_down" }
  | { mode: "click" }
  | { mode: "lock_then_click" }
  | { mode: "click_then_click_to_commit" }
  | { mode: "click_to_set_target" };

export type WeaponTargeting =
  | { mode: "steer" }
  | {
      mode: "steer_commit";
      lockTime: number;
      lockRadius: number;
      breakLockRadius?: number;
    }
  | {
      mode: "lock_on";
      lockTime: number;
      lockRadius: number;
      seekDelay: number;
      acquire: LockAcquire;
      proxTurn?: { far: number; near: number; nearDist: number };
      proxFuse?: { xy: number; z?: number };
    }
  | { mode: "waypoint" };

export type WeaponFlight = {
  turnRate: number;
  maxAngle?: number;
  /** When steer_commit terminal engages, use this instead of turnRate (Spike 6.5, Warp 48). */
  commitTurnRate?: number;
  loft?: {
    cruise: "player" | "player_descend" | { agl: number };
    dive: { range: number; power: number; inner?: number };
    clear?: { coast?: number; far?: number; near?: number };
  };
};

export type WeaponGuidance = {
  targeting: WeaponTargeting;
  flight: WeaponFlight;
  wire?: boolean;
};

export interface WeaponGravity {
  acceleration: number;
  terminalVelocity?: number;
}

export type WeaponLaunch =
  | {
      mode: "muzzle";
      inheritMomentum: number;
      /** Accel toward `speed` after leave (AA rail / Hydra boost). */
      acceleration?: number;
      /**
       * With `acceleration`: burn duration then coast. Omit = keep thrusting
       * (AA rail). Dumbfire rockets set this for motor flash → coast.
       */
      burnTime?: number;
      /** Leave speed when `acceleration` is set (default 10 for rails). */
      leaveSpeed?: number;
      gravity?: WeaponGravity;
    }
  | {
      mode: "kick_motor"; // Tube-launched missile: kick, coast, ignite, burn.
      kickSpeed: number;
      igniteDelay: number;
      acceleration: number;
      burnTime: number;
      inheritMomentum: number;
      yawMul?: number;
      softLoft?: number;
      leaveVz?: number;
      pitch?: number;
      loftCap?: number;
    }
  | { mode: "drop"; inheritMomentum: 1; gravity: WeaponGravity }
  | { mode: "beam"; range: number; delivery: "ray" | "arc" };

/** Player loadout — shared by fire logic and the combat rig. */
export interface PlayerWpnSpec {
  /** Loadout identity (must match the PLAYER_WPNS key). */
  id: string;
  /** Short HUD nickname. */
  name: string;
  /** Display name: nickname + ordnance class (loadout / help). */
  fullName: string;
  /** Full technical / catalog designation (codes, caliber). Unused in-game for now. */
  designation: string;
  ammo: number;
  fireCd: number;
  /** Launch / ballistic speed (powered missiles may kick, then ignite their motor). */
  speed: number;
  dmg: number;
  blast: number;
  life: number;
  art: WeaponArt;
  exhaust?: ExhaustTrail;
  cam: WeaponCam;
  fire?: WeaponFire;
  control: WeaponControl;
  launch: WeaponLaunch;
  guidance?: WeaponGuidance;
  payload: WeaponPayload;
  /** Per-class damage multipliers (direct + splash). Missing keys default to 1. */
  dmgMul?: Partial<Record<UnitClass, number>>;
  /** Extra damage vs stunned / smoke-blinded targets. Omit = 1. */
  debuffDmgMul?: number;
  /** Socket classes this weapon may install into. */
  fits: SocketClass[];
  notes: string[];
}

/** Shared soft-launch motor ignite delay (kick_motor weapons). */
export const MISSILE_IGNITE = 0.525;
/** Default pre-fire lock dwell for lock_on weapons (seconds). */
export const LOCK_ON_LOCK_T = 0.5;
/** Default post-leave seek delay for lock_on weapons (seconds). */
export const LOCK_ON_SEEK_DELAY = 0.42;

const HOLD = { mode: "hold_mouse_down" as const };
const CLICK = { mode: "click" as const };
const HE_FIRE: WeaponPayload = { detonate: { look: "fire" } };
const GRAVITY: WeaponGravity = { acceleration: 210, terminalVelocity: 520 };
const MUZZLE: WeaponLaunch = { mode: "muzzle", inheritMomentum: 0.4 };
const DROP: WeaponLaunch = { mode: "drop", inheritMomentum: 1, gravity: GRAVITY };
const LOOK_LOCK = { pull: 0.58, max: 220, rate: 5.6 } as const;
const LOOK_ROCKET = { pull: 0.42, max: 160, rate: 7.4 } as const;
const LOOK_GUIDED = { pull: 0.55, max: 210, rate: 6.5 } as const;
const LOOK_GUN = { pull: 0.2, max: 88, rate: 10 } as const;
/** Lobbed howitzer — longer lead than Starstreak, short of a theater pull-out. */
const LOOK_ARTILLERY = { pull: 0.58, max: 260, rate: 5.2 } as const;
const DIVE_TOW = { range: 280, power: 2.85, inner: 45 } as const;
const DIVE_GRIFFIN = { range: 560, power: 1.25, inner: 90 } as const;
const DIVE_SPIKE = { range: 340, power: 2.05 } as const;
const CAM_LOCK: WeaponCam = { reticle: "square", look: LOOK_LOCK };
const CAM_ROCKET: WeaponCam = { reticle: "square", look: LOOK_ROCKET };
const CAM_GUIDED: WeaponCam = { reticle: "square", look: LOOK_GUIDED };
const CAM_GUN: WeaponCam = { reticle: "round", look: LOOK_GUN };
const CAM_ARTILLERY: WeaponCam = { reticle: "round", look: LOOK_ARTILLERY };
const CAM_DROP: WeaponCam = { reticle: "round", look: LOOK_GUIDED };
const FIRE_GUN: WeaponFire = { muzzleFlash: true, jitter: 0.08 };
const FIT_GUN: SocketClass[] = ["turret", "fixed"];
const FIT_HARDPOINT: SocketClass[] = ["hardpoint"];
/** M62 7.62 tracer — M240 and M134 are the same bullet. */
const TRACER_762: CannonTracerBake = {
  w: 44,
  h: 6,
  core: [255, 220, 170],
  mid: [255, 130, 45],
  rim: [190, 60, 22],
  glow: 0.36,
};
/** Shared mount-body keys under public/sprites/guns/. */
const MOUNT_GATLING = "gun_gatling";
const MOUNT_MINIGUN = "gun_minigun";
const MOUNT_MACHINE = "gun_machine";
const MOUNT_ARTILLERY = "gun_artillery";
const MOUNT_RAILGUN = "gun_railgun";
const MOUNT_PLASMA = "gun_plasma";
const MOUNT_TESLA = "gun_tesla";
const MOUNT_PILOT = "gun_pilot";

export type TracerRgb = [number, number, number];

/** Procedural cannon tracer shape authored on the weapon (bake.ts). */
export interface CannonTracerBake {
  w: number;
  h: number;
  core: TracerRgb;
  mid: TracerRgb;
  rim: TracerRgb;
  /** 0 = soft tear tracer, 1 = blunt slug. */
  blunt?: number;
  glow?: number;
  twin?: boolean;
  /** `tear` default. `bolt` = faceted rail dart. `orb` = elongated blob. */
  shape?: "tear" | "bolt" | "orb";
}

const RETICLE: LockAcquire = { policy: "reticle" };
/** AG reticle lock — vehicles / buildings, not air or troops. */
const RETICLE_AG: LockAcquire = { policy: "reticle", categories: ["vehicle"] };
const lockOn = (
  lockTime: number,
  lockRadius: number,
  acquire: LockAcquire = RETICLE,
  seekDelay = LOCK_ON_SEEK_DELAY
): Extract<WeaponTargeting, { mode: "lock_on" }> => ({
  mode: "lock_on",
  lockTime,
  lockRadius,
  seekDelay,
  acquire,
});
const signature = (
  categories: readonly LockCategory[],
  maxOffBoresight: number,
  minHealth = 1,
  vehicleMaxOffBoresight?: number
): LockAcquire => ({
  policy: "signature",
  categories,
  minHealth,
  maxOffBoresight,
  ...(vehicleMaxOffBoresight != null ? { vehicleMaxOffBoresight } : {}),
});
type KickMotor = Extract<WeaponLaunch, { mode: "kick_motor" }>;
const motor = (
  speed: number,
  acceleration: number,
  burnTime: number,
  inheritMomentum = 1,
  extra?: Omit<Partial<KickMotor>, "mode" | "kickSpeed" | "igniteDelay" | "acceleration" | "burnTime" | "inheritMomentum">
): KickMotor => ({
  mode: "kick_motor",
  kickSpeed: speed,
  igniteDelay: MISSILE_IGNITE,
  acceleration,
  burnTime,
  inheritMomentum,
  ...extra,
});
/** AA rail: craft heading, no craft inherit, near-zero leave, hard immediate accel. */
const railAccel = (acceleration: number): WeaponLaunch => ({
  mode: "muzzle",
  inheritMomentum: 0,
  acceleration,
});
/**
 * Dumbfire rocket: soft leave, motor burn accel to catalog speed, then coast.
 * `fireFor` on exhaust should match `burnTime` for the flame cue.
 */
const rocketBoost = (
  acceleration: number,
  burnTime: number,
  leaveSpeed = 100,
  inheritMomentum = 0.28
): WeaponLaunch => ({
  mode: "muzzle",
  inheritMomentum,
  acceleration,
  burnTime,
  leaveSpeed,
});
const gunArt = (
  id: string,
  scale: number,
  tracer: CannonTracerBake,
  mount?: string
): WeaponArt => ({
  look: cannonLook(id),
  scale,
  tracer,
  ...(mount ? { mount } : {}),
  face: "velocity",
});
const ordArt = (
  key: keyof typeof ORD,
  scale: number,
  face: "heading" | "velocity",
  extra?: Partial<Pick<WeaponArt, "tint" | "mount">>
): WeaponArt => ({
  look: ordLook(key),
  scale,
  face,
  ...extra,
});
const particleTrail = (
  size: number,
  opts: {
    fire?: "burn" | "hotFlame";
    fireFor?: number;
    fireSize?: number;
    smoke?: "linger" | "short" | "rocket";
    contrail?: boolean;
    align?: "heading";
    density?: number;
  } = {}
): ExhaustTrail => ({
  kind: "particles",
  size,
  ...opts,
});
const energyTrail = (
  opts: { ribbons?: number; hue?: "cyan" | "green" | "magenta"; warpMotes?: boolean } = {}
): ExhaustTrail => ({
  kind: "energy",
  ...opts,
});
const lockGuidance = (
  targeting: Extract<WeaponTargeting, { mode: "lock_on" }>,
  turnRate: number,
  loft?: WeaponFlight["loft"]
): WeaponGuidance => ({
  targeting,
  flight: loft ? { turnRate, loft } : { turnRate },
});
const steerGuidance = (
  turnRate: number,
  maxAngle: number,
  loft: WeaponFlight["loft"] | undefined,
  wire?: boolean
): WeaponGuidance => ({
  targeting: { mode: "steer" },
  flight: loft ? { turnRate, maxAngle, loft } : { turnRate, maxAngle },
  ...(wire != null ? { wire } : {}),
});
const commitGuidance = (
  lockTime: number,
  lockRadius: number,
  breakLockRadius: number,
  turnRate: number,
  commitTurnRate: number,
  loft: NonNullable<WeaponFlight["loft"]>
): WeaponGuidance => ({
  targeting: { mode: "steer_commit", lockTime, lockRadius, breakLockRadius },
  flight: { turnRate, commitTurnRate, loft },
  wire: false,
});

/** Canonical weapon identities; craft sockets supply installation policy + default loadout. */
const PLAYER_WPNS_DEFS = {
  chain_gun: {
    id: "chain_gun", name: "CHAIN GUN", fullName: "30MM CHAIN GUN", designation: "M230 30MM CHAIN GUN", ammo: 1200, fireCd: 0.096, speed: 580,
    dmg: 28, blast: 36, life: 0.22,
    art: gunArt("chain_gun", 0.56, { w: 44, h: 8, core: [255, 248, 220], mid: [255, 140, 40], rim: [200, 55, 18], blunt: 0.42, glow: 0.62 }, MOUNT_GATLING),
    cam: CAM_GUN, fire: FIRE_GUN, control: HOLD, launch: MUZZLE,
    payload: { penetration: 0.92 },
    fits: FIT_GUN, notes: ["30mm HEDP — watch the orbs walk on; slow vs 20mm / GAU-8"],
  },
  rocket: {
    id: "rocket", name: "HYDRA", fullName: "HYDRA ROCKET PODS", designation: "HYDRA 70 ROCKET PODS", ammo: 38, fireCd: 0.22, speed: 620,
    // Soft targets only: still one-shots pickup (70) / truck (84); ripple rate was overkill at 258.
    dmg: 115, blast: 150, life: 3.4,
    art: ordArt("rocket", 1, "velocity"),
    exhaust: particleTrail(0.72, {
      fire: "burn",
      fireFor: 0.42,
      fireSize: 0.36,
      density: 1.7,
      smoke: "rocket",
      align: "heading",
    }),
    cam: CAM_ROCKET, fire: FIRE_GUN, control: HOLD,
    launch: rocketBoost(1450, 0.42, 95),
    payload: HE_FIRE,
    fits: FIT_HARDPOINT, notes: ["unguided dumbfire — soft leave, motor burn, then coast"],
  },
  incendiary_rocket: {
    id: "incendiary_rocket", name: "INCENDIARY", fullName: "INCENDIARY ROCKETS", designation: "LE PRIEUR INCENDIARY ROCKETS",
    ammo: 28, fireCd: 0.28, speed: 460,
    dmg: 118, blast: 160, life: 2.9,
    art: ordArt("rocket", 0.92, "velocity"),
    exhaust: particleTrail(0.68, {
      fire: "burn",
      fireFor: 0.38,
      fireSize: 0.34,
      density: 1.55,
      smoke: "rocket",
      align: "heading",
    }),
    cam: CAM_ROCKET, fire: { muzzleFlash: true, jitter: 0.52 }, control: HOLD,
    launch: rocketBoost(1100, 0.38, 85),
    // Fat fireball damage radius, but a small ground scorch.
    payload: { detonate: { look: "fire" }, dustMul: 0.28 },
    fits: FIT_HARDPOINT,
    dmgMul: { troop: 1.65, vehicle: 0.32, building: 0.42, air: 1.1 },
    notes: ["Le Prieur-style — soft leave + short burn; fat fireball, wild spray"],
  },
  hellfire_missile: {
    id: "hellfire_missile", name: "HELLFIRE", fullName: "HELLFIRE MISSILE", designation: "AGM-114R HELLFIRE II", ammo: 8, fireCd: 0.55, speed: 380,
    dmg: 360, blast: 155, life: 4.9,
    art: ordArt("laserGuided", 1, "heading"),
    exhaust: particleTrail(0.55, { fire: "burn", smoke: "linger", density: 1.35 }),
    cam: { ...CAM_LOCK, sight: "mouse" }, control: { mode: "lock_then_click" },
    launch: motor(250, 500, 2.1, 1, { pitch: 1.15, loftCap: 0.3 }),
    guidance: lockGuidance(lockOn(0.5, 160, RETICLE, 0.28), 7.8),
    payload: HE_FIRE,
    fits: FIT_HARDPOINT,
    dmgMul: { vehicle: 1.25, building: 1.1, air: 0.55, troop: 0.7 },
    notes: ["laser lock; pop-up then 3D home — AT fantasy"],
  },
  tv_missile: {
    id: "tv_missile", name: "SPIKE", fullName: "SPIKE MISSILE", designation: "SPIKE NLOS COMMAND MISSILE", ammo: 6, fireCd: 1.15, speed: 290,
    dmg: 380, blast: 160, life: 30,
    art: ordArt("guided", 0.95, "heading"),
    exhaust: particleTrail(0.52, { fire: "burn", smoke: "linger", density: 1.35 }),
    cam: { reticle: "square", look: LOOK_GUIDED, povCam: true, thermal: true, sight: "mouse" },
    control: { mode: "click_then_click_to_commit" },
    launch: motor(215, 360, 2.4, 1, { softLoft: 0.22 }),
    guidance: commitGuidance(0.45, 60, 90, 2.4, 6.5, { cruise: "player", dive: DIVE_SPIKE }),
    payload: HE_FIRE,
    fits: FIT_HARDPOINT, notes: [
      "steer family with TOW — soft-lock + second-click commit instead of wire hold",
      "thermal seeker cam; linger holds thermal until camera returns",
      "AT fantasy — hard on vehicles / buildings",
    ],
    dmgMul: { vehicle: 1.25, building: 1.1, air: 0.55, troop: 0.7 },
  },
  minigun: {
    id: "minigun", name: "MINIGUN", fullName: "MINIGUN", designation: "M134 / GAU-17/A 7.62MM MINIGUN",
    ammo: 2600, fireCd: 0.03, speed: 1040, dmg: 5.8, blast: 9, life: 0.082,
    art: gunArt("minigun", 0.46, TRACER_762, MOUNT_MINIGUN),
    cam: CAM_GUN, fire: FIRE_GUN, control: HOLD, launch: MUZZLE, payload: {},
    fits: FIT_GUN,
    dmgMul: { troop: 1.6, vehicle: 0.55, building: 0.35, air: 0.7 },
    notes: ["same 7.62 as the M240 — shreds troops; soft vs armor"],
  },
  gatling: {
    id: "gatling", name: "GATLING", fullName: "20MM GATLING GUN", designation: "M197 20MM THREE-BARREL GATLING", ammo: 900, fireCd: 0.08, speed: 1200,
    dmg: 20, blast: 26, life: 0.11,
    art: gunArt("gatling", 0.66, { w: 66, h: 10, core: [255, 250, 210], mid: [255, 175, 55], rim: [230, 90, 25], blunt: 0.28, glow: 0.55 }, MOUNT_GATLING),
    cam: CAM_GUN, fire: FIRE_GUN, control: HOLD, launch: MUZZLE,
    payload: { penetration: 0.78 },
    fits: FIT_GUN, notes: ["20mm HE — flat snap, fastest heli gun"],
  },
  tow_missile: {
    id: "tow_missile", name: "TOW", fullName: "TOW MISSILE", designation: "BGM-71E TOW 2A MISSILE", ammo: 6, fireCd: 1.1, speed: 290,
    dmg: 350, blast: 145, life: 6.1,
    art: ordArt("guided", 1, "heading"),
    exhaust: particleTrail(0.52, { fire: "burn", smoke: "linger", density: 1.3 }),
    cam: { reticle: "square", look: LOOK_GUIDED, povCam: true, sight: "mouse" },
    control: HOLD,
    launch: motor(215, 360, 2.4, 1, { leaveVz: 120 }),
    guidance: steerGuidance(2.2, 0.75, { cruise: "player", dive: DIVE_TOW }, true),
    payload: HE_FIRE,
    fits: FIT_HARDPOINT,
    dmgMul: { vehicle: 1.25, building: 1.1, air: 0.55, troop: 0.7 },
    notes: ["continuous wire command; same steer family as SPIKE — AT fantasy"],
  },
  sidewinder_missile: {
    id: "sidewinder_missile", name: "SIDEWINDER", fullName: "SIDEWINDER MISSILE (AIR-TO-AIR)", designation: "AIM-9X SIDEWINDER", ammo: 12, fireCd: 0.28, speed: 980,
    dmg: 170, blast: 80, life: 3.6,
    art: ordArt("aa", 0.68, "heading"),
    exhaust: particleTrail(0.72, { fire: "hotFlame", smoke: "short" }),
    cam: {
      reticle: "square",
      look: LOOK_LOCK,
      planeLookMul: false,
      lockHud: { seeking: "HEAT", locked: "FOX-2", color: 0xff6622, textColor: "#ff8844" },
    },
    control: { mode: "lock_then_click" },
    launch: railAccel(970),
    guidance: lockGuidance(
      lockOn(0.14, 165, signature(["air", "vehicle"], 1.55, 1, 0.38), 0.12),
      3
    ),
    payload: HE_FIRE,
    fits: FIT_HARDPOINT,
    dmgMul: { air: 2.15, vehicle: 0.55, building: 0.35, troop: 0.4 },
    notes: ["WVR heat seeker — snap lock, air-class punch; soft vs armor / troops"],
  },
  machine_gun: {
    id: "machine_gun", name: "MACHINE GUN", fullName: "7.62MM MACHINE GUN", designation: "M240D 7.62MM MACHINE GUN", ammo: 3200, fireCd: 0.066, speed: 1040,
    dmg: 5.8, blast: 9, life: 0.075,
    art: gunArt("machine_gun", 0.46, TRACER_762, MOUNT_MACHINE),
    cam: CAM_GUN, fire: FIRE_GUN, control: HOLD, launch: MUZZLE, payload: {},
    fits: FIT_GUN,
    dmgMul: { troop: 1.6, vehicle: 0.55, building: 0.35, air: 0.7 },
    notes: ["crew or pilot M240; shreds troops — door/ramp/cabin role from the socket"],
  },
  heavy_bomb: {
    id: "heavy_bomb", name: "MOAB", fullName: "MASSIVE ORDNANCE AIR BLAST", designation: "GBU-43/B MASSIVE ORDNANCE AIR BLAST", ammo: 2, fireCd: 2.4, speed: 165,
    dmg: 980, blast: 280, life: 7.5,
    art: ordArt("bomb", 1.15, "velocity"),
    exhaust: particleTrail(0.52, { smoke: "short", density: 0.55 }),
    cam: CAM_DROP, control: CLICK, launch: DROP, payload: HE_FIRE,
    fits: FIT_HARDPOINT,
    dmgMul: { building: 1.35, vehicle: 1.15, troop: 0.9, air: 0.25 },
    notes: ["momentum-first drop; structure / armor fantasy"],
  },
  cluster_bomb: {
    id: "cluster_bomb", name: "ROCKEYE", fullName: "ROCKEYE CLUSTER BOMB", designation: "CBU-100 ROCKEYE II CLUSTER BOMB", ammo: 5, fireCd: 1.35, speed: 185,
    dmg: 12, blast: 28, life: 6.8,
    art: ordArt("canister", 1.65, "velocity"),
    exhaust: particleTrail(0.48, { smoke: "short", density: 0.5 }),
    cam: CAM_DROP, control: CLICK, launch: DROP,
    payload: {
      cluster: {
        bomblets: 18, spread: 175, bombletDmg: 82, bombletBlast: 95, break: "spray",
        look: ordLook("miniRocket"),
        openAt: 0.6,
      },
    },
    fits: FIT_HARDPOINT, notes: ["light mid-air canister pop ~60% down; damage is the bomblet carpet"],
  },
  guided_rockets: {
    id: "guided_rockets", name: "MICROS MISSILES", fullName: "DEFENSE MICRO-MISSILES", designation: "FORWARD DEFENSE MICRO-MISSILE POD", ammo: 80, fireCd: 0.24, speed: 420,
    dmg: 110, blast: 140, life: 4.1,
    art: ordArt("rocket", 0.5, "heading"),
    exhaust: particleTrail(0.32, { fire: "burn", fireFor: 0.1, smoke: "rocket", align: "heading" }),
    cam: CAM_ROCKET, fire: { muzzleFlash: true, jitter: 0.08, salvo: { count: 2, interval: 0.08, spread: 0.08 } },
    control: HOLD, launch: MUZZLE,
    guidance: steerGuidance(0.55, 0.16, undefined, false),
    payload: HE_FIRE,
    fits: FIT_HARDPOINT, notes: ["slightly steers toward reticle; muzzle arc into the ground; no pov cam"],
  },
  heavy_machine_gun: {
    id: "heavy_machine_gun", name: "HEAVY MACHINE GUN", fullName: ".50 CAL MACHINE GUN", designation: "M2HB .50 CAL MACHINE GUN", ammo: 900, fireCd: 0.105, speed: 860,
    dmg: 20, blast: 22, life: 0.13,
    art: gunArt("heavy_machine_gun", 0.68, { w: 62, h: 9, core: [255, 235, 190], mid: [255, 145, 50], rim: [210, 75, 28], blunt: 0.22, glow: 0.52 }, MOUNT_MACHINE),
    cam: CAM_GUN, fire: FIRE_GUN, control: HOLD, launch: MUZZLE,
    payload: { penetration: 0.70 },
    fits: FIT_GUN, notes: ["crew-served .50 — readable slugs you can walk onto a target"],
  },
  heavy_cal_pod: {
    id: "heavy_cal_pod", name: "HEAVY CAL POD", fullName: ".50 CAL GATLING POD", designation: "GAU-19/A .50 CAL GATLING POD", ammo: 300, fireCd: 0.072, speed: 860,
    dmg: 20, blast: 22, life: 0.13,
    art: gunArt("heavy_cal_pod", 0.68, { w: 62, h: 9, core: [255, 235, 190], mid: [255, 145, 50], rim: [210, 75, 28], blunt: 0.22, glow: 0.52 }),
    cam: CAM_GUN, fire: FIRE_GUN, control: HOLD, launch: MUZZLE,
    payload: { penetration: 0.70 },
    fits: ["hardpoint", "fixed"] as SocketClass[], notes: ["pylon .50 gatling — same slug as the HMG, short belt"],
  },
  concealed_cannon: {
    id: "concealed_cannon", name: "WHISPER", fullName: "20MM WHISPER CANNON", designation: "WPR-20 20MM WHISPER CANNON", ammo: 820, fireCd: 0.105, speed: 1080,
    dmg: 13.5, blast: 15, life: 0.1,
    art: gunArt("concealed_cannon", 0.6, { w: 52, h: 8, core: [220, 230, 240], mid: [140, 160, 180], rim: [70, 90, 110], glow: 0.22 }, MOUNT_MACHINE),
    cam: CAM_GUN, fire: { muzzleFlash: false, jitter: 0.025 }, control: HOLD, launch: MUZZLE,
    payload: { penetration: 0.5 },
    debuffDmgMul: 1.8,
    fits: FIT_GUN, notes: ["suppressed report and low muzzle flash", "bonus damage vs stunned or smoke-blinded targets"],
  },
  smoke_bomb: {
    id: "smoke_bomb", name: "SMOKE", fullName: "SMOKE BOMB", designation: "COMMAND-GUIDED SMOKE BOMB", ammo: 8, fireCd: 1.15, speed: 290,
    dmg: 24, blast: 195, life: 9,
    art: ordArt("canister", 0.88, "heading"),
    exhaust: particleTrail(0.4, { fire: "burn", smoke: "linger", density: 1.3 }),
    cam: { reticle: "square", look: LOOK_GUIDED, povCam: true, sight: "mouse" },
    control: CLICK,
    launch: motor(215, 360, 2.4, 1, { leaveVz: 120 }),
    guidance: steerGuidance(2.2, 0.75, { cruise: "player", dive: DIVE_TOW }, true),
    payload: { smoke: { duration: 22, radius: 130 } },
    fits: FIT_HARDPOINT, notes: ["TOW-family wire steer — dives into the reticle; stacked puffs cut awareness / fire range"],
  },
  stinger_missile: {
    id: "stinger_missile", name: "STINGER", fullName: "STINGER MISSILE", designation: "FIM-92 STINGER STEALTH POD", ammo: 10, fireCd: 0.5, speed: 475,
    dmg: 168, blast: 85, life: 4.7,
    art: ordArt("missile", 0.6, "heading"),
    exhaust: particleTrail(0.55, { fire: "burn", smoke: "linger", density: 1.3 }),
    cam: CAM_LOCK, control: { mode: "lock_then_click" },
    launch: motor(220, 550, 1.8, 1, { pitch: 0.92 }),
    guidance: lockGuidance(lockOn(0.38, 185, signature(["air", "ground", "vehicle"], 1.05)), 9.4),
    payload: HE_FIRE,
    fits: FIT_HARDPOINT,
    dmgMul: { air: 1.85, vehicle: 0.45, building: 0.3 },
    notes: ["low-signature heat seeker — air punch, soft AG"],
  },
  railgun: {
    id: "railgun", name: "RAILGUN", fullName: "RAILGUN", designation: "RG-40 HYPERVELOCITY RAILGUN", ammo: 180, fireCd: 0.4, speed: 1850,
    // Half the old cadence (0.2→0.4); dmg doubled so sustained DPS stays the same.
    dmg: 104, blast: 12, life: 0.16,
    art: gunArt("railgun", 0.82, { w: 128, h: 12, core: [255, 255, 255], mid: [120, 220, 255], rim: [40, 120, 255], glow: 1.05, shape: "bolt" }, MOUNT_RAILGUN),
    cam: CAM_GUN, fire: FIRE_GUN, control: HOLD, launch: MUZZLE,
    payload: { penetration: 1.4 },
    fits: FIT_GUN, notes: ["hypervelocity penetrator; deliberate automatic fire"],
  },
  swarm_missile: {
    id: "swarm_missile", name: "STARSTREAK", fullName: "STARSTREAK MISSILE", designation: "STARSTREAK HVM GUIDED DARTS", ammo: 92, fireCd: 0.095, speed: 920,
    dmg: 99, blast: 105, life: 4.2,
    art: ordArt("miniRocket", 0.4, "heading"),
    exhaust: energyTrail({ ribbons: 1, hue: "cyan" }),
    cam: CAM_ROCKET, fire: { muzzleFlash: true, jitter: 0.42 },
    control: HOLD, launch: MUZZLE,
    guidance: steerGuidance(0.62, 0.18, undefined),
    payload: {
      detonate: { look: "energy" },
      cluster: {
        bomblets: 3, spread: 64, bombletDmg: 14, bombletBlast: 26,
        look: ordLook("miniRocket"),
        break: "cone_hop",
        bombletDetonate: { look: "energy" },
      },
    },
    fits: FIT_HARDPOINT,
    notes: ["rapid jittered darts; neon ribbon; energy bomblets arc onto cone targets"],
  },
  attack_drone: {
    id: "attack_drone", name: "SPECTRE", fullName: "SPECTRE DRONE", designation: "SPECTRE REMOTE ATTACK DRONE", ammo: 3, fireCd: 3, speed: 280,
    dmg: 258, blast: 100, life: 45,
    art: ordArt("guided", 0.55, "velocity"),
    cam: { reticle: "square", look: LOOK_GUIDED, thermal: true },
    control: CLICK, launch: { mode: "muzzle", inheritMomentum: 0.85 },
    payload: { remote: { kind: "spectre", duration: 45 } },
    fits: FIT_HARDPOINT, notes: ["launches as a separate controllable craft", "Q / RMB drop camera without detonating", "select Spectre slot to return view", "click Spectre in its view to detonate"],
  },
  wingman_drone: {
    id: "wingman_drone", name: "SKIFF", fullName: "SKIFF WINGMAN", designation: "AUTONOMOUS WINGMAN SKIFF", ammo: 4, fireCd: 0.85, speed: 200,
    dmg: 40, blast: 48, life: 90,
    art: ordArt("guided", 0.5, "velocity"),
    cam: CAM_GUIDED, control: CLICK, launch: { mode: "muzzle", inheritMomentum: 0.7 },
    payload: { remote: { kind: "wingman", duration: 90 } },
    fits: FIT_HARDPOINT, notes: [
      "AI wingmen — launch several; LIVE ×N; Q recalls all to dock",
      "fixed nose guns: line up, fire, overshoot, turn for another pass",
      "shared awareness with airship / Raptor",
    ],
  },
  fighter_pod: {
    id: "fighter_pod", name: "RAPTOR", fullName: "RAPTOR FIGHTER", designation: "PILOTED FIGHTER POD", ammo: 2, fireCd: 4, speed: 260,
    dmg: 120, blast: 70, life: 75,
    art: ordArt("guided", 0.62, "velocity"),
    cam: { reticle: "square", look: LOOK_GUIDED },
    control: CLICK, launch: { mode: "muzzle", inheritMomentum: 0.8 },
    payload: { remote: { kind: "fighter", duration: 75 } },
    fits: FIT_HARDPOINT, notes: [
      "piloted force-forward fighter — own POV loadout HUD (guns, rockets, bomb)",
      "Q exits view (docks when near the Leviathan); AI escorts when unpiloted",
    ],
  },
  agv_drop: {
    id: "agv_drop", name: "HOUND", fullName: "HOUND AGV", designation: "AUTONOMOUS GROUND VEHICLE", ammo: 2, fireCd: 5, speed: 40,
    dmg: 180, blast: 90, life: 600,
    art: ordArt("guided", 0.7, "velocity"),
    cam: { reticle: "square", look: LOOK_GUN },
    control: CLICK, launch: DROP,
    payload: { remote: { kind: "agv", duration: 600 } },
    fits: FIT_HARDPOINT,
    notes: [
      "mini hover-tank with center minigun — select + hold fire in its POV",
      "A/D yaw, W/S thrust; deselect → tracks mouse, turret shoots on its own",
      "very long battery — detonates when empty",
    ],
  },
  spider_drone: {
    id: "spider_drone",
    name: "SPIDER DRONE",
    fullName: "SPIDER DRONE",
    designation: "ALTERNATING GROUND SEEKER DRONES",
    ammo: 10,
    fireCd: 1.15,
    speed: 240,
    dmg: 210,
    blast: 95,
    life: 18,
    art: { look: "enemy_drone", scale: 0.55, face: "heading" },
    cam: { ...CAM_GUIDED, sight: "mouse" },
    control: CLICK,
    launch: { mode: "muzzle", inheritMomentum: 0.15 },
    guidance: steerGuidance(6.2, 1.4, {
      cruise: { agl: 5 },
      dive: { range: 70, power: 1.1 },
      clear: { far: 6, near: 2.5, coast: 4 },
    }),
    payload: {
      ...HE_FIRE,
      spider: { engageRange: 88, dashMul: 1.5, dashAccel: 380 },
    },
    fits: FIT_GUN.concat("hardpoint" as SocketClass),
    notes: [
      "alternating ground skimmers from the hull ports",
      "crawl to the mouse; dash onto nearby hostiles and detonate",
    ],
  },
  plasma_cannon: {
    id: "plasma_cannon", name: "PLASMA HELIX", fullName: "PLASMA HELIX CANNON", designation: "PLASMA HELIX CANNON", ammo: 1800, fireCd: 0.2, speed: 1050,
    dmg: 42, blast: 52, life: 0.14,
    art: gunArt("plasma_cannon", 0.7, { w: 34, h: 22, core: [210, 255, 160], mid: [80, 255, 60], rim: [20, 160, 40], glow: 1.05, shape: "orb" }, MOUNT_PLASMA),
    exhaust: energyTrail({ hue: "green" }),
    cam: CAM_GUN, fire: { muzzleFlash: true, jitter: 0.08, salvo: { count: 3, interval: 0.01 } },
    control: HOLD, launch: MUZZLE,
    payload: { helix: { strands: 3 } },
    fits: FIT_GUN, notes: ["quick 3-round burst; phase-offset strands braid with depth"],
  },
  laser_rocket: {
    id: "laser_rocket", name: "REFRACTOR", fullName: "REFRACTOR BEAM", designation: "REFRACTOR ENERGY BEAM", ammo: 72, fireCd: 0.2, speed: 1,
    dmg: 210, blast: 88, life: 0.16,
    art: gunArt("plasma_cannon", 0.7, { w: 48, h: 10, core: [255, 220, 255], mid: [180, 90, 255], rim: [80, 40, 255], glow: 1.1, shape: "bolt" }, MOUNT_TESLA),
    cam: { reticle: "square", look: LOOK_GUN },
    fire: FIRE_GUN, control: HOLD,
    launch: { mode: "beam", range: 780, delivery: "ray" },
    payload: { split: { at: 0.3, count: 8 }, bounce: { maxBounces: 3 } },
    fits: FIT_GUN.concat("hardpoint" as SocketClass),
    notes: ["solid beam forks at 30% to reticle into a spray; ground hits shatter into random smaller beams"],
  },
  photon_missile: {
    id: "photon_missile", name: "PHOTON", fullName: "PHOTON MISSILE", designation: "PHOTON SEEKER MISSILE", ammo: 12, fireCd: 0.42, speed: 2100,
    dmg: 820, blast: 155, life: 5.5,
    art: ordArt("photon", 0.78, "heading"),
    exhaust: energyTrail({ ribbons: 3, hue: "cyan" }),
    cam: CAM_LOCK, control: { mode: "lock_then_click" },
    launch: motor(140, 4200, 0.55, 1, { pitch: 1.08 }),
    guidance: lockGuidance(
      {
        ...lockOn(0.22, 245, RETICLE, 0.28),
        proxTurn: { far: 12, near: 34, nearDist: 520 },
        proxFuse: { xy: 26, z: 36 },
      },
      18,
      {
        cruise: { agl: 420 },
        dive: { range: 780, power: 1.15 },
        clear: { coast: 120, far: 240, near: 22 },
      }
    ),
    payload: { detonate: { look: "photonic" } },
    fits: ["hardpoint", "fixed"] as SocketClass[],
    notes: ["wide loft fly-off then gradual high-altitude descent onto lock; Tesla-scale impact storm"],
  },
  warp_bomb: {
    id: "warp_bomb", name: "WARPWIRE BOMB", fullName: "WARPWIRE BOMB", designation: "WB-1 WARPWIRE BOMB", ammo: 4, fireCd: 1.25, speed: 340,
    dmg: 560, blast: 242, life: 30,
    art: ordArt("photon", 1.35, "heading", { tint: 0xc86cff }),
    exhaust: energyTrail({ ribbons: 3, hue: "magenta", warpMotes: true }),
    cam: { reticle: "square", look: LOOK_GUIDED, povCam: true, sight: "mouse" },
    control: { mode: "click_then_click_to_commit" },
    launch: {
      mode: "kick_motor",
      kickSpeed: 340,
      igniteDelay: 0,
      acceleration: 0,
      burnTime: 0.05,
      inheritMomentum: 0.35,
      yawMul: 0,
    },
    guidance: commitGuidance(0.45, 60, 90, 32, 48, { cruise: "player", dive: DIVE_SPIKE }),
    payload: { warp: { timeScale: 0.1 }, detonate: { look: "photonic" } },
    fits: FIT_HARDPOINT,
    notes: ["SPIKE-path warp bomb; magenta ribbons + energy orbs/sparks; world crawls while in flight"],
  },
  medium_gatling_cannon: {
    id: "medium_gatling_cannon", name: "EQUALIZER", fullName: "EQUALIZER GATLING GUN", designation: "25MM GAU-22/A EQUALIZER GATLING GUN", ammo: 500, fireCd: 0.042, speed: 1500,
    dmg: 22, blast: 28, life: 0.115,
    art: gunArt("medium_gatling_cannon", 0.78, { w: 118, h: 9, core: [255, 248, 215], mid: [255, 165, 48], rim: [220, 80, 22], blunt: 0.14, glow: 0.58 }, MOUNT_GATLING),
    cam: CAM_GUN, fire: FIRE_GUN, control: HOLD, launch: { mode: "muzzle", inheritMomentum: 1 },
    payload: { penetration: 0.95, he: { blend: 0.18 }, dustMul: 1.85 },
    fits: FIT_GUN, notes: ["jet 25mm SAPHEI — punchier kinetic + subtle HE; dusty impacts"],
  },
  light_gps_missile: {
    id: "light_gps_missile", name: "PYROS", fullName: "PYROS GPS MISSILE", designation: "PYROS LIGHT GPS GUIDED MISSILE", ammo: 24, fireCd: 0.38, speed: 460,
    dmg: 155, blast: 95, life: 4.8,
    art: ordArt("guided", 0.68, "heading"),
    exhaust: particleTrail(0.42, { fire: "burn", smoke: "linger", density: 1.3 }),
    cam: { ...CAM_GUIDED, sight: "mouse" }, control: { mode: "click_to_set_target" },
    launch: motor(180, 560, 2.0),
    guidance: { targeting: { mode: "waypoint" }, flight: { turnRate: 6.2 } },
    payload: HE_FIRE,
    fits: FIT_HARDPOINT, notes: ["light GPS AG missile — tube kick then burn; softer than JDAM"],
  },
  gps_bomb: {
    id: "gps_bomb", name: "JDAM", fullName: "JDAM GPS BOMB", designation: "GBU-31 JDAM GPS PRECISION-GUIDED BOMB", ammo: 8, fireCd: 0.95, speed: 205,
    dmg: 450, blast: 232, life: 7,
    art: ordArt("wingedBomb", 1.1, "heading"),
    exhaust: particleTrail(0.5, { smoke: "short", density: 0.48, contrail: true }),
    cam: CAM_DROP, control: { mode: "click_to_set_target" },
    launch: DROP,
    guidance: { targeting: { mode: "waypoint" }, flight: { turnRate: 3.15 } },
    payload: HE_FIRE,
    dmgMul: { building: 1.35, vehicle: 1.15, troop: 0.9, air: 0.25 },
    fits: FIT_HARDPOINT, notes: ["clicked GPS point; steers hard while falling — structure / armor"],
  },
  heavy_artillery: {
    id: "heavy_artillery", name: "HOWITZER", fullName: "HOWITZER ARTILLERY", designation: "105MM M102 HOWITZER ARTILLERY", ammo: 28, fireCd: 1.85, speed: 520,
    dmg: 420, blast: 210, life: 2.8,
    // Fatter than MG tracers, not a floating brick — call-strike shell trail behind.
    art: gunArt("heavy_artillery", 0.98, { w: 70, h: 11, core: [255, 250, 230], mid: [255, 170, 50], rim: [180, 70, 20], blunt: 0.72, glow: 0.42 }, MOUNT_ARTILLERY),
    exhaust: { ...particleTrail(0.55, { density: 0.85, contrail: true }), emitUv: { x: 0.08, y: 0.5 } },
    cam: CAM_ARTILLERY, fire: FIRE_GUN, control: CLICK,
    // Heavier g → higher muzzle loft for the same aim (more visible lob).
    launch: { mode: "muzzle", inheritMomentum: 0.4, gravity: { acceleration: 310, terminalVelocity: 980 } },
    payload: HE_FIRE,
    fits: FIT_GUN, notes: ["lobbed 105mm — Hellfire-class punch, wide HE splash"],
  },
  medium_cannon: {
    id: "medium_cannon", name: "BOFORS", fullName: "BOFORS CANNON", designation: "40MM BOFORS CANNON", ammo: 90, fireCd: 0.32, speed: 680,
    dmg: 85, blast: 95, life: 0.18,
    art: gunArt("medium_cannon", 1.05, { w: 76, h: 13, core: [255, 245, 210], mid: [255, 160, 45], rim: [200, 80, 18], blunt: 0.55, glow: 0.45 }, MOUNT_ARTILLERY),
    cam: CAM_GUN, fire: FIRE_GUN, control: HOLD, launch: MUZZLE, payload: HE_FIRE,
    fits: FIT_GUN, notes: ["medium-caliber explosive cannon"],
  },
  light_cannon: {
    id: "light_cannon", name: "SPOOKY", fullName: "SPOOKY GATLING GUN", designation: "25MM GAU-12/U SPOOKY GATLING CANNON", ammo: 3000, fireCd: 0.052, speed: 1160,
    dmg: 16.5, blast: 20, life: 0.115,
    art: gunArt("light_cannon", 0.76, { w: 114, h: 9, core: [255, 248, 215], mid: [255, 170, 52], rim: [225, 85, 24], blunt: 0.12, glow: 0.56 }, MOUNT_GATLING),
    cam: CAM_GUN, fire: FIRE_GUN, control: HOLD, launch: MUZZLE,
    payload: { penetration: 0.82 },
    fits: FIT_GUN, notes: ["gunship 25mm hose — GAU-12/U, not the F-35 Equalizer"],
  },
  gps_missile: {
    id: "gps_missile", name: "GRIFFIN", fullName: "GRIFFIN GUIDED MISSILE", designation: "AGM-176 GRIFFIN COMMAND-GUIDED MISSILE", ammo: 12, fireCd: 0.7, speed: 340,
    dmg: 240, blast: 110, life: 9.5,
    art: ordArt("guided", 0.84, "heading"),
    exhaust: particleTrail(0.52, { fire: "burn", smoke: "linger", density: 1.3 }),
    cam: { reticle: "square", look: LOOK_GUIDED, povCam: true, sight: "mouse" },
    control: HOLD,
    launch: motor(140, 260, 3.2),
    guidance: steerGuidance(4.1, 1.25, { cruise: "player_descend", dive: DIVE_GRIFFIN }, false),
    payload: HE_FIRE,
    dmgMul: { air: 1.9, vehicle: 0.7, building: 0.5 },
    fits: FIT_HARDPOINT,
    notes: ["command-guided; hold mouse to steer — slow loft, early dive onto ground / air"],
  },
  heavy_cannon: {
    id: "heavy_cannon", name: "AVENGER", fullName: "AVENGER GATLING GUN", designation: "30MM GAU-8/A AVENGER GATLING GUN", ammo: 1150, fireCd: 0.04, speed: 1580,
    dmg: 170, blast: 32, life: 0.125,
    art: gunArt("heavy_cannon", 0.88, { w: 132, h: 10, core: [255, 252, 230], mid: [255, 160, 45], rim: [210, 70, 20], blunt: 0.16, glow: 0.68 }, MOUNT_GATLING),
    cam: CAM_GUN, fire: FIRE_GUN, control: HOLD, launch: { mode: "muzzle", inheritMomentum: 1 },
    payload: { penetration: 1.4, he: { every: 5 }, dustMul: 2.15 },
    fits: FIT_GUN, notes: ["GAU-8 — one-taps soft armor/LAV; tanks fall in ~2"],
  },
  heavy_guided_missile: {
    id: "heavy_guided_missile", name: "MAVERICK", fullName: "MAVERICK MISSILE (AIR-TO-GROUND)", designation: "AGM-65 MAVERICK", ammo: 6, fireCd: 0.72, speed: 445,
    dmg: 420, blast: 170, life: 5.5,
    art: ordArt("laserGuided", 0.98, "heading"),
    exhaust: particleTrail(0.55, { fire: "burn", smoke: "linger", density: 1.3 }),
    cam: CAM_LOCK, control: { mode: "lock_then_click" },
    launch: motor(260, 520, 2.2, 1, { pitch: 1.05, loftCap: 0.28 }),
    guidance: lockGuidance(lockOn(0.62, 225, RETICLE_AG), 6.8),
    payload: HE_FIRE,
    fits: FIT_HARDPOINT,
    dmgMul: { vehicle: 1.35, building: 1.25, air: 0.35, troop: 0.5 },
    notes: ["AG laser lock — vehicle/building punch; soft vs air / troops"],
  },
  bomb: {
    id: "bomb", name: "IRON BOMB", fullName: "IRON BOMB", designation: "MARK 82 GENERAL-PURPOSE BOMB", ammo: 10, fireCd: 0.72, speed: 220,
    dmg: 380, blast: 200, life: 6.5,
    art: ordArt("bomb", 0.85, "velocity"),
    exhaust: particleTrail(0.5, { smoke: "short", density: 0.52 }),
    cam: CAM_DROP, control: CLICK, launch: DROP, payload: HE_FIRE,
    dmgMul: { building: 1.35, vehicle: 1.15, troop: 0.9, air: 0.25 },
    fits: FIT_HARDPOINT, notes: ["gravity bomb — weak aim correction vs JDAM; structure / armor fantasy"],
  },
  tesla_beam: {
    id: "tesla_beam", name: "TESLA COIL", fullName: "TESLA COIL", designation: "TESLA COIL ARC CANNON", ammo: 900, fireCd: 0.05, speed: 1,
    dmg: 9, blast: 0, life: 0.05,
    art: gunArt("tesla_beam", 0.62, { w: 80, h: 10, core: [230, 255, 255], mid: [80, 240, 255], rim: [20, 120, 255], glow: 0.85 }, MOUNT_TESLA),
    cam: CAM_GUN, fire: { muzzleFlash: false, jitter: 0 },
    control: HOLD, launch: { mode: "beam", range: 155, delivery: "arc" },
    payload: { stun: 1 },
    fits: FIT_GUN,
    notes: [
      "chin/barrel cannon — arc to the unit nearest the mouse; coil reach is per craft socket",
      "three spiraling electric streams — not a projectile",
      "stun lingers ~1s after the arc leaves; longer hold builds up to ~4s",
    ],
  },
  mini_hellfire_missile: {
    id: "mini_hellfire_missile", name: "MICRO-HELLFIRE", fullName: "MICRO-HELLFIRE MISSILE", designation: "MICRO-HELLFIRE MISSILE", ammo: 10, fireCd: 0.45, speed: 400,
    dmg: 200, blast: 90, life: 4.2,
    art: ordArt("laserGuided", 0.31, "heading"),
    exhaust: particleTrail(0.55, { fire: "burn", smoke: "linger", density: 1.3 }),
    cam: { ...CAM_LOCK, sight: "mouse" }, control: { mode: "lock_then_click" },
    launch: motor(200, 500, 1.65, 1, { pitch: 1.12, loftCap: 0.28 }),
    guidance: lockGuidance(lockOn(0.32, 145), 8.9),
    payload: HE_FIRE,
    fits: FIT_HARDPOINT,
    dmgMul: { vehicle: 1.25, building: 1.1, air: 0.55, troop: 0.7 },
    notes: ["Murder Hornet AT — compact laser F&F; lighter punch / shorter belt than Hellfire"],
  },
  mini_bomb: {
    id: "mini_bomb", name: "KINETIC SLUGS", fullName: "KINETIC SLUGS", designation: "KINETIC DROP SLUGS", ammo: 14, fireCd: 0.6, speed: 180,
    dmg: 130, blast: 42, life: 5.5,
    art: ordArt("miniRocket", 0.58, "velocity"),
    exhaust: particleTrail(0.52, { smoke: "rocket", align: "heading" }),
    cam: CAM_DROP, fire: { muzzleFlash: true, jitter: 0.08, salvo: { count: 2, interval: 0.035, spread: 0.08 } },
    control: CLICK, launch: DROP,
    payload: { penetration: 1.05 },
    fits: FIT_HARDPOINT, notes: ["Murder Hornet AT — paired kinetic drops; armor needles, not Apache splash"],
  },
  artillery_strike: {
    id: "artillery_strike",
    name: "ARTILLERY STRIKE",
    fullName: "SIGNAL FLARE ARTILLERY STRIKE",
    designation: "VF-1 SIGNAL FLARE + OFF-MAP BARRAGE",
    ammo: 4,
    fireCd: 1.4,
    speed: 165,
    dmg: 2,
    blast: 12,
    life: 10,
    art: gunArt(
      "artillery_strike",
      0.55,
      {
        // Square padded so tip-origin orb halo fits without clipping (r ≤ tip-side margin).
        w: 72,
        h: 72,
        core: [255, 120, 90],
        mid: [255, 28, 36],
        rim: [160, 0, 18],
        glow: 1.05,
        shape: "orb",
      },
      MOUNT_PILOT
    ),
    exhaust: { kind: "signalFlare", size: 0.78, density: 1.05 },
    cam: CAM_GUN,
    fire: { muzzleFlash: true, jitter: 0.035 },
    control: CLICK,
    launch: {
      mode: "muzzle",
      inheritMomentum: 0.35,
      gravity: { acceleration: 180, terminalVelocity: 720 },
    },
    payload: {
      callStrike: {
        rounds: 8,
        interval: 1.65,
        jitter: 300,
        shellDmg: 560,
        shellBlast: 175,
        shellLook: ordLook("artilleryShell"),
        shellSpeed: 420,
        flareUntilHits: 3,
      },
    },
    fits: FIT_GUN,
    dmgMul: { building: 1.4, vehicle: 1.2, troop: 0.85, air: 0.2 },
    notes: [
      "pilot flare gun — aim with the mouse like any turret gun; pellet marks the grid",
      "flare settles and howitzers walk immediately; marker stays lit through the first impacts",
      "marker itself is almost inert — damage is the incoming shells",
    ],
  },
  remote_howitzer: {
    id: "remote_howitzer",
    name: "REMOTE HOWITZER",
    fullName: "DROPSHIP HOWITZER SPOT",
    designation: "REMOTE 105MM HOWITZER FIRE MISSION",
    ammo: 12,
    fireCd: 1.85,
    speed: 520,
    dmg: 420,
    blast: 210,
    life: 2.8,
    art: gunArt(
      "remote_howitzer",
      0.98,
      { w: 70, h: 11, core: [255, 250, 230], mid: [255, 170, 50], rim: [180, 70, 20], blunt: 0.72, glow: 0.42 },
      MOUNT_ARTILLERY
    ),
    exhaust: particleTrail(0.55, { density: 0.85, contrail: true }),
    cam: { ...CAM_ARTILLERY, sight: "mouse" },
    fire: FIRE_GUN,
    control: CLICK,
    launch: { mode: "muzzle", inheritMomentum: 0.4, gravity: { acceleration: 200, terminalVelocity: 900 } },
    payload: { hostFire: { weapon: "heavy_artillery" } },
    fits: FIT_GUN,
    notes: [
      "HOUND spotter — one click lobs a shell from the dropship howitzer onto aim",
      "uses the host howitzer mount, ballistics, and shared ammo bank",
    ],
  },
} satisfies Record<string, PlayerWpnSpec>;

/** Player loadout identity — literal union of PLAYER_WPNS keys. */
export type WpnId = keyof typeof PLAYER_WPNS_DEFS;

/** Homogeneous catalog (keys stay literal via WpnId). */
export const PLAYER_WPNS: Record<WpnId, PlayerWpnSpec> = PLAYER_WPNS_DEFS;

/** Narrow a catalog row to its key-typed id (defs use plain string `id`). */
export function wpnIdOf(w: PlayerWpnSpec): WpnId {
  return w.id as WpnId;
}

export function playerLoadout(ids: readonly WpnId[]): PlayerWpnSpec[] {
  return ids.map((id) => {
    const w = PLAYER_WPNS[id];
    if (!w) throw new Error(`unknown weapon id: ${id}`);
    return w;
  });
}

/** Resolve craft sockets into an ordered weapon loadout. */
export function playerLoadoutFromSockets(
  sockets: readonly { weapon: WpnId }[]
): PlayerWpnSpec[] {
  return playerLoadout(sockets.map((s) => s.weapon));
}

/** Turret/cabin gun-body texture for a weapon, if it has one. */
export function weaponMountTex(wpnId: WpnId): string | undefined {
  return PLAYER_WPNS[wpnId]?.art.mount;
}

/** True when a weapon may install into a socket class. */
export function weaponFitsSocket(wpnId: WpnId, socketClass: SocketClass): boolean {
  const w = PLAYER_WPNS[wpnId];
  return !!w && w.fits.includes(socketClass);
}

export interface Unit {
  id: number;
  kind: UnitKind;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  /** Vertical speed for aerial AI (helis matching player AGL). */
  vz?: number;
  angle: number;
  /** Smoothed `projectHeading` so 2.5D singularities can't flip the sprite. */
  drawRot?: number;
  /** Smoothed projected aim for guns / soft troop facing (keyed). */
  aimDrawRots?: Record<string, number>;
  turret: number;
  health: number;
  max: number;
  hv?: string;
  dead: boolean;
  fireCd: number;
  burstLeft?: number;
  orbit: number;
  aware?: boolean;
  aiMood?: "kite" | "flee";
  moodT?: number;
  aiState?: string;
  aiTx?: number;
  aiTy?: number;
  rotor: number;
  track: number;
  turrets: number[];
  muzzleT: number;
  muzzleGun: number;
  muzzleTip: number;
  /** Tip index used for the active muzzle flash (may differ from next-shot muzzleTip). */
  muzzleFireTip?: number;
  /** Baked muzzle flash jitter for the current flash window. */
  muzzleJitS?: number;
  muzzleJitR?: number;
  muzzleFrame?: number;
  pinId?: number;
  /** Index into host UnitSpec.crew.mounts when pinned. */
  pinMount?: number;
  camo?: CamoKind;
  strike?: number;
  /**
   * Seconds of stun remaining. Stunned units get no AI inputs (move, turn, aim, fire)
   * but keep coasting on existing velocity / spin with friction.
   */
  stunT?: number;
  /** Hull yaw rate (rad/s). Recorded from AI so stun can coast turning. */
  omega?: number;
  /** Primary turret yaw rate (rad/s). */
  turretOmega?: number;
  /** Per-barrel turret yaw rates (rad/s), parallel to `turrets`. */
  turretOmegas?: number[];
  /** Seconds until the next stun zap overlay stamp. */
  stunZapT?: number;
  parts?: PartMount[];
  missileCd?: number;
  missileSide?: number;
  killDx?: number;
  killDy?: number;
  /** Killing-shot vz (same frame as killDx/Dy). */
  killDz?: number;
  /** Damage that finished the unit (direct or splash falloff). */
  killDmg?: number;
  /** Persistent solid-pixel damage locations on the hull texture. */
  dmgSites?: { u: number; v: number; scale: number }[];
}
/**
 * Behavior captured at launch. A projectile keeps flying its original profile even
 * if the loadout slot is re-armed or the craft is swapped mid-flight.
 */
export interface ShotBehavior {
  readonly art: WeaponArt;
  readonly exhaust?: ExhaustTrail;
  readonly cam: WeaponCam;
  readonly fire?: WeaponFire;
  readonly guidance?: WeaponGuidance;
  readonly launch: WeaponLaunch;
  readonly payload: WeaponPayload;
  readonly control: WeaponControl;
  /** Cruise speed the motor accelerates toward (spec.speed at launch). */
  readonly cruiseSpeed: number;
  /** Direct-hit damage of one sub-munition-free impact (spec.dmg at launch). */
  readonly dmg: number;
  readonly blast: number;
  /** Per-class damage multipliers captured at launch. */
  readonly dmgMul?: Partial<Record<UnitClass, number>>;
  /** Debuff-target damage mul captured at launch. */
  readonly debuffDmgMul?: number;
}

/** Mutable per-projectile guidance / payload state. */
export interface ShotState {
  /** Seconds since launch. */
  age: number;
  /** Heading at launch; off-boresight limits are measured from the live heading. */
  launchAngle: number;
  /** Seeker is live (past laser/heat seek delay, or handed over on terminal). */
  seeking?: boolean;
  /** NLOS second-click terminal homing engaged. */
  terminal?: boolean;
  /** Latched GPS / designated impact point. */
  gx?: number;
  gy?: number;
  /** Plasma strand phase and lateral sign. */
  helix?: number;
  helixSide?: number;
  helixOff?: number;
  /** Helix oscillation frequency (rad/s-ish). */
  helixFreq?: number;
  /** Phase offset on the helix sine (radians) so burst rounds braid. */
  helixPhase?: number;
  /** Cluster / smoke payload already opened. */
  opened?: boolean;
  /**
   * Cluster dispenser: open when `age >= openAge` (seconds).
   * Authored from predicted fall time × `payload.cluster.openAt`.
   */
  openAge?: number;
  /** Remaining armor targets a penetrator can pass through. */
  pierce?: number;
  /** Units already damaged by this penetrator. */
  hitIds?: number[];
  /** Sub-munition (bomblet) — skips lock HUD and camera hand-off. */
  bomblet?: boolean;
  /** Off-map call-strike shell — links impacts back to the flare mark. */
  callStrikeMarkId?: number;
  /** Impact aim point for ETA / constant-speed flight. */
  callStrikeTx?: number;
  callStrikeTy?: number;
  callStrikeTz?: number;
  /** Flare from a POV remote — barrage spawns from the host craft. */
  callStrikeFromHost?: boolean;
}

/**
 * One drifting chemical puff from a smoke payload.
 * Sim object (vision stacking) — never an FX-budget particle.
 */
export interface SmokePuff {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** World-XY overlap radius for vision stacking. */
  radius: number;
  /** Seconds remaining. */
  t: number;
  max: number;
  tint: number;
  spin: number;
  ang: number;
  frame: number;
}

/** Target taxonomy for damage muls, heat seekers, and HUD classing. */
export type UnitClass = "air" | "vehicle" | "building" | "troop";
/** Heat-seeker preference ordering: air > vehicles > buildings > troops. */
export type HeatClass = UnitClass;

export function heatClassScore(c: HeatClass): number {
  return c === "air" ? 3 : c === "vehicle" ? 2 : c === "building" ? 1 : 0;
}

/** Guidance category a signature class reports to lock_on signature acquire. */
export function heatClassCategory(c: HeatClass): "air" | "ground" | "vehicle" {
  // Buildings count as vehicle-class heat (mech); troops alone use "ground".
  return c === "air" ? "air" : c === "troop" ? "ground" : "vehicle";
}

/** Snapshot the immutable flight profile of a player weapon at trigger time. */
export function shotBehaviorOf(spec: PlayerWpnSpec): ShotBehavior {
  return {
    art: spec.art,
    exhaust: spec.exhaust,
    cam: spec.cam,
    fire: spec.fire,
    guidance: spec.guidance,
    launch: spec.launch,
    payload: spec.payload,
    control: spec.control,
    cruiseSpeed: spec.speed,
    dmg: spec.dmg,
    blast: spec.blast,
    dmgMul: spec.dmgMul,
    debuffDmgMul: spec.debuffDmgMul,
  };
}

/**
 * Avenger-style combat mix: every `he.every`th kinetic round becomes HEI
 * (no pierce, wider blast). Returns pierce for the spawned shot.
 */
export function applyKineticCombatMix(
  spec: PlayerWpnSpec,
  beh: ShotBehavior,
  roundIndex: number
): { beh: ShotBehavior; pierce: number | undefined } {
  const payload = spec.payload;
  const basePierce = payload.penetration;
  const every = payload.he?.every;
  if (every == null || every < 2) {
    return { beh, pierce: basePierce };
  }
  const heRound = roundIndex % every === 0;
  if (!heRound) return { beh, pierce: basePierce };
  const dustMul = payload.dustMul;
  return {
    beh: {
      ...beh,
      payload: {
        ...(dustMul != null ? { dustMul } : {}),
        detonate: { look: "fire" },
      },
      // HEI: softer pen trade for splash — punchier than baseline blast.
      dmg: beh.dmg * 1.08,
      blast: beh.blast * 1.9,
    },
    pierce: undefined,
  };
}

/** Ground-impact dirt multiplier from payload (jet cannons kick up more dust). */
export function payloadDustMul(payload: WeaponPayload | undefined): number {
  return payload?.dustMul ?? 1;
}

/** Partial HE FX weight for SAPHEI-style kinetic (0 if full HE / pure kinetic). */
export function payloadHeBlend(payload: WeaponPayload | undefined): number {
  const b = payload?.he?.blend ?? 0;
  return b <= 0 ? 0 : b >= 1 ? 1 : b;
}

/** True when guidance drives a lock HUD / soft-lock pipeline. */
export function guidanceUsesLock(
  g: WeaponGuidance
): g is WeaponGuidance & {
  targeting: Extract<WeaponTargeting, { mode: "lock_on" | "steer_commit" }>;
} {
  return g.targeting.mode === "lock_on" || g.targeting.mode === "steer_commit";
}

/** Pre-fire unit lock (lock_on), not in-flight steer_commit soft-lock. */
export function guidanceIsLockOn(
  g: WeaponGuidance
): g is WeaponGuidance & { targeting: Extract<WeaponTargeting, { mode: "lock_on" }> } {
  return g.targeting.mode === "lock_on";
}

export function exhaustIsEnergy(
  e: ExhaustTrail | undefined
): e is Extract<ExhaustTrail, { kind: "energy" }> {
  return e?.kind === "energy";
}

/** Parallel ribbon count for energy exhaust (default 1 when energy). */
export function exhaustRibbons(e: ExhaustTrail | undefined): number {
  if (!exhaustIsEnergy(e)) return 0;
  return Math.max(1, (e.ribbons ?? 1) | 0);
}

export function exhaustHue(e: ExhaustTrail | undefined): EnergyTrailHue | undefined {
  return exhaustIsEnergy(e) ? e.hue : undefined;
}

export function exhaustWarpMotes(
  e: ExhaustTrail | undefined
): boolean | { density?: number } | undefined {
  return exhaustIsEnergy(e) ? e.warpMotes : undefined;
}

export function exhaustIsSignalFlare(
  e: ExhaustTrail | undefined
): e is Extract<ExhaustTrail, { kind: "signalFlare" }> {
  return e?.kind === "signalFlare";
}

/** Hold-to-arc beam (Tesla) — live stream, not a ray cast. */
export function launchIsArcBeam(
  launch: WeaponLaunch | undefined
): launch is Extract<WeaponLaunch, { mode: "beam"; delivery: "arc" }> {
  return launch?.mode === "beam" && launch.delivery === "arc";
}

/** Instant ray beam (Refractor) — cast / bounce / split. */
export function launchIsRayBeam(
  launch: WeaponLaunch | undefined
): launch is Extract<WeaponLaunch, { mode: "beam"; delivery: "ray" }> {
  return launch?.mode === "beam" && launch.delivery === "ray";
}

/** Seconds a ribbon node stays visible after it is spawned. */
export const ENERGY_TRAIL_NODE_LIFE = 1.85;
/** Plasma Helix spiral ribbon — short braid fade. */
export const HELIX_TRAIL_NODE_LIFE = 0.5;

export type EnergyTrailHue = "cyan" | "green" | "magenta";

export interface EnergyTrailNode {
  x: number;
  y: number;
  z: number;
  /** Exhaust kick opposite the dart (strong at spawn, then drag). */
  bx: number;
  by: number;
  bz: number;
  life: number;
  /** Fade reference life; defaults to ENERGY_TRAIL_NODE_LIFE. */
  max?: number;
  /** Ribbon color set; defaults cyan (Starstreak / Photon). */
  hue?: EnergyTrailHue;
}

export interface Shot {
  from: "player" | "enemy";
  /** Stable handle for shots the player keeps commanding (NLOS terminal). */
  id?: number;
  /** Loadout identity that fired this projectile. */
  wpnId?: WpnId;
  /** Loadout slot index that fired this projectile. */
  slot?: number;
  /** Immutable behavior snapshot taken at launch. */
  beh?: ShotBehavior;
  /** Mutable guidance / payload state. */
  st?: ShotState;
  /** Additive art tint for energy ordnance. */
  tint?: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  angle: number;
  life: number;
  targetId?: number;
  blast: number;
  dmg: number;
  /**
   * Pull the play camera onto this shot while airborne.
   * Not “is guided” — bombs/GPS can share loft without this.
   */
  povCam?: boolean;
  homePlayer?: boolean;
  motor?: number;
  cruise?: number;
  loft?: number;
  yaw?: number;
  look?: ShotLook;
  /** Draw scale from weapon preset (× secondary mul when applicable). */
  scale?: number;
  /** Effective seconds per projectile, used only to scale muzzle and impact-spark density. */
  fxInterval?: number;
  wire?: { x: number; y: number; z: number }[];
  wireSide?: number;
  wireTrim?: number;
  /** Additive neon ribbon nodes (Starstreak). Offsets wander so the path ripples. */
  energyTrail?: EnergyTrailNode[];
  /** Parallel energy ribbons (Photon). When set, preferred over `energyTrail`. */
  energyTrails?: EnergyTrailNode[][];
  /** EMP / electronics kill: no seek, no trail, falls and detonates on the ground. */
  deadfall?: boolean;
  /** EMP countermeasure killed seeker logic; dart keeps flying dumb. */
  seekDisabled?: boolean;
  /** While this player projectile is active, cap simulation speed to this multiplier. */
  warpTimeScale?: number;
}

/** Decoy spark used by the flares countermeasure. */
export interface Flare {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
}

export interface CountermeasureSpec {
  id: string;
  name: string;
  duration: number;
  cooldown: number;
}

export const COUNTERMEASURES_DEFS = {
  flares: { id: "flares", name: "FLARES", duration: 12, cooldown: 8 },
  timewarp: { id: "timewarp", name: "TIMEWARP", duration: 14, cooldown: 6 },
  phase_cloak: { id: "phase_cloak", name: "PHASE CLOAK", duration: 5.5, cooldown: 16 },
  emp: { id: "emp", name: "EMP", duration: 4, cooldown: 11 },
  reactive_armor: { id: "reactive_armor", name: "REACTIVE ARMOR", duration: 3.5, cooldown: 10 },
  smoke_screen: { id: "smoke_screen", name: "SMOKE SCREEN", duration: 8, cooldown: 12 },
} satisfies Record<string, CountermeasureSpec>;

/** Countermeasure identity — literal union of COUNTERMEASURES keys. */
export type CountermeasureId = keyof typeof COUNTERMEASURES_DEFS;

export const COUNTERMEASURES: Record<CountermeasureId, CountermeasureSpec> = COUNTERMEASURES_DEFS;

function formatCmSeconds(n: number): string {
  return `${Number.isInteger(n) ? n : n.toFixed(1)}s`;
}

/** Hangar / help: effect duration then cooldown. */
export function countermeasureTimingLabel(cm: CountermeasureSpec): string {
  return `${formatCmSeconds(cm.duration)} / ${formatCmSeconds(cm.cooldown)} CD`;
}

export function craftCountermeasure(id?: CountermeasureId): CountermeasureId {
  return id ?? "flares";
}

/** Apply or extend a stun. Safe to call on already-stunned units. */
export function stunUnit(u: Unit, duration: number): void {
  if (u.dead || duration <= 0) return;
  u.stunT = Math.max(u.stunT ?? 0, duration);
}

export function unitStunned(u: Unit): boolean {
  return (u.stunT ?? 0) > 0;
}

function wrapPi(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/**
 * Coast a stunned unit: no new AI, existing linear + angular rates decay to rest.
 * Callers still step position against terrain / altitude.
 */
export function tickStunKinematics(u: Unit, dt: number): void {
  u.stunT = Math.max(0, (u.stunT ?? 0) - dt);
  const drag = Math.pow(0.28, dt);
  const spinDrag = Math.pow(0.18, dt);
  u.vx *= drag;
  u.vy *= drag;
  const omega = (u.omega ?? 0) * spinDrag;
  u.omega = omega;
  u.angle += omega * dt;
  const tOmega = (u.turretOmega ?? 0) * spinDrag;
  u.turretOmega = tOmega;
  u.turret += tOmega * dt;
  const n = u.turrets.length;
  if (!n) return;
  if (!u.turretOmegas) u.turretOmegas = [];
  for (let i = 0; i < n; i++) {
    const w = (u.turretOmegas[i] ?? tOmega) * spinDrag;
    u.turretOmegas[i] = w;
    u.turrets[i] = (u.turrets[i] ?? 0) + w * dt;
  }
  u.turretOmegas.length = n;
  u.turret = u.turrets[0]!;
}

/** Snapshot hull / turret rates from this frame's pose change so stun can coast them. */
export function recordUnitSpin(
  u: Unit,
  prevAngle: number,
  prevTurret: number,
  prevTurrets: readonly number[],
  dt: number
): void {
  if (dt <= 1e-8) return;
  u.omega = wrapPi(u.angle - prevAngle) / dt;
  u.turretOmega = wrapPi(u.turret - prevTurret) / dt;
  if (!u.turretOmegas) u.turretOmegas = [];
  const n = u.turrets.length;
  for (let i = 0; i < n; i++) {
    u.turretOmegas[i] = wrapPi((u.turrets[i] ?? 0) - (prevTurrets[i] ?? 0)) / dt;
  }
  u.turretOmegas.length = n;
}

/** Manually simulated terrain-interacting particles. Other visual FX use Phaser emitters. */
export type SimParticleKind = "dirt";

export interface SimParticle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  scale: number;
  bounces: number;
  kind: SimParticleKind;
  tex: string;
  frame: number;
  angJit: number;
  spin: number;
  tint: number;
  additive: boolean;
  heading: number;
  /** Independent capacity pool so frequent impacts cannot evict coherent dust events. */
  capacityClass: "impact" | "dust" | "blood";
  dart?: boolean;
  blood?: boolean;
  /** Blood particle already painted a multiply stain onto the terrain. */
  stamped?: boolean;
  orb?: boolean;
  shock?: boolean;
  ox?: number;
  oy?: number;
  swirl?: number;
}

export interface Debris {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  angle: number;
  spin: number;
  life: number;
  key: string;
  settled: boolean;
  gravity?: boolean;
  bounces: number;
  /**
   * Capacity/admission importance. Critical authored hulks are never culled;
   * consequential pieces settle and stamp; ephemeral pieces only carry blast trails.
   */
  debrisClass?: "critical" | "consequential" | "ephemeral";
  trailOnly?: boolean;
  trailR: number;
  /** Local flame attach offset in unrotated debris space; orbits as the piece spins. */
  trailLx?: number;
  trailLy?: number;
  scale?: number;
  trailSoft?: boolean;
  trailFade?: number;
  trailFadeMax?: number;
  linger?: boolean;
  wobble?: number;
  wobFreq?: number;
  wobAmp?: number;
  /** Falling heli hull: spin-up, ground boom, damage flames. */
  heliCrash?: boolean;
  playerCrash?: boolean;
  spinAccel?: number;
  impactDust?: number;
  dmgFlames?: { u: number; v: number; scale: number }[];
  simmer?: number;
  /** Local burn points on a thrown part (e.g. radar dish), in unrotated debris space. */
  flamePts?: { lx: number; ly: number; sc: number }[];
  /** Match live radar dish foreshortening (scaleY squash). */
  dishFlat?: boolean;
  /** Strong air drag for spinning rotor debris. */
  rotorThrow?: boolean;
  /** Rotor stays on the falling hull mount instead of flying off. */
  pinHost?: Debris;
  pinMount?: { x: number; y: number };
  /** Mild foreshortening / bend for a pinned rotor (same center). */
  rotorSkew?: boolean;
  /** Fixed tilt-plane angle for rotorSkew (container); blades spin inside. */
  skewAng?: number;
  /** Wheel debris: bounce then roll downhill along the height map. */
  wheelRoll?: boolean;
  rolling?: boolean;
  /** Distance accumulator for wreck-map tire prints while rolling. */
  track?: number;
  /** Spent cannon casing: bounce with heavy friction, stamp on rest. */
  shellEject?: boolean;
  /**
   * Big-boom mech flecks: Hydra-style smoke trail, hold size in flight,
   * stamp on impact and remove (no bounce).
   */
  boomBit?: boolean;
  /** Draw under the firer (air craft). Ground casings omit this and draw above. */
  shellUnder?: boolean;
  /** Thermal heat 1→0 while the casing is still a live debris sprite. */
  shellHeat?: number;
  /** Patrol/PT boat hull: surface sink (scale down) with pre-baked blue hulk. */
  boatSink?: boolean;
  /** Elapsed / total sink duration for scale progress. */
  sinkT?: number;
  sinkMax?: number;
  /**
   * Light-vehicle crash pop: flaming spinning arc, then crater + embers on settle.
   */
  crashPop?: boolean;
  /** Blast-crater scale stamped when a crashPop piece lands. */
  crashCraterScale?: number;
}

let nid = 1;
export function nextId(): number {
  return nid++;
}

export function stats(kind: UnitKind): { health: number; z: number } {
  const s = specOf(kind);
  return { health: s.health, z: s.flyZ ?? 0 };
}

export function radius(kind: UnitKind): number {
  return specOf(kind).radius;
}

export function textureOf(kind: UnitKind): string {
  return specOf(kind).texture;
}

export function heightOf(kind: UnitKind): number {
  return specOf(kind).height;
}

export function hulkOf(kind: UnitKind): string {
  return specOf(kind).hulk;
}

export function debrisCat(kind: UnitKind): DebrisCat {
  return specOf(kind).debris;
}

export function debrisKeys(kind: UnitKind): string[] {
  const cat = debrisCat(kind);
  return Array.from({ length: 12 }, (_, i) => `fx_debris_${cat}_${i}`);
}

export function wheelDebrisKeys(): string[] {
  return Array.from({ length: 4 }, (_, i) => `fx_debris_wheel_${i}`);
}
