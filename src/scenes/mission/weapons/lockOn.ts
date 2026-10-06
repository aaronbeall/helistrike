import { radius, heightOf, guidanceUsesLock, guidanceIsLockOn, launchIsArcBeam, heatClassScore, heatClassCategory, type Unit, type Shot, type PlayerWpnSpec, type LockAcquire } from "../../../sim/combat";
import { zScale, groundZ, worldToScreen } from "../../../worldgen/world";
import Phaser from "phaser";
import { shotFacesHeading } from "../../../render/spritePose";
import { targetingMode, heatCategoryOk, heatClassOf, heatSeekScore } from "../../../sim/weaponRuntime";
import { Layer, worldDepth } from "../../../render/depth";
import type { MissionScene } from "../../missionScene";
import { hostileUnit } from "../../../sim/targetRules";
import { fillCircleFast, strokeCircleFast } from "../../../render/fastShapes";
import { setTextColor } from "../../../render/textStyle";

export function boxHalf(u: Unit, scale: number): number {
  return (radius(u.kind) + 10) * scale * zScale(u.z, u.y);
}

/** Player weapon locks: reticle / signature / NLOS / GPS / Tesla lock state, plus all lock drawing. */
export class LockOn {
  gfx!: Phaser.GameObjects.Graphics;
  txt!: Phaser.GameObjects.Text;
  inbdTxt!: Phaser.GameObjects.Text;
  /** Pooled range labels for in-flight GPS / waypoint aim marks. */
  gpsDistTxt: Phaser.GameObjects.Text[] = [];
  arrowGfx!: Phaser.GameObjects.Graphics;
  hudTxt!: Phaser.GameObjects.Text;
  inbdHudTxt!: Phaser.GameObjects.Text;

  constructor(readonly s: MissionScene) {}

  /** Per-mission state reset (called from the scene's init). */
  reset(): void {
    this.gpsDistTxt = [];
  }

  tick(dt: number, ptr: { x: number; y: number }): void {
    const h = this.s.player;
    if (h.lockTarget && !this.s.unitSim.unitById(h.lockTarget.id)) h.lockTarget = null;
    if (h.lockAcquire && !this.s.unitSim.unitById(h.lockAcquire.id)) h.lockAcquire = null;

    const spec = this.s.fireControl.hudLoadout()[this.s.fireControl.hudWeapon()]!;
    const g = spec.guidance;
    // Pre-fire lock_on only (steer_commit soft-locks in flight).
    if (!g || !guidanceIsLockOn(g)) {
      h.lockTarget = null;
      h.lockAcquire = null;
      return;
    }
    const targeting = g.targeting;

    const cats = targeting.acquire.categories;
    if (cats) {
      if (h.lockTarget) {
        const u = this.s.unitSim.unitById(h.lockTarget.id);
        if (u && !heatCategoryOk(u, cats)) h.lockTarget = null;
      }
      if (h.lockAcquire) {
        const u = this.s.unitSim.unitById(h.lockAcquire.id);
        if (u && !heatCategoryOk(u, cats)) h.lockAcquire = null;
      }
    }

    const lockTime = targeting.lockTime;
    const lockRadius = targeting.lockRadius;
    const tgt =
      targeting.acquire.policy === "signature"
        ? this.signaturePickTarget(ptr.x, ptr.y, lockRadius, targeting.acquire)
        : this.s.fireControl.reticlePickTarget(ptr.x, ptr.y, lockRadius, cats);
    if (!tgt || (h.lockTarget && tgt.id === h.lockTarget.id)) {
      h.lockAcquire = null;
      return;
    }
    if (!h.lockAcquire || h.lockAcquire.id !== tgt.id) {
      h.lockAcquire = { id: tgt.id, t: 0 };
    } else {
      h.lockAcquire.t += dt;
      if (h.lockAcquire.t >= lockTime) {
        h.lockTarget = { id: h.lockAcquire.id };
        h.lockAcquire = null;
      }
    }
  }

  /** Second-click NLOS commit: home to soft-lock or aim point; keep seeker cam through the dive. */
  commitNlosTerminal(s: Shot, ptr: { x: number; y: number }): void {
    if (!s.st || s.st.terminal) return;
    const locked = s.targetId != null ? this.s.unitSim.unitById(s.targetId) : undefined;
    if (locked && !locked.dead) {
      s.targetId = locked.id;
      s.st.gx = undefined;
      s.st.gy = undefined;
    } else {
      s.targetId = undefined;
      s.st.gx = ptr.x;
      s.st.gy = ptr.y;
    }
    s.st.terminal = true;
    s.st.seeking = true;
  }

  signatureLockCandidates(
    x: number,
    y: number,
    max: number,
    acquire: Extract<LockAcquire, { policy: "signature" }>
  ): { u: Unit; score: number; heat: number }[] {
    const h = this.s.player;
    const out: { u: Unit; score: number; heat: number }[] = [];
    const nearby = this.s.spatial.near(x, y, max);
    for (let qi = 0; qi < nearby.n; qi++) {
      const u = nearby.at(qi);
      if (!hostileUnit(u) || u.health < acquire.minHealth) continue;
      if (!heatCategoryOk(u, acquire.categories)) continue;
      const d = Math.hypot(u.x - x, u.y - y);
      if (d > max) continue;
      const aim = Math.atan2(u.y - h.y, u.x - h.x);
      const cat = heatClassCategory(heatClassOf(u));
      const boresight =
        cat === "vehicle" && acquire.vehicleMaxOffBoresight != null
          ? acquire.vehicleMaxOffBoresight
          : acquire.maxOffBoresight;
      if (Math.abs(Phaser.Math.Angle.Wrap(aim - h.angle)) > boresight) continue;
      const cls = heatClassScore(heatClassOf(u));
      const heat = cls + Phaser.Math.Clamp(u.max / 420, 0, 0.85);
      const score = heatSeekScore(u, aim, h.angle) - d * 0.01;
      out.push({ u, score, heat });
    }
    nearby.done();
    return out;
  }

  signaturePickTarget(
    x: number,
    y: number,
    max: number,
    acquire: Extract<LockAcquire, { policy: "signature" }>
  ): Unit | undefined {
    let best: Unit | undefined;
    let bestScore = -Infinity;
    for (const c of this.signatureLockCandidates(x, y, max, acquire)) {
      if (c.score > bestScore) {
        bestScore = c.score;
        best = c.u;
      }
    }
    return best;
  }

  /** Heat-sized pips for signature (Stinger / Sidewinder) lock candidates. */
  drawHeatSeekHud(g: Extract<NonNullable<PlayerWpnSpec["guidance"]>["targeting"], { mode: "lock_on" }>): void {
    if (g.acquire.policy !== "signature") return;
    const gfx = this.gfx;
    const ptr = this.s.worldPointer();
    const lockedId = this.s.player.lockTarget?.id;
    const acqId = this.s.player.lockAcquire?.id;
    for (const { u, heat } of this.signatureLockCandidates(ptr.x, ptr.y, g.lockRadius, g.acquire)) {
      const at = worldToScreen(u.x, u.y, u.z + heightOf(u.kind) * 0.45);
      const r = (4.5 + heat * 4.4) * zScale(u.z, u.y);
      const cls = heatClassOf(u);
      const tone =
        cls === "air" ? 0x7ad8ff : cls === "vehicle" ? 0xffb060 : cls === "building" ? 0xd4a06a : 0xc88858;
      if (u.id === lockedId) {
        gfx.lineStyle(2, 0xff3a22, 0.9);
        strokeCircleFast(gfx, at.x, at.y, r + 3, 2, 0xff3a22, 0.9);
        gfx.fillStyle(0xff3a22, 0.12);
        fillCircleFast(gfx, at.x, at.y, r + 3);
      } else if (u.id === acqId) {
        const t = Math.min(1, (this.s.player.lockAcquire?.t ?? 0) / g.lockTime);
        gfx.lineStyle(1.6, 0xff6622, 0.55 + t * 0.35);
        strokeCircleFast(gfx, at.x, at.y, r + 1, 1.6, 0xff6622, 0.55 + t * 0.35);
        gfx.fillStyle(0xff6622, 0.08 + t * 0.08);
        fillCircleFast(gfx, at.x, at.y, r + 1);
      } else {
        gfx.lineStyle(1.15, tone, 0.42);
        strokeCircleFast(gfx, at.x, at.y, r, 1.15, tone, 0.42);
      }
    }
  }

  drawBox(
    u: Unit,
    scale: number,
    width: number,
    alpha: number,
    color = 0xff3a22
  ): { x: number; y: number; half: number; depth: number } {
    const g = this.gfx;
    const at = worldToScreen(u.x, u.y, u.z);
    const x = at.x;
    const y = at.y;
    const half = boxHalf(u, scale);
    const depth = worldDepth(u.z, 8, u.y);
    g.lineStyle(width, color, alpha);
    g.strokeRect(x - half, y - half, half * 2, half * 2);
    return { x, y, half, depth };
  }

  drawDiamond(
    u: Unit,
    scale: number,
    width: number,
    alpha: number,
    color: number
  ): { x: number; y: number; half: number; depth: number } {
    return this.drawDiamondAt(u.x, u.y, u.z, boxHalf(u, scale), width, alpha, color);
  }

  drawDiamondAt(
    wx: number,
    wy: number,
    wz: number,
    half: number,
    width: number,
    alpha: number,
    color: number,
    dashed = false
  ): { x: number; y: number; half: number; depth: number } {
    const g = this.gfx;
    const at = worldToScreen(wx, wy, wz);
    const x = at.x;
    const y = at.y;
    const depth = worldDepth(wz, 8, wy);
    const pts = [
      { x, y: y - half },
      { x: x + half, y },
      { x, y: y + half },
      { x: x - half, y },
    ];
    g.lineStyle(width, color, alpha);
    if (dashed) {
      const tick = half * 0.42;
      for (let i = 0; i < 4; i++) {
        const a = pts[i]!;
        const prev = pts[(i + 3) % 4]!;
        const next = pts[(i + 1) % 4]!;
        const toPrev = Math.hypot(prev.x - a.x, prev.y - a.y) || 1;
        const toNext = Math.hypot(next.x - a.x, next.y - a.y) || 1;
        g.lineBetween(
          a.x,
          a.y,
          a.x + ((prev.x - a.x) / toPrev) * tick,
          a.y + ((prev.y - a.y) / toPrev) * tick
        );
        g.lineBetween(
          a.x,
          a.y,
          a.x + ((next.x - a.x) / toNext) * tick,
          a.y + ((next.y - a.y) / toNext) * tick
        );
      }
    } else {
      g.beginPath();
      g.moveTo(pts[0]!.x, pts[0]!.y);
      g.lineTo(pts[1]!.x, pts[1]!.y);
      g.lineTo(pts[2]!.x, pts[2]!.y);
      g.lineTo(pts[3]!.x, pts[3]!.y);
      g.closePath();
      g.strokePath();
      const inner = half * 0.62;
      g.lineStyle(Math.max(1, width * 0.7), color, alpha * 0.7);
      g.beginPath();
      g.moveTo(x, y - inner);
      g.lineTo(x + inner, y);
      g.lineTo(x, y + inner);
      g.lineTo(x - inner, y);
      g.closePath();
      g.strokePath();
    }
    return { x, y, half, depth };
  }

  inboundLockTargets(): Unit[] {
    const seen = new Set<number>();
    const out: Unit[] = [];
    for (const s of this.s.shots) {
      if (s.from !== "player" || s.targetId == null) continue;
      const guided =
        shotFacesHeading(s) ||
        (s.beh?.guidance != null && guidanceUsesLock(s.beh.guidance));
      if (!guided) continue;
      if (seen.has(s.targetId)) continue;
      const u = this.s.unitSim.unitById(s.targetId);
      if (!u) continue;
      seen.add(s.targetId);
      out.push(u);
    }
    return out;
  }

  update(): void {
    const h = this.s.player;
    const g = this.gfx;
    g.clear();
    this.arrowGfx.clear();
    this.hudTxt.setVisible(false);
    this.inbdHudTxt.setVisible(false);
    this.txt.setVisible(false);
    this.inbdTxt.setVisible(false);

    const spec = this.s.fireControl.hudLoadout()[this.s.fireControl.hudWeapon()]!;
    if (launchIsArcBeam(spec.launch)) {
      this.updateTesla(spec);
      this.drawGpsWaypointMarks();
      return;
    }
    const wpnGuidance = spec.guidance;
    if (!wpnGuidance || !guidanceUsesLock(wpnGuidance)) {
      if (!this.drawGpsWaypointMarks()) g.setVisible(false);
      return;
    }
    const targeting = wpnGuidance.targeting;

    if (targeting.mode === "steer_commit") {
      this.updateNlos(targeting);
      this.drawGpsWaypointMarks();
      return;
    }

    const lockTime = targeting.lockTime;
    const inbound = this.inboundLockTargets();
    const locked = h.lockTarget ? this.s.unitSim.unitById(h.lockTarget.id) : undefined;
    const seeking = h.lockAcquire ? this.s.unitSim.unitById(h.lockAcquire.id) : undefined;
    const heatSeek =
      targeting.mode === "lock_on" && targeting.acquire.policy === "signature";
    const hud = spec.cam.lockHud;
    const lockColor = hud?.color ?? 0xff3a22;
    const lockTextColor = hud?.textColor ?? "#ff3a22";
    if (!locked && !seeking && inbound.length === 0 && !heatSeek) {
      if (!this.drawGpsWaypointMarks()) g.setVisible(false);
      return;
    }

    g.setVisible(true);
    if (heatSeek && targeting.mode === "lock_on") this.drawHeatSeekHud(targeting);
    let lockDepth: number = Layer.FIELD;
    const inboundIds = new Set(inbound.map((u) => u.id));
    let inbdLabeled = false;

    for (const u of inbound) {
      const vis = this.s.fireControl.unitOnHud(u);
      if (vis.on) {
        const box = this.drawDiamond(u, 1.18, 2.1, 0.92, 0xffb020);
        lockDepth = Math.max(lockDepth, box.depth);
        if (!inbdLabeled) {
          inbdLabeled = true;
          this.inbdTxt
            .setVisible(true)
            .setPosition(box.x, box.y - box.half - 4)
            .setDepth(box.depth)
            .setAlpha(0.95)
            .setScale(zScale(u.z, u.y));
        }
      } else {
        this.drawOffscreen(vis.sx, vis.sy, 0xffb020, this.inbdHudTxt, 0.95);
      }
    }

    if (seeking) {
      const vis = this.s.fireControl.unitOnHud(seeking);
      if (vis.on) {
        const t = Math.min(1, h.lockAcquire!.t / lockTime);
        const scale = 2 - t;
        const box = this.drawBox(seeking, scale, 1.6, 0.72 + t * 0.22, lockColor);
        lockDepth = Math.max(lockDepth, box.depth);
        setTextColor(this.txt, lockTextColor)
          .setVisible(true)
          .setText(hud?.seeking ?? "LOCK")
          .setPosition(box.x, box.y - box.half - 4)
          .setDepth(lockDepth)
          .setAlpha(0.75 + t * 0.25)
          .setScale(zScale(seeking.z, seeking.y));
      } else {
        setTextColor(this.hudTxt.setText(hud?.seeking ?? "LOCK"), lockTextColor);
        this.drawOffscreen(vis.sx, vis.sy, lockColor, this.hudTxt, 0.85);
      }
    }
    if (locked && !inboundIds.has(locked.id)) {
      const vis = this.s.fireControl.unitOnHud(locked);
      const blink = Math.floor(this.s.time.now / 70) % 2 === 0;
      const alpha = blink ? 1 : 0.12;
      if (vis.on) {
        const box = this.drawDiamond(locked, 1, 2.15, alpha, lockColor);
        lockDepth = Math.max(lockDepth, box.depth);
        setTextColor(this.txt, lockTextColor)
          .setVisible(true)
          .setText(hud?.locked ?? "LOCK")
          .setPosition(box.x, box.y - box.half - 4)
          .setDepth(lockDepth)
          .setAlpha(alpha)
          .setScale(zScale(locked.z, locked.y));
      } else {
        setTextColor(this.hudTxt.setText(hud?.locked ?? "LOCK"), lockTextColor);
        this.drawOffscreen(vis.sx, vis.sy, lockColor, this.hudTxt, alpha);
      }
    }
    g.setDepth(lockDepth);
    this.drawGpsWaypointMarks();
  }

  /** Persistent ground circles for in-flight GPS / waypoint munitions. */
  drawGpsWaypointMarks(): boolean {
    const g = this.gfx;
    let any = false;
    let depth = g.depth;
    let labelI = 0;
    for (const s of this.s.shots) {
      if (s.from !== "player" || !s.st || s.st.bomblet) continue;
      if (targetingMode(s.beh?.guidance) !== "waypoint") continue;
      const gx = s.st.gx;
      const gy = s.st.gy;
      if (gx == null || gy == null) continue;
      any = true;
      const gz = groundZ(this.s.world, gx, gy);
      const at = worldToScreen(gx, gy, gz);
      const sc = zScale(gz, gy);
      const r = 9 * sc;
      g.lineStyle(1.35, 0xf0d56a, 0.55);
      strokeCircleFast(g, at.x, at.y, r, 1.35, 0xf0d56a, 0.55);
      g.lineStyle(1, 0xf0d56a, 0.28);
      strokeCircleFast(g, at.x, at.y, r * 1.45, 1, 0xf0d56a, 0.28);
      g.lineStyle(1, 0xf0d56a, 0.38);
      g.lineBetween(at.x - r * 0.42, at.y, at.x + r * 0.42, at.y);
      g.lineBetween(at.x, at.y - r * 0.42, at.x, at.y + r * 0.42);
      const markDepth = worldDepth(gz, 8, gy);
      depth = Math.max(depth, markDepth);
      const dist = Math.hypot(gx - s.x, gy - s.y, gz - s.z);
      const txt = this.acquireGpsDistTxt(labelI++);
      txt
        .setText(`${Math.max(0, Math.round(dist))}m`)
        .setVisible(true)
        .setPosition(at.x, at.y - r * 1.55 - 2)
        .setDepth(markDepth)
        .setScale(sc)
        .setAlpha(0.52);
    }
    for (let i = labelI; i < this.gpsDistTxt.length; i++) {
      const t = this.gpsDistTxt[i];
      if (t?.active) t.setVisible(false);
    }
    if (any) {
      g.setVisible(true);
      g.setDepth(depth);
    }
    return any;
  }

  acquireGpsDistTxt(i: number): Phaser.GameObjects.Text {
    while (this.gpsDistTxt.length <= i) this.gpsDistTxt.push(this.makeGpsDistTxt());
    const existing = this.gpsDistTxt[i];
    // Scene restart destroys old Text objects but the pool array can linger — replace.
    if (!existing || !existing.active || !existing.scene) {
      this.gpsDistTxt[i] = this.makeGpsDistTxt();
    }
    return this.gpsDistTxt[i]!;
  }

  makeGpsDistTxt(): Phaser.GameObjects.Text {
    const t = this.s.add
      .text(0, 0, "", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "11px",
        color: "#f0d56a",
      })
      .setOrigin(0.5, 1)
      .setDepth(Layer.FIELD)
      .setVisible(false)
      .setStroke("#1c100c", 2)
      .setAlpha(0.52);
    this.s.bindFieldHud(t);
    return t;
  }

  /** Instant near-mouse lock diamond for the Tesla coil cannon. */
  updateTesla(spec: PlayerWpnSpec): void {
    const g = this.gfx;
    const tip = this.s.tesla.muzzleOrigin(this.s.player.weapon);
    const range = this.s.tesla.rangeOf(spec);
    const tgt = this.s.tesla.pickTarget(tip, this.s.worldPointer());
    if (!tgt) {
      g.setVisible(false);
      return;
    }
    const uz = tgt.z + heightOf(tgt.kind) * 0.45;
    const inRange = Math.hypot(tgt.x - tip.x, tgt.y - tip.y, uz - tip.z) <= range;
    const color = inRange ? 0x4de8ff : 0xffb020;
    const label = inRange ? "ARC" : "RANGE";
    const vis = this.s.fireControl.unitOnHud(tgt);
    g.setVisible(true);
    if (vis.on) {
      const box = this.drawDiamondAt(
        tgt.x,
        tgt.y,
        tgt.z,
        boxHalf(tgt, 1.12),
        inRange ? 2.05 : 1.7,
        inRange ? 0.95 : 0.82,
        color,
        !inRange
      );
      setTextColor(this.txt, inRange ? "#7af0ff" : "#ffd060")
        .setText(label)
        .setVisible(true)
        .setPosition(box.x, box.y - box.half - 4)
        .setDepth(box.depth)
        .setAlpha(inRange ? 0.95 : 0.88)
        .setScale(zScale(tgt.z, tgt.y));
      g.setDepth(box.depth);
    } else {
      this.drawOffscreen(vis.sx, vis.sy, color, this.hudTxt, inRange ? 0.95 : 0.82);
      setTextColor(this.hudTxt.setText(label), inRange ? "#7af0ff" : "#ffd060");
    }
  }

  /** Spike / NLOS: LOCK diamond only while missile flies + reticle near target; FIRE after commit. */
  updateNlos(
    g: Extract<NonNullable<PlayerWpnSpec["guidance"]>["targeting"], { mode: "steer_commit" }>
  ): void {
    const gfx = this.gfx;
    const wpnId = this.s.loadout[this.s.player.weapon]!.id;
    const shot = this.s.shots.find(
      (s) => s.from === "player" && s.wpnId === wpnId && s.st && !s.st.bomblet
    );
    if (!shot?.st) {
      gfx.setVisible(false);
      return;
    }

    if (shot.st.terminal) {
      const locked = shot.targetId != null ? this.s.unitSim.unitById(shot.targetId) : undefined;
      gfx.setVisible(true);
      let lockDepth: number = Layer.FIELD;
      if (locked && !locked.dead) {
        const vis = this.s.fireControl.unitOnHud(locked);
        if (vis.on) {
          const box = this.drawDiamond(locked, 1.18, 2.1, 0.92, 0xffb020);
          lockDepth = Math.max(lockDepth, box.depth);
          this.inbdTxt
            .setVisible(true)
            .setPosition(box.x, box.y - box.half - 4)
            .setDepth(box.depth)
            .setAlpha(0.95)
            .setScale(zScale(locked.z, locked.y));
        } else {
          this.drawOffscreen(vis.sx, vis.sy, 0xffb020, this.inbdHudTxt, 0.95);
        }
      } else if (shot.st.gx != null && shot.st.gy != null) {
        const gz = groundZ(this.s.world, shot.st.gx, shot.st.gy);
        const half = 28 * zScale(gz, shot.st.gy);
        const box = this.drawDiamondAt(shot.st.gx, shot.st.gy, gz, half, 2.1, 0.92, 0xffb020);
        lockDepth = Math.max(lockDepth, box.depth);
        this.inbdTxt
          .setVisible(true)
          .setPosition(box.x, box.y - box.half - 4)
          .setDepth(box.depth)
          .setAlpha(0.95)
          .setScale(zScale(gz, shot.st.gy));
      } else {
        gfx.setVisible(false);
        return;
      }
      gfx.setDepth(lockDepth);
      return;
    }

    // Under control: LOCK diamond only when soft-locked and reticle still close.
    const locked = shot.targetId != null ? this.s.unitSim.unitById(shot.targetId) : undefined;
    const near =
      !!locked &&
      !locked.dead &&
      Math.hypot(this.s.worldPointer().x - locked.x, this.s.worldPointer().y - locked.y) <=
        (g.breakLockRadius ?? g.lockRadius);
    if (!near || !locked) {
      gfx.setVisible(false);
      return;
    }

    gfx.setVisible(true);
    const blink = Math.floor(this.s.time.now / 70) % 2 === 0;
    const alpha = blink ? 1 : 0.12;
    const vis = this.s.fireControl.unitOnHud(locked);
    if (vis.on) {
      const box = this.drawDiamond(locked, 1, 2.15, alpha, 0xff3a22);
      setTextColor(this.txt, "#ff3a22")
        .setVisible(true)
        .setText("LOCK")
        .setPosition(box.x, box.y - box.half - 4)
        .setDepth(box.depth)
        .setAlpha(alpha)
        .setScale(zScale(locked.z, locked.y));
      gfx.setDepth(box.depth);
    } else {
      this.drawOffscreen(vis.sx, vis.sy, 0xff3a22, this.hudTxt, alpha);
      gfx.setDepth(Layer.FIELD);
    }
  }

  drawOffscreen(
    sx: number,
    sy: number,
    color: number,
    txt: Phaser.GameObjects.Text,
    alpha: number
  ): void {
    const g = this.arrowGfx;
    const w = this.s.scale.width;
    const hgt = this.s.scale.height;
    const pad = 36;
    const look = this.s.camera.camLookWorld();
    const camHud = this.s.worldToHudScreen(look.x, look.y, look.z);
    const ang = Math.atan2(sy - camHud.sy, sx - camHud.sx);
    const ax = Phaser.Math.Clamp(sx, pad, w - pad);
    const ay = Phaser.Math.Clamp(sy, pad, hgt - pad);
    g.fillStyle(color, 0.92 * alpha);
    g.save();
    g.translateCanvas(ax, ay);
    g.rotateCanvas(ang);
    g.fillTriangle(12, 0, -8, -3.6, -8, 3.6);
    g.restore();
    const lx = ax - Math.cos(ang) * 34;
    const ly = ay - Math.sin(ang) * 22;
    const lp = this.s.hudLocal(lx, ly);
    setTextColor(txt, color === 0xffb020 ? "#ffb020" : "#ff3a22").setVisible(true).setPosition(lp.x, lp.y).setAlpha(alpha).setRotation(0);
  }
}
