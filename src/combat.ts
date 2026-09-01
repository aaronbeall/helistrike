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
  health: number;
  max: number;
  hv?: string;
  dead: boolean;
  fireCd: number;
  rotor: number;
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

export interface Frag {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  spin: number;
  life: number;
  key: string;
  settled: boolean;
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
  return kind;
}
