import { lookupSpriteOrigin, mountOf, mountsOf } from "./spriteOrigin";
import {
  numberMountLabels,
  type HullMount,
  type HullMountRole,
} from "./roster";

/**
 * Playable / selectable craft.
 * UV layout lives in SPRITE_SPECS for body/gun textures — craft only names textures
 * and gameplay fields. Pick via `selectCraft` / `craftOf(kind)`.
 */
export type CraftKind =
  | "apache"
  | "little_bird"
  | "cobra"
  | "osprey"
  | "stealthhawk"
  | "cyberhawk"
  | "prometheus"
  | "gunship"
  | "warthog";

export interface CraftSpec {
  kind: CraftKind;
  label: string;
  health: number;
  /** Collision / silhouette radius (roster marks / future). */
  radius: number;
  /** Collision / aim height (world units). */
  height: number;
  /** Body texture key. */
  body: string;
  hulk: string;
  /** Chin / turret gun texture (shared `heli_gun` for most). */
  gun: string;
  /**
   * Rotor / thruster overlay texture. Omit for fixed-wing (gunship / warthog).
   * Spin bake is `${rotor}_spin` when present.
   */
  rotor?: string;
  rotorHulk?: string;
  /** Sprite nose-up offset (world aim 0 is +X). */
  rotOff: number;
}

/** Catalog of player-selectable craft. */
export const CRAFTS: Record<CraftKind, CraftSpec> = {
  apache: {
    kind: "apache",
    label: "APACHE",
    health: 100,
    radius: 20,
    height: 14,
    body: "heli_body",
    hulk: "heli_body_hulk",
    gun: "heli_gun",
    rotor: "heli_rotor",
    rotorHulk: "heli_rotor_hulk",
    rotOff: Math.PI / 2,
  },
  little_bird: {
    kind: "little_bird",
    label: "LITTLE BIRD",
    health: 70,
    radius: 14,
    height: 10,
    body: "craft_littlebird",
    hulk: "craft_littlebird_hulk",
    gun: "heli_gun",
    rotor: "enemy_heli_rotor", // existing 5-blade
    rotorHulk: "enemy_heli_rotor_hulk",
    rotOff: Math.PI / 2,
  },
  cobra: {
    kind: "cobra",
    label: "COBRA",
    health: 95,
    radius: 18,
    height: 12,
    body: "craft_cobra",
    hulk: "craft_cobra_hulk",
    gun: "heli_gun",
    rotor: "craft_cobra_rotor",
    rotorHulk: "craft_cobra_rotor_hulk",
    rotOff: Math.PI / 2,
  },
  osprey: {
    kind: "osprey",
    label: "OSPREY",
    health: 140,
    radius: 36,
    height: 18,
    body: "craft_osprey",
    hulk: "craft_osprey_hulk",
    gun: "heli_gun",
    rotor: "craft_osprey_rotor",
    rotorHulk: "craft_osprey_rotor_hulk",
    rotOff: Math.PI / 2,
  },
  stealthhawk: {
    kind: "stealthhawk",
    label: "STEALTHHAWK",
    health: 110,
    radius: 22,
    height: 14,
    body: "craft_stealthhawk",
    hulk: "craft_stealthhawk_hulk",
    gun: "heli_gun",
    rotor: "heli_rotor", // existing 4-blade
    rotorHulk: "heli_rotor_hulk",
    rotOff: Math.PI / 2,
  },
  cyberhawk: {
    kind: "cyberhawk",
    label: "CYBERHAWK",
    health: 120,
    radius: 20,
    height: 14,
    body: "craft_cyberhawk",
    hulk: "craft_cyberhawk_hulk",
    gun: "heli_gun",
    rotor: "craft_cyberhawk_rotor",
    rotorHulk: "craft_cyberhawk_rotor_hulk",
    rotOff: Math.PI / 2,
  },
  prometheus: {
    kind: "prometheus",
    label: "PROMETHEUS",
    health: 130,
    radius: 26,
    height: 16,
    body: "craft_prometheus",
    hulk: "craft_prometheus_hulk",
    gun: "heli_gun",
    // No rotor — hover via energy FX later.
    rotOff: Math.PI / 2,
  },
  gunship: {
    kind: "gunship",
    label: "GUNSHIP",
    health: 180,
    radius: 48,
    height: 22,
    body: "craft_gunship",
    hulk: "craft_gunship_hulk",
    gun: "heli_gun",
    rotOff: Math.PI / 2,
  },
  warthog: {
    kind: "warthog",
    label: "WARTHOG",
    health: 150,
    radius: 32,
    height: 12,
    body: "craft_warthog",
    hulk: "craft_warthog_hulk",
    gun: "heli_gun",
    rotOff: Math.PI / 2,
  },
};

export const DEFAULT_CRAFT: CraftKind = "apache";

let selected: CraftKind = DEFAULT_CRAFT;

export function selectCraft(kind: CraftKind): void {
  selected = kind;
}

export function craftKind(): CraftKind {
  return selected;
}

/** Active craft, or a named one. */
export function craftOf(kind: CraftKind = selected): CraftSpec {
  return CRAFTS[kind];
}

export function allCrafts(): CraftSpec[] {
  return Object.values(CRAFTS);
}

export function allCraftKinds(): CraftKind[] {
  return Object.keys(CRAFTS) as CraftKind[];
}

/** Live rotor texture key, or undefined for fixed-wing. */
export function craftRotorTex(c: CraftSpec = craftOf()): string | undefined {
  return c.rotor;
}

/** Spin-disc texture for a craft rotor (when baked). */
export function craftRotorSpinTex(c: CraftSpec = craftOf()): string | undefined {
  return c.rotor ? `${c.rotor}_spin` : undefined;
}

/** Craft whose body/gun/hulk/rotor texture matches `key` (bare, no camo suffix). */
export function craftByTexture(key: string): CraftSpec | undefined {
  const k = key.replace(/__(woodland|desert|urban|snow|digital)$/, "");
  return allCrafts().find(
    (c) =>
      c.body === k ||
      c.hulk === k ||
      c.gun === k ||
      c.rotor === k ||
      c.rotorHulk === k
  );
}

/** Body origin from SPRITE_SPECS. */
export function craftOrigin(c: CraftSpec = craftOf()): { x: number; y: number } {
  return lookupSpriteOrigin(c.body) ?? { x: 0.5, y: 0.5 };
}

/** Chin gun attach UV on the body. */
export function craftGunMount(c: CraftSpec = craftOf()): { x: number; y: number } {
  return mountOf(c.body, "gun");
}

/** Pivot on the gun sprite. */
export function craftGunOrigin(c: CraftSpec = craftOf()): { x: number; y: number } {
  return lookupSpriteOrigin(c.gun) ?? { x: 0.5, y: 0.5 };
}

/** Damage-flame interest UVs on the body. */
export function craftDmgPois(c: CraftSpec = craftOf()): { x: number; y: number }[] {
  return mountsOf(c.body, "dmg");
}

/** Wing hardpoint UVs (missile / rocket / TOW) — left → right. */
export function craftSecondaryMounts(c: CraftSpec = craftOf()): { x: number; y: number }[] {
  return mountsOf(c.body, "secondary");
}

/** Pivot for a craft texture (body origin or gun origin). */
export function craftPivot(key: string): { x: number; y: number } | undefined {
  const k = key.replace(/__(woodland|desert|urban|snow|digital)$/, "");
  for (const c of allCrafts()) {
    if (c.body === k || c.hulk === k) return craftOrigin(c);
    if (c.gun === k) return craftGunOrigin(c);
  }
  return undefined;
}

/** Tagged hull mounts for a craft — from SPRITE_SPECS body points. */
export function craftMountsOf(sp: CraftSpec): HullMount[] {
  const roles: HullMountRole[] = ["gun", "rotor", "secondary", "dmg"];
  const tagged: HullMount[] = [];
  for (const role of roles) {
    for (const p of mountsOf(sp.body, role)) {
      tagged.push({ x: p.x, y: p.y, role, label: role });
    }
  }
  numberMountLabels(tagged);
  return tagged;
}
