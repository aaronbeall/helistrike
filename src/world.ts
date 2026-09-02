import Phaser from "phaser";
import { fbm } from "./noise";
import { Rng } from "./rng";

export const WORLD = 5600;
export const TEX = 1800;
export const SCALE = WORLD / TEX;
export const WRECK_TEX = 4096;

export type Biome = "water" | "river" | "sand" | "grass" | "forest" | "rock" | "peak";

export type HvKind = "bunker" | "radar" | "tower";

export interface HvSpec {
  id: string;
  name: string;
  kind: HvKind;
  x: number;
  y: number;
}

export interface Spawn {
  kind:
    | "tank"
    | "soldier"
    | "heli"
    | "boat"
    | "tower"
    | "bunker"
    | "radar";
  x: number;
  y: number;
  hv?: string;
}

export type DecorKind =
  | "tree"
  | "pine"
  | "palm"
  | "cactus"
  | "cactus2"
  | "bush"
  | "shrub"
  | "rock"
  | "boulder"
  | "reed"
  | "dead"
  | "snowrock";

export interface Decor {
  kind: DecorKind;
  x: number;
  y: number;
  size: number;
  rot: number;
}

export interface WorldData {
  seed: number;
  height: Float32Array;
  biome: Uint8Array;
  spawnX: number;
  spawnY: number;
  hv: HvSpec[];
  spawns: Spawn[];
  trees: { x: number; y: number }[];
  rocks: { x: number; y: number }[];
  decor: Decor[];
  canvas: HTMLCanvasElement;
}

const BIOME_ID: Record<Biome, number> = {
  water: 0,
  river: 1,
  sand: 2,
  grass: 3,
  forest: 4,
  rock: 5,
  peak: 6,
};

const H_WATER = 0.34;
const H_SAND = 0.4;
const H_ROCK = 0.62;
const H_PEAK = 0.72;
const HEIGHT_BANDS: { lo: number; hi: number; k: number }[] = [
  { lo: 0, hi: H_WATER, k: 2.7 },
  { lo: H_WATER, hi: H_SAND, k: 2.35 },
  { lo: H_SAND, hi: H_ROCK, k: 2.9 },
  { lo: H_ROCK, hi: H_PEAK, k: 2.55 },
  { lo: H_PEAK, hi: 1.08, k: 2.45 },
];

export function generateWorld(seed: number, tiles?: (ImageData | null)[]): WorldData {
  const rng = new Rng(seed);
  const height = new Float32Array(TEX * TEX);
  const moisture = new Float32Array(TEX * TEX);
  const biome = new Uint8Array(TEX * TEX);

  for (let y = 0; y < TEX; y++) {
    for (let x = 0; x < TEX; x++) {
      const i = y * TEX + x;
      const nx = x / TEX;
      const ny = y / TEX;
      let h = fbm(nx * 6.2, ny * 6.2, seed, 6, 2.05, 0.52);
      const ridge = 1 - Math.abs(fbm(nx * 3.1 + 20, ny * 3.1, seed + 9, 4) * 2 - 1);
      h = h * 0.72 + ridge * 0.28;
      const dx = nx - 0.5;
      const dy = ny - 0.5;
      h -= Math.pow(Math.hypot(dx, dy) * 1.15, 2) * 0.18;
      height[i] = h;
      moisture[i] = fbm(nx * 5.4 + 40, ny * 5.4, seed + 17, 4);
    }
  }

  carveRivers(height, biome, rng);

  for (let i = 0; i < TEX * TEX; i++) {
    if (biome[i] === BIOME_ID.river) continue;
    const h = height[i];
    const m = moisture[i];
    if (h < H_WATER) biome[i] = BIOME_ID.water;
    else if (h < H_SAND) biome[i] = BIOME_ID.sand;
    else if (h > H_PEAK) biome[i] = BIOME_ID.peak;
    else if (h > H_ROCK) biome[i] = BIOME_ID.rock;
    else if (m > 0.58 && h < 0.58) biome[i] = BIOME_ID.forest;
    else biome[i] = BIOME_ID.grass;
  }

  const raw = new Float32Array(height);
  for (let i = 0; i < height.length; i++) {
    height[i] = remapBand(height[i]!);
    if (biome[i] === BIOME_ID.river) height[i] = Math.min(height[i]!, H_WATER - 0.02);
  }

  const canvas = paintTerrain(raw, biome, seed, tiles);
  const { spawnX, spawnY } = findSpawn(height, biome, rng);
  const { hv, spawns } = placeForces(height, biome, rng, spawnX, spawnY);
  const decor = placeDecor(biome, rng);
  const trees = decor.filter((d) => d.kind === "tree" || d.kind === "pine" || d.kind === "palm").map((d) => ({ x: d.x, y: d.y }));
  const rocks = decor.filter((d) => d.kind === "rock" || d.kind === "boulder" || d.kind === "snowrock").map((d) => ({ x: d.x, y: d.y }));

  return { seed, height, biome, spawnX, spawnY, hv, spawns, trees, rocks, decor, canvas };
}

export function sampleHeight(world: WorldData, x: number, y: number): number {
  const tx = Phaser.Math.Clamp((x / WORLD) * TEX, 0, TEX - 1.001);
  const ty = Phaser.Math.Clamp((y / WORLD) * TEX, 0, TEX - 1.001);
  const x0 = Math.floor(tx);
  const y0 = Math.floor(ty);
  const fx = tx - x0;
  const fy = ty - y0;
  const h00 = world.height[y0 * TEX + x0]!;
  const h10 = world.height[y0 * TEX + Math.min(x0 + 1, TEX - 1)]!;
  const h01 = world.height[Math.min(y0 + 1, TEX - 1) * TEX + x0]!;
  const h11 =
    world.height[Math.min(y0 + 1, TEX - 1) * TEX + Math.min(x0 + 1, TEX - 1)]!;
  return Phaser.Math.Linear(
    Phaser.Math.Linear(h00, h10, fx),
    Phaser.Math.Linear(h01, h11, fx),
    fy
  );
}

export function isWater(world: WorldData, x: number, y: number): boolean {
  const b = sampleBiomeId(world, x, y);
  return b === BIOME_ID.water || b === BIOME_ID.river;
}

export function sampleBiome(world: WorldData, x: number, y: number): Biome {
  const id = sampleBiomeId(world, x, y);
  return (
    (["water", "river", "sand", "grass", "forest", "rock", "peak"] as const)[id] ?? "grass"
  );
}

function sampleBiomeId(world: WorldData, x: number, y: number): number {
  const tx = Phaser.Math.Clamp(Math.floor((x / WORLD) * TEX), 0, TEX - 1);
  const ty = Phaser.Math.Clamp(Math.floor((y / WORLD) * TEX), 0, TEX - 1);
  return world.biome[ty * TEX + tx]!;
}

export const Z_LIFT = 0.05;
export const Z_CAM = 480;

export function screenLift(z: number): number {
  return z * Z_LIFT;
}

export function zScale(z: number): number {
  const d = Math.max(96, Z_CAM - z);
  return Z_CAM / d;
}

export function groundZ(world: WorldData, x: number, y: number): number {
  const h = sampleHeight(world, x, y);
  return Math.max(0, (h - 0.16) * 158);
}

export function castZ(world: WorldData, x: number, y: number, z: number): number {
  return Math.max(0, z - groundZ(world, x, y));
}

export function groundSlope(world: WorldData, x: number, y: number): { dx: number; dy: number } {
  const e = 14;
  return {
    dx: (groundZ(world, x + e, y) - groundZ(world, x - e, y)) / (2 * e),
    dy: (groundZ(world, x, y + e) - groundZ(world, x, y - e)) / (2 * e),
  };
}

function carveRivers(height: Float32Array, biome: Uint8Array, rng: Rng): void {
  const seen = new Uint8Array(TEX * TEX);
  for (let r = 0; r < 50; r++) {
    let x = rng.int(40, TEX - 41);
    let y = rng.int(40, TEX - 41);
    let best = -1;
    for (let k = 0; k < 40; k++) {
      const sx = rng.int(20, TEX - 21);
      const sy = rng.int(20, TEX - 21);
      const h = height[sy * TEX + sx]!;
      if (h > best) {
        best = h;
        x = sx;
        y = sy;
      }
    }
    seen.fill(0);
    let rad = 0.5;
    for (let step = 0; step < 8000; step++) {
      const i = y * TEX + x;
      seen[i] = 1;
      stampRiver(biome, x, y, rad);
      if (x <= 0 || y <= 0 || x >= TEX - 1 || y >= TEX - 1 || height[i]! < 0.33) break;
      const next = stepRiver(height, x, y, seen);
      if (!next) break;
      x = next.x;
      y = next.y;
      rad = Math.min(14, rad + 0.0065);
    }
  }
}

const RIVER_REACH = 8;

function stepRiver(
  height: Float32Array,
  x: number,
  y: number,
  seen: Uint8Array
): { x: number; y: number } | null {
  const h0 = height[y * TEX + x]!;
  let wx = 0;
  let wy = 0;
  for (let oy = -RIVER_REACH; oy <= RIVER_REACH; oy++) {
    for (let ox = -RIVER_REACH; ox <= RIVER_REACH; ox++) {
      if (!ox && !oy) continue;
      if (ox * ox + oy * oy > RIVER_REACH * RIVER_REACH) continue;
      const xx = x + ox;
      const yy = y + oy;
      if (xx < 0 || yy < 0 || xx >= TEX || yy >= TEX) continue;
      if (seen[yy * TEX + xx]) continue;
      const drop = h0 - height[yy * TEX + xx]!;
      if (drop <= 0) continue;
      const dist = Math.hypot(ox, oy);
      const w = drop / dist;
      wx += (ox / dist) * w;
      wy += (oy / dist) * w;
    }
  }
  let dx = 0;
  let dy = 0;
  const len = Math.hypot(wx, wy);
  if (len > 1e-8) {
    dx = wx / len;
    dy = wy / len;
  } else {
    let bestH = Infinity;
    let bx = 0;
    let by = 0;
    let found = false;
    for (let oy = -RIVER_REACH; oy <= RIVER_REACH; oy++) {
      for (let ox = -RIVER_REACH; ox <= RIVER_REACH; ox++) {
        if (!ox && !oy) continue;
        if (ox * ox + oy * oy > RIVER_REACH * RIVER_REACH) continue;
        const xx = x + ox;
        const yy = y + oy;
        if (xx < 0 || yy < 0 || xx >= TEX || yy >= TEX) continue;
        if (seen[yy * TEX + xx]) continue;
        const h = height[yy * TEX + xx]!;
        if (h < bestH) {
          bestH = h;
          bx = ox;
          by = oy;
          found = true;
        }
      }
    }
    if (!found) return null;
    const d = Math.hypot(bx, by) || 1;
    dx = bx / d;
    dy = by / d;
  }
  const pick = (reach: number): { x: number; y: number } | null => {
    let best = -Infinity;
    let px = x;
    let py = y;
    let hit = false;
    for (let oy = -reach; oy <= reach; oy++) {
      for (let ox = -reach; ox <= reach; ox++) {
        if (!ox && !oy) continue;
        const dist = Math.hypot(ox, oy);
        if (dist > reach + 1e-6) continue;
        const xx = x + ox;
        const yy = y + oy;
        if (xx < 0 || yy < 0 || xx >= TEX || yy >= TEX) continue;
        if (seen[yy * TEX + xx]) continue;
        const align = (ox * dx + oy * dy) / dist;
        if (align > best) {
          best = align;
          px = xx;
          py = yy;
          hit = true;
        }
      }
    }
    return hit ? { x: px, y: py } : null;
  };
  return pick(1) ?? pick(2);
}

function stampRiver(biome: Uint8Array, x: number, y: number, rad: number): void {
  if (rad <= 1) {
    if (x >= 0 && y >= 0 && x < TEX && y < TEX) biome[y * TEX + x] = BIOME_ID.river;
    return;
  }
  const ir = Math.ceil(rad);
  const r2 = rad * rad;
  for (let oy = -ir; oy <= ir; oy++) {
    for (let ox = -ir; ox <= ir; ox++) {
      if (ox * ox + oy * oy > r2) continue;
      const xx = x + ox;
      const yy = y + oy;
      if (xx < 0 || yy < 0 || xx >= TEX || yy >= TEX) continue;
      biome[yy * TEX + xx] = BIOME_ID.river;
    }
  }
}

function terrace(t: number, k: number): number {
  const u = Phaser.Math.Clamp(t, 0, 1) * 2 - 1;
  const a = Math.abs(u);
  if (a < 1e-8) return 0.5;
  return 0.5 + 0.5 * Math.sign(u) * Math.pow(a, k);
}

function remapBand(h: number): number {
  const x = Phaser.Math.Clamp(h, 0, 1);
  for (let i = 0; i < HEIGHT_BANDS.length; i++) {
    const b = HEIGHT_BANDS[i]!;
    if (x < b.hi || i === HEIGHT_BANDS.length - 1) {
      const t = (x - b.lo) / Math.max(1e-6, b.hi - b.lo);
      return b.lo + terrace(t, b.k) * (b.hi - b.lo);
    }
  }
  return x;
}

function biomeSolid(biome: Uint8Array, x: number, y: number, id: number): boolean {
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const xx = x + ox;
      const yy = y + oy;
      if (xx < 0 || yy < 0 || xx >= TEX || yy >= TEX) return false;
      if (biome[yy * TEX + xx] !== id) return false;
    }
  }
  return true;
}

function overlayChan(base: number, tex: number, a: number): number {
  const b = base / 255;
  const t = tex / 255;
  const o = b < 0.5 ? 2 * b * t : 1 - 2 * (1 - b) * (1 - t);
  return Phaser.Math.Clamp((b * (1 - a) + o * a) * 255, 0, 255);
}

function paintTerrain(
  raw: Float32Array,
  biome: Uint8Array,
  seed: number,
  tiles?: (ImageData | null)[]
): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = TEX;
  c.height = TEX;
  const g = c.getContext("2d")!;
  const img = g.createImageData(TEX, TEX);
  const d = img.data;
  for (let y = 0; y < TEX; y++) {
    for (let x = 0; x < TEX; x++) {
      const i = y * TEX + x;
      const h = raw[i]!;
      const b = biome[i]!;
      const n = fbm(x * 0.08, y * 0.08, seed + 99, 2) * 18 - 9;
      let r = 0,
        gch = 0,
        bl = 0;
      if (b === BIOME_ID.water) {
        const deep = Phaser.Math.Clamp((H_WATER - h) * 4, 0, 1);
        r = 28 + n * 0.3;
        gch = 72 - deep * 22;
        bl = 92 - deep * 10;
      } else if (b === BIOME_ID.river) {
        r = 36;
        gch = 86;
        bl = 96;
      } else if (b === BIOME_ID.sand) {
        r = 196 + n;
        gch = 168 + n * 0.6;
        bl = 112;
      } else if (b === BIOME_ID.forest) {
        r = 42 + n * 0.4;
        gch = 78 + h * 20;
        bl = 44;
      } else if (b === BIOME_ID.rock) {
        r = 92 + n;
        gch = 86 + n;
        bl = 78;
      } else if (b === BIOME_ID.peak) {
        const snow = (h - 0.74) * 8;
        r = 140 + snow * 80 + n;
        gch = 138 + snow * 80 + n;
        bl = 132 + snow * 90;
      } else {
        r = 110 + h * 40 + n;
        gch = 124 + h * 28 + n * 0.5;
        bl = 62;
      }
      const shade = 0.82 + h * 0.35;
      let rgb: [number, number, number] = [
        Phaser.Math.Clamp(r * shade, 0, 255),
        Phaser.Math.Clamp(gch * shade, 0, 255),
        Phaser.Math.Clamp(bl * shade, 0, 255),
      ];
      const tile = tiles?.[b];
      if (tile && biomeSolid(biome, x, y, b)) {
        const tw = tile.width;
        const th = tile.height;
        const to = ((y % th) * tw + (x % tw)) * 4;
        const ta = 0.52;
        rgb = [
          overlayChan(rgb[0], tile.data[to]!, ta),
          overlayChan(rgb[1], tile.data[to + 1]!, ta),
          overlayChan(rgb[2], tile.data[to + 2]!, ta),
        ];
      }
      const o = i * 4;
      d[o] = rgb[0];
      d[o + 1] = rgb[1];
      d[o + 2] = rgb[2];
      d[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

export function applyTerrainLight(canvas: HTMLCanvasElement, height: Float32Array): void {
  const g = canvas.getContext("2d")!;
  const img = g.getImageData(0, 0, TEX, TEX);
  const d = img.data;
  const lx = -0.64;
  const ly = -0.44;
  const lz = 0.62;
  const hs = 52;
  for (let y = 1; y < TEX - 1; y++) {
    for (let x = 1; x < TEX - 1; x++) {
      const i = y * TEX + x;
      const dx = (height[i + 1]! - height[i - 1]!) * hs;
      const dy = (height[i + TEX]! - height[i - TEX]!) * hs;
      let nx = -dx;
      let ny = -dy;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;
      const ndot = Phaser.Math.Clamp(nx * lx + ny * ly + nz * lz, 0, 1);
      const lit = 0.38 + Math.pow(ndot, 1.15) * 0.82;
      const spec = Math.pow(Math.max(0, ndot - 0.48), 1.85) * 72;
      const o = i * 4;
      d[o] = Phaser.Math.Clamp(d[o]! * lit + spec, 0, 255);
      d[o + 1] = Phaser.Math.Clamp(d[o + 1]! * lit + spec * 0.92, 0, 255);
      d[o + 2] = Phaser.Math.Clamp(d[o + 2]! * lit + spec * 0.78, 0, 255);
    }
  }
  g.putImageData(img, 0, 0);
}

function texelInBiome(biome: Uint8Array, tx: number, ty: number, id: number): boolean {
  if (tx < 2 || ty < 2 || tx >= TEX - 2 || ty >= TEX - 2) return false;
  return biome[ty * TEX + tx] === id;
}

function pickBiomeTexel(biome: Uint8Array, rng: Rng, id: number): { tx: number; ty: number } | null {
  for (let k = 0; k < 80; k++) {
    const tx = rng.int(10, TEX - 11);
    const ty = rng.int(10, TEX - 11);
    if (!texelInBiome(biome, tx, ty, id)) continue;
    let n = 0;
    for (let oy = -4; oy <= 4; oy++) {
      for (let ox = -4; ox <= 4; ox++) {
        if (biome[(ty + oy) * TEX + (tx + ox)] === id) n++;
      }
    }
    if (n > 55) return { tx, ty };
  }
  return null;
}

function pushGroup(
  out: Decor[],
  biome: Uint8Array,
  rng: Rng,
  id: number,
  kinds: DecorKind[],
  count: number,
  spacing: number,
  sizeMin: number,
  sizeMax: number,
  at?: { tx: number; ty: number }
): void {
  const c = at ?? pickBiomeTexel(biome, rng, id);
  if (!c) return;
  const cols = Math.max(2, Math.ceil(Math.sqrt(count)));
  const origin = -((cols - 1) * spacing) / 2;
  for (let i = 0; i < count; i++) {
    const gx = i % cols;
    const gy = (i / cols) | 0;
    const jit = spacing * 0.22;
    const tx = Math.round(c.tx + origin + gx * spacing + rng.range(-jit, jit));
    const ty = Math.round(c.ty + origin + gy * spacing + rng.range(-jit, jit));
    if (!texelInBiome(biome, tx, ty, id)) continue;
    out.push({
      kind: rng.pick(kinds),
      x: (tx + 0.5) * SCALE,
      y: (ty + 0.5) * SCALE,
      size: rng.range(sizeMin, sizeMax),
      rot: rng.range(0, Math.PI * 2),
    });
  }
}

function placeDecor(biome: Uint8Array, rng: Rng): Decor[] {
  const out: Decor[] = [];
  const u = TEX / 1400;
  for (let i = 0; i < 52; i++)
    pushGroup(out, biome, rng, BIOME_ID.forest, ["tree", "tree", "pine", "bush"], 6 + rng.int(0, 5), 7 * u, 5.5 * u, 13 * u);
  for (let i = 0; i < 22; i++)
    pushGroup(out, biome, rng, BIOME_ID.grass, ["tree", "bush", "shrub"], 4 + rng.int(0, 4), 9 * u, 4.5 * u, 10 * u);
  for (let i = 0; i < 18; i++)
    pushGroup(out, biome, rng, BIOME_ID.grass, ["shrub", "bush", "rock"], 5 + rng.int(0, 3), 6 * u, 3.5 * u, 7 * u);
  for (let i = 0; i < 24; i++)
    pushGroup(out, biome, rng, BIOME_ID.sand, ["cactus", "cactus2", "shrub"], 3 + rng.int(0, 4), 8 * u, 4 * u, 9.5 * u);
  for (let i = 0; i < 10; i++)
    pushGroup(out, biome, rng, BIOME_ID.sand, ["rock", "boulder"], 3 + rng.int(0, 2), 7 * u, 4 * u, 8 * u);
  for (let i = 0; i < 8; i++)
    pushGroup(out, biome, rng, BIOME_ID.sand, ["palm"], 3 + rng.int(0, 2), 11 * u, 6 * u, 12 * u);
  for (let i = 0; i < 26; i++)
    pushGroup(out, biome, rng, BIOME_ID.rock, ["boulder", "rock", "rock"], 3 + rng.int(0, 3), 6 * u, 4.5 * u, 9 * u);
  for (let i = 0; i < 8; i++)
    pushGroup(out, biome, rng, BIOME_ID.rock, ["pine", "dead"], 3 + rng.int(0, 2), 10 * u, 5 * u, 11 * u);
  for (let i = 0; i < 16; i++)
    pushGroup(out, biome, rng, BIOME_ID.peak, ["snowrock", "boulder"], 3 + rng.int(0, 3), 7 * u, 4 * u, 8.5 * u);
  for (let i = 0; i < 14; i++) {
    const c = pickBiomeTexel(biome, rng, BIOME_ID.sand);
    if (!c) continue;
    let shore = false;
    for (let oy = -3; oy <= 3 && !shore; oy++) {
      for (let ox = -3; ox <= 3; ox++) {
        const b = biome[(c.ty + oy) * TEX + (c.tx + ox)]!;
        if (b === BIOME_ID.water || b === BIOME_ID.river) shore = true;
      }
    }
    if (!shore) continue;
    pushGroup(out, biome, rng, BIOME_ID.sand, ["reed", "shrub"], 5 + rng.int(0, 4), 5 * u, 3.2 * u, 6.5 * u, c);
  }
  return out;
}

export function paintHeightMap(height: Float32Array): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = TEX;
  c.height = TEX;
  const g = c.getContext("2d")!;
  const img = g.createImageData(TEX, TEX);
  const d = img.data;
  for (let y = 0; y < TEX; y++) {
    for (let x = 0; x < TEX; x++) {
      const i = y * TEX + x;
      const v = Phaser.Math.Clamp(height[i]!, 0, 1) * 255;
      const o = i * 4;
      d[o] = v;
      d[o + 1] = v;
      d[o + 2] = v;
      d[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

function findSpawn(
  height: Float32Array,
  biome: Uint8Array,
  rng: Rng
): { spawnX: number; spawnY: number } {
  for (let i = 0; i < 400; i++) {
    const tx = rng.int(TEX * 0.18, TEX * 0.35);
    const ty = rng.int(TEX * 0.18, TEX * 0.35);
    const b = biome[ty * TEX + tx]!;
    const h = height[ty * TEX + tx]!;
    if (b === BIOME_ID.grass || b === BIOME_ID.sand) {
      if (h > 0.4 && h < 0.55)
        return { spawnX: (tx + 0.5) * SCALE, spawnY: (ty + 0.5) * SCALE };
    }
  }
  return { spawnX: WORLD * 0.22, spawnY: WORLD * 0.22 };
}

function placeForces(
  height: Float32Array,
  biome: Uint8Array,
  rng: Rng,
  spawnX: number,
  spawnY: number
): { hv: HvSpec[]; spawns: Spawn[] } {
  const hv: HvSpec[] = [];
  const spawns: Spawn[] = [];
  const names = [
    ["bunker", "Command Bunker"],
    ["radar", "Radar Site"],
    ["tower", "AA Battery"],
    ["bunker", "Ammo Dump"],
    ["radar", "Forward HQ"],
  ] as const;

  const used: { x: number; y: number }[] = [{ x: spawnX, y: spawnY }];
  const count = 4;
  for (let i = 0; i < count; i++) {
    let x = 0,
      y = 0,
      ok = false;
    for (let t = 0; t < 200 && !ok; t++) {
      const tx = rng.int(80, TEX - 81);
      const ty = rng.int(80, TEX - 81);
      const b = biome[ty * TEX + tx]!;
      const h = height[ty * TEX + tx]!;
      x = (tx + 0.5) * SCALE;
      y = (ty + 0.5) * SCALE;
      if (b === BIOME_ID.water || b === BIOME_ID.river || h > 0.74) continue;
      if (Math.hypot(x - spawnX, y - spawnY) < 700) continue;
      if (used.some((u) => Math.hypot(u.x - x, u.y - y) < 900)) continue;
      ok = true;
    }
    used.push({ x, y });
    const [kind, name] = names[i]!;
    const id = `hv-${i}`;
    hv.push({ id, name, kind, x, y });
    spawns.push({ kind, x, y, hv: id });
    const garrison = 8 + rng.int(0, 6);
    for (let k = 0; k < garrison; k++) {
      const a = rng.range(0, Math.PI * 2);
      const d = rng.range(60, 280);
      const gx = x + Math.cos(a) * d;
      const gy = y + Math.sin(a) * d;
      if (isWaterAt(biome, gx, gy)) continue;
      spawns.push({
        kind: rng.chance(0.35) ? "tank" : rng.chance(0.2) ? "tower" : "soldier",
        x: gx,
        y: gy,
      });
    }
    if (rng.chance(0.7)) {
      spawns.push({
        kind: "heli",
        x: x + rng.range(-200, 200),
        y: y + rng.range(-200, 200),
      });
    }
  }

  for (let i = 0; i < 18; i++) {
    const tx = rng.int(60, TEX - 61);
    const ty = rng.int(60, TEX - 61);
    const b = biome[ty * TEX + tx]!;
    const x = (tx + 0.5) * SCALE;
    const y = (ty + 0.5) * SCALE;
    if (Math.hypot(x - spawnX, y - spawnY) < 400) continue;
    if (b === BIOME_ID.water || b === BIOME_ID.river) {
      spawns.push({ kind: "boat", x, y });
    } else if (b !== BIOME_ID.peak) {
      spawns.push({
        kind: rng.chance(0.4) ? "tank" : rng.chance(0.15) ? "heli" : "soldier",
        x,
        y,
      });
    }
  }
  return { hv, spawns };
}

function isWaterAt(biome: Uint8Array, x: number, y: number): boolean {
  const tx = Phaser.Math.Clamp(Math.floor((x / WORLD) * TEX), 0, TEX - 1);
  const ty = Phaser.Math.Clamp(Math.floor((y / WORLD) * TEX), 0, TEX - 1);
  const b = biome[ty * TEX + tx]!;
  return b === BIOME_ID.water || b === BIOME_ID.river;
}
