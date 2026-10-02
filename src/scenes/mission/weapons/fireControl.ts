import Phaser from "phaser";
import { remoteHostAmmoWeapon } from "../../../sim/remoteRules";
import { bombReleaseFrom, estimateBombFallTime, sampleBallisticAltitude } from "../../../sim/ballistics";
import { shellEjectSide } from "../../../render/spritePose";
import { craftMuzzleLeaveZ, sightTerrainHitWorld } from "../../../sim/aim";
import { projectAlong } from "../../../util/vec";

import { AI_AIM_NARROW_BASE, launchGravity, targetingMode, specIsShellGun, specIsRocketPod, hardpointAmmoIndex, advanceAimHold, aimInStationArc, aimPrecisionSpread, clampAimToStationArc, heatCategoryOk, heatClassOf, type StationTraverse } from "../../../sim/weaponRuntime";
import { projectileFxScale, playerMuzzleFxMul, scaledProjectileFxCount } from "../../../render/fxScale";
import { payloadIsRemote, payloadIsHelix, payloadIsKinetic } from "../../../sim/payload";
import { heightOf, nextId, shotBehaviorOf, applyKineticCombatMix, guidanceIsLockOn, exhaustIsEnergy, exhaustIsGunSpark, exhaustRibbons, launchIsArcBeam, launchIsRayBeam, PLAYER_WPNS, wpnIdOf, type ShotState, type Unit, type PlayerWpnSpec, type WpnId, type EnergyTrailNode, type WeaponGravity, heatClassScore } from "../../../sim/combat";
import { remoteHasPovHud, remoteSpecOf } from "../../../sim/remote";
import { ZOff, worldDepth } from "../../../render/depth";
import { range } from "../../../util/rng";
import { Craft, JET_GUN_MAX_DEPRESS, JET_GUN_MAX_ELEV } from "../../../sim/craft";
import { isAerial } from "../../../sim/roster";
import { closestOnFootprint, footprintOf, pointInFootprint } from "../../../render/footprint";
import { lookupSpriteMuzzles } from "../../../art/spriteOrigin";
import { craftBombDrop, craftCrewHudTag, craftGunId, craftGunMount, craftGunMounts, craftGunPreferDegrees, craftGunPreferOffset, craftHardpointMounts, craftControlScheme, craftOf, craftOrigin, craftSocketBarrelCount, craftSocketFireCd, craftSocketIsPrimary, craftSocketPoints, socketHullPlacement, craftSocketStartingAmmo, type CraftSpec } from "../../../sim/crafts";
import { groundZ, worldToScreen, cameraPointVisible, screenToWorldAtZ, screenToWorldOnGround, castZ } from "../../../worldgen/world";
import type { MissionScene } from "../../missionScene";

/** Auto fire once the barrel is within this angle of the track (radians). */
const AUTO_GUN_ALIGN_TOL = 0.14;

/** Score penalty per radian off the barrel's preferred (mount-outward) heading. */
const AUTO_GUN_HEADING_WEIGHT = 900;

/** Automatic turret: max extra spread (rad) added at/above AUTO_GUN_SPEED_REF craft speed. */
const AUTO_GUN_SPEED_PENALTY_MAX = 0.06;

/** Automatic turret: craft speed (world units/s) at which the speed spread penalty maxes out. */
const AUTO_GUN_SPEED_REF = 400;

/** Automatic (crew-fired) turret stations: wider fresh-acquire spread than AI enemies get. */
const AUTO_GUN_WIDE_MUL = 3;

/** Player fire control: trigger handling, muzzle/kick/drop fire, salvos, hardpoints, ammo + slot select, host + automatic crew stations, aim gathering. */
export class FireControl {
  /** Per-slot ammo (set from the loadout in the scene's init). */
  ammo: number[] = [];
  playerGunSide = 0;
  /** Per-weapon fire index for combat-mix HE rounds (Avenger 1-in-5). */
  cannonMixRound: Record<string, number> = {};
  canFire = false;
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
  /** Per-slot, per-barrel cooldown for automatic / crew stations. */
  stationFireCd: number[][] = [];
  /** Per-slot, per-barrel seconds continuously tracking the same target — narrows aim jitter. */
  stationAimHoldT: number[][] = [];
  /** Per-slot, per-barrel target id `stationAimHoldT` was last accumulated against. */
  stationAimTargetId: (number | undefined)[][] = [];

  constructor(readonly s: MissionScene) {}

  /** Per-mission state reset (scene init, after the loadout is set). */
  reset(selectedCraft: CraftSpec): void {
    this.canFire = false;
    this.pendingSalvos = [];
    this.playerGunSide = 0;
    this.cannonMixRound = {};
    this.ammo = this.s.loadout.map((weapon, i) =>
      craftSocketStartingAmmo(weapon.ammo, selectedCraft, i)
    );
    this.stationFireCd = this.s.loadout.map((_, i) =>
      Array.from({ length: craftSocketBarrelCount(selectedCraft, i) }, () => 0)
    );
    this.stationAimHoldT = this.s.loadout.map((_, i) =>
      Array.from({ length: craftSocketBarrelCount(selectedCraft, i) }, () => 0)
    );
    this.stationAimTargetId = this.s.loadout.map((_, i) =>
      Array.from({ length: craftSocketBarrelCount(selectedCraft, i) }, () => undefined)
    );
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
    const h = this.s.player;
    const socket = slot != null ? h.spec.sockets[slot] : h.spec.sockets[h.weapon];
    // Turret / fixed gun drops must leave along the barrel XY heading — arc solver
    // only varies loft / along-track speed, not free 2D throw toward the reticle.
    const barrelHeading =
      socket?.class === "turret" || socket?.class === "fixed"
        ? (h.stationAim[slot ?? h.weapon]?.[0] ?? h.gunAngle) + yawOff
        : undefined;
    return bombReleaseFrom(this.s.world, spec, ox, oy, aim, yawOff, {
      vx: h.vx,
      vy: h.vy,
      vz: h.vz,
      z0: h.z + ZOff.shot,
      angle: barrelHeading ?? h.angle,
      tune: craftBombDrop(h.spec, socket),
      barrelHeading,
    });
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
    const end = sampleBallisticAltitude(z0, vz0, flightT, grav, term);
    if (Math.abs(end - tz) < 2) return vz0;

    // Terminal clamp bent the arc — bracket and refine.
    let lo = vz0 - grav * flightT - Math.abs(tz - z0);
    let hi = vz0 + grav * flightT + Math.abs(tz - z0);
    for (let i = 0; i < 8; i++) {
      const zLo = sampleBallisticAltitude(z0, lo, flightT, grav, term);
      const zHi = sampleBallisticAltitude(z0, hi, flightT, grav, term);
      if (zLo <= tz && tz <= zHi) break;
      lo -= grav * flightT;
      hi += grav * flightT;
    }
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) * 0.5;
      const zMid = sampleBallisticAltitude(z0, mid, flightT, grav, term);
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
            : groundZ(this.s.world, aimAt.x, aimAt.y),
        }
      : this.reticleAimWorld(tgt);
    const along = Math.max(8, projectAlong(ox, oy, aimAng, ptr.x, ptr.y));
    const bx = ox + Math.cos(aimAng) * along;
    const by = oy + Math.sin(aimAng) * along;
    const hit = sightTerrainHitWorld(this.s.world, ox, oy, oz, bx, by, ptr.z);
    if (this.aimCraftIsPlane()) return this.clampJetGunAim(ox, oy, oz, aimAng, hit);
    return hit;
  }

  /** Host hangar craft or POV remote hull — jets share gun-depress clamp. */
  aimCraftIsPlane(): boolean {
    const pov = this.s.remoteFleet.povHudRemote();
    if (pov?.spec.craftLook) {
      return craftControlScheme(craftOf(pov.spec.craftLook)) === "plane";
    }
    return craftControlScheme(this.s.player.spec) === "plane";
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
    if (pitch < clamped) {
      // Too steep: follow the clamped ray to the ground, not a mid-air point above the cursor.
      const agl = Math.max(0, oz - hit.z);
      const far = Math.max(along, (agl / Math.tan(-clamped)) * 1.5 + 60);
      return sightTerrainHitWorld(this.s.world, 
        ox,
        oy,
        oz,
        ox + Math.cos(aimAng) * far,
        oy + Math.sin(aimAng) * far,
        oz + Math.tan(clamped) * far
      );
    }
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
    slot = this.s.player.weapon,
    barrel = 0
  ): { x: number; y: number; z: number } {
    const z = tip.z ?? this.playerMuzzleZ(slot, barrel);
    const xy = this.s.projectiles.shotSpawnXY(tip.x, tip.y, angle, z, spec.art.look, spec.art.scale ?? 1);
    return { x: xy.x, y: xy.y, z };
  }

  /** World Z for player muzzle leave. */
  playerMuzzleZ(slot = this.s.player.weapon, barrel = 0): number {
    const h = this.s.player;
    return craftMuzzleLeaveZ(
      h.z,
      h.spec.height,
      socketHullPlacement(h.spec.sockets[slot], barrel)
    );
  }

  /** Painter offset for muzzle flash / spark / beam so roof mounts sort above the hull. */
  playerMuzzleDepthOff(slot = this.s.player.weapon, barrel = 0): number {
    return socketHullPlacement(this.s.player.spec.sockets[slot], barrel) === "above"
      ? ZOff.turret + 0.25
      : ZOff.muzzle + 0.15;
  }

  /**
   * Screen cursor → world point on the aim plane. A sprite under the reticle
   * uses the camera ray at that body's height (feet→head by screen Y), then
   * snaps onto the footprint so thin troops aren't aimed behind their billboard.
   */
  reticleAimWorld(unit?: Unit): { x: number; y: number; z: number } {
    const scr = this.s.pointerScreen();
    if (!unit) {
      const g = screenToWorldOnGround(this.s.world, scr.x, scr.y);
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

  /** World position of a craft hardpoint UV. */
  hardpointWorldPos(mount: { x: number; y: number }): { x: number; y: number } {
    return this.s.hostCraft.craftBodyMountWorldPos(mount);
  }

  /** World position of the next hardpoint emit tip (cycles by remaining ammo). */
  hardpointPylon(
    slot = this.s.player.weapon,
    /** True when called after `spendAmmo` (fire); false for laser sight (next shot). */
    afterSpend = false
  ): { x: number; y: number; side: number } {
    const h = this.s.player;
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

  /**
   * Drop / lob leave tip — hardpoint pylons cycle by ammo; turret guns leave from
   * the barrel tip (grenade launcher on Leviathan).
   */
  dropShotOrigin(
    slot = this.s.player.weapon,
    afterSpend = false
  ): { x: number; y: number; side: number } {
    const socket = this.s.player.spec.sockets[slot];
    if (socket?.class === "turret" || socket?.class === "fixed") {
      const tip = this.s.hostCraft.gunTip(this.s.hostCraft.gunVisualIndexForSlot(slot));
      return { x: tip.x, y: tip.y, side: 0 };
    }
    return this.hardpointPylon(slot, afterSpend);
  }

  handleFire(dt: number): void {
    const h = this.s.player;
    const ptr = this.s.worldPointer();
    const down = this.s.input.activePointer.isDown;
    const pressed = down && !this.pointerWasDown;
    const released = !down && this.pointerWasDown;

    for (let i = 0; i < this.stationFireCd.length; i++) {
      const barrels = this.stationFireCd[i]!;
      for (let b = 0; b < barrels.length; b++) {
        barrels[b] = Math.max(0, (barrels[b] ?? 0) - dt);
      }
    }

    this.tickPendingSalvos(dt, ptr);
    this.s.callStrike.tickMarks(dt);
    this.s.tesla.live = null;
    if (!launchIsArcBeam(this.s.loadout[h.weapon]?.launch)) {
      this.s.tesla.head = null;
      this.s.tesla.lockId = undefined;
    }

    if (h.phase === "flight" && this.canFire && !this.s.debugMenu.open && !this.s.relief.open && !this.s.help.open && !this.s.flow.exitOpen) {
      this.tickAutomaticStations(dt, ptr);
      this.s.remoteAi.tickAutoSkiffLaunch();
    }

    this.s.lockOn.tick(dt, ptr);

    if (h.phase !== "flight" || !this.canFire || this.s.debugMenu.open || this.s.relief.open || this.s.help.open || this.s.flow.exitOpen) {
      this.pointerWasDown = down;
      return;
    }

    // POV remote loadout owns fire while piloting (HOUND) — bird guns stay parked.
    const pov = this.s.remoteFleet.povHudRemote();
    if (pov && !pov.airborne) {
      this.s.remoteBody.handlePovRemoteFire(pov, dt, ptr, down, pressed, released);
      this.pointerWasDown = down;
      return;
    }

    const slot = h.weapon;
    const spec = this.s.loadout[slot]!;
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
      if (this.hostWeaponStrikeActive(wpnIdOf(spec))) {
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
      const active = this.s.shots.find(
        (s) => s.from === "player" && s.wpnId === spec.id && s.st && !s.st.terminal && !s.st.bomblet
      );
      if (active?.st) {
        this.s.lockOn.commitNlosTerminal(active, ptr);
        this.pointerWasDown = down;
        return;
      }
    }

    // Remote: live pod for this HUD slot — POV remotes stay in their HUD; Spectre detonates in view.
    // AI wingmen (Skiffs) never bind mouse fire — fall through so more can launch while LIVE.
    if (payloadIsRemote(spec.payload)) {
      const live = this.s.remoteFleet.selectedSlotRemote();
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
        } else if (craftGunId(live.spec)) {
          // Legacy single-gun remotes: selected + alive = player fire only.
          if (down) this.s.remoteBody.fireRemoteGun(live, dt);
          this.pointerWasDown = down;
          return;
        } else if (pressed) {
          if (this.s.remoteFleet.remoteView) live.detonate = true;
          else this.s.remoteFleet.enterRemoteView();
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
            this.s.hostCraft.pulseTurretGunHeat(this.s.hostCraft.gunVisualIndexForSlot(slot));
          }
        }
        this.s.tesla.updateArc(slot, spec, ptr, spend, dt);
      } else {
        this.s.tesla.live = null;
        this.s.tesla.head = null;
        this.s.tesla.lockId = undefined;
      }
      this.pointerWasDown = down;
      return;
    }

    if (!wantFire || h.fireCd > 0 || !this.hasAmmo(slot)) {
      this.pointerWasDown = down;
      return;
    }
    // Skiff bay CD is shared with auto-scramble (may lag behind h.fireCd after weapon switch).
    if (spec.payload?.remote && remoteSpecOf(spec.payload.remote.kind).autoLaunch) {
      const skiffCd = this.stationFireCd[slot]?.[0] ?? 0;
      if (skiffCd > 0) {
        this.pointerWasDown = down;
        return;
      }
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
    // Share recall-with-Q bay CD with auto-launch so manual + scramble don't stack.
    if (spec.payload?.remote && remoteSpecOf(spec.payload.remote.kind).autoLaunch) {
      const cds =
        this.stationFireCd[slot] ??
        (this.stationFireCd[slot] = Array.from(
          { length: craftSocketBarrelCount(h.spec, slot) },
          () => 0
        ));
      cds[0] = h.fireCd;
    }
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
    const h = this.s.player;
    for (let i = this.pendingSalvos.length - 1; i >= 0; i--) {
      const p = this.pendingSalvos[i]!;
      p.t -= dt;
      if (p.t > 0) continue;
      this.pendingSalvos.splice(i, 1);
      if (h.phase !== "flight" || !this.canFire || this.weaponSlotDisabled(p.slot)) continue;
      const spec = this.s.loadout[p.slot];
      if (!spec || spec.id !== p.wpnId || !this.hasAmmo(p.slot)) continue;
      const auto =
        p.autoTargetId != null
          ? this.s.units.find((u) => !u.dead && u.id === p.autoTargetId)
          : undefined;
      this.firePlayerWeapon(p.slot, spec, ptr, p.yawOff, p.gx, p.gy, auto, p.barrel, 0, p.helixPhase);
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
    const h = this.s.player;
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
              this.s.remoteFleet.launchRemote(spec, slot, yawOff, pitchOff, this.s.hostCraft.craftBodyMountWorldPos(uv));
            }
            return;
          }
          const uv =
            socket.muzzleFire === "alternate"
              ? tips[this.playerGunSide++ % tips.length]!
              : tips[0]!;
          this.s.remoteFleet.launchRemote(spec, slot, yawOff, pitchOff, this.s.hostCraft.craftBodyMountWorldPos(uv));
          return;
        }
      }
      this.s.remoteFleet.launchRemote(spec, slot, yawOff, pitchOff);
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
        this.s.refractor.fire(slot, spec, ptr, yawOff, barrelIndex);
      } else {
        this.fireMuzzleShot(slot, spec, beh, st, ptr, yawOff, autoTarget, barrelIndex);
      }
    }
  }

  /**
   * One muzzle leave for every craft hardpoint — host pylons and remote loadout.
   * Loft (`leaveVz`) climbs and keeps catalog life. Aim-life is time-to-reticle,
   * so a near cursor used to detonate the round at the top of the pop.
   */
  spawnCraftMuzzleShot(opts: {
    spec: PlayerWpnSpec;
    beh: ReturnType<typeof shotBehaviorOf>;
    st: ShotState;
    slot: number;
    x: number;
    y: number;
    z0: number;
    ang: number;
    pitchJit: number;
    side: number;
    craftVx: number;
    craftVy: number;
    craftVz: number;
    lockOn: boolean;
    lockId?: number;
    aimUnit?: Unit;
    aimAt?: { x: number; y: number };
    fxInterval: number;
    /** Above-hull mounts sort over the sprite. Omitted stays at a belly muzzle. */
    depthOff?: number;
  }): void {
    const spec = opts.spec;
    const inherit = spec.launch.mode === "muzzle" ? spec.launch.inheritMomentum : 0.35;
    const accelMuzzle = spec.launch.mode === "muzzle" && spec.launch.acceleration != null;
    const loftVz =
      spec.launch.mode === "muzzle" && spec.launch.leaveVz != null ? spec.launch.leaveVz : 0;
    const leaveSpd = accelMuzzle
      ? spec.launch.mode === "muzzle"
        ? (spec.launch.leaveSpeed ?? 10)
        : 10
      : spec.speed;
    const aimSpd = accelMuzzle ? spec.speed : leaveSpd;
    const cp = Math.cos(opts.pitchJit);
    const sp = Math.sin(opts.pitchJit);
    const origin = this.playerShotOrigin({ x: opts.x, y: opts.y, z: opts.z0 }, opts.ang, spec);
    const clip = this.playerSightAimWorld(
      origin.x,
      origin.y,
      origin.z,
      opts.ang,
      opts.aimUnit,
      opts.aimAt
    );
    const dx = clip.x - origin.x;
    const dy = clip.y - origin.y;
    const dz = clip.z - origin.z;
    const dist3 = Math.max(8, Math.hypot(dx, dy, dz));
    const hFrac = Math.hypot(dx, dy) / dist3;
    const hScale = loftVz > 0 ? 0.1 : 1;
    const hvx = opts.lockOn
      ? opts.craftVx * inherit + Math.cos(opts.ang) * leaveSpd * cp
      : Math.cos(opts.ang) * leaveSpd * hFrac * hScale +
        opts.craftVx * inherit * (loftVz > 0 ? 1 : 0);
    const hvy = opts.lockOn
      ? opts.craftVy * inherit + Math.sin(opts.ang) * leaveSpd * cp
      : Math.sin(opts.ang) * leaveSpd * hFrac * hScale +
        opts.craftVy * inherit * (loftVz > 0 ? 1 : 0);
    const g = spec.guidance;
    const seekLoft = g && guidanceIsLockOn(g) ? g.targeting.seekDelay : undefined;
    const grav = !opts.lockOn ? launchGravity(spec.launch) : undefined;
    const aimVel = opts.lockOn
      ? {
          vz:
            opts.craftVz * inherit +
            leaveSpd * sp +
            (accelMuzzle ? 0 : Math.max(28, leaveSpd * 0.08)),
          life: spec.life,
        }
      : this.muzzleAimVelocity({
          dx,
          dy,
          dz,
          z0: opts.z0,
          tz: clip.z,
          spd: aimSpd,
          vx: Math.cos(opts.ang) * aimSpd * hFrac,
          vy: Math.sin(opts.ang) * aimSpd * hFrac,
          grav,
        });
    const leaveVz =
      accelMuzzle && !opts.lockOn && aimSpd > 1 ? aimVel.vz * (leaveSpd / aimSpd) : aimVel.vz;
    this.s.projectiles.spawnShot({
      from: "player",
      id: nextId(),
      wpnId: wpnIdOf(spec),
      slot: opts.slot,
      beh: opts.beh,
      st: { ...opts.st, launchAngle: opts.ang, seeking: opts.lockOn ? false : undefined },
      x: opts.x,
      y: opts.y,
      z: opts.z0,
      vx: hvx,
      vy: hvy,
      vz: loftVz > 0 ? loftVz + opts.craftVz * inherit : leaveVz,
      angle: opts.ang,
      life: loftVz > 0 || accelMuzzle || !!spec.cam.povCam ? spec.life : aimVel.life,
      targetId: opts.lockId,
      blast: opts.beh.blast,
      dmg: opts.beh.dmg,
      look: spec.art.look,
      scale: spec.art.scale,
      fxInterval: opts.fxInterval,
      loft: seekLoft,
      cruise: opts.lockOn || accelMuzzle ? spec.speed : undefined,
      yaw: opts.lockOn && !accelMuzzle ? opts.side * (0.35 + Math.random() * 0.2) : undefined,
      povCam: spec.cam.povCam || undefined,
      energyTrail: exhaustIsEnergy(spec.exhaust) ? [] : undefined,
      energyTrails:
        exhaustRibbons(spec.exhaust) > 1
          ? Array.from({ length: exhaustRibbons(spec.exhaust) }, () => [] as EnergyTrailNode[])
          : undefined,
      warpTimeScale: spec.payload.warp?.timeScale,
    });
    this.missileMuzzle(opts.x, opts.y, opts.z0, opts.ang, projectileFxScale("player", opts.fxInterval), opts.depthOff);
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
    const h = this.s.player;
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
        (lockOn && lockId != null ? this.s.unitSim.unitById(lockId) : undefined) ??
        this.reticleUnit();
      this.spawnCraftMuzzleShot({
        spec,
        beh,
        st,
        slot,
        x: px,
        y: py,
        z0: this.playerMuzzleZ(slot),
        ang,
        pitchJit,
        side,
        craftVx: h.vx,
        craftVy: h.vy,
        craftVz: h.vz,
        lockOn,
        lockId,
        aimUnit: zTgt,
        aimAt: autoTarget,
        fxInterval: spec.fireCd,
        depthOff:
          socketHullPlacement(socket) === "above" ? this.playerMuzzleDepthOff(slot) : undefined,
      });
      if (
specIsShellGun(spec)
      ) {
        this.s.fx.spawnShellEject({
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
      authored.length === 0 ? this.s.hostCraft.gunVisualIndexForSlot(slot, barrelIndex) : 0;
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
      const gun = this.s.hostCraft.guns[mountedGunI] ?? this.s.hostCraft.gun;
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
    const loftVz =
      spec.launch.mode === "muzzle" && spec.launch.leaveVz != null ? spec.launch.leaveVz : 0;
    const planeish = h.spec.flightModel === "plane" || h.spec.flightModel === "vtol";
    // Plane/VTOL get a bump, but authored 1.0 (jet nose guns) stays full along-rail carry.
    const inherit = planeish ? Math.min(1, baseInherit + 0.28) : baseInherit;
    const stationAng = fixed
      ? h.angle
      : (h.stationAim[slot]?.[barrelIndex] ?? h.stationAim[slot]?.[0] ?? h.gunAngle);
    this.applyPlayerShellRecoil(slot, spec, stationAng + yawOff);
    const baseSpreadAmp = spec.fire?.jitter ?? (!(spec.fire?.muzzleFlash ?? true) ? 0.025 : 0.08);
    // Automatic/crew stations (not the player's own manual aim) narrow in the same way AI does.
    const autoHoldT = autoTarget ? this.stationAimHoldT[slot]?.[barrelIndex] ?? 0 : undefined;
    for (const tipRef of tipRefs) {
      const spreadAmp =
        autoHoldT != null ? this.autoGunAimSpread(autoHoldT, baseSpreadAmp) : baseSpreadAmp;
      const spread = spec.launch.mode === "beam" ? 0 : (Math.random() - 0.5) * spreadAmp;
      const ang = stationAng + spread + yawOff + ((st.helixSide ?? 0) * 0.012);
      const tip =
        tipRef.kind === "body"
          ? this.s.hostCraft.craftBodyMountWorldPos(tipRef.uv)
          : this.s.hostCraft.gunTip(mountedGunI, tipRef.muzzleI);
      const muzzleUv = tipRef.kind === "body" ? tipRef.uv : undefined;
      const gunMuzzleI = tipRef.kind === "gun" ? tipRef.muzzleI : undefined;
      const placeBarrel = gunMuzzleI ?? barrelIndex;
      const tipScr = worldToScreen(tip.x, tip.y, this.playerMuzzleZ(slot, placeBarrel));
      const tipScale = tipScr.scale;
      const z0 = this.playerMuzzleZ(slot, placeBarrel);
      const origin = this.playerShotOrigin(tip, ang, spec, slot, placeBarrel);
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
      const hScale = loftVz > 0 ? 0.1 : 1;
      const hvx = Math.cos(ang) * spd * hFrac * hScale + dirx * along;
      const hvy = Math.sin(ang) * spd * hFrac * hScale + diry * along;
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
      this.s.projectiles.spawnShot({
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
        vz: loftVz > 0 ? loftVz + h.vz * inherit : aimVel.vz,
        angle: ang,
        life:
          beamRange != null
            ? beamRange / spd
            : loftVz > 0 || !!spec.cam.povCam
              ? spec.life
              : aimVel.life,
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
        povCam: spec.cam.povCam || undefined,
        energyTrail:
          exhaustIsEnergy(spec.exhaust) || st.helixOff != null ? [] : undefined,
        energyTrails:
          exhaustRibbons(spec.exhaust) > 1
            ? Array.from({ length: exhaustRibbons(spec.exhaust) }, () => [] as EnergyTrailNode[])
            : undefined,
        warpTimeScale: spec.payload.warp?.timeScale,
      });
      if (exhaustIsGunSpark(spec.exhaust)) {
        // Slow rail shots never stack the tiny per-round heat Tesla builds by firing constantly.
        if (!fixed) this.s.hostCraft.pulseTurretGunHeat(mountedGunI, 0.9);
        this.s.fx.emitRailMuzzle(tip.x, tip.y, z0, Math.cos(ang), Math.sin(ang), dirz);
      } else if (!fixed) this.s.hostCraft.pulseTurretGunHeat(mountedGunI);
      if (spec.launch.mode === "beam") {
        const beamEnd = worldToScreen(tx, ty, tz);
        const beam = this.s.add
          .graphics()
          .setDepth(worldDepth(z0, this.playerMuzzleDepthOff(slot, placeBarrel), tip.y));
        beam.lineStyle(5 * tipScale, 0x55ddff, 0.24).lineBetween(tipScr.x, tipScr.y, beamEnd.x, beamEnd.y);
        beam.lineStyle(1.5 * tipScale, 0xffffff, 0.95).lineBetween(tipScr.x, tipScr.y, beamEnd.x, beamEnd.y);
        this.s.tweens.add({ targets: beam, alpha: 0, duration: 110, onComplete: () => beam.destroy() });
      } else if (!!(spec.fire?.muzzleFlash ?? true)) {
        const muzzleMul = playerMuzzleFxMul(spec);
        const sparkMul = Phaser.Math.Linear(0.55, 1, Phaser.Math.Clamp((muzzleMul - 0.4) / 0.6, 0, 1));
        this.s.fx.emitVisualBurst(tip.x, tip.y, z0, {
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
          depthOff: this.playerMuzzleDepthOff(slot, placeBarrel),
        }, this.s.fx.muzzleBurst);
        this.s.fx.showMuzzle({
          life: 0.1,
          ang,
          scaleMul: 0.78 * muzzleMul * range(0.9, 1.12),
          worldX: tip.x,
          worldY: tip.y,
          worldZ: z0,
          depthOff: this.playerMuzzleDepthOff(slot, placeBarrel),
        });
        const craft = h.spec;
        const mountedGun = this.s.hostCraft.guns[mountedGunI] ?? this.s.hostCraft.gun;
        const mountedGunUv = craftGunMounts(craft)[mountedGunI] ?? craftGunMount(craft);
        const gunTex = mountedGun.texture.key;
        const gunTips = lookupSpriteMuzzles(gunTex);
        const side = muzzleUv
          ? (muzzleUv.x < craftOrigin(craft).x ? -1 : 1)
          : shellEjectSide({
              muzzleUv: gunTips[gunMuzzleI ?? 0] ?? gunTips[0],
              mountUv: mountedGunUv,
            });
        const ejectAt = muzzleUv ? tip : screenToWorldAtZ(mountedGun.x, mountedGun.y, z0);
        if (
specIsShellGun(spec)
        ) {
          this.s.fx.spawnShellEject({
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
      } else if (spec.fire?.muzzleSparks) {
        // Suppressed weapons: a few small sparks only — no flash sprite/glow, no shell eject.
        this.s.fx.emitVisualBurst(tip.x, tip.y, z0, {
          n: scaledProjectileFxCount(3, shotFxScale),
          spdMin: 10,
          spdMax: 70,
          bx: Math.cos(ang),
          by: Math.sin(ang),
          bz: dz / Math.max(40, dist3),
          tight: 0.9,
          scaleMul: 0.18,
          stretchMul: 1.2,
          coneHalf: (200 * Math.PI) / 360,
          depthOff: this.playerMuzzleDepthOff(slot, placeBarrel),
        }, this.s.fx.muzzleBurst);
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
    const h = this.s.player;
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
    this.s.projectiles.spawnShot({
      from: "player",
      id: nextId(),
      wpnId: wpnIdOf(spec),
      slot,
      beh,
      st: { ...st, launchAngle: ang },
      x: px,
      y: py,
      z: this.playerMuzzleZ(slot),
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
    const deck = socketHullPlacement(h.spec.sockets[slot]) === "above";
    this.missileMuzzle(
      px,
      py,
      deck ? this.playerMuzzleZ(slot) : h.z,
      ang,
      projectileFxScale("player", spec.fireCd),
      deck ? this.playerMuzzleDepthOff(slot) : undefined
    );
  }

  fireDropShot(
    slot: number,
    spec: PlayerWpnSpec,
    beh: ReturnType<typeof shotBehaviorOf>,
    st: ShotState,
    ptr: { x: number; y: number },
    yawOff: number
  ): void {
    const h = this.s.player;
    const launch = spec.launch;
    if (launch.mode !== "drop") return;
    const pylon = this.dropShotOrigin(slot, true);
    const aim =
      st.gx != null && st.gy != null ? { x: st.gx, y: st.gy } : ptr;
    const release = this.bombReleaseVelocity(spec, pylon.x, pylon.y, aim, yawOff, slot);
    const dropZ = h.z + ZOff.shot;
    const grav = launchGravity(spec.launch);
    const fallT = estimateBombFallTime(
      dropZ,
      release.vz,
      groundZ(this.s.world, aim.x, aim.y),
      grav?.acceleration ?? 210,
      grav?.terminalVelocity ?? 520
    );
    const openFrac = beh.payload.cluster?.openAt;
    const openAge =
      openFrac != null && openFrac > 0 && openFrac < 1
        ? Math.max(0.12, fallT * openFrac)
        : undefined;
    this.s.projectiles.spawnShot({
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
    const socket = h.spec.sockets[slot];
    if (socket?.class === "turret" && (spec.fire?.muzzleFlash ?? true)) {
      const gunI = this.s.hostCraft.gunVisualIndexForSlot(slot);
      this.s.hostCraft.pulseTurretGunHeat(gunI);
      this.missileMuzzle(pylon.x, pylon.y, h.z, release.angle, projectileFxScale("player", spec.fireCd));
    }
  }

  /**
   * Loadout slot cannot fire right now (HUD + fire gate).
   * Reasons are additive — cloak blocks primary gun stations only.
   */
  weaponSlotDisabled(slot: number): boolean {
    const socket = this.s.player.spec.sockets[slot];
    if (!socket) return true;
    if (this.s.countermeasures.cloakT > 0 && craftSocketIsPrimary(socket)) return true;
    return false;
  }

  /**
   * Automatic (crew-fired) turret aim spread: narrows with hold time like AI aim, but wider
   * on fresh-acquire (AUTO_GUN_WIDE_MUL) and further widened while the host craft is moving —
   * stationary is no penalty, full speed adds up to AUTO_GUN_SPEED_PENALTY_MAX.
   * Shared by the debug cone (tickAutomaticStations) and the actual fired shot (fireMuzzleShot)
   * so what's drawn always matches what's fired.
   */
  autoGunAimSpread(holdT: number, baseJitter: number): number {
    const h = this.s.player;
    const spd = Math.hypot(h.vx, h.vy, h.vz);
    const speedPenalty =
      Phaser.Math.Clamp(spd / AUTO_GUN_SPEED_REF, 0, 1) * AUTO_GUN_SPEED_PENALTY_MAX;
    return (
      aimPrecisionSpread(holdT, AI_AIM_NARROW_BASE, baseJitter * AUTO_GUN_WIDE_MUL, baseJitter) +
      speedPenalty
    );
  }

  tickAutomaticStations(dt: number, _ptr: { x: number; y: number }): void {
    const h = this.s.player;
    this.s.overlays.autoGunDbg = [];
    for (let slot = 0; slot < this.s.loadout.length; slot++) {
      const socket = h.spec.sockets[slot];
      const spec = this.s.loadout[slot]!;
      if (!socket || socket.controller !== "automatic") continue;
      if (this.weaponSlotDisabled(slot)) continue;
      const barrels = h.stationAim[slot] ?? (h.stationAim[slot] = [h.angle]);
      const cds = this.stationFireCd[slot] ?? (this.stationFireCd[slot] = [0]);
      const holdTs = this.stationAimHoldT[slot] ?? (this.stationAimHoldT[slot] = [0]);
      const holdTargets = this.stationAimTargetId[slot] ?? (this.stationAimTargetId[slot] = [undefined]);
      const resetHold = (b: number) => {
        holdTs[b] = 0;
        holdTargets[b] = undefined;
      };
      const crewTag = craftCrewHudTag(socket) ?? "CREW";
      const acquire = this.autoStationRange(spec, slot);
      const pushDbg = (
        b: number,
        fields: {
          aim: number;
          want: number | null;
          targetId: number | null;
          state: string;
          aimSpreadRad?: number;
        },
        auto = true
      ) => {
        const mount = this.autoGunMountWorld(slot, b);
        this.s.overlays.autoGunDbg.push({
          slot,
          barrel: b,
          range: acquire,
          mountX: mount.x,
          mountY: mount.y,
          heading: h.angle,
          traverse: this.stationTraverseForBarrel(slot, b),
          auto,
          ...fields,
        });
      };
      // Player owns this station while selected — manual hold-fire in handleFire.
      // Remote spot / call-strike also owns the host howitzer (slewed in syncHeliGfx).
      const spotOwned = this.hostSpotSlewSlot() === slot;
      if (h.weapon === slot || spotOwned) {
        for (let b = 0; b < barrels.length; b++) {
          resetHold(b);
          pushDbg(
            b,
            {
              aim: barrels[b] ?? h.gunAngle,
              want: barrels[b] ?? h.gunAngle,
              targetId: null,
              state: `${crewTag}${barrels.length > 1 ? ` ${b + 1}` : ""} ${spotOwned ? "SPOT" : "MANUAL"}`,
            },
            false
          );
        }
        continue;
      }
      if (!this.hasAmmo(slot)) {
        for (let b = 0; b < barrels.length; b++) {
          resetHold(b);
          pushDbg(b, {
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
        const mount = this.autoGunMountWorld(slot, b);
        const trav = this.stationTraverseForBarrel(slot, b);
        const tgt = this.pickAutoTarget(
          mount.x,
          mount.y,
          h.x,
          h.y,
          h.angle,
          acquire,
          trav,
          !trav,
          prefer,
          !!spec.groundOnly
        );
        if (!tgt) {
          resetHold(b);
          pushDbg(b, {
            aim: barrels[b] ?? h.angle,
            want: null,
            targetId: null,
            state: `${crewTag}${barrels.length > 1 ? ` ${b + 1}` : ""} IDLE`,
          });
          continue;
        }
        const want = Math.atan2(tgt.y - mount.y, tgt.x - mount.x);
        if (trav && !aimInStationArc(want, h.angle, trav)) {
          resetHold(b);
          pushDbg(b, {
            aim: barrels[b] ?? h.angle,
            want: null,
            targetId: null,
            state: `${crewTag}${barrels.length > 1 ? ` ${b + 1}` : ""} ARC`,
          });
          continue;
        }
        // Aim precision: narrows the longer this barrel has held aim on the same target,
        // resetting to max spread the instant it acquires a new one or loses the old one.
        const sameTarget = holdTargets[b] === tgt.id;
        holdTargets[b] = tgt.id;
        holdTs[b] = advanceAimHold(holdTs[b] ?? 0, dt, sameTarget);
        let aim = barrels[b] ?? h.angle;
        aim = Phaser.Math.Angle.RotateTo(aim, want, GUN_STATION_TURN_RATE * this.s.playerDt);
        if (trav) aim = clampAimToStationArc(aim, h.angle, trav);
        barrels[b] = aim;
        const err = Math.abs(Phaser.Math.Angle.Wrap(want - aim));
        const aligned = err <= AUTO_GUN_ALIGN_TOL;
        const onCd = (cds[b] ?? 0) > 0;
        let state = `${crewTag}${barrels.length > 1 ? ` ${b + 1}` : ""} `;
        if (!aligned) state += "SLEW";
        else if (onCd) state += "CD";
        else state += "FIRE";
        const baseJitter = spec.fire?.jitter ?? 0;
        const aimSpreadRad = this.autoGunAimSpread(holdTs[b] ?? 0, baseJitter);
        pushDbg(b, {
          aim,
          want,
          targetId: tgt.id,
          state,
          aimSpreadRad,
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
    const sockRange = slot != null ? this.s.player.spec.sockets[slot]?.range : undefined;
    if (sockRange != null && sockRange > 0) return sockRange;
    if (spec.launch.mode === "beam") return spec.launch.range;
    return 340;
  }

  /** World position of an automatic barrel's gun mount (falls back to craft origin). */
  autoGunMountWorld(slot: number, barrel: number): { x: number; y: number } {
    const h = this.s.player;
    const craft = h.spec;
    const socket = craft.sockets[slot];
    let mount: { x: number; y: number } | undefined;
    if (socket && socket.class === "turret") {
      const mounts = craftGunMounts(craft);
      const gi = this.s.hostCraft.gunVisualIndexForSlot(slot, barrel);
      mount = mounts[gi] ?? mounts[0];
    }
    if (!mount && socket) {
      const pts = craftSocketPoints(craft, socket);
      mount = pts[barrel] ?? pts[0];
    }
    if (!mount) return { x: h.x, y: h.y };
    return this.s.hostCraft.craftBodyMountWorldPos(mount);
  }

  /**
   * Preferred engage bearing for a barrel: craft heading + authored socket `heading`.
   */
  autoGunPreferHeading(slot: number, barrel: number): number {
    const h = this.s.player;
    return Phaser.Math.Angle.Wrap(h.angle + craftGunPreferOffset(h.spec, slot, barrel));
  }

  /**
   * Socket traverse cone: arc from socket, center from barrel heading.
   */
  stationTraverseForBarrel(
    slot: number,
    barrel: number,
    craft: Craft = this.s.player
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
    craft: Craft,
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

  /** Active weapon strip — remote POV loadout or bird loadout. */
  hudLoadout(): PlayerWpnSpec[] {
    return this.s.remoteFleet.povHudRemote()?.loadout ?? this.s.loadout;
  }

  hudAmmo(): number[] {
    const rem = this.s.remoteFleet.povHudRemote();
    if (!rem?.ammo || !rem.loadout) return this.ammo;
    // Host-linked slots (howitzer spot / call-strike) show the dropship bank.
    return rem.loadout.map((wp, i) => {
      const hostId = remoteHostAmmoWeapon(wp);
      if (hostId) {
        const n = this.hostWeaponAmmoLeft(hostId);
        return n ?? rem.ammo![i]!;
      }
      return rem.ammo![i]!;
    });
  }

  /**
   * Host gun slot currently owned by remote spotting / call-strike walk.
   * Automatic stations skip AI and slew toward reticle/mark while this is set.
   */
  hostSpotSlewSlot(): number {
    const hostWalk = this.s.callStrike.marks.find(
      (m) => m.hostWeapon && m.roundsLeft > 0
    );
    if (hostWalk?.hostWeapon) {
      const slot = this.hostWeaponSlot(hostWalk.hostWeapon);
      if (slot >= 0) return slot;
    }
    const rem = this.s.remoteFleet.povHudRemote();
    if (rem && !rem.airborne) {
      const wp = rem.loadout?.[rem.weapon ?? 0];
      const hostId = wp ? remoteHostAmmoWeapon(wp) : undefined;
      if (hostId) {
        const slot = this.hostWeaponSlot(hostId);
        if (slot >= 0) return slot;
      }
    }
    return -1;
  }

  /** True while a host-weapon call-strike barrage still has rounds left. */
  hostWeaponStrikeActive(wpnId?: WpnId): boolean {
    return this.s.callStrike.marks.some(
      (m) =>
        !!m.hostWeapon &&
        m.roundsLeft > 0 &&
        (wpnId == null || m.hostWeapon === wpnId)
    );
  }

  ensureStationFireCd(slot: number): number[] {
    const n = Math.max(1, craftSocketBarrelCount(this.s.player.spec, slot));
    const cds =
      this.stationFireCd[slot] ??
      (this.stationFireCd[slot] = Array.from({ length: n }, () => 0));
    while (cds.length < n) cds.push(0);
    return cds;
  }

  hostStationFireReady(wpnId: WpnId): boolean {
    const slot = this.hostWeaponSlot(wpnId);
    if (slot < 0) return false;
    return (this.ensureStationFireCd(slot)[0] ?? 0) <= 0;
  }

  /** Barrel close enough to aim point for a host strike / spot shot. */
  hostStationAlignedTo(wpnId: WpnId, aim: { x: number; y: number }): boolean {
    const slot = this.hostWeaponSlot(wpnId);
    if (slot < 0) return false;
    const gunI = this.s.hostCraft.gunVisualIndexForSlot(slot);
    const tip =
      gunI >= 0 && this.s.hostCraft.guns[gunI]?.visible
        ? this.s.hostCraft.gunTip(gunI)
        : { x: this.s.player.x, y: this.s.player.y };
    const want = Math.atan2(aim.y - tip.y, aim.x - tip.x);
    const ang = this.s.player.stationAim[slot]?.[0] ?? this.s.player.gunAngle;
    return Math.abs(Phaser.Math.Angle.Wrap(want - ang)) <= AUTO_GUN_ALIGN_TOL * 1.6;
  }

  hostWeaponSlot(wpnId: WpnId): number {
    let slot = this.s.loadout.findIndex((w) => w.id === wpnId);
    if (slot < 0) slot = this.s.player.spec.sockets.findIndex((s) => s.weapon === wpnId);
    return slot;
  }

  hostWeaponAmmoLeft(wpnId: WpnId): number | undefined {
    const slot = this.hostWeaponSlot(wpnId);
    if (slot < 0) return undefined;
    return this.ammo[slot];
  }

  hudWeapon(): number {
    const rem = this.s.remoteFleet.povHudRemote();
    return rem?.weapon ?? this.s.player.weapon;
  }

  selectWeapon(slot: number): void {
    // POV remote HUD owns 1–N while piloting — never switches the bird loadout.
    const rem = this.s.remoteFleet.povHudRemote();
    if (rem?.loadout) {
      if (slot < 0 || slot >= rem.loadout.length) return;
      rem.weapon = slot;
      return;
    }
    if (slot < 0 || slot >= this.s.loadout.length) return;
    const wasHound = !!this.s.remoteFleet.selectedSlotRemote()?.spec.pilotable;
    this.s.player.weapon = slot;
    const live = this.s.remoteFleet.selectedSlotRemote();
    if (live?.spec.pilotable || (live && !live.spec.ai)) {
      this.s.remoteFleet.enterRemoteView();
    } else if (wasHound) {
      // HOUND POV is HUD-tied; Spectre POV stays sticky when switching to guns.
      this.s.remoteFleet.remoteView = false;
      this.s.thermal.apply();
    }
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
    const h = this.s.player;
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

  /**
   * Trigger a real host station fire (same path as the player aiming that gun).
   * Uses shared `stationFireCd` so strike / remote / crew cannot overlapping-fire.
   * Does not forge station aim — barrel angle / traverse from normal slew apply.
   * `ptr` is the ballistic aim point (reticle / call-strike wobble).
   */
  fireHostWeaponAt(
    wpnId: WpnId,
    ptr: { x: number; y: number },
    opts?: { fromStrike?: boolean }
  ): boolean {
    const hostSpec = PLAYER_WPNS[wpnId];
    if (!hostSpec) return false;
    const slot = this.hostWeaponSlot(wpnId);
    if (slot < 0) return false;
    if (!opts?.fromStrike && this.hostWeaponStrikeActive(wpnId)) return false;
    if (!this.hasAmmo(slot)) return false;
    const cds = this.ensureStationFireCd(slot);
    if ((cds[0] ?? 0) > 0) return false;
    cds[0] = craftSocketFireCd(hostSpec.fireCd, this.s.player.spec, slot);
    this.firePlayerWeapon(slot, hostSpec, ptr);
    return true;
  }

  /** Shell-gun kick opposite the bore (turret aim or fixed hull heading). */
  applyPlayerShellRecoil(slot: number, spec: PlayerWpnSpec, gunAngle: number): void {
    const h = this.s.player;
    const fireSock = h.spec.sockets[slot];
    if (!(h.spec.cannonInherit || fireSock?.recoil) || !specIsShellGun(spec)) return;
    const kick = (9 + spec.dmg * 0.28) * Math.min(1.35, spec.fireCd / 0.04);
    h.applyGunRecoil(kick, gunAngle);
  }

  /**
   * Prefer threats by class, gun-placement heading, and proximity for automatic stations.
   * Range / proximity use `fromX/Y` (per-barrel heading-biased origin). Traverse arcs use
   * craft→target vs `heading`. `preferHeading` scores angular preference from the acquire origin.
   * `groundOnly` skips aircraft — howitzer crew never slews or fires at them.
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
    preferHeading = heading,
    groundOnly = false
  ): Unit | undefined {
    let best: Unit | undefined;
    let bestScore = -1e9;
    for (const u of this.s.units) {
      if (u.dead || (groundOnly && isAerial(u.kind))) continue;
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

  nearestUnitInFrontArc(
    x: number,
    y: number,
    heading: number,
    maxR: number,
    traverse?: StationTraverse
  ): Unit | undefined {
    return this.pickAutoTarget(x, y, x, y, heading, maxR, traverse);
  }

  missileMuzzle(x: number, y: number, z: number, ang: number, fxScale = 1, depthOff?: number): void {
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    this.s.fx.emitVisualBurst(x, y, z, {
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
      depthOff,
    }, this.s.fx.muzzleBurst);
    this.s.fx.showMuzzle({
      life: 0.12,
      ang,
      scaleMul: 0.92 * range(0.9, 1.12),
      worldX: x,
      worldY: y,
      worldZ: z,
      depthOff,
    });
  }

  reticlePickTarget(
    x: number,
    y: number,
    max: number,
    categories?: readonly ("air" | "ground" | "vehicle")[]
  ): Unit | undefined {
    let best: Unit | undefined;
    let bestScore = Infinity;
    for (const u of this.s.units) {
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
    const { sx, sy } = this.s.worldToHudScreen(u.x, u.y, u.z);
    const w = this.s.scale.width;
    const h = this.s.scale.height;
    const on = sx > pad && sx < w - pad && sy > pad && sy < h - pad;
    return { on, sx, sy };
  }

  nearestUnit(x: number, y: number, max: number): Unit | undefined {
    let best: Unit | undefined;
    let bd = max;
    for (const u of this.s.units) {
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
    const pt = this.s.pointerScreen();
    let best: Unit | undefined;
    let bd = 58;
    for (const u of this.s.units) {
      if (u.dead) continue;
      if (castZ(this.s.world, u.x, u.y, u.z) < 16 && !isAerial(u.kind)) continue;
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

  /** Unit under reticle (footprint tested in projected screen space). */
  reticleUnit(): Unit | undefined {
    const pt = this.s.pointerScreen();
    let best: Unit | undefined;
    let bd = Infinity;
    const hit = { x: 0, y: 0, z: 0 };
    for (const u of this.s.units) {
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

  hasAmmo(slot: number): boolean {
    if (this.s.debugMenu.infAmmo) return true;
    return (this.ammo[slot] ?? 0) > 0;
  }

  spendAmmo(slot: number): void {
    if (this.s.debugMenu.infAmmo) return;
    this.ammo[slot]!--;
  }
}

/** Player chin / cabin traverse rate (rad/s) — also used by crew-served auto stations. */
export const GUN_STATION_TURN_RATE = 6.4;
