import Phaser from "phaser";
import { bakeAll } from "./bake";
import {
  fragKeys,
  heightOf,
  hulkOf,
  nextId,
  radius,
  stats,
  textureOf,
  WPN_LIST,
  type Frag,
  type Shot,
  type Spark,
  type SparkKind,
  type Unit,
  type Wpn,
} from "./combat";
import { Layer, ZOff, Z_GRAVITY, worldDepth } from "./depth";
import { CRUISE_Z, HELI_HEIGHT, Heli, LOW_Z, MAX_Z } from "./heli";
import { SpriteConfigTool } from "./spriteConfig";
import { preloadArt, prepareArt, extractBiomeTiles, gunLayout, rotorLayout, shadowAlpha, shadowKey, shadowOff, spriteUvPos, tankLayout, FX_VARIANTS } from "./sprites";
import {
  generateWorld,
  groundSlope,
  groundZ,
  screenLift,
  zScale,
  castZ,
  isWater,
  paintHeightMap,
  sampleBiome,
  applyTerrainLight,
  SCALE,
  WORLD,
  WRECK_TEX,
  type HvSpec,
  type WorldData,
  type Biome,
} from "./world";

const MISSILE_IGNITE = 0.525;
const HELLFIRE_LOCK_T = 0.5;
const HELLFIRE_SEEK_DELAY = 0.42;

const DMG_FLAME_UV: { u: number; v: number }[] = [
  { u: 0.282, v: 0.434 },
  { u: 0.616, v: 0.868 },
  { u: 0.441, v: 0.715 },
  { u: 0.547, v: 0.496 },
  { u: 0.362, v: 0.580 },
  { u: 0.764, v: 0.479 },
  { u: 0.669, v: 0.288 },
  { u: 0.93, v: 0.417 },
];

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
    this.add
      .text(w / 2, h * 0.28, "HELISTRIKE", {
        fontFamily: "Black Ops One, Impact, sans-serif",
        fontSize: "72px",
        color: "#e8b84a",
      })
      .setOrigin(0.5);
    this.add
      .text(w / 2, h * 0.4, "TOP-DOWN GUNSHIP  ·  GULF THEATER", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "16px",
        color: "#8a8470",
      })
      .setOrigin(0.5);
    this.add
      .text(
        w / 2,
        h * 0.56,
        "WASD / ARROWS  thrust & strafe\nMOUSE  turn  ·  CLICK  fire  ·  1-4 / WHEEL  weapons\nSPACE  pop-up  ·  SHIFT  nap-of-earth  ·  M  map  ·  K  heightmap\n+ / -  time scale",
        {
          fontFamily: "Share Tech Mono, monospace",
          fontSize: "15px",
          color: "#c8c0a8",
          align: "center",
          lineSpacing: 8,
        }
      )
      .setOrigin(0.5);
    const go = this.add
      .text(w / 2, h * 0.78, "[  START MISSION  ]", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "22px",
        color: "#1c1812",
        backgroundColor: "#e8b84a",
        padding: { x: 18, y: 10 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    go.on("pointerdown", () => this.scene.start("load"));
    this.input.keyboard?.once("keydown-ENTER", () => this.scene.start("load"));
    this.input.keyboard?.once("keydown-SPACE", () => this.scene.start("load"));
  }
}

export class LoadScene extends Phaser.Scene {
  constructor() {
    super("load");
  }
  create(): void {
    const { width: w, height: h } = this.scale;
    this.cameras.main.setBackgroundColor("#1c1812");
    this.add
      .text(w / 2, h * 0.46, "SURVEYING THEATER", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "18px",
        color: "#e8b84a",
      })
      .setOrigin(0.5);
    this.add
      .text(w / 2, h * 0.54, "procedural relief  ·  river carve  ·  force laydown", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "13px",
        color: "#8a8470",
      })
      .setOrigin(0.5);
    this.time.delayedCall(40, () => {
      const seed = (Date.now() ^ (Math.random() * 1e9)) >>> 0;
      const world = generateWorld(seed, extractBiomeTiles(this.textures));
      this.scene.start("mission", { world });
    });
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
  cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
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
  lockTxt!: Phaser.GameObjects.Text;
  lockArrowGfx!: Phaser.GameObjects.Graphics;
  lockHudTxt!: Phaser.GameObjects.Text;
  unitG!: Phaser.GameObjects.Group;
  shotG!: Phaser.GameObjects.Group;
  fragG!: Phaser.GameObjects.Group;
  sparkG!: Phaser.GameObjects.Group;
  smoke!: Phaser.GameObjects.Particles.ParticleEmitter;
  tracer!: Phaser.GameObjects.Particles.ParticleEmitter;
  flame!: Phaser.GameObjects.Particles.ParticleEmitter;
  hurtSmoke!: Phaser.GameObjects.Particles.ParticleEmitter;
  burn!: Phaser.GameObjects.Particles.ParticleEmitter;
  blastBurn!: Phaser.GameObjects.Particles.ParticleEmitter;
  blastFire!: Phaser.GameObjects.Particles.ParticleEmitter;
  ember!: Phaser.GameObjects.Particles.ParticleEmitter;
  fragSmoke!: Phaser.GameObjects.Particles.ParticleEmitter;
  lingerSmoke!: Phaser.GameObjects.Particles.ParticleEmitter;
  heliDust!: Phaser.GameObjects.Particles.ParticleEmitter;
  muzzle!: Phaser.GameObjects.Image;
  muzzleLife = 0;
  dmgFlameScale = 1;
  hud!: Phaser.GameObjects.Text;
  hvHud!: Phaser.GameObjects.Text;
  wpnHud!: Phaser.GameObjects.Text;
  wpnBar!: Phaser.GameObjects.Graphics;
  wpnSlots!: Phaser.GameObjects.Text[];
  hpGfx!: Phaser.GameObjects.Graphics;
  playerHud!: Phaser.GameObjects.Graphics;
  mapLabel!: Phaser.GameObjects.Text;
  mapHvLabels: Phaser.GameObjects.Text[] = [];
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
  camZoom = 2.55;
  camFollow = true;
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
    this.camFollow = true;
    this.playLastFrame = false;
    this.debugHit = false;
    this.showHeightMap = false;
    this.shots = [];
    this.frags = [];
    this.sparks = [];
    this.ammo = WPN_LIST.map((w) => w.ammo);
    if (!data.world) {
      this.world = generateWorld((Date.now() ^ (Math.random() * 1e9)) >>> 0, extractBiomeTiles(this.textures));
    } else this.world = data.world;
  }

  create(): void {
    this.stampDecor();
    if (this.textures.exists("terrain")) this.textures.remove("terrain");
    this.textures.addCanvas("terrain", this.world.canvas);
    if (this.textures.exists("heightmap")) this.textures.remove("heightmap");
    this.textures.addCanvas("heightmap", paintHeightMap(this.world.height));
    this.input.setDefaultCursor("none");
    this.canFire = !this.input.activePointer.isDown;
    this.input.on("pointerup", () => {
      this.canFire = true;
    });

    this.physics.world.setBounds(0, 0, WORLD, WORLD);
    this.cameras.main.setBounds(0, 0, WORLD, WORLD);
    this.cameras.main.setBackgroundColor("#2a2418");

    this.ground = this.add.image(WORLD / 2, WORLD / 2, "terrain");
    this.ground.setDisplaySize(WORLD, WORLD).setDepth(Layer.TERRAIN);
    this.wreckLayer = this.add.renderTexture(0, 0, WRECK_TEX, WRECK_TEX);
    this.wreckLayer.setOrigin(0, 0).setPosition(0, 0);
    this.wreckLayer.setDisplaySize(WORLD, WORLD).setDepth(Layer.WRECK);
    this.wreckLayer.clear();
    this.stampBrush = this.make.image({ key: "blast_0" }, false);

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
      .image(0, 0, "muzzle")
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

    this.units = [];
    for (const s of this.world.spawns) {
      const st = stats(s.kind);
      this.units.push({
        id: nextId(),
        kind: s.kind,
        x: s.x,
        y: s.y,
        z: s.kind === "heli" ? groundZ(this.world, s.x, s.y) + CRUISE_Z : groundZ(this.world, s.x, s.y),
        vx: 0,
        vy: 0,
        angle: Math.random() * Math.PI * 2,
        turret: Math.random() * Math.PI * 2,
        health: st.health,
        max: st.health,
        hv: s.hv,
        dead: false,
        fireCd: Math.random(),
        rotor: 0,
        track: 0,
      });
    }

    const fxFrames = { frames: [0, 1, 2, 3], cycle: false as const };
    const fxSpin = { min: -80, max: 80 };
    this.smoke = this.add.particles(0, 0, "smoke", {
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
    this.tracer = this.add.particles(0, 0, "spark", {
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
    this.flame = this.add.particles(0, 0, "flame", {
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
    });
    this.flame.setDepth(Layer.WORLD);
    this.hurtSmoke = this.add.particles(0, 0, "smoke", {
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
    });
    this.hurtSmoke.setDepth(Layer.WORLD);
    const burnSize = (p?: Phaser.GameObjects.Particles.Particle): number => {
      if (!p) return 0.5;
      const q = p as Phaser.GameObjects.Particles.Particle & { s0?: number };
      if (q.s0 == null) q.s0 = Math.pow(Math.random(), 0.65);
      return q.s0;
    };
    this.burn = this.add.particles(0, 0, "flame", {
      lifespan: { min: 240, max: 420 },
      speed: { min: 2, max: 14 },
      scale: {
        onEmit: (p) => 0.7 + burnSize(p) * 0.7,
        onUpdate: (p, _k, t) => (0.7 + burnSize(p) * 0.7) * (1 - t * 0.9),
      },
      alpha: { start: 1, end: 0 },
      blendMode: "ADD",
      tint: [0xfff4c0, 0xff9a32, 0xff5a18],
      gravityY: -78,
      emitting: false,
      frame: fxFrames,
      rotate: fxSpin,
    });
    this.burn.setDepth(Layer.WORLD);
    this.blastBurn = this.add.particles(0, 0, "flame", {
      lifespan: { min: 240, max: 420 },
      speed: { min: 2, max: 14 },
      scale: {
        onEmit: (p) => 0.28 + burnSize(p) * 0.28,
        onUpdate: (p, _k, t) => (0.28 + burnSize(p) * 0.28) * (1 - t * 0.9),
      },
      alpha: { start: 1, end: 0 },
      blendMode: "ADD",
      tint: [0xfff4c0, 0xff9a32, 0xff5a18],
      gravityY: -78,
      emitting: false,
      frame: fxFrames,
      rotate: fxSpin,
    });
    this.blastBurn.setDepth(Layer.WORLD);
    this.blastFire = this.add.particles(0, 0, "flame", {
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
    this.ember = this.add.particles(0, 0, "flame", {
      lifespan: { min: 180, max: 320 },
      speed: { min: 1, max: 10 },
      scale: {
        onEmit: (p) => 0.12 + burnSize(p) * 0.12,
        onUpdate: (p, _k, t) => (0.12 + burnSize(p) * 0.12) * (1 - t * 0.9),
      },
      alpha: { start: 0.9, end: 0 },
      blendMode: "ADD",
      tint: [0xfff4c0, 0xff9a32, 0xff5a18],
      gravityY: -70,
      emitting: false,
      frame: fxFrames,
      rotate: fxSpin,
    });
    this.ember.setDepth(Layer.WORLD);
    this.fragSmoke = this.add.particles(0, 0, "smoke", {
      lifespan: 520,
      speed: { min: 8, max: 36 },
      scale: { start: 0.35, end: 1.4 },
      alpha: { start: 0.5, end: 0 },
      gravityY: -30,
      emitting: false,
      frame: fxFrames,
      rotate: fxSpin,
    });
    this.fragSmoke.setDepth(Layer.WORLD);
    this.lingerSmoke = this.add.particles(0, 0, "smoke", {
      lifespan: { min: 2200, max: 4000 },
      speed: { min: 4, max: 18 },
      angle: { min: -128, max: -52 },
      scale: { start: 0.28, end: 0.95 },
      alpha: { start: 0.42, end: 0 },
      gravityY: -6,
      accelerationX: { onEmit: () => (Math.random() - 0.5) * 18 },
      accelerationY: { onEmit: () => -5 + (Math.random() - 0.5) * 12 },
      emitting: false,
      frame: fxFrames,
      rotate: { min: -80, max: 80 },
    });
    this.lingerSmoke.setDepth(Layer.WORLD);
    this.heliDust = this.add.particles(0, 0, "smoke", {
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

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.keyW = this.input.keyboard!.addKey("W");
    this.keyA = this.input.keyboard!.addKey("A");
    this.keyS = this.input.keyboard!.addKey("S");
    this.keyD = this.input.keyboard!.addKey("D");
    this.keySpace = this.input.keyboard!.addKey("SPACE");
    this.keyShift = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
    this.input.keyboard!.addKey("ONE").on("down", () => (this.heli.weapon = 0));
    this.input.keyboard!.addKey("TWO").on("down", () => (this.heli.weapon = 1));
    this.input.keyboard!.addKey("THREE").on("down", () => (this.heli.weapon = 2));
    this.input.keyboard!.addKey("FOUR").on("down", () => (this.heli.weapon = 3));
    this.input.keyboard!.addKey("M").on("down", () => this.toggleMap());
    this.input.keyboard!.addKey("K").on("down", () => {
      this.showHeightMap = !this.showHeightMap;
      this.debugHit = this.showHeightMap;
      this.debugGfx.setVisible(this.debugHit);
      if (!this.debugHit) this.debugGfx.clear();
      const key = this.showHeightMap ? "heightmap" : "terrain";
      this.ground.setTexture(key).setDisplaySize(WORLD, WORLD);
      this.miniTerrain.setTexture(key);
      this.wreckLayer.setVisible(!this.showHeightMap);
      this.miniWrecks.setVisible(!this.showHeightMap && this.miniTerrain.visible);
    });
    this.input.keyboard!.addKey("R").on("down", () => {
      if (this.over) this.scene.start("load");
    });
    const bumpTime = (dir: number) => this.nudgeTimeScale(dir);
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.PLUS).on("down", () => bumpTime(1));
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.EQUALS).on("down", () => bumpTime(1));
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.NUMPAD_ADD).on("down", () => bumpTime(1));
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.MINUS).on("down", () => bumpTime(-1));
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.NUMPAD_SUBTRACT).on("down", () => bumpTime(-1));
    this.spriteCfg = new SpriteConfigTool(this, (key) => this.spriteOrigin(key));
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.F9).on("down", () => this.spriteCfg.toggle());
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.BACKTICK).on("down", () => this.spriteCfg.toggle());
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.OPEN_BRACKET).on("down", () => this.spriteCfg.cycle(-1));
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.CLOSED_BRACKET).on("down", () => this.spriteCfg.cycle(1));
    this.input.on("wheel", (_p: Phaser.Input.Pointer, _dx: number, dy: number) => {
      if (this.spriteCfg?.open) {
        this.spriteCfg.cycle(dy > 0 ? 1 : -1);
        return;
      }
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
    this.playerHud = this.add.graphics().setScrollFactor(0).setDepth(Layer.HUD + 10);
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
    this.mapGfx = this.add.graphics().setDepth(Layer.FIELD);
    this.mapHvLabels = [];
    this.debugGfx = this.add.graphics().setDepth(Layer.FIELD).setVisible(false);
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
    this.cameras.main.startFollow(this.body, true, 0.12, 0.12);
    this.cameras.main.setDeadzone(80, 80);
    this.cameras.main.setZoom(this.playZoom());
    this.camZoom = this.playZoom();
    this.playScrollX = this.heli.x - this.scale.width / 2;
    this.playScrollY = this.heli.y - this.scale.height / 2;
    this.playViewX = this.playScrollX;
    this.playViewY = this.playScrollY;
    this.playViewW = this.scale.width;
    this.playViewH = this.scale.height;
    this.playLastFrame = true;
    this.setupHudCam();
  }

  stampDecor(): void {
    const g = this.world.canvas.getContext("2d")!;
    g.imageSmoothingEnabled = true;
    for (const d of this.world.decor) {
      if (!this.textures.exists(d.kind)) continue;
      const img = this.textures.get(d.kind).getSourceImage() as CanvasImageSource;
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
    frame?: string | number
  ): void {
    if (!this.textures.exists(key)) return;
    const k = WRECK_TEX / WORLD;
    const sy = (scaleY ?? scale) * k;
    if (frame != null) this.stampBrush.setTexture(key, frame);
    else this.stampBrush.setTexture(key);
    this.stampBrush
      .setOrigin(ox, oy)
      .setRotation(rotation)
      .setAlpha(alpha)
      .setScale(scale * k, sy)
      .setPosition(x * k, y * k);
    this.wreckLayer.draw(this.stampBrush);
  }

  stampLightBlast(x: number, y: number, vx: number, vy: number): void {
    if (isWater(this.world, x, y)) return;
    const key = `blast_${(Math.random() * 4) | 0}`;
    if (!this.textures.exists(key) && !this.textures.exists("blast_0")) return;
    const spd = Math.hypot(vx, vy);
    const ang = spd > 10 ? Math.atan2(vy, vx) : Math.random() * Math.PI * 2;
    const sc = 0.065 + Math.random() * 0.08;
    const stretch = 1 + Math.min(0.7, spd * 0.0024);
    this.stampWreck(
      this.textures.exists(key) ? key : "blast_0",
      x + (Math.random() - 0.5) * 5,
      y + (Math.random() - 0.5) * 5,
      ang + (Math.random() - 0.5) * 0.5,
      sc * stretch,
      0.28 + Math.random() * 0.22,
      0.5,
      0.5,
      sc * (0.72 + Math.random() * 0.22)
    );
  }

  stampDirtSmears(x: number, y: number, vx: number, vy: number): void {
    if (isWater(this.world, x, y) || !this.textures.exists("dirt")) return;
    const n = 3 + ((Math.random() * 3) | 0);
    const spd = Math.hypot(vx, vy);
    const ang = spd > 12 ? Math.atan2(vy, vx) : Math.random() * Math.PI * 2;
    const ux = Math.cos(ang);
    const uy = Math.sin(ang);
    const px = -uy;
    const py = ux;
    for (let i = 0; i < n; i++) {
      const along = (Math.random() - 0.22) * (16 + Math.min(28, spd * 0.07));
      const side = (Math.random() - 0.5) * 12;
      const frame = (Math.random() * FX_VARIANTS) | 0;
      const sc = 0.38 + Math.random() * 0.42;
      const stretch = 0.75 + Math.random() * 0.9 + Math.min(0.5, spd * 0.0018);
      const thin = 0.2 + Math.random() * 0.18;
      this.stampWreck(
        "dirt",
        x + ux * along + px * side,
        y + uy * along + py * side,
        ang + (Math.random() - 0.5) * 0.38,
        sc * stretch,
        0.36 + Math.random() * 0.34,
        0.12,
        0.5,
        sc * thin,
        frame
      );
    }
  }

  fragStampOrigin(key: string): { x: number; y: number } {
    const turret = key.includes("turret");
    if (!turret) return { x: 0.5, y: 0.5 };
    if (key.includes("hulk")) return { ...tankLayout.hulkTurretOrigin };
    return { ...tankLayout.turretOrigin };
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
          up: this.cursors.up!.isDown || this.keyW.isDown,
          down: this.cursors.down!.isDown || this.keyS.isDown,
          left: this.cursors.left!.isDown || this.keyA.isDown,
          right: this.cursors.right!.isDown || this.keyD.isDown,
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
      this.updateFrags(dt);
      this.updateSparks(dt);
      this.updateLock();
      this.drawUnitBars();
      this.emitDamageFx();
      this.drawDebugHits();
    }

    const mapOn = this.mapBlend > 0.12;
    this.syncHudParallax(wallDt);
    this.setHudVisible(!mapOn);
    if (mapOn) {
      this.drawMapOverlay();
    } else {
      this.mapGfx.clear();
      this.hideMapHvLabels();
      this.drawHud();
      this.drawMinimap();
      this.drawHvArrows();
      this.drawPlayerHud();
    }

    if (this.shake > 0 && this.mapBlend < 0.12) {
      this.cameras.main.shake(80, this.shake * 0.002);
      this.shake *= 0.85;
    }

    const hvLeft = this.world.hv.filter((h) =>
      this.units.some((u) => u.hv === h.id && !u.dead)
    );
    if (hvLeft.length === 0) this.end(true);
    if (this.heli.phase === "dead") this.end(false);
  }

  spriteOrigin(key: string): { x: number; y: number } {
    if (key === "heli_body") return { x: this.body.originX, y: this.body.originY };
    if (key === "heli_rotor") return { x: this.rotor.originX, y: this.rotor.originY };
    if (key === "heli_gun") return { x: this.gun.originX, y: this.gun.originY };
    if (key === "enemy_heli") return { ...rotorLayout.enemy };
    if (key === "tank_turret") return { ...tankLayout.turretOrigin };
    if (key === "tank_hull") return { x: 0.5, y: 0.5 };
    if (key === "hulk_tank_turret") return { ...tankLayout.hulkTurretOrigin };
    return { x: 0.5, y: 0.5 };
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
    this.applyCastShadow(this.shadow, h.x, h.y, h.z, "heli_body", h.angle + Math.PI / 2);
    this.shadow.setOrigin(rotorLayout.player.x, rotorLayout.player.y);
    const lift = screenLift(h.z);
    const zs = zScale(h.z);
    this.body.setOrigin(rotorLayout.player.x, rotorLayout.player.y);
    this.body.setPosition(h.x, h.y - lift);
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
    this.rotor.setScale((124 / this.rotor.width) * 1.08 * zs);
    this.gun.setScale(zs);
    this.rotor.setAlpha(h.rotorSpd > 24 ? 0.72 : 1);
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
    const takeoff = h.phase === "spool" || h.phase === "liftoff";
    const low = h.phase === "flight" && agl < 26;
    if (!takeoff && !low) return;
    const power = takeoff
      ? Phaser.Math.Clamp(h.rotorSpd / 26, 0.2, 1)
      : Phaser.Math.Clamp(1 - agl / 26, 0, 1) * 0.72;
    if (power < 0.08) return;
    const rate = Phaser.Math.Clamp(dt, 0, 0.05) * 60;
    const gnd = groundZ(this.world, h.x, h.y);
    const wet = isWater(this.world, h.x, h.y);
    const sy = h.y - screenLift(gnd);
    this.heliDust.setDepth(worldDepth(gnd, 0.2));
    const puffs = Math.max(1, Math.round((takeoff ? 2 + power * 3 : 0.6 + power * 1.4) * rate));
    for (let i = 0; i < puffs; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 16 + Math.random() * (40 + power * 36);
      this.heliDust.setEmitterAngle(Phaser.Math.RadToDeg(a) + (Math.random() - 0.5) * 28);
      this.heliDust.emitParticleAt(h.x + Math.cos(a) * r, sy + Math.sin(a) * r * 0.55, 1);
    }
    if (wet) return;
    const n = Math.max(1, Math.round((takeoff ? 4 + power * 6 : 1 + power * 3) * rate));
    const extra = this.sparks.length + n - 360;
    if (extra > 0) this.sparks.splice(0, extra);
    const biome = sampleBiome(this.world, h.x, h.y);
    const spinSign = h.rotorSpd >= 0 ? 1 : -1;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const r0 = 8 + Math.random() * 18;
      const spd = (420 + Math.random() * 380) * (0.55 + power * 0.7);
      const life = 0.48 + Math.random() * 0.38;
      const look = sparkLook("dirt", biome);
      this.sparks.push({
        x: h.x + ca * r0,
        y: h.y + sa * r0,
        z: gnd + 2 + Math.random() * 6,
        vx: ca * spd,
        vy: sa * spd,
        vz: 8 + Math.random() * 28,
        life,
        max: life,
        scale: 0.62 + Math.random() * 0.38,
        bounces: 0,
        kind: "dirt",
        tex: sparkTexKey("dirt"),
        frame: (Math.random() * FX_VARIANTS) | 0,
        angJit: (Math.random() - 0.5) * 0.12,
        spin: spinSign * (0.8 + Math.random() * 1.8),
        tint: look.tint,
        additive: look.add,
        heading: a,
        dart: true,
        ox: h.x,
        oy: h.y,
        swirl: spinSign * (120 + Math.random() * 180),
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
    let bx: number;
    let by: number;
    let ox: number;
    let oy: number;
    if (!missile) {
      const dist = Math.hypot(aim.x - h.x, aim.y - h.y);
      bx = h.x + Math.cos(h.gunAngle) * dist;
      by = h.y + Math.sin(h.gunAngle) * dist;
      const tip = this.gunTip();
      ox = tip.x;
      oy = tip.y;
    } else {
      const pylon = this.missilePylon();
      const along = Math.max(80, projectAlong(pylon.x, pylon.y, h.angle, aim.x, aim.y));
      bx = pylon.x + Math.cos(h.angle) * along;
      by = pylon.y + Math.sin(h.angle) * along;
      ox = pylon.x;
      oy = pylon.y - screenLift(h.z);
    }
    const from = this.worldToHud(ox, oy);
    const to = this.worldToHud(bx, by);
    this.drawSightLine(from.x, from.y, to.x, to.y, missile ? "missile" : "cannon");
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
    if (h.phase !== "flight" || !this.canFire) return;
    const wpn = WPN_LIST[h.weapon]!.id;
    const ptr = this.worldPointer();
    const down = this.input.activePointer.isDown;

    if (wpn === "cannon" && down && h.fireCd <= 0) {
      h.fireCd = 0.07;
      const spread = (Math.random() - 0.5) * 0.08;
      const air = this.hoverAerial(ptr.x, ptr.y);
      const ang = h.gunAngle + spread;
      const spd = 780;
      let tx: number;
      let ty: number;
      let tz: number;
      if (air) {
        tx = air.x + (Math.random() - 0.5) * 10;
        ty = air.y + (Math.random() - 0.5) * 10;
        tz = air.z + heightOf(air.kind) * 0.5;
      } else {
        tx = ptr.x + (Math.random() - 0.5) * 18;
        ty = ptr.y + (Math.random() - 0.5) * 18;
        tz = groundZ(this.world, tx, ty);
      }
      const tip = this.gunTip();
      const tipY = tip.y + screenLift(h.z);
      const z0 = h.z + ZOff.shot;
      const dist = Math.hypot(tx - tip.x, ty - tipY);
      const t = Math.max(0.08, dist / spd);
      this.spawnShot({
        kind: "cannon",
        from: "player",
        x: tip.x,
        y: tipY,
        z: z0,
        vx: (tx - tip.x) / t,
        vy: (ty - tipY) / t,
        vz: (tz - z0) / t,
        angle: ang,
        life: t + (air ? 0.55 : 0.08),
        blast: 18,
        dmg: 14,
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

    if (wpn === "rocket" && down && h.fireCd <= 0 && this.ammo[1]! > 0) {
      h.fireCd = 0.22;
      const { x: px, y: py } = this.missilePylon();
      this.ammo[1]!--;
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
        blast: 70,
        dmg: 55,
      });
      this.missileMuzzle(px, py, h.z, h.angle);
    }

    this.tickHellfireLock(dt, ptr);
    if (wpn === "hellfire") {
      if (
        down &&
        h.fireCd <= 0 &&
        this.ammo[2]! > 0 &&
        h.hellfireLock
      ) {
        h.fireCd = 0.55;
        const { x: px, y: py } = this.missilePylon();
        this.ammo[2]!--;
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
          blast: 85,
          dmg: 95,
          motor: -MISSILE_IGNITE,
          yaw: side * (1.05 + Math.random() * 0.45),
        });
        this.missileMuzzle(px, py, h.z, h.angle);
      }
    }

    if (wpn === "tow" && down && h.fireCd <= 0 && this.ammo[3]! > 0) {
      h.fireCd = 1.1;
      const { x: px, y: py } = this.missilePylon();
      this.ammo[3]!--;
      const side = (this.ammo[3] ?? 0) % 2 === 0 ? 1 : -1;
      this.spawnShot({
        kind: "tow",
        from: "player",
        x: px,
        y: py,
        z: h.z + ZOff.shot,
        vx: h.vx + Math.cos(h.angle) * 380,
        vy: h.vy + Math.sin(h.angle) * 380,
        vz: h.vz,
        angle: h.angle,
        life: 5.2,
        blast: 80,
        dmg: 88,
        guided: true,
        motor: -MISSILE_IGNITE,
        cruise: 300,
        yaw: side * (0.42 + Math.random() * 0.22),
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
    this.muzzle
      .setVisible(true)
      .setFrame((Math.random() * FX_VARIANTS) | 0)
      .setOrigin(0.14, 0.5)
      .setPosition(x, y)
      .setRotation(ang)
      .setScale(scale)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(0xfff6d0)
      .setAlpha(1)
      .setDepth(worldDepth(this.heli.z, ZOff.muzzle));
    this.muzzleLife = life;
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
    }
  ): void {
    const extra = this.sparks.length + opt.n - 280;
    if (extra > 0) this.sparks.splice(0, extra);
    const biome = sampleBiome(this.world, x, y);
    for (let i = 0; i < opt.n; i++) {
      const kind = opt.forceKind ?? pickSparkKind(opt.style, opt.sparkFrac);
      const reverse = opt.style === "object" && Math.random() < 0.5;
      const d = biasedDir(opt.bx, opt.by, opt.bz, opt.tight, reverse);
      const spd =
        (opt.spdMin + Math.random() * (opt.spdMax - opt.spdMin)) *
        (kind === "dirt" && opt.style === "ground" ? 1.25 : 1);
      const life =
        kind === "dirt"
          ? 0.45 + Math.random() * 0.35
          : kind === "spark"
            ? 0.42 + Math.random() * 0.32
            : kind === "splash"
              ? 0.32 + Math.random() * 0.28
              : 0.18 + Math.random() * 0.22;
      const look = sparkLook(kind, biome, opt.blood);
      const vx = d.x * spd;
      const vy = d.y * spd;
      const vz = d.z * spd + (kind === "dirt" || kind === "splash" ? 50 : 20);
      const sizeMul =
        (opt.scaleMul ?? (opt.style === "muzzle" ? 0.3 : 1)) *
        (kind === "spark" && opt.style === "ground" ? 0.42 : 1);
      this.sparks.push({
        x,
        y,
        z: z + 1 + Math.random() * 4,
        vx,
        vy,
        vz,
        life,
        max: life,
        scale:
          (kind === "dirt" ? 0.52 + Math.random() * 0.28 : kind === "spark" ? 0.65 + Math.random() * 0.5 : 0.45 + Math.random() * 0.55) *
          sizeMul,
        bounces: kind === "flame" ? 1 : kind === "splash" ? 2 : 2 + ((Math.random() * 3) | 0),
        kind,
        tex: sparkTexKey(kind),
        frame: (Math.random() * FX_VARIANTS) | 0,
        angJit: (Math.random() - 0.5) * (kind === "dirt" ? 0.35 : kind === "spark" ? 0.18 : 0.85),
        spin: (Math.random() - 0.5) * (kind === "dirt" ? 2.4 : 6),
        tint: look.tint,
        additive: look.add,
        heading: Math.atan2(vy - screenLift(vz), vx),
        streak: opt.style === "muzzle",
        blood: opt.blood,
      });
    }
  }

  updateSparks(dt: number): void {
    const live: Spark[] = [];
    const drag = Math.pow(0.045, dt);
    const sparkDrag = Math.pow(0.5, dt);
    const zDrag = Math.pow(0.18, dt);
    for (const s of this.sparks) {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.z += s.vz * dt;
      if (s.kind === "dirt" || s.kind === "spark") s.vz -= Z_GRAVITY * dt;
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
      if (s.kind === "flame") {
        s.vy -= 90 * dt;
        s.vz += 170 * dt;
      }
      s.life -= dt;
      const g = groundZ(this.world, s.x, s.y);
      if (s.z < g) {
        s.z = g;
        if (s.dart) {
          s.vz = Math.max(2, -s.vz * 0.12);
        } else if (s.bounces > 0 && s.vz < -30) {
          s.bounces--;
          s.vz = -s.vz * (s.kind === "dirt" ? 0.18 : 0.38);
          const spd = Math.hypot(s.vx, s.vy);
          s.vx = (s.vx + (Math.random() - 0.5) * spd * 0.5) * 0.55;
          s.vy = (s.vy + (Math.random() - 0.5) * spd * 0.5) * 0.55;
        } else {
          s.vz = 0;
          s.vx *= 0.35;
          s.vy *= 0.35;
          s.life = Math.min(s.life, 0.06);
        }
      }
      if (s.life > 0) live.push(s);
    }
    this.sparks = live;
    this.syncSparkSprites();
  }

  syncSparkSprites(): void {
    while (this.sparkG.getLength() < this.sparks.length) {
      this.sparkG.add(this.add.image(0, 0, "spark").setScale(0.7));
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
      const grow = 1 - Math.pow(1 - age, 3.4);
      const edge =
        dart && s.ox != null && s.oy != null
          ? Phaser.Math.Clamp((Math.hypot(s.x - s.ox, s.y - s.oy) - 40) / 110, 0, 1)
          : 0;
      const round = dart ? Math.max(edge, Phaser.Math.Clamp(1 - spd / 220, 0, 1)) : 0;
      const stretch = 1 + spd * (spark ? 0.011 : streak ? 0.0064 : dart ? 0.0052 : 0.0048);
      const thick = dart
        ? s.scale * (0.78 + 0.35 * fade + 0.45 * round)
        : dirt
          ? s.scale * (0.06 + 3.6 * grow)
          : s.scale * (spark ? 0.48 + fade * 0.42 : 0.4 + fade * 0.7);
      const scrX = s.vx;
      const scrY = s.vy - screenLift(s.vz);
      const heading = Math.atan2(scrY, scrX);
      const rot = dart
        ? heading + s.angJit * 0.08 + age * s.spin * (0.15 + round * 0.7)
        : dirt
          ? s.heading + s.angJit * 0.14
          : streak
            ? heading + s.angJit * 0.1
            : flame
              ? s.angJit + age * s.spin * 0.35
              : heading + s.angJit + age * s.spin * 0.12;
      const sx = dart
        ? thick * (stretch * 1.28 * (1 - round) + (1.02 + 0.18 * grow) * round)
        : dirt
          ? thick * (0.85 + 0.55 * grow)
          : streak
            ? thick * stretch
            : flame
              ? thick
              : thick * stretch;
      const late = Math.pow(Phaser.Math.Clamp((age - 0.52) / 0.48, 0, 1), 1.7);
      const sy = dart
        ? thick * ((0.58 + 0.16 / Math.max(stretch, 1)) * (1 - round) + (0.95 + 0.12 * grow) * round)
        : dirt
          ? thick * (0.28 + 0.42 * late)
        : streak
          ? thick / Math.pow(stretch, 0.42)
          : spark
            ? (thick * 0.7) / Math.pow(stretch, 0.32)
            : flame
              ? thick
              : thick / Math.sqrt(stretch);
      const baseA = s.additive ? 0.45 + fade * 0.55 : 0.55 + fade * 0.4;
      const spdFade = Phaser.Math.Clamp(spd / 280, 0, 1);
      const alpha = dart
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
        .setBlendMode(s.additive ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL)
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
    const ceil = groundZ(this.world, s.x, s.y) + MAX_Z + 28;
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
        const drag = Math.pow(0.07, dt);
        s.vx *= drag;
        s.vy *= drag;
        s.vz *= Math.pow(0.22, dt);
        if (s.yaw) s.angle += s.yaw * dt;
        const spd = Math.hypot(s.vx, s.vy);
        if (spd > 6) {
          s.vx = Math.cos(s.angle) * spd;
          s.vy = Math.sin(s.angle) * spd;
        }
      } else if (hellfireHome) {
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
        const zCeil = groundZ(this.world, s.x, s.y) + MAX_Z + 70;
        if (s.z > zCeil) {
          s.z = zCeil;
          if (s.vz > 0) s.vz = 0;
        }
      }
      s.life -= dt;
      const g1 = groundZ(this.world, s.x, s.y);
      const a0 = z0 - g0;
      const a1 = s.z - g1;
      let hit = s.from !== "enemy" && s.life <= 0;
      if (a0 > 0.05 && a1 <= 0) {
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
        this.heli.damage(s.dmg * 0.65);
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
    if (s.kind === "hellfire") {
      const pitch = 0.92;
      const spd = Math.max(Math.hypot(s.vx, s.vy), 90);
      s.vx = Math.cos(s.angle) * spd * Math.cos(pitch);
      s.vy = Math.sin(s.angle) * spd * Math.cos(pitch);
      s.vz = spd * Math.sin(pitch);
      s.loft = HELLFIRE_SEEK_DELAY;
    } else {
      s.vz += 300;
    }
    const sy = s.y - screenLift(s.z);
    this.burn.setDepth(worldDepth(s.z, 0.5));
    this.fragSmoke.setDepth(worldDepth(s.z, 0.12));
    this.blastFire.setDepth(worldDepth(s.z, 0.4));
    this.burn.emitParticleAt(s.x, sy, 8);
    this.fragSmoke.emitParticleAt(s.x, sy + 8, 6);
    this.blastFire.explode(4, s.x, sy);
    this.spawnSparks(s.x, s.y, s.z, {
      style: "muzzle",
      n: 10,
      spdMin: 80,
      spdMax: 240,
      bx: -Math.cos(s.angle),
      by: -Math.sin(s.angle),
      bz: 0.1,
      tight: 0.55,
    });
  }

  emitShotTrail(s: Shot, x0: number, y0: number, z0: number): void {
    if (s.kind === "cannon") return;
    const missile = s.kind === "hellfire" || s.kind === "tow";
    if (missile && (s.motor == null || s.motor < 0)) return;
    const steps = missile ? 2 : 1;
    for (let i = 0; i < steps; i++) {
      const t = (i + Math.random() * 0.35) / steps;
      const x = x0 + (s.x - x0) * t;
      const y = y0 + (s.y - y0) * t;
      const z = z0 + (s.z - z0) * t;
      const sy = y - screenLift(z);
      const back = 6 + Math.random() * 5;
      const tx = x - Math.cos(s.angle) * back;
      const ty = sy - Math.sin(s.angle) * back;
      if (missile) {
        this.burn.setDepth(worldDepth(z, 0.45));
        this.lingerSmoke.setDepth(worldDepth(z, 0.12));
        if (Math.random() < 0.72) this.burn.emitParticleAt(tx, ty, 1);
        if (Math.random() < 0.58) this.lingerSmoke.emitParticleAt(tx, ty + 7, 1);
      } else if (Math.random() < 0.38) {
        this.fragSmoke.setDepth(worldDepth(z, 0.1));
        this.fragSmoke.emitParticleAt(tx, ty + 5, 1);
      }
    }
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
    if (objectHit && direct?.kind === "soldier") {
      const incoming = Math.hypot(dx, dy, dz) || 1;
      const graze = Phaser.Math.Clamp(Math.hypot(dx, dy) / incoming, 0, 1);
      const distN = Phaser.Math.Clamp(Math.hypot(x - this.heli.x, y - this.heli.y) / 780, 0, 1);
      const acute = Math.max(graze, distN);
      this.spawnSparks(x, y, z + 3, {
        style: "ground",
        n: he ? 48 : 22,
        spdMin: he ? Phaser.Math.Linear(50, 160, acute) : Phaser.Math.Linear(36, 200, acute * acute),
        spdMax: he ? Phaser.Math.Linear(220, 420, acute) : Phaser.Math.Linear(200, 520, acute * acute),
        bx: dx,
        by: dy,
        bz: he ? Phaser.Math.Linear(110, 40, acute) : Phaser.Math.Linear(90, 22, acute),
        tight: he ? Phaser.Math.Linear(0.1, 0.38, acute) : Phaser.Math.Linear(0.28, 0.72, acute),
        sparkFrac: 0,
        forceKind: "dirt",
        blood: true,
      });
    } else if (objectHit) {
      this.spawnSparks(x, y, z + 4, {
        style: "object",
        n: he ? 36 : 18,
        spdMin: he ? 110 : 90,
        spdMax: he ? 480 : 340,
        bx: dx,
        by: dy,
        bz: dz,
        tight: he ? 0.28 : 0.52,
      });
    } else if (water) {
      this.spawnSparks(x, y, z + 3, {
        style: "water",
        n: 20,
        spdMin: 50,
        spdMax: 220,
        bx: dx,
        by: dy,
        bz: Math.max(40, dz),
        tight: 0.48,
      });
    } else {
      const incoming = Math.hypot(dx, dy, dz) || 1;
      const graze = Phaser.Math.Clamp(Math.hypot(dx, dy) / incoming, 0, 1);
      const distN = Phaser.Math.Clamp(Math.hypot(x - this.heli.x, y - this.heli.y) / 780, 0, 1);
      const acute = Math.max(graze, distN);
      if (he) {
        this.spawnSparks(x, y, z + 3, {
          style: "ground",
          n: 62,
          spdMin: Phaser.Math.Linear(50, 160, acute),
          spdMax: Phaser.Math.Linear(220, 420, acute),
          bx: dx,
          by: dy,
          bz: Phaser.Math.Linear(110, 40, acute),
          tight: Phaser.Math.Linear(0.1, 0.38, acute),
          sparkFrac: 0.02,
        });
      } else {
        this.spawnSparks(x, y, z + 3, {
          style: "ground",
          n: 26,
          spdMin: Phaser.Math.Linear(36, 200, acute * acute),
          spdMax: Phaser.Math.Linear(200, 520, acute * acute),
          bx: dx,
          by: dy,
          bz: Phaser.Math.Linear(90, 22, acute),
          tight: Phaser.Math.Linear(0.28, 0.72, acute),
          sparkFrac: 0.04,
        });
      }
    }
    const sy = y - screenLift(z);
    if (he) this.heFireBurst(x, y, z, dx, dy, dz, blast);
    if (!water && !objectHit) {
      if (he) {
        const key = `blast_${(Math.random() * 4) | 0}`;
        const sc = (blast / 72) * (0.55 + Math.random() * 0.5);
        this.stampWreck(this.textures.exists(key) ? key : "blast_0", x, y, Math.random() * Math.PI * 2, sc, 1);
      } else {
        this.stampCannonScar(x, y, dx, dy, dz);
      }
    }
    if (!water) {
      this.smoke.setDepth(worldDepth(z, 0.2));
      this.smoke.emitParticleAt(x, sy + 12, he ? 16 : objectHit ? 6 : 8);
    }
    this.shake = Math.min(8, this.shake + blast * (he ? 0.055 : 0.028));
    if (!he) {
      const ring = this.add.circle(x, sy, 6, 0xffc878, 0.55).setDepth(worldDepth(z, 2));
      this.tweens.add({
        targets: ring,
        radius: blast,
        alpha: 0,
        duration: 240,
        onComplete: () => ring.destroy(),
      });
    }
    for (const u of this.units) {
      if (u.dead) continue;
      const d = Math.hypot(u.x - x, u.y - y);
      if (u === direct || d < blast) {
        const fall = u === direct ? dmg : dmg * (1 - d / blast);
        this.hurt(u, fall);
      }
    }
    const hd = Math.hypot(this.heli.x - x, this.heli.y - y);
    const agl = castZ(this.world, this.heli.x, this.heli.y, this.heli.z);
    if (hd < blast * 0.55 && agl < 30) this.heli.damage(dmg * 0.25);
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
    const px = x + (Math.random() - 0.5) * Phaser.Math.Linear(5, 14, graze);
    const py = y + (Math.random() - 0.5) * Phaser.Math.Linear(5, 14, graze);
    const key = `blast_${(Math.random() * 4) | 0}`;
    const base = 0.12 + Math.random() * 0.11;
    const stretch = graze * graze * (0.75 + Math.random() * 0.5);
    const sx = base * Phaser.Math.Linear(1, 2.55, stretch) * (0.82 + Math.random() * 0.36);
    const sy = base * Phaser.Math.Linear(1, 0.36, graze) * (0.82 + Math.random() * 0.36);
    const alpha = Phaser.Math.Linear(0.72, 0.22, graze) * (0.78 + Math.random() * 0.28);
    this.stampWreck(this.textures.exists(key) ? key : "blast_0", px, py, ang, sx, alpha, 0.5, 0.5, sy);
  }

  heFireBurst(x: number, y: number, z: number, dx: number, dy: number, dz: number, blast: number, soft = false): void {
    const sy = y - screenLift(z);
    const mul = soft ? 0.32 : 1;
    this.spawnSparks(x, y, z + 10, {
      style: "object",
      n: Math.max(6, Math.round(22 * mul)),
      spdMin: 140,
      spdMax: 480,
      bx: 0,
      by: 0,
      bz: 1,
      tight: 0.12,
      forceKind: "flame",
      scaleMul: soft ? 0.42 : 1,
    });
    this.blastFire.setDepth(worldDepth(z, 2.6));
    this.blastFire.explode(Math.max(6, Math.round(26 * mul)), x, sy);
    const flash = this.add.circle(x, sy, soft ? 5 : 12, 0xffe8a0, 0.8).setDepth(worldDepth(z, 2.8)).setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({
      targets: flash,
      radius: blast * (soft ? 0.4 : 0.85),
      alpha: 0,
      duration: 220,
      onComplete: () => flash.destroy(),
    });
    this.spawnBlastTrails(x, y, z, dx, dy, dz, soft);
    const ring = this.add.circle(x, sy, 6, 0xff9a40, 0.85).setDepth(worldDepth(z, 2)).setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({
      targets: ring,
      radius: blast * (soft ? 0.45 : 1),
      alpha: 0,
      duration: 380,
      onComplete: () => ring.destroy(),
    });
  }

  spawnBlastTrails(x: number, y: number, z: number, dx: number, dy: number, dz: number, soft = false): void {
    const extra = this.frags.filter((f) => f.trailOnly).length + 8 - 40;
    if (extra > 0) {
      let drop = extra;
      this.frags = this.frags.filter((f) => {
        if (!drop || !f.trailOnly) return true;
        drop--;
        return false;
      });
    }
    const n = (soft ? 3 : 7) + ((Math.random() * (soft ? 2 : 4)) | 0);
    for (let i = 0; i < n; i++) {
      const reverse = Math.random() < 0.35;
      const d = biasedDir(dx, dy, Math.max(40, dz), 0.18, reverse);
      const sp = 70 + Math.random() * 180;
      const jit = 0.55;
      this.frags.push({
        x,
        y,
        z: z + 6 + Math.random() * 12,
        vx: d.x * sp + (Math.random() - 0.5) * sp * jit,
        vy: d.y * sp + (Math.random() - 0.5) * sp * jit,
        vz: 140 + Math.random() * 160 + d.z * 40,
        angle: 0,
        spin: 0,
        life: 1.6 + Math.random() * 1.4,
        key: "frag_metal",
        settled: false,
        gravity: true,
        bounces: Math.random() < 0.4 ? 1 : 0,
        trailOnly: true,
        linger: true,
        trailR: (soft ? 1.2 : 3) + Math.random() * (soft ? 3 : 9),
        trailSoft: soft,
        wobble: Math.random() * Math.PI * 2,
        wobFreq: 9 + Math.random() * 8,
        wobAmp: 140 + Math.random() * 160,
      });
    }
  }

  texTrailR(key: string): number {
    if (!this.textures.exists(key)) return 10;
    const src = this.textures.get(key).getSourceImage() as { width: number; height: number };
    return Math.max(4, Math.max(src.width, src.height) * 0.18);
  }

  hurt(u: Unit, dmg: number): void {
    u.health -= dmg;
    if (u.health <= 0) this.destroyUnit(u);
  }

  destroyUnit(u: Unit): void {
    if (u.dead) return;
    u.dead = true;
    const hz = u.z + heightOf(u.kind) * 0.5;
    this.heFireBurst(u.x, u.y, hz, 0, 0, 1, Math.max(42, radius(u.kind) * 2.4), u.kind === "soldier");
    this.smoke.setDepth(worldDepth(u.z, 0.2));
    this.smoke.emitParticleAt(u.x, u.y - screenLift(u.z) + 12, 16);
    this.shake = Math.min(10, this.shake + 3);
    const n = u.kind === "soldier" ? 4 : u.kind === "bunker" || u.kind === "radar" ? 16 : 10;
    const keys = fragKeys(u.kind);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 55 + Math.random() * 200;
      const key = this.textures.exists(keys[i % keys.length]!)
        ? keys[i % keys.length]!
        : "frag_metal";
      const organic = u.kind === "soldier";
      this.frags.push({
        x: u.x,
        y: u.y,
        z: u.z + 8 + Math.random() * 14,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        vz: 170 + Math.random() * 160,
        angle: a,
        spin: (Math.random() - 0.5) * 10,
        life: 0.45 + Math.random() * 0.4,
        key,
        settled: false,
        gravity: true,
        bounces: Math.random() < 1 / 3 ? 2 + ((Math.random() * 2) | 0) : 0,
        trailR: this.texTrailR(key) * (organic ? 0.38 : 1),
        scale: organic ? 0.55 : 1,
        trailSoft: organic,
      });
    }
    if (u.kind !== "heli" && u.kind !== "boat") {
      const key = `blast_${(Math.random() * 4) | 0}`;
      let sc = (radius(u.kind) / 20) * (0.72 + Math.random() * 0.7);
      if (u.kind === "tank") sc *= 1.25;
      this.stampWreck(this.textures.exists(key) ? key : "blast_0", u.x, u.y, Math.random() * Math.PI * 2, sc, 1);
    }
    if (u.kind === "tank") {
      const hullKey = this.textures.exists("hulk_tank_hull") ? "hulk_tank_hull" : hulkOf("tank");
      this.stampWreck(hullKey, u.x, u.y, u.angle + Math.PI / 2, 1, 0.95);
      const a = Math.random() * Math.PI * 2;
      const throwSp = 90 + Math.random() * 110;
      const turretKey = this.textures.exists("hulk_tank_turret") ? "hulk_tank_turret" : "tank_turret";
      this.frags.push({
        x: u.x,
        y: u.y,
        z: u.z + 18,
        vx: Math.cos(a) * throwSp,
        vy: Math.sin(a) * throwSp,
        vz: 190 + Math.random() * 80,
        angle: u.turret + Math.PI / 2,
        spin: (Math.random() - 0.5) * 10,
        life: 5,
        key: turretKey,
        settled: false,
        gravity: true,
        bounces: Math.random() < 1 / 3 ? 2 + ((Math.random() * 2) | 0) : 0,
        trailR: this.texTrailR(turretKey),
      });
    } else {
      const hulkKey = this.textures.exists(hulkOf(u.kind)) ? hulkOf(u.kind) : "hulk_crater";
      this.stampWreck(hulkKey, u.x, u.y, u.angle + Math.PI / 2, 1, 0.95);
    }
  }

  updateFrags(dt: number): void {
    const keep: Frag[] = [];
    for (const f of this.frags) {
      if (f.trailOnly && !f.settled) f.life -= dt;
      if (f.settled) {
        this.tickFragTrailFade(f, dt);
        if (!f.trailOnly || (f.trailFade ?? 0) > 0) keep.push(f);
        continue;
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
        f.vx += px * osc * dt + (Math.random() - 0.5) * 70 * dt;
        f.vy += py * osc * dt + (Math.random() - 0.5) * 70 * dt;
        f.vz += Math.cos(w * 1.6) * amp * 0.35 * dt + (Math.random() - 0.5) * 50 * dt;
      }
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.angle += f.spin * dt;
      if (f.gravity) {
        f.z += f.vz * dt;
        if (f.vz > 50) f.vz -= 480 * dt;
        else if (f.vz > -40) f.vz -= 70 * dt;
        else f.vz -= 1100 * dt;
        f.vx *= Math.pow(0.78, dt);
        f.vy *= Math.pow(0.78, dt);
        if (f.z > groundZ(this.world, f.x, f.y) + 2) this.emitFragTrail(f, 1);
        const g = groundZ(this.world, f.x, f.y);
        if (f.z <= g) {
          f.z = g;
          if (!f.linger) this.stampDirtSmears(f.x, f.y, f.vx, f.vy);
          if (f.bounces > 0 && f.vz < -50) {
            f.bounces--;
            f.vz = -f.vz * 0.22;
            const spd = Math.hypot(f.vx, f.vy);
            const jit = 0.45;
            f.vx = (f.vx + (Math.random() - 0.5) * spd * jit) * 0.5;
            f.vy = (f.vy + (Math.random() - 0.5) * spd * jit) * 0.5;
            f.spin *= 0.55;
            f.angle += (Math.random() - 0.5) * 0.8;
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

  settleFrag(f: Frag): void {
    if (f.linger) this.stampLightBlast(f.x, f.y, f.vx, f.vy);
    f.settled = true;
    f.vx = 0;
    f.vy = 0;
    f.vz = 0;
    if (!f.trailOnly) {
      const o = this.fragStampOrigin(f.key);
      this.stampWreck(f.key, f.x, f.y, f.angle, 1, 0.92, o.x, o.y);
      f.trailOnly = true;
    }
    this.beginFragTrailFade(f);
  }

  beginFragTrailFade(f: Frag): void {
    f.trailFadeMax = f.linger ? 2.2 + Math.random() * 1.6 : 0.55 + Math.random() * 0.5;
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
    const px = f.x;
    const py = f.y - screenLift(f.z);
    const r = f.trailR;
    const fire = f.trailSoft ? this.ember : f.linger ? this.blastBurn : this.burn;
    const puff = f.linger ? this.lingerSmoke : this.fragSmoke;
    fire.setDepth(worldDepth(f.z, 0.6));
    puff.setDepth(worldDepth(f.z, 0.15));
    if (Math.random() < (f.trailOnly ? 0.85 : 0.7) * dim) {
      const p = jitterDisk(px, py, r * 0.55);
      fire.emitParticleAt(p.x, p.y, 1);
    }
    if (Math.random() < (f.trailOnly ? 0.65 : 0.5) * dim) {
      const p = jitterDisk(px, py, r);
      puff.emitParticleAt(p.x, p.y + 10, 1);
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
      if (u.kind === "heli") {
        u.rotor += 28 * dt;
        if (dist > 180 && dist < 1400) {
          const ang = Math.atan2(dy, dx);
          u.vx += Math.cos(ang) * 80 * dt;
          u.vy += Math.sin(ang) * 80 * dt;
          u.angle = ang;
        }
        u.vx *= 0.98;
        u.vy *= 0.98;
        u.x += u.vx * dt;
        u.y += u.vy * dt;
        const g = groundZ(this.world, u.x, u.y);
        const want = g + CRUISE_Z + 10 + Math.sin(this.time.now * 0.002 + u.id) * 6;
        u.z = Phaser.Math.Linear(u.z, want, 1 - Math.pow(0.1, dt));
      } else {
        if (u.kind === "boat" && isWater(this.world, u.x, u.y)) {
          u.angle += dt * 0.15;
          u.x += Math.cos(u.angle) * 18 * dt;
          u.y += Math.sin(u.angle) * 18 * dt;
        }
        if (u.kind === "tank" && dist < 900 && dist > 120) {
          const want = Math.atan2(dy, dx);
          u.angle = Phaser.Math.Angle.RotateTo(u.angle, want, 0.32 * dt);
          const step = 28 * dt;
          u.x += Math.cos(u.angle) * step;
          u.y += Math.sin(u.angle) * step;
          u.track += step;
          if (u.track > 16) {
            u.track = 0;
            this.stampWreck("track", u.x, u.y, u.angle + Math.PI / 2, 1, 0.4);
          }
        }
        if (u.kind === "soldier" && dist < 360) {
          u.angle = Phaser.Math.Angle.RotateTo(u.angle, Math.atan2(dy, dx), 12 * dt);
        }
        u.z = groundZ(this.world, u.x, u.y);
      }
      if (u.kind === "tank") {
        u.turret = Phaser.Math.Angle.RotateTo(u.turret, Math.atan2(dy, dx), 1.65 * dt);
      }
      const range =
        u.kind === "soldier"
          ? 280
          : u.kind === "tank"
            ? 520
            : u.kind === "tower"
              ? 700
              : u.kind === "heli"
                ? 640
                : u.kind === "boat"
                  ? 480
                  : 0;
      if (range && dist < range && dist > 40 && u.fireCd <= 0 && h.phase === "flight") {
        u.fireCd = u.kind === "soldier" ? 0.9 : u.kind === "tower" ? 0.45 : 0.7;
        const lead = 0.15;
        const tx = h.x + h.vx * lead;
        const ty = h.y + h.vy * lead;
        const t = dist / 420;
        const muzzleZ = u.z + heightOf(u.kind) * 0.7 + ZOff.shot;
        const tgtZ = h.z + HELI_HEIGHT * 0.5;
        const small = u.kind === "soldier";
        this.spawnShot({
          kind: "cannon",
          from: "enemy",
          x: u.x,
          y: u.y,
          z: muzzleZ,
          vx: (tx - u.x) / t,
          vy: (ty - u.y) / t,
          vz: (tgtZ - muzzleZ) / t,
          angle: u.kind === "tank" ? u.turret : u.kind === "soldier" ? u.angle : Math.atan2(ty - u.y, tx - u.x),
          life: t + 0.12,
          blast: small ? 7 : 16,
          dmg: small ? 3 : u.kind === "tower" ? 12 : 8,
          tracer: small ? "small" : "shell",
        });
      }
    }
    this.syncUnitSprites();
  }

  syncUnitSprites(): void {
    const live = this.units.filter((u) => !u.dead);
    while (this.unitG.getLength() < live.length * 3) {
      this.unitG.add(this.add.image(0, 0, "shadow"));
      this.unitG.add(this.add.image(0, 0, "tank_hull"));
      this.unitG.add(this.add.image(0, 0, "enemy_rotor"));
    }
    const kids = this.unitG.getChildren() as Phaser.GameObjects.Image[];
    for (let i = 0; i < kids.length; i++) kids[i]!.setVisible(false);
    live.forEach((u, i) => {
      const sh = kids[i * 3]!;
      const im = kids[i * 3 + 1]!;
      const extra = kids[i * 3 + 2]!;
      const tex = textureOf(u.kind);
      const rot = u.kind === "soldier" ? u.angle + Math.PI / 4 : u.angle + Math.PI / 2;
      const lift = screenLift(u.z);
      const zs = zScale(u.z);
      const heliOx = u.kind === "heli" ? rotorLayout.enemy.x : 0.5;
      const heliOy = u.kind === "heli" ? rotorLayout.enemy.y : 0.5;
      sh.setVisible(true).setOrigin(heliOx, heliOy);
      this.applyCastShadow(sh, u.x, u.y, u.z, tex, rot, u.kind === "heli" ? 1 : 0.92);
      im.setVisible(true)
        .setTexture(tex)
        .setOrigin(heliOx, heliOy)
        .setPosition(u.x, u.y - lift)
        .setRotation(rot)
        .setDepth(worldDepth(u.z, ZOff.body));
      if (u.kind !== "heli") {
        const sl = groundSlope(this.world, u.x, u.y);
        im.setScale(
          (1 + Phaser.Math.Clamp(Math.abs(sl.dx), 0, 0.4) * 0.22) * zs,
          (1 - Phaser.Math.Clamp(sl.dy, -0.45, 0.45) * 0.2) * zs
        );
      } else im.setScale(zs);
      if (u.kind === "heli") {
        extra
          .setVisible(true)
          .setTexture("enemy_rotor")
          .setOrigin(0.5, 0.5)
          .setPosition(im.x, im.y)
          .setRotation(u.rotor)
          .setScale((108 / extra.width) * zs)
          .setAlpha(1)
          .setDepth(worldDepth(u.z, ZOff.rotor));
      } else if (u.kind === "tank") {
        const mx = (tankLayout.mountOrigin.x - 0.5) * im.displayWidth;
        const my = (tankLayout.mountOrigin.y - 0.5) * im.displayHeight;
        extra
          .setVisible(true)
          .setTexture("tank_turret")
          .setOrigin(tankLayout.turretOrigin.x, tankLayout.turretOrigin.y)
          .setPosition(im.x + mx * Math.cos(rot) - my * Math.sin(rot), im.y + mx * Math.sin(rot) + my * Math.cos(rot))
          .setRotation(u.turret + Math.PI / 2)
          .setAlpha(1)
          .setScale(im.scaleX, im.scaleY)
          .setDepth(worldDepth(u.z, ZOff.turret));
      }
    });
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
          ? s.tracer === "small"
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
      const sc =
        s.kind === "cannon"
          ? s.tracer === "small"
            ? 0.38
            : s.tracer === "shell"
              ? 0.72
              : 0.58
          : 1;
      sh.setVisible(true).setOrigin(ox, 0.5);
      this.applyCastShadow(sh, s.x, s.y, s.z, key, rot, sc);
      im.setVisible(true)
        .setTexture(key)
        .setOrigin(ox, 0.5)
        .setPosition(s.x, s.y - screenLift(s.z))
        .setRotation(rot)
        .setScale(sc * zScale(s.z))
        .setDepth(worldDepth(s.z));
    });
  }

  syncFragSprites(): void {
    const vis = this.frags.filter((f) => !f.trailOnly);
    while (this.fragG.getLength() < vis.length * 2) {
      this.fragG.add(this.add.image(0, 0, "shadow"));
      this.fragG.add(this.add.image(0, 0, "frag_metal"));
    }
    const kids = this.fragG.getChildren() as Phaser.GameObjects.Image[];
    for (const k of kids) k.setVisible(false);
    vis.forEach((f, i) => {
      const sh = kids[i * 2]!;
      const im = kids[i * 2 + 1]!;
      const z = f.z || 0;
      const turret = f.key.includes("turret");
      const ox = turret
        ? f.key.includes("hulk")
          ? tankLayout.hulkTurretOrigin.x
          : tankLayout.turretOrigin.x
        : 0.5;
      const oy = turret
        ? f.key.includes("hulk")
          ? tankLayout.hulkTurretOrigin.y
          : tankLayout.turretOrigin.y
        : 0.5;
      const sc = (f.scale ?? 1) * zScale(z);
      sh.setVisible(true).setOrigin(ox, oy);
      this.applyCastShadow(sh, f.x, f.y, z, f.key, f.angle, f.scale ?? 1);
      if (castZ(this.world, f.x, f.y, z) < 1) sh.setAlpha(0.22);
      im.setVisible(true)
        .setTexture(f.key)
        .setOrigin(ox, oy)
        .setPosition(f.x, f.y - screenLift(z))
        .setRotation(f.angle)
        .setScale(sc)
        .setDepth(f.settled ? Layer.HULK : worldDepth(z))
        .setAlpha(f.settled ? 0.92 : 1);
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

  drawLockBox(u: Unit, scale: number, width: number, alpha: number): { x: number; y: number; half: number; depth: number } {
    const g = this.lockGfx;
    const x = u.x;
    const y = u.y - screenLift(u.z);
    const half = this.lockBoxHalf(u, scale);
    const depth = worldDepth(u.z, 8);
    g.lineStyle(width, 0xff3a22, alpha);
    g.strokeRect(x - half, y - half, half * 2, half * 2);
    return { x, y, half, depth };
  }

  updateLock(): void {
    const h = this.heli;
    const g = this.lockGfx;
    g.clear();
    this.lockSpr.setVisible(false);
    this.lockArrowGfx.clear();
    this.lockHudTxt.setVisible(false);

    const hellfire = WPN_LIST[h.weapon]!.id === "hellfire";
    if (!hellfire) {
      g.setVisible(false);
      this.lockTxt.setVisible(false);
      return;
    }

    const locked = h.hellfireLock ? this.unitById(h.hellfireLock.id) : undefined;
    const seeking = h.hellfireSeek ? this.unitById(h.hellfireSeek.id) : undefined;
    if (!locked && !seeking) {
      g.setVisible(false);
      this.lockTxt.setVisible(false);
      return;
    }

    g.setVisible(true);
    let lockDepth = Layer.FIELD;
    if (seeking) {
      const vis = this.unitOnHud(seeking);
      if (vis.on) {
        const t = Math.min(1, h.hellfireSeek!.t / HELLFIRE_LOCK_T);
        const scale = 2 - t;
        const box = this.drawLockBox(seeking, scale, 1.6, 0.72 + t * 0.22);
        g.setDepth(box.depth);
        lockDepth = box.depth;
      }
    }
    if (locked) {
      const vis = this.unitOnHud(locked);
      if (vis.on) {
        const pulse = 0.82 + 0.18 * Math.sin(this.time.now * 0.0055);
        const box = this.drawLockBox(locked, 1, 2, pulse);
        lockDepth = Math.max(lockDepth, box.depth);
        g.setDepth(lockDepth);
        this.lockTxt
          .setVisible(true)
          .setPosition(box.x, box.y - box.half - 4)
          .setDepth(lockDepth)
          .setAlpha(pulse)
          .setScale(zScale(locked.z));
      } else {
        this.lockTxt.setVisible(false);
        this.drawLockOffscreen(vis.sx, vis.sy);
      }
    } else {
      this.lockTxt.setVisible(false);
    }
  }

  drawLockOffscreen(sx: number, sy: number): void {
    const g = this.lockArrowGfx;
    const w = this.scale.width;
    const h = this.scale.height;
    const pad = 36;
    const cx = w / 2;
    const cy = h / 2;
    const ang = Math.atan2(sy - cy, sx - cx);
    const ax = Phaser.Math.Clamp(sx, pad, w - pad);
    const ay = Phaser.Math.Clamp(sy, pad, h - pad);
    const pulse = 0.82 + 0.18 * Math.sin(this.time.now * 0.0055);
    g.fillStyle(0xff3a22, 0.92 * pulse);
    g.save();
    g.translateCanvas(ax, ay);
    g.rotateCanvas(ang);
    g.fillTriangle(12, 0, -8, -3.6, -8, 3.6);
    g.restore();
    const lx = ax - Math.cos(ang) * 34;
    const ly = ay - Math.sin(ang) * 22;
    const lp = this.hudLocal(lx, ly);
    this.lockHudTxt
      .setVisible(true)
      .setPosition(lp.x, lp.y)
      .setAlpha(pulse)
      .setRotation(0);
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
      if (castZ(this.world, u.x, u.y, u.z) < 16 && u.kind !== "heli") continue;
      const d = Math.hypot(u.x - x, u.y - y);
      if (d < bd) {
        bd = d;
        best = u;
      }
    }
    return best;
  }

  drawHud(): void {
    const h = this.heli;
    const w = WPN_LIST[h.weapon]!;
    const ammo = this.ammo[h.weapon]!;
    const ammoS = Number.isFinite(ammo) ? String(ammo) : "∞";
    const phase =
      h.phase === "grounded" || h.phase === "spool"
        ? "SPOOLING ROTORS"
        : h.phase === "liftoff"
          ? "LIFTING"
          : h.phase === "dead"
            ? "DOWN"
            : "AIRBORNE";
    const ptr = this.worldPointer();
    const elv = groundZ(this.world, ptr.x, ptr.y) | 0;
    this.hud.setText(
      `ALT ${castZ(this.world, h.x, h.y, h.z) | 0}   ELV ${elv}   SPD ${Math.hypot(h.vx, h.vy) | 0}   TIME ${this.timeScale.toFixed(2)}×\n${phase}\nWPN ${w.name}  ${ammoS}`
    );

    const lines = this.world.hv.map((spec) => this.hvLine(spec));
    const left = lines.filter((l) => !l.done).length;
    this.hvHud.setText(
      `HV TARGETS  ${this.world.hv.length - left}/${this.world.hv.length}\n` +
        lines.map((l) => l.text).join("\n")
    );
    this.drawWeaponHud();
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
      const empty = Number.isFinite(a) && a <= 0;
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
      const ammoS = empty ? "X" : Number.isFinite(a) ? String(a | 0) : "∞";
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
      text: `→ ${spec.name}  ${dist | 0}m  ${compass}  ${hp}%`,
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
    if (this.mapBlend > 0.12) return;
    this.hvGfx.clear();
    const cam = this.cameras.main;
    const view = cam.worldView;
    const w = this.scale.width;
    const h = this.scale.height;
    const pad = 36;
    for (const spec of this.world.hv) {
      const u = this.units.find((q) => q.hv === spec.id);
      if (!u || u.dead) continue;
      const sx = ((u.x - view.x) / view.width) * w;
      const sy = ((u.y - view.y) / view.height) * h;
      if (sx > pad && sx < w - pad && sy > pad && sy < h - pad) continue;
      const cx = w / 2;
      const cy = h / 2;
      const ang = Math.atan2(sy - cy, sx - cx);
      const ax = Phaser.Math.Clamp(sx, pad, w - pad);
      const ay = Phaser.Math.Clamp(sy, pad, h - pad);
      this.hvGfx.fillStyle(0xff5a3a, 0.9);
      this.hvGfx.save();
      this.hvGfx.translateCanvas(ax, ay);
      this.hvGfx.rotateCanvas(ang);
      this.hvGfx.fillTriangle(10, 0, -8, -7, -8, 7);
      this.hvGfx.restore();
    }
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

  toggleMap(): void {
    if (this.over) return;
    this.mapWant = !this.mapWant;
    this.mapLabel
      .setVisible(true)
      .setText(this.mapWant ? "THEATER MAP   HV sites marked   M close" : "RETURNING");
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
    for (const em of [this.smoke, this.tracer, this.flame, this.hurtSmoke, this.burn, this.blastBurn, this.blastFire, this.ember, this.fragSmoke, this.lingerSmoke, this.heliDust]) {
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
      this.hvHud,
      this.playerHud,
      this.wpnBar,
      ...this.wpnSlots,
      this.hvGfx,
      this.lockArrowGfx,
      this.lockHudTxt,
    ];
    for (const go of chrome) this.adoptHud(go);
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
      const altN = Phaser.Math.Clamp(castZ(this.world, heli.x, heli.y, heli.z) / MAX_Z, 0, 1);
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
    const spool = Phaser.Math.Easing.Sine.In(Phaser.Math.Clamp(h.rotorSpd / 32, 0, 1));
    if (h.phase !== "flight" && h.phase !== "liftoff") {
      return Phaser.Math.Linear(2.55, 1.02, spool);
    }
    const napeZ = 1.28;
    const cruiseZ = 1.02;
    const popZ = 0.78;
    let altZoom: number;
    if (this.keySpace?.isDown) altZoom = popZ;
    else if (this.keyShift?.isDown) altZoom = napeZ;
    else {
      const agl = castZ(this.world, h.x, h.y, h.z);
      if (agl <= CRUISE_Z) {
        const t = Phaser.Math.Clamp((agl - LOW_Z) / Math.max(1, CRUISE_Z - LOW_Z), 0, 1);
        altZoom = Phaser.Math.Linear(napeZ, cruiseZ, t);
      } else {
        const t = Phaser.Math.Clamp((agl - CRUISE_Z) / Math.max(1, MAX_Z - CRUISE_Z), 0, 1);
        altZoom = Phaser.Math.Linear(cruiseZ, popZ, t);
      }
    }
    const spdN = Phaser.Math.Clamp(Math.hypot(h.vx, h.vy) / 340, 0, 1);
    return altZoom * (1 - spdN * 0.06);
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
      if (!this.camFollow) {
        cam.startFollow(this.body, true, 0.12, 0.12);
        this.camFollow = true;
      }
    }
  }

  setHudVisible(on: boolean): void {
    this.hud.setVisible(on);
    this.hvHud.setVisible(on);
    this.wpnHud.setVisible(on);
    this.wpnBar.setVisible(on);
    for (const t of this.wpnSlots) t.setVisible(on);
    this.playerHud.setVisible(on);
    this.miniGfx.setVisible(on);
    this.miniBg.setVisible(on);
    this.miniTerrain.setVisible(on);
    this.miniWrecks.setVisible(on && !this.showHeightMap);
    this.hudRoot.setVisible(on);
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
      this.lockHudTxt.setVisible(false);
      this.lockArrowGfx.clear();
      this.playerHud.clear();
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
      this.mapHvLabels.push(
        this.add
          .text(0, 0, "", {
            fontFamily: "Share Tech Mono, monospace",
            fontSize: "12px",
            color: "#ffe08a",
            align: "left",
          })
          .setOrigin(0, 0.5)
          .setDepth(Layer.HUD + 3)
          .setStroke("#12100c", 4)
      );
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
      const w = (u.kind === "soldier" ? 16 : 32) * zs;
      const ratio = Phaser.Math.Clamp(u.health / u.max, 0, 1);
      const x = u.x - w / 2;
      const y = u.y - screenLift(u.z) - heightOf(u.kind) * 0.35 * zs - 14 * zs;
      g.fillStyle(0x10100c, 0.7);
      g.fillRect(x, y, w, 4 * zs);
      g.fillStyle(ratio > 0.5 ? 0x6dbb4a : ratio > 0.25 ? 0xe8b84a : 0xff4a2a, 1);
      g.fillRect(x, y, w * ratio, 4 * zs);
    }
  }

  drawPlayerHud(): void {
    const g = this.playerHud;
    g.clear();
    const hp = Phaser.Math.Clamp(this.heli.health / 100, 0, 1);
    const cx = this.scale.width / 2;
    const y = 14;
    const bw = 300;
    const bh = 11;
    const col = hp > 0.55 ? 0x6dbb4a : hp > 0.28 ? 0xe8b84a : 0xff3a2a;
    g.fillStyle(0x12100c, 0.72);
    g.fillRoundedRect(cx - bw / 2 - 10, y - 6, bw + 20, 72, 6);
    g.fillStyle(0x2e2a22, 1);
    g.fillRect(cx - bw / 2, y, bw, bh);
    g.fillStyle(col, 1);
    g.fillRect(cx - bw / 2, y, bw * hp, bh);
    g.lineStyle(1.5, 0xe8b84a, 0.85);
    g.strokeRect(cx - bw / 2, y, bw, bh);

    const ox = cx;
    const oy = y + 42;
    const pulse = hp < 0.3 ? 0.55 + 0.45 * Math.sin(this.time.now * 0.02) : 1;
    const sec = (ok: boolean, fill: number) => {
      g.fillStyle(ok ? fill : 0xff2a18, ok ? 1 : pulse);
    };
    sec(hp > 0.7, 0x8a9284);
    g.fillRect(ox - 4, oy - 22, 8, 18);
    sec(hp > 0.45, 0x6e766a);
    g.fillEllipse(ox, oy + 4, 16, 22);
    sec(hp > 0.22, 0x5a6256);
    g.fillTriangle(ox - 6, oy + 14, ox, oy + 26, ox + 6, oy + 14);
    sec(hp > 0.55, 0x3a3d36);
    g.lineStyle(2, hp > 0.55 ? 0x3a3d36 : 0xff2a18, 0.9);
    g.strokeCircle(ox, oy, 16);
    g.lineBetween(ox - 16, oy, ox + 16, oy);
    g.lineBetween(ox, oy - 16, ox, oy + 16);
  }

  emitDamageFx(): void {
    const h = this.heli;
    if (h.phase === "dead" || h.health >= 98) {
      h.dmgSites.length = 0;
      return;
    }
    const want = h.health < 25 ? 3 : h.health < 45 ? 2 : h.health < 75 ? 1 : 0;
    while (h.dmgSites.length < want) {
      const used = new Set(h.dmgSites.map((s) => s.i));
      const pool = DMG_FLAME_UV.map((_, i) => i).filter((i) => !used.has(i));
      if (!pool.length) break;
      const i = pool[(Math.random() * pool.length) | 0]!;
      h.dmgSites.push({ i, scale: 0.42 + Math.random() * 0.38 });
    }
    if (!want) return;
    const dmgDepth = worldDepth(h.z, ZOff.dmg);
    this.flame.setDepth(dmgDepth);
    this.hurtSmoke.setDepth(worldDepth(h.z, ZOff.dmg - 1.2));
    for (const s of h.dmgSites) {
      const uv = DMG_FLAME_UV[s.i]!;
      const p = spriteUvPos(this.body, uv.u, uv.v);
      this.dmgFlameScale = s.scale;
      if (Math.random() < 0.72) this.flame.emitParticleAt(p.x, p.y, 2);
      if (Math.random() < 0.4) this.hurtSmoke.emitParticleAt(p.x, p.y + 9, 1);
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
    );
  }
}

function sparkTexKey(kind: SparkKind): string {
  return kind === "dirt" ? "dirt" : kind === "splash" ? "splash" : kind === "flame" ? "flame" : "spark";
}

function pickSparkKind(style: "muzzle" | "ground" | "water" | "object", sparkFrac = 0.18): SparkKind {
  if (style === "water") return "splash";
  if (style === "muzzle") return "flame";
  if (style === "object") return "spark";
  return Math.random() < sparkFrac ? "spark" : "dirt";
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

function sparkLook(kind: SparkKind, biome: Biome, blood = false): { tint: number; add: boolean } {
  if (blood) {
    const pal = [0xc42820, 0xb01c18, 0xd43428, 0x9a1814, 0xcc3028];
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
