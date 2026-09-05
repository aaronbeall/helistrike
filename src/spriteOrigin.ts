/** Texture UV catalog — single source for origins, mounts, and muzzles. */

export type Uv = { x: number; y: number };

/**
 * Points on a texture. Roles match hull/rig vocabulary;
 * `muzzle` is emit tip on gun (or fixed-aim body) textures.
 */
export type SpritePointRole =
  | "gun"
  | "rotor"
  | "dish"
  | "troop"
  | "secondary"
  | "dmg"
  | "muzzle";

export interface SpritePoint {
  role: SpritePointRole;
  x: number;
  y: number;
  /** Optional stable id when several points share a role. */
  id?: string;
}

export interface SpriteSpec {
  /** Phaser pivot; omit → 0.5, 0.5. */
  origin?: Uv;
  /**
   * `cupola` = recomputed in prepareArt (tank turrets).
   * Seed origin is used until bake runs.
   */
  originMode?: "static" | "cupola";
  points?: SpritePoint[];
}

function uv(x: number, y: number): Uv {
  return { x, y };
}

function pts(role: SpritePointRole, list: Uv[], idPrefix?: string): SpritePoint[] {
  return list.map((p, i) => ({
    role,
    x: p.x,
    y: p.y,
    ...(idPrefix ? { id: `${idPrefix}${i}` } : list.length > 1 ? { id: `${role}${i}` } : {}),
  }));
}

/**
 * Authoritative per-texture layout. Camo suffixes are stripped on lookup;
 * `_hulk` inherits live key unless listed separately.
 */
export const SPRITE_SPECS: Record<string, SpriteSpec> = {
  // —— Player craft ——
  heli_body: {
    origin: uv(0.498, 0.453),
    points: [
      { role: "rotor", x: 0.498, y: 0.453 },
      { role: "gun", x: 0.497, y: 0.174 },
      // Wing hardpoints (left → right).
      ...pts("secondary", [uv(0.112, 0.448), uv(0.859, 0.445)]),
      ...pts("dmg", [
        uv(0.282, 0.434),
        uv(0.616, 0.868),
        uv(0.441, 0.715),
        uv(0.547, 0.496),
        uv(0.362, 0.58),
        uv(0.764, 0.479),
        uv(0.669, 0.288),
        uv(0.93, 0.417),
        uv(0.443, 0.164),
      ]),
    ],
  },
  heli_gun: {
    origin: uv(0.5, 0.7),
  },

  // —— Enemy / building hulls ——
  enemy_heli: {
    origin: uv(0.497, 0.411),
    points: [
      { role: "rotor", x: 0.497, y: 0.411 },
      { role: "gun", x: 0.503, y: 0.142 },
      ...pts("secondary", [uv(0.16, 0.52), uv(0.84, 0.52)]),
    ],
  },
  enemy_heli_small: {
    origin: uv(0.5, 0.42),
    points: [
      { role: "rotor", x: 0.5, y: 0.35 },
      // Fixed wing gun tips (Little Bird pylons) — alternating burst L/R.
      { role: "muzzle", x: 0.10, y: 0.38 },
      { role: "muzzle", x: 0.90, y: 0.38 },
    ],
  },
  enemy_heli_heavy: {
    points: [
      ...pts("rotor", [uv(0.505, 0.226), uv(0.508, 0.761)]),
      ...pts("gun", [uv(0.1, 0.541), uv(0.906, 0.54)]),
    ],
  },
  enemy_drone: {
    origin: uv(0.501, 0.448),
    points: pts("rotor", [
      uv(0.111, 0.126),
      uv(0.887, 0.124),
      uv(0.101, 0.884),
      uv(0.874, 0.875),
    ]),
  },
  enemy_tank: {
    points: [{ role: "gun", x: 0.499, y: 0.523 }],
  },
  enemy_lav: {
    points: [{ role: "gun", x: 0.502, y: 0.434 }],
  },
  enemy_sam: {
    points: [{ role: "gun", x: 0.499, y: 0.667 }],
  },
  enemy_boat: {
    points: [{ role: "gun", x: 0.493, y: 0.729 }],
  },
  enemy_ptboat: {
    points: [{ role: "gun", x: 0.493, y: 0.585 }],
  },
  enemy_pickup: {
    points: [{ role: "troop", x: 0.495, y: 0.801 }],
  },
  enemy_motorcycle: {
    origin: uv(0.5, 0.48),
  },
  enemy_battleship: {
    points: pts("gun", [
      uv(0.503, 0.229),
      uv(0.503, 0.599),
      uv(0.497, 0.7),
      uv(0.503, 0.808),
    ]),
  },
  building_tower: {
    origin: uv(0.512, 0.482),
    points: [{ role: "gun", x: 0.512, y: 0.482 }],
  },
  building_bunker: {
    points: pts("troop", [uv(0.38, 0.42), uv(0.62, 0.42), uv(0.5, 0.58)]),
  },
  building_radar: {
    points: [{ role: "dish", x: 0.511, y: 0.639 }],
  },
  building_lookout: {
    origin: uv(0.501, 0.394),
    points: [{ role: "troop", x: 0.49, y: 0.397 }],
  },

  // —— Guns / parts (origin + muzzle on this texture) ——
  enemy_tank_gun: {
    origin: uv(0.5, 0.78),
    originMode: "cupola",
    points: [{ role: "muzzle", x: 0.495, y: 0.006 }],
  },
  enemy_tank_gun_hulk: {
    origin: uv(0.5, 0.78),
    originMode: "cupola",
  },
  enemy_heli_gun: {
    origin: uv(0.5, 0.72),
    points: [{ role: "muzzle", x: 0.5, y: 0.08 }],
  },
  enemy_heli_heavy_gun: {
    origin: uv(0.5, 0.72),
    points: [{ role: "muzzle", x: 0.5, y: 0.08 }],
  },
  enemy_boat_gun: {
    origin: uv(0.488, 0.744),
    points: [{ role: "muzzle", x: 0.499, y: 0.039 }],
  },
  enemy_lav_gun: {
    origin: uv(0.496, 0.629),
    points: [{ role: "muzzle", x: 0.499, y: 0.039 }],
  },
  enemy_ptboat_gun: {
    origin: uv(0.496, 0.722),
    points: [{ role: "muzzle", x: 0.496, y: 0.068 }],
  },
  enemy_sam_gun: {
    origin: uv(0.499, 0.635),
    points: pts("muzzle", [uv(0.281, 0.051), uv(0.705, 0.049)]),
  },
  building_tower_gun: {
    origin: uv(0.495, 0.729),
    points: [{ role: "muzzle", x: 0.52, y: 0.039 }],
  },
  building_tower_aa: {
    origin: uv(0.5, 0.78),
    points: pts("muzzle", [
      uv(0.4, 0.13),
      uv(0.6, 0.13),
      uv(0.4, 0.27),
      uv(0.6, 0.27),
    ]),
  },
  building_tower_sam: {
    origin: uv(0.5, 0.78),
    points: [{ role: "muzzle", x: 0.5, y: 0.12 }],
  },
  enemy_battleship_gun: {
    origin: uv(0.5, 0.68),
    points: pts("muzzle", [uv(0.32, 0.06), uv(0.68, 0.06)]),
  },
  enemy_battleship_gun_aa: {
    origin: uv(0.5, 0.72),
    points: [{ role: "muzzle", x: 0.5, y: 0.05 }],
  },
  enemy_battleship_gun_sam: {
    origin: uv(0.5, 0.7),
    points: [{ role: "muzzle", x: 0.5, y: 0.12 }],
  },
  enemy_troop_soldier: {
    origin: uv(0.449, 0.647),
    points: [{ role: "muzzle", x: 0.656, y: 0.012 }],
  },
  enemy_troop_gunner: {
    origin: uv(0.398, 0.697),
    points: [{ role: "muzzle", x: 0.569, y: 0.014 }],
  },
  enemy_troop_rpg: {
    origin: uv(0.462, 0.627),
    points: [{ role: "muzzle", x: 0.78, y: 0.124 }],
  },
  enemy_troop_stinger: {
    origin: uv(0.452, 0.647),
    points: [{ role: "muzzle", x: 0.742, y: 0.073 }],
  },
  enemy_troop_mounted_mg: {
    origin: uv(0.5, 0.72),
    points: [{ role: "muzzle", x: 0.5, y: 0.06 }],
  },
};

export function bareSpriteKey(key: string): string {
  return key.replace(/__(woodland|desert|urban|snow|digital)$/, "");
}

function resolveSpec(key: string): SpriteSpec | undefined {
  const k = bareSpriteKey(key);
  if (SPRITE_SPECS[k]) return SPRITE_SPECS[k];
  if (k.endsWith("_hulk")) return SPRITE_SPECS[k.slice(0, -5)];
  return undefined;
}

/** Ensure a mutable spec entry exists (e.g. cupola bake writes origin). */
export function ensureSpriteSpec(key: string): SpriteSpec {
  const k = bareSpriteKey(key);
  if (!SPRITE_SPECS[k]) SPRITE_SPECS[k] = {};
  return SPRITE_SPECS[k]!;
}

export function setSpriteOrigin(key: string, origin: Uv): void {
  ensureSpriteSpec(key).origin = { ...origin };
}

export function spriteSpecOf(key: string): SpriteSpec | undefined {
  return resolveSpec(key);
}

export function allSpriteSpecs(): { key: string; spec: SpriteSpec }[] {
  return Object.entries(SPRITE_SPECS).map(([key, spec]) => ({ key, spec }));
}

/** Live-sprite origin; `_hulk` inherits live counterpart unless listed alone. */
export function lookupSpriteOrigin(key: string): Uv | undefined {
  const sp = resolveSpec(key);
  if (sp?.origin) return { ...sp.origin };
  return undefined;
}

export function lookupSpritePoints(key: string, role?: SpritePointRole): SpritePoint[] {
  const ptsList = resolveSpec(key)?.points ?? [];
  if (!role) return ptsList.map((p) => ({ ...p }));
  return ptsList.filter((p) => p.role === role).map((p) => ({ ...p }));
}

export function lookupSpriteMuzzles(key: string): Uv[] {
  return lookupSpritePoints(key, "muzzle").map((p) => ({ x: p.x, y: p.y }));
}

/** Mount UVs for a role (default: all non-muzzle points). */
export function lookupSpriteMounts(key: string, role?: SpritePointRole): Uv[] {
  const list = role
    ? lookupSpritePoints(key, role)
    : lookupSpritePoints(key).filter((p) => p.role !== "muzzle");
  return list.map((p) => ({ x: p.x, y: p.y }));
}

/** First mount of a role, or throw if missing. */
export function mountOf(key: string, role: SpritePointRole, index = 0): Uv {
  const list = lookupSpriteMounts(key, role);
  const hit = list[index];
  if (!hit) throw new Error(`mountOf(${key}, ${role}, ${index}): missing`);
  return { ...hit };
}

/** All mounts of a role (copy). */
export function mountsOf(key: string, role: SpritePointRole): Uv[] {
  return lookupSpriteMounts(key, role);
}
