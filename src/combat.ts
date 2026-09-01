export type UnitKind =
  | "tank"
  | "soldier"
  | "heli"
  | "boat"
  | "tower"
  | "bunker"
  | "radar";

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
  rotor: number;
  track: number;
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
  tint: number;
  additive: boolean;
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
}

let nid = 1;
export function nextId(): number {
  return nid++;
}

export function stats(kind: UnitKind): { health: number; z: number } {
  switch (kind) {
    case "soldier":
      return { health: 18, z: 0 };
    case "tank":
      return { health: 90, z: 0 };
    case "boat":
      return { health: 70, z: 0 };
    case "tower":
      return { health: 110, z: 0 };
    case "bunker":
      return { health: 260, z: 0 };
    case "radar":
      return { health: 200, z: 0 };
    case "heli":
      return { health: 80, z: 48 };
  }
}

export function radius(kind: UnitKind): number {
  switch (kind) {
    case "soldier":
      return 10;
    case "tank":
      return 22;
    case "boat":
      return 24;
    case "tower":
      return 20;
    case "bunker":
      return 36;
    case "radar":
      return 32;
    case "heli":
      return 22;
  }
}

export function textureOf(kind: UnitKind): string {
  if (kind === "heli") return "enemy_heli";
  if (kind === "tank") return "tank_hull";
  return kind;
}

export function heightOf(kind: UnitKind): number {
  switch (kind) {
    case "soldier":
      return 9;
    case "tank":
      return 20;
    case "boat":
      return 16;
    case "tower":
      return 38;
    case "bunker":
      return 26;
    case "radar":
      return 34;
    case "heli":
      return 16;
  }
}

export function hulkOf(kind: UnitKind): string {
  return `hulk_${kind}`;
}

export const FRAG_KEYS = [
  "frag_0",
  "frag_1",
  "frag_2",
  "frag_3",
  "frag_4",
  "frag_5",
  "frag_6",
  "frag_7",
  "frag_8",
  "frag_9",
  "frag_10",
  "frag_11",
] as const;
