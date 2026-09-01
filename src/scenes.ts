import Phaser from "phaser";
import { bakeAll } from "./bake";
import {
  FRAG_KEYS,
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
import { CRUISE_Z, HELI_HEIGHT, Heli, MAX_Z } from "./heli";
import { SpriteConfigTool } from "./spriteConfig";
import { preloadArt, prepareArt, gunLayout, rotorLayout, shadowAlpha, shadowKey, shadowOff, spriteUvPos, tankLayout } from "./sprites";
import {
  generateWorld,
  groundSlope,
  groundZ,
  screenLift,
  castZ,
  isWater,
  paintHeightMap,
  sampleBiome,
  SCALE,
  WORLD,
  type HvSpec,
  type WorldData,
  type Biome,
} from "./world";

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
      const world = generateWorld(seed);
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
  body!: Phaser.GameObjects.Image;
  rotor!: Phaser.GameObjects.Image;
  gun!: Phaser.GameObjects.Image;
  shadow!: Phaser.GameObjects.Image;
  reticle!: Phaser.GameObjects.Image;
  bore!: Phaser.GameObjects.Image;
  lockSpr!: Phaser.GameObjects.Image;
  unitG!: Phaser.GameObjects.Group;
  shotG!: Phaser.GameObjects.Group;
  fragG!: Phaser.GameObjects.Group;
  sparkG!: Phaser.GameObjects.Group;
  trackG!: Phaser.GameObjects.Group;
  hulkG!: Phaser.GameObjects.Group;
  smoke!: Phaser.GameObjects.Particles.ParticleEmitter;
  tracer!: Phaser.GameObjects.Particles.ParticleEmitter;
  flame!: Phaser.GameObjects.Particles.ParticleEmitter;
  hurtSmoke!: Phaser.GameObjects.Particles.ParticleEmitter;
  burn!: Phaser.GameObjects.Particles.ParticleEmitter;
  fragSmoke!: Phaser.GameObjects.Particles.ParticleEmitter;
  muzzle!: Phaser.GameObjects.Image;
  hud!: Phaser.GameObjects.Text;
  hvHud!: Phaser.GameObjects.Text;
  wpnHud!: Phaser.GameObjects.Text;
  hpGfx!: Phaser.GameObjects.Graphics;
  playerHud!: Phaser.GameObjects.Graphics;
  mapLabel!: Phaser.GameObjects.Text;
  miniGfx!: Phaser.GameObjects.Graphics;
  miniBg!: Phaser.GameObjects.Graphics;
  miniTerrain!: Phaser.GameObjects.Image;
  hvGfx!: Phaser.GameObjects.Graphics;
  over = false;
  win = false;
  shake = 0;
  canFire = false;
  mapView = false;
  mapWant = false;
  mapBlend = 0;
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
      this.world = generateWorld((Date.now() ^ (Math.random() * 1e9)) >>> 0);
    } else this.world = data.world;
  }

  create(): void {
    this.stampDecor();
    if (this.textures.exists("terrain")) this.textures.remove("terrain");
    this.textures.addCanvas("terrain", this.world.canvas);
    if (this.textures.exists("heightmap")) this.textures.remove("heightmap");
    this.textures.addCanvas("heightmap", paintHeightMap(this.world.height, this.world.biome));
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

    this.unitG = this.add.group();
    this.shotG = this.add.group();
    this.fragG = this.add.group();
    this.sparkG = this.add.group();
    this.trackG = this.add.group();
    this.hulkG = this.add.group();

    this.heli = new Heli(this.world.spawnX, this.world.spawnY, this.world);
    this.heli.angle = 0.6;
    this.shadow = this.add.image(0, 0, "shadow").setDepth(Layer.SHADOW);
    this.gun = this.add.image(0, 0, "heli_gun").setDepth(Layer.WORLD).setOrigin(gunLayout.origin.x, gunLayout.origin.y);
    this.body = this.add.image(0, 0, "heli_body").setDepth(Layer.WORLD).setOrigin(rotorLayout.player.x, rotorLayout.player.y);
    this.rotor = this.add.image(0, 0, "heli_rotor").setDepth(Layer.WORLD).setOrigin(0.5, 0.5);
    this.muzzle = this.add.image(0, 0, "muzzle").setDepth(Layer.WORLD).setVisible(false).setScale(0.55);
    this.body.setPosition(this.heli.x, this.heli.y);
    this.reticle = this.add.image(0, 0, "reticle").setDepth(Layer.HUD).setScrollFactor(0);
    this.bore = this.add.image(0, 0, "reticle_bore").setDepth(Layer.HUD + 1).setScrollFactor(0);
    this.lockSpr = this.add.image(0, 0, "lock").setDepth(Layer.FIELD).setVisible(false);

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

    this.smoke = this.add.particles(0, 0, "smoke", {
      lifespan: 900,
      speed: { min: 10, max: 70 },
      scale: { start: 0.6, end: 2.4 },
      alpha: { start: 0.55, end: 0 },
      emitting: false,
    });
    this.smoke.setDepth(Layer.WORLD);
    this.tracer = this.add.particles(0, 0, "spark", {
      lifespan: 160,
      speed: { min: 40, max: 140 },
      scale: { start: 0.7, end: 0 },
      alpha: { start: 1, end: 0 },
      emitting: false,
    });
    this.tracer.setDepth(Layer.WORLD);
    this.flame = this.add.particles(0, 0, "flame", {
      lifespan: 420,
      speed: { min: 8, max: 40 },
      scale: { start: 0.7, end: 0.1 },
      alpha: { start: 0.9, end: 0 },
      emitting: false,
    });
    this.flame.setDepth(Layer.WORLD);
    this.hurtSmoke = this.add.particles(0, 0, "smoke", {
      lifespan: 700,
      speed: { min: 6, max: 28 },
      scale: { start: 0.4, end: 1.3 },
      alpha: { start: 0.5, end: 0 },
      emitting: false,
    });
    this.hurtSmoke.setDepth(Layer.WORLD);
    this.burn = this.add.particles(0, 0, "flame", {
      lifespan: 280,
      speed: { min: 6, max: 28 },
      scale: { start: 0.55, end: 0.08 },
      alpha: { start: 0.95, end: 0 },
      emitting: false,
    });
    this.burn.setDepth(Layer.WORLD);
    this.fragSmoke = this.add.particles(0, 0, "smoke", {
      lifespan: 520,
      speed: { min: 8, max: 36 },
      scale: { start: 0.35, end: 1.4 },
      alpha: { start: 0.5, end: 0 },
      emitting: false,
    });
    this.fragSmoke.setDepth(Layer.WORLD);
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
    this.wpnHud = this.add
      .text(this.scale.width / 2, this.scale.height - 18, "", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "13px",
        color: "#e8b84a",
        align: "center",
      })
      .setOrigin(0.5, 1)
      .setScrollFactor(0)
      .setDepth(Layer.HUD);
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
    this.debugGfx = this.add.graphics().setDepth(Layer.FIELD).setVisible(false);
    const cx = 18 + 88;
    const cy = this.scale.height - 18 - 88;
    const maskG = this.add.graphics().setScrollFactor(0);
    maskG.fillStyle(0xffffff);
    maskG.fillCircle(cx, cy, 88);
    this.miniBg = this.add.graphics().setScrollFactor(0).setDepth(Layer.HUD - 1);
    this.miniBg.fillStyle(0x12100c, 1);
    this.miniBg.fillCircle(cx, cy, 90);
    this.miniTerrain = this.add.image(cx, cy, "terrain").setScrollFactor(0).setDepth(Layer.HUD);
    this.miniTerrain.setMask(maskG.createGeometryMask());
    maskG.setVisible(false);

    this.cameras.main.centerOn(this.heli.x, this.heli.y);
    this.cameras.main.startFollow(this.body, true, 0.12, 0.12);
    this.cameras.main.setDeadzone(80, 80);
    this.playScrollX = this.heli.x - this.scale.width / 2;
    this.playScrollY = this.heli.y - this.scale.height / 2;
    this.playViewX = this.playScrollX;
    this.playViewY = this.playScrollY;
    this.playViewW = this.scale.width;
    this.playViewH = this.scale.height;
    this.playLastFrame = true;
  }

  stampDecor(): void {
    const g = this.world.canvas.getContext("2d")!;
    const tree = this.textures.get("tree").getSourceImage() as HTMLCanvasElement;
    const rock = this.textures.get("rock").getSourceImage() as HTMLCanvasElement;
    for (const t of this.world.trees) {
      if (Math.random() > 0.45) continue;
      const s = 6 + Math.random() * 5;
      g.globalAlpha = 0.85;
      g.drawImage(tree, t.x / SCALE - s / 2, t.y / SCALE - s / 2, s, s);
    }
    g.globalAlpha = 1;
    for (const r of this.world.rocks) {
      const s = 5 + Math.random() * 5;
      g.drawImage(rock, r.x / SCALE - s / 2, r.y / SCALE - s / 2, s, s);
    }
  }

  update(_t: number, dms: number): void {
    if (this.spriteCfg?.open) {
      this.spriteCfg.update();
      this.reticle.setVisible(false);
      this.bore.setVisible(false);
      return;
    }
    const dt = Math.min(dms / 1000, 0.05) * this.timeScale;
    if (this.over) {
      this.drawMinimap();
      this.drawPlayerHud();
      return;
    }
    this.syncPlayView();
    this.updateTheaterCam(dt);

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

    this.syncHeliGfx();
    this.handleFire(dt);
    this.updateUnits(dt);
    this.updateShots(dt);
    this.updateFrags(dt);
    this.updateSparks(dt);
    this.updateLock();
    this.drawUnitBars();
    this.emitDamageFx();
    this.drawDebugHits();

    const mapOn = this.mapBlend > 0.12;
    this.setHudVisible(!mapOn);
    if (mapOn) {
      this.drawMapOverlay();
    } else {
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
      .setScale(scale * (1 + cast * 0.004))
      .setDepth(Layer.SHADOW);
  }

  syncHeliGfx(): void {
    const h = this.heli;
    this.applyCastShadow(this.shadow, h.x, h.y, h.z, "heli_body", h.angle + Math.PI / 2);
    this.shadow.setOrigin(rotorLayout.player.x, rotorLayout.player.y);
    const lift = screenLift(h.z);
    this.body.setOrigin(rotorLayout.player.x, rotorLayout.player.y);
    this.body.setPosition(h.x, h.y - lift);
    this.body.setRotation(h.angle + Math.PI / 2);
    const sx = 1 + Math.abs(h.roll) * 0.12;
    const sy = 1 - Math.abs(h.pitch) * 0.14;
    this.body.setScale(sx, sy);
    this.rotor.setOrigin(0.5, 0.5);
    const ca = Math.cos(h.angle);
    const sa = Math.sin(h.angle);
    const rOffF = h.pitch * 16;
    const rOffS = h.roll * 14;
    this.rotor.setPosition(
      this.body.x + ca * rOffF - sa * rOffS,
      this.body.y + sa * rOffF + ca * rOffS
    );
    const mount = spriteUvPos(this.body, gunLayout.mount.x, gunLayout.mount.y);
    this.gun.setPosition(mount.x, mount.y);
    this.rotor.setRotation(h.rotor);
    this.gun.setRotation(h.gunAngle + Math.PI / 2);
    this.rotor.setScale((124 / this.rotor.width) * 1.08);
    this.rotor.setAlpha(h.rotorSpd > 24 ? 0.72 : 1);
    this.body.setDepth(worldDepth(h.z, ZOff.body));
    this.rotor.setDepth(worldDepth(h.z, ZOff.rotor));
    this.gun.setDepth(worldDepth(h.z, ZOff.gun));
    this.muzzle.setDepth(worldDepth(h.z, ZOff.muzzle));
    this.syncReticles();
    if (h.phase === "spool" || h.phase === "liftoff") {
      if (Math.random() < 0.5) {
        const gnd = groundZ(this.world, h.x, h.y);
        this.smoke.setDepth(worldDepth(gnd));
        this.smoke.emitParticleAt(
          h.x + (Math.random() - 0.5) * 28,
          h.y - screenLift(gnd) + (Math.random() - 0.2) * 10,
          1
        );
      }
    }
  }

  syncReticles(): void {
    const p = this.input.activePointer;
    this.reticle.setPosition(p.x, p.y);
    const h = this.heli;
    const aim = this.worldPointer();
    const wpn = WPN_LIST[h.weapon]!.id;
    let bx: number;
    let by: number;
    if (wpn === "cannon") {
      const dist = Math.hypot(aim.x - h.x, aim.y - h.y);
      bx = h.x + Math.cos(h.gunAngle) * dist;
      by = h.y + Math.sin(h.gunAngle) * dist;
    } else {
      const along = Math.max(80, projectAlong(h.x, h.y, h.angle, aim.x, aim.y));
      bx = h.x + Math.cos(h.angle) * along;
      by = h.y + Math.sin(h.angle) * along;
    }
    const hud = this.worldToHud(bx, by);
    this.bore.setPosition(hud.x, hud.y);
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
      const z0 = h.z + ZOff.shot;
      const dist = Math.hypot(tx - tip.x, ty - tip.y);
      const t = Math.max(0.08, dist / spd);
      this.spawnShot({
        kind: "cannon",
        from: "player",
        x: tip.x,
        y: tip.y,
        z: z0,
        vx: (tx - tip.x) / t,
        vy: (ty - tip.y) / t,
        vz: (tz - z0) / t,
        angle: ang,
        life: t + (air ? 0.55 : 0.08),
        blast: 18,
        dmg: 14,
      });
      this.spawnSparks(tip.x, tip.y, z0 + 2, {
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
      this.muzzle
        .setVisible(true)
        .setPosition(tip.x, tip.y)
        .setRotation(h.gunAngle + Math.PI / 2)
        .setAlpha(0.9);
      this.time.delayedCall(40, () => this.muzzle.setVisible(false));
    }

    if (wpn === "rocket" && down && h.fireCd <= 0 && this.ammo[1]! > 0) {
      h.fireCd = 0.22;
      this.ammo[1]!--;
      const side = this.ammo[1]! % 2 === 0 ? 1 : -1;
      const px = h.x + Math.cos(h.angle + Math.PI / 2) * 22 * side;
      const py = h.y + Math.sin(h.angle + Math.PI / 2) * 22 * side;
      const air = this.hoverAerial(ptr.x, ptr.y);
      const along = projectAlong(h.x, h.y, h.angle, air ? air.x : ptr.x, air ? air.y : ptr.y);
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
    }

    if (wpn === "hellfire") {
      const tgt = this.nearestUnit(ptr.x, ptr.y, 90);
      if (tgt) {
        if (!h.hellfireLock || h.hellfireLock.id !== tgt.id) {
          h.hellfireLock = { id: tgt.id, t: 0 };
        } else h.hellfireLock.t += dt;
      } else h.hellfireLock = null;
      if (
        down &&
        h.fireCd <= 0 &&
        this.ammo[2]! > 0 &&
        h.hellfireLock &&
        h.hellfireLock.t > 0.45
      ) {
        h.fireCd = 0.55;
        this.ammo[2]!--;
        this.spawnShot({
          kind: "hellfire",
          from: "player",
          x: h.x,
          y: h.y,
          z: h.z + ZOff.shot,
          vx: Math.cos(h.angle) * 280,
          vy: Math.sin(h.angle) * 280,
          vz: 8,
          angle: h.angle,
          life: 4.5,
          targetId: h.hellfireLock.id,
          blast: 85,
          dmg: 95,
        });
      }
    } else h.hellfireLock = null;

    if (wpn === "tow" && down && h.fireCd <= 0 && this.ammo[3]! > 0) {
      h.fireCd = 1.1;
      this.ammo[3]!--;
      const side = this.ammo[3]! % 2 === 0 ? 1 : -1;
      this.spawnShot({
        kind: "tow",
        from: "player",
        x: h.x + Math.cos(h.angle + Math.PI / 2) * 24 * side,
        y: h.y + Math.sin(h.angle + Math.PI / 2) * 24 * side,
        z: h.z + ZOff.shot,
        vx: Math.cos(h.angle) * 240,
        vy: Math.sin(h.angle) * 240,
        vz: -12,
        angle: h.angle,
        life: 5,
        blast: 80,
        dmg: 88,
        guided: true,
      });
    }
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
    }
  ): void {
    const extra = this.sparks.length + opt.n - 220;
    if (extra > 0) this.sparks.splice(0, extra);
    const biome = sampleBiome(this.world, x, y);
    for (let i = 0; i < opt.n; i++) {
      const kind = pickSparkKind(opt.style);
      const reverse = opt.style === "object" && Math.random() < 0.5;
      const d = biasedDir(opt.bx, opt.by, opt.bz, opt.tight, reverse);
      const spd = opt.spdMin + Math.random() * (opt.spdMax - opt.spdMin);
      const life =
        kind === "dirt" ? 0.45 + Math.random() * 0.35 : kind === "splash" ? 0.32 + Math.random() * 0.28 : 0.18 + Math.random() * 0.22;
      const look = sparkLook(kind, biome);
      this.sparks.push({
        x,
        y,
        z: z + 1 + Math.random() * 4,
        vx: d.x * spd,
        vy: d.y * spd,
        vz: d.z * spd + (kind === "dirt" || kind === "splash" ? 50 : 20),
        life,
        max: life,
        scale: kind === "dirt" ? 0.58 + Math.random() * 0.5 : 0.45 + Math.random() * 0.55,
        bounces: kind === "flame" ? 1 : kind === "splash" ? 2 : 2 + ((Math.random() * 3) | 0),
        kind,
        tint: look.tint,
        additive: look.add,
      });
    }
  }

  updateSparks(dt: number): void {
    const live: Spark[] = [];
    const drag = Math.pow(0.045, dt);
    const zDrag = Math.pow(0.18, dt);
    for (const s of this.sparks) {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.z += s.vz * dt;
      s.vz -= Z_GRAVITY * dt;
      s.vx *= drag;
      s.vy *= drag;
      s.vz *= zDrag;
      s.life -= dt;
      const g = groundZ(this.world, s.x, s.y);
      if (s.z < g) {
        s.z = g;
        if (s.bounces > 0 && s.vz < -30) {
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
      const spd = Math.hypot(s.vx, s.vy, s.vz);
      const dirt = s.kind === "dirt";
      const stretch = 1 + spd * (dirt ? 0.012 : 0.0048);
      const thick = s.scale * (dirt ? 0.4 + fade * 0.42 : 0.4 + fade * 0.7);
      const scrX = s.vx;
      const scrY = s.vy - screenLift(s.vz);
      im.setVisible(true)
        .setPosition(s.x, s.y - screenLift(s.z))
        .setRotation(Math.atan2(scrY, scrX))
        .setScale(thick * stretch, thick / (dirt ? stretch : Math.sqrt(stretch)))
        .setTint(s.tint)
        .setBlendMode(s.additive ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL)
        .setAlpha(s.additive ? 0.45 + fade * 0.55 : 0.55 + fade * 0.4)
        .setDepth(worldDepth(s.z, 0.3));
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
      if (s.kind === "hellfire" && s.targetId != null) {
        const u = this.units.find((q) => q.id === s.targetId && !q.dead);
        const tx = u ? u.x : s.x + s.vx;
        const ty = u ? u.y : s.y + s.vy;
        const want = Math.atan2(ty - s.y, tx - s.x);
        const da = Phaser.Math.Angle.Wrap(want - s.angle);
        s.angle += Phaser.Math.Clamp(da, -2.8 * dt, 2.8 * dt);
        const spd = 420;
        s.vx = Math.cos(s.angle) * spd;
        s.vy = Math.sin(s.angle) * spd;
        const tz = u ? u.z + heightOf(u.kind) * 0.5 : groundZ(this.world, s.x, s.y);
        s.vz = (tz - s.z) * 2.4;
      }
      if (s.guided) {
        const air = this.hoverAerial(ptr.x, ptr.y);
        const want = Math.atan2(ptr.y - s.y, ptr.x - s.x);
        const da = Phaser.Math.Angle.Wrap(want - s.angle);
        s.angle += Phaser.Math.Clamp(da, -2.2 * dt, 2.2 * dt);
        const spd = 300;
        s.vx = Math.cos(s.angle) * spd;
        s.vy = Math.sin(s.angle) * spd;
        const dist = Math.hypot(ptr.x - s.x, ptr.y - s.y);
        const hold = Phaser.Math.Clamp(dist / 360, 0, 1);
        const gndAim = groundZ(this.world, ptr.x, ptr.y);
        const tz = air ? air.z + heightOf(air.kind) * 0.5 : Phaser.Math.Linear(gndAim, this.heli.z, hold);
        s.vz = (tz - s.z) * 3.2;
        s.life = Math.max(s.life, 0.6);
      }
      const x0 = s.x;
      const y0 = s.y;
      const z0 = s.z;
      const g0 = groundZ(this.world, x0, y0);
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.z += s.vz * dt;
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
      remain.push(s);
    }
    this.shots = remain;
    this.syncShotSprites();
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
    if (objectHit) {
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
      this.spawnSparks(x, y, z + 3, {
        style: "ground",
        n: 26,
        spdMin: 40,
        spdMax: 280,
        bx: dx,
        by: dy,
        bz: Math.max(30, dz),
        tight: 0.58,
      });
    }
    const sy = y - screenLift(z);
    if (he) {
      this.spawnSparks(x, y, z + 10, {
        style: "object",
        n: 28,
        spdMin: 70,
        spdMax: 380,
        bx: 0,
        by: 0,
        bz: 1,
        tight: 0.15,
      });
      this.flame.setDepth(worldDepth(z, 2.4));
      this.burn.setDepth(worldDepth(z, 2.6));
      this.flame.emitParticleAt(x, sy, 26);
      this.burn.emitParticleAt(x, sy, 20);
      const flash = this.add.circle(x, sy, 10, 0xffe8a0, 0.85).setDepth(worldDepth(z, 2.8)).setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({
        targets: flash,
        radius: blast * 0.7,
        alpha: 0,
        duration: 220,
        onComplete: () => flash.destroy(),
      });
    }
    if (!water) {
      this.smoke.setDepth(worldDepth(z, 1));
      this.smoke.emitParticleAt(x, sy, he ? 16 : objectHit ? 6 : 8);
    }
    this.shake = Math.min(8, this.shake + blast * (he ? 0.055 : 0.028));
    const ring = this.add.circle(x, sy, 6, he ? 0xff9a40 : 0xffc878, he ? 0.85 : 0.55).setDepth(worldDepth(z, 2));
    if (he) ring.setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({
      targets: ring,
      radius: blast,
      alpha: 0,
      duration: he ? 380 : 240,
      onComplete: () => ring.destroy(),
    });
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

  hurt(u: Unit, dmg: number): void {
    u.health -= dmg;
    if (u.health <= 0) this.destroyUnit(u);
  }

  destroyUnit(u: Unit): void {
    if (u.dead) return;
    u.dead = true;
    this.spawnSparks(u.x, u.y, u.z + heightOf(u.kind) * 0.5, {
      style: "object",
      n: 26,
      spdMin: 70,
      spdMax: 340,
      bx: 0,
      by: 0,
      bz: 1,
      tight: 0.25,
    });
    this.smoke.setDepth(worldDepth(u.z, 1));
    this.smoke.emitParticleAt(u.x, u.y - screenLift(u.z), 16);
    this.shake = Math.min(10, this.shake + 3);
    const n = u.kind === "soldier" ? 4 : u.kind === "bunker" || u.kind === "radar" ? 16 : 10;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 55 + Math.random() * 200;
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
        key: this.textures.exists(FRAG_KEYS[i % FRAG_KEYS.length]!)
          ? FRAG_KEYS[i % FRAG_KEYS.length]!
          : "frag_metal",
        settled: false,
        gravity: true,
        bounces: Math.random() < 1 / 3 ? 2 + ((Math.random() * 2) | 0) : 0,
      });
    }
    if (u.kind !== "heli" && u.kind !== "boat") {
      const key = `blast_${(Math.random() * 4) | 0}`;
      let sc = (radius(u.kind) / 20) * (0.72 + Math.random() * 0.7);
      if (u.kind === "tank") sc *= 1.25;
      this.hulkG.add(
        this.add
          .image(u.x, u.y - screenLift(u.z), this.textures.exists(key) ? key : "blast_0")
          .setRotation(Math.random() * Math.PI * 2)
          .setScale(sc)
          .setAlpha(1)
          .setDepth(Layer.BLAST)
      );
    }
    if (u.kind === "tank") {
      const hullKey = this.textures.exists("hulk_tank_hull") ? "hulk_tank_hull" : hulkOf("tank");
      this.hulkG.add(
        this.add
          .image(u.x, u.y - screenLift(u.z), hullKey)
          .setRotation(u.angle + Math.PI / 2)
          .setDepth(Layer.HULK)
          .setAlpha(0.95)
      );
      const a = Math.random() * Math.PI * 2;
      const throwSp = 90 + Math.random() * 110;
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
        key: this.textures.exists("hulk_tank_turret") ? "hulk_tank_turret" : "tank_turret",
        settled: false,
        gravity: true,
        bounces: Math.random() < 1 / 3 ? 2 + ((Math.random() * 2) | 0) : 0,
      });
    } else {
      this.hulkG.add(
        this.add
          .image(u.x, u.y - screenLift(u.z), this.textures.exists(hulkOf(u.kind)) ? hulkOf(u.kind) : "hulk_crater")
          .setRotation(u.angle + Math.PI / 2)
          .setDepth(Layer.HULK)
          .setAlpha(0.95)
      );
    }
  }

  updateFrags(dt: number): void {
    for (const f of this.frags) {
      if (f.settled) continue;
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
        if (!f.settled && f.z > groundZ(this.world, f.x, f.y) + 2) {
          const px = f.x;
          const py = f.y - screenLift(f.z);
          this.burn.setDepth(worldDepth(f.z, 0.6));
          this.fragSmoke.setDepth(worldDepth(f.z, 0.8));
          if (Math.random() < 0.7) this.burn.emitParticleAt(px, py, 1);
          if (Math.random() < 0.5) this.fragSmoke.emitParticleAt(px, py, 1);
        }
        const g = groundZ(this.world, f.x, f.y);
        if (f.z <= g) {
          f.z = g;
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
            f.settled = true;
            f.vx = 0;
            f.vy = 0;
            f.vz = 0;
          }
        }
      } else {
        f.vx *= Math.pow(0.08, dt);
        f.vy *= Math.pow(0.08, dt);
        f.life -= dt;
        if (f.life <= 0 || Math.hypot(f.vx, f.vy) < 8) {
          f.settled = true;
          f.vx = 0;
          f.vy = 0;
        }
      }
    }
    this.syncFragSprites();
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
            this.trackG.add(
              this.add
                .image(u.x, u.y - screenLift(groundZ(this.world, u.x, u.y)), "track")
                .setRotation(u.angle + Math.PI / 2)
                .setDepth(Layer.TRACK)
                .setAlpha(0.4)
            );
          }
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
        this.spawnShot({
          kind: "cannon",
          from: "enemy",
          x: u.x,
          y: u.y,
          z: muzzleZ,
          vx: (tx - u.x) / t,
          vy: (ty - u.y) / t,
          vz: (tgtZ - muzzleZ) / t,
          angle: u.kind === "tank" ? u.turret : Math.atan2(ty - u.y, tx - u.x),
          life: t + 0.12,
          blast: 16,
          dmg: u.kind === "tower" ? 12 : 8,
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
      const rot = u.kind === "soldier" ? 0 : u.angle + Math.PI / 2;
      const lift = screenLift(u.z);
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
          1 + Phaser.Math.Clamp(Math.abs(sl.dx), 0, 0.4) * 0.22,
          1 - Phaser.Math.Clamp(sl.dy, -0.45, 0.45) * 0.2
        );
      } else im.setScale(1);
      if (u.kind === "heli") {
        extra
          .setVisible(true)
          .setTexture("enemy_rotor")
          .setOrigin(0.5, 0.5)
          .setPosition(im.x, im.y)
          .setRotation(u.rotor)
          .setScale(108 / extra.width)
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
          ? "cannon"
          : s.kind === "rocket"
            ? "rocket"
            : s.kind === "hellfire"
              ? "hellfire"
              : "tow";
      const rot = s.kind === "cannon" ? s.angle : s.angle + Math.PI / 2;
      sh.setVisible(true);
      this.applyCastShadow(sh, s.x, s.y, s.z, key, rot);
      im.setVisible(true)
        .setTexture(key)
        .setPosition(s.x, s.y - screenLift(s.z))
        .setRotation(rot)
        .setDepth(worldDepth(s.z));
    });
  }

  syncFragSprites(): void {
    while (this.fragG.getLength() < this.frags.length * 2) {
      this.fragG.add(this.add.image(0, 0, "shadow"));
      this.fragG.add(this.add.image(0, 0, "frag_metal"));
    }
    const kids = this.fragG.getChildren() as Phaser.GameObjects.Image[];
    for (const k of kids) k.setVisible(false);
    this.frags.forEach((f, i) => {
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
      sh.setVisible(true).setOrigin(ox, oy);
      this.applyCastShadow(sh, f.x, f.y, z, f.key, f.angle);
      if (castZ(this.world, f.x, f.y, z) < 1) sh.setAlpha(0.22);
      im.setVisible(true)
        .setTexture(f.key)
        .setOrigin(ox, oy)
        .setPosition(f.x, f.y - screenLift(z))
        .setRotation(f.angle)
        .setDepth(f.settled ? Layer.HULK : worldDepth(z))
        .setAlpha(f.settled ? 0.92 : 1);
    });
  }

  updateLock(): void {
    const h = this.heli;
    if (h.weapon !== 2 || !h.hellfireLock) {
      this.lockSpr.setVisible(false);
      return;
    }
    const u = this.units.find((q) => q.id === h.hellfireLock!.id && !q.dead);
    if (!u) {
      this.lockSpr.setVisible(false);
      return;
    }
    this.lockSpr.setVisible(true).setPosition(u.x, u.y - 8 - screenLift(u.z));
    this.lockSpr.setAlpha(h.hellfireLock.t > 0.45 ? 1 : 0.4 + (this.time.now % 200) / 400);
  }

  worldPointer(): { x: number; y: number } {
    const p = this.input.activePointer;
    const pt = this.cameras.main.getWorldPoint(p.x, p.y);
    return { x: pt.x, y: pt.y };
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
    this.hud.setText(
      `ALT ${castZ(this.world, h.x, h.y, h.z) | 0}   SPD ${Math.hypot(h.vx, h.vy) | 0}   TIME ${this.timeScale.toFixed(2)}×\n${phase}\nWPN ${w.name}  ${ammoS}`
    );

    const lines = this.world.hv.map((spec) => this.hvLine(spec));
    const left = lines.filter((l) => !l.done).length;
    this.hvHud.setText(
      `HV TARGETS  ${this.world.hv.length - left}/${this.world.hv.length}\n` +
        lines.map((l) => l.text).join("\n")
    );
    this.wpnHud.setText(
      WPN_LIST.map((wp, i) => {
        const a = this.ammo[i]!;
        const mark = i === h.weapon ? ">" : " ";
        const ammoS2 = Number.isFinite(a) ? String(a) : "∞";
        return `${mark}${i + 1} ${wp.name} ${ammoS2}`;
      }).join("    ")
    );
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
    this.miniTerrain.setPosition(
      cx - (this.heli.x - WORLD / 2) * s,
      cy - (this.heli.y - WORLD / 2) * s
    );
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
    this.hvGfx.setScrollFactor(0);
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
    const s = this.timeScale;
    this.time.timeScale = s;
    this.tweens.timeScale = s;
    for (const em of [this.smoke, this.tracer, this.flame, this.hurtSmoke, this.burn, this.fragSmoke]) {
      if (em) em.timeScale = s;
    }
  }

  playZoom(): number {
    const spdN = Phaser.Math.Clamp(Math.hypot(this.heli.vx, this.heli.vy) / 340, 0, 1);
    const zNorm = Phaser.Math.Clamp(castZ(this.world, this.heli.x, this.heli.y, this.heli.z) / MAX_Z, 0, 1);
    return Phaser.Math.Linear(1.05, 0.7, spdN * 0.75 + zNorm * 0.25);
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
    this.cameras.main.setZoom(Phaser.Math.Linear(this.playZoom(), this.theaterZoom(), ease));

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
      this.bore.setVisible(false);
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
    this.playerHud.setVisible(on);
    this.miniGfx.setVisible(on);
    this.miniBg.setVisible(on);
    this.miniTerrain.setVisible(on);
    this.hpGfx.setVisible(on);
    if (on) {
      this.reticle.setVisible(true);
      this.bore.setVisible(true);
    } else {
      this.reticle.setVisible(false);
      this.bore.setVisible(false);
      this.lockSpr.setVisible(false);
      this.playerHud.clear();
      this.miniGfx.clear();
    }
  }

  drawMapOverlay(): void {
    this.hvGfx.clear();
    this.hvGfx.setScrollFactor(1);
    const g = this.hvGfx;
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
    g.fillStyle(0xe8b84a, 1);
    g.fillCircle(this.heli.x, this.heli.y, u(5));
  }

  drawUnitBars(): void {
    const g = this.hpGfx;
    g.clear();
    g.setDepth(Layer.FIELD);
    for (const u of this.units) {
      if (u.dead || u.health >= u.max - 0.5) continue;
      const w = u.kind === "soldier" ? 16 : 32;
      const ratio = Phaser.Math.Clamp(u.health / u.max, 0, 1);
      const x = u.x - w / 2;
      const y = u.y - screenLift(u.z) - heightOf(u.kind) * 0.35 - 14;
      g.fillStyle(0x10100c, 0.7);
      g.fillRect(x, y, w, 4);
      g.fillStyle(ratio > 0.5 ? 0x6dbb4a : ratio > 0.25 ? 0xe8b84a : 0xff4a2a, 1);
      g.fillRect(x, y, w * ratio, 4);
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
      h.dmgSites.push({
        f: (Math.random() - 0.5) * 40,
        s: (Math.random() - 0.5) * 16,
      });
    }
    if (!want) return;
    const lift = screenLift(h.z);
    const ca = Math.cos(h.angle);
    const sa = Math.sin(h.angle);
    const dmgDepth = worldDepth(h.z, ZOff.dmg);
    this.flame.setDepth(dmgDepth);
    this.hurtSmoke.setDepth(dmgDepth);
    for (const s of h.dmgSites) {
      const x = h.x + ca * s.f - sa * s.s;
      const y = h.y + sa * s.f + ca * s.s - lift;
      if (Math.random() < 0.45) this.flame.emitParticleAt(x, y, 1);
      if (Math.random() < 0.4) this.hurtSmoke.emitParticleAt(x, y, 1);
    }
  }

  end(win: boolean): void {
    if (this.over) return;
    this.over = true;
    this.win = win;
    const msg = win ? "MISSION COMPLETE" : "BIRD DOWN";
    this.add
      .text(this.scale.width / 2, this.scale.height / 2, `${msg}\nR  RESTART`, {
        fontFamily: "Black Ops One, Impact, sans-serif",
        fontSize: "42px",
        color: win ? "#e8b84a" : "#ff6a3a",
        align: "center",
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(Layer.HUD + 50);
  }
}

function pickSparkKind(style: "muzzle" | "ground" | "water" | "object"): SparkKind {
  if (style === "water") return "splash";
  if (style === "object" || style === "muzzle") return "flame";
  return Math.random() < 0.18 ? "spark" : "dirt";
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

function sparkLook(kind: SparkKind, biome: Biome): { tint: number; add: boolean } {
  if (kind === "flame") {
    return { tint: Math.random() < 0.45 ? 0xff4a12 : 0xff8a28, add: true };
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
