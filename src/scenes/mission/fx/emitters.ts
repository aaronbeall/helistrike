import Phaser from "phaser";
import { FX_SHEET_SIZE } from "../art/sprites";
import { craftExhaustFlameSheet } from "../sim/crafts";
import { range } from "../util/rng";
import { Layer } from "./depth";
import type { BurstParticle, MissionScene } from "../scenes/missionScene";

/** Build + register the mission's pooled particle emitters (configs read live scene FX state). */
export function createFxEmitters(scene: MissionScene): void {
  const craft = scene.player.spec;
  const fxFrames = { frames: [0, 1, 2, 3], cycle: false as const };
  const fxSpin = { min: -80, max: 80 };
  scene.smoke = scene.add.particles(0, 0, "fx_smoke", {
    lifespan: 900,
    speed: { min: 10, max: 70 },
    scale: { start: 0.6, end: 2.4 },
    alpha: { start: 0.55, end: 0 },
    gravityY: -28,
    emitting: false,
    frame: fxFrames,
    rotate: fxSpin,
  });
  scene.smoke.setDepth(Layer.WORLD);
  scene.registerFx("smoke", scene.smoke);
  const seedBurst = (p: Phaser.GameObjects.Particles.Particle | undefined, min: number, max: number): number => {
    scene.sampleBurstScreenVelocity(p as BurstParticle | undefined);
    return range(min, max);
  };
  const burstVelocityX = (p?: Phaser.GameObjects.Particles.Particle): number =>
    (p as BurstParticle | undefined)?.burstVx ?? scene.sampleBurstScreenVelocity(p as BurstParticle | undefined).x;
  const burstVelocityY = (p?: Phaser.GameObjects.Particles.Particle): number =>
    (p as BurstParticle | undefined)?.burstVy ?? scene.sampleBurstScreenVelocity(p as BurstParticle | undefined).y;
  const burstRotation = (p?: Phaser.GameObjects.Particles.Particle): number =>
    Phaser.Math.RadToDeg((p as BurstParticle | undefined)?.burstHeading ?? 0);
  const burstStretchOf = (p: BurstParticle): number => {
    const spd = Math.hypot(p.velocityX || p.burstVx || 0, p.velocityY || p.burstVy || 0);
    const raw = Math.min(3.8, 1 + spd * 0.0052);
    const mul = scene.burstLaunch.stretchMul;
    return 1 + (raw - 1) * mul;
  };
  scene.shortBurst = scene.poolFx("short", () =>
    scene.add.particles(0, 0, "fx_spark", {
      lifespan: { onEmit: (p) => seedBurst(p, 220, 640) },
      speedX: { onEmit: burstVelocityX },
      speedY: { onEmit: burstVelocityY },
      scaleX: {
        onEmit: (p) => {
          const q = p as BurstParticle;
          q.launchScale = scene.burstLaunch.scale * range(0.72, 1.18);
          q.launchStretch = burstStretchOf(q);
          return q.launchScale * q.launchStretch * range(1.2, 1.55);
        },
        onUpdate: (p, _k, t) => {
          const q = p as BurstParticle;
          return (q.launchScale ?? 1) * burstStretchOf(q) * (1 - t);
        },
      },
      scaleY: {
        onEmit: (p) => {
          const q = p as BurstParticle;
          const stretch = q.launchStretch ?? burstStretchOf(q);
          return (q.launchScale ?? scene.burstLaunch.scale) * (0.36 / Math.max(0.55, Math.sqrt(stretch)));
        },
        onUpdate: (p, _k, t) => {
          const q = p as BurstParticle;
          const stretch = burstStretchOf(q);
          return (q.launchScale ?? 1) * (0.36 / Math.max(0.55, Math.sqrt(stretch))) * (1 - t);
        },
      },
      alpha: { start: 1, end: 0 },
      blendMode: "ADD",
      tint: [0xfff8d0, 0xffee66, 0xffaa40],
      gravityY: 180,
      radial: false,
      emitting: false,
      frame: fxFrames,
      rotate: {
        onEmit: burstRotation,
        onUpdate: (p) => Phaser.Math.RadToDeg(Math.atan2(p.velocityY, p.velocityX)),
      },
    })
  );
  const streakStretchOf = (p: BurstParticle): number => {
    const spd = Math.hypot(p.velocityX || p.burstVx || 0, p.velocityY || p.burstVy || 0);
    return Math.min(5.5, 1.4 + spd * 0.0028);
  };
  scene.streakBurst = scene.poolFx("short", () =>
    scene.add.particles(0, 0, "fx_spark", {
      // Long enough to travel before brake + fade finish them.
      lifespan: { onEmit: (p) => seedBurst(p, 320, 520) },
      speedX: { onEmit: burstVelocityX },
      speedY: { onEmit: burstVelocityY },
      scaleX: {
        onEmit: (p) => {
          const q = p as BurstParticle;
          q.launchScale = scene.burstLaunch.scale * range(1.35, 2.1);
          q.launchStretch = streakStretchOf(q);
          return q.launchScale * q.launchStretch * range(0.7, 1.05);
        },
        onUpdate: (p, _k, t) => {
          const q = p as BurstParticle;
          // Hold length early, then taper as they slow.
          const fade = Math.pow(1 - t, 1.15);
          return (q.launchScale ?? 1) * streakStretchOf(q) * fade;
        },
      },
      scaleY: {
        onEmit: (p) => {
          const q = p as BurstParticle;
          const stretch = q.launchStretch ?? streakStretchOf(q);
          return (q.launchScale ?? scene.burstLaunch.scale) * (0.28 / Math.max(0.7, Math.sqrt(stretch)));
        },
        onUpdate: (p, _k, t) => {
          const q = p as BurstParticle;
          const stretch = streakStretchOf(q);
          return (q.launchScale ?? 1) * (0.28 / Math.max(0.7, Math.sqrt(stretch))) * Math.pow(1 - t, 1.1);
        },
      },
      alpha: {
        start: 1,
        end: 0,
        ease: "Quad.easeIn",
      },
      blendMode: "ADD",
      tint: [0xffffff, 0xfff4c0, 0xffd060],
      // Same idea as shortBurst gravityY — soft screen-down drift, not a re-aimed cone.
      gravityY: 160,
      // Milder brake so they actually coast outward before dying.
      accelerationX: { onUpdate: (p) => -p.velocityX * 3.2 },
      accelerationY: { onUpdate: (p) => -p.velocityY * 3.2 },
      radial: false,
      emitting: false,
      frame: fxFrames,
      rotate: {
        // Hold launch heading so gravity drifts them without tipping the streak.
        onEmit: burstRotation,
        onUpdate: (p) => Phaser.Math.RadToDeg((p as BurstParticle).burstHeading ?? Math.atan2(p.velocityY, p.velocityX)),
      },
    })
  );
  // Reactive armor spark burst: streakBurst's big stretched-streak shape, signal-flare red/pink tint.
  scene.reactiveArmorSpark = scene.poolFx("short", () =>
    scene.add.particles(0, 0, "fx_spark", {
      lifespan: { onEmit: (p) => seedBurst(p, 320, 520) },
      speedX: { onEmit: burstVelocityX },
      speedY: { onEmit: burstVelocityY },
      scaleX: {
        onEmit: (p) => {
          const q = p as BurstParticle;
          q.launchScale = scene.burstLaunch.scale * range(1.35, 2.1);
          q.launchStretch = streakStretchOf(q);
          const sx = q.launchScale * q.launchStretch * range(0.7, 1.05);
          // Center-origin streak: nudge forward by half length so the tail doesn't spawn over the hull.
          const halfLen = FX_SHEET_SIZE.spark * sx * 0.5;
          const heading = q.burstHeading ?? Math.atan2(q.burstVy ?? 0, q.burstVx ?? 1);
          q.x += Math.cos(heading) * halfLen;
          q.y += Math.sin(heading) * halfLen;
          return sx;
        },
        onUpdate: (p, _k, t) => {
          const q = p as BurstParticle;
          const fade = Math.pow(1 - t, 1.15);
          return (q.launchScale ?? 1) * streakStretchOf(q) * fade;
        },
      },
      scaleY: {
        onEmit: (p) => {
          const q = p as BurstParticle;
          const stretch = q.launchStretch ?? streakStretchOf(q);
          return (q.launchScale ?? scene.burstLaunch.scale) * (0.28 / Math.max(0.7, Math.sqrt(stretch)));
        },
        onUpdate: (p, _k, t) => {
          const q = p as BurstParticle;
          const stretch = streakStretchOf(q);
          return (q.launchScale ?? 1) * (0.28 / Math.max(0.7, Math.sqrt(stretch))) * Math.pow(1 - t, 1.1);
        },
      },
      alpha: { start: 1, end: 0, ease: "Quad.easeIn" },
      blendMode: "ADD",
      tint: [0xffffff, 0xff90b0, 0xff2858, 0xc01030],
      gravityY: 160,
      accelerationX: { onUpdate: (p) => -p.velocityX * 3.2 },
      accelerationY: { onUpdate: (p) => -p.velocityY * 3.2 },
      radial: false,
      emitting: false,
      frame: fxFrames,
      rotate: {
        onEmit: burstRotation,
        onUpdate: (p) => Phaser.Math.RadToDeg((p as BurstParticle).burstHeading ?? Math.atan2(p.velocityY, p.velocityX)),
      },
    })
  );
  scene.bigBoomSparkBurst = scene.poolFx("short", () =>
    scene.add.particles(0, 0, "fx_spark", {
      // Long hang so coast + gravity arc reads.
      lifespan: { onEmit: (p) => seedBurst(p, 1600, 2600) },
      speedX: { onEmit: burstVelocityX },
      speedY: { onEmit: burstVelocityY },
      scaleX: {
        onEmit: (p) => {
          const q = p as BurstParticle;
          q.launchScale = scene.burstLaunch.scale * range(1.05, 1.5);
          q.launchStretch = range(2.4, 3.6) * scene.burstLaunch.stretchMul;
          q.launchSpd = Math.max(40, Math.hypot(q.burstVx ?? 0, q.burstVy ?? 0));
          return q.launchScale * q.launchStretch;
        },
        onUpdate: (p, _k, t) => {
          const q = p as BurstParticle;
          const spd = Math.hypot(p.velocityX, p.velocityY);
          const slow = Phaser.Math.Clamp(spd / (q.launchSpd ?? 1), 0.12, 1);
          // Shrink with speed; mild life taper at the end.
          return (q.launchScale ?? 1) * (q.launchStretch ?? 1) * slow * Math.pow(1 - t, 0.35);
        },
      },
      scaleY: {
        onEmit: (p) => {
          const q = p as BurstParticle;
          q.launchThick = range(0.4, 0.58);
          return (q.launchScale ?? scene.burstLaunch.scale) * q.launchThick;
        },
        onUpdate: (p, _k, t) => {
          const q = p as BurstParticle;
          const spd = Math.hypot(p.velocityX, p.velocityY);
          const slow = Phaser.Math.Clamp(spd / (q.launchSpd ?? 1), 0.15, 1);
          return (q.launchScale ?? 1) * (q.launchThick ?? 1) * slow * Math.pow(1 - t, 0.35);
        },
      },
      alpha: { start: 1, end: 0, ease: "Quad.easeIn" },
      blendMode: "ADD",
      tint: [0xffffff, 0xfff2b0, 0xffc050, 0xff7820],
      // Soft drag so they reach distance then settle; gravity arcs them down.
      gravityY: 200,
      accelerationX: { onUpdate: (p) => -p.velocityX * 1.15 },
      accelerationY: { onUpdate: (p) => -p.velocityY * 0.85 },
      radial: false,
      emitting: false,
      frame: fxFrames,
      rotate: {
        onEmit: burstRotation,
        onUpdate: (p) => Phaser.Math.RadToDeg((p as BurstParticle).burstHeading ?? 0),
      },
    })
  );
  scene.bigBoomDirtBurst = scene.poolFx("dust", () =>
    scene.add.particles(0, 0, "fx_dirt", {
      lifespan: { onEmit: (p) => seedBurst(p, 1500, 2400) },
      speedX: { onEmit: burstVelocityX },
      speedY: { onEmit: burstVelocityY },
      scaleX: {
        onEmit: (p) => {
          const q = p as BurstParticle;
          // Long along travel (~0.7–0.9 of big-boom spark length band).
          q.launchScale = scene.burstLaunch.scale * range(1.0, 1.45);
          q.launchStretch = range(1.7, 3.15) * scene.burstLaunch.stretchMul;
          return q.launchScale * q.launchStretch;
        },
        // Hold size while falling — no speed/life unshrink.
        onUpdate: (p) => {
          const q = p as BurstParticle;
          return (q.launchScale ?? 1) * (q.launchStretch ?? 1);
        },
      },
      scaleY: {
        onEmit: (p) => {
          const q = p as BurstParticle;
          // Wider than spark needles (~2–3× that thickness band).
          q.launchThick = range(0.85, 1.65);
          return (q.launchScale ?? scene.burstLaunch.scale) * q.launchThick;
        },
        onUpdate: (p) => {
          const q = p as BurstParticle;
          return (q.launchScale ?? 1) * (q.launchThick ?? 1);
        },
      },
      alpha: { start: 0.92, end: 0, ease: "Quad.easeIn" },
      blendMode: "NORMAL",
      tint: [0xc4a070, 0xa88858, 0x8a6e48, 0x6e5638],
      gravityY: 275,
      accelerationX: { onUpdate: (p) => -p.velocityX * 1.05 },
      accelerationY: { onUpdate: (p) => -p.velocityY * 0.75 },
      radial: false,
      emitting: false,
      frame: fxFrames,
      rotate: {
        onEmit: burstRotation,
        onUpdate: (p) => Phaser.Math.RadToDeg((p as BurstParticle).burstHeading ?? 0),
      },
    })
  );
  scene.energyStreakBurst = scene.poolFx("short", () =>
    scene.add.particles(0, 0, "fx_spark", {
      lifespan: { onEmit: (p) => seedBurst(p, 280, 480) },
      speedX: { onEmit: burstVelocityX },
      speedY: { onEmit: burstVelocityY },
      scaleX: {
        onEmit: (p) => {
          const q = p as BurstParticle;
          q.launchScale = scene.burstLaunch.scale * range(1.55, 2.4);
          q.launchStretch = streakStretchOf(q);
          return q.launchScale * q.launchStretch * range(0.85, 1.2);
        },
        onUpdate: (p, _k, t) => {
          const q = p as BurstParticle;
          return (q.launchScale ?? 1) * streakStretchOf(q) * Math.pow(1 - t, 1.05);
        },
      },
      scaleY: {
        onEmit: (p) => {
          const q = p as BurstParticle;
          const stretch = q.launchStretch ?? streakStretchOf(q);
          return (q.launchScale ?? scene.burstLaunch.scale) * (0.62 / Math.max(0.65, Math.sqrt(stretch)));
        },
        onUpdate: (p, _k, t) => {
          const q = p as BurstParticle;
          const stretch = streakStretchOf(q);
          return (q.launchScale ?? 1) * (0.62 / Math.max(0.65, Math.sqrt(stretch))) * Math.pow(1 - t, 0.9);
        },
      },
      alpha: { start: 0.95, end: 0, ease: "Quad.easeIn" },
      blendMode: "ADD",
      tint: [0xffffff, 0xd8ffff, 0x7cf0ff, 0x4aa8ff],
      gravityY: 90,
      accelerationX: { onUpdate: (p) => -p.velocityX * 2.6 },
      accelerationY: { onUpdate: (p) => -p.velocityY * 2.6 },
      radial: false,
      emitting: false,
      frame: fxFrames,
      rotate: {
        onEmit: burstRotation,
        onUpdate: (p) => Phaser.Math.RadToDeg((p as BurstParticle).burstHeading ?? Math.atan2(p.velocityY, p.velocityX)),
      },
    })
  );
  scene.teslaSparkBurst = scene.poolFx("short", () =>
    scene.add.particles(0, 0, "fx_spark", {
      lifespan: { onEmit: (p) => seedBurst(p, 240, 420) },
      speedX: { onEmit: burstVelocityX },
      speedY: { onEmit: burstVelocityY },
      scaleX: {
        onEmit: (p) => {
          const q = p as BurstParticle;
          q.launchScale = scene.burstLaunch.scale * range(1.15, 1.7);
          q.launchStretch = Math.min(4.1, 1.45 + Math.hypot(q.velocityX || q.burstVx || 0, q.velocityY || q.burstVy || 0) * 0.0018) * scene.burstLaunch.stretchMul;
          return q.launchScale * q.launchStretch;
        },
        onUpdate: (p, _k, t) => {
          const q = p as BurstParticle;
          return (q.launchScale ?? 1) * (q.launchStretch ?? 1) * Math.pow(1 - t, 0.35);
        },
      },
      scaleY: {
        onEmit: (p) => {
          const q = p as BurstParticle;
          const stretch = q.launchStretch ?? 1;
          return (q.launchScale ?? scene.burstLaunch.scale) * (0.19 / Math.max(0.85, Math.sqrt(stretch)));
        },
        onUpdate: (p, _k, t) => {
          const q = p as BurstParticle;
          const stretch = q.launchStretch ?? 1;
          return (q.launchScale ?? 1) * (0.19 / Math.max(0.85, Math.sqrt(stretch))) * Math.pow(1 - t, 0.45);
        },
      },
      alpha: { start: 1, end: 0, ease: "Cubic.easeIn" },
      blendMode: "ADD",
      tint: [0x8ef0ff, 0x3ad0ff, 0x1a88ff, 0x0d5cff],
      gravityY: 340,
      accelerationX: { onUpdate: (p) => -p.velocityX * 9.2 },
      accelerationY: { onUpdate: (p) => -p.velocityY * 9.2 },
      radial: false,
      emitting: false,
      frame: fxFrames,
      rotate: {
        onEmit: burstRotation,
        onUpdate: (p) => Phaser.Math.RadToDeg((p as BurstParticle).burstHeading ?? 0),
      },
    })
  );
  // Rail mote: one jitter kick that eases out, size fades on the same curve, then it's gone.
  scene.railSparkTrail = scene.poolFx("short", () =>
    scene.add.particles(0, 0, "fx_spark", {
      lifespan: { onEmit: () => range(1600, 2800) * scene.trailFxLife },
      speedX: {
        onEmit: (p) => {
          const q = p as Phaser.GameObjects.Particles.Particle & { railJx?: number; railJy?: number };
          const a = Math.random() * Math.PI * 2;
          const mag = range(40, 90);
          const bias = range(160, 280);
          q.railJx = Math.cos(a) * mag + scene.exhaustVx * bias;
          q.railJy = Math.sin(a) * mag + scene.exhaustVy * bias;
          return q.railJx;
        },
      },
      speedY: {
        onEmit: (p) =>
          (p as Phaser.GameObjects.Particles.Particle & { railJy?: number }).railJy ?? 0,
      },
      scale: {
        onEmit: (p) => {
          const q = p as Phaser.GameObjects.Particles.Particle & { exhaustScaleY?: number };
          q.exhaustScaleY = (0.16 + Math.pow(Math.random(), 0.75) * 0.58) * scene.trailFxScale;
          return q.exhaustScaleY;
        },
        // Heavy ease-out: most of the shrink happens up front, then a long crawl to nothing.
        onUpdate: (p, _k, t) => {
          const q = p as Phaser.GameObjects.Particles.Particle & { exhaustScaleY?: number };
          return (q.exhaustScaleY ?? 0.42) * Math.pow(1 - t, 3.6);
        },
      },
      alpha: { onEmit: () => 0.95, onUpdate: () => 0.95 },
      blendMode: "ADD",
      tint: [0xffffff, 0xd8ffff, 0x70e8ff, 0x3ab0ff, 0x1888ff],
      gravityY: 0,
      accelerationX: { onUpdate: (p) => -p.velocityX * 8 },
      accelerationY: { onUpdate: (p) => -p.velocityY * 8 },
      radial: false,
      emitting: false,
      frame: fxFrames,
      rotate: { onEmit: () => range(0, 360) },
    })
  );
  scene.warpTrail = scene.poolFx("short", () =>
    scene.add.particles(0, 0, "fx_spark", {
      lifespan: { onEmit: () => range(900, 1600) * scene.trailFxLife },
      speed: { min: 4, max: 28 },
      scale: {
        onEmit: (p) => fxEmit(p, () => (0.28 + Math.pow(Math.random(), 0.6) * 0.22) * scene.trailFxScale),
        onUpdate: (p, _k, t) => fxLife(p, t, (u) => 1 - u * 0.9, 0.38),
      },
      alpha: { start: 0.92, end: 0 },
      blendMode: "ADD",
      tint: [0xffffff, 0xf0c8ff, 0xc86cff, 0x8a3cff],
      gravityY: 12,
      emitting: false,
      frame: fxFrames,
      rotate: fxSpin,
    })
  );
  scene.warpOrb = scene.poolFx("short", () =>
    scene.add.particles(0, 0, "fx_spark", {
      lifespan: { onEmit: () => range(520, 980) * scene.trailFxLife },
      speed: { min: 6, max: 42 },
      scale: {
        onEmit: (p) => fxEmit(p, () => (0.72 + Math.pow(Math.random(), 0.55) * 0.55) * scene.trailFxScale),
        onUpdate: (p, _k, t) => fxLife(p, t, (u) => 1 - u * 0.78, 0.7),
      },
      alpha: { start: 1, end: 0 },
      blendMode: "ADD",
      tint: [0xffffff, 0xf4d8ff, 0xe090ff, 0xb050ff],
      gravityY: 8,
      emitting: false,
      frame: fxFrames,
      rotate: fxSpin,
    })
  );
  scene.warpSparkBurst = scene.poolFx("short", () =>
    scene.add.particles(0, 0, "fx_spark", {
      lifespan: { onEmit: (p) => seedBurst(p, 220, 400) },
      speedX: { onEmit: burstVelocityX },
      speedY: { onEmit: burstVelocityY },
      scaleX: {
        onEmit: (p) => {
          const q = p as BurstParticle;
          q.launchScale = scene.burstLaunch.scale * range(1.2, 1.9);
          q.launchStretch = streakStretchOf(q);
          return q.launchScale * q.launchStretch * range(0.9, 1.25);
        },
        onUpdate: (p, _k, t) => {
          const q = p as BurstParticle;
          return (q.launchScale ?? 1) * streakStretchOf(q) * Math.pow(1 - t, 1.05);
        },
      },
      scaleY: {
        onEmit: (p) => {
          const q = p as BurstParticle;
          const stretch = q.launchStretch ?? streakStretchOf(q);
          return (q.launchScale ?? scene.burstLaunch.scale) * (0.55 / Math.max(0.65, Math.sqrt(stretch)));
        },
        onUpdate: (p, _k, t) => {
          const q = p as BurstParticle;
          const stretch = streakStretchOf(q);
          return (q.launchScale ?? 1) * (0.55 / Math.max(0.65, Math.sqrt(stretch))) * Math.pow(1 - t, 0.9);
        },
      },
      alpha: { start: 1, end: 0, ease: "Quad.easeIn" },
      blendMode: "ADD",
      tint: [0xffffff, 0xf0b8ff, 0xc86cff, 0x7a28ff],
      gravityY: 70,
      accelerationX: { onUpdate: (p) => -p.velocityX * 2.8 },
      accelerationY: { onUpdate: (p) => -p.velocityY * 2.8 },
      radial: false,
      emitting: false,
      frame: fxFrames,
      rotate: {
        onEmit: burstRotation,
        onUpdate: (p) =>
          Phaser.Math.RadToDeg(
            (p as BurstParticle).burstHeading ?? Math.atan2(p.velocityY, p.velocityX)
          ),
      },
    })
  );
  scene.muzzleBurst = scene.poolFx("short", () =>
    scene.add.particles(0, 0, "fx_flame", {
      lifespan: { onEmit: (p) => seedBurst(p, 120, 280) },
      speedX: { onEmit: burstVelocityX },
      speedY: { onEmit: burstVelocityY },
      scaleX: {
        onEmit: (p) => {
          const q = p as BurstParticle;
          q.launchScale = scene.burstLaunch.scale * range(0.72, 1.18);
          q.launchStretch = burstStretchOf(q);
          const sx = q.launchScale * q.launchStretch * range(1.7, 2.4);
          // Center-origin streaks: nudge forward by half length so the tail sits on the muzzle.
          const halfLen = FX_SHEET_SIZE.flame * sx * 0.5;
          const heading = q.burstHeading ?? Math.atan2(q.burstVy ?? 0, q.burstVx ?? 1);
          q.x += Math.cos(heading) * halfLen;
          q.y += Math.sin(heading) * halfLen;
          return sx;
        },
        onUpdate: (p, _k, t) => {
          const q = p as BurstParticle;
          return (q.launchScale ?? 1) * burstStretchOf(q) * 1.15 * (1 - t);
        },
      },
      scaleY: {
        onEmit: (p) => {
          const q = p as BurstParticle;
          const stretch = q.launchStretch ?? burstStretchOf(q);
          return (q.launchScale ?? scene.burstLaunch.scale) * (0.42 / Math.max(0.55, Math.sqrt(stretch)));
        },
        onUpdate: (p, _k, t) => {
          const q = p as BurstParticle;
          const stretch = burstStretchOf(q);
          return (q.launchScale ?? 1) * (0.42 / Math.max(0.55, Math.sqrt(stretch))) * (1 - t);
        },
      },
      alpha: { start: 1, end: 0 },
      blendMode: "ADD",
      tint: [0xfff8d8, 0xffc050, 0xff7a28],
      radial: false,
      emitting: false,
      frame: fxFrames,
      rotate: {
        onEmit: burstRotation,
        onUpdate: (p) => Phaser.Math.RadToDeg(Math.atan2(p.velocityY, p.velocityX)),
      },
    })
  );
  scene.splashBurst = scene.poolFx("short", () =>
    scene.add.particles(0, 0, "fx_splash", {
      lifespan: { onEmit: (p) => seedBurst(p, 320, 600) },
      speedX: { onEmit: burstVelocityX },
      speedY: { onEmit: burstVelocityY },
      scaleX: {
        onEmit: (p) => {
          const q = p as BurstParticle;
          q.launchScale = scene.burstLaunch.scale * range(0.72, 1.18);
          return q.launchScale;
        },
        onUpdate: (p, _k, t) => ((p as BurstParticle).launchScale ?? 1) * (1 - t * 0.82),
      },
      scaleY: {
        onEmit: (p) => ((p as BurstParticle).launchScale ?? scene.burstLaunch.scale) * 0.48,
        onUpdate: (p, _k, t) => ((p as BurstParticle).launchScale ?? 1) * (0.48 - t * 0.36),
      },
      alpha: { start: 0.9, end: 0 },
      tint: [0xffffff, 0x9edcff, 0x6ec4ff],
      gravityY: 240,
      radial: false,
      emitting: false,
      frame: fxFrames,
      rotate: {
        onEmit: burstRotation,
        onUpdate: (p) => Phaser.Math.RadToDeg(Math.atan2(p.velocityY, p.velocityX)),
      },
    })
  );
  scene.explosionPuff = scene.poolFx("fire", () =>
    scene.add.particles(0, 0, "fx_flame", {
      lifespan: { onEmit: (p) => seedBurst(p, 180, 400) },
      speedX: { onEmit: burstVelocityX },
      speedY: { onEmit: burstVelocityY },
      scaleX: {
        onEmit: (p) => {
          const q = p as BurstParticle;
          q.launchScale = scene.burstLaunch.scale * range(0.7, 1.25);
          q.launchStretch = range(1.8, 3.5);
          q.swirl = (Math.random() < 0.5 ? -1 : 1) * range(1.8, 4.5);
          return q.launchScale * q.launchStretch;
        },
        onUpdate: (p, _k, t) => {
          const q = p as BurstParticle;
          const roundEarly = 1 + ((q.launchStretch ?? 2.4) - 1) * Math.pow(1 - Math.min(1, t / 0.3), 2);
          return (q.launchScale ?? 1) * roundEarly * Math.pow(1 - t, 1.35);
        },
      },
      scaleY: {
        onEmit: (p) => (p as BurstParticle).launchScale ?? scene.burstLaunch.scale,
        onUpdate: (p, _k, t) => ((p as BurstParticle).launchScale ?? 1) * Math.pow(1 - t, 1.35),
      },
      alpha: 1,
      blendMode: "ADD",
      tint: [0xfff8d8, 0xffc050, 0xff7a28, 0xff5420],
      gravityY: -38,
      accelerationX: {
        onUpdate: (p, _k, t) => {
          const late = Math.pow(Phaser.Math.Clamp((t - 0.52) / 0.48, 0, 1), 1.6);
          return (-p.velocityY * ((p as BurstParticle).swirl ?? 0) - p.velocityX * 1.5) * late;
        },
      },
      accelerationY: {
        onUpdate: (p, _k, t) => {
          const late = Math.pow(Phaser.Math.Clamp((t - 0.52) / 0.48, 0, 1), 1.6);
          return (p.velocityX * ((p as BurstParticle).swirl ?? 0) - p.velocityY * 1.5) * late;
        },
      },
      radial: false,
      emitting: false,
      frame: fxFrames,
      rotate: {
        onEmit: burstRotation,
        onUpdate: (p) => Phaser.Math.RadToDeg(Math.atan2(p.velocityY, p.velocityX)),
      },
    })
  );
  scene.craftExhaust = scene.poolFx("fire", () =>
    scene.add.particles(0, 0, craftExhaustFlameSheet(craft.kind), {
      lifespan: { onEmit: () => scene.exhaustLife },
      speedX: { onEmit: () => scene.exhaustVx + range(-4, 4) },
      speedY: { onEmit: () => scene.exhaustVy + range(-4, 4) },
      scaleX: {
        onEmit: (p) => {
          const q = p as Phaser.GameObjects.Particles.Particle & {
            exhaustScaleX?: number;
            exhaustJitter?: number;
          };
          q.exhaustScaleX = scene.exhaustScaleX;
          q.exhaustJitter = range(-1, 1);
          return q.exhaustScaleX;
        },
        onUpdate: (p, _k, t) => {
          const q = p as Phaser.GameObjects.Particles.Particle & { exhaustScaleX?: number };
          const base = q.exhaustScaleX ?? 1;
          // Hold the ribbon early, then extend slightly as it dies.
          const late = Math.pow(Phaser.Math.Clamp((t - 0.38) / 0.62, 0, 1), 1.35);
          return base * (1 - t * 0.12 + late * 0.95);
        },
      },
      scaleY: {
        onEmit: (p) => {
          const q = p as Phaser.GameObjects.Particles.Particle & { exhaustScaleY?: number };
          q.exhaustScaleY = scene.exhaustScaleY;
          return q.exhaustScaleY;
        },
        onUpdate: (p, _k, t) => {
          const q = p as Phaser.GameObjects.Particles.Particle & { exhaustScaleY?: number };
          const base = q.exhaustScaleY ?? 0.4;
          const late = Math.pow(Phaser.Math.Clamp((t - 0.4) / 0.6, 0, 1), 1.25);
          return base * (1 - t * 0.18 + late * 0.85);
        },
      },
      accelerationX: {
        onUpdate: (p, _k, t) => {
          const q = p as Phaser.GameObjects.Particles.Particle & { exhaustJitter?: number };
          const late = Math.pow(Phaser.Math.Clamp((t - 0.36) / 0.64, 0, 1), 1.4);
          const j = q.exhaustJitter ?? 0;
          return j * 110 * late + Math.sin(t * 26 + j * 7.1) * 70 * late;
        },
      },
      accelerationY: {
        onUpdate: (p, _k, t) => {
          const q = p as Phaser.GameObjects.Particles.Particle & { exhaustJitter?: number };
          const late = Math.pow(Phaser.Math.Clamp((t - 0.36) / 0.64, 0, 1), 1.4);
          const j = q.exhaustJitter ?? 0;
          return -j * 85 * late + Math.cos(t * 23 + j * 5.4) * 65 * late;
        },
      },
      alpha: {
        onEmit: (p) => {
          const q = p as Phaser.GameObjects.Particles.Particle & { exhaustAlpha?: number };
          q.exhaustAlpha = scene.exhaustAlpha;
          return q.exhaustAlpha;
        },
        onUpdate: (p, _k, t) => {
          const q = p as Phaser.GameObjects.Particles.Particle & { exhaustAlpha?: number };
          return (q.exhaustAlpha ?? 0.98) * (1 - t * 0.94);
        },
      },
      // Hue is pre-baked into craftExhaustFlameSheet (ParticleEmitter has no preFX).
      blendMode: "ADD",
      radial: false,
      emitting: false,
      frame: fxFrames,
      rotate: {
        onEmit: (p) => {
          const q = p as Phaser.GameObjects.Particles.Particle & { exhaustAngle?: number };
          q.exhaustAngle = scene.exhaustAngle;
          return Phaser.Math.RadToDeg(scene.exhaustAngle);
        },
        onUpdate: (p, _k, t) => {
          const q = p as Phaser.GameObjects.Particles.Particle & {
            exhaustAngle?: number;
            exhaustJitter?: number;
          };
          const late = Math.pow(Phaser.Math.Clamp((t - 0.4) / 0.6, 0, 1), 1.3);
          const wobble = (q.exhaustJitter ?? 0) * 18 * late;
          return Phaser.Math.RadToDeg(q.exhaustAngle ?? scene.exhaustAngle) + wobble;
        },
      },
    })
  );
  scene.craftExhaustMote = scene.poolFx("short", () =>
    scene.add.particles(0, 0, "fx_spark", {
      lifespan: { min: 280, max: 520 },
      speedX: { onEmit: () => scene.exhaustVx * 0.5 + range(-16, 16) },
      speedY: { onEmit: () => scene.exhaustVy * 0.5 + range(-16, 16) },
      scale: {
        onEmit: (p) => {
          const q = p as Phaser.GameObjects.Particles.Particle & { exhaustScaleY?: number };
          q.exhaustScaleY = 0.18 + scene.exhaustScaleY * 0.55;
          return q.exhaustScaleY;
        },
        onUpdate: (p, _k, t) => {
          const q = p as Phaser.GameObjects.Particles.Particle & { exhaustScaleY?: number };
          return (q.exhaustScaleY ?? 0.28) * (1 - t);
        },
      },
      alpha: {
        onEmit: (p) => {
          const q = p as Phaser.GameObjects.Particles.Particle & { exhaustAlpha?: number };
          q.exhaustAlpha = scene.exhaustAlpha * 0.92;
          return q.exhaustAlpha;
        },
        onUpdate: (p, _k, t) => {
          const q = p as Phaser.GameObjects.Particles.Particle & { exhaustAlpha?: number };
          return (q.exhaustAlpha ?? 0.9) * (1 - t);
        },
      },
      tint: { onEmit: () => scene.exhaustTint },
      blendMode: "ADD",
      radial: false,
      emitting: false,
      frame: fxFrames,
      rotate: { onEmit: () => Phaser.Math.RadToDeg(scene.exhaustAngle) },
    })
  );
  scene.craftExhaustSmoke = scene.poolFx("smoke", () =>
    scene.add.particles(0, 0, "fx_smoke", {
      lifespan: { min: 2400, max: 4000 },
      speedX: { onEmit: () => scene.exhaustVx * 0.42 + range(-10, 10) },
      speedY: { onEmit: () => scene.exhaustVy * 0.42 + range(-10, 10) },
      scale: {
        onEmit: (p) => {
          const q = p as Phaser.GameObjects.Particles.Particle & { exhaustScaleY?: number };
          q.exhaustScaleY = 0.22 + scene.exhaustScaleY * 0.7;
          return q.exhaustScaleY;
        },
        onUpdate: (p, _k, t) => {
          const q = p as Phaser.GameObjects.Particles.Particle & { exhaustScaleY?: number };
          return (q.exhaustScaleY ?? 0.38) * (1 + t * 2.15);
        },
      },
      alpha: {
        onEmit: (p) => {
          const q = p as Phaser.GameObjects.Particles.Particle & { exhaustAlpha?: number };
          q.exhaustAlpha = scene.exhaustAlpha * 0.82;
          return q.exhaustAlpha;
        },
        onUpdate: (p, _k, t) => {
          const q = p as Phaser.GameObjects.Particles.Particle & { exhaustAlpha?: number };
          return (q.exhaustAlpha ?? 0.82) * (1 - t);
        },
      },
      tint: { onEmit: () => scene.exhaustSmokeTint },
      radial: false,
      emitting: false,
      frame: fxFrames,
      rotate: fxSpin,
    })
  );
  scene.jetWingTrail = scene.poolFx("smoke", () =>
    scene.add.particles(0, 0, scene.textures.exists("fx_smoke_tint") ? "fx_smoke_tint" : "fx_smoke", {
      lifespan: { onEmit: () => scene.wingTrailLife },
      speedX: { onEmit: () => scene.wingTrailVx + range(-3, 3) },
      speedY: { onEmit: () => scene.wingTrailVy + range(-3, 3) },
      scaleX: {
        onEmit: (p) => {
          const q = p as Phaser.GameObjects.Particles.Particle & { wingScaleX?: number };
          q.wingScaleX = scene.wingTrailScaleX;
          return q.wingScaleX;
        },
        onUpdate: (p, _k, t) => {
          const q = p as Phaser.GameObjects.Particles.Particle & { wingScaleX?: number };
          return (q.wingScaleX ?? 1) * (1 + t * 0.55);
        },
      },
      scaleY: {
        onEmit: (p) => {
          const q = p as Phaser.GameObjects.Particles.Particle & { wingScaleY?: number };
          q.wingScaleY = scene.wingTrailScaleY;
          return q.wingScaleY;
        },
        onUpdate: (p, _k, t) => {
          const q = p as Phaser.GameObjects.Particles.Particle & { wingScaleY?: number };
          return (q.wingScaleY ?? 0.22) * (1 + t * 0.85);
        },
      },
      alpha: { start: 0.55, end: 0 },
      tint: { onEmit: () => scene.wingTrailTint },
      gravityY: -4,
      radial: false,
      emitting: false,
      frame: fxFrames,
      rotate: {
        onEmit: (p) => {
          const q = p as Phaser.GameObjects.Particles.Particle & { wingAngle?: number };
          q.wingAngle = scene.wingTrailAngle;
          return Phaser.Math.RadToDeg(scene.wingTrailAngle);
        },
        onUpdate: (p) => {
          const q = p as Phaser.GameObjects.Particles.Particle & { wingAngle?: number };
          return Phaser.Math.RadToDeg(q.wingAngle ?? scene.wingTrailAngle);
        },
      },
    })
  );
  scene.flame = scene.poolFx("fire", () =>
    scene.add.particles(0, 0, "fx_flame", {
      lifespan: { onEmit: () => 480 * scene.trailFxLife },
      speed: { min: 8, max: 40 },
      scale: {
        onEmit: (p) => {
          const q = p as Phaser.GameObjects.Particles.Particle & { s0?: number };
          // Bake both knobs at emit — recycled particles must not inherit a stale s0.
          q.s0 = scene.dmgFlameScale * scene.trailFxScale * (0.38 + Math.random() * 0.16);
          return q.s0;
        },
        onUpdate: (p, _k, t) => {
          const q = p as Phaser.GameObjects.Particles.Particle & { s0?: number };
          return (q.s0 ?? 0.42) * (1 - t * 0.76);
        },
      },
      alpha: { start: 1, end: 0 },
      blendMode: "ADD",
      tint: [0xfff8d8, 0xffc050, 0xff6a22],
      gravityY: -72,
      emitting: false,
      frame: fxFrames,
      rotate: fxSpin,
    })
  );
  scene.hotFlame = scene.poolFx("fire", () =>
    scene.add.particles(0, 0, "fx_flame", {
      lifespan: { onEmit: () => 480 * scene.trailFxLife },
      speed: { min: 8, max: 40 },
      scale: {
        onEmit: (p) => {
          const q = p as Phaser.GameObjects.Particles.Particle & { s0?: number };
          q.s0 = scene.dmgFlameScale * scene.trailFxScale * (0.38 + Math.random() * 0.16);
          return q.s0;
        },
        onUpdate: (p, _k, t) => {
          const q = p as Phaser.GameObjects.Particles.Particle & { s0?: number };
          return (q.s0 ?? 0.42) * (1 - t * 0.76);
        },
      },
      alpha: { start: 1, end: 0 },
      blendMode: "ADD",
      tint: [0xfff8d8, 0xffc050, 0xff6a22],
      gravityY: -72,
      emitting: false,
      frame: fxFrames,
      rotate: fxSpin,
    })
  );
  scene.hurtSmoke = scene.poolFx("smoke", () =>
    scene.add.particles(0, 0, "fx_smoke", {
      lifespan: {
        onEmit: () => {
          const base = range(2400, 4200);
          return base * Math.max(1, scene.trailFxLife * 0.85);
        },
      },
      speed: { min: 3, max: 16 },
      angle: { min: -125, max: -55 },
      scale: { start: 0.32, end: 1.05 },
      alpha: { start: 0.48, end: 0 },
      gravityY: -6,
      accelerationX: { onEmit: () => (Math.random() - 0.5) * 16 },
      accelerationY: { onEmit: () => -5 + (Math.random() - 0.5) * 10 },
      emitting: false,
      frame: fxFrames,
      rotate: { min: -70, max: 70 },
    })
  );
  scene.playerHurtSmoke = scene.poolFx("smoke", () =>
    scene.add.particles(0, 0, "fx_smoke", {
      lifespan: {
        onEmit: () => {
          const base = range(2400, 4200);
          return base * Math.max(1, scene.trailFxLife * 0.85);
        },
      },
      speed: { min: 3, max: 16 },
      angle: { min: -125, max: -55 },
      scale: { start: 0.32, end: 1.05 },
      alpha: { start: 0.48, end: 0 },
      gravityY: -6,
      accelerationX: { onEmit: () => (Math.random() - 0.5) * 16 },
      accelerationY: { onEmit: () => -5 + (Math.random() - 0.5) * 10 },
      emitting: false,
      frame: fxFrames,
      rotate: { min: -70, max: 70 },
    })
  );
  const fxEmit = (p: Phaser.GameObjects.Particles.Particle | undefined, make: () => number): number => {
    const q = p as (Phaser.GameObjects.Particles.Particle & { s0?: number }) | undefined;
    const s = make();
    if (q) q.s0 = s;
    return s;
  };
  const fxLife = (
    p: Phaser.GameObjects.Particles.Particle | undefined,
    t: number,
    mul: (t: number) => number,
    fallback: number
  ): number => {
    const q = p as (Phaser.GameObjects.Particles.Particle & { s0?: number }) | undefined;
    return (q?.s0 ?? fallback) * mul(t);
  };
  scene.burn = scene.poolFx("fire", () =>
    scene.add.particles(0, 0, "fx_flame", {
      lifespan: { onEmit: () => range(240, 420) * scene.trailFxLife },
      speed: { min: 2, max: 14 },
      scale: {
        onEmit: (p) => fxEmit(p, () => (0.7 + Math.pow(Math.random(), 0.65) * 0.7) * scene.trailFxScale),
        onUpdate: (p, _k, t) => fxLife(p, t, (u) => 1 - u * 0.9, 0.7),
      },
      alpha: { start: 1, end: 0 },
      blendMode: "ADD",
      tint: [0xfff4c0, 0xff9a32, 0xff5a18],
      gravityY: -78,
      emitting: false,
      frame: fxFrames,
      rotate: fxSpin,
    })
  );
  scene.blastBurn = scene.poolFx("fire", () =>
    scene.add.particles(0, 0, "fx_flame", {
      // Match lingerSmoke buoyancy/path so fire fades into the same rising plume.
      lifespan: { onEmit: () => range(240, 420) * scene.trailFxLife },
      speed: { min: 4, max: 18 },
      angle: { min: -128, max: -52 },
      scale: {
        onEmit: (p) => fxEmit(p, () => (0.28 + Math.pow(Math.random(), 0.65) * 0.28) * scene.trailFxScale),
        onUpdate: (p, _k, t) => fxLife(p, t, (u) => 1 - u * 0.9, 0.28),
      },
      alpha: { start: 1, end: 0 },
      blendMode: "ADD",
      tint: [0xfff4c0, 0xff9a32, 0xff5a18],
      gravityY: -6,
      accelerationX: { onEmit: () => (Math.random() - 0.5) * 18 },
      accelerationY: { onEmit: () => -5 + (Math.random() - 0.5) * 12 },
      emitting: false,
      frame: fxFrames,
      rotate: fxSpin,
    })
  );
  scene.blastFire = scene.add.particles(0, 0, "fx_flame", {
    lifespan: { min: 180, max: 320 },
    speed: { min: 180, max: 480 },
    scale: { start: 1.15, end: 0.18 },
    alpha: { start: 0.88, end: 0 },
    blendMode: "ADD",
    gravityY: -68,
    emitting: false,
    frame: fxFrames,
    rotate: fxSpin,
  });
  scene.blastFire.setDepth(Layer.WORLD);
  scene.registerFx("fire", scene.blastFire);
  scene.ember = scene.poolFx("fire", () =>
    scene.add.particles(0, 0, "fx_flame", {
      lifespan: { onEmit: () => range(180, 320) * scene.trailFxLife },
      speed: { min: 1, max: 10 },
      scale: {
        onEmit: (p) => fxEmit(p, () => (0.12 + Math.pow(Math.random(), 0.65) * 0.12) * scene.trailFxScale),
        onUpdate: (p, _k, t) => fxLife(p, t, (u) => 1 - u * 0.9, 0.12),
      },
      alpha: { start: 0.9, end: 0 },
      blendMode: "ADD",
      tint: [0xfff4c0, 0xff9a32, 0xff5a18],
      gravityY: -70,
      emitting: false,
      frame: fxFrames,
      rotate: fxSpin,
    })
  );
  scene.flareTrail = scene.poolFx("fire", () =>
    scene.add.particles(0, 0, "fx_spark", {
      lifespan: { onEmit: () => range(1600, 2800) * scene.trailFxLife },
      speed: { min: 2, max: 18 },
      scale: {
        onEmit: (p) => fxEmit(p, () => (0.42 + Math.pow(Math.random(), 0.65) * 0.22) * scene.trailFxScale),
        onUpdate: (p, _k, t) => fxLife(p, t, (u) => 1 - u * 0.88, 0.48),
      },
      alpha: { start: 0.95, end: 0 },
      blendMode: "ADD",
      tint: [0xfff8d0, 0xffee66, 0xffaa40, 0xff6a18],
      gravityY: 28,
      emitting: false,
      frame: fxFrames,
      rotate: fxSpin,
    })
  );
  scene.flareSpark = scene.poolFx("short", () =>
    scene.add.particles(0, 0, "fx_spark", {
      lifespan: { onEmit: () => range(220, 420) },
      speed: { min: 12, max: 86 },
      scale: {
        onEmit: (p) => fxEmit(p, () => (0.52 + Math.pow(Math.random(), 0.55) * 0.28) * scene.trailFxScale),
        onUpdate: (p, _k, t) => fxLife(p, t, (u) => 1 - u * 0.82, 0.62),
      },
      alpha: { start: 1, end: 0 },
      blendMode: "ADD",
      tint: [0xffffff, 0xfff8d0, 0xffcc44, 0xff7a20],
      gravityY: 36,
      emitting: false,
      frame: fxFrames,
      rotate: fxSpin,
    })
  );
  // Signal-flare gun pellet: pink/red flame loft with strong screen-up (Y/Z) drift.
  scene.signalFlareTrail = scene.poolFx("fire", () =>
    scene.add.particles(0, 0, "fx_flame", {
      lifespan: { onEmit: () => range(520, 980) * scene.trailFxLife },
      speed: { min: 6, max: 28 },
      angle: { min: -130, max: -50 },
      scale: {
        onEmit: (p) => fxEmit(p, () => (0.28 + Math.pow(Math.random(), 0.6) * 0.22) * scene.trailFxScale),
        onUpdate: (p, _k, t) => fxLife(p, t, (u) => 1 - u * 0.72, 0.28),
      },
      alpha: { start: 0.95, end: 0 },
      blendMode: "ADD",
      tint: [0xffe0f0, 0xff6a9a, 0xff2a55, 0xe01040],
      gravityY: -145,
      accelerationY: { onEmit: () => -35 + (Math.random() - 0.5) * 18 },
      emitting: false,
      frame: fxFrames,
      rotate: fxSpin,
    })
  );
  scene.signalFlareSmoke = scene.poolFx("smoke", () =>
    scene.add.particles(0, 0, scene.textures.exists("fx_smoke_tint") ? "fx_smoke_tint" : "fx_smoke", {
      lifespan: { onEmit: () => range(900, 1600) * Math.max(1, scene.trailFxLife * 0.8) },
      speed: { min: 4, max: 22 },
      angle: { min: -135, max: -45 },
      scale: {
        onEmit: (p) => fxEmit(p, () => (0.22 + Math.random() * 0.16) * scene.trailFxScale),
        onUpdate: (p, _k, t) => fxLife(p, t, (u) => 1 + 2.6 * u, 0.22),
      },
      alpha: { start: 0.55, end: 0 },
      tint: [0xffb0c8, 0xff5578, 0xd02048, 0x901030],
      gravityY: -95,
      accelerationY: { onEmit: () => -28 + (Math.random() - 0.5) * 14 },
      accelerationX: { onEmit: () => (Math.random() - 0.5) * 16 },
      emitting: false,
      frame: fxFrames,
      rotate: { min: -70, max: 70 },
    })
  );
  scene.signalFlareSpark = scene.poolFx("short", () =>
    scene.add.particles(0, 0, "fx_spark", {
      lifespan: { onEmit: () => range(90, 220) },
      speed: { min: 140, max: 420 },
      scale: {
        onEmit: (p) => fxEmit(p, () => (0.22 + Math.pow(Math.random(), 0.45) * 0.2) * scene.trailFxScale),
        onUpdate: (p, _k, t) => fxLife(p, t, (u) => 1 - u * 0.9, 0.28),
      },
      alpha: { start: 1, end: 0 },
      blendMode: "ADD",
      tint: [0xffffff, 0xff90b0, 0xff2858, 0xc01030],
      gravityY: 18,
      emitting: false,
      frame: fxFrames,
      rotate: fxSpin,
    })
  );
  scene.shortTrailSmoke = scene.poolFx("smoke", () =>
    scene.add.particles(0, 0, "fx_smoke", {
      lifespan: { onEmit: () => 520 * scene.trailFxLife },
      speed: { min: 8, max: 36 },
      scale: {
        onEmit: (p) => fxEmit(p, () => 0.35 * scene.trailFxScale),
        onUpdate: (p, _k, t) => fxLife(p, t, (u) => 1 + 3 * u, 0.35),
      },
      alpha: { start: 0.5, end: 0 },
      gravityY: -30,
      emitting: false,
      frame: fxFrames,
      rotate: fxSpin,
    })
  );
  scene.lingerSmoke = scene.poolFx("smoke", () =>
    scene.add.particles(0, 0, "fx_smoke", {
      lifespan: {
        onEmit: () => range(2200, 4000) * Math.max(1, scene.trailFxLife * 0.7),
      },
      speed: { min: 4, max: 18 },
      angle: { min: -128, max: -52 },
      scale: {
        onEmit: (p) => fxEmit(p, () => 0.38 * scene.trailFxScale),
        onUpdate: (p, _k, t) => fxLife(p, t, (u) => 1 + 2.4 * u, 0.38),
      },
      alpha: { start: 0.88, end: 0 },
      gravityY: -6,
      accelerationX: { onEmit: () => (Math.random() - 0.5) * 18 },
      accelerationY: { onEmit: () => -5 + (Math.random() - 0.5) * 12 },
      emitting: false,
      frame: fxFrames,
      rotate: { min: -80, max: 80 },
    })
  );
  scene.rocketSmoke = scene.poolFx("smoke", () =>
    scene.add.particles(0, 0, "fx_smoke", {
      lifespan: {
        onEmit: () => range(1600, 2800) * Math.max(1, scene.trailFxLife * 0.75),
      },
      speed: { min: 8, max: 32 },
      scaleX: {
        onEmit: (p) => {
          const q = p as Phaser.GameObjects.Particles.Particle & { rocketScaleX?: number };
          q.rocketScaleX = 0.48 * scene.trailFxScale * range(1.7, 2.5);
          return q.rocketScaleX;
        },
        onUpdate: (p, _k, t) => {
          const q = p as Phaser.GameObjects.Particles.Particle & { rocketScaleX?: number };
          return (q.rocketScaleX ?? 0.8) * (1 + 1.4 * t);
        },
      },
      scaleY: {
        onEmit: (p) => {
          const q = p as Phaser.GameObjects.Particles.Particle & { rocketScaleY?: number };
          q.rocketScaleY = 0.2 * scene.trailFxScale * range(0.9, 1.15);
          return q.rocketScaleY;
        },
        onUpdate: (p, _k, t) => {
          const q = p as Phaser.GameObjects.Particles.Particle & { rocketScaleY?: number };
          return (q.rocketScaleY ?? 0.2) * (1 + 1.8 * t);
        },
      },
      alpha: { start: 0.68, end: 0 },
      gravityY: -10,
      emitting: false,
      frame: fxFrames,
      rotate: {
        onEmit: (p) => {
          const q = p as Phaser.GameObjects.Particles.Particle & { rocketAngle?: number };
          q.rocketAngle = scene.shotTrailAngle;
          return Phaser.Math.RadToDeg(scene.shotTrailAngle);
        },
        onUpdate: (p) => {
          const q = p as Phaser.GameObjects.Particles.Particle & { rocketAngle?: number };
          return Phaser.Math.RadToDeg(q.rocketAngle ?? scene.shotTrailAngle);
        },
      },
    })
  );
  scene.heliDust = scene.add.particles(0, 0, "fx_smoke", {
    lifespan: { min: 900, max: 1600 },
    speed: { min: 240, max: 460 },
    scale: { start: 0.48, end: 2.1 },
    alpha: { start: 0.58, end: 0 },
    gravityY: 8,
    emitting: false,
    frame: fxFrames,
    rotate: {
      onEmit: (p) => {
        (p as Phaser.GameObjects.Particles.Particle & { dustSpin?: number; dustRot0?: number }).dustSpin =
          (Math.random() < 0.5 ? -1 : 1) * (25 + Math.random() * 70);
        const rot0 = Math.random() * 360;
        (p as Phaser.GameObjects.Particles.Particle & { dustRot0?: number }).dustRot0 = rot0;
        return rot0;
      },
      onUpdate: (p, _key, t) => {
        const extra = p as Phaser.GameObjects.Particles.Particle & { dustSpin?: number; dustRot0?: number };
        const late = Math.pow(Phaser.Math.Clamp((t - 0.38) / 0.62, 0, 1), 1.5);
        return (extra.dustRot0 ?? 0) + (extra.dustSpin ?? 0) * late;
      },
    },
    accelerationX: { onUpdate: (p) => -p.velocityX * 5.2 },
    accelerationY: { onUpdate: (p) => -p.velocityY * 5.2 },
  });
  scene.heliDust.setDepth(Layer.WORLD);
  scene.registerFx("dust", scene.heliDust);
}
