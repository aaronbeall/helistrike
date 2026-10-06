#!/usr/bin/env node
/**
 * Headless fuzz of src/sim/spatialGrid.ts against brute force: random inserts / moves / removes / mask changes,
 * unreported drift up to the slack, big entries, out-of-bounds positions, zero and infinite radii.
 *
 *   npm run spatial:check            (-- --seed 7 --steps 20000)
 */
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? Number(args[i + 1]) : d;
};
const out = await build({ entryPoints: [path.join(root, "src/sim/spatialGrid.ts")], bundle: true, format: "esm", write: false, platform: "node" });
const { SpatialGrid, SlotList } = await import(`data:text/javascript,${encodeURIComponent(out.outputFiles[0].text)}`);

let seed = opt("seed", 1) >>> 0;
const rand = () => {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const STEPS = opt("steps", 20000);
const SLACK = 24;
const W = 5600;
const g = new SpatialGrid(-480, -480, W + 480, W + 480, 128, SLACK);
/** Live entries: slot → { x, y (true position), gx, gy (last told the grid), r, m }. */
const live = new Map();
const hits = new SlotList();
let failures = 0;
let queries = 0;
let returned = 0;
const coord = () => (rand() < 0.03 ? -2000 + rand() * (W + 4000) : rand() * W);

for (let step = 0; step < STEPS; step++) {
  const op = rand();
  if (op < 0.3 || live.size < 50) {
    const slot = Math.floor(rand() * 3000);
    const e = { x: coord(), y: coord(), r: rand() < 0.05 ? 64 + rand() * 300 : rand() * 60, m: 1 << Math.floor(rand() * 4) };
    e.gx = e.x;
    e.gy = e.y;
    g.insert(slot, e.x, e.y, e.r, e.m);
    live.set(slot, e);
  } else if (op < 0.4) {
    const slot = [...live.keys()][Math.floor(rand() * live.size)];
    g.remove(slot);
    live.delete(slot);
  } else if (op < 0.6) {
    for (const [slot, e] of live) {
      if (rand() < 0.3) {
        e.x += (rand() - 0.5) * 300;
        e.y += (rand() - 0.5) * 300;
        e.gx = e.x;
        e.gy = e.y;
        g.move(slot, e.x, e.y);
      } else if (rand() < 0.1) {
        // Unreported drift within the slack.
        const a = rand() * Math.PI * 2;
        const d = rand() * SLACK * 0.999;
        e.x = e.gx + Math.cos(a) * d;
        e.y = e.gy + Math.sin(a) * d;
      }
      if (rand() < 0.02) {
        e.m = 1 << Math.floor(rand() * 4);
        g.setMask(slot, e.m);
      }
    }
  } else {
    const x = coord();
    const y = coord();
    const r = rand() < 0.02 ? Infinity : rand() < 0.1 ? 0 : rand() * 900;
    const m = rand() < 0.5 ? 15 : 1 + Math.floor(rand() * 15);
    hits.n = 0;
    g.query(x, y, r, m, hits);
    hits.sort();
    queries++;
    returned += hits.n;
    const got = new Set();
    for (let i = 0; i < hits.n; i++) {
      if (i && hits.a[i - 1] >= hits.a[i]) {
        failures++;
        console.error(`unsorted / duplicate at step ${step}`);
      }
      got.add(hits.a[i]);
    }
    for (const [slot, e] of live) {
      if (!(e.m & m)) continue;
      if (Math.hypot(e.x - x, e.y - y) > r + e.r) continue;
      if (!got.has(slot)) {
        failures++;
        if (failures < 10) console.error(`miss: step ${step} slot ${slot} d=${Math.hypot(e.x - x, e.y - y).toFixed(2)} r=${r} er=${e.r.toFixed(1)}`);
      }
    }
    for (const slot of got) {
      if (!live.has(slot)) {
        failures++;
        console.error(`removed slot ${slot} returned at step ${step}`);
      }
    }
  }
  if (g.size !== live.size) {
    failures++;
    console.error(`size ${g.size} != ${live.size} at step ${step}`);
    break;
  }
}

console.log(`[spatial-check] ${STEPS} steps, ${queries} queries, avg ${(returned / Math.max(1, queries)).toFixed(1)} hits, ${failures} failures`);
process.exit(failures ? 1 : 0);
