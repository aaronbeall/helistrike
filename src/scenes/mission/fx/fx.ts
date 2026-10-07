import Phaser from "phaser";
import { mountAt, shellGirth } from "../../../render/spritePose";
import { coneDir, biasedDir, expBiasDir } from "../../../util/vec";
import { range } from "../../../util/rng";
import { simParticleTexKey, simParticleLook } from "../../../render/simParticleLook";
import { applyThermalHeat } from "../../../render/thermal";
import { resolveSkin } from "../../../render/camo";
import { radius, textureOf, type Debris, type SimParticle } from "../../../sim/combat";
import { Layer, ZOff, Z_GRAVITY, worldDepth } from "../../../render/depth";
import { TOON_BLAST_VARIANTS, toonBlastAnimKey, toonBlastKey } from "../../../render/toonBlast";
import { ensureAllArtGenAnims } from "../../../art/artGen";
import { isOrganic, specOf } from "../../../sim/roster";
import { randomInFootprint, type Footprint } from "../../../render/footprint";
import { craftGunSocketSlots } from "../../../sim/crafts";
import { spriteUvPos, FX_VARIANTS, spritePivot, ensureImpactGlow } from "../../../art/sprites";
import { groundSlope, groundZ, worldToScreen, cameraPointVisible, screenToWorldAtZ, screenVelX, screenVelY, projectHeading, sampleBiome } from "../../../worldgen/world";
import type { MissionScene } from "../../missionScene";
import { flameDensityMul } from "../../../render/fxCurves";

/** Damaged-unit fire: spawn disc radius (screen px) per unit of flame scale. */
const DMG_FIRE_AREA = 2.4;

/** Ejected shell casings: minimum tumble (rad/s) at ejection; bounces keep at least 60% of it. */
const CASING_SPIN_MIN = 16;
/** Airborne casings: sideways and upward eject speeds (before girth / fire-rate and debris loft multipliers). */
const CASING_AIR_SIDE_MIN = 55;
const CASING_AIR_SIDE_MAX = 100;
const CASING_AIR_UP_MIN = 70;
const CASING_AIR_UP_MAX = 115;

export type BurstParticle = Phaser.GameObjects.Particles.Particle & {
  burstVx?: number;
  burstVy?: number;
  burstHeading?: number;
  launchScale?: number;
  launchStretch?: number;
  launchThick?: number;
  launchSpd?: number;
  swirl?: number;
};

export type FxClass = "short" | "fire" | "smoke" | "dust";

type FxPolicy = {
  frameCap: number;
  activeCap: number;
  emitted: number;
  emitters: Set<Phaser.GameObjects.Particles.ParticleEmitter>;
};


/** FX: particle emitters + emit context, pools/bands/budgets, impacts, toon blasts, big-boom FX, muzzle flashes, shell ejects, damage FX, sim particles. */
export class Fx {
  simParticles: SimParticle[] = [];
  simParticleG!: Phaser.GameObjects.Group;
  smoke!: Phaser.GameObjects.Particles.ParticleEmitter;
  flame!: Phaser.GameObjects.Particles.ParticleEmitter;
  hotFlame!: Phaser.GameObjects.Particles.ParticleEmitter;
  hurtSmoke!: Phaser.GameObjects.Particles.ParticleEmitter;
  playerHurtSmoke!: Phaser.GameObjects.Particles.ParticleEmitter;
  burn!: Phaser.GameObjects.Particles.ParticleEmitter;
  lingerBurn!: Phaser.GameObjects.Particles.ParticleEmitter;
  shortBurst!: Phaser.GameObjects.Particles.ParticleEmitter;
  /** Long, fast, high-drag streaks for HE / death bursts. */
  streakBurst!: Phaser.GameObjects.Particles.ParticleEmitter;
  /** Big boom sparks: thick dense needles — slow loft, gravity fall, frozen launch angle. */
  bigBoomSparkBurst!: Phaser.GameObjects.Particles.ParticleEmitter;
  /** Reactive armor: big red/pink stretched streak sparks (streakBurst style, own tint). */
  reactiveArmorSpark!: Phaser.GameObjects.Particles.ParticleEmitter;
  /** Big boom dirt streaks — long travel needles that keep size while they fall. */
  bigBoomDirtBurst!: Phaser.GameObjects.Particles.ParticleEmitter;
  /** Cyan blur streaks for Starscream breaks. */
  energyStreakBurst!: Phaser.GameObjects.Particles.ParticleEmitter;
  /** Tesla impact needles — omnidirectional, high-drag, frozen heading. */
  teslaSparkBurst!: Phaser.GameObjects.Particles.ParticleEmitter;
  /** Railgun cyan spit — forward along bolt travel, jitter + shrink. */
  railSparkTrail!: Phaser.GameObjects.Particles.ParticleEmitter;
  /** Magenta motes left along a warp bomb path. */
  warpTrail!: Phaser.GameObjects.Particles.ParticleEmitter;
  /** Soft energy balls trailing the warp bomb. */
  warpOrb!: Phaser.GameObjects.Particles.ParticleEmitter;
  /** Magenta spark needles shed by the warp bomb. */
  warpSparkBurst!: Phaser.GameObjects.Particles.ParticleEmitter;
  /** Round magnesium motes left along a flare’s path (fire-trail style). */
  flareTrail!: Phaser.GameObjects.Particles.ParticleEmitter;
  /** Bigger round sparks at the flare pellet itself. */
  flareSpark!: Phaser.GameObjects.Particles.ParticleEmitter;
  /** Signal-flare gun: pink/red flame-smoke loft trail. */
  signalFlareTrail!: Phaser.GameObjects.Particles.ParticleEmitter;
  /** Signal-flare gun: pink tinted smoke loft. */
  signalFlareSmoke!: Phaser.GameObjects.Particles.ParticleEmitter;
  /** Signal-flare gun: fast red sparks. */
  signalFlareSpark!: Phaser.GameObjects.Particles.ParticleEmitter;
  muzzleBurst!: Phaser.GameObjects.Particles.ParticleEmitter;
  splashBurst!: Phaser.GameObjects.Particles.ParticleEmitter;
  tinyBurn!: Phaser.GameObjects.Particles.ParticleEmitter;
  shortTrailSmoke!: Phaser.GameObjects.Particles.ParticleEmitter;
  lingerSmoke!: Phaser.GameObjects.Particles.ParticleEmitter;
  /** Hydra / rocket plume — stretched along flight heading. */
  rocketSmoke!: Phaser.GameObjects.Particles.ParticleEmitter;
  heliDust!: Phaser.GameObjects.Particles.ParticleEmitter;
  /** Rotor wash over water: white mist. */
  heliMist!: Phaser.GameObjects.Particles.ParticleEmitter;
  craftExhaust!: Phaser.GameObjects.Particles.ParticleEmitter;
  craftExhaustMote!: Phaser.GameObjects.Particles.ParticleEmitter;
  craftExhaustSmoke!: Phaser.GameObjects.Particles.ParticleEmitter;
  /** Banked jet wingtip contrails — stretched pale smoke. */
  jetWingTrail!: Phaser.GameObjects.Particles.ParticleEmitter;
  exhaustVx = 0;
  exhaustVy = 0;
  exhaustAngle = 0;
  /** Screen-space heading for rocket smoke particle stretch. */
  shotTrailAngle = 0;
  exhaustTint = 0xffffff;
  exhaustSmokeTint = 0x8b8b86;
  exhaustScaleX = 1;
  exhaustScaleY = 0.4;
  exhaustLife = 260;
  /** Initial trail opacity baked at emit from thrustPower. */
  exhaustAlpha = 0.98;
  wingTrailAngle = 0;
  wingTrailVx = 0;
  wingTrailVy = 0;
  wingTrailScaleX = 1;
  wingTrailScaleY = 0.22;
  wingTrailLife = 900;
  wingTrailTint = 0xffffff;
  /** Camera-depth-banded clones: each band keeps fire>smoke without a global restack. */
  slots = new Map<Phaser.GameObjects.Particles.ParticleEmitter, Phaser.GameObjects.Particles.ParticleEmitter[]>();
  policies: Record<FxClass, FxPolicy> = {
    short: { frameCap: 96, activeCap: 384, emitted: 0, emitters: new Set() },
    fire: { frameCap: 96, activeCap: 1400, emitted: 0, emitters: new Set() },
    smoke: { frameCap: 72, activeCap: 1024, emitted: 0, emitters: new Set() },
    dust: { frameCap: 96, activeCap: 512, emitted: 0, emitters: new Set() },
  };
  /** Saved blend/tintFill so thermal can force NORMAL + fill without losing defaults. */
  thermalSaved = new Map<
    Phaser.GameObjects.Particles.ParticleEmitter,
    { blendMode: Phaser.BlendModes | string; tintFill: boolean }
  >();
  /** Painter-depth bands so concurrent trails don't all share one emitter depth. */
  slotN = 8;
  bandH = 48;
  /** Scratch used only by synchronous onEmit callbacks; particles retain update state themselves. */
  burstLaunch = {
    x: 0, y: 0, z: 0, bx: 1, by: 0, bz: 0, tight: 0.5,
    spdMin: 40, spdMax: 120, scale: 1, stretchMul: 1, expBias: 0, gravity: 0,
    /** Half-angle (rad) for forward cone sampling; when set, speed scales with aim alignment. */
    coneHalf: 0,
  };
  muzzle!: Phaser.GameObjects.Image;
  muzzlePool: Phaser.GameObjects.Image[] = [];
  /** Soft ADD glow discs paired 1:1 with `muzzlePool` (tip-attached). */
  muzzleGlowPool: Phaser.GameObjects.Image[] = [];
  /** Per-pool life + attach so flashes stay glued to the barrel while alive. */
  muzzleFlashes: {
    life: number;
    /** Initial life — glow alpha fades over this. */
    life0: number;
    ang: number;
    /** Pre–z-scale size; multiplied by current tip screen scale each frame. */
    scaleMul: number;
    /** Pre–z-scale glow diameter. */
    glowMul: number;
    rotJitter: number;
    /** Socket that fired — drives above/below muzzle Z + depth. */
    slot?: number;
    muzzleUv?: { x: number; y: number };
    gunI?: number;
    /** Which muzzle UV on the gun texture (dual-rail turrets). */
    gunMuzzleI?: number;
    /** Firing point in map coordinates. */
    worldX?: number;
    worldY?: number;
    worldZ?: number;
    /** Painter offset at that point. Defaults to a belly muzzle. */
    depthOff?: number;
  }[] = [];
  muzzleCursor = 0;
  dmgFlameScale = 1;
  /** Mean start scale (fx_flame units) of the fire in the current fire/smoke pair — paired smoke starts at that size (0 = none). */
  smokeMatchFire = 0;
  trailFxScale = 1;
  /** Multiplier for trail particle lifespan (mid ≈ 1; large debris > 1). */
  trailFxLife = 1;
  /** One-shot flash stamps for a unit's non-primary tips on a simultaneous-fire volley (the unit's
   *  own pooled `flash` sprite in `syncUnitSprites` already covers the primary tip). */
  extraMuzzleFlashPool: Phaser.GameObjects.Image[] = [];
  extraMuzzleFlashes: { im: Phaser.GameObjects.Image; t: number; max: number }[] = [];

  constructor(readonly s: MissionScene) {}

  /** Per-mission state reset (called from the scene's init). */
  reset(): void {
    this.slots.clear();
    this.thermalSaved.clear();
    this.extraMuzzleFlashes = [];
    this.simParticles = [];
  }

  /** Reserve within one semantic pool; no dirt effect may evict another category. */
  reserveSimParticleSlots(capacityClass: SimParticle["capacityClass"], wanted: number): number {
    const cap = capacityClass === "impact" ? 280 : capacityClass === "dust" ? 360 : 96;
    let classCount = this.simParticles.reduce(
      (n, particle) => n + (particle.capacityClass === capacityClass ? 1 : 0),
      0
    );
    let need = Math.max(0, classCount + wanted - cap);
    for (let i = 0; i < this.simParticles.length && need > 0;) {
      const s = this.simParticles[i]!;
      if (s.capacityClass !== capacityClass || (s.blood && !s.stamped)) i++;
      else {
        this.simParticles.splice(i, 1);
        classCount--;
        need--;
      }
    }
    return Math.min(wanted, Math.max(0, cap - classCount));
  }

  /** Thick dense long needles for big boom blasts — fly out, coast, arc down, shrink as they slow. */
  emitBigBoomSparks(
    x: number,
    y: number,
    z: number,
    size01: number,
    dx: number,
    dy: number,
    dz: number,
    /** Particle size × (smaller sparks). */
    scaleMul = 1,
    /** Throw speed × (shorter reach). */
    speedMul = 1
  ): void {
    const len = Math.max(1e-3, Math.hypot(dx, dy, dz));
    const ix = dx / len;
    const iy = dy / len;
    let bx = ix * 0.55;
    let by = -0.82 + iy * 0.35;
    let bz = 0.22 + Math.max(0, dz / len) * 0.28;
    const nLen = Math.max(1e-3, Math.hypot(bx, by, bz));
    bx /= nLen;
    by /= nLen;
    bz /= nLen;
    const s01 = Phaser.Math.Clamp(size01, 0.2, 1);
    const n = Math.round(Phaser.Math.Linear(34, 58, s01));
    this.emitVisualBurst(
      x,
      y,
      z,
      {
        n,
        spdMin: Phaser.Math.Linear(220, 320, s01) * speedMul,
        spdMax: Phaser.Math.Linear(860, 1200, s01) * speedMul,
        bx,
        by,
        bz,
        tight: 0,
        scaleMul: Phaser.Math.Linear(1.05, 1.65, s01) * scaleMul,
        stretchMul: Phaser.Math.Linear(1.5, 2.1, s01) * scaleMul,
        coneHalf: Phaser.Math.Linear(1.05, 1.25, s01),
        // Above dirt streaks; boomBits draw higher still.
        depthOff: ZOff.fire + 0.55,
      },
      this.bigBoomSparkBurst
    );
  }

  /** Electrical short: flickering zap arcs and falling tesla sparks along a pylon's cross-arms for ~2s. */
  electricShort(x: number, y: number, z: number, heading: number, armR: number, pulses = 12): void {
    const ax = Math.cos(heading);
    const ay = Math.sin(heading);
    let t = 0;
    for (let i = 0; i < pulses; i++) {
      t += Phaser.Math.Between(70, 210);
      this.s.time.delayedCall(t, () => {
        const along = range(-1, 1) * armR;
        const px = x + ax * along;
        const py = y + ay * along;
        const pz = z + range(-8, 6);
        for (let k = 0, n = Phaser.Math.Between(2, 4); k < n; k++) {
          this.s.tesla.spawnZap(px + range(-14, 14), py + range(-14, 14), pz + range(-10, 10), range(0.7, 1.4), range(0.8, 1.6));
        }
        this.s.tesla.emitSparks(px, py, pz, 10, 0.9);
        this.emitVisualBurst(
          px,
          py,
          pz,
          { n: 14, spdMin: 60, spdMax: 260, bx: 0, by: 0, bz: -1, tight: 0, gravity: 700, coneHalf: Math.PI, scaleMul: 0.9 },
          this.teslaSparkBurst
        );
        const at = worldToScreen(px, py, pz);
        this.spawnImpactFlash(at.x, at.y, pz, 0xc8f0ff, range(40, 80) * at.scale, 0.85, 140);
      });
    }
  }

  /** Fuel / grain detonation: a chain of fireballs across a footprint over about a second. */
  infernoChain(x: number, y: number, z: number, spread: number, blasts = 5): void {
    for (let i = 0; i < blasts; i++) {
      this.s.time.delayedCall(120 + i * Phaser.Math.Between(110, 240), () => {
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * spread;
        const bx = x + Math.cos(a) * r;
        const by = y + Math.sin(a) * r;
        const bz = z + Math.random() * 20;
        this.heFireBurst(bx, by, bz, 0, 0, 1, spread * 1.6, false, 2.4, 1);
        this.spawnToonBlast(bx, by, bz, { building: true, size01: 1, waveMul: 1.5 });
        this.emitBigBoomSparks(bx, by, bz + 10, 1, 0, 0, 1);
        this.s.camera.shake = Math.min(14, this.s.camera.shake + 4);
      });
    }
  }

  /**
   * Companion to big-boom sparks: dirt streaks + small mech bits with Hydra-style smoke.
   * Same scatter family, slightly less loft / more impact bias / slower / heavier fall.
   */
  emitBigBoomDebris(
    x: number,
    y: number,
    z: number,
    size01: number,
    dx: number,
    dy: number,
    dz: number,
    /** Throw speed × for dirt and bits (shorter reach). */
    speedMul = 1
  ): void {
    const len = Math.max(1e-3, Math.hypot(dx, dy, dz));
    const ix = dx / len;
    const iy = dy / len;
    // Vs sparks: more impact-dir weight, less upward loft.
    let bx = ix * 0.72;
    let by = -0.68 + iy * 0.38;
    let bz = 0.16 + Math.max(0, dz / len) * 0.22;
    const nLen = Math.max(1e-3, Math.hypot(bx, by, bz));
    bx /= nLen;
    by /= nLen;
    bz /= nLen;
    const s01 = Phaser.Math.Clamp(size01, 0.2, 1);
    const coneHalf = Phaser.Math.Linear(1.0, 1.2, s01);
    const dirtN = Math.round(Phaser.Math.Linear(22, 40, s01));
    this.emitVisualBurst(
      x,
      y,
      z,
      {
        n: dirtN,
        spdMin: Phaser.Math.Linear(160, 240, s01) * speedMul,
        spdMax: Phaser.Math.Linear(620, 920, s01) * speedMul,
        bx,
        by,
        bz,
        tight: 0,
        scaleMul: Phaser.Math.Linear(0.95, 1.45, s01),
        stretchMul: Phaser.Math.Linear(1.35, 1.9, s01),
        coneHalf,
        // Back of the boom stack — under fire / sparks / mech bits.
        depthOff: ZOff.smoke - 0.15,
      },
      this.bigBoomDirtBurst,
      "dust"
    );

    const bitN = Math.round(Phaser.Math.Linear(36, 68, s01));
    const mechKeys = Array.from({ length: 12 }, (_, i) => `fx_debris_mech_${i}`);
    for (let i = 0; i < bitN; i++) {
      const key = this.s.textures.exists(mechKeys[i % mechKeys.length]!)
        ? mechKeys[i % mechKeys.length]!
        : this.s.textures.exists("fx_debris_metal")
          ? "fx_debris_metal"
          : null;
      if (!key) continue;
      const d = coneDir(bx, by, bz, coneHalf, 6.5);
      const cosMin = Math.cos(coneHalf);
      const kSpeed = 11;
      const t =
        (Math.exp(kSpeed * d.align) - Math.exp(kSpeed * cosMin)) /
        Math.max(1e-4, Math.exp(kSpeed) - Math.exp(kSpeed * cosMin));
      const spd =
        Phaser.Math.Linear(
          Phaser.Math.Linear(140, 200, s01),
          Phaser.Math.Linear(480, 720, s01),
          Phaser.Math.Clamp(t, 0, 1)
        ) * range(0.88, 1.08) * speedMul;
      const scale = range(0.14, 0.26) * Phaser.Math.Linear(0.95, 1.2, s01);
      // Strong loft so flecks arc in XY before ground contact.
      const loft = range(160, 340) * Phaser.Math.Linear(0.9, 1.2, s01) * Math.sqrt(speedMul);
      this.s.destruction.admitDebris({
        x: x + range(-6, 6),
        y: y + range(-6, 6),
        z: z + range(16, 42),
        vx: d.x * spd,
        vy: d.y * spd,
        vz: Math.max(0, d.z) * spd * 2.0 + loft,
        angle: Math.atan2(d.y, d.x) + range(-0.6, 0.6),
        spin: range(-8, 8),
        life: 2.5,
        key,
        settled: false,
        gravity: true,
        bounces: 0,
        trailR: this.s.trails.texTrailR(key) * scale * 0.45,
        scale,
        boomBit: true,
        debrisClass: "ephemeral",
      });
    }
  }

  /** Rail discharge at the barrel: Tesla tip bloom, zap, and spark spit. No orange gun flash. */
  emitRailMuzzle(x: number, y: number, z: number, dx: number, dy: number, dz: number): void {
    const len = Math.max(1e-3, Math.hypot(dx, dy, dz));
    this.s.tesla.emitSparks(x, y, z, 10, 0.85);
    this.emitVisualBurst(
      x,
      y,
      z,
      {
        n: 12,
        spdMin: 90,
        spdMax: 280,
        bx: dx / len,
        by: dy / len,
        bz: dz / len,
        tight: 0.8,
        scaleMul: 0.7,
        stretchMul: 1.75,
        coneHalf: 0.42,
      },
      this.teslaSparkBurst
    );
    this.s.tesla.spawnZap(x, y, z, 1.05, 1.15);
    this.s.tesla.spawnZap(x, y, z, 0.7, 0.9);
    const at = worldToScreen(x, y, z);
    this.spawnImpactFlash(at.x, at.y, z, 0x88f4ff, 72 * at.scale, 0.78, 160);
    this.spawnImpactFlash(at.x, at.y, z, 0xf4ffff, 28 * at.scale, 0.95, 100);
  }

  /** Photon / warp detonation extras — Tesla zaps + blooms + large additive light flash. */
  emitPhotonImpactSparks(
    x: number,
    y: number,
    z: number,
    dx: number,
    dy: number,
    dz: number,
    blast = 155
  ): void {
    const len = Math.max(1e-3, Math.hypot(dx, dy, dz));
    const bx = dx / len;
    const by = dy / len;
    const bz = dz / len;
    const at = worldToScreen(x, y, z);
    for (let i = 0; i < 18; i++) {
      const d = coneDir(bx, by, bz + 0.25, 0.85, 16);
      const r = 36 + Math.random() * 160;
      this.s.tesla.spawnZap(
        x + d.x * r,
        y + d.y * r,
        z + d.z * r * 0.4 + range(-10, 28),
        range(0.7, 1.45),
        range(1.2, 2.2)
      );
    }
    this.spawnImpactFlash(at.x, at.y, z, 0xc8f0ff, 70 * at.scale, 0.9, 220);
    this.spawnImpactFlash(at.x, at.y, z, 0xe080ff, 42 * at.scale, 0.75, 160);
    this.spawnPhotonBlastFlash(at.x, at.y, z, at.scale);
    this.s.projectiles.spawnBlastRing(x, y, z, Math.max(48, blast * 0.38), {
      tint: 0xe8c0ff,
      alpha: 0.72,
      duration: 320,
      expand: 2.4,
    });
    this.s.camera.shake = Math.min(9, this.s.camera.shake + 2.8);
  }

  /** Big additive light overlay for photonic detonations (Photon + Warp). */
  spawnPhotonBlastFlash(x: number, y: number, z: number, viewScale: number): void {
    const key = this.s.textures.exists("shot_photon_glow")
      ? "shot_photon_glow"
      : this.s.textures.exists("fx_tesla_glow")
        ? "fx_tesla_glow"
        : "fx_glow";
    if (key === "fx_glow" && !this.s.textures.exists("fx_glow")) ensureImpactGlow(this.s.textures);
    const world = screenToWorldAtZ(x, y, z);
    const size0 = 420 * viewScale;
    const size1 = 640 * viewScale;
    const glow = this.s.add
      .image(x, y, key)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(0xf4e8ff)
      .setDisplaySize(size0, size0)
      .setAlpha(0.95)
      .setDepth(worldDepth(z, ZOff.fire + 6, world.y));
    this.s.tweens.add({
      targets: glow,
      alpha: 0,
      displayWidth: size1,
      displayHeight: size1,
      duration: 420,
      ease: "Cubic.Out",
      onComplete: () => glow.destroy(),
    });
  }

  /** One-shot flash for a simultaneous-fire tip other than the unit's primary (pooled) muzzle sprite. */
  spawnExtraMuzzleFlash(x: number, y: number, z: number, ang: number, scale: number): void {
    let im = this.extraMuzzleFlashPool.find((spr) => !spr.visible);
    if (!im) {
      im = this.s.add.image(0, 0, "fx_muzzle", 0).setVisible(false).setBlendMode(Phaser.BlendModes.ADD);
      this.extraMuzzleFlashPool.push(im);
    }
    const scr = worldToScreen(x, y, z);
    const frame = (Math.random() * FX_VARIANTS) | 0;
    const jitR = (Math.random() - 0.5) * 0.2;
    const jitS = range(0.9, 1.12);
    const life = 0.07;
    im.setTexture("fx_muzzle", frame)
      .setVisible(true)
      .setOrigin(0.15, 0.5)
      .setPosition(scr.x, scr.y)
      .setRotation(ang + jitR)
      .setScale(scale * scr.scale * jitS)
      .setAlpha(1)
      .setDepth(worldDepth(z, ZOff.muzzle + 0.4, y));
    this.extraMuzzleFlashes.push({ im, t: life, max: life });
  }

  tickExtraMuzzleFlashes(dt: number): void {
    let w = 0;
    for (let i = 0; i < this.extraMuzzleFlashes.length; i++) {
      const f = this.extraMuzzleFlashes[i]!;
      f.t -= dt;
      if (f.t <= 0) {
        f.im.setVisible(false);
        continue;
      }
      f.im.setAlpha(Phaser.Math.Clamp(f.t / f.max, 0, 1));
      this.extraMuzzleFlashes[w++] = f;
    }
    this.extraMuzzleFlashes.length = w;
  }

  /** Muzzle flash at the firing point passed in. Redrawn until `life` runs out. */
  showMuzzle(opt: {
    life: number;
    ang: number;
    scaleMul: number;
    /** Soft bloom diameter; defaults to max(48, scaleMul×72). */
    glowMul?: number;
    slot?: number;
    muzzleUv?: { x: number; y: number };
    gunI?: number;
    gunMuzzleI?: number;
    worldX?: number;
    worldY?: number;
    worldZ?: number;
    depthOff?: number;
  }): void {
    let index = this.muzzleFlashes.findIndex((f) => f.life <= 0);
    if (index < 0) index = this.muzzleCursor++ % this.muzzlePool.length;
    const flash = this.muzzleFlashes[index]!;
    flash.life = opt.life;
    flash.life0 = opt.life;
    flash.ang = opt.ang;
    flash.scaleMul = opt.scaleMul;
    // Soft bloom larger than the flash sprite so it reads as light, not a speck.
    flash.glowMul = opt.glowMul ?? Math.max(48, opt.scaleMul * 72);
    flash.rotJitter = range(-0.1, 0.1);
    flash.slot = opt.slot;
    flash.muzzleUv = opt.muzzleUv;
    flash.gunI = opt.gunI;
    flash.gunMuzzleI = opt.gunMuzzleI;
    flash.worldX = opt.worldX;
    flash.worldY = opt.worldY;
    flash.worldZ = opt.worldZ;
    flash.depthOff = opt.depthOff;
    const muzzle = this.muzzlePool[index] ?? this.muzzle;
    muzzle.setFrame((Math.random() * FX_VARIANTS) | 0);
    this.syncMuzzleFlash(index);
  }

  /** Socket owning a live muzzle flash (above/below Z + depth). */
  muzzleFlashSlot(flash: (typeof this.muzzleFlashes)[number]): number {
    if (flash.slot != null) return flash.slot;
    if (flash.gunI != null) {
      return craftGunSocketSlots(this.s.player.spec)[flash.gunI] ?? this.s.player.weapon;
    }
    return this.s.player.weapon;
  }

  /** World tip for a live muzzle flash slot. */
  muzzleFlashTip(flash: (typeof this.muzzleFlashes)[number]): { x: number; y: number; z: number } {
    if (flash.worldX != null && flash.worldY != null) {
      return {
        x: flash.worldX,
        y: flash.worldY,
        z: flash.worldZ ?? this.s.player.z + ZOff.shot,
      };
    }
    const h = this.s.player;
    const slot = this.muzzleFlashSlot(flash);
    const z = this.s.fireControl.playerMuzzleZ(slot, flash.gunMuzzleI ?? 0);
    if (flash.muzzleUv) {
      const at = this.s.hostCraft.craftBodyMountWorldPos(flash.muzzleUv);
      return { x: at.x, y: at.y, z };
    }
    if (flash.gunI != null) {
      const at = this.s.hostCraft.gunTip(flash.gunI, flash.gunMuzzleI ?? 0);
      return { x: at.x, y: at.y, z };
    }
    return { x: h.x, y: h.y, z };
  }

  syncMuzzleFlash(index: number): void {
    const flash = this.muzzleFlashes[index];
    const muzzle = this.muzzlePool[index];
    const glow = this.muzzleGlowPool[index];
    if (!flash || !muzzle || flash.life <= 0) return;
    const tip = this.muzzleFlashTip(flash);
    const depthOff =
      flash.depthOff ??
      (flash.worldX != null
        ? ZOff.muzzle + 0.15
        : this.s.fireControl.playerMuzzleDepthOff(this.muzzleFlashSlot(flash), flash.gunMuzzleI ?? 0));
    const depth = worldDepth(tip.z, depthOff, tip.y);
    const at = worldToScreen(tip.x, tip.y, tip.z);
    const fade = flash.life0 > 1e-4 ? Phaser.Math.Clamp(flash.life / flash.life0, 0, 1) : 0;
    muzzle
      .setVisible(true)
      .setOrigin(0.14, 0.5)
      .setPosition(at.x, at.y)
      .setRotation(projectHeading(flash.ang, tip.x, tip.y, tip.z) + flash.rotJitter)
      .setScale(flash.scaleMul * at.scale)
      .setAlpha(fade)
      .setDepth(depth);
    if (this.s.thermal.on) {
      muzzle.setBlendMode(Phaser.BlendModes.NORMAL);
      applyThermalHeat(muzzle, true, 0.96 * fade);
    } else {
      muzzle.setBlendMode(Phaser.BlendModes.ADD);
      applyThermalHeat(muzzle, false, 0, 0xfff6d0);
    }
    if (glow) {
      const gSize = flash.glowMul * at.scale;
      glow
        .setVisible(true)
        .setPosition(at.x, at.y)
        .setDisplaySize(gSize, gSize)
        .setAlpha(0.75 * fade)
        .setDepth(depth + 0.05);
      if (this.s.thermal.on) {
        glow.setBlendMode(Phaser.BlendModes.NORMAL);
        applyThermalHeat(glow, true, 0.92 * fade);
      } else {
        glow.setBlendMode(Phaser.BlendModes.ADD);
        applyThermalHeat(glow, false, 0, 0xfff2c8);
      }
    }
  }

  tickPlayerMuzzles(dt: number): void {
    for (let i = 0; i < this.muzzleFlashes.length; i++) {
      const flash = this.muzzleFlashes[i]!;
      if (flash.life <= 0) continue;
      flash.life -= dt;
      if (flash.life <= 0) {
        this.muzzlePool[i]?.setVisible(false);
        this.muzzleGlowPool[i]?.setVisible(false);
        continue;
      }
      this.syncMuzzleFlash(i);
    }
  }

  /** Soft additive light bloom (enemy / one-shot); player uses tip-attached glow pool. */
  spawnMuzzleLight(x: number, y: number, z: number, size: number): void {
    this.spawnImpactFlash(x, y, z, 0xfff2c8, Math.max(36, size * 1.35), 0.75, 120);
  }

  /**
   * Eject a spent casing sideways from a cannon mount (90° ± jitter).
   * Falls with gravity, bounces with heavy friction, stamps onto the wreck layer.
   */
  spawnShellEject(opts: {
    x: number;
    y: number;
    z: number;
    barrelAng: number;
    designation?: string;
    scale?: number;
    dmg?: number;
    /** +1 barrel-right / −1 barrel-left (from midline). Required for consistent eject. */
    side: number;
    /** Air craft: spawn/draw under hull. Ground: spawn/draw above. */
    aerial?: boolean;
    /** Weapon fire interval (s). Lower = faster = slightly harder eject. */
    fireCd?: number;
  }): void {
    const girth = shellGirth(opts);
    if (girth <= 0) return;
    const side = opts.side >= 0 ? 1 : -1;
    const ejectAng = opts.barrelAng + side * (Math.PI / 2) + range(-0.28, 0.28);
    // Subtle cadence bias: chain (~0.07s) punches harder than slow AA (~2–3s).
    const cd = Phaser.Math.Clamp(opts.fireCd ?? 0.45, 0.05, 3.2);
    const rateMul = Phaser.Math.Linear(1.2, 0.82, Phaser.Math.Clamp((cd - 0.06) / 1.6, 0, 1));
    const girthMul = Phaser.Math.Linear(1.05, 0.78, Phaser.Math.Clamp((girth - 0.28) / 0.72, 0, 1));
    // Aircraft fling casings well out to the side; ground guns drop them nearby.
    const spd = (opts.aerial ? range(CASING_AIR_SIDE_MIN, CASING_AIR_SIDE_MAX) : range(22, 48)) * girthMul * rateMul;
    const shellKeys = ["fx_shell", "fx_shell_1", "fx_shell_2", "fx_shell_3", "fx_shell_4"];
    const available = shellKeys.filter((k) => this.s.textures.exists(k));
    if (!available.length) return;
    const key = available[(Math.random() * available.length) | 0]!;
    // Gentle upward toss so casings hang a moment under constant gravity before falling.
    const vzBase = opts.aerial ? range(CASING_AIR_UP_MIN, CASING_AIR_UP_MAX) : range(28, 58);
    this.s.destruction.admitDebris({
      x: opts.x + range(-1.2, 1.2),
      y: opts.y + range(-1.2, 1.2),
      z: opts.z,
      vx: Math.cos(ejectAng) * spd + range(-6, 6),
      vy: Math.sin(ejectAng) * spd + range(-6, 6),
      vz: vzBase * Phaser.Math.Linear(0.92, 1.08, (rateMul - 0.82) / 0.38),
      angle: ejectAng + range(-0.6, 0.6),
      spin: (Math.random() < 0.5 ? -1 : 1) * range(CASING_SPIN_MIN, 42) * Phaser.Math.Linear(0.9, 1.12, (rateMul - 0.82) / 0.38),
      minSpin: CASING_SPIN_MIN * 0.6,
      life: 4,
      key,
      settled: false,
      gravity: true,
      bounces: 2 + ((Math.random() * 2) | 0),
      trailR: 1.6 * girth,
      scale: girth * 0.72,
      shellEject: true,
      shellUnder: !!opts.aerial,
      shellHeat: 1,
    });
  }

  spawnImpactFlash(
    x: number,
    y: number,
    z: number,
    tint: number,
    size: number,
    alpha: number,
    duration: number
  ): void {
    if (!this.s.textures.exists("fx_glow")) ensureImpactGlow(this.s.textures);
    const world = screenToWorldAtZ(x, y, z);
    const glow = this.s.add
      .image(x, y, "fx_glow")
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(tint)
      .setDisplaySize(size, size)
      .setAlpha(alpha)
      // Sit clearly above blast flame particles so the soft disc isn't buried.
      .setDepth(worldDepth(z, ZOff.fire + 5, world.y));
    this.s.tweens.add({
      targets: glow,
      alpha: 0,
      duration,
      ease: "Quad.Out",
      onComplete: () => glow.destroy(),
    });
  }

  /**
   * Additive cel fireball (toon blast sheet): hot core → rolling smoke.
   * Buildings get a taller scale; vehicles sit smaller.
   */
  spawnToonBlast(
    x: number,
    y: number,
    z: number,
    opts?: { building?: boolean; size01?: number; waveMul?: number }
  ): void {
    ensureAllArtGenAnims(this.s.anims, this.s.textures);
    const variant = (Math.random() * TOON_BLAST_VARIANTS) | 0;
    const tex = toonBlastKey(variant);
    if (!this.s.textures.exists(tex)) return;
    const anim = toonBlastAnimKey(variant);
    if (!this.s.anims.exists(anim)) return;
    const at = worldToScreen(x, y, z);
    const size01 = Phaser.Math.Clamp(opts?.size01 ?? 0.55, 0.16, 1);
    const building = !!opts?.building;
    // Native sheet ~192px; screen scale folds in perspective (`at.scale`).
    const base = building
      ? Phaser.Math.Linear(1.55, 2.45, size01)
      : Phaser.Math.Linear(0.85, 1.45, size01);
    const sc = base * (opts?.waveMul ?? 1) * at.scale * range(0.92, 1.08);
    const spr = this.s.add
      .sprite(at.x, at.y - (building ? 18 : 8) * at.scale, tex, 0)
      .setOrigin(0.5, 0.62)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setScale(sc)
      .setAlpha(building ? 0.95 : 0.88)
      .setDepth(worldDepth(z, ZOff.fire + 3.5, y));
    const kill = () => {
      if (spr.active) spr.destroy();
    };
    spr.once(Phaser.Animations.Events.ANIMATION_COMPLETE, kill);
    spr.play(anim);
    // Fallback if the anim is removed/recreated mid-play (e.g. art-gen rebake).
    const animData = this.s.anims.get(anim);
    const ms = animData
      ? (animData.frames.length / Math.max(1, animData.frameRate)) * 1000 + 120
      : 1400;
    this.s.time.delayedCall(ms, kill);
  }

  sampleBurstScreenVelocity(p?: BurstParticle): { x: number; y: number } {
    const opt = this.burstLaunch;
    let dx: number;
    let dy: number;
    let dz: number;
    let speed: number;
    if (opt.coneHalf > 0) {
      const d = coneDir(opt.bx, opt.by, opt.bz, opt.coneHalf, 6.5);
      // Speed falloff is steeper than density: wide/back sparks barely crawl, heading sparks bolt.
      const cosMin = Math.cos(opt.coneHalf);
      const kSpeed = 11;
      const t = (Math.exp(kSpeed * d.align) - Math.exp(kSpeed * cosMin))
        / Math.max(1e-4, Math.exp(kSpeed) - Math.exp(kSpeed * cosMin));
      const band = Math.max(0, opt.spdMax - opt.spdMin) * 0.06;
      speed = Phaser.Math.Linear(opt.spdMin, opt.spdMax, Phaser.Math.Clamp(t, 0, 1))
        + range(-band, band);
      dx = d.x;
      dy = d.y;
      dz = d.z;
    } else {
      const d = opt.expBias > 0
        ? expBiasDir(opt.bx, opt.by, opt.bz, opt.expBias)
        : biasedDir(opt.bx, opt.by, opt.bz, opt.tight, false);
      const align = (d as { align?: number }).align ?? 1;
      const speedBias = opt.expBias > 0
        ? Math.exp(opt.expBias * 0.55 * align) / Math.exp(opt.expBias * 0.55)
        : 1;
      speed = range(opt.spdMin, opt.spdMax) * speedBias;
      dx = d.x;
      dy = d.y;
      dz = d.z;
    }
    const vx = dx * speed;
    const vy = dy * speed;
    const vz = dz * speed;
    const screenX = screenVelX(vx, vy, vz, opt.x, opt.y, opt.z);
    const screenY = screenVelY(vy, vz, opt.z, opt.y);
    if (p) {
      p.burstVx = screenX;
      p.burstVy = screenY;
      p.burstHeading = Math.atan2(screenY, screenX);
    }
    return { x: screenX, y: screenY };
  }

  emitVisualBurst(
    x: number,
    y: number,
    z: number,
    opt: {
      n: number;
      spdMin: number;
      spdMax: number;
      bx: number;
      by: number;
      bz: number;
      tight: number;
      scaleMul?: number;
      stretchMul?: number;
      expBias?: number;
      gravity?: number;
      /** Half-angle (rad). When set, samples a forward-biased cone; speed rises toward the aim axis. */
      coneHalf?: number;
      /** Painter offset via worldDepth (gun < muzzle < body). Defaults to fire banding. */
      depthOff?: number;
    },
    emitter: Phaser.GameObjects.Particles.ParticleEmitter,
    kind: FxClass = "short"
  ): void {
    Object.assign(this.burstLaunch, {
      x, y, z, bx: opt.bx, by: opt.by, bz: opt.bz, tight: opt.tight,
      spdMin: opt.spdMin, spdMax: opt.spdMax, scale: opt.scaleMul ?? 1,
      stretchMul: opt.stretchMul ?? 1,
      expBias: opt.expBias ?? 0, gravity: opt.gravity ?? 0,
      coneHalf: opt.coneHalf ?? 0,
    });
    const at = worldToScreen(x, y, z);
    // Muzzle cones must share hull painter space (between gun and body), not fire FX bands.
    const em =
      emitter === this.muzzleBurst || opt.depthOff != null
        ? this.atWorld(z, y, emitter, opt.depthOff ?? ZOff.muzzle)
        : this.at(z, y, emitter, ZOff.fire + 0.4);
    this.emitBudgeted(kind, em, at.x, at.y, opt.n, kind === "fire");
  }

  /** Retained manually simulated dirt/blood because it interacts with and stamps terrain. */
  spawnDirtParticles(
    x: number,
    y: number,
    z: number,
    opt: {
      n: number;
      spdMin: number;
      spdMax: number;
      bx: number;
      by: number;
      bz: number;
      tight: number;
      scaleMul?: number;
      blood?: boolean;
      expBias?: number;
    }
  ): void {
    const capacityClass: SimParticle["capacityClass"] = opt.blood ? "blood" : "impact";
    const take = this.reserveSimParticleSlots(capacityClass, opt.n);
    if (take <= 0) return;
    const biome = sampleBiome(this.s.world, x, y);
    const k = opt.expBias;
    for (let i = 0; i < take; i++) {
      let dx: number;
      let dy: number;
      let dz: number;
      let spdMul = 1;
      if (k != null && k > 0) {
        const d = expBiasDir(opt.bx, opt.by, opt.bz, k);
        dx = d.x;
        dy = d.y;
        dz = d.z;
        // Forward align=1 → full speed; opposite align=-1 → much slower.
        spdMul = Math.exp(k * 0.55 * d.align) / Math.exp(k * 0.55);
      } else {
        const d = biasedDir(opt.bx, opt.by, opt.bz, opt.tight, false);
        dx = d.x;
        dy = d.y;
        dz = d.z;
      }
      const spd = range(opt.spdMin, opt.spdMax) * spdMul * 1.12;
      const life = range(0.75, 1.2);
      const look = simParticleLook("dirt", biome, opt.blood);
      const vx = dx * spd;
      const vy = dy * spd;
      const vz = dz * spd + 50;
      const sizeMul = (opt.scaleMul ?? 1) * 0.74 * (k != null ? Phaser.Math.Linear(0.72, 1.12, spdMul) : 1);
      this.simParticles.push({
        x,
        y,
        z: z + range(1, 5),
        vx,
        vy,
        vz,
        life,
        max: life,
        scale: range(0.52, 0.8) * sizeMul,
        bounces: 2 + ((Math.random() * 3) | 0),
        kind: "dirt",
        tex: simParticleTexKey("dirt"),
        frame: (Math.random() * FX_VARIANTS) | 0,
        angJit: range(-0.175, 0.175),
        spin: range(-1.2, 1.2),
        tint: look.tint,
        additive: look.add,
        heading: Math.atan2(
          screenVelY(vy, vz, z, y),
          screenVelX(vx, vy, vz, x, y, z)
        ),
        capacityClass,
        blood: opt.blood,
      });
    }
  }

  updateSimParticles(dt: number): void {
    const drag = Math.pow(0.045, dt);
    const zDrag = Math.pow(0.18, dt);
    let bloodDirty = false;
    let w = 0;
    const simParticles = this.simParticles;
    for (let i = 0; i < simParticles.length; i++) {
      const s = simParticles[i]!;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.z += s.vz * dt;
      if (!s.shock) {
        s.vz -= Z_GRAVITY * dt;
      }
      if (s.dart && s.ox != null && s.oy != null && s.swirl != null) {
        const dx = s.x - s.ox;
        const dy = s.y - s.oy;
        const r = Math.hypot(dx, dy) || 1;
        const edge = Phaser.Math.Clamp((r - 42) / 120, 0, 1);
        s.vx *= Math.pow(0.62, dt);
        s.vy *= Math.pow(0.62, dt);
        s.vx *= Math.pow(0.08, dt * edge);
        s.vy *= Math.pow(0.08, dt * edge);
        const tx = -dy / r;
        const ty = dx / r;
        const swirl = s.swirl * (0.18 + edge * 1.85);
        s.vx += tx * swirl * dt;
        s.vy += ty * swirl * dt;
        s.vz *= Math.pow(0.4, dt);
      } else if (s.shock) {
        s.vx *= Math.pow(0.64, dt);
        s.vy *= Math.pow(0.64, dt);
        s.vy += 165 * dt;
        s.vz -= Z_GRAVITY * 0.42 * dt;
      } else if (s.dart) {
        s.vx *= Math.pow(0.72, dt);
        s.vy *= Math.pow(0.72, dt);
        s.vz *= Math.pow(0.55, dt);
      } else {
        s.vx *= drag;
        s.vy *= drag;
        s.vz *= zDrag;
      }
      s.life -= dt;
      const g = groundZ(this.s.world, s.x, s.y);
      if (s.z < g) {
        s.z = g;
        if (s.shock) {
          if (s.vz < 0) s.vz = 0;
        } else if (s.dart) {
          s.vz = Math.max(2, -s.vz * 0.12);
        } else if (s.bounces > 0 && s.vz < -30) {
          s.bounces--;
          s.vz = -s.vz * 0.18;
          const spd = Math.hypot(s.vx, s.vy);
          const jit = range(-spd * 0.25, spd * 0.25);
          s.vx = (s.vx + jit) * 0.55;
          s.vy = (s.vy + range(-spd * 0.25, spd * 0.25)) * 0.55;
        } else {
          s.vz = 0;
          s.vx *= 0.35;
          s.vy *= 0.35;
          s.life = Math.min(s.life, 0.22);
        }
      }
      if (s.blood && !s.stamped && s.life / s.max <= 0.5) {
        s.stamped = true;
        this.s.groundMarks.stampBloodWorld(s);
        bloodDirty = true;
      }
      if (s.life > 0) simParticles[w++] = s;
    }
    simParticles.length = w;
    if (bloodDirty && this.s.textures.exists("map_terrain")) {
      (this.s.textures.get("map_terrain") as Phaser.Textures.CanvasTexture).refresh();
    }
    if (this.s.perf.enabled) {
      const t = performance.now();
      this.syncSimParticleSprites();
      this.s.perf.current![10] = performance.now() - t;
    } else {
      this.syncSimParticleSprites();
    }
  }

  syncSimParticleSprites(): void {
    while (this.simParticleG.getLength() < this.simParticles.length) {
      this.simParticleG.add(this.s.add.image(0, 0, "fx_spark").setScale(0.7));
    }
    const kids = this.simParticleG.getChildren() as Phaser.GameObjects.Image[];
    for (const k of kids) k.setVisible(false);
    this.simParticles.forEach((s, i) => {
      if (!cameraPointVisible(s.z, s.y)) return;
      const im = kids[i]!;
      const fade = Phaser.Math.Clamp(s.life / s.max, 0, 1);
      const age = 1 - fade;
      const spd = Math.hypot(s.vx, s.vy, s.vz);
      const dart = !!s.dart;
      const shock = !!s.shock;
      const orb = !!s.orb;
      const grow = 1 - Math.pow(1 - age, 3.4);
      const edge =
        dart && s.ox != null && s.oy != null
          ? Phaser.Math.Clamp((Math.hypot(s.x - s.ox, s.y - s.oy) - 40) / 110, 0, 1)
          : 0;
      const round = dart ? Math.max(edge, Phaser.Math.Clamp(1 - spd / 220, 0, 1)) : 0;
      const stretch = orb
        ? 1
        : shock
          ? Math.min(3.2, 1 + spd * 0.0032)
          : 1 + spd * (dart ? 0.0052 : 0.0048);
      const thick = orb
        ? s.scale * (0.85 + 0.35 * fade)
        : shock
        ? s.scale * (1.05 + 0.95 * age)
        : dart
        ? s.scale * (0.78 + 0.28 * fade + 0.72 * round)
        : s.scale * (0.06 + 3.6 * grow);
      const scrX = screenVelX(s.vx, s.vy, s.vz, s.x, s.y, s.z);
      const scrY = screenVelY(s.vy, s.vz, s.z, s.y);
      const heading = Math.atan2(scrY, scrX);
      const rot = orb
        ? s.heading + age * s.spin
        : shock
        ? s.heading
        : dart
        ? heading + s.angJit * 0.08 + age * s.spin * (0.22 + round * 1.05)
        : s.heading + s.angJit * 0.14;
      const sx = orb
        ? thick
        : shock
        ? thick * stretch
        : dart
        ? thick * (stretch * 1.28 * (1 - round) + (1.12 + 0.38 * grow) * round)
        : thick * (0.85 + 0.55 * grow);
      const late = Math.pow(Phaser.Math.Clamp((age - 0.52) / 0.48, 0, 1), 1.7);
      const sy = orb
        ? thick
        : shock
        ? thick * (0.48 + 0.7 * age)
        : dart
        ? thick * ((0.58 + 0.16 / Math.max(stretch, 1)) * (1 - round) + (1.08 + 0.28 * grow) * round)
        : thick * (0.28 + 0.42 * late);
      const baseA = s.additive ? 0.45 + fade * 0.55 : 0.55 + fade * 0.4;
      const alpha = s.blood
        ? 0.35 + fade * 0.65
        : orb
          ? 0.55 + 0.45 * Math.pow(fade, 0.45)
        : shock
          ? (0.38 + 0.58 * Math.pow(fade, 0.55)) * Math.min(1, fade * 3)
          : dart
            ? (0.16 + 0.2 * fade) * (1 - round * 0.25) * Math.min(1, fade * 3)
            : baseA * (0.35 + 0.65 * fade);
      const at = worldToScreen(s.x, s.y, s.z);
      const zs = at.scale;
      const depth = worldDepth(s.z, 0.3, s.y);
      im.setVisible(true);
      if (im.texture.key !== s.tex || im.frame.name !== String(s.frame)) im.setTexture(s.tex, s.frame);
      im.setOrigin(orb ? 0.5 : dart ? 0.12 + 0.38 * round : 0.12, 0.5)
        .setPosition(at.x, at.y)
        .setRotation(rot)
        .setScale(sx * zs, sy * zs)
        .setBlendMode(
          s.blood ? Phaser.BlendModes.NORMAL : s.additive ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL
        )
        .setAlpha(alpha);
      if (im.depth !== depth) im.setDepth(depth);
      if (this.s.thermal.on) {
        // Dirt/dust: medium heat so scars aren't masked black. Blood: hotter live spray.
        applyThermalHeat(im, true, s.blood ? 0.72 : 0.42);
      } else if (s.blood || s.mist) {
        im.setTintFill(s.tint);
      } else {
        im.clearTint();
        im.setTint(s.tint);
      }
    });
  }

  stampCannonScar(x: number, y: number, dx: number, dy: number, dz: number): void {
    const incoming = Math.hypot(dx, dy, dz) || 1;
    const slope = groundSlope(this.s.world, x, y);
    const nx = -slope.dx;
    const ny = -slope.dy;
    const nz = 1;
    const nlen = Math.hypot(nx, ny, nz) || 1;
    const ndot = Math.abs((nx * dx + ny * dy + nz * dz) / (nlen * incoming));
    const graze = Phaser.Math.Clamp(1 - ndot, 0, 1);
    const horiz = Math.hypot(dx, dy);
    const ang =
      horiz > 2 ? Math.atan2(dy, dx) : Math.hypot(slope.dx, slope.dy) > 0.002 ? Math.atan2(slope.dy, slope.dx) : 0;
    const j = Phaser.Math.Linear(5, 14, graze);
    const px = x + range(-j * 0.5, j * 0.5);
    const py = y + range(-j * 0.5, j * 0.5);
    const key = `fx_blast_${(Math.random() * 4) | 0}`;
    const base = range(0.12, 0.23);
    const stretch = graze * graze * range(0.75, 1.25);
    const sx = base * Phaser.Math.Linear(1, 2.55, stretch) * range(0.82, 1.18);
    const sy = base * Phaser.Math.Linear(1, 0.36, graze) * range(0.82, 1.18);
    const alpha = Phaser.Math.Linear(0.72, 0.22, graze) * range(0.78, 1.06);
    const scarKey = this.s.textures.exists(key) ? key : "fx_blast_0";
    // Wreck stamp stays subtle; thermal overlay is separate at readable scale (instant full heat).
    this.s.groundMarks.stampWreck(scarKey, px, py, ang, sx, alpha, 0.5, 0.5, sy, undefined, undefined, false);
    this.s.groundMarks.addThermalWreckMark(scarKey, px, py, ang, sx, sy, 0.5, 0.5, undefined, "scar");
  }

  heFireBurst(
    x: number,
    y: number,
    z: number,
    dx: number,
    dy: number,
    dz: number,
    blast: number,
    soft = false,
    waveMul = 1,
    size01 = Phaser.Math.Clamp(blast / 140, 0.18, 1),
    /** Extra eject power from unit/shot influence (1 = baseline). */
    power = 1,
    /** World-space target radius; zero means this blast has no destruction ring. */
    targetRadius = 0,
    /** When set, spray particles/debris from random points inside this body. */
    body?: Footprint,
    look?: {
      spark?: Phaser.GameObjects.Particles.ParticleEmitter;
      flash?: number;
      /** Flash diameter floor in px. Default 120. */
      flashMin?: number;
      /** Scales fireball / streak density. */
      visMul?: number;
      /** Skip invisible HE blast-trail frags. */
      noTrails?: boolean;
    }
  ): void {
    const at = worldToScreen(x, y, z);
    const blastX = at.x;
    const blastY = at.y;
    const blastScale = at.scale;
    const vis = look?.visMul ?? 1;
    const p = Phaser.Math.Clamp(power, 0.5, 2.4);
    const t = Math.min(1, (p - 0.5) / 1.9);
    const spdBoost = Phaser.Math.Linear(0.95, 1.35, t);
    const biasLen = Math.hypot(dx, dy, dz);
    const expK = soft ? undefined : biasLen > 40 ? Phaser.Math.Linear(1.85, 2.7, t) : 1.5;
    const bodyR =
      body == null
        ? 0
        : body.shape === "circle"
          ? body.r
          : Math.hypot(body.halfL, body.halfW);
    // Keep particle origins inside the body; small inset vs debris chunks.
    const particleInset = body ? Math.min(bodyR * 0.22, 10) : 0;
    // Soft gradient bloom — sized to read through the fireball (Hydra blast 140 → ~170px+).
    this.spawnImpactFlash(
      blastX,
      blastY,
      z,
      look?.flash ?? 0xfff4c8,
      Math.max(look?.flashMin ?? 120, blast * (soft ? 0.55 : 1.2) * waveMul) * blastScale,
      1,
      280
    );
    // A handful of long, fast streaks that brake and vanish quickly.
    const streakN = Math.max(
      vis < 1 ? 1 : soft ? 2 : 4,
      Math.round((soft ? 4.5 : 10) * Phaser.Math.Linear(0.55, 1.15, size01) * vis)
    );
    this.emitScatteredBurst(
      body,
      particleInset,
      x,
      y,
      z + 8,
      streakN,
      {
        spdMin: (soft ? 820 : 1280) * spdBoost,
        spdMax: (soft ? 1500 : 2600) * spdBoost,
        bx: dx,
        by: dy,
        bz: dz,
        tight: soft ? 0.22 : Phaser.Math.Linear(0.38, 0.58, t),
        scaleMul: Phaser.Math.Linear(1.35, 2.2, size01) * (soft ? 0.75 : 1),
        expBias: expK,
      },
      look?.spark ?? this.streakBurst
    );
    if (!look?.noTrails) {
      this.s.trails.spawnBlastTrails(x, y, z, dx, dy, dz, soft, size01, p, body, particleInset);
    }
    if (targetRadius > 0) this.s.projectiles.spawnBlastRing(x, y, z, targetRadius);
  }

  /** Emit a visual burst from one point, or scatter across a body footprint. */
  emitScatteredBurst(
    body: Footprint | undefined,
    inset: number,
    x: number,
    y: number,
    z: number,
    n: number,
    opt: {
      spdMin: number;
      spdMax: number;
      bx: number;
      by: number;
      bz: number;
      tight: number;
      scaleMul?: number;
      stretchMul?: number;
      expBias?: number;
      gravity?: number;
      coneHalf?: number;
      depthOff?: number;
    },
    emitter: Phaser.GameObjects.Particles.ParticleEmitter,
    kind: FxClass = "short"
  ): void {
    if (!body || n <= 1) {
      this.emitVisualBurst(x, y, z, { ...opt, n }, emitter, kind);
      return;
    }
    let left = n;
    while (left > 0) {
      const batch = Math.min(left, 1 + ((Math.random() * 2) | 0));
      const o = randomInFootprint(body, inset);
      this.emitVisualBurst(o.x, o.y, z, { ...opt, n: batch }, emitter, kind);
      left -= batch;
    }
  }

  crashDmgFlames(
    sites: { u: number; v: number; scale: number }[] | undefined,
    hulkKey: string,
    fallbackRadius: number
  ): { u: number; v: number; scale: number }[] {
    if (!sites?.length) {
      const n = 1 + ((Math.random() * 2) | 0);
      return Array.from({ length: n }, () => {
        const uv = this.s.unitSprites.sampleSolidUv(hulkKey, fallbackRadius);
        return { u: uv.u, v: uv.v, scale: range(0.42, 0.8) };
      });
    }
    return sites.map((s) => {
      const uv = this.s.unitSprites.solidAtUv(hulkKey, s.u, s.v)
        ? s
        : this.s.unitSprites.sampleSolidUv(hulkKey, fallbackRadius);
      return { u: uv.u, v: uv.v, scale: s.scale };
    });
  }

  emitHeliCrashDmgFlames(): void {
    for (const f of this.s.debris) {
      if (!f.heliCrash) continue;
      if (f.settled) {
        if ((f.simmer ?? 0) <= 0) continue;
        this.emitDebrisDmgFlames(f, Phaser.Math.Clamp(f.simmer! / 3.2, 0, 1));
      } else {
        this.emitDebrisDmgFlames(f, 1);
      }
    }
  }

  emitDebrisDmgFlames(f: Debris, dim: number): void {
    if (!f.dmgFlames?.length || dim <= 0.02) return;
    const pivot = spritePivot(f.key);
    const src = this.s.textures.exists(f.key)
      ? (this.s.textures.get(f.key).getSourceImage() as { width: number; height: number })
      : { width: 64, height: 64 };
    const at = worldToScreen(f.x, f.y, f.z);
    const zs = at.scale;
    const sc = (f.scale ?? 1) * zs;
    const spr = {
      x: at.x,
      y: at.y,
      rotation: f.angle,
      displayWidth: src.width * sc,
      displayHeight: src.height * sc,
      originX: pivot.x,
      originY: pivot.y,
    };
    const { fire, smoke } = this.pairHurt(f.z, f.y, this.flame, this.hurtSmoke);
    const airMul = f.heliCrash ? 1.65 : 1;
    for (const s of f.dmgFlames) {
      const p = spriteUvPos(spr, s.u, s.v);
      this.withDmgFlameScale(s.scale * dim * airMul, () => {
        const nFire = this.emitCount(0.72 * dim);
        const nSmoke = this.emitCount(0.35 * dim);
        if (nFire) this.emitBudgeted("fire", fire, p.x, p.y, nFire * 2);
        if (nSmoke) this.emitBudgeted("smoke", smoke, p.x, p.y, nSmoke);
      });
    }
  }

  register(kind: FxClass, ...emitters: Phaser.GameObjects.Particles.ParticleEmitter[]): void {
    for (const emitter of emitters) this.policies[kind].emitters.add(emitter);
  }

  /** Clone an emitter across painter-depth bands so concurrent trails don't thrash one depth. */
  pool(
    kind: FxClass,
    make: () => Phaser.GameObjects.Particles.ParticleEmitter
  ): Phaser.GameObjects.Particles.ParticleEmitter {
    const slots: Phaser.GameObjects.Particles.ParticleEmitter[] = [];
    for (let i = 0; i < this.slotN; i++) {
      const em = make();
      em.setDepth(Layer.WORLD);
      slots.push(em);
    }
    this.slots.set(slots[0]!, slots);
    this.register(kind, ...slots);
    return slots[0]!;
  }

  band(z: number, y: number): number {
    const cameraDepth = worldDepth(z, 0, y) - Layer.WORLD;
    const center = (this.slotN - 1) * 0.5;
    return Phaser.Math.Clamp(Math.round(cameraDepth / this.bandH + center), 0, this.slotN - 1);
  }

  bandDepth(band: number, off: number): number {
    const center = (this.slotN - 1) * 0.5;
    return Layer.WORLD + (band - center) * this.bandH + off;
  }

  slot(
    proto: Phaser.GameObjects.Particles.ParticleEmitter,
    z: number,
    y: number
  ): { emitter: Phaser.GameObjects.Particles.ParticleEmitter; band: number } {
    const slots = this.slots.get(proto);
    const band = this.band(z, y);
    return { emitter: slots ? slots[band]! : proto, band };
  }

  at(
    z: number,
    y: number,
    proto: Phaser.GameObjects.Particles.ParticleEmitter,
    off: number
  ): Phaser.GameObjects.Particles.ParticleEmitter {
    this.smokeMatchFire = 0;
    const slot = this.slot(proto, z, y);
    const em = slot.emitter;
    const d = this.bandDepth(slot.band, off);
    if (em.depth !== d) em.setDepth(d);
    return em;
  }

  /** Same slot pooling as fxAt, but depth matches hull sprites (worldDepth), not FX bands. */
  atWorld(
    z: number,
    y: number,
    proto: Phaser.GameObjects.Particles.ParticleEmitter,
    off: number
  ): Phaser.GameObjects.Particles.ParticleEmitter {
    this.smokeMatchFire = 0;
    const em = this.slot(proto, z, y).emitter;
    const d = worldDepth(z, off, y);
    if (em.depth !== d) em.setDepth(d);
    return em;
  }

  /**
   * Hurt fire + smoke on the same world-depth stack as hull sprites:
   * body (0 / +posted) < smoke < fire < rotor. No FX-band rounding.
   */
  pairHurt(
    z: number,
    y: number,
    fireProto: Phaser.GameObjects.Particles.ParticleEmitter,
    smokeProto: Phaser.GameObjects.Particles.ParticleEmitter,
    zBias = 0
  ): { fire: Phaser.GameObjects.Particles.ParticleEmitter; smoke: Phaser.GameObjects.Particles.ParticleEmitter } {
    const pair = {
      fire: this.atWorld(z, y, fireProto, ZOff.dmg + zBias),
      smoke: this.atWorld(z, y, smokeProto, ZOff.hurtSmoke + zBias),
    };
    this.smokeMatchFire = this.fireMeanScale(fireProto);
    return pair;
  }

  /** Mean emit scale of a fire emitter's base size range (fx_flame units). */
  private fireMeanScale(proto: Phaser.GameObjects.Particles.ParticleEmitter): number {
    if (proto === this.burn) return 1.12;
    if (proto === this.lingerBurn) return 0.45;
    if (proto === this.tinyBurn) return 0.2;
    if (proto === this.flame || proto === this.hotFlame) return 0.46;
    return 0;
  }

  /**
   * Pick the camera-depth-band fire/smoke pair and pin both depths to that band so this
   * trail stays projectile → smoke → flame. Other bands can still interleave.
   */
  pair(
    z: number,
    y: number,
    fireProto: Phaser.GameObjects.Particles.ParticleEmitter,
    smokeProto: Phaser.GameObjects.Particles.ParticleEmitter,
    fireOff: number = ZOff.fire,
    smokeOff: number = ZOff.smoke
  ): { fire: Phaser.GameObjects.Particles.ParticleEmitter; smoke: Phaser.GameObjects.Particles.ParticleEmitter } {
    const fireSlot = this.slot(fireProto, z, y);
    const smokeSlot = this.slot(smokeProto, z, y);
    const fire = fireSlot.emitter;
    const smoke = smokeSlot.emitter;
    const sOff = Math.min(smokeOff, fireOff - 1.25);
    const fOff = Math.max(fireOff, sOff + 1.25);
    const sd = this.bandDepth(smokeSlot.band, sOff);
    // Lift flame one band so smoke left in the neighbouring band (trail crossing bands) stays under it.
    const fd = this.bandDepth(fireSlot.band, fOff) + this.bandH;
    if (smoke.depth !== sd) smoke.setDepth(sd);
    if (fire.depth !== fd) fire.setDepth(fd);
    this.smokeMatchFire = this.fireMeanScale(fireProto);
    return { fire, smoke };
  }

  alive(kind: FxClass): number {
    let alive = 0;
    for (const emitter of this.policies[kind].emitters) alive += emitter.getAliveParticleCount();
    return alive;
  }

  /** Emit under independent semantic per-frame and global-active policies. */
  emitBudgeted(
    kind: FxClass,
    em: Phaser.GameObjects.Particles.ParticleEmitter,
    x: number,
    y: number,
    n: number,
    /** Impact bursts: don't let lingering trail particles starve the new fireball. */
    prefer = false,
    /** Spawn across a disc of this radius (screen px) instead of one point — gives flames width. */
    area = 0
  ): number {
    const policy = this.policies[kind];
    if (n <= 0 || policy.emitted >= policy.frameCap) return 0;
    const activeRoom = prefer
      ? Math.max(n, policy.activeCap - this.alive(kind))
      : policy.activeCap - this.alive(kind);
    const take = Math.min(n, policy.frameCap - policy.emitted, Math.max(0, activeRoom));
    if (take <= 0) return 0;
    policy.emitted += take;
    const scale = this.s.lastSimScale;
    if (em.timeScale !== (Number.isFinite(scale) ? scale : 1)) {
      em.timeScale = Number.isFinite(scale) ? scale : 1;
    }
    if (area > 0) {
      for (let i = 0; i < take; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * area;
        em.emitParticleAt(x + Math.cos(a) * r, y + Math.sin(a) * r, 1);
      }
    } else em.emitParticleAt(x, y, take);
    return take;
  }

  /**
   * Continuous FX rate → particle count, scaled by sim timeScale so slow-mo
   * spawns fewer particles per wall frame (same count per sim-second).
   */
  emitCount(ratePerFrameAt1x: number): number {
    const s = this.s.lastSimScale;
    if (!Number.isFinite(s) || s <= 0 || ratePerFrameAt1x <= 0) return 0;
    const expected = ratePerFrameAt1x * s;
    let n = Math.floor(expected);
    if (Math.random() < expected - n) n++;
    return n;
  }

  /** Bernoulli form of fxEmitCount for the common single-particle trail case. */
  chance(p: number): boolean {
    return this.emitCount(p) > 0;
  }

  withTrail(scale: number, fn: () => void, lifeMul = 1): void {
    const prev = this.trailFxScale;
    const prevLife = this.trailFxLife;
    const prevDmg = this.dmgFlameScale;
    this.trailFxScale = scale;
    this.trailFxLife = lifeMul;
    // Trails must not inherit leftover hull-damage flame scale.
    this.dmgFlameScale = 1;
    try {
      fn();
    } finally {
      this.trailFxScale = prev;
      this.trailFxLife = prevLife;
      this.dmgFlameScale = prevDmg;
    }
  }

  withDmgFlameScale(scale: number, fn: () => void): void {
    const prev = this.dmgFlameScale;
    this.dmgFlameScale = scale;
    try {
      fn();
    } finally {
      this.dmgFlameScale = prev;
    }
  }

  emitDamageFx(): void {
    const h = this.s.player;
    this.emitUnitDamageFx();
    this.s.remoteBody.emitRemoteDamageFx();
    const hp = h.health / h.spec.health;
    if (h.phase !== "dead" && hp < 0.98) {
      const want = hp < 0.25 ? 3 : hp < 0.45 ? 2 : hp < 0.75 ? 1 : 0;
      while (h.dmgSites.length > want) h.dmgSites.pop();
      while (h.dmgSites.length < want) {
        const uv = this.s.unitSprites.sampleSolidUv(h.spec.body, h.spec.radius);
        h.dmgSites.push({ ...uv, scale: range(0.42, 0.8) });
      }
      if (want) {
        const { fire, smoke } = this.pairHurt(h.z, h.y, this.hotFlame, this.playerHurtSmoke);
        for (const s of h.dmgSites) {
          const base = spriteUvPos(this.s.hostCraft.bodyDrawPose(), s.u, s.v);
          // Small disc on the damage pin: width without loose spray.
          const area = DMG_FIRE_AREA * s.scale * 1.65;
          this.withDmgFlameScale(s.scale * 1.65, () => {
            const nFire = this.emitCount(0.48 * flameDensityMul(s.scale * 1.65));
            const nSmoke = this.emitCount(0.42);
            if (nFire) this.emitBudgeted("fire", fire, base.x, base.y, nFire, false, area);
            if (nSmoke) this.emitBudgeted("smoke", smoke, base.x, base.y, nSmoke, false, area);
          });
        }
      }
    } else if (h.phase !== "dead") {
      h.dmgSites.length = 0;
    }
  }

  emitUnitDamageFx(): void {
    const view = this.s.cameras.main.worldView;
    const pad = 120;
    for (const u of this.s.units) {
      if (u.dead || isOrganic(u.kind)) continue;
      if (!cameraPointVisible(u.z, u.y)) continue;
      const ratio = u.health / Math.max(u.max, 1);
      const want = ratio < 0.25 ? 3 : ratio < 0.45 ? 2 : ratio < 0.75 ? 1 : 0;
      if (!u.dmgSites) u.dmgSites = [];
      if (!want) {
        if (u.dmgSites.length) u.dmgSites.length = 0;
        continue;
      }
      const at = worldToScreen(u.x, u.y, u.z);
      if (
        at.x < view.x - pad ||
        at.x > view.right + pad ||
        at.y < view.y - pad ||
        at.y > view.bottom + pad
      )
        continue;
      const tex = resolveSkin(this.s.textures, textureOf(u.kind), u.camo);
      while (u.dmgSites.length > want) u.dmgSites.pop();
      while (u.dmgSites.length < want) {
        const uv = this.s.unitSprites.sampleSolidUv(tex, radius(u.kind));
        u.dmgSites.push({ ...uv, scale: range(0.38, 0.75) });
      }
      const zBias = u.pinId != null ? ZOff.posted : 0;
      const { fire, smoke } = this.pairHurt(u.z, u.y, this.flame, this.hurtSmoke, zBias);
      const sp = specOf(u.kind);
      const sizeMul = sp.aerial ? 1.65 : sp.building ? 1.15 : 1;
      for (const s of u.dmgSites) {
        const mount = mountAt(this.s.textures, u, tex, { x: s.u, y: s.v });
        const base = worldToScreen(mount.x, mount.y, u.z);
        const area = DMG_FIRE_AREA * s.scale * sizeMul;
        this.withDmgFlameScale(s.scale * sizeMul, () => {
          const nFire = this.emitCount(0.45 * flameDensityMul(s.scale * sizeMul));
          const nSmoke = this.emitCount(0.4);
          if (nFire) this.emitBudgeted("fire", fire, base.x, base.y, nFire, false, area);
          if (nSmoke) this.emitBudgeted("smoke", smoke, base.x, base.y, nSmoke, false, area);
        });
      }
    }
  }
}
