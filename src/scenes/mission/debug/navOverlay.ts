import type Phaser from "phaser";
import { Layer } from "../../../render/depth";
import { DomText } from "../../../ui/domText";
import { LAND_BLOCKED, LAND_MODE, LAND_SHALLOW, NAV_CELL, WATER_MODE } from "../../../sim/navGrid";
import { CLIMB_GRADE } from "../../../sim/navigation";
import { Camera25D, groundZ, worldToScreen, type ScreenPos } from "../../../worldgen/world";
import type { MissionScene } from "../../missionScene";

/** Cells drawn each way from the camera focus. */
const VIEW_CELLS = 26;
const BLOCKED_RGB = 0xff3a2a;
const SHALLOW_RGB = 0x4ad8ff;
const DECK_RGB = 0xffd84a;
const CLIFF_RGB = 0xff9a2a;
const ROUTE_RGB = 0x7dff6a;
const FLEE_RGB = 0xff6ad8;

/** Nav grid debug overlay: blocked / shallow / deck cells, closed cliff crossings, low clearance, unit routes + flee points. */
export class NavOverlay {
  on = false;
  private gfx!: Phaser.GameObjects.Graphics;
  private hud?: DomText;
  private p: ScreenPos = { x: 0, y: 0, scale: 1 };
  private q: ScreenPos = { x: 0, y: 0, scale: 1 };

  constructor(readonly s: MissionScene) {}

  reset(): void {
    this.on = false;
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
    this.gfx.clear();
    this.hud ??= new DomText(this.s.game, 16, 420, 12, "#b8ff9a");
    this.hud.setVisible(on);
    this.s.debugMenu.sync();
  }

  draw(): void {
    if (!this.on) return;
    const g = this.gfx;
    g.clear();
    const grid = this.s.nav.grid;
    if (!grid) return;
    const searches = grid.takeSearches();
    if (!this.s.camera.mapWorldHidden) {
      const n = grid.n;
      const cx0 = Math.floor(Camera25D.focusX / NAV_CELL);
      const cy0 = Math.floor(Camera25D.focusY / NAV_CELL);
      for (let cy = Math.max(0, cy0 - VIEW_CELLS); cy <= Math.min(n - 1, cy0 + VIEW_CELLS); cy++) {
        for (let cx = Math.max(0, cx0 - VIEW_CELLS); cx <= Math.min(n - 1, cx0 + VIEW_CELLS); cx++) {
          const c = cy * n + cx;
          const x0 = cx * NAV_CELL;
          const y0 = cy * NAV_CELL;
          if (grid.hasDeck(c)) this.quad(x0, y0, DECK_RGB, 0.4);
          else if (grid.land[c] === LAND_BLOCKED) this.quad(x0, y0, BLOCKED_RGB, grid.water[c] ? 0.14 : 0.32);
          else if (grid.land[c] === LAND_SHALLOW) this.quad(x0, y0, SHALLOW_RGB, 0.22);
          else if (grid.clearAt(LAND_MODE, c) <= 1) this.quad(x0, y0, 0xffffff, 0.08);
          // Too-steep crossings: a tick toward each neighbour — orange blocks default hulls, red blocks medium climbers too.
          const mx = (cx + 0.5) * NAV_CELL;
          const my = (cy + 0.5) * NAV_CELL;
          for (let d = 0; d < 8; d++) {
            const gr = grid.crossingGrade(c, d);
            if (gr <= CLIMB_GRADE.default) continue;
            g.lineStyle(1.5, gr > CLIMB_GRADE.medium ? BLOCKED_RGB : CLIFF_RGB, 0.85);
            const a = (d * Math.PI) / 4;
            this.line(mx, my, mx + Math.cos(a) * NAV_CELL * 0.45, my + Math.sin(a) * NAV_CELL * 0.45);
          }
        }
      }
      const agents = [...this.s.units.filter((u) => !u.dead), ...this.s.remotes];
      for (const u of agents) {
        const nav = u.route;
        if (!nav) continue;
        if (nav.fleeT > 0) {
          g.lineStyle(1, FLEE_RGB, 0.7);
          this.line(u.x, u.y, nav.fleeX, nav.fleeY);
        }
        if (!nav.path.length) continue;
        g.lineStyle(2, nav.stuckT > 0 ? BLOCKED_RGB : ROUTE_RGB, 0.85);
        let px = u.x;
        let py = u.y;
        for (let i = nav.pi; i < nav.path.length; i++) {
          const c = nav.path[i]!;
          const x = grid.centerX(c);
          const y = grid.centerY(c);
          this.line(px, py, x, y);
          px = x;
          py = y;
        }
      }
    }
    let routed = 0;
    let stuck = 0;
    for (const u of this.s.units) {
      if (u.dead || !u.route) continue;
      if (u.route.path.length) routed++;
      if (u.route.stuckT > 0) stuck++;
    }
    const landRegions = grid.regionCount(LAND_MODE);
    const waterRegions = grid.regionCount(WATER_MODE);
    this.hud!.setText(
      [
        `NAV GRID  cell ${NAV_CELL}  ${grid.n}x${grid.n}  v${grid.version}`,
        `regions  land ${landRegions}  water ${waterRegions}`,
        `routes ${routed}  stuck ${stuck}  A* ${searches}/frame`,
        "red blocked · cyan shallow · yellow deck · orange/red tick: too steep (default / medium) · green route · pink flee",
      ].join("\n")
    );
  }

  private quad(x0: number, y0: number, rgb: number, alpha: number): void {
    const g = this.gfx;
    const w = this.s.world;
    const xs = [x0, x0 + NAV_CELL, x0 + NAV_CELL, x0];
    const ys = [y0, y0, y0 + NAV_CELL, y0 + NAV_CELL];
    g.beginPath();
    for (let k = 0; k < 4; k++) {
      const p = worldToScreen(xs[k]!, ys[k]!, groundZ(w, xs[k]!, ys[k]!), this.p);
      if (k === 0) g.moveTo(p.x, p.y);
      else g.lineTo(p.x, p.y);
    }
    g.closePath();
    g.fillStyle(rgb, alpha);
    g.fillPath();
  }

  private line(x0: number, y0: number, x1: number, y1: number): void {
    const w = this.s.world;
    const a = worldToScreen(x0, y0, groundZ(w, x0, y0), this.p);
    const b = worldToScreen(x1, y1, groundZ(w, x1, y1), this.q);
    this.gfx.lineBetween(a.x, a.y, b.x, b.y);
  }
}
