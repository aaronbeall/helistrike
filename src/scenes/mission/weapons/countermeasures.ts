
import Phaser from "phaser";
import { deadfallShot } from "../../../sim/ballistics";
import { coneDir } from "../../../util/vec";

import { COUNTERMEASURES, craftCountermeasure, stunUnit, type SmokePuff, type Flare } from "../../../sim/combat";
import { ZOff, worldDepth } from "../../../render/depth";
import { range } from "../../../util/rng";
import { isOrganic, specOf } from "../../../sim/roster";
import { setGlitchPipeline } from "../../../render/glitch";
import { setWarpDistortPipeline } from "../../../render/warpDistort";
import { setCloakFxPipeline } from "../../../render/cloakFx";
import { groundZ, worldToScreen, cameraPointVisible } from "../../../worldgen/world";
import type { MissionScene } from "../../missionScene";

/** Time Warp CM: world rate while active. */
export const TIMEWARP_WORLD_SCALE = 0.035;

/** Time Warp CM: player craft motion rate while the world crawls at the warp rate. */
export const TIMEWARP_PLAYER_SCALE = 0.4;

export const REACTIVE_ARMOR_RADIUS_MUL = 1.25;

/** Whitened sheet for vision-blocking chemical clouds (vs graded fx_smoke for dust/trails). */
export function visionSmokeTex(textures: Phaser.Textures.TextureManager): string {
  return textures.exists("fx_smoke_tint") ? "fx_smoke_tint" : "fx_smoke";
}

/** Countermeasures: dispatcher + cooldown; flares, smoke screen + puffs, EMP, phase cloak, reactive armor, Time Warp, bullet time. */
export class Countermeasures {
  gfx!: Phaser.GameObjects.Graphics;
  smokePuffG!: Phaser.GameObjects.Group;
  /** Static glowing lights ringing the hull while reactive armor is active — see syncReactiveArmorGlow. */
  reactiveArmorGlows!: Phaser.GameObjects.Image[];
  cd = 0;
  flares: Flare[] = [];
  /** Time Warp active seconds left (0 = off) — pausable, like bullet time. */
  timewarpT = 0;
  /** Time Warp charge 0..1: drains while on (over `duration`), recharges while off (over `cooldown`). */
  timewarpCharge = 1;
  /** Time Warp screen-edge refraction strength (eases in / out, real time). */
  timewarpFx = 0;
  /** Bullet time (E): toggled slow-mo draining a rechargeable meter (0..1). */
  bulletOn = false;
  bulletMeter = 1;
  cloakT = 0;
  pulseT = 0;
  reactiveArmorT = 0;
  smokeScreenT = 0;
  empGlitchT = 0;
  empGlitchMax = 0;
  empBurstT = 0;
  empBurst: { x: number; y: number; z: number; radius: number } | null = null;
  /**
   * Screen-smoke actors. Game objects (own sprite + overlap), not FX-budget
   * particles — they are never emitBudgeted / frame-capped / recycled mid-life.
   */
  smokePuffs: (SmokePuff & { spr: Phaser.GameObjects.Image })[] = [];
  /** One glowing head sprite per live flare (pooled). */
  private flareHeads: Phaser.GameObjects.Image[] = [];

  constructor(readonly s: MissionScene) {}

  /** Per-mission state reset (called from the scene's init). */
  reset(): void {
    this.flares = [];
    this.flareHeads = [];
    this.cd = 0;
    this.timewarpT = 0;
    this.timewarpCharge = 1;
    this.bulletOn = false;
    this.bulletMeter = 1;
    this.timewarpFx = 0;
    this.cloakT = 0;
    this.pulseT = 0;
    this.reactiveArmorT = 0;
    this.smokeScreenT = 0;
    this.empGlitchT = 0;
    this.empGlitchMax = 0;
    this.empBurstT = 0;
    this.empBurst = null;
    this.smokePuffs = [];
  }

  /**
   * Static (non-blinking) glow lights ringing the hull at radius while reactive armor is
   * active — additive `fx_glow` points, same texture/sizing pattern as the muzzle flash glow.
   * Uses the body's draw pose (tilt-wrap aware) so the ring stays glued to the hull, like the
   * gun mounts, instead of floating in fixed world-axis screen space.
   */
  syncReactiveArmorGlow(): void {
    const glows = this.reactiveArmorGlows;
    if (this.reactiveArmorT <= 0) {
      for (const glow of glows) if (glow.visible) glow.setVisible(false);
      return;
    }
    const h = this.s.player;
    const at = worldToScreen(h.x, h.y, h.z);
    const r = h.spec.radius * at.scale;
    const pose = this.s.hostCraft.bodyDrawPose();
    const depth = this.s.hostCraft.body.depth + 0.05;
    const gSize = 30 * at.scale;
    for (let i = 0; i < glows.length; i++) {
      const ang = pose.rotation + (i / glows.length) * Math.PI * 2;
      glows[i]!
        .setVisible(true)
        .setPosition(pose.x + Math.cos(ang) * r, pose.y + Math.sin(ang) * r)
        .setDisplaySize(gSize, gSize)
        .setAlpha(0.9)
        .setDepth(depth);
    }
  }

  /** One-shot spark burst in 6 evenly-spaced radial directions when reactive armor activates. */
  fireReactiveArmorBurst(): void {
    const h = this.s.player;
    const z0 = h.z + h.height * 0.5;
    const r = h.spec.radius * REACTIVE_ARMOR_RADIUS_MUL;
    const dots = 6;
    for (let i = 0; i < dots; i++) {
      const ang = (i / dots) * Math.PI * 2;
      const cos = Math.cos(ang);
      const sin = Math.sin(ang);
      this.s.fx.emitVisualBurst(
        h.x + cos * r,
        h.y + sin * r,
        z0,
        {
          n: 6,
          spdMin: 220,
          spdMax: 420,
          bx: cos,
          by: sin,
          bz: 0.15,
          tight: 0.92,
          scaleMul: 1.8,
          stretchMul: 1.5,
          gravity: 30,
          depthOff: ZOff.fire + 0.5,
        },
        this.s.fx.reactiveArmorSpark
      );
    }
  }

  /**
   * Cone burst from the hull's near (impact) side when a hit lands while reactive armor is
   * active — same spark palette as the activation burst / hull-ring glows, but a single cone in
   * the direction opposite the hit rather than all 6 directions. `dirX/dirY` is the incoming
   * shot's own travel direction, so the impact point (facing the shooter) sits at
   * `center - dir*radius`, and the burst sprays further outward along `-dir` — the opposite
   * direction of the hit, like the plating deflecting it back.
   */
  fireReactiveArmorImpactBurst(dirX: number, dirY: number): void {
    const len = Math.hypot(dirX, dirY);
    if (len < 1e-6) return;
    const dx = -dirX / len;
    const dy = -dirY / len;
    const h = this.s.player;
    const r = h.spec.radius * REACTIVE_ARMOR_RADIUS_MUL;
    const ox = h.x + dx * r;
    const oy = h.y + dy * r;
    const z0 = h.z + h.height * 0.5;
    this.s.fx.emitVisualBurst(
      ox,
      oy,
      z0,
      {
        n: 10,
        spdMin: 220,
        spdMax: 440,
        bx: dx,
        by: dy,
        bz: 0.12,
        tight: 0.8,
        scaleMul: 1.8,
        stretchMul: 1.5,
        gravity: 30,
        depthOff: ZOff.fire + 0.5,
      },
      this.s.fx.reactiveArmorSpark
    );
  }

  acquireSmokePuffSprite(frame: number): Phaser.GameObjects.Image {
    const key = visionSmokeTex(this.s.textures);
    const idle = (this.smokePuffG.getChildren() as Phaser.GameObjects.Image[]).find(
      (im) => !im.visible && !this.smokePuffs.some((p) => p.spr === im)
    );
    if (idle) {
      idle.setTexture(key, frame);
      return idle;
    }
    const spr = this.s.add.image(0, 0, key, frame).setOrigin(0.5).setVisible(false);
    this.smokePuffG.add(spr);
    return spr;
  }

  spawnSmokePuffs(
    x: number,
    y: number,
    z: number,
    radius: number,
    duration: number,
    /** Individual puff draw/vision radius. Smoke bombs keep the default; CM screen uses smaller. */
    puffR: { min: number; max: number } = { min: 80, max: 118 }
  ): void {
    const n = 36;
    // Cool white/gray chemical cloud (not warm beige dust).
    const tints = [0xf2f2f2, 0xe4e4e4, 0xd6d6d6, 0xc8c8c8];
    const gnd = groundZ(this.s.world, x, y);
    const z0 = Math.max(z, gnd + 10);
    for (let i = 0; i < n; i++) {
      const u = Math.sqrt(Math.random());
      const a = Math.random() * Math.PI * 2;
      const r = u * radius * 0.82;
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r;
      const outA = r < 4 ? Math.random() * Math.PI * 2 : Math.atan2(py - y, px - x) + range(-0.4, 0.4);
      const burst = range(80, 160);
      const frame = i % 4;
      this.smokePuffs.push({
        x: px,
        y: py,
        z: z0 + range(4, 22),
        vx: Math.cos(outA) * burst,
        vy: Math.sin(outA) * burst,
        vz: range(18, 52),
        radius: range(puffR.min, puffR.max),
        t: duration * range(0.88, 1.18),
        max: duration,
        tint: tints[i % tints.length]!,
        spin: range(-0.35, 0.35),
        ang: Math.random() * Math.PI * 2,
        frame,
        spr: this.acquireSmokePuffSprite(frame),
      });
    }
  }

  updateSmokePuffs(dt: number): void {
    let w = 0;
    const puffs = this.smokePuffs;
    const burstDrag = Math.pow(0.08, dt);
    const driftDrag = Math.pow(0.78, dt);
    for (let i = 0; i < puffs.length; i++) {
      const s = puffs[i]!;
      s.t -= dt;
      if (s.t <= 0) {
        s.spr.setVisible(false);
        continue;
      }
      const age = 1 - s.t / s.max;
      const bursting = age < 0.12;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.z += s.vz * dt;
      if (bursting) {
        s.vx *= burstDrag;
        s.vy *= burstDrag;
      } else {
        s.vx *= driftDrag;
        s.vy *= driftDrag;
        s.vx += range(-14, 14) * dt;
        s.vy += range(-14, 14) * dt;
      }
      s.vz *= Math.pow(0.52, dt);
      s.vz += 10 * dt;
      s.ang += s.spin * dt;
      const g = groundZ(this.s.world, s.x, s.y);
      if (s.z < g + 8) {
        s.z = g + 8;
        if (s.vz < 0) s.vz = 0;
      } else if (s.z > g + 72) {
        s.z = g + 72;
        if (s.vz > 0) s.vz *= 0.2;
      }
      puffs[w++] = s;
    }
    puffs.length = w;
    this.syncSmokePuffSprites();
  }

  syncSmokePuffSprites(): void {
    for (const s of this.smokePuffs) {
      const im = s.spr;
      if (!cameraPointVisible(s.z, s.y)) {
        im.setVisible(false);
        continue;
      }
      const lifeT = Phaser.Math.Clamp(s.t / s.max, 0, 1);
      const age = 1 - lifeT;
      // Grow from ~0 to full quickly (~0.12s) — no hard pop at spawn size.
      const bloom = 1 - Math.exp(-age / 0.055);
      const fade = lifeT > 0.4 ? 1 : Math.pow(lifeT / 0.4, 1.25);
      const at = worldToScreen(s.x, s.y, s.z);
      const zs = at.scale;
      const visualR = s.radius * bloom;
      const key = visionSmokeTex(this.s.textures);
      if (im.texture.key !== key || im.frame.name !== String(s.frame)) {
        im.setTexture(key, s.frame);
      }
      im.setVisible(true);
      im.setPosition(at.x, at.y);
      im.setDisplaySize(visualR * 2.8 * zs, visualR * 2.15 * zs);
      im.setRotation(s.ang);
      im.setDepth(worldDepth(s.z, ZOff.smoke, s.y));
      // No heat-fill: that stamps solid cold. 2% alpha keeps a ghost of the puff.
      im.clearTint();
      if (!this.s.thermal.on) im.setTint(s.tint);
      // Dense white/gray chemical screen — higher than dust/exhaust smoke.
      im.setAlpha((this.s.thermal.on ? 0.02 : 0.84) * fade);
    }
  }

  craftCmId() {
    const pov = this.s.remoteFleet.povHudRemote();
    if (pov) return craftCountermeasure(pov.spec.countermeasure);
    return craftCountermeasure(this.s.player.spec.countermeasure);
  }

  trigger(): void {
    if (this.s.player.phase !== "flight" || !this.s.fireControl.canFire || this.s.debugMenu.open || this.s.help.open || this.s.flow.exitOpen) return;
    const pov = this.s.remoteFleet.povHudRemote();
    if (pov) {
      this.s.remoteBody.tryRemoteCountermeasure(pov);
      return;
    }
    const id = this.craftCmId();
    const spec = COUNTERMEASURES[id];
    if (id === "timewarp") {
      // Pausable: toggle off keeps the remaining charge; toggle on resumes from it.
      if (this.timewarpT > 0) this.timewarpT = 0;
      else if (this.timewarpCharge > 0.02) {
        this.timewarpT = this.timewarpCharge * spec.duration;
        this.s.stats.countermeasure(id);
      }
      return;
    }
    if (id === "phase_cloak" && this.cloakT > 0) {
      this.cancelCloak();
      return;
    }
    if (this.cd > 0) return;
    this.s.stats.countermeasure(id);
    if (id === "flares") {
      this.cd = spec.cooldown;
      this.fireFlares(spec.duration);
    } else if (id === "phase_cloak") {
      this.cloakT = spec.duration;
      this.breakEnemyPlayerContact();
    } else if (id === "emp") {
      this.cd = spec.cooldown;
      this.fireEmpCountermeasure();
    } else if (id === "reactive_armor") {
      this.cd = spec.cooldown;
      this.reactiveArmorT = spec.duration;
      this.fireReactiveArmorBurst();
    } else if (id === "smoke_screen") {
      this.cd = spec.cooldown;
      this.smokeScreenT = spec.duration;
      this.fireSmokeScreen();
    }
  }

  /** Real-time Time Warp charge: drains while on, recharges while off; auto-off when empty. */
  tickTimewarpCharge(wallDt: number): void {
    const spec = COUNTERMEASURES.timewarp;
    if (this.timewarpT > 0) {
      this.timewarpCharge = Math.max(0, this.timewarpCharge - wallDt / spec.duration);
      this.timewarpT =
        this.timewarpCharge <= 0 || this.s.player.phase === "dead" ? 0 : this.timewarpCharge * spec.duration;
    } else {
      this.timewarpCharge = Math.min(1, this.timewarpCharge + wallDt / spec.cooldown);
    }
  }

  cancelCloak(): void {
    if (this.cloakT <= 0) return;
    const rem = this.cloakT;
    this.cloakT = 0;
    setCloakFxPipeline(this.s.cameras.main, false);
    this.beginCooldown(rem, COUNTERMEASURES.phase_cloak.duration);
  }

  /** Drop every unit's chase / mood lock so cloak is a true disappear, not "last known". */
  breakEnemyPlayerContact(): void {
    for (const u of this.s.units) {
      if (u.dead) continue;
      u.reacting = false;
      u.aiMood = undefined;
      u.moodT = 0;
      u.aiTx = undefined;
      u.aiTy = undefined;
      if (u.aiState === "CHARGE" || u.aiState === "ORBIT" || u.aiState === "FLEE" || u.aiState === "ENGAGE") {
        u.aiState = "IDLE";
      }
      u.burstLeft = 0;
    }
  }

  /** Warp bomb / linger: edge refraction PostFX — detached when idle (no pass cost). */
  tickWarpDistortFx(): void {
    const cam = this.s.cameras.main;
    let on = this.s.warpLingerScale != null && this.s.camera.povCamLookHold > 0;
    if (!on) {
      for (const s of this.s.shots) {
        if (s.from === "player" && s.warpTimeScale != null) {
          on = true;
          break;
        }
      }
    }
    // Time Warp CM shares the warpwire lens (eased by timewarpFx); strongest source wins.
    const amount = Math.max(on ? 0.92 : 0, this.timewarpFx * 0.92);
    if (amount <= 0.001) {
      setWarpDistortPipeline(cam, false);
      return;
    }
    setWarpDistortPipeline(cam, true, amount);
  }

  /** Host craft whose countermeasure is Time Warp — E drives it too, no separate bullet time. */
  hostHasTimewarp(): boolean {
    return craftCountermeasure(this.s.player.spec.countermeasure) === "timewarp";
  }

  /** Time Warp CM lens strength, eased in / out over ~0.35s real time (drives the warpwire lens). */
  tickTimewarpFx(wallDt: number): void {
    const want = this.timewarpT > 0 ? 1 : 0;
    this.timewarpFx = Phaser.Math.Clamp(
      this.timewarpFx + Math.sign(want - this.timewarpFx) * wallDt * 3,
      Math.min(want, this.timewarpFx),
      Math.max(want, this.timewarpFx)
    );
  }

  /** E: toggle bullet time (needs meter); auto-off when the meter empties. */
  toggleBulletTime(): void {
    if (this.hostHasTimewarp()) {
      this.trigger();
      return;
    }
    if (this.s.relief.open || this.s.debugMenu.open || this.s.help.open || this.s.flow.exitOpen || this.s.over) return;
    if (this.bulletOn) {
      this.bulletOn = false;
      return;
    }
    if (this.s.player.phase === "dead" || this.bulletMeter <= 0.02) return;
    this.bulletOn = true;
  }

  /** Real-time meter: drains while on (full → empty in BULLET_TIME_DURATION), recharges while off. */
  tickBulletTime(wallDt: number): void {
    if (this.bulletOn) {
      this.bulletMeter = Math.max(0, this.bulletMeter - wallDt / BULLET_TIME_DURATION);
      if (this.bulletMeter <= 0 || this.s.player.phase === "dead") this.bulletOn = false;
    } else {
      this.bulletMeter = Math.min(1, this.bulletMeter + wallDt / BULLET_TIME_RECHARGE);
    }
  }

  /** Phase cloak rim shimmer — detached when idle. */
  tickCloakFx(): void {
    const cam = this.s.cameras.main;
    if (this.cloakT <= 0) {
      setCloakFxPipeline(cam, false);
      return;
    }
    // Soft pulse so the effect stays readable without fighting gameplay.
    const pulse = 0.72 + 0.28 * Math.sin(this.s.time.now * 0.006);
    setCloakFxPipeline(cam, true, pulse);
  }

  /** Used effect time becomes cooldown (30% used → 30% of CD; ride it out → full CD). */
  beginCooldown(remaining: number, duration: number): void {
    const spec = COUNTERMEASURES[this.craftCmId()];
    const used = 1 - Phaser.Math.Clamp(remaining / Math.max(0.05, duration), 0, 1);
    this.cd = spec.cooldown * used;
  }

  tick(dt: number, _wallDt: number): void {
    this.cd = Math.max(0, this.cd - dt);
    if (this.cloakT > 0) {
      this.cloakT = Math.max(0, this.cloakT - dt);
      if (this.cloakT <= 0) {
        setCloakFxPipeline(this.s.cameras.main, false);
        this.beginCooldown(0, COUNTERMEASURES.phase_cloak.duration);
      }
    }
    if (this.reactiveArmorT > 0) this.reactiveArmorT = Math.max(0, this.reactiveArmorT - dt);
    if (this.smokeScreenT > 0) {
      this.smokeScreenT = Math.max(0, this.smokeScreenT - dt);
      if (this.s.fx.chance(0.18)) this.fireSmokeScreen(1);
    }
    for (const r of this.s.remotes) {
      if (r.detonate || r.dock) continue;
      if ((r.cmCd ?? 0) > 0) r.cmCd = Math.max(0, (r.cmCd ?? 0) - dt);
      if ((r.smokeT ?? 0) > 0) {
        r.smokeT = Math.max(0, (r.smokeT ?? 0) - dt);
        if (r.smokeT > 0 && this.s.fx.chance(0.18)) this.fireSmokeScreen(1, r);
      }
    }
    if (this.pulseT > 0) this.pulseT = Math.max(0, this.pulseT - dt);
  }

  fireSmokeScreen(bursts = 3, at?: { x: number; y: number; z: number }): void {
    const h = at ?? this.s.player;
    for (let i = 0; i < bursts; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = 12 + Math.random() * 48;
      this.spawnSmokePuffs(
        h.x + Math.cos(a) * d,
        h.y + Math.sin(a) * d,
        h.z - 2,
        42 + Math.random() * 28,
        7 + Math.random() * 3,
        { min: 20, max: 32 }
      );
    }
  }

  fireFlares(duration: number): void {
    const h = this.s.player;
    const ca = Math.cos(h.angle);
    const sa = Math.sin(h.angle);
    const half = (40 * Math.PI) / 180;
    for (let i = 0; i < 12; i++) {
      const side = i < 6 ? -1 : 1;
      const d = coneDir(-sa * side, ca * side, -0.2, half, 3.2);
      const spd = range(150, 280);
      this.flares.push({
        x: h.x,
        y: h.y,
        z: h.z,
        vx: h.vx * 0.35 + d.x * spd,
        vy: h.vy * 0.35 + d.y * spd,
        vz: h.vz * 0.2 + d.z * spd,
        life: duration * (0.88 + Math.random() * 0.22),
        max: duration,
        hist: [],
        histT: 0,
      });
    }
  }

  updateFlares(dt: number): void {
    let w = 0;
    for (let i = 0; i < this.flares.length; i++) {
      const f = this.flares[i]!;
      f.life -= dt;
      if (f.life <= 0) continue;
      f.vx *= Math.pow(0.55, dt);
      f.vy *= Math.pow(0.55, dt);
      f.vz *= Math.pow(0.4, dt);
      f.vz -= 18 * dt;
      const x0 = f.x;
      const y0 = f.y;
      const z0 = f.z;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.z += f.vz * dt;
      // Streak history (drawn, not particles).
      f.histT = (f.histT ?? 0) + dt;
      if (f.histT >= FLARE_HIST_DT) {
        f.histT = 0;
        const hist = (f.hist ??= []);
        hist.push({ x: f.x, y: f.y, z: f.z });
        if (hist.length > FLARE_HIST_N) hist.shift();
      }
      this.emitFlareTrail(f, x0, y0, z0);
      this.flares[w++] = f;
    }
    this.flares.length = w;
  }

  emitFlareTrail(f: Flare, x0: number, y0: number, z0: number): void {
    const t = range(0.2, 0.8);
    const x = x0 + (f.x - x0) * t;
    const y = y0 + (f.y - y0) * t;
    const z = z0 + (f.z - z0) * t;
    if (!cameraPointVisible(z, y)) return;
    const at = worldToScreen(x, y, z);
    const spd = Math.hypot(f.vx, f.vy, f.vz);
    const burn = 0.55 + 0.45 * Phaser.Math.Clamp(f.life / Math.max(0.2, f.max), 0, 1);
    this.s.fx.withTrail(1, () => {
      // Sparse burning drips only — the streak and head sprite carry the look.
      const nTrail = this.s.fx.emitCount((0.7 + Math.min(1.1, spd / 240)) * burn * FLARE_DRIP);
      if (nTrail) {
        this.s.fx.emitBudgeted("fire", this.s.fx.at(z, y, this.s.fx.flareTrail, ZOff.fire), at.x, at.y, nTrail);
      }
      const nCore = this.s.fx.emitCount(0.95 * burn * FLARE_DRIP);
      if (nCore) {
        this.s.fx.emitBudgeted("short", this.s.fx.at(z, y, this.s.fx.flareSpark, ZOff.fire + 0.45), at.x, at.y, nCore);
      }
    });
  }

  closestFlare(x: number, y: number, z: number): Flare | undefined {
    let best: Flare | undefined;
    let bd = 1e9;
    for (const f of this.flares) {
      const d = Math.hypot(f.x - x, f.y - y, f.z - z);
      if (d < bd) {
        bd = d;
        best = f;
      }
    }
    return best;
  }

  fireEmpCountermeasure(): void {
    const h = this.s.player;
    const stun = COUNTERMEASURES.emp.duration;
    const r = this.empScreenRadius();
    this.pulseT = stun;
    for (const u of this.s.units) {
      if (u.dead) continue;
      if (isOrganic(u.kind)) continue;
      if (Math.hypot(u.x - h.x, u.y - h.y) > r) continue;
      // Fried electronics → freefall crash, boom on ground (not a mid-air stun).
      if (specOf(u.kind).empCrashes) {
        this.s.destruction.destroyUnit(u, true, true, false, true);
        this.s.tesla.emitSparks(u.x, u.y, u.z + 4, 5, 0.45);
        continue;
      }
      stunUnit(u, stun);
    }
    for (const s of this.s.shots) {
      if (Math.hypot(s.x - h.x, s.y - h.y) > r) continue;
      deadfallShot(s);
    }
    this.playEmpBurst(h.x, h.y, h.z, r);
  }

  /** World-space radius covering the current camera view (EMP stun envelope). */
  empScreenRadius(): number {
    const view = this.s.cameras.main.worldView;
    return Math.hypot(view.width, view.height) * 0.52;
  }

  playEmpBurst(x: number, y: number, z: number, radius: number): void {
    this.empBurst = { x, y, z, radius };
    this.empBurstT = 0.42;
    this.empGlitchMax = 0.55;
    this.empGlitchT = this.empGlitchMax;
    this.s.projectiles.spawnBlastRing(x, y, z, radius, {
      tint: 0x48d8ff,
      alpha: 0.78,
      duration: 320,
      expand: 3.2,
    });
    const at = worldToScreen(x, y, z);
    this.s.fx.spawnImpactFlash(at.x, at.y, z, 0x88f0ff, radius * 0.62 * at.scale, 0.82, 240);
    this.s.tesla.emitSparks(x, y, z, 18, 1.05);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + range(-0.2, 0.2);
      const r = radius * (0.18 + Math.random() * 0.72);
      this.s.tesla.spawnZap(
        x + Math.cos(a) * r,
        y + Math.sin(a) * r,
        z + range(-18, 28),
        range(0.7, 1.45),
        range(1.4, 2.4)
      );
    }
    this.s.camera.shake = Math.min(8, this.s.camera.shake + 2.1);
    setGlitchPipeline(this.s.cameras.main, true, 1);
  }

  tickEmpFx(dt: number, wallDt: number): void {
    if (this.empBurstT > 0 && this.empBurst) {
      this.empBurstT = Math.max(0, this.empBurstT - dt);
      const burst = this.empBurst;
      const u = 1 - this.empBurstT / 0.42;
      const n = this.s.fx.emitCount(1.35);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = burst.radius * (0.22 + u * 0.85) * range(0.82, 1.08);
        this.s.tesla.spawnZap(
          burst.x + Math.cos(a) * r,
          burst.y + Math.sin(a) * r,
          burst.z + range(-14, 24),
          range(0.55, 1.2),
          range(1.2, 2.1)
        );
      }
      if (this.empBurstT <= 0) this.empBurst = null;
    }
    if (this.empGlitchT <= 0) {
      setGlitchPipeline(this.s.cameras.main, false);
      return;
    }
    this.empGlitchT = Math.max(0, this.empGlitchT - wallDt);
    const amt = Math.pow(this.empGlitchT / Math.max(0.05, this.empGlitchMax), 0.62);
    if (amt <= 0.02) setGlitchPipeline(this.s.cameras.main, false);
    else setGlitchPipeline(this.s.cameras.main, true, amt);
  }

  drawFx(): void {
    this.gfx.clear();
    this.drawFlares();
  }

  /** Flares: tapering white-hot → orange streak through recent positions, plus a flickering glow head. */
  private drawFlares(): void {
    const g = this.gfx;
    let used = 0;
    let zSum = 0;
    const now = this.s.time.now;
    for (let i = 0; i < this.flares.length; i++) {
      const f = this.flares[i]!;
      if (!cameraPointVisible(f.z, f.y)) continue;
      const burn = 0.55 + 0.45 * Phaser.Math.Clamp(f.life / Math.max(0.2, f.max), 0, 1);
      const head = worldToScreen(f.x, f.y, f.z);
      zSum += f.z;
      // Streak: newest segment brightest and widest.
      const hist = f.hist ?? [];
      let px = head.x;
      let py = head.y;
      for (let k = hist.length - 1; k >= 0; k--) {
        const p = hist[k]!;
        const at = worldToScreen(p.x, p.y, p.z);
        const u = (hist.length - 1 - k) / FLARE_HIST_N;
        const fade = (1 - u) * (1 - u) * burn;
        g.lineStyle(Math.max(0.6, (2.6 - 2 * u) * at.scale), u < 0.25 ? 0xfff2c0 : u < 0.55 ? 0xffb347 : 0xff6a1c, 0.85 * fade);
        g.lineBetween(px, py, at.x, at.y);
        px = at.x;
        py = at.y;
      }
      // Head: one glow sprite, flickering.
      let im = this.flareHeads[used];
      if (!im) {
        im = this.s.add.image(0, 0, "fx_glow").setBlendMode(Phaser.BlendModes.ADD).setTint(0xfff0c0);
        this.flareHeads.push(im);
      }
      used++;
      const flicker = 0.75 + 0.25 * Math.sin(now * 0.05 + i * 2.1) * Math.sin(now * 0.031 + i);
      im.setVisible(true)
        .setPosition(head.x, head.y)
        .setScale(FLARE_HEAD_SCALE * head.scale * burn * (0.85 + 0.3 * flicker))
        .setAlpha(0.7 + 0.3 * flicker)
        .setDepth(worldDepth(f.z, ZOff.fire + 0.6, f.y));
    }
    for (let i = used; i < this.flareHeads.length; i++) this.flareHeads[i]!.setVisible(false);
    if (used) g.setDepth(worldDepth(zSum / used, ZOff.fire, this.flares[0]!.y));
  }

  /** Hide flare heads (theater map). */
  hideFlareVisuals(): void {
    for (const im of this.flareHeads) im.setVisible(false);
  }
}

/** Flare streak: history sample interval (s) and length (points). */
const FLARE_HIST_DT = 0.035;
const FLARE_HIST_N = 16;
/** Flare particle rate × (the drawn streak + head replace the dense trail). */
const FLARE_DRIP = 0.2;
/** Flare head glow sprite scale (fx_glow is 96 px). */
const FLARE_HEAD_SCALE = 0.22;

export const BULLET_TIME_SCALE = 0.25;

export const BULLET_TIME_DURATION = 6;

export const BULLET_TIME_RECHARGE = 9;
