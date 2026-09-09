import type Phaser from "phaser";
import { craftOf, craftPivot } from "./craft";
import { lookupSpriteOrigin, setSpriteOrigin } from "./spriteOrigin";

const SRC = {
  heli: "sprites/units/heli-player-nrotor.png",
  enemy: "sprites/units/heli-enemy-nrotor.png",
  tankParts: "sprites/units/tank-parts.png",
  bunker: "sprites/units/bunker.png",
  bunkerHulk: "sprites/units/bunker-hulk.png",
  rock: "sprites/units/rock.png",
  debrisMech: "sprites/debris/mech.png",
  debrisStruct: "sprites/debris/struct.png",
  debrisOrganic: "sprites/debris/organic.png",
  debrisWheels: "sprites/debris/wheels.png",
  tankWreck: "sprites/units/tank-wreck-parts.png",
  blasts: "sprites/fx/blasts.png",
  rotors: "sprites/units/rotors.png",
  vehicles: "sprites/units/vehicles.png",
  troops: "sprites/units/troops.png",
  buildings: "sprites/units/buildings.png",
  airShip: "sprites/units/air-ship.png",
  vehiclesHulk: "sprites/units/vehicles-hulk.png",
  buildingsHulk: "sprites/units/buildings-hulk.png",
  airShipHulk: "sprites/units/air-ship-hulk.png",
  troopsHulk: "sprites/units/troops-hulk.png",
  towerGuns: "sprites/units/tower-guns.png",
  towerGunsHulk: "sprites/units/tower-guns-hulk.png",
  rotorsHulk: "sprites/units/rotors-hulk.png",
  motoMg: "sprites/units/moto-mg.png",
  motoMgHulk: "sprites/units/moto-mg-hulk.png",
  radarDish: "sprites/units/radar-dish.png",
  radarDishHulk: "sprites/units/radar-dish-hulk.png",
} as const;

/**
 * Unit / building / gun parts that used to live in sparse sheets — one PNG per key.
 */
const UNIT_PART_ART: readonly { key: string; size: number; hulk?: boolean }[] = [
  { key: "enemy_boat", size: 92 },
  { key: "building_tower", size: 78 },
  { key: "enemy_boat_gun", size: 36 },
  { key: "building_tower_gun", size: 52 },
  { key: "building_radar", size: 220 },
  { key: "enemy_lav_gun", size: 40 },
  { key: "enemy_sam_gun", size: 48 },
  { key: "enemy_ptboat_gun", size: 32 },
  { key: "enemy_battleship_gun", size: 52 },
  { key: "enemy_battleship_gun_aa", size: 44 },
  { key: "enemy_battleship_gun_sam", size: 48 },
  { key: "enemy_heli_gun", size: 36 },
  { key: "enemy_heli_heavy_gun", size: 48 },
  { key: "enemy_drone_rotor", size: 14 },
  { key: "enemy_boat_hulk", size: 88, hulk: true },
  { key: "building_tower_hulk", size: 78, hulk: true },
  { key: "enemy_boat_gun_hulk", size: 36, hulk: true },
  { key: "building_tower_gun_hulk", size: 52, hulk: true },
  { key: "building_radar_hulk", size: 210, hulk: true },
  { key: "enemy_lav_gun_hulk", size: 40, hulk: true },
  { key: "enemy_sam_gun_hulk", size: 48, hulk: true },
  { key: "enemy_ptboat_gun_hulk", size: 32, hulk: true },
  { key: "enemy_battleship_gun_hulk", size: 52, hulk: true },
  { key: "enemy_battleship_gun_aa_hulk", size: 44, hulk: true },
  { key: "enemy_battleship_gun_sam_hulk", size: 48, hulk: true },
  { key: "enemy_heli_gun_hulk", size: 36, hulk: true },
  { key: "enemy_heli_heavy_gun_hulk", size: 48, hulk: true },
];


/**
 * Shared ordnance projectile PNGs (nose-up, magenta key) under `public/sprites/shots/`.
 * Multiple weapons map onto these looks. Cannon tracers are baked at runtime.
 */
export const PLAYER_ORDNANCE_SHOT_ART: readonly { look: string; size: number }[] = [
  { look: "shot_rocket", size: 28 },
  { look: "shot_laser_guided", size: 36 },
  { look: "shot_guided", size: 34 },
  { look: "shot_missile", size: 26 },
  { look: "shot_aam", size: 30 },
  { look: "shot_mini_rocket", size: 22 },
  { look: "shot_long", size: 34 },
  { look: "shot_bomb", size: 44 },
  { look: "shot_canister", size: 32 },
];

/**
 * Shared player turret gun bodies (barrel-up, magenta key) under `public/sprites/guns/`.
 * Weapons map onto these via `PlayerWpnSpec.mount` in combat.ts — no swivel track art.
 */
export const PLAYER_GUN_MOUNT_ART: readonly { key: string; size: number }[] = [
  { key: "gun_gatling", size: 52 },
  { key: "gun_minigun", size: 40 },
  { key: "gun_machine", size: 38 },
  { key: "gun_artillery", size: 56 },
  { key: "gun_railgun", size: 52 },
  { key: "gun_plasma", size: 50 },
  { key: "gun_tesla", size: 48 },
];

/**
 * Selectable craft body/hulk/rotor source sheets (magenta).
 * `keyPreserve` keeps intentional purple/magenta craft paint: only flood-key the
 * background from the image border, and skip magenta spill desaturation.
 */
const CRAFT_ART: { key: string; file: string; fit: number; rotor?: boolean; keyPreserve?: boolean }[] = [
  { key: "craft_littlebird", file: "sprites/craft/littlebird.png", fit: 62 },
  { key: "craft_littlebird_hulk", file: "sprites/craft/littlebird-hulk.png", fit: 62 },
  { key: "craft_littlebird_rotor", file: "sprites/craft/littlebird-rotor.png", fit: 130, rotor: true },
  { key: "craft_littlebird_rotor_hulk", file: "sprites/craft/littlebird-rotor-hulk.png", fit: 80, rotor: true },
  { key: "craft_quad_drone", file: "sprites/craft/quad-drone.png", fit: 28 },
  { key: "craft_quad_drone_hulk", file: "sprites/craft/quad-drone-hulk.png", fit: 28 },
  { key: "craft_quad_drone_rotor", file: "sprites/craft/quad-drone-rotor.png", fit: 36, rotor: true },
  { key: "craft_quad_drone_rotor_hulk", file: "sprites/craft/quad-drone-rotor-hulk.png", fit: 20, rotor: true },
  { key: "craft_cobra", file: "sprites/craft/cobra.png", fit: 112 },
  { key: "craft_cobra_hulk", file: "sprites/craft/cobra-hulk.png", fit: 112 },
  { key: "craft_cobra_rotor", file: "sprites/craft/cobra-rotor.png", fit: 120, rotor: true },
  { key: "craft_cobra_rotor_hulk", file: "sprites/craft/cobra-rotor-hulk.png", fit: 80, rotor: true },
  { key: "craft_viper", file: "sprites/craft/viper.png", fit: 112 },
  { key: "craft_viper_hulk", file: "sprites/craft/viper-hulk.png", fit: 112 },
  { key: "craft_viper_rotor", file: "sprites/craft/viper-rotor.png", fit: 120, rotor: true },
  { key: "craft_viper_rotor_hulk", file: "sprites/craft/viper-rotor-hulk.png", fit: 80, rotor: true },
  { key: "craft_blackhawk", file: "sprites/craft/blackhawk.png", fit: 125 },
  { key: "craft_blackhawk_hulk", file: "sprites/craft/blackhawk-hulk.png", fit: 125 },
  { key: "craft_blackhawk_rotor", file: "sprites/craft/blackhawk-rotor.png", fit: 130, rotor: true },
  { key: "craft_blackhawk_rotor_hulk", file: "sprites/craft/blackhawk-rotor-hulk.png", fit: 80, rotor: true },
  { key: "craft_chinook", file: "sprites/craft/chinook.png", fit: 155 },
  { key: "craft_chinook_hulk", file: "sprites/craft/chinook-hulk.png", fit: 155 },
  { key: "craft_chinook_rotor", file: "sprites/craft/chinook-rotor.png", fit: 130, rotor: true },
  { key: "craft_chinook_rotor_hulk", file: "sprites/craft/chinook-rotor-hulk.png", fit: 80, rotor: true },
  { key: "craft_osprey", file: "sprites/craft/osprey.png", fit: 143 },
  { key: "craft_osprey_hulk", file: "sprites/craft/osprey-hulk.png", fit: 143 },
  { key: "craft_osprey_rotor", file: "sprites/craft/osprey-rotor.png", fit: 100, rotor: true },
  { key: "craft_osprey_rotor_hulk", file: "sprites/craft/osprey-rotor-hulk.png", fit: 70, rotor: true },
  { key: "craft_stealthhawk", file: "sprites/craft/stealthhawk.png", fit: 120 },
  { key: "craft_stealthhawk_hulk", file: "sprites/craft/stealthhawk-hulk.png", fit: 120 },
  { key: "craft_stealthhawk_rotor", file: "sprites/craft/stealthhawk-rotor.png", fit: 130, rotor: true },
  { key: "craft_stealthhawk_rotor_hulk", file: "sprites/craft/stealthhawk-rotor-hulk.png", fit: 80, rotor: true },
  { key: "craft_cyberhawk", file: "sprites/craft/cyberhawk.png", fit: 120 },
  { key: "craft_cyberhawk_hulk", file: "sprites/craft/cyberhawk-hulk.png", fit: 120 },
  { key: "craft_cyberhawk_rotor", file: "sprites/craft/cyberhawk-rotor.png", fit: 130, rotor: true },
  { key: "craft_cyberhawk_rotor_hulk", file: "sprites/craft/cyberhawk-rotor-hulk.png", fit: 80, rotor: true },
  { key: "craft_prometheus", file: "sprites/craft/prometheus.png", fit: 120, keyPreserve: true },
  { key: "craft_prometheus_hulk", file: "sprites/craft/prometheus-hulk.png", fit: 120, keyPreserve: true },
  { key: "craft_lightning_ii", file: "sprites/craft/lightning-ii.png", fit: 142 },
  { key: "craft_lightning_ii_hulk", file: "sprites/craft/lightning-ii-hulk.png", fit: 142 },
  { key: "craft_gunship", file: "sprites/craft/gunship.png", fit: 324 },
  { key: "craft_gunship_hulk", file: "sprites/craft/gunship-hulk.png", fit: 324 },
  { key: "craft_warthog", file: "sprites/craft/warthog.png", fit: 142 },
  { key: "craft_warthog_hulk", file: "sprites/craft/warthog-hulk.png", fit: 142 },
];

export const BIOME_TILE_NAMES = ["water", "sand", "grass", "forest", "rock", "peak"] as const;
export const DOODAD_ART: { key: string; size: number }[] = [
  { key: "tree", size: 42 },
  { key: "pine", size: 44 },
  { key: "palm", size: 46 },
  { key: "cactus", size: 36 },
  { key: "cactus2", size: 38 },
  { key: "bush", size: 30 },
  { key: "shrub", size: 28 },
  { key: "boulder", size: 40 },
  { key: "reed", size: 30 },
  { key: "dead", size: 38 },
  { key: "snowrock", size: 34 },
];

export const FX_KINDS = ["spark", "flame", "smoke", "muzzle", "exhaust", "dirt", "splash"] as const;
export type FxKind = (typeof FX_KINDS)[number];
export const FX_VARIANTS = 4;
/** Bake cell size per FX sheet (putFxSheet). */
export const FX_SHEET_SIZE: Record<FxKind, number> = {
  spark: 22,
  flame: 28,
  smoke: 48,
  muzzle: 34,
  exhaust: 72,
  dirt: 22,
  splash: 20,
};
/** Cells from src_blasts 2×2 grid → fx_blast_0..n-1. */
export const FX_BLAST_CELLS = 4;

export function preloadArt(scene: Phaser.Scene): void {
  scene.load.image("menu_splash", "menu-splash.png");
  scene.load.image("src_heli", SRC.heli);
  scene.load.image("src_enemy", SRC.enemy);
  scene.load.image("src_heli_hulk", "sprites/units/heli-player-hulk.png");
  scene.load.image("src_enemy_heli_hulk", "sprites/units/heli-enemy-hulk.png");
  scene.load.image("src_tank_parts", SRC.tankParts);
  scene.load.image("src_bunker", SRC.bunker);
  scene.load.image("src_bunker_hulk", SRC.bunkerHulk);
  scene.load.image("src_rock", SRC.rock);
  scene.load.image("src_debris_mech", SRC.debrisMech);
  scene.load.image("src_debris_struct", SRC.debrisStruct);
  scene.load.image("src_debris_organic", SRC.debrisOrganic);
  scene.load.image("src_debris_wheels", SRC.debrisWheels);
  scene.load.image("src_tank_wreck", SRC.tankWreck);
  scene.load.image("src_blasts", SRC.blasts);
  scene.load.image("src_rotors", SRC.rotors);
  scene.load.image("src_vehicles", SRC.vehicles);
  scene.load.image("src_troops", SRC.troops);
  scene.load.image("src_buildings", SRC.buildings);
  scene.load.image("src_air_ship", SRC.airShip);
  scene.load.image("src_vehicles_hulk", SRC.vehiclesHulk);
  scene.load.image("src_buildings_hulk", SRC.buildingsHulk);
  scene.load.image("src_air_ship_hulk", SRC.airShipHulk);
  scene.load.image("src_troops_hulk", SRC.troopsHulk);
  scene.load.image("src_tower_guns", SRC.towerGuns);
  scene.load.image("src_tower_guns_hulk", SRC.towerGunsHulk);
  scene.load.image("src_rotors_hulk", SRC.rotorsHulk);
  scene.load.image("src_moto_mg", SRC.motoMg);
  scene.load.image("src_moto_mg_hulk", SRC.motoMgHulk);
  scene.load.image("src_radar_dish", SRC.radarDish);
  scene.load.image("src_radar_dish_hulk", SRC.radarDishHulk);
  for (const art of UNIT_PART_ART) {
    scene.load.image(`src_${art.key}`, `sprites/units/${art.key}.png`);
  }
  for (const art of CRAFT_ART) {
    scene.load.image(`src_${art.key}`, art.file);
  }
  for (const name of BIOME_TILE_NAMES) {
    scene.load.image(`src_biome_${name}`, `sprites/biome/${name}.png`);
  }
  for (const d of DOODAD_ART) {
    scene.load.image(`src_doodad_${d.key}`, `sprites/doodads/${d.key}.png`);
  }
  for (const kind of FX_KINDS) {
    scene.load.image(`src_fx_${kind}_0`, `sprites/fx/${kind}.png`);
    for (let i = 1; i < FX_VARIANTS; i++) {
      scene.load.image(`src_fx_${kind}_${i}`, `sprites/fx/${kind}-${i}.png`);
    }
  }
  for (const art of PLAYER_ORDNANCE_SHOT_ART) {
    scene.load.image(`src_${art.look}`, `sprites/shots/${art.look}.png`);
  }
  for (const art of PLAYER_GUN_MOUNT_ART) {
    scene.load.image(`src_${art.key}`, `sprites/guns/${art.key}.png`);
  }
}

export type HudWirePoint = { u: number; v: number };

export type HeliHudWireBake = {
  w: number;
  h: number;
  pivot: { x: number; y: number };
  srcW: number;
  srcH: number;
  cropX: number;
  cropY: number;
};

/** Map a full heli_body UV into cropped HUD wireframe UV space. */
export function heliHudWireUv(bake: HeliHudWireBake, u: number, v: number): { u: number; v: number } {
  return {
    u: (u * bake.srcW - bake.cropX) / bake.w,
    v: (v * bake.srcH - bake.cropY) / bake.h,
  };
}

/** Soft red screen-edge vignette, baked once and stretched to the viewport. */
export function bakeHurtVignetteTexture(scene: Phaser.Scene, outKey = "hurt_vignette"): void {
  const tw = 320;
  const th = 180;
  const canvas = document.createElement("canvas");
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(tw, th);
  const d = img.data;
  const fall = Math.min(tw, th) * 0.48;
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      const dx = Math.min(x, tw - 1 - x);
      const dy = Math.min(y, th - 1 - y);
      const dist = Math.min(dx, dy);
      let edge = 1 - dist / fall;
      if (edge < 0) edge = 0;
      else {
        edge = edge * edge * (3 - 2 * edge);
        edge = Math.pow(edge, 1.35);
      }
      const a = Math.min(255, Math.round((0.12 + edge * 0.88) * 255));
      if (a < 2) continue;
      const i = (y * tw + x) * 4;
      d[i] = 255;
      d[i + 1] = 255;
      d[i + 2] = 255;
      d[i + 3] = a;
    }
  }
  ctx.putImageData(img, 0, 0);
  if (scene.textures.exists(outKey)) scene.textures.remove(outKey);
  scene.textures.addCanvas(outKey, canvas);
}

/** Sobel edge points from a sprite alpha channel, in normalized UV space. */
export function extractHeliHudWireframe(tex: Phaser.Textures.Texture, step = 2): HudWirePoint[] {
  const src = tex.getSourceImage() as HTMLCanvasElement | HTMLImageElement;
  const w = src.width;
  const h = src.height;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(src as CanvasImageSource, 0, 0);
  const data = ctx.getImageData(0, 0, w, h).data;
  const at = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return 0;
    return data[(y * w + x) * 4 + 3]!;
  };
  const pts: HudWirePoint[] = [];
  for (let y = 1; y < h - 1; y += step) {
    for (let x = 1; x < w - 1; x += step) {
      const a = at(x, y);
      if (a < 48) continue;
      const gx =
        -at(x - 1, y - 1) -
        2 * at(x - 1, y) -
        at(x - 1, y + 1) +
        at(x + 1, y - 1) +
        2 * at(x + 1, y) +
        at(x + 1, y + 1);
      const gy =
        -at(x - 1, y - 1) -
        2 * at(x, y - 1) -
        at(x + 1, y - 1) +
        at(x - 1, y + 1) +
        2 * at(x, y + 1) +
        at(x + 1, y + 1);
      if (Math.hypot(gx, gy) > 80) pts.push({ u: x / w, v: y / h });
    }
  }
  return pts;
}

function stampHudWireDots(
  ctx: CanvasRenderingContext2D,
  points: HudWirePoint[],
  srcW: number,
  srcH: number,
  cropX: number,
  cropY: number,
  radius: number,
  ox = 0,
  oy = 0
): void {
  for (const p of points) {
    ctx.beginPath();
    ctx.arc(p.u * srcW - cropX + ox, p.v * srcH - cropY + oy, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function bakeHudWireShadowCanvas(
  points: HudWirePoint[],
  srcW: number,
  srcH: number,
  cropX: number,
  cropY: number,
  cw: number,
  ch: number
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d")!;
  const offX = 2;
  const offY = 3;
  ctx.fillStyle = "#ffffff";
  ctx.filter = "blur(2.6px)";
  stampHudWireDots(ctx, points, srcW, srcH, cropX, cropY, 1.7, offX, offY);
  ctx.filter = "none";
  stampHudWireDots(ctx, points, srcW, srcH, cropX, cropY, 1.05, offX, offY);
  const pix = ctx.getImageData(0, 0, cw, ch);
  const d = pix.data;
  for (let p = 0; p < d.length; p += 4) {
    const a = d[p + 3]!;
    if (a < 6) continue;
    d[p] = 10;
    d[p + 1] = 8;
    d[p + 2] = 5;
    d[p + 3] = Math.min(150, Math.round(a * 0.7));
  }
  ctx.putImageData(pix, 0, 0);
  return canvas;
}

function bakeHudWireCanvas(
  points: HudWirePoint[],
  srcW: number,
  srcH: number,
  cropX: number,
  cropY: number,
  cw: number,
  ch: number
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  stampHudWireDots(ctx, points, srcW, srcH, cropX, cropY, 1.4);
  return canvas;
}

/** Bake a white-on-transparent wireframe texture from the player heli body sprite. */
export function bakeHeliHudWireTexture(
  scene: Phaser.Scene,
  bodyKey = craftOf().body,
  outKey = "heli_hud_wire",
  shadowKey = "heli_hud_wire_sh"
): HeliHudWireBake | null {
  if (!scene.textures.exists(bodyKey)) return null;
  const tex = scene.textures.get(bodyKey);
  const src = tex.getSourceImage() as HTMLCanvasElement | HTMLImageElement;
  const w = src.width;
  const h = src.height;
  const points = extractHeliHudWireframe(tex, 2);
  if (!points.length) return null;

  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;
  for (const p of points) {
    const px = p.u * w;
    const py = p.v * h;
    if (px < minX) minX = px;
    if (py < minY) minY = py;
    if (px > maxX) maxX = px;
    if (py > maxY) maxY = py;
  }
  const pad = 6;
  minX = Math.max(0, Math.floor(minX - pad));
  minY = Math.max(0, Math.floor(minY - pad));
  maxX = Math.min(w, Math.ceil(maxX + pad));
  maxY = Math.min(h, Math.ceil(maxY + pad));
  const cw = Math.max(1, maxX - minX);
  const ch = Math.max(1, maxY - minY);

  if (scene.textures.exists(outKey)) scene.textures.remove(outKey);
  scene.textures.addCanvas(outKey, bakeHudWireCanvas(points, w, h, minX, minY, cw, ch));
  if (scene.textures.exists(shadowKey)) scene.textures.remove(shadowKey);
  scene.textures.addCanvas(shadowKey, bakeHudWireShadowCanvas(points, w, h, minX, minY, cw, ch));

  const bodyPivot = spritePivot(bodyKey);
  return {
    w: cw,
    h: ch,
    pivot: {
      x: Math.max(0, Math.min(1, (bodyPivot.x * w - minX) / cw)),
      y: Math.max(0, Math.min(1, (bodyPivot.y * h - minY) / ch)),
    },
    srcW: w,
    srcH: h,
    cropX: minX,
    cropY: minY,
  };
}

export function spritePivot(key: string): { x: number; y: number } {
  const k = key.replace(/__(woodland|desert|urban|snow|digital)$/, "");
  const craft = craftPivot(k);
  if (craft) return craft;
  return lookupSpriteOrigin(k) ?? DEFAULT_ORIGIN;
}

const DEFAULT_ORIGIN = { x: 0.5, y: 0.5 };

const UUID_TEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuidTexture(key: string): boolean {
  return UUID_TEX.test(key);
}

export function nameTexture(textures: Phaser.Textures.TextureManager, currentKey: string, newKey: string): void {
  if (!currentKey || currentKey === newKey || !textures.exists(currentKey)) return;
  if (textures.exists(newKey) && newKey !== currentKey) textures.remove(newKey);
  textures.renameTexture(currentKey, newKey);
}

export function nameGameTexture(scene: Phaser.Scene, obj: { texture?: Phaser.Textures.Texture; name?: string }, key: string): void {
  const cur = obj.texture?.key;
  if (!cur) return;
  nameTexture(scene.textures, cur, key);
  if ("name" in obj) obj.name = key;
}

/** Rename leftover Phaser UUID canvas/dynamic textures from named game objects. */
export function nameGeneratedTextures(scene: Phaser.Scene): void {
  const used = new Set<string>();
  const visit = (child: Phaser.GameObjects.GameObject): void => {
    const any = child as Phaser.GameObjects.GameObject & { texture?: Phaser.Textures.Texture };
    const cur = any.texture?.key;
    if (cur && isUuidTexture(cur) && !used.has(cur)) {
      used.add(cur);
      const base = (any.name && !isUuidTexture(any.name) ? any.name : fallbackGenName(any)).replace(/\s+/g, "_");
      let key = base;
      let n = 2;
      while (scene.textures.exists(key) && scene.textures.get(key) !== any.texture) {
        key = `${base}_${n++}`;
      }
      nameTexture(scene.textures, cur, key);
    }
    const nest = (child as Phaser.GameObjects.Container).list;
    if (Array.isArray(nest)) for (const ch of nest) visit(ch);
  };
  for (const child of scene.children.list) visit(child);
  const tex = scene.textures as Phaser.Textures.TextureManager & { getTextureKeys?: () => string[] };
  const raw = tex.getTextureKeys ? tex.getTextureKeys() : Object.keys(tex.list);
  let n = 1;
  for (const k of raw) {
    if (!isUuidTexture(k) || k.startsWith("__") || !scene.textures.exists(k)) continue;
    let key = `gen_canvas_${n++}`;
    while (scene.textures.exists(key)) key = `gen_canvas_${n++}`;
    nameTexture(scene.textures, k, key);
  }
}

function fallbackGenName(obj: Phaser.GameObjects.GameObject): string {
  const t = obj.type.replace(/\s+/g, "").toLowerCase();
  if (t === "text") return "hud_text";
  if (t === "rendertexture") return "wreck_layer";
  if (t === "dynamictexture") return "dynamic_tex";
  return `gen_${t}`;
}

export function spriteUvPos(
  spr: { x: number; y: number; rotation: number; displayWidth: number; displayHeight: number; originX: number; originY: number },
  uvx: number,
  uvy: number
): { x: number; y: number } {
  const lx = (uvx - spr.originX) * spr.displayWidth;
  const ly = (uvy - spr.originY) * spr.displayHeight;
  const c = Math.cos(spr.rotation);
  const s = Math.sin(spr.rotation);
  return { x: spr.x + lx * c - ly * s, y: spr.y + lx * s + ly * c };
}

export function prepareArt(textures: Phaser.Textures.TextureManager): void {
  const body = fit(keyImage(src(textures, "src_heli"), "magenta"), 120);
  const enemy = fit(keyImage(src(textures, "src_enemy"), "magenta"), 104);
  put(textures, "heli_body", body);
  if (textures.exists("src_heli_hulk")) {
    put(
      textures,
      "heli_body_hulk",
      darkenWreck(fit(keyImage(src(textures, "src_heli_hulk"), "magenta"), 120))
    );
  } else {
    const hc = document.createElement("canvas");
    hc.width = body.width;
    hc.height = body.height;
    hc.getContext("2d")!.drawImage(body, 0, 0);
    put(textures, "heli_body_hulk", darkenWreck(hc));
  }
  put(textures, "enemy_heli", enemy);
  if (textures.exists("src_enemy_heli_hulk")) {
    const enemyHulkSrc = keyImage(src(textures, "src_enemy_heli_hulk"), "magenta");
    put(
      textures,
      "enemy_heli_hulk",
      darkenWreck(fit(enemyHulkSrc, 104))
    );
  } else {
    const hc = document.createElement("canvas");
    hc.width = enemy.width;
    hc.height = enemy.height;
    hc.getContext("2d")!.drawImage(enemy, 0, 0);
    put(textures, "enemy_heli_hulk", darkenWreck(hc));
  }
  const rotors = splitRotorSheet(keyPixels(src(textures, "src_rotors"), "magenta"));
  // Hub-centered square (axis at canvas middle) — required for spin-blur registration.
  const playerRotor = fit(squareCenter(rotors[0]!), 134);
  const enemyRotor = fit(squareCenter(rotors[1]!), 108);
  put(textures, "heli_rotor", playerRotor);
  put(textures, "enemy_heli_rotor", enemyRotor);
  put(textures, "heli_rotor_spin", radialStampBlur(playerRotor, spritePivot("heli_rotor")));
  put(textures, "enemy_heli_rotor_spin", radialStampBlur(enemyRotor, spritePivot("enemy_heli_rotor")));

  // Selectable craft bodies / custom rotors.
  for (const art of CRAFT_ART) {
    const srcKey = `src_${art.key}`;
    if (!textures.exists(srcKey)) continue;
    const keyed = keyImage(src(textures, srcKey), art.keyPreserve ? "edge" : "magenta");
    if (art.rotor) {
      if (art.key.endsWith("_hulk")) {
        put(textures, art.key, fit(stripBakedDropShadow(squareCenter(keyed)), art.fit));
      } else {
        const rotor = fit(squareCenter(keyed), art.fit);
        put(textures, art.key, rotor);
        put(textures, `${art.key}_spin`, radialStampBlur(rotor, spritePivot(art.key)));
      }
    } else if (art.key.endsWith("_hulk")) {
      put(textures, art.key, darkenWreck(fit(keyed, art.fit)));
    } else {
      put(textures, art.key, fit(keyed, art.fit));
    }
  }

  put(textures, "doodad_rock", fit(keyImage(src(textures, "src_rock"), "magenta"), 36));

  const parts = sliceGrid(keyImage(src(textures, "src_tank_parts"), "magenta"), 2, 1);
  const hull = fit(parts[0]!, 72);
  const turret = fit(parts[1]!, 56);
  put(textures, "enemy_tank", hull);
  put(textures, "enemy_tank_gun", turret);
  setSpriteOrigin("enemy_tank_gun", cupolaOrigin(turret));
  const wreck = sliceGrid(keyImage(src(textures, "src_tank_wreck"), "magenta"), 2, 1);
  put(textures, "enemy_tank_hulk", darkenWreck(fit(wreck[0]!, 70)));
  const hulkTurret = darkenWreck(fit(wreck[1]!, 56));
  put(textures, "enemy_tank_gun_hulk", hulkTurret);
  setSpriteOrigin("enemy_tank_gun_hulk", cupolaOrigin(hulkTurret));

  put(textures, "building_bunker", fit(keyImage(src(textures, "src_bunker"), "magenta"), 128));

  for (const art of UNIT_PART_ART) {
    const srcKey = `src_${art.key}`;
    if (!textures.exists(srcKey)) continue;
    const img = fit(keyImage(src(textures, srcKey), "magenta"), art.size);
    put(textures, art.key, art.hulk ? darkenWreck(img) : img);
  }
  if (textures.exists("src_radar_dish")) {
    put(textures, "building_radar_disk", fit(clipRadarDish(keyPixels(src(textures, "src_radar_dish"), "magenta")), 160));
  }
  putGrid(textures, "src_vehicles", 3, 2, [
    ["enemy_pickup", 58],
    ["enemy_truck", 68],
    ["enemy_tanker", 70],
    ["enemy_lav", 56],
    ["enemy_sam", 68],
    ["enemy_ptboat", 50],
  ]);
  putGrid(textures, "src_moto_mg", 2, 1, [
    ["enemy_motorcycle", 46],
    ["enemy_troop_mounted_mg", 36],
  ]);
  putGrid(textures, "src_tower_guns", 2, 1, [
    ["building_tower_aa", 48],
    ["building_tower_sam", 48],
  ]);
  putGrid(textures, "src_troops", 3, 2, [
    ["enemy_troop_rpg", 26],
    ["enemy_troop_gunner", 26],
    ["enemy_troop_stinger", 26],
    ["enemy_troop_mechanic", 26],
    ["enemy_troop_officer", 26],
    ["enemy_troop_soldier", 26],
  ]);
  putGrid(textures, "src_buildings", 2, 2, [
    ["building_barn", 86],
    ["building_tent", 64],
    ["building_fob", 128],
    ["building_lookout", 70],
  ]);
  putGrid(textures, "src_air_ship", 2, 2, [
    ["enemy_drone", 20],
    ["enemy_heli_small", 62],
    ["enemy_heli_heavy", 128],
    ["enemy_battleship", 280],
  ]);
  grayShiftTexture(textures, "enemy_battleship");
  for (const key of [
    "enemy_battleship_gun",
    "enemy_battleship_gun_aa",
    "enemy_battleship_gun_sam",
  ] as const) {
    grayShiftTexture(textures, key);
  }
  if (textures.exists("src_radar_dish_hulk")) {
    put(textures, "building_radar_disk_hulk", darkenWreck(fit(clipRadarDish(keyPixels(src(textures, "src_radar_dish_hulk"), "magenta")), 150)));
  }
  putHulkGrid(textures, "src_vehicles_hulk", 3, 2, [
    ["enemy_pickup_hulk", 58],
    ["enemy_truck_hulk", 68],
    ["enemy_tanker_hulk", 70],
    ["enemy_lav_hulk", 56],
    ["enemy_sam_hulk", 68],
    ["enemy_ptboat_hulk", 50],
  ]);
  for (const key of ["enemy_boat_hulk", "enemy_ptboat_hulk"] as const) {
    if (!textures.exists(key)) continue;
    const img = textures.get(key).getSourceImage() as HTMLCanvasElement;
    put(textures, `${key}_sink`, submergeBlue(img));
  }
  putHulkGrid(textures, "src_moto_mg_hulk", 2, 1, [
    ["enemy_motorcycle_hulk", 46],
    ["enemy_troop_mounted_mg_hulk", 36],
  ]);
  putHulkGrid(textures, "src_buildings_hulk", 2, 2, [
    ["building_barn_hulk", 86],
    ["building_tent_hulk", 64],
    ["building_fob_hulk", 128],
    ["building_lookout_hulk", 70],
  ]);
  putHulkGrid(textures, "src_air_ship_hulk", 2, 2, [
    ["enemy_drone_hulk", 20],
    ["enemy_heli_small_hulk", 62],
    ["enemy_heli_heavy_hulk", 128],
    ["enemy_battleship_hulk", 280],
  ]);
  grayShiftTexture(textures, "enemy_battleship_hulk");
  for (const key of [
    "enemy_battleship_gun_hulk",
    "enemy_battleship_gun_aa_hulk",
    "enemy_battleship_gun_sam_hulk",
  ] as const) {
    grayShiftTexture(textures, key);
  }
  putHulkGrid(textures, "src_troops_hulk", 3, 2, [
    ["enemy_troop_rpg_hulk", 28],
    ["enemy_troop_gunner_hulk", 28],
    ["enemy_troop_stinger_hulk", 28],
    ["enemy_troop_mechanic_hulk", 28],
    ["enemy_troop_officer_hulk", 28],
    ["enemy_troop_soldier_hulk", 28],
  ]);
  putHulkGrid(textures, "src_tower_guns_hulk", 2, 1, [
    ["building_tower_aa_hulk", 48],
    ["building_tower_sam_hulk", 48],
  ]);
  const rotorHulks = splitRotorSheet(keyPixels(src(textures, "src_rotors_hulk"), "magenta"));
  // ~60% of live rotor bake size (player 134 → 80, enemy 108 → 65).
  put(textures, "heli_rotor_hulk", fit(stripBakedDropShadow(squareCenter(rotorHulks[0]!)), 80));
  put(textures, "enemy_heli_rotor_hulk", fit(stripBakedDropShadow(squareCenter(rotorHulks[1]!)), 65));
  if (textures.exists("enemy_drone_rotor")) {
    const droneRotor = textures.get("enemy_drone_rotor").getSourceImage() as CanvasImageSource;
    const dc = document.createElement("canvas");
    const dw = (droneRotor as HTMLCanvasElement).width || (droneRotor as HTMLImageElement).width;
    const dh = (droneRotor as HTMLCanvasElement).height || (droneRotor as HTMLImageElement).height;
    dc.width = dw;
    dc.height = dh;
    dc.getContext("2d")!.drawImage(droneRotor, 0, 0);
    put(textures, "enemy_drone_rotor_hulk", darkenWreck(fit(dc, 14)));
  }

  for (const d of DOODAD_ART) {
    const srcKey = `src_doodad_${d.key}`;
    if (!textures.exists(srcKey)) continue;
    put(textures, `doodad_${d.key}`, fit(keyDoodad(src(textures, srcKey)), d.size));
  }

  putHulkGrid(textures, "src_bunker_hulk", 2, 1, [
    ["building_bunker_hulk", 120],
    ["hulk_crater", 48],
  ]);

  putDebrisSheet(textures, "src_debris_mech", "mech");
  putDebrisSheet(textures, "src_debris_struct", "struct");
  putDebrisSheet(textures, "src_debris_organic", "organic");
  putWheelDebrisSheet(textures);

  for (const art of PLAYER_ORDNANCE_SHOT_ART) {
    const srcKey = `src_${art.look}`;
    if (!textures.exists(srcKey)) continue;
    put(textures, art.look, fit(rotateCw90(keyImage(src(textures, srcKey), "magenta")), art.size));
  }

  for (const art of PLAYER_GUN_MOUNT_ART) {
    const srcKey = `src_${art.key}`;
    if (!textures.exists(srcKey)) continue;
    // Gun mounts are authored barrel-up — no rotate.
    put(textures, art.key, fit(keyImage(src(textures, srcKey), "magenta"), art.size));
  }

  const blastSrc = src(textures, "src_blasts");
  const blasts = sliceGrid(matteMagenta(copyToCanvas(blastSrc, blastSrc.width, blastSrc.height)), 2, 2);
  blasts.forEach((c, i) => {
    const blast = fit(c, 88);
    put(textures, `fx_blast_${i}`, blast);
    put(textures, `fx_blast_${i}_heat`, bakeThermalHeatFromDarkness(blast));
  });

  for (const kind of FX_KINDS) {
    putFxSheet(textures, kind, FX_SHEET_SIZE[kind], kind === "dirt");
  }

  const shadowSrc = [
    "heli_body",
    "heli_body_hulk",
    "craft_blackhawk",
    "craft_blackhawk_hulk",
    "craft_chinook",
    "craft_chinook_hulk",
    "enemy_heli",
    "enemy_heli_hulk",
    ...CRAFT_ART.map((a) => a.key),
    ...PLAYER_ORDNANCE_SHOT_ART.map((a) => a.look),
    ...PLAYER_GUN_MOUNT_ART.map((a) => a.key),
    "enemy_tank",
    "enemy_tank_gun",
    "enemy_tank_gun_hulk",
    "enemy_tank_hulk",
    "enemy_boat",
    "building_tower",
    "building_bunker",
    "building_radar",
    "enemy_troop_soldier",
    "enemy_pickup",
    "enemy_motorcycle",
    "enemy_troop_mounted_mg",
    "enemy_truck",
    "enemy_tanker",
    "enemy_lav",
    "enemy_sam",
    "enemy_ptboat",
    "enemy_battleship",
    "enemy_troop_rpg",
    "enemy_troop_gunner",
    "enemy_troop_stinger",
    "enemy_troop_mechanic",
    "enemy_troop_officer",
    "building_barn",
    "building_tent",
    "building_fob",
    "building_lookout",
    "enemy_drone",
    "enemy_heli_small",
    "enemy_heli_heavy",
    "building_tower_gun",
    "enemy_boat_gun",
    "building_radar_disk",
    "enemy_lav_gun",
    "enemy_sam_gun",
    "enemy_battleship_gun",
    "enemy_battleship_gun_aa",
    "enemy_battleship_gun_sam",
    "enemy_heli_heavy_gun",
    "enemy_ptboat_gun",
    "enemy_heli_gun",
    "building_tower_aa",
    "building_tower_sam",
    "enemy_drone_rotor",
    "fx_debris_metal",
    ...["mech", "struct", "organic"].flatMap((cat) =>
      Array.from({ length: 12 }, (_, i) => `fx_debris_${cat}_${i}`)
    ),
    ...Array.from({ length: 4 }, (_, i) => `fx_debris_wheel_${i}`),
  ];
  for (const key of shadowSrc) {
    if (textures.exists(key)) bakeShadows(textures, key);
  }
  // Wreck / pop-hulk atlases (guns, rotors, hulls) — needed for in-flight debris shadows.
  for (const key of textures.getTextureKeys()) {
    if (!key.endsWith("_hulk")) continue;
    if (/__(woodland|desert|urban|snow|digital)$/.test(key)) continue;
    if (textures.exists(`${key}_sh0`)) continue;
    bakeShadows(textures, key);
  }
}

export function extractBiomeTiles(textures: Phaser.Textures.TextureManager): (ImageData | null)[] {
  const byName: Record<string, ImageData | null> = {};
  for (const name of BIOME_TILE_NAMES) {
    const key = `src_biome_${name}`;
    if (!textures.exists(key)) {
      byName[name] = null;
      continue;
    }
    const img = src(textures, key);
    const size = 320;
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    const g = c.getContext("2d")!;
    g.drawImage(img, 0, 0, size, size);
    byName[name] = g.getImageData(0, 0, size, size);
  }
  return [
    byName.water ?? null,
    byName.water ?? null,
    byName.sand ?? null,
    byName.grass ?? null,
    byName.forest ?? null,
    byName.rock ?? null,
    byName.peak ?? null,
  ];
}

export function shadowKey(base: string, z: number): string {
  const lvl = z < 22 ? 0 : z < 52 ? 1 : z < 88 ? 2 : 3;
  const bare = base.replace(/__(woodland|desert|urban|snow|digital)$/, "");
  return `${bare}_sh${lvl}`;
}

const _shadowOff = { x: 0, y: 0 };

/** Shadow screen offset — default `out` is shared scratch (do not store across calls). */
export function shadowOff(z: number, out: { x: number; y: number } = _shadowOff): { x: number; y: number } {
  out.x = z * 0.24;
  out.y = z * 0.58;
  return out;
}

export function shadowAlpha(z: number): number {
  const a = 0.52 - z * 0.0009;
  return a < 0.4 ? 0.4 : a > 0.52 ? 0.52 : a;
}

function src(textures: Phaser.Textures.TextureManager, key: string): HTMLImageElement {
  return textures.get(key).getSourceImage() as HTMLImageElement;
}

function put(
  textures: Phaser.Textures.TextureManager,
  key: string,
  c: HTMLCanvasElement
): void {
  if (textures.exists(key)) textures.remove(key);
  textures.addCanvas(key, c);
}

function putGrid(
  textures: Phaser.Textures.TextureManager,
  srcKey: string,
  cols: number,
  rows: number,
  entries: [string, number][]
): void {
  if (!textures.exists(srcKey)) return;
  const cells = sliceGrid(keyPixels(src(textures, srcKey), "magenta"), cols, rows);
  entries.forEach(([key, size], i) => {
    const cell = cells[i];
    if (!cell || !key || key.startsWith("_")) return;
    put(textures, key, fit(cell, size));
  });
}

function putHulkGrid(
  textures: Phaser.Textures.TextureManager,
  srcKey: string,
  cols: number,
  rows: number,
  entries: [string, number][]
): void {
  if (!textures.exists(srcKey)) return;
  const cells = sliceGrid(keyPixels(src(textures, srcKey), "magenta"), cols, rows);
  entries.forEach(([key, size], i) => {
    const cell = cells[i];
    if (!cell || !key || key.startsWith("_")) return;
    put(textures, key, darkenWreck(fit(cell, size)));
  });
}

function putDebrisSheet(
  textures: Phaser.Textures.TextureManager,
  srcKey: string,
  cat: string
): void {
  if (!textures.exists(srcKey)) return;
  const cells = sliceGrid(keyPixels(src(textures, srcKey), "magenta"), 4, 3);
  cells.forEach((c, i) => {
    if (!c.width || !c.height) return;
    put(textures, `fx_debris_${cat}_${i}`, darkenWreck(fit(c, cat === "organic" ? 12 : 22), 0.7));
  });
}

function putWheelDebrisSheet(textures: Phaser.Textures.TextureManager): void {
  if (!textures.exists("src_debris_wheels")) return;
  const cells = sliceGrid(keyPixels(src(textures, "src_debris_wheels"), "magenta"), 2, 2);
  cells.forEach((c, i) => {
    if (!c.width || !c.height) return;
    put(textures, `fx_debris_wheel_${i}`, darkenWreck(fit(c, 15), 0.65));
  });
}

function putFxSpriteSheet(
  textures: Phaser.Textures.TextureManager,
  key: string,
  cells: HTMLCanvasElement[],
  size: number
): void {
  const n = cells.length;
  const sheet = document.createElement("canvas");
  sheet.width = size * n;
  sheet.height = size;
  const g = sheet.getContext("2d")!;
  cells.forEach((c, i) => {
    g.drawImage(c, i * size + (size - c.width) / 2, (size - c.height) / 2);
  });
  if (textures.exists(key)) textures.remove(key);
  textures.addSpriteSheet(key, sheet as unknown as HTMLImageElement, {
    frameWidth: size,
    frameHeight: size,
    endFrame: n - 1,
  });
}

function putFxSheet(
  textures: Phaser.Textures.TextureManager,
  kind: string,
  size: number,
  bakeHeat = false
): void {
  const destKey = `fx_${kind}`;
  const cells: HTMLCanvasElement[] = [];
  for (let i = 0; i < FX_VARIANTS; i++) {
    const srcKey = `src_fx_${kind}_${i}`;
    if (!textures.exists(srcKey)) continue;
    const img = src(textures, srcKey);
    let cell = fxKnockBlack(copyToCanvas(img, img.width, img.height));
    if (kind === "exhaust") cell = whitenFx(cell);
    cells.push(fit(trim(cell, 2), size));
  }
  if (!cells.length) return;
  putFxSpriteSheet(textures, destKey, cells, size);
  if (bakeHeat) {
    const bakeCell =
      kind === "dirt"
        ? bakeThermalHeatFromAlpha
        : bakeThermalHeatFromDarkness;
    putFxSpriteSheet(
      textures,
      `${destKey}_heat`,
      cells.map((cell) => bakeCell(cell)),
      size
    );
  }
}

function fxKnockBlack(src: HTMLCanvasElement): HTMLCanvasElement {
  const g = src.getContext("2d")!;
  const pix = g.getImageData(0, 0, src.width, src.height);
  const d = pix.data;
  for (let i = 0; i < d.length; i += 4) {
    const lum = Math.max(d[i]!, d[i + 1]!, d[i + 2]!);
    const srcA = d[i + 3]!;
    if (srcA < 8 || lum < 10) {
      d[i + 3] = 0;
      continue;
    }
    d[i + 3] = Math.min(255, Math.round((lum / 255) * srcA * 1.08));
  }
  g.putImageData(pix, 0, 0);
  return src;
}

/** Neutralize generated warm flame color so Phaser tint can produce energy exhaust hues. */
function whitenFx(src: HTMLCanvasElement): HTMLCanvasElement {
  const g = src.getContext("2d")!;
  const pix = g.getImageData(0, 0, src.width, src.height);
  const d = pix.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3]! < 2) continue;
    d[i] = 255;
    d[i + 1] = 255;
    d[i + 2] = 255;
  }
  g.putImageData(pix, 0, 0);
  return src;
}

function copyToCanvas(img: CanvasImageSource, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  g.drawImage(img, 0, 0, w, h);
  return c;
}

function keyImage(img: HTMLImageElement, mode: "magenta" | "studio" | "edge"): HTMLCanvasElement {
  return trim(keyPixels(img, mode));
}

function keyDoodad(img: HTMLImageElement): HTMLCanvasElement {
  const c = keyPixels(img, "magenta");
  const g = c.getContext("2d")!;
  const pix = g.getImageData(0, 0, c.width, c.height);
  const d = pix.data;
  const w = c.width;
  const h = c.height;
  const n = w * h;
  const bg = new Uint8Array(n);
  const isBg = (i: number): boolean => {
    const o = i * 4;
    const r = d[o]!;
    const gc = d[o + 1]!;
    const b = d[o + 2]!;
    const a = d[o + 3]!;
    if (a < 10) return true;
    if (r > 155 && b > 155 && gc < 205 && (r + b) / 2 - gc > 20) return true;
    const mx = Math.max(r, gc, b);
    const mn = Math.min(r, gc, b);
    return mx < 24 && mx - mn < 10;
  };
  const q: number[] = [];
  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = y * w + x;
    if (bg[i] || !isBg(i)) return;
    bg[i] = 1;
    q.push(i);
  };
  for (let x = 0; x < w; x++) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    push(0, y);
    push(w - 1, y);
  }
  for (let i = 0; i < n; i++) {
    if (!bg[i] && isBg(i)) {
      bg[i] = 1;
      q.push(i);
    }
  }
  for (let qi = 0; qi < q.length; qi++) {
    const i = q[qi]!;
    const x = i % w;
    const y = (i / w) | 0;
    push(x - 1, y);
    push(x + 1, y);
    push(x, y - 1);
    push(x, y + 1);
  }
  for (let i = 0; i < n; i++) {
    if (bg[i]) d[i * 4 + 3] = 0;
  }
  g.putImageData(pix, 0, 0);
  return trim(c);
}

/** Keep the circular dish only — drop any pedestal/yoke hanging below. */
function clipRadarDish(c: HTMLCanvasElement): HTMLCanvasElement {
  const g = c.getContext("2d")!;
  const pix = g.getImageData(0, 0, c.width, c.height);
  const d = pix.data;
  const w = c.width;
  const h = c.height;
  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3]! < 24) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX <= minX || maxY <= minY) return c;
  const r = ((maxX - minX) * 0.5) * 0.98;
  const cx = (minX + maxX) * 0.5;
  const cy = minY + r;
  const size = Math.ceil(r * 2 + 4);
  const out = document.createElement("canvas");
  out.width = size;
  out.height = size;
  const og = out.getContext("2d")!;
  og.beginPath();
  og.arc(size / 2, size / 2, r, 0, Math.PI * 2);
  og.clip();
  og.drawImage(c, size / 2 - cx, size / 2 - cy);
  return out;
}

function keyPixels(img: HTMLImageElement, mode: "magenta" | "studio" | "edge"): HTMLCanvasElement {
  const c = copyToCanvas(img, img.width, img.height);
  const g = c.getContext("2d")!;
  const pix = g.getImageData(0, 0, c.width, c.height);
  const d = pix.data;
  const w = c.width;
  const h = c.height;
  const n = w * h;
  const bg = new Uint8Array(n);
  // Edge mode only removes background connected to the image border so purple
  // craft paint (Prometheus) is not punched out as chroma key.
  const edgeOnly = mode === "edge";

  const isKey = (i: number): boolean => {
    const o = i * 4;
    const r = d[o]!;
    const gc = d[o + 1]!;
    const b = d[o + 2]!;
    const chroma = (r + b) * 0.5 - gc;
    const pair = Math.min(r, b);
    if (pair > 155 && chroma > 20) return true;
    if (r > 170 && b > 170 && gc < 205 && chroma > 16) return true;
    const mx = Math.max(r, gc, b);
    const mn = Math.min(r, gc, b);
    if (mn > 200 && mx - mn < 32) return true;
    if (r > 215 && b > 215 && gc > 170 && chroma < 48) return true;
    if (mode === "studio") {
      if (mn > 198) return true;
      if (mx > 155 && mx - mn < 24 && mn > 125) return true;
    }
    return false;
  };

  const q: number[] = [];
  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = y * w + x;
    if (bg[i]) return;
    if (!isKey(i)) return;
    bg[i] = 1;
    q.push(i);
  };
  for (let x = 0; x < w; x++) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    push(0, y);
    push(w - 1, y);
  }
  if (mode === "magenta") {
    for (let i = 0; i < n; i++) {
      if (!bg[i] && isKey(i)) {
        bg[i] = 1;
        q.push(i);
      }
    }
  }
  for (let qi = 0; qi < q.length; qi++) {
    const i = q[qi]!;
    const x = i % w;
    const y = (i / w) | 0;
    push(x - 1, y);
    push(x + 1, y);
    push(x, y - 1);
    push(x, y + 1);
  }

  for (let i = 0; i < n; i++) {
    if (!bg[i]) continue;
    const o = i * 4;
    d[o] = 0;
    d[o + 1] = 0;
    d[o + 2] = 0;
    d[o + 3] = 0;
  }
  if (!edgeOnly) {
    for (let i = 0; i < n; i++) {
      if (bg[i]) continue;
      const o = i * 4;
      const r = d[o]!;
      const gc = d[o + 1]!;
      const b = d[o + 2]!;
      if (r > 140 && b > 140 && gc < 200) {
        const spill = Math.min(r, b) - gc;
        if (spill > 8) {
          d[o] = Math.min(255, gc + 20);
          d[o + 2] = Math.min(255, gc + 12);
        }
      }
    }
  }
  g.putImageData(pix, 0, 0);
  return c;
}

/**
 * Encode opacity into thermal semantic heat — for blood/dirt splats where coverage = warmth.
 * Hot = opaque magenta; cool/empty = transparent (never opaque cold black).
 */
export function bakeThermalHeatFromAlpha(src: HTMLCanvasElement): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = src.width;
  out.height = src.height;
  const g = out.getContext("2d")!;
  g.drawImage(src, 0, 0);
  const pix = g.getImageData(0, 0, out.width, out.height);
  const d = pix.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3]! / 255;
    if (a < 0.004) {
      d[i] = 0;
      d[i + 1] = 0;
      d[i + 2] = 0;
      d[i + 3] = 0;
      continue;
    }
    const heat = Math.min(1, Math.pow(a, 0.68) * 1.12);
    if (heat < 0.04) {
      d[i] = 0;
      d[i + 1] = 0;
      d[i + 2] = 0;
      d[i + 3] = 0;
      continue;
    }
    // Full semantic magenta; alpha is the heat so cool rims fade out instead of painting cold.
    d[i] = 255;
    d[i + 1] = 0;
    d[i + 2] = 255;
    d[i + 3] = Math.round(heat * 255);
  }
  g.putImageData(pix, 0, 0);
  return out;
}

/**
 * Encode blast darkness into thermal semantic heat.
 * Dark opaque centers → warm (magenta); soft/pale edges → transparent.
 * Peak is intentionally below open-flame semantic heat (~0.95+).
 */
export function bakeThermalHeatFromDarkness(src: HTMLCanvasElement): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = src.width;
  out.height = src.height;
  const g = out.getContext("2d")!;
  g.drawImage(src, 0, 0);
  const pix = g.getImageData(0, 0, out.width, out.height);
  const d = pix.data;
  /** Residual scorched ground — cooler than live flame particles. */
  const peak = 0.58;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3]! / 255;
    if (a < 0.004) {
      d[i] = 0;
      d[i + 1] = 0;
      d[i + 2] = 0;
      d[i + 3] = 0;
      continue;
    }
    const luma = (d[i]! * 0.299 + d[i + 1]! * 0.587 + d[i + 2]! * 0.114) / 255;
    // Darker scorched cores read warmer; soft rims stay transparent, not cold-opaque.
    const heat = Math.pow(Math.min(1, Math.max(0, (1 - luma) * a)), 0.92) * peak;
    if (heat < 0.04) {
      d[i] = 0;
      d[i + 1] = 0;
      d[i + 2] = 0;
      d[i + 3] = 0;
      continue;
    }
    d[i] = 255;
    d[i + 1] = 0;
    d[i + 2] = 255;
    d[i + 3] = Math.round(heat * 255);
  }
  g.putImageData(pix, 0, 0);
  return out;
}

function matteMagenta(src: HTMLCanvasElement): HTMLCanvasElement {
  const g = src.getContext("2d")!;
  const pix = g.getImageData(0, 0, src.width, src.height);
  const d = pix.data;
  const n = d.length / 4;
  const alpha = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const r = d[o]!;
    const gc = d[o + 1]!;
    const b = d[o + 2]!;
    const spill = Math.max(0, Math.min(r, b) - gc);
    const chroma = (r + b) * 0.5 - gc;
    const key = chroma <= 10 ? 0 : Math.min(1, (chroma - 10) / 95);
    d[o] = Math.max(0, r - spill);
    d[o + 2] = Math.max(0, b - spill);
    alpha[i] = key >= 0.97 ? 0 : (d[o + 3]! / 255) * (1 - key);
  }
  const w = src.width;
  const h = src.height;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let s = alpha[i]! * 4;
      let c = 4;
      if (x > 0) {
        s += alpha[i - 1]!;
        c++;
      }
      if (x < w - 1) {
        s += alpha[i + 1]!;
        c++;
      }
      if (y > 0) {
        s += alpha[i - w]!;
        c++;
      }
      if (y < h - 1) {
        s += alpha[i + w]!;
        c++;
      }
      d[i * 4 + 3] = (s / c) * 255;
    }
  }
  g.putImageData(pix, 0, 0);
  return src;
}

function trim(src: HTMLCanvasElement, pad = 4): HTMLCanvasElement {
  const g = src.getContext("2d")!;
  const pix = g.getImageData(0, 0, src.width, src.height);
  const d = pix.data;
  let x0 = src.width;
  let y0 = src.height;
  let x1 = 0;
  let y1 = 0;
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      if (d[(y * src.width + x) * 4 + 3]! < 12) continue;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < x0) return src;
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  x1 = Math.min(src.width - 1, x1 + pad);
  y1 = Math.min(src.height - 1, y1 + pad);
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  c.getContext("2d")!.drawImage(src, x0, y0, w, h, 0, 0, w, h);
  return c;
}

function fit(src: HTMLCanvasElement, max: number): HTMLCanvasElement {
  const s = max / Math.max(src.width, src.height);
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(src.width * s));
  c.height = Math.max(1, Math.round(src.height * s));
  const g = c.getContext("2d")!;
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = "high";
  g.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

/** Nose-up sheet art → nose-along-+X (same as tracer shots). */
function rotateCw90(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = src.height;
  c.height = src.width;
  const g = c.getContext("2d")!;
  g.translate(c.width, 0);
  g.rotate(Math.PI / 2);
  g.drawImage(src, 0, 0);
  return c;
}

function grayShiftTexture(textures: Phaser.Textures.TextureManager, key: string): void {
  if (!textures.exists(key)) return;
  const img = textures.get(key).getSourceImage() as CanvasImageSource & { width: number; height: number };
  put(textures, key, toNavalGray(copyToCanvas(img, img.width, img.height)));
}

/** Shift warm desert tan toward cool naval gunmetal (battleship hull + mounts). */
function toNavalGray(src: HTMLCanvasElement): HTMLCanvasElement {
  const g = src.getContext("2d")!;
  const pix = g.getImageData(0, 0, src.width, src.height);
  const d = pix.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3]!;
    if (a < 8) continue;
    const r = d[i]!;
    const gc = d[i + 1]!;
    const b = d[i + 2]!;
    const warm = r - b;
    if (warm < 8 && gc - b < 10) continue;
    const lum = (r * 0.3 + gc * 0.59 + b * 0.11) / 255;
    const steel = lum * 0.72;
    d[i] = Math.round(steel * 255 * 0.9);
    d[i + 1] = Math.round(steel * 255 * 0.96);
    d[i + 2] = Math.round(steel * 255 * 1.08);
  }
  g.putImageData(pix, 0, 0);
  return src;
}

function darkenWreck(src: HTMLCanvasElement, mul = 0.55): HTMLCanvasElement {
  const g = src.getContext("2d")!;
  const pix = g.getImageData(0, 0, src.width, src.height);
  const d = pix.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3]! < 8) continue;
    d[i] = d[i]! * mul;
    d[i + 1] = d[i + 1]! * mul * 0.94;
    d[i + 2] = d[i + 2]! * mul * 0.88;
  }
  g.putImageData(pix, 0, 0);
  return src;
}

/** Pre-bake a dark submerged blue cast of a boat hulk. */
function submergeBlue(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = copyCanvas(src);
  const g = c.getContext("2d")!;
  const pix = g.getImageData(0, 0, c.width, c.height);
  const d = pix.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3]!;
    if (a < 8) continue;
    const lum = d[i]! * 0.28 + d[i + 1]! * 0.48 + d[i + 2]! * 0.24;
    d[i] = Math.min(255, lum * 0.14 + 6);
    d[i + 1] = Math.min(255, lum * 0.28 + 14);
    d[i + 2] = Math.min(255, lum * 0.48 + 28);
    d[i + 3] = Math.min(255, Math.round(a * 0.9));
  }
  g.putImageData(pix, 0, 0);
  return c;
}

/** Remove soft gray drop-shadow fringes baked into sprite art (keeps solid blade/metal pixels). */
function stripBakedDropShadow(src: HTMLCanvasElement): HTMLCanvasElement {
  const g = src.getContext("2d")!;
  const pix = g.getImageData(0, 0, src.width, src.height);
  const d = pix.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3]!;
    // Opaque / near-opaque pixels are metal — never strip (dark olive blades are lum < 100).
    if (a >= 128) continue;
    if (a < 8) continue;
    const r = d[i]!;
    const gc = d[i + 1]!;
    const b = d[i + 2]!;
    const lum = 0.3 * r + 0.5 * gc + 0.2 * b;
    const chroma = Math.max(r, gc, b) - Math.min(r, gc, b);
    // Soft fringe only: translucent + dark + low chroma.
    if (lum < 120 && chroma < 40) d[i + 3] = 0;
  }
  g.putImageData(pix, 0, 0);
  return src;
}

function sliceGrid(src: HTMLCanvasElement, cols: number, rows: number): HTMLCanvasElement[] {
  const xs = gutterCuts(src, cols, "x");
  const ys = gutterCuts(src, rows, "y");
  const out: HTMLCanvasElement[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x0 = xs[col]!;
      const y0 = ys[row]!;
      const w = xs[col + 1]! - x0;
      const h = ys[row + 1]! - y0;
      const c = document.createElement("canvas");
      c.width = Math.max(1, w);
      c.height = Math.max(1, h);
      c.getContext("2d")!.drawImage(src, x0, y0, c.width, c.height, 0, 0, c.width, c.height);
      out.push(trim(c));
    }
  }
  return out;
}

function gutterCuts(src: HTMLCanvasElement, cells: number, axis: "x" | "y"): number[] {
  const size = axis === "x" ? src.width : src.height;
  const other = axis === "x" ? src.height : src.width;
  const g = src.getContext("2d")!;
  const pix = g.getImageData(0, 0, src.width, src.height).data;
  const empty = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    let blank = 1;
    for (let j = 0; j < other; j++) {
      const x = axis === "x" ? i : j;
      const y = axis === "x" ? j : i;
      if (pix[(y * src.width + x) * 4 + 3]! >= 12) {
        blank = 0;
        break;
      }
    }
    empty[i] = blank;
  }
  const runs: { a: number; b: number }[] = [];
  let i = 0;
  while (i < size) {
    if (!empty[i]) {
      i++;
      continue;
    }
    const a = i;
    while (i < size && empty[i]) i++;
    if (i - a >= 8) runs.push({ a, b: i });
  }
  const interior = runs.filter((r) => r.a > 4 && r.b < size - 4);
  const cuts = [0];
  const used = new Set<number>();
  for (let c = 1; c < cells; c++) {
    const target = (size * c) / cells;
    let best = -1;
    let bd = 1e9;
    for (let ri = 0; ri < interior.length; ri++) {
      if (used.has(ri)) continue;
      const r = interior[ri]!;
      const d = Math.abs((r.a + r.b) / 2 - target);
      if (d < bd) {
        bd = d;
        best = ri;
      }
    }
    if (best < 0 || bd > size * 0.22) {
      const eq: number[] = [0];
      for (let k = 1; k < cells; k++) eq.push(((size * k) / cells) | 0);
      eq.push(size);
      return eq;
    }
    used.add(best);
    cuts.push(interior[best]!.a);
  }
  cuts.push(size);
  cuts.sort((a, b) => a - b);
  return cuts;
}

function splitRotorSheet(src: HTMLCanvasElement): HTMLCanvasElement[] {
  const g = src.getContext("2d")!;
  const pix = g.getImageData(0, 0, src.width, src.height);
  const d = pix.data;
  const w = src.width;
  const h = src.height;
  const empty = new Uint8Array(w);
  for (let x = 0; x < w; x++) {
    let blank = 1;
    for (let y = 0; y < h; y++) {
      if (d[(y * w + x) * 4 + 3]! >= 12) {
        blank = 0;
        break;
      }
    }
    empty[x] = blank;
  }
  const mid = w / 2;
  // Only accept a gutter near the sheet center. Edge padding gutters (common on
  // hulk sheets where soft shadows bridge the two rotors) would otherwise "win"
  // and leave the right cell blank.
  const midBand = w * 0.22;
  let split = mid | 0;
  let best = 1e9;
  let found = false;
  let x = 0;
  while (x < w) {
    if (!empty[x]) {
      x++;
      continue;
    }
    const x0 = x;
    while (x < w && empty[x]) x++;
    const len = x - x0;
    if (len < 8) continue;
    const cx = x0 + len / 2;
    const dist = Math.abs(cx - mid);
    if (dist > midBand) continue;
    if (dist < best) {
      best = dist;
      split = x0;
      found = true;
    }
  }
  if (!found) split = mid | 0;
  const cut = (x0: number, x1: number) => {
    const c = document.createElement("canvas");
    c.width = Math.max(1, x1 - x0);
    c.height = h;
    c.getContext("2d")!.drawImage(src, x0, 0, c.width, c.height, 0, 0, c.width, c.height);
    return trim(c, 14);
  };
  return [cut(0, split), cut(split, w)];
}

function insetHub(src: HTMLCanvasElement): { x: number; y: number } {
  const w = src.width;
  const h = src.height;
  const a = src.getContext("2d")!.getImageData(0, 0, w, h).data;
  const dist = new Float64Array(w * h);
  const inf = 1e9;
  let opaqueX = 0;
  let opaqueY = 0;
  let opaqueN = 0;
  for (let i = 0; i < w * h; i++) {
    const opaque = a[i * 4 + 3]! >= 12;
    dist[i] = opaque ? inf : 0;
    if (!opaque) continue;
    opaqueX += i % w;
    opaqueY += (i / w) | 0;
    opaqueN++;
  }
  const s2 = Math.SQRT2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!dist[i]) continue;
      let m = dist[i]!;
      if (x > 0) m = Math.min(m, dist[i - 1]! + 1);
      if (y > 0) m = Math.min(m, dist[i - w]! + 1);
      if (x > 0 && y > 0) m = Math.min(m, dist[i - w - 1]! + s2);
      if (x + 1 < w && y > 0) m = Math.min(m, dist[i - w + 1]! + s2);
      dist[i] = m;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!dist[i]) continue;
      let m = dist[i]!;
      if (x + 1 < w) m = Math.min(m, dist[i + 1]! + 1);
      if (y + 1 < h) m = Math.min(m, dist[i + w]! + 1);
      if (x + 1 < w && y + 1 < h) m = Math.min(m, dist[i + w + 1]! + s2);
      if (x > 0 && y + 1 < h) m = Math.min(m, dist[i + w - 1]! + s2);
      dist[i] = m;
    }
  }
  const centroidX = opaqueN ? opaqueX / opaqueN : w / 2;
  const centroidY = opaqueN ? opaqueY / opaqueN : h / 2;
  let best = -Infinity;
  let bx = w / 2;
  let by = h / 2;
  for (let i = 0; i < dist.length; i++) {
    const x = i % w;
    const y = (i / w) | 0;
    // Broad stylized blades can contain a larger inscribed circle than the
    // hub. Favor thick regions near the rotor's mass center so asymmetric
    // three-blade art still centers on its actual mechanical hub.
    const score = dist[i]! - Math.hypot(x - centroidX, y - centroidY) * 0.25;
    if (score <= best) continue;
    best = score;
    bx = x;
    by = y;
  }
  return { x: bx, y: by };
}

/**
 * Hub-centered square: mast at canvas middle, side = 2×max blade reach.
 * Spin blur and Phaser origin (0.5, 0.5) both assume this layout.
 */
function squareCenter(src: HTMLCanvasElement): HTMLCanvasElement {
  const hub = insetHub(src);
  const g = src.getContext("2d")!;
  const pix = g.getImageData(0, 0, src.width, src.height);
  const d = pix.data;
  let reach = 1;
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      if (d[(y * src.width + x) * 4 + 3]! < 12) continue;
      const dd = Math.hypot(x - hub.x, y - hub.y);
      if (dd > reach) reach = dd;
    }
  }
  const half = Math.ceil(reach + 10);
  const size = half * 2;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  c.getContext("2d")!.drawImage(src, half - hub.x, half - hub.y);
  return c;
}

/** Tunable spin-disc bake: faint stamps both ways around the hub (`<-----|----->`). */
const ROTOR_SPIN_STAMPS = 20;
const ROTOR_SPIN_ARC_DEG = 30;

function copyCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = src.width;
  c.height = src.height;
  c.getContext("2d")!.drawImage(src, 0, 0);
  return c;
}

/**
 * Radial smear for fast-spin rotors.
 * Sharp original stays at angle 0 (hub orientation); stamps fan equally ±arc/2
 * around the authored rotor center (not assumed image center).
 */
function radialStampBlur(
  src: HTMLCanvasElement,
  origin: { x: number; y: number } = { x: 0.5, y: 0.5 },
  stamps = ROTOR_SPIN_STAMPS,
  totalDeg = ROTOR_SPIN_ARC_DEG
): HTMLCanvasElement {
  const blade = matteMagenta(copyCanvas(src));
  const out = document.createElement("canvas");
  out.width = src.width;
  out.height = src.height;
  const g = out.getContext("2d")!;
  const cx = out.width * origin.x;
  const cy = out.height * origin.y;
  const halfArc = ((totalDeg * Math.PI) / 180) * 0.5;
  // Center of smear = original rotor orientation.
  g.globalAlpha = 1;
  g.drawImage(blade, 0, 0);
  const side = Math.max(1, Math.floor(stamps / 2));
  const alpha = 3.2 / Math.max(1, side);
  for (let i = 1; i <= side; i++) {
    const t = i / side;
    const ang = halfArc * t;
    for (const sign of [-1, 1] as const) {
      g.save();
      g.globalAlpha = alpha * (1 - t * 0.35);
      g.translate(cx, cy);
      g.rotate(sign * ang);
      g.drawImage(blade, -cx, -cy);
      g.restore();
    }
  }
  return out;
}

function rowStats(src: HTMLCanvasElement): { count: number; minx: number; maxx: number }[] {
  const g = src.getContext("2d")!;
  const pix = g.getImageData(0, 0, src.width, src.height);
  const d = pix.data;
  const rows: { count: number; minx: number; maxx: number }[] = [];
  for (let y = 0; y < src.height; y++) {
    let count = 0;
    let minx = src.width;
    let maxx = 0;
    for (let x = 0; x < src.width; x++) {
      if (d[(y * src.width + x) * 4 + 3]! < 18) continue;
      count++;
      if (x < minx) minx = x;
      if (x > maxx) maxx = x;
    }
    rows.push({ count, minx, maxx });
  }
  return rows;
}

function cupolaOrigin(src: HTMLCanvasElement): { x: number; y: number } {
  const rows = rowStats(src);
  const maxCount = Math.max(1, ...rows.map((r) => r.count));
  let sx = 0;
  let sy = 0;
  let wsum = 0;
  const y0 = (src.height * 0.4) | 0;
  for (let y = y0; y < rows.length; y++) {
    const r = rows[y]!;
    if (r.count < maxCount * 0.5) continue;
    const cx = (r.minx + r.maxx) / 2;
    sx += cx * r.count;
    sy += y * r.count;
    wsum += r.count;
  }
  if (wsum < 8) return { x: 0.5, y: 0.78 };
  return { x: sx / wsum / src.width, y: sy / wsum / src.height };
}

export function bakeShadows(textures: Phaser.Textures.TextureManager, key: string): void {
  const img = textures.get(key).getSourceImage() as CanvasImageSource;
  const w = (img as HTMLCanvasElement).width || (img as HTMLImageElement).width;
  const h = (img as HTMLCanvasElement).height || (img as HTMLImageElement).height;
  const blurs = [0.2, 0.9, 1.8, 3.0];
  const dens = [0.88, 0.8, 0.74, 0.68];
  blurs.forEach((blur, i) => {
    const pad = Math.ceil(blur * 2) + 4;
    const c = document.createElement("canvas");
    c.width = w + pad * 2;
    c.height = h + pad * 2;
    const g = c.getContext("2d")!;
    g.filter = `blur(${blur}px)`;
    g.drawImage(img, pad, pad, w, h);
    g.filter = "none";
    const pix = g.getImageData(0, 0, c.width, c.height);
    const d = pix.data;
    const mul = dens[i]!;
    for (let p = 0; p < d.length; p += 4) {
      const a = d[p + 3]!;
      if (a < 8) continue;
      d[p] = 12;
      d[p + 1] = 10;
      d[p + 2] = 6;
      d[p + 3] = Math.min(200, a * mul);
    }
    g.putImageData(pix, 0, 0);
    put(textures, `${key}_sh${i}`, c);
  });
}
