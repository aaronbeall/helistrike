import { CRAFTS } from "../catalog/crafts";
import { lookupSpriteMuzzles, lookupSpriteOrigin, lookupSpritePoints, mountsOf, spritePointLabel } from "../art/spriteOrigin";
import {
  type HullMount,
  type HullMountRole,
  type TrackKind,
} from "./roster";
import {
  PLAYER_WPNS,
  playerWeaponClassMul,
  playerWeaponBurstFirepower,
  weaponMountTex,
  type CountermeasureId,
  type UnitClass,
  type WpnId,
} from "./combat";

const DEFAULT_ORIGIN = { x: 0.5, y: 0.5 };

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Playable / selectable craft.
 * UV layout lives in SPRITE_SPECS for body/gun textures — craft only names textures
 * and gameplay fields. Pick via `selectCraft` / `craftOf(kind)`.
 * `CraftKind` is derived from `CRAFTS` keys below.
 */

/** Physical install class — also the weapon compatibility key (`fits`). */
export type SocketClass = "fixed" | "turret" | "hardpoint";

/** Aesthetic crew-served role for automatic turret stations (HUD / hangar). */
export type CrewRole = "door" | "ramp" | "belly" | "dorsal" | "coax";

/** Body UV this socket owns, with optional per-barrel rest aim (turrets). */
export interface SocketPoint {
  /** `SPRITE_SPECS[body].points` id within the class→role set. */
  id: string;
  /** Preferred aim degrees off craft nose (overrides socket `heading`). */
  heading?: number;
  /**
   * Which side of the hull this barrel sits on. Overrides the socket.
   * Drives the sprite side and this barrel’s emit height and flash sort.
   */
  hullPlacement?: "below" | "above";
}

export interface CraftSocket {
  /** Stable physical install id (hangar / save) — location, not weapon. */
  id: string;
  /** Mount class — drives aim policy and weapon fit. */
  class: SocketClass;
  controller: "pilot" | "automatic";
  /** Default installed weapon; hangar may reassign any catalog weapon in `fits`. */
  weapon: WpnId;
  /**
   * Body UVs this socket owns, by id, in fire / overlay order.
   * Resolved only within class→role (turret→gun, fixed→muzzle, hardpoint→hardpoint).
   * Omit → all points of that role (several turrets may share the same gun UVs).
   * Specify only to partition a multi-gun hull (e.g. Gunship spooky/bofors/howitzer).
   */
  points?: SocketPoint[];
  /**
   * Shared rest / preferred aim in degrees off craft nose (0 = forward).
   * Used when `points[i].heading` is omitted — handy for a single-gun socket
   * without stuffing heading into `points: [{ id, heading }]`.
   */
  heading?: number;
  /** Fire cone width in degrees, centered on that barrel’s heading (or 0). Omit = unrestricted. */
  traverse?: number;
  /** Authored multi-muzzle policy belongs to this installation, not the weapon identity. */
  muzzleFire?: "single" | "alternate" | "simultaneous";
  /**
   * Optional turret overlay texture (default: weapon `art.mount`).
   * Use for craft-specific turrets (e.g. hover tank dual-rail cupola).
   */
  gunTex?: string;
  /**
   * Turret hulk texture: when set, this turret pops off the wreck when the craft dies (like enemy turrets).
   * Without authored art of that key, prepareArt bakes a darkened copy of the live turret.
   */
  gunHulk?: string;
  /**
   * Which side of the hull this mount sits on.
   * Draws a turret sprite on that side, and sets leave height and flash sort
   * for turrets and hardpoints. Default below (heli chin / under-wing pylon).
   */
  hullPlacement?: "below" | "above";
  /** Extra draw scale for this turret overlay (× craft `gunOverlayScale`). */
  gunScale?: number;
  /**
   * Shell-gun reverse thrust on this station (same impulse path as craft `cannonInherit`).
   * Use when only one mount should kick — e.g. Marauder howitzer, not crew miniguns.
   */
  recoil?: boolean;
  /** Crew-served station flavor (door / ramp / belly gunners) — not a technical "auto" tag. */
  crew?: CrewRole;
  /** Extra capacity on this station, on top of craft `ammoScale`. */
  ammoMul?: number;
  /**
   * Exact starting ammo for this station, bypassing catalog `ammo` / craft `ammoScale` /
   * `ammoMul` entirely. Use when a socket needs a specific count on its own terms (a capped
   * swarm size, a single-instance deploy) rather than a scaled adjustment.
   */
  ammo?: number;
  /**
   * Multiplies fire rate (shots / time). Omit = 1.
   * Cooldown applied at fire = catalog `fireCd / fireRateMul`.
   */
  fireRateMul?: number;
  /**
   * Engage / beam envelope override in world units (Tesla coil muzzle reach).
   * Omit → weapon catalog `launch.range`.
   */
  range?: number;
  /**
   * Gravity-bomb release for this hardpoint. Socket wins over craft-level `bombDrop`.
   * Lower `momentum` = more aim-directed (Chinook); higher = carry craft velocity (Lightning).
   */
  bombDrop?: CraftBombDrop;
}

/** Per-socket / per-craft gravity-bomb launcher (momentum inherit + capped corrective boost). */
export interface CraftBombDrop {
  /** Fraction of craft horizontal velocity inherited (0–1). */
  momentum: number;
  /** Max horizontal boost toward aim the launcher can add (world units / sec). */
  maxBoost: number;
  /** Base upward release impulse (world units / sec). */
  loft: number;
  /** Optional higher loft when more range is needed (uses the vertical arc). */
  loftMax?: number;
}

/**
 * How the player steers the hull (orthogonal to flightModel dynamics).
 * - aim: nose follows reticle (default helis / most VTOL)
 * - plane: mouse aim + A/D circle offset; banked yaw / gun-brake / jet aim clamp
 * - orbit: hold A/D yaw, W/S speed trim; mouse aims weapons only (AC-130)
 */
export type ControlScheme = "aim" | "plane" | "orbit";

/** Authored exhaust plume for craft with nozzle FX. */
export interface CraftExhaustProfile {
  rate: number;
  speed: number;
  tint: number;
  smoke: number;
  sx: number;
  sy: number;
  life: number;
  /** Nozzle flame scale. 0 = smoke only; a pale `smoke` tint uses the light sheet. */
  flame: number;
  gap: number;
  /** Degrees from warm exhaust art; 0 keeps source orange. */
  flameHue?: number;
  /** Dense ribbon particle counts (jets). */
  ribbonDense?: boolean;
  /** Glow oval follows hull pose instead of jet angle (Prometheus). */
  glowFollowsHull?: boolean;
}

// Manually declared, not `keyof typeof CRAFTS_DEFS` — see RemoteKind's comment in remote.ts
// for why (Craft/Weapon/Remote form a 3-way reference cycle; each catalog's identifier type
// must be a plain leaf, not derived from its own catalog's shape).
export type CraftKind =
  | "apache"
  | "little_bird"
  | "cobra"
  | "viper"
  | "blackhawk"
  | "chinook"
  | "osprey"
  | "stealthhawk"
  | "cyberhawk"
  | "quad_drone"
  | "spectre"
  | "lightning_ii"
  | "warthog"
  | "gunship"
  | "reaper"
  | "prometheus"
  | "skiff"
  | "raptor"
  | "hover_tank"
  | "hound"
  | "humvee"
  | "wolf"
  | "vtol_dropship"
  | "airship"
  | "biplane";

export interface CraftSpec {
  /** Catalog key — must match the CRAFTS entry name. */
  kind: string;
  name: string;
  fullName: string;
  /** Short fantasy combat identity shown on the craft profile (hangar / help). */
  role: string;
  /** Player-facing blurb. What the aircraft is, not a control how-to. */
  description?: string;
  /**
   * Hangar / mission-select roster. Omit or true → playable player craft.
   * False → hull used by remotes / pods only (still `craftOf`-able for Craft).
   */
  playable?: boolean;
  flightModel: "heli" | "vtol" | "plane" | "ground";
  /** Player hull-steer mapping; omit → aim. */
  controlScheme?: ControlScheme;
  /** Hull sweep kills standing troops it drives/flies through at low AGL (roadkill). */
  crushesInfantry?: boolean;
  /** Cannon muzzle impulse inherits craft velocity. */
  cannonInherit?: boolean;
  /** Chin/turret overlay draw scale (cobra/viper 0.42). */
  gunOverlayScale?: number;
  /** Ground hull steers like a wheeled car: yaw rate scales with signed forward speed (no pivoting in place). */
  vehicleSteering?: boolean;
  /** Forward speed (u/s) at which `vehicleSteering` reaches full `yawRate`. */
  steerSpeedRef?: number;
  /**
   * Elastic whip antenna — base UV role `antenna` on the gun overlay (or body).
   * Tip springs upright and wobbles with hull / turret motion.
   */
  antenna?: {
    length?: number;
    aft?: number;
    stiffness?: number;
    damping?: number;
    yawWhip?: number;
    lag?: number;
  };
  /**
   * Extra framing mul on size-based camera scale (<1 zooms out).
   * Use for low ground-huggers that need more theater around the hull.
   */
  cameraScale?: number;
  /** Exhaust nozzle plume; omit → no craft exhaust FX. */
  exhaustProfile?: CraftExhaustProfile;
  /** Largest real-world plan-view envelope in meters; Apache baseline for fictional craft. */
  sizeM: number;
  /** Capacity multiplier for finite-ammo weapons. */
  ammoScale: number;
  health: number;
  /** Collision / silhouette radius (roster marks / future). */
  radius: number;
  /** Collision / aim height (world units). */
  height: number;
  /** Body texture key. */
  body: string;
  hulk: string;
  /** T / sensor-cam thermal look. Omit → white_hot. */
  sensorPalette?: "white_hot" | "full_spectrum" | "black_hot" | "night_vision";
  /**
   * Flat hover plate: no yaw bank lean, no roll foreshorten on the body.
   * Use for ground-huggers (Wraith / HOUND) and heavy sky haulers (Leviathan / Marauder).
   * Omit → normal bank lean / squash.
   */
  flatHull?: boolean;
  /**
   * Ground track prints while moving (tread / tire / …).
   * Used by craft-backed remotes (HOUND) and any dirt-locked hull.
   */
  track?: TrackKind;
  trackGap?: number;
  trackScale?: number;
  /** Rolling wheel debris thrown on death (ground hulls), like unit `wheels`. */
  wheels?: number;
  /** Wheel debris draw scale range [lo, hi]. */
  wheelDebrisScale?: [number, number];
  /**
   * Rotor / thruster overlay texture. Omit for fixed-wing (gunship / warthog).
   * Spin bake is `${rotor}_spin` when present.
   */
  rotor?: string;
  rotorHulk?: string;
  /** Draw multiplier for the rotor overlay relative to its baked texture size. */
  rotorScale?: number;
  /**
   * Blade mass / inertia relative to Apache (= 1). Drives spool duration and
   * spin rate (mission + previews). Omit → derived from `rotorDrawSpan`.
   * Tiny (Murder Hornet ~0.3) = near-instant spool + fast spin; Chinook >1 = slower.
   */
  rotorInertia?: number;
  /** Sprite nose-up offset (world aim 0 is +X). */
  rotOff: number;
  forwardThrust: number;
  /** Optional backward thrust; defaults to forwardThrust. */
  reverseThrust?: number;
  strafeThrust: number;
  maxSpeed: number;
  /** Optional cap on velocity opposite the nose; defaults to maxSpeed. */
  maxReverseSpeed?: number;
  /** Fixed-wing floor; zero for craft that can hover. */
  minSpeed: number;
  yawRate: number;
  yawAccel: number;
  drag: number;
  verticalThrust: number;
  cruiseThrust: number;
  cruiseAgl: number;
  maxAgl: number;
  /** Future pickup/place capability; no cargo gameplay exists yet. */
  liftClass?: "medium" | "heavy";
  /**
   * Fallback gravity-bomb release when a socket omits `bombDrop`.
   * Prefer authoring on the bomb hardpoint itself.
   */
  bombDrop?: CraftBombDrop;
  /**
   * Weapon installs: geometry + policy + default weapon.
   * Hangar loadouts assign any catalog weapon whose `fits` includes `socket.class`.
   */
  sockets: CraftSocket[];
  /** Enemy gun-laying accuracy multiplier; lower is harder to hit. */
  enemyAimMul?: number;
  /** Enemy seeker acquisition/tracking multiplier; lower is harder to lock. */
  enemySeekerMul?: number;
  /** Enemy spotting / chase-engage range multiplier. Does not change aim accuracy or weapon fire range. Helis also get a slight extra cut at low AGL. */
  enemyAwareMul?: number;
  /** Countermeasure on F. Omit → flares. */
  countermeasure?: CountermeasureId;
}

export { CRAFTS } from "../catalog/crafts";
export const DEFAULT_CRAFT: CraftKind = "apache";
export const APACHE_SIZE_M = CRAFTS.apache.sizeM;

let selected: CraftKind = DEFAULT_CRAFT;

export function selectCraft(kind: CraftKind): void {
  selected = kind;
}

export function craftKind(): CraftKind {
  return selected;
}

/** Active craft, or a named one. */
export function craftOf(kind: CraftKind = selected): CraftSpec & { kind: CraftKind } {
  return CRAFTS[kind] as CraftSpec & { kind: CraftKind };
}

/** Player hull-steer scheme (orthogonal to flightModel). */
export function craftControlScheme(c: CraftSpec | CraftKind): ControlScheme {
  const spec = typeof c === "string" ? craftOf(c) : c;
  return spec.controlScheme ?? "aim";
}

/** Hull noses toward the reticle (helis / jets). Orbit scheme is false — keys yaw, mouse aims. */
export function craftNoseFollowsAim(c: CraftSpec = craftOf()): boolean {
  return craftControlScheme(c) !== "orbit";
}

/**
 * Altitude cloud look from cruise AGL (all craft).
 * Higher cruise → smaller / more distant parallax on screen.
 * sizeMul is world scale compensated by craftCameraScale so zoom-out
 * (orbit gunship) doesn't double-shrink clouds vs helis.
 */
export function craftCloudParallax(c: CraftSpec | CraftKind): {
  sizeMul: number;
  alphaMul: number;
  /** 0 = distant sky banks (low scroll), 1 = near-field (scroll toward 1). */
  nearness: number;
} {
  const spec = typeof c === "string" ? craftOf(c) : c;
  const cruise = spec.cruiseAgl;
  // ~heli 40 → gunship 320
  const t = clamp((cruise - 40) / 280, 0, 1);
  // Screen-relative size: heli a bit larger than gunship, not 2×+.
  const screenMul = 0.48 - t * (0.48 - 0.38);
  return {
    sizeMul: screenMul / craftCameraScale(spec),
    alphaMul: 0.82 + t * 0.18,
    nearness: 1 - t,
  };
}

const DEFAULT_BOMB_DROP: CraftBombDrop = {
  momentum: 0.55,
  maxBoost: 160,
  loft: 125,
  loftMax: 210,
};

/** Gravity-bomb release tune: socket → craft → defaults. */
export function craftBombDrop(
  c: CraftSpec = craftOf(),
  socket?: CraftSocket | null
): CraftBombDrop {
  const d = socket?.bombDrop ?? c.bombDrop;
  if (!d) return { ...DEFAULT_BOMB_DROP };
  return {
    momentum: d.momentum,
    maxBoost: d.maxBoost,
    loft: d.loft,
    loftMax: d.loftMax ?? d.loft * 1.7,
  };
}

export function allCrafts(): Array<CraftSpec & { kind: CraftKind }> {
  return allCraftKinds().map((k) => craftOf(k));
}

/** Hangar / mission-select craft — excludes remote-only hulls (`playable: false`). */
export function allCraftKinds(): CraftKind[] {
  return (Object.keys(CRAFTS) as CraftKind[]).filter((k) => CRAFTS[k]!.playable !== false);
}

/** Every CRAFTS key including remote-only hulls (bake / craftOf / Craft). */
export function allCraftHullKinds(): CraftKind[] {
  return Object.keys(CRAFTS) as CraftKind[];
}

/** Real-world plan-view scale relative to the Apache. */
export function craftSizeScale(c: CraftSpec = craftOf()): number {
  return c.sizeM / APACHE_SIZE_M;
}

/** Softer inverse framing adjustment: large craft zoom out, small craft zoom in. */
export function craftCameraScale(c: CraftSpec = craftOf()): number {
  const size = Math.max(0.62, Math.min(1.24, 1 / Math.sqrt(craftSizeScale(c))));
  return size * (c.cameraScale ?? 1);
}

/** Starting capacity for a weapon; unlimited guns remain unlimited. */
export function craftStartingAmmo(baseAmmo: number, c: CraftSpec = craftOf()): number {
  return Number.isFinite(baseAmmo) ? Math.max(1, Math.round(baseAmmo * c.ammoScale)) : Infinity;
}

/** Socket capacity — multi-barrel crew stations keep one shared pool sized for all barrels. */
export function craftSocketStartingAmmo(
  baseAmmo: number,
  c: CraftSpec,
  socketIndex: number
): number {
  const socket = c.sockets[socketIndex];
  if (socket?.ammo != null) return socket.ammo;
  const base = craftStartingAmmo(baseAmmo, c);
  if (!Number.isFinite(base)) return base;
  const sockMul = socket?.ammoMul ?? 1;
  return Math.max(1, Math.round(base * craftSocketBarrelCount(c, socketIndex) * sockMul));
}

/** Catalog fire cooldown scaled by this socket's `fireRateMul` (higher mul = shorter CD). */
export function craftSocketFireCd(
  baseFireCd: number,
  c: CraftSpec,
  socketIndex: number
): number {
  const mul = c.sockets[socketIndex]?.fireRateMul ?? 1;
  return baseFireCd / Math.max(0.05, mul);
}

/** Composite handling rating used by the craft selector and field manual. */
export function craftAgility(c: CraftSpec = craftOf()): number {
  return Math.min(
    1,
    0.45 * (c.yawRate / 4.5) +
      0.25 * (c.yawAccel / 25) +
      0.2 * (c.strafeThrust / 760) +
      0.1 * (0.95 / c.drag)
  );
}

/** Capability hook for the future object/friendly pickup and placement system. */
export function craftCanLift(c: CraftSpec = craftOf()): boolean {
  return c.liftClass != null;
}

/** Live rotor texture key, or undefined for fixed-wing. */
export function craftRotorTex(c: CraftSpec = craftOf()): string | undefined {
  return c.rotor;
}

/** Spin-disc texture for a craft rotor (when baked). */
export function craftRotorSpinTex(c: CraftSpec = craftOf()): string | undefined {
  return c.rotor ? `${c.rotor}_spin` : undefined;
}

export type CraftCompositePart = {
  kind: "gun" | "rotor";
  tex: string;
  spinTex?: string;
  origin: { x: number; y: number };
  mount: { x: number; y: number };
  layer: "below" | "above";
  /** Normalized texture span before the body's display scale is applied. */
  drawSpan?: number;
  /** +1 CW / −1 CCW from above (Phaser rotation sign). */
  spinSign?: 1 | -1;
  /**
   * Gun rest pose for nose-up composite previews (Phaser rotation).
   * Barrel-up art at 0; door/side mounts get craft→mount outward yaw.
   */
  heading?: number;
};

export type CraftComposite = {
  body: { tex: string; origin: { x: number; y: number } };
  guns: CraftCompositePart[];
  rotors: CraftCompositePart[];
};

/** Shared live-rotor diameter policy used by world rendering and previews. */
export function rotorDrawSpan(tex: string, partScale = 1): number {
  if (tex === "craft_apache_rotor") return 124 * 1.08 * partScale;
  if (tex.includes("rotor") && tex !== "enemy_drone_rotor") return 108 * partScale;
  return 108 * partScale;
}

/** Apache main-rotor draw span — inertia reference (= 1). */
export const APACHE_ROTOR_SPAN = rotorDrawSpan("craft_apache_rotor", 1);

/** Largest on-screen rotor diameter for a craft (main disc, not tip tanks). */
export function craftRotorDrawSpan(c: CraftSpec = craftOf()): number {
  if (!c.rotor) return APACHE_ROTOR_SPAN;
  const base = c.rotorScale ?? 1;
  const mounts = rotorMountsOf(c.body);
  if (!mounts.length) return rotorDrawSpan(c.rotor, base);
  let best = 0;
  for (const m of mounts) {
    const span = rotorDrawSpan(c.rotor, base * (m.scale ?? 1));
    if (span > best) best = span;
  }
  return best || rotorDrawSpan(c.rotor, base);
}

/**
 * Blade inertia relative to Apache (1). Authored `rotorInertia` wins; otherwise
 * derived from effective rotor draw span.
 */
export function craftRotorInertia(c: CraftSpec = craftOf()): number {
  if (c.rotorInertia != null) return clamp(c.rotorInertia, 0.12, 3);
  if (!c.rotor) return 1;
  return clamp(craftRotorDrawSpan(c) / APACHE_ROTOR_SPAN, 0.15, 2.5);
}

/** Reference spool / flight rates at Apache inertia (= 1). */
const ROTOR_SPOOL_DUR_REF = 2.35;
const ROTOR_FLIGHT_REF = 32;
const ROTOR_SPOOL_PEAK_REF = 26;

/** Seconds to wind up before lift-off prompt. */
export function craftRotorSpoolDur(c: CraftSpec = craftOf()): number {
  const i = craftRotorInertia(c);
  return clamp(ROTOR_SPOOL_DUR_REF * Math.pow(i, 1.15), 0.22, 4.5);
}

/** Steady flight rotor angular speed. */
export function craftRotorFlightSpeed(c: CraftSpec = craftOf()): number {
  const i = craftRotorInertia(c);
  return clamp(ROTOR_FLIGHT_REF / Math.pow(i, 0.45), 18, 72);
}

/** Peak angular speed at end of spool (before easing up to flight). */
export function craftRotorSpoolPeak(c: CraftSpec = craftOf()): number {
  return craftRotorFlightSpeed(c) * (ROTOR_SPOOL_PEAK_REF / ROTOR_FLIGHT_REF);
}

/** Menu / help idle: ms per full revolution (Apache ≈ 60s). */
export function craftRotorPreviewSpinMs(c: CraftSpec = craftOf()): number {
  return Math.round(60000 * Math.pow(craftRotorInertia(c), 0.85));
}

/**
 * Screen-space disc lean vs body pitch/roll (Apache = 1).
 * Smaller / lighter discs shift less; keeps the fake parallax in proportion.
 */
export function craftRotorTiltMul(c: CraftSpec = craftOf()): number {
  return clamp(craftRotorInertia(c), 0.14, 1.35);
}

/**
 * Along-fuselage scale for rotor/prop discs (local Y after hull heading).
 * Forward-facing props (gunship wings, biplane nose) foreshorten so they read as tilted discs,
 * not top-down pads — driven by each mount point's own authored `role` (`rotor` vs `prop`), not
 * guessed from flight model. No hull mixes the two today, so one verdict per craft is enough.
 */
export function craftRotorAlongScale(c: CraftSpec | CraftKind = craftOf()): number {
  const spec = typeof c === "string" ? craftOf(c) : c;
  if (!spec.rotor) return 1;
  return craftRotorMounts(spec).some((m) => m.role === "prop") ? 0.34 : 1;
}

/** True when rotor overlays are angled prop discs (not top-down lift rotors). */
export function craftRotorIsProp(c: CraftSpec | CraftKind = craftOf()): boolean {
  return craftRotorAlongScale(c) < 0.999;
}

/**
 * Phaser spin sign for a rotor mount (+1 CW, −1 CCW), viewed from above.
 * Western single mains → CCW. Tandem / side-by-side / quad use counter-rotation.
 */
export function rotorSpinSign(
  rotors: { x: number; y: number; id?: string; spin?: 1 | -1 }[],
  index: number
): 1 | -1 {
  const n = rotors.length;
  const p = rotors[index];
  if (!p || n < 1) return -1;
  if (p.spin === 1 || p.spin === -1) return p.spin;
  if (p.id === "tail" || p.id?.startsWith("tail")) return 1;
  if (n === 1) return -1;

  const xs = rotors.map((r) => r.x);
  const ys = rotors.map((r) => r.y);
  const xSpan = Math.max(...xs) - Math.min(...xs);
  const ySpan = Math.max(...ys) - Math.min(...ys);

  if (n === 2 && ySpan > xSpan * 1.15) {
    // Chinook-style tandem: forward CCW, aft CW (CH-47 from above).
    let front = 0;
    for (let i = 1; i < n; i++) if (rotors[i]!.y < rotors[front]!.y) front = i;
    return index === front ? -1 : 1;
  }
  if (n === 2 && xSpan > ySpan * 1.15) {
    // Osprey-style: left CW, right CCW from above.
    let left = 0;
    for (let i = 1; i < n; i++) if (rotors[i]!.x < rotors[left]!.x) left = i;
    return index === left ? 1 : -1;
  }
  if (n >= 3 && xSpan > ySpan * 2.2) {
    // Wing props in a row (gunship): adjacent counter-rotate, outer-left CW.
    const order = rotors.map((_, i) => i).sort((a, b) => rotors[a]!.x - rotors[b]!.x);
    const rank = order.indexOf(index);
    return rank % 2 === 0 ? 1 : -1;
  }
  if (n >= 4) {
    // Quad X: FL+RR CW, FR+RL CCW (nose = smaller y).
    const midX = (Math.min(...xs) + Math.max(...xs)) * 0.5;
    const midY = (Math.min(...ys) + Math.max(...ys)) * 0.5;
    const left = p.x < midX;
    const nose = p.y < midY;
    if (nose && left) return 1;
    if (nose && !left) return -1;
    if (!nose && left) return -1;
    return 1;
  }
  return index % 2 === 0 ? -1 : 1;
}

/** Rotor UVs for a hull texture (craft body or unit) — `rotor` (top-down disc) or `prop`
 * (forward-facing propeller), as authored on the point itself. */
export function rotorMountsOf(
  texKey: string
): { x: number; y: number; role: "rotor" | "prop"; scale?: number; id?: string; spin?: 1 | -1 }[] {
  const mounts = lookupSpritePoints(texKey)
    .filter((point): point is typeof point & { role: "rotor" | "prop" } => point.role === "rotor" || point.role === "prop")
    .map((point) => ({
      x: point.x,
      y: point.y,
      role: point.role,
      ...(point.scale != null ? { scale: point.scale } : {}),
      ...(point.id != null ? { id: point.id } : {}),
      ...(point.spin === 1 || point.spin === -1 ? { spin: point.spin } : {}),
    }));
  return mounts.length ? mounts : [{ x: 0.5, y: 0.5, role: "rotor" as const }];
}

/** Authored rotor centers and optional per-mount scales; body center if none authored. */
export function craftRotorMounts(c: CraftSpec = craftOf()): {
  x: number;
  y: number;
  role: "rotor" | "prop";
  scale?: number;
  id?: string;
  spin?: 1 | -1;
}[] {
  return rotorMountsOf(c.body);
}

/**
 * Visible gun overlay texture for a craft.
 * Prefers PlayerWpnSpec.mount for the first turret socket that has mount art.
 */
export function craftGunTexture(c: CraftSpec = craftOf()): string | undefined {
  const sock = c.sockets.find(
    (s) => (s.class === "turret") && !!(s.gunTex || weaponMountTex(s.weapon))
  );
  return sock ? sock.gunTex ?? weaponMountTex(sock.weapon) : undefined;
}

/** Stable key for a body gun UV — id when authored, else quantized xy. */
function craftGunMountKey(p: { x: number; y: number; id?: string }): string {
  return p.id ?? `${p.x.toFixed(5)},${p.y.toFixed(5)}`;
}

/**
 * Overlay barrels: one gun art per body gun mount, first turret socket wins.
 * Later turrets that resolve to an already-claimed UV (e.g. Cyber Hawk Tesla on chin)
 * are skipped so previews don't stack mount art.
 */
function craftGunOverlayBarrels(
  c: CraftSpec
): { slot: number; x: number; y: number }[] {
  const claimed = new Set<string>();
  const out: { slot: number; x: number; y: number }[] = [];
  for (let i = 0; i < c.sockets.length; i++) {
    const s = c.sockets[i]!;
    if (s.class !== "turret" || !(s.gunTex || weaponMountTex(s.weapon))) continue;
    for (const p of craftSocketGunPoints(c, i)) {
      const key = craftGunMountKey(p);
      if (claimed.has(key)) continue;
      claimed.add(key);
      out.push({ slot: i, x: p.x, y: p.y });
    }
  }
  return out;
}

/** Live turret overlay texture for a socket (authored gunTex, else the weapon's mount art). */
export function socketGunTex(s: CraftSocket): string | undefined {
  return s.gunTex ?? weaponMountTex(s.weapon);
}

/** A craft's onboard turret socket, if it has one — the one source of gun art/scale. */
export function craftTurretSocket(c: CraftSpec): CraftSocket | undefined {
  return c.sockets.find((s) => s.class === "turret");
}

/** A craft's primary gun mount — turret first, else any socket with a weapon (fixed nose guns). */
export function craftGunSocket(c: CraftSpec): CraftSocket | undefined {
  return craftTurretSocket(c) ?? c.sockets.find((s) => s.weapon != null);
}

/** AI gun id for firing / aim-precision lookups — a craft's one primary onboard gun. */
export function craftGunId(c: CraftSpec): WpnId | undefined {
  return craftGunSocket(c)?.weapon;
}

/** Gun overlay art — turret-only; fixed hull muzzles fire from body UVs, no overlay sprite. */
export function craftGunTex(c: CraftSpec): string | undefined {
  return craftTurretSocket(c)?.gunTex;
}

/** Gun overlay draw scale for a specific socket — hull-wide gunOverlayScale × socket gunScale. */
export function craftSocketGunScale(c: CraftSpec, socket: CraftSocket | undefined, defaultSockScale = 1): number {
  return (c.gunOverlayScale ?? 1) * (socket?.gunScale ?? defaultSockScale);
}

/** Gun overlay draw scale for a craft's one primary turret (Hound/Humvee/Wolf-style single gun). */
export function craftGunScale(c: CraftSpec): number {
  return craftSocketGunScale(c, craftTurretSocket(c), 0.55);
}

/** Socket indices that own a visible gun overlay (matches `craftComposite(...).guns` order).
 * Multi-barrel turret sockets repeat their slot index once per barrel.
 * Fixed / hardpoint stations never contribute — hull-baked muzzles have no overlay.
 * Each body gun UV is claimed once (first socket in loadout order). */
export function craftGunSocketSlots(c: CraftSpec = craftOf()): number[] {
  return craftGunOverlayBarrels(c).map((b) => b.slot);
}

/**
 * Overlay barrel count for a turret socket with mount art.
 * Omit `points` → every `role: "gun"` UV (shared across turrets is fine).
 */
export function craftSocketBarrelCount(c: CraftSpec, socketIndex: number): number {
  const socket = c.sockets[socketIndex];
  if (!socket) return 1;
  if (socket.class !== "turret" || !(socket.gunTex || weaponMountTex(socket.weapon))) return 1;
  return craftSocketGunPoints(c, socketIndex).length;
}

/**
 * Resolved body gun UVs for a socket (overlay / fire order).
 * - `points` listed → those gun ids in list order.
 * - Else → all `role: "gun"` points (overlay dedupes via `craftGunOverlayBarrels`).
 */
export function craftSocketGunPoints(
  c: CraftSpec,
  socketIndex: number
): { x: number; y: number; id?: string }[] {
  const socket = c.sockets[socketIndex];
  if (!socket || socket.class !== "turret" || !(socket.gunTex || weaponMountTex(socket.weapon))) return [];
  if (socket.points?.length) {
    return resolveSocketPointIds(c, socket, "gun");
  }
  return lookupSpritePoints(c.body, "gun").map((p) => ({ x: p.x, y: p.y, id: p.id }));
}

/** Every authored player gun mount, in firing / overlay order (socket groups).
 * One entry per body UV — first turret socket that claims it wins. */
export function craftGunMounts(c: CraftSpec = craftOf()): { x: number; y: number }[] {
  const ordered = craftGunOverlayBarrels(c).map((b) => ({ x: b.x, y: b.y }));
  if (ordered.length) return ordered;
  return mountsOf(c.body, "gun");
}

/**
 * Preferred aim degrees off craft nose for a barrel:
 * `points[barrel].heading` → socket `heading` → 0.
 */
export function craftGunPreferDegrees(c: CraftSpec, slot: number, barrel = 0): number {
  const socket = c.sockets[slot];
  if (!socket) return 0;
  return socket.points?.[barrel]?.heading ?? socket.heading ?? 0;
}

/** Preferred aim offset in radians (overlay / station init). */
export function craftGunPreferOffset(c: CraftSpec, slot: number, barrel = 0): number {
  return (craftGunPreferDegrees(c, slot, barrel) * Math.PI) / 180;
}

/** Body gun UV for a socket barrel (same order as `craftComposite(...).guns`). */
export function craftGunMountForBarrel(
  c: CraftSpec,
  slot: number,
  barrel = 0
): { x: number; y: number } {
  const mounts = craftGunMounts(c);
  const slots = craftGunSocketSlots(c);
  let seen = 0;
  for (let i = 0; i < slots.length; i++) {
    if (slots[i] !== slot) continue;
    if (seen === barrel) return mounts[i] ?? mounts[0] ?? craftOrigin(c);
    seen++;
  }
  return mounts[0] ?? craftOrigin(c);
}

/** Which side of the hull a mount sits on. Default is under the hull. */
export type HullPlacement = "below" | "above";

/**
 * Socket placement, with a barrel point overriding the socket.
 * Same value draws the sprite on that side and sets that barrel’s emit height and flash sort.
 */
export function socketHullPlacement(
  sock: { hullPlacement?: HullPlacement; points?: { hullPlacement?: HullPlacement }[] } | undefined,
  barrel = 0
): HullPlacement {
  return sock?.points?.[barrel]?.hullPlacement ?? sock?.hullPlacement ?? "below";
}

/** Authoritative visual parts and mounts for composing a craft in any view. */
export function craftComposite(c: CraftSpec = craftOf()): CraftComposite {
  const rotorTex = craftRotorTex(c);
  const gunMounts = craftGunMounts(c);
  const gunSlots = craftGunSocketSlots(c);
  const barrelOf = new Map<number, number>();
  return {
    body: { tex: c.body, origin: craftOrigin(c) },
    guns: gunSlots.map((slot, i) => {
      const sock = c.sockets[slot]!;
      const tex = sock.gunTex ?? weaponMountTex(sock.weapon)!;
      const barrel = barrelOf.get(slot) ?? 0;
      barrelOf.set(slot, barrel + 1);
      // Barrel-up gun art: Phaser rot = prefer offset (nose → 0).
      const heading = craftGunPreferOffset(c, slot, barrel);
      return {
        kind: "gun" as const,
        tex,
        origin: lookupSpriteOrigin(tex) ?? craftGunOrigin(c),
        mount: gunMounts[i] ?? gunMounts[0] ?? craftOrigin(c),
        layer: socketHullPlacement(sock, barrel),
        heading,
      };
    }),
    rotors: rotorTex
      ? craftRotorMounts(c).map((mount, i, mounts) => ({
          kind: "rotor",
          tex: rotorTex,
          spinTex: craftRotorSpinTex(c),
          origin: lookupSpriteOrigin(rotorTex) ?? DEFAULT_ORIGIN,
          mount,
          layer: "above",
          spinSign: rotorSpinSign(mounts, i),
          drawSpan: rotorDrawSpan(
            rotorTex,
            (c.rotorScale ?? 1) * (mount.scale ?? 1)
          ),
        }))
      : [],
  };
}

/** Scale a composite part consistently against a body view scale. */
export function craftCompositePartScale(
  part: { drawSpan?: number },
  textureWidth: number,
  bodyScale: number
): number {
  return part.drawSpan == null
    ? bodyScale
    : (part.drawSpan / Math.max(1, textureWidth)) * bodyScale;
}

/**
 * Fit a craft body texture into a UI box without upscaling past native pixels.
 * Shared by selection / help / other UI previews — not the roster zoom path.
 */
export function craftPreviewFitScale(
  bodyW: number,
  bodyH: number,
  boxW: number,
  boxH: number,
  maxScale = 1
): number {
  return Math.min(maxScale, boxW / Math.max(1, bodyW), boxH / Math.max(1, bodyH));
}

/** Exhaust glow display scale — compact wash at the nozzle base. */
export function craftPreviewExhaustScale(bodyScale: number): { x: number; y: number } {
  const s = bodyScale * 0.42;
  return { x: s, y: s * 0.85 };
}

/** Per-craft exhaust glow tint for UI previews. */
export function craftPreviewExhaustTint(kind: CraftKind | string): number {
  if (typeof kind === "string" && kind in CRAFTS) {
    return CRAFTS[kind as CraftKind].exhaustProfile?.tint ?? 0x70d8ff;
  }
  return 0x70d8ff;
}

/**
 * Hue rotation (degrees) from the authored warm exhaust/flame art toward each
 * craft's look. 0 keeps the source orange grading intact.
 * Nozzle Images use runtime ColorMatrix; trail particles use pre-baked sheets
 * (`craftExhaustFlameSheet`) because ParticleEmitter has no preFX.
 */
export function craftExhaustFlameHue(kind: CraftKind | string): number {
  if (typeof kind === "string" && kind in CRAFTS) {
    return CRAFTS[kind as CraftKind].exhaustProfile?.flameHue ?? 172;
  }
  return 172;
}

/** Non-zero trail flame hues that must exist as `fx_flame_hue_<n>` sheets. */
export const EXHAUST_TRAIL_FLAME_HUES: readonly number[] = [172, 185, 248];

/** Particle texture for craft exhaust trails (graded flame, hue pre-baked). */
export function craftExhaustFlameSheet(kind: CraftKind | string): string {
  const hue = craftExhaustFlameHue(kind);
  if (hue === 0) return "fx_flame";
  // Only EXHAUST_TRAIL_FLAME_HUES are baked — missing keys show as green boxes.
  if ((EXHAUST_TRAIL_FLAME_HUES as readonly number[]).includes(hue)) {
    return `fx_flame_hue_${hue}`;
  }
  return "fx_flame";
}

/** Body origin from SPRITE_SPECS. */
export function craftOrigin(c: CraftSpec = craftOf()): { x: number; y: number } {
  return lookupSpriteOrigin(c.body) ?? DEFAULT_ORIGIN;
}

/** Chin gun attach UV on the body. */
export function craftGunMount(c: CraftSpec = craftOf()): { x: number; y: number } {
  return craftGunMounts(c)[0] ?? craftOrigin(c);
}

/** Fixed gun muzzle UVs authored directly on the craft body. */
export function craftFixedMuzzles(c: CraftSpec = craftOf()): { x: number; y: number }[] {
  return mountsOf(c.body, "muzzle");
}

/** Pivot on the gun sprite. */
export function craftGunOrigin(c: CraftSpec = craftOf()): { x: number; y: number } {
  const tex = craftGunTexture(c);
  return (tex ? lookupSpriteOrigin(tex) : undefined) ?? DEFAULT_ORIGIN;
}

/** Body UV role derived from socket class: turret→gun, fixed→muzzle, hardpoint→hardpoint. */
function socketPointRole(socket: { class: string }): "gun" | "muzzle" | "hardpoint" {
  if (socket.class === "turret") return "gun";
  if (socket.class === "fixed") return "muzzle";
  return "hardpoint";
}

/** Resolve `socket.points` ids against body UVs of the given role (throws on miss). */
function resolveSocketPointIds(
  c: CraftSpec,
  socket: CraftSocket,
  role: "gun" | "muzzle" | "hardpoint"
): { x: number; y: number; id?: string }[] {
  const refs = socket.points;
  if (!refs?.length) return [];
  const byId = new Map<string, { x: number; y: number; id?: string }>();
  for (const p of lookupSpritePoints(c.body, role)) {
    if (p.id) byId.set(p.id, { x: p.x, y: p.y, id: p.id });
  }
  return refs.map((ref) => {
    const p = byId.get(ref.id);
    if (!p) {
      throw new Error(`${c.kind} socket "${socket.id}": no ${role} point id "${ref.id}"`);
    }
    return p;
  });
}

/**
 * Soft socket UV resolve on any texture key (host body or remote `look` override).
 * Missing point ids fall through to role / gun↔muzzle / hardpoint fallbacks.
 */
export function socketPointsOnKey(
  key: string,
  socket: { class: string; points?: { id: string }[] }
): { x: number; y: number; id?: string }[] {
  const role = socketPointRole(socket);
  if (socket.points?.length) {
    const byId = new Map<string, { x: number; y: number; id?: string }>();
    for (const p of lookupSpritePoints(key, role)) {
      if (p.id) byId.set(p.id, { x: p.x, y: p.y, id: p.id });
    }
    const resolved = socket.points
      .map((ref) => byId.get(ref.id))
      .filter((p): p is { x: number; y: number; id?: string } => !!p);
    if (resolved.length) return resolved;
  }
  const primary = lookupSpritePoints(key, role);
  if (primary.length) return primary.map((p) => ({ x: p.x, y: p.y, id: p.id }));
  if (role === "muzzle") {
    const gun = lookupSpritePoints(key, "gun");
    if (gun.length) return gun.map((p) => ({ x: p.x, y: p.y, id: p.id }));
  }
  if (role === "gun") {
    const muzzle = lookupSpritePoints(key, "muzzle");
    if (muzzle.length) return muzzle.map((p) => ({ x: p.x, y: p.y, id: p.id }));
  }
  return lookupSpritePoints(key, "hardpoint").map((p) => ({ x: p.x, y: p.y, id: p.id }));
}

/**
 * Emit / attach UVs for a socket on the craft body texture.
 * Optional `points` partitions ids within class→role (strict — throws on miss);
 * omit → all of role (+ gun↔muzzle / hardpoint fallbacks when empty).
 */
export function craftSocketPoints(
  c: CraftSpec,
  socket: CraftSocket
): { x: number; y: number; id?: string }[] {
  const role = socketPointRole(socket);
  if (socket.points?.length) {
    return resolveSocketPointIds(c, socket, role);
  }
  return socketPointsOnKey(c.body, socket);
}

/** Wing / store hardpoint UVs — left → right. */
export function craftHardpointMounts(c: CraftSpec = craftOf()): { x: number; y: number }[] {
  return mountsOf(c.body, "hardpoint");
}

/** True when the craft aims a turret gun independently of the hull. */
export function craftAimsWithTurret(c: CraftSpec = craftOf()): boolean {
  return c.sockets.some((s) => s.class === "turret");
}

/** Default weapon ids in HUD / fire order. */
export function craftSocketWeapons(c: CraftSpec = craftOf()): WpnId[] {
  return c.sockets.map((s) => s.weapon);
}

/**
 * How many barrels / installs a socket represents for loadout UI.
 * Simultaneous multi-muzzle (fixed body tips or turret gun-tex tips) count;
 * alternate tips are one weapon (they cycle, not fire as a pair).
 */
export function craftSocketMultiplicity(c: CraftSpec, socketIndex: number): number {
  const socket = c.sockets[socketIndex];
  if (!socket) return 1;
  if (socket.class === "fixed") {
    const pts = craftSocketPoints(c, socket);
    if (pts.length > 1 && socket.muzzleFire === "simultaneous") {
      return pts.length;
    }
    return 1;
  }
  if (socket.class === "turret") {
    const mounts = craftSocketBarrelCount(c, socketIndex);
    if (socket.muzzleFire === "simultaneous") {
      const tex = socket.gunTex ?? weaponMountTex(socket.weapon);
      const tips = tex ? lookupSpriteMuzzles(tex).length : 1;
      if (tips > 1) return mounts * tips;
    }
    return mounts;
  }
  return 1;
}

/**
 * How many concurrent fire streams a socket contributes to sustained DPS.
 * Simultaneous multi-muzzle and automatic multi-barrel turrets count fully;
 * alternate muzzles are one stream (tips cycle, same cadence).
 */
export function craftSocketFireStreams(c: CraftSpec, socketIndex: number): number {
  const socket = c.sockets[socketIndex];
  if (!socket) return 1;
  if (socket.class === "fixed") {
    const pts = craftSocketPoints(c, socket);
    if (pts.length > 1 && socket.muzzleFire === "simultaneous") return pts.length;
    return 1;
  }
  if (socket.class === "turret") {
    const mounts = Math.max(1, craftSocketBarrelCount(c, socketIndex));
    if (socket.muzzleFire === "simultaneous") {
      const tex = socket.gunTex ?? weaponMountTex(socket.weapon);
      const tips = tex ? lookupSpriteMuzzles(tex).length : 1;
      if (tips > 1) return mounts * tips;
    }
    if (socket.controller === "automatic") return mounts;
    return 1;
  }
  return 1;
}

/** Gun stations (chin / fixed / crew) vs hardpoint ordnance. */
export function craftSocketIsPrimary(socket: CraftSocket): boolean {
  return socket.class === "turret" || socket.class === "fixed";
}

/**
 * One socket's burst-window firepower — `playerWeaponBurstFirepower` (not a smoothed sustained
 * DPS) so it reflects cluster bomblets / call-strike shells that land within the window, and a
 * single heavy hit (a howitzer round, a MOAB) counts fully rather than being time-averaged down
 * by its slow cooldown. Multiplies by `craftSocketFireStreams` so automatic multi-barrel turrets
 * and simultaneous muzzles count every concurrent stream rather than a single shot.
 *
 * A socket whose weapon deploys a remote (`payload.remote` — Skiff wingmen, Raptor fighters, the
 * HOUND AGV) only counts the launcher's own negligible deploy/detonate hit here; see
 * `craftFirepowerWithRemotes` (sim/remote.ts) for the deployed hull's own loadout, which needs
 * `remoteSpecOf`/`remoteHull` and would circularly import this module.
 */
export function craftSocketFirepower(c: CraftSpec, socketIndex: number): number {
  const socket = c.sockets[socketIndex];
  const w = socket && PLAYER_WPNS[socket.weapon];
  if (!socket || !w) return 0;
  return playerWeaponBurstFirepower(w, socket.fireRateMul ?? 1) * craftSocketFireStreams(c, socketIndex);
}

/** Sums `craftSocketFirepower` across every socket, plus the same per-target-class after dmgMul. */
export function craftFirepower(c: CraftSpec): { total: number; byClass: Record<UnitClass, number> } {
  let total = 0;
  const byClass: Record<UnitClass, number> = { air: 0, vehicle: 0, building: 0, troop: 0 };
  c.sockets.forEach((socket, i) => {
    const w = PLAYER_WPNS[socket.weapon];
    if (!w) return;
    const burst = craftSocketFirepower(c, i);
    total += burst;
    (Object.keys(byClass) as UnitClass[]).forEach((cls) => {
      byClass[cls] += burst * playerWeaponClassMul(w, cls);
    });
  });
  return { total, byClass };
}

const CREW_LOADOUT_SUFFIX: Record<CrewRole, string> = {
  door: "DOOR GUNNERS",
  ramp: "RAMP GUNNER",
  belly: "BELLY GUNNER",
  dorsal: "DORSAL GUNNER",
  coax: "COAX GUNNER",
};

const CREW_HUD_TAG: Record<CrewRole, string> = {
  door: "DOOR",
  ramp: "RAMP",
  belly: "BELLY",
  dorsal: "DORSAL",
  coax: "COAX",
};

/** Short HUD tag for crew-served stations (replaces technical "AUTO"). */
export function craftCrewHudTag(socket: CraftSocket): string | undefined {
  return socket.crew ? CREW_HUD_TAG[socket.crew] : socket.controller === "automatic" ? "CREW" : undefined;
}

/** Loadout label parts — weapon name vs crew designation (for multi-color UI). */
export function craftLoadoutParts(
  c: CraftSpec,
  socketIndex: number,
  fullName: string
): { base: string; crew?: string } {
  const socket = c.sockets[socketIndex];
  const n = craftSocketMultiplicity(c, socketIndex);
  const base = n <= 1 ? fullName : `${n}× ${fullName}`;
  if (socket?.crew) return { base, crew: ` · ${CREW_LOADOUT_SUFFIX[socket.crew]}` };
  // Automatic stations without an authored crew role still read as crew-served, not pilot.
  if (socket?.controller === "automatic") return { base, crew: " · CREW" };
  return { base };
}

/** Loadout label with 2× / N× and optional crew designation. */
export function craftLoadoutLabel(
  c: CraftSpec,
  socketIndex: number,
  fullName: string
): string {
  const { base, crew } = craftLoadoutParts(c, socketIndex, fullName);
  return crew ? `${base}${crew}` : base;
}

/** Authored visual exhaust emit points on the craft body. */
export function craftExhaustMounts(c: CraftSpec = craftOf()): { x: number; y: number }[] {
  return mountsOf(c.body, "exhaust");
}

/** Wingtip UVs for bank contrails (jets). */
export function craftWingTipMounts(c: CraftSpec = craftOf()): { x: number; y: number; id?: string }[] {
  return lookupSpritePoints(c.body, "wingtip");
}

/** Pivot for a craft texture (body origin or gun origin). */
export function craftPivot(key: string): { x: number; y: number } | undefined {
  const k = key.replace(/__(woodland|desert|urban|snow|digital)$/, "");
  for (const c of allCrafts()) {
    if (c.body === k || c.hulk === k) return craftOrigin(c);
  }
  return undefined;
}

/** Tagged hull mounts for a craft — from SPRITE_SPECS body points (ids preserved). */
export function craftMountsOf(sp: CraftSpec): HullMount[] {
  const roles: HullMountRole[] = ["gun", "rotor", "hardpoint", "exhaust", "wingtip"];
  const tagged: HullMount[] = [];
  for (const role of roles) {
    for (const p of lookupSpritePoints(sp.body, role)) {
      tagged.push({
        x: p.x,
        y: p.y,
        role,
        label: spritePointLabel(p),
        id: p.id,
      });
    }
  }
  return tagged;
}
