import Phaser from "phaser";
import { heightOf, radius } from "../../../sim/combat";
import { Layer } from "../../../render/depth";
import { specOf } from "../../../sim/roster";
import { groundZ, worldToScreen, cameraPointVisible, screenToWorldOnGround } from "../../../worldgen/world";
import type { MissionScene } from "../../missionScene";

/** Debug strip: schematic side view (screen X × world Z) across the top. */
export class SideView {
  /** Schematic side-view strip (screen X × world Z) across the top. */
  on = false;
  gfx?: Phaser.GameObjects.Graphics;
  txt?: Phaser.GameObjects.Text;
  zMin = 0;
  zMax = 300;

  constructor(readonly s: MissionScene) {}

  /** Per-mission state reset (called from the scene's init). */
  reset(): void {
    this.on = false;
    this.gfx = undefined;
    this.txt = undefined;
  }

  setOn(on: boolean): void {
    this.on = on;
    if (!on) {
      // Destroy so nothing lingers in the display list while off.
      for (const go of [this.gfx, this.txt]) {
        if (!go) continue;
        this.s.hudSet.delete(go);
        go.destroy();
      }
      this.gfx = undefined;
      this.txt = undefined;
    }
    this.s.debugMenu.sync();
  }

  /** Side-view strip: X = on-screen X, Y = world Z; objects drawn as height rects (min 1px). */
  draw(): void {
    if (!this.on) return;
    if (!this.gfx?.scene) {
      this.gfx = this.s.add.graphics().setDepth(Layer.HUD + 4);
      this.s.bindHud(this.gfx);
      this.txt = this.s.add
        .text(8, 4, "", { fontFamily: "Share Tech Mono, monospace", fontSize: "11px", color: "#8ee6ff" })
        .setDepth(Layer.HUD + 5)
        .setStroke("#101418", 3);
      this.s.bindHud(this.txt);
    }
    const g = this.gfx.clear().setVisible(!this.s.mapView);
    this.txt!.setVisible(!this.s.mapView);
    if (this.s.mapView) return;
    const cam = this.s.cameras.main;
    const view = cam.worldView;
    const W = this.s.scale.width;
    const toSx = (wx: number) => (wx - view.x) * cam.zoom;

    // Terrain profile along the screen row under the host.
    const p = this.s.player;
    const rowAt = worldToScreen(p.x, p.y, groundZ(this.s.world, p.x, p.y));
    const rowY = rowAt.y;
    // Z uses the same px/unit as X at the host's row — true proportions.
    const ppu = Math.max(1e-3, rowAt.scale * cam.zoom);
    let zMin = Infinity;
    let zMax = -Infinity;
    const sampleRow = (wy: number, step: number): number[] => {
      const out: number[] = [];
      for (let sx = 0; sx <= W; sx += step) {
        const gp = screenToWorldOnGround(this.s.world, view.x + sx / cam.zoom, wy);
        out.push(gp.z);
        zMin = Math.min(zMin, gp.z);
        zMax = Math.max(zMax, gp.z);
      }
      return out;
    };
    const step = 4;
    const ground = sampleRow(rowY, step);
    // Lighter slices toward the top / bottom screen edges (3 each way).
    const bandStep = 8;
    const hostSy = (rowY - view.y) * cam.zoom;
    const screenH = this.s.scale.height;
    const bands: { z: number[]; k: number }[] = [];
    for (let k = 1; k <= 3; k++) {
      const up = hostSy * (1 - k / 3);
      const down = hostSy + (screenH - hostSy) * (k / 3);
      bands.push({ z: sampleRow(view.y + up / cam.zoom, bandStep), k });
      bands.push({ z: sampleRow(view.y + down / cam.zoom, bandStep), k });
    }

    type Box = { sx: number; w: number; z0: number; z1: number; col: number };
    const boxes: Box[] = [];
    const add = (x: number, y: number, z: number, h: number, r: number, col: number) => {
      if (!cameraPointVisible(z, y)) return;
      const at = worldToScreen(x, y, z);
      const sx = toSx(at.x);
      const w = Math.max(1, r * 2 * at.scale * cam.zoom);
      if (sx + w / 2 < 0 || sx - w / 2 > W) return;
      // On-screen vertical extent (base → top) must overlap the viewport.
      const syBase = (at.y - view.y) * cam.zoom;
      const syTop = (worldToScreen(x, y, z + h).y - view.y) * cam.zoom;
      if (Math.max(syBase, syTop) < 0 || Math.min(syBase, syTop) > this.s.scale.height) return;
      boxes.push({ sx, w, z0: z, z1: z + h, col });
      zMax = Math.max(zMax, z + h);
      zMin = Math.min(zMin, z);
    };
    for (const u of this.s.units) {
      if (u.dead) continue;
      add(u.x, u.y, u.z, heightOf(u.kind), radius(u.kind), specOf(u.kind).building ? 0x8a8470 : 0xff4a2a);
    }
    for (const r of this.s.remotes) {
      if (r.detonate) continue;
      add(r.x, r.y, r.z, r.spec.height, r.spec.radius, 0x5ec8ff);
    }
    if (p.phase !== "dead") add(p.x, p.y, p.z, p.spec.height, p.spec.radius, 0x6dff6a);
    for (const sh of this.s.shots) {
      if (sh.deadfall) continue;
      add(sh.x, sh.y, sh.z, 0, 1, sh.from === "enemy" ? 0xff9a3a : 0xffe08a);
    }

    // Smoothed Z range so the strip doesn't jitter.
    const k = 0.12;
    this.zMin = Phaser.Math.Linear(this.zMin, Math.min(zMin, 0), k);
    this.zMax = Phaser.Math.Linear(this.zMax, Math.max(zMax + 20, this.zMin + 120), k);
    const z0 = this.zMin;
    // Strip grows to fit the Z range; beyond the cap, tall things clip at the top.
    const H = Phaser.Math.Clamp((this.zMax - z0) * ppu + 6, 60, this.s.scale.height * 0.45);
    const span = (H - 2) / ppu;
    const toY = (z: number) => H - 2 - (z - z0) * ppu;

    g.fillStyle(0x0a0e10, 0.72);
    g.fillRect(0, 0, W, H);
    g.lineStyle(1, 0x2a3a40, 0.8);
    const grid = span > 600 ? 100 : 50;
    for (let z = Math.ceil(z0 / grid) * grid; z < z0 + span; z += grid) g.lineBetween(0, toY(z), W, toY(z));
    for (const b of bands) {
      g.lineStyle(1, 0xc4a24a, 0.45 - b.k * 0.1);
      g.beginPath();
      for (let i = 0; i < b.z.length; i++) {
        const gy = Math.max(0, toY(b.z[i]!));
        if (i === 0) g.moveTo(0, gy);
        else g.lineTo(i * bandStep, gy);
      }
      g.strokePath();
    }
    g.lineStyle(1.5, 0xc4a24a, 0.9);
    g.beginPath();
    for (let i = 0; i < ground.length; i++) {
      const gy = Math.max(0, toY(ground[i]!));
      if (i === 0) g.moveTo(0, gy);
      else g.lineTo(i * step, gy);
    }
    g.strokePath();
    for (const b of boxes) {
      const yBase = toY(b.z0);
      if (yBase < 0) continue;
      const yTop = Math.max(0, toY(b.z1));
      const hPx = Math.max(1, yBase - yTop);
      g.fillStyle(b.col, 0.9);
      g.fillRect(b.sx - b.w / 2, yTop, b.w, hPx);
    }
    g.lineStyle(1, 0x8ee6ff, 0.5);
    g.lineBetween(0, H, W, H);
    this.txt!.setText(`SIDE  Z ${z0 | 0}–${(z0 + span) | 0}  grid ${grid}`);
  }
}
