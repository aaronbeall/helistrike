import Phaser from "phaser";
import { fbm } from "./noise";
import { Rng } from "./rng";

export const WORLD = 5600;
export const TEX = 1400;
export const SCALE = WORLD / TEX;

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

export function generateWorld(seed: number): WorldData {
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
    if (h < 0.34) biome[i] = BIOME_ID.water;
    else if (h < 0.4) biome[i] = BIOME_ID.sand;
    else if (h > 0.72) biome[i] = BIOME_ID.peak;
    else if (h > 0.62) biome[i] = BIOME_ID.rock;
    else if (m > 0.58 && h < 0.58) biome[i] = BIOME_ID.forest;
    else biome[i] = BIOME_ID.grass;
  }

  const canvas = paintTerrain(height, biome, seed);
  const { spawnX, spawnY } = findSpawn(height, biome, rng);
  const { hv, spawns } = placeForces(height, biome, rng, spawnX, spawnY);
  const trees: { x: number; y: number }[] = [];
  const rocks: { x: number; y: number }[] = [];
  for (let i = 0; i < 900; i++) {
    const tx = rng.int(8, TEX - 9);
    const ty = rng.int(8, TEX - 9);
    const b = biome[ty * TEX + tx];
    const x = (tx + 0.5) * SCALE;
    const y = (ty + 0.5) * SCALE;
    if (b === BIOME_ID.forest && rng.chance(0.85)) trees.push({ x, y });
    else if ((b === BIOME_ID.rock || b === BIOME_ID.sand) && rng.chance(0.35))
      rocks.push({ x, y });
  }

  return { seed, height, biome, spawnX, spawnY, hv, spawns, trees, rocks, canvas };
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
  const tx = Phaser.Math.Clamp(Math.floor((x / WORLD) * TEX), 0, TEX - 1);
  const ty = Phaser.Math.Clamp(Math.floor((y / WORLD) * TEX), 0, TEX - 1);
  const b = world.biome[ty * TEX + tx]!;
  return b === BIOME_ID.water || b === BIOME_ID.river;
}

export function groundZ(world: WorldData, x: number, y: number): number {
  const h = sampleHeight(world, x, y);
  if (h < 0.34) return 0;
  return (h - 0.34) * 160;
}

function carveRivers(height: Float32Array, biome: Uint8Array, rng: Rng): void {
  for (let r = 0; r < 7; r++) {
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
    for (let step = 0; step < 1400; step++) {
      stampRiver(biome, x, y, 1 + (step % 3 === 0 ? 1 : 0));
      let nx = x;
      let ny = y;
      let nh = height[y * TEX + x]!;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          if (!ox && !oy) continue;
          const xx = x + ox;
          const yy = y + oy;
          if (xx < 1 || yy < 1 || xx >= TEX - 1 || yy >= TEX - 1) continue;
          const h = height[yy * TEX + xx]!;
          if (h < nh) {
            nh = h;
            nx = xx;
            ny = yy;
          }
        }
      }
      if (nx === x && ny === y) {
        nx += rng.int(-1, 1);
        ny += rng.int(-1, 1);
      }
      x = nx;
      y = ny;
      if (height[y * TEX + x]! < 0.33) break;
    }
  }
}

function stampRiver(biome: Uint8Array, x: number, y: number, rad: number): void {
  for (let oy = -rad; oy <= rad; oy++) {
    for (let ox = -rad; ox <= rad; ox++) {
      const xx = x + ox;
      const yy = y + oy;
      if (xx < 0 || yy < 0 || xx >= TEX || yy >= TEX) continue;
      biome[yy * TEX + xx] = BIOME_ID.river;
    }
  }
}

function paintTerrain(
  height: Float32Array,
  biome: Uint8Array,
  seed: number
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
      const h = height[i]!;
      const b = biome[i]!;
      const n = fbm(x * 0.08, y * 0.08, seed + 99, 2) * 18 - 9;
      let r = 0,
        gch = 0,
        bl = 0;
      if (b === BIOME_ID.water) {
        const deep = Phaser.Math.Clamp((0.34 - h) * 4, 0, 1);
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
      const o = i * 4;
      d[o] = Phaser.Math.Clamp(r * shade, 0, 255);
      d[o + 1] = Phaser.Math.Clamp(gch * shade, 0, 255);
      d[o + 2] = Phaser.Math.Clamp(bl * shade, 0, 255);
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
      if (b === BIOME_ID.water || b === BIOME_ID.river || h > 0.66) continue;
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
