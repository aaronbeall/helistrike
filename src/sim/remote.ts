/** Launched craft pods — Spectre, airship wingmen/fighter, HOUND AGV.
 *
 * Remotes are their own roster (`REMOTES` → `remoteSpecOf`).
 * Hull / flight / sockets live on a CraftSpec (`craftLook`); this file only authors
 * lifecycle (battery, dock, AI flags, host escort), plus a rare hull-field override.
 */
import { REMOTE_DEFS } from "../catalog/remotes";
import {
  allCrafts,
  craftFirepower,
  craftOf,
  craftRotorMounts,
  craftRotorTex,
  craftRotorSpinTex,
  craftSocketFirepower,
  craftSocketStartingAmmo,
  rotorDrawSpan,
  rotorSpinSign,
  type CraftCompositePart,
  type CraftKind,
  type CraftSocket,
  type CraftSpec,
} from "./crafts";
import {
  PLAYER_WPNS,
  playerLoadoutFromSockets,
  playerWeaponClassMul,
  type PlayerWpnSpec,
  type UnitClass,
} from "./combat";
import { lookupSpriteOrigin } from "../art/spriteOrigin";

// Manually declared, not `keyof typeof REMOTES` like CraftKind/WpnId — Craft (sockets
// reference WpnId) → Weapon (payload.remote references RemoteKind) → Remote (craftLook
// references CraftKind) form a genuine 3-way cycle; one link has to be a plain leaf type
// or none of the three can resolve. This is the smallest/lowest-churn catalog, so it's it.
export type RemoteKind = "drone" | "wingman" | "fighter" | "agv" | "ground_escort" | "ugv";

/**
 * Resolved remote — a `CraftSpec` (same physical hull data a player craft uses: flight,
 * sockets, art, ...) plus the deployed-instance lifecycle/AI layer that has no player
 * equivalent. Built by `mergeRemoteDef` from an authored def + its `craftLook` hull; `kind`
 * is the one field that must narrow (a `RemoteKind`, not the hull's own `CraftKind`).
 */
export interface RemoteSpec extends CraftSpec {
  kind: RemoteKind;
  life: number;
  detonateDmg: number;
  detonateBlast: number;
  launchSpeed: number;
  scale: number;
  thermal?: boolean;
  /** AI patrols / attacks without player pilot. */
  ai?: boolean;
  /** Player can take remote cam + WASD even when `ai` (HOUND). */
  pilotable?: boolean;
  /** Can re-dock with host craft (refunds ammo / despawns peacefully). */
  dockable?: boolean;
  /** Battery never drains and no battery bar — health only (HUMVEE). */
  unlimitedLife?: boolean;
  /** Docked: seconds to recharge an empty battery to full. */
  dockRechargeTime: number;
  /** Docked: health repaired per second, as a fraction of max health. */
  dockRepairRate: number;
  /** Docked: repair stops at this fraction of max health. */
  dockRepairMax: number;
  /** Ground-hugging AGV — clamps to terrain. */
  ground?: boolean;
  /**
   * Manned, fully autonomous fire-support escort AI (HUMVEE) — tight leash-follow on the
   * host when idle, orbit-attacks between host and target when engaged — instead of the
   * default ground+gun mouse-park AI (HOUND). Never `pilotable`.
   */
  orbitEscort?: boolean;
  /**
   * Fixed-gun boom-pass AI (Skiff): line up → fire → overshoot → turn.
   * Without this, sensor-net air AI uses a strafe ring (Raptor).
   */
  attackPass?: boolean;
  /** Counts as a friendly sensor node for shared awareness. */
  sensorNet?: boolean;
  /**
   * Idle orbit prefers another live sensor-net remote that is not itself
   * orbit-preferring (Skiffs → Raptor), else the host craft.
   */
  orbitPreferRemote?: boolean;
  /**
   * Auto-launches from the bay the instant a hostile enters the friendly awareness net,
   * sharing its fire cooldown with manual launch (Skiff wolfpack scramble). Not the same as
   * `dockable` — every dockable remote recalls home on bird-cam Q, but only this one self-deploys.
   */
  autoLaunch?: boolean;
  // `sockets` (real weapon mounts — always populated regardless of `pilotable`; only a
  // `pilotable` remote shows them as a POV weapon HUD, see `remoteHasPovHud`), `ammoScale`,
  // `track`/`trackGap`/`trackScale`, `antenna`, `rotOff`, `gunOverlayScale`, `sensorPalette`,
  // and everything else physical all inherit from `CraftSpec` — nothing to redeclare here.
  /** AI engage / fire radius. */
  engageRange?: number;
  /** AI orbit radius around a locked hostile (strafe ring). */
  orbitRange?: number;
  /** Shared friendly sensor radius — enemies inside this of any friendly are known. */
  awareRange?: number;
  /** Idle escort ring around host (airship / raptor), beyond host radius. */
  escortRange?: number;
  /** Ground-escort idle follow: rest within this radius of host, no active repositioning. */
  followInnerRadius?: number;
  /** Ground-escort idle follow: beyond this radius (still no target), actively catches back up to host. */
  followOuterRadius?: number;
  /** Ground-escort: while pursuing/engaging a target, max allowed distance from host. */
  pursueRadius?: number;
  /** Ground-escort attack orbit: circle radius as a fraction of the host↔target distance. */
  attackOrbitFrac?: number;
  /** Ground-escort attack orbit: 0 = circle centered on host, 1 = centered on target (bias along the host→target line). */
  attackBias?: number;
  /** Ground-escort attack orbit: minimum standoff kept between the circle's nearest edge and the target. */
  attackStandoff?: number;
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
  /** Idle park radius at the mouse while autonomous (HOUND orbits hostiles instead). */
  mouseStopRange?: number;
  /**
   * Max standoff from the reticle while autonomous. Beyond this, HOUND drives
   * back to the mouse even with a live target (turret still engages).
   */
  mouseLeashRange?: number;
  /**
   * While piloting this POV remote, the host hull yaws toward it (no follow thrust).
   * Used by Raptor / Leviathan — separate from HOUND FOLLOW|HOLD leash.
   */
  hostFace?: boolean;
  /** CraftKind hull for flight / sockets / silhouette. */
  craftLook: CraftKind;
}

/**
 * Authored remote roster entry — lifecycle + optional overrides.
 * Hull fields are filled from `craftLook` in `remoteSpecOf`.
 */
export type RemoteDef = {
  kind: RemoteKind;
  name: string;
  life: number;
  detonateDmg: number;
  detonateBlast: number;
  launchSpeed: number;
  scale: number;
  craftLook: CraftKind;
  thermal?: boolean;
  ai?: boolean;
  pilotable?: boolean;
  dockable?: boolean;
  unlimitedLife?: boolean;
  dockRechargeTime?: number;
  dockRepairRate?: number;
  dockRepairMax?: number;
  ground?: boolean;
  orbitEscort?: boolean;
  attackPass?: boolean;
  sensorNet?: boolean;
  orbitPreferRemote?: boolean;
  autoLaunch?: boolean;
  sockets?: CraftSocket[];
  antenna?: RemoteSpec["antenna"];
  engageRange?: number;
  orbitRange?: number;
  awareRange?: number;
  escortRange?: number;
  followInnerRadius?: number;
  followOuterRadius?: number;
  pursueRadius?: number;
  attackOrbitFrac?: number;
  attackBias?: number;
  attackStandoff?: number;
  hostEscort?: RemoteSpec["hostEscort"];
  mouseStopRange?: number;
  mouseLeashRange?: number;
  hostFace?: boolean;
  /** Enemy spotting multiplier (lower = harder to notice); overrides the hull's. */
  enemyAwareMul?: number;
  /**
   * Rare one-off overrides of hull-derived fields — every remote today just inherits these
   * from its `craftLook` hull. Give the hull the right values instead, if you can.
   */
  overrides?: Partial<
    Pick<RemoteSpec, "health" | "radius" | "height" | "body" | "ammoScale" | "track" | "trackGap" | "trackScale" | "rotOff">
  >;
};

export type EscortNavState = "FOLLOW" | "PARKED" | "ATTACK" | "AVOID" | "REVERSE";

export interface EscortNav {
  state: EscortNavState;
  /** True while catching up to the host (holds until inside the inner radius). */
  follow: boolean;
  /** Pursued world point + raw goal heading vs avoidance-adjusted heading (debug). */
  goalX: number;
  goalY: number;
  rawWant: number;
  steerWant: number;
  /** Lookahead probe end point and whether it is blocked (debug). */
  probeX: number;
  probeY: number;
  probeHit: boolean;
  throttle: number;
  /** -1 left, 0 straight, 1 right (input intent). */
  steer: number;
  /** Seconds left holding an away-turn after a probe hit, and its side (+1 obstacle on the right). */
  avoidT: number;
  avoidOs: number;
  /** Accumulated no-progress time, progress sampler, and the active unstick reverse. */
  stuckT: number;
  sampleT: number;
  lastX: number;
  lastY: number;
  reverseT: number;
  reverseSteer: number;
}

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
  /** POV dock requested but host too high — host auto-descends, then docks. */
  dockPending?: boolean;
  /** Hurt fire/smoke pins (sprite UV). */
  dmgSites?: { u: number; v: number; scale: number }[];
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
  /** POV countermeasure cooldown (HOUND smoke screen). */
  cmCd?: number;
  /** POV smoke-screen time remaining. */
  smokeT?: number;
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
  /** AI gun target id when it can differ from the move target (HUMVEE fires on the move). */
  gunTargetId?: number;
  /** Seconds continuously AI-firing on `aiTargetId` — narrows gun-aim jitter over time. */
  aimHoldT?: number;
  /** Target id `aimHoldT` was last accumulated against — reset the hold when this changes. */
  aimHoldTargetId?: number;
  /** Ground-escort movement state: avoidance, unstick, and debug readout. */
  nav?: EscortNav;
  /**
   * Skiff attack-pass FSM: `run` lines up fixed guns and fires;
   * `break` coasts outbound past the target, then turns for another pass.
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

/** A docked dockable remote waiting in the bay — recharges / repairs until launched. */
export interface BayRemote {
  life: number;
  health: number;
  /** Onboard weapon ammo carried back into the bay (no free reload on dock). */
  ammo?: number[];
}

/** True when this remote replaces the player weapon HUD while piloted. */
export function remoteHasPovHud(spec: RemoteSpec): boolean {
  return !!spec.pilotable && spec.sockets.length > 0;
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
  // `r.spec` is itself a complete CraftSpec (extends it) — no hull refetch needed.
  r.ammo = r.loadout.map((w, i) => craftSocketStartingAmmo(w.ammo, r.spec, i));
  r.weapon = 0;
  r.fireCd = 0;
}

// Gun socket/id/art/scale lookups (craftTurretSocket, craftGunId, craftGunTex, craftGunScale,
// ...) moved to crafts.ts — they're pure CraftSpec derivations with nothing remote-specific
// about them, and the player-craft render path needs the exact same math (see
// craftSocketGunScale's use in missionScene.ts's syncHeliGfx).

/**
 * Spinning rotor overlays for a remote — only when the look sprite authors
 * `role: "rotor"` UVs and `craftLook` supplies a rotor texture.
 * (No inventing a center disc; HOUND has neither → empty.)
 * Same math as craftComposite's rotors branch — spec has its own rotor/rotorScale via inheritance.
 */
export function remoteRotorParts(spec: RemoteSpec): CraftCompositePart[] {
  const rotorTex = craftRotorTex(spec);
  if (!rotorTex) return [];
  const mounts = craftRotorMounts(spec).filter((p) => p.role === "rotor");
  if (!mounts.length) return [];
  const origin = lookupSpriteOrigin(rotorTex) ?? { x: 0.5, y: 0.5 };
  const spinTex = craftRotorSpinTex(spec);
  return mounts.map((mount, i) => ({
    kind: "rotor" as const,
    tex: rotorTex,
    spinTex,
    origin,
    mount: { x: mount.x, y: mount.y },
    layer: "above" as const,
    spinSign: rotorSpinSign(mounts, i),
    drawSpan: rotorDrawSpan(rotorTex, (spec.rotorScale ?? 1) * (mount.scale ?? 1)),
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

function mergeRemoteDef(def: RemoteDef): RemoteSpec {
  // `sockets` (part of the hull spread) is the hull's real weapon mounts regardless of
  // `pilotable` — piloting is a behavior switch (does the player fly it), not a change to
  // what's physically mounted. Gun weapon/art (craftGunId/craftGunTex/craftGunScale, in
  // crafts.ts) are derived from `sockets` on demand, not stored here — one source, not two.
  return {
    ...craftOf(def.craftLook),
    dockRechargeTime: 30,
    dockRepairRate: 0.02,
    dockRepairMax: 0.5,
    ...def,
    ...def.overrides,
  };
}

/**
 * The pristine `craftLook` hull, with its real `CraftKind` (e.g. "skiff", not the remote's own
 * `"wingman"` roster kind). `spec` already carries every physical stat via inheritance — only
 * reach for this when the true hull kind itself is what's needed (texture/asset-key lookups).
 */
export function remoteHull(spec: RemoteSpec): CraftSpec & { kind: CraftKind } {
  return craftOf(spec.craftLook);
}


const REMOTES: Record<RemoteKind, RemoteDef> = Object.fromEntries(
  Object.entries(REMOTE_DEFS).map(([kind, def]) => [kind, { ...def, kind }])
) as Record<RemoteKind, RemoteDef>;

const RESOLVED: Record<RemoteKind, RemoteSpec> = {
  drone: mergeRemoteDef(REMOTES.drone),
  wingman: mergeRemoteDef(REMOTES.wingman),
  fighter: mergeRemoteDef(REMOTES.fighter),
  agv: mergeRemoteDef(REMOTES.agv),
  ground_escort: mergeRemoteDef(REMOTES.ground_escort),
  ugv: mergeRemoteDef(REMOTES.ugv),
};

export function remoteSpecOf(kind: RemoteKind): RemoteSpec {
  return RESOLVED[kind];
}

export function allRemoteKinds(): RemoteKind[] {
  return Object.keys(REMOTES) as RemoteKind[];
}

/**
 * Same as `craftFirepower`, but a socket that deploys a remote with its own armed loadout (Skiff
 * wingmen, Raptor fighters, the HOUND AGV) counts that hull's own firepower instead of just the
 * launcher's negligible deploy/detonate hit. A `pilotable` remote (Raptor, HOUND) only ever has
 * one instance active — you fly it directly, and the socket's ammo is sequential replacements,
 * not a squad — so it counts once regardless of ammo; a pure-AI remote (Skiff, no `pilotable`)
 * really can have several alive at once (its own notes: "LIVE ×N, max 6"), so it's multiplied by
 * the socket's ammo count. A remote with no sockets of its own (the Spectre kamikaze drone,
 * `sockets: []`) has no separate loadout to add — its launcher's `dmg` already *is* the full
 * detonation, so it falls through to the normal per-socket calc unchanged. Lives here rather than
 * in craft.ts because it needs `remoteSpecOf`, which would circularly import craft.ts.
 */
export function craftFirepowerWithRemotes(c: CraftSpec): { total: number; byClass: Record<UnitClass, number> } {
  let total = 0;
  const byClass: Record<UnitClass, number> = { air: 0, vehicle: 0, building: 0, troop: 0 };
  c.sockets.forEach((socket, i) => {
    const w = PLAYER_WPNS[socket.weapon];
    if (!w) return;
    const spec = w.payload.remote ? remoteSpecOf(w.payload.remote.kind) : undefined;
    if (spec && spec.sockets.length > 0) {
      const count = spec.pilotable ? 1 : craftSocketStartingAmmo(w.ammo, c, i);
      const deployed = craftFirepower(spec);
      total += count * deployed.total;
      (Object.keys(byClass) as UnitClass[]).forEach((cls) => {
        byClass[cls] += count * deployed.byClass[cls];
      });
      return;
    }
    const burst = craftSocketFirepower(c, i);
    total += burst;
    (Object.keys(byClass) as UnitClass[]).forEach((cls) => {
      byClass[cls] += burst * playerWeaponClassMul(w, cls);
    });
  });
  return { total, byClass };
}

/** Exponent on the above-median burst ratio in `craftFirepowerRating` — bigger = a standout
 * weapon (Warthog's cannon) pulls its rating up further above what `ammoScale` alone would give. */
const FIREPOWER_RATING_BURST_EXPONENT = 1.7;

/**
 * The roster's median `craftFirepowerWithRemotes` total — the "ordinary" reference burst that
 * `craftFirepowerRating` measures standout weapons against. Recomputed from the live roster each
 * call (roster is small, ~20 craft) rather than cached, so it stays correct if the roster changes.
 */
function medianCraftBurstFirepower(): number {
  const bursts = allCrafts()
    .map((c) => craftFirepowerWithRemotes(c).total)
    .sort((a, b) => a - b);
  const mid = bursts.length / 2;
  return bursts.length % 2 ? bursts[Math.floor(mid)]! : (bursts[mid - 1]! + bursts[mid]!) / 2;
}

/**
 * Craft-level FIREPOWER rating shown in the game's own stats (menu / field manual) — `ammoScale`
 * is the primary signal (how much this craft is built to carry, which tracks its size/role
 * archetype far better than raw burst damage does — see the Gunship/Little Bird mismatches a
 * burst-only rating produced), boosted by how far above the roster's *median* burst firepower a
 * craft's actual weapons land. The boost is one-sided (floored at 1): a craft at or below the
 * median burst keeps its plain `ammoScale` untouched, so "standard" craft aren't dragged down by
 * this — only a standout weapon (Warthog's cannon, Marauder's HOUND-plus-guns stack) pulls a craft
 * above what its `ammoScale` alone would suggest.
 *
 * This is a display-only rating. The balance rig keeps using `craftFirepowerWithRemotes` /
 * `craftFirepower` directly — actual weapon output, not this proxy.
 */
export function craftFirepowerRating(c: CraftSpec): number {
  const burst = craftFirepowerWithRemotes(c).total;
  const median = medianCraftBurstFirepower();
  const boost = median > 0 ? Math.max(1, Math.pow(burst / median, FIREPOWER_RATING_BURST_EXPONENT)) : 1;
  return c.ammoScale * boost;
}
