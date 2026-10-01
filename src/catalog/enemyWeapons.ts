/** Shared named enemy weapons. */
import type { WeaponSpec } from "../sim/roster";

export type EnemyWpnId = "he" | "mg" | "arty" | "aa" | "seeker" | "tower_cannon";

/**
 * Shared named enemy weapons — combat rig iterates this list.
 * Each `w` is a stable identity for usesOfWeapon / SPECS refs.
 */
export const ENEMY_WPNS: { id: EnemyWpnId; label: string; w: WeaponSpec }[] = [
  {
    id: "he",
    label: "HE SHELL",
    w: {
      kind: "cannon",
      fireCd: 0.9,
      range: 500,
      speed: 420,
      dmg: 8,
      blast: 16,
      look: "shot_cannon_enemy_he",
      scale: 0.72,
    },
  },
  {
    id: "mg",
    label: "LMG",
    w: {
      kind: "cannon",
      fireCd: 1.05,
      range: 280,
      speed: 380,
      dmg: 1,
      blast: 5,
      look: "shot_cannon_enemy_mg",
      scale: 0.5,
      burst: 3,
      burstGap: 0.075,
      jitter: 0.05,
    },
  },
  {
    id: "arty",
    label: "ARTY",
    w: {
      kind: "cannon",
      fireCd: 1.35,
      range: 860,
      speed: 480,
      dmg: 16,
      blast: 22,
      look: "shot_cannon_enemy_he",
      scale: 0.78,
      muzzleFire: "alternate",
    },
  },
  {
    id: "aa",
    label: "AA BURST",
    w: {
      kind: "cannon",
      fireCd: 3.1,
      range: 680,
      speed: 820,
      dmg: 1,
      blast: 3,
      look: "shot_cannon_enemy_aa",
      scale: 0.78,
      burst: 12,
      burstGap: 0.05,
      jitter: 0.04,
      muzzleFire: "alternate",
    },
  },
  {
    id: "seeker",
    label: "SEEKER",
    w: {
      kind: "lock-on-missile",
      fireCd: 2.8,
      range: 820,
      speed: 350,
      dmg: 18,
      blast: 22,
      look: "shot_laser_guided",
      scale: 1,
      trailScale: 0.55,
      jitter: 0.02,
      muzzleFire: "alternate",
    },
  },
  {
    id: "tower_cannon",
    label: "TOWER CANNON",
    w: {
      kind: "cannon",
      fireCd: 0.5,
      range: 700,
      speed: 920,
      dmg: 12,
      blast: 10,
      look: "shot_cannon_enemy_aa",
      scale: 0.7,
    },
  },
];

/** Stable refs into ENEMY_WPNS (`WPN.arty`, `WPN.aa`, …). */
export const WPN = Object.fromEntries(ENEMY_WPNS.map((p) => [p.id, p.w])) as {
  [K in EnemyWpnId]: WeaponSpec;
};

/** Fork a named preset (new object). */
export function wpn(id: EnemyWpnId, over: Partial<WeaponSpec> = {}): WeaponSpec {
  return { ...WPN[id], ...over };
}
