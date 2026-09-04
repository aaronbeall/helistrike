export const SPRITE_ORIGIN: Record<string, { x: number; y: number }> = {
  building_tower: { x: 0.512, y: 0.482 },
  building_tower_gun: { x: 0.495, y: 0.729 },
  enemy_battleship_gun: { x: 0.5, y: 0.68 },
  enemy_battleship_gun_aa: { x: 0.5, y: 0.72 },
  enemy_battleship_gun_sam: { x: 0.5, y: 0.7 },
  building_tower_aa: { x: 0.5, y: 0.78 },
  building_tower_sam: { x: 0.5, y: 0.78 },
  enemy_heli_gun: { x: 0.5, y: 0.72 },
  enemy_heli_heavy_gun: { x: 0.5, y: 0.72 },
  enemy_boat_gun: { x: 0.488, y: 0.744 },
  enemy_drone: { x: 0.501, y: 0.448 },
  enemy_heli_small: { x: 0.493, y: 0.426 },
  enemy_lav_gun: { x: 0.496, y: 0.629 },
  enemy_ptboat_gun: { x: 0.496, y: 0.722 },
  enemy_sam_gun: { x: 0.499, y: 0.635 },
  enemy_troop_gunner: { x: 0.398, y: 0.697 },
  enemy_troop_rpg: { x: 0.462, y: 0.627 },
  enemy_troop_soldier: { x: 0.449, y: 0.647 },
  enemy_troop_stinger: { x: 0.452, y: 0.647 },
  enemy_motorcycle: { x: 0.5, y: 0.48 },
  enemy_troop_mounted_mg: { x: 0.5, y: 0.72 },
  building_lookout: { x: 0.501, y: 0.394 },
};

function bareKey(key: string): string {
  return key.replace(/__(woodland|desert|urban|snow|digital)$/, "");
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

/** Barrel tips: flashes and projectiles emit here (texture UV). Tower AA cycles 4; SAM gun has two tubes. */
export const SPRITE_MUZZLE: Record<string, Uv | readonly Uv[]> = {
  building_tower_gun: { x: 0.52, y: 0.039 },
  enemy_battleship_gun: [
    { x: 0.32, y: 0.06 },
    { x: 0.68, y: 0.06 },
  ],
  enemy_battleship_gun_aa: { x: 0.5, y: 0.05 },
  enemy_battleship_gun_sam: { x: 0.5, y: 0.12 },
  building_tower_aa: [
    { x: 0.40, y: 0.13 }, // front-left muzzle
    { x: 0.60, y: 0.13 }, // front-right muzzle
    { x: 0.40, y: 0.27 }, // rear-left muzzle
    { x: 0.60, y: 0.27 }, // rear-right muzzle
  ],
  building_tower_sam: { x: 0.5, y: 0.12 },
  enemy_heli_gun: { x: 0.5, y: 0.08 },
  enemy_heli_heavy_gun: { x: 0.5, y: 0.08 },
  enemy_boat_gun: { x: 0.499, y: 0.039 },
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
  enemy_troop_mounted_mg: { x: 0.5, y: 0.06 },
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

/** Body UV mounts for guns / rotors / dish / crew posts. */
export const SPRITE_MOUNT = {
  building_lookout: { x: 0.49, y: 0.397 },
  building_tower: { x: 0.512, y: 0.482 },
  building_bunker: [
    { x: 0.38, y: 0.42 },
    { x: 0.62, y: 0.42 },
    { x: 0.5, y: 0.58 },
  ],
  building_radar: { x: 0.511, y: 0.639 },
  enemy_battleship: [
    { x: 0.503, y: 0.229 },
    { x: 0.503, y: 0.599 },
    { x: 0.497, y: 0.7 },
    { x: 0.503, y: 0.808 },
  ],
  enemy_boat: { x: 0.493, y: 0.729 },
  enemy_drone: [
    { x: 0.111, y: 0.126 },
    { x: 0.887, y: 0.124 },
    { x: 0.101, y: 0.884 },
    { x: 0.874, y: 0.875 },
  ],
  enemy_heli: { x: 0.503, y: 0.142 },
  enemy_heli_pylon: [
    { x: 0.16, y: 0.52 },
    { x: 0.84, y: 0.52 },
  ],
  enemy_heli_heavy_rotor: [
    { x: 0.505, y: 0.226 },
    { x: 0.508, y: 0.761 },
  ],
  enemy_heli_heavy_gun: [
    { x: 0.1, y: 0.541 },
    { x: 0.906, y: 0.54 },
  ],
  enemy_lav: { x: 0.502, y: 0.434 },
  enemy_pickup: { x: 0.495, y: 0.801 },
  enemy_ptboat: { x: 0.493, y: 0.585 },
  enemy_sam: { x: 0.499, y: 0.667 },
  enemy_tank: { x: 0.499, y: 0.523 },
} as const;
