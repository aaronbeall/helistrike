#!/usr/bin/env node
/**
 * Perf bench runner: drives the in-game harness (`?bench=…`, src/scenes/mission/debug/bench.ts) in your installed
 * Chrome via Playwright, saves results, and optionally compares or profiles.
 *
 *   npm run bench                              all scenarios
 *   npm run bench -- idle_cluster,gun_cluster  some scenarios
 *   npm run bench -- --compare docs/perf-baseline-2026-10.json
 *   npm run bench -- idle_empty --profile      CPU profile + allocation sample per scenario (timings skewed)
 *
 * Options: --compare <file>, --profile, --out <file>, --url <base> (default http://localhost:5174), --keep-open.
 * Starts the Vite dev server when nothing answers at --url.
 */
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const optValues = new Set(["compare", "out", "url"].map((n) => opt(n)).filter(Boolean));
const ids = args.filter((a) => !a.startsWith("--") && !optValues.has(a)).join(",") || "all";
const base = opt("url") ?? "http://localhost:5174";
const profile = flag("profile");
/** Chrome flags: keep the frame loop running at full rate when the window isn't focused. */
const CHROME_ARGS = [
  "--disable-background-timer-throttling",
  "--disable-renderer-backgrounding",
  "--disable-backgrounding-occluded-windows",
  "--enable-precise-memory-info",
];
const VIEWPORT = { width: 1280, height: 720 };
/** Retina, like real play: Playwright defaults to 1×, which composites a quarter of the pixels. */
const DEVICE_SCALE = 2;
/** Generous: boot bakes art, each scenario generates a world. */
const TIMEOUT_MS = 15 * 60 * 1000;
const PROFILE_TOP = 25;

async function reachable(url) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(1500) });
    return true;
  } catch {
    return false;
  }
}

async function ensureServer() {
  if (await reachable(base)) return undefined;
  const port = new URL(base).port || "5174";
  console.log(`[bench] starting dev server on ${port}`);
  const server = spawn("npx", ["vite", "--port", port, "--strictPort"], { cwd: root, stdio: "ignore", detached: false });
  for (let i = 0; i < 60; i++) {
    if (await reachable(base)) return server;
    await new Promise((r) => setTimeout(r, 500));
  }
  server.kill();
  throw new Error(`dev server did not start at ${base}`);
}

function gitSha() {
  try {
    return execSync("git rev-parse --short HEAD", { cwd: root }).toString().trim();
  } catch {
    return "nogit";
  }
}

function frameLabel(cf) {
  return `${cf.functionName || "(anon)"} ${cf.url.split("/").pop().split("?")[0]}:${cf.lineNumber + 1}`;
}

function printTop(title, map, total, fmt) {
  console.log(`  ${title}`);
  for (const [k, v] of [...map].sort((a, b) => b[1] - a[1]).slice(0, PROFILE_TOP)) {
    console.log(`    ${((v / total) * 100).toFixed(1).padStart(5)}%  ${fmt(v).padStart(10)}  ${k}`);
  }
}

/** Self time per function from a CPU profile. */
function cpuSelf(cpu) {
  const byId = new Map(cpu.nodes.map((n) => [n.id, n]));
  const self = new Map();
  cpu.samples.forEach((s, i) => {
    const k = frameLabel(byId.get(s).callFrame);
    self.set(k, (self.get(k) ?? 0) + (cpu.timeDeltas[i] ?? 0));
  });
  return self;
}

/** Allocated bytes per function from a sampling heap profile. */
function allocSelf(heap) {
  const out = new Map();
  const walk = (n) => {
    const k = frameLabel(n.callFrame);
    out.set(k, (out.get(k) ?? 0) + n.selfSize);
    n.children.forEach(walk);
  };
  walk(heap.head);
  return out;
}

/** Profile one scenario's measure phase: CPU + allocations (collected objects included). */
async function profileScenario(cdp, page, id, outDir) {
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
  await cdp.send("HeapProfiler.enable");
  await cdp.send("HeapProfiler.collectGarbage");
  const heapUsed = (await cdp.send("Runtime.getHeapUsage")).usedSize;
  await cdp.send("Profiler.start");
  await cdp.send("HeapProfiler.startSampling", {
    samplingInterval: 16384,
    includeObjectsCollectedByMajorGC: true,
    includeObjectsCollectedByMinorGC: true,
  });
  const t0 = Date.now();
  await page.waitForFunction((sid) => window.__benchResults?.some((r) => r.id === sid), id, { timeout: TIMEOUT_MS, polling: 250 });
  const secs = (Date.now() - t0) / 1000;
  const heap = (await cdp.send("HeapProfiler.stopSampling")).profile;
  const cpu = (await cdp.send("Profiler.stop")).profile;
  fs.writeFileSync(path.join(outDir, `${id}.cpuprofile`), JSON.stringify(cpu));
  const self = cpuSelf(cpu);
  const alloc = allocSelf(heap);
  const totalC = [...self.values()].reduce((a, b) => a + b, 0);
  const totalA = [...alloc.values()].reduce((a, b) => a + b, 0);
  console.log(`\n[profile] ${id}: retained heap ${(heapUsed / 1048576).toFixed(0)} MB, allocating ${(totalA / 1048576 / secs).toFixed(1)} MB/s`);
  printTop("cpu self time", self, totalC, (v) => `${(v / 1000).toFixed(0)} ms`);
  printTop("allocations", alloc, totalA, (v) => `${(v / 1048576 / secs).toFixed(2)} MB/s`);
}

function fmtRow(cols, widths) {
  return cols.map((c, i) => String(c).padEnd(widths[i])).join(" ");
}

function printSummary(results) {
  const w = [18, 20, 15, 15, 15, 6, 6, 9];
  console.log("\n" + fmtRow(["scenario", "cpu avg/p99/max", "render avg/p99", "scene avg/p99", "unit sim avg/p99", ">16ms", ">33ms", "alloc MB/s"], w));
  for (const r of results) {
    const us = r.stages["unit sim"];
    console.log(
      fmtRow(
        [
          r.id,
          `${r.cpu.avg}/${r.cpu.p99}/${r.cpu.max}`,
          `${r.render.avg}/${r.render.p99}`,
          `${r.stages.scene.avg}/${r.stages.scene.p99}`,
          `${us.avg}/${us.p99}`,
          r.cpuOver.ms16,
          r.cpuOver.ms33,
          r.heap?.allocMBps ?? "-",
        ],
        w
      )
    );
  }
}

function printCompare(results, baselinePath) {
  const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
  const pct = (now, was) => (was ? `${now >= was ? "+" : ""}${(((now - was) / was) * 100).toFixed(0)}%` : "n/a");
  const w = [18, 22, 22, 22, 22, 14];
  console.log(`\nvs ${path.relative(root, baselinePath)}`);
  console.log(fmtRow(["scenario", "cpu avg", "cpu p99", "render avg", "unit sim avg", ">16ms"], w));
  for (const r of results) {
    const b = baseline.find((x) => x.id === r.id);
    if (!b) continue;
    const cell = (now, was) => `${was} → ${now} (${pct(now, was)})`;
    console.log(
      fmtRow(
        [
          r.id,
          cell(r.cpu.avg, b.cpu.avg),
          cell(r.cpu.p99, b.cpu.p99),
          cell(r.render.avg, b.render.avg),
          cell(r.stages["unit sim"].avg, b.stages["unit sim"].avg),
          `${b.cpuOver.ms16} → ${r.cpuOver.ms16}`,
        ],
        w
      )
    );
  }
}

const server = await ensureServer();
const browser = await chromium.launch({ channel: "chrome", headless: false, args: CHROME_ARGS });
let failed = false;
try {
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: DEVICE_SCALE });
  page.on("pageerror", (err) => {
    failed = true;
    console.error(`[page error] ${err.stack ?? err.message}`);
  });
  const warned = new Map();
  page.on("console", (msg) => {
    if (msg.type() !== "warning" && msg.type() !== "error") return;
    const key = msg.text().slice(0, 160);
    warned.set(key, (warned.get(key) ?? 0) + 1);
  });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const outDir = path.join(root, "bench-results");
  fs.mkdirSync(outDir, { recursive: true });
  const profileDir = path.join(outDir, `${stamp}-${gitSha()}-profiles`);
  if (profile) fs.mkdirSync(profileDir, { recursive: true });

  const cdp = profile ? await page.context().newCDPSession(page) : undefined;
  console.log(`[bench] ${base}/?bench=${ids}`);
  await page.goto(`${base}/?bench=${ids}`);
  if (cdp) {
    // Profile each scenario's measure phase as it comes up.
    const seen = new Set();
    for (;;) {
      const state = await page.waitForFunction(
        (done) => {
          if (window.__benchDone) return { done: true };
          const p = window.__benchProgress;
          return p && p.phase === "measure" && !done.includes(p.id) ? { id: p.id } : null;
        },
        [...seen],
        { timeout: TIMEOUT_MS, polling: 100 }
      );
      const v = await state.jsonValue();
      if (v.done) break;
      seen.add(v.id);
      await profileScenario(cdp, page, v.id, profileDir);
    }
  } else {
    await page.waitForFunction(() => window.__benchDone === true, null, { timeout: TIMEOUT_MS, polling: 500 });
  }
  const results = await page.evaluate(() => window.__benchResults);
  const out = opt("out") ?? path.join(outDir, `${stamp}-${gitSha()}${profile ? "-profiled" : ""}.json`);
  fs.writeFileSync(out, JSON.stringify(results, null, 1));
  printSummary(results);
  if (opt("compare")) printCompare(results, path.resolve(opt("compare")));
  if (warned.size) {
    console.log("\n[console warnings/errors]");
    for (const [k, n] of [...warned].sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`  ${String(n).padStart(5)}×  ${k}`);
  }
  console.log(`\n[bench] saved ${path.relative(root, out)}${profile ? `, profiles in ${path.relative(root, profileDir)}` : ""}`);
  if (profile) console.log("[bench] note: profiling skews timings; use unprofiled runs for numbers");
  if (flag("keep-open")) await new Promise(() => {});
} finally {
  if (!flag("keep-open")) await browser.close();
  server?.kill();
}
if (failed) process.exitCode = 1;
