import Phaser from "phaser";
import { AI_AIM_NARROW_BASE, AI_AIM_WIDE_MUL } from "../../sim/weaponRuntime";
import { heightOf, PLAYER_WPNS, type Unit } from "../../sim/combat";
import { type RemoteCraft } from "../../sim/remote";
import { aimPrecisionSpread, type StationTraverse } from "../../sim/weaponRuntime";
import { Layer } from "../../render/depth";
import { footprintOf } from "../../render/footprint";
import { craftGunId } from "../../sim/crafts";
import { groundZ, worldToScreen, WORLD } from "../../worldgen/world";
import type { MissionScene } from "../missionScene";

/** Debug world overlays: AI state, escort nav, gun arcs/aim cones, hit + collider shapes, blast radii, height map. */
export class DebugOverlays {
  hitOn = false;
  /** Draw fading rings for explosion damage / heli splash radii. */
  blastOn = false;
  blastRings: { x: number; y: number; z: number; r: number; heliR: number; life: number; max: number }[] = [];
  blastGfx!: Phaser.GameObjects.Graphics;
  showHeightMap = false;
  debugGfx!: Phaser.GameObjects.Graphics;
  aiOn = false;
  aiGfx!: Phaser.GameObjects.Graphics;
  aiLabels: Phaser.GameObjects.Text[] = [];
  /** Debug state labels for ground-escort remotes (HUMVEE-style), pooled like `aiLabels`. */
  escortAiLabels: Phaser.GameObjects.Text[] = [];
  /** Last-frame auto / crew-gun track snapshot for AI debug overlay. */
  autoGunDbg: {
    slot: number;
    barrel: number;
    aim: number;
    want: number | null;
    targetId: number | null;
    /** Acquire / engage radius used by this.s station (world units). */
    range: number;
    /** Gun mount world position — search origin and cone apex are the same real point now. */
    mountX: number;
    mountY: number;
    /** Craft heading used for traverse arc math. */
    heading: number;
    /** Socket traverse (center filled from mount); omit = full circle. */
    traverse?: StationTraverse;
    state: string;
    /** True only while this.s barrel is actually under live automatic AI control this.s frame
     * (not player-manual/spot-owned) — debug overlay only draws the traverse cone when true. */
    auto: boolean;
    /** Current effective jitter full-width (radians) while tracking `targetId` — same aim
     * precision narrowing as enemy/wingman AI, undefined when not actively tracking a target. */
    aimSpreadRad?: number;
  }[] = [];

  constructor(readonly s: MissionScene) {}

  /** Per-mission state reset (called from the scene's init). */
  reset(): void {
    this.hitOn = false;
    this.blastOn = false;
    this.blastRings = [];
    this.showHeightMap = false;
    this.aiOn = false;
    this.autoGunDbg = [];
    this.aiLabels = [];
    this.escortAiLabels = [];
  }

  drawHits(): void {
    this.debugGfx.clear();
    if (!this.hitOn) return;
    /** Altitude sticks only — not a collision volume. */
    const altSticks = (x: number, y: number, hgt: number, z: number) => {
      const gnd = groundZ(this.s.world, x, y);
      const floor = worldToScreen(x, y, gnd, { x: 0, y: 0, scale: 1 });
      const base = worldToScreen(x, y, z, { x: 0, y: 0, scale: 1 });
      const top = worldToScreen(x, y, z + hgt, { x: 0, y: 0, scale: 1 });
      this.debugGfx.lineStyle(1.15, 0xe8e0c8, 0.4);
      this.debugGfx.lineBetween(floor.x, floor.y, top.x, top.y);
      this.debugGfx.lineStyle(2.2, 0xff8a3a, 0.95);
      this.debugGfx.lineBetween(floor.x, floor.y, base.x, base.y);
      this.debugGfx.lineStyle(2, 0x6dbb4a, 0.95);
      this.debugGfx.lineBetween(base.x, base.y, top.x, top.y);
    };
    /** Point collider marker (shots / debris — XY tests are points). */
    const markPoint = (x: number, y: number, z: number) => {
      const at = worldToScreen(x, y, z);
      this.debugGfx.lineStyle(1.5, 0x5ec8ff, 0.95);
      this.debugGfx.lineBetween(at.x - 3, at.y, at.x + 3, at.y);
      this.debugGfx.lineBetween(at.x, at.y - 3, at.x, at.y + 3);
      this.debugGfx.fillStyle(0x5ec8ff, 0.9);
      this.debugGfx.fillCircle(at.x, at.y, 1.25);
    };
    const strokeCircle = (x: number, y: number, z: number, radius: number) => {
      this.debugGfx.beginPath();
      for (let i = 0; i <= 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        const at = worldToScreen(
          x + Math.cos(a) * radius,
          y + Math.sin(a) * radius,
          z
        );
        if (i === 0) this.debugGfx.moveTo(at.x, at.y);
        else this.debugGfx.lineTo(at.x, at.y);
      }
      this.debugGfx.strokePath();
    };
    const strokeUnit = (u: Unit) => {
      const fp = footprintOf(u);
      if (fp.shape === "circle") {
        strokeCircle(fp.x, fp.y, u.z, fp.r);
        return;
      }
      const ca = Math.cos(fp.angle);
      const sa = Math.sin(fp.angle);
      const corners = [
        [fp.halfL, fp.halfW],
        [fp.halfL, -fp.halfW],
        [-fp.halfL, -fp.halfW],
        [-fp.halfL, fp.halfW],
      ] as const;
      this.debugGfx.beginPath();
      corners.forEach(([along, side], i) => {
        const at = worldToScreen(
          fp.x + ca * along - sa * side,
          fp.y + sa * along + ca * side,
          u.z
        );
        if (i === 0) this.debugGfx.moveTo(at.x, at.y);
        else this.debugGfx.lineTo(at.x, at.y);
      });
      this.debugGfx.closePath();
      this.debugGfx.strokePath();
    };

    // Player hull uses the selected craft radius and height.
    const heliR = this.s.player.spec.radius;
    this.debugGfx.lineStyle(1.25, 0x5ec8ff, 0.9);
    strokeCircle(this.s.player.x, this.s.player.y, this.s.player.z, heliR);
    altSticks(this.s.player.x, this.s.player.y, this.s.player.height, this.s.player.z);

    for (const u of this.s.units) {
      if (u.dead) continue;
      strokeUnit(u);
      altSticks(u.x, u.y, heightOf(u.kind), u.z);
    }
    for (const s of this.s.shots) {
      markPoint(s.x, s.y, s.z);
      altSticks(s.x, s.y, 0, s.z);
    }
    for (const f of this.s.debris) {
      if (f.trailOnly) continue;
      markPoint(f.x, f.y, f.z);
      altSticks(f.x, f.y, 0, f.z);
    }
    this.debugGfx.lineStyle(1.15, 0xd8c060, 0.72);
    for (const p of this.s.smokePuffs) {
      if (p.t <= 0) continue;
      strokeCircle(p.x, p.y, p.z, p.radius);
    }
  }

  setBlast(on: boolean): void {
    this.blastOn = on;
    if (!on) {
      this.blastRings = [];
      this.blastGfx.clear();
    }
    this.blastGfx.setVisible(on);
    this.s.debugMenu.sync();
  }

  redrawBlastRings(): void {
    this.blastGfx.clear();
    if (!this.blastOn) return;
    for (const ring of this.blastRings) {
      const a = Phaser.Math.Clamp(ring.life / ring.max, 0, 1);
      const at = worldToScreen(ring.x, ring.y, ring.z);
      const outer = ring.r * at.scale;
      const inner = ring.heliR * at.scale;
      // Outer = unit splash, inner amber = heli splash band.
      this.blastGfx.lineStyle(3, 0xff2a18, 0.45 + a * 0.55);
      this.blastGfx.strokeCircle(at.x, at.y, outer);
      this.blastGfx.lineStyle(2, 0xffc040, 0.35 + a * 0.5);
      this.blastGfx.strokeCircle(at.x, at.y, inner);
      this.blastGfx.fillStyle(0xff2a18, 0.06 + a * 0.08);
      this.blastGfx.fillCircle(at.x, at.y, outer);
      this.blastGfx.lineStyle(1.5, 0xffe8a0, 0.7 * a);
      this.blastGfx.lineBetween(at.x - 6, at.y, at.x + 6, at.y);
      this.blastGfx.lineBetween(at.x, at.y - 6, at.x, at.y + 6);
    }
  }

  tickBlast(dt: number): void {
    if (!this.blastOn) {
      this.blastGfx.clear();
      return;
    }
    if (!this.blastRings.length) {
      this.blastGfx.clear();
      return;
    }
    const keep: typeof this.blastRings = [];
    for (const ring of this.blastRings) {
      ring.life -= dt;
      if (ring.life > 0) keep.push(ring);
    }
    this.blastRings = keep;
    this.redrawBlastRings();
  }

  drawAi(): void {
    this.aiGfx.clear();
    if (!this.aiOn || this.s.mapWorldHidden) {
      for (const t of this.aiLabels) t.setVisible(false);
      for (const t of this.escortAiLabels) t.setVisible(false);
      return;
    }
    const ENEMY = 0xff5a4a;
    const FRIENDLY = 0x5ec8ff;
    const live = this.s.units.filter((u) => !u.dead);
    while (this.aiLabels.length < live.length) {
      const t = this.s.add
        .text(0, 0, "", {
          fontFamily: "Share Tech Mono, monospace",
          fontSize: "11px",
          color: "#ff8a7a",
        })
        .setOrigin(0.5, 1)
        .setDepth(Layer.FIELD + 9)
        .setStroke("#12100c", 3);
      this.aiLabels.push(t);
    }
    for (const t of this.aiLabels) t.setVisible(false);
    live.forEach((u, i) => {
      const scr = worldToScreen(u.x, u.y, u.z);
      const ux = scr.x;
      const uy = scr.y;
      if (u.aiTx != null && u.aiTy != null) {
        const target = worldToScreen(
          u.aiTx,
          u.aiTy,
          groundZ(this.s.world, u.aiTx, u.aiTy)
        );
        this.aiGfx.lineStyle(1.4, ENEMY, 0.85);
        this.aiGfx.lineBetween(ux, uy, target.x, target.y);
        this.aiGfx.fillStyle(ENEMY, 0.95);
        this.aiGfx.fillCircle(target.x, target.y, 3.2);
      }
      // Aim-precision cone: narrows toward the gun target as aimHoldT grows.
      if (u.debugAimSpreadRad != null) {
        const tgt = this.s.targeting.unitCombatFocus(u);
        this.strokeAimCone(u.x, u.y, u.z, tgt.x, tgt.y, tgt.z, u.debugAimSpreadRad, 0xffd23a);
      }
      // Missile lock charge: filling ring around the unit while it holds aim to acquire lock.
      if (u.debugLockT != null) {
        this.aiGfx.lineStyle(2, 0x5ec8ff, 0.9);
        this.aiGfx.beginPath();
        this.aiGfx.arc(ux, uy, 12, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * u.debugLockT, false);
        this.aiGfx.strokePath();
      }
      const label = this.aiLabels[i]!;
      label.setVisible(true);
      label.setColor("#ff8a7a");
      label.setPosition(ux, uy - 18);
      label.setText(u.aiState ?? "—");
    });

    // Automatic gun turret debug — only barrels under live automatic AI control right now
    // (player-manual/spot-owned stations are excluded). Anchored at the real gun mount, the
    // same point both `pickAutoTarget` and `aimInStationArc` actually use. Untraversed mounts
    // (no authored `traverse`, e.g. Wraith's coax) draw as a full 360° wedge instead of a plain
    // circle, so there's exactly one shape here, not two overlapping ones.
    const h = this.s.player;
    for (const dbg of this.stationGunDebugList()) {
      const traverse = dbg.traverse ?? { arc: 360, center: 0 };
      this.strokeAutoGunTraverseArc(dbg.mountX, dbg.mountY, h.z, dbg.range, dbg.heading, traverse, FRIENDLY);
      // Same aim-precision cone as enemy/wingman AI — this.s station's aim narrows the same way.
      if (dbg.aimSpreadRad != null && dbg.targetId != null) {
        const tgt = this.s.units.find((u) => !u.dead && u.id === dbg.targetId);
        if (tgt) this.strokeAimCone(dbg.mountX, dbg.mountY, h.z, tgt.x, tgt.y, tgt.z, dbg.aimSpreadRad, FRIENDLY);
      }
    }

    // HOUND host-escort leash — inner (target) + outer (limit) around the remote.
    for (const r of this.s.remotes) {
      if (r.detonate || r.dock || !r.spec.hostEscort) continue;
      const { innerRadius, outerRadius } = r.spec.hostEscort;
      const scr = worldToScreen(r.x, r.y, r.z);
      const follow = this.s.remoteCore.hostEscortMode === "follow" && this.s.remoteCore.remoteView;
      const innerCol = follow ? 0x5ec8ff : 0x8a8470;
      const outerCol = follow ? 0xff9a3a : 0x8a8470;
      this.aiGfx.lineStyle(1.4, innerCol, follow ? 0.75 : 0.35);
      this.aiGfx.strokeCircle(scr.x, scr.y, innerRadius * scr.scale);
      this.aiGfx.lineStyle(1.6, outerCol, follow ? 0.85 : 0.4);
      this.aiGfx.strokeCircle(scr.x, scr.y, outerRadius * scr.scale);
    }

    // Friendly wingman/HOUND AI gun-aim precision: cone toward their engaged target that narrows.
    for (const r of this.s.remotes) {
      if (r.detonate || r.dock || r.aimHoldT == null || r.aiTargetId == null) continue;
      const gunId = craftGunId(r.spec);
      const spec = gunId ? PLAYER_WPNS[gunId] : undefined;
      if (!spec) continue;
      const tgt = this.s.units.find((u) => !u.dead && u.id === r.aiTargetId);
      if (!tgt) continue;
      const baseJitter = spec.fire?.jitter ?? 0.08;
      const spread = aimPrecisionSpread(r.aimHoldT, AI_AIM_NARROW_BASE, baseJitter * AI_AIM_WIDE_MUL, baseJitter);
      this.strokeAimCone(r.x, r.y, r.z, tgt.x, tgt.y, tgt.z, spread, FRIENDLY);
    }

    this.drawHumveeDebugAi(FRIENDLY);
  }

  /**
   * Ground-escort (HUMVEE-style) debug: current state label, follow inner/outer radii around
   * the host while idle, and the host→target attack-orbit circle while engaged — the same
   * geometry `tickHumveeEscortAi` actually drives movement from, not an approximation.
   */
  drawHumveeDebugAi(color: number): void {
    const escorts = this.s.remotes.filter((r) => !r.detonate && !r.dock && r.spec.orbitEscort);
    while (this.escortAiLabels.length < escorts.length) {
      const t = this.s.add
        .text(0, 0, "", {
          fontFamily: "Share Tech Mono, monospace",
          fontSize: "11px",
          color: "#8ef0c8",
        })
        .setOrigin(0.5, 1)
        .setDepth(Layer.FIELD + 9)
        .setStroke("#12100c", 3);
      this.escortAiLabels.push(t);
    }
    for (const t of this.escortAiLabels) t.setVisible(false);
    escorts.forEach((r, i) => {
      const host = this.s.remoteAi.wingmanOrbitHost(r);
      const target = r.aiTargetId != null ? this.s.unitSim.unitById(r.aiTargetId) : undefined;
      const scr = worldToScreen(r.x, r.y, r.z);
      const label = this.escortAiLabels[i]!;
      label.setVisible(true);
      label.setPosition(scr.x, scr.y - 18);
      this.aiGfx.lineStyle(1, 0xff9a5a, 0.7);
      this.aiGfx.strokeCircle(scr.x, scr.y, r.spec.radius * scr.scale);

      if (target && !target.dead) {
        label.setText(this.escortNavLabel(r, "ATTACK"));
        const hostTargetDist = Math.hypot(target.x - host.x, target.y - host.y) || 1;
        const bias = Phaser.Math.Clamp(r.spec.attackBias ?? 0.75, 0, 1);
        const centerX = host.x + (target.x - host.x) * bias;
        const centerY = host.y + (target.y - host.y) * bias;
        const centerToTargetDist = hostTargetDist * (1 - bias);
        const standoff = r.spec.attackStandoff ?? 60;
        const desiredR = hostTargetDist * (r.spec.attackOrbitFrac ?? 0.5);
        const orbitR = Math.min(desiredR, Math.max(20, centerToTargetDist - standoff));
        const centerScr = worldToScreen(centerX, centerY, host.z);
        this.aiGfx.lineStyle(1.4, color, 0.8);
        this.aiGfx.strokeCircle(centerScr.x, centerScr.y, orbitR * centerScr.scale);
        const hostScr = worldToScreen(host.x, host.y, host.z);
        this.aiGfx.lineStyle(1, color, 0.4);
        this.aiGfx.lineBetween(hostScr.x, hostScr.y, centerScr.x, centerScr.y);
        this.aiGfx.fillStyle(color, 0.9);
        this.aiGfx.fillCircle(centerScr.x, centerScr.y, 3);
      } else {
        label.setText(this.escortNavLabel(r, "FOLLOW"));
        const innerR = r.spec.followInnerRadius ?? 90;
        const outerR = r.spec.followOuterRadius ?? 220;
        const hostScr = worldToScreen(host.x, host.y, host.z);
        this.aiGfx.lineStyle(1.4, 0x8a8470, 0.4);
        this.aiGfx.strokeCircle(hostScr.x, hostScr.y, innerR * hostScr.scale);
        this.aiGfx.lineStyle(1.6, 0x8a8470, 0.5);
        this.aiGfx.strokeCircle(hostScr.x, hostScr.y, outerR * hostScr.scale);
      }
      this.drawEscortNavDebug(r);
    });
  }

  escortNavLabel(r: RemoteCraft, fallback: string): string {
    const nav = r.nav;
    if (!nav) return fallback;
    const thr = nav.throttle > 0.2 ? "F" : nav.throttle < -0.2 ? "R" : "-";
    const st = nav.steer < 0 ? "L" : nav.steer > 0 ? "R" : "";
    return `${nav.state} ${thr}${st}`;
  }

  /** Movement wants: goal marker, raw vs avoidance heading, lookahead probe. */
  drawEscortNavDebug(r: RemoteCraft): void {
    const nav = r.nav;
    if (!nav) return;
    const from = worldToScreen(r.x, r.y, r.z);
    const len = 46;
    const ray = (ang: number, color: number, alpha: number) => {
      const p = worldToScreen(r.x + Math.cos(ang) * len, r.y + Math.sin(ang) * len, r.z);
      this.aiGfx.lineStyle(1.3, color, alpha);
      this.aiGfx.lineBetween(from.x, from.y, p.x, p.y);
    };
    ray(nav.rawWant, 0xffd23a, 0.7);
    if (Math.abs(Phaser.Math.Angle.Wrap(nav.steerWant - nav.rawWant)) > 0.02) ray(nav.steerWant, 0x5ec8ff, 0.8);
    const goal = worldToScreen(nav.goalX, nav.goalY, r.z);
    this.aiGfx.lineStyle(1, 0xffd23a, 0.55);
    this.aiGfx.strokeCircle(goal.x, goal.y, 5);
    const probe = worldToScreen(nav.probeX, nav.probeY, r.z);
    const hitColor = nav.probeHit ? 0xff5a4a : 0x8a8470;
    this.aiGfx.lineStyle(nav.probeHit ? 1.8 : 1, hitColor, nav.probeHit ? 0.9 : 0.5);
    this.aiGfx.lineBetween(from.x, from.y, probe.x, probe.y);
    this.aiGfx.strokeCircle(probe.x, probe.y, Math.max(3, r.spec.radius * probe.scale));
  }

  /** Barrels currently under live automatic AI control (not player-manual/spot-owned). */
  stationGunDebugList(): DebugOverlays["autoGunDbg"] {
    return this.autoGunDbg.filter((d) => d.auto);
  }

  /** World-projected traverse wedge for AI debug (matches aimInStationArc). */
  strokeAutoGunTraverseArc(
    ox: number,
    oy: number,
    oz: number,
    range: number,
    heading: number,
    traverse: StationTraverse,
    color = 0x5ec8ff
  ): void {
    const center = ((traverse.center ?? 0) * Math.PI) / 180;
    const half = ((traverse.arc * Math.PI) / 180) * 0.5;
    const a0 = heading + center - half;
    const a1 = heading + center + half;
    const steps = Math.max(12, Math.ceil((traverse.arc / 360) * 48));
    const rim: { x: number; y: number }[] = [];
    // `a` is already within [a0, a1] by construction — re-validating it through
    // aimInStationArc's own wrap/subtract-heading round trip only reintroduces the
    // floating-point noise it's built from, which made the edge rays flicker between
    // two adjacent samples as heading changed. Just use the interpolated angle directly.
    for (let i = 0; i <= steps; i++) {
      const a = a0 + ((a1 - a0) * i) / steps;
      const p = worldToScreen(ox + Math.cos(a) * range, oy + Math.sin(a) * range, oz);
      rim.push({ x: p.x, y: p.y });
    }
    if (rim.length < 2) return;
    const origin = worldToScreen(ox, oy, oz);
    this.aiGfx.lineStyle(1.4, color, 0.75);
    this.aiGfx.beginPath();
    this.aiGfx.moveTo(origin.x, origin.y);
    for (const p of rim) this.aiGfx.lineTo(p.x, p.y);
    this.aiGfx.lineTo(origin.x, origin.y);
    this.aiGfx.strokePath();
  }

  /**
   * Debug: simple outlined cone (no fill) from a shooter toward its target, spread ± `spreadRad`/2
   * wide — narrows visually as aim precision improves. Also marks the target with a small ring
   * and a line back to the shooter, so the cone reads clearly even at a glance.
   */
  strokeAimCone(
    ox: number,
    oy: number,
    oz: number,
    tx: number,
    ty: number,
    tz: number,
    spreadRad: number,
    color: number
  ): void {
    const aim = Math.atan2(ty - oy, tx - ox);
    const range = Math.hypot(tx - ox, ty - oy) || 1;
    const half = spreadRad * 0.5;
    const steps = 8;
    const rim: { x: number; y: number }[] = [];
    for (let i = 0; i <= steps; i++) {
      const a = aim - half + (spreadRad * i) / steps;
      const p = worldToScreen(ox + Math.cos(a) * range, oy + Math.sin(a) * range, oz);
      rim.push({ x: p.x, y: p.y });
    }
    const origin = worldToScreen(ox, oy, oz);
    this.aiGfx.lineStyle(1.3, color, 0.75);
    this.aiGfx.beginPath();
    this.aiGfx.moveTo(origin.x, origin.y);
    for (const p of rim) this.aiGfx.lineTo(p.x, p.y);
    this.aiGfx.lineTo(origin.x, origin.y);
    this.aiGfx.strokePath();
    const tScr = worldToScreen(tx, ty, tz);
    this.aiGfx.lineStyle(1, color, 0.5);
    this.aiGfx.lineBetween(origin.x, origin.y, tScr.x, tScr.y);
  }

  setAi(on: boolean): void {
    this.aiOn = on;
    if (!on) {
      this.aiGfx.clear();
      for (const t of this.aiLabels) t.setVisible(false);
    }
    this.s.debugMenu.sync();
  }

  toggleHeightMap(): void {
    this.showHeightMap = !this.showHeightMap;
    this.hitOn = this.showHeightMap;
    this.debugGfx.setVisible(this.hitOn);
    if (!this.hitOn) this.debugGfx.clear();
    const key = this.showHeightMap ? "map_height" : "map_terrain";
    this.s.ground.setTexture(key).setDisplaySize(WORLD, WORLD);
    this.s.ground.setVisible(!this.s.terrainMesh);
    this.s.minimap.terrain.setTexture(key);
    if (this.s.terrain25d) {
      this.s.terrain25d
        .setTerrainTexture(key)
        .setDecalTexture(this.showHeightMap ? null : this.s.wreckLayer);
    } else {
      this.s.wreckLayer.setVisible(!this.showHeightMap);
    }
    this.s.flatWreckage.setVisible(!!this.s.terrain25d && !this.s.terrainMesh && !this.showHeightMap);
    this.s.minimap.wrecks.setVisible(!this.showHeightMap && this.s.minimap.terrain.visible);
    this.s.debugMenu.sync();
  }
}
