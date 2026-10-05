import Phaser from "phaser";
import { ageEnergyTrail } from "../../../render/ribbons";
import { smoothPolylineInto, biasedDir } from "../../../util/vec";
import { shotTailWorldPos, shotIsGunOrBeam } from "../../../render/spritePose";
import { shotTrailScale, troopMissileTrail } from "../../../render/fxScale";
import { SHOT_TAIL, guidanceIsLockOn, exhaustIsEnergy, exhaustIsGunSpark, exhaustHue, exhaustIsSignalFlare, ENERGY_TRAIL_NODE_LIFE, type Shot, type EnergyTrailNode } from "../../../sim/combat";
import { ZOff, worldDepth } from "../../../render/depth";
import { range } from "../../../util/rng";
import { randomInFootprint, type Footprint } from "../../../render/footprint";
import { worldToScreen, cameraPointVisible, screenVelX, screenVelY, projectHeading } from "../../../worldgen/world";
import type { MissionScene } from "../../missionScene";
import { flameDensityMul } from "../../../render/fxCurves";
import { lineQuadFast } from "../../../render/fastShapes";

/** Missile exhaust spawn disc radius (screen px) per unit of trail scale. */
const EXHAUST_AREA = 4.5;

/** Ribbon layers per hue: width multiplier, color, alpha (outer glow → core). */
type RibbonLayer = readonly [base: number, color: number, alpha: number];
const CYAN_LAYERS: readonly RibbonLayer[] = [[3.6, 0x1a58ff, 0.2], [1.7, 0x3ad8ff, 0.48], [0.85, 0xffffff, 0.92]];
const GREEN_LAYERS: readonly RibbonLayer[] = [[3.1, 0x1a6a22, 0.22], [1.55, 0x55ee44, 0.52], [0.72, 0xeaffc8, 0.95]];
const MAGENTA_LAYERS: readonly RibbonLayer[] = [[3.6, 0x6a18ff, 0.22], [1.7, 0xc86cff, 0.52], [0.85, 0xf8e8ff, 0.95]];
/** Max smoothing samples per ribbon segment, and the on-screen length (px) that earns each one. */
const RIBBON_SMOOTH = 4;
const RIBBON_SUBSEG_PX = 6;
/** Ribbon layer alpha resolution (style changes) and the linger below which nothing shows. */
const RIBBON_ALPHA_STEPS = 64;
const RIBBON_MIN_ALPHA = 0.02;
const RIBBON_AT = { x: 0, y: 0, scale: 1 };
let ribbonBuf = makeRibbonBuffers(64);

function makeRibbonBuffers(nodes: number) {
  const smooth = (nodes - 1) * RIBBON_SMOOTH + 1;
  return {
    nodes,
    rawX: new Float32Array(nodes),
    rawY: new Float32Array(nodes),
    ages: new Float32Array(nodes),
    sx: new Float32Array(smooth),
    sy: new Float32Array(smooth),
    segThick: new Float32Array(smooth),
    segFade: new Float32Array(smooth),
  };
}

/** Node age at smoothed sample `si` (of `sn`), interpolated between the `n` trail nodes. */
function ribbonAgeAt(ages: Float32Array, n: number, sn: number, si: number): number {
  const nn = Math.max(1, n - 1);
  const u = Phaser.Math.Clamp((si / Math.max(1, sn - 1)) * nn, 0, nn);
  const i0 = Math.min(n - 1, u | 0);
  const i1 = Math.min(n - 1, i0 + 1);
  const f = u - i0;
  return ages[i0]! * (1 - f) + ages[i1]! * f;
}

/** Shared scratch for ribbon drawing, grown on demand (one ribbon draws at a time). */
function ribbonBuffers(nodes: number): ReturnType<typeof makeRibbonBuffers> {
  if (nodes > ribbonBuf.nodes) ribbonBuf = makeRibbonBuffers(Math.max(nodes, ribbonBuf.nodes * 2));
  return ribbonBuf;
}

/** Trails: shot / warp / flare / blast trails, energy + helix ribbons, tow-wire drawing. */
export class Trails {
  towWireGfx!: Phaser.GameObjects.Graphics;
  energyTrailGfx!: Phaser.GameObjects.Graphics;
  /** Neon ribbons that keep fading after the dart is gone. */
  energyLinger: EnergyTrailNode[][] = [];
  texTrailCache = new Map<string, number>();

  constructor(readonly s: MissionScene) {}

  /** Per-mission state reset (called from the scene's init). */
  reset(): void {
    this.energyLinger = [];
  }

  emitShotTrail(s: Shot, x0: number, y0: number, z0: number): void {
    if (s.deadfall) return;
    const exhaust = s.beh?.exhaust;
    const cyanSpark = exhaustIsGunSpark(exhaust);
    if (shotIsGunOrBeam(s) && !cyanSpark) return;
    if (exhaustIsEnergy(exhaust) || s.energyTrail || s.energyTrails) return;
    if (!exhaust || exhaust.kind !== "particles") return;
    if ((exhaust.size ?? 1) <= 0) return;
    if (s.motor != null && s.motor < 0) return;
    const small = troopMissileTrail(s);
    const smokeSc = shotTrailScale(s);
    const fireSc =
      (s.scale ?? 1) *
      (exhaust.kind === "particles" ? (exhaust.fireSize ?? exhaust.size ?? 1) : 1);
    const dens = Phaser.Math.Clamp(exhaust.density ?? 1, 0.05, 2.5);
    const t = range(0.2, 0.8);
    const x = x0 + (s.x - x0) * t;
    const y = y0 + (s.y - y0) * t;
    const z = z0 + (s.z - z0) * t;
    if (!cameraPointVisible(z, y)) return;
    const age = s.st?.age ?? 0;
    const fireWanted =
      exhaust.fire != null && (exhaust.fireFor == null || age < exhaust.fireFor);

    // Rail cyan motes — spawn along the bolt; jitter plus a nudge along the shot.
    if (cyanSpark && fireWanted) {
      const at = worldToScreen(x, y, z);
      const ang = projectHeading(s.angle, x, y, z);
      this.s.fx.exhaustVx = Math.cos(ang);
      this.s.fx.exhaustVy = Math.sin(ang);
      const n = this.s.fx.emitCount(1.35 * dens);
      if (n) {
        this.s.fx.withTrail(0.85, () =>
          this.s.fx.emitBudgeted(
            "fire",
            this.s.fx.at(z, y, this.s.fx.railSparkTrail, ZOff.fire + 0.15),
            at.x,
            at.y,
            n
          )
        );
      }
      return;
    }

    const tailUv = exhaust.emitUv ?? SHOT_TAIL;
    const tail = this.s.projectiles.shotUvScreenPos(s, tailUv.x, tailUv.y, x, y, z);
    const tx = tail.x;
    const ty = tail.y;
    const fireEm = !fireWanted
      ? null
      : exhaust.fire === "hotFlame"
        ? this.s.fx.hotFlame
        : exhaust.fire === "burn"
          ? this.s.fx.burn
          : null;
    const smokeEm =
      exhaust.smoke === "short"
        ? this.s.fx.shortTrailSmoke
        : exhaust.smoke === "rocket"
          ? this.s.fx.rocketSmoke
          : exhaust.smoke === "linger"
            ? this.s.fx.lingerSmoke
            : null;
    const emitFireSmoke = (
      fireProto: Phaser.GameObjects.Particles.ParticleEmitter,
      smokeProto: Phaser.GameObjects.Particles.ParticleEmitter,
      nfMul: number,
      nsMul: number
    ) => {
      // Smoke under fire — pairFx pins band depths; emit smoke first.
      const { fire, smoke } = this.s.fx.pair(z, y, fireProto, smokeProto);
      // Flame trails keep their original smoke size (no fire-size match).
      this.s.fx.smokeMatchFire = 0;
      const ns = this.s.fx.emitCount(nsMul * dens);
      const nf = this.s.fx.emitCount(nfMul * dens * flameDensityMul(fireSc));
      // Small spawn discs scaled to the trail: flames start with some width instead of a pinpoint.
      if (ns) {
        this.s.fx.withTrail(smokeSc, () => this.s.fx.emitBudgeted("smoke", smoke, tx, ty, ns, false, EXHAUST_AREA * smokeSc));
      }
      if (nf) {
        this.s.fx.withTrail(fireSc, () => this.s.fx.emitBudgeted("fire", fire, tx, ty, nf, false, EXHAUST_AREA * fireSc));
      }
    };
    if (exhaust.align === "heading") {
      this.s.fx.shotTrailAngle = projectHeading(s.angle, x, y, z);
    }
    if (exhaust.contrail) {
      this.s.fx.withTrail(smokeSc, () => {
        const ang =
          exhaust.align === "heading"
            ? this.s.fx.shotTrailAngle
            : Math.atan2(
                screenVelY(s.vy, s.vz, z, y),
                screenVelX(s.vx, s.vy, s.vz, x, y, z)
              );
        this.s.fx.wingTrailAngle = ang;
        this.s.fx.wingTrailTint = 0xf2f6ff;
        this.s.fx.wingTrailLife = 1200 + dens * 500;
        this.s.fx.wingTrailScaleX = (0.85 + dens * 0.45) * smokeSc * range(1.25, 1.75);
        this.s.fx.wingTrailScaleY = (0.16 + dens * 0.08) * smokeSc;
        this.s.fx.wingTrailVx = Math.cos(ang + Math.PI) * range(6, 16);
        this.s.fx.wingTrailVy = Math.sin(ang + Math.PI) * range(6, 16);
        const nc = this.s.fx.emitCount(0.95 * dens + 0.45);
        if (nc) {
          this.s.fx.emitBudgeted(
            "smoke",
            this.s.fx.at(z, y, this.s.fx.jetWingTrail, ZOff.smoke - 0.15),
            tx,
            ty,
            nc
          );
        }
      });
    }
    if (fireEm && smokeEm && exhaust.fire === "hotFlame" && exhaust.smoke === "short") {
      emitFireSmoke(this.s.fx.hotFlame, this.s.fx.shortTrailSmoke, 0.95, 0.7);
    } else if (small && fireEm && smokeEm) {
      emitFireSmoke(fireEm, smokeEm, 0.4, 0.28);
    } else if (exhaust.smoke === "rocket" && !fireEm) {
      this.s.fx.withTrail(smokeSc, () => {
        const ns = this.s.fx.emitCount(1.35 * dens);
        if (ns) {
          this.s.fx.emitBudgeted(
            "smoke",
            this.s.fx.at(z, y, this.s.fx.rocketSmoke, ZOff.smoke),
            tx,
            ty,
            ns
          );
        }
      });
    } else if (exhaust.smoke === "rocket" && fireEm) {
      emitFireSmoke(fireEm, this.s.fx.rocketSmoke, 0.85, 0.85);
    } else if (fireEm && smokeEm) {
      // Missiles: denser linger plume under the motor flame.
      emitFireSmoke(fireEm, smokeEm, 0.55, 1.05);
    } else if (smokeEm) {
      this.s.fx.withTrail(smokeSc, () => {
        const ns = this.s.fx.emitCount((exhaust.contrail ? 0.55 : 0.85) * dens);
        if (ns) {
          this.s.fx.emitBudgeted(
            "smoke",
            this.s.fx.at(z, y, smokeEm, ZOff.smoke),
            tx,
            ty,
            ns
          );
        }
      });
    } else if (fireEm) {
      this.s.fx.withTrail(fireSc, () => {
        const nf = this.s.fx.emitCount(0.55 * dens);
        if (nf) this.s.fx.emitBudgeted("fire", this.s.fx.at(z, y, fireEm, ZOff.fire), tx, ty, nf);
      });
    }
  }

  /** Magenta mote trail + energy orbs + rearward sparks for the warp bomb. */
  emitWarpTrailFx(s: Shot, x0: number, y0: number, z0: number): void {
    if (s.motor != null && s.motor < 0) return;
    const t = range(0.2, 0.85);
    const x = x0 + (s.x - x0) * t;
    const y = y0 + (s.y - y0) * t;
    const z = z0 + (s.z - z0) * t;
    if (!cameraPointVisible(z, y)) return;
    const at = worldToScreen(x, y, z);
    // Bomb moves on wall-clock during timewarp — keep FX density wall-clock too.
    const wallMul =
      s.warpTimeScale != null && this.s.lastSimScale > 0.001
        ? Math.min(8, 1 / this.s.lastSimScale)
        : 1;
    const spd = Math.hypot(s.vx, s.vy, s.vz);
    const back =
      spd > 8
        ? { x: -s.vx / spd, y: -s.vy / spd, z: -s.vz / spd }
        : { x: -Math.cos(s.angle), y: -Math.sin(s.angle), z: 0 };
    this.s.fx.withTrail(1.2, () => {
      const nTrail = Math.min(4, this.s.fx.emitCount(1.55 * wallMul));
      if (nTrail) {
        this.s.fx.emitBudgeted(
          "short",
          this.s.fx.at(z, y, this.s.fx.warpTrail, ZOff.fire + 0.2),
          at.x,
          at.y,
          nTrail
        );
      }
      const nOrb = Math.min(2, this.s.fx.emitCount(0.7 * wallMul));
      if (nOrb) {
        this.s.fx.emitBudgeted(
          "short",
          this.s.fx.at(z, y, this.s.fx.warpOrb, ZOff.fire + 0.35),
          at.x,
          at.y,
          nOrb
        );
      }
    });
    const nSpark = Math.min(5, this.s.fx.emitCount(1.35 * wallMul));
    if (nSpark) {
      this.s.fx.emitVisualBurst(
        x,
        y,
        z,
        {
          n: nSpark,
          spdMin: 55,
          spdMax: 210,
          bx: back.x,
          by: back.y,
          bz: back.z,
          tight: 0.42,
          scaleMul: 0.95,
          stretchMul: 1.15,
        },
        this.s.fx.warpSparkBurst
      );
    }
  }

  /** Pink/red flame-smoke loft + fast red sparks for the signal-flare gun pellet. */
  emitSignalFlareTrailFx(s: Shot, x0: number, y0: number, z0: number): void {
    const ex = s.beh?.exhaust;
    if (!exhaustIsSignalFlare(ex)) return;
    const dens = Phaser.Math.Clamp(ex.density ?? 1, 0.05, 2);
    const sc = (s.scale ?? 1) * (ex.size ?? 1);
    const t = range(0.15, 0.85);
    const x = x0 + (s.x - x0) * t;
    const y = y0 + (s.y - y0) * t;
    const z = z0 + (s.z - z0) * t;
    if (!cameraPointVisible(z, y)) return;
    const at = worldToScreen(x, y, z);
    this.s.fx.withTrail(sc, () => {
      const nFlame = this.s.fx.emitCount(1.15 * dens);
      if (nFlame) {
        this.s.fx.emitBudgeted(
          "fire",
          this.s.fx.at(z, y, this.s.fx.signalFlareTrail, ZOff.fire + 0.35),
          at.x,
          at.y,
          nFlame
        );
      }
      const nSmoke = this.s.fx.emitCount(0.95 * dens);
      if (nSmoke) {
        this.s.fx.emitBudgeted(
          "smoke",
          this.s.fx.at(z, y, this.s.fx.signalFlareSmoke, ZOff.smoke + 0.1),
          at.x,
          at.y,
          nSmoke
        );
      }
    });
    // Fast red sparks with extra world Y/Z loft so the trail climbs the 2.5D plane.
    const nSpark = this.s.fx.emitCount(1.45 * dens);
    if (nSpark) {
      this.s.fx.emitVisualBurst(
        x,
        y,
        z,
        {
          n: Math.min(6, nSpark),
          spdMin: 180,
          spdMax: 480,
          bx: range(-0.18, 0.18),
          by: -0.72,
          bz: 1.35,
          tight: 0.28,
          scaleMul: 0.7 * sc,
          gravity: 22,
          depthOff: ZOff.fire + 0.9,
        },
        this.s.fx.signalFlareSpark
      );
    }
  }

  drawTowWires(): void {
    const g = this.towWireGfx;
    g.clear();
    if (this.s.player.phase === "dead") return;
    let wireDepth = worldDepth(this.s.player.z, ZOff.shot - 0.8, this.s.player.y);
    for (const s of this.s.shots) {
      if (!s.wire?.length || s.from !== "player") continue;
      const pts = s.wire;
      wireDepth = Math.min(
        wireDepth,
        worldDepth(s.z, ZOff.shot - 0.8, s.y),
        ...pts.map((p) => worldDepth(p.z, ZOff.shot - 0.8, p.y))
      );
      if (pts.length < 2) continue;
      const stroke = (color: number, alpha: number, width: number, dy: number) => {
        g.lineStyle(width, color, alpha);
        const first = worldToScreen(pts[0]!.x, pts[0]!.y, pts[0]!.z);
        g.beginPath();
        g.moveTo(first.x, first.y + dy);
        for (let i = 1; i < pts.length; i++) {
          const p = pts[i]!;
          const at = worldToScreen(p.x, p.y, p.z);
          g.lineTo(at.x, at.y + dy);
        }
        g.strokePath();
      };
      stroke(0x3a382e, 0.55, 1.35, 0);
      stroke(0xe8e0c8, 0.88, 0.85, -0.55);
    }
    g.setDepth(wireDepth);
  }

  simulateEnergyTrail(s: Shot, dt: number): void {
    const trails =
      s.energyTrails ??
      (s.energyTrail ? (s.energyTrails = [s.energyTrail], s.energyTrails) : null);
    if (!trails) {
      if (s.beh && exhaustIsEnergy(s.beh.exhaust)) {
        s.energyTrail = [];
        s.energyTrails = [s.energyTrail];
      } else return;
    }
    const list = s.energyTrails!;
    const spd = Math.hypot(s.vx, s.vy, s.vz);
    const back =
      spd > 8
        ? { x: -s.vx / spd, y: -s.vy / spd, z: -s.vz / spd }
        : { x: -Math.cos(s.angle), y: -Math.sin(s.angle), z: 0 };
    const n = list.length;
    // Multi-ribbon lock-on (Photon): fan relative to bearing-to-target; else shot heading.
    let aimAng = s.angle;
    if (
      n > 1 &&
      s.targetId != null &&
      s.beh?.guidance &&
      guidanceIsLockOn(s.beh.guidance)
    ) {
      const u = this.s.unitSim.unitById(s.targetId);
      if (u && !u.dead) aimAng = Math.atan2(u.y - s.y, u.x - s.x);
    }
    const px = -Math.sin(aimAng);
    const py = Math.cos(aimAng);
    const tail = shotTailWorldPos(this.s.textures, s);
    const hue = exhaustHue(s.beh?.exhaust);
    for (let i = 0; i < n; i++) {
      const trail = list[i]!;
      const rel = n <= 1 ? 0 : i - (n - 1) / 2;
      // Spread ribbons laterally so thick→thin braid reads as three streams, and stagger the
      // outer ones back along the emit axis so they fan out from behind the shot rather than
      // all originating from the same point in a flat perpendicular line.
      const side = rel * 7.5;
      const backOffset = Math.abs(rel) * 5;
      const grow = {
        x: tail.x + px * side + back.x * backOffset,
        y: tail.y + py * side + back.y * backOffset,
        z: tail.z + rel * 2.2 + back.z * backOffset,
      };
      const strength = n <= 1 ? 1 : Phaser.Math.Linear(1.15, 0.42, i / Math.max(1, n - 1));
      ageEnergyTrail(trail, dt, grow, strength, back, ENERGY_TRAIL_NODE_LIFE, hue);
    }
    s.energyTrail = list[0];
  }

  releaseEnergyTrail(s: Shot): void {
    const trails = s.energyTrails ?? (s.energyTrail ? [s.energyTrail] : null);
    if (!trails?.length) return;
    for (const trail of trails) {
      if (!trail.length) continue;
      for (const p of trail) {
        const max = p.max ?? ENERGY_TRAIL_NODE_LIFE;
        p.life = Math.min(max, p.life + 0.12);
      }
      this.energyLinger.push(trail);
    }
    s.energyTrail = undefined;
    s.energyTrails = undefined;
    while (this.energyLinger.length > 28) this.energyLinger.shift();
  }

  /** Free-standing energy ribbon (e.g. a shorting power line) that fades out with the shot trails. */
  lingerEnergy(trail: EnergyTrailNode[]): void {
    this.energyLinger.push(trail);
    while (this.energyLinger.length > 28) this.energyLinger.shift();
  }

  ageEnergyLinger(dt: number): void {
    let w = 0;
    for (const trail of this.energyLinger) {
      ageEnergyTrail(trail, dt);
      if (trail.length >= 2) this.energyLinger[w++] = trail;
    }
    this.energyLinger.length = w;
  }

  drawEnergyRibbon(g: Phaser.GameObjects.Graphics, pts: EnergyTrailNode[], widthMul = 1): number {
    const n = pts.length;
    if (n < 2) return Number.NEGATIVE_INFINITY;
    const buf = ribbonBuffers(n);
    let depth = Number.NEGATIVE_INFINITY;
    let maxLife = 0;
    const hue = pts[0]?.hue ?? "cyan";
    for (let i = 0; i < n; i++) {
      const p = pts[i]!;
      const ref = p.max ?? ENERGY_TRAIL_NODE_LIFE;
      maxLife = Math.max(maxLife, p.life / ref);
      depth = Math.max(depth, worldDepth(p.z, ZOff.shot - 0.6, p.y));
      worldToScreen(p.x, p.y, p.z, RIBBON_AT);
      buf.rawX[i] = RIBBON_AT.x;
      buf.rawY[i] = RIBBON_AT.y;
      buf.ages[i] = Phaser.Math.Clamp(1 - p.life / ref, 0, 1);
    }
    const linger = Phaser.Math.Clamp(maxLife, 0, 1);
    // Faded-out lingering ribbon: every layer is below visible alpha.
    if (linger < RIBBON_MIN_ALPHA) return depth;
    const sn = smoothPolylineInto(buf.rawX, buf.rawY, n, buf.sx, buf.sy, RIBBON_SMOOTH, RIBBON_SUBSEG_PX);
    // Per-segment age (shared by the three layers): node ages interpolated along the smoothed line.
    let prev = ribbonAgeAt(buf.ages, n, sn, 0);
    for (let i = 0; i < sn - 1; i++) {
      const next = ribbonAgeAt(buf.ages, n, sn, i + 1);
      const age = (prev + next) * 0.5;
      buf.segThick[i] = Phaser.Math.Linear(2.55, 0.35, Math.pow(age, 0.85)) * widthMul;
      buf.segFade[i] = linger * Phaser.Math.Linear(1, 0.15, age);
      prev = next;
    }
    const layers = hue === "green" ? GREEN_LAYERS : hue === "magenta" ? MAGENTA_LAYERS : CYAN_LAYERS;
    for (let l = 0; l < layers.length; l++) {
      const [base, color, alpha] = layers[l]!;
      let styled = -1;
      for (let i = 0; i < sn - 1; i++) {
        // Alpha quantized so the style is re-set only when it visibly changes.
        const a = Math.round(alpha * buf.segFade[i]! * RIBBON_ALPHA_STEPS) / RIBBON_ALPHA_STEPS;
        if (a <= 0) continue;
        if (a !== styled) {
          g.fillStyle(color, a);
          styled = a;
        }
        lineQuadFast(g, buf.sx[i]!, buf.sy[i]!, buf.sx[i + 1]!, buf.sy[i + 1]!, base * buf.segThick[i]!);
      }
    }
    return depth;
  }

  drawEnergyTrails(): void {
    const g = this.energyTrailGfx;
    g.clear();
    if (this.s.player.phase === "dead") return;
    let depth = worldDepth(this.s.player.z, ZOff.shot - 0.6, this.s.player.y);
    for (const s of this.s.shots) {
      if (s.from !== "player") continue;
      if (s.energyTrails) {
        const n = s.energyTrails.length;
        for (let i = 0; i < n; i++) {
          const pts = s.energyTrails[i]!;
          if (pts.length < 2) continue;
          const widthMul = n <= 1 ? 1 : Phaser.Math.Linear(1.35, 0.55, i / Math.max(1, n - 1));
          depth = Math.max(depth, this.drawEnergyRibbon(g, pts, widthMul));
        }
      } else if (s.energyTrail && s.energyTrail.length >= 2) {
        depth = Math.max(depth, this.drawEnergyRibbon(g, s.energyTrail));
      }
    }
    for (const pts of this.energyLinger) {
      depth = Math.max(depth, this.drawEnergyRibbon(g, pts));
    }
    g.setDepth(depth);
  }

  spawnBlastTrails(
    x: number,
    y: number,
    z: number,
    dx: number,
    dy: number,
    dz: number,
    soft = false,
    size01 = 0.7,
    power = 1,
    body?: Footprint,
    particleInset = 0
  ): void {
    const p = Phaser.Math.Clamp(power, 0.5, 2.4);
    const t = Math.min(1, (p - 0.5) / 1.9);
    const n =
      Math.max(2, Math.round(Phaser.Math.Linear(soft ? 2 : 4, soft ? 5 : 11, size01))) + ((Math.random() * 2) | 0);
    // Drop settled blast trails that are mostly faded so a barrage keeps fresh streaks.
    this.cullFadedEphemeralTrails(n);
    const spdMul = Phaser.Math.Linear(0.95, 1.4, t);
    const tight = soft ? 0.18 : Phaser.Math.Linear(0.45, 0.7, t);
    for (let i = 0; i < n; i++) {
      const reverse = Math.random() < (soft ? 0.35 : 0.14);
      const d = biasedDir(dx, dy, dz, tight, reverse);
      const sp = range(70, 250) * spdMul;
      const jit = soft ? 0.55 : 0.3;
      const trailR = soft
        ? range(6.8, 7.6)
        : Phaser.Math.Linear(2.2, 14, size01) * range(0.75, 1.15);
      // Soft trails are large visually — inset more so they birth inside the body.
      const inset = body ? Math.max(particleInset, trailR * (soft ? 0.35 : 0.2)) : 0;
      const o = body ? randomInFootprint(body, inset) : { x, y };
      this.s.destruction.admitDebris({
        x: o.x,
        y: o.y,
        z: z + range(6, 18),
        vx: d.x * sp + range(-sp * jit * 0.5, sp * jit * 0.5),
        vy: d.y * sp + range(-sp * jit * 0.5, sp * jit * 0.5),
        vz: range(140, 300) * Phaser.Math.Linear(0.95, 1.15, t) + d.z * 40,
        angle: 0,
        spin: 0,
        life: range(1.6, 3),
        key: "fx_debris_metal",
        settled: false,
        gravity: true,
        bounces: Math.random() < 0.4 ? 1 : 0,
        trailOnly: true,
        debrisClass: "ephemeral",
        linger: true,
        trailR,
        trailSoft: soft,
        wobble: Math.random() * Math.PI * 2,
        wobFreq: range(9, 17),
        wobAmp: range(140, 300),
      });
    }
  }

  /** Free ephemeral slots held by nearly-done settled blast trails. */
  cullFadedEphemeralTrails(need: number): void {
    if (need <= 0) return;
    let freed = 0;
    for (let i = this.s.debris.length - 1; i >= 0 && freed < need; i--) {
      const f = this.s.debris[i]!;
      if (f.debrisClass !== "ephemeral" || !f.settled) continue;
      const fade = f.trailFade ?? 0;
      const max = f.trailFadeMax ?? 1;
      if (fade / max > 0.35) continue;
      this.s.debris.splice(i, 1);
      freed++;
    }
  }

  texTrailR(key: string): number {
    const hit = this.texTrailCache.get(key);
    if (hit != null) return hit;
    if (!this.s.textures.exists(key)) return 14;
    const src = this.s.textures.get(key).getSourceImage() as { width: number; height: number };
    const v = Math.max(10, Math.max(src.width, src.height) * 0.32);
    this.texTrailCache.set(key, v);
    return v;
  }
}
