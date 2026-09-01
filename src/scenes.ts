import Phaser from "phaser";
import { bakeAll } from "./bake";
import {
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
import { preloadArt, prepareArt } from "./sprites";
import {
  generateWorld,
  groundZ,
  isWater,
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
        "WASD / ARROWS  thrust & strafe\nMOUSE  turn  ·  CLICK  fire  ·  1-4 / WHEEL  weapons\nSPACE  pop-up altitude",
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
  fx!: Phaser.GameObjects.Particles.ParticleEmitter;
  spark!: Phaser.GameObjects.Particles.ParticleEmitter;
  smoke!: Phaser.GameObjects.Particles.ParticleEmitter;
  muzzle!: Phaser.GameObjects.Image;
  hud!: Phaser.GameObjects.Text;
  hvHud!: Phaser.GameObjects.Text;
  wpnHud!: Phaser.GameObjects.Text;
  miniGfx!: Phaser.GameObjects.Graphics;
  miniTerrain!: Phaser.GameObjects.Image;
  hvGfx!: Phaser.GameObjects.Graphics;
  over = false;
  win = false;
  shake = 0;
  canFire = false;

  constructor() {
    super("mission");
  }

  init(data: { world?: WorldData }): void {
    this.over = false;
    this.win = false;
    this.shake = 0;
    this.canFire = false;
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

    this.heli = new Heli(this.world.spawnX, this.world.spawnY, this.world);
    this.heli.angle = 0.6;
    this.shadow = this.add.image(0, 0, "shadow").setDepth(2);
    this.gun = this.add.image(0, 0, "heli_gun").setDepth(21);
    this.body = this.add.image(0, 0, "heli_body").setDepth(20);
    this.rotor = this.add.image(0, 0, "heli_rotor").setDepth(22);
    this.muzzle = this.add.image(0, 0, "muzzle").setDepth(24).setVisible(false);
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
        health: st.health,
        max: st.health,
        hv: s.hv,
        dead: false,
        fireCd: Math.random(),
        rotor: 0,
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
    this.input.keyboard!.addKey("R").on("down", () => {
      if (this.over) this.scene.start("load");
    });
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

    this.miniGfx = this.add.graphics().setScrollFactor(0).setDepth(101);
    this.hvGfx = this.add.graphics().setScrollFactor(0).setDepth(102);
    const cx = 18 + 88;
    const cy = this.scale.height - 18 - 88;
    const maskG = this.add.graphics().setScrollFactor(0);
    maskG.fillStyle(0xffffff);
    maskG.fillCircle(cx, cy, 88);
    this.miniTerrain = this.add.image(cx, cy, "terrain").setScrollFactor(0).setDepth(100);
    this.miniTerrain.setMask(maskG.createGeometryMask());
    maskG.setVisible(false);

    this.cameras.main.centerOn(this.heli.x, this.heli.y);
    this.cameras.main.startFollow(this.body, true, 0.12, 0.12);
    this.cameras.main.setDeadzone(80, 80);
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
    const dt = Math.min(dms / 1000, 0.05);
    if (this.over) {
      this.drawMinimap();
      return;
    }

    this.heli.update(
      dt,
      this.world,
      {
        up: this.cursors.up!.isDown || this.keyW.isDown,
        down: this.cursors.down!.isDown || this.keyS.isDown,
        left: this.cursors.left!.isDown || this.keyA.isDown,
        right: this.cursors.right!.isDown || this.keyD.isDown,
      },
      this.input.activePointer,
      this.keySpace.isDown
    );

    this.syncHeliGfx();
    this.handleFire(dt);
    this.updateUnits(dt);
    this.updateShots(dt);
    this.updateFrags(dt);
    this.updateLock();
    this.drawHud();
    this.drawMinimap();
    this.drawHvArrows();

    const zNorm = Phaser.Math.Clamp((this.heli.z - 8) / MAX_Z, 0, 1);
    this.cameras.main.setZoom(Phaser.Math.Linear(1.08, 0.84, zNorm));

    if (this.shake > 0) {
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
    const off = h.z * 0.42;
    this.shadow.setPosition(h.x + h.z * 0.08, h.y + off);
    this.shadow.setScale(0.55 + h.z * 0.012, 0.35 + h.z * 0.008);
    this.shadow.setAlpha(Phaser.Math.Clamp(0.55 - h.z * 0.002, 0.18, 0.55));
    const lift = h.z * 0.05;
    this.body.setPosition(h.x, h.y - lift);
    this.rotor.setPosition(h.x, h.y - lift - 4);
    this.gun.setPosition(h.x + Math.cos(h.angle) * 22, h.y + Math.sin(h.angle) * 22 - lift);
    this.body.setRotation(h.angle + Math.PI / 2);
    this.rotor.setRotation(h.rotor);
    this.gun.setRotation(h.gunAngle + Math.PI / 2);
    const sx = 1 + Math.abs(h.roll) * 0.12;
    const sy = 1 - Math.abs(h.pitch) * 0.18;
    this.body.setScale(sx, sy);
    this.rotor.setScale(sx * 1.05, sy * 1.05);
    this.rotor.setAlpha(h.rotorSpd < 4 ? 1 : h.rotorSpd > 22 ? 0.38 : 0.85);
    this.body.setDepth(20 + h.z);
    this.rotor.setDepth(22 + h.z);
    this.gun.setDepth(21 + h.z);
    this.muzzle.setDepth(24 + h.z);
    const p = this.input.activePointer;
    this.reticle.setPosition(p.x, p.y);
    if (h.phase === "spool" || h.phase === "liftoff") {
      if (Math.random() < 0.5)
        this.smoke.emitParticleAt(h.x + (Math.random() - 0.5) * 28, h.y + off, 1);
    }
    if (h.phase === "flight" && h.z < CRUISE_Z + groundZ(this.world, h.x, h.y) + 8) {
      if (Math.hypot(h.vx, h.vy) > 40 && Math.random() < 0.4) {
        this.fx.emitParticleAt(h.x + (Math.random() - 0.5) * 20, h.y + off, 1);
      }
    }
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
      const tx = ptr.x + (Math.random() - 0.5) * 28;
      const ty = ptr.y + (Math.random() - 0.5) * 28;
      const ang = h.gunAngle + spread;
      const dist = Math.hypot(tx - h.x, ty - h.y);
      const spd = 780;
      const t = Math.max(0.12, dist / spd);
      this.spawnShot({
        kind: "cannon",
        from: "player",
        x: h.noseX,
        y: h.noseY,
        z: h.z,
        vx: ((tx - h.x) / t) * 0.95,
        vy: ((ty - h.y) / t) * 0.95,
        vz: -h.z / t,
        angle: ang,
        life: t + 0.15,
        blast: 18,
        dmg: 14,
      });
      this.spark.emitParticleAt(h.noseX, h.noseY, 3);
      this.muzzle
        .setVisible(true)
        .setPosition(h.noseX, h.noseY - h.z * 0.05)
        .setRotation(h.gunAngle)
        .setAlpha(0.9);
      this.time.delayedCall(40, () => this.muzzle.setVisible(false));
    }

    if (wpn === "rocket" && down && h.fireCd <= 0 && this.ammo[1]! > 0) {
      h.fireCd = 0.22;
      this.ammo[1]!--;
      const side = this.ammo[1]! % 2 === 0 ? 1 : -1;
      const px = h.x + Math.cos(h.angle + Math.PI / 2) * 22 * side;
      const py = h.y + Math.sin(h.angle + Math.PI / 2) * 22 * side;
      const along = projectAlong(h.x, h.y, h.angle, ptr.x, ptr.y);
      const dist = Math.max(80, along);
      const t = dist / 620;
      this.spawnShot({
        kind: "rocket",
        from: "player",
        x: px,
        y: py,
        z: h.z,
        vx: Math.cos(h.angle) * 620,
        vy: Math.sin(h.angle) * 620,
        vz: -h.z / t,
        angle: h.angle,
        life: t + 0.2,
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
        const want = Math.atan2(ptr.y - s.y, ptr.x - s.x);
        const da = Phaser.Math.Angle.Wrap(want - s.angle);
        s.angle += Phaser.Math.Clamp(da, -2.2 * dt, 2.2 * dt);
        const spd = 300;
        s.vx = Math.cos(s.angle) * spd;
        s.vy = Math.sin(s.angle) * spd;
        const dist = Math.hypot(ptr.x - s.x, ptr.y - s.y);
        s.vz = -s.z / Math.max(0.2, dist / spd);
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
        Math.hypot(s.x - this.heli.x, s.y - this.heli.y) < 24 &&
        Math.abs(s.z - this.heli.z) < 22 &&
        this.heli.phase === "flight"
      ) {
        this.heli.damage(s.dmg * 0.65);
        hit = true;
        this.spark.emitParticleAt(this.heli.x, this.heli.y, 10);
      }
      if (s.from === "player") {
        for (const u of this.units) {
          if (u.dead) continue;
          const dz = Math.abs(s.z - u.z);
          if (dz > 28 && u.kind !== "heli") continue;
          if (Math.hypot(u.x - s.x, u.y - s.y) < radius(u.kind) + 8) {
            hit = true;
            victim = u;
            break;
          }
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
    const n = u.kind === "soldier" ? 4 : u.kind === "bunker" || u.kind === "radar" ? 18 : 10;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 40 + Math.random() * 180;
      this.frags.push({
        x: u.x,
        y: u.y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        angle: a,
        spin: (Math.random() - 0.5) * 8,
        life: 0.45 + Math.random() * 0.4,
        key: ["frag_metal", "frag_dark", "frag_sand"][i % 3]!,
        settled: false,
      });
    }
  }

  updateFrags(dt: number): void {
    for (const f of this.frags) {
      if (f.settled) continue;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.vx *= Math.pow(0.08, dt);
      f.vy *= Math.pow(0.08, dt);
      f.angle += f.spin * dt;
      f.life -= dt;
      if (f.life <= 0 || Math.hypot(f.vx, f.vy) < 8) {
        f.settled = true;
        f.vx = 0;
        f.vy = 0;
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
        u.angle = Math.atan2(dy, dx);
        u.x += Math.cos(u.angle) * 28 * dt;
        u.y += Math.sin(u.angle) * 28 * dt;
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
          z: u.z + 8,
          vx: (tx - u.x) / t,
          vy: (ty - u.y) / t,
          vz: (h.z - u.z) / t,
          angle: Math.atan2(ty - u.y, tx - u.x),
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
      this.unitG.add(this.add.image(0, 0, "tank"));
      this.unitG.add(this.add.image(0, 0, "enemy_rotor"));
    }
    const kids = this.unitG.getChildren() as Phaser.GameObjects.Image[];
    for (let i = 0; i < kids.length; i++) kids[i]!.setVisible(false);
    live.forEach((u, i) => {
      const sh = kids[i * 3]!;
      const im = kids[i * 3 + 1]!;
      const extra = kids[i * 3 + 2]!;
      const aerial = u.kind === "heli" || u.z > 4;
      sh.setVisible(true).setTexture("shadow");
      sh.setPosition(u.x + u.z * 0.08, u.y + u.z * 0.42);
      sh.setScale(aerial ? 0.85 : 0.5).setAlpha(aerial ? 0.42 : 0.28).setDepth(2);
      im.setVisible(true)
        .setTexture(textureOf(u.kind))
        .setPosition(u.x, u.y - u.z * 0.05)
        .setRotation(u.kind === "soldier" ? 0 : u.angle + Math.PI / 2)
        .setDepth(10 + u.z);
      if (u.kind === "heli") {
        extra
          .setVisible(true)
          .setTexture("enemy_rotor")
          .setPosition(u.x, u.y - u.z * 0.05 - 2)
          .setRotation(u.rotor)
          .setAlpha(0.4)
          .setDepth(11 + u.z);
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
      sh.setVisible(true)
        .setPosition(s.x + s.z * 0.08, s.y + s.z * 0.42)
        .setScale(0.25 + s.z * 0.004)
        .setAlpha(0.35)
        .setDepth(3);
      im.setVisible(true)
        .setTexture(key)
        .setPosition(s.x, s.y - s.z * 0.05)
        .setRotation(s.angle)
        .setDepth(30 + s.z);
    });
  }

  syncFragSprites(): void {
    while (this.fragG.getLength() < this.frags.length) {
      this.fragG.add(this.add.image(0, 0, "frag_metal"));
    }
    const kids = this.fragG.getChildren() as Phaser.GameObjects.Image[];
    this.frags.forEach((f, i) => {
      const im = kids[i]!;
      im.setVisible(true)
        .setTexture(f.key)
        .setPosition(f.x, f.y)
        .setRotation(f.angle)
        .setDepth(f.settled ? 4 : 15)
        .setAlpha(f.settled ? 0.9 : 1);
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
    return { x: p.worldX, y: p.worldY };
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
      `ALT ${h.z | 0}   SPD ${Math.hypot(h.vx, h.vy) | 0}\nHP ${Math.max(0, h.health | 0)}   ${phase}\nWPN ${w.name}  ${ammoS}`
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
    this.miniGfx.fillStyle(0x14110c, 0.15);
    this.miniGfx.fillCircle(cx, cy, 90);
    this.miniGfx.lineStyle(2, 0xe8b84a, 0.85);
    this.miniGfx.strokeCircle(cx, cy, 90);
    this.miniGfx.lineStyle(1, 0xe8b84a, 0.2);
    this.miniGfx.strokeCircle(cx, cy, 45);
    const toMap = (x: number, y: number) => ({
      x: cx + ((x - this.heli.x) / span) * mapR,
      y: cy + ((y - this.heli.y) / span) * mapR,
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
