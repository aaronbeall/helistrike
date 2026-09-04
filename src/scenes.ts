import Phaser from "phaser";
import { bakeAll, bakeRosterArt } from "./bake";
import { bakeCamo, camoForBiome, resolveSkin } from "./camo";
import {
  fragKeys,
  heightOf,
  hulkOf,
  nextId,
  radius,
  stats,
  textureOf,
  wheelFragKeys,
  WPN_LIST,
  type Frag,
  type Shot,
  type Spark,
  type SparkKind,
  type Unit,
  type Wpn,
} from "./combat";
import { Layer, ZOff, Z_GRAVITY, worldDepth } from "./depth";
import { range } from "./rng";
import { CRUISE_AGL, HELI_HEIGHT, Heli, MAX_AGL } from "./heli";
import { isAerial, isGroundVehicle, isOrganic, specOf, driveOf, spawnAngle, pickLookoutTroop, pickPickupTroop, labelOf, allKinds, gunsOf, rollParts } from "./roster";
import { lookupSpriteMuzzles, SPRITE_MOUNT } from "./spriteOrigin";

/** Overlay guns are drawn barrel-up (same as hulls). World aim 0 is +X, so +90°. */
function gunWorldRot(_tex: string, aim: number): number {
  return aim + Math.PI / 2;
}
import { HEIGHT_BRUSHES, bakeHeightBrushes } from "./brushes";
import { SpriteConfigTool } from "./spriteConfig";
import { preloadArt, prepareArt, extractBiomeTiles, bakeHeliHudWireTexture, bakeHurtVignetteTexture, gunLayout, heliHudWireUv, rotorLayout, shadowAlpha, shadowKey, shadowOff, spriteUvPos, tankLayout, FX_VARIANTS, nameGameTexture, nameGeneratedTextures, spritePivot, type HeliHudWireBake } from "./sprites";
import {
  generateWorld,
  generateWorldAsync,
  worldFromGen,
  groundSlope,
  groundZ,
  screenLift,
  zScale,
  camZoomAt,
  castZ,
  isWater,
  paintHeightMap,
  paintHeightMapRect,
  stampHeightBrush,
  rebuildWorldPatch,
  applyTerrainLight,
  sampleBiome,
  waterSurfaceZ,
  SCALE,
  WORLD,
  WRECK_TEX,
  CamTune,
  doodadTex,
  type HvSpec,
  type WorldData,
  type Biome,
} from "./world";

const MISSILE_IGNITE = 0.525;
const HELLFIRE_LOCK_T = 0.5;
const HELLFIRE_SEEK_DELAY = 0.42;

/** Player damage interest UVs: body center, gun mount, rotor mount. */
const PLAYER_DMG_POI_UV: { u: number; v: number }[] = [
  { u: 0.5, v: 0.52 },
  { u: gunLayout.mount.x, v: gunLayout.mount.y },
  { u: rotorLayout.player.x, v: rotorLayout.player.y },
];

/** Fallback UV jitter pool when a crash has no live damage sites. */
const CRASH_DMG_UV: { u: number; v: number }[] = [
  { u: 0.32, v: 0.38 },
  { u: 0.58, v: 0.42 },
  { u: 0.45, v: 0.62 },
  { u: 0.68, v: 0.55 },
  { u: 0.38, v: 0.72 },
  { u: 0.52, v: 0.28 },
];

const LOAD_TIPS = [
  "Pop-up (SPACE) to dodge incoming fire — climb, slide, drop back into cover.",
  "Use pop-up to clear ridgelines and hit targets tucked behind terrain.",
  "Nap-of-earth (SHIFT) through ravines and river beds to break enemy line of sight.",
  "Hellfires lock onto fast movers — keep the box steady, then let them run.",
  "TOWs are ideal for killing AA from outside their envelope — stay long and wire-guide in.",
  "While a TOW is in flight, SPACE raises the missile and SHIFT drops it — steer height as well as aim.",
  "Chain gun eats soft targets; save rockets and missiles for armor and emplacements.",
  "Wounded infantry crawl and bleed — finish them before they dig in and return fire.",
  "Battleships pack mixed batteries. Prioritize the AA mount before you linger overhead.",
  "Drones charge when lined up. Sidestep the run, then hit them while they turn.",
  "Low and slow is quiet until it isn’t — pop up only for the shot, then get back in the dirt.",
  "M opens the theater map. Mark high-value sites before you commit to a gun run.",
  "Hydras shred soft clusters; Hellfires and TOWs punch hard points from stand-off.",
];

/** Scratch canvas for tinting blood dirt frames before multiply-stamping terrain. */
let bloodStampScratch: HTMLCanvasElement | null = null;

export class BootScene extends Phaser.Scene {
  constructor() {
    super("boot");
  }
  preload(): void {
    preloadArt(this);
  }
  create(): void {
    bakeAll(this.textures);
    try {
      prepareArt(this.textures);
    } catch {
      /* keep baked placeholders */
    }
    bakeRosterArt(this.textures);
    bakeCamo(this.textures);
    this.scene.start("menu");
  }
}

export class MenuScene extends Phaser.Scene {
  constructor() {
    super("menu");
  }
  create(): void {
    const { width: w, height: h } = this.scale;
    this.cameras.main.setBackgroundColor("#1c1812");
    if (this.textures.exists("menu_splash")) {
      const bg = this.add.image(w / 2, h / 2, "menu_splash").setDepth(0);
      const sx = w / bg.width;
      const sy = h / bg.height;
      bg.setScale(Math.max(sx, sy));
      this.add
        .rectangle(w / 2, h / 2, w, h, 0x0c0a08, 0.42)
        .setDepth(1)
        .setName("menu_scrim");
    }
    this.add
      .text(w / 2, h * 0.22, "HELISTRIKE", {
        fontFamily: "Black Ops One, Impact, sans-serif",
        fontSize: "72px",
        color: "#e8b84a",
        stroke: "#1c1812",
        strokeThickness: 6,
      })
      .setOrigin(0.5)
      .setDepth(2)
      .setName("menu_title");
    this.add
      .text(w / 2, h * 0.34, "TOP-DOWN GUNSHIP  ·  GULF THEATER", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "16px",
        color: "#d4cbb0",
        stroke: "#1c1812",
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setDepth(2)
      .setName("menu_sub");
    this.add
      .text(
        w / 2,
        h * 0.54,
        "WASD  thrust & strafe\nMOUSE  turn  ·  CLICK  fire  ·  1-4 / WHEEL  weapons\nSPACE  pop-up  ·  SHIFT  nap-of-earth  ·  M  map\n+ / -  time scale",
        {
          fontFamily: "Share Tech Mono, monospace",
          fontSize: "15px",
          color: "#e8e0cc",
          align: "center",
          lineSpacing: 8,
          stroke: "#1c1812",
          strokeThickness: 3,
        }
      )
      .setOrigin(0.5)
      .setDepth(2)
      .setName("menu_controls");
    const go = this.add
      .text(w / 2, h * 0.78, "[  START MISSION  ]", {
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
    nameGeneratedTextures(this);
  }
}

export class LoadScene extends Phaser.Scene {
  private body!: Phaser.GameObjects.Image;
  private rotor!: Phaser.GameObjects.Image;
  private rotorDisc!: Phaser.GameObjects.Image;
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
    this.body = this.add
      .image(hx, this.heliY, "heli_body")
      .setOrigin(rotorLayout.player.x, rotorLayout.player.y)
      .setScale(zs);
    this.rotorDisc = this.add.image(hx, this.heliY, this.textures.exists("heli_rotor_spin") ? "heli_rotor_spin" : "heli_rotor").setOrigin(0.5, 0.5).setAlpha(0);
    this.rotor = this.add.image(hx, this.heliY, "heli_rotor").setOrigin(0.5, 0.5);
    const rotorScale = (124 / this.rotor.width) * 1.08 * zs;
    this.rotor.setScale(rotorScale);
    this.rotorDisc.setScale(rotorScale * 1.04);
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
      const go = (world: WorldData) => {
        drawBar(1, "ready");
        this.time.delayedCall(240, () => this.scene.start("mission", { world }));
      };
      generateWorldAsync(seed, tiles, (t, label) => drawBar(t, label))
        .then(go)
        .catch(() => {
          go(worldFromGen(generateWorld(seed, tiles, (t, label) => drawBar(t, label))));
        });
    });
  }

  update(_t: number, dt: number): void {
    const dts = dt / 1000;
    const targetSpd = 4 + this.loadU * 30;
    this.rotorSpd = Phaser.Math.Linear(this.rotorSpd, targetSpd, 1 - Math.pow(0.14, dts));
    this.rotorAng += this.rotorSpd * dts;
    this.rotor.setRotation(this.rotorAng);
    this.rotorDisc.setRotation(this.rotorAng + Math.PI / 8);
    const disc = Phaser.Math.Clamp((this.rotorSpd - 10) / 22, 0, 1);
    this.rotor.setAlpha(1 - disc * 0.38);
    this.rotorDisc.setAlpha(disc * 0.32);
    const bob = Math.sin(_t / 420) * 1.6;
    this.body.y = this.heliY + bob;
    this.rotor.y = this.heliY + bob;
    this.rotorDisc.y = this.heliY + bob;
  }
}

export class MissionScene extends Phaser.Scene {
  world!: WorldData;
  heli!: Heli;
  units: Unit[] = [];
  shots: Shot[] = [];
  frags: Frag[] = [];
  sparks: Spark[] = [];
  ammo = WPN_LIST.map((w) => w.ammo);
  keyW!: Phaser.Input.Keyboard.Key;
  keyA!: Phaser.Input.Keyboard.Key;
  keyS!: Phaser.Input.Keyboard.Key;
  keyD!: Phaser.Input.Keyboard.Key;
  keySpace!: Phaser.Input.Keyboard.Key;
  keyShift!: Phaser.Input.Keyboard.Key;
  ground!: Phaser.GameObjects.Image;
  wreckLayer!: Phaser.GameObjects.RenderTexture;
  stampBrush!: Phaser.GameObjects.Image;
  body!: Phaser.GameObjects.Image;
  rotor!: Phaser.GameObjects.Image;
  gun!: Phaser.GameObjects.Image;
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
  fragG!: Phaser.GameObjects.Group;
  sparkG!: Phaser.GameObjects.Group;
  smoke!: Phaser.GameObjects.Particles.ParticleEmitter;
  tracer!: Phaser.GameObjects.Particles.ParticleEmitter;
  flame!: Phaser.GameObjects.Particles.ParticleEmitter;
  playerFlame!: Phaser.GameObjects.Particles.ParticleEmitter;
  hurtSmoke!: Phaser.GameObjects.Particles.ParticleEmitter;
  playerHurtSmoke!: Phaser.GameObjects.Particles.ParticleEmitter;
  burn!: Phaser.GameObjects.Particles.ParticleEmitter;
  blastBurn!: Phaser.GameObjects.Particles.ParticleEmitter;
  blastFire!: Phaser.GameObjects.Particles.ParticleEmitter;
  ember!: Phaser.GameObjects.Particles.ParticleEmitter;
  fragSmoke!: Phaser.GameObjects.Particles.ParticleEmitter;
  lingerSmoke!: Phaser.GameObjects.Particles.ParticleEmitter;
  heliDust!: Phaser.GameObjects.Particles.ParticleEmitter;
  /** Altitude-banded clones: each band keeps fire>smoke without a global restack. */
  fxSlots = new Map<Phaser.GameObjects.Particles.ParticleEmitter, Phaser.GameObjects.Particles.ParticleEmitter[]>();
  fxSlotN = 10;
  fxBandH = 22;
  muzzle!: Phaser.GameObjects.Image;
  muzzleLife = 0;
  dmgFlameScale = 1;
  trailFxScale = 1;
  playerCrashStarted = false;
  playerCrashLanded = false;
  /** <0 = waiting for crash simmer; >=0 = countdown to BIRD DOWN. */
  playerCrashEndT = -1;
  /** Scene-owned simmer so BIRD DOWN isn't lost if the hull frag is culled. */
  playerCrashSimmerT = 0;
  /** Camera post-FX (toggle with F). */
  fxBloom?: Phaser.FX.Bloom;
  fxBarrel?: Phaser.FX.Barrel;
  fxOn = true;
  fxBarrelPulse = 0;
  fxHud!: Phaser.GameObjects.Text;
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
  shake = 0;
  canFire = false;
  mapView = false;
  mapWant = false;
  mapBlend = 0;
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
  debugHit = false;
  showHeightMap = false;
  debugGfx!: Phaser.GameObjects.Graphics;
  timeScale = 1;
  spriteCfg!: SpriteConfigTool;
  debugOpen = false;
  debugRoot!: Phaser.GameObjects.Container;
  debugPanel!: Phaser.GameObjects.Graphics;
  debugRows: Phaser.GameObjects.Text[] = [];
  debugTitle!: Phaser.GameObjects.Text;
  debugSpawnOpen = false;
  debugSpawnIdx = 0;
  debugSpawnRows: Phaser.GameObjects.Text[] = [];
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
    this.shake = 0;
    this.canFire = false;
    this.mapView = false;
    this.mapWant = false;
    this.mapBlend = 0;
    this.camFollow = false;
    this.lookCamX = 0;
    this.lookCamY = 0;
    this.towLookHold = 0;
    this.towLookX = 0;
    this.towLookY = 0;
    this.playLastFrame = false;
    this.debugHit = false;
    this.fxOn = true;
    this.fxBarrelPulse = 0;
    this.showHeightMap = false;
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
    this.frags = [];
    this.sparks = [];
    this.playerCrashStarted = false;
    this.playerCrashLanded = false;
    this.playerCrashEndT = -1;
    this.playerCrashSimmerT = 0;
    this.ammo = WPN_LIST.map((w) => w.ammo);
    if (!data.world) {
      this.world = worldFromGen(generateWorld((Date.now() ^ (Math.random() * 1e9)) >>> 0, extractBiomeTiles(this.textures)));
    } else this.world = data.world;
  }

  create(): void {
    this.stampDecor();
    if (this.textures.exists("terrain")) this.textures.remove("terrain");
    this.textures.addCanvas("terrain", this.world.canvas);
    if (this.textures.exists("heightmap")) this.textures.remove("heightmap");
    this.heightMapCanvas = paintHeightMap(this.world.height);
    this.textures.addCanvas("heightmap", this.heightMapCanvas);
    this.biomeTiles = extractBiomeTiles(this.textures);
    this.input.mouse?.disableContextMenu();
    ensureImpactGlow(this.textures);
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
    this.wreckLayer.clear();
    this.stampBrush = this.make.image({ key: "fx_blast_0" }, false);

    this.unitG = this.add.group();
    this.shotG = this.add.group();
    this.fragG = this.add.group();
    this.sparkG = this.add.group();

    this.heli = new Heli(this.world.spawnX, this.world.spawnY, this.world);
    this.heli.angle = 0.6;
    this.shadow = this.add.image(0, 0, "shadow").setDepth(Layer.SHADOW);
    this.gun = this.add.image(0, 0, "heli_gun").setDepth(Layer.WORLD).setOrigin(gunLayout.origin.x, gunLayout.origin.y);
    this.body = this.add.image(0, 0, "heli_body").setDepth(Layer.WORLD).setOrigin(rotorLayout.player.x, rotorLayout.player.y);
    this.rotor = this.add.image(0, 0, "heli_rotor").setDepth(Layer.WORLD).setOrigin(0.5, 0.5);
    this.muzzle = this.add
      .image(0, 0, "fx_muzzle")
      .setDepth(Layer.WORLD)
      .setVisible(false)
      .setOrigin(0.14, 0.5)
      .setScale(0.72)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(0xfff6d0);
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
      if (host.kind === "lookout") {
        const at = this.mountAt(host, "building_lookout", SPRITE_MOUNT.building_lookout);
        posted.push(this.makeUnit(pickLookoutTroop(), at.x, at.y, host.id));
      } else if (host.kind === "bunker") {
        for (const m of SPRITE_MOUNT.building_bunker) {
          const at = this.mountAt(host, "building_bunker", m);
          posted.push(this.makeUnit(pickLookoutTroop(), at.x, at.y, host.id));
        }
      } else if (host.kind === "pickup" && Math.random() < 0.33) {
        const at = this.mountAt(host, "enemy_pickup", SPRITE_MOUNT.enemy_pickup);
        posted.push(this.makeUnit(pickPickupTroop(), at.x, at.y, host.id));
      }
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
    this.flame = this.poolFx(() =>
      this.add.particles(0, 0, "fx_flame", {
        lifespan: 480,
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
    this.playerFlame = this.poolFx(() =>
      this.add.particles(0, 0, "fx_flame", {
        lifespan: 480,
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
    this.hurtSmoke = this.poolFx(() =>
      this.add.particles(0, 0, "fx_smoke", {
        lifespan: { min: 2400, max: 4200 },
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
    this.playerHurtSmoke = this.poolFx(() =>
      this.add.particles(0, 0, "fx_smoke", {
        lifespan: { min: 2400, max: 4200 },
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
    this.burn = this.poolFx(() =>
      this.add.particles(0, 0, "fx_flame", {
        lifespan: { min: 240, max: 420 },
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
    this.blastBurn = this.poolFx(() =>
      this.add.particles(0, 0, "fx_flame", {
        lifespan: { min: 240, max: 420 },
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
    this.ember = this.poolFx(() =>
      this.add.particles(0, 0, "fx_flame", {
        lifespan: { min: 180, max: 320 },
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
    this.fragSmoke = this.poolFx(() =>
      this.add.particles(0, 0, "fx_smoke", {
        lifespan: 520,
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
    this.lingerSmoke = this.poolFx(() =>
      this.add.particles(0, 0, "fx_smoke", {
        lifespan: { min: 2200, max: 4000 },
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
    this.applyTimeScale();

    this.keyW = this.input.keyboard!.addKey("W");
    this.keyA = this.input.keyboard!.addKey("A");
    this.keyS = this.input.keyboard!.addKey("S");
    this.keyD = this.input.keyboard!.addKey("D");
    this.keySpace = this.input.keyboard!.addKey("SPACE");
    this.keyShift = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
    this.input.keyboard!.addKey("ONE").on("down", () => {
      if (this.editOpen) this.setEditBrush(0);
      else if (this.debugSpawnOpen || this.debugCamOpen) return;
      else if (this.debugOpen) this.setNoDamage(!this.noDamage);
      else this.heli.weapon = 0;
    });
    this.input.keyboard!.addKey("TWO").on("down", () => {
      if (this.editOpen) this.setEditBrush(1);
      else if (this.debugSpawnOpen || this.debugCamOpen) return;
      else if (this.debugOpen) this.setInfAmmo(!this.infAmmo);
      else this.heli.weapon = 1;
    });
    this.input.keyboard!.addKey("THREE").on("down", () => {
      if (this.editOpen) this.setEditBrush(2);
      else if (this.debugSpawnOpen || this.debugCamOpen) return;
      else if (this.debugOpen) this.setDebugAi(!this.debugAi);
      else this.heli.weapon = 2;
    });
    this.input.keyboard!.addKey("FOUR").on("down", () => {
      if (this.debugSpawnOpen || this.debugCamOpen) return;
      if (this.debugOpen) this.openDebugCam();
      else this.heli.weapon = 3;
    });
    this.input.keyboard!.addKey("FIVE").on("down", () => {
      if (this.debugOpen && !this.debugSpawnOpen && !this.debugCamOpen) this.openDebugSpawn();
    });
    this.input.keyboard!.addKey("E").on("down", () => this.toggleReliefEditor());
    this.input.keyboard!.addKey("I").on("down", () => {
      if (this.editOpen) this.toggleEditInvert();
    });
    this.input.keyboard!.addKey("M").on("down", () => this.toggleMap());
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
      if (this.debugSpawnOpen) this.nudgeDebugSpawn(-1);
      else if (this.debugCamOpen) this.nudgeDebugCam(-1);
      else if (this.spriteCfg?.open) this.spriteCfg.cycle(-1);
      else if (this.editOpen) this.nudgeEditSize(-1);
    });
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.CLOSED_BRACKET).on("down", () => {
      if (this.debugSpawnOpen) this.nudgeDebugSpawn(1);
      else if (this.debugCamOpen) this.nudgeDebugCam(1);
      else if (this.spriteCfg?.open) this.spriteCfg.cycle(1);
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
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.FORWARD_SLASH).on("down", () => this.toggleDebugMenu());
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ESC).on("down", () => {
      if (this.debugCamOpen) this.closeDebugCam();
      else if (this.debugSpawnOpen) this.closeDebugSpawn();
      else if (this.editOpen) this.toggleReliefEditor(false);
      else if (this.debugOpen) this.toggleDebugMenu(false);
    });
    this.input.keyboard!.addKey("R").on("down", () => {
      if (this.editOpen && !this.over) this.nudgeEditRot(1);
      else if (this.over) this.scene.start("load");
    });
    const bumpTime = (dir: number) => {
      if (this.debugCamOpen) this.nudgeDebugCam(dir);
      else this.nudgeTimeScale(dir);
    };
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.PLUS).on("down", () => bumpTime(1));
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.NUMPAD_ADD).on("down", () => bumpTime(1));
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.MINUS).on("down", () => bumpTime(-1));
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.NUMPAD_SUBTRACT).on("down", () => bumpTime(-1));
    this.spriteCfg = new SpriteConfigTool(this, (key) => this.spriteOrigin(key));
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.F9).on("down", () => this.spriteCfg.toggle());
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.BACKTICK).on("down", () => this.spriteCfg.toggle());
    this.input.keyboard!.addKey("F").on("down", () => this.toggleTestFx());
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.UP).on("down", () => {
      if (this.debugSpawnOpen) this.nudgeDebugSpawn(-1);
      else if (this.debugCamOpen) this.nudgeDebugCamSel(-1);
      else if (this.debugOpen) this.nudgeDebugMenu(-1);
      else if (this.spriteCfg?.open) this.spriteCfg.cycle(-1);
    });
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN).on("down", () => {
      if (this.debugSpawnOpen) this.nudgeDebugSpawn(1);
      else if (this.debugCamOpen) this.nudgeDebugCamSel(1);
      else if (this.debugOpen) this.nudgeDebugMenu(1);
      else if (this.spriteCfg?.open) this.spriteCfg.cycle(1);
    });
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT).on("down", () => {
      if (this.debugCamOpen) this.nudgeDebugCam(-1);
    });
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT).on("down", () => {
      if (this.debugCamOpen) this.nudgeDebugCam(1);
    });
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER).on("down", () => {
      if (this.debugSpawnOpen) this.debugSpawnSelected();
      else if (this.debugOpen && !this.debugCamOpen) this.activateDebugRow(this.debugMenuIdx);
    });
    this.input.on("wheel", (_p: Phaser.Input.Pointer, _dx: number, dy: number) => {
      if (this.debugCamOpen) {
        this.nudgeDebugCam(dy > 0 ? -1 : 1);
        return;
      }
      if (this.debugSpawnOpen) {
        this.nudgeDebugSpawn(dy > 0 ? 1 : -1);
        return;
      }
      if (this.spriteCfg?.open) {
        this.spriteCfg.cycle(dy > 0 ? 1 : -1);
        return;
      }
      if (this.editOpen) {
        this.nudgeEditSize(dy > 0 ? -1 : 1);
        return;
      }
      if (this.debugOpen) return;
      if (dy > 0) this.heli.weapon = (this.heli.weapon + 1) % 4;
      else this.heli.weapon = (this.heli.weapon + 3) % 4;
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
    this.wpnSlots = WPN_LIST.map(() =>
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
      this.heliHudWireSh = this.add.image(0, 0, "heli_body").setVisible(false).setScrollFactor(0);
      this.heliHudWire = this.add.image(0, 0, "heli_body").setVisible(false).setScrollFactor(0).setDepth(Layer.HUD + 11);
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
    this.miniWrecks = this.add.image(cx, cy, "wrecks").setScrollFactor(0).setDepth(Layer.HUD);
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
    this.setupHudCam();
    this.lockTxt.setName("hud_lock");
    this.lockInbdTxt.setName("hud_fire");
    this.lockHudTxt.setName("hud_lock_offscreen");
    this.lockInbdHudTxt.setName("hud_fire_offscreen");
    this.hud.setName("hud_status");
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

  /** Screen scale matching live sprites (`zScale` + optional ground slope). */
  wreckDrawScale(
    x: number,
    y: number,
    z: number,
    scale = 1,
    slope = false
  ): { sx: number; sy: number } {
    const zs = zScale(z);
    if (!slope) return { sx: scale * zs, sy: scale * zs };
    const sl = groundSlope(this.world, x, y);
    return {
      sx: scale * (1 + Phaser.Math.Clamp(Math.abs(sl.dx), 0, 0.4) * 0.22) * zs,
      sy: scale * (1 - Phaser.Math.Clamp(sl.dy, -0.45, 0.45) * 0.2) * zs,
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
      const sc = range(0.38, 0.8);
      const stretch = range(0.75, 1.65) + Math.min(0.5, spd * 0.0018);
      const thin = range(0.2, 0.38);
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
   * Paint a blood dirt particle onto the terrain with multiply (does not alter the live spark).
   * Matches mid-life dirt size/rotation from syncSparkSprites.
   */
  stampBloodWorld(s: Spark): void {
    if (!s.blood || isWater(this.world, s.x, s.y) || !this.textures.exists(s.tex)) return;
    const age = 1 - Phaser.Math.Clamp(s.life / Math.max(s.max, 1e-6), 0, 1);
    const fade = 1 - age;
    const grow = 1 - Math.pow(1 - age, 3.4);
    const thick = s.scale * (0.06 + 3.6 * grow);
    const late = Math.pow(Phaser.Math.Clamp((age - 0.52) / 0.48, 0, 1), 1.7);
    const sx = thick * (0.85 + 0.55 * grow);
    const sy = thick * (0.28 + 0.42 * late);
    const rot = s.heading + s.angJit * 0.14;
    const zs = zScale(s.z);
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

    const dw = (tw * sx * zs) / SCALE;
    const dh = (th * sy * zs) / SCALE;
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

  fragStampOrigin(key: string): { x: number; y: number } {
    return spritePivot(key);
  }

  update(_t: number, dms: number): void {
    if (this.spriteCfg?.open) {
      this.spriteCfg.update();
      this.reticle.setVisible(false);
      this.reticleMark.setVisible(false);
      this.reticleMark.clear();
      this.sight.setVisible(false);
      this.sight.clear();
      return;
    }
    const wallDt = Math.min(dms / 1000, 0.05);
    const mapPause = this.mapWant || this.mapBlend > 0.02;
    const dt = mapPause ? 0 : wallDt * this.timeScale;
    this.setSimTimeScale(mapPause ? 0 : this.timeScale);
    if (this.over) {
      this.drawMinimap();
      this.drawPlayerHud();
      this.towWireGfx.clear();
      return;
    }
    this.syncPlayView();
    this.updateTheaterCam(wallDt);

    if (!mapPause) {
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

      this.syncHeliGfx(dt);
      this.handleFire(dt);
      if (this.muzzleLife > 0) {
        this.muzzleLife -= dt;
        if (this.muzzleLife <= 0) this.muzzle.setVisible(false);
      }
      this.updateUnits(dt);
      this.updateShots(dt);
      if (this.heli.phase === "dead" && !this.playerCrashStarted) this.beginPlayerCrash();
      this.updateFrags(dt);
      this.updateSparks(dt);
      this.updateLock();
      this.drawUnitBars();
      this.emitDamageFx();
      this.emitHeliCrashDmgFlames();
      this.drawDebugHits();
    }

    if (this.editOpen) this.handleReliefEdit(wallDt);
    this.drawDebugAi();

    if (this.mapBlend < 0.001) this.syncLookCam(wallDt);

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
      this.cameras.main.shake(80, this.shake * 0.002);
      this.shake *= 0.85;
    }
    this.tickTestPostFx(wallDt);

    const hvLeft = this.world.hv.filter((h) =>
      this.units.some((u) => u.hv === h.id && !u.dead)
    );
    if (hvLeft.length === 0) this.end(true);
    if (this.heli.phase === "dead") {
      if (!this.playerCrashStarted) this.beginPlayerCrash();
      else if (this.playerCrashLanded && this.playerCrashEndT < 0) {
        this.playerCrashSimmerT -= wallDt;
        if (this.playerCrashSimmerT <= 0) this.playerCrashEndT = 0.55;
      } else if (this.playerCrashLanded && this.playerCrashEndT >= 0) {
        this.playerCrashEndT -= wallDt;
        if (this.playerCrashEndT <= 0) this.end(false);
      }
    }
  }

  spriteOrigin(key: string): { x: number; y: number } {
    if (key === "heli_rotor") return { x: this.rotor.originX, y: this.rotor.originY };
    return spritePivot(key);
  }

  makeUnit(kind: Unit["kind"], x: number, y: number, pinId?: number): Unit {
    const st = stats(kind);
    const sp = specOf(kind);
    const parts = rollParts(kind);
    const guns = gunsOf({ kind, parts });
    return {
      id: nextId(),
      kind,
      x,
      y,
      z: sp.aerial ? groundZ(this.world, x, y) + CRUISE_AGL : groundZ(this.world, x, y),
      vx: 0,
      vy: 0,
      angle: spawnAngle(kind),
      turret: Math.random() * Math.PI * 2,
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
      parts,
      camo: kind === "lav_aa" ? "digital" : camoForBiome(sampleBiome(this.world, x, y)),
    };
  }

  mountAt(host: Unit, tex: string, mount: { x: number; y: number }): { x: number; y: number } {
    const pivot = spritePivot(tex);
    const rot = host.angle + specOf(host.kind).rotOff;
    const img = this.textures.exists(tex)
      ? (this.textures.get(tex).getSourceImage() as { width: number; height: number })
      : { width: 52, height: 52 };
    const zs = zScale(host.z);
    const mx = (mount.x - pivot.x) * img.width * zs;
    const my = (mount.y - pivot.y) * img.height * zs;
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
    const mount = gun.tex === "enemy_tank_gun" ? tankLayout.mountOrigin : gun.mount;
    return this.mountAt(u, resolveSkin(this.textures, textureOf(u.kind), u.camo), mount);
  }

  lookoutPost(look: Unit): { x: number; y: number } {
    return this.mountAt(look, "building_lookout", SPRITE_MOUNT.building_lookout);
  }

  pickupHost(u: Unit): Unit | undefined {
    if (u.pinId == null) return undefined;
    const post = this.units.find((p) => p.id === u.pinId);
    return post && !post.dead && post.kind === "pickup" ? post : undefined;
  }

  leashPinned(u: Unit): void {
    if (u.pinId == null) return;
    const post = this.units.find((p) => p.id === u.pinId);
    if (!post || post.dead) {
      u.pinId = undefined;
      return;
    }
    if (post.kind === "pickup") {
      const at = this.mountAt(post, "enemy_pickup", SPRITE_MOUNT.enemy_pickup);
      u.x = at.x;
      u.y = at.y;
      return;
    }
    const r = radius(post.kind);
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
    scale = 1
  ): void {
    const cast = castZ(this.world, x, y, z);
    const so = shadowOff(cast);
    const sk = this.textures.exists(shadowKey(tex, cast)) ? shadowKey(tex, cast) : "shadow";
    sh.setTexture(sk)
      .setPosition(x + so.x, y + so.y)
      .setRotation(rot)
      .setAlpha(shadowAlpha(cast))
      .setScale(scale * zScale(z) * (1 + cast * 0.004))
      .setDepth(Layer.SHADOW);
  }

  syncHeliGfx(dt = 1 / 60): void {
    const h = this.heli;
    if (h.phase === "dead") {
      this.body.setVisible(false);
      this.rotor.setVisible(false);
      this.gun.setVisible(false);
      this.shadow.setVisible(false);
      this.muzzle.setVisible(false);
      return;
    }
    this.applyCastShadow(this.shadow, h.x, h.y, h.z, "heli_body", h.angle + Math.PI / 2);
    this.shadow.setOrigin(rotorLayout.player.x, rotorLayout.player.y);
    const lift = screenLift(h.z);
    const zs = zScale(h.z);
    const bob = h.phase === "flight" ? Math.sin(this.time.now * 0.0026) * 2.2 * zs : 0;
    this.body.setOrigin(rotorLayout.player.x, rotorLayout.player.y);
    this.body.setPosition(h.x, h.y - lift - bob);
    this.body.setRotation(h.angle + Math.PI / 2);
    const sx = 1 + Math.abs(h.roll) * 0.12;
    const sy = 1 - Math.abs(h.pitch) * 0.14;
    this.body.setScale(sx * zs, sy * zs);
    this.rotor.setOrigin(0.5, 0.5);
    const ca = Math.cos(h.angle);
    const sa = Math.sin(h.angle);
    const rOffF = h.pitch * 16 * zs;
    const rOffS = h.roll * 14 * zs;
    this.rotor.setPosition(
      this.body.x + ca * rOffF - sa * rOffS,
      this.body.y + sa * rOffF + ca * rOffS
    );
    const mount = spriteUvPos(this.body, gunLayout.mount.x, gunLayout.mount.y);
    this.gun.setPosition(mount.x, mount.y);
    this.rotor.setRotation(h.rotor);
    this.gun.setRotation(h.gunAngle + Math.PI / 2);
    const spinKey = "heli_rotor_spin";
    const useSpin = h.rotorSpd >= 16 && this.textures.exists(spinKey);
    const rotorKey = useSpin ? spinKey : "heli_rotor";
    if (this.rotor.texture.key !== rotorKey) this.rotor.setTexture(rotorKey);
    this.rotor.setScale((this.liveRotorDrawPx("heli_rotor") / Math.max(this.rotor.width, 1)) * zs);
    this.gun.setScale(zs);
    this.rotor.setAlpha(1);
    this.body.setDepth(worldDepth(h.z, ZOff.body));
    this.rotor.setDepth(worldDepth(h.z, ZOff.rotor));
    this.gun.setDepth(worldDepth(h.z, ZOff.gun));
    this.muzzle.setDepth(worldDepth(h.z, ZOff.muzzle));
    this.syncReticles();
    this.emitDustOff(dt);
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
    const sy = h.y - screenLift(gnd);
    this.heliDust.setDepth(worldDepth(gnd, 0.2));
    const puffs = Math.max(0, Math.round((takeoff ? 0.4 + power * 4.5 : 0.6 + power * 1.4) * rate));
    for (let i = 0; i < puffs; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = range(16, 56 + power * 36);
      this.heliDust.setEmitterAngle(Phaser.Math.RadToDeg(a) + (Math.random() - 0.5) * 28);
      this.heliDust.emitParticleAt(h.x + Math.cos(a) * r, sy + Math.sin(a) * r * 0.55, 1);
    }
    if (wet) return;
    const n = Math.max(0, Math.round((takeoff ? 0.5 + power * 9 : 1 + power * 3) * rate));
    if (n < 1) return;
    const extra = this.sparks.length + n - 360;
    if (extra > 0) this.sparks.splice(0, extra);
    const biome = sampleBiome(this.world, h.x, h.y);
    const spinSign = h.rotorSpd >= 0 ? 1 : -1;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const r0 = range(8, 26);
      const spd = range(420, 800) * (0.35 + power * 0.9);
      const life = range(0.48, 0.86);
      const look = sparkLook("dirt", biome);
      this.sparks.push({
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
        tex: sparkTexKey("dirt"),
        frame: (Math.random() * FX_VARIANTS) | 0,
        angJit: range(-0.06, 0.06),
        spin: spinSign * range(0.8, 2.6),
        tint: look.tint,
        additive: look.add,
        heading: a,
        dart: true,
        ox: h.x,
        oy: h.y,
        swirl: spinSign * range(120, 300),
      });
    }
  }

  emitDustShock(x: number, y: number, power = 1): void {
    const gnd = groundZ(this.world, x, y);
    const wet = isWater(this.world, x, y);
    const sy = y - screenLift(gnd);
    const ring = this.add.circle(x, sy, 8, 0xd2c09a, 0.62).setDepth(worldDepth(gnd, 0.45));
    this.tweens.add({
      targets: ring,
      radius: 58 + power * 48,
      alpha: 0,
      duration: 380,
      ease: "Cubic.Out",
      onComplete: () => ring.destroy(),
    });
    if (wet) return;
    const n = Math.round(64 * power);
    const extra = this.sparks.length + n - 360;
    if (extra > 0) this.sparks.splice(0, extra);
    const biome = sampleBiome(this.world, x, y);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + range(-0.12, 0.12);
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const spd = range(220, 420) * (0.92 + power * 0.1);
      const life = range(0.78, 1.25);
      const look = sparkLook("dirt", biome);
      const tint = Phaser.Display.Color.Interpolate.ColorWithColor(
        Phaser.Display.Color.IntegerToColor(look.tint),
        Phaser.Display.Color.IntegerToColor(0xd8c9a4),
        100,
        42
      );
      this.sparks.push({
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
        tex: sparkTexKey("dirt"),
        frame: (Math.random() * FX_VARIANTS) | 0,
        angJit: range(-0.04, 0.04),
        spin: 0,
        tint: Phaser.Display.Color.GetColor(tint.r, tint.g, tint.b),
        additive: false,
        heading: a,
        shock: true,
      });
    }
  }

  syncReticles(): void {
    const p = this.input.activePointer;
    this.reticle.setPosition(p.x, p.y);
    const h = this.heli;
    const aim = this.worldPointer();
    const wpn = WPN_LIST[h.weapon]!.id;
    const missile = wpn !== "cannon";
    this.reticle.setTexture(missile && this.textures.exists("reticle_sq") ? "reticle_sq" : "reticle");
    this.drawReticleTally(p.x, p.y, missile ? (this.ammo[h.weapon] ?? 0) : 0, WPN_LIST[h.weapon]!.ammo);
    if (wpn === "hellfire") {
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
      const tip = this.gunTip();
      wx = tip.x;
      wy = tip.y;
      ox = this.gun.x;
      oy = this.gun.y;
      const dist = Math.hypot(aim.x - h.x, aim.y - h.y);
      bx = h.x + Math.cos(h.gunAngle) * dist;
      by = h.y + Math.sin(h.gunAngle) * dist;
    } else {
      const pylon = this.missilePylon();
      wx = pylon.x;
      wy = pylon.y;
      ox = pylon.x;
      oy = pylon.y - screenLift(h.z);
      const along = Math.max(80, projectAlong(pylon.x, pylon.y, h.angle, aim.x, aim.y));
      bx = pylon.x + Math.cos(h.angle) * along;
      by = pylon.y + Math.sin(h.angle) * along;
    }
    const air = this.hoverAerial(bx, by);
    const bz = air ? air.z + heightOf(air.kind) * 0.5 : groundZ(this.world, bx, by);
    const clip = this.sightTerrainHitWorld(wx, wy, oz, bx, by, bz);
    const from = this.worldToHud(ox, oy);
    const to = this.worldToHud(clip.x, clip.y - screenLift(clip.z));
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

  gunTip(): { x: number; y: number } {
    const d = this.gun.displayHeight * this.gun.originY * 0.92;
    const a = this.heli.gunAngle;
    return {
      x: this.gun.x + Math.cos(a) * d,
      y: this.gun.y + Math.sin(a) * d,
    };
  }

  missilePylon(): { x: number; y: number } {
    const h = this.heli;
    const slot = h.weapon;
    const ammo = this.ammo[slot] ?? 0;
    const side = ammo % 2 === 0 ? 1 : -1;
    const span = WPN_LIST[slot]?.id === "tow" ? 24 : 22;
    return {
      x: h.x + Math.cos(h.angle + Math.PI / 2) * span * side,
      y: h.y + Math.sin(h.angle + Math.PI / 2) * span * side,
    };
  }

  handleFire(dt: number): void {
    const h = this.heli;
    if (h.phase !== "flight" || !this.canFire || this.debugOpen || this.editOpen) return;
    const wpn = WPN_LIST[h.weapon]!.id;
    const ptr = this.worldPointer();
    const down = this.input.activePointer.isDown;

    if (wpn === "cannon" && down && h.fireCd <= 0) {
      h.fireCd = 0.07;
      const spread = (Math.random() - 0.5) * 0.08;
      const air = this.hoverAerial(ptr.x, ptr.y);
      const ang = h.gunAngle + spread;
      const spd = 780;
      const tip = this.gunTip();
      const tipY = tip.y + screenLift(h.z);
      const z0 = h.z + ZOff.shot;
      const along = projectAlong(tip.x, tipY, ang, air ? air.x : ptr.x, air ? air.y : ptr.y);
      const dist = Math.max(80, along);
      const t = dist / spd;
      const tx = tip.x + Math.cos(ang) * dist;
      const ty = tipY + Math.sin(ang) * dist;
      const tz = air ? air.z + heightOf(air.kind) * 0.5 : groundZ(this.world, tx, ty);
      this.spawnShot({
        kind: "cannon",
        from: "player",
        x: tip.x,
        y: tipY,
        z: z0,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        vz: (tz - z0) / t,
        angle: ang,
        life: t + (air ? 0.55 : 0.08),
        blast: 18,
        dmg: 8,
        tracer: "chain",
      });
      this.spawnSparks(tip.x, tipY, h.z, {
        style: "muzzle",
        n: 6,
        spdMin: 220,
        spdMax: 520,
        bx: Math.cos(ang),
        by: Math.sin(ang),
        bz: (tz - z0) / Math.max(40, dist),
        tight: 0.9,
      });
      this.tracer.setDepth(worldDepth(z0, ZOff.muzzle));
      this.tracer.emitParticleAt(tip.x, tip.y, 5);
      this.showMuzzle(tip.x, tip.y, ang, 0.78 * zScale(h.z), 0.1);
    }

    if (wpn === "rocket" && down && h.fireCd <= 0 && this.hasAmmo(1)) {
      h.fireCd = 0.22;
      const { x: px, y: py } = this.missilePylon();
      this.spendAmmo(1);
      const air = this.hoverAerial(ptr.x, ptr.y);
      const along = projectAlong(px, py, h.angle, air ? air.x : ptr.x, air ? air.y : ptr.y);
      const dist = Math.max(80, along);
      const t = dist / 620;
      const tx = px + Math.cos(h.angle) * dist;
      const ty = py + Math.sin(h.angle) * dist;
      const tz = air ? air.z + heightOf(air.kind) * 0.5 : groundZ(this.world, tx, ty);
      this.spawnShot({
        kind: "rocket",
        from: "player",
        x: px,
        y: py,
        z: h.z + ZOff.shot,
        vx: Math.cos(h.angle) * 620,
        vy: Math.sin(h.angle) * 620,
        vz: (tz - h.z) / t,
        angle: h.angle,
        life: t + 0.08,
        blast: 140,
        dmg: 110,
      });
      this.missileMuzzle(px, py, h.z, h.angle);
    }

    this.tickHellfireLock(dt, ptr);
    if (wpn === "hellfire") {
      if (
        down &&
        h.fireCd <= 0 &&
        this.hasAmmo(2) &&
        h.hellfireLock
      ) {
        h.fireCd = 0.55;
        const { x: px, y: py } = this.missilePylon();
        this.spendAmmo(2);
        const kick = 380;
        const side = (this.ammo[2] ?? 0) % 2 === 0 ? 1 : -1;
        this.spawnShot({
          kind: "hellfire",
          from: "player",
          x: px,
          y: py,
          z: h.z + ZOff.shot,
          vx: h.vx + Math.cos(h.angle) * kick,
          vy: h.vy + Math.sin(h.angle) * kick,
          vz: h.vz,
          angle: h.angle,
          life: 4.9,
          targetId: h.hellfireLock.id,
          blast: 175,
          dmg: 185,
          motor: -MISSILE_IGNITE,
          yaw: side * (1.05 + Math.random() * 0.45),
        });
        this.missileMuzzle(px, py, h.z, h.angle);
      }
    }

    if (wpn === "tow" && down && h.fireCd <= 0 && this.hasAmmo(3)) {
      h.fireCd = 1.1;
      const { x: px, y: py } = this.missilePylon();
      this.spendAmmo(3);
      const side = (this.ammo[3] ?? 0) % 2 === 0 ? 1 : -1;
      this.spawnShot({
        kind: "tow",
        from: "player",
        x: px,
        y: py,
        z: h.z + ZOff.shot,
        vx: h.vx + Math.cos(h.angle) * 400,
        vy: h.vy + Math.sin(h.angle) * 400,
        vz: h.vz,
        angle: h.angle,
        life: 5.2,
        blast: 160,
        dmg: 170,
        guided: true,
        motor: -(MISSILE_IGNITE + 0.06),
        cruise: 300,
        yaw: side * (0.42 + Math.random() * 0.22),
        wireSide: -side,
        wire: [],
      });
      this.missileMuzzle(px, py, h.z, h.angle);
    }
  }

  missileMuzzle(x: number, y: number, z: number, ang: number): void {
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    this.spawnSparks(x, y, z, {
      style: "muzzle",
      n: 12,
      spdMin: 200,
      spdMax: 520,
      bx: ca,
      by: sa,
      bz: 0.2,
      tight: 0.84,
    });
    const sx = x;
    const sy = y - screenLift(z);
    this.showMuzzle(sx, sy, ang, 0.62 * zScale(z), 0.12);
  }

  showMuzzle(x: number, y: number, ang: number, scale: number, life: number): void {
    const sc = scale * range(0.9, 1.12);
    const rot = ang + range(-0.1, 0.1);
    this.muzzle
      .setVisible(true)
      .setFrame((Math.random() * FX_VARIANTS) | 0)
      .setOrigin(0.14, 0.5)
      .setPosition(x, y)
      .setRotation(rot)
      .setScale(sc)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(0xfff6d0)
      .setAlpha(1)
      .setDepth(worldDepth(this.heli.z, ZOff.muzzle));
    this.muzzleLife = life;
    this.spawnMuzzleLight(x, y, this.heli.z, 26 * sc);
  }

  /** Soft additive light bloom under a muzzle flash. */
  spawnMuzzleLight(x: number, y: number, z: number, size: number): void {
    this.spawnImpactFlash(x, y, z, 0xfff2c8, Math.max(14, size), 0.5, 70);
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
    const glow = this.add
      .image(x, y, "impact_glow")
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(tint)
      .setDisplaySize(size, size)
      .setAlpha(alpha)
      .setDepth(worldDepth(z, 2.8));
    this.tweens.add({
      targets: glow,
      alpha: 0,
      duration,
      ease: "Quad.Out",
      onComplete: () => glow.destroy(),
    });
  }

  spawnShot(s: Shot): void {
    this.shots.push(s);
  }

  spawnSparks(
    x: number,
    y: number,
    z: number,
    opt: {
      style: "muzzle" | "ground" | "water" | "object";
      n: number;
      spdMin: number;
      spdMax: number;
      bx: number;
      by: number;
      bz: number;
      tight: number;
      sparkFrac?: number;
      scaleMul?: number;
      forceKind?: SparkKind;
      blood?: boolean;
      /**
       * Exponential travel-dir bias (missile / chain-gun mech hits).
       * Concentration k for direction sampling; speed scales with alignment.
       */
      expBias?: number;
    }
  ): void {
    const extra = this.sparks.length + opt.n - 280;
    if (extra > 0) this.sparks.splice(0, extra);
    const biome = sampleBiome(this.world, x, y);
    const k = opt.expBias;
    for (let i = 0; i < opt.n; i++) {
      const kind = opt.forceKind ?? pickSparkKind(opt.style, opt.sparkFrac);
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
        const reverse = opt.style === "object" && Math.random() < 0.5;
        const d = biasedDir(opt.bx, opt.by, opt.bz, opt.tight, reverse);
        dx = d.x;
        dy = d.y;
        dz = d.z;
      }
      const onUnit = opt.style === "object" && opt.forceKind !== "flame";
      const impact = opt.style !== "muzzle" && opt.forceKind !== "flame";
      const spd =
        range(opt.spdMin, opt.spdMax) *
        spdMul *
        (kind === "dirt" && opt.style === "ground" ? 1.25 : 1) *
        (onUnit ? 2.42 : impact ? 1.32 : 1);
      let life =
        kind === "dirt"
          ? range(0.45, 0.8)
          : kind === "spark"
            ? range(0.42, 0.74)
            : kind === "splash"
              ? range(0.32, 0.6)
              : range(0.18, 0.4);
      if (onUnit) life *= kind === "spark" ? 0.38 : 0.5;
      const look = sparkLook(kind, biome, opt.blood);
      const vx = dx * spd;
      const vy = dy * spd;
      const vz = dz * spd + (onUnit ? 0 : kind === "dirt" || kind === "splash" ? 50 : 20);
      const sizeMul =
        (opt.scaleMul ?? (opt.style === "muzzle" ? 0.3 : 1)) *
        (kind === "spark" && opt.style === "ground" ? 0.42 : 1) *
        (impact ? 0.74 : 1) *
        (k != null ? Phaser.Math.Linear(0.72, 1.12, spdMul) : 1);
      const angW = kind === "dirt" ? 0.175 : kind === "spark" ? 0.09 : 0.425;
      const spinW = kind === "dirt" ? 1.2 : 3;
      this.sparks.push({
        x,
        y,
        z: z + range(1, 5),
        vx,
        vy,
        vz,
        life,
        max: life,
        scale:
          (kind === "dirt" ? range(0.52, 0.8) : kind === "spark" ? range(0.65, 1.15) : range(0.45, 1)) *
          sizeMul,
        bounces: onUnit ? 0 : kind === "flame" ? 1 : kind === "splash" ? 2 : 2 + ((Math.random() * 3) | 0),
        kind,
        tex: sparkTexKey(kind),
        frame: (Math.random() * FX_VARIANTS) | 0,
        angJit: onUnit ? 0 : range(-angW, angW),
        spin: onUnit ? 0 : range(-spinW, spinW),
        tint: look.tint,
        additive: look.add,
        heading: Math.atan2(vy - screenLift(vz), vx),
        streak: opt.style === "muzzle",
        blood: opt.blood,
        straight: onUnit,
      });
    }
  }

  updateSparks(dt: number): void {
    const live: Spark[] = [];
    const drag = Math.pow(0.045, dt);
    const sparkDrag = Math.pow(0.5, dt);
    const zDrag = Math.pow(0.18, dt);
    let bloodDirty = false;
    for (const s of this.sparks) {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.z += s.vz * dt;
      if ((s.kind === "dirt" || s.kind === "spark") && !s.shock && !s.straight) {
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
        const swirl = s.swirl * (0.12 + edge * 1.4);
        s.vx += tx * swirl * dt;
        s.vy += ty * swirl * dt;
        s.vz *= Math.pow(0.4, dt);
      } else if (s.shock) {
        s.vx *= Math.pow(0.64, dt);
        s.vy *= Math.pow(0.64, dt);
        s.vy += 165 * dt;
        s.vz -= Z_GRAVITY * 0.42 * dt;
      } else if (s.straight) {
        /* keep launch velocity */
      } else if (s.dart) {
        s.vx *= Math.pow(0.72, dt);
        s.vy *= Math.pow(0.72, dt);
        s.vz *= Math.pow(0.55, dt);
      } else {
        const xyDrag = s.kind === "spark" ? sparkDrag : drag;
        s.vx *= xyDrag;
        s.vy *= xyDrag;
        s.vz *= zDrag;
      }
      if (s.kind === "flame" && !s.straight) {
        s.vy -= 90 * dt;
        s.vz += 170 * dt;
      }
      s.life -= dt;
      const g = groundZ(this.world, s.x, s.y);
      if (s.z < g && !s.straight) {
        s.z = g;
        if (s.shock) {
          if (s.vz < 0) s.vz = 0;
        } else if (s.dart) {
          s.vz = Math.max(2, -s.vz * 0.12);
        } else if (s.bounces > 0 && s.vz < -30) {
          s.bounces--;
          s.vz = -s.vz * (s.kind === "dirt" ? 0.18 : 0.38);
          const spd = Math.hypot(s.vx, s.vy);
          const jit = range(-spd * 0.25, spd * 0.25);
          s.vx = (s.vx + jit) * 0.55;
          s.vy = (s.vy + range(-spd * 0.25, spd * 0.25)) * 0.55;
        } else {
          s.vz = 0;
          s.vx *= 0.35;
          s.vy *= 0.35;
          s.life = Math.min(s.life, 0.06);
        }
      }
      if (s.blood && !s.stamped && s.life / s.max <= 0.5) {
        s.stamped = true;
        this.stampBloodWorld(s);
        bloodDirty = true;
      }
      if (s.life > 0) live.push(s);
    }
    this.sparks = live;
    if (bloodDirty && this.textures.exists("terrain")) {
      (this.textures.get("terrain") as Phaser.Textures.CanvasTexture).refresh();
    }
    this.syncSparkSprites();
  }

  syncSparkSprites(): void {
    while (this.sparkG.getLength() < this.sparks.length) {
      this.sparkG.add(this.add.image(0, 0, "fx_spark").setScale(0.7));
    }
    const kids = this.sparkG.getChildren() as Phaser.GameObjects.Image[];
    for (const k of kids) k.setVisible(false);
    this.sparks.forEach((s, i) => {
      const im = kids[i]!;
      const fade = Phaser.Math.Clamp(s.life / s.max, 0, 1);
      const age = 1 - fade;
      const spd = Math.hypot(s.vx, s.vy, s.vz);
      const dirt = s.kind === "dirt";
      const spark = s.kind === "spark";
      const flame = s.kind === "flame";
      const streak = flame && s.streak;
      const dart = dirt && s.dart;
      const shock = dirt && s.shock;
      const grow = 1 - Math.pow(1 - age, 3.4);
      const edge =
        dart && s.ox != null && s.oy != null
          ? Phaser.Math.Clamp((Math.hypot(s.x - s.ox, s.y - s.oy) - 40) / 110, 0, 1)
          : 0;
      const round = dart ? Math.max(edge, Phaser.Math.Clamp(1 - spd / 220, 0, 1)) : 0;
      const stretch = s.straight
        ? Math.min(3.15, 1 + spd * 0.0017)
        : shock
          ? Math.min(2.8, 1 + spd * 0.0022)
          : 1 + spd * (spark ? 0.011 : streak ? 0.0064 : dart ? 0.0052 : 0.0048);
      const thick = shock
        ? s.scale * (1.05 + 0.95 * age)
        : dart
        ? s.scale * (0.78 + 0.35 * fade + 0.45 * round)
        : dirt
          ? s.scale * (0.06 + 3.6 * grow)
          : s.scale * (spark ? 0.48 + fade * 0.42 : 0.4 + fade * 0.7);
      const scrX = s.vx;
      const scrY = s.vy - screenLift(s.vz);
      const heading = Math.atan2(scrY, scrX);
      const rot = s.straight || shock
        ? s.heading
        : dart
        ? heading + s.angJit * 0.08 + age * s.spin * (0.15 + round * 0.7)
        : dirt
          ? s.heading + s.angJit * 0.14
          : streak
            ? heading + s.angJit * 0.1
            : flame
              ? s.angJit + age * s.spin * 0.35
              : heading + s.angJit + age * s.spin * 0.12;
      const sx = shock
        ? thick * stretch
        : dart
        ? thick * (stretch * 1.28 * (1 - round) + (1.02 + 0.18 * grow) * round)
        : dirt
          ? thick * (0.85 + 0.55 * grow)
          : streak
            ? thick * stretch
            : flame
              ? thick
              : thick * stretch;
      const late = Math.pow(Phaser.Math.Clamp((age - 0.52) / 0.48, 0, 1), 1.7);
      const sy = shock
        ? thick * (0.48 + 0.7 * age)
        : dart
        ? thick * ((0.58 + 0.16 / Math.max(stretch, 1)) * (1 - round) + (0.95 + 0.12 * grow) * round)
        : dirt
          ? thick * (0.28 + 0.42 * late)
        : streak
          ? thick / Math.pow(stretch, 0.42)
          : s.straight
            ? (thick * 0.86) / Math.pow(stretch, 0.18)
          : spark
            ? (thick * 0.7) / Math.pow(stretch, 0.32)
            : flame
              ? thick
              : thick / Math.sqrt(stretch);
      const baseA = s.additive ? 0.45 + fade * 0.55 : 0.55 + fade * 0.4;
      const spdFade = Phaser.Math.Clamp(spd / 280, 0, 1);
      const alpha = s.blood
        ? 0.35 + fade * 0.65
        : shock
          ? 0.28 + 0.62 * Math.pow(fade, 0.55)
          : dart
            ? (0.16 + 0.2 * fade) * (1 - round * 0.25)
            : dirt
              ? baseA * (0.35 + 0.65 * fade)
              : flame
                ? Math.min(1, 0.72 + fade * 0.32)
                : spark
                  ? baseA * (0.45 + 0.55 * fade)
                  : baseA * (0.06 + 0.94 * spdFade);
      const zs = zScale(s.z);
      im.setVisible(true)
        .setTexture(s.tex, s.frame)
        .setOrigin(dart ? 0.12 + 0.38 * round : dirt || streak || spark ? 0.12 : 0.5, 0.5)
        .setPosition(s.x, s.y - screenLift(s.z))
        .setRotation(rot)
        .setScale(sx * zs, sy * zs)
        .setBlendMode(
          s.blood ? Phaser.BlendModes.NORMAL : s.additive ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL
        )
        .setAlpha(alpha)
        .setDepth(worldDepth(s.z, 0.3));
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
    if (
      s.x < view.x - pad ||
      s.x > view.right + pad ||
      s.y < view.y - pad ||
      s.y > view.bottom + pad
    ) {
      return true;
    }
    const ceil = groundZ(this.world, s.x, s.y) + MAX_AGL + 28;
    return s.z > ceil;
  }

  updateShots(dt: number): void {
    const ptr = this.worldPointer();
    const remain: Shot[] = [];
    for (const s of this.shots) {
      if (s.motor != null) {
        const was = s.motor;
        s.motor += dt;
        if (was < 0 && s.motor >= 0) this.missileIgnite(s);
      }
      const lit = s.motor == null || s.motor >= 0;
      const lofting = lit && (s.loft ?? 0) > 0;
      if (lofting) s.loft = (s.loft ?? 0) - dt;
      const hellfireHome = lit && s.kind === "hellfire" && s.targetId != null;
      const stingerHome = lit && s.homePlayer && s.kind === "hellfire";
      if (hellfireHome) {
        const cur = Math.hypot(s.vx, s.vy, s.vz);
        const burn = s.motor ?? 0;
        const accel = 520 + Phaser.Math.Clamp(burn, 0, 1.4) * 260;
        const spd = cur + accel * dt;
        const seeking = (s.loft ?? 0) <= 0;
        if (seeking) {
          const u = this.units.find((q) => q.id === s.targetId && !q.dead);
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
        const tz = this.heli.z + HELI_HEIGHT * 0.45;
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
        const air = this.hoverAerial(ptr.x, ptr.y);
        const want = Math.atan2(ptr.y - s.y, ptr.x - s.x);
        const da = Phaser.Math.Angle.Wrap(want - s.angle);
        s.angle += Phaser.Math.Clamp(da, -2.2 * dt, 2.2 * dt);
        const dist = Math.hypot(ptr.x - s.x, ptr.y - s.y);
        const hold = Phaser.Math.Clamp(dist / 360, 0, 1);
        const gndAim = groundZ(this.world, ptr.x, ptr.y);
        const tz = air ? air.z + heightOf(air.kind) * 0.5 : Phaser.Math.Linear(gndAim, this.heli.z, hold);
        s.vz = (tz - s.z) * 3.2;
        s.life = Math.max(s.life, 0.6);
      }
      if (s.motor != null && s.motor < 0) {
        const drag = s.kind === "tow" ? Math.pow(0.12, dt) : Math.pow(0.07, dt);
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
      if (s.kind === "hellfire") {
        const zCeil = groundZ(this.world, s.x, s.y) + MAX_AGL + 70;
        if (s.z > zCeil) {
          s.z = zCeil;
          if (s.vz > 0) s.vz = 0;
        }
      }
      s.life -= dt;
      if (s.kind === "tow" && s.from === "player") this.simulateTowWire(s, dt);
      // Repel Hellfire/TOW off ground during pre-ignition instead of detonating
      const preIgnite = (s.kind === "hellfire" || s.kind === "tow") && s.from === "player" && s.motor != null && s.motor < 0;
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
        Math.hypot(s.x - this.heli.x, s.y - this.heli.y) < 26 &&
        s.z <= this.heli.z + HELI_HEIGHT &&
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
          if (Math.hypot(u.x - s.x, u.y - s.y) > radius(u.kind) + 8) continue;
          const top = u.z + heightOf(u.kind);
          if (s.z > top + 2) continue;
          if (s.z < u.z - 2) continue;
          hit = true;
          victim = u;
          break;
        }
      }
      if (hit) {
        if (s.kind === "tow" && s.from === "player") {
          this.towLookX = s.x;
          this.towLookY = s.y;
          this.towLookHold = 0.9;
        }
        this.explode(s.x, s.y, s.z, s.blast, s.dmg, victim, s.vx, s.vy, s.vz, !!victim || hitPlayer, s.kind);
        continue;
      }
      if (s.from === "enemy" && this.enemyShotExpired(s)) continue;
      this.emitShotTrail(s, x0, y0, z0);
      remain.push(s);
    }
    this.shots = remain;
    this.syncShotSprites();
  }

  missileIgnite(s: Shot): void {
    if (s.from === "player" && s.kind === "hellfire") {
      const pitch = 0.92;
      const spd = Math.max(Math.hypot(s.vx, s.vy), 90);
      s.vx = Math.cos(s.angle) * spd * Math.cos(pitch);
      s.vy = Math.sin(s.angle) * spd * Math.cos(pitch);
      s.vz = spd * Math.sin(pitch);
      s.loft = HELLFIRE_SEEK_DELAY;
    } else if (s.from === "player") {
      s.vz += 300;
    }
    const sy = s.y - screenLift(s.z);
    const sc = shotTrailScale(s);
    const small = troopMissileTrail(s);
    const n = small ? Math.max(2, Math.round(5 * sc)) : Math.max(2, Math.round(8 * sc));
    this.withTrailFx(sc, () => {
      const { fire, smoke } = this.pairFx(s.z, this.burn, this.fragSmoke, ZOff.fire, ZOff.smoke);
      fire.emitParticleAt(s.x, sy, n);
      smoke.emitParticleAt(s.x, sy + 8, Math.max(1, Math.round((small ? 3 : 6) * sc)));
      if (!small) {
        this.blastFire.setDepth(worldDepth(s.z, ZOff.fire + 0.2));
        this.blastFire.explode(Math.max(1, Math.round(4 * sc)), s.x, sy);
      }
    });
    this.spawnSparks(s.x, s.y, s.z, {
      style: "muzzle",
      n: Math.max(4, Math.round(10 * sc)),
      spdMin: 80,
      spdMax: 240,
      bx: -Math.cos(s.angle),
      by: -Math.sin(s.angle),
      bz: 0.1,
      tight: 0.55,
      scaleMul: sc,
    });
  }

  emitShotTrail(s: Shot, x0: number, y0: number, z0: number): void {
    if (s.kind === "cannon") return;
    if ((s.kind === "hellfire" || s.kind === "tow") && (s.motor == null || s.motor < 0) && !s.homePlayer) return;
    if (s.homePlayer && s.motor != null && s.motor < 0) return;
    const isRocket = s.kind === "rocket";
    const hydra = isRocket && (s.scale ?? 1) > 0.6;
    const steps = hydra ? 1 : 2;
    const rot = s.angle + Math.PI / 2;
    const vis = s.scale ?? 1;
    const tail = (hydra ? 8 : 15) * vis;
    const sc = shotTrailScale(s);
    const small = troopMissileTrail(s);
    for (let i = 0; i < steps; i++) {
      const t = (i + range(0, 0.35)) / steps;
      const x = x0 + (s.x - x0) * t;
      const y = y0 + (s.y - y0) * t;
      const z = z0 + (s.z - z0) * t;
      const sy = y - screenLift(z);
      const tx = x - Math.sin(rot) * tail;
      const ty = sy + Math.cos(rot) * tail;
      this.withTrailFx(sc, () => {
        if (hydra) {
          if (Math.random() < 0.38) this.fxAt(z, this.lingerSmoke, ZOff.smoke).emitParticleAt(tx, ty, 1);
        } else if (small) {
          const { fire, smoke } = this.pairFx(z, this.burn, this.lingerSmoke);
          if (Math.random() < 0.55) fire.emitParticleAt(tx, ty, 1);
          if (Math.random() < 0.4) smoke.emitParticleAt(tx, ty, 1);
        } else if (isRocket) {
          const { fire, smoke } = this.pairFx(z, this.burn, this.lingerSmoke);
          if (Math.random() < 0.5) fire.emitParticleAt(tx, ty, 1);
          if (Math.random() < 0.4) smoke.emitParticleAt(tx, ty, 1);
        } else {
          const { fire, smoke } = this.pairFx(z, this.burn, this.lingerSmoke);
          if (Math.random() < 0.78) fire.emitParticleAt(tx, ty, 1);
          if (Math.random() < 0.65) smoke.emitParticleAt(tx, ty, 1);
        }
      });
    }
  }

  drawTowWires(): void {
    const g = this.towWireGfx;
    g.clear();
    if (this.heli.phase === "dead") return;
    let zMin = this.heli.z;
    for (const s of this.shots) {
      if (s.kind !== "tow" || s.from !== "player") continue;
      const pts = s.wire ?? [];
      if (pts.length === 0) continue;
      zMin = Math.min(zMin, s.z, ...pts.map((p) => p.z));
      if (pts.length < 2) continue;
      const stroke = (color: number, alpha: number, width: number, dy: number) => {
        g.lineStyle(width, color, alpha);
        g.beginPath();
        g.moveTo(pts[0]!.x, pts[0]!.y - screenLift(pts[0]!.z) + dy);
        for (let i = 1; i < pts.length; i++) {
          const p = pts[i]!;
          g.lineTo(p.x, p.y - screenLift(p.z) + dy);
        }
        g.strokePath();
      };
      stroke(0x3a382e, 0.55, 1.35, 0);
      stroke(0xe8e0c8, 0.88, 0.85, -0.55);
    }
    g.setDepth(worldDepth(zMin, ZOff.shot - 0.8));
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
    const h = this.heli;
    const span = 24;
    return {
      x: h.x + Math.cos(h.angle + Math.PI / 2) * span * side,
      y: h.y + Math.sin(h.angle + Math.PI / 2) * span * side,
      z: h.z + ZOff.shot,
    };
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
    kind: Wpn
  ): void {
    const water = isWater(this.world, x, y);
    const he = kind !== "cannon";
    const fx = hitSparkFx(dmg);
    const travel = Math.hypot(dx, dy, dz) || 1;
    const sparkBx = dx;
    const sparkBy = dy;
    const sparkBz = he ? dz : Math.max(22, dz);
    const missileBias = he ? 2.4 : undefined;
    const mechGunBias = !he && objectHit && !(direct && isOrganic(direct.kind)) ? 2.1 : undefined;
    const expBias = missileBias ?? mechGunBias;
    if (objectHit && direct && isOrganic(direct.kind)) {
      const graze = Phaser.Math.Clamp(Math.hypot(dx, dy) / travel, 0, 1);
      const distN = Phaser.Math.Clamp(Math.hypot(x - this.heli.x, y - this.heli.y) / 780, 0, 1);
      const acute = Math.max(graze, distN);
      this.spawnSparks(x, y, z + 3, {
        style: "ground",
        n: he ? 48 : 22,
        spdMin: he ? Phaser.Math.Linear(50, 160, acute) : Phaser.Math.Linear(36, 200, acute * acute),
        spdMax: he ? Phaser.Math.Linear(220, 420, acute) : Phaser.Math.Linear(200, 520, acute * acute),
        bx: sparkBx,
        by: sparkBy,
        bz: he ? sparkBz : Phaser.Math.Linear(110, 40, acute),
        tight: he ? 0.22 : Phaser.Math.Linear(0.28, 0.72, acute),
        sparkFrac: 0,
        forceKind: "dirt",
        blood: true,
        expBias: missileBias,
      });
    } else if (objectHit) {
      this.spawnSparks(x, y, z + 4, {
        style: "object",
        n: Math.min(56, Math.round((he ? 36 : 18) * fx.n)),
        spdMin: (he ? 110 : 90) * fx.spd,
        spdMax: (he ? 480 : 340) * fx.spd,
        bx: sparkBx,
        by: sparkBy,
        bz: sparkBz,
        tight: he ? 0.28 : 0.52,
        scaleMul: fx.size,
        expBias,
      });
    } else if (water) {
      this.spawnSparks(x, y, z + 3, {
        style: "water",
        n: Math.min(80, Math.round(20 * fx.n)),
        spdMin: 50 * fx.spd,
        spdMax: 220 * fx.spd,
        bx: sparkBx,
        by: sparkBy,
        bz: he ? Math.max(sparkBz, 20) : Math.max(40, dz),
        tight: 0.48,
        scaleMul: fx.size,
        expBias: missileBias,
      });
    } else {
      const graze = Phaser.Math.Clamp(Math.hypot(dx, dy) / travel, 0, 1);
      const distN = Phaser.Math.Clamp(Math.hypot(x - this.heli.x, y - this.heli.y) / 780, 0, 1);
      const acute = Math.max(graze, distN);
      if (he) {
        this.spawnSparks(x, y, z + 3, {
          style: "ground",
          n: Math.min(96, Math.round(62 * fx.n)),
          spdMin: Phaser.Math.Linear(50, 160, acute) * fx.spd,
          spdMax: Phaser.Math.Linear(220, 420, acute) * fx.spd,
          bx: sparkBx,
          by: sparkBy,
          bz: sparkBz,
          tight: 0.22,
          sparkFrac: 0.02,
          scaleMul: fx.size,
          expBias: missileBias,
        });
      } else {
        this.spawnSparks(x, y, z + 3, {
          style: "ground",
          n: Math.min(80, Math.round(26 * fx.n)),
          spdMin: Phaser.Math.Linear(36, 200, acute * acute) * fx.spd,
          spdMax: Phaser.Math.Linear(200, 520, acute * acute) * fx.spd,
          bx: sparkBx,
          by: sparkBy,
          bz: Phaser.Math.Linear(90, 22, acute),
          tight: Phaser.Math.Linear(0.28, 0.72, acute),
          sparkFrac: 0.04,
          scaleMul: fx.size,
        });
      }
    }
    const sy = y - screenLift(z);
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
      this.smoke.setDepth(worldDepth(z, 0.2));
      this.smoke.emitParticleAt(x, sy + 12, he ? 16 : objectHit ? 6 : 8);
    }
    this.shake = Math.min(8, this.shake + blast * (he ? 0.055 : 0.028));
    if (!he) this.spawnImpactFlash(x, sy, z, 0xffc878, 34, 0.85, 160);
    for (const u of this.units) {
      if (u.dead) continue;
      const d = Math.hypot(u.x - x, u.y - y);
      if (u === direct || d < blast) {
        u.killDx = dx;
        u.killDy = dy;
        const fall = u === direct ? dmg : dmg * (1 - d / blast);
        this.hurt(u, fall);
      }
    }
    const hd = Math.hypot(this.heli.x - x, this.heli.y - y);
    const agl = castZ(this.world, this.heli.x, this.heli.y, this.heli.z);
    if (hd < blast * 0.55 && agl < 30) this.heli.damage(dmg * 0.25, dx, dy);
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
    size01 = Phaser.Math.Clamp(blast / 140, 0.18, 1)
  ): void {
    const sy = y - screenLift(z);
    const mul = (soft ? 0.32 : 1) * Phaser.Math.Linear(0.45, 1.15, size01);
    this.spawnSparks(x, y, z + 10, {
      style: "object",
      n: Math.max(4, Math.round(22 * mul)),
      spdMin: 140,
      spdMax: 480,
      bx: dx,
      by: dy,
      bz: dz,
      tight: 0.2,
      forceKind: "flame",
      scaleMul: (soft ? 0.42 : 1) * Phaser.Math.Linear(0.4, 1.35, size01),
      expBias: 2.2,
    });
    this.blastFire.setDepth(worldDepth(z, ZOff.fire + 1));
    this.blastFire.explode(Math.max(3, Math.round(26 * mul)), x, sy);
    this.spawnImpactFlash(
      x,
      sy,
      z,
      0xffe8a0,
      Math.max(10, blast * (soft ? 0.1 : 0.18) * waveMul),
      0.9,
      180
    );
    this.spawnBlastTrails(x, y, z, dx, dy, dz, soft, size01);
    const wave = (soft ? 0.45 : 1) * waveMul;
    const ring = this.add.circle(x, sy, 6, 0xff9a40, 0.85).setDepth(worldDepth(z, 2)).setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({
      targets: ring,
      scale: Math.max(2, (blast * wave) / 6),
      alpha: 0,
      duration: waveMul > 1 ? 140 : 100,
      ease: "Expo.Out",
      onComplete: () => ring.destroy(),
    });
  }

  spawnBlastTrails(x: number, y: number, z: number, dx: number, dy: number, dz: number, soft = false, size01 = 0.7): void {
    const extra = this.frags.filter((f) => f.trailOnly).length + 8 - 40;
    if (extra > 0) {
      let drop = extra;
      this.frags = this.frags.filter((f) => {
        // Never cull crash hulls — simmer drives the player death end screen.
        if (f.heliCrash || f.playerCrash) return true;
        if (!drop || !f.trailOnly) return true;
        drop--;
        return false;
      });
    }
    const n = Math.max(2, Math.round(Phaser.Math.Linear(soft ? 2 : 4, soft ? 5 : 11, size01))) + ((Math.random() * 2) | 0);
    for (let i = 0; i < n; i++) {
      const reverse = Math.random() < 0.35;
      const d = biasedDir(dx, dy, Math.max(40, dz), 0.18, reverse);
      const sp = range(70, 250);
      const jit = 0.55;
      this.frags.push({
        x,
        y,
        z: z + range(6, 18),
        vx: d.x * sp + range(-sp * jit * 0.5, sp * jit * 0.5),
        vy: d.y * sp + range(-sp * jit * 0.5, sp * jit * 0.5),
        vz: range(140, 300) + d.z * 40,
        angle: 0,
        spin: 0,
        life: range(1.6, 3),
        key: "fx_frag_metal",
        settled: false,
        gravity: true,
        bounces: Math.random() < 0.4 ? 1 : 0,
        trailOnly: true,
        linger: true,
        trailR: Phaser.Math.Linear(soft ? 1 : 2.2, soft ? 5 : 14, size01) * range(0.75, 1.15),
        trailSoft: soft,
        wobble: Math.random() * Math.PI * 2,
        wobFreq: range(9, 17),
        wobAmp: range(140, 300),
      });
    }
  }

  texTrailR(key: string): number {
    if (!this.textures.exists(key)) return 14;
    const src = this.textures.get(key).getSourceImage() as { width: number; height: number };
    return Math.max(10, Math.max(src.width, src.height) * 0.32);
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

  hurt(u: Unit, dmg: number): void {
    u.health -= dmg;
    if (u.health <= 0) {
      this.destroyUnit(u);
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

  destroyUnit(u: Unit): void {
    if (u.dead) return;
    u.dead = true;
    if (u.kind === "lookout" || u.kind === "bunker" || u.kind === "pickup") {
      for (const crew of this.units) {
        if (!crew.dead && crew.pinId === u.id) this.destroyUnit(crew);
      }
    }
    const hz = u.z + heightOf(u.kind) * 0.5;
    const sp = specOf(u.kind);
    const building = !!sp.building;
    const boom = Phaser.Math.Clamp((radius(u.kind) - 6) / 86, 0.16, 1);
    const blast = Math.max(42, radius(u.kind) * 2.4) * (building ? 1.4 : 1);
    const near = Math.hypot(u.x - this.heli.x, u.y - this.heli.y);
    if (building) {
      const killPulse =
        Phaser.Math.Clamp(1.2 - near / 1100, 0.18, 0.62) * Phaser.Math.Linear(0.55, 1.15, boom);
      this.pulseTestBarrel(killPulse);
    }
    this.heFireBurst(u.x, u.y, hz, 0, 0, 1, blast, !!sp.organic, building ? 2.25 : 1, boom);
    if (building) this.emitDustShock(u.x, u.y, 1);
    this.smoke.setDepth(worldDepth(u.z, 0.2));
    this.smoke.emitParticleAt(u.x, u.y - screenLift(u.z) + 12, 16);
    this.shake = Math.min(10, this.shake + 3);
    const n = Math.max(2, Math.round((sp.organic ? 4 : building ? 16 : 10) * Phaser.Math.Linear(0.4, 1.2, boom)));
    const keys = fragKeys(u.kind);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const spd = range(55, 255);
      const key = this.textures.exists(keys[i % keys.length]!)
        ? keys[i % keys.length]!
        : "fx_frag_metal";
      const organic = !!sp.organic;
      this.frags.push({
        x: u.x,
        y: u.y,
        z: u.z + range(8, 22),
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
        trailR: this.texTrailR(key) * (organic ? 0.38 : 1) * Phaser.Math.Linear(0.4, 1.4, boom),
        scale: (organic ? 0.55 : 1) * Phaser.Math.Linear(0.32, 1.5, boom),
        trailSoft: organic,
      });
    }
    if (!sp.noCrater) {
      const key = `fx_blast_${(Math.random() * 4) | 0}`;
      let sc = (radius(u.kind) / 20) * range(0.72, 1.42);
      if (u.kind === "tank") sc *= 1.25;
      this.stampWreck(this.textures.exists(key) ? key : "fx_blast_0", u.x, u.y, Math.random() * Math.PI * 2, sc, 1);
    }
    const guns = gunsOf(u);
    const isHeli = sp.move === "heli";
    if (sp.move === "boat") {
      this.spawnBoatSink(u);
    } else if (isHeli) {
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
        const hs = this.wreckDrawScale(u.x, u.y, u.z, 1, !sp.aerial);
        this.stampWreck(hullKey, u.x, u.y, u.angle + Math.PI / 2, hs.sx, 0.95, hp.x, hp.y, hs.sy);
        const throwOff = (key: string, ang: number, x: number, y: number, scale = 1, extra: Partial<Frag> = {}) => {
          const a = Math.random() * Math.PI * 2;
          const throwSp = range(90, 200);
          this.frags.push({
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
            const scale = (g.scale ?? 1) * (liveSpan / Math.max(hulkSpan, 1));
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
      const bladeOffs = Math.random() < 0.55 ? [0.36, -0.4] : [0.4];
      const rotorSpan = this.texSpan(rk) * scale * 0.42;
      const heliRotor = r.tex.includes("rotor") && r.tex !== "enemy_drone_rotor";
      if (heliRotor) {
        const nBlades = 1 + ((Math.random() * 3) | 0);
        const offs = Array.from({ length: nBlades }, () => {
          const mag = range(0.28, 0.5);
          return Math.random() < 0.5 ? -mag : mag;
        });
        this.throwRotorHulk({
          key: rk,
          x: at.x,
          y: at.y,
          z: u.z + 18,
          rotorAng: ri % 2 ? -u.rotor : u.rotor,
          scale,
          bladeOffs: offs,
          rotorSpan,
        });
      } else {
        throwOff(rk, ri % 2 ? -u.rotor : u.rotor, at.x, at.y, scale, {
          rotorFlames: true,
          bladeOffs,
          rotorSpan,
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
          const scale = (d.scale ?? 1) * (liveSpan / Math.max(hulkSpan, 1));
          const at = this.mountAt(u, resolveSkin(this.textures, textureOf(u.kind), u.camo), d.mount);
          const span = this.texSpan(dishKey) * scale * 0.42;
          const n = 3 + ((Math.random() * 3) | 0);
          const flamePts: { lx: number; ly: number; sc: number }[] = [{ lx: 0, ly: 0, sc: 1 }];
          for (let i = 0; i < n; i++) {
            const rad = range(0.18, 0.82) * span;
            const ang = Math.random() * Math.PI * 2;
            flamePts.push({
              lx: Math.cos(ang) * rad,
              ly: Math.sin(ang) * rad,
              sc: range(0.38, 0.72),
            });
          }
          throwOff(dishKey, u.rotor, at.x, at.y, scale, {
            flamePts,
            dishFlat: true,
            spin: range(-7, 7),
            trailR: this.texTrailR(dishKey) * scale * 0.55,
            bounces: 0,
          });
        }
      } else {
        const hulkKey = resolveSkin(this.textures, hulkOf(u.kind), u.camo);
        const hp = spritePivot(hulkKey);
        const hs = this.wreckDrawScale(u.x, u.y, u.z, 1, !sp.aerial);
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
        if (sp.organic && this.textures.exists("fx_dirt") && !isWater(this.world, u.x, u.y)) {
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
    const keys = wheelFragKeys().filter((k) => this.textures.exists(k));
    if (!keys.length) return;
    const n = Math.min(maxW, 1 + ((Math.random() * 2) | 0));
    const sc =
      u.kind === "motorcycle" ? range(0.48, 0.58) : u.kind === "pickup" ? range(0.68, 0.82) : range(0.78, 0.95);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const throwSp = range(120, 260);
      const key = keys[(Math.random() * keys.length) | 0]!;
      this.frags.push({
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
    if (!this.textures.exists(key)) return 64;
    const src = this.textures.get(key).getSourceImage() as { width: number; height: number };
    return Math.max(1, src.width, src.height);
  }

  /** On-screen rotor span (pre-zScale), matching syncHeli / syncUnitSprites. */
  liveRotorDrawPx(tex: string, partScale = 1): number {
    if (tex === "heli_rotor") return 124 * 1.08 * partScale;
    if (tex.includes("rotor") && tex !== "enemy_drone_rotor") return 108 * partScale;
    return this.texSpan(tex) * partScale;
  }

  /** Frag scale so a rotor hulk draws ~60% of the live rotor size. */
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
        const scale = (g.scale ?? 1) * (liveSpan / Math.max(hulkSpan, 1));
        const at = this.gunMountPos(u, gi);
        const a = Math.random() * Math.PI * 2;
        const throwSp = range(70, 160);
        this.frags.push({
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
        });
      });
    }
    const baseKey = this.textures.exists(hullKey) ? hullKey : textureOf(u.kind);
    const sinkKey = `${baseKey}_sink`;
    const key = this.textures.exists(sinkKey) ? sinkKey : baseKey;
    const surface = waterSurfaceZ();
    this.frags.push({
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
    dmgSites?: { poi: number; scale: number }[] | { u: number; v: number; scale: number }[];
    radius: number;
    player?: boolean;
    kickDx?: number;
    kickDy?: number;
  }): void {
    const player = !!opts.player;
    const sp = opts.kind ? specOf(opts.kind) : undefined;
    const hullKey = player
      ? this.textures.exists("heli_body_hulk")
        ? "heli_body_hulk"
        : "heli_body"
      : resolveSkin(this.textures, sp!.hulk, opts.camo);
    const hullAng = opts.angle + Math.PI / 2;
    const dmgFlames = this.crashDmgFlames(opts.dmgSites, player, opts.kind);
    const spinSign = Math.random() < 0.5 ? -1 : 1;
    const kn = Math.hypot(opts.kickDx ?? 0, opts.kickDy ?? 0);
    const boost = range(110, 170);
    const kx = kn > 1 ? ((opts.kickDx ?? 0) / kn) * boost : 0;
    const ky = kn > 1 ? ((opts.kickDy ?? 0) / kn) * boost : 0;
    const hull: Frag = {
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
      impactDust: Phaser.Math.Clamp(opts.radius / 48, 0.32, 0.72),
      dmgFlames,
      simmer: 0,
    };
    this.frags.push(hull);

    const rotors = player
      ? [
          {
            tex: "heli_rotor",
            hulk: "heli_rotor_hulk",
            mount: { x: rotorLayout.player.x, y: rotorLayout.player.y },
            scale: 1,
          },
        ]
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
      if (!player && opts.kind) {
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
      const nBlades = 1 + ((Math.random() * 3) | 0);
      const bladeOffs = Array.from({ length: nBlades }, () => {
        const mag = range(0.28, 0.5);
        return Math.random() < 0.5 ? -mag : mag;
      });
      const rotorSpan = this.texSpan(rk) * scale * 0.42;
      const rotorAng = ri % 2 ? -opts.rotor : opts.rotor;
      if (Math.random() < 0.4) {
        const spinSign = rotorAng >= 0 ? 1 : -1;
        this.frags.push({
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
          rotorFlames: true,
          bladeOffs,
          rotorSpan,
          pinHost: hull,
          pinMount: { ...r.mount },
          rotorSkew: true,
        });
      } else {
        this.throwRotorHulk({
          key: rk,
          x,
          y,
          z: opts.z + 8,
          rotorAng,
          scale,
          bladeOffs,
          rotorSpan,
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
    bladeOffs: number[];
    rotorSpan: number;
  }): void {
    const a = Math.random() * Math.PI * 2;
    const throwSp = range(240, 420);
    const spinSign = opts.rotorAng >= 0 ? 1 : -1;
    this.frags.push({
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
      rotorFlames: true,
      rotorThrow: true,
      bladeOffs: opts.bladeOffs,
      rotorSpan: opts.rotorSpan,
    });
  }

  /** UV interest points for damage: body center, each gun mount, each rotor mount. */
  unitDmgPoiUvs(kind: Unit["kind"], parts?: Unit["parts"]): { u: number; v: number }[] {
    const pois: { u: number; v: number }[] = [{ u: 0.5, v: 0.5 }];
    for (const g of gunsOf({ kind, parts })) {
      const m = g.tex === "enemy_tank_gun" ? tankLayout.mountOrigin : g.mount;
      pois.push({ u: m.x, v: m.y });
    }
    for (const r of specOf(kind).rotors) {
      pois.push({ u: r.mount.x, v: r.mount.y });
    }
    return pois;
  }

  /** Screen-space interest points matching unitDmgPoiUvs order. */
  unitDmgPois(u: Unit): { x: number; y: number }[] {
    const lift = screenLift(u.z);
    const pois: { x: number; y: number }[] = [{ x: u.x, y: u.y - lift }];
    const guns = gunsOf(u);
    for (let i = 0; i < guns.length; i++) {
      const at = this.gunMountPos(u, i);
      pois.push({ x: at.x, y: at.y - lift });
    }
    const tex = resolveSkin(this.textures, textureOf(u.kind), u.camo);
    for (const r of specOf(u.kind).rotors) {
      const at = this.mountAt(u, tex, r.mount);
      pois.push({ x: at.x, y: at.y - lift });
    }
    return pois;
  }

  playerDmgPois(): { x: number; y: number }[] {
    return [
      { x: this.body.x, y: this.body.y },
      { x: this.gun.x, y: this.gun.y },
      { x: this.rotor.x, y: this.rotor.y },
    ];
  }

  crashDmgFlames(
    sites: { poi: number; scale: number }[] | { u: number; v: number; scale: number }[] | undefined,
    player: boolean,
    kind?: Unit["kind"]
  ): { u: number; v: number; scale: number }[] {
    if (!sites?.length) {
      const n = 1 + ((Math.random() * 2) | 0);
      const pool = player ? PLAYER_DMG_POI_UV : CRASH_DMG_UV;
      return Array.from({ length: n }, () => {
        const uv = pool[(Math.random() * pool.length) | 0]!;
        return { u: uv.u, v: uv.v, scale: range(0.42, 0.8) };
      });
    }
    const poiUvs = player
      ? PLAYER_DMG_POI_UV
      : kind
        ? this.unitDmgPoiUvs(kind)
        : CRASH_DMG_UV;
    return sites.map((s) => {
      if ("poi" in s) {
        const uv = poiUvs[s.poi] ?? poiUvs[0] ?? { u: 0.5, v: 0.5 };
        return { u: uv.u, v: uv.v, scale: s.scale };
      }
      return { u: s.u, v: s.v, scale: s.scale };
    });
  }

  beginPlayerCrash(): void {
    if (this.playerCrashStarted) return;
    this.playerCrashStarted = true;
    const h = this.heli;
    this.body.setVisible(false);
    this.rotor.setVisible(false);
    this.gun.setVisible(false);
    this.shadow.setVisible(false);
    const hz = h.z + HELI_HEIGHT * 0.5;
    const blast = 56;
    this.heFireBurst(h.x, h.y, hz, 0, 0, 1, blast, false, 1, 0.55);
    this.smoke.setDepth(worldDepth(h.z, 0.2));
    this.smoke.emitParticleAt(h.x, h.y - screenLift(h.z) + 12, 14);
    this.shake = Math.min(10, this.shake + 4);
    const n = 8;
    const keys = fragKeys("heli");
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const spd = range(55, 220);
      const key = this.textures.exists(keys[i % keys.length]!) ? keys[i % keys.length]! : "fx_frag_metal";
      this.frags.push({
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
      radius: 28,
      player: true,
      dmgSites: h.dmgSites,
      kickDx: h.killDx,
      kickDy: h.killDy,
    });
  }

  updateFrags(dt: number): void {
    const keep: Frag[] = [];
    for (const f of this.frags) {
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
        if (!f.boatSink) this.tickFragTrailFade(f, dt);
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
        const drag = f.heliCrash ? 0.94 : f.rotorThrow ? 0.88 : 0.78;
        f.vx *= Math.pow(drag, dt);
        f.vy *= Math.pow(drag, dt);
        if (f.z > groundZ(this.world, f.x, f.y) + 2) this.emitFragTrail(f, 1);
        const g = groundZ(this.world, f.x, f.y);
        if (f.z <= g) {
          f.z = g;
          if (!f.linger) this.stampDirtSmears(f.x, f.y, f.vx, f.vy);
          if (f.heliCrash) {
            this.impactHeliCrash(f);
            this.settleFrag(f);
          } else if (f.rotorThrow) {
            f.spin *= 0.15;
            f.vx *= 0.2;
            f.vy *= 0.2;
            this.settleFrag(f);
          } else if (f.wheelRoll) {
            if (f.bounces > 0 && f.vz < -40) {
              f.bounces--;
              this.bounceFragSlope(f, 1);
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
          } else if (f.bounces > 0 && f.vz < -50) {
            f.bounces--;
            // Same elevation bounce as wheels, weaker so flight path barely turns.
            this.bounceFragSlope(f, 0.32);
            f.spin *= range(0.78, 1.22);
            f.spin += range(-2.4, 2.4);
            f.angle += range(-0.28, 0.28);
          } else {
            this.settleFrag(f);
          }
        }
      } else {
        f.vx *= Math.pow(0.08, dt);
        f.vy *= Math.pow(0.08, dt);
        f.life -= dt;
        if (f.life <= 0 || Math.hypot(f.vx, f.vy) < 8) {
          this.settleFrag(f);
        }
      }
      if (!(f.trailOnly && f.life <= 0 && !f.settled)) keep.push(f);
    }
    this.frags = keep;
    this.syncFragSprites();
  }

  tickPinnedRotor(f: Frag, dt: number): void {
    const host = f.pinHost!;
    const mount = f.pinMount ?? { x: 0.5, y: 0.5 };
    const at = this.fragMountAt(host, mount);
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
      this.emitFragTrail(f, dim);
    }
    if (host.settled && spinMag < 0.1) {
      this.settleFrag(f);
    }
  }

  fragMountAt(host: Frag, mount: { x: number; y: number }): { x: number; y: number } {
    const pivot = spritePivot(host.key);
    const src = this.textures.exists(host.key)
      ? (this.textures.get(host.key).getSourceImage() as { width: number; height: number })
      : { width: 64, height: 64 };
    const sc = (host.scale ?? 1) * zScale(host.z || 0);
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
   * Reflect a frag off the height-map slope (same field as wheel roll / rivers).
   * strength 1 = full wheel bounce; ~0.3 nudges trajectory without redirecting it.
   */
  bounceFragSlope(f: Frag, strength: number): void {
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

  tickWheelRoll(f: Frag, dt: number): void {
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
    if (spd > 22) this.emitFragTrail(f, 1);
    else if (spd > 10) this.emitFragTrail(f, 0.5);
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
      this.settleFrag(f);
    }
  }

  tickBoatSink(f: Frag, dt: number): void {
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

  settleBoatSink(f: Frag): void {
    f.settled = true;
    f.vx = 0;
    f.vy = 0;
    f.vz = 0;
    if (!f.trailOnly) {
      const o = this.fragStampOrigin(f.key);
      const hs = this.wreckDrawScale(f.x, f.y, f.z || 0, f.scale ?? 0.55);
      // Pre-baked blue sink art — no runtime tintFill.
      this.stampWreck(f.key, f.x, f.y, f.angle, hs.sx, 0.8, o.x, o.y, hs.sy);
      f.trailOnly = true;
    }
    f.trailFade = 0;
    f.life = 0;
  }

  impactHeliCrash(f: Frag): void {
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

  settleFrag(f: Frag): void {
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
      const o = this.fragStampOrigin(f.key);
      const hs = this.wreckDrawScale(f.x, f.y, f.z || 0, f.scale ?? 1);
      let sx = hs.sx;
      let sy = hs.sy;
      if (f.dishFlat) {
        sx *= 1.04;
        sy *= 0.52;
      } else if (f.rotorSkew) {
        sx *= 1.14;
        sy *= 0.56;
      }
      this.stampWreck(f.key, f.x, f.y, f.angle, sx, 0.92, o.x, o.y, sy);
      f.trailOnly = true;
    }
    if (!f.heliCrash) this.beginFragTrailFade(f);
  }

  beginFragTrailFade(f: Frag): void {
    f.trailFadeMax = f.linger ? range(2.2, 3.8) : range(0.55, 1.05);
    f.trailFade = f.trailFadeMax;
  }

  tickFragTrailFade(f: Frag, dt: number): void {
    if (f.trailFade == null) this.beginFragTrailFade(f);
    if ((f.trailFade ?? 0) <= 0) return;
    f.trailFade! -= dt;
    const dim = Phaser.Math.Clamp(f.trailFade! / (f.trailFadeMax || 1), 0, 1);
    if (dim > 0) this.emitFragTrail(f, dim * dim);
  }

  emitFragTrail(f: Frag, dim: number): void {
    const pyBase = f.y - screenLift(f.z);
    // Trails sit under the debris sprite (body ≈ 0); keep fire above smoke within the pair.
    const trailFire = -0.35;
    const trailSmoke = -1.15;
    if (f.flamePts?.length) {
      const ca = Math.cos(f.angle);
      const sa = Math.sin(f.angle);
      const flatX = f.dishFlat ? 1.04 : 1;
      const flatY = f.dishFlat ? 0.52 : 1;
      const { fire, smoke } = this.pairFx(f.z, this.flame, this.hurtSmoke, trailFire, trailSmoke);
      for (const p of f.flamePts) {
        const lx = p.lx * flatX;
        const ly = p.ly * flatY;
        const wx = f.x + lx * ca - ly * sa;
        const wy = pyBase + lx * sa + ly * ca;
        this.dmgFlameScale = p.sc * (f.scale ?? 1) * 1.15;
        if (Math.random() < 0.8 * dim) fire.emitParticleAt(wx, wy, p.lx === 0 && p.ly === 0 ? 2 : 1);
        if (Math.random() < 0.42 * dim) smoke.emitParticleAt(wx, wy + 8, 1);
      }
      return;
    }
    if (f.rotorFlames) {
      const ca = Math.cos(f.angle);
      const sa = Math.sin(f.angle);
      const span = f.rotorSpan ?? 36;
      const pts: { ox: number; sc: number }[] = [{ ox: 0, sc: 1 }];
      for (const b of f.bladeOffs ?? [0.4]) pts.push({ ox: b * span, sc: 0.48 });
      const { fire, smoke } = this.pairFx(f.z, this.flame, this.hurtSmoke, trailFire, trailSmoke);
      for (const p of pts) {
        const wx = f.x + p.ox * ca;
        const wy = pyBase + p.ox * sa;
        this.dmgFlameScale = p.sc * (f.scale ?? 1) * 0.9;
        if (Math.random() < 0.78 * dim) fire.emitParticleAt(wx, wy, p.ox === 0 ? 2 : 1);
        if (p.ox === 0 && Math.random() < 0.4 * dim) smoke.emitParticleAt(wx, wy + 8, 1);
      }
      return;
    }
    if (f.heliCrash) return;
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
    const px = f.x + lx * ca - ly * sa;
    const py = pyBase + lx * sa + ly * ca;
    const r = f.trailR;
    const fireProto = f.trailSoft ? this.ember : f.linger ? this.blastBurn : this.burn;
    const puffProto = f.linger ? this.lingerSmoke : this.fragSmoke;
    const ref = f.trailSoft ? 3.2 : f.linger ? 6 : 6.5;
    const sc = Phaser.Math.Clamp((r * (f.scale ?? 1)) / ref, 0.35, 2.75);
    const jit = Math.max(1.5, r * 0.12);
    this.withTrailFx(sc, () => {
      const { fire, smoke: puff } = this.pairFx(f.z, fireProto, puffProto, trailFire, trailSmoke);
      if (Math.random() < (f.trailOnly ? 0.85 : 0.7) * dim) {
        const p = jitterDisk(px, py, jit);
        fire.emitParticleAt(p.x, p.y, 1);
      }
      if (Math.random() < (f.trailOnly ? 0.65 : 0.5) * dim) {
        const p = jitterDisk(px, py, jit * 1.35);
        puff.emitParticleAt(p.x, p.y + 10, 1);
      }
    });
  }

  emitHeliCrashDmgFlames(): void {
    for (const f of this.frags) {
      if (!f.heliCrash) continue;
      if (f.settled) {
        if ((f.simmer ?? 0) <= 0) continue;
        this.emitFragDmgFlames(f, Phaser.Math.Clamp(f.simmer! / 3.2, 0, 1));
      } else {
        this.emitFragDmgFlames(f, 1);
      }
    }
  }

  emitFragDmgFlames(f: Frag, dim: number): void {
    if (!f.dmgFlames?.length || dim <= 0.02) return;
    const pivot = spritePivot(f.key);
    const src = this.textures.exists(f.key)
      ? (this.textures.get(f.key).getSourceImage() as { width: number; height: number })
      : { width: 64, height: 64 };
    const zs = zScale(f.z);
    const sc = (f.scale ?? 1) * zs;
    const spr = {
      x: f.x,
      y: f.y - screenLift(f.z),
      rotation: f.angle,
      displayWidth: src.width * sc,
      displayHeight: src.height * sc,
      originX: pivot.x,
      originY: pivot.y,
    };
    // Above falling/settled hull, same band as live unit damage (under rotors/turrets when applicable).
    const { fire, smoke } = this.pairFx(f.z, this.flame, this.hurtSmoke, ZOff.dmg, ZOff.smoke);
    const airMul = f.heliCrash ? 1.65 : 1;
    for (const s of f.dmgFlames) {
      const p = spriteUvPos(spr, s.u, s.v);
      this.dmgFlameScale = s.scale * dim * airMul;
      if (Math.random() < 0.72 * dim) fire.emitParticleAt(p.x, p.y, 2);
      if (Math.random() < 0.35 * dim) smoke.emitParticleAt(p.x, p.y + 8, 1);
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

  /** Clone an emitter across altitude bands so concurrent trails don't thrash one depth. */
  poolFx(make: () => Phaser.GameObjects.Particles.ParticleEmitter): Phaser.GameObjects.Particles.ParticleEmitter {
    const slots: Phaser.GameObjects.Particles.ParticleEmitter[] = [];
    for (let i = 0; i < this.fxSlotN; i++) {
      const em = make();
      em.setDepth(Layer.WORLD);
      slots.push(em);
    }
    this.fxSlots.set(slots[0]!, slots);
    return slots[0]!;
  }

  fxBand(z: number): number {
    return Phaser.Math.Clamp(Math.floor(z / this.fxBandH), 0, this.fxSlotN - 1);
  }

  fxSlot(proto: Phaser.GameObjects.Particles.ParticleEmitter, z: number): Phaser.GameObjects.Particles.ParticleEmitter {
    const slots = this.fxSlots.get(proto);
    if (!slots) return proto;
    return slots[this.fxBand(z)]!;
  }

  fxAt(
    z: number,
    proto: Phaser.GameObjects.Particles.ParticleEmitter,
    off: number
  ): Phaser.GameObjects.Particles.ParticleEmitter {
    const em = this.fxSlot(proto, z);
    em.setDepth(worldDepth(z, off));
    return em;
  }

  /**
   * Pick the altitude-band fire/smoke pair and pin both depths from the same z so this
   * trail stays projectile → smoke → flame. Other bands can still interleave.
   */
  pairFx(
    z: number,
    fireProto: Phaser.GameObjects.Particles.ParticleEmitter,
    smokeProto: Phaser.GameObjects.Particles.ParticleEmitter,
    fireOff: number = ZOff.fire,
    smokeOff: number = ZOff.smoke
  ): { fire: Phaser.GameObjects.Particles.ParticleEmitter; smoke: Phaser.GameObjects.Particles.ParticleEmitter } {
    const fire = this.fxSlot(fireProto, z);
    const smoke = this.fxSlot(smokeProto, z);
    const sOff = Math.min(smokeOff, fireOff - 1.25);
    const fOff = Math.max(fireOff, sOff + 1.25);
    smoke.setDepth(worldDepth(z, sOff));
    fire.setDepth(worldDepth(z, fOff));
    return { fire, smoke };
  }

  withTrailFx(scale: number, fn: () => void): void {
    const prev = this.trailFxScale;
    this.trailFxScale = scale;
    fn();
    this.trailFxScale = prev;
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
      if (dist < 26) {
        this.heli.damage(38, u.vx, u.vy);
        this.destroyUnit(u);
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

      let moveX = 0;
      let moveY = 0;
      if (flee) {
        // Retreat: turn and fly away
        const awayAng = Math.atan2(-dy, -dx);
        u.angle = Phaser.Math.Angle.RotateTo(u.angle, awayAng, 2.8 * dt);
        moveX = -fwdX * 170;
        moveY = -fwdY * 170;
      } else if (kite && dist < 900) {
        // Kite: strafe laterally, face player
        u.angle = Phaser.Math.Angle.RotateTo(u.angle, toAng, 3.4 * dt);
        const radial = Phaser.Math.Clamp((dist - prefDist) * 0.4, -100, 100);
        moveX = latX * 130 + fwdX * radial;
        moveY = latY * 130 + fwdY * radial;
      } else {
        // Attack: turn and fly at player
        u.angle = Phaser.Math.Angle.RotateTo(u.angle, toAng, 2.8 * dt);
        const thrust = dist > prefDist ? 155 : 60;
        moveX = fwdX * thrust;
        moveY = fwdY * thrust;
        if (kite && dist > 1100) u.aiMood = undefined;
      }
      u.vx += moveX * dt;
      u.vy += moveY * dt;
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

        let moveX = 0;
        let moveY = 0;
        if (orbit) {
          // Orbit: turn and circle around player
          u.orbit += 0.28 * dt;
          const ox = h.x + Math.cos(u.orbit) * orbitRing;
          const oy = h.y + Math.sin(u.orbit) * orbitRing;
          const to = Math.atan2(oy - u.y, ox - u.x);
          u.angle = Phaser.Math.Angle.RotateTo(u.angle, to, 1.6 * dt);
          moveX = Math.cos(u.angle) * 78;
          moveY = Math.sin(u.angle) * 78;
        } else if (kite && dist < 700) {
          // Kite: strafe laterally, face player
          u.angle = Phaser.Math.Angle.RotateTo(u.angle, toAng, 1.85 * dt);
          const radial = Phaser.Math.Clamp((dist - closeDist) * 0.3, -65, 65);
          moveX = latX * 72 + fwdX * radial;
          moveY = latY * 72 + fwdY * radial;
        } else {
          // Attack: turn and fly at player
          u.angle = Phaser.Math.Angle.RotateTo(u.angle, toAng, 1.6 * dt);
          const thrust = dist > closeDist ? 85 : 30;
          moveX = fwdX * thrust;
          moveY = fwdY * thrust;
          if (kite && dist > 900) u.aiMood = undefined;
        }
        u.vx += moveX * dt;
        u.vy += moveY * dt;
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
  steerGround(u: Unit, wantX: number, wantY: number): { x: number; y: number } {
    let wx = wantX;
    let wy = wantY;
    for (const o of this.units) {
      if (o.dead || o.id === u.id || o.pinId != null) continue;
      const osp = specOf(o.kind);
      if (osp.aerial || osp.building || osp.water) continue;
      if (!isGroundVehicle(o.kind) && osp.move !== "inf" && osp.move !== "flee") continue;
      const dx = u.x - o.x;
      const dy = u.y - o.y;
      const d = Math.hypot(dx, dy);
      const sep = radius(u.kind) + radius(o.kind) + 26;
      if (d > 0.2 && d < sep) {
        const push = (sep - d) * 1.35;
        wx += (dx / d) * push;
        wy += (dy / d) * push;
      }
    }
    const hx = wx - u.x;
    const hy = wy - u.y;
    const hd = Math.hypot(hx, hy) || 1;
    const nx = hx / hd;
    const ny = hy / hd;
    for (const dist of [28, 56, 90]) {
      if (isWater(this.world, u.x + nx * dist, u.y + ny * dist)) {
        wx -= nx * 22;
        wy -= ny * 22;
        wx += -ny * 18;
        wy += nx * 18;
        break;
      }
    }
    if (isWater(this.world, u.x, u.y)) {
      let lx = 0;
      let ly = 0;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const x = u.x + Math.cos(a) * 36;
        const y = u.y + Math.sin(a) * 36;
        if (!isWater(this.world, x, y)) {
          lx += Math.cos(a);
          ly += Math.sin(a);
        }
      }
      const ld = Math.hypot(lx, ly);
      if (ld > 0.2) {
        wx += (lx / ld) * 48;
        wy += (ly / ld) * 48;
      }
    }
    return { x: wx, y: wy };
  }

  pickBoatWaypoint(u: Unit): void {
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = 140 + Math.random() * 260;
      const x = u.x + Math.cos(a) * d;
      const y = u.y + Math.sin(a) * d;
      if (isWater(this.world, x, y) && isWater(this.world, (u.x + x) / 2, (u.y + y) / 2)) {
        u.aiTx = x;
        u.aiTy = y;
        return;
      }
    }
    u.aiTx = u.x + Math.cos(u.angle) * 80;
    u.aiTy = u.y + Math.sin(u.angle) * 80;
  }

  driveBoat(u: Unit, dt: number): void {
    const yaw = u.kind === "ptboat" ? 1.55 : 0.85;
    const spd = u.kind === "ptboat" ? 38 : 22;
    if (!isWater(this.world, u.x, u.y)) {
      let wx = 0;
      let wy = 0;
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const x = u.x + Math.cos(a) * 64;
        const y = u.y + Math.sin(a) * 64;
        if (isWater(this.world, x, y)) {
          wx += Math.cos(a);
          wy += Math.sin(a);
        }
      }
      const wd = Math.hypot(wx, wy);
      const want = wd > 0.2 ? Math.atan2(wy, wx) : u.angle;
      u.angle = Phaser.Math.Angle.RotateTo(u.angle, want, yaw * dt);
      const nx = Math.cos(u.angle);
      const ny = Math.sin(u.angle);
      const step = spd * 0.35 * dt;
      const px = u.x + nx * step;
      const py = u.y + ny * step;
      if (isWater(this.world, px, py) || wd > 0.2) {
        u.x = px;
        u.y = py;
      }
      u.vx = nx * spd * 0.35;
      u.vy = ny * spd * 0.35;
      u.aiState = "SEEK WATER";
      return;
    }
    if (u.aiTx == null || u.aiTy == null || Math.hypot((u.aiTx ?? 0) - u.x, (u.aiTy ?? 0) - u.y) < 40) {
      this.pickBoatWaypoint(u);
    }
    const ahead = 36;
    const hx = Math.cos(u.angle);
    const hy = Math.sin(u.angle);
    if (!isWater(this.world, u.x + hx * ahead, u.y + hy * ahead) || !isWater(this.world, u.x + hx * 70, u.y + hy * 70)) {
      this.pickBoatWaypoint(u);
    }
    const want = Math.atan2((u.aiTy ?? u.y) - u.y, (u.aiTx ?? u.x) - u.x);
    u.angle = Phaser.Math.Angle.RotateTo(u.angle, want, yaw * dt);
    const px = u.x + Math.cos(u.angle) * spd * dt;
    const py = u.y + Math.sin(u.angle) * spd * dt;
    if (isWater(this.world, px, py)) {
      u.x = px;
      u.y = py;
    } else {
      this.pickBoatWaypoint(u);
    }
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
        wantX = h.x + Math.cos(u.orbit) * ring;
        wantY = h.y + Math.sin(u.orbit) * ring;
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
    const want = Math.atan2(wantY - u.y, wantX - u.x);
    const spd = Math.hypot(u.vx, u.vy);
    const slow = 1 - Math.min(1, spd / Math.max(d.maxSpd, 1));
    const wheeled = d.track !== "tread";
    // Bikes can't pivot in place — need real forward speed, like trucks (trucks get it from low turn rate).
    const minTurnSpd = u.kind === "motorcycle" ? 24 : 7;
    if (drive && (!wheeled || spd > minTurnSpd)) {
      const turnGate = wheeled ? Phaser.Math.Clamp((spd - minTurnSpd) / 18, 0.15, 1) : 1;
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
    u.x += vx * dt;
    u.y += vy * dt;
    const step = s * dt;
    if (s > 6 && !isWater(this.world, u.x, u.y)) {
      u.track += step;
      if (u.track > d.trackGap) {
        u.track -= d.trackGap;
        const key = `track_${d.track}`;
        const back = specOf(u.kind).radius * 0.72;
        this.stampWreck(
          this.textures.exists(key) ? key : "track",
          u.x - Math.cos(u.angle) * back,
          u.y - Math.sin(u.angle) * back,
          u.angle + Math.PI / 2,
          d.trackScale * 1.25,
          0.7
        );
      }
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
        if ((sp.move === "inf" || sp.move === "flee") && !this.pickupHost(u)) {
          const canShoot = !!sp.weapon;
          if (sp.organic && u.health > 1 && u.health < u.max) u.health = Math.max(1, u.health - u.max * 0.05 * dt);
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
            u.angle = Phaser.Math.Angle.RotateTo(u.angle, Math.atan2(dy, dx), 1.8 * dt);
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
            const want = Math.atan2(steered.y - u.y, steered.x - u.x);
            const face = fleeing ? want : Math.atan2(dy, dx);
            u.angle = Phaser.Math.Angle.RotateTo(u.angle, face, (fleeing ? 2.4 : 2.1) * dt);
            const limp = fleeing && wounded && sp.organic;
            const gaitHz = limp ? 0.0044 : fleeing ? 0.0128 : 0.0075;
            const walk = Math.sin(this.time.now * gaitHz + u.id * 2.1);
            const gait = 0.22 + 0.78 * Math.pow(0.5 + 0.5 * walk, 1.45);
            const base = sp.move === "flee" && !sp.organic ? (u.kind === "officer" ? 36 : 90) : fleeing ? 78 : 58;
            const step = (limp ? 22 : base) * gait * dt;
            u.x += Math.cos(want) * step;
            u.y += Math.sin(want) * step;
            if (limp) {
              u.track += step;
              if (u.track > 0) {
                const side = walk > 0 ? 1 : -1;
                const px = -Math.sin(want);
                const py = Math.cos(want);
                this.stampSoldierBlood(
                  u,
                  px * range(2.2, 5.5) * side,
                  py * range(2.2, 5.5) * side,
                  want + range(-0.35, 0.35)
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
        (sp.move === "inf" && u.aiMood === "flee" && !(sp.organic && u.health <= 1) && !this.pickupHost(u)) ||
        (u.kind === "heli_small" && u.aiMood === "flee");
      const strafeHeli = sp.move === "heli" && u.kind !== "heli_heavy";
      if (sp.fixedAim && !guns.length && wpn && inRange && !hullFlee && !strafeHeli) {
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
      const soldierFlee = inf && u.aiMood === "flee" && !soldierDown && !this.pickupHost(u);
      const scoutFlee = u.kind === "heli_small" && u.aiMood === "flee";
      const aimFrom = guns.length ? this.gunMountPos(u, gunI) : { x: u.x, y: u.y };
      const gunAim = Math.atan2(h.y - aimFrom.y, h.x - aimFrom.x);
      const barrelAng = !guns.length ? u.angle : (u.turrets[gunI] ?? u.turret);
      const facingOk = Math.abs(Phaser.Math.Angle.Wrap(gunAim - barrelAng)) < 0.16;
      if (wpn && u.fireCd <= 0 && !soldierFlee && !scoutFlee && facingOk && (inRange || continueBurst)) {
        const burstN = wpn.burst ?? 0;
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
        const tipI = u.muzzleTip % tipCount;
        u.muzzleFireTip = tipI;
        u.muzzleTip = tipI;
        const muzzle = this.enemyMuzzle(u, gunI);
        if (tipCount > 1) u.muzzleTip = (tipI + 1) % tipCount;
        // Stay on the same gun for the whole burst so each mount keeps its own ammo type.
        if (guns.length > 1 && (u.burstLeft ?? 0) <= 0) u.muzzleGun = (gunI + 1) % guns.length;
        const fireAng = barrelAng + jitter;
        const muzzleZ = u.z + heightOf(u.kind) * 0.7 + ZOff.shot;
        const tgtZ = h.z + HELI_HEIGHT * 0.5;
        const shotDist = Math.max(40, dist);
        const t = Math.max(0.12, shotDist / wpn.speed);
        u.muzzleT = 0.07;
        u.muzzleJitS = range(0.9, 1.12);
        u.muzzleJitR = range(-0.1, 0.1);
        u.muzzleFrame = (Math.random() * FX_VARIANTS) | 0;
        this.spawnMuzzleLight(
          muzzle.x,
          muzzle.y - screenLift(u.z),
          u.z,
          (sp.organic ? 18 : 28) * zScale(u.z) * (u.muzzleJitS ?? 1)
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
        const home = wpn.shot === "hellfire";
        const troopRocket = u.kind === "rpg" || u.kind === "stinger";
        this.spawnShot({
          kind: wpn.shot,
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
          tracer: wpn.tracer,
          guided: false,
          homePlayer: home,
          motor: home ? -0.06 : undefined,
          scale: troopRocket
            ? u.kind === "rpg"
              ? 0.56
              : 0.59
            : u.kind === "gunner" || u.kind === "mounted_mg"
              ? 0.34
              : undefined,
        });
      }
      if (u.kind === "heli" && dist < 700 && dist > 80 && h.phase === "flight") {
        const aimErr = Math.abs(Phaser.Math.Angle.Wrap(Math.atan2(dy, dx) - u.angle));
        u.missileCd = (u.missileCd ?? (4 + Math.random() * 3)) - dt;
        if (u.missileCd <= 0 && aimErr < Math.PI / 2) {
          u.missileCd = 5.5 + Math.random() * 4;
          const pylons = SPRITE_MOUNT.enemy_heli_pylon;
          const side = (u.missileSide ?? 0) % pylons.length;
          u.missileSide = side + 1;
          const pylon = pylons[side]!;
          const pivot = spritePivot(textureOf(u.kind));
          const hullRot = u.angle + specOf(u.kind).rotOff;
          const zs = zScale(u.z);
          const hullImg = this.textures.exists(textureOf(u.kind))
            ? (this.textures.get(textureOf(u.kind)).getSourceImage() as { width: number; height: number })
            : { width: 64, height: 64 };
          const dw = hullImg.width * zs;
          const dh = hullImg.height * zs;
          const mx = (pylon.x - pivot.x) * dw;
          const my = (pylon.y - pivot.y) * dh;
          const px = u.x + mx * Math.cos(hullRot) - my * Math.sin(hullRot);
          const py = u.y + mx * Math.sin(hullRot) + my * Math.cos(hullRot);
          const muzzleZ = u.z + heightOf(u.kind) * 0.5;
          const fireAng = u.angle + (Math.random() - 0.5) * 0.04;
          const tgtZ = h.z + HELI_HEIGHT * 0.5;
          const missileT = Math.max(0.25, dist / 300);
          this.spawnShot({
            kind: "hellfire",
            from: "enemy",
            x: px,
            y: py,
            z: muzzleZ,
            vx: Math.cos(fireAng) * 300,
            vy: Math.sin(fireAng) * 300,
            vz: Phaser.Math.Clamp((tgtZ - muzzleZ) / missileT, -280, 420),
            angle: fireAng,
            life: missileT + 1.5,
            blast: 20,
            dmg: 18,
            tracer: "shell",
            homePlayer: true,
            motor: -0.06,
            scale: 0.72,
          });
          this.missileMuzzle(px, py, u.z, fireAng);
        }
      }
    }
    this.syncUnitSprites();
  }

  syncUnitSprites(): void {
    const live = this.units.filter((u) => !u.dead);
    const SLOTS = 9;
    while (this.unitG.getLength() < live.length * SLOTS) {
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
    live.forEach((u, i) => {
      const sp = specOf(u.kind);
      const guns = gunsOf(u);
      const sh = kids[i * SLOTS]!;
      const im = kids[i * SLOTS + 1]!;
      const parts = kids.slice(i * SLOTS + 2, i * SLOTS + 8);
      const flash = kids[i * SLOTS + 8]!;
      const tex = resolveSkin(this.textures, textureOf(u.kind), u.camo);
      const rot = u.angle + sp.rotOff;
      const lift = screenLift(u.z);
      const zs = zScale(u.z);
      const pivot = spritePivot(textureOf(u.kind));
      const ox = pivot.x;
      const oy = pivot.y;
      const zBias = u.pinId != null ? ZOff.posted : 0;
      sh.setVisible(true).setOrigin(ox, oy);
      this.applyCastShadow(sh, u.x, u.y, u.z, tex, rot, sp.aerial ? 1 : 0.92);
      im.setVisible(true)
        .setTexture(tex)
        .setOrigin(ox, oy)
        .setPosition(u.x, u.y - lift)
        .setRotation(rot)
        .setDepth(worldDepth(u.z, ZOff.body + zBias));
      if (!sp.aerial) {
        const sl = groundSlope(this.world, u.x, u.y);
        im.setScale(
          (1 + Phaser.Math.Clamp(Math.abs(sl.dx), 0, 0.4) * 0.22) * zs,
          (1 - Phaser.Math.Clamp(sl.dy, -0.45, 0.45) * 0.2) * zs
        );
      } else im.setScale(zs);
      let pi = 0;
      const gunDepth = sp.move === "heli" ? ZOff.gun : ZOff.turret;
      const place = (
        part: Phaser.GameObjects.Image,
        texKey: string,
        origin: { x: number; y: number },
        mount: { x: number; y: number },
        worldRot: number,
        depth: number,
        sc = 1
      ) => {
        if (!this.textures.exists(texKey)) return;
        this.unwrapTilt(part);
        const mx = (mount.x - ox) * im.displayWidth;
        const my = (mount.y - oy) * im.displayHeight;
        part
          .setVisible(true)
          .setTexture(texKey)
          .setOrigin(origin.x, origin.y)
          .setPosition(im.x + mx * Math.cos(rot) - my * Math.sin(rot), im.y + mx * Math.sin(rot) + my * Math.cos(rot))
          .setRotation(worldRot)
          .setAlpha(1)
          .setScale(im.scaleX * sc, im.scaleY * sc)
          .setDepth(worldDepth(u.z, depth + zBias));
      };
      guns.forEach((g, gi) => {
        const part = parts[pi++];
        if (!part) return;
        const gorig =
          g.tex === "enemy_tank_gun"
            ? tankLayout.turretOrigin
            : g.origin;
        const gmount = g.tex === "enemy_tank_gun" ? tankLayout.mountOrigin : g.mount;
        place(
          part,
          resolveSkin(this.textures, g.tex, u.camo),
          gorig,
          gmount,
          gunWorldRot(g.tex, u.turrets[gi] ?? u.turret),
          gunDepth,
          g.scale ?? 1
        );
      });
      sp.rotors.forEach((r, ri) => {
        const part = parts[pi++];
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
        const part = parts[pi++];
        if (part && this.textures.exists(sp.dish.tex)) {
          const d = sp.dish;
          const mx = (d.mount.x - ox) * im.displayWidth;
          const my = (d.mount.y - oy) * im.displayHeight;
          const px = im.x + mx * Math.cos(rot) - my * Math.sin(rot);
          const py = im.y + mx * Math.sin(rot) + my * Math.cos(rot);
          const sc = d.scale ?? 1;
          let wrap = part.getData("tiltWrap") as Phaser.GameObjects.Container | undefined;
          if (!wrap || !wrap.scene) {
            wrap = this.add.container(px, py);
            wrap.add(part);
            part.setData("tiltWrap", wrap);
          }
          wrap
            .setVisible(true)
            .setPosition(px, py)
            .setScale(im.scaleX * sc * 1.04, im.scaleY * sc * 0.52)
            .setRotation(u.rotor)
            .setDepth(worldDepth(u.z, ZOff.turret + zBias));
          part
            .setVisible(true)
            .setTexture(d.tex)
            .setOrigin(d.origin.x, d.origin.y)
            .setPosition(0, 0)
            .setRotation(0)
            .setAlpha(1)
            .setScale(1);
        }
      }
      if (u.muzzleT > 0 && (sp.weapon || guns.length)) {
        const tip = this.enemyMuzzle(u, u.muzzleGun);
        const ang = !guns.length ? u.angle : u.turrets[u.muzzleGun] ?? u.turret;
        const jitS = u.muzzleJitS ?? 1;
        const jitR = u.muzzleJitR ?? 0;
        flash
          .setVisible(true)
          .setTexture("fx_muzzle")
          .setFrame(u.muzzleFrame ?? 0)
          .setBlendMode(Phaser.BlendModes.ADD)
          .setTint(0xfff6d0)
          .setOrigin(0.15, 0.5)
          .setPosition(tip.x, tip.y - lift)
          .setRotation(ang + jitR)
          .setScale((sp.organic ? 0.7 : 1.15) * zs * jitS)
          .setAlpha(Phaser.Math.Clamp(u.muzzleT / 0.07, 0, 1))
          .setDepth(worldDepth(u.z, gunDepth + 0.4 + zBias));
      }
    });
  }

  enemyMuzzle(u: Unit, gunI = 0): { x: number; y: number } {
    const sp = specOf(u.kind);
    const guns = gunsOf(u);
    const wpn = guns[gunI]?.weapon ?? sp.weapon;
    const gun = guns[gunI];
    const zs = zScale(u.z);
    const hullRot = u.angle + sp.rotOff;
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
      const lx = (uv.x - origin.x) * tw * zs;
      const ly = (uv.y - origin.y) * th * zs;
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
      const len = wpn?.muzzleLen ?? 10;
      const a = u.angle;
      return { x: u.x + Math.cos(a) * len, y: u.y + Math.sin(a) * len };
    }
    const origin = gun.tex === "enemy_tank_gun" ? tankLayout.turretOrigin : gun.origin;
    const mount = gun.tex === "enemy_tank_gun" ? tankLayout.mountOrigin : gun.mount;
    const dw = hullImg.width * zs;
    const dh = hullImg.height * zs;
    const mx = (mount.x - hullPivot.x) * dw;
    const my = (mount.y - hullPivot.y) * dh;
    const hx = u.x + mx * Math.cos(hullRot) - my * Math.sin(hullRot);
    const hy = u.y + mx * Math.sin(hullRot) + my * Math.cos(hullRot);
    const gtex = this.textures.exists(gun.tex)
      ? (this.textures.get(gun.tex).getSourceImage() as { width: number; height: number })
      : { width: 24, height: 48 };
    const tips = gun.muzzles?.length ? gun.muzzles : [gun.muzzle ?? { x: 0.5, y: 0.08 }];
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
      this.shotG.add(this.add.image(0, 0, "cannon"));
    }
    const kids = this.shotG.getChildren() as Phaser.GameObjects.Image[];
    for (const k of kids) k.setVisible(false);
    this.shots.forEach((s, i) => {
      const sh = kids[i * 2]!;
      const im = kids[i * 2 + 1]!;
      const key =
        s.kind === "cannon"
          ? s.tracer === "aa"
            ? "tracer_aa"
            : s.tracer === "small"
              ? "tracer_sm"
              : s.tracer === "shell"
                ? "shell"
                : "cannon"
          : s.kind === "rocket"
            ? "rocket"
            : s.kind === "hellfire"
              ? "hellfire"
              : "tow";
      const rot = s.kind === "cannon" ? s.angle : s.angle + Math.PI / 2;
      const ox = s.kind === "cannon" ? 0.84 : 0.5;
      const vis = s.scale ?? 1;
      const sc =
        (s.kind === "cannon"
          ? s.tracer === "aa"
            ? 0.95
            : s.tracer === "small"
              ? 0.46
              : s.tracer === "shell"
                ? 0.72
                : 0.58
          : 1) * vis;
      const zs = zScale(s.z);
      // Foreshorten along the barrel when climbing/diving (non-zero vz).
      const horiz = Math.hypot(s.vx, s.vy);
      const pitchN = Phaser.Math.Clamp(Math.abs(s.vz) / Math.max(90, Math.hypot(horiz, s.vz)), 0, 1);
      const along = 1 - pitchN * 0.52;
      const across = 1 + pitchN * 0.06;
      sh.setVisible(true).setOrigin(ox, 0.5);
      this.applyCastShadow(sh, s.x, s.y, s.z, key, rot, sc);
      im.setVisible(true)
        .setTexture(key)
        .setOrigin(ox, 0.5)
        .setPosition(s.x, s.y - screenLift(s.z))
        .setRotation(rot)
        .setScale(sc * zs * along, sc * zs * across)
        .setDepth(worldDepth(s.z));
    });
  }

  syncFragSprites(): void {
    const vis = this.frags.filter((f) => !f.trailOnly);
    while (this.fragG.getLength() < vis.length * 2) {
      this.fragG.add(this.add.image(0, 0, "shadow"));
      this.fragG.add(this.add.image(0, 0, "fx_frag_metal"));
    }
    const kids = this.fragG.getChildren() as Phaser.GameObjects.Image[];
    for (const k of kids) {
      k.setVisible(false);
      const wrap = k.getData("tiltWrap") as Phaser.GameObjects.Container | undefined;
      if (wrap) wrap.setVisible(false);
    }
    vis.forEach((f, i) => {
      const sh = kids[i * 2]!;
      const im = kids[i * 2 + 1]!;
      const z = f.z || 0;
      const { x: ox, y: oy } = spritePivot(f.key);
      const sc = (f.scale ?? 1) * zScale(z);
      let sx = sc;
      let sy = sc;
      if (f.dishFlat) {
        sx = sc * 1.04;
        sy = sc * 0.52;
      } else if (f.rotorSkew) {
        sx = sc * 1.14;
        sy = sc * 0.56;
      }
      const cast = castZ(this.world, f.x, f.y, z);
      // Rotor throws have no baked shadow atlas — generic soft "shadow" scales into a huge gray blob.
      const canShadow =
        !f.rotorThrow && !f.pinHost && !f.boatSink && this.textures.exists(shadowKey(f.key, cast));
      const depth = f.settled ? Layer.HULK : worldDepth(z, ZOff.body + (f.pinHost ? 0.55 : 0.35));
      const spd = Math.hypot(f.vx, f.vy);
      // Squash along travel; inner image keeps f.angle spin relative to heading.
      const wheelSquash = !!f.wheelRoll && !f.settled && spd > 8;
      if (wheelSquash) {
        const travel = Math.atan2(f.vy, f.vx);
        const t = Phaser.Math.Clamp((spd - 8) / 160, 0, 1);
        // Squash perpendicular to travel (narrow across, slightly longer along).
        const along = Phaser.Math.Linear(1.04, 1.2, t);
        const across = Phaser.Math.Linear(0.9, 0.66, t);
        let wrap = im.getData("tiltWrap") as Phaser.GameObjects.Container | undefined;
        if (!wrap || !wrap.scene) {
          wrap = this.add.container(f.x, f.y - screenLift(z));
          wrap.add(im);
          im.setData("tiltWrap", wrap);
        }
        wrap
          .setVisible(true)
          .setPosition(f.x, f.y - screenLift(z))
          .setRotation(travel)
          .setScale(sc * along, sc * across)
          .setDepth(depth)
          .setAlpha(1);
        im.setVisible(true)
          .setTexture(f.key)
          .setOrigin(ox, oy)
          .setPosition(0, 0)
          .setRotation(f.angle - travel)
          .setScale(1)
          .setAlpha(1);
        if (canShadow) {
          sh.setVisible(true).setOrigin(ox, oy);
          this.applyCastShadow(sh, f.x, f.y, z, f.key, travel, f.scale ?? 1);
          sh.setScale(sh.scaleX * along, sh.scaleY * across);
          if (cast < 1) sh.setAlpha(0.22);
        }
        return;
      }
      this.unwrapTilt(im);
      if (canShadow) {
        sh.setVisible(true).setOrigin(ox, oy);
        this.applyCastShadow(sh, f.x, f.y, z, f.key, f.angle, f.scale ?? 1);
        if (f.dishFlat) sh.setScale(sh.scaleX * 1.04, sh.scaleY * 0.52);
        if (cast < 1) sh.setAlpha(0.22);
      }
      const sinkU =
        f.boatSink && !f.settled
          ? Phaser.Math.Clamp((f.sinkT ?? 0) / Math.max(0.5, f.sinkMax ?? 6), 0, 1)
          : -1;
      im.clearTint();
      im.setVisible(true)
        .setTexture(f.key)
        .setOrigin(ox, oy)
        .setPosition(f.x, f.y - screenLift(z))
        .setRotation(f.angle)
        .setScale(sx, sy)
        .setDepth(depth)
        .setAlpha(
          f.settled ? 0.92 : sinkU >= 0 ? Phaser.Math.Linear(0.92, 0.78, sinkU * sinkU) : 1
        );
    });
  }

  unitById(id: number): Unit | undefined {
    return this.units.find((q) => q.id === id && !q.dead);
  }

  tickHellfireLock(dt: number, ptr: { x: number; y: number }): void {
    const h = this.heli;
    if (h.hellfireLock && !this.unitById(h.hellfireLock.id)) h.hellfireLock = null;
    if (h.hellfireSeek && !this.unitById(h.hellfireSeek.id)) h.hellfireSeek = null;

    if (WPN_LIST[h.weapon]!.id !== "hellfire") return;

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
    return (radius(u.kind) + 10) * scale * zScale(u.z);
  }

  drawLockBox(
    u: Unit,
    scale: number,
    width: number,
    alpha: number,
    color = 0xff3a22
  ): { x: number; y: number; half: number; depth: number } {
    const g = this.lockGfx;
    const x = u.x;
    const y = u.y - screenLift(u.z);
    const half = this.lockBoxHalf(u, scale);
    const depth = worldDepth(u.z, 8);
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
    const x = u.x;
    const y = u.y - screenLift(u.z);
    const half = this.lockBoxHalf(u, scale);
    const depth = worldDepth(u.z, 8);
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
      if (s.kind !== "hellfire" || s.from !== "player" || s.targetId == null) continue;
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

    const hellfire = WPN_LIST[h.weapon]!.id === "hellfire";
    const inbound = this.inboundHellfireTargets();
    const locked = hellfire && h.hellfireLock ? this.unitById(h.hellfireLock.id) : undefined;
    const seeking = hellfire && h.hellfireSeek ? this.unitById(h.hellfireSeek.id) : undefined;
    if (!locked && !seeking && inbound.length === 0) {
      g.setVisible(false);
      return;
    }

    g.setVisible(true);
    let lockDepth = Layer.FIELD;
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
            .setScale(zScale(u.z));
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
          .setScale(zScale(locked.z));
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

  worldPointer(): { x: number; y: number } {
    const p = this.input.activePointer;
    const pt = this.cameras.main.getWorldPoint(p.x, p.y);
    return { x: pt.x, y: pt.y };
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
    const sx = ((u.x - view.x) / view.width) * w;
    const sy = ((u.y - screenLift(u.z) - view.y) / view.height) * h;
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

  hoverAerial(x: number, y: number): Unit | undefined {
    let best: Unit | undefined;
    let bd = 58;
    for (const u of this.units) {
      if (u.dead) continue;
      if (castZ(this.world, u.x, u.y, u.z) < 16 && !isAerial(u.kind)) continue;
      const d = Math.hypot(u.x - x, u.y - y);
      if (d < bd) {
        bd = d;
        best = u;
      }
    }
    return best;
  }

  reticleUnit(x: number, y: number): Unit | undefined {
    let best: Unit | undefined;
    let bd = Infinity;
    for (const u of this.units) {
      if (u.dead) continue;
      const d = Math.hypot(u.x - x, u.y - screenLift(u.z) - y);
      const hit = radius(u.kind) + 12;
      if (d <= hit && d < bd) {
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
    const w = WPN_LIST[h.weapon]!;
    const ammo = this.ammo[h.weapon]!;
    const ammoS = this.infAmmo && Number.isFinite(ammo) ? "∞" : Number.isFinite(ammo) ? String(ammo) : "∞";
    const phase =
      h.phase === "grounded" || h.phase === "spool"
        ? "SPOOLING ROTORS"
        : h.phase === "ready"
          ? "READY"
          : h.phase === "dead"
            ? "DOWN"
            : "AIRBORNE";
    const ptr = this.worldPointer();
    const elv = groundZ(this.world, ptr.x, ptr.y) | 0;
    const over = this.reticleUnit(ptr.x, ptr.y);
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
    const n = WPN_LIST.length;
    const total = n * slotW + (n - 1) * gap;
    const x0 = this.scale.width / 2 - total / 2;
    const y = this.scale.height - 16 - slotH;
    for (let i = 0; i < n; i++) {
      const wp = WPN_LIST[i]!;
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
    const span = 1700;
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
    const mark = (x: number, y: number, r: number, hgt: number, z: number) => {
      const gnd = groundZ(this.world, x, y);
      const agl = Math.max(0, z - gnd);
      this.debugGfx.lineStyle(1.25, 0x5ec8ff, 0.9);
      this.debugGfx.strokeCircle(x, y, r);
      this.debugGfx.lineStyle(1.15, 0xe8e0c8, 0.4);
      this.debugGfx.lineBetween(x, y, x, y + z);
      this.debugGfx.lineStyle(2.2, 0xff8a3a, 0.95);
      this.debugGfx.lineBetween(x, y, x, y + agl);
      this.debugGfx.lineStyle(2, 0x6dbb4a, 0.95);
      this.debugGfx.lineBetween(x, y, x, y - hgt);
    };
    mark(this.heli.x, this.heli.y, 24, HELI_HEIGHT, this.heli.z);
    for (const u of this.units) {
      if (u.dead) continue;
      mark(u.x, u.y, radius(u.kind), heightOf(u.kind), u.z);
    }
    for (const s of this.shots) {
      mark(s.x, s.y, 5, 4, s.z);
    }
    for (const f of this.frags) {
      mark(f.x, f.y, 6, 6, f.z);
    }
  }

  drawDebugAi(): void {
    this.aiGfx.clear();
    if (!this.debugAi) {
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
      const lift = screenLift(u.z);
      const ux = u.x;
      const uy = u.y - lift;
      if (u.aiTx != null && u.aiTy != null) {
        const ty = u.aiTy - screenLift(groundZ(this.world, u.aiTx, u.aiTy));
        this.aiGfx.lineBetween(ux, uy, u.aiTx, ty);
        this.aiGfx.fillStyle(0x5ec8ff, 0.95);
        this.aiGfx.fillCircle(u.aiTx, ty, 3.2);
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

  toggleHeightMap(): void {
    this.showHeightMap = !this.showHeightMap;
    this.debugHit = this.showHeightMap;
    this.debugGfx.setVisible(this.debugHit);
    if (!this.debugHit) this.debugGfx.clear();
    const key = this.showHeightMap ? "heightmap" : "terrain";
    this.ground.setTexture(key).setDisplaySize(WORLD, WORLD);
    this.miniTerrain.setTexture(key);
    this.wreckLayer.setVisible(!this.showHeightMap);
    this.miniWrecks.setVisible(!this.showHeightMap && this.miniTerrain.visible);
    this.syncDebugMenu();
  }

  toggleDebugMenu(force?: boolean): void {
    this.debugOpen = force ?? !this.debugOpen;
    if (!this.debugOpen) {
      this.debugSpawnOpen = false;
      this.debugCamOpen = false;
    }
    this.debugRoot.setVisible(this.debugOpen);
    if (this.debugOpen) this.syncDebugMenu();
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
    const rowH = 26;
    const labels = [
      "NO DAMAGE",
      "INFINITE AMMO",
      "HEIGHT MAP   K",
      "DEBUG AI",
      "FX           F",
      "RELIEF       E",
      "CAMERA",
      "SPAWN",
    ];
    this.debugRoot = this.add.container(x, y);
    this.debugRoot.setDepth(Layer.HUD + 180);
    this.debugRoot.setScrollFactor(0);
    this.debugPanel = this.add.graphics();
    this.debugTitle = this.add.text(12, 10, "/  DEBUG", {
      fontFamily: "Share Tech Mono, monospace",
      fontSize: "13px",
      color: "#e8b84a",
    }).setName("debug_title");
    this.debugRows = labels.map((_label, i) => {
      const t = this.add
        .text(12, 38 + i * rowH, "", {
          fontFamily: "Share Tech Mono, monospace",
          fontSize: "13px",
          color: "#f0e6c8",
        })
        .setInteractive({ useHandCursor: true })
        .setName(`debug_row_${i}`);
      t.on("pointerdown", () => {
        if (this.debugSpawnOpen || this.debugCamOpen) return;
        this.debugMenuIdx = i;
        this.activateDebugRow(i);
      });
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
    const camLabels = ["Y-LIFT", "EYE", "ZOOM0"];
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
        this.nudgeDebugCam(1);
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
    this.syncDebugMenu();
  }

  syncDebugMenu(): void {
    if (!this.debugRows.length) return;
    const w = 300;
    const rowH = 26;
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
        .setText("CAMERA   ↑↓ select  ←→ nudge   ESC back");
      const vals = [
        CamTune.lift.toFixed(3),
        String(CamTune.cam | 0),
        CamTune.zoom0.toFixed(2),
      ];
      const names = ["Y-LIFT", "EYE", "ZOOM0"];
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
    const flags = [
      this.noDamage,
      this.infAmmo,
      this.showHeightMap,
      this.debugAi,
      this.fxOn,
      this.editOpen,
    ];
    const names = [
      "NO DAMAGE",
      "INFINITE AMMO",
      "HEIGHT MAP   K",
      "DEBUG AI",
      "FX           F",
      "RELIEF       E",
    ];
    // Number shortcuts only for rows without a letter hotkey.
    const nums = ["1", "2", "", "3", "", "", "4", "5"];
    if (this.debugMenuIdx >= this.debugRows.length) this.debugMenuIdx = 0;
    for (let i = 0; i < this.debugRows.length; i++) {
      const row = this.debugRows[i]!;
      row.setVisible(true);
      const num = nums[i]!;
      const focus = i === this.debugMenuIdx;
      const mark = focus ? "▸" : " ";
      const prefix = num ? `${mark}${num} ` : `${mark}  `;
      if (i < 6) {
        const on = flags[i]!;
        row.setText(`${prefix}${names[i]!}            ${on ? "ON" : "OFF"}`);
        row.setColor(focus ? "#e8b84a" : on ? "#c8b87a" : "#8a8470");
      } else if (i === 6) {
        row.setText(`${prefix}CAMERA…`);
        row.setColor(focus ? "#e8b84a" : "#f0e6c8");
      } else {
        row.setText(`${prefix}SPAWN…`);
        row.setColor(focus ? "#e8b84a" : "#f0e6c8");
      }
    }
  }

  nudgeDebugMenu(dir: number): void {
    const n = this.debugRows.length;
    if (!n) return;
    this.debugMenuIdx = (this.debugMenuIdx + dir + n) % n;
    this.syncDebugMenu();
  }

  activateDebugRow(i: number): void {
    if (i === 0) this.setNoDamage(!this.noDamage);
    else if (i === 1) this.setInfAmmo(!this.infAmmo);
    else if (i === 2) this.toggleHeightMap();
    else if (i === 3) this.setDebugAi(!this.debugAi);
    else if (i === 4) this.toggleTestFx();
    else if (i === 5) this.toggleReliefEditor();
    else if (i === 6) this.openDebugCam();
    else if (i === 7) this.openDebugSpawn();
    this.syncDebugMenu();
  }

  nudgeCamLift(dir: number): void {
    CamTune.lift = Phaser.Math.Clamp(Math.round((CamTune.lift + dir * 0.005) * 1000) / 1000, 0.01, 0.2);
    this.syncDebugMenu();
  }

  nudgeCamProj(dir: number): void {
    CamTune.cam = Phaser.Math.Clamp(CamTune.cam + dir * 20, 160, 1200);
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
    if (this.debugCamIdx === 0) this.nudgeCamLift(dir);
    else if (this.debugCamIdx === 1) this.nudgeCamProj(dir);
    else this.nudgeCamZoom0(dir);
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
    if (kind === "lookout") {
      const at = this.mountAt(u, "building_lookout", SPRITE_MOUNT.building_lookout);
      this.units.push(this.makeUnit(pickLookoutTroop(), at.x, at.y, u.id));
    } else if (kind === "bunker") {
      for (const m of SPRITE_MOUNT.building_bunker) {
        const at = this.mountAt(u, "building_bunker", m);
        this.units.push(this.makeUnit(pickLookoutTroop(), at.x, at.y, u.id));
      }
    } else if (kind === "pickup" && Math.random() < 0.33) {
      const at = this.mountAt(u, "enemy_pickup", SPRITE_MOUNT.enemy_pickup);
      this.units.push(this.makeUnit(pickPickupTroop(), at.x, at.y, u.id));
    }
  }

  toggleReliefEditor(force?: boolean): void {
    const want = force ?? !this.editOpen;
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
    rebuildWorldPatch(this.world, d.x0, d.y0, d.x1, d.y1, this.biomeTiles, (g, x0, y0, x1, y1) =>
      this.stampDecorRect(g, x0, y0, x1, y1)
    );
    paintHeightMapRect(this.heightMapCanvas, this.world.height, d.x0, d.y0, d.x1, d.y1);
    (this.textures.get("terrain") as Phaser.Textures.CanvasTexture).refresh();
    (this.textures.get("heightmap") as Phaser.Textures.CanvasTexture).refresh();
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
    g.save();
    g.translateCanvas(x, y);
    g.rotateCanvas(this.editRot);
    const s = this.editSize;
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
    const chrome: Phaser.GameObjects.GameObject[] = [
      this.miniBg,
      this.miniTerrain,
      this.miniWrecks,
      this.miniGfx,
      this.hud,
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
    markHudTree(this.spriteCfg.root);
    markHudTree(this.debugRoot);
    if (this.editRoot) markHudTree(this.editRoot);
    this.children.each((obj) => {
      if (!this.hudSet.has(obj)) this.bindWorld(obj);
    });
    this.events.on("addedtoscene", (obj: Phaser.GameObjects.GameObject) => {
      if (this.hudSet.has(obj)) return;
      this.bindWorld(obj);
    });
  }

  bindHud(go: Phaser.GameObjects.GameObject): void {
    this.hudSet.add(go);
    go.setScrollFactor(0);
    go.cameraFilter = this.cameras.main.id;
  }

  adoptHud(go: Phaser.GameObjects.GameObject & { x: number; y: number }): void {
    this.bindHud(go);
    const lp = this.hudLocal(go.x, go.y);
    this.hudRoot.add(go);
    go.setPosition(lp.x, lp.y);
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
      const altN = Phaser.Math.Clamp(castZ(this.world, heli.x, heli.y, heli.z) / MAX_AGL, 0, 1);
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
    // Zoom is the inverse of zScale(focus) so the focus stays constant screen size.
    const base = camZoomAt(h.z);
    const spdN = Phaser.Math.Clamp(Math.hypot(h.vx, h.vy) / 340, 0, 1);
    return base * (1 - spdN * 0.06);
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
    const cam = this.cameras.main;
    const p = this.input.activePointer;
    const z = Math.max(cam.zoom, 0.001);
    const wpn = WPN_LIST[this.heli.weapon]!.id;
    const look =
      wpn === "hellfire"
        ? { pull: 0.86, max: 360, rate: 5.2 }
        : wpn === "rocket"
          ? { pull: 0.42, max: 160, rate: 7.4 }
          : wpn === "tow"
            ? { pull: 0.55, max: 210, rate: 6.5 }
            : { pull: 0.2, max: 88, rate: 10 };
    const pull = look.pull;
    const max = look.max;
    let ox = ((p.x - this.scale.width / 2) / z) * pull;
    let oy = ((p.y - this.scale.height / 2) / z) * pull;
    const len = Math.hypot(ox, oy);
    if (len > max) {
      ox *= max / len;
      oy *= max / len;
    }
    let rate = look.rate;
    let tow: Shot | undefined;
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i]!;
      if (s.kind === "tow" && s.from === "player") {
        tow = s;
        break;
      }
    }
    if (tow) {
      this.towLookX = tow.x;
      this.towLookY = tow.y;
      this.towLookHold = 0;
      ox += (tow.x - this.body.x) * 0.82;
      oy += (tow.y - this.body.y) * 0.82;
      rate = 5.4;
    } else if (this.towLookHold > 0) {
      this.towLookHold = Math.max(0, this.towLookHold - dt);
      ox += (this.towLookX - this.body.x) * 0.82;
      oy += (this.towLookY - this.body.y) * 0.82;
      rate = 5.4;
    }
    const k = 1 - Math.exp(-rate * dt);
    this.lookCamX = Phaser.Math.Linear(this.lookCamX, ox, k);
    this.lookCamY = Phaser.Math.Linear(this.lookCamY, oy, k);
    cam.centerOn(this.body.x + this.lookCamX, this.body.y + this.lookCamY);
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
      const zs = zScale(u.z);
      const w = (isOrganic(u.kind) ? 16 : 32) * zs;
      const ratio = Phaser.Math.Clamp(u.health / u.max, 0, 1);
      const x = u.x - w / 2;
      const y = u.y - screenLift(u.z) - heightOf(u.kind) * 0.35 * zs - 14 * zs;
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
    const hp = Phaser.Math.Clamp(h.health / 100, 0, 1);
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

    for (const site of h.dmgSites) {
      const uv = PLAYER_DMG_POI_UV[site.poi];
      if (!uv) continue;
      const mapped = heliHudWireUv(bake, uv.u, uv.v);
      const mx = wireX + (mapped.u - ox) * drawW;
      const my = wireY + (mapped.v - oy) * drawH;
      const hmPulse = 0.65 + 0.35 * Math.sin(this.time.now * 0.022 + site.poi * 1.7);
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
    if (h.phase !== "dead" && h.health < 98) {
      const want = h.health < 25 ? 3 : h.health < 45 ? 2 : h.health < 75 ? 1 : 0;
      const poiN = this.playerDmgPois().length;
      while (h.dmgSites.length > want) h.dmgSites.pop();
      while (h.dmgSites.length < want) {
        const used = new Set(h.dmgSites.map((s) => s.poi));
        const pool = Array.from({ length: poiN }, (_, i) => i).filter((i) => !used.has(i));
        if (!pool.length) break;
        const poi = pool[(Math.random() * pool.length) | 0]!;
        h.dmgSites.push({ poi, scale: range(0.42, 0.8) });
      }
      if (want) {
        const { fire, smoke } = this.pairFx(h.z, this.playerFlame, this.playerHurtSmoke, ZOff.dmg, ZOff.smoke);
        const pois = this.playerDmgPois();
        for (const s of h.dmgSites) {
          const base = pois[s.poi] ?? pois[0]!;
          const p = jitterDisk(base.x, base.y, 10 + s.scale * 6);
          this.dmgFlameScale = s.scale * 1.65;
          if (Math.random() < 0.72) fire.emitParticleAt(p.x, p.y, 2);
          if (Math.random() < 0.4) smoke.emitParticleAt(p.x, p.y + 9, 1);
        }
      }
    } else if (h.phase !== "dead") {
      h.dmgSites.length = 0;
    }
  }

  emitUnitDamageFx(): void {
    for (const u of this.units) {
      if (u.dead || isOrganic(u.kind)) continue;
      const ratio = u.health / Math.max(u.max, 1);
      const want = ratio < 0.25 ? 3 : ratio < 0.45 ? 2 : ratio < 0.75 ? 1 : 0;
      if (!u.dmgSites) u.dmgSites = [];
      const pois = this.unitDmgPois(u);
      while (u.dmgSites.length > want) u.dmgSites.pop();
      while (u.dmgSites.length < want) {
        const used = new Set(u.dmgSites.map((s) => s.poi));
        const pool = Array.from({ length: pois.length }, (_, i) => i).filter((i) => !used.has(i));
        if (!pool.length) break;
        const poi = pool[(Math.random() * pool.length) | 0]!;
        u.dmgSites.push({ poi, scale: range(0.38, 0.75) });
      }
      if (!want) continue;
      const zBias = u.pinId != null ? ZOff.posted : 0;
      const { fire, smoke } = this.pairFx(u.z, this.flame, this.hurtSmoke, ZOff.dmg + zBias, ZOff.smoke + zBias);
      const sp = specOf(u.kind);
      const sizeMul = sp.aerial ? 1.65 : sp.building ? 1.15 : 1;
      for (const s of u.dmgSites) {
        const base = pois[s.poi] ?? pois[0]!;
        const p = jitterDisk(base.x, base.y, 8 + s.scale * 7);
        this.dmgFlameScale = s.scale * sizeMul;
        if (Math.random() < 0.7) fire.emitParticleAt(p.x, p.y, 2);
        if (Math.random() < 0.38) smoke.emitParticleAt(p.x, p.y + 8, 1);
      }
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

function hitSparkFx(dmg: number): { n: number; spd: number; size: number } {
  const t = Phaser.Math.Clamp(Math.pow(Math.max(0.35, dmg) / 8, 0.32), 0.28, 1.5);
  return {
    n: t,
    spd: 0.86 + 0.1 * t,
    size: Phaser.Math.Clamp(0.4 + 0.58 * t, 0.4, 1.26),
  };
}

function sparkTexKey(kind: SparkKind): string {
  return `fx_${kind}`;
}

function pickSparkKind(style: "muzzle" | "ground" | "water" | "object", sparkFrac = 0.18): SparkKind {
  if (style === "water") return "splash";
  if (style === "muzzle") return "flame";
  if (style === "object") return "spark";
  return Math.random() < sparkFrac ? "spark" : "dirt";
}

function troopMissileTrail(s: Shot): boolean {
  return s.from === "enemy" && (s.scale ?? 1) < 0.7;
}

function shotTrailScale(s: Shot): number {
  const vis = s.scale ?? 1;
  const small = troopMissileTrail(s);
  if (s.kind === "rocket") return small ? vis * 0.34 : vis * 0.32;
  if (s.kind === "tow") return vis * 0.52;
  if (s.kind === "hellfire") return small ? vis * 0.4 : vis * 0.55;
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

function sparkLook(kind: SparkKind, biome: Biome, blood = false): { tint: number; add: boolean } {
  if (blood) {
    const pal = [0xee2828, 0xdd2020, 0xe83838, 0xcc1a1a, 0xf04040];
    return { tint: pal[(Math.random() * pal.length) | 0]!, add: false };
  }
  if (kind === "flame") {
    return { tint: Math.random() < 0.4 ? 0xfff4b0 : Math.random() < 0.5 ? 0xffb040 : 0xff7a28, add: true };
  }
  if (kind === "spark") {
    return { tint: Math.random() < 0.5 ? 0xffee66 : 0xfff3b0, add: true };
  }
  if (kind === "splash") {
    return { tint: Math.random() < 0.4 ? 0xffffff : 0x6ec4ff, add: Math.random() < 0.55 };
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
