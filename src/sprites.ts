import type Phaser from "phaser";
import { lookupSpriteOrigin, SPRITE_MOUNT } from "./spriteOrigin";

const SRC = {
  heli: "sprites/helistrike-heli-player-nrotor.png",
  enemy: "sprites/helistrike-heli-enemy-nrotor.png",
  tankParts: "sprites/helistrike-tank-parts.png",
  units: "sprites/helistrike-units.png",
  rock: "sprites/helistrike-rock.png",
  hulks: "sprites/helistrike-hulks.png",
  debris: "sprites/helistrike-debris.png",
  debrisMech: "sprites/helistrike-debris-mech.png",
  debrisStruct: "sprites/helistrike-debris-struct.png",
  debrisOrganic: "sprites/helistrike-debris-organic.png",
  tankWreck: "sprites/helistrike-tank-wreck-parts.png",
  weapons: "sprites/helistrike-weapons.png",
  blasts: "sprites/helistrike-blasts.png",
  rotors: "sprites/helistrike-rotors.png",
  split: "sprites/helistrike-split-parts.png",
  vehicles: "sprites/helistrike-vehicles.png",
  guns: "sprites/helistrike-guns.png",
  troops: "sprites/helistrike-troops.png",
  buildings: "sprites/helistrike-buildings.png",
  airShip: "sprites/helistrike-air-ship.png",
  hulksSplit: "sprites/helistrike-hulks-split.png",
  hulksVehicles: "sprites/helistrike-hulks-vehicles.png",
  hulksBuildings: "sprites/helistrike-hulks-buildings.png",
  hulksAir: "sprites/helistrike-hulks-air.png",
  hulksTroops: "sprites/helistrike-hulks-troops.png",
  hulksGuns: "sprites/helistrike-hulks-guns.png",
} as const;

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

const FX_KINDS = ["spark", "flame", "smoke", "muzzle", "dirt", "splash"] as const;
export const FX_VARIANTS = 4;

export function preloadArt(scene: Phaser.Scene): void {
  scene.load.image("src_heli", SRC.heli);
  scene.load.image("src_enemy", SRC.enemy);
  scene.load.image("src_tank_parts", SRC.tankParts);
  scene.load.image("src_units", SRC.units);
  scene.load.image("src_rock", SRC.rock);
  scene.load.image("src_hulks", SRC.hulks);
  scene.load.image("src_debris", SRC.debris);
  scene.load.image("src_debris_mech", SRC.debrisMech);
  scene.load.image("src_debris_struct", SRC.debrisStruct);
  scene.load.image("src_debris_organic", SRC.debrisOrganic);
  scene.load.image("src_tank_wreck", SRC.tankWreck);
  scene.load.image("src_weapons", SRC.weapons);
  scene.load.image("src_blasts", SRC.blasts);
  scene.load.image("src_rotors", SRC.rotors);
  scene.load.image("src_split", SRC.split);
  scene.load.image("src_vehicles", SRC.vehicles);
  scene.load.image("src_guns", SRC.guns);
  scene.load.image("src_troops", SRC.troops);
  scene.load.image("src_buildings", SRC.buildings);
  scene.load.image("src_air_ship", SRC.airShip);
  scene.load.image("src_hulks_split", SRC.hulksSplit);
  scene.load.image("src_hulks_vehicles", SRC.hulksVehicles);
  scene.load.image("src_hulks_buildings", SRC.hulksBuildings);
  scene.load.image("src_hulks_air", SRC.hulksAir);
  scene.load.image("src_hulks_troops", SRC.hulksTroops);
  scene.load.image("src_hulks_guns", SRC.hulksGuns);
  for (const name of BIOME_TILE_NAMES) {
    scene.load.image(`src_biome_${name}`, `sprites/helistrike-biome-${name}.png`);
  }
  for (const d of DOODAD_ART) {
    scene.load.image(`src_doodad_${d.key}`, `sprites/helistrike-doodad-${d.key}.png`);
  }
  for (const kind of FX_KINDS) {
    scene.load.image(`src_fx_${kind}_0`, `sprites/helistrike-fx-${kind}.png`);
    for (let i = 1; i < FX_VARIANTS; i++) {
      scene.load.image(`src_fx_${kind}_${i}`, `sprites/helistrike-fx-${kind}-${i}.png`);
    }
  }
}

export const tankLayout = {
  turretOrigin: { x: 0.5, y: 0.78 },
  mountOrigin: { ...SPRITE_MOUNT.enemy_tank },
  hulkTurretOrigin: { x: 0.5, y: 0.78 },
};

export const rotorLayout = {
  player: { x: 0.498, y: 0.453 },
  enemy: { x: 0.497, y: 0.411 },
};

export const gunLayout = {
  origin: { x: 0.5, y: 0.7 },
  mount: { x: 0.497, y: 0.174 },
};

export function spritePivot(key: string): { x: number; y: number } {
  const k = key.replace(/__(woodland|desert|urban|snow)$/, "");
  if (k === "heli_body") return { ...rotorLayout.player };
  if (k === "heli_gun") return { ...gunLayout.origin };
  if (k === "enemy_heli") return { ...rotorLayout.enemy };
  if (k === "enemy_tank_gun") return { ...tankLayout.turretOrigin };
  if (k === "enemy_tank_gun_hulk") return { ...tankLayout.hulkTurretOrigin };
  return lookupSpriteOrigin(k) ?? { x: 0.5, y: 0.5 };
}

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
  const body = fit(keyImage(src(textures, "src_heli"), "studio"), 120);
  const enemy = fit(keyImage(src(textures, "src_enemy"), "magenta"), 104);
  put(textures, "heli_body", body);
  put(textures, "enemy_heli", enemy);
  const rotors = splitRotorSheet(keyPixels(src(textures, "src_rotors"), "magenta"));
  put(textures, "heli_rotor", squareCenter(rotors[0]!));
  put(textures, "enemy_heli_rotor", squareCenter(rotors[1]!));
  put(textures, "doodad_rock", fit(keyImage(src(textures, "src_rock"), "magenta"), 36));

  const parts = sliceGrid(keyImage(src(textures, "src_tank_parts"), "magenta"), 2, 1);
  const hull = fit(parts[0]!, 72);
  const turret = fit(parts[1]!, 56);
  put(textures, "enemy_tank", hull);
  put(textures, "enemy_tank_gun", turret);
  tankLayout.turretOrigin = cupolaOrigin(turret);
  const wreck = sliceGrid(keyImage(src(textures, "src_tank_wreck"), "magenta"), 2, 1);
  put(textures, "enemy_tank_hulk", darkenWreck(fit(wreck[0]!, 70)));
  const hulkTurret = darkenWreck(fit(wreck[1]!, 70));
  put(textures, "enemy_tank_gun_hulk", hulkTurret);
  tankLayout.hulkTurretOrigin = cupolaOrigin(hulkTurret);

  const sheet = keyPixels(src(textures, "src_units"), "magenta");
  const cells = sliceGrid(sheet, 3, 2);
  const keys = ["boat", "tower", "bunker", "radar", "soldier", "tree"] as const;
  const sizes = [78, 58, 92, 88, 26, 42];
  keys.forEach((key, i) => {
    if (key === "boat" || key === "tower" || key === "radar" || key === "soldier") return;
    const texKey = key === "tree" ? "doodad_tree" : key === "bunker" ? "building_bunker" : `enemy_${key}`;
    put(textures, texKey, fit(cells[i]!, sizes[i]!));
  });

  putGrid(textures, "src_split", 3, 2, [
    ["enemy_boat", 78],
    ["building_tower", 58],
    ["building_radar", 88],
    ["enemy_boat_gun", 36],
    ["building_tower_gun", 52],
    ["building_radar_disk", 64],
  ]);
  putGrid(textures, "src_vehicles", 3, 2, [
    ["enemy_pickup", 58],
    ["enemy_truck", 68],
    ["enemy_tanker", 70],
    ["enemy_lav", 56],
    ["enemy_sam", 68],
    ["enemy_ptboat", 64],
  ]);
  putGrid(textures, "src_guns", 3, 2, [
    ["enemy_lav_gun", 40],
    ["enemy_sam_gun", 48],
    ["enemy_ptboat_gun", 32],
    ["enemy_battleship_gun", 48],
    ["enemy_heli_heavy_gun", 48],
    ["enemy_heli_gun", 32],
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
    ["building_fob", 96],
    ["building_lookout", 52],
  ]);
  putGrid(textures, "src_air_ship", 2, 2, [
    ["enemy_drone", 40],
    ["enemy_heli_small", 62],
    ["enemy_heli_heavy", 128],
    ["enemy_battleship", 280],
  ]);
  putHulkGrid(textures, "src_hulks_split", 3, 2, [
    ["enemy_boat_hulk", 74],
    ["building_tower_hulk", 58],
    ["building_radar_hulk", 84],
    ["enemy_boat_gun_hulk", 36],
    ["building_tower_gun_hulk", 52],
    ["building_radar_disk_hulk", 64],
  ]);
  putHulkGrid(textures, "src_hulks_vehicles", 3, 2, [
    ["enemy_pickup_hulk", 58],
    ["enemy_truck_hulk", 68],
    ["enemy_tanker_hulk", 70],
    ["enemy_lav_hulk", 56],
    ["enemy_sam_hulk", 68],
    ["enemy_ptboat_hulk", 64],
  ]);
  putHulkGrid(textures, "src_hulks_buildings", 2, 2, [
    ["building_barn_hulk", 86],
    ["building_tent_hulk", 64],
    ["building_fob_hulk", 96],
    ["building_lookout_hulk", 52],
  ]);
  putHulkGrid(textures, "src_hulks_air", 2, 2, [
    ["enemy_drone_hulk", 40],
    ["enemy_heli_small_hulk", 62],
    ["enemy_heli_heavy_hulk", 128],
    ["enemy_battleship_hulk", 280],
  ]);
  putHulkGrid(textures, "src_hulks_troops", 3, 2, [
    ["enemy_troop_rpg_hulk", 28],
    ["enemy_troop_gunner_hulk", 28],
    ["enemy_troop_stinger_hulk", 28],
    ["enemy_troop_mechanic_hulk", 28],
    ["enemy_troop_officer_hulk", 28],
    ["enemy_troop_soldier_hulk", 28],
  ]);
  putHulkGrid(textures, "src_hulks_guns", 3, 2, [
    ["enemy_lav_gun_hulk", 40],
    ["enemy_sam_gun_hulk", 48],
    ["enemy_ptboat_gun_hulk", 32],
    ["enemy_battleship_gun_hulk", 48],
    ["enemy_heli_heavy_gun_hulk", 48],
    ["enemy_heli_gun_hulk", 32],
  ]);

  for (const d of DOODAD_ART) {
    const srcKey = `src_doodad_${d.key}`;
    if (!textures.exists(srcKey)) continue;
    put(textures, `doodad_${d.key}`, fit(keyDoodad(src(textures, srcKey)), d.size));
  }

  const hulks = sliceGrid(keyImage(src(textures, "src_hulks"), "magenta"), 3, 3);
  const hulkKeys = [
    "enemy_tank_hulk",
    "enemy_heli_hulk",
    "building_bunker_hulk",
    "building_radar_hulk",
    "building_tower_hulk",
    "enemy_boat_hulk",
    "enemy_troop_soldier_hulk",
    "doodad_tree_hulk",
    "hulk_crater",
  ] as const;
  const hulkSizes = [70, 90, 86, 84, 58, 74, 28, 40, 48];
  hulkKeys.forEach((key, i) => {
    if (
      key === "building_radar_hulk" ||
      key === "building_tower_hulk" ||
      key === "enemy_boat_hulk" ||
      key === "enemy_tank_hulk" ||
      key === "enemy_troop_soldier_hulk"
    )
      return;
    put(textures, key, darkenWreck(fit(hulks[i]!, hulkSizes[i]!)));
  });

  putDebrisSheet(textures, "src_debris_mech", "mech");
  putDebrisSheet(textures, "src_debris_struct", "struct");
  putDebrisSheet(textures, "src_debris_organic", "organic");
  if (!textures.exists("fx_frag_mech_0") && textures.exists("src_debris")) {
    putDebrisSheet(textures, "src_debris", "mech");
  }

  const wpn = sliceGrid(keyImage(src(textures, "src_weapons"), "magenta"), 2, 2);
  put(textures, "heli_gun", fit(wpn[0]!, 46));
  put(textures, "rocket", fit(wpn[1]!, 28));
  put(textures, "hellfire", fit(wpn[2]!, 36));
  put(textures, "tow", fit(wpn[3]!, 34));

  const blastSrc = src(textures, "src_blasts");
  const blasts = sliceGrid(matteMagenta(copyToCanvas(blastSrc, blastSrc.width, blastSrc.height)), 2, 2);
  blasts.forEach((c, i) => put(textures, `fx_blast_${i}`, fit(c, 88)));

  putFxSheet(textures, "spark", 22);
  putFxSheet(textures, "flame", 28);
  putFxSheet(textures, "smoke", 48);
  putFxSheet(textures, "muzzle", 34);
  putFxSheet(textures, "dirt", 22);
  putFxSheet(textures, "splash", 20);

  const shadowSrc = [
    "heli_body",
    "enemy_heli",
    "cannon",
    "shell",
    "tracer_sm",
    "rocket",
    "hellfire",
    "tow",
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
    "enemy_heli_heavy_gun",
    "enemy_ptboat_gun",
    "enemy_heli_gun",
    "tracer_aa",
    "fx_frag_metal",
    "fx_frag_sand",
    "fx_frag_dark",
    ...["mech", "struct", "organic"].flatMap((cat) =>
      Array.from({ length: 12 }, (_, i) => `fx_frag_${cat}_${i}`)
    ),
  ];
  for (const key of shadowSrc) {
    if (textures.exists(key)) bakeShadows(textures, key);
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
  const bare = base.replace(/__(woodland|desert|urban|snow)$/, "");
  return `${bare}_sh${lvl}`;
}

export function shadowOff(z: number): { x: number; y: number } {
  return { x: z * 0.24, y: z * 0.58 };
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
    if (!cell) return;
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
    if (!cell) return;
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
    put(textures, `fx_frag_${cat}_${i}`, darkenWreck(fit(c, cat === "organic" ? 12 : 22), 0.7));
  });
}

function putFxSheet(
  textures: Phaser.Textures.TextureManager,
  kind: string,
  size: number
): void {
  const destKey = `fx_${kind}`;
  const cells: HTMLCanvasElement[] = [];
  for (let i = 0; i < FX_VARIANTS; i++) {
    const srcKey = `src_fx_${kind}_${i}`;
    if (!textures.exists(srcKey)) continue;
    const img = src(textures, srcKey);
    cells.push(fit(trim(fxKnockBlack(copyToCanvas(img, img.width, img.height)), 2), size));
  }
  if (!cells.length) return;
  const n = cells.length;
  const sheet = document.createElement("canvas");
  sheet.width = size * n;
  sheet.height = size;
  const g = sheet.getContext("2d")!;
  cells.forEach((c, i) => {
    g.drawImage(c, i * size + (size - c.width) / 2, (size - c.height) / 2);
  });
  if (textures.exists(destKey)) textures.remove(destKey);
  textures.addSpriteSheet(destKey, sheet, { frameWidth: size, frameHeight: size, endFrame: n - 1 });
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

function copyToCanvas(img: CanvasImageSource, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  g.drawImage(img, 0, 0, w, h);
  return c;
}

function keyImage(img: HTMLImageElement, mode: "magenta" | "studio"): HTMLCanvasElement {
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

function keyPixels(img: HTMLImageElement, mode: "magenta" | "studio"): HTMLCanvasElement {
  const c = copyToCanvas(img, img.width, img.height);
  const g = c.getContext("2d")!;
  const pix = g.getImageData(0, 0, c.width, c.height);
  const d = pix.data;
  const w = c.width;
  const h = c.height;
  const n = w * h;
  const bg = new Uint8Array(n);

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
  g.putImageData(pix, 0, 0);
  return c;
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
  let split = (mid) | 0;
  let best = 1e9;
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
    if (dist < best) {
      best = dist;
      split = x0;
    }
  }
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
  for (let i = 0; i < w * h; i++) dist[i] = a[i * 4 + 3]! >= 12 ? inf : 0;
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
  let best = -1;
  let bx = w / 2;
  let by = h / 2;
  for (let i = 0; i < dist.length; i++) {
    if (dist[i]! > best) {
      best = dist[i]!;
      bx = i % w;
      by = (i / w) | 0;
    }
  }
  return { x: bx, y: by };
}

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

function darkMountOrigin(src: HTMLCanvasElement): { x: number; y: number } {
  const g = src.getContext("2d")!;
  const pix = g.getImageData(0, 0, src.width, src.height);
  const d = pix.data;
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const o = (y * src.width + x) * 4;
      if (d[o + 3]! < 40) continue;
      const lum = 0.3 * d[o]! + 0.5 * d[o + 1]! + 0.2 * d[o + 2]!;
      if (lum > 58) continue;
      sx += x;
      sy += y;
      n++;
    }
  }
  if (n < 20) return { x: 0.5, y: 0.4 };
  return { x: sx / n / src.width, y: sy / n / src.height };
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
