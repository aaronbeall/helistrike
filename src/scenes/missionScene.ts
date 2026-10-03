import { heightOf, radius, playerLoadoutFromSockets, type Unit, type Debris, type Shot, type PlayerWpnSpec } from "../sim/combat";
import { makeUnit, spawnCrewFor } from "../sim/units";
import { stampDecor, GroundMarks } from "./mission/fx/groundMarks";
import { Ripples } from "./mission/fx/ripples";
import Phaser from "phaser";
import { FieldBars } from "./mission/hud/fieldBars";
import { MissionFlow } from "./mission/flow/missionFlow";
import { MissionCamera } from "./mission/camera/camera";
import { ThermalMode } from "./mission/render/thermalMode";
import { UnitSprites } from "./mission/render/unitSprites";
import { HostCraft } from "./mission/render/hostCraft";
import { Destruction } from "./mission/destruction/destruction";
import { Trails } from "./mission/fx/trails";
import { Fx } from "./mission/fx/fx";
import { FireControl } from "./mission/weapons/fireControl";
import { Projectiles } from "./mission/weapons/projectiles";
import { ensureBlastRingGradient } from "../render/blastRing";
import { Countermeasures, TIMEWARP_PLAYER_SCALE, TIMEWARP_WORLD_SCALE, BULLET_TIME_SCALE } from "./mission/weapons/countermeasures";
import { LockOn } from "./mission/weapons/lockOn";
import { CallStrike } from "./mission/weapons/callStrike";
import { Refractor } from "./mission/weapons/refractor";
import { TESLA_SEGS, TESLA_STREAMS, Tesla } from "./mission/weapons/tesla";
import { RemoteBody } from "./mission/remote/body";
import { RemoteFleet } from "./mission/remote/fleet";
import { PostFxTest } from "./mission/debug/postFx";
import { DebugOverlays } from "./mission/debug/overlays";
import { HelpPanel } from "./mission/hud/help";
import { CornerHud } from "./mission/hud/cornerHud";
import { PromptsHud } from "./mission/hud/prompts";
import { UnitSim } from "./mission/enemy/unitSim";
import { EnemyFire } from "./mission/enemy/enemyFire";
import { EnemyTargeting } from "./mission/enemy/targeting";
import { RemoteAi } from "./mission/remote/ai";
import { ReticleHud } from "./mission/hud/reticleHud";
import { Minimap } from "./mission/hud/minimap";
import { StatusHud } from "./mission/hud/statusHud";
import { WeaponHud } from "./mission/hud/weaponHud";
import { ThreatHud } from "./mission/hud/threatHud";
import { DebugMenu } from "./mission/debug/menu";
import { ReliefEditor } from "./mission/debug/relief";
import { SideView } from "./mission/debug/sideView";
import { PerfMonitor } from "./mission/debug/perf";
import { createFxEmitters } from "./mission/fx/emitters";

import { type RemoteCraft } from "../sim/remote";
import { Layer } from "../render/depth";
import { Craft, craftCameraEdgeLocked } from "../sim/craft";
import { ensureAllArtGenAnims } from "../art/artGen";
import { craftComposite, craftExhaustFlameHue, craftExhaustMounts, craftGunOrigin, craftOf, craftPreviewExhaustTint } from "../sim/crafts";
import { missionOf } from "../sim/mission";
import { rigsAnyOpen, installRigHotkeys } from "../rigs/rigs";
import { ensureEdgeLightPipeline } from "../render/edgeLight";
import { setGlitchPipeline } from "../render/glitch";
import { setWarpDistortPipeline } from "../render/warpDistort";
import { setCloakFxPipeline } from "../render/cloakFx";
import { createTerrain25D, type Terrain25D } from "../render/terrain25d";
import { extractBiomeTiles, bakeHeliHudWireTexture, registerArt, nameGameTexture, muzzleGlowKey, ensureExhaustGlow, ensureImpactGlow } from "../art/sprites";
import { generateWorld, worldFromGen, groundZ, worldToScreen, setCamera25DFocus, screenToWorldOnGround, castZ, paintHeightMap, WORLD, WRECK_TEX, type WorldData } from "../worldgen/world";

/** How far aircraft may overshoot before a soft cap (jets / enemy air) — see craft.MAP_AIR_SOFT. */

export class MissionScene extends Phaser.Scene {
  // Subsystems — each owns its state + methods, holds the scene as `s`.
  // enemy
  targeting = new EnemyTargeting(this);
  unitSim = new UnitSim(this);
  enemyFire = new EnemyFire(this);
  // remote
  remoteFleet = new RemoteFleet(this);
  remoteAi = new RemoteAi(this);
  remoteBody = new RemoteBody(this);
  // weapons
  fireControl = new FireControl(this);
  projectiles = new Projectiles(this);
  lockOn = new LockOn(this);
  countermeasures = new Countermeasures(this);
  tesla = new Tesla(this);
  refractor = new Refractor(this);
  callStrike = new CallStrike(this);
  // fx
  fx = new Fx(this);
  trails = new Trails(this);
  groundMarks = new GroundMarks(this);
  ripples = new Ripples(this);
  // destruction
  destruction = new Destruction(this);
  // render
  hostCraft = new HostCraft(this);
  unitSprites = new UnitSprites(this);
  thermal = new ThermalMode(this);
  // camera
  camera = new MissionCamera(this);
  // flow
  flow = new MissionFlow(this);
  // hud
  weaponHud = new WeaponHud(this);
  statusHud = new StatusHud(this);
  threatHud = new ThreatHud(this);
  reticleHud = new ReticleHud(this);
  minimap = new Minimap(this);
  cornerHud = new CornerHud(this);
  prompts = new PromptsHud(this);
  help = new HelpPanel(this);
  fieldBars = new FieldBars(this);
  // debug
  debugMenu = new DebugMenu(this);
  overlays = new DebugOverlays(this);
  relief = new ReliefEditor(this);
  sideView = new SideView(this);
  perf = new PerfMonitor(this);
  postFx = new PostFxTest(this);
  world!: WorldData;
  player!: Craft;
  units: Unit[] = [];
  shots: Shot[] = [];
  debris: Debris[] = [];
  loadout: PlayerWpnSpec[] = playerLoadoutFromSockets(craftOf().sockets);
  keyW!: Phaser.Input.Keyboard.Key;
  keyA!: Phaser.Input.Keyboard.Key;
  keyS!: Phaser.Input.Keyboard.Key;
  keyD!: Phaser.Input.Keyboard.Key;
  keySpace!: Phaser.Input.Keyboard.Key;
  keyShift!: Phaser.Input.Keyboard.Key;
  ground!: Phaser.GameObjects.Image;
  flatWreckage!: Phaser.GameObjects.Image;
  terrain25d?: Terrain25D;
  terrainMesh = true;
  /** Last applied sim timeScale (skip walking ~N emitters when unchanged). */
  lastSimScale = Number.NaN;
  /** Effective world rate this frame (debug scale × timewarp / bullet time / stinger / warp shots). */
  liveSimScale = 1;
  wpnHud!: Phaser.GameObjects.Text;
  hvArrowLabels: Phaser.GameObjects.Text[] = [];
  /** Yellow edge cue back to host while piloting a remote POV. */
  parentArrowLabel!: Phaser.GameObjects.Text;
  hudCam!: Phaser.Cameras.Scene2D.Camera;
  /** World-space field HUD (locks, unit bars) — mirrors main cam, no thermal post-FX. */
  fieldHudCam!: Phaser.Cameras.Scene2D.Camera;
  hudRoot!: Phaser.GameObjects.Container;
  hudSet = new Set<Phaser.GameObjects.GameObject>();
  hudParS = 1;
  hudParX = 0;
  hudParY = 0;
  hvGfx!: Phaser.GameObjects.Graphics;
  over = false;
  completedHv = new Set<string>();
  missionEndQueued = false;
  /** Warp slow-mo held through impact-cam linger after the bomb is gone. */
  warpLingerScale: number | null = null;
  /** Wall-clock dt for this frame (warp missiles ignore sim slowmo). */
  frameWallDt = 0;
  remotes: RemoteCraft[] = [];
  keyE!: Phaser.Input.Keyboard.Key;
  /** Player craft's own step this frame (Time Warp privileged time) — motion + turret slew. */
  playerDt = 0;
  /** Per-frame pointer cache (avoid repeat getWorldPoint / ground unproject). */
  ptrFrame = -1;
  private ptrScrX = 0;
  private ptrScrY = 0;
  private ptrWorldX = 0;
  private ptrWorldY = 0;
  ptrWorldReady = false;
  timeScale = 1;
  heightMapCanvas!: HTMLCanvasElement;
  biomeTiles: (ImageData | null)[] = [];

  constructor() {
    super("mission");
  }

  init(data: { world?: WorldData }): void {
    this.over = false;
    this.flow.reset();
    this.completedHv.clear();
    this.missionEndQueued = false;
    this.destruction.reset();
    this.postFx.reset();
    this.terrain25d = undefined;
    this.fx.reset();
    this.hudSet.clear();
    this.lastSimScale = Number.NaN;
    for (const policy of Object.values(this.fx.policies)) {
      policy.emitted = 0;
      policy.emitters.clear();
    }
    this.camera.reset();
    this.thermal.reset();
    this.warpLingerScale = null;
    this.overlays.reset();
    this.sideView.reset();
    this.callStrike.reset();
    this.refractor.reset();
    this.remotes = [];
    this.countermeasures.reset();
    this.tesla.reset();
    this.terrainMesh = true;
    this.help.reset();
    this.debugMenu.reset();
    // Scene restart destroys pooled images — drop stale refs so they're rebuilt.
    this.remoteBody.reset();
    this.relief.reset();
    this.shots = [];
    this.trails.reset();
    this.debris = [];
    this.lockOn.reset();
    this.groundMarks.reset();
    this.ripples.reset();
    for (const g of this.groundMarks.emberGlows) {
      g.image.destroy();
      g.bloom.destroy();
    }
    this.hostCraft.reset();
    const selectedCraft = craftOf();
    this.loadout = playerLoadoutFromSockets(selectedCraft.sockets);
    this.fireControl.reset(selectedCraft);
    this.remoteFleet.reset();
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
    this.createAssets();
    this.bindPointerInput();
    this.createWorld();
    this.createPlayer();
    this.createWeaponGraphics();
    this.spawnUnits();
    this.createFx();
    this.bindInput();
    this.createHud();
    this.initCamera();
    this.debugMenu.setup();
    this.help.setup();
    this.flow.setupExitMenu();
    this.setupHudCam();
  }

  /** Textures, pipelines and art bakes the rest of create() draws from. */
  createAssets(): void {
    ensureEdgeLightPipeline(this.game);
    stampDecor(this.world, this.textures);
    if (this.textures.exists("map_terrain")) this.textures.remove("map_terrain");
    this.textures.addCanvas("map_terrain", this.world.canvas);
    registerArt("map_terrain", "generated");
    if (this.textures.exists("map_height")) this.textures.remove("map_height");
    this.heightMapCanvas = paintHeightMap(this.world.height, this.world.roads);
    this.textures.addCanvas("map_height", this.heightMapCanvas);
    registerArt("map_height", "generated");
    this.biomeTiles = extractBiomeTiles(this.textures);
    this.input.mouse?.disableContextMenu();
    ensureImpactGlow(this.textures);
    ensureExhaustGlow(this.textures);
    ensureBlastRingGradient(this.textures);
    ensureAllArtGenAnims(this.anims, this.textures);
    this.input.setDefaultCursor("none");
  }

  /** Fire gating + pointer up/down handlers. */
  bindPointerInput(): void {
    this.fireControl.canFire = !this.input.activePointer.isDown;
    this.input.on("pointerup", () => {
      this.fireControl.canFire = true;
    });
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      if (this.debugMenu.open || this.help.open || this.flow.exitOpen || this.relief.open || this.camera.mapView) return;
      if (p.rightButtonDown()) this.remoteFleet.exitRemoteView();
    });
  }

  /** World bounds, post-FX, ground + decal layer, terrain mesh, object groups. */
  createWorld(): void {
    this.physics.world.setBounds(0, 0, WORLD, WORLD);
    this.cameras.main.setBounds(0, 0, WORLD, WORLD);
    this.cameras.main.setBackgroundColor("#6a8496");
    this.postFx.setup();

    this.ground = this.add.image(WORLD / 2, WORLD / 2, "map_terrain");
    this.ground.setDisplaySize(WORLD, WORLD).setDepth(Layer.TERRAIN);
    this.groundMarks.wreckLayer = this.add.renderTexture(0, 0, WRECK_TEX, WRECK_TEX);
    nameGameTexture(this, this.groundMarks.wreckLayer, "wreck_layer");
    registerArt("wreck_layer", "generated");
    this.groundMarks.wreckLayer.setOrigin(0, 0).setPosition(0, 0);
    this.groundMarks.wreckLayer.setDisplaySize(WORLD, WORLD).setDepth(Layer.WRECK);
    (this.groundMarks.wreckLayer.texture as Phaser.Textures.DynamicTexture).setIsSpriteTexture(false);
    this.groundMarks.wreckLayer.clear();
    this.ripples.create();
    if (this.game.renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer) {
      this.terrain25d = createTerrain25D(this, this.world, {
        terrain: "map_terrain",
        decal: this.groundMarks.wreckLayer,
        depth: Layer.TERRAIN,
      });
      this.ground.setVisible(false);
      this.groundMarks.wreckLayer.setVisible(false);
    } else {
      this.terrain25d = undefined;
      this.terrainMesh = false;
    }
    this.groundMarks.stampBrush = this.make.image({ key: "fx_blast_0" }, false);

    this.unitSprites.unitG = this.add.group();
    this.projectiles.shotG = this.add.group();
    this.projectiles.photonFxG = this.add.group();
    this.remoteBody.remoteG = this.add.group();
    this.destruction.debrisG = this.add.group();
    this.fx.simParticleG = this.add.group();
    this.countermeasures.smokePuffG = this.add.group();
    this.unitSprites.thermalHotspotG = this.add.group();
  }

  /** Player craft, theater sky + clouds, host craft parts, armor glows, muzzles. */
  createPlayer(): void {
    this.player = new Craft(this.world.spawnX, this.world.spawnY, this.world);
    if (this.player.spec.flightModel === "plane") {
      const inward = Math.atan2(WORLD * 0.5 - this.player.y, WORLD * 0.5 - this.player.x);
      this.player.startAirborne(inward, this.world);
    } else {
      this.player.angle = 0.6;
      this.player.syncStationAimToHull();
    }
    this.camera.createLeaveTheaterSky();
    this.camera.createPlaneCloudParallax();
    setCamera25DFocus(this.player.x, this.player.y, this.player.z);
    const craft = this.player.spec;
    this.hostCraft.craftParts = craftComposite(craft);
    this.hostCraft.shadow = this.add.image(0, 0, "fx_shadow").setDepth(Layer.SHADOW);
    this.hostCraft.guns = this.hostCraft.craftParts.guns.map((part) =>
      this.add
        .image(0, 0, part.tex)
        .setDepth(Layer.WORLD)
        .setOrigin(part.origin.x, part.origin.y)
    );
    this.hostCraft.gunHeatGlows = this.hostCraft.guns.map((gun) => {
      const glowTex = muzzleGlowKey(gun.texture.key);
      const key = this.textures.exists(glowTex) ? glowTex : gun.texture.key;
      return this.add
        .image(0, 0, key)
        .setVisible(false)
        .setOrigin(gun.originX, gun.originY)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(Layer.WORLD);
    });
    this.hostCraft.gunTipHeat = this.hostCraft.guns.map(() => 0);
    this.hostCraft.gun =
      this.hostCraft.guns[0] ??
      this.add
        .image(0, 0, "fx_muzzle")
        .setDepth(Layer.WORLD)
        .setOrigin(craftGunOrigin(craft).x, craftGunOrigin(craft).y)
        .setVisible(false);
    this.hostCraft.body = this.add.image(0, 0, this.hostCraft.craftParts.body.tex).setDepth(Layer.WORLD).setOrigin(this.hostCraft.craftParts.body.origin.x, this.hostCraft.craftParts.body.origin.y);
    this.hostCraft.exhaustFlames = craftExhaustMounts(craft).map(() =>
      this.add
        .image(0, 0, "fx_exhaust")
        .setDepth(Layer.WORLD)
        .setOrigin(0, 0.5)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setVisible(false)
    );
    this.hostCraft.exhaustEngineGlows = craftExhaustMounts(craft).map(() =>
      this.add
        .image(0, 0, "fx_exhaust_glow")
        .setDepth(Layer.WORLD)
        // Top-middle = nozzle; plume hangs in local +Y (exhaust).
        .setOrigin(0.5, 0)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setTint(craftPreviewExhaustTint(craft.kind))
        .setVisible(false)
    );
    this.hostCraft.exhaustFlameHueFx = this.hostCraft.exhaustFlames.map((flame) => {
      const fx = flame.preFX?.addColorMatrix();
      if (fx) fx.hue(craftExhaustFlameHue(craft.kind));
      return fx;
    });
    const rotorTex = this.hostCraft.craftParts.rotors[0]?.tex ?? "craft_apache_rotor";
    this.hostCraft.rotors = this.hostCraft.craftParts.rotors.map((part) =>
      this.add.image(0, 0, part.tex).setDepth(Layer.WORLD).setOrigin(part.origin.x, part.origin.y)
    );
    this.hostCraft.rotor =
      this.hostCraft.rotors[0] ??
      this.add.image(0, 0, rotorTex).setDepth(Layer.WORLD).setOrigin(0.5, 0.5).setVisible(false);
    this.countermeasures.reactiveArmorGlows = [0, 1, 2, 3, 4, 5].map(() =>
      this.add
        .image(0, 0, "fx_glow")
        .setDepth(Layer.WORLD)
        .setVisible(false)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setTint(0xff2840)
    );
    this.fx.muzzle = this.add
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
    this.fx.muzzlePool = [this.fx.muzzle, secondMuzzle];
    ensureImpactGlow(this.textures);
    this.fx.muzzleGlowPool = [0, 1].map(() =>
      this.add
        .image(0, 0, "fx_glow")
        .setVisible(false)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setTint(0xfff2c8)
    );
    this.fx.muzzleFlashes = [
      { life: 0, life0: 0.1, ang: 0, scaleMul: 1, glowMul: 56, rotJitter: 0 },
      { life: 0, life0: 0.1, ang: 0, scaleMul: 1, glowMul: 56, rotJitter: 0 },
    ];
    this.hostCraft.body.setPosition(this.player.x, this.player.y);
  }

  /** Reticle, weapon/FX graphics layers, Tesla pools, extra muzzles, lock text. */
  createWeaponGraphics(): void {
    this.reticleHud.create();
    this.lockOn.gfx = this.add.graphics().setDepth(Layer.FIELD).setVisible(false);
    this.trails.towWireGfx = this.add.graphics().setDepth(Layer.WORLD);
    this.remoteBody.remoteAntennaGfx = this.add.graphics().setDepth(Layer.WORLD);
    this.tesla.gfx = this.add.graphics().setDepth(Layer.WORLD).setBlendMode(Phaser.BlendModes.ADD);
    this.trails.energyTrailGfx = this.add.graphics().setDepth(Layer.WORLD).setBlendMode(Phaser.BlendModes.ADD);
    this.refractor.gfx = this.add.graphics().setDepth(Layer.WORLD).setBlendMode(Phaser.BlendModes.ADD);
    this.countermeasures.gfx = this.add.graphics().setDepth(Layer.WORLD).setBlendMode(Phaser.BlendModes.ADD);
    this.tesla.zapPool = [];
    for (let i = 0; i < 28; i++) {
      this.tesla.zapPool.push(
        this.add.image(0, 0, "fx_zap", 0).setVisible(false).setBlendMode(Phaser.BlendModes.ADD)
      );
    }
    this.fx.extraMuzzleFlashPool = [];
    for (let i = 0; i < 6; i++) {
      this.fx.extraMuzzleFlashPool.push(
        this.add.image(0, 0, "fx_muzzle", 0).setVisible(false).setBlendMode(Phaser.BlendModes.ADD)
      );
    }
    this.tesla.segPool = [];
    for (let i = 0; i < TESLA_STREAMS * TESLA_SEGS; i++) {
      this.tesla.segPool.push(
        this.add.image(0, 0, "fx_zap", 0).setVisible(false).setBlendMode(Phaser.BlendModes.ADD)
      );
    }
    this.tesla.glowPool = [];
    const glowKeys = [
      "fx_tesla_halo",
      "fx_tesla_glow",
      "fx_tesla_halo",
      "fx_tesla_halo",
      "fx_tesla_glow",
      "fx_tesla_halo",
    ];
    for (const key of glowKeys) {
      this.tesla.glowPool.push(
        this.add.image(0, 0, key).setVisible(false).setBlendMode(Phaser.BlendModes.ADD)
      );
    }
    this.tesla.headZapPool = [];
    for (let i = 0; i < 3; i++) {
      this.tesla.headZapPool.push(
        this.add.image(0, 0, "fx_zap", i).setVisible(false).setBlendMode(Phaser.BlendModes.ADD)
      );
    }
    this.lockOn.txt = this.add
      .text(0, 0, "LOCK", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "13px",
        color: "#ff3a22",
      })
      .setOrigin(0.5, 1)
      .setDepth(Layer.FIELD)
      .setVisible(false)
      .setStroke("#1c100c", 3);
    this.lockOn.inbdTxt = this.add
      .text(0, 0, "FIRE", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "12px",
        color: "#ffb020",
      })
      .setOrigin(0.5, 1)
      .setDepth(Layer.FIELD)
      .setVisible(false)
      .setStroke("#1c100c", 3);
    this.lockOn.arrowGfx = this.add.graphics().setScrollFactor(0).setDepth(Layer.HUD + 2);
    this.lockOn.hudTxt = this.add
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
    this.lockOn.inbdHudTxt = this.add
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
  }

  /** Initial units from world spawns, plus posted crew. */
  spawnUnits(): void {
    this.units = [];
    for (const s of this.world.spawns) {
      const u = makeUnit(this.world, s.kind, s.x, s.y);
      u.hv = s.hv;
      this.units.push(u);
    }
    const posted: Unit[] = [];
    for (const host of this.units) {
      posted.push(...spawnCrewFor(this.world, this.textures, host));
    }
    this.units.push(...posted);
  }

  /** Particle emitters, thermal particle tint hook, time scale. */
  createFx(): void {
    createFxEmitters(this);
    // Scene events survive restart — drop on shutdown or handlers stack per mission.
    const onPostUpdate = () => this.thermal.tintParticles();
    this.events.on(Phaser.Scenes.Events.POST_UPDATE, onPostUpdate);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.events.off(Phaser.Scenes.Events.POST_UPDATE, onPostUpdate));
    this.applyTimeScale();
  }

  /** Keyboard bindings, shutdown cleanup, rig hotkeys, mouse wheel. */
  bindInput(): void {
    this.keyW = this.input.keyboard!.addKey("W");
    this.keyA = this.input.keyboard!.addKey("A");
    this.keyS = this.input.keyboard!.addKey("S");
    this.keyD = this.input.keyboard!.addKey("D");
    this.keySpace = this.input.keyboard!.addKey("SPACE");
    this.keyShift = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
    this.keyE = this.input.keyboard!.addKey("E");
    this.keyE.on("down", () => this.countermeasures.toggleBulletTime());
    this.input.keyboard!.addKey("F").on("down", () => this.countermeasures.trigger());
    // POV remote host escort FOLLOW / HOLD.
    this.input.keyboard!.addKey("C").on("down", () => {
      if (this.relief.open || this.debugMenu.open || this.help.open || this.flow.exitOpen) return;
      if (this.remoteFleet.povHudRemote()?.spec.hostEscort) this.remoteFleet.toggleHostEscortMode();
    });
    this.input.keyboard!.addKey("ONE").on("down", () => {
      if (this.relief.open) this.relief.setBrush(0);
      else if (this.debugMenu.open || this.help.open) return;
      else this.fireControl.selectWeapon(0);
    });
    this.input.keyboard!.addKey("TWO").on("down", () => {
      if (this.relief.open) this.relief.setBrush(1);
      else if (this.debugMenu.open || this.help.open) return;
      else this.fireControl.selectWeapon(1);
    });
    this.input.keyboard!.addKey("THREE").on("down", () => {
      if (this.relief.open) this.relief.setBrush(2);
      else if (this.debugMenu.open || this.help.open) return;
      else this.fireControl.selectWeapon(2);
    });
    this.input.keyboard!.addKey("FOUR").on("down", () => {
      if (this.debugMenu.open || this.help.open) return;
      else this.fireControl.selectWeapon(3);
    });
    this.input.keyboard!.addKey("FIVE").on("down", () => {
      if (this.debugMenu.open || this.help.open) return;
      else this.fireControl.selectWeapon(4);
    });
    this.input.keyboard!.addKey("B").on("down", () => this.relief.toggle());
    this.input.keyboard!.addKey("I").on("down", () => {
      if (this.relief.open) this.relief.toggleInvert();
    });
    this.input.keyboard!.addKey("M").on("down", () => {
      if (!this.help.open && !this.flow.exitOpen) this.camera.toggleMap();
    });
    this.input.keyboard!.addKey("H").on("down", () => {
      if (!this.flow.exitOpen) this.help.toggle();
    });
    this.input.keyboard!.addKey("Q").on("down", () => {
      if (this.relief.open) this.relief.nudgeRot(-1);
      else if (this.remoteFleet.remoteView && this.remoteFleet.pilotingRemote()) this.remoteFleet.exitRemoteView();
      else this.remoteFleet.recallDockables();
    });
    this.input.keyboard!.addKey("COMMA").on("down", () => {
      if (this.relief.open) this.relief.nudgeOff(-1, 0);
    });
    this.input.keyboard!.addKey("PERIOD").on("down", () => {
      if (this.relief.open) this.relief.nudgeOff(1, 0);
    });
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.OPEN_BRACKET).on("down", () => {
      if (rigsAnyOpen(this)) return;
      if (this.debugMenu.spawnOpen) this.debugMenu.nudgeSpawn(-1);
      else if (this.debugMenu.camOpen) this.debugMenu.nudgeCam(-1);
      else if (this.relief.open) this.relief.nudgeSize(-1);
    });
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.CLOSED_BRACKET).on("down", () => {
      if (rigsAnyOpen(this)) return;
      if (this.debugMenu.spawnOpen) this.debugMenu.nudgeSpawn(1);
      else if (this.debugMenu.camOpen) this.debugMenu.nudgeCam(1);
      else if (this.relief.open) this.relief.nudgeSize(1);
    });
    this.input.keyboard!.addKey("SEMICOLON").on("down", () => {
      if (this.debugMenu.camOpen) this.debugMenu.nudgeCam(-1);
      else if (this.relief.open) this.relief.nudgeOff(0, -1);
    });
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.QUOTES).on("down", () => {
      if (this.debugMenu.camOpen) this.debugMenu.nudgeCam(1);
      else if (this.relief.open) this.relief.nudgeOff(0, 1);
    });
    this.input.keyboard!.addKey("K").on("down", () => this.overlays.toggleHeightMap());
    this.input.keyboard!.addKey("P").on("down", () => this.perf.handleKey());
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.FORWARD_SLASH).on("down", () => this.debugMenu.toggle());
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ESC).on("down", () => {
      if (this.over) {
        this.scene.start("menu");
        return;
      }
      if (this.help.open) this.help.toggle(false);
      else if (this.debugMenu.camOpen) this.debugMenu.closeCam();
      else if (this.debugMenu.spawnOpen) this.debugMenu.closeSpawn();
      else if (this.relief.open) this.relief.toggle(false);
      else if (this.debugMenu.open) this.debugMenu.toggle(false);
      else this.flow.toggleExitMenu();
    });
    this.input.keyboard!.addKey("R").on("down", () => {
      if (this.relief.open && !this.over) this.relief.nudgeRot(1);
      else if (this.over) this.scene.start("load");
    });
    const bumpTime = (dir: number) => {
      if (rigsAnyOpen(this)) return;
      if (this.debugMenu.camOpen) this.debugMenu.nudgeCam(dir);
      else this.nudgeTimeScale(dir);
    };
    // Use keyboard.on (not addKey) so Mission shutdown doesn't fight RigsScene ± zoom keys.
    const kb = this.input.keyboard!;
    const onTimePlus = () => bumpTime(1);
    const onTimeMinus = () => bumpTime(-1);
    kb.on("keydown-PLUS", onTimePlus);
    kb.on("keydown-EQUALS", onTimePlus);
    kb.on("keydown-NUMPAD_ADD", onTimePlus);
    kb.on("keydown-MINUS", onTimeMinus);
    kb.on("keydown-NUMPAD_SUBTRACT", onTimeMinus);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      kb.off("keydown-PLUS", onTimePlus);
      kb.off("keydown-EQUALS", onTimePlus);
      kb.off("keydown-NUMPAD_ADD", onTimePlus);
      kb.off("keydown-MINUS", onTimeMinus);
      kb.off("keydown-NUMPAD_SUBTRACT", onTimeMinus);
      this.postFx.bloom = undefined;
      this.postFx.barrel = undefined;
      this.countermeasures.empGlitchT = 0;
      setGlitchPipeline(this.cameras?.main, false);
      setWarpDistortPipeline(this.cameras?.main, false);
      setCloakFxPipeline(this.cameras?.main, false);
      this.terrain25d = undefined;
      this.fx.slots.clear();
      this.fx.thermalSaved.clear();
      this.hudSet.clear();
      for (const policy of Object.values(this.fx.policies)) policy.emitters.clear();
    });
    installRigHotkeys(this);
    this.input.keyboard!.addKey("O").on("down", () => {
      if (this.relief.open || this.debugMenu.open || this.help.open || this.flow.exitOpen) return;
      this.postFx.toggle();
    });
    this.input.keyboard!.addKey("T").on("down", () => this.thermal.toggle());
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.UP).on("down", () => {
      if (rigsAnyOpen(this)) return;
      if (this.help.open) this.help.nudgeFocus(-1);
      else if (this.debugMenu.spawnOpen) this.debugMenu.nudgeSpawn(-1);
      else if (this.debugMenu.camOpen) this.debugMenu.nudgeCamSel(-1);
      else if (this.debugMenu.open) this.debugMenu.nudge(-1);
    });
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN).on("down", () => {
      if (rigsAnyOpen(this)) return;
      if (this.help.open) this.help.nudgeFocus(1);
      else if (this.debugMenu.spawnOpen) this.debugMenu.nudgeSpawn(1);
      else if (this.debugMenu.camOpen) this.debugMenu.nudgeCamSel(1);
      else if (this.debugMenu.open) this.debugMenu.nudge(1);
    });
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT).on("down", () => {
      if (rigsAnyOpen(this)) return;
      if (this.help.open) this.help.nudge(-1);
      else if (this.debugMenu.camOpen) this.debugMenu.nudgeCam(-1);
    });
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT).on("down", () => {
      if (rigsAnyOpen(this)) return;
      if (this.help.open) this.help.nudge(1);
      else if (this.debugMenu.camOpen) this.debugMenu.nudgeCam(1);
    });
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER).on("down", () => {
      if (this.help.open) this.help.fieldManual.activateFocus();
      else if (this.debugMenu.spawnOpen) this.debugMenu.spawnSelected();
      else if (this.debugMenu.camOpen) this.debugMenu.activateCamRow();
      else if (this.debugMenu.open && !this.debugMenu.camOpen) this.debugMenu.activateRow(this.debugMenu.menuIdx);
    });
    this.input.on("wheel", (_p: Phaser.Input.Pointer, _dx: number, dy: number) => {
      if (rigsAnyOpen(this)) return;
      if (this.help.open) {
        this.help.nudgeFocus(dy > 0 ? 1 : -1);
        return;
      }
      if (this.debugMenu.camOpen) {
        this.debugMenu.nudgeCam(dy > 0 ? -1 : 1);
        return;
      }
      if (this.debugMenu.spawnOpen) {
        this.debugMenu.nudgeSpawn(dy > 0 ? 1 : -1);
        return;
      }
      if (this.relief.open) {
        this.relief.nudgeSize(dy > 0 ? -1 : 1);
        return;
      }
      if (this.debugMenu.open) return;
      if (dy > 0) this.fireControl.selectWeapon((this.fireControl.hudWeapon() + 1) % this.fireControl.hudLoadout().length);
      else
        this.fireControl.selectWeapon(
          (this.fireControl.hudWeapon() + this.fireControl.hudLoadout().length - 1) % this.fireControl.hudLoadout().length
        );
    });
  }

  /** HUD objects: readouts, threat, prompts, weapon bar, status panel, minimap, map labels. */
  createHud(): void {
    this.cornerHud.hud = this.add
      .text(16, 12, "", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "14px",
        color: "#e8b84a",
      })
      .setScrollFactor(0)
      .setDepth(Layer.HUD);
    this.threatHud.paintTxt = this.add
      .text(this.scale.width / 2, 40, "◆ RADAR PAINT", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "14px",
        color: "#e8b84a",
        align: "center",
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(Layer.HUD + 20)
      .setStroke("#12100c", 4)
      .setVisible(false);
    this.threatHud.missileTxt = this.add
      .text(this.scale.width / 2, 64, "▲ MISSILE LOCK ▲", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "18px",
        color: "#ff3a2a",
        align: "center",
        fontStyle: "bold",
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(Layer.HUD + 21)
      .setStroke("#12100c", 5)
      .setVisible(false);
    this.prompts.liftPrompt = this.add
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
    this.prompts.remotePrompt = this.add
      .text(this.scale.width / 2, this.scale.height - 96, "Q / RMB  EXIT VIEW", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "13px",
        color: "#7ad0ff",
        align: "center",
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(Layer.HUD + 8)
      .setStroke("#12100c", 4)
      .setVisible(false);
    this.prompts.dockAglAlertTxt = this.add
      .text(this.scale.width / 2, this.scale.height - 130, "TOO HIGH TO DOCK — DESCEND (SHIFT)", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "13px",
        color: "#ff8a5a",
        align: "center",
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(Layer.HUD + 8)
      .setStroke("#12100c", 4)
      .setVisible(false);
    this.prompts.remoteArmedTxt = this.add
      .text(0, 0, "ARMED", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "12px",
        color: "#ff3a22",
      })
      .setOrigin(0.5, 1)
      .setDepth(Layer.FIELD)
      .setVisible(false)
      .setStroke("#1c100c", 3);
    // Lower left, just above the minimap ring (ring top ≈ height − 198).
    this.postFx.hud = this.add
      .text(16, this.scale.height - 206, "", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "12px",
        color: "#8a8470",
      })
      .setOrigin(0, 1)
      .setScrollFactor(0)
      .setDepth(Layer.HUD + 5);
    this.cornerHud.fpsHud = this.add
      .text(this.scale.width - 16, 12, "", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "12px",
        color: "#8a8470",
      })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(Layer.HUD + 5);
    this.perf.hud = this.add
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
    this.postFx.syncHud();
    this.cornerHud.hvHud = this.add
      .text(this.scale.width - 16, 12, "", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "13px",
        color: "#f0e6c8",
        align: "right",
      })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(Layer.HUD);
    this.cornerHud.hvRows = this.world.hv.map((_, i) =>
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
    this.weaponHud.wpnBar = this.add.graphics().setScrollFactor(0).setDepth(Layer.HUD);
    this.weaponHud.wpnHudSlots = this.loadout.map(() => {
      const mk = (size: string, color: string, originX: number, originY = 0.5) =>
        this.add
          .text(0, 0, "", {
            fontFamily: "Share Tech Mono, monospace",
            fontSize: size,
            color,
          })
          .setOrigin(originX, originY)
          .setScrollFactor(0)
          .setDepth(Layer.HUD + 1)
          .setStroke("#12100c", 3);
      return {
        key: mk("12px", "#a89868", 0, 0.5),
        name: mk("13px", "#f0d56a", 0, 0.5),
        ammo: mk("13px", "#e8d49a", 1, 0.5),
        status: mk("10px", "#7ad0ff", 0.5, 0).setStroke("#12100c", 2),
      };
    });
    {
      const mk = (size: string, color: string, originX: number) =>
        this.add
          .text(0, 0, "", {
            fontFamily: "Share Tech Mono, monospace",
            fontSize: size,
            color,
          })
          .setOrigin(originX, 0.5)
          .setScrollFactor(0)
          .setDepth(Layer.HUD + 1)
          .setStroke("#12100c", 3)
          .setVisible(false);
      this.weaponHud.exitHudSlot = {
        key: mk("12px", "#a89868", 0),
        name: mk("13px", "#f0d56a", 0),
      };
      this.weaponHud.escortHudSlot = {
        key: mk("12px", "#a89868", 0),
        name: mk("13px", "#f0d56a", 0),
        status: mk("10px", "#8ec8e8", 0.5).setOrigin(0.5, 0),
      };
    }
    this.wpnHud = this.add.text(0, 0, "").setVisible(false);
    const cmMk = (size: string, color: string, originX: number) =>
      this.add
        .text(0, 0, "", {
          fontFamily: "Share Tech Mono, monospace",
          fontSize: size,
          color,
        })
        .setOrigin(originX, 0.5)
        .setScrollFactor(0)
        .setDepth(Layer.HUD + 1)
        .setStroke("#12100c", 3);
    this.weaponHud.cmHudLabel = cmMk("11px", "#e8b84a", 1);
    this.weaponHud.cmHudTime = cmMk("11px", "#c4a24a", 0);
    this.weaponHud.btHudLabel = cmMk("11px", "#a898d8", 1);
    this.weaponHud.btHudTime = cmMk("11px", "#a898d8", 0);
    this.fieldBars.hpGfx = this.add.graphics().setDepth(Layer.FIELD);
    this.threatHud.arcGfx = this.add.graphics().setDepth(Layer.FIELD).setBlendMode(Phaser.BlendModes.ADD);
    this.statusHud.playerHud = this.add.graphics().setScrollFactor(0).setDepth(Layer.HUD + 12);
    this.statusHud.hurtVignette = this.add
      .image(0, 0, "hud_hurt_pulse")
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(Layer.HUD + 4)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0)
      .setVisible(false);
    this.statusHud.hurtVignettePulse = this.add
      .image(0, 0, "hud_hurt_static")
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(Layer.HUD + 5)
      .setAlpha(0)
      .setVisible(false);
    // Square status panel matches minimap diameter; wire fits the area right of the HP bar.
    const statusPanel = 180;
    const wireRestW = statusPanel - 9 - 12 - 6; // bar + gap + pad
    // Baked at its display scale (≤2× craft sprite) — images draw 1:1.
    const wireBake = bakeHeliHudWireTexture(this, { w: wireRestW - 16, h: statusPanel - 28 });
    if (wireBake && this.textures.exists("hud_wire")) {
      this.statusHud.heliHudWireBake = wireBake;
      this.statusHud.heliHudWireScale = wireBake.scale;
      const origin = wireBake.pivot;
      this.statusHud.heliHudWireSh = this.add
        .image(0, 0, "hud_wire_sh")
        .setOrigin(wireBake.shadowPivot.x, wireBake.shadowPivot.y)
        .setScrollFactor(0)
        .setDepth(Layer.HUD + 10)
        .setAlpha(0.72);
      this.statusHud.heliHudWire = this.add
        .image(0, 0, "hud_wire")
        .setOrigin(origin.x, origin.y)
        .setScrollFactor(0)
        .setDepth(Layer.HUD + 11)
        .setTint(0x66cc55);
    } else {
      this.statusHud.heliHudWireSh = this.add.image(0, 0, craftOf().body).setVisible(false).setScrollFactor(0);
      this.statusHud.heliHudWire = this.add.image(0, 0, craftOf().body).setVisible(false).setScrollFactor(0).setDepth(Layer.HUD + 11);
    }
    this.camera.mapLabel = this.add
      .text(this.scale.width / 2, this.scale.height - 48, "", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "16px",
        color: "#e8b84a",
      })
      .setOrigin(0.5, 1)
      .setScrollFactor(0)
      .setDepth(Layer.HUD + 20)
      .setVisible(false);

    this.minimap.gfx = this.add.graphics().setScrollFactor(0).setDepth(Layer.HUD + 1);
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
    this.parentArrowLabel = this.add
      .text(0, 0, "", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "11px",
        color: "#ffe08a",
        align: "center",
      })
      .setOrigin(0.5, 0.5)
      .setScrollFactor(0)
      .setDepth(Layer.HUD + 3)
      .setStroke("#12100c", 4)
      .setLineSpacing(-1)
      .setVisible(false);
    this.camera.mapGfx = this.add.graphics().setDepth(Layer.FIELD);
    this.camera.mapHvLabels = [];
    this.overlays.debugGfx = this.add.graphics().setDepth(Layer.FIELD).setVisible(false);
    this.overlays.blastGfx = this.add.graphics().setDepth(Layer.FIELD + 20);
    this.overlays.aiGfx = this.add.graphics().setDepth(Layer.FIELD + 8);
    const cx = 18 + 88;
    const cy = this.scale.height - 18 - 88;
    this.minimap.mask = this.add.graphics().setScrollFactor(0);
    this.minimap.mask.fillStyle(0xffffff);
    this.minimap.mask.fillCircle(cx, cy, 88);
    this.minimap.bg = this.add.graphics().setScrollFactor(0).setDepth(Layer.HUD - 1);
    this.minimap.bg.fillStyle(minimapTerrainBgColor(this.world.canvas), 1);
    this.minimap.bg.fillCircle(cx, cy, 90);
    this.minimap.terrain = this.add.image(cx, cy, "map_terrain").setScrollFactor(0).setDepth(Layer.HUD);
    this.minimap.terrain.setMask(this.minimap.mask.createGeometryMask());
    if (this.textures.exists("map_wrecks")) this.textures.remove("map_wrecks");
    this.groundMarks.wreckLayer.saveTexture("map_wrecks");
    registerArt("map_wrecks", "generated");
    this.flatWreckage = this.add
      .image(0, WORLD, "map_wrecks")
      .setOrigin(0, 1)
      .setFlipY(true)
      .setDisplaySize(WORLD, WORLD)
      .setDepth(Layer.WRECK)
      .setVisible(false);
    this.minimap.wrecks = this.add.image(cx, cy, "map_wrecks").setScrollFactor(0).setDepth(Layer.HUD);
    if (this.terrain25d) this.minimap.wrecks.setFlipY(true);
    this.minimap.wrecks.setMask(this.minimap.mask.createGeometryMask());
    this.minimap.mask.setVisible(false);
  }

  /** Camera centre, zoom, bounds and the initial play-view frame. */
  initCamera(): void {
    this.cameras.main.centerOn(this.player.x, this.player.y);
    this.cameras.main.setZoom(this.camera.playZoom());
    // Chase cam stays on-map only for craft without forced U-turn.
    this.cameras.main.useBounds = craftCameraEdgeLocked(this.player.spec);
    this.camera.zoom = this.camera.playZoom();
    this.camera.playScrollX = this.player.x - this.scale.width / 2;
    this.camera.playScrollY = this.player.y - this.scale.height / 2;
    this.camera.playViewX = this.camera.playScrollX;
    this.camera.playViewY = this.camera.playScrollY;
    this.camera.playViewW = this.scale.width;
    this.camera.playViewH = this.scale.height;
    this.camera.playLastFrame = true;
  }

  /** ` cycles closed → sprite → roster → combat → toon → balance → closed — owned by RigsScene. */

  update(_t: number, dms: number): void {
    const perfOn = this.perf.enabled;
    const perfSceneStart = perfOn ? performance.now() : 0;
    if (rigsAnyOpen(this)) {
      this.reticleHud.hideAimChrome();
      return;
    }
    const wallDt = Math.min(dms / 1000, 0.05);
    this.frameWallDt = wallDt;
    const mapPause = this.camera.mapWant || this.camera.mapBlend > 0.02;
    const uiPause = mapPause || this.help.open || this.flow.exitOpen;
    let simScale = this.timeScale;
    if (this.flow.stingerT > 0) simScale = Math.min(simScale, 0.18);
    if (!uiPause && !this.over) this.countermeasures.tickTimewarpCharge(wallDt);
    if (this.countermeasures.timewarpT > 0) simScale = Math.min(simScale, TIMEWARP_WORLD_SCALE);
    if (!uiPause && !this.over) this.countermeasures.tickBulletTime(wallDt);
    if (this.countermeasures.bulletOn) simScale = Math.min(simScale, BULLET_TIME_SCALE);
    for (const shot of this.shots) {
      if (shot.from === "player" && shot.warpTimeScale != null) {
        simScale = Math.min(simScale, shot.warpTimeScale);
      }
    }
    // Warp bomb: keep world crawl through impact-cam linger (shot is already gone).
    if (this.warpLingerScale != null) {
      if (this.camera.povCamLookHold > 0) simScale = Math.min(simScale, this.warpLingerScale);
      else this.warpLingerScale = null;
    }
    const dt = uiPause ? 0 : wallDt * simScale;
    // Time Warp bonus: the player craft's own motion only slows to TIMEWARP_PLAYER_SCALE.
    const playerDt =
      !uiPause && this.countermeasures.timewarpT > 0 ? Math.max(dt, wallDt * TIMEWARP_PLAYER_SCALE) : dt;
    this.playerDt = playerDt;
    this.liveSimScale = simScale;
    this.setSimTimeScale(uiPause ? 0 : simScale);
    this.flow.tickStinger(wallDt);
    for (const policy of Object.values(this.fx.policies)) policy.emitted = 0;
    this.cornerHud.syncFpsHud();
    if (this.over) {
      // End prompt is up, but the world keeps simmering (debris, units, fire).
      const endDt = uiPause ? 0 : wallDt * this.timeScale;
      this.setSimTimeScale(uiPause ? 0 : this.timeScale);
      this.camera.syncPlayView();
      if (this.camera.mapBlend < 0.001) this.camera.syncLookCam(wallDt);
      if (!mapPause) {
        this.unitSim.rebuildUnitIdMap();
        this.unitSim.updateUnits(endDt);
        this.projectiles.updateShots(endDt);
        this.destruction.updateDebris(endDt);
        this.fx.updateSimParticles(endDt);
        this.ripples.update(endDt);
        this.countermeasures.updateSmokePuffs(endDt);
        this.fx.emitHeliCrashDmgFlames();
        this.reticleHud.hideAimChrome();
      }
      this.minimap.draw();
      this.statusHud.draw();
      this.trails.towWireGfx.clear();
      this.remoteBody.remoteAntennaGfx?.clear();
      this.tesla.gfx.clear();
      this.tesla.hideVisuals();
      this.trails.energyTrailGfx.clear();
      this.refractor.gfx.clear();
      this.countermeasures.gfx.clear();
      this.prompts.remotePrompt?.setVisible(false);
      this.prompts.remoteArmedTxt?.setVisible(false);
      return;
    }
    this.camera.syncPlayView();
    this.camera.updateTheaterCam(wallDt);
    if (this.camera.mapBlend < 0.001) this.camera.syncLookCam(wallDt);
    this.camera.syncPlaneCloudParallax(dt);

    if (!mapPause) {
      this.unitSim.rebuildUnitIdMap();
      // One pipeline; `stage` times a slot (minus its nested sub-slot) only when perf is on.
      const timings = perfOn ? this.perf.current! : undefined;
      timings?.fill(0);
      const stage = (slot: number, nested: number | undefined, fn: () => void): void => {
        if (!timings) return fn();
        const t = performance.now();
        fn();
        timings[slot] = performance.now() - t - (nested != null ? timings[nested]! : 0);
      };
      stage(2, undefined, () => {
        const aim = this.worldPointer();
        const pilot = this.remoteFleet.tickControl(dt, aim);
        this.countermeasures.tick(dt, wallDt);
        {
          // POV dock: host holds station (and descends if needed) instead of escorting.
          const dockSeq = !!this.remoteFleet.povDockRemote();
          const escort = dockSeq ? undefined : this.remoteFleet.hostEscortDrive(pilot);
          const dockDescend = this.remoteFleet.hostDockDescend();
          this.player.update(
            playerDt,
            this.world,
            escort?.stick ??
              (this.remoteFleet.remotePilotActive
                ? { up: false, down: false, left: false, right: false }
                : {
                    up: this.keyW.isDown,
                    down: this.keyS.isDown,
                    left: this.keyA.isDown,
                    right: this.keyD.isDown,
                  }),
            escort?.aimX ?? aim.x,
            escort?.aimY ?? aim.y,
            escort || dockDescend
              ? false
              : this.keySpace.isDown &&
                  !(this.flow.stingerStyle === "subtle" && this.flow.stingerT > 0 && !this.flow.stingerReleased),
            dockDescend || (escort ? false : this.keyShift.isDown)
          );
          if (escort?.brake || dockSeq) this.remoteFleet.brakeHostEscort(dt);
          if (escort?.speedCap != null) this.remoteFleet.capHostEscortSpeed(escort.speedCap);
        }
        this.camera.syncProjectionPose();
        this.camera.syncLeaveTheaterPeaks();
        this.hostCraft.sync(dt);
        this.fireControl.handleFire(dt);
        this.fx.tickPlayerMuzzles(dt);
        this.countermeasures.updateSmokePuffs(dt);
        this.remoteFleet.updateRemotes(dt);
        this.countermeasures.updateFlares(dt);
        this.tesla.tickZaps(dt);
        this.fx.tickExtraMuzzleFlashes(dt);
      });
      stage(3, 4, () => this.unitSim.updateUnits(dt));
      stage(5, 6, () => this.projectiles.updateShots(dt));
      if (this.player.phase === "dead" && !this.destruction.playerCrashStarted) this.destruction.beginPlayerCrash();
      stage(7, 8, () => this.destruction.updateDebris(dt));
      stage(9, 10, () => this.fx.updateSimParticles(dt));
      stage(11, undefined, () => {
        this.lockOn.update();
        this.fieldBars.draw();
        this.threatHud.drawArcs();
        this.fx.emitDamageFx();
        this.fx.emitHeliCrashDmgFlames();
        this.overlays.drawHits();
        if (this.sideView.on) this.sideView.draw();
      });
    }
    this.groundMarks.updateThermalWreckMarks(dt);
    this.groundMarks.updateEmberGlows(dt);
    this.ripples.update(dt);
    this.overlays.tickBlast(wallDt);

    if (this.relief.open) this.relief.tick(wallDt);
    this.overlays.drawAi();
    // Apply suppression after draw/debug updates so nothing can re-enable
    // itself over the theater map later in this frame.
    this.camera.setTheaterWorldHidden(this.camera.mapBlend > 0.5);

    const mapOn = this.camera.mapBlend > 0.12;
    this.syncHudParallax(wallDt);
    this.setHudVisible(!mapOn);
    if (mapOn) {
      this.camera.drawMapOverlay();
      this.trails.towWireGfx.clear();
      this.remoteBody.remoteAntennaGfx?.clear();
      this.tesla.gfx.clear();
      this.tesla.hideVisuals();
      this.trails.energyTrailGfx.clear();
      this.refractor.gfx.clear();
      this.countermeasures.gfx.clear();
    } else {
      this.camera.mapGfx.clear();
      this.camera.hideMapHvLabels();
      this.drawHud();
      this.minimap.draw();
      this.drawHvArrows();
      this.statusHud.draw();
      this.trails.drawTowWires();
      this.remoteBody.drawRemoteAntennas();
      this.trails.drawEnergyTrails();
      this.refractor.draw();
      this.tesla.drawArcs();
      this.countermeasures.drawFx();
    }

    if (this.camera.shake > 0 && this.camera.mapBlend < 0.12) {
      // Don't re-call shake() every frame — that restarts the effect and causes visible stutter.
      const shaking = this.cameras.main.shakeEffect?.isRunning;
      if (!shaking) {
        this.cameras.main.shake(90, Math.min(0.018, this.camera.shake * 0.0024));
        this.camera.shake = 0;
      } else {
        this.camera.shake *= 0.9;
        if (this.camera.shake < 0.06) this.camera.shake = 0;
      }
    }
    this.countermeasures.tickEmpFx(dt, wallDt);
    this.countermeasures.tickTimewarpFx(wallDt);
    this.countermeasures.tickWarpDistortFx();
    this.countermeasures.tickCloakFx();
    this.postFx.tick(wallDt);

    let hvAlive = false;
    let completedTarget: { x: number; y: number; z?: number } | undefined;
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
        // Moving HV (field officer) dies away from the site pin — focus the unit, not spawn.
        const corpse = this.units.find((q) => q.hv === h.id);
        const x = corpse?.x ?? h.x;
        const y = corpse?.y ?? h.y;
        const z = (corpse?.z ?? groundZ(this.world, x, y)) + 36;
        completedTarget = { x, y, z };
        if (this.player.phase !== "dead" && this.completedHv.size < this.world.hv.length) {
          this.flow.showStinger(
            "OBJECTIVE COMPLETE",
            `${h.name} · KILL`,
            0xe8b84a,
            4.2,
            completedTarget,
            undefined,
            "subtle"
          );
        }
      }
    }
    if (!hvAlive && this.player.phase !== "dead" && !this.missionEndQueued) {
      this.missionEndQueued = true;
      // Keep flight controls through the victory stinger; lock only when end() runs.
      this.flow.showStinger(
        "MISSION COMPLETE",
        `${missionOf().label} · all objectives neutralized`,
        0xe8b84a,
        5.2,
        completedTarget,
        () => this.flow.end(true),
        "dramatic"
      );
    }
    if (this.player.phase === "dead") {
      if (!this.destruction.playerCrashStarted) this.destruction.beginPlayerCrash();
      else if (this.destruction.playerCrashLanded && this.destruction.playerCrashEndT < 0) {
        this.destruction.playerCrashSimmerT -= wallDt;
        if (this.destruction.playerCrashSimmerT <= 0) this.destruction.playerCrashEndT = 0.55;
      } else if (this.destruction.playerCrashLanded && this.destruction.playerCrashEndT >= 0) {
        this.destruction.playerCrashEndT -= wallDt;
        if (this.destruction.playerCrashEndT <= 0) this.flow.end(false);
      }
    }
    if (perfOn && !mapPause) {
      this.perf.recordSample(dms, performance.now() - perfSceneStart);
    }
  }

  /**
   * Reactive armor's active hit radius — bigger than the hull itself, since the field
   * intercepts shots before they reach the plating. Drives both the hit-detection check in
   * `tryHit` (missionScene shot-update loop) and the spark burst origins below.
   */

  worldToHud(wx: number, wy: number): { x: number; y: number } {
    const cam = this.cameras.main;
    const view = cam.worldView;
    return {
      x: cam.x + (wx - view.x) * cam.zoom,
      y: cam.y + (wy - view.y) * cam.zoom,
    };
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

  worldToHudScreen(x: number, y: number, z: number): { sx: number; sy: number } {
    const cam = this.cameras.main;
    const view = cam.worldView;
    const at = worldToScreen(x, y, z);
    return {
      sx: ((at.x - view.x) / view.width) * this.scale.width,
      sy: ((at.y - view.y) / view.height) * this.scale.height,
    };
  }

  drawHud(): void {
    this.cornerHud.syncReadoutHud();
    this.prompts.syncLiftPrompt();
    this.prompts.syncRemotePrompt();
    this.prompts.syncDockAglAlert();
    this.threatHud.sync();

    this.cornerHud.syncObjectivesHud();
    this.cornerHud.layoutUpperRightHud();
    this.weaponHud.draw();
  }

  /** Radar: yellow diamond for player remotes. */
  drawMiniDiamond(x: number, y: number, r: number, color: number): void {
    const g = this.minimap.gfx;
    g.fillStyle(color, 1);
    g.fillTriangle(x, y - r, x + r, y, x, y + r);
    g.fillTriangle(x, y - r, x, y + r, x - r, y);
  }

  /** Radar: heading tick for in-flight missiles (yellow friendly / red enemy). */
  drawMiniMissileTick(x: number, y: number, angle: number, color: number): void {
    const len = 5.5;
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    this.minimap.gfx.lineStyle(2, color, 1);
    this.minimap.gfx.lineBetween(x - ca * len * 0.35, y - sa * len * 0.35, x + ca * len * 0.65, y + sa * len * 0.65);
  }

  drawHvArrows(): void {
    this.hvGfx.clear();
    if (this.camera.mapBlend > 0.12) {
      for (const t of this.hvArrowLabels) t.setVisible(false);
      this.parentArrowLabel?.setVisible(false);
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
      const vis = this.fireControl.unitOnHud(u, pad);
      let ax: number;
      let ay: number;
      let ang: number;
      if (vis.on) {
        const above = (radius(u.kind) + heightOf(u.kind) * 0.35) * cam.zoom + 18;
        ax = vis.sx;
        ay = Math.max(pad, vis.sy - above);
        ang = Math.PI / 2;
      } else {
        const look = this.camera.camLookWorld();
        const camHud = this.worldToHudScreen(look.x, look.y, look.z);
        ang = Math.atan2(vis.sy - camHud.sy, vis.sx - camHud.sx);
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
      const look = this.camera.camLookWorld();
      const dist = Math.hypot(u.x - look.x, u.y - look.y) | 0;
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
    this.drawParentCraftArrow(pad);
  }

  /**
   * While in remote POV (HOUND / Spectre / Raptor), yellow edge cue toward the
   * parent craft when it is off-screen — same layout as HV arrows, friendly color.
   */
  drawParentCraftArrow(pad = 40): void {
    const label = this.parentArrowLabel;
    if (!label) return;
    if (!this.remoteFleet.remoteView || !this.remoteFleet.activeRemote()) {
      label.setVisible(false);
      return;
    }
    const host = this.player;
    const { sx, sy } = this.worldToHudScreen(host.x, host.y, host.z);
    const w = this.scale.width;
    const h = this.scale.height;
    const on = sx > pad && sx < w - pad && sy > pad && sy < h - pad;
    if (on) {
      label.setVisible(false);
      return;
    }
    const look = this.camera.camLookWorld();
    const camHud = this.worldToHudScreen(look.x, look.y, look.z);
    const ang = Math.atan2(sy - camHud.sy, sx - camHud.sx);
    const ax = Phaser.Math.Clamp(sx, pad, w - pad);
    const ay = Phaser.Math.Clamp(sy, pad, h - pad);
    const g = this.hvGfx;
    g.save();
    g.translateCanvas(ax, ay);
    g.rotateCanvas(ang);
    g.fillStyle(0x12100c, 0.62);
    g.fillTriangle(15, 0, -10, -10, -10, 10);
    g.fillStyle(0xe8b84a, 0.96);
    g.fillTriangle(12, 0, -8, -7.5, -8, 7.5);
    g.lineStyle(1.6, 0xfff0a8, 0.95);
    g.strokeTriangle(12, 0, -8, -7.5, -8, 7.5);
    g.restore();

    const inset = 26;
    let lx = Phaser.Math.Clamp(ax - Math.cos(ang) * inset, 52, w - 52);
    let ly = Phaser.Math.Clamp(ay - Math.sin(ang) * inset, 22, h - 22);
    const miniDx = lx - (18 + 88);
    const miniDy = ly - (h - 18 - 88);
    if (Math.hypot(miniDx, miniDy) < 108) {
      const n = Math.hypot(miniDx, miniDy) || 1;
      lx = 18 + 88 + (miniDx / n) * 112;
      ly = h - 18 - 88 + (miniDy / n) * 112;
    }
    const dist = Math.hypot(host.x - look.x, host.y - look.y) | 0;
    const name = (host.spec.name ?? "HOST").toUpperCase();
    const lp = this.hudLocal(lx, ly);
    label
      .setVisible(true)
      .setText(`${name}\n${dist}m`)
      .setPosition(lp.x, lp.y)
      .setOrigin(0.5 + Math.cos(ang) * 0.42, 0.5 + Math.sin(ang) * 0.38)
      .setColor("#ffe08a")
      .setAlpha(0.95);
  }

  toggleTerrainMesh(): void {
    if (!this.terrain25d) return;
    this.terrainMesh = !this.terrainMesh;
    this.terrain25d.setVisible(this.terrainMesh);
    this.ground.setVisible(!this.terrainMesh);
    this.flatWreckage.setVisible(!!this.terrain25d && !this.terrainMesh && !this.overlays.showHeightMap);
    if (this.perf.enabled) this.perf.resetMeasurements();
    this.debugMenu.sync();
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
    for (const slots of this.fx.slots.values()) {
      for (const em of slots) em.timeScale = s;
    }
    for (const policy of Object.values(this.fx.policies)) {
      for (const em of policy.emitters) em.timeScale = s;
    }
    for (const em of [this.fx.smoke, this.fx.blastFire, this.fx.heliDust]) {
      if (em) em.timeScale = s;
    }
  }

  setupHudCam(): void {
    const w = this.scale.width;
    const h = this.scale.height;
    // Field tracking overlays share main's view transform but skip thermal/post-FX.
    this.fieldHudCam = this.cameras.add(0, 0, w, h);
    this.fieldHudCam.transparent = true;
    this.syncFieldHudCam();
    this.hudCam = this.cameras.add(0, 0, w, h);
    this.hudCam.transparent = true;
    this.hudCam.setScroll(0, 0);
    this.hudCam.setZoom(1);
    this.hudRoot = this.add.container(w / 2, h / 2);
    this.hudRoot.setDepth(Layer.HUD + 100);
    this.hudRoot.setScrollFactor(0);
    this.bindHud(this.hudRoot);
    this.bindHud(this.minimap.mask);
    const chrome: (Phaser.GameObjects.GameObject & { x: number; y: number })[] = [
      this.minimap.bg,
      this.minimap.terrain,
      this.minimap.wrecks,
      this.minimap.gfx,
      this.cornerHud.hud,
      this.postFx.hud,
      this.cornerHud.fpsHud,
      this.perf.hud,
      this.threatHud.paintTxt,
      this.threatHud.missileTxt,
      this.prompts.liftPrompt,
      this.prompts.remotePrompt,
      this.prompts.dockAglAlertTxt,
      this.cornerHud.hvHud,
      ...this.cornerHud.hvRows,
      this.statusHud.playerHud,
      this.statusHud.heliHudWireSh,
      this.statusHud.heliHudWire,
      this.weaponHud.wpnBar,
      ...this.weaponHud.wpnHudSlots.flatMap((s) => [s.key, s.name, s.ammo, s.status]),
      this.weaponHud.exitHudSlot.key,
      this.weaponHud.exitHudSlot.name,
      this.weaponHud.escortHudSlot.key,
      this.weaponHud.escortHudSlot.name,
      this.weaponHud.escortHudSlot.status,
      this.weaponHud.cmHudLabel,
      this.weaponHud.cmHudTime,
      this.weaponHud.btHudLabel,
      this.weaponHud.btHudTime,
      this.hvGfx,
      ...this.hvArrowLabels,
      this.parentArrowLabel,
      this.lockOn.arrowGfx,
      this.lockOn.hudTxt,
      this.lockOn.inbdHudTxt,
      this.help.button,
      this.flow.exitButton,
    ];
    for (const go of chrome) this.adoptHud(go);
    this.bindHud(this.statusHud.hurtVignette);
    this.bindHud(this.statusHud.hurtVignettePulse);
    this.statusHud.hurtVignette.setPosition(0, 0);
    this.statusHud.hurtVignettePulse.setPosition(0, 0);
    this.reticleHud.bindCameras();
    this.bindHud(this.camera.mapLabel);
    // World-anchored tracking HUD: lock boxes, unit HP — not thermalized.
    for (const go of [this.lockOn.gfx, this.lockOn.txt, this.lockOn.inbdTxt, this.fieldBars.hpGfx, this.threatHud.arcGfx, this.prompts.remoteArmedTxt]) {
      this.bindFieldHud(go);
    }
    // TOW wire / Tesla / Refractor / energy ribbons stay on the main cam (world depth).
    this.hudSet.delete(this.trails.towWireGfx);
    this.trails.towWireGfx.cameraFilter = this.hudCam.id | this.fieldHudCam.id;
    this.hudSet.delete(this.remoteBody.remoteAntennaGfx);
    this.remoteBody.remoteAntennaGfx.cameraFilter = this.hudCam.id | this.fieldHudCam.id;
    this.hudSet.delete(this.tesla.gfx);
    this.tesla.gfx.cameraFilter = this.hudCam.id | this.fieldHudCam.id;
    this.hudSet.delete(this.trails.energyTrailGfx);
    this.trails.energyTrailGfx.cameraFilter = this.hudCam.id | this.fieldHudCam.id;
    this.hudSet.delete(this.refractor.gfx);
    this.refractor.gfx.cameraFilter = this.hudCam.id | this.fieldHudCam.id;
    // Parallax clouds: main cam only, above craft (depth set at spawn).
    const cloudFilter = this.hudCam.id | this.fieldHudCam.id;
    for (const c of this.camera.planeClouds) c.im.cameraFilter = cloudFilter;
    const markHudTree = (obj: Phaser.GameObjects.GameObject) => {
      this.bindHud(obj);
      const list = (obj as Phaser.GameObjects.Container).list;
      if (list) for (const ch of list) markHudTree(ch);
    };
    markHudTree(this.debugMenu.root);
    markHudTree(this.help.fieldManual.root);
    markHudTree(this.flow.exitRoot);
    if (this.relief.root) markHudTree(this.relief.root);
    this.children.each((obj) => {
      if (!this.hudSet.has(obj)) this.bindWorld(obj);
    });
    const onAdded = (obj: Phaser.GameObjects.GameObject) => {
      if (this.hudSet.has(obj)) return;
      this.bindWorld(obj);
      if (this.camera.mapWorldHidden && !this.camera.theaterWorldKeep(obj)) {
        const visible = (obj as Phaser.GameObjects.GameObject & { visible: boolean }).visible;
        this.camera.mapWorldVisibility.set(obj, visible);
        (obj as Phaser.GameObjects.GameObject & { setVisible(value: boolean): unknown }).setVisible(false);
      }
    };
    this.events.on(Phaser.Scenes.Events.ADDED_TO_SCENE, onAdded);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.events.off(Phaser.Scenes.Events.ADDED_TO_SCENE, onAdded));
  }

  /** Keep field HUD camera aligned with the thermalized main view. */
  syncFieldHudCam(): void {
    if (!this.fieldHudCam) return;
    const main = this.cameras.main;
    this.fieldHudCam.setScroll(main.scrollX, main.scrollY);
    this.fieldHudCam.setZoom(main.zoom);
    if (this.fieldHudCam.width !== main.width || this.fieldHudCam.height !== main.height) {
      this.fieldHudCam.setSize(main.width, main.height);
    }
    // The Field Manual rebuilds its craft preview / focus-detail panel from scratch on every
    // sync — freshly created images/text default to the generic world camera filter (via the
    // scene's own "addedtoscene" bind-world fallback) instead of the HUD cameras, so re-mark
    // the whole tree each frame it's open to catch anything spawned since the last sync.
    if (this.help.fieldManual?.isOpen) this.markHudTree(this.help.fieldManual.root);
  }

  /** Screen-fixed chrome HUD (minimap, bars, reticle) — hudCam only. */
  bindHud(go: Phaser.GameObjects.GameObject): void {
    this.hudSet.add(go);
    (go as Phaser.GameObjects.GameObject & { setScrollFactor(x: number, y?: number): unknown })
      .setScrollFactor(0);
    go.cameraFilter = this.cameras.main.id | this.fieldHudCam.id;
  }

  /** Bind a container and every child — late-spawned HUD must not keep bindWorld filters. */
  markHudTree(obj: Phaser.GameObjects.GameObject): void {
    this.bindHud(obj);
    const list = (obj as Phaser.GameObjects.Container).list;
    if (list) for (const ch of list) this.markHudTree(ch);
  }

  /**
   * World-projected field tracking HUD (locks, HP bars).
   * Drawn by fieldHudCam (same scroll/zoom as main, no thermal pipeline).
   */
  bindFieldHud(go: Phaser.GameObjects.GameObject): void {
    this.hudSet.add(go);
    go.cameraFilter = this.cameras.main.id | this.hudCam.id;
  }

  adoptHud(go: Phaser.GameObjects.GameObject & { x: number; y: number }): void {
    this.bindHud(go);
    const lp = this.hudLocal(go.x, go.y);
    this.hudRoot.add(go);
    (go as typeof go & { setPosition(x: number, y: number): unknown }).setPosition(lp.x, lp.y);
  }

  bindWorld(go: Phaser.GameObjects.GameObject): void {
    if (this.hudSet.has(go)) return;
    go.cameraFilter |= this.hudCam.id | this.fieldHudCam.id;
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
    if (this.camera.mapBlend < 0.12 && !this.over && this.player.phase !== "dead") {
      const heli = this.player;
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
    this.minimap.mask.setPosition(0, 0);
    this.minimap.mask.clear();
    this.minimap.mask.fillStyle(0xffffff, 1);
    this.minimap.mask.fillCircle(this.hudRoot.x + clip.x * hs, this.hudRoot.y + clip.y * hs, 88 * hs);
  }

  /** Any cursor-owning overlay open (help, exit, editor, debug menus) — rig cursor sync reads this. */
  uiOverlayOpen(): boolean {
    const d = this.debugMenu;
    return this.help.open || this.flow.exitOpen || this.relief.open || d.open || d.camOpen || d.spawnOpen;
  }

  setHudVisible(on: boolean): void {
    this.cornerHud.hud.setVisible(on);
    this.prompts.liftPrompt.setVisible(on && this.player.phase === "ready");
    this.prompts.remotePrompt.setVisible(on && !!this.remoteFleet.pilotingRemote() && !this.remoteFleet.povHudRemote());
    this.cornerHud.hvHud.setVisible(on);
    for (const t of this.cornerHud.hvRows) t.setVisible(on);
    this.wpnHud.setVisible(on);
    this.weaponHud.wpnBar.setVisible(on);
    this.weaponHud.cmHudLabel.setVisible(on);
    this.weaponHud.cmHudTime.setVisible(on);
    for (const s of this.weaponHud.wpnHudSlots) {
      s.key.setVisible(on);
      s.name.setVisible(on);
      s.ammo.setVisible(on);
      // status visibility is owned by drawWeaponHud (auto stations only)
      if (!on) s.status.setVisible(false);
    }
    this.weaponHud.exitHudSlot.key.setVisible(false);
    this.weaponHud.exitHudSlot.name.setVisible(false);
    this.weaponHud.escortHudSlot.key.setVisible(false);
    this.weaponHud.escortHudSlot.name.setVisible(false);
    this.weaponHud.escortHudSlot.status.setVisible(false);
    this.statusHud.playerHud.setVisible(on);
    this.statusHud.heliHudWireSh.setVisible(on);
    this.statusHud.heliHudWire.setVisible(on);
    this.statusHud.hurtVignette.setVisible(on);
    this.statusHud.hurtVignettePulse.setVisible(on);
    this.minimap.gfx.setVisible(on);
    this.minimap.bg.setVisible(on);
    this.minimap.terrain.setVisible(on);
    this.minimap.wrecks.setVisible(on && !this.overlays.showHeightMap);
    this.hudRoot.setVisible(on);
    if (this.relief.root) this.relief.root.setVisible(this.relief.open && (on || this.camera.mapBlend > 0.12));
    this.fieldBars.hpGfx.setVisible(on);
    this.threatHud.arcGfx.setVisible(on);
    if (!on) this.prompts.remoteArmedTxt?.setVisible(false);
    if (on) {
      this.reticleHud.showAimChrome();
    } else {
      this.reticleHud.hideAimChrome();
      this.lockOn.gfx.setVisible(false);
      this.lockOn.gfx.clear();
      this.lockOn.txt.setVisible(false);
      this.lockOn.inbdTxt.setVisible(false);
      for (const t of this.lockOn.gpsDistTxt) if (t.active) t.setVisible(false);
      for (const t of this.callStrike.etaTxt) if (t.active) t.setVisible(false);
      this.lockOn.hudTxt.setVisible(false);
      this.lockOn.inbdHudTxt.setVisible(false);
      this.lockOn.arrowGfx.clear();
      this.statusHud.playerHud.clear();
      this.statusHud.hurtVignette.setVisible(false).setAlpha(0);
      this.statusHud.hurtVignettePulse.setVisible(false).setAlpha(0);
      this.minimap.gfx.clear();
    }
  }
}

/** Muted average of the terrain canvas — minimap fill past the playable map edge. */
function minimapTerrainBgColor(canvas: HTMLCanvasElement): number {
  const g = canvas.getContext("2d", { willReadFrequently: true });
  if (!g) return 0x2a2e28;
  const w = canvas.width;
  const h = canvas.height;
  if (w < 1 || h < 1) return 0x2a2e28;
  const step = Math.max(12, Math.floor(Math.min(w, h) / 48));
  const pix = g.getImageData(0, 0, w, h).data;
  let r = 0;
  let gg = 0;
  let b = 0;
  let n = 0;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const o = (y * w + x) * 4;
      r += pix[o]!;
      gg += pix[o + 1]!;
      b += pix[o + 2]!;
      n++;
    }
  }
  if (!n) return 0x2a2e28;
  r /= n;
  gg /= n;
  b /= n;
  const lum = 0.299 * r + 0.587 * gg + 0.114 * b;
  // Desaturate toward terrain luminance, then darken so the map disc still reads.
  const mute = 0.45;
  const dark = 0.58;
  const nr = Math.round(Math.min(255, Math.max(0, (r * (1 - mute) + lum * mute) * dark)));
  const ng = Math.round(Math.min(255, Math.max(0, (gg * (1 - mute) + lum * mute) * dark)));
  const nb = Math.round(Math.min(255, Math.max(0, (b * (1 - mute) + lum * mute) * dark)));
  return (nr << 16) | (ng << 8) | nb;
}

