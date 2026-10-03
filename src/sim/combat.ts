import { specOf, type DebrisCat, type ShotLook, type UnitKind, type PartMount } from "./roster";
import type { SocketClass } from "./crafts";
import type { CamoKind } from "../render/camo";
import type { RemoteKind } from "./remote";

export type { DebrisCat, UnitKind } from "./roster";
import { PLAYER_WPNS } from "../catalog/weapons";
import type { CountermeasureId } from "../catalog/countermeasures";
export { MISSILE_IGNITE, LOCK_ON_LOCK_T, LOCK_ON_SEEK_DELAY } from "../catalog/weaponPresets";

/** Tip-biased UV origin for all projectile art (nose-along-+X). */
export const SHOT_ORIGIN = { x: 0.84, y: 0.5 } as const;

/** Exhaust / trail emit UV (rear of projectile art, nose-along-+X). */
export const SHOT_TAIL = { x: 0.06, y: 0.5 } as const;


export type LockCategory = "air" | "ground" | "vehicle";

export type LockAcquire =
  /** Nearest-ish unit under the aim point within lockRadius (size-biased). */
  | {
      policy: "reticle";
      /** Omit = any unit. Maverick AG: ground + vehicle only. */
      categories?: readonly LockCategory[];
    }
  /** Prefer hotter signature classes inside a nose cone. */
  | {
      policy: "signature";
      categories: readonly LockCategory[];
      minHealth: number;
      /** Max angle from craft heading (radians) that can soft-lock. */
      maxOffBoresight: number;
      /** Tighter cone for vehicle-class heat (omit = use maxOffBoresight). */
      vehicleMaxOffBoresight?: number;
    };

/** Alias — same acquire policies under the retired naming. */
export type WeaponAcquire = LockAcquire;

export type WeaponArt = {
  look: ShotLook;
  scale: number;
  mount?: string;
  tracer?: CannonTracerBake;
  tint?: number;
  face: "heading" | "velocity";
};

export type ExhaustTrail =
  | {
      kind: "particles";
      /** Motor flame, or cyanSpark for railgun forward spit (no smoke). */
      fire?: "burn" | "hotFlame" | "cyanSpark";
      /**
       * Emit fire only for this many seconds after launch (motor flash),
       * then continue with smoke alone. Omit = fire for the whole flight.
       */
      fireFor?: number;
      smoke?: "linger" | "short" | "rocket";
      /** Thin pale stretched smoke like jet wingtip contrails (JDAM). */
      contrail?: boolean;
      align?: "heading";
      size?: number;
      /**
       * Particle scale for motor fire only. Omit = use `size` (same as smoke).
       * Coast rockets use a smaller fireSize so the plume stays dense without
       * bloating the long smoke.
       */
      fireSize?: number;
      /** Multiplier on trail particle emit rate (bombs use sparse <1). */
      density?: number;
      /** Override trail emit UV (default SHOT_TAIL). */
      emitUv?: { x: number; y: number };
    }
  | {
      kind: "energy";
      ribbons?: number;
      hue?: "cyan" | "green" | "magenta";
      warpMotes?: boolean | { density?: number };
    }
  /** Signal-flare pellet: pink/red flame-smoke loft + fast red sparks. */
  | {
      kind: "signalFlare";
      size?: number;
      density?: number;
    };

export type WeaponCam = {
  reticle: "round" | "square";
  look: { pull: number; max: number; rate: number };
  povCam?: boolean;
  thermal?: boolean;
  /** When false, skip plane look-ahead mul (Sidewinder). Omit = apply mul. */
  planeLookMul?: false;
  lockHud?: { seeking: string; locked: string; color: number; textColor: string };
  /**
   * Laser aim mode. Default boresight (project mouse along gun/nose).
   * `mouse` = free aim at the reticle from socket mounts (spiders, laser/command AG).
   */
  sight?: "mouse" | "boresight";
};

export type HeDetonate = {
  look: "fire" | "energy" | "photonic";
  dustMul?: number;
  /** Drop-bomb style toon blast + big-boom sparks/debris (MOAB / arty shells). */
  bigBoom?: boolean;
};

/**
 * Host weapons a POV remote may trigger. Keep assignable to `WpnId` once the
 * catalog exists (see assert below) — avoids circular WeaponPayload ↔ WpnId.
 */
export type HostFireWeaponId = "heavy_artillery";

export type WeaponPayload = {
  penetration?: number;
  dustMul?: number;
  detonate?: HeDetonate;
  he?: { every?: number; blend?: number };
  stun?: number;
  cluster?: {
    bomblets: number;
    spread: number;
    bombletDmg: number;
    bombletBlast: number;
    /** Projectile art for each bomblet (e.g. shot_mini_rocket). */
    look: ShotLook;
    break?: "spray" | "cone_hop";
    /**
     * Mid-air open after this fraction of predicted flight time to impact
     * (same ballistic estimate as the drop path preview). Omit = open on impact.
     */
    openAt?: number;
    bombletDetonate?: HeDetonate;
    /** In-flight trail for each bomblet; omit = none. */
    bombletExhaust?: ExhaustTrail;
  };
  smoke?: { duration: number; radius: number };
  remote?: { kind: RemoteKind; duration: number };
  /**
   * Ground skimmer: steer to mouse; when an enemy enters engageRange, latch and
   * dash onto them (spider drones).
   */
  spider?: {
    engageRange: number;
    /** Dash top speed as × cruise (default 1.5). */
    dashMul?: number;
    /** Horizontal accel toward dash top speed (world u/s²; default 380). */
    dashAccel?: number;
  };
  warp?: { timeScale: number };
  helix?: { strands: number };
  split?: { at: number; count: number };
  bounce?: { maxBounces: number };
  /**
   * Mark-then-call: marker settles, then off-map shells rain onto the mark
   * with XY jitter. Reusable across any craft socket.
   */
  callStrike?: {
    /** Seconds after marker rest before the first shell. Omit / 0 = fire immediately. */
    delay?: number;
    rounds: number;
    /** Seconds between shells. */
    interval: number;
    /** Uniform disk radius around the mark (world units). */
    jitter: number;
    shellDmg: number;
    shellBlast: number;
    /** Inbound shell projectile art. */
    shellLook: ShotLook;
    /** Constant inbound speed of each shell (world u/s). */
    shellSpeed?: number;
    /** Keep flare FX until this many shells have impacted (default 3). */
    flareUntilHits?: number;
    /**
     * Optional host craft weapon whose ammo bank pays for the barrage
     * (e.g. HOUND artillery strike → dropship howitzer).
     */
    hostWeapon?: HostFireWeaponId;
  };
  /**
   * POV remote spot — one click fires `weapon` from the host craft mount
   * (e.g. HOUND calling the dropship howitzer onto aim).
   * Narrow id union (assignable to `WpnId`) — avoids circular `WpnId` ↔ catalog defs.
   */
  hostFire?: { weapon: HostFireWeaponId };
};

export type WeaponFire = {
  muzzleFlash: boolean;
  jitter: number;
  salvo?: { count: number; interval: number; spread?: number };
  /** Small standalone spark burst when `muzzleFlash` is off — no flash sprite/glow/shell eject. */
  muzzleSparks?: boolean;
};

export type WeaponControl =
  | { mode: "hold_mouse_down" }
  | { mode: "click" }
  | { mode: "lock_then_click" }
  | { mode: "click_then_click_to_commit" }
  | { mode: "click_to_set_target" };

export type WeaponTargeting =
  | { mode: "steer" }
  | {
      mode: "steer_commit";
      lockTime: number;
      lockRadius: number;
      breakLockRadius?: number;
    }
  | {
      mode: "lock_on";
      lockTime: number;
      lockRadius: number;
      seekDelay: number;
      acquire: LockAcquire;
      proxTurn?: { far: number; near: number; nearDist: number };
      proxFuse?: { xy: number; z?: number };
    }
  | { mode: "waypoint" };

export type WeaponFlight = {
  turnRate: number;
  maxAngle?: number;
  /** When steer_commit terminal engages, use this instead of turnRate (Spike 6.5, Warp 48). */
  commitTurnRate?: number;
  loft?: {
    cruise: "player" | "player_descend" | { agl: number };
    dive: { range: number; power: number; inner?: number };
    clear?: { coast?: number; far?: number; near?: number };
  };
};

export type WeaponGuidance = {
  targeting: WeaponTargeting;
  flight: WeaponFlight;
  wire?: boolean;
};

export interface WeaponGravity {
  acceleration: number;
  terminalVelocity?: number;
}

export type WeaponLaunch =
  | {
      mode: "muzzle";
      inheritMomentum: number;
      /** Accel toward `speed` after leave (AA rail / Hydra boost). */
      acceleration?: number;
      /**
       * With `acceleration`: burn duration then coast. Omit = keep thrusting
       * (AA rail). Dumbfire rockets set this for motor flash → coast.
       */
      burnTime?: number;
      /** Leave speed when `acceleration` is set (default 10 for rails). */
      leaveSpeed?: number;
      /** Extra upward leave impulse (Banshee loft). */
      leaveVz?: number;
      gravity?: WeaponGravity;
    }
  | {
      mode: "kick_motor"; // Tube-launched missile: kick, coast, ignite, burn.
      kickSpeed: number;
      igniteDelay: number;
      acceleration: number;
      burnTime: number;
      inheritMomentum: number;
      yawMul?: number;
      softLoft?: number;
      leaveVz?: number;
      pitch?: number;
    }
  | { mode: "drop"; inheritMomentum: 1; gravity: WeaponGravity }
  | { mode: "beam"; range: number; delivery: "ray" | "arc" };

// Manually declared, not `keyof typeof PLAYER_WPNS_DEFS` — see RemoteKind's comment in
// remote.ts for why (Craft/Weapon/Remote form a 3-way reference cycle; each catalog's
// identifier type must be a plain leaf, not derived from its own catalog's shape).
export type WpnId =
  | "chain_gun"
  | "rocket"
  | "incendiary_rocket"
  | "hellfire_missile"
  | "tv_missile"
  | "minigun"
  | "gatling"
  | "tow_missile"
  | "sidewinder_missile"
  | "machine_gun"
  | "heavy_bomb"
  | "cluster_bomb"
  | "guided_rockets"
  | "microwave_missile"
  | "heavy_machine_gun"
  | "heavy_cal_pod"
  | "concealed_cannon"
  | "smoke_bomb"
  | "stinger_missile"
  | "railgun"
  | "swarm_missile"
  | "banshee"
  | "grenade_launcher"
  | "attack_drone"
  | "wingman_drone"
  | "fighter_pod"
  | "agv_drop"
  | "humvee_drop"
  | "wolf_drop"
  | "spider_drone"
  | "plasma_cannon"
  | "laser_rocket"
  | "photon_missile"
  | "warp_bomb"
  | "medium_gatling_cannon"
  | "light_gps_missile"
  | "gps_bomb"
  | "heavy_artillery"
  | "medium_cannon"
  | "light_cannon"
  | "gps_missile"
  | "heavy_cannon"
  | "heavy_guided_missile"
  | "bomb"
  | "tesla_beam"
  | "mini_hellfire_missile"
  | "mini_bomb"
  | "artillery_strike"
  | "remote_howitzer";

/** Player loadout — shared by fire logic and the combat rig. */
export interface PlayerWpnSpec {
  /** Loadout identity (must match the PLAYER_WPNS key). */
  id: string;
  /** Short HUD nickname. */
  name: string;
  /** Display name: nickname + ordnance class (loadout / help). */
  fullName: string;
  /** Player-facing blurb. What it is and the behavior that isn't obvious from the name. */
  description?: string;
  /** Full technical / catalog designation (codes, caliber). Unused in-game for now. */
  designation: string;
  /** Automatic-station crew never slews or fires this weapon at aerial targets. */
  groundOnly?: boolean;
  ammo: number;
  fireCd: number;
  /** Launch / ballistic speed (powered missiles may kick, then ignite their motor). */
  speed: number;
  dmg: number;
  blast: number;
  life: number;
  art: WeaponArt;
  exhaust?: ExhaustTrail;
  cam: WeaponCam;
  fire?: WeaponFire;
  control: WeaponControl;
  launch: WeaponLaunch;
  guidance?: WeaponGuidance;
  payload: WeaponPayload;
  /** Per-class damage multipliers (direct + splash). Missing keys default to 1. */
  dmgMul?: Partial<Record<UnitClass, number>>;
  /** Extra damage vs stunned / smoke-blinded targets. Omit = 1. */
  debuffDmgMul?: number;
  /** Socket classes this weapon may install into. */
  fits: SocketClass[];
  notes: string[];
}

export type TracerRgb = [number, number, number];

/** Procedural cannon tracer shape authored on the weapon (bake.ts). */
export interface CannonTracerBake {
  w: number;
  h: number;
  core: TracerRgb;
  mid: TracerRgb;
  rim: TracerRgb;
  /** 0 = soft tear tracer, 1 = blunt slug. */
  blunt?: number;
  glow?: number;
  twin?: boolean;
  /** `tear` default. `bolt` = faceted rail dart. `orb` = elongated blob. */
  shape?: "tear" | "bolt" | "orb";
}

export { PLAYER_WPNS } from "../catalog/weapons";

/** Narrow a catalog row to its key-typed id (defs use plain string `id`). */
export function wpnIdOf(w: PlayerWpnSpec): WpnId {
  return w.id as WpnId;
}

/** Catalog lookup by id — mirrors `craftOf`. */
export function wpnOf(id: WpnId): PlayerWpnSpec {
  return PLAYER_WPNS[id];
}

export function playerLoadout(ids: readonly WpnId[]): PlayerWpnSpec[] {
  return ids.map((id) => {
    const w = PLAYER_WPNS[id];
    if (!w) throw new Error(`unknown weapon id: ${id}`);
    return w;
  });
}

/** Resolve craft sockets into an ordered weapon loadout. */
export function playerLoadoutFromSockets(
  sockets: readonly { weapon: WpnId }[]
): PlayerWpnSpec[] {
  return playerLoadout(sockets.map((s) => s.weapon));
}

/** Turret/cabin gun-body texture for a weapon, if it has one. */
export function weaponMountTex(wpnId: WpnId): string | undefined {
  return PLAYER_WPNS[wpnId]?.art.mount;
}

/** True when a weapon may install into a socket class. */
export function weaponFitsSocket(wpnId: WpnId, socketClass: SocketClass): boolean {
  const w = PLAYER_WPNS[wpnId];
  return !!w && w.fits.includes(socketClass);
}

/** Burst/salvo-aware sustained DPS matching fire cadence. */
export function sustainedDps(dmg: number, fireCd: number, count = 1, gap = 0): number {
  const n = Math.max(1, count);
  const cycle = fireCd + (n - 1) * Math.max(0, gap);
  return cycle > 0 ? (dmg * n) / cycle : 0;
}

/** Unmodified player weapon DPS (no dmgMul). */
export function playerWeaponDps(w: PlayerWpnSpec): number {
  return sustainedDps(w.dmg, w.fireCd, w.fire?.salvo?.count ?? 1, w.fire?.salvo?.interval ?? 0);
}

/** Window `playerWeaponBurstFirepower` sizes a weapon's "how hard does this hit right now" number over. */
const FIREPOWER_BURST_WINDOW = 1;

/**
 * How many times something firing every `cycle` seconds effectively goes off within `window`
 * seconds, given it's already loaded and ready at t=0 — floored at 1 so a slow weapon still gets
 * full credit for the one shot it's always ready to deliver, instead of being time-averaged down
 * to a fraction of a hit. Continuous (not `floor(window/cycle)+1`) on purpose: a discrete shot
 * count creates hard cliffs right at `cycle ≈ window` — two weapons with nearly identical cadence
 * can land a whole extra "shot" apart from each other purely from which side of the window edge
 * their cooldown happens to fall on (a 0.72s bomb crosses into "2 shots" a hair before a 1.04s
 * railgun falls back to "1"), which isn't a meaningful difference in real firepower.
 */
function shotsInBurst(cycle: number, window: number): number {
  return cycle > 0 ? Math.max(1, window / cycle) : 0;
}

/**
 * Guaranteed payload damage that actually lands within `window` seconds of firing. Cluster
 * bomblets resolve with the shot itself, so they count in full; call-strike shells trickle in
 * over `rounds * interval`, so only the ones that land inside the window count — the rest are
 * still inbound when the window ends. `hostFire` needs no entry: its `dmg` already equals the
 * host weapon's own hit.
 */
function weaponPayloadBurstBonus(payload: WeaponPayload, window: number): number {
  let bonus = 0;
  if (payload.cluster) bonus += payload.cluster.bomblets * payload.cluster.bombletDmg;
  if (payload.callStrike) {
    const { rounds, interval, shellDmg } = payload.callStrike;
    bonus += Math.min(rounds, shotsInBurst(interval, window)) * shellDmg;
  }
  return bonus;
}

/**
 * Total damage a weapon can land in one `FIREPOWER_BURST_WINDOW`-second window, payload included —
 * the "how dangerous is this right now" figure `craftFirepower` sums per socket. Unlike a smoothed
 * sustained DPS, a slow one-shot weapon (a howitzer, a MOAB) gets full credit for the single hit it
 * can always deliver instead of having that hit time-averaged down below a machine gun's, and a
 * call-strike only counts the shells that have actually landed a second in, not the whole barrage.
 */
export function playerWeaponBurstFirepower(w: PlayerWpnSpec, fireRateMul = 1): number {
  const n = Math.max(1, w.fire?.salvo?.count ?? 1);
  const gap = w.fire?.salvo?.interval ?? 0;
  const fireCd = w.fireCd / Math.max(0.05, fireRateMul);
  const cycle = fireCd + (n - 1) * Math.max(0, gap);
  const cycles = shotsInBurst(cycle, FIREPOWER_BURST_WINDOW);
  const perCycleDmg = n * w.dmg + weaponPayloadBurstBonus(w.payload, FIREPOWER_BURST_WINDOW);
  return cycles * perCycleDmg;
}

/** Per-target-class damage multiplier (1 when unset). */
export function playerWeaponClassMul(w: PlayerWpnSpec, cls: UnitClass): number {
  return w.dmgMul?.[cls] ?? 1;
}

export interface Unit {
  id: number;
  kind: UnitKind;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  /** Vertical speed for aerial AI (helis matching player AGL). */
  vz?: number;
  angle: number;
  /** Smoothed `projectHeading` so 2.5D singularities can't flip the sprite. */
  drawRot?: number;
  /** Smoothed projected aim for guns / soft troop facing (keyed). */
  aimDrawRots?: Record<string, number>;
  turret: number;
  health: number;
  max: number;
  hv?: string;
  dead: boolean;
  /** Fixed-mount fire cooldown (turret units use `gunStates[].cd`). */
  fireCd: number;
  /** Fixed-mount burst rounds left; turret units: busiest turret's burst (summary). */
  burstLeft?: number;
  orbit: number;
  aware?: boolean;
  aiMood?: "kite" | "flee";
  moodT?: number;
  aiState?: string;
  aiTx?: number;
  aiTy?: number;
  rotor: number;
  track: number;
  turrets: number[];
  /** Acquired target: a remote id, or undefined = the host craft (re-picked every ~0.5s). */
  tgtRemoteId?: number;
  /** Scene time (ms) of the next target re-evaluation. */
  tgtNextT?: number;
  /** Per-turret fire state (index = gun part) — each turret targets, locks and fires on its own. */
  gunStates?: { cd: number; burst: number; lockT: number; holdT: number; tip: number }[];
  muzzleT: number;
  /** Gun part owning the pooled muzzle flash (last turret to fire). */
  muzzleGun: number;
  /** Fixed-mount next hull tip (turret units cycle `gunStates[].tip`). */
  muzzleTip: number;
  /** Tip index used for the active muzzle flash (may differ from next-shot muzzleTip). */
  muzzleFireTip?: number;
  /** Baked muzzle flash jitter for the current flash window. */
  muzzleJitS?: number;
  muzzleJitR?: number;
  muzzleFrame?: number;
  /** Sim-time accumulator for altitude bob, so it scales with timeScale. */
  bobT?: number;
  pinId?: number;
  /** Index into host UnitSpec.crew.mounts when pinned. */
  pinMount?: number;
  camo?: CamoKind;
  strike?: number;
  /**
   * Seconds of stun remaining. Stunned units get no AI inputs (move, turn, aim, fire)
   * but keep coasting on existing velocity / spin with friction.
   */
  stunT?: number;
  /** Hull yaw rate (rad/s). Recorded from AI so stun can coast turning. */
  omega?: number;
  /** Primary turret yaw rate (rad/s). */
  turretOmega?: number;
  /** Per-barrel turret yaw rates (rad/s), parallel to `turrets`. */
  turretOmegas?: number[];
  /** Seconds until the next stun zap overlay stamp. */
  stunZapT?: number;
  parts?: PartMount[];
  missileCd?: number;
  missileSide?: number;
  /** Fixed-mount aim hold (narrows jitter); turret units: longest turret hold (summary). */
  aimHoldT?: number;
  /** Fixed-mount lock charge; turret units: highest turret lock (summary, drives paint HUD). */
  lockT?: number;
  /** Seconds charging missile lock on the secondary missile rack. */
  secLockT?: number;
  /** Debug/HUD: 0..1 gun-aim narrowing progress this frame (undefined when not engaging). */
  debugAimT?: number;
  /** Debug: current effective jitter full-width (radians) this frame (undefined when not engaging). */
  debugAimSpreadRad?: number;
  /** Debug/HUD: 0..1 missile-lock charge progress this frame (undefined when not tracking). */
  debugLockT?: number;
  /** HUD paint arc: 0..1 seeker lock charge on a friendly craft this frame (undefined when not painting). */
  paintT?: number;
  /** HUD paint arc: painting the host (vs the piloted combat-focus remote). */
  paintHost?: boolean;
  killDx?: number;
  killDy?: number;
  /** Killing-shot vz (same frame as killDx/Dy). */
  killDz?: number;
  /** Damage that finished the unit (direct or splash falloff). */
  killDmg?: number;
  /** Persistent solid-pixel damage locations on the hull texture. */
  dmgSites?: { u: number; v: number; scale: number }[];
}
/**
 * Behavior captured at launch. A projectile keeps flying its original profile even
 * if the loadout slot is re-armed or the craft is swapped mid-flight.
 */
export interface ShotBehavior {
  readonly art: WeaponArt;
  readonly exhaust?: ExhaustTrail;
  readonly cam: WeaponCam;
  readonly fire?: WeaponFire;
  readonly guidance?: WeaponGuidance;
  readonly launch: WeaponLaunch;
  readonly payload: WeaponPayload;
  readonly control: WeaponControl;
  /** Cruise speed the motor accelerates toward (spec.speed at launch). */
  readonly cruiseSpeed: number;
  /** Direct-hit damage of one sub-munition-free impact (spec.dmg at launch). */
  readonly dmg: number;
  readonly blast: number;
  /** Per-class damage multipliers captured at launch. */
  readonly dmgMul?: Partial<Record<UnitClass, number>>;
  /** Debuff-target damage mul captured at launch. */
  readonly debuffDmgMul?: number;
}

/** Mutable per-projectile guidance / payload state. */
export interface ShotState {
  /** Seconds since launch. */
  age: number;
  /** Heading at launch; off-boresight limits are measured from the live heading. */
  launchAngle: number;
  /** Seeker is live (past laser/heat seek delay, or handed over on terminal). */
  seeking?: boolean;
  /** NLOS second-click terminal homing engaged. */
  terminal?: boolean;
  /** Latched GPS / designated impact point. */
  gx?: number;
  gy?: number;
  /** Plasma strand phase and lateral sign. */
  helix?: number;
  helixSide?: number;
  helixOff?: number;
  /** Helix oscillation frequency (rad/s-ish). */
  helixFreq?: number;
  /** Phase offset on the helix sine (radians) so burst rounds braid. */
  helixPhase?: number;
  /** Cluster / smoke payload already opened. */
  opened?: boolean;
  /**
   * Cluster dispenser: open when `age >= openAge` (seconds).
   * Authored from predicted fall time × `payload.cluster.openAt`.
   */
  openAge?: number;
  /** Remaining armor targets a penetrator can pass through. */
  pierce?: number;
  /** Units already damaged by this penetrator. */
  hitIds?: number[];
  /** Sub-munition (bomblet) — skips lock HUD and camera hand-off. */
  bomblet?: boolean;
  /** Off-map call-strike shell — links impacts back to the flare mark. */
  callStrikeMarkId?: number;
  /** Impact aim point for ETA / constant-speed flight. */
  callStrikeTx?: number;
  callStrikeTy?: number;
  callStrikeTz?: number;
  /** Flare from a POV remote — barrage spawns from the host craft. */
  callStrikeFromHost?: boolean;
}

/**
 * One drifting chemical puff from a smoke payload.
 * Sim object (vision stacking) — never an FX-budget particle.
 */
export interface SmokePuff {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** World-XY overlap radius for vision stacking. */
  radius: number;
  /** Seconds remaining. */
  t: number;
  max: number;
  tint: number;
  spin: number;
  ang: number;
  frame: number;
}

/** Target taxonomy for damage muls, heat seekers, and HUD classing. */
export type UnitClass = "air" | "vehicle" | "building" | "troop";
/** Heat-seeker preference ordering: air > vehicles > buildings > troops. */
export type HeatClass = UnitClass;

export function heatClassScore(c: HeatClass): number {
  return c === "air" ? 3 : c === "vehicle" ? 2 : c === "building" ? 1 : 0;
}

/** Guidance category a signature class reports to lock_on signature acquire. */
export function heatClassCategory(c: HeatClass): "air" | "ground" | "vehicle" {
  // Buildings count as vehicle-class heat (mech); troops alone use "ground".
  return c === "air" ? "air" : c === "troop" ? "ground" : "vehicle";
}

/** Snapshot the immutable flight profile of a player weapon at trigger time. */
export function shotBehaviorOf(spec: PlayerWpnSpec): ShotBehavior {
  return {
    art: spec.art,
    exhaust: spec.exhaust,
    cam: spec.cam,
    fire: spec.fire,
    guidance: spec.guidance,
    launch: spec.launch,
    payload: spec.payload,
    control: spec.control,
    cruiseSpeed: spec.speed,
    dmg: spec.dmg,
    blast: spec.blast,
    dmgMul: spec.dmgMul,
    debuffDmgMul: spec.debuffDmgMul,
  };
}

/**
 * Avenger-style combat mix: every `he.every`th kinetic round becomes HEI
 * (no pierce, wider blast). Returns pierce for the spawned shot.
 */
export function applyKineticCombatMix(
  spec: PlayerWpnSpec,
  beh: ShotBehavior,
  roundIndex: number
): { beh: ShotBehavior; pierce: number | undefined } {
  const payload = spec.payload;
  const basePierce = payload.penetration;
  const every = payload.he?.every;
  if (every == null || every < 2) {
    return { beh, pierce: basePierce };
  }
  const heRound = roundIndex % every === 0;
  if (!heRound) return { beh, pierce: basePierce };
  const dustMul = payload.dustMul;
  return {
    beh: {
      ...beh,
      payload: {
        ...(dustMul != null ? { dustMul } : {}),
        detonate: { look: "fire" },
      },
      // HEI: softer pen trade for splash — punchier than baseline blast.
      dmg: beh.dmg * 1.08,
      blast: beh.blast * 1.9,
    },
    pierce: undefined,
  };
}

/** Ground-impact dirt multiplier from payload (jet cannons kick up more dust). */
export function payloadDustMul(payload: WeaponPayload | undefined): number {
  return payload?.dustMul ?? 1;
}

/** Partial HE FX weight for SAPHEI-style kinetic (0 if full HE / pure kinetic). */
export function payloadHeBlend(payload: WeaponPayload | undefined): number {
  const b = payload?.he?.blend ?? 0;
  return b <= 0 ? 0 : b >= 1 ? 1 : b;
}

/** True when guidance drives a lock HUD / soft-lock pipeline. */
export function guidanceUsesLock(
  g: WeaponGuidance
): g is WeaponGuidance & {
  targeting: Extract<WeaponTargeting, { mode: "lock_on" | "steer_commit" }>;
} {
  return g.targeting.mode === "lock_on" || g.targeting.mode === "steer_commit";
}

/** Pre-fire unit lock (lock_on), not in-flight steer_commit soft-lock. */
export function guidanceIsLockOn(
  g: WeaponGuidance
): g is WeaponGuidance & { targeting: Extract<WeaponTargeting, { mode: "lock_on" }> } {
  return g.targeting.mode === "lock_on";
}

export function exhaustIsEnergy(
  e: ExhaustTrail | undefined
): e is Extract<ExhaustTrail, { kind: "energy" }> {
  return e?.kind === "energy";
}

/** Railgun-style cyan spit — still a gun for hit FX / deadfall, but leaves a spark trail. */
export function exhaustIsGunSpark(e: ExhaustTrail | undefined): boolean {
  return e?.kind === "particles" && e.fire === "cyanSpark";
}

/** Parallel ribbon count for energy exhaust (default 1 when energy). */
export function exhaustRibbons(e: ExhaustTrail | undefined): number {
  if (!exhaustIsEnergy(e)) return 0;
  return Math.max(1, (e.ribbons ?? 1) | 0);
}

export function exhaustHue(e: ExhaustTrail | undefined): EnergyTrailHue | undefined {
  return exhaustIsEnergy(e) ? e.hue : undefined;
}

export function exhaustWarpMotes(
  e: ExhaustTrail | undefined
): boolean | { density?: number } | undefined {
  return exhaustIsEnergy(e) ? e.warpMotes : undefined;
}

export function exhaustIsSignalFlare(
  e: ExhaustTrail | undefined
): e is Extract<ExhaustTrail, { kind: "signalFlare" }> {
  return e?.kind === "signalFlare";
}

/** Hold-to-arc beam (Tesla) — live stream, not a ray cast. */
export function launchIsArcBeam(
  launch: WeaponLaunch | undefined
): launch is Extract<WeaponLaunch, { mode: "beam"; delivery: "arc" }> {
  return launch?.mode === "beam" && launch.delivery === "arc";
}

/** Instant ray beam (Refractor) — cast / bounce / split. */
export function launchIsRayBeam(
  launch: WeaponLaunch | undefined
): launch is Extract<WeaponLaunch, { mode: "beam"; delivery: "ray" }> {
  return launch?.mode === "beam" && launch.delivery === "ray";
}

/** Seconds a ribbon node stays visible after it is spawned. */
export const ENERGY_TRAIL_NODE_LIFE = 1.85;
/** Plasma Helix spiral ribbon — short braid fade. */
export const HELIX_TRAIL_NODE_LIFE = 0.5;

export type EnergyTrailHue = "cyan" | "green" | "magenta";

export interface EnergyTrailNode {
  x: number;
  y: number;
  z: number;
  /** Exhaust kick opposite the dart (strong at spawn, then drag). */
  bx: number;
  by: number;
  bz: number;
  life: number;
  /** Fade reference life; defaults to ENERGY_TRAIL_NODE_LIFE. */
  max?: number;
  /** Ribbon color set; defaults cyan (Starscream / Photon). */
  hue?: EnergyTrailHue;
}

export interface Shot {
  from: "player" | "enemy";
  /** Stable handle for shots the player keeps commanding (NLOS terminal). */
  id?: number;
  /** Loadout identity that fired this projectile. */
  wpnId?: WpnId;
  /** Loadout slot index that fired this projectile. */
  slot?: number;
  /** Immutable behavior snapshot taken at launch. */
  beh?: ShotBehavior;
  /** Mutable guidance / payload state. */
  st?: ShotState;
  /** Additive art tint for energy ordnance. */
  tint?: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  angle: number;
  life: number;
  targetId?: number;
  blast: number;
  dmg: number;
  /**
   * Pull the play camera onto this shot while airborne.
   * Not “is guided” — bombs/GPS can share loft without this.
   */
  povCam?: boolean;
  homePlayer?: boolean;
  /** Enemy seeker fired at a remote (id); undefined = homes on the host craft. */
  homeRemoteId?: number;
  /** HUD lock arc: distance to the target when the arc first showed (arc narrows by closure). */
  lockD0?: number;
  motor?: number;
  cruise?: number;
  loft?: number;
  yaw?: number;
  look?: ShotLook;
  /** Draw scale from weapon preset (× secondary mul when applicable). */
  scale?: number;
  /** Effective seconds per projectile, used only to scale muzzle and impact-spark density. */
  fxInterval?: number;
  wire?: { x: number; y: number; z: number }[];
  wireSide?: number;
  wireTrim?: number;
  /** Additive neon ribbon nodes (Starscream). Offsets wander so the path ripples. */
  energyTrail?: EnergyTrailNode[];
  /** Parallel energy ribbons (Photon). When set, preferred over `energyTrail`. */
  energyTrails?: EnergyTrailNode[][];
  /** EMP / electronics kill: no seek, no trail, falls and detonates on the ground. */
  deadfall?: boolean;
  /** EMP countermeasure killed seeker logic; dart keeps flying dumb. */
  seekDisabled?: boolean;
  /** While this player projectile is active, cap simulation speed to this multiplier. */
  warpTimeScale?: number;
}

/** Decoy spark used by the flares countermeasure. */
export interface Flare {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
}

export interface CountermeasureSpec {
  id: string;
  name: string;
  /** Role / fantasy blurb (Field Manual) — no mechanics or tuning values; tips cover those. */
  description: string;
  duration: number;
  cooldown: number;
}

export { COUNTERMEASURES_DEFS, COUNTERMEASURES, type CountermeasureId } from "../catalog/countermeasures";

function formatCmSeconds(n: number): string {
  return `${Number.isInteger(n) ? n : n.toFixed(1)}s`;
}

/** Hangar / help: effect duration then cooldown. */
export function countermeasureTimingLabel(cm: CountermeasureSpec): string {
  return `${formatCmSeconds(cm.duration)} / ${formatCmSeconds(cm.cooldown)} CD`;
}

export function craftCountermeasure(id?: CountermeasureId): CountermeasureId {
  return id ?? "flares";
}

/** Apply or extend a stun. Safe to call on already-stunned units. */
export function stunUnit(u: Unit, duration: number): void {
  if (u.dead || duration <= 0) return;
  u.stunT = Math.max(u.stunT ?? 0, duration);
}

export function unitStunned(u: Unit): boolean {
  return (u.stunT ?? 0) > 0;
}

function wrapPi(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/**
 * Coast a stunned unit: no new AI, existing linear + angular rates decay to rest.
 * Callers still step position against terrain / altitude.
 */
export function tickStunKinematics(u: Unit, dt: number): void {
  u.stunT = Math.max(0, (u.stunT ?? 0) - dt);
  const drag = Math.pow(0.28, dt);
  const spinDrag = Math.pow(0.18, dt);
  u.vx *= drag;
  u.vy *= drag;
  const omega = (u.omega ?? 0) * spinDrag;
  u.omega = omega;
  u.angle += omega * dt;
  const tOmega = (u.turretOmega ?? 0) * spinDrag;
  u.turretOmega = tOmega;
  u.turret += tOmega * dt;
  const n = u.turrets.length;
  if (!n) return;
  if (!u.turretOmegas) u.turretOmegas = [];
  for (let i = 0; i < n; i++) {
    const w = (u.turretOmegas[i] ?? tOmega) * spinDrag;
    u.turretOmegas[i] = w;
    u.turrets[i] = (u.turrets[i] ?? 0) + w * dt;
  }
  u.turretOmegas.length = n;
  u.turret = u.turrets[0]!;
}

/** Snapshot hull / turret rates from this frame's pose change so stun can coast them. */
export function recordUnitSpin(
  u: Unit,
  prevAngle: number,
  prevTurret: number,
  prevTurrets: readonly number[],
  dt: number
): void {
  if (dt <= 1e-8) return;
  u.omega = wrapPi(u.angle - prevAngle) / dt;
  u.turretOmega = wrapPi(u.turret - prevTurret) / dt;
  if (!u.turretOmegas) u.turretOmegas = [];
  const n = u.turrets.length;
  for (let i = 0; i < n; i++) {
    u.turretOmegas[i] = wrapPi((u.turrets[i] ?? 0) - (prevTurrets[i] ?? 0)) / dt;
  }
  u.turretOmegas.length = n;
}

/** Manually simulated terrain-interacting particles. Other visual FX use Phaser emitters. */
export type SimParticleKind = "dirt";

export interface SimParticle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  scale: number;
  bounces: number;
  kind: SimParticleKind;
  tex: string;
  frame: number;
  angJit: number;
  spin: number;
  tint: number;
  additive: boolean;
  heading: number;
  /** Independent capacity pool so frequent impacts cannot evict coherent dust events. */
  capacityClass: "impact" | "dust" | "blood";
  dart?: boolean;
  blood?: boolean;
  /** Blood particle already painted a multiply stain onto the terrain. */
  stamped?: boolean;
  orb?: boolean;
  shock?: boolean;
  ox?: number;
  oy?: number;
  swirl?: number;
}

export interface Debris {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  angle: number;
  spin: number;
  life: number;
  key: string;
  settled: boolean;
  gravity?: boolean;
  bounces: number;
  /**
   * Capacity/admission importance. Critical authored hulks are never culled;
   * consequential pieces settle and stamp; ephemeral pieces only carry blast trails.
   */
  debrisClass?: "critical" | "consequential" | "ephemeral";
  trailOnly?: boolean;
  trailR: number;
  /** Local flame attach offset in unrotated debris space; orbits as the piece spins. */
  trailLx?: number;
  trailLy?: number;
  scale?: number;
  trailSoft?: boolean;
  trailFade?: number;
  trailFadeMax?: number;
  linger?: boolean;
  wobble?: number;
  wobFreq?: number;
  wobAmp?: number;
  /** Falling heli hull: spin-up, ground boom, damage flames. */
  heliCrash?: boolean;
  playerCrash?: boolean;
  spinAccel?: number;
  impactDust?: number;
  dmgFlames?: { u: number; v: number; scale: number }[];
  simmer?: number;
  /** Local burn points on a thrown part (e.g. radar dish), in unrotated debris space. */
  flamePts?: { lx: number; ly: number; sc: number }[];
  /** Match live radar dish foreshortening (scaleY squash). */
  dishFlat?: boolean;
  /** Generic debris sinking after landing in water (runtime blue tint; boats use baked `_sink` art). */
  waterSink?: boolean;
  /** Scale when sinking began (sink shrinks relative to it). */
  sinkScale0?: number;
  /** Popped-off turret: small dirt burst on first touchdown (cleared once spent). */
  turretPop?: boolean;
  /** Strong air drag for spinning rotor debris. */
  rotorThrow?: boolean;
  /** Rotor stays on the falling hull mount instead of flying off. */
  pinHost?: Debris;
  pinMount?: { x: number; y: number };
  /** Mild foreshortening / bend for a pinned rotor (same center). */
  rotorSkew?: boolean;
  /** Fixed tilt-plane angle for rotorSkew (container); blades spin inside. */
  skewAng?: number;
  /** Wheel debris: bounce then roll downhill along the height map. */
  wheelRoll?: boolean;
  rolling?: boolean;
  /** Distance accumulator for wreck-map tire prints while rolling. */
  track?: number;
  /** Spent cannon casing: bounce with heavy friction, stamp on rest. */
  shellEject?: boolean;
  /**
   * Big-boom mech flecks: Hydra-style smoke trail, hold size in flight,
   * stamp on impact and remove (no bounce).
   */
  boomBit?: boolean;
  /** Draw under the firer (air craft). Ground casings omit this and draw above. */
  shellUnder?: boolean;
  /** Thermal heat 1→0 while the casing is still a live debris sprite. */
  shellHeat?: number;
  /** Patrol/PT boat hull: surface sink (scale down) with pre-baked blue hulk. */
  boatSink?: boolean;
  /** Elapsed / total sink duration for scale progress. */
  sinkT?: number;
  sinkMax?: number;
  /**
   * Light-vehicle crash pop: flaming spinning arc, then crater + embers on settle.
   */
  crashPop?: boolean;
  /** Blast-crater scale stamped when a crashPop piece lands. */
  crashCraterScale?: number;
}

let nid = 1;
export function nextId(): number {
  return nid++;
}

export function stats(kind: UnitKind): { health: number; z: number } {
  const s = specOf(kind);
  return { health: s.health, z: s.flyZ ?? 0 };
}

export function radius(kind: UnitKind): number {
  return specOf(kind).radius;
}

export function textureOf(kind: UnitKind): string {
  return specOf(kind).texture;
}

export function heightOf(kind: UnitKind): number {
  return specOf(kind).height;
}

export function hulkOf(kind: UnitKind): string {
  return specOf(kind).hulk;
}

export function debrisCat(kind: UnitKind): DebrisCat {
  return specOf(kind).debris;
}

export function debrisKeys(kind: UnitKind): string[] {
  const cat = debrisCat(kind);
  return Array.from({ length: 12 }, (_, i) => `fx_debris_${cat}_${i}`);
}

export function wheelDebrisKeys(): string[] {
  return Array.from({ length: 4 }, (_, i) => `fx_debris_wheel_${i}`);
}
