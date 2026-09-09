import Phaser from "phaser";
import { bakeAll, bakeRosterArt } from "./bake";
import { bakeCamo, camoForBiome, resolveSkin } from "./camo";
import {
  debrisKeys,
  heightOf,
  hulkOf,
  nextId,
  radius,
  stats,
  textureOf,
  wheelDebrisKeys,
  playerLoadout,
  SHOT_ORIGIN,
  SHOT_TAIL,
  MISSILE_IGNITE,
  HELLFIRE_LOCK_T,
  HELLFIRE_SEEK_DELAY,
  type Debris,
  type Shot,
  type SimParticle,
  type SimParticleKind,
  type Unit,
  type PlayerWpnSpec,
} from "./combat";
import { Layer, ZOff, Z_GRAVITY, worldDepth } from "./depth";
import { range } from "./rng";
import { CRUISE_AGL, Heli, MAX_AGL } from "./heli";
import { isAerial, isGroundVehicle, isOrganic, hasSoftBlood, specOf, driveOf, spawnAngle, pickTroop, labelOf, allKinds, gunsOf, rollParts, crewOf, muzzlesOfGun, type ShotKind, type ShotLook } from "./roster";
import {
  circumRadiusOf,
  distToFootprint,
  footprintInto,
  footprintOf,
  footprintOverlap,
  pointInFootprint,
} from "./footprint";
import { lookupSpriteMuzzles, lookupSpriteOrigin } from "./spriteOrigin";
import { allCrafts, craftAgility, craftCameraScale, craftComposite, craftCompositePartScale, craftExhaustMounts, craftFixedMuzzles, craftGunMount, craftGunMounts, craftGunOrigin, craftOf, craftOrigin, craftRotorMounts, craftSecondaryMounts, craftStartingAmmo, rotorDrawSpan, selectCraft, type CraftComposite } from "./craft";
import { allMissions, missionOf, selectMission } from "./mission";
import { HEIGHT_BRUSHES, bakeHeightBrushes } from "./brushes";
import { configRigsAnyOpen, installConfigRigHotkeys } from "./configRigs";
import { applyEdgeLight, clearEdgeLight, ensureEdgeLightPipeline } from "./edgeLight";
import { createTerrain25D, type Terrain25D } from "./terrain25d";
import { LOAD_TIPS } from "./tips";
import { fbm } from "./noise";
import { preloadArt, prepareArt, extractBiomeTiles, bakeHeliHudWireTexture, bakeHurtVignetteTexture, heliHudWireUv, shadowAlpha, shadowKey, spriteUvPos, FX_VARIANTS, nameGameTexture, nameGeneratedTextures, spritePivot, type HeliHudWireBake } from "./sprites";
import {
  generateWorld,
  generateWorldAsync,
  worldFromGen,
  groundSlope,
  groundZ,
  worldToScreen,
  setCamera25DFocus,
  cameraPointVisible,
  screenToWorldAtZ,
  screenToWorldOnGround,
  screenVelX,
  screenVelY,
  projectHeading,
  zScale,
  camZoomAt,
  castZ,
  castShadowToGround,
  isWater,
  paintHeightMap,
  paintHeightMapRect,
  stampHeightBrush,
  rebuildWorldPatch,
  paintRoadsRect,
  applyTerrainLight,
  sampleBiome,
  waterSurfaceZ,
  GROUND_H_ZERO,
  GROUND_Z_SCALE,
  SCALE,
  WORLD,
  WRECK_TEX,
  CamTune,
  doodadTex,
  type HvSpec,
  type WorldData,
  type Biome,
} from "./world";

type FxClass = "short" | "fire" | "smoke" | "dust";
type FxPolicy = {
  frameCap: number;
  activeCap: number;
  emitted: number;
  emitters: Set<Phaser.GameObjects.Particles.ParticleEmitter>;
};
type BurstParticle = Phaser.GameObjects.Particles.Particle & {
  burstVx?: number;
  burstVy?: number;
  burstHeading?: number;
  launchScale?: number;
  launchStretch?: number;
  swirl?: number;
};

/** Overlay guns are drawn barrel-up (same as hulls). World aim 0 is +X, so +90°. */
function gunWorldRot(_tex: string, aim: number): number {
  return aim + Math.PI / 2;
}

/** Absolute world-Z shot ceilings (not AGL). Ballpark of old +28 / +70 AGL margins. */
const SHOT_Z_REF = (1 - GROUND_H_ZERO) * GROUND_Z_SCALE + MAX_AGL;
const SHOT_Z_MAX = SHOT_Z_REF * 1.08;
const HELLFIRE_Z_MAX = SHOT_Z_REF * 1.21;
/** Apache M230 cadence is the full-density reference for per-shot muzzle/impact particles. */
const PROJECTILE_FX_BASE_INTERVAL = 0.07;
const ENEMY_PROJECTILE_FX_MUL = 0.72;

function projectileFxScale(from: Shot["from"], effectiveInterval = PROJECTILE_FX_BASE_INTERVAL): number {
  const cadence = Phaser.Math.Clamp(effectiveInterval / PROJECTILE_FX_BASE_INTERVAL, 0.18, 1);
  return cadence * (from === "enemy" ? ENEMY_PROJECTILE_FX_MUL : 1);
}

function scaledProjectileFxCount(base: number, scale: number): number {
  return base <= 0 ? 0 : Math.max(1, Math.round(base * scale));
}

const PERF_LABELS = [
  "frame",
  "scene",
  "player",
  "unit sim",
  "unit draw",
  "shot sim",
  "shot draw",
  "debris sim",
  "debris draw",
  "sim particle sim",
  "sim particle draw",
  "target/fx",
  "scene other",
  "outside/vsync",
] as const;
const PERF_WINDOW = 300;
const BLAST_RING_FRAMES = 12;

const DEBUG_MENU_ITEMS = [
  { section: "GAMEPLAY" },
  { action: "seed", label: "Mission seed" },
  { action: "noDamage", label: "No damage" },
  { action: "infAmmo", label: "Infinite ammo" },
  { section: "DIAGNOSTICS" },
  { action: "performance", label: "Performance", shortcut: "P" },
  { action: "height", label: "Height + colliders", shortcut: "K" },
  { action: "ai", label: "AI paths" },
  { action: "blast", label: "Blast radii" },
  { section: "RENDERING" },
  { action: "terrainMesh", label: "Terrain mesh" },
  { action: "fx", label: "Post FX", shortcut: "F" },
  { section: "TOOLS" },
  { action: "relief", label: "Terrain editor", shortcut: "E" },
  { action: "camera", label: "Camera…" },
  { action: "spawn", label: "Spawn…" },
] as const;

const CAMERA_PRESETS = [
  { name: "SUBTLE", pitch: 0.025, cam: 1300, zoom0: 1.45 },
  { name: "CURRENT", pitch: 0.05, cam: 900, zoom0: 1.45 },
  { name: "DRAMATIC", pitch: 0.09, cam: 600, zoom0: 1.45 },
] as const;

function shotLookOf(s: Shot): ShotLook {
  if (s.look) return s.look;
  if (s.kind === "rocket") return "shot_rocket";
  if (s.kind === "lock-on-missile") return "shot_hellfire";
  if (s.kind === "guided-missile") return "shot_tow";
  return "shot_chain";
}

/** Soft rim where map-edge steering ramps up. */
const MAP_EDGE_MARGIN = 280;
/** Hard pad units cannot cross. */
const MAP_EDGE_PAD = 40;

type TextureAlphaBounds = {
  width: number;
  height: number;
  alpha: Uint8ClampedArray;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

/** Scratch canvas for tinting blood dirt frames before multiply-stamping terrain. */
let bloodStampScratch: HTMLCanvasElement | null = null;

export class BootScene extends Phaser.Scene {
  private bootSub!: Phaser.GameObjects.Text;
  private bootBar!: Phaser.GameObjects.Graphics;
  private bootBarW = 320;
  private bootBarH = 8;
  private bootBarX = 0;
  private bootBarY = 0;

  constructor() {
    super("boot");
  }

  init(): void {
    this.cameras.main.setBackgroundColor("#1c1812");
    // Phaser canvas is up — drop the HTML shell so the in-game bar is visible.
    hideHtmlBoot();
  }

  preload(): void {
    const { width: w, height: h } = this.scale;
    this.bootBarW = Math.min(320, w - 80);
    this.bootBarX = w / 2 - this.bootBarW / 2;
    this.bootBarY = h * 0.58;

    this.add
      .text(w / 2, h * 0.38, "HELISTRIKE", {
        fontFamily: "Black Ops One, Impact, sans-serif",
        fontSize: "64px",
        color: "#e8b84a",
        stroke: "#1c1812",
        strokeThickness: 6,
      })
      .setOrigin(0.5);

    this.bootSub = this.add
      .text(w / 2, h * 0.5, "LOADING ASSETS  ·  0%", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "14px",
        color: "#8a8470",
      })
      .setOrigin(0.5);

    this.bootBar = this.add.graphics();
    this.drawBootBar(0);

    this.load.on("progress", (v: number) => {
      // Leave headroom for CPU bake after fetch.
      this.drawBootBar(v * 0.72, `LOADING ASSETS  ·  ${Math.round(v * 100)}%`);
    });

    preloadArt(this);
  }

  async create(): Promise<void> {
    const steps: { label: string; run: () => void; t: number }[] = [
      { label: "BAKING BASE", t: 0.78, run: () => bakeAll(this.textures) },
      {
        label: "PREPARING ART",
        t: 0.88,
        run: () => {
          try {
            prepareArt(this.textures);
          } catch {
            /* keep baked placeholders */
          }
        },
      },
      { label: "ROSTER ART", t: 0.94, run: () => bakeRosterArt(this.textures) },
      { label: "CAMO", t: 0.99, run: () => bakeCamo(this.textures) },
    ];

    for (const step of steps) {
      this.drawBootBar(step.t, `${step.label}  ·  ${Math.round(step.t * 100)}%`);
      await waitFrame();
      step.run();
      await waitFrame();
    }

    this.drawBootBar(1, "READY  ·  100%");
    await waitFrame();
    this.scene.start("menu");
  }

  private drawBootBar(t: number, label?: string): void {
    const u = Phaser.Math.Clamp(t, 0, 1);
    if (label) this.bootSub.setText(label);
    const g = this.bootBar;
    const { bootBarX: x, bootBarY: y, bootBarW: w, bootBarH: h } = this;
    g.clear();
    g.fillStyle(0x12100c, 1);
    g.fillRect(x, y, w, h);
    g.fillStyle(0xe8b84a, 1);
    g.fillRect(x, y, w * u, h);
    g.lineStyle(1, 0x3a3428, 1);
    g.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);
    g.lineStyle(1, 0x5c5344, 0.55);
    for (let i = 1; i < 10; i++) {
      const px = x + (w * i) / 10;
      const long = i === 5;
      g.lineBetween(px, y - (long ? 4 : 2), px, y + h + (long ? 4 : 2));
    }
  }
}

function waitFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function hideHtmlBoot(): void {
  const splash = document.getElementById("boot-splash");
  if (!splash || splash.classList.contains("is-done")) return;
  splash.classList.add("is-done");
  window.setTimeout(() => splash.remove(), 400);
}

function ensureMissionPreviews(textures: Phaser.Textures.TextureManager): void {
  const width = 160;
  const height = 160;
  const missions = allMissions();
  for (let m = 0; m < missions.length; m++) {
    const mission = missions[m]!;
    const key = `mission_preview_${mission.kind}`;
    if (textures.exists(key)) continue;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const g = canvas.getContext("2d")!;
    const img = g.createImageData(width, height);
    const p = mission.profile;
    const seed = 8101 + m * 977;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const nx = x / width;
        const ny = y / height;
        const ridge = 1 - Math.abs(fbm(nx * 3.1 + 20, ny * 3.1, seed + 9, 3) * 2 - 1);
        let h = fbm(nx * 6.2, ny * 6.2, seed, 4, 2.05, 0.52) * 0.72 + ridge * 0.28;
        const radial = Math.pow(Math.hypot(nx - 0.5, ny - 0.5) * 1.15, 2);
        h = 0.5 + (h - 0.5) * p.relief;
        h -= radial * p.edgeFalloff;
        h += p.landBias;
        if (mission.kind === "river_run") {
          const riverY = 0.48 + Math.sin(nx * 11 + 0.7) * 0.13;
          if (Math.abs(ny - riverY) < 0.035) h = 0.27;
        }
        let color: [number, number, number];
        if (h < 0.34) color = [31, 75, 86];
        else if (h < 0.4) color = [174, 145, 87];
        else if (h > 0.72) color = [180, 171, 145];
        else if (h > 0.62) color = [91, 84, 66];
        else color = [76, 105, 65];
        const shade = 0.76 + fbm(nx * 18, ny * 18, seed + 41, 2) * 0.38;
        const i = (y * width + x) * 4;
        img.data[i] = color[0] * shade;
        img.data[i + 1] = color[1] * shade;
        img.data[i + 2] = color[2] * shade;
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    const vignette = g.createLinearGradient(0, 0, 0, height);
    vignette.addColorStop(0, "rgba(0,0,0,0.08)");
    vignette.addColorStop(1, "rgba(0,0,0,0.58)");
    g.fillStyle = vignette;
    g.fillRect(0, 0, width, height);
    textures.addCanvas(key, canvas);
  }
}

function createControlLegend(
  scene: Phaser.Scene,
  panelW: number,
  y: number
): Phaser.GameObjects.GameObject[] {
  const objects: Phaser.GameObjects.GameObject[] = [];
  const controlW = panelW / 7;
  const x0 = -panelW / 2;
  const controlX = (i: number) => x0 + i * controlW + controlW / 2;
  objects.push(
    scene.add.rectangle(0, y, panelW, 72, 0x0b0a08, 0.82).setStrokeStyle(1, 0x6f6244, 0.7)
  );
  const keycap = (x: number, py: number, label: string, keyW = 24, keyH = 20) => {
    const g = scene.add.graphics();
    g.fillStyle(0x18150f, 0.96).fillRoundedRect(x - keyW / 2, py - keyH / 2, keyW, keyH, 3);
    g.lineStyle(1.4, 0xe8b84a, 0.9).strokeRoundedRect(x - keyW / 2, py - keyH / 2, keyW, keyH, 3);
    objects.push(g);
    objects.push(
      scene.add
      .text(x, py, label, {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: keyW > 36 ? "9px" : "11px",
        color: "#f2d579",
      })
      .setOrigin(0.5)
    );
  };
  const mouse = (x: number, py: number, leftLit: boolean, wheelLit = false) => {
    const g = scene.add.graphics();
    if (leftLit) g.fillStyle(0xe8b84a, 0.48).fillRoundedRect(x - 12, py - 17, 12, 15, 3);
    g.lineStyle(1.5, 0xe8b84a, 0.95).strokeRoundedRect(x - 12, py - 17, 24, 34, 9);
    g.lineBetween(x, py - 16, x, py - 3);
    g.lineBetween(x - 11, py - 2, x + 11, py - 2);
    g.fillStyle(wheelLit ? 0xf2d579 : 0x6f6244, 1).fillRoundedRect(x - 2, py - 12, 4, 8, 2);
    objects.push(g);
  };
  const label = (i: number, value: string) => {
    objects.push(
      scene.add
      .text(controlX(i), y + 25, value, {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "9px",
        color: "#d8d0ba",
      })
      .setOrigin(0.5)
    );
  };
  const iconY = y - 6;
  const moveX = controlX(0);
  keycap(moveX, iconY - 10, "W", 20, 18);
  keycap(moveX - 22, iconY + 10, "A", 20, 18);
  keycap(moveX, iconY + 10, "S", 20, 18);
  keycap(moveX + 22, iconY + 10, "D", 20, 18);
  label(0, "MOVE");
  mouse(controlX(1), iconY, true);
  label(1, "AIM / FIRE");
  keycap(controlX(2) - 29, iconY, "SPACE", 52, 22);
  keycap(controlX(2) + 31, iconY, "SHIFT", 50, 22);
  label(2, "POP-UP / NAP-OF-EARTH");
  const weaponX = controlX(3);
  for (let i = 0; i < 4; i++) keycap(weaponX - 42 + i * 20, iconY, String(i + 1), 16, 19);
  mouse(weaponX + 46, iconY, false, true);
  label(3, "SELECT WEAPON");
  keycap(controlX(4), iconY, "M", 30, 26);
  label(4, "MAP");
  keycap(controlX(5), iconY, "T", 30, 26);
  label(5, "THERMAL VISION");
  keycap(controlX(6), iconY, "H", 30, 26);
  label(6, "HELP / TIPS");
  return objects;
}

function drawControlLegend(scene: Phaser.Scene, width: number, y: number): void {
  const panelW = Math.min(1040, width - 64);
  scene.add.container(width / 2, 0, createControlLegend(scene, panelW, y));
}

function craftPreviewExhaustTint(kind: string): number {
  if (kind === "prometheus") return 0xc86cff;
  if (kind === "warthog") return 0xff8a2c;
  if (kind === "lightning_ii") return 0xbfeaff;
  return 0x70d8ff;
}

export class MenuScene extends Phaser.Scene {
  constructor() {
    super("menu");
  }

  create(): void {
    const { width: w, height: h } = this.scale;
    this.cameras.main.setBackgroundColor("#1c1812");
    ensureMissionPreviews(this.textures);
    ensureExhaustGlow(this.textures);
    if (this.textures.exists("menu_splash")) {
      const bg = this.add.image(w / 2, h / 2, "menu_splash").setDepth(0);
      const sx = w / bg.width;
      const sy = h / bg.height;
      bg.setScale(Math.max(sx, sy));
      this.add
        .rectangle(w / 2, h / 2, w, h, 0x0c0a08, 0.58)
        .setDepth(1)
        .setName("menu_scrim");
    }
    this.add
      .text(w / 2, 54, "HELISTRIKE", {
        fontFamily: "Black Ops One, Impact, sans-serif",
        fontSize: "54px",
        color: "#e8b84a",
        stroke: "#1c1812",
        strokeThickness: 5,
      })
      .setOrigin(0.5)
      .setDepth(2)
      .setName("menu_title");
    const crafts = allCrafts();
    const missions = allMissions();
    let craftIndex = Math.max(0, crafts.findIndex((c) => c.kind === craftOf().kind));
    let missionIndex = Math.max(0, missions.findIndex((m) => m.kind === missionOf().kind));
    let row = 0;
    let customParamIndex = 0;

    const craftHeader = this.add
      .text(w / 2, 111, "AIRFRAME", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "13px",
        color: "#e8b84a",
        stroke: "#1c1812",
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setDepth(2);
    const missionHeader = this.add
      .text(w / 2, 374, "OPERATION", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "13px",
        color: "#e8e0cc",
        stroke: "#1c1812",
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setDepth(2);

    const craftW = 112;
    const craftH = 108;
    const craftCards = crafts.map((craft, i) => {
      const x = w / 2;
      const frame = this.add
        .rectangle(x, 190, craftW, craftH, 0x0c0b09, 0.82)
        .setStrokeStyle(1, 0x5d5544, 0.8)
        .setDepth(2)
        .setInteractive({ useHandCursor: true });
      const art = this.add.image(x, 181, craft.body).setDepth(3);
      const artScale = Math.min(104 / Math.max(1, art.width), 82 / Math.max(1, art.height));
      art.setScale(artScale);
      const composite = craftComposite(craft);
      const rotors = composite.rotors.map((part, rotorI) => {
        const rotor = this.add
          .image(x, 181, part.tex)
          .setOrigin(part.origin.x, part.origin.y)
          .setDepth(4);
        this.tweens.add({
          targets: rotor,
          rotation: (rotorI % 2 ? -1 : 1) * Math.PI * 2,
          duration: 60000,
          repeat: -1,
          ease: "Linear",
        });
        return rotor;
      });
      const exhaustMounts = craftExhaustMounts(craft);
      const exhaustTint = craftPreviewExhaustTint(craft.kind);
      const exhaustGlows = exhaustMounts.map((_, exhaustI) => {
        const glow = this.add
          .image(x, 181, "fx_exhaust_glow")
          .setBlendMode(Phaser.BlendModes.ADD)
          .setTint(exhaustTint)
          .setDepth(8.5)
          .setVisible(false);
        this.tweens.add({
          targets: glow,
          alpha: { from: 0.5 + (exhaustI % 2) * 0.08, to: 0.96 },
          duration: 780 + exhaustI * 90,
          yoyo: true,
          repeat: -1,
          ease: "Sine.InOut",
        });
        return glow;
      });
      const label = this.add
        .text(x, 229, craft.name.toUpperCase(), {
          fontFamily: "Share Tech Mono, monospace",
          fontSize: "11px",
          color: "#cfc7b1",
          align: "center",
        })
        .setOrigin(0.5)
        .setDepth(5);
      frame.on("pointerdown", () => {
        row = 0;
        craftIndex = i;
        refreshSelection();
      });
      return {
        frame,
        art,
        label,
        artScale,
        rotorParts: composite.rotors,
        rotors,
        exhaustMounts,
        exhaustGlows,
      };
    });

    const missionW = 134;
    const missionH = 134;
    const missionCards = missions.map((mission, i) => {
      const x = w / 2;
      const frame = this.add
        .rectangle(x, 450, missionW, missionH, 0x0b0a08, 0.88)
        .setStrokeStyle(1, 0x5d5544, 0.8)
        .setDepth(2)
        .setInteractive({ useHandCursor: true });
      const art = this.add
        .image(x, 450, `mission_preview_${mission.kind}`)
        .setDisplaySize(missionW - 8, missionH - 8)
        .setDepth(3);
      const artScaleX = art.scaleX;
      const artScaleY = art.scaleY;
      const strip = this.add.rectangle(x, 497, missionW - 8, 28, 0x090908, 0.88).setDepth(3);
      const label = this.add
        .text(x, 497, mission.label, {
          fontFamily: "Share Tech Mono, monospace",
          fontSize: "14px",
          color: "#d8d0ba",
        })
        .setOrigin(0.5)
        .setDepth(4);
      frame.on("pointerdown", () => {
        row = 1;
        missionIndex = i;
        refreshSelection();
      });
      return { frame, art, strip, label, artScaleX, artScaleY };
    });

    const carouselArrow = (x: number, y: number, dir: -1 | 1, targetRow: 0 | 1) => {
      const arrow = this.add
        .text(x, y, dir < 0 ? "‹" : "›", {
          fontFamily: "Share Tech Mono, monospace",
          fontSize: "42px",
          color: "#e8b84a",
          stroke: "#1c1812",
          strokeThickness: 4,
        })
        .setOrigin(0.5)
        .setDepth(8)
        .setInteractive({ useHandCursor: true });
      arrow.on("pointerdown", () => {
        row = targetRow;
        if (targetRow === 0) craftIndex = (craftIndex + dir + crafts.length) % crafts.length;
        else missionIndex = (missionIndex + dir + missions.length) % missions.length;
        refreshSelection();
      });
      return arrow;
    };
    carouselArrow(w / 2 - 112, 179, -1, 0);
    carouselArrow(w / 2 + 112, 179, 1, 0);
    carouselArrow(w / 2 - 112, 450, -1, 1);
    carouselArrow(w / 2 + 112, 450, 1, 1);

    const carouselDots = (count: number, y: number, targetRow: 0 | 1) =>
      Array.from({ length: count }, (_, i) => {
        const x = w / 2 + (i - (count - 1) / 2) * 14;
        const dot = this.add
          .circle(x, y, 3.5, 0x5d5544, 0.9)
          .setStrokeStyle(1, 0x1c1812, 0.9)
          .setDepth(8)
          .setInteractive({ useHandCursor: true });
        dot.on("pointerdown", () => {
          row = targetRow;
          if (targetRow === 0) craftIndex = i;
          else missionIndex = i;
          refreshSelection();
        });
        return dot;
      });
    const craftDots = carouselDots(crafts.length, 242, 0);
    const missionDots = carouselDots(missions.length, 524, 1);

    const statDefs = [
      { label: "SPEED", max: Math.max(...crafts.map((craft) => craft.maxSpeed)), value: (craft: (typeof crafts)[number]) => craft.maxSpeed },
      { label: "AGILITY", max: 1, value: (craft: (typeof crafts)[number]) => craftAgility(craft) },
      { label: "SIZE", max: Math.max(...crafts.map((craft) => craft.sizeM)), value: (craft: (typeof crafts)[number]) => craft.sizeM },
      { label: "ARMOR", max: Math.max(...crafts.map((craft) => craft.health)), value: (craft: (typeof crafts)[number]) => craft.health },
    ];
    this.add
      .rectangle(w / 2, 304, 700, 112, 0x0b0a08, 0.76)
      .setStrokeStyle(1, 0x554c39, 0.65)
      .setDepth(2);
    const infoRule = this.add.graphics().setDepth(3);
    infoRule.lineStyle(1, 0x554c39, 0.7).lineBetween(w / 2 + 20, 256, w / 2 + 20, 352);
    const statLabelX = w / 2 - 315;
    const statBarX = w / 2 - 205;
    this.add
      .text(statLabelX, 253, "FLIGHT PROFILE", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "9px",
        color: "#aaa28f",
        stroke: "#1c1812",
        strokeThickness: 2,
      })
      .setDepth(3);
    statDefs.forEach((stat, i) => {
      this.add
        .text(statLabelX, 271 + i * 20, stat.label, {
          fontFamily: "Share Tech Mono, monospace",
          fontSize: "10px",
          color: "#d8d0ba",
          stroke: "#1c1812",
          strokeThickness: 2,
        })
        .setOrigin(0, 0.5)
        .setDepth(3);
    });
    const statBars = this.add.graphics().setDepth(3);
    const drawStatBars = (craft: (typeof crafts)[number]) => {
      statBars.clear();
      const segments = 8;
      const segmentW = 11;
      const segmentH = 6;
      const segmentGap = 3;
      statDefs.forEach((stat, statI) => {
        const filled = Math.max(1, Math.round((stat.value(craft) / stat.max) * segments));
        const y = 268 + statI * 20;
        for (let segment = 0; segment < segments; segment++) {
          const x = statBarX + segment * (segmentW + segmentGap);
          statBars.fillStyle(segment < filled ? 0xe8b84a : 0x302b22, segment < filled ? 0.96 : 0.82);
          statBars.fillRoundedRect(x, y, segmentW, segmentH, 2);
          statBars.lineStyle(1, segment < filled ? 0xf2d579 : 0x5d5544, 0.7);
          statBars.strokeRoundedRect(x, y, segmentW, segmentH, 2);
        }
      });
    };

    const weaponX = w / 2 + 50;
    this.add
      .text(weaponX, 253, "LOADOUT", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "9px",
        color: "#aaa28f",
        stroke: "#1c1812",
        strokeThickness: 2,
      })
      .setDepth(3);
    this.add
      .text(weaponX + 255, 253, "AMMO", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "9px",
        color: "#aaa28f",
        stroke: "#1c1812",
        strokeThickness: 2,
      })
      .setOrigin(1, 0)
      .setDepth(3);
    const weaponRows = Array.from({ length: 4 }, (_, i) => {
      const y = 271 + i * 20;
      const frame = this.add
        .rectangle(weaponX + 128, y, 270, 17, i % 2 ? 0x15120d : 0x1b1710, 0.78)
        .setDepth(3);
      const slot = this.add
        .text(weaponX + 7, y, String(i + 1), {
          fontFamily: "Share Tech Mono, monospace",
          fontSize: "10px",
          color: "#e8b84a",
          stroke: "#1c1812",
          strokeThickness: 2,
        })
        .setOrigin(0.5)
        .setDepth(4);
      const name = this.add
        .text(weaponX + 23, y, "", {
          fontFamily: "Share Tech Mono, monospace",
          fontSize: "10px",
          color: "#d8d0ba",
        })
        .setOrigin(0, 0.5)
        .setDepth(4);
      const ammo = this.add
        .text(weaponX + 255, y, "", {
          fontFamily: "Share Tech Mono, monospace",
          fontSize: "10px",
          color: "#f2d579",
        })
        .setOrigin(1, 0.5)
        .setDepth(4);
      return { frame, slot, name, ammo };
    });

    const detailTxt = this.add
      .text(w / 2, 542, "", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "11px",
        color: "#d8d0ba",
        align: "center",
        lineSpacing: 3,
        wordWrap: { width: Math.min(1120, w - 80) },
        stroke: "#1c1812",
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setDepth(2);

    const customMission = missions.find((mission) => mission.kind === "custom")!;
    const customProfile = customMission.profile;
    const forceMixes = ["mixed", "naval", "heavy"] as const;
    const customParams = [
      {
        label: "LAND",
        value: () => customProfile.landBias.toFixed(2),
        adjust: (dir: number) => {
          customProfile.landBias = Phaser.Math.Clamp(customProfile.landBias + dir * 0.025, -0.2, 0.18);
        },
      },
      {
        label: "RELIEF",
        value: () => customProfile.relief.toFixed(2),
        adjust: (dir: number) => {
          customProfile.relief = Phaser.Math.Clamp(customProfile.relief + dir * 0.1, 0.7, 1.6);
        },
      },
      {
        label: "COAST",
        value: () => customProfile.edgeFalloff.toFixed(2),
        adjust: (dir: number) => {
          customProfile.edgeFalloff = Phaser.Math.Clamp(customProfile.edgeFalloff + dir * 0.05, 0.05, 0.55);
        },
      },
      {
        label: "RIVERS",
        value: () => String(customProfile.riverTarget),
        adjust: (dir: number) => {
          customProfile.riverTarget = Phaser.Math.Clamp(customProfile.riverTarget + dir * 4, 0, 72);
        },
      },
      {
        label: "OBJECTIVES",
        value: () => String(customProfile.objectiveCount),
        adjust: (dir: number) => {
          customProfile.objectiveCount = Phaser.Math.Clamp(customProfile.objectiveCount + dir, 2, 7);
        },
      },
      {
        label: "GARRISON",
        value: () => customProfile.garrisonScale.toFixed(1),
        adjust: (dir: number) => {
          customProfile.garrisonScale = Phaser.Math.Clamp(customProfile.garrisonScale + dir * 0.1, 0.4, 1.8);
        },
      },
      {
        label: "PATROLS",
        value: () => String(customProfile.patrolCount),
        adjust: (dir: number) => {
          customProfile.patrolCount = Phaser.Math.Clamp(customProfile.patrolCount + dir * 2, 8, 40);
        },
      },
      {
        label: "NAVAL",
        value: () => customProfile.waterPatrolBias.toFixed(2),
        adjust: (dir: number) => {
          customProfile.waterPatrolBias = Phaser.Math.Clamp(customProfile.waterPatrolBias + dir * 0.25, 0.25, 3);
        },
      },
      {
        label: "FORCES",
        value: () => customProfile.forceMix.toUpperCase(),
        adjust: (dir: number) => {
          const i = forceMixes.indexOf(customProfile.forceMix);
          customProfile.forceMix = forceMixes[(i + dir + forceMixes.length) % forceMixes.length]!;
          customProfile.waterPatrolBias =
            customProfile.forceMix === "naval" ? 2.4 : customProfile.forceMix === "heavy" ? 0.35 : 1;
        },
      },
    ];
    const customParamCards = customParams.map((param, i) => {
      const col = i % 5;
      const line = (i / 5) | 0;
      const x = w / 2 - 425 + col * 170 + 85;
      const y = 564 + line * 27;
      const frame = this.add.rectangle(x, y, 162, 23, 0x0b0a08, 0.86).setDepth(2);
      const minus = this.add
        .text(x - 66, y, "−", {
          fontFamily: "Share Tech Mono, monospace",
          fontSize: "16px",
          color: "#e8b84a",
        })
        .setOrigin(0.5)
        .setDepth(3)
        .setInteractive({ useHandCursor: true });
      const value = this.add
        .text(x, y, "", {
          fontFamily: "Share Tech Mono, monospace",
          fontSize: "11px",
          color: "#d8d0ba",
        })
        .setOrigin(0.5)
        .setDepth(3);
      const plus = this.add
        .text(x + 66, y, "+", {
          fontFamily: "Share Tech Mono, monospace",
          fontSize: "16px",
          color: "#e8b84a",
        })
        .setOrigin(0.5)
        .setDepth(3)
        .setInteractive({ useHandCursor: true });
      minus.on("pointerdown", () => adjustCustomParam(i, -1));
      plus.on("pointerdown", () => adjustCustomParam(i, 1));
      value.setText(`${param.label}  ${param.value()}`);
      return { frame, minus, value, plus };
    });

    function syncCustomParams(): void {
      const visible = missions[missionIndex]!.kind === "custom";
      customParamCards.forEach((card, i) => {
        card.frame
          .setVisible(visible)
          .setStrokeStyle(i === customParamIndex && row === 2 ? 2 : 1, i === customParamIndex && row === 2 ? 0xe8b84a : 0x554c39, 0.9);
        card.minus.setVisible(visible);
        card.plus.setVisible(visible);
        card.value.setVisible(visible).setText(`${customParams[i]!.label}  ${customParams[i]!.value()}`);
      });
    }

    function adjustCustomParam(i: number, dir: number): void {
      row = 2;
      customParamIndex = i;
      customParams[i]!.adjust(dir);
      const key = "mission_preview_custom";
      const customIndex = missions.findIndex((mission) => mission.kind === "custom");
      if (customIndex >= 0) missionCards[customIndex]!.art.setTexture("mission_preview_river_run");
      if (thisScene.textures.exists(key)) thisScene.textures.remove(key);
      ensureMissionPreviews(thisScene.textures);
      if (customIndex >= 0) missionCards[customIndex]!.art.setTexture(key);
      refreshSelection();
    }

    const thisScene = this;
    const refreshSelection = () => {
      const craft = crafts[craftIndex]!;
      const mission = missions[missionIndex]!;
      if (row === 2 && mission.kind !== "custom") row = 1;
      selectCraft(craft.kind);
      selectMission(mission.kind);
      craftHeader.setColor(row === 0 ? "#e8b84a" : "#8f8774");
      missionHeader.setColor(row === 1 ? "#e8b84a" : "#8f8774");
      craftCards.forEach((card, i) => {
        const selected = i === craftIndex;
        card.frame
          .setVisible(selected)
          .setPosition(w / 2, 179)
          .setScale(1.05)
          .setDepth(7)
          .setFillStyle(0x241e10, 0.96)
          .setStrokeStyle(row === 0 ? 3 : 2, 0xe8b84a, 1);
        card.art
          .setVisible(selected)
          .setPosition(w / 2, 170)
          .setScale(card.artScale * 1.05)
          .setDepth(8)
          .setAlpha(1);
        card.rotors.forEach((rotor, rotorI) => {
          const part = card.rotorParts[rotorI]!;
          const at = spriteUvPos(card.art, part.mount.x, part.mount.y);
          rotor
            .setVisible(selected)
            .setPosition(at.x, at.y)
            .setScale(craftCompositePartScale(part, rotor.width, card.art.scaleX))
            .setDepth(9)
            .setAlpha(1);
        });
        card.exhaustGlows.forEach((glow, exhaustI) => {
          const mount = card.exhaustMounts[exhaustI]!;
          const at = spriteUvPos(card.art, mount.x, mount.y);
          const scale = card.art.scaleX * 0.55;
          glow
            .setVisible(selected)
            .setPosition(at.x, at.y)
            .setScale(scale * 0.75, scale)
            .setDepth(8.5);
        });
        card.label
          .setVisible(selected)
          .setPosition(w / 2, 220)
          .setScale(1)
          .setDepth(10)
          .setColor("#f2d579");
      });
      craftDots.forEach((dot, i) =>
        dot
          .setFillStyle(i === craftIndex ? 0xe8b84a : 0x5d5544, i === craftIndex ? 1 : 0.9)
          .setScale(i === craftIndex ? 1.45 : 1)
      );
      missionCards.forEach((card, i) => {
        const selected = i === missionIndex;
        card.frame
          .setVisible(selected)
          .setPosition(w / 2, 450)
          .setScale(1)
          .setDepth(7)
          .setFillStyle(0x241e10, 0.96)
          .setStrokeStyle(row === 1 ? 3 : 2, 0xe8b84a, 1);
        card.art
          .setVisible(selected)
          .setPosition(w / 2, 450)
          .setScale(card.artScaleX, card.artScaleY)
          .setDepth(8)
          .setAlpha(1);
        card.strip
          .setVisible(selected)
          .setPosition(w / 2, 497)
          .setScale(1)
          .setDepth(8)
          .setAlpha(0.94);
        card.label
          .setVisible(selected)
          .setPosition(w / 2, 497)
          .setScale(1)
          .setDepth(9)
          .setColor("#f2d579");
      });
      missionDots.forEach((dot, i) =>
        dot
          .setFillStyle(i === missionIndex ? 0xe8b84a : 0x5d5544, i === missionIndex ? 1 : 0.9)
          .setScale(i === missionIndex ? 1.45 : 1)
      );
      const weapons = playerLoadout(craft.loadout);
      drawStatBars(craft);
      weaponRows.forEach((row, i) => {
        const weapon = weapons[i];
        row.name.setText(weapon?.name ?? "—");
        const capacity = weapon ? craftStartingAmmo(weapon.ammo, craft) : 0;
        row.ammo.setText(capacity === Infinity ? "∞" : String(capacity));
      });
      detailTxt.setText(`${mission.label}  ·  ${mission.briefing}`);
      syncCustomParams();
    };

    const cycleSelection = (dir: number) => {
      if (row === 0) craftIndex = (craftIndex + dir + crafts.length) % crafts.length;
      else if (row === 1) missionIndex = (missionIndex + dir + missions.length) % missions.length;
      else adjustCustomParam(customParamIndex, dir);
      refreshSelection();
    };
    refreshSelection();

    const go = this.add
      .text(w / 2, 650, "[  DEPLOY  ]", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "22px",
        color: "#1c1812",
        backgroundColor: "#e8b84a",
        padding: { x: 18, y: 10 },
      })
      .setOrigin(0.5)
      .setDepth(2)
      .setInteractive({ useHandCursor: true })
      .setName("menu_start");
    go.on("pointerdown", () => this.scene.start("load"));
    this.input.keyboard?.once("keydown-ENTER", () => this.scene.start("load"));
    this.input.keyboard?.once("keydown-SPACE", () => this.scene.start("load"));

    const selectUp = () => {
      const rows = missions[missionIndex]!.kind === "custom" ? 3 : 2;
      row = (row - 1 + rows) % rows;
      refreshSelection();
    };
    const selectDown = () => {
      const rows = missions[missionIndex]!.kind === "custom" ? 3 : 2;
      row = (row + 1) % rows;
      refreshSelection();
    };
    const selectLeft = () => cycleSelection(-1);
    const selectRight = () => cycleSelection(1);
    this.input.keyboard?.on("keydown-UP", selectUp);
    this.input.keyboard?.on("keydown-DOWN", selectDown);
    this.input.keyboard?.on("keydown-LEFT", selectLeft);
    this.input.keyboard?.on("keydown-RIGHT", selectRight);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.keyboard?.off("keydown-UP", selectUp);
      this.input.keyboard?.off("keydown-DOWN", selectDown);
      this.input.keyboard?.off("keydown-LEFT", selectLeft);
      this.input.keyboard?.off("keydown-RIGHT", selectRight);
    });
    installConfigRigHotkeys(this);
    nameGeneratedTextures(this);
  }
}

export class LoadScene extends Phaser.Scene {
  private body!: Phaser.GameObjects.Image;
  private rotors: Phaser.GameObjects.Image[] = [];
  private rotorDiscs: Phaser.GameObjects.Image[] = [];
  private rotorParts: CraftComposite["rotors"] = [];
  private heliY = 0;
  private rotorAng = 0;
  private rotorSpd = 4;
  private loadU = 0.02;

  constructor() {
    super("load");
  }
  create(): void {
    const { width: w, height: h } = this.scale;
    this.cameras.main.setBackgroundColor("#1c1812");
    this.heliY = h * 0.34;
    const hx = w / 2;
    const zs = 0.925;
    const craft = craftOf();
    const composite = craftComposite(craft);
    this.body = this.add
      .image(hx, this.heliY, composite.body.tex)
      .setOrigin(composite.body.origin.x, composite.body.origin.y)
      .setScale(zs);
    this.rotorParts = composite.rotors;
    this.rotors = this.rotorParts.map((part) => {
      const at = spriteUvPos(this.body, part.mount.x, part.mount.y);
      const rotor = this.add.image(at.x, at.y, part.tex).setOrigin(part.origin.x, part.origin.y);
      rotor.setScale(craftCompositePartScale(part, rotor.width, zs));
      return rotor;
    });
    this.rotorDiscs = this.rotorParts.map((part, i) => {
      const at = spriteUvPos(this.body, part.mount.x, part.mount.y);
      const spinTex = part.spinTex;
      return this.add
        .image(at.x, at.y, spinTex && this.textures.exists(spinTex) ? spinTex : part.tex)
        .setOrigin(part.origin.x, part.origin.y)
        .setScale(craftCompositePartScale(part, this.rotors[i]?.width ?? 1, zs) * 1.04)
        .setAlpha(0);
    });
    this.add
      .text(w / 2, h * 0.48, "SURVEYING THEATER", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "18px",
        color: "#e8b84a",
      })
      .setOrigin(0.5)
      .setName("load_title");
    const sub = this.add
      .text(w / 2, h * 0.54, "procedural relief", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "13px",
        color: "#8a8470",
      })
      .setOrigin(0.5)
      .setName("load_stage");
    const barW = 320;
    const barH = 8;
    const barX = w / 2 - barW / 2;
    const barY = h * 0.6;
    const bar = this.add.graphics();
    const tip = LOAD_TIPS[(Math.random() * LOAD_TIPS.length) | 0]!;
    this.add
      .text(w / 2, h * 0.72, `TIP  ·  ${tip}`, {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "14px",
        color: "#c8c0a8",
        align: "center",
        wordWrap: { width: Math.min(520, w - 48) },
      })
      .setOrigin(0.5, 0)
      .setName("load_tip");
    drawControlLegend(this, w, h * 0.87);
    const drawBar = (t: number, label: string) => {
      const u = Phaser.Math.Clamp(t, 0, 1);
      bar.clear();
      bar.fillStyle(0x12100c, 1);
      bar.fillRect(barX, barY, barW, barH);
      bar.fillStyle(0xe8b84a, 1);
      bar.fillRect(barX, barY, barW * u, barH);
      bar.lineStyle(1, 0x3a3428, 1);
      bar.strokeRect(barX - 0.5, barY - 0.5, barW + 1, barH + 1);
      bar.lineStyle(1, 0x5c5344, 0.55);
      for (let i = 1; i < 10; i++) {
        const x = barX + (barW * i) / 10;
        const long = i === 5;
        bar.lineBetween(x, barY - (long ? 4 : 2), x, barY + barH + (long ? 4 : 2));
      }
      this.loadU = u;
      sub.setText(`${label.toUpperCase()}  ·  ${Math.round(u * 100)}%`);
    };
    drawBar(0.02, "relief");
    nameGeneratedTextures(this);
    this.time.delayedCall(16, () => {
      const seed = (Date.now() ^ (Math.random() * 1e9)) >>> 0;
      const tiles = extractBiomeTiles(this.textures);
      const mission = missionOf();
      sub.setText(`${mission.label}  ·  RELIEF  ·  2%`);
      const go = (world: WorldData) => {
        drawBar(1, "ready");
        this.time.delayedCall(240, () => this.scene.start("mission", { world }));
      };
      generateWorldAsync(seed, tiles, (t, label) => drawBar(t, label), mission.profile)
        .then(go)
        .catch(() => {
          go(worldFromGen(generateWorld(seed, tiles, (t, label) => drawBar(t, label), mission.profile)));
        });
    });
  }

  update(_t: number, dt: number): void {
    const dts = dt / 1000;
    const targetSpd = 4 + this.loadU * 30;
    this.rotorSpd = Phaser.Math.Linear(this.rotorSpd, targetSpd, 1 - Math.pow(0.14, dts));
    this.rotorAng += this.rotorSpd * dts;
    const disc = Phaser.Math.Clamp((this.rotorSpd - 10) / 22, 0, 1);
    const bob = Math.sin(_t / 420) * 1.6;
    this.body.y = this.heliY + bob;
    this.rotors.forEach((rotor, i) => {
      const part = this.rotorParts[i]!;
      const at = spriteUvPos(this.body, part.mount.x, part.mount.y);
      rotor
        .setPosition(at.x, at.y)
        .setRotation(i % 2 ? -this.rotorAng : this.rotorAng)
        .setAlpha(1 - disc * 0.38);
      this.rotorDiscs[i]
        ?.setPosition(at.x, at.y)
        .setRotation((i % 2 ? -this.rotorAng : this.rotorAng) + Math.PI / 8)
        .setAlpha(disc * 0.32);
    });
  }
}

export class MissionScene extends Phaser.Scene {
  world!: WorldData;
  heli!: Heli;
  units: Unit[] = [];
  shots: Shot[] = [];
  debris: Debris[] = [];
  simParticles: SimParticle[] = [];
  loadout: PlayerWpnSpec[] = playerLoadout(craftOf().loadout);
  ammo = this.loadout.map((w) => w.ammo);
  keyW!: Phaser.Input.Keyboard.Key;
  keyA!: Phaser.Input.Keyboard.Key;
  keyS!: Phaser.Input.Keyboard.Key;
  keyD!: Phaser.Input.Keyboard.Key;
  keySpace!: Phaser.Input.Keyboard.Key;
  keyShift!: Phaser.Input.Keyboard.Key;
  ground!: Phaser.GameObjects.Image;
  wreckLayer!: Phaser.GameObjects.RenderTexture;
  flatWreckage!: Phaser.GameObjects.Image;
  terrain25d?: Terrain25D;
  terrainMesh = true;
  stampBrush!: Phaser.GameObjects.Image;
  body!: Phaser.GameObjects.Image;
  rotor!: Phaser.GameObjects.Image;
  rotors: Phaser.GameObjects.Image[] = [];
  craftParts!: CraftComposite;
  gun!: Phaser.GameObjects.Image;
  guns: Phaser.GameObjects.Image[] = [];
  shadow!: Phaser.GameObjects.Image;
  reticle!: Phaser.GameObjects.Image;
  reticleMark!: Phaser.GameObjects.Graphics;
  sight!: Phaser.GameObjects.Graphics;
  lockSpr!: Phaser.GameObjects.Image;
  lockGfx!: Phaser.GameObjects.Graphics;
  towWireGfx!: Phaser.GameObjects.Graphics;
  lockTxt!: Phaser.GameObjects.Text;
  lockInbdTxt!: Phaser.GameObjects.Text;
  lockArrowGfx!: Phaser.GameObjects.Graphics;
  lockHudTxt!: Phaser.GameObjects.Text;
  lockInbdHudTxt!: Phaser.GameObjects.Text;
  unitG!: Phaser.GameObjects.Group;
  shotG!: Phaser.GameObjects.Group;
  debrisG!: Phaser.GameObjects.Group;
  simParticleG!: Phaser.GameObjects.Group;
  smoke!: Phaser.GameObjects.Particles.ParticleEmitter;
  tracer!: Phaser.GameObjects.Particles.ParticleEmitter;
  flame!: Phaser.GameObjects.Particles.ParticleEmitter;
  playerFlame!: Phaser.GameObjects.Particles.ParticleEmitter;
  hurtSmoke!: Phaser.GameObjects.Particles.ParticleEmitter;
  playerHurtSmoke!: Phaser.GameObjects.Particles.ParticleEmitter;
  burn!: Phaser.GameObjects.Particles.ParticleEmitter;
  blastBurn!: Phaser.GameObjects.Particles.ParticleEmitter;
  blastFire!: Phaser.GameObjects.Particles.ParticleEmitter;
  shortBurst!: Phaser.GameObjects.Particles.ParticleEmitter;
  muzzleBurst!: Phaser.GameObjects.Particles.ParticleEmitter;
  splashBurst!: Phaser.GameObjects.Particles.ParticleEmitter;
  explosionPuff!: Phaser.GameObjects.Particles.ParticleEmitter;
  ember!: Phaser.GameObjects.Particles.ParticleEmitter;
  shortTrailSmoke!: Phaser.GameObjects.Particles.ParticleEmitter;
  lingerSmoke!: Phaser.GameObjects.Particles.ParticleEmitter;
  heliDust!: Phaser.GameObjects.Particles.ParticleEmitter;
  craftExhaust!: Phaser.GameObjects.Particles.ParticleEmitter;
  craftExhaustMote!: Phaser.GameObjects.Particles.ParticleEmitter;
  craftExhaustSmoke!: Phaser.GameObjects.Particles.ParticleEmitter;
  exhaustFlames: Phaser.GameObjects.Image[] = [];
  exhaustEmitCarry = 0;
  exhaustMountCursor = 0;
  exhaustPrevWorld: ({ x: number; y: number; z: number } | undefined)[] = [];
  exhaustVx = 0;
  exhaustVy = 0;
  exhaustAngle = 0;
  exhaustTint = 0xffffff;
  exhaustSmokeTint = 0x8b8b86;
  exhaustScaleX = 1;
  exhaustScaleY = 0.4;
  exhaustLife = 260;
  /** Camera-depth-banded clones: each band keeps fire>smoke without a global restack. */
  fxSlots = new Map<Phaser.GameObjects.Particles.ParticleEmitter, Phaser.GameObjects.Particles.ParticleEmitter[]>();
  fxPolicies: Record<FxClass, FxPolicy> = {
    short: { frameCap: 96, activeCap: 384, emitted: 0, emitters: new Set() },
    fire: { frameCap: 96, activeCap: 768, emitted: 0, emitters: new Set() },
    smoke: { frameCap: 72, activeCap: 1024, emitted: 0, emitters: new Set() },
    dust: { frameCap: 96, activeCap: 512, emitted: 0, emitters: new Set() },
  };
  /** Painter-depth bands so concurrent trails don't all share one emitter depth. */
  fxSlotN = 8;
  fxBandH = 48;
  /** Last applied sim timeScale (skip walking ~N emitters when unchanged). */
  lastSimScale = Number.NaN;
  /** Scratch used only by synchronous onEmit callbacks; particles retain update state themselves. */
  burstLaunch = {
    x: 0, y: 0, z: 0, bx: 1, by: 0, bz: 0, tight: 0.5,
    spdMin: 40, spdMax: 120, scale: 1, expBias: 0, gravity: 0,
  };
  muzzle!: Phaser.GameObjects.Image;
  muzzlePool: Phaser.GameObjects.Image[] = [];
  muzzleLives: number[] = [];
  muzzleCursor = 0;
  playerGunSide = 0;
  dmgFlameScale = 1;
  trailFxScale = 1;
  /** Multiplier for trail particle lifespan (mid ≈ 1; large debris > 1). */
  trailFxLife = 1;
  playerCrashStarted = false;
  playerCrashLanded = false;
  /** <0 = waiting for crash simmer; >=0 = countdown to BIRD DOWN. */
  playerCrashEndT = -1;
  /** Scene-owned simmer so BIRD DOWN isn't lost if the hull debris is culled. */
  playerCrashSimmerT = 0;
  /** Camera post-FX (toggle with F). */
  fxBloom?: Phaser.FX.Bloom;
  fxBarrel?: Phaser.FX.Barrel;
  thermalFx?: Phaser.FX.ColorMatrix;
  thermalOn = false;
  fxOn = true;
  fxBarrelPulse = 0;
  fxHud!: Phaser.GameObjects.Text;
  fpsHud!: Phaser.GameObjects.Text;
  perfHud!: Phaser.GameObjects.Text;
  /** Opt-in CPU timings; buffers are allocated only when profiling is enabled. */
  perfEnabled = false;
  private perfSamples?: Float32Array[];
  private perfCurrent?: Float64Array;
  private perfSort?: Float32Array;
  private perfSampleCount = 0;
  private perfSampleWrite = 0;
  private perfHudAt = 0;
  private perfCopyNoticeUntil = 0;
  private perfCopyKeyAt = -Infinity;
  hud!: Phaser.GameObjects.Text;
  liftPrompt!: Phaser.GameObjects.Text;
  hvHud!: Phaser.GameObjects.Text;
  hvRows: Phaser.GameObjects.Text[] = [];
  wpnHud!: Phaser.GameObjects.Text;
  wpnBar!: Phaser.GameObjects.Graphics;
  wpnSlots!: Phaser.GameObjects.Text[];
  hpGfx!: Phaser.GameObjects.Graphics;
  playerHud!: Phaser.GameObjects.Graphics;
  heliHudWire!: Phaser.GameObjects.Image;
  heliHudWireSh!: Phaser.GameObjects.Image;
  heliHudWireScale = 1;
  heliHudWireBake: HeliHudWireBake = { w: 1, h: 1, pivot: { x: 0.5, y: 0.5 }, srcW: 1, srcH: 1, cropX: 0, cropY: 0 };
  hurtVignette!: Phaser.GameObjects.Image;
  mapLabel!: Phaser.GameObjects.Text;
  mapHvLabels: Phaser.GameObjects.Text[] = [];
  hvArrowLabels: Phaser.GameObjects.Text[] = [];
  miniGfx!: Phaser.GameObjects.Graphics;
  miniBg!: Phaser.GameObjects.Graphics;
  miniTerrain!: Phaser.GameObjects.Image;
  miniWrecks!: Phaser.GameObjects.Image;
  miniMask!: Phaser.GameObjects.Graphics;
  mapGfx!: Phaser.GameObjects.Graphics;
  hudCam!: Phaser.Cameras.Scene2D.Camera;
  hudRoot!: Phaser.GameObjects.Container;
  hudSet = new Set<Phaser.GameObjects.GameObject>();
  hudParS = 1;
  hudParX = 0;
  hudParY = 0;
  hvGfx!: Phaser.GameObjects.Graphics;
  over = false;
  win = false;
  completedHv = new Set<string>();
  missionEndQueued = false;
  stingerRoot?: Phaser.GameObjects.Container;
  stingerText?: Phaser.GameObjects.Text;
  stingerT = 0;
  stingerDuration = 0;
  stingerDone?: () => void;
  stingerTarget?: { x: number; y: number };
  shake = 0;
  canFire = false;
  mapView = false;
  mapWant = false;
  mapBlend = 0;
  mapWorldHidden = false;
  mapWorldVisibility = new Map<Phaser.GameObjects.GameObject, boolean>();
  camZoom = CamTune.zoom0;
  camFollow = false;
  lookCamX = 0;
  lookCamY = 0;
  towLookHold = 0;
  towLookX = 0;
  towLookY = 0;
  playLastFrame = false;
  playScrollX = 0;
  playScrollY = 0;
  playViewX = 0;
  playViewY = 0;
  playViewW = 0;
  playViewH = 0;
  /** Per-frame pointer cache (avoid repeat getWorldPoint / ground unproject). */
  private ptrFrame = -1;
  private ptrScrX = 0;
  private ptrScrY = 0;
  private ptrWorldX = 0;
  private ptrWorldY = 0;
  private ptrWorldReady = false;
  /** Live unit id → unit (rebuilt each sim frame). */
  private unitIdMap = new Map<number, Unit>();
  /** Cached texture span / trail radius (key → px). */
  private texSpanCache = new Map<string, number>();
  private texTrailCache = new Map<string, number>();
  private textureAlphaCache = new Map<string, TextureAlphaBounds | null>();
  private fpsHudAt = 0;
  debugHit = false;
  /** Draw fading rings for explosion damage / heli splash radii. */
  debugBlast = false;
  blastRings: { x: number; y: number; z: number; r: number; heliR: number; life: number; max: number }[] = [];
  blastGfx!: Phaser.GameObjects.Graphics;
  showHeightMap = false;
  debugGfx!: Phaser.GameObjects.Graphics;
  timeScale = 1;
  helpOpen = false;
  helpPage = 0;
  helpRoot!: Phaser.GameObjects.Container;
  helpBody!: Phaser.GameObjects.Text;
  helpCounter!: Phaser.GameObjects.Text;
  helpCraftBody!: Phaser.GameObjects.Image;
  helpCraftRotors: Phaser.GameObjects.Image[] = [];
  helpCraftRotorParts: CraftComposite["rotors"] = [];
  helpCraftExhaustGlows: Phaser.GameObjects.Image[] = [];
  helpCraftExhaustMounts: { x: number; y: number }[] = [];
  helpCraftName!: Phaser.GameObjects.Text;
  helpCraftStats!: Phaser.GameObjects.Text;
  helpCraftBars!: Phaser.GameObjects.Graphics;
  helpButton!: Phaser.GameObjects.Text;
  exitOpen = false;
  exitRoot!: Phaser.GameObjects.Container;
  exitButton!: Phaser.GameObjects.Text;
  debugOpen = false;
  debugRoot!: Phaser.GameObjects.Container;
  debugPanel!: Phaser.GameObjects.Graphics;
  debugRows: Phaser.GameObjects.Text[] = [];
  debugTitle!: Phaser.GameObjects.Text;
  debugSpawnOpen = false;
  debugSpawnIdx = 0;
  debugSpawnRows: Phaser.GameObjects.Text[] = [];
  private seedCopyNoticeUntil = 0;
  debugCamOpen = false;
  debugCamIdx = 0;
  debugCamRows: Phaser.GameObjects.Text[] = [];
  /** Focused row on the main debug list (arrow-key nav). */
  debugMenuIdx = 0;
  debugSpawnHint!: Phaser.GameObjects.Text;
  noDamage = false;
  infAmmo = false;
  debugAi = false;
  aiGfx!: Phaser.GameObjects.Graphics;
  aiLabels: Phaser.GameObjects.Text[] = [];
  editOpen = false;
  editBrush = 0;
  editSize = 110;
  editRot = 0;
  editOffX = 0;
  editOffY = 0;
  editSpd = 0;
  editStr = 0.2;
  editInvert = false;
  editPx = 0;
  editPy = 0;
  editAcc = 0;
  editUiBlock = false;
  editWasPaint = false;
  editDirty: { x0: number; y0: number; x1: number; y1: number } | null = null;
  editRoot!: Phaser.GameObjects.Container;
  editReadout!: Phaser.GameObjects.Text;
  editInkBtn!: Phaser.GameObjects.Text;
  editChips: Phaser.GameObjects.Image[] = [];
  editChipFrames: Phaser.GameObjects.Graphics[] = [];
  editGfx!: Phaser.GameObjects.Graphics;
  heightMapCanvas!: HTMLCanvasElement;
  biomeTiles: (ImageData | null)[] = [];

  constructor() {
    super("mission");
  }

  init(data: { world?: WorldData }): void {
    this.over = false;
    this.win = false;
    this.completedHv.clear();
    this.missionEndQueued = false;
    this.stingerRoot = undefined;
    this.stingerText = undefined;
    this.stingerT = 0;
    this.stingerDuration = 0;
    this.stingerDone = undefined;
    this.stingerTarget = undefined;
    this.shake = 0;
    this.canFire = false;
    this.mapView = false;
    this.mapWant = false;
    this.mapBlend = 0;
    this.mapWorldHidden = false;
    this.mapWorldVisibility.clear();
    this.camFollow = false;
    this.lookCamX = 0;
    this.lookCamY = 0;
    this.towLookHold = 0;
    this.towLookX = 0;
    this.towLookY = 0;
    this.playLastFrame = false;
    this.debugHit = false;
    this.debugBlast = false;
    this.blastRings = [];
    this.fxOn = true;
    this.thermalOn = false;
    this.fxBarrelPulse = 0;
    this.showHeightMap = false;
    this.terrainMesh = true;
    this.helpOpen = false;
    this.helpPage = 0;
    this.exitOpen = false;
    this.debugOpen = false;
    this.debugSpawnOpen = false;
    this.debugCamOpen = false;
    this.noDamage = false;
    this.infAmmo = false;
    this.debugAi = false;
    this.editOpen = false;
    this.editInvert = false;
    this.editDirty = null;
    this.shots = [];
    this.debris = [];
    this.simParticles = [];
    this.exhaustPrevWorld = [];
    this.exhaustMountCursor = 0;
    this.playerCrashStarted = false;
    this.playerCrashLanded = false;
    this.playerCrashEndT = -1;
    this.playerCrashSimmerT = 0;
    this.playerGunSide = 0;
    const selectedCraft = craftOf();
    this.loadout = playerLoadout(selectedCraft.loadout);
    this.ammo = this.loadout.map((weapon) => craftStartingAmmo(weapon.ammo, selectedCraft));
    if (!data.world) {
      this.world = worldFromGen(
        generateWorld(
          (Date.now() ^ (Math.random() * 1e9)) >>> 0,
          extractBiomeTiles(this.textures),
          undefined,
          missionOf().profile
        )
      );
    } else this.world = data.world;
  }

  create(): void {
    ensureEdgeLightPipeline(this.game);
    this.stampDecor();
    if (this.textures.exists("terrain")) this.textures.remove("terrain");
    this.textures.addCanvas("terrain", this.world.canvas);
    if (this.textures.exists("heightmap")) this.textures.remove("heightmap");
    this.heightMapCanvas = paintHeightMap(this.world.height);
    this.textures.addCanvas("heightmap", this.heightMapCanvas);
    this.biomeTiles = extractBiomeTiles(this.textures);
    this.input.mouse?.disableContextMenu();
    ensureImpactGlow(this.textures);
    ensureExhaustGlow(this.textures);
    ensureBlastRingGradient(this.textures);
    this.input.setDefaultCursor("none");
    this.canFire = !this.input.activePointer.isDown;
    this.input.on("pointerup", () => {
      this.canFire = true;
    });

    this.physics.world.setBounds(0, 0, WORLD, WORLD);
    this.cameras.main.setBounds(0, 0, WORLD, WORLD);
    this.cameras.main.setBackgroundColor("#2a2418");
    this.setupTestPostFx();

    this.ground = this.add.image(WORLD / 2, WORLD / 2, "terrain");
    this.ground.setDisplaySize(WORLD, WORLD).setDepth(Layer.TERRAIN);
    this.wreckLayer = this.add.renderTexture(0, 0, WRECK_TEX, WRECK_TEX);
    nameGameTexture(this, this.wreckLayer, "wreck_layer");
    this.wreckLayer.setOrigin(0, 0).setPosition(0, 0);
    this.wreckLayer.setDisplaySize(WORLD, WORLD).setDepth(Layer.WRECK);
    (this.wreckLayer.texture as Phaser.Textures.DynamicTexture).setIsSpriteTexture(false);
    this.wreckLayer.clear();
    if (this.game.renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer) {
      this.terrain25d = createTerrain25D(this, this.world, {
        terrain: "terrain",
        decal: this.wreckLayer,
        depth: Layer.TERRAIN,
      });
      this.ground.setVisible(false);
      this.wreckLayer.setVisible(false);
    } else {
      this.terrain25d = undefined;
      this.terrainMesh = false;
    }
    this.stampBrush = this.make.image({ key: "fx_blast_0" }, false);

    this.unitG = this.add.group();
    this.shotG = this.add.group();
    this.debrisG = this.add.group();
    this.simParticleG = this.add.group();

    this.heli = new Heli(this.world.spawnX, this.world.spawnY, this.world);
    if (this.heli.spec.flightModel === "plane") {
      const inward = Math.atan2(WORLD * 0.5 - this.heli.y, WORLD * 0.5 - this.heli.x);
      this.heli.startAirborne(inward, this.world);
    } else this.heli.angle = 0.6;
    setCamera25DFocus(this.heli.x, this.heli.y, this.heli.z);
    const craft = this.heli.spec;
    this.craftParts = craftComposite(craft);
    this.shadow = this.add.image(0, 0, "shadow").setDepth(Layer.SHADOW);
    this.guns = this.craftParts.guns.map((part) =>
      this.add
        .image(0, 0, part.tex)
        .setDepth(Layer.WORLD)
        .setOrigin(part.origin.x, part.origin.y)
    );
    this.gun =
      this.guns[0] ??
      this.add
        .image(0, 0, craft.gun)
        .setDepth(Layer.WORLD)
        .setOrigin(craftGunOrigin(craft).x, craftGunOrigin(craft).y)
        .setVisible(false);
    this.body = this.add.image(0, 0, this.craftParts.body.tex).setDepth(Layer.WORLD).setOrigin(this.craftParts.body.origin.x, this.craftParts.body.origin.y);
    this.exhaustFlames = craftExhaustMounts(craft).map(() =>
      this.add
        .image(0, 0, "fx_exhaust")
        .setDepth(Layer.WORLD)
        .setOrigin(0.04, 0.5)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setVisible(false)
    );
    const rotorTex = this.craftParts.rotors[0]?.tex ?? "heli_rotor";
    this.rotors = this.craftParts.rotors.map((part) =>
      this.add.image(0, 0, part.tex).setDepth(Layer.WORLD).setOrigin(part.origin.x, part.origin.y)
    );
    this.rotor =
      this.rotors[0] ??
      this.add.image(0, 0, rotorTex).setDepth(Layer.WORLD).setOrigin(0.5, 0.5).setVisible(false);
    this.muzzle = this.add
      .image(0, 0, "fx_muzzle")
      .setDepth(Layer.WORLD)
      .setVisible(false)
      .setOrigin(0.14, 0.5)
      .setScale(0.72)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(0xfff6d0);
    const secondMuzzle = this.add
      .image(0, 0, "fx_muzzle")
      .setDepth(Layer.WORLD)
      .setVisible(false)
      .setOrigin(0.14, 0.5)
      .setScale(0.72)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(0xfff6d0);
    this.muzzlePool = [this.muzzle, secondMuzzle];
    this.muzzleLives = [0, 0];
    this.body.setPosition(this.heli.x, this.heli.y);
    this.reticle = this.add.image(0, 0, "reticle").setDepth(Layer.HUD).setScrollFactor(0);
    this.reticleMark = this.add.graphics().setDepth(Layer.HUD).setScrollFactor(0);
    this.sight = this.add.graphics().setDepth(Layer.HUD).setScrollFactor(0);
    this.lockSpr = this.add.image(0, 0, "lock").setDepth(Layer.FIELD).setVisible(false);
    this.lockGfx = this.add.graphics().setDepth(Layer.FIELD).setVisible(false);
    this.towWireGfx = this.add.graphics().setDepth(Layer.WORLD);
    this.lockTxt = this.add
      .text(0, 0, "LOCK", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "13px",
        color: "#ff3a22",
      })
      .setOrigin(0.5, 1)
      .setDepth(Layer.FIELD)
      .setVisible(false)
      .setStroke("#1c100c", 3);
    this.lockInbdTxt = this.add
      .text(0, 0, "FIRE", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "12px",
        color: "#ffb020",
      })
      .setOrigin(0.5, 1)
      .setDepth(Layer.FIELD)
      .setVisible(false)
      .setStroke("#1c100c", 3);
    this.lockArrowGfx = this.add.graphics().setScrollFactor(0).setDepth(Layer.HUD + 2);
    this.lockHudTxt = this.add
      .text(0, 0, "LOCK", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "12px",
        color: "#ff3a22",
      })
      .setOrigin(0.5, 0.5)
      .setScrollFactor(0)
      .setDepth(Layer.HUD + 3)
      .setVisible(false)
      .setStroke("#1c100c", 3);
    this.lockInbdHudTxt = this.add
      .text(0, 0, "FIRE", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "12px",
        color: "#ffb020",
      })
      .setOrigin(0.5, 0.5)
      .setScrollFactor(0)
      .setDepth(Layer.HUD + 3)
      .setVisible(false)
      .setStroke("#1c100c", 3);

    this.units = [];
    for (const s of this.world.spawns) {
      const u = this.makeUnit(s.kind, s.x, s.y);
      u.hv = s.hv;
      this.units.push(u);
    }
    const posted: Unit[] = [];
    for (const host of this.units) {
      posted.push(...this.spawnCrewFor(host));
    }
    this.units.push(...posted);

    const fxFrames = { frames: [0, 1, 2, 3], cycle: false as const };
    const fxSpin = { min: -80, max: 80 };
    this.smoke = this.add.particles(0, 0, "fx_smoke", {
      lifespan: 900,
      speed: { min: 10, max: 70 },
      scale: { start: 0.6, end: 2.4 },
      alpha: { start: 0.55, end: 0 },
      gravityY: -28,
      emitting: false,
      frame: fxFrames,
      rotate: fxSpin,
    });
    this.smoke.setDepth(Layer.WORLD);
    this.registerFx("smoke", this.smoke);
    this.tracer = this.add.particles(0, 0, "fx_spark", {
      lifespan: 160,
      speed: { min: 40, max: 140 },
      scaleX: { start: 1.7, end: 0 },
      scaleY: { start: 0.42, end: 0 },
      alpha: { start: 1, end: 0 },
      blendMode: "ADD",
      tint: [0xfff8d0, 0xffee88, 0xffaa40],
      emitting: false,
      frame: fxFrames,
      rotate: {
        onEmit: (p) => Phaser.Math.RadToDeg(Math.atan2(p?.velocityY ?? 0, p?.velocityX ?? 0)),
      },
    });
    this.tracer.setDepth(Layer.WORLD);
    this.registerFx("short", this.tracer);
    const seedBurst = (p: Phaser.GameObjects.Particles.Particle | undefined, min: number, max: number): number => {
      this.sampleBurstScreenVelocity(p as BurstParticle | undefined);
      return range(min, max);
    };
    const burstVelocityX = (p?: Phaser.GameObjects.Particles.Particle): number =>
      (p as BurstParticle | undefined)?.burstVx ?? this.sampleBurstScreenVelocity(p as BurstParticle | undefined).x;
    const burstVelocityY = (p?: Phaser.GameObjects.Particles.Particle): number =>
      (p as BurstParticle | undefined)?.burstVy ?? this.sampleBurstScreenVelocity(p as BurstParticle | undefined).y;
    const burstRotation = (p?: Phaser.GameObjects.Particles.Particle): number =>
      Phaser.Math.RadToDeg((p as BurstParticle | undefined)?.burstHeading ?? 0);
    this.shortBurst = this.poolFx("short", () =>
      this.add.particles(0, 0, "fx_spark", {
        lifespan: { onEmit: (p) => seedBurst(p, 180, 520) },
        speedX: { onEmit: burstVelocityX },
        speedY: { onEmit: burstVelocityY },
        scaleX: {
          onEmit: (p) => {
            const q = p as BurstParticle;
            q.launchScale = this.burstLaunch.scale * range(0.72, 1.18);
            return q.launchScale * range(1.5, 2.7);
          },
          onUpdate: (p, _k, t) => ((p as BurstParticle).launchScale ?? 1) * 2 * (1 - t),
        },
        scaleY: {
          onEmit: (p) => ((p as BurstParticle).launchScale ?? this.burstLaunch.scale) * 0.34,
          onUpdate: (p, _k, t) => ((p as BurstParticle).launchScale ?? 1) * 0.34 * (1 - t),
        },
        alpha: { start: 1, end: 0 },
        blendMode: "ADD",
        tint: [0xfff8d0, 0xffee66, 0xffaa40],
        gravityY: 180,
        radial: false,
        emitting: false,
        frame: fxFrames,
        rotate: { onEmit: burstRotation },
      })
    );
    this.muzzleBurst = this.poolFx("short", () =>
      this.add.particles(0, 0, "fx_flame", {
        lifespan: { onEmit: (p) => seedBurst(p, 100, 240) },
        speedX: { onEmit: burstVelocityX },
        speedY: { onEmit: burstVelocityY },
        scaleX: {
          onEmit: (p) => {
            const q = p as BurstParticle;
            q.launchScale = this.burstLaunch.scale * range(0.72, 1.18);
            return q.launchScale * range(1.8, 3.2);
          },
          onUpdate: (p, _k, t) => ((p as BurstParticle).launchScale ?? 1) * 2.2 * (1 - t),
        },
        scaleY: {
          onEmit: (p) => ((p as BurstParticle).launchScale ?? this.burstLaunch.scale) * 0.42,
          onUpdate: (p, _k, t) => ((p as BurstParticle).launchScale ?? 1) * 0.42 * (1 - t),
        },
        alpha: { start: 1, end: 0 },
        blendMode: "ADD",
        tint: [0xfff8d8, 0xffc050, 0xff7a28],
        radial: false,
        emitting: false,
        frame: fxFrames,
        rotate: { onEmit: burstRotation },
      })
    );
    this.splashBurst = this.poolFx("short", () =>
      this.add.particles(0, 0, "fx_splash", {
        lifespan: { onEmit: (p) => seedBurst(p, 320, 600) },
        speedX: { onEmit: burstVelocityX },
        speedY: { onEmit: burstVelocityY },
        scaleX: {
          onEmit: (p) => {
            const q = p as BurstParticle;
            q.launchScale = this.burstLaunch.scale * range(0.72, 1.18);
            return q.launchScale;
          },
          onUpdate: (p, _k, t) => ((p as BurstParticle).launchScale ?? 1) * (1 - t * 0.82),
        },
        scaleY: {
          onEmit: (p) => ((p as BurstParticle).launchScale ?? this.burstLaunch.scale) * 0.48,
          onUpdate: (p, _k, t) => ((p as BurstParticle).launchScale ?? 1) * (0.48 - t * 0.36),
        },
        alpha: { start: 0.9, end: 0 },
        tint: [0xffffff, 0x9edcff, 0x6ec4ff],
        gravityY: 240,
        radial: false,
        emitting: false,
        frame: fxFrames,
        rotate: { onEmit: burstRotation },
      })
    );
    this.explosionPuff = this.poolFx("fire", () =>
      this.add.particles(0, 0, "fx_flame", {
        lifespan: { onEmit: (p) => seedBurst(p, 180, 400) },
        speedX: { onEmit: burstVelocityX },
        speedY: { onEmit: burstVelocityY },
        scaleX: {
          onEmit: (p) => {
            const q = p as BurstParticle;
            q.launchScale = this.burstLaunch.scale * range(0.7, 1.25);
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
          onEmit: (p) => (p as BurstParticle).launchScale ?? this.burstLaunch.scale,
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
    this.craftExhaust = this.poolFx("fire", () =>
      this.add.particles(0, 0, "fx_exhaust", {
        lifespan: { onEmit: () => this.exhaustLife },
        speedX: { onEmit: () => this.exhaustVx + range(-4, 4) },
        speedY: { onEmit: () => this.exhaustVy + range(-4, 4) },
        scaleX: {
          onEmit: (p) => {
            const q = p as Phaser.GameObjects.Particles.Particle & { exhaustScaleX?: number };
            q.exhaustScaleX = this.exhaustScaleX;
            return q.exhaustScaleX;
          },
          onUpdate: (p, _k, t) => {
            const q = p as Phaser.GameObjects.Particles.Particle & { exhaustScaleX?: number };
            return (q.exhaustScaleX ?? 1) * (1 - t * 0.72);
          },
        },
        scaleY: {
          onEmit: (p) => {
            const q = p as Phaser.GameObjects.Particles.Particle & { exhaustScaleY?: number };
            q.exhaustScaleY = this.exhaustScaleY;
            return q.exhaustScaleY;
          },
          onUpdate: (p, _k, t) => {
            const q = p as Phaser.GameObjects.Particles.Particle & { exhaustScaleY?: number };
            return (q.exhaustScaleY ?? 0.4) * (1 - t * 0.45);
          },
        },
        alpha: { start: 0.92, end: 0 },
        tint: { onEmit: () => this.exhaustTint },
        blendMode: "ADD",
        radial: false,
        emitting: false,
        frame: fxFrames,
        rotate: {
          onEmit: (p) => {
            const q = p as Phaser.GameObjects.Particles.Particle & { exhaustAngle?: number };
            q.exhaustAngle = this.exhaustAngle;
            return Phaser.Math.RadToDeg(this.exhaustAngle);
          },
          onUpdate: (p) => {
            const q = p as Phaser.GameObjects.Particles.Particle & { exhaustAngle?: number };
            return Phaser.Math.RadToDeg(q.exhaustAngle ?? this.exhaustAngle);
          },
        },
      })
    );
    this.craftExhaustMote = this.poolFx("short", () =>
      this.add.particles(0, 0, "fx_spark", {
        lifespan: { min: 280, max: 520 },
        speedX: { onEmit: () => this.exhaustVx * 0.5 + range(-16, 16) },
        speedY: { onEmit: () => this.exhaustVy * 0.5 + range(-16, 16) },
        scale: { start: 0.28, end: 0 },
        alpha: { start: 0.9, end: 0 },
        tint: { onEmit: () => this.exhaustTint },
        blendMode: "ADD",
        radial: false,
        emitting: false,
        frame: fxFrames,
        rotate: { onEmit: () => Phaser.Math.RadToDeg(this.exhaustAngle) },
      })
    );
    this.craftExhaustSmoke = this.poolFx("smoke", () =>
      this.add.particles(0, 0, "fx_smoke", {
        lifespan: { min: 2400, max: 4000 },
        speedX: { onEmit: () => this.exhaustVx * 0.42 + range(-10, 10) },
        speedY: { onEmit: () => this.exhaustVy * 0.42 + range(-10, 10) },
        scale: { start: 0.38, end: 1.2 },
        alpha: { start: 0.82, end: 0 },
        tint: { onEmit: () => this.exhaustSmokeTint },
        radial: false,
        emitting: false,
        frame: fxFrames,
        rotate: fxSpin,
      })
    );
    this.flame = this.poolFx("fire", () =>
      this.add.particles(0, 0, "fx_flame", {
        lifespan: { onEmit: () => 480 * this.trailFxLife },
        speed: { min: 8, max: 40 },
        scale: {
          onEmit: (p) => {
            const q = p as Phaser.GameObjects.Particles.Particle & { s0?: number };
            q.s0 = this.dmgFlameScale * (0.38 + Math.random() * 0.16);
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
    this.playerFlame = this.poolFx("fire", () =>
      this.add.particles(0, 0, "fx_flame", {
        lifespan: { onEmit: () => 480 * this.trailFxLife },
        speed: { min: 8, max: 40 },
        scale: {
          onEmit: (p) => {
            const q = p as Phaser.GameObjects.Particles.Particle & { s0?: number };
            q.s0 = this.dmgFlameScale * (0.38 + Math.random() * 0.16);
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
    this.hurtSmoke = this.poolFx("smoke", () =>
      this.add.particles(0, 0, "fx_smoke", {
        lifespan: {
          onEmit: () => {
            const base = range(2400, 4200);
            return base * Math.max(1, this.trailFxLife * 0.85);
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
    this.playerHurtSmoke = this.poolFx("smoke", () =>
      this.add.particles(0, 0, "fx_smoke", {
        lifespan: {
          onEmit: () => {
            const base = range(2400, 4200);
            return base * Math.max(1, this.trailFxLife * 0.85);
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
    this.burn = this.poolFx("fire", () =>
      this.add.particles(0, 0, "fx_flame", {
        lifespan: { onEmit: () => range(240, 420) * this.trailFxLife },
        speed: { min: 2, max: 14 },
        scale: {
          onEmit: (p) => fxEmit(p, () => (0.7 + Math.pow(Math.random(), 0.65) * 0.7) * this.trailFxScale),
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
    this.blastBurn = this.poolFx("fire", () =>
      this.add.particles(0, 0, "fx_flame", {
        lifespan: { onEmit: () => range(240, 420) * this.trailFxLife },
        speed: { min: 2, max: 14 },
        scale: {
          onEmit: (p) => fxEmit(p, () => (0.28 + Math.pow(Math.random(), 0.65) * 0.28) * this.trailFxScale),
          onUpdate: (p, _k, t) => fxLife(p, t, (u) => 1 - u * 0.9, 0.28),
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
    this.blastFire = this.add.particles(0, 0, "fx_flame", {
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
    this.blastFire.setDepth(Layer.WORLD);
    this.registerFx("fire", this.blastFire);
    this.ember = this.poolFx("fire", () =>
      this.add.particles(0, 0, "fx_flame", {
        lifespan: { onEmit: () => range(180, 320) * this.trailFxLife },
        speed: { min: 1, max: 10 },
        scale: {
          onEmit: (p) => fxEmit(p, () => (0.12 + Math.pow(Math.random(), 0.65) * 0.12) * this.trailFxScale),
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
    this.shortTrailSmoke = this.poolFx("smoke", () =>
      this.add.particles(0, 0, "fx_smoke", {
        lifespan: { onEmit: () => 520 * this.trailFxLife },
        speed: { min: 8, max: 36 },
        scale: {
          onEmit: (p) => fxEmit(p, () => 0.35 * this.trailFxScale),
          onUpdate: (p, _k, t) => fxLife(p, t, (u) => 1 + 3 * u, 0.35),
        },
        alpha: { start: 0.5, end: 0 },
        gravityY: -30,
        emitting: false,
        frame: fxFrames,
        rotate: fxSpin,
      })
    );
    this.lingerSmoke = this.poolFx("smoke", () =>
      this.add.particles(0, 0, "fx_smoke", {
        lifespan: {
          onEmit: () => range(2200, 4000) * Math.max(1, this.trailFxLife * 0.7),
        },
        speed: { min: 4, max: 18 },
        angle: { min: -128, max: -52 },
        scale: {
          onEmit: (p) => fxEmit(p, () => 0.28 * this.trailFxScale),
          onUpdate: (p, _k, t) => fxLife(p, t, (u) => 1 + 2.4 * u, 0.28),
        },
        alpha: { start: 0.42, end: 0 },
        gravityY: -6,
        accelerationX: { onEmit: () => (Math.random() - 0.5) * 18 },
        accelerationY: { onEmit: () => -5 + (Math.random() - 0.5) * 12 },
        emitting: false,
        frame: fxFrames,
        rotate: { min: -80, max: 80 },
      })
    );
    this.heliDust = this.add.particles(0, 0, "fx_smoke", {
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
    this.heliDust.setDepth(Layer.WORLD);
    this.registerFx("dust", this.heliDust);
    this.applyTimeScale();

    this.keyW = this.input.keyboard!.addKey("W");
    this.keyA = this.input.keyboard!.addKey("A");
    this.keyS = this.input.keyboard!.addKey("S");
    this.keyD = this.input.keyboard!.addKey("D");
    this.keySpace = this.input.keyboard!.addKey("SPACE");
    this.keyShift = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
    this.input.keyboard!.addKey("ONE").on("down", () => {
      if (this.editOpen) this.setEditBrush(0);
      else if (this.debugOpen || this.helpOpen) return;
      else this.heli.weapon = 0;
    });
    this.input.keyboard!.addKey("TWO").on("down", () => {
      if (this.editOpen) this.setEditBrush(1);
      else if (this.debugOpen || this.helpOpen) return;
      else this.heli.weapon = 1;
    });
    this.input.keyboard!.addKey("THREE").on("down", () => {
      if (this.editOpen) this.setEditBrush(2);
      else if (this.debugOpen || this.helpOpen) return;
      else this.heli.weapon = 2;
    });
    this.input.keyboard!.addKey("FOUR").on("down", () => {
      if (this.debugOpen || this.helpOpen) return;
      else this.heli.weapon = 3;
    });
    this.input.keyboard!.addKey("E").on("down", () => this.toggleReliefEditor());
    this.input.keyboard!.addKey("I").on("down", () => {
      if (this.editOpen) this.toggleEditInvert();
    });
    this.input.keyboard!.addKey("M").on("down", () => {
      if (!this.helpOpen && !this.exitOpen) this.toggleMap();
    });
    this.input.keyboard!.addKey("H").on("down", () => {
      if (!this.exitOpen) this.toggleHelp();
    });
    this.input.keyboard!.addKey("Q").on("down", () => {
      if (this.editOpen) this.nudgeEditRot(-1);
    });
    this.input.keyboard!.addKey("COMMA").on("down", () => {
      if (this.editOpen) this.nudgeEditOff(-1, 0);
    });
    this.input.keyboard!.addKey("PERIOD").on("down", () => {
      if (this.editOpen) this.nudgeEditOff(1, 0);
    });
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.OPEN_BRACKET).on("down", () => {
      if (configRigsAnyOpen(this)) return;
      if (this.debugSpawnOpen) this.nudgeDebugSpawn(-1);
      else if (this.debugCamOpen) this.nudgeDebugCam(-1);
      else if (this.editOpen) this.nudgeEditSize(-1);
    });
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.CLOSED_BRACKET).on("down", () => {
      if (configRigsAnyOpen(this)) return;
      if (this.debugSpawnOpen) this.nudgeDebugSpawn(1);
      else if (this.debugCamOpen) this.nudgeDebugCam(1);
      else if (this.editOpen) this.nudgeEditSize(1);
    });
    this.input.keyboard!.addKey("SEMICOLON").on("down", () => {
      if (this.debugCamOpen) this.nudgeDebugCam(-1);
      else if (this.editOpen) this.nudgeEditOff(0, -1);
    });
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.QUOTES).on("down", () => {
      if (this.debugCamOpen) this.nudgeDebugCam(1);
      else if (this.editOpen) this.nudgeEditOff(0, 1);
    });
    this.input.keyboard!.addKey("K").on("down", () => this.toggleHeightMap());
    this.input.keyboard!.addKey("P").on("down", () => this.handlePerfKey());
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.FORWARD_SLASH).on("down", () => this.toggleDebugMenu());
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ESC).on("down", () => {
      if (this.helpOpen) this.toggleHelp(false);
      else if (this.debugCamOpen) this.closeDebugCam();
      else if (this.debugSpawnOpen) this.closeDebugSpawn();
      else if (this.editOpen) this.toggleReliefEditor(false);
      else if (this.debugOpen) this.toggleDebugMenu(false);
      else this.toggleExitMenu();
    });
    this.input.keyboard!.addKey("R").on("down", () => {
      if (this.editOpen && !this.over) this.nudgeEditRot(1);
      else if (this.over) this.scene.start("load");
    });
    const bumpTime = (dir: number) => {
      if (configRigsAnyOpen(this)) return;
      if (this.debugCamOpen) this.nudgeDebugCam(dir);
      else this.nudgeTimeScale(dir);
    };
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.PLUS).on("down", () => bumpTime(1));
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.NUMPAD_ADD).on("down", () => bumpTime(1));
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.MINUS).on("down", () => bumpTime(-1));
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.NUMPAD_SUBTRACT).on("down", () => bumpTime(-1));
    installConfigRigHotkeys(this);
    this.input.keyboard!.addKey("F").on("down", () => this.toggleTestFx());
    this.input.keyboard!.addKey("T").on("down", () => this.toggleThermal());
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.UP).on("down", () => {
      if (configRigsAnyOpen(this)) return;
      if (this.helpOpen) this.nudgeHelp(-1);
      else if (this.debugSpawnOpen) this.nudgeDebugSpawn(-1);
      else if (this.debugCamOpen) this.nudgeDebugCamSel(-1);
      else if (this.debugOpen) this.nudgeDebugMenu(-1);
    });
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN).on("down", () => {
      if (configRigsAnyOpen(this)) return;
      if (this.helpOpen) this.nudgeHelp(1);
      else if (this.debugSpawnOpen) this.nudgeDebugSpawn(1);
      else if (this.debugCamOpen) this.nudgeDebugCamSel(1);
      else if (this.debugOpen) this.nudgeDebugMenu(1);
    });
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT).on("down", () => {
      if (configRigsAnyOpen(this)) return;
      if (this.helpOpen) this.nudgeHelp(-1);
      else if (this.debugCamOpen) this.nudgeDebugCam(-1);
    });
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT).on("down", () => {
      if (configRigsAnyOpen(this)) return;
      if (this.helpOpen) this.nudgeHelp(1);
      else if (this.debugCamOpen) this.nudgeDebugCam(1);
    });
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER).on("down", () => {
      if (this.debugSpawnOpen) this.debugSpawnSelected();
      else if (this.debugCamOpen) this.activateDebugCamRow();
      else if (this.debugOpen && !this.debugCamOpen) this.activateDebugRow(this.debugMenuIdx);
    });
    this.input.on("wheel", (_p: Phaser.Input.Pointer, _dx: number, dy: number) => {
      if (configRigsAnyOpen(this)) return;
      if (this.helpOpen) {
        this.nudgeHelp(dy > 0 ? 1 : -1);
        return;
      }
      if (this.debugCamOpen) {
        this.nudgeDebugCam(dy > 0 ? -1 : 1);
        return;
      }
      if (this.debugSpawnOpen) {
        this.nudgeDebugSpawn(dy > 0 ? 1 : -1);
        return;
      }
      if (this.editOpen) {
        this.nudgeEditSize(dy > 0 ? -1 : 1);
        return;
      }
      if (this.debugOpen) return;
      if (dy > 0) this.heli.weapon = (this.heli.weapon + 1) % this.loadout.length;
      else this.heli.weapon = (this.heli.weapon + this.loadout.length - 1) % this.loadout.length;
    });

    this.hud = this.add
      .text(16, 12, "", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "14px",
        color: "#e8b84a",
      })
      .setScrollFactor(0)
      .setDepth(Layer.HUD);
    this.liftPrompt = this.add
      .text(this.scale.width / 2, this.scale.height * 0.62, "HOLD SPACE TO LIFT OFF", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "18px",
        color: "#e8b84a",
        align: "center",
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(Layer.HUD + 8)
      .setVisible(false);
    this.fxHud = this.add
      .text(16, this.scale.height - 18, "", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "12px",
        color: "#8a8470",
      })
      .setOrigin(0, 1)
      .setScrollFactor(0)
      .setDepth(Layer.HUD + 5);
    this.fpsHud = this.add
      .text(this.scale.width - 16, this.scale.height - 18, "", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "12px",
        color: "#8a8470",
      })
      .setOrigin(1, 1)
      .setScrollFactor(0)
      .setDepth(Layer.HUD + 5);
    this.perfHud = this.add
      .text(16, 72, "", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "12px",
        color: "#8ee6ff",
        align: "left",
      })
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(Layer.HUD + 6)
      .setStroke("#101418", 4)
      .setVisible(false);
    this.syncTestFxHud();
    this.hvHud = this.add
      .text(this.scale.width - 16, 12, "", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "13px",
        color: "#f0e6c8",
        align: "right",
      })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(Layer.HUD);
    this.hvRows = this.world.hv.map((_, i) =>
      this.add
        .text(this.scale.width - 16, 12 + 20 + i * 17, "", {
          fontFamily: "Share Tech Mono, monospace",
          fontSize: "13px",
          color: "#f0e6c8",
          align: "right",
        })
        .setOrigin(1, 0)
        .setScrollFactor(0)
        .setDepth(Layer.HUD)
    );
    this.wpnBar = this.add.graphics().setScrollFactor(0).setDepth(Layer.HUD);
    this.wpnSlots = this.loadout.map(() =>
      this.add
        .text(0, 0, "", {
          fontFamily: "Share Tech Mono, monospace",
          fontSize: "15px",
          color: "#e8b84a",
        })
        .setOrigin(0.5, 0.5)
        .setScrollFactor(0)
        .setDepth(Layer.HUD + 1)
        .setStroke("#12100c", 4)
    );
    this.wpnHud = this.add.text(0, 0, "").setVisible(false);
    this.hpGfx = this.add.graphics().setDepth(Layer.FIELD);
    this.playerHud = this.add.graphics().setScrollFactor(0).setDepth(Layer.HUD + 12);
    bakeHurtVignetteTexture(this);
    this.hurtVignette = this.add
      .image(0, 0, "hurt_vignette")
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(Layer.HUD + 4)
      .setTint(0xff1a1a)
      .setAlpha(0)
      .setVisible(false);
    const wireBake = bakeHeliHudWireTexture(this);
    const panelWireW = 92;
    if (wireBake && this.textures.exists("heli_hud_wire")) {
      this.heliHudWireBake = wireBake;
      this.heliHudWireScale = panelWireW / wireBake.w;
      const origin = wireBake.pivot;
      this.heliHudWireSh = this.add
        .image(0, 0, "heli_hud_wire_sh")
        .setOrigin(origin.x, origin.y)
        .setScale(this.heliHudWireScale)
        .setScrollFactor(0)
        .setDepth(Layer.HUD + 10)
        .setAlpha(0.72);
      this.heliHudWire = this.add
        .image(0, 0, "heli_hud_wire")
        .setOrigin(origin.x, origin.y)
        .setScale(this.heliHudWireScale)
        .setScrollFactor(0)
        .setDepth(Layer.HUD + 11)
        .setTint(0x66cc55);
    } else {
      this.heliHudWireSh = this.add.image(0, 0, craftOf().body).setVisible(false).setScrollFactor(0);
      this.heliHudWire = this.add.image(0, 0, craftOf().body).setVisible(false).setScrollFactor(0).setDepth(Layer.HUD + 11);
    }
    this.mapLabel = this.add
      .text(this.scale.width / 2, this.scale.height - 48, "", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "16px",
        color: "#e8b84a",
      })
      .setOrigin(0.5, 1)
      .setScrollFactor(0)
      .setDepth(Layer.HUD + 20)
      .setVisible(false);

    this.miniGfx = this.add.graphics().setScrollFactor(0).setDepth(Layer.HUD + 1);
    this.hvGfx = this.add.graphics().setScrollFactor(0).setDepth(Layer.HUD + 2);
    this.hvArrowLabels = this.world.hv.map(() =>
      this.add
        .text(0, 0, "", {
          fontFamily: "Share Tech Mono, monospace",
          fontSize: "11px",
          color: "#f0e6c8",
          align: "center",
        })
        .setOrigin(0.5, 0.5)
        .setScrollFactor(0)
        .setDepth(Layer.HUD + 3)
        .setStroke("#12100c", 4)
        .setLineSpacing(-1)
        .setVisible(false)
    );
    this.mapGfx = this.add.graphics().setDepth(Layer.FIELD);
    this.mapHvLabels = [];
    this.debugGfx = this.add.graphics().setDepth(Layer.FIELD).setVisible(false);
    this.blastGfx = this.add.graphics().setDepth(Layer.FIELD + 20).setName("blast_radius_debug");
    this.aiGfx = this.add.graphics().setDepth(Layer.FIELD + 8);
    const cx = 18 + 88;
    const cy = this.scale.height - 18 - 88;
    this.miniMask = this.add.graphics().setScrollFactor(0);
    this.miniMask.fillStyle(0xffffff);
    this.miniMask.fillCircle(cx, cy, 88);
    this.miniBg = this.add.graphics().setScrollFactor(0).setDepth(Layer.HUD - 1);
    this.miniBg.fillStyle(0x12100c, 1);
    this.miniBg.fillCircle(cx, cy, 90);
    this.miniTerrain = this.add.image(cx, cy, "terrain").setScrollFactor(0).setDepth(Layer.HUD);
    this.miniTerrain.setMask(this.miniMask.createGeometryMask());
    if (this.textures.exists("wrecks")) this.textures.remove("wrecks");
    this.wreckLayer.saveTexture("wrecks");
    this.flatWreckage = this.add
      .image(0, WORLD, "wrecks")
      .setOrigin(0, 1)
      .setFlipY(true)
      .setDisplaySize(WORLD, WORLD)
      .setDepth(Layer.WRECK)
      .setVisible(false);
    this.miniWrecks = this.add.image(cx, cy, "wrecks").setScrollFactor(0).setDepth(Layer.HUD);
    if (this.terrain25d) this.miniWrecks.setFlipY(true);
    this.miniWrecks.setMask(this.miniMask.createGeometryMask());
    this.miniMask.setVisible(false);

    this.cameras.main.centerOn(this.heli.x, this.heli.y);
    this.cameras.main.setZoom(this.playZoom());
    this.camZoom = this.playZoom();
    this.playScrollX = this.heli.x - this.scale.width / 2;
    this.playScrollY = this.heli.y - this.scale.height / 2;
    this.playViewX = this.playScrollX;
    this.playViewY = this.playScrollY;
    this.playViewW = this.scale.width;
    this.playViewH = this.scale.height;
    this.playLastFrame = true;
    this.setupDebugMenu();
    this.setupHelp();
    this.setupExitMenu();
    this.setupHudCam();
    this.lockTxt.setName("hud_lock");
    this.lockInbdTxt.setName("hud_fire");
    this.lockHudTxt.setName("hud_lock_offscreen");
    this.lockInbdHudTxt.setName("hud_fire_offscreen");
    this.hud.setName("hud_status");
    this.fpsHud.setName("hud_fps");
    this.perfHud.setName("hud_perf");
    this.hvHud.setName("hud_hv");
    this.hvRows.forEach((t, i) => t.setName(`hv_row_${i}`));
    this.wpnSlots.forEach((t, i) => t.setName(`wpn_slot_${i}`));
    this.wpnHud.setName("hud_wpn");
    this.mapLabel.setName("map_label");
    this.hvArrowLabels.forEach((t, i) => t.setName(`hv_arrow_${i}`));
    nameGeneratedTextures(this);
  }

  stampDecor(): void {
    const g = this.world.canvas.getContext("2d")!;
    g.imageSmoothingEnabled = true;
    for (const d of this.world.decor) {
      const tex = doodadTex(d.kind);
      const skin = resolveSkin(this.textures, tex, camoForBiome(sampleBiome(this.world, d.x, d.y)));
      if (!this.textures.exists(skin)) continue;
      const img = this.textures.get(skin).getSourceImage() as CanvasImageSource;
      const s = d.size;
      g.save();
      g.globalAlpha = 0.9;
      g.translate(d.x / SCALE, d.y / SCALE);
      g.rotate(d.rot * 0.15);
      g.drawImage(img, -s / 2, -s / 2, s, s);
      g.restore();
    }
    g.globalAlpha = 1;
    applyTerrainLight(this.world.canvas, this.world.height);
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
    tint?: number
  ): void {
    if (!this.textures.exists(key)) return;
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
    } else {
      this.stampBrush.clearTint();
      this.stampBrush.setBlendMode(Phaser.BlendModes.NORMAL);
    }
    this.wreckLayer.draw(this.stampBrush);
    this.stampBrush.clearTint();
    this.stampBrush.setBlendMode(Phaser.BlendModes.NORMAL);
  }

  /** World-space decal scale with optional travel-grade squash. */
  wreckDrawScale(
    x: number,
    y: number,
    _z: number,
    scale = 1,
    slope = false,
    angle = 0
  ): { sx: number; sy: number } {
    if (!slope) return { sx: scale, sy: scale };
    const sl = groundSlope(this.world, x, y);
    const grade = Phaser.Math.Clamp(sl.dx * Math.cos(angle) + sl.dy * Math.sin(angle), -0.4, 0.4);
    return {
      sx: scale * (1 + Math.abs(grade) * 0.05),
      sy: scale * (1 - grade * 0.12),
    };
  }

  stampLightBlast(x: number, y: number, vx: number, vy: number): void {
    if (isWater(this.world, x, y)) return;
    const key = `fx_blast_${(Math.random() * 4) | 0}`;
    if (!this.textures.exists(key) && !this.textures.exists("fx_blast_0")) return;
    const spd = Math.hypot(vx, vy);
    const ang = spd > 10 ? Math.atan2(vy, vx) : Math.random() * Math.PI * 2;
    const sc = range(0.065, 0.145);
    const stretch = 1 + Math.min(0.7, spd * 0.0024);
    this.stampWreck(
      this.textures.exists(key) ? key : "fx_blast_0",
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
    if (isWater(this.world, x, y) || !this.textures.exists("fx_dirt")) return;
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
    if (!s.blood || isWater(this.world, s.x, s.y) || !this.textures.exists(s.tex)) return;
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

    const tex = this.textures.get(s.tex);
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
    const sg = bloodStampScratch.getContext("2d")!;
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
    const g = this.world.canvas.getContext("2d")!;
    g.save();
    g.globalCompositeOperation = "multiply";
    g.globalAlpha = Phaser.Math.Clamp(0.35 + fade * 0.65, 0.2, 0.85);
    g.translate(s.x / SCALE, s.y / SCALE);
    g.rotate(rot);
    g.drawImage(bloodStampScratch, 0, 0, tw, th, -ox * dw, -oy * dh, dw, dh);
    g.restore();
  }

  /** Soft, patchy tire print for bouncing / rolling wheel debris. */
  stampWheelTrack(x: number, y: number, ang: number, scale = 0.72, alpha = 0.38): void {
    if (isWater(this.world, x, y)) return;
    // Skip often so the trail reads as broken / inconsistent.
    if (Math.random() < 0.38) return;
    const key = this.textures.exists("track_mono")
      ? "track_mono"
      : this.textures.exists("track_tire")
        ? "track_tire"
        : "track";
    if (!this.textures.exists(key)) return;
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

  debrisStampOrigin(key: string): { x: number; y: number } {
    return spritePivot(key);
  }

  /** ` cycles closed → sprite → roster → combat → closed — owned by ConfigRigsScene. */

  update(_t: number, dms: number): void {
    const perfOn = this.perfEnabled;
    const perfSceneStart = perfOn ? performance.now() : 0;
    if (configRigsAnyOpen(this)) {
      this.reticle.setVisible(false);
      this.reticleMark.setVisible(false);
      this.reticleMark.clear();
      this.sight.setVisible(false);
      this.sight.clear();
      return;
    }
    const wallDt = Math.min(dms / 1000, 0.05);
    const mapPause = this.mapWant || this.mapBlend > 0.02;
    const uiPause = mapPause || this.helpOpen || this.exitOpen;
    let simScale = this.timeScale;
    if (this.stingerT > 0) simScale = Math.min(simScale, 0.18);
    for (const shot of this.shots) {
      if (shot.from === "player" && shot.warpTimeScale != null) {
        simScale = Math.min(simScale, shot.warpTimeScale);
      }
    }
    const dt = uiPause ? 0 : wallDt * simScale;
    this.setSimTimeScale(uiPause ? 0 : simScale);
    this.tickStinger(wallDt);
    for (const policy of Object.values(this.fxPolicies)) policy.emitted = 0;
    this.syncFpsHud();
    if (this.over) {
      this.drawMinimap();
      this.drawPlayerHud();
      this.towWireGfx.clear();
      return;
    }
    this.syncPlayView();
    this.updateTheaterCam(wallDt);
    if (this.mapBlend < 0.001) this.syncLookCam(wallDt);

    if (!mapPause) {
      this.rebuildUnitIdMap();
      if (perfOn) {
        const timings = this.perfCurrent!;
        timings.fill(0);
        let t = performance.now();
        const aim = this.worldPointer();
        this.heli.update(
          dt,
          this.world,
          {
            up: this.keyW.isDown,
            down: this.keyS.isDown,
            left: this.keyA.isDown,
            right: this.keyD.isDown,
          },
          aim.x,
          aim.y,
          this.keySpace.isDown,
          this.keyShift.isDown
        );
        this.syncProjectionPose();
        this.syncHeliGfx(dt);
        this.handleFire(dt);
        this.tickPlayerMuzzles(dt);
        timings[2] = performance.now() - t;

        t = performance.now();
        this.updateUnits(dt);
        timings[3] = performance.now() - t - timings[4]!;

        t = performance.now();
        this.updateShots(dt);
        timings[5] = performance.now() - t - timings[6]!;

        if (this.heli.phase === "dead" && !this.playerCrashStarted) this.beginPlayerCrash();
        t = performance.now();
        this.updateDebris(dt);
        timings[7] = performance.now() - t - timings[8]!;

        t = performance.now();
        this.updateSimParticles(dt);
        timings[9] = performance.now() - t - timings[10]!;

        t = performance.now();
        this.updateLock();
        this.drawUnitBars();
        this.emitDamageFx();
        this.emitHeliCrashDmgFlames();
        this.drawDebugHits();
        timings[11] = performance.now() - t;
      } else {
        const aim = this.worldPointer();
        this.heli.update(
          dt,
          this.world,
          {
            up: this.keyW.isDown,
            down: this.keyS.isDown,
            left: this.keyA.isDown,
            right: this.keyD.isDown,
          },
          aim.x,
          aim.y,
          this.keySpace.isDown,
          this.keyShift.isDown
        );

        this.syncProjectionPose();
        this.syncHeliGfx(dt);
        this.handleFire(dt);
        this.tickPlayerMuzzles(dt);
        this.updateUnits(dt);
        this.updateShots(dt);
        if (this.heli.phase === "dead" && !this.playerCrashStarted) this.beginPlayerCrash();
        this.updateDebris(dt);
        this.updateSimParticles(dt);
        this.updateLock();
        this.drawUnitBars();
        this.emitDamageFx();
        this.emitHeliCrashDmgFlames();
        this.drawDebugHits();
      }
    }
    this.tickDebugBlast(wallDt);

    if (this.editOpen) this.handleReliefEdit(wallDt);
    this.drawDebugAi();
    // Apply suppression after draw/debug updates so nothing can re-enable
    // itself over the theater map later in this frame.
    this.setTheaterWorldHidden(this.mapBlend > 0.5);

    const mapOn = this.mapBlend > 0.12;
    this.syncHudParallax(wallDt);
    this.setHudVisible(!mapOn);
    if (mapOn) {
      this.drawMapOverlay();
      this.towWireGfx.clear();
    } else {
      this.mapGfx.clear();
      this.hideMapHvLabels();
      this.drawHud();
      this.drawMinimap();
      this.drawHvArrows();
      this.drawPlayerHud();
      this.drawTowWires();
    }

    if (this.shake > 0 && this.mapBlend < 0.12) {
      // Don't re-call shake() every frame — that restarts the effect and causes visible stutter.
      const shaking = this.cameras.main.shakeEffect?.isRunning;
      if (!shaking) {
        this.cameras.main.shake(90, Math.min(0.018, this.shake * 0.0024));
        this.shake = 0;
      } else {
        this.shake *= 0.9;
        if (this.shake < 0.06) this.shake = 0;
      }
    }
    this.tickTestPostFx(wallDt);

    let hvAlive = false;
    let completedTarget: { x: number; y: number } | undefined;
    for (const h of this.world.hv) {
      let objectiveAlive = false;
      for (const u of this.units) {
        if (u.hv === h.id && !u.dead) {
          hvAlive = true;
          objectiveAlive = true;
          break;
        }
      }
      if (!objectiveAlive && !this.completedHv.has(h.id)) {
        this.completedHv.add(h.id);
        completedTarget = { x: h.x, y: h.y };
        if (this.heli.phase !== "dead" && this.completedHv.size < this.world.hv.length) {
          this.showStinger(
            "OBJECTIVE COMPLETE",
            `${h.name} neutralized`,
            0xe8b84a,
            4.2,
            completedTarget
          );
        }
      }
    }
    if (!hvAlive && this.heli.phase !== "dead" && !this.missionEndQueued) {
      this.missionEndQueued = true;
      this.showStinger(
        "MISSION COMPLETE",
        `${missionOf().label} · all objectives neutralized`,
        0xe8b84a,
        5.2,
        completedTarget,
        () => this.end(true)
      );
    }
    if (this.heli.phase === "dead") {
      if (!this.playerCrashStarted) this.beginPlayerCrash();
      else if (this.playerCrashLanded && this.playerCrashEndT < 0) {
        this.playerCrashSimmerT -= wallDt;
        if (this.playerCrashSimmerT <= 0) this.playerCrashEndT = 0.55;
      } else if (this.playerCrashLanded && this.playerCrashEndT >= 0) {
        this.playerCrashEndT -= wallDt;
        if (this.playerCrashEndT <= 0 && this.stingerT <= 0) this.end(false);
      }
    }
    if (perfOn && !mapPause) {
      this.recordPerfSample(dms, performance.now() - perfSceneStart);
    }
  }

  spriteOrigin(key: string): { x: number; y: number } {
    if (key === "heli_rotor") return { x: this.rotor.originX, y: this.rotor.originY };
    return spritePivot(key);
  }

  makeUnit(kind: Unit["kind"], x: number, y: number, pinId?: number, pinMount?: number): Unit {
    const st = stats(kind);
    const sp = specOf(kind);
    const parts = rollParts(kind);
    const guns = gunsOf({ kind, parts });
    const ang = spawnAngle(kind);
    return {
      id: nextId(),
      kind,
      x,
      y,
      z: sp.aerial ? groundZ(this.world, x, y) + CRUISE_AGL : groundZ(this.world, x, y),
      vx: 0,
      vy: 0,
      angle: ang,
      turret: ang,
      health: st.health,
      max: st.health,
      dead: false,
      fireCd: Math.random(),
      burstLeft: 0,
      orbit: Math.random() * Math.PI * 2,
      rotor: 0,
      track: 0,
      turrets: guns.map(() => Math.random() * Math.PI * 2),
      muzzleT: 0,
      muzzleGun: 0,
      muzzleTip: 0,
      pinId,
      pinMount,
      parts,
      camo: kind === "lav_aa" ? "digital" : camoForBiome(sampleBiome(this.world, x, y)),
    };
  }

  /** Fixed-sprite troops: `angle` = move base, `turret` = aim / draw facing. */
  troopSoftTurret(u: Unit): boolean {
    const sp = specOf(u.kind);
    return !gunsOf(u).length && (sp.move === "inf" || sp.move === "flee");
  }

  troopDrawAng(u: Unit): number {
    return this.troopSoftTurret(u) ? u.turret : u.angle;
  }

  mountAt(host: Unit, tex: string, mount: { x: number; y: number }): { x: number; y: number } {
    const pivot = spritePivot(tex);
    const rot = host.angle + specOf(host.kind).rotOff;
    const img = this.textures.exists(tex)
      ? (this.textures.get(tex).getSourceImage() as { width: number; height: number })
      : { width: 52, height: 52 };
    const mx = (mount.x - pivot.x) * img.width;
    const my = (mount.y - pivot.y) * img.height;
    return {
      x: host.x + mx * Math.cos(rot) - my * Math.sin(rot),
      y: host.y + mx * Math.sin(rot) + my * Math.cos(rot),
    };
  }

  /** World position of a gun's mount on the hull (aim pivot), independent of barrel angle. */
  gunMountPos(u: Unit, gunI = 0): { x: number; y: number } {
    const guns = gunsOf(u);
    const gun = guns[gunI];
    if (!gun) return { x: u.x, y: u.y };
    const mount = gun.mount;
    return this.mountAt(u, resolveSkin(this.textures, textureOf(u.kind), u.camo), mount);
  }

  /** Spawn pinned crew from host UnitSpec.crew (any kind with seats). */
  spawnCrewFor(host: Unit): Unit[] {
    const crew = crewOf(host.kind);
    if (!crew?.mounts.length) return [];
    const tex = resolveSkin(this.textures, textureOf(host.kind), host.camo);
    const chance = crew.chance ?? 1;
    const out: Unit[] = [];
    for (let i = 0; i < crew.mounts.length; i++) {
      if (Math.random() >= chance) continue;
      const m = crew.mounts[i]!;
      const at = this.mountAt(host, tex, m);
      out.push(this.makeUnit(pickTroop(), at.x, at.y, host.id, i));
    }
    return out;
  }

  /** Host that snaps pinned crew to a mount UV (e.g. vehicle bed) — blocks flee/walk. */
  snapHost(u: Unit): Unit | undefined {
    if (u.pinId == null) return undefined;
    const post = this.unitById(u.pinId);
    if (!post) return undefined;
    return crewOf(post.kind)?.mode === "snap" ? post : undefined;
  }

  leashPinned(u: Unit): void {
    if (u.pinId == null) return;
    const post = this.unitById(u.pinId);
    if (!post) {
      u.pinId = undefined;
      u.pinMount = undefined;
      return;
    }
    const crew = crewOf(post.kind);
    if (!crew?.mounts.length) {
      u.pinId = undefined;
      u.pinMount = undefined;
      return;
    }
    if (crew.mode === "snap") {
      const m = crew.mounts[u.pinMount ?? 0] ?? crew.mounts[0]!;
      const tex = resolveSkin(this.textures, textureOf(post.kind), post.camo);
      const at = this.mountAt(post, tex, m);
      u.x = at.x;
      u.y = at.y;
      return;
    }
    const r = crew.leashR ?? radius(post.kind);
    const dx = u.x - post.x;
    const dy = u.y - post.y;
    const d = Math.hypot(dx, dy);
    if (d <= r || d < 0.001) return;
    u.x = post.x + (dx / d) * r;
    u.y = post.y + (dy / d) * r;
  }

  applyCastShadow(
    sh: Phaser.GameObjects.Image,
    x: number,
    y: number,
    z: number,
    tex: string,
    rot: number,
    scale = 1,
    raycastInterval = 1,
    cacheOwner?: object
  ): void {
    type CachedShadow = {
      x: number;
      y: number;
      z: number;
      cast: number;
      sourceX: number;
      sourceY: number;
      sourceZ: number;
      frame: number;
      owner?: object;
    };
    const frame = this.game.loop.frame;
    let hit = sh.getData("shadowHit") as CachedShadow | undefined;
    const movedFar =
      !hit ||
      hit.owner !== cacheOwner ||
      Math.abs(x - hit.sourceX) > 48 ||
      Math.abs(y - hit.sourceY) > 48 ||
      Math.abs(z - hit.sourceZ) > 24;
    if (movedFar || raycastInterval <= 1 || frame - hit!.frame >= raycastInterval) {
      const fresh = castShadowToGround(this.world, x, y, z);
      hit ??= {
        x: 0,
        y: 0,
        z: 0,
        cast: 0,
        sourceX: 0,
        sourceY: 0,
        sourceZ: 0,
        frame: -1,
      };
      hit.x = fresh.x;
      hit.y = fresh.y;
      hit.z = fresh.z;
      hit.cast = fresh.cast;
      hit.sourceX = x;
      hit.sourceY = y;
      hit.sourceZ = z;
      hit.frame = frame;
      hit.owner = cacheOwner;
      sh.setData("shadowHit", hit);
    }
    const resolved = hit!;
    const cast = resolved.cast;
    const at = worldToScreen(resolved.x, resolved.y, resolved.z);
    const want = shadowKey(tex, cast);
    const sk = this.textures.exists(want) ? want : "shadow";
    if (sh.texture.key !== sk) sh.setTexture(sk);
    sh.setPosition(at.x, at.y)
      .setRotation(projectHeading(rot, resolved.x, resolved.y, resolved.z))
      .setAlpha(shadowAlpha(cast))
      .setScale(scale * at.scale);
    const depth = worldDepth(resolved.z, -12, resolved.y);
    if (sh.depth !== depth) sh.setDepth(depth);
  }

  projectedInView(x: number, y: number, pad: number): boolean {
    const view = this.cameras.main.worldView;
    return (
      x >= view.x - pad &&
      x <= view.right + pad &&
      y >= view.y - pad &&
      y <= view.bottom + pad
    );
  }

  syncHeliGfx(dt = 1 / 60): void {
    const h = this.heli;
    if (h.phase === "dead") {
      this.body.setVisible(false);
      for (const rotor of this.rotors) rotor.setVisible(false);
      for (const gun of this.guns) gun.setVisible(false);
      this.gun.setVisible(false);
      this.shadow.setVisible(false);
      for (const muzzle of this.muzzlePool) muzzle.setVisible(false);
      for (const flame of this.exhaustFlames) flame.setVisible(false);
      return;
    }
    const craft = h.spec;
    this.applyCastShadow(this.shadow, h.x, h.y, h.z, craft.body, h.angle + craft.rotOff);
    this.shadow.setOrigin(craftOrigin(craft).x, craftOrigin(craft).y);
    const scr = worldToScreen(h.x, h.y, h.z);
    const zs = scr.scale;
    const bob =
      h.phase === "flight" && craft.flightModel !== "plane"
        ? Math.sin(this.time.now * 0.0026) * 2.2 * zs
        : 0;
    const bodyRot = projectHeading(h.angle + craft.rotOff, h.x, h.y, h.z);
    this.body.setOrigin(craftOrigin(craft).x, craftOrigin(craft).y);
    this.body.setPosition(scr.x, scr.y - bob);
    this.body.setRotation(bodyRot);
    const sx = 1 + Math.abs(h.roll) * 0.12;
    const sy = 1 - Math.abs(h.pitch) * 0.14;
    this.body.setScale(sx * zs, sy * zs);
    const tiltRot = projectHeading(h.angle, h.x, h.y, h.z);
    const rOffF = h.pitch * 16 * zs;
    const rOffS = h.roll * 14 * zs;
    const gunParts = this.craftParts.guns;
    const aimMountUv = gunParts[0]?.mount ?? craftOrigin(craft);
    const aimMount = spriteUvPos(this.body, aimMountUv.x, aimMountUv.y);
    // Aim in world XY (mount unprojected; pointer is ground-unprojected).
    if (craft.gunMode === "fixed") {
      h.gunAngle = h.angle;
    } else if (h.phase === "flight" || h.phase === "ready" || h.phase === "spool") {
      const aim = this.worldPointer();
      const mountW = screenToWorldAtZ(aimMount.x, aimMount.y + bob, h.z);
      const want = Math.atan2(aim.y - mountW.y, aim.x - mountW.x);
      // Snappy chin traverse, but slow enough to read as a turret (not mouse lock).
      h.gunAngle = Phaser.Math.Angle.RotateTo(h.gunAngle, want, 3.6 * dt);
    }
    const gunRot = projectHeading(h.gunAngle + Math.PI / 2, h.x, h.y, h.z);
    this.guns.forEach((gun, i) => {
      const gunMount = gunParts[i]?.mount ?? aimMountUv;
      const at = spriteUvPos(this.body, gunMount.x, gunMount.y);
      gun
        .setVisible(true)
        .setPosition(at.x, at.y)
        .setRotation(gunRot)
        .setScale(zs)
        .setDepth(worldDepth(h.z, ZOff.gun + i * 0.001, h.y));
      applyEdgeLight(gun, gun.rotation);
    });
    const rotorParts = this.craftParts.rotors;
    if (!rotorParts.length) {
      for (const rotor of this.rotors) rotor.setVisible(false);
    } else {
      this.rotors.forEach((rotor, i) => {
        const part = rotorParts[i]!;
        const spinKey = part.spinTex;
        const useSpin = !!spinKey && h.rotorSpd >= 16 && this.textures.exists(spinKey);
        const rotorKey = useSpin ? spinKey! : part.tex;
        rotor.setVisible(true);
        if (rotor.texture.key !== rotorKey) rotor.setTexture(rotorKey);
        const rotorAt = spriteUvPos(
          this.body,
          part.mount.x,
          part.mount.y
        );
        rotor
          .setPosition(
            rotorAt.x + Math.cos(tiltRot) * rOffF - Math.sin(tiltRot) * rOffS,
            rotorAt.y + Math.sin(tiltRot) * rOffF + Math.cos(tiltRot) * rOffS
          )
          .setRotation(i % 2 ? -h.rotor : h.rotor)
          .setScale(craftCompositePartScale(part, rotor.width, zs))
          .setAlpha(1)
          .setDepth(worldDepth(h.z, ZOff.rotor + i * 0.001, h.y));
        clearEdgeLight(rotor);
      });
    }
    applyEdgeLight(this.body, bodyRot);
    this.body.setDepth(worldDepth(h.z, ZOff.body, h.y));
    this.muzzle.setDepth(worldDepth(h.z, ZOff.muzzle, h.y));
    this.syncReticles();
    this.emitDustOff(dt);
    this.emitCraftExhaust(dt);
  }

  emitCraftExhaust(dt: number): void {
    const h = this.heli;
    const mounts = craftExhaustMounts(h.spec);
    if (!mounts.length || h.phase === "dead" || h.thrustPower <= 0.03) {
      this.exhaustEmitCarry = 0;
      this.exhaustPrevWorld.length = 0;
      for (const flame of this.exhaustFlames) flame.setVisible(false);
      return;
    }
    const profile =
      h.spec.kind === "cyberhawk"
        ? { rate: 18, speed: 105, tint: 0x70d8ff, smoke: 0x485761, sx: 0.58, sy: 0.28, life: 760, flame: 0.68, gap: 10 }
        : h.spec.kind === "prometheus"
          ? { rate: 12, speed: 72, tint: 0xc86cff, smoke: 0x6b3a78, sx: 0.52, sy: 0.34, life: 920, flame: 0.78, gap: 12 }
          : h.spec.kind === "warthog"
            ? { rate: 25, speed: 170, tint: 0xff8a2c, smoke: 0x3d3935, sx: 0.72, sy: 0.3, life: 680, flame: 0.92, gap: 14 }
            : h.spec.kind === "lightning_ii"
              ? { rate: 24, speed: 195, tint: 0xbfeaff, smoke: 0x3b4145, sx: 0.68, sy: 0.25, life: 640, flame: 0.82, gap: 14 }
              : undefined;
    if (!profile) {
      this.exhaustPrevWorld.length = 0;
      for (const flame of this.exhaustFlames) flame.setVisible(false);
      return;
    }

    const power = Phaser.Math.Clamp(h.thrustPower, 0, 1);
    const jetAng = projectHeading(h.angle + Math.PI, h.x, h.y, h.z);
    this.exhaustAngle = jetAng;
    const zs = worldToScreen(h.x, h.y, h.z).scale;
    const frameStep = Math.floor(this.time.now / 55);
    this.exhaustFlames.forEach((flame, i) => {
      const mount = mounts[i];
      if (!mount) {
        flame.setVisible(false);
        return;
      }
      const at = spriteUvPos(this.body, mount.x, mount.y);
      const flicker = 0.92 + Math.sin(this.time.now * 0.043 + i * 2.17) * 0.08;
      const sc = profile.flame * zs * (0.35 + power * 0.75);
      flame
        .setVisible(true)
        .setFrame((frameStep + i) % FX_VARIANTS)
        .setPosition(at.x, at.y)
        .setRotation(jetAng)
        .setScale(sc * flicker, sc * (1.04 - flicker * 0.12))
        .setTint(profile.tint)
        .setAlpha(0.62 + power * 0.34)
        // The attached flame lights the nozzle and belongs just above the hull.
        .setDepth(this.body.depth + 0.2);
    });

    this.exhaustEmitCarry += profile.rate * power * mounts.length * Math.min(dt, 0.05);
    const emitN = Math.min(8, Math.floor(this.exhaustEmitCarry));
    this.exhaustEmitCarry -= emitN;
    if (!emitN) return;

    const jetSpeed = profile.speed * (0.45 + power * 0.75);
    this.exhaustTint = profile.tint;
    this.exhaustSmokeTint = profile.smoke;
    this.exhaustScaleY = profile.sy * (0.75 + power * 0.25);
    this.exhaustLife = profile.life;

    const glow = this.fxAt(h.z, h.y, this.craftExhaust, ZOff.exhaust + 0.04);
    const mote = this.fxAt(h.z, h.y, this.craftExhaustMote, ZOff.exhaust + 0.08);
    const smoke = this.fxAt(h.z, h.y, this.craftExhaustSmoke, ZOff.exhaust - 0.35);
    // Depth-band rounding can otherwise put a trail over the hull. Exhaust particles
    // always remain beneath it; only the attached nozzle flame is allowed above.
    glow.setDepth(this.body.depth - 1.2);
    mote.setDepth(this.body.depth - 1);
    smoke.setDepth(this.body.depth - 1.4);
    for (let i = 0; i < emitN; i++) {
      const mountI = this.exhaustMountCursor++ % mounts.length;
      const mount = mounts[mountI]!;
      const nozzle = this.craftBodyMountWorldPos(mount);
      const gap = profile.gap * (0.7 + power * 0.3);
      const jetWorldAngle = h.angle + Math.PI;
      const current = {
        x: nozzle.x + Math.cos(jetWorldAngle) * gap,
        y: nozzle.y + Math.sin(jetWorldAngle) * gap,
        z: h.z,
      };
      const currentAt = worldToScreen(current.x, current.y, current.z);
      const currentScreenX = currentAt.x;
      const currentScreenY = currentAt.y;
      let emitX = currentScreenX;
      let emitY = currentScreenY;
      let connectionAngle = jetAng;
      const baseScaleX = profile.sx * (0.65 + power * 0.55);
      this.exhaustScaleX = baseScaleX;

      const previous = this.exhaustPrevWorld[mountI];
      if (previous && Math.hypot(current.x - previous.x, current.y - previous.y) < 180) {
        const previousAt = worldToScreen(previous.x, previous.y, previous.z);
        const dx = previousAt.x - currentScreenX;
        const dy = previousAt.y - currentScreenY;
        const span = Math.hypot(dx, dy);
        if (span > 0.5) {
          emitX = (currentScreenX + previousAt.x) * 0.5;
          emitY = (currentScreenY + previousAt.y) * 0.5;
          connectionAngle = Math.atan2(dy, dx);
          const frameWidth = Math.max(1, this.textures.get("fx_exhaust").get(0).cutWidth);
          this.exhaustScaleX = Math.max(baseScaleX * 0.22, (span / frameWidth) * 1.12);
        }
      }
      this.exhaustPrevWorld[mountI] = current;

      // Spawn over the chord between consecutive nozzle positions, then drift
      // down that chord with a small amount of directional jitter.
      this.exhaustAngle = connectionAngle;
      const motionAngle = connectionAngle + range(-0.045, 0.045);
      const motionSpeed = jetSpeed * range(0.94, 1.06);
      this.exhaustVx = Math.cos(motionAngle) * motionSpeed;
      this.exhaustVy = Math.sin(motionAngle) * motionSpeed;
      this.emitBudgeted("fire", glow, emitX, emitY, 1);
      if (Math.random() < 0.52 + power * 0.28) this.emitBudgeted("short", mote, currentScreenX, currentScreenY, 1);
      const smokeX = currentScreenX + Math.cos(jetAng) * gap * zs * 0.65;
      const smokeY = currentScreenY + Math.sin(jetAng) * gap * zs * 0.65;
      // Every exhaust pulse gets smoke; category budgets still provide the hard cap.
      this.emitBudgeted("smoke", smoke, smokeX, smokeY, 1);
    }
  }

  emitDustOff(dt: number): void {
    const h = this.heli;
    if (h.phase === "dead") return;
    const agl = castZ(this.world, h.x, h.y, h.z);
    const takeoff = h.phase === "spool" || h.phase === "ready";
    const low = h.phase === "flight" && agl < 26;
    if (!takeoff && !low) return;
    const power = takeoff
      ? h.dustPower
      : Phaser.Math.Clamp(1 - agl / 26, 0, 1) * 0.72;
    if (power < 0.04) return;
    const rate = Phaser.Math.Clamp(dt, 0, 0.05) * 60;
    const gnd = groundZ(this.world, h.x, h.y);
    const wet = isWater(this.world, h.x, h.y);
    this.heliDust.setDepth(worldDepth(gnd, 0.2, h.y));
    const puffs = Math.max(0, Math.round((takeoff ? 0.4 + power * 4.5 : 0.6 + power * 1.4) * rate));
    for (let i = 0; i < puffs; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = range(16, 56 + power * 36);
      const wx = h.x + Math.cos(a) * r;
      const wy = h.y + Math.sin(a) * r;
      const at = worldToScreen(wx, wy, groundZ(this.world, wx, wy));
      this.heliDust.setEmitterAngle(Phaser.Math.RadToDeg(a) + (Math.random() - 0.5) * 28);
      this.emitBudgeted("dust", this.heliDust, at.x, at.y, 1);
    }
    if (wet) return;
    const n = Math.max(0, Math.round((takeoff ? 0.5 + power * 9 : 1 + power * 3) * rate));
    if (n < 1) return;
    const admitted = this.reserveSimParticleSlots("dust", n);
    const biome = sampleBiome(this.world, h.x, h.y);
    const spinSign = h.rotorSpd >= 0 ? 1 : -1;
    for (let i = 0; i < admitted; i++) {
      const a = Math.random() * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const r0 = range(8, 26);
      const spd = range(420, 800) * (0.35 + power * 0.9);
      const life = range(0.48, 0.86);
      const look = simParticleLook("dirt", biome);
      this.simParticles.push({
        x: h.x + ca * r0,
        y: h.y + sa * r0,
        z: gnd + range(2, 8),
        vx: ca * spd,
        vy: sa * spd,
        vz: range(8, 36),
        life,
        max: life,
        scale: range(0.62, 1),
        bounces: 0,
        kind: "dirt",
        tex: simParticleTexKey("dirt"),
        frame: (Math.random() * FX_VARIANTS) | 0,
        angJit: range(-0.06, 0.06),
        spin: spinSign * range(1.1, 3.2),
        tint: look.tint,
        additive: look.add,
        heading: a,
        capacityClass: "dust",
        dart: true,
        ox: h.x,
        oy: h.y,
        swirl: spinSign * range(180, 420),
      });
    }
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

  emitDustShock(x: number, y: number, power = 1): void {
    const gnd = groundZ(this.world, x, y);
    const wet = isWater(this.world, x, y);
    const at = worldToScreen(x, y, gnd);
    const ring = this.add.circle(at.x, at.y, 8, 0xd2c09a, 0.62)
      .setScale(at.scale)
      .setDepth(worldDepth(gnd, 0.45, y));
    this.tweens.add({
      targets: ring,
      radius: 58 + power * 48,
      alpha: 0,
      duration: 520,
      ease: "Cubic.Out",
      onComplete: () => ring.destroy(),
    });
    if (wet) return;
    const n = Math.round(64 * power);
    const admitted = this.reserveSimParticleSlots("dust", n);
    const biome = sampleBiome(this.world, x, y);
    for (let i = 0; i < admitted; i++) {
      // If capacity trims this burst, retain a complete ring rather than a visibly chopped arc.
      const a = (i / Math.max(1, admitted)) * Math.PI * 2 + range(-0.12, 0.12);
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const spd = range(145, 290) * (0.92 + power * 0.1);
      const life = range(1.2, 1.8);
      const look = simParticleLook("dirt", biome);
      const tint = Phaser.Display.Color.Interpolate.ColorWithColor(
        Phaser.Display.Color.IntegerToColor(look.tint),
        Phaser.Display.Color.IntegerToColor(0xd8c9a4),
        100,
        42
      );
      this.simParticles.push({
        x: x + ca * range(2, 12),
        y: y + sa * range(2, 12),
        z: gnd + range(3, 14),
        vx: ca * spd,
        vy: sa * spd,
        vz: range(24, 90),
        life,
        max: life,
        scale: range(1.15, 1.85),
        bounces: 0,
        kind: "dirt",
        tex: simParticleTexKey("dirt"),
        frame: (Math.random() * FX_VARIANTS) | 0,
        angJit: range(-0.04, 0.04),
        spin: 0,
        tint: Phaser.Display.Color.GetColor(tint.r, tint.g, tint.b),
        additive: false,
        heading: a,
        capacityClass: "dust",
        shock: true,
      });
    }
  }

  syncReticles(): void {
    const p = this.input.activePointer;
    this.reticle.setPosition(p.x, p.y);
    const h = this.heli;
    const aim = this.worldPointer();
    const wpn = this.loadout[h.weapon]!.kind;
    const missile = wpn !== "cannon";
    this.reticle.setTexture(missile && this.textures.exists("reticle_sq") ? "reticle_sq" : "reticle");
    this.drawReticleTally(p.x, p.y, missile ? (this.ammo[h.weapon] ?? 0) : 0, this.loadout[h.weapon]!.ammo);
    if (wpn === "lock-on-missile") {
      this.sight.clear();
      this.sight.setVisible(false);
      return;
    }
    this.sight.setVisible(true);
    let ox: number;
    let oy: number;
    let wx: number;
    let wy: number;
    let bx: number;
    let by: number;
    const oz = h.z + ZOff.shot;
    if (!missile) {
      const bodyMuzzle = craftFixedMuzzles(h.spec)[0];
      const tip = bodyMuzzle ? this.craftBodyMountWorldPos(bodyMuzzle) : this.gunTip();
      wx = tip.x;
      wy = tip.y;
      const tipScr = worldToScreen(tip.x, tip.y, h.z);
      ox = tipScr.x;
      oy = tipScr.y;
      const along = Math.max(80, projectAlong(wx, wy, h.gunAngle, aim.x, aim.y));
      bx = wx + Math.cos(h.gunAngle) * along;
      by = wy + Math.sin(h.gunAngle) * along;
    } else {
      const pylon = this.missilePylon();
      wx = pylon.x;
      wy = pylon.y;
      const pylonScr = worldToScreen(pylon.x, pylon.y, h.z);
      ox = pylonScr.x;
      oy = pylonScr.y;
      const along = Math.max(80, projectAlong(pylon.x, pylon.y, h.angle, aim.x, aim.y));
      bx = pylon.x + Math.cos(h.angle) * along;
      by = pylon.y + Math.sin(h.angle) * along;
    }
    const air = this.hoverAerial();
    const bz = air ? air.z + heightOf(air.kind) * 0.5 : groundZ(this.world, bx, by);
    const clip = this.sightTerrainHitWorld(wx, wy, oz, bx, by, bz);
    const from = this.worldToHud(ox, oy);
    const toScr = worldToScreen(clip.x, clip.y, clip.z);
    const to = this.worldToHud(toScr.x, toScr.y);
    this.drawSightLine(from.x, from.y, to.x, to.y, missile ? "missile" : "cannon");
  }

  /** First point along a world beam where altitude meets terrain. */
  sightTerrainHitWorld(
    ox: number,
    oy: number,
    oz: number,
    bx: number,
    by: number,
    bz: number
  ): { x: number; y: number; z: number } {
    const steps = 48;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = ox + (bx - ox) * t;
      const y = oy + (by - oy) * t;
      const z = oz + (bz - oz) * t;
      if (z <= groundZ(this.world, x, y) + 1.5) {
        const u = Math.max(0, t - 0.5 / steps);
        return {
          x: ox + (bx - ox) * u,
          y: oy + (by - oy) * u,
          z: oz + (bz - oz) * u,
        };
      }
    }
    return { x: bx, y: by, z: bz };
  }

  drawSightLine(x0: number, y0: number, x1: number, y1: number, kind: "cannon" | "missile"): void {
    const g = this.sight;
    g.clear();
    const missile = kind === "missile";
    const line = missile ? 0xff2a18 : 0x4dff62;
    const glow = missile ? 0xff6a3a : line;
    const halo = missile ? 0xff8a62 : 0x5cff6a;
    const core = missile ? 0xffece4 : 0xd8ffc4;
    const dx = x1 - x0;
    const dy = y1 - y0;
    if (dx * dx + dy * dy >= 36) {
      const segs = 28;
      for (let i = 0; i < segs; i++) {
        const t0 = i / segs;
        const t1 = (i + 1) / segs;
        const t = t1 * t1;
        if (missile) {
          g.lineStyle(3.2, glow, 0.12 + t * 0.28);
          g.lineBetween(x0 + dx * t0, y0 + dy * t0, x0 + dx * t1, y0 + dy * t1);
          g.lineStyle(1.6, line, 0.28 + t * 0.62);
          g.lineBetween(x0 + dx * t0, y0 + dy * t0, x0 + dx * t1, y0 + dy * t1);
        } else {
          g.lineStyle(1, line, t * 0.42);
          g.lineBetween(x0 + dx * t0, y0 + dy * t0, x0 + dx * t1, y0 + dy * t1);
        }
      }
    }
    if (missile) {
      g.fillStyle(glow, 0.35);
      g.fillCircle(x1, y1, 6.2);
      g.fillStyle(halo, 0.8);
      g.fillCircle(x1, y1, 3.6);
      g.fillStyle(core, 1);
      g.fillCircle(x1, y1, 2);
    } else {
      g.fillStyle(halo, 0.55);
      g.fillCircle(x1, y1, 3.1);
      g.fillStyle(core, 1);
      g.fillCircle(x1, y1, 1.7);
    }
  }

  drawReticleTally(cx: number, cy: number, count: number, max = count): void {
    const g = this.reticleMark;
    g.clear();
    const n = Math.max(0, Math.floor(count));
    if (n <= 0 || !Number.isFinite(max) || max <= 0) {
      g.setVisible(false);
      return;
    }
    g.setVisible(true);
    const cap = Math.floor(max);
    const groupCount = Math.ceil(cap / 5);
    const wrap = 2;
    const tickH = 10;
    const tickGap = 3.15;
    const rowH = tickH + 5;
    const colW = tickGap * 4 + 9;
    const ox = cx + 44;
    const oy = cy - 30;
    g.lineStyle(1.35, 0xe8b84a, 0.92);
    for (let i = 0; i < groupCount; i++) {
      const ticks = Phaser.Math.Clamp(n - i * 5, 0, 5);
      const col = i % wrap;
      const row = Math.floor(i / wrap);
      const x = ox + col * colW;
      const y = oy + row * rowH;
      for (let t = 0; t < ticks; t++) {
        const tx = x + t * tickGap;
        g.lineBetween(tx, y, tx, y + tickH);
      }
    }
  }

  worldToHud(wx: number, wy: number): { x: number; y: number } {
    const cam = this.cameras.main;
    const view = cam.worldView;
    return {
      x: cam.x + (wx - view.x) * cam.zoom,
      y: cam.y + (wy - view.y) * cam.zoom,
    };
  }

  gunTip(index = 0): { x: number; y: number } {
    const gun = this.guns[index] ?? this.gun;
    const d = gun.displayHeight * gun.originY * 0.92;
    // The gun texture points along local -Y, so its rendered barrel heading is
    // one quarter-turn behind the projected sprite rotation.
    const a = gun.rotation - Math.PI / 2;
    const sx = gun.x + Math.cos(a) * d;
    const sy = gun.y + Math.sin(a) * d;
    // Gun sprite sits in projected space; return world XY for ballistics / aim.
    // Fresh object — must not alias shared screenToWorldAtZ scratch.
    const at = screenToWorldAtZ(sx, sy, this.heli.z);
    return { x: at.x, y: at.y };
  }

  /** World position of an authored mount UV on the active craft body. */
  craftBodyMountWorldPos(mount: { x: number; y: number }): { x: number; y: number } {
    const h = this.heli;
    const craft = h.spec;
    const pivot = craftOrigin(craft);
    const img = this.textures.exists(craft.body)
      ? (this.textures.get(craft.body).getSourceImage() as { width: number; height: number })
      : { width: 120, height: 120 };
    const dw = img.width;
    const dh = img.height;
    const hullRot = h.angle + craft.rotOff;
    const mx = (mount.x - pivot.x) * dw;
    const my = (mount.y - pivot.y) * dh;
    return {
      x: h.x + mx * Math.cos(hullRot) - my * Math.sin(hullRot),
      y: h.y + mx * Math.sin(hullRot) + my * Math.cos(hullRot),
    };
  }

  /** World position of a craft secondary hardpoint UV. */
  secondaryWorldPos(mount: { x: number; y: number }): { x: number; y: number } {
    return this.craftBodyMountWorldPos(mount);
  }

  /** World position of the next missile hardpoint (alternates left/right by ammo). */
  missilePylon(): { x: number; y: number; side: number } {
    const mounts = craftSecondaryMounts(this.heli.spec);
    const ammo = this.ammo[this.heli.weapon] ?? 0;
    // Remaining-ammo phase cycles every authored hardpoint; for two mounts this
    // preserves the original right/left alternation.
    const index = mounts.length > 1 ? ((ammo - 1) % mounts.length + mounts.length) % mounts.length : 0;
    const mount = mounts[index] ?? mounts[0]!;
    const side = mount.x < craftOrigin(this.heli.spec).x ? -1 : 1;
    return { ...this.secondaryWorldPos(mount), side };
  }

  handleFire(dt: number): void {
    const h = this.heli;
    if (h.phase !== "flight" || !this.canFire || this.debugOpen || this.editOpen || this.helpOpen || this.exitOpen) return;
    const spec = this.loadout[h.weapon]!;
    const wpn = spec.kind;
    const ptr = this.worldPointer();
    const down = this.input.activePointer.isDown;

    if (wpn === "cannon" && down && h.fireCd <= 0 && this.hasAmmo(h.weapon)) {
      h.fireCd = spec.fireCd;
      if (Number.isFinite(this.ammo[h.weapon]!)) this.spendAmmo(h.weapon);
      const air = this.hoverAerial();
      const spd = spec.speed;
      const station = h.spec.stations?.[h.weapon];
      const fixed = station?.mount === "fixed" || (!station && h.spec.gunMode === "fixed");
      const muzzleFire = station?.muzzleFire;
      const authored = fixed ? craftFixedMuzzles(h.spec) : [];
      const mountedGunI =
        authored.length === 0 && this.guns.length > 1
          ? this.playerGunSide++ % this.guns.length
          : 0;
      const muzzleUvs =
        authored.length === 0
          ? [undefined]
          : muzzleFire === "simultaneous"
            ? authored
            : muzzleFire === "alternate"
              ? [authored[this.playerGunSide++ % authored.length]]
              : [authored[0]];
      const fxInterval = spec.fireCd / Math.max(1, muzzleUvs.length);
      const shotFxScale = projectileFxScale("player", fxInterval);
      for (const muzzleUv of muzzleUvs) {
        const spread = spec.beam ? 0 : (Math.random() - 0.5) * (spec.silent ? 0.025 : 0.08);
        const ang = (fixed ? h.angle : h.gunAngle) + spread;
        const tip = muzzleUv ? this.craftBodyMountWorldPos(muzzleUv) : this.gunTip(mountedGunI);
        const tipScr = worldToScreen(tip.x, tip.y, h.z);
        const tipScreenX = tipScr.x;
        const tipScreenY = tipScr.y;
        const tipScale = tipScr.scale;
        const z0 = h.z + ZOff.shot;
        const along = projectAlong(tip.x, tip.y, ang, air ? air.x : ptr.x, air ? air.y : ptr.y);
        const dist = Math.max(80, along);
        const t = dist / spd;
        const tx = tip.x + Math.cos(ang) * dist;
        const ty = tip.y + Math.sin(ang) * dist;
        const tz = air ? air.z + heightOf(air.kind) * 0.5 : groundZ(this.world, tx, ty);
        this.spawnShot({
          kind: spec.kind,
          from: "player",
          x: tip.x,
          y: tip.y,
          z: z0,
          vx: Math.cos(ang) * spd,
          vy: Math.sin(ang) * spd,
          vz: (tz - z0) / t,
          angle: ang,
          life: t + (air ? 0.55 : spec.life),
          blast: spec.blast,
          dmg: spec.dmg,
          look: spec.look,
          scale: spec.scale,
          fxInterval,
        });
        if (spec.beam) {
          const beamEnd = worldToScreen(tx, ty, tz);
          const beam = this.add.graphics().setDepth(worldDepth(z0, ZOff.muzzle, tip.y));
          beam.lineStyle(5 * tipScale, 0x55ddff, 0.24).lineBetween(tipScreenX, tipScreenY, beamEnd.x, beamEnd.y);
          beam.lineStyle(1.5 * tipScale, 0xffffff, 0.95).lineBetween(tipScreenX, tipScreenY, beamEnd.x, beamEnd.y);
          this.tweens.add({ targets: beam, alpha: 0, duration: 110, onComplete: () => beam.destroy() });
        } else if (!spec.silent) {
          this.emitVisualBurst(tip.x, tip.y, h.z, {
            n: scaledProjectileFxCount(6, shotFxScale),
            spdMin: 220,
            spdMax: 520,
            bx: Math.cos(ang),
            by: Math.sin(ang),
            bz: (tz - z0) / Math.max(40, dist),
            tight: 0.9,
            scaleMul: 0.3,
          }, this.muzzleBurst);
          this.tracer.setDepth(worldDepth(z0, ZOff.muzzle, tip.y));
          this.emitBudgeted("short", this.tracer, tipScreenX, tipScreenY, scaledProjectileFxCount(5, shotFxScale));
          this.showMuzzle(
            tipScreenX,
            tipScreenY,
            projectHeading(ang, tip.x, tip.y, h.z),
            0.78 * tipScale,
            0.1
          );
          const craft = h.spec;
          const mountedGun = this.guns[mountedGunI] ?? this.gun;
          const mountedGunUv = craftGunMounts(craft)[mountedGunI] ?? craftGunMount(craft);
          const side = muzzleUv
            ? (muzzleUv.x < craftOrigin(craft).x ? -1 : 1)
            : this.shellEjectSide({
                muzzleUv: lookupSpriteMuzzles(craft.gun)[0],
                mountUv: mountedGunUv,
              });
          const ejectAt = muzzleUv ? tip : screenToWorldAtZ(mountedGun.x, mountedGun.y, h.z);
          this.spawnShellEject({
            x: ejectAt.x,
            y: ejectAt.y,
            z: h.z - 12,
            barrelAng: ang,
            dmg: spec.dmg,
            side,
            aerial: true,
            fireCd: spec.fireCd,
          });
        }
      }
    }

    if (wpn === "rocket" && down && h.fireCd <= 0 && this.hasAmmo(h.weapon)) {
      h.fireCd = spec.fireCd;
      const { x: px, y: py } = this.missilePylon();
      this.spendAmmo(h.weapon);
      const air = this.hoverAerial();
      const along = projectAlong(px, py, h.angle, air ? air.x : ptr.x, air ? air.y : ptr.y);
      const dist = Math.max(80, along);
      const t = dist / spec.speed;
      const tx = px + Math.cos(h.angle) * dist;
      const ty = py + Math.sin(h.angle) * dist;
      const tz = air ? air.z + heightOf(air.kind) * 0.5 : groundZ(this.world, tx, ty);
      this.spawnShot({
        kind: spec.kind,
        from: "player",
        x: px,
        y: py,
        z: h.z + ZOff.shot,
        vx: Math.cos(h.angle) * spec.speed,
        vy: Math.sin(h.angle) * spec.speed,
        vz: (tz - h.z) / t,
        angle: h.angle,
        life: t + spec.life,
        blast: spec.blast,
        dmg: spec.dmg,
        look: spec.look,
        scale: spec.scale,
        fxInterval: spec.fireCd,
      });
      this.missileMuzzle(px, py, h.z, h.angle, projectileFxScale("player", spec.fireCd));
    }

    this.tickHellfireLock(dt, ptr);
    if (wpn === "lock-on-missile") {
      if (
        down &&
        h.fireCd <= 0 &&
        this.hasAmmo(h.weapon) &&
        h.hellfireLock
      ) {
        h.fireCd = spec.fireCd;
        const { x: px, y: py, side } = this.missilePylon();
        this.spendAmmo(h.weapon);
        const kick = spec.speed;
        this.spawnShot({
          kind: spec.kind,
          from: "player",
          x: px,
          y: py,
          z: h.z + ZOff.shot,
          vx: h.vx + Math.cos(h.angle) * kick,
          vy: h.vy + Math.sin(h.angle) * kick,
          vz: h.vz,
          angle: h.angle,
          life: spec.life,
          targetId: h.hellfireLock.id,
          blast: spec.blast,
          dmg: spec.dmg,
          look: spec.look,
          scale: spec.scale,
          fxInterval: spec.fireCd,
          motor: -MISSILE_IGNITE,
          yaw: side * (1.05 + Math.random() * 0.45),
        });
        this.missileMuzzle(px, py, h.z, h.angle, projectileFxScale("player", spec.fireCd));
      }
    }

    if (wpn === "guided-missile" && down && h.fireCd <= 0 && this.hasAmmo(h.weapon)) {
      h.fireCd = spec.fireCd;
      const { x: px, y: py, side } = this.missilePylon();
      this.spendAmmo(h.weapon);
      this.spawnShot({
        kind: spec.kind,
        from: "player",
        x: px,
        y: py,
        z: h.z + ZOff.shot,
        vx: h.vx + Math.cos(h.angle) * spec.speed,
        vy: h.vy + Math.sin(h.angle) * spec.speed,
        vz: h.vz,
        angle: h.angle,
        life: spec.life,
        blast: spec.blast,
        dmg: spec.dmg,
        look: spec.look,
        scale: spec.scale,
        fxInterval: spec.fireCd,
        guided: true,
        motor: -(MISSILE_IGNITE + 0.06),
        cruise: 300,
        yaw: side * (0.42 + Math.random() * 0.22),
        wireSide: side,
        wire: spec.warpTimeScale ? undefined : [],
        warpTimeScale: spec.warpTimeScale,
      });
      this.missileMuzzle(px, py, h.z, h.angle, projectileFxScale("player", spec.fireCd));
    }
  }

  missileMuzzle(x: number, y: number, z: number, ang: number, fxScale = 1): void {
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    this.emitVisualBurst(x, y, z, {
      n: scaledProjectileFxCount(12, fxScale),
      spdMin: 200,
      spdMax: 520,
      bx: ca,
      by: sa,
      bz: 0.2,
      tight: 0.84,
      scaleMul: 0.3,
    }, this.muzzleBurst);
    const at = worldToScreen(x, y, z);
    this.showMuzzle(at.x, at.y, projectHeading(ang, x, y, z), 0.62 * at.scale, 0.12);
  }

  showMuzzle(x: number, y: number, drawAng: number, scale: number, life: number): void {
    const sc = scale * range(0.9, 1.12);
    const rot = drawAng + range(-0.1, 0.1);
    let index = this.muzzleLives.findIndex((remaining) => remaining <= 0);
    if (index < 0) index = this.muzzleCursor++ % this.muzzlePool.length;
    const muzzle = this.muzzlePool[index] ?? this.muzzle;
    muzzle
      .setVisible(true)
      .setFrame((Math.random() * FX_VARIANTS) | 0)
      .setOrigin(0.14, 0.5)
      .setPosition(x, y)
      .setRotation(rot)
      .setScale(sc)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(0xfff6d0)
      .setAlpha(1)
      .setDepth(worldDepth(this.heli.z, ZOff.muzzle, this.heli.y));
    this.muzzleLives[index] = life;
    this.spawnMuzzleLight(x, y, this.heli.z, 26 * sc);
  }

  tickPlayerMuzzles(dt: number): void {
    for (let i = 0; i < this.muzzleLives.length; i++) {
      if (this.muzzleLives[i]! <= 0) continue;
      this.muzzleLives[i] -= dt;
      if (this.muzzleLives[i]! <= 0) this.muzzlePool[i]?.setVisible(false);
    }
  }

  /** Soft additive light bloom under a muzzle flash. */
  spawnMuzzleLight(x: number, y: number, z: number, size: number): void {
    this.spawnImpactFlash(x, y, z, 0xfff2c8, Math.max(14, size), 0.5, 70);
  }

  /** Spent casing size from projectile damage (call sites already gate to cannons). */
  shellGirth(dmg: number): number {
    // dmg 1 → ~0.34, player chain 8 → ~0.55, heavy 12–16 → ~0.7–0.8
    return Phaser.Math.Clamp(0.3 + Math.sqrt(Math.max(0.25, dmg)) * 0.125, 0.3, 0.85);
  }

  /**
   * +1 = eject barrel-right, −1 = barrel-left.
   * Local UV only (muzzle on gun tex, else mount on hull) — never world space
   * so bob / lift / aim sway can't flip the side.
   */
  shellEjectSide(opts: {
    muzzleUv?: { x: number; y: number };
    mountUv?: { x: number; y: number };
  }): number {
    const mid = 0.5;
    const eps = 0.02;
    if (opts.muzzleUv && Math.abs(opts.muzzleUv.x - mid) > eps) {
      return opts.muzzleUv.x > mid ? 1 : -1;
    }
    if (opts.mountUv && Math.abs(opts.mountUv.x - mid) > eps) {
      return opts.mountUv.x > mid ? 1 : -1;
    }
    return 1;
  }

  /** Enemy casing side for the gun/muzzle that just fired. */
  enemyShellEjectSide(u: Unit, gunI: number): number {
    const guns = gunsOf(u);
    const gun = guns[gunI];
    const tipIdx = u.muzzleFireTip ?? u.muzzleTip ?? 0;
    let muzzleUv: { x: number; y: number } | undefined;
    let mountUv: { x: number; y: number } | undefined;
    if (gun) {
      const tips = muzzlesOfGun(gun);
      muzzleUv = tips[tipIdx % tips.length];
      mountUv = gun.mount;
    } else {
      const bodyTips = lookupSpriteMuzzles(textureOf(u.kind));
      if (bodyTips.length) muzzleUv = bodyTips[tipIdx % bodyTips.length];
    }
    return this.shellEjectSide({ muzzleUv, mountUv });
  }

  /** Admit debris by lifecycle importance; only ephemeral trail carriers are replaceable. */
  admitDebris(piece: Debris): boolean {
    const debrisClass = piece.debrisClass ?? "consequential";
    piece.debrisClass = debrisClass;
    if (debrisClass === "consequential") {
      if (this.debris.reduce((n, f) => n + ((f.debrisClass ?? "consequential") === "consequential" ? 1 : 0), 0) >= 192) {
        return false;
      }
    } else if (debrisClass === "ephemeral") {
      const ephemeral = this.debris.reduce((n, f) => n + (f.debrisClass === "ephemeral" ? 1 : 0), 0);
      if (ephemeral >= 48) {
        const oldest = this.debris.findIndex((f) => f.debrisClass === "ephemeral");
        if (oldest >= 0) this.debris.splice(oldest, 1);
        else return false;
      }
    }
    this.debris.push(piece);
    return true;
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
    dmg: number;
    /** +1 barrel-right / −1 barrel-left (from midline). Required for consistent eject. */
    side: number;
    /** Air craft: spawn/draw under hull. Ground: spawn/draw above. */
    aerial?: boolean;
    /** Weapon fire interval (s). Lower = faster = slightly harder eject. */
    fireCd?: number;
  }): void {
    const girth = this.shellGirth(opts.dmg);
    if (girth <= 0) return;
    const side = opts.side >= 0 ? 1 : -1;
    const ejectAng = opts.barrelAng + side * (Math.PI / 2) + range(-0.28, 0.28);
    // Subtle cadence bias: chain (~0.07s) punches harder than slow AA (~2–3s).
    const cd = Phaser.Math.Clamp(opts.fireCd ?? 0.45, 0.05, 3.2);
    const rateMul = Phaser.Math.Linear(1.2, 0.82, Phaser.Math.Clamp((cd - 0.06) / 1.6, 0, 1));
    const girthMul = Phaser.Math.Linear(1.05, 0.82, (girth - 0.28) / 0.44);
    const spd = range(22, 48) * girthMul * rateMul;
    const shellKeys = ["fx_shell", "fx_shell_1", "fx_shell_2", "fx_shell_3", "fx_shell_4"];
    const available = shellKeys.filter((k) => this.textures.exists(k));
    if (!available.length) return;
    const key = available[(Math.random() * available.length) | 0]!;
    const vzBase = opts.aerial ? range(-8, 14) : range(28, 58);
    this.admitDebris({
      x: opts.x + range(-1.2, 1.2),
      y: opts.y + range(-1.2, 1.2),
      z: opts.z,
      vx: Math.cos(ejectAng) * spd + range(-6, 6),
      vy: Math.sin(ejectAng) * spd + range(-6, 6),
      vz: vzBase * Phaser.Math.Linear(0.92, 1.08, (rateMul - 0.82) / 0.38),
      angle: ejectAng + range(-0.6, 0.6),
      spin: (Math.random() < 0.5 ? -1 : 1) * range(8, 42) * Phaser.Math.Linear(0.9, 1.12, (rateMul - 0.82) / 0.38),
      life: 4,
      key,
      settled: false,
      gravity: true,
      bounces: 2 + ((Math.random() * 2) | 0),
      trailR: 1.6 * girth,
      scale: girth * 0.72,
      shellEject: true,
      shellUnder: !!opts.aerial,
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
    if (!this.textures.exists("impact_glow")) ensureImpactGlow(this.textures);
    const world = screenToWorldAtZ(x, y, z);
    const glow = this.add
      .image(x, y, "impact_glow")
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(tint)
      .setDisplaySize(size, size)
      .setAlpha(alpha)
      .setDepth(worldDepth(z, 2.8, world.y));
    this.tweens.add({
      targets: glow,
      alpha: 0,
      duration,
      ease: "Quad.Out",
      onComplete: () => glow.destroy(),
    });
  }

  spawnShot(s: Shot): void {
    const look = shotLookOf(s);
    const nudge = this.shotTipNudge(look, s.angle, s.x, s.y, s.z, s.scale ?? 1);
    s.x += nudge.x;
    s.y += nudge.y;
    if (!s.look) s.look = look;
    this.shots.push(s);
  }

  /** XY after tip-origin nudge — use for flight time so aim matches spawn. */
  shotSpawnXY(
    x: number,
    y: number,
    angle: number,
    z: number,
    look: ShotLook,
    scale = 1
  ): { x: number; y: number } {
    const n = this.shotTipNudge(look, angle, x, y, z, scale);
    return { x: x + n.x, y: y + n.y };
  }

  /** Forward shift so tip-origin art clears the barrel (ox × streak length). */
  shotTipNudge(
    look: ShotLook,
    angle: number,
    x: number,
    y: number,
    z: number,
    scale = 1
  ): { x: number; y: number } {
    const at = worldToScreen(x, y, z);
    const img = this.textures.exists(look)
      ? (this.textures.get(look).getSourceImage() as { width: number; height: number })
      : { width: 48, height: 10 };
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    const projectedX = screenVelX(ca, sa, 0, x, y, z);
    const projectedY = screenVelY(sa, 0, z, y);
    const projectedUnit = Math.max(1e-6, Math.hypot(projectedX, projectedY));
    const screenDistance = SHOT_ORIGIN.x * img.width * scale * at.scale;
    const d = screenDistance / projectedUnit;
    return { x: ca * d, y: sa * d };
  }

  /** Screen XY of a UV on the shot sprite (matches syncShotSprites scale/origin). */
  shotUvScreenPos(
    s: Shot,
    uvx: number,
    uvy: number,
    x = s.x,
    y = s.y,
    z = s.z
  ): { x: number; y: number } {
    const look = shotLookOf(s);
    const img = this.textures.exists(look)
      ? (this.textures.get(look).getSourceImage() as { width: number; height: number })
      : { width: 48, height: 10 };
    const sc = s.scale ?? 1;
    const base = worldToScreen(x, y, z);
    const zs = base.scale;
    const horiz = Math.hypot(s.vx, s.vy);
    const pitchN = Phaser.Math.Clamp(Math.abs(s.vz) / Math.max(90, Math.hypot(horiz, s.vz)), 0, 1);
    const along = 1 - pitchN * 0.52;
    const across = 1 + pitchN * 0.06;
    const dw = img.width * sc * zs * along;
    const dh = img.height * sc * zs * across;
    const lx = (uvx - SHOT_ORIGIN.x) * dw;
    const ly = (uvy - SHOT_ORIGIN.y) * dh;
    const drawRot = Math.atan2(
      screenVelY(s.vy, s.vz, z, y),
      screenVelX(s.vx, s.vy, s.vz, x, y, z)
    );
    const ca = Math.cos(drawRot);
    const sa = Math.sin(drawRot);
    return {
      x: base.x + lx * ca - ly * sa,
      y: base.y + lx * sa + ly * ca,
    };
  }

  sampleBurstScreenVelocity(p?: BurstParticle): { x: number; y: number } {
    const opt = this.burstLaunch;
    const d = opt.expBias > 0
      ? expBiasDir(opt.bx, opt.by, opt.bz, opt.expBias)
      : biasedDir(opt.bx, opt.by, opt.bz, opt.tight, false);
    const align = (d as { align?: number }).align ?? 1;
    const speedBias = opt.expBias > 0 ? Math.exp(opt.expBias * 0.55 * align) / Math.exp(opt.expBias * 0.55) : 1;
    const speed = range(opt.spdMin, opt.spdMax) * speedBias;
    const vx = d.x * speed;
    const vy = d.y * speed;
    const vz = d.z * speed;
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
      expBias?: number;
      gravity?: number;
    },
    emitter: Phaser.GameObjects.Particles.ParticleEmitter,
    kind: FxClass = "short"
  ): void {
    Object.assign(this.burstLaunch, {
      x, y, z, bx: opt.bx, by: opt.by, bz: opt.bz, tight: opt.tight,
      spdMin: opt.spdMin, spdMax: opt.spdMax, scale: opt.scaleMul ?? 1,
      expBias: opt.expBias ?? 0, gravity: opt.gravity ?? 0,
    });
    const at = worldToScreen(x, y, z);
    this.emitBudgeted(kind, this.fxAt(z, y, emitter, ZOff.fire + 0.4), at.x, at.y, opt.n);
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
    const biome = sampleBiome(this.world, x, y);
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
      const g = groundZ(this.world, s.x, s.y);
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
        this.stampBloodWorld(s);
        bloodDirty = true;
      }
      if (s.life > 0) simParticles[w++] = s;
    }
    simParticles.length = w;
    if (bloodDirty && this.textures.exists("terrain")) {
      (this.textures.get("terrain") as Phaser.Textures.CanvasTexture).refresh();
    }
    if (this.perfEnabled) {
      const t = performance.now();
      this.syncSimParticleSprites();
      this.perfCurrent![10] = performance.now() - t;
    } else {
      this.syncSimParticleSprites();
    }
  }

  syncSimParticleSprites(): void {
    while (this.simParticleG.getLength() < this.simParticles.length) {
      this.simParticleG.add(this.add.image(0, 0, "fx_spark").setScale(0.7));
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
      const grow = 1 - Math.pow(1 - age, 3.4);
      const edge =
        dart && s.ox != null && s.oy != null
          ? Phaser.Math.Clamp((Math.hypot(s.x - s.ox, s.y - s.oy) - 40) / 110, 0, 1)
          : 0;
      const round = dart ? Math.max(edge, Phaser.Math.Clamp(1 - spd / 220, 0, 1)) : 0;
      const stretch = shock
          ? Math.min(3.2, 1 + spd * 0.0032)
          : 1 + spd * (dart ? 0.0052 : 0.0048);
      const thick = shock
        ? s.scale * (1.05 + 0.95 * age)
        : dart
        ? s.scale * (0.78 + 0.28 * fade + 0.72 * round)
        : s.scale * (0.06 + 3.6 * grow);
      const scrX = screenVelX(s.vx, s.vy, s.vz, s.x, s.y, s.z);
      const scrY = screenVelY(s.vy, s.vz, s.z, s.y);
      const heading = Math.atan2(scrY, scrX);
      const rot = shock
        ? s.heading
        : dart
        ? heading + s.angJit * 0.08 + age * s.spin * (0.22 + round * 1.05)
        : s.heading + s.angJit * 0.14;
      const sx = shock
        ? thick * stretch
        : dart
        ? thick * (stretch * 1.28 * (1 - round) + (1.12 + 0.38 * grow) * round)
        : thick * (0.85 + 0.55 * grow);
      const late = Math.pow(Phaser.Math.Clamp((age - 0.52) / 0.48, 0, 1), 1.7);
      const sy = shock
        ? thick * (0.48 + 0.7 * age)
        : dart
        ? thick * ((0.58 + 0.16 / Math.max(stretch, 1)) * (1 - round) + (1.08 + 0.28 * grow) * round)
        : thick * (0.28 + 0.42 * late);
      const baseA = s.additive ? 0.45 + fade * 0.55 : 0.55 + fade * 0.4;
      const alpha = s.blood
        ? 0.35 + fade * 0.65
        : shock
          ? 0.38 + 0.58 * Math.pow(fade, 0.55)
          : dart
            ? (0.16 + 0.2 * fade) * (1 - round * 0.25)
            : baseA * (0.35 + 0.65 * fade);
      const at = worldToScreen(s.x, s.y, s.z);
      const zs = at.scale;
      const depth = worldDepth(s.z, 0.3, s.y);
      im.setVisible(true);
      if (im.texture.key !== s.tex || im.frame.name !== String(s.frame)) im.setTexture(s.tex, s.frame);
      im.setOrigin(dart ? 0.12 + 0.38 * round : 0.12, 0.5)
        .setPosition(at.x, at.y)
        .setRotation(rot)
        .setScale(sx * zs, sy * zs)
        .setBlendMode(
          s.blood ? Phaser.BlendModes.NORMAL : s.additive ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL
        )
        .setAlpha(alpha);
      if (im.depth !== depth) im.setDepth(depth);
      if (s.blood) im.setTintFill(s.tint);
      else {
        im.clearTint();
        im.setTint(s.tint);
      }
    });
  }

  enemyShotExpired(s: Shot): boolean {
    const view = this.cameras.main.worldView;
    const pad = 96;
    const at = worldToScreen(s.x, s.y, s.z);
    if (
      at.x < view.x - pad ||
      at.x > view.right + pad ||
      at.y < view.y - pad ||
      at.y > view.bottom + pad
    ) {
      return true;
    }
    // Hellfires use a soft clamp instead of a hard height cull.
    if (s.kind === "lock-on-missile") return false;
    return s.z > SHOT_Z_MAX;
  }

  updateShots(dt: number): void {
    const ptr = this.worldPointer();
    let w = 0;
    const shots = this.shots;
    for (let si = 0; si < shots.length; si++) {
      const s = shots[si]!;
      if (s.motor != null) {
        const was = s.motor;
        s.motor += dt;
        if (was < 0 && s.motor >= 0) this.missileIgnite(s);
      }
      const lit = s.motor == null || s.motor >= 0;
      const lofting = lit && (s.loft ?? 0) > 0;
      if (lofting) s.loft = (s.loft ?? 0) - dt;
      const hellfireHome = lit && s.kind === "lock-on-missile" && s.targetId != null;
      const stingerHome = lit && s.homePlayer && s.kind === "lock-on-missile";
      if (hellfireHome) {
        const cur = Math.hypot(s.vx, s.vy, s.vz);
        const burn = s.motor ?? 0;
        const accel = 520 + Phaser.Math.Clamp(burn, 0, 1.4) * 260;
        const spd = cur + accel * dt;
        const seeking = (s.loft ?? 0) <= 0;
        if (seeking) {
          const u = s.targetId != null ? this.unitById(s.targetId) : undefined;
          const tx = u ? u.x : s.x + s.vx;
          const ty = u ? u.y : s.y + s.vy;
          const tz = u ? u.z + heightOf(u.kind) * 0.5 : groundZ(this.world, s.x, s.y);
          const home = norm3(tx - s.x, ty - s.y, tz - s.z);
          const dir0 =
            cur < 8
              ? { x: Math.cos(s.angle), y: Math.sin(s.angle), z: 0.55 }
              : { x: s.vx, y: s.vy, z: s.vz };
          const d = steerDir(dir0.x, dir0.y, dir0.z, home.x, home.y, home.z, 7.4 * dt);
          s.angle = Math.atan2(d.y, d.x);
          s.vx = d.x * spd;
          s.vy = d.y * spd;
          s.vz = d.z * spd;
        } else if (cur > 8) {
          s.vx = (s.vx / cur) * spd;
          s.vy = (s.vy / cur) * spd;
          s.vz = (s.vz / cur) * spd;
        } else {
          s.vx = Math.cos(s.angle) * spd;
          s.vy = Math.sin(s.angle) * spd;
        }
      }
      if (stingerHome) {
        const cur = Math.hypot(s.vx, s.vy, s.vz);
        const tx = this.heli.x;
        const ty = this.heli.y;
        const tz = this.heli.z + this.heli.height * 0.45;
        const home = norm3(tx - s.x, ty - s.y, tz - s.z);
        const dir0 =
          cur < 8
            ? { x: Math.cos(s.angle), y: Math.sin(s.angle), z: 0.12 }
            : { x: s.vx, y: s.vy, z: s.vz };
        const age = Math.max(0, s.motor ?? 0);
        const steerRate = Phaser.Math.Linear(0.78, 0.26, Phaser.Math.Clamp(age / 5.5, 0, 1));
        const d = steerDir(dir0.x, dir0.y, dir0.z, home.x, home.y, home.z, steerRate * dt);
        s.angle = Math.atan2(d.y, d.x);
        const spd = Math.min(Math.max(cur, 220) + 50 * dt, 380);
        s.vx = d.x * spd;
        s.vy = d.y * spd;
        s.vz = d.z * spd;
      }
      if (lit && s.guided) {
        // Prefer unit under reticle (incl. ground); fall back to nearby aerial pick.
        const tgt = this.reticleUnit() ?? this.hoverAerial();
        const want = Math.atan2(ptr.y - s.y, ptr.x - s.x);
        const da = Phaser.Math.Angle.Wrap(want - s.angle);
        s.angle += Phaser.Math.Clamp(da, -2.2 * dt, 2.2 * dt);
        const dist = Math.hypot(ptr.x - s.x, ptr.y - s.y);
        const hold = Phaser.Math.Clamp(dist / 360, 0, 1);
        const gndAim = groundZ(this.world, ptr.x, ptr.y);
        // Aim low on the hull (30% height) so TOWs don't skim over small targets.
        const tz = tgt
          ? tgt.z + heightOf(tgt.kind) * 0.3
          : Phaser.Math.Linear(gndAim, this.heli.z, hold);
        s.vz = (tz - s.z) * 3.2;
        s.life = Math.max(s.life, 0.6);
      }
      if (s.motor != null && s.motor < 0) {
        const drag = s.kind === "guided-missile" ? Math.pow(0.12, dt) : Math.pow(0.07, dt);
        s.vx *= drag;
        s.vy *= drag;
        s.vz *= Math.pow(0.22, dt);
        if (s.yaw) s.angle += s.yaw * dt;
        const spd = Math.hypot(s.vx, s.vy);
        if (spd > 6) {
          s.vx = Math.cos(s.angle) * spd;
          s.vy = Math.sin(s.angle) * spd;
        }
      } else if (hellfireHome || stingerHome) {
        /* vx/vy/vz already steered in 3D */
      } else if (s.cruise != null && s.motor != null) {
        const cur = Math.hypot(s.vx, s.vy);
        const ramp = Phaser.Math.Clamp(s.motor / 0.16, 0, 1);
        const k = ramp * ramp * (3 - 2 * ramp);
        const spd = Phaser.Math.Linear(Math.max(cur, 50), s.cruise, k);
        s.vx = Math.cos(s.angle) * spd;
        s.vy = Math.sin(s.angle) * spd;
      } else if (s.guided) {
        const spd = 300;
        s.vx = Math.cos(s.angle) * spd;
        s.vy = Math.sin(s.angle) * spd;
      }
      const x0 = s.x;
      const y0 = s.y;
      const z0 = s.z;
      const g0 = groundZ(this.world, x0, y0);
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.z += s.vz * dt;
      // Soft absolute ceiling for enemy Hellfires only — player missiles are uncapped.
      if (s.kind === "lock-on-missile" && s.from !== "player") {
        if (s.z > HELLFIRE_Z_MAX) {
          s.z = HELLFIRE_Z_MAX;
          if (s.vz > 0) s.vz = 0;
        }
      }
      s.life -= dt;
      if (s.kind === "guided-missile" && s.from === "player" && !s.warpTimeScale) this.simulateTowWire(s, dt);
      // Repel Hellfire/TOW off ground during pre-ignition instead of detonating
      const preIgnite = (s.kind === "lock-on-missile" || s.kind === "guided-missile") && s.from === "player" && s.motor != null && s.motor < 0;
      if (preIgnite) {
        const gRepel = groundZ(this.world, s.x, s.y) + 8;
        if (s.z < gRepel) {
          s.z = gRepel;
          if (s.vz < 60) s.vz = 60;
        }
      }
      const g1 = groundZ(this.world, s.x, s.y);
      const a0 = z0 - g0;
      const a1 = s.z - g1;
      let hit = s.from !== "enemy" && s.life <= 0;
      if (preIgnite && a1 > 0) {
        /* skip ground collision during pre-ignition repel */
      } else if (a0 > 0.05 && a1 <= 0) {
        const u = a0 / (a0 - a1);
        s.x = x0 + (s.x - x0) * u;
        s.y = y0 + (s.y - y0) * u;
        s.z = g0 + (g1 - g0) * u;
        hit = true;
      } else if (a1 <= 0 && a0 <= 0.05) {
        s.z = g1;
        hit = true;
      }
      let victim: Unit | undefined;
      let hitPlayer = false;
      if (
        s.from === "enemy" &&
        Math.hypot(s.x - this.heli.x, s.y - this.heli.y) < this.heli.spec.radius &&
        s.z <= this.heli.z + this.heli.height &&
        s.z >= this.heli.z &&
        this.heli.phase === "flight"
      ) {
        this.heli.damage(s.dmg * 0.65, s.vx, s.vy);
        hit = true;
        hitPlayer = true;
      }
      if (s.from === "player") {
        for (const u of this.units) {
          if (u.dead) continue;
          const hr = circumRadiusOf(u.kind) + 8;
          const dx = s.x - u.x;
          const dy = s.y - u.y;
          if (dx * dx + dy * dy > hr * hr) continue;
          if (!pointInFootprint(s.x, s.y, footprintInto(u, 8, 0))) continue;
          const top = u.z + heightOf(u.kind);
          if (s.z > top + 2) continue;
          if (s.z < u.z - 2) continue;
          hit = true;
          victim = u;
          break;
        }
      }
      if (hit) {
        if (s.kind === "guided-missile" && s.from === "player") {
          this.towLookX = s.x;
          this.towLookY = s.y;
          this.towLookHold = 0.9;
        }
        this.explode(
          s.x,
          s.y,
          s.z,
          s.blast,
          s.dmg,
          victim,
          s.vx,
          s.vy,
          s.vz,
          !!victim || hitPlayer,
          s.kind,
          projectileFxScale(s.from, s.fxInterval)
        );
        continue;
      }
      if (s.from === "enemy" && this.enemyShotExpired(s)) continue;
      this.emitShotTrail(s, x0, y0, z0);
      shots[w++] = s;
    }
    shots.length = w;
    if (this.perfEnabled) {
      const t = performance.now();
      this.syncShotSprites();
      this.perfCurrent![6] = performance.now() - t;
    } else {
      this.syncShotSprites();
    }
  }

  missileIgnite(s: Shot): void {
    if (s.from === "player" && s.kind === "lock-on-missile") {
      const pitch = 0.92;
      const spd = Math.max(Math.hypot(s.vx, s.vy), 90);
      s.vx = Math.cos(s.angle) * spd * Math.cos(pitch);
      s.vy = Math.sin(s.angle) * spd * Math.cos(pitch);
      s.vz = spd * Math.sin(pitch);
      s.loft = HELLFIRE_SEEK_DELAY;
    } else if (s.from === "player") {
      s.vz += 300;
    }
    const sc = shotTrailScale(s);
    const small = troopMissileTrail(s);
    const n = small ? Math.max(2, Math.round(5 * sc)) : Math.max(2, Math.round(8 * sc));
    const tail = this.shotUvScreenPos(s, SHOT_TAIL.x, SHOT_TAIL.y);
    this.withTrailFx(sc, () => {
      const { fire, smoke } = this.pairFx(s.z, s.y, this.burn, this.shortTrailSmoke, ZOff.fire, ZOff.smoke);
      this.emitBudgeted("fire", fire, tail.x, tail.y, n);
      this.emitBudgeted("smoke", smoke, tail.x, tail.y, Math.max(1, Math.round((small ? 3 : 6) * sc)));
      if (!small) {
        this.blastFire.setDepth(worldDepth(s.z, ZOff.fire + 0.2, s.y));
        this.emitBudgeted("fire", this.blastFire, tail.x, tail.y, Math.max(1, Math.round(4 * sc)));
      }
    });
    this.emitVisualBurst(s.x, s.y, s.z, {
      n: Math.max(4, Math.round(10 * sc)),
      spdMin: 80,
      spdMax: 240,
      bx: -Math.cos(s.angle),
      by: -Math.sin(s.angle),
      bz: 0.1,
      tight: 0.55,
      scaleMul: sc,
    }, this.muzzleBurst);
  }

  emitShotTrail(s: Shot, x0: number, y0: number, z0: number): void {
    if (s.kind === "cannon") return;
    if ((s.kind === "lock-on-missile" || s.kind === "guided-missile") && (s.motor == null || s.motor < 0) && !s.homePlayer) return;
    if (s.homePlayer && s.motor != null && s.motor < 0) return;
    const isRocket = s.kind === "rocket";
    const small = troopMissileTrail(s);
    // Troop RPGs can sit above 0.6 scale — don't treat them as Hydra (smoke-only).
    const hydra = isRocket && !small && (s.scale ?? 1) > 0.6;
    const sc = shotTrailScale(s) * (hydra ? 1.35 : 1);
    const t = range(0.2, 0.8);
    const x = x0 + (s.x - x0) * t;
    const y = y0 + (s.y - y0) * t;
    const z = z0 + (s.z - z0) * t;
    if (!cameraPointVisible(z, y)) return;
    const tail = this.shotUvScreenPos(s, SHOT_TAIL.x, SHOT_TAIL.y, x, y, z);
    const tx = tail.x;
    const ty = tail.y;
    this.withTrailFx(sc, () => {
      if (small) {
        const { fire, smoke } = this.pairFx(z, y, this.burn, this.lingerSmoke);
        if (Math.random() < 0.4) this.emitBudgeted("fire", fire, tx, ty, 1);
        if (Math.random() < 0.28) this.emitBudgeted("smoke", smoke, tx, ty, 1);
      } else if (hydra) {
        if (Math.random() < 0.55) this.emitBudgeted("smoke", this.fxAt(z, y, this.lingerSmoke, ZOff.smoke), tx, ty, 1);
      } else if (isRocket) {
        const { fire, smoke } = this.pairFx(z, y, this.burn, this.lingerSmoke);
        if (Math.random() < 0.38) this.emitBudgeted("fire", fire, tx, ty, 1);
        if (Math.random() < 0.28) this.emitBudgeted("smoke", smoke, tx, ty, 1);
      } else {
        const { fire, smoke } = this.pairFx(z, y, this.burn, this.lingerSmoke);
        if (Math.random() < 0.55) this.emitBudgeted("fire", fire, tx, ty, 1);
        if (Math.random() < 0.42) this.emitBudgeted("smoke", smoke, tx, ty, 1);
      }
    });
  }

  drawTowWires(): void {
    const g = this.towWireGfx;
    g.clear();
    if (this.heli.phase === "dead") return;
    let wireDepth = worldDepth(this.heli.z, ZOff.shot - 0.8, this.heli.y);
    for (const s of this.shots) {
      if (s.kind !== "guided-missile" || s.from !== "player") continue;
      const pts = s.wire ?? [];
      if (pts.length === 0) continue;
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

  simulateTowWire(s: Shot, dt: number): void {
    const player = this.towWing(s.wireSide ?? 1);
    const missile = { x: s.x, y: s.y, z: s.z };
    if (!s.wire) s.wire = [];
    const trail = s.wire;
    if (trail.length === 0) {
      trail.push({ ...missile });
      return;
    }
    const last = trail[trail.length - 1]!;
    if (Math.hypot(missile.x - last.x, missile.y - last.y, missile.z - last.z) > 12) {
      trail.push({ ...missile });
    }
    const n = trail.length;
    for (let i = 0; i < n; i++) {
      const t = n <= 1 ? 1 : i / (n - 1);
      const p = trail[i]!;
      const tx = player.x + (missile.x - player.x) * t;
      const ty = player.y + (missile.y - player.y) * t;
      const tz = player.z + (missile.z - player.z) * t;
      const rate = 8 * Math.pow(1 - t, 1.35);
      const a = rate <= 0 ? 0 : 1 - Math.exp(-rate * dt);
      p.x += (tx - p.x) * a;
      p.y += (ty - p.y) * a;
      p.z += (tz - p.z) * a;
    }
    s.wireTrim = (s.wireTrim ?? 0) + dt;
    const trimEvery = 0.08;
    while ((s.wireTrim ?? 0) >= trimEvery && trail.length > 2) {
      trail.shift();
      s.wireTrim = (s.wireTrim ?? 0) - trimEvery;
    }
  }

  towWing(side: number): { x: number; y: number; z: number } {
    const mounts = craftSecondaryMounts(this.heli.spec);
    const index = mounts.length > 1 ? (side < 0 ? 0 : 1) : 0;
    const mount = mounts[index] ?? mounts[0]!;
    return { ...this.secondaryWorldPos(mount), z: this.heli.z + ZOff.shot };
  }

  explode(
    x: number,
    y: number,
    z: number,
    blast: number,
    dmg: number,
    direct: Unit | undefined,
    dx: number,
    dy: number,
    dz: number,
    objectHit: boolean,
    kind: ShotKind,
    impactFxScale: number
  ): void {
    const water = isWater(this.world, x, y);
    const he = kind !== "cannon";
    const fx = hitSimParticleFx(dmg);
    const travel = Math.hypot(dx, dy, dz) || 1;
    const simParticleBx = dx;
    const simParticleBy = dy;
    const simParticleBz = he ? dz : Math.max(22, dz);
    const missileBias = he ? 2.4 : undefined;
    const mechGunBias = !he && objectHit && !(direct && isOrganic(direct.kind)) ? 2.1 : undefined;
    const expBias = missileBias ?? mechGunBias;
    // Soft-target blood spray is chain-gun only; rockets/missiles always use mech-style object hits.
    // Motorcycle keeps mech sparks and also gets rider blood.
    const softBloodHit = objectHit && !he && direct && hasSoftBlood(direct.kind);
    if (softBloodHit) {
      const graze = Phaser.Math.Clamp(Math.hypot(dx, dy) / travel, 0, 1);
      const distN = Phaser.Math.Clamp(Math.hypot(x - this.heli.x, y - this.heli.y) / 780, 0, 1);
      const acute = Math.max(graze, distN);
      this.spawnDirtParticles(x, y, z + 3, {
        n: 22,
        spdMin: Phaser.Math.Linear(36, 200, acute * acute),
        spdMax: Phaser.Math.Linear(200, 520, acute * acute),
        bx: simParticleBx,
        by: simParticleBy,
        bz: Phaser.Math.Linear(110, 40, acute),
        tight: Phaser.Math.Linear(0.28, 0.72, acute),
        blood: true,
      });
    }
    if (objectHit) {
      // Troops: blood only. Motorcycle: blood + mech sparks. Everything else: mech sparks.
      if (!softBloodHit || !isOrganic(direct!.kind)) {
        this.emitVisualBurst(x, y, z + 4, {
          n: scaledProjectileFxCount(
            Math.min(56, Math.round((he ? 36 : 18) * fx.n)),
            impactFxScale
          ),
          spdMin: (he ? 110 : 90) * fx.spd,
          spdMax: (he ? 480 : 340) * fx.spd,
          bx: simParticleBx,
          by: simParticleBy,
          bz: simParticleBz,
          tight: he ? 0.28 : 0.52,
          scaleMul: fx.size,
          expBias,
          gravity: 180,
        }, this.shortBurst);
      }
    } else if (water) {
      this.emitVisualBurst(x, y, z + 3, {
        n: Math.min(80, Math.round(20 * fx.n)),
        spdMin: 50 * fx.spd,
        spdMax: 220 * fx.spd,
        bx: simParticleBx,
        by: simParticleBy,
        bz: he ? Math.max(simParticleBz, 20) : Math.max(40, dz),
        tight: 0.48,
        scaleMul: fx.size,
        expBias: missileBias,
        gravity: 240,
      }, this.splashBurst);
    } else {
      const graze = Phaser.Math.Clamp(Math.hypot(dx, dy) / travel, 0, 1);
      const distN = Phaser.Math.Clamp(Math.hypot(x - this.heli.x, y - this.heli.y) / 780, 0, 1);
      const acute = Math.max(graze, distN);
      if (he) {
        const total = Math.min(96, Math.round(62 * fx.n));
        const baseSparkN = Math.max(1, Math.round(total * 0.02));
        const sparkN = scaledProjectileFxCount(baseSparkN, impactFxScale);
        this.spawnDirtParticles(x, y, z + 3, {
          n: Math.max(0, total - baseSparkN),
          spdMin: Phaser.Math.Linear(50, 160, acute) * fx.spd,
          spdMax: Phaser.Math.Linear(220, 420, acute) * fx.spd,
          bx: simParticleBx,
          by: simParticleBy,
          bz: simParticleBz,
          tight: 0.22,
          scaleMul: fx.size,
          expBias: missileBias,
        });
        this.emitVisualBurst(x, y, z + 3, {
          n: sparkN,
          spdMin: Phaser.Math.Linear(50, 160, acute) * fx.spd,
          spdMax: Phaser.Math.Linear(220, 420, acute) * fx.spd,
          bx: simParticleBx, by: simParticleBy, bz: simParticleBz,
          tight: 0.22, scaleMul: fx.size * 0.42, expBias: missileBias, gravity: 180,
        }, this.shortBurst);
      } else {
        const total = Math.min(80, Math.round(26 * fx.n));
        const baseSparkN = Math.max(1, Math.round(total * 0.04));
        const sparkN = scaledProjectileFxCount(baseSparkN, impactFxScale);
        this.spawnDirtParticles(x, y, z + 3, {
          n: Math.max(0, total - baseSparkN),
          spdMin: Phaser.Math.Linear(36, 200, acute * acute) * fx.spd,
          spdMax: Phaser.Math.Linear(200, 520, acute * acute) * fx.spd,
          bx: simParticleBx,
          by: simParticleBy,
          bz: Phaser.Math.Linear(90, 22, acute),
          tight: Phaser.Math.Linear(0.28, 0.72, acute),
          scaleMul: fx.size,
        });
        this.emitVisualBurst(x, y, z + 3, {
          n: sparkN,
          spdMin: Phaser.Math.Linear(36, 200, acute * acute) * fx.spd,
          spdMax: Phaser.Math.Linear(200, 520, acute * acute) * fx.spd,
          bx: simParticleBx, by: simParticleBy, bz: Phaser.Math.Linear(90, 22, acute),
          tight: Phaser.Math.Linear(0.28, 0.72, acute), scaleMul: fx.size * 0.42, gravity: 180,
        }, this.shortBurst);
      }
    }
    const impactAt = worldToScreen(x, y, z);
    const impactX = impactAt.x;
    const impactY = impactAt.y;
    const impactScale = impactAt.scale;
    if (he) this.heFireBurst(x, y, z, dx, dy, dz, blast, false, 1, Phaser.Math.Clamp((blast - 8) / 170, 0.16, 1));
    if (!water && !objectHit) {
      if (he) {
        const key = `fx_blast_${(Math.random() * 4) | 0}`;
        const sc = (blast / 72) * range(0.55, 1.05);
        this.stampWreck(this.textures.exists(key) ? key : "fx_blast_0", x, y, Math.random() * Math.PI * 2, sc, 1);
      } else {
        this.stampCannonScar(x, y, dx, dy, dz);
      }
    }
    if (!water) {
      this.smoke.setDepth(worldDepth(z, 0.2, y));
      this.emitBudgeted("smoke", this.smoke, impactX, impactY + 12, he ? 16 : objectHit ? 6 : 8);
    }
    this.shake = Math.min(8, this.shake + blast * (he ? 0.055 : 0.028));
    if (!he) this.spawnImpactFlash(impactX, impactY, z, 0xffc878, 34 * impactScale, 0.85, 160);
    // HE already splashed — skip a second death splash. Chain gun should still run vehicle death splash.
    this.applyBlastDamage(x, y, z, blast, dmg, direct, dx, dy, dz, he);
  }

  /** Splash hurt to units in radius (and light heli damage when low/close). */
  applyBlastDamage(
    x: number,
    y: number,
    z: number,
    blast: number,
    dmg: number,
    direct: Unit | undefined,
    dx: number,
    dy: number,
    dz: number,
    skipDeathSplash = false
  ): void {
    this.pushBlastRing(x, y, z, blast);
    for (const u of this.units) {
      if (u.dead) continue;
      const d = distToFootprint(x, y, footprintInto(u, 0, 0));
      if (u === direct || d < blast) {
        u.killDx = dx;
        u.killDy = dy;
        u.killDz = dz;
        const fall = u === direct ? dmg : dmg * (1 - d / blast);
        u.killDmg = fall;
        this.hurt(u, fall, skipDeathSplash);
      }
    }
    const hd = Math.hypot(this.heli.x - x, this.heli.y - y);
    const agl = castZ(this.world, this.heli.x, this.heli.y, this.heli.z);
    if (hd < blast * 0.55 && agl < 30) this.heli.damage(dmg * 0.25, dx, dy);
  }

  pushBlastRing(x: number, y: number, z: number, blast: number): void {
    if (!this.debugBlast || blast <= 0) return;
    this.blastRings.push({
      x,
      y,
      z,
      r: blast,
      heliR: blast * 0.55,
      life: 3.2,
      max: 3.2,
    });
    this.redrawBlastRings();
  }

  stampCannonScar(x: number, y: number, dx: number, dy: number, dz: number): void {
    const incoming = Math.hypot(dx, dy, dz) || 1;
    const slope = groundSlope(this.world, x, y);
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
    this.stampWreck(this.textures.exists(key) ? key : "fx_blast_0", px, py, ang, sx, alpha, 0.5, 0.5, sy);
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
    targetRadius = 0
  ): void {
    const at = worldToScreen(x, y, z);
    const blastX = at.x;
    const blastY = at.y;
    const blastScale = at.scale;
    const mul = (soft ? 0.32 : 1) * Phaser.Math.Linear(0.45, 1.15, size01);
    const p = Phaser.Math.Clamp(power, 0.5, 2.4);
    const t = Math.min(1, (p - 0.5) / 1.9);
    const spdBoost = Phaser.Math.Linear(0.95, 1.35, t);
    const biasLen = Math.hypot(dx, dy, dz);
    const expK = soft ? undefined : biasLen > 40 ? Phaser.Math.Linear(1.85, 2.7, t) : 1.5;
    this.emitVisualBurst(x, y, z + 10, {
      n: Math.max(4, Math.round(22 * mul)),
      spdMin: 140 * spdBoost,
      spdMax: 480 * spdBoost,
      bx: dx,
      by: dy,
      bz: dz,
      tight: Phaser.Math.Linear(0.48, 0.72, t),
      scaleMul: (soft ? 0.42 : 1) * Phaser.Math.Linear(0.4, 1.35, size01),
      expBias: expK,
    }, this.explosionPuff, "fire");
    this.blastFire.setDepth(worldDepth(z, ZOff.fire + 1, y));
    // Aim a cone along impact; stronger kills tighten.
    const horiz = Math.hypot(dx, dy);
    if (!soft && horiz > 8) {
      const deg = Phaser.Math.RadToDeg(Math.atan2(dy, dx));
      const cone = Phaser.Math.Linear(88, 42, t);
      this.blastFire.particleAngle = { min: deg - cone, max: deg + cone };
      this.blastFire.speed = { min: 170 * spdBoost, max: 500 * spdBoost };
    } else {
      this.blastFire.particleAngle = { min: 0, max: 360 };
      this.blastFire.speed = { min: 180, max: 480 };
    }
    this.emitBudgeted("fire", this.blastFire, blastX, blastY, Math.max(3, Math.round(26 * mul)));
    this.spawnImpactFlash(
      blastX,
      blastY,
      z,
      0xffe8a0,
      Math.max(10, blast * (soft ? 0.1 : 0.18) * waveMul) * blastScale,
      0.9,
      180
    );
    this.spawnBlastTrails(x, y, z, dx, dy, dz, soft, size01, p);
    if (targetRadius > 0) {
      const textureRadius = 64;
      const startRadius = targetRadius * blastScale;
      const endRadius = targetRadius * 4 * blastScale;
      const ring = this.add.image(blastX, blastY, "blast_ring_soft_v9", 0)
        .setTint(0xffffff)
        .setScale(startRadius / textureRadius)
        .setAlpha(0.4)
        .setDepth(worldDepth(z, ZOff.fire + 2, y))
        .setBlendMode(Phaser.BlendModes.ADD);
      const ringLife = { t: 0 };
      this.tweens.add({
        targets: ringLife,
        t: 1,
        duration: 220,
        ease: "Linear",
        onUpdate: () => {
          const t = ringLife.t;
          const expand = t >= 1
            ? 1
            : (1 - Math.pow(2, -14 * t)) / (1 - Math.pow(2, -14));
          const radius = Phaser.Math.Linear(startRadius, endRadius, expand);
          ring
            .setScale(radius / textureRadius)
            .setAlpha(0.4 * (1 - t * t))
            .setFrame(Math.min(BLAST_RING_FRAMES - 1, Math.floor(t * BLAST_RING_FRAMES)));
        },
        onComplete: () => ring.destroy(),
      });
    }
  }

  /** Mech death FX bias: shot vel × (killDmg/maxHp) boost + unit velocity. */
  deathBurstImpulse(u: Unit): { dx: number; dy: number; dz: number; power: number } {
    // Finishing blow relative to toughness — chain-gun chip on a bunker ≈ 0; same shot on a jeep ≈ 1+.
    const dmgScale = Phaser.Math.Clamp((u.killDmg ?? 0) / Math.max(1, u.max), 0, 1.5);
    // Stronger kill-impact pull than unit coasting.
    const shotPush = dmgScale * 2.4;
    const dx = (u.killDx ?? 0) * shotPush + u.vx;
    const dy = (u.killDy ?? 0) * shotPush + u.vy;
    const dz = (u.killDz ?? 0) * shotPush + 48;
    const impact = Math.hypot(dx, dy, dz);
    if (impact < 24) return { dx: 0, dy: 0, dz: 1, power: 0.55 };
    const power = Phaser.Math.Clamp(impact / 340, 0.55, 2.4);
    return { dx, dy, dz, power };
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
    power = 1
  ): void {
    const p = Phaser.Math.Clamp(power, 0.5, 2.4);
    const t = Math.min(1, (p - 0.5) / 1.9);
    const n =
      Math.max(2, Math.round(Phaser.Math.Linear(soft ? 2 : 4, soft ? 5 : 11, size01))) + ((Math.random() * 2) | 0);
    const spdMul = Phaser.Math.Linear(0.95, 1.4, t);
    const tight = soft ? 0.18 : Phaser.Math.Linear(0.45, 0.7, t);
    for (let i = 0; i < n; i++) {
      const reverse = Math.random() < (soft ? 0.35 : 0.14);
      const d = biasedDir(dx, dy, dz, tight, reverse);
      const sp = range(70, 250) * spdMul;
      const jit = soft ? 0.55 : 0.3;
      this.admitDebris({
        x,
        y,
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
        // Soft (troop) blast trails share the same mid flame size as organic debris trails.
        trailR: soft
          ? range(6.8, 7.6)
          : Phaser.Math.Linear(2.2, 14, size01) * range(0.75, 1.15),
        trailSoft: soft,
        wobble: Math.random() * Math.PI * 2,
        wobFreq: range(9, 17),
        wobAmp: range(140, 300),
      });
    }
  }

  texTrailR(key: string): number {
    const hit = this.texTrailCache.get(key);
    if (hit != null) return hit;
    if (!this.textures.exists(key)) return 14;
    const src = this.textures.get(key).getSourceImage() as { width: number; height: number };
    const v = Math.max(10, Math.max(src.width, src.height) * 0.32);
    this.texTrailCache.set(key, v);
    return v;
  }

  stampSoldierBlood(u: Unit, ox: number, oy: number, ang: number): void {
    if (!this.textures.exists("fx_dirt") || isWater(this.world, u.x, u.y)) return;
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

  hurt(u: Unit, dmg: number, fromBlast = false): void {
    u.health -= dmg;
    if (u.health <= 0) {
      this.destroyUnit(u, false, fromBlast);
      return;
    }
    if (isOrganic(u.kind) && specOf(u.kind).weapon && u.health > 1) {
      u.aware = true;
      this.rollSoldierMood(u, true);
    }
  }

  rollSoldierMood(u: Unit, flee: boolean): void {
    if (u.health <= 1 && u.health < u.max) {
      u.aiMood = undefined;
      return;
    }
    if (flee || u.health < u.max) {
      u.aiMood = "flee";
      u.moodT = 2.8 + Math.random() * 1.8;
      u.burstLeft = 0;
    } else {
      u.aiMood = "kite";
      u.moodT = 10 + Math.random() * 8;
    }
  }

  destroyUnit(u: Unit, quiet = false, skipSplash = false, skipAirCrash = false): void {
    if (u.dead) return;
    u.dead = true;
    for (const crew of this.units) {
      if (!crew.dead && crew.pinId === u.id) this.destroyUnit(crew);
    }
    const sp = specOf(u.kind);
    const building = !!sp.building;
    const mech =
      building ||
      isGroundVehicle(u.kind) ||
      !!sp.water ||
      !!sp.aerial;
    const boom = Phaser.Math.Clamp((radius(u.kind) - 6) / 86, 0.16, 1);
    if (!quiet) {
      const hz = u.z + heightOf(u.kind) * 0.5;
      const blast = Math.max(42, radius(u.kind) * 2.4) * (building ? 1.4 : 1);
      const near = Math.hypot(u.x - this.heli.x, u.y - this.heli.y);
      if (building) {
        const killPulse =
          Phaser.Math.Clamp(1.2 - near / 1100, 0.18, 0.62) * Phaser.Math.Linear(0.55, 1.15, boom);
        this.pulseTestBarrel(killPulse);
      }
      let burst: { dx: number; dy: number; dz: number; power: number } | null = null;
      if (sp.organic) {
        this.heFireBurst(u.x, u.y, hz, 0, 0, 1, blast, true, building ? 2.25 : 1, boom);
      } else {
        burst = this.deathBurstImpulse(u);
        this.heFireBurst(
          u.x,
          u.y,
          hz,
          burst.dx,
          burst.dy,
          burst.dz,
          blast,
          false,
          building ? 2.25 : 1,
          boom,
          burst.power,
          mech ? radius(u.kind) : 0
        );
      }
      if (building) this.emitDustShock(u.x, u.y, 1);
      const smokeAt = worldToScreen(u.x, u.y, u.z);
      this.smoke.setDepth(worldDepth(u.z, 0.2, u.y));
      this.emitBudgeted("smoke", this.smoke, smokeAt.x, smokeAt.y + 12, 16);
      this.shake = Math.min(10, this.shake + 3);
      // Buildings/vehicles: weak splash at ~3× body radius (FX blast can be larger).
      if (!skipSplash && !sp.organic) {
        if (mech) {
          const splashR = radius(u.kind) * 3;
          const deathDmg = u.max * (building ? 0.05 : 0.1);
          this.applyBlastDamage(
            u.x,
            u.y,
            u.z,
            splashR,
            deathDmg,
            undefined,
            u.killDx ?? 0,
            u.killDy ?? 0,
            u.killDz ?? 0,
            false
          );
        }
      }
      const n = Math.max(2, Math.round((sp.organic ? 4 : building ? 16 : 10) * Phaser.Math.Linear(0.4, 1.2, boom)));
      const keys = debrisKeys(u.kind);
      const debrisSpdMul = burst ? Phaser.Math.Linear(0.98, 1.35, Math.min(1, (burst.power - 0.5) / 1.9)) : 1;
      const debrisTight = burst ? Phaser.Math.Linear(0.48, 0.72, Math.min(1, (burst.power - 0.5) / 1.9)) : 0;
      for (let i = 0; i < n; i++) {
        const key = this.textures.exists(keys[i % keys.length]!)
          ? keys[i % keys.length]!
          : "fx_debris_metal";
        const organic = !!sp.organic;
        // HV buildings were throwing outsized chunks; keep mid/vehicle debris as-is.
        const maxSc = u.hv && !organic ? 1.18 : 1.5;
        const maxTrail = u.hv && !organic ? 1.12 : 1.4;
        let vx: number;
        let vy: number;
        let vz: number;
        let angle: number;
        if (burst) {
          const reverse = Math.random() < 0.14;
          const d = biasedDir(burst.dx, burst.dy, burst.dz, debrisTight, reverse);
          const spd = range(55, 255) * debrisSpdMul;
          const jit = 0.28;
          vx = d.x * spd + range(-spd * jit * 0.5, spd * jit * 0.5);
          vy = d.y * spd + range(-spd * jit * 0.5, spd * jit * 0.5);
          vz = range(170, 330) * Phaser.Math.Linear(0.95, 1.12, Math.min(1, (burst.power - 0.5) / 1.9)) + d.z * 35;
          angle = Math.atan2(vy, vx);
        } else {
          angle = Math.random() * Math.PI * 2;
          const spd = range(55, 255);
          vx = Math.cos(angle) * spd;
          vy = Math.sin(angle) * spd;
          vz = range(170, 330);
        }
        // Organic debris sprite scale stays varied; flame size is a fixed mid band (see emitDebrisTrail).
        this.admitDebris({
          x: u.x,
          y: u.y,
          z: u.z + range(8, 22),
          vx,
          vy,
          vz,
          angle,
          spin: range(-5, 5),
          life: range(0.45, 0.85),
          key,
          settled: false,
          gravity: true,
          bounces: Math.random() < 1 / 3 ? 2 + ((Math.random() * 2) | 0) : 0,
          trailR: organic
            ? range(6.8, 7.6)
            : this.texTrailR(key) * Phaser.Math.Linear(0.4, maxTrail, boom),
          scale: (organic ? 0.78 : 1) * Phaser.Math.Linear(0.32, maxSc, boom),
          trailSoft: organic,
        });
      }
      if (!sp.noCrater) {
        const key = `fx_blast_${(Math.random() * 4) | 0}`;
        let sc = (radius(u.kind) / 20) * range(0.72, 1.42);
        if (u.kind === "tank") sc *= 1.25;
        this.stampWreck(this.textures.exists(key) ? key : "fx_blast_0", u.x, u.y, Math.random() * Math.PI * 2, sc, 1);
      }
    }
    const guns = gunsOf(u);
    // Helis and drones: spinning hull falls then impacts — not on suicide/kamikaze pops.
    if (sp.move === "boat") {
      this.spawnBoatSink(u);
    } else if ((sp.move === "heli" || sp.move === "drone") && !skipAirCrash) {
      this.spawnHeliCrash({
        x: u.x,
        y: u.y,
        z: u.z,
        vx: u.vx,
        vy: u.vy,
        angle: u.angle,
        rotor: u.rotor,
        kind: u.kind,
        camo: u.camo,
        dmgSites: u.dmgSites,
        radius: radius(u.kind),
        kickDx: u.killDx,
        kickDy: u.killDy,
      });
    } else {
      const throwGuns = !!(sp.throwGuns && guns.length > 0);
      const throwRotors = sp.rotors.length > 0;
      const throwDish = !!sp.dish;
      if (throwGuns || throwRotors || throwDish) {
        const hullKey = resolveSkin(this.textures, sp.hulk, u.camo);
        const hp = spritePivot(hullKey);
        const hs = this.wreckDrawScale(u.x, u.y, u.z, 1, isGroundVehicle(u.kind), u.angle);
        this.stampWreck(
          hullKey,
          u.x,
          u.y,
          this.troopDrawAng(u) + Math.PI / 2,
          hs.sx,
          0.95,
          hp.x,
          hp.y,
          hs.sy
        );
        const throwOff = (key: string, ang: number, x: number, y: number, scale = 1, extra: Partial<Debris> = {}) => {
          const a = Math.random() * Math.PI * 2;
          const throwSp = range(90, 200);
          this.admitDebris({
            x,
            y,
            z: u.z + 18,
            vx: Math.cos(a) * throwSp,
            vy: Math.sin(a) * throwSp,
            vz: range(190, 270),
            angle: ang,
            spin: range(-5, 5),
            life: 5,
            key,
            settled: false,
            gravity: true,
            bounces: Math.random() < 1 / 3 ? 2 + ((Math.random() * 2) | 0) : 0,
            trailR: this.texTrailR(key) * scale,
            scale,
            debrisClass: "critical",
            ...extra,
          });
        };
        if (throwGuns) {
          guns.forEach((g, gi) => {
            const raw = this.textures.exists(g.hulk ?? "") ? g.hulk! : g.tex;
            const turretKey = resolveSkin(this.textures, raw, u.camo);
            const liveKey = resolveSkin(this.textures, g.tex, u.camo);
            const liveSpan = this.texSpan(liveKey);
            const hulkSpan = this.texSpan(turretKey);
            // Slightly under live gun size so pop hulks read as wreckage, not spare parts.
            const scale = (g.scale ?? 1) * (liveSpan / Math.max(hulkSpan, 1)) * 0.86;
            const at = this.gunMountPos(u, gi);
            // Turret hulks are large textures; don't inherit full debris trailR bump.
            throwOff(turretKey, (u.turrets[gi] ?? u.turret) + Math.PI / 2, at.x, at.y, scale, {
              trailR: this.texTrailR(turretKey) * scale * 0.38,
            });
          });
        }
        if (throwRotors) {
          sp.rotors.forEach((r, ri) => {
            const rk = this.textures.exists(r.hulk ?? "") ? r.hulk! : r.tex;
            const at = this.mountAt(u, resolveSkin(this.textures, textureOf(u.kind), u.camo), r.mount);
            const scale = this.rotorHulkScale(r.tex, rk, r.scale ?? 1);
            const flamePts = this.sampleSolidLocalPoints(
              rk,
              radius(u.kind) / Math.max(scale, 0.01),
              2 + ((Math.random() * 3) | 0)
            );
            const heliRotor = r.tex.includes("rotor") && r.tex !== "enemy_drone_rotor";
            if (heliRotor) {
              this.throwRotorHulk({
                key: rk,
                x: at.x,
                y: at.y,
                z: u.z + 18,
                rotorAng: ri % 2 ? -u.rotor : u.rotor,
                scale,
                flamePts,
              });
            } else {
              throwOff(rk, ri % 2 ? -u.rotor : u.rotor, at.x, at.y, scale, {
                flamePts,
              });
            }
          });
        }
        if (throwDish && sp.dish) {
          const d = sp.dish;
          const raw = this.textures.exists(d.hulk ?? "") ? d.hulk! : `${d.tex}_hulk`;
          const dishKey = this.textures.exists(raw) ? raw : d.tex;
          const liveSpan = this.texSpan(d.tex);
          const hulkSpan = this.texSpan(dishKey);
          const scale = (d.scale ?? 1) * (liveSpan / Math.max(hulkSpan, 1)) * 0.82;
          const at = this.mountAt(u, resolveSkin(this.textures, textureOf(u.kind), u.camo), d.mount);
          const span = this.texSpan(dishKey) * scale * 0.42;
          const n = 3 + ((Math.random() * 3) | 0);
          const flamePts: { lx: number; ly: number; sc: number }[] = [{ lx: 0, ly: 0, sc: 0.72 }];
          for (let i = 0; i < n; i++) {
            const rad = range(0.18, 0.82) * span;
            const ang = Math.random() * Math.PI * 2;
            flamePts.push({
              lx: Math.cos(ang) * rad,
              ly: Math.sin(ang) * rad,
              sc: range(0.28, 0.52),
            });
          }
          throwOff(dishKey, u.rotor, at.x, at.y, scale, {
            flamePts,
            dishFlat: true,
            spin: range(-7, 7),
            trailR: this.texTrailR(dishKey) * scale * 0.4,
            bounces: 0,
          });
        }
      } else {
        const hulkKey = resolveSkin(this.textures, hulkOf(u.kind), u.camo);
        const hp = spritePivot(hulkKey);
        const hs = this.wreckDrawScale(u.x, u.y, u.z, 1, isGroundVehicle(u.kind), u.angle);
        this.stampWreck(
          this.textures.exists(hulkKey) ? hulkKey : "hulk_crater",
          u.x,
          u.y,
          u.angle + Math.PI / 2,
          hs.sx,
          0.95,
          hp.x,
          hp.y,
          hs.sy
        );
        if (hasSoftBlood(u.kind) && this.textures.exists("fx_dirt") && !isWater(this.world, u.x, u.y)) {
          const kdx = u.killDx ?? 0;
          const kdy = u.killDy ?? 0;
          const impactAng = (kdx || kdy) ? Math.atan2(kdy, kdx) : u.angle;
          const nStreaks = 1 + ((Math.random() * 3) | 0);
          const blood = [0xee2828, 0xdd2020, 0xe83838, 0xcc1a1a];
          for (let si = 0; si < nStreaks; si++) {
            const ang = impactAng + range(-0.45, 0.45);
            const dist = range(4, 12);
            const ox = Math.cos(ang) * dist;
            const oy = Math.sin(ang) * dist;
            const col = blood[(Math.random() * blood.length) | 0]!;
            const sx = range(1.4, 3.2);
            const sy = range(0.35, 0.7);
            this.stampWreck(
              "fx_dirt",
              u.x + ox,
              u.y + oy,
              ang + range(-0.12, 0.12),
              sx,
              range(0.75, 0.95),
              0.5,
              0.5,
              sy,
              (Math.random() * FX_VARIANTS) | 0,
              col
            );
          }
        }
      }
    }
    this.spawnWheelDebris(u);
  }

  spawnWheelDebris(u: Unit): void {
    const maxW = specOf(u.kind).wheels;
    if (!maxW) return;
    const keys = wheelDebrisKeys().filter((k) => this.textures.exists(k));
    if (!keys.length) return;
    const n = Math.min(maxW, 1 + ((Math.random() * 2) | 0));
    const sc =
      u.kind === "motorcycle" ? range(0.48, 0.58) : u.kind === "pickup" ? range(0.68, 0.82) : range(0.78, 0.95);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const throwSp = range(120, 260);
      const key = keys[(Math.random() * keys.length) | 0]!;
      this.admitDebris({
        x: u.x + range(-10, 10),
        y: u.y + range(-10, 10),
        z: u.z + range(14, 32),
        vx: Math.cos(a) * throwSp,
        vy: Math.sin(a) * throwSp,
        vz: range(170, 300),
        angle: Math.random() * Math.PI * 2,
        spin: range(-14, 14),
        life: 20,
        key,
        settled: false,
        gravity: true,
        bounces: 1 + ((Math.random() * 2) | 0),
        trailR: this.texTrailR(key) * sc * 0.7,
        scale: sc,
        wheelRoll: true,
        track: 0,
      });
    }
  }

  texWidth(key: string): number {
    return this.texSpan(key);
  }

  texSpan(key: string): number {
    const hit = this.texSpanCache.get(key);
    if (hit != null) return hit;
    if (!this.textures.exists(key)) return 64;
    const src = this.textures.get(key).getSourceImage() as { width: number; height: number };
    const v = Math.max(1, src.width, src.height);
    this.texSpanCache.set(key, v);
    return v;
  }

  textureAlphaBounds(key: string): TextureAlphaBounds | null {
    if (this.textureAlphaCache.has(key)) return this.textureAlphaCache.get(key) ?? null;
    if (!this.textures.exists(key)) {
      this.textureAlphaCache.set(key, null);
      return null;
    }
    try {
      const src = this.textures.get(key).getSourceImage() as CanvasImageSource & {
        width: number;
        height: number;
      };
      const width = Math.max(1, src.width);
      const height = Math.max(1, src.height);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(src, 0, 0);
      const rgba = ctx.getImageData(0, 0, width, height).data;
      const alpha = new Uint8ClampedArray(width * height);
      let minX = width;
      let minY = height;
      let maxX = -1;
      let maxY = -1;
      for (let i = 0; i < alpha.length; i++) {
        const a = rgba[i * 4 + 3]!;
        alpha[i] = a;
        if (a < 48) continue;
        const x = i % width;
        const y = (i / width) | 0;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
      const result =
        maxX >= minX
          ? { width, height, alpha, minX, minY, maxX, maxY }
          : null;
      this.textureAlphaCache.set(key, result);
      return result;
    } catch {
      this.textureAlphaCache.set(key, null);
      return null;
    }
  }

  solidAtUv(key: string, u: number, v: number): boolean {
    const tex = this.textureAlphaBounds(key);
    if (!tex) return false;
    const x = Phaser.Math.Clamp(Math.floor(u * tex.width), 0, tex.width - 1);
    const y = Phaser.Math.Clamp(Math.floor(v * tex.height), 0, tex.height - 1);
    return tex.alpha[y * tex.width + x]! >= 48;
  }

  /** Bounded random solid-pixel pick, with an object-radius fallback around the pivot. */
  sampleSolidUv(key: string, fallbackRadius: number, attempts = 24): { u: number; v: number } {
    const tex = this.textureAlphaBounds(key);
    if (tex) {
      for (let i = 0; i < attempts; i++) {
        const x = tex.minX + ((Math.random() * (tex.maxX - tex.minX + 1)) | 0);
        const y = tex.minY + ((Math.random() * (tex.maxY - tex.minY + 1)) | 0);
        if (tex.alpha[y * tex.width + x]! >= 48) {
          return { u: (x + 0.5) / tex.width, v: (y + 0.5) / tex.height };
        }
      }
    }
    const width = tex?.width ?? Math.max(1, this.texSpan(key));
    const height = tex?.height ?? Math.max(1, this.texSpan(key));
    const pivot = spritePivot(key);
    const ang = Math.random() * Math.PI * 2;
    const dist = Math.sqrt(Math.random()) * Math.max(1, fallbackRadius);
    return {
      u: Phaser.Math.Clamp(pivot.x + (Math.cos(ang) * dist) / width, 0, 1),
      v: Phaser.Math.Clamp(pivot.y + (Math.sin(ang) * dist) / height, 0, 1),
    };
  }

  sampleSolidLocalPoints(
    key: string,
    fallbackRadius: number,
    count: number
  ): { lx: number; ly: number; sc: number }[] {
    const tex = this.textureAlphaBounds(key);
    const width = tex?.width ?? Math.max(1, this.texSpan(key));
    const height = tex?.height ?? Math.max(1, this.texSpan(key));
    const pivot = spritePivot(key);
    return Array.from({ length: count }, (_, i) => {
      const uv = this.sampleSolidUv(key, fallbackRadius);
      return {
        lx: (uv.u - pivot.x) * width,
        ly: (uv.v - pivot.y) * height,
        sc: i === 0 ? 1 : range(0.42, 0.62),
      };
    });
  }

  /** On-screen rotor span (pre-zScale), matching syncHeli / syncUnitSprites. */
  liveRotorDrawPx(tex: string, partScale = 1): number {
    if (tex.includes("rotor") && tex !== "enemy_drone_rotor") return rotorDrawSpan(tex, partScale);
    return this.texSpan(tex) * partScale;
  }

  /** Debris scale so a rotor hulk draws ~60% of the live rotor size. */
  rotorHulkScale(liveTex: string, hulkKey: string, partScale = 1): number {
    return (this.liveRotorDrawPx(liveTex, partScale) * 0.6) / Math.max(this.texSpan(hulkKey), 1);
  }

  /** Hull sinks below the waterline; guns still pop off as normal debris. */
  spawnBoatSink(u: Unit): void {
    const sp = specOf(u.kind);
    const guns = gunsOf(u);
    const hullKey = resolveSkin(this.textures, this.textures.exists(sp.hulk) ? sp.hulk : textureOf(u.kind), u.camo);
    if (sp.throwGuns && guns.length) {
      guns.forEach((g, gi) => {
        const raw = this.textures.exists(g.hulk ?? "") ? g.hulk! : g.tex;
        const turretKey = resolveSkin(this.textures, raw, u.camo);
        const liveKey = resolveSkin(this.textures, g.tex, u.camo);
        const liveSpan = this.texSpan(liveKey);
        const hulkSpan = this.texSpan(turretKey);
        const scale = (g.scale ?? 1) * (liveSpan / Math.max(hulkSpan, 1)) * 0.86;
        const at = this.gunMountPos(u, gi);
        const a = Math.random() * Math.PI * 2;
        const throwSp = range(70, 160);
        this.admitDebris({
          x: at.x,
          y: at.y,
          z: u.z + 14,
          vx: Math.cos(a) * throwSp,
          vy: Math.sin(a) * throwSp,
          vz: range(120, 210),
          angle: (u.turrets[gi] ?? u.turret) + Math.PI / 2,
          spin: range(-5, 5),
          life: 5,
          key: turretKey,
          settled: false,
          gravity: true,
          bounces: Math.random() < 1 / 3 ? 2 + ((Math.random() * 2) | 0) : 0,
          trailR: this.texTrailR(turretKey) * scale * 0.38,
          scale,
          debrisClass: "critical",
        });
      });
    }
    const baseKey = this.textures.exists(hullKey) ? hullKey : textureOf(u.kind);
    const sinkKey = `${baseKey}_sink`;
    const key = this.textures.exists(sinkKey) ? sinkKey : baseKey;
    const surface = waterSurfaceZ();
    this.admitDebris({
      x: u.x,
      y: u.y,
      z: surface,
      vx: u.vx * 0.35 + range(-14, 14),
      vy: u.vy * 0.35 + range(-14, 14),
      vz: 0,
      angle: u.angle + Math.PI / 2,
      spin: range(0.18, 0.42) * (Math.random() < 0.5 ? -1 : 1),
      life: 22,
      key,
      settled: false,
      gravity: false,
      bounces: 0,
      trailR: this.texTrailR(key) * 0.45,
      scale: 1,
      boatSink: true,
      sinkT: 0,
      sinkMax: range(5.2, 7.5),
      debrisClass: "critical",
    });
  }

  spawnHeliCrash(opts: {
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    angle: number;
    rotor: number;
    kind?: Unit["kind"];
    camo?: Unit["camo"];
    dmgSites?: { u: number; v: number; scale: number }[];
    radius: number;
    player?: boolean;
    kickDx?: number;
    kickDy?: number;
  }): void {
    const player = !!opts.player;
    const sp = opts.kind ? specOf(opts.kind) : undefined;
    const craft = player ? this.heli.spec : undefined;
    const hullKey = player
      ? this.textures.exists(craft!.hulk)
        ? craft!.hulk
        : craft!.body
      : resolveSkin(this.textures, sp!.hulk, opts.camo);
    const hullAng = opts.angle + (craft?.rotOff ?? Math.PI / 2);
    const dmgFlames = this.crashDmgFlames(opts.dmgSites, hullKey, opts.radius);
    const spinSign = Math.random() < 0.5 ? -1 : 1;
    const kn = Math.hypot(opts.kickDx ?? 0, opts.kickDy ?? 0);
    const boost = range(110, 170);
    const kx = kn > 1 ? ((opts.kickDx ?? 0) / kn) * boost : 0;
    const ky = kn > 1 ? ((opts.kickDy ?? 0) / kn) * boost : 0;
    const hull: Debris = {
      x: opts.x,
      y: opts.y,
      z: opts.z,
      vx: opts.vx * 0.9 + kx + range(-18, 18),
      vy: opts.vy * 0.9 + ky + range(-18, 18),
      vz: range(18, 55),
      angle: hullAng,
      spin: spinSign * range(0.85, 1.55),
      spinAccel: range(2.4, 4.6),
      life: 12,
      key: hullKey,
      settled: false,
      gravity: true,
      bounces: 0,
      trailR: this.texTrailR(hullKey) * 0.55,
      scale: 1,
      heliCrash: true,
      playerCrash: player,
      debrisClass: "critical",
      impactDust: Phaser.Math.Clamp(opts.radius / 48, 0.32, 0.72),
      dmgFlames,
      simmer: 0,
    };
    this.admitDebris(hull);

    const rotors = player
      ? craft!.rotor
        ? craftRotorMounts(craft!).map((mount) => ({
              tex: craft!.rotor!,
              hulk: craft!.rotorHulk ?? `${craft!.rotor}_hulk`,
              mount,
              scale: (craft!.rotorScale ?? 1) * (mount.scale ?? 1),
            }))
        : []
      : (sp?.rotors ?? []).map((r) => ({
          tex: r.tex,
          hulk: this.textures.exists(r.hulk ?? "") ? r.hulk! : r.tex,
          mount: r.mount,
          scale: r.scale ?? 1,
        }));

    rotors.forEach((r, ri) => {
      const rk = this.textures.exists(r.hulk) ? r.hulk : r.tex;
      let x = opts.x;
      let y = opts.y;
      if (player && craft) {
        const pivot = craftOrigin(craft);
        const source = this.textures.get(craft.body).getSourceImage() as { width: number; height: number };
        const hullRot = opts.angle + craft.rotOff;
        const mx = (r.mount.x - pivot.x) * source.width;
        const my = (r.mount.y - pivot.y) * source.height;
        x += mx * Math.cos(hullRot) - my * Math.sin(hullRot);
        y += mx * Math.sin(hullRot) + my * Math.cos(hullRot);
      } else if (opts.kind) {
        const at = this.mountAt(
          {
            id: 0,
            kind: opts.kind,
            x: opts.x,
            y: opts.y,
            z: opts.z,
            vx: 0,
            vy: 0,
            angle: opts.angle,
            turret: 0,
            health: 1,
            max: 1,
            dead: false,
            fireCd: 0,
            orbit: 0,
            rotor: opts.rotor,
            track: 0,
            turrets: [],
            muzzleT: 0,
            muzzleGun: 0,
            muzzleTip: 0,
            camo: opts.camo,
          },
          resolveSkin(this.textures, textureOf(opts.kind), opts.camo),
          r.mount
        );
        x = at.x;
        y = at.y;
      }
      const scale = this.rotorHulkScale(r.tex, rk, r.scale);
      const flamePts = this.sampleSolidLocalPoints(
        rk,
        opts.radius / Math.max(scale, 0.01),
        2 + ((Math.random() * 3) | 0)
      );
      const rotorAng = ri % 2 ? -opts.rotor : opts.rotor;
      // Drones: all rotors always fly off — never pin to the falling hull.
      const pin = opts.kind !== "drone" && Math.random() < 0.4;
      if (pin) {
        const spinSign = rotorAng >= 0 ? 1 : -1;
        this.admitDebris({
          x,
          y,
          z: opts.z + 6,
          vx: 0,
          vy: 0,
          vz: 0,
          angle: rotorAng,
          spin: spinSign * range(18, 32),
          life: 14,
          key: rk,
          settled: false,
          gravity: false,
          bounces: 0,
          trailR: this.texTrailR(rk) * 0.35,
          scale,
          flamePts,
          pinHost: hull,
          pinMount: { ...r.mount },
          rotorSkew: true,
          skewAng: range(-0.4, 0.4) + (Math.random() < 0.5 ? 0 : Math.PI / 2),
          debrisClass: "critical",
        });
      } else {
        this.throwRotorHulk({
          key: rk,
          x,
          y,
          z: opts.z + 8,
          rotorAng,
          scale,
          flamePts,
        });
      }
    });
  }

  throwRotorHulk(opts: {
    key: string;
    x: number;
    y: number;
    z: number;
    rotorAng: number;
    scale: number;
    flamePts: { lx: number; ly: number; sc: number }[];
  }): void {
    const a = Math.random() * Math.PI * 2;
    const throwSp = range(240, 420);
    const spinSign = opts.rotorAng >= 0 ? 1 : -1;
    this.admitDebris({
      x: opts.x,
      y: opts.y,
      z: opts.z,
      vx: Math.cos(a) * throwSp,
      vy: Math.sin(a) * throwSp,
      vz: range(220, 360),
      angle: opts.rotorAng,
      spin: spinSign * range(22, 38),
      life: 8,
      key: opts.key,
      settled: false,
      gravity: true,
      bounces: 0,
      trailR: this.texTrailR(opts.key) * 0.35,
      scale: opts.scale,
      rotorThrow: true,
      rotorSkew: true,
      skewAng: range(-0.5, 0.5) + (Math.random() < 0.5 ? 0 : Math.PI / 2),
      flamePts: opts.flamePts,
      debrisClass: "critical",
    });
  }

  crashDmgFlames(
    sites: { u: number; v: number; scale: number }[] | undefined,
    hulkKey: string,
    fallbackRadius: number
  ): { u: number; v: number; scale: number }[] {
    if (!sites?.length) {
      const n = 1 + ((Math.random() * 2) | 0);
      return Array.from({ length: n }, () => {
        const uv = this.sampleSolidUv(hulkKey, fallbackRadius);
        return { u: uv.u, v: uv.v, scale: range(0.42, 0.8) };
      });
    }
    return sites.map((s) => {
      const uv = this.solidAtUv(hulkKey, s.u, s.v)
        ? s
        : this.sampleSolidUv(hulkKey, fallbackRadius);
      return { u: uv.u, v: uv.v, scale: s.scale };
    });
  }

  beginPlayerCrash(): void {
    if (this.playerCrashStarted) return;
    this.playerCrashStarted = true;
    this.showStinger(
      "AIRCRAFT DOWN",
      `${this.heli.spec.name} lost · impact site marked`,
      0xff6a3a,
      4.6,
      { x: this.heli.x, y: this.heli.y }
    );
    const h = this.heli;
    this.body.setVisible(false);
    for (const rotor of this.rotors) rotor.setVisible(false);
    for (const gun of this.guns) gun.setVisible(false);
    this.gun.setVisible(false);
    this.shadow.setVisible(false);
    const hz = h.z + h.height * 0.5;
    const blast = 56;
    this.heFireBurst(h.x, h.y, hz, 0, 0, 1, blast, false, 1, 0.55);
    const smokeAt = worldToScreen(h.x, h.y, h.z);
    this.smoke.setDepth(worldDepth(h.z, 0.2, h.y));
    this.emitBudgeted("smoke", this.smoke, smokeAt.x, smokeAt.y + 12, 14);
    this.shake = Math.min(10, this.shake + 4);
    const n = 8;
    const keys = debrisKeys("heli");
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const spd = range(55, 220);
      const key = this.textures.exists(keys[i % keys.length]!) ? keys[i % keys.length]! : "fx_debris_metal";
      this.admitDebris({
        x: h.x,
        y: h.y,
        z: h.z + range(8, 22),
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd,
        vz: range(170, 330),
        angle: a,
        spin: range(-5, 5),
        life: range(0.45, 0.85),
        key,
        settled: false,
        gravity: true,
        bounces: Math.random() < 1 / 3 ? 2 + ((Math.random() * 2) | 0) : 0,
        trailR: this.texTrailR(key) * Phaser.Math.Linear(0.4, 1.2, 0.55),
        scale: Phaser.Math.Linear(0.32, 1.3, 0.55),
      });
    }
    this.spawnHeliCrash({
      x: h.x,
      y: h.y,
      z: h.z,
      vx: h.vx,
      vy: h.vy,
      angle: h.angle,
      rotor: h.rotor,
      radius: h.spec.radius,
      player: true,
      dmgSites: h.dmgSites,
      kickDx: h.killDx,
      kickDy: h.killDy,
    });
  }

  updateDebris(dt: number): void {
    const keep: Debris[] = [];
    for (const f of this.debris) {
      if (f.trailOnly && !f.settled) f.life -= dt;
      if (f.settled) {
        if (f.heliCrash) {
          if ((f.simmer ?? 0) > 0) {
            f.simmer! -= dt;
            keep.push(f);
          } else if (f.playerCrash && this.playerCrashEndT < 0) {
            this.playerCrashEndT = 0.55;
          }
          continue;
        }
        // Boat hulks leave a wreck stamp only — never burn/smoke trails.
        if (!f.boatSink) this.tickDebrisTrailFade(f, dt);
        if (!f.trailOnly || (f.trailFade ?? 0) > 0) keep.push(f);
        continue;
      }
      if (f.heliCrash) {
        const sign = f.spin >= 0 ? 1 : -1;
        f.spin += sign * (f.spinAccel ?? 10) * dt;
      }
      if (f.rolling && f.wheelRoll && !f.settled) {
        this.tickWheelRoll(f, dt);
        if (!f.settled) keep.push(f);
        else if (!f.trailOnly || (f.trailFade ?? 0) > 0) keep.push(f);
        continue;
      }
      if (f.boatSink && !f.settled) {
        this.tickBoatSink(f, dt);
        if (!f.settled) keep.push(f);
        else if (!f.trailOnly || (f.trailFade ?? 0) > 0) keep.push(f);
        continue;
      }
      if (f.pinHost && !f.settled) {
        this.tickPinnedRotor(f, dt);
        if (!f.settled) keep.push(f);
        else if (!f.trailOnly || (f.trailFade ?? 0) > 0) keep.push(f);
        continue;
      }
      if (f.rotorThrow) {
        // Bleed horizontal speed and spin so it floats out then settles before stamp.
        f.vx *= Math.pow(0.42, dt);
        f.vy *= Math.pow(0.42, dt);
        f.spin *= Math.pow(0.28, dt);
        if (f.vz > 40) f.vz *= Math.pow(0.55, dt);
      }
      if (f.linger) {
        f.wobble = (f.wobble ?? 0) + (f.wobFreq ?? 12) * dt;
        const spd = Math.hypot(f.vx, f.vy) || 1;
        const nx = f.vx / spd;
        const ny = f.vy / spd;
        const px = -ny;
        const py = nx;
        const w = f.wobble;
        const amp = f.wobAmp ?? 160;
        const osc = Math.sin(w) * amp + Math.sin(w * 2.37 + 0.8) * amp * 0.55;
        f.vx += px * osc * dt + range(-35, 35) * dt;
        f.vy += py * osc * dt + range(-35, 35) * dt;
        f.vz += Math.cos(w * 1.6) * amp * 0.35 * dt + range(-25, 25) * dt;
      }
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.angle += f.spin * dt;
      if (f.gravity) {
        f.z += f.vz * dt;
        if (f.vz > 50) f.vz -= 480 * dt;
        else if (f.vz > -40) f.vz -= 70 * dt;
        else f.vz -= 1100 * dt;
        if (f.shellEject) {
          // Casings: air drag + ground bounce only (sample ground when falling).
          f.vx *= Math.pow(0.86, dt);
          f.vy *= Math.pow(0.86, dt);
          if (f.vz <= 0) {
            const g = groundZ(this.world, f.x, f.y);
            if (f.z <= g) {
              f.z = g;
              const spd = Math.hypot(f.vx, f.vy, f.vz);
              if (f.bounces > 0 && spd > 35) {
                f.bounces--;
                this.bounceDebrisSlope(f, 0.45);
                f.vx *= 0.22;
                f.vy *= 0.22;
                f.vz = Math.abs(f.vz) * 0.28;
                f.spin *= 0.4;
              } else {
                this.settleDebris(f);
              }
            }
          }
        } else {
          const drag = f.heliCrash ? 0.94 : f.rotorThrow ? 0.88 : 0.78;
          f.vx *= Math.pow(drag, dt);
          f.vy *= Math.pow(drag, dt);
          if (f.z > groundZ(this.world, f.x, f.y) + 2) {
            this.emitDebrisTrail(f, 1);
          }
          const g = groundZ(this.world, f.x, f.y);
          if (f.z <= g) {
            f.z = g;
            if (!f.linger) this.stampDirtSmears(f.x, f.y, f.vx, f.vy);
            if (f.heliCrash) {
              this.impactHeliCrash(f);
              this.settleDebris(f);
            } else if (f.rotorThrow) {
              f.spin *= 0.15;
              f.vx *= 0.2;
              f.vy *= 0.2;
              this.settleDebris(f);
            } else if (f.wheelRoll) {
              if (f.bounces > 0 && f.vz < -40) {
                f.bounces--;
                this.bounceDebrisSlope(f, 1);
                f.spin *= 0.65;
                this.stampDirtSmears(f.x, f.y, f.vx, f.vy);
                const bang = Math.hypot(f.vx, f.vy) > 8 ? Math.atan2(f.vy, f.vx) : f.angle;
                this.stampWheelTrack(f.x, f.y, bang, range(0.7, 0.95), range(0.32, 0.48));
              } else {
                f.rolling = true;
                f.vz = 0;
                f.z = g;
                const hang = Math.hypot(f.vx, f.vy) > 8 ? Math.atan2(f.vy, f.vx) : f.angle;
                this.stampWheelTrack(f.x, f.y, hang, range(0.65, 0.9), range(0.28, 0.44));
              }
            } else if (
              f.bounces > 0 &&
              f.vz < -50 &&
              Math.hypot(f.vx, f.vy, f.vz) > 120
            ) {
              f.bounces--;
              // Same elevation bounce as wheels, weaker so flight path barely turns.
              this.bounceDebrisSlope(f, 0.32);
              f.spin *= range(0.78, 1.22);
              f.spin += range(-2.4, 2.4);
              f.angle += range(-0.28, 0.28);
            } else {
              this.settleDebris(f);
            }
          }
        }
      } else {
        f.vx *= Math.pow(0.08, dt);
        f.vy *= Math.pow(0.08, dt);
        f.life -= dt;
        if (f.life <= 0 || Math.hypot(f.vx, f.vy) < 8) {
          this.settleDebris(f);
        }
      }
      if (!(f.trailOnly && f.life <= 0 && !f.settled)) keep.push(f);
    }
    this.debris = keep;
    if (this.perfEnabled) {
      const t = performance.now();
      this.syncDebrisSprites();
      this.perfCurrent![8] = performance.now() - t;
    } else {
      this.syncDebrisSprites();
    }
  }

  tickPinnedRotor(f: Debris, dt: number): void {
    const host = f.pinHost!;
    const mount = f.pinMount ?? { x: 0.5, y: 0.5 };
    const at = this.debrisMountAt(host, mount);
    f.x = at.x;
    f.y = at.y;
    f.z = host.z + 4;
    if (host.settled) {
      // Coast down very slowly after the hull lands.
      f.spin *= Math.pow(0.72, dt);
    }
    f.angle += f.spin * dt;
    const spinMag = Math.abs(f.spin);
    if (spinMag > 0.12 || !host.settled) {
      const dim = host.settled ? Phaser.Math.Clamp(spinMag / 8, 0.2, 1) : 1;
      this.emitDebrisTrail(f, dim);
    }
    if (host.settled && spinMag < 0.1) {
      this.settleDebris(f);
    }
  }

  debrisMountAt(host: Debris, mount: { x: number; y: number }): { x: number; y: number } {
    const pivot = spritePivot(host.key);
    const src = this.textures.exists(host.key)
      ? (this.textures.get(host.key).getSourceImage() as { width: number; height: number })
      : { width: 64, height: 64 };
    const sc = host.scale ?? 1;
    const dw = src.width * sc;
    const dh = src.height * sc;
    const mx = (mount.x - pivot.x) * dw;
    const my = (mount.y - pivot.y) * dh;
    const ca = Math.cos(host.angle);
    const sa = Math.sin(host.angle);
    return {
      x: host.x + mx * ca - my * sa,
      y: host.y + mx * sa + my * ca,
    };
  }

  /**
   * Reflect debris off the height-map slope (same field as wheel roll / rivers).
   * strength 1 = full wheel bounce; ~0.3 nudges trajectory without redirecting it.
   */
  bounceDebrisSlope(f: Debris, strength: number): void {
    const s = Phaser.Math.Clamp(strength, 0, 1);
    const sl = groundSlope(this.world, f.x, f.y);
    let nx = -sl.dx;
    let ny = -sl.dy;
    let nz = 1;
    const nlen = Math.hypot(nx, ny, nz) || 1;
    nx /= nlen;
    ny /= nlen;
    nz /= nlen;
    const vin = f.vx * nx + f.vy * ny + f.vz * nz;
    const e = Phaser.Math.Linear(0.14, 0.42, s);
    if (vin < 0) {
      // Scale the horizontal part of the kick down at low strength so path barely turns.
      const kick = (1 + e) * vin;
      const hMul = Phaser.Math.Linear(0.28, 1, s);
      f.vx -= kick * nx * hMul;
      f.vy -= kick * ny * hMul;
      f.vz -= kick * nz;
    } else {
      f.vz = -f.vz * e;
    }
    const fric = Phaser.Math.Linear(0.68, 0.78, s);
    f.vx *= fric;
    f.vy *= fric;
    f.vz *= Phaser.Math.Linear(0.88, 0.92, s);
    const steep = Math.hypot(sl.dx, sl.dy);
    if (steep > 1e-4) {
      const dx = -sl.dx / steep;
      const dy = -sl.dy / steep;
      const shove =
        Math.min(140, 38 + steep * 900) *
        Phaser.Math.Clamp(-f.vz / 220, 0.35, 1.2) *
        Phaser.Math.Linear(0.18, 1, s);
      f.vx += dx * shove;
      f.vy += dy * shove;
    }
  }

  tickWheelRoll(f: Debris, dt: number): void {
    const sl = groundSlope(this.world, f.x, f.y);
    const steep = Math.hypot(sl.dx, sl.dy);
    let ax = -sl.dx;
    let ay = -sl.dy;
    const al = Math.hypot(ax, ay);
    if (al > 1e-4) {
      ax /= al;
      ay /= al;
      const pull = 520 * steep;
      f.vx += ax * pull * dt;
      f.vy += ay * pull * dt;
    }
    const wet = isWater(this.world, f.x, f.y);
    const fric = wet ? 0.12 : steep > 0.07 ? 0.88 : steep > 0.04 ? 0.62 : 0.38;
    f.vx *= Math.pow(fric, dt);
    f.vy *= Math.pow(fric, dt);
    const spd = Math.hypot(f.vx, f.vy);
    const rad = Math.max(6, 11 * (f.scale ?? 1));
    if (spd > 1) {
      const cross = f.vx * ay - f.vy * ax;
      const sign = cross >= 0 ? 1 : -1;
      f.angle += (spd / rad) * dt * sign;
      f.spin = (spd / rad) * sign;
    } else {
      f.spin *= Math.pow(0.2, dt);
    }
    f.x += f.vx * dt;
    f.y += f.vy * dt;
    f.z = groundZ(this.world, f.x, f.y);
    if (spd > 22) this.emitDebrisTrail(f, 1);
    else if (spd > 10) this.emitDebrisTrail(f, 0.5);
    if (!wet && spd > 4) {
      f.track = (f.track ?? 0) + spd * dt;
      const gap = range(5, 14);
      if (f.track >= gap) {
        f.track = 0;
        const ang = Math.atan2(f.vy, f.vx);
        const sc = range(0.55, 0.88) * (f.scale ?? 1);
        this.stampWheelTrack(f.x, f.y, ang, sc, range(0.22, 0.42));
      }
    }
    if (wet || (spd < 6 && steep < 0.04)) {
      this.settleDebris(f);
    }
  }

  tickBoatSink(f: Debris, dt: number): void {
    const max = Math.max(0.5, f.sinkMax ?? 6);
    f.sinkT = (f.sinkT ?? 0) + dt;
    const u = Phaser.Math.Clamp(f.sinkT / max, 0, 1);
    // Ease in: slow at first, then drop under faster.
    const ease = u * u;
    f.x += f.vx * dt;
    f.y += f.vy * dt;
    f.vx *= Math.pow(0.35, dt);
    f.vy *= Math.pow(0.35, dt);
    // Keep a gentle yaw the whole way down.
    f.angle += f.spin * dt;
    f.spin = Phaser.Math.Linear(f.spin, f.spin >= 0 ? 0.12 : -0.12, 1 - Math.pow(0.5, dt));
    // Surface → terrain bed (ignore waterline). Scale shrinks with depth.
    const surface = waterSurfaceZ();
    const bed = groundZ(this.world, f.x, f.y);
    f.z = Phaser.Math.Linear(surface, bed, ease);
    f.vz = 0;
    f.scale = Phaser.Math.Linear(1, 0.55, ease);
    if (u >= 1) this.settleBoatSink(f);
  }

  settleBoatSink(f: Debris): void {
    f.settled = true;
    f.vx = 0;
    f.vy = 0;
    f.vz = 0;
    if (!f.trailOnly) {
      const o = this.debrisStampOrigin(f.key);
      const hs = this.wreckDrawScale(f.x, f.y, f.z || 0, f.scale ?? 0.55);
      // Pre-baked blue sink art — no runtime tintFill.
      this.stampWreck(f.key, f.x, f.y, f.angle, hs.sx, 0.8, o.x, o.y, hs.sy);
      f.trailOnly = true;
    }
    f.trailFade = 0;
    f.life = 0;
  }

  impactHeliCrash(f: Debris): void {
    const blast = 38 + (f.impactDust ?? 0.5) * 36;
    this.heFireBurst(f.x, f.y, f.z + 6, 0, 0, 1, blast, false, 1.15, 0.42);
    this.emitDustShock(f.x, f.y, f.impactDust ?? 0.5);
    this.shake = Math.min(10, this.shake + 2.4);
    const key = `fx_blast_${(Math.random() * 4) | 0}`;
    let sc = Phaser.Math.Linear(0.85, 1.45, f.impactDust ?? 0.5) * range(0.9, 1.2);
    if (f.playerCrash) sc *= 1.12;
    this.stampWreck(this.textures.exists(key) ? key : "fx_blast_0", f.x, f.y, Math.random() * Math.PI * 2, sc, 1);
    f.simmer = range(2.6, 4.4);
    f.spin = 0;
    f.spinAccel = 0;
    if (f.playerCrash) {
      this.playerCrashLanded = true;
      this.playerCrashSimmerT = Math.max(f.simmer ?? 2.6, 2.2);
      this.playerCrashEndT = -1; // wait for simmer to finish
    }
  }

  settleDebris(f: Debris): void {
    if (f.linger) this.stampLightBlast(f.x, f.y, f.vx, f.vy);
    if (f.dishFlat) {
      this.emitDustShock(f.x, f.y, 0.95);
      this.stampDirtSmears(f.x, f.y, f.vx || range(-40, 40), f.vy || range(-40, 40));
    }
    f.settled = true;
    f.vx = 0;
    f.vy = 0;
    f.vz = 0;
    if (!f.trailOnly) {
      const o = this.debrisStampOrigin(f.key);
      const hs = this.wreckDrawScale(f.x, f.y, f.z || 0, f.scale ?? 1);
      let sx = hs.sx;
      let sy = hs.sy;
      if (f.dishFlat) {
        sx *= 1.04;
        sy *= 0.52;
      } else if (f.rotorSkew) {
        sx *= 1.08;
        sy *= 0.78;
      }
      this.stampWreck(f.key, f.x, f.y, f.angle, sx, 0.92, o.x, o.y, sy);
      f.trailOnly = true;
    }
    if (!f.heliCrash && !f.shellEject) this.beginDebrisTrailFade(f);
  }

  beginDebrisTrailFade(f: Debris): void {
    // Unclamped size (emitDebrisTrail still clamps draw scale). Mid (~1) keeps current fade.
    const flameSc = this.debrisTrailSize(f);
    const over = Math.max(0, flameSc - 1.05);
    const stretch = 1 + over * (f.linger ? 0.7 : 1.35);
    const base = f.linger ? range(2.2, 3.8) : range(0.55, 1.05);
    f.trailFadeMax = base * stretch;
    f.trailFade = f.trailFadeMax;
  }

  /** Unclamped trail size band used for fade duration and particle lifespan. */
  debrisTrailSize(f: Debris): number {
    const r = f.trailR;
    if (f.trailSoft) return r / 4.8;
    let size = (r * Math.min(f.scale ?? 1, 1)) / (f.linger ? 6 : 6.5);
    // Dish trails keep trailR small for emit rate; lifespan should follow the big sprite.
    if (f.dishFlat || f.flamePts?.length) {
      size = Math.max(size, (this.texSpan(f.key) * (f.scale ?? 1)) / 48);
    }
    return size;
  }

  /** Particle life multiplier — mid (~1) unchanged; large debris leave a long tail. */
  debrisTrailLifeMul(size: number): number {
    const over = Math.max(0, size - 1.05);
    // Linear near mid stays mild; quadratic stretches big radar-scale trails further.
    return 1 + over * 0.4 + over * over * 1.65;
  }

  tickDebrisTrailFade(f: Debris, dt: number): void {
    if (f.trailFade == null) this.beginDebrisTrailFade(f);
    if ((f.trailFade ?? 0) <= 0) return;
    f.trailFade! -= dt;
    const dim = Phaser.Math.Clamp(f.trailFade! / (f.trailFadeMax || 1), 0, 1);
    if (dim > 0) this.emitDebrisTrail(f, dim * dim);
  }

  emitDebrisTrail(f: Debris, dim: number): void {
    if (dim <= 0.02) return;
    if (!cameraPointVisible(f.z, f.y)) return;
    const debrisScale = worldToScreen(f.x, f.y, f.z).scale;
    // Trails sit under the debris sprite (body ≈ 0); keep fire above smoke within the pair.
    const trailFire = -0.35;
    const trailSmoke = -1.15;
    const lifeMul = this.debrisTrailLifeMul(this.debrisTrailSize(f));
    if (f.flamePts?.length) {
      const ca = Math.cos(f.angle);
      const sa = Math.sin(f.angle);
      const flatX = f.dishFlat ? 1.04 : f.rotorSkew ? 1.08 : 1;
      const flatY = f.dishFlat ? 0.52 : f.rotorSkew ? 0.78 : 1;
      const { fire, smoke } = this.pairFx(f.z, f.y, this.flame, this.hurtSmoke, trailFire, trailSmoke);
      const prevLife = this.trailFxLife;
      this.trailFxLife = lifeMul;
      for (const p of f.flamePts) {
        const lx = p.lx * flatX;
        const ly = p.ly * flatY;
        const worldX = f.x + lx * ca - ly * sa;
        const worldY = f.y + lx * sa + ly * ca;
        const at = worldToScreen(worldX, worldY, f.z);
        this.dmgFlameScale = p.sc * (f.scale ?? 1) * (f.dishFlat ? 0.85 : 1.15);
        if (Math.random() < 0.8 * dim) this.emitBudgeted("fire", fire, at.x, at.y, p.lx === 0 && p.ly === 0 ? 2 : 1);
        if (Math.random() < 0.42 * dim) this.emitBudgeted("smoke", smoke, at.x, at.y, 1);
      }
      this.trailFxLife = prevLife;
      return;
    }
    if (f.heliCrash) return;
    if (f.shellEject) return;
    if (f.trailLx == null || f.trailLy == null) {
      const rad = Math.max(3, Math.min((this.texSpan(f.key) * (f.scale ?? 1)) * 0.42, f.trailR * 0.9));
      const a = Math.random() * Math.PI * 2;
      const d = range(0.28, 0.92) * rad;
      f.trailLx = Math.cos(a) * d;
      f.trailLy = Math.sin(a) * d;
    }
    const ca = Math.cos(f.angle);
    const sa = Math.sin(f.angle);
    const lx = f.trailLx;
    const ly = f.trailLy;
    const trailAt = worldToScreen(
      f.x + lx * ca - ly * sa,
      f.y + lx * sa + ly * ca,
      f.z
    );
    const r = f.trailR;
    const fireProto = f.trailSoft ? this.ember : f.linger ? this.blastBurn : this.burn;
    const puffProto = f.linger ? this.lingerSmoke : this.shortTrailSmoke;
    const rawSc = this.debrisTrailSize(f);
    // Soft trails: size from trailR only (ignore debris sprite scale) so debris + blast embers match.
    const sc = f.trailSoft
      ? Phaser.Math.Clamp(rawSc, 1.4, 1.65)
      : Phaser.Math.Clamp(rawSc, 0.35, 2.75);
    // Soft fire uses ember (tiny base); keep smoke from inheriting the ember boost.
    const smokeSc = f.trailSoft ? Phaser.Math.Clamp(sc * 0.28, 0.32, 0.48) : sc;
    const jit = Math.max(1.5, r * 0.12);
    const { fire, smoke: puff } = this.pairFx(f.z, f.y, fireProto, puffProto, trailFire, trailSmoke);
    const p = jitterDisk(trailAt.x, trailAt.y, jit * debrisScale);
    if (Math.random() < (f.trailOnly ? 0.85 : 0.7) * dim) {
      this.withTrailFx(sc, () => this.emitBudgeted("fire", fire, p.x, p.y, 1), lifeMul);
    }
    if (Math.random() < (f.trailOnly ? 0.65 : 0.5) * dim) {
      this.withTrailFx(smokeSc, () => this.emitBudgeted("smoke", puff, p.x, p.y, 1), lifeMul);
    }
  }

  emitHeliCrashDmgFlames(): void {
    for (const f of this.debris) {
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
    const src = this.textures.exists(f.key)
      ? (this.textures.get(f.key).getSourceImage() as { width: number; height: number })
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
    // Above falling/settled hull, same band as live unit damage (under rotors/turrets when applicable).
    const { fire, smoke } = this.pairFx(f.z, f.y, this.flame, this.hurtSmoke, ZOff.dmg, ZOff.smoke);
    const airMul = f.heliCrash ? 1.65 : 1;
    for (const s of f.dmgFlames) {
      const p = spriteUvPos(spr, s.u, s.v);
      this.dmgFlameScale = s.scale * dim * airMul;
      if (Math.random() < 0.72 * dim) this.emitBudgeted("fire", fire, p.x, p.y, 2);
      if (Math.random() < 0.35 * dim) this.emitBudgeted("smoke", smoke, p.x, p.y, 1);
    }
  }

  unwrapTilt(part: Phaser.GameObjects.Image): void {
    const wrap = part.getData("tiltWrap") as Phaser.GameObjects.Container | undefined;
    if (!wrap) return;
    part.setData("tiltWrap", undefined);
    if (wrap.scene) {
      wrap.remove(part);
      this.add.existing(part);
      wrap.destroy();
    }
  }

  registerFx(kind: FxClass, ...emitters: Phaser.GameObjects.Particles.ParticleEmitter[]): void {
    for (const emitter of emitters) this.fxPolicies[kind].emitters.add(emitter);
  }

  /** Clone an emitter across painter-depth bands so concurrent trails don't thrash one depth. */
  poolFx(
    kind: FxClass,
    make: () => Phaser.GameObjects.Particles.ParticleEmitter
  ): Phaser.GameObjects.Particles.ParticleEmitter {
    const slots: Phaser.GameObjects.Particles.ParticleEmitter[] = [];
    for (let i = 0; i < this.fxSlotN; i++) {
      const em = make();
      em.setDepth(Layer.WORLD);
      slots.push(em);
    }
    this.fxSlots.set(slots[0]!, slots);
    this.registerFx(kind, ...slots);
    return slots[0]!;
  }

  fxBand(z: number, y: number): number {
    const cameraDepth = worldDepth(z, 0, y) - Layer.WORLD;
    const center = (this.fxSlotN - 1) * 0.5;
    return Phaser.Math.Clamp(Math.round(cameraDepth / this.fxBandH + center), 0, this.fxSlotN - 1);
  }

  fxBandDepth(band: number, off: number): number {
    const center = (this.fxSlotN - 1) * 0.5;
    return Layer.WORLD + (band - center) * this.fxBandH + off;
  }

  fxSlot(
    proto: Phaser.GameObjects.Particles.ParticleEmitter,
    z: number,
    y: number
  ): { emitter: Phaser.GameObjects.Particles.ParticleEmitter; band: number } {
    const slots = this.fxSlots.get(proto);
    const band = this.fxBand(z, y);
    return { emitter: slots ? slots[band]! : proto, band };
  }

  fxAt(
    z: number,
    y: number,
    proto: Phaser.GameObjects.Particles.ParticleEmitter,
    off: number
  ): Phaser.GameObjects.Particles.ParticleEmitter {
    const slot = this.fxSlot(proto, z, y);
    const em = slot.emitter;
    const d = this.fxBandDepth(slot.band, off);
    if (em.depth !== d) em.setDepth(d);
    return em;
  }

  /**
   * Pick the camera-depth-band fire/smoke pair and pin both depths to that band so this
   * trail stays projectile → smoke → flame. Other bands can still interleave.
   */
  pairFx(
    z: number,
    y: number,
    fireProto: Phaser.GameObjects.Particles.ParticleEmitter,
    smokeProto: Phaser.GameObjects.Particles.ParticleEmitter,
    fireOff: number = ZOff.fire,
    smokeOff: number = ZOff.smoke
  ): { fire: Phaser.GameObjects.Particles.ParticleEmitter; smoke: Phaser.GameObjects.Particles.ParticleEmitter } {
    const fireSlot = this.fxSlot(fireProto, z, y);
    const smokeSlot = this.fxSlot(smokeProto, z, y);
    const fire = fireSlot.emitter;
    const smoke = smokeSlot.emitter;
    const sOff = Math.min(smokeOff, fireOff - 1.25);
    const fOff = Math.max(fireOff, sOff + 1.25);
    const sd = this.fxBandDepth(smokeSlot.band, sOff);
    const fd = this.fxBandDepth(fireSlot.band, fOff);
    if (smoke.depth !== sd) smoke.setDepth(sd);
    if (fire.depth !== fd) fire.setDepth(fd);
    return { fire, smoke };
  }

  fxAlive(kind: FxClass): number {
    let alive = 0;
    for (const emitter of this.fxPolicies[kind].emitters) alive += emitter.getAliveParticleCount();
    return alive;
  }

  /** Emit under independent semantic per-frame and global-active policies. */
  emitBudgeted(
    kind: FxClass,
    em: Phaser.GameObjects.Particles.ParticleEmitter,
    x: number,
    y: number,
    n: number
  ): number {
    const policy = this.fxPolicies[kind];
    if (n <= 0 || policy.emitted >= policy.frameCap) return 0;
    const take = Math.min(n, policy.frameCap - policy.emitted, policy.activeCap - this.fxAlive(kind));
    if (take <= 0) return 0;
    policy.emitted += take;
    em.emitParticleAt(x, y, take);
    return take;
  }

  withTrailFx(scale: number, fn: () => void, lifeMul = 1): void {
    const prev = this.trailFxScale;
    const prevLife = this.trailFxLife;
    this.trailFxScale = scale;
    this.trailFxLife = lifeMul;
    fn();
    this.trailFxScale = prev;
    this.trailFxLife = prevLife;
  }

  driveDrone(u: Unit, dt: number, h: Heli, dist: number, dx: number, dy: number): void {
    if (dist < 1400 && h.phase === "flight") {
      const want = Math.atan2(dy, dx);
      const err = Math.abs(Phaser.Math.Angle.Wrap(want - u.angle));
      const turn = err > 1.0 ? 5.2 : err > 0.4 ? 3.8 : 2.8;
      u.angle = Phaser.Math.Angle.RotateTo(u.angle, want, turn * dt);

      const facing = err < 0.16;
      if (facing) {
        const fx = Math.cos(u.angle);
        const fy = Math.sin(u.angle);
        const along = u.vx * fx + u.vy * fy;
        const lx = u.vx - fx * along;
        const ly = u.vy - fy * along;
        const sideKeep = Math.pow(0.25, dt);
        u.vx = fx * along + lx * sideKeep;
        u.vy = fy * along + ly * sideKeep;
        u.vx += fx * 360 * dt;
        u.vy += fy * 360 * dt;
        u.vx *= Math.pow(0.94, dt);
        u.vy *= Math.pow(0.94, dt);
        const maxSpd = 320;
        const s = Math.hypot(u.vx, u.vy);
        if (s > maxSpd) {
          u.vx *= maxSpd / s;
          u.vy *= maxSpd / s;
        }
        u.aiState = "CHARGE";
      } else {
        // Coast: no thrust, mild drag so it overshoots then slows while turning
        u.vx *= Math.pow(0.52, dt);
        u.vy *= Math.pow(0.52, dt);
        u.aiState = "TURN";
      }
      u.aiTx = h.x;
      u.aiTy = h.y;
      if (dist < this.heli.spec.radius) {
        this.heli.damage(38, u.vx, u.vy);
        // Kamikaze: explode in place — no falling crash hull.
        this.destroyUnit(u, false, false, true);
        return;
      }
    } else {
      u.vx *= Math.pow(0.38, dt);
      u.vy *= Math.pow(0.38, dt);
    }
    u.x += u.vx * dt;
    u.y += u.vy * dt;
  }

  driveScoutHeli(u: Unit, dt: number, h: Heli, dist: number, dx: number, dy: number): void {
    u.moodT = (u.moodT ?? 0) - dt;
    if ((u.moodT ?? 0) <= 0 && u.aiMood === "flee") u.aiMood = undefined;
    const flee = u.aiMood === "flee";
    const kite = u.aiMood === "kite";
    const toAng = Math.atan2(dy, dx);
    const side = (u.id & 1) === 0 ? 1 : -1;
    const prefDist = 380;

    if (dist < 1600 && h.phase === "flight") {
      const fwdX = dx / (dist || 1);
      const fwdY = dy / (dist || 1);
      const latX = -fwdY * side;
      const latY = fwdX * side;
      const fx = Math.cos(u.angle);
      const fy = Math.sin(u.angle);

      if (flee) {
        const awayAng = Math.atan2(-dy, -dx);
        u.angle = Phaser.Math.Angle.RotateTo(u.angle, awayAng, 2.8 * dt);
        const face = Math.max(0, Math.cos(Phaser.Math.Angle.Wrap(awayAng - u.angle)));
        u.vx += fx * 170 * face * dt;
        u.vy += fy * 170 * face * dt;
      } else if (kite && dist < 900) {
        u.angle = Phaser.Math.Angle.RotateTo(u.angle, toAng, 3.4 * dt);
        const face = Math.max(0, Math.cos(Phaser.Math.Angle.Wrap(toAng - u.angle)));
        const radial = Phaser.Math.Clamp((dist - prefDist) * 0.4, -100, 100);
        // Main thrust along nose; light strafe only once roughly facing.
        u.vx += (fx * radial + latX * 130 * face) * face * dt;
        u.vy += (fy * radial + latY * 130 * face) * face * dt;
      } else {
        u.angle = Phaser.Math.Angle.RotateTo(u.angle, toAng, 2.8 * dt);
        const face = Math.max(0, Math.cos(Phaser.Math.Angle.Wrap(toAng - u.angle)));
        const thrust = dist > prefDist ? 155 : 60;
        u.vx += fx * thrust * face * dt;
        u.vy += fy * thrust * face * dt;
        if (kite && dist > 1100) u.aiMood = undefined;
      }
    }
    const damp = flee ? 0.55 : kite ? 0.62 : 0.55;
    u.vx *= Math.pow(damp, dt);
    u.vy *= Math.pow(damp, dt);
    u.x += u.vx * dt;
    u.y += u.vy * dt;
    u.aiState = flee ? "RETREAT" : kite ? "KITE" : "ATTACK";
    u.aiTx = h.x;
    u.aiTy = h.y;
  }

  driveOrbitHeli(u: Unit, dt: number, h: Heli, dist: number, dx: number, dy: number): void {
    const heavy = u.kind === "heli_heavy";
    if (heavy) {
      // Heavy: always orbit and shoot, no kiting
      if (dist < 1500 && h.phase === "flight") {
        u.orbit += 0.2 * dt;
        const ring = 430;
        const ox = h.x + Math.cos(u.orbit) * ring;
        const oy = h.y + Math.sin(u.orbit) * ring;
        const to = Math.atan2(oy - u.y, ox - u.x);
        u.angle = Phaser.Math.Angle.RotateTo(u.angle, to, 1.15 * dt);
        u.vx += Math.cos(u.angle) * 58 * dt;
        u.vy += Math.sin(u.angle) * 58 * dt;
        u.aiState = "ORBIT";
        u.aiTx = ox;
        u.aiTy = oy;
      } else {
        u.aiState = "HOLD";
        u.aiTx = undefined;
        u.aiTy = undefined;
      }
      u.vx *= 0.98;
      u.vy *= 0.98;
    } else {
      // Gunship: attack -> kite -> orbit, always shooting
      u.moodT = (u.moodT ?? 0) - dt;
      if ((u.moodT ?? 0) <= 0 && u.aiMood === "flee") u.aiMood = undefined;
      const orbit = u.aiMood === "flee";
      const kite = u.aiMood === "kite";
      const toAng = Math.atan2(dy, dx);
      const side = (u.id & 1) === 0 ? 1 : -1;
      const closeDist = 280;
      const orbitRing = 380;

      if (dist < 1500 && h.phase === "flight") {
        const fwdX = dx / (dist || 1);
        const fwdY = dy / (dist || 1);
        const latX = -fwdY * side;
        const latY = fwdX * side;
        const fx = Math.cos(u.angle);
        const fy = Math.sin(u.angle);

        if (orbit) {
          u.orbit += 0.28 * dt;
          const ox = h.x + Math.cos(u.orbit) * orbitRing;
          const oy = h.y + Math.sin(u.orbit) * orbitRing;
          const to = Math.atan2(oy - u.y, ox - u.x);
          u.angle = Phaser.Math.Angle.RotateTo(u.angle, to, 1.6 * dt);
          u.vx += fx * 78 * dt;
          u.vy += fy * 78 * dt;
        } else if (kite && dist < 700) {
          u.angle = Phaser.Math.Angle.RotateTo(u.angle, toAng, 1.85 * dt);
          const face = Math.max(0, Math.cos(Phaser.Math.Angle.Wrap(toAng - u.angle)));
          const radial = Phaser.Math.Clamp((dist - closeDist) * 0.3, -65, 65);
          u.vx += (fx * radial + latX * 72 * face) * face * dt;
          u.vy += (fy * radial + latY * 72 * face) * face * dt;
        } else {
          u.angle = Phaser.Math.Angle.RotateTo(u.angle, toAng, 1.6 * dt);
          const face = Math.max(0, Math.cos(Phaser.Math.Angle.Wrap(toAng - u.angle)));
          const thrust = dist > closeDist ? 85 : 30;
          u.vx += fx * thrust * face * dt;
          u.vy += fy * thrust * face * dt;
          if (kite && dist > 900) u.aiMood = undefined;
        }
        u.aiState = orbit ? "ORBIT" : kite ? "KITE" : "ATTACK";
        u.aiTx = h.x;
        u.aiTy = h.y;
      } else {
        u.aiState = "HOLD";
        u.aiTx = undefined;
        u.aiTy = undefined;
      }
      const damp = orbit ? 0.92 : kite ? 0.65 : 0.6;
      u.vx *= Math.pow(damp, dt);
      u.vy *= Math.pow(damp, dt);
    }
    u.x += u.vx * dt;
    u.y += u.vy * dt;
  }

  /** 0 at inland → 1 deep in the map rim. */
  mapEdgeWeight(x: number, y: number): number {
    const lo = MAP_EDGE_PAD;
    const hi = WORLD - MAP_EDGE_PAD;
    const m = MAP_EDGE_MARGIN;
    let px = 0;
    let py = 0;
    if (x < lo + m) px += 1 - Phaser.Math.Clamp((x - lo) / m, 0, 1);
    if (x > hi - m) px -= 1 - Phaser.Math.Clamp((hi - x) / m, 0, 1);
    if (y < lo + m) py += 1 - Phaser.Math.Clamp((y - lo) / m, 0, 1);
    if (y > hi - m) py -= 1 - Phaser.Math.Clamp((hi - y) / m, 0, 1);
    return Math.min(1, Math.hypot(px, py));
  }

  /** Inward unit vector from map rim (0,0 if inland). */
  mapEdgeInland(x: number, y: number): { x: number; y: number; w: number } {
    const lo = MAP_EDGE_PAD;
    const hi = WORLD - MAP_EDGE_PAD;
    const m = MAP_EDGE_MARGIN;
    let px = 0;
    let py = 0;
    if (x < lo + m) px += 1 - Phaser.Math.Clamp((x - lo) / m, 0, 1);
    if (x > hi - m) px -= 1 - Phaser.Math.Clamp((hi - x) / m, 0, 1);
    if (y < lo + m) py += 1 - Phaser.Math.Clamp((y - lo) / m, 0, 1);
    if (y > hi - m) py -= 1 - Phaser.Math.Clamp((hi - y) / m, 0, 1);
    const w = Math.hypot(px, py);
    if (w < 0.02) return { x: 0, y: 0, w: 0 };
    return { x: px / w, y: py / w, w: Math.min(1, w) };
  }

  /**
   * Bias a chase point toward dry land (`preferWater=false`) or open water (`true`).
   * Samples look-ahead along want / facing and a local ring so units turn before crossing.
   */
  terrainSteer(
    x: number,
    y: number,
    wantX: number,
    wantY: number,
    preferWater: boolean,
    facing?: number
  ): { x: number; y: number } {
    let wx = wantX;
    let wy = wantY;
    const ok = (px: number, py: number) => {
      const wet = isWater(this.world, px, py);
      return preferWater ? wet : !wet;
    };
    const bad = (px: number, py: number) => !ok(px, py);

    const hx = wantX - x;
    const hy = wantY - y;
    const hd = Math.hypot(hx, hy) || 1;
    const dirs: { nx: number; ny: number }[] = [{ nx: hx / hd, ny: hy / hd }];
    if (facing != null) dirs.push({ nx: Math.cos(facing), ny: Math.sin(facing) });

    for (const { nx, ny } of dirs) {
      for (const dist of [28, 52, 84, 120]) {
        if (!bad(x + nx * dist, y + ny * dist)) continue;
        const strength = Phaser.Math.Clamp(1.25 - dist / 150, 0.4, 1.15);
        wx -= nx * 62 * strength;
        wy -= ny * 62 * strength;
        const leftOk = ok(x - ny * 44, y + nx * 44);
        const rightOk = ok(x + ny * 44, y - nx * 44);
        if (leftOk && !rightOk) {
          wx += -ny * 78 * strength;
          wy += nx * 78 * strength;
        } else if (rightOk && !leftOk) {
          wx += ny * 78 * strength;
          wy += -nx * 78 * strength;
        } else {
          wx += -ny * 48 * strength;
          wy += nx * 48 * strength;
        }
        break;
      }
    }

    if (bad(x, y)) {
      let gx = 0;
      let gy = 0;
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        if (ok(x + Math.cos(a) * 52, y + Math.sin(a) * 52)) {
          gx += Math.cos(a);
          gy += Math.sin(a);
        }
      }
      const gd = Math.hypot(gx, gy);
      if (gd > 0.2) {
        wx += (gx / gd) * 140;
        wy += (gy / gd) * 140;
      }
    } else {
      // Soft shore margin: ease away before the look-ahead hits.
      let bx = 0;
      let by = 0;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        if (bad(x + Math.cos(a) * 40, y + Math.sin(a) * 40)) {
          bx -= Math.cos(a);
          by -= Math.sin(a);
        }
      }
      const bd = Math.hypot(bx, by);
      if (bd > 0.2) {
        wx += (bx / bd) * 58;
        wy += (by / bd) * 58;
      }
    }
    return { x: wx, y: wy };
  }

  /** Step on preferred terrain only; slide on axes or brake if blocked. */
  stepOnTerrain(u: Unit, dx: number, dy: number, preferWater: boolean): void {
    const ok = (px: number, py: number) => {
      const wet = isWater(this.world, px, py);
      return preferWater ? wet : !wet;
    };
    const nx = u.x + dx;
    const ny = u.y + dy;
    if (ok(nx, ny)) {
      u.x = nx;
      u.y = ny;
      return;
    }
    if (ok(u.x + dx, u.y)) {
      u.x += dx;
      u.vy *= 0.35;
      return;
    }
    if (ok(u.x, u.y + dy)) {
      u.y += dy;
      u.vx *= 0.35;
      return;
    }
    u.vx *= 0.15;
    u.vy *= 0.15;
  }

  steerGround(u: Unit, wantX: number, wantY: number): { x: number; y: number } {
    let wx = wantX;
    let wy = wantY;
    const uR = circumRadiusOf(u.kind);
    const uFp = footprintInto(u, 0, 0);
    for (const o of this.units) {
      if (o.dead || o.id === u.id || o.pinId != null) continue;
      const osp = specOf(o.kind);
      if (osp.aerial || osp.water || osp.move === "boat") continue;
      // Buildings, statics, ground vehicles, and infantry all block.
      const solid =
        !!osp.building ||
        osp.move === "static" ||
        isGroundVehicle(o.kind) ||
        osp.move === "inf" ||
        osp.move === "flee";
      if (!solid) continue;
      const pad = osp.building || osp.move === "static" ? 40 : 28;
      const maxR = uR + circumRadiusOf(o.kind) + pad + 2;
      const dx = u.x - o.x;
      const dy = u.y - o.y;
      if (dx * dx + dy * dy > maxR * maxR) continue;
      const ov = footprintOverlap(uFp, footprintInto(o, pad, 1));
      if (!ov.hit || ov.depth <= 0) continue;
      const strength = osp.building || osp.move === "static" ? 3.2 : 2.4;
      const push = ov.depth * strength;
      wx += ov.nx * push;
      wy += ov.ny * push;
    }
    // Short look-ahead: if heading into a solid, bias the want sideways.
    const hx = wx - u.x;
    const hy = wy - u.y;
    const hd = Math.hypot(hx, hy) || 1;
    const nx = hx / hd;
    const ny = hy / hd;
    const look = radius(u.kind) + 52;
    const lx = u.x + nx * look;
    const ly = u.y + ny * look;
    const lookPad = radius(u.kind) + 22;
    for (const o of this.units) {
      if (o.dead || o.id === u.id || o.pinId != null) continue;
      const osp = specOf(o.kind);
      if (!(osp.building || osp.move === "static" || isGroundVehicle(o.kind))) continue;
      const maxR = circumRadiusOf(o.kind) + lookPad + 2;
      const odx = lx - o.x;
      const ody = ly - o.y;
      if (odx * odx + ody * ody > maxR * maxR) continue;
      if (pointInFootprint(lx, ly, footprintInto(o, lookPad, 1))) {
        wx += -ny * 56;
        wy += nx * 56;
        wx -= nx * 28;
        wy -= ny * 28;
        break;
      }
    }
    const dry = this.terrainSteer(u.x, u.y, wx, wy, false, u.angle);
    return this.mapEdgeSteer(u.x, u.y, dry.x, dry.y);
  }

  /** Soft depenetration vs buildings / other ground units after a move. */
  separateGround(u: Unit): void {
    const uR = circumRadiusOf(u.kind);
    for (const o of this.units) {
      if (o.dead || o.id === u.id || o.pinId != null) continue;
      const osp = specOf(o.kind);
      if (osp.aerial || osp.water || osp.move === "boat") continue;
      if (!(osp.building || osp.move === "static" || isGroundVehicle(o.kind) || osp.move === "inf" || osp.move === "flee"))
        continue;
      const pad = osp.building || osp.move === "static" ? 8 : 4;
      const maxR = uR + circumRadiusOf(o.kind) + pad + 2;
      const dx = u.x - o.x;
      const dy = u.y - o.y;
      if (dx * dx + dy * dy > maxR * maxR) continue;
      const ov = footprintOverlap(footprintInto(u, 0, 0), footprintInto(o, pad, 1));
      if (!ov.hit || ov.depth <= 0) continue;
      const push = ov.depth * (osp.building || osp.move === "static" ? 0.85 : 0.45);
      u.x += ov.nx * push;
      u.y += ov.ny * push;
      // Kill residual closing speed into the obstacle.
      const vn = u.vx * ov.nx + u.vy * ov.ny;
      if (vn < 0) {
        u.vx -= ov.nx * vn;
        u.vy -= ov.ny * vn;
      }
    }
  }

  /** Inward aim that overrides other steer wants near the map rim. */
  mapEdgeSteer(x: number, y: number, wantX: number, wantY: number): { x: number; y: number } {
    const edge = this.mapEdgeInland(x, y);
    if (edge.w < 0.02) return { x: wantX, y: wantY };
    const t = Math.min(1, edge.w * 1.2);
    const inlandX = x + edge.x * (220 + t * 400);
    const inlandY = y + edge.y * (220 + t * 400);
    return {
      x: Phaser.Math.Linear(wantX, inlandX, t),
      y: Phaser.Math.Linear(wantY, inlandY, t),
    };
  }

  /** Kill outbound velocity and clamp so units cannot leave the map. */
  containOnMap(u: Unit, dt: number): void {
    const sp = specOf(u.kind);
    if (sp.building || sp.move === "static") return;
    const lo = MAP_EDGE_PAD;
    const hi = WORLD - MAP_EDGE_PAD;
    const m = MAP_EDGE_MARGIN;
    if (u.x < lo + m && u.vx < 0) u.vx *= Phaser.Math.Clamp((u.x - lo) / m, 0, 1);
    if (u.x > hi - m && u.vx > 0) u.vx *= Phaser.Math.Clamp((hi - u.x) / m, 0, 1);
    if (u.y < lo + m && u.vy < 0) u.vy *= Phaser.Math.Clamp((u.y - lo) / m, 0, 1);
    if (u.y > hi - m && u.vy > 0) u.vy *= Phaser.Math.Clamp((hi - u.y) / m, 0, 1);

    const edge = this.mapEdgeInland(u.x, u.y);
    if (edge.w > 0.02) {
      const t = edge.w;
      if (sp.aerial || sp.water || sp.move === "boat") {
        // Aerial flee-out vs inland thrust: prefer divert, not a cancel equilibrium.
        const thrust = (sp.aerial ? 160 : 70) * t * t;
        u.vx += edge.x * thrust * dt;
        u.vy += edge.y * thrust * dt;
        // Kill remaining outbound component so flee can't pin on the rim.
        const out = u.vx * -edge.x + u.vy * -edge.y;
        if (out > 0) {
          u.vx += edge.x * out * Math.min(1, t * 1.4);
          u.vy += edge.y * out * Math.min(1, t * 1.4);
        }
        if (t > 0.35) {
          u.angle = Phaser.Math.Angle.RotateTo(u.angle, Math.atan2(edge.y, edge.x), 2.8 * t * dt);
        }
      } else if (isGroundVehicle(u.kind) || sp.move === "inf" || sp.move === "flee") {
        // Ground: keep turning inland when braked at the rim (unlocks minTurnSpd trap).
        if (t > 0.28) {
          u.angle = Phaser.Math.Angle.RotateTo(u.angle, Math.atan2(edge.y, edge.x), 2.4 * t * dt);
        }
        if (t > 0.4 && Math.hypot(u.vx, u.vy) < 18) {
          u.vx += edge.x * 55 * t * dt;
          u.vy += edge.y * 55 * t * dt;
        }
      }
    }
    u.x = Phaser.Math.Clamp(u.x, lo, hi);
    u.y = Phaser.Math.Clamp(u.y, lo, hi);
  }

  pickBoatWaypoint(u: Unit): void {
    const lo = MAP_EDGE_PAD + 80;
    const hi = WORLD - MAP_EDGE_PAD - 80;
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = 140 + Math.random() * 280;
      const x = Phaser.Math.Clamp(u.x + Math.cos(a) * d, lo, hi);
      const y = Phaser.Math.Clamp(u.y + Math.sin(a) * d, lo, hi);
      const mx = (u.x + x) / 2;
      const my = (u.y + y) / 2;
      // Prefer open water: target, mid, and a ring around the target must stay wet.
      if (
        isWater(this.world, x, y) &&
        isWater(this.world, mx, my) &&
        isWater(this.world, x + 36, y) &&
        isWater(this.world, x - 36, y) &&
        isWater(this.world, x, y + 36) &&
        isWater(this.world, x, y - 36)
      ) {
        u.aiTx = x;
        u.aiTy = y;
        return;
      }
    }
    // Fallback: any wet point still clear of the shoreline look-ahead.
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = 80 + Math.random() * 160;
      const x = Phaser.Math.Clamp(u.x + Math.cos(a) * d, lo, hi);
      const y = Phaser.Math.Clamp(u.y + Math.sin(a) * d, lo, hi);
      if (isWater(this.world, x, y) && isWater(this.world, (u.x + x) / 2, (u.y + y) / 2)) {
        u.aiTx = x;
        u.aiTy = y;
        return;
      }
    }
    u.aiTx = Phaser.Math.Clamp(u.x + Math.cos(u.angle) * 80, lo, hi);
    u.aiTy = Phaser.Math.Clamp(u.y + Math.sin(u.angle) * 80, lo, hi);
  }

  driveBoat(u: Unit, dt: number): void {
    const yaw = u.kind === "ptboat" ? 1.55 : 0.85;
    const spd = u.kind === "ptboat" ? 38 : 22;
    if (!isWater(this.world, u.x, u.y)) {
      const seek = this.terrainSteer(u.x, u.y, u.x + Math.cos(u.angle) * 80, u.y + Math.sin(u.angle) * 80, true, u.angle);
      const want = Math.atan2(seek.y - u.y, seek.x - u.x);
      u.angle = Phaser.Math.Angle.RotateTo(u.angle, want, yaw * 1.4 * dt);
      const step = spd * 0.35 * dt;
      // Stranded: crawl over land toward water (don't require wet cells yet).
      u.x += Math.cos(u.angle) * step;
      u.y += Math.sin(u.angle) * step;
      u.vx = Math.cos(u.angle) * spd * 0.35;
      u.vy = Math.sin(u.angle) * spd * 0.35;
      u.aiState = "SEEK WATER";
      return;
    }
    if (u.aiTx == null || u.aiTy == null || Math.hypot((u.aiTx ?? 0) - u.x, (u.aiTy ?? 0) - u.y) < 40) {
      this.pickBoatWaypoint(u);
    }
    const hx = Math.cos(u.angle);
    const hy = Math.sin(u.angle);
    if (
      !isWater(this.world, u.x + hx * 36, u.y + hy * 36) ||
      !isWater(this.world, u.x + hx * 70, u.y + hy * 70) ||
      !isWater(this.world, u.x + hx * 110, u.y + hy * 110)
    ) {
      this.pickBoatWaypoint(u);
    }
    const steered = this.terrainSteer(u.x, u.y, u.aiTx ?? u.x, u.aiTy ?? u.y, true, u.angle);
    const want = Math.atan2(steered.y - u.y, steered.x - u.x);
    u.angle = Phaser.Math.Angle.RotateTo(u.angle, want, yaw * dt);
    const step = spd * dt;
    this.stepOnTerrain(u, Math.cos(u.angle) * step, Math.sin(u.angle) * step, true);
    u.vx = Math.cos(u.angle) * spd;
    u.vy = Math.sin(u.angle) * spd;
    u.aiState = "PATROL";
  }

  driveGroundVehicle(u: Unit, dt: number, h: Heli, dist: number): void {
    const d = driveOf(u.kind);
    const combat = specOf(u.kind).move === "tank";
    let drive = false;
    let wantX = u.x;
    let wantY = u.y;
    if (combat) {
      if (dist < 980 && h.phase === "flight") {
        u.orbit += 0.24 * dt;
        const ring = 350 + (u.id % 5) * 28;
        // Chase a lead point on the ring so we rarely sit on the waypoint
        // (atan2 thrash there looks like instant hull snaps).
        const lead = u.orbit + 0.55;
        wantX = h.x + Math.cos(lead) * ring;
        wantY = h.y + Math.sin(lead) * ring;
        drive = true;
        u.aiState = "ORBIT";
        u.aiTx = wantX;
        u.aiTy = wantY;
      } else {
        u.aiState = "IDLE";
        u.aiTx = undefined;
        u.aiTy = undefined;
      }
    } else if (dist < (u.kind === "motorcycle" ? 1200 : 520) && h.phase === "flight") {
      u.aware = true;
      const away = Math.atan2(u.y - h.y, u.x - h.x);
      wantX = u.x + Math.cos(away) * 240;
      wantY = u.y + Math.sin(away) * 240;
      drive = true;
      u.aiState = "FLEE";
      u.aiTx = wantX;
      u.aiTy = wantY;
    } else {
      u.aware = false;
      u.aiState = Math.hypot(u.vx, u.vy) > 8 ? "COAST" : "IDLE";
      u.aiTx = undefined;
      u.aiTy = undefined;
    }
    const wantSteer = this.steerGround(u, wantX, wantY);
    wantX = wantSteer.x;
    wantY = wantSteer.y;
    const twx = wantX - u.x;
    const twy = wantY - u.y;
    const twd = Math.hypot(twx, twy);
    const spd = Math.hypot(u.vx, u.vy);
    let want: number;
    if (twd < 42) {
      // Near chase point: don't use noisy atan2(ε,ε) — that flips want and snaps hull.
      if (combat && drive) want = Math.atan2(u.y - h.y, u.x - h.x) + Math.PI / 2;
      else if (spd > 6) want = Math.atan2(u.vy, u.vx);
      else want = u.angle;
    } else {
      want = Math.atan2(twy, twx);
    }
    const slow = 1 - Math.min(1, spd / Math.max(d.maxSpd, 1));
    const wheeled = d.track !== "tread";
    // Bikes can't pivot in place — need real forward speed, like trucks (trucks get it from low turn rate).
    const minTurnSpd = u.kind === "motorcycle" ? 24 : 7;
    const rim = this.mapEdgeWeight(u.x, u.y);
    // Rim unlock: containOnMap brakes outbound speed → minTurnSpd gate used to freeze turn forever.
    if (drive && (!wheeled || spd > minTurnSpd || rim > 0.28)) {
      const turnGate =
        wheeled && rim < 0.28 ? Phaser.Math.Clamp((spd - minTurnSpd) / 18, 0.15, 1) : 1;
      u.angle = Phaser.Math.Angle.RotateTo(
        u.angle,
        want,
        d.turn * (0.45 + 0.55 * slow) * turnGate * dt
      );
    }
    const nx = Math.cos(u.angle);
    const ny = Math.sin(u.angle);
    const align = drive ? Math.cos(Phaser.Math.Angle.Wrap(want - u.angle)) : 1;
    let a = -d.brake;
    if (drive && wheeled && spd <= minTurnSpd) a = d.accel;
    else if (drive && align > 0.2) a = d.accel * Phaser.Math.Clamp(align, 0.25, 1);
    else if (drive) a = -d.brake * 0.65;
    let vx = u.vx + nx * a * dt;
    let vy = u.vy + ny * a * dt;
    let fwd = vx * nx + vy * ny;
    if (fwd < 0) fwd *= 0.35;
    vx = nx * fwd;
    vy = ny * fwd;
    const s = Math.hypot(vx, vy);
    if (s > d.maxSpd) {
      vx *= d.maxSpd / s;
      vy *= d.maxSpd / s;
    }
    u.vx = vx;
    u.vy = vy;
    const trackX0 = u.x;
    const trackY0 = u.y;
    this.stepOnTerrain(u, vx * dt, vy * dt, false);
    this.separateGround(u);
    if (isWater(this.world, u.x, u.y)) {
      const seek = this.terrainSteer(u.x, u.y, u.x, u.y, false, u.angle);
      const sx = seek.x - u.x;
      const sy = seek.y - u.y;
      const sd = Math.hypot(sx, sy) || 1;
      this.stepOnTerrain(u, (sx / sd) * 10, (sy / sd) * 10, false);
    }
    const step = Math.hypot(u.vx, u.vy) * dt;
    if (Math.hypot(u.vx, u.vy) > 6 && !isWater(this.world, u.x, u.y)) {
      const printGap = d.trackGap * 0.8;
      const first = printGap - u.track;
      for (let dist = first; dist <= step; dist += printGap) {
        const t = step > 0 ? Phaser.Math.Clamp(dist / step, 0, 1) : 1;
        const key = `track_${d.track}`;
        const back = specOf(u.kind).radius * 0.72;
        this.stampWreck(
          this.textures.exists(key) ? key : "track",
          Phaser.Math.Linear(trackX0, u.x, t) - Math.cos(u.angle) * back,
          Phaser.Math.Linear(trackY0, u.y, t) - Math.sin(u.angle) * back,
          u.angle + Math.PI / 2,
          d.trackScale * 0.85,
          0.7
        );
      }
      u.track = (u.track + step) % printGap;
    }
  }

  updateUnits(dt: number): void {
    const h = this.heli;
    for (const u of this.units) {
      if (u.dead) continue;
      u.fireCd -= dt;
      const dx = h.x - u.x;
      const dy = h.y - u.y;
      const dist = Math.hypot(dx, dy);
      const sp = specOf(u.kind);
      u.muzzleT = Math.max(0, u.muzzleT - dt);
      if (sp.dish) u.rotor += 0.55 * dt;
      if (sp.rotors.length) u.rotor += (u.kind === "drone" ? 42 : 28) * dt;
      if (sp.move === "heli" || sp.move === "drone") {
        if (sp.move === "drone") this.driveDrone(u, dt, h, dist, dx, dy);
        else if (u.kind === "heli_small") this.driveScoutHeli(u, dt, h, dist, dx, dy);
        else this.driveOrbitHeli(u, dt, h, dist, dx, dy);
        if (u.dead) continue;
        const g = groundZ(this.world, u.x, u.y);
        const cruise = g + CRUISE_AGL + 10 + Math.sin(this.time.now * 0.002 + u.id) * 6;
        u.z = Phaser.Math.Linear(u.z, cruise, 1 - Math.pow(0.1, dt));
      } else {
        if (sp.move === "boat") this.driveBoat(u, dt);
        if (isGroundVehicle(u.kind)) {
          this.driveGroundVehicle(u, dt, h, dist);
        }
        if ((sp.move === "inf" || sp.move === "flee") && !this.snapHost(u)) {
          const canShoot = !!sp.weapon;
          if (sp.organic && u.health < u.max) {
            // Keep bleeding past the downed floor so they eventually expire quietly.
            const rate = u.health <= 1 ? 0.028 : 0.05;
            u.health -= u.max * rate * dt;
            if (u.health <= 0) {
              this.destroyUnit(u, true);
              continue;
            }
          }
          const seeR = 400;
          const screenR = this.scale.width / Math.max(this.cameras.main.zoom, 0.001);
          const wounded = u.health < u.max;
          const downed = sp.organic && wounded && u.health <= 1;
          if (downed) u.aiMood = undefined;
          else if (wounded && u.aiMood !== "flee") this.rollSoldierMood(u, true);
          else if (sp.move === "flee" && !u.aware && dist < seeR && h.phase === "flight") {
            u.aware = true;
            u.aiMood = "flee";
            u.moodT = 4;
          }
          if (!u.aware && dist < seeR && dist > 36 && h.phase === "flight") {
            u.aware = true;
            this.rollSoldierMood(u, wounded || !canShoot || Math.random() < 0.4);
          }
          if (u.aiMood) {
            u.moodT = (u.moodT ?? 0) - dt;
            if ((u.moodT ?? 0) <= 0) {
              if (wounded || (dist < seeR && dist > 36)) this.rollSoldierMood(u, wounded || !canShoot || u.aiMood === "kite");
              else {
                u.aware = false;
                u.aiMood = undefined;
              }
            }
          } else if (!wounded && (dist >= seeR || dist <= 36)) {
            u.aware = false;
          }
          const fleeing = !downed && u.aiMood === "flee";
          const kiting = canShoot && !downed && u.aiMood === "kite" && dist < seeR && dist > 36;
          if (downed) {
            u.turret = Phaser.Math.Angle.RotateTo(u.turret, Math.atan2(dy, dx), 1.8 * dt);
            u.aiState = (u.burstLeft ?? 0) > 0 ? "BURST" : "DOWN";
            u.aiTx = h.x;
            u.aiTy = h.y;
            if (u.track < -8) u.track = 0;
            u.track += dt;
            if (u.track > 0) {
              this.stampSoldierBlood(u, range(-4.5, 4.5), range(-4.5, 4.5), range(0, Math.PI * 2));
              u.track = -range(1.5, 3.4);
            }
          } else if (fleeing || kiting) {
            u.orbit += (fleeing ? 0.35 : 0.55) * dt;
            const away = Math.atan2(-dy, -dx);
            const ring = fleeing ? screenR : 250;
            const weave = fleeing ? 0.35 : 0.7;
            const ox = h.x + Math.cos(away + Math.sin(u.orbit) * weave) * ring;
            const oy = h.y + Math.sin(away + Math.sin(u.orbit) * weave) * ring;
            const steered = this.steerGround(u, ox, oy);
            const twx = steered.x - u.x;
            const twy = steered.y - u.y;
            const twd = Math.hypot(twx, twy);
            const want = twd < 12 ? u.angle : Math.atan2(twy, twx);
            // Invisible base faces / walks the path.
            u.angle = Phaser.Math.Angle.RotateTo(u.angle, want, (fleeing ? 2.4 : 2.1) * dt);
            const limp = fleeing && wounded && sp.organic;
            const gaitHz = limp ? 0.0044 : fleeing ? 0.0128 : 0.0075;
            const walk = Math.sin(this.time.now * gaitHz + u.id * 2.1);
            const gait = 0.22 + 0.78 * Math.pow(0.5 + 0.5 * walk, 1.45);
            const base = sp.move === "flee" && !sp.organic ? (u.kind === "officer" ? 36 : 90) : fleeing ? 78 : 58;
            const align = Math.max(0.15, Math.cos(Phaser.Math.Angle.Wrap(want - u.angle)));
            const step = (limp ? 22 : base) * gait * align * dt;
            this.stepOnTerrain(u, Math.cos(u.angle) * step, Math.sin(u.angle) * step, false);
            this.separateGround(u);
            if (isWater(this.world, u.x, u.y)) {
              const seek = this.terrainSteer(u.x, u.y, u.x, u.y, false, u.angle);
              const sx = seek.x - u.x;
              const sy = seek.y - u.y;
              const sd = Math.hypot(sx, sy) || 1;
              this.stepOnTerrain(u, (sx / sd) * 8, (sy / sd) * 8, false);
            }
            if (limp) {
              u.track += step;
              if (u.track > 0) {
                const side = walk > 0 ? 1 : -1;
                const px = -Math.sin(u.angle);
                const py = Math.cos(u.angle);
                this.stampSoldierBlood(
                  u,
                  px * range(2.2, 5.5) * side,
                  py * range(2.2, 5.5) * side,
                  u.angle + range(-0.35, 0.35)
                );
                u.track = -range(22, 48);
              }
            }
            u.aiState = fleeing ? "FLEE" : (u.burstLeft ?? 0) > 0 ? "BURST" : "KITE";
            u.aiTx = ox;
            u.aiTy = oy;
          } else {
            u.aiState = (u.burstLeft ?? 0) > 0 ? "BURST" : "IDLE";
            u.aiTx = undefined;
            u.aiTy = undefined;
          }
        }
        this.leashPinned(u);
        if (sp.move === "boat" && isWater(this.world, u.x, u.y)) {
          u.z = waterSurfaceZ();
        } else {
          u.z = groundZ(this.world, u.x, u.y);
        }
      }
      this.containOnMap(u, dt);
      const guns = gunsOf(u);
      if (guns.length) {
        for (let gi = 0; gi < guns.length; gi++) {
          const gp = this.gunMountPos(u, gi);
          const want = Math.atan2(h.y - gp.y, h.x - gp.x);
          const cur = u.turrets[gi] ?? 0;
          u.turrets[gi] = Phaser.Math.Angle.RotateTo(cur, want, 1.65 * dt);
        }
        u.turret = u.turrets[0] ?? u.turret;
      }
      const aim = Math.atan2(dy, dx);
      const gunI = guns.length ? u.muzzleGun % guns.length : 0;
      const wpn = guns[gunI]?.weapon ?? sp.weapon;
      const atkRange = wpn?.range ?? 0;
      const inRange = !!(atkRange && dist < atkRange && dist > 40 && h.phase === "flight");
      const hullFlee =
        (sp.move === "inf" && u.aiMood === "flee" && !(sp.organic && u.health <= 1) && !this.snapHost(u)) ||
        (u.kind === "heli_small" && u.aiMood === "flee");
      const strafeHeli = sp.move === "heli" && u.kind !== "heli_heavy";
      const softTurret = this.troopSoftTurret(u);
      if (softTurret) {
        // Aim like a turret: track player when engaging, otherwise point where the base is going.
        const aimTo =
          !hullFlee && (inRange || (u.burstLeft ?? 0) > 0 || (sp.organic && u.health <= 1 && u.health < u.max))
            ? aim
            : u.angle;
        u.turret = Phaser.Math.Angle.RotateTo(u.turret, aimTo, 2.4 * dt);
      } else if (sp.fixedAim && !guns.length && wpn && inRange && !hullFlee && !strafeHeli) {
        const turn = sp.move === "heli" ? 1.7 : 2.2;
        u.angle = Phaser.Math.Angle.RotateTo(u.angle, aim, turn * dt);
      }
      if (sp.building || sp.move === "static") {
        u.aiState = inRange ? "ENGAGE" : u.aiState ?? "IDLE";
        if (inRange) {
          u.aiTx = h.x + h.vx * 0.15;
          u.aiTy = h.y + h.vy * 0.15;
        }
      }
      const inf = sp.move === "inf";
      const soldierDown = inf && u.health <= 1 && u.health < u.max;
      const continueBurst =
        inf && (u.burstLeft ?? 0) > 0 && h.phase === "flight" && (soldierDown || u.aiMood !== "flee");
      const soldierFlee = inf && u.aiMood === "flee" && !soldierDown && !this.snapHost(u);
      const scoutFlee = u.kind === "heli_small" && u.aiMood === "flee";
      const aimFrom = guns.length ? this.gunMountPos(u, gunI) : { x: u.x, y: u.y };
      const gunAim = Math.atan2(h.y - aimFrom.y, h.x - aimFrom.x);
      const barrelAng = softTurret ? u.turret : !guns.length ? u.angle : (u.turrets[gunI] ?? u.turret);
      const facingOk = Math.abs(Phaser.Math.Angle.Wrap(gunAim - barrelAng)) < 0.16;
      if (wpn && u.fireCd <= 0 && !soldierFlee && !scoutFlee && facingOk && (inRange || continueBurst)) {
        const burstN = wpn.burst ?? 0;
        const fxInterval = burstN > 0 ? (wpn.burstGap ?? 0.075) : wpn.fireCd;
        if (burstN) {
          if (!u.burstLeft) u.burstLeft = burstN;
          u.burstLeft--;
          u.fireCd = u.burstLeft > 0 ? (wpn.burstGap ?? 0.075) : wpn.fireCd;
        } else {
          u.fireCd = wpn.fireCd;
        }
        const jitter = (Math.random() - 0.5) * (wpn.jitter ?? 0);
        const tipCount =
          guns[gunI]?.muzzles?.length || lookupSpriteMuzzles(textureOf(u.kind)).length || 1;
        const tipI = wpn.muzzleFire === "alternate" ? u.muzzleTip % tipCount : 0;
        u.muzzleFireTip = tipI;
        u.muzzleTip = tipI;
        const muzzle = this.enemyMuzzle(u, gunI);
        if (tipCount > 1 && wpn.muzzleFire === "alternate") {
          u.muzzleTip = (tipI + 1) % tipCount;
        }
        // Stay on the same gun for the whole burst so each mount keeps its own ammo type.
        if (guns.length > 1 && sp.gunFire === "alternate" && (u.burstLeft ?? 0) <= 0) {
          u.muzzleGun = (gunI + 1) % guns.length;
        }
        const fireAng = barrelAng + jitter;
        const muzzleZ = u.z + heightOf(u.kind) * 0.7 + ZOff.shot;
        const tgtZ = h.z + h.height * 0.5;
        // Flight time from post-nudge tip (spawnShot advances by SHOT_ORIGIN).
        const spawn = this.shotSpawnXY(muzzle.x, muzzle.y, fireAng, muzzleZ, wpn.look, wpn.scale);
        const shotDist = Math.max(40, Math.hypot(h.x - spawn.x, h.y - spawn.y));
        const t = Math.max(0.12, shotDist / wpn.speed);
        u.muzzleT = 0.07;
        u.muzzleJitS = range(0.9, 1.12);
        u.muzzleJitR = range(-0.1, 0.1);
        u.muzzleFrame = (Math.random() * FX_VARIANTS) | 0;
        const muzzleAt = worldToScreen(muzzle.x, muzzle.y, u.z);
        this.spawnMuzzleLight(
          muzzleAt.x,
          muzzleAt.y,
          u.z,
          (sp.organic ? 18 : 28) * muzzleAt.scale * (u.muzzleJitS ?? 1)
        );
        if (u.kind === "heli_small") {
          if (u.aiMood !== "flee") u.aiMood = "kite";
          if ((u.burstLeft ?? 0) <= 0) {
            u.strike = (u.strike ?? 0) + 1;
            if (u.strike >= 3) {
              u.aiMood = "flee";
              u.moodT = 2.6 + Math.random() * 0.8;
              u.strike = 0;
            }
          }
        }
        if (u.kind === "heli") {
          if (u.aiMood !== "flee") u.aiMood = "kite";
          if ((u.burstLeft ?? 0) <= 0) {
            u.strike = (u.strike ?? 0) + 1;
            if (u.strike >= 4) {
              u.aiMood = "flee";
              u.moodT = 1.8 + Math.random() * 0.6;
              u.strike = 0;
            }
          }
        }
        const home = wpn.kind === "lock-on-missile";
        this.spawnShot({
          kind: wpn.kind,
          from: "enemy",
          x: muzzle.x,
          y: muzzle.y,
          z: muzzleZ,
          vx: Math.cos(fireAng) * wpn.speed,
          vy: Math.sin(fireAng) * wpn.speed,
          vz: Phaser.Math.Clamp((tgtZ - muzzleZ) / t, -280, 420),
          angle: fireAng,
          life: t + 0.35,
          blast: wpn.blast,
          dmg: wpn.dmg,
          look: wpn.look,
          guided: false,
          homePlayer: home,
          motor: home ? -0.06 : undefined,
          scale: wpn.scale,
          fxInterval,
        });
        if (wpn.kind === "cannon") {
          const ejectAt = guns.length ? this.gunMountPos(u, gunI) : { x: u.x, y: u.y };
          const shellZ = sp.aerial
            ? u.z - 10
            : u.z + heightOf(u.kind) + 6;
          this.spawnShellEject({
            x: ejectAt.x,
            y: ejectAt.y,
            z: shellZ,
            barrelAng: fireAng,
            dmg: wpn.dmg,
            side: this.enemyShellEjectSide(u, gunI),
            aerial: !!sp.aerial,
            fireCd: (wpn.burst ?? 0) > 0 ? (wpn.burstGap ?? 0.075) : wpn.fireCd,
          });
        }
      }
      const sec = sp.secondary;
      if (sec?.mounts.length && (!sp.aerial || h.phase === "flight")) {
        const pw = sec.wpn;
        const minR = sec.minRange ?? 80;
        const aimCone = sec.aimCone ?? Math.PI / 2;
        if (dist < pw.range && dist > minR) {
          const aimErr = Math.abs(Phaser.Math.Angle.Wrap(Math.atan2(dy, dx) - u.angle));
          u.missileCd = (u.missileCd ?? (4 + Math.random() * 3)) - dt;
          if (u.missileCd <= 0 && aimErr < aimCone) {
            u.missileCd = sec.fireCdMin + Math.random() * (sec.fireCdMax - sec.fireCdMin);
            const mounts = sec.mounts;
            const side = (u.missileSide ?? 0) % mounts.length;
            const firingMounts = sec.mountFire === "simultaneous" ? mounts : [mounts[side]!];
            const fxInterval =
              ((sec.fireCdMin + sec.fireCdMax) * 0.5) / Math.max(1, firingMounts.length);
            if (sec.mountFire === "alternate") u.missileSide = side + 1;
            const pivot = spritePivot(textureOf(u.kind));
            const hullRot = u.angle + sp.rotOff;
            const hullImg = this.textures.exists(textureOf(u.kind))
              ? (this.textures.get(textureOf(u.kind)).getSourceImage() as { width: number; height: number })
              : { width: 64, height: 64 };
            const dw = hullImg.width;
            const dh = hullImg.height;
            for (const mount of firingMounts) {
              const mx = (mount.x - pivot.x) * dw;
              const my = (mount.y - pivot.y) * dh;
              const px = u.x + mx * Math.cos(hullRot) - my * Math.sin(hullRot);
              const py = u.y + mx * Math.sin(hullRot) + my * Math.cos(hullRot);
              const muzzleZ = u.z + heightOf(u.kind) * 0.5;
              const jit = pw.jitter ?? 0.04;
              const fireAng = u.angle + (Math.random() - 0.5) * jit;
              const tgtZ = h.z + h.height * 0.5;
              const spawn = this.shotSpawnXY(
                px,
                py,
                fireAng,
                muzzleZ,
                pw.look,
                pw.scale * (sec.scale ?? 1)
              );
              const missileT = Math.max(0.25, Math.hypot(h.x - spawn.x, h.y - spawn.y) / pw.speed);
              const home = sec.homePlayer !== false;
              this.spawnShot({
                kind: pw.kind,
                from: "enemy",
                x: px,
                y: py,
                z: muzzleZ,
                vx: Math.cos(fireAng) * pw.speed,
                vy: Math.sin(fireAng) * pw.speed,
                vz: Phaser.Math.Clamp((tgtZ - muzzleZ) / missileT, -280, 420),
                angle: fireAng,
                life: missileT + 1.5,
                blast: pw.blast,
                dmg: pw.dmg,
                look: pw.look,
                homePlayer: home,
                motor: sec.motor,
                scale: pw.scale * (sec.scale ?? 1),
                fxInterval,
              });
              this.missileMuzzle(px, py, u.z, fireAng, projectileFxScale("enemy", fxInterval));
            }
          }
        }
      }
    }
    if (this.perfEnabled) {
      const t = performance.now();
      this.syncUnitSprites();
      this.perfCurrent![4] = performance.now() - t;
    } else {
      this.syncUnitSprites();
    }
  }

  syncUnitSprites(): void {
    const SLOTS = 9;
    let liveN = 0;
    for (const u of this.units) if (!u.dead) liveN++;
    while (this.unitG.getLength() < liveN * SLOTS) {
      this.unitG.add(this.add.image(0, 0, "shadow"));
      this.unitG.add(this.add.image(0, 0, "enemy_tank"));
      for (let p = 0; p < 6; p++) this.unitG.add(this.add.image(0, 0, "enemy_heli_rotor"));
      const mz = this.add.image(0, 0, "fx_muzzle");
      mz.setBlendMode(Phaser.BlendModes.ADD);
      this.unitG.add(mz);
    }
    const kids = this.unitG.getChildren() as Phaser.GameObjects.Image[];
    for (let i = 0; i < kids.length; i++) {
      const k = kids[i]!;
      k.setVisible(false);
      const wrap = k.getData("tiltWrap") as Phaser.GameObjects.Container | undefined;
      if (wrap) wrap.setVisible(false);
    }
    let slot = 0;
    for (const u of this.units) {
      if (u.dead) continue;
      const i = slot++;
      if (!cameraPointVisible(u.z, u.y)) continue;
      const sp = specOf(u.kind);
      const guns = gunsOf(u);
      const sh = kids[i * SLOTS]!;
      const im = kids[i * SLOTS + 1]!;
      const partBase = i * SLOTS + 2;
      const flash = kids[i * SLOTS + 8]!;
      const tex = resolveSkin(this.textures, textureOf(u.kind), u.camo);
      const rot = this.troopDrawAng(u) + sp.rotOff;
      const scr = worldToScreen(u.x, u.y, u.z);
      const scrX = scr.x;
      const scrY = scr.y;
      if (!this.projectedInView(scrX, scrY, 220)) continue;
      const drawRot = projectHeading(rot, u.x, u.y, u.z);
      const zs = scr.scale;
      const pivot = spritePivot(textureOf(u.kind));
      const ox = pivot.x;
      const oy = pivot.y;
      const zBias = u.pinId != null ? ZOff.posted : 0;
      const bodyDepth = worldDepth(u.z, ZOff.body + zBias, u.y);
      sh.setVisible(true).setOrigin(ox, oy);
      this.applyCastShadow(
        sh,
        u.x,
        u.y,
        u.z,
        tex,
        rot,
        sp.aerial ? 1 : 0.92,
        sp.aerial ? 2 : sp.building ? 8 : 1,
        u
      );
      im.setVisible(true);
      if (im.texture.key !== tex) im.setTexture(tex);
      im.setOrigin(ox, oy)
        .setPosition(scrX, scrY)
        .setRotation(drawRot);
      if (im.depth !== bodyDepth) im.setDepth(bodyDepth);
      if (isGroundVehicle(u.kind)) {
        // Cheap pitch approx: squash hull length by slope along facing (same groundSlope sample as before).
        const sl = groundSlope(this.world, u.x, u.y);
        const grade = Phaser.Math.Clamp(sl.dx * Math.cos(u.angle) + sl.dy * Math.sin(u.angle), -0.4, 0.4);
        im.setScale((1 + Math.abs(grade) * 0.05) * zs, (1 - grade * 0.12) * zs);
      } else im.setScale(zs);
      if (sp.building) clearEdgeLight(im);
      else applyEdgeLight(im, drawRot);
      let pi = 0;
      const gunDepth = sp.move === "heli" ? ZOff.gun : ZOff.turret;
      const place = (
        part: Phaser.GameObjects.Image,
        texKey: string,
        origin: { x: number; y: number },
        mount: { x: number; y: number },
        worldRot: number,
        depth: number,
        sc = 1,
        edgeLit = false
      ) => {
        if (!this.textures.exists(texKey)) return;
        this.unwrapTilt(part);
        const mx = (mount.x - ox) * im.displayWidth;
        const my = (mount.y - oy) * im.displayHeight;
        const partRot = texKey.includes("rotor")
          ? worldRot
          : projectHeading(worldRot, u.x, u.y, u.z);
        const pd = worldDepth(u.z, depth + zBias, u.y);
        part.setVisible(true);
        if (part.texture.key !== texKey) part.setTexture(texKey);
        part
          .setOrigin(origin.x, origin.y)
          .setPosition(
            im.x + mx * Math.cos(drawRot) - my * Math.sin(drawRot),
            im.y + mx * Math.sin(drawRot) + my * Math.cos(drawRot)
          )
          .setRotation(partRot)
          .setAlpha(1)
          .setScale(im.scaleX * sc, im.scaleY * sc);
        if (part.depth !== pd) part.setDepth(pd);
        if (edgeLit && !sp.building) applyEdgeLight(part, partRot);
        else clearEdgeLight(part);
      };
      guns.forEach((g, gi) => {
        const part = kids[partBase + pi++];
        if (!part) return;
        const gorig = lookupSpriteOrigin(g.tex) ?? g.origin;
        const gmount = g.mount;
        place(
          part,
          resolveSkin(this.textures, g.tex, u.camo),
          gorig,
          gmount,
          gunWorldRot(g.tex, u.turrets[gi] ?? u.turret),
          gunDepth,
          g.scale ?? 1,
          true
        );
      });
      sp.rotors.forEach((r, ri) => {
        const part = kids[partBase + pi++];
        if (!part) return;
        const spinKey = `${r.tex}_spin`;
        const rotorKey =
          r.tex !== "enemy_drone_rotor" && this.textures.exists(spinKey) ? spinKey : r.tex;
        place(part, rotorKey, r.origin, r.mount, ri % 2 ? -u.rotor : u.rotor, ZOff.rotor, r.scale ?? 1);
        if (r.tex.includes("rotor")) {
          const px = this.liveRotorDrawPx(r.tex, r.scale ?? 1);
          part.setScale((px / Math.max(part.width, 1)) * zs);
        }
      });
      if (sp.dish) {
        const part = kids[partBase + pi++];
        if (part && this.textures.exists(sp.dish.tex)) {
          const d = sp.dish;
          const mx = (d.mount.x - ox) * im.displayWidth;
          const my = (d.mount.y - oy) * im.displayHeight;
          const px = im.x + mx * Math.cos(drawRot) - my * Math.sin(drawRot);
          const py = im.y + mx * Math.sin(drawRot) + my * Math.cos(drawRot);
          const sc = d.scale ?? 1;
          let wrap = part.getData("tiltWrap") as Phaser.GameObjects.Container | undefined;
          if (!wrap || !wrap.scene) {
            wrap = this.add.container(px, py);
            wrap.add(part);
            part.setData("tiltWrap", wrap);
          }
          const dishDepth = worldDepth(u.z, ZOff.turret + zBias, u.y);
          wrap
            .setVisible(true)
            .setPosition(px, py)
            .setScale(im.scaleX * sc * 1.04, im.scaleY * sc * 0.52)
            .setRotation(u.rotor);
          if (wrap.depth !== dishDepth) wrap.setDepth(dishDepth);
          part.setVisible(true);
          if (part.texture.key !== d.tex) part.setTexture(d.tex);
          part
            .setOrigin(d.origin.x, d.origin.y)
            .setPosition(0, 0)
            .setRotation(0)
            .setAlpha(1)
            .setScale(1);
          clearEdgeLight(part);
        }
      }
      if (u.muzzleT > 0 && (sp.weapon || guns.length)) {
        const tip = this.enemyMuzzle(u, u.muzzleGun);
        const ang = this.troopSoftTurret(u)
          ? u.turret
          : !guns.length
            ? u.angle
            : u.turrets[u.muzzleGun] ?? u.turret;
        const jitS = u.muzzleJitS ?? 1;
        const jitR = u.muzzleJitR ?? 0;
        const tipScr = worldToScreen(tip.x, tip.y, u.z);
        const flashDepth = worldDepth(u.z, gunDepth + 0.4 + zBias, u.y);
        flash.setVisible(true);
        if (flash.texture.key !== "fx_muzzle") flash.setTexture("fx_muzzle");
        flash
          .setFrame(u.muzzleFrame ?? 0)
          .setBlendMode(Phaser.BlendModes.ADD)
          .setTint(0xfff6d0)
          .setOrigin(0.15, 0.5)
          .setPosition(tipScr.x, tipScr.y)
          .setRotation(projectHeading(ang + jitR, tip.x, tip.y, u.z))
          .setScale((sp.organic ? 0.7 : 1.15) * zs * jitS)
          .setAlpha(Phaser.Math.Clamp(u.muzzleT / 0.07, 0, 1));
        if (flash.depth !== flashDepth) flash.setDepth(flashDepth);
        clearEdgeLight(flash);
      }
    }
  }

  enemyMuzzle(u: Unit, gunI = 0): { x: number; y: number } {
    const sp = specOf(u.kind);
    const guns = gunsOf(u);
    const wpn = guns[gunI]?.weapon ?? sp.weapon;
    const gun = guns[gunI];
    const hullRot = this.troopDrawAng(u) + sp.rotOff;
    const hullPivot = spritePivot(textureOf(u.kind));
    const hullImg = this.textures.get(resolveSkin(this.textures, textureOf(u.kind), u.camo)).getSourceImage() as {
      width: number;
      height: number;
    };
    const atUv = (
      origin: { x: number; y: number },
      uv: { x: number; y: number },
      tw: number,
      th: number,
      x: number,
      y: number,
      rot: number
    ) => {
      const lx = (uv.x - origin.x) * tw;
      const ly = (uv.y - origin.y) * th;
      return { x: x + lx * Math.cos(rot) - ly * Math.sin(rot), y: y + lx * Math.sin(rot) + ly * Math.cos(rot) };
    };
    if (!gun || !wpn) {
      const bodyTips = lookupSpriteMuzzles(textureOf(u.kind));
      if (bodyTips.length) {
        const tipIdx =
          u.muzzleT > 0 && u.muzzleFireTip != null ? u.muzzleFireTip : u.muzzleTip;
        const muz = bodyTips[tipIdx % bodyTips.length]!;
        return atUv(hullPivot, muz, hullImg.width, hullImg.height, u.x, u.y, hullRot);
      }
      return { x: u.x, y: u.y };
    }
    const origin = lookupSpriteOrigin(gun.tex) ?? gun.origin;
    const mount = gun.mount;
    const dw = hullImg.width;
    const dh = hullImg.height;
    const mx = (mount.x - hullPivot.x) * dw;
    const my = (mount.y - hullPivot.y) * dh;
    const hx = u.x + mx * Math.cos(hullRot) - my * Math.sin(hullRot);
    const hy = u.y + mx * Math.sin(hullRot) + my * Math.cos(hullRot);
    const gtex = this.textures.exists(gun.tex)
      ? (this.textures.get(gun.tex).getSourceImage() as { width: number; height: number })
      : { width: 24, height: 48 };
    const tips = muzzlesOfGun(gun);
    const tipIdx =
      u.muzzleT > 0 && u.muzzleFireTip != null ? u.muzzleFireTip : u.muzzleTip;
    const muz = tips[tipIdx % tips.length]!;
    const ga = gunWorldRot(gun.tex, u.turrets[gunI] ?? u.turret);
    const gsc = gun.scale ?? 1;
    return atUv(origin, muz, gtex.width * gsc, gtex.height * gsc, hx, hy, ga);
  }

  syncShotSprites(): void {
    while (this.shotG.getLength() < this.shots.length * 2) {
      this.shotG.add(this.add.image(0, 0, "shadow"));
      this.shotG.add(this.add.image(0, 0, "shot_chain"));
    }
    const kids = this.shotG.getChildren() as Phaser.GameObjects.Image[];
    for (const k of kids) k.setVisible(false);
    this.shots.forEach((s, i) => {
      const sh = kids[i * 2]!;
      const im = kids[i * 2 + 1]!;
      if (!cameraPointVisible(s.z, s.y)) return;
      const key = shotLookOf(s);
      const rot = s.angle;
      const at = worldToScreen(s.x, s.y, s.z);
      const drawX = at.x;
      const drawY = at.y;
      if (!this.projectedInView(drawX, drawY, 120)) return;
      const drawRot = Math.atan2(
        screenVelY(s.vy, s.vz, s.z, s.y),
        screenVelX(s.vx, s.vy, s.vz, s.x, s.y, s.z)
      );
      const ox = SHOT_ORIGIN.x;
      const sc = s.scale ?? 1;
      const zs = at.scale;
      // Foreshorten along the barrel when climbing/diving (non-zero vz).
      const horiz = Math.hypot(s.vx, s.vy);
      const pitchN = Phaser.Math.Clamp(Math.abs(s.vz) / Math.max(90, Math.hypot(horiz, s.vz)), 0, 1);
      const along = 1 - pitchN * 0.52;
      const across = 1 + pitchN * 0.06;
      sh.setVisible(true).setOrigin(ox, 0.5);
      this.applyCastShadow(sh, s.x, s.y, s.z, key, rot, sc);
      const shotDepth = worldDepth(s.z, 0, s.y);
      im.setVisible(true);
      if (im.texture.key !== key) im.setTexture(key);
      im.setOrigin(ox, 0.5)
        .setPosition(drawX, drawY)
        .setRotation(drawRot)
        .setScale(sc * zs * along, sc * zs * across)
        .setAlpha(1);
      if (im.depth !== shotDepth) im.setDepth(shotDepth);
    });
  }

  syncDebrisSprites(): void {
    let visN = 0;
    for (const f of this.debris) if (!f.trailOnly) visN++;
    while (this.debrisG.getLength() < visN * 2) {
      this.debrisG.add(this.add.image(0, 0, "shadow"));
      this.debrisG.add(this.add.image(0, 0, "fx_debris_metal"));
    }
    const kids = this.debrisG.getChildren() as Phaser.GameObjects.Image[];
    for (const k of kids) {
      k.setVisible(false);
      const wrap = k.getData("tiltWrap") as Phaser.GameObjects.Container | undefined;
      if (wrap) wrap.setVisible(false);
    }
    let vi = 0;
    for (const f of this.debris) {
      if (f.trailOnly) continue;
      const i = vi++;
      const sh = kids[i * 2]!;
      const im = kids[i * 2 + 1]!;
      if (!cameraPointVisible(f.z || 0, f.y)) continue;
      const z = f.z || 0;
      const at = worldToScreen(f.x, f.y, z);
      const drawX = at.x;
      const drawY = at.y;
      if (!this.projectedInView(drawX, drawY, 180)) continue;
      const { x: ox, y: oy } = spritePivot(f.key);
      const sc = (f.scale ?? 1) * at.scale;
      let sx = sc;
      let sy = sc;
      if (f.dishFlat) {
        sx = sc * 1.04;
        sy = sc * 0.52;
      } else if (f.rotorSkew) {
        sx = sc * 1.08;
        sy = sc * 0.78;
      }
      const cast = castZ(this.world, f.x, f.y, z);
      // Pinned rotors skip shadows (stay with hull). Thrown rotors / gun hulks need a baked atlas.
      const canShadow =
        !f.pinHost && !f.boatSink && !f.shellEject && this.textures.exists(shadowKey(f.key, cast));
      const depth = f.settled
        ? Layer.WRECK
        : f.shellEject
          ? worldDepth(z, f.shellUnder ? ZOff.shot - 0.4 : ZOff.turret + 0.85, f.y)
          : worldDepth(z, ZOff.body + (f.pinHost ? 0.55 : 0.35), f.y);
      const spd = Math.hypot(f.vx, f.vy);
      // Squash along travel; inner image keeps f.angle spin relative to heading.
      const wheelSquash = !!f.wheelRoll && !f.settled && spd > 8;
      if (wheelSquash) {
        const travelWorld = Math.atan2(f.vy, f.vx);
        const travel = projectHeading(travelWorld, f.x, f.y, z);
        const t = Phaser.Math.Clamp((spd - 8) / 160, 0, 1);
        // Squash perpendicular to travel (narrow across, slightly longer along).
        const along = Phaser.Math.Linear(1.04, 1.2, t);
        const across = Phaser.Math.Linear(0.9, 0.66, t);
        let wrap = im.getData("tiltWrap") as Phaser.GameObjects.Container | undefined;
        if (!wrap || !wrap.scene) {
          wrap = this.add.container(drawX, drawY);
          wrap.add(im);
          im.setData("tiltWrap", wrap);
        }
        wrap
          .setVisible(true)
          .setPosition(drawX, drawY)
          .setRotation(travel)
          .setScale(sc * along, sc * across)
          .setAlpha(1);
        if (wrap.depth !== depth) wrap.setDepth(depth);
        im.setVisible(true);
        if (im.texture.key !== f.key) im.setTexture(f.key);
        im.setOrigin(ox, oy)
          .setPosition(0, 0)
          .setRotation(f.angle - travel)
          .setScale(1)
          .setAlpha(1);
        if (canShadow) {
          sh.setVisible(true).setOrigin(ox, oy);
          this.applyCastShadow(sh, f.x, f.y, z, f.key, travel, f.scale ?? 1, 2, f);
          sh.setScale(sh.scaleX * along, sh.scaleY * across);
          if (cast < 1) sh.setAlpha(0.22);
        }
        continue;
      }
      // Rotor hulks: fixed foreshortened tilt plane; blades spin inside the wrap.
      if (f.rotorSkew && !f.settled) {
        const skew = f.skewAng ?? 0.28;
        const along = 1.08;
        const across = 0.78;
        let wrap = im.getData("tiltWrap") as Phaser.GameObjects.Container | undefined;
        if (!wrap || !wrap.scene) {
          wrap = this.add.container(drawX, drawY);
          wrap.add(im);
          im.setData("tiltWrap", wrap);
        }
        wrap
          .setVisible(true)
          .setPosition(drawX, drawY)
          .setRotation(skew)
          .setScale(sc * along, sc * across)
          .setAlpha(1);
        if (wrap.depth !== depth) wrap.setDepth(depth);
        im.setVisible(true);
        if (im.texture.key !== f.key) im.setTexture(f.key);
        im.setOrigin(ox, oy)
          .setPosition(0, 0)
          .setRotation(f.angle - skew)
          .setScale(1)
          .setAlpha(1);
        if (canShadow) {
          sh.setVisible(true).setOrigin(ox, oy);
          this.applyCastShadow(sh, f.x, f.y, z, f.key, skew, f.scale ?? 1, 2, f);
          sh.setScale(sh.scaleX * along, sh.scaleY * across);
          if (cast < 1) sh.setAlpha(0.22);
        }
        continue;
      }
      this.unwrapTilt(im);
      if (canShadow) {
        sh.setVisible(true).setOrigin(ox, oy);
        this.applyCastShadow(sh, f.x, f.y, z, f.key, f.angle, f.scale ?? 1, 2, f);
        if (f.dishFlat) sh.setScale(sh.scaleX * 1.04, sh.scaleY * 0.52);
        if (f.rotorSkew) sh.setScale(sh.scaleX * 1.08, sh.scaleY * 0.78);
        if (cast < 1) sh.setAlpha(0.22);
      }
      const sinkU =
        f.boatSink && !f.settled
          ? Phaser.Math.Clamp((f.sinkT ?? 0) / Math.max(0.5, f.sinkMax ?? 6), 0, 1)
          : -1;
      im.clearTint();
      im.setVisible(true);
      if (im.texture.key !== f.key) im.setTexture(f.key);
      im.setOrigin(ox, oy)
        .setPosition(drawX, drawY)
        .setRotation(projectHeading(f.angle, f.x, f.y, z))
        .setScale(sx, sy)
        .setAlpha(
          f.settled ? 0.92 : sinkU >= 0 ? Phaser.Math.Linear(0.92, 0.78, sinkU * sinkU) : 1
        );
      if (im.depth !== depth) im.setDepth(depth);
    }
  }

  rebuildUnitIdMap(): void {
    const map = this.unitIdMap;
    map.clear();
    for (const u of this.units) {
      if (!u.dead) map.set(u.id, u);
    }
  }

  unitById(id: number): Unit | undefined {
    const u = this.unitIdMap.get(id);
    return u && !u.dead ? u : undefined;
  }

  tickHellfireLock(dt: number, ptr: { x: number; y: number }): void {
    const h = this.heli;
    if (h.hellfireLock && !this.unitById(h.hellfireLock.id)) h.hellfireLock = null;
    if (h.hellfireSeek && !this.unitById(h.hellfireSeek.id)) h.hellfireSeek = null;

    if (this.loadout[h.weapon]!.kind !== "lock-on-missile") return;

    const tgt = this.hellfirePickTarget(ptr.x, ptr.y, 160);
    if (!tgt || (h.hellfireLock && tgt.id === h.hellfireLock.id)) {
      h.hellfireSeek = null;
      return;
    }
    if (!h.hellfireSeek || h.hellfireSeek.id !== tgt.id) {
      h.hellfireSeek = { id: tgt.id, t: 0 };
    } else {
      h.hellfireSeek.t += dt;
      if (h.hellfireSeek.t >= HELLFIRE_LOCK_T) {
        h.hellfireLock = { id: h.hellfireSeek.id };
        h.hellfireSeek = null;
      }
    }
  }

  lockBoxHalf(u: Unit, scale: number): number {
    return (radius(u.kind) + 10) * scale * zScale(u.z, u.y);
  }

  drawLockBox(
    u: Unit,
    scale: number,
    width: number,
    alpha: number,
    color = 0xff3a22
  ): { x: number; y: number; half: number; depth: number } {
    const g = this.lockGfx;
    const at = worldToScreen(u.x, u.y, u.z);
    const x = at.x;
    const y = at.y;
    const half = this.lockBoxHalf(u, scale);
    const depth = worldDepth(u.z, 8, u.y);
    g.lineStyle(width, color, alpha);
    g.strokeRect(x - half, y - half, half * 2, half * 2);
    return { x, y, half, depth };
  }

  drawLockDiamond(
    u: Unit,
    scale: number,
    width: number,
    alpha: number,
    color: number
  ): { x: number; y: number; half: number; depth: number } {
    const g = this.lockGfx;
    const at = worldToScreen(u.x, u.y, u.z);
    const x = at.x;
    const y = at.y;
    const half = this.lockBoxHalf(u, scale);
    const depth = worldDepth(u.z, 8, u.y);
    g.lineStyle(width, color, alpha);
    g.beginPath();
    g.moveTo(x, y - half);
    g.lineTo(x + half, y);
    g.lineTo(x, y + half);
    g.lineTo(x - half, y);
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
    return { x, y, half, depth };
  }

  inboundHellfireTargets(): Unit[] {
    const seen = new Set<number>();
    const out: Unit[] = [];
    for (const s of this.shots) {
      if (s.kind !== "lock-on-missile" || s.from !== "player" || s.targetId == null) continue;
      if (seen.has(s.targetId)) continue;
      const u = this.unitById(s.targetId);
      if (!u) continue;
      seen.add(s.targetId);
      out.push(u);
    }
    return out;
  }

  updateLock(): void {
    const h = this.heli;
    const g = this.lockGfx;
    g.clear();
    this.lockSpr.setVisible(false);
    this.lockArrowGfx.clear();
    this.lockHudTxt.setVisible(false);
    this.lockInbdHudTxt.setVisible(false);
    this.lockTxt.setVisible(false);
    this.lockInbdTxt.setVisible(false);

    const hellfire = this.loadout[h.weapon]!.kind === "lock-on-missile";
    const inbound = this.inboundHellfireTargets();
    const locked = hellfire && h.hellfireLock ? this.unitById(h.hellfireLock.id) : undefined;
    const seeking = hellfire && h.hellfireSeek ? this.unitById(h.hellfireSeek.id) : undefined;
    if (!locked && !seeking && inbound.length === 0) {
      g.setVisible(false);
      return;
    }

    g.setVisible(true);
    let lockDepth: number = Layer.FIELD;
    const inboundIds = new Set(inbound.map((u) => u.id));
    let inbdLabeled = false;

    for (const u of inbound) {
      const vis = this.unitOnHud(u);
      if (vis.on) {
        const box = this.drawLockDiamond(u, 1.18, 2.1, 0.92, 0xffb020);
        lockDepth = Math.max(lockDepth, box.depth);
        if (!inbdLabeled) {
          inbdLabeled = true;
          this.lockInbdTxt
            .setVisible(true)
            .setPosition(box.x, box.y - box.half - 4)
            .setDepth(box.depth)
            .setAlpha(0.95)
            .setScale(zScale(u.z, u.y));
        }
      } else {
        this.drawLockOffscreen(vis.sx, vis.sy, 0xffb020, this.lockInbdHudTxt, 0.95);
      }
    }

    if (seeking) {
      const vis = this.unitOnHud(seeking);
      if (vis.on) {
        const t = Math.min(1, h.hellfireSeek!.t / HELLFIRE_LOCK_T);
        const scale = 2 - t;
        const box = this.drawLockBox(seeking, scale, 1.6, 0.72 + t * 0.22);
        lockDepth = Math.max(lockDepth, box.depth);
      }
    }
    if (locked && !inboundIds.has(locked.id)) {
      const vis = this.unitOnHud(locked);
      const blink = Math.floor(this.time.now / 70) % 2 === 0;
      const alpha = blink ? 1 : 0.12;
      if (vis.on) {
        const box = this.drawLockBox(locked, 1, 2.15, alpha);
        lockDepth = Math.max(lockDepth, box.depth);
        this.lockTxt
          .setVisible(true)
          .setPosition(box.x, box.y - box.half - 4)
          .setDepth(lockDepth)
          .setAlpha(alpha)
          .setScale(zScale(locked.z, locked.y));
      } else {
        this.drawLockOffscreen(vis.sx, vis.sy, 0xff3a22, this.lockHudTxt, alpha);
      }
    }
    g.setDepth(lockDepth);
  }

  drawLockOffscreen(
    sx: number,
    sy: number,
    color: number,
    txt: Phaser.GameObjects.Text,
    alpha: number
  ): void {
    const g = this.lockArrowGfx;
    const w = this.scale.width;
    const hgt = this.scale.height;
    const pad = 36;
    const cx = w / 2;
    const cy = hgt / 2;
    const ang = Math.atan2(sy - cy, sx - cx);
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
    const lp = this.hudLocal(lx, ly);
    txt.setVisible(true).setPosition(lp.x, lp.y).setAlpha(alpha).setRotation(0).setColor(
      color === 0xffb020 ? "#ffb020" : "#ff3a22"
    );
  }

  /** Phaser world point under the cursor (projected draw space). */
  private ptrScrOut = { x: 0, y: 0 };
  private ptrWorldOut = { x: 0, y: 0 };

  pointerScreen(): { x: number; y: number } {
    const frame = this.game.loop.frame;
    if (this.ptrFrame !== frame) {
      this.ptrFrame = frame;
      this.ptrWorldReady = false;
      const p = this.input.activePointer;
      const pt = this.cameras.main.getWorldPoint(p.x, p.y);
      this.ptrScrX = pt.x;
      this.ptrScrY = pt.y;
    }
    this.ptrScrOut.x = this.ptrScrX;
    this.ptrScrOut.y = this.ptrScrY;
    return this.ptrScrOut;
  }

  /** Cursor unprojected onto the height map (sim / aim space). */
  worldPointer(): { x: number; y: number } {
    const scr = this.pointerScreen();
    if (!this.ptrWorldReady) {
      const w = screenToWorldOnGround(this.world, scr.x, scr.y);
      this.ptrWorldX = w.x;
      this.ptrWorldY = w.y;
      this.ptrWorldReady = true;
    }
    this.ptrWorldOut.x = this.ptrWorldX;
    this.ptrWorldOut.y = this.ptrWorldY;
    return this.ptrWorldOut;
  }

  hellfirePickTarget(x: number, y: number, max: number): Unit | undefined {
    let best: Unit | undefined;
    let bestScore = Infinity;
    for (const u of this.units) {
      if (u.dead) continue;
      const d = Math.hypot(u.x - x, u.y - y);
      if (d > max) continue;
      const score = d / (1 + u.max / 24);
      if (score < bestScore) {
        bestScore = score;
        best = u;
      }
    }
    return best;
  }

  unitOnHud(u: Unit, pad = 36): { on: boolean; sx: number; sy: number } {
    const cam = this.cameras.main;
    const view = cam.worldView;
    const w = this.scale.width;
    const h = this.scale.height;
    const at = worldToScreen(u.x, u.y, u.z);
    const sx = ((at.x - view.x) / view.width) * w;
    const sy = ((at.y - view.y) / view.height) * h;
    const on = sx > pad && sx < w - pad && sy > pad && sy < h - pad;
    return { on, sx, sy };
  }

  nearestUnit(x: number, y: number, max: number): Unit | undefined {
    let best: Unit | undefined;
    let bd = max;
    for (const u of this.units) {
      if (u.dead) continue;
      const d = Math.hypot(u.x - x, u.y - y);
      if (d < bd) {
        bd = d;
        best = u;
      }
    }
    return best;
  }

  /** Pick aerial under the cursor in projected screen space. */
  hoverAerial(): Unit | undefined {
    const pt = this.pointerScreen();
    let best: Unit | undefined;
    let bd = 58;
    for (const u of this.units) {
      if (u.dead) continue;
      if (castZ(this.world, u.x, u.y, u.z) < 16 && !isAerial(u.kind)) continue;
      if (!cameraPointVisible(u.z, u.y)) continue;
      const at = worldToScreen(u.x, u.y, u.z);
      const d = Math.hypot(at.x - pt.x, at.y - pt.y);
      if (d < bd) {
        bd = d;
        best = u;
      }
    }
    return best;
  }

  /** Unit under reticle (footprint tested in projected screen space). */
  reticleUnit(): Unit | undefined {
    const pt = this.pointerScreen();
    let best: Unit | undefined;
    let bd = Infinity;
    const hit = { x: 0, y: 0, z: 0 };
    for (const u of this.units) {
      if (u.dead) continue;
      if (!cameraPointVisible(u.z, u.y)) continue;
      const at = worldToScreen(u.x, u.y, u.z);
      screenToWorldAtZ(pt.x, pt.y, u.z, hit);
      const fp = footprintOf(u, 12 / Math.max(at.scale, 0.01));
      if (!pointInFootprint(hit.x, hit.y, fp)) continue;
      const d = Math.hypot(at.x - pt.x, at.y - pt.y);
      if (d < bd) {
        bd = d;
        best = u;
      }
    }
    return best;
  }

  unitHudName(u: Unit): string {
    if (u.hv) {
      const site = this.world.hv.find((h) => h.id === u.hv);
      if (site) return site.name.toUpperCase();
    }
    return labelOf(u.kind);
  }

  drawHud(): void {
    const h = this.heli;
    const w = this.loadout[h.weapon]!;
    const ammo = this.ammo[h.weapon]!;
    const ammoS = this.infAmmo && Number.isFinite(ammo) ? "∞" : Number.isFinite(ammo) ? String(ammo) : "∞";
    const phase =
      h.phase === "grounded" || h.phase === "spool"
        ? h.spec.rotor
          ? "SPOOLING ROTORS"
          : "ENGINE START"
        : h.phase === "ready"
          ? "READY"
          : h.phase === "dead"
            ? "DOWN"
            : "AIRBORNE";
    const ptr = this.worldPointer();
    const elv = groundZ(this.world, ptr.x, ptr.y) | 0;
    const over = this.reticleUnit();
    const overLine = over ? `\n${this.unitHudName(over)}` : "";
    this.hud.setText(
      `ALT ${castZ(this.world, h.x, h.y, h.z) | 0}   ELV ${elv}   SPD ${Math.hypot(h.vx, h.vy) | 0}   TIME ${this.timeScale.toFixed(2)}×\n${phase}\nWPN ${w.name}  ${ammoS}${overLine}`
    );
    this.syncLiftPrompt();

    const lines = this.world.hv.map((spec) => this.hvLine(spec));
    const left = lines.filter((l) => !l.done).length;
    this.hvHud.setColor("#e8b84a").setText(`HV TARGETS  ${this.world.hv.length - left}/${this.world.hv.length}`);
    for (let i = 0; i < this.hvRows.length; i++) {
      const row = this.hvRows[i]!;
      const line = lines[i];
      if (!line) {
        row.setVisible(false);
        continue;
      }
      row.setVisible(this.hvHud.visible);
      row.setText(line.text);
      if (line.done) row.setColor("#6a8a62").setAlpha(0.82);
      else row.setColor("#ff3a22").setAlpha(1);
    }
    this.drawWeaponHud();
  }

  syncFpsHud(): void {
    if (!this.fpsHud) return;
    const now = this.time.now;
    if (now - this.fpsHudAt < 200) return;
    this.fpsHudAt = now;
    const fps = Math.round(this.game.loop.actualFps);
    this.fpsHud.setText(`${fps} FPS`);
    this.fpsHud.setColor(fps >= 55 ? "#6dbb4a" : fps >= 30 ? "#e8b84a" : "#ff3a22");
  }

  togglePerfMeasurements(): void {
    this.perfEnabled = !this.perfEnabled;
    if (!this.perfEnabled) {
      this.perfHud.setVisible(false);
      this.perfCopyKeyAt = -Infinity;
      this.syncDebugMenu();
      return;
    }
    this.resetPerfMeasurements();
    this.syncDebugMenu();
  }

  resetPerfMeasurements(): void {
    this.perfSamples ??= PERF_LABELS.map(() => new Float32Array(PERF_WINDOW));
    this.perfCurrent ??= new Float64Array(PERF_LABELS.length);
    this.perfSort ??= new Float32Array(PERF_WINDOW);
    for (const samples of this.perfSamples) samples.fill(0);
    this.perfCurrent.fill(0);
    this.perfSampleCount = 0;
    this.perfSampleWrite = 0;
    this.perfHudAt = 0;
    this.perfCopyNoticeUntil = 0;
    this.perfCopyKeyAt = -Infinity;
    this.perfHud.setVisible(true).setText("PERFORMANCE\nwarming up…");
  }

  handlePerfKey(): void {
    if (!this.perfEnabled) {
      this.togglePerfMeasurements();
      return;
    }
    const now = performance.now();
    if (now - this.perfCopyKeyAt < 900) {
      this.togglePerfMeasurements();
      return;
    }
    this.perfCopyKeyAt = now;
    void this.copyPerfResults();
  }

  async copyPerfResults(): Promise<void> {
    if (!this.perfEnabled) return;
    const report = this.perfHud.text;
    try {
      await navigator.clipboard.writeText(report);
      if (!this.perfEnabled) return;
      this.perfCopyNoticeUntil = this.time.now + 800;
      this.perfHud.setText(`COPIED — P again to close\n${report}`);
      this.time.delayedCall(800, () => {
        if (this.perfEnabled) this.refreshPerfHud();
      });
    } catch {
      if (!this.perfEnabled) return;
      this.perfCopyNoticeUntil = this.time.now + 1200;
      this.perfHud.setText(`COPY FAILED\n${report}`);
      this.time.delayedCall(1200, () => {
        if (this.perfEnabled) this.refreshPerfHud();
      });
    }
  }

  recordPerfSample(frameMs: number, sceneMs: number): void {
    const timings = this.perfCurrent!;
    timings[0] = frameMs;
    timings[1] = sceneMs;
    let measured = 0;
    for (let i = 2; i <= 11; i++) measured += timings[i]!;
    timings[12] = Math.max(0, sceneMs - measured);
    // Includes Phaser/render work outside this scene and any vsync/idle time.
    timings[13] = Math.max(0, frameMs - sceneMs);

    const samples = this.perfSamples!;
    const at = this.perfSampleWrite;
    for (let i = 0; i < PERF_LABELS.length; i++) samples[i]![at] = timings[i]!;
    this.perfSampleWrite = (at + 1) % PERF_WINDOW;
    this.perfSampleCount = Math.min(PERF_WINDOW, this.perfSampleCount + 1);

    const now = this.time.now;
    if (now - this.perfHudAt < 1000) return;
    this.perfHudAt = now;
    this.refreshPerfHud();
  }

  refreshPerfHud(): void {
    const n = this.perfSampleCount;
    if (!n || this.time.now < this.perfCopyNoticeUntil) return;
    const samples = this.perfSamples!;
    const sort = this.perfSort!;
    const averages = new Float64Array(PERF_LABELS.length);
    const p95s = new Float64Array(PERF_LABELS.length);
    for (let bucket = 0; bucket < PERF_LABELS.length; bucket++) {
      let sum = 0;
      const source = samples[bucket]!;
      for (let i = 0; i < n; i++) {
        const value = source[i]!;
        sum += value;
        sort[i] = value;
      }
      sort.subarray(0, n).sort();
      averages[bucket] = sum / n;
      p95s[bucket] = sort[Math.ceil(n * 0.95) - 1]!;
    }
    const frameAvg = averages[0]!;
    const lines = [
      `PERFORMANCE ${this.terrainMesh ? "MESH" : "FLAT"}  P: copy  n=${n}`,
      `frame  ${frameAvg.toFixed(2)} avg  ${p95s[0]!.toFixed(2)} p95  ${(1000 / Math.max(frameAvg, 0.01)).toFixed(0)} fps`,
      `scene  ${averages[1]!.toFixed(2)} avg  ${p95s[1]!.toFixed(2)} p95`,
    ];
    for (let i = 2; i < PERF_LABELS.length; i++) {
      const avg = averages[i]!;
      lines.push(`${PERF_LABELS[i]!.padEnd(9)} ${avg.toFixed(2)} avg  ${p95s[i]!.toFixed(2)} p95  ${((avg / Math.max(frameAvg, 0.01)) * 100).toFixed(1)}%`);
    }
    lines.push(`objects  u${this.units.length} s${this.shots.length} d${this.debris.length} p${this.simParticles.length}`);
    this.perfHud.setText(lines.join("\n"));
  }

  syncLiftPrompt(): void {
    const show = this.heli.phase === "ready" && !this.mapView && !this.over;
    this.liftPrompt.setVisible(show);
    if (!show) return;
    const blink = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(this.time.now * 0.0075));
    this.liftPrompt.setAlpha(blink);
  }

  drawWeaponHud(): void {
    const h = this.heli;
    const g = this.wpnBar;
    g.clear();
    const slotW = 176;
    const slotH = 30;
    const gap = 6;
    const n = this.loadout.length;
    const total = n * slotW + (n - 1) * gap;
    const x0 = this.scale.width / 2 - total / 2;
    const y = this.scale.height - 16 - slotH;
    for (let i = 0; i < n; i++) {
      const wp = this.loadout[i]!;
      const a = this.ammo[i]!;
      const empty = !this.infAmmo && Number.isFinite(a) && a <= 0;
      const sel = i === h.weapon;
      const x = x0 + i * (slotW + gap);
      if (sel) {
        g.fillStyle(empty ? 0xff3a2a : 0xe8b84a, 1);
        g.fillRoundedRect(x, y, slotW, slotH, 3);
      } else if (empty) {
        g.fillStyle(0x3a1410, 0.92);
        g.fillRoundedRect(x, y, slotW, slotH, 3);
        g.lineStyle(1.5, 0xff3a2a, 0.95);
        g.strokeRoundedRect(x, y, slotW, slotH, 3);
      } else {
        g.fillStyle(0x12100c, 0.55);
        g.fillRoundedRect(x, y, slotW, slotH, 3);
      }
      const ammoS = empty ? "X" : this.infAmmo || !Number.isFinite(a) ? "∞" : String(a | 0);
      const t = this.wpnSlots[i]!;
      const lp = this.hudLocal(x + slotW / 2, y + slotH / 2);
      t.setPosition(lp.x, lp.y).setText(`${i + 1}  ${wp.name}  ${ammoS}`);
      if (sel) {
        t.setColor("#1c1812").setStroke("#1c1812", 0).setFontSize("16px");
      } else if (empty) {
        t.setColor("#ff4a2a").setStroke("#1a0808", 3).setFontSize("16px");
      } else {
        t.setColor("#f0d56a").setStroke("#12100c", 4).setFontSize("16px");
      }
    }
  }

  hvLine(spec: HvSpec): { text: string; done: boolean } {
    const u = this.units.find((q) => q.hv === spec.id);
    const done = !u || u.dead;
    if (done) return { text: `× ${spec.name}  KILL`, done: true };
    const dx = u.x - this.heli.x;
    const dy = u.y - this.heli.y;
    const dist = Math.hypot(dx, dy);
    const brg = Phaser.Math.RadToDeg(Math.atan2(dx, -dy));
    const compass = bearing(brg);
    const hp = Math.max(0, (u.health / u.max) * 100) | 0;
    return {
      text: `${bearingArrow(brg)} ${spec.name}  ${dist | 0}m  ${compass}  ${hp}%`,
      done: false,
    };
  }

  drawMinimap(): void {
    const cx = 18 + 88;
    const cy = this.scale.height - 18 - 88;
    const mapR = 84;
    // World diameter shown in the ring (larger = zoomed out / wider coverage).
    const span = 2600;
    const s = (mapR * 2) / span;
    this.miniTerrain.setDisplaySize(WORLD * s, WORLD * s);
    const tp = this.hudLocal(cx - (this.heli.x - WORLD / 2) * s, cy - (this.heli.y - WORLD / 2) * s);
    this.miniTerrain.setPosition(tp.x, tp.y);
    this.miniWrecks.setDisplaySize(WORLD * s, WORLD * s);
    this.miniWrecks.setPosition(this.miniTerrain.x, this.miniTerrain.y);
    this.miniGfx.clear();
    this.miniGfx.lineStyle(2, 0xe8b84a, 0.85);
    this.miniGfx.strokeCircle(cx, cy, 90);
    this.miniGfx.lineStyle(1, 0xe8b84a, 0.2);
    this.miniGfx.strokeCircle(cx, cy, 45);
    const toMap = (x: number, y: number) => ({
      x: cx + (x - this.heli.x) * s,
      y: cy + (y - this.heli.y) * s,
    });
    for (const u of this.units) {
      if (u.dead) continue;
      const p = toMap(u.x, u.y);
      if (Math.hypot(p.x - cx, p.y - cy) > mapR) continue;
      this.miniGfx.fillStyle(u.hv ? 0xff5a3a : 0xc45c28, 1);
      this.miniGfx.fillCircle(p.x, p.y, u.hv ? 3.5 : 2);
    }
    this.miniGfx.fillStyle(0xe8b84a, 1);
    this.miniGfx.fillCircle(cx, cy, 3);
    this.miniGfx.lineStyle(1.5, 0xe8b84a, 1);
    this.miniGfx.lineBetween(
      cx,
      cy,
      cx + Math.cos(this.heli.angle) * 12,
      cy + Math.sin(this.heli.angle) * 12
    );
  }

  drawHvArrows(): void {
    this.hvGfx.clear();
    if (this.mapBlend > 0.12) {
      for (const t of this.hvArrowLabels) t.setVisible(false);
      return;
    }
    const cam = this.cameras.main;
    const w = this.scale.width;
    const h = this.scale.height;
    const pad = 40;
    const g = this.hvGfx;
    let used = 0;
    for (const spec of this.world.hv) {
      const u = this.units.find((q) => q.hv === spec.id);
      if (!u || u.dead) continue;
      const vis = this.unitOnHud(u, pad);
      let ax: number;
      let ay: number;
      let ang: number;
      if (vis.on) {
        const above = (radius(u.kind) + heightOf(u.kind) * 0.35) * cam.zoom + 18;
        ax = vis.sx;
        ay = Math.max(pad, vis.sy - above);
        ang = Math.PI / 2;
      } else {
        const cx = w / 2;
        const cy = h / 2;
        ang = Math.atan2(vis.sy - cy, vis.sx - cx);
        ax = Phaser.Math.Clamp(vis.sx, pad, w - pad);
        ay = Phaser.Math.Clamp(vis.sy, pad, h - pad);
      }
      g.save();
      g.translateCanvas(ax, ay);
      g.rotateCanvas(ang);
      g.fillStyle(0x12100c, 0.62);
      g.fillTriangle(15, 0, -10, -10, -10, 10);
      g.fillStyle(0xff5a3a, 0.96);
      g.fillTriangle(12, 0, -8, -7.5, -8, 7.5);
      g.lineStyle(1.6, 0xe8b84a, 0.95);
      g.strokeTriangle(12, 0, -8, -7.5, -8, 7.5);
      g.restore();
      const label = this.hvArrowLabels[used++];
      if (!label) continue;
      const dist = Math.hypot(u.x - this.heli.x, u.y - this.heli.y) | 0;
      let lx: number;
      let ly: number;
      let ox: number;
      let oy: number;
      if (vis.on) {
        lx = ax;
        ly = ay - 12;
        ox = 0.5;
        oy = 1;
      } else {
        const inset = 26;
        lx = Phaser.Math.Clamp(ax - Math.cos(ang) * inset, 52, w - 52);
        ly = Phaser.Math.Clamp(ay - Math.sin(ang) * inset, 22, h - 22);
        const miniDx = lx - (18 + 88);
        const miniDy = ly - (h - 18 - 88);
        if (Math.hypot(miniDx, miniDy) < 108) {
          const n = Math.hypot(miniDx, miniDy) || 1;
          lx = 18 + 88 + (miniDx / n) * 112;
          ly = h - 18 - 88 + (miniDy / n) * 112;
        }
        ox = 0.5 + Math.cos(ang) * 0.42;
        oy = 0.5 + Math.sin(ang) * 0.38;
      }
      const lp = this.hudLocal(lx, ly);
      label
        .setVisible(true)
        .setText(`${spec.name}\n${dist}m`)
        .setPosition(lp.x, lp.y)
        .setOrigin(ox, oy)
        .setColor("#f0e6c8")
        .setAlpha(0.95);
    }
    for (let i = used; i < this.hvArrowLabels.length; i++) this.hvArrowLabels[i]!.setVisible(false);
  }

  drawDebugHits(): void {
    this.debugGfx.clear();
    if (!this.debugHit) return;
    /** Altitude sticks only — not a collision volume. */
    const altSticks = (x: number, y: number, hgt: number, z: number) => {
      const gnd = groundZ(this.world, x, y);
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
    const heliR = this.heli.spec.radius;
    this.debugGfx.lineStyle(1.25, 0x5ec8ff, 0.9);
    strokeCircle(this.heli.x, this.heli.y, this.heli.z, heliR);
    altSticks(this.heli.x, this.heli.y, this.heli.height, this.heli.z);

    for (const u of this.units) {
      if (u.dead) continue;
      strokeUnit(u);
      altSticks(u.x, u.y, heightOf(u.kind), u.z);
    }
    for (const s of this.shots) {
      markPoint(s.x, s.y, s.z);
      altSticks(s.x, s.y, 0, s.z);
    }
    for (const f of this.debris) {
      if (f.trailOnly) continue;
      markPoint(f.x, f.y, f.z);
      altSticks(f.x, f.y, 0, f.z);
    }
  }

  setDebugBlast(on: boolean): void {
    this.debugBlast = on;
    if (!on) {
      this.blastRings = [];
      this.blastGfx.clear();
    }
    this.blastGfx.setVisible(on);
    this.syncDebugMenu();
  }

  redrawBlastRings(): void {
    this.blastGfx.clear();
    if (!this.debugBlast) return;
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

  tickDebugBlast(dt: number): void {
    if (!this.debugBlast) {
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

  drawDebugAi(): void {
    this.aiGfx.clear();
    if (!this.debugAi || this.mapWorldHidden) {
      for (const t of this.aiLabels) t.setVisible(false);
      return;
    }
    const live = this.units.filter((u) => !u.dead);
    while (this.aiLabels.length < live.length) {
      const key = `ai_label_${this.aiLabels.length}`;
      const t = this.add
        .text(0, 0, "", {
          fontFamily: "Share Tech Mono, monospace",
          fontSize: "11px",
          color: "#ffe08a",
        })
        .setOrigin(0.5, 1)
        .setDepth(Layer.FIELD + 9)
        .setStroke("#12100c", 3)
        .setName(key);
      nameGameTexture(this, t, key);
      this.aiLabels.push(t);
    }
    for (const t of this.aiLabels) t.setVisible(false);
    this.aiGfx.lineStyle(1.4, 0x5ec8ff, 0.85);
    live.forEach((u, i) => {
      const scr = worldToScreen(u.x, u.y, u.z);
      const ux = scr.x;
      const uy = scr.y;
      if (u.aiTx != null && u.aiTy != null) {
        const target = worldToScreen(
          u.aiTx,
          u.aiTy,
          groundZ(this.world, u.aiTx, u.aiTy)
        );
        this.aiGfx.lineBetween(ux, uy, target.x, target.y);
        this.aiGfx.fillStyle(0x5ec8ff, 0.95);
        this.aiGfx.fillCircle(target.x, target.y, 3.2);
      }
      const label = this.aiLabels[i]!;
      label.setVisible(true);
      label.setPosition(ux, uy - 18);
      label.setText(u.aiState ?? "—");
    });
  }

  toggleMap(): void {
    if (this.over) return;
    this.mapWant = !this.mapWant;
    this.mapLabel
      .setVisible(true)
      .setText(this.mapWant ? "THEATER MAP   HV sites marked   M close" : "RETURNING");
  }

  setupExitMenu(): void {
    const { width: w, height: h } = this.scale;
    const panel = this.add
      .rectangle(w / 2, h / 2, 360, 210, 0x0b0a08, 0.96)
      .setStrokeStyle(2, 0xe8b84a, 0.9);
    const title = this.add
      .text(w / 2, h / 2 - 70, "PAUSED", {
        fontFamily: "Black Ops One, Impact, sans-serif",
        fontSize: "30px",
        color: "#e8b84a",
      })
      .setOrigin(0.5);
    const resume = this.add
      .text(w / 2, h / 2 - 10, "[ RESUME ]", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "18px",
        color: "#e8e0cc",
        backgroundColor: "#252017",
        padding: { x: 18, y: 8 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    const selection = this.add
      .text(w / 2, h / 2 + 48, "[ RETURN TO SELECTION ]", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "16px",
        color: "#ffb05a",
        backgroundColor: "#2b1710",
        padding: { x: 18, y: 8 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    resume.on("pointerdown", () => this.toggleExitMenu(false));
    selection.on("pointerdown", () => this.scene.start("menu"));
    this.exitRoot = this.add
      .container(0, 0, [panel, title, resume, selection])
      .setDepth(Layer.HUD + 600)
      .setScrollFactor(0)
      .setVisible(false);
    this.exitButton = this.add
      .text(w - 132, h - 18, "[ ESC ]  MENU", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "13px",
        color: "#d8d0ba",
        backgroundColor: "#12100c",
        padding: { x: 8, y: 5 },
      })
      .setOrigin(1, 1)
      .setDepth(Layer.HUD + 200)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true });
    this.exitButton.on("pointerdown", () => this.toggleExitMenu());
  }

  toggleExitMenu(force?: boolean): void {
    const want = force ?? !this.exitOpen;
    if (want && (this.mapWant || this.mapBlend > 0.02)) return;
    if (want && this.helpOpen) this.toggleHelp(false);
    this.exitOpen = want;
    this.exitRoot.setVisible(want);
    this.input.setDefaultCursor(want ? "default" : "none");
  }

  setupHelp(): void {
    const w = this.scale.width;
    const h = this.scale.height;
    const panelW = Math.min(960, w - 40);
    const panelH = Math.min(620, h - 30);
    const halfW = panelW / 2;
    const halfH = panelH / 2;
    const shade = this.add.rectangle(0, 0, w, h, 0x080705, 0.78).setInteractive();
    const panel = this.add
      .rectangle(0, 0, panelW, panelH, 0x12100c, 0.98)
      .setStrokeStyle(2, 0xe8b84a, 0.9);
    const title = this.add
      .text(0, -halfH + 28, "FIELD MANUAL", {
        fontFamily: "Black Ops One, Impact, sans-serif",
        fontSize: "28px",
        color: "#e8b84a",
      })
      .setOrigin(0.5);
    const craftX = -panelW * 0.27;
    this.helpCraftName = this.add
      .text(craftX, -halfH + 72, "", {
        fontFamily: "Black Ops One, Impact, sans-serif",
        fontSize: "17px",
        color: "#f2d579",
        align: "center",
      })
      .setOrigin(0.5);
    const helpCraft = craftOf();
    this.helpCraftBody = this.add.image(craftX, -halfH + 160, helpCraft.body).setOrigin(0.5);
    this.helpCraftRotorParts = craftComposite(helpCraft).rotors;
    this.helpCraftRotors = this.helpCraftRotorParts.map((part, rotorI) => {
      const rotor = this.add.image(craftX, -halfH + 160, part.tex).setOrigin(part.origin.x, part.origin.y);
      this.tweens.add({
        targets: rotor,
        rotation: (rotorI % 2 ? -1 : 1) * Math.PI * 2,
        duration: 60000,
        repeat: -1,
        ease: "Linear",
      });
      return rotor;
    });
    this.helpCraftExhaustMounts = craftExhaustMounts(helpCraft);
    this.helpCraftExhaustGlows = this.helpCraftExhaustMounts.map((_, exhaustI) => {
      const glow = this.add
        .image(craftX, -halfH + 160, "fx_exhaust_glow")
        .setBlendMode(Phaser.BlendModes.ADD)
        .setTint(craftPreviewExhaustTint(helpCraft.kind));
      this.tweens.add({
        targets: glow,
        alpha: { from: 0.5 + (exhaustI % 2) * 0.08, to: 0.96 },
        duration: 780 + exhaustI * 90,
        yoyo: true,
        repeat: -1,
        ease: "Sine.InOut",
      });
      return glow;
    });
    this.helpCraftStats = this.add
      .text(-halfW + 54, -halfH + 265, "", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "11px",
        color: "#d8d0ba",
        lineSpacing: 9,
      })
      .setOrigin(0, 0);
    this.helpCraftBars = this.add.graphics();
    const divider = this.add.graphics();
    divider.lineStyle(1, 0x6f6244, 0.6).lineBetween(0, -halfH + 68, 0, halfH - 166);
    const tipTitle = this.add
      .text(panelW * 0.25, -halfH + 78, "TACTICAL TIP", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "12px",
        color: "#e8b84a",
      })
      .setOrigin(0.5);
    this.helpBody = this.add
      .text(panelW * 0.25, -halfH + 185, "", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "18px",
        color: "#f0e6c8",
        align: "center",
        lineSpacing: 8,
        wordWrap: { width: panelW * 0.42 },
      })
      .setOrigin(0.5);
    const controls = createControlLegend(this, panelW - 32, halfH - 120);
    const tipNavY = -halfH + 372;
    const tipCenterX = panelW * 0.25;
    const prev = this.add
      .text(tipCenterX - 112, tipNavY, "‹  PREV", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "16px",
        color: "#e8b84a",
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    const next = this.add
      .text(tipCenterX + 112, tipNavY, "NEXT  ›", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "16px",
        color: "#e8b84a",
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    this.helpCounter = this.add
      .text(tipCenterX, tipNavY, "", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "13px",
        color: "#8a8470",
      })
      .setOrigin(0.5);
    const close = this.add
      .text(0, halfH - 28, "H / ESC  CLOSE", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "12px",
        color: "#8a8470",
      })
      .setOrigin(0.5);
    prev.on("pointerdown", () => this.nudgeHelp(-1));
    next.on("pointerdown", () => this.nudgeHelp(1));
    this.helpRoot = this.add
      .container(w / 2, h / 2, [
        shade,
        panel,
        title,
        this.helpCraftName,
        this.helpCraftBody,
        ...this.helpCraftExhaustGlows,
        ...this.helpCraftRotors,
        this.helpCraftStats,
        this.helpCraftBars,
        divider,
        tipTitle,
        this.helpBody,
        ...controls,
        prev,
        next,
        this.helpCounter,
        close,
      ])
      .setDepth(Layer.HUD + 500)
      .setScrollFactor(0)
      .setVisible(false);
    this.helpButton = this.add
      .text(w - 18, h - 18, "[ H ]  HELP", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "13px",
        color: "#e8b84a",
        backgroundColor: "#12100c",
        padding: { x: 8, y: 5 },
      })
      .setOrigin(1, 1)
      .setDepth(Layer.HUD + 200)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true });
    this.helpButton.on("pointerdown", () => this.toggleHelp());
    this.syncHelp();
  }

  toggleHelp(force?: boolean): void {
    const want = force ?? !this.helpOpen;
    if (want && (this.mapWant || this.mapBlend > 0.02 || this.over)) return;
    if (want && this.debugOpen) this.toggleDebugMenu(false);
    if (want && this.editOpen) this.toggleReliefEditor(false);
    this.helpOpen = want;
    this.helpRoot.setVisible(want);
    this.input.setDefaultCursor(want ? "default" : "none");
    this.syncHelp();
  }

  nudgeHelp(dir: number): void {
    if (!this.helpOpen) return;
    this.helpPage = (this.helpPage + dir + LOAD_TIPS.length) % LOAD_TIPS.length;
    this.syncHelp();
  }

  syncHelp(): void {
    if (!this.helpBody || !this.helpCounter) return;
    const craft = craftOf();
    if (this.helpCraftBody.texture.key !== craft.body) this.helpCraftBody.setTexture(craft.body);
    const previewScale = Math.min(
      170 / Math.max(1, this.helpCraftBody.width),
      165 / Math.max(1, this.helpCraftBody.height)
    );
    this.helpCraftBody.setScale(previewScale);
    this.helpCraftRotors.forEach((rotor, rotorI) => {
      const part = this.helpCraftRotorParts[rotorI]!;
      const at = spriteUvPos(this.helpCraftBody, part.mount.x, part.mount.y);
      rotor
        .setPosition(at.x, at.y)
        .setScale(craftCompositePartScale(part, rotor.width, this.helpCraftBody.scaleX));
    });
    this.helpCraftExhaustGlows.forEach((glow, exhaustI) => {
      const mount = this.helpCraftExhaustMounts[exhaustI]!;
      const at = spriteUvPos(this.helpCraftBody, mount.x, mount.y);
      const scale = this.helpCraftBody.scaleX * 0.55;
      glow.setPosition(at.x, at.y).setScale(scale * 0.75, scale);
    });
    this.helpCraftName.setText(craft.fullName.toUpperCase());
    const stats = [
      { label: "SPEED", value: craft.maxSpeed, max: Math.max(...allCrafts().map((c) => c.maxSpeed)), display: String(craft.maxSpeed) },
      { label: "AGILITY", value: craftAgility(craft), max: 1, display: `${Math.max(1, Math.round(craftAgility(craft) * 8))}/8` },
      { label: "SIZE", value: craft.sizeM, max: Math.max(...allCrafts().map((c) => c.sizeM)), display: `${craft.sizeM.toFixed(1)}m` },
      { label: "ARMOR", value: craft.health, max: Math.max(...allCrafts().map((c) => c.health)), display: String(craft.health) },
    ];
    this.helpCraftStats.setText(
      stats.map((stat) => `${stat.label.padEnd(8)} ${stat.display}`).join("\n")
    );
    const panelW = Math.min(960, this.scale.width - 40);
    const panelH = Math.min(620, this.scale.height - 30);
    const x0 = -panelW / 2 + 160;
    const y0 = -panelH / 2 + 269;
    this.helpCraftBars.clear();
    stats.forEach((stat, row) => {
      const filled = Math.max(1, Math.round((stat.value / stat.max) * 8));
      for (let i = 0; i < 8; i++) {
        this.helpCraftBars.fillStyle(i < filled ? 0xe8b84a : 0x302b22, i < filled ? 0.96 : 0.82);
        this.helpCraftBars.fillRoundedRect(x0 + i * 13, y0 + row * 20, 10, 6, 2);
      }
    });
    this.helpBody.setText(LOAD_TIPS[this.helpPage] ?? "");
    this.helpCounter.setText(`${this.helpPage + 1} / ${LOAD_TIPS.length}   ← →`);
  }

  hasAmmo(slot: number): boolean {
    if (this.infAmmo) return true;
    return (this.ammo[slot] ?? 0) > 0;
  }

  spendAmmo(slot: number): void {
    if (this.infAmmo) return;
    this.ammo[slot]!--;
  }

  setNoDamage(on: boolean): void {
    this.noDamage = on;
    this.heli.immune = on;
    this.syncDebugMenu();
  }

  setInfAmmo(on: boolean): void {
    this.infAmmo = on;
    this.syncDebugMenu();
  }

  setDebugAi(on: boolean): void {
    this.debugAi = on;
    if (!on) {
      this.aiGfx.clear();
      for (const t of this.aiLabels) t.setVisible(false);
    }
    this.syncDebugMenu();
  }

  toggleTerrainMesh(): void {
    if (!this.terrain25d) return;
    this.terrainMesh = !this.terrainMesh;
    this.terrain25d.setVisible(this.terrainMesh);
    this.ground.setVisible(!this.terrainMesh);
    this.flatWreckage.setVisible(!!this.terrain25d && !this.terrainMesh && !this.showHeightMap);
    if (this.perfEnabled) this.resetPerfMeasurements();
    this.syncDebugMenu();
  }

  toggleHeightMap(): void {
    this.showHeightMap = !this.showHeightMap;
    this.debugHit = this.showHeightMap;
    this.debugGfx.setVisible(this.debugHit);
    if (!this.debugHit) this.debugGfx.clear();
    const key = this.showHeightMap ? "heightmap" : "terrain";
    this.ground.setTexture(key).setDisplaySize(WORLD, WORLD);
    this.ground.setVisible(!this.terrainMesh);
    this.miniTerrain.setTexture(key);
    if (this.terrain25d) {
      this.terrain25d
        .setTerrainTexture(key)
        .setDecalTexture(this.showHeightMap ? null : this.wreckLayer);
    } else {
      this.wreckLayer.setVisible(!this.showHeightMap);
    }
    this.flatWreckage.setVisible(!!this.terrain25d && !this.terrainMesh && !this.showHeightMap);
    this.miniWrecks.setVisible(!this.showHeightMap && this.miniTerrain.visible);
    this.syncDebugMenu();
  }

  toggleDebugMenu(force?: boolean): void {
    const want = force ?? !this.debugOpen;
    if (want && this.helpOpen) return;
    this.debugOpen = want;
    if (!this.debugOpen) {
      this.debugSpawnOpen = false;
      this.debugCamOpen = false;
    }
    this.debugRoot.setVisible(this.debugOpen);
    if (this.debugOpen) this.syncDebugMenu();
  }

  toggleThermal(): void {
    this.thermalOn = !this.thermalOn;
    const cam = this.cameras.main;
    if (this.thermalOn) {
      if (!this.thermalFx) this.thermalFx = cam.postFX.addColorMatrix();
      this.thermalFx.set([
        0.52, 0.92, 0.18, 0, -0.24,
        0.42, 0.82, 0.12, 0, -0.08,
        0.08, 0.2, 0.36, 0, 0.04,
        0, 0, 0, 1, 0,
      ]);
    } else if (this.thermalFx) {
      this.thermalFx.reset();
    }
    this.syncDebugMenu();
  }

  setupTestPostFx(): void {
    this.applyTestFxActive();
  }

  toggleTestFx(): void {
    this.fxOn = !this.fxOn;
    if (!this.fxOn) this.fxBarrelPulse = 0;
    this.applyTestFxActive();
    this.syncTestFxHud();
    this.syncDebugMenu();
  }

  applyTestFxActive(): void {
    const cam = this.cameras.main;
    // Phaser bloom blends with mix(scene, bloom*strength, 0.5). Strength 0 ⇒ mix with black
    // ⇒ a permanent faded frame. setActive(false) is unreliable, so remove FX entirely when off.
    if (this.fxOn) {
      if (!this.fxBloom) {
        this.fxBloom = cam.postFX.addBloom(0xffe6b0, 1.1, 1.1, 1.0, 0.85, 3);
      } else {
        this.fxBloom.setActive(true);
        this.fxBloom.strength = 0.85;
        this.fxBloom.blurStrength = 1.0;
      }
      if (!this.fxBarrel) {
        this.fxBarrel = cam.postFX.addBarrel(1);
      } else {
        this.fxBarrel.setActive(true);
        this.fxBarrel.amount = 1;
      }
    } else {
      if (this.fxBloom) {
        cam.postFX.remove(this.fxBloom);
        this.fxBloom = undefined;
      }
      if (this.fxBarrel) {
        cam.postFX.remove(this.fxBarrel);
        this.fxBarrel = undefined;
      }
    }
  }

  pulseTestBarrel(amount: number): void {
    if (!this.fxBarrel || !this.fxOn) return;
    this.fxBarrelPulse = Math.max(this.fxBarrelPulse, Phaser.Math.Clamp(amount, 0, 0.7));
  }

  tickTestPostFx(dt: number): void {
    if (!this.fxOn || !this.fxBarrel) return;
    if (this.fxBarrelPulse > 0.002) {
      this.fxBarrel.amount = 1 + this.fxBarrelPulse;
      this.fxBarrelPulse *= Math.pow(0.04, dt);
    } else {
      this.fxBarrel.amount = 1;
      this.fxBarrelPulse = 0;
    }
  }

  syncTestFxHud(): void {
    if (!this.fxHud) return;
    this.fxHud.setText(`FX  F  ${this.fxOn ? "ON" : "off"}`);
  }

  setupDebugMenu(): void {
    const x = 22;
    const y = 86;
    const rowH = 22;
    this.debugRoot = this.add.container(x, y);
    this.debugRoot.setDepth(Layer.HUD + 180);
    this.debugRoot.setScrollFactor(0);
    this.debugPanel = this.add.graphics();
    this.debugTitle = this.add.text(12, 10, "/  DEBUG    ↑↓ select   ENTER activate", {
      fontFamily: "Share Tech Mono, monospace",
      fontSize: "13px",
      color: "#e8b84a",
    }).setName("debug_title");
    this.debugRows = DEBUG_MENU_ITEMS.map((item, i) => {
      const t = this.add
        .text(12, 38 + i * rowH, "", {
          fontFamily: "Share Tech Mono, monospace",
          fontSize: "13px",
          color: "#f0e6c8",
        })
        .setName(`debug_row_${i}`);
      if ("action" in item) {
        t.setInteractive({ useHandCursor: true });
        t.on("pointerdown", () => {
          if (this.debugSpawnOpen || this.debugCamOpen) return;
          this.debugMenuIdx = i;
          this.activateDebugRow(i);
        });
      }
      return t;
    });
    this.debugSpawnHint = this.add
      .text(12, 10, "", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "12px",
        color: "#e8b84a",
      })
      .setVisible(false)
      .setName("debug_spawn_hint");
    const camLabels = ["PITCH", "EYE", "ZOOM0", "PRESET"];
    this.debugCamRows = camLabels.map((_label, i) => {
      const t = this.add
        .text(12, 34 + i * 22, "", {
          fontFamily: "Share Tech Mono, monospace",
          fontSize: "13px",
          color: "#f0e6c8",
        })
        .setInteractive({ useHandCursor: true })
        .setVisible(false)
        .setName(`debug_cam_${i}`);
      t.on("pointerdown", () => {
        if (!this.debugCamOpen) return;
        this.debugCamIdx = i;
        this.activateDebugCamRow();
      });
      return t;
    });
    const kinds = allKinds();
    this.debugSpawnRows = kinds.map((kind, i) => {
      const t = this.add
        .text(12, 34 + i * 18, "", {
          fontFamily: "Share Tech Mono, monospace",
          fontSize: "13px",
          color: "#f0e6c8",
        })
        .setInteractive({ useHandCursor: true })
        .setVisible(false)
        .setName(`debug_spawn_${kind}`);
      t.on("pointerdown", () => {
        if (!this.debugSpawnOpen) return;
        this.debugSpawnIdx = i;
        this.debugSpawnSelected();
      });
      return t;
    });
    this.debugRoot.add([
      this.debugPanel,
      this.debugTitle,
      ...this.debugRows,
      this.debugSpawnHint,
      ...this.debugCamRows,
      ...this.debugSpawnRows,
    ]);
    this.debugRoot.setVisible(false);
    this.debugMenuIdx = DEBUG_MENU_ITEMS.findIndex((item) => "action" in item);
    this.syncDebugMenu();
  }

  syncDebugMenu(): void {
    if (!this.debugRows.length) return;
    const w = 330;
    const rowH = 22;
    if (this.debugCamOpen) {
      const n = this.debugCamRows.length;
      const hgt = 36 + n * 22 + 10;
      this.debugPanel.clear();
      this.debugPanel.fillStyle(0x12100c, 0.92);
      this.debugPanel.fillRoundedRect(0, 0, w, hgt, 3);
      this.debugPanel.lineStyle(1.5, 0xe8b84a, 0.85);
      this.debugPanel.strokeRoundedRect(0, 0, w, hgt, 3);
      for (const t of this.debugRows) t.setVisible(false);
      for (const t of this.debugSpawnRows) t.setVisible(false);
      this.debugTitle.setVisible(false);
      this.debugSpawnHint
        .setVisible(true)
        .setText("CAMERA  ↑↓ select  ←→ adjust  ENTER");
      const vals = [
        CamTune.pitch.toFixed(3),
        String(CamTune.cam | 0),
        CamTune.zoom0.toFixed(2),
        this.activeCameraPreset()?.name ?? "CUSTOM",
      ];
      const names = ["PITCH", "EYE", "ZOOM0", "PRESET"];
      for (let i = 0; i < this.debugCamRows.length; i++) {
        const row = this.debugCamRows[i]!;
        const sel = i === this.debugCamIdx;
        row
          .setVisible(true)
          .setText(`${sel ? "▸" : " "}  ${names[i]!}  ${vals[i]!}`)
          .setColor(sel ? "#e8b84a" : "#c8c0a8");
      }
      return;
    }
    if (this.debugSpawnOpen) {
      const kinds = allKinds();
      const n = kinds.length;
      const hgt = 36 + n * 18 + 10;
      this.debugPanel.clear();
      this.debugPanel.fillStyle(0x12100c, 0.92);
      this.debugPanel.fillRoundedRect(0, 0, w, hgt, 3);
      this.debugPanel.lineStyle(1.5, 0xe8b84a, 0.85);
      this.debugPanel.strokeRoundedRect(0, 0, w, hgt, 3);
      for (const t of this.debugRows) t.setVisible(false);
      for (const t of this.debugCamRows) t.setVisible(false);
      this.debugTitle.setVisible(false);
      this.debugSpawnHint
        .setVisible(true)
        .setText("SPAWN   ↑↓  ENTER place   ESC back");
      for (let i = 0; i < this.debugSpawnRows.length; i++) {
        const row = this.debugSpawnRows[i]!;
        const kind = kinds[i]!;
        const sel = i === this.debugSpawnIdx;
        row
          .setVisible(true)
          .setText(`${sel ? "▸" : " "}  ${labelOf(kind)}`)
          .setColor(sel ? "#e8b84a" : "#c8c0a8");
      }
      return;
    }
    const hgt = 48 + this.debugRows.length * rowH;
    this.debugPanel.clear();
    this.debugPanel.fillStyle(0x12100c, 0.92);
    this.debugPanel.fillRoundedRect(0, 0, w, hgt, 3);
    this.debugPanel.lineStyle(1.5, 0xe8b84a, 0.85);
    this.debugPanel.strokeRoundedRect(0, 0, w, hgt, 3);
    this.debugTitle.setVisible(true);
    this.debugSpawnHint.setVisible(false);
    for (const t of this.debugSpawnRows) t.setVisible(false);
    for (const t of this.debugCamRows) t.setVisible(false);
    if (
      this.debugMenuIdx >= DEBUG_MENU_ITEMS.length ||
      !("action" in DEBUG_MENU_ITEMS[this.debugMenuIdx]!)
    ) {
      this.debugMenuIdx = DEBUG_MENU_ITEMS.findIndex((item) => "action" in item);
    }
    for (let i = 0; i < this.debugRows.length; i++) {
      const row = this.debugRows[i]!;
      const item = DEBUG_MENU_ITEMS[i]!;
      row.setVisible(true);
      if ("section" in item) {
        row.setText(item.section).setColor("#6a8a62");
        continue;
      }
      const focus = i === this.debugMenuIdx;
      const mark = focus ? "▸" : " ";
      const shortcut = "shortcut" in item ? `[${item.shortcut}]` : "";
      if (item.action === "seed") {
        const notice = this.time.now < this.seedCopyNoticeUntil ? "COPIED" : "COPY";
        row
          .setText(`${mark}  ${item.label}  ${this.world.seed}  [${notice}]`)
          .setColor(focus ? "#e8b84a" : "#f0e6c8");
        continue;
      }
      const on =
        item.action === "noDamage"
          ? this.noDamage
          : item.action === "infAmmo"
            ? this.infAmmo
            : item.action === "performance"
              ? this.perfEnabled
              : item.action === "height"
                ? this.showHeightMap
                : item.action === "ai"
                  ? this.debugAi
                  : item.action === "blast"
                    ? this.debugBlast
                    : item.action === "terrainMesh"
                      ? this.terrainMesh
                      : item.action === "fx"
                        ? this.fxOn
                        : item.action === "relief"
                          ? this.editOpen
                          : undefined;
      const label = `${item.label}${shortcut ? `  ${shortcut}` : ""}`;
      if (on != null) {
        row.setText(`${mark}  ${label.padEnd(25)} ${on ? "ON" : "OFF"}`);
        row.setColor(focus ? "#e8b84a" : on ? "#c8b87a" : "#8a8470");
      } else {
        row.setText(`${mark}  ${label}`);
        row.setColor(focus ? "#e8b84a" : "#f0e6c8");
      }
    }
  }

  nudgeDebugMenu(dir: number): void {
    const n = this.debugRows.length;
    if (!n) return;
    do {
      this.debugMenuIdx = (this.debugMenuIdx + dir + n) % n;
    } while (!("action" in DEBUG_MENU_ITEMS[this.debugMenuIdx]!));
    this.syncDebugMenu();
  }

  activateDebugRow(i: number): void {
    const item = DEBUG_MENU_ITEMS[i];
    if (!item || !("action" in item)) return;
    if (item.action === "seed") void this.copyMissionSeed();
    else if (item.action === "noDamage") this.setNoDamage(!this.noDamage);
    else if (item.action === "infAmmo") this.setInfAmmo(!this.infAmmo);
    else if (item.action === "performance") this.togglePerfMeasurements();
    else if (item.action === "height") this.toggleHeightMap();
    else if (item.action === "ai") this.setDebugAi(!this.debugAi);
    else if (item.action === "blast") this.setDebugBlast(!this.debugBlast);
    else if (item.action === "terrainMesh") this.toggleTerrainMesh();
    else if (item.action === "fx") this.toggleTestFx();
    else if (item.action === "relief") this.toggleReliefEditor();
    else if (item.action === "camera") this.openDebugCam();
    else if (item.action === "spawn") this.openDebugSpawn();
    this.syncDebugMenu();
  }

  async copyMissionSeed(): Promise<void> {
    try {
      await navigator.clipboard.writeText(String(this.world.seed));
      this.seedCopyNoticeUntil = this.time.now + 900;
      this.syncDebugMenu();
      this.time.delayedCall(900, () => this.syncDebugMenu());
    } catch {
      // The seed remains visible for manual copying if clipboard access is denied.
    }
  }

  nudgeCamPitch(dir: number): void {
    CamTune.pitch = Phaser.Math.Clamp(Math.round((CamTune.pitch + dir * 0.005) * 1000) / 1000, 0.01, 0.2);
    this.syncProjectionPose();
    this.syncDebugMenu();
  }

  nudgeCamProj(dir: number): void {
    CamTune.cam = Phaser.Math.Clamp(CamTune.cam + dir * 40, 320, 1800);
    this.syncProjectionPose();
    this.syncDebugMenu();
  }

  nudgeCamZoom0(dir: number): void {
    CamTune.zoom0 = Phaser.Math.Clamp(Math.round((CamTune.zoom0 + dir * 0.05) * 100) / 100, 0.4, 4);
    this.syncDebugMenu();
  }

  openDebugCam(): void {
    this.debugCamOpen = true;
    this.debugSpawnOpen = false;
    if (this.debugCamIdx >= this.debugCamRows.length) this.debugCamIdx = 0;
    this.syncDebugMenu();
  }

  closeDebugCam(): void {
    this.debugCamOpen = false;
    this.syncDebugMenu();
  }

  nudgeDebugCamSel(dir: number): void {
    const n = this.debugCamRows.length;
    if (!n) return;
    this.debugCamIdx = (this.debugCamIdx + dir + n) % n;
    this.syncDebugMenu();
  }

  nudgeDebugCam(dir: number): void {
    if (this.debugCamIdx === 0) this.nudgeCamPitch(dir);
    else if (this.debugCamIdx === 1) this.nudgeCamProj(dir);
    else if (this.debugCamIdx === 2) this.nudgeCamZoom0(dir);
    else this.cycleCameraPreset(dir);
  }

  activateDebugCamRow(): void {
    if (this.debugCamIdx < 3) {
      this.nudgeDebugCam(1);
      return;
    }
    this.cycleCameraPreset(1);
  }

  activeCameraPreset(): (typeof CAMERA_PRESETS)[number] | undefined {
    return CAMERA_PRESETS.find(
      (preset) =>
        CamTune.pitch === preset.pitch &&
        CamTune.cam === preset.cam &&
        CamTune.zoom0 === preset.zoom0
    );
  }

  cycleCameraPreset(dir: number): void {
    const active = this.activeCameraPreset();
    const current = active ? CAMERA_PRESETS.indexOf(active) : 1;
    const index = (current + (dir < 0 ? -1 : 1) + CAMERA_PRESETS.length) % CAMERA_PRESETS.length;
    const preset = CAMERA_PRESETS[index]!;
    CamTune.pitch = preset.pitch;
    CamTune.cam = preset.cam;
    CamTune.zoom0 = preset.zoom0;
    this.camZoom = preset.zoom0;
    this.syncProjectionPose();
    this.syncDebugMenu();
  }

  openDebugSpawn(): void {
    this.debugSpawnOpen = true;
    this.debugCamOpen = false;
    this.syncDebugMenu();
  }

  closeDebugSpawn(): void {
    this.debugSpawnOpen = false;
    this.syncDebugMenu();
  }

  nudgeDebugSpawn(dir: number): void {
    const n = allKinds().length;
    if (!n) return;
    this.debugSpawnIdx = (this.debugSpawnIdx + dir + n) % n;
    this.syncDebugMenu();
  }

  debugSpawnSelected(): void {
    const kind = allKinds()[this.debugSpawnIdx];
    if (!kind) return;
    const h = this.heli;
    const a = Math.random() * Math.PI * 2;
    const d = 80 + Math.random() * 140;
    const x = h.x + Math.cos(a) * d;
    const y = h.y + Math.sin(a) * d;
    const u = this.makeUnit(kind, x, y);
    this.units.push(u);
    this.units.push(...this.spawnCrewFor(u));
  }

  toggleReliefEditor(force?: boolean): void {
    const want = force ?? !this.editOpen;
    if (want && this.helpOpen) return;
    if (!want && !this.editRoot) return;
    if (want && !this.editRoot) {
      this.setupReliefEditor();
      const markHudTree = (obj: Phaser.GameObjects.GameObject) => {
        this.bindHud(obj);
        const list = (obj as Phaser.GameObjects.Container).list;
        if (list) for (const ch of list) markHudTree(ch);
      };
      markHudTree(this.editRoot);
    }
    this.editOpen = want;
    this.editRoot.setVisible(this.editOpen);
    this.editGfx.setVisible(this.editOpen);
    this.input.setDefaultCursor(this.editOpen ? "crosshair" : "none");
    if (this.editOpen) {
      const p = this.worldPointer();
      this.editPx = p.x;
      this.editPy = p.y;
      this.syncReliefHud();
    } else {
      this.editGfx.clear();
      this.editDirty = null;
    }
    this.syncDebugMenu();
  }

  setEditBrush(i: number): void {
    this.editBrush = Phaser.Math.Clamp(i, 0, HEIGHT_BRUSHES.length - 1);
    this.syncReliefHud();
  }

  nudgeEditSize(dir: number): void {
    this.editSize = Phaser.Math.Clamp(this.editSize * (dir > 0 ? 1.12 : 0.89), 28, 480);
    this.syncReliefHud();
  }

  nudgeEditRot(dir: number): void {
    this.editRot += dir * 0.14;
    this.syncReliefHud();
  }

  nudgeEditOff(dx: number, dy: number): void {
    this.editOffX = Phaser.Math.Clamp(this.editOffX + dx * 0.06, -0.45, 0.45);
    this.editOffY = Phaser.Math.Clamp(this.editOffY + dy * 0.06, -0.45, 0.45);
    this.syncReliefHud();
  }

  setupReliefEditor(): void {
    for (const b of bakeHeightBrushes()) {
      const key = `brush_${b.id}`;
      if (this.textures.exists(key)) this.textures.remove(key);
      if (b.canvas) this.textures.addCanvas(key, b.canvas);
    }
    this.editGfx = this.add.graphics().setDepth(Layer.FIELD + 20);
    this.editGfx.setVisible(false);
    const w = 268;
    const hgt = 212;
    const x = this.scale.width - w - 18;
    const y = this.scale.height - hgt - 18;
    this.editRoot = this.add.container(x, y);
    this.editRoot.setDepth(Layer.HUD + 190);
    this.editRoot.setScrollFactor(0);
    const panel = this.add.graphics();
    panel.fillStyle(0x12100c, 0.94);
    panel.fillRect(0, 0, w, hgt);
    panel.lineStyle(1.5, 0xe8b84a, 0.9);
    panel.strokeRect(0.5, 0.5, w - 1, hgt - 1);
    panel.fillStyle(0xe8b84a, 1);
    panel.fillRect(0, 0, 4, hgt);
    const title = this.add.text(16, 8, "RELIEF KIT   E", {
      fontFamily: "Share Tech Mono, monospace",
      fontSize: "13px",
      color: "#e8b84a",
    }).setName("edit_title");
    this.editChips = [];
    this.editChipFrames = [];
    HEIGHT_BRUSHES.forEach((b, i) => {
      const cx = 22 + i * 80;
      const img = this.add.image(cx + 28, 58, `brush_${b.id}`).setDisplaySize(52, 52);
      img.setInteractive({ useHandCursor: true });
      img.on("pointerover", () => {
        this.editUiBlock = true;
      });
      img.on("pointerout", () => {
        this.editUiBlock = false;
      });
      img.on("pointerdown", () => this.setEditBrush(i));
      const frame = this.add.graphics();
      const lab = this.add.text(cx + 28, 90, b.name, {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "10px",
        color: "#8a8470",
      }).setOrigin(0.5, 0).setName(`edit_brush_${b.id}`);
      this.editChips.push(img);
      this.editChipFrames.push(frame);
      this.editRoot.add([frame, img, lab]);
    });
    this.editReadout = this.add.text(16, 112, "", {
      fontFamily: "Share Tech Mono, monospace",
      fontSize: "11px",
      color: "#c8c0a8",
      lineSpacing: 3,
    }).setName("edit_readout");
    this.editInkBtn = this.add
      .text(16, 176, "", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "12px",
        color: "#e8b84a",
      })
      .setInteractive({ useHandCursor: true })
      .setName("edit_ink");
    this.editInkBtn.on("pointerover", () => {
      this.editUiBlock = true;
    });
    this.editInkBtn.on("pointerout", () => {
      this.editUiBlock = false;
    });
    this.editInkBtn.on("pointerdown", () => this.toggleEditInvert());
    const hit = this.add.zone(0, 0, w, hgt).setOrigin(0, 0).setInteractive();
    hit.on("pointerover", () => {
      this.editUiBlock = true;
    });
    hit.on("pointerout", () => {
      this.editUiBlock = false;
    });
    this.editRoot.add([panel, hit, title, this.editReadout, this.editInkBtn]);
    this.editRoot.sendToBack(panel);
    this.editRoot.sendToBack(hit);
    this.editRoot.bringToTop(this.editReadout);
    this.editRoot.bringToTop(this.editInkBtn);
    this.editRoot.setVisible(false);
    this.syncReliefHud();
    nameGeneratedTextures(this);
  }

  toggleEditInvert(): void {
    this.editInvert = !this.editInvert;
    this.syncReliefHud();
  }

  syncReliefHud(): void {
    if (!this.editReadout) return;
    const deg = Math.round((((this.editRot % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) * (180 / Math.PI));
    const ink = this.editInvert ? "BLACK" : "WHITE";
    this.editReadout.setText(
      `SIZE ${this.editSize | 0}m  [ ] WHEEL\nROT  ${deg}°     Q R\nOFF  ${this.editOffX.toFixed(2)} ${this.editOffY.toFixed(2)}  , . ; '\nLMB STAMP  ·  RMB FLIP  ·  SPD ${this.editStr.toFixed(2)}`
    );
    if (this.editInkBtn) {
      this.editInkBtn.setText(`I  INK  ${ink}`);
      this.editInkBtn.setColor(this.editInvert ? "#8a9aaa" : "#e8b84a");
    }
    for (let i = 0; i < this.editChipFrames.length; i++) {
      const g = this.editChipFrames[i]!;
      const img = this.editChips[i]!;
      g.clear();
      const on = i === this.editBrush;
      if (this.editInvert) {
        g.fillStyle(0xc4b898, 1);
        g.fillRect(img.x - 28, img.y - 28, 56, 56);
        img.setTint(0x1c1812);
      } else {
        img.clearTint();
      }
      g.lineStyle(on ? 2 : 1, on ? 0xe8b84a : 0x3a3428, 1);
      g.strokeRect(img.x - 28, img.y - 28, 56, 56);
    }
  }

  handleReliefEdit(dt: number): void {
    if (!this.editOpen) {
      this.editGfx.clear();
      return;
    }
    const p = this.worldPointer();
    const dist = Math.hypot(p.x - this.editPx, p.y - this.editPy);
    const inst = dt > 1e-4 ? dist / dt : 0;
    this.editSpd = Phaser.Math.Linear(this.editSpd, inst, 1 - Math.pow(0.12, dt));
    const targetStr = 0.07 + Phaser.Math.Clamp(this.editSpd / 480, 0, 1) * 0.38;
    this.editStr = Phaser.Math.Linear(this.editStr, targetStr, 1 - Math.pow(0.16, dt));
    const ptr = this.input.activePointer;
    const invert = this.editInvert !== (ptr.rightButtonDown() && !ptr.leftButtonDown());
    const paint = (ptr.leftButtonDown() || ptr.rightButtonDown()) && !this.editUiBlock && !this.debugOpen;
    const just = paint && !this.editWasPaint;
    this.editWasPaint = paint;
    if (paint) {
      const spacing = Math.max(8, this.editSize * 0.2);
      const stamps: { x: number; y: number }[] = [];
      if (just) {
        this.editAcc = 0;
        stamps.push({ x: p.x, y: p.y });
      } else {
        this.editAcc += dist;
        while (this.editAcc >= spacing) {
          this.editAcc -= spacing;
          const t = spacing / Math.max(dist, 1e-4);
          stamps.push({
            x: Phaser.Math.Linear(p.x, this.editPx, t),
            y: Phaser.Math.Linear(p.y, this.editPy, t),
          });
        }
      }
      const brush = HEIGHT_BRUSHES[this.editBrush]!;
      for (const s of stamps) {
        const box = stampHeightBrush(
          this.world.height,
          brush.mask,
          brush.w,
          brush.h,
          s.x,
          s.y,
          this.editSize,
          this.editRot,
          this.editOffX,
          this.editOffY,
          invert,
          this.editStr
        );
        this.unionEditDirty(box);
      }
    } else {
      this.editAcc = 0;
    }
    this.editPx = p.x;
    this.editPy = p.y;
    if (this.editDirty) this.flushEditDirty();
    this.syncReliefHud();
    this.drawEditCursor(p.x, p.y, invert);
  }

  unionEditDirty(box: { x0: number; y0: number; x1: number; y1: number }): void {
    if (!this.editDirty) this.editDirty = { ...box };
    else {
      this.editDirty.x0 = Math.min(this.editDirty.x0, box.x0);
      this.editDirty.y0 = Math.min(this.editDirty.y0, box.y0);
      this.editDirty.x1 = Math.max(this.editDirty.x1, box.x1);
      this.editDirty.y1 = Math.max(this.editDirty.y1, box.y1);
    }
  }

  flushEditDirty(): void {
    const d = this.editDirty;
    if (!d) return;
    this.editDirty = null;
    rebuildWorldPatch(this.world, d.x0, d.y0, d.x1, d.y1, this.biomeTiles, (g, x0, y0, x1, y1) => {
      paintRoadsRect(this.world, g, x0, y0, x1, y1);
      this.stampDecorRect(g, x0, y0, x1, y1);
    });
    paintHeightMapRect(this.heightMapCanvas, this.world.height, d.x0, d.y0, d.x1, d.y1);
    (this.textures.get("terrain") as Phaser.Textures.CanvasTexture).refresh();
    (this.textures.get("heightmap") as Phaser.Textures.CanvasTexture).refresh();
    this.terrain25d?.updateHeightRegion(d.x0, d.y0, d.x1, d.y1);
  }

  stampDecorRect(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
    const wx0 = x0 * SCALE;
    const wy0 = y0 * SCALE;
    const wx1 = (x1 + 1) * SCALE;
    const wy1 = (y1 + 1) * SCALE;
    g.imageSmoothingEnabled = true;
    for (const dec of this.world.decor) {
      const pad = dec.size * SCALE * 0.5;
      if (dec.x < wx0 - pad || dec.x > wx1 + pad || dec.y < wy0 - pad || dec.y > wy1 + pad) continue;
      const skin = resolveSkin(this.textures, doodadTex(dec.kind), camoForBiome(sampleBiome(this.world, dec.x, dec.y)));
      if (!this.textures.exists(skin)) continue;
      const img = this.textures.get(skin).getSourceImage() as CanvasImageSource;
      const s = dec.size;
      g.save();
      g.globalAlpha = 0.9;
      g.translate(dec.x / SCALE, dec.y / SCALE);
      g.rotate(dec.rot * 0.15);
      g.drawImage(img, -s / 2, -s / 2, s, s);
      g.restore();
    }
    g.globalAlpha = 1;
  }

  drawEditCursor(x: number, y: number, invert: boolean): void {
    const g = this.editGfx;
    g.clear();
    const col = invert ? 0x6a9cb8 : 0xe8b84a;
    g.lineStyle(1.5, col, 0.95);
    const z = groundZ(this.world, x, y);
    const at = worldToScreen(x, y, z);
    g.save();
    g.translateCanvas(at.x, at.y);
    g.rotateCanvas(projectHeading(this.editRot, x, y, z));
    const s = this.editSize * at.scale;
    const ox = this.editOffX * s;
    const oy = this.editOffY * s;
    g.strokeRect(-s / 2 + ox, -s / 2 + oy, s, s);
    g.lineBetween(-6, 0, 6, 0);
    g.lineBetween(0, -6, 0, 6);
    g.restore();
  }

  nudgeTimeScale(dir: number): void {
    const next = Math.round((this.timeScale + dir * 0.25) * 100) / 100;
    this.timeScale = Phaser.Math.Clamp(next, 0.25, 4);
    this.applyTimeScale();
  }

  applyTimeScale(): void {
    this.setSimTimeScale(this.timeScale);
  }

  setSimTimeScale(s: number): void {
    if (s === this.lastSimScale) return;
    this.lastSimScale = s;
    this.time.timeScale = s;
    this.tweens.timeScale = s;
    for (const slots of this.fxSlots.values()) {
      for (const em of slots) em.timeScale = s;
    }
    for (const em of [this.smoke, this.tracer, this.blastFire, this.heliDust]) {
      if (em) em.timeScale = s;
    }
  }

  setupHudCam(): void {
    const w = this.scale.width;
    const h = this.scale.height;
    this.hudCam = this.cameras.add(0, 0, w, h);
    this.hudCam.setName("hud");
    this.hudCam.transparent = true;
    this.hudCam.setScroll(0, 0);
    this.hudCam.setZoom(1);
    this.hudRoot = this.add.container(w / 2, h / 2);
    this.hudRoot.setDepth(Layer.HUD + 100);
    this.hudRoot.setScrollFactor(0);
    this.bindHud(this.hudRoot);
    this.bindHud(this.miniMask);
    const chrome: (Phaser.GameObjects.GameObject & { x: number; y: number })[] = [
      this.miniBg,
      this.miniTerrain,
      this.miniWrecks,
      this.miniGfx,
      this.hud,
      this.fpsHud,
      this.perfHud,
      this.liftPrompt,
      this.hvHud,
      ...this.hvRows,
      this.playerHud,
      this.heliHudWireSh,
      this.heliHudWire,
      this.wpnBar,
      ...this.wpnSlots,
      this.hvGfx,
      ...this.hvArrowLabels,
      this.lockArrowGfx,
      this.lockHudTxt,
      this.lockInbdHudTxt,
    ];
    for (const go of chrome) this.adoptHud(go);
    this.bindHud(this.hurtVignette);
    this.hurtVignette.setPosition(0, 0);
    this.bindHud(this.reticle);
    this.bindHud(this.reticleMark);
    this.bindHud(this.sight);
    this.bindHud(this.mapLabel);
    const markHudTree = (obj: Phaser.GameObjects.GameObject) => {
      this.bindHud(obj);
      const list = (obj as Phaser.GameObjects.Container).list;
      if (list) for (const ch of list) markHudTree(ch);
    };
    markHudTree(this.debugRoot);
    markHudTree(this.helpRoot);
    markHudTree(this.exitRoot);
    this.bindHud(this.helpButton);
    this.bindHud(this.exitButton);
    if (this.editRoot) markHudTree(this.editRoot);
    this.children.each((obj) => {
      if (!this.hudSet.has(obj)) this.bindWorld(obj);
    });
    this.events.on("addedtoscene", (obj: Phaser.GameObjects.GameObject) => {
      if (this.hudSet.has(obj)) return;
      this.bindWorld(obj);
      if (this.mapWorldHidden && !this.theaterWorldKeep(obj)) {
        const visible = (obj as Phaser.GameObjects.GameObject & { visible: boolean }).visible;
        this.mapWorldVisibility.set(obj, visible);
        (obj as Phaser.GameObjects.GameObject & { setVisible(value: boolean): unknown }).setVisible(false);
      }
    });
  }

  theaterWorldKeep(obj: Phaser.GameObjects.GameObject): boolean {
    return (
      obj === this.terrain25d ||
      obj === this.ground ||
      obj === this.wreckLayer ||
      obj === this.flatWreckage ||
      obj === this.mapGfx ||
      this.mapHvLabels.some((label) => label === obj) ||
      this.hudSet.has(obj)
    );
  }

  setTheaterWorldHidden(hidden: boolean): void {
    if (hidden === this.mapWorldHidden) return;
    this.mapWorldHidden = hidden;
    if (hidden) {
      this.children.each((obj: Phaser.GameObjects.GameObject) => {
        if (this.theaterWorldKeep(obj)) return;
        const visible = (obj as Phaser.GameObjects.GameObject & { visible: boolean }).visible;
        this.mapWorldVisibility.set(obj, visible);
        (obj as Phaser.GameObjects.GameObject & { setVisible(value: boolean): unknown }).setVisible(false);
      });
      return;
    }
    for (const [obj, visible] of this.mapWorldVisibility) {
      if (obj.scene) {
        (obj as Phaser.GameObjects.GameObject & { setVisible(value: boolean): unknown }).setVisible(visible);
      }
    }
    this.mapWorldVisibility.clear();
  }

  bindHud(go: Phaser.GameObjects.GameObject): void {
    this.hudSet.add(go);
    (go as Phaser.GameObjects.GameObject & { setScrollFactor(x: number, y?: number): unknown })
      .setScrollFactor(0);
    go.cameraFilter = this.cameras.main.id;
  }

  adoptHud(go: Phaser.GameObjects.GameObject & { x: number; y: number }): void {
    this.bindHud(go);
    const lp = this.hudLocal(go.x, go.y);
    this.hudRoot.add(go);
    (go as typeof go & { setPosition(x: number, y: number): unknown }).setPosition(lp.x, lp.y);
  }

  bindWorld(go: Phaser.GameObjects.GameObject): void {
    if (this.hudSet.has(go)) return;
    go.cameraFilter |= this.hudCam.id;
  }

  hudLocal(x: number, y: number): { x: number; y: number } {
    return { x: x - this.scale.width / 2, y: y - this.scale.height / 2 };
  }

  syncHudParallax(dt: number): void {
    const w = this.scale.width;
    const h = this.scale.height;
    let wantS = 1;
    let wantX = 0;
    let wantY = 0;
    if (this.mapBlend < 0.12 && !this.over && this.heli.phase !== "dead") {
      const heli = this.heli;
      const spdN = Phaser.Math.Clamp(Math.hypot(heli.vx, heli.vy) / 320, 0, 1);
      const altN = Phaser.Math.Clamp(
        castZ(this.world, heli.x, heli.y, heli.z) / heli.spec.maxAgl,
        0,
        1
      );
      wantS = Phaser.Math.Clamp(1 - spdN * 0.07 - altN * 0.08, 0.86, 1);
      wantX = -heli.roll * 24;
      wantY = -heli.pitch * 20;
    }
    const k = 1 - Math.exp(-5.5 * dt);
    this.hudParS = Phaser.Math.Linear(this.hudParS, wantS, k);
    this.hudParX = Phaser.Math.Linear(this.hudParX, wantX, k);
    this.hudParY = Phaser.Math.Linear(this.hudParY, wantY, k);
    this.hudRoot.setPosition(w / 2 + this.hudParX, h / 2 + this.hudParY);
    this.hudRoot.setScale(this.hudParS);
    this.syncMiniMask();
  }

  syncMiniMask(): void {
    const cx = 18 + 88;
    const cy = this.scale.height - 18 - 88;
    const clip = this.hudLocal(cx, cy);
    const hs = this.hudRoot.scaleX;
    this.miniMask.setPosition(0, 0);
    this.miniMask.clear();
    this.miniMask.fillStyle(0xffffff, 1);
    this.miniMask.fillCircle(this.hudRoot.x + clip.x * hs, this.hudRoot.y + clip.y * hs, 88 * hs);
  }

  playZoom(): number {
    const h = this.heli;
    // Perspective keeps chase-focus scale stable; Phaser zoom is framing only.
    const base = camZoomAt(h.z) * craftCameraScale(h.spec);
    const spdN = Phaser.Math.Clamp(Math.hypot(h.vx, h.vy) / h.spec.maxSpeed, 0, 1);
    // Apache-class craft pull back 10% at top speed. Faster airframes earn
    // diminishing additional framing rather than scaling zoom linearly with
    // absolute speed (Warthog tops out near 15%, not 22%).
    const speedClass = Math.sqrt(h.spec.maxSpeed / 340);
    const maxPullback = Phaser.Math.Clamp(0.1 * speedClass, 0.08, 0.16);
    return base * (1 - spdN * maxPullback);
  }

  syncProjectionPose(): void {
    const focusX = this.heli.x + this.lookCamX;
    const focusY = this.heli.y + this.lookCamY;
    setCamera25DFocus(focusX, focusY, this.heli.z);
    // Camera-space coordinates from getWorldPoint are stale after recentering,
    // even within the same game-loop frame.
    this.ptrFrame = -1;
    this.ptrWorldReady = false;
    if (this.mapBlend < 0.001) this.cameras.main.centerOn(focusX, focusY);
  }

  theaterZoom(): number {
    return Math.min(this.scale.width / WORLD, this.scale.height / WORLD) * 0.92;
  }

  capturePlayView(): void {
    const cam = this.cameras.main;
    const v = cam.worldView;
    this.playScrollX = cam.scrollX;
    this.playScrollY = cam.scrollY;
    this.playViewX = v.x;
    this.playViewY = v.y;
    this.playViewW = v.width;
    this.playViewH = v.height;
  }

  syncPlayView(): void {
    if (this.mapBlend < 0.001 && this.playLastFrame) this.capturePlayView();
    this.playLastFrame = this.mapBlend < 0.001;
    if (this.mapBlend > 0.001) this.stepPlayCam();
  }

  stepPlayCam(): void {
    const zoom = this.playZoom();
    const width = this.scale.width;
    const height = this.scale.height;
    const lerp = 0.12;
    const fx = this.body.x;
    const fy = this.body.y;
    let sx = this.playScrollX;
    let sy = this.playScrollY;
    const midX = sx + width * 0.5;
    const midY = sy + height * 0.5;
    const dzL = midX - 40;
    const dzR = midX + 40;
    const dzT = midY - 40;
    const dzB = midY + 40;
    if (fx < dzL) sx = Phaser.Math.Linear(sx, sx - (dzL - fx), lerp);
    else if (fx > dzR) sx = Phaser.Math.Linear(sx, sx + (fx - dzR), lerp);
    if (fy < dzT) sy = Phaser.Math.Linear(sy, sy - (dzT - fy), lerp);
    else if (fy > dzB) sy = Phaser.Math.Linear(sy, sy + (fy - dzB), lerp);
    const dw = width / zoom;
    const dh = height / zoom;
    const bx = (dw - width) / 2;
    const by = (dh - height) / 2;
    const bw = Math.max(bx, bx + WORLD - dw);
    const bh = Math.max(by, by + WORLD - dh);
    sx = Phaser.Math.Clamp(sx, bx, bw);
    sy = Phaser.Math.Clamp(sy, by, bh);
    this.playScrollX = sx;
    this.playScrollY = sy;
    const displayW = Math.floor(dw + 0.5);
    const displayH = Math.floor(dh + 0.5);
    const mx = sx + width * 0.5;
    const my = sy + height * 0.5;
    this.playViewX = Math.floor(mx - displayW / 2 + 0.5);
    this.playViewY = Math.floor(my - displayH / 2 + 0.5);
    this.playViewW = displayW;
    this.playViewH = displayH;
  }

  updateTheaterCam(dt: number): void {
    const target = this.mapWant ? 1 : 0;
    const rate = 1.45;
    if (this.mapBlend < target) this.mapBlend = Math.min(target, this.mapBlend + dt * rate);
    else if (this.mapBlend > target) this.mapBlend = Math.max(target, this.mapBlend - dt * rate);

    const ease = Phaser.Math.Easing.Sine.InOut(this.mapBlend);
    this.terrain25d?.setProjectionBlend(1 - ease);
    const cam = this.cameras.main;
    const k = 1 - Math.exp(-5.2 * dt);
    this.camZoom = Phaser.Math.Linear(this.camZoom, this.playZoom(), k);
    cam.setZoom(Phaser.Math.Linear(this.camZoom, this.theaterZoom(), ease));

    if (this.mapBlend > 0.001) {
      if (this.camFollow) {
        cam.stopFollow();
        this.camFollow = false;
      }
      cam.useBounds = false;
      cam.centerOn(
        Phaser.Math.Linear(this.heli.x, WORLD / 2, ease),
        Phaser.Math.Linear(this.heli.y, WORLD / 2, ease)
      );
      this.mapView = true;
      this.reticle.setVisible(false);
      this.reticleMark.setVisible(false);
      this.reticleMark.clear();
      this.sight.setVisible(false);
      this.sight.clear();
      if (!this.mapWant && this.mapBlend < 0.08) this.mapLabel.setVisible(false);
      else this.mapLabel.setVisible(true);
    } else {
      this.mapView = false;
      this.mapLabel.setVisible(false);
      cam.setBounds(0, 0, WORLD, WORLD);
      cam.useBounds = true;
    }
  }

  syncLookCam(dt: number): void {
    if (this.stingerT > 0 && this.stingerTarget) {
      const elapsed = this.stingerDuration - this.stingerT;
      const ease = (t: number) => {
        const u = Phaser.Math.Clamp(t, 0, 1);
        return u * u * (3 - 2 * u);
      };
      const focusIn = ease(elapsed / 0.9);
      const focusOut = ease(this.stingerT / 1.15);
      const focus = Math.min(focusIn, focusOut);
      const ox = (this.stingerTarget.x - this.heli.x) * focus;
      const oy = (this.stingerTarget.y - this.heli.y) * focus;
      const k = 1 - Math.exp(-4.2 * dt);
      this.lookCamX = Phaser.Math.Linear(this.lookCamX, ox, k);
      this.lookCamY = Phaser.Math.Linear(this.lookCamY, oy, k);
      this.syncProjectionPose();
      return;
    }
    const p = this.pointerScreen();
    const pointerAtFocus = screenToWorldAtZ(p.x, p.y, this.heli.z);
    const wpn = this.loadout[this.heli.weapon]!.kind;
    const look =
      wpn === "lock-on-missile"
        ? { pull: 0.86, max: 360, rate: 5.2 }
        : wpn === "rocket"
          ? { pull: 0.42, max: 160, rate: 7.4 }
          : wpn === "guided-missile"
            ? { pull: 0.55, max: 210, rate: 6.5 }
            : { pull: 0.2, max: 88, rate: 10 };
    const pull = look.pull;
    const max = look.max;
    let ox = (pointerAtFocus.x - this.heli.x) * pull;
    let oy = (pointerAtFocus.y - this.heli.y) * pull;
    const len = Math.hypot(ox, oy);
    if (len > max) {
      ox *= max / len;
      oy *= max / len;
    }
    let rate = look.rate;
    let tow: Shot | undefined;
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i]!;
      if (s.kind === "guided-missile" && s.from === "player") {
        tow = s;
        break;
      }
    }
    if (tow) {
      this.towLookX = tow.x;
      this.towLookY = tow.y;
      this.towLookHold = 0;
      ox += (tow.x - this.heli.x) * 0.82;
      oy += (tow.y - this.heli.y) * 0.82;
      rate = 5.4;
    } else if (this.towLookHold > 0) {
      this.towLookHold = Math.max(0, this.towLookHold - dt);
      ox += (this.towLookX - this.heli.x) * 0.82;
      oy += (this.towLookY - this.heli.y) * 0.82;
      rate = 5.4;
    }
    const k = 1 - Math.exp(-rate * dt);
    this.lookCamX = Phaser.Math.Linear(this.lookCamX, ox, k);
    this.lookCamY = Phaser.Math.Linear(this.lookCamY, oy, k);
    this.syncProjectionPose();
  }

  setHudVisible(on: boolean): void {
    this.hud.setVisible(on);
    this.liftPrompt.setVisible(on && this.heli.phase === "ready");
    this.hvHud.setVisible(on);
    for (const t of this.hvRows) t.setVisible(on);
    this.wpnHud.setVisible(on);
    this.wpnBar.setVisible(on);
    for (const t of this.wpnSlots) t.setVisible(on);
    this.playerHud.setVisible(on);
    this.heliHudWireSh.setVisible(on);
    this.heliHudWire.setVisible(on);
    this.hurtVignette.setVisible(on);
    this.miniGfx.setVisible(on);
    this.miniBg.setVisible(on);
    this.miniTerrain.setVisible(on);
    this.miniWrecks.setVisible(on && !this.showHeightMap);
    this.hudRoot.setVisible(on);
    if (this.editRoot) this.editRoot.setVisible(this.editOpen && (on || this.mapBlend > 0.12));
    this.hpGfx.setVisible(on);
    if (on) {
      this.reticle.setVisible(true);
      this.reticleMark.setVisible(true);
      this.sight.setVisible(true);
    } else {
      this.reticle.setVisible(false);
      this.reticleMark.setVisible(false);
      this.reticleMark.clear();
      this.sight.setVisible(false);
      this.sight.clear();
      this.lockSpr.setVisible(false);
      this.lockGfx.setVisible(false);
      this.lockGfx.clear();
      this.lockTxt.setVisible(false);
      this.lockInbdTxt.setVisible(false);
      this.lockHudTxt.setVisible(false);
      this.lockInbdHudTxt.setVisible(false);
      this.lockArrowGfx.clear();
      this.playerHud.clear();
      this.hurtVignette.setVisible(false).setAlpha(0);
      this.miniGfx.clear();
    }
  }

  drawMapOverlay(): void {
    this.mapGfx.clear();
    const g = this.mapGfx;
    const z = Math.max(this.cameras.main.zoom, 0.001);
    const u = (px: number) => px / z;
    const w = this.scale.width;
    const h = this.scale.height;
    const pz = this.playZoom();
    const pw = this.playViewW || w / pz;
    const ph = this.playViewH || h / pz;
    const vx = this.playViewW ? this.playViewX : this.heli.x - pw / 2;
    const vy = this.playViewH ? this.playViewY : this.heli.y - ph / 2;
    const bx = vx + pw;
    const by = vy + ph;
    const tick = Math.max(u(10), Math.min(pw, ph) * 0.18);
    g.fillStyle(0xe8b84a, 0.16);
    g.fillRect(vx, vy, pw, ph);
    g.lineStyle(u(5), 0x1a140c, 0.9);
    g.strokeRect(vx, vy, pw, ph);
    g.lineStyle(u(2.5), 0xffe08a, 1);
    g.strokeRect(vx, vy, pw, ph);
    g.lineStyle(u(3), 0xfff6d0, 1);
    g.lineBetween(vx, vy, vx + tick, vy);
    g.lineBetween(vx, vy, vx, vy + tick);
    g.lineBetween(bx, vy, bx - tick, vy);
    g.lineBetween(bx, vy, bx, vy + tick);
    g.lineBetween(vx, by, vx + tick, by);
    g.lineBetween(vx, by, vx, by - tick);
    g.lineBetween(bx, by, bx - tick, by);
    g.lineBetween(bx, by, bx, by - tick);
    for (const spec of this.world.hv) {
      const unit = this.units.find((q) => q.hv === spec.id);
      const x = unit ? unit.x : spec.x;
      const y = unit ? unit.y : spec.y;
      const dead = !unit || unit.dead;
      g.fillStyle(dead ? 0x6a6a60 : 0xff5a3a, 1);
      g.fillCircle(x, y, u(7));
      g.lineStyle(u(2), 0xe8b84a, 0.9);
      g.strokeCircle(x, y, u(11));
    }
    this.syncMapHvLabels(u);
    g.fillStyle(0xe8b84a, 1);
    g.fillCircle(this.heli.x, this.heli.y, u(5));
  }

  hideMapHvLabels(): void {
    for (const t of this.mapHvLabels) t.setVisible(false);
  }

  syncMapHvLabels(u: (px: number) => number): void {
    while (this.mapHvLabels.length < this.world.hv.length) {
      const key = `map_hv_${this.mapHvLabels.length}`;
      const t = this.add
        .text(0, 0, "", {
          fontFamily: "Share Tech Mono, monospace",
          fontSize: "12px",
          color: "#ffe08a",
          align: "left",
        })
        .setOrigin(0, 0.5)
        .setDepth(Layer.HUD + 3)
        .setStroke("#12100c", 4)
        .setName(key);
      nameGameTexture(this, t, key);
      this.mapHvLabels.push(t);
    }
    const fs = Math.max(11, u(13));
    for (let i = 0; i < this.mapHvLabels.length; i++) {
      const t = this.mapHvLabels[i]!;
      const spec = this.world.hv[i];
      if (!spec) {
        t.setVisible(false);
        continue;
      }
      const unit = this.units.find((q) => q.hv === spec.id);
      const x = unit ? unit.x : spec.x;
      const y = unit ? unit.y : spec.y;
      const dead = !unit || unit.dead;
      const kind = spec.kind.toUpperCase();
      const status = dead
        ? "DESTROYED"
        : `ACTIVE  ${(Math.max(0, (unit.health / unit.max) * 100) | 0)}%`;
      t.setVisible(true)
        .setScrollFactor(1)
        .setPosition(x + u(16), y)
        .setText(`${spec.name}\n${kind}  ·  ${status}`)
        .setColor(dead ? "#8a8470" : "#ffe08a")
        .setFontSize(`${fs}px`)
        .setLineSpacing(u(1.5))
        .setStroke("#12100c", Math.max(3, u(3.5)));
    }
  }

  drawUnitBars(): void {
    const g = this.hpGfx;
    g.clear();
    g.setDepth(Layer.FIELD);
    for (const u of this.units) {
      if (u.dead || u.health >= u.max - 0.5) continue;
      if (!cameraPointVisible(u.z, u.y)) continue;
      const at = worldToScreen(u.x, u.y, u.z);
      const zs = at.scale;
      const w = (isOrganic(u.kind) ? 16 : 32) * zs;
      const ratio = Phaser.Math.Clamp(u.health / u.max, 0, 1);
      const x = at.x - w / 2;
      const y = at.y - heightOf(u.kind) * 0.35 * zs - 14 * zs;
      g.fillStyle(0x10100c, 0.7);
      g.fillRect(x, y, w, 4 * zs);
      g.fillStyle(ratio > 0.5 ? 0x6dbb4a : ratio > 0.25 ? 0xe8b84a : 0xff4a2a, 1);
      g.fillRect(x, y, w * ratio, 4 * zs);
    }
  }

  healthHudColor(hp: number): number {
    const t = Phaser.Math.Clamp(hp, 0, 1);
    const stops: [number, number][] = [
      [1, 0x5caa3a],
      [0.66, 0xe8c44a],
      [0.33, 0xe87828],
      [0, 0xff2a18],
    ];
    for (let i = 0; i < stops.length - 1; i++) {
      const [aT, aC] = stops[i]!;
      const [bT, bC] = stops[i + 1]!;
      if (t <= aT && t >= bT) {
        const k = (aT - t) / Math.max(0.0001, aT - bT);
        return Phaser.Display.Color.GetColor(
          Math.round(Phaser.Math.Linear((aC >> 16) & 0xff, (bC >> 16) & 0xff, k)),
          Math.round(Phaser.Math.Linear((aC >> 8) & 0xff, (bC >> 8) & 0xff, k)),
          Math.round(Phaser.Math.Linear(aC & 0xff, bC & 0xff, k))
        );
      }
    }
    return stops[stops.length - 1]![1];
  }

  drawPlayerHud(): void {
    const g = this.playerHud;
    g.clear();
    const h = this.heli;
    const hp = Phaser.Math.Clamp(h.health / h.spec.health, 0, 1);
    const margin = 18;
    const bake = this.heliHudWireBake;
    const ox = bake.pivot.x;
    const oy = bake.pivot.y;
    const drawW = bake.w * this.heliHudWireScale;
    const drawH = bake.h * this.heliHudWireScale;
    const wireRight = this.scale.width - margin;
    const wireBottom = this.scale.height - margin;
    const wireX = wireRight - (1 - ox) * drawW;
    const wireY = wireBottom - (1 - oy) * drawH;
    const barW = 9;
    const barGap = 18;
    const barH = drawH;
    const barX = wireRight - drawW - barGap - barW;
    const barY = wireBottom - barH;
    const barPad = 3;
    const boxX = barX - barPad;
    const boxY = barY - barPad;
    const boxW = barW + barPad * 2;
    const boxH = barH + barPad * 2;

    const segs = 10;
    const gap = 2;
    const segH = (barH - gap * (segs - 1)) / segs;
    const fill = hp * segs;
    const hpCol = this.healthHudColor(hp);
    for (let i = 0; i < segs; i++) {
      const sy = barY + (segs - 1 - i) * (segH + gap);
      g.fillStyle(0x141410, 0.55);
      g.fillRect(barX, sy, barW, segH);
      const part = Phaser.Math.Clamp(fill - i, 0, 1);
      if (part <= 0) continue;
      const fh = Math.max(0.5, segH * part);
      g.fillStyle(hpCol, 0.95);
      g.fillRect(barX, sy + (segH - fh), barW, fh);
    }
    g.lineStyle(1.5, 0x080808, 0.92);
    g.strokeRoundedRect(boxX, boxY, boxW, boxH, 2);
    g.lineStyle(1, 0x444438, 0.5);
    g.strokeRoundedRect(boxX + 0.5, boxY + 0.5, boxW - 1, boxH - 1, 2);

    const pulse = hp < 0.3 ? 0.55 + 0.45 * Math.sin(this.time.now * 0.018) : 1;
    const wirePos = this.hudLocal(wireX, wireY);
    this.heliHudWireSh.setPosition(wirePos.x, wirePos.y);
    this.heliHudWire.setPosition(wirePos.x, wirePos.y).setTint(hpCol).setAlpha(0.92 * pulse);

    for (let siteI = 0; siteI < h.dmgSites.length; siteI++) {
      const site = h.dmgSites[siteI]!;
      const mapped = heliHudWireUv(bake, site.u, site.v);
      const mx = wireX + (mapped.u - ox) * drawW;
      const my = wireY + (mapped.v - oy) * drawH;
      const hmPulse = 0.65 + 0.35 * Math.sin(this.time.now * 0.022 + siteI * 1.7);
      g.fillStyle(0xff2020, 0.9 * hmPulse);
      g.fillCircle(mx, my, 9.5);
      g.lineStyle(2.2, 0xff6644, 0.75 * hmPulse);
      g.strokeCircle(mx, my, 15);
    }

    this.drawHurtVignette(hp);
  }

  drawHurtVignette(hp: number): void {
    const img = this.hurtVignette;
    if (this.heli.phase === "dead" || hp >= 0.32) {
      img.setVisible(false).setAlpha(0);
      return;
    }
    const w = this.scale.width;
    const h = this.scale.height;
    const pulse = 0.5 + 0.5 * Math.sin(this.time.now * 0.005);
    const k = Phaser.Math.Clamp((0.32 - hp) / 0.32, 0, 1) * pulse;
    img
      .setVisible(true)
      .setPosition(0, 0)
      .setDisplaySize(w, h)
      .setTint(0xff1a1a)
      .setAlpha(0.22 + k * 0.72);
  }

  emitDamageFx(): void {
    const h = this.heli;
    this.emitUnitDamageFx();
    const hp = h.health / h.spec.health;
    if (h.phase !== "dead" && hp < 0.98) {
      const want = hp < 0.25 ? 3 : hp < 0.45 ? 2 : hp < 0.75 ? 1 : 0;
      while (h.dmgSites.length > want) h.dmgSites.pop();
      while (h.dmgSites.length < want) {
        const uv = this.sampleSolidUv(h.spec.body, h.spec.radius);
        h.dmgSites.push({ ...uv, scale: range(0.42, 0.8) });
      }
      if (want) {
        const { fire, smoke } = this.pairFx(h.z, h.y, this.playerFlame, this.playerHurtSmoke, ZOff.dmg, ZOff.smoke);
        for (const s of h.dmgSites) {
          const base = spriteUvPos(this.body, s.u, s.v);
          const p = jitterDisk(base.x, base.y, 2.2 + s.scale * 1.5);
          this.dmgFlameScale = s.scale * 1.65;
          if (Math.random() < 0.48) this.emitBudgeted("fire", fire, p.x, p.y, 1);
          if (Math.random() < 0.28) this.emitBudgeted("smoke", smoke, p.x, p.y, 1);
        }
      }
    } else if (h.phase !== "dead") {
      h.dmgSites.length = 0;
    }
  }

  emitUnitDamageFx(): void {
    const view = this.cameras.main.worldView;
    const pad = 120;
    for (const u of this.units) {
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
      const tex = resolveSkin(this.textures, textureOf(u.kind), u.camo);
      while (u.dmgSites.length > want) u.dmgSites.pop();
      while (u.dmgSites.length < want) {
        const uv = this.sampleSolidUv(tex, radius(u.kind));
        u.dmgSites.push({ ...uv, scale: range(0.38, 0.75) });
      }
      const zBias = u.pinId != null ? ZOff.posted : 0;
      const { fire, smoke } = this.pairFx(u.z, u.y, this.flame, this.hurtSmoke, ZOff.dmg + zBias, ZOff.smoke + zBias);
      const sp = specOf(u.kind);
      const sizeMul = sp.aerial ? 1.65 : sp.building ? 1.15 : 1;
      for (const s of u.dmgSites) {
        const mount = this.mountAt(u, tex, { x: s.u, y: s.v });
        const base = worldToScreen(mount.x, mount.y, u.z);
        const p = jitterDisk(base.x, base.y, 1.8 + s.scale * 1.6);
        this.dmgFlameScale = s.scale * sizeMul;
        if (Math.random() < 0.45) this.emitBudgeted("fire", fire, p.x, p.y, 1);
        if (Math.random() < 0.26) this.emitBudgeted("smoke", smoke, p.x, p.y, 1);
      }
    }
  }

  showStinger(
    title: string,
    detail: string,
    color: number,
    duration: number,
    target?: { x: number; y: number },
    done?: () => void
  ): void {
    this.stingerRoot?.destroy(true);
    const { width, height } = this.scale;
    const bg = this.add.rectangle(width / 2, height / 2, width, 92, 0x090908, 0.82);
    const edgeTop = this.add.rectangle(width / 2, height / 2 - 46, width, 2, color, 0.9);
    const edgeBottom = this.add.rectangle(width / 2, height / 2 + 46, width, 2, color, 0.9);
    const text = this.add
      .text(width / 2, height / 2 - 8, title, {
        fontFamily: "Black Ops One, Impact, sans-serif",
        fontSize: "38px",
        color: `#${color.toString(16).padStart(6, "0")}`,
        align: "center",
      })
      .setOrigin(0.5);
    const sub = this.add
      .text(width / 2, height / 2 + 26, detail, {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "14px",
        color: "#e8e0cc",
      })
      .setOrigin(0.5);
    const root = this.add
      .container(0, 0, [bg, edgeTop, edgeBottom, text, sub])
      .setScrollFactor(0)
      .setDepth(Layer.HUD + 80)
      .setAlpha(0);
    this.bindHud(root);
    this.stingerRoot = root;
    this.stingerText = text;
    this.stingerT = duration;
    this.stingerDuration = duration;
    this.stingerTarget = target;
    this.stingerDone = done;
  }

  tickStinger(wallDt: number): void {
    if (this.stingerT <= 0 || !this.stingerRoot) return;
    this.stingerT = Math.max(0, this.stingerT - wallDt);
    const elapsed = this.stingerDuration - this.stingerT;
    const fadeIn = Phaser.Math.Clamp(elapsed / 0.12, 0, 1);
    const fadeOut = Phaser.Math.Clamp(this.stingerT / 0.22, 0, 1);
    this.stingerRoot.setAlpha(Math.min(fadeIn, fadeOut));
    if (this.stingerText) {
      this.stingerText.setScale(Phaser.Math.Linear(1.12, 1, Phaser.Math.Clamp(elapsed / 0.3, 0, 1)));
    }
    if (this.stingerT === 0) {
      this.stingerRoot.destroy(true);
      this.stingerRoot = undefined;
      this.stingerText = undefined;
      this.stingerTarget = undefined;
      const done = this.stingerDone;
      this.stingerDone = undefined;
      done?.();
    }
  }

  end(win: boolean): void {
    if (this.over) return;
    this.over = true;
    this.win = win;
    const msg = win ? "MISSION COMPLETE" : "BIRD DOWN";
    this.bindHud(
      this.add
        .text(this.scale.width / 2, this.scale.height / 2, `${msg}\nR  RESTART`, {
          fontFamily: "Black Ops One, Impact, sans-serif",
          fontSize: "42px",
          color: win ? "#e8b84a" : "#ff6a3a",
          align: "center",
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(Layer.HUD + 50)
        .setName("hud_end")
    );
    nameGeneratedTextures(this);
  }
}

function hitSimParticleFx(dmg: number): { n: number; spd: number; size: number } {
  const t = Phaser.Math.Clamp(Math.pow(Math.max(0.35, dmg) / 8, 0.32), 0.28, 1.5);
  return {
    n: t,
    spd: 0.86 + 0.1 * t,
    size: Phaser.Math.Clamp(0.4 + 0.58 * t, 0.4, 1.26),
  };
}

function simParticleTexKey(kind: SimParticleKind): string {
  return `fx_${kind}`;
}

function troopMissileTrail(s: Shot): boolean {
  // Troop / hardpoint missiles (RPG 0.66, Stinger 0.7, heli secondary ×0.72) vs player Hydra (~1).
  return s.from === "enemy" && (s.scale ?? 1) <= 0.75;
}

function shotTrailScale(s: Shot): number {
  const vis = s.scale ?? 1;
  const small = troopMissileTrail(s);
  if (s.kind === "rocket") return small ? vis * 0.34 : vis * 0.32;
  if (s.kind === "guided-missile") return vis * 0.52;
  if (s.kind === "lock-on-missile") return small ? vis * 0.4 : vis * 0.55;
  return vis;
}

function jitterDisk(x: number, y: number, r: number): { x: number; y: number } {
  const a = Math.random() * Math.PI * 2;
  const d = Math.sqrt(Math.random()) * r;
  return { x: x + Math.cos(a) * d, y: y + Math.sin(a) * d };
}

function biasedDir(
  bx: number,
  by: number,
  bz: number,
  tight: number,
  reverse: boolean
): { x: number; y: number; z: number } {
  const len = Math.hypot(bx, by, bz) || 1;
  const sx = (reverse ? -bx : bx) / len;
  const sy = (reverse ? -by : by) / len;
  const sz = (reverse ? -bz : bz) / len;
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(Math.random() * 2 - 1);
  const rx = Math.sin(phi) * Math.cos(theta);
  const ry = Math.sin(phi) * Math.sin(theta);
  const rz = Math.cos(phi);
  const t = Phaser.Math.Clamp(tight, 0, 1);
  let x = sx * t + rx * (1 - t);
  let y = sy * t + ry * (1 - t);
  let z = sz * t + rz * (1 - t);
  const n = Math.hypot(x, y, z) || 1;
  return { x: x / n, y: y / n, z: z / n };
}

/** Sample a unit direction with pdf ∝ exp(k · cosθ) about (bx,by,bz). align = cosθ ∈ [-1,1]. */
function expBiasDir(
  bx: number,
  by: number,
  bz: number,
  k: number
): { x: number; y: number; z: number; align: number } {
  const len = Math.hypot(bx, by, bz) || 1;
  const sx = bx / len;
  const sy = by / len;
  const sz = bz / len;
  const u = Math.random();
  const kk = Math.max(1e-4, k);
  const align = Math.log(Math.exp(-kk) + u * (Math.exp(kk) - Math.exp(-kk))) / kk;
  const sinT = Math.sqrt(Math.max(0, 1 - align * align));
  const azi = Math.random() * Math.PI * 2;
  // Orthonormal basis with s as the polar axis.
  let ax = 0;
  let ay = 1;
  let az = 0;
  if (Math.abs(sy) > 0.9) {
    ax = 1;
    ay = 0;
  }
  let px = ay * sz - az * sy;
  let py = az * sx - ax * sz;
  let pz = ax * sy - ay * sx;
  const pn = Math.hypot(px, py, pz) || 1;
  px /= pn;
  py /= pn;
  pz /= pn;
  const qx = sy * pz - sz * py;
  const qy = sz * px - sx * pz;
  const qz = sx * py - sy * px;
  const ca = Math.cos(azi);
  const sa = Math.sin(azi);
  const x = sx * align + (px * ca + qx * sa) * sinT;
  const y = sy * align + (py * ca + qy * sa) * sinT;
  const z = sz * align + (pz * ca + qz * sa) * sinT;
  const n = Math.hypot(x, y, z) || 1;
  return { x: x / n, y: y / n, z: z / n, align };
}

function simParticleLook(_kind: SimParticleKind, biome: Biome, blood = false): { tint: number; add: boolean } {
  if (blood) {
    const pal = [0xee2828, 0xdd2020, 0xe83838, 0xcc1a1a, 0xf04040];
    return { tint: pal[(Math.random() * pal.length) | 0]!, add: false };
  }
  const dirt: Record<Biome, number[]> = {
    water: [0x3a3a32, 0x2a2c28],
    river: [0x4a4638, 0x2e322c],
    sand: [0xc4a06a, 0x8a6a40, 0x3a3228],
    grass: [0x6b5a32, 0x4a3c24, 0x2a2418],
    forest: [0x3d3a28, 0x2a281c, 0x1a1810],
    rock: [0x6a6860, 0x4a4844, 0x2c2c28],
    peak: [0x9a9890, 0x6e6c66, 0x3a3a38],
  };
  const pal = dirt[biome];
  return { tint: pal[(Math.random() * pal.length) | 0]!, add: false };
}

function norm3(x: number, y: number, z: number): { x: number; y: number; z: number } {
  const n = Math.hypot(x, y, z);
  if (n < 1e-6) return { x: 1, y: 0, z: 0 };
  return { x: x / n, y: y / n, z: z / n };
}

function steerDir(
  cx: number,
  cy: number,
  cz: number,
  wx: number,
  wy: number,
  wz: number,
  maxAng: number
): { x: number; y: number; z: number } {
  const c = norm3(cx, cy, cz);
  let w = norm3(wx, wy, wz);
  const dot = Phaser.Math.Clamp(c.x * w.x + c.y * w.y + c.z * w.z, -1, 1);
  const ang = Math.acos(dot);
  if (ang < 1e-5 || ang <= maxAng) return w;
  if (dot < -0.999) w = norm3(-c.y, c.x, 0);
  const t = maxAng / Math.max(ang, 1e-5);
  return norm3(c.x + (w.x - c.x) * t, c.y + (w.y - c.y) * t, c.z + (w.z - c.z) * t);
}

function ensureBlastRingGradient(textures: Phaser.Textures.TextureManager): void {
  if (textures.exists("blast_ring_soft_v9")) return;
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size * BLAST_RING_FRAMES;
  canvas.height = size;
  const g = canvas.getContext("2d")!;
  for (let frame = 0; frame < BLAST_RING_FRAMES; frame++) {
    const t = frame / (BLAST_RING_FRAMES - 1);
    const holeEase = 1 - Math.pow(1 - t, 3.5);
    const hole = 0.08 + 0.54 * holeEase;
    const remaining = 1 - hole;
    const innerSoft = hole + remaining * 0.14;
    const peak = hole + remaining * 0.34;
    const outerSoft = hole + remaining * 0.72;
    const cx = frame * size + size / 2;
    const gradient = g.createRadialGradient(cx, size / 2, 0, cx, size / 2, size / 2);
    gradient.addColorStop(0, "rgba(255,255,255,0)");
    gradient.addColorStop(hole, "rgba(255,255,255,0)");
    gradient.addColorStop(innerSoft, "rgba(160,215,255,0.54)");
    gradient.addColorStop(peak, "rgba(255,255,255,1)");
    gradient.addColorStop(outerSoft, "rgba(255,190,120,0.27)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gradient;
    g.fillRect(frame * size, 0, size, size);
    const pixels = g.getImageData(frame * size, 0, size, size);
    const source = new Uint8ClampedArray(pixels.data);
    const center = size / 2;
    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        const dx = px - center;
        const dy = py - center;
        const angle = Math.atan2(dy, dx);
        const radius = Math.hypot(dx, dy);
        const waves =
          Math.sin(angle * 3 + 0.4) * 0.55 +
          Math.sin(angle * 7 - 1.1) * 0.3 +
          Math.sin(angle * 13 + 2.2) * 0.15;
        const warpedRadius = radius - waves * (0.5 + 5 * t * t);
        const sampleX = Math.round(center + Math.cos(angle) * warpedRadius);
        const sampleY = Math.round(center + Math.sin(angle) * warpedRadius);
        const dst = (py * size + px) * 4;
        if (sampleX < 0 || sampleX >= size || sampleY < 0 || sampleY >= size) {
          pixels.data[dst + 3] = 0;
          continue;
        }
        const src = (sampleY * size + sampleX) * 4;
        pixels.data[dst] = source[src]!;
        pixels.data[dst + 1] = source[src + 1]!;
        pixels.data[dst + 2] = source[src + 2]!;
        const rays =
          Math.sin(angle * 17 + 0.8) * 0.5 +
          Math.sin(angle * 31 - 1.7) * 0.3 +
          Math.sin(angle * 53 + 2.4) * 0.2;
        const rayStrength = 0.22 + 0.28 * t * t;
        pixels.data[dst + 3] = Math.min(255, source[src + 3]! * (0.78 + rays * rayStrength));
      }
    }
    g.putImageData(pixels, frame * size, 0);
  }
  textures.addSpriteSheet("blast_ring_soft_v9", canvas as unknown as HTMLImageElement, {
    frameWidth: size,
    frameHeight: size,
    endFrame: BLAST_RING_FRAMES - 1,
  });
}

function ensureExhaustGlow(textures: Phaser.Textures.TextureManager): void {
  if (textures.exists("fx_exhaust_glow")) return;
  const w = 48;
  const h = 20;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(w * 0.5, h * 0.5, 0, w * 0.5, h * 0.5, w * 0.5);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.2, "rgba(255,255,255,0.92)");
  grad.addColorStop(0.58, "rgba(255,255,255,0.34)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.save();
  g.scale(1, h / w);
  g.fillStyle = grad;
  g.fillRect(0, 0, w, w);
  g.restore();
  textures.addCanvas("fx_exhaust_glow", c);
}

function ensureImpactGlow(textures: Phaser.Textures.TextureManager): void {
  if (textures.exists("impact_glow")) return;
  const s = 96;
  const c = document.createElement("canvas");
  c.width = s;
  c.height = s;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.2, "rgba(255,255,255,0.72)");
  grd.addColorStop(0.52, "rgba(255,255,255,0.2)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, s, s);
  textures.addCanvas("impact_glow", c);
}

function projectAlong(x: number, y: number, ang: number, tx: number, ty: number): number {
  const dx = tx - x;
  const dy = ty - y;
  return Math.max(0, dx * Math.cos(ang) + dy * Math.sin(ang));
}

function bearing(deg: number): string {
  const d = ((deg % 360) + 360) % 360;
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round(d / 45) % 8]!;
}

/** 0° = screen/world north (up), same convention as `bearing`. */
function bearingArrow(deg: number): string {
  const d = ((deg % 360) + 360) % 360;
  const arrows = ["↑", "↗", "→", "↘", "↓", "↙", "←", "↖"];
  return arrows[Math.round(d / 45) % 8]!;
}
