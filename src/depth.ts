import { Camera25D, camDepth } from "./world";

export const Layer = {
  TERRAIN: 0,
  WRECK: 1,
  SHADOW: 2,
  WORLD: 1000,
  FIELD: 4000,
  HUD: 8000,
} as const;

export const ZOff = {
  shot: -1.6,
  gun: -1.1,
  exhaust: -0.45,
  body: 0,
  smoke: 0.45,
  fire: 1.7,
  muzzle: -1,
  dmg: 1.5,
  turret: 1.6,
  rotor: 2.5,
  posted: 8,
} as const;

/** Painter depth from the same virtual camera used for position and scale. */
export function worldDepth(z: number, off = 0, y = Camera25D.focusY): number {
  return Layer.WORLD + Camera25D.focal - camDepth(z, y) + off;
}

export const Z_GRAVITY = 920;
