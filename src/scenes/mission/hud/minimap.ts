import Phaser from "phaser";
import type { Shot } from "../../../sim/combat";
import { WORLD } from "../../../worldgen/world";
import type { MissionScene } from "../../missionScene";
import { isNeutral } from "../../../sim/roster";
import { fillCircleFast, lineFast, strokeCircleFast } from "../../../render/fastShapes";

/** Civilian structures: gray, not hostile red. */
const NEUTRAL_MARK = 0x9a9890;
/** Power pylons: tiny dots so a line reads as a dotted trace, not a row of buildings. */
const PYLON_DOT_R = 1;

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
    for (const u of this.s.units) {
      if (u.dead) continue;
      const mx = cx + (u.x - px) * s;
      const my = cy + (u.y - py) * s;
      if (Math.hypot(mx - cx, my - cy) > mapR) continue;
      g.fillStyle(u.hv ? 0xff5a3a : isNeutral(u.kind) ? NEUTRAL_MARK : 0xc45c28, 1);
      fillCircleFast(g, mx, my, u.hv ? 3.5 : u.kind === "pylon" ? PYLON_DOT_R : 2);
    }
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
}
