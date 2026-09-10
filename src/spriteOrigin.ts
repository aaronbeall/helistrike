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
  | "hardpoint"
  | "exhaust"
  | "muzzle";

export interface SpritePoint {
  role: SpritePointRole;
  x: number;
  y: number;
  /** Optional draw multiplier for a part mounted at this point. */
  scale?: number;
  /** Optional stable id when several points share a role. */
  id?: string;
  /**
   * Rotor spin when viewed from above: `1` = CW (Phaser+), `-1` = CCW.
   * Omit to use layout defaults (Western main = CCW).
   */
  spin?: 1 | -1;
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
 * Authored per-texture layout. Camo suffixes are stripped on lookup.
 * `_hulk` with no own entry inherits **origin only** from the live key — never
 * points (muzzles / mounts). List a hulk key explicitly to author its own.
 */
export const SPRITE_SPECS: Record<string, SpriteSpec> = {
  // —— Player craft ——
  craft_apache: {
    origin: uv(0.498, 0.453),
    points: [
      { role: "rotor", x: 0.498, y: 0.453 },
      { role: "gun", x: 0.497, y: 0.174 },
      // Wing hardpoints (left → right).
      ...pts("hardpoint", [uv(0.112, 0.448), uv(0.859, 0.445)]),
    ],
  },
  craft_apache_rotor: { origin: uv(0.5, 0.5) },
  craft_apache_rotor_hulk: { origin: uv(0.5, 0.5) },
  // Shared turret gun bodies (barrel-up); no swivel-track art.
  gun_gatling: { origin: uv(0.5, 0.7), points: [{ role: "muzzle", x: 0.5, y: 0.05 }] },
  gun_minigun: { origin: uv(0.5, 0.7), points: [{ role: "muzzle", x: 0.5, y: 0.05 }] },
  gun_machine: { origin: uv(0.425, 0.7), points: [{ role: "muzzle", x: 0.5, y: 0.06 }] },
  gun_artillery: { origin: uv(0.5, 0.7), points: [{ role: "muzzle", x: 0.5, y: 0.04 }] },
  gun_railgun: { origin: uv(0.5, 0.7), points: [{ role: "muzzle", x: 0.5, y: 0.04 }] },
  gun_plasma: { origin: uv(0.5, 0.7), points: [{ role: "muzzle", x: 0.5, y: 0.05 }] },
  gun_tesla: { origin: uv(0.5, 0.7), points: [{ role: "muzzle", x: 0.5, y: 0.05 }] },

  // —— Selectable craft (stub mounts — tune in sprite/roster rig) ——
  craft_littlebird: {
    origin: uv(0.5, 0.42),
    points: [
      { role: "rotor", x: 0.5, y: 0.42 },
      ...pts("muzzle", [uv(0.24, 0.38), uv(0.76, 0.38)], "wing"),
      ...pts("hardpoint", [uv(0.043, 0.386), uv(0.949, 0.384), uv(0.5, 0.42)]),
    ],
  },
  craft_quad_drone: {
    origin: uv(0.5, 0.58),
    points: [
      ...pts("rotor", [
        uv(0.074, 0.237),
        uv(0.925, 0.237),
        uv(0.074, 0.923),
        uv(0.925, 0.923),
      ], "quad"),
      ...pts("muzzle", [uv(0.31, 0.72), uv(0.69, 0.72)], "coil"),
      ...pts("hardpoint", [uv(0.24, 0.55), uv(0.76, 0.55)]),
    ],
  },
  craft_blackhawk: {
    origin: uv(0.486, 0.395),
    points: [
      { role: "rotor", x: 0.486, y: 0.395 },
      // ESSS stub-wing gun tips (outer pylon fronts).
      ...pts("muzzle", [uv(0.195, 0.405), uv(0.805, 0.405)], "wing"),
      // Crew-served door guns (L / R cabin).
      { role: "gun", x: 0.281, y: 0.264, id: "door_l" },
      { role: "gun", x: 0.706, y: 0.261, id: "door_r" },
      // Stub-wing stores (inner → outer feel; L / R).
      ...pts("hardpoint", [uv(0.155, 0.455), uv(0.845, 0.455)]),
    ],
  },
  craft_chinook: {
    origin: uv(0.5, 0.5),
    points: [
      ...pts("rotor", [uv(0.5, 0.144), uv(0.481, 0.815)], "tandem"),
      { role: "gun", x: 0.5, y: 0.14, id: "fwd" },
      { role: "gun", x: 0.5, y: 0.84, id: "ramp" },
      ...pts("hardpoint", [uv(0.24, 0.46), uv(0.76, 0.46), uv(0.5, 0.84)]),
    ],
  },
  craft_cobra: {
    origin: uv(0.5, 0.4),
    points: [
      { role: "rotor", x: 0.5, y: 0.4 },
      { role: "gun", x: 0.494, y: 0.112 },
      ...pts("hardpoint", [uv(0.227, 0.427), uv(0.772, 0.428)]),
    ],
  },
  craft_viper: {
    origin: uv(0.5, 0.49),
    points: [
      { role: "rotor", x: 0.5, y: 0.49 },
      { role: "gun", x: 0.494, y: 0.107 },
      ...pts("hardpoint", [uv(0.169, 0.451), uv(0.815, 0.451)]),
    ],
  },
  craft_osprey: {
    origin: uv(0.5, 0.5),
    points: [
      ...pts("rotor", [uv(0.06, 0.345), uv(0.937, 0.339)]),
      ...pts("gun", [uv(0.499, 0.41), uv(0.498, 0.938)], "gun"),
      ...pts("hardpoint", [uv(0.337, 0.48), uv(0.637, 0.48)]),
    ],
  },
  craft_stealthhawk: {
    origin: uv(0.5, 0.4),
    points: [
      { role: "rotor", x: 0.5, y: 0.4 },
      { role: "gun", x: 0.5, y: 0.16 },
      ...pts("hardpoint", [uv(0.22, 0.48), uv(0.78, 0.48)]),
    ],
  },
  craft_cyberhawk: {
    origin: uv(0.502, 0.538),
    points: [
      { role: "rotor", x: 0.502, y: 0.538, spin: -1 },
      { role: "rotor", x: 0.497, y: 0.9, scale: 0.34, id: "tail", spin: 1 },
      { role: "gun", x: 0.5, y: 0.17 },
      ...pts("hardpoint", [uv(0.18, 0.48), uv(0.82, 0.48)]),
      ...pts("exhaust", [uv(0.372, 0.646), uv(0.63, 0.647)]),
    ],
  },
  craft_cyberhawk_hulk: {
    origin: uv(0.492, 0.509),
  },
  craft_prometheus: {
    origin: uv(0.5, 0.5),
    points: [
      { role: "gun", x: 0.5, y: 0.72 },
      ...pts("hardpoint", [uv(0.153, 0.357), uv(0.836, 0.53)]),
      ...pts("exhaust", [uv(0.241, 0.777), uv(0.378, 0.863), uv(0.623, 0.866), uv(0.758, 0.781)]),
    ],
  },
  craft_gunship: {
    origin: uv(0.5, 0.5),
    points: [
      { role: "gun", x: 0.28, y: 0.45 },
      ...pts("rotor", [uv(0.185, 0.284), uv(0.322, 0.284), uv(0.671, 0.286), uv(0.811, 0.286)], "prop"),
      ...pts("hardpoint", [uv(0.418, 0.219), uv(0.415, 0.312), uv(0.417, 0.564)]),
    ],
  },
  craft_warthog: {
    origin: uv(0.5, 0.48),
    points: [
      { role: "gun", x: 0.5, y: 0.12 },
      ...pts("hardpoint", [uv(0.22, 0.5), uv(0.78, 0.5)]),
      ...pts("exhaust", [uv(0.408, 0.813), uv(0.585, 0.81)]),
    ],
  },
  craft_lightning_ii: {
    origin: uv(0.5, 0.56),
    points: [
      { role: "muzzle", x: 0.5, y: 0.045 },
      ...pts("hardpoint", [
        uv(0.06, 0.682),
        uv(0.22, 0.52),
        uv(0.37, 0.58),
        uv(0.63, 0.58),
        uv(0.78, 0.52),
        uv(0.945, 0.68),
      ]),
      ...pts("exhaust", [uv(0.499, 0.913)]),
    ],
  },

  craft_cyberhawk_rotor: { origin: uv(0.498, 0.459) },
  craft_cyberhawk_rotor_hulk: { origin: uv(0.481, 0.501) },
  craft_stealthhawk_rotor: { origin: uv(0.491, 0.491) },
  craft_stealthhawk_rotor_hulk: { origin: uv(0.449, 0.511) },
  craft_chinook_rotor: { origin: uv(0.5, 0.5) },
  craft_osprey_rotor: { origin: uv(0.5, 0.5) },
  craft_littlebird_rotor: { origin: uv(0.5, 0.5) },
  craft_viper_rotor: { origin: uv(0.5, 0.5) },
  craft_blackhawk_rotor: { origin: uv(0.5, 0.5) },
  craft_cobra_rotor: { origin: uv(0.5, 0.5) },

  // —— Enemy / building hulls ——
  enemy_heli: {
    origin: uv(0.497, 0.411),
    points: [
      { role: "rotor", x: 0.497, y: 0.411 },
      { role: "gun", x: 0.503, y: 0.142 },
      ...pts("hardpoint", [uv(0.16, 0.52), uv(0.84, 0.52)]),
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
      ...pts("rotor", [uv(0.5, 0.252), uv(0.5, 0.768)]),
      ...pts("gun", [uv(0.271, 0.412), uv(0.732, 0.415)]),
      ...pts("hardpoint", [uv(0.129, 0.578), uv(0.883, 0.574)]),
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
    origin: uv(0.5, 0.5),
    points: [{ role: "gun", x: 0.499, y: 0.476 }],
  },
  building_bunker: {
    points: pts("troop", [uv(0.38, 0.42), uv(0.62, 0.42), uv(0.5, 0.58)]),
  },
  building_radar: {
    points: [{ role: "dish", x: 0.608, y: 0.538 }],
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
  enemy_ptboat_gun_hulk: {
    origin: uv(0.49, 0.573),
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
  building_tower_aa_hulk: {
    origin: uv(0.499, 0.575),
  },
  building_tower_sam: {
    origin: uv(0.5, 0.78),
    points: [{ role: "muzzle", x: 0.5, y: 0.12 }],
  },
  building_tower_sam_hulk: {
    origin: uv(0.496, 0.598),
  },
  enemy_battleship_gun: {
    origin: uv(0.5, 0.68),
    points: pts("muzzle", [uv(0.346, 0.008), uv(0.629, 0.005)]),
  },
  enemy_battleship_gun_aa: {
    origin: uv(0.5, 0.72),
    points: [{ role: "muzzle", x: 0.5, y: 0.05 }],
  },
  enemy_battleship_gun_sam: {
    origin: uv(0.499, 0.583),
    points: pts("muzzle", [uv(0.323, 0.032), uv(0.672, 0.035)]),
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
  const own = SPRITE_SPECS[k];
  if (own) return own;
  if (!k.endsWith("_hulk")) return undefined;
  const live = SPRITE_SPECS[k.slice(0, -5)];
  if (!live?.origin) return undefined;
  // Origin-only inherit — wrecks must not pick up live muzzles / hull mounts.
  return { origin: live.origin, ...(live.originMode ? { originMode: live.originMode } : {}) };
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

/** Pivot UV; `_hulk` falls back to live origin when not authored. */
export function lookupSpriteOrigin(key: string): Uv | undefined {
  // Return shared refs — do not clone (hot path: spritePivot every unit/debris/frame).
  return resolveSpec(key)?.origin;
}

export function lookupSpritePoints(key: string, role?: SpritePointRole): SpritePoint[] {
  const ptsList = resolveSpec(key)?.points ?? [];
  if (!role) return ptsList;
  return ptsList.filter((p) => p.role === role);
}

export function lookupSpriteMuzzles(key: string): Uv[] {
  return lookupSpritePoints(key, "muzzle");
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
