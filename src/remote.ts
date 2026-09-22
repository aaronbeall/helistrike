/** Launched craft pods — Spectre, airship wingmen/fighter, HOUND AGV.
 *
 * Remotes are their own roster (`REMOTE_DEFS` → `remoteSpecOf`).
 * Hull / flight / sockets live on a CraftSpec (`craftLook`); this file only authors
 * lifecycle (battery, dock, AI flags, host escort) plus optional overrides
 * (scale, look art, fragile health, skiff skin, …).
 */
import {
  craftControlScheme,
  craftOf,
  rotorDrawSpan,
  rotorSpinSign,
  type CraftCompositePart,
  type CraftKind,
  type CraftSocket,
  type CraftSpec,
} from "./craft";
import {
  playerLoadoutFromSockets,
  type PlayerWpnSpec,
  type WpnId,
} from "./combat";
import type { TrackKind } from "./roster";
import { lookupSpriteOrigin, lookupSpritePoints } from "./spriteOrigin";

export type RemoteKind = "spectre" | "wingman" | "fighter" | "agv";

/** Pilot steer model — aim faces mouse; orbit is tank; plane is force-forward. */
export type RemoteControl = "aim" | "orbit" | "plane";

/**
 * Resolved remote — always complete for gameplay.
 * Built by `remoteSpecOf` from authored defs + optional craft hull.
 */
export interface RemoteSpec {
  kind: RemoteKind;
  name: string;
  health: number;
  radius: number;
  height: number;
  maxSpeed: number;
  thrust: number;
  strafe: number;
  yawRate: number;
  climbRate: number;
  cruiseAgl: number;
  life: number;
  detonateDmg: number;
  detonateBlast: number;
  launchSpeed: number;
  look: string;
  scale: number;
  thermal?: boolean;
  /** AI patrols / attacks without player pilot. */
  ai?: boolean;
  /** Player can take remote cam + WASD even when `ai` (HOUND). */
  pilotable?: boolean;
  /** Can re-dock with host craft (refunds ammo / despawns peacefully). */
  dockable?: boolean;
  /** Ground-hugging AGV — clamps to terrain. */
  ground?: boolean;
  /**
   * POV remotes with their own weapon HUD (HOUND / Raptor).
   * From craft hull when `pilotable`, unless overridden.
   */
  sockets?: CraftSocket[];
  /** Capacity scale for `sockets` (default hull ammoScale). */
  ammoScale?: number;
  /** Onboard gun for AI / turret overlay (defaults to first turret socket). */
  gun?: WpnId;
  /** Gun sprite key (defaults to weapon mount art). */
  gunTex?: string;
  gunScale?: number;
  /** Tank-style A/D yaw + W/S thrust, or plane force-forward. */
  control?: RemoteControl;
  /** Plane remotes — keep this much forward speed (world units/s). */
  minSpeed?: number;
  /** Ground track prints. */
  track?: TrackKind;
  trackGap?: number;
  trackScale?: number;
  /**
   * Soft linger smoke from the tail while moving (HOUND).
   * Rate scales with speed / maxSpeed — idle = no plume.
   */
  exhaustSmoke?: {
    /** Particles / sec at full speed. */
    rate: number;
    /** Emitter scale (linger puff size). */
    size?: number;
    tint?: number;
    /** World units behind center along −heading. Omit → radius × 0.75. */
    aft?: number;
  };
  /**
   * Elastic whip antenna — base UV role `antenna` on `look`.
   * Tip springs upright (Z + slight aft) and wobbles with thrust / yaw.
   */
  antenna?: {
    /** Rest height above the mount (world Z). */
    length?: number;
    /** Rest tip bias aft along −heading (world). */
    aft?: number;
    stiffness?: number;
    damping?: number;
    /** Extra yaw-rate whip (rad/s → tip kick). */
    yawWhip?: number;
    /** Linear accel lag (tip resists base motion). */
    lag?: number;
  };
  /** AI engage / fire radius. */
  engageRange?: number;
  /** AI orbit radius around a locked hostile (strafe ring). */
  orbitRange?: number;
  /** Shared friendly sensor radius — enemies inside this of any friendly are known. */
  awareRange?: number;
  /** Idle escort ring around host (airship / raptor), beyond host radius. */
  escortRange?: number;
  /**
   * When piloting this POV remote, the host craft escorts it.
   * Follow keeps within outerRadius (seeks innerRadius when outside);
   * Hold parks the host. Toggle is player-side (default hold).
   */
  hostEscort?: {
    /** Comfort / target standoff from the remote. */
    innerRadius: number;
    /** Soft leash — if broken, host heads back to innerRadius. */
    outerRadius: number;
  };
  /** Stop near mouse while autonomous (HOUND always tracks pointer). */
  mouseStopRange?: number;
  /**
   * While piloting this POV remote, the host hull yaws toward it (no follow thrust).
   * Used by Raptor / Leviathan — separate from HOUND FOLLOW|HOLD leash.
   */
  hostFace?: boolean;
  /** CraftKind hull for flight / sockets / silhouette. */
  craftLook: CraftKind;
  /** Nose-up art offset override (defaults from hull). */
  rotOff?: number;
}

/**
 * Authored remote roster entry — lifecycle + optional overrides.
 * Hull fields are filled from `craftLook` in `remoteSpecOf`.
 */
type RemoteDef = {
  kind: RemoteKind;
  name: string;
  life: number;
  detonateDmg: number;
  detonateBlast: number;
  launchSpeed: number;
  scale: number;
  craftLook: CraftKind;
  /** Override hull body art (e.g. Skiff skin on biplane flight). */
  look?: string;
  health?: number;
  radius?: number;
  height?: number;
  maxSpeed?: number;
  thrust?: number;
  strafe?: number;
  yawRate?: number;
  climbRate?: number;
  cruiseAgl?: number;
  thermal?: boolean;
  ai?: boolean;
  pilotable?: boolean;
  dockable?: boolean;
  ground?: boolean;
  sockets?: CraftSocket[];
  ammoScale?: number;
  gun?: WpnId;
  gunTex?: string;
  gunScale?: number;
  control?: RemoteControl;
  minSpeed?: number;
  track?: TrackKind;
  trackGap?: number;
  trackScale?: number;
  exhaustSmoke?: RemoteSpec["exhaustSmoke"];
  antenna?: RemoteSpec["antenna"];
  engageRange?: number;
  orbitRange?: number;
  awareRange?: number;
  escortRange?: number;
  hostEscort?: RemoteSpec["hostEscort"];
  mouseStopRange?: number;
  hostFace?: boolean;
  rotOff?: number;
};

export interface RemoteCraft {
  id: number;
  spec: RemoteSpec;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  angle: number;
  health: number;
  life: number;
  lifeMax: number;
  rotor: number;
  detonate?: boolean;
  /** Peaceful dock — no boom, refunds launch ammo when possible. */
  dock?: boolean;
  /** Orbit phase for AI wingmen / HOUND. */
  orbit?: number;
  /** Onboard gun cooldown (AI / legacy single-gun). */
  gunCd?: number;
  /** Selected POV loadout fire cooldown. */
  fireCd?: number;
  /** Turret aim (world radians). */
  gunAngle?: number;
  /** Visual bank / pitch from craft flight (plane remotes). */
  roll?: number;
  pitch?: number;
  /** Track print distance accumulator. */
  track?: number;
  /** Exhaust smoke emit accumulator (fractional particles). */
  exhaustCarry?: number;
  /** Spring whip antenna tip (world) + velocity. */
  antenna?: {
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    vz: number;
    /** Prior base for accel / yaw whip. */
    bx: number;
    by: number;
    bz: number;
    bvx: number;
    bvy: number;
    angle: number;
  };
  /** AI engage unit id. */
  aiTargetId?: number;
  /**
   * Skiff attack-pass FSM: `run` lines up fixed guns and fires;
   * `break` overshoots then turns for another pass.
   */
  aiPass?: "run" | "break";
  /** Per-tip screen samples for wingtip contrail stretch (plane remotes). */
  wingTrailPrevScreen?: ({ x: number; y: number } | undefined)[];
  wingTrailEmitCarry?: number;
  wingTrailMountCursor?: number;
  /** Airborne drop — falls until snap-land on ground. */
  airborne?: boolean;
  /** Resolved POV loadout (from `spec.sockets`). */
  loadout?: PlayerWpnSpec[];
  /** Per-slot ammo for POV loadout. */
  ammo?: number[];
  /** Selected POV loadout slot. */
  weapon?: number;
}

/** True when this remote replaces the player weapon HUD while piloted. */
export function remoteHasPovHud(spec: RemoteSpec): boolean {
  return !!spec.sockets?.length;
}

/** Socket capacity — mirrors craft `ammoScale` × socket `ammoMul`. */
export function remoteSocketStartingAmmo(
  baseAmmo: number,
  spec: RemoteSpec,
  socketIndex: number
): number {
  const scale = spec.ammoScale ?? 1;
  const base = Number.isFinite(baseAmmo)
    ? Math.max(1, Math.round(baseAmmo * scale))
    : Infinity;
  if (!Number.isFinite(base)) return base;
  const sockMul = spec.sockets?.[socketIndex]?.ammoMul ?? 1;
  return Math.max(1, Math.round(base * sockMul));
}

/** Build / refresh live loadout + ammo from authored sockets. */
export function initRemoteLoadout(r: RemoteCraft): void {
  const sockets = r.spec.sockets;
  if (!sockets?.length) {
    r.loadout = undefined;
    r.ammo = undefined;
    r.weapon = undefined;
    r.fireCd = undefined;
    return;
  }
  r.loadout = playerLoadoutFromSockets(sockets);
  r.ammo = r.loadout.map((w, i) => remoteSocketStartingAmmo(w.ammo, r.spec, i));
  r.weapon = 0;
  r.fireCd = 0;
}

/** AI gun id — authored `gun`, else turret, else first fixed socket (Raptor nose guns). */
export function remoteGunId(spec: RemoteSpec): WpnId | undefined {
  if (spec.gun) return spec.gun;
  const turret = spec.sockets?.find((s) => s.class === "turret");
  if (turret?.weapon) return turret.weapon;
  return spec.sockets?.find((s) => s.class === "fixed")?.weapon;
}

/**
 * Spinning rotor overlays for a remote — only when the look sprite authors
 * `role: "rotor"` UVs and `craftLook` supplies a rotor texture.
 * (No inventing a center disc; HOUND has neither → empty.)
 */
export function remoteRotorParts(spec: RemoteSpec): CraftCompositePart[] {
  if (!spec.craftLook) return [];
  const hull = craftOf(spec.craftLook);
  const rotorTex = hull.rotor;
  if (!rotorTex) return [];
  const mounts = lookupSpritePoints(spec.look)
    .filter((p) => p.role === "rotor")
    .map((p) => ({
      x: p.x,
      y: p.y,
      ...(p.scale != null ? { scale: p.scale } : {}),
      ...(p.id != null ? { id: p.id } : {}),
      ...(p.spin === 1 || p.spin === -1 ? { spin: p.spin as 1 | -1 } : {}),
    }));
  if (!mounts.length) return [];
  const origin = lookupSpriteOrigin(rotorTex) ?? { x: 0.5, y: 0.5 };
  const spinTex = `${rotorTex}_spin`;
  return mounts.map((mount, i) => ({
    kind: "rotor" as const,
    tex: rotorTex,
    spinTex,
    origin,
    mount: { x: mount.x, y: mount.y },
    layer: "above" as const,
    spinSign: rotorSpinSign(mounts, i),
    drawSpan: rotorDrawSpan(rotorTex, (hull.rotorScale ?? 1) * (mount.scale ?? 1)),
  }));
}

/** Max rotor overlays any catalog remote needs (sprite pool stride). */
export function remoteRotorPoolSize(): number {
  let n = 0;
  for (const kind of allRemoteKinds()) {
    n = Math.max(n, remoteRotorParts(remoteSpecOf(kind)).length);
  }
  return n;
}

function controlFromHull(hull: CraftSpec): RemoteControl {
  const scheme = craftControlScheme(hull);
  if (scheme === "orbit") return "orbit";
  if (scheme === "plane") return "plane";
  return "aim";
}

function mergeRemoteDef(def: RemoteDef): RemoteSpec {
  const hull = craftOf(def.craftLook);
  const control = def.control ?? controlFromHull(hull);
  // POV loadout: pilotable remotes inherit hull sockets unless overridden.
  const sockets =
    def.sockets ?? (def.pilotable ? hull.sockets : undefined);
  const turret = sockets?.find((s) => s.class === "turret");
  return {
    kind: def.kind,
    name: def.name,
    health: def.health ?? hull.health,
    radius: def.radius ?? hull.radius,
    height: def.height ?? hull.height,
    maxSpeed: def.maxSpeed ?? hull.maxSpeed,
    thrust: def.thrust ?? hull.forwardThrust,
    strafe: def.strafe ?? hull.strafeThrust,
    yawRate: def.yawRate ?? hull.yawRate,
    climbRate: def.climbRate ?? hull.verticalThrust,
    cruiseAgl: def.cruiseAgl ?? hull.cruiseAgl,
    life: def.life,
    detonateDmg: def.detonateDmg,
    detonateBlast: def.detonateBlast,
    launchSpeed: def.launchSpeed,
    look: def.look ?? hull.body,
    scale: def.scale,
    thermal: def.thermal,
    ai: def.ai,
    pilotable: def.pilotable,
    dockable: def.dockable,
    ground: def.ground,
    sockets,
    ammoScale: def.ammoScale ?? hull.ammoScale,
    // Gun overlay is turret-only; fixed hull muzzles fire from body UVs (see remoteFireTips).
    gun: def.gun ?? turret?.weapon,
    gunTex: def.gunTex ?? turret?.gunTex,
    gunScale: def.gunScale ?? turret?.gunScale,
    control,
    minSpeed: def.minSpeed ?? hull.minSpeed,
    track: def.track ?? hull.track,
    trackGap: def.trackGap ?? hull.trackGap,
    trackScale: def.trackScale ?? hull.trackScale,
    exhaustSmoke: def.exhaustSmoke,
    antenna: def.antenna,
    engageRange: def.engageRange,
    orbitRange: def.orbitRange,
    awareRange: def.awareRange,
    escortRange: def.escortRange,
    hostEscort: def.hostEscort,
    mouseStopRange: def.mouseStopRange,
    hostFace: def.hostFace,
    craftLook: def.craftLook,
    rotOff: def.rotOff ?? hull.rotOff,
  };
}

/**
 * Authored remote roster — lifecycle + overrides only.
 * Hull / flight / default sockets come from `craftLook`.
 */
const REMOTE_DEFS: Record<RemoteKind, RemoteDef> = {
  spectre: {
    kind: "spectre",
    name: "SPECTRE",
    // Fragile vs Murder Hornet hull health.
    health: 28,
    life: 45,
    detonateDmg: 258,
    detonateBlast: 140,
    launchSpeed: 280,
    scale: 0.42,
    thermal: true,
    craftLook: "quad_drone",
  },
  wingman: {
    kind: "wingman",
    name: "SKIFF",
    health: 36,
    life: 90,
    detonateDmg: 40,
    detonateBlast: 48,
    launchSpeed: 200,
    scale: 0.55,
    // Biplane flight; Skiff skin.
    craftLook: "biplane",
    look: "craft_skiff",
    ai: true,
    dockable: true,
    gun: "machine_gun",
    maxSpeed: 380,
    thrust: 520,
    orbitRange: 160,
    awareRange: 560,
    escortRange: 200,
  },
  fighter: {
    kind: "fighter",
    name: "RAPTOR",
    life: 75,
    detonateDmg: 120,
    detonateBlast: 70,
    launchSpeed: 260,
    scale: 0.72,
    craftLook: "raptor",
    ai: true,
    pilotable: true,
    dockable: true,
    hostFace: true,
    engageRange: 520,
    orbitRange: 160,
    awareRange: 560,
    escortRange: 240,
  },
  agv: {
    kind: "agv",
    name: "HOUND",
    life: 600,
    detonateDmg: 180,
    detonateBlast: 90,
    launchSpeed: 220,
    scale: 0.44,
    craftLook: "hound",
    ai: true,
    pilotable: true,
    ground: true,
    exhaustSmoke: { rate: 7, size: 0.32, tint: 0x5c5c58, aft: 11 },
    antenna: { length: 11, aft: 1.8, stiffness: 28, damping: 2.8, yawWhip: 10, lag: 1.6 },
    engageRange: 320,
    orbitRange: 95,
    mouseStopRange: 48,
    hostEscort: { innerRadius: 140, outerRadius: 260 },
  },
};

const RESOLVED: Record<RemoteKind, RemoteSpec> = {
  spectre: mergeRemoteDef(REMOTE_DEFS.spectre),
  wingman: mergeRemoteDef(REMOTE_DEFS.wingman),
  fighter: mergeRemoteDef(REMOTE_DEFS.fighter),
  agv: mergeRemoteDef(REMOTE_DEFS.agv),
};

/** @deprecated Use remoteSpecOf — kept for rosterRig source labels. */
export const REMOTE_CRAFTS: Record<RemoteKind, RemoteSpec> = RESOLVED;

export function remoteSpecOf(kind: RemoteKind): RemoteSpec {
  return RESOLVED[kind];
}

export function allRemoteKinds(): RemoteKind[] {
  return Object.keys(REMOTE_DEFS) as RemoteKind[];
}
