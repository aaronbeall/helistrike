/** Projectile / muzzle FX density scaling. */
import Phaser from "phaser";
import { type Shot, type PlayerWpnSpec } from "../sim/combat";

/** Apache M230 cadence is the full-density reference for per-shot muzzle/impact particles. */
export const PROJECTILE_FX_BASE_INTERVAL = 0.07;

export const ENEMY_PROJECTILE_FX_MUL = 0.72;

/** M230 chain gun — muzzle FX size reference (`spec.art.scale` / `blast`). */
export const MUZZLE_FX_REF_SCALE = 0.56;

export const MUZZLE_FX_REF_BLAST = 36;

export function projectileFxScale(from: Shot["from"], effectiveInterval = PROJECTILE_FX_BASE_INTERVAL): number {
  const cadence = Phaser.Math.Clamp(effectiveInterval / PROJECTILE_FX_BASE_INTERVAL, 0.18, 1);
  return cadence * (from === "enemy" ? ENEMY_PROJECTILE_FX_MUL : 1);
}

/** Player gun muzzle FX vs M230 — LMGs smaller, heavies a bit larger. */
export function playerMuzzleFxMul(spec: PlayerWpnSpec): number {
  const byScale = Math.pow(spec.art.scale / MUZZLE_FX_REF_SCALE, 0.7);
  const byBlast = Math.pow(Math.max(0.5, spec.blast) / MUZZLE_FX_REF_BLAST, 0.25);
  return Phaser.Math.Clamp(byScale * byBlast, 0.4, 1.35);
}

export function scaledProjectileFxCount(base: number, scale: number): number {
  return base <= 0 ? 0 : Math.max(1, Math.round(base * scale));
}
