import { DomText } from "../../../ui/domText";
import type { MissionScene } from "../../missionScene";

export const PERF_LABELS = [
  "frame",
  "scene",
  "player",
  "unit sim",
  "unit draw",
  "shot sim",
  "shot draw",
  "debris sim",
  "debris draw",
  "sim particle sim",
  "sim particle draw",
  "target/fx",
  "scene other",
  "outside/vsync",
] as const;

const PERF_WINDOW = 300;

/** Opt-in per-stage CPU timings + overlay (P). */
export class PerfMonitor {
  /** DOM overlay, created on first enable (debug text shouldn't cost canvas work). */
  hud!: DomText;
  /** Opt-in CPU timings; buffers are allocated only when profiling is enabled. */
  enabled = false;
  samples?: Float32Array[];
  current?: Float64Array;
  sortBuf?: Float32Array;
  sampleCount = 0;
  sampleWrite = 0;
  hudAt = 0;
  copyNoticeUntil = 0;
  copyKeyAt = -Infinity;

  constructor(readonly s: MissionScene) {}

  toggle(): void {
    this.enabled = !this.enabled;
    this.hud ??= new DomText(this.s.game, 16, 72, 12, "#8ee6ff");
    if (!this.enabled) {
      this.hud.setVisible(false);
      this.copyKeyAt = -Infinity;
      this.s.debugMenu.sync();
      return;
    }
    this.resetMeasurements();
    this.s.debugMenu.sync();
  }

  /** Scene shutdown: drop the DOM overlay. */
  dispose(): void {
    this.hud?.destroy();
    this.hud = undefined!;
  }

  resetMeasurements(): void {
    this.hud ??= new DomText(this.s.game, 16, 72, 12, "#8ee6ff");
    this.samples ??= PERF_LABELS.map(() => new Float32Array(PERF_WINDOW));
    this.current ??= new Float64Array(PERF_LABELS.length);
    this.sortBuf ??= new Float32Array(PERF_WINDOW);
    for (const samples of this.samples) samples.fill(0);
    this.current.fill(0);
    this.sampleCount = 0;
    this.sampleWrite = 0;
    this.hudAt = 0;
    this.copyNoticeUntil = 0;
    this.copyKeyAt = -Infinity;
    this.hud.setVisible(true).setText("PERFORMANCE\nwarming up…");
  }

  handleKey(): void {
    if (!this.enabled) {
      this.toggle();
      return;
    }
    const now = performance.now();
    if (now - this.copyKeyAt < 900) {
      this.toggle();
      return;
    }
    this.copyKeyAt = now;
    void this.copyResults();
  }

  async copyResults(): Promise<void> {
    if (!this.enabled) return;
    const report = this.hud.text;
    try {
      await navigator.clipboard.writeText(report);
      if (!this.enabled) return;
      this.copyNoticeUntil = this.s.time.now + 800;
      this.hud.setText(`COPIED — P again to close\n${report}`);
      this.s.time.delayedCall(800, () => {
        if (this.enabled) this.refreshHud();
      });
    } catch {
      if (!this.enabled) return;
      this.copyNoticeUntil = this.s.time.now + 1200;
      this.hud.setText(`COPY FAILED\n${report}`);
      this.s.time.delayedCall(1200, () => {
        if (this.enabled) this.refreshHud();
      });
    }
  }

  recordSample(frameMs: number, sceneMs: number): void {
    const timings = this.current!;
    timings[0] = frameMs;
    timings[1] = sceneMs;
    let measured = 0;
    for (let i = 2; i <= 11; i++) measured += timings[i]!;
    timings[12] = Math.max(0, sceneMs - measured);
    // Includes Phaser/render work outside this scene and any vsync/idle time.
    timings[13] = Math.max(0, frameMs - sceneMs);

    const samples = this.samples!;
    const at = this.sampleWrite;
    for (let i = 0; i < PERF_LABELS.length; i++) samples[i]![at] = timings[i]!;
    this.sampleWrite = (at + 1) % PERF_WINDOW;
    this.sampleCount = Math.min(PERF_WINDOW, this.sampleCount + 1);

    const now = this.s.time.now;
    if (now - this.hudAt < 1000) return;
    this.hudAt = now;
    this.refreshHud();
  }

  refreshHud(): void {
    const n = this.sampleCount;
    if (!n || this.s.time.now < this.copyNoticeUntil) return;
    const samples = this.samples!;
    const sort = this.sortBuf!;
    const averages = new Float64Array(PERF_LABELS.length);
    const p95s = new Float64Array(PERF_LABELS.length);
    for (let bucket = 0; bucket < PERF_LABELS.length; bucket++) {
      let sum = 0;
      const source = samples[bucket]!;
      for (let i = 0; i < n; i++) {
        const value = source[i]!;
        sum += value;
        sort[i] = value;
      }
      sort.subarray(0, n).sort();
      averages[bucket] = sum / n;
      p95s[bucket] = sort[Math.ceil(n * 0.95) - 1]!;
    }
    const frameAvg = averages[0]!;
    const lines = [
      `PERFORMANCE ${this.s.terrainMesh ? "MESH" : "FLAT"}  P: copy  n=${n}`,
      `frame  ${frameAvg.toFixed(2)} avg  ${p95s[0]!.toFixed(2)} p95  ${(1000 / Math.max(frameAvg, 0.01)).toFixed(0)} fps`,
      `scene  ${averages[1]!.toFixed(2)} avg  ${p95s[1]!.toFixed(2)} p95`,
    ];
    for (let i = 2; i < PERF_LABELS.length; i++) {
      const avg = averages[i]!;
      lines.push(`${PERF_LABELS[i]!.padEnd(9)} ${avg.toFixed(2)} avg  ${p95s[i]!.toFixed(2)} p95  ${((avg / Math.max(frameAvg, 0.01)) * 100).toFixed(1)}%`);
    }
    lines.push(`objects  u${this.s.units.length} s${this.s.shots.length} d${this.s.debris.length} p${this.s.fx.simParticles.length}`);
    this.hud.setText(lines.join("\n"));
  }
}
