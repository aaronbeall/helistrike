import type Phaser from "phaser";
import { BENCH_SCENARIOS, type BenchCluster, type BenchScenario } from "../../../catalog/benchmarks";
import { selectCraft } from "../../../sim/crafts";
import { selectMission } from "../../../sim/mission";
import type { UnitKind } from "../../../sim/roster";
import { Rng, seededRandom } from "../../../util/rng";
import { isWater, WORLD, type WorldData } from "../../../worldgen/world";
import type { MissionScene } from "../../missionScene";
import { PERF_LABELS } from "./perf";

/** Fixed sim step while a bench runs (ms). */
const BENCH_DT_MS = 1000 / 60;
const BENCH_FPS = 60;
/** Stage slots read from the perf monitor (scene total + each stage). */
const STAGE_FIRST = 1;
const STAGE_LAST = 12;
const MB = 1024 * 1024;
/** Heap drop that counts as a garbage collection (bytes). */
const GC_DROP = 0.5 * MB;

export interface BenchStat {
  avg: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

export interface BenchReport {
  id: string;
  label: string;
  frames: number;
  /** CPU per frame: sim + render submit (ms). */
  cpu: BenchStat;
  /** Real frame interval (ms): CPU, GPU and vsync together. */
  interval: BenchStat;
  /** CPU outside the mission scene's update: mostly Phaser render. */
  render: BenchStat;
  stages: Record<string, BenchStat>;
  cpuOver: { ms16: number; ms33: number; ms50: number };
  intervalOver: { ms33: number; ms50: number };
  longTasks: { count: number; totalMs: number; maxMs: number };
  /** Chrome only: JS heap growth and drops (garbage collections). */
  heap?: { allocMBps: number; gcCount: number; freedMB: number };
  counts: Record<"units" | "liveUnits" | "shots" | "debris" | "particles", { avg: number; max: number }>;
}

declare global {
  interface Window {
    __benchResults?: BenchReport[];
    /** Live run state (for automation polling). */
    __benchProgress?: { id: string; phase: string; frame: number; queued: number };
    /** The mission scene while a bench runs (diagnostics from automation). */
    __benchScene?: unknown;
    /** Set once every queued scenario has reported. */
    __benchDone?: boolean;
  }
  interface Performance {
    memory?: { usedJSHeapSize: number };
  }
}

/** Scenario ids still to run this page load, and finished reports. */
let queue: string[] = [];
let results: BenchReport[] = [];

export function benchScenario(id: string | undefined): BenchScenario | undefined {
  return id ? BENCH_SCENARIOS.find((b) => b.id === id) : undefined;
}

/** Scenario ids from `?bench=all` / `?bench=a,b`, or undefined. */
export function benchIdsFromUrl(): string[] | undefined {
  const raw = new URLSearchParams(globalThis.location?.search ?? "").get("bench");
  if (!raw) return undefined;
  if (raw === "all") return BENCH_SCENARIOS.map((b) => b.id);
  const ids = raw.split(",").filter((id) => benchScenario(id));
  return ids.length ? ids : undefined;
}

/** Start a bench run: each scenario loads its world and runs in turn. */
export function startBench(scene: Phaser.Scene, ids: string[]): void {
  queue = ids.slice();
  results = [];
  window.__benchDone = false;
  launchNext(scene);
}

function launchNext(scene: Phaser.Scene): void {
  const sc = benchScenario(queue.shift());
  if (!sc) return;
  selectCraft(sc.craft);
  selectMission(sc.mission);
  scene.scene.start("load", { bench: sc.id });
}

/** Apply a scenario's forces to a freshly generated world (before the mission spawns units). */
export function applyBenchForces(world: WorldData, sc: BenchScenario): void {
  if (!sc.cluster) return;
  world.hv = [];
  world.spawns = [];
  if (sc.cluster === "none") return;
  const c = benchClusterCentre(world, sc.cluster);
  const kinds: UnitKind[] = [];
  for (const g of sc.cluster.units) for (let i = 0; i < g.count; i++) kinds.push(g.kind);
  const rng = new Rng(sc.seed);
  for (let i = kinds.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [kinds[i], kinds[j]] = [kinds[j]!, kinds[i]!];
  }
  // Golden-angle spiral: even, repeatable spread; dry spots only.
  for (let i = 0; i < kinds.length; i++) {
    const a = i * 2.39996;
    for (let k = 0; k < 8; k++) {
      const r = sc.cluster.radius * Math.sqrt((i + 0.5) / kinds.length) + k * 30;
      const x = c.x + Math.cos(a) * r;
      const y = c.y + Math.sin(a) * r;
      if (isWater(world, x, y)) continue;
      world.spawns.push({ kind: kinds[i]!, x, y });
      break;
    }
  }
}

/** Cluster / aim point: `distance` from spawn toward the map centre. */
function benchClusterCentre(world: WorldData, cluster: Pick<BenchCluster, "distance">): { x: number; y: number } {
  const a = Math.atan2(WORLD / 2 - world.spawnY, WORLD / 2 - world.spawnX);
  return { x: world.spawnX + Math.cos(a) * cluster.distance, y: world.spawnY + Math.sin(a) * cluster.distance };
}

function stat(v: Float64Array, n: number): BenchStat {
  if (!n) return { avg: 0, p50: 0, p95: 0, p99: 0, max: 0 };
  const s = v.slice(0, n).sort();
  let sum = 0;
  for (let i = 0; i < n; i++) sum += s[i]!;
  const at = (p: number) => s[Math.min(n - 1, Math.ceil(n * p) - 1)]!;
  const r = (x: number) => Math.round(x * 100) / 100;
  return { avg: r(sum / n), p50: r(at(0.5)), p95: r(at(0.95)), p99: r(at(0.99)), max: r(s[n - 1]!) };
}

function countOver(v: Float64Array, n: number, ms: number): number {
  let c = 0;
  for (let i = 0; i < n; i++) if (v[i]! > ms) c++;
  return c;
}

/**
 * Bench driver: runs a hidden test scenario with a seeded `Math.random` and a fixed 60 Hz step, flies the
 * player on a script (hold station, aim at the cluster, fire on a schedule), records per-frame timings and
 * writes a report to `window.__benchResults` and the console.
 */
export class Bench {
  scenario: BenchScenario | undefined;
  private phase: "off" | "warmup" | "measure" = "off";
  private frame = 0;
  private simT = 0;
  private warmupFrames = 0;
  private measureFrames = 0;
  private anchor = { x: 0, y: 0 };
  private aim = { x: 0, y: 0 };
  private realRandom: (() => number) | undefined;
  private loopCallback: ((time: number, delta: number) => void) | undefined;
  private fakeTime = 0;
  private lastReal = 0;
  private observer: PerformanceObserver | undefined;
  private longTasks: number[] = [];
  private cpu = new Float64Array(0);
  private interval = new Float64Array(0);
  private render = new Float64Array(0);
  private stages: Float64Array[] = [];
  private heap = new Float64Array(0);
  private counts: Float64Array[] = [];
  private summary: Phaser.GameObjects.Text | undefined;

  constructor(readonly s: MissionScene) {}

  /** Mission init: pick up the scenario and seed `Math.random` before anything spawns. */
  reset(benchId: string | undefined): void {
    this.uninstall();
    this.scenario = benchScenario(benchId);
    this.phase = "off";
    this.summary = undefined;
    if (!this.scenario) return;
    this.realRandom = Math.random;
    Math.random = seededRandom(this.scenario.seed);
  }

  /** A bench owns this mission: no end-of-mission flow, no stats saved. */
  holdsMission(): boolean {
    return !!this.scenario;
  }

  /** End of create(): put the player on station and start the clock. */
  start(): void {
    const sc = this.scenario;
    if (!sc) return;
    const s = this.s;
    const p = s.player;
    this.anchor = { x: p.x, y: p.y };
    this.aim = benchClusterCentre(s.world, typeof sc.cluster === "object" ? sc.cluster : { distance: 460 });
    p.startAirborne(Math.atan2(this.aim.y - p.y, this.aim.x - p.x), s.world);
    if (sc.fire) s.fireControl.selectWeapon(sc.fire.slot);
    s.debugMenu.setInfAmmo(true);
    s.fireControl.canFire = true;
    s.perf.enabled = true;
    s.perf.resetMeasurements();
    this.warmupFrames = Math.round(sc.warmupS * BENCH_FPS);
    this.measureFrames = Math.round(sc.measureS * BENCH_FPS);
    const n = this.measureFrames;
    this.cpu = new Float64Array(n);
    this.interval = new Float64Array(n);
    this.render = new Float64Array(n);
    this.stages = Array.from({ length: STAGE_LAST - STAGE_FIRST + 1 }, () => new Float64Array(n));
    this.heap = new Float64Array(n);
    this.counts = Array.from({ length: 5 }, () => new Float64Array(n));
    this.frame = 0;
    this.simT = 0;
    this.phase = "warmup";
    window.__benchScene = s;
    this.install();
  }

  /** Top of the mission update: script the player for this frame. */
  drive(): void {
    const sc = this.scenario;
    if (!sc || this.phase === "off") return;
    const s = this.s;
    const p = s.player;
    this.simT += BENCH_DT_MS / 1000;
    p.x = this.anchor.x;
    p.y = this.anchor.y;
    p.vx = 0;
    p.vy = 0;
    p.health = p.spec.health;
    const ptr = s.input.activePointer;
    const at = s.worldToHudScreen(this.aim.x, this.aim.y, 0);
    // Camera view isn't sized on the first frames: hold fire until the aim projects.
    const aimOk = Number.isFinite(at.sx) && Number.isFinite(at.sy);
    if (aimOk) {
      ptr.x = at.sx;
      ptr.y = at.sy;
    }
    const f = sc.fire;
    ptr.isDown = aimOk && !!f && this.simT % (f.onS + f.offS) < f.onS;
  }

  /** Mission shutdown. */
  stop(): void {
    this.uninstall();
    this.phase = "off";
  }

  /** Wrap the game loop: fixed step in, real timings out. */
  private install(): void {
    const loop = this.s.game.loop as unknown as { callback: (time: number, delta: number) => void };
    this.loopCallback = loop.callback;
    this.fakeTime = performance.now();
    this.lastReal = 0;
    const run = this.loopCallback;
    loop.callback = (time: number) => {
      const t0 = performance.now();
      this.fakeTime += BENCH_DT_MS;
      run(this.fakeTime, BENCH_DT_MS);
      this.onFrame(time, performance.now() - t0);
    };
    this.longTasks = [];
    try {
      this.observer = new PerformanceObserver((list) => {
        if (this.phase !== "measure") return;
        for (const e of list.getEntries()) this.longTasks.push(e.duration);
      });
      this.observer.observe({ type: "longtask", buffered: false });
    } catch {
      this.observer = undefined;
    }
  }

  private uninstall(): void {
    if (this.loopCallback) {
      (this.s.game.loop as unknown as { callback: unknown }).callback = this.loopCallback;
      this.loopCallback = undefined;
    }
    if (this.realRandom) {
      Math.random = this.realRandom;
      this.realRandom = undefined;
    }
    this.observer?.disconnect();
    this.observer = undefined;
  }

  private onFrame(realTime: number, cpuMs: number): void {
    const gap = this.lastReal ? realTime - this.lastReal : BENCH_DT_MS;
    this.lastReal = realTime;
    this.frame++;
    if (this.frame % 30 === 0 || this.frame === 1) {
      window.__benchProgress = { id: this.scenario!.id, phase: this.phase, frame: this.frame, queued: queue.length };
    }
    if (this.phase === "warmup") {
      if (this.frame >= this.warmupFrames) {
        this.phase = "measure";
        this.frame = 0;
      }
      return;
    }
    if (this.phase !== "measure") return;
    const i = this.frame - 1;
    const s = this.s;
    const timings = s.perf.current!;
    this.cpu[i] = cpuMs;
    this.interval[i] = gap;
    this.render[i] = Math.max(0, cpuMs - timings[1]!);
    for (let k = STAGE_FIRST; k <= STAGE_LAST; k++) this.stages[k - STAGE_FIRST]![i] = timings[k]!;
    this.heap[i] = performance.memory?.usedJSHeapSize ?? 0;
    let live = 0;
    for (const u of s.units) if (!u.dead) live++;
    this.counts[0]![i] = s.units.length;
    this.counts[1]![i] = live;
    this.counts[2]![i] = s.shots.length;
    this.counts[3]![i] = s.debris.length;
    this.counts[4]![i] = s.fx.simParticles.length;
    if (this.frame >= this.measureFrames) this.finish();
  }

  private finish(): void {
    const sc = this.scenario!;
    const n = this.measureFrames;
    const stages: Record<string, BenchStat> = {};
    for (let k = STAGE_FIRST; k <= STAGE_LAST; k++) stages[PERF_LABELS[k]!] = stat(this.stages[k - STAGE_FIRST]!, n);
    let heap: BenchReport["heap"];
    if (this.heap[0]) {
      let grown = 0;
      let freed = 0;
      let gcs = 0;
      for (let i = 1; i < n; i++) {
        const d = this.heap[i]! - this.heap[i - 1]!;
        if (d > 0) grown += d;
        else if (-d > GC_DROP) {
          gcs++;
          freed += -d;
        }
      }
      const r = (x: number) => Math.round(x * 100) / 100;
      heap = { allocMBps: r(grown / MB / sc.measureS), gcCount: gcs, freedMB: r(freed / MB) };
    }
    const countStat = (v: Float64Array) => {
      let sum = 0;
      let max = 0;
      for (let i = 0; i < n; i++) {
        sum += v[i]!;
        max = Math.max(max, v[i]!);
      }
      return { avg: Math.round(sum / n), max };
    };
    const lt = this.longTasks;
    const report: BenchReport = {
      id: sc.id,
      label: sc.label,
      frames: n,
      cpu: stat(this.cpu, n),
      interval: stat(this.interval, n),
      render: stat(this.render, n),
      stages,
      cpuOver: { ms16: countOver(this.cpu, n, 1000 / 60), ms33: countOver(this.cpu, n, 33.3), ms50: countOver(this.cpu, n, 50) },
      intervalOver: { ms33: countOver(this.interval, n, 33.3), ms50: countOver(this.interval, n, 50) },
      longTasks: { count: lt.length, totalMs: Math.round(lt.reduce((a, b) => a + b, 0)), maxMs: Math.round(Math.max(0, ...lt)) },
      heap,
      counts: {
        units: countStat(this.counts[0]!),
        liveUnits: countStat(this.counts[1]!),
        shots: countStat(this.counts[2]!),
        debris: countStat(this.counts[3]!),
        particles: countStat(this.counts[4]!),
      },
    };
    results.push(report);
    window.__benchResults = results;
    console.log(`[bench] ${sc.id}`, JSON.stringify(report));
    this.stop();
    if (queue.length) launchNext(this.s);
    else this.showSummary();
  }

  private showSummary(): void {
    window.__benchDone = true;
    console.log("[bench] done", JSON.stringify(results));
    const lines = ["BENCH DONE  ·  window.__benchResults", "id                 cpu avg/p99/max   interval p99   >33ms   heap MB/s  gc"];
    for (const r of results) {
      lines.push(
        `${r.id.padEnd(18)} ${`${r.cpu.avg}/${r.cpu.p99}/${r.cpu.max}`.padEnd(17)} ${String(r.interval.p99).padEnd(14)} ${String(r.cpuOver.ms33).padEnd(7)} ${String(r.heap?.allocMBps ?? "-").padEnd(10)} ${r.heap?.gcCount ?? "-"}`
      );
    }
    this.summary = this.s.add
      .text(16, 120, lines.join("\n"), { fontFamily: "Share Tech Mono, monospace", fontSize: "12px", color: "#8ee6ff", backgroundColor: "#101418" })
      .setScrollFactor(0)
      .setDepth(1e6);
    this.s.bindHud(this.summary);
  }
}
