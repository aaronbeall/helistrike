import Phaser from "phaser";
import { camoForBiome, resolveSkin } from "./camo";
import {
  debrisKeys,
  heightOf,
  hulkOf,
  nextId,
  radius,
  stats,
  textureOf,
  wheelDebrisKeys,
  playerLoadoutFromSockets,
  SHOT_ORIGIN,
  SHOT_TAIL,
  shotBehaviorOf,
  applyKineticCombatMix,
  payloadDustMul,
  payloadHeBlend,
  guidanceUsesLock,
  guidanceIsLockOn,
  exhaustIsEnergy,
  exhaustRibbons,
  exhaustHue,
  exhaustWarpMotes,
  exhaustIsSignalFlare,
  launchIsArcBeam,
  launchIsRayBeam,
  ENERGY_TRAIL_NODE_LIFE,
  HELIX_TRAIL_NODE_LIFE,
  PLAYER_WPNS,
  COUNTERMEASURES,
  craftCountermeasure,
  countermeasureTimingLabel,
  wpnIdOf,
  stunUnit,
  unitStunned,
  tickStunKinematics,
  recordUnitSpin,
  type Debris,
  type Shot,
  type ShotState,
  type SmokePuff,
  type SimParticle,
  type SimParticleKind,
  type Unit,
  type PlayerWpnSpec,
  type WpnId,
  type LockAcquire,
  type Flare,
  type EnergyTrailNode,
  type WeaponLaunch,
  type WeaponGravity,
  type WeaponGuidance,
  type WeaponPayload,
  type ShotBehavior,
  heatClassScore,
  heatClassCategory,
} from "./combat";

/** Gravity from drop / lobbed muzzle launch. */
function launchGravity(launch: WeaponLaunch | undefined): WeaponGravity | undefined {
  if (!launch) return undefined;
  if (launch.mode === "drop") return launch.gravity;
  if (launch.mode === "muzzle") return launch.gravity;
  return undefined;
}

function targetingMode(g: WeaponGuidance | undefined): WeaponGuidance["targeting"]["mode"] | undefined {
  return g?.targeting.mode;
}

function payloadIsRemote(p: WeaponPayload | undefined): boolean {
  return !!p?.remote;
}

function payloadIsCluster(p: WeaponPayload | undefined): boolean {
  return !!p?.cluster;
}

function payloadIsSmoke(p: WeaponPayload | undefined): boolean {
  return !!p?.smoke;
}

function payloadIsCallStrike(p: WeaponPayload | undefined): boolean {
  return !!p?.callStrike;
}

function payloadIsHostFire(p: WeaponPayload | undefined): boolean {
  return !!p?.hostFire?.weapon;
}

function payloadIsHelix(p: WeaponPayload | undefined): boolean {
  return !!p?.helix;
}

/** HE explode path: authored detonate, or HE without needing kinetic pen. */
function payloadIsHe(p: WeaponPayload | undefined): boolean {
  return !!p?.detonate;
}

/** Gun kinetic / penetrator path (not beam). */
function payloadIsKinetic(p: WeaponPayload | undefined, launch?: WeaponLaunch): boolean {
  if (!p) return false;
  if (p.penetration != null) return true;
  if (launch?.mode === "beam") return false;
  return (
    !p.detonate &&
    !p.cluster &&
    !p.smoke &&
    !p.remote &&
    !p.warp &&
    !p.helix &&
    !p.stun &&
    !p.callStrike &&
    !p.hostFire
  );
}

/** Shell-ejecting player guns. */
function specIsShellGun(spec: PlayerWpnSpec): boolean {
  if (spec.launch.mode !== "muzzle" || spec.guidance) return false;
  const p = spec.payload;
  if (
    payloadIsHelix(p) ||
    p.remote ||
    p.warp ||
    p.cluster ||
    p.smoke ||
    p.stun ||
    p.callStrike ||
    p.hostFire
  )
    return false;
  // Kinetic (incl. empty / no pen) or HE shell guns.
  return payloadIsKinetic(p, spec.launch) || !!p.detonate;
}

/** Unguided Hydra-style rocket pod (muzzle + rocket smoke, no guidance). */
function specIsRocketPod(spec: PlayerWpnSpec): boolean {
  const ex = spec.exhaust;
  return (
    spec.launch.mode === "muzzle" &&
    !spec.guidance &&
    !!ex &&
    ex.kind === "particles" &&
    ex.smoke === "rocket"
  );
}

/** One laser at the average of multi-barrel / multi-gun emit tips. */
function collapseSightTips<T extends { x: number; y: number }>(tips: T[]): T[] {
  if (tips.length <= 1) return tips;
  let sx = 0;
  let sy = 0;
  for (const t of tips) {
    sx += t.x;
    sy += t.y;
  }
  const n = tips.length;
  const head = tips[0]!;
  return [{ ...head, x: sx / n, y: sy / n }];
}

/**
 * Hardpoint pylon phase from ammo count.
 * Fire spends first then indexes with remaining (`afterSpend`);
 * sight uses loaded count so the laser matches the *next* shot, not the last.
 */
function hardpointAmmoIndex(
  ammo: number,
  mountCount: number,
  afterSpend = false
): number {
  if (mountCount <= 1) return 0;
  // After spend with remaining R: (R - 1) % n
  // Before spend with loaded A: same pylon as fire will use → (A - 2) % n
  const phase = afterSpend ? ammo - 1 : ammo - 2;
  return ((phase % mountCount) + mountCount) % mountCount;
}

/** Plane hardpoint / drop look-ahead boost (host + remote POV). */
function planeLookCam(
  spec: PlayerWpnSpec,
  isPlane: boolean
): { pull: number; max: number; rate: number } {
  const look = spec.cam.look;
  if (
    isPlane &&
    spec.cam.planeLookMul !== false &&
    (spec.guidance != null || spec.launch.mode === "drop" || !!spec.exhaust)
  ) {
    return { pull: look.pull * 1.22, max: look.max * 1.28, rate: look.rate };
  }
  return { pull: look.pull, max: look.max, rate: look.rate };
}

function shotIsGunOrBeam(s: Shot): boolean {
  if (s.beh) {
    return (
      s.beh.launch.mode === "beam" ||
      (s.beh.launch.mode === "muzzle" && !s.beh.guidance && !s.beh.exhaust)
    );
  }
  return !s.homePlayer && s.motor == null && !s.energyTrail && !s.energyTrails;
}

function shotFacesHeading(s: Shot): boolean {
  if (s.beh?.art.face === "heading") return true;
  if (s.beh?.art.face === "velocity") return false;
  return !!(s.homePlayer || s.motor != null);
}

import {
  initRemoteLoadout,
  remoteGunId,
  remoteHasPovHud,
  remoteRotorParts,
  remoteRotorPoolSize,
  remoteSocketStartingAmmo,
  remoteSpecOf,
  type RemoteCraft,
} from "./remote";
import {
  aimInStationArc,
  clampAimToStationArc,
  heatCategoryOk,
  heatClassOf,
  heatSeekScore,
  smokeCoverAt,
  smokeVisionMul,
  type StationTraverse,
} from "./weaponRuntime";
import { Layer, ZOff, Z_GRAVITY, worldDepth } from "./depth";
import { range } from "./rng";
import { CRUISE_AGL, Heli, JET_GUN_MAX_DEPRESS, JET_GUN_MAX_ELEV, LOW_AGL, MAX_AGL, MAP_AIR_SOFT, craftCameraEdgeLocked } from "./heli";
import {
  TOON_BLAST_VARIANTS,
  toonBlastAnimKey,
  toonBlastKey,
} from "./toonBlast";
import { ensureAllArtGenAnims } from "./artGen";
import { isAerial, isGroundVehicle, isOrganic, hasSoftBlood, specOf, driveOf, spawnAngle, pickTroop, labelOf, allKinds, gunsOf, rollParts, crewOf, muzzlesOfGun, type ShotKind, type ShotLook } from "./roster";
import {
  circumRadiusOf,
  closestOnFootprint,
  distToFootprint,
  footprintInto,
  footprintOf,
  footprintOverlap,
  pointInFootprint,
  randomInFootprint,
  type Footprint,
} from "./footprint";
import { lookupSpriteMuzzles, lookupSpriteOrigin, lookupSpritePoints } from "./spriteOrigin";
import { allCrafts, craftAgility, craftAimsWithTurret, craftBombDrop, craftCameraScale, craftCloudParallax, craftComposite, craftCompositePartScale, craftCrewHudTag, craftExhaustFlameHue, craftExhaustFlameSheet, craftExhaustMounts, craftFixedMuzzles, craftGunMount, craftGunMounts, craftGunOrigin, craftGunPreferDegrees, craftGunPreferOffset, craftGunSocketSlots, craftHardpointMounts, craftControlScheme, craftLoadoutLabel, craftOf, craftOrigin, craftPreviewExhaustScale, craftPreviewExhaustTint, craftPreviewFitScale, craftRotorAlongScale, craftRotorFlightSpeed, craftRotorIsProp, craftRotorMounts, craftRotorPreviewSpinMs, craftRotorTiltMul, craftSocketBarrelCount, craftSocketFireCd, craftSocketIsPrimary, craftSocketMultiplicity, craftSocketPoints, craftSocketStartingAmmo, craftWingTipMounts, rotorDrawSpan, rotorMountsOf, rotorSpinSign, socketPointsOnKey, type CraftBombDrop, type CraftComposite } from "./craft";
import { missionOf } from "./mission";
import { HEIGHT_BRUSHES, bakeHeightBrushes } from "./brushes";
import { rigsAnyOpen, installRigHotkeys } from "./rigs";
import { applyEdgeLight, clearEdgeLight, ensureEdgeLightPipeline } from "./edgeLight";
import { setThermalPipeline, type ThermalPalette } from "./thermal";
import { setGlitchPipeline } from "./glitch";
import { setWarpDistortPipeline } from "./warpDistort";
import { setCloakFxPipeline } from "./cloakFx";
import { createTerrain25D, type Terrain25D } from "./terrain25d";
import { tipKnownFromSelection, tipsForKnown, type TacticalTip } from "./tips";
import { extractBiomeTiles, bakeHeliHudWireTexture, heliHudWireUv, shadowAlpha, shadowKey, spriteUvPos, FX_SHEET_SIZE, FX_VARIANTS, FX_BLAST_CELLS, registerArt, nameGameTexture, spritePivot, muzzleGlowKey, ensureExhaustGlow, type HeliHudWireBake } from "./sprites";
import { createControlLegend } from "./menuChrome";
import {
  generateWorld,
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
/** Player chin / cabin traverse rate (rad/s) — also used by crew-served auto stations. */
const GUN_STATION_TURN_RATE = 6.4;
/** Auto fire once the barrel is within this angle of the track (radians). */
const AUTO_GUN_ALIGN_TOL = 0.14;
/** Score penalty per radian off the barrel's preferred (mount-outward) heading. */
const AUTO_GUN_HEADING_WEIGHT = 900;
/** Shift each barrel's acquire circle along prefer heading by this fraction of range. */
const AUTO_GUN_RANGE_BIAS = 0.3;
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

/** Overlay guns are drawn barrel-up (same as hulls). World aim 0 is +X, so +90°. */
function gunWorldRot(_tex: string, aim: number): number {
  return aim + Math.PI / 2;
}

/** Apache M230 cadence is the full-density reference for per-shot muzzle/impact particles. */
const PROJECTILE_FX_BASE_INTERVAL = 0.07;
const ENEMY_PROJECTILE_FX_MUL = 0.72;
/** M230 chain gun — muzzle FX size reference (`spec.art.scale` / `blast`). */
const MUZZLE_FX_REF_SCALE = 0.56;
const MUZZLE_FX_REF_BLAST = 36;
const TESLA_STREAMS = 3;
const TESLA_SEGS = 14;
const TESLA_HEAD_SPEED = 1750;
const TESLA_LOCK_REACH = 26;
/** Extra linger seconds per second the arc stays locked on a target. */
const TESLA_STUN_EXPOSE_MUL = 0.9;
/** Cap on post-arc stun linger. */
const TESLA_STUN_MAX = 4;
/** Original zap bake size the Tesla stamp scales were tuned against. */
const TESLA_ZAP_REF = 28;
const teslaZapScale = (mul: number) => mul * (TESLA_ZAP_REF / FX_SHEET_SIZE.zap);

/** Survives MissionScene restart (R → load → mission). */
let persistedFxOn = true;

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

function projectileFxScale(from: Shot["from"], effectiveInterval = PROJECTILE_FX_BASE_INTERVAL): number {
  const cadence = Phaser.Math.Clamp(effectiveInterval / PROJECTILE_FX_BASE_INTERVAL, 0.18, 1);
  return cadence * (from === "enemy" ? ENEMY_PROJECTILE_FX_MUL : 1);
}

/** Parse `30MM` / `.50 CAL` from a catalog designation. */
function caliberMmFromDesignation(designation: string): number | undefined {
  const mm = designation.match(/(\d+(?:\.\d+)?)\s*MM\b/i);
  if (mm) return Number(mm[1]);
  const cal = designation.match(/\.(\d+)\s*CAL/i);
  if (cal) return Number(cal[1]) * 0.254;
  return undefined;
}

/** Player gun muzzle FX vs M230 — LMGs smaller, heavies a bit larger. */
function playerMuzzleFxMul(spec: PlayerWpnSpec): number {
  const byScale = Math.pow(spec.art.scale / MUZZLE_FX_REF_SCALE, 0.7);
  const byBlast = Math.pow(Math.max(0.5, spec.blast) / MUZZLE_FX_REF_BLAST, 0.25);
  return Phaser.Math.Clamp(byScale * byBlast, 0.4, 1.35);
}

function thermalSignalTint(heat: number): number {
  const signal = Phaser.Math.Clamp(Math.round((0.06 + heat * 0.94) * 255), 0, 255);
  // Magenta is an internal semantic heat signal. The thermal post shader decodes
  // it to white-hot; this separates authored heat from bright terrain albedo.
  return (signal << 16) | signal;
}

function applyThermalHeat(
  image: Phaser.GameObjects.Image,
  enabled: boolean,
  heat: number,
  normalTint?: number
): void {
  if (enabled) image.setTintFill(thermalSignalTint(heat));
  else {
    image.clearTint();
    if (normalTint != null) image.setTint(normalTint);
  }
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
  { action: "relief", label: "Terrain editor", shortcut: "B" },
  { action: "camera", label: "Camera…" },
  { action: "spawn", label: "Spawn…" },
] as const;

const CAMERA_PRESETS = [
  { name: "SUBTLE", pitch: 0.025, cam: 1300, zoom0: 1.45 },
  { name: "CURRENT", pitch: 0.05, cam: 900, zoom0: 1.45 },
  { name: "DRAMATIC", pitch: 0.09, cam: 600, zoom0: 1.45 },
] as const;

function shotLookOf(s: Shot): ShotLook {
  if (!s.look) throw new Error(`shot ${s.id ?? "?"} missing look`);
  return s.look;
}

/** Soft rim where map-edge steering ramps up. */
const MAP_EDGE_MARGIN = 280;
/** Hard pad ground units cannot cross. */
const MAP_EDGE_PAD = 40;
/** How far aircraft may overshoot before a soft cap (jets / enemy air) — see heli.MAP_AIR_SOFT. */

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
  world!: WorldData;
  heli!: Heli;
  units: Unit[] = [];
  shots: Shot[] = [];
  debris: Debris[] = [];
  simParticles: SimParticle[] = [];
  loadout: PlayerWpnSpec[] = playerLoadoutFromSockets(craftOf().sockets);
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
  /** Additive tip heat glows paired 1:1 with turret `guns` (not fixed muzzles). */
  gunHeatGlows: Phaser.GameObjects.Image[] = [];
  /** Tip glow heat 0–1 (snap on fire, ~9s fade). */
  gunTipHeat: number[] = [];
  shadow!: Phaser.GameObjects.Image;
  reticle!: Phaser.GameObjects.Image;
  reticleMark!: Phaser.GameObjects.Graphics;
  sight!: Phaser.GameObjects.Graphics;
  lockGfx!: Phaser.GameObjects.Graphics;
  towWireGfx!: Phaser.GameObjects.Graphics;
  remoteAntennaGfx!: Phaser.GameObjects.Graphics;
  teslaGfx!: Phaser.GameObjects.Graphics;
  energyTrailGfx!: Phaser.GameObjects.Graphics;
  /** Neon ribbons that keep fading after the dart is gone. */
  energyLinger: EnergyTrailNode[][] = [];
  cmGfx!: Phaser.GameObjects.Graphics;
  lockTxt!: Phaser.GameObjects.Text;
  lockInbdTxt!: Phaser.GameObjects.Text;
  /** Pooled range labels for in-flight GPS / waypoint aim marks. */
  gpsDistTxt: Phaser.GameObjects.Text[] = [];
  lockArrowGfx!: Phaser.GameObjects.Graphics;
  lockHudTxt!: Phaser.GameObjects.Text;
  lockInbdHudTxt!: Phaser.GameObjects.Text;
  unitG!: Phaser.GameObjects.Group;
  shotG!: Phaser.GameObjects.Group;
  /** Additive Photon lens-flare layers (glow / streams / core). */
  photonFxG!: Phaser.GameObjects.Group;
  debrisG!: Phaser.GameObjects.Group;
  simParticleG!: Phaser.GameObjects.Group;
  smokePuffG!: Phaser.GameObjects.Group;
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
  /** Big boom dirt streaks — long travel needles that keep size while they fall. */
  bigBoomDirtBurst!: Phaser.GameObjects.Particles.ParticleEmitter;
  /** Cyan blur streaks for Starstreak breaks. */
  energyStreakBurst!: Phaser.GameObjects.Particles.ParticleEmitter;
  /** Tesla impact needles — omnidirectional, high-drag, frozen heading. */
  teslaSparkBurst!: Phaser.GameObjects.Particles.ParticleEmitter;
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
  /** Plane-remote nozzle flame/glow (Raptor) — pooled across remotes each frame. */
  remoteExhaustFlames: Phaser.GameObjects.Image[] = [];
  remoteExhaustGlows: Phaser.GameObjects.Image[] = [];
  remoteExhaustVisCursor = 0;
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
  /** Effective world rate this frame (debug scale × timewarp / stinger / warp shots). */
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
    /** Craft-local tip when no UV/gun (e.g. missile pylon). */
    localX?: number;
    localY?: number;
    /** Absolute world tip (remote guns — not parented to the host craft). */
    worldX?: number;
    worldY?: number;
    worldZ?: number;
  }[] = [];
  muzzleCursor = 0;
  playerGunSide = 0;
  /** Per-weapon fire index for combat-mix HE rounds (Avenger 1-in-5). */
  cannonMixRound: Record<string, number> = {};
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
  /** Camera post-FX (toggle with F). */
  fxBloom?: Phaser.FX.Bloom;
  fxBarrel?: Phaser.FX.Barrel;
  thermalFx?: Phaser.FX.ColorMatrix;
  thermalOn = false;
  /** Player toggled thermal with T (persists across sensor-view overlays). */
  thermalManual = false;
  thermalPalette: ThermalPalette = "white_hot";
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
  spectrePrompt!: Phaser.GameObjects.Text;
  spectreArmedTxt!: Phaser.GameObjects.Text;
  hvHud!: Phaser.GameObjects.Text;
  hvRows: Phaser.GameObjects.Text[] = [];
  wpnHud!: Phaser.GameObjects.Text;
  wpnBar!: Phaser.GameObjects.Graphics;
  /** Per-loadout-slot HUD chrome: key / name / ammo + optional crew status under the box. */
  wpnHudSlots!: {
    key: Phaser.GameObjects.Text;
    name: Phaser.GameObjects.Text;
    ammo: Phaser.GameObjects.Text;
    status: Phaser.GameObjects.Text;
  }[];
  /** Extra HUD chrome for POV remotes — Q to exit back to the bird. */
  exitHudSlot!: {
    key: Phaser.GameObjects.Text;
    name: Phaser.GameObjects.Text;
  };
  /** POV remotes with host escort — F toggles FOLLOW / HOLD. */
  escortHudSlot!: {
    key: Phaser.GameObjects.Text;
    name: Phaser.GameObjects.Text;
  };
  /** Countermeasure prompt under the weapon slots. */
  cmHudLabel!: Phaser.GameObjects.Text;
  cmHudTime!: Phaser.GameObjects.Text;
  hpGfx!: Phaser.GameObjects.Graphics;
  playerHud!: Phaser.GameObjects.Graphics;
  heliHudWire!: Phaser.GameObjects.Image;
  heliHudWireSh!: Phaser.GameObjects.Image;
  heliHudWireScale = 1;
  heliHudWireBake: HeliHudWireBake = { w: 1, h: 1, pivot: { x: 0.5, y: 0.5 }, srcW: 1, srcH: 1, cropX: 0, cropY: 0 };
  /** Soft OOF blood edges (under). */
  hurtVignette!: Phaser.GameObjects.Image;
  /** Static window cracks (over). */
  hurtVignettePulse!: Phaser.GameObjects.Image;
  mapLabel!: Phaser.GameObjects.Text;
  mapHvLabels: Phaser.GameObjects.Text[] = [];
  hvArrowLabels: Phaser.GameObjects.Text[] = [];
  /** Yellow edge cue back to host while piloting a remote POV. */
  parentArrowLabel!: Phaser.GameObjects.Text;
  miniGfx!: Phaser.GameObjects.Graphics;
  miniBg!: Phaser.GameObjects.Graphics;
  miniTerrain!: Phaser.GameObjects.Image;
  miniWrecks!: Phaser.GameObjects.Image;
  miniMask!: Phaser.GameObjects.Graphics;
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
  /** Player is actively flying a remote (WASD owned by remote, not host). */
  remotePilotActive = false;
  /** Camera + WASD are on the live remote (independent of which weapon is selected). */
  remoteView = false;
  /**
   * Shadow `Heli` for plane-scheme remotes (Raptor) — same flight path as player craft.
   * Keyed by remote id; dropped on dock / detonate / mission reset.
   */
  remotePilotCraft = new Map<number, Heli>();
  /** Host craft escort while piloting a POV remote — default hold. */
  hostEscortMode: "hold" | "follow" = "hold";
  /** Follow leash hysteresis — true while closing to the inner ring after breaking outer. */
  hostEscortSeeking = false;
  /** 0 = heli cam, 1 = remote cam. Eased when entering / leaving Spectre view. */
  remoteCamT = 0;
  remotes: RemoteCraft[] = [];
  remoteG!: Phaser.GameObjects.Group;
  teslaZapPool: Phaser.GameObjects.Image[] = [];
  teslaZaps: { im: Phaser.GameObjects.Image; t: number; max: number }[] = [];
  teslaSegPool: Phaser.GameObjects.Image[] = [];
  teslaGlowPool: Phaser.GameObjects.Image[] = [];
  teslaHeadZapPool: Phaser.GameObjects.Image[] = [];
  /** Live Tesla barrel→head ribbon while the trigger is held. */
  teslaLive: {
    ox: number;
    oy: number;
    oz: number;
    tx: number;
    ty: number;
    tz: number;
    hx: number;
    hy: number;
    hz: number;
    targetId?: number;
  } | null = null;
  teslaHead: { x: number; y: number; z: number } | null = null;
  teslaLockId?: number;
  /** How long the live arc has been on the current stun target. */
  teslaExposeT = 0;
  /** Unit id currently accumulating Tesla exposure. */
  teslaExposeId?: number;
  /** Sim-time clock for Tesla helix / flicker (seconds). */
  teslaAnimT = 0;
  keyE!: Phaser.Input.Keyboard.Key;
  cmCd = 0;
  flares: Flare[] = [];
  timewarpT = 0;
  timewarpMax = 0;
  cloakT = 0;
  cmPulseT = 0;
  reactiveArmorT = 0;
  smokeScreenT = 0;
  empGlitchT = 0;
  empGlitchMax = 0;
  empBurstT = 0;
  empBurst: { x: number; y: number; z: number; radius: number } | null = null;
  povCamLookX = 0;
  povCamLookY = 0;
  /** Rising-edge pointer tracking for click / release weapon controls. */
  pointerWasDown = false;
  /** Latched GPS / designate aim point while holding designate_then_release. */
  designateLatch: { x: number; y: number } | null = null;
  /** Timed salvo rounds queued after the first instantaneous fire. */
  pendingSalvos: {
    t: number;
    slot: number;
    wpnId: string;
    yawOff: number;
    gx?: number;
    gy?: number;
    autoTargetId?: number;
    barrel?: number;
    helixPhase?: number;
  }[] = [];
  /**
   * Active call-strike marks (flare settled → off-map barrage).
   * Payload-driven; any craft weapon with `callStrike` can arm one.
   */
  callStrikeMarks: {
    id: number;
    x: number;
    y: number;
    z: number;
    /** Countdown to first shell (from `callStrike.delay`; 0 = immediate). */
    delayT: number;
    roundsLeft: number;
    interval: number;
    intervalT: number;
    jitter: number;
    shellDmg: number;
    shellBlast: number;
    shellLook: string;
    shellSpeed: number;
    /** Fixed off-map origin for this barrage's shells (target X + map width). */
    spawnX: number;
    spawnY: number;
    spawnZ: number;
    /** Shells that have already impacted. */
    hitsLanded: number;
    /** Keep flare FX until this many hits. */
    flareUntilHits: number;
    /** Countdown to first shell impact — ETA label hides when this hits 0. */
    firstImpactEta: number;
    /**
     * When set (HOUND / POV observer), each round fires this host craft weapon
     * at the mark instead of a synthetic off-map shell.
     */
    hostWeapon?: string;
    /** Host-walk aim oscillator (seconds). */
    wobbleT?: number;
    /** Live slew/fire point — wobbles around the mark for host howitzer walks. */
    aimX?: number;
    aimY?: number;
  }[] = [];
  nextCallStrikeMarkId = 1;
  /** Pooled ETA labels for live call-strike flares. */
  callStrikeEtaTxt: Phaser.GameObjects.Text[] = [];
  /** Fading Refractor beam segments (solid glowy lines). */
  refractorBeams: {
    x0: number;
    y0: number;
    z0: number;
    x1: number;
    y1: number;
    z1: number;
    life: number;
    max: number;
    width: number;
    color: number;
  }[] = [];
  refractorGfx!: Phaser.GameObjects.Graphics;
  /** Per-slot, per-barrel cooldown for automatic / crew stations. */
  stationFireCd: number[][] = [];
  /**
   * Screen-smoke actors. Game objects (own sprite + overlap), not FX-budget
   * particles — they are never emitBudgeted / frame-capped / recycled mid-life.
   */
  smokePuffs: (SmokePuff & { spr: Phaser.GameObjects.Image })[] = [];
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
  /** Tips filtered to the current craft / loadout / mission enemies. */
  missionTips: TacticalTip[] = [];
  helpRoot!: Phaser.GameObjects.Container;
  helpBody!: Phaser.GameObjects.Text;
  helpCounter!: Phaser.GameObjects.Text;
  helpCraftBody!: Phaser.GameObjects.Image;
  helpCraftGuns: Phaser.GameObjects.Image[] = [];
  helpCraftGunParts: CraftComposite["guns"] = [];
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
  /** Last-frame auto / crew-gun track snapshot for AI debug overlay. */
  autoGunDbg: {
    slot: number;
    barrel: number;
    aim: number;
    want: number | null;
    targetId: number | null;
    /** Acquire / engage radius used by this station (world units). */
    range: number;
    /** Acquire circle center (per-barrel, heading-biased). */
    originX: number;
    originY: number;
    /** Craft heading used for traverse arc math. */
    heading: number;
    /** Socket traverse (center filled from mount); omit = full circle. */
    traverse?: StationTraverse;
    state: string;
  }[] = [];
  autoGunLabels: Phaser.GameObjects.Text[] = [];
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
    this.stingerQueue = [];
    this.playerCrashDebris = undefined;
    this.endPromptRoot = undefined;
    this.fxBloom = undefined;
    this.fxBarrel = undefined;
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
    this.canFire = false;
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
    this.debugHit = false;
    this.debugBlast = false;
    this.blastRings = [];
    this.fxOn = persistedFxOn;
    this.thermalOn = false;
    this.thermalManual = false;
    this.thermalPalette = "white_hot";
    this.fxBarrelPulse = 0;
    this.pendingSalvos = [];
    this.callStrikeMarks = [];
    this.nextCallStrikeMarkId = 1;
    this.callStrikeEtaTxt = [];
    this.refractorBeams = [];
    this.remotes = [];
    this.remotePilotCraft.clear();
    this.remoteView = false;
    this.remoteCamT = 0;
    this.hostEscortMode = "hold";
    this.hostEscortSeeking = false;
    this.flares = [];
    this.teslaZaps = [];
    this.teslaLive = null;
    this.teslaHead = null;
    this.teslaLockId = undefined;
    this.teslaExposeT = 0;
    this.teslaExposeId = undefined;
    this.teslaAnimT = 0;
    this.cmCd = 0;
    this.timewarpT = 0;
    this.timewarpMax = 0;
    this.cloakT = 0;
    this.cmPulseT = 0;
    this.reactiveArmorT = 0;
    this.smokeScreenT = 0;
    this.empGlitchT = 0;
    this.empGlitchMax = 0;
    this.empBurstT = 0;
    this.empBurst = null;
    this.showHeightMap = false;
    this.terrainMesh = true;
    this.helpOpen = false;
    this.helpPage = 0;
    this.missionTips = [];
    this.exitOpen = false;
    this.debugOpen = false;
    this.debugSpawnOpen = false;
    this.debugCamOpen = false;
    this.noDamage = false;
    this.infAmmo = false;
    this.debugAi = false;
    this.autoGunDbg = [];
    this.editOpen = false;
    this.editInvert = false;
    this.editDirty = null;
    this.shots = [];
    this.energyLinger = [];
    this.debris = [];
    this.simParticles = [];
    this.smokePuffs = [];
    this.gpsDistTxt = [];
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
    this.playerGunSide = 0;
    this.cannonMixRound = {};
    const selectedCraft = craftOf();
    this.loadout = playerLoadoutFromSockets(selectedCraft.sockets);
    this.ammo = this.loadout.map((weapon, i) =>
      craftSocketStartingAmmo(weapon.ammo, selectedCraft, i)
    );
    this.stationFireCd = this.loadout.map((_, i) =>
      Array.from({ length: craftSocketBarrelCount(selectedCraft, i) }, () => 0)
    );
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
    this.canFire = !this.input.activePointer.isDown;
    this.input.on("pointerup", () => {
      this.canFire = true;
    });
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      if (this.debugOpen || this.helpOpen || this.exitOpen || this.editOpen || this.mapView) return;
      if (p.rightButtonDown()) this.exitRemoteView();
    });

    this.physics.world.setBounds(0, 0, WORLD, WORLD);
    this.cameras.main.setBounds(0, 0, WORLD, WORLD);
    this.cameras.main.setBackgroundColor("#6a8496");
    this.setupTestPostFx();

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
    this.shotG = this.add.group();
    this.photonFxG = this.add.group();
    this.remoteG = this.add.group();
    this.debrisG = this.add.group();
    this.simParticleG = this.add.group();
    this.smokePuffG = this.add.group();
    this.thermalHotspotG = this.add.group();

    this.heli = new Heli(this.world.spawnX, this.world.spawnY, this.world);
    if (this.heli.spec.flightModel === "plane") {
      const inward = Math.atan2(WORLD * 0.5 - this.heli.y, WORLD * 0.5 - this.heli.x);
      this.heli.startAirborne(inward, this.world);
    } else {
      this.heli.angle = 0.6;
      this.heli.syncStationAimToHull();
    }
    this.createLeaveTheaterSky();
    this.createPlaneCloudParallax();
    setCamera25DFocus(this.heli.x, this.heli.y, this.heli.z);
    const craft = this.heli.spec;
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
    this.body.setPosition(this.heli.x, this.heli.y);
    this.reticle = this.add.image(0, 0, "mark_reticle").setDepth(Layer.HUD).setScrollFactor(0);
    this.reticleMark = this.add.graphics().setDepth(Layer.HUD).setScrollFactor(0);
    this.sight = this.add.graphics().setDepth(Layer.WORLD);
    this.lockGfx = this.add.graphics().setDepth(Layer.FIELD).setVisible(false);
    this.towWireGfx = this.add.graphics().setDepth(Layer.WORLD);
    this.remoteAntennaGfx = this.add.graphics().setDepth(Layer.WORLD);
    this.teslaGfx = this.add.graphics().setDepth(Layer.WORLD).setBlendMode(Phaser.BlendModes.ADD);
    this.energyTrailGfx = this.add.graphics().setDepth(Layer.WORLD).setBlendMode(Phaser.BlendModes.ADD);
    this.refractorGfx = this.add.graphics().setDepth(Layer.WORLD).setBlendMode(Phaser.BlendModes.ADD);
    this.cmGfx = this.add.graphics().setDepth(Layer.WORLD).setBlendMode(Phaser.BlendModes.ADD);
    this.teslaZapPool = [];
    for (let i = 0; i < 28; i++) {
      this.teslaZapPool.push(
        this.add.image(0, 0, "fx_zap", 0).setVisible(false).setBlendMode(Phaser.BlendModes.ADD)
      );
    }
    this.teslaSegPool = [];
    for (let i = 0; i < TESLA_STREAMS * TESLA_SEGS; i++) {
      this.teslaSegPool.push(
        this.add.image(0, 0, "fx_zap", 0).setVisible(false).setBlendMode(Phaser.BlendModes.ADD)
      );
    }
    this.teslaGlowPool = [];
    const glowKeys = [
      "fx_tesla_halo",
      "fx_tesla_glow",
      "fx_tesla_halo",
      "fx_tesla_halo",
      "fx_tesla_glow",
      "fx_tesla_halo",
    ];
    for (const key of glowKeys) {
      this.teslaGlowPool.push(
        this.add.image(0, 0, key).setVisible(false).setBlendMode(Phaser.BlendModes.ADD)
      );
    }
    this.teslaHeadZapPool = [];
    for (let i = 0; i < 3; i++) {
      this.teslaHeadZapPool.push(
        this.add.image(0, 0, "fx_zap", i).setVisible(false).setBlendMode(Phaser.BlendModes.ADD)
      );
    }
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
    this.rebuildMissionTips();

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
    const burstStretchOf = (p: BurstParticle): number => {
      const spd = Math.hypot(p.velocityX || p.burstVx || 0, p.velocityY || p.burstVy || 0);
      const raw = Math.min(3.8, 1 + spd * 0.0052);
      const mul = this.burstLaunch.stretchMul;
      return 1 + (raw - 1) * mul;
    };
    this.shortBurst = this.poolFx("short", () =>
      this.add.particles(0, 0, "fx_spark", {
        lifespan: { onEmit: (p) => seedBurst(p, 220, 640) },
        speedX: { onEmit: burstVelocityX },
        speedY: { onEmit: burstVelocityY },
        scaleX: {
          onEmit: (p) => {
            const q = p as BurstParticle;
            q.launchScale = this.burstLaunch.scale * range(0.72, 1.18);
            q.launchStretch = burstStretchOf(q);
            return q.launchScale * q.launchStretch * range(1.2, 1.55);
          },
          onUpdate: (p, _k, t) => {
            const q = p as BurstParticle;
            return (q.launchScale ?? 1) * burstStretchOf(q) * (1 - t);
          },
        },
        scaleY: {
          onEmit: (p) => {
            const q = p as BurstParticle;
            const stretch = q.launchStretch ?? burstStretchOf(q);
            return (q.launchScale ?? this.burstLaunch.scale) * (0.36 / Math.max(0.55, Math.sqrt(stretch)));
          },
          onUpdate: (p, _k, t) => {
            const q = p as BurstParticle;
            const stretch = burstStretchOf(q);
            return (q.launchScale ?? 1) * (0.36 / Math.max(0.55, Math.sqrt(stretch))) * (1 - t);
          },
        },
        alpha: { start: 1, end: 0 },
        blendMode: "ADD",
        tint: [0xfff8d0, 0xffee66, 0xffaa40],
        gravityY: 180,
        radial: false,
        emitting: false,
        frame: fxFrames,
        rotate: {
          onEmit: burstRotation,
          onUpdate: (p) => Phaser.Math.RadToDeg(Math.atan2(p.velocityY, p.velocityX)),
        },
      })
    );
    const streakStretchOf = (p: BurstParticle): number => {
      const spd = Math.hypot(p.velocityX || p.burstVx || 0, p.velocityY || p.burstVy || 0);
      return Math.min(5.5, 1.4 + spd * 0.0028);
    };
    this.streakBurst = this.poolFx("short", () =>
      this.add.particles(0, 0, "fx_spark", {
        // Long enough to travel before brake + fade finish them.
        lifespan: { onEmit: (p) => seedBurst(p, 320, 520) },
        speedX: { onEmit: burstVelocityX },
        speedY: { onEmit: burstVelocityY },
        scaleX: {
          onEmit: (p) => {
            const q = p as BurstParticle;
            q.launchScale = this.burstLaunch.scale * range(1.35, 2.1);
            q.launchStretch = streakStretchOf(q);
            return q.launchScale * q.launchStretch * range(0.7, 1.05);
          },
          onUpdate: (p, _k, t) => {
            const q = p as BurstParticle;
            // Hold length early, then taper as they slow.
            const fade = Math.pow(1 - t, 1.15);
            return (q.launchScale ?? 1) * streakStretchOf(q) * fade;
          },
        },
        scaleY: {
          onEmit: (p) => {
            const q = p as BurstParticle;
            const stretch = q.launchStretch ?? streakStretchOf(q);
            return (q.launchScale ?? this.burstLaunch.scale) * (0.28 / Math.max(0.7, Math.sqrt(stretch)));
          },
          onUpdate: (p, _k, t) => {
            const q = p as BurstParticle;
            const stretch = streakStretchOf(q);
            return (q.launchScale ?? 1) * (0.28 / Math.max(0.7, Math.sqrt(stretch))) * Math.pow(1 - t, 1.1);
          },
        },
        alpha: {
          start: 1,
          end: 0,
          ease: "Quad.easeIn",
        },
        blendMode: "ADD",
        tint: [0xffffff, 0xfff4c0, 0xffd060],
        // Same idea as shortBurst gravityY — soft screen-down drift, not a re-aimed cone.
        gravityY: 160,
        // Milder brake so they actually coast outward before dying.
        accelerationX: { onUpdate: (p) => -p.velocityX * 3.2 },
        accelerationY: { onUpdate: (p) => -p.velocityY * 3.2 },
        radial: false,
        emitting: false,
        frame: fxFrames,
        rotate: {
          // Hold launch heading so gravity drifts them without tipping the streak.
          onEmit: burstRotation,
          onUpdate: (p) => Phaser.Math.RadToDeg((p as BurstParticle).burstHeading ?? Math.atan2(p.velocityY, p.velocityX)),
        },
      })
    );
    this.bigBoomSparkBurst = this.poolFx("short", () =>
      this.add.particles(0, 0, "fx_spark", {
        // Long hang so coast + gravity arc reads.
        lifespan: { onEmit: (p) => seedBurst(p, 1600, 2600) },
        speedX: { onEmit: burstVelocityX },
        speedY: { onEmit: burstVelocityY },
        scaleX: {
          onEmit: (p) => {
            const q = p as BurstParticle;
            q.launchScale = this.burstLaunch.scale * range(1.05, 1.5);
            q.launchStretch = range(2.4, 3.6) * this.burstLaunch.stretchMul;
            q.launchSpd = Math.max(40, Math.hypot(q.burstVx ?? 0, q.burstVy ?? 0));
            return q.launchScale * q.launchStretch;
          },
          onUpdate: (p, _k, t) => {
            const q = p as BurstParticle;
            const spd = Math.hypot(p.velocityX, p.velocityY);
            const slow = Phaser.Math.Clamp(spd / (q.launchSpd ?? 1), 0.12, 1);
            // Shrink with speed; mild life taper at the end.
            return (q.launchScale ?? 1) * (q.launchStretch ?? 1) * slow * Math.pow(1 - t, 0.35);
          },
        },
        scaleY: {
          onEmit: (p) => {
            const q = p as BurstParticle;
            q.launchThick = range(0.4, 0.58);
            return (q.launchScale ?? this.burstLaunch.scale) * q.launchThick;
          },
          onUpdate: (p, _k, t) => {
            const q = p as BurstParticle;
            const spd = Math.hypot(p.velocityX, p.velocityY);
            const slow = Phaser.Math.Clamp(spd / (q.launchSpd ?? 1), 0.15, 1);
            return (q.launchScale ?? 1) * (q.launchThick ?? 1) * slow * Math.pow(1 - t, 0.35);
          },
        },
        alpha: { start: 1, end: 0, ease: "Quad.easeIn" },
        blendMode: "ADD",
        tint: [0xffffff, 0xfff2b0, 0xffc050, 0xff7820],
        // Soft drag so they reach distance then settle; gravity arcs them down.
        gravityY: 200,
        accelerationX: { onUpdate: (p) => -p.velocityX * 1.15 },
        accelerationY: { onUpdate: (p) => -p.velocityY * 0.85 },
        radial: false,
        emitting: false,
        frame: fxFrames,
        rotate: {
          onEmit: burstRotation,
          onUpdate: (p) => Phaser.Math.RadToDeg((p as BurstParticle).burstHeading ?? 0),
        },
      })
    );
    this.bigBoomDirtBurst = this.poolFx("dust", () =>
      this.add.particles(0, 0, "fx_dirt", {
        lifespan: { onEmit: (p) => seedBurst(p, 1500, 2400) },
        speedX: { onEmit: burstVelocityX },
        speedY: { onEmit: burstVelocityY },
        scaleX: {
          onEmit: (p) => {
            const q = p as BurstParticle;
            // Long along travel (~0.7–0.9 of big-boom spark length band).
            q.launchScale = this.burstLaunch.scale * range(1.0, 1.45);
            q.launchStretch = range(1.7, 3.15) * this.burstLaunch.stretchMul;
            return q.launchScale * q.launchStretch;
          },
          // Hold size while falling — no speed/life unshrink.
          onUpdate: (p) => {
            const q = p as BurstParticle;
            return (q.launchScale ?? 1) * (q.launchStretch ?? 1);
          },
        },
        scaleY: {
          onEmit: (p) => {
            const q = p as BurstParticle;
            // Wider than spark needles (~2–3× that thickness band).
            q.launchThick = range(0.85, 1.65);
            return (q.launchScale ?? this.burstLaunch.scale) * q.launchThick;
          },
          onUpdate: (p) => {
            const q = p as BurstParticle;
            return (q.launchScale ?? 1) * (q.launchThick ?? 1);
          },
        },
        alpha: { start: 0.92, end: 0, ease: "Quad.easeIn" },
        blendMode: "NORMAL",
        tint: [0xc4a070, 0xa88858, 0x8a6e48, 0x6e5638],
        gravityY: 275,
        accelerationX: { onUpdate: (p) => -p.velocityX * 1.05 },
        accelerationY: { onUpdate: (p) => -p.velocityY * 0.75 },
        radial: false,
        emitting: false,
        frame: fxFrames,
        rotate: {
          onEmit: burstRotation,
          onUpdate: (p) => Phaser.Math.RadToDeg((p as BurstParticle).burstHeading ?? 0),
        },
      })
    );
    this.energyStreakBurst = this.poolFx("short", () =>
      this.add.particles(0, 0, "fx_spark", {
        lifespan: { onEmit: (p) => seedBurst(p, 280, 480) },
        speedX: { onEmit: burstVelocityX },
        speedY: { onEmit: burstVelocityY },
        scaleX: {
          onEmit: (p) => {
            const q = p as BurstParticle;
            q.launchScale = this.burstLaunch.scale * range(1.55, 2.4);
            q.launchStretch = streakStretchOf(q);
            return q.launchScale * q.launchStretch * range(0.85, 1.2);
          },
          onUpdate: (p, _k, t) => {
            const q = p as BurstParticle;
            return (q.launchScale ?? 1) * streakStretchOf(q) * Math.pow(1 - t, 1.05);
          },
        },
        scaleY: {
          onEmit: (p) => {
            const q = p as BurstParticle;
            const stretch = q.launchStretch ?? streakStretchOf(q);
            return (q.launchScale ?? this.burstLaunch.scale) * (0.62 / Math.max(0.65, Math.sqrt(stretch)));
          },
          onUpdate: (p, _k, t) => {
            const q = p as BurstParticle;
            const stretch = streakStretchOf(q);
            return (q.launchScale ?? 1) * (0.62 / Math.max(0.65, Math.sqrt(stretch))) * Math.pow(1 - t, 0.9);
          },
        },
        alpha: { start: 0.95, end: 0, ease: "Quad.easeIn" },
        blendMode: "ADD",
        tint: [0xffffff, 0xd8ffff, 0x7cf0ff, 0x4aa8ff],
        gravityY: 90,
        accelerationX: { onUpdate: (p) => -p.velocityX * 2.6 },
        accelerationY: { onUpdate: (p) => -p.velocityY * 2.6 },
        radial: false,
        emitting: false,
        frame: fxFrames,
        rotate: {
          onEmit: burstRotation,
          onUpdate: (p) => Phaser.Math.RadToDeg((p as BurstParticle).burstHeading ?? Math.atan2(p.velocityY, p.velocityX)),
        },
      })
    );
    this.teslaSparkBurst = this.poolFx("short", () =>
      this.add.particles(0, 0, "fx_spark", {
        lifespan: { onEmit: (p) => seedBurst(p, 240, 420) },
        speedX: { onEmit: burstVelocityX },
        speedY: { onEmit: burstVelocityY },
        scaleX: {
          onEmit: (p) => {
            const q = p as BurstParticle;
            q.launchScale = this.burstLaunch.scale * range(1.15, 1.7);
            q.launchStretch = Math.min(4.1, 1.45 + Math.hypot(q.velocityX || q.burstVx || 0, q.velocityY || q.burstVy || 0) * 0.0018) * this.burstLaunch.stretchMul;
            return q.launchScale * q.launchStretch;
          },
          onUpdate: (p, _k, t) => {
            const q = p as BurstParticle;
            return (q.launchScale ?? 1) * (q.launchStretch ?? 1) * Math.pow(1 - t, 0.35);
          },
        },
        scaleY: {
          onEmit: (p) => {
            const q = p as BurstParticle;
            const stretch = q.launchStretch ?? 1;
            return (q.launchScale ?? this.burstLaunch.scale) * (0.19 / Math.max(0.85, Math.sqrt(stretch)));
          },
          onUpdate: (p, _k, t) => {
            const q = p as BurstParticle;
            const stretch = q.launchStretch ?? 1;
            return (q.launchScale ?? 1) * (0.19 / Math.max(0.85, Math.sqrt(stretch))) * Math.pow(1 - t, 0.45);
          },
        },
        alpha: { start: 1, end: 0, ease: "Cubic.easeIn" },
        blendMode: "ADD",
        tint: [0x8ef0ff, 0x3ad0ff, 0x1a88ff, 0x0d5cff],
        gravityY: 340,
        accelerationX: { onUpdate: (p) => -p.velocityX * 9.2 },
        accelerationY: { onUpdate: (p) => -p.velocityY * 9.2 },
        radial: false,
        emitting: false,
        frame: fxFrames,
        rotate: {
          onEmit: burstRotation,
          onUpdate: (p) => Phaser.Math.RadToDeg((p as BurstParticle).burstHeading ?? 0),
        },
      })
    );
    this.warpTrail = this.poolFx("short", () =>
      this.add.particles(0, 0, "fx_spark", {
        lifespan: { onEmit: () => range(900, 1600) * this.trailFxLife },
        speed: { min: 4, max: 28 },
        scale: {
          onEmit: (p) => fxEmit(p, () => (0.28 + Math.pow(Math.random(), 0.6) * 0.22) * this.trailFxScale),
          onUpdate: (p, _k, t) => fxLife(p, t, (u) => 1 - u * 0.9, 0.38),
        },
        alpha: { start: 0.92, end: 0 },
        blendMode: "ADD",
        tint: [0xffffff, 0xf0c8ff, 0xc86cff, 0x8a3cff],
        gravityY: 12,
        emitting: false,
        frame: fxFrames,
        rotate: fxSpin,
      })
    );
    this.warpOrb = this.poolFx("short", () =>
      this.add.particles(0, 0, "fx_spark", {
        lifespan: { onEmit: () => range(520, 980) * this.trailFxLife },
        speed: { min: 6, max: 42 },
        scale: {
          onEmit: (p) => fxEmit(p, () => (0.72 + Math.pow(Math.random(), 0.55) * 0.55) * this.trailFxScale),
          onUpdate: (p, _k, t) => fxLife(p, t, (u) => 1 - u * 0.78, 0.7),
        },
        alpha: { start: 1, end: 0 },
        blendMode: "ADD",
        tint: [0xffffff, 0xf4d8ff, 0xe090ff, 0xb050ff],
        gravityY: 8,
        emitting: false,
        frame: fxFrames,
        rotate: fxSpin,
      })
    );
    this.warpSparkBurst = this.poolFx("short", () =>
      this.add.particles(0, 0, "fx_spark", {
        lifespan: { onEmit: (p) => seedBurst(p, 220, 400) },
        speedX: { onEmit: burstVelocityX },
        speedY: { onEmit: burstVelocityY },
        scaleX: {
          onEmit: (p) => {
            const q = p as BurstParticle;
            q.launchScale = this.burstLaunch.scale * range(1.2, 1.9);
            q.launchStretch = streakStretchOf(q);
            return q.launchScale * q.launchStretch * range(0.9, 1.25);
          },
          onUpdate: (p, _k, t) => {
            const q = p as BurstParticle;
            return (q.launchScale ?? 1) * streakStretchOf(q) * Math.pow(1 - t, 1.05);
          },
        },
        scaleY: {
          onEmit: (p) => {
            const q = p as BurstParticle;
            const stretch = q.launchStretch ?? streakStretchOf(q);
            return (q.launchScale ?? this.burstLaunch.scale) * (0.55 / Math.max(0.65, Math.sqrt(stretch)));
          },
          onUpdate: (p, _k, t) => {
            const q = p as BurstParticle;
            const stretch = streakStretchOf(q);
            return (q.launchScale ?? 1) * (0.55 / Math.max(0.65, Math.sqrt(stretch))) * Math.pow(1 - t, 0.9);
          },
        },
        alpha: { start: 1, end: 0, ease: "Quad.easeIn" },
        blendMode: "ADD",
        tint: [0xffffff, 0xf0b8ff, 0xc86cff, 0x7a28ff],
        gravityY: 70,
        accelerationX: { onUpdate: (p) => -p.velocityX * 2.8 },
        accelerationY: { onUpdate: (p) => -p.velocityY * 2.8 },
        radial: false,
        emitting: false,
        frame: fxFrames,
        rotate: {
          onEmit: burstRotation,
          onUpdate: (p) =>
            Phaser.Math.RadToDeg(
              (p as BurstParticle).burstHeading ?? Math.atan2(p.velocityY, p.velocityX)
            ),
        },
      })
    );
    this.muzzleBurst = this.poolFx("short", () =>
      this.add.particles(0, 0, "fx_flame", {
        lifespan: { onEmit: (p) => seedBurst(p, 120, 280) },
        speedX: { onEmit: burstVelocityX },
        speedY: { onEmit: burstVelocityY },
        scaleX: {
          onEmit: (p) => {
            const q = p as BurstParticle;
            q.launchScale = this.burstLaunch.scale * range(0.72, 1.18);
            q.launchStretch = burstStretchOf(q);
            const sx = q.launchScale * q.launchStretch * range(1.7, 2.4);
            // Center-origin streaks: nudge forward by half length so the tail sits on the muzzle.
            const halfLen = FX_SHEET_SIZE.flame * sx * 0.5;
            const heading = q.burstHeading ?? Math.atan2(q.burstVy ?? 0, q.burstVx ?? 1);
            q.x += Math.cos(heading) * halfLen;
            q.y += Math.sin(heading) * halfLen;
            return sx;
          },
          onUpdate: (p, _k, t) => {
            const q = p as BurstParticle;
            return (q.launchScale ?? 1) * burstStretchOf(q) * 1.15 * (1 - t);
          },
        },
        scaleY: {
          onEmit: (p) => {
            const q = p as BurstParticle;
            const stretch = q.launchStretch ?? burstStretchOf(q);
            return (q.launchScale ?? this.burstLaunch.scale) * (0.42 / Math.max(0.55, Math.sqrt(stretch)));
          },
          onUpdate: (p, _k, t) => {
            const q = p as BurstParticle;
            const stretch = burstStretchOf(q);
            return (q.launchScale ?? 1) * (0.42 / Math.max(0.55, Math.sqrt(stretch))) * (1 - t);
          },
        },
        alpha: { start: 1, end: 0 },
        blendMode: "ADD",
        tint: [0xfff8d8, 0xffc050, 0xff7a28],
        radial: false,
        emitting: false,
        frame: fxFrames,
        rotate: {
          onEmit: burstRotation,
          onUpdate: (p) => Phaser.Math.RadToDeg(Math.atan2(p.velocityY, p.velocityX)),
        },
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
        rotate: {
          onEmit: burstRotation,
          onUpdate: (p) => Phaser.Math.RadToDeg(Math.atan2(p.velocityY, p.velocityX)),
        },
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
      this.add.particles(0, 0, craftExhaustFlameSheet(craft.kind), {
        lifespan: { onEmit: () => this.exhaustLife },
        speedX: { onEmit: () => this.exhaustVx + range(-4, 4) },
        speedY: { onEmit: () => this.exhaustVy + range(-4, 4) },
        scaleX: {
          onEmit: (p) => {
            const q = p as Phaser.GameObjects.Particles.Particle & {
              exhaustScaleX?: number;
              exhaustJitter?: number;
            };
            q.exhaustScaleX = this.exhaustScaleX;
            q.exhaustJitter = range(-1, 1);
            return q.exhaustScaleX;
          },
          onUpdate: (p, _k, t) => {
            const q = p as Phaser.GameObjects.Particles.Particle & { exhaustScaleX?: number };
            const base = q.exhaustScaleX ?? 1;
            // Hold the ribbon early, then extend slightly as it dies.
            const late = Math.pow(Phaser.Math.Clamp((t - 0.38) / 0.62, 0, 1), 1.35);
            return base * (1 - t * 0.12 + late * 0.95);
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
            const base = q.exhaustScaleY ?? 0.4;
            const late = Math.pow(Phaser.Math.Clamp((t - 0.4) / 0.6, 0, 1), 1.25);
            return base * (1 - t * 0.18 + late * 0.85);
          },
        },
        accelerationX: {
          onUpdate: (p, _k, t) => {
            const q = p as Phaser.GameObjects.Particles.Particle & { exhaustJitter?: number };
            const late = Math.pow(Phaser.Math.Clamp((t - 0.36) / 0.64, 0, 1), 1.4);
            const j = q.exhaustJitter ?? 0;
            return j * 110 * late + Math.sin(t * 26 + j * 7.1) * 70 * late;
          },
        },
        accelerationY: {
          onUpdate: (p, _k, t) => {
            const q = p as Phaser.GameObjects.Particles.Particle & { exhaustJitter?: number };
            const late = Math.pow(Phaser.Math.Clamp((t - 0.36) / 0.64, 0, 1), 1.4);
            const j = q.exhaustJitter ?? 0;
            return -j * 85 * late + Math.cos(t * 23 + j * 5.4) * 65 * late;
          },
        },
        alpha: {
          onEmit: (p) => {
            const q = p as Phaser.GameObjects.Particles.Particle & { exhaustAlpha?: number };
            q.exhaustAlpha = this.exhaustAlpha;
            return q.exhaustAlpha;
          },
          onUpdate: (p, _k, t) => {
            const q = p as Phaser.GameObjects.Particles.Particle & { exhaustAlpha?: number };
            return (q.exhaustAlpha ?? 0.98) * (1 - t * 0.94);
          },
        },
        // Hue is pre-baked into craftExhaustFlameSheet (ParticleEmitter has no preFX).
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
          onUpdate: (p, _k, t) => {
            const q = p as Phaser.GameObjects.Particles.Particle & {
              exhaustAngle?: number;
              exhaustJitter?: number;
            };
            const late = Math.pow(Phaser.Math.Clamp((t - 0.4) / 0.6, 0, 1), 1.3);
            const wobble = (q.exhaustJitter ?? 0) * 18 * late;
            return Phaser.Math.RadToDeg(q.exhaustAngle ?? this.exhaustAngle) + wobble;
          },
        },
      })
    );
    this.craftExhaustMote = this.poolFx("short", () =>
      this.add.particles(0, 0, "fx_spark", {
        lifespan: { min: 280, max: 520 },
        speedX: { onEmit: () => this.exhaustVx * 0.5 + range(-16, 16) },
        speedY: { onEmit: () => this.exhaustVy * 0.5 + range(-16, 16) },
        scale: {
          onEmit: (p) => {
            const q = p as Phaser.GameObjects.Particles.Particle & { exhaustScaleY?: number };
            q.exhaustScaleY = 0.18 + this.exhaustScaleY * 0.55;
            return q.exhaustScaleY;
          },
          onUpdate: (p, _k, t) => {
            const q = p as Phaser.GameObjects.Particles.Particle & { exhaustScaleY?: number };
            return (q.exhaustScaleY ?? 0.28) * (1 - t);
          },
        },
        alpha: {
          onEmit: (p) => {
            const q = p as Phaser.GameObjects.Particles.Particle & { exhaustAlpha?: number };
            q.exhaustAlpha = this.exhaustAlpha * 0.92;
            return q.exhaustAlpha;
          },
          onUpdate: (p, _k, t) => {
            const q = p as Phaser.GameObjects.Particles.Particle & { exhaustAlpha?: number };
            return (q.exhaustAlpha ?? 0.9) * (1 - t);
          },
        },
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
        scale: {
          onEmit: (p) => {
            const q = p as Phaser.GameObjects.Particles.Particle & { exhaustScaleY?: number };
            q.exhaustScaleY = 0.22 + this.exhaustScaleY * 0.7;
            return q.exhaustScaleY;
          },
          onUpdate: (p, _k, t) => {
            const q = p as Phaser.GameObjects.Particles.Particle & { exhaustScaleY?: number };
            return (q.exhaustScaleY ?? 0.38) * (1 + t * 2.15);
          },
        },
        alpha: {
          onEmit: (p) => {
            const q = p as Phaser.GameObjects.Particles.Particle & { exhaustAlpha?: number };
            q.exhaustAlpha = this.exhaustAlpha * 0.82;
            return q.exhaustAlpha;
          },
          onUpdate: (p, _k, t) => {
            const q = p as Phaser.GameObjects.Particles.Particle & { exhaustAlpha?: number };
            return (q.exhaustAlpha ?? 0.82) * (1 - t);
          },
        },
        tint: { onEmit: () => this.exhaustSmokeTint },
        radial: false,
        emitting: false,
        frame: fxFrames,
        rotate: fxSpin,
      })
    );
    this.jetWingTrail = this.poolFx("smoke", () =>
      this.add.particles(0, 0, this.textures.exists("fx_smoke_tint") ? "fx_smoke_tint" : "fx_smoke", {
        lifespan: { onEmit: () => this.wingTrailLife },
        speedX: { onEmit: () => this.wingTrailVx + range(-3, 3) },
        speedY: { onEmit: () => this.wingTrailVy + range(-3, 3) },
        scaleX: {
          onEmit: (p) => {
            const q = p as Phaser.GameObjects.Particles.Particle & { wingScaleX?: number };
            q.wingScaleX = this.wingTrailScaleX;
            return q.wingScaleX;
          },
          onUpdate: (p, _k, t) => {
            const q = p as Phaser.GameObjects.Particles.Particle & { wingScaleX?: number };
            return (q.wingScaleX ?? 1) * (1 + t * 0.55);
          },
        },
        scaleY: {
          onEmit: (p) => {
            const q = p as Phaser.GameObjects.Particles.Particle & { wingScaleY?: number };
            q.wingScaleY = this.wingTrailScaleY;
            return q.wingScaleY;
          },
          onUpdate: (p, _k, t) => {
            const q = p as Phaser.GameObjects.Particles.Particle & { wingScaleY?: number };
            return (q.wingScaleY ?? 0.22) * (1 + t * 0.85);
          },
        },
        alpha: { start: 0.55, end: 0 },
        tint: { onEmit: () => this.wingTrailTint },
        gravityY: -4,
        radial: false,
        emitting: false,
        frame: fxFrames,
        rotate: {
          onEmit: (p) => {
            const q = p as Phaser.GameObjects.Particles.Particle & { wingAngle?: number };
            q.wingAngle = this.wingTrailAngle;
            return Phaser.Math.RadToDeg(this.wingTrailAngle);
          },
          onUpdate: (p) => {
            const q = p as Phaser.GameObjects.Particles.Particle & { wingAngle?: number };
            return Phaser.Math.RadToDeg(q.wingAngle ?? this.wingTrailAngle);
          },
        },
      })
    );
    this.flame = this.poolFx("fire", () =>
      this.add.particles(0, 0, "fx_flame", {
        lifespan: { onEmit: () => 480 * this.trailFxLife },
        speed: { min: 8, max: 40 },
        scale: {
          onEmit: (p) => {
            const q = p as Phaser.GameObjects.Particles.Particle & { s0?: number };
            // Bake both knobs at emit — recycled particles must not inherit a stale s0.
            q.s0 = this.dmgFlameScale * this.trailFxScale * (0.38 + Math.random() * 0.16);
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
    this.hotFlame = this.poolFx("fire", () =>
      this.add.particles(0, 0, "fx_flame", {
        lifespan: { onEmit: () => 480 * this.trailFxLife },
        speed: { min: 8, max: 40 },
        scale: {
          onEmit: (p) => {
            const q = p as Phaser.GameObjects.Particles.Particle & { s0?: number };
            q.s0 = this.dmgFlameScale * this.trailFxScale * (0.38 + Math.random() * 0.16);
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
        // Match lingerSmoke buoyancy/path so fire fades into the same rising plume.
        lifespan: { onEmit: () => range(240, 420) * this.trailFxLife },
        speed: { min: 4, max: 18 },
        angle: { min: -128, max: -52 },
        scale: {
          onEmit: (p) => fxEmit(p, () => (0.28 + Math.pow(Math.random(), 0.65) * 0.28) * this.trailFxScale),
          onUpdate: (p, _k, t) => fxLife(p, t, (u) => 1 - u * 0.9, 0.28),
        },
        alpha: { start: 1, end: 0 },
        blendMode: "ADD",
        tint: [0xfff4c0, 0xff9a32, 0xff5a18],
        gravityY: -6,
        accelerationX: { onEmit: () => (Math.random() - 0.5) * 18 },
        accelerationY: { onEmit: () => -5 + (Math.random() - 0.5) * 12 },
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
    this.flareTrail = this.poolFx("fire", () =>
      this.add.particles(0, 0, "fx_spark", {
        lifespan: { onEmit: () => range(1600, 2800) * this.trailFxLife },
        speed: { min: 2, max: 18 },
        scale: {
          onEmit: (p) => fxEmit(p, () => (0.42 + Math.pow(Math.random(), 0.65) * 0.22) * this.trailFxScale),
          onUpdate: (p, _k, t) => fxLife(p, t, (u) => 1 - u * 0.88, 0.48),
        },
        alpha: { start: 0.95, end: 0 },
        blendMode: "ADD",
        tint: [0xfff8d0, 0xffee66, 0xffaa40, 0xff6a18],
        gravityY: 28,
        emitting: false,
        frame: fxFrames,
        rotate: fxSpin,
      })
    );
    this.flareSpark = this.poolFx("short", () =>
      this.add.particles(0, 0, "fx_spark", {
        lifespan: { onEmit: () => range(220, 420) },
        speed: { min: 12, max: 86 },
        scale: {
          onEmit: (p) => fxEmit(p, () => (0.52 + Math.pow(Math.random(), 0.55) * 0.28) * this.trailFxScale),
          onUpdate: (p, _k, t) => fxLife(p, t, (u) => 1 - u * 0.82, 0.62),
        },
        alpha: { start: 1, end: 0 },
        blendMode: "ADD",
        tint: [0xffffff, 0xfff8d0, 0xffcc44, 0xff7a20],
        gravityY: 36,
        emitting: false,
        frame: fxFrames,
        rotate: fxSpin,
      })
    );
    // Signal-flare gun pellet: pink/red flame loft with strong screen-up (Y/Z) drift.
    this.signalFlareTrail = this.poolFx("fire", () =>
      this.add.particles(0, 0, "fx_flame", {
        lifespan: { onEmit: () => range(520, 980) * this.trailFxLife },
        speed: { min: 6, max: 28 },
        angle: { min: -130, max: -50 },
        scale: {
          onEmit: (p) => fxEmit(p, () => (0.28 + Math.pow(Math.random(), 0.6) * 0.22) * this.trailFxScale),
          onUpdate: (p, _k, t) => fxLife(p, t, (u) => 1 - u * 0.72, 0.28),
        },
        alpha: { start: 0.95, end: 0 },
        blendMode: "ADD",
        tint: [0xffe0f0, 0xff6a9a, 0xff2a55, 0xe01040],
        gravityY: -145,
        accelerationY: { onEmit: () => -35 + (Math.random() - 0.5) * 18 },
        emitting: false,
        frame: fxFrames,
        rotate: fxSpin,
      })
    );
    this.signalFlareSmoke = this.poolFx("smoke", () =>
      this.add.particles(0, 0, this.textures.exists("fx_smoke_tint") ? "fx_smoke_tint" : "fx_smoke", {
        lifespan: { onEmit: () => range(900, 1600) * Math.max(1, this.trailFxLife * 0.8) },
        speed: { min: 4, max: 22 },
        angle: { min: -135, max: -45 },
        scale: {
          onEmit: (p) => fxEmit(p, () => (0.22 + Math.random() * 0.16) * this.trailFxScale),
          onUpdate: (p, _k, t) => fxLife(p, t, (u) => 1 + 2.6 * u, 0.22),
        },
        alpha: { start: 0.55, end: 0 },
        tint: [0xffb0c8, 0xff5578, 0xd02048, 0x901030],
        gravityY: -95,
        accelerationY: { onEmit: () => -28 + (Math.random() - 0.5) * 14 },
        accelerationX: { onEmit: () => (Math.random() - 0.5) * 16 },
        emitting: false,
        frame: fxFrames,
        rotate: { min: -70, max: 70 },
      })
    );
    this.signalFlareSpark = this.poolFx("short", () =>
      this.add.particles(0, 0, "fx_spark", {
        lifespan: { onEmit: () => range(90, 220) },
        speed: { min: 140, max: 420 },
        scale: {
          onEmit: (p) => fxEmit(p, () => (0.22 + Math.pow(Math.random(), 0.45) * 0.2) * this.trailFxScale),
          onUpdate: (p, _k, t) => fxLife(p, t, (u) => 1 - u * 0.9, 0.28),
        },
        alpha: { start: 1, end: 0 },
        blendMode: "ADD",
        tint: [0xffffff, 0xff90b0, 0xff2858, 0xc01030],
        gravityY: 18,
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
          onEmit: (p) => fxEmit(p, () => 0.38 * this.trailFxScale),
          onUpdate: (p, _k, t) => fxLife(p, t, (u) => 1 + 2.4 * u, 0.38),
        },
        alpha: { start: 0.88, end: 0 },
        gravityY: -6,
        accelerationX: { onEmit: () => (Math.random() - 0.5) * 18 },
        accelerationY: { onEmit: () => -5 + (Math.random() - 0.5) * 12 },
        emitting: false,
        frame: fxFrames,
        rotate: { min: -80, max: 80 },
      })
    );
    this.rocketSmoke = this.poolFx("smoke", () =>
      this.add.particles(0, 0, "fx_smoke", {
        lifespan: {
          onEmit: () => range(1600, 2800) * Math.max(1, this.trailFxLife * 0.75),
        },
        speed: { min: 8, max: 32 },
        scaleX: {
          onEmit: (p) => {
            const q = p as Phaser.GameObjects.Particles.Particle & { rocketScaleX?: number };
            q.rocketScaleX = 0.48 * this.trailFxScale * range(1.7, 2.5);
            return q.rocketScaleX;
          },
          onUpdate: (p, _k, t) => {
            const q = p as Phaser.GameObjects.Particles.Particle & { rocketScaleX?: number };
            return (q.rocketScaleX ?? 0.8) * (1 + 1.4 * t);
          },
        },
        scaleY: {
          onEmit: (p) => {
            const q = p as Phaser.GameObjects.Particles.Particle & { rocketScaleY?: number };
            q.rocketScaleY = 0.2 * this.trailFxScale * range(0.9, 1.15);
            return q.rocketScaleY;
          },
          onUpdate: (p, _k, t) => {
            const q = p as Phaser.GameObjects.Particles.Particle & { rocketScaleY?: number };
            return (q.rocketScaleY ?? 0.2) * (1 + 1.8 * t);
          },
        },
        alpha: { start: 0.68, end: 0 },
        gravityY: -10,
        emitting: false,
        frame: fxFrames,
        rotate: {
          onEmit: (p) => {
            const q = p as Phaser.GameObjects.Particles.Particle & { rocketAngle?: number };
            q.rocketAngle = this.shotTrailAngle;
            return Phaser.Math.RadToDeg(this.shotTrailAngle);
          },
          onUpdate: (p) => {
            const q = p as Phaser.GameObjects.Particles.Particle & { rocketAngle?: number };
            return Phaser.Math.RadToDeg(q.rocketAngle ?? this.shotTrailAngle);
          },
        },
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
    this.events.on(Phaser.Scenes.Events.POST_UPDATE, () => this.tintThermalParticles());
    this.applyTimeScale();

    this.keyW = this.input.keyboard!.addKey("W");
    this.keyA = this.input.keyboard!.addKey("A");
    this.keyS = this.input.keyboard!.addKey("S");
    this.keyD = this.input.keyboard!.addKey("D");
    this.keySpace = this.input.keyboard!.addKey("SPACE");
    this.keyShift = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
    this.keyE = this.input.keyboard!.addKey("E");
    this.keyE.on("down", () => this.tryCountermeasure());
    this.input.keyboard!.addKey("ONE").on("down", () => {
      if (this.editOpen) this.setEditBrush(0);
      else if (this.debugOpen || this.helpOpen) return;
      else this.selectWeapon(0);
    });
    this.input.keyboard!.addKey("TWO").on("down", () => {
      if (this.editOpen) this.setEditBrush(1);
      else if (this.debugOpen || this.helpOpen) return;
      else this.selectWeapon(1);
    });
    this.input.keyboard!.addKey("THREE").on("down", () => {
      if (this.editOpen) this.setEditBrush(2);
      else if (this.debugOpen || this.helpOpen) return;
      else this.selectWeapon(2);
    });
    this.input.keyboard!.addKey("FOUR").on("down", () => {
      if (this.debugOpen || this.helpOpen) return;
      else this.selectWeapon(3);
    });
    this.input.keyboard!.addKey("FIVE").on("down", () => {
      if (this.debugOpen || this.helpOpen) return;
      else this.selectWeapon(4);
    });
    this.input.keyboard!.addKey("B").on("down", () => this.toggleReliefEditor());
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
      else if (this.remoteView && this.pilotingRemote()) this.exitRemoteView();
      else this.recallWingmen();
    });
    this.input.keyboard!.addKey("COMMA").on("down", () => {
      if (this.editOpen) this.nudgeEditOff(-1, 0);
    });
    this.input.keyboard!.addKey("PERIOD").on("down", () => {
      if (this.editOpen) this.nudgeEditOff(1, 0);
    });
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.OPEN_BRACKET).on("down", () => {
      if (rigsAnyOpen(this)) return;
      if (this.debugSpawnOpen) this.nudgeDebugSpawn(-1);
      else if (this.debugCamOpen) this.nudgeDebugCam(-1);
      else if (this.editOpen) this.nudgeEditSize(-1);
    });
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.CLOSED_BRACKET).on("down", () => {
      if (rigsAnyOpen(this)) return;
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
      if (this.over) {
        this.scene.start("menu");
        return;
      }
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
      if (rigsAnyOpen(this)) return;
      if (this.debugCamOpen) this.nudgeDebugCam(dir);
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
      this.fxBloom = undefined;
      this.fxBarrel = undefined;
      this.empGlitchT = 0;
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
    this.input.keyboard!.addKey("F").on("down", () => {
      if (this.editOpen || this.debugOpen || this.helpOpen || this.exitOpen) return;
      // POV remotes with host escort claim F; otherwise F toggles test FX.
      if (this.povHudRemote()?.spec.hostEscort) this.toggleHostEscortMode();
      else this.toggleTestFx();
    });
    this.input.keyboard!.addKey("T").on("down", () => this.toggleThermal());
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.UP).on("down", () => {
      if (rigsAnyOpen(this)) return;
      if (this.helpOpen) this.nudgeHelp(-1);
      else if (this.debugSpawnOpen) this.nudgeDebugSpawn(-1);
      else if (this.debugCamOpen) this.nudgeDebugCamSel(-1);
      else if (this.debugOpen) this.nudgeDebugMenu(-1);
    });
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN).on("down", () => {
      if (rigsAnyOpen(this)) return;
      if (this.helpOpen) this.nudgeHelp(1);
      else if (this.debugSpawnOpen) this.nudgeDebugSpawn(1);
      else if (this.debugCamOpen) this.nudgeDebugCamSel(1);
      else if (this.debugOpen) this.nudgeDebugMenu(1);
    });
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT).on("down", () => {
      if (rigsAnyOpen(this)) return;
      if (this.helpOpen) this.nudgeHelp(-1);
      else if (this.debugCamOpen) this.nudgeDebugCam(-1);
    });
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT).on("down", () => {
      if (rigsAnyOpen(this)) return;
      if (this.helpOpen) this.nudgeHelp(1);
      else if (this.debugCamOpen) this.nudgeDebugCam(1);
    });
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER).on("down", () => {
      if (this.debugSpawnOpen) this.debugSpawnSelected();
      else if (this.debugCamOpen) this.activateDebugCamRow();
      else if (this.debugOpen && !this.debugCamOpen) this.activateDebugRow(this.debugMenuIdx);
    });
    this.input.on("wheel", (_p: Phaser.Input.Pointer, _dx: number, dy: number) => {
      if (rigsAnyOpen(this)) return;
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
      if (dy > 0) this.selectWeapon((this.hudWeapon() + 1) % this.hudLoadout().length);
      else
        this.selectWeapon(
          (this.hudWeapon() + this.hudLoadout().length - 1) % this.hudLoadout().length
        );
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
    this.spectrePrompt = this.add
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
    this.spectreArmedTxt = this.add
      .text(0, 0, "ARMED", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "12px",
        color: "#ff3a22",
      })
      .setOrigin(0.5, 1)
      .setDepth(Layer.FIELD)
      .setVisible(false)
      .setStroke("#1c100c", 3);
    this.fxHud = this.add
      .text(16, 12, "", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "12px",
        color: "#8a8470",
      })
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(Layer.HUD + 5);
    this.fpsHud = this.add
      .text(this.scale.width - 16, 12, "", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "12px",
        color: "#8a8470",
      })
      .setOrigin(1, 0)
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
    this.wpnHudSlots = this.loadout.map(() => {
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
      this.exitHudSlot = {
        key: mk("12px", "#a89868", 0),
        name: mk("13px", "#f0d56a", 0),
      };
      this.escortHudSlot = {
        key: mk("12px", "#a89868", 0),
        name: mk("13px", "#f0d56a", 0),
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
    this.cmHudLabel = cmMk("11px", "#e8b84a", 1);
    this.cmHudTime = cmMk("11px", "#c4a24a", 0);
    this.hpGfx = this.add.graphics().setDepth(Layer.FIELD);
    this.playerHud = this.add.graphics().setScrollFactor(0).setDepth(Layer.HUD + 12);
    this.hurtVignette = this.add
      .image(0, 0, "hud_hurt_pulse")
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(Layer.HUD + 4)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0)
      .setVisible(false);
    this.hurtVignettePulse = this.add
      .image(0, 0, "hud_hurt_static")
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(Layer.HUD + 5)
      .setAlpha(0)
      .setVisible(false);
    const wireBake = bakeHeliHudWireTexture(this);
    // Square status panel matches minimap diameter; wire fits the area right of the HP bar.
    const statusPanel = 180;
    const wireRestW = statusPanel - 9 - 12 - 6; // bar + gap + pad
    if (wireBake && this.textures.exists("hud_wire")) {
      this.heliHudWireBake = wireBake;
      this.heliHudWireScale = Math.min(
        (wireRestW - 16) / wireBake.w,
        (statusPanel - 28) / wireBake.h
      );
      const origin = wireBake.pivot;
      this.heliHudWireSh = this.add
        .image(0, 0, "hud_wire_sh")
        .setOrigin(origin.x, origin.y)
        .setScale(this.heliHudWireScale)
        .setScrollFactor(0)
        .setDepth(Layer.HUD + 10)
        .setAlpha(0.72);
      this.heliHudWire = this.add
        .image(0, 0, "hud_wire")
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
    this.debugGfx = this.add.graphics().setDepth(Layer.FIELD).setVisible(false);
    this.blastGfx = this.add.graphics().setDepth(Layer.FIELD + 20);
    this.aiGfx = this.add.graphics().setDepth(Layer.FIELD + 8);
    const cx = 18 + 88;
    const cy = this.scale.height - 18 - 88;
    this.miniMask = this.add.graphics().setScrollFactor(0);
    this.miniMask.fillStyle(0xffffff);
    this.miniMask.fillCircle(cx, cy, 88);
    this.miniBg = this.add.graphics().setScrollFactor(0).setDepth(Layer.HUD - 1);
    this.miniBg.fillStyle(minimapTerrainBgColor(this.world.canvas), 1);
    this.miniBg.fillCircle(cx, cy, 90);
    this.miniTerrain = this.add.image(cx, cy, "map_terrain").setScrollFactor(0).setDepth(Layer.HUD);
    this.miniTerrain.setMask(this.miniMask.createGeometryMask());
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
    this.miniWrecks = this.add.image(cx, cy, "map_wrecks").setScrollFactor(0).setDepth(Layer.HUD);
    if (this.terrain25d) this.miniWrecks.setFlipY(true);
    this.miniWrecks.setMask(this.miniMask.createGeometryMask());
    this.miniMask.setVisible(false);

    this.cameras.main.centerOn(this.heli.x, this.heli.y);
    this.cameras.main.setZoom(this.playZoom());
    // Chase cam stays on-map only for craft without forced U-turn.
    this.cameras.main.useBounds = craftCameraEdgeLocked(this.heli.spec);
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
    const perfOn = this.perfEnabled;
    const perfSceneStart = perfOn ? performance.now() : 0;
    if (rigsAnyOpen(this)) {
      this.reticle.setVisible(false);
      this.reticleMark.setVisible(false);
      this.reticleMark.clear();
      this.sight.setVisible(false);
      this.sight.clear();
      return;
    }
    const wallDt = Math.min(dms / 1000, 0.05);
    this.frameWallDt = wallDt;
    const mapPause = this.mapWant || this.mapBlend > 0.02;
    const uiPause = mapPause || this.helpOpen || this.exitOpen;
    let simScale = this.timeScale;
    if (this.stingerT > 0) simScale = Math.min(simScale, 0.18);
    if (this.timewarpT > 0) {
      this.timewarpT = Math.max(0, this.timewarpT - wallDt);
      simScale = Math.min(simScale, 0.22);
      if (this.timewarpT <= 0) {
        this.beginCmCooldown(0, this.timewarpMax || COUNTERMEASURES.timewarp.duration);
      }
    }
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
    this.liveSimScale = simScale;
    this.setSimTimeScale(uiPause ? 0 : simScale);
    this.tickStinger(wallDt);
    for (const policy of Object.values(this.fxPolicies)) policy.emitted = 0;
    this.syncFpsHud();
    if (this.over) {
      // End prompt is up, but the world keeps simmering (debris, units, fire).
      const endDt = uiPause ? 0 : wallDt * this.timeScale;
      this.setSimTimeScale(uiPause ? 0 : this.timeScale);
      this.syncPlayView();
      if (this.mapBlend < 0.001) this.syncLookCam(wallDt);
      if (!mapPause) {
        this.rebuildUnitIdMap();
        this.updateUnits(endDt);
        this.updateShots(endDt);
        this.updateDebris(endDt);
        this.updateSimParticles(endDt);
        this.updateSmokePuffs(endDt);
        this.emitHeliCrashDmgFlames();
        this.hideAimChrome();
      }
      this.drawMinimap();
      this.drawPlayerHud();
      this.towWireGfx.clear();
      this.remoteAntennaGfx?.clear();
      this.teslaGfx.clear();
      this.hideTeslaVisuals();
      this.energyTrailGfx.clear();
      this.refractorGfx.clear();
      this.cmGfx.clear();
      this.spectrePrompt?.setVisible(false);
      this.spectreArmedTxt?.setVisible(false);
      return;
    }
    this.syncPlayView();
    this.updateTheaterCam(wallDt);
    if (this.mapBlend < 0.001) this.syncLookCam(wallDt);
    this.syncPlaneCloudParallax(dt);

    if (!mapPause) {
      this.rebuildUnitIdMap();
      if (perfOn) {
        const timings = this.perfCurrent!;
        timings.fill(0);
        let t = performance.now();
        const aim = this.worldPointer();
        const pilot = this.pilotingRemote();
        // POV remotes (HOUND): after Q exit the slot stays selected but bird flight returns.
        this.remotePilotActive =
          !!pilot && (this.remoteView || !remoteHasPovHud(pilot.spec));
        if (this.remotePilotActive && pilot && !pilot.airborne) this.tickRemotePilot(pilot, dt, aim);
        else {
          const parked = this.activeRemote();
          if (parked && !parked.spec.ai && !parked.airborne) this.tickRemoteIdle(parked, dt);
        }
        this.tickCountermeasures(dt, wallDt);
        {
          const escort = this.hostEscortDrive(pilot);
          this.heli.update(
            dt,
            this.world,
            escort?.stick ??
              (this.remotePilotActive
                ? { up: false, down: false, left: false, right: false }
                : {
                    up: this.keyW.isDown,
                    down: this.keyS.isDown,
                    left: this.keyA.isDown,
                    right: this.keyD.isDown,
                  }),
            escort?.aimX ?? aim.x,
            escort?.aimY ?? aim.y,
            escort
              ? false
              : this.keySpace.isDown &&
                  !(this.stingerStyle === "subtle" && this.stingerT > 0 && !this.stingerReleased),
            escort ? false : this.keyShift.isDown
          );
          if (escort?.brake) this.brakeHostEscort(dt);
          if (escort?.speedCap != null) this.capHostEscortSpeed(escort.speedCap);
        }
        this.syncProjectionPose();
        this.syncLeaveTheaterPeaks();
        this.syncHeliGfx(dt);
        this.handleFire(dt);
        this.tickPlayerMuzzles(dt);
        this.updateSmokePuffs(dt);
        this.updateRemotes(dt);
        this.updateFlares(dt);
        this.tickTeslaZaps(dt);
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
        const pilot = this.pilotingRemote();
        // POV remotes (HOUND): after Q exit the slot stays selected but bird flight returns.
        this.remotePilotActive =
          !!pilot && (this.remoteView || !remoteHasPovHud(pilot.spec));
        if (this.remotePilotActive && pilot && !pilot.airborne) this.tickRemotePilot(pilot, dt, aim);
        else {
          const parked = this.activeRemote();
          if (parked && !parked.spec.ai && !parked.airborne) this.tickRemoteIdle(parked, dt);
        }
        this.tickCountermeasures(dt, wallDt);
        {
          const escort = this.hostEscortDrive(pilot);
          this.heli.update(
            dt,
            this.world,
            escort?.stick ??
              (this.remotePilotActive
                ? { up: false, down: false, left: false, right: false }
                : {
                    up: this.keyW.isDown,
                    down: this.keyS.isDown,
                    left: this.keyA.isDown,
                    right: this.keyD.isDown,
                  }),
            escort?.aimX ?? aim.x,
            escort?.aimY ?? aim.y,
            escort
              ? false
              : this.keySpace.isDown &&
                  !(this.stingerStyle === "subtle" && this.stingerT > 0 && !this.stingerReleased),
            escort ? false : this.keyShift.isDown
          );
          if (escort?.brake) this.brakeHostEscort(dt);
          if (escort?.speedCap != null) this.capHostEscortSpeed(escort.speedCap);
        }

        this.syncProjectionPose();
        this.syncLeaveTheaterPeaks();
        this.syncHeliGfx(dt);
        this.handleFire(dt);
        this.tickPlayerMuzzles(dt);
        this.updateSmokePuffs(dt);
        this.updateRemotes(dt);
        this.updateFlares(dt);
        this.tickTeslaZaps(dt);
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
    this.updateThermalWreckMarks(dt);
    this.updateEmberGlows(dt);
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
      this.remoteAntennaGfx?.clear();
      this.teslaGfx.clear();
      this.hideTeslaVisuals();
      this.energyTrailGfx.clear();
      this.refractorGfx.clear();
      this.cmGfx.clear();
    } else {
      this.mapGfx.clear();
      this.hideMapHvLabels();
      this.drawHud();
      this.drawMinimap();
      this.drawHvArrows();
      this.drawPlayerHud();
      this.drawTowWires();
      this.drawRemoteAntennas();
      this.drawEnergyTrails();
      this.drawRefractorBeams();
      this.drawTeslaArcs();
      this.drawCountermeasureFx();
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
    this.tickEmpFx(dt, wallDt);
    this.tickWarpDistortFx();
    this.tickCloakFx();
    this.tickTestPostFx(wallDt);

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
        if (this.heli.phase !== "dead" && this.completedHv.size < this.world.hv.length) {
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
    if (!hvAlive && this.heli.phase !== "dead" && !this.missionEndQueued) {
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
    if (perfOn && !mapPause) {
      this.recordPerfSample(dms, performance.now() - perfSceneStart);
    }
  }

  spriteOrigin(key: string): { x: number; y: number } {
    if (key === "craft_apache_rotor") return { x: this.rotor.originX, y: this.rotor.originY };
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
      camo: specOf(kind).forcedCamo ?? camoForBiome(sampleBiome(this.world, x, y)),
    };
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
    const h = this.heli;
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
      this.hideAimChrome();
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
          ? this.pickTeslaTarget(
              this.teslaMuzzleOrigin(h.weapon),
              this.worldPointer()
            )
          : undefined;
      const aim = this.reticleAimWorld(arcAim ?? this.reticleUnit());
      const gunI = aimSlot != null ? this.gunVisualIndexForSlot(aimSlot) : 0;
      const from = this.guns[gunI]?.visible
        ? this.gunTip(gunI)
        : screenToWorldAtZ(aimMount.x, aimMount.y + bob, h.z);
      let want = Math.atan2(aim.y - from.y, aim.x - from.x);
      // Spotting / call-strike: drive the host howitzer station (may be automatic).
      const spotSlot = this.hostSpotSlewSlot();
      const hostWalk = this.callStrikeMarks.find(
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
      this.slewCraftTurretStations(h, want, dt, spotSlot >= 0 ? spotSlot : h.weapon);
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
      const gunSc = (craft.gunOverlayScale ?? 1) * (sock?.gunScale ?? 1);
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
    const cloakA = this.cloakT > 0 ? 0.14 : 1;
    this.body.setAlpha(cloakA);
    this.shadow.setVisible(this.cloakT <= 0 && this.shadow.visible);
    this.shadow.setAlpha(this.cloakT > 0 ? 0 : this.shadow.alpha);
    for (const rotor of this.rotors) {
      rotor.setAlpha(cloakA);
      const wrap = rotor.getData("tiltWrap") as Phaser.GameObjects.Container | undefined;
      if (wrap?.scene) wrap.setAlpha(cloakA);
    }
    for (const gun of this.guns) gun.setAlpha(cloakA);
    const bodyDepth = worldDepth(h.z, ZOff.body, h.y);
    const bodyWrap = this.body.getData("tiltWrap") as Phaser.GameObjects.Container | undefined;
    if (bodyWrap?.scene) {
      if (bodyWrap.depth !== bodyDepth) bodyWrap.setDepth(bodyDepth);
      bodyWrap.setAlpha(cloakA);
    } else {
      this.body.setDepth(bodyDepth);
    }
    this.muzzle.setDepth(worldDepth(h.z, ZOff.muzzle, h.y));
    this.syncReticles();
    this.emitDustOff(dt);
    this.emitCraftExhaust(dt);
    this.emitJetWingTrails(dt);
  }

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
    const h = this.heli;
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
    const cloakMul = this.cloakT > 0 ? 0.12 : 1;

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
    const h = this.heli;
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
    const spec = this.loadout[h.weapon]!;
    const bombDrop = spec.launch.mode === "drop";
    const square = spec.cam.reticle === "square";
    // Former kind==="cannon": tracer muzzle guns (incl. plasma energy trail).
    const gunSight =
      spec.launch.mode !== "beam" &&
      spec.launch.mode !== "drop" &&
      !spec.guidance &&
      (!!spec.art.tracer || (spec.launch.mode === "muzzle" && !spec.exhaust));
    this.reticle.setTexture(
      !bombDrop && square && this.textures.exists("mark_reticle_sq") ? "mark_reticle_sq" : "mark_reticle"
    );
    const ammoLeft = this.ammo[h.weapon] ?? 0;
    const ammoShown = this.remotePoolDisplayAmmo(h.weapon, ammoLeft);
    if (spec.launch.mode === "beam") {
      this.drawReticleAmmoBar(p.x, p.y, ammoShown, spec.ammo);
    } else {
      this.drawReticleTally(p.x, p.y, !gunSight ? ammoShown : 0, spec.ammo);
    }
    // Remote slot: gun remotes keep a POV sight while selected; others have no laser.
    // POV-HUD remotes (HOUND) fall through to their own loadout sight below.
    if (payloadIsRemote(spec.payload)) {
      const live = this.selectedSlotRemote();
      if (live && remoteHasPovHud(live.spec)) {
        // Handled by povHudRemote sight path.
      } else if (live && remoteGunId(live.spec) && !(live.spec.ai && !live.spec.pilotable)) {
        this.sight.setVisible(true);
        this.sight.clear();
        const aimAng = live.gunAngle ?? live.angle;
        const muzzle = this.remoteGunMuzzle(live);
        const gunSpec = this.loadout[h.weapon]!;
        const origin = this.playerShotOrigin(muzzle, aimAng, gunSpec, h.weapon);
        const clip = this.playerSightAimWorld(origin.x, origin.y, origin.z, aimAng);
        if (this.sightPastMuzzle(origin, clip, h.weapon, { x: live.x, y: live.y })) {
          const from = worldToScreen(origin.x, origin.y, origin.z);
          const to = worldToScreen(clip.x, clip.y, clip.z);
          this.drawSightLine(from.x, from.y, to.x, to.y, "cannon", false, clip);
        }
        this.sight.setDepth(worldDepth(muzzle.z, ZOff.shot + 2, live.y));
        return;
      } else {
        this.sight.clear();
        this.sight.setVisible(false);
        return;
      }
    }
    const povRem = this.povHudRemote();
    if (povRem) {
      const remSpec = this.hudLoadout()[this.hudWeapon()]!;
      const ammoLeft = this.hudAmmo()[this.hudWeapon()] ?? 0;
      const remSlot = Phaser.Math.Clamp(povRem.weapon ?? 0, 0, (povRem.loadout?.length ?? 1) - 1);
      const remSocket = povRem.spec.sockets?.[remSlot];
      const bombDrop = remSpec.launch.mode === "drop";
      const remGunSight =
        remSpec.launch.mode !== "beam" &&
        remSpec.launch.mode !== "drop" &&
        !remSpec.guidance &&
        (!!remSpec.art.tracer || (remSpec.launch.mode === "muzzle" && !remSpec.exhaust));
      this.reticle.setTexture(
        remSpec.cam.reticle === "square" && this.textures.exists("mark_reticle_sq")
          ? "mark_reticle_sq"
          : "mark_reticle"
      );
      const hostAmmoId = this.remoteHostAmmoWeapon(remSpec);
      const hostSpec = hostAmmoId ? PLAYER_WPNS[hostAmmoId as WpnId] : undefined;
      const remAmmoCap = hostSpec?.ammo ?? remSpec.ammo;
      if (remSpec.launch.mode === "beam") {
        this.drawReticleAmmoBar(p.x, p.y, ammoLeft, remAmmoCap);
      } else {
        this.drawReticleTally(p.x, p.y, !remGunSight ? ammoLeft : 0, remAmmoCap);
      }
      this.sight.setVisible(true);
      this.sight.clear();
      if (bombDrop) {
        this.drawRemoteBombTrajectory(povRem, remSlot, remSpec, this.worldPointer());
        return;
      }
      const hull = povRem.spec.craftLook ? craftOf(povRem.spec.craftLook) : undefined;
      const planeFixed =
        !!hull &&
        craftControlScheme(hull) === "plane" &&
        remSocket?.class === "fixed";
      const aimAng = planeFixed
        ? povRem.angle
        : remSocket?.class === "hardpoint"
          ? povRem.angle
          : (povRem.gunAngle ?? povRem.angle);
      const tips = this.remoteSightOrigins(povRem, remSlot);
      let drew = false;
      let tipZ = tips[0]?.z ?? povRem.z;
      const pivot = { x: povRem.x, y: povRem.y };
      for (const tip of tips) {
        const origin = this.playerShotOrigin(tip, aimAng, remSpec, remSlot);
        const clip = this.playerSightAimWorld(origin.x, origin.y, origin.z, aimAng);
        if (!this.sightPastMuzzle(origin, clip, remSlot, pivot)) continue;
        const from = worldToScreen(origin.x, origin.y, origin.z);
        const to = worldToScreen(clip.x, clip.y, clip.z);
        this.drawSightLine(
          from.x,
          from.y,
          to.x,
          to.y,
          remGunSight ? "cannon" : "missile",
          !remGunSight,
          clip
        );
        tipZ = tip.z;
        drew = true;
      }
      if (!drew) this.sight.clear();
      this.sight.setDepth(worldDepth(tipZ, ZOff.shot + 2, povRem.y));
      return;
    }
    if (launchIsArcBeam(spec.launch)) {
      this.sight.clear();
      this.sight.setVisible(false);
      return;
    }
    this.sight.setVisible(true);
    this.syncSightDepth(h.weapon);
    if (bombDrop) {
      this.drawBombTrajectory(aim);
      return;
    }
    // Mouse designator: free aim at reticle from socket muzzle mounts (spiders, laser/command AG).
    if (spec.cam.sight === "mouse") {
      this.drawMouseDesignatorSight(h.weapon);
      return;
    }
    if (gunSight) {
      const tips = this.cannonSightOrigins(h.weapon);
      const socket = h.spec.sockets[h.weapon];
      const aimAng =
        socket?.class === "fixed"
          ? h.angle
          : (h.stationAim[h.weapon]?.[0] ?? h.gunAngle);
      this.sight.clear();
      let drew = false;
      for (const tip of tips) {
        const origin = this.playerShotOrigin(tip, aimAng, spec, h.weapon);
        const clip = this.playerSightAimWorld(origin.x, origin.y, origin.z, aimAng);
        if (!this.sightPastMuzzle(origin, clip, h.weapon)) continue;
        const from = worldToScreen(origin.x, origin.y, origin.z);
        const to = worldToScreen(clip.x, clip.y, clip.z);
        this.drawSightLine(from.x, from.y, to.x, to.y, "cannon", false, clip);
        drew = true;
      }
      if (!drew) this.sight.clear();
      return;
    }
    const pylon = this.hardpointPylon();
    const origin = this.playerShotOrigin(pylon, h.angle, spec, h.weapon);
    const clip = this.playerSightAimWorld(origin.x, origin.y, origin.z, h.angle);
    if (!this.sightPastMuzzle(pylon, clip, h.weapon)) {
      this.sight.clear();
      return;
    }
    const from = worldToScreen(origin.x, origin.y, origin.z);
    const to = worldToScreen(clip.x, clip.y, clip.z);
    this.drawSightLine(from.x, from.y, to.x, to.y, "missile", true, clip);
  }

  /**
   * Free-aim laser at the reticle (not boresight). Emits from socket muzzle
   * mounts — hull ports / gun tips — never from wing hardpoint pylons.
   */
  drawMouseDesignatorSight(slot = this.heli.weapon): void {
    const tips = this.designatorSightOrigins(slot);
    const z = this.playerMuzzleZ(slot);
    const tgt = this.reticleAimWorld(this.reticleUnit());
    this.sight.clear();
    let drew = false;
    for (const tip of tips) {
      const clip = this.sightTerrainHitWorld(tip.x, tip.y, z, tgt.x, tgt.y, tgt.z);
      if (!this.sightPastMuzzle(tip, clip, slot)) continue;
      const from = worldToScreen(tip.x, tip.y, z);
      const to = worldToScreen(clip.x, clip.y, clip.z);
      this.drawSightLine(from.x, from.y, to.x, to.y, "missile", false, clip);
      drew = true;
    }
    if (!drew) this.sight.clear();
  }

  /**
   * Designator emit tips for the selected slot: authored muzzle / socket points
   * only (fixed→body muzzles, turret→gun tips, hardpoint→that socket's mounts).
   * Does not fall back to other wing pylons.
   */
designatorSightOrigins(slot = this.heli.weapon): { x: number; y: number }[] {
  const h = this.heli;
  const socket = h.spec.sockets[slot];
  let tips: { x: number; y: number }[] = [];
  if (socket?.class === "turret") {
    const barrelN = Math.max(1, craftSocketBarrelCount(h.spec, slot));
    for (let b = 0; b < barrelN; b++) {
      const gunI = this.gunVisualIndexForSlot(slot, b);
      const gun = this.guns[gunI] ?? this.gun;
      if (!gun?.visible) continue;
      const muzzles = lookupSpriteMuzzles(gun.texture.key);
      if (!muzzles.length) continue;
      for (let i = 0; i < muzzles.length; i++) tips.push(this.gunTip(gunI, i));
    }
  } else if (socket) {
    // fixed → muzzle UVs; hardpoint → this socket's stores only (not every rack).
    const mounts = craftSocketPoints(h.spec, socket);
    if (mounts.length) tips = mounts.map((m) => this.craftBodyMountWorldPos(m));
  }
  if (!tips.length) {
    const bodyMuzzles = craftFixedMuzzles(h.spec);
    if (bodyMuzzles.length) tips = bodyMuzzles.map((m) => this.craftBodyMountWorldPos(m));
    else tips = [{ x: h.x, y: h.y }];
  }
  // One beam at the average multi-muzzle / multi-gun tip.
  return collapseSightTips(tips);
}

  /** Laser sorts under the hull for chin guns; above for roof mounts. */
  syncSightDepth(slot = this.heli.weapon): void {
    const h = this.heli;
    const z = this.playerMuzzleZ(slot);
    const off =
      h.spec.sockets[slot]?.gunLayer === "above"
        ? this.playerMuzzleDepthOff(slot)
        : ZOff.body - 0.2;
    this.sight.setDepth(worldDepth(z, off, h.y));
  }

  /** True once the aim point is past the barrel (pivot → muzzle + 1). */
  sightPastMuzzle(
    emit: { x: number; y: number },
    clip: { x: number; y: number },
    slot = this.heli.weapon,
    pivot?: { x: number; y: number }
  ): boolean {
    let px = pivot?.x ?? this.heli.x;
    let py = pivot?.y ?? this.heli.y;
    if (!pivot) {
      const h = this.heli;
      const socket = h.spec.sockets[slot];
      if (socket?.class === "turret") {
        const gun = this.guns[this.gunVisualIndexForSlot(slot)] ?? this.gun;
        if (gun?.visible) {
          const at = screenToWorldAtZ(gun.x, gun.y, h.z);
          px = at.x;
          py = at.y;
        }
      }
    }
    const near = Math.hypot(emit.x - px, emit.y - py) + 1;
    return Math.hypot(clip.x - px, clip.y - py) > near;
  }

  /** Dotted curve estimating gravity-bomb path from the active bay. */
  drawBombTrajectory(aim: { x: number; y: number }): void {
    const h = this.heli;
    const spec = this.loadout[h.weapon]!;
    const g = this.sight;
    g.clear();
    const pylon = this.hardpointPylon(h.weapon);
    const release = this.bombReleaseVelocity(spec, pylon.x, pylon.y, aim, 0, h.weapon);
    this.strokeBombTrajectoryPath(
      pylon.x,
      pylon.y,
      h.z + ZOff.shot,
      release,
      spec,
      aim
    );
  }

  /** Bomb arc from a POV remote bay (Raptor). */
  drawRemoteBombTrajectory(
    drone: RemoteCraft,
    slot: number,
    spec: PlayerWpnSpec,
    aim: { x: number; y: number }
  ): void {
    const tip = this.remoteSightOrigins(drone, slot)[0] ?? {
      x: drone.x,
      y: drone.y,
      z: drone.z,
    };
    const release = this.remoteBombReleaseVelocity(drone, spec, tip.x, tip.y, aim, slot);
    this.sight.clear();
    this.strokeBombTrajectoryPath(tip.x, tip.y, tip.z, release, spec, aim);
    this.sight.setDepth(worldDepth(tip.z, ZOff.shot + 2, drone.y));
  }

  strokeBombTrajectoryPath(
    ox: number,
    oy: number,
    oz: number,
    release: { vx: number; vy: number; vz: number },
    spec: PlayerWpnSpec,
    aim: { x: number; y: number }
  ): void {
    const g = this.sight;
    let x = ox;
    let y = oy;
    let z = oz;
    let vx = release.vx;
    let vy = release.vy;
    let vz = release.vz;
    const grav = launchGravity(spec.launch)?.acceleration ?? 210;
    const term = launchGravity(spec.launch)?.terminalVelocity ?? 520;
    const step = 1 / 36;
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i < 140; i++) {
      vz = Math.max(-term, vz - grav * step);
      x += vx * step;
      y += vy * step;
      z += vz * step;
      const gnd = groundZ(this.world, x, y);
      const at = worldToScreen(x, y, z);
      pts.push({ x: at.x, y: at.y });
      if (z <= gnd + 4) break;
      if (targetingMode(spec.guidance) === "waypoint") {
        const want = Math.atan2(aim.y - y, aim.x - x);
        const da = Phaser.Math.Angle.Wrap(want - Math.atan2(vy, vx));
        const rate = (spec.guidance?.flight.turnRate ?? 1.5) * step;
        const face = Math.atan2(vy, vx) + Phaser.Math.Clamp(da, -rate, rate);
        const horiz = Math.hypot(vx, vy);
        vx = Math.cos(face) * horiz;
        vy = Math.sin(face) * horiz;
      }
    }
    g.lineStyle(2, 0xf0d56a, 0.85);
    for (let i = 0; i < pts.length; i++) {
      if (i % 2 === 1) continue;
      const a = pts[i]!;
      const b = pts[Math.min(i + 1, pts.length - 1)]!;
      g.lineBetween(a.x, a.y, b.x, b.y);
    }
    const impact = pts[pts.length - 1];
    if (impact) {
      g.lineStyle(1.8, 0xf0d56a, 0.95);
      g.strokeCircle(impact.x, impact.y, 9);
      g.lineStyle(1.2, 0xf0d56a, 0.55);
      g.strokeCircle(impact.x, impact.y, 14);
    }
  }

  /** Bomb release from a remote hull — same loft search as player craft. */
  remoteBombReleaseVelocity(
    drone: RemoteCraft,
    spec: PlayerWpnSpec,
    ox: number,
    oy: number,
    aim: { x: number; y: number },
    slot: number
  ): { vx: number; vy: number; vz: number; angle: number } {
    const hull = drone.spec.craftLook ? craftOf(drone.spec.craftLook) : undefined;
    const socket = drone.spec.sockets?.[slot];
    const tune = hull
      ? craftBombDrop(hull, socket)
      : { momentum: 0.4, maxBoost: 70, loft: 90, loftMax: 160 };
    return this.bombReleaseFrom(spec, ox, oy, aim, 0, {
      vx: drone.vx,
      vy: drone.vy,
      vz: drone.vz ?? 0,
      z0: drone.z + drone.spec.height * 0.4,
      angle: drone.angle,
      tune,
    });
  }

  /**
   * Momentum-first bomb release: inherit craft velocity, then apply a capped boost
   * to steer impact toward the aim. Never brakes along-track (short aim → pure momentum).
   * Lateral correction is prioritized within maxBoost (stationary throw budget), then any
   * leftover boost extends along-track. Tries higher loft when more range / arc is needed.
   */
  bombReleaseVelocity(
    spec: PlayerWpnSpec,
    ox: number,
    oy: number,
    aim: { x: number; y: number },
    yawOff: number,
    slot?: number
  ): { vx: number; vy: number; vz: number; angle: number } {
    const h = this.heli;
    const socket = slot != null ? h.spec.sockets[slot] : h.spec.sockets[h.weapon];
    return this.bombReleaseFrom(spec, ox, oy, aim, yawOff, {
      vx: h.vx,
      vy: h.vy,
      vz: h.vz,
      z0: h.z + ZOff.shot,
      angle: h.angle,
      tune: craftBombDrop(h.spec, socket),
    });
  }

  /** Shared bomb release solver for host and remote hulls. */
  bombReleaseFrom(
    spec: PlayerWpnSpec,
    ox: number,
    oy: number,
    aim: { x: number; y: number },
    yawOff: number,
    kin: {
      vx: number;
      vy: number;
      vz: number;
      z0: number;
      angle: number;
      tune: CraftBombDrop;
    }
  ): { vx: number; vy: number; vz: number; angle: number } {
    const grav = launchGravity(spec.launch)?.acceleration ?? 210;
    const term = launchGravity(spec.launch)?.terminalVelocity ?? 520;
    const { tune } = kin;
    const gnd = groundZ(this.world, aim.x, aim.y);
    const baseVx = kin.vx * tune.momentum;
    const baseVy = kin.vy * tune.momentum;
    const wantDx = aim.x - ox;
    const wantDy = aim.y - oy;
    const aimAng =
      Math.hypot(wantDx, wantDy) > 1e-3 ? Math.atan2(wantDy, wantDx) : kin.angle + yawOff;

    const loftLo = tune.loft;
    const loftHi = Math.max(loftLo, tune.loftMax ?? loftLo);
    let best: {
      vx: number;
      vy: number;
      vz: number;
      miss: number;
      loft: number;
    } | null = null;

    for (let i = 0; i < 9; i++) {
      const loft = loftLo + ((loftHi - loftLo) * i) / 8;
      const vz = Math.max(0, kin.vz) + loft;
      const fallT = this.estimateBombFallTime(kin.z0, vz, gnd, grav, term);
      const wantVx = wantDx / fallT;
      const wantVy = wantDy / fallT;
      let bx = wantVx - baseVx;
      let by = wantVy - baseVy;
      const bMag = Math.hypot(bx, by);
      if (bMag > tune.maxBoost && bMag > 1e-6) {
        const s = tune.maxBoost / bMag;
        bx *= s;
        by *= s;
      }
      const vx = baseVx + bx;
      const vy = baseVy + by;
      const landX = ox + vx * fallT;
      const landY = oy + vy * fallT;
      const miss = Math.hypot(landX - aim.x, landY - aim.y);
      if (
        !best ||
        miss < best.miss - 5 ||
        (miss <= best.miss + 16 && loft > best.loft)
      ) {
        best = { vx, vy, vz, miss, loft };
      }
      if (miss < 10) break;
    }

    const pick = best!;
    return {
      vx: pick.vx,
      vy: pick.vy,
      vz: pick.vz,
      angle: Math.hypot(pick.vx, pick.vy) > 1e-3 ? Math.atan2(pick.vy, pick.vx) : aimAng,
    };
  }

  /** Approximate time for a gravity bomb to reach ground from release. */
  estimateBombFallTime(
    z0: number,
    vz0: number,
    gnd: number,
    grav: number,
    term: number
  ): number {
    let z = z0;
    let vz = vz0;
    let t = 0;
    const step = 1 / 30;
    for (let i = 0; i < 120; i++) {
      vz = Math.max(-term, vz - grav * step);
      z += vz * step;
      t += step;
      if (z <= gnd + 4) return Math.max(0.2, t);
    }
    return Math.max(0.2, t);
  }

  /**
   * Sample altitude after `t` seconds under the same gravity model as flight
   * (`vz -= g*dt`, clamp to `-terminalVelocity`).
   */
  sampleBallisticAltitude(
    z0: number,
    vz0: number,
    t: number,
    grav: number,
    term: number
  ): number {
    let z = z0;
    let vz = vz0;
    let left = Math.max(0, t);
    const step = 1 / 60;
    while (left > 1e-4) {
      const dt = Math.min(step, left);
      vz = Math.max(-term, vz - grav * dt);
      z += vz * dt;
      left -= dt;
    }
    return z;
  }

  /**
   * Solve muzzle `vz0` so a gravity lob lands at `tz` after flight time `t`
   * (XY travel is constant-speed; gravity only pulls Z).
   * Free-fall closed form, then binary-search refine when terminal velocity bites.
   */
  solveBallisticMuzzleVz(
    z0: number,
    tz: number,
    t: number,
    grav: number,
    term = 1e9
  ): number {
    const flightT = Math.max(0.05, t);
    // Free-fall: z = z0 + vz0*t - 0.5*g*t^2  →  vz0 = (tz-z0)/t + 0.5*g*t
    let vz0 = (tz - z0) / flightT + 0.5 * grav * flightT;
    const end = this.sampleBallisticAltitude(z0, vz0, flightT, grav, term);
    if (Math.abs(end - tz) < 2) return vz0;

    // Terminal clamp bent the arc — bracket and refine.
    let lo = vz0 - grav * flightT - Math.abs(tz - z0);
    let hi = vz0 + grav * flightT + Math.abs(tz - z0);
    for (let i = 0; i < 8; i++) {
      const zLo = this.sampleBallisticAltitude(z0, lo, flightT, grav, term);
      const zHi = this.sampleBallisticAltitude(z0, hi, flightT, grav, term);
      if (zLo <= tz && tz <= zHi) break;
      lo -= grav * flightT;
      hi += grav * flightT;
    }
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) * 0.5;
      const zMid = this.sampleBallisticAltitude(z0, mid, flightT, grav, term);
      if (zMid < tz) lo = mid;
      else hi = mid;
      vz0 = mid;
    }
    return vz0;
  }

  /**
   * Reticle muzzle velocity for ballistic shots.
   * With gravity: loft `vz` so the shell lands on the aim point.
   * Without: straight-line aim (existing gun behavior).
   */
  muzzleAimVelocity(opts: {
    dx: number;
    dy: number;
    dz: number;
    z0: number;
    tz: number;
    spd: number;
    vx: number;
    vy: number;
    alongZ?: number;
    grav?: WeaponGravity;
  }): { vz: number; life: number } {
    const distXY = Math.max(8, Math.hypot(opts.dx, opts.dy));
    const vxy = Math.max(40, Math.hypot(opts.vx, opts.vy));
    if (opts.grav) {
      const flightT = distXY / vxy;
      const vz = this.solveBallisticMuzzleVz(
        opts.z0,
        opts.tz,
        flightT,
        opts.grav.acceleration,
        opts.grav.terminalVelocity ?? 1e9
      );
      return { vz, life: flightT + 0.08 };
    }
    const dist3 = Math.max(8, Math.hypot(opts.dx, opts.dy, opts.dz));
    const t = dist3 / Math.max(40, opts.spd);
    return { vz: opts.dz / t + (opts.alongZ ?? 0), life: t + 0.05 };
  }

  /**
   * Shared laser / ballistic aim. XY follows `aimAng` (gun / nose). The
   * reticle is unprojected in 2.5D: onto ground, or onto the unit/building
   * height under the cursor (not the ground point behind the sprite).
   */
  playerSightAimWorld(
    ox: number,
    oy: number,
    oz: number,
    aimAng: number,
    unit?: Unit,
    aimAt?: { x: number; y: number }
  ): { x: number; y: number; z: number } {
    const tgt = unit ?? this.reticleUnit();
    const ptr = aimAt
      ? {
          x: aimAt.x,
          y: aimAt.y,
          z: tgt
            ? tgt.z + heightOf(tgt.kind) * 0.5
            : groundZ(this.world, aimAt.x, aimAt.y),
        }
      : this.reticleAimWorld(tgt);
    const along = Math.max(8, projectAlong(ox, oy, aimAng, ptr.x, ptr.y));
    const bx = ox + Math.cos(aimAng) * along;
    const by = oy + Math.sin(aimAng) * along;
    const hit = this.sightTerrainHitWorld(ox, oy, oz, bx, by, ptr.z);
    if (this.aimCraftIsPlane()) return this.clampJetGunAim(ox, oy, oz, aimAng, hit);
    return hit;
  }

  /** Host hangar craft or POV remote hull — jets share gun-depress clamp. */
  aimCraftIsPlane(): boolean {
    const pov = this.povHudRemote();
    if (pov?.spec.craftLook) {
      return craftControlScheme(craftOf(pov.spec.craftLook)) === "plane";
    }
    return craftControlScheme(this.heli.spec) === "plane";
  }

  /**
   * Jets cannot depress the nose gun straight down — clamp the aim ray to a
   * max pitch from horizontal (laser + ballistics share this).
   */
  clampJetGunAim(
    ox: number,
    oy: number,
    oz: number,
    aimAng: number,
    hit: { x: number; y: number; z: number }
  ): { x: number; y: number; z: number } {
    const dx = hit.x - ox;
    const dy = hit.y - oy;
    const dz = hit.z - oz;
    const distXY = Math.max(8, Math.hypot(dx, dy));
    const pitch = Math.atan2(dz, distXY);
    const clamped = Phaser.Math.Clamp(pitch, -JET_GUN_MAX_DEPRESS, JET_GUN_MAX_ELEV);
    if (Math.abs(clamped - pitch) < 1e-4) return hit;
    const along = distXY;
    return {
      x: ox + Math.cos(aimAng) * along,
      y: oy + Math.sin(aimAng) * along,
      z: oz + Math.tan(clamped) * along,
    };
  }

  /** Actual leave point: barrel tip + tracer-origin nudge (`spawnShot` applies the same). */
  playerShotOrigin(
    tip: { x: number; y: number; z?: number },
    angle: number,
    spec: PlayerWpnSpec,
    slot = this.heli.weapon
  ): { x: number; y: number; z: number } {
    const z = tip.z ?? this.playerMuzzleZ(slot);
    const xy = this.shotSpawnXY(tip.x, tip.y, angle, z, spec.art.look, spec.art.scale ?? 1);
    return { x: xy.x, y: xy.y, z };
  }

  /**
   * World Z for muzzle leave (host + remotes share this).
   * Chin / under-body guns sit slightly below the hull (`ZOff.shot`);
   * top-mounted turrets (`gunLayer: "above"`) leave from the roof (baseZ + height).
   */
  craftMuzzleLeaveZ(
    baseZ: number,
    height: number,
    gunLayer?: "below" | "above"
  ): number {
    return gunLayer === "above" ? baseZ + height : baseZ + ZOff.shot;
  }

  /** World Z for player muzzle leave. */
  playerMuzzleZ(slot = this.heli.weapon): number {
    const h = this.heli;
    return this.craftMuzzleLeaveZ(h.z, h.spec.height, h.spec.sockets[slot]?.gunLayer);
  }

  /** World Z for remote muzzle leave — same gunLayer rules as the host craft. */
  remoteMuzzleZ(drone: RemoteCraft, slot?: number): number {
    const sockets = drone.spec.sockets;
    const sock =
      slot != null
        ? sockets?.[slot]
        : sockets?.find((s) => s.class === "turret") ?? sockets?.[0];
    return this.craftMuzzleLeaveZ(drone.z, drone.spec.height, sock?.gunLayer);
  }

  /** Painter offset for muzzle flash / spark / beam so top mounts sort above the hull. */
  playerMuzzleDepthOff(slot = this.heli.weapon): number {
    return this.heli.spec.sockets[slot]?.gunLayer === "above"
      ? ZOff.turret + 0.25
      : ZOff.muzzle + 0.15;
  }

  /**
   * Screen cursor → world point on the aim plane. A sprite under the reticle
   * uses the camera ray at that body's height (feet→head by screen Y), then
   * snaps onto the footprint so thin troops aren't aimed behind their billboard.
   */
  reticleAimWorld(unit?: Unit): { x: number; y: number; z: number } {
    const scr = this.pointerScreen();
    if (!unit) {
      const g = screenToWorldOnGround(this.world, scr.x, scr.y);
      return { x: g.x, y: g.y, z: g.z };
    }
    const h = heightOf(unit.kind);
    const z0 = unit.z;
    const z1 = z0 + h;
    const feetY = worldToScreen(unit.x, unit.y, z0).y;
    const headY = worldToScreen(unit.x, unit.y, z1).y;
    const span = feetY - headY;
    const t = Math.abs(span) < 1 ? 0.5 : Phaser.Math.Clamp((feetY - scr.y) / span, 0, 1);
    const z = z0 + h * t;
    const at = screenToWorldAtZ(scr.x, scr.y, z);
    const fp = footprintOf(unit);
    if (pointInFootprint(at.x, at.y, fp)) return { x: at.x, y: at.y, z };
    const snapped = closestOnFootprint(at.x, at.y, fp);
    return { x: snapped.x, y: snapped.y, z };
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

  drawSightLine(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    kind: "cannon" | "missile",
    clear = true,
    /** World hit used for tip sparkle (terrain-swept reflection flicker). */
    tipHit?: { x: number; y: number; z: number }
  ): void {
    const g = this.sight;
    if (clear) g.clear();
    const missile = kind === "missile";
    const thermal = this.thermalOn;
    // Thermal: encode as semantic heat (magenta) so the post shader reads the beam as hot.
    const line = thermal ? thermalSignalTint(1) : missile ? 0xff2a18 : 0x4dff62;
    const glow = thermal ? thermalSignalTint(0.92) : missile ? 0xff6a3a : line;
    const halo = thermal ? thermalSignalTint(0.98) : missile ? 0xff8a62 : 0x5cff6a;
    const core = thermal ? thermalSignalTint(1) : missile ? 0xffece4 : 0xd8ffc4;
    const aMul = thermal ? 1.35 : 1;
    const dx = x1 - x0;
    const dy = y1 - y0;
    if (dx * dx + dy * dy >= 36) {
      const segs = 28;
      for (let i = 0; i < segs; i++) {
        const t0 = i / segs;
        const t1 = (i + 1) / segs;
        // Normal: quadratic fade (dead zone near muzzle). Thermal: linear so it
        // fades out all the way to the origin instead of vanishing early.
        const t = thermal ? t1 : t1 * t1;
        if (thermal) {
          // Same stroke widths as missile, hotter alphas + faint halo.
          g.lineStyle(4.6, glow, Math.min(1, t * 0.16 * aMul));
          g.lineBetween(x0 + dx * t0, y0 + dy * t0, x0 + dx * t1, y0 + dy * t1);
          g.lineStyle(2.4, glow, Math.min(1, t * 0.48 * aMul));
          g.lineBetween(x0 + dx * t0, y0 + dy * t0, x0 + dx * t1, y0 + dy * t1);
          g.lineStyle(1.15, line, Math.min(1, t * 0.82 * aMul));
          g.lineBetween(x0 + dx * t0, y0 + dy * t0, x0 + dx * t1, y0 + dy * t1);
        } else if (missile) {
          g.lineStyle(2.4, glow, Math.min(1, t * 0.32 * aMul));
          g.lineBetween(x0 + dx * t0, y0 + dy * t0, x0 + dx * t1, y0 + dy * t1);
          g.lineStyle(1.15, line, Math.min(1, t * 0.55 * aMul));
          g.lineBetween(x0 + dx * t0, y0 + dy * t0, x0 + dx * t1, y0 + dy * t1);
        } else {
          g.lineStyle(1, line, t * 0.42);
          g.lineBetween(x0 + dx * t0, y0 + dy * t0, x0 + dx * t1, y0 + dy * t1);
        }
      }
    }
    this.drawSightTip(x1, y1, {
      missile,
      thermal,
      aMul,
      glow,
      halo,
      core,
      tipHit,
    });
  }

  /**
   * Soft bloom at the laser contact point. Size jitters from a spatial hash of the
   * hit (incl. ground z as salt) so sweeping across terrain reads as a live reflection.
   */
  drawSightTip(
    x: number,
    y: number,
    opt: {
      missile: boolean;
      thermal: boolean;
      aMul: number;
      glow: number;
      halo: number;
      core: number;
      tipHit?: { x: number; y: number; z: number };
    }
  ): void {
    const g = this.sight;
    const hit = opt.tipHit;
    let sparkle = 0.55;
    if (hit) {
      // Cheap hash — continuous enough that neighboring cells blend, discrete enough to flicker.
      const n =
        Math.sin(hit.x * 0.071 + hit.z * 0.13) * 12.9898 +
        Math.cos(hit.y * 0.063 - hit.z * 0.09) * 78.233 +
        Math.sin((hit.x + hit.y) * 0.037 + hit.z * 0.21) * 4.141;
      sparkle = Phaser.Math.Clamp(0.5 + 0.5 * Math.sin(n), 0, 1);
      // Mild temporal shimmer so a parked tip still breathes.
      const t = this.time.now * 0.001;
      sparkle = Phaser.Math.Clamp(
        sparkle * (0.9 + 0.1 * Math.sin(t * 11.3 + n * 0.7)) +
          0.05 * Math.sin(t * 23.1 + hit.z * 0.4),
        0,
        1
      );
    }
    const sizeMul = Phaser.Math.Linear(0.72, 1.32, sparkle);
    const base = opt.thermal ? 2.35 : opt.missile ? 2.05 : 1.55;
    const r = base * sizeMul;
    const a = opt.aMul;
    // Soft falloff rings (outer → core) instead of three hard discs.
    g.fillStyle(opt.glow, Math.min(1, 0.1 * a));
    g.fillCircle(x, y, r * 2.55);
    g.fillStyle(opt.glow, Math.min(1, 0.18 * a));
    g.fillCircle(x, y, r * 1.85);
    g.fillStyle(opt.halo, Math.min(1, 0.32 * a));
    g.fillCircle(x, y, r * 1.28);
    g.fillStyle(opt.halo, Math.min(1, 0.58 * a));
    g.fillCircle(x, y, r * 0.82);
    g.fillStyle(opt.core, Math.min(1, 0.92 * a));
    g.fillCircle(x, y, r * 0.42);
    g.fillStyle(opt.core, 1);
    g.fillCircle(x, y, r * 0.22);
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

  /** Beam weapons: subtle circular reserve (drains clockwise from full). */
  drawReticleAmmoBar(cx: number, cy: number, count: number, max: number): void {
    const g = this.reticleMark;
    g.clear();
    if (!Number.isFinite(max) || max <= 0) {
      g.setVisible(false);
      return;
    }
    g.setVisible(true);
    const frac = Phaser.Math.Clamp(
      this.infAmmo || !Number.isFinite(count) ? 1 : count / max,
      0,
      1
    );
    // Top-right of the reticle mark, clear of the reticle ring.
    const r = 7;
    const ox = cx + 34;
    const oy = cy - 34;
    const start = -Math.PI / 2;
    // Track
    g.lineStyle(1.5, 0x000000, 0.4);
    g.beginPath();
    g.arc(ox, oy, r, 0, Math.PI * 2, false);
    g.strokePath();
    g.lineStyle(1.15, 0xe8b84a, 0.22);
    g.beginPath();
    g.arc(ox, oy, r, 0, Math.PI * 2, false);
    g.strokePath();
    // Remaining ammo arc (full ring → empty), clockwise from 12 o'clock.
    if (frac > 0.002) {
      const end = start + Math.PI * 2 * frac;
      g.lineStyle(1.6, 0xe8b84a, 0.62);
      g.beginPath();
      g.arc(ox, oy, r, start, end, false);
      g.strokePath();
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
    const at = screenToWorldAtZ(sx, sy, this.heli.z);
    return { x: at.x, y: at.y };
  }

  /** Snap tip glow on fire. Fixed muzzles skip. */
  pulseTurretGunHeat(gunI: number): void {
    if (gunI < 0 || gunI >= this.guns.length) return;
    this.gunTipHeat[gunI] = Math.min(1, (this.gunTipHeat[gunI] ?? 0) + 0.05);
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

/**
 * Laser-sight emit points for the selected cannon slot.
 * Multi-muzzle / multi-gun stations collapse to one beam at the average tip.
 */
cannonSightOrigins(slot = this.heli.weapon): { x: number; y: number }[] {
  const h = this.heli;
  const socket = h.spec.sockets[slot];
  let tips: { x: number; y: number }[] = [];
  if (socket?.class === "fixed") {
    const muzzles = craftSocketPoints(h.spec, socket);
    if (muzzles.length) tips = muzzles.map((m) => this.craftBodyMountWorldPos(m));
  } else if (socket?.class === "turret") {
    const barrelN = Math.max(1, craftSocketBarrelCount(h.spec, slot));
    for (let b = 0; b < barrelN; b++) {
      const gunI = this.gunVisualIndexForSlot(slot, b);
      const gun = this.guns[gunI] ?? this.gun;
      if (!gun?.visible) continue;
      const muzzles = lookupSpriteMuzzles(gun.texture.key);
      if (!muzzles.length) continue;
      for (let i = 0; i < muzzles.length; i++) tips.push(this.gunTip(gunI, i));
    }
  }
  if (!tips.length) {
    const bodyMuzzles = craftFixedMuzzles(h.spec);
    if (bodyMuzzles.length) tips = bodyMuzzles.map((m) => this.craftBodyMountWorldPos(m));
    else tips = [this.gunTip(this.gunVisualIndexForSlot(slot))];
  }
  return collapseSightTips(tips);
}

  /** @deprecated Prefer cannonSightOrigins — kept for single-tip call sites. */
  cannonSightOrigin(slot = this.heli.weapon): { x: number; y: number } {
    return this.cannonSightOrigins(slot)[0] ?? { x: this.heli.x, y: this.heli.y };
  }

/** World position of an authored mount UV on the active craft body (live draw pose). */
craftBodyMountWorldPos(mount: { x: number; y: number }): { x: number; y: number } {
  const h = this.heli;
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

  /** World position of a craft hardpoint UV. */
  hardpointWorldPos(mount: { x: number; y: number }): { x: number; y: number } {
    return this.craftBodyMountWorldPos(mount);
  }

  /** World position of the next hardpoint emit tip (cycles by remaining ammo). */
  hardpointPylon(
    slot = this.heli.weapon,
    /** True when called after `spendAmmo` (fire); false for laser sight (next shot). */
    afterSpend = false
  ): { x: number; y: number; side: number } {
    const h = this.heli;
    const socket = h.spec.sockets[slot];
    const mounts =
      socket && socket.class === "hardpoint"
        ? craftSocketPoints(h.spec, socket)
        : craftHardpointMounts(h.spec);
    const ammo = this.ammo[slot] ?? 0;
    const index = hardpointAmmoIndex(ammo, mounts.length, afterSpend);
    const mount = mounts[index] ?? mounts[0]!;
    const side = mount.x < craftOrigin(h.spec).x ? -1 : 1;
    return { ...this.hardpointWorldPos(mount), side };
  }

  handleFire(dt: number): void {
    const h = this.heli;
    const ptr = this.worldPointer();
    const down = this.input.activePointer.isDown;
    const pressed = down && !this.pointerWasDown;
    const released = !down && this.pointerWasDown;

    for (let i = 0; i < this.stationFireCd.length; i++) {
      const barrels = this.stationFireCd[i]!;
      for (let b = 0; b < barrels.length; b++) {
        barrels[b] = Math.max(0, (barrels[b] ?? 0) - dt);
      }
    }

    this.tickPendingSalvos(dt, ptr);
    this.tickCallStrikeMarks(dt);
    this.teslaLive = null;
    if (!launchIsArcBeam(this.loadout[h.weapon]?.launch)) {
      this.teslaHead = null;
      this.teslaLockId = undefined;
    }

    if (h.phase === "flight" && this.canFire && !this.debugOpen && !this.editOpen && !this.helpOpen && !this.exitOpen) {
      this.tickAutomaticStations(dt, ptr);
    }

    this.tickLockOn(dt, ptr);

    if (h.phase !== "flight" || !this.canFire || this.debugOpen || this.editOpen || this.helpOpen || this.exitOpen) {
      this.pointerWasDown = down;
      return;
    }

    // POV remote loadout owns fire while piloting (HOUND) — bird guns stay parked.
    const pov = this.povHudRemote();
    if (pov && !pov.airborne) {
      this.handlePovRemoteFire(pov, dt, ptr, down, pressed, released);
      this.pointerWasDown = down;
      return;
    }

    const slot = h.weapon;
    const spec = this.loadout[slot]!;
    const socket = h.spec.sockets[slot]!;

    // Slot disabled (e.g. primary guns under cloak) — keep input latch, no fire.
    if (this.weaponSlotDisabled(slot)) {
      this.pointerWasDown = down;
      return;
    }

    // Crew-served automatic: when selected, player aims (syncHeliGfx) and fires
    // with the weapon's normal control mode. Unselected autos fire from tickAutomaticStations.
    if (socket.controller === "automatic") {
      // Call-strike walk owns this station — no manual howitzer during barrage.
      if (this.hostWeaponStrikeActive(spec.id)) {
        this.pointerWasDown = down;
        return;
      }
      let wantFire = false;
      if (spec.control.mode === "hold_mouse_down") wantFire = down;
      else if (spec.control.mode === "click" || spec.control.mode === "click_then_click_to_commit") {
        wantFire = pressed;
      } else if (spec.control.mode === "lock_then_click") {
        wantFire = (pressed || down) && !!h.lockTarget;
      } else if (spec.control.mode === "click_to_set_target") {
        if (pressed) this.designateLatch = { x: ptr.x, y: ptr.y };
        if (down && this.designateLatch) this.designateLatch = { x: ptr.x, y: ptr.y };
        wantFire = released && !!this.designateLatch;
        if (wantFire) this.designateLatch = null;
      }
      if (wantFire && this.hasAmmo(slot)) {
        const n = Math.max(1, craftSocketBarrelCount(h.spec, slot));
        const barrels =
          this.stationFireCd[slot] ??
          (this.stationFireCd[slot] = Array.from({ length: n }, () => 0));
        while (barrels.length < n) barrels.push(0);
        for (let b = 0; b < barrels.length; b++) {
          if ((barrels[b] ?? 0) > 0 || !this.hasAmmo(slot)) continue;
          barrels[b] = craftSocketFireCd(spec.fireCd, h.spec, slot);
          this.firePlayerWeapon(slot, spec, ptr, 0, undefined, undefined, undefined, b);
        }
      }
      this.pointerWasDown = down;
      return;
    }

    // Designate latch: press captures aim, release fires.
    if (spec.control.mode === "click_to_set_target") {
      if (pressed) this.designateLatch = { x: ptr.x, y: ptr.y };
      if (down && this.designateLatch) this.designateLatch = { x: ptr.x, y: ptr.y };
    } else if (pressed) {
      this.designateLatch = null;
    }

    // NLOS second click: commit terminal to lock or aim point; do not fire again.
    // Camera stays on the missile through the dash, then lingers on impact.
    if (
      spec.control.mode === "click_then_click_to_commit" &&
      targetingMode(spec.guidance) === "steer_commit" &&
      pressed
    ) {
      const active = this.shots.find(
        (s) => s.from === "player" && s.wpnId === spec.id && s.st && !s.st.terminal && !s.st.bomblet
      );
      if (active?.st) {
        this.commitNlosTerminal(active, ptr);
        this.pointerWasDown = down;
        return;
      }
    }

    // Remote: live pod for this HUD slot — POV remotes stay in their HUD; Spectre detonates in view.
    // AI wingmen (Skiffs) never bind mouse fire — fall through so more can launch while LIVE.
    if (payloadIsRemote(spec.payload)) {
      const live = this.selectedSlotRemote();
      if (live) {
        if (remoteHasPovHud(live.spec)) {
          // POV-HUD remotes fire only inside their own HUD (handlePovRemoteFire).
          // Never auto-reenter here — that undoes Q exit every frame while the
          // HOUND slot stays selected (and briefly flashes the dropship bomb arc).
          this.pointerWasDown = down;
          return;
        }
        if (live.spec.ai && !live.spec.pilotable) {
          // Skiffs / AI-only: launch more if ammo remains.
        } else if (remoteGunId(live.spec)) {
          // Legacy single-gun remotes: selected + alive = player fire only.
          if (down) this.fireRemoteGun(live, dt);
          this.pointerWasDown = down;
          return;
        } else if (pressed) {
          if (this.remoteView) live.detonate = true;
          else this.enterRemoteView();
          this.pointerWasDown = down;
          return;
        } else {
          this.pointerWasDown = down;
          return;
        }
      }
      // Dead / none / AI wingmen — fall through to launch another if ammo remains.
    }

    let wantFire = false;
    if (spec.control.mode === "hold_mouse_down") wantFire = down;
    else if (spec.control.mode === "click" || spec.control.mode === "click_then_click_to_commit") wantFire = pressed;
    else if (spec.control.mode === "lock_then_click") wantFire = (pressed || down) && !!h.lockTarget;
    else if (spec.control.mode === "click_to_set_target") wantFire = released && !!this.designateLatch;

    // Hold-arc beams: keep the stream live while held; spend on cadence.
    if (launchIsArcBeam(spec.launch)) {
      if (down && this.hasAmmo(slot)) {
        const spend = h.fireCd <= 0;
        if (spend) {
          h.fireCd = craftSocketFireCd(spec.fireCd, h.spec, slot);
          this.spendAmmo(slot);
          // Turret coils heat the overlay barrel; fixed belly coils skip.
          if (socket.class !== "fixed") {
            this.pulseTurretGunHeat(this.gunVisualIndexForSlot(slot));
          }
        }
        this.updateTeslaArc(slot, spec, ptr, spend, dt);
      } else {
        this.teslaLive = null;
        this.teslaHead = null;
        this.teslaLockId = undefined;
      }
      this.pointerWasDown = down;
      return;
    }

    if (!wantFire || h.fireCd > 0 || !this.hasAmmo(slot)) {
      this.pointerWasDown = down;
      return;
    }

    const hullAim =
      socket.class === "fixed" || socket.class === "hardpoint";
    if (socket.traverse && !hullAim) {
      // Cabin/turret guns are clamped into traverse while aiming; always legal to fire.
      // Fixed muzzles have no aim arc — they fire along the hull.
      const barrels = h.stationAim[slot] ?? (h.stationAim[slot] = [h.gunAngle]);
      for (let b = 0; b < barrels.length; b++) {
        const trav = this.stationTraverseForBarrel(slot, b)!;
        barrels[b] = clampAimToStationArc(barrels[b] ?? h.gunAngle, h.angle, trav);
      }
      h.gunAngle = barrels[0]!;
    }

    h.fireCd = craftSocketFireCd(spec.fireCd, h.spec, slot);
    const salvoN = spec.fire?.salvo?.count ?? 1;
    const interval = spec.fire?.salvo?.interval ?? 0;
    const spread = spec.fire?.salvo?.spread ?? 0;
    const cone = undefined;
    const gx = this.designateLatch?.x;
    const gy = this.designateLatch?.y;
    if (spec.control.mode === "click_to_set_target") this.designateLatch = null;

    if (cone != null && salvoN > 1) {
      for (let i = 0; i < salvoN; i++) {
        const u = Math.random();
        const v = Math.random() * Math.PI * 2;
        const r = cone * Math.sqrt(u);
        this.firePlayerWeapon(slot, spec, ptr, Math.cos(v) * r, gx, gy, undefined, undefined, Math.sin(v) * r);
      }
      this.pointerWasDown = down;
      return;
    }

    // Plasma Helix: quick burst with phase-rotated strands (not simultaneous).
    if (payloadIsHelix(spec.payload) && salvoN > 1) {
      const strands = Math.max(1, spec.payload.helix?.strands ?? 1);
      for (let i = 0; i < salvoN; i++) {
        const phase = (i / strands) * Math.PI * 2;
        if (i === 0) {
          this.firePlayerWeapon(slot, spec, ptr, 0, gx, gy, undefined, undefined, 0, phase);
        } else {
          this.pendingSalvos.push({
            t: interval * i,
            slot,
            wpnId: wpnIdOf(spec),
            yawOff: 0,
            gx,
            gy,
            helixPhase: phase,
          });
        }
      }
      this.pointerWasDown = down;
      return;
    }

    const yaw0 = salvoN > 1 ? (0 - (salvoN - 1) / 2) * spread : 0;
    this.firePlayerWeapon(slot, spec, ptr, yaw0, gx, gy);
    for (let i = 1; i < salvoN; i++) {
      this.pendingSalvos.push({
        t: interval * i,
        slot,
        wpnId: wpnIdOf(spec),
        yawOff: (i - (salvoN - 1) / 2) * spread,
        gx,
        gy,
      });
    }
    this.pointerWasDown = down;
  }

  tickPendingSalvos(dt: number, ptr: { x: number; y: number }): void {
    if (!this.pendingSalvos.length) return;
    const h = this.heli;
    for (let i = this.pendingSalvos.length - 1; i >= 0; i--) {
      const p = this.pendingSalvos[i]!;
      p.t -= dt;
      if (p.t > 0) continue;
      this.pendingSalvos.splice(i, 1);
      if (h.phase !== "flight" || !this.canFire || this.weaponSlotDisabled(p.slot)) continue;
      const spec = this.loadout[p.slot];
      if (!spec || spec.id !== p.wpnId || !this.hasAmmo(p.slot)) continue;
      const auto =
        p.autoTargetId != null
          ? this.units.find((u) => !u.dead && u.id === p.autoTargetId)
          : undefined;
      this.firePlayerWeapon(p.slot, spec, ptr, p.yawOff, p.gx, p.gy, auto, p.barrel, 0, p.helixPhase);
    }
  }

  /** Arm a reusable mark-then-call barrage at the flare's rest point. */
  armCallStrike(
    x: number,
    y: number,
    z: number,
    spec: NonNullable<WeaponPayload["callStrike"]>,
    spawnFrom?: { x: number; y: number; z: number },
    hostWeapon?: string
  ): void {
    const markZ = Math.max(z, groundZ(this.world, x, y));
    // Default: inbound from one map-width to the right. Host-spawn = dropship fire support.
    const spawnX = spawnFrom?.x ?? x + WORLD;
    const spawnY = spawnFrom?.y ?? y;
    const spawnZ = spawnFrom?.z ?? 1500;
    const delayT = Math.max(0, spec.delay ?? 0);
    const hostSpec = hostWeapon ? PLAYER_WPNS[hostWeapon as WpnId] : undefined;
    const shellSpeed = hostSpec?.speed ?? spec.shellSpeed ?? 400;
    const interval = hostSpec
      ? Math.max(0.12, hostSpec.fireCd)
      : Math.max(0.12, spec.interval);
    let roundsLeft = Math.max(1, spec.rounds | 0);
    if (hostWeapon && !this.infAmmo) {
      const left = this.hostWeaponAmmoLeft(hostWeapon);
      if (left != null && Number.isFinite(left)) {
        roundsLeft = Math.min(roundsLeft, Math.max(0, left | 0));
      }
    }
    if (roundsLeft <= 0) return;
    const flightDist = hostWeapon
      ? Math.hypot(this.heli.x - x, this.heli.y - y)
      : Math.hypot(spawnX - x, spawnY - y);
    const firstImpactEta = delayT + flightDist / Math.max(80, shellSpeed);
    this.callStrikeMarks.push({
      id: this.nextCallStrikeMarkId++,
      x,
      y,
      z: markZ,
      delayT,
      roundsLeft,
      interval,
      intervalT: 0,
      jitter: Math.max(8, spec.jitter),
      shellDmg: hostSpec?.dmg ?? spec.shellDmg,
      shellBlast: hostSpec?.blast ?? spec.shellBlast,
      shellLook: hostSpec?.art.look ?? spec.shellLook,
      shellSpeed,
      spawnX,
      spawnY,
      spawnZ,
      hitsLanded: 0,
      flareUntilHits: Math.max(1, spec.flareUntilHits ?? 3),
      firstImpactEta,
      hostWeapon,
      wobbleT: 0,
      aimX: x,
      aimY: y,
    });
  }

  /** Back-and-forth walk aim around a host call-strike mark (slew + fire point). */
  tickHostCallStrikeAim(
    m: (typeof this.callStrikeMarks)[number],
    dt: number
  ): void {
    m.wobbleT = (m.wobbleT ?? 0) + dt;
    const t = m.wobbleT;
    // Slow rotating axis; primary sin back-forth + lighter lateral sway.
    const axis = t * 0.41;
    const amp = m.jitter * (0.5 + 0.45 * (0.5 + 0.5 * Math.sin(t * 0.85)));
    const along = Math.sin(t * 2.15) * amp;
    const side = Math.sin(t * 0.73 + 1.1) * amp * 0.32;
    const ca = Math.cos(axis);
    const sa = Math.sin(axis);
    m.aimX = m.x + ca * along - sa * side;
    m.aimY = m.y + sa * along + ca * side;
  }

  tickCallStrikeMarks(dt: number): void {
    if (!this.callStrikeMarks.length) {
      this.hideCallStrikeEtaTxt();
      return;
    }
    let w = 0;
    let etaI = 0;
    for (const m of this.callStrikeMarks) {
      // Host howitzer walk: flare dies when the last shell is fired (hits aren't tagged).
      // Off-map barrages: keep signaling until the first few impacts land.
      const showFlare = m.hostWeapon
        ? m.roundsLeft > 0
        : m.hitsLanded < m.flareUntilHits;
      if (m.firstImpactEta > 0) m.firstImpactEta = Math.max(0, m.firstImpactEta - dt);

      // Heavy upward flare column while the mark is still signaling.
      if (showFlare && cameraPointVisible(m.z, m.y) && this.fxChance(0.92)) {
        const at = worldToScreen(m.x, m.y, m.z + 6);
        this.withTrailFx(1.7, () => {
          const nf = this.fxEmitCount(1.45);
          const ns = this.fxEmitCount(1.35);
          if (nf) {
            this.emitBudgeted(
              "fire",
              this.fxAt(m.z, m.y, this.signalFlareTrail, ZOff.fire + 0.4),
              at.x,
              at.y,
              nf
            );
          }
          if (ns) {
            this.emitBudgeted(
              "smoke",
              this.fxAt(m.z, m.y, this.signalFlareSmoke, ZOff.smoke),
              at.x,
              at.y,
              ns
            );
          }
        });
        if (this.fxChance(0.7)) {
          this.emitVisualBurst(
            m.x,
            m.y,
            m.z + 10,
            {
              n: 3,
              spdMin: 80,
              spdMax: 280,
              bx: range(-0.12, 0.12),
              by: -0.95,
              bz: 1.45,
              tight: 0.42,
              scaleMul: 0.75,
              gravity: 28,
              depthOff: ZOff.fire + 0.8,
            },
            this.signalFlareSpark
          );
        }
      }

      // ETA only until first impact — then the label goes away.
      if (m.firstImpactEta > 0) {
        this.syncCallStrikeEtaTxt(m, etaI++);
      }

      if (m.delayT > 0) {
        m.delayT -= dt;
        if (m.hostWeapon) this.tickHostCallStrikeAim(m, dt);
        this.callStrikeMarks[w++] = m;
        continue;
      }

      if (m.hostWeapon) {
        // Real howitzer walk: shared station CD, wobble aim, one shell per ready cycle.
        this.tickHostCallStrikeAim(m, dt);
        const aim = { x: m.aimX ?? m.x, y: m.aimY ?? m.y };
        if (this.hostStationFireReady(m.hostWeapon) && this.hostStationAlignedTo(m.hostWeapon, aim)) {
          const ok = this.fireHostWeaponAt(m.hostWeapon, aim, { fromStrike: true });
          if (!ok) {
            // Dry / missing mount — end the walk. CD-not-ready is handled above.
            m.roundsLeft = 0;
          } else {
            m.roundsLeft--;
          }
        }
        if (m.roundsLeft > 0) this.callStrikeMarks[w++] = m;
        continue;
      }

      m.intervalT -= dt;
      while (m.intervalT <= 0 && m.roundsLeft > 0) {
        this.spawnCallStrikeShell(m);
        m.roundsLeft--;
        m.intervalT += m.interval;
      }
      // Off-map: keep until authored rounds AND flare-until-hits are satisfied.
      if (m.roundsLeft > 0 || m.hitsLanded < m.flareUntilHits) {
        this.callStrikeMarks[w++] = m;
      }
    }
    this.callStrikeMarks.length = w;
    for (let i = etaI; i < this.callStrikeEtaTxt.length; i++) {
      const t = this.callStrikeEtaTxt[i];
      if (t?.active) t.setVisible(false);
    }
  }

  hideCallStrikeEtaTxt(): void {
    for (const t of this.callStrikeEtaTxt) {
      if (t?.active) t.setVisible(false);
    }
  }

  syncCallStrikeEtaTxt(
    m: (typeof this.callStrikeMarks)[number],
    i: number
  ): void {
    const at = worldToScreen(m.x, m.y, m.z + 10);
    if (!this.projectedInView(at.x, at.y, 80) || m.firstImpactEta <= 0) {
      const existing = this.callStrikeEtaTxt[i];
      if (existing?.active) existing.setVisible(false);
      return;
    }
    const txt = this.acquireCallStrikeEtaTxt(i);
    txt
      .setText(`${Math.max(1, Math.ceil(m.firstImpactEta))}s`)
      .setVisible(true)
      .setPosition(at.x, at.y - 18 * at.scale)
      .setDepth(worldDepth(m.z, ZOff.fire + 2, m.y))
      .setScale(Math.max(0.85, at.scale))
      .setAlpha(0.9);
  }

  acquireCallStrikeEtaTxt(i: number): Phaser.GameObjects.Text {
    while (this.callStrikeEtaTxt.length <= i) {
      this.callStrikeEtaTxt.push(this.makeCallStrikeEtaTxt());
    }
    const existing = this.callStrikeEtaTxt[i];
    if (!existing || !existing.active || !existing.scene) {
      this.callStrikeEtaTxt[i] = this.makeCallStrikeEtaTxt();
    }
    return this.callStrikeEtaTxt[i]!;
  }

  makeCallStrikeEtaTxt(): Phaser.GameObjects.Text {
    const t = this.add
      .text(0, 0, "", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "13px",
        color: "#ff6a7a",
      })
      .setOrigin(0.5, 1)
      .setDepth(Layer.FIELD)
      .setVisible(false)
      .setStroke("#2a080c", 3)
      .setAlpha(0.9);
    this.bindFieldHud(t);
    return t;
  }

  /** One off-map shell on a lofted ballistic arc toward the mark (+disk jitter). */
  spawnCallStrikeShell(m: (typeof this.callStrikeMarks)[number]): void {
    const hit = jitterDisk(m.x, m.y, m.jitter);
    const tx = hit.x;
    const ty = hit.y;
    const tz = groundZ(this.world, tx, ty);
    // Same spawn for every round so inbound timing stays consistent.
    const sx = m.spawnX;
    const sy = m.spawnY;
    const sz = m.spawnZ;
    const dx = tx - sx;
    const dy = ty - sy;
    const distXY = Math.max(80, Math.hypot(dx, dy));
    const spd = Math.max(80, m.shellSpeed);
    const flightT = distXY / spd;
    const vx = (dx / distXY) * spd;
    const vy = (dy / distXY) * spd;
    // Mild gravity on a high spawn: mostly aimed at the mark, with a gentle
    // descending curve (not a sky-high loft) that steepens a bit on the way in.
    const grav = { acceleration: 22, terminalVelocity: 720 };
    const vz = this.solveBallisticMuzzleVz(
      sz,
      tz,
      flightT,
      grav.acceleration,
      grav.terminalVelocity
    );
    const ang = Math.atan2(dy, dx);
    this.spawnShot({
      from: "player",
      beh: {
        art: { look: m.shellLook, scale: 0.58, face: "velocity" },
        exhaust: {
          kind: "particles",
          size: 0.55,
          density: 0.85,
          contrail: true,
          // Base of the warhead (nose is tip-biased SHOT_ORIGIN).
          emitUv: { x: 0.08, y: 0.5 },
        },
        cam: { reticle: "round", look: { pull: 0.2, max: 88, rate: 10 } },
        control: { mode: "click" },
        launch: {
          mode: "muzzle",
          inheritMomentum: 0,
          gravity: grav,
        },
        payload: { detonate: { look: "fire", bigBoom: true } },
        cruiseSpeed: spd,
        dmg: m.shellDmg,
        blast: m.shellBlast,
        dmgMul: { building: 1.4, vehicle: 1.2, troop: 0.85, air: 0.2 },
      },
      st: {
        age: 0,
        launchAngle: ang,
        bomblet: true,
        opened: true,
        callStrikeMarkId: m.id,
        callStrikeTx: tx,
        callStrikeTy: ty,
        callStrikeTz: tz,
      },
      x: sx,
      y: sy,
      z: sz,
      vx,
      vy,
      vz,
      angle: ang,
      life: flightT + 0.35,
      blast: m.shellBlast,
      dmg: m.shellDmg,
      look: m.shellLook,
      scale: 0.58,
      fxInterval: 0.12,
    });
  }

  noteCallStrikeImpact(markId: number): void {
    for (const m of this.callStrikeMarks) {
      if (m.id === markId) {
        m.hitsLanded++;
        return;
      }
    }
  }

  /** Spawn one player round from the selected (or automatic) loadout slot. */
  firePlayerWeapon(
    slot: number,
    spec: PlayerWpnSpec,
    ptr: { x: number; y: number },
    yawOff = 0,
    gx?: number,
    gy?: number,
    autoTarget?: Unit,
    barrelIndex = 0,
    pitchOff = 0,
    helixPhase?: number
  ): void {
    const h = this.heli;
    if (!this.hasAmmo(slot)) return;
    this.spendAmmo(slot);
    if (payloadIsRemote(spec.payload)) {
      const socket = h.spec.sockets[slot]!;
      // Fixed remotes leave authored hull muzzles (simultaneous = all, alternate = L/R/…).
      if (socket.class === "fixed") {
        const tips = craftSocketPoints(h.spec, socket);
        if (tips.length) {
          if (socket.muzzleFire === "simultaneous") {
            for (const uv of tips) {
              this.launchRemote(spec, slot, yawOff, pitchOff, this.craftBodyMountWorldPos(uv));
            }
            return;
          }
          const uv =
            socket.muzzleFire === "alternate"
              ? tips[this.playerGunSide++ % tips.length]!
              : tips[0]!;
          this.launchRemote(spec, slot, yawOff, pitchOff, this.craftBodyMountWorldPos(uv));
          return;
        }
      }
      this.launchRemote(spec, slot, yawOff, pitchOff);
      return;
    }
    const mixed = applyKineticCombatMix(
      spec,
      shotBehaviorOf(spec),
      this.cannonMixRound[spec.id] ?? 0
    );
    if (payloadIsKinetic(spec.payload, spec.launch) && spec.payload.he?.every != null) {
      this.cannonMixRound[spec.id] = (this.cannonMixRound[spec.id] ?? 0) + 1;
    }
    const beh = mixed.beh;
    const pierce = mixed.pierce;
    const helixPayload = payloadIsHelix(spec.payload) ? spec.payload.helix! : null;
    const phase = helixPhase ?? 0;
    const st: ShotState = {
      age: 0,
      launchAngle: h.angle + yawOff,
      pierce,
      hitIds: pierce != null ? [] : undefined,
      gx,
      gy,
      helix: helixPayload ? 0 : undefined,
      helixSide: helixPayload ? Math.sin(phase) : undefined,
      helixOff: helixPayload ? 9.5 : undefined,
      helixFreq: helixPayload ? 40 : undefined,
      helixPhase: helixPayload ? phase : undefined,
    };
    if (spec.launch.mode === "muzzle") {
      this.fireMuzzleShot(slot, spec, beh, st, ptr, yawOff, autoTarget, barrelIndex, pitchOff);
    } else if (spec.launch.mode === "kick_motor") {
      this.fireKickMotorShot(slot, spec, beh, st, yawOff, autoTarget);
    } else if (spec.launch.mode === "drop") {
      this.fireDropShot(slot, spec, beh, st, ptr, yawOff);
    } else if (launchIsRayBeam(spec.launch)) {
      if (spec.payload.bounce) {
        this.fireRefractorBeam(slot, spec, ptr, yawOff, barrelIndex);
      } else {
        this.fireMuzzleShot(slot, spec, beh, st, ptr, yawOff, autoTarget, barrelIndex);
      }
    }
  }

  fireMuzzleShot(
    slot: number,
    spec: PlayerWpnSpec,
    beh: ReturnType<typeof shotBehaviorOf>,
    st: ShotState,
    _ptr: { x: number; y: number },
    yawOff: number,
    autoTarget?: Unit,
    barrelIndex = 0,
    pitchOff = 0
  ): void {
    const h = this.heli;
    const socket = h.spec.sockets[slot]!;
    const fixed = socket.class === "fixed";
    const rocketPod = specIsRocketPod(spec);
    // Hardpoint rail: leave the pylon (muzzle projectiles + non-bounce ray beams).
    const railMuzzle =
      !rocketPod &&
      socket.class === "hardpoint" &&
      (spec.launch.mode === "muzzle" || spec.launch.mode === "beam");
    // Hydra pods + hardpoint rails cycle pylons; hull-fixed tips use authored muzzles below.
    if (rocketPod || railMuzzle) {
      const { x: px, y: py, side } = this.hardpointPylon(slot, true);
      const jitter = spec.fire?.jitter ?? 0;
      const ang = h.angle + yawOff + (jitter ? (Math.random() - 0.5) * jitter : 0);
      this.applyPlayerShellRecoil(slot, spec, h.angle + yawOff);
      const pitchJit = pitchOff + (jitter ? (Math.random() - 0.5) * jitter * 0.45 : 0);
      const g = spec.guidance;
      const lockOn = targetingMode(g) === "lock_on";
      const lockId =
        autoTarget?.id ?? (lockOn ? h.lockTarget?.id : undefined);
      const zTgt =
        autoTarget ??
        (lockOn && lockId != null ? this.unitById(lockId) : undefined) ??
        this.reticleUnit();
      const inherit = spec.launch.mode === "muzzle" ? spec.launch.inheritMomentum : 0.35;
      const accelMuzzle = spec.launch.mode === "muzzle" && spec.launch.acceleration != null;
      // Soft leave when accelerating (rail / Hydra); catalog speed for ballistics aim.
      const leaveSpd = accelMuzzle
        ? (spec.launch.mode === "muzzle" ? (spec.launch.leaveSpeed ?? 10) : 10)
        : spec.speed;
      const aimSpd = accelMuzzle ? spec.speed : leaveSpd;
      const cp = Math.cos(pitchJit);
      const sp = Math.sin(pitchJit);
      const origin = this.playerShotOrigin({ x: px, y: py }, ang, spec);
      const clip = this.playerSightAimWorld(
        origin.x,
        origin.y,
        origin.z,
        ang,
        zTgt,
        autoTarget
      );
      const dx = clip.x - origin.x;
      const dy = clip.y - origin.y;
      const dz = clip.z - origin.z;
      const dist3 = Math.max(8, Math.hypot(dx, dy, dz));
      const hFrac = Math.hypot(dx, dy) / dist3;
      const hvx = lockOn
        ? h.vx * inherit + Math.cos(ang) * leaveSpd * cp
        : Math.cos(ang) * leaveSpd * hFrac;
      const hvy = lockOn
        ? h.vy * inherit + Math.sin(ang) * leaveSpd * cp
        : Math.sin(ang) * leaveSpd * hFrac;
      const seekLoft = g && guidanceIsLockOn(g) ? g.targeting.seekDelay : undefined;
      const z0 = h.z + ZOff.shot;
      const grav = !lockOn ? launchGravity(spec.launch) : undefined;
      const aimVel = lockOn
        ? {
            vz:
              h.vz * inherit +
              leaveSpd * sp +
              (accelMuzzle ? 0 : Math.max(28, leaveSpd * 0.08)),
            life: spec.life,
          }
        : this.muzzleAimVelocity({
            dx,
            dy,
            dz,
            z0,
            tz: clip.z,
            spd: aimSpd,
            vx: Math.cos(ang) * aimSpd * hFrac,
            vy: Math.sin(ang) * aimSpd * hFrac,
            grav,
          });
      // Boost rockets: aim as if at cruise, but leave at leaveSpd (scale vz to match).
      const leaveVz = accelMuzzle && !lockOn && aimSpd > 1
        ? aimVel.vz * (leaveSpd / aimSpd)
        : aimVel.vz;
      this.spawnShot({
        from: "player",
        id: nextId(),
        wpnId: wpnIdOf(spec),
        slot,
        beh,
        st: { ...st, launchAngle: ang, seeking: lockOn ? false : undefined },
        x: px,
        y: py,
        z: z0,
        vx: hvx,
        vy: hvy,
        vz: leaveVz,
        angle: ang,
        life: accelMuzzle ? spec.life : aimVel.life,
        targetId: lockId,
        blast: beh.blast,
        dmg: beh.dmg,
        look: spec.art.look,
        scale: spec.art.scale,
        fxInterval: spec.fireCd,
        loft: seekLoft,
        cruise: lockOn || accelMuzzle ? spec.speed : undefined,
        // Tube kick-yaw only — AA rail / boost rockets stay on leave heading.
        yaw: lockOn && !accelMuzzle ? side * (0.35 + Math.random() * 0.2) : undefined,
        energyTrail: exhaustIsEnergy(spec.exhaust) ? [] : undefined,
        energyTrails:
          exhaustRibbons(spec.exhaust) > 1
            ? Array.from({ length: exhaustRibbons(spec.exhaust) }, () => [] as EnergyTrailNode[])
            : undefined,
        warpTimeScale: spec.payload.warp?.timeScale,
      });
      this.missileMuzzle(px, py, h.z, ang, projectileFxScale("player", spec.fireCd));
      if (
specIsShellGun(spec)
      ) {
        this.spawnShellEject({
          x: px,
          y: py,
          z: h.z - 12,
          barrelAng: ang,
          designation: spec.designation,
          scale: spec.art.scale,
          dmg: spec.dmg,
          side,
          aerial: true,
          fireCd: spec.fireCd,
        });
      }
      return;
    }

    const muzzleFire = socket.muzzleFire;
    const authored = fixed ? craftSocketPoints(h.spec, socket) : [];
    const mountedGunI =
      authored.length === 0 ? this.gunVisualIndexForSlot(slot, barrelIndex) : 0;
    // Fixed sockets use body muzzle UVs; turrets use gun-texture muzzles (dual rails).
    type TipRef =
      | { kind: "body"; uv: { x: number; y: number } }
      | { kind: "gun"; muzzleI: number };
    let tipRefs: TipRef[];
    if (authored.length > 0) {
      const uvs =
        muzzleFire === "simultaneous"
          ? authored
          : muzzleFire === "alternate"
            ? [authored[this.playerGunSide++ % authored.length]!]
            : [authored[0]!];
      tipRefs = uvs.map((uv) => ({ kind: "body" as const, uv }));
    } else {
      const gun = this.guns[mountedGunI] ?? this.gun;
      const gunMuzzles = lookupSpriteMuzzles(gun.texture.key);
      if (gunMuzzles.length > 1 && muzzleFire === "simultaneous") {
        tipRefs = gunMuzzles.map((_, i) => ({ kind: "gun" as const, muzzleI: i }));
      } else if (gunMuzzles.length > 1 && muzzleFire === "alternate") {
        tipRefs = [
          {
            kind: "gun" as const,
            muzzleI: this.playerGunSide++ % gunMuzzles.length,
          },
        ];
      } else {
        tipRefs = [{ kind: "gun" as const, muzzleI: 0 }];
      }
    }
    const fxInterval = spec.fireCd / Math.max(1, tipRefs.length);
    const shotFxScale = projectileFxScale("player", fxInterval);
    const spd = spec.speed;
    const baseInherit =
      spec.launch.mode === "muzzle" || spec.launch.mode === "beam"
        ? spec.launch.mode === "muzzle"
          ? spec.launch.inheritMomentum
          : 0.2
        : 0.35;
    const planeish = h.spec.flightModel === "plane" || h.spec.flightModel === "vtol";
    // Plane/VTOL get a bump, but authored 1.0 (jet nose guns) stays full along-rail carry.
    const inherit = planeish ? Math.min(1, baseInherit + 0.28) : baseInherit;
    const stationAng = fixed
      ? h.angle
      : (h.stationAim[slot]?.[barrelIndex] ?? h.stationAim[slot]?.[0] ?? h.gunAngle);
    this.applyPlayerShellRecoil(slot, spec, stationAng + yawOff);
    for (const tipRef of tipRefs) {
      const spreadAmp = spec.fire?.jitter ?? (!(spec.fire?.muzzleFlash ?? true) ? 0.025 : 0.08);
      const spread = spec.launch.mode === "beam" ? 0 : (Math.random() - 0.5) * spreadAmp;
      const ang = stationAng + spread + yawOff + ((st.helixSide ?? 0) * 0.012);
      const tip =
        tipRef.kind === "body"
          ? this.craftBodyMountWorldPos(tipRef.uv)
          : this.gunTip(mountedGunI, tipRef.muzzleI);
      const muzzleUv = tipRef.kind === "body" ? tipRef.uv : undefined;
      const gunMuzzleI = tipRef.kind === "gun" ? tipRef.muzzleI : undefined;
      const tipScr = worldToScreen(tip.x, tip.y, this.playerMuzzleZ(slot));
      const tipScale = tipScr.scale;
      const z0 = this.playerMuzzleZ(slot);
      const origin = this.playerShotOrigin(tip, ang, spec, slot);
      const clip = this.playerSightAimWorld(
        origin.x,
        origin.y,
        origin.z,
        ang,
        autoTarget,
        autoTarget
      );
      const dx = clip.x - origin.x;
      const dy = clip.y - origin.y;
      const dz = clip.z - origin.z;
      const dist3 = Math.max(8, Math.hypot(dx, dy, dz));
      const hFrac = Math.hypot(dx, dy) / dist3;
      const dirx = dx / dist3;
      const diry = dy / dist3;
      const dirz = dz / dist3;
      // Along-rail only: craft speed parallel to the shot axis. No cross-track slip.
      const along =
        inherit !== 0
          ? (h.vx * dirx + h.vy * diry + h.vz * dirz) * inherit
          : 0;
      const hvx = Math.cos(ang) * spd * hFrac + dirx * along;
      const hvy = Math.sin(ang) * spd * hFrac + diry * along;
      const tx = clip.x;
      const ty = clip.y;
      const tz = clip.z;
      const beamRange = spec.launch.mode === "beam" ? spec.launch.range : undefined;
      const g = spec.guidance;
      const lockOn = targetingMode(g) === "lock_on";
      const lockId =
        autoTarget?.id ??
        (lockOn ? h.lockTarget?.id : undefined);
      const seekLoft = g && guidanceIsLockOn(g) ? g.targeting.seekDelay : undefined;
      const grav = !lockOn && beamRange == null ? launchGravity(spec.launch) : undefined;
      const aimVel = lockOn
        ? { vz: Math.max(28, spd * 0.08), life: spec.life }
        : this.muzzleAimVelocity({
            dx,
            dy,
            dz,
            z0,
            tz,
            spd,
            vx: hvx,
            vy: hvy,
            alongZ: dirz * along,
            grav,
          });
      this.spawnShot({
        from: "player",
        id: nextId(),
        wpnId: wpnIdOf(spec),
        slot,
        beh,
        st: {
          ...st,
          launchAngle: ang,
          seeking: lockOn ? false : undefined,
        },
        x: tip.x,
        y: tip.y,
        z: z0,
        vx: hvx,
        vy: hvy,
        vz: aimVel.vz,
        angle: ang,
        life: beamRange != null ? beamRange / spd : aimVel.life,
        targetId: lockId,
        blast: beh.blast,
        dmg: beh.dmg,
        look: spec.art.look,
        scale: spec.art.scale,
        fxInterval,
        loft: seekLoft,
        cruise: lockOn ? spec.speed : undefined,
        tint:
          payloadIsHelix(spec.payload)
            ? 0x66eeff
            : spec.art.tint,
        energyTrail:
          exhaustIsEnergy(spec.exhaust) || st.helixOff != null ? [] : undefined,
        energyTrails:
          exhaustRibbons(spec.exhaust) > 1
            ? Array.from({ length: exhaustRibbons(spec.exhaust) }, () => [] as EnergyTrailNode[])
            : undefined,
        warpTimeScale: spec.payload.warp?.timeScale,
      });
      if (!fixed) this.pulseTurretGunHeat(mountedGunI);
      if (spec.launch.mode === "beam") {
        const beamEnd = worldToScreen(tx, ty, tz);
        const beam = this.add
          .graphics()
          .setDepth(worldDepth(z0, this.playerMuzzleDepthOff(slot), tip.y));
        beam.lineStyle(5 * tipScale, 0x55ddff, 0.24).lineBetween(tipScr.x, tipScr.y, beamEnd.x, beamEnd.y);
        beam.lineStyle(1.5 * tipScale, 0xffffff, 0.95).lineBetween(tipScr.x, tipScr.y, beamEnd.x, beamEnd.y);
        this.tweens.add({ targets: beam, alpha: 0, duration: 110, onComplete: () => beam.destroy() });
      } else if (!!(spec.fire?.muzzleFlash ?? true)) {
        const muzzleMul = playerMuzzleFxMul(spec);
        const sparkMul = Phaser.Math.Linear(0.55, 1, Phaser.Math.Clamp((muzzleMul - 0.4) / 0.6, 0, 1));
        this.emitVisualBurst(tip.x, tip.y, z0, {
          n: scaledProjectileFxCount(8, shotFxScale * Math.sqrt(sparkMul)),
          spdMin: 6 + 6 * sparkMul,
          spdMax: 110 + 90 * sparkMul,
          bx: Math.cos(ang),
          by: Math.sin(ang),
          bz: dz / Math.max(40, dist3),
          tight: 0.9,
          scaleMul: 0.32 * sparkMul,
          stretchMul: 1.55 + 1.05 * sparkMul,
          // 260° full cone; density + speed both favor the aim axis.
          coneHalf: (260 * Math.PI) / 360,
          depthOff: this.playerMuzzleDepthOff(slot),
        }, this.muzzleBurst);
        this.showMuzzle({
          life: 0.1,
          ang,
          scaleMul: 0.78 * muzzleMul * range(0.9, 1.12),
          slot,
          muzzleUv: muzzleUv ?? undefined,
          gunI: muzzleUv ? undefined : mountedGunI,
          gunMuzzleI,
        });
        const craft = h.spec;
        const mountedGun = this.guns[mountedGunI] ?? this.gun;
        const mountedGunUv = craftGunMounts(craft)[mountedGunI] ?? craftGunMount(craft);
        const gunTex = mountedGun.texture.key;
        const gunTips = lookupSpriteMuzzles(gunTex);
        const side = muzzleUv
          ? (muzzleUv.x < craftOrigin(craft).x ? -1 : 1)
          : this.shellEjectSide({
              muzzleUv: gunTips[gunMuzzleI ?? 0] ?? gunTips[0],
              mountUv: mountedGunUv,
            });
        const ejectAt = muzzleUv ? tip : screenToWorldAtZ(mountedGun.x, mountedGun.y, z0);
        if (
specIsShellGun(spec)
        ) {
          this.spawnShellEject({
            x: ejectAt.x,
            y: ejectAt.y,
            z: z0 - 4,
            barrelAng: ang,
            designation: spec.designation,
            scale: spec.art.scale,
            dmg: spec.dmg,
            side,
            aerial: true,
            fireCd: spec.fireCd,
          });
        }
      }
    }
  }

  fireKickMotorShot(
    slot: number,
    spec: PlayerWpnSpec,
    beh: ReturnType<typeof shotBehaviorOf>,
    st: ShotState,
    yawOff: number,
    autoTarget?: Unit
  ): void {
    const h = this.heli;
    const launch = spec.launch;
    if (launch.mode !== "kick_motor") return;
    const { x: px, y: py, side } = this.hardpointPylon(slot, true);
    const ang = h.angle + yawOff;
    const kick = launch.kickSpeed;
    const inherit = launch.inheritMomentum;
    const g = spec.guidance;
    const wantsWire = !!g?.wire;
    const lockId =
      autoTarget?.id ??
      (targetingMode(g) === "lock_on" || targetingMode(g) === "steer_commit"
        ? h.lockTarget?.id
        : undefined);
    const loft = launch.softLoft;
    this.spawnShot({
      from: "player",
      id: nextId(),
      wpnId: wpnIdOf(spec),
      slot,
      beh,
      st: { ...st, launchAngle: ang },
      x: px,
      y: py,
      z: h.z + ZOff.shot,
      vx: h.vx * inherit + Math.cos(ang) * kick,
      vy: h.vy * inherit + Math.sin(ang) * kick,
      vz: h.vz * inherit,
      angle: ang,
      life: spec.life,
      targetId: lockId,
      blast: beh.blast,
      dmg: beh.dmg,
      look: spec.art.look,
      scale: spec.art.scale,
      fxInterval: spec.fireCd,
      // Live povCam chase while the munition is under command.
      povCam: spec.cam.povCam || undefined,
      motor: -launch.igniteDelay,
      cruise: spec.speed,
      loft,
      yaw:
        side *
          (launch.yawMul ??
            (targetingMode(g) === "lock_on" ? 1.05 + Math.random() * 0.45 : 0.42 + Math.random() * 0.22)),
      wireSide: side,
      wire: wantsWire ? [] : undefined,
      tint: spec.art.tint,
      energyTrail: exhaustIsEnergy(spec.exhaust) || st.helixOff != null ? [] : undefined,
      energyTrails:
        exhaustRibbons(spec.exhaust) > 1
          ? Array.from({ length: exhaustRibbons(spec.exhaust) }, () => [] as EnergyTrailNode[])
          : undefined,
      warpTimeScale: spec.payload.warp?.timeScale,
    });
    this.missileMuzzle(px, py, h.z, ang, projectileFxScale("player", spec.fireCd));
  }

  /** Refractor: primary beam to 30% of muzzle→aim, then a tight fan of reflecting child rays. */
  fireRefractorBeam(
    slot: number,
    spec: PlayerWpnSpec,
    _ptr: { x: number; y: number },
    yawOff: number,
    barrelIndex = 0
  ): void {
    const h = this.heli;
    const payload = spec.payload;
    if (spec.launch.mode !== "beam") return;
    const launch = spec.launch;
    const range = launch.mode === "beam" ? launch.range : 780;
    const socket = h.spec.sockets[slot]!;
    let tip: { x: number; y: number };
    let ang = h.angle + yawOff;
    if (socket.class === "hardpoint") {
      tip = this.hardpointPylon(slot, true);
    } else if (socket.class === "fixed") {
      const authored = craftSocketPoints(h.spec, socket);
      const uv =
        socket.muzzleFire === "alternate" && authored.length > 1
          ? authored[this.playerGunSide++ % authored.length]
          : authored[0];
      tip = uv ? this.craftBodyMountWorldPos(uv) : this.hardpointPylon(slot, true);
    } else {
      const gunI = this.gunVisualIndexForSlot(slot, barrelIndex);
      tip = this.gunTip(gunI);
      ang = h.stationAim[slot]?.[barrelIndex] ?? h.gunAngle;
    }
    const tipZ = h.z + ZOff.shot;
    const aim = this.playerSightAimWorld(tip.x, tip.y, tipZ, ang, this.reticleUnit());
    let dx = aim.x - tip.x;
    let dy = aim.y - tip.y;
    let dz = aim.z - tipZ;
    const len = Math.max(1e-3, Math.hypot(dx, dy, dz));
    dx /= len;
    dy /= len;
    dz /= len;
    const aimDist = Math.min(range, len);
    const bounces = payload.bounce ? payload.bounce.maxBounces ?? 3 : 0;
    const splitAt = payload.split?.at;
    const splitN = payload.split?.count ?? 0;
    const doSplit = splitAt != null && splitAt > 0 && splitAt < 1 && splitN >= 2;

    if (!doSplit) {
      this.castRefractorRay(tip.x, tip.y, tipZ, dx, dy, dz, range, bounces, spec, 1);
    } else {
      const splitDist = Math.max(36, aimDist * splitAt);
      // Primary stub has no bounce — unit/ground before the fork ends the shot.
      const end = this.castRefractorRay(
        tip.x,
        tip.y,
        tipZ,
        dx,
        dy,
        dz,
        splitDist,
        0,
        spec,
        1
      );
      if (end) {
        // Fork point: sparks only, strongly biased along the beam (no backsplash / fireball).
        this.emitVisualBurst(
          end.x,
          end.y,
          end.z,
          {
            n: 28,
            spdMin: 140,
            spdMax: 420,
            bx: dx,
            by: dy,
            bz: dz,
            tight: 0.88,
            scaleMul: 0.52,
            stretchMul: 2.35,
            coneHalf: 0.32,
          },
          this.teslaSparkBurst
        );
        this.emitVisualBurst(
          end.x,
          end.y,
          end.z,
          {
            n: 12,
            spdMin: 70,
            spdMax: 220,
            bx: dx,
            by: dy,
            bz: dz,
            tight: 0.72,
            scaleMul: 0.4,
            stretchMul: 1.85,
            coneHalf: 0.55,
          },
          this.teslaSparkBurst
        );
        const splitAt = worldToScreen(end.x, end.y, end.z);
        this.spawnImpactFlash(splitAt.x, splitAt.y, end.z, 0xc070ff, 48 * splitAt.scale, 0.55, 200);
        this.spawnImpactFlash(splitAt.x, splitAt.y, end.z, 0xf0d0ff, 22 * splitAt.scale, 0.85, 140);
        let ax = aim.x - end.x;
        let ay = aim.y - end.y;
        let az = aim.z - end.z;
        const al = Math.max(1e-3, Math.hypot(ax, ay, az));
        ax /= al;
        ay /= al;
        az /= al;
        const rem = Math.max(al, Math.max(80, range - splitDist));
        let ux = -ay;
        let uy = ax;
        let uz = 0;
        let ul = Math.hypot(ux, uy, uz);
        if (ul < 1e-4) {
          ux = 1;
          uy = 0;
          uz = 0;
        } else {
          ux /= ul;
          uy /= ul;
          uz /= ul;
        }
        let vx = ay * uz - az * uy;
        let vy = az * ux - ax * uz;
        let vz = ax * uy - ay * ux;
        const vl = Math.max(1e-3, Math.hypot(vx, vy, vz));
        vx /= vl;
        vy /= vl;
        vz /= vl;
        for (let i = 0; i < splitN; i++) {
          // Wide fan: one center ray + outer cone (~22° half-angle).
          const ring = i === 0 ? 0 : 0.4;
          const a = i === 0 ? 0 : ((i - 1) / Math.max(1, splitN - 1)) * Math.PI * 2;
          let rx = ax + (ux * Math.cos(a) + vx * Math.sin(a)) * ring;
          let ry = ay + (uy * Math.cos(a) + vy * Math.sin(a)) * ring;
          let rz = az + (uz * Math.cos(a) + vz * Math.sin(a)) * ring;
          const rn = Math.max(1e-3, Math.hypot(rx, ry, rz));
          this.castRefractorRay(
            end.x,
            end.y,
            end.z,
            rx / rn,
            ry / rn,
            rz / rn,
            rem,
            bounces,
            spec,
            i === 0 ? 0.7 : 0.38
          );
        }
      }
    }

    this.emitVisualBurst(
      tip.x,
      tip.y,
      tipZ,
      {
        n: 10,
        spdMin: 40,
        spdMax: 180,
        bx: dx,
        by: dy,
        bz: dz,
        tight: 0.75,
        scaleMul: 0.55,
        stretchMul: 1.8,
      },
      this.teslaSparkBurst
    );
  }

  /**
   * March a Refractor ray with ground reflection. Returns the endpoint if the full
   * `rangeLeft` cleared without a unit/ground stop (for mid-air forks).
   */
  castRefractorRay(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    rangeLeft: number,
    bouncesLeft: number,
    spec: PlayerWpnSpec,
    dmgMul: number
  ): { x: number; y: number; z: number } | null {
    const step = 14;
    let x = ox;
    let y = oy;
    let z = oz;
    let traveled = 0;
    const seg0 = { x, y, z };
    while (traveled < rangeLeft) {
      const nx = x + dx * step;
      const ny = y + dy * step;
      const nz = z + dz * step;
      const g0 = groundZ(this.world, x, y);
      const g1 = groundZ(this.world, nx, ny);
      const a0 = z - g0;
      const a1 = nz - g1;
      // Ground reflection.
      if (a0 > 1 && a1 <= 1) {
        const u = a0 / Math.max(1e-4, a0 - a1);
        const hx = x + (nx - x) * u;
        const hy = y + (ny - y) * u;
        const hz = g0 + (g1 - g0) * u;
        this.pushRefractorBeam(seg0.x, seg0.y, seg0.z, hx, hy, hz, spec, dmgMul);
        this.refractorImpact(hx, hy, hz, dx, dy, dz, spec, true);
        if (bouncesLeft <= 0) return null;
        // Bounce = refract: a few smaller beams fan in random directions off the hit.
        const rem = Math.max(70, rangeLeft - traveled);
        const base = norm3(dx, dy, Math.max(0.25, -dz * 0.92));
        const n = 3 + ((Math.random() * 2) | 0); // 3–4 shards
        for (let i = 0; i < n; i++) {
          const d = coneDir(base.x, base.y, base.z, 0.85, 1.6);
          // Keep shards above ground — never bury into the terrain.
          const up = Math.max(0.22, d.z);
          const rn = Math.max(1e-3, Math.hypot(d.x, d.y, up));
          const rx = d.x / rn;
          const ry = d.y / rn;
          const rz = up / rn;
          this.castRefractorRay(
            hx + rx * 6,
            hy + ry * 6,
            hz + 5,
            rx,
            ry,
            rz,
            rem * range(0.5, 0.85),
            0,
            spec,
            dmgMul * range(0.28, 0.42)
          );
        }
        return null;
      }
      // Coarse unit walk — sample several points along this step.
      const hit = this.refractorUnitWalkHit(x, y, z, nx, ny, nz);
      if (hit) {
        this.pushRefractorBeam(seg0.x, seg0.y, seg0.z, hit.x, hit.y, hit.z, spec, dmgMul);
        this.refractorImpact(hit.x, hit.y, hit.z, dx, dy, dz, spec, false);
        // Damage without HE fireball — beam explode path stays kinetic when kind is beam.
        this.explode(
          hit.x,
          hit.y,
          hit.z,
          spec.blast * 0.55 * dmgMul,
          spec.dmg * dmgMul,
          hit.u,
          dx * 120,
          dy * 120,
          dz * 60,
          true,
          "beam",
          1.1
        );
        return null;
      }
      x = nx;
      y = ny;
      z = nz;
      traveled += step;
    }
    this.pushRefractorBeam(seg0.x, seg0.y, seg0.z, x, y, z, spec, dmgMul);
    return { x, y, z };
  }

  /** Sample a segment against unit footprints (coarse walk, generous height). */
  refractorUnitWalkHit(
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number
  ): { x: number; y: number; z: number; u: Unit } | null {
    const samples = 4;
    let best: { x: number; y: number; z: number; u: Unit; t: number } | null = null;
    for (let s = 0; s <= samples; s++) {
      const t = s / samples;
      const px = x0 + (x1 - x0) * t;
      const py = y0 + (y1 - y0) * t;
      const pz = z0 + (z1 - z0) * t;
      for (const u of this.units) {
        if (u.dead) continue;
        const hr = circumRadiusOf(u.kind) + 14;
        if (Math.hypot(px - u.x, py - u.y) > hr) continue;
        if (!pointInFootprint(px, py, footprintInto(u, 12, 0))) continue;
        const top = u.z + heightOf(u.kind);
        // Generous vertical slab so aiming past a hull still clips the body.
        if (pz > top + 18 || pz < u.z - 10) continue;
        if (!best || t < best.t) best = { x: px, y: py, z: pz, u, t };
      }
    }
    return best ? { x: best.x, y: best.y, z: best.z, u: best.u } : null;
  }

  pushRefractorBeam(
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    spec: PlayerWpnSpec,
    dmgMul: number
  ): void {
    const life = Math.max(0.22, spec.life * 1.6 * (0.85 + dmgMul * 0.2));
    this.refractorBeams.push({
      x0,
      y0,
      z0,
      x1,
      y1,
      z1,
      life,
      max: life,
      width: Phaser.Math.Linear(7, 14, dmgMul),
      color: dmgMul > 0.7 ? 0xe8a0ff : 0xb06cff,
    });
    while (this.refractorBeams.length > 48) this.refractorBeams.shift();
  }

  refractorImpact(
    x: number,
    y: number,
    z: number,
    dx: number,
    dy: number,
    dz: number,
    _spec: PlayerWpnSpec,
    ground: boolean
  ): void {
    this.spawnTeslaZap(x, y, z, ground ? 1.15 : 1.35, 1.4);
    this.spawnTeslaZap(x, y, z + 6, 0.85, 1.1);
    this.emitTeslaSparks(x, y, z, ground ? 14 : 18, ground ? 0.9 : 1.15);
    // Colorful spark spray — no HE fireball / blast trails on energy hits.
    this.emitVisualBurst(
      x,
      y,
      z + 2,
      {
        n: 16,
        spdMin: 60,
        spdMax: 280,
        bx: -dx,
        by: -dy,
        bz: Math.abs(dz) + 0.4,
        tight: 0.35,
        scaleMul: 0.7,
        stretchMul: 1.6,
      },
      this.teslaSparkBurst
    );
    const at = worldToScreen(x, y, z);
    this.spawnImpactFlash(at.x, at.y, z, 0xd090ff, 22 * at.scale, 0.7, 120);
    this.shake = Math.min(5.5, this.shake + (ground ? 0.55 : 0.85));
  }

  tickRefractorBeams(dt: number): void {
    let w = 0;
    for (const b of this.refractorBeams) {
      b.life -= dt;
      if (b.life > 0) this.refractorBeams[w++] = b;
    }
    this.refractorBeams.length = w;
  }

  drawRefractorBeams(): void {
    const g = this.refractorGfx;
    g.clear();
    if (!this.refractorBeams.length) return;
    let depth = Number.POSITIVE_INFINITY;
    for (const b of this.refractorBeams) {
      const fade = Phaser.Math.Clamp(b.life / b.max, 0, 1);
      const s0 = worldToScreen(b.x0, b.y0, b.z0);
      const s1 = worldToScreen(b.x1, b.y1, b.z1);
      depth = Math.min(
        depth,
        worldDepth(b.z0, ZOff.shot, b.y0),
        worldDepth(b.z1, ZOff.shot, b.y1)
      );
      const w = Math.max(2.2, b.width * (0.35 + 0.65 * fade));
      g.lineStyle(w * 2.1, b.color, 0.28 * fade);
      g.lineBetween(s0.x, s0.y, s1.x, s1.y);
      g.lineStyle(w * 1.15, 0xe8b0ff, 0.55 * fade);
      g.lineBetween(s0.x, s0.y, s1.x, s1.y);
      g.lineStyle(Math.max(1.4, w * 0.42), 0xfff8ff, 0.95 * fade);
      g.lineBetween(s0.x, s0.y, s1.x, s1.y);
    }
    if (Number.isFinite(depth)) g.setDepth(depth);
  }

  fireDropShot(
    slot: number,
    spec: PlayerWpnSpec,
    beh: ReturnType<typeof shotBehaviorOf>,
    st: ShotState,
    ptr: { x: number; y: number },
    yawOff: number
  ): void {
    const h = this.heli;
    const launch = spec.launch;
    if (launch.mode !== "drop") return;
    const pylon = this.hardpointPylon(slot, true);
    const aim =
      st.gx != null && st.gy != null ? { x: st.gx, y: st.gy } : ptr;
    const release = this.bombReleaseVelocity(spec, pylon.x, pylon.y, aim, yawOff, slot);
    const dropZ = h.z + ZOff.shot;
    const grav = launchGravity(spec.launch);
    const fallT = this.estimateBombFallTime(
      dropZ,
      release.vz,
      groundZ(this.world, aim.x, aim.y),
      grav?.acceleration ?? 210,
      grav?.terminalVelocity ?? 520
    );
    const openFrac = beh.payload.cluster?.openAt;
    const openAge =
      openFrac != null && openFrac > 0 && openFrac < 1
        ? Math.max(0.12, fallT * openFrac)
        : undefined;
    this.spawnShot({
      from: "player",
      id: nextId(),
      wpnId: wpnIdOf(spec),
      slot,
      beh,
      st: {
        ...st,
        launchAngle: release.angle,
        gx: st.gx ?? aim.x,
        gy: st.gy ?? aim.y,
        openAge,
      },
      x: pylon.x,
      y: pylon.y,
      z: dropZ,
      vx: release.vx,
      vy: release.vy,
      vz: release.vz,
      angle: release.angle,
      life: Math.max(spec.life, fallT + 1.2),
      blast: beh.blast,
      dmg: beh.dmg,
      look: spec.art.look,
      scale: spec.art.scale,
      fxInterval: spec.fireCd,
      warpTimeScale: spec.payload.warp?.timeScale,
    });
  }

  /** Whitened sheet for vision-blocking chemical clouds (vs graded fx_smoke for dust/trails). */
  visionSmokeTex(): string {
    return this.textures.exists("fx_smoke_tint") ? "fx_smoke_tint" : "fx_smoke";
  }

  acquireSmokePuffSprite(frame: number): Phaser.GameObjects.Image {
    const key = this.visionSmokeTex();
    const idle = (this.smokePuffG.getChildren() as Phaser.GameObjects.Image[]).find(
      (im) => !im.visible && !this.smokePuffs.some((p) => p.spr === im)
    );
    if (idle) {
      idle.setTexture(key, frame);
      return idle;
    }
    const spr = this.add.image(0, 0, key, frame).setOrigin(0.5).setVisible(false);
    this.smokePuffG.add(spr);
    return spr;
  }

  spawnSmokePuffs(
    x: number,
    y: number,
    z: number,
    radius: number,
    duration: number,
    /** Individual puff draw/vision radius. Smoke bombs keep the default; CM screen uses smaller. */
    puffR: { min: number; max: number } = { min: 80, max: 118 }
  ): void {
    const n = 36;
    // Cool white/gray chemical cloud (not warm beige dust).
    const tints = [0xf2f2f2, 0xe4e4e4, 0xd6d6d6, 0xc8c8c8];
    const gnd = groundZ(this.world, x, y);
    const z0 = Math.max(z, gnd + 10);
    for (let i = 0; i < n; i++) {
      const u = Math.sqrt(Math.random());
      const a = Math.random() * Math.PI * 2;
      const r = u * radius * 0.82;
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r;
      const outA = r < 4 ? Math.random() * Math.PI * 2 : Math.atan2(py - y, px - x) + range(-0.4, 0.4);
      const burst = range(80, 160);
      const frame = i % 4;
      this.smokePuffs.push({
        x: px,
        y: py,
        z: z0 + range(4, 22),
        vx: Math.cos(outA) * burst,
        vy: Math.sin(outA) * burst,
        vz: range(18, 52),
        radius: range(puffR.min, puffR.max),
        t: duration * range(0.88, 1.18),
        max: duration,
        tint: tints[i % tints.length]!,
        spin: range(-0.35, 0.35),
        ang: Math.random() * Math.PI * 2,
        frame,
        spr: this.acquireSmokePuffSprite(frame),
      });
    }
  }

  updateSmokePuffs(dt: number): void {
    let w = 0;
    const puffs = this.smokePuffs;
    const burstDrag = Math.pow(0.08, dt);
    const driftDrag = Math.pow(0.78, dt);
    for (let i = 0; i < puffs.length; i++) {
      const s = puffs[i]!;
      s.t -= dt;
      if (s.t <= 0) {
        s.spr.setVisible(false);
        continue;
      }
      const age = 1 - s.t / s.max;
      const bursting = age < 0.12;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.z += s.vz * dt;
      if (bursting) {
        s.vx *= burstDrag;
        s.vy *= burstDrag;
      } else {
        s.vx *= driftDrag;
        s.vy *= driftDrag;
        s.vx += range(-14, 14) * dt;
        s.vy += range(-14, 14) * dt;
      }
      s.vz *= Math.pow(0.52, dt);
      s.vz += 10 * dt;
      s.ang += s.spin * dt;
      const g = groundZ(this.world, s.x, s.y);
      if (s.z < g + 8) {
        s.z = g + 8;
        if (s.vz < 0) s.vz = 0;
      } else if (s.z > g + 72) {
        s.z = g + 72;
        if (s.vz > 0) s.vz *= 0.2;
      }
      puffs[w++] = s;
    }
    puffs.length = w;
    this.syncSmokePuffSprites();
  }

  syncSmokePuffSprites(): void {
    for (const s of this.smokePuffs) {
      const im = s.spr;
      if (!cameraPointVisible(s.z, s.y)) {
        im.setVisible(false);
        continue;
      }
      const lifeT = Phaser.Math.Clamp(s.t / s.max, 0, 1);
      const age = 1 - lifeT;
      // Grow from ~0 to full quickly (~0.12s) — no hard pop at spawn size.
      const bloom = 1 - Math.exp(-age / 0.055);
      const fade = lifeT > 0.4 ? 1 : Math.pow(lifeT / 0.4, 1.25);
      const at = worldToScreen(s.x, s.y, s.z);
      const zs = at.scale;
      const visualR = s.radius * bloom;
      const key = this.visionSmokeTex();
      if (im.texture.key !== key || im.frame.name !== String(s.frame)) {
        im.setTexture(key, s.frame);
      }
      im.setVisible(true);
      im.setPosition(at.x, at.y);
      im.setDisplaySize(visualR * 2.8 * zs, visualR * 2.15 * zs);
      im.setRotation(s.ang);
      im.setDepth(worldDepth(s.z, ZOff.smoke, s.y));
      // No heat-fill: that stamps solid cold. 2% alpha keeps a ghost of the puff.
      im.clearTint();
      if (!this.thermalOn) im.setTint(s.tint);
      // Dense white/gray chemical screen — higher than dust/exhaust smoke.
      im.setAlpha((this.thermalOn ? 0.02 : 0.84) * fade);
    }
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

  smokeVisionAt(x: number, y: number, pad = 0): number {
    return smokeVisionMul(smokeCoverAt(this.smokePuffs, x, y, pad));
  }

  /**
   * Enemy vision mul from smoke: cover is sampled at the player (smoke screen),
   * with the unit's radius as pad — same proportions as if that unit stood on the heli.
   */
  enemySmokeVision(u: Unit): number {
    const h = this.heli;
    return this.smokeVisionAt(h.x, h.y, radius(u.kind));
  }

  /**
   * Loadout slot cannot fire right now (HUD + fire gate).
   * Reasons are additive — cloak blocks primary gun stations only.
   */
  weaponSlotDisabled(slot: number): boolean {
    const socket = this.heli.spec.sockets[slot];
    if (!socket) return true;
    if (this.cloakT > 0 && craftSocketIsPrimary(socket)) return true;
    return false;
  }

  tickAutomaticStations(dt: number, _ptr: { x: number; y: number }): void {
    const h = this.heli;
    this.autoGunDbg = [];
    for (let slot = 0; slot < this.loadout.length; slot++) {
      const socket = h.spec.sockets[slot];
      const spec = this.loadout[slot]!;
      if (!socket || socket.controller !== "automatic") continue;
      if (this.weaponSlotDisabled(slot)) continue;
      const barrels = h.stationAim[slot] ?? (h.stationAim[slot] = [h.angle]);
      const cds = this.stationFireCd[slot] ?? (this.stationFireCd[slot] = [0]);
      const crewTag = craftCrewHudTag(socket) ?? "CREW";
      const acquire = this.autoStationRange(spec, slot);
      const pushDbg = (
        b: number,
        origin: { x: number; y: number },
        fields: {
          aim: number;
          want: number | null;
          targetId: number | null;
          state: string;
        }
      ) => {
        this.autoGunDbg.push({
          slot,
          barrel: b,
          range: acquire,
          originX: origin.x,
          originY: origin.y,
          heading: h.angle,
          traverse: this.stationTraverseForBarrel(slot, b),
          ...fields,
        });
      };
      // Player owns this station while selected — manual hold-fire in handleFire.
      // Remote spot / call-strike also owns the host howitzer (slewed in syncHeliGfx).
      const spotOwned = this.hostSpotSlewSlot() === slot;
      if (h.weapon === slot || spotOwned) {
        for (let b = 0; b < barrels.length; b++) {
          const prefer = this.autoGunPreferHeading(slot, b);
          const origin = this.autoGunAcquireOrigin(slot, b, prefer, acquire);
          pushDbg(b, origin, {
            aim: barrels[b] ?? h.gunAngle,
            want: barrels[b] ?? h.gunAngle,
            targetId: null,
            state: `${crewTag}${barrels.length > 1 ? ` ${b + 1}` : ""} ${spotOwned ? "SPOT" : "MANUAL"}`,
          });
        }
        continue;
      }
      if (!this.hasAmmo(slot)) {
        for (let b = 0; b < barrels.length; b++) {
          const prefer = this.autoGunPreferHeading(slot, b);
          const origin = this.autoGunAcquireOrigin(slot, b, prefer, acquire);
          pushDbg(b, origin, {
            aim: barrels[b] ?? h.angle,
            want: null,
            targetId: null,
            state: `${crewTag}${barrels.length > 1 ? ` ${b + 1}` : ""} EMPTY`,
          });
        }
        continue;
      }
      for (let b = 0; b < barrels.length; b++) {
        // Full circle when no traverse — don't inherit the nose-front default arc.
        const prefer = this.autoGunPreferHeading(slot, b);
        const origin = this.autoGunAcquireOrigin(slot, b, prefer, acquire);
        const mount = this.autoGunMountWorld(slot, b);
        const trav = this.stationTraverseForBarrel(slot, b);
        const tgt = this.pickAutoTarget(
          origin.x,
          origin.y,
          h.x,
          h.y,
          h.angle,
          acquire,
          trav,
          !trav,
          prefer
        );
        if (!tgt) {
          pushDbg(b, origin, {
            aim: barrels[b] ?? h.angle,
            want: null,
            targetId: null,
            state: `${crewTag}${barrels.length > 1 ? ` ${b + 1}` : ""} IDLE`,
          });
          continue;
        }
        const want = Math.atan2(tgt.y - mount.y, tgt.x - mount.x);
        if (trav && !aimInStationArc(want, h.angle, trav)) {
          pushDbg(b, origin, {
            aim: barrels[b] ?? h.angle,
            want: null,
            targetId: null,
            state: `${crewTag}${barrels.length > 1 ? ` ${b + 1}` : ""} ARC`,
          });
          continue;
        }
        let aim = barrels[b] ?? h.angle;
        aim = Phaser.Math.Angle.RotateTo(aim, want, GUN_STATION_TURN_RATE * dt);
        if (trav) aim = clampAimToStationArc(aim, h.angle, trav);
        barrels[b] = aim;
        const err = Math.abs(Phaser.Math.Angle.Wrap(want - aim));
        const aligned = err <= AUTO_GUN_ALIGN_TOL;
        const onCd = (cds[b] ?? 0) > 0;
        let state = `${crewTag}${barrels.length > 1 ? ` ${b + 1}` : ""} `;
        if (!aligned) state += "SLEW";
        else if (onCd) state += "CD";
        else state += "FIRE";
        pushDbg(b, origin, {
          aim,
          want,
          targetId: tgt.id,
          state,
        });
        if (!aligned) continue;
        if (onCd) continue;
        if (!this.hasAmmo(slot)) continue;
        cds[b] = craftSocketFireCd(spec.fireCd, h.spec, slot);
        const salvoN = spec.fire?.salvo?.count ?? 1;
        const interval = spec.fire?.salvo?.interval ?? 0;
        const spread = spec.fire?.salvo?.spread ?? 0;
        const yaw0 = salvoN > 1 ? (0 - (salvoN - 1) / 2) * spread : 0;
        this.firePlayerWeapon(slot, spec, { x: tgt.x, y: tgt.y }, yaw0, undefined, undefined, tgt, b);
        for (let i = 1; i < salvoN; i++) {
          this.pendingSalvos.push({
            t: interval * i,
            slot,
            wpnId: wpnIdOf(spec),
            yawOff: (i - (salvoN - 1) / 2) * spread,
            autoTargetId: tgt.id,
            barrel: b,
          });
        }
      }
    }
  }

  /** Max engage radius for an automatic station (world units). */
  autoStationRange(spec: PlayerWpnSpec, slot?: number): number {
    const sockRange = slot != null ? this.heli.spec.sockets[slot]?.range : undefined;
    if (sockRange != null && sockRange > 0) return sockRange;
    if (spec.launch.mode === "beam") return spec.launch.range;
    return 340;
  }

  /** World position of an automatic barrel's gun mount (falls back to craft origin). */
  autoGunMountWorld(slot: number, barrel: number): { x: number; y: number } {
    const h = this.heli;
    const craft = h.spec;
    const socket = craft.sockets[slot];
    let mount: { x: number; y: number } | undefined;
    if (socket && socket.class === "turret") {
      const mounts = craftGunMounts(craft);
      const gi = this.gunVisualIndexForSlot(slot, barrel);
      mount = mounts[gi] ?? mounts[0];
    }
    if (!mount && socket) {
      const pts = craftSocketPoints(craft, socket);
      mount = pts[barrel] ?? pts[0];
    }
    if (!mount) return { x: h.x, y: h.y };
    return this.craftBodyMountWorldPos(mount);
  }

  /**
   * Preferred engage bearing for a barrel: craft heading + authored socket `heading`.
   */
  autoGunPreferHeading(slot: number, barrel: number): number {
    const h = this.heli;
    return Phaser.Math.Angle.Wrap(h.angle + craftGunPreferOffset(h.spec, slot, barrel));
  }

  /**
   * Socket traverse cone: arc from socket, center from barrel heading.
   */
  stationTraverseForBarrel(
    slot: number,
    barrel: number,
    craft: Heli = this.heli
  ): StationTraverse | undefined {
    const socket = craft.spec.sockets[slot];
    if (socket?.traverse == null) return undefined;
    return {
      arc: socket.traverse,
      center: craftGunPreferDegrees(craft.spec, slot, barrel),
    };
  }

  /**
   * Slew pilot turret stations toward `want` at chin-gun rate (host + craft-backed remotes).
   * Automatic stations only slew when selected; otherwise tickAutomaticStations owns them.
   */
  slewCraftTurretStations(
    craft: Heli,
    want: number,
    dt: number,
    selectedSlot: number
  ): void {
    for (let slot = 0; slot < craft.spec.sockets.length; slot++) {
      const socket = craft.spec.sockets[slot]!;
      if (socket.class !== "turret") continue;
      if (socket.controller === "automatic" && selectedSlot !== slot) continue;
      const barrels = craft.stationAim[slot] ?? (craft.stationAim[slot] = [craft.angle]);
      for (let b = 0; b < barrels.length; b++) {
        const trav = this.stationTraverseForBarrel(slot, b, craft);
        const clamped = trav ? clampAimToStationArc(want, craft.angle, trav) : want;
        barrels[b] = Phaser.Math.Angle.RotateTo(
          barrels[b] ?? craft.angle,
          clamped,
          GUN_STATION_TURN_RATE * dt
        );
        if (trav) {
          barrels[b] = clampAimToStationArc(barrels[b]!, craft.angle, trav);
        }
      }
    }
    craft.gunAngle = craft.stationAim[selectedSlot]?.[0] ?? want;
  }

  /** Per-barrel acquire center: mount position shifted along preferred heading. */
  autoGunAcquireOrigin(
    slot: number,
    barrel: number,
    prefer: number,
    range: number
  ): { x: number; y: number } {
    const mount = this.autoGunMountWorld(slot, barrel);
    const bias = range * AUTO_GUN_RANGE_BIAS;
    return {
      x: mount.x + Math.cos(prefer) * bias,
      y: mount.y + Math.sin(prefer) * bias,
    };
  }

  craftCmId() {
    return craftCountermeasure(this.heli.spec.countermeasure);
  }

  /**
   * Live remote for the *selected* HUD weapon only (launch / detonate / HOUND fire).
   */
  selectedSlotRemote(): RemoteCraft | undefined {
    const slot = this.loadout[this.heli.weapon];
    if (!payloadIsRemote(slot?.payload)) return undefined;
    const wantKind = slot!.payload!.remote!.kind;
    return this.remotes.find((r) => !r.detonate && !r.dock && r.spec.kind === wantKind);
  }

  /**
   * Piloted POV remote whose own loadout currently owns the weapon HUD (HOUND).
   * Player-HUD remotes (Spectre) return undefined — bird loadout stays on screen.
   */
  povHudRemote(): RemoteCraft | undefined {
    if (!this.remoteView) return undefined;
    const p = this.pilotingRemote();
    return p && remoteHasPovHud(p.spec) && p.loadout?.length ? p : undefined;
  }

  /** Active weapon strip — remote POV loadout or bird loadout. */
  hudLoadout(): PlayerWpnSpec[] {
    return this.povHudRemote()?.loadout ?? this.loadout;
  }

  hudAmmo(): number[] {
    const rem = this.povHudRemote();
    if (!rem?.ammo || !rem.loadout) return this.ammo;
    // Host-linked slots (howitzer spot / call-strike) show the dropship bank.
    return rem.loadout.map((wp, i) => {
      const hostId = this.remoteHostAmmoWeapon(wp);
      if (hostId) {
        const n = this.hostWeaponAmmoLeft(hostId);
        return n ?? rem.ammo![i]!;
      }
      return rem.ammo![i]!;
    });
  }

  /**
   * Ammo shown for a host remote slot: hangar reserve + live craft.
   * Dockable remotes (Skiffs) stay "available" while airborne or mid-dock
   * (refund happens on bay arrival); count drops only when lost.
   */
  remotePoolDisplayAmmo(slot: number, reserve: number): number {
    if (this.infAmmo || !Number.isFinite(reserve)) return reserve;
    const wp = this.loadout[slot];
    if (!payloadIsRemote(wp?.payload)) return reserve;
    const kind = wp!.payload!.remote!.kind;
    if (!remoteSpecOf(kind).dockable) return reserve;
    let live = 0;
    for (const r of this.remotes) {
      if (r.detonate || r.spec.kind !== kind) continue;
      live++;
    }
    return reserve + live;
  }

  /** Catalog weapon id whose host ammo a POV remote slot spends, if any. */
  remoteHostAmmoWeapon(wp: PlayerWpnSpec): string | undefined {
    if (payloadIsHostFire(wp.payload)) return wp.payload!.hostFire!.weapon;
    // HOUND artillery observer — barrage is the dropship howitzer.
    if (payloadIsCallStrike(wp.payload)) return "heavy_artillery";
    return undefined;
  }

  /**
   * Host gun slot currently owned by remote spotting / call-strike walk.
   * Automatic stations skip AI and slew toward reticle/mark while this is set.
   */
  hostSpotSlewSlot(): number {
    const hostWalk = this.callStrikeMarks.find(
      (m) => m.hostWeapon && m.roundsLeft > 0
    );
    if (hostWalk?.hostWeapon) {
      const slot = this.hostWeaponSlot(hostWalk.hostWeapon);
      if (slot >= 0) return slot;
    }
    const rem = this.povHudRemote();
    if (rem && !rem.airborne) {
      const wp = rem.loadout?.[rem.weapon ?? 0];
      const hostId = wp ? this.remoteHostAmmoWeapon(wp) : undefined;
      if (hostId) {
        const slot = this.hostWeaponSlot(hostId);
        if (slot >= 0) return slot;
      }
    }
    return -1;
  }

  /** True while a host-weapon call-strike barrage still has rounds left. */
  hostWeaponStrikeActive(wpnId?: string): boolean {
    return this.callStrikeMarks.some(
      (m) =>
        !!m.hostWeapon &&
        m.roundsLeft > 0 &&
        (wpnId == null || m.hostWeapon === wpnId)
    );
  }

  ensureStationFireCd(slot: number): number[] {
    const n = Math.max(1, craftSocketBarrelCount(this.heli.spec, slot));
    const cds =
      this.stationFireCd[slot] ??
      (this.stationFireCd[slot] = Array.from({ length: n }, () => 0));
    while (cds.length < n) cds.push(0);
    return cds;
  }

  hostStationFireReady(wpnId: string): boolean {
    const slot = this.hostWeaponSlot(wpnId);
    if (slot < 0) return false;
    return (this.ensureStationFireCd(slot)[0] ?? 0) <= 0;
  }

  /** Barrel close enough to aim point for a host strike / spot shot. */
  hostStationAlignedTo(wpnId: string, aim: { x: number; y: number }): boolean {
    const slot = this.hostWeaponSlot(wpnId);
    if (slot < 0) return false;
    const gunI = this.gunVisualIndexForSlot(slot);
    const tip =
      gunI >= 0 && this.guns[gunI]?.visible
        ? this.gunTip(gunI)
        : { x: this.heli.x, y: this.heli.y };
    const want = Math.atan2(aim.y - tip.y, aim.x - tip.x);
    const ang = this.heli.stationAim[slot]?.[0] ?? this.heli.gunAngle;
    return Math.abs(Phaser.Math.Angle.Wrap(want - ang)) <= AUTO_GUN_ALIGN_TOL * 1.6;
  }

  hostWeaponSlot(wpnId: string): number {
    let slot = this.loadout.findIndex((w) => w.id === wpnId);
    if (slot < 0) slot = this.heli.spec.sockets.findIndex((s) => s.weapon === wpnId);
    return slot;
  }

  hostWeaponAmmoLeft(wpnId: string): number | undefined {
    const slot = this.hostWeaponSlot(wpnId);
    if (slot < 0) return undefined;
    return this.ammo[slot];
  }

  hudWeapon(): number {
    const rem = this.povHudRemote();
    return rem?.weapon ?? this.heli.weapon;
  }

  /** Grow weapon HUD text rows if a POV remote loadout is longer than the bird's. */
  ensureWpnHudSlots(n: number): void {
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
    while (this.wpnHudSlots.length < n) {
      this.wpnHudSlots.push({
        key: mk("12px", "#a89868", 0, 0.5),
        name: mk("13px", "#f0d56a", 0, 0.5),
        ammo: mk("13px", "#e8d49a", 1, 0.5),
        status: mk("10px", "#7ad0ff", 0.5, 0).setStroke("#12100c", 2),
      });
    }
  }

  /**
   * Camera / WASD remote.
   * Spectre sticks while `remoteView` even if another weapon (e.g. railgun) is selected.
   * HOUND only while its HUD slot is selected.
   */
  activeRemote(): RemoteCraft | undefined {
    const selected = this.selectedSlotRemote();
    if (selected?.spec.pilotable) return selected;
    if (selected && !selected.spec.ai) return selected;
    if (this.remoteView) {
      // Sticky Spectre (or other non-pilotable) cam after switching weapons.
      return this.remotes.find(
        (r) => !r.detonate && !r.dock && !r.spec.ai && !r.spec.pilotable
      );
    }
    return undefined;
  }

  /** Player is driving this remote (WASD). HOUND = HUD selected; Spectre = sticky view. */
  pilotingRemote(): RemoteCraft | undefined {
    const selected = this.selectedSlotRemote();
    if (selected?.spec.pilotable) return selected;
    if (!this.remoteView) return undefined;
    return this.remotes.find(
      (r) => !r.detonate && !r.dock && !r.spec.ai && !r.spec.pilotable
    );
  }

  selectWeapon(slot: number): void {
    // POV remote HUD owns 1–N while piloting — never switches the bird loadout.
    const rem = this.povHudRemote();
    if (rem?.loadout) {
      if (slot < 0 || slot >= rem.loadout.length) return;
      rem.weapon = slot;
      return;
    }
    if (slot < 0 || slot >= this.loadout.length) return;
    const wasHound = !!this.selectedSlotRemote()?.spec.pilotable;
    this.heli.weapon = slot;
    const live = this.selectedSlotRemote();
    if (live?.spec.pilotable || (live && !live.spec.ai)) {
      this.enterRemoteView();
    } else if (wasHound) {
      // HOUND POV is HUD-tied; Spectre POV stays sticky when switching to guns.
      this.remoteView = false;
      this.applyThermalMode();
    }
  }

  enterRemoteView(): void {
    const canView =
      !!this.selectedSlotRemote() ||
      this.remotes.some((r) => !r.detonate && !r.dock && !r.spec.ai && !r.spec.pilotable);
    if (!canView) return;
    this.remoteView = true;
    this.applyThermalMode();
  }

  exitRemoteView(): void {
    const hound = this.selectedSlotRemote()?.spec.pilotable
      ? this.selectedSlotRemote()
      : this.pilotingRemote();
    // Near-host dockable POV (Raptor): Q docks instead of just dropping the cam.
    if (hound && remoteHasPovHud(hound.spec) && hound.spec.dockable && this.remoteNearHost(hound)) {
      hound.dock = true;
      this.remoteView = false;
      this.applyThermalMode();
      return;
    }
    // POV-HUD remotes (HOUND / Raptor): Q drops the view and leaves the slot so the
    // bird HUD returns (LIVE). Staying on the drop slot would draw a bomb arc.
    if (hound && remoteHasPovHud(hound.spec)) {
      this.remoteView = false;
      for (let i = 0; i < this.loadout.length; i++) {
        if (i === this.heli.weapon) continue;
        const wp = this.loadout[i]!;
        if (
          !payloadIsRemote(wp.payload) ||
          wp.payload!.remote!.kind !== hound.spec.kind
        ) {
          this.heli.weapon = i;
          break;
        }
      }
      this.applyThermalMode();
      return;
    }
    // Legacy HOUND / non-socket pilotable: Q releases by switching off its slot.
    if (hound) {
      for (let i = 0; i < this.loadout.length; i++) {
        if (i === this.heli.weapon) continue;
        const wp = this.loadout[i]!;
        if (
          !payloadIsRemote(wp.payload) ||
          wp.payload!.remote!.kind !== hound.spec.kind
        ) {
          this.heli.weapon = i;
          break;
        }
      }
    }
    if (!this.remoteView) {
      this.applyThermalMode();
      return;
    }
    this.remoteView = false;
    this.applyThermalMode();
  }

  /** Peaceful dock radius for remotes returning to the host craft. */
  remoteDockRange(drone: RemoteCraft): number {
    return Math.max(160, this.heli.spec.radius * 0.55 + drone.spec.radius + 48);
  }

  remoteNearHost(drone: RemoteCraft): boolean {
    const d = Math.hypot(drone.x - this.heli.x, drone.y - this.heli.y, drone.z - this.heli.z);
    return d < this.remoteDockRange(drone);
  }

  /** Q from bird-cam — send every live Skiff home to dock. */
  recallWingmen(): void {
    let any = false;
    for (const r of this.remotes) {
      if (r.detonate || r.dock || r.spec.kind !== "wingman") continue;
      r.dock = true;
      any = true;
    }
    if (any) this.applyThermalMode();
  }

  /** Toggle dropship FOLLOW / HOLD while piloting a POV remote with `hostEscort`. */
  toggleHostEscortMode(): void {
    const pilot = this.povHudRemote();
    if (!pilot?.spec.hostEscort) return;
    this.hostEscortMode = this.hostEscortMode === "hold" ? "follow" : "hold";
    this.hostEscortSeeking = false;
  }

  /**
   * Host craft drive while a POV remote is piloted.
   * Spoofs stick + aim into the normal heli controller (no custom locomotion):
   * - `hostFace`: yaw toward the remote (orbit hosts use A/D; plane hosts aim-turn).
   * - `hostEscort` Hold parks; Follow aims at the leash target, turns first, then thrusts.
   * - Hold + howitzer under remote direction (spot / strike select, or active barrage):
   *   yaw toward the mouse — same for remote howitzer and artillery strike.
   *   Follow keeps leash rules (face/crawl to remote).
   * Turrets still track the mouse / mark in syncHeliGfx.
   */
  hostEscortDrive(pilot: RemoteCraft | undefined):
    | {
        stick: { up: boolean; down: boolean; left: boolean; right: boolean };
        aimX: number;
        aimY: number;
        brake: boolean;
        /** Soft max speed while escorting (follow crawl). */
        speedCap?: number;
      }
    | undefined {
    if (!this.remoteView || !pilot || pilot.airborne || !remoteHasPovHud(pilot.spec)) {
      return undefined;
    }
    const h = this.heli;
    const zero = { up: false, down: false, left: false, right: false };
    // Spot howitzer, artillery strike, or an active host barrage — all direct the howitzer.
    const faceAim = this.hostSpotSlewSlot() >= 0;

    // Face-only (Raptor): keep cruising, yaw the hull toward the pilot.
    if (pilot.spec.hostFace) {
      return this.hostFacePointStick(pilot.x, pilot.y, zero, false);
    }

    if (!pilot.spec.hostEscort) {
      // No escort profile — Hold-equivalent: face reticle while directing howitzer.
      if (faceAim) {
        const ptr = this.worldPointer();
        return this.hostFacePointStick(ptr.x, ptr.y, zero, true);
      }
      return undefined;
    }

    // Hold heading by aiming ahead of the nose (turrets use worldPointer separately).
    const parkAimX = h.x + Math.cos(h.angle) * 80;
    const parkAimY = h.y + Math.sin(h.angle) * 80;
    if (this.hostEscortMode === "hold") {
      this.hostEscortSeeking = false;
      // Directing howitzer in Hold: yaw toward mouse (Follow wins when toggled).
      if (faceAim) {
        const ptr = this.worldPointer();
        return this.hostFacePointStick(ptr.x, ptr.y, zero, true);
      }
      return { stick: zero, aimX: parkAimX, aimY: parkAimY, brake: true };
    }

    const { innerRadius, outerRadius } = pilot.spec.hostEscort;
    const dist = Math.hypot(h.x - pilot.x, h.y - pilot.y);
    if (this.hostEscortSeeking) {
      if (dist <= innerRadius) this.hostEscortSeeking = false;
    } else if (dist > outerRadius) {
      this.hostEscortSeeking = true;
    }

    // Always face the Hound in follow — even while parked inside the leash.
    if (!this.hostEscortSeeking) {
      return this.hostFacePointStick(pilot.x, pilot.y, zero, true);
    }

    // Catch-up: turn toward the inner ring, thrust only once the nose is close enough.
    const dx = h.x - pilot.x;
    const dy = h.y - pilot.y;
    const inv = dist > 1e-3 ? 1 / dist : 0;
    const tx = pilot.x + dx * inv * innerRadius;
    const ty = pilot.y + dy * inv * innerRadius;
    const want = Math.atan2(ty - h.y, tx - h.x);
    const err = Math.abs(Phaser.Math.Angle.Wrap(want - h.angle));
    // ~28° — yaw first, then crawl; avoids thrusting off-axis.
    const aligned = err < 0.49;
    return {
      stick: { up: aligned, down: false, left: false, right: false },
      aimX: tx,
      aimY: ty,
      // Kill residual speed while lining up so it doesn't coast the wrong way.
      brake: !aligned,
      // Follow crawl — well under player full-throttle max.
      speedCap: aligned ? h.spec.maxSpeed * 0.42 : undefined,
    };
  }

  /**
   * Spoof stick/aim so the host yaws toward a world point via normal heli.update turn rules.
   * Orbit → A/D hold-to-turn; aim/plane → nose tracks aim point.
   */
  hostFacePointStick(
    aimX: number,
    aimY: number,
    zero: { up: boolean; down: boolean; left: boolean; right: boolean },
    brake: boolean
  ): {
    stick: { up: boolean; down: boolean; left: boolean; right: boolean };
    aimX: number;
    aimY: number;
    brake: boolean;
  } {
    const h = this.heli;
    const want = Math.atan2(aimY - h.y, aimX - h.x);
    const err = Phaser.Math.Angle.Wrap(want - h.angle);
    const dead = 0.07;
    if (craftControlScheme(h.spec) === "orbit") {
      return {
        stick: {
          up: false,
          down: false,
          left: err < -dead,
          right: err > dead,
        },
        aimX,
        aimY,
        brake,
      };
    }
    return { stick: zero, aimX, aimY, brake };
  }

  /** Extra stop for hold / inside-leash / turn-to-align so the dropship doesn't drift. */
  brakeHostEscort(dt: number): void {
    const h = this.heli;
    const damp = Math.pow(0.04, dt);
    h.vx *= damp;
    h.vy *= damp;
  }

  /** Clamp host speed while follow-thrusting (slower than full throttle). */
  capHostEscortSpeed(cap: number): void {
    const h = this.heli;
    const spd = Math.hypot(h.vx, h.vy);
    if (spd > cap && spd > 1e-4) {
      const s = cap / spd;
      h.vx *= s;
      h.vy *= s;
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

  launchRemote(
    spec: PlayerWpnSpec,
    slot: number,
    yawOff: number,
    pitchOff = 0,
    at?: { x: number; y: number; z?: number }
  ): void {
    if (!payloadIsRemote(spec.payload)) return;
    const remoteSpec = remoteSpecOf(spec.payload.remote!.kind);
    const h = this.heli;
    const pylon = at ?? this.hardpointPylon(slot, true);
    // HOUND: leave the rear ramp facing aft, at ship altitude, then fall to dirt.
    const reverseDrop = remoteSpec.ground && remoteSpec.pilotable;
    const ang = reverseDrop ? h.angle + Math.PI + yawOff : h.angle + yawOff;
    const cp = Math.cos(pitchOff);
    const sp = Math.sin(pitchOff);
    const kick = remoteSpec.launchSpeed;
    const gnd = groundZ(this.world, pylon.x, pylon.y);
    this.remotes.push({
      id: nextId(),
      spec: remoteSpec,
      x: pylon.x,
      y: pylon.y,
      z: reverseDrop ? h.z : remoteSpec.ground ? gnd + remoteSpec.cruiseAgl : (at?.z ?? h.z + ZOff.shot),
      vx: h.vx * (reverseDrop ? 0.55 : 0.85) + Math.cos(ang) * kick * cp,
      vy: h.vy * (reverseDrop ? 0.55 : 0.85) + Math.sin(ang) * kick * cp,
      vz: reverseDrop ? h.vz * 0.35 - 30 : remoteSpec.ground ? 0 : h.vz * 0.4 + kick * sp,
      angle: ang,
      health: remoteSpec.health,
      life: spec.payload.remote!.duration,
      lifeMax: spec.payload.remote!.duration,
      rotor: Math.random() * Math.PI * 2,
      orbit: Math.random() * Math.PI * 2,
      gunAngle: ang,
      track: 0,
      airborne: reverseDrop || undefined,
    });
    initRemoteLoadout(this.remotes[this.remotes.length - 1]!);
    // Spectre auto-views; HOUND takes control when dropped from its selected HUD slot.
    if (!remoteSpec.ai || remoteSpec.pilotable) {
      const selectedKind = payloadIsRemote(this.loadout[this.heli.weapon]?.payload)
        ? this.loadout[this.heli.weapon]!.payload!.remote!.kind
        : undefined;
      if (!remoteSpec.ai || selectedKind === remoteSpec.kind) {
        this.remoteView = true;
        this.applyThermalMode();
      }
    }
  }

  /**
   * Player-driven remote kinematics. All remotes are craft-backed (`craftLook`);
   * drive through the same Heli.update path as a selected player craft.
   * Lifecycle (HUD / cam / battery / dock) stays on the remote wrapper.
   */
  tickRemotePilot(drone: RemoteCraft, dt: number, aim: { x: number; y: number }): void {
    if (!drone.spec.craftLook) return;
    this.tickRemoteCraftPilot(drone, dt, aim);
  }

  /** Shadow Heli for a craft-backed remote — created once, kinematics synced each frame. */
  ensureRemotePilotCraft(drone: RemoteCraft): Heli | undefined {
    const kind = drone.spec.craftLook;
    if (!kind) return undefined;
    let craft = this.remotePilotCraft.get(drone.id);
    if (!craft) {
      craft = new Heli(drone.x, drone.y, this.world, kind);
      craft.startAirborne(drone.angle, this.world);
      craft.x = drone.x;
      craft.y = drone.y;
      craft.z = drone.z;
      craft.vx = drone.vx;
      craft.vy = drone.vy;
      craft.vz = drone.vz ?? 0;
      craft.angle = drone.angle;
      craft.health = drone.health;
      this.remotePilotCraft.set(drone.id, craft);
    }
    return craft;
  }

  /** Drive a remote through the same Heli.update path as a player craft. */
  tickRemoteCraftPilot(drone: RemoteCraft, dt: number, aim: { x: number; y: number }): void {
    const craft = this.ensureRemotePilotCraft(drone);
    if (!craft) return;
    const trackX0 = drone.x;
    const trackY0 = drone.y;
    // Pull remote→Heli first (ground snap / other systems may have corrected pose).
    craft.x = drone.x;
    craft.y = drone.y;
    craft.z = drone.z;
    craft.vx = drone.vx;
    craft.vy = drone.vy;
    craft.vz = drone.vz ?? 0;
    craft.angle = drone.angle;
    craft.phase = "flight";
    craft.update(
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
      // Ground pods stay dirt-locked via snapRemoteGround — no collective loft.
      drone.spec.ground ? false : this.keySpace.isDown,
      drone.spec.ground ? false : this.keyShift.isDown
    );
    drone.x = craft.x;
    drone.y = craft.y;
    drone.z = craft.z;
    drone.vx = craft.vx;
    drone.vy = craft.vy;
    drone.vz = craft.vz;
    drone.angle = craft.angle;
    drone.roll = craft.roll;
    drone.pitch = craft.pitch;
    drone.rotor = craft.rotor;
    // Turrets slew like host chin guns; fixed/plane nose stays hull-locked.
    const selected = Phaser.Math.Clamp(
      drone.weapon ?? 0,
      0,
      Math.max(0, craft.spec.sockets.length - 1)
    );
    craft.weapon = selected;
    if (craftAimsWithTurret(craft.spec)) {
      const want = Math.atan2(aim.y - drone.y, aim.x - drone.x);
      this.slewCraftTurretStations(craft, want, dt, selected);
      drone.gunAngle = craft.gunAngle;
    } else {
      drone.gunAngle = craft.angle;
      craft.gunAngle = craft.angle;
    }
    drone.health = Math.min(drone.health, craft.health);
    // Craft-piloted remotes integrate inside Heli.update — stamp tracks here (not in updateRemotes).
    if (drone.spec.track && !drone.airborne) {
      this.stampRemoteTracks(drone, dt, trackX0, trackY0);
    }
    if (drone.spec.dockable) {
      if (this.remoteNearHost(drone) && (this.keyE.isDown || drone.life < 10)) drone.dock = true;
    }
  }

  releaseRemotePilotCraft(id: number): void {
    this.remotePilotCraft.delete(id);
  }

  /** Project velocity onto hull forward and accelerate along it (no strafe / slide). */
  driveRemoteAlongHeading(
    drone: RemoteCraft,
    thrustAlong: number,
    dt: number,
    friction: number,
    speedCap?: number
  ): void {
    const spec = drone.spec;
    const ca = Math.cos(drone.angle);
    const sa = Math.sin(drone.angle);
    let along = drone.vx * ca + drone.vy * sa;
    along += thrustAlong * dt;
    along *= Math.pow(friction, dt);
    const cap = speedCap ?? spec.maxSpeed;
    if (Math.abs(along) > cap) along = Math.sign(along) * cap;
    drone.vx = ca * along;
    drone.vy = sa * along;
  }

  tickRemoteAi(drone: RemoteCraft, dt: number): void {
    // Ground AGV AI (HOUND) — orbit/shoot; piloted path uses craft Heli instead.
    if (drone.spec.ground && drone.spec.gun) {
      this.tickHoundAi(drone, dt);
      return;
    }
    if (drone.spec.kind === "wingman" || drone.spec.kind === "fighter") {
      this.tickWingmanAi(drone, dt);
      return;
    }
    const h = this.heli;
    const spec = drone.spec;
    drone.orbit = (drone.orbit ?? 0) + dt * (spec.ground ? 0.7 : 1.15);
    let tx = h.x;
    let ty = h.y;
    if (spec.ground) {
      let best: Unit | undefined;
      let bestD = 520;
      for (const u of this.units) {
        if (u.dead) continue;
        const d = Math.hypot(u.x - drone.x, u.y - drone.y);
        if (d < bestD) {
          bestD = d;
          best = u;
        }
      }
      if (best) {
        tx = best.x;
        ty = best.y;
      } else {
        tx = h.x + Math.cos(drone.orbit) * 40;
        ty = h.y + Math.sin(drone.orbit) * 40;
      }
    } else {
      const ring = 110 + Math.sin(drone.orbit * 0.7) * 35;
      tx = h.x + Math.cos(drone.orbit) * ring;
      ty = h.y + Math.sin(drone.orbit) * ring;
    }
    const want = Math.atan2(ty - drone.y, tx - drone.x);
    drone.angle = this.steerUnitAngle(drone.angle, want, spec.yawRate * 0.85, dt);
    const ca = Math.cos(drone.angle);
    const sa = Math.sin(drone.angle);
    drone.vx += ca * spec.thrust * 0.55 * dt;
    drone.vy += sa * spec.thrust * 0.55 * dt;
    drone.vx *= Math.pow(0.15, dt);
    drone.vy *= Math.pow(0.15, dt);
    const spd = Math.hypot(drone.vx, drone.vy);
    if (spd > spec.maxSpeed) {
      drone.vx *= spec.maxSpeed / spd;
      drone.vy *= spec.maxSpeed / spd;
    }
    if (spec.dockable && drone.life < 8) {
      const d = Math.hypot(drone.x - h.x, drone.y - h.y, drone.z - h.z);
      if (d < 100) drone.dock = true;
    }
  }

  /** Host a wingman orbits — live Raptor if any, else the airship/heli. */
  wingmanOrbitHost(drone: RemoteCraft): { x: number; y: number; z: number; radius: number } {
    if (drone.spec.kind === "wingman") {
      const raptor = this.remotes.find(
        (r) => r !== drone && !r.detonate && !r.dock && r.spec.kind === "fighter"
      );
      if (raptor) {
        return {
          x: raptor.x,
          y: raptor.y,
          z: raptor.z,
          radius: raptor.spec.radius,
        };
      }
    }
    const h = this.heli;
    return { x: h.x, y: h.y, z: h.z, radius: h.spec.radius };
  }

  /** Friendly sensor net: heli + live Skiffs + Raptor. */
  remoteFriendlySensors(): { x: number; y: number }[] {
    const out: { x: number; y: number }[] = [{ x: this.heli.x, y: this.heli.y }];
    for (const r of this.remotes) {
      if (r.detonate || r.dock) continue;
      if (r.spec.kind === "wingman" || r.spec.kind === "fighter") {
        out.push({ x: r.x, y: r.y });
      }
    }
    return out;
  }

  /** True when any friendly is within `awareRange` of the unit. */
  unitKnownToFriendlies(u: Unit, awareRange: number): boolean {
    for (const f of this.remoteFriendlySensors()) {
      if (Math.hypot(u.x - f.x, u.y - f.y) <= awareRange) return true;
    }
    return false;
  }

  /**
   * Skiff / unpiloted Raptor AI:
   * - Idle wide orbit around Raptor (when one is live) or the airship.
   * - Engage enemies known to friendlies within max attack range (slightly past screen).
   * - Skiff: fixed-gun attack passes (line up → fire → overshoot → turn).
   * - Raptor AI: strafe ring (turret-lean) while unpiloted.
   */
  tickWingmanAi(drone: RemoteCraft, dt: number): void {
    const spec = drone.spec;
    const host = this.wingmanOrbitHost(drone);
    const maxEngage = this.wingmanMaxEngageRange();
    const aware = spec.awareRange ?? 560;
    const strafeR = spec.orbitRange ?? 160;
    const escortR = (spec.escortRange ?? 240) + host.radius;
    const cruiseSpd = spec.maxSpeed;

    let target: Unit | undefined =
      drone.aiTargetId != null ? this.unitById(drone.aiTargetId) : undefined;
    if (
      !target ||
      target.dead ||
      !this.unitKnownToFriendlies(target, aware) ||
      Math.hypot(target.x - host.x, target.y - host.y) > maxEngage
    ) {
      let best: Unit | undefined;
      let bestD = maxEngage;
      for (const u of this.units) {
        if (u.dead) continue;
        if (!this.unitKnownToFriendlies(u, aware)) continue;
        const dHost = Math.hypot(u.x - host.x, u.y - host.y);
        if (dHost > maxEngage) continue;
        const d = Math.hypot(u.x - drone.x, u.y - drone.y);
        if (d < bestD) {
          bestD = d;
          best = u;
        }
      }
      target = best;
      drone.aiTargetId = best?.id;
      if (!target) drone.aiPass = undefined;
    }

    drone.orbit = (drone.orbit ?? 0) + dt * (target ? 1.05 : 0.85);
    if (target && spec.kind === "wingman") {
      this.tickSkiffAttackPass(drone, dt, target);
    } else if (target) {
      const lead = (drone.orbit ?? 0) + drone.id * 0.7;
      const tx = target.x + Math.cos(lead) * strafeR;
      const ty = target.y + Math.sin(lead) * strafeR;
      const pathWant = Math.atan2(ty - drone.y, tx - drone.x);
      const aimWant = Math.atan2(target.y - drone.y, target.x - drone.x);
      // Bank into the strafe ring; nose leans toward the hostile for guns.
      const blend = Phaser.Math.Angle.Wrap(aimWant - pathWant);
      const face = pathWant + Phaser.Math.Clamp(blend, -0.85, 0.85);
      drone.angle = this.steerUnitAngle(drone.angle, face, spec.yawRate * 0.95, dt);
      drone.gunAngle = aimWant;
      const aimErr = Math.abs(Phaser.Math.Angle.Wrap(drone.angle - aimWant));
      if (aimErr < 0.7 || Math.hypot(target.x - drone.x, target.y - drone.y) < maxEngage * 0.45) {
        this.fireRemoteGun(drone, dt, { x: target.x, y: target.y });
      }
      const near = Math.hypot(tx - drone.x, ty - drone.y);
      const throttle = near < 40 ? 0.55 : 1;
      this.driveRemoteAlongHeading(drone, spec.thrust * throttle, dt, 0.16, cruiseSpd);
    } else {
      const ring = escortR + Math.sin((drone.orbit ?? 0) * 0.55 + drone.id) * 55;
      const tx = host.x + Math.cos(drone.orbit ?? 0) * ring;
      const ty = host.y + Math.sin(drone.orbit ?? 0) * ring;
      const want = Math.atan2(ty - drone.y, tx - drone.x);
      drone.angle = this.steerUnitAngle(drone.angle, want, spec.yawRate * 0.85, dt);
      drone.gunAngle = drone.angle;
      const near = Math.hypot(tx - drone.x, ty - drone.y);
      // One speed band — slight thrust bump when closing on the escort ring (Raptor/host).
      const catchUp = near > escortR * 0.85;
      const thrustMul = near < 50 ? 0.35 : catchUp ? 1.2 : 0.55;
      this.driveRemoteAlongHeading(drone, spec.thrust * thrustMul, dt, 0.14, cruiseSpd);
    }

    // Soft climb toward host altitude band.
    const band = host.z + Phaser.Math.Clamp(spec.cruiseAgl - 30, -20, 40);
    drone.vz += (band - drone.z) * 1.8 * dt;
    drone.vz *= Math.pow(0.25, dt);

    if (spec.dockable && drone.life < 8 && this.remoteNearHost(drone)) {
      drone.dock = true;
    }
  }

  /**
   * Skiff fixed-gun boom pass: steer onto the target, fire when lined up,
   * fly through, then break-turn for another run.
   */
  tickSkiffAttackPass(drone: RemoteCraft, dt: number, target: Unit): void {
    const spec = drone.spec;
    const dx = target.x - drone.x;
    const dy = target.y - drone.y;
    const dist = Math.hypot(dx, dy);
    const ca = Math.cos(drone.angle);
    const sa = Math.sin(drone.angle);
    // >0 when the target is still ahead of the nose.
    const ahead = dx * ca + dy * sa;
    const gunId = remoteGunId(spec);
    const bulletSpd = gunId ? PLAYER_WPNS[gunId]?.speed ?? 900 : 900;
    // Lead the nose for a collision course; shots still leave along heading.
    const leadT = Phaser.Math.Clamp(dist / Math.max(280, bulletSpd * 0.4), 0.04, 0.45);
    const aimX = target.x + target.vx * leadT;
    const aimY = target.y + target.vy * leadT;
    const aimWant = Math.atan2(aimY - drone.y, aimX - drone.x);
    const aimErr = Math.abs(Phaser.Math.Angle.Wrap(drone.angle - aimWant));

    if (!drone.aiPass) drone.aiPass = "run";

    if (drone.aiPass === "run") {
      drone.angle = this.steerUnitAngle(drone.angle, aimWant, spec.yawRate * 1.05, dt);
      drone.gunAngle = drone.angle;
      // Fire window: nose on target, not too close to clip through the burst.
      const fireMax = Math.min(420, this.wingmanMaxEngageRange() * 0.55);
      const fireMin = 55;
      if (ahead > 0 && aimErr < 0.22 && dist < fireMax && dist > fireMin) {
        this.fireRemoteGun(drone, dt, { x: aimX, y: aimY });
      }
      // Overshoot tripwire — flew past or punched in close.
      if (ahead < -12 || (dist < 48 && ahead < dist * 0.35)) {
        drone.aiPass = "break";
      }
      this.driveRemoteAlongHeading(drone, spec.thrust, dt, 0.14);
    } else {
      // Break turn: keep speed, yank nose back toward the target for the next pass.
      drone.angle = this.steerUnitAngle(drone.angle, aimWant, spec.yawRate * 1.35, dt);
      drone.gunAngle = drone.angle;
      this.driveRemoteAlongHeading(drone, spec.thrust * 0.92, dt, 0.12);
      // Re-commit once the target is ahead again and roughly lined up.
      if (ahead > Math.max(70, dist * 0.35) && aimErr < 0.55) {
        drone.aiPass = "run";
      }
    }
  }

  /** Attack leash — roughly the longer screen edge + a little past (world units). */
  wingmanMaxEngageRange(): number {
    const v = this.cameras.main.worldView;
    return Math.max(v.width, v.height) * 0.52 + 80;
  }

  /** Host bay world pos for skiff / fighter dock approach. */
  remoteDockBayPos(drone: RemoteCraft): { x: number; y: number; z: number } {
    const h = this.heli;
    const wantWpn =
      drone.spec.kind === "fighter" ? "fighter_pod" : drone.spec.kind === "wingman" ? "wingman_drone" : undefined;
    const socket = wantWpn
      ? h.spec.sockets.find((s) => s.weapon === wantWpn)
      : h.spec.sockets.find((s) => s.id.includes("bay") || s.id.includes("skiff"));
    if (socket) {
      const pts = craftSocketPoints(h.spec, socket);
      if (pts[0]) {
        const p = this.craftBodyMountWorldPos(pts[0]);
        return { x: p.x, y: p.y, z: h.z };
      }
    }
    return {
      x: h.x - Math.cos(h.angle) * h.spec.radius * 0.25,
      y: h.y - Math.sin(h.angle) * h.spec.radius * 0.25,
      z: h.z,
    };
  }

  /**
   * Steer a docking remote into the host bay hardpoint.
   * Sets velocity; caller integrates. Returns true when captured.
   */
  tickRemoteDockApproach(drone: RemoteCraft, dt: number): boolean {
    const bay = this.remoteDockBayPos(drone);
    const dx = bay.x - drone.x;
    const dy = bay.y - drone.y;
    const dz = bay.z - drone.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 24) return true;

    const want = Math.atan2(dy, dx);
    drone.angle = this.steerUnitAngle(drone.angle, want, drone.spec.yawRate * 1.25, dt);
    drone.gunAngle = drone.angle;
    const approach = Phaser.Math.Clamp(dist / 220, 0.22, 1);
    const speed = drone.spec.maxSpeed * (0.45 + approach * 0.4);
    this.driveRemoteAlongHeading(drone, drone.spec.thrust * (0.35 + approach * 0.75), dt, 0.2, speed);
    drone.vz += dz * 2.6 * dt;
    drone.vz *= Math.pow(0.3, dt);
    if (dist < 110) {
      const pull = 1 - Math.exp(-5 * dt);
      const along = speed * 0.9;
      drone.vx = Phaser.Math.Linear(drone.vx, (dx / dist) * along, pull);
      drone.vy = Phaser.Math.Linear(drone.vy, (dy / dist) * along, pull);
    }
    return false;
  }

  /** HOUND autonomous: hull tracks mouse; turret acquires/shoots hostiles in range. */
  tickHoundAi(drone: RemoteCraft, dt: number): void {
    const spec = drone.spec;
    const ptr = this.worldPointer();
    const engage = spec.engageRange ?? 320;
    const stopR = spec.mouseStopRange ?? 48;

    let target = drone.aiTargetId != null ? this.unitById(drone.aiTargetId) : undefined;
    if (!target || target.dead || Math.hypot(target.x - drone.x, target.y - drone.y) > engage) {
      let best: Unit | undefined;
      let bestD = engage;
      for (const u of this.units) {
        if (u.dead) continue;
        const d = Math.hypot(u.x - drone.x, u.y - drone.y);
        if (d < bestD) {
          bestD = d;
          best = u;
        }
      }
      target = best;
      drone.aiTargetId = best?.id;
    }

    if (target) {
      const aimWant = Math.atan2(target.y - drone.y, target.x - drone.x);
      const hull = drone.spec.craftLook ? craftOf(drone.spec.craftLook) : undefined;
      if (hull && craftAimsWithTurret(hull)) {
        drone.gunAngle = Phaser.Math.Angle.RotateTo(
          drone.gunAngle ?? drone.angle,
          aimWant,
          GUN_STATION_TURN_RATE * dt
        );
      } else {
        drone.gunAngle = aimWant;
      }
      const aimErr = Math.abs(Phaser.Math.Angle.Wrap((drone.gunAngle ?? 0) - aimWant));
      if (aimErr < 0.22 || Math.hypot(target.x - drone.x, target.y - drone.y) < engage * 0.45) {
        this.fireRemoteGun(drone, dt, { x: target.x, y: target.y });
      }
    } else {
      const idleWant = Math.atan2(ptr.y - drone.y, ptr.x - drone.x);
      const hull = drone.spec.craftLook ? craftOf(drone.spec.craftLook) : undefined;
      if (hull && craftAimsWithTurret(hull)) {
        drone.gunAngle = Phaser.Math.Angle.RotateTo(
          drone.gunAngle ?? drone.angle,
          idleWant,
          GUN_STATION_TURN_RATE * dt
        );
      } else {
        drone.gunAngle = idleWant;
      }
    }

    // Always drive toward the pointer — park when close enough.
    const toMouse = Math.hypot(ptr.x - drone.x, ptr.y - drone.y);
    if (toMouse < stopR) {
      this.driveRemoteAlongHeading(drone, 0, dt, 0.04);
      return;
    }
    const want = Math.atan2(ptr.y - drone.y, ptr.x - drone.x);
    drone.angle = this.steerUnitAngle(drone.angle, want, spec.yawRate * 0.9, dt);
    const throttle = toMouse < stopR * 1.6 ? 0.3 : 0.7;
    this.driveRemoteAlongHeading(drone, spec.thrust * throttle, dt, 0.14);
  }

  /**
   * Ground remotes: locked pad AGL like enemy vehicles (no heli-style soft climb).
   * Airborne drops fall under gravity and thud-land with no bounce.
   */
  snapRemoteGround(drone: RemoteCraft, dt: number): void {
    const spec = drone.spec;
    const gnd = groundZ(this.world, drone.x, drone.y);
    if (!spec.ground) {
      const rest = gnd + spec.cruiseAgl;
      drone.vz += (rest - drone.z) * 2.4 * dt;
      drone.vz *= Math.pow(0.2, dt);
      return;
    }
    const pad = gnd + spec.cruiseAgl;
    if (drone.airborne) {
      drone.vz -= 620 * dt;
      if (drone.z <= pad) {
        drone.z = pad;
        drone.vz = 0;
        drone.airborne = false;
        this.emitHoundLandingThud(drone);
      }
      return;
    }
    // Instant clamp — same language as enemy tanks on dirt.
    drone.z = pad;
    drone.vz = 0;
  }

  /** Dirt puff + smear when a dropped HOUND hits the ground. */
  emitHoundLandingThud(drone: RemoteCraft): void {
    if (isWater(this.world, drone.x, drone.y)) return;
    const gnd = groundZ(this.world, drone.x, drone.y);
    this.heliDust.setDepth(worldDepth(gnd, 0.25, drone.y));
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = range(10, 42);
      const wx = drone.x + Math.cos(a) * r;
      const wy = drone.y + Math.sin(a) * r;
      const p = worldToScreen(wx, wy, groundZ(this.world, wx, wy));
      this.heliDust.setEmitterAngle(Phaser.Math.RadToDeg(a) + (Math.random() - 0.5) * 36);
      this.emitBudgeted("dust", this.heliDust, p.x, p.y, 1);
    }
    this.stampDirtSmears(drone.x, drone.y, drone.vx * 0.35, drone.vy * 0.35);
    const admitted = this.reserveSimParticleSlots("dust", 14);
    const biome = sampleBiome(this.world, drone.x, drone.y);
    for (let i = 0; i < admitted; i++) {
      const a = Math.random() * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const spd = range(180, 420);
      const life = range(0.35, 0.7);
      const look = simParticleLook("dirt", biome);
      this.simParticles.push({
        x: drone.x + ca * range(2, 12),
        y: drone.y + sa * range(2, 12),
        z: gnd + range(2, 10),
        vx: ca * spd,
        vy: sa * spd,
        vz: range(80, 220),
        life,
        max: life,
        scale: range(0.7, 1.15),
        bounces: 0,
        kind: "dirt",
        tex: simParticleTexKey("dirt"),
        frame: (Math.random() * FX_VARIANTS) | 0,
        angJit: range(-0.06, 0.06),
        spin: range(-8, 8),
        tint: look.tint,
        additive: look.add,
        heading: a,
        capacityClass: "dust",
      });
    }
  }

  tickRemoteIdle(drone: RemoteCraft, dt: number): void {
    drone.vx *= Math.pow(0.08, dt);
    drone.vy *= Math.pow(0.08, dt);
    const gnd = groundZ(this.world, drone.x, drone.y);
    const rest = gnd + drone.spec.cruiseAgl;
    drone.vz += (rest - drone.z) * 2.4 * dt;
    drone.vz *= Math.pow(0.2, dt);
  }

  refundRemoteAmmo(kind: string): void {
    for (let i = 0; i < this.loadout.length; i++) {
      const w = this.loadout[i]!;
      if (!payloadIsRemote(w.payload)) continue;
      if (w.payload!.remote!.kind !== kind) continue;
      // Match hangar capacity (craft ammoScale / socket mul), not bare catalog ammo.
      const cap = craftSocketStartingAmmo(w.ammo, this.heli.spec, i);
      if (!Number.isFinite(cap)) return;
      if ((this.ammo[i] ?? 0) < cap) {
        this.ammo[i] = (this.ammo[i] ?? 0) + 1;
        return;
      }
    }
  }

  updateRemotes(dt: number): void {
    // Keep HOUND cam/view latched while its HUD slot is selected and it's alive.
    // Spectre view is sticky across weapon changes — do not clear just because the
    // selected slot is a gun (railgun, etc.).
    const selected = this.selectedSlotRemote();
    // POV-HUD remotes (HOUND): Q exits without deselecting — do not auto-reenter every
    // frame. Re-enter via selecting the slot again or firing while it's selected.
    if (
      selected?.spec.pilotable &&
      !this.remoteView &&
      !remoteHasPovHud(selected.spec)
    ) {
      this.enterRemoteView();
    }
    if (
      this.remoteView &&
      payloadIsRemote(this.loadout[this.heli.weapon]?.payload) &&
      remoteSpecOf(this.loadout[this.heli.weapon]!.payload!.remote!.kind).pilotable &&
      !selected
    ) {
      // HOUND slot selected but the vehicle is gone — drop view so a fresh drop can launch.
      this.remoteView = false;
      this.applyThermalMode();
    }

    const pilotedId = this.pilotingRemote()?.id;
    const craftPiloted =
      !!pilotedId &&
      this.remoteView &&
      this.remotePilotCraft.has(pilotedId);
    // Drive AI pods / dock approaches every frame (piloted / airborne remotes steered earlier).
    for (const r of this.remotes) {
      if (r.detonate || r.airborne) continue;
      if (r.dock) {
        if (this.remotePilotCraft.has(r.id)) this.releaseRemotePilotCraft(r.id);
        this.tickRemoteDockApproach(r, dt);
        continue;
      }
      if (r.spec.ai && r.id !== pilotedId) {
        // Drop shadow Heli when AI takes over after Q exit.
        if (this.remotePilotCraft.has(r.id)) this.releaseRemotePilotCraft(r.id);
        this.tickRemoteAi(r, dt);
      }
    }
    let w = 0;
    for (let i = 0; i < this.remotes.length; i++) {
      const r = this.remotes[i]!;
      const trackX0 = r.x;
      const trackY0 = r.y;
      r.life -= dt;
      // Craft-piloted remotes already integrated inside Heli.update this frame.
      if (!(craftPiloted && r.id === pilotedId) || r.dock) {
        r.x += r.vx * dt;
        r.y += r.vy * dt;
        r.z += r.vz * dt;
      }
      if (!r.dock) this.snapRemoteGround(r, dt);
      // Craft-piloted remotes stamp tracks inside tickRemoteCraftPilot (Heli already moved them).
      if (r.spec.track && !r.airborne && !(craftPiloted && r.id === pilotedId)) {
        this.stampRemoteTracks(r, dt, trackX0, trackY0);
      }
      if (r.spec.exhaustSmoke && !r.airborne) this.emitRemoteExhaustSmoke(r, dt);
      if (r.life <= 0) {
        if (r.spec.dockable) r.dock = true;
        else r.detonate = true;
      }
      if (r.dock) {
        const bay = this.remoteDockBayPos(r);
        const arrived = Math.hypot(r.x - bay.x, r.y - bay.y, r.z - bay.z) < 28;
        if (!arrived) {
          this.remotes[w++] = r;
          continue;
        }
        this.releaseRemotePilotCraft(r.id);
        this.refundRemoteAmmo(r.spec.kind);
        if (!r.spec.ai || r.spec.pilotable) this.exitRemoteView();
        continue;
      }
      if (r.detonate) {
        this.releaseRemotePilotCraft(r.id);
        this.beginImpactCamLinger(r.x, r.y, {
          thermal: r.spec.thermal ? this.craftSensorPalette() : undefined,
          hold: 1.65,
        });
        this.explode(r.x, r.y, r.z, r.spec.detonateBlast, r.spec.detonateDmg, undefined, r.vx, r.vy, r.vz, false, "guided-missile", 1);
        continue;
      }
      // Craft-piloted rotors spin inside Heli.update.
      if (remoteRotorParts(r.spec).length && !(craftPiloted && r.id === pilotedId)) {
        r.rotor += 18 * dt;
      }
      this.remotes[w++] = r;
    }
    this.remotes.length = w;
    if (!this.activeRemote()) this.remoteView = false;
    this.syncRemoteSprites();
    this.remoteExhaustVisCursor = 0;
    for (const flame of this.remoteExhaustFlames) flame.setVisible(false);
    for (const glow of this.remoteExhaustGlows) glow.setVisible(false);
    for (const r of this.remotes) {
      if (r.spec.antenna) this.tickRemoteAntenna(r, dt);
      if (
        r.spec.craftLook &&
        craftControlScheme(craftOf(r.spec.craftLook)) === "plane" &&
        !r.detonate &&
        !r.dock
      ) {
        this.emitRemotePlaneFx(r, dt);
      }
    }
    this.applyThermalMode();
  }

  ensureRemoteExhaustVisual(i: number): {
    flame: Phaser.GameObjects.Image;
    glow: Phaser.GameObjects.Image;
  } {
    while (this.remoteExhaustFlames.length <= i) {
      this.remoteExhaustFlames.push(
        this.add
          .image(0, 0, "fx_exhaust")
          .setDepth(Layer.WORLD)
          .setOrigin(0, 0.5)
          .setBlendMode(Phaser.BlendModes.ADD)
          .setVisible(false)
      );
      this.remoteExhaustGlows.push(
        this.add
          .image(0, 0, "fx_exhaust_glow")
          .setDepth(Layer.WORLD)
          .setOrigin(0.5, 0)
          .setBlendMode(Phaser.BlendModes.ADD)
          .setVisible(false)
      );
    }
    return {
      flame: this.remoteExhaustFlames[i]!,
      glow: this.remoteExhaustGlows[i]!,
    };
  }

  /** Wingtip contrails + exhaust wash for craft-backed plane remotes (Raptor). */
  emitRemotePlaneFx(r: RemoteCraft, dt: number): void {
    const body = this.remoteBodyImage(r);
    if (!body?.visible) return;
    const spd = Math.hypot(r.vx, r.vy);
    const hull = r.spec.craftLook ? craftOf(r.spec.craftLook) : undefined;
    const min = hull?.minSpeed ?? r.spec.minSpeed ?? 120;
    if (spd < min * 0.55) return;

    const tips = hull
      ? craftWingTipMounts(hull)
      : lookupSpritePoints(r.spec.look, "wingtip");
    if (tips.length) {
      if (!r.wingTrailPrevScreen) r.wingTrailPrevScreen = [];
      const state = {
        emitCarry: r.wingTrailEmitCarry ?? 0,
        mountCursor: r.wingTrailMountCursor ?? 0,
        prevScreen: r.wingTrailPrevScreen,
      };
      const bodyDepth =
        (body.getData("tiltWrap") as Phaser.GameObjects.Container | undefined)?.depth ??
        body.depth;
      this.emitWingTipContrails({
        dt,
        tips,
        bank: Math.abs(r.roll ?? 0),
        heading: r.angle,
        x: r.x,
        y: r.y,
        z: r.z,
        pose: this.remoteBodyDrawPose(body),
        bodyDepth,
        state,
      });
      r.wingTrailEmitCarry = state.emitCarry;
      r.wingTrailMountCursor = state.mountCursor;
    }

    const profile = hull?.exhaustProfile;
    const mounts = hull
      ? craftExhaustMounts(hull)
      : lookupSpritePoints(r.spec.look, "exhaust");
    const power = Phaser.Math.Clamp(spd / Math.max(1, hull?.maxSpeed ?? r.spec.maxSpeed), 0.2, 1);
    if (profile && mounts.length) {
      const pose = this.remoteBodyDrawPose(body);
      const bodyDepth =
        (body.getData("tiltWrap") as Phaser.GameObjects.Container | undefined)?.depth ??
        body.depth;
      const jetAng = projectHeading(r.angle + Math.PI, r.x, r.y, r.z);
      const zs = worldToScreen(r.x, r.y, r.z).scale;
      const glowAng = profile.glowFollowsHull ? pose.rotation : jetAng - Math.PI / 2;
      const flameHue = profile.flameHue ?? (hull ? craftExhaustFlameHue(hull.kind) : undefined);
      for (let mi = 0; mi < mounts.length; mi++) {
        const mount = mounts[mi]!;
        const { flame, glow } = this.ensureRemoteExhaustVisual(this.remoteExhaustVisCursor++);
        this.paintExhaustNozzle(mi, mount, {
          pose,
          jetAng,
          glowAng,
          zs,
          power,
          bodyDepth,
          cloakMul: 1,
          flameScale: profile.flame,
          glowTint: profile.tint,
          flame,
          glow,
          flameHue,
        });
      }
      // Sparse light trail wash (not a dense jet ribbon).
      if (spd > min * 0.7) {
        this.exhaustTint = profile.tint;
        this.exhaustSmokeTint = profile.smoke;
        this.exhaustAlpha = 0.18 + power * 0.4;
        this.exhaustScaleX = profile.sx * (0.35 + power * 0.45);
        this.exhaustScaleY = profile.sy * (0.35 + power * 0.4);
        this.exhaustLife = profile.life;
        this.exhaustAngle = jetAng;
        this.exhaustVx = Math.cos(r.angle + Math.PI) * profile.speed * (0.4 + power * 0.45);
        this.exhaustVy = Math.sin(r.angle + Math.PI) * profile.speed * (0.4 + power * 0.45);
        const glowFx = this.fxAt(r.z, r.y, this.craftExhaust, ZOff.exhaust + 0.04);
        glowFx.setDepth(bodyDepth - 1.2);
        for (const mount of mounts) {
          const at = spriteUvPos(pose, mount.x, mount.y);
          const take = this.fxEmitCount(0.35 + power * 0.35);
          if (take) this.emitBudgeted("fire", glowFx, at.x, at.y, take);
        }
      }
    } else if (mounts.length && spd > min * 0.7) {
      const pose = this.remoteBodyDrawPose(body);
      this.withTrailFx(0.7, () => {
        for (const ex of mounts) {
          const at = spriteUvPos(pose, ex.x, ex.y);
          const take = this.fxEmitCount(0.45);
          if (take) {
            this.emitBudgeted(
              "smoke",
              this.fxAt(r.z, r.y, this.craftExhaustSmoke, ZOff.smoke - 0.2),
              at.x,
              at.y,
              take
            );
          }
        }
      });
    }
  }

  /** Tank-track prints sized to the HOUND hull. */
  stampRemoteTracks(r: RemoteCraft, _dt: number, x0: number, y0: number): void {
    const kind = r.spec.track;
    if (!kind) return;
    const gap = r.spec.trackGap ?? 8;
    const sc = r.spec.trackScale ?? 0.4;
    const step = Math.hypot(r.x - x0, r.y - y0);
    // Distance-based: coasting / creeping still accumulate prints (no thrust gate).
    if (step < 1e-4) return;
    if (isWater(this.world, r.x, r.y)) return;
    const printGap = gap * 0.8;
    const first = printGap - (r.track ?? 0);
    for (let dist = first; dist <= step; dist += printGap) {
      const t = step > 0 ? Phaser.Math.Clamp(dist / step, 0, 1) : 1;
      const key = `fx_track_${kind}`;
      const back = r.spec.radius * 0.55;
      this.stampWreck(
        this.textures.exists(key) ? key : "fx_track_mono",
        Phaser.Math.Linear(x0, r.x, t) - Math.cos(r.angle) * back,
        Phaser.Math.Linear(y0, r.y, t) - Math.sin(r.angle) * back,
        r.angle + Math.PI / 2,
        sc,
        0.65
      );
    }
    r.track = ((r.track ?? 0) + step) % printGap;
  }

  /** Soft linger smoke off a remote’s aft (authored `exhaustSmoke`). */
  emitRemoteExhaustSmoke(r: RemoteCraft, dt: number): void {
    const cfg = r.spec.exhaustSmoke;
    if (!cfg) return;
    const spd = Math.hypot(r.vx, r.vy);
    if (spd < 6) {
      r.exhaustCarry = 0;
      return;
    }
    if (!cameraPointVisible(r.z, r.y)) return;
    const power = Phaser.Math.Clamp(spd / Math.max(40, r.spec.maxSpeed), 0, 1);
    const aft = cfg.aft ?? r.spec.radius * 0.75;
    const wx = r.x - Math.cos(r.angle) * aft;
    const wy = r.y - Math.sin(r.angle) * aft;
    const at = worldToScreen(wx, wy, r.z);
    this.exhaustSmokeTint = cfg.tint ?? 0x5a5a56;
    this.exhaustScaleY = (cfg.size ?? 0.3) * (0.55 + power * 0.65);
    this.exhaustAlpha = 0.18 + power * 0.32;
    this.exhaustVx = -Math.cos(r.angle) * spd * 0.12 + range(-6, 6);
    this.exhaustVy = -Math.sin(r.angle) * spd * 0.12 + range(-6, 6);
    this.exhaustAngle = projectHeading(r.angle + Math.PI, r.x, r.y, r.z);
    r.exhaustCarry = (r.exhaustCarry ?? 0) + cfg.rate * power * dt;
    const n = Math.floor(r.exhaustCarry);
    if (n <= 0) return;
    r.exhaustCarry -= n;
    this.withTrailFx(0.85, () => {
      const take = this.fxEmitCount(n);
      if (take) {
        this.emitBudgeted(
          "smoke",
          this.fxAt(r.z, r.y, this.craftExhaustSmoke, ZOff.smoke - 0.2),
          at.x,
          at.y,
          take
        );
      }
    });
  }

  /** Onboard remote gun — hold-fire in POV, or AI auto-fire toward aim. */
  fireRemoteGun(drone: RemoteCraft, dt: number, aimAt?: { x: number; y: number }): void {
    const gunId = remoteGunId(drone.spec);
    if (!gunId) return;
    const spec = PLAYER_WPNS[gunId];
    if (!spec) return;
    drone.gunCd = (drone.gunCd ?? 0) - dt;
    if (drone.gunCd > 0) return;
    drone.gunCd = spec.fireCd;

    const aim = aimAt ?? this.worldPointer();
    const jitterAmp = spec.fire?.jitter ?? 0.08;
    const sockets = drone.spec.sockets;
    let slot = sockets?.findIndex((s) => s.weapon === gunId && s.class === "fixed") ?? -1;
    if (slot < 0) slot = sockets?.findIndex((s) => s.weapon === gunId) ?? -1;
    const socket = slot >= 0 ? sockets![slot] : undefined;
    const hull = drone.spec.craftLook ? craftOf(drone.spec.craftLook) : undefined;
    // Plane remotes shoot along the nose (Skiff has no sockets — still fixed-forward).
    const planeFixed =
      !!hull &&
      craftControlScheme(hull) === "plane" &&
      socket?.class !== "turret";
    const wantAng = planeFixed
      ? drone.angle
      : Math.atan2(aim.y - drone.y, aim.x - drone.x);
    // Turrets keep slewed gunAngle (pilot/AI); do not snap to want on fire.
    const turret =
      socket?.class === "turret" || (!!hull && craftAimsWithTurret(hull) && socket?.class !== "fixed");
    if (planeFixed) drone.gunAngle = drone.angle;
    else if (!turret) drone.gunAngle = wantAng;
    const baseAng = planeFixed ? drone.angle : (drone.gunAngle ?? wantAng);

    const tips =
      slot >= 0
        ? this.remoteFireTips(drone, slot)
        : (() => {
            const bodyMuzzles = lookupSpritePoints(drone.spec.look, "muzzle");
            if (bodyMuzzles.length > 1) {
              const leaveZ = this.remoteMuzzleZ(drone);
              return bodyMuzzles.map((uv) => {
                const p = this.remoteBodyMountWorldPos(drone, uv);
                return { x: p.x, y: p.y, z: leaveZ };
              });
            }
            return [this.remoteGunMuzzle(drone)];
          })();
    const fxInterval = spec.fireCd / Math.max(1, tips.length);
    const muzzleMul = playerMuzzleFxMul(spec);
    const gunSc = drone.spec.gunScale ?? 0.55;
    const fxScale = projectileFxScale("player", fxInterval) * 0.7;

    for (const muzzle of tips) {
      const mx = muzzle.x;
      const my = muzzle.y;
      const mz = muzzle.z;
      const aimAng = baseAng + (Math.random() - 0.5) * jitterAmp;
      const spd = spec.speed;
      const clip = this.playerSightAimWorld(mx, my, mz, aimAng, undefined, aim);
      const dx = clip.x - mx;
      const dy = clip.y - my;
      const dz = clip.z - mz;
      const dist3 = Math.max(8, Math.hypot(dx, dy, dz));
      const hFrac = Math.hypot(dx, dy) / dist3;
      const beh = shotBehaviorOf(spec);
      const aimVel = this.muzzleAimVelocity({
        dx,
        dy,
        dz,
        z0: mz,
        tz: clip.z,
        spd,
        vx: Math.cos(aimAng) * spd * hFrac,
        vy: Math.sin(aimAng) * spd * hFrac,
      });
      this.spawnShot({
        from: "player",
        id: nextId(),
        wpnId: gunId,
        beh,
        st: { age: 0, launchAngle: aimAng },
        x: mx,
        y: my,
        z: mz,
        vx: Math.cos(aimAng) * spd * hFrac,
        vy: Math.sin(aimAng) * spd * hFrac,
        vz: aimVel.vz,
        angle: aimAng,
        // Match heli guns: flight time from aim distance, not the catalog tracer life
        // (minigun life ~0.08s is a short-range heli cue — it truncates AGV shots early).
        life: aimVel.life,
        blast: beh.blast,
        dmg: beh.dmg,
        look: spec.art.look,
        scale: spec.art.scale * 0.85,
        fxInterval,
        energyTrail: exhaustIsEnergy(spec.exhaust) ? [] : undefined,
      });
      this.emitVisualBurst(mx, my, mz, {
        n: scaledProjectileFxCount(12, fxScale),
        spdMin: 35,
        spdMax: 420,
        bx: Math.cos(aimAng),
        by: Math.sin(aimAng),
        bz: 0.2,
        tight: 0.84,
        scaleMul: 0.3,
        stretchMul: 2.8,
        coneHalf: (260 * Math.PI) / 360,
      }, this.muzzleBurst);
      const flashMul = 0.95 * muzzleMul * range(0.9, 1.12);
      this.showMuzzle({
        life: 0.12,
        ang: aimAng,
        scaleMul: flashMul,
        // Keep bloom tiny — flash sprite can be large without a huge soft circle.
        glowMul: 7 * gunSc,
        worldX: mx,
        worldY: my,
        worldZ: mz,
      });
      const at = worldToScreen(mx, my, mz);
      this.spawnMuzzleLight(at.x, at.y, mz, 18 * at.scale);
      this.emitVisualBurst(mx, my, mz, {
        n: 4,
        spdMin: 8,
        spdMax: 90,
        bx: Math.cos(aimAng),
        by: Math.sin(aimAng),
        bz: 0,
        tight: 0.85,
        scaleMul: 0.28,
        stretchMul: 1.4,
        coneHalf: (220 * Math.PI) / 360,
        depthOff: ZOff.shot,
      }, this.muzzleBurst);
      if (specIsShellGun(spec)) {
        const gunIm = this.remoteGunImage(drone);
        const gunTips = gunIm ? lookupSpriteMuzzles(gunIm.texture.key) : [];
        const side = this.shellEjectSide({ muzzleUv: gunTips[0] });
        const ejectAt = gunIm
          ? screenToWorldAtZ(gunIm.x, gunIm.y, mz)
          : { x: mx, y: my };
        this.spawnShellEject({
          x: ejectAt.x,
          y: ejectAt.y,
          z: drone.spec.ground ? drone.z + drone.spec.height * 0.7 : mz - 4,
          barrelAng: aimAng,
          designation: spec.designation,
          scale: spec.art.scale,
          dmg: spec.dmg,
          side,
          aerial: !drone.spec.ground,
          fireCd: fxInterval,
        });
      }
    }
  }

  /**
   * POV remote loadout fire — same control modes / catalog weapons as the bird HUD.
   */
  handlePovRemoteFire(
    drone: RemoteCraft,
    dt: number,
    ptr: { x: number; y: number },
    down: boolean,
    pressed: boolean,
    released: boolean
  ): void {
    const loadout = drone.loadout;
    const ammo = drone.ammo;
    if (!loadout?.length || !ammo) return;
    const slot = Phaser.Math.Clamp(drone.weapon ?? 0, 0, loadout.length - 1);
    drone.weapon = slot;
    const spec = loadout[slot]!;
    drone.fireCd = Math.max(0, (drone.fireCd ?? 0) - dt);

    let wantFire = false;
    if (spec.control.mode === "hold_mouse_down") wantFire = down;
    else if (spec.control.mode === "click" || spec.control.mode === "click_then_click_to_commit") {
      wantFire = pressed;
    } else if (spec.control.mode === "lock_then_click") {
      wantFire = (pressed || down) && !!this.heli.lockTarget;
    } else if (spec.control.mode === "click_to_set_target") {
      if (pressed) this.designateLatch = { x: ptr.x, y: ptr.y };
      if (down && this.designateLatch) this.designateLatch = { x: ptr.x, y: ptr.y };
      wantFire = released && !!this.designateLatch;
      if (wantFire) this.designateLatch = null;
    }

    if (!wantFire || (drone.fireCd ?? 0) > 0) return;

    const hostWpn = this.remoteHostAmmoWeapon(spec);
    if (hostWpn) {
      // Barrage owns the howitzer — no spot fire or new strike until it finishes.
      if (this.hostWeaponStrikeActive(hostWpn)) return;
      const hostLeft = this.hostWeaponAmmoLeft(hostWpn);
      if (hostLeft == null) return;
      if (!this.infAmmo && Number.isFinite(hostLeft) && hostLeft <= 0) return;

      // Spot howitzer: real station fire + shared CD (not the flare / call-strike path).
      if (payloadIsHostFire(spec.payload)) {
        if (!this.hostStationFireReady(hostWpn)) return;
        const ok = this.fireHostWeaponAt(hostWpn, ptr);
        if (ok) {
          const hostSpec = PLAYER_WPNS[hostWpn as WpnId];
          drone.fireCd = hostSpec?.fireCd ?? spec.fireCd;
        }
        return;
      }
      // Call-strike: spend remote flare ammo below; howitzer bank must still have shells.
    }

    if (!this.infAmmo && Number.isFinite(ammo[slot]!) && ammo[slot]! <= 0) return;

    drone.fireCd = spec.fireCd;
    if (!this.infAmmo && Number.isFinite(ammo[slot]!)) ammo[slot]!--;
    this.fireRemoteLoadoutWeapon(drone, slot, spec, ptr);
  }

  /**
   * Trigger a real host station fire (same path as the player aiming that gun).
   * Uses shared `stationFireCd` so strike / remote / crew cannot overlapping-fire.
   * Does not forge station aim — barrel angle / traverse from normal slew apply.
   * `ptr` is the ballistic aim point (reticle / call-strike wobble).
   */
  fireHostWeaponAt(
    wpnId: string,
    ptr: { x: number; y: number },
    opts?: { fromStrike?: boolean }
  ): boolean {
    const hostSpec = PLAYER_WPNS[wpnId as WpnId];
    if (!hostSpec) return false;
    const slot = this.hostWeaponSlot(wpnId);
    if (slot < 0) return false;
    if (!opts?.fromStrike && this.hostWeaponStrikeActive(wpnId)) return false;
    if (!this.hasAmmo(slot)) return false;
    const cds = this.ensureStationFireCd(slot);
    if ((cds[0] ?? 0) > 0) return false;
    cds[0] = craftSocketFireCd(hostSpec.fireCd, this.heli.spec, slot);
    this.firePlayerWeapon(slot, hostSpec, ptr);
    return true;
  }

  /** Shell-gun kick opposite the bore (turret aim or fixed hull heading). */
  applyPlayerShellRecoil(slot: number, spec: PlayerWpnSpec, gunAngle: number): void {
    const h = this.heli;
    const fireSock = h.spec.sockets[slot];
    if (!(h.spec.cannonInherit || fireSock?.recoil) || !specIsShellGun(spec)) return;
    const kick = (9 + spec.dmg * 0.28) * Math.min(1.35, spec.fireCd / 0.04);
    h.applyGunRecoil(kick, gunAngle);
  }

  /** Spawn one remote-loadout round from the remote (or host, for call-strike / hostFire). */
  fireRemoteLoadoutWeapon(
    drone: RemoteCraft,
    slot: number,
    spec: PlayerWpnSpec,
    ptr: { x: number; y: number }
  ): void {
    const socket = drone.spec.sockets?.[slot];
    const hull = drone.spec.craftLook ? craftOf(drone.spec.craftLook) : undefined;
    const planeFixed =
      !!hull &&
      craftControlScheme(hull) === "plane" &&
      socket?.class === "fixed";
    const wantAng = planeFixed
      ? drone.angle
      : Math.atan2(ptr.y - drone.y, ptr.x - drone.x);
    // Turret stations fire along the slewed barrel; hardpoints / observers may face aim.
    if (planeFixed) {
      drone.gunAngle = drone.angle;
    } else if (socket?.class === "turret" && hull && craftAimsWithTurret(hull)) {
      // Keep current slewed angle from tickRemoteCraftPilot / AI.
    } else {
      drone.gunAngle = wantAng;
    }
    const aimAng =
      socket?.class === "turret" && hull && craftAimsWithTurret(hull)
        ? (drone.gunAngle ?? wantAng)
        : wantAng;

    if (payloadIsHostFire(spec.payload)) {
      const ok = this.fireHostWeaponAt(spec.payload.hostFire!.weapon, ptr);
      if (!ok) {
        // Mount missing / dry — clear remote CD so the player can retry.
        drone.fireCd = 0;
      }
      return;
    }

    const launch = spec.launch;

    if (launch.mode === "kick_motor") {
      this.fireRemoteKickMotor(drone, slot, spec, aimAng);
      return;
    }

    if (launch.mode === "drop") {
      this.fireRemoteDropShot(drone, slot, spec, ptr);
      return;
    }

    // Muzzle guns, flares, and other direct fire — from authored tips (simultaneous dual nose, etc.).
    const fireAng =
      socket?.class === "hardpoint" && hull && craftControlScheme(hull) === "plane"
        ? drone.angle
        : aimAng;
    const tips = this.remoteFireTips(drone, slot);
    const fxInterval = spec.fireCd / Math.max(1, tips.length);
    const launchInherit =
      spec.launch.mode === "muzzle" && "inheritMomentum" in launch
        ? launch.inheritMomentum
        : 0;
    const planeish = hull?.flightModel === "plane" || hull?.flightModel === "vtol";
    const inherit = planeish ? Math.min(1, launchInherit + 0.28) : launchInherit;
    for (const muzzle of tips) {
      const jitter = (Math.random() - 0.5) * (spec.fire?.jitter ?? 0.04);
      const ang = fireAng + jitter;
      const spd = spec.speed;
      const origin = this.playerShotOrigin(muzzle, ang, spec);
      const mx = origin.x;
      const my = origin.y;
      const mz = origin.z;
      const clip = this.playerSightAimWorld(mx, my, mz, ang, undefined, ptr);
      const dx = clip.x - mx;
      const dy = clip.y - my;
      const dz = clip.z - mz;
      const dist3 = Math.max(8, Math.hypot(dx, dy, dz));
      const hFrac = Math.hypot(dx, dy) / dist3;
      const beh = shotBehaviorOf(spec);
      const grav = launchGravity(spec.launch);
      const aimVel = this.muzzleAimVelocity({
        dx,
        dy,
        dz,
        z0: mz,
        tz: clip.z,
        spd,
        vx: Math.cos(ang) * spd * hFrac,
        vy: Math.sin(ang) * spd * hFrac,
        grav,
      });
      const fromHost = !!spec.payload.callStrike;
      this.spawnShot({
        from: "player",
        id: nextId(),
        wpnId: wpnIdOf(spec),
        slot,
        beh,
        st: {
          age: 0,
          launchAngle: ang,
          callStrikeFromHost: fromHost || undefined,
        },
        x: mx,
        y: my,
        z: mz,
        vx: Math.cos(ang) * spd * hFrac + drone.vx * inherit,
        vy: Math.sin(ang) * spd * hFrac + drone.vy * inherit,
        vz: aimVel.vz,
        angle: ang,
        life: payloadIsCallStrike(spec.payload) ? spec.life : aimVel.life,
        blast: beh.blast,
        dmg: beh.dmg,
        look: spec.art.look,
        scale: spec.art.scale * (payloadIsCallStrike(spec.payload) ? 1 : 0.85),
        fxInterval,
        energyTrail: exhaustIsEnergy(spec.exhaust) ? [] : undefined,
        energyTrails:
          exhaustRibbons(spec.exhaust) > 1
            ? Array.from({ length: exhaustRibbons(spec.exhaust) }, () => [] as EnergyTrailNode[])
            : undefined,
      });
      if (spec.fire?.muzzleFlash ?? true) {
        const muzzleMul = playerMuzzleFxMul(spec);
        this.showMuzzle({
          life: 0.12,
          ang,
          scaleMul: 0.9 * muzzleMul * range(0.9, 1.12),
          glowMul: 8 * (drone.spec.gunScale ?? 0.55),
          worldX: mx,
          worldY: my,
          worldZ: mz,
        });
      }
    }
  }

  /** Gravity bomb from a remote bay. */
  fireRemoteDropShot(
    drone: RemoteCraft,
    slot: number,
    spec: PlayerWpnSpec,
    ptr: { x: number; y: number }
  ): void {
    const launch = spec.launch;
    if (launch.mode !== "drop") return;
    const tip = this.remoteFireTips(drone, slot)[0] ?? {
      x: drone.x,
      y: drone.y,
      z: drone.z,
    };
    const release = this.remoteBombReleaseVelocity(drone, spec, tip.x, tip.y, ptr, slot);
    const dropZ = tip.z;
    const grav = launchGravity(spec.launch);
    const beh = shotBehaviorOf(spec);
    const fallT = this.estimateBombFallTime(
      dropZ,
      release.vz,
      groundZ(this.world, ptr.x, ptr.y),
      grav?.acceleration ?? 210,
      grav?.terminalVelocity ?? 520
    );
    this.spawnShot({
      from: "player",
      id: nextId(),
      wpnId: wpnIdOf(spec),
      slot,
      beh,
      st: {
        age: 0,
        launchAngle: release.angle,
        gx: ptr.x,
        gy: ptr.y,
      },
      x: tip.x,
      y: tip.y,
      z: dropZ,
      vx: release.vx,
      vy: release.vy,
      vz: release.vz,
      angle: release.angle,
      life: Math.max(spec.life, fallT + 1.2),
      blast: beh.blast,
      dmg: beh.dmg,
      look: spec.art.look,
      scale: spec.art.scale,
      fxInterval: spec.fireCd,
    });
  }

  /** Photon / hardpoint kick-motor from a remote hull. */
  fireRemoteKickMotor(
    drone: RemoteCraft,
    slot: number,
    spec: PlayerWpnSpec,
    aimAng: number
  ): void {
    const launch = spec.launch;
    if (launch.mode !== "kick_motor") return;
    const beh = shotBehaviorOf(spec);
    const kick = launch.kickSpeed;
    const inherit = launch.inheritMomentum;
    const g = spec.guidance;
    const lockId =
      targetingMode(g) === "lock_on" || targetingMode(g) === "steer_commit"
        ? this.heli.lockTarget?.id
        : undefined;
    const side = Math.random() < 0.5 ? -1 : 1;
    const tips = this.remoteFireTips(drone, slot);
    for (const muzzle of tips) {
      this.spawnShot({
        from: "player",
        id: nextId(),
        wpnId: wpnIdOf(spec),
        slot,
        beh,
        st: { age: 0, launchAngle: aimAng },
        x: muzzle.x,
        y: muzzle.y,
        z: muzzle.z,
        vx: drone.vx * inherit + Math.cos(aimAng) * kick,
        vy: drone.vy * inherit + Math.sin(aimAng) * kick,
        vz: drone.vz * inherit,
        angle: aimAng,
        life: spec.life,
        targetId: lockId,
        blast: beh.blast,
        dmg: beh.dmg,
        look: spec.art.look,
        scale: spec.art.scale,
        fxInterval: spec.fireCd,
        povCam: spec.cam.povCam || undefined,
        motor: -launch.igniteDelay,
        cruise: spec.speed,
        loft: launch.softLoft,
        yaw:
          side *
          (launch.yawMul ??
            (targetingMode(g) === "lock_on" ? 1.05 + Math.random() * 0.45 : 0.42 + Math.random() * 0.22)),
        tint: spec.art.tint,
        energyTrail: exhaustIsEnergy(spec.exhaust) ? [] : undefined,
        energyTrails:
          exhaustRibbons(spec.exhaust) > 1
            ? Array.from({ length: exhaustRibbons(spec.exhaust) }, () => [] as EnergyTrailNode[])
            : undefined,
      });
      this.missileMuzzle(
        muzzle.x,
        muzzle.y,
        muzzle.z,
        aimAng,
        projectileFxScale("player", spec.fireCd)
      );
    }
  }

  /** World base for a remote whip antenna — sprite UV when the body is posed. */
  remoteAntennaBase(drone: RemoteCraft): { x: number; y: number; z: number } | undefined {
    if (!drone.spec.antenna) return undefined;
    const z = drone.z + drone.spec.height * 0.42;
    const body = this.remoteBodyImage(drone);
    const look = body?.visible ? body.texture.key : drone.spec.look;
    const uv = lookupSpritePoints(look, "antenna")[0];
    if (body?.visible && uv) {
      const scr = spriteUvPos(body, uv.x, uv.y);
      const at = screenToWorldAtZ(scr.x, scr.y, z);
      return { x: at.x, y: at.y, z };
    }
    const aft = drone.spec.radius * 0.72;
    return {
      x: drone.x - Math.cos(drone.angle) * aft,
      y: drone.y - Math.sin(drone.angle) * aft,
      z,
    };
  }

  remoteAntennaRest(
    drone: RemoteCraft,
    base: { x: number; y: number; z: number }
  ): { x: number; y: number; z: number } {
    const cfg = drone.spec.antenna!;
    const len = cfg.length ?? 12;
    const aft = cfg.aft ?? 2;
    return {
      x: base.x - Math.cos(drone.angle) * aft,
      y: base.y - Math.sin(drone.angle) * aft,
      z: base.z + len,
    };
  }

  /** Spring whip — lags thrust / yaw, overshoots rest on stop, then settles. */
  tickRemoteAntenna(drone: RemoteCraft, dt: number): void {
    const cfg = drone.spec.antenna;
    if (!cfg || dt <= 1e-6) return;
    const base = this.remoteAntennaBase(drone);
    if (!base) return;
    const rest = this.remoteAntennaRest(drone, base);
    let tip = drone.antenna;
    if (!tip) {
      drone.antenna = {
        x: rest.x,
        y: rest.y,
        z: rest.z,
        vx: 0,
        vy: 0,
        vz: 0,
        bx: base.x,
        by: base.y,
        bz: base.z,
        bvx: 0,
        bvy: 0,
        angle: drone.angle,
      };
      return;
    }
    const invDt = 1 / Math.max(1e-4, dt);
    const bvx = (base.x - tip.bx) * invDt;
    const bvy = (base.y - tip.by) * invDt;
    const ax = (bvx - tip.bvx) * invDt;
    const ay = (bvy - tip.bvy) * invDt;
    const omega = Phaser.Math.Angle.Wrap(drone.angle - tip.angle) * invDt;

    const k = cfg.stiffness ?? 26;
    const c = cfg.damping ?? 2.4;
    const lag = cfg.lag ?? 1.6;
    const whip = cfg.yawWhip ?? 12;
    const len = cfg.length ?? 12;

    tip.vx += ((rest.x - tip.x) * k - tip.vx * c) * dt;
    tip.vy += ((rest.y - tip.y) * k - tip.vy * c) * dt;
    tip.vz += ((rest.z - tip.z) * k - tip.vz * c) * dt;
    tip.vx -= ax * lag * dt;
    tip.vy -= ay * lag * dt;
    tip.vx += -Math.sin(drone.angle) * omega * whip * len * dt;
    tip.vy += Math.cos(drone.angle) * omega * whip * len * dt;

    tip.x += tip.vx * dt;
    tip.y += tip.vy * dt;
    tip.z += tip.vz * dt;

    {
      const dx = tip.x - base.x;
      const dy = tip.y - base.y;
      const dz = tip.z - base.z;
      const span = Math.hypot(dx, dy, dz);
      // Keep the whip short — tip stays near rest length, mild lean only.
      const maxLen = len * 1.28;
      if (span > maxLen && span > 1e-4) {
        const s = maxLen / span;
        tip.x = base.x + dx * s;
        tip.y = base.y + dy * s;
        tip.z = base.z + dz * s;
        const rv = tip.vx * dx + tip.vy * dy + tip.vz * dz;
        if (rv > 0) {
          const inv = 1 / (span * span);
          tip.vx -= dx * rv * inv;
          tip.vy -= dy * rv * inv;
          tip.vz -= dz * rv * inv;
        }
      }
    }

    tip.bx = base.x;
    tip.by = base.y;
    tip.bz = base.z;
    tip.bvx = bvx;
    tip.bvy = bvy;
    tip.angle = drone.angle;
  }

  drawRemoteAntennas(): void {
    const g = this.remoteAntennaGfx;
    if (!g) return;
    g.clear();
    let depth: number = Layer.WORLD;
    let drew = false;
    for (const r of this.remotes) {
      if (!r.spec.antenna || r.detonate || r.dock) continue;
      if (!cameraPointVisible(r.z, r.y)) continue;
      const base = this.remoteAntennaBase(r);
      const tip = r.antenna;
      if (!base || !tip) continue;
      const rest = this.remoteAntennaRest(r, base);
      // Tip spring is the only sim — draw a visible bend by pulling control
      // points ~90° off the upright rest spine toward the tip's lean.
      const leanX = tip.x - rest.x;
      const leanY = tip.y - rest.y;
      const leanZ = tip.z - rest.z;
      // Amplify lateral lean so the curve reads even when tip motion is small.
      const bend = 1.55;
      const c1 = {
        x: base.x + (rest.x - base.x) * 0.35 + leanX * bend * 0.55,
        y: base.y + (rest.y - base.y) * 0.35 + leanY * bend * 0.55,
        z: base.z + (rest.z - base.z) * 0.35 + leanZ * bend * 0.25,
      };
      const c2 = {
        x: base.x + (rest.x - base.x) * 0.72 + leanX * bend * 1.05,
        y: base.y + (rest.y - base.y) * 0.72 + leanY * bend * 1.05,
        z: base.z + (rest.z - base.z) * 0.72 + leanZ * bend * 0.55,
      };
      const segs = 10;
      const pts: { x: number; y: number }[] = [];
      for (let i = 0; i <= segs; i++) {
        const t = i / segs;
        const u = 1 - t;
        // Cubic Bezier base → c1 → c2 → tip
        const wx =
          u * u * u * base.x +
          3 * u * u * t * c1.x +
          3 * u * t * t * c2.x +
          t * t * t * tip.x;
        const wy =
          u * u * u * base.y +
          3 * u * u * t * c1.y +
          3 * u * t * t * c2.y +
          t * t * t * tip.y;
        const wz =
          u * u * u * base.z +
          3 * u * u * t * c1.z +
          3 * u * t * t * c2.z +
          t * t * t * tip.z;
        const at = worldToScreen(wx, wy, wz);
        pts.push({ x: at.x, y: at.y });
        depth = Math.min(depth, worldDepth(wz, ZOff.body + 0.55, wy));
      }
      if (pts.length < 2) continue;
      drew = true;
      const stroke = (color: number, alpha: number, width: number, dy: number) => {
        g.lineStyle(width, color, alpha);
        g.beginPath();
        g.moveTo(pts[0]!.x, pts[0]!.y + dy);
        for (let i = 1; i < pts.length; i++) g.lineTo(pts[i]!.x, pts[i]!.y + dy);
        g.strokePath();
      };
      // Matte rubber/black whip — no pale metal highlight (that read as a gun barrel).
      stroke(0x0c0c0e, 0.55, 1.85, 0.45);
      stroke(0x2a2c28, 0.78, 1.05, 0);
      stroke(0x3e4238, 0.35, 0.45, -0.3);
    }
    if (drew) g.setDepth(depth);
  }

  /**
   * World XY of an authored UV on the remote's rendered hull (look sprite).
   * Projection plane matches host `craftBodyMountWorldPos` (mid-hull).
   */
  remoteBodyMountWorldPos(
    drone: RemoteCraft,
    mount: { x: number; y: number }
  ): { x: number; y: number } {
    const bodyIm = this.remoteBodyImage(drone);
  if (bodyIm?.visible) {
    const pose = this.remoteBodyDrawPose(bodyIm);
    const scr = spriteUvPos(pose, mount.x, mount.y);
    // Same mid-hull plane as craftBodyMountWorldPos — leave Z is remoteMuzzleZ.
    const z = drone.z + drone.spec.height * 0.55;
    const at = screenToWorldAtZ(scr.x, scr.y, z);
    return { x: at.x, y: at.y };
  }
    // Pre-sync fallback: rotate UV offset around craft origin in world space.
    const key = drone.spec.look;
    const pivot = lookupSpriteOrigin(key) ?? { x: 0.5, y: 0.5 };
    const img = this.textures.exists(key)
      ? (this.textures.get(key).getSourceImage() as { width: number; height: number })
      : { width: 120, height: 120 };
    const rotOff = drone.spec.rotOff ?? Math.PI / 2;
    const hullRot = drone.angle + rotOff;
    const sc = drone.spec.scale;
    const mx = (mount.x - pivot.x) * img.width * sc;
    const my = (mount.y - pivot.y) * img.height * sc;
    return {
      x: drone.x + mx * Math.cos(hullRot) - my * Math.sin(hullRot),
      y: drone.y + mx * Math.sin(hullRot) + my * Math.cos(hullRot),
    };
  }

  /**
   * Socket emit UVs on the remote look sprite (not hull.body — Skiff overrides look).
   * Same resolver as host craftSocketPoints soft path (`socketPointsOnKey`).
   */
  remoteSocketPoints(
    drone: RemoteCraft,
    socket: { class: string; points?: { id: string }[] }
  ): { x: number; y: number; id?: string }[] {
    return socketPointsOnKey(drone.spec.look, socket);
  }

  /**
   * Fire origins for a remote socket — simultaneous / alternate body muzzles,
   * hardpoint ammo-phase (same as host `hardpointPylon`), or turret tips.
   * Leave Z matches host `playerMuzzleZ` (gunLayer); turret XY plane matches `gunTip` (base Z).
   */
  remoteFireTips(
    drone: RemoteCraft,
    slot: number
  ): { x: number; y: number; z: number }[] {
    const leaveZ = this.remoteMuzzleZ(drone, slot);
    const socket = drone.spec.sockets?.[slot];
    if (socket && (socket.class === "fixed" || socket.class === "hardpoint")) {
      const authored = this.remoteSocketPoints(drone, socket);
      if (authored.length) {
        let uvs = authored;
        if (socket.class === "hardpoint") {
          // Match host: ammo already spent in handlePovRemoteFire.
          uvs = [authored[hardpointAmmoIndex(drone.ammo?.[slot] ?? 0, authored.length, true)]!];
        } else if (socket.muzzleFire === "simultaneous") {
          uvs = authored;
        } else if (socket.muzzleFire === "alternate") {
          uvs = [authored[this.playerGunSide++ % authored.length]!];
        } else {
          uvs = [authored[0]!];
        }
        return uvs.map((uv) => {
          const p = this.remoteBodyMountWorldPos(drone, uv);
          return { x: p.x, y: p.y, z: leaveZ };
        });
      }
    }
    if (socket?.class === "turret") {
      const gunIm = this.remoteGunImage(drone);
      const bodyIm = this.remoteBodyImage(drone);
      if (gunIm && bodyIm?.visible) {
        const pose = this.remoteBodyDrawPose(bodyIm);
        this.poseRemoteGun(drone, pose, bodyIm.texture.key, gunIm);
        const tips = lookupSpriteMuzzles(gunIm.texture.key);
        // Match host gunTip: unproject at hull base Z, stamp leave Z separately.
        const planeZ = drone.z;
        if (tips.length > 1 && socket.muzzleFire === "simultaneous") {
          return tips.map((tipUv) => {
            const scr = spriteUvPos(gunIm, tipUv.x, tipUv.y);
            const at = screenToWorldAtZ(scr.x, scr.y, planeZ);
            return { x: at.x, y: at.y, z: leaveZ };
          });
        }
        if (tips.length > 1 && socket.muzzleFire === "alternate") {
          const tipUv = tips[this.playerGunSide++ % tips.length]!;
          const scr = spriteUvPos(gunIm, tipUv.x, tipUv.y);
          const at = screenToWorldAtZ(scr.x, scr.y, planeZ);
          return [{ x: at.x, y: at.y, z: leaveZ }];
        }
      }
    }
    return [this.remoteGunMuzzle(drone, slot)];
  }

  /**
   * Sight emit tips for a remote socket — same rules as host craft:
   * multi-barrel guns collapse to one beam; hardpoints follow ammo phase.
   */
  remoteSightOrigins(
    drone: RemoteCraft,
    slot: number
  ): { x: number; y: number; z: number }[] {
    const leaveZ = this.remoteMuzzleZ(drone, slot);
    const socket = drone.spec.sockets?.[slot];
    if (socket && (socket.class === "fixed" || socket.class === "hardpoint")) {
      const authored = this.remoteSocketPoints(drone, socket);
      if (authored.length) {
        let uvs = authored;
        if (socket.class === "hardpoint") {
          uvs = [authored[hardpointAmmoIndex(drone.ammo?.[slot] ?? 0, authored.length)]!];
        }
        // fixed (incl. simultaneous duals): all ports, then collapse like cannonSightOrigins
        const tips = uvs.map((uv) => {
          const p = this.remoteBodyMountWorldPos(drone, uv);
          return { x: p.x, y: p.y, z: leaveZ };
        });
        return collapseSightTips(tips);
      }
    }
    if (socket?.class === "turret") {
      const gunIm = this.remoteGunImage(drone);
      const bodyIm = this.remoteBodyImage(drone);
      if (gunIm && bodyIm?.visible) {
        const pose = this.remoteBodyDrawPose(bodyIm);
        this.poseRemoteGun(drone, pose, bodyIm.texture.key, gunIm);
        const muzzles = lookupSpriteMuzzles(gunIm.texture.key);
        if (muzzles.length) {
          const planeZ = drone.z;
          const tips = muzzles.map((tipUv) => {
            const scr = spriteUvPos(gunIm, tipUv.x, tipUv.y);
            const at = screenToWorldAtZ(scr.x, scr.y, planeZ);
            return { x: at.x, y: at.y, z: leaveZ };
          });
          return collapseSightTips(tips);
        }
      }
    }
    return [this.remoteGunMuzzle(drone, slot)];
  }

  /** Barrel tip for a remote gun — matches the overlay muzzle UV (not a hull-radius offset). */
  remoteGunMuzzle(drone: RemoteCraft, slot?: number): { x: number; y: number; z: number } {
    const leaveZ = this.remoteMuzzleZ(drone, slot);
    const gunAng = drone.gunAngle ?? drone.angle;
    const gunIm = this.remoteGunImage(drone);
    const bodyIm = this.remoteBodyImage(drone);
    if (gunIm && bodyIm?.visible) {
      const pose = this.remoteBodyDrawPose(bodyIm);
      this.poseRemoteGun(drone, pose, bodyIm.texture.key, gunIm);
      const tips = lookupSpriteMuzzles(gunIm.texture.key);
      const tipUv = tips[0] ?? { x: 0.5, y: 0.05 };
      // Match host gunTip: unproject at hull base Z.
      const scr = spriteUvPos(gunIm, tipUv.x, tipUv.y);
      const at = screenToWorldAtZ(scr.x, scr.y, drone.z);
      return { x: at.x, y: at.y, z: leaveZ };
    }
    // Body muzzle fallback when there is no gun overlay (Raptor fixed nose guns).
    const bodyMuzzles = lookupSpritePoints(drone.spec.look, "muzzle");
    if (bodyMuzzles.length) {
      const p = this.remoteBodyMountWorldPos(drone, bodyMuzzles[0]!);
      return { x: p.x, y: p.y, z: leaveZ };
    }
    // Fallback before the first sprite sync: hub + short barrel reach.
    const reach = drone.spec.radius * 0.7;
    return {
      x: drone.x + Math.cos(gunAng) * reach,
      y: drone.y + Math.sin(gunAng) * reach,
      z: leaveZ,
    };
  }

  /** Place remote gun overlay on the body hub for the current aim (shared by draw + fire). */
  poseRemoteGun(
    drone: RemoteCraft,
    bodyPose: {
      x: number;
      y: number;
      rotation: number;
      displayWidth: number;
      displayHeight: number;
      originX: number;
      originY: number;
    },
    bodyKey: string,
    gunIm: Phaser.GameObjects.Image
  ): void {
    const gunKey =
      (drone.spec.gunTex && this.textures.exists(drone.spec.gunTex) && drone.spec.gunTex) ||
      "gun_minigun";
    if (gunIm.texture.key !== gunKey) gunIm.setTexture(gunKey);
    const gOrig = lookupSpriteOrigin(gunKey) ?? { x: 0.5, y: 0.7 };
    const gunAng = drone.gunAngle ?? drone.angle;
    const mount = lookupSpritePoints(bodyKey, "gun")[0] ?? { x: 0.5, y: 0.5 };
    const hub = spriteUvPos(bodyPose, mount.x, mount.y);
    const at = worldToScreen(drone.x, drone.y, drone.z);
    gunIm
      .setVisible(true)
      .setOrigin(gOrig.x, gOrig.y)
      .setPosition(hub.x, hub.y)
      .setRotation(projectHeading(gunAng + Math.PI / 2, drone.x, drone.y, drone.z))
      .setScale((drone.spec.gunScale ?? 0.55) * at.scale);
  }

  /** Live body Image for a remote in `remoteG`. */
  remoteBodyImage(drone: RemoteCraft): Phaser.GameObjects.Image | undefined {
    const i = this.remotes.indexOf(drone);
    if (i < 0) return undefined;
    const nRotors = remoteRotorPoolSize();
    const stride = 2 + nRotors + 1;
    const kids = this.remoteG.getChildren() as Phaser.GameObjects.Image[];
    return kids[i * stride + 1];
  }

  /** Live gun Image for a remote in `remoteG` (stride: shadow, body, rotors…, gun). */
  remoteGunImage(drone: RemoteCraft): Phaser.GameObjects.Image | undefined {
    const i = this.remotes.indexOf(drone);
    if (i < 0) return undefined;
    const nRotors = remoteRotorPoolSize();
    const stride = 2 + nRotors + 1;
    const kids = this.remoteG.getChildren() as Phaser.GameObjects.Image[];
    return kids[i * stride + 2 + nRotors];
  }

  tickRemoteCamBlend(dt: number): void {
    const want = this.remoteView && this.activeRemote() ? 1 : 0;
    const rate = want > this.remoteCamT ? 3.1 : 4.6;
    this.remoteCamT = Phaser.Math.Linear(this.remoteCamT, want, 1 - Math.exp(-rate * dt));
    if (want === 0 && this.remoteCamT < 0.012) this.remoteCamT = 0;
  }

  remoteLookOffset(drone: RemoteCraft): { x: number; y: number } {
    const hx = this.heli.x;
    const hy = this.heli.y;
    const p = this.pointerScreen();
    const aim = screenToWorldAtZ(p.x, p.y, drone.z);
    const toAx = aim.x - drone.x;
    const toAy = aim.y - drone.y;
    const aLen = Math.hypot(toAx, toAy);
    const remSlot = drone.weapon ?? 0;
    const remSpec =
      drone.loadout?.[remSlot] ?? this.hudLoadout()[this.hudWeapon()];
    const hull = drone.spec.craftLook ? craftOf(drone.spec.craftLook) : undefined;
    const isPlane = !!hull && craftControlScheme(hull) === "plane";
    let pull: number;
    let max: number;
    if (remSpec) {
      const look = planeLookCam(remSpec, isPlane);
      pull = look.pull;
      max = look.max;
    } else {
      // Spectre / no-HUD remotes — speed-based lead (legacy).
      const spd = Math.hypot(drone.vx, drone.vy);
      max = Phaser.Math.Clamp(100 + spd * 0.28, 100, 220);
      pull = 0.7;
    }
    let lx = 0;
    let ly = 0;
    if (aLen > 12) {
      lx = toAx * pull;
      ly = toAy * pull;
      const len = Math.hypot(lx, ly);
      if (len > max) {
        lx *= max / len;
        ly *= max / len;
      }
    } else {
      lx = Math.cos(drone.angle) * max * 0.55;
      ly = Math.sin(drone.angle) * max * 0.55;
    }
    return { x: drone.x + lx - hx, y: drone.y + ly - hy };
  }

  syncRemoteSprites(): void {
    const nRotors = remoteRotorPoolSize();
    const stride = 2 + nRotors + 1; // shadow, body, rotors…, gun
    while (this.remoteG.getLength() < this.remotes.length * stride) {
      this.remoteG.add(this.add.image(0, 0, "fx_shadow"));
      this.remoteG.add(this.add.image(0, 0, "craft_quad_drone"));
      for (let ri = 0; ri < nRotors; ri++) {
        this.remoteG.add(this.add.image(0, 0, "craft_quad_drone_rotor").setOrigin(0.5, 0.5));
      }
      this.remoteG.add(this.add.image(0, 0, "gun_minigun"));
    }
    const kids = this.remoteG.getChildren() as Phaser.GameObjects.Image[];
    for (const k of kids) {
      this.unwrapTilt(k);
      k.setVisible(false);
    }
    this.remotes.forEach((r, i) => {
      const sh = kids[i * stride]!;
      const im = kids[i * stride + 1]!;
      const gunIm = kids[i * stride + 2 + nRotors]!;
      if (!cameraPointVisible(r.z, r.y)) return;
      const key = this.textures.exists(r.spec.look)
        ? r.spec.look
        : this.textures.exists("craft_hover_tank")
          ? "craft_hover_tank"
          : "craft_quad_drone";
      const scr = worldToScreen(r.x, r.y, r.z);
      const at = { x: scr.x, y: scr.y, scale: scr.scale };
      const sc = r.spec.scale;
      let orig = lookupSpriteOrigin(key) ?? { x: 0.5, y: 0.5 };
      let rotOff = r.spec.rotOff ?? Math.PI / 2;
      if (r.spec.craftLook) {
        const hull = craftOf(r.spec.craftLook);
        rotOff = hull.rotOff ?? rotOff;
      }
      const bodyRot = projectHeading(r.angle + rotOff, r.x, r.y, r.z);
      const bodyDepth = worldDepth(r.z, ZOff.body, r.y);
      const bodyScale = sc * at.scale;
      sh.setVisible(true).setOrigin(orig.x, orig.y);
      this.applyCastShadow(sh, r.x, r.y, r.z, key, r.angle + rotOff, sc);
      if (im.texture.key !== key) im.setTexture(key);
      im.setOrigin(orig.x, orig.y);
      // Craft-backed plane remotes: same billboard bank as player craft.
      const hull = r.spec.craftLook ? craftOf(r.spec.craftLook) : undefined;
      const planeBank = !!hull && craftControlScheme(hull) === "plane" && r.roll != null;
      if (planeBank) {
        const wrap = this.ensureTiltWrap(im);
        const bankAng = (r.roll ?? 0) * 1.05;
        const wingScale = Math.max(0.24, Math.abs(Math.cos(bankAng)));
        const alongScale = 1 - Math.abs(r.pitch ?? 0) * 0.08;
        wrap
          .setVisible(true)
          .setPosition(at.x, at.y)
          .setRotation(bodyRot)
          .setScale(bodyScale * wingScale, bodyScale * alongScale)
          .setDepth(bodyDepth);
        im.setVisible(true).setPosition(0, 0).setRotation(0).setScale(1);
      } else {
        im.setVisible(true)
          .setPosition(at.x, at.y)
          .setRotation(bodyRot)
          .setScale(bodyScale)
          .setDepth(bodyDepth);
      }
      applyThermalHeat(im, this.thermalOn, 0.72);
      const bodyPose = this.remoteBodyDrawPose(im);
      const rotorParts = remoteRotorParts(r.spec);
      for (let ri = 0; ri < rotorParts.length; ri++) {
        const rotor = kids[i * stride + 2 + ri];
        const part = rotorParts[ri]!;
        if (!rotor) continue;
        const spinKey = part.spinTex;
        const useSpin = !!spinKey && this.textures.exists(spinKey);
        const rotorKey = useSpin ? spinKey! : part.tex;
        if (rotor.texture.key !== rotorKey) rotor.setTexture(rotorKey);
        const hub = spriteUvPos(bodyPose, part.mount.x, part.mount.y);
        const along = r.spec.craftLook ? craftRotorAlongScale(craftOf(r.spec.craftLook)) : 1;
        const rotorSc = craftCompositePartScale(part, rotor.width, bodyScale);
        if (along < 0.999) {
          const wrap = this.ensureTiltWrap(rotor);
          wrap
            .setVisible(true)
            .setPosition(hub.x, hub.y)
            .setRotation(bodyRot)
            .setScale(rotorSc, rotorSc * along)
            .setDepth(worldDepth(r.z, ZOff.rotor + ri * 0.001, r.y));
          rotor.setVisible(true).setPosition(0, 0).setRotation((part.spinSign ?? -1) * r.rotor).setScale(1);
        } else {
          this.unwrapTilt(rotor);
          rotor
            .setVisible(true)
            .setOrigin(part.origin.x, part.origin.y)
            .setPosition(hub.x, hub.y)
            .setRotation((part.spinSign ?? -1) * r.rotor)
            .setScale(rotorSc)
            .setDepth(worldDepth(r.z, ZOff.rotor + ri * 0.001, r.y));
        }
        applyThermalHeat(rotor, this.thermalOn, 0.48);
      }
      if (r.spec.gun && gunIm) {
        this.poseRemoteGun(r, bodyPose, key, gunIm);
        gunIm.setDepth(worldDepth(r.z, ZOff.body + 0.4, r.y));
        applyThermalHeat(gunIm, this.thermalOn, 0.55);
      }
    });
  }

  /** Screen pose for UV mounts on a remote hull (accounts for bank tilt wrap). */
  remoteBodyDrawPose(im: Phaser.GameObjects.Image): ReturnType<MissionScene["imageDrawPose"]> {
    return this.imageDrawPose(im);
  }

  teslaMuzzleOrigin(slot: number): { x: number; y: number; z: number } {
    const h = this.heli;
    const socket = h.spec.sockets[slot];
    const z = this.playerMuzzleZ(slot);
    if (socket?.class === "hardpoint") {
      const p = this.hardpointPylon(slot);
      return { x: p.x, y: p.y, z };
    }
    if (socket?.class === "fixed") {
      const authored = craftSocketPoints(h.spec, socket);
      if (authored[0]) {
        const at = this.craftBodyMountWorldPos(authored[0]);
        return { x: at.x, y: at.y, z };
      }
    }
    const gunI = this.gunVisualIndexForSlot(slot);
    const tip = this.gunTip(gunI);
    return { x: tip.x, y: tip.y, z };
  }

  teslaRangeOf(spec: PlayerWpnSpec, slot = this.heli.weapon): number {
    const sockRange = this.heli.spec.sockets[slot]?.range;
    if (sockRange != null && sockRange > 0) return sockRange;
    return spec.launch.mode === "beam" ? spec.launch.range : 155;
  }

  /** Keep a Tesla seek/head point inside the coil envelope. */
  clampTeslaReach(
    from: { x: number; y: number; z: number },
    to: { x: number; y: number; z: number },
    range: number
  ): { x: number; y: number; z: number } {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const d = Math.hypot(dx, dy, dz);
    if (d <= range || d < 1e-4) return { x: to.x, y: to.y, z: to.z };
    const k = range / d;
    return { x: from.x + dx * k, y: from.y + dy * k, z: from.z + dz * k };
  }

  /** Closest living unit to the pointer. Pass `range` to ignore anything beyond the coil envelope. */
  pickTeslaTarget(
    tip: { x: number; y: number; z?: number },
    ptr: { x: number; y: number },
    range = Infinity,
    mouseR = 210
  ): Unit | undefined {
    let best: Unit | undefined;
    let bestD = mouseR;
    const tipZ = tip.z ?? 0;
    const limited = Number.isFinite(range);
    for (const u of this.units) {
      if (u.dead) continue;
      const uz = u.z + heightOf(u.kind) * 0.45;
      if (limited && Math.hypot(u.x - tip.x, u.y - tip.y, uz - tipZ) > range) continue;
      const dPtr = Math.hypot(u.x - ptr.x, u.y - ptr.y);
      if (dPtr < bestD) {
        bestD = dPtr;
        best = u;
      }
    }
    return best;
  }

  /** Tesla coil: lock nearest-to-mouse; a pointer head races from the muzzle to the seek. */
  updateTeslaArc(
    slot: number,
    spec: PlayerWpnSpec,
    ptr: { x: number; y: number },
    spend: boolean,
    dt: number
  ): void {
    const tip = this.teslaMuzzleOrigin(slot);
    const range = this.teslaRangeOf(spec, slot);
    this.teslaAnimT += dt;
    let best: Unit | undefined;
    if (this.teslaLockId != null) {
      const held = this.unitById(this.teslaLockId);
      if (held && !held.dead) {
        const hz = held.z + heightOf(held.kind) * 0.45;
        if (Math.hypot(held.x - tip.x, held.y - tip.y, hz - tip.z) <= range) best = held;
      }
    }
    if (!best) best = this.pickTeslaTarget(tip, ptr, range);
    this.teslaLockId = best?.id;
    let seek = best
      ? { x: best.x, y: best.y, z: best.z + heightOf(best.kind) * 0.45 }
      : { x: ptr.x, y: ptr.y, z: groundZ(this.world, ptr.x, ptr.y) + 8 };
    seek = this.clampTeslaReach(tip, seek, range);
    if (!this.teslaHead) this.teslaHead = { x: tip.x, y: tip.y, z: tip.z };
    const head = this.teslaHead;
    const hdx = seek.x - head.x;
    const hdy = seek.y - head.y;
    const hdz = seek.z - head.z;
    const hDist = Math.hypot(hdx, hdy, hdz);
    const step = TESLA_HEAD_SPEED * dt;
    if (hDist <= step || hDist < 0.5) {
      head.x = seek.x;
      head.y = seek.y;
      head.z = seek.z;
    } else {
      const inv = step / hDist;
      head.x += hdx * inv;
      head.y += hdy * inv;
      head.z += hdz * inv;
    }
    const capped = this.clampTeslaReach(tip, head, range);
    head.x = capped.x;
    head.y = capped.y;
    head.z = capped.z;
    this.teslaLive = {
      ox: tip.x,
      oy: tip.y,
      oz: tip.z,
      tx: seek.x,
      ty: seek.y,
      tz: seek.z,
      hx: head.x,
      hy: head.y,
      hz: head.z,
      targetId: best?.id,
    };
    const onTarget =
      !!best && Math.hypot(head.x - seek.x, head.y - seek.y, head.z - seek.z) <= TESLA_LOCK_REACH;
    if (onTarget && best) {
      if (best.id !== this.teslaExposeId) {
        this.teslaExposeId = best.id;
        this.teslaExposeT = 0;
      }
      this.teslaExposeT += dt;
      if (spend) this.hurt(best, spec.dmg, false);
      if (launchIsArcBeam(spec.launch) && spec.payload.stun) {
        const linger = Math.min(
          TESLA_STUN_MAX,
          spec.payload.stun + this.teslaExposeT * TESLA_STUN_EXPOSE_MUL
        );
        stunUnit(best, linger);
      }
    } else {
      this.teslaExposeT = 0;
      this.teslaExposeId = undefined;
    }
    if (spend) {
      this.spawnTeslaZap(head.x, head.y, head.z, onTarget ? 1.22 : 0.78);
      if (onTarget) this.spawnTeslaZap(head.x, head.y, head.z, 1.05);
      this.emitTeslaSparks(tip.x, tip.y, tip.z, 4, 0.42);
      this.emitTeslaSparks(head.x, head.y, head.z, onTarget ? 14 : 7, onTarget ? 0.95 : 0.62);
    }
  }

  hideTeslaVisuals(): void {
    for (const im of this.teslaSegPool) im.setVisible(false);
    for (const im of this.teslaGlowPool) im.setVisible(false);
    for (const im of this.teslaHeadZapPool) im.setVisible(false);
  }

  drawTeslaArcs(): void {
    const g = this.teslaGfx;
    g.clear();
    const live = this.teslaLive;
    if (!live || this.heli.phase === "dead") {
      this.hideTeslaVisuals();
      return;
    }
    const dx = live.hx - live.ox;
    const dy = live.hy - live.oy;
    const dz = live.hz - live.oz;
    const len = Math.hypot(dx, dy, dz) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const uz = dz / len;
    let px = -uy;
    let py = ux;
    let pz = 0;
    let plen = Math.hypot(px, py, pz);
    if (plen < 1e-3) {
      px = 0;
      py = -uz;
      pz = uy;
      plen = Math.hypot(px, py, pz) || 1;
    }
    px /= plen;
    py /= plen;
    pz /= plen;
    const bx = uy * pz - uz * py;
    const by = uz * px - ux * pz;
    const bz = ux * py - uy * px;
    const sag = Math.min(22, len * 0.1);
    const radius = Math.min(11, 4.2 + len * 0.015);
    const tSec = this.teslaAnimT;
    const flicker = (this.teslaAnimT / 0.028) | 0;
    const hash = (n: number) => {
      const x = Math.sin(n * 127.1 + flicker * 311.7) * 43758.5453;
      return x - Math.floor(x);
    };
    const segs = Math.max(10, Math.min(TESLA_SEGS, Math.round(len / 18)));
    let segUsed = 0;
    for (let s = 0; s < TESLA_STREAMS; s++) {
      const phase = (s * Math.PI * 2) / TESLA_STREAMS;
      const turns = 1.12 + s * 0.16;
      const spin = tSec * (6.2 + s * 1.4);
      const pts: { x: number; y: number; z: number; wy: number; sc: number }[] = [];
      for (let i = 0; i <= segs; i++) {
        const u = i / segs;
        const env = Math.sin(u * Math.PI);
        const ang = u * turns * Math.PI * 2 + phase + spin;
        const cs = Math.cos(ang);
        const sn = Math.sin(ang);
        const hx = (px * cs + bx * sn) * radius * env;
        const hy = (py * cs + by * sn) * radius * env;
        const hz = (pz * cs + bz * sn) * radius * env;
        const wx = live.ox + dx * u + hx;
        const wy = live.oy + dy * u + hy;
        const wz = live.oz + dz * u + hz - env * sag;
        const scr = worldToScreen(wx, wy, wz);
        pts.push({ x: scr.x, y: scr.y, z: wz, wy, sc: scr.scale });
      }
      const stroke = (width: number, color: number, alpha: number) => {
        g.lineStyle(width, color, alpha);
        g.beginPath();
        g.moveTo(pts[0]!.x, pts[0]!.y);
        for (let i = 1; i < pts.length; i++) g.lineTo(pts[i]!.x, pts[i]!.y);
        g.strokePath();
      };
      stroke(3.1, 0x1a66ff, 0.12);
      stroke(1.45, 0x3ad0ff, 0.34);
      stroke(0.65, 0xe8ffff, 0.9);
      const strokeForkSeg = (x0: number, y0: number, x1: number, y1: number, w: number) => {
        if (w < 0.1) return;
        g.lineStyle(3.1 * w, 0x1a66ff, 0.1);
        g.beginPath();
        g.moveTo(x0, y0);
        g.lineTo(x1, y1);
        g.strokePath();
        g.lineStyle(1.35 * w, 0x3ad0ff, 0.3);
        g.beginPath();
        g.moveTo(x0, y0);
        g.lineTo(x1, y1);
        g.strokePath();
        g.lineStyle(0.52 * w, 0xe8ffff, 0.86);
        g.beginPath();
        g.moveTo(x0, y0);
        g.lineTo(x1, y1);
        g.strokePath();
      };
      type Twig = {
        x: number;
        y: number;
        ang: number;
        step: number;
        left: number;
        w: number;
        gen: number;
        salt: number;
      };
      const twigs: Twig[] = [];
      const roots = 2 + (hash(s * 31) > 0.42 ? 1 : 0) + (hash(s * 59) > 0.72 ? 1 : 0);
      for (let f = 0; f < roots; f++) {
        const idx = Math.max(2, Math.min(segs - 2, 2 + ((hash(s * 13 + f * 17) * (segs - 4)) | 0)));
        const p = pts[idx]!;
        const nxt = pts[idx + 1] ?? p;
        const tang = Math.atan2(nxt.y - p.y, nxt.x - p.x);
        const side = hash(s * 41 + f * 9) > 0.5 ? 1 : -1;
        const spanU = hash(s * 7 + f * 11);
        const span = spanU * spanU;
        const fat = hash(f * 5 + s) > 0.58;
        twigs.push({
          x: p.x,
          y: p.y,
          ang: tang + side * (0.35 + hash(f * 21 + s) * 1.25),
          step: 2.2 + span * 22,
          left: 2 + ((span * 18) | 0),
          w: fat ? 0.82 + hash(f * 19 + s * 3) * 0.28 : 0.14 + hash(f * 5 + s) * 0.42,
          gen: 0,
          salt: f * 47 + s * 13,
        });
      }
      for (let t = 0; t < twigs.length && t < 22; t++) {
        const tw = twigs[t]!;
        let x = tw.x;
        let y = tw.y;
        let ang = tw.ang;
        let step = tw.step;
        let w = tw.w;
        const decayW = tw.w > 0.7 ? 0.84 : 0.74;
        const decayStep = tw.left > 10 ? 0.92 : 0.86;
        for (let k = 0; k < tw.left; k++) {
          ang += (hash(tw.salt + k * 19 + flicker) - 0.5) * (0.48 + tw.gen * 0.22);
          const nx = x + Math.cos(ang) * step;
          const ny = y + Math.sin(ang) * step;
          strokeForkSeg(x, y, nx, ny, w);
          if (
            twigs.length < 22 &&
            tw.gen < 2 &&
            k >= 1 &&
            k < tw.left - 1 &&
            hash(tw.salt * 3 + k * 11 + s) > 0.5
          ) {
            const side = hash(tw.salt + k * 23) > 0.5 ? 1 : -1;
            const childSpan = hash(k * 31 + tw.salt);
            twigs.push({
              x,
              y,
              ang: ang + side * (0.45 + hash(k * 17 + tw.salt) * 1.05),
              step: step * (0.35 + childSpan * 0.85),
              left: Math.max(2, ((tw.left - k) * (0.25 + childSpan * 0.7)) | 0),
              w: w * (0.32 + hash(k + tw.salt) * 0.55),
              gen: tw.gen + 1,
              salt: tw.salt + 91 + k * 8,
            });
          }
          x = nx;
          y = ny;
          w *= decayW;
          step *= decayStep;
        }
      }
      for (let i = 1; i < pts.length; i++) {
        const im = this.teslaSegPool[segUsed++];
        if (!im) continue;
        const pa = pts[i - 1]!;
        const pb = pts[i]!;
        const sl = Math.hypot(pb.x - pa.x, pb.y - pa.y) || 1;
        const sc = (pa.sc + pb.sc) * 0.5;
        const flick = 0.5 + hash(s * 19 + i * 7) * 0.45;
        im.setTexture("fx_zap", (flicker + s * 3 + i) & 3)
          .setVisible(true)
          .setPosition((pa.x + pb.x) * 0.5, (pa.y + pb.y) * 0.5)
          .setRotation(Math.atan2(pb.y - pa.y, pb.x - pa.x))
          .setScale(
            (sl / FX_SHEET_SIZE.zap) * (0.8 + hash(i + s) * 0.28),
            teslaZapScale(0.2) * sc * (0.8 + hash(i * 5) * 0.3)
          )
          .setAlpha(0.52 * flick)
          .setDepth(worldDepth((pa.z + pb.z) * 0.5, ZOff.muzzle + 0.4, (pa.wy + pb.wy) * 0.5));
      }
    }
    for (let i = segUsed; i < this.teslaSegPool.length; i++) {
      this.teslaSegPool[i]!.setVisible(false);
    }

    const pulse = 0.9 + Math.sin(tSec * 17.5) * 0.1;
    const stampEnd = (wx: number, wy: number, wz: number, gi: number, mul: number) => {
      const scr = worldToScreen(wx, wy, wz);
      const sx = scr.x;
      const sy = scr.y;
      const sc = scr.scale * mul;
      const depth = worldDepth(wz, ZOff.muzzle + 0.55, wy);
      const layers: { im: Phaser.GameObjects.Image; scale: number; alpha: number }[] = [
        { im: this.teslaGlowPool[gi]!, scale: 1.95 * sc * pulse, alpha: 0.32 },
        { im: this.teslaGlowPool[gi + 1]!, scale: 0.72 * sc * pulse, alpha: 0.48 },
        { im: this.teslaGlowPool[gi + 2]!, scale: 1.08 * sc, alpha: 0.18 },
      ];
      for (const layer of layers) {
        layer.im
          .setVisible(true)
          .setPosition(sx, sy)
          .setRotation(0)
          .setScale(layer.scale)
          .setAlpha(layer.alpha)
          .setDepth(depth);
      }
    };
    stampEnd(live.ox, live.oy, live.oz, 0, 1.15);
    stampEnd(live.hx, live.hy, live.hz, 3, 1.55);
    for (const im of this.teslaHeadZapPool) im.setVisible(false);

    g.setDepth(
      Math.max(
        worldDepth(live.oz, ZOff.muzzle + 0.5, live.oy),
        worldDepth(live.hz, ZOff.muzzle + 0.5, live.hy)
      )
    );
  }

  emitTeslaSparks(x: number, y: number, z: number, n: number, scaleMul: number): void {
    this.emitVisualBurst(
      x,
      y,
      z,
      {
        n,
        spdMin: 980,
        spdMax: 1780,
        bx: 0,
        by: 0,
        bz: 1,
        tight: 0,
        scaleMul,
        stretchMul: 1.42,
      },
      this.teslaSparkBurst
    );
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
      this.spawnTeslaZap(
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
    this.spawnBlastRing(x, y, z, Math.max(48, blast * 0.38), {
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

  spawnTeslaZap(x: number, y: number, z: number, scaleMul = 1, lifeMul = 1): void {
    let im = this.teslaZapPool.find((spr) => !spr.visible);
    if (!im) {
      im = this.add.image(0, 0, "fx_zap", 0).setVisible(false).setBlendMode(Phaser.BlendModes.ADD);
      this.teslaZapPool.push(im);
    }
    const scr = worldToScreen(x, y, z);
    const frame = (Math.random() * 4) | 0;
    const u = Math.random();
    const size = teslaZapScale(3.4) * scaleMul * (0.16 + u * u * 0.84) * scr.scale;
    const life = (0.07 + Math.random() * 0.09) * lifeMul;
    im.setTexture("fx_zap", frame)
      .setVisible(true)
      .setPosition(scr.x, scr.y)
      .setRotation(Math.random() * Math.PI * 2)
      .setScale(size)
      .setAlpha(0.95)
      .setDepth(worldDepth(z, ZOff.muzzle, y));
    this.teslaZaps.push({ im, t: life, max: life });
  }

  tickTeslaZaps(dt: number): void {
    let w = 0;
    for (let i = 0; i < this.teslaZaps.length; i++) {
      const z = this.teslaZaps[i]!;
      z.t -= dt;
      if (z.t <= 0) {
        z.im.setVisible(false);
        continue;
      }
      z.im.setAlpha(Phaser.Math.Clamp(z.t / z.max, 0, 1));
      this.teslaZaps[w++] = z;
    }
    this.teslaZaps.length = w;
  }

  /**
   * Prefer threats by class, gun-placement heading, and proximity for automatic stations.
   * Range / proximity use `fromX/Y` (per-barrel heading-biased origin). Traverse arcs use
   * craft→target vs `heading`. `preferHeading` scores angular preference from the acquire origin.
   */
  pickAutoTarget(
    fromX: number,
    fromY: number,
    craftX: number,
    craftY: number,
    heading: number,
    maxR: number,
    traverse?: StationTraverse,
    unrestricted = false,
    preferHeading = heading
  ): Unit | undefined {
    let best: Unit | undefined;
    let bestScore = -1e9;
    for (const u of this.units) {
      if (u.dead) continue;
      const d = Math.hypot(u.x - fromX, u.y - fromY);
      if (d > maxR || d < 35) continue;
      const aimCraft = Math.atan2(u.y - craftY, u.x - craftX);
      if (traverse) {
        if (!aimInStationArc(aimCraft, heading, traverse)) continue;
      } else if (!unrestricted && Math.abs(Phaser.Math.Angle.Wrap(aimCraft - heading)) > Math.PI * 0.7) {
        continue;
      }
      const aim = Math.atan2(u.y - fromY, u.x - fromX);
      const off = Math.abs(Phaser.Math.Angle.Wrap(aim - preferHeading));
      const cls = heatClassScore(heatClassOf(u));
      const score = cls * 1e5 + u.max * 8 - off * AUTO_GUN_HEADING_WEIGHT - d * 0.35;
      if (score > bestScore) {
        bestScore = score;
        best = u;
      }
    }
    return best;
  }

  /** Gun overlay index for a loadout socket barrel, or 0 if the socket has no overlay. */
  gunVisualIndexForSlot(slot: number, barrel = 0): number {
    const slots = craftGunSocketSlots(this.heli.spec);
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
    const slots = craftGunSocketSlots(this.heli.spec);
    const slot = slots[visualIndex];
    if (slot == null) return 0;
    let barrel = 0;
    for (let i = 0; i < visualIndex; i++) {
      if (slots[i] === slot) barrel++;
    }
    return barrel;
  }

  nearestUnitInFrontArc(
    x: number,
    y: number,
    heading: number,
    maxR: number,
    traverse?: StationTraverse
  ): Unit | undefined {
    return this.pickAutoTarget(x, y, x, y, heading, maxR, traverse);
  }

  missileMuzzle(x: number, y: number, z: number, ang: number, fxScale = 1): void {
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    this.emitVisualBurst(x, y, z, {
      n: scaledProjectileFxCount(12, fxScale),
      spdMin: 35,
      spdMax: 420,
      bx: ca,
      by: sa,
      bz: 0.2,
      tight: 0.84,
      scaleMul: 0.3,
      stretchMul: 2.8,
      coneHalf: (260 * Math.PI) / 360,
    }, this.muzzleBurst);
    const h = this.heli;
    const dx = x - h.x;
    const dy = y - h.y;
    const c = Math.cos(h.angle);
    const s = Math.sin(h.angle);
    this.showMuzzle({
      life: 0.12,
      ang,
      scaleMul: 0.92 * range(0.9, 1.12),
      localX: dx * c + dy * s,
      localY: -dx * s + dy * c,
    });
  }

  /**
   * Player muzzle flash glued to the firing tip for its short life.
   * Screen-stamping alone lags behind when the craft/camera moves.
   */
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
    localX?: number;
    localY?: number;
    worldX?: number;
    worldY?: number;
    worldZ?: number;
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
    flash.localX = opt.localX;
    flash.localY = opt.localY;
    flash.worldX = opt.worldX;
    flash.worldY = opt.worldY;
    flash.worldZ = opt.worldZ;
    const muzzle = this.muzzlePool[index] ?? this.muzzle;
    muzzle.setFrame((Math.random() * FX_VARIANTS) | 0);
    this.syncMuzzleFlash(index);
  }

  /** Socket owning a live muzzle flash (above/below Z + depth). */
  muzzleFlashSlot(flash: (typeof this.muzzleFlashes)[number]): number {
    if (flash.slot != null) return flash.slot;
    if (flash.gunI != null) {
      return craftGunSocketSlots(this.heli.spec)[flash.gunI] ?? this.heli.weapon;
    }
    return this.heli.weapon;
  }

  /** World tip for a live muzzle flash slot. */
  muzzleFlashTip(flash: (typeof this.muzzleFlashes)[number]): { x: number; y: number; z: number } {
    if (flash.worldX != null && flash.worldY != null) {
      return {
        x: flash.worldX,
        y: flash.worldY,
        z: flash.worldZ ?? this.heli.z + ZOff.shot,
      };
    }
    const h = this.heli;
    const slot = this.muzzleFlashSlot(flash);
    const z = this.playerMuzzleZ(slot);
    if (flash.muzzleUv) {
      const at = this.craftBodyMountWorldPos(flash.muzzleUv);
      return { x: at.x, y: at.y, z };
    }
    if (flash.gunI != null) {
      const at = this.gunTip(flash.gunI, flash.gunMuzzleI ?? 0);
      return { x: at.x, y: at.y, z };
    }
    const lx = flash.localX ?? 0;
    const ly = flash.localY ?? 0;
    const c = Math.cos(h.angle);
    const s = Math.sin(h.angle);
    return {
      x: h.x + lx * c - ly * s,
      y: h.y + lx * s + ly * c,
      z,
    };
  }

  syncMuzzleFlash(index: number): void {
    const flash = this.muzzleFlashes[index];
    const muzzle = this.muzzlePool[index];
    const glow = this.muzzleGlowPool[index];
    if (!flash || !muzzle || flash.life <= 0) return;
    const tip = this.muzzleFlashTip(flash);
    const depthOff =
      flash.worldX != null
        ? ZOff.muzzle + 0.15
        : this.playerMuzzleDepthOff(this.muzzleFlashSlot(flash));
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

  /** Forward shift so tip-origin art’s nose clears the muzzle (not the whole streak). */
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
    // Spawn is the tip-biased SHOT_ORIGIN; only push the remaining nose past the barrel.
    // (Using ox×length parked the whole tracer ahead of long guns like Spooky.)
    const screenDistance = (1 - SHOT_ORIGIN.x) * img.width * scale * at.scale;
    const d = screenDistance / projectedUnit;
    return { x: ca * d, y: sa * d };
  }

  /** World position of the shot exhaust / tail UV (matches trail emit + TOW wire tip). */
  shotTailWorldPos(s: Shot): { x: number; y: number; z: number } {
    const look = shotLookOf(s);
    const at = worldToScreen(s.x, s.y, s.z);
    const img = this.textures.exists(look)
      ? (this.textures.get(look).getSourceImage() as { width: number; height: number })
      : { width: 48, height: 10 };
    const sc = s.scale ?? 1;
    const horiz = Math.hypot(s.vx, s.vy);
    const pitchN = Phaser.Math.Clamp(Math.abs(s.vz) / Math.max(90, Math.hypot(horiz, s.vz)), 0, 1);
    const along = 1 - pitchN * 0.52;
    const spd = Math.hypot(s.vx, s.vy, s.vz);
    const fx = spd > 1e-3 ? s.vx / spd : Math.cos(s.angle);
    const fy = spd > 1e-3 ? s.vy / spd : Math.sin(s.angle);
    const fz = spd > 1e-3 ? s.vz / spd : 0;
    const projectedX = screenVelX(fx, fy, fz, s.x, s.y, s.z);
    const projectedY = screenVelY(fy, fz, s.z, s.y);
    const projectedUnit = Math.hypot(projectedX, projectedY);
    // Edge-on / tiny projection → stay at center (avoids huge world offsets that kill the wire).
    if (projectedUnit < 1e-3) return { x: s.x, y: s.y, z: s.z };
    const screenDistance =
      (SHOT_ORIGIN.x - SHOT_TAIL.x) * img.width * sc * at.scale * along;
    const d = Math.min(screenDistance / projectedUnit, 64);
    return {
      x: s.x - fx * d,
      y: s.y - fy * d,
      z: s.z - fz * d,
    };
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
    const drawRot = this.shotDrawRotation(s, x, y, z);
    const ca = Math.cos(drawRot);
    const sa = Math.sin(drawRot);
    return {
      x: base.x + lx * ca - ly * sa,
      y: base.y + lx * sa + ly * ca,
    };
  }

  /**
   * Screen rotation for a projectile sprite.
   * Self-propelled missiles face thrust/guidance (`s.angle`); ballistic shots face travel.
   */
  shotDrawRotation(s: Shot, x = s.x, y = s.y, z = s.z): number {
    if (shotFacesHeading(s)) return projectHeading(s.angle, x, y, z);
    return Math.atan2(
      screenVelY(s.vy, s.vz, z, y),
      screenVelX(s.vx, s.vy, s.vz, x, y, z)
    );
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

  /**
   * Enemy AA height cull — follows the player's altitude so high craft
   * (Gunship / Warthog / Lightning) stay hittable. Pad clears the hull.
   */
  enemyShotCeilZ(pad = 56): number {
    return this.heli.z + Math.max(40, this.heli.height * 0.55) + pad;
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
    // lock_on missiles soft-clamp instead of hard expire (see updateShots).
    if (s.homePlayer || s.motor != null) return false;
    return s.z > this.enemyShotCeilZ();
  }

  updateShots(dt: number): void {
    const ptr = this.worldPointer();
    const seekMul = this.cloakT > 0 ? 0 : (craftOf().enemySeekerMul ?? 1);
    let w = 0;
    const shots = this.shots;
    for (let si = 0; si < shots.length; si++) {
      const s = shots[si]!;
      const beh = s.from === "player" ? s.beh : undefined;
      const st = s.from === "player" ? s.st : undefined;
      if (st) st.age = (st.age ?? 0) + dt;

      if (s.deadfall) {
        s.vx *= Math.pow(0.62, dt);
        s.vy *= Math.pow(0.62, dt);
        s.vz -= 440 * dt;
        if (s.vz < -920) s.vz = -920;
        if (s.yaw) s.angle += s.yaw * dt;
      } else {
        if (s.motor != null) {
          const was = s.motor;
          s.motor += dt;
          if (was < 0 && s.motor >= 0) this.missileIgnite(s);
        }
        const lit = s.motor == null || s.motor >= 0;
        const lofting = lit && (s.loft ?? 0) > 0;
        if (lofting) s.loft = (s.loft ?? 0) - dt;

        // --- Spec-driven player guidance / motor ---
        if (beh && st) {
          this.updatePlayerShotFlight(s, beh, st, dt, ptr);
        } else {
        // --- Legacy enemy (and any untagged) flight ---
        const lockOnHome = lit && !s.seekDisabled && s.targetId != null && !s.homePlayer;
        const stingerHome = lit && !s.seekDisabled && !!s.homePlayer;
        if (lockOnHome) {
          const cur = Math.hypot(s.vx, s.vy, s.vz);
          const burn = s.motor ?? 0;
          const cruise = s.cruise ?? 420;
          const accel = 480 + Phaser.Math.Clamp(burn, 0, 1.6) * 220;
          const spd = Math.min(cruise, cur + accel * dt);
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
            const d = steerDir(dir0.x, dir0.y, dir0.z, home.x, home.y, home.z, 7.4 * seekMul * dt);
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
          const decoy = this.closestFlare(s.x, s.y, s.z);
          const tx = decoy ? decoy.x : this.heli.x;
          const ty = decoy ? decoy.y : this.heli.y;
          const tz = decoy ? decoy.z : this.heli.z + this.heli.height * 0.45;
          const home = norm3(tx - s.x, ty - s.y, tz - s.z);
          const dir0 =
            cur < 8
              ? { x: Math.cos(s.angle), y: Math.sin(s.angle), z: 0.12 }
              : { x: s.vx, y: s.vy, z: s.vz };
          const age = Math.max(0, s.motor ?? 0);
          const steerRate = Phaser.Math.Linear(1.05, 0.35, Phaser.Math.Clamp(age / 5.5, 0, 1));
          const d = steerDir(dir0.x, dir0.y, dir0.z, home.x, home.y, home.z, steerRate * seekMul * dt);
          s.angle = Math.atan2(d.y, d.x);
          const cruise = s.cruise ?? 380;
          const burn = Math.max(0, s.motor ?? 0);
          const accel = 320 + Phaser.Math.Clamp(burn, 0, 2.2) * 180;
          const spd = Math.min(cruise, cur + accel * dt);
          s.vx = d.x * spd;
          s.vy = d.y * spd;
          s.vz = d.z * spd;
        }
        if (lit && s.povCam) {
          const tgt = this.reticleUnit() ?? this.hoverAerial();
          const want = Math.atan2(ptr.y - s.y, ptr.x - s.x);
          const da = Phaser.Math.Angle.Wrap(want - s.angle);
          s.angle += Phaser.Math.Clamp(da, -2.2 * dt, 2.2 * dt);
          const dist = Math.hypot(ptr.x - s.x, ptr.y - s.y);
          const hold = Phaser.Math.Clamp(dist / 360, 0, 1);
          const gndAim = groundZ(this.world, ptr.x, ptr.y);
          const tz = tgt
            ? tgt.z + heightOf(tgt.kind) * 0.3
            : Phaser.Math.Linear(gndAim, this.heli.z, hold);
          s.vz = (tz - s.z) * 3.2;
          s.life = Math.max(s.life, 0.6);
        }
        if (s.motor != null && s.motor < 0) {
          const drag = s.povCam || s.wire ? Math.pow(0.12, dt) : Math.pow(0.07, dt);
          s.vx *= drag;
          s.vy *= drag;
          s.vz *= Math.pow(0.22, dt);
          if (s.yaw) s.angle += s.yaw * dt;
          const spd = Math.hypot(s.vx, s.vy);
          if (spd > 6) {
            s.vx = Math.cos(s.angle) * spd;
            s.vy = Math.sin(s.angle) * spd;
          }
        } else if (lockOnHome || stingerHome) {
          /* vx/vy/vz already steered in 3D */
        } else if (s.cruise != null && s.motor != null) {
          const cur = Math.hypot(s.vx, s.vy);
          const ramp = Phaser.Math.Clamp(s.motor / 0.16, 0, 1);
          const k = ramp * ramp * (3 - 2 * ramp);
          const spd = Phaser.Math.Linear(Math.max(cur, 50), s.cruise, k);
          s.vx = Math.cos(s.angle) * spd;
          s.vy = Math.sin(s.angle) * spd;
        } else if (s.povCam) {
          const spd = 300;
          s.vx = Math.cos(s.angle) * spd;
          s.vy = Math.sin(s.angle) * spd;
        }
        }
      }

      // Plasma helix visual offset (base position restored after trail/hit tests via cx/cy).
      let helixDx = 0;
      let helixDy = 0;
      let helixDz = 0;
      if (!s.deadfall && st?.helixOff != null && st.helixFreq != null) {
        const freq = st.helixFreq;
        const phase = st.helixPhase ?? 0;
        const wave = st.age * freq + phase;
        const lat = Math.sin(wave) * st.helixOff;
        helixDz = Math.cos(wave) * st.helixOff * 0.62;
        const px = -Math.sin(s.angle);
        const py = Math.cos(s.angle);
        helixDx = px * lat;
        helixDy = py * lat;
      }

      const x0 = s.x;
      const y0 = s.y;
      const z0 = s.z;
      const g0 = groundZ(this.world, x0, y0);
      // Warp missiles move on wall-clock so they look normal while the world crawls.
      const moveDt =
        s.warpTimeScale != null && this.frameWallDt > 0 ? this.frameWallDt : dt;
      s.x += s.vx * moveDt;
      s.y += s.vy * moveDt;
      s.z += s.vz * moveDt;
      if (s.homePlayer && s.from !== "player") {
        const ceil = this.enemyShotCeilZ(96);
        if (s.z > ceil) {
          s.z = ceil;
          if (s.vz > 0) s.vz = 0;
        }
      }
      s.life -= dt;
      if (s.wire && !s.deadfall) this.simulateTowWire(s, dt);
      if (!s.deadfall && st?.helixOff != null && st.helixFreq != null) {
        // Recompute spiral tip after move so the ribbon tracks the braid.
        const wave = st.age * st.helixFreq + (st.helixPhase ?? 0);
        const lat = Math.sin(wave) * st.helixOff;
        const hz = Math.cos(wave) * st.helixOff * 0.62;
        const px = -Math.sin(s.angle);
        const py = Math.cos(s.angle);
        helixDx = px * lat;
        helixDy = py * lat;
        helixDz = hz;
        this.simulateHelixRibbon(s, dt, s.x + helixDx, s.y + helixDy, s.z + helixDz);
      } else if (s.energyTrail || s.energyTrails) {
        this.simulateEnergyTrail(s, dt);
      }

      const kickPre =
        beh?.launch.mode === "kick_motor" && s.motor != null && s.motor < 0;
      const preIgnite =
        kickPre ||
        ((s.homePlayer || s.povCam || s.wire || s.motor != null) &&
          s.from === "player" &&
          s.motor != null &&
          s.motor < 0 &&
          !beh);
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
      let hit = !s.deadfall && s.from !== "enemy" && s.life <= 0;
      const clusterOpen =
        !s.deadfall &&
        !!st &&
        !st.bomblet &&
        !st.opened &&
        payloadIsCluster(beh?.payload);
      const openAge = clusterOpen ? st!.openAge : undefined;

      if (preIgnite && a1 > 0) {
        /* skip ground collision during pre-ignition repel */
      } else if (openAge != null && (st!.age ?? 0) >= openAge && a1 > 4) {
        // Mid-air dispense at authored fraction of predicted flight time.
        hit = true;
      } else if (openAge != null && a1 <= 0) {
        // Reached ground before open age — still pop just above so bomblets can spray.
        s.z = g1 + 14;
        hit = true;
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
        !s.deadfall &&
        s.from === "enemy" &&
        this.cloakT <= 0 &&
        Math.hypot(s.x - this.heli.x, s.y - this.heli.y) < this.heli.spec.radius &&
        s.z <= this.heli.z + this.heli.height &&
        s.z >= this.heli.z &&
        this.heli.phase === "flight"
      ) {
        this.heli.damage(
          s.dmg * 0.65 * (this.reactiveArmorT > 0 ? 0.22 : 1),
          s.vx,
          s.vy
        );
        if (this.reactiveArmorT > 0) {
          this.spawnImpactFlash(
            this.heli.x,
            this.heli.y,
            this.heli.z + 8,
            0xffcc66,
            48,
            0.9,
            140
          );
        }
        hit = true;
        hitPlayer = true;
      }
      if (!s.deadfall && s.from === "player") {
        for (const u of this.units) {
          if (u.dead) continue;
          if (st?.hitIds?.includes(u.id)) continue;
          const hr = circumRadiusOf(u.kind) + 8;
          const dx = s.x + helixDx - u.x;
          const dy = s.y + helixDy - u.y;
          if (dx * dx + dy * dy > hr * hr) continue;
          if (!pointInFootprint(s.x + helixDx, s.y + helixDy, footprintInto(u, 8, 0))) continue;
          const top = u.z + heightOf(u.kind);
          const hz = s.z + helixDz;
          if (hz > top + 2) continue;
          if (hz < u.z - 2) continue;
          // Kinetic pierce: whole points only (fractional pen like 0.55 is AP feel, not a free pass).
          if (st && (st.pierce ?? 0) >= 1 && payloadIsKinetic(beh?.payload, beh?.launch)) {
            st.pierce! -= 1;
            st.hitIds = st.hitIds ?? [];
            st.hitIds.push(u.id);
            this.hurt(u, this.weaponDamageMul(s, u, s.dmg), false);
            // Through-shot still sprays blood/sparks at the contact point.
            this.explode(
              s.x + helixDx,
              s.y + helixDy,
              s.z + helixDz,
              0,
              s.dmg,
              u,
              s.vx,
              s.vy,
              s.vz,
              true,
              shotKindForExplode(s),
              projectileFxScale(s.from, s.fxInterval),
              s,
              true
            );
            continue;
          }
          hit = true;
          victim = u;
          break;
        }
        // Proximity fuse — safety net only (prefer real body impact).
        // Arms when we have already passed the lock in XY while still above the hit box,
        // or when skimming inside a very tight 3D pocket.
        if (
          !hit &&
          s.targetId != null &&
          beh?.guidance &&
          guidanceIsLockOn(beh.guidance) &&
          beh.guidance.targeting.proxFuse
        ) {
          const u = this.unitById(s.targetId);
          const fuse = beh.guidance.targeting.proxFuse;
          if (u && !u.dead) {
            const top = u.z + heightOf(u.kind);
            const aimZ = u.z + heightOf(u.kind) * 0.45;
            const toX = u.x - s.x;
            const toY = u.y - s.y;
            const hx = Math.hypot(toX, toY);
            const fuseXy = circumRadiusOf(u.kind) + fuse.xy;
            const d3 = Math.hypot(toX, toY, aimZ - s.z);
            const closing = s.vx * toX + s.vy * toY;
            const above = s.z > top + 2;
            const overshot = hx < fuseXy && closing < 0 && above;
            const skim = d3 < circumRadiusOf(u.kind) + (fuse.z ?? fuse.xy);
            if (overshot || skim) {
              hit = true;
              victim = u;
            }
          }
        }
      }
      if (hit) {
        this.releaseEnergyTrail(s);
        // Linger policy (hold lengths; cam.linger not authored yet):
        // - thermal + povCam: long + keep sensor palette
        // - wire: medium
        // - other povCam: short
        // - warp (timeScale): separate path below, hold stretched by timeScale
        const lingerThermal =
          s.from === "player" && !!beh?.cam.thermal && !!beh.cam.povCam;
        const lingerWire =
          s.from === "player" && !!beh?.guidance?.wire && !!s.wire;
        const lingerPov =
          s.from === "player" &&
          !!beh?.cam.povCam &&
          !lingerThermal &&
          !lingerWire &&
          s.warpTimeScale == null;
        if (lingerThermal || lingerWire || lingerPov) {
          let hold = lingerThermal ? 1.65 : lingerWire ? 0.95 : 0.55;
          if (s.warpTimeScale != null) {
            hold = Math.min(8, hold / Math.max(0.08, s.warpTimeScale));
          }
          this.beginImpactCamLinger(s.x, s.y, {
            thermal: lingerThermal ? this.craftSensorPalette() : undefined,
            hold,
          });
        }
        if (s.from === "player" && s.warpTimeScale != null) {
          this.warpLingerScale = s.warpTimeScale;
          // Ensure linger runs even if steer_commit / thermal / wire didn't arm the cam hold.
          if (this.povCamLookHold <= 0) {
            this.beginImpactCamLinger(s.x, s.y, {
              hold: Math.min(8, 1.65 / Math.max(0.08, s.warpTimeScale)),
            });
          }
        }
        // Cluster open at impact / airburst
        if (payloadIsCluster(beh?.payload) && st && !st.bomblet && !st.opened) {
          st.opened = true;
          const cl = beh!.payload.cluster!;
          if (cl.break === "cone_hop") {
            this.spawnStarstreakBomblets(s, cl.bomblets, cl.spread);
          } else {
            this.spawnClusterBomblets(s, cl.bomblets, cl.spread);
          }
        }
        if (payloadIsSmoke(beh?.payload)) {
          this.spawnSmokePuffs(s.x, s.y, s.z, beh!.payload.smoke!.radius, beh!.payload.smoke!.duration);
        }
        if (payloadIsCallStrike(beh?.payload) && st && !st.opened && !st.bomblet) {
          st.opened = true;
          const cs = { ...beh!.payload.callStrike! };
          let spawnFrom: { x: number; y: number; z: number } | undefined;
          let hostWeapon: string | undefined;
          if (st.callStrikeFromHost) {
            // POV remote observer — walk the host howitzer onto the mark.
            const h = this.heli;
            spawnFrom = {
              x: h.x,
              y: h.y,
              z: Math.max(h.z + 140, 420),
            };
            hostWeapon = "heavy_artillery";
          }
          this.armCallStrike(s.x, s.y, s.z, cs, spawnFrom, hostWeapon);
        }
        // Canister dispense is a light pop — bomblets carry the damage.
        // Only for mid-air `openAt` dispensers (Rockeye); impact clusters keep full pop.
        const canisterPop =
          payloadIsCluster(beh?.payload) &&
          !!st &&
          !st.bomblet &&
          beh!.payload.cluster!.openAt != null;
        this.explode(
          s.x + helixDx,
          s.y + helixDy,
          s.z + helixDz,
          canisterPop ? Math.min(16, s.blast * 0.55) : s.blast,
          canisterPop ? Math.min(6, s.dmg * 0.55) : s.dmg,
          canisterPop ? undefined : victim,
          s.vx,
          s.vy,
          s.vz,
          canisterPop ? false : !!victim || hitPlayer,
          shotKindForExplode(s),
          projectileFxScale(s.from, s.fxInterval) * (canisterPop ? 0.45 : 1),
          s
        );
        continue;
      }
      if (s.from === "enemy" && !s.deadfall && this.enemyShotExpired(s)) continue;
      // Temporarily apply helix for trail emit position
      if (helixDx || helixDy || helixDz) {
        s.x += helixDx;
        s.y += helixDy;
        s.z += helixDz;
        this.emitShotTrail(s, x0 + helixDx, y0 + helixDy, z0 + helixDz);
        s.x -= helixDx;
        s.y -= helixDy;
        s.z -= helixDz;
      } else {
        this.emitShotTrail(s, x0, y0, z0);
      }
      if (!s.deadfall && exhaustWarpMotes(s.beh?.exhaust)) {
        this.emitWarpTrailFx(s, x0, y0, z0);
      }
      if (!s.deadfall && exhaustIsSignalFlare(s.beh?.exhaust)) {
        this.emitSignalFlareTrailFx(s, x0, y0, z0);
      }
      shots[w++] = s;
    }
    shots.length = w;
    this.ageEnergyLinger(dt);
    this.tickRefractorBeams(dt);
    if (this.perfEnabled) {
      const t = performance.now();
      this.syncShotSprites();
      this.syncPhotonFlares();
      this.perfCurrent![6] = performance.now() - t;
    } else {
      this.syncShotSprites();
      this.syncPhotonFlares();
    }
  }

  /**
   * Spider drone: steer toward the mouse at low AGL; if a hostile enters
   * engage range, latch and dash onto it until contact / blast.
   */
  tickSpiderDroneShot(
    s: Shot,
    beh: NonNullable<Shot["beh"]>,
    spider: NonNullable<WeaponPayload["spider"]>,
    dt: number,
    ptr: { x: number; y: number }
  ): void {
    const flight = beh.guidance?.flight;
    const loft = flight?.loft;
    const cruiseAgl =
      loft && typeof loft.cruise === "object" && "agl" in loft.cruise ? loft.cruise.agl : 5;

    let tx = ptr.x;
    let ty = ptr.y;
    let dash = false;
    let prey: Unit | undefined;

    if (s.targetId != null) {
      prey = this.unitById(s.targetId);
      if (!prey || prey.dead) {
        s.targetId = undefined;
        prey = undefined;
      } else {
        tx = prey.x;
        ty = prey.y;
        dash = true;
      }
    }

    if (!dash) {
      let best: Unit | undefined;
      let bestD = spider.engageRange;
      for (const u of this.units) {
        if (u.dead) continue;
        const d = Math.hypot(u.x - s.x, u.y - s.y);
        if (d < bestD) {
          bestD = d;
          best = u;
        }
      }
      if (best) {
        s.targetId = best.id;
        prey = best;
        tx = best.x;
        ty = best.y;
        dash = true;
      }
    }

    const want = Math.atan2(ty - s.y, tx - s.x);
    const turnRate = dash ? 16 : (flight?.turnRate ?? 6.2);
    const maxA = dash ? Math.PI : (flight?.maxAngle ?? 1.4);
    const da = Phaser.Math.Angle.Wrap(want - s.angle);
    s.angle += Phaser.Math.Clamp(Phaser.Math.Clamp(da, -maxA, maxA), -turnRate * dt, turnRate * dt);

    const base = beh.cruiseSpeed;
    const target = dash ? base * (spider.dashMul ?? 1.5) : base;
    let spd = Math.hypot(s.vx, s.vy);
    if (dash) {
      // Ramp into the pounce — no instant speed snap.
      const accel = spider.dashAccel ?? 380;
      if (spd < target) spd = Math.min(target, Math.max(base * 0.85, spd) + accel * dt);
      else spd = target;
    } else {
      spd = target;
    }
    s.vx = Math.cos(s.angle) * spd;
    s.vy = Math.sin(s.angle) * spd;

    const gnd = groundZ(this.world, s.x, s.y);
    if (dash && prey) {
      const impactZ = prey.z + heightOf(prey.kind) * 0.35;
      s.vz = (impactZ - s.z) * 7;
    } else {
      const rest = gnd + cruiseAgl;
      s.vz += (rest - s.z) * 10 * dt;
      s.vz *= Math.pow(0.12, dt);
    }
    const floor = gnd + (loft?.clear?.coast ?? loft?.clear?.near ?? 2.5);
    if (s.z < floor) {
      s.z = floor;
      if (s.vz < 0) s.vz = 0;
    }
    s.life = Math.max(s.life, 0.35);
  }

  /** Spec-driven motor, gravity, and guidance for player shots with `beh`. */
  updatePlayerShotFlight(
    s: Shot,
    beh: NonNullable<Shot["beh"]>,
    st: ShotState,
    dt: number,
    ptr: { x: number; y: number }
  ): void {
    const lit = s.motor == null || s.motor >= 0;
    const g = beh.guidance;
    const tMode = targetingMode(g);
    const flight = g?.flight;
    const grav = launchGravity(beh.launch);

    // Gravity for drops and ballistic artillery shells
    if (grav && (beh.launch.mode === "drop" || (beh.launch.mode === "muzzle" && !!grav))) {
      s.vz += -grav.acceleration * dt;
      if (grav.terminalVelocity != null && s.vz < -grav.terminalVelocity) {
        s.vz = -grav.terminalVelocity;
      }
    }

    // Pre-ignite drag / yaw — keep enough of craft+kick speed that soft-launch still reads as a throw.
    if (s.motor != null && s.motor < 0) {
      const drag = Math.pow(tMode === "steer" ? 0.28 : 0.42, dt);
      s.vx *= drag;
      s.vy *= drag;
      s.vz *= Math.pow(0.35, dt);
      if (s.yaw) s.angle += s.yaw * dt;
      const spd = Math.hypot(s.vx, s.vy);
      if (spd > 6) {
        s.vx = Math.cos(s.angle) * spd;
        s.vy = Math.sin(s.angle) * spd;
      }
      return;
    }

    // Spider drones: mouse crawl + proximity dash onto hostiles.
    const spider = beh.payload.spider;
    if (spider && lit) {
      this.tickSpiderDroneShot(s, beh, spider, dt, ptr);
      return;
    }

    // lock_on: shared motor/rail ramp, then loft coast or 3D home.
    if (g && guidanceIsLockOn(g) && lit) {
      const targeting = g.targeting;
      const seeking = (s.loft ?? 0) <= 0;
      const cur = Math.hypot(s.vx, s.vy, s.vz);
      const spd = motorizedSpeed(s, beh, dt);
      const loftProfile = flight?.loft;
      if (seeking && s.targetId != null) {
        const u = this.unitById(s.targetId);
        const tx = u ? u.x : s.x + s.vx;
        const ty = u ? u.y : s.y + s.vy;
        const impactZ = u ? u.z + heightOf(u.kind) * 0.45 : groundZ(this.world, s.x, s.y);
        // Photon-style loft: cruise AGL + dive from flight.loft (no weapon-id branch).
        if (loftProfile && typeof loftProfile.cruise === "object" && "agl" in loftProfile.cruise) {
          const gnd = groundZ(this.world, s.x, s.y);
          const peakAgl = loftProfile.cruise.agl;
          const cruiseZ = gnd + peakAgl;
          const horiz = Math.hypot(tx - s.x, ty - s.y);
          const diveRange = loftProfile.dive.range;
          const dive = Math.pow(
            1 - Phaser.Math.Clamp(horiz / diveRange, 0, 1),
            loftProfile.dive.power
          );
          const holdZ = Math.max(s.z, cruiseZ);
          const wantZ = Phaser.Math.Linear(holdZ, impactZ, dive);
          const home = norm3(tx - s.x, ty - s.y, wantZ - s.z);
          const prox = targeting.proxTurn;
          const turnRate = prox
            ? Phaser.Math.Linear(
                prox.near,
                prox.far,
                Phaser.Math.Clamp(horiz / Math.max(40, prox.nearDist), 0, 1)
              )
            : (flight?.turnRate ?? 18);
          const turn = Phaser.Math.Linear(turnRate * 0.85, turnRate * 1.7, dive) * dt;
          flyMissile(s, home, turn, spd);
          const clearFar = loftProfile.clear?.far ?? 240;
          const clearNear = loftProfile.clear?.near ?? 22;
          const minAgl = Phaser.Math.Linear(clearFar, clearNear, dive);
          const floor = gnd + minAgl;
          if (s.z < floor) {
            s.z = floor;
            if (s.vz < 0) s.vz = Math.max(40, -s.vz * 0.25);
          }
          return;
        }
        const home = norm3(tx - s.x, ty - s.y, impactZ - s.z);
        const dist = Math.hypot(tx - s.x, ty - s.y, impactZ - s.z);
        const prox = targeting.proxTurn;
        const turnRate = prox
          ? Phaser.Math.Linear(
              prox.near,
              prox.far,
              Phaser.Math.Clamp(dist / Math.max(40, prox.nearDist), 0, 1)
            )
          : (flight?.turnRate ?? 7.4);
        flyMissile(s, home, turnRate * dt, spd);
      } else {
        s.vx = Math.cos(s.angle) * spd;
        s.vy = Math.sin(s.angle) * spd;
        if (cur > 1e-3) s.vz = (s.vz / cur) * spd;
        if (loftProfile && typeof loftProfile.cruise === "object" && "agl" in loftProfile.cruise) {
          const gnd = groundZ(this.world, s.x, s.y);
          const floor = gnd + (loftProfile.clear?.coast ?? 120);
          if (s.z < floor) {
            s.z = floor;
            if (s.vz < 80) s.vz = 120;
          }
        }
      }
      return;
    }

    // Kick motor acceleration toward cruise
    if (beh.launch.mode === "kick_motor" && lit && s.motor != null) {
      const cur = Math.hypot(s.vx, s.vy, s.vz);
      const spd = motorizedSpeed(s, beh, dt);

      if (g && tMode === "steer_commit") {
        const targeting = g.targeting;
        const steerDt =
          s.warpTimeScale != null && this.frameWallDt > 0 ? this.frameWallDt : dt;
        const breakR =
          targeting.mode === "steer_commit" ? (targeting.breakLockRadius ?? 0) : 0;
        const lockRadius =
          targeting.mode === "steer_commit" ? targeting.lockRadius : 60;
        if (!st?.terminal && breakR > 0) {
          if (s.targetId != null) {
            const u = this.unitById(s.targetId);
            if (!u || u.dead || Math.hypot(ptr.x - u.x, ptr.y - u.y) > breakR) {
              s.targetId = undefined;
            }
          } else {
            let best: Unit | undefined;
            let bd = lockRadius;
            for (const u of this.units) {
              if (u.dead) continue;
              const d = Math.hypot(u.x - ptr.x, u.y - ptr.y);
              if (d < bd) {
                bd = d;
                best = u;
              }
            }
            if (best) s.targetId = best.id;
          }
        }
        if (st?.terminal) {
          const u = s.targetId != null ? this.unitById(s.targetId) : undefined;
          const tx = u ? u.x : st.gx ?? s.x + s.vx;
          const ty = u ? u.y : st.gy ?? s.y + s.vy;
          const tz = u
            ? u.z + heightOf(u.kind) * 0.35
            : groundZ(this.world, tx, ty);
          const home = norm3(tx - s.x, ty - s.y, tz - s.z);
          const turn = (flight?.commitTurnRate ?? flight?.turnRate ?? 8) * steerDt;
          const launchAccel = beh.launch.acceleration;
          const burnT = beh.launch.burnTime;
          const burnAge = s.motor ?? 0;
          const termAccel =
            launchAccel * 1.3 + Phaser.Math.Clamp(burnAge, 0, burnT) * 0.5 * launchAccel;
          const termSpd = Math.min(beh.cruiseSpeed * 1.7, cur + termAccel * steerDt);
          flyMissile(s, home, turn, termSpd, { slowThresh: 8 });
        } else {
          const locked = s.targetId != null ? this.unitById(s.targetId) : undefined;
          const soft = !!(locked && !locked.dead);
          const aimX = soft ? locked!.x : ptr.x;
          const aimY = soft ? locked!.y : ptr.y;
          const want = Math.atan2(aimY - s.y, aimX - s.x);
          const da = Phaser.Math.Angle.Wrap(want - s.angle);
          const rate = flight?.turnRate ?? 3.4;
          const gndHere = groundZ(this.world, s.x, s.y);
          const playerAgl = Math.max(28, this.heli.z - this.heli.gndSmooth);
          const cruiseZ = gndHere + playerAgl;
          const dive = flight?.loft?.dive;
          if (soft) {
            const impactZ = locked!.z + heightOf(locked!.kind) * 0.45;
            const dist = Math.hypot(aimX - s.x, aimY - s.y);
            const diveRange = dive?.range ?? 340;
            const divePower = dive?.power ?? 2.05;
            const diveAmt = Math.pow(1 - Phaser.Math.Clamp(dist / diveRange, 0, 1), divePower);
            const dropT = Phaser.Math.Clamp(diveAmt * 1.5, 0, 1);
            const wantZ = Phaser.Math.Linear(cruiseZ + 36, impactZ, dropT);
            const turn = rate * (1.15 + diveAmt * 2.4) * steerDt;
            s.angle += Phaser.Math.Clamp(da, -turn, turn);
            s.vx = Math.cos(s.angle) * spd;
            s.vy = Math.sin(s.angle) * spd;
            s.vz = (wantZ - s.z) * (1.45 + diveAmt * 7.5);
            s.life = Math.max(s.life, 0.6);
          } else {
            s.angle += Phaser.Math.Clamp(da, -rate * steerDt, rate * steerDt);
            s.vx = Math.cos(s.angle) * spd;
            s.vy = Math.sin(s.angle) * spd;
            s.vz = (cruiseZ - s.z) * 1.55;
          }
        }
        return;
      }

      if (g && tMode === "steer") {
        const want = Math.atan2(ptr.y - s.y, ptr.x - s.x);
        const da = Phaser.Math.Angle.Wrap(want - s.angle);
        const maxA = flight?.maxAngle ?? 0.75;
        const rate = flight?.turnRate ?? 2.2;
        const clampedWant = s.angle + Phaser.Math.Clamp(da, -maxA, maxA);
        const d2 = Phaser.Math.Angle.Wrap(clampedWant - s.angle);
        s.angle += Phaser.Math.Clamp(d2, -rate * dt, rate * dt);
        const distPtr = Math.hypot(ptr.x - s.x, ptr.y - s.y);
        const gndAim = groundZ(this.world, ptr.x, ptr.y);
        const tgt = this.reticleUnit() ?? this.hoverAerial();
        const gndHere = groundZ(this.world, s.x, s.y);
        const playerAgl = Math.max(28, this.heli.z - this.heli.gndSmooth);
        const impactZ = tgt ? tgt.z + heightOf(tgt.kind) * 0.3 : gndAim;
        const groundish = !tgt || !isAerial(tgt.kind);
        const groundDive = flight?.loft?.cruise === "player_descend";
        const cruiseZ =
          groundDive && groundish
            ? gndHere +
              Phaser.Math.Clamp(32 + distPtr * 0.11, 40, Math.min(playerAgl, 150))
            : gndHere + playerAgl;
        const diveInner = flight?.loft?.dive.inner ?? 45;
        const diveRange = flight?.loft?.dive.range ?? 280;
        const divePower = flight?.loft?.dive.power ?? 2.85;
        const outside = Math.max(0, distPtr - diveInner);
        const closeness = 1 - Phaser.Math.Clamp(outside / Math.max(1, diveRange - diveInner), 0, 1);
        const dive = Math.pow(closeness, divePower);
        const tz = Phaser.Math.Linear(cruiseZ, impactZ, dive);
        const zGain = 2.2 + dive * 9.5 + (groundDive && groundish ? dive * 4.5 : 0);
        s.vz = (tz - s.z) * zGain;
        s.vx = Math.cos(s.angle) * spd;
        s.vy = Math.sin(s.angle) * spd;
        s.life = Math.max(s.life, 0.6);
        return;
      }

      if (tMode === "waypoint" && st.gx != null && st.gy != null) {
        const gndImpact = groundZ(this.world, st.gx, st.gy);
        const home = norm3(st.gx - s.x, st.gy - s.y, gndImpact - s.z);
        const turn = (flight?.turnRate ?? 1.5) * dt;
        flyMissile(s, home, turn, spd, { noseZ: -0.35, slowThresh: 8 });
        return;
      }

      s.vx = Math.cos(s.angle) * spd;
      s.vy = Math.sin(s.angle) * spd;
      return;
    }

    // Muzzle rockets with pointer (Micros / guided rockets)
    if (g && tMode === "steer" && lit) {
      const want = Math.atan2(ptr.y - s.y, ptr.x - s.x);
      const da = Phaser.Math.Angle.Wrap(want - s.angle);
      const rate = flight?.turnRate ?? 0.55;
      const maxA = flight?.maxAngle ?? 0.16;
      s.angle += Phaser.Math.Clamp(Phaser.Math.Clamp(da, -maxA, maxA), -rate * dt, rate * dt);
      const spd = Math.hypot(s.vx, s.vy) || beh.cruiseSpeed;
      s.vx = Math.cos(s.angle) * spd;
      s.vy = Math.sin(s.angle) * spd;
    }

    // Waypoint steering while falling
    if (tMode === "waypoint" && st.gx != null && st.gy != null && beh.launch.mode === "drop") {
      const want = Math.atan2(st.gy - s.y, st.gx - s.x);
      const da = Phaser.Math.Angle.Wrap(want - s.angle);
      const rate = flight?.turnRate ?? 1.5;
      s.angle += Phaser.Math.Clamp(da, -rate * dt, rate * dt);
      const horiz = Math.hypot(s.vx, s.vy);
      const spd = Math.max(horiz, 40);
      s.vx = Math.cos(s.angle) * spd;
      s.vy = Math.sin(s.angle) * spd;
    }

    // Unguided muzzle boost (Hydra / AA rail): accel toward cruise, then coast if burnTime set.
    if (
      lit &&
      !g &&
      beh.launch.mode === "muzzle" &&
      beh.launch.acceleration != null
    ) {
      const cur = Math.hypot(s.vx, s.vy, s.vz);
      const spd = motorizedSpeed(s, beh, dt);
      if (cur > 1) {
        s.vx = (s.vx / cur) * spd;
        s.vy = (s.vy / cur) * spd;
        s.vz = (s.vz / cur) * spd;
      } else {
        s.vx = Math.cos(s.angle) * spd;
        s.vy = Math.sin(s.angle) * spd;
      }
    }
  }

  /**
   * Starstreak break: prefer a ballistic hop onto a living unit inside the
   * forward launch cone; otherwise keep the old random spray.
   */
  spawnStarstreakBomblets(parent: Shot, count: number, spread: number): void {
    const beh = parent.beh;
    if (!beh || !payloadIsCluster(beh.payload)) return;
    const { bombletDmg, bombletBlast } = beh.payload.cluster!;
    const grav = 380;
    const term = 820;
    const ox = parent.x;
    const oy = parent.y;
    const oz = parent.z + 10;
    const face = parent.angle;
    const coneHalf = 1.25;
    const minRange = 14;
    const maxRange = spread * 2.45;
    const claimed = new Set<number>();

    const candidates: { u: Unit; score: number }[] = [];
    for (const u of this.units) {
      if (u.dead) continue;
      const dx = u.x - ox;
      const dy = u.y - oy;
      const d = Math.hypot(dx, dy);
      if (d < minRange || d > maxRange) continue;
      const off = Math.abs(Phaser.Math.Angle.Wrap(Math.atan2(dy, dx) - face));
      if (off > coneHalf) continue;
      candidates.push({ u, score: off * 55 + d });
    }
    candidates.sort((a, b) => a.score - b.score);

    for (let i = 0; i < count; i++) {
      let tgt: Unit | undefined;
      for (const c of candidates) {
        if (claimed.has(c.u.id)) continue;
        tgt = c.u;
        claimed.add(c.u.id);
        break;
      }
      if (!tgt && candidates.length) {
        tgt = candidates[Math.floor(Math.random() * candidates.length)]!.u;
      }

      if (tgt) {
        const jit = 12 + Math.random() * 18;
        const jang = Math.random() * Math.PI * 2;
        const ax = tgt.x + Math.cos(jang) * jit;
        const ay = tgt.y + Math.sin(jang) * jit;
        const gnd = groundZ(this.world, ax, ay);
        const arc = this.starstreakBombletArc(ox, oy, oz, ax, ay, gnd, grav, term, spread);
        if (arc) {
          const a = arc.angle;
          this.spawnShot({
            from: "player",
            wpnId: parent.wpnId,
            slot: parent.slot,
            beh: {
              ...beh,
              payload: beh.payload.cluster?.bombletDetonate
                ? { detonate: beh.payload.cluster.bombletDetonate }
                : { detonate: { look: "fire" } },
              guidance: undefined,
              exhaust: undefined,
              launch: {
                mode: "muzzle",
                inheritMomentum: 0,
                gravity: { acceleration: grav, terminalVelocity: term },
              },
            },
            st: { age: 0, launchAngle: a, bomblet: true, opened: true },
            x: ox + Math.cos(a) * 6,
            y: oy + Math.sin(a) * 6,
            z: oz,
            vx: arc.vx,
            vy: arc.vy,
            vz: arc.vz,
            angle: a,
            life: arc.life,
            blast: bombletBlast,
            dmg: bombletDmg,
            look: beh.payload.cluster!.look,
            scale: (parent.scale ?? 1) * 0.48,
            fxInterval: 0.2,
            energyTrail: [],
          });
          continue;
        }
      }

      const a = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.8;
      const spd = spread * (0.7 + Math.random() * 0.9);
      const loft = 110 + Math.random() * 90;
      this.spawnShot({
        from: "player",
        wpnId: parent.wpnId,
        slot: parent.slot,
        beh: {
          ...beh,
          payload: beh.payload.cluster?.bombletDetonate
            ? { detonate: beh.payload.cluster.bombletDetonate }
            : { detonate: { look: "energy" } },
          guidance: undefined,
          exhaust: undefined,
          launch: {
            mode: "muzzle",
            inheritMomentum: 0,
            gravity: { acceleration: grav, terminalVelocity: term },
          },
        },
        st: { age: 0, launchAngle: a, bomblet: true, opened: true },
        x: ox + Math.cos(a) * 6,
        y: oy + Math.sin(a) * 6,
        z: oz,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd,
        vz: loft,
        angle: a,
        life: 0.7 + Math.random() * 0.45,
        blast: bombletBlast,
        dmg: bombletDmg,
        look: beh.payload.cluster!.look,
        scale: (parent.scale ?? 1) * 0.48,
        fxInterval: 0.2,
        energyTrail: [],
      });
    }
  }

  /** Lofted hop that lands near `ax,ay` within spray speed budget; null if unreachable. */
  starstreakBombletArc(
    ox: number,
    oy: number,
    oz: number,
    ax: number,
    ay: number,
    gnd: number,
    grav: number,
    term: number,
    spread: number
  ): { vx: number; vy: number; vz: number; angle: number; life: number } | null {
    const dx = ax - ox;
    const dy = ay - oy;
    const dist = Math.hypot(dx, dy);
    if (dist < 8) return null;
    const loftLo = 115;
    const loftHi = 215;
    const maxSpd = spread * 1.9;
    let best: { vx: number; vy: number; vz: number; angle: number; life: number; loft: number } | null =
      null;
    for (let i = 0; i < 10; i++) {
      const loft = loftLo + ((loftHi - loftLo) * i) / 9;
      const fallT = this.estimateBombFallTime(oz, loft, gnd, grav, term);
      const vh = dist / Math.max(0.2, fallT);
      if (vh > maxSpd) continue;
      const angle = Math.atan2(dy, dx);
      const cand = {
        vx: Math.cos(angle) * vh,
        vy: Math.sin(angle) * vh,
        vz: loft,
        angle,
        life: fallT + 0.28,
        loft,
      };
      // Prefer a visible arc when several lofts reach.
      if (!best || loft > best.loft) best = cand;
    }
    return best;
  }

  spawnClusterBomblets(parent: Shot, count: number, spread: number): void {
    const beh = parent.beh;
    if (!beh) return;
    const cluster = beh.payload.cluster;
    const bombletDmg = cluster?.bombletDmg ?? parent.dmg * 0.22;
    const bombletBlast = cluster?.bombletBlast ?? parent.blast * 0.28;
    const face =
      Math.hypot(parent.vx, parent.vy) > 12
        ? Math.atan2(parent.vy, parent.vx)
        : parent.angle;
    // Keep some of the canister's motion so the carpet still drifts with the drop.
    const inherit = 0.45;
    for (let i = 0; i < count; i++) {
      // Mild heading bias — mostly random eject cone.
      const bias = (Math.random() + Math.random() - 1);
      const a = face + bias * Math.PI * 1.15;
      const eject = spread * (0.22 + Math.random() * 0.38);
      const bx = parent.x + Math.cos(a) * range(2, 10);
      const by = parent.y + Math.sin(a) * range(2, 10);
      const vx = parent.vx * inherit + Math.cos(a) * eject;
      const vy = parent.vy * inherit + Math.sin(a) * eject;
      // Randomized loft with an upward bias (arcade bloom before rain).
      const vz = parent.vz * 0.15 + range(40, 100);
      this.spawnShot({
        from: "player",
        wpnId: parent.wpnId,
        slot: parent.slot,
        beh: {
          ...beh,
          payload: { detonate: { look: "fire" } },
          guidance: undefined,
          exhaust: undefined,
        },
        st: {
          age: 0,
          launchAngle: a,
          bomblet: true,
          opened: true,
        },
        x: bx,
        y: by,
        z: parent.z + 6,
        vx,
        vy,
        vz,
        angle: Math.atan2(vy, vx),
        life: 2.0 + Math.random() * 0.85,
        blast: bombletBlast,
        dmg: bombletDmg,
        look: cluster?.look ?? parent.look,
        scale: (parent.scale ?? 1) * 0.42,
        fxInterval: 0.2,
      });
    }
  }

  missileIgnite(s: Shot): void {
    const beh = s.from === "player" ? s.beh : undefined;
    const g = beh?.guidance;
    const launch = beh?.launch;
    if (s.from === "player" && g && guidanceIsLockOn(g)) {
      const pitch =
        launch?.mode === "kick_motor" && launch.pitch != null ? launch.pitch : 0.92;
      const loftCap =
        launch?.mode === "kick_motor" ? launch.loftCap : undefined;
      const spd = Math.max(Math.hypot(s.vx, s.vy), 90);
      s.vx = Math.cos(s.angle) * spd * Math.cos(pitch);
      s.vy = Math.sin(s.angle) * spd * Math.cos(pitch);
      s.vz = spd * Math.sin(pitch);
      const seekDelay = g.targeting.seekDelay;
      s.loft = loftCap != null ? Math.min(seekDelay, loftCap) : seekDelay;
    } else if (s.from === "player" && launch?.mode === "kick_motor") {
      if (launch.softLoft != null) {
        s.vz += 180;
        s.loft = launch.softLoft;
      } else if (launch.leaveVz != null) {
        s.vz += launch.leaveVz;
      }
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
    if (s.deadfall) return;
    if (shotIsGunOrBeam(s)) return;
    const exhaust = s.beh?.exhaust;
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
    const tailUv = exhaust.emitUv ?? SHOT_TAIL;
    const tail = this.shotUvScreenPos(s, tailUv.x, tailUv.y, x, y, z);
    const tx = tail.x;
    const ty = tail.y;
    const age = s.st?.age ?? 0;
    const fireWanted =
      exhaust.fire != null && (exhaust.fireFor == null || age < exhaust.fireFor);
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
    if (this.heli.phase === "dead") return;
    let wireDepth = worldDepth(this.heli.z, ZOff.shot - 0.8, this.heli.y);
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

  /** Sagging command wire: trail points relax toward wing→missile chord (87ea78e). */
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
    const mounts = craftHardpointMounts(this.heli.spec);
    const index = mounts.length > 1 ? (side < 0 ? 0 : 1) : 0;
    const mount = mounts[index] ?? mounts[0]!;
    return { ...this.hardpointWorldPos(mount), z: this.heli.z + ZOff.shot };
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
      const u = this.unitById(s.targetId);
      if (u && !u.dead) aimAng = Math.atan2(u.y - s.y, u.x - s.x);
    }
    const px = -Math.sin(aimAng);
    const py = Math.cos(aimAng);
    const tail = this.shotTailWorldPos(s);
    const hue = exhaustHue(s.beh?.exhaust);
    for (let i = 0; i < n; i++) {
      const trail = list[i]!;
      // Spread ribbons laterally so thick→thin braid reads as three streams.
      const side = n <= 1 ? 0 : (i - (n - 1) / 2) * 7.5;
      const grow = { x: tail.x + px * side, y: tail.y + py * side, z: tail.z + (i - (n - 1) / 2) * 2.2 };
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
    if (n < 2) return Number.POSITIVE_INFINITY;
    let depth = Number.POSITIVE_INFINITY;
    let maxLife = 0;
    const raw: { x: number; y: number }[] = [];
    const ages: number[] = [];
    const hue = pts[0]?.hue ?? "cyan";
    for (let i = 0; i < n; i++) {
      const p = pts[i]!;
      const ref = p.max ?? ENERGY_TRAIL_NODE_LIFE;
      maxLife = Math.max(maxLife, p.life / ref);
      depth = Math.min(depth, worldDepth(p.z, ZOff.shot - 0.6, p.y));
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
    if (this.heli.phase === "dead") return;
    let depth = worldDepth(this.heli.z, ZOff.shot - 0.6, this.heli.y);
    for (const s of this.shots) {
      if (s.from !== "player") continue;
      const trails = s.energyTrails ?? (s.energyTrail ? [s.energyTrail] : null);
      if (!trails) continue;
      const n = trails.length;
      for (let i = 0; i < n; i++) {
        const pts = trails[i]!;
        if (pts.length < 2) continue;
        const widthMul = n <= 1 ? 1 : Phaser.Math.Linear(1.35, 0.55, i / Math.max(1, n - 1));
        depth = Math.min(depth, this.drawEnergyRibbon(g, pts, widthMul));
      }
    }
    for (const pts of this.energyLinger) {
      depth = Math.min(depth, this.drawEnergyRibbon(g, pts));
    }
    g.setDepth(depth);
  }

  tryCountermeasure(): void {
    if (this.heli.phase !== "flight" || !this.canFire || this.debugOpen || this.helpOpen || this.exitOpen) return;
    const id = this.craftCmId();
    const spec = COUNTERMEASURES[id];
    if (id === "timewarp" && this.timewarpT > 0) {
      this.cancelTimewarp();
      return;
    }
    if (id === "phase_cloak" && this.cloakT > 0) {
      this.cancelCloak();
      return;
    }
    if (this.cmCd > 0) return;
    if (id === "flares") {
      this.cmCd = spec.cooldown;
      this.fireFlares(spec.duration);
    } else if (id === "timewarp") {
      this.timewarpT = spec.duration;
      this.timewarpMax = spec.duration;
    } else if (id === "phase_cloak") {
      this.cloakT = spec.duration;
      this.breakEnemyPlayerContact();
    } else if (id === "emp") {
      this.cmCd = spec.cooldown;
      this.fireEmpCountermeasure();
    } else if (id === "reactive_armor") {
      this.cmCd = spec.cooldown;
      this.reactiveArmorT = spec.duration;
    } else if (id === "smoke_screen") {
      this.cmCd = spec.cooldown;
      this.smokeScreenT = spec.duration;
      this.fireSmokeScreen();
    }
  }

  cancelTimewarp(): void {
    if (this.timewarpT <= 0) return;
    const rem = this.timewarpT;
    const max = this.timewarpMax || COUNTERMEASURES.timewarp.duration;
    this.timewarpT = 0;
    this.beginCmCooldown(rem, max);
  }

  cancelCloak(): void {
    if (this.cloakT <= 0) return;
    const rem = this.cloakT;
    this.cloakT = 0;
    setCloakFxPipeline(this.cameras.main, false);
    this.beginCmCooldown(rem, COUNTERMEASURES.phase_cloak.duration);
  }

  /** Drop every unit's chase / mood lock so cloak is a true disappear, not "last known". */
  breakEnemyPlayerContact(): void {
    for (const u of this.units) {
      if (u.dead) continue;
      u.aware = false;
      u.aiMood = undefined;
      u.moodT = 0;
      u.aiTx = undefined;
      u.aiTy = undefined;
      if (u.aiState === "CHARGE" || u.aiState === "ORBIT" || u.aiState === "FLEE" || u.aiState === "ENGAGE") {
        u.aiState = "IDLE";
      }
      u.burstLeft = 0;
    }
  }

  /** Warp bomb / linger: edge refraction PostFX — detached when idle (no pass cost). */
  tickWarpDistortFx(): void {
    const cam = this.cameras.main;
    let on = this.warpLingerScale != null && this.povCamLookHold > 0;
    if (!on) {
      for (const s of this.shots) {
        if (s.from === "player" && s.warpTimeScale != null) {
          on = true;
          break;
        }
      }
    }
    if (!on) {
      setWarpDistortPipeline(cam, false);
      return;
    }
    setWarpDistortPipeline(cam, true, 0.92);
  }

  /** Phase cloak rim shimmer — detached when idle. */
  tickCloakFx(): void {
    const cam = this.cameras.main;
    if (this.cloakT <= 0) {
      setCloakFxPipeline(cam, false);
      return;
    }
    // Soft pulse so the effect stays readable without fighting gameplay.
    const pulse = 0.72 + 0.28 * Math.sin(this.time.now * 0.006);
    setCloakFxPipeline(cam, true, pulse);
  }

  /** Used effect time becomes cooldown (30% used → 30% of CD; ride it out → full CD). */
  beginCmCooldown(remaining: number, duration: number): void {
    const spec = COUNTERMEASURES[this.craftCmId()];
    const used = 1 - Phaser.Math.Clamp(remaining / Math.max(0.05, duration), 0, 1);
    this.cmCd = spec.cooldown * used;
  }

  tickCountermeasures(dt: number, _wallDt: number): void {
    this.cmCd = Math.max(0, this.cmCd - dt);
    if (this.cloakT > 0) {
      this.cloakT = Math.max(0, this.cloakT - dt);
      if (this.cloakT <= 0) {
        setCloakFxPipeline(this.cameras.main, false);
        this.beginCmCooldown(0, COUNTERMEASURES.phase_cloak.duration);
      }
    }
    if (this.reactiveArmorT > 0) this.reactiveArmorT = Math.max(0, this.reactiveArmorT - dt);
    if (this.smokeScreenT > 0) {
      this.smokeScreenT = Math.max(0, this.smokeScreenT - dt);
      if (this.fxChance(0.18)) this.fireSmokeScreen(1);
    }
    if (this.cmPulseT > 0) this.cmPulseT = Math.max(0, this.cmPulseT - dt);
  }

  fireSmokeScreen(bursts = 3): void {
    const h = this.heli;
    for (let i = 0; i < bursts; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = 12 + Math.random() * 48;
      this.spawnSmokePuffs(
        h.x + Math.cos(a) * d,
        h.y + Math.sin(a) * d,
        h.z - 2,
        42 + Math.random() * 28,
        7 + Math.random() * 3,
        { min: 20, max: 32 }
      );
    }
  }

  fireFlares(duration: number): void {
    const h = this.heli;
    const ca = Math.cos(h.angle);
    const sa = Math.sin(h.angle);
    const half = (40 * Math.PI) / 180;
    for (let i = 0; i < 12; i++) {
      const side = i < 6 ? -1 : 1;
      const d = coneDir(-sa * side, ca * side, -0.2, half, 3.2);
      const spd = range(150, 280);
      this.flares.push({
        x: h.x,
        y: h.y,
        z: h.z,
        vx: h.vx * 0.35 + d.x * spd,
        vy: h.vy * 0.35 + d.y * spd,
        vz: h.vz * 0.2 + d.z * spd,
        life: duration * (0.88 + Math.random() * 0.22),
        max: duration,
      });
    }
  }

  updateFlares(dt: number): void {
    let w = 0;
    for (let i = 0; i < this.flares.length; i++) {
      const f = this.flares[i]!;
      f.life -= dt;
      if (f.life <= 0) continue;
      f.vx *= Math.pow(0.55, dt);
      f.vy *= Math.pow(0.55, dt);
      f.vz *= Math.pow(0.4, dt);
      f.vz -= 18 * dt;
      const x0 = f.x;
      const y0 = f.y;
      const z0 = f.z;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.z += f.vz * dt;
      this.emitFlareTrail(f, x0, y0, z0);
      this.flares[w++] = f;
    }
    this.flares.length = w;
  }

  emitFlareTrail(f: Flare, x0: number, y0: number, z0: number): void {
    const t = range(0.2, 0.8);
    const x = x0 + (f.x - x0) * t;
    const y = y0 + (f.y - y0) * t;
    const z = z0 + (f.z - z0) * t;
    if (!cameraPointVisible(z, y)) return;
    const at = worldToScreen(x, y, z);
    const spd = Math.hypot(f.vx, f.vy, f.vz);
    const burn = 0.55 + 0.45 * Phaser.Math.Clamp(f.life / Math.max(0.2, f.max), 0, 1);
    this.withTrailFx(1, () => {
      const nTrail = this.fxEmitCount((0.7 + Math.min(1.1, spd / 240)) * burn);
      if (nTrail) {
        this.emitBudgeted("fire", this.fxAt(z, y, this.flareTrail, ZOff.fire), at.x, at.y, nTrail);
      }
      const nCore = this.fxEmitCount(0.95 * burn);
      if (nCore) {
        this.emitBudgeted("short", this.fxAt(z, y, this.flareSpark, ZOff.fire + 0.45), at.x, at.y, nCore);
      }
    });
  }

  closestFlare(x: number, y: number, z: number): Flare | undefined {
    let best: Flare | undefined;
    let bd = 1e9;
    for (const f of this.flares) {
      const d = Math.hypot(f.x - x, f.y - y, f.z - z);
      if (d < bd) {
        bd = d;
        best = f;
      }
    }
    return best;
  }

  fireEmpCountermeasure(): void {
    const h = this.heli;
    const stun = COUNTERMEASURES.emp.duration;
    const r = this.empScreenRadius();
    this.cmPulseT = stun;
    for (const u of this.units) {
      if (u.dead) continue;
      if (isOrganic(u.kind)) continue;
      if (Math.hypot(u.x - h.x, u.y - h.y) > r) continue;
      // Drones: fry electronics → freefall crash, boom on ground (not a mid-air stun).
      if (u.kind === "drone") {
        this.destroyUnit(u, true, true, false, true);
        this.emitTeslaSparks(u.x, u.y, u.z + 4, 5, 0.45);
        continue;
      }
      stunUnit(u, stun);
    }
    for (const s of this.shots) {
      if (Math.hypot(s.x - h.x, s.y - h.y) > r) continue;
      this.deadfallShot(s);
    }
    this.playEmpBurst(h.x, h.y, h.z, r);
  }

  /** World-space radius covering the current camera view (EMP stun envelope). */
  empScreenRadius(): number {
    const view = this.cameras.main.worldView;
    return Math.hypot(view.width, view.height) * 0.52;
  }

  /**
   * Spotting / chase-engage reach. Cloak zeros it; craft `enemyAwareMul` scales it.
   * Helis (not VTOL / plane) get a slight further cut when flying low AGL.
   */
  enemyAwareReach(base: number, vision = 1): number {
    if (this.cloakT > 0) return 0;
    const craft = craftOf();
    let mul = craft.enemyAwareMul ?? 1;
    if (craft.flightModel === "heli" && this.heli.phase === "flight") {
      const agl = this.heli.z - this.heli.gndSmooth;
      const cruise = craft.cruiseAgl;
      const t = Phaser.Math.Clamp((agl - LOW_AGL) / Math.max(1, cruise - LOW_AGL), 0, 1);
      // Nap-of-earth: ~18% harder to spot; fades out by cruise AGL.
      mul *= Phaser.Math.Linear(0.82, 1, t);
    }
    return base * vision * mul;
  }

  deadfallShot(s: Shot): void {
    if (s.deadfall) return;
    if (shotIsGunOrBeam(s)) return;
    s.deadfall = true;
    s.homePlayer = false;
    s.targetId = undefined;
    s.seekDisabled = true;
    s.povCam = false;
    // exhaust silenced via energy/deadfall flags
    s.energyTrail = undefined;
    s.energyTrails = undefined;
    s.wire = undefined;
    s.motor = undefined;
    s.loft = 0;
    // Pitch up for air time — dump dive, loft into a short arc before freefall.
    s.vz = Math.max(0, s.vz * 0.25) + range(140, 260);
    s.yaw = s.yaw ?? (Math.random() - 0.5) * 5.5;
    if (s.st) {
      s.st.seeking = false;
      s.st.terminal = true;
      s.st.helixOff = undefined;
    }
  }

  playEmpBurst(x: number, y: number, z: number, radius: number): void {
    this.empBurst = { x, y, z, radius };
    this.empBurstT = 0.42;
    this.empGlitchMax = 0.55;
    this.empGlitchT = this.empGlitchMax;
    this.spawnBlastRing(x, y, z, radius, {
      tint: 0x48d8ff,
      alpha: 0.78,
      duration: 320,
      expand: 3.2,
    });
    const at = worldToScreen(x, y, z);
    this.spawnImpactFlash(at.x, at.y, z, 0x88f0ff, radius * 0.62 * at.scale, 0.82, 240);
    this.emitTeslaSparks(x, y, z, 18, 1.05);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + range(-0.2, 0.2);
      const r = radius * (0.18 + Math.random() * 0.72);
      this.spawnTeslaZap(
        x + Math.cos(a) * r,
        y + Math.sin(a) * r,
        z + range(-18, 28),
        range(0.7, 1.45),
        range(1.4, 2.4)
      );
    }
    this.shake = Math.min(8, this.shake + 2.1);
    setGlitchPipeline(this.cameras.main, true, 1);
  }

  tickEmpFx(dt: number, wallDt: number): void {
    if (this.empBurstT > 0 && this.empBurst) {
      this.empBurstT = Math.max(0, this.empBurstT - dt);
      const burst = this.empBurst;
      const u = 1 - this.empBurstT / 0.42;
      const n = this.fxEmitCount(1.35);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = burst.radius * (0.22 + u * 0.85) * range(0.82, 1.08);
        this.spawnTeslaZap(
          burst.x + Math.cos(a) * r,
          burst.y + Math.sin(a) * r,
          burst.z + range(-14, 24),
          range(0.55, 1.2),
          range(1.2, 2.1)
        );
      }
      if (this.empBurstT <= 0) this.empBurst = null;
    }
    if (this.empGlitchT <= 0) {
      setGlitchPipeline(this.cameras.main, false);
      return;
    }
    this.empGlitchT = Math.max(0, this.empGlitchT - wallDt);
    const amt = Math.pow(this.empGlitchT / Math.max(0.05, this.empGlitchMax), 0.62);
    if (amt <= 0.02) setGlitchPipeline(this.cameras.main, false);
    else setGlitchPipeline(this.cameras.main, true, amt);
  }

  drawCountermeasureFx(): void {
    this.cmGfx.clear();
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
    impactFxScale: number,
    shot?: Shot,
    /** When true, only spray impact FX (pierce through already applied hurt). */
    fxOnly = false
  ): void {
    const markId = shot?.st?.callStrikeMarkId;
    if (markId != null) this.noteCallStrikeImpact(markId);
    const payload = shot?.beh?.payload;
    if (payloadIsSmoke(payload)) {
      const at = worldToScreen(x, y, z);
      this.spawnImpactFlash(at.x, at.y, z, 0xf0e0a0, 16 * at.scale, 0.35, 55);
      this.emitVisualBurst(
        x,
        y,
        z + 2,
        {
          n: 5,
          spdMin: 18,
          spdMax: 58,
          bx: dx,
          by: dy,
          bz: Math.max(10, dz),
          tight: 0.72,
          scaleMul: 0.28,
          gravity: 150,
        },
        this.shortBurst
      );
      this.shake = Math.min(3.2, this.shake + 0.45);
      if (!fxOnly) this.applyBlastDamage(x, y, z, blast, dmg, direct, dx, dy, dz, true, shot);
      return;
    }
    if (payloadIsCallStrike(payload)) {
      // Marker rest: soft pink pop only — barrage carries the damage.
      const at = worldToScreen(x, y, z);
      this.spawnImpactFlash(at.x, at.y, z, 0xff4068, 28 * at.scale, 0.72, 140);
      this.emitVisualBurst(
        x,
        y,
        z + 4,
        {
          n: 8,
          spdMin: 40,
          spdMax: 160,
          bx: 0,
          by: -0.55,
          bz: 1,
          tight: 0.4,
          scaleMul: 0.55,
          gravity: 80,
        },
        this.signalFlareSpark
      );
      this.shake = Math.min(2.8, this.shake + 0.35);
      return;
    }
    const water = isWater(this.world, x, y);
    // Kinetic / beam stay ballistic; everything else uses HE blast treatment.
    const he =
      payload != null
        ? !payloadIsKinetic(payload, shot?.beh?.launch) && (shot?.beh?.launch.mode !== "beam")
        : kind !== "cannon" && kind !== "beam";
    const heBlend = he ? 0 : payloadHeBlend(payload);
    const dustMul = payloadDustMul(payload);
    const fx = hitSimParticleFx(dmg);
    const travel = Math.hypot(dx, dy, dz) || 1;
    const simParticleBx = dx;
    const simParticleBy = dy;
    const simParticleBz = he || heBlend > 0.2 ? dz : Math.max(22, dz);
    const missileBias = he ? 2.4 : heBlend > 0 ? 1.2 + heBlend * 1.2 : undefined;
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
      const heDirt = he || heBlend > 0;
      if (heDirt) {
        const blend = he ? 1 : heBlend;
        const total = Math.min(
          110,
          Math.round(Phaser.Math.Linear(26, 62, blend) * fx.n * dustMul)
        );
        const baseSparkN = Math.max(1, Math.round(total * (he ? 0.02 : 0.035)));
        const sparkN = scaledProjectileFxCount(baseSparkN, impactFxScale);
        this.spawnDirtParticles(x, y, z + 3, {
          n: Math.max(0, total - baseSparkN),
          spdMin: Phaser.Math.Linear(50, 160, acute) * fx.spd,
          spdMax: Phaser.Math.Linear(220, 420, acute) * fx.spd,
          bx: simParticleBx,
          by: simParticleBy,
          bz: Phaser.Math.Linear(Phaser.Math.Linear(90, 22, acute), simParticleBz, blend),
          tight: Phaser.Math.Linear(Phaser.Math.Linear(0.28, 0.72, acute), 0.22, blend),
          scaleMul: fx.size * Phaser.Math.Linear(1, 1.08, blend),
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
        const total = Math.min(80, Math.round(26 * fx.n * dustMul));
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
    if (he || heBlend > 0.05) {
      const detLook = shot?.beh?.payload.detonate?.look ?? shot?.beh?.payload.cluster?.bombletDetonate?.look;
      const photonic = detLook === "photonic";
      const energyHit = detLook === "energy" || photonic;
      const bomblet = !!shot?.st?.bomblet;
      const blend = he ? 1 : heBlend;
      const dropHeBomb =
        he && !bomblet && shot?.beh?.launch.mode === "drop" && payloadIsHe(shot.beh.payload);
      const bigBoom =
        dropHeBomb || !!(he && shot?.beh?.payload.detonate?.bigBoom);
      if (photonic && !fxOnly) {
        this.emitPhotonImpactSparks(x, y, z, dx, dy, dz, blast);
      }
      this.heFireBurst(
        x,
        y,
        z,
        dx,
        dy,
        dz,
        blast,
        false,
        bigBoom ? 1.18 : photonic ? 1.55 : 1,
        Phaser.Math.Clamp((blast - 8) / 170, bomblet && !bigBoom ? 0.04 : 0.16, 1) *
          blend *
          (bigBoom ? 1.12 : photonic ? 1.45 : 1),
        1,
        0,
        undefined,
        energyHit
          ? {
              spark: this.energyStreakBurst,
              flash: photonic ? 0xe8c0ff : 0xc4ffff,
              flashMin: bomblet ? 22 : photonic ? 160 : 110,
              visMul: bomblet ? 0.32 : photonic ? 1.45 : 1,
              noFire: photonic,
              noTrails: photonic,
            }
          : he
            ? undefined
            : { visMul: 0.35 + blend * 0.45, flashMin: 28 + blend * 40 }
      );
      // Drop bombs / authored big-boom HE get the cel fireball + shockwave.
      if (bigBoom) {
        const building = !!direct && !!specOf(direct.kind).building;
        this.spawnToonBlast(x, y, z + (building ? 10 : 4), {
          building,
          size01: Phaser.Math.Clamp((blast - 36) / 320, 0.38, 1),
          waveMul: building ? 1.22 : 1.18,
        });
        if (blast >= 120) {
          const boomZ = z + (building ? 14 : 6);
          const boomSize = Phaser.Math.Clamp((blast - 80) / 280, 0.45, 1);
          this.emitBigBoomSparks(x, y, boomZ, boomSize, dx, dy, dz);
          this.emitBigBoomDebris(x, y, boomZ, boomSize, dx, dy, dz);
        }
        // Own ring sized to the weapon blast — not the victim’s body radius.
        this.spawnBlastRing(x, y, z, Math.max(48, blast * 0.32), {
          expand: 3.2,
          alpha: 0.48,
          duration: 280,
        });
      }
    }
    if (!water && !objectHit) {
      if (he) {
        const raw = (blast / 72) * range(0.55, 1.05);
        this.stampBlastCrater(x, y, raw);
        if (shotWantsEmberCrater(shot, kind)) {
          this.spawnCraterEmbers(x, y, this.softCapBlastCraterScale(raw));
        }
      } else {
        this.stampCannonScar(x, y, dx, dy, dz);
        if (heBlend > 0.25) {
          const raw = (blast / 95) * heBlend * range(0.4, 0.75);
          this.stampBlastCrater(x, y, raw, 0.55 + heBlend * 0.35);
        }
      }
    }
    if (!water) {
      this.smoke.setDepth(worldDepth(z, 0.2, y));
      this.emitBudgeted(
        "smoke",
        this.smoke,
        impactX,
        impactY + 12,
        he ? (shot?.st?.bomblet ? 4 : 16) : objectHit ? 6 : Math.round(8 * Math.max(1, dustMul * 0.85 + heBlend))
      );
    }
    this.shake = Math.min(8, this.shake + blast * (he ? 0.055 : 0.028 + heBlend * 0.02));
    if (!he) this.spawnImpactFlash(impactX, impactY, z, 0xffc878, 34 * impactScale, 0.85, 160);
    // HE already splashed — skip a second death splash. Chain gun should still run vehicle death splash.
    if (!fxOnly) this.applyBlastDamage(x, y, z, blast, dmg, direct, dx, dy, dz, he, shot);
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
    skipDeathSplash = false,
    shot?: Shot
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
        const dealt = this.weaponDamageMul(shot, u, fall);
        u.killDmg = dealt;
        this.hurt(u, dealt, skipDeathSplash);
      }
    }
    const hd = Math.hypot(this.heli.x - x, this.heli.y - y);
    const agl = castZ(this.world, this.heli.x, this.heli.y, this.heli.z);
    if (this.cloakT <= 0 && hd < blast * 0.55 && agl < 30) this.heli.damage(dmg * 0.25, dx, dy);
  }

  /** Stunned (EMP/Tesla) or fully smoke-blinded (player in thick smoke). */
  unitIsCombatDebuffed(u: Unit): boolean {
    if (unitStunned(u)) return true;
    return this.enemySmokeVision(u) <= 0;
  }

  /** Weapon-specific damage multipliers (debuff mul, class bag, …). */
  weaponDamageMul(shot: Shot | undefined, u: Unit, dmg: number): number {
    let out = dmg;
    const debuffMul = shot?.beh?.debuffDmgMul;
    if (debuffMul != null && debuffMul !== 1 && this.unitIsCombatDebuffed(u)) {
      out *= debuffMul;
    }
    const bag = shot?.beh?.dmgMul;
    if (bag) {
      const mul = bag[heatClassOf(u)];
      if (mul != null && mul !== 1) out *= mul;
    }
    return out;
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
    if (targetRadius > 0) this.spawnBlastRing(x, y, z, targetRadius);
  }

  spawnBlastRing(
    x: number,
    y: number,
    z: number,
    targetRadius: number,
    opts?: { tint?: number; alpha?: number; duration?: number; expand?: number }
  ): void {
    if (targetRadius <= 0) return;
    const at = worldToScreen(x, y, z);
    const textureRadius = 64;
    const startRadius = targetRadius * at.scale;
    const endRadius = targetRadius * (opts?.expand ?? 4) * at.scale;
    const tint = opts?.tint ?? 0xffffff;
    const alpha0 = opts?.alpha ?? 0.4;
    const duration = opts?.duration ?? 220;
    const ring = this.add
      .image(at.x, at.y, "fx_blast_ring", 0)
      .setTint(tint)
      .setScale(startRadius / textureRadius)
      .setAlpha(alpha0)
      .setDepth(worldDepth(z, ZOff.fire + 2, y))
      .setBlendMode(Phaser.BlendModes.ADD);
    const ringLife = { t: 0 };
    this.tweens.add({
      targets: ringLife,
      t: 1,
      duration,
      ease: "Linear",
      onUpdate: () => {
        const t = ringLife.t;
        const expand = t >= 1 ? 1 : (1 - Math.pow(2, -14 * t)) / (1 - Math.pow(2, -14));
        const radius = Phaser.Math.Linear(startRadius, endRadius, expand);
        ring
          .setScale(radius / textureRadius)
          .setAlpha(alpha0 * (1 - t * t))
          .setFrame(Math.min(BLAST_RING_FRAMES - 1, Math.floor(t * BLAST_RING_FRAMES)));
      },
      onComplete: () => ring.destroy(),
    });
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
      const near = Math.hypot(u.x - this.heli.x, u.y - this.heli.y);
      if (building) {
        const killPulse =
          Phaser.Math.Clamp(1.2 - near / 1100, 0.18, 0.62) * Phaser.Math.Linear(0.55, 1.15, boom);
        this.pulseTestBarrel(killPulse);
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
    this.hideAimChrome();
    const h = this.heli;
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

  /** Max AGL drones will climb/charge to — covers Lightning/Warthog, excludes Reaper (~620). */
  static readonly DRONE_KAMIKAZE_AGL = 400;

  driveDrone(u: Unit, dt: number, h: Heli, dist: number, _dx: number, _dy: number, vision = 1): void {
    if (vision > 0 && dist < this.enemyAwareReach(1400, vision) && h.phase === "flight") {
      const playerAgl = Math.max(LOW_AGL + 8, h.z - h.gndSmooth);
      const inAltReach = playerAgl <= MissionScene.DRONE_KAMIKAZE_AGL;
      // Lead the intercept — Lightning / jets outrun pure pursuit easily.
      const leadT = Phaser.Math.Clamp(dist / 420, 0.12, 0.55);
      const tx = h.x + h.vx * leadT;
      const ty = h.y + h.vy * leadT;
      const ldx = tx - u.x;
      const ldy = ty - u.y;
      const want = Math.atan2(ldy, ldx);
      const err = Math.abs(Phaser.Math.Angle.Wrap(want - u.angle));
      const turn = err > 1.0 ? 5.2 : err > 0.4 ? 3.8 : 2.8;
      u.angle = this.steerUnitAngle(u.angle, want, turn, dt);

      const facing = err < 0.16;
      if (facing && inAltReach) {
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
      } else if (facing && !inAltReach) {
        // Above drone ceiling (e.g. Reaper) — track heading but do not dive-charge.
        u.vx *= Math.pow(0.42, dt);
        u.vy *= Math.pow(0.42, dt);
        u.aiState = "HOLD";
      } else {
        // Coast: no thrust, mild drag so it overshoots then slows while turning
        u.vx *= Math.pow(0.52, dt);
        u.vy *= Math.pow(0.52, dt);
        u.aiState = "TURN";
      }
      u.aiTx = tx;
      u.aiTy = ty;
      // 3D proximity — only when altitude is within kamikaze reach.
      if (inAltReach) {
        const dist3 = Math.hypot(h.x - u.x, h.y - u.y, h.z - u.z);
        if (dist3 < this.heli.spec.radius + radius(u.kind)) {
          this.heli.damage(38, u.vx, u.vy);
          // Kamikaze: explode in place — no falling crash hull.
          this.destroyUnit(u, false, false, true);
          return;
        }
      }
    } else {
      u.vx *= Math.pow(0.38, dt);
      u.vy *= Math.pow(0.38, dt);
    }
    u.x += u.vx * dt;
    u.y += u.vy * dt;
  }

  driveScoutHeli(u: Unit, dt: number, h: Heli, dist: number, dx: number, dy: number, vision = 1): void {
    u.moodT = (u.moodT ?? 0) - dt;
    if ((u.moodT ?? 0) <= 0 && u.aiMood === "flee") u.aiMood = undefined;
    const flee = u.aiMood === "flee";
    const kite = u.aiMood === "kite";
    const toAng = Math.atan2(dy, dx);
    const side = (u.id & 1) === 0 ? 1 : -1;
    const prefDist = 380;

    if (vision > 0 && dist < this.enemyAwareReach(1600, vision) && h.phase === "flight") {
      const fwdX = dx / (dist || 1);
      const fwdY = dy / (dist || 1);
      const latX = -fwdY * side;
      const latY = fwdX * side;
      const fx = Math.cos(u.angle);
      const fy = Math.sin(u.angle);

      if (flee) {
        const awayAng = Math.atan2(-dy, -dx);
        u.angle = this.steerUnitAngle(u.angle, awayAng, 2.8, dt);
        const face = Math.max(0, Math.cos(Phaser.Math.Angle.Wrap(awayAng - u.angle)));
        u.vx += fx * 170 * face * dt;
        u.vy += fy * 170 * face * dt;
      } else if (kite && dist < 900) {
        u.angle = this.steerUnitAngle(u.angle, toAng, 3.4, dt);
        const face = Math.max(0, Math.cos(Phaser.Math.Angle.Wrap(toAng - u.angle)));
        const radial = Phaser.Math.Clamp((dist - prefDist) * 0.4, -100, 100);
        // Main thrust along nose; light strafe only once roughly facing.
        u.vx += (fx * radial + latX * 130 * face) * face * dt;
        u.vy += (fy * radial + latY * 130 * face) * face * dt;
      } else {
        u.angle = this.steerUnitAngle(u.angle, toAng, 2.8, dt);
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

  driveOrbitHeli(u: Unit, dt: number, h: Heli, dist: number, dx: number, dy: number, vision = 1): void {
    // Always-orbit heavies omit combatMood; gunships cycle through combatMood.
    const heavy = !specOf(u.kind).combatMood;
    if (heavy) {
      // Heavy: always orbit and shoot, no kiting
      if (vision > 0 && dist < this.enemyAwareReach(1500, vision) && h.phase === "flight") {
        u.orbit += 0.2 * dt;
        const ring = 430;
        const ox = h.x + Math.cos(u.orbit) * ring;
        const oy = h.y + Math.sin(u.orbit) * ring;
        const to = Math.atan2(oy - u.y, ox - u.x);
        u.angle = this.steerUnitAngle(u.angle, to, 1.15, dt);
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

      if (vision > 0 && dist < this.enemyAwareReach(1500, vision) && h.phase === "flight") {
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
          u.angle = this.steerUnitAngle(u.angle, to, 1.6, dt);
          u.vx += fx * 78 * dt;
          u.vy += fy * 78 * dt;
        } else if (kite && dist < 700) {
          u.angle = this.steerUnitAngle(u.angle, toAng, 1.85, dt);
          const face = Math.max(0, Math.cos(Phaser.Math.Angle.Wrap(toAng - u.angle)));
          const radial = Phaser.Math.Clamp((dist - closeDist) * 0.3, -65, 65);
          u.vx += (fx * radial + latX * 72 * face) * face * dt;
          u.vy += (fy * radial + latY * 72 * face) * face * dt;
        } else {
          u.angle = this.steerUnitAngle(u.angle, toAng, 1.6, dt);
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
      if (osp.aerial || osp.water || osp.behavior === "patrol_boat") continue;
      // Buildings, statics, ground vehicles, and infantry all block.
      const solid =
        !!osp.building ||
        osp.behavior === "static_hold" ||
        isGroundVehicle(o.kind) ||
        osp.behavior === "attack_infantry" ||
        osp.behavior === "flee_infantry";
      if (!solid) continue;
      const pad = osp.building || osp.behavior === "static_hold" ? 40 : 28;
      const maxR = uR + circumRadiusOf(o.kind) + pad + 2;
      const dx = u.x - o.x;
      const dy = u.y - o.y;
      if (dx * dx + dy * dy > maxR * maxR) continue;
      const ov = footprintOverlap(uFp, footprintInto(o, pad, 1));
      if (!ov.hit || ov.depth <= 0) continue;
      const strength = osp.building || osp.behavior === "static_hold" ? 3.2 : 2.4;
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
      if (!(osp.building || osp.behavior === "static_hold" || isGroundVehicle(o.kind))) continue;
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

  /** True when this hull is pressed into another solid — unlocks wheeled pivot. */
  groundUnitBlocked(u: Unit): boolean {
    const uR = circumRadiusOf(u.kind);
    for (const o of this.units) {
      if (o.dead || o.id === u.id || o.pinId != null) continue;
      const osp = specOf(o.kind);
      if (osp.aerial || osp.water || osp.behavior === "patrol_boat") continue;
      if (
        !(
          osp.building ||
          osp.behavior === "static_hold" ||
          isGroundVehicle(o.kind) ||
          osp.behavior === "attack_infantry" ||
          osp.behavior === "flee_infantry"
        )
      )
        continue;
      // Buildings / statics: easier jam. Soft infantry brush needs a deeper press.
      const solid = osp.building || osp.behavior === "static_hold" || isGroundVehicle(o.kind);
      const pad = osp.building || osp.behavior === "static_hold" ? 10 : 6;
      const maxR = uR + circumRadiusOf(o.kind) + pad + 2;
      const dx = u.x - o.x;
      const dy = u.y - o.y;
      if (dx * dx + dy * dy > maxR * maxR) continue;
      const ov = footprintOverlap(footprintInto(u, 0, 0), footprintInto(o, pad, 1));
      const need = solid ? 2.5 : 5;
      if (ov.hit && ov.depth > need) return true;
    }
    return false;
  }

  /** Soft depenetration vs buildings / other ground units after a move. */
  separateGround(u: Unit): void {
    const uR = circumRadiusOf(u.kind);
    for (const o of this.units) {
      if (o.dead || o.id === u.id || o.pinId != null) continue;
      const osp = specOf(o.kind);
      if (osp.aerial || osp.water || osp.behavior === "patrol_boat") continue;
      if (!(osp.building || osp.behavior === "static_hold" || isGroundVehicle(o.kind) || osp.behavior === "attack_infantry" || osp.behavior === "flee_infantry"))
        continue;
      const pad = osp.building || osp.behavior === "static_hold" ? 8 : 4;
      const maxR = uR + circumRadiusOf(o.kind) + pad + 2;
      const dx = u.x - o.x;
      const dy = u.y - o.y;
      if (dx * dx + dy * dy > maxR * maxR) continue;
      const ov = footprintOverlap(footprintInto(u, 0, 0), footprintInto(o, pad, 1));
      if (!ov.hit || ov.depth <= 0) continue;
      const push = ov.depth * (osp.building || osp.behavior === "static_hold" ? 0.85 : 0.45);
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

  /** Kill outbound velocity and clamp; aircraft may leave then forced-turn inland. */
  containOnMap(u: Unit, dt: number): void {
    const sp = specOf(u.kind);
    if (sp.building || sp.behavior === "static_hold") return;
    const lo = MAP_EDGE_PAD;
    const hi = WORLD - MAP_EDGE_PAD;
    const m = MAP_EDGE_MARGIN;
    const aircraft = !!sp.aerial;
    const boatish = !!(sp.water || sp.behavior === "patrol_boat");
    if (u.x < lo + m && u.vx < 0) u.vx *= Phaser.Math.Clamp((u.x - lo) / m, 0, 1);
    if (u.x > hi - m && u.vx > 0) u.vx *= Phaser.Math.Clamp((hi - u.x) / m, 0, 1);
    if (u.y < lo + m && u.vy < 0) u.vy *= Phaser.Math.Clamp((u.y - lo) / m, 0, 1);
    if (u.y > hi - m && u.vy > 0) u.vy *= Phaser.Math.Clamp((hi - u.y) / m, 0, 1);

    const outsidePlayable =
      aircraft && (u.x < 0 || u.x > WORLD || u.y < 0 || u.y > WORLD);
    const edge = this.mapEdgeInland(u.x, u.y);
    const turnW = outsidePlayable ? 1 : edge.w;
    if (turnW > 0.02) {
      const t = turnW;
      const inlandX = outsidePlayable ? WORLD * 0.5 - u.x : edge.x;
      const inlandY = outsidePlayable ? WORLD * 0.5 - u.y : edge.y;
      const len = Math.max(1e-3, Math.hypot(inlandX, inlandY));
      const nx = inlandX / len;
      const ny = inlandY / len;
      if (aircraft || boatish) {
        const thrust = (aircraft ? 160 : 70) * t * t;
        u.vx += nx * thrust * dt;
        u.vy += ny * thrust * dt;
        const out = u.vx * -nx + u.vy * -ny;
        if (out > 0) {
          u.vx += nx * out * Math.min(1, t * 1.4);
          u.vy += ny * out * Math.min(1, t * 1.4);
        }
        if (t > 0.25 || outsidePlayable) {
          u.angle = this.steerUnitAngle(
            u.angle,
            Math.atan2(ny, nx),
            (outsidePlayable ? 3.6 : 2.8) * Math.max(t, outsidePlayable ? 1 : 0),
            dt
          );
        }
      } else if (isGroundVehicle(u.kind) || sp.behavior === "attack_infantry" || sp.behavior === "flee_infantry") {
        const ground = isGroundVehicle(u.kind);
        const wheeled = ground && driveOf(u.kind).track !== "tread";
        const spd = Math.hypot(u.vx, u.vy);
        const minTurnSpd = sp.minTurnSpd ?? 14;
        // Wheeled: only yaw at the rim while moving, or when deeply stuck (hard rim).
        if (t > 0.28 && (!wheeled || spd > minTurnSpd || t > 0.55)) {
          u.angle = this.steerUnitAngle(u.angle, Math.atan2(ny, nx), 2.4 * t, dt);
        }
        if (t > 0.4 && spd < 18) {
          u.vx += nx * 55 * t * dt;
          u.vy += ny * 55 * t * dt;
        }
      }
    }
    if (aircraft) {
      u.x = Phaser.Math.Clamp(u.x, -MAP_AIR_SOFT, WORLD + MAP_AIR_SOFT);
      u.y = Phaser.Math.Clamp(u.y, -MAP_AIR_SOFT, WORLD + MAP_AIR_SOFT);
    } else {
      u.x = Phaser.Math.Clamp(u.x, lo, hi);
      u.y = Phaser.Math.Clamp(u.y, lo, hi);
    }
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
    const sp = specOf(u.kind);
    const yaw = sp.boatYaw ?? 0.85;
    const spd = sp.boatSpeed ?? 22;
    if (!isWater(this.world, u.x, u.y)) {
      const seek = this.terrainSteer(u.x, u.y, u.x + Math.cos(u.angle) * 80, u.y + Math.sin(u.angle) * 80, true, u.angle);
      const want = Math.atan2(seek.y - u.y, seek.x - u.x);
      u.angle = this.steerUnitAngle(u.angle, want, yaw * 1.4, dt);
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
    u.angle = this.steerUnitAngle(u.angle, want, yaw, dt);
    const step = spd * dt;
    this.stepOnTerrain(u, Math.cos(u.angle) * step, Math.sin(u.angle) * step, true);
    u.vx = Math.cos(u.angle) * spd;
    u.vy = Math.sin(u.angle) * spd;
    u.aiState = "PATROL";
  }

  driveGroundVehicle(u: Unit, dt: number, h: Heli, dist: number, vision = 1): void {
    const d = driveOf(u.kind);
    const sp = specOf(u.kind);
    const combat = sp.behavior === "orbit_attack_vehicle";
    let drive = false;
    let wantX = u.x;
    let wantY = u.y;
    if (combat) {
      if (vision > 0 && dist < this.enemyAwareReach(980, vision) && h.phase === "flight") {
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
    } else if (
      dist < this.enemyAwareReach(sp.fleeAwareRange ?? 520, vision) &&
      h.phase === "flight"
    ) {
      if (vision > 0) {
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
    // Wheeled: need forward speed to yaw (car-like). Default higher than old 7 so
    // trucks don't spin on a crawl. Motorcycle sets minTurnSpd explicitly.
    const minTurnSpd = sp.minTurnSpd ?? 14;
    const rim = this.mapEdgeWeight(u.x, u.y);
    const jammed = this.groundUnitBlocked(u);
    // Pivot only when actually wedged — soft rim alone must not unlock zero-point turn.
    const stuck = jammed || rim > 0.55;
    const turnDt = Math.min(dt, 1 / 20);
    if (drive) {
      if (!wheeled) {
        // Treads: pivot OK; slightly snappier when slow.
        u.angle = this.steerUnitAngle(
          u.angle,
          want,
          d.turn * (0.45 + 0.55 * slow),
          turnDt
        );
      } else if (stuck) {
        // Unwedge: allow in-place yaw so they can face out of a jam / hard rim.
        u.angle = this.steerUnitAngle(u.angle, want, d.turn, turnDt);
      } else if (spd > minTurnSpd) {
        // Turning radius feel: yaw rate scales with speed (ω ∝ v), never while stopped.
        const turnGate = Phaser.Math.Clamp(spd / Math.max(d.maxSpd * 0.55, minTurnSpd + 10), 0, 1);
        u.angle = this.steerUnitAngle(u.angle, want, d.turn * turnGate, turnDt);
      }
    }
    if (stuck && spd < 18) {
      u.vx += Math.cos(want) * 50 * dt;
      u.vy += Math.sin(want) * 50 * dt;
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
        const key = `fx_track_${d.track}`;
        const back = specOf(u.kind).radius * 0.72;
        this.stampWreck(
          this.textures.exists(key) ? key : "fx_track_mono",
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

  /**
   * No AI: no drive, turn, turret track, or fire. Existing velocity / spin coasts with friction.
   */
  tickStunnedUnit(u: Unit, dt: number): void {
    tickStunKinematics(u, dt);
    u.fireCd -= dt;
    u.muzzleT = Math.max(0, u.muzzleT - dt);
    const sp = specOf(u.kind);
    if (sp.dish) u.rotor += 0.55 * dt;
    if (sp.rotors.length) u.rotor += (sp.rotorSpinRate ?? 28) * dt;
    if (sp.organic && u.health < u.max) {
      const rate = u.health <= 1 ? 0.028 : 0.05;
      u.health -= u.max * rate * dt;
      if (u.health <= 0) {
        this.destroyUnit(u, true);
        return;
      }
    }
    if ((sp.behavior === "orbit_attack_heli" || sp.behavior === "kite_attack_heli") || sp.behavior === "suicide_attack_heli") {
      u.x += u.vx * dt;
      u.y += u.vy * dt;
    } else if (sp.behavior === "patrol_boat") {
      this.stepOnTerrain(u, u.vx * dt, u.vy * dt, true);
      u.z = isWater(this.world, u.x, u.y) ? waterSurfaceZ() : groundZ(this.world, u.x, u.y);
    } else if (isGroundVehicle(u.kind) || sp.behavior === "attack_infantry" || sp.behavior === "flee_infantry") {
      this.stepOnTerrain(u, u.vx * dt, u.vy * dt, false);
      this.separateGround(u);
      u.z = isWater(this.world, u.x, u.y) ? waterSurfaceZ() : groundZ(this.world, u.x, u.y);
    }
    this.containOnMap(u, dt);
    this.tickStunZapFx(u, dt);
    u.aiState = "STUN";
  }

  /** Periodic zap stamps on a stunned hull — same overlay language as Tesla / EMP. */
  tickStunZapFx(u: Unit, dt: number): void {
    if (!cameraPointVisible(u.z, u.y)) return;
    if (u.stunZapT == null) u.stunZapT = (u.id % 11) * 0.028;
    u.stunZapT -= dt;
    if (u.stunZapT > 0) return;
    u.stunZapT = 0.11 + Math.random() * 0.2;
    this.spawnStunZaps(u);
  }

  spawnStunZaps(u: Unit): void {
    const r = radius(u.kind);
    const hgt = heightOf(u.kind);
    const sc = Phaser.Math.Clamp(r / 26, 0.42, 1.35);
    const n = Math.random() < 0.38 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.sqrt(Math.random()) * r * 0.78;
      this.spawnTeslaZap(
        u.x + Math.cos(a) * d,
        u.y + Math.sin(a) * d,
        u.z + hgt * (0.12 + Math.random() * 0.8),
        sc * range(0.48, 1.02),
        range(1.3, 2.2)
      );
    }
    if (Math.random() < 0.3) {
      this.emitTeslaSparks(u.x, u.y, u.z + hgt * 0.45, 3, 0.26 * sc);
    }
  }

  updateUnits(dt: number): void {
    const h = this.heli;
    const aimMul = craftOf().enemyAimMul ?? 1;
    for (const u of this.units) {
      if (u.dead) continue;
      const prevAngle = u.angle;
      const prevTurret = u.turret;
      const prevTurrets = u.turrets.slice();
      if (unitStunned(u)) {
        this.tickStunnedUnit(u, dt);
        if (!u.dead) recordUnitSpin(u, prevAngle, prevTurret, prevTurrets, dt);
        continue;
      }
      u.fireCd -= dt;
      const dx = h.x - u.x;
      const dy = h.y - u.y;
      const dist = Math.hypot(dx, dy);
      // Cloak: complete sensor blackout. Smoke: blinds all enemies when the player is covered.
      const vision = this.cloakT > 0 ? 0 : this.enemySmokeVision(u);
      if (this.cloakT > 0 && (u.aware || u.aiMood || u.aiTx != null)) {
        u.aware = false;
        u.aiMood = undefined;
        u.moodT = 0;
        u.aiTx = undefined;
        u.aiTy = undefined;
        u.burstLeft = 0;
      }
      const sp = specOf(u.kind);
      u.muzzleT = Math.max(0, u.muzzleT - dt);
      if (sp.dish) u.rotor += 0.55 * dt;
      if (sp.rotors.length) u.rotor += (sp.rotorSpinRate ?? 28) * dt;
      if (
        sp.behavior === "orbit_attack_heli" ||
        sp.behavior === "kite_attack_heli" ||
        sp.behavior === "suicide_attack_heli"
      ) {
        if (sp.behavior === "suicide_attack_heli") this.driveDrone(u, dt, h, dist, dx, dy, vision);
        else if (sp.behavior === "kite_attack_heli") this.driveScoutHeli(u, dt, h, dist, dx, dy, vision);
        else this.driveOrbitHeli(u, dt, h, dist, dx, dy, vision);
        if (u.dead) continue;
        const g = groundZ(this.world, u.x, u.y);
        if ((sp.behavior === "orbit_attack_heli" || sp.behavior === "kite_attack_heli")) {
          // Slow climb/descend toward the player's AGL (terrain-relative).
          const playerAgl = Math.max(LOW_AGL + 8, h.z - h.gndSmooth);
          const bob = Math.sin(this.time.now * 0.002 + u.id) * 4;
          const wantZ = g + playerAgl + bob;
          const err = wantZ - u.z;
          const thrust = Phaser.Math.Clamp(err * 0.9, -38, 38);
          u.vz = (u.vz ?? 0) + thrust * dt;
          u.vz *= Math.pow(0.32, dt);
          u.vz = Phaser.Math.Clamp(u.vz, -52, 52);
          u.z += u.vz * dt;
          const minZ = g + LOW_AGL + 6;
          const maxZ = g + Math.max(MAX_AGL, playerAgl + 24);
          if (u.z < minZ) {
            u.z = minZ;
            if (u.vz < 0) u.vz *= 0.15;
          } else if (u.z > maxZ) {
            u.z = maxZ;
            if (u.vz > 0) u.vz *= 0.15;
          }
        } else if (sp.behavior === "suicide_attack_heli") {
          // Climb toward player only when within kamikaze AGL; otherwise loiter at cruise.
          const playerAgl = Math.max(LOW_AGL + 8, h.z - h.gndSmooth);
          const kamikazeCeil = MissionScene.DRONE_KAMIKAZE_AGL;
          const bob = Math.sin(this.time.now * 0.002 + u.id) * 5;
          if (playerAgl > kamikazeCeil) {
            const cruise = g + CRUISE_AGL + 10 + bob;
            u.z = Phaser.Math.Linear(u.z, cruise, 1 - Math.pow(0.12, dt));
            u.vz = (u.vz ?? 0) * Math.pow(0.25, dt);
          } else {
            const wantZ = g + playerAgl + bob;
            const charging = u.aiState === "CHARGE";
            const closeXy = dist < 220;
            const climbMul = charging ? (closeXy ? 2.4 : 1.55) : 0.95;
            const err = wantZ - u.z;
            const thrust = Phaser.Math.Clamp(
              err * climbMul,
              charging ? -90 : -42,
              charging ? 110 : 48
            );
            u.vz = (u.vz ?? 0) + thrust * dt;
            u.vz *= Math.pow(charging ? 0.28 : 0.35, dt);
            u.vz = Phaser.Math.Clamp(u.vz, charging ? -95 : -55, charging ? 120 : 58);
            u.z += u.vz * dt;
            const minZ = g + LOW_AGL + 6;
            const maxZ = g + kamikazeCeil + 16;
            if (u.z < minZ) {
              u.z = minZ;
              if (u.vz < 0) u.vz *= 0.15;
            } else if (u.z > maxZ) {
              u.z = maxZ;
              if (u.vz > 0) u.vz *= 0.15;
            }
          }
        } else {
          const cruise = g + CRUISE_AGL + 10 + Math.sin(this.time.now * 0.002 + u.id) * 6;
          u.z = Phaser.Math.Linear(u.z, cruise, 1 - Math.pow(0.1, dt));
        }
      } else {
        if (sp.behavior === "patrol_boat") this.driveBoat(u, dt);
        if (isGroundVehicle(u.kind)) {
          this.driveGroundVehicle(u, dt, h, dist, vision);
        }
        if ((sp.behavior === "attack_infantry" || sp.behavior === "flee_infantry") && !this.snapHost(u)) {
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
          const seeR = this.enemyAwareReach(400, vision);
          const screenR = this.scale.width / Math.max(this.cameras.main.zoom, 0.001);
          const wounded = u.health < u.max;
          const downed = sp.organic && wounded && u.health <= 1;
          if (downed) u.aiMood = undefined;
          else if (wounded && u.aiMood !== "flee") this.rollSoldierMood(u, true);
          else if (sp.behavior === "flee_infantry" && !u.aware && dist < seeR && h.phase === "flight") {
            if (vision > 0) {
              u.aware = true;
              u.aiMood = "flee";
              u.moodT = 4;
            }
          }
          if (!u.aware && dist < seeR && dist > 36 && h.phase === "flight") {
            if (vision > 0) {
              u.aware = true;
              this.rollSoldierMood(u, wounded || !canShoot || Math.random() < 0.4);
            }
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
            u.vx = 0;
            u.vy = 0;
            if (vision > 0) {
              u.turret = this.steerUnitAngle(u.turret, Math.atan2(dy, dx), 1.8 * aimMul, dt);
              u.aiTx = h.x;
              u.aiTy = h.y;
            } else {
              u.aiTx = undefined;
              u.aiTy = undefined;
            }
            u.aiState = (u.burstLeft ?? 0) > 0 ? "BURST" : "DOWN";
            if (u.track < -8) u.track = 0;
            u.track += dt;
            if (u.track > 0) {
              this.stampSoldierBlood(u, range(-4.5, 4.5), range(-4.5, 4.5), range(0, Math.PI * 2));
              u.track = -range(1.5, 3.4);
            }
          } else if ((fleeing || kiting) && vision > 0) {
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
            u.angle = this.steerUnitAngle(
              u.angle,
              want,
              fleeing ? 2.4 : 2.1,
              dt
            );
            const limp = fleeing && wounded && sp.organic;
            const gaitHz = limp ? 0.0044 : fleeing ? 0.0128 : 0.0075;
            const walk = Math.sin(this.time.now * gaitHz + u.id * 2.1);
            const gait = 0.22 + 0.78 * Math.pow(0.5 + 0.5 * walk, 1.45);
            const base =
              sp.behavior === "flee_infantry" && !sp.organic
                ? (sp.fleeRunSpeed ?? 90)
                : fleeing
                  ? 78
                  : 58;
            const align = Math.max(0.15, Math.cos(Phaser.Math.Angle.Wrap(want - u.angle)));
            const step = (limp ? 22 : base) * gait * align * dt;
            u.vx = Math.cos(u.angle) * (step / Math.max(dt, 1e-6));
            u.vy = Math.sin(u.angle) * (step / Math.max(dt, 1e-6));
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
            u.vx = 0;
            u.vy = 0;
            u.aiState = (u.burstLeft ?? 0) > 0 ? "BURST" : "IDLE";
            u.aiTx = undefined;
            u.aiTy = undefined;
          }
        }
        this.leashPinned(u);
        if (sp.behavior === "patrol_boat" && isWater(this.world, u.x, u.y)) {
          u.z = waterSurfaceZ();
        } else {
          u.z = groundZ(this.world, u.x, u.y);
        }
      }
      this.containOnMap(u, dt);
      const guns = gunsOf(u);
      const aim = Math.atan2(dy, dx);
      const gunI = guns.length ? u.muzzleGun % guns.length : 0;
      const wpn = guns[gunI]?.weapon ?? sp.weapon;
      const atkRange = (wpn?.range ?? 0) * vision;
      const elev = h.z - u.z;
      // Elevation lob limit: troops stay low; tanks can reach jet cruise; dedicated
      // AA / seekers go higher. Reaper-class cruise (~620) sits above tank/building HE;
      // enemy drones stay low and cannot lob/kamikaze to it — helis can climb.
      const aaWpn = /aa|seeker|aam/i.test(wpn?.look ?? "");
      const elevCeil = sp.aerial
        ? u.kind === "drone"
          ? MissionScene.DRONE_KAMIKAZE_AGL
          : 1e9
        : aaWpn
          ? 720
          : sp.building
            ? 560
            : isGroundVehicle(u.kind)
              ? 360
              : 130;
      const inRange = !!(
        atkRange &&
        dist < atkRange &&
        dist > 40 &&
        h.phase === "flight" &&
        elev < elevCeil
      );
      if (guns.length && vision > 0) {
        const trackR = ((guns[0]?.weapon ?? sp.weapon)?.range ?? 0) * vision;
        if (dist < trackR * 1.15) {
          const trackRate = 1.65 * aimMul * Math.max(0.12, vision);
          for (let gi = 0; gi < guns.length; gi++) {
            const gp = this.gunMountPos(u, gi);
            const want = Math.atan2(h.y - gp.y, h.x - gp.x);
            const cur = u.turrets[gi] ?? 0;
            u.turrets[gi] = this.steerUnitAngle(cur, want, trackRate, dt);
          }
          u.turret = u.turrets[0] ?? u.turret;
        }
      }
      const hullFlee =
        (sp.behavior === "attack_infantry" && u.aiMood === "flee" && !(sp.organic && u.health <= 1) && !this.snapHost(u)) ||
        (sp.behavior === "kite_attack_heli" && u.aiMood === "flee");
      const strafeHeli =
        (sp.behavior === "orbit_attack_heli" || sp.behavior === "kite_attack_heli") &&
        sp.strafeAim !== false;
      const softTurret = this.troopSoftTurret(u);
      if (softTurret) {
        // Aim like a turret: track player when engaging, otherwise point where the base is going.
        const aimTo =
          !hullFlee && (inRange || (u.burstLeft ?? 0) > 0 || (sp.organic && u.health <= 1 && u.health < u.max))
            ? aim
            : u.angle;
        u.turret = this.steerUnitAngle(u.turret, aimTo, 2.4 * aimMul * Math.max(0.12, vision), dt);
      } else if (sp.fixedAim && !guns.length && wpn && inRange && !hullFlee && !strafeHeli) {
        const turn = (sp.behavior === "orbit_attack_heli" || sp.behavior === "kite_attack_heli") ? 1.7 : 2.2;
        u.angle = this.steerUnitAngle(u.angle, aim, turn * aimMul * Math.max(0.12, vision), dt);
      }
      if (sp.building || sp.behavior === "static_hold") {
        u.aiState = inRange ? "ENGAGE" : u.aiState ?? "IDLE";
        if (inRange) {
          u.aiTx = h.x + h.vx * 0.15;
          u.aiTy = h.y + h.vy * 0.15;
        }
      }
      const inf = sp.behavior === "attack_infantry";
      const soldierDown = inf && u.health <= 1 && u.health < u.max;
      const continueBurst =
        inf && (u.burstLeft ?? 0) > 0 && h.phase === "flight" && (soldierDown || u.aiMood !== "flee");
      const soldierFlee = inf && u.aiMood === "flee" && !soldierDown && !this.snapHost(u);
      const scoutFlee = sp.behavior === "kite_attack_heli" && u.aiMood === "flee";
      const aimFrom = guns.length ? this.gunMountPos(u, gunI) : { x: u.x, y: u.y };
      const gunAim = Math.atan2(h.y - aimFrom.y, h.x - aimFrom.x);
      const barrelAng = softTurret ? u.turret : !guns.length ? u.angle : (u.turrets[gunI] ?? u.turret);
      const facingOk = Math.abs(Phaser.Math.Angle.Wrap(gunAim - barrelAng)) < 0.16;
      if (vision <= 0 && u.aware) {
        u.aware = false;
        if (u.aiMood === "kite") u.aiMood = undefined;
      }
      if (wpn && u.fireCd <= 0 && !soldierFlee && !scoutFlee && facingOk && vision > 0 && (inRange || continueBurst)) {
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
        const mood = sp.combatMood;
        if (mood) {
          if (u.aiMood !== "flee") u.aiMood = "kite";
          if ((u.burstLeft ?? 0) <= 0) {
            u.strike = (u.strike ?? 0) + 1;
            if (u.strike >= mood.strikesBeforeFlee) {
              u.aiMood = "flee";
              const [lo, hi] = mood.fleeDuration;
              u.moodT = lo + Math.random() * (hi - lo);
              u.strike = 0;
            }
          }
        }
        const home = wpn.kind === "lock-on-missile";
        const leaveSpd = home ? Math.max(70, wpn.speed * 0.3) : wpn.speed;
        const flightT = Math.max(0.12, shotDist / (home ? wpn.speed * 0.72 : wpn.speed));
        this.spawnShot({
          from: "enemy",
          x: muzzle.x,
          y: muzzle.y,
          z: muzzleZ,
          vx: Math.cos(fireAng) * leaveSpd,
          vy: Math.sin(fireAng) * leaveSpd,
          vz: Phaser.Math.Clamp((tgtZ - muzzleZ) / flightT, -280, 420),
          angle: fireAng,
          life: flightT + (home ? 1.1 : 0.35),
          blast: wpn.blast,
          dmg: wpn.dmg,
          look: wpn.look,
          homePlayer: home,
          motor: home ? -0.06 : undefined,
          cruise: home ? wpn.speed : undefined,
          scale: wpn.scale,
          beh: enemyShotBeh(wpn),
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
            scale: wpn.scale,
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
              const leaveSpd = Math.max(70, pw.speed * 0.3);
              const missileT = Math.max(0.45, Math.hypot(h.x - spawn.x, h.y - spawn.y) / (pw.speed * 0.72));
              const home = sec.homePlayer !== false;
              this.spawnShot({
                from: "enemy",
                x: px,
                y: py,
                z: muzzleZ,
                vx: Math.cos(fireAng) * leaveSpd,
                vy: Math.sin(fireAng) * leaveSpd,
                vz: Phaser.Math.Clamp((tgtZ - muzzleZ) / missileT, -280, 420),
                angle: fireAng,
                life: missileT + 1.5,
                blast: pw.blast,
                dmg: pw.dmg,
                look: pw.look,
                homePlayer: home,
                motor: sec.motor,
                cruise: pw.speed,
                scale: pw.scale * (sec.scale ?? 1),
                beh: enemyShotBeh(pw),
                fxInterval,
              });
              this.missileMuzzle(px, py, u.z, fireAng, projectileFxScale("enemy", fxInterval));
            }
          }
        }
      }
      recordUnitSpin(u, prevAngle, prevTurret, prevTurrets, dt);
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
    const h = this.heli;
    if (h.phase !== "dead" && this.cloakT <= 0) {
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
      this.shotG.add(this.add.image(0, 0, "fx_shadow"));
      this.shotG.add(this.add.image(0, 0, "shot_rocket"));
    }
    const kids = this.shotG.getChildren() as Phaser.GameObjects.Image[];
    for (const k of kids) k.setVisible(false);
    this.shots.forEach((s, i) => {
      const sh = kids[i * 2]!;
      const im = kids[i * 2 + 1]!;
      if (!cameraPointVisible(s.z, s.y)) return;
      const st = s.st;
      const key = shotLookOf(s);
      const rot = s.angle;
      let wx = s.x;
      let wy = s.y;
      let wz = s.z;
      if (st?.helixOff != null && st.helixFreq != null) {
        const wave = st.age * st.helixFreq + (st.helixPhase ?? 0);
        const lat = Math.sin(wave) * st.helixOff;
        wz += Math.cos(wave) * st.helixOff * 0.62;
        wx += -Math.sin(s.angle) * lat;
        wy += Math.cos(s.angle) * lat;
      }
      const at = worldToScreen(wx, wy, wz);
      const drawX = at.x;
      const drawY = at.y;
      if (!this.projectedInView(drawX, drawY, 120)) return;
      const drawRot = this.shotDrawRotation(s, wx, wy, wz);
      const photon = key === "shot_photon";
      const ox = SHOT_ORIGIN.x;
      const sc = (s.scale ?? 1) * (st?.helixOff ? 1.06 : 1);
      const energy = !!(s.energyTrail || s.energyTrails);
      sh.setVisible(true).setOrigin(ox, 0.5);
      this.applyCastShadow(sh, wx, wy, wz, key, rot, sc);
      if (photon) {
        // Composite lens-flare drawn in syncPhotonFlares — body sprite stays hidden.
        return;
      }
      const zs = at.scale;
      // Foreshorten along the barrel when climbing/diving (non-zero vz).
      const horiz = Math.hypot(s.vx, s.vy);
      const pitchN = Phaser.Math.Clamp(Math.abs(s.vz) / Math.max(90, Math.hypot(horiz, s.vz)), 0, 1);
      const along = 1 - pitchN * 0.52;
      const across = 1 + pitchN * 0.06;
      const shotDepth = worldDepth(wz, 0, wy);
      im.setVisible(true);
      if (this.textures.exists(key) && im.texture.key !== key) im.setTexture(key);
      im.setOrigin(ox, 0.5)
        .setPosition(drawX, drawY)
        .setRotation(drawRot)
        .setScale(sc * zs * along, sc * zs * across)
        .setAlpha(1);
      const tracer = key.startsWith("shot_cannon_") || !!st?.helixOff || energy;
      if (s.tint != null) im.setTint(s.tint);
      else if (energy) im.setTint(0x9af6ff);
      else if (st?.helixOff) im.setTint(0x66ff44);
      else im.clearTint();
      im.setBlendMode(tracer ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL);
      applyThermalHeat(im, this.thermalOn, shotIsGunOrBeam(s) ? 0.9 : 1, s.tint);
      if (im.depth !== shotDepth) im.setDepth(shotDepth);
    });
  }

  /** Layers per Photon: glow, H×2, cross H, diag×3, core. */
  static readonly PHOTON_FX_LAYERS = 8;

  syncPhotonFlares(): void {
    const layerN = MissionScene.PHOTON_FX_LAYERS;
    const have = {
      glow: this.textures.exists("shot_photon_glow"),
      h: this.textures.exists("shot_photon_stream_h"),
      diag: this.textures.exists("shot_photon_stream_diag"),
      core: this.textures.exists("shot_photon_core"),
    };
    if (!have.core) return;

    const photons: Shot[] = [];
    for (const s of this.shots) {
      if (shotLookOf(s) !== "shot_photon") continue;
      if (!cameraPointVisible(s.z, s.y)) continue;
      photons.push(s);
    }

    while (this.photonFxG.getLength() < photons.length * layerN) {
      const slot = this.photonFxG.getLength() % layerN;
      const tex =
        slot === 7
          ? "shot_photon_core"
          : slot === 0
            ? "shot_photon_glow"
            : slot <= 3
              ? "shot_photon_stream_h"
              : "shot_photon_stream_diag";
      const key = this.textures.exists(tex) ? tex : "shot_photon_core";
      this.photonFxG.add(
        this.add
          .image(0, 0, key)
          .setVisible(false)
          .setBlendMode(Phaser.BlendModes.ADD)
          .setOrigin(0.5, 0.5)
      );
    }

    const kids = this.photonFxG.getChildren() as Phaser.GameObjects.Image[];
    for (const k of kids) k.setVisible(false);

    const cam = this.cameras.main;
    const t = this.time.now * 0.001;
    const cx = cam.worldView.centerX;
    const cy = cam.worldView.centerY;

    photons.forEach((s, i) => {
      const at = worldToScreen(s.x, s.y, s.z);
      if (!this.projectedInView(at.x, at.y, 140)) return;
      const sc = (s.scale ?? 1) * at.scale;
      const depth = worldDepth(s.z, ZOff.shot + 0.4, s.y);
      // Lens flare spokes: angle from camera center → light (not missile heading / mouse).
      const viewAng = Math.atan2(at.y - cy, at.x - cx);
      // Per-shot seed so each flare stack has slightly different spoke offsets.
      const seed = ((s.id ?? i) * 0.73 + i * 1.17) % (Math.PI * 2);
      const flick =
        0.78 +
        0.22 *
          (0.5 +
            0.5 *
              Math.sin(t * 13.7 + i * 2.3) *
              Math.sin(t * 8.1 + i * 1.1 + s.x * 0.01));
      const flick2 =
        0.72 +
        0.28 * (0.5 + 0.5 * Math.sin(t * 17.2 + i * 3.1) * Math.sin(t * 5.4 + i));

      const base = i * layerN;
      const glow = kids[base]!;
      const streamH0 = kids[base + 1]!;
      const streamH1 = kids[base + 2]!;
      const streamHx = kids[base + 3]!;
      const streamD0 = kids[base + 4]!;
      const streamD1 = kids[base + 5]!;
      const streamD2 = kids[base + 6]!;
      const core = kids[base + 7]!;

      const place = (
        im: Phaser.GameObjects.Image,
        tex: string,
        rot: number,
        sx: number,
        sy: number,
        alpha: number,
        zOff: number
      ) => {
        if (this.textures.exists(tex) && im.texture.key !== tex) im.setTexture(tex);
        im.setVisible(true)
          .setOrigin(0.5, 0.5)
          .setPosition(at.x, at.y)
          .setRotation(rot)
          .setScale(sx, sy)
          .setAlpha(alpha)
          .setBlendMode(Phaser.BlendModes.ADD)
          .setDepth(depth + zOff);
        if (s.tint != null) im.setTint(s.tint);
        else im.clearTint();
        applyThermalHeat(im, this.thermalOn, 1, s.tint);
      };

      // Soft bloom stays screen-aligned (never tracks missile heading).
      if (have.glow) {
        place(glow, "shot_photon_glow", 0, sc * 2.05 * flick, sc * 2.05 * flick, 0.5 * flick, -0.02);
      }
      if (have.h) {
        // Long needles — bake already collapsed fat hubs; sy mostly follows the thin strip.
        place(
          streamH0,
          "shot_photon_stream_h",
          viewAng + Math.sin(seed) * 0.06,
          sc * 3.6 * flick,
          sc * (0.95 + 0.2 * flick2),
          0.92 * flick,
          0
        );
        place(
          streamH1,
          "shot_photon_stream_h",
          viewAng + 0.11 + Math.cos(seed * 1.3) * 0.05,
          sc * 2.9 * flick2,
          sc * (0.75 + 0.15 * flick),
          0.65 * flick2,
          0.005
        );
        place(
          streamHx,
          "shot_photon_stream_h",
          viewAng + Math.PI * 0.5 + Math.sin(seed * 0.7) * 0.08,
          sc * 3.1 * flick,
          sc * (0.7 + 0.15 * flick2),
          0.72 * flick,
          0.008
        );
      }
      if (have.diag) {
        // Diag art is already a thin diagonal needle after bake — keep scale near-uniform.
        place(
          streamD0,
          "shot_photon_stream_diag",
          viewAng + Math.cos(seed) * 0.07,
          sc * 2.9 * flick2,
          sc * 2.9 * flick2,
          0.78 * flick2,
          0.01
        );
        place(
          streamD1,
          "shot_photon_stream_diag",
          viewAng + Math.PI * 0.5 + Math.sin(seed * 1.9) * 0.06,
          sc * 2.55 * flick,
          sc * 2.55 * flick,
          0.7 * flick,
          0.015
        );
        place(
          streamD2,
          "shot_photon_stream_diag",
          viewAng + 0.18 + Math.cos(seed * 0.5) * 0.09,
          sc * 2.2 * flick2,
          sc * 2.2 * flick2,
          0.58 * flick2,
          0.02
        );
      }
      // Core never rotates — fixed screen orientation.
      place(core, "shot_photon_core", 0, sc * (1.05 + 0.1 * flick), sc * (1.05 + 0.1 * flick2), 0.95 + 0.05 * flick, 0.04);
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

  tickLockOn(dt: number, ptr: { x: number; y: number }): void {
    const h = this.heli;
    if (h.lockTarget && !this.unitById(h.lockTarget.id)) h.lockTarget = null;
    if (h.lockAcquire && !this.unitById(h.lockAcquire.id)) h.lockAcquire = null;

    const spec = this.hudLoadout()[this.hudWeapon()]!;
    const g = spec.guidance;
    // Pre-fire lock_on only (steer_commit soft-locks in flight).
    if (!g || !guidanceIsLockOn(g)) {
      h.lockTarget = null;
      h.lockAcquire = null;
      return;
    }
    const targeting = g.targeting;

    const cats = targeting.acquire.categories;
    if (cats) {
      if (h.lockTarget) {
        const u = this.unitById(h.lockTarget.id);
        if (u && !heatCategoryOk(u, cats)) h.lockTarget = null;
      }
      if (h.lockAcquire) {
        const u = this.unitById(h.lockAcquire.id);
        if (u && !heatCategoryOk(u, cats)) h.lockAcquire = null;
      }
    }

    const lockTime = targeting.lockTime;
    const lockRadius = targeting.lockRadius;
    const tgt =
      targeting.acquire.policy === "signature"
        ? this.signaturePickTarget(ptr.x, ptr.y, lockRadius, targeting.acquire)
        : this.reticlePickTarget(ptr.x, ptr.y, lockRadius, cats);
    if (!tgt || (h.lockTarget && tgt.id === h.lockTarget.id)) {
      h.lockAcquire = null;
      return;
    }
    if (!h.lockAcquire || h.lockAcquire.id !== tgt.id) {
      h.lockAcquire = { id: tgt.id, t: 0 };
    } else {
      h.lockAcquire.t += dt;
      if (h.lockAcquire.t >= lockTime) {
        h.lockTarget = { id: h.lockAcquire.id };
        h.lockAcquire = null;
      }
    }
  }

  /** Second-click NLOS commit: home to soft-lock or aim point; keep seeker cam through the dive. */
  commitNlosTerminal(s: Shot, ptr: { x: number; y: number }): void {
    if (!s.st || s.st.terminal) return;
    const locked = s.targetId != null ? this.unitById(s.targetId) : undefined;
    if (locked && !locked.dead) {
      s.targetId = locked.id;
      s.st.gx = undefined;
      s.st.gy = undefined;
    } else {
      s.targetId = undefined;
      s.st.gx = ptr.x;
      s.st.gy = ptr.y;
    }
    s.st.terminal = true;
    s.st.seeking = true;
  }

  signatureLockCandidates(
    x: number,
    y: number,
    max: number,
    acquire: Extract<LockAcquire, { policy: "signature" }>
  ): { u: Unit; score: number; heat: number }[] {
    const h = this.heli;
    const out: { u: Unit; score: number; heat: number }[] = [];
    for (const u of this.units) {
      if (u.dead || u.health < acquire.minHealth) continue;
      if (!heatCategoryOk(u, acquire.categories)) continue;
      const d = Math.hypot(u.x - x, u.y - y);
      if (d > max) continue;
      const aim = Math.atan2(u.y - h.y, u.x - h.x);
      const cat = heatClassCategory(heatClassOf(u));
      const boresight =
        cat === "vehicle" && acquire.vehicleMaxOffBoresight != null
          ? acquire.vehicleMaxOffBoresight
          : acquire.maxOffBoresight;
      if (Math.abs(Phaser.Math.Angle.Wrap(aim - h.angle)) > boresight) continue;
      const cls = heatClassScore(heatClassOf(u));
      const heat = cls + Phaser.Math.Clamp(u.max / 420, 0, 0.85);
      const score = heatSeekScore(u, aim, h.angle) - d * 0.01;
      out.push({ u, score, heat });
    }
    return out;
  }

  signaturePickTarget(
    x: number,
    y: number,
    max: number,
    acquire: Extract<LockAcquire, { policy: "signature" }>
  ): Unit | undefined {
    let best: Unit | undefined;
    let bestScore = -Infinity;
    for (const c of this.signatureLockCandidates(x, y, max, acquire)) {
      if (c.score > bestScore) {
        bestScore = c.score;
        best = c.u;
      }
    }
    return best;
  }

  /** Heat-sized pips for signature (Stinger / Sidewinder) lock candidates. */
  drawHeatSeekHud(g: Extract<NonNullable<PlayerWpnSpec["guidance"]>["targeting"], { mode: "lock_on" }>): void {
    if (g.acquire.policy !== "signature") return;
    const gfx = this.lockGfx;
    const ptr = this.worldPointer();
    const lockedId = this.heli.lockTarget?.id;
    const acqId = this.heli.lockAcquire?.id;
    for (const { u, heat } of this.signatureLockCandidates(ptr.x, ptr.y, g.lockRadius, g.acquire)) {
      const at = worldToScreen(u.x, u.y, u.z + heightOf(u.kind) * 0.45);
      const r = (4.5 + heat * 4.4) * zScale(u.z, u.y);
      const cls = heatClassOf(u);
      const tone =
        cls === "air" ? 0x7ad8ff : cls === "vehicle" ? 0xffb060 : cls === "building" ? 0xd4a06a : 0xc88858;
      if (u.id === lockedId) {
        gfx.lineStyle(2, 0xff3a22, 0.9);
        gfx.strokeCircle(at.x, at.y, r + 3);
        gfx.fillStyle(0xff3a22, 0.12);
        gfx.fillCircle(at.x, at.y, r + 3);
      } else if (u.id === acqId) {
        const t = Math.min(1, (this.heli.lockAcquire?.t ?? 0) / g.lockTime);
        gfx.lineStyle(1.6, 0xff6622, 0.55 + t * 0.35);
        gfx.strokeCircle(at.x, at.y, r + 1);
        gfx.fillStyle(0xff6622, 0.08 + t * 0.08);
        gfx.fillCircle(at.x, at.y, r + 1);
      } else {
        gfx.lineStyle(1.15, tone, 0.42);
        gfx.strokeCircle(at.x, at.y, r);
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
    return this.drawLockDiamondAt(u.x, u.y, u.z, this.lockBoxHalf(u, scale), width, alpha, color);
  }

  drawLockDiamondAt(
    wx: number,
    wy: number,
    wz: number,
    half: number,
    width: number,
    alpha: number,
    color: number,
    dashed = false
  ): { x: number; y: number; half: number; depth: number } {
    const g = this.lockGfx;
    const at = worldToScreen(wx, wy, wz);
    const x = at.x;
    const y = at.y;
    const depth = worldDepth(wz, 8, wy);
    const pts = [
      { x, y: y - half },
      { x: x + half, y },
      { x, y: y + half },
      { x: x - half, y },
    ];
    g.lineStyle(width, color, alpha);
    if (dashed) {
      const tick = half * 0.42;
      for (let i = 0; i < 4; i++) {
        const a = pts[i]!;
        const prev = pts[(i + 3) % 4]!;
        const next = pts[(i + 1) % 4]!;
        const toPrev = Math.hypot(prev.x - a.x, prev.y - a.y) || 1;
        const toNext = Math.hypot(next.x - a.x, next.y - a.y) || 1;
        g.lineBetween(
          a.x,
          a.y,
          a.x + ((prev.x - a.x) / toPrev) * tick,
          a.y + ((prev.y - a.y) / toPrev) * tick
        );
        g.lineBetween(
          a.x,
          a.y,
          a.x + ((next.x - a.x) / toNext) * tick,
          a.y + ((next.y - a.y) / toNext) * tick
        );
      }
    } else {
      g.beginPath();
      g.moveTo(pts[0]!.x, pts[0]!.y);
      g.lineTo(pts[1]!.x, pts[1]!.y);
      g.lineTo(pts[2]!.x, pts[2]!.y);
      g.lineTo(pts[3]!.x, pts[3]!.y);
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
    }
    return { x, y, half, depth };
  }

  inboundLockTargets(): Unit[] {
    const seen = new Set<number>();
    const out: Unit[] = [];
    for (const s of this.shots) {
      if (s.from !== "player" || s.targetId == null) continue;
      const guided =
        shotFacesHeading(s) ||
        (s.beh?.guidance != null && guidanceUsesLock(s.beh.guidance));
      if (!guided) continue;
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
    this.lockArrowGfx.clear();
    this.lockHudTxt.setVisible(false);
    this.lockInbdHudTxt.setVisible(false);
    this.lockTxt.setVisible(false).setText("LOCK").setColor("#ff3a22");
    this.lockInbdTxt.setVisible(false);

    const spec = this.hudLoadout()[this.hudWeapon()]!;
    if (launchIsArcBeam(spec.launch)) {
      this.updateTeslaLock(spec);
      this.drawGpsWaypointMarks();
      return;
    }
    const wpnGuidance = spec.guidance;
    if (!wpnGuidance || !guidanceUsesLock(wpnGuidance)) {
      if (!this.drawGpsWaypointMarks()) g.setVisible(false);
      return;
    }
    const targeting = wpnGuidance.targeting;

    if (targeting.mode === "steer_commit") {
      this.updateNlosLock(targeting);
      this.drawGpsWaypointMarks();
      return;
    }

    const lockTime = targeting.lockTime;
    const inbound = this.inboundLockTargets();
    const locked = h.lockTarget ? this.unitById(h.lockTarget.id) : undefined;
    const seeking = h.lockAcquire ? this.unitById(h.lockAcquire.id) : undefined;
    const heatSeek =
      targeting.mode === "lock_on" && targeting.acquire.policy === "signature";
    const hud = spec.cam.lockHud;
    const lockColor = hud?.color ?? 0xff3a22;
    const lockTextColor = hud?.textColor ?? "#ff3a22";
    if (!locked && !seeking && inbound.length === 0 && !heatSeek) {
      if (!this.drawGpsWaypointMarks()) g.setVisible(false);
      return;
    }

    g.setVisible(true);
    if (heatSeek && targeting.mode === "lock_on") this.drawHeatSeekHud(targeting);
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
        const t = Math.min(1, h.lockAcquire!.t / lockTime);
        const scale = 2 - t;
        const box = this.drawLockBox(seeking, scale, 1.6, 0.72 + t * 0.22, lockColor);
        lockDepth = Math.max(lockDepth, box.depth);
        this.lockTxt
          .setVisible(true)
          .setText(hud?.seeking ?? "LOCK")
          .setColor(lockTextColor)
          .setPosition(box.x, box.y - box.half - 4)
          .setDepth(lockDepth)
          .setAlpha(0.75 + t * 0.25)
          .setScale(zScale(seeking.z, seeking.y));
      } else {
        this.lockHudTxt.setText(hud?.seeking ?? "LOCK").setColor(lockTextColor);
        this.drawLockOffscreen(vis.sx, vis.sy, lockColor, this.lockHudTxt, 0.85);
      }
    }
    if (locked && !inboundIds.has(locked.id)) {
      const vis = this.unitOnHud(locked);
      const blink = Math.floor(this.time.now / 70) % 2 === 0;
      const alpha = blink ? 1 : 0.12;
      if (vis.on) {
        const box = this.drawLockDiamond(locked, 1, 2.15, alpha, lockColor);
        lockDepth = Math.max(lockDepth, box.depth);
        this.lockTxt
          .setVisible(true)
          .setText(hud?.locked ?? "LOCK")
          .setColor(lockTextColor)
          .setPosition(box.x, box.y - box.half - 4)
          .setDepth(lockDepth)
          .setAlpha(alpha)
          .setScale(zScale(locked.z, locked.y));
      } else {
        this.lockHudTxt.setText(hud?.locked ?? "LOCK").setColor(lockTextColor);
        this.drawLockOffscreen(vis.sx, vis.sy, lockColor, this.lockHudTxt, alpha);
      }
    }
    g.setDepth(lockDepth);
    this.drawGpsWaypointMarks();
  }

  /** Persistent ground circles for in-flight GPS / waypoint munitions. */
  drawGpsWaypointMarks(): boolean {
    const g = this.lockGfx;
    let any = false;
    let depth = g.depth;
    let labelI = 0;
    for (const s of this.shots) {
      if (s.from !== "player" || !s.st || s.st.bomblet) continue;
      if (targetingMode(s.beh?.guidance) !== "waypoint") continue;
      const gx = s.st.gx;
      const gy = s.st.gy;
      if (gx == null || gy == null) continue;
      any = true;
      const gz = groundZ(this.world, gx, gy);
      const at = worldToScreen(gx, gy, gz);
      const sc = zScale(gz, gy);
      const r = 9 * sc;
      g.lineStyle(1.35, 0xf0d56a, 0.55);
      g.strokeCircle(at.x, at.y, r);
      g.lineStyle(1, 0xf0d56a, 0.28);
      g.strokeCircle(at.x, at.y, r * 1.45);
      g.lineStyle(1, 0xf0d56a, 0.38);
      g.lineBetween(at.x - r * 0.42, at.y, at.x + r * 0.42, at.y);
      g.lineBetween(at.x, at.y - r * 0.42, at.x, at.y + r * 0.42);
      const markDepth = worldDepth(gz, 8, gy);
      depth = Math.max(depth, markDepth);
      const dist = Math.hypot(gx - s.x, gy - s.y, gz - s.z);
      const txt = this.acquireGpsDistTxt(labelI++);
      txt
        .setText(`${Math.max(0, Math.round(dist))}m`)
        .setVisible(true)
        .setPosition(at.x, at.y - r * 1.55 - 2)
        .setDepth(markDepth)
        .setScale(sc)
        .setAlpha(0.52);
    }
    for (let i = labelI; i < this.gpsDistTxt.length; i++) {
      const t = this.gpsDistTxt[i];
      if (t?.active) t.setVisible(false);
    }
    if (any) {
      g.setVisible(true);
      g.setDepth(depth);
    }
    return any;
  }

  acquireGpsDistTxt(i: number): Phaser.GameObjects.Text {
    while (this.gpsDistTxt.length <= i) this.gpsDistTxt.push(this.makeGpsDistTxt());
    const existing = this.gpsDistTxt[i];
    // Scene restart destroys old Text objects but the pool array can linger — replace.
    if (!existing || !existing.active || !existing.scene) {
      this.gpsDistTxt[i] = this.makeGpsDistTxt();
    }
    return this.gpsDistTxt[i]!;
  }

  makeGpsDistTxt(): Phaser.GameObjects.Text {
    const t = this.add
      .text(0, 0, "", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "11px",
        color: "#f0d56a",
      })
      .setOrigin(0.5, 1)
      .setDepth(Layer.FIELD)
      .setVisible(false)
      .setStroke("#1c100c", 2)
      .setAlpha(0.52);
    this.bindFieldHud(t);
    return t;
  }

  /** Instant near-mouse lock diamond for the Tesla coil cannon. */
  updateTeslaLock(spec: PlayerWpnSpec): void {
    const g = this.lockGfx;
    const tip = this.teslaMuzzleOrigin(this.heli.weapon);
    const range = this.teslaRangeOf(spec);
    const tgt = this.pickTeslaTarget(tip, this.worldPointer());
    if (!tgt) {
      g.setVisible(false);
      return;
    }
    const uz = tgt.z + heightOf(tgt.kind) * 0.45;
    const inRange = Math.hypot(tgt.x - tip.x, tgt.y - tip.y, uz - tip.z) <= range;
    const color = inRange ? 0x4de8ff : 0xffb020;
    const label = inRange ? "ARC" : "RANGE";
    const vis = this.unitOnHud(tgt);
    g.setVisible(true);
    if (vis.on) {
      const box = this.drawLockDiamondAt(
        tgt.x,
        tgt.y,
        tgt.z,
        this.lockBoxHalf(tgt, 1.12),
        inRange ? 2.05 : 1.7,
        inRange ? 0.95 : 0.82,
        color,
        !inRange
      );
      this.lockTxt
        .setText(label)
        .setColor(inRange ? "#7af0ff" : "#ffd060")
        .setVisible(true)
        .setPosition(box.x, box.y - box.half - 4)
        .setDepth(box.depth)
        .setAlpha(inRange ? 0.95 : 0.88)
        .setScale(zScale(tgt.z, tgt.y));
      g.setDepth(box.depth);
    } else {
      this.drawLockOffscreen(vis.sx, vis.sy, color, this.lockHudTxt, inRange ? 0.95 : 0.82);
      this.lockHudTxt.setText(label).setColor(inRange ? "#7af0ff" : "#ffd060");
    }
  }

  /** Spike / NLOS: LOCK diamond only while missile flies + reticle near target; FIRE after commit. */
  updateNlosLock(
    g: Extract<NonNullable<PlayerWpnSpec["guidance"]>["targeting"], { mode: "steer_commit" }>
  ): void {
    const gfx = this.lockGfx;
    const wpnId = this.loadout[this.heli.weapon]!.id;
    const shot = this.shots.find(
      (s) => s.from === "player" && s.wpnId === wpnId && s.st && !s.st.bomblet
    );
    if (!shot?.st) {
      gfx.setVisible(false);
      return;
    }

    if (shot.st.terminal) {
      const locked = shot.targetId != null ? this.unitById(shot.targetId) : undefined;
      gfx.setVisible(true);
      let lockDepth: number = Layer.FIELD;
      if (locked && !locked.dead) {
        const vis = this.unitOnHud(locked);
        if (vis.on) {
          const box = this.drawLockDiamond(locked, 1.18, 2.1, 0.92, 0xffb020);
          lockDepth = Math.max(lockDepth, box.depth);
          this.lockInbdTxt
            .setVisible(true)
            .setPosition(box.x, box.y - box.half - 4)
            .setDepth(box.depth)
            .setAlpha(0.95)
            .setScale(zScale(locked.z, locked.y));
        } else {
          this.drawLockOffscreen(vis.sx, vis.sy, 0xffb020, this.lockInbdHudTxt, 0.95);
        }
      } else if (shot.st.gx != null && shot.st.gy != null) {
        const gz = groundZ(this.world, shot.st.gx, shot.st.gy);
        const half = 28 * zScale(gz, shot.st.gy);
        const box = this.drawLockDiamondAt(shot.st.gx, shot.st.gy, gz, half, 2.1, 0.92, 0xffb020);
        lockDepth = Math.max(lockDepth, box.depth);
        this.lockInbdTxt
          .setVisible(true)
          .setPosition(box.x, box.y - box.half - 4)
          .setDepth(box.depth)
          .setAlpha(0.95)
          .setScale(zScale(gz, shot.st.gy));
      } else {
        gfx.setVisible(false);
        return;
      }
      gfx.setDepth(lockDepth);
      return;
    }

    // Under control: LOCK diamond only when soft-locked and reticle still close.
    const locked = shot.targetId != null ? this.unitById(shot.targetId) : undefined;
    const near =
      !!locked &&
      !locked.dead &&
      Math.hypot(this.worldPointer().x - locked.x, this.worldPointer().y - locked.y) <=
        (g.breakLockRadius ?? g.lockRadius);
    if (!near || !locked) {
      gfx.setVisible(false);
      return;
    }

    gfx.setVisible(true);
    const blink = Math.floor(this.time.now / 70) % 2 === 0;
    const alpha = blink ? 1 : 0.12;
    const vis = this.unitOnHud(locked);
    if (vis.on) {
      const box = this.drawLockDiamond(locked, 1, 2.15, alpha, 0xff3a22);
      this.lockTxt
        .setVisible(true)
        .setPosition(box.x, box.y - box.half - 4)
        .setDepth(box.depth)
        .setAlpha(alpha)
        .setScale(zScale(locked.z, locked.y));
      gfx.setDepth(box.depth);
    } else {
      this.drawLockOffscreen(vis.sx, vis.sy, 0xff3a22, this.lockHudTxt, alpha);
      gfx.setDepth(Layer.FIELD);
    }
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
    const look = this.camLookWorld();
    const camHud = this.worldToHudScreen(look.x, look.y, look.z);
    const ang = Math.atan2(sy - camHud.sy, sx - camHud.sx);
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

  reticlePickTarget(
    x: number,
    y: number,
    max: number,
    categories?: readonly ("air" | "ground" | "vehicle")[]
  ): Unit | undefined {
    let best: Unit | undefined;
    let bestScore = Infinity;
    for (const u of this.units) {
      if (u.dead) continue;
      if (categories && !heatCategoryOk(u, categories)) continue;
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
    const { sx, sy } = this.worldToHudScreen(u.x, u.y, u.z);
    const w = this.scale.width;
    const h = this.scale.height;
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
    const ammoShown = this.remotePoolDisplayAmmo(h.weapon, ammo);
    const ammoS =
      this.infAmmo && Number.isFinite(ammoShown)
        ? "∞"
        : Number.isFinite(ammoShown)
          ? String(ammoShown)
          : "∞";
    const phase =
      h.phase === "grounded" || h.phase === "spool"
        ? h.spec.rotor
          ? "SPOOLING ROTORS"
          : "ENGINE START"
        : h.phase === "ready"
          ? "READY"
          : h.phase === "dead"
            ? "DOWN"
            : this.remoteView && this.activeRemote()
              ? "SPECTRE POV"
              : "AIRBORNE";
    const ptr = this.worldPointer();
    const elv = groundZ(this.world, ptr.x, ptr.y) | 0;
    const over = this.reticleUnit();
    const overLine = over ? `\n${this.unitHudName(over)}` : "";
    this.hud.setText(
      `ALT ${castZ(this.world, h.x, h.y, h.z) | 0}   ELV ${elv}   SPD ${Math.hypot(h.vx, h.vy) | 0}   TIME ${this.liveSimScale.toFixed(2)}×\n${phase}\nWPN ${w.name}  ${ammoS}${overLine}`
    );
    this.syncLiftPrompt();
    this.syncSpectrePrompt();

    const lines = this.world.hv.map((spec) => this.hvLine(spec));
    const left = lines.filter((l) => !l.done).length;
    this.hvHud.setColor("#e8b84a").setText(`OBJECTIVES  ${this.world.hv.length - left}/${this.world.hv.length}`);
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
    this.layoutUpperRightHud();
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

  spectreDetonateArmed(): boolean {
    const remote = this.selectedSlotRemote();
    return (
      this.remoteView &&
      !!remote &&
      !remoteGunId(remote.spec) &&
      !remote.spec.pilotable &&
      payloadIsRemote(this.loadout[this.heli.weapon]?.payload)
    );
  }

  syncSpectrePrompt(slotTop?: number): void {
    const show =
      !this.mapView &&
      !this.over &&
      !!this.pilotingRemote() &&
      !this.povHudRemote();
    this.spectrePrompt.setVisible(show);
    if (!show) return;
    const armed = this.spectreDetonateArmed();
    const gun = !!this.pilotingRemote()?.spec.gun;
    this.spectrePrompt.setText(
      gun
        ? "HOLD LMB  FIRE\n1–N / Q  RELEASE"
        : armed
          ? "LMB  DETONATE\nQ / RMB  EXIT VIEW"
          : "Q / RMB  EXIT VIEW"
    );
    const y = slotTop != null ? slotTop - (armed || gun ? 32 : 18) : this.scale.height - 96;
    const lp = this.hudLocal(this.scale.width / 2, y);
    this.spectrePrompt.setPosition(lp.x, lp.y);
    const blink = 0.72 + 0.28 * (0.5 + 0.5 * Math.sin(this.time.now * 0.006));
    this.spectrePrompt.setAlpha(blink);
  }

  drawWeaponHud(): void {
    const h = this.heli;
    const g = this.wpnBar;
    g.clear();
    const pov = this.povHudRemote();
    const loadout = this.hudLoadout();
    const ammoArr = this.hudAmmo();
    const selected = this.hudWeapon();
    const slotW = 168;
    const slotH = 38;
    const gap = 8;
    const escortOn = !!(pov?.spec.hostEscort);
    const escortW = escortOn ? 118 : 0;
    const escortGap = escortOn ? gap : 0;
    const exitW = pov ? 92 : 0;
    const exitGap = pov ? gap : 0;
    const n = loadout.length;
    this.ensureWpnHudSlots(n);
    const total =
      n * slotW +
      Math.max(0, n - 1) * gap +
      escortGap +
      escortW +
      exitGap +
      exitW;
    const x0 = this.scale.width / 2 - total / 2;
    const anyAuto =
      !pov && h.spec.sockets.some((s) => s.controller === "automatic");
    const cmStripH = pov ? 8 : 30;
    const crewPad = anyAuto ? 15 : 2;
    const y = this.scale.height - 10 - cmStripH - crewPad - slotH;
    const padX = 8;
    const barH = 3;
    const barY = y + slotH - 7;
    const barPad = 6;

    for (let i = 0; i < n; i++) {
      const wp = loadout[i]!;
      const reserve = ammoArr[i]!;
      const a =
        !pov && payloadIsRemote(wp.payload)
          ? this.remotePoolDisplayAmmo(i, reserve)
          : reserve;
      const hostAmmoId = pov ? this.remoteHostAmmoWeapon(wp) : undefined;
      const hostSlot = hostAmmoId ? this.hostWeaponSlot(hostAmmoId) : -1;
      const hostSpec = hostAmmoId ? PLAYER_WPNS[hostAmmoId as WpnId] : undefined;
      const cap =
        pov && hostSpec && hostSlot >= 0
          ? craftSocketStartingAmmo(hostSpec.ammo, h.spec, hostSlot)
          : pov
            ? remoteSocketStartingAmmo(wp.ammo, pov.spec, i)
            : craftSocketStartingAmmo(wp.ammo, h.spec, i);
      // Launch gate uses hangar reserve; display can include live dockable remotes.
      const empty = !this.infAmmo && Number.isFinite(a) && a <= 0;
      const frac =
        this.infAmmo || !Number.isFinite(a) || !Number.isFinite(cap) || cap <= 0
          ? 1
          : Phaser.Math.Clamp(a / cap, 0, 1);
      const low = !empty && Number.isFinite(a) && frac > 0 && frac <= 0.25;
      const sel = i === selected;
      const socket = pov ? pov.spec.sockets?.[i] : h.spec.sockets[i];
      const auto = !pov && socket?.controller === "automatic";
      const gunner = auto && !sel;
      const disabled = pov ? false : this.weaponSlotDisabled(i);
      const x = x0 + i * (slotW + gap);

      // Slot chrome — disabled is a shared visual (cloak today; other gates later).
      if (disabled) {
        g.fillStyle(sel ? 0x1a1a1c : 0x0e0e10, sel ? 0.88 : 0.62);
        g.fillRoundedRect(x, y, slotW, slotH, 3);
        g.lineStyle(1.4, sel ? 0x5a5a62 : 0x3a3a42, sel ? 0.85 : 0.55);
        g.strokeRoundedRect(x, y, slotW, slotH, 3);
      } else if (sel) {
        g.fillStyle(empty ? 0xff3a2a : low ? 0xe89a3a : 0xe8b84a, 1);
        g.fillRoundedRect(x, y, slotW, slotH, 3);
      } else if (empty) {
        g.fillStyle(0x3a1410, 0.92);
        g.fillRoundedRect(x, y, slotW, slotH, 3);
        g.lineStyle(1.5, 0xff3a2a, 0.95);
        g.strokeRoundedRect(x, y, slotW, slotH, 3);
      } else if (gunner && low) {
        g.fillStyle(0x142028, 0.82);
        g.fillRoundedRect(x, y, slotW, slotH, 3);
        g.lineStyle(1.5, 0xe89a3a, 0.9);
        g.strokeRoundedRect(x, y, slotW, slotH, 3);
      } else if (gunner) {
        g.fillStyle(0x101820, 0.72);
        g.fillRoundedRect(x, y, slotW, slotH, 3);
        g.lineStyle(1.5, 0x4aa8e8, 0.9);
        g.strokeRoundedRect(x, y, slotW, slotH, 3);
      } else if (low) {
        g.fillStyle(0x2a1a0c, 0.78);
        g.fillRoundedRect(x, y, slotW, slotH, 3);
        g.lineStyle(1.4, 0xe89a3a, 0.9);
        g.strokeRoundedRect(x, y, slotW, slotH, 3);
      } else {
        g.fillStyle(0x12100c, 0.55);
        g.fillRoundedRect(x, y, slotW, slotH, 3);
        g.lineStyle(1.2, 0xc4a24a, 0.55);
        g.strokeRoundedRect(x, y, slotW, slotH, 3);
      }

      // Ammo fraction bar
      {
        const barX = x + barPad;
        const barW = slotW - barPad * 2;
        g.fillStyle(0x000000, sel ? 0.35 : 0.45);
        g.fillRect(barX, barY, barW, barH);
        const fill = empty
          ? 0xff3a2a
          : low
            ? sel
              ? 0x6a2a08
              : 0xe89a3a
            : sel
              ? 0x1c1812
              : gunner
                ? 0x5eb4e8
                : 0xc4a24a;
        g.fillStyle(fill, disabled ? 0.55 : sel ? 0.85 : 0.95);
        g.fillRect(barX, barY, Math.max(2, barW * frac), barH);
      }

      const row = this.wpnHudSlots[i]!;
      const midY = y + (slotH - barH - 4) / 2;
      const keyLp = this.hudLocal(x + padX, midY);
      const ammoLp = this.hudLocal(x + slotW - padX, midY);

      const ammoS = empty
        ? "—"
        : this.infAmmo || !Number.isFinite(a)
          ? "∞"
          : String(a | 0);
      const liveRemotes =
        !pov && payloadIsRemote(wp.payload)
          ? this.remotes.filter(
              (r) => !r.detonate && !r.dock && r.spec.kind === wp.payload!.remote!.kind
            )
          : [];
      const liveRemote = liveRemotes[0];
      const liveCount = liveRemotes.length;
      const pilotingThis =
        !!liveRemote &&
        this.remoteView &&
        this.pilotingRemote()?.id === liveRemote.id;
      const liveMark = liveCount > 0 && !pilotingThis && !disabled;
      const mult = pov ? 1 : craftSocketMultiplicity(h.spec, i);
      const rawName = liveRemote
        ? pilotingThis
          ? `${wp.name}  CTRL`
          : liveCount > 1
            ? `${wp.name}  LIVE ×${liveCount}`
            : `${wp.name}  LIVE`
        : mult > 1
          ? `${mult}× ${wp.name}`
          : wp.name;

      // Colors by state
      let keyCol = "#a89868";
      let nameCol = "#f0d56a";
      let ammoCol = "#e8d49a";
      let stroke = "#12100c";
      let strokeW = 3;
      if (disabled) {
        keyCol = nameCol = ammoCol = sel ? "#8a8a92" : "#6a6a72";
        stroke = "#0a0a0c";
        strokeW = 2;
      } else if (sel) {
        keyCol = nameCol = ammoCol = empty ? "#2a0808" : "#1c1812";
        stroke = empty ? "#2a0808" : "#1c1812";
        strokeW = 0;
      } else if (empty) {
        keyCol = nameCol = ammoCol = "#ff4a2a";
        stroke = "#1a0808";
      } else if (gunner) {
        keyCol = "#6aa8c8";
        nameCol = "#7ad0ff";
        ammoCol = low ? "#ff9a3a" : "#9ad8f0";
      } else if (low) {
        ammoCol = "#ff9a3a";
        nameCol = "#f0c878";
      }
      // Spectre airborne in bird-cam: green LIVE stands out from the yellow loadout chrome.
      if (liveMark) nameCol = sel ? "#0a4020" : "#3dff88";

      const textA = disabled ? (sel ? 0.55 : 0.4) : 1;
      row.key
        .setVisible(true)
        .setPosition(keyLp.x, keyLp.y)
        .setText(String(i + 1))
        .setColor(keyCol)
        .setStroke(stroke, strokeW)
        .setFontSize("12px")
        .setAlpha(disabled ? textA : sel ? 0.7 : 0.85);

      row.ammo
        .setVisible(true)
        .setPosition(ammoLp.x, ammoLp.y)
        .setText(ammoS)
        .setColor(ammoCol)
        .setStroke(stroke, strokeW)
        .setFontSize(low && !sel && !disabled ? "13px" : "12px")
        .setAlpha(textA);

      // Name sits between key and ammo; truncate so it never spills the box.
      const nameMaxW = Math.max(
        24,
        slotW - padX * 2 - row.key.width - 10 - row.ammo.width - 8
      );
      const nameStr = this.fitHudLabel(row.name, rawName, nameMaxW);
      const nameLp = this.hudLocal(x + padX + row.key.width + 6, midY);
      const liveBlink = liveMark
        ? 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(this.time.now * 0.014))
        : 1;
      row.name
        .setVisible(true)
        .setPosition(nameLp.x, nameLp.y)
        .setText(nameStr)
        .setColor(nameCol)
        .setStroke(stroke, strokeW)
        .setFontSize("13px")
        .setAlpha(disabled ? textA : liveBlink);

      if (auto) {
        const player = sel;
        const statusLp = this.hudLocal(x + slotW / 2, y + slotH + 3);
        const label = player
          ? "PILOT"
          : `${craftCrewHudTag(socket!) ?? "CREW"} GUNNER`;
        row.status
          .setVisible(true)
          .setPosition(statusLp.x, statusLp.y)
          .setText(label)
          .setColor(disabled ? "#6a6a72" : player ? "#e8b84a" : "#8ec8e8")
          .setStroke("#12100c", 2)
          .setAlpha(disabled ? 0.45 : player ? 0.95 : 0.85)
          .setFontSize("10px");
      } else if (liveMark && liveRemote?.spec.kind === "wingman") {
        const statusLp = this.hudLocal(x + slotW / 2, y + slotH + 3);
        row.status
          .setVisible(true)
          .setPosition(statusLp.x, statusLp.y)
          .setText("Q RECALL")
          .setColor(sel ? "#0a4020" : "#3dff88")
          .setStroke("#12100c", 2)
          .setAlpha(0.9)
          .setFontSize("10px");
      } else {
        row.status.setVisible(false).setText("");
      }
    }

    // POV remote: escort FOLLOW/HOLD chrome + Q EXIT (not weapon slots).
    if (escortOn) {
      const x = x0 + n * (slotW + gap);
      const follow = this.hostEscortMode === "follow";
      g.fillStyle(follow ? 0x142028 : 0x12100c, follow ? 0.82 : 0.62);
      g.fillRoundedRect(x, y, escortW, slotH, 3);
      g.lineStyle(1.3, follow ? 0x4aa8e8 : 0x8a8470, follow ? 0.9 : 0.75);
      g.strokeRoundedRect(x, y, escortW, slotH, 3);
      const midY = y + slotH / 2;
      const keyLp = this.hudLocal(x + padX, midY);
      this.escortHudSlot.key
        .setVisible(true)
        .setPosition(keyLp.x, keyLp.y)
        .setText("F")
        .setColor(follow ? "#6aa8c8" : "#a89868")
        .setStroke("#12100c", 3)
        .setFontSize("12px")
        .setAlpha(0.9);
      const nameLp = this.hudLocal(x + padX + this.escortHudSlot.key.width + 6, midY);
      this.escortHudSlot.name
        .setVisible(true)
        .setPosition(nameLp.x, nameLp.y)
        .setText(follow ? "FOLLOW" : "HOLD")
        .setColor(follow ? "#7ad0ff" : "#f0d56a")
        .setStroke("#12100c", 3)
        .setFontSize("13px")
        .setAlpha(0.95);
    } else {
      this.escortHudSlot.key.setVisible(false);
      this.escortHudSlot.name.setVisible(false);
    }
    if (pov) {
      const x = x0 + n * (slotW + gap) + escortGap + escortW;
      g.fillStyle(0x12100c, 0.62);
      g.fillRoundedRect(x, y, exitW, slotH, 3);
      g.lineStyle(1.3, 0x8a8470, 0.75);
      g.strokeRoundedRect(x, y, exitW, slotH, 3);
      const midY = y + slotH / 2;
      const keyLp = this.hudLocal(x + padX, midY);
      this.exitHudSlot.key
        .setVisible(true)
        .setPosition(keyLp.x, keyLp.y)
        .setText("Q")
        .setColor("#a89868")
        .setStroke("#12100c", 3)
        .setFontSize("12px")
        .setAlpha(0.9);
      const nameLp = this.hudLocal(x + padX + this.exitHudSlot.key.width + 6, midY);
      const canDock = !!(pov.spec.dockable && this.remoteNearHost(pov));
      this.exitHudSlot.name
        .setVisible(true)
        .setPosition(nameLp.x, nameLp.y)
        .setText(canDock ? "DOCK" : "EXIT")
        .setColor(canDock ? "#3dff88" : "#f0d56a")
        .setStroke("#12100c", 3)
        .setFontSize("13px")
        .setAlpha(0.95);
    } else {
      this.exitHudSlot.key.setVisible(false);
      this.exitHudSlot.name.setVisible(false);
    }

    if (pov) {
      this.cmHudLabel?.setVisible(false);
      this.cmHudTime?.setVisible(false);
    } else {
      this.drawCountermeasureHud(y + slotH + crewPad + 2);
    }
    this.syncSpectrePrompt(y);
    // Hide unused rows if loadout shrank (shouldn't normally).
    for (let i = n; i < this.wpnHudSlots.length; i++) {
      const row = this.wpnHudSlots[i]!;
      row.key.setVisible(false);
      row.name.setVisible(false);
      row.ammo.setVisible(false);
      row.status.setVisible(false);
    }
  }

  drawCountermeasureHud(y: number): void {
    const g = this.wpnBar;
    const id = this.craftCmId();
    if (!this.cmHudLabel) {
      this.cmHudTime?.setVisible(false);
      return;
    }
    const spec = COUNTERMEASURES[id];
    const cd = this.cmCd;
    const cx = this.scale.width / 2;
    let activeT = 0;
    let activeMax = 0;
    let barCol = 0xc4a24a;
    if (id === "timewarp" && this.timewarpT > 0 && this.timewarpMax > 0) {
      activeT = this.timewarpT;
      activeMax = this.timewarpMax;
      barCol = 0x5ce8ff;
    } else if (id === "phase_cloak" && this.cloakT > 0) {
      activeT = this.cloakT;
      activeMax = spec.duration;
      barCol = 0xc8d4e8;
    } else if (id === "reactive_armor" && this.reactiveArmorT > 0) {
      activeT = this.reactiveArmorT;
      activeMax = spec.duration;
      barCol = 0xffb040;
    } else if (id === "smoke_screen" && this.smokeScreenT > 0) {
      activeT = this.smokeScreenT;
      activeMax = spec.duration;
      barCol = 0xa8a090;
    }
    const cooling = cd > 0;
    const frac = cooling
      ? Phaser.Math.Clamp(1 - cd / spec.cooldown, 0, 1)
      : activeT > 0
        ? Phaser.Math.Clamp(activeT / Math.max(0.05, activeMax), 0, 1)
        : 1;
    const label = `(E) ${spec.name}`;
    const timeS = activeT > 0
      ? `${activeT.toFixed(1)}s`
      : cooling
        ? `${cd.toFixed(1)}s`
        : "READY";
    const labelCol = activeT > 0 ? (id === "timewarp" || id === "emp" ? "#8ee8ff" : "#f0d56a") : cooling ? "#c4a24a" : "#e8b84a";
    const timeCol = activeT > 0 ? (id === "timewarp" || id === "emp" ? "#b8ffff" : "#f0d56a") : cooling ? "#e89a3a" : "#8a8470";
    const barW = 168;
    const barH = 5;
    const timeGap = 8;
    const labelGap = 10;
    this.cmHudTime.setText(timeS).setFontSize("11px");
    const timeW = this.cmHudTime.width;
    const rowW = barW + timeGap + timeW;
    const barX = cx - rowW / 2;
    const barY = y + 13;
    g.fillStyle(0x000000, 0.4);
    g.fillRoundedRect(barX - 2, barY - 2, barW + 4, barH + 4, 2);
    g.fillStyle(activeT > 0 ? 0x163048 : 0x1c1812, 0.88);
    g.fillRoundedRect(barX, barY, barW, barH, 2);
    if (frac > 0) {
      g.fillStyle(cooling ? 0xa07030 : barCol, 0.95);
      g.fillRoundedRect(barX, barY, Math.max(2, barW * frac), barH, 2);
    }
    const midY = barY + barH / 2;
    const labelLp = this.hudLocal(barX - labelGap, midY);
    this.cmHudLabel
      .setVisible(true)
      .setPosition(labelLp.x, labelLp.y)
      .setText(label)
      .setColor(labelCol)
      .setAlpha(1);
    const timeLp = this.hudLocal(barX + barW + timeGap, midY);
    this.cmHudTime
      .setVisible(true)
      .setPosition(timeLp.x, timeLp.y)
      .setColor(timeCol)
      .setAlpha(1);
  }

  /** Truncate a HUD label so `text` width stays within `maxW` (ellipsis). */
  fitHudLabel(text: Phaser.GameObjects.Text, label: string, maxW: number): string {
    text.setText(label);
    if (text.width <= maxW) return label;
    let t = label;
    while (t.length > 1) {
      t = t.slice(0, -1);
      text.setText(`${t}…`);
      if (text.width <= maxW) return `${t}…`;
    }
    return "…";
  }

  hvLine(spec: HvSpec): { text: string; done: boolean } {
    const u = this.units.find((q) => q.hv === spec.id);
    const done = !u || u.dead;
    if (done) return { text: `× ${spec.name}  KILL`, done: true };
    const look = this.camLookWorld();
    const dx = u.x - look.x;
    const dy = u.y - look.y;
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
    const inRing = (p: { x: number; y: number }) => Math.hypot(p.x - cx, p.y - cy) <= mapR;
    const mark = 0xe8b84a;
    for (const u of this.units) {
      if (u.dead) continue;
      const p = toMap(u.x, u.y);
      if (!inRing(p)) continue;
      this.miniGfx.fillStyle(u.hv ? 0xff5a3a : 0xc45c28, 1);
      this.miniGfx.fillCircle(p.x, p.y, u.hv ? 3.5 : 2);
    }
    for (const r of this.remotes) {
      if (r.detonate || r.dock) continue;
      const p = toMap(r.x, r.y);
      if (!inRing(p)) continue;
      // Yellow diamond — player drones / remotes only.
      this.drawMiniDiamond(p.x, p.y, 4.5, mark);
    }
    for (const shot of this.shots) {
      if (!shotShowsOnRadar(shot)) continue;
      const p = toMap(shot.x, shot.y);
      if (!inRing(p)) continue;
      // Player/friendly yellow; enemy red.
      const shotMark = shot.from === "enemy" ? 0xff5a3a : mark;
      this.drawMiniMissileTick(p.x, p.y, shot.angle, shotMark);
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

  /** Radar: yellow diamond for player remotes. */
  drawMiniDiamond(x: number, y: number, r: number, color: number): void {
    const g = this.miniGfx;
    g.fillStyle(color, 1);
    g.fillTriangle(x, y - r, x + r, y, x, y + r);
    g.fillTriangle(x, y - r, x, y + r, x - r, y);
  }

  /** Radar: heading tick for in-flight missiles (yellow friendly / red enemy). */
  drawMiniMissileTick(x: number, y: number, angle: number, color: number): void {
    const len = 5.5;
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    this.miniGfx.lineStyle(2, color, 1);
    this.miniGfx.lineBetween(x - ca * len * 0.35, y - sa * len * 0.35, x + ca * len * 0.65, y + sa * len * 0.65);
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
    if (!this.remoteView || !this.activeRemote()) {
      label.setVisible(false);
      return;
    }
    const host = this.heli;
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
    this.debugGfx.lineStyle(1.15, 0xd8c060, 0.72);
    for (const p of this.smokePuffs) {
      if (p.t <= 0) continue;
      strokeCircle(p.x, p.y, p.z, p.radius);
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
      for (const t of this.autoGunLabels) t.setVisible(false);
      return;
    }
    const ENEMY = 0xff5a4a;
    const FRIENDLY = 0x5ec8ff;
    const live = this.units.filter((u) => !u.dead);
    while (this.aiLabels.length < live.length) {
      const t = this.add
        .text(0, 0, "", {
          fontFamily: "Share Tech Mono, monospace",
          fontSize: "11px",
          color: "#ff8a7a",
        })
        .setOrigin(0.5, 1)
        .setDepth(Layer.FIELD + 9)
        .setStroke("#12100c", 3);
      this.aiLabels.push(t);
    }
    for (const t of this.aiLabels) t.setVisible(false);
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
        this.aiGfx.lineStyle(1.4, ENEMY, 0.85);
        this.aiGfx.lineBetween(ux, uy, target.x, target.y);
        this.aiGfx.fillStyle(ENEMY, 0.95);
        this.aiGfx.fillCircle(target.x, target.y, 3.2);
      }
      const label = this.aiLabels[i]!;
      label.setVisible(true);
      label.setColor("#ff8a7a");
      label.setPosition(ux, uy - 18);
      label.setText(u.aiState ?? "—");
    });

    // Crew / pilot gun arcs + acquire range (friendly).
    for (const t of this.autoGunLabels) t.setVisible(false);
    const h = this.heli;
    const dbgList = this.stationGunDebugList();
    while (this.autoGunLabels.length < dbgList.length) {
      const t = this.add
        .text(0, 0, "", {
          fontFamily: "Share Tech Mono, monospace",
          fontSize: "11px",
          color: "#7ad0ff",
        })
        .setOrigin(0.5, 1)
        .setDepth(Layer.FIELD + 9)
        .setStroke("#12100c", 3);
      this.autoGunLabels.push(t);
    }
    dbgList.forEach((dbg, i) => {
      let tip: { x: number; y: number };
      try {
        tip = this.gunTip(this.gunVisualIndexForSlot(dbg.slot, dbg.barrel));
      } catch {
        tip = { x: h.x, y: h.y };
      }
      const tipScr = worldToScreen(tip.x, tip.y, h.z);
      const range = dbg.range;
      // Per-barrel acquire ring (mount + heading bias).
      const originScr = worldToScreen(dbg.originX, dbg.originY, h.z);
      this.aiGfx.lineStyle(1.1, FRIENDLY, 0.22);
      this.aiGfx.strokeCircle(originScr.x, originScr.y, range * originScr.scale);
      // Traverse fire arc (same aimInStationArc rules as targeting).
      if (dbg.traverse) {
        this.strokeAutoGunTraverseArc(
          dbg.originX,
          dbg.originY,
          h.z,
          range,
          dbg.heading,
          dbg.traverse,
          FRIENDLY
        );
      }
      const aimEnd = worldToScreen(
        tip.x + Math.cos(dbg.aim) * range,
        tip.y + Math.sin(dbg.aim) * range,
        h.z
      );
      this.aiGfx.lineStyle(1.6, FRIENDLY, 0.9);
      this.aiGfx.lineBetween(tipScr.x, tipScr.y, aimEnd.x, aimEnd.y);
      this.aiGfx.fillStyle(FRIENDLY, 0.95);
      this.aiGfx.fillCircle(tipScr.x, tipScr.y, 2.8);
      this.aiGfx.fillCircle(aimEnd.x, aimEnd.y, 2.2);
      if (dbg.targetId != null) {
        const tgt = this.units.find((u) => !u.dead && u.id === dbg.targetId);
        if (tgt) {
          const tScr = worldToScreen(tgt.x, tgt.y, tgt.z);
          this.aiGfx.lineStyle(1.2, FRIENDLY, 0.85);
          this.aiGfx.lineBetween(tipScr.x, tipScr.y, tScr.x, tScr.y);
          this.aiGfx.fillStyle(FRIENDLY, 0.95);
          this.aiGfx.fillCircle(tScr.x, tScr.y, 3.2);
        }
      } else if (dbg.want != null) {
        const wantEnd = worldToScreen(
          tip.x + Math.cos(dbg.want) * range,
          tip.y + Math.sin(dbg.want) * range,
          h.z
        );
        this.aiGfx.lineStyle(1, FRIENDLY, 0.45);
        this.aiGfx.lineBetween(tipScr.x, tipScr.y, wantEnd.x, wantEnd.y);
      }
      const arcTag = dbg.traverse ? `  ${dbg.traverse.arc | 0}°` : "";
      const label = this.autoGunLabels[i]!;
      label
        .setVisible(true)
        .setColor("#7ad0ff")
        .setPosition(tipScr.x, tipScr.y - 14)
        .setText(`${dbg.state}  ${range | 0}m${arcTag}`);
    });

    // HOUND host-escort leash — inner (target) + outer (limit) around the remote.
    for (const r of this.remotes) {
      if (r.detonate || r.dock || !r.spec.hostEscort) continue;
      const { innerRadius, outerRadius } = r.spec.hostEscort;
      const scr = worldToScreen(r.x, r.y, r.z);
      const follow = this.hostEscortMode === "follow" && this.remoteView;
      const innerCol = follow ? 0x5ec8ff : 0x8a8470;
      const outerCol = follow ? 0xff9a3a : 0x8a8470;
      this.aiGfx.lineStyle(1.4, innerCol, follow ? 0.75 : 0.35);
      this.aiGfx.strokeCircle(scr.x, scr.y, innerRadius * scr.scale);
      this.aiGfx.lineStyle(1.6, outerCol, follow ? 0.85 : 0.4);
      this.aiGfx.strokeCircle(scr.x, scr.y, outerRadius * scr.scale);
    }
  }

  /**
   * Auto-gun dbg plus any pilot turret stations so AI debug always shows
   * traverse wedges + acquire range for every aimable gun.
   */
  stationGunDebugList(): MissionScene["autoGunDbg"] {
    const h = this.heli;
    const out = [...this.autoGunDbg];
    const seen = new Set(out.map((d) => `${d.slot}:${d.barrel}`));
    for (let slot = 0; slot < h.spec.sockets.length; slot++) {
      const socket = h.spec.sockets[slot]!;
      if (socket.class !== "turret") continue;
      const spec = this.loadout[slot];
      if (!spec) continue;
      const n = craftSocketBarrelCount(h.spec, slot);
      const acquire = this.autoStationRange(spec, slot);
      for (let b = 0; b < n; b++) {
        const key = `${slot}:${b}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const prefer = this.autoGunPreferHeading(slot, b);
        const origin = this.autoGunAcquireOrigin(slot, b, prefer, acquire);
        const aim = h.stationAim[slot]?.[b] ?? prefer;
        out.push({
          slot,
          barrel: b,
          range: acquire,
          originX: origin.x,
          originY: origin.y,
          heading: h.angle,
          traverse: this.stationTraverseForBarrel(slot, b),
          aim,
          want: prefer,
          targetId: null,
          state: `${craftCrewHudTag(socket) ?? socket.class.toUpperCase()}${n > 1 ? ` ${b + 1}` : ""}`,
        });
      }
    }
    return out;
  }

  /** World-projected traverse wedge for AI debug (matches aimInStationArc). */
  strokeAutoGunTraverseArc(
    ox: number,
    oy: number,
    oz: number,
    range: number,
    heading: number,
    traverse: StationTraverse,
    color = 0x5ec8ff
  ): void {
    const center = ((traverse.center ?? 0) * Math.PI) / 180;
    const half = ((traverse.arc * Math.PI) / 180) * 0.5;
    const a0 = heading + center - half;
    const a1 = heading + center + half;
    const steps = Math.max(12, Math.ceil((traverse.arc / 360) * 48));
    const rim: { x: number; y: number }[] = [];
    for (let i = 0; i <= steps; i++) {
      const a = a0 + ((a1 - a0) * i) / steps;
      if (!aimInStationArc(a, heading, traverse)) continue;
      const p = worldToScreen(ox + Math.cos(a) * range, oy + Math.sin(a) * range, oz);
      rim.push({ x: p.x, y: p.y });
    }
    if (rim.length < 2) return;
    const origin = worldToScreen(ox, oy, oz);
    this.aiGfx.fillStyle(color, 0.1);
    this.aiGfx.lineStyle(1.5, color, 0.75);
    this.aiGfx.beginPath();
    this.aiGfx.moveTo(origin.x, origin.y);
    for (const p of rim) this.aiGfx.lineTo(p.x, p.y);
    this.aiGfx.closePath();
    this.aiGfx.fillPath();
    this.aiGfx.strokePath();
    // Edge rays a bit stronger so the arc limits read clearly.
    const lo = rim[0]!;
    const hi = rim[rim.length - 1]!;
    this.aiGfx.lineStyle(1.8, color, 0.9);
    this.aiGfx.lineBetween(origin.x, origin.y, lo.x, lo.y);
    this.aiGfx.lineBetween(origin.x, origin.y, hi.x, hi.y);
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
    if (want && this.helpOpen) this.toggleHelp(false);
    this.exitOpen = want;
    this.exitRoot.setVisible(want);
    this.input.setDefaultCursor(want ? "default" : "none");
  }

  setupHelp(): void {
    // Craft preview reuses shared craft_*/fx_* textures; chrome is code UI (not catalog art).
    const w = this.scale.width;
    const h = this.scale.height;
    const panelW = Math.min(960, w - 40);
    const panelH = Math.min(620, h - 30);
    const halfW = panelW / 2;
    const halfH = panelH / 2;
    const shade = this.add
      .rectangle(0, 0, w, h, 0x080705, 0.78)
      .setInteractive();
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
    const helpComposite = craftComposite(helpCraft);
    this.helpCraftBody = this.add
      .image(craftX, -halfH + 160, helpComposite.body.tex)
      .setOrigin(helpComposite.body.origin.x, helpComposite.body.origin.y);
    this.helpCraftGunParts = helpComposite.guns;
    const helpGunSlots = craftGunSocketSlots(helpCraft);
    this.helpCraftGuns = this.helpCraftGunParts.map((part, i) => {
      const sock = helpCraft.sockets[helpGunSlots[i] ?? -1];
      const gunSc = (helpCraft.gunOverlayScale ?? 1) * (sock?.gunScale ?? 1);
      return this.add
        .image(craftX, -halfH + 160, part.tex)
        .setOrigin(part.origin.x, part.origin.y)
        .setRotation(part.heading ?? 0)
        .setScale(gunSc);
    });
    this.helpCraftRotorParts = helpComposite.rotors;
    this.helpCraftRotors = this.helpCraftRotorParts.map((part) => {
      const rotor = this.add
        .image(craftX, -halfH + 160, part.tex)
        .setOrigin(part.origin.x, part.origin.y);
      this.tweens.add({
        targets: rotor,
        rotation: (part.spinSign ?? -1) * Math.PI * 2,
        duration: craftRotorPreviewSpinMs(helpCraft),
        repeat: -1,
        ease: "Linear",
      });
      return rotor;
    });
    this.helpCraftExhaustMounts = craftExhaustMounts(helpCraft);
    this.helpCraftExhaustGlows = this.helpCraftExhaustMounts.map((_, exhaustI) => {
      const glow = this.add
        .image(craftX, -halfH + 160, "fx_exhaust_glow")
        .setOrigin(0.5, 0)
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
        ...this.helpCraftGuns.filter((_, i) => this.helpCraftGunParts[i]?.layer !== "above"),
        ...this.helpCraftExhaustGlows,
        ...this.helpCraftGuns.filter((_, i) => this.helpCraftGunParts[i]?.layer === "above"),
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
      .text(w - 16, 12, "[ H ]  HELP", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "13px",
        color: "#e8b84a",
        backgroundColor: "#12100c",
        padding: { x: 8, y: 5 },
      })
      .setOrigin(1, 0)
      .setDepth(Layer.HUD + 200)
      .setScrollFactor(0);
    this.syncHelp();
  }

  toggleHelp(force?: boolean): void {
    const want = force ?? !this.helpOpen;
    if (want && (this.mapWant || this.mapBlend > 0.02 || this.over)) return;
    if (want && this.debugOpen) this.toggleDebugMenu(false);
    if (want && this.editOpen) this.toggleReliefEditor(false);
    this.helpOpen = want;
    if (want) this.rebuildMissionTips();
    this.helpRoot.setVisible(want);
    this.input.setDefaultCursor(want ? "default" : "none");
    this.syncHelp();
  }

  nudgeHelp(dir: number): void {
    if (!this.helpOpen) return;
    const n = Math.max(1, this.missionTips.length);
    this.helpPage = (this.helpPage + dir + n) % n;
    this.syncHelp();
  }

  /** Tips for this sortie: craft + loadout + live enemies when known. */
  rebuildMissionTips(): void {
    const enemies = this.units.length
      ? [...new Set(this.units.filter((u) => !u.dead).map((u) => u.kind))]
      : undefined;
    this.missionTips = tipsForKnown({
      ...tipKnownFromSelection(enemies),
      crafts: [this.heli?.spec.kind ?? craftOf().kind],
      weapons: this.loadout.map(wpnIdOf),
      cms: [craftCountermeasure(this.heli?.spec.countermeasure ?? craftOf().countermeasure)],
    });
    if (!this.missionTips.length) {
      this.missionTips = tipsForKnown({ forceMixes: [missionOf().profile.forceMix] });
    }
    this.helpPage = Phaser.Math.Clamp(this.helpPage, 0, Math.max(0, this.missionTips.length - 1));
  }

  syncHelp(): void {
    if (!this.helpBody || !this.helpCounter) return;
    const craft = craftOf();
    if (this.helpCraftBody.texture.key !== craft.body) {
      this.helpCraftBody.setTexture(craft.body);
      const origin = craftOrigin(craft);
      this.helpCraftBody.setOrigin(origin.x, origin.y);
    }
    const previewScale = craftPreviewFitScale(
      this.helpCraftBody.width,
      this.helpCraftBody.height,
      170,
      165
    );
    this.helpCraftBody.setScale(previewScale);
    const gunSlots = craftGunSocketSlots(craft);
    this.helpCraftGuns.forEach((gun, gunI) => {
      const part = this.helpCraftGunParts[gunI]!;
      const at = spriteUvPos(this.helpCraftBody, part.mount.x, part.mount.y);
      const sock = craft.sockets[gunSlots[gunI] ?? -1];
      const gunSc =
        (craft.gunOverlayScale ?? 1) * (sock?.gunScale ?? 1) * this.helpCraftBody.scaleX;
      gun
        .setPosition(at.x, at.y)
        .setRotation(part.heading ?? 0)
        .setScale(gunSc)
        .setVisible(true);
    });
    this.helpCraftRotors.forEach((rotor, rotorI) => {
      const part = this.helpCraftRotorParts[rotorI]!;
      const at = spriteUvPos(this.helpCraftBody, part.mount.x, part.mount.y);
      const sc = craftCompositePartScale(part, rotor.width, this.helpCraftBody.scaleX);
      const along = craftRotorAlongScale(craft);
      if (along < 0.999) {
        const wrap = this.ensureTiltWrap(rotor);
        wrap.setPosition(at.x, at.y).setScale(sc, sc * along).setVisible(true);
        rotor.setPosition(0, 0).setScale(1).setVisible(true);
      } else {
        this.unwrapTilt(rotor);
        rotor.setPosition(at.x, at.y).setScale(sc);
      }
    });
    this.helpCraftExhaustGlows.forEach((glow, exhaustI) => {
      const mount = this.helpCraftExhaustMounts[exhaustI]!;
      const at = spriteUvPos(this.helpCraftBody, mount.x, mount.y);
      const glowSc = craftPreviewExhaustScale(this.helpCraftBody.scaleX);
      glow.setPosition(at.x, at.y).setScale(glowSc.x, glowSc.y);
    });
    this.helpCraftName.setText(craft.fullName.toUpperCase());
    const stats = [
      { label: "SPEED", value: craft.maxSpeed, max: Math.max(...allCrafts().map((c) => c.maxSpeed)), display: String(craft.maxSpeed) },
      { label: "AGILITY", value: craftAgility(craft), max: 1, display: `${Math.max(1, Math.round(craftAgility(craft) * 8))}/8` },
      { label: "SIZE", value: craft.sizeM, max: Math.max(...allCrafts().map((c) => c.sizeM)), display: `${craft.sizeM.toFixed(1)}m` },
      { label: "ARMOR", value: craft.health, max: Math.max(...allCrafts().map((c) => c.health)), display: String(craft.health) },
    ];
    const weapons = playerLoadoutFromSockets(craft.sockets);
    const cm = COUNTERMEASURES[craftCountermeasure(craft.countermeasure)];
    const loadoutLines = [
      "",
      "LOADOUT",
      ...weapons.map((w, i) => `${i + 1}  ${craftLoadoutLabel(craft, i, w.fullName)}`),
      `E  ${cm.name}  ${countermeasureTimingLabel(cm)}`,
    ];
    this.helpCraftStats.setText(
      [
        ...stats.map((stat) => `${stat.label.padEnd(8)} ${stat.display}`),
        `ROLE    ${craft.role.toUpperCase()}`,
        ...loadoutLines,
      ].join("\n")
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
    this.helpBody.setText(this.missionTips[this.helpPage]?.text ?? "");
    this.helpCounter.setText(
      `${this.helpPage + 1} / ${Math.max(1, this.missionTips.length)}   ← →`
    );
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
      for (const t of this.autoGunLabels) t.setVisible(false);
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
    const key = this.showHeightMap ? "map_height" : "map_terrain";
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
    this.thermalManual = !this.thermalManual;
    this.applyThermalMode();
  }

  /** Craft-owned thermal look (sensor cams + T share this; linger must not override it). */
  craftSensorPalette(): ThermalPalette {
    return this.heli.spec.sensorPalette ?? "white_hot";
  }

  /** True when a remote or seeker cam wants thermal (palette always craft thermal). */
  activeSensorThermal(): boolean {
    const remote = this.activeRemote();
    if (remote?.spec.thermal && this.remoteCamT > 0.2) return true;
    return !!this.activeSensorShot();
  }

  /** Active Spike / Spectre / warp sensor projectile, preferring the selected weapon. */
  activeSensorShot(): Shot | undefined {
    const selected = this.loadout[this.heli.weapon];
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
      this.syncSmokePuffSprites();
      this.applyTestFxActive();
      this.applyThermalFxBlendMode();
    } else {
      setThermalPipeline(cam, false);
      this.thermalFx?.reset();
      this.syncAllThermalWreckMarks();
      this.syncSmokePuffSprites();
      this.applyTestFxActive();
      this.applyThermalFxBlendMode();
    }
    this.syncDebugMenu();
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

  setupTestPostFx(): void {
    this.applyTestFxActive();
  }

  toggleTestFx(): void {
    this.fxOn = !this.fxOn;
    persistedFxOn = this.fxOn;
    if (!this.fxOn) this.fxBarrelPulse = 0;
    this.applyTestFxActive();
    this.syncTestFxHud();
    this.syncDebugMenu();
  }

  applyTestFxActive(): void {
    const cam = this.cameras.main;
    // Phaser bloom blends with mix(scene, bloom*strength, 0.5). Strength 0 ⇒ mix with black
    // ⇒ a permanent faded frame. setActive(false) is unreliable, so remove FX entirely when off.
    const wantBloom = this.fxOn;
    const wantBarrel = this.fxOn;
    if (wantBloom) {
      if (this.fxBloom) {
        cam.postFX.remove(this.fxBloom);
        this.fxBloom = undefined;
      }
      if (this.thermalOn) {
        // Cheap neutral bloom on the thermal image — white, low strength, single blur pass.
        this.fxBloom = cam.postFX.addBloom(0xffffff, 1.1, 1.1, 0.55, 0.32, 1);
      } else {
        this.fxBloom = cam.postFX.addBloom(0xffe6b0, 1.1, 1.1, 1.0, 0.85, 3);
      }
    } else if (this.fxBloom) {
      cam.postFX.remove(this.fxBloom);
      this.fxBloom = undefined;
    }
    if (wantBarrel) {
      if (!this.fxBarrel) {
        this.fxBarrel = cam.postFX.addBarrel(1);
      } else {
        this.fxBarrel.setActive(true);
        this.fxBarrel.amount = 1;
      }
    } else if (this.fxBarrel) {
      cam.postFX.remove(this.fxBarrel);
      this.fxBarrel = undefined;
    }
  }

  pulseTestBarrel(amount: number): void {
    if (!this.fxBarrel || !this.fxOn) return;
    this.fxBarrelPulse = Math.max(this.fxBarrelPulse, Phaser.Math.Clamp(amount, 0, 0.28));
  }

  tickTestPostFx(dt: number): void {
    if (!this.fxOn || !this.fxBarrel) return;
    if (this.fxBarrelPulse > 0.002) {
      this.fxBarrel.amount = 1 + this.fxBarrelPulse * 0.55;
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
    });
    this.debugRows = DEBUG_MENU_ITEMS.map((item, i) => {
      const t = this.add
        .text(12, 38 + i * rowH, "", {
          fontFamily: "Share Tech Mono, monospace",
          fontSize: "13px",
          color: "#f0e6c8",
        });
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
      .setVisible(false);
    const camLabels = ["PITCH", "EYE", "ZOOM0", "PRESET"];
    this.debugCamRows = camLabels.map((_label, i) => {
      const t = this.add
        .text(12, 34 + i * 22, "", {
          fontFamily: "Share Tech Mono, monospace",
          fontSize: "13px",
          color: "#f0e6c8",
        })
        .setInteractive({ useHandCursor: true })
        .setVisible(false);
      t.on("pointerdown", () => {
        if (!this.debugCamOpen) return;
        this.debugCamIdx = i;
        this.activateDebugCamRow();
      });
      return t;
    });
    const kinds = allKinds();
    this.debugSpawnRows = kinds.map((_kind, i) => {
      const t = this.add
        .text(12, 34 + i * 18, "", {
          fontFamily: "Share Tech Mono, monospace",
          fontSize: "13px",
          color: "#f0e6c8",
        })
        .setInteractive({ useHandCursor: true })
        .setVisible(false);
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
    });
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
      }).setOrigin(0.5, 0);
      this.editChips.push(img);
      this.editChipFrames.push(frame);
      this.editRoot.add([frame, img, lab]);
    });
    this.editReadout = this.add.text(16, 112, "", {
      fontFamily: "Share Tech Mono, monospace",
      fontSize: "11px",
      color: "#c8c0a8",
      lineSpacing: 3,
    });
    this.editInkBtn = this.add
      .text(16, 176, "", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "12px",
        color: "#e8b84a",
      })
      .setInteractive({ useHandCursor: true });
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
    paintHeightMapRect(this.heightMapCanvas, this.world.height, d.x0, d.y0, d.x1, d.y1, this.world.roads);
    (this.textures.get("map_terrain") as Phaser.Textures.CanvasTexture).refresh();
    (this.textures.get("map_height") as Phaser.Textures.CanvasTexture).refresh();
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
    this.bindHud(this.miniMask);
    const chrome: (Phaser.GameObjects.GameObject & { x: number; y: number })[] = [
      this.miniBg,
      this.miniTerrain,
      this.miniWrecks,
      this.miniGfx,
      this.hud,
      this.fxHud,
      this.fpsHud,
      this.perfHud,
      this.liftPrompt,
      this.spectrePrompt,
      this.hvHud,
      ...this.hvRows,
      this.playerHud,
      this.heliHudWireSh,
      this.heliHudWire,
      this.wpnBar,
      ...this.wpnHudSlots.flatMap((s) => [s.key, s.name, s.ammo, s.status]),
      this.exitHudSlot.key,
      this.exitHudSlot.name,
      this.escortHudSlot.key,
      this.escortHudSlot.name,
      this.cmHudLabel,
      this.cmHudTime,
      this.hvGfx,
      ...this.hvArrowLabels,
      this.parentArrowLabel,
      this.lockArrowGfx,
      this.lockHudTxt,
      this.lockInbdHudTxt,
      this.helpButton,
      this.exitButton,
    ];
    for (const go of chrome) this.adoptHud(go);
    this.bindHud(this.hurtVignette);
    this.bindHud(this.hurtVignettePulse);
    this.hurtVignette.setPosition(0, 0);
    this.hurtVignettePulse.setPosition(0, 0);
    this.bindHud(this.reticle);
    this.bindHud(this.reticleMark);
    this.bindHud(this.mapLabel);
    // Laser sight is world-depth under the hull (not HUD chrome).
    this.hudSet.delete(this.sight);
    this.sight.cameraFilter = this.hudCam.id | this.fieldHudCam.id;
    // World-anchored tracking HUD: lock boxes, unit HP — not thermalized.
    for (const go of [this.lockGfx, this.lockTxt, this.lockInbdTxt, this.hpGfx, this.spectreArmedTxt]) {
      this.bindFieldHud(go);
    }
    // TOW wire / Tesla / Refractor / energy ribbons stay on the main cam (world depth).
    this.hudSet.delete(this.towWireGfx);
    this.towWireGfx.cameraFilter = this.hudCam.id | this.fieldHudCam.id;
    this.hudSet.delete(this.remoteAntennaGfx);
    this.remoteAntennaGfx.cameraFilter = this.hudCam.id | this.fieldHudCam.id;
    this.hudSet.delete(this.teslaGfx);
    this.teslaGfx.cameraFilter = this.hudCam.id | this.fieldHudCam.id;
    this.hudSet.delete(this.energyTrailGfx);
    this.energyTrailGfx.cameraFilter = this.hudCam.id | this.fieldHudCam.id;
    this.hudSet.delete(this.refractorGfx);
    this.refractorGfx.cameraFilter = this.hudCam.id | this.fieldHudCam.id;
    // Parallax clouds: main cam only, above craft (depth set at spawn).
    const cloudFilter = this.hudCam.id | this.fieldHudCam.id;
    for (const c of this.planeClouds) c.im.cameraFilter = cloudFilter;
    const markHudTree = (obj: Phaser.GameObjects.GameObject) => {
      this.bindHud(obj);
      const list = (obj as Phaser.GameObjects.Container).list;
      if (list) for (const ch of list) markHudTree(ch);
    };
    markHudTree(this.debugRoot);
    markHudTree(this.helpRoot);
    markHudTree(this.exitRoot);
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

  /** Keep field HUD camera aligned with the thermalized main view. */
  syncFieldHudCam(): void {
    if (!this.fieldHudCam) return;
    const main = this.cameras.main;
    this.fieldHudCam.setScroll(main.scrollX, main.scrollY);
    this.fieldHudCam.setZoom(main.zoom);
    if (this.fieldHudCam.width !== main.width || this.fieldHudCam.height !== main.height) {
      this.fieldHudCam.setSize(main.width, main.height);
    }
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
    if (craftCameraEdgeLocked(this.heli.spec)) return;

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
    const look = craftCloudParallax(this.heli.spec);
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
      const hx = this.heli.x * sf;
      const hy = this.heli.y * sf;
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
    const show = this.mapBlend < 0.45 && this.heli.phase !== "dead";
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
    const h = this.heli;
    const hostZoom = this.craftPlayZoom(h.spec, h.z, h.vx, h.vy);
    const remote = this.activeRemote();
    if (!remote || this.remoteCamT < 0.001 || !remote.spec.craftLook) return hostZoom;
    const hull = craftOf(remote.spec.craftLook);
    const remZoom = this.craftPlayZoom(hull, remote.z, remote.vx, remote.vy);
    return Phaser.Math.Linear(hostZoom, remZoom, this.remoteCamT);
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
    if (craftCameraEdgeLocked(this.heli.spec)) {
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
      if (craftCameraEdgeLocked(this.heli.spec)) {
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
    if (this.heli.phase !== "dead" && this.stingerT > 0 && this.stingerTarget && !this.stingerReleased) {
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
        if (this.remoteView) {
          const drone = this.activeRemote();
          if (drone) {
            const seek = this.remoteLookOffset(drone);
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
    if (this.heli.phase === "dead") {
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
    this.tickRemoteCamBlend(dt);
    const remote = this.activeRemote();
    const sensor = this.activeSensorShot();
    if (sensor) {
      const hx = this.heli.x;
      const hy = this.heli.y;
      const p = this.pointerScreen();
      const aim = screenToWorldAtZ(p.x, p.y, this.heli.z);
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
    const pointerAtFocus = screenToWorldAtZ(p.x, p.y, this.heli.z);
    // While remote POV is active, look pull follows the HUD weapon (not host slot).
    const wpnSpec =
      remote && this.remoteCamT > 0.2
        ? this.hudLoadout()[this.hudWeapon()]!
        : this.loadout[this.heli.weapon]!;
    const lookPlane =
      remote && this.remoteCamT > 0.2 && remote.spec.craftLook
        ? craftControlScheme(craftOf(remote.spec.craftLook)) === "plane"
        : craftControlScheme(this.heli.spec) === "plane";
    const look = planeLookCam(wpnSpec, lookPlane);
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
      ox += (pov.x - this.heli.x) * 0.82;
      oy += (pov.y - this.heli.y) * 0.82;
      rate = 5.4;
    } else if (this.povCamLookHold > 0) {
      ox += (this.povCamLookX - this.heli.x) * 0.82;
      oy += (this.povCamLookY - this.heli.y) * 0.82;
      rate = 5.4;
    } else if (this.sensorLingerT <= 0) {
      this.sensorLingerPalette = null;
    }
    if (remote && this.remoteCamT > 0.001) {
      const seek = this.remoteLookOffset(remote);
      ox = Phaser.Math.Linear(ox, seek.x, this.remoteCamT);
      oy = Phaser.Math.Linear(oy, seek.y, this.remoteCamT);
      rate = Phaser.Math.Linear(rate, 3.2, this.remoteCamT);
    }
    const k = 1 - Math.exp(-rate * dt);
    this.lookCamX = Phaser.Math.Linear(this.lookCamX, ox, k);
    this.lookCamY = Phaser.Math.Linear(this.lookCamY, oy, k);
    this.syncProjectionPose();
  }

  setHudVisible(on: boolean): void {
    this.hud.setVisible(on);
    this.liftPrompt.setVisible(on && this.heli.phase === "ready");
    this.spectrePrompt.setVisible(on && !!this.pilotingRemote() && !this.povHudRemote());
    this.hvHud.setVisible(on);
    for (const t of this.hvRows) t.setVisible(on);
    this.wpnHud.setVisible(on);
    this.wpnBar.setVisible(on);
    this.cmHudLabel.setVisible(on);
    this.cmHudTime.setVisible(on);
    for (const s of this.wpnHudSlots) {
      s.key.setVisible(on);
      s.name.setVisible(on);
      s.ammo.setVisible(on);
      // status visibility is owned by drawWeaponHud (auto stations only)
      if (!on) s.status.setVisible(false);
    }
    this.exitHudSlot.key.setVisible(false);
    this.exitHudSlot.name.setVisible(false);
    this.escortHudSlot.key.setVisible(false);
    this.escortHudSlot.name.setVisible(false);
    this.playerHud.setVisible(on);
    this.heliHudWireSh.setVisible(on);
    this.heliHudWire.setVisible(on);
    this.hurtVignette.setVisible(on);
    this.hurtVignettePulse.setVisible(on);
    this.miniGfx.setVisible(on);
    this.miniBg.setVisible(on);
    this.miniTerrain.setVisible(on);
    this.miniWrecks.setVisible(on && !this.showHeightMap);
    this.hudRoot.setVisible(on);
    if (this.editRoot) this.editRoot.setVisible(this.editOpen && (on || this.mapBlend > 0.12));
    this.hpGfx.setVisible(on);
    if (!on) this.spectreArmedTxt?.setVisible(false);
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
      this.lockGfx.setVisible(false);
      this.lockGfx.clear();
      this.lockTxt.setVisible(false);
      this.lockInbdTxt.setVisible(false);
      for (const t of this.gpsDistTxt) if (t.active) t.setVisible(false);
      for (const t of this.callStrikeEtaTxt) if (t.active) t.setVisible(false);
      this.lockHudTxt.setVisible(false);
      this.lockInbdHudTxt.setVisible(false);
      this.lockArrowGfx.clear();
      this.playerHud.clear();
      this.hurtVignette.setVisible(false).setAlpha(0);
      this.hurtVignettePulse.setVisible(false).setAlpha(0);
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
      const ratio = Phaser.Math.Clamp(r.life / Math.max(0.05, r.lifeMax), 0, 1);
      const filled = ratio > 0.001 ? Math.min(segs, Math.max(1, Math.ceil(ratio * segs - 1e-6))) : 0;
      const low = filled <= 1;
      const col = low ? 0xff2a18 : filled >= 3 ? 0x5caa3a : 0xe8c44a;
      const pulse = low ? 0.38 + 0.62 * (0.5 + 0.5 * Math.sin(this.time.now * 0.022)) : 1;
      const totalW = bodyW + nubW;
      const x = at.x - totalW / 2;
      const y = at.y - r.spec.height * zs - 22 * zs;
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
    const armed = this.spectreDetonateArmed();
    const drone = armed ? this.activeRemote() : undefined;
    if (!drone || !cameraPointVisible(drone.z, drone.y) || this.mapView || this.over) {
      this.spectreArmedTxt.setVisible(false);
    } else {
      const at = worldToScreen(drone.x, drone.y, drone.z);
      const zs = at.scale;
      const blink = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(this.time.now * 0.014));
      this.spectreArmedTxt
        .setVisible(true)
        .setText("ARMED")
        .setPosition(at.x, at.y - drone.spec.height * zs - 34 * zs)
        .setScale(zs)
        .setAlpha(blink)
        .setDepth(worldDepth(drone.z, ZOff.body + 2, drone.y));
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
    const bake = this.heliHudWireBake;
    const ox = bake.pivot.x;
    const oy = bake.pivot.y;
    const drawW = bake.w * this.heliHudWireScale;
    const drawH = bake.h * this.heliHudWireScale;
    // Square panel matching minimap diameter; HP bar on the left, wire centered in the rest.
    const margin = 18;
    const panel = 180;
    const panelRight = this.scale.width - margin;
    const panelBottom = this.scale.height - margin;
    const panelLeft = panelRight - panel;
    const panelTop = panelBottom - panel;
    const barW = 9;
    const barGap = 12;
    const barPad = 3;
    const barX = panelLeft + barPad;
    const barY = panelTop + barPad;
    const barH = panel - barPad * 2;
    const boxX = barX - barPad;
    const boxY = barY - barPad;
    const boxW = barW + barPad * 2;
    const boxH = barH + barPad * 2;

    const restLeft = barX + barW + barGap;
    const restRight = panelRight;
    const restTop = panelTop;
    const restBottom = panelBottom;
    const areaCx = (restLeft + restRight) / 2;
    const areaCy = (restTop + restBottom) / 2;
    const wireX = areaCx - drawW / 2 + ox * drawW;
    const wireY = areaCy - drawH / 2 + oy * drawH;

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

  /** Top-right stack: [ESC]/[H] → OBJECTIVES → FPS. */
  layoutUpperRightHud(): void {
    const right = this.scale.width - 16;
    let y = 12;
    const gap = 8;
    const helpLp = this.hudLocal(right, y);
    this.helpButton.setOrigin(1, 0).setPosition(helpLp.x, helpLp.y);
    const exitX = right - this.helpButton.width - gap;
    const exitLp = this.hudLocal(exitX, y);
    this.exitButton.setOrigin(1, 0).setPosition(exitLp.x, exitLp.y);
    y += Math.max(this.helpButton.height, this.exitButton.height) + 12;

    const hvLp = this.hudLocal(right, y);
    this.hvHud.setOrigin(1, 0).setPosition(hvLp.x, hvLp.y);
    y += 20;
    let rowCount = 0;
    for (let i = 0; i < this.hvRows.length; i++) {
      const row = this.hvRows[i]!;
      if (!row.visible) continue;
      const lp = this.hudLocal(right, y + rowCount * 17);
      row.setOrigin(1, 0).setPosition(lp.x, lp.y);
      rowCount++;
    }
    y += Math.max(1, rowCount) * 17 + 10;

    const fpsLp = this.hudLocal(right, y);
    this.fpsHud.setOrigin(1, 0).setPosition(fpsLp.x, fpsLp.y);
  }

  drawHurtVignette(hp: number): void {
    const blood = this.hurtVignette;
    const cracks = this.hurtVignettePulse;
    const w = this.scale.width;
    const h = this.scale.height;
    if (this.heli.phase === "dead") {
      // Keep cockpit damage visible after death, desaturated.
      blood
        .setVisible(true)
        .setPosition(0, 0)
        .setDisplaySize(w, h)
        .setTint(0x8a8a8a)
        .setAlpha(0.58)
        .setBlendMode(Phaser.BlendModes.MULTIPLY);
      cracks
        .setVisible(true)
        .setPosition(0, 0)
        .setDisplaySize(w, h)
        .setTint(0x6e6e6e)
        .setAlpha(0.62)
        .setBlendMode(Phaser.BlendModes.NORMAL);
      return;
    }
    blood.clearTint().setBlendMode(Phaser.BlendModes.ADD);
    cracks.clearTint().setBlendMode(Phaser.BlendModes.NORMAL);
    if (hp >= 0.32) {
      blood.setVisible(false).setAlpha(0);
      cracks.setVisible(false).setAlpha(0);
      return;
    }
    const hurt = Phaser.Math.Clamp((0.32 - hp) / 0.32, 0, 1);
    // Gentle breath — never fully offs the blood pulse layer.
    const beat = 0.82 + 0.18 * Math.sin(this.time.now * 0.0042);
    blood
      .setVisible(true)
      .setPosition(0, 0)
      .setDisplaySize(w, h)
      .setAlpha((0.42 + hurt * 0.45) * beat);
    cracks
      .setVisible(true)
      .setPosition(0, 0)
      .setDisplaySize(w, h)
      .setAlpha(0.55 + hurt * 0.4);
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
      if (this.remoteView) {
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
      this.hideAimChrome();
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
    this.hideAimChrome();
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

  /** Hide reticle + laser when the bird is dead / mission over. */
  hideAimChrome(): void {
    this.reticle?.setVisible(false);
    this.reticleMark?.setVisible(false);
    this.reticleMark?.clear();
    this.sight?.setVisible(false);
    this.sight?.clear();
  }

  /** Camera follow point: mid(last live, hulk) when dead, else heli. */
  playerCamAnchor(): { x: number; y: number; z: number } {
    if (this.heli.phase === "dead") {
      const hulk = this.playerCrashDebris;
      const cx = hulk?.x ?? this.heli.x;
      const cy = hulk?.y ?? this.heli.y;
      const cz = hulk?.z ?? this.heli.z;
      return {
        x: (this.playerDeathLiveX + cx) * 0.5,
        y: (this.playerDeathLiveY + cy) * 0.5,
        z: (this.playerDeathLiveZ + cz) * 0.5,
      };
    }
    return { x: this.heli.x, y: this.heli.y, z: this.heli.z };
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
  return s.from === "enemy";
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

/** Legacy explode() kind tag for HE vs kinetic FX when payload is absent. */
function shotKindForExplode(s: Shot): ShotKind {
  if (shotIsGunOrBeam(s)) return s.beh?.launch.mode === "beam" ? "beam" : "cannon";
  if (s.homePlayer || s.motor != null) return "lock-on-missile";
  if (s.beh?.exhaust?.kind === "particles" && s.beh.exhaust.smoke === "rocket") return "rocket";
  if (s.povCam || s.wire) return "guided-missile";
  return "rocket";
}

/** Bomb / missile / rocket ground scars get embers; guns and beams do not. */
function shotWantsEmberCrater(shot: Shot | undefined, kind: ShotKind): boolean {
  if (shot) {
    if (shotIsGunOrBeam(shot)) return false;
    const mode = shot.beh?.launch.mode;
    if (mode === "beam") return false;
    if (mode === "drop" || mode === "kick_motor") return true;
    if (shot.beh?.guidance || shot.motor != null) return true;
    if (shot.beh?.exhaust) return true;
    const look = shot.look ?? shot.beh?.art.look ?? "";
    if (/bomb|rocket|missile|photon|mini_rocket/i.test(look)) return true;
    if (shot.st?.bomblet && !!shot.beh?.payload?.detonate) return true;
    return false;
  }
  return kind === "rocket" || kind === "lock-on-missile" || kind === "guided-missile";
}

/** Minimal behavior snapshot so enemy trails / gravity read the new exhaust model. */
/** Minimap: missiles / rockets / seekers — not gun tracers or beams. */
function shotShowsOnRadar(s: Shot): boolean {
  // Call-strike shells are tagged bomblet to skip lock HUD, but should still blip.
  if (s.st?.callStrikeMarkId != null) return true;
  if (s.st?.bomblet) return false;
  if (s.beh?.launch.mode === "beam") return false;
  if (s.beh?.payload?.remote) return false;
  if (s.beh?.guidance) return true;
  if (s.motor != null || s.cruise != null) return true;
  if (s.beh?.exhaust) return true;
  const look = s.look ?? s.beh?.art.look ?? "";
  return /missile|guided|rocket|aam|photon|mini_rocket|artillery/i.test(look);
}

function enemyShotBeh(wpn: {
  look: ShotLook;
  scale: number;
  trailScale?: number;
  kind: ShotKind;
  speed: number;
  dmg: number;
  blast: number;
}): ShotBehavior | undefined {
  const rocket = wpn.kind === "rocket" || (wpn.trailScale != null && wpn.kind !== "cannon");
  const seek = wpn.kind === "lock-on-missile";
  if (!rocket && !seek && wpn.trailScale == null) {
    // Guns: no exhaust — shotIsGunOrBeam uses !exhaust
    return {
      art: { look: wpn.look, scale: wpn.scale, face: "velocity" },
      cam: { reticle: "round", look: { pull: 0.2, max: 88, rate: 10 } },
      control: { mode: "click" },
      launch: { mode: "muzzle", inheritMomentum: 0 },
      payload: wpn.kind === "cannon" ? { penetration: 1 } : { detonate: { look: "fire" } },
      cruiseSpeed: wpn.speed,
      dmg: wpn.dmg,
      blast: wpn.blast,
    };
  }
  return {
    art: { look: wpn.look, scale: wpn.scale, face: seek || rocket ? "heading" : "velocity" },
    cam: { reticle: "round", look: { pull: 0.2, max: 88, rate: 10 } },
    control: { mode: "click" },
    launch: { mode: "muzzle", inheritMomentum: 0 },
    payload: { detonate: { look: "fire" } },
    exhaust:
      wpn.trailScale != null
        ? {
            kind: "particles",
            size: wpn.trailScale,
            fire: "burn",
            ...(wpn.kind === "rocket" ? { fireFor: 0.1 } : {}),
            smoke: wpn.kind === "rocket" ? "rocket" : "linger",
            ...(wpn.kind === "rocket" ? { align: "heading" as const } : {}),
          }
        : seek
          ? { kind: "particles", size: 0.55, fire: "burn", smoke: "linger" }
          : undefined,
    cruiseSpeed: wpn.speed,
    dmg: wpn.dmg,
    blast: wpn.blast,
  };
}

function shotTrailScale(s: Shot): number {
  const vis = s.scale ?? 1;
  const ex = s.beh?.exhaust;
  if (!ex || exhaustIsEnergy(ex)) return 0;
  if (ex.kind === "particles" || ex.kind === "signalFlare") return vis * (ex.size ?? 1);
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
  const x = sx * t + rx * (1 - t);
  const y = sy * t + ry * (1 - t);
  const z = sz * t + rz * (1 - t);
  const n = Math.hypot(x, y, z) || 1;
  return { x: x / n, y: y / n, z: z / n };
}

/**
 * Sample a unit direction inside a cone of half-angle `half` about (bx,by,bz).
 * Density pdf ∝ exp(k · align) truncated to the cone; `edge` is that CDF value
 * (0 = rim, 1 = forward) so callers can share the same falloff for speed.
 */
function coneDir(
  bx: number,
  by: number,
  bz: number,
  half: number,
  k = 4
): { x: number; y: number; z: number; align: number; edge: number } {
  const len = Math.hypot(bx, by, bz) || 1;
  const sx = bx / len;
  const sy = by / len;
  const sz = bz / len;
  const cosMin = Math.cos(Phaser.Math.Clamp(half, 1e-3, Math.PI));
  const kk = Math.max(1e-4, k);
  const edge = Math.random();
  const align = Math.log(
    Math.exp(kk * cosMin) + edge * (Math.exp(kk) - Math.exp(kk * cosMin))
  ) / kk;
  const sinT = Math.sqrt(Math.max(0, 1 - align * align));
  const azi = Math.random() * Math.PI * 2;
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
  return { x: x / n, y: y / n, z: z / n, align, edge };
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

/** Shared rail / kick-motor / Hydra boost cruise ramp for powered player shots. */
function motorizedSpeed(s: Shot, beh: NonNullable<Shot["beh"]>, dt: number): number {
  const cur = Math.hypot(s.vx, s.vy, s.vz);
  if (beh.launch.mode === "kick_motor" && beh.launch.acceleration === 0) {
    s.cruise = beh.cruiseSpeed;
    return beh.cruiseSpeed;
  }
  const launch = beh.launch;
  if (launch.mode === "muzzle" && launch.acceleration != null) {
    const burnT = launch.burnTime;
    const age = s.st?.age ?? 0;
    // Boost-then-coast rockets: hold speed after motor burnout.
    if (burnT != null && age >= burnT) {
      s.cruise = beh.cruiseSpeed;
      return cur;
    }
    const spd = Math.min(beh.cruiseSpeed * 1.05, cur + launch.acceleration * dt);
    s.cruise = beh.cruiseSpeed;
    return spd;
  }
  if (launch.mode === "kick_motor" && s.motor != null) {
    const burn = s.motor;
    const accel =
      launch.acceleration +
      Phaser.Math.Clamp(burn, 0, launch.burnTime) * 0.35 * launch.acceleration;
    const spd = Math.min(beh.cruiseSpeed * 1.15, cur + accel * dt);
    s.cruise = beh.cruiseSpeed;
    return spd;
  }
  const cruise = s.cruise ?? beh.cruiseSpeed;
  const spd = Math.min(cruise * 1.08, Math.max(cur, cruise * 0.72) + 140 * dt);
  s.cruise = cruise;
  return spd;
}

/** 3D steer toward a unit home vector, then fly at `spd`. */
function flyMissile(
  s: Shot,
  home: { x: number; y: number; z: number },
  turn: number,
  spd: number,
  opts?: { noseZ?: number; slowThresh?: number }
): void {
  const noseZ = opts?.noseZ ?? 0.2;
  const slowThresh = opts?.slowThresh ?? 40;
  const cur = Math.hypot(s.vx, s.vy, s.vz);
  const dir0 =
    cur < slowThresh
      ? { x: Math.cos(s.angle), y: Math.sin(s.angle), z: noseZ }
      : { x: s.vx, y: s.vy, z: s.vz };
  const d = steerDir(dir0.x, dir0.y, dir0.z, home.x, home.y, home.z, turn);
  s.angle = Math.atan2(d.y, d.x);
  s.vx = d.x * spd;
  s.vy = d.y * spd;
  s.vz = d.z * spd;
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
  if (textures.exists("fx_blast_ring")) return;
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size * BLAST_RING_FRAMES;
  canvas.height = size;
  const g = canvas.getContext("2d", { willReadFrequently: true })!;
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
  textures.addSpriteSheet("fx_blast_ring", canvas as unknown as HTMLImageElement, {
    frameWidth: size,
    frameHeight: size,
    endFrame: BLAST_RING_FRAMES - 1,
  });
  registerArt("fx_blast_ring", "generated");
}


function ensureImpactGlow(textures: Phaser.Textures.TextureManager): void {
  if (textures.exists("fx_glow")) return;
  const s = 96;
  const c = document.createElement("canvas");
  c.width = s;
  c.height = s;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.2, "rgba(255,255,255,0.72)");
  grd.addColorStop(0.52, "rgba(255,255,255,0.2)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, s, s);
  textures.addCanvas("fx_glow", c);
  registerArt("fx_glow", "generated");
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
