import { specOf, type FragCat, type ShotKind, type ShotLook, type UnitKind, type PartMount } from "./roster";
import type { CamoKind } from "./camo";

export type { FragCat, UnitKind } from "./roster";

/** Player loadout identity (slot / catalog key). */
export type WpnId = string;

/** Player loadout — shared by fire logic and the combat config browser. */
export interface PlayerWpnSpec {
  /** Loadout identity (slot / catalog). May diverge from `kind` (e.g. upgraded cannon). */
  id: WpnId;
  name: string;
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
  notes: string[];
}

export const PLAYER_WPNS: Record<WpnId, PlayerWpnSpec> = {
  cannon: {
    id: "cannon",
    name: "M230 CHAIN",
    ammo: Infinity,
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
};

/** Active player loadout order (HUD slots / fire index). */
export const WPN_LIST: { id: WpnId; kind: ShotKind; name: string; ammo: number }[] = Object.values(PLAYER_WPNS).map(
  (w) => ({ id: w.id, kind: w.kind, name: w.name, ammo: w.ammo })
);

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
  /** Indices into live damage interest points (center, guns, rotors). */
  dmgSites?: { poi: number; scale: number }[];
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
  wire?: { x: number; y: number; z: number }[];
  wireSide?: number;
  wireTrim?: number;
}

export type SparkKind = "flame" | "spark" | "dirt" | "splash";

export interface Spark {
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
  kind: SparkKind;
  tex: string;
  frame: number;
  angJit: number;
  spin: number;
  tint: number;
  additive: boolean;
  heading: number;
  streak?: boolean;
  dart?: boolean;
  blood?: boolean;
  /** Blood particle already painted a multiply stain onto the terrain. */
  stamped?: boolean;
  shock?: boolean;
  straight?: boolean;
  ox?: number;
  oy?: number;
  swirl?: number;
}

export interface Frag {
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
  trailOnly?: boolean;
  trailR: number;
  /** Local flame attach offset in unrotated frag space; orbits as the piece spins. */
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
  rotorFlames?: boolean;
  /** Local blade offsets (fraction of rotorSpan) for extra flame points. */
  bladeOffs?: number[];
  rotorSpan?: number;
  /** Local burn points on a thrown part (e.g. radar dish), in unrotated frag space. */
  flamePts?: { lx: number; ly: number; sc: number }[];
  /** Match live radar dish foreshortening (scaleY squash). */
  dishFlat?: boolean;
  /** Strong air drag for spinning rotor debris. */
  rotorThrow?: boolean;
  /** Rotor stays on the falling hull mount instead of flying off. */
  pinHost?: Frag;
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

export function fragCat(kind: UnitKind): FragCat {
  return specOf(kind).frag;
}

export function fragKeys(kind: UnitKind): string[] {
  const cat = fragCat(kind);
  return Array.from({ length: 12 }, (_, i) => `fx_frag_${cat}_${i}`);
}

export function wheelFragKeys(): string[] {
  return Array.from({ length: 4 }, (_, i) => `fx_frag_wheel_${i}`);
}
