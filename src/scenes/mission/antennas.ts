import Phaser from "phaser";
import { type RemoteCraft } from "../../sim/remote";
import { ZOff, worldDepth } from "../../render/depth";
import { lookupSpritePoints } from "../../art/spriteOrigin";
import { spriteUvPos } from "../../art/sprites";
import { worldToScreen, cameraPointVisible, screenToWorldAtZ } from "../../worldgen/world";
import type { MissionScene } from "../missionScene";

/** Whip antenna physics + strokes for the host and remotes. */
export class Antennas {
  remoteAntennaGfx!: Phaser.GameObjects.Graphics;
  /**
   * Player craft whip tip (Wraith cupola, …). Same spring as remote antennas;
   * base tracks the gun overlay so hull + turret motion both whip it.
   */
  heliAntenna?: {
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    vz: number;
    bx: number;
    by: number;
    bz: number;
    bvx: number;
    bvy: number;
    angle: number;
  };

  constructor(readonly s: MissionScene) {}

  /** Per-mission state reset (called from the scene's init). */
  reset(): void {
    this.heliAntenna = undefined;
  }

  /** World base for a remote whip antenna — sprite UV when the body is posed. */
  remoteAntennaBase(drone: RemoteCraft): { x: number; y: number; z: number } | undefined {
    if (!drone.spec.antenna) return undefined;
    const z = drone.z + drone.spec.height * 0.42;
    const body = this.s.remoteVisuals.remoteBodyImage(drone);
    const look = body?.visible ? body.texture.key : drone.spec.body;
    const uv = lookupSpritePoints(look, "antenna")[0];
    if (body?.visible && uv) {
      const scr = spriteUvPos(body, uv.x, uv.y);
      const at = screenToWorldAtZ(scr.x, scr.y, z);
      return { x: at.x, y: at.y, z };
    }
    const aft = drone.spec.radius * 0.72;
    return {
      x: drone.x - Math.cos(drone.angle) * aft,
      y: drone.y - Math.sin(drone.angle) * aft,
      z,
    };
  }

  /**
   * Player craft antenna base — UV on the turret/gun overlay that authors `antenna`
   * (Wraith rail cupola). Falls back to hull body UV if needed.
   */
  heliAntennaBase(): { x: number; y: number; z: number; face: number } | undefined {
    const cfg = this.s.player.spec.antenna;
    if (!cfg) return undefined;
    const h = this.s.player;
    const z = h.z + h.spec.height * 0.55;
    const face = h.gunAngle;
    for (const gun of this.s.guns) {
      if (!gun.visible) continue;
      const uv = lookupSpritePoints(gun.texture.key, "antenna")[0];
      if (!uv) continue;
      const scr = spriteUvPos(gun, uv.x, uv.y);
      const at = screenToWorldAtZ(scr.x, scr.y, z);
      return { x: at.x, y: at.y, z, face };
    }
    const body = this.s.body;
    if (body?.visible) {
      const uv = lookupSpritePoints(body.texture.key, "antenna")[0];
      if (uv) {
        const scr = spriteUvPos(body, uv.x, uv.y);
        const at = screenToWorldAtZ(scr.x, scr.y, z);
        return { x: at.x, y: at.y, z, face: h.angle };
      }
    }
    return {
      x: h.x - Math.cos(face) * h.spec.radius * 0.35,
      y: h.y - Math.sin(face) * h.spec.radius * 0.35,
      z,
      face,
    };
  }

  whipAntennaRest(
    base: { x: number; y: number; z: number },
    faceAng: number,
    cfg: { length?: number; aft?: number }
  ): { x: number; y: number; z: number } {
    const len = cfg.length ?? 12;
    const aft = cfg.aft ?? 2;
    return {
      x: base.x - Math.cos(faceAng) * aft,
      y: base.y - Math.sin(faceAng) * aft,
      z: base.z + len,
    };
  }

  /**
   * Spring whip — lags base accel / yaw, overshoots rest on stop, then settles.
   * `faceAng` is the heading the rest tip leans aft of (turret aim or hull yaw).
   */
  tickWhipAntenna(
    tip:
      | {
          x: number;
          y: number;
          z: number;
          vx: number;
          vy: number;
          vz: number;
          bx: number;
          by: number;
          bz: number;
          bvx: number;
          bvy: number;
          angle: number;
        }
      | undefined,
    base: { x: number; y: number; z: number },
    faceAng: number,
    cfg: {
      length?: number;
      aft?: number;
      stiffness?: number;
      damping?: number;
      yawWhip?: number;
      lag?: number;
    },
    dt: number
  ): NonNullable<typeof tip> {
    const rest = this.whipAntennaRest(base, faceAng, cfg);
    if (!tip) {
      return {
        x: rest.x,
        y: rest.y,
        z: rest.z,
        vx: 0,
        vy: 0,
        vz: 0,
        bx: base.x,
        by: base.y,
        bz: base.z,
        bvx: 0,
        bvy: 0,
        angle: faceAng,
      };
    }
    const invDt = 1 / Math.max(1e-4, dt);
    const bvx = (base.x - tip.bx) * invDt;
    const bvy = (base.y - tip.by) * invDt;
    const ax = (bvx - tip.bvx) * invDt;
    const ay = (bvy - tip.bvy) * invDt;
    const omega = Phaser.Math.Angle.Wrap(faceAng - tip.angle) * invDt;

    const k = cfg.stiffness ?? 26;
    const c = cfg.damping ?? 2.4;
    const lag = cfg.lag ?? 1.6;
    const whip = cfg.yawWhip ?? 12;
    const len = cfg.length ?? 12;

    tip.vx += ((rest.x - tip.x) * k - tip.vx * c) * dt;
    tip.vy += ((rest.y - tip.y) * k - tip.vy * c) * dt;
    tip.vz += ((rest.z - tip.z) * k - tip.vz * c) * dt;
    tip.vx -= ax * lag * dt;
    tip.vy -= ay * lag * dt;
    tip.vx += -Math.sin(faceAng) * omega * whip * len * dt;
    tip.vy += Math.cos(faceAng) * omega * whip * len * dt;

    tip.x += tip.vx * dt;
    tip.y += tip.vy * dt;
    tip.z += tip.vz * dt;

    {
      const dx = tip.x - base.x;
      const dy = tip.y - base.y;
      const dz = tip.z - base.z;
      const span = Math.hypot(dx, dy, dz);
      const maxLen = len * 1.28;
      if (span > maxLen && span > 1e-4) {
        const s = maxLen / span;
        tip.x = base.x + dx * s;
        tip.y = base.y + dy * s;
        tip.z = base.z + dz * s;
        const rv = tip.vx * dx + tip.vy * dy + tip.vz * dz;
        if (rv > 0) {
          const inv = 1 / (span * span);
          tip.vx -= dx * rv * inv;
          tip.vy -= dy * rv * inv;
          tip.vz -= dz * rv * inv;
        }
      }
    }

    tip.bx = base.x;
    tip.by = base.y;
    tip.bz = base.z;
    tip.bvx = bvx;
    tip.bvy = bvy;
    tip.angle = faceAng;
    return tip;
  }

  tickRemoteAntenna(drone: RemoteCraft, dt: number): void {
    const cfg = drone.spec.antenna;
    if (!cfg || dt <= 1e-6) return;
    const base = this.remoteAntennaBase(drone);
    if (!base) return;
    drone.antenna = this.tickWhipAntenna(drone.antenna, base, drone.angle, cfg, dt);
  }

  tickHeliAntenna(dt: number): void {
    const cfg = this.s.player.spec.antenna;
    if (!cfg || dt <= 1e-6) return;
    if (this.s.player.phase === "dead") {
      this.heliAntenna = undefined;
      return;
    }
    const base = this.heliAntennaBase();
    if (!base) return;
    this.heliAntenna = this.tickWhipAntenna(this.heliAntenna, base, base.face, cfg, dt);
  }

  drawWhipAntennaStroke(
    g: Phaser.GameObjects.Graphics,
    base: { x: number; y: number; z: number },
    tip: { x: number; y: number; z: number },
    rest: { x: number; y: number; z: number }
  ): void {
    const leanX = tip.x - rest.x;
    const leanY = tip.y - rest.y;
    const leanZ = tip.z - rest.z;
    const bend = 1.55;
    const c1 = {
      x: base.x + (rest.x - base.x) * 0.35 + leanX * bend * 0.55,
      y: base.y + (rest.y - base.y) * 0.35 + leanY * bend * 0.55,
      z: base.z + (rest.z - base.z) * 0.35 + leanZ * bend * 0.25,
    };
    const c2 = {
      x: base.x + (rest.x - base.x) * 0.72 + leanX * bend * 1.05,
      y: base.y + (rest.y - base.y) * 0.72 + leanY * bend * 1.05,
      z: base.z + (rest.z - base.z) * 0.72 + leanZ * bend * 0.55,
    };
    const segs = 10;
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const u = 1 - t;
      const wx =
        u * u * u * base.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * tip.x;
      const wy =
        u * u * u * base.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * tip.y;
      const wz =
        u * u * u * base.z + 3 * u * u * t * c1.z + 3 * u * t * t * c2.z + t * t * t * tip.z;
      const at = worldToScreen(wx, wy, wz);
      pts.push({ x: at.x, y: at.y });
    }
    if (pts.length < 2) return;
    const stroke = (color: number, alpha: number, width: number, dy: number) => {
      g.lineStyle(width, color, alpha);
      g.beginPath();
      g.moveTo(pts[0]!.x, pts[0]!.y + dy);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i]!.x, pts[i]!.y + dy);
      g.strokePath();
    };
    stroke(0x0c0c0e, 0.55, 1.85, 0.45);
    stroke(0x2a2c28, 0.78, 1.05, 0);
    stroke(0x3e4238, 0.35, 0.45, -0.3);
  }

  drawRemoteAntennas(): void {
    const g = this.remoteAntennaGfx;
    if (!g) return;
    g.clear();
    // Seed high so Math.min keeps real worldDepth values (Layer.WORLD alone
    // clamped the stroke under turret sprites at ~focal bias).
    let depth = Number.POSITIVE_INFINITY;
    let drew = false;
    // Sort with the host hull z/y (same as gun overlays), not whip tip altitude,
    // and sit above cupola/coax (turret + coaxBias ≤ ~0.6).
    const antOff = ZOff.turret + 0.85;
    for (const r of this.s.remotes) {
      if (!r.spec.antenna || r.detonate || r.dock) continue;
      if (!cameraPointVisible(r.z, r.y)) continue;
      const base = this.remoteAntennaBase(r);
      const tip = r.antenna;
      if (!base || !tip) continue;
      const rest = this.whipAntennaRest(base, r.angle, r.spec.antenna);
      this.drawWhipAntennaStroke(g, base, tip, rest);
      depth = Math.min(depth, worldDepth(r.z, antOff, r.y));
      drew = true;
    }
    const heliCfg = this.s.player.spec.antenna;
    if (heliCfg && this.s.player.phase !== "dead" && this.heliAntenna) {
      const base = this.heliAntennaBase();
      if (base && cameraPointVisible(base.z, base.y)) {
        const rest = this.whipAntennaRest(base, base.face, heliCfg);
        this.drawWhipAntennaStroke(g, base, this.heliAntenna, rest);
        const h = this.s.player;
        depth = Math.min(depth, worldDepth(h.z, antOff, h.y));
        drew = true;
      }
    }
    if (drew) g.setDepth(depth);
  }
}
