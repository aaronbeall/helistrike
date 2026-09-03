import { fbm } from "./noise";
import { Rng } from "./rng";
import type { UnitKind } from "./roster";

export const WORLD = 5600;
export const TEX = 1800;
export const SCALE = WORLD / TEX;
export const WRECK_TEX = 4096;

export type Biome = "water" | "river" | "sand" | "grass" | "forest" | "rock" | "peak";

export type HvKind = "bunker" | "radar" | "tower" | "fob" | "lookout" | "officer";

export interface HvSpec {
  id: string;
  name: string;
  kind: HvKind;
  x: number;
  y: number;
}

export interface Spawn {
  kind: UnitKind;
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

export function doodadTex(kind: DecorKind): string {
  return `doodad_${kind}`;
}

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

export type WorldGen = Omit<WorldData, "canvas"> & { terrain: ImageData };
export type WorldProgress = (t: number, label: string) => void;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
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
/** Bank width as a multiple of local river half-width (2 = full river width each side). */
export const RIVER_BANK_MUL = 4.4;
export const RIVER_BANK_MIN = 6.5;
/** How much bank width wanders (0 = smooth, 1 = wild). */
export const RIVER_BANK_WOBBLE = 0.62;
/** Extra height jitter on the ramp. */
export const RIVER_BANK_ROUGH = 0.038;
const HEIGHT_BANDS: { lo: number; hi: number; k: number }[] = [
  { lo: 0, hi: H_WATER, k: 2.7 },
  { lo: H_WATER, hi: H_SAND, k: 2.35 },
  { lo: H_SAND, hi: H_ROCK, k: 2.9 },
  { lo: H_ROCK, hi: H_PEAK, k: 2.55 },
  { lo: H_PEAK, hi: 1.08, k: 2.45 },
];

export function generateWorld(
  seed: number,
  tiles?: (ImageData | null)[],
  onProgress?: WorldProgress
): WorldGen {
  const rng = new Rng(seed);
  const height = new Float32Array(TEX * TEX);
  const moisture = new Float32Array(TEX * TEX);
  const biome = new Uint8Array(TEX * TEX);

  onProgress?.(0.02, "relief");
  for (let y = 0; y < TEX; y++) {
    if (y % 150 === 0) onProgress?.(0.02 + (y / TEX) * 0.28, "relief");
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

  onProgress?.(0.32, "river carve");
  const riverRad = new Float32Array(TEX * TEX);
  carveRivers(height, biome, rng, riverRad);
  onProgress?.(0.52, "biomes");

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

  onProgress?.(0.58, "river banks");
  const bankT = stampRiverBanks(biome, riverRad, seed);
  onProgress?.(0.74, "elevation");

  const raw = new Float32Array(height);
  const bed = H_WATER - 0.02;
  for (let i = 0; i < height.length; i++) {
    height[i] = remapBand(height[i]!);
    if (biome[i] === BIOME_ID.river) {
      height[i] = Math.min(height[i]!, bed);
    } else if (bankT[i]! >= 0) {
      const t = bankT[i]!;
      const x = i % TEX;
      const y = (i / TEX) | 0;
      const n1 = fbm(x * 0.09, y * 0.09, seed + 61, 4);
      const n2 = fbm(x * 0.28, y * 0.28, seed + 77, 3);
      let s = t * t * (3 - 2 * t);
      s = clamp(s + (n1 - 0.5) * 0.42, 0, 1);
      height[i] = lerp(bed, height[i]!, s);
      height[i] += (n2 - 0.5) * RIVER_BANK_ROUGH * (1 - Math.abs(t * 2 - 1));
    }
  }

  onProgress?.(0.82, "terrain paint");
  const terrain = paintTerrain(raw, biome, seed, tiles, bankT, onProgress);
  onProgress?.(0.96, "force laydown");
  const { spawnX, spawnY } = findSpawn(height, biome, rng);
  const { hv, spawns } = placeForces(height, biome, rng, spawnX, spawnY);
  const decor = placeDecor(biome, rng);
  const trees = decor.filter((d) => d.kind === "tree" || d.kind === "pine" || d.kind === "palm").map((d) => ({ x: d.x, y: d.y }));
  const rocks = decor.filter((d) => d.kind === "rock" || d.kind === "boulder" || d.kind === "snowrock").map((d) => ({ x: d.x, y: d.y }));

  onProgress?.(1, "ready");
  return { seed, height, biome, spawnX, spawnY, hv, spawns, trees, rocks, decor, terrain };
}

export function imageDataToCanvas(img: ImageData): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  c.getContext("2d")!.putImageData(img, 0, 0);
  return c;
}

export function worldFromGen(g: WorldGen): WorldData {
  const { terrain, ...rest } = g;
  return { ...rest, canvas: imageDataToCanvas(terrain) };
}

export function generateWorldAsync(
  seed: number,
  tiles: (ImageData | null)[],
  onProgress?: WorldProgress
): Promise<WorldData> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./world.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (ev: MessageEvent<{ type: "progress"; t: number; label: string } | { type: "done"; world: WorldGen }>) => {
      const msg = ev.data;
      if (msg.type === "progress") {
        onProgress?.(msg.t, msg.label);
        return;
      }
      worker.terminate();
      resolve(worldFromGen(msg.world));
    };
    worker.onerror = (err) => {
      worker.terminate();
      reject(err);
    };
    worker.postMessage({ seed, tiles });
  });
}

export function sampleHeight(world: WorldData, x: number, y: number): number {
  const tx = clamp((x / WORLD) * TEX, 0, TEX - 1.001);
  const ty = clamp((y / WORLD) * TEX, 0, TEX - 1.001);
  const x0 = Math.floor(tx);
  const y0 = Math.floor(ty);
  const fx = tx - x0;
  const fy = ty - y0;
  const h00 = world.height[y0 * TEX + x0]!;
  const h10 = world.height[y0 * TEX + Math.min(x0 + 1, TEX - 1)]!;
  const h01 = world.height[Math.min(y0 + 1, TEX - 1) * TEX + x0]!;
  const h11 =
    world.height[Math.min(y0 + 1, TEX - 1) * TEX + Math.min(x0 + 1, TEX - 1)]!;
  return lerp(
    lerp(h00, h10, fx),
    lerp(h01, h11, fx),
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
  const tx = clamp(Math.floor((x / WORLD) * TEX), 0, TEX - 1);
  const ty = clamp(Math.floor((y / WORLD) * TEX), 0, TEX - 1);
  return world.biome[ty * TEX + tx]!;
}

export const Z_LIFT = 0.05;
export const Z_CAM = 480;
export const Z_SCALE_NEAR = 96;
/** Height-map value at or below this becomes groundZ 0. */
export const GROUND_H_ZERO = 0.16;
/** World Z per unit of height-map above GROUND_H_ZERO. Peak ≈ (0.94 - GROUND_H_ZERO) * this. */
export const GROUND_Z_SCALE = 258;

export function screenLift(z: number): number {
  return z * Z_LIFT;
}

export function zScale(z: number): number {
  const d = Math.max(Z_SCALE_NEAR, Z_CAM - z);
  return Z_CAM / d;
}

export function groundZ(world: WorldData, x: number, y: number): number {
  const h = sampleHeight(world, x, y);
  return Math.max(0, (h - GROUND_H_ZERO) * GROUND_Z_SCALE);
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

function carveRivers(height: Float32Array, biome: Uint8Array, rng: Rng, riverRad: Float32Array): void {
  const channel = new Int32Array(TEX * TEX);
  const discharge = new Float32Array(TEX * TEX);
  channel.fill(-1);
  let made = 0;
  for (let attempt = 0; attempt < 160 && made < 50; attempt++) {
    let x = rng.int(40, TEX - 41);
    let y = rng.int(40, TEX - 41);
    let best = -1;
    for (let k = 0; k < 50; k++) {
      const sx = rng.int(24, TEX - 25);
      const sy = rng.int(24, TEX - 25);
      const h = height[sy * TEX + sx]!;
      if (h > best) {
        best = h;
        x = sx;
        y = sy;
      }
    }
    if (best < 0.52) continue;
    const rolled = rollMarble(height, x, y, rng, channel);
    if (!rolled) continue;
    const { path, joinAt } = rolled;
    if (path.length < (joinAt >= 0 ? 24 : 70)) continue;
    const jitterEnd = joinAt >= 0 ? joinAt : path.length;
    jitterPath(path, 1, jitterEnd, rng);
    if (joinAt >= 0) followChannel(path, channel, path[joinAt]!, path[joinAt]!.spd);
    accumulateFlow(path, joinAt, discharge);
    for (const p of path) stampRiver(biome, riverRad, p.x, p.y, radFromFlow(p.flow));
    for (const pond of rolled.ponds) {
      const outlet = pond.spill ?? path[path.length - 1]!;
      const oi = outlet.y * TEX + outlet.x;
      for (const c of pond.cells) {
        const i = c.y * TEX + c.x;
        biome[i] = BIOME_ID.river;
        riverRad[i] = Math.max(riverRad[i]!, 2.5);
        if (channel[i]! < 0) channel[i] = oi;
      }
    }
    registerChannel(path, channel);
    registerDischarge(path, discharge);
    made++;
  }
}

type RiverPt = { x: number; y: number; spd: number; flow: number };

function radFromFlow(flow: number): number {
  return 0.4 + Math.min(12, 0.16 * Math.sqrt(flow) + 0.0075 * flow);
}

function accumulateFlow(path: RiverPt[], joinAt: number, discharge: Float32Array): void {
  let flow = 0.08;
  for (let i = 0; i < path.length; i++) {
    const p = path[i]!;
    if (joinAt >= 0 && i === joinAt) {
      flow += discharge[p.y * TEX + p.x]!;
    }
    if (joinAt >= 0 && i > joinAt) {
      flow = Math.max(flow, discharge[p.y * TEX + p.x]!);
      flow += p.spd * 0.22;
    } else {
      flow += p.spd;
    }
    p.flow = flow;
  }
}

function registerDischarge(path: RiverPt[], discharge: Float32Array): void {
  for (const p of path) {
    const i = p.y * TEX + p.x;
    discharge[i] = Math.max(discharge[i]!, p.flow);
  }
}

function jitterPath(path: RiverPt[], lo: number, hi: number, rng: Rng): void {
  const end = Math.min(hi, path.length);
  for (let i = lo; i < end - 1; i++) {
    const a = path[i - 1]!;
    const c = path[i + 1]!;
    const b = path[i]!;
    const dx = c.x - a.x;
    const dy = c.y - a.y;
    const d = Math.hypot(dx, dy) || 1;
    const j = rng.range(-2.6, 2.6);
    b.x = clamp(Math.round(b.x + (-dy / d) * j), 1, TEX - 2);
    b.y = clamp(Math.round(b.y + (dx / d) * j), 1, TEX - 2);
  }
}

function followChannel(path: RiverPt[], channel: Int32Array, from: RiverPt, spd: number): void {
  let i = from.y * TEX + from.x;
  let hops = 0;
  let flow = spd;
  const seen = new Set<number>();
  while (i >= 0 && hops++ < 20000) {
    if (seen.has(i)) break;
    seen.add(i);
    const x = i % TEX;
    const y = (i / TEX) | 0;
    const last = path[path.length - 1]!;
    if (last.x !== x || last.y !== y) path.push({ x, y, spd: flow, flow: 0 });
    const n = channel[i]!;
    if (n < 0 || n === i) break;
    i = n;
  }
}

function nearbyChannel(channel: Int32Array, ix: number, iy: number): number {
  for (let oy = -2; oy <= 2; oy++) {
    for (let ox = -2; ox <= 2; ox++) {
      const xx = ix + ox;
      const yy = iy + oy;
      if (xx < 0 || yy < 0 || xx >= TEX || yy >= TEX) continue;
      const i = yy * TEX + xx;
      if (channel[i]! >= 0) return i;
    }
  }
  return -1;
}

function registerChannel(path: RiverPt[], channel: Int32Array): void {
  for (let k = 0; k < path.length - 1; k++) {
    const a = path[k]!;
    const b = path[k + 1]!;
    const i = a.y * TEX + a.x;
    if (channel[i]! < 0) channel[i] = b.y * TEX + b.x;
  }
}

type Pond = { cells: { x: number; y: number }[]; spill: { x: number; y: number } | null };

function estimateFlow(path: RiverPt[]): number {
  let f = 0.08;
  for (const p of path) f += p.spd;
  return f;
}

function maxPondArea(flow: number): number {
  const r = radFromFlow(flow);
  return Math.round(clamp(40 + r * r * 15, 56, 2100));
}

function kickDownhill(
  height: Float32Array,
  fx: number,
  fy: number,
  rng: Rng,
  mag: number
): { vx: number; vy: number } {
  const kick = slopeAccel(height, fx, fy);
  const klen = Math.hypot(kick.ax, kick.ay);
  if (klen > 1e-8) return { vx: (kick.ax / klen) * mag, vy: (kick.ay / klen) * mag };
  const a = rng.range(0, Math.PI * 2);
  return { vx: Math.cos(a) * mag, vy: Math.sin(a) * mag };
}

function rollMarble(
  height: Float32Array,
  sx: number,
  sy: number,
  rng: Rng,
  channel: Int32Array
): { path: RiverPt[]; joinAt: number; ponds: Pond[] } | null {
  const path: RiverPt[] = [{ x: sx, y: sy, spd: 0.2, flow: 0 }];
  const ponds: Pond[] = [];
  let fx = sx + 0.5;
  let fy = sy + 0.5;
  let { vx, vy } = kickDownhill(height, fx, fy, rng, 0.35);
  let lastI = sy * TEX + sx;
  let still = 0;
  let resumes = 0;
  const G = 18;
  const drag = 0.978;
  const maxSpd = 1.25;
  for (let step = 0; step < 18000; step++) {
    const { ax, ay } = slopeAccel(height, fx, fy);
    vx += ax * G;
    vy += ay * G;
    vx *= drag;
    vy *= drag;
    let spd = Math.hypot(vx, vy);
    if (spd > maxSpd) {
      vx = (vx / spd) * maxSpd;
      vy = (vy / spd) * maxSpd;
      spd = maxSpd;
    }
    fx += vx;
    fy += vy;
    if (fx < 2 || fy < 2 || fx > TEX - 3 || fy > TEX - 3) break;
    const ix = clamp(Math.round(fx), 0, TEX - 1);
    const iy = clamp(Math.round(fy), 0, TEX - 1);
    const i = iy * TEX + ix;
    if (i !== lastI) {
      const hit = path.length > 12 ? nearbyChannel(channel, ix, iy) : -1;
      if (hit >= 0) {
        path.push({ x: hit % TEX, y: (hit / TEX) | 0, spd, flow: 0 });
        return { path, joinAt: path.length - 1, ponds };
      }
      path.push({ x: ix, y: iy, spd, flow: 0 });
      lastI = i;
    }
    if (sampleH(height, fx, fy) < H_WATER) break;
    if (spd < 0.045) still++;
    else still = 0;
    if (still <= 35) continue;
    if (path.length < 20 || resumes >= 8) break;
    const pond = fillBasin(height, ix, iy, maxPondArea(estimateFlow(path)));
    if (pond.cells.length >= 8) ponds.push(pond);
    if (!pond.spill) break;
    resumes++;
    fx = pond.spill.x + 0.5;
    fy = pond.spill.y + 0.5;
    ({ vx, vy } = kickDownhill(height, fx, fy, rng, 0.42));
    still = 0;
    lastI = pond.spill.y * TEX + pond.spill.x;
    path.push({ x: pond.spill.x, y: pond.spill.y, spd: 0.42, flow: 0 });
  }
  return { path, joinAt: -1, ponds };
}

type HeapItem = { h: number; i: number };

function heapPush(heap: HeapItem[], x: HeapItem): void {
  heap.push(x);
  let i = heap.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (heap[p]!.h <= heap[i]!.h) break;
    const t = heap[p]!;
    heap[p] = heap[i]!;
    heap[i] = t;
    i = p;
  }
}

function heapPop(heap: HeapItem[]): HeapItem | undefined {
  const top = heap[0];
  const last = heap.pop();
  if (!last || heap.length === 0) return top;
  heap[0] = last;
  let i = 0;
  for (;;) {
    let s = i;
    const l = i * 2 + 1;
    const r = l + 1;
    if (l < heap.length && heap[l]!.h < heap[s]!.h) s = l;
    if (r < heap.length && heap[r]!.h < heap[s]!.h) s = r;
    if (s === i) break;
    const t = heap[i]!;
    heap[i] = heap[s]!;
    heap[s] = t;
    i = s;
  }
  return top;
}

function fillBasin(
  height: Float32Array,
  ox: number,
  oy: number,
  maxArea: number
): Pond {
  let x = ox;
  let y = oy;
  for (let g = 0; g < 80; g++) {
    let best = height[y * TEX + x]!;
    let bx = x;
    let by = y;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 1 || ny < 1 || nx >= TEX - 1 || ny >= TEX - 1) continue;
        const h = height[ny * TEX + nx]!;
        if (h < best) {
          best = h;
          bx = nx;
          by = ny;
        }
      }
    }
    if (bx === x && by === y) break;
    x = bx;
    y = by;
  }
  const visited = new Set<number>();
  const heap: HeapItem[] = [];
  const seed = y * TEX + x;
  heapPush(heap, { h: height[seed]!, i: seed });
  visited.add(seed);
  const cells: { x: number; y: number }[] = [];
  let water = height[seed]!;
  let spill: { x: number; y: number } | null = null;
  while (heap.length) {
    const cur = heapPop(heap)!;
    water = Math.max(water, cur.h);
    cells.push({ x: cur.i % TEX, y: (cur.i / TEX) | 0 });
    if (cells.length >= maxArea) {
      spill = null;
      break;
    }
    const cx = cur.i % TEX;
    const cy = (cur.i / TEX) | 0;
    let drained = false;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 1 || ny < 1 || nx >= TEX - 1 || ny >= TEX - 1) {
          drained = true;
          continue;
        }
        const ni = ny * TEX + nx;
        if (visited.has(ni)) continue;
        const nh = height[ni]!;
        if (nh < H_WATER) {
          drained = true;
          continue;
        }
        if (nh < water - 0.002) {
          spill = { x: nx, y: ny };
          break;
        }
        visited.add(ni);
        heapPush(heap, { h: nh, i: ni });
      }
      if (spill) break;
    }
    if (spill) break;
    if (drained && cells.length > 12) {
      spill = null;
      break;
    }
  }
  return { cells, spill };
}

function slopeAccel(height: Float32Array, fx: number, fy: number): { ax: number; ay: number } {
  const e = 2.4;
  const ax = (sampleH(height, fx - e, fy) - sampleH(height, fx + e, fy)) / (2 * e);
  const ay = (sampleH(height, fx, fy - e) - sampleH(height, fx, fy + e)) / (2 * e);
  return { ax, ay };
}

function sampleH(height: Float32Array, x: number, y: number): number {
  const tx = clamp(x, 0, TEX - 1.001);
  const ty = clamp(y, 0, TEX - 1.001);
  const x0 = Math.floor(tx);
  const y0 = Math.floor(ty);
  const x1 = Math.min(x0 + 1, TEX - 1);
  const y1 = Math.min(y0 + 1, TEX - 1);
  const fx = tx - x0;
  const fy = ty - y0;
  const h00 = height[y0 * TEX + x0]!;
  const h10 = height[y0 * TEX + x1]!;
  const h01 = height[y1 * TEX + x0]!;
  const h11 = height[y1 * TEX + x1]!;
  return lerp(lerp(h00, h10, fx), lerp(h01, h11, fx), fy);
}

function stampRiver(biome: Uint8Array, riverRad: Float32Array, x: number, y: number, rad: number): void {
  const r = Math.max(rad, 0.5);
  const ir = Math.ceil(r);
  const r2 = r * r;
  for (let oy = -ir; oy <= ir; oy++) {
    for (let ox = -ir; ox <= ir; ox++) {
      if (ox * ox + oy * oy > r2) continue;
      const xx = x + ox;
      const yy = y + oy;
      if (xx < 0 || yy < 0 || xx >= TEX || yy >= TEX) continue;
      const i = yy * TEX + xx;
      biome[i] = BIOME_ID.river;
      if (r > riverRad[i]!) riverRad[i] = r;
    }
  }
}

function stampRiverBanks(biome: Uint8Array, riverRad: Float32Array, seed: number): Float32Array {
  const dist = new Float32Array(TEX * TEX);
  const wid = new Float32Array(TEX * TEX);
  dist.fill(1e9);
  const reach = 1 + RIVER_BANK_WOBBLE + 0.2;
  for (let y = 0; y < TEX; y++) {
    for (let x = 0; x < TEX; x++) {
      const i = y * TEX + x;
      if (biome[i] !== BIOME_ID.river) continue;
      const base = Math.max(riverRad[i]! * RIVER_BANK_MUL, RIVER_BANK_MIN);
      const ir = Math.ceil(base * reach);
      for (let oy = -ir; oy <= ir; oy++) {
        for (let ox = -ir; ox <= ir; ox++) {
          const d = Math.hypot(ox, oy);
          if (d < 0.001 || d > base * reach) continue;
          const xx = x + ox;
          const yy = y + oy;
          if (xx < 0 || yy < 0 || xx >= TEX || yy >= TEX) continue;
          const j = yy * TEX + xx;
          const b = biome[j]!;
          if (b === BIOME_ID.river || b === BIOME_ID.water || b === BIOME_ID.peak) continue;
          if (d < dist[j]!) {
            dist[j] = d;
            wid[j] = base;
          }
        }
      }
    }
  }
  const tOut = new Float32Array(TEX * TEX);
  tOut.fill(-1);
  for (let i = 0; i < tOut.length; i++) {
    if (dist[i]! >= 1e8) continue;
    const x = i % TEX;
    const y = (i / TEX) | 0;
    const wob = fbm(x * 0.065, y * 0.065, seed + 41, 4);
    const scallop = fbm(x * 0.17 + 8, y * 0.17, seed + 53, 3);
    const localW = wid[i]! * (1 + (wob * 2 - 1) * RIVER_BANK_WOBBLE + (scallop - 0.5) * 0.4);
    if (dist[i]! > localW) continue;
    tOut[i] = dist[i]! / Math.max(localW, 1e-6);
    biome[i] = BIOME_ID.sand;
  }
  return tOut;
}

function terrace(t: number, k: number): number {
  const u = clamp(t, 0, 1) * 2 - 1;
  const a = Math.abs(u);
  if (a < 1e-8) return 0.5;
  return 0.5 + 0.5 * Math.sign(u) * Math.pow(a, k);
}

function remapBand(h: number): number {
  const x = clamp(h, 0, 1);
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

function shadeTerrainTexel(
  raw: Float32Array,
  biome: Uint8Array,
  seed: number,
  tiles: (ImageData | null)[] | undefined,
  bankT: Float32Array | undefined,
  x: number,
  y: number
): [number, number, number] {
  const i = y * TEX + x;
  const h = raw[i]!;
  const b = biome[i]!;
  const n = fbm(x * 0.08, y * 0.08, seed + 99, 2) * 18 - 9;
  let r = 0,
    gch = 0,
    bl = 0;
  if (b === BIOME_ID.water) {
    const deep = clamp((H_WATER - h) * 4, 0, 1);
    r = 28 + n * 0.3;
    gch = 72 - deep * 22;
    bl = 92 - deep * 10;
  } else if (b === BIOME_ID.river) {
    r = 48 + n * 0.25;
    gch = 52 + n * 0.2;
    bl = 40;
  } else if (b === BIOME_ID.sand) {
    const wet = bankT && bankT[i]! >= 0 ? 1 - bankT[i]! : 0;
    r = 196 + n - wet * 72;
    gch = 168 + n * 0.6 - wet * 48;
    bl = 112 - wet * 18;
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
    clamp(r * shade, 0, 255),
    clamp(gch * shade, 0, 255),
    clamp(bl * shade, 0, 255),
  ];
  const tile = tiles?.[b];
  const riverBed = b === BIOME_ID.river && tile;
  const bank = !!(bankT && bankT[i]! >= 0);
  const sandTile = tiles?.[BIOME_ID.sand];
  if (riverBed) {
    const tw = tile.width;
    const th = tile.height;
    const to = ((y % th) * tw + (x % tw)) * 4;
    rgb = [
      overlayChan(rgb[0], tile.data[to]!, 0.7),
      overlayChan(rgb[1], tile.data[to + 1]!, 0.7),
      overlayChan(rgb[2], tile.data[to + 2]!, 0.7),
    ];
  } else if (bank && sandTile) {
    const tw = sandTile.width;
    const th = sandTile.height;
    const to = ((y % th) * tw + (x % tw)) * 4;
    const ta = 0.48 + (1 - bankT![i]!) * 0.28;
    rgb = [
      overlayChan(rgb[0], sandTile.data[to]!, ta),
      overlayChan(rgb[1], sandTile.data[to + 1]!, ta),
      overlayChan(rgb[2], sandTile.data[to + 2]!, ta),
    ];
  } else if (tile && biomeSolid(biome, x, y, b)) {
    const tw = tile.width;
    const th = tile.height;
    const to = ((y % th) * tw + (x % tw)) * 4;
    rgb = [
      overlayChan(rgb[0], tile.data[to]!, 0.52),
      overlayChan(rgb[1], tile.data[to + 1]!, 0.52),
      overlayChan(rgb[2], tile.data[to + 2]!, 0.52),
    ];
  }
  return rgb;
}

function overlayChan(base: number, tex: number, a: number): number {
  const b = base / 255;
  const t = tex / 255;
  const o = b < 0.5 ? 2 * b * t : 1 - 2 * (1 - b) * (1 - t);
  return clamp((b * (1 - a) + o * a) * 255, 0, 255);
}

function paintTerrain(
  raw: Float32Array,
  biome: Uint8Array,
  seed: number,
  tiles?: (ImageData | null)[],
  bankT?: Float32Array,
  onProgress?: WorldProgress
): ImageData {
  const img = new ImageData(TEX, TEX);
  const d = img.data;
  for (let y = 0; y < TEX; y++) {
    if (y % 150 === 0) onProgress?.(0.82 + (y / TEX) * 0.13, "terrain paint");
    for (let x = 0; x < TEX; x++) {
      const rgb = shadeTerrainTexel(raw, biome, seed, tiles, bankT, x, y);
      const o = (y * TEX + x) * 4;
      d[o] = rgb[0];
      d[o + 1] = rgb[1];
      d[o + 2] = rgb[2];
      d[o + 3] = 255;
    }
  }
  return img;
}

function lightTerrainPixel(
  d: Uint8ClampedArray,
  height: Float32Array,
  x: number,
  y: number,
  stride: number,
  ox: number,
  oy: number
): void {
  const i = y * TEX + x;
  const dx = (height[i + 1]! - height[i - 1]!) * 52;
  const dy = (height[i + TEX]! - height[i - TEX]!) * 52;
  let nx = -dx;
  let ny = -dy;
  let nz = 1;
  const len = Math.hypot(nx, ny, nz) || 1;
  nx /= len;
  ny /= len;
  nz /= len;
  const ndot = clamp(nx * -0.64 + ny * -0.44 + nz * 0.62, 0, 1);
  const lit = 0.38 + Math.pow(ndot, 1.15) * 0.82;
  const spec = Math.pow(Math.max(0, ndot - 0.48), 1.85) * 72;
  const o = ((y - oy) * stride + (x - ox)) * 4;
  d[o] = clamp(d[o]! * lit + spec, 0, 255);
  d[o + 1] = clamp(d[o + 1]! * lit + spec * 0.92, 0, 255);
  d[o + 2] = clamp(d[o + 2]! * lit + spec * 0.78, 0, 255);
}

export function applyTerrainLight(canvas: HTMLCanvasElement, height: Float32Array): void {
  const g = canvas.getContext("2d")!;
  const img = g.getImageData(0, 0, TEX, TEX);
  const d = img.data;
  for (let y = 1; y < TEX - 1; y++) {
    for (let x = 1; x < TEX - 1; x++) {
      lightTerrainPixel(d, height, x, y, TEX, 0, 0);
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
      const v = clamp(height[i]!, 0, 1) * 255;
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

export function paintHeightMapRect(
  canvas: HTMLCanvasElement,
  height: Float32Array,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): void {
  const g = canvas.getContext("2d")!;
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const img = g.createImageData(w, h);
  const d = img.data;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const v = clamp(height[y * TEX + x]!, 0, 1) * 255;
      const o = ((y - y0) * w + (x - x0)) * 4;
      d[o] = v;
      d[o + 1] = v;
      d[o + 2] = v;
      d[o + 3] = 255;
    }
  }
  g.putImageData(img, x0, y0);
}

export type HeightStamp = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

function sampleMask(mask: Float32Array, w: number, h: number, u: number, v: number): number {
  if (u < 0 || v < 0 || u > 1 || v > 1) return 0;
  const x = clamp(u, 0, 1) * (w - 1.001);
  const y = clamp(v, 0, 1) * (h - 1.001);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const x1 = Math.min(x0 + 1, w - 1);
  const y1 = Math.min(y0 + 1, h - 1);
  const a = mask[y0 * w + x0]!;
  const b = mask[y0 * w + x1]!;
  const c = mask[y1 * w + x0]!;
  const d = mask[y1 * w + x1]!;
  return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
}

export function stampHeightBrush(
  height: Float32Array,
  mask: Float32Array,
  mw: number,
  mh: number,
  wx: number,
  wy: number,
  size: number,
  rot: number,
  offX: number,
  offY: number,
  invert: boolean,
  strength: number
): HeightStamp {
  const tx = wx / SCALE;
  const ty = wy / SCALE;
  const rad = Math.max(4, size / SCALE);
  const c = Math.cos(-rot);
  const s = Math.sin(-rot);
  const x0 = clamp(Math.floor(tx - rad - 2), 1, TEX - 2);
  const y0 = clamp(Math.floor(ty - rad - 2), 1, TEX - 2);
  const x1 = clamp(Math.ceil(tx + rad + 2), 1, TEX - 2);
  const y1 = clamp(Math.ceil(ty + rad + 2), 1, TEX - 2);
  const k = clamp(strength, 0, 1);
  const target = invert ? 0 : 1;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const lx = (x + 0.5 - tx) / rad;
      const ly = (y + 0.5 - ty) / rad;
      const rx = lx * c - ly * s - offX;
      const ry = lx * s + ly * c - offY;
      const u = (rx + 1) * 0.5;
      const v = (ry + 1) * 0.5;
      const m = sampleMask(mask, mw, mh, u, v);
      const a = m * k;
      if (a < 0.004) continue;
      const i = y * TEX + x;
      height[i] = clamp(lerp(height[i]!, target, a), 0, 1);
    }
  }
  return { x0, y0, x1, y1 };
}

function assignBiomeFromHeight(biome: Uint8Array, height: Float32Array, seed: number, x: number, y: number): void {
  const i = y * TEX + x;
  const h = height[i]!;
  if (biome[i] === BIOME_ID.river && h < H_SAND) return;
  const m = fbm((x / TEX) * 5.4 + 40, (y / TEX) * 5.4, seed + 17, 4);
  if (h < H_WATER) biome[i] = BIOME_ID.water;
  else if (h < H_SAND) biome[i] = BIOME_ID.sand;
  else if (h > H_PEAK) biome[i] = BIOME_ID.peak;
  else if (h > H_ROCK) biome[i] = BIOME_ID.rock;
  else if (m > 0.58 && h < 0.58) biome[i] = BIOME_ID.forest;
  else biome[i] = BIOME_ID.grass;
}

export function rebuildWorldPatch(
  world: WorldData,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  tiles: (ImageData | null)[],
  restamp?: (g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) => void
): void {
  x0 = clamp(Math.floor(x0), 1, TEX - 2);
  y0 = clamp(Math.floor(y0), 1, TEX - 2);
  x1 = clamp(Math.ceil(x1), 1, TEX - 2);
  y1 = clamp(Math.ceil(y1), 1, TEX - 2);
  if (x1 < x0 || y1 < y0) return;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      assignBiomeFromHeight(world.biome, world.height, world.seed, x, y);
    }
  }
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const img = new ImageData(w, h);
  const d = img.data;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const rgb = shadeTerrainTexel(world.height, world.biome, world.seed, tiles, undefined, x, y);
      const o = ((y - y0) * w + (x - x0)) * 4;
      d[o] = rgb[0];
      d[o + 1] = rgb[1];
      d[o + 2] = rgb[2];
      d[o + 3] = 255;
    }
  }
  const g = world.canvas.getContext("2d")!;
  g.putImageData(img, x0, y0);
  restamp?.(g, x0, y0, x1, y1);
  const lit = g.getImageData(x0, y0, w, h);
  const ly0 = Math.max(1, y0);
  const ly1 = Math.min(TEX - 2, y1);
  const lx0 = Math.max(1, x0);
  const lx1 = Math.min(TEX - 2, x1);
  for (let y = ly0; y <= ly1; y++) {
    for (let x = lx0; x <= lx1; x++) {
      lightTerrainPixel(lit.data, world.height, x, y, w, x0, y0);
    }
  }
  g.putImageData(lit, x0, y0);
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
  const names: [HvKind, string][] = [
    ["bunker", "Command Bunker"],
    ["radar", "Radar Site"],
    ["tower", "AA Battery"],
    ["fob", "Forward Base"],
    ["lookout", "Lookout Post"],
    ["officer", "Field Officer"],
    ["bunker", "Ammo Dump"],
    ["radar", "Forward HQ"],
  ];
  for (let i = names.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    const tmp = names[i]!;
    names[i] = names[j]!;
    names[j] = tmp;
  }

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
      spawns.push({ kind: pickGarrison(rng), x: gx, y: gy });
    }
    if (rng.chance(0.55)) {
      spawns.push({
        kind: rng.chance(0.5) ? "tent" : "barn",
        x: x + rng.range(-90, 90),
        y: y + rng.range(-90, 90),
      });
    }
    if (rng.chance(0.7)) {
      spawns.push({
        kind: pickAir(rng),
        x: x + rng.range(-200, 200),
        y: y + rng.range(-200, 200),
      });
    }
  }

  for (let i = 0; i < 22; i++) {
    const tx = rng.int(60, TEX - 61);
    const ty = rng.int(60, TEX - 61);
    const b = biome[ty * TEX + tx]!;
    const x = (tx + 0.5) * SCALE;
    const y = (ty + 0.5) * SCALE;
    if (Math.hypot(x - spawnX, y - spawnY) < 400) continue;
    if (b === BIOME_ID.water || b === BIOME_ID.river) {
      spawns.push({ kind: pickWater(rng), x, y });
    } else if (b !== BIOME_ID.peak) {
      spawns.push({ kind: pickPatrol(rng), x, y });
    }
  }
  return { hv, spawns };
}

function pickGarrison(rng: Rng): UnitKind {
  const r = rng.next();
  if (r < 0.12) return "tank";
  if (r < 0.2) return "lav";
  if (r < 0.26) return "sam";
  if (r < 0.34) return "pickup";
  if (r < 0.4) return "truck";
  if (r < 0.44) return "tanker";
  if (r < 0.5) return "tower";
  if (r < 0.54) return "lookout";
  if (r < 0.62) return "rpg";
  if (r < 0.7) return "gunner";
  if (r < 0.76) return "stinger";
  if (r < 0.82) return "mechanic";
  if (r < 0.86) return "officer";
  return "soldier";
}

function pickPatrol(rng: Rng): UnitKind {
  const r = rng.next();
  if (r < 0.18) return "tank";
  if (r < 0.26) return "lav";
  if (r < 0.34) return "pickup";
  if (r < 0.4) return "truck";
  if (r < 0.46) return "tanker";
  if (r < 0.52) return pickAir(rng);
  if (r < 0.58) return "rpg";
  if (r < 0.64) return "gunner";
  if (r < 0.7) return "stinger";
  if (r < 0.76) return "tent";
  if (r < 0.8) return "barn";
  return "soldier";
}

function pickAir(rng: Rng): UnitKind {
  const r = rng.next();
  if (r < 0.28) return "drone";
  if (r < 0.5) return "heli_small";
  if (r < 0.68) return "heli_heavy";
  return "heli";
}

function pickWater(rng: Rng): UnitKind {
  const r = rng.next();
  if (r < 0.18) return "battleship";
  if (r < 0.55) return "ptboat";
  return "boat";
}

function isWaterAt(biome: Uint8Array, x: number, y: number): boolean {
  const tx = clamp(Math.floor((x / WORLD) * TEX), 0, TEX - 1);
  const ty = clamp(Math.floor((y / WORLD) * TEX), 0, TEX - 1);
  const b = biome[ty * TEX + tx]!;
  return b === BIOME_ID.water || b === BIOME_ID.river;
}
