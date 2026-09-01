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
  type Unit,
} from "./combat";
import { CRUISE_Z, Heli, MAX_Z } from "./heli";
import { preloadArt, prepareArt, shadowAlpha, shadowKey, shadowOff, tankLayout } from "./sprites";
import {
  generateWorld,
  groundZ,
  isWater,
  paintHeightMap,
  SCALE,
  WORLD,
  type HvSpec,
  type WorldData,
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
        "WASD / ARROWS  thrust & strafe\nMOUSE  turn  ·  CLICK  fire  ·  1-4 / WHEEL  weapons\nSPACE  pop-up altitude  ·  M  theater map  ·  K  heightmap\n+ / -  time scale",
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
  ammo = WPN_LIST.map((w) => w.ammo);
  cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  keyW!: Phaser.Input.Keyboard.Key;
  keyA!: Phaser.Input.Keyboard.Key;
  keyS!: Phaser.Input.Keyboard.Key;
  keyD!: Phaser.Input.Keyboard.Key;
  keySpace!: Phaser.Input.Keyboard.Key;
  ground!: Phaser.GameObjects.Image;
  body!: Phaser.GameObjects.Image;
  rotor!: Phaser.GameObjects.Image;
  gun!: Phaser.GameObjects.Image;
  shadow!: Phaser.GameObjects.Image;
  reticle!: Phaser.GameObjects.Image;
  lockSpr!: Phaser.GameObjects.Image;
  unitG!: Phaser.GameObjects.Group;
  shotG!: Phaser.GameObjects.Group;
  fragG!: Phaser.GameObjects.Group;
  trackG!: Phaser.GameObjects.Group;
  hulkG!: Phaser.GameObjects.Group;
  fx!: Phaser.GameObjects.Particles.ParticleEmitter;
  spark!: Phaser.GameObjects.Particles.ParticleEmitter;
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
    this.ground.setDisplaySize(WORLD, WORLD).setDepth(0);

    this.unitG = this.add.group();
    this.shotG = this.add.group();
    this.fragG = this.add.group();
    this.trackG = this.add.group();
    this.hulkG = this.add.group();

    this.heli = new Heli(this.world.spawnX, this.world.spawnY, this.world);
    this.heli.angle = 0.6;
    this.shadow = this.add.image(0, 0, "shadow").setDepth(2);
    this.gun = this.add.image(0, 0, "heli_gun").setDepth(18).setOrigin(0.5, 0.82);
    this.body = this.add.image(0, 0, "heli_body").setDepth(20);
    this.rotor = this.add.image(0, 0, "heli_rotor").setDepth(22);
    this.muzzle = this.add.image(0, 0, "muzzle").setDepth(19).setVisible(false).setScale(0.55);
    this.body.setPosition(this.heli.x, this.heli.y);
    this.reticle = this.add.image(0, 0, "reticle").setDepth(80).setScrollFactor(0);
    this.lockSpr = this.add.image(0, 0, "lock").setDepth(81).setVisible(false);

    this.units = [];
    for (const s of this.world.spawns) {
      const st = stats(s.kind);
      this.units.push({
        id: nextId(),
        kind: s.kind,
        x: s.x,
        y: s.y,
        z: st.z,
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

    this.fx = this.add.particles(0, 0, "spark", {
      lifespan: 520,
      speed: { min: 40, max: 280 },
      scale: { start: 1.6, end: 0 },
      alpha: { start: 1, end: 0 },
      emitting: false,
    });
    this.fx.setDepth(40);
    this.spark = this.add.particles(0, 0, "spark", {
      lifespan: 320,
      speed: { min: 90, max: 420 },
      scale: { start: 1.1, end: 0 },
      emitting: false,
    });
    this.spark.setDepth(41);
    this.smoke = this.add.particles(0, 0, "smoke", {
      lifespan: 900,
      speed: { min: 10, max: 70 },
      scale: { start: 0.6, end: 2.4 },
      alpha: { start: 0.55, end: 0 },
      emitting: false,
    });
    this.smoke.setDepth(38);
    this.tracer = this.add.particles(0, 0, "spark", {
      lifespan: 160,
      speed: { min: 40, max: 140 },
      scale: { start: 0.7, end: 0 },
      alpha: { start: 1, end: 0 },
      emitting: false,
    });
    this.tracer.setDepth(19);
    this.flame = this.add.particles(0, 0, "flame", {
      lifespan: 420,
      speed: { min: 8, max: 40 },
      scale: { start: 0.7, end: 0.1 },
      alpha: { start: 0.9, end: 0 },
      emitting: false,
    });
    this.flame.setDepth(21);
    this.hurtSmoke = this.add.particles(0, 0, "smoke", {
      lifespan: 700,
      speed: { min: 6, max: 28 },
      scale: { start: 0.4, end: 1.3 },
      alpha: { start: 0.5, end: 0 },
      emitting: false,
    });
    this.hurtSmoke.setDepth(21);
    this.burn = this.add.particles(0, 0, "flame", {
      lifespan: 280,
      speed: { min: 6, max: 28 },
      scale: { start: 0.55, end: 0.08 },
      alpha: { start: 0.95, end: 0 },
      emitting: false,
    });
    this.burn.setDepth(50);
    this.fragSmoke = this.add.particles(0, 0, "smoke", {
      lifespan: 520,
      speed: { min: 8, max: 36 },
      scale: { start: 0.35, end: 1.4 },
      alpha: { start: 0.5, end: 0 },
      emitting: false,
    });
    this.fragSmoke.setDepth(48);
    this.applyTimeScale();

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.keyW = this.input.keyboard!.addKey("W");
    this.keyA = this.input.keyboard!.addKey("A");
    this.keyS = this.input.keyboard!.addKey("S");
    this.keyD = this.input.keyboard!.addKey("D");
    this.keySpace = this.input.keyboard!.addKey("SPACE");
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
    this.input.on("wheel", (_p: Phaser.Input.Pointer, _dx: number, dy: number) => {
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
      .setDepth(100);
    this.hvHud = this.add
      .text(this.scale.width - 16, 12, "", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "13px",
        color: "#f0e6c8",
        align: "right",
      })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(100);
    this.wpnHud = this.add
      .text(this.scale.width / 2, this.scale.height - 18, "", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "13px",
        color: "#e8b84a",
        align: "center",
      })
      .setOrigin(0.5, 1)
      .setScrollFactor(0)
      .setDepth(100);
    this.hpGfx = this.add.graphics().setDepth(50);
    this.playerHud = this.add.graphics().setScrollFactor(0).setDepth(110);
    this.mapLabel = this.add
      .text(this.scale.width / 2, this.scale.height - 48, "", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "16px",
        color: "#e8b84a",
      })
      .setOrigin(0.5, 1)
      .setScrollFactor(0)
      .setDepth(120)
      .setVisible(false);

    this.miniGfx = this.add.graphics().setScrollFactor(0).setDepth(101);
    this.hvGfx = this.add.graphics().setScrollFactor(0).setDepth(102);
    this.debugGfx = this.add.graphics().setDepth(95).setVisible(false);
    const cx = 18 + 88;
    const cy = this.scale.height - 18 - 88;
    const maskG = this.add.graphics().setScrollFactor(0);
    maskG.fillStyle(0xffffff);
    maskG.fillCircle(cx, cy, 88);
    this.miniBg = this.add.graphics().setScrollFactor(0).setDepth(99);
    this.miniBg.fillStyle(0x12100c, 1);
    this.miniBg.fillCircle(cx, cy, 90);
    this.miniTerrain = this.add.image(cx, cy, "terrain").setScrollFactor(0).setDepth(100);
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
      this.keySpace.isDown
    );

    this.syncHeliGfx();
    this.handleFire(dt);
    this.updateUnits(dt);
    this.updateShots(dt);
    this.updateFrags(dt);
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

  syncHeliGfx(): void {
    const h = this.heli;
    const so = shadowOff(h.z);
    const shKey = this.textures.exists(shadowKey("heli_body", h.z))
      ? shadowKey("heli_body", h.z)
      : "shadow";
    this.shadow.setTexture(shKey);
    this.shadow.setPosition(h.x + so.x, h.y + so.y);
    this.shadow.setRotation(h.angle + Math.PI / 2);
    this.shadow.setAlpha(shadowAlpha(h.z));
    this.shadow.setScale(1 + h.z * 0.004);
    const lift = h.z * 0.05;
    const ca = Math.cos(h.angle);
    const sa = Math.sin(h.angle);
    this.body.setPosition(h.x, h.y - lift);
    const rOffF = h.pitch * 16;
    const rOffS = h.roll * 14;
    this.rotor.setPosition(
      h.x + ca * rOffF - sa * rOffS,
      h.y - lift - 8 + sa * rOffF + ca * rOffS
    );
    const gOffF = -h.pitch * 11;
    const gOffS = -h.roll * 10;
    this.gun.setPosition(
      h.noseX + ca * gOffF - sa * gOffS,
      h.noseY - lift + 3 + sa * gOffF + ca * gOffS
    );
    this.body.setRotation(h.angle + Math.PI / 2);
    this.rotor.setRotation(h.rotor);
    this.gun.setRotation(h.gunAngle + Math.PI / 2);
    const sx = 1 + Math.abs(h.roll) * 0.12;
    const sy = 1 - Math.abs(h.pitch) * 0.14;
    this.body.setScale(sx, sy);
    this.rotor.setScale(1.08, 1.08);
    this.rotor.setAlpha(h.rotorSpd > 24 ? 0.72 : 1);
    this.body.setDepth(20 + h.z);
    this.rotor.setDepth(22 + h.z);
    this.gun.setDepth(18 + h.z);
    this.muzzle.setDepth(19 + h.z);
    const p = this.input.activePointer;
    this.reticle.setPosition(p.x, p.y);
    if (h.phase === "spool" || h.phase === "liftoff") {
      if (Math.random() < 0.5)
        this.smoke.emitParticleAt(h.x + (Math.random() - 0.5) * 28, h.y + so.y, 1);
    }
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
        tz = air.z + heightOf(air.kind) * 0.45;
      } else {
        const aim = aimPast(
          h.x,
          h.y,
          ptr.x + (Math.random() - 0.5) * 18,
          ptr.y + (Math.random() - 0.5) * 18,
          78
        );
        tx = aim.x;
        ty = aim.y;
        tz = groundZ(this.world, tx, ty);
      }
      const tip = this.gunTip();
      const dist = Math.hypot(tx - tip.x, ty - tip.y);
      const t = Math.max(0.12, dist / spd);
      this.spawnShot({
        kind: "cannon",
        from: "player",
        x: tip.x,
        y: tip.y,
        z: h.z - 4,
        vx: (tx - tip.x) / t,
        vy: (ty - tip.y) / t,
        vz: (tz - (h.z - 4)) / t,
        angle: ang,
        life: t + (air ? 0.55 : 0.2),
        blast: 18,
        dmg: 14,
      });
      this.spark.emitParticleAt(tip.x, tip.y, 2);
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
      const dist = Math.max(80, along + (air ? 0 : 90));
      const t = dist / 620;
      const tz = air ? air.z + heightOf(air.kind) * 0.4 : 0;
      this.spawnShot({
        kind: "rocket",
        from: "player",
        x: px,
        y: py,
        z: h.z,
        vx: Math.cos(h.angle) * 620,
        vy: Math.sin(h.angle) * 620,
        vz: (tz - h.z) / t,
        angle: h.angle,
        life: t + 0.35,
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
          z: h.z + 6,
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
        z: h.z,
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
        s.vz = ((u ? u.z : 0) - s.z) * 2;
      }
      if (s.guided) {
        const air = this.hoverAerial(ptr.x, ptr.y);
        const want = Math.atan2(ptr.y - s.y, ptr.x - s.x);
        const da = Phaser.Math.Angle.Wrap(want - s.angle);
        s.angle += Phaser.Math.Clamp(da, -2.2 * dt, 2.2 * dt);
        const spd = 300;
        s.vx = Math.cos(s.angle) * spd;
        s.vy = Math.sin(s.angle) * spd;
        const tz = air ? air.z + heightOf(air.kind) * 0.4 : 0;
        const dist = Math.hypot(ptr.x - s.x, ptr.y - s.y);
        s.vz = (tz - s.z) / Math.max(0.2, dist / spd);
      }
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.z += s.vz * dt;
      s.life -= dt;
      const g = groundZ(this.world, s.x, s.y);
      let hit = s.z <= g || s.life <= 0;
      let victim: Unit | undefined;
      if (
        s.from === "enemy" &&
        Math.hypot(s.x - this.heli.x, s.y - this.heli.y) < 26 &&
        s.z < this.heli.z + 14 &&
        s.z > this.heli.z - 8 &&
        this.heli.phase === "flight"
      ) {
        this.heli.damage(s.dmg * 0.65);
        hit = true;
        this.spark.emitParticleAt(this.heli.x, this.heli.y, 10);
      }
      if (s.from === "player") {
        for (const u of this.units) {
          if (u.dead) continue;
          if (Math.hypot(u.x - s.x, u.y - s.y) > radius(u.kind) + 8) continue;
          const top = u.z + heightOf(u.kind);
          if (s.z > top + 2) continue;
          if (s.z < u.z - 6) continue;
          hit = true;
          victim = u;
          break;
        }
      }
      if (hit) {
        this.explode(s.x, s.y, s.blast, s.dmg, victim);
      } else remain.push(s);
    }
    this.shots = remain;
    this.syncShotSprites();
  }

  explode(x: number, y: number, blast: number, dmg: number, direct?: Unit): void {
    this.fx.emitParticleAt(x, y, 22);
    this.spark.emitParticleAt(x, y, 34);
    this.smoke.emitParticleAt(x, y, 10);
    this.shake = Math.min(8, this.shake + blast * 0.04);
    const ring = this.add.circle(x, y, 6, 0xffc878, 0.7).setDepth(39);
    this.tweens.add({
      targets: ring,
      radius: blast,
      alpha: 0,
      duration: 280,
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
    if (hd < blast * 0.55 && this.heli.z < 30) this.heli.damage(dmg * 0.25);
  }

  hurt(u: Unit, dmg: number): void {
    u.health -= dmg;
    if (u.health <= 0) this.destroyUnit(u);
  }

  destroyUnit(u: Unit): void {
    if (u.dead) return;
    u.dead = true;
    this.fx.emitParticleAt(u.x, u.y, 36);
    this.spark.emitParticleAt(u.x, u.y, 48);
    this.smoke.emitParticleAt(u.x, u.y, 16);
    this.shake = Math.min(10, this.shake + 3);
    const n = u.kind === "soldier" ? 4 : u.kind === "bunker" || u.kind === "radar" ? 16 : 10;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 55 + Math.random() * 200;
      this.frags.push({
        x: u.x,
        y: u.y,
        z: 8 + Math.random() * 14,
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
      });
    }
    if (u.kind !== "heli" && u.kind !== "boat") {
      const key = `blast_${(Math.random() * 4) | 0}`;
      const sc = (radius(u.kind) / 20) * (0.72 + Math.random() * 0.7);
      this.hulkG.add(
        this.add
          .image(u.x, u.y, this.textures.exists(key) ? key : "blast_0")
          .setRotation(Math.random() * Math.PI * 2)
          .setScale(sc)
          .setAlpha(1)
          .setDepth(3)
      );
    }
    if (u.kind === "tank") {
      const hullKey = this.textures.exists("hulk_tank_hull") ? "hulk_tank_hull" : hulkOf("tank");
      this.hulkG.add(
        this.add
          .image(u.x, u.y, hullKey)
          .setRotation(u.angle + Math.PI / 2)
          .setDepth(4)
          .setAlpha(0.95)
      );
      const a = Math.random() * Math.PI * 2;
      const throwSp = 90 + Math.random() * 110;
      this.frags.push({
        x: u.x,
        y: u.y,
        z: 18,
        vx: Math.cos(a) * throwSp,
        vy: Math.sin(a) * throwSp,
        vz: 190 + Math.random() * 80,
        angle: u.turret + Math.PI / 2,
        spin: (Math.random() - 0.5) * 10,
        life: 5,
        key: this.textures.exists("hulk_tank_turret") ? "hulk_tank_turret" : "tank_turret",
        settled: false,
        gravity: true,
      });
    } else {
      this.hulkG.add(
        this.add
          .image(u.x, u.y, this.textures.exists(hulkOf(u.kind)) ? hulkOf(u.kind) : "hulk_crater")
          .setRotation(u.angle + Math.PI / 2)
          .setDepth(4)
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
        if (!f.settled && f.z > 2) {
          const px = f.x;
          const py = f.y - f.z * 0.05;
          if (Math.random() < 0.7) this.burn.emitParticleAt(px, py, 1);
          if (Math.random() < 0.5) this.fragSmoke.emitParticleAt(px, py, 1);
        }
        if (f.z <= 0) {
          f.z = 0;
          f.settled = true;
          f.vx = 0;
          f.vy = 0;
          f.vz = 0;
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
        u.z = CRUISE_Z + 10 + Math.sin(this.time.now * 0.002 + u.id) * 6;
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
      }
      if (u.kind === "boat" && isWater(this.world, u.x, u.y)) {
        u.angle += dt * 0.15;
        u.x += Math.cos(u.angle) * 18 * dt;
        u.y += Math.sin(u.angle) * 18 * dt;
      }
      if (u.kind === "tank" && dist < 900 && dist > 120) {
        const want = Math.atan2(dy, dx);
        u.angle = Phaser.Math.Angle.RotateTo(u.angle, want, 1.1 * dt);
        const step = 28 * dt;
        u.x += Math.cos(u.angle) * step;
        u.y += Math.sin(u.angle) * step;
        u.track += step;
        if (u.track > 16) {
          u.track = 0;
          this.trackG.add(
            this.add
              .image(u.x, u.y, "track")
              .setRotation(u.angle + Math.PI / 2)
              .setDepth(3)
              .setAlpha(0.4)
          );
        }
      }
      if (u.kind === "tank") {
        u.turret = Phaser.Math.Angle.RotateTo(u.turret, Math.atan2(dy, dx), 2.4 * dt);
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
        this.spawnShot({
          kind: "cannon",
          from: "enemy",
          x: u.x,
          y: u.y,
          z: u.z + heightOf(u.kind) * 0.7,
          vx: (tx - u.x) / t,
          vy: (ty - u.y) / t,
          vz: (h.z - u.z) / t,
          angle: u.kind === "tank" ? u.turret : Math.atan2(ty - u.y, tx - u.x),
          life: t + 0.2,
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
      const aerial = u.kind === "heli" || u.z > 4;
      const tex = textureOf(u.kind);
      const so = shadowOff(aerial ? u.z : 6);
      const sk = this.textures.exists(shadowKey(tex, aerial ? u.z : 8))
        ? shadowKey(tex, aerial ? u.z : 8)
        : "shadow";
      sh.setVisible(true).setTexture(sk);
      sh.setPosition(u.x + so.x, u.y + so.y);
      sh.setRotation(u.kind === "soldier" ? 0 : u.angle + Math.PI / 2);
      sh.setAlpha(shadowAlpha(aerial ? u.z : 8)).setScale(aerial ? 1 : 0.92).setDepth(2);
      im.setVisible(true)
        .setTexture(tex)
        .setPosition(u.x, u.y - u.z * 0.05)
        .setRotation(u.kind === "soldier" ? 0 : u.angle + Math.PI / 2)
        .setDepth(10 + u.z);
      if (u.kind === "heli") {
        extra
          .setVisible(true)
          .setTexture("enemy_rotor")
          .setOrigin(0.5, 0.5)
          .setPosition(u.x, u.y - u.z * 0.05 - 6)
          .setRotation(u.rotor)
          .setAlpha(1)
          .setDepth(11 + u.z);
      } else if (u.kind === "tank") {
        const rot = u.angle + Math.PI / 2;
        const mx = (tankLayout.mountOrigin.x - 0.5) * im.displayWidth;
        const my = (tankLayout.mountOrigin.y - 0.5) * im.displayHeight;
        extra
          .setVisible(true)
          .setTexture("tank_turret")
          .setOrigin(tankLayout.turretOrigin.x, tankLayout.turretOrigin.y)
          .setPosition(im.x + mx * Math.cos(rot) - my * Math.sin(rot), im.y + mx * Math.sin(rot) + my * Math.cos(rot))
          .setRotation(u.turret + Math.PI / 2)
          .setAlpha(1)
          .setDepth(11);
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
      const so = shadowOff(s.z);
      const sk = this.textures.exists(shadowKey(key, s.z)) ? shadowKey(key, s.z) : "shadow";
      const rot = s.kind === "cannon" ? s.angle : s.angle + Math.PI / 2;
      sh.setVisible(true)
        .setTexture(sk)
        .setPosition(s.x + so.x, s.y + so.y)
        .setRotation(rot)
        .setScale(1)
        .setAlpha(shadowAlpha(s.z))
        .setDepth(3);
      im.setVisible(true)
        .setTexture(key)
        .setPosition(s.x, s.y - s.z * 0.05)
        .setRotation(rot)
        .setDepth(30 + s.z);
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
      const so = shadowOff(z);
      const sk = this.textures.exists(shadowKey(f.key, z)) ? shadowKey(f.key, z) : "shadow";
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
      sh.setVisible(true)
        .setTexture(sk)
        .setOrigin(ox, oy)
        .setPosition(f.x + so.x, f.y + so.y)
        .setRotation(f.angle)
        .setAlpha(z < 1 ? 0.22 : shadowAlpha(z))
        .setDepth(2);
      im.setVisible(true)
        .setTexture(f.key)
        .setOrigin(ox, oy)
        .setPosition(f.x, f.y - z * 0.05)
        .setRotation(f.angle)
        .setDepth(f.settled ? 4 : 15 + z)
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
    this.lockSpr.setVisible(true).setPosition(u.x, u.y - 8);
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
      if (u.kind !== "heli" && u.z < 22) continue;
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
      `ALT ${h.z | 0}   SPD ${Math.hypot(h.vx, h.vy) | 0}   TIME ${this.timeScale.toFixed(2)}×\n${phase}\nWPN ${w.name}  ${ammoS}`
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
    const draw = (x: number, y: number, r: number, hgt: number, z: number) => {
      this.debugGfx.lineStyle(1.25, 0x5ec8ff, 0.9);
      this.debugGfx.strokeCircle(x, y, r);
      this.debugGfx.lineStyle(2, 0x6dbb4a, 0.95);
      this.debugGfx.lineBetween(x, y, x, y - hgt);
      if (z > 0.5) {
        this.debugGfx.lineStyle(2, 0xff5a3a, 0.95);
        this.debugGfx.lineBetween(x, y, x, y + z);
      }
    };
    const gnd = groundZ(this.world, this.heli.x, this.heli.y);
    draw(this.heli.x, this.heli.y, 24, 14, Math.max(0, this.heli.z - gnd));
    for (const u of this.units) {
      if (u.dead) continue;
      draw(u.x, u.y, radius(u.kind), heightOf(u.kind), u.z);
    }
    this.debugGfx.lineStyle(1, 0xffd36a, 0.7);
    for (const s of this.shots) {
      this.debugGfx.strokeCircle(s.x, s.y, 5);
      this.debugGfx.lineStyle(2, 0xff5a3a, 0.95);
      this.debugGfx.lineBetween(s.x, s.y, s.x, s.y + s.z);
      this.debugGfx.lineStyle(1, 0xffd36a, 0.7);
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
    for (const em of [this.fx, this.spark, this.smoke, this.tracer, this.flame, this.hurtSmoke, this.burn, this.fragSmoke]) {
      if (em) em.timeScale = s;
    }
  }

  playZoom(): number {
    const spdN = Phaser.Math.Clamp(Math.hypot(this.heli.vx, this.heli.vy) / 340, 0, 1);
    const zNorm = Phaser.Math.Clamp((this.heli.z - 8) / MAX_Z, 0, 1);
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
    if (on) this.reticle.setVisible(true);
    else {
      this.reticle.setVisible(false);
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
    this.hpGfx.clear();
    for (const u of this.units) {
      if (u.dead || u.health >= u.max - 0.5) continue;
      const w = u.kind === "soldier" ? 16 : 32;
      const ratio = Phaser.Math.Clamp(u.health / u.max, 0, 1);
      const x = u.x - w / 2;
      const y = u.y - 20 - u.z * 0.05;
      this.hpGfx.fillStyle(0x10100c, 0.7);
      this.hpGfx.fillRect(x, y, w, 4);
      this.hpGfx.fillStyle(ratio > 0.5 ? 0x6dbb4a : ratio > 0.25 ? 0xe8b84a : 0xff4a2a, 1);
      this.hpGfx.fillRect(x, y, w * ratio, 4);
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
    const lift = h.z * 0.05;
    const ca = Math.cos(h.angle);
    const sa = Math.sin(h.angle);
    const dmgDepth = 21 + h.z;
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
      .setDepth(200);
  }
}

function aimPast(
  x: number,
  y: number,
  tx: number,
  ty: number,
  extra: number
): { x: number; y: number } {
  const dx = tx - x;
  const dy = ty - y;
  const d = Math.hypot(dx, dy) || 1;
  return { x: tx + (dx / d) * extra, y: ty + (dy / d) * extra };
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
