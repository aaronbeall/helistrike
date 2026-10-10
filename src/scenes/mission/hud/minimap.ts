import Phaser from "phaser";
import { radius, type Shot, type Unit } from "../../../sim/combat";
import { WORLD } from "../../../worldgen/world";
import type { MissionScene } from "../../missionScene";
import { isNeutral, specOf } from "../../../sim/roster";
import { footprintHalfX, footprintHalfY, footprintInto } from "../../../render/footprint";
import { fillCircleFast, lineFast, strokeCircleFast } from "../../../render/fastShapes";

/** Civilian structures: gray, not hostile red. */
const NEUTRAL_MARK = 0x9a9890;
/** Power pylons: tiny dots so a line reads as a dotted trace, not a row of buildings. */
const PYLON_DOT_R = 1;
/** Smallest blip radius (px) so small units still read. */
const MIN_BLIP_R = 1.25;
/** Units (not buildings) mark at this multiple of their radius so they read at radar scale. */
const UNIT_BLIP_SCALE = 2;
const STRUCTURES_FIRST = [true, false] as const;
/** HV target arrows (px): gap past the blip, length, half-width. */
const HV_ARROW_GAP = 2;
const HV_ARROW_LEN = 6.5;
const HV_ARROW_HALF_W = 3.5;
/** Arrow fill + dark outline (px) so they read on any terrain. */
const HV_ARROW_RGB = 0xffe08a;
const HV_ARROW_EDGE_RGB = 0x12100c;
const HV_ARROW_EDGE = 1.25;
const ARROW_PASSES = [HV_ARROW_EDGE, 0] as const;

/** Minimap: missiles / rockets / seekers — not gun tracers or beams. */
function shotShowsOnRadar(s: Shot): boolean {
  // Call-strike shells are tagged bomblet to skip lock HUD, but should still blip.
  if (s.st?.callStrikeMarkId != null) return true;
  if (s.st?.bomblet) return false;
  if (s.beh?.launch.mode === "beam") return false;
  if (s.beh?.payload?.remote) return false;
  if (s.beh?.guidance) return true;
  if (s.motor != null || s.cruise != null) return true;
  if (s.beh?.exhaust) return true;
  const look = s.look ?? s.beh?.art.look ?? "";
  return /missile|guided|rocket|aam|photon|mini_rocket|artillery/i.test(look);
}

/** Corner radar: terrain + wreck layers under live unit / remote / shot blips. */
export class Minimap {
  gfx!: Phaser.GameObjects.Graphics;
  bg!: Phaser.GameObjects.Graphics;
  terrain!: Phaser.GameObjects.Image;
  wrecks!: Phaser.GameObjects.Image;
  mask!: Phaser.GameObjects.Graphics;

  private hv: Unit[] = [];

  constructor(readonly s: MissionScene) {}

  draw(): void {
    const cx = 18 + 88;
    const cy = this.s.scale.height - 18 - 88;
    const mapR = 84;
    // World diameter shown in the ring (larger = zoomed out / wider coverage).
    const span = 2600;
    const s = (mapR * 2) / span;
    this.terrain.setDisplaySize(WORLD * s, WORLD * s);
    const tp = this.s.hudLocal(cx - (this.s.player.x - WORLD / 2) * s, cy - (this.s.player.y - WORLD / 2) * s);
    this.terrain.setPosition(tp.x, tp.y);
    this.wrecks.setDisplaySize(WORLD * s, WORLD * s);
    this.wrecks.setPosition(this.terrain.x, this.terrain.y);
    this.gfx.clear();
    const rimR = 90;
    const g = this.gfx;
    strokeCircleFast(g, cx, cy, rimR, 2, 0xe8b84a, 0.85);
    strokeCircleFast(g, cx, cy, 45, 1, 0xe8b84a, 0.2);
    const px = this.s.player.x;
    const py = this.s.player.y;
    const mark = 0xe8b84a;
    // Structures first so units (e.g. on bridge decks) mark above them; HV arrows over everything.
    const hv = this.hv;
    hv.length = 0;
    for (const pass of STRUCTURES_FIRST) {
      for (const u of this.s.units) {
        if (u.dead || !!specOf(u.kind).building !== pass) continue;
        const mx = cx + (u.x - px) * s;
        const my = cy + (u.y - py) * s;
        if (Math.hypot(mx - cx, my - cy) > mapR) continue;
        g.fillStyle(u.hv ? 0xff5a3a : isNeutral(u.kind) ? NEUTRAL_MARK : 0xc45c28, 1);
        this.blip(u, mx, my, s);
        if (u.hv) hv.push(u);
      }
    }
    for (const u of hv) this.hvArrows(u, cx + (u.x - px) * s, cy + (u.y - py) * s, s);
    for (const r of this.s.remotes) {
      if (r.detonate || r.dock) continue;
      // Yellow diamond — player drones / remotes only. Clamped onto the rim line when
      // off-radar (continuous with the in-ring position, no shrink).
      const dx = (r.x - px) * s;
      const dy = (r.y - py) * s;
      const d = Math.hypot(dx, dy);
      const k = d > rimR ? rimR / d : 1;
      this.s.drawMiniDiamond(cx + dx * k, cy + dy * k, 4.5, mark);
    }
    for (const shot of this.s.shots) {
      if (!shotShowsOnRadar(shot)) continue;
      const mx = cx + (shot.x - px) * s;
      const my = cy + (shot.y - py) * s;
      if (Math.hypot(mx - cx, my - cy) > mapR) continue;
      // Player/friendly yellow; enemy red.
      const shotMark = shot.from === "enemy" ? 0xff5a3a : mark;
      this.s.drawMiniMissileTick(mx, my, shot.angle, shotMark);
    }
    g.fillStyle(0xe8b84a, 1);
    fillCircleFast(g, cx, cy, 3);
    lineFast(g, cx, cy, cx + Math.cos(this.s.player.angle) * 12, cy + Math.sin(this.s.player.angle) * 12, 1.5, 0xe8b84a, 1);
  }

  /** Buildings mark their footprint (rotated rect or circle); units a circle at their scaled radius. */
  private blip(u: Unit, mx: number, my: number, s: number): void {
    const g = this.gfx;
    if (u.kind === "pylon") return fillCircleFast(g, mx, my, PYLON_DOT_R);
    if (!specOf(u.kind).building) return fillCircleFast(g, mx, my, unitBlipR(u, s));
    const fp = footprintInto(u);
    if (fp.shape === "circle") return fillCircleFast(g, mx, my, Math.max(MIN_BLIP_R, fp.r * s));
    const hl = Math.max(MIN_BLIP_R, fp.halfL * s);
    const hw = Math.max(MIN_BLIP_R, fp.halfW * s);
    const c = Math.cos(fp.angle);
    const n = Math.sin(fp.angle);
    const ax = c * hl;
    const ay = n * hl;
    const bx = -n * hw;
    const by = c * hw;
    g.fillTriangle(mx + ax + bx, my + ay + by, mx + ax - bx, my + ay - by, mx - ax - bx, my - ay - by);
    g.fillTriangle(mx + ax + bx, my + ay + by, mx - ax - bx, my - ay - by, mx - ax + bx, my - ay + by);
  }

  /** Four arrows pointing in at an HV target from each side of its blip. */
  private hvArrows(u: Unit, mx: number, my: number, s: number): void {
    const g = this.gfx;
    const fp = footprintInto(u);
    const building = !!specOf(u.kind).building;
    const rx = (building ? Math.max(MIN_BLIP_R, footprintHalfX(fp) * s) : unitBlipR(u, s)) + HV_ARROW_GAP;
    const ry = (building ? Math.max(MIN_BLIP_R, footprintHalfY(fp) * s) : unitBlipR(u, s)) + HV_ARROW_GAP;
    // Outline pass (grown arrow), then the fill.
    for (const e of ARROW_PASSES) {
      g.fillStyle(e ? HV_ARROW_EDGE_RGB : HV_ARROW_RGB, e ? 0.9 : 1);
      const l = HV_ARROW_LEN + e;
      const w = HV_ARROW_HALF_W + e;
      const gy = ry - e;
      const gx = rx - e;
      g.fillTriangle(mx, my - gy, mx - w, my - gy - l, mx + w, my - gy - l);
      g.fillTriangle(mx, my + gy, mx - w, my + gy + l, mx + w, my + gy + l);
      g.fillTriangle(mx - gx, my, mx - gx - l, my - w, mx - gx - l, my + w);
      g.fillTriangle(mx + gx, my, mx + gx + l, my - w, mx + gx + l, my + w);
    }
  }
}

function unitBlipR(u: Unit, s: number): number {
  return Math.max(MIN_BLIP_R, radius(u.kind) * UNIT_BLIP_SCALE * s);
}
