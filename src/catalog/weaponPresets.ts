/** Weapon catalog building blocks: art keys, launch/guidance/cam presets, mount ids. */
import type { CannonTracerBake, ExhaustTrail, LockAcquire, LockCategory, WeaponArt, WeaponCam, WeaponFire, WeaponFlight, WeaponGravity, WeaponGuidance, WeaponLaunch, WeaponPayload, WeaponTargeting } from "../sim/combat";
import type { ShotLook } from "../sim/roster";
import type { SocketClass } from "../sim/crafts";

/** Shared ordnance projectile keys under public/sprites/shots/. */
export const ORD = {
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

export function ordLook(key: keyof typeof ORD): ShotLook {
  return ORD[key];
}

/** Runtime-baked cannon tracer keys (procedural; not authored PNGs). */
export function cannonLook(id: string): ShotLook {
  return `shot_cannon_${id}`;
}

/** Shared soft-launch motor ignite delay (kick_motor weapons). */
export const MISSILE_IGNITE = 0.525;
/** Default pre-fire lock dwell for lock_on weapons (seconds). */
export const LOCK_ON_LOCK_T = 0.5;
/** Default post-leave seek delay for lock_on weapons (seconds). */
export const LOCK_ON_SEEK_DELAY = 0.42;
/** Hellfire-family loft before homing — enough climb to turn around on a rear lock. */
export const HELLFIRE_SEEK_DELAY = 0.4;

export const HOLD = { mode: "hold_mouse_down" as const };
export const CLICK = { mode: "click" as const };
export const HE_FIRE: WeaponPayload = { detonate: { look: "fire" } };
export const GRAVITY: WeaponGravity = { acceleration: 210, terminalVelocity: 520 };
export const MUZZLE: WeaponLaunch = { mode: "muzzle", inheritMomentum: 0.4 };
export const DROP: WeaponLaunch = { mode: "drop", inheritMomentum: 1, gravity: GRAVITY };
export const LOOK_LOCK = { pull: 0.58, max: 220, rate: 5.6 } as const;
export const LOOK_ROCKET = { pull: 0.42, max: 160, rate: 7.4 } as const;
export const LOOK_GUIDED = { pull: 0.55, max: 210, rate: 6.5 } as const;
export const LOOK_GUN = { pull: 0.2, max: 88, rate: 10 } as const;
/** Lobbed howitzer — longer lead than Starscream, short of a theater pull-out. */
export const LOOK_ARTILLERY = { pull: 0.58, max: 260, rate: 5.2 } as const;
export const DIVE_TOW = { range: 280, power: 2.85, inner: 45 } as const;
export const DIVE_GRIFFIN = { range: 560, power: 1.25, inner: 90 } as const;
export const DIVE_SPIKE = { range: 340, power: 2.05 } as const;
export const CAM_LOCK: WeaponCam = { reticle: "square", look: LOOK_LOCK };
export const CAM_ROCKET: WeaponCam = { reticle: "square", look: LOOK_ROCKET };
export const CAM_GUIDED: WeaponCam = { reticle: "square", look: LOOK_GUIDED };
export const CAM_GUN: WeaponCam = { reticle: "round", look: LOOK_GUN };
export const CAM_ARTILLERY: WeaponCam = { reticle: "round", look: LOOK_ARTILLERY };
export const CAM_DROP: WeaponCam = { reticle: "round", look: LOOK_GUIDED };
export const FIRE_GUN: WeaponFire = { muzzleFlash: true, jitter: 0.08 };
export const FIT_GUN: SocketClass[] = ["turret", "fixed"];
export const FIT_HARDPOINT: SocketClass[] = ["hardpoint"];
/** M62 7.62 tracer — M240 and M134 are the same bullet. */
export const TRACER_762: CannonTracerBake = {
  w: 44,
  h: 6,
  core: [255, 220, 170],
  mid: [255, 130, 45],
  rim: [190, 60, 22],
  glow: 0.36,
};
/** Shared mount-body keys under public/sprites/guns/. */
export const MOUNT_GATLING = "gun_gatling";
export const MOUNT_MINIGUN = "gun_minigun";
export const MOUNT_MACHINE = "gun_machine";
export const MOUNT_CAL_POD = "gun_cal_pod";
export const MOUNT_SILENCED_CANNON = "gun_silenced_cannon";
export const MOUNT_ARTILLERY = "gun_artillery";
export const MOUNT_RAILGUN = "gun_railgun";
export const MOUNT_PLASMA = "gun_plasma";
export const MOUNT_TESLA = "gun_tesla";
export const MOUNT_PILOT = "gun_pilot";
export const MOUNT_GRENADE = "gun_grenade_launcher";


export const RETICLE: LockAcquire = { policy: "reticle" };
/** AG reticle lock — vehicles / buildings, not air or troops. */
export const RETICLE_AG: LockAcquire = { policy: "reticle", categories: ["vehicle"] };
export const lockOn = (
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
export const signature = (
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
export type KickMotor = Extract<WeaponLaunch, { mode: "kick_motor" }>;
export const motor = (
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
export const railAccel = (acceleration: number): WeaponLaunch => ({
  mode: "muzzle",
  inheritMomentum: 0,
  acceleration,
});
/**
 * Dumbfire rocket: soft leave, motor burn accel to catalog speed, then coast.
 * `fireFor` on exhaust should match `burnTime` for the flame cue.
 */
export const rocketBoost = (
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
export const gunArt = (
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
export const ordArt = (
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
export const particleTrail = (
  size: number,
  opts: {
    fire?: "burn" | "hotFlame" | "cyanSpark";
    fireFor?: number;
    fireSize?: number;
    smoke?: "linger" | "short" | "rocket";
    contrail?: boolean;
    align?: "heading";
    density?: number;
    emitUv?: { x: number; y: number };
  } = {}
): ExhaustTrail => ({
  kind: "particles",
  size,
  ...opts,
});
export const energyTrail = (
  opts: { ribbons?: number; hue?: "cyan" | "green" | "magenta"; warpMotes?: boolean } = {}
): ExhaustTrail => ({
  kind: "energy",
  ...opts,
});
export const lockGuidance = (
  targeting: Extract<WeaponTargeting, { mode: "lock_on" }>,
  turnRate: number,
  loft?: WeaponFlight["loft"]
): WeaponGuidance => ({
  targeting,
  flight: loft ? { turnRate, loft } : { turnRate },
});
export const steerGuidance = (
  turnRate: number,
  maxAngle: number,
  loft: WeaponFlight["loft"] | undefined,
  wire?: boolean
): WeaponGuidance => ({
  targeting: { mode: "steer" },
  flight: loft ? { turnRate, maxAngle, loft } : { turnRate, maxAngle },
  ...(wire != null ? { wire } : {}),
});
export const commitGuidance = (
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
