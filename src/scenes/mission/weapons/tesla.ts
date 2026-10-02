import Phaser from "phaser";
import { heightOf, launchIsArcBeam, stunUnit, type Unit, type PlayerWpnSpec } from "../../../sim/combat";
import { ZOff, worldDepth } from "../../../render/depth";
import { craftSocketPoints } from "../../../sim/crafts";
import { FX_SHEET_SIZE } from "../../../art/sprites";
import { groundZ, worldToScreen } from "../../../worldgen/world";
import type { MissionScene } from "../../missionScene";

export const TESLA_STREAMS = 3;

export const TESLA_SEGS = 14;

const TESLA_HEAD_SPEED = 1750;

const TESLA_LOCK_REACH = 26;

/** Extra linger seconds per second the arc stays locked on a target. */
const TESLA_STUN_EXPOSE_MUL = 0.9;

/** Cap on post-arc stun linger. */
const TESLA_STUN_MAX = 4;

/** Original zap bake size the Tesla stamp scales were tuned against. */
const TESLA_ZAP_REF = 28;

const teslaZapScale = (mul: number) => mul * (TESLA_ZAP_REF / FX_SHEET_SIZE.zap);

/** Tesla coil: live arc + head, reach clamp, target pick, arc drawing, zaps and sparks, stun exposure. */
export class Tesla {
  gfx!: Phaser.GameObjects.Graphics;
  zapPool: Phaser.GameObjects.Image[] = [];
  zaps: { im: Phaser.GameObjects.Image; t: number; max: number }[] = [];
  segPool: Phaser.GameObjects.Image[] = [];
  glowPool: Phaser.GameObjects.Image[] = [];
  headZapPool: Phaser.GameObjects.Image[] = [];
  /** Live Tesla barrel→head ribbon while the trigger is held. */
  live: {
    ox: number;
    oy: number;
    oz: number;
    tx: number;
    ty: number;
    tz: number;
    hx: number;
    hy: number;
    hz: number;
    targetId?: number;
  } | null = null;
  head: { x: number; y: number; z: number } | null = null;
  lockId?: number;
  /** How long the live arc has been on the current stun target. */
  exposeT = 0;
  /** Unit id currently accumulating Tesla exposure. */
  exposeId?: number;
  /** Sim-time clock for Tesla helix / flicker (seconds). */
  animT = 0;

  constructor(readonly s: MissionScene) {}

  /** Per-mission state reset (called from the scene's init). */
  reset(): void {
    this.zaps = [];
    this.live = null;
    this.head = null;
    this.lockId = undefined;
    this.exposeT = 0;
    this.exposeId = undefined;
    this.animT = 0;
  }

  muzzleOrigin(slot: number): { x: number; y: number; z: number } {
    const h = this.s.player;
    const socket = h.spec.sockets[slot];
    const z = this.s.fireControl.playerMuzzleZ(slot);
    if (socket?.class === "hardpoint") {
      const p = this.s.fireControl.hardpointPylon(slot);
      return { x: p.x, y: p.y, z };
    }
    if (socket?.class === "fixed") {
      const authored = craftSocketPoints(h.spec, socket);
      if (authored[0]) {
        const at = this.s.craftBodyMountWorldPos(authored[0]);
        return { x: at.x, y: at.y, z };
      }
    }
    const gunI = this.s.gunVisualIndexForSlot(slot);
    const tip = this.s.gunTip(gunI);
    return { x: tip.x, y: tip.y, z };
  }

  rangeOf(spec: PlayerWpnSpec, slot = this.s.player.weapon): number {
    const sockRange = this.s.player.spec.sockets[slot]?.range;
    if (sockRange != null && sockRange > 0) return sockRange;
    return spec.launch.mode === "beam" ? spec.launch.range : 155;
  }

  /** Keep a Tesla seek/head point inside the coil envelope. */
  clampReach(
    from: { x: number; y: number; z: number },
    to: { x: number; y: number; z: number },
    range: number
  ): { x: number; y: number; z: number } {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const d = Math.hypot(dx, dy, dz);
    if (d <= range || d < 1e-4) return { x: to.x, y: to.y, z: to.z };
    const k = range / d;
    return { x: from.x + dx * k, y: from.y + dy * k, z: from.z + dz * k };
  }

  /** Closest living unit to the pointer. Pass `range` to ignore anything beyond the coil envelope. */
  pickTarget(
    tip: { x: number; y: number; z?: number },
    ptr: { x: number; y: number },
    range = Infinity,
    mouseR = 210
  ): Unit | undefined {
    let best: Unit | undefined;
    let bestD = mouseR;
    const tipZ = tip.z ?? 0;
    const limited = Number.isFinite(range);
    for (const u of this.s.units) {
      if (u.dead) continue;
      const uz = u.z + heightOf(u.kind) * 0.45;
      if (limited && Math.hypot(u.x - tip.x, u.y - tip.y, uz - tipZ) > range) continue;
      const dPtr = Math.hypot(u.x - ptr.x, u.y - ptr.y);
      if (dPtr < bestD) {
        bestD = dPtr;
        best = u;
      }
    }
    return best;
  }

  /** Tesla coil: lock nearest-to-mouse; a pointer head races from the muzzle to the seek. */
  updateArc(
    slot: number,
    spec: PlayerWpnSpec,
    ptr: { x: number; y: number },
    spend: boolean,
    dt: number
  ): void {
    const tip = this.muzzleOrigin(slot);
    const range = this.rangeOf(spec, slot);
    this.animT += dt;
    let best: Unit | undefined;
    if (this.lockId != null) {
      const held = this.s.unitSim.unitById(this.lockId);
      if (held && !held.dead) {
        const hz = held.z + heightOf(held.kind) * 0.45;
        if (Math.hypot(held.x - tip.x, held.y - tip.y, hz - tip.z) <= range) best = held;
      }
    }
    if (!best) best = this.pickTarget(tip, ptr, range);
    this.lockId = best?.id;
    let seek = best
      ? { x: best.x, y: best.y, z: best.z + heightOf(best.kind) * 0.45 }
      : { x: ptr.x, y: ptr.y, z: groundZ(this.s.world, ptr.x, ptr.y) + 8 };
    seek = this.clampReach(tip, seek, range);
    if (!this.head) this.head = { x: tip.x, y: tip.y, z: tip.z };
    const head = this.head;
    const hdx = seek.x - head.x;
    const hdy = seek.y - head.y;
    const hdz = seek.z - head.z;
    const hDist = Math.hypot(hdx, hdy, hdz);
    const step = TESLA_HEAD_SPEED * dt;
    if (hDist <= step || hDist < 0.5) {
      head.x = seek.x;
      head.y = seek.y;
      head.z = seek.z;
    } else {
      const inv = step / hDist;
      head.x += hdx * inv;
      head.y += hdy * inv;
      head.z += hdz * inv;
    }
    const capped = this.clampReach(tip, head, range);
    head.x = capped.x;
    head.y = capped.y;
    head.z = capped.z;
    this.live = {
      ox: tip.x,
      oy: tip.y,
      oz: tip.z,
      tx: seek.x,
      ty: seek.y,
      tz: seek.z,
      hx: head.x,
      hy: head.y,
      hz: head.z,
      targetId: best?.id,
    };
    const onTarget =
      !!best && Math.hypot(head.x - seek.x, head.y - seek.y, head.z - seek.z) <= TESLA_LOCK_REACH;
    if (onTarget && best) {
      if (best.id !== this.exposeId) {
        this.exposeId = best.id;
        this.exposeT = 0;
      }
      this.exposeT += dt;
      if (spend) this.s.projectiles.hurt(best, spec.dmg, false);
      if (launchIsArcBeam(spec.launch) && spec.payload.stun) {
        const linger = Math.min(
          TESLA_STUN_MAX,
          spec.payload.stun + this.exposeT * TESLA_STUN_EXPOSE_MUL
        );
        stunUnit(best, linger);
      }
    } else {
      this.exposeT = 0;
      this.exposeId = undefined;
    }
    if (spend) {
      this.spawnZap(head.x, head.y, head.z, onTarget ? 1.22 : 0.78);
      if (onTarget) this.spawnZap(head.x, head.y, head.z, 1.05);
      this.emitSparks(tip.x, tip.y, tip.z, 4, 0.42);
      this.emitSparks(head.x, head.y, head.z, onTarget ? 14 : 7, onTarget ? 0.95 : 0.62);
    }
  }

  hideVisuals(): void {
    for (const im of this.segPool) im.setVisible(false);
    for (const im of this.glowPool) im.setVisible(false);
    for (const im of this.headZapPool) im.setVisible(false);
  }

  drawArcs(): void {
    const g = this.gfx;
    g.clear();
    const live = this.live;
    if (!live || this.s.player.phase === "dead") {
      this.hideVisuals();
      return;
    }
    const dx = live.hx - live.ox;
    const dy = live.hy - live.oy;
    const dz = live.hz - live.oz;
    const len = Math.hypot(dx, dy, dz) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const uz = dz / len;
    let px = -uy;
    let py = ux;
    let pz = 0;
    let plen = Math.hypot(px, py, pz);
    if (plen < 1e-3) {
      px = 0;
      py = -uz;
      pz = uy;
      plen = Math.hypot(px, py, pz) || 1;
    }
    px /= plen;
    py /= plen;
    pz /= plen;
    const bx = uy * pz - uz * py;
    const by = uz * px - ux * pz;
    const bz = ux * py - uy * px;
    const sag = Math.min(22, len * 0.1);
    const radius = Math.min(11, 4.2 + len * 0.015);
    const tSec = this.animT;
    const flicker = (this.animT / 0.028) | 0;
    const hash = (n: number) => {
      const x = Math.sin(n * 127.1 + flicker * 311.7) * 43758.5453;
      return x - Math.floor(x);
    };
    const segs = Math.max(10, Math.min(TESLA_SEGS, Math.round(len / 18)));
    let segUsed = 0;
    for (let s = 0; s < TESLA_STREAMS; s++) {
      const phase = (s * Math.PI * 2) / TESLA_STREAMS;
      const turns = 1.12 + s * 0.16;
      const spin = tSec * (6.2 + s * 1.4);
      const pts: { x: number; y: number; z: number; wy: number; sc: number }[] = [];
      for (let i = 0; i <= segs; i++) {
        const u = i / segs;
        const env = Math.sin(u * Math.PI);
        const ang = u * turns * Math.PI * 2 + phase + spin;
        const cs = Math.cos(ang);
        const sn = Math.sin(ang);
        const hx = (px * cs + bx * sn) * radius * env;
        const hy = (py * cs + by * sn) * radius * env;
        const hz = (pz * cs + bz * sn) * radius * env;
        const wx = live.ox + dx * u + hx;
        const wy = live.oy + dy * u + hy;
        const wz = live.oz + dz * u + hz - env * sag;
        const scr = worldToScreen(wx, wy, wz);
        pts.push({ x: scr.x, y: scr.y, z: wz, wy, sc: scr.scale });
      }
      const stroke = (width: number, color: number, alpha: number) => {
        g.lineStyle(width, color, alpha);
        g.beginPath();
        g.moveTo(pts[0]!.x, pts[0]!.y);
        for (let i = 1; i < pts.length; i++) g.lineTo(pts[i]!.x, pts[i]!.y);
        g.strokePath();
      };
      stroke(3.1, 0x1a66ff, 0.12);
      stroke(1.45, 0x3ad0ff, 0.34);
      stroke(0.65, 0xe8ffff, 0.9);
      const strokeForkSeg = (x0: number, y0: number, x1: number, y1: number, w: number) => {
        if (w < 0.1) return;
        g.lineStyle(3.1 * w, 0x1a66ff, 0.1);
        g.beginPath();
        g.moveTo(x0, y0);
        g.lineTo(x1, y1);
        g.strokePath();
        g.lineStyle(1.35 * w, 0x3ad0ff, 0.3);
        g.beginPath();
        g.moveTo(x0, y0);
        g.lineTo(x1, y1);
        g.strokePath();
        g.lineStyle(0.52 * w, 0xe8ffff, 0.86);
        g.beginPath();
        g.moveTo(x0, y0);
        g.lineTo(x1, y1);
        g.strokePath();
      };
      type Twig = {
        x: number;
        y: number;
        ang: number;
        step: number;
        left: number;
        w: number;
        gen: number;
        salt: number;
      };
      const twigs: Twig[] = [];
      const roots = 2 + (hash(s * 31) > 0.42 ? 1 : 0) + (hash(s * 59) > 0.72 ? 1 : 0);
      for (let f = 0; f < roots; f++) {
        const idx = Math.max(2, Math.min(segs - 2, 2 + ((hash(s * 13 + f * 17) * (segs - 4)) | 0)));
        const p = pts[idx]!;
        const nxt = pts[idx + 1] ?? p;
        const tang = Math.atan2(nxt.y - p.y, nxt.x - p.x);
        const side = hash(s * 41 + f * 9) > 0.5 ? 1 : -1;
        const spanU = hash(s * 7 + f * 11);
        const span = spanU * spanU;
        const fat = hash(f * 5 + s) > 0.58;
        twigs.push({
          x: p.x,
          y: p.y,
          ang: tang + side * (0.35 + hash(f * 21 + s) * 1.25),
          step: 2.2 + span * 22,
          left: 2 + ((span * 18) | 0),
          w: fat ? 0.82 + hash(f * 19 + s * 3) * 0.28 : 0.14 + hash(f * 5 + s) * 0.42,
          gen: 0,
          salt: f * 47 + s * 13,
        });
      }
      for (let t = 0; t < twigs.length && t < 22; t++) {
        const tw = twigs[t]!;
        let x = tw.x;
        let y = tw.y;
        let ang = tw.ang;
        let step = tw.step;
        let w = tw.w;
        const decayW = tw.w > 0.7 ? 0.84 : 0.74;
        const decayStep = tw.left > 10 ? 0.92 : 0.86;
        for (let k = 0; k < tw.left; k++) {
          ang += (hash(tw.salt + k * 19 + flicker) - 0.5) * (0.48 + tw.gen * 0.22);
          const nx = x + Math.cos(ang) * step;
          const ny = y + Math.sin(ang) * step;
          strokeForkSeg(x, y, nx, ny, w);
          if (
            twigs.length < 22 &&
            tw.gen < 2 &&
            k >= 1 &&
            k < tw.left - 1 &&
            hash(tw.salt * 3 + k * 11 + s) > 0.5
          ) {
            const side = hash(tw.salt + k * 23) > 0.5 ? 1 : -1;
            const childSpan = hash(k * 31 + tw.salt);
            twigs.push({
              x,
              y,
              ang: ang + side * (0.45 + hash(k * 17 + tw.salt) * 1.05),
              step: step * (0.35 + childSpan * 0.85),
              left: Math.max(2, ((tw.left - k) * (0.25 + childSpan * 0.7)) | 0),
              w: w * (0.32 + hash(k + tw.salt) * 0.55),
              gen: tw.gen + 1,
              salt: tw.salt + 91 + k * 8,
            });
          }
          x = nx;
          y = ny;
          w *= decayW;
          step *= decayStep;
        }
      }
      for (let i = 1; i < pts.length; i++) {
        const im = this.segPool[segUsed++];
        if (!im) continue;
        const pa = pts[i - 1]!;
        const pb = pts[i]!;
        const sl = Math.hypot(pb.x - pa.x, pb.y - pa.y) || 1;
        const sc = (pa.sc + pb.sc) * 0.5;
        const flick = 0.5 + hash(s * 19 + i * 7) * 0.45;
        im.setTexture("fx_zap", (flicker + s * 3 + i) & 3)
          .setVisible(true)
          .setPosition((pa.x + pb.x) * 0.5, (pa.y + pb.y) * 0.5)
          .setRotation(Math.atan2(pb.y - pa.y, pb.x - pa.x))
          .setScale(
            (sl / FX_SHEET_SIZE.zap) * (0.8 + hash(i + s) * 0.28),
            teslaZapScale(0.2) * sc * (0.8 + hash(i * 5) * 0.3)
          )
          .setAlpha(0.52 * flick)
          .setDepth(worldDepth((pa.z + pb.z) * 0.5, ZOff.muzzle + 0.4, (pa.wy + pb.wy) * 0.5));
      }
    }
    for (let i = segUsed; i < this.segPool.length; i++) {
      this.segPool[i]!.setVisible(false);
    }

    const pulse = 0.9 + Math.sin(tSec * 17.5) * 0.1;
    const stampEnd = (wx: number, wy: number, wz: number, gi: number, mul: number) => {
      const scr = worldToScreen(wx, wy, wz);
      const sx = scr.x;
      const sy = scr.y;
      const sc = scr.scale * mul;
      const depth = worldDepth(wz, ZOff.muzzle + 0.55, wy);
      const layers: { im: Phaser.GameObjects.Image; scale: number; alpha: number }[] = [
        { im: this.glowPool[gi]!, scale: 1.95 * sc * pulse, alpha: 0.32 },
        { im: this.glowPool[gi + 1]!, scale: 0.72 * sc * pulse, alpha: 0.48 },
        { im: this.glowPool[gi + 2]!, scale: 1.08 * sc, alpha: 0.18 },
      ];
      for (const layer of layers) {
        layer.im
          .setVisible(true)
          .setPosition(sx, sy)
          .setRotation(0)
          .setScale(layer.scale)
          .setAlpha(layer.alpha)
          .setDepth(depth);
      }
    };
    stampEnd(live.ox, live.oy, live.oz, 0, 1.15);
    stampEnd(live.hx, live.hy, live.hz, 3, 1.55);
    for (const im of this.headZapPool) im.setVisible(false);

    g.setDepth(
      Math.max(
        worldDepth(live.oz, ZOff.muzzle + 0.5, live.oy),
        worldDepth(live.hz, ZOff.muzzle + 0.5, live.hy)
      )
    );
  }

  emitSparks(x: number, y: number, z: number, n: number, scaleMul: number): void {
    this.s.emitVisualBurst(
      x,
      y,
      z,
      {
        n,
        spdMin: 980,
        spdMax: 1780,
        bx: 0,
        by: 0,
        bz: 1,
        tight: 0,
        scaleMul,
        stretchMul: 1.42,
      },
      this.s.teslaSparkBurst
    );
  }

  spawnZap(x: number, y: number, z: number, scaleMul = 1, lifeMul = 1): void {
    let im = this.zapPool.find((spr) => !spr.visible);
    if (!im) {
      im = this.s.add.image(0, 0, "fx_zap", 0).setVisible(false).setBlendMode(Phaser.BlendModes.ADD);
      this.zapPool.push(im);
    }
    const scr = worldToScreen(x, y, z);
    const frame = (Math.random() * 4) | 0;
    const u = Math.random();
    const size = teslaZapScale(3.4) * scaleMul * (0.16 + u * u * 0.84) * scr.scale;
    const life = (0.07 + Math.random() * 0.09) * lifeMul;
    im.setTexture("fx_zap", frame)
      .setVisible(true)
      .setPosition(scr.x, scr.y)
      .setRotation(Math.random() * Math.PI * 2)
      .setScale(size)
      .setAlpha(0.95)
      .setDepth(worldDepth(z, ZOff.muzzle, y));
    this.zaps.push({ im, t: life, max: life });
  }

  tickZaps(dt: number): void {
    let w = 0;
    for (let i = 0; i < this.zaps.length; i++) {
      const z = this.zaps[i]!;
      z.t -= dt;
      if (z.t <= 0) {
        z.im.setVisible(false);
        continue;
      }
      z.im.setAlpha(Phaser.Math.Clamp(z.t / z.max, 0, 1));
      this.zaps[w++] = z;
    }
    this.zaps.length = w;
  }
}
