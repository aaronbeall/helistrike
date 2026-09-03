import { specOf, type FragCat, type TracerStyle, type UnitKind, type PartMount } from "./roster";
import type { CamoKind } from "./camo";

export type { FragCat, UnitKind } from "./roster";

export type Wpn = "cannon" | "rocket" | "hellfire" | "tow";

export const WPN_LIST: { id: Wpn; name: string; ammo: number }[] = [
  { id: "cannon", name: "M230 CHAIN", ammo: Infinity },
  { id: "rocket", name: "HYDRA PODS", ammo: 38 },
  { id: "hellfire", name: "HELLFIRE", ammo: 8 },
  { id: "tow", name: "TOW WIRE", ammo: 6 },
];

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
  pinId?: number;
  camo?: CamoKind;
  strike?: number;
  parts?: PartMount[];
  missileCd?: number;
  missileSide?: number;
  killDx?: number;
  killDy?: number;
}

export interface Shot {
  kind: Wpn;
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
  tracer?: TracerStyle;
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
  scale?: number;
  trailSoft?: boolean;
  trailFade?: number;
  trailFadeMax?: number;
  linger?: boolean;
  wobble?: number;
  wobFreq?: number;
  wobAmp?: number;
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

export const FRAG_KEYS = fragKeys("tank");
