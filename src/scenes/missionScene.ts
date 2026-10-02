import Phaser from "phaser";
import { FireControl } from "./mission/weapons/fireControl";
import { Projectiles } from "./mission/weapons/projectiles";
import { ensureBlastRingGradient } from "../render/blastRing";
import { shotTrailScale, troopMissileTrail } from "../render/fxScale";
import { Countermeasures, TIMEWARP_PLAYER_SCALE, TIMEWARP_WORLD_SCALE } from "./mission/weapons/countermeasures";
import { LockOn } from "./mission/weapons/lockOn";
import { CallStrike } from "./mission/weapons/callStrike";
import { Refractor } from "./mission/weapons/refractor";
import { TESLA_SEGS, TESLA_STREAMS, Tesla } from "./mission/weapons/tesla";
import { shotIsGunOrBeam } from "../render/spritePose";
import { coneDir, biasedDir, expBiasDir } from "../util/vec";
import { RemoteBody } from "./mission/remote/body";
import { RemoteFleet } from "./mission/remote/fleet";
import { planeLookCam } from "./mission/shared";
import { PostFxTest } from "./mission/debug/postFx";
import { DebugOverlays } from "./mission/debug/overlays";
import { HelpPanel } from "./mission/hud/help";
import { CornerHud } from "./mission/hud/cornerHud";
import { PromptsHud } from "./mission/hud/prompts";
import { jitterDisk } from "../util/rng";
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
import { createFxEmitters } from "../render/fxEmitters";
import { camoForBiome, resolveSkin } from "../render/camo";
import { debrisKeys, heightOf, hulkOf, radius, textureOf, wheelDebrisKeys, playerLoadoutFromSockets, SHOT_TAIL, guidanceIsLockOn, exhaustIsEnergy, exhaustIsGunSpark, exhaustHue, exhaustIsSignalFlare, launchIsArcBeam, ENERGY_TRAIL_NODE_LIFE, HELIX_TRAIL_NODE_LIFE, PLAYER_WPNS, type Debris, type Shot, type SimParticle, type Unit, type PlayerWpnSpec, type EnergyTrailNode } from "../sim/combat";


















import { type RemoteCraft } from "../sim/remote";
import { Layer, ZOff, Z_GRAVITY, worldDepth } from "../render/depth";
import { range } from "../util/rng";
import { Craft, MAP_AIR_SOFT, craftCameraEdgeLocked } from "../sim/craft";
import {
  TOON_BLAST_VARIANTS,
  toonBlastAnimKey,
  toonBlastKey,
} from "../render/toonBlast";
import { ensureAllArtGenAnims } from "../art/artGen";
import { isGroundVehicle, isOrganic, hasSoftBlood, specOf, labelOf, gunsOf, crewOf } from "../sim/roster";
import { circumRadiusOf, footprintOf, randomInFootprint, type Footprint } from "../render/footprint";
import { lookupSpriteMuzzles, lookupSpriteOrigin } from "../art/spriteOrigin";
import { craftAimsWithTurret, craftCameraScale, craftCloudParallax, craftComposite, craftCompositePartScale, craftExhaustFlameHue, craftExhaustFlameSheet, craftExhaustMounts, craftGunOrigin, craftGunSocketSlots, craftControlScheme, craftOf, craftOrigin, craftPreviewExhaustScale, craftPreviewExhaustTint, craftRotorAlongScale, craftRotorFlightSpeed, craftRotorIsProp, craftRotorMounts, craftRotorTiltMul, craftSocketGunScale, craftWingTipMounts, rotorDrawSpan, rotorMountsOf, rotorSpinSign, type CraftComposite } from "../sim/crafts";
import { missionOf } from "../sim/mission";
import { rigsAnyOpen, installRigHotkeys } from "../rigs/rigs";
import { applyEdgeLight, clearEdgeLight, ensureEdgeLightPipeline } from "../render/edgeLight";
import { setThermalPipeline, type ThermalPalette } from "../render/thermal";
import { setGlitchPipeline } from "../render/glitch";
import { setWarpDistortPipeline } from "../render/warpDistort";
import { setCloakFxPipeline } from "../render/cloakFx";
import { createTerrain25D, type Terrain25D } from "../render/terrain25d";
import { extractBiomeTiles, bakeHeliHudWireTexture, shadowAlpha, shadowKey, spriteUvPos, FX_VARIANTS, FX_BLAST_CELLS, registerArt, nameGameTexture, spritePivot, muzzleGlowKey, ensureExhaustGlow, ensureImpactGlow } from "../art/sprites";
import { generateWorld, worldFromGen, groundSlope, groundZ, worldToScreen, setCamera25DFocus, cameraPointVisible, screenToWorldAtZ, screenToWorldOnGround, screenVelX, screenVelY, projectHeading, camZoomAt, castZ, castShadowToGround, isWater, paintHeightMap, applyTerrainLight, sampleBiome, waterSurfaceZ, SCALE, WORLD, WRECK_TEX, CamTune, doodadTex, type WorldData } from "../worldgen/world";

type FxClass = "short" | "fire" | "smoke" | "dust";
type FxPolicy = {
  frameCap: number;
  activeCap: number;
  emitted: number;
  emitters: Set<Phaser.GameObjects.Particles.ParticleEmitter>;
};
export type BurstParticle = Phaser.GameObjects.Particles.Particle & {
  burstVx?: number;
  burstVy?: number;
  burstHeading?: number;
  launchScale?: number;
  launchStretch?: number;
  launchThick?: number;
  launchSpd?: number;
  swirl?: number;
};

type ThermalWreckKind = "blast" | "blood" | "scar" | "shell";

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
  /** Elapsed lifetime (hold + fade); advances even when thermal view is off. */
  age: number;
  kind: ThermalWreckKind;
};

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
};

function thermalWreckTiming(kind: ThermalWreckKind, scaleX: number, scaleY: number): { hold: number; fadeDur: number } {
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
  return { hold: 0.35, fadeDur: 6 + Math.min(7, span * 2.4) };
}

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


/** Parse `30MM` / `.50 CAL` from a catalog designation. */
function caliberMmFromDesignation(designation: string): number | undefined {
  const mm = designation.match(/(\d+(?:\.\d+)?)\s*MM\b/i);
  if (mm) return Number(mm[1]);
  const cal = designation.match(/\.(\d+)\s*CAL/i);
  if (cal) return Number(cal[1]) * 0.254;
  return undefined;
}









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

/** Scratch canvas for tinting blood dirt frames before multiply-stamping terrain. */
let bloodStampScratch: HTMLCanvasElement | null = null;

export class MissionScene extends Phaser.Scene {
  fireControl = new FireControl(this);
  projectiles = new Projectiles(this);
  countermeasures = new Countermeasures(this);
  lockOn = new LockOn(this);
  callStrike = new CallStrike(this);
  refractor = new Refractor(this);
  tesla = new Tesla(this);
  // Subsystems — each owns its state + methods, holds the scene as `s`.
  // enemy
  targeting = new EnemyTargeting(this);
  unitSim = new UnitSim(this);
  enemyFire = new EnemyFire(this);
  // remote
  remoteFleet = new RemoteFleet(this);
  remoteAi = new RemoteAi(this);
  remoteBody = new RemoteBody(this);
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
  simParticles: SimParticle[] = [];
  loadout: PlayerWpnSpec[] = playerLoadoutFromSockets(craftOf().sockets);
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
  /** Additive tip heat glows paired 1:1 with turret `guns` (not fixed muzzles). */
  gunHeatGlows: Phaser.GameObjects.Image[] = [];
  /** Tip glow heat 0–1 (snap on fire, ~9s fade). */
  gunTipHeat: number[] = [];
  shadow!: Phaser.GameObjects.Image;
  towWireGfx!: Phaser.GameObjects.Graphics;
  energyTrailGfx!: Phaser.GameObjects.Graphics;
  /** Neon ribbons that keep fading after the dart is gone. */
  energyLinger: EnergyTrailNode[][] = [];
  unitG!: Phaser.GameObjects.Group;
  debrisG!: Phaser.GameObjects.Group;
  simParticleG!: Phaser.GameObjects.Group;
  thermalHotspotG!: Phaser.GameObjects.Group;
  thermalWreckMarks: ThermalWreckMark[] = [];
  /** Warm ember patches over fresh craters / hulks (ADD, flicker-fade). */
  emberGlows: EmberGlow[] = [];
  smoke!: Phaser.GameObjects.Particles.ParticleEmitter;
  flame!: Phaser.GameObjects.Particles.ParticleEmitter;
  hotFlame!: Phaser.GameObjects.Particles.ParticleEmitter;
  hurtSmoke!: Phaser.GameObjects.Particles.ParticleEmitter;
  playerHurtSmoke!: Phaser.GameObjects.Particles.ParticleEmitter;
  burn!: Phaser.GameObjects.Particles.ParticleEmitter;
  blastBurn!: Phaser.GameObjects.Particles.ParticleEmitter;
  blastFire!: Phaser.GameObjects.Particles.ParticleEmitter;
  shortBurst!: Phaser.GameObjects.Particles.ParticleEmitter;
  /** Long, fast, high-drag streaks for HE / death bursts. */
  streakBurst!: Phaser.GameObjects.Particles.ParticleEmitter;
  /** Big boom sparks: thick dense needles — slow loft, gravity fall, frozen launch angle. */
  bigBoomSparkBurst!: Phaser.GameObjects.Particles.ParticleEmitter;
  /** Reactive armor: big red/pink stretched streak sparks (streakBurst style, own tint). */
  reactiveArmorSpark!: Phaser.GameObjects.Particles.ParticleEmitter;
  /** Big boom dirt streaks — long travel needles that keep size while they fall. */
  bigBoomDirtBurst!: Phaser.GameObjects.Particles.ParticleEmitter;
  /** Cyan blur streaks for Starscream breaks. */
  energyStreakBurst!: Phaser.GameObjects.Particles.ParticleEmitter;
  /** Tesla impact needles — omnidirectional, high-drag, frozen heading. */
  teslaSparkBurst!: Phaser.GameObjects.Particles.ParticleEmitter;
  /** Railgun cyan spit — forward along bolt travel, jitter + shrink. */
  railSparkTrail!: Phaser.GameObjects.Particles.ParticleEmitter;
  /** Magenta motes left along a warp bomb path. */
  warpTrail!: Phaser.GameObjects.Particles.ParticleEmitter;
  /** Soft energy balls trailing the warp bomb. */
  warpOrb!: Phaser.GameObjects.Particles.ParticleEmitter;
  /** Magenta spark needles shed by the warp bomb. */
  warpSparkBurst!: Phaser.GameObjects.Particles.ParticleEmitter;
  /** Round magnesium motes left along a flare’s path (fire-trail style). */
  flareTrail!: Phaser.GameObjects.Particles.ParticleEmitter;
  /** Bigger round sparks at the flare pellet itself. */
  flareSpark!: Phaser.GameObjects.Particles.ParticleEmitter;
  /** Signal-flare gun: pink/red flame-smoke loft trail. */
  signalFlareTrail!: Phaser.GameObjects.Particles.ParticleEmitter;
  /** Signal-flare gun: pink tinted smoke loft. */
  signalFlareSmoke!: Phaser.GameObjects.Particles.ParticleEmitter;
  /** Signal-flare gun: fast red sparks. */
  signalFlareSpark!: Phaser.GameObjects.Particles.ParticleEmitter;
  muzzleBurst!: Phaser.GameObjects.Particles.ParticleEmitter;
  splashBurst!: Phaser.GameObjects.Particles.ParticleEmitter;
  explosionPuff!: Phaser.GameObjects.Particles.ParticleEmitter;
  ember!: Phaser.GameObjects.Particles.ParticleEmitter;
  shortTrailSmoke!: Phaser.GameObjects.Particles.ParticleEmitter;
  lingerSmoke!: Phaser.GameObjects.Particles.ParticleEmitter;
  /** Hydra / rocket plume — stretched along flight heading. */
  rocketSmoke!: Phaser.GameObjects.Particles.ParticleEmitter;
  heliDust!: Phaser.GameObjects.Particles.ParticleEmitter;
  craftExhaust!: Phaser.GameObjects.Particles.ParticleEmitter;
  craftExhaustMote!: Phaser.GameObjects.Particles.ParticleEmitter;
  craftExhaustSmoke!: Phaser.GameObjects.Particles.ParticleEmitter;
  /** Banked jet wingtip contrails — stretched pale smoke. */
  jetWingTrail!: Phaser.GameObjects.Particles.ParticleEmitter;
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
  exhaustVx = 0;
  exhaustVy = 0;
  exhaustAngle = 0;
  /** Screen-space heading for rocket smoke particle stretch. */
  shotTrailAngle = 0;
  exhaustTint = 0xffffff;
  exhaustSmokeTint = 0x8b8b86;
  exhaustScaleX = 1;
  exhaustScaleY = 0.4;
  exhaustLife = 260;
  /** Initial trail opacity baked at emit from thrustPower. */
  exhaustAlpha = 0.98;
  wingTrailAngle = 0;
  wingTrailVx = 0;
  wingTrailVy = 0;
  wingTrailScaleX = 1;
  wingTrailScaleY = 0.22;
  wingTrailLife = 900;
  wingTrailTint = 0xffffff;
  /** Camera-depth-banded clones: each band keeps fire>smoke without a global restack. */
  fxSlots = new Map<Phaser.GameObjects.Particles.ParticleEmitter, Phaser.GameObjects.Particles.ParticleEmitter[]>();
  fxPolicies: Record<FxClass, FxPolicy> = {
    short: { frameCap: 96, activeCap: 384, emitted: 0, emitters: new Set() },
    fire: { frameCap: 96, activeCap: 1400, emitted: 0, emitters: new Set() },
    smoke: { frameCap: 72, activeCap: 1024, emitted: 0, emitters: new Set() },
    dust: { frameCap: 96, activeCap: 512, emitted: 0, emitters: new Set() },
  };
  /** Saved blend/tintFill so thermal can force NORMAL + fill without losing defaults. */
  fxThermalSaved = new Map<
    Phaser.GameObjects.Particles.ParticleEmitter,
    { blendMode: Phaser.BlendModes | string; tintFill: boolean }
  >();
  /** Painter-depth bands so concurrent trails don't all share one emitter depth. */
  fxSlotN = 8;
  fxBandH = 48;
  /** Last applied sim timeScale (skip walking ~N emitters when unchanged). */
  lastSimScale = Number.NaN;
  /** Effective world rate this frame (debug scale × timewarp / bullet time / stinger / warp shots). */
  liveSimScale = 1;
  /** Scratch used only by synchronous onEmit callbacks; particles retain update state themselves. */
  burstLaunch = {
    x: 0, y: 0, z: 0, bx: 1, by: 0, bz: 0, tight: 0.5,
    spdMin: 40, spdMax: 120, scale: 1, stretchMul: 1, expBias: 0, gravity: 0,
    /** Half-angle (rad) for forward cone sampling; when set, speed scales with aim alignment. */
    coneHalf: 0,
  };
  muzzle!: Phaser.GameObjects.Image;
  muzzlePool: Phaser.GameObjects.Image[] = [];
  /** Soft ADD glow discs paired 1:1 with `muzzlePool` (tip-attached). */
  muzzleGlowPool: Phaser.GameObjects.Image[] = [];
  /** Per-pool life + attach so flashes stay glued to the barrel while alive. */
  muzzleFlashes: {
    life: number;
    /** Initial life — glow alpha fades over this. */
    life0: number;
    ang: number;
    /** Pre–z-scale size; multiplied by current tip screen scale each frame. */
    scaleMul: number;
    /** Pre–z-scale glow diameter. */
    glowMul: number;
    rotJitter: number;
    /** Socket that fired — drives above/below muzzle Z + depth. */
    slot?: number;
    muzzleUv?: { x: number; y: number };
    gunI?: number;
    /** Which muzzle UV on the gun texture (dual-rail turrets). */
    gunMuzzleI?: number;
    /** Firing point in map coordinates. */
    worldX?: number;
    worldY?: number;
    worldZ?: number;
    /** Painter offset at that point. Defaults to a belly muzzle. */
    depthOff?: number;
  }[] = [];
  muzzleCursor = 0;
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
  /** Last live heli pose — death cam rests at mid(this, hulk). */
  playerDeathLiveX = 0;
  playerDeathLiveY = 0;
  playerDeathLiveZ = 0;
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
  /** Live player crash hulk for camera follow. */
  playerCrashDebris?: Debris;
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
  /** One-shot flash stamps for a unit's non-primary tips on a simultaneous-fire volley (the unit's
   *  own pooled `flash` sprite in `syncUnitSprites` already covers the primary tip). */
  extraMuzzleFlashPool: Phaser.GameObjects.Image[] = [];
  extraMuzzleFlashes: { im: Phaser.GameObjects.Image; t: number; max: number }[] = [];
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
  private texTrailCache = new Map<string, number>();
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
    this.playerCrashDebris = undefined;
    this.endPromptRoot = undefined;
    this.postFx.reset();
    this.terrain25d = undefined;
    this.fxSlots.clear();
    this.fxThermalSaved.clear();
    this.hudSet.clear();
    this.lastSimScale = Number.NaN;
    for (const policy of Object.values(this.fxPolicies)) {
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
    this.extraMuzzleFlashes = [];
    this.terrainMesh = true;
    this.help.reset();
    this.exitOpen = false;
    this.debugMenu.reset();
    // Scene restart destroys pooled images — drop stale refs so they're rebuilt.
    this.remoteBody.reset();
    this.relief.reset();
    this.shots = [];
    this.energyLinger = [];
    this.debris = [];
    this.simParticles = [];
    this.lockOn.reset();
    this.thermalWreckMarks = [];
    for (const g of this.emberGlows) {
      g.image.destroy();
      g.bloom.destroy();
    }
    this.emberGlows = [];
    this.exhaustPrevWorld = [];
    this.exhaustMountCursor = 0;
    this.wingTrailPrevScreen = [];
    this.wingTrailEmitCarry = 0;
    this.wingTrailMountCursor = 0;
    this.playerCrashStarted = false;
    this.playerCrashLanded = false;
    this.playerCrashEndT = -1;
    this.playerCrashSimmerT = 0;
    this.playerCrashDebris = undefined;
    this.playerDeathLiveX = 0;
    this.playerDeathLiveY = 0;
    this.playerDeathLiveZ = 0;
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
    this.stampDecor();
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
    this.wreckLayer = this.add.renderTexture(0, 0, WRECK_TEX, WRECK_TEX);
    nameGameTexture(this, this.wreckLayer, "wreck_layer");
    registerArt("wreck_layer", "generated");
    this.wreckLayer.setOrigin(0, 0).setPosition(0, 0);
    this.wreckLayer.setDisplaySize(WORLD, WORLD).setDepth(Layer.WRECK);
    (this.wreckLayer.texture as Phaser.Textures.DynamicTexture).setIsSpriteTexture(false);
    this.wreckLayer.clear();
    if (this.game.renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer) {
      this.terrain25d = createTerrain25D(this, this.world, {
        terrain: "map_terrain",
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
    this.projectiles.shotG = this.add.group();
    this.projectiles.photonFxG = this.add.group();
    this.remoteBody.remoteG = this.add.group();
    this.debrisG = this.add.group();
    this.simParticleG = this.add.group();
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
    ensureImpactGlow(this.textures);
    this.muzzleGlowPool = [0, 1].map(() =>
      this.add
        .image(0, 0, "fx_glow")
        .setVisible(false)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setTint(0xfff2c8)
    );
    this.muzzleFlashes = [
      { life: 0, life0: 0.1, ang: 0, scaleMul: 1, glowMul: 56, rotJitter: 0 },
      { life: 0, life0: 0.1, ang: 0, scaleMul: 1, glowMul: 56, rotJitter: 0 },
    ];
    this.body.setPosition(this.player.x, this.player.y);
    this.reticleHud.create();
    this.lockOn.gfx = this.add.graphics().setDepth(Layer.FIELD).setVisible(false);
    this.towWireGfx = this.add.graphics().setDepth(Layer.WORLD);
    this.remoteBody.remoteAntennaGfx = this.add.graphics().setDepth(Layer.WORLD);
    this.tesla.gfx = this.add.graphics().setDepth(Layer.WORLD).setBlendMode(Phaser.BlendModes.ADD);
    this.energyTrailGfx = this.add.graphics().setDepth(Layer.WORLD).setBlendMode(Phaser.BlendModes.ADD);
    this.refractor.gfx = this.add.graphics().setDepth(Layer.WORLD).setBlendMode(Phaser.BlendModes.ADD);
    this.countermeasures.gfx = this.add.graphics().setDepth(Layer.WORLD).setBlendMode(Phaser.BlendModes.ADD);
    this.tesla.zapPool = [];
    for (let i = 0; i < 28; i++) {
      this.tesla.zapPool.push(
        this.add.image(0, 0, "fx_zap", 0).setVisible(false).setBlendMode(Phaser.BlendModes.ADD)
      );
    }
    this.extraMuzzleFlashPool = [];
    for (let i = 0; i < 6; i++) {
      this.extraMuzzleFlashPool.push(
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
      this.fxSlots.clear();
      this.fxThermalSaved.clear();
      this.hudSet.clear();
      for (const policy of Object.values(this.fxPolicies)) policy.emitters.clear();
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
    this.wreckLayer.saveTexture("map_wrecks");
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

  stampDecor(): void {
    const g = this.world.canvas.getContext("2d", { willReadFrequently: true })!;
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
    tint?: number,
    thermal = true
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
    const tex = this.textures.exists(heatKey) ? heatKey : key;
    const display = thermalWreckDisplayScale(scaleX, scaleY, kind);
    const timing = thermalWreckTiming(kind, display.scaleX, display.scaleY);
    const fade0 = Phaser.Math.Clamp(initialFade, 0.02, 1);
    const age =
      fade0 >= 1 ? 0 : timing.hold + (1 - fade0) * timing.fadeDur;
    const image = this.add
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
      z: groundZ(this.world, x, y) + 0.25,
      rotation,
      scaleX: display.scaleX,
      scaleY: display.scaleY,
      hold: timing.hold,
      fadeDur: timing.fadeDur,
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

  thermalWreckFade(mark: ThermalWreckMark): number {
    if (mark.age <= mark.hold) return 1;
    return Math.max(0, 1 - (mark.age - mark.hold) / mark.fadeDur);
  }

  syncThermalWreckMark(mark: ThermalWreckMark): void {
    const visible =
      this.thermalOn &&
      this.mapBlend < 0.12 &&
      cameraPointVisible(mark.z, mark.y);
    mark.image.setVisible(visible);
    if (!visible) return;
    const at = worldToScreen(mark.x, mark.y, mark.z);
    const fade = this.thermalWreckFade(mark);
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
      applyThermalHeat(mark.image, true, fade * (mark.kind === "shell" ? 0.72 : 0.55));
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
      const fade = this.thermalWreckFade(mark);
      if (fade <= 0) {
        mark.image.destroy();
        continue;
      }
      this.syncThermalWreckMark(mark);
      this.thermalWreckMarks[write++] = mark;
    }
    this.thermalWreckMarks.length = write;
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

  /**
   * Soft-cap crater stamp scale so 88px scorches don't go fuzzy on huge blasts.
   * Approaches `hard` asymptotically past `soft`.
   */
  softCapBlastCraterScale(raw: number, soft = 1.28, hard = 2.05, k = 1.7): number {
    if (!(raw > soft)) return Math.max(0.04, raw);
    return soft + (hard - soft) * (1 - Math.exp(-(raw - soft) / k));
  }

  /** Pick a standard blast crater tex + soft-capped stamp scale. */
  pickBlastCraterStamp(rawScale: number): { key: string; scale: number } {
    const scale = this.softCapBlastCraterScale(rawScale);
    const i = (Math.random() * FX_BLAST_CELLS) | 0;
    const key = `fx_blast_${i}`;
    return { key: this.textures.exists(key) ? key : "fx_blast_0", scale };
  }

  /** Stamp a blast crater using soft-capped scale (no large-tex swap). */
  stampBlastCrater(x: number, y: number, rawScale: number, alpha = 1): void {
    const pick = this.pickBlastCraterStamp(rawScale);
    this.stampWreck(pick.key, x, y, Math.random() * Math.PI * 2, pick.scale, alpha);
  }

  /**
   * Embers on mech/building kill craters and bomb/missile/rocket impacts only —
   * never debris, troops, or gun scars.
   */
  spawnCraterEmbers(x: number, y: number, scale: number): void {
    // Scatter individual baked particles — each crater gets a unique layout.
    const n = Math.max(4, Math.min(14, Math.round(5 + scale * 6 + range(-2, 3))));
    this.spawnEmberGlow(x, y, scale, {
      hold: range(0.35, 0.85),
      fade: range(1.1, 2.2),
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
      /** How many single ember particles to scatter (default 1 pattern stamp). */
      particles?: number;
    }
  ): void {
    if (isWater(this.world, x, y)) return;
    const particleKey = this.textures.exists("fx_ember_particle")
      ? "fx_ember_particle"
      : "fx_ember";
    if (!this.textures.exists(particleKey)) return;
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
    const frames = this.textures.get(sheet).frameTotal;
    const frame = frames > 1 ? (Math.random() * frames) | 0 : 0;
    const rot = Math.random() * Math.PI * 2;
    // Tight radial jitter around the crater center.
    const ang = Math.random() * Math.PI * 2;
    const dist = Math.pow(Math.random(), 0.65) * (6 + scale * 12);
    const ox = Math.cos(ang) * dist;
    const oy = Math.sin(ang) * dist;
    const softKey = `${sheet}_soft`;
    const bloomTex = this.textures.exists(softKey) ? softKey : sheet;
    const image = this.add
      .image(0, 0, sheet, frame)
      .setOrigin(0.5, 0.5)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setVisible(false);
    const bloom = this.add
      .image(0, 0, bloomTex, frame)
      .setOrigin(0.5, 0.5)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setVisible(false);
    const glow: EmberGlow = {
      image,
      bloom,
      x: x + ox,
      y: y + oy,
      z: groundZ(this.world, x, y) + 0.4,
      rotation: rot,
      scale: sc,
      bloomMul: range(1.45, 2.05),
      age: 0,
      hold: hold ?? range(0.3, 0.75),
      fadeDur: fade ?? range(1.0, 2.0),
      flickerPhase: Math.random() * Math.PI * 2,
      flickerRate: range(11, 22),
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

  emberGlowFade(g: EmberGlow): number {
    if (g.age <= g.hold) return 1;
    return Math.max(0, 1 - (g.age - g.hold) / g.fadeDur);
  }

  syncEmberGlow(g: EmberGlow): void {
    if (!cameraPointVisible(g.z, g.y) || this.mapBlend > 0.5) {
      g.image.setVisible(false);
      g.bloom.setVisible(false);
      return;
    }
    const base = this.emberGlowFade(g);
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
    const thermal = this.thermalOn;
    const crispA = base * sputter * (thermal ? 0.5 : 0.98);
    const bloomA = base * sputter * (thermal ? 0.28 : 0.58);
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
      applyThermalHeat(g.image, true, 0.85 * base);
      applyThermalHeat(g.bloom, true, 0.55 * base);
    } else {
      g.image.setBlendMode(Phaser.BlendModes.ADD);
      g.bloom.setBlendMode(Phaser.BlendModes.ADD);
      applyThermalHeat(g.image, false, 0);
      applyThermalHeat(g.bloom, false, 0);
    }
  }

  updateEmberGlows(dt: number): void {
    let w = 0;
    for (const g of this.emberGlows) {
      if (!g.image.scene) continue;
      g.age += dt;
      if (this.emberGlowFade(g) <= 0) {
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
    if (isWater(this.world, x, y)) return;
    const key = `fx_blast_${(Math.random() * 4) | 0}`;
    const scarKey = this.textures.exists(key) ? key : "fx_blast_0";
    if (!this.textures.exists(scarKey)) return;
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
    const g = this.world.canvas.getContext("2d", { willReadFrequently: true })!;
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
    if (isWater(this.world, x, y)) return;
    // Skip often so the trail reads as broken / inconsistent.
    if (Math.random() < 0.38) return;
    const key = this.textures.exists("fx_track_mono")
      ? "fx_track_mono"
      : this.textures.exists("fx_track_tire")
        ? "fx_track_tire"
        : "fx_track_mono";
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
    for (const policy of Object.values(this.fxPolicies)) policy.emitted = 0;
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
        this.updateDebris(endDt);
        this.updateSimParticles(endDt);
        this.countermeasures.updateSmokePuffs(endDt);
        this.emitHeliCrashDmgFlames();
        this.reticleHud.hideAimChrome();
      }
      this.minimap.draw();
      this.statusHud.draw();
      this.towWireGfx.clear();
      this.remoteBody.remoteAntennaGfx?.clear();
      this.tesla.gfx.clear();
      this.tesla.hideVisuals();
      this.energyTrailGfx.clear();
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
        this.tickPlayerMuzzles(dt);
        this.countermeasures.updateSmokePuffs(dt);
        this.remoteFleet.updateRemotes(dt);
        this.countermeasures.updateFlares(dt);
        this.tesla.tickZaps(dt);
        this.tickExtraMuzzleFlashes(dt);
      });
      stage(3, 4, () => this.unitSim.updateUnits(dt));
      stage(5, 6, () => this.projectiles.updateShots(dt));
      if (this.player.phase === "dead" && !this.playerCrashStarted) this.beginPlayerCrash();
      stage(7, 8, () => this.updateDebris(dt));
      stage(9, 10, () => this.updateSimParticles(dt));
      stage(11, undefined, () => {
        this.lockOn.update();
        this.drawUnitBars();
        this.threatHud.drawArcs();
        this.emitDamageFx();
        this.emitHeliCrashDmgFlames();
        this.overlays.drawHits();
        if (this.sideView.on) this.sideView.draw();
      });
    }
    this.updateThermalWreckMarks(dt);
    this.updateEmberGlows(dt);
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
      this.towWireGfx.clear();
      this.remoteBody.remoteAntennaGfx?.clear();
      this.tesla.gfx.clear();
      this.tesla.hideVisuals();
      this.energyTrailGfx.clear();
      this.refractor.gfx.clear();
      this.countermeasures.gfx.clear();
    } else {
      this.mapGfx.clear();
      this.hideMapHvLabels();
      this.drawHud();
      this.minimap.draw();
      this.drawHvArrows();
      this.statusHud.draw();
      this.drawTowWires();
      this.remoteBody.drawRemoteAntennas();
      this.drawEnergyTrails();
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
      if (!this.playerCrashStarted) this.beginPlayerCrash();
      else if (this.playerCrashLanded && this.playerCrashEndT < 0) {
        this.playerCrashSimmerT -= wallDt;
        if (this.playerCrashSimmerT <= 0) this.playerCrashEndT = 0.55;
      } else if (this.playerCrashLanded && this.playerCrashEndT >= 0) {
        this.playerCrashEndT -= wallDt;
        if (this.playerCrashEndT <= 0) this.end(false);
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
      for (const muzzle of this.muzzlePool) muzzle.setVisible(false);
      for (const glow of this.muzzleGlowPool) glow.setVisible(false);
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
    this.muzzle.setDepth(worldDepth(h.z, ZOff.muzzle, h.y));
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
    this.exhaustAngle = jetAng;
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
    this.exhaustTint = profile.tint;
    this.exhaustSmokeTint = profile.smoke;
    // Thrust drives trail opacity and thickness at emit.
    this.exhaustAlpha = 0.22 + power * 0.76;
    this.exhaustScaleY = profile.sy * (0.34 + power * 0.52);
    this.exhaustLife = profile.life;

    const glow = this.fxAt(h.z, h.y, this.craftExhaust, ZOff.exhaust + 0.04);
    const mote = this.fxAt(h.z, h.y, this.craftExhaustMote, ZOff.exhaust + 0.08);
    const smoke = this.fxAt(h.z, h.y, this.craftExhaustSmoke, ZOff.exhaust - 0.35);
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
      this.exhaustScaleX = baseScaleX;
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
          this.exhaustScaleX = Math.max(baseScaleX * 0.28, (span / frameWidth) * stretch);
          prevScreenX = previousAt.x;
          prevScreenY = previousAt.y;
        }
      }
      this.exhaustPrevWorld[mountI] = current;

      // Keep the nozzle-side edge of the scaled sprite at/aft of the tip (no body backspill).
      const halfLen = frameWidth * this.exhaustScaleX * 0.5;
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
      this.exhaustAngle = connectionAngle;
      const motionAngle = connectionAngle + range(-0.045, 0.045);
      const motionSpeed = jetSpeed * range(0.94, 1.06);
      this.exhaustVx = Math.cos(motionAngle) * motionSpeed;
      this.exhaustVy = Math.sin(motionAngle) * motionSpeed;
      // Dense ribbon for every craft with an exhaust profile (jets + Cyberhawk/Prometheus).
      const nGlow = Math.max(1, this.fxEmitCount(ribbonDense ? 2.2 : 1.7));
      if (nGlow) this.emitBudgeted("fire", glow, emitX, emitY, nGlow);
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
          this.emitBudgeted("fire", glow, fx, fy, 1);
        }
      }
      const nMote = this.fxEmitCount(ribbonDense ? 0.28 + power * 0.18 : 0.4 + power * 0.22);
      if (nMote) {
        this.emitBudgeted(
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
      const nSmoke = this.fxEmitCount(0.9);
      if (nSmoke) this.emitBudgeted("smoke", smoke, smokeX, smokeY, nSmoke);
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
    this.wingTrailTint = 0xffffff;
    this.wingTrailLife = 700 + bankT * 1100;
    this.wingTrailScaleY = (0.12 + bankT * 0.22) * (0.85 + Math.random() * 0.2);

    const trail = this.fxAt(opts.z, opts.y, this.jetWingTrail, ZOff.exhaust - 0.5);
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
      this.wingTrailScaleX = baseSx;

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
          this.wingTrailScaleX = Math.max(baseSx * 0.35, (span / frameWidth) * 1.45);
        }
      }
      state.prevScreen[tipI] = { x: currentX, y: currentY };

      this.wingTrailAngle = connectionAngle;
      this.wingTrailVx = Math.cos(connectionAngle) * drift * range(0.9, 1.1);
      this.wingTrailVy = Math.sin(connectionAngle) * drift * range(0.9, 1.1);
      const n = Math.max(1, this.fxEmitCount(0.9 + bankT * 0.8));
      this.emitBudgeted("smoke", trail, emitX, emitY, n);
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
































  /** Thick dense long needles for big boom blasts — fly out, coast, arc down, shrink as they slow. */
  emitBigBoomSparks(
    x: number,
    y: number,
    z: number,
    size01: number,
    dx: number,
    dy: number,
    dz: number
  ): void {
    const len = Math.max(1e-3, Math.hypot(dx, dy, dz));
    const ix = dx / len;
    const iy = dy / len;
    let bx = ix * 0.55;
    let by = -0.82 + iy * 0.35;
    let bz = 0.22 + Math.max(0, dz / len) * 0.28;
    const nLen = Math.max(1e-3, Math.hypot(bx, by, bz));
    bx /= nLen;
    by /= nLen;
    bz /= nLen;
    const s01 = Phaser.Math.Clamp(size01, 0.2, 1);
    const n = Math.round(Phaser.Math.Linear(34, 58, s01));
    this.emitVisualBurst(
      x,
      y,
      z,
      {
        n,
        spdMin: Phaser.Math.Linear(220, 320, s01),
        spdMax: Phaser.Math.Linear(860, 1200, s01),
        bx,
        by,
        bz,
        tight: 0,
        scaleMul: Phaser.Math.Linear(1.05, 1.65, s01),
        stretchMul: Phaser.Math.Linear(1.5, 2.1, s01),
        coneHalf: Phaser.Math.Linear(1.05, 1.25, s01),
        // Above dirt streaks; boomBits draw higher still.
        depthOff: ZOff.fire + 0.55,
      },
      this.bigBoomSparkBurst
    );
  }

  /**
   * Companion to big-boom sparks: dirt streaks + small mech bits with Hydra-style smoke.
   * Same scatter family, slightly less loft / more impact bias / slower / heavier fall.
   */
  emitBigBoomDebris(
    x: number,
    y: number,
    z: number,
    size01: number,
    dx: number,
    dy: number,
    dz: number
  ): void {
    const len = Math.max(1e-3, Math.hypot(dx, dy, dz));
    const ix = dx / len;
    const iy = dy / len;
    // Vs sparks: more impact-dir weight, less upward loft.
    let bx = ix * 0.72;
    let by = -0.68 + iy * 0.38;
    let bz = 0.16 + Math.max(0, dz / len) * 0.22;
    const nLen = Math.max(1e-3, Math.hypot(bx, by, bz));
    bx /= nLen;
    by /= nLen;
    bz /= nLen;
    const s01 = Phaser.Math.Clamp(size01, 0.2, 1);
    const coneHalf = Phaser.Math.Linear(1.0, 1.2, s01);
    const dirtN = Math.round(Phaser.Math.Linear(22, 40, s01));
    this.emitVisualBurst(
      x,
      y,
      z,
      {
        n: dirtN,
        spdMin: Phaser.Math.Linear(160, 240, s01),
        spdMax: Phaser.Math.Linear(620, 920, s01),
        bx,
        by,
        bz,
        tight: 0,
        scaleMul: Phaser.Math.Linear(0.95, 1.45, s01),
        stretchMul: Phaser.Math.Linear(1.35, 1.9, s01),
        coneHalf,
        // Back of the boom stack — under fire / sparks / mech bits.
        depthOff: ZOff.smoke - 0.15,
      },
      this.bigBoomDirtBurst,
      "dust"
    );

    const bitN = Math.round(Phaser.Math.Linear(36, 68, s01));
    const mechKeys = Array.from({ length: 12 }, (_, i) => `fx_debris_mech_${i}`);
    for (let i = 0; i < bitN; i++) {
      const key = this.textures.exists(mechKeys[i % mechKeys.length]!)
        ? mechKeys[i % mechKeys.length]!
        : this.textures.exists("fx_debris_metal")
          ? "fx_debris_metal"
          : null;
      if (!key) continue;
      const d = coneDir(bx, by, bz, coneHalf, 6.5);
      const cosMin = Math.cos(coneHalf);
      const kSpeed = 11;
      const t =
        (Math.exp(kSpeed * d.align) - Math.exp(kSpeed * cosMin)) /
        Math.max(1e-4, Math.exp(kSpeed) - Math.exp(kSpeed * cosMin));
      const spd =
        Phaser.Math.Linear(
          Phaser.Math.Linear(140, 200, s01),
          Phaser.Math.Linear(480, 720, s01),
          Phaser.Math.Clamp(t, 0, 1)
        ) * range(0.88, 1.08);
      const scale = range(0.14, 0.26) * Phaser.Math.Linear(0.95, 1.2, s01);
      // Strong loft so flecks arc in XY before ground contact.
      const loft = range(160, 340) * Phaser.Math.Linear(0.9, 1.2, s01);
      this.admitDebris({
        x: x + range(-6, 6),
        y: y + range(-6, 6),
        z: z + range(16, 42),
        vx: d.x * spd,
        vy: d.y * spd,
        vz: Math.max(0, d.z) * spd * 2.0 + loft,
        angle: Math.atan2(d.y, d.x) + range(-0.6, 0.6),
        spin: range(-8, 8),
        life: 2.5,
        key,
        settled: false,
        gravity: true,
        bounces: 0,
        trailR: this.texTrailR(key) * scale * 0.45,
        scale,
        boomBit: true,
        debrisClass: "ephemeral",
      });
    }
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








































  /** Track print darkness: soft/hard ground patches by world position, plus per-print jitter. */
  trackPrintAlpha(base: number, x: number, y: number): number {
    const patch = 0.5 + 0.5 * Math.sin(x * 0.011 + y * 0.017) * Math.sin(x * 0.023 - y * 0.013 + 1.3);
    // Only lightens: the darkest print matches the old uniform `base`.
    return Phaser.Math.Clamp(base * Phaser.Math.Linear(0.25, 1, patch) * range(0.65, 1), 0.06, base);
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

    this.withTrailFx(0.9, () => {
      const rgb = profile.smoke;
      const pale = ((rgb >> 16) & 0xff) + ((rgb >> 8) & 0xff) + (rgb & 0xff) > 0x2a0;
      if (pale) {
        this.wingTrailTint = profile.smoke;
        this.wingTrailLife = profile.life * (0.7 + power * 0.45);
        this.wingTrailScaleX = profile.sx * (0.85 + power * 0.35);
        this.wingTrailScaleY = profile.sy * (0.85 + power * 0.3);
        this.wingTrailAngle = jetAng;
        this.wingTrailVx = backX + range(-4, 4);
        this.wingTrailVy = backY + range(-4, 4);
        const trail = this.fxAt(r.z, r.y, this.jetWingTrail, ZOff.exhaust - 0.35);
        trail.setDepth(bodyDepth - 1.15);
        for (const mount of mounts) {
          const at = spriteUvPos(pose, mount.x, mount.y);
          this.emitBudgeted("smoke", trail, at.x, at.y, n);
        }
      } else {
        this.exhaustSmokeTint = profile.smoke;
        this.exhaustScaleY = profile.sy * (0.75 + power * 0.45);
        this.exhaustAlpha = 0.22 + power * 0.38;
        this.exhaustVx = backX * 1.2 + range(-6, 6);
        this.exhaustVy = backY * 1.2 + range(-6, 6);
        this.exhaustAngle = jetAng;
        const smoke = this.fxAt(r.z, r.y, this.craftExhaustSmoke, ZOff.smoke - 0.2);
        smoke.setDepth(bodyDepth - 1.1);
        for (const mount of mounts) {
          const at = spriteUvPos(pose, mount.x, mount.y);
          this.emitBudgeted("smoke", smoke, at.x, at.y, n);
        }
      }
    });
  }




































  /** Rail discharge at the barrel: Tesla tip bloom, zap, and spark spit. No orange gun flash. */
  emitRailMuzzle(x: number, y: number, z: number, dx: number, dy: number, dz: number): void {
    const len = Math.max(1e-3, Math.hypot(dx, dy, dz));
    this.tesla.emitSparks(x, y, z, 10, 0.85);
    this.emitVisualBurst(
      x,
      y,
      z,
      {
        n: 12,
        spdMin: 90,
        spdMax: 280,
        bx: dx / len,
        by: dy / len,
        bz: dz / len,
        tight: 0.8,
        scaleMul: 0.7,
        stretchMul: 1.75,
        coneHalf: 0.42,
      },
      this.teslaSparkBurst
    );
    this.tesla.spawnZap(x, y, z, 1.05, 1.15);
    this.tesla.spawnZap(x, y, z, 0.7, 0.9);
    const at = worldToScreen(x, y, z);
    this.spawnImpactFlash(at.x, at.y, z, 0x88f4ff, 72 * at.scale, 0.78, 160);
    this.spawnImpactFlash(at.x, at.y, z, 0xf4ffff, 28 * at.scale, 0.95, 100);
  }


  /** Photon / warp detonation extras — Tesla zaps + blooms + large additive light flash. */
  emitPhotonImpactSparks(
    x: number,
    y: number,
    z: number,
    dx: number,
    dy: number,
    dz: number,
    blast = 155
  ): void {
    const len = Math.max(1e-3, Math.hypot(dx, dy, dz));
    const bx = dx / len;
    const by = dy / len;
    const bz = dz / len;
    const at = worldToScreen(x, y, z);
    for (let i = 0; i < 18; i++) {
      const d = coneDir(bx, by, bz + 0.25, 0.85, 16);
      const r = 36 + Math.random() * 160;
      this.tesla.spawnZap(
        x + d.x * r,
        y + d.y * r,
        z + d.z * r * 0.4 + range(-10, 28),
        range(0.7, 1.45),
        range(1.2, 2.2)
      );
    }
    this.spawnImpactFlash(at.x, at.y, z, 0xc8f0ff, 70 * at.scale, 0.9, 220);
    this.spawnImpactFlash(at.x, at.y, z, 0xe080ff, 42 * at.scale, 0.75, 160);
    this.spawnPhotonBlastFlash(at.x, at.y, z, at.scale);
    this.projectiles.spawnBlastRing(x, y, z, Math.max(48, blast * 0.38), {
      tint: 0xe8c0ff,
      alpha: 0.72,
      duration: 320,
      expand: 2.4,
    });
    this.shake = Math.min(9, this.shake + 2.8);
  }

  /** Big additive light overlay for photonic detonations (Photon + Warp). */
  spawnPhotonBlastFlash(x: number, y: number, z: number, viewScale: number): void {
    const key = this.textures.exists("shot_photon_glow")
      ? "shot_photon_glow"
      : this.textures.exists("fx_tesla_glow")
        ? "fx_tesla_glow"
        : "fx_glow";
    if (key === "fx_glow" && !this.textures.exists("fx_glow")) ensureImpactGlow(this.textures);
    const world = screenToWorldAtZ(x, y, z);
    const size0 = 420 * viewScale;
    const size1 = 640 * viewScale;
    const glow = this.add
      .image(x, y, key)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(0xf4e8ff)
      .setDisplaySize(size0, size0)
      .setAlpha(0.95)
      .setDepth(worldDepth(z, ZOff.fire + 6, world.y));
    this.tweens.add({
      targets: glow,
      alpha: 0,
      displayWidth: size1,
      displayHeight: size1,
      duration: 420,
      ease: "Cubic.Out",
      onComplete: () => glow.destroy(),
    });
  }



  /** One-shot flash for a simultaneous-fire tip other than the unit's primary (pooled) muzzle sprite. */
  spawnExtraMuzzleFlash(x: number, y: number, z: number, ang: number, scale: number): void {
    let im = this.extraMuzzleFlashPool.find((spr) => !spr.visible);
    if (!im) {
      im = this.add.image(0, 0, "fx_muzzle", 0).setVisible(false).setBlendMode(Phaser.BlendModes.ADD);
      this.extraMuzzleFlashPool.push(im);
    }
    const scr = worldToScreen(x, y, z);
    const frame = (Math.random() * FX_VARIANTS) | 0;
    const jitR = (Math.random() - 0.5) * 0.2;
    const jitS = range(0.9, 1.12);
    const life = 0.07;
    im.setTexture("fx_muzzle", frame)
      .setVisible(true)
      .setOrigin(0.15, 0.5)
      .setPosition(scr.x, scr.y)
      .setRotation(ang + jitR)
      .setScale(scale * scr.scale * jitS)
      .setAlpha(1)
      .setDepth(worldDepth(z, ZOff.muzzle + 0.4, y));
    this.extraMuzzleFlashes.push({ im, t: life, max: life });
  }

  tickExtraMuzzleFlashes(dt: number): void {
    let w = 0;
    for (let i = 0; i < this.extraMuzzleFlashes.length; i++) {
      const f = this.extraMuzzleFlashes[i]!;
      f.t -= dt;
      if (f.t <= 0) {
        f.im.setVisible(false);
        continue;
      }
      f.im.setAlpha(Phaser.Math.Clamp(f.t / f.max, 0, 1));
      this.extraMuzzleFlashes[w++] = f;
    }
    this.extraMuzzleFlashes.length = w;
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



  /** Muzzle flash at the firing point passed in. Redrawn until `life` runs out. */
  showMuzzle(opt: {
    life: number;
    ang: number;
    scaleMul: number;
    /** Soft bloom diameter; defaults to max(48, scaleMul×72). */
    glowMul?: number;
    slot?: number;
    muzzleUv?: { x: number; y: number };
    gunI?: number;
    gunMuzzleI?: number;
    worldX?: number;
    worldY?: number;
    worldZ?: number;
    depthOff?: number;
  }): void {
    let index = this.muzzleFlashes.findIndex((f) => f.life <= 0);
    if (index < 0) index = this.muzzleCursor++ % this.muzzlePool.length;
    const flash = this.muzzleFlashes[index]!;
    flash.life = opt.life;
    flash.life0 = opt.life;
    flash.ang = opt.ang;
    flash.scaleMul = opt.scaleMul;
    // Soft bloom larger than the flash sprite so it reads as light, not a speck.
    flash.glowMul = opt.glowMul ?? Math.max(48, opt.scaleMul * 72);
    flash.rotJitter = range(-0.1, 0.1);
    flash.slot = opt.slot;
    flash.muzzleUv = opt.muzzleUv;
    flash.gunI = opt.gunI;
    flash.gunMuzzleI = opt.gunMuzzleI;
    flash.worldX = opt.worldX;
    flash.worldY = opt.worldY;
    flash.worldZ = opt.worldZ;
    flash.depthOff = opt.depthOff;
    const muzzle = this.muzzlePool[index] ?? this.muzzle;
    muzzle.setFrame((Math.random() * FX_VARIANTS) | 0);
    this.syncMuzzleFlash(index);
  }

  /** Socket owning a live muzzle flash (above/below Z + depth). */
  muzzleFlashSlot(flash: (typeof this.muzzleFlashes)[number]): number {
    if (flash.slot != null) return flash.slot;
    if (flash.gunI != null) {
      return craftGunSocketSlots(this.player.spec)[flash.gunI] ?? this.player.weapon;
    }
    return this.player.weapon;
  }

  /** World tip for a live muzzle flash slot. */
  muzzleFlashTip(flash: (typeof this.muzzleFlashes)[number]): { x: number; y: number; z: number } {
    if (flash.worldX != null && flash.worldY != null) {
      return {
        x: flash.worldX,
        y: flash.worldY,
        z: flash.worldZ ?? this.player.z + ZOff.shot,
      };
    }
    const h = this.player;
    const slot = this.muzzleFlashSlot(flash);
    const z = this.fireControl.playerMuzzleZ(slot, flash.gunMuzzleI ?? 0);
    if (flash.muzzleUv) {
      const at = this.craftBodyMountWorldPos(flash.muzzleUv);
      return { x: at.x, y: at.y, z };
    }
    if (flash.gunI != null) {
      const at = this.gunTip(flash.gunI, flash.gunMuzzleI ?? 0);
      return { x: at.x, y: at.y, z };
    }
    return { x: h.x, y: h.y, z };
  }

  syncMuzzleFlash(index: number): void {
    const flash = this.muzzleFlashes[index];
    const muzzle = this.muzzlePool[index];
    const glow = this.muzzleGlowPool[index];
    if (!flash || !muzzle || flash.life <= 0) return;
    const tip = this.muzzleFlashTip(flash);
    const depthOff =
      flash.depthOff ??
      (flash.worldX != null
        ? ZOff.muzzle + 0.15
        : this.fireControl.playerMuzzleDepthOff(this.muzzleFlashSlot(flash), flash.gunMuzzleI ?? 0));
    const depth = worldDepth(tip.z, depthOff, tip.y);
    const at = worldToScreen(tip.x, tip.y, tip.z);
    const fade = flash.life0 > 1e-4 ? Phaser.Math.Clamp(flash.life / flash.life0, 0, 1) : 0;
    muzzle
      .setVisible(true)
      .setOrigin(0.14, 0.5)
      .setPosition(at.x, at.y)
      .setRotation(projectHeading(flash.ang, tip.x, tip.y, tip.z) + flash.rotJitter)
      .setScale(flash.scaleMul * at.scale)
      .setAlpha(fade)
      .setDepth(depth);
    if (this.thermalOn) {
      muzzle.setBlendMode(Phaser.BlendModes.NORMAL);
      applyThermalHeat(muzzle, true, 0.96 * fade);
    } else {
      muzzle.setBlendMode(Phaser.BlendModes.ADD);
      applyThermalHeat(muzzle, false, 0, 0xfff6d0);
    }
    if (glow) {
      const gSize = flash.glowMul * at.scale;
      glow
        .setVisible(true)
        .setPosition(at.x, at.y)
        .setDisplaySize(gSize, gSize)
        .setAlpha(0.75 * fade)
        .setDepth(depth + 0.05);
      if (this.thermalOn) {
        glow.setBlendMode(Phaser.BlendModes.NORMAL);
        applyThermalHeat(glow, true, 0.92 * fade);
      } else {
        glow.setBlendMode(Phaser.BlendModes.ADD);
        applyThermalHeat(glow, false, 0, 0xfff2c8);
      }
    }
  }

  tickPlayerMuzzles(dt: number): void {
    for (let i = 0; i < this.muzzleFlashes.length; i++) {
      const flash = this.muzzleFlashes[i]!;
      if (flash.life <= 0) continue;
      flash.life -= dt;
      if (flash.life <= 0) {
        this.muzzlePool[i]?.setVisible(false);
        this.muzzleGlowPool[i]?.setVisible(false);
        continue;
      }
      this.syncMuzzleFlash(i);
    }
  }

  /** Soft additive light bloom (enemy / one-shot); player uses tip-attached glow pool. */
  spawnMuzzleLight(x: number, y: number, z: number, size: number): void {
    this.spawnImpactFlash(x, y, z, 0xfff2c8, Math.max(36, size * 1.35), 0.75, 120);
  }

  /** Spent casing size from caliber (designation mm), else projectile scale, else dmg. */
  shellGirth(opts: { designation?: string; scale?: number; dmg?: number }): number {
    const mm = opts.designation ? caliberMmFromDesignation(opts.designation) : undefined;
    if (mm != null) {
      return Phaser.Math.Clamp(0.2 + Math.pow(mm / 7.62, 0.55) * 0.26, 0.28, 1.2);
    }
    if (opts.scale != null) {
      return Phaser.Math.Clamp(0.26 + opts.scale * 0.5, 0.28, 1.15);
    }
    return Phaser.Math.Clamp(0.3 + Math.sqrt(Math.max(0.25, opts.dmg ?? 4)) * 0.125, 0.3, 0.85);
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
      if (ephemeral >= 64) {
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
    designation?: string;
    scale?: number;
    dmg?: number;
    /** +1 barrel-right / −1 barrel-left (from midline). Required for consistent eject. */
    side: number;
    /** Air craft: spawn/draw under hull. Ground: spawn/draw above. */
    aerial?: boolean;
    /** Weapon fire interval (s). Lower = faster = slightly harder eject. */
    fireCd?: number;
  }): void {
    const girth = this.shellGirth(opts);
    if (girth <= 0) return;
    const side = opts.side >= 0 ? 1 : -1;
    const ejectAng = opts.barrelAng + side * (Math.PI / 2) + range(-0.28, 0.28);
    // Subtle cadence bias: chain (~0.07s) punches harder than slow AA (~2–3s).
    const cd = Phaser.Math.Clamp(opts.fireCd ?? 0.45, 0.05, 3.2);
    const rateMul = Phaser.Math.Linear(1.2, 0.82, Phaser.Math.Clamp((cd - 0.06) / 1.6, 0, 1));
    const girthMul = Phaser.Math.Linear(1.05, 0.78, Phaser.Math.Clamp((girth - 0.28) / 0.72, 0, 1));
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
      shellHeat: 1,
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
    if (!this.textures.exists("fx_glow")) ensureImpactGlow(this.textures);
    const world = screenToWorldAtZ(x, y, z);
    const glow = this.add
      .image(x, y, "fx_glow")
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(tint)
      .setDisplaySize(size, size)
      .setAlpha(alpha)
      // Sit clearly above blast flame particles so the soft disc isn't buried.
      .setDepth(worldDepth(z, ZOff.fire + 5, world.y));
    this.tweens.add({
      targets: glow,
      alpha: 0,
      duration,
      ease: "Quad.Out",
      onComplete: () => glow.destroy(),
    });
  }

  /**
   * Additive cel fireball (toon blast sheet): hot core → rolling smoke.
   * Buildings get a taller scale; vehicles sit smaller.
   */
  spawnToonBlast(
    x: number,
    y: number,
    z: number,
    opts?: { building?: boolean; size01?: number; waveMul?: number }
  ): void {
    ensureAllArtGenAnims(this.anims, this.textures);
    const variant = (Math.random() * TOON_BLAST_VARIANTS) | 0;
    const tex = toonBlastKey(variant);
    if (!this.textures.exists(tex)) return;
    const anim = toonBlastAnimKey(variant);
    if (!this.anims.exists(anim)) return;
    const at = worldToScreen(x, y, z);
    const size01 = Phaser.Math.Clamp(opts?.size01 ?? 0.55, 0.16, 1);
    const building = !!opts?.building;
    // Native sheet ~192px; screen scale folds in perspective (`at.scale`).
    const base = building
      ? Phaser.Math.Linear(1.55, 2.45, size01)
      : Phaser.Math.Linear(0.85, 1.45, size01);
    const sc = base * (opts?.waveMul ?? 1) * at.scale * range(0.92, 1.08);
    const spr = this.add
      .sprite(at.x, at.y - (building ? 18 : 8) * at.scale, tex, 0)
      .setOrigin(0.5, 0.62)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setScale(sc)
      .setAlpha(building ? 0.95 : 0.88)
      .setDepth(worldDepth(z, ZOff.fire + 3.5, y));
    const kill = () => {
      if (spr.active) spr.destroy();
    };
    spr.once(Phaser.Animations.Events.ANIMATION_COMPLETE, kill);
    spr.play(anim);
    // Fallback if the anim is removed/recreated mid-play (e.g. art-gen rebake).
    const animData = this.anims.get(anim);
    const ms = animData
      ? (animData.frames.length / Math.max(1, animData.frameRate)) * 1000 + 120
      : 1400;
    this.time.delayedCall(ms, kill);
  }







  sampleBurstScreenVelocity(p?: BurstParticle): { x: number; y: number } {
    const opt = this.burstLaunch;
    let dx: number;
    let dy: number;
    let dz: number;
    let speed: number;
    if (opt.coneHalf > 0) {
      const d = coneDir(opt.bx, opt.by, opt.bz, opt.coneHalf, 6.5);
      // Speed falloff is steeper than density: wide/back sparks barely crawl, heading sparks bolt.
      const cosMin = Math.cos(opt.coneHalf);
      const kSpeed = 11;
      const t = (Math.exp(kSpeed * d.align) - Math.exp(kSpeed * cosMin))
        / Math.max(1e-4, Math.exp(kSpeed) - Math.exp(kSpeed * cosMin));
      const band = Math.max(0, opt.spdMax - opt.spdMin) * 0.06;
      speed = Phaser.Math.Linear(opt.spdMin, opt.spdMax, Phaser.Math.Clamp(t, 0, 1))
        + range(-band, band);
      dx = d.x;
      dy = d.y;
      dz = d.z;
    } else {
      const d = opt.expBias > 0
        ? expBiasDir(opt.bx, opt.by, opt.bz, opt.expBias)
        : biasedDir(opt.bx, opt.by, opt.bz, opt.tight, false);
      const align = (d as { align?: number }).align ?? 1;
      const speedBias = opt.expBias > 0
        ? Math.exp(opt.expBias * 0.55 * align) / Math.exp(opt.expBias * 0.55)
        : 1;
      speed = range(opt.spdMin, opt.spdMax) * speedBias;
      dx = d.x;
      dy = d.y;
      dz = d.z;
    }
    const vx = dx * speed;
    const vy = dy * speed;
    const vz = dz * speed;
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
      stretchMul?: number;
      expBias?: number;
      gravity?: number;
      /** Half-angle (rad). When set, samples a forward-biased cone; speed rises toward the aim axis. */
      coneHalf?: number;
      /** Painter offset via worldDepth (gun < muzzle < body). Defaults to fire banding. */
      depthOff?: number;
    },
    emitter: Phaser.GameObjects.Particles.ParticleEmitter,
    kind: FxClass = "short"
  ): void {
    Object.assign(this.burstLaunch, {
      x, y, z, bx: opt.bx, by: opt.by, bz: opt.bz, tight: opt.tight,
      spdMin: opt.spdMin, spdMax: opt.spdMax, scale: opt.scaleMul ?? 1,
      stretchMul: opt.stretchMul ?? 1,
      expBias: opt.expBias ?? 0, gravity: opt.gravity ?? 0,
      coneHalf: opt.coneHalf ?? 0,
    });
    const at = worldToScreen(x, y, z);
    // Muzzle cones must share hull painter space (between gun and body), not fire FX bands.
    const em =
      emitter === this.muzzleBurst || opt.depthOff != null
        ? this.fxAtWorld(z, y, emitter, opt.depthOff ?? ZOff.muzzle)
        : this.fxAt(z, y, emitter, ZOff.fire + 0.4);
    this.emitBudgeted(kind, em, at.x, at.y, opt.n, kind === "fire");
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
    if (bloodDirty && this.textures.exists("map_terrain")) {
      (this.textures.get("map_terrain") as Phaser.Textures.CanvasTexture).refresh();
    }
    if (this.perf.enabled) {
      const t = performance.now();
      this.syncSimParticleSprites();
      this.perf.current![10] = performance.now() - t;
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
      const orb = !!s.orb;
      const grow = 1 - Math.pow(1 - age, 3.4);
      const edge =
        dart && s.ox != null && s.oy != null
          ? Phaser.Math.Clamp((Math.hypot(s.x - s.ox, s.y - s.oy) - 40) / 110, 0, 1)
          : 0;
      const round = dart ? Math.max(edge, Phaser.Math.Clamp(1 - spd / 220, 0, 1)) : 0;
      const stretch = orb
        ? 1
        : shock
          ? Math.min(3.2, 1 + spd * 0.0032)
          : 1 + spd * (dart ? 0.0052 : 0.0048);
      const thick = orb
        ? s.scale * (0.85 + 0.35 * fade)
        : shock
        ? s.scale * (1.05 + 0.95 * age)
        : dart
        ? s.scale * (0.78 + 0.28 * fade + 0.72 * round)
        : s.scale * (0.06 + 3.6 * grow);
      const scrX = screenVelX(s.vx, s.vy, s.vz, s.x, s.y, s.z);
      const scrY = screenVelY(s.vy, s.vz, s.z, s.y);
      const heading = Math.atan2(scrY, scrX);
      const rot = orb
        ? s.heading + age * s.spin
        : shock
        ? s.heading
        : dart
        ? heading + s.angJit * 0.08 + age * s.spin * (0.22 + round * 1.05)
        : s.heading + s.angJit * 0.14;
      const sx = orb
        ? thick
        : shock
        ? thick * stretch
        : dart
        ? thick * (stretch * 1.28 * (1 - round) + (1.12 + 0.38 * grow) * round)
        : thick * (0.85 + 0.55 * grow);
      const late = Math.pow(Phaser.Math.Clamp((age - 0.52) / 0.48, 0, 1), 1.7);
      const sy = orb
        ? thick
        : shock
        ? thick * (0.48 + 0.7 * age)
        : dart
        ? thick * ((0.58 + 0.16 / Math.max(stretch, 1)) * (1 - round) + (1.08 + 0.28 * grow) * round)
        : thick * (0.28 + 0.42 * late);
      const baseA = s.additive ? 0.45 + fade * 0.55 : 0.55 + fade * 0.4;
      const alpha = s.blood
        ? 0.35 + fade * 0.65
        : orb
          ? 0.55 + 0.45 * Math.pow(fade, 0.45)
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
      im.setOrigin(orb ? 0.5 : dart ? 0.12 + 0.38 * round : 0.12, 0.5)
        .setPosition(at.x, at.y)
        .setRotation(rot)
        .setScale(sx * zs, sy * zs)
        .setBlendMode(
          s.blood ? Phaser.BlendModes.NORMAL : s.additive ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL
        )
        .setAlpha(alpha);
      if (im.depth !== depth) im.setDepth(depth);
      if (this.thermalOn) {
        // Dirt/dust: medium heat so scars aren't masked black. Blood: hotter live spray.
        applyThermalHeat(im, true, s.blood ? 0.72 : 0.42);
      } else if (s.blood) {
        im.setTintFill(s.tint);
      } else {
        im.clearTint();
        im.setTint(s.tint);
      }
    });
  }










  emitShotTrail(s: Shot, x0: number, y0: number, z0: number): void {
    if (s.deadfall) return;
    const exhaust = s.beh?.exhaust;
    const cyanSpark = exhaustIsGunSpark(exhaust);
    if (shotIsGunOrBeam(s) && !cyanSpark) return;
    if (exhaustIsEnergy(exhaust) || s.energyTrail || s.energyTrails) return;
    if (!exhaust || exhaust.kind !== "particles") return;
    if ((exhaust.size ?? 1) <= 0) return;
    if (s.motor != null && s.motor < 0) return;
    const small = troopMissileTrail(s);
    const smokeSc = shotTrailScale(s);
    const fireSc =
      (s.scale ?? 1) *
      (exhaust.kind === "particles" ? (exhaust.fireSize ?? exhaust.size ?? 1) : 1);
    const dens = Phaser.Math.Clamp(exhaust.density ?? 1, 0.05, 2.5);
    const t = range(0.2, 0.8);
    const x = x0 + (s.x - x0) * t;
    const y = y0 + (s.y - y0) * t;
    const z = z0 + (s.z - z0) * t;
    if (!cameraPointVisible(z, y)) return;
    const age = s.st?.age ?? 0;
    const fireWanted =
      exhaust.fire != null && (exhaust.fireFor == null || age < exhaust.fireFor);

    // Rail cyan motes — spawn along the bolt; jitter plus a nudge along the shot.
    if (cyanSpark && fireWanted) {
      const at = worldToScreen(x, y, z);
      const ang = projectHeading(s.angle, x, y, z);
      this.exhaustVx = Math.cos(ang);
      this.exhaustVy = Math.sin(ang);
      const n = this.fxEmitCount(1.35 * dens);
      if (n) {
        this.withTrailFx(0.85, () =>
          this.emitBudgeted(
            "fire",
            this.fxAt(z, y, this.railSparkTrail, ZOff.fire + 0.15),
            at.x,
            at.y,
            n
          )
        );
      }
      return;
    }

    const tailUv = exhaust.emitUv ?? SHOT_TAIL;
    const tail = this.projectiles.shotUvScreenPos(s, tailUv.x, tailUv.y, x, y, z);
    const tx = tail.x;
    const ty = tail.y;
    const fireEm = !fireWanted
      ? null
      : exhaust.fire === "hotFlame"
        ? this.hotFlame
        : exhaust.fire === "burn"
          ? this.burn
          : null;
    const smokeEm =
      exhaust.smoke === "short"
        ? this.shortTrailSmoke
        : exhaust.smoke === "rocket"
          ? this.rocketSmoke
          : exhaust.smoke === "linger"
            ? this.lingerSmoke
            : null;
    const emitFireSmoke = (
      fireProto: Phaser.GameObjects.Particles.ParticleEmitter,
      smokeProto: Phaser.GameObjects.Particles.ParticleEmitter,
      nfMul: number,
      nsMul: number
    ) => {
      // Smoke under fire — pairFx pins band depths; emit smoke first.
      const { fire, smoke } = this.pairFx(z, y, fireProto, smokeProto);
      const ns = this.fxEmitCount(nsMul * dens);
      const nf = this.fxEmitCount(nfMul * dens);
      if (ns) {
        this.withTrailFx(smokeSc, () => this.emitBudgeted("smoke", smoke, tx, ty, ns));
      }
      if (nf) {
        this.withTrailFx(fireSc, () => this.emitBudgeted("fire", fire, tx, ty, nf));
      }
    };
    if (exhaust.align === "heading") {
      this.shotTrailAngle = projectHeading(s.angle, x, y, z);
    }
    if (exhaust.contrail) {
      this.withTrailFx(smokeSc, () => {
        const ang =
          exhaust.align === "heading"
            ? this.shotTrailAngle
            : Math.atan2(
                screenVelY(s.vy, s.vz, z, y),
                screenVelX(s.vx, s.vy, s.vz, x, y, z)
              );
        this.wingTrailAngle = ang;
        this.wingTrailTint = 0xf2f6ff;
        this.wingTrailLife = 1200 + dens * 500;
        this.wingTrailScaleX = (0.85 + dens * 0.45) * smokeSc * range(1.25, 1.75);
        this.wingTrailScaleY = (0.16 + dens * 0.08) * smokeSc;
        this.wingTrailVx = Math.cos(ang + Math.PI) * range(6, 16);
        this.wingTrailVy = Math.sin(ang + Math.PI) * range(6, 16);
        const nc = this.fxEmitCount(0.95 * dens + 0.45);
        if (nc) {
          this.emitBudgeted(
            "smoke",
            this.fxAt(z, y, this.jetWingTrail, ZOff.smoke - 0.15),
            tx,
            ty,
            nc
          );
        }
      });
    }
    if (fireEm && smokeEm && exhaust.fire === "hotFlame" && exhaust.smoke === "short") {
      emitFireSmoke(this.hotFlame, this.shortTrailSmoke, 0.95, 0.7);
    } else if (small && fireEm && smokeEm) {
      emitFireSmoke(fireEm, smokeEm, 0.4, 0.28);
    } else if (exhaust.smoke === "rocket" && !fireEm) {
      this.withTrailFx(smokeSc, () => {
        const ns = this.fxEmitCount(1.35 * dens);
        if (ns) {
          this.emitBudgeted(
            "smoke",
            this.fxAt(z, y, this.rocketSmoke, ZOff.smoke),
            tx,
            ty,
            ns
          );
        }
      });
    } else if (exhaust.smoke === "rocket" && fireEm) {
      emitFireSmoke(fireEm, this.rocketSmoke, 0.85, 0.85);
    } else if (fireEm && smokeEm) {
      // Missiles: denser linger plume under the motor flame.
      emitFireSmoke(fireEm, smokeEm, 0.55, 1.05);
    } else if (smokeEm) {
      this.withTrailFx(smokeSc, () => {
        const ns = this.fxEmitCount((exhaust.contrail ? 0.55 : 0.85) * dens);
        if (ns) {
          this.emitBudgeted(
            "smoke",
            this.fxAt(z, y, smokeEm, ZOff.smoke),
            tx,
            ty,
            ns
          );
        }
      });
    } else if (fireEm) {
      this.withTrailFx(fireSc, () => {
        const nf = this.fxEmitCount(0.55 * dens);
        if (nf) this.emitBudgeted("fire", this.fxAt(z, y, fireEm, ZOff.fire), tx, ty, nf);
      });
    }
  }

  /** Magenta mote trail + energy orbs + rearward sparks for the warp bomb. */
  emitWarpTrailFx(s: Shot, x0: number, y0: number, z0: number): void {
    if (s.motor != null && s.motor < 0) return;
    const t = range(0.2, 0.85);
    const x = x0 + (s.x - x0) * t;
    const y = y0 + (s.y - y0) * t;
    const z = z0 + (s.z - z0) * t;
    if (!cameraPointVisible(z, y)) return;
    const at = worldToScreen(x, y, z);
    // Bomb moves on wall-clock during timewarp — keep FX density wall-clock too.
    const wallMul =
      s.warpTimeScale != null && this.lastSimScale > 0.001
        ? Math.min(8, 1 / this.lastSimScale)
        : 1;
    const spd = Math.hypot(s.vx, s.vy, s.vz);
    const back =
      spd > 8
        ? { x: -s.vx / spd, y: -s.vy / spd, z: -s.vz / spd }
        : { x: -Math.cos(s.angle), y: -Math.sin(s.angle), z: 0 };
    this.withTrailFx(1.2, () => {
      const nTrail = Math.min(4, this.fxEmitCount(1.55 * wallMul));
      if (nTrail) {
        this.emitBudgeted(
          "short",
          this.fxAt(z, y, this.warpTrail, ZOff.fire + 0.2),
          at.x,
          at.y,
          nTrail
        );
      }
      const nOrb = Math.min(2, this.fxEmitCount(0.7 * wallMul));
      if (nOrb) {
        this.emitBudgeted(
          "short",
          this.fxAt(z, y, this.warpOrb, ZOff.fire + 0.35),
          at.x,
          at.y,
          nOrb
        );
      }
    });
    const nSpark = Math.min(5, this.fxEmitCount(1.35 * wallMul));
    if (nSpark) {
      this.emitVisualBurst(
        x,
        y,
        z,
        {
          n: nSpark,
          spdMin: 55,
          spdMax: 210,
          bx: back.x,
          by: back.y,
          bz: back.z,
          tight: 0.42,
          scaleMul: 0.95,
          stretchMul: 1.15,
        },
        this.warpSparkBurst
      );
    }
  }

  /** Pink/red flame-smoke loft + fast red sparks for the signal-flare gun pellet. */
  emitSignalFlareTrailFx(s: Shot, x0: number, y0: number, z0: number): void {
    const ex = s.beh?.exhaust;
    if (!exhaustIsSignalFlare(ex)) return;
    const dens = Phaser.Math.Clamp(ex.density ?? 1, 0.05, 2);
    const sc = (s.scale ?? 1) * (ex.size ?? 1);
    const t = range(0.15, 0.85);
    const x = x0 + (s.x - x0) * t;
    const y = y0 + (s.y - y0) * t;
    const z = z0 + (s.z - z0) * t;
    if (!cameraPointVisible(z, y)) return;
    const at = worldToScreen(x, y, z);
    this.withTrailFx(sc, () => {
      const nFlame = this.fxEmitCount(1.15 * dens);
      if (nFlame) {
        this.emitBudgeted(
          "fire",
          this.fxAt(z, y, this.signalFlareTrail, ZOff.fire + 0.35),
          at.x,
          at.y,
          nFlame
        );
      }
      const nSmoke = this.fxEmitCount(0.95 * dens);
      if (nSmoke) {
        this.emitBudgeted(
          "smoke",
          this.fxAt(z, y, this.signalFlareSmoke, ZOff.smoke + 0.1),
          at.x,
          at.y,
          nSmoke
        );
      }
    });
    // Fast red sparks with extra world Y/Z loft so the trail climbs the 2.5D plane.
    const nSpark = this.fxEmitCount(1.45 * dens);
    if (nSpark) {
      this.emitVisualBurst(
        x,
        y,
        z,
        {
          n: Math.min(6, nSpark),
          spdMin: 180,
          spdMax: 480,
          bx: range(-0.18, 0.18),
          by: -0.72,
          bz: 1.35,
          tight: 0.28,
          scaleMul: 0.7 * sc,
          gravity: 22,
          depthOff: ZOff.fire + 0.9,
        },
        this.signalFlareSpark
      );
    }
  }

  drawTowWires(): void {
    const g = this.towWireGfx;
    g.clear();
    if (this.player.phase === "dead") return;
    let wireDepth = worldDepth(this.player.z, ZOff.shot - 0.8, this.player.y);
    for (const s of this.shots) {
      if (!s.wire?.length || s.from !== "player") continue;
      const pts = s.wire;
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



  simulateHelixRibbon(s: Shot, dt: number, x: number, y: number, z: number): void {
    if (!s.energyTrail) s.energyTrail = [];
    const spd = Math.hypot(s.vx, s.vy, s.vz);
    const back =
      spd > 8
        ? { x: -s.vx / spd, y: -s.vy / spd, z: -s.vz / spd }
        : { x: -Math.cos(s.angle), y: -Math.sin(s.angle), z: 0 };
    // Tiny lateral shimmer so the braid isn't a perfect sine.
    const jit = (Math.random() - 0.5) * 1.4;
    const px = -Math.sin(s.angle);
    const py = Math.cos(s.angle);
    this.ageEnergyTrail(
      s.energyTrail,
      dt,
      { x: x + px * jit, y: y + py * jit, z: z + (Math.random() - 0.5) * 0.6 },
      0.1,
      back,
      HELIX_TRAIL_NODE_LIFE,
      "green",
      4.5
    );
  }

  simulateEnergyTrail(s: Shot, dt: number): void {
    const trails =
      s.energyTrails ??
      (s.energyTrail ? (s.energyTrails = [s.energyTrail], s.energyTrails) : null);
    if (!trails) {
      if (s.beh && exhaustIsEnergy(s.beh.exhaust)) {
        s.energyTrail = [];
        s.energyTrails = [s.energyTrail];
      } else return;
    }
    const list = s.energyTrails!;
    const spd = Math.hypot(s.vx, s.vy, s.vz);
    const back =
      spd > 8
        ? { x: -s.vx / spd, y: -s.vy / spd, z: -s.vz / spd }
        : { x: -Math.cos(s.angle), y: -Math.sin(s.angle), z: 0 };
    const n = list.length;
    // Multi-ribbon lock-on (Photon): fan relative to bearing-to-target; else shot heading.
    let aimAng = s.angle;
    if (
      n > 1 &&
      s.targetId != null &&
      s.beh?.guidance &&
      guidanceIsLockOn(s.beh.guidance)
    ) {
      const u = this.unitSim.unitById(s.targetId);
      if (u && !u.dead) aimAng = Math.atan2(u.y - s.y, u.x - s.x);
    }
    const px = -Math.sin(aimAng);
    const py = Math.cos(aimAng);
    const tail = this.projectiles.shotTailWorldPos(s);
    const hue = exhaustHue(s.beh?.exhaust);
    for (let i = 0; i < n; i++) {
      const trail = list[i]!;
      const rel = n <= 1 ? 0 : i - (n - 1) / 2;
      // Spread ribbons laterally so thick→thin braid reads as three streams, and stagger the
      // outer ones back along the emit axis so they fan out from behind the shot rather than
      // all originating from the same point in a flat perpendicular line.
      const side = rel * 7.5;
      const backOffset = Math.abs(rel) * 5;
      const grow = {
        x: tail.x + px * side + back.x * backOffset,
        y: tail.y + py * side + back.y * backOffset,
        z: tail.z + rel * 2.2 + back.z * backOffset,
      };
      const strength = n <= 1 ? 1 : Phaser.Math.Linear(1.15, 0.42, i / Math.max(1, n - 1));
      this.ageEnergyTrail(trail, dt, grow, strength, back, ENERGY_TRAIL_NODE_LIFE, hue);
    }
    s.energyTrail = list[0];
  }

  releaseEnergyTrail(s: Shot): void {
    const trails = s.energyTrails ?? (s.energyTrail ? [s.energyTrail] : null);
    if (!trails?.length) return;
    for (const trail of trails) {
      if (!trail.length) continue;
      for (const p of trail) {
        const max = p.max ?? ENERGY_TRAIL_NODE_LIFE;
        p.life = Math.min(max, p.life + 0.12);
      }
      this.energyLinger.push(trail);
    }
    s.energyTrail = undefined;
    s.energyTrails = undefined;
    while (this.energyLinger.length > 28) this.energyLinger.shift();
  }

  energyTrailExhaust(back: { x: number; y: number; z: number }, mul = 1): { bx: number; by: number; bz: number } {
    const kick = (72 + Math.random() * 28) * mul;
    // Soft rear cone so the ribbon doesn't stack on a single reverse ray.
    const d = coneDir(back.x, back.y, back.z, 0.12, 5.5);
    return { bx: d.x * kick, by: d.y * kick, bz: d.z * kick };
  }

  ageEnergyTrail(
    trail: EnergyTrailNode[],
    dt: number,
    grow?: { x: number; y: number; z: number },
    strengthMul = 1,
    back?: { x: number; y: number; z: number },
    nodeLife = ENERGY_TRAIL_NODE_LIFE,
    hue?: EnergyTrailNode["hue"],
    minGrowDist = 8
  ): void {
    if (grow) {
      const last = trail[trail.length - 1];
      if (!last || Math.hypot(grow.x - last.x, grow.y - last.y, grow.z - last.z) > minGrowDist) {
        trail.push({
          ...grow,
          ...(back ? this.energyTrailExhaust(back, strengthMul) : { bx: 0, by: 0, bz: 0 }),
          life: nodeLife,
          max: nodeLife,
          hue,
        });
      }
    }
    const drag = Math.pow(0.22, dt);
    for (const p of trail) {
      p.x += p.bx * dt;
      p.y += p.by * dt;
      p.z += p.bz * dt;
      p.bx *= drag;
      p.by *= drag;
      p.bz *= drag;
      p.life -= dt;
    }
    let w = 0;
    for (const p of trail) {
      if (p.life > 0) trail[w++] = p;
    }
    trail.length = w;
    while (trail.length > 140) trail.shift();
  }

  ageEnergyLinger(dt: number): void {
    let w = 0;
    for (const trail of this.energyLinger) {
      this.ageEnergyTrail(trail, dt);
      if (trail.length >= 2) this.energyLinger[w++] = trail;
    }
    this.energyLinger.length = w;
  }

  drawEnergyRibbon(g: Phaser.GameObjects.Graphics, pts: EnergyTrailNode[], widthMul = 1): number {
    const n = pts.length;
    if (n < 2) return Number.NEGATIVE_INFINITY;
    let depth = Number.NEGATIVE_INFINITY;
    let maxLife = 0;
    const raw: { x: number; y: number }[] = [];
    const ages: number[] = [];
    const hue = pts[0]?.hue ?? "cyan";
    for (let i = 0; i < n; i++) {
      const p = pts[i]!;
      const ref = p.max ?? ENERGY_TRAIL_NODE_LIFE;
      maxLife = Math.max(maxLife, p.life / ref);
      depth = Math.max(depth, worldDepth(p.z, ZOff.shot - 0.6, p.y));
      const at = worldToScreen(p.x, p.y, p.z);
      raw.push({ x: at.x, y: at.y });
      ages.push(Phaser.Math.Clamp(1 - p.life / ref, 0, 1));
    }
    const screen = this.smoothPolyline(raw);
    const linger = Phaser.Math.Clamp(maxLife, 0, 1);
    const sn = screen.length;
    const nn = Math.max(1, n - 1);
    const ageAt = (si: number) => {
      const u = Phaser.Math.Clamp((si / Math.max(1, sn - 1)) * nn, 0, nn);
      const i0 = Math.min(n - 1, u | 0);
      const i1 = Math.min(n - 1, i0 + 1);
      const f = u - i0;
      return ages[i0]! * (1 - f) + ages[i1]! * f;
    };
    const strokeLayer = (base: number, color: number, alpha: number) => {
      for (let i = 0; i < sn - 1; i++) {
        const age = (ageAt(i) + ageAt(i + 1)) * 0.5;
        const thick = Phaser.Math.Linear(2.55, 0.35, Math.pow(age, 0.85)) * widthMul;
        g.lineStyle(base * thick, color, alpha * linger * Phaser.Math.Linear(1, 0.15, age));
        g.beginPath();
        g.moveTo(screen[i]!.x, screen[i]!.y);
        g.lineTo(screen[i + 1]!.x, screen[i + 1]!.y);
        g.strokePath();
      }
    };
    if (hue === "green") {
      strokeLayer(3.1, 0x1a6a22, 0.22);
      strokeLayer(1.55, 0x55ee44, 0.52);
      strokeLayer(0.72, 0xeaffc8, 0.95);
    } else if (hue === "magenta") {
      strokeLayer(3.6, 0x6a18ff, 0.22);
      strokeLayer(1.7, 0xc86cff, 0.52);
      strokeLayer(0.85, 0xf8e8ff, 0.95);
    } else {
      strokeLayer(3.6, 0x1a58ff, 0.2);
      strokeLayer(1.7, 0x3ad8ff, 0.48);
      strokeLayer(0.85, 0xffffff, 0.92);
    }
    return depth;
  }

  /** Catmull-Rom samples so energy ribbons read as a TOW-like curve, not a dotted polyline. */
  smoothPolyline(pts: { x: number; y: number }[], steps = 4): { x: number; y: number }[] {
    const n = pts.length;
    if (n < 3) return pts;
    const out: { x: number; y: number }[] = [{ x: pts[0]!.x, y: pts[0]!.y }];
    const catmull = (p0: number, p1: number, p2: number, p3: number, t: number) => {
      const t2 = t * t;
      const t3 = t2 * t;
      return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
    };
    for (let i = 0; i < n - 1; i++) {
      const a = pts[i - 1] ?? pts[i]!;
      const b = pts[i]!;
      const c = pts[i + 1]!;
      const d = pts[i + 2] ?? c;
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        out.push({
          x: catmull(a.x, b.x, c.x, d.x, t),
          y: catmull(a.y, b.y, c.y, d.y, t),
        });
      }
    }
    return out;
  }

  drawEnergyTrails(): void {
    const g = this.energyTrailGfx;
    g.clear();
    if (this.player.phase === "dead") return;
    let depth = worldDepth(this.player.z, ZOff.shot - 0.6, this.player.y);
    for (const s of this.shots) {
      if (s.from !== "player") continue;
      const trails = s.energyTrails ?? (s.energyTrail ? [s.energyTrail] : null);
      if (!trails) continue;
      const n = trails.length;
      for (let i = 0; i < n; i++) {
        const pts = trails[i]!;
        if (pts.length < 2) continue;
        const widthMul = n <= 1 ? 1 : Phaser.Math.Linear(1.35, 0.55, i / Math.max(1, n - 1));
        depth = Math.max(depth, this.drawEnergyRibbon(g, pts, widthMul));
      }
    }
    for (const pts of this.energyLinger) {
      depth = Math.max(depth, this.drawEnergyRibbon(g, pts));
    }
    g.setDepth(depth);
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
    const scarKey = this.textures.exists(key) ? key : "fx_blast_0";
    // Wreck stamp stays subtle; thermal overlay is separate at readable scale (instant full heat).
    this.stampWreck(scarKey, px, py, ang, sx, alpha, 0.5, 0.5, sy, undefined, undefined, false);
    this.addThermalWreckMark(scarKey, px, py, ang, sx, sy, 0.5, 0.5, undefined, "scar");
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
    targetRadius = 0,
    /** When set, spray particles/debris from random points inside this body. */
    body?: Footprint,
    look?: {
      spark?: Phaser.GameObjects.Particles.ParticleEmitter;
      flash?: number;
      /** Flash diameter floor in px. Default 120. */
      flashMin?: number;
      /** Scales fireball / streak density. */
      visMul?: number;
      /** Skip explosion puff + blastFire (energy-only look). */
      noFire?: boolean;
      /** Skip invisible HE blast-trail frags. */
      noTrails?: boolean;
    }
  ): void {
    const at = worldToScreen(x, y, z);
    const blastX = at.x;
    const blastY = at.y;
    const blastScale = at.scale;
    const vis = look?.visMul ?? 1;
    const mul = (soft ? 0.32 : 1) * Phaser.Math.Linear(0.45, 1.15, size01) * vis;
    const p = Phaser.Math.Clamp(power, 0.5, 2.4);
    const t = Math.min(1, (p - 0.5) / 1.9);
    const spdBoost = Phaser.Math.Linear(0.95, 1.35, t);
    const biasLen = Math.hypot(dx, dy, dz);
    const expK = soft ? undefined : biasLen > 40 ? Phaser.Math.Linear(1.85, 2.7, t) : 1.5;
    const bodyR =
      body == null
        ? 0
        : body.shape === "circle"
          ? body.r
          : Math.hypot(body.halfL, body.halfW);
    // Keep particle origins inside the body; small inset vs debris chunks.
    const particleInset = body ? Math.min(bodyR * 0.22, 10) : 0;
    if (!look?.noFire) {
      const puffN = Math.max(4, Math.round(22 * mul));
      const puffOpt = {
        spdMin: 140 * spdBoost,
        spdMax: 480 * spdBoost,
        bx: dx,
        by: dy,
        bz: dz,
        tight: Phaser.Math.Linear(0.48, 0.72, t),
        scaleMul: (soft ? 0.42 : 1) * Phaser.Math.Linear(0.4, 1.35, size01),
        expBias: expK,
      };
      this.emitScatteredBurst(body, particleInset, x, y, z + 10, puffN, puffOpt, this.explosionPuff, "fire");
      // Mid boom stack — above dirt streaks, below boomBit flecks.
      this.blastFire.setDepth(worldDepth(z, ZOff.fire + 1.2, y));
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
      const fireN = Math.max(3, Math.round(26 * mul));
      if (body) {
        for (let i = 0; i < fireN; i++) {
          const o = randomInFootprint(body, particleInset);
          const s = worldToScreen(o.x, o.y, z);
          this.emitBudgeted("fire", this.blastFire, s.x, s.y, 1, true);
        }
      } else {
        this.emitBudgeted("fire", this.blastFire, blastX, blastY, fireN, true);
      }
    }
    // Soft gradient bloom — sized to read through the fireball (Hydra blast 140 → ~170px+).
    this.spawnImpactFlash(
      blastX,
      blastY,
      z,
      look?.flash ?? 0xfff4c8,
      Math.max(look?.flashMin ?? 120, blast * (soft ? 0.55 : 1.2) * waveMul) * blastScale,
      1,
      280
    );
    // A handful of long, fast streaks that brake and vanish quickly.
    const streakN = Math.max(
      vis < 1 ? 1 : soft ? 2 : 4,
      Math.round((soft ? 4.5 : 10) * Phaser.Math.Linear(0.55, 1.15, size01) * vis)
    );
    this.emitScatteredBurst(
      body,
      particleInset,
      x,
      y,
      z + 8,
      streakN,
      {
        spdMin: (soft ? 820 : 1280) * spdBoost,
        spdMax: (soft ? 1500 : 2600) * spdBoost,
        bx: dx,
        by: dy,
        bz: dz,
        tight: soft ? 0.22 : Phaser.Math.Linear(0.38, 0.58, t),
        scaleMul: Phaser.Math.Linear(1.35, 2.2, size01) * (soft ? 0.75 : 1),
        expBias: expK,
      },
      look?.spark ?? this.streakBurst
    );
    if (!look?.noTrails) {
      this.spawnBlastTrails(x, y, z, dx, dy, dz, soft, size01, p, body, particleInset);
    }
    if (targetRadius > 0) this.projectiles.spawnBlastRing(x, y, z, targetRadius);
  }


  /** Emit a visual burst from one point, or scatter across a body footprint. */
  emitScatteredBurst(
    body: Footprint | undefined,
    inset: number,
    x: number,
    y: number,
    z: number,
    n: number,
    opt: {
      spdMin: number;
      spdMax: number;
      bx: number;
      by: number;
      bz: number;
      tight: number;
      scaleMul?: number;
      stretchMul?: number;
      expBias?: number;
      gravity?: number;
      coneHalf?: number;
      depthOff?: number;
    },
    emitter: Phaser.GameObjects.Particles.ParticleEmitter,
    kind: FxClass = "short"
  ): void {
    if (!body || n <= 1) {
      this.emitVisualBurst(x, y, z, { ...opt, n }, emitter, kind);
      return;
    }
    let left = n;
    while (left > 0) {
      const batch = Math.min(left, 1 + ((Math.random() * 2) | 0));
      const o = randomInFootprint(body, inset);
      this.emitVisualBurst(o.x, o.y, z, { ...opt, n: batch }, emitter, kind);
      left -= batch;
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
    power = 1,
    body?: Footprint,
    particleInset = 0
  ): void {
    const p = Phaser.Math.Clamp(power, 0.5, 2.4);
    const t = Math.min(1, (p - 0.5) / 1.9);
    const n =
      Math.max(2, Math.round(Phaser.Math.Linear(soft ? 2 : 4, soft ? 5 : 11, size01))) + ((Math.random() * 2) | 0);
    // Drop settled blast trails that are mostly faded so a barrage keeps fresh streaks.
    this.cullFadedEphemeralTrails(n);
    const spdMul = Phaser.Math.Linear(0.95, 1.4, t);
    const tight = soft ? 0.18 : Phaser.Math.Linear(0.45, 0.7, t);
    for (let i = 0; i < n; i++) {
      const reverse = Math.random() < (soft ? 0.35 : 0.14);
      const d = biasedDir(dx, dy, dz, tight, reverse);
      const sp = range(70, 250) * spdMul;
      const jit = soft ? 0.55 : 0.3;
      const trailR = soft
        ? range(6.8, 7.6)
        : Phaser.Math.Linear(2.2, 14, size01) * range(0.75, 1.15);
      // Soft trails are large visually — inset more so they birth inside the body.
      const inset = body ? Math.max(particleInset, trailR * (soft ? 0.35 : 0.2)) : 0;
      const o = body ? randomInFootprint(body, inset) : { x, y };
      this.admitDebris({
        x: o.x,
        y: o.y,
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
        trailR,
        trailSoft: soft,
        wobble: Math.random() * Math.PI * 2,
        wobFreq: range(9, 17),
        wobAmp: range(140, 300),
      });
    }
  }

  /** Free ephemeral slots held by nearly-done settled blast trails. */
  cullFadedEphemeralTrails(need: number): void {
    if (need <= 0) return;
    let freed = 0;
    for (let i = this.debris.length - 1; i >= 0 && freed < need; i--) {
      const f = this.debris[i]!;
      if (f.debrisClass !== "ephemeral" || !f.settled) continue;
      const fade = f.trailFade ?? 0;
      const max = f.trailFadeMax ?? 1;
      if (fade / max > 0.35) continue;
      this.debris.splice(i, 1);
      freed++;
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



  destroyUnit(u: Unit, quiet = false, skipSplash = false, skipAirCrash = false, freefall = false): void {
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
      const body = footprintOf(u);
      const bodyR = circumRadiusOf(u.kind);
      const near = Math.hypot(u.x - this.player.x, u.y - this.player.y);
      if (building) {
        const killPulse =
          Phaser.Math.Clamp(1.2 - near / 1100, 0.18, 0.62) * Phaser.Math.Linear(0.55, 1.15, boom);
        this.postFx.pulseBarrel(killPulse);
      }
      let burst: { dx: number; dy: number; dz: number; power: number } | null = null;
      if (sp.organic) {
        this.heFireBurst(u.x, u.y, hz, 0, 0, 1, blast, true, building ? 2.25 : 1, boom, 1, 0, body);
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
          mech ? radius(u.kind) : 0,
          body
        );
        // Dramatic additive fireball on vehicles & buildings.
        this.spawnToonBlast(u.x, u.y, hz, {
          building,
          size01: boom,
          waveMul: building ? 1.15 : 1,
        });
        if (u.hv || building || boom > 0.62) {
          const boomSize = Math.max(boom, u.hv ? 0.85 : 0.55);
          const kdx = burst?.dx ?? 0;
          const kdy = burst?.dy ?? 0;
          const kdz = burst?.dz ?? 1;
          this.emitBigBoomSparks(u.x, u.y, hz + 8, boomSize, kdx, kdy, kdz);
          this.emitBigBoomDebris(u.x, u.y, hz + 8, boomSize, kdx, kdy, kdz);
        }
      }
      if (building) this.emitDustShock(u.x, u.y, 1);
      // Smoke puffs from a few footprint points, not only the center.
      const smokeN = 16;
      const smokeClusters = Math.min(5, smokeN);
      for (let s = 0; s < smokeClusters; s++) {
        const o = randomInFootprint(body, Math.min(bodyR * 0.2, 8));
        const smokeAt = worldToScreen(o.x, o.y, u.z);
        this.smoke.setDepth(worldDepth(u.z, 0.2, o.y));
        this.emitBudgeted(
          "smoke",
          this.smoke,
          smokeAt.x,
          smokeAt.y + 12,
          Math.ceil(smokeN / smokeClusters)
        );
      }
      this.shake = Math.min(10, this.shake + 3);
      // Buildings/vehicles: weak splash at ~3× body radius (FX blast can be larger).
      if (!skipSplash && !sp.organic) {
        if (mech) {
          const splashR = radius(u.kind) * 3;
          const deathDmg = u.max * (building ? 0.05 : 0.1);
          this.projectiles.applyBlastDamage(
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
        const scale = (organic ? 0.78 : 1) * Phaser.Math.Linear(0.32, maxSc, boom);
        const trailR = organic
          ? range(6.8, 7.6)
          : this.texTrailR(key) * Phaser.Math.Linear(0.4, maxTrail, boom);
        // Inset by ~half the piece so the chunk stays inside the footprint.
        const pieceR = Phaser.Math.Clamp(
          organic ? trailR * 0.35 : this.texTrailR(key) * scale * 0.28,
          2,
          bodyR * 0.45
        );
        const origin = randomInFootprint(body, pieceR);
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
          x: origin.x,
          y: origin.y,
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
          trailR,
          scale,
          trailSoft: organic,
        });
      }
      if (!sp.noCrater && !sp.crashPop) {
        let sc = (radius(u.kind) / 20) * range(0.72, 1.42);
        if (sp.wreckScale != null) sc *= sp.wreckScale;
        this.stampBlastCrater(u.x, u.y, sc);
        // Embers only on mech / building death craters — not troops or soft organics.
        if (mech && !sp.organic) {
          this.spawnCraterEmbers(u.x, u.y, this.softCapBlastCraterScale(sc));
        }
      }
    }
    const guns = gunsOf(u);
    // Helis and drones: spinning hull falls then impacts — not on suicide/kamikaze pops.
    if (sp.behavior === "patrol_boat") {
      this.spawnBoatSink(u);
    } else if (((sp.behavior === "orbit_attack_heli" || sp.behavior === "kite_attack_heli") || sp.behavior === "suicide_attack_heli") && !skipAirCrash) {
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
        kickDx: freefall ? 0 : u.killDx,
        kickDy: freefall ? 0 : u.killDy,
        freefall,
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
          const rotorMounts = rotorMountsOf(textureOf(u.kind));
          sp.rotors.forEach((r, ri) => {
            const rk = this.textures.exists(r.hulk ?? "") ? r.hulk! : r.tex;
            const at = this.mountAt(u, resolveSkin(this.textures, textureOf(u.kind), u.camo), r.mount);
            const scale = this.rotorHulkScale(r.tex, rk, r.scale ?? 1);
            // Full heli discs get pin flames; angled props / drone pads do not.
            const heliRotor = r.tex.includes("rotor") && r.tex !== "enemy_drone_rotor";
            const flamePts = heliRotor
              ? this.sampleSolidLocalPoints(
                  rk,
                  radius(u.kind) / Math.max(scale, 0.01),
                  2 + ((Math.random() * 3) | 0),
                  0.7
                )
              : [];
            const rotorAng = rotorSpinSign(rotorMounts, ri) * u.rotor;
            if (heliRotor) {
              this.throwRotorHulk({
                key: rk,
                x: at.x,
                y: at.y,
                z: u.z + 18,
                rotorAng,
                scale,
                flamePts,
              });
            } else {
              throwOff(rk, rotorAng, at.x, at.y, scale, {
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
      } else if (sp.crashPop) {
        this.spawnLightVehicleCrash(u);
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
      } else {
        const hulkKey = resolveSkin(this.textures, hulkOf(u.kind), u.camo);
        const hp = spritePivot(hulkKey);
        const hs = this.wreckDrawScale(u.x, u.y, u.z, 1, isGroundVehicle(u.kind), u.angle);
        this.stampWreck(
          this.textures.exists(hulkKey) ? hulkKey : "fx_hulk_crater",
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

  /**
   * Light-vehicle death: hulk launches in a spinning flaming arc biased toward
   * the killing impact, then stamps wreck + crater + embers where it lands.
   */
  spawnLightVehicleCrash(u: Unit): void {
    const sp = specOf(u.kind);
    const hulkKey = resolveSkin(this.textures, hulkOf(u.kind), u.camo);
    const key = this.textures.exists(hulkKey) ? hulkKey : "fx_hulk_crater";
    const burst = this.deathBurstImpulse(u);
    const reverse = Math.random() < 0.05;
    const d = biasedDir(burst.dx, burst.dy, burst.dz, 0.9, reverse);
    const spdMul = Phaser.Math.Linear(0.92, 1.1, Math.min(1, (burst.power - 0.5) / 1.9));
    const spd = range(70, 130) * spdMul;
    const jit = 0.1;
    const vx = d.x * spd + range(-spd * jit, spd * jit);
    const vy = d.y * spd + range(-spd * jit, spd * jit);
    const vz = range(140, 220) + Math.max(0, d.z) * 28;
    let craterSc = (radius(u.kind) / 20) * range(0.78, 1.35);
    if (sp.wreckScale != null) craterSc *= sp.wreckScale;
    this.admitDebris({
      x: u.x,
      y: u.y,
      z: u.z + 18,
      vx,
      vy,
      vz,
      angle: u.angle + Math.PI / 2,
      spin: range(9, 18) * (Math.random() < 0.5 ? -1 : 1),
      life: 10,
      key,
      settled: false,
      gravity: true,
      bounces: 0,
      trailR: this.texTrailR(key) * 0.62,
      scale: 1,
      debrisClass: "critical",
      linger: true,
      crashPop: true,
      crashCraterScale: craterSc,
    });
  }

  spawnWheelDebris(u: Unit): void {
    const maxW = specOf(u.kind).wheels;
    if (!maxW) return;
    const keys = wheelDebrisKeys().filter((k) => this.textures.exists(k));
    if (!keys.length) return;
    const n = Math.min(maxW, 1 + ((Math.random() * 2) | 0));
    const [scLo, scHi] = specOf(u.kind).wheelDebrisScale ?? [0.78, 0.95];
    const sc = range(scLo, scHi);
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
    /** EMP / power-cut: no loft kick, tumble into the ground. */
    freefall?: boolean;
  }): void {
    const player = !!opts.player;
    const freefall = !!opts.freefall;
    const sp = opts.kind ? specOf(opts.kind) : undefined;
    const craft = player ? this.player.spec : undefined;
    const hullKey = player
      ? this.textures.exists(craft!.hulk)
        ? craft!.hulk
        : craft!.body
      : resolveSkin(this.textures, sp!.hulk, opts.camo);
    const hullAng = opts.angle + (craft?.rotOff ?? Math.PI / 2);
    const dmgFlames = this.crashDmgFlames(opts.dmgSites, hullKey, opts.radius);
    const spinSign = Math.random() < 0.5 ? -1 : 1;
    const kn = Math.hypot(opts.kickDx ?? 0, opts.kickDy ?? 0);
    const boost = freefall ? range(8, 28) : range(110, 170);
    const kx = kn > 1 ? ((opts.kickDx ?? 0) / kn) * boost : freefall ? range(-22, 22) : 0;
    const ky = kn > 1 ? ((opts.kickDy ?? 0) / kn) * boost : freefall ? range(-22, 22) : 0;
    const hull: Debris = {
      x: opts.x,
      y: opts.y,
      z: opts.z,
      vx: opts.vx * (freefall ? 0.55 : 0.9) + kx + range(-18, 18),
      vy: opts.vy * (freefall ? 0.55 : 0.9) + ky + range(-18, 18),
      // Freefall (EMP drones): loft upward first so they hang before the ground boom.
      vz: freefall ? range(110, 220) : range(18, 55),
      angle: hullAng,
      spin: spinSign * (freefall ? range(2.4, 4.2) : range(0.85, 1.55)),
      spinAccel: freefall ? range(3.2, 5.5) : range(2.4, 4.6),
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
    if (player) this.playerCrashDebris = hull;

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

    const propDisc = !!(craft && craftRotorIsProp(craft));
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
      // Full lift discs get pin flames; angled props (plane/orbit foreshorten) / drone pads do not.
      const fullRotor =
        !propDisc && r.tex.includes("rotor") && r.tex !== "enemy_drone_rotor";
      const flamePts = fullRotor
        ? this.sampleSolidLocalPoints(
            rk,
            opts.radius / Math.max(scale, 0.01),
            2 + ((Math.random() * 3) | 0),
            0.7
          )
        : [];
      const spinMounts =
        player && craft
          ? craftRotorMounts(craft)
          : opts.kind
            ? rotorMountsOf(textureOf(opts.kind))
            : [{ x: 0.5, y: 0.5 }];
      const rotorAng = rotorSpinSign(spinMounts, ri) * opts.rotor;
      // Suicide drones: all rotors always fly off — never pin to the falling hull.
      const pin =
        (!opts.kind || specOf(opts.kind).behavior !== "suicide_attack_heli") && Math.random() < 0.4;
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
    this.reticleHud.hideAimChrome();
    const h = this.player;
    this.playerDeathLiveX = h.x;
    this.playerDeathLiveY = h.y;
    this.playerDeathLiveZ = h.z;
    // Death stinger waits until crash + simmer + delay (see end(false)).
    this.unwrapTilt(this.body);
    this.body.setVisible(false);
    for (const rotor of this.rotors) rotor.setVisible(false);
    for (const gun of this.guns) gun.setVisible(false);
    this.gun.setVisible(false);
    for (const glow of this.gunHeatGlows) glow.setVisible(false);
    this.shadow.setVisible(false);
    const hz = h.z + h.height * 0.5;
    const blast = 56;
    const body: Footprint = { shape: "circle", x: h.x, y: h.y, r: h.spec.radius };
    this.heFireBurst(h.x, h.y, hz, 0, 0, 1, blast, false, 1, 0.55, 1, 0, body);
    for (let s = 0; s < 4; s++) {
      const o = randomInFootprint(body, Math.min(h.spec.radius * 0.2, 8));
      const smokeAt = worldToScreen(o.x, o.y, h.z);
      this.smoke.setDepth(worldDepth(h.z, 0.2, o.y));
      this.emitBudgeted("smoke", this.smoke, smokeAt.x, smokeAt.y + 12, 4);
    }
    this.shake = Math.min(10, this.shake + 4);
    const n = 8;
    const keys = debrisKeys("heli");
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const spd = range(55, 220);
      const key = this.textures.exists(keys[i % keys.length]!) ? keys[i % keys.length]! : "fx_debris_metal";
      const scale = Phaser.Math.Linear(0.32, 1.3, 0.55);
      const pieceR = Phaser.Math.Clamp(this.texTrailR(key) * scale * 0.28, 2, h.spec.radius * 0.45);
      const origin = randomInFootprint(body, pieceR);
      this.admitDebris({
        x: origin.x,
        y: origin.y,
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
        scale,
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
        if (f.boomBit) {
          // Gentler while rising so loft lasts into the XY arc; snap down after apex.
          if (f.vz > 50) f.vz -= 220 * dt;
          else if (f.vz > -40) f.vz -= 95 * dt;
          else f.vz -= 1280 * dt;
        } else if (f.vz > 50) f.vz -= 480 * dt;
        else if (f.vz > -40) f.vz -= 70 * dt;
        else f.vz -= 1100 * dt;
        if (f.shellEject) {
          // Casings: air drag + slope bounce, then damp so they don't skim far from the drop.
          if (f.shellHeat != null && f.shellHeat > 0) {
            // ~7s live cool; ground stamp keeps glowing after settle.
            f.shellHeat = Math.max(0, f.shellHeat - dt / 7);
          }
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
                f.vx *= 0.42;
                f.vy *= 0.42;
                f.vz = Math.abs(f.vz) * 0.45;
                f.spin *= 0.55;
              } else {
                this.settleDebris(f);
              }
            }
          }
        } else {
          const drag = f.heliCrash ? 0.94 : f.rotorThrow ? 0.88 : f.boomBit ? 0.82 : 0.78;
          f.vx *= Math.pow(drag, dt);
          f.vy *= Math.pow(drag, dt);
          if (f.z > groundZ(this.world, f.x, f.y) + 2) {
            this.emitDebrisTrail(f, 1);
          }
          const g = groundZ(this.world, f.x, f.y);
          if (f.z <= g) {
            f.z = g;
            if (f.boomBit) {
              this.settleBoomBit(f);
            } else {
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
                const ivx = f.vx;
                const ivy = f.vy;
                f.bounces--;
                // Same elevation bounce as wheels, weaker so flight path barely turns.
                this.bounceDebrisSlope(f, 0.32);
                if (!f.key.includes("organic")) this.stampDebrisBounceScorch(f.x, f.y, ivx, ivy);
                f.spin *= range(0.78, 1.22);
                f.spin += range(-2.4, 2.4);
                f.angle += range(-0.28, 0.28);
              } else {
                this.settleDebris(f);
              }
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
    if (this.perf.enabled) {
      const t = performance.now();
      this.syncDebrisSprites();
      this.perf.current![8] = performance.now() - t;
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
    let sc = Phaser.Math.Linear(0.85, 1.45, f.impactDust ?? 0.5) * range(0.9, 1.2);
    if (f.playerCrash) sc *= 1.12;
    this.stampBlastCrater(f.x, f.y, sc);
    this.spawnCraterEmbers(f.x, f.y, this.softCapBlastCraterScale(sc));
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
    if (f.crashPop && !isWater(this.world, f.x, f.y)) {
      const sc = f.crashCraterScale ?? 0.9;
      this.stampBlastCrater(f.x, f.y, sc);
      this.spawnCraterEmbers(f.x, f.y, this.softCapBlastCraterScale(sc));
      this.emitDustShock(f.x, f.y, 0.55);
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
        sy *= 0.76;
      } else if (f.rotorSkew) {
        sx *= 1.08;
        sy *= 0.78;
      }
      this.stampWreck(f.key, f.x, f.y, f.angle, sx, 0.92, o.x, o.y, sy);
      if (f.shellEject) {
        this.addThermalWreckMark(
          f.key,
          f.x,
          f.y,
          f.angle,
          sx,
          sy,
          o.x,
          o.y,
          undefined,
          "shell",
          f.shellHeat ?? 1
        );
      }
      f.trailOnly = true;
    }
    if (!f.heliCrash && !f.shellEject && !f.boomBit) this.beginDebrisTrailFade(f);
  }

  /** Tiny mech fleck from a big boom: stamp on land, splash+delete in water. */
  settleBoomBit(f: Debris): void {
    f.vx = 0;
    f.vy = 0;
    f.vz = 0;
    if (!f.trailOnly) {
      if (isWater(this.world, f.x, f.y)) {
        const sc = Math.max(0.08, f.scale ?? 0.2);
        const n = Math.max(1, Math.round(2 + sc * 6));
        this.emitVisualBurst(
          f.x,
          f.y,
          f.z + 2,
          {
            n,
            spdMin: 40,
            spdMax: 140,
            bx: 0,
            by: -0.35,
            bz: 1,
            tight: 0.55,
            scaleMul: 0.35 + sc * 0.9,
            gravity: 220,
            depthOff: ZOff.fire + 0.3,
          },
          this.splashBurst
        );
      } else {
        const o = this.debrisStampOrigin(f.key);
        const sc = Math.max(0.05, f.scale ?? 0.08);
        const hs = this.wreckDrawScale(f.x, f.y, f.z || 0, sc);
        this.stampWreck(f.key, f.x, f.y, f.angle, hs.sx, 0.78, o.x, o.y, hs.sy);
      }
      f.trailOnly = true;
    }
    // Not marked settled so the trailOnly+life cull can remove it this tick.
    f.trailFade = 0;
    f.life = 0;
    f.settled = false;
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
    if (f.boomBit) {
      // Sparse Hydra-style long smoke — not dense fire trails.
      const at = worldToScreen(f.x, f.y, f.z);
      this.shotTrailAngle = Math.atan2(
        screenVelY(f.vy, f.vz, f.z, f.y),
        screenVelX(f.vx, f.vy, f.vz, f.x, f.y, f.z)
      );
      const n = this.fxEmitCount(0.22 * dim);
      if (n) {
        this.withTrailFx(0.55 * (f.scale ?? 0.25) + 0.35, () =>
          this.emitBudgeted(
            "smoke",
            this.fxAt(f.z, f.y, this.rocketSmoke, ZOff.smoke - 0.2),
            at.x,
            at.y,
            n
          )
        );
      }
      return;
    }
    const debrisScale = worldToScreen(f.x, f.y, f.z).scale;
    // Trails sit under the debris sprite (body ≈ 0); keep fire above smoke within the pair.
    const trailFire = -0.35;
    const trailSmoke = -1.15;
    const lifeMul = this.debrisTrailLifeMul(this.debrisTrailSize(f));
    if (f.flamePts?.length) {
      const ca = Math.cos(f.angle);
      const sa = Math.sin(f.angle);
      const flatX = f.dishFlat ? 1.04 : f.rotorSkew ? 1.08 : 1;
      const flatY = f.dishFlat ? 0.76 : f.rotorSkew ? 0.78 : 1;
      const { fire, smoke } = this.pairFx(f.z, f.y, this.flame, this.hurtSmoke, trailFire, trailSmoke);
      const prevLife = this.trailFxLife;
      const prevDmg = this.dmgFlameScale;
      this.trailFxLife = lifeMul;
      try {
        for (const p of f.flamePts) {
          const lx = p.lx * flatX;
          const ly = p.ly * flatY;
          const worldX = f.x + lx * ca - ly * sa;
          const worldY = f.y + lx * sa + ly * ca;
          const at = worldToScreen(worldX, worldY, f.z);
          this.dmgFlameScale = p.sc * (f.scale ?? 1) * (f.dishFlat ? 0.85 : 1.15);
          const nFire = this.fxEmitCount(0.8 * dim);
          const nSmoke = this.fxEmitCount(0.42 * dim);
          if (nFire) this.emitBudgeted("fire", fire, at.x, at.y, nFire * (p.lx === 0 && p.ly === 0 ? 2 : 1));
          if (nSmoke) this.emitBudgeted("smoke", smoke, at.x, at.y, nSmoke);
        }
      } finally {
        this.trailFxLife = prevLife;
        this.dmgFlameScale = prevDmg;
      }
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
    const nFire = this.fxEmitCount((f.trailOnly ? 0.85 : 0.7) * dim);
    const nSmoke = this.fxEmitCount((f.trailOnly ? 0.65 : 0.5) * dim);
    if (nFire) {
      this.withTrailFx(sc, () => this.emitBudgeted("fire", fire, p.x, p.y, nFire), lifeMul);
    }
    if (nSmoke) {
      this.withTrailFx(smokeSc, () => this.emitBudgeted("smoke", puff, p.x, p.y, nSmoke), lifeMul);
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
    const { fire, smoke } = this.pairHurtFx(f.z, f.y, this.flame, this.hurtSmoke);
    const airMul = f.heliCrash ? 1.65 : 1;
    for (const s of f.dmgFlames) {
      const p = spriteUvPos(spr, s.u, s.v);
      this.withDmgFlameScale(s.scale * dim * airMul, () => {
        const nFire = this.fxEmitCount(0.72 * dim);
        const nSmoke = this.fxEmitCount(0.35 * dim);
        if (nFire) this.emitBudgeted("fire", fire, p.x, p.y, nFire * 2);
        if (nSmoke) this.emitBudgeted("smoke", smoke, p.x, p.y, nSmoke);
      });
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

  /** Same slot pooling as fxAt, but depth matches hull sprites (worldDepth), not FX bands. */
  fxAtWorld(
    z: number,
    y: number,
    proto: Phaser.GameObjects.Particles.ParticleEmitter,
    off: number
  ): Phaser.GameObjects.Particles.ParticleEmitter {
    const em = this.fxSlot(proto, z, y).emitter;
    const d = worldDepth(z, off, y);
    if (em.depth !== d) em.setDepth(d);
    return em;
  }

  /**
   * Hurt fire + smoke on the same world-depth stack as hull sprites:
   * body (0 / +posted) < smoke < fire < rotor. No FX-band rounding.
   */
  pairHurtFx(
    z: number,
    y: number,
    fireProto: Phaser.GameObjects.Particles.ParticleEmitter,
    smokeProto: Phaser.GameObjects.Particles.ParticleEmitter,
    zBias = 0
  ): { fire: Phaser.GameObjects.Particles.ParticleEmitter; smoke: Phaser.GameObjects.Particles.ParticleEmitter } {
    return {
      fire: this.fxAtWorld(z, y, fireProto, ZOff.dmg + zBias),
      smoke: this.fxAtWorld(z, y, smokeProto, ZOff.hurtSmoke + zBias),
    };
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
    // Lift flame one band so smoke left in the neighbouring band (trail crossing bands) stays under it.
    const fd = this.fxBandDepth(fireSlot.band, fOff) + this.fxBandH;
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
    n: number,
    /** Impact bursts: don't let lingering trail particles starve the new fireball. */
    prefer = false
  ): number {
    const policy = this.fxPolicies[kind];
    if (n <= 0 || policy.emitted >= policy.frameCap) return 0;
    const activeRoom = prefer
      ? Math.max(n, policy.activeCap - this.fxAlive(kind))
      : policy.activeCap - this.fxAlive(kind);
    const take = Math.min(n, policy.frameCap - policy.emitted, Math.max(0, activeRoom));
    if (take <= 0) return 0;
    policy.emitted += take;
    const scale = this.lastSimScale;
    if (em.timeScale !== (Number.isFinite(scale) ? scale : 1)) {
      em.timeScale = Number.isFinite(scale) ? scale : 1;
    }
    em.emitParticleAt(x, y, take);
    return take;
  }

  /**
   * Continuous FX rate → particle count, scaled by sim timeScale so slow-mo
   * spawns fewer particles per wall frame (same count per sim-second).
   */
  fxEmitCount(ratePerFrameAt1x: number): number {
    const s = this.lastSimScale;
    if (!Number.isFinite(s) || s <= 0 || ratePerFrameAt1x <= 0) return 0;
    const expected = ratePerFrameAt1x * s;
    let n = Math.floor(expected);
    if (Math.random() < expected - n) n++;
    return n;
  }

  /** Bernoulli form of fxEmitCount for the common single-particle trail case. */
  fxChance(p: number): boolean {
    return this.fxEmitCount(p) > 0;
  }

  withTrailFx(scale: number, fn: () => void, lifeMul = 1): void {
    const prev = this.trailFxScale;
    const prevLife = this.trailFxLife;
    const prevDmg = this.dmgFlameScale;
    this.trailFxScale = scale;
    this.trailFxLife = lifeMul;
    // Trails must not inherit leftover hull-damage flame scale.
    this.dmgFlameScale = 1;
    try {
      fn();
    } finally {
      this.trailFxScale = prev;
      this.trailFxLife = prevLife;
      this.dmgFlameScale = prevDmg;
    }
  }

  withDmgFlameScale(scale: number, fn: () => void): void {
    const prev = this.dmgFlameScale;
    this.dmgFlameScale = scale;
    try {
      fn();
    } finally {
      this.dmgFlameScale = prev;
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





  syncDebrisSprites(): void {
    let visN = 0;
    for (const f of this.debris) if (!f.trailOnly) visN++;
    while (this.debrisG.getLength() < visN * 2) {
      this.debrisG.add(this.add.image(0, 0, "fx_shadow"));
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
        sy = sc * 0.76;
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
          : f.boomBit
            ? worldDepth(z, ZOff.fire + 3.6, f.y)
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
        applyThermalHeat(im, this.thermalOn, f.settled ? 0.27 : 0.62);
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
        applyThermalHeat(im, this.thermalOn, f.settled ? 0.27 : 0.62);
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
        if (f.dishFlat) sh.setScale(sh.scaleX * 1.04, sh.scaleY * 0.76);
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
      // Casings: timed cool-down (not speed); ground stamp keeps a longer thermal mark.
      if (f.shellEject) {
        const shellHeat = (f.shellHeat ?? 0) * 0.72;
        if (shellHeat > 0.02) applyThermalHeat(im, this.thermalOn, shellHeat);
      } else {
        applyThermalHeat(im, this.thermalOn, f.settled ? 0.27 : 0.64);
      }
      if (im.depth !== depth) im.setDepth(depth);
    }
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
      this.syncAllThermalWreckMarks();
      this.countermeasures.syncSmokePuffSprites();
      this.postFx.apply();
      this.applyThermalFxBlendMode();
    } else {
      setThermalPipeline(cam, false);
      this.thermalFx?.reset();
      this.syncAllThermalWreckMarks();
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
    for (const kind of Object.keys(this.fxPolicies) as FxClass[]) {
      for (const em of this.fxPolicies[kind].emitters) {
        if (this.thermalOn) {
          if (!this.fxThermalSaved.has(em)) {
            this.fxThermalSaved.set(em, {
              blendMode: em.blendMode as Phaser.BlendModes | string,
              tintFill: em.tintFill,
            });
          }
          em.tintFill = true;
          em.setBlendMode(Phaser.BlendModes.NORMAL);
        } else {
          const saved = this.fxThermalSaved.get(em);
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
    for (const em of this.fxPolicies.fire.emitters) {
      em.forEachAlive((p) => {
        const age = 1 - Phaser.Math.Clamp(p.lifeCurrent / Math.max(1, p.life), 0, 1);
        p.tint = thermalSignalTint(Phaser.Math.Linear(1, 0.78, age));
      }, this);
    }
    for (const em of this.fxPolicies.short.emitters) {
      em.forEachAlive((p) => {
        p.tint = sparkTint;
      }, this);
    }
    for (const em of this.fxPolicies.dust.emitters) {
      em.forEachAlive((p) => {
        p.tint = dustTint;
      }, this);
    }
    for (const em of this.fxPolicies.smoke.emitters) {
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
    for (const slots of this.fxSlots.values()) {
      for (const em of slots) em.timeScale = s;
    }
    for (const policy of Object.values(this.fxPolicies)) {
      for (const em of policy.emitters) em.timeScale = s;
    }
    for (const em of [this.smoke, this.blastFire, this.heliDust]) {
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
    this.hudSet.delete(this.towWireGfx);
    this.towWireGfx.cameraFilter = this.hudCam.id | this.fieldHudCam.id;
    this.hudSet.delete(this.remoteBody.remoteAntennaGfx);
    this.remoteBody.remoteAntennaGfx.cameraFilter = this.hudCam.id | this.fieldHudCam.id;
    this.hudSet.delete(this.tesla.gfx);
    this.tesla.gfx.cameraFilter = this.hudCam.id | this.fieldHudCam.id;
    this.hudSet.delete(this.energyTrailGfx);
    this.energyTrailGfx.cameraFilter = this.hudCam.id | this.fieldHudCam.id;
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





  emitDamageFx(): void {
    const h = this.player;
    this.emitUnitDamageFx();
    this.remoteBody.emitRemoteDamageFx();
    const hp = h.health / h.spec.health;
    if (h.phase !== "dead" && hp < 0.98) {
      const want = hp < 0.25 ? 3 : hp < 0.45 ? 2 : hp < 0.75 ? 1 : 0;
      while (h.dmgSites.length > want) h.dmgSites.pop();
      while (h.dmgSites.length < want) {
        const uv = this.sampleSolidUv(h.spec.body, h.spec.radius);
        h.dmgSites.push({ ...uv, scale: range(0.42, 0.8) });
      }
      if (want) {
        const { fire, smoke } = this.pairHurtFx(h.z, h.y, this.hotFlame, this.playerHurtSmoke);
        for (const s of h.dmgSites) {
          const base = spriteUvPos(this.heliBodyDrawPose(), s.u, s.v);
          // Keep sparks on the damage pin — wide jitter reads as loose trail spray.
          const p = jitterDisk(base.x, base.y, 0.55 + s.scale * 0.4);
          this.withDmgFlameScale(s.scale * 1.65, () => {
            const nFire = this.fxEmitCount(0.48);
            const nSmoke = this.fxEmitCount(0.28);
            if (nFire) this.emitBudgeted("fire", fire, p.x, p.y, nFire);
            if (nSmoke) this.emitBudgeted("smoke", smoke, p.x, p.y, nSmoke);
          });
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
      const { fire, smoke } = this.pairHurtFx(u.z, u.y, this.flame, this.hurtSmoke, zBias);
      const sp = specOf(u.kind);
      const sizeMul = sp.aerial ? 1.65 : sp.building ? 1.15 : 1;
      for (const s of u.dmgSites) {
        const mount = this.mountAt(u, tex, { x: s.u, y: s.v });
        const base = worldToScreen(mount.x, mount.y, u.z);
        const p = jitterDisk(base.x, base.y, 0.5 + s.scale * 0.4);
        this.withDmgFlameScale(s.scale * sizeMul, () => {
          const nFire = this.fxEmitCount(0.45);
          const nSmoke = this.fxEmitCount(0.26);
          if (nFire) this.emitBudgeted("fire", fire, p.x, p.y, nFire);
          if (nSmoke) this.emitBudgeted("smoke", smoke, p.x, p.y, nSmoke);
        });
      }
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
      const hulk = this.playerCrashDebris;
      const cx = hulk?.x ?? this.player.x;
      const cy = hulk?.y ?? this.player.y;
      const cz = hulk?.z ?? this.player.z;
      return {
        x: (this.playerDeathLiveX + cx) * 0.5,
        y: (this.playerDeathLiveY + cy) * 0.5,
        z: (this.playerDeathLiveZ + cz) * 0.5,
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




















