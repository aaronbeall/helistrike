import Phaser from "phaser";
import type { Shot } from "../../../sim/combat";
import { WORLD } from "../../../worldgen/world";
import type { MissionScene } from "../../missionScene";

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
    this.gfx.lineStyle(2, 0xe8b84a, 0.85);
    this.gfx.strokeCircle(cx, cy, rimR);
    this.gfx.lineStyle(1, 0xe8b84a, 0.2);
    this.gfx.strokeCircle(cx, cy, 45);
    const toMap = (x: number, y: number) => ({
      x: cx + (x - this.s.player.x) * s,
      y: cy + (y - this.s.player.y) * s,
    });
    const inRing = (p: { x: number; y: number }) => Math.hypot(p.x - cx, p.y - cy) <= mapR;
    const mark = 0xe8b84a;
    for (const u of this.s.units) {
      if (u.dead) continue;
      const p = toMap(u.x, u.y);
      if (!inRing(p)) continue;
      this.gfx.fillStyle(u.hv ? 0xff5a3a : 0xc45c28, 1);
      this.gfx.fillCircle(p.x, p.y, u.hv ? 3.5 : 2);
    }
    for (const r of this.s.remotes) {
      if (r.detonate || r.dock) continue;
      const p = toMap(r.x, r.y);
      // Yellow diamond — player drones / remotes only. Clamped onto the rim line when
      // off-radar (continuous with the in-ring position, no shrink).
      const dx = p.x - cx;
      const dy = p.y - cy;
      const d = Math.hypot(dx, dy);
      const k = d > rimR ? rimR / d : 1;
      this.s.drawMiniDiamond(cx + dx * k, cy + dy * k, 4.5, mark);
    }
    for (const shot of this.s.shots) {
      if (!shotShowsOnRadar(shot)) continue;
      const p = toMap(shot.x, shot.y);
      if (!inRing(p)) continue;
      // Player/friendly yellow; enemy red.
      const shotMark = shot.from === "enemy" ? 0xff5a3a : mark;
      this.s.drawMiniMissileTick(p.x, p.y, shot.angle, shotMark);
    }
    this.gfx.fillStyle(0xe8b84a, 1);
    this.gfx.fillCircle(cx, cy, 3);
    this.gfx.lineStyle(1.5, 0xe8b84a, 1);
    this.gfx.lineBetween(
      cx,
      cy,
      cx + Math.cos(this.s.player.angle) * 12,
      cy + Math.sin(this.s.player.angle) * 12
    );
  }
}
