
import Phaser from "phaser";
import { Craft } from "../../../sim/craft";
import { worldToScreen } from "../../../worldgen/world";
import type { MissionScene } from "../../missionScene";

/** Threat arc half-width (deg) at paint start — widest point of the paint → lock shape. */
const THREAT_ARC_PAINT_HALF = 22.5;

/** Threat arc half-width (deg) at full paint charge = red lock arc at missile launch. */
const THREAT_ARC_LOCK_HALF = 6;

/** Plain arc; once shorter than its line width it becomes a single dot (no stacked caps). */
export function strokeArc(
  g: Phaser.GameObjects.Graphics,
  cx: number,
  cy: number,
  r: number,
  dir: number,
  half: number,
  width: number,
  color: number,
  alpha: number
): void {
  if (half * 2 * r <= width) {
    g.fillStyle(color, alpha);
    g.fillCircle(cx + Math.cos(dir) * r, cy + Math.sin(dir) * r, width / 2);
    return;
  }
  g.lineStyle(width, color, alpha);
  g.beginPath();
  g.arc(cx, cy, r, dir - half, dir + half, false);
  g.strokePath();
}

/** Threat warnings: PAINTED / MISSILE LOCK text + per-threat arcs around the targeted craft. */
export class ThreatHud {
  /** Mild RWR-style warning: an enemy is charging missile lock on us (not yet fired). */
  paintTxt!: Phaser.GameObjects.Text;
  /** Strong warning: a locked enemy missile is currently in flight toward us. */
  missileTxt!: Phaser.GameObjects.Text;
  /** Paint / missile-lock arcs around the targeted friendly craft. */
  arcGfx!: Phaser.GameObjects.Graphics;

  constructor(readonly s: MissionScene) {}

  /**
   * Threat warnings: a mild "being painted" cue while any enemy charges missile lock on us
   * (aim/secondary lock-on hold, not yet fired), and a stronger "missile lock" cue while an
   * actual enemy seeker is in flight toward us.
   */
  sync(): void {
    const show = this.s.player.phase === "flight" && !this.s.camera.mapView && !this.s.over;
    const painted = show && this.s.units.some((u) => !u.dead && u.paintT != null);
    const missileInbound =
      show &&
      this.s.shots.some(
        (s) => !s.deadfall && s.from === "enemy" && s.homePlayer && this.s.targeting.hudThreatTarget(this.s.targeting.enemySeekerTarget(s))
      );
    this.paintTxt.setVisible(painted && !missileInbound);
    if (painted && !missileInbound) {
      const blink = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(this.s.time.now * 0.006));
      this.paintTxt.setAlpha(blink);
    }
    this.missileTxt.setVisible(missileInbound);
    if (missileInbound) {
      const blink = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(this.s.time.now * 0.016));
      this.missileTxt.setAlpha(blink);
    }
  }

  /**
   * Arcs around the targeted craft, one continuous shape per threat: paint starts widest and
   * fades in as lock charges, narrowing to the lock width; the red seeker arc starts there and
   * narrows with closure to a dot at point blank.
   */
  drawArcs(): void {
    const g = this.arcGfx;
    g.clear();
    if (this.s.player.phase !== "flight" || this.s.camera.mapView || this.s.over) return;
    const now = this.s.time.now;
    const focus = this.s.targeting.combatFocus();
    const ring = (c: Craft) => {
      const at = worldToScreen(c.x, c.y, c.z);
      return { at, r: (c.spec.radius * 2.6 + 36) * at.scale };
    };
    const paintBlink = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(now * 0.004));
    for (const u of this.s.units) {
      if (u.dead || u.paintT == null) continue;
      const { at, r } = ring(u.paintHost ? this.s.player : focus);
      const ut = worldToScreen(u.x, u.y, u.z);
      const half = Phaser.Math.DegToRad(Phaser.Math.Linear(THREAT_ARC_PAINT_HALF, THREAT_ARC_LOCK_HALF, u.paintT));
      const alpha = u.paintT * 0.8 * paintBlink;
      strokeArc(g, at.x, at.y, r, Math.atan2(ut.y - at.y, ut.x - at.x), half, 2, 0xfff0c8, alpha);
    }
    const lockA = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(now * 0.016));
    for (const s of this.s.shots) {
      if (s.deadfall || s.from !== "enemy" || !s.homePlayer || s.seekDisabled) continue;
      if (this.s.countermeasures.closestFlare(s.x, s.y, s.z)) continue; // decoyed — not homing on us
      const seekTgt = this.s.targeting.enemySeekerTarget(s);
      if (seekTgt !== this.s.player && seekTgt !== focus) continue;
      const { at, r } = ring(seekTgt);
      const st = worldToScreen(s.x, s.y, s.z);
      const dist = Math.hypot(s.x - seekTgt.x, s.y - seekTgt.y, s.z - seekTgt.z);
      s.lockD0 ??= Math.max(1, dist);
      const closure = Phaser.Math.Clamp(dist / s.lockD0, 0, 1);
      const half = Phaser.Math.DegToRad(Phaser.Math.Linear(0.5, THREAT_ARC_LOCK_HALF, closure));
      strokeArc(g, at.x, at.y, r, Math.atan2(st.y - at.y, st.x - at.x), half, 4, 0xff3a22, lockA);
    }
  }

}
