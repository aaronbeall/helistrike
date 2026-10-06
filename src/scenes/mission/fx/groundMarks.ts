import { themeOf, shallowTint } from "../../../worldgen/theme";
import { applyTerrainLight, sampleBiome, SCALE, doodadTex, groundZ, worldToScreen, cameraPointVisible, projectHeading, isWater, WORLD, WRECK_TEX, type WorldData } from "../../../worldgen/world";
import { softCapBlastCraterScale } from "../../../render/fxCurves";
import Phaser from "phaser";
import { applyThermalHeat } from "../../../render/thermal";
import { camoForBiome, resolveSkin } from "../../../render/camo";
import { type SimParticle, type Unit } from "../../../sim/combat";
import { ZOff, worldDepth } from "../../../render/depth";
import { range } from "../../../util/rng";
import { FX_VARIANTS, FX_BLAST_CELLS } from "../../../art/sprites";
import type { MissionScene } from "../../missionScene";

/** Wreck resting at a water surface (sea structures): drawn like a hull, not stamped on the seabed. */
type SurfaceWreck = { image: Phaser.GameObjects.Image; x: number; y: number; z: number; rotation: number };

/** Crater embers: seconds at full glow, then seconds to fade out. */
const EMBER_HOLD_MIN = 1.6;
const EMBER_HOLD_MAX = 3.2;
const EMBER_FADE_MIN = 4.8;
const EMBER_FADE_MAX = 8.4;

/** Craters in shallow water: how far their tint leans to the theme's shallow-water colour. */
const SHALLOW_CRATER_MIX = 0.45;
/** Ember heat on thermal (0–1 signal), before fading out. */
const EMBER_THERMAL_HEAT = 0.75;
/** Coal tint: hot orange → deep red as embers cool (multiplies the source art). */
const EMBER_HOT = 0xff7a26;
const EMBER_COOL = 0xc81a0e;
/** Bloom sits redder than the coals. */
const EMBER_BLOOM_HOT = 0xff4a14;
const EMBER_BLOOM_COOL = 0x9a0c06;

function lerpRgb(a: number, b: number, t: number): number {
  const r = ((a >> 16) & 255) + ((((b >> 16) & 255) - ((a >> 16) & 255)) * t);
  const g = ((a >> 8) & 255) + ((((b >> 8) & 255) - ((a >> 8) & 255)) * t);
  const bl = (a & 255) + (((b & 255) - (a & 255)) * t);
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
}

/** Additive ember patch over a crater / hulk — fades to nothing with flicker. */
type EmberGlow = {
  /** Crisp coal / beam fragments. */
  image: Phaser.GameObjects.Image;
  /** Soft enlarged ADD bloom under/over the crisp layer. */
  bloom: Phaser.GameObjects.Image;
  x: number;
  y: number;
  z: number;
  rotation: number;
  scale: number;
  /** Bloom scale relative to `scale`. */
  bloomMul: number;
  age: number;
  hold: number;
  fadeDur: number;
  flickerPhase: number;
  flickerRate: number;
  /** Per-coal colour bias, 0 = orange … 1 = red. */
  hue: number;
};

type ThermalWreckKind = "blast" | "blood" | "scar" | "shell" | "hulk";

type ThermalWreckMark = {
  image: Phaser.GameObjects.Image;
  x: number;
  y: number;
  z: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  /** Seconds at full heat before cooldown begins. */
  hold: number;
  /** Cooldown duration after the hold window. */
  fadeDur: number;
  /** Heat at full (0–1), scaled by the fade. */
  peak: number;
  /** Elapsed lifetime (hold + fade); advances even when thermal view is off. */
  age: number;
  kind: ThermalWreckKind;
};

/** Scratch canvas for tinting blood dirt frames before multiply-stamping terrain. */
let bloodStampScratch: HTMLCanvasElement | null = null;

/** Chain-gun scars / casings stamp tiny on the wreck layer; thermal overlay needs a readable minimum span. */
function thermalWreckDisplayScale(
  scaleX: number,
  scaleY: number,
  kind: ThermalWreckKind
): { scaleX: number; scaleY: number } {
  if (kind !== "scar" && kind !== "shell") return { scaleX, scaleY };
  const minSpan = kind === "shell" ? 0.28 : 0.38;
  const span = Math.max(scaleX, scaleY);
  if (span >= minSpan) return { scaleX, scaleY };
  const mul = minSpan / span;
  return { scaleX: scaleX * mul, scaleY: scaleY * mul };
}

function thermalWreckTiming(kind: ThermalWreckKind, scaleX: number, scaleY: number): { hold: number; fadeDur: number; peak?: number } {
  const span = Math.max(scaleX, scaleY);
  if (kind === "blood") {
    return { hold: 0.28, fadeDur: 4.5 + Math.min(5, span * 1.8) };
  }
  if (kind === "scar") {
    return { hold: 0.35, fadeDur: 5 + Math.min(6, span * 2.2) };
  }
  if (kind === "shell") {
    // Spent brass stays hot on the ground longer than a speed-tied in-flight glow.
    return { hold: 1.6, fadeDur: 9 + Math.min(8, span * 4) };
  }
  if (kind === "hulk") {
    // Burnt-out hulls start warm, not white-hot, and cool within seconds.
    return { hold: 1.5, fadeDur: 9 + Math.min(6, span * 2.5), peak: 0.6 };
  }
  return { hold: 0.35, fadeDur: 6 + Math.min(7, span * 2.4) };
}

export function stampDoodads(world: WorldData, textures: Phaser.Textures.TextureManager): void {
  const g = world.canvas.getContext("2d", { willReadFrequently: true })!;
  g.imageSmoothingEnabled = true;
  for (const d of world.doodads) {
    const tex = doodadTex(d.kind);
    const skin = resolveSkin(textures, tex, camoForBiome(sampleBiome(world, d.x, d.y)));
    if (!textures.exists(skin)) continue;
    const img = textures.get(skin).getSourceImage() as CanvasImageSource;
    const s = d.size;
    g.save();
    g.globalAlpha = 0.9;
    g.translate(d.x / SCALE, d.y / SCALE);
    g.rotate(d.rot * 0.15);
    g.drawImage(img, -s / 2, -s / 2, s, s);
    g.restore();
  }
  g.globalAlpha = 1;
  applyTerrainLight(world.canvas, world.height);
}

function thermalWreckFade(mark: ThermalWreckMark): number {
  if (mark.age <= mark.hold) return 1;
  return Math.max(0, 1 - (mark.age - mark.hold) / mark.fadeDur);
}

function emberGlowFade(g: EmberGlow): number {
  if (g.age <= g.hold) return 1;
  return Math.max(0, 1 - (g.age - g.hold) / g.fadeDur);
}

/** Ground marks: wreck/doodad stamps on the decal layer, craters, embers, thermal wreck marks, scorch / blood / tracks. */
export class GroundMarks {
  wreckLayer!: Phaser.GameObjects.RenderTexture;
  stampBrush!: Phaser.GameObjects.Image;
  thermalWreckMarks: ThermalWreckMark[] = [];
  /** Warm ember patches over fresh craters / hulks (ADD, flicker-fade). */
  emberGlows: EmberGlow[] = [];
  private surfaceWrecks: SurfaceWreck[] = [];

  constructor(readonly s: MissionScene) {}

  /** Per-mission state reset (called from the scene's init). */
  reset(): void {
    this.thermalWreckMarks = [];
    this.emberGlows = [];
    this.surfaceWrecks = [];
  }

  addSurfaceWreck(key: string, x: number, y: number, z: number, rotation: number, ox = 0.5, oy = 0.5): void {
    const w: SurfaceWreck = { image: this.s.add.image(0, 0, key).setOrigin(ox, oy), x, y, z, rotation };
    this.surfaceWrecks.push(w);
    this.syncSurfaceWreck(w);
  }

  updateSurfaceWrecks(): void {
    for (const w of this.surfaceWrecks) this.syncSurfaceWreck(w);
  }

  private syncSurfaceWreck(w: SurfaceWreck): void {
    if (!cameraPointVisible(w.z, w.y)) {
      w.image.setVisible(false);
      return;
    }
    const at = worldToScreen(w.x, w.y, w.z);
    w.image
      .setVisible(true)
      .setPosition(at.x, at.y)
      .setRotation(projectHeading(w.rotation, w.x, w.y, w.z))
      .setScale(at.scale)
      .setDepth(worldDepth(w.z, ZOff.body, w.y));
    applyThermalHeat(w.image, this.s.thermal.on, 0.3);
  }

  stampWreck(
    key: string,
    x: number,
    y: number,
    rotation: number,
    scale = 1,
    alpha = 1,
    ox = 0.5,
    oy = 0.5,
    scaleY?: number,
    frame?: string | number,
    tint?: number,
    thermal = true,
    /** Multiply tint (keeps detail), e.g. wrecks lying in shallows; `tint` is a solid fill. */
    mulTint?: number
  ): void {
    if (!this.s.textures.exists(key)) return;
    const k = WRECK_TEX / WORLD;
    const sy = (scaleY ?? scale) * k;
    this.stampBrush.setCrop();
    if (frame != null) this.stampBrush.setTexture(key, frame);
    else this.stampBrush.setTexture(key);
    this.stampBrush
      .setOrigin(ox, oy)
      .setRotation(rotation)
      .setAlpha(alpha)
      .setScale(scale * k, sy)
      .setPosition(x * k, y * k);
    if (tint != null) {
      this.stampBrush.setTintFill(tint);
      this.stampBrush.setBlendMode(Phaser.BlendModes.NORMAL);
    } else if (mulTint != null) {
      this.stampBrush.setTint(mulTint);
      this.stampBrush.setBlendMode(Phaser.BlendModes.NORMAL);
    } else {
      this.stampBrush.clearTint();
      this.stampBrush.setBlendMode(Phaser.BlendModes.NORMAL);
    }
    this.wreckLayer.draw(this.stampBrush);
    this.stampBrush.clearTint();
    this.stampBrush.setBlendMode(Phaser.BlendModes.NORMAL);
    if (thermal && (key.startsWith("fx_blast_") || (key === "fx_dirt" && tint != null))) {
      this.addThermalWreckMark(
        key,
        x,
        y,
        rotation,
        scale,
        scaleY ?? scale,
        ox,
        oy,
        frame,
        key === "fx_dirt" ? "blood" : "blast"
      );
    }
  }

  addThermalWreckMark(
    key: string,
    x: number,
    y: number,
    rotation: number,
    scaleX: number,
    scaleY: number,
    ox: number,
    oy: number,
    frame?: string | number,
    kind: ThermalWreckKind = "blast",
    /** 1 = full heat; <1 seeds into the fade so settle matches live cool-down. */
    initialFade = 1
  ): void {
    const heatKey = `${key}_heat`;
    const tex = this.s.textures.exists(heatKey) ? heatKey : key;
    const display = thermalWreckDisplayScale(scaleX, scaleY, kind);
    const timing = thermalWreckTiming(kind, display.scaleX, display.scaleY);
    const fade0 = Phaser.Math.Clamp(initialFade, 0.02, 1);
    const age =
      fade0 >= 1 ? 0 : timing.hold + (1 - fade0) * timing.fadeDur;
    const image = this.s.add
      .image(0, 0, tex, frame)
      .setOrigin(ox, oy)
      .setBlendMode(Phaser.BlendModes.NORMAL)
      .clearTint()
      .setAlpha(1)
      .setVisible(false);
    const mark: ThermalWreckMark = {
      image,
      x,
      y,
      z: groundZ(this.s.world, x, y) + 0.25,
      rotation,
      scaleX: display.scaleX,
      scaleY: display.scaleY,
      hold: timing.hold,
      fadeDur: timing.fadeDur,
      peak: timing.peak ?? 1,
      age,
      kind,
    };
    this.thermalWreckMarks.push(mark);
    this.syncThermalWreckMark(mark);
    const cap = 384;
    if (this.thermalWreckMarks.length > cap) {
      this.thermalWreckMarks.shift()!.image.destroy();
    }
  }

  syncThermalWreckMark(mark: ThermalWreckMark): void {
    const visible =
      this.s.thermal.on &&
      this.s.camera.mapBlend < 0.12 &&
      cameraPointVisible(mark.z, mark.y);
    mark.image.setVisible(visible);
    if (!visible) return;
    const at = worldToScreen(mark.x, mark.y, mark.z);
    const fade = thermalWreckFade(mark) * mark.peak;
    const heatTex = mark.image.texture.key.endsWith("_heat");
    // Heat textures: per-pixel heat in alpha. Fallback (no _heat): tint-fill like live sprites.
    if (heatTex) {
      mark.image
        .clearTint()
        .setAlpha(fade)
        .setPosition(at.x, at.y)
        .setRotation(projectHeading(mark.rotation, mark.x, mark.y, mark.z))
        .setScale(mark.scaleX * at.scale, mark.scaleY * at.scale)
        .setDepth(worldDepth(mark.z, -7, mark.y));
    } else {
      applyThermalHeat(mark.image, true, fade * (mark.kind === "shell" || mark.kind === "hulk" ? 0.72 : 0.55));
      mark.image
        .setAlpha(1)
        .setPosition(at.x, at.y)
        .setRotation(projectHeading(mark.rotation, mark.x, mark.y, mark.z))
        .setScale(mark.scaleX * at.scale, mark.scaleY * at.scale)
        .setDepth(worldDepth(mark.z, -7, mark.y));
    }
  }

  syncAllThermalWreckMarks(): void {
    for (const mark of this.thermalWreckMarks) this.syncThermalWreckMark(mark);
  }

  updateThermalWreckMarks(dt: number): void {
    let write = 0;
    for (const mark of this.thermalWreckMarks) {
      if (!mark.image.scene) continue;
      // Cool off in real time even when not viewing thermal, so toggling T
      // doesn't dump a backlog of still-hot stamps.
      mark.age += dt;
      const fade = thermalWreckFade(mark);
      if (fade <= 0) {
        mark.image.destroy();
        continue;
      }
      this.syncThermalWreckMark(mark);
      this.thermalWreckMarks[write++] = mark;
    }
    this.thermalWreckMarks.length = write;
  }

  /** Pick a standard blast crater tex + soft-capped stamp scale. */
  pickBlastCraterStamp(rawScale: number): { key: string; scale: number } {
    const scale = softCapBlastCraterScale(rawScale);
    const i = (Math.random() * FX_BLAST_CELLS) | 0;
    const key = `fx_blast_${i}`;
    return { key: this.s.textures.exists(key) ? key : "fx_blast_0", scale };
  }

  /** Stamp a blast crater using soft-capped scale (no large-tex swap). */
  stampBlastCrater(x: number, y: number, rawScale: number, alpha = 1): void {
    const pick = this.pickBlastCraterStamp(rawScale);
    // Shallows: a water-tinted crater on the bed.
    const wet = isWater(this.s.world, x, y) ? shallowTint(themeOf(this.s.world.theme), SHALLOW_CRATER_MIX) : undefined;
    this.stampWreck(pick.key, x, y, Math.random() * Math.PI * 2, pick.scale, alpha, 0.5, 0.5, undefined, undefined, undefined, true, wet);
  }

  /**
   * Embers on mech/building kill craters and bomb/missile/rocket impacts only —
   * never debris, troops, or gun scars.
   */
  spawnCraterEmbers(x: number, y: number, scale: number): void {
    if (isWater(this.s.world, x, y)) return;
    // Scatter individual baked particles — each crater gets a unique layout.
    const n = Math.max(4, Math.min(14, Math.round(5 + scale * 6 + range(-2, 3))));
    // Long enough to outlast the smoke that drifts over a fresh crater.
    this.spawnEmberGlow(x, y, scale, {
      hold: range(EMBER_HOLD_MIN, EMBER_HOLD_MAX),
      fade: range(EMBER_FADE_MIN, EMBER_FADE_MAX),
      particles: n,
    });
  }

  /**
   * Warm ember scatter over a crater. Places individual ADD particles (+ soft
   * bloom) that hold briefly then flicker-fade out.
   */
  spawnEmberGlow(
    x: number,
    y: number,
    scale: number,
    opts?: {
      hold?: number;
      fade?: number;
      /** How many single ember particles to scatter (default 1). */
      particles?: number;
    }
  ): void {
    if (isWater(this.s.world, x, y)) return;
    const particleKey = "fx_ember_particle";
    if (!this.s.textures.exists(particleKey)) return;
    const n = Math.max(1, opts?.particles ?? 1);
    for (let p = 0; p < n; p++) {
      this.spawnEmberGlowPatch(x, y, scale, particleKey, opts?.hold, opts?.fade);
    }
  }

  spawnEmberGlowPatch(
    x: number,
    y: number,
    scale: number,
    sheet: string,
    hold?: number,
    fade?: number
  ): void {
    const sc = Math.max(0.04, scale * range(0.06, 0.52));
    if (sc < 0.06 && Math.random() > 0.55) return;
    // frameTotal includes Phaser's __BASE frame.
    const frames = this.s.textures.get(sheet).frameTotal - 1;
    const frame = frames > 1 ? (Math.random() * frames) | 0 : 0;
    const rot = Math.random() * Math.PI * 2;
    // Tight radial jitter around the crater center.
    const ang = Math.random() * Math.PI * 2;
    const dist = Math.pow(Math.random(), 0.65) * (6 + scale * 12);
    const ox = Math.cos(ang) * dist;
    const oy = Math.sin(ang) * dist;
    const softKey = `${sheet}_soft`;
    const bloomTex = this.s.textures.exists(softKey) ? softKey : sheet;
    const image = this.s.add
      .image(0, 0, sheet, frame)
      .setOrigin(0.5, 0.5)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setVisible(false);
    const bloom = this.s.add
      .image(0, 0, bloomTex, frame)
      .setOrigin(0.5, 0.5)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setVisible(false);
    const glow: EmberGlow = {
      image,
      bloom,
      x: x + ox,
      y: y + oy,
      z: groundZ(this.s.world, x, y) + 0.4,
      rotation: rot,
      scale: sc,
      bloomMul: range(1.45, 2.05),
      age: 0,
      hold: hold ?? range(0.3, 0.75),
      fadeDur: fade ?? range(1.0, 2.0),
      flickerPhase: Math.random() * Math.PI * 2,
      flickerRate: range(7, 14),
      hue: Math.random(),
    };
    this.emberGlows.push(glow);
    this.syncEmberGlow(glow);
    const cap = 160;
    while (this.emberGlows.length > cap) {
      const old = this.emberGlows.shift()!;
      old.image.destroy();
      old.bloom.destroy();
    }
  }

  syncEmberGlow(g: EmberGlow): void {
    if (!cameraPointVisible(g.z, g.y) || this.s.camera.mapBlend > 0.5) {
      g.image.setVisible(false);
      g.bloom.setVisible(false);
      return;
    }
    const base = emberGlowFade(g);
    if (base <= 0) {
      g.image.setVisible(false);
      g.bloom.setVisible(false);
      return;
    }
    // Mid-drama flicker — stronger than the soft pulse, gentler than full sputter.
    const w1 = Math.sin(g.age * g.flickerRate + g.flickerPhase);
    const w2 = Math.sin(g.age * g.flickerRate * 1.73 + g.flickerPhase * 0.7);
    const w3 = Math.sin(g.age * g.flickerRate * 2.8 + g.flickerPhase * 1.1);
    const pulse = 0.5 + 0.5 * w1 * w2;
    const crackle = 0.5 + 0.5 * w3;
    const flicker = 0.38 + 0.62 * pulse * (0.65 + 0.35 * crackle);
    const sputter = Phaser.Math.Linear(flicker, 0.2 + 0.8 * flicker * flicker, 1 - base);
    const thermal = this.s.thermal.on;
    const crispA = base * sputter * (thermal ? 0.85 : 0.98);
    const bloomA = base * sputter * (thermal ? 0.45 : 0.58);
    const at = worldToScreen(g.x, g.y, g.z);
    const depth = worldDepth(g.z, ZOff.fire * 0.15, g.y);
    const rot = projectHeading(g.rotation, g.x, g.y, g.z);
    g.bloom
      .setVisible(true)
      .setPosition(at.x, at.y)
      .setRotation(rot)
      .setScale(g.scale * g.bloomMul * at.scale)
      .setAlpha(bloomA)
      .setDepth(depth - 0.02);
    g.image
      .setVisible(true)
      .setPosition(at.x, at.y)
      .setRotation(rot)
      .setScale(g.scale * at.scale)
      .setAlpha(crispA)
      .setDepth(depth);
    if (thermal) {
      g.image.setBlendMode(Phaser.BlendModes.NORMAL);
      g.bloom.setBlendMode(Phaser.BlendModes.NORMAL);
      applyThermalHeat(g.image, true, EMBER_THERMAL_HEAT * base);
      applyThermalHeat(g.bloom, true, EMBER_THERMAL_HEAT * base);
    } else {
      g.image.setBlendMode(Phaser.BlendModes.ADD);
      g.bloom.setBlendMode(Phaser.BlendModes.ADD);
      // Redder as they cool, and on flicker dips.
      const cool = Phaser.Math.Clamp(g.hue * 0.55 + (1 - base) * 0.6 + (1 - sputter) * 0.25, 0, 1);
      g.image.setTint(lerpRgb(EMBER_HOT, EMBER_COOL, cool));
      g.bloom.setTint(lerpRgb(EMBER_BLOOM_HOT, EMBER_BLOOM_COOL, cool));
    }
  }

  updateEmberGlows(dt: number): void {
    let w = 0;
    for (const g of this.emberGlows) {
      if (!g.image.scene) continue;
      g.age += dt;
      if (emberGlowFade(g) <= 0) {
        g.image.destroy();
        g.bloom.destroy();
        continue;
      }
      this.syncEmberGlow(g);
      this.emberGlows[w++] = g;
    }
    this.emberGlows.length = w;
  }

  /** Light bounce scorch, stretched along incoming debris travel. */
  stampDebrisBounceScorch(x: number, y: number, vx: number, vy: number): void {
    if (isWater(this.s.world, x, y)) return;
    const key = `fx_blast_${(Math.random() * 4) | 0}`;
    const scarKey = this.s.textures.exists(key) ? key : "fx_blast_0";
    if (!this.s.textures.exists(scarKey)) return;
    const spd = Math.hypot(vx, vy);
    const ang = spd > 8 ? Math.atan2(vy, vx) : Math.random() * Math.PI * 2;
    const base = range(0.07, 0.12);
    const stretch = 1.2 + Math.min(0.55, spd * 0.002);
    const sx = base * stretch * range(0.9, 1.12);
    const sy = base * range(0.42, 0.62);
    const alpha = range(0.16, 0.28);
    this.stampWreck(scarKey, x, y, ang, sx, alpha, 0.5, 0.5, sy, undefined, undefined, false);
  }

  stampLightBlast(x: number, y: number, vx: number, vy: number): void {
    if (isWater(this.s.world, x, y)) return;
    const key = `fx_blast_${(Math.random() * 4) | 0}`;
    if (!this.s.textures.exists(key) && !this.s.textures.exists("fx_blast_0")) return;
    const spd = Math.hypot(vx, vy);
    const ang = spd > 10 ? Math.atan2(vy, vx) : Math.random() * Math.PI * 2;
    const sc = range(0.065, 0.145);
    const stretch = 1 + Math.min(0.7, spd * 0.0024);
    this.stampWreck(
      this.s.textures.exists(key) ? key : "fx_blast_0",
      x + range(-2.5, 2.5),
      y + range(-2.5, 2.5),
      ang + range(-0.25, 0.25),
      sc * stretch,
      range(0.28, 0.5),
      0.5,
      0.5,
      sc * range(0.72, 0.94)
    );
  }

  stampDirtSmears(x: number, y: number, vx: number, vy: number): void {
    if (isWater(this.s.world, x, y) || !this.s.textures.exists("fx_dirt")) return;
    const n = 3 + ((Math.random() * 3) | 0);
    const spd = Math.hypot(vx, vy);
    const ang = spd > 12 ? Math.atan2(vy, vx) : Math.random() * Math.PI * 2;
    const ux = Math.cos(ang);
    const uy = Math.sin(ang);
    const px = -uy;
    const py = ux;
    for (let i = 0; i < n; i++) {
      const span = 16 + Math.min(28, spd * 0.07);
      const along = range(-0.22 * span, 0.78 * span);
      const side = range(-6, 6);
      const frame = (Math.random() * FX_VARIANTS) | 0;
      const sc = range(0.28, 0.58);
      const stretch = range(1.35, 2.3) + Math.min(0.75, spd * 0.0025);
      const thin = range(0.12, 0.24);
      this.stampWreck(
        "fx_dirt",
        x + ux * along + px * side,
        y + uy * along + py * side,
        ang + range(-0.19, 0.19),
        sc * stretch,
        range(0.36, 0.7),
        0.12,
        0.5,
        sc * thin,
        frame
      );
    }
  }

  /**
   * Paint a blood dirt particle onto the terrain with multiply (does not alter the live sim particle).
   * Matches mid-life dirt size/rotation from syncSimParticleSprites.
   */
  stampBloodWorld(s: SimParticle): void {
    if (!s.blood || isWater(this.s.world, s.x, s.y) || !this.s.textures.exists(s.tex)) return;
    const age = 1 - Phaser.Math.Clamp(s.life / Math.max(s.max, 1e-6), 0, 1);
    const fade = 1 - age;
    const grow = 1 - Math.pow(1 - age, 3.4);
    const thick = s.scale * (0.06 + 3.6 * grow);
    const late = Math.pow(Phaser.Math.Clamp((age - 0.52) / 0.48, 0, 1), 1.7);
    const sx = thick * (0.85 + 0.55 * grow);
    const sy = thick * (0.28 + 0.42 * late);
    const rot = s.heading + s.angJit * 0.14;
    const ox = 0.12;
    const oy = 0.5;

    const tex = this.s.textures.get(s.tex);
    const fr = tex.get(s.frame);
    const srcImg = tex.getSourceImage() as CanvasImageSource;
    const tw = fr.cutWidth;
    const th = fr.cutHeight;
    if (tw < 1 || th < 1) return;

    if (!bloodStampScratch || bloodStampScratch.width < tw || bloodStampScratch.height < th) {
      bloodStampScratch = document.createElement("canvas");
      bloodStampScratch.width = tw;
      bloodStampScratch.height = th;
    }
    const sg = bloodStampScratch.getContext("2d", { willReadFrequently: true })!;
    sg.clearRect(0, 0, tw, th);
    sg.globalCompositeOperation = "source-over";
    sg.drawImage(srcImg, fr.cutX, fr.cutY, tw, th, 0, 0, tw, th);
    sg.globalCompositeOperation = "source-in";
    const cr = (s.tint >> 16) & 255;
    const cg = (s.tint >> 8) & 255;
    const cb = s.tint & 255;
    sg.fillStyle = `rgb(${cr},${cg},${cb})`;
    sg.fillRect(0, 0, tw, th);
    sg.globalCompositeOperation = "source-over";

    const dw = (tw * sx) / SCALE;
    const dh = (th * sy) / SCALE;
    const g = this.s.world.canvas.getContext("2d", { willReadFrequently: true })!;
    g.save();
    g.globalCompositeOperation = "multiply";
    g.globalAlpha = Phaser.Math.Clamp(0.35 + fade * 0.65, 0.2, 0.85);
    g.translate(s.x / SCALE, s.y / SCALE);
    g.rotate(rot);
    g.drawImage(bloodStampScratch, 0, 0, tw, th, -ox * dw, -oy * dh, dw, dh);
    g.restore();
    this.addThermalWreckMark(
      s.tex,
      s.x,
      s.y,
      rot,
      sx,
      sy,
      ox,
      oy,
      s.frame,
      "blood"
    );
  }

  /** Soft, patchy tire print for bouncing / rolling wheel debris. */
  stampWheelTrack(x: number, y: number, ang: number, scale = 0.72, alpha = 0.38): void {
    if (isWater(this.s.world, x, y)) return;
    // Skip often so the trail reads as broken / inconsistent.
    if (Math.random() < 0.38) return;
    const key = this.s.textures.exists("fx_track_mono")
      ? "fx_track_mono"
      : this.s.textures.exists("fx_track_tire")
        ? "fx_track_tire"
        : "fx_track_mono";
    if (!this.s.textures.exists(key)) return;
    const sc = scale * range(0.72, 1.18);
    const a = alpha * range(0.55, 1.15);
    const yaw = ang + range(-0.28, 0.28);
    const ox = range(-2.2, 2.2);
    const oy = range(-2.2, 2.2);
    this.stampWreck(
      key,
      x + ox,
      y + oy,
      yaw + Math.PI / 2,
      sc * range(0.75, 1.05),
      Phaser.Math.Clamp(a, 0.12, 0.55),
      0.5,
      0.5,
      sc * range(0.95, 1.45)
    );
  }

  stampSoldierBlood(u: Unit, ox: number, oy: number, ang: number): void {
    if (!this.s.textures.exists("fx_dirt") || isWater(this.s.world, u.x, u.y)) return;
    const blood = [0xee2828, 0xdd2020, 0xe83838, 0xcc1a1a][(Math.random() * 4) | 0]!;
    const sc = range(0.95, 1.55);
    this.stampWreck(
      "fx_dirt",
      u.x + ox,
      u.y + oy,
      ang,
      sc * range(0.9, 1.35),
      range(0.82, 0.98),
      0.5,
      0.5,
      sc * range(0.55, 0.95),
      (Math.random() * FX_VARIANTS) | 0,
      blood
    );
  }
}
