import { specOf, type DebrisCat, type MuzzleFireMode, type ShotKind, type ShotLook, type UnitKind, type PartMount } from "./roster";
import type { CamoKind } from "./camo";

export type { DebrisCat, UnitKind } from "./roster";

/** Tip-biased UV origin for all projectile art (nose-along-+X). */
export const SHOT_ORIGIN = { x: 0.84, y: 0.5 } as const;

/** Exhaust / trail emit UV (rear of projectile art, nose-along-+X). */
export const SHOT_TAIL = { x: 0.06, y: 0.5 } as const;

/** Player loadout identity (slot / catalog key). */
export type WpnId = string;

/** Player loadout — shared by fire logic and the combat config browser. */
export interface PlayerWpnSpec {
  /** Loadout identity (slot / catalog). May diverge from `kind` (e.g. upgraded cannon). */
  id: WpnId;
  name: string;
  fullName: string;
  ammo: number;
  fireCd: number;
  /** Launch / ballistic speed (hellfire/tow use kick then motor). */
  speed: number;
  dmg: number;
  blast: number;
  life: number;
  /** Flight / seek behavior (`ShotKind`). */
  kind: ShotKind;
  /** Projectile texture key. */
  look: ShotLook;
  /** Projectile draw scale. */
  scale: number;
  fixed?: boolean;
  silent?: boolean;
  beam?: boolean;
  warpTimeScale?: number;
  /** Explicit policy for authored multi-muzzle craft weapons. */
  muzzleFire?: MuzzleFireMode;
  notes: string[];
}

export const PLAYER_WPNS: Record<WpnId, PlayerWpnSpec> = {
  cannon: {
    id: "cannon",
    name: "M230 CHAIN",
    fullName: "M230 30MM CHAIN GUN",
    ammo: 1200,
    fireCd: 0.07,
    speed: 780,
    dmg: 8,
    blast: 18,
    life: 0.08,
    kind: "cannon",
    look: "shot_chain",
    scale: 0.58,
    notes: [
      "spread ±0.04 rad",
      "air life +0.55",
      "muzzle sparks n6 220–520 tight0.9",
      "tracer emit ×5",
      "muzzle flash sc 0.78 life 0.1",
    ],
  },
  rocket: {
    id: "rocket",
    name: "HYDRA PODS",
    fullName: "HYDRA 70 ROCKET PODS",
    ammo: 38,
    fireCd: 0.22,
    speed: 620,
    dmg: 110,
    blast: 140,
    life: 0.08,
    kind: "rocket",
    look: "shot_rocket",
    scale: 1,
    notes: ["ballistic to aim", "missile muzzle n12 200–520", "HE explode"],
  },
  hellfire: {
    id: "hellfire",
    name: "HELLFIRE",
    fullName: "AGM-114 HELLFIRE",
    ammo: 8,
    fireCd: 0.55,
    speed: 380,
    dmg: 185,
    blast: 175,
    life: 4.9,
    kind: "hellfire",
    look: "shot_hellfire",
    scale: 1,
    notes: [
      "kick speed then motor burn",
      "lock acquire 0.5s  pick r160",
      "ignite delay MISSILE_IGNITE",
      "seek delay 0.42 after ignite",
      "accel 520+burn*260  steer 7.4",
    ],
  },
  tow: {
    id: "tow",
    name: "TOW WIRE",
    fullName: "BGM-71 TOW MISSILE",
    ammo: 6,
    fireCd: 1.1,
    speed: 400,
    dmg: 170,
    blast: 160,
    life: 5.2,
    kind: "tow",
    look: "shot_tow",
    scale: 1,
    notes: [
      "guided wire  cruise 300",
      "ignite MISSILE_IGNITE+0.06",
      "turn ±2.2  vz follow ×3.2",
      "wire simulation",
    ],
  },
  minigun: {
    id: "minigun", name: "WING MINIGUNS", fullName: "DUAL M134D MINIGUNS", ammo: 2400, fireCd: 0.038, speed: 940,
    dmg: 4.5, blast: 10, life: 0.08, kind: "cannon", look: "shot_chain", scale: 0.42,
    fixed: true, muzzleFire: "simultaneous", notes: ["fixed forward", "dual-fire wing guns"],
  },
  quad_dual_gun: {
    id: "quad_dual_gun", name: "DUAL 12.7MM", fullName: "MX-12 TWIN 12.7MM REPEATERS", ammo: 1800, fireCd: 0.05, speed: 1000,
    dmg: 5, blast: 8, life: 0.09, kind: "cannon", look: "shot_small", scale: 0.42,
    fixed: true, muzzleFire: "simultaneous", notes: ["fixed twin coil repeaters", "simultaneous fire"],
  },
  quad_micro_rocket: {
    id: "quad_micro_rocket", name: "MICRO ROCKETS", fullName: "MR-4 MICRO ROCKET ARRAY", ammo: 48, fireCd: 0.16, speed: 690,
    dmg: 65, blast: 80, life: 0.08, kind: "rocket", look: "shot_rocket", scale: 0.58,
    notes: ["compact rapid rocket cells"],
  },
  quad_micro_missile: {
    id: "quad_micro_missile", name: "MICRO SEEKERS", fullName: "MS-9 MICRO SEEKER ARRAY", ammo: 20, fireCd: 0.35, speed: 430,
    dmg: 115, blast: 110, life: 4.4, kind: "hellfire", look: "shot_hellfire", scale: 0.62,
    notes: ["lightweight lock-on seeker swarm"],
  },
  quad_guided_charge: {
    id: "quad_guided_charge", name: "GUIDED CHARGE", fullName: "GC-1 GUIDED DEMOLITION CHARGE", ammo: 12, fireCd: 0.75, speed: 430,
    dmg: 135, blast: 125, life: 4.8, kind: "tow", look: "shot_tow", scale: 0.68,
    notes: ["reticle-guided compact demolition charge"],
  },
  m197: {
    id: "m197", name: "M197 20MM", fullName: "M197 20MM THREE-BARREL CANNON", ammo: 750, fireCd: 0.085, speed: 860,
    dmg: 11, blast: 17, life: 0.09, kind: "cannon", look: "shot_small", scale: 0.62,
    notes: ["three-barrel turret cannon"],
  },
  door_gun: {
    id: "door_gun", name: "RAMP MINIGUN", fullName: "M134D RAMP-MOUNTED MINIGUN", ammo: 2200, fireCd: 0.052, speed: 900,
    dmg: 7, blast: 12, life: 0.09, kind: "cannon", look: "shot_chain", scale: 0.52,
    notes: ["high-volume defensive gun"],
  },
  blackhawk_minigun: {
    id: "blackhawk_minigun", name: "M134 MINIGUN", fullName: "M134D DOOR-MOUNTED MINIGUN", ammo: 2600, fireCd: 0.045, speed: 920,
    dmg: 7.5, blast: 12, life: 0.09, kind: "cannon", look: "shot_chain", scale: 0.52,
    notes: ["Black Hawk door-mounted minigun"],
  },
  chinook_minigun: {
    id: "chinook_minigun", name: "M134 DOOR GUN", fullName: "M134D DOOR-MOUNTED MINIGUN", ammo: 2600, fireCd: 0.048, speed: 920,
    dmg: 7.5, blast: 12, life: 0.09, kind: "cannon", look: "shot_chain", scale: 0.52,
    notes: ["Chinook defensive door minigun"],
  },
  chinook_50cal: {
    id: "chinook_50cal", name: "M2HB .50 CAL", fullName: "M2HB .50 CAL MACHINE GUN", ammo: 900, fireCd: 0.105, speed: 980,
    dmg: 15, blast: 18, life: 0.11, kind: "cannon", look: "shot_shell", scale: 0.66,
    notes: ["heavy defensive door gun"],
  },
  chinook_m240: {
    id: "chinook_m240", name: "M240D DOOR GUN", fullName: "M240D 7.62MM DOOR GUN", ammo: 2200, fireCd: 0.068, speed: 880,
    dmg: 6.5, blast: 10, life: 0.08, kind: "cannon", look: "shot_small", scale: 0.46,
    notes: ["medium defensive machine gun"],
  },
  chinook_ramp_gun: {
    id: "chinook_ramp_gun", name: "M240H RAMP GUN", fullName: "M240H 7.62MM RAMP GUN", ammo: 2200, fireCd: 0.072, speed: 880,
    dmg: 6.5, blast: 10, life: 0.08, kind: "cannon", look: "shot_small", scale: 0.46,
    notes: ["rear-ramp defensive machine gun"],
  },
  silenced_autocannon: {
    id: "silenced_autocannon", name: "SILENCED 20MM", fullName: "XM20 SUPPRESSED AUTOCANNON", ammo: 900, fireCd: 0.11, speed: 880,
    dmg: 13, blast: 15, life: 0.1, kind: "cannon", look: "shot_small", scale: 0.62,
    silent: true, notes: ["low flash", "no casing ejection"],
  },
  laser: {
    id: "laser", name: "LASER BEAM", fullName: "CHL-1 COHERENT LASER", ammo: 600, fireCd: 0.16, speed: 1600,
    dmg: 28, blast: 8, life: 0.04, kind: "cannon", look: "shot_aa", scale: 0.5,
    beam: true, notes: ["instant coherent beam", "no ballistic drop"],
  },
  gau8: {
    id: "gau8", name: "GAU-8 AVENGER", fullName: "GAU-8/A AVENGER 30MM CANNON", ammo: 1150, fireCd: 0.055, speed: 1180,
    dmg: 18, blast: 24, life: 0.12, kind: "cannon", look: "shot_shell", scale: 0.78,
    fixed: true, notes: ["fixed nose gun", "heavy armor penetration"],
  },
  f35_gau22: {
    id: "f35_gau22", name: "GAU-22/A", fullName: "GAU-22/A 25MM CANNON", ammo: 500, fireCd: 0.07, speed: 1120,
    dmg: 14, blast: 18, life: 0.11, kind: "cannon", look: "shot_shell", scale: 0.66,
    fixed: true, notes: ["internal fixed forward cannon"],
  },
  f35_aim9x: {
    id: "f35_aim9x", name: "AIM-9X", fullName: "AIM-9X SIDEWINDER", ammo: 16, fireCd: 0.28, speed: 500,
    dmg: 125, blast: 105, life: 5, kind: "hellfire", look: "shot_hellfire", scale: 0.66,
    notes: ["short-range high-agility seeker"],
  },
  f35_aim120: {
    id: "f35_aim120", name: "AIM-120", fullName: "AIM-120 AMRAAM", ammo: 20, fireCd: 0.42, speed: 480,
    dmg: 175, blast: 145, life: 5.6, kind: "hellfire", look: "shot_hellfire", scale: 0.78,
    notes: ["long-range radar-guided missile"],
  },
  f35_jassm: {
    id: "f35_jassm", name: "JASSM", fullName: "AGM-158 JASSM", ammo: 12, fireCd: 0.8, speed: 440,
    dmg: 230, blast: 205, life: 5.8, kind: "tow", look: "shot_tow", scale: 1.05,
    notes: ["reticle-guided standoff missile"],
  },
  gunship_minigun: {
    id: "gunship_minigun", name: "GAU-19", fullName: "GAU-19/A .50 CAL GATLING GUN", ammo: 2800, fireCd: 0.06, speed: 960,
    dmg: 9, blast: 14, life: 0.1, kind: "cannon", look: "shot_chain", scale: 0.62,
    notes: ["gunship rapid fire"],
  },
  gunship_40mm: {
    id: "gunship_40mm", name: "40MM BOFORS", fullName: "L/60 40MM BOFORS CANNON", ammo: 90, fireCd: 0.32, speed: 680,
    dmg: 85, blast: 95, life: 0.18, kind: "cannon", look: "shot_shell", scale: 1.05,
    notes: ["gunship explosive cannon"],
  },
  gunship_105mm: {
    id: "gunship_105mm", name: "105MM HOWITZER", fullName: "M102 105MM HOWITZER", ammo: 24, fireCd: 1.15, speed: 540,
    dmg: 260, blast: 230, life: 0.22, kind: "cannon", look: "shot_shell", scale: 1.45,
    notes: ["gunship heavy cannon"],
  },
  gunship_missile: {
    id: "gunship_missile", name: "GRIFFIN", fullName: "AGM-176 GRIFFIN MISSILE", ammo: 12, fireCd: 0.7, speed: 410,
    dmg: 170, blast: 155, life: 4.5, kind: "hellfire", look: "shot_hellfire", scale: 0.85,
    notes: ["guided gunship missile"],
  },
  plasma_helix: {
    id: "plasma_helix", name: "PLASMA HELIX", fullName: "PHX-7 PLASMA HELIX CANNON", ammo: 1800, fireCd: 0.075, speed: 1050,
    dmg: 15, blast: 22, life: 0.1, kind: "cannon", look: "shot_aa", scale: 0.72,
    fixed: true, notes: ["paired alien plasma helix"],
  },
  photon: {
    id: "photon", name: "PHOTON MISSILE", fullName: "PM-4 PHOTON SEEKER MISSILE", ammo: 12, fireCd: 0.42, speed: 460,
    dmg: 210, blast: 185, life: 5.2, kind: "hellfire", look: "shot_hellfire", scale: 0.92,
    notes: ["photon seeker"],
  },
  refractor: {
    id: "refractor", name: "REFRACTOR CANNON", fullName: "RC-12 REFRACTOR CANNON", ammo: 44, fireCd: 0.16, speed: 760,
    dmg: 125, blast: 150, life: 0.1, kind: "rocket", look: "shot_rocket", scale: 0.86,
    notes: ["rapid refractive bolts"],
  },
  warp_bomb: {
    id: "warp_bomb", name: "WARP BOMB", fullName: "WB-1 GUIDED WARP BOMB", ammo: 4, fireCd: 1.4, speed: 330,
    dmg: 340, blast: 290, life: 6.2, kind: "tow", look: "shot_tow", scale: 1.3,
    warpTimeScale: 0.12, notes: ["guided warp payload", "extreme time dilation in flight"],
  },
};

/** Active player loadout order (HUD slots / fire index). */
export const WPN_LIST: { id: WpnId; kind: ShotKind; name: string; fullName: string; ammo: number }[] =
  ["cannon", "rocket", "hellfire", "tow"].map((id) => {
    const w = PLAYER_WPNS[id]!;
    return { id: w.id, kind: w.kind, name: w.name, fullName: w.fullName, ammo: w.ammo };
  });

export function playerLoadout(ids: readonly WpnId[]): PlayerWpnSpec[] {
  return ids.map((id) => PLAYER_WPNS[id] ?? PLAYER_WPNS.cannon!);
}

/** Shared missile timing (player hellfire / TOW). */
export const MISSILE_IGNITE = 0.525;
export const HELLFIRE_LOCK_T = 0.5;
export const HELLFIRE_SEEK_DELAY = 0.42;

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

export interface Shot {
  kind: ShotKind;
  from: "player" | "enemy";
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
  look?: ShotLook;
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
