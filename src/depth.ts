export const Layer = {
  TERRAIN: 0,
  WRECK: 1,
  SHADOW: 2,
  TRACK: 3,
  BLAST: 4,
  HULK: 5,
  WORLD: 100,
  FIELD: 4000,
  HUD: 8000,
} as const;

export const ZOff = {
  shot: -1.6,
  gun: -1.1,
  body: 0,
  muzzle: 3.4,
  dmg: 1.5,
  turret: 1.6,
  rotor: 2.5,
} as const;

export function worldDepth(z: number, off = 0): number {
  return Layer.WORLD + z + off;
}

export const Z_GRAVITY = 920;
