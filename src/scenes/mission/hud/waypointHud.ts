import type Phaser from "phaser";
import { Layer } from "../../../render/depth";
import { groundZ, worldToScreen, type ScreenPos } from "../../../worldgen/world";
import type { MissionScene } from "../../missionScene";

const HOST_RGB = 0xe8b84a;
const RING_SEGS = 28;
const RING_R = 24;
const STAKE_Z = 34;
const DASH = 14;
const GAP = 10;

/** Host waypoint marker: ground ring + stake + diamond, dashed line from the host craft. */
export class WaypointHud {
  gfx!: Phaser.GameObjects.Graphics;
  private p: ScreenPos = { x: 0, y: 0, scale: 1 };
  private q: ScreenPos = { x: 0, y: 0, scale: 1 };

  constructor(readonly s: MissionScene) {}

  create(): void {
    this.gfx = this.s.add.graphics().setDepth(Layer.FIELD + 2);
  }

  draw(): void {
    const g = this.gfx;
    g.clear();
    if (this.s.camera.mapView || this.s.over) return;
    const fleet = this.s.remoteFleet;
    const hw = fleet.activeHostWaypoint();
    if (hw) this.marker(hw.x, hw.y, HOST_RGB, [this.s.player]);
  }

  private marker(x: number, y: number, rgb: number, movers: readonly { x: number; y: number }[]): void {
    const g = this.gfx;
    const w = this.s.world;
    const z = groundZ(w, x, y);
    const pulse = 0.5 + 0.5 * Math.sin(this.s.time.now * 0.006);
    // Dashed approach line along the ground from each mover.
    g.lineStyle(1.5, rgb, 0.55);
    for (const m of movers) {
      const len = Math.hypot(x - m.x, y - m.y);
      if (len < RING_R) continue;
      const ux = (x - m.x) / len;
      const uy = (y - m.y) / len;
      for (let d = 0; d < len - RING_R; d += DASH + GAP) {
        const e = Math.min(d + DASH, len - RING_R);
        const ax = m.x + ux * d;
        const ay = m.y + uy * d;
        const bx = m.x + ux * e;
        const by = m.y + uy * e;
        const a = worldToScreen(ax, ay, groundZ(w, ax, ay), this.p);
        const b = worldToScreen(bx, by, groundZ(w, bx, by), this.q);
        g.lineBetween(a.x, a.y, b.x, b.y);
      }
    }
    // Pulsing ground ring.
    const r = RING_R * (0.85 + 0.3 * pulse);
    g.lineStyle(2, rgb, 0.65 + 0.3 * pulse);
    g.beginPath();
    for (let k = 0; k <= RING_SEGS; k++) {
      const a = (k / RING_SEGS) * Math.PI * 2;
      const at = worldToScreen(x + Math.cos(a) * r, y + Math.sin(a) * r, z, this.p);
      if (k === 0) g.moveTo(at.x, at.y);
      else g.lineTo(at.x, at.y);
    }
    g.strokePath();
    // Stake up from the ground to a diamond.
    const base = worldToScreen(x, y, z, this.p);
    const top = worldToScreen(x, y, z + STAKE_Z, this.q);
    g.lineStyle(2, rgb, 0.9);
    g.lineBetween(base.x, base.y, top.x, top.y);
    const d = 7 * top.scale;
    g.fillStyle(rgb, 0.9);
    g.fillTriangle(top.x, top.y - d, top.x + d, top.y, top.x, top.y + d);
    g.fillTriangle(top.x, top.y - d, top.x, top.y + d, top.x - d, top.y);
  }
}
