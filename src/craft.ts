import { lookupSpriteOrigin, mountOf, mountsOf } from "./spriteOrigin";
import {
  numberMountLabels,
  type HullMount,
  type HullMountRole,
} from "./roster";

/**
 * Playable / selectable helicopter craft.
 * UV layout lives in SPRITE_SPECS for body/gun textures — craft only names textures
 * and gameplay fields. Pick via `selectCraft` / `craftOf(kind)`.
 */
export type CraftKind = "strike";

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
  /** Chin / turret gun texture. */
  gun: string;
  /** Optional rotor overlay texture (omit = procedural / shared rotor). */
  rotor?: string;
  /** Sprite nose-up offset (world aim 0 is +X). */
  rotOff: number;
}

/** Catalog of player-selectable craft (expand with scout / heavy / …). */
export const CRAFTS: Record<CraftKind, CraftSpec> = {
  strike: {
    kind: "strike",
    label: "STRIKE HELI",
    health: 100,
    radius: 20,
    height: 14,
    body: "heli_body",
    hulk: "heli_body_hulk",
    gun: "heli_gun",
    rotOff: Math.PI / 2,
  },
};

export const DEFAULT_CRAFT: CraftKind = "strike";

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

/** Craft whose body/gun/hulk texture matches `key` (bare, no camo suffix). */
export function craftByTexture(key: string): CraftSpec | undefined {
  const k = key.replace(/__(woodland|desert|urban|snow|digital)$/, "");
  return allCrafts().find((c) => c.body === k || c.hulk === k || c.gun === k);
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
