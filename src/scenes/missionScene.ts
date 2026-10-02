import Phaser from "phaser";
import { Destruction } from "./mission/destruction/destruction";
import { GroundMarks } from "./mission/fx/groundMarks";
import { Trails } from "./mission/fx/trails";
import { Fx, type FxClass } from "./mission/fx/fx";
import { FireControl } from "./mission/weapons/fireControl";
import { Projectiles } from "./mission/weapons/projectiles";
import { ensureBlastRingGradient } from "../render/blastRing";
import { Countermeasures, TIMEWARP_PLAYER_SCALE, TIMEWARP_WORLD_SCALE } from "./mission/weapons/countermeasures";
import { LockOn } from "./mission/weapons/lockOn";
import { CallStrike } from "./mission/weapons/callStrike";
import { Refractor } from "./mission/weapons/refractor";
import { TESLA_SEGS, TESLA_STREAMS, Tesla } from "./mission/weapons/tesla";
import { RemoteBody } from "./mission/remote/body";
import { RemoteFleet } from "./mission/remote/fleet";
import { planeLookCam } from "./mission/shared";
import { PostFxTest } from "./mission/debug/postFx";
import { DebugOverlays } from "./mission/debug/overlays";
import { HelpPanel } from "./mission/hud/help";
import { CornerHud } from "./mission/hud/cornerHud";
import { PromptsHud } from "./mission/hud/prompts";
import { UnitSim } from "./mission/enemy/unitSim";
import { EnemyFire } from "./mission/enemy/enemyFire";
import { EnemyTargeting } from "./mission/enemy/targeting";
import { gunWorldRot } from "../art/spriteOrigin";
import { RemoteAi } from "./mission/remote/ai";
import { simParticleTexKey, simParticleLook } from "../render/simParticleLook";
import { thermalSignalTint, applyThermalHeat } from "../render/thermal";
import { ReticleHud } from "./mission/hud/reticleHud";
import { Minimap } from "./mission/hud/minimap";
import { StatusHud } from "./mission/hud/statusHud";
import { WeaponHud } from "./mission/hud/weaponHud";
import { BATTERY_ICON_W } from "./mission/tuning";
import { BULLET_TIME_SCALE } from "./mission/weapons/countermeasures";
import { ThreatHud } from "./mission/hud/threatHud";
import { DebugMenu } from "./mission/debug/menu";
import { ReliefEditor } from "./mission/debug/relief";
import { SideView } from "./mission/debug/sideView";
import { PerfMonitor } from "./mission/debug/perf";
import { createFxEmitters } from "./mission/fx/emitters";
import { resolveSkin } from "../render/camo";
import { heightOf, radius, textureOf, playerLoadoutFromSockets, launchIsArcBeam, PLAYER_WPNS, type Debris, type Shot, type Unit, type PlayerWpnSpec } from "../sim/combat";


















import { type RemoteCraft } from "../sim/remote";
import { Layer, ZOff, worldDepth } from "../render/depth";
import { range } from "../util/rng";
import { Craft, MAP_AIR_SOFT, craftCameraEdgeLocked } from "../sim/craft";
import { ensureAllArtGenAnims } from "../art/artGen";
import { isGroundVehicle, isOrganic, specOf, labelOf, gunsOf, crewOf } from "../sim/roster";
import { lookupSpriteMuzzles, lookupSpriteOrigin } from "../art/spriteOrigin";
import { craftAimsWithTurret, craftCameraScale, craftCloudParallax, craftComposite, craftCompositePartScale, craftExhaustFlameHue, craftExhaustFlameSheet, craftExhaustMounts, craftGunOrigin, craftGunSocketSlots, craftControlScheme, craftOf, craftOrigin, craftPreviewExhaustScale, craftPreviewExhaustTint, craftRotorAlongScale, craftRotorFlightSpeed, craftRotorTiltMul, craftSocketGunScale, craftWingTipMounts, rotorMountsOf, rotorSpinSign, type CraftComposite } from "../sim/crafts";
import { missionOf } from "../sim/mission";
import { rigsAnyOpen, installRigHotkeys } from "../rigs/rigs";
import { applyEdgeLight, clearEdgeLight, ensureEdgeLightPipeline } from "../render/edgeLight";
import { setThermalPipeline, type ThermalPalette } from "../render/thermal";
import { setGlitchPipeline } from "../render/glitch";
import { setWarpDistortPipeline } from "../render/warpDistort";
import { setCloakFxPipeline } from "../render/cloakFx";
import { createTerrain25D, type Terrain25D } from "../render/terrain25d";
import { extractBiomeTiles, bakeHeliHudWireTexture, shadowAlpha, shadowKey, spriteUvPos, FX_VARIANTS, registerArt, nameGameTexture, spritePivot, muzzleGlowKey, ensureExhaustGlow, ensureImpactGlow } from "../art/sprites";
import { generateWorld, worldFromGen, groundSlope, groundZ, worldToScreen, setCamera25DFocus, cameraPointVisible, screenToWorldAtZ, screenToWorldOnGround, screenVelX, screenVelY, projectHeading, camZoomAt, castZ, castShadowToGround, isWater, paintHeightMap, sampleBiome, waterSurfaceZ, WORLD, WRECK_TEX, CamTune, type WorldData } from "../worldgen/world";










type StingerJob = {
  title: string;
  detail: string;
  color: number;
  duration: number;
  target?: { x: number; y: number; z?: number };
  done?: () => void;
  /** Subtle = no bar, quieter type; Space frees cam/message early (time warp stays). */
  style?: "dramatic" | "subtle";
};











/** How far aircraft may overshoot before a soft cap (jets / enemy air) — see craft.MAP_AIR_SOFT. */

type TextureAlphaBounds = {
  width: number;
  height: number;
  alpha: Uint8ClampedArray;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};


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
  // destruction
  destruction = new Destruction(this);
  // hud
  weaponHud = new WeaponHud(this);
  statusHud = new StatusHud(this);
  threatHud = new ThreatHud(this);
  reticleHud = new ReticleHud(this);
  minimap = new Minimap(this);
  cornerHud = new CornerHud(this);
  prompts = new PromptsHud(this);
  help = new HelpPanel(this);
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
  body!: Phaser.GameObjects.Image;
  rotor!: Phaser.GameObjects.Image;
  rotors: Phaser.GameObjects.Image[] = [];
  craftParts!: CraftComposite;
  gun!: Phaser.GameObjects.Image;
  guns: Phaser.GameObjects.Image[] = [];
  /** Additive tip heat glows paired 1:1 with turret `guns` (not fixed muzzles). */
  gunHeatGlows: Phaser.GameObjects.Image[] = [];
  /** Tip glow heat 0–1 (snap on fire, ~9s fade). */
  gunTipHeat: number[] = [];
  shadow!: Phaser.GameObjects.Image;
  unitG!: Phaser.GameObjects.Group;
  thermalHotspotG!: Phaser.GameObjects.Group;
  exhaustFlames: Phaser.GameObjects.Image[] = [];
  /** Soft nozzle glow (preview-style) — ramps on spool, tracks thrust in flight. */
  exhaustEngineGlows: Phaser.GameObjects.Image[] = [];
  /** Hue ColorMatrix on each nozzle flame (preserves source grading). */
  exhaustFlameHueFx: (Phaser.FX.ColorMatrix | undefined)[] = [];
  exhaustEmitCarry = 0;
  exhaustMountCursor = 0;
  exhaustPrevWorld: ({ x: number; y: number; z: number } | undefined)[] = [];
  wingTrailEmitCarry = 0;
  wingTrailMountCursor = 0;
  /** Prior screen-space tip emit points (draw-pose aligned). */
  wingTrailPrevScreen: ({ x: number; y: number } | undefined)[] = [];
  /** Last applied sim timeScale (skip walking ~N emitters when unchanged). */
  lastSimScale = Number.NaN;
  /** Effective world rate this frame (debug scale × timewarp / bullet time / stinger / warp shots). */
  liveSimScale = 1;
  thermalFx?: Phaser.FX.ColorMatrix;
  thermalOn = false;
  /** Player toggled thermal with T (persists across sensor-view overlays). */
  thermalManual = false;
  thermalPalette: ThermalPalette = "white_hot";
  wpnHud!: Phaser.GameObjects.Text;
  hpGfx!: Phaser.GameObjects.Graphics;
  mapLabel!: Phaser.GameObjects.Text;
  mapHvLabels: Phaser.GameObjects.Text[] = [];
  hvArrowLabels: Phaser.GameObjects.Text[] = [];
  /** Yellow edge cue back to host while piloting a remote POV. */
  parentArrowLabel!: Phaser.GameObjects.Text;
  mapGfx!: Phaser.GameObjects.Graphics;
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
  win = false;
  completedHv = new Set<string>();
  missionEndQueued = false;
  stingerRoot?: Phaser.GameObjects.Container;
  stingerText?: Phaser.GameObjects.Text;
  stingerT = 0;
  stingerDuration = 0;
  stingerDone?: () => void;
  stingerTarget?: { x: number; y: number; z?: number };
  /** Queued while another stinger is on screen. */
  stingerQueue: StingerJob[] = [];
  stingerStyle: "dramatic" | "subtle" = "dramatic";
  /** Space dismissed subtle stinger chrome/cam early; timer (time warp) continues. */
  stingerReleased = false;
  /**
   * Subtle Space-dismiss is armed only after Space goes up once (so a held climb
   * key doesn't eat the focus cam) and after the arrive window.
   */
  stingerSpaceArmed = false;
  /** Look offset when the current stinger started — ease from here, not from the player. */
  stingerCamFromX = 0;
  stingerCamFromY = 0;
  /** Focus altitude when the stinger started — ease with look so 2.5D scale doesn't pop. */
  stingerCamFromZ = 0;
  /** Live blended focus Z while a stinger owns the cam. */
  stingerFocusZ = 0;
  /** Keep thermal/sensor palette during povCam impact linger after the shot is gone. */
  sensorLingerPalette: ThermalPalette | null = null;
  sensorLingerT = 0;
  /** Warp slow-mo held through impact-cam linger after the bomb is gone. */
  warpLingerScale: number | null = null;
  /** End-screen prompt (BIRD DOWN / MISSION COMPLETE) — sim keeps running. */
  endPromptRoot?: Phaser.GameObjects.Container;
  shake = 0;
  mapView = false;
  mapWant = false;
  mapBlend = 0;
  mapWorldHidden = false;
  mapWorldVisibility = new Map<Phaser.GameObjects.GameObject, boolean>();
  camZoom = CamTune.zoom0;
  camFollow = false;
  lookCamX = 0;
  lookCamY = 0;
  /** Fixed-wing altitude cloud sprites (scroll-factor parallax). */
  planeClouds: {
    im: Phaser.GameObjects.Image;
    baseX: number;
    baseY: number;
    driftAng: number;
    driftSpd: number;
  }[] = [];
  /** Off-map soft cloud / fog sprites (leave-theater; flat world XY). */
  leaveTheaterClouds: Phaser.GameObjects.Image[] = [];
  /** Off-map mountain peaks — 2.5D projected like units (leave-theater only). */
  leaveTheaterPeaks: {
    im: Phaser.GameObjects.Image;
    x: number;
    y: number;
    z: number;
    sx: number;
    sy: number;
  }[] = [];
  povCamLookHold = 0;
  /** Wall-clock dt for this frame (warp missiles ignore sim slowmo). */
  frameWallDt = 0;
  remotes: RemoteCraft[] = [];
  keyE!: Phaser.Input.Keyboard.Key;
  /** Player craft's own step this frame (Time Warp privileged time) — motion + turret slew. */
  playerDt = 0;
  povCamLookX = 0;
  povCamLookY = 0;
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
  /** Cached texture span / trail radius (key → px). */
  private texSpanCache = new Map<string, number>();
  private textureAlphaCache = new Map<string, TextureAlphaBounds | null>();
  timeScale = 1;
  /** Sim-time accumulator for the player hover bob, so it scales with timeScale. */
  bobPhase = 0;
  exitOpen = false;
  exitRoot!: Phaser.GameObjects.Container;
  exitButton!: Phaser.GameObjects.Text;
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
    this.stingerQueue = [];
    this.destruction.reset();
    this.endPromptRoot = undefined;
    this.postFx.reset();
    this.terrain25d = undefined;
    this.fx.reset();
    this.hudSet.clear();
    this.lastSimScale = Number.NaN;
    for (const policy of Object.values(this.fx.policies)) {
      policy.emitted = 0;
      policy.emitters.clear();
    }
    this.shake = 0;
    this.mapView = false;
    this.mapWant = false;
    this.mapBlend = 0;
    this.mapWorldHidden = false;
    this.mapWorldVisibility.clear();
    this.camFollow = false;
    this.lookCamX = 0;
    this.lookCamY = 0;
    this.planeClouds = [];
    this.leaveTheaterClouds = [];
    this.leaveTheaterPeaks = [];
    this.povCamLookHold = 0;
    this.povCamLookX = 0;
    this.povCamLookY = 0;
    this.sensorLingerPalette = null;
    this.sensorLingerT = 0;
    this.warpLingerScale = null;
    this.stingerReleased = false;
    this.stingerSpaceArmed = false;
    this.stingerCamFromX = 0;
    this.stingerCamFromY = 0;
    this.stingerCamFromZ = 0;
    this.stingerFocusZ = 0;
    this.playLastFrame = false;
    this.overlays.reset();
    this.sideView.reset();
    this.thermalOn = false;
    this.thermalManual = false;
    this.thermalPalette = "white_hot";
    this.callStrike.reset();
    this.refractor.reset();
    this.remotes = [];
    this.countermeasures.reset();
    this.tesla.reset();
    this.terrainMesh = true;
    this.help.reset();
    this.exitOpen = false;
    this.debugMenu.reset();
    // Scene restart destroys pooled images — drop stale refs so they're rebuilt.
    this.remoteBody.reset();
    this.relief.reset();
    this.shots = [];
    this.trails.reset();
    this.debris = [];
    this.lockOn.reset();
    this.groundMarks.reset();
    for (const g of this.groundMarks.emberGlows) {
      g.image.destroy();
      g.bloom.destroy();
    }
    this.exhaustPrevWorld = [];
    this.exhaustMountCursor = 0;
    this.wingTrailPrevScreen = [];
    this.wingTrailEmitCarry = 0;
    this.wingTrailMountCursor = 0;
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
    ensureEdgeLightPipeline(this.game);
    this.groundMarks.stampDecor();
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
    this.fireControl.canFire = !this.input.activePointer.isDown;
    this.input.on("pointerup", () => {
      this.fireControl.canFire = true;
    });
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      if (this.debugMenu.open || this.help.open || this.exitOpen || this.relief.open || this.mapView) return;
      if (p.rightButtonDown()) this.remoteFleet.exitRemoteView();
    });

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

    this.unitG = this.add.group();
    this.projectiles.shotG = this.add.group();
    this.projectiles.photonFxG = this.add.group();
    this.remoteBody.remoteG = this.add.group();
    this.destruction.debrisG = this.add.group();
    this.fx.simParticleG = this.add.group();
    this.countermeasures.smokePuffG = this.add.group();
    this.thermalHotspotG = this.add.group();

    this.player = new Craft(this.world.spawnX, this.world.spawnY, this.world);
    if (this.player.spec.flightModel === "plane") {
      const inward = Math.atan2(WORLD * 0.5 - this.player.y, WORLD * 0.5 - this.player.x);
      this.player.startAirborne(inward, this.world);
    } else {
      this.player.angle = 0.6;
      this.player.syncStationAimToHull();
    }
    this.createLeaveTheaterSky();
    this.createPlaneCloudParallax();
    setCamera25DFocus(this.player.x, this.player.y, this.player.z);
    const craft = this.player.spec;
    this.craftParts = craftComposite(craft);
    this.shadow = this.add.image(0, 0, "fx_shadow").setDepth(Layer.SHADOW);
    this.guns = this.craftParts.guns.map((part) =>
      this.add
        .image(0, 0, part.tex)
        .setDepth(Layer.WORLD)
        .setOrigin(part.origin.x, part.origin.y)
    );
    this.gunHeatGlows = this.guns.map((gun) => {
      const glowTex = muzzleGlowKey(gun.texture.key);
      const key = this.textures.exists(glowTex) ? glowTex : gun.texture.key;
      return this.add
        .image(0, 0, key)
        .setVisible(false)
        .setOrigin(gun.originX, gun.originY)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(Layer.WORLD);
    });
    this.gunTipHeat = this.guns.map(() => 0);
    this.gun =
      this.guns[0] ??
      this.add
        .image(0, 0, "fx_muzzle")
        .setDepth(Layer.WORLD)
        .setOrigin(craftGunOrigin(craft).x, craftGunOrigin(craft).y)
        .setVisible(false);
    this.body = this.add.image(0, 0, this.craftParts.body.tex).setDepth(Layer.WORLD).setOrigin(this.craftParts.body.origin.x, this.craftParts.body.origin.y);
    this.exhaustFlames = craftExhaustMounts(craft).map(() =>
      this.add
        .image(0, 0, "fx_exhaust")
        .setDepth(Layer.WORLD)
        .setOrigin(0, 0.5)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setVisible(false)
    );
    this.exhaustEngineGlows = craftExhaustMounts(craft).map(() =>
      this.add
        .image(0, 0, "fx_exhaust_glow")
        .setDepth(Layer.WORLD)
        // Top-middle = nozzle; plume hangs in local +Y (exhaust).
        .setOrigin(0.5, 0)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setTint(craftPreviewExhaustTint(craft.kind))
        .setVisible(false)
    );
    this.exhaustFlameHueFx = this.exhaustFlames.map((flame) => {
      const fx = flame.preFX?.addColorMatrix();
      if (fx) fx.hue(craftExhaustFlameHue(craft.kind));
      return fx;
    });
    const rotorTex = this.craftParts.rotors[0]?.tex ?? "craft_apache_rotor";
    this.rotors = this.craftParts.rotors.map((part) =>
      this.add.image(0, 0, part.tex).setDepth(Layer.WORLD).setOrigin(part.origin.x, part.origin.y)
    );
    this.rotor =
      this.rotors[0] ??
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
    this.body.setPosition(this.player.x, this.player.y);
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

    this.units = [];
    for (const s of this.world.spawns) {
      const u = this.unitSim.makeUnit(s.kind, s.x, s.y);
      u.hv = s.hv;
      this.units.push(u);
    }
    const posted: Unit[] = [];
    for (const host of this.units) {
      posted.push(...this.unitSim.spawnCrewFor(host));
    }
    this.units.push(...posted);

    createFxEmitters(this);
    // Scene events survive restart — drop on shutdown or handlers stack per mission.
    const onPostUpdate = () => this.tintThermalParticles();
    this.events.on(Phaser.Scenes.Events.POST_UPDATE, onPostUpdate);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.events.off(Phaser.Scenes.Events.POST_UPDATE, onPostUpdate));
    this.applyTimeScale();

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
      if (this.relief.open || this.debugMenu.open || this.help.open || this.exitOpen) return;
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
      if (!this.help.open && !this.exitOpen) this.toggleMap();
    });
    this.input.keyboard!.addKey("H").on("down", () => {
      if (!this.exitOpen) this.help.toggle();
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
      else this.toggleExitMenu();
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
      if (this.relief.open || this.debugMenu.open || this.help.open || this.exitOpen) return;
      this.postFx.toggle();
    });
    this.input.keyboard!.addKey("T").on("down", () => this.toggleThermal());
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
    this.hpGfx = this.add.graphics().setDepth(Layer.FIELD);
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
    this.mapGfx = this.add.graphics().setDepth(Layer.FIELD);
    this.mapHvLabels = [];
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

    this.cameras.main.centerOn(this.player.x, this.player.y);
    this.cameras.main.setZoom(this.playZoom());
    // Chase cam stays on-map only for craft without forced U-turn.
    this.cameras.main.useBounds = craftCameraEdgeLocked(this.player.spec);
    this.camZoom = this.playZoom();
    this.playScrollX = this.player.x - this.scale.width / 2;
    this.playScrollY = this.player.y - this.scale.height / 2;
    this.playViewX = this.playScrollX;
    this.playViewY = this.playScrollY;
    this.playViewW = this.scale.width;
    this.playViewH = this.scale.height;
    this.playLastFrame = true;
    this.debugMenu.setup();
    this.help.setup();
    this.setupExitMenu();
    this.setupHudCam();
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
    const mapPause = this.mapWant || this.mapBlend > 0.02;
    const uiPause = mapPause || this.help.open || this.exitOpen;
    let simScale = this.timeScale;
    if (this.stingerT > 0) simScale = Math.min(simScale, 0.18);
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
      if (this.povCamLookHold > 0) simScale = Math.min(simScale, this.warpLingerScale);
      else this.warpLingerScale = null;
    }
    const dt = uiPause ? 0 : wallDt * simScale;
    // Time Warp bonus: the player craft's own motion only slows to TIMEWARP_PLAYER_SCALE.
    const playerDt =
      !uiPause && this.countermeasures.timewarpT > 0 ? Math.max(dt, wallDt * TIMEWARP_PLAYER_SCALE) : dt;
    this.playerDt = playerDt;
    this.liveSimScale = simScale;
    this.setSimTimeScale(uiPause ? 0 : simScale);
    this.tickStinger(wallDt);
    for (const policy of Object.values(this.fx.policies)) policy.emitted = 0;
    this.cornerHud.syncFpsHud();
    if (this.over) {
      // End prompt is up, but the world keeps simmering (debris, units, fire).
      const endDt = uiPause ? 0 : wallDt * this.timeScale;
      this.setSimTimeScale(uiPause ? 0 : this.timeScale);
      this.syncPlayView();
      if (this.mapBlend < 0.001) this.syncLookCam(wallDt);
      if (!mapPause) {
        this.unitSim.rebuildUnitIdMap();
        this.unitSim.updateUnits(endDt);
        this.projectiles.updateShots(endDt);
        this.destruction.updateDebris(endDt);
        this.fx.updateSimParticles(endDt);
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
    this.syncPlayView();
    this.updateTheaterCam(wallDt);
    if (this.mapBlend < 0.001) this.syncLookCam(wallDt);
    this.syncPlaneCloudParallax(dt);

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
                  !(this.stingerStyle === "subtle" && this.stingerT > 0 && !this.stingerReleased),
            dockDescend || (escort ? false : this.keyShift.isDown)
          );
          if (escort?.brake || dockSeq) this.remoteFleet.brakeHostEscort(dt);
          if (escort?.speedCap != null) this.remoteFleet.capHostEscortSpeed(escort.speedCap);
        }
        this.syncProjectionPose();
        this.syncLeaveTheaterPeaks();
        this.syncHeliGfx(dt);
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
        this.drawUnitBars();
        this.threatHud.drawArcs();
        this.fx.emitDamageFx();
        this.fx.emitHeliCrashDmgFlames();
        this.overlays.drawHits();
        if (this.sideView.on) this.sideView.draw();
      });
    }
    this.groundMarks.updateThermalWreckMarks(dt);
    this.groundMarks.updateEmberGlows(dt);
    this.overlays.tickBlast(wallDt);

    if (this.relief.open) this.relief.tick(wallDt);
    this.overlays.drawAi();
    // Apply suppression after draw/debug updates so nothing can re-enable
    // itself over the theater map later in this frame.
    this.setTheaterWorldHidden(this.mapBlend > 0.5);

    const mapOn = this.mapBlend > 0.12;
    this.syncHudParallax(wallDt);
    this.setHudVisible(!mapOn);
    if (mapOn) {
      this.drawMapOverlay();
      this.trails.towWireGfx.clear();
      this.remoteBody.remoteAntennaGfx?.clear();
      this.tesla.gfx.clear();
      this.tesla.hideVisuals();
      this.trails.energyTrailGfx.clear();
      this.refractor.gfx.clear();
      this.countermeasures.gfx.clear();
    } else {
      this.mapGfx.clear();
      this.hideMapHvLabels();
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
          this.showStinger(
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
      this.showStinger(
        "MISSION COMPLETE",
        `${missionOf().label} · all objectives neutralized`,
        0xe8b84a,
        5.2,
        completedTarget,
        () => this.end(true),
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
        if (this.destruction.playerCrashEndT <= 0) this.end(false);
      }
    }
    if (perfOn && !mapPause) {
      this.perf.recordSample(dms, performance.now() - perfSceneStart);
    }
  }

  spriteOrigin(key: string): { x: number; y: number } {
    if (key === "craft_apache_rotor") return { x: this.rotor.originX, y: this.rotor.originY };
    return spritePivot(key);
  }


  /** Fixed-sprite troops: `angle` = move base, `turret` = aim / draw facing. */
  troopSoftTurret(u: Unit): boolean {
    const sp = specOf(u.kind);
    return !gunsOf(u).length && (sp.behavior === "attack_infantry" || sp.behavior === "flee_infantry");
  }

  troopDrawAng(u: Unit): number {
    return this.troopSoftTurret(u) ? u.turret : u.angle;
  }

  /**
   * Projected hull facing with rate-limited draw rotation.
   * Near 2.5D poles, hold or prefer π continuity; otherwise always chase true
   * projection so a one-frame flip cannot lock the sprite nose-aft forever.
   */
  unitDrawRot(u: Unit, worldRot: number): number {
    const vx = Math.cos(worldRot);
    const vy = Math.sin(worldRot);
    const sx = screenVelX(vx, vy, 0, u.x, u.y, u.z);
    const sy = screenVelY(vy, 0, u.z, u.y);
    const mag = Math.hypot(sx, sy);
    let raw = Math.atan2(sy, sx);
    const prev = u.drawRot;
    if (prev == null || !Number.isFinite(prev)) {
      u.drawRot = raw;
      return raw;
    }
    // Collapsed projection (into/out of camera) → hold prior draw facing.
    if (mag < 0.08) return prev;
    // Only near the singularity: π-flip toward prev. Healthy mag always trusts raw.
    if (mag < 0.35) {
      const jump = Math.abs(Phaser.Math.Angle.Wrap(raw - prev));
      if (jump > Math.PI * 0.55) {
        const flipped = Phaser.Math.Angle.Wrap(raw + Math.PI);
        if (Math.abs(Phaser.Math.Angle.Wrap(flipped - prev)) < jump) raw = flipped;
        else return prev;
      }
    }
    const visDt = Math.min(0.05, (this.game.loop.delta || 16) / 1000);
    u.drawRot = this.steerUnitAngle(prev, raw, 2.8, visDt);
    return u.drawRot;
  }

  /**
   * Sim yaw toward `want`. Caps hitch dt and per-tick step so units never
   * flip 180° in one frame even with high turn rates or large dt spikes.
   */
  steerUnitAngle(angle: number, want: number, rate: number, dt: number): number {
    const stepDt = Math.min(Math.max(0, dt), 1 / 20);
    // ~10°/tick hard cap — turns always take multiple frames, never axis snaps.
    const maxStep = Math.min(Math.abs(rate) * stepDt, 0.18);
    return Phaser.Math.Angle.RotateTo(angle, want, maxStep);
  }

  /** Smoothed projected aim for overlay guns / soft troop facing. */
  unitAimDrawRot(u: Unit, key: string, worldRot: number): number {
    if (!u.aimDrawRots) u.aimDrawRots = {};
    const vx = Math.cos(worldRot);
    const vy = Math.sin(worldRot);
    const sx = screenVelX(vx, vy, 0, u.x, u.y, u.z);
    const sy = screenVelY(vy, 0, u.z, u.y);
    const mag = Math.hypot(sx, sy);
    let raw = Math.atan2(sy, sx);
    const prev = u.aimDrawRots[key];
    if (prev == null || !Number.isFinite(prev)) {
      u.aimDrawRots[key] = raw;
      return raw;
    }
    if (mag < 0.08) return prev;
    if (mag < 0.35) {
      const jump = Math.abs(Phaser.Math.Angle.Wrap(raw - prev));
      if (jump > Math.PI * 0.55) {
        const flipped = Phaser.Math.Angle.Wrap(raw + Math.PI);
        if (Math.abs(Phaser.Math.Angle.Wrap(flipped - prev)) < jump) raw = flipped;
        else return prev;
      }
    }
    const visDt = Math.min(0.05, (this.game.loop.delta || 16) / 1000);
    u.aimDrawRots[key] = this.steerUnitAngle(prev, raw, 3.2, visDt);
    return u.aimDrawRots[key]!;
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


  /** Host that snaps pinned crew to a mount UV (e.g. vehicle bed) — blocks flee/walk. */
  snapHost(u: Unit): Unit | undefined {
    if (u.pinId == null) return undefined;
    const post = this.unitSim.unitById(u.pinId);
    if (!post) return undefined;
    return crewOf(post.kind)?.mode === "snap" ? post : undefined;
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
    cacheOwner?: object,
    /** When set, use this screen rotation (keeps shadow locked to body drawRot). */
    screenRot?: number
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
    const sk = this.textures.exists(want) ? want : "fx_shadow";
    if (sh.texture.key !== sk) sh.setTexture(sk);
    sh.setPosition(at.x, at.y)
      .setRotation(
        screenRot != null && Number.isFinite(screenRot)
          ? screenRot
          : projectHeading(rot, resolved.x, resolved.y, resolved.z)
      )
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
    const h = this.player;
    if (h.phase === "dead") {
      this.unwrapTilt(this.body);
      this.body.setVisible(false);
      for (const rotor of this.rotors) {
        this.unwrapTilt(rotor);
        rotor.setVisible(false);
      }
      for (const gun of this.guns) gun.setVisible(false);
      this.gun.setVisible(false);
      for (const glow of this.gunHeatGlows) glow.setVisible(false);
      this.shadow.setVisible(false);
      for (const muzzle of this.fx.muzzlePool) muzzle.setVisible(false);
      for (const glow of this.fx.muzzleGlowPool) glow.setVisible(false);
      for (const flame of this.exhaustFlames) flame.setVisible(false);
      for (const glow of this.exhaustEngineGlows) glow.setVisible(false);
      for (const glow of this.countermeasures.reactiveArmorGlows) glow.setVisible(false);
      this.reticleHud.hideAimChrome();
      return;
    }
    const craft = h.spec;
    this.applyCastShadow(this.shadow, h.x, h.y, h.z, craft.body, h.angle + craft.rotOff);
    this.shadow.setOrigin(craftOrigin(craft).x, craftOrigin(craft).y);
    const scr = worldToScreen(h.x, h.y, h.z);
    const zs = scr.scale;
    this.bobPhase += dt;
    const bob =
      h.phase === "flight" && craft.flightModel !== "plane"
        ? Math.sin(this.bobPhase * 2.6) * 2.2 * zs
        : 0;
    const bodyRot = projectHeading(h.angle + craft.rotOff, h.x, h.y, h.z);
    this.body.setOrigin(craftOrigin(craft).x, craftOrigin(craft).y);
    const planeScheme = craftControlScheme(craft) === "plane";
    if (planeScheme && !craft.flatHull) {
      // Billboard bank: foreshorten wing span with cos(roll), keep heading on the wrap.
      const wrap = this.ensureBodyTiltWrap();
      const bankAng = h.roll * 1.05;
      const wingScale = Math.max(0.24, Math.abs(Math.cos(bankAng)));
      const alongScale = 1 - Math.abs(h.pitch) * 0.08;
      wrap
        .setVisible(true)
        .setPosition(scr.x, scr.y - bob)
        .setRotation(bodyRot)
        .setScale(zs * wingScale, zs * alongScale);
      this.body
        .setVisible(true)
        .setPosition(0, 0)
        .setRotation(0)
        .setScale(1);
    } else {
      this.unwrapTilt(this.body);
      this.body
        .setVisible(true)
        .setPosition(scr.x, scr.y - bob)
        .setRotation(bodyRot);
      // Flat hulls stay a plate — no roll squash from A/D yaw / strafe.
      const sx = craft.flatHull ? 1 : 1 + Math.abs(h.roll) * 0.12;
      const sy = craft.flatHull ? 1 : 1 - Math.abs(h.pitch) * 0.14;
      this.body.setScale(sx * zs, sy * zs);
    }
    const bodyPose = this.heliBodyDrawPose();
    const tiltRot = projectHeading(h.angle, h.x, h.y, h.z);
    const tiltMul = craftRotorTiltMul(craft);
    const rOffF = h.pitch * 16 * zs * tiltMul;
    const rOffS = h.roll * 14 * zs * tiltMul;
    const gunParts = this.craftParts.guns;
    const gunSlots = craftGunSocketSlots(craft);
    const aimSlot =
      gunSlots.find((slot) => craft.sockets[slot]?.controller !== "automatic") ??
      (craft.sockets[h.weapon]?.class === "turret"
        ? h.weapon
        : gunSlots[0]);
    const aimMountUv =
      (aimSlot != null ? gunParts[gunSlots.indexOf(aimSlot)]?.mount : undefined) ??
      gunParts[0]?.mount ??
      craftOrigin(craft);
    const aimMount = spriteUvPos(bodyPose, aimMountUv.x, aimMountUv.y);
    // Aim from the muzzle tip (not the mount) at the 2.5D reticle point.
    // Player mouse drives automatic stations only when selected; otherwise they track themselves.
    if (!craftAimsWithTurret(craft)) {
      h.gunAngle = h.angle;
      h.syncStationAimToHull();
    } else if (h.phase === "flight" || h.phase === "ready" || h.phase === "spool") {
      const arcSpec = this.loadout[h.weapon];
      const arcAim =
        launchIsArcBeam(arcSpec?.launch)
          ? this.tesla.pickTarget(
              this.tesla.muzzleOrigin(h.weapon),
              this.worldPointer()
            )
          : undefined;
      const aim = this.fireControl.reticleAimWorld(arcAim ?? this.fireControl.reticleUnit());
      const gunI = aimSlot != null ? this.gunVisualIndexForSlot(aimSlot) : 0;
      const from = this.guns[gunI]?.visible
        ? this.gunTip(gunI)
        : screenToWorldAtZ(aimMount.x, aimMount.y + bob, h.z);
      let want = Math.atan2(aim.y - from.y, aim.x - from.x);
      // Spotting / call-strike: drive the host howitzer station (may be automatic).
      const spotSlot = this.fireControl.hostSpotSlewSlot();
      const hostWalk = this.callStrike.marks.find(
        (m) => m.hostWeapon && m.roundsLeft > 0
      );
      if (spotSlot >= 0) {
        const howGunI = this.gunVisualIndexForSlot(spotSlot);
        const howFrom =
          howGunI >= 0 && this.guns[howGunI]?.visible
            ? this.gunTip(howGunI)
            : from;
        if (hostWalk) {
          want = Math.atan2(
            (hostWalk.aimY ?? hostWalk.y) - howFrom.y,
            (hostWalk.aimX ?? hostWalk.x) - howFrom.x
          );
        } else {
          want = Math.atan2(aim.y - howFrom.y, aim.x - howFrom.x);
        }
      }
      // Turret slew runs on the craft's privileged time so aiming works in Time Warp.
      this.fireControl.slewCraftTurretStations(h, want, this.playerDt, spotSlot >= 0 ? spotSlot : h.weapon);
      if (aimSlot != null) h.gunAngle = h.stationAim[aimSlot]?.[0] ?? want;
    }
    this.guns.forEach((gun, i) => {
      const gunMount = gunParts[i]?.mount ?? aimMountUv;
      const at = spriteUvPos(bodyPose, gunMount.x, gunMount.y);
      const slot = gunSlots[i];
      const barrel = this.gunBarrelIndexForVisual(i);
      const ang =
        slot != null
          ? (h.stationAim[slot]?.[barrel] ?? h.gunAngle)
          : h.gunAngle;
      const gunRot = projectHeading(ang + Math.PI / 2, h.x, h.y, h.z);
      this.gunTipHeat[i] = Math.max(0, (this.gunTipHeat[i] ?? 0) - (1 / 9) * dt);
      const tipH = this.gunTipHeat[i] ?? 0;
      let showGun = true;
      if (slot != null && gunParts[i]?.mount) {
        // Turrets stacked on the same hull UV:
        // - Pilot alt-weapons (Cyberhawk rail/tesla, Prometheus plasma/refractor)
        //   are mutually exclusive — show the selected socket's mount.
        // - Mixed controllers (main rail + automatic coax) keep every overlay.
        const siblings: number[] = [];
        for (let j = 0; j < gunSlots.length; j++) {
          const m = gunParts[j]?.mount;
          if (
            m &&
            Math.abs(m.x - gunMount.x) < 1e-4 &&
            Math.abs(m.y - gunMount.y) < 1e-4
          ) {
            siblings.push(gunSlots[j]!);
          }
        }
        const uniqueSlots: number[] = [];
        for (const s of siblings) {
          if (!uniqueSlots.includes(s)) uniqueSlots.push(s);
        }
        if (uniqueSlots.length > 1) {
          const exclusive = uniqueSlots.every(
            (s) => craft.sockets[s]?.controller === "pilot"
          );
          if (exclusive) {
            const prefer = uniqueSlots.includes(h.weapon)
              ? h.weapon
              : uniqueSlots[0]!;
            showGun = slot === prefer;
          }
        }
      }
      const sock = slot != null ? craft.sockets[slot] : undefined;
      const gunSc = craftSocketGunScale(craft, sock);
      // Automatic coax on a shared cupola draws above the pilot turret.
      const coaxBias = sock?.controller === "automatic" ? 0.55 : 0;
      gun
        .setVisible(showGun)
        .setPosition(at.x, at.y)
        .setRotation(gunRot)
        .setScale(zs * gunSc)
        .setDepth(
          worldDepth(
            h.z,
            (gunParts[i]?.layer === "above" ? ZOff.turret : ZOff.gun) + coaxBias + i * 0.05,
            h.y
          )
        );
      applyEdgeLight(gun, gun.rotation);
      applyThermalHeat(gun, this.thermalOn, 0.3);
      this.syncGunHeatGlow(i, gun, tipH);
      if (!showGun) this.gunHeatGlows[i]?.setVisible(false);
    });
    for (let i = this.guns.length; i < this.gunHeatGlows.length; i++) {
      this.gunHeatGlows[i]?.setVisible(false);
    }
    const rotorParts = this.craftParts.rotors;
    if (!rotorParts.length) {
      for (const rotor of this.rotors) {
        this.unwrapTilt(rotor);
        rotor.setVisible(false);
      }
    } else {
      const along = craftRotorAlongScale(craft);
      this.rotors.forEach((rotor, i) => {
        const part = rotorParts[i]!;
        const spinKey = part.spinTex;
        const useSpin = !!spinKey && h.rotorSpd >= craftRotorFlightSpeed(craft) * 0.5 && this.textures.exists(spinKey);
        const rotorKey = useSpin ? spinKey! : part.tex;
        rotor.setVisible(true);
        if (rotor.texture.key !== rotorKey) rotor.setTexture(rotorKey);
        const rotorAt = spriteUvPos(
          bodyPose,
          part.mount.x,
          part.mount.y
        );
        const hubX = rotorAt.x + Math.cos(tiltRot) * rOffF - Math.sin(tiltRot) * rOffS;
        const hubY = rotorAt.y + Math.sin(tiltRot) * rOffF + Math.cos(tiltRot) * rOffS;
        const sc = craftCompositePartScale(part, rotor.width, zs);
        const spin = (part.spinSign ?? -1) * h.rotor;
        const depth = worldDepth(h.z, ZOff.rotor + i * 0.001, h.y);
        if (along < 0.999) {
          // Forward-facing props: squash along fuselage so discs read edge-on from above.
          const wrap = this.ensureTiltWrap(rotor);
          wrap
            .setVisible(true)
            .setPosition(hubX, hubY)
            .setRotation(bodyRot)
            .setScale(sc, sc * along)
            .setDepth(depth);
          rotor
            .setPosition(0, 0)
            .setRotation(spin)
            .setScale(1)
            .setAlpha(1);
        } else {
          this.unwrapTilt(rotor);
          rotor
            .setPosition(hubX, hubY)
            .setRotation(spin)
            .setScale(sc)
            .setAlpha(1)
            .setDepth(depth);
        }
        clearEdgeLight(rotor);
        applyThermalHeat(rotor, this.thermalOn, 0.48);
      });
    }
    applyEdgeLight(this.body, bodyRot);
    applyThermalHeat(this.body, this.thermalOn, 0.78);
    const cloakA = this.countermeasures.cloakT > 0 ? 0.14 : 1;
    this.body.setAlpha(cloakA);
    this.shadow.setVisible(this.countermeasures.cloakT <= 0 && this.shadow.visible);
    this.shadow.setAlpha(this.countermeasures.cloakT > 0 ? 0 : this.shadow.alpha);
    for (const rotor of this.rotors) {
      rotor.setAlpha(cloakA);
      const wrap = rotor.getData("tiltWrap") as Phaser.GameObjects.Container | undefined;
      if (wrap?.scene) wrap.setAlpha(cloakA);
    }
    for (const gun of this.guns) gun.setAlpha(cloakA);
    if (this.player.spec.antenna) this.remoteBody.tickHeliAntenna(dt);
    const bodyDepth = worldDepth(h.z, ZOff.body, h.y);
    const bodyWrap = this.body.getData("tiltWrap") as Phaser.GameObjects.Container | undefined;
    if (bodyWrap?.scene) {
      if (bodyWrap.depth !== bodyDepth) bodyWrap.setDepth(bodyDepth);
      bodyWrap.setAlpha(cloakA);
    } else {
      this.body.setDepth(bodyDepth);
    }
    this.fx.muzzle.setDepth(worldDepth(h.z, ZOff.muzzle, h.y));
    this.reticleHud.sync();
    this.emitDustOff(dt);
    // Craft-driven trails pace on the craft's own (Time Warp privileged) step, or each emit
    // spans a huge gap and the stretched segments smear.
    this.emitCraftExhaust(this.playerDt);
    this.emitJetWingTrails(this.playerDt);
    this.countermeasures.syncReactiveArmorGlow();
  }


  /**
   * Reactive armor's active hit radius — bigger than the hull itself, since the field
   * intercepts shots before they reach the plating. Drives both the hit-detection check in
   * `tryHit` (missionScene shot-update loop) and the spark burst origins below.
   */



  /** Parent the player hull in a tilt wrap (jet banking billboard). */
  ensureBodyTiltWrap(): Phaser.GameObjects.Container {
    return this.ensureTiltWrap(this.body);
  }

  /** Parent an image in a tilt wrap (jet bank / forward-facing prop foreshorten). */
  ensureTiltWrap(part: Phaser.GameObjects.Image): Phaser.GameObjects.Container {
    let wrap = part.getData("tiltWrap") as Phaser.GameObjects.Container | undefined;
    if (!wrap || !wrap.scene) {
      wrap = this.add.container(0, 0);
      wrap.add(part);
      part.setData("tiltWrap", wrap);
    }
    return wrap;
  }

  /**
   * Screen pose for UV mounts on a hull image — accounts for jet tilt wrap
   * foreshortening so guns/exhaust stay glued to the billboard.
   */
  imageDrawPose(im: Phaser.GameObjects.Image): {
    x: number;
    y: number;
    rotation: number;
    displayWidth: number;
    displayHeight: number;
    originX: number;
    originY: number;
  } {
    const wrap = im.getData("tiltWrap") as Phaser.GameObjects.Container | undefined;
    if (!wrap?.scene) {
      return {
        x: im.x,
        y: im.y,
        rotation: im.rotation,
        displayWidth: im.displayWidth,
        displayHeight: im.displayHeight,
        originX: im.originX,
        originY: im.originY,
      };
    }
    return {
      x: wrap.x,
      y: wrap.y,
      rotation: wrap.rotation + im.rotation,
      displayWidth: im.width * Math.abs(wrap.scaleX),
      displayHeight: im.height * Math.abs(wrap.scaleY),
      originX: im.originX,
      originY: im.originY,
    };
  }

  /** Player hull draw pose (tilt wrap aware). */
  heliBodyDrawPose(): ReturnType<MissionScene["imageDrawPose"]> {
    return this.imageDrawPose(this.body);
  }

  /**
   * Shared nozzle glow + flame for host craft exhaust and remote plane FX.
   * Keeps Raptor / jet remotes on the same breath / flicker / thermal rules.
   */
  paintExhaustNozzle(
    i: number,
    mount: { x: number; y: number },
    opts: {
      pose: ReturnType<MissionScene["imageDrawPose"]>;
      jetAng: number;
      glowAng: number;
      zs: number;
      power: number;
      bodyDepth: number;
      cloakMul: number;
      flameScale: number;
      glowTint: number;
      flame: Phaser.GameObjects.Image;
      glow: Phaser.GameObjects.Image;
      flameHue?: number;
      hueFx?: Phaser.FX.ColorMatrix;
    }
  ): void {
    const {
      pose,
      jetAng,
      glowAng,
      zs,
      power,
      bodyDepth,
      cloakMul,
      flameScale,
      glowTint,
      flame,
      glow,
      flameHue,
      hueFx,
    } = opts;
    const at = spriteUvPos(pose, mount.x, mount.y);
    const base = craftPreviewExhaustScale(zs);
    const breath = 0.94 + Math.sin(this.time.now * 0.0068 + i * 1.7) * 0.07;
    const thrust = 0.62 + power * 0.55;
    glow
      .setVisible(true)
      .setPosition(at.x, at.y)
      .setRotation(glowAng)
      .setScale(base.x * thrust * breath, base.y * thrust * breath)
      .setAlpha((0.28 + power * 0.7) * cloakMul)
      .setDepth(bodyDepth + 0.15);
    if (this.thermalOn) applyThermalHeat(glow, true, 0.9);
    else glow.clearTint().setTint(glowTint);

    const frameStep = Math.floor(this.time.now / 55);
    const flicker = 0.92 + Math.sin(this.time.now * 0.043 + i * 2.17) * 0.08;
    const sc = flameScale * zs * (0.35 + power * 0.75);
    flame
      .setVisible(true)
      .setTexture("fx_exhaust")
      .setFrame((frameStep + i) % FX_VARIANTS)
      .setPosition(at.x, at.y)
      .setRotation(jetAng)
      .setScale(sc * flicker, sc * (1.04 - flicker * 0.12))
      .setAlpha((0.62 + power * 0.34) * cloakMul)
      .setDepth(bodyDepth + 0.2);
    if (this.thermalOn) {
      if (hueFx) hueFx.active = false;
      applyThermalHeat(flame, true, 0.96);
    } else {
      flame.clearTint();
      if (hueFx && flameHue != null) {
        hueFx.active = true;
        hueFx.hue(flameHue);
      }
    }
  }

  emitCraftExhaust(dt: number): void {
    const h = this.player;
    const mounts = craftExhaustMounts(h.spec);
    const power = Phaser.Math.Clamp(h.thrustPower, 0, 1);
    if (!mounts.length || h.phase === "dead" || power <= 0.02) {
      this.exhaustEmitCarry = 0;
      this.exhaustPrevWorld.length = 0;
      for (const flame of this.exhaustFlames) flame.setVisible(false);
      for (const glow of this.exhaustEngineGlows) glow.setVisible(false);
      return;
    }
    const profile = h.spec.exhaustProfile;
    if (!profile) {
      for (const flame of this.exhaustFlames) flame.setVisible(false);
      for (const glow of this.exhaustEngineGlows) glow.setVisible(false);
      return;
    }
    const ribbonDense = !!profile.ribbonDense;
    const flameHue = profile.flameHue ?? craftExhaustFlameHue(h.spec.kind);
    const glowTint = profile.tint;

    const jetAng = projectHeading(h.angle + Math.PI, h.x, h.y, h.z);
    this.fx.exhaustAngle = jetAng;
    const zs = worldToScreen(h.x, h.y, h.z).scale;
    const bodyDepth =
      ((this.body.getData("tiltWrap") as Phaser.GameObjects.Container | undefined)?.depth ??
        this.body.depth);
    const cloakMul = this.countermeasures.cloakT > 0 ? 0.12 : 1;

    // Soft engine glow — top-middle pinned to the nozzle; local +Y = exhaust.
    // glowFollowsHull: body axes (rear vent row). Else: thrust direction.
    const pose = this.heliBodyDrawPose();
    // Local +Y at rotation 0 points screen-down; jetAng is exhaust heading → −π/2.
    const glowAng = profile.glowFollowsHull ? pose.rotation : jetAng - Math.PI / 2;
    this.exhaustEngineGlows.forEach((glow, i) => {
      const mount = mounts[i];
      const flame = this.exhaustFlames[i];
      if (!mount || !flame) {
        glow.setVisible(false);
        flame?.setVisible(false);
        return;
      }
      this.paintExhaustNozzle(i, mount, {
        pose,
        jetAng,
        glowAng,
        zs,
        power,
        bodyDepth,
        cloakMul,
        flameScale: profile.flame,
        glowTint,
        flame,
        glow,
        flameHue,
        hueFx: this.exhaustFlameHueFx[i],
      });
    });
    for (let i = mounts.length; i < this.exhaustFlames.length; i++) {
      this.exhaustFlames[i]?.setVisible(false);
      this.exhaustEngineGlows[i]?.setVisible(false);
    }

    this.exhaustEmitCarry += profile.rate * power * mounts.length * Math.min(dt, 0.05);
    const emitCap = ribbonDense ? 16 : 12;
    const emitN = Math.min(emitCap, Math.floor(this.exhaustEmitCarry));
    this.exhaustEmitCarry -= emitN;
    if (!emitN) return;

    const jetSpeed = profile.speed * (0.45 + power * 0.75);
    this.fx.exhaustTint = profile.tint;
    this.fx.exhaustSmokeTint = profile.smoke;
    // Thrust drives trail opacity and thickness at emit.
    this.fx.exhaustAlpha = 0.22 + power * 0.76;
    this.fx.exhaustScaleY = profile.sy * (0.34 + power * 0.52);
    this.fx.exhaustLife = profile.life;

    const glow = this.fx.at(h.z, h.y, this.fx.craftExhaust, ZOff.exhaust + 0.04);
    const mote = this.fx.at(h.z, h.y, this.fx.craftExhaustMote, ZOff.exhaust + 0.08);
    const smoke = this.fx.at(h.z, h.y, this.fx.craftExhaustSmoke, ZOff.exhaust - 0.35);
    // Jets/VTOLs: trail under the hull. Helis: above the body, under the rotor disc.
    const trailDepth =
      h.spec.flightModel === "heli" ? bodyDepth + 1.05 : bodyDepth - 1.35;
    glow.setDepth(trailDepth);
    mote.setDepth(trailDepth + 0.05);
    smoke.setDepth(trailDepth - 0.15);
    for (let i = 0; i < emitN; i++) {
      const mountI = this.exhaustMountCursor++ % mounts.length;
      const mount = mounts[mountI]!;
      const nozzle = this.craftBodyMountWorldPos(mount);
      // Small world gap past the nozzle flame; stretch clearance is screen-space below.
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
      const baseScaleX = profile.sx * (0.48 + power * 0.88);
      this.fx.exhaustScaleX = baseScaleX;
      const frameWidth = Math.max(
        1,
        this.textures.get(craftExhaustFlameSheet(h.spec.kind)).get(0).cutWidth
      );

      const previous = this.exhaustPrevWorld[mountI];
      let prevScreenX = currentScreenX;
      let prevScreenY = currentScreenY;
      let span = 0;
      if (previous && Math.hypot(current.x - previous.x, current.y - previous.y) < 180) {
        const previousAt = worldToScreen(previous.x, previous.y, previous.z);
        const dx = previousAt.x - currentScreenX;
        const dy = previousAt.y - currentScreenY;
        span = Math.hypot(dx, dy);
        if (span > 0.5) {
          emitX = (currentScreenX + previousAt.x) * 0.5;
          emitY = (currentScreenY + previousAt.y) * 0.5;
          connectionAngle = Math.atan2(dy, dx);
          const stretch = ribbonDense ? 1.95 : 1.72;
          this.fx.exhaustScaleX = Math.max(baseScaleX * 0.28, (span / frameWidth) * stretch);
          prevScreenX = previousAt.x;
          prevScreenY = previousAt.y;
        }
      }
      this.exhaustPrevWorld[mountI] = current;

      // Keep the nozzle-side edge of the scaled sprite at/aft of the tip (no body backspill).
      const halfLen = frameWidth * this.fx.exhaustScaleX * 0.5;
      const aftC = Math.cos(connectionAngle);
      const aftS = Math.sin(connectionAngle);
      const along =
        (emitX - currentScreenX) * aftC + (emitY - currentScreenY) * aftS;
      const spillPad = halfLen - along;
      if (spillPad > 0) {
        emitX += aftC * spillPad;
        emitY += aftS * spillPad;
      }

      // Spawn over the chord between consecutive nozzle positions, then drift
      // down that chord with a small amount of directional jitter.
      this.fx.exhaustAngle = connectionAngle;
      const motionAngle = connectionAngle + range(-0.045, 0.045);
      const motionSpeed = jetSpeed * range(0.94, 1.06);
      this.fx.exhaustVx = Math.cos(motionAngle) * motionSpeed;
      this.fx.exhaustVy = Math.sin(motionAngle) * motionSpeed;
      // Dense ribbon for every craft with an exhaust profile (jets + Cyberhawk/Prometheus).
      const nGlow = Math.max(1, this.fx.emitCount(ribbonDense ? 2.2 : 1.7));
      if (nGlow) this.fx.emitBudgeted("fire", glow, emitX, emitY, nGlow);
      // Extra mid-chord samples so fast craft don't leave gaps between frames.
      if (span > 8) {
        const fillN = Math.min(ribbonDense ? 3 : 2, Math.max(1, Math.floor(span / (ribbonDense ? 22 : 28))));
        for (let f = 1; f <= fillN; f++) {
          const t = f / (fillN + 1);
          let fx = currentScreenX + (prevScreenX - currentScreenX) * t;
          let fy = currentScreenY + (prevScreenY - currentScreenY) * t;
          const fillAlong = (fx - currentScreenX) * aftC + (fy - currentScreenY) * aftS;
          const fillPad = halfLen - fillAlong;
          if (fillPad > 0) {
            fx += aftC * fillPad;
            fy += aftS * fillPad;
          }
          this.fx.emitBudgeted("fire", glow, fx, fy, 1);
        }
      }
      const nMote = this.fx.emitCount(ribbonDense ? 0.28 + power * 0.18 : 0.4 + power * 0.22);
      if (nMote) {
        this.fx.emitBudgeted(
          "short",
          mote,
          currentScreenX + aftC * halfLen * 0.35,
          currentScreenY + aftS * halfLen * 0.35,
          nMote
        );
      }
      const smokeX = currentScreenX + aftC * Math.max(gap * zs * 0.65, halfLen * 0.55);
      const smokeY = currentScreenY + aftS * Math.max(gap * zs * 0.65, halfLen * 0.55);
      // Every exhaust pulse gets smoke; category budgets still provide the hard cap.
      const nSmoke = this.fx.emitCount(0.9);
      if (nSmoke) this.fx.emitBudgeted("smoke", smoke, smokeX, smokeY, nSmoke);
    }
  }

  /** Contrails from jet wingtips — density scales with bank angle. */
  emitJetWingTrails(dt: number): void {
    const h = this.player;
    if (craftControlScheme(h.spec) !== "plane" || h.phase !== "flight") {
      this.wingTrailEmitCarry = 0;
      this.wingTrailMountCursor = 0;
      this.wingTrailPrevScreen.length = 0;
      return;
    }
    const tips = craftWingTipMounts(h.spec);
    if (!tips.length) return;
    const bodyDepth =
      ((this.body.getData("tiltWrap") as Phaser.GameObjects.Container | undefined)?.depth ??
        this.body.depth);
    const state = {
      emitCarry: this.wingTrailEmitCarry,
      mountCursor: this.wingTrailMountCursor,
      prevScreen: this.wingTrailPrevScreen,
    };
    this.emitWingTipContrails({
      dt,
      tips,
      bank: Math.abs(h.roll),
      heading: h.angle,
      x: h.x,
      y: h.y,
      z: h.z,
      pose: this.heliBodyDrawPose(),
      bodyDepth,
      state,
    });
    this.wingTrailEmitCarry = state.emitCarry;
    this.wingTrailMountCursor = state.mountCursor;
  }

  /**
   * Shared banked wingtip trails (host jets + Raptor remotes).
   * Round-robins tips and stretches particles along each tip’s path so L/R don’t overlap.
   */
  emitWingTipContrails(opts: {
    dt: number;
    tips: { x: number; y: number }[];
    bank: number;
    heading: number;
    x: number;
    y: number;
    z: number;
    pose: {
      x: number;
      y: number;
      rotation: number;
      displayWidth: number;
      displayHeight: number;
      originX: number;
      originY: number;
    };
    bodyDepth: number;
    state: {
      emitCarry: number;
      mountCursor: number;
      prevScreen: ({ x: number; y: number } | undefined)[];
    };
  }): void {
    const { tips, state } = opts;
    const bankT = Phaser.Math.Clamp((opts.bank - 0.1) / 0.75, 0, 1);
    if (bankT < 0.04) {
      state.emitCarry = 0;
      state.mountCursor = 0;
      state.prevScreen.length = 0;
      return;
    }

    const rate = (10 + bankT * 38) * tips.length;
    state.emitCarry += rate * Math.min(opts.dt, 0.05);
    const emitN = Math.min(10, Math.floor(state.emitCarry));
    state.emitCarry -= emitN;
    if (!emitN) return;

    const trailAng = projectHeading(opts.heading + Math.PI, opts.x, opts.y, opts.z);
    const drift = 28 + bankT * 55;
    this.fx.wingTrailTint = 0xffffff;
    this.fx.wingTrailLife = 700 + bankT * 1100;
    this.fx.wingTrailScaleY = (0.12 + bankT * 0.22) * (0.85 + Math.random() * 0.2);

    const trail = this.fx.at(opts.z, opts.y, this.fx.jetWingTrail, ZOff.exhaust - 0.5);
    trail.setDepth(opts.bodyDepth - 1.6);

    const tintKey = this.textures.exists("fx_smoke_tint") ? "fx_smoke_tint" : "fx_smoke";
    for (let i = 0; i < emitN; i++) {
      const tipI = state.mountCursor++ % tips.length;
      const tip = tips[tipI]!;
      const at = spriteUvPos(opts.pose, tip.x, tip.y);
      // Small aft spit so stretched particles don't cover the tip.
      const spout = 4;
      const currentX = at.x + Math.cos(trailAng) * spout;
      const currentY = at.y + Math.sin(trailAng) * spout;
      let emitX = currentX;
      let emitY = currentY;
      let connectionAngle = trailAng;
      const baseSx = 0.55 + bankT * 1.1;
      this.fx.wingTrailScaleX = baseSx;

      const previous = state.prevScreen[tipI];
      if (previous && Math.hypot(currentX - previous.x, currentY - previous.y) < 280) {
        const dx = previous.x - currentX;
        const dy = previous.y - currentY;
        const span = Math.hypot(dx, dy);
        if (span > 0.5) {
          emitX = (currentX + previous.x) * 0.5;
          emitY = (currentY + previous.y) * 0.5;
          connectionAngle = Math.atan2(dy, dx);
          const frameWidth = Math.max(1, this.textures.get(tintKey).get(0).cutWidth);
          this.fx.wingTrailScaleX = Math.max(baseSx * 0.35, (span / frameWidth) * 1.45);
        }
      }
      state.prevScreen[tipI] = { x: currentX, y: currentY };

      this.fx.wingTrailAngle = connectionAngle;
      this.fx.wingTrailVx = Math.cos(connectionAngle) * drift * range(0.9, 1.1);
      this.fx.wingTrailVy = Math.sin(connectionAngle) * drift * range(0.9, 1.1);
      const n = Math.max(1, this.fx.emitCount(0.9 + bankT * 0.8));
      this.fx.emitBudgeted("smoke", trail, emitX, emitY, n);
    }
  }

  emitDustOff(dt: number): void {
    const h = this.player;
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
    this.fx.heliDust.setDepth(worldDepth(gnd, 0.2, h.y));
    const puffs = Math.max(0, Math.round((takeoff ? 0.4 + power * 4.5 : 0.6 + power * 1.4) * rate));
    for (let i = 0; i < puffs; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = range(16, 56 + power * 36);
      const wx = h.x + Math.cos(a) * r;
      const wy = h.y + Math.sin(a) * r;
      const at = worldToScreen(wx, wy, groundZ(this.world, wx, wy));
      this.fx.heliDust.setEmitterAngle(Phaser.Math.RadToDeg(a) + (Math.random() - 0.5) * 28);
      this.fx.emitBudgeted("dust", this.fx.heliDust, at.x, at.y, 1);
    }
    if (wet) return;
    const n = Math.max(0, Math.round((takeoff ? 0.5 + power * 9 : 1 + power * 3) * rate));
    if (n < 1) return;
    const admitted = this.fx.reserveSimParticleSlots("dust", n);
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
      this.fx.simParticles.push({
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


  emitDustShock(x: number, y: number, power = 1): void {
    const gnd = groundZ(this.world, x, y);
    const wet = isWater(this.world, x, y);
    if (wet) return;
    const n = Math.round(64 * power);
    const admitted = this.fx.reserveSimParticleSlots("dust", n);
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
      this.fx.simParticles.push({
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
































  worldToHud(wx: number, wy: number): { x: number; y: number } {
    const cam = this.cameras.main;
    const view = cam.worldView;
    return {
      x: cam.x + (wx - view.x) * cam.zoom,
      y: cam.y + (wy - view.y) * cam.zoom,
    };
  }

  gunTip(index = 0, muzzleI = 0): { x: number; y: number } {
    const gun = this.guns[index] ?? this.gun;
    const tips = lookupSpriteMuzzles(gun.texture.key);
    const tipUv = tips[muzzleI] ?? tips[0];
    if (!tipUv) throw new Error(`gunTip: ${gun.texture.key} missing muzzle`);
    const mx = (tipUv.x - gun.originX) * gun.displayWidth;
    const my = (tipUv.y - gun.originY) * gun.displayHeight;
    const ca = Math.cos(gun.rotation);
    const sa = Math.sin(gun.rotation);
    const sx = gun.x + mx * ca - my * sa;
    const sy = gun.y + mx * sa + my * ca;
    const at = screenToWorldAtZ(sx, sy, this.player.z);
    return { x: at.x, y: at.y };
  }

  /** Snap tip glow on fire. Fixed muzzles skip. `kick` is the heat added (Tesla-rate guns use the small default). */
  pulseTurretGunHeat(gunI: number, kick = 0.05): void {
    if (gunI < 0 || gunI >= this.guns.length) return;
    this.gunTipHeat[gunI] = Math.min(1, (this.gunTipHeat[gunI] ?? 0) + kick);
  }

  /**
   * Tip heat: additive `{gun}_muzzle_glow` overlay (baked tip→30% gradient clipped to barrel).
   */
  syncGunHeatGlow(gunI: number, gun: Phaser.GameObjects.Image, tipHeat: number): void {
    const glow = this.gunHeatGlows[gunI];
    if (!glow) return;
    const glowTex = muzzleGlowKey(gun.texture.key);
    if (tipHeat < 0.02 || !gun.visible || !this.textures.exists(glowTex)) {
      glow.setVisible(false);
      return;
    }
    if (glow.texture.key !== glowTex) glow.setTexture(glowTex);
    glow
      .setVisible(true)
      .setPosition(gun.x, gun.y)
      .setRotation(gun.rotation)
      .setOrigin(gun.originX, gun.originY)
      .setScale(gun.scaleX, gun.scaleY)
      .setDepth(gun.depth + 0.02)
      .setAlpha(Phaser.Math.Clamp(tipHeat, 0, 1));
    if (this.thermalOn) {
      glow.setBlendMode(Phaser.BlendModes.NORMAL);
      applyThermalHeat(glow, true, Phaser.Math.Linear(0.55, 1, tipHeat));
    } else {
      glow.clearTint();
      glow.setBlendMode(Phaser.BlendModes.ADD);
    }
  }


  /** World position of an authored mount UV on the active craft body (live draw pose). */
  craftBodyMountWorldPos(mount: { x: number; y: number }): { x: number; y: number } {
    const h = this.player;
    if (this.body?.visible) {
      const pose = this.heliBodyDrawPose();
      const scr = spriteUvPos(pose, mount.x, mount.y);
      // Mid-hull projection plane for XY only — shot leave Z is playerMuzzleZ.
      const z = h.z + h.spec.height * 0.55;
      const at = screenToWorldAtZ(scr.x, scr.y, z);
      return { x: at.x, y: at.y };
    }
    // Pre-sync fallback: rotate UV offset around craft origin in world space.
    const craft = h.spec;
    const pivot = craftOrigin(craft);
    const img = this.textures.exists(craft.body)
      ? (this.textures.get(craft.body).getSourceImage() as { width: number; height: number })
      : { width: 120, height: 120 };
    const hullRot = h.angle + craft.rotOff;
    const mx = (mount.x - pivot.x) * img.width;
    const my = (mount.y - pivot.y) * img.height;
    return {
      x: h.x + mx * Math.cos(hullRot) - my * Math.sin(hullRot),
      y: h.y + mx * Math.sin(hullRot) + my * Math.cos(hullRot),
    };
  }




















































































  /** Hold play-cam on an impact (any povCam / wire / warp linger), optionally keeping the sensor palette. */
  beginImpactCamLinger(
    x: number,
    y: number,
    opt?: { thermal?: ThermalPalette; hold?: number }
  ): void {
    const hold = opt?.hold ?? (opt?.thermal ? 1.65 : 0.95);
    this.povCamLookX = x;
    this.povCamLookY = y;
    this.povCamLookHold = Math.max(this.povCamLookHold, hold);
    if (opt?.thermal) {
      this.sensorLingerPalette = opt.thermal;
      this.sensorLingerT = Math.max(this.sensorLingerT, hold);
    }
  }

  /** Wall-clock drain for impact linger — runs even while a stinger owns look. */
  tickImpactCamLinger(dt: number): void {
    if (this.povCamLookHold > 0) {
      this.povCamLookHold = Math.max(0, this.povCamLookHold - dt);
    }
    if (this.sensorLingerT > 0) {
      this.sensorLingerT = Math.max(0, this.sensorLingerT - dt);
      if (this.sensorLingerT <= 0) this.sensorLingerPalette = null;
    }
  }










































  /** Cloud exhaust from the hull profile, spawned at authored exhaust UVs. */
  emitExhaustPlume(r: RemoteCraft, dt: number, body: Phaser.GameObjects.Image): void {
    const profile = r.spec.exhaustProfile;
    if (!profile || profile.flame !== 0) return;
    if (r.spec.ground && r.airborne) return;
    const mounts = craftExhaustMounts(r.spec);
    if (!mounts.length) return;
    const spd = Math.hypot(r.vx, r.vy);
    if (spd < 6) {
      r.exhaustCarry = 0;
      return;
    }
    if (!cameraPointVisible(r.z, r.y)) return;
    const powerRef = Math.max(90, r.spec.minSpeed * 1.15, r.spec.maxSpeed * 0.4);
    const power = Phaser.Math.Clamp(spd / powerRef, 0.35, 1);
    r.exhaustCarry = (r.exhaustCarry ?? 0) + profile.rate * power * dt;
    const n = Math.floor(r.exhaustCarry);
    if (n <= 0) return;
    r.exhaustCarry -= n;

    const pose = this.remoteBody.remoteBodyDrawPose(body);
    const wrap = body.getData("tiltWrap") as Phaser.GameObjects.Container | undefined;
    const bodyDepth = wrap?.depth ?? body.depth;
    const jetAng = projectHeading(r.angle + Math.PI, r.x, r.y, r.z);
    const backX = -Math.cos(r.angle) * spd * 0.1;
    const backY = -Math.sin(r.angle) * spd * 0.1;

    this.fx.withTrail(0.9, () => {
      const rgb = profile.smoke;
      const pale = ((rgb >> 16) & 0xff) + ((rgb >> 8) & 0xff) + (rgb & 0xff) > 0x2a0;
      if (pale) {
        this.fx.wingTrailTint = profile.smoke;
        this.fx.wingTrailLife = profile.life * (0.7 + power * 0.45);
        this.fx.wingTrailScaleX = profile.sx * (0.85 + power * 0.35);
        this.fx.wingTrailScaleY = profile.sy * (0.85 + power * 0.3);
        this.fx.wingTrailAngle = jetAng;
        this.fx.wingTrailVx = backX + range(-4, 4);
        this.fx.wingTrailVy = backY + range(-4, 4);
        const trail = this.fx.at(r.z, r.y, this.fx.jetWingTrail, ZOff.exhaust - 0.35);
        trail.setDepth(bodyDepth - 1.15);
        for (const mount of mounts) {
          const at = spriteUvPos(pose, mount.x, mount.y);
          this.fx.emitBudgeted("smoke", trail, at.x, at.y, n);
        }
      } else {
        this.fx.exhaustSmokeTint = profile.smoke;
        this.fx.exhaustScaleY = profile.sy * (0.75 + power * 0.45);
        this.fx.exhaustAlpha = 0.22 + power * 0.38;
        this.fx.exhaustVx = backX * 1.2 + range(-6, 6);
        this.fx.exhaustVy = backY * 1.2 + range(-6, 6);
        this.fx.exhaustAngle = jetAng;
        const smoke = this.fx.at(r.z, r.y, this.fx.craftExhaustSmoke, ZOff.smoke - 0.2);
        smoke.setDepth(bodyDepth - 1.1);
        for (const mount of mounts) {
          const at = spriteUvPos(pose, mount.x, mount.y);
          this.fx.emitBudgeted("smoke", smoke, at.x, at.y, n);
        }
      }
    });
  }













































  /** Gun overlay index for a loadout socket barrel, or 0 if the socket has no overlay. */
  gunVisualIndexForSlot(slot: number, barrel = 0): number {
    const slots = craftGunSocketSlots(this.player.spec);
    let seen = 0;
    for (let i = 0; i < slots.length; i++) {
      if (slots[i] !== slot) continue;
      if (seen === barrel) return i;
      seen++;
    }
    return 0;
  }

  /** Barrel index within a socket for a craft gun overlay visual index. */
  gunBarrelIndexForVisual(visualIndex: number): number {
    const slots = craftGunSocketSlots(this.player.spec);
    const slot = slots[visualIndex];
    if (slot == null) return 0;
    let barrel = 0;
    for (let i = 0; i < visualIndex; i++) {
      if (slots[i] === slot) barrel++;
    }
    return barrel;
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
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
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

  /**
   * Bounded random solid-pixel pick, with an object-radius fallback around the pivot.
   * `maxCenterFrac` (e.g. 0.7 for rotors) limits picks to that fraction of half the
   * texture span from the sprite pivot — still requires a solid pixel.
   */
  sampleSolidUv(
    key: string,
    fallbackRadius: number,
    attempts = 24,
    maxCenterFrac?: number
  ): { u: number; v: number } {
    const tex = this.textureAlphaBounds(key);
    const pivot = spritePivot(key);
    const width = tex?.width ?? Math.max(1, this.texSpan(key));
    const height = tex?.height ?? Math.max(1, this.texSpan(key));
    const cx = pivot.x * width;
    const cy = pivot.y * height;
    const rotorR = Math.max(width, height) * 0.5;
    const maxDist = maxCenterFrac != null ? rotorR * maxCenterFrac : null;
    if (tex) {
      const tries = maxDist != null ? Math.max(attempts, 64) : attempts;
      for (let i = 0; i < tries; i++) {
        const x = tex.minX + ((Math.random() * (tex.maxX - tex.minX + 1)) | 0);
        const y = tex.minY + ((Math.random() * (tex.maxY - tex.minY + 1)) | 0);
        if (maxDist != null && Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > maxDist) continue;
        if (tex.alpha[y * tex.width + x]! >= 48) {
          return { u: (x + 0.5) / tex.width, v: (y + 0.5) / tex.height };
        }
      }
    }
    const ang = Math.random() * Math.PI * 2;
    const cap = maxDist ?? Math.max(1, fallbackRadius);
    const dist = Math.sqrt(Math.random()) * cap;
    return {
      u: Phaser.Math.Clamp(pivot.x + (Math.cos(ang) * dist) / width, 0, 1),
      v: Phaser.Math.Clamp(pivot.y + (Math.sin(ang) * dist) / height, 0, 1),
    };
  }

  sampleSolidLocalPoints(
    key: string,
    fallbackRadius: number,
    count: number,
    maxCenterFrac?: number
  ): { lx: number; ly: number; sc: number }[] {
    const tex = this.textureAlphaBounds(key);
    const width = tex?.width ?? Math.max(1, this.texSpan(key));
    const height = tex?.height ?? Math.max(1, this.texSpan(key));
    const pivot = spritePivot(key);
    return Array.from({ length: count }, (_, i) => {
      const uv = this.sampleSolidUv(key, fallbackRadius, 24, maxCenterFrac);
      return {
        lx: (uv.u - pivot.x) * width,
        ly: (uv.v - pivot.y) * height,
        sc: i === 0 ? 1 : range(0.42, 0.62),
      };
    });
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












































  spriteHalf(key: string): number {
    if (!this.textures.exists(key)) return 18;
    const src = this.textures.get(key).getSourceImage() as { width: number; height: number };
    return Math.max(src.width, src.height) * 0.5;
  }


  syncUnitSprites(): void {
    const SLOTS = 9;
    let liveN = 0;
    for (const u of this.units) if (!u.dead) liveN++;
    while (this.unitG.getLength() < liveN * SLOTS) {
      this.unitG.add(this.add.image(0, 0, "fx_shadow"));
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
      const drawRot = this.unitDrawRot(u, rot);
      const zs = scr.scale;
      const pivot = spritePivot(textureOf(u.kind));
      const ox = pivot.x;
      const oy = pivot.y;
      const zBias = u.pinId != null ? ZOff.posted : 0;
      const bodyDepth = worldDepth(u.z, ZOff.body + zBias, u.y);
      const damageHeat = Phaser.Math.Clamp(1 - u.health / Math.max(1, u.max), 0, 1) * 0.14;
      const bodyHeat = Phaser.Math.Clamp(
        (sp.organic
          ? 0.98
          : sp.aerial
            ? 0.82
            : isGroundVehicle(u.kind)
              ? 0.7
              : sp.building
                ? 0.25
                : sp.water
                  ? 0.34
                  : 0.48) + damageHeat,
        0,
        1
      );
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
        u,
        drawRot
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
      applyThermalHeat(im, this.thermalOn, bodyHeat);
      let pi = 0;
      const gunDepth = (sp.behavior === "orbit_attack_heli" || sp.behavior === "kite_attack_heli") ? ZOff.gun : ZOff.turret;
      const place = (
        part: Phaser.GameObjects.Image,
        texKey: string,
        origin: { x: number; y: number },
        mount: { x: number; y: number },
        worldRot: number,
        depth: number,
        sc = 1,
        edgeLit = false,
        aimKey?: string
      ) => {
        if (!this.textures.exists(texKey)) return;
        this.unwrapTilt(part);
        const mx = (mount.x - ox) * im.displayWidth;
        const my = (mount.y - oy) * im.displayHeight;
        const partRot = texKey.includes("rotor")
          ? worldRot
          : aimKey
            ? this.unitAimDrawRot(u, aimKey, worldRot)
            : drawRot;
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
        applyThermalHeat(
          part,
          this.thermalOn,
          texKey.includes("rotor")
            ? bodyHeat * 0.48
            : sp.building
              // AA / SAM / tower guns are live emitters — hot vs cold concrete.
              ? 0.9
              : Math.min(1, bodyHeat + 0.08)
        );
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
          true,
          `gun${gi}`
        );
      });
      sp.rotors.forEach((r, ri) => {
        const part = kids[partBase + pi++];
        if (!part) return;
        const spinKey = `${r.tex}_spin`;
        const rotorKey =
          r.tex !== "enemy_drone_rotor" && this.textures.exists(spinKey) ? spinKey : r.tex;
        const mounts = rotorMountsOf(textureOf(u.kind));
        const sign = rotorSpinSign(mounts, ri);
        place(part, rotorKey, r.origin, r.mount, sign * u.rotor, ZOff.rotor, r.scale ?? 1);
        if (r.tex.includes("rotor")) {
          const px = this.destruction.liveRotorDrawPx(r.tex, r.scale ?? 1);
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
            .setScale(im.scaleX * sc * 1.04, im.scaleY * sc * 0.76)
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
          applyThermalHeat(part, this.thermalOn, bodyHeat * 0.62);
        }
      }
      if (u.muzzleT > 0 && (sp.weapon || guns.length)) {
        const tip = this.enemyFire.enemyMuzzle(u, u.muzzleGun);
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
          .setOrigin(0.15, 0.5)
          .setPosition(tipScr.x, tipScr.y)
          .setRotation(projectHeading(ang + jitR, tip.x, tip.y, u.z))
          .setScale((sp.organic ? 0.7 : 1.15) * zs * jitS)
          .setAlpha(Phaser.Math.Clamp(u.muzzleT / 0.07, 0, 1));
        if (this.thermalOn) {
          flash.setBlendMode(Phaser.BlendModes.NORMAL);
          applyThermalHeat(flash, true, 0.96 * Phaser.Math.Clamp(u.muzzleT / 0.07, 0, 1));
        } else {
          flash.setBlendMode(Phaser.BlendModes.ADD);
          applyThermalHeat(flash, false, 0, 0xfff6d0);
        }
        if (flash.depth !== flashDepth) flash.setDepth(flashDepth);
        clearEdgeLight(flash);
      }
    }
    this.syncThermalHotspots();
  }

  /** Low-cost semantic engine heat: one pooled glow per active vehicle/aircraft. */
  syncThermalHotspots(): void {
    const kids = this.thermalHotspotG.getChildren() as Phaser.GameObjects.Image[];
    for (const image of kids) image.setVisible(false);
    if (!this.thermalOn) return;

    const points: { x: number; y: number; z: number; angle: number; radius: number; heat: number }[] = [];
    const h = this.player;
    if (h.phase !== "dead" && this.countermeasures.cloakT <= 0) {
      points.push({
        x: h.x,
        y: h.y,
        z: h.z,
        angle: h.angle,
        radius: h.spec.radius,
        heat: 1,
      });
    }
    for (const u of this.units) {
      if (u.dead) continue;
      const sp = specOf(u.kind);
      if (!sp.aerial && !isGroundVehicle(u.kind)) continue;
      points.push({
        x: u.x,
        y: u.y,
        z: u.z,
        angle: u.angle,
        radius: radius(u.kind),
        heat: sp.aerial ? 0.96 : 0.88,
      });
    }
    while (this.thermalHotspotG.getLength() < points.length) {
      this.thermalHotspotG.add(
        this.add
          .image(0, 0, "fx_exhaust_glow")
          .setOrigin(0.5, 0.5)
          .setBlendMode(Phaser.BlendModes.ADD)
          .setTintFill(thermalSignalTint(1))
      );
    }
    const pool = this.thermalHotspotG.getChildren() as Phaser.GameObjects.Image[];
    points.forEach((p, i) => {
      const back = p.radius * 0.42;
      const x = p.x - Math.cos(p.angle) * back;
      const y = p.y - Math.sin(p.angle) * back;
      const at = worldToScreen(x, y, p.z);
      const size = Math.max(5, p.radius * 0.7 * at.scale);
      pool[i]!
        .setVisible(true)
        .setPosition(at.x, at.y)
        .setDisplaySize(size, size)
        .setAlpha(0.24 + p.heat * 0.2)
        .setDepth(worldDepth(p.z, ZOff.fire + 0.12, y));
    });
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





  /** World point the play camera is looking at (heli, povCam chase, or stinger). */
  camLookWorld(): { x: number; y: number; z: number } {
    const a = this.playerCamAnchor();
    return {
      x: a.x + this.lookCamX,
      y: a.y + this.lookCamY,
      z:
        this.stingerT > 0 && this.stingerTarget?.z != null && !this.stingerReleased
          ? this.stingerFocusZ
          : a.z,
    };
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


  unitHudName(u: Unit): string {
    if (u.hv) {
      const site = this.world.hv.find((h) => h.id === u.hv);
      if (site) return site.name.toUpperCase();
    }
    return labelOf(u.kind);
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
    if (this.mapBlend > 0.12) {
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
        const look = this.camLookWorld();
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
      const look = this.camLookWorld();
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
    const look = this.camLookWorld();
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














  toggleMap(): void {
    if (this.over) return;
    this.mapWant = !this.mapWant;
    this.mapLabel
      .setVisible(true)
      .setText(this.mapWant ? "THEATER MAP   HV sites marked   M close" : "RETURNING");
  }

  setupExitMenu(): void {
    // Screen chrome only — no craft art. Text canvases get exit_* names.
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
      .text(w - 140, 12, "[ ESC ]  MENU", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "13px",
        color: "#d8d0ba",
        backgroundColor: "#12100c",
        padding: { x: 8, y: 5 },
      })
      .setOrigin(1, 0)
      .setDepth(Layer.HUD + 200)
      .setScrollFactor(0);
  }

  toggleExitMenu(force?: boolean): void {
    const want = force ?? !this.exitOpen;
    if (want && (this.mapWant || this.mapBlend > 0.02)) return;
    if (want && this.help.open) this.help.toggle(false);
    this.exitOpen = want;
    this.exitRoot.setVisible(want);
    this.input.setDefaultCursor(want ? "default" : "none");
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



  toggleThermal(): void {
    this.thermalManual = !this.thermalManual;
    this.applyThermalMode();
  }

  /** Craft-owned thermal look (sensor cams + T share this; linger must not override it). */
  craftSensorPalette(): ThermalPalette {
    return (
      this.remoteFleet.pilotingRemote()?.spec.sensorPalette ?? this.player.spec.sensorPalette ?? "white_hot"
    );
  }

  /** True when a remote or seeker cam wants thermal (palette always craft thermal). */
  activeSensorThermal(): boolean {
    const remote = this.remoteFleet.activeRemote();
    if (remote?.spec.thermal && this.remoteFleet.remoteCamT > 0.2) return true;
    return !!this.activeSensorShot();
  }

  /** Active Spike / Spectre / warp sensor projectile, preferring the selected weapon. */
  activeSensorShot(): Shot | undefined {
    const selected = this.loadout[this.player.weapon];
    if (selected?.cam.thermal) {
      const mine = this.shots.find(
        (s) =>
          s.from === "player" &&
          s.wpnId === selected.id &&
          !!s.st &&
          !s.st.bomblet
      );
      if (mine) return mine;
    }
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i]!;
      if (s.from !== "player" || !s.wpnId || !s.st || s.st.bomblet) continue;
      if (PLAYER_WPNS[s.wpnId]?.cam.thermal) return s;
    }
    return undefined;
  }

  /** Enable/disable thermal from manual T and/or weapon sensorView. */
  applyThermalMode(): void {
    const sensorOn = this.activeSensorThermal();
    const lingerOn = this.sensorLingerT > 0 && this.sensorLingerPalette != null;
    const want = this.thermalManual || sensorOn || lingerOn;
    const palette: ThermalPalette = lingerOn
      ? this.sensorLingerPalette!
      : this.craftSensorPalette();
    if (want === this.thermalOn && (!want || this.thermalPalette === palette)) return;

    this.thermalOn = want;
    this.thermalPalette = palette;
    const cam = this.cameras.main;
    if (this.thermalOn) {
      const customPipeline = setThermalPipeline(cam, true, palette);
      if (customPipeline) this.thermalFx?.reset();
      else {
        if (!this.thermalFx) this.thermalFx = cam.postFX.addColorMatrix();
        this.thermalFx.set([
          0.34, 0.58, 0.08, 0, -0.08,
          0.34, 0.58, 0.08, 0, -0.06,
          0.34, 0.58, 0.08, 0, -0.02,
          0, 0, 0, 1, 0,
        ]);
      }
      this.groundMarks.syncAllThermalWreckMarks();
      this.countermeasures.syncSmokePuffSprites();
      this.postFx.apply();
      this.applyThermalFxBlendMode();
    } else {
      setThermalPipeline(cam, false);
      this.thermalFx?.reset();
      this.groundMarks.syncAllThermalWreckMarks();
      this.countermeasures.syncSmokePuffSprites();
      this.postFx.apply();
      this.applyThermalFxBlendMode();
    }
    this.debugMenu.sync();
  }

  /**
   * Thermal needs fill-tint + NORMAL so smoke/fire/dust encode as semantic heat.
   * ADD/multiply warm colors read dull/cold in the thermal shader.
   */
  applyThermalFxBlendMode(): void {
    for (const kind of Object.keys(this.fx.policies) as FxClass[]) {
      for (const em of this.fx.policies[kind].emitters) {
        if (this.thermalOn) {
          if (!this.fx.thermalSaved.has(em)) {
            this.fx.thermalSaved.set(em, {
              blendMode: em.blendMode as Phaser.BlendModes | string,
              tintFill: em.tintFill,
            });
          }
          em.tintFill = true;
          em.setBlendMode(Phaser.BlendModes.NORMAL);
        } else {
          const saved = this.fx.thermalSaved.get(em);
          if (!saved) continue;
          em.tintFill = saved.tintFill;
          em.setBlendMode(saved.blendMode as Phaser.BlendModes);
        }
      }
    }
  }

  /** After particle ops run: stamp semantic heat (fire hot, dust medium, smoke cools). */
  tintThermalParticles(): void {
    if (!this.thermalOn) return;
    const sparkTint = thermalSignalTint(0.9);
    const dustTint = thermalSignalTint(0.42);
    for (const em of this.fx.policies.fire.emitters) {
      em.forEachAlive((p) => {
        const age = 1 - Phaser.Math.Clamp(p.lifeCurrent / Math.max(1, p.life), 0, 1);
        p.tint = thermalSignalTint(Phaser.Math.Linear(1, 0.78, age));
      }, this);
    }
    for (const em of this.fx.policies.short.emitters) {
      em.forEachAlive((p) => {
        p.tint = sparkTint;
      }, this);
    }
    for (const em of this.fx.policies.dust.emitters) {
      em.forEachAlive((p) => {
        p.tint = dustTint;
      }, this);
    }
    for (const em of this.fx.policies.smoke.emitters) {
      em.forEachAlive((p) => {
        const age = 1 - Phaser.Math.Clamp(p.lifeCurrent / Math.max(1, p.life), 0, 1);
        // Keep rocket / trail smoke readable in FLIR (was cooling to nearly black).
        p.tint = thermalSignalTint(Phaser.Math.Linear(0.62, 0.28, age));
      }, this);
    }
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
      this.exitButton,
    ];
    for (const go of chrome) this.adoptHud(go);
    this.bindHud(this.statusHud.hurtVignette);
    this.bindHud(this.statusHud.hurtVignettePulse);
    this.statusHud.hurtVignette.setPosition(0, 0);
    this.statusHud.hurtVignettePulse.setPosition(0, 0);
    this.reticleHud.bindCameras();
    this.bindHud(this.mapLabel);
    // World-anchored tracking HUD: lock boxes, unit HP — not thermalized.
    for (const go of [this.lockOn.gfx, this.lockOn.txt, this.lockOn.inbdTxt, this.hpGfx, this.threatHud.arcGfx, this.prompts.remoteArmedTxt]) {
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
    for (const c of this.planeClouds) c.im.cameraFilter = cloudFilter;
    const markHudTree = (obj: Phaser.GameObjects.GameObject) => {
      this.bindHud(obj);
      const list = (obj as Phaser.GameObjects.Container).list;
      if (list) for (const ch of list) markHudTree(ch);
    };
    markHudTree(this.debugMenu.root);
    markHudTree(this.help.fieldManual.root);
    markHudTree(this.exitRoot);
    if (this.relief.root) markHudTree(this.relief.root);
    this.children.each((obj) => {
      if (!this.hudSet.has(obj)) this.bindWorld(obj);
    });
    const onAdded = (obj: Phaser.GameObjects.GameObject) => {
      if (this.hudSet.has(obj)) return;
      this.bindWorld(obj);
      if (this.mapWorldHidden && !this.theaterWorldKeep(obj)) {
        const visible = (obj as Phaser.GameObjects.GameObject & { visible: boolean }).visible;
        this.mapWorldVisibility.set(obj, visible);
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

  theaterWorldKeep(obj: Phaser.GameObjects.GameObject): boolean {
    return (
      obj === this.terrain25d ||
      obj === this.ground ||
      obj === this.groundMarks.wreckLayer ||
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
    if (this.mapBlend < 0.12 && !this.over && this.player.phase !== "dead") {
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

  /** Project leave-theater peaks with the same 2.5D pose as units / terrain. */
  syncLeaveTheaterPeaks(): void {
    if (!this.leaveTheaterPeaks.length) return;
    for (const p of this.leaveTheaterPeaks) {
      const at = worldToScreen(p.x, p.y, p.z);
      p.im.setPosition(at.x, at.y).setScale(p.sx * at.scale, p.sy * at.scale);
      const depth = worldDepth(p.z, -0.5, p.y);
      if (p.im.depth !== depth) p.im.setDepth(depth);
    }
  }

  createLeaveTheaterSky(): void {
    for (const im of this.leaveTheaterClouds) im.destroy();
    for (const p of this.leaveTheaterPeaks) p.im.destroy();
    this.leaveTheaterClouds = [];
    this.leaveTheaterPeaks = [];
    // Outside-map sky is only visible when the chase cam can leave the playable rect.
    if (craftCameraEdgeLocked(this.player.spec)) return;

    const keys = ["fx_cloud_1", "fx_cloud_2", "fx_cloud_3", "fx_cloud_4"].filter((k) =>
      this.textures.exists(k)
    );
    if (!keys.length) return;

    const pad = MAP_AIR_SOFT + 900;
    const lo = -pad;
    const hi = WORLD + pad;
    // Behind the map: visible once the camera scrolls past the terrain edge.
    const skyDepth = Layer.TERRAIN - 2;
    // Soft fog bank over the hard map cut.
    const fogDepth = Layer.WRECK + 0.5;
    const seaZ = waterSurfaceZ();
    let ki = 0;

    const place = (
      x: number,
      y: number,
      depth: number,
      alpha: number,
      scale: number,
      tint: number,
      stretchX: number
    ) => {
      const key = keys[ki++ % keys.length]!;
      const im = this.add.image(x, y, key);
      const flip = Math.random() < 0.5 ? -1 : 1;
      im.setOrigin(0.5)
        .setDepth(depth)
        .setAlpha(alpha)
        .setScale(scale * stretchX * flip, scale)
        .setRotation((Math.random() - 0.5) * 0.5);
      if (tint !== 0xffffff) im.setTint(tint);
      this.leaveTheaterClouds.push(im);
    };

    // Cloud sea filling the leave-theater pad (reject samples inside the map).
    for (let n = 0, tries = 0; n < 90 && tries < 800; tries++) {
      const x = lo + Math.random() * (hi - lo);
      const y = lo + Math.random() * (hi - lo);
      if (x > -40 && x < WORLD + 40 && y > -40 && y < WORLD + 40) continue;
      place(
        x,
        y,
        skyDepth,
        range(0.38, 0.72),
        range(1.35, 2.6),
        0xc5d4e0,
        range(1.15, 1.75)
      );
      n++;
    }
    // Extra cloud banks in the mountain belt so peaks sit in a cloudy range, not empty sky.
    for (let n = 0; n < 55; n++) {
      const side = n % 4;
      const t = Math.random() * WORLD;
      const out = range(80, 520);
      let x = 0;
      let y = 0;
      if (side === 0) {
        x = t;
        y = -out;
      } else if (side === 1) {
        x = WORLD + out;
        y = t;
      } else if (side === 2) {
        x = t;
        y = WORLD + out;
      } else {
        x = -out;
        y = t;
      }
      place(
        x + range(-90, 90),
        y + range(-90, 90),
        skyDepth,
        range(0.4, 0.75),
        range(1.5, 2.8),
        0xd0dce8,
        range(1.2, 1.9)
      );
    }

    // Cloudy mountain ranges wrapping the leave-theater pad (projected like units).
    const peaks = ["fx_mountain_peak_1", "fx_mountain_peak_2", "fx_mountain_peak_3"].filter((k) =>
      this.textures.exists(k)
    );
    if (peaks.length) {
      let pi = 0;
      const placePeak = (
        x: number,
        y: number,
        sc: number,
        zOff: number,
        tint?: number
      ) => {
        const key = peaks[pi++ % peaks.length]!;
        const flip = Math.random() < 0.5 ? -1 : 1;
        const im = this.add.image(0, 0, key);
        im.setOrigin(0.5, 0.82).setAlpha(1);
        if (tint != null) im.setTint(tint);
        this.leaveTheaterPeaks.push({
          im,
          x,
          y,
          z: seaZ + zOff,
          sx: sc * flip,
          sy: sc,
        });
      };

      // Two depth bands per edge: mid + near (far haze band dropped for density).
      type Band = { out: number; span: number; step: number; sc: [number, number]; z: [number, number]; tint: number };
      const bands: Band[] = [
        { out: 300, span: 120, step: 170, sc: [0.95, 1.55], z: [4, 10], tint: 0xc4d0dc },
        { out: 140, span: 90, step: 140, sc: [1.2, 2.05], z: [6, 14], tint: 0xffffff },
      ];

      const alongEdge = (
        axis: "x" | "y",
        edge: number,
        outSign: number,
        band: Band
      ) => {
        for (let t = -200; t <= WORLD + 200; t += band.step) {
          const j = range(-band.step * 0.35, band.step * 0.35);
          const out = outSign * (band.out + range(-band.span * 0.4, band.span * 0.6));
          // Occasional double-stack so ridges look continuous.
          const n = Math.random() < 0.4 ? 2 : 1;
          for (let k = 0; k < n; k++) {
            const ox = range(-70, 70);
            const oy = range(-55, 55);
            const sc = range(band.sc[0], band.sc[1]) * (k === 0 ? 1 : range(0.75, 0.95));
            if (axis === "x") {
              placePeak(t + j + ox, edge + out + oy, sc, range(band.z[0], band.z[1]), band.tint);
            } else {
              placePeak(edge + out + ox, t + j + oy, sc, range(band.z[0], band.z[1]), band.tint);
            }
          }
        }
      };

      for (const band of bands) {
        alongEdge("x", 0, -1, band);
        alongEdge("x", WORLD, 1, band);
        alongEdge("y", 0, -1, band);
        alongEdge("y", WORLD, 1, band);
      }

      // Corner massifs where ranges meet.
      for (const [cx, cy, sx, sy] of [
        [0, 0, -1, -1],
        [WORLD, 0, 1, -1],
        [0, WORLD, -1, 1],
        [WORLD, WORLD, 1, 1],
      ] as const) {
        for (let i = 0; i < 9; i++) {
          const dist = range(120, 520);
          const ang = range(0.15, 1.35); // stay in the outside quadrant
          placePeak(
            cx + sx * Math.cos(ang) * dist + range(-40, 40),
            cy + sy * Math.sin(ang) * dist + range(-40, 40),
            range(0.9, 2.0),
            range(3, 14),
            i < 3 ? 0xa8b8c8 : 0xffffff
          );
        }
      }

      // Light outer-pad scatter so the sea of peaks continues.
      for (let n = 0, tries = 0; n < 22 && tries < 280; tries++) {
        const x = lo + Math.random() * (hi - lo);
        const y = lo + Math.random() * (hi - lo);
        if (x > -80 && x < WORLD + 80 && y > -80 && y < WORLD + 80) continue;
        placePeak(x, y, range(0.75, 1.45), range(1, 8), 0xb0c0d0);
        n++;
      }

      this.syncLeaveTheaterPeaks();
    }

    // Fog / cloud bank along each map edge — seam kiss + lighter outer bank.
    const step = 220;
    const fogTint = 0xdce6ee;
    const alongX = (edgeY: number, outSign: number) => {
      for (let t = -120; t <= WORLD + 120; t += step) {
        const j = range(-70, 70);
        // Seam row: small scale so half-sprite barely crosses the edge.
        place(
          t + j,
          edgeY + outSign * range(12, 55),
          fogDepth,
          range(0.35, 0.58),
          range(0.55, 0.95),
          fogTint,
          range(1.2, 1.7)
        );
        // Outer bank — a bit sparser/softer than the original double row.
        if (Math.random() < 0.72) {
          place(
            t + j * 0.6,
            edgeY + outSign * range(100, 260),
            fogDepth,
            range(0.38, 0.65),
            range(1.05, 2.0),
            fogTint,
            range(1.2, 1.9)
          );
        }
      }
    };
    const alongY = (edgeX: number, outSign: number) => {
      for (let t = -120; t <= WORLD + 120; t += step) {
        const j = range(-70, 70);
        place(
          edgeX + outSign * range(12, 55),
          t + j,
          fogDepth,
          range(0.35, 0.58),
          range(0.55, 0.95),
          fogTint,
          range(1.2, 1.7)
        );
        if (Math.random() < 0.72) {
          place(
            edgeX + outSign * range(100, 260),
            t + j * 0.6,
            fogDepth,
            range(0.38, 0.65),
            range(1.05, 2.0),
            fogTint,
            range(1.2, 1.9)
          );
        }
      }
    };
    alongX(0, -1);
    alongX(WORLD, 1);
    alongY(0, -1);
    alongY(WORLD, 1);

    // Corner puffs stay outside both edges.
    for (const [cx, cy, sx, sy] of [
      [0, 0, -1, -1],
      [WORLD, 0, 1, -1],
      [0, WORLD, -1, 1],
      [WORLD, WORLD, 1, 1],
    ] as const) {
      for (let i = 0; i < 4; i++) {
        place(
          cx + sx * range(70, 230) + range(-10, 10),
          cy + sy * range(70, 230) + range(-10, 10),
          fogDepth,
          range(0.4, 0.68),
          range(1.0, 1.85),
          fogTint,
          range(1.15, 1.75)
        );
      }
    }
  }

  createPlaneCloudParallax(): void {
    this.planeClouds = [];
    const keys = ["fx_cloud_1", "fx_cloud_2", "fx_cloud_3", "fx_cloud_4"].filter((k) =>
      this.textures.exists(k)
    );
    if (!keys.length) return;
    const look = craftCloudParallax(this.player.spec);
    // Above craft / world / field HUD tracking; just under chrome HUD.
    const cloudDepth = Layer.HUD - 40;
    // High cruise: distant banks (low scroll). Low cruise: nearer (scroll pulled up).
    // Keep scroll high enough that a random field still intersects the view.
    const scrollOf = (far: number) =>
      Phaser.Math.Linear(
        Math.max(far, 0.22),
        Phaser.Math.Clamp(far + 0.45, 0.5, 0.88),
        look.nearness
      );
    const layers: {
      n: number;
      scroll: number;
      alpha: [number, number];
      scale: [number, number];
      depth: number;
    }[] = [
      {
        n: 8,
        scroll: scrollOf(0.22),
        alpha: [0.34 * look.alphaMul, 0.55 * look.alphaMul],
        scale: [0.85 * look.sizeMul, 1.45 * look.sizeMul],
        depth: cloudDepth - 2,
      },
      {
        n: 7,
        scroll: scrollOf(0.34),
        alpha: [0.4 * look.alphaMul, 0.62 * look.alphaMul],
        scale: [0.65 * look.sizeMul, 1.15 * look.sizeMul],
        depth: cloudDepth - 1,
      },
      {
        n: 6,
        scroll: scrollOf(0.48),
        alpha: [0.36 * look.alphaMul, 0.58 * look.alphaMul],
        scale: [0.5 * look.sizeMul, 0.95 * look.sizeMul],
        depth: cloudDepth,
      },
    ];
    let i = 0;
    for (const layer of layers) {
      const sf = layer.scroll;
      const hx = this.player.x * sf;
      const hy = this.player.y * sf;
      // A few bank centers per layer, clouds jittered tightly around each.
      const clumpN = Math.max(2, Math.round(layer.n / 3));
      const clumps: { cx: number; cy: number }[] = [];
      for (let c = 0; c < clumpN; c++) {
        clumps.push({
          cx: hx + range(-1800, 1800),
          cy: hy + range(-1800, 1800),
        });
      }
      for (let n = 0; n < layer.n; n++, i++) {
        const key = keys[i % keys.length]!;
        const clump = clumps[n % clumps.length]!;
        const x = clump.cx + range(-280, 280);
        const y = clump.cy + range(-200, 200);
        const im = this.add.image(x, y, key);
        const sc = range(layer.scale[0], layer.scale[1]);
        const flip = Math.random() < 0.5 ? -1 : 1;
        const stretchX = range(1.05, 1.4);
        im.setOrigin(0.5)
          .setScrollFactor(sf)
          .setDepth(layer.depth)
          .setAlpha(range(layer.alpha[0], layer.alpha[1]))
          .setScale(sc * stretchX * flip, sc)
          .setRotation((Math.random() - 0.5) * 0.35)
          .setVisible(true);
        this.planeClouds.push({
          im,
          baseX: x,
          baseY: y,
          driftAng: Math.random() * Math.PI * 2,
          driftSpd: range(3.5, 12),
        });
      }
    }
  }

  syncPlaneCloudParallax(dt: number): void {
    if (!this.planeClouds.length) return;
    const show = this.mapBlend < 0.45 && this.player.phase !== "dead";
    const cam = this.cameras.main;
    const viewW = cam.width / Math.max(0.05, cam.zoom) + 1600;
    const viewH = cam.height / Math.max(0.05, cam.zoom) + 1600;
    for (const c of this.planeClouds) {
      c.driftAng += dt * 0.04;
      const amp = c.driftSpd * 10;
      // Keep banks wrapping through the parallax-visible window around the camera.
      const sf = c.im.scrollFactorX;
      const originX = cam.scrollX * sf;
      const originY = cam.scrollY * sf;
      const wrap = (v: number, lo: number, span: number) => {
        if (span <= 1) return v;
        let t = (v - lo) % span;
        if (t < 0) t += span;
        return lo + t;
      };
      c.baseX = wrap(c.baseX, originX - viewW * 0.5, viewW);
      c.baseY = wrap(c.baseY, originY - viewH * 0.5, viewH);
      c.im.x = c.baseX + Math.cos(c.driftAng) * amp;
      c.im.y = c.baseY + Math.sin(c.driftAng * 0.73) * amp * 0.75;
      if (c.im.visible !== show) c.im.setVisible(show);
    }
  }

  /** Framing zoom for a craft at altitude / speed (host or remote hull). */
  craftPlayZoom(
    spec: ReturnType<typeof craftOf>,
    z: number,
    vx: number,
    vy: number
  ): number {
    // Perspective keeps chase-focus scale stable; Phaser zoom is framing only.
    const base = camZoomAt(z) * craftCameraScale(spec);
    const spdN = Phaser.Math.Clamp(Math.hypot(vx, vy) / Math.max(1, spec.maxSpeed), 0, 1);
    const planeScheme = craftControlScheme(spec) === "plane";
    const planeish = spec.flightModel === "plane" || spec.flightModel === "vtol";
    const speedClass = Math.sqrt(spec.maxSpeed / 340);
    if (planeScheme) {
      // Jets: slightly wider baseline + modest speed pullback (not theater-map zoom).
      const baseMul = 0.9;
      const maxPullback = Phaser.Math.Clamp(0.26 * speedClass, 0.22, 0.34);
      return base * baseMul * (1 - spdN * maxPullback);
    }
    const maxPullback = planeish
      ? Phaser.Math.Clamp(0.22 * speedClass, 0.2, 0.42)
      : Phaser.Math.Clamp(0.1 * speedClass, 0.08, 0.16);
    return base * (1 - spdN * maxPullback);
  }

  playZoom(): number {
    const h = this.player;
    const hostZoom = this.craftPlayZoom(h.spec, h.z, h.vx, h.vy);
    const remote = this.remoteFleet.activeRemote();
    if (!remote || this.remoteFleet.remoteCamT < 0.001 || !remote.spec.craftLook) return hostZoom;
    const hull = craftOf(remote.spec.craftLook);
    const remZoom = this.craftPlayZoom(hull, remote.z, remote.vx, remote.vy);
    return Phaser.Math.Linear(hostZoom, remZoom, this.remoteFleet.remoteCamT);
  }

  syncProjectionPose(): void {
    const anchor = this.playerCamAnchor();
    const focusX = anchor.x + this.lookCamX;
    const focusY = anchor.y + this.lookCamY;
    const focusZ =
      this.stingerT > 0 && this.stingerTarget?.z != null && !this.stingerReleased
        ? this.stingerFocusZ
        : anchor.z;
    setCamera25DFocus(focusX, focusY, focusZ);
    // Camera-space coordinates from getWorldPoint are stale after recentering,
    // even within the same game-loop frame.
    this.ptrFrame = -1;
    this.ptrWorldReady = false;
    if (this.mapBlend < 0.001) this.cameras.main.centerOn(focusX, focusY);
    this.syncFieldHudCam();
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
    // Helis / VTOL: clamp scroll to the map. Planes track freely (forced U-turn craft).
    if (craftCameraEdgeLocked(this.player.spec)) {
      sx = Phaser.Math.Clamp(sx, bx, bw);
      sy = Phaser.Math.Clamp(sy, by, bh);
    }
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
        Phaser.Math.Linear(this.player.x, WORLD / 2, ease),
        Phaser.Math.Linear(this.player.y, WORLD / 2, ease)
      );
      this.mapView = true;
      this.reticleHud.hideAimChrome();
      if (!this.mapWant && this.mapBlend < 0.08) this.mapLabel.setVisible(false);
      else this.mapLabel.setVisible(true);
    } else {
      this.mapView = false;
      this.mapLabel.setVisible(false);
      if (craftCameraEdgeLocked(this.player.spec)) {
        cam.setBounds(0, 0, WORLD, WORLD);
        cam.useBounds = true;
      } else {
        cam.useBounds = false;
      }
    }
    this.syncFieldHudCam();
  }

  syncLookCam(dt: number): void {
    this.applyThermalMode();
    // Linger drains on wall-clock even when stinger/death own the look blend.
    this.tickImpactCamLinger(dt);
    // Death cam owns look immediately — don't let HV/mission stingers steal it.
    if (this.player.phase !== "dead" && this.stingerT > 0 && this.stingerTarget && !this.stingerReleased) {
      const elapsed = this.stingerDuration - this.stingerT;
      const ease = (t: number) => {
        const u = Phaser.Math.Clamp(t, 0, 1);
        return u * u * (3 - 2 * u);
      };
      const arrive = ease(elapsed / 0.55);
      const anchor = this.playerCamAnchor();
      const fullOx = this.stingerTarget.x - anchor.x;
      const fullOy = this.stingerTarget.y - anchor.y;
      // If impact linger is still on (near) this site, don't ease back to the player mid-stinger.
      const lingerCovers =
        this.povCamLookHold > 0 &&
        Math.hypot(this.povCamLookX - this.stingerTarget.x, this.povCamLookY - this.stingerTarget.y) < 320;
      const leave = lingerCovers ? 1 : ease(this.stingerT / 0.85);
      // Arrive from wherever we already were (e.g. povCam chase), not from zero/player.
      let ox = Phaser.Math.Linear(this.stingerCamFromX, fullOx, arrive);
      let oy = Phaser.Math.Linear(this.stingerCamFromY, fullOy, arrive);
      const targetZ = this.stingerTarget.z ?? anchor.z;
      let focusZ = Phaser.Math.Linear(this.stingerCamFromZ, targetZ, arrive);
      if (leave < 1) {
        // Default leave collapses toward heli (0,0). In Spectre view, ease back to the drone
        // so we don't flash the bird before remoteCamT reclaims the look.
        let restX = 0;
        let restY = 0;
        let restZ = anchor.z;
        if (this.remoteFleet.remoteView) {
          const drone = this.remoteFleet.activeRemote();
          if (drone) {
            const seek = this.remoteFleet.remoteLookOffset(drone);
            restX = seek.x;
            restY = seek.y;
            restZ = drone.z;
          }
        }
        ox = Phaser.Math.Linear(restX, ox, leave);
        oy = Phaser.Math.Linear(restY, oy, leave);
        focusZ = Phaser.Math.Linear(restZ, focusZ, leave);
      }
      this.stingerFocusZ = focusZ;
      const k = 1 - Math.exp(-5.5 * dt);
      this.lookCamX = Phaser.Math.Linear(this.lookCamX, ox, k);
      this.lookCamY = Phaser.Math.Linear(this.lookCamY, oy, k);
      this.syncProjectionPose();
      return;
    }
    if (this.player.phase === "dead") {
      // Resting focus = mid(last live, hulk); mouse pulls away from that center.
      const anchor = this.playerCamAnchor();
      const p = this.pointerScreen();
      const pointerAtFocus = screenToWorldAtZ(p.x, p.y, anchor.z);
      const pull = 0.32;
      const max = 160;
      let ox = (pointerAtFocus.x - anchor.x) * pull;
      let oy = (pointerAtFocus.y - anchor.y) * pull;
      const len = Math.hypot(ox, oy);
      if (len > max) {
        ox *= max / len;
        oy *= max / len;
      }
      const k = 1 - Math.exp(-8.5 * dt);
      this.lookCamX = Phaser.Math.Linear(this.lookCamX, ox, k);
      this.lookCamY = Phaser.Math.Linear(this.lookCamY, oy, k);
      this.syncProjectionPose();
      return;
    }
    this.remoteFleet.tickRemoteCamBlend(dt);
    const remote = this.remoteFleet.activeRemote();
    const sensor = this.activeSensorShot();
    if (sensor) {
      const hx = this.player.x;
      const hy = this.player.y;
      const p = this.pointerScreen();
      const aim = screenToWorldAtZ(p.x, p.y, this.player.z);
      // Keep the pre-fire aim look-ahead until the missile has cleared the bird.
      const aimPull = 0.55;
      const aimMax = 210;
      let aimOx = (aim.x - hx) * aimPull;
      let aimOy = (aim.y - hy) * aimPull;
      const aimSpan = Math.hypot(aimOx, aimOy);
      if (aimSpan > aimMax) {
        aimOx *= aimMax / aimSpan;
        aimOy *= aimMax / aimSpan;
      }
      // Seeker frame: lead past the missile toward the reticle so it isn't pinned to the far edge.
      const toAx = aim.x - sensor.x;
      const toAy = aim.y - sensor.y;
      const aLen = Math.hypot(toAx, toAy);
      const spd = Math.hypot(sensor.vx, sensor.vy);
      const lead = Phaser.Math.Clamp(100 + spd * 0.28, 100, 220);
      let lx = 0;
      let ly = 0;
      if (aLen > 12) {
        const use = Math.min(lead, aLen * 0.7);
        lx = (toAx / aLen) * use;
        ly = (toAy / aLen) * use;
      } else {
        lx = Math.cos(sensor.angle) * lead * 0.55;
        ly = Math.sin(sensor.angle) * lead * 0.55;
      }
      const seekOx = sensor.x + lx - hx;
      const seekOy = sensor.y + ly - hy;
      const dist = Math.hypot(sensor.x - hx, sensor.y - hy);
      const handoff = Phaser.Math.Clamp((dist - 40) / 180, 0, 1);
      const ox = Phaser.Math.Linear(aimOx, seekOx, handoff);
      const oy = Phaser.Math.Linear(aimOy, seekOy, handoff);
      const ahead = Math.hypot(sensor.x - (hx + this.lookCamX), sensor.y - (hy + this.lookCamY));
      const baseRate = sensor.wpnId && PLAYER_WPNS[sensor.wpnId]?.cam.thermal ? 3.6 : 4.2;
      const rate = baseRate + Phaser.Math.Clamp(ahead / 220, 0, 1) * 2.8;
      const k = 1 - Math.exp(-rate * dt);
      this.lookCamX = Phaser.Math.Linear(this.lookCamX, ox, k);
      this.lookCamY = Phaser.Math.Linear(this.lookCamY, oy, k);
      this.syncProjectionPose();
      return;
    }
    const p = this.pointerScreen();
    const pointerAtFocus = screenToWorldAtZ(p.x, p.y, this.player.z);
    // While remote POV is active, look pull follows the HUD weapon (not host slot).
    const wpnSpec =
      remote && this.remoteFleet.remoteCamT > 0.2
        ? this.fireControl.hudLoadout()[this.fireControl.hudWeapon()]!
        : this.loadout[this.player.weapon]!;
    const lookPlane =
      remote && this.remoteFleet.remoteCamT > 0.2 && remote.spec.craftLook
        ? craftControlScheme(craftOf(remote.spec.craftLook)) === "plane"
        : craftControlScheme(this.player.spec) === "plane";
    const look = planeLookCam(wpnSpec, lookPlane);
    const pull = look.pull;
    const max = look.max;
    let ox = (pointerAtFocus.x - this.player.x) * pull;
    let oy = (pointerAtFocus.y - this.player.y) * pull;
    const len = Math.hypot(ox, oy);
    if (len > max) {
      ox *= max / len;
      oy *= max / len;
    }
    let rate = look.rate;
    let pov: Shot | undefined;
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i]!;
      if (s.from !== "player") continue;
      // Live shot with cam.povCam — ride it until impact linger takes over.
      if (s.povCam) {
        pov = s;
        break;
      }
    }
    if (pov) {
      this.povCamLookX = pov.x;
      this.povCamLookY = pov.y;
      // Live follow — don't accumulate linger while the shot is still airborne.
      this.povCamLookHold = 0;
      ox += (pov.x - this.player.x) * 0.82;
      oy += (pov.y - this.player.y) * 0.82;
      rate = 5.4;
    } else if (this.povCamLookHold > 0) {
      ox += (this.povCamLookX - this.player.x) * 0.82;
      oy += (this.povCamLookY - this.player.y) * 0.82;
      rate = 5.4;
    } else if (this.sensorLingerT <= 0) {
      this.sensorLingerPalette = null;
    }
    if (remote && this.remoteFleet.remoteCamT > 0.001) {
      const seek = this.remoteFleet.remoteLookOffset(remote);
      ox = Phaser.Math.Linear(ox, seek.x, this.remoteFleet.remoteCamT);
      oy = Phaser.Math.Linear(oy, seek.y, this.remoteFleet.remoteCamT);
      rate = Phaser.Math.Linear(rate, 3.2, this.remoteFleet.remoteCamT);
    }
    const k = 1 - Math.exp(-rate * dt);
    this.lookCamX = Phaser.Math.Linear(this.lookCamX, ox, k);
    this.lookCamY = Phaser.Math.Linear(this.lookCamY, oy, k);
    this.syncProjectionPose();
  }

  /** Any cursor-owning overlay open (help, exit, editor, debug menus) — rig cursor sync reads this. */
  uiOverlayOpen(): boolean {
    const d = this.debugMenu;
    return this.help.open || this.exitOpen || this.relief.open || d.open || d.camOpen || d.spawnOpen;
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
    if (this.relief.root) this.relief.root.setVisible(this.relief.open && (on || this.mapBlend > 0.12));
    this.hpGfx.setVisible(on);
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
    const vx = this.playViewW ? this.playViewX : this.player.x - pw / 2;
    const vy = this.playViewH ? this.playViewY : this.player.y - ph / 2;
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
    g.fillCircle(this.player.x, this.player.y, u(5));
  }

  hideMapHvLabels(): void {
    for (const t of this.mapHvLabels) t.setVisible(false);
  }

  syncMapHvLabels(u: (px: number) => number): void {
    while (this.mapHvLabels.length < this.world.hv.length) {
      const t = this.add
        .text(0, 0, "", {
          fontFamily: "Share Tech Mono, monospace",
          fontSize: "12px",
          color: "#ffe08a",
          align: "left",
        })
        .setOrigin(0, 0.5)
        .setDepth(Layer.HUD + 3)
        .setStroke("#12100c", 4);
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
      const kind = String(spec.kind ?? "HV").toUpperCase();
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
    for (const r of this.remotes) {
      if (r.detonate) continue;
      if (!cameraPointVisible(r.z, r.y)) continue;
      const at = worldToScreen(r.x, r.y, r.z);
      const zs = at.scale;
      const batY = at.y - r.spec.height * zs - 22 * zs;
      if (r.health < r.spec.health - 0.5) {
        const hw = 26.4 * zs;
        const hr = Phaser.Math.Clamp(r.health / Math.max(1, r.spec.health), 0, 1);
        const hx = at.x - hw / 2;
        // Sits above the battery; takes its slot when there is none.
        const hy = r.spec.unlimitedLife ? batY + 2 * zs : batY - 6 * zs;
        g.fillStyle(0x10100c, 0.7);
        g.fillRect(hx, hy, hw, 4 * zs);
        g.fillStyle(hr > 0.5 ? 0x6dbb4a : hr > 0.25 ? 0xe8b84a : 0xff4a2a, 1);
        g.fillRect(hx, hy, hw * hr, 4 * zs);
      }
      if (r.spec.unlimitedLife) continue;
      this.drawBatteryIcon(g, at.x - BATTERY_ICON_W * zs * 0.5, batY, r.life / Math.max(0.05, r.lifeMax), zs);
    }
    const armed = this.remoteFleet.remoteDetonateArmed();
    const drone = armed ? this.remoteFleet.activeRemote() : undefined;
    if (!drone || !cameraPointVisible(drone.z, drone.y) || this.mapView || this.over) {
      this.prompts.remoteArmedTxt.setVisible(false);
    } else {
      const at = worldToScreen(drone.x, drone.y, drone.z);
      const zs = at.scale;
      const blink = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(this.time.now * 0.014));
      this.prompts.remoteArmedTxt
        .setVisible(true)
        .setText("ARMED")
        .setPosition(
          at.x,
          at.y - drone.spec.height * zs - (drone.health < drone.spec.health - 0.5 ? 40 : 34) * zs
        )
        .setScale(zs)
        .setAlpha(blink)
        .setDepth(worldDepth(drone.z, ZOff.body + 2, drone.y));
    }
  }

  /** Segmented battery icon (remote overhead + HUD pool); x/y = top-left, width BATTERY_ICON_W × zs. */
  drawBatteryIcon(g: Phaser.GameObjects.Graphics, x: number, y: number, frac: number, zs: number): void {
    const segs = 4;
    const bodyW = 24 * zs;
    const bodyH = 8 * zs;
    const nubW = 2.4 * zs;
    const nubH = 4.2 * zs;
    const pad = 1.5 * zs;
    const gap = 1.15 * zs;
    const rBody = 1.5 * zs;
    const innerW = bodyW - pad * 2;
    const innerH = bodyH - pad * 2;
    const segW = (innerW - gap * (segs - 1)) / segs;
    const ratio = Phaser.Math.Clamp(frac, 0, 1);
    const filled = ratio > 0.001 ? Math.min(segs, Math.max(1, Math.ceil(ratio * segs - 1e-6))) : 0;
    const low = filled <= 1;
    const col = low ? 0xff2a18 : filled >= 3 ? 0x5caa3a : 0xe8c44a;
    const pulse = low ? 0.38 + 0.62 * (0.5 + 0.5 * Math.sin(this.time.now * 0.022)) : 1;
    g.fillStyle(0x10100c, 0.72 * pulse);
    g.fillRoundedRect(x, y, bodyW, bodyH, rBody);
    g.lineStyle(Math.max(1, 1.15 * zs), low ? col : 0xd8d8cc, 0.92 * pulse);
    g.strokeRoundedRect(x, y, bodyW, bodyH, rBody);
    g.fillStyle(low ? col : 0xd8d8cc, 0.92 * pulse);
    g.fillRoundedRect(x + bodyW - 0.4 * zs, y + (bodyH - nubH) / 2, nubW, nubH, 0.7 * zs);
    for (let i = 0; i < segs; i++) {
      const sx = x + pad + i * (segW + gap);
      const sy = y + pad;
      g.fillStyle(0x080806, 0.85);
      g.fillRect(sx, sy, segW, innerH);
      if (i >= filled) continue;
      g.fillStyle(col, pulse);
      g.fillRect(sx, sy, segW, innerH);
    }
  }








  showStinger(
    title: string,
    detail: string,
    color: number,
    duration: number,
    target?: { x: number; y: number; z?: number },
    done?: () => void,
    style: "dramatic" | "subtle" = "dramatic"
  ): void {
    if (this.stingerT > 0) {
      this.stingerQueue.push({ title, detail, color, duration, target, done, style });
      return;
    }
    this.presentStinger({ title, detail, color, duration, target, done, style });
  }

  presentStinger(job: StingerJob): void {
    this.stingerRoot?.destroy(true);
    const { width, height } = this.scale;
    const style = job.style ?? "dramatic";
    this.stingerStyle = style;
    this.stingerReleased = false;
    // Held Space (climb) must release before subtle dismiss can fire.
    this.stingerSpaceArmed = !this.keySpace?.isDown;
    // Ease from current look / focus altitude (e.g. gunship AGL), never snap 2.5D scale.
    this.stingerCamFromX = this.lookCamX;
    this.stingerCamFromY = this.lookCamY;
    this.stingerCamFromZ = this.playerCamAnchor().z;
    this.stingerFocusZ = this.stingerCamFromZ;
    const kids: Phaser.GameObjects.GameObject[] = [];
    if (style === "dramatic") {
      kids.push(this.add.rectangle(width / 2, height / 2, width, 92, 0x090908, 0.82));
      kids.push(this.add.rectangle(width / 2, height / 2 - 46, width, 2, job.color, 0.9));
      kids.push(this.add.rectangle(width / 2, height / 2 + 46, width, 2, job.color, 0.9));
    }
    const titleSize = style === "subtle" ? "26px" : "38px";
    const titleAlpha = style === "subtle" ? 0.88 : 1;
    const text = this.add
      .text(width / 2, height / 2 - (style === "subtle" ? 4 : 8), job.title, {
        fontFamily: "Black Ops One, Impact, sans-serif",
        fontSize: titleSize,
        color: `#${job.color.toString(16).padStart(6, "0")}`,
        align: "center",
      })
      .setOrigin(0.5)
      .setAlpha(titleAlpha);
    const sub = this.add
      .text(width / 2, height / 2 + (style === "subtle" ? 22 : 26), job.detail, {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: style === "subtle" ? "12px" : "14px",
        color: style === "subtle" ? "#c8c0aa" : "#e8e0cc",
      })
      .setOrigin(0.5)
      .setAlpha(style === "subtle" ? 0.82 : 1);
    if (style === "subtle") {
      text.setStroke("#0c0a08", 5).setShadow(0, 2, "#000000", 8, true, true);
      sub.setStroke("#0c0a08", 4).setShadow(0, 2, "#000000", 6, true, true);
    }
    kids.push(text, sub);
    const root = this.add
      .container(0, 0, kids)
      .setScrollFactor(0)
      .setDepth(Layer.HUD + 80)
      .setAlpha(0);
    // Children were bindWorld'd on add — retarget the whole tree to hudCam.
    this.markHudTree(root);
    this.stingerRoot = root;
    this.stingerText = text;
    this.stingerT = job.duration;
    this.stingerDuration = job.duration;
    this.stingerTarget = job.target;
    this.stingerDone = job.done;
  }

  /** Subtle objective stinger: Space frees camera + hides banner; time warp keeps running. */
  releaseSubtleStingerEarly(): void {
    if (this.stingerT <= 0 || this.stingerStyle !== "subtle" || this.stingerReleased) return;
    this.stingerReleased = true;
    this.stingerTarget = undefined;
    this.stingerRoot?.setVisible(false);
  }

  tickStinger(wallDt: number): void {
    if (this.stingerT <= 0 || !this.stingerRoot) return;
    const elapsedBefore = this.stingerDuration - this.stingerT;
    if (this.stingerStyle === "subtle" && !this.stingerReleased) {
      // Spectre POV: Space is unused by the drone and was eating the focus cam
      // (mission complete is dramatic → no Space dismiss). Keep focus while remoteView.
      if (this.remoteFleet.remoteView) {
        this.stingerSpaceArmed = false;
      } else if (!this.stingerSpaceArmed) {
        if (!this.keySpace.isDown) this.stingerSpaceArmed = true;
      } else if (
        // Let arrive finish before Space can drop the focus.
        elapsedBefore >= 0.55 &&
        Phaser.Input.Keyboard.JustDown(this.keySpace)
      ) {
        this.releaseSubtleStingerEarly();
      }
    }
    this.stingerT = Math.max(0, this.stingerT - wallDt);
    const elapsed = this.stingerDuration - this.stingerT;
    const fadeIn = Phaser.Math.Clamp(elapsed / 0.12, 0, 1);
    const fadeOut = Phaser.Math.Clamp(this.stingerT / 0.22, 0, 1);
    if (!this.stingerReleased) {
      this.stingerRoot.setAlpha(Math.min(fadeIn, fadeOut));
    }
    if (this.stingerText && !this.stingerReleased) {
      this.stingerText.setScale(Phaser.Math.Linear(1.12, 1, Phaser.Math.Clamp(elapsed / 0.3, 0, 1)));
    }
    if (this.stingerT === 0) {
      this.stingerRoot.destroy(true);
      this.stingerRoot = undefined;
      this.stingerText = undefined;
      this.stingerTarget = undefined;
      this.stingerReleased = false;
      this.stingerSpaceArmed = false;
      const done = this.stingerDone;
      this.stingerDone = undefined;
      done?.();
      const next = this.stingerQueue.shift();
      if (next) this.presentStinger(next);
    }
  }

  end(win: boolean): void {
    if (win) {
      // May already be over from mission-success lockout during the stinger.
      if (this.endPromptRoot) return;
      this.over = true;
      this.win = true;
      this.reticleHud.hideAimChrome();
      const { width, height } = this.scale;
      const title = this.add
        .text(width / 2, height / 2 - 18, "MISSION COMPLETE", {
          fontFamily: "Black Ops One, Impact, sans-serif",
          fontSize: "42px",
          color: "#e8b84a",
          align: "center",
        })
        .setOrigin(0.5);
      const sub = this.add
        .text(width / 2, height / 2 + 28, "R  RESTART      ESC  MENU", {
          fontFamily: "Share Tech Mono, monospace",
          fontSize: "16px",
          color: "#e8e0cc",
          align: "center",
        })
        .setOrigin(0.5);
      this.endPromptRoot = this.add
        .container(0, 0, [title, sub])
        .setScrollFactor(0)
        .setDepth(Layer.HUD + 50);
      this.markHudTree(this.endPromptRoot);
      return;
    }
    if (this.over) return;
    this.over = true;
    this.win = false;
    this.reticleHud.hideAimChrome();
    this.endPromptRoot?.destroy(true);
    this.endPromptRoot = undefined;
    // After crash sequence: stinger replaces the old centered R/Esc dialog.
    this.stingerQueue = [];
    this.stingerDone = undefined;
    this.presentStinger({
      title: "AIRCRAFT DOWN",
      detail: "R  RESTART      ESC  MENU",
      color: 0xff6a3a,
      // Hold until restart / menu — effectively persistent.
      duration: 1e9,
    });
  }


  /** Camera follow point: mid(last live, hulk) when dead, else heli. */
  playerCamAnchor(): { x: number; y: number; z: number } {
    if (this.player.phase === "dead") {
      const hulk = this.destruction.playerCrashDebris;
      const cx = hulk?.x ?? this.player.x;
      const cy = hulk?.y ?? this.player.y;
      const cz = hulk?.z ?? this.player.z;
      return {
        x: (this.destruction.playerDeathLiveX + cx) * 0.5,
        y: (this.destruction.playerDeathLiveY + cy) * 0.5,
        z: (this.destruction.playerDeathLiveZ + cz) * 0.5,
      };
    }
    return { x: this.player.x, y: this.player.y, z: this.player.z };
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




















