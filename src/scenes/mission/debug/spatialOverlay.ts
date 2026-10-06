import type Phaser from "phaser";
import { circumRadiusOf } from "../../../render/footprint";
import { Layer } from "../../../render/depth";
import { DomText } from "../../../ui/domText";
import { Camera25D, groundZ, worldToScreen, type ScreenPos } from "../../../worldgen/world";
import type { MissionScene } from "../../missionScene";
import type { SpatialGrid } from "../../../sim/spatialGrid";

/** Cells drawn each way from the camera focus. */
const VIEW_CELLS = 10;
const STATIC_RGB = 0x2f7dff;
const MOVER_RGB = 0xffb84a;
const QUERY_RGB = 0x6dffe0;
const MISS_RGB = 0xff3a2a;
const RING_SEGS = 24;

/** Spatial index debug overlay: occupied cells (statics blue, movers amber), big entries, queries, brute-force misses. */
export class SpatialOverlay {
  on = false;
  private gfx!: Phaser.GameObjects.Graphics;
  private hud?: DomText;
  private missTotal = 0;
  private p: ScreenPos = { x: 0, y: 0, scale: 1 };

  constructor(readonly s: MissionScene) {}

  reset(): void {
    this.on = false;
    this.missTotal = 0;
    this.hud?.setVisible(false);
  }

  create(): void {
    this.gfx = this.s.add.graphics().setDepth(Layer.FIELD + 8);
  }

  dispose(): void {
    this.hud?.destroy();
    this.hud = undefined;
  }

  setOn(on: boolean): void {
    this.on = on;
    this.s.spatial.check = on;
    this.s.spatial.takeStats();
    this.missTotal = 0;
    this.gfx.clear();
    this.hud ??= new DomText(this.s.game, 16, 340, 12, "#8effd8");
    this.hud.setVisible(on);
    this.s.debugMenu.sync();
  }

  draw(): void {
    if (!this.on) return;
    const sp = this.s.spatial;
    const g = this.gfx;
    g.clear();
    const st = sp.takeStats();
    this.missTotal += st.misses;
    if (!this.s.camera.mapWorldHidden) {
      this.drawCells(sp.statics, sp.movers);
      this.drawBig(sp.statics);
      this.drawBig(sp.movers);
      const q = sp.recent;
      g.lineStyle(1, QUERY_RGB, 0.3);
      for (let i = 0; i + 2 < q.length && i < 3 * 200; i += 3) this.ring(q[i]!, q[i + 1]!, q[i + 2]!);
      const m = sp.missAt;
      g.lineStyle(2, MISS_RGB, 0.95);
      for (let i = 0; i + 1 < m.length; i += 2) this.cross(m[i]!, m[i + 1]!);
    }
    sp.recent.length = 0;
    sp.missAt.length = 0;
    const saved = st.hits ? st.scanned / st.hits : 0;
    this.hud!.setText(
      [
        `SPATIAL GRID  cell ${sp.statics.cell}  ${sp.statics.cols}x${sp.statics.rows}`,
        `statics ${sp.statics.size} (${sp.statics.bigSlots().length} big)  movers ${sp.movers.size} (${sp.movers.bigSlots().length} big)`,
        `queries ${st.queries}/frame  hits ${st.hits}  brute ${st.scanned}${saved ? `  (${saved.toFixed(0)}x)` : ""}`,
        `misses  ${st.misses} frame  ${this.missTotal} total${sp.lastMiss ? `  last: ${sp.lastMiss}` : ""}`,
      ].join("\n")
    );
  }

  private drawCells(statics: SpatialGrid, movers: SpatialGrid): void {
    const cell = statics.cell;
    const fx = Camera25D.focusX;
    const fy = Camera25D.focusY;
    const c0 = statics.colAt(fx - VIEW_CELLS * cell);
    const c1 = statics.colAt(fx + VIEW_CELLS * cell);
    const r0 = statics.rowAt(fy - VIEW_CELLS * cell);
    const r1 = statics.rowAt(fy + VIEW_CELLS * cell);
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const ns = statics.cellCount(col, row);
        const nm = movers.cellCount(col, row);
        const x0 = statics.x0 + col * cell;
        const y0 = statics.y0 + row * cell;
        if (ns) this.quad(x0, y0, cell, STATIC_RGB, Math.min(0.18 + ns * 0.06, 0.6), true);
        if (nm) this.quad(x0, y0, cell, MOVER_RGB, Math.min(0.22 + nm * 0.08, 0.65), true);
        this.quad(x0, y0, cell, ns || nm ? 0xffffff : 0x9ab0c0, ns || nm ? 0.22 : 0.08, false);
      }
    }
  }

  private drawBig(grid: SpatialGrid): void {
    const units = this.s.units;
    this.gfx.lineStyle(1.5, STATIC_RGB, 0.7);
    for (const i of grid.bigSlots()) {
      const u = units[i];
      if (u && !u.dead) this.ring(u.x, u.y, circumRadiusOf(u.kind));
    }
  }

  private project(x: number, y: number, z: number): ScreenPos {
    return worldToScreen(x, y, z, this.p);
  }

  private quad(x0: number, y0: number, size: number, rgb: number, alpha: number, fill: boolean): void {
    const g = this.gfx;
    const w = this.s.world;
    g.beginPath();
    const xs = [x0, x0 + size, x0 + size, x0];
    const ys = [y0, y0, y0 + size, y0 + size];
    for (let k = 0; k < 4; k++) {
      const p = this.project(xs[k]!, ys[k]!, groundZ(w, xs[k]!, ys[k]!));
      if (k === 0) g.moveTo(p.x, p.y);
      else g.lineTo(p.x, p.y);
    }
    g.closePath();
    if (fill) {
      g.fillStyle(rgb, alpha);
      g.fillPath();
    } else {
      g.lineStyle(1, rgb, alpha);
      g.strokePath();
    }
  }

  private ring(x: number, y: number, r: number): void {
    if (r <= 0) return;
    const g = this.gfx;
    const z = groundZ(this.s.world, x, y);
    g.beginPath();
    for (let k = 0; k <= RING_SEGS; k++) {
      const a = (k / RING_SEGS) * Math.PI * 2;
      const p = this.project(x + Math.cos(a) * r, y + Math.sin(a) * r, z);
      if (k === 0) g.moveTo(p.x, p.y);
      else g.lineTo(p.x, p.y);
    }
    g.strokePath();
  }

  private cross(x: number, y: number): void {
    const p = this.project(x, y, groundZ(this.s.world, x, y));
    const g = this.gfx;
    g.lineBetween(p.x - 6, p.y - 6, p.x + 6, p.y + 6);
    g.lineBetween(p.x - 6, p.y + 6, p.x + 6, p.y - 6);
  }
}
