import { specOf, type DebrisCat, type ShotKind, type ShotLook, type UnitKind, type PartMount } from "./roster";
import type { SocketClass } from "./craft";
import type { CamoKind } from "./camo";

export type { DebrisCat, UnitKind } from "./roster";

/** Tip-biased UV origin for all projectile art (nose-along-+X). */
export const SHOT_ORIGIN = { x: 0.84, y: 0.5 } as const;

/** Exhaust / trail emit UV (rear of projectile art, nose-along-+X). */
export const SHOT_TAIL = { x: 0.06, y: 0.5 } as const;

/** Player loadout identity (slot / catalog key). */
export type WpnId = string;

/** Closed legacy look type; staged keys cross one typed boundary until roster art lands. */
export type PlayerShotLook = ShotLook;

/** Shared ordnance projectile keys under public/sprites/shots/. */
/** Shared ordnance projectile keys under public/sprites/shots/. */
const ORD = {
  rocket: "shot_rocket",
  laserGuided: "shot_laser_guided",
  guided: "shot_guided",
  missile: "shot_missile",
  aa: "shot_aam",
  miniRocket: "shot_mini_rocket",
  long: "shot_long",
  bomb: "shot_bomb",
  canister: "shot_canister",
} as const;

function ordLook(key: keyof typeof ORD): ShotLook {
  return ORD[key];
}

/** Runtime-baked cannon tracer keys (procedural; not authored PNGs). */
function cannonLook(id: string): ShotLook {
  return `shot_cannon_${id}`;
}

export type WeaponGuidance =
  | { mode: "none" }
  | { mode: "pointer"; steerRate: number; maxAngle: number; requiresLaser?: boolean }
  | { mode: "laser"; lockTime: number; lockRadius: number; fireAndForget: boolean; seekDelay: number }
  | {
      mode: "heat";
      lockTime: number;
      lockRadius: number;
      categories: readonly ("air" | "ground" | "vehicle")[];
      minHealth: number;
      maxOffBoresight: number;
      fireAndForget: true;
    }
  | { mode: "command_nlos"; lockTime: number; lockRadius: number; wire: false; terminalOnSecondClick: true }
  | { mode: "gps"; steerRate: number; pointOnClick: true }
  | { mode: "auto"; acquireRadius: number; retarget: boolean };

export type WeaponLaunch =
  | { mode: "muzzle"; inheritMomentum: number }
  | { mode: "kick_motor"; kickSpeed: number; igniteDelay: number; acceleration: number; burnTime: number; inheritMomentum: number }
  | { mode: "drop"; inheritMomentum: 1; releaseSpeed?: number }
  | { mode: "beam"; range: number; duration: number };

export type WeaponPayload =
  | { mode: "kinetic"; penetration?: number }
  | { mode: "he" }
  | { mode: "cluster"; bomblets: number; spread: number }
  | { mode: "smoke"; duration: number; radius: number; blocksLos: true }
  | { mode: "emp"; duration: number; radius: number; disables: true }
  | { mode: "drone"; duration: number; persistent: true; autonomous: true }
  | { mode: "beam"; shape: "line" | "cone"; chain?: number }
  | { mode: "plasma_helix"; strands: 2 }
  | { mode: "warp"; timeScale: number };

export type WeaponControl =
  | { mode: "hold" }
  | { mode: "click" }
  | { mode: "lock_then_click" }
  | { mode: "first_second_click" }
  | { mode: "designate_then_release" }
  | { mode: "automatic" };

export interface WeaponSteering {
  turnRate: number;
  maxG?: number;
  loft?: number;
  terminalTurnRate?: number;
}

export interface WeaponGravity {
  acceleration: number;
  terminalVelocity?: number;
}

export interface WeaponSalvo {
  count: number;
  interval: number;
  spread?: number;
}

/** Render treatment requested while viewing through a weapon-mounted sensor. */
export interface WeaponSensorView {
  mode: "thermal";
  source: "seeker" | "remote";
  palette: "white_hot" | "black_hot" | "full_spectrum";
}

/** Player loadout — shared by fire logic and the combat config browser. */
export interface PlayerWpnSpec {
  /** Loadout identity (slot / catalog). May diverge from `kind` (e.g. upgraded cannon). */
  id: WpnId;
  /** Short HUD nickname (no code designation). */
  name: string;
  /** Formal designation for rigs / help. */
  fullName: string;
  ammo: number;
  fireCd: number;
  /** Launch / ballistic speed (powered missiles may kick, then ignite their motor). */
  speed: number;
  dmg: number;
  blast: number;
  life: number;
  /** Flight / seek behavior (`ShotKind`). */
  kind: ShotKind;
  /** Projectile texture key. */
  look: PlayerShotLook;
  /**
   * Visible turret/cabin gun-body texture (barrel-up overlay under the craft).
   * Omit for ordnance / weapons with no mount graphic.
   */
  mount?: string;
  /** Procedural cannon tracer bake (when `look` is a `shot_cannon_*` key). */
  tracer?: CannonTracerBake;
  /** Trail puff scale multiplier vs projectile `scale` (rockets/missiles). */
  trailScale?: number;
  /** Projectile draw scale. */
  scale: number;
  silent?: boolean;
  beam?: boolean;
  guidance: WeaponGuidance;
  launch: WeaponLaunch;
  payload: WeaponPayload;
  control: WeaponControl;
  steering?: WeaponSteering;
  gravity?: WeaponGravity;
  salvo?: WeaponSalvo;
  /** Optional camera treatment for future seeker/drone POV modes. */
  sensorView?: WeaponSensorView;
  /** Socket classes this weapon may install into. */
  fits: SocketClass[];
  notes: string[];
}

/** Shared missile timing retained for the phase-1 legacy runtime. */
export const MISSILE_IGNITE = 0.525;
export const HELLFIRE_LOCK_T = 0.5;
export const HELLFIRE_SEEK_DELAY = 0.42;

const NONE: WeaponGuidance = { mode: "none" };
const HOLD: WeaponControl = { mode: "hold" };
const CLICK: WeaponControl = { mode: "click" };
const MUZZLE: WeaponLaunch = { mode: "muzzle", inheritMomentum: 0.35 };
const DROP: WeaponLaunch = { mode: "drop", inheritMomentum: 1 };
const HE: WeaponPayload = { mode: "he" };
const KINETIC: WeaponPayload = { mode: "kinetic" };
const GRAVITY: WeaponGravity = { acceleration: 360, terminalVelocity: 760 };
const FIT_GUN: SocketClass[] = ["turret", "fixed", "cabin"];
const FIT_HARDPOINT: SocketClass[] = ["hardpoint"];
const FIT_BAY: SocketClass[] = ["bay"];
/** Shared mount-body keys under public/sprites/guns/. */
const MOUNT_GATLING = "gun_gatling";
const MOUNT_MINIGUN = "gun_minigun";
const MOUNT_MACHINE = "gun_machine";
const MOUNT_ARTILLERY = "gun_artillery";
const MOUNT_RAILGUN = "gun_railgun";
const MOUNT_PLASMA = "gun_plasma";
const MOUNT_TESLA = "gun_tesla";

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
}

const laser = (lockTime: number, lockRadius: number): WeaponGuidance => ({
  mode: "laser", lockTime, lockRadius, fireAndForget: true, seekDelay: HELLFIRE_SEEK_DELAY,
});
const heat = (lockTime: number, lockRadius: number, maxOffBoresight: number): WeaponGuidance => ({
  mode: "heat", lockTime, lockRadius, categories: ["air", "ground", "vehicle"], minHealth: 1,
  maxOffBoresight, fireAndForget: true,
});
const motor = (speed: number, acceleration: number, burnTime: number): WeaponLaunch => ({
  mode: "kick_motor", kickSpeed: speed, igniteDelay: MISSILE_IGNITE, acceleration, burnTime, inheritMomentum: 0.55,
});

/** Canonical weapon identities; craft sockets supply installation policy + default loadout. */
export const PLAYER_WPNS: Record<WpnId, PlayerWpnSpec> = {
  chain_gun: {
    id: "chain_gun", name: "CHAIN GUN", fullName: "M230 30MM CHAIN GUN", ammo: 1200, fireCd: 0.07, speed: 780,
    dmg: 8, blast: 18, life: 0.08, kind: "cannon", look: cannonLook("chain_gun"), mount: MOUNT_GATLING, tracer: { w: 64, h: 10, core: [255, 250, 220], mid: [255, 210, 80], rim: [255, 140, 32], glow: 0.55 }, scale: 0.58,
    guidance: NONE, launch: MUZZLE, payload: { mode: "kinetic", penetration: 0.55 }, control: HOLD,
    fits: FIT_GUN, notes: ["30mm chain-fired autocannon"],
  },
  rocket: {
    id: "rocket", name: "HYDRA", fullName: "HYDRA 70 ROCKET PODS", ammo: 38, fireCd: 0.22, speed: 620,
    dmg: 110, blast: 140, life: 3.4, kind: "rocket", look: ordLook("rocket"), scale: 1, trailScale: 0.32,
    guidance: NONE, launch: MUZZLE, payload: HE, control: HOLD,
    fits: FIT_HARDPOINT, notes: ["unguided dumbfire rocket"],
  },
  hellfire_missile: {
    id: "hellfire_missile", name: "HELLFIRE", fullName: "AGM-114R HELLFIRE II", ammo: 8, fireCd: 0.55, speed: 380,
    dmg: 185, blast: 175, life: 4.9, kind: "lock-on-missile", look: ordLook("laserGuided"), scale: 1, trailScale: 0.55,
    guidance: laser(0.5, 160), launch: motor(90, 520, 2.1), payload: HE, control: { mode: "lock_then_click" },
    steering: { turnRate: 7.4, maxG: 12 }, fits: FIT_HARDPOINT, notes: ["laser lock; fire-and-forget after launch"],
  },
  tv_missile: {
    id: "tv_missile", name: "SPIKE", fullName: "SPIKE NLOS COMMAND MISSILE", ammo: 6, fireCd: 1.05, speed: 405,
    dmg: 205, blast: 172, life: 6.4, kind: "guided-missile", look: ordLook("guided"), scale: 0.95, trailScale: 0.52,
    guidance: { mode: "command_nlos", lockTime: 0.65, lockRadius: 190, wire: false, terminalOnSecondClick: true },
    launch: motor(82, 470, 2.5), payload: HE, control: { mode: "first_second_click" },
    steering: { turnRate: 3.4, terminalTurnRate: 8.2, loft: 0.28 },
    sensorView: { mode: "thermal", source: "seeker", palette: "white_hot" },
    fits: FIT_HARDPOINT, notes: ["wireless NLOS command; second click begins terminal homing", "seeker POV requests a white-hot IR/thermal render"],
  },
  minigun: {
    id: "minigun", name: "MINIGUN", fullName: "M134 / GAU-17/A 7.62MM MINIGUN",
    ammo: 2600, fireCd: 0.042, speed: 920, dmg: 6.8, blast: 10, life: 0.09,
    kind: "cannon", look: cannonLook("minigun"), mount: MOUNT_MINIGUN, tracer: { w: 48, h: 7, core: [255, 244, 200], mid: [255, 190, 70], rim: [220, 120, 28], glow: 0.4 }, scale: 0.5,
    guidance: NONE, launch: MUZZLE, payload: KINETIC, control: HOLD,
    fits: FIT_GUN, notes: ["station metadata supplies installation mount, controller, and muzzle behavior"],
  },
  heavy_machine_gun: {
    id: "heavy_machine_gun", name: "HEAVY GATLING", fullName: "GAU-19/A .50 CAL GATLING GUN", ammo: 1100, fireCd: 0.058, speed: 980,
    dmg: 11.5, blast: 14, life: 0.1, kind: "cannon", look: cannonLook("heavy_machine_gun"), mount: MOUNT_GATLING, tracer: { w: 70, h: 11, core: [255, 248, 230], mid: [255, 200, 90], rim: [200, 100, 30], blunt: 0.25, glow: 0.5 }, scale: 0.62,
    guidance: NONE, launch: MUZZLE, payload: { mode: "kinetic", penetration: 0.68 }, control: HOLD,
    fits: FIT_GUN, notes: ["heavy-caliber rapid-fire machine gun"],
  },
  light_gatling_cannon: {
    id: "light_gatling_cannon", name: "LIGHT GATLING", fullName: "M197 20MM THREE-BARREL CANNON", ammo: 750, fireCd: 0.085, speed: 860,
    dmg: 11, blast: 17, life: 0.09, kind: "cannon", look: cannonLook("light_gatling_cannon"), mount: MOUNT_GATLING, tracer: { w: 58, h: 9, core: [255, 252, 210], mid: [255, 175, 55], rim: [230, 95, 20], glow: 0.48 }, scale: 0.62,
    guidance: NONE, launch: MUZZLE, payload: { mode: "kinetic", penetration: 0.48 }, control: HOLD,
    fits: FIT_GUN, notes: ["three-barrel 20mm cannon"],
  },
  tow_missile: {
    id: "tow_missile", name: "TOW", fullName: "BGM-71E TOW 2A MISSILE", ammo: 6, fireCd: 1.1, speed: 400,
    dmg: 176, blast: 160, life: 5.2, kind: "guided-missile", look: ordLook("guided"), scale: 1, trailScale: 0.52,
    guidance: { mode: "pointer", steerRate: 2.2, maxAngle: 0.75 }, launch: motor(76, 420, 2.4), payload: HE,
    control: HOLD, steering: { turnRate: 2.2, maxG: 5.5 }, fits: FIT_HARDPOINT, notes: ["continuous command guidance"],
  },
  sidewinder_missile: {
    id: "sidewinder_missile", name: "SIDEWINDER", fullName: "AIM-9X SIDEWINDER", ammo: 12, fireCd: 0.34, speed: 510,
    dmg: 132, blast: 108, life: 5.1, kind: "lock-on-missile", look: ordLook("aa"), scale: 0.68, trailScale: 0.55,
    guidance: heat(0.32, 210, 1.22), launch: MUZZLE, payload: HE, control: { mode: "lock_then_click" },
    steering: { turnRate: 10.8, maxG: 24 }, fits: FIT_HARDPOINT, notes: ["heat seeker filters target category, health, and seeker angle"],
  },
  machine_gun: {
    id: "machine_gun", name: "MACHINE GUN", fullName: "M240D 7.62MM MACHINE GUN", ammo: 3200, fireCd: 0.066, speed: 875,
    dmg: 5.8, blast: 9, life: 0.08, kind: "cannon", look: cannonLook("machine_gun"), mount: MOUNT_MACHINE, tracer: { w: 42, h: 7, core: [255, 236, 180], mid: [230, 165, 60], rim: [170, 95, 30], glow: 0.35 }, scale: 0.45,
    guidance: NONE, launch: MUZZLE, payload: KINETIC, control: HOLD,
    fits: FIT_GUN, notes: ["station metadata supplies cabin count, traverse, and muzzle behavior"],
  },
  heavy_bomb: {
    id: "heavy_bomb", name: "MOAB", fullName: "GBU-43/B MASSIVE ORDNANCE AIR BLAST", ammo: 2, fireCd: 2.4, speed: 165,
    dmg: 520, blast: 410, life: 7.5, kind: "guided-missile", look: ordLook("bomb"), scale: 1.75,
    guidance: NONE, launch: DROP, payload: HE, control: CLICK, gravity: GRAVITY, fits: FIT_BAY, notes: ["gravity bomb inherits aircraft momentum"],
  },
  cluster_bomb: {
    id: "cluster_bomb", name: "ROCKEYE", fullName: "CBU-100 ROCKEYE II CLUSTER BOMB", ammo: 5, fireCd: 1.35, speed: 185,
    dmg: 225, blast: 255, life: 6.8, kind: "guided-missile", look: ordLook("bomb"), scale: 1.2,
    guidance: NONE, launch: DROP, payload: { mode: "cluster", bomblets: 18, spread: 145 }, control: CLICK,
    gravity: GRAVITY, fits: FIT_BAY, notes: ["momentum-inheriting cluster gravity bomb"],
  },
  guided_rockets: {
    id: "guided_rockets", name: "DEFENSE MICROS", fullName: "FORWARD DEFENSE MICRO-MISSILE POD", ammo: 24, fireCd: 0.24, speed: 455,
    dmg: 74, blast: 68, life: 4.1, kind: "rocket", look: ordLook("rocket"), scale: 0.5, trailScale: 0.32,
    guidance: { mode: "pointer", steerRate: 1.45, maxAngle: 0.28, requiresLaser: true }, launch: MUZZLE, payload: HE, control: HOLD,
    steering: { turnRate: 1.45, maxG: 2.8 }, salvo: { count: 2, interval: 0.08, spread: 0.08 },
    fits: FIT_HARDPOINT, notes: ["slightly steers toward the current pointer target"],
  },
  auto_machine_gun: {
    id: "auto_machine_gun", name: "AUTO TURRET", fullName: "AUTONOMOUS M2HB .50 CAL TURRET", ammo: 900, fireCd: 0.105, speed: 965,
    dmg: 15, blast: 18, life: 0.11, kind: "cannon", look: cannonLook("auto_machine_gun"), mount: MOUNT_MACHINE, tracer: { w: 66, h: 10, core: [255, 240, 210], mid: [240, 175, 70], rim: [190, 90, 35], blunt: 0.15, glow: 0.45 }, scale: 0.66,
    guidance: { mode: "auto", acquireRadius: 340, retarget: true }, launch: MUZZLE, payload: { mode: "kinetic", penetration: 0.72 },
    control: { mode: "automatic" }, fits: FIT_GUN, notes: ["AI acquires and engages targets automatically"],
  },
  concealed_cannon: {
    id: "concealed_cannon", name: "LOW-RCS", fullName: "20MM LOW-RCS CANNON", ammo: 820, fireCd: 0.105, speed: 890,
    dmg: 13.5, blast: 15, life: 0.1, kind: "cannon", look: cannonLook("concealed_cannon"), mount: MOUNT_MACHINE, tracer: { w: 52, h: 8, core: [220, 230, 240], mid: [140, 160, 180], rim: [70, 90, 110], glow: 0.22 }, scale: 0.6, silent: true,
    guidance: NONE, launch: MUZZLE, payload: { mode: "kinetic", penetration: 0.5 }, control: HOLD,
    fits: FIT_GUN, notes: ["suppressed report and low muzzle flash"],
  },
  smoke_bomb: {
    id: "smoke_bomb", name: "SMOKE", fullName: "LASER-GUIDED SMOKE BOMB", ammo: 8, fireCd: 1.15, speed: 370,
    dmg: 24, blast: 195, life: 6, kind: "guided-missile", look: ordLook("canister"), scale: 0.88, trailScale: 0.52,
    guidance: { mode: "command_nlos", lockTime: 0.4, lockRadius: 210, wire: false, terminalOnSecondClick: true },
    launch: motor(75, 390, 2.2), payload: { mode: "smoke", duration: 12, radius: 190, blocksLos: true },
    control: { mode: "first_second_click" }, steering: { turnRate: 3, terminalTurnRate: 6.5, loft: 0.32 },
    fits: FIT_HARDPOINT, notes: ["NLOS delivery creates persistent LOS-blocking smoke"],
  },
  stinger_missile: {
    id: "stinger_missile", name: "STINGER", fullName: "FIM-92 STINGER STEALTH POD", ammo: 10, fireCd: 0.5, speed: 475,
    dmg: 112, blast: 92, life: 4.7, kind: "lock-on-missile", look: ordLook("missile"), scale: 0.6, trailScale: 0.55,
    guidance: heat(0.38, 185, 1.05), launch: motor(95, 600, 1.8), payload: HE, control: { mode: "lock_then_click" },
    steering: { turnRate: 9.4, maxG: 20 }, fits: FIT_HARDPOINT, notes: ["low-signature heat seeker"],
  },
  railgun: {
    id: "railgun", name: "RAILGUN", fullName: "RG-40 HYPERVELOCITY RAILGUN", ammo: 160, fireCd: 0.18, speed: 1850,
    dmg: 46, blast: 8, life: 0.16, kind: "cannon", look: cannonLook("railgun"), mount: MOUNT_RAILGUN, tracer: { w: 96, h: 8, core: [220, 245, 255], mid: [80, 200, 255], rim: [30, 90, 220], glow: 0.75 }, scale: 0.55,
    guidance: NONE, launch: MUZZLE, payload: { mode: "kinetic", penetration: 1.4 }, control: CLICK,
    fits: FIT_GUN, notes: ["hypervelocity penetrator"],
  },
  swarm_missile: {
    id: "swarm_missile", name: "STARSTREAK", fullName: "STARSTREAK MICRO-MISSILE SWARM", ammo: 18, fireCd: 0.48, speed: 720,
    dmg: 118, blast: 76, life: 4.5, kind: "lock-on-missile", look: ordLook("missile"), scale: 0.58, trailScale: 0.55,
    guidance: { mode: "command_nlos", lockTime: 0.3, lockRadius: 220, wire: false, terminalOnSecondClick: true },
    launch: motor(135, 880, 1.4), payload: { mode: "kinetic", penetration: 0.9 },
    control: { mode: "first_second_click" }, steering: { turnRate: 11.2, terminalTurnRate: 14, maxG: 25 },
    salvo: { count: 3, interval: 0.065, spread: 0.06 }, fits: FIT_HARDPOINT, notes: ["three-dart NLOS command salvo; second click terminals"],
  },
  attack_drone: {
    id: "attack_drone", name: "SPECTER", fullName: "SPECTER REMOTE ATTACK DRONE", ammo: 3, fireCd: 3, speed: 260,
    dmg: 82, blast: 96, life: 18, kind: "guided-missile", look: ordLook("guided"), scale: 0.9, trailScale: 0.52,
    guidance: { mode: "auto", acquireRadius: 300, retarget: true }, launch: motor(55, 180, 4.5),
    payload: { mode: "drone", duration: 18, persistent: true, autonomous: true }, control: CLICK,
    steering: { turnRate: 4.8, maxG: 8 },
    sensorView: { mode: "thermal", source: "remote", palette: "white_hot" },
    fits: FIT_BAY, notes: ["persists and autonomously attacks", "remote view requests a white-hot thermal render"],
  },
  emp: {
    id: "emp", name: "EMP", fullName: "TACTICAL EMP PULSE EMITTER", ammo: 6, fireCd: 1.8, speed: 1,
    dmg: 18, blast: 230, life: 0.2, kind: "rocket", look: ordLook("rocket"), scale: 1.4,
    guidance: NONE, launch: { mode: "beam", range: 235, duration: 0.25 },
    payload: { mode: "emp", duration: 8, radius: 230, disables: true }, control: CLICK,
    fits: FIT_GUN, notes: ["radial pulse disables affected systems"],
  },
  plasma_cannon: {
    id: "plasma_cannon", name: "PLASMA HELIX", fullName: "PLASMA HELIX CANNON", ammo: 1800, fireCd: 0.075, speed: 1050,
    dmg: 15, blast: 22, life: 0.1, kind: "cannon", look: cannonLook("plasma_cannon"), mount: MOUNT_PLASMA, tracer: { w: 72, h: 12, core: [255, 220, 255], mid: [200, 90, 255], rim: [90, 30, 200], twin: true, glow: 0.7 }, scale: 0.72,
    guidance: NONE, launch: MUZZLE, payload: { mode: "plasma_helix", strands: 2 }, control: HOLD,
    fits: FIT_GUN, notes: ["paired corkscrewing plasma strands"],
  },
  laser_rocket: {
    id: "laser_rocket", name: "REFRACTOR", fullName: "REFRACTOR CANNON", ammo: 44, fireCd: 0.16, speed: 760,
    dmg: 125, blast: 150, life: 2.8, kind: "rocket", look: ordLook("rocket"), scale: 0.86, trailScale: 0.32,
    guidance: { mode: "pointer", steerRate: 1.8, maxAngle: 0.42 }, launch: MUZZLE, payload: HE, control: HOLD,
    steering: { turnRate: 1.8, maxG: 3.4 }, fits: ["hardpoint", "fixed"] as SocketClass[], notes: ["refractive guided energy bolt"],
  },
  photon_missile: {
    id: "photon_missile", name: "PHOTON", fullName: "PHOTON MISSILE", ammo: 12, fireCd: 0.42, speed: 880,
    dmg: 210, blast: 185, life: 3.2, kind: "lock-on-missile", look: ordLook("laserGuided"), scale: 0.92, trailScale: 0.55,
    guidance: laser(0.22, 245), launch: MUZZLE, payload: HE, control: { mode: "lock_then_click" },
    steering: { turnRate: 12, maxG: 30 }, fits: ["hardpoint", "fixed"] as SocketClass[], notes: ["high-energy omniband seeker"],
  },
  warp_bomb: {
    id: "warp_bomb", name: "WARP BOMB", fullName: "WB-1 GUIDED WARP BOMB", ammo: 4, fireCd: 1.4, speed: 330,
    dmg: 340, blast: 290, life: 6.2, kind: "guided-missile", look: ordLook("bomb"), scale: 1.3,
    guidance: { mode: "gps", steerRate: 2.6, pointOnClick: true }, launch: DROP, payload: { mode: "warp", timeScale: 0.12 },
    control: { mode: "designate_then_release" }, steering: { turnRate: 2.6 }, gravity: GRAVITY,
    sensorView: { mode: "thermal", source: "remote", palette: "full_spectrum" },
    fits: FIT_BAY, notes: ["GPS-steered falling warp payload", "remote view requests a full-spectrum thermal render"],
  },
  medium_gatling_cannon: {
    id: "medium_gatling_cannon", name: "EQUALIZER", fullName: "25MM GAU-22/A EQUALIZER GATLING GUN", ammo: 500, fireCd: 0.07, speed: 1120,
    dmg: 14, blast: 18, life: 0.11, kind: "cannon", look: cannonLook("medium_gatling_cannon"), mount: MOUNT_GATLING, tracer: { w: 62, h: 10, core: [255, 248, 220], mid: [255, 185, 60], rim: [240, 110, 25], glow: 0.52 }, scale: 0.66,
    guidance: NONE, launch: MUZZLE, payload: { mode: "kinetic", penetration: 0.78 }, control: HOLD,
    fits: FIT_GUN, notes: ["medium-caliber rapid-fire Gatling cannon"],
  },
  long_range_missile: {
    id: "long_range_missile", name: "AMRAAM", fullName: "AIM-120D AMRAAM", ammo: 16, fireCd: 0.44, speed: 540,
    dmg: 178, blast: 148, life: 6, kind: "lock-on-missile", look: ordLook("long"), scale: 0.8, trailScale: 0.55,
    guidance: laser(0.48, 285), launch: MUZZLE, payload: HE, control: { mode: "lock_then_click" },
    steering: { turnRate: 7.6, maxG: 16 }, fits: ["bay", "hardpoint"] as SocketClass[], notes: ["long-range laser-guided missile"],
  },
  gps_bomb: {
    id: "gps_bomb", name: "JDAM", fullName: "GBU-31 JDAM", ammo: 8, fireCd: 0.95, speed: 205,
    dmg: 245, blast: 215, life: 7, kind: "guided-missile", look: ordLook("bomb"), scale: 1.1,
    guidance: { mode: "gps", steerRate: 1.85, pointOnClick: true }, launch: DROP, payload: HE,
    control: { mode: "designate_then_release" }, steering: { turnRate: 1.85 }, gravity: GRAVITY,
    fits: FIT_BAY, notes: ["clicked GPS point; steers while falling"],
  },
  heavy_artillery: {
    id: "heavy_artillery", name: "HOWITZER", fullName: "105MM M102 HOWITZER", ammo: 24, fireCd: 1.15, speed: 540,
    dmg: 270, blast: 235, life: 0.24, kind: "cannon", look: cannonLook("heavy_artillery"), mount: MOUNT_ARTILLERY, tracer: { w: 88, h: 16, core: [255, 250, 230], mid: [255, 170, 50], rim: [180, 70, 20], blunt: 0.85, glow: 0.4 }, scale: 1.45,
    guidance: NONE, launch: MUZZLE, payload: HE, control: CLICK,
    gravity: { acceleration: 220, terminalVelocity: 900 }, fits: FIT_GUN, notes: ["heavy explosive artillery shell"],
  },
  medium_cannon: {
    id: "medium_cannon", name: "BOFORS", fullName: "40MM BOFORS CANNON", ammo: 90, fireCd: 0.32, speed: 680,
    dmg: 85, blast: 95, life: 0.18, kind: "cannon", look: cannonLook("medium_cannon"), mount: MOUNT_ARTILLERY, tracer: { w: 76, h: 13, core: [255, 245, 210], mid: [255, 160, 45], rim: [200, 80, 18], blunt: 0.55, glow: 0.45 }, scale: 1.05,
    guidance: NONE, launch: MUZZLE, payload: HE, control: HOLD,
    fits: FIT_GUN, notes: ["medium-caliber explosive cannon"],
  },
  light_cannon: {
    id: "light_cannon", name: "EQUALIZER", fullName: "25MM GAU-12/U EQUALIZER CANNON", ammo: 3000, fireCd: 0.052, speed: 1080,
    dmg: 16.5, blast: 20, life: 0.115, kind: "cannon", look: cannonLook("light_cannon"), mount: MOUNT_GATLING, tracer: { w: 60, h: 9, core: [255, 250, 215], mid: [255, 195, 70], rim: [235, 120, 28], glow: 0.5 }, scale: 0.7,
    guidance: NONE, launch: MUZZLE, payload: { mode: "kinetic", penetration: 0.82 }, control: HOLD,
    fits: FIT_GUN, notes: ["rapid-fire 25mm Gatling cannon"],
  },
  gps_missile: {
    id: "gps_missile", name: "GRIFFIN", fullName: "AGM-176 GRIFFIN", ammo: 12, fireCd: 0.7, speed: 410,
    dmg: 168, blast: 152, life: 5, kind: "lock-on-missile", look: ordLook("guided"), scale: 0.84, trailScale: 0.52,
    guidance: { mode: "gps", steerRate: 5.8, pointOnClick: true }, launch: motor(88, 450, 2.2), payload: HE,
    control: { mode: "designate_then_release" }, steering: { turnRate: 5.8, maxG: 11 },
    fits: FIT_HARDPOINT, notes: ["powered GPS missile steers to clicked point"],
  },
  heavy_cannon: {
    id: "heavy_cannon", name: "AVENGER", fullName: "30MM GAU-8/A AVENGER GATLING GUN", ammo: 1150, fireCd: 0.055, speed: 1180,
    dmg: 18, blast: 24, life: 0.12, kind: "cannon", look: cannonLook("heavy_cannon"), mount: MOUNT_GATLING, tracer: { w: 74, h: 12, core: [255, 252, 225], mid: [255, 175, 55], rim: [210, 95, 22], blunt: 0.35, glow: 0.55 }, scale: 0.78,
    guidance: NONE, launch: MUZZLE, payload: { mode: "kinetic", penetration: 1.05 }, control: HOLD,
    fits: FIT_GUN, notes: ["heavy armor-penetrating 30mm cannon"],
  },
  heavy_guided_missile: {
    id: "heavy_guided_missile", name: "MAVERICK", fullName: "AGM-65 MAVERICK", ammo: 6, fireCd: 0.72, speed: 445,
    dmg: 220, blast: 185, life: 5.5, kind: "lock-on-missile", look: ordLook("laserGuided"), scale: 0.98, trailScale: 0.55,
    guidance: laser(0.62, 225), launch: MUZZLE, payload: HE, control: { mode: "lock_then_click" },
    steering: { turnRate: 6.8, maxG: 13 }, fits: FIT_HARDPOINT, notes: ["laser lock and fire-and-forget"],
  },
  bomb: {
    id: "bomb", name: "IRON BOMB", fullName: "MARK 82 GENERAL-PURPOSE BOMB", ammo: 10, fireCd: 0.72, speed: 220,
    dmg: 210, blast: 195, life: 6.5, kind: "guided-missile", look: ordLook("bomb"), scale: 1,
    guidance: NONE, launch: DROP, payload: HE, control: CLICK, gravity: GRAVITY,
    fits: FIT_BAY, notes: ["unguided gravity bomb inherits momentum"],
  },
  light_machine_gun: {
    id: "light_machine_gun", name: "LIGHT MG", fullName: "5.56MM LIGHTWEIGHT MACHINE GUN", ammo: 2200, fireCd: 0.046, speed: 890,
    dmg: 4.2, blast: 6, life: 0.075, kind: "cannon", look: cannonLook("light_machine_gun"), mount: MOUNT_MACHINE, tracer: { w: 34, h: 6, core: [255, 230, 170], mid: [210, 150, 50], rim: [150, 85, 28], glow: 0.3 }, scale: 0.36,
    guidance: NONE, launch: MUZZLE, payload: KINETIC, control: HOLD, fits: FIT_GUN, notes: ["ultralight drone rotary gun"],
  },
  tesla_beam: {
    id: "tesla_beam", name: "TESLA COIL", fullName: "TESLA COIL", ammo: 420, fireCd: 0.16, speed: 1450,
    dmg: 31, blast: 72, life: 0.05, kind: "cannon", look: cannonLook("tesla_beam"), mount: MOUNT_TESLA, tracer: { w: 80, h: 10, core: [230, 255, 255], mid: [80, 240, 255], rim: [20, 120, 255], twin: true, glow: 0.85 }, scale: 0.62, beam: true,
    guidance: NONE, launch: { mode: "beam", range: 265, duration: 0.1 }, payload: { mode: "beam", shape: "cone", chain: 3 },
    control: HOLD, fits: FIT_GUN, notes: ["short-range cone beam chains between targets"],
  },
  mini_hellfire_missile: {
    id: "mini_hellfire_missile", name: "MINI-HELLFIRE", fullName: "MINI-HELLFIRE", ammo: 14, fireCd: 0.38, speed: 420,
    dmg: 116, blast: 104, life: 4.4, kind: "lock-on-missile", look: ordLook("laserGuided"), scale: 0.62, trailScale: 0.55,
    guidance: laser(0.32, 145), launch: motor(100, 610, 1.7), payload: HE, control: { mode: "lock_then_click" },
    steering: { turnRate: 8.9, maxG: 18 }, fits: FIT_HARDPOINT, notes: ["compact laser-guided fire-and-forget missile"],
  },
  mini_bomb: {
    id: "mini_bomb", name: "KINETIC SLUGS", fullName: "KINETIC DROP SLUGS", ammo: 24, fireCd: 0.5, speed: 180,
    dmg: 95, blast: 42, life: 5.5, kind: "guided-missile", look: ordLook("miniRocket"), scale: 0.58,
    guidance: NONE, launch: DROP, payload: { mode: "kinetic", penetration: 1.2 }, control: CLICK,
    gravity: GRAVITY, salvo: { count: 2, interval: 0.035, spread: 0.08 }, fits: FIT_BAY, notes: ["paired momentum-inheriting kinetic drop slugs"],
  },
};

export function playerLoadout(ids: readonly WpnId[]): PlayerWpnSpec[] {
  return ids.map((id) => PLAYER_WPNS[id] ?? PLAYER_WPNS.chain_gun!);
}

/** Resolve craft sockets into an ordered weapon loadout. */
export function playerLoadoutFromSockets(
  sockets: readonly { weapon: string }[]
): PlayerWpnSpec[] {
  return playerLoadout(sockets.map((s) => s.weapon));
}

/** Turret/cabin gun-body texture for a weapon, if it has one. */
export function weaponMountTex(wpnId: WpnId): string | undefined {
  return PLAYER_WPNS[wpnId]?.mount;
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
  angle: number;
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
  /** Seconds of EMP disable remaining: no movement, no firing. */
  empT?: number;
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
  readonly guidance: WeaponGuidance;
  readonly launch: WeaponLaunch;
  readonly payload: WeaponPayload;
  readonly control: WeaponControl;
  readonly steering?: WeaponSteering;
  readonly gravity?: WeaponGravity;
  /** Cruise speed the motor accelerates toward (spec.speed at launch). */
  readonly cruiseSpeed: number;
  /** Direct-hit damage of one sub-munition-free impact (spec.dmg at launch). */
  readonly dmg: number;
  readonly blast: number;
  /** Trail puff scale vs projectile draw scale. */
  readonly trailScale?: number;
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
  /** Persistent controllable drone. */
  drone?: boolean;
  /** Drone was commanded to detonate. */
  detonate?: boolean;
  /** Plasma strand phase and lateral sign. */
  helix?: number;
  helixSide?: number;
  helixOff?: number;
  /** Cluster / smoke payload already opened. */
  opened?: boolean;
  /** Remaining armor targets a penetrator can pass through. */
  pierce?: number;
  /** Units already damaged by this penetrator. */
  hitIds?: number[];
  /** Sub-munition (bomblet) — skips lock HUD and camera hand-off. */
  bomblet?: boolean;
}

/** Persistent LOS-blocking smoke screen produced by a smoke payload. */
export interface SmokeVolume {
  x: number;
  y: number;
  z: number;
  radius: number;
  /** Seconds remaining. */
  t: number;
  max: number;
  /** Emit accumulator so puff density is frame-rate independent. */
  puff: number;
}

/** Heat-seeker preference ordering: air > vehicles > buildings > troops. */
export type HeatClass = "air" | "vehicle" | "building" | "troop";

export function heatClassScore(c: HeatClass): number {
  return c === "air" ? 3 : c === "vehicle" ? 2 : c === "building" ? 1 : 0;
}

/** Guidance category a heat class reports to `WeaponGuidance.categories`. */
export function heatClassCategory(c: HeatClass): "air" | "ground" | "vehicle" {
  return c === "air" ? "air" : c === "vehicle" ? "vehicle" : "ground";
}

/** Snapshot the immutable flight profile of a player weapon at trigger time. */
export function shotBehaviorOf(spec: PlayerWpnSpec): ShotBehavior {
  return {
    guidance: spec.guidance,
    launch: spec.launch,
    payload: spec.payload,
    control: spec.control,
    steering: spec.steering,
    gravity: spec.gravity,
    cruiseSpeed: spec.speed,
    dmg: spec.dmg,
    blast: spec.blast,
    trailScale: spec.trailScale,
  };
}

/** True when guidance mode drives the lock HUD / seeker. */
export function guidanceUsesLock(
  g: WeaponGuidance
): g is Extract<WeaponGuidance, { mode: "laser" | "heat" | "command_nlos" }> {
  return g.mode === "laser" || g.mode === "heat" || g.mode === "command_nlos";
}

export interface Shot {
  kind: ShotKind;
  from: "player" | "enemy";
  /** Stable handle for shots the player keeps commanding (drone, NLOS terminal). */
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
  guided?: boolean;
  homePlayer?: boolean;
  motor?: number;
  cruise?: number;
  loft?: number;
  yaw?: number;
  look?: PlayerShotLook;
  /** Draw scale from weapon preset (× secondary mul when applicable). */
  scale?: number;
  /** Effective seconds per projectile, used only to scale muzzle and impact-spark density. */
  fxInterval?: number;
  wire?: { x: number; y: number; z: number }[];
  wireSide?: number;
  wireTrim?: number;
  /** While this player projectile is active, cap simulation speed to this multiplier. */
  warpTimeScale?: number;
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
  /** Draw under the firer (air craft). Ground casings omit this and draw above. */
  shellUnder?: boolean;
  /** Patrol/PT boat hull: surface sink (scale down) with pre-baked blue hulk. */
  boatSink?: boolean;
  /** Elapsed / total sink duration for scale progress. */
  sinkT?: number;
  sinkMax?: number;
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
