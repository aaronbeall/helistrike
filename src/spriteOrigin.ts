export const SPRITE_ORIGIN: Record<string, { x: number; y: number }> = {
  building_tower: { x: 0.499, y: 0.466 },
  building_tower_gun: { x: 0.495, y: 0.729 },
  enemy_battleship_gun: { x: 0.502, y: 0.694 },
  enemy_boat_gun: { x: 0.488, y: 0.744 },
  enemy_drone: { x: 0.501, y: 0.448 },
  enemy_heli_gun: { x: 0.499, y: 0.654 },
  enemy_heli_heavy_gun: { x: 0.497, y: 0.684 },
  enemy_heli_small: { x: 0.493, y: 0.426 },
  enemy_lav_gun: { x: 0.496, y: 0.629 },
  enemy_ptboat_gun: { x: 0.496, y: 0.722 },
  enemy_sam_gun: { x: 0.499, y: 0.635 },
  enemy_troop_gunner: { x: 0.398, y: 0.697 },
  enemy_troop_rpg: { x: 0.462, y: 0.627 },
  enemy_troop_soldier: { x: 0.449, y: 0.647 },
  enemy_troop_stinger: { x: 0.452, y: 0.647 },
};

function bareKey(key: string): string {
  return key.replace(/__(woodland|desert|urban|snow)$/, "");
}

/** Live-sprite origin; `_hulk` copies the live counterpart unless listed on its own. */
export function lookupSpriteOrigin(key: string): { x: number; y: number } | undefined {
  const k = bareKey(key);
  const hit = SPRITE_ORIGIN[k];
  if (hit) return hit;
  if (k.endsWith("_hulk")) return SPRITE_ORIGIN[k.slice(0, -5)];
  return undefined;
}

export type Uv = { x: number; y: number };

function asUvList(v: Uv | readonly Uv[] | undefined): Uv[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map((p) => ({ x: p.x, y: p.y }));
  const p = v as Uv;
  return [{ x: p.x, y: p.y }];
}

/** Barrel tips: flashes and projectiles emit here (texture UV). SAM has two tubes. */
export const SPRITE_MUZZLE: Record<string, Uv | readonly Uv[]> = {
  building_tower_gun: { x: 0.52, y: 0.039 },
  enemy_battleship_gun: { x: 0.493, y: 0.034 },
  enemy_boat_gun: { x: 0.499, y: 0.039 },
  enemy_heli_gun: { x: 0.499, y: 0.039 },
  enemy_heli_heavy_gun: { x: 0.499, y: 0.039 },
  enemy_lav_gun: { x: 0.499, y: 0.039 },
  enemy_ptboat_gun: { x: 0.496, y: 0.068 },
  enemy_sam_gun: [
    { x: 0.281, y: 0.051 },
    { x: 0.705, y: 0.049 },
  ],
  enemy_tank_gun: { x: 0.495, y: 0.006 },
  enemy_troop_gunner: { x: 0.569, y: 0.014 },
  enemy_troop_rpg: { x: 0.78, y: 0.124 },
  enemy_troop_soldier: { x: 0.656, y: 0.012 },
  enemy_troop_stinger: { x: 0.742, y: 0.073 },
  enemy_heli_small: { x: 0.498, y: 0.22 },
};

export function lookupSpriteMuzzles(key: string): Uv[] {
  const k = bareKey(key);
  const hit = SPRITE_MUZZLE[k] ?? (k.endsWith("_hulk") ? SPRITE_MUZZLE[k.slice(0, -5)] : undefined);
  return asUvList(hit);
}

export function lookupSpriteMounts(key: string): Uv[] {
  const k = bareKey(key);
  const out: Uv[] = [];
  const add = (p: Uv) => {
    if (!out.some((q) => Math.abs(q.x - p.x) < 1e-4 && Math.abs(q.y - p.y) < 1e-4)) out.push({ x: p.x, y: p.y });
  };
  const rec = SPRITE_MOUNT as Record<string, Uv | readonly Uv[]>;
  asUvList(rec[k]).forEach(add);
  if (k === "enemy_heli_heavy") {
    asUvList(SPRITE_MOUNT.enemy_heli_heavy_rotor).forEach(add);
    asUvList(SPRITE_MOUNT.enemy_heli_heavy_gun).forEach(add);
  }
  return out;
}

/** Body UV mounts for guns / rotors / dish. Lookout mount is the troop post. Pickup is reserved (no gun yet). */
export const SPRITE_MOUNT = {
  building_lookout: { x: 0.49, y: 0.397 },
  building_radar: { x: 0.511, y: 0.639 },
  enemy_battleship: [
    { x: 0.494, y: 0.238 },
    { x: 0.496, y: 0.587 },
    { x: 0.494, y: 0.684 },
    { x: 0.494, y: 0.784 },
  ],
  enemy_heli_heavy_rotor: [
    { x: 0.498, y: 0.245 },
    { x: 0.498, y: 0.726 },
  ],
  enemy_heli_heavy_gun: [
    { x: 0.365, y: 0.52 },
    { x: 0.633, y: 0.513 },
  ],
  enemy_lav: { x: 0.502, y: 0.434 },
  enemy_pickup: { x: 0.495, y: 0.801 },
  enemy_ptboat: { x: 0.493, y: 0.585 },
  enemy_sam: { x: 0.499, y: 0.667 },
  enemy_tank: { x: 0.499, y: 0.523 },
} as const;
