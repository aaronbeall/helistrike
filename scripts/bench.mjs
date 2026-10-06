#!/usr/bin/env node
/**
 * Perf runner: plays scenarios (scripts/bench-scenarios.mjs) in your installed Chrome with real keyboard + mouse
 * input via Playwright, measures with an injected frame probe, saves results, and optionally compares or profiles.
 *
 *   npm run bench                              all scenarios
 *   npm run bench -- idle_cluster,gun_cluster  some scenarios
 *   npm run bench -- --compare <results.json>
 *   npm run bench -- idle_empty --profile      CPU profile + allocation sample per scenario (timings skewed)
 *   npm run bench -- --runs 3 --record "what changed"   median of 3 suite runs, appended to docs/perf-history.csv
 *
 * Options: --compare <file>, --profile, --runs <n>, --record <label>, --out <file>, --url <base>
 * (default http://localhost:5174), --keep-open.
 * Starts the Vite dev server when nothing answers at --url. Game side: dev URL launch (?test=…&cheats=…) and the
 * read-only `window.__heli` handle; everything else lives here, and nothing in the game or Phaser is patched.
 */
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { SCENARIOS } from "./bench-scenarios.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const optValues = new Set(["compare", "out", "url", "runs", "record"].map((n) => opt(n)).filter(Boolean));
const picked = args.filter((a) => !a.startsWith("--") && !optValues.has(a)).flatMap((a) => a.split(","));
const scenarios = picked.length ? SCENARIOS.filter((s) => picked.includes(s.id)) : SCENARIOS;
const base = opt("url") ?? "http://localhost:5174";
const profile = flag("profile");
const runs = Math.max(1, Number(opt("runs") ?? 1) | 0);
const record = opt("record");
const HISTORY = path.join(root, "docs/perf-history.csv");
const HISTORY_COLS = ["date", "commit", "label", "harness", "runs", "scenario", "frames", "cpu_avg", "cpu_p99", "render_avg", "scene_avg", "unit_ai_avg", "interval_p99", "alloc_mbps"];
/** Chrome flags: keep the frame loop running at full rate when the window isn't focused. */
const CHROME_ARGS = [
  "--disable-background-timer-throttling",
  "--disable-renderer-backgrounding",
  "--disable-backgrounding-occluded-windows",
  "--enable-precise-memory-info",
];
const VIEWPORT = { width: 1280, height: 720 };
/** Retina, like real play. */
const DEVICE_SCALE = 2;
/** Boot bakes art and each launch generates a world. */
const LOAD_TIMEOUT_MS = 3 * 60 * 1000;
/** Input loop tick: re-aim + fire schedule. */
const TICK_MS = 100;
const PROFILE_TOP = 25;

/** Injected before the game loads: per-frame timing from the game's prestep / postrender events, read through `window.__heli`. */
function frameProbe() {
  const P = { on: false, wrapped: null, last: 0, rows: [], longTasks: [] };
  const sample = (time, cpu) => {
    const gap = P.last ? time - P.last : 0;
    P.last = time;
    if (!P.on) return;
    const s = window.__heli.scene;
    const cur = s.perf.current;
    let live = 0;
    for (const u of s.units) if (!u.dead) live++;
    P.rows.push({
      cpu,
      gap,
      stages: cur ? Array.from(cur) : [],
      heap: performance.memory?.usedJSHeapSize ?? 0,
      counts: [s.units.length, live, s.shots.length, s.debris.length, s.fx.simParticles.length],
    });
  };
  // Listen to the game's own step / render events (no patching): CPU = prestep → postrender.
  let t0 = 0;
  let stepTime = 0;
  setInterval(() => {
    const h = window.__heli;
    if (!h || P.wrapped === h.game) return;
    P.wrapped = h.game;
    h.game.events.on("prestep", (time) => {
      t0 = performance.now();
      stepTime = time;
    });
    h.game.events.on("postrender", () => sample(stepTime, performance.now() - t0));
  }, 100);
  try {
    new PerformanceObserver((list) => {
      if (P.on) for (const e of list.getEntries()) P.longTasks.push(e.duration);
    }).observe({ type: "longtask", buffered: false });
  } catch {}
  P.start = () => {
    P.rows = [];
    P.longTasks = [];
    P.on = true;
  };
  /** Stop and summarize (same report shape as earlier runs). */
  P.stop = (id, label, measureS) => {
    P.on = false;
    const rows = P.rows.slice(1);
    const n = rows.length;
    const r2 = (x) => Math.round(x * 100) / 100;
    const stat = (vals) => {
      if (!vals.length) return { avg: 0, p50: 0, p95: 0, p99: 0, max: 0 };
      const s = vals.slice().sort((a, b) => a - b);
      const at = (p) => s[Math.min(s.length - 1, Math.ceil(s.length * p) - 1)];
      return { avg: r2(s.reduce((a, b) => a + b, 0) / s.length), p50: r2(at(0.5)), p95: r2(at(0.95)), p99: r2(at(0.99)), max: r2(s[s.length - 1]) };
    };
    const over = (vals, ms) => vals.filter((v) => v > ms).length;
    const labels = window.__heli.perfLabels;
    const stages = {};
    for (let k = 1; k <= 12; k++) stages[labels[k]] = stat(rows.map((r) => r.stages[k] ?? 0));
    const cpu = rows.map((r) => r.cpu);
    const gap = rows.map((r) => r.gap);
    let grown = 0;
    let gcs = 0;
    let freed = 0;
    for (let i = 1; i < n; i++) {
      const d = rows[i].heap - rows[i - 1].heap;
      if (d > 0) grown += d;
      else if (-d > 0.5 * 1048576) {
        gcs++;
        freed -= d;
      }
    }
    const countStat = (k) => {
      const v = rows.map((r) => r.counts[k]);
      return { avg: Math.round(v.reduce((a, b) => a + b, 0) / Math.max(1, n)), max: Math.max(0, ...v) };
    };
    const lt = P.longTasks;
    return {
      id,
      label,
      frames: n,
      cpu: stat(cpu),
      interval: stat(gap),
      render: stat(rows.map((r) => Math.max(0, r.cpu - (r.stages[1] ?? 0)))),
      stages,
      cpuOver: { ms16: over(cpu, 1000 / 60), ms33: over(cpu, 33.3), ms50: over(cpu, 50) },
      intervalOver: { ms33: over(gap, 33.3), ms50: over(gap, 50) },
      longTasks: { count: lt.length, totalMs: Math.round(lt.reduce((a, b) => a + b, 0)), maxMs: Math.round(Math.max(0, ...lt)) },
      heap: rows[0]?.heap ? { allocMBps: r2(grown / 1048576 / measureS), gcCount: gcs, freedMB: r2(freed / 1048576) } : undefined,
      counts: { units: countStat(0), liveUnits: countStat(1), shots: countStat(2), debris: countStat(3), particles: countStat(4) },
    };
  };
  window.__probe = P;
}

/** In-page: screen point (page CSS px) of the nearest live hostiles' centroid, else a point ahead of the craft. */
function aimPoint() {
  const s = window.__heli.scene;
  const p = s.player;
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const u of s.units) {
    if (u.dead || u.hv) continue;
    if (Math.hypot(u.x - p.x, u.y - p.y) > 900) continue;
    sx += u.x;
    sy += u.y;
    n++;
  }
  const x = n ? sx / n : p.x + Math.cos(p.angle) * 320;
  const y = n ? sy / n : p.y + Math.sin(p.angle) * 320;
  const at = s.worldToHudScreen(x, y, 0);
  const r = s.game.canvas.getBoundingClientRect();
  const k = r.width / s.scale.width;
  return { x: r.left + at.sx * k, y: r.top + at.sy * k };
}

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
  const server = spawn("npx", ["vite", "--port", port, "--strictPort"], { cwd: root, stdio: "ignore" });
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Boot into the scenario's map, lift off, and select the weapon — all real input. */
async function setUp(page, sc) {
  await page.goto(`${base}/?test=${sc.map}&cheats=ammo,god`);
  await page.waitForFunction(() => !!window.__heli?.scene?.player && !!window.__heli.scene.perf, null, { timeout: LOAD_TIMEOUT_MS, polling: 200 });
  await sleep(300);
  await page.keyboard.press("KeyP");
  const phase = () => page.evaluate(() => window.__heli.scene.player.phase);
  await page.waitForFunction(() => ["ready", "flight"].includes(window.__heli.scene.player.phase), null, { timeout: 30000, polling: 100 });
  if ((await phase()) !== "flight") {
    await page.keyboard.down("Space");
    await page.waitForFunction(() => window.__heli.scene.player.phase === "flight", null, { timeout: 5000, polling: 50 });
    await sleep(400);
    await page.keyboard.up("Space");
  }
  if (sc.fire) await page.keyboard.press(`Digit${sc.fire.weapon}`);
}

/** Aim + fire schedule for `secs` real seconds. */
async function play(page, sc, secs, t0) {
  const end = Date.now() + secs * 1000;
  let down = false;
  while (Date.now() < end) {
    const at = await page.evaluate(aimPoint);
    await page.mouse.move(at.x, at.y);
    const f = sc.fire;
    const want = !!f && ((Date.now() - t0) / 1000) % (f.onS + f.offS) < f.onS;
    if (want !== down) {
      await (want ? page.mouse.down() : page.mouse.up());
      down = want;
    }
    await sleep(TICK_MS);
  }
  return down;
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

async function startProfile(cdp) {
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
  return heapUsed;
}

async function stopProfile(cdp, id, secs, heapUsed, outDir) {
  const heap = (await cdp.send("HeapProfiler.stopSampling")).profile;
  const cpu = (await cdp.send("Profiler.stop")).profile;
  fs.writeFileSync(path.join(outDir, `${id}.cpuprofile`), JSON.stringify(cpu));
  const byId = new Map(cpu.nodes.map((n) => [n.id, n]));
  const self = new Map();
  cpu.samples.forEach((s, i) => {
    const k = frameLabel(byId.get(s).callFrame);
    self.set(k, (self.get(k) ?? 0) + (cpu.timeDeltas[i] ?? 0));
  });
  const alloc = new Map();
  const walk = (n) => {
    const k = frameLabel(n.callFrame);
    alloc.set(k, (alloc.get(k) ?? 0) + n.selfSize);
    n.children.forEach(walk);
  };
  walk(heap.head);
  const totalC = [...self.values()].reduce((a, b) => a + b, 0);
  const totalA = [...alloc.values()].reduce((a, b) => a + b, 0);
  console.log(`\n[profile] ${id}: retained heap ${(heapUsed / 1048576).toFixed(0)} MB, allocating ${(totalA / 1048576 / secs).toFixed(1)} MB/s`);
  printTop("cpu self time", self, totalC, (v) => `${(v / 1000).toFixed(0)} ms`);
  printTop("allocations", alloc, totalA, (v) => `${(v / 1048576 / secs).toFixed(2)} MB/s`);
}

/** Per-field median of several runs' reports (same scenarios, same shape). */
function medianReports(all) {
  if (all.length === 1) return all[0];
  const med = (vals) => {
    const s = vals.slice().sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : Math.round(((s[m - 1] + s[m]) / 2) * 100) / 100;
  };
  const merge = (nodes) => {
    const first = nodes[0];
    if (typeof first === "number") return med(nodes);
    if (!first || typeof first !== "object") return first;
    const out = Array.isArray(first) ? [] : {};
    for (const k of Object.keys(first)) out[k] = merge(nodes.map((n) => n?.[k]));
    return out;
  };
  return all[0].map((r, i) => merge(all.map((run) => run[i])));
}

/** Append one row per scenario to the committed perf history. */
function recordHistory(results, label) {
  const csv = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  if (!fs.existsSync(HISTORY)) fs.writeFileSync(HISTORY, HISTORY_COLS.join(",") + "\n");
  const date = new Date().toISOString().slice(0, 10);
  const rows = results.map((r) =>
    [date, gitSha(), label, "real-input", runs, r.id, r.frames, r.cpu.avg, r.cpu.p99, r.render.avg, r.stages.scene.avg, r.stages["unit sim"].avg, r.interval.p99, r.heap?.allocMBps ?? ""]
      .map(csv)
      .join(",")
  );
  fs.appendFileSync(HISTORY, rows.join("\n") + "\n");
  console.log(`[bench] recorded ${rows.length} rows to ${path.relative(root, HISTORY)} as "${label}"`);
}

function fmtRow(cols, widths) {
  return cols.map((c, i) => String(c).padEnd(widths[i])).join(" ");
}

function printSummary(results) {
  const w = [18, 20, 15, 15, 17, 14, 6, 9];
  console.log("\n" + fmtRow(["scenario", "cpu avg/p99/max", "render avg/p99", "scene avg/p99", "unit sim avg/p99", "interval p99", ">16ms", "alloc MB/s"], w));
  for (const r of results) {
    const us = r.stages["unit sim"];
    console.log(
      fmtRow(
        [r.id, `${r.cpu.avg}/${r.cpu.p99}/${r.cpu.max}`, `${r.render.avg}/${r.render.p99}`, `${r.stages.scene.avg}/${r.stages.scene.p99}`, `${us.avg}/${us.p99}`, r.interval.p99, r.cpuOver.ms16, r.heap?.allocMBps ?? "-"],
        w
      )
    );
  }
}

function printCompare(results, baselinePath) {
  const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
  const pct = (now, was) => (was ? `${now >= was ? "+" : ""}${(((now - was) / was) * 100).toFixed(0)}%` : "n/a");
  const cell = (now, was) => `${was} → ${now} (${pct(now, was)})`;
  const w = [18, 22, 22, 22, 22, 22];
  console.log(`\nvs ${path.relative(root, baselinePath)}`);
  console.log(fmtRow(["scenario", "cpu avg", "cpu p99", "render avg", "unit sim avg", "interval p99"], w));
  for (const r of results) {
    const b = baseline.find((x) => x.id === r.id);
    if (!b) continue;
    console.log(
      fmtRow(
        [r.id, cell(r.cpu.avg, b.cpu.avg), cell(r.cpu.p99, b.cpu.p99), cell(r.render.avg, b.render.avg), cell(r.stages["unit sim"].avg, b.stages["unit sim"].avg), cell(r.interval.p99, b.interval.p99)],
        w
      )
    );
  }
}

const server = await ensureServer();
const browser = await chromium.launch({ channel: "chrome", headless: false, args: CHROME_ARGS });
let failed = false;
try {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: DEVICE_SCALE });
  await context.addInitScript(frameProbe);
  const page = await context.newPage();
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
  const cdp = profile ? await context.newCDPSession(page) : undefined;

  const runOne = async (sc) => {
    await setUp(page, sc);
    const t0 = Date.now();
    await play(page, sc, sc.warmupS, t0);
    const heapUsed = cdp ? await startProfile(cdp) : 0;
    await page.evaluate(() => window.__probe.start());
    const down = await play(page, sc, sc.measureS, t0);
    const report = await page.evaluate(([id, label, s]) => window.__probe.stop(id, label, s), [sc.id, sc.label, sc.measureS]);
    if (cdp) await stopProfile(cdp, sc.id, sc.measureS, heapUsed, profileDir);
    if (down) await page.mouse.up();
    return report;
  };
  const allRuns = [];
  for (let run = 1; run <= runs; run++) {
    const results = [];
    for (const sc of scenarios) {
      process.stdout.write(`[bench] ${runs > 1 ? `run ${run}/${runs} ` : ""}${sc.id} … `);
      let report;
      // One retry: a slow boot or world gen shouldn't sink a long multi-run session.
      for (let attempt = 1; !report; attempt++) {
        try {
          report = await runOne(sc);
        } catch (err) {
          if (attempt >= 2) throw err;
          console.log(`failed (${String(err.message ?? err).split("\n")[0]}), retrying`);
          await page.mouse.up().catch(() => {});
        }
      }
      results.push(report);
      console.log(`${report.frames} frames, cpu ${report.cpu.avg} ms avg`);
    }
    allRuns.push(results);
  }
  const results = medianReports(allRuns);
  const out = opt("out") ?? path.join(outDir, `${stamp}-${gitSha()}${profile ? "-profiled" : ""}${runs > 1 ? `-x${runs}` : ""}.json`);
  fs.writeFileSync(out, JSON.stringify(results, null, 1));
  if (runs > 1) fs.writeFileSync(out.replace(/\.json$/, "-runs.json"), JSON.stringify(allRuns, null, 1));
  printSummary(results);
  if (record) recordHistory(results, record);
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
