import Phaser from "phaser";
import { groundHull, settleGroundMove } from "../../../sim/navigation";
import { remoteAiStickAim, tickRemoteIdle } from "../../../sim/remoteRules";
import { payloadIsRemote } from "../../../sim/payload";
import { nextId, PLAYER_WPNS, type PlayerWpnSpec, type WpnId } from "../../../sim/combat";
import { initRemoteLoadout, remoteHasPovHud, remoteRotorParts, remoteSpecOf, type RemoteCraft, type BayRemote, type RemoteSpec } from "../../../sim/remote";
import { Craft } from "../../../sim/craft";
import { craftAimsWithTurret, craftGunId, craftGunPreferOffset, craftControlScheme, craftOf, craftSocketPoints, craftSocketStartingAmmo } from "../../../sim/crafts";
import { groundZ, castZ } from "../../../worldgen/world";
import type { MissionScene } from "../../missionScene";

/** Host AGL a ground remote's dock bay must be under to actually dock (can't reel a ground vehicle up mid-air). */
const DOCK_GROUND_MAX_AGL = 30;

/** Follow escort: remote speed above which the host keeps pace at the inner ring. */
const ESCORT_MOVING_SPEED = 14;
/** Follow escort: start pacing this far inside the inner ring so thrust doesn't chatter. */
const ESCORT_RING_BAND = 12;
/** Follow escort: extra host speed per unit of distance beyond the inner ring. */
const ESCORT_RING_GAIN = 1.4;
/** Host waypoint reached within this (world): host switches to HOLD there. */
const HOST_WAYPOINT_ARRIVE = 40;


/** Launch order: most battery first, then most health. */
function bayRemoteRank(a: BayRemote, b: BayRemote): number {
  return b.life - a.life || b.health - a.health;
}

/** Remote fleet: launch from the bay, piloting + POV view, dock approach/capture + stow, bay pools, host escort, per-frame remote update. */
export class RemoteFleet {
  /** Player is actively flying a remote (WASD owned by remote, not host). */
  remotePilotActive = false;
  /** Camera + WASD are on the live remote (independent of which weapon is selected). */
  remoteView = false;
  /**
   * Shadow `Craft` for craft-backed remotes (pilot + AI) — same flight path as player craft.
   * Keyed by remote id; dropped on dock / detonate / mission reset.
   */
  remotePilotCraft = new Map<number, Craft>();
  /** Remotes integrated via shadow Craft this frame (skip vx·dt integrate in updateRemotes). */
  remoteCraftDriven = new Set<number>();
  /** Host craft escort while piloting a POV remote — default hold. */
  hostEscortMode: "hold" | "follow" = "hold";
  /** Follow leash hysteresis — true while closing to the inner ring after breaking outer. */
  hostEscortSeeking = false;
  /** Host-craft waypoint set from a POV escort remote; only valid while piloting that remote (`pilotId`). */
  hostWaypoint?: { x: number; y: number; pilotId: number };
  /** 0 = heli cam, 1 = remote cam. Eased when entering / leaving Spectre view. */
  remoteCamT = 0;
  /** Per-slot docked dockable remotes (life/health), kept in step with `ammo`. */
  bayRemotes: BayRemote[][] = [];

  constructor(readonly s: MissionScene) {}

  /** Per-mission state reset (called from the scene's init). */
  reset(): void {
    this.remotePilotCraft.clear();
    this.remoteCraftDriven.clear();
    this.remoteView = false;
    this.remoteCamT = 0;
    this.hostEscortMode = "hold";
    this.hostEscortSeeking = false;
    this.hostWaypoint = undefined;
    this.bayRemotes = this.s.loadout.map(() => []);
  }

  /** Frame start: resolve who's piloted, then drive the pilot (or idle a parked remote). Returns the pilot. */
  tickControl(dt: number, aim: { x: number; y: number }): RemoteCraft | undefined {
    const pilot = this.pilotingRemote();
    this.remoteCraftDriven.clear();
    // POV remotes (HOUND): after Q exit the slot stays selected but bird flight returns.
    this.remotePilotActive = !!pilot && (this.remoteView || !remoteHasPovHud(pilot.spec));
    if (this.remotePilotActive && pilot && !pilot.airborne) {
      if (!pilot.dockPending) this.tickRemotePilot(pilot, dt, aim);
    } else {
      const parked = this.activeRemote();
      if (parked && !parked.spec.ai && !parked.airborne) tickRemoteIdle(this.s.world, parked, dt);
    }
    return pilot;
  }

  /**
   * Live remote for the *selected* HUD weapon only (launch / detonate / HOUND fire).
   */
  selectedSlotRemote(): RemoteCraft | undefined {
    const slot = this.s.loadout[this.s.player.weapon];
    if (!payloadIsRemote(slot?.payload)) return undefined;
    const wantKind = slot!.payload!.remote!.kind;
    return this.s.remotes.find((r) => !r.detonate && !r.dock && r.spec.kind === wantKind);
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
      return this.s.remotes.find(
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
    return this.s.remotes.find(
      (r) => !r.detonate && !r.dock && !r.spec.ai && !r.spec.pilotable
    );
  }

  enterRemoteView(): void {
    const canView =
      !!this.selectedSlotRemote() ||
      this.s.remotes.some((r) => !r.detonate && !r.dock && !r.spec.ai && !r.spec.pilotable);
    if (!canView) return;
    this.remoteView = true;
    this.s.thermal.apply();
  }

  exitRemoteView(): void {
    const hound = this.selectedSlotRemote()?.spec.pilotable
      ? this.selectedSlotRemote()
      : this.pilotingRemote();
    // Near-host dockable POV (Raptor): Q docks instead of just dropping the cam.
    if (hound && remoteHasPovHud(hound.spec) && hound.spec.dockable && this.remoteNearHost(hound)) {
      // POV stays on the remote through the auto-dock; arrival returns to the host.
      if (this.remoteView && this.pilotingRemote() === hound) {
        hound.dockPending = true;
        return;
      }
      hound.dock = true;
      this.remoteView = false;
      this.s.thermal.apply();
      return;
    }
    // POV-HUD remotes (HOUND / Raptor): Q drops the view and leaves the slot so the
    // bird HUD returns (LIVE). Staying on the drop slot would draw a bomb arc.
    if (hound && remoteHasPovHud(hound.spec)) {
      this.remoteView = false;
      for (let i = 0; i < this.s.loadout.length; i++) {
        if (i === this.s.player.weapon) continue;
        const wp = this.s.loadout[i]!;
        if (
          !payloadIsRemote(wp.payload) ||
          wp.payload!.remote!.kind !== hound.spec.kind
        ) {
          this.s.player.weapon = i;
          break;
        }
      }
      this.s.thermal.apply();
      return;
    }
    // Legacy HOUND / non-socket pilotable: Q releases by switching off its slot.
    if (hound) {
      for (let i = 0; i < this.s.loadout.length; i++) {
        if (i === this.s.player.weapon) continue;
        const wp = this.s.loadout[i]!;
        if (
          !payloadIsRemote(wp.payload) ||
          wp.payload!.remote!.kind !== hound.spec.kind
        ) {
          this.s.player.weapon = i;
          break;
        }
      }
    }
    if (!this.remoteView) {
      this.s.thermal.apply();
      return;
    }
    this.remoteView = false;
    this.s.thermal.apply();
  }

  /** Peaceful dock radius for remotes returning to the host craft. */
  remoteDockRange(drone: RemoteCraft): number {
    return Math.max(160, this.s.player.spec.radius * 0.55 + drone.spec.radius + 48);
  }

  /** Ground remotes can't reach the bay unless the host is near the ground. */
  groundDockBlocked(drone: RemoteCraft): boolean {
    if (!drone.spec.ground) return false;
    const h = this.s.player;
    return castZ(this.s.world, h.x, h.y, h.z) > DOCK_GROUND_MAX_AGL;
  }

  /** Remote the player is watching dock from its POV (host is automated meanwhile). */
  povDockRemote(): RemoteCraft | undefined {
    const pilot = this.remoteView ? this.pilotingRemote() : undefined;
    return pilot?.dockPending ? pilot : undefined;
  }

  /** Host auto-descends only during a POV dock that needs it. */
  hostDockDescend(): boolean {
    const r = this.povDockRemote();
    return !!r && this.groundDockBlocked(r);
  }

  /** Left the POV mid-dock: finish as a normal autonomous dock. */
  tickPendingDock(): void {
    const pov = this.povDockRemote();
    for (const r of this.s.remotes) {
      if (!r.dockPending || r === pov) continue;
      r.dockPending = false;
      if (!r.detonate) r.dock = true;
    }
  }

  remoteNearHost(drone: RemoteCraft): boolean {
    const d = Math.hypot(drone.x - this.s.player.x, drone.y - this.s.player.y, drone.z - this.s.player.z);
    return d < this.remoteDockRange(drone);
  }

  /**
   * Q from bird-cam — send every live dockable remote home. The player flies the host, so a
   * ground remote parks under a too-high bay and the alert prompts them to descend.
   */
  recallDockables(): void {
    let any = false;
    for (const r of this.s.remotes) {
      if (r.detonate || r.dock || !r.spec.dockable) continue;
      r.dock = true;
      any = true;
    }
    if (any) this.s.thermal.apply();
  }

  /** Toggle dropship FOLLOW / HOLD while piloting a POV remote with `hostEscort`. */
  toggleHostEscortMode(): void {
    const pilot = this.povHudRemote();
    if (!pilot?.spec.hostEscort) return;
    this.hostEscortMode = this.hostEscortMode === "hold" ? "follow" : "hold";
    this.hostEscortSeeking = false;
    this.hostWaypoint = undefined;
  }

  /** Waypoint key: from a POV escort remote, send the host craft to `at` (it HOLDs there on arrival). */
  placeWaypoint(at: { x: number; y: number }): void {
    const pilot = this.povHudRemote();
    if (!pilot?.spec.hostEscort) return;
    this.hostWaypoint = { x: at.x, y: at.y, pilotId: pilot.id };
    this.hostEscortSeeking = false;
  }

  /** Host waypoint while it applies (piloting the remote it was set from). */
  activeHostWaypoint(): { x: number; y: number } | undefined {
    const wp = this.hostWaypoint;
    return wp && this.povHudRemote()?.id === wp.pilotId ? wp : undefined;
  }

  /**
   * Host craft drive while a POV remote is piloted.
   * Spoofs stick + aim into the normal heli controller (no custom locomotion):
   * - `hostFace`: yaw toward the remote (orbit hosts use A/D; plane hosts aim-turn).
   * - `hostEscort` Hold parks; Follow paces a moving remote at the inner ring, catches up
   *   (turn first, then thrust) past the outer ring, and parks without yawing when idle.
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
    const h = this.s.player;
    const zero = { up: false, down: false, left: false, right: false };
    // Spot howitzer, artillery strike, or an active host barrage — all direct the howitzer.
    const faceAim = this.s.fireControl.hostSpotSlewSlot() >= 0;

    // Face-only (Raptor): keep cruising, yaw the hull toward the pilot.
    if (pilot.spec.hostFace) {
      return this.s.fireControl.hostFacePointStick(pilot.x, pilot.y, zero, false);
    }

    if (!pilot.spec.hostEscort) {
      // No escort profile — Hold-equivalent: face reticle while directing howitzer.
      if (faceAim) {
        const ptr = this.s.worldPointer();
        return this.s.fireControl.hostFacePointStick(ptr.x, ptr.y, zero, true);
      }
      return undefined;
    }

    // Waypoint: fly there, then HOLD.
    const wp = this.activeHostWaypoint();
    if (wp) {
      const d = Math.hypot(wp.x - h.x, wp.y - h.y);
      if (d > HOST_WAYPOINT_ARRIVE) {
        return this.hostApproach(wp.x, wp.y, true, Math.min(h.spec.maxSpeed, Math.max(h.spec.maxSpeed * 0.42, d * ESCORT_RING_GAIN)));
      }
      this.hostWaypoint = undefined;
      this.hostEscortMode = "hold";
    }

    // Hold heading by aiming ahead of the nose (turrets use worldPointer separately).
    const parkAimX = h.x + Math.cos(h.angle) * 80;
    const parkAimY = h.y + Math.sin(h.angle) * 80;
    if (this.hostEscortMode === "hold") {
      this.hostEscortSeeking = false;
      // Directing howitzer in Hold: yaw toward mouse (Follow wins when toggled).
      if (faceAim) {
        const ptr = this.s.worldPointer();
        return this.s.fireControl.hostFacePointStick(ptr.x, ptr.y, zero, true);
      }
      return { stick: zero, aimX: parkAimX, aimY: parkAimY, brake: true };
    }

    const { innerRadius, outerRadius } = pilot.spec.hostEscort;
    const dist = Math.hypot(h.x - pilot.x, h.y - pilot.y);
    const pilotSpd = Math.hypot(pilot.vx, pilot.vy);
    const moving = pilotSpd > ESCORT_MOVING_SPEED;
    if (this.hostEscortSeeking) {
      if (dist <= innerRadius) this.hostEscortSeeking = false;
    } else if (dist > outerRadius) {
      this.hostEscortSeeking = true;
    }
    // Remote on the move: hold the inner ring rather than waiting for the leash to break.
    const chase = this.hostEscortSeeking || (moving && dist > innerRadius - ESCORT_RING_BAND);

    if (!chase) {
      // Idle inside the leash: only yaw toward the remote while directing the howitzer.
      if (faceAim) return this.s.fireControl.hostFacePointStick(pilot.x, pilot.y, zero, true);
      return { stick: zero, aimX: parkAimX, aimY: parkAimY, brake: !moving };
    }

    // Steer at the remote itself: the ring point flips behind the host once inside the ring.
    // Match the remote's pace plus a gain on ring error; leash breaks keep the old crawl floor.
    const pace = pilotSpd + Math.max(0, dist - innerRadius) * ESCORT_RING_GAIN;
    const cap = Math.min(
      h.spec.maxSpeed,
      this.hostEscortSeeking ? Math.max(h.spec.maxSpeed * 0.42, pace) : pace
    );
    // Inside the band: track heading but coast, so it settles on the ring.
    return this.hostApproach(pilot.x, pilot.y, dist > innerRadius, cap);
  }

  /** Host catch-up toward a point: yaw first, thrust (speed-capped) only once lined up, brake while turning. */
  private hostApproach(tx: number, ty: number, outside: boolean, cap: number) {
    const h = this.s.player;
    const err = Math.abs(Phaser.Math.Angle.Wrap(Math.atan2(ty - h.y, tx - h.x) - h.angle));
    // ~28° — yaw first, then crawl; avoids thrusting off-axis.
    const aligned = err < 0.49;
    return {
      stick: { up: aligned && outside, down: false, left: false, right: false },
      aimX: tx,
      aimY: ty,
      // Kill residual speed while lining up so it doesn't coast the wrong way.
      brake: !aligned && outside,
      speedCap: aligned && outside ? cap : undefined,
    };
  }

  /** Extra stop for hold / inside-leash / turn-to-align so the dropship doesn't drift. */
  brakeHostEscort(dt: number): void {
    const h = this.s.player;
    const damp = Math.pow(0.04, dt);
    h.vx *= damp;
    h.vy *= damp;
  }

  /** Clamp host speed while follow-thrusting (slower than full throttle). */
  capHostEscortSpeed(cap: number): void {
    const h = this.s.player;
    const spd = Math.hypot(h.vx, h.vy);
    if (spd > cap && spd > 1e-4) {
      const s = cap / spd;
      h.vx *= s;
      h.vy *= s;
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
    const h = this.s.player;
    const pylon = at ?? this.s.fireControl.hardpointPylon(slot, true);
    // Leave along the socket heading (0 forward, 180 aft). A ground remote
    // launched above its pad falls; one launched on the ground sits on it.
    const ang = h.angle + craftGunPreferOffset(h.spec, slot) + yawOff;
    const cp = Math.cos(pitchOff);
    const sp = Math.sin(pitchOff);
    const kick = remoteSpec.launchSpeed;
    const gnd = groundZ(this.s.world, pylon.x, pylon.y);
    const pad = gnd + remoteSpec.cruiseAgl;
    const drop = !!remoteSpec.ground && h.z > pad + 8;
    const duration = spec.payload.remote!.duration;
    const bay = remoteSpec.dockable ? this.takeBayRemote(slot) : undefined;
    this.s.stats.remoteLaunch(remoteSpec.craftLook ?? remoteSpec.kind);
    this.s.remotes.push({
      id: nextId(),
      spec: remoteSpec,
      x: pylon.x,
      y: pylon.y,
      z: remoteSpec.ground ? (drop ? h.z : pad) : (at?.z ?? this.s.fireControl.playerMuzzleZ(slot)),
      vx: h.vx * (drop ? 0.55 : 0.85) + Math.cos(ang) * kick * cp,
      vy: h.vy * (drop ? 0.55 : 0.85) + Math.sin(ang) * kick * cp,
      vz: drop ? h.vz * 0.35 - 30 : remoteSpec.ground ? 0 : h.vz * 0.4 + kick * sp,
      angle: ang,
      health: bay?.health ?? remoteSpec.health,
      life: remoteSpec.unlimitedLife ? duration : (bay?.life ?? duration),
      lifeMax: duration,
      rotor: Math.random() * Math.PI * 2,
      orbit: Math.random() * Math.PI * 2,
      gunAngle: ang,
      track: 0,
      airborne: drop || undefined,
    });
    const launched = this.s.remotes[this.s.remotes.length - 1]!;
    initRemoteLoadout(launched);
    if (bay?.ammo && launched.ammo) launched.ammo = bay.ammo.slice();
    // Spectre auto-views; HOUND takes control when dropped from its selected HUD slot.
    if (!remoteSpec.ai || remoteSpec.pilotable) {
      const selectedKind = payloadIsRemote(this.s.loadout[this.s.player.weapon]?.payload)
        ? this.s.loadout[this.s.player.weapon]!.payload!.remote!.kind
        : undefined;
      if (!remoteSpec.ai || selectedKind === remoteSpec.kind) {
        this.remoteView = true;
        this.s.thermal.apply();
      }
    }
  }

  /**
   * Player-driven remote kinematics. All remotes are craft-backed (`craftLook`);
   * drive through the same Craft.update path as a selected player craft.
   * Lifecycle (HUD / cam / battery / dock) stays on the remote wrapper.
   */
  tickRemotePilot(drone: RemoteCraft, dt: number, aim: { x: number; y: number }): void {
    if (!drone.spec.craftLook) return;
    this.tickRemoteCraftPilot(drone, dt, aim);
  }

  /** Shadow Craft for a craft-backed remote — created once, kinematics synced each frame. */
  ensureRemotePilotCraft(drone: RemoteCraft): Craft | undefined {
    const kind = drone.spec.craftLook;
    if (!kind) return undefined;
    let craft = this.remotePilotCraft.get(drone.id);
    if (!craft) {
      craft = new Craft(drone.x, drone.y, this.s.world, kind);
      craft.startAirborne(drone.angle, this.s.world);
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

  /**
   * Drive a remote through the same Craft.update path as a player craft.
   * Marks the remote craft-driven this frame (no second vx·dt integrate).
   */
  driveRemoteCraft(
    drone: RemoteCraft,
    dt: number,
    stick: { up: boolean; down: boolean; left: boolean; right: boolean },
    aim: { x: number; y: number },
    opts?: {
      space?: boolean;
      shift?: boolean;
      /** World point for turret slew; defaults to `aim`. */
      gunAim?: { x: number; y: number };
      /** When false, skip track stamps (caller handles). Default true. */
      stampTracks?: boolean;
      /** When false, skip turret/nose gun sync. Default true. */
      syncGun?: boolean;
    }
  ): void {
    const craft = this.ensureRemotePilotCraft(drone);
    if (!craft) return;
    const trackX0 = drone.x;
    const trackY0 = drone.y;
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
      this.s.world,
      stick,
      aim.x,
      aim.y,
      drone.spec.ground ? false : !!opts?.space,
      drone.spec.ground ? false : !!opts?.shift
    );
    // Ground remotes follow the shared ground-step rule with their hull's terrain ability (climb, slope slowdown, underwater).
    if (drone.spec.ground && !drone.airborne) settleGroundMove(this.s.world, craft, trackX0, trackY0, this.s.nav.onDeck, groundHull(drone));
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
    // Every ground remote (piloted or AI) collides with buildings, statics and vehicles; pressing into one is a jam.
    if (drone.spec.ground && !drone.airborne) {
      const pen = this.s.remoteAi.resolveGroundRemote(drone);
      if (pen > 0.5 && (stick.up || stick.down)) this.s.nav.noteJam(drone, dt);
    }
    this.remoteCraftDriven.add(drone.id);

    if (opts?.syncGun !== false) {
      const selected = Phaser.Math.Clamp(
        drone.weapon ?? 0,
        0,
        Math.max(0, craft.spec.sockets.length - 1)
      );
      craft.weapon = selected;
      const gunAim = opts?.gunAim ?? aim;
      if (craftAimsWithTurret(craft.spec)) {
        const want = Math.atan2(gunAim.y - drone.y, gunAim.x - drone.x);
        this.s.fireControl.slewCraftTurretStations(craft, want, dt, selected);
        drone.gunAngle = craft.gunAngle;
      } else {
        drone.gunAngle = craft.angle;
        craft.gunAngle = craft.angle;
      }
    }
    drone.health = Math.min(drone.health, craft.health);
    if (opts?.stampTracks !== false && drone.spec.track && !drone.airborne) {
      this.s.remoteBody.stampRemoteTracks(drone, dt, trackX0, trackY0);
    }
  }

  /** Player WASD → shadow Craft. */
  tickRemoteCraftPilot(drone: RemoteCraft, dt: number, aim: { x: number; y: number }): void {
    this.driveRemoteCraft(
      drone,
      dt,
      {
        up: this.s.keyW.isDown,
        down: this.s.keyS.isDown,
        left: this.s.keyA.isDown,
        right: this.s.keyD.isDown,
      },
      aim,
      {
        space: this.s.keySpace.isDown,
        shift: this.s.keyShift.isDown,
      }
    );
    if (drone.spec.dockable) {
      if (this.remoteNearHost(drone) && drone.life < 10) drone.dock = true;
    }
  }

  releaseRemotePilotCraft(id: number): void {
    this.remotePilotCraft.delete(id);
  }

  /** Host bay world pos for dockable remotes — socket whose weapon launches this kind. */
  remoteDockBayPos(drone: RemoteCraft): { x: number; y: number; z: number } {
    const h = this.s.player;
    const socket = h.spec.sockets.find((s) => {
      const w = PLAYER_WPNS[s.weapon as WpnId];
      return w?.payload?.remote?.kind === drone.spec.kind;
    });
    if (socket) {
      const pts = craftSocketPoints(h.spec, socket);
      if (pts[0]) {
        const p = this.s.hostCraft.craftBodyMountWorldPos(pts[0]);
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
    // Ground remote under the bay: park until the host is low enough.
    if (drone.spec.ground && Math.hypot(dx, dy) < 24) {
      const ahead = { x: drone.x + Math.cos(drone.angle) * 100, y: drone.y + Math.sin(drone.angle) * 100 };
      const idle = { up: false, down: false, left: false, right: false };
      this.driveRemoteCraft(drone, dt, idle, ahead, { syncGun: false });
      drone.vx *= Math.pow(0.02, dt);
      drone.vy *= Math.pow(0.02, dt);
      return false;
    }

    const want = Math.atan2(dy, dx);
    const approach = Phaser.Math.Clamp(dist / 220, 0.22, 1);
    const { stick, aim } = remoteAiStickAim(drone, want, 0.35 + approach * 0.75);
    this.driveRemoteCraft(drone, dt, stick, aim, { syncGun: false });
    drone.gunAngle = drone.angle;
    drone.vz += dz * 2.6 * dt;
    drone.vz *= Math.pow(0.3, dt);
    if (dist < 110) {
      const pull = 1 - Math.exp(-5 * dt);
      const along = drone.spec.maxSpeed * (0.45 + approach * 0.4) * 0.9;
      drone.vx = Phaser.Math.Linear(drone.vx, (dx / dist) * along, pull);
      drone.vy = Phaser.Math.Linear(drone.vy, (dy / dist) * along, pull);
    }
    return false;
  }

  /**
   * Ground remotes: locked pad AGL like enemy vehicles (no heli-style soft climb).
   * Airborne drops fall under gravity and thud-land with no bounce.
   */
  snapRemoteGround(drone: RemoteCraft, dt: number): void {
    // Ground hulls wade shallows on the bed (or ride a deck), like enemy ground units.
    const gnd = drone.spec.ground ? this.s.nav.surfaceZ(drone.x, drone.y) : groundZ(this.s.world, drone.x, drone.y);
    if (!drone.spec.ground) {
      const rest = gnd + drone.spec.cruiseAgl;
      drone.vz += (rest - drone.z) * 2.4 * dt;
      drone.vz *= Math.pow(0.2, dt);
      return;
    }
    const pad = gnd + drone.spec.cruiseAgl;
    if (drone.airborne) {
      drone.vz -= 620 * dt;
      if (drone.z <= pad) {
        drone.z = pad;
        drone.vz = 0;
        drone.airborne = false;
        this.s.remoteBody.emitHoundLandingThud(drone);
      }
      return;
    }
    // Instant clamp — same language as enemy tanks on dirt.
    drone.z = pad;
    drone.vz = 0;
  }

  updateRemotes(dt: number): void {
    this.tickBayRemotes(dt);
    this.tickPendingDock();
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
      payloadIsRemote(this.s.loadout[this.s.player.weapon]?.payload) &&
      remoteSpecOf(this.s.loadout[this.s.player.weapon]!.payload!.remote!.kind).pilotable &&
      !selected
    ) {
      // HOUND slot selected but the vehicle is gone — drop view so a fresh drop can launch.
      this.remoteView = false;
      this.s.thermal.apply();
    }

    const pilotedId = this.pilotingRemote()?.id;
    // Drive AI pods / dock approaches every frame (piloted remotes steered earlier via shadow Craft).
    for (const r of this.s.remotes) {
      if (r.detonate || r.airborne) continue;
      if (r.dock || r.dockPending) {
        this.tickRemoteDockApproach(r, dt);
        continue;
      }
      if (r.spec.ai && r.id !== pilotedId) {
        this.s.remoteAi.tickRemoteAi(r, dt);
      }
    }
    let w = 0;
    for (let i = 0; i < this.s.remotes.length; i++) {
      const r = this.s.remotes[i]!;
      const trackX0 = r.x;
      const trackY0 = r.y;
      if (!r.spec.unlimitedLife) r.life -= dt;
      // Shadow-Craft remotes (pilot + AI) already integrated inside Craft.update this frame.
      if (!this.remoteCraftDriven.has(r.id)) {
        r.x += r.vx * dt;
        r.y += r.vy * dt;
        r.z += r.vz * dt;
        if (r.spec.ground && !r.airborne) settleGroundMove(this.s.world, r, trackX0, trackY0, this.s.nav.onDeck, groundHull(r));
      }
      const docking = r.dock || !!r.dockPending;
      if (!docking) this.snapRemoteGround(r, dt);
      // Ground remotes that can't go underwater drown in deep water (normal remote destruction).
      if (r.spec.ground && !r.airborne && !docking && !r.detonate && this.s.nav.drowns(r)) {
        r.drowned = true;
        this.s.targeting.damageRemote(r, r.health + 1);
      }
      // Craft-driven remotes stamp tracks inside driveRemoteCraft.
      if (r.spec.track && !r.airborne && !this.remoteCraftDriven.has(r.id)) {
        this.s.remoteBody.stampRemoteTracks(r, dt, trackX0, trackY0);
      }
      if (r.life <= 0 && !r.dockPending) {
        if (r.spec.dockable) r.dock = true;
        else r.detonate = true;
      }
      if (r.dock || r.dockPending) {
        const bay = this.remoteDockBayPos(r);
        // Ground remotes can't climb to the bay — under it with the host low enough counts.
        const arrived = r.spec.ground
          ? Math.hypot(r.x - bay.x, r.y - bay.y) < 28 && !this.groundDockBlocked(r)
          : Math.hypot(r.x - bay.x, r.y - bay.y, r.z - bay.z) < 28;
        if (!arrived) {
          this.s.remotes[w++] = r;
          continue;
        }
        // Mark docked so POV lookups drop it before the view exits.
        r.dock = true;
        r.dockPending = false;
        this.releaseRemotePilotCraft(r.id);
        this.stowDockedRemote(r);
        if (!r.spec.ai || r.spec.pilotable) this.exitRemoteView();
        continue;
      }
      if (r.detonate && r.drowned) {
        // Drowned: no detonation, the hull sinks (same as a drowned unit).
        this.releaseRemotePilotCraft(r.id);
        const hull = craftOf(r.spec.craftLook);
        const key = this.s.textures.exists(hull.hulk ?? "") ? hull.hulk! : r.spec.body;
        this.s.destruction.sinkWreck(r, r.spec.radius, key, r.angle + (hull.rotOff ?? Math.PI / 2), r.spec.scale);
        const turret = r.spec.sockets.findIndex((sk) => sk.class === "turret");
        if (turret >= 0) {
          const parts = this.s.destruction.turretWreckParts(r.spec, [{ im: this.s.remoteBody.remoteGunImage(r), slot: turret }], r.z, r.gunAngle ?? r.angle);
          this.s.destruction.sinkParts(parts, r);
        }
        continue;
      }
      if (r.detonate) {
        this.releaseRemotePilotCraft(r.id);
        this.s.camera.beginImpactCamLinger(r.x, r.y, {
          thermal: r.spec.thermal ? this.s.thermal.craftSensorPalette() : undefined,
          hold: 1.65,
        });
        this.s.projectiles.explode(r.x, r.y, r.z, r.spec.detonateBlast, r.spec.detonateDmg, undefined, r.vx, r.vy, r.vz, false, "guided-missile", 1);
        if (r.spec.wheels) this.s.destruction.spawnWheels(r.x, r.y, r.z, r.spec.wheels, r.spec.wheelDebrisScale);
        const turret = r.spec.sockets.findIndex((sk) => sk.class === "turret");
        if (turret >= 0) {
          this.s.destruction.popCraftTurrets(r.spec, [{ im: this.s.remoteBody.remoteGunImage(r), slot: turret }], r.z, r.gunAngle ?? r.angle);
        }
        continue;
      }
      // Shadow-Craft remotes spin rotors inside Craft.update.
      if (remoteRotorParts(r.spec).length && !this.remoteCraftDriven.has(r.id)) {
        r.rotor += 18 * dt;
      }
      this.s.remotes[w++] = r;
    }
    this.s.remotes.length = w;
    if (!this.activeRemote()) this.remoteView = false;
    this.s.remoteBody.syncRemoteSprites();
    this.s.remoteBody.remoteExhaustVisCursor = 0;
    for (const flame of this.s.remoteBody.remoteExhaustFlames) flame.setVisible(false);
    for (const glow of this.s.remoteBody.remoteExhaustGlows) glow.setVisible(false);
    for (const r of this.s.remotes) {
      if (r.spec.antenna) this.s.remoteBody.tickRemoteAntenna(r, dt);
      if (
        r.spec.craftLook &&
        r.spec.exhaustProfile?.flame === 0 &&
        !r.detonate &&
        !r.dock
      ) {
        const body = this.s.remoteBody.remoteBodyImage(r);
        if (body?.visible) this.s.hostCraft.emitExhaustPlume(r, dt, body);
      }
      if (
        r.spec.craftLook &&
        craftControlScheme(craftOf(r.spec.craftLook)) === "plane" &&
        !r.detonate &&
        !r.dock
      ) {
        this.s.remoteBody.emitRemotePlaneFx(r, dt);
      }
    }
    this.s.thermal.apply();
  }

  tickRemoteCamBlend(dt: number): void {
    const want = this.remoteView && this.activeRemote() ? 1 : 0;
    const rate = want > this.remoteCamT ? 3.1 : 4.6;
    this.remoteCamT = Phaser.Math.Linear(this.remoteCamT, want, 1 - Math.exp(-rate * dt));
    if (want === 0 && this.remoteCamT < 0.012) this.remoteCamT = 0;
  }

  remoteDetonateArmed(): boolean {
    const remote = this.selectedSlotRemote();
    return (
      this.remoteView &&
      !!remote &&
      !craftGunId(remote.spec) &&
      !remote.spec.pilotable &&
      payloadIsRemote(this.s.loadout[this.s.player.weapon]?.payload)
    );
  }

  /**
   * Ammo shown for a host remote slot: hangar reserve + live craft.
   * Dockable remotes (Skiffs) stay "available" while airborne or mid-dock
   * (refund happens on bay arrival); count drops only when lost.
   */
  remotePoolDisplayAmmo(slot: number, reserve: number): number {
    if (this.s.debugMenu.infAmmo || !Number.isFinite(reserve)) return reserve;
    const wp = this.s.loadout[slot];
    if (!payloadIsRemote(wp?.payload)) return reserve;
    const kind = wp!.payload!.remote!.kind;
    if (!remoteSpecOf(kind).dockable) return reserve;
    let live = 0;
    for (const r of this.s.remotes) {
      if (r.detonate || r.spec.kind !== kind) continue;
      live++;
    }
    return reserve + live;
  }

  stowDockedRemote(r: RemoteCraft): void {
    for (let i = 0; i < this.s.loadout.length; i++) {
      const w = this.s.loadout[i]!;
      if (!payloadIsRemote(w.payload)) continue;
      if (w.payload!.remote!.kind !== r.spec.kind) continue;
      // Match hangar capacity (craft ammoScale / socket mul), not bare catalog ammo.
      const cap = craftSocketStartingAmmo(w.ammo, this.s.player.spec, i);
      if (!Number.isFinite(cap)) return;
      if ((this.s.fireControl.ammo[i] ?? 0) < cap) {
        this.s.fireControl.ammo[i] = (this.s.fireControl.ammo[i] ?? 0) + 1;
        const roster = this.bayRemotes[i] ?? (this.bayRemotes[i] = []);
        roster.push({ life: Math.max(0, r.life), health: Math.max(0, r.health), ammo: r.ammo?.slice() });
        return;
      }
    }
  }

  /** Dockable remote spec launched from this loadout slot, if any. */
  dockableSlotRemote(slot: number): RemoteSpec | undefined {
    const kind = this.s.loadout[slot]?.payload?.remote?.kind;
    if (!kind) return undefined;
    const spec = remoteSpecOf(kind);
    return spec.dockable ? spec : undefined;
  }

  /** Bay roster for a dockable slot, padded with fresh remotes / trimmed to the hangar count. */
  bayRoster(slot: number): BayRemote[] {
    const roster = this.bayRemotes[slot] ?? (this.bayRemotes[slot] = []);
    const spec = this.dockableSlotRemote(slot);
    const n = this.s.fireControl.ammo[slot] ?? 0;
    if (!spec || !Number.isFinite(n)) return roster;
    const lifeMax = this.s.loadout[slot]!.payload!.remote!.duration;
    while (roster.length < n) roster.push({ life: lifeMax, health: spec.health });
    if (roster.length > n) {
      roster.sort(bayRemoteRank);
      roster.length = Math.max(0, n);
    }
    return roster;
  }

  /** Pull the best docked remote (life first, then health) for launch. */
  takeBayRemote(slot: number): BayRemote | undefined {
    const roster = this.bayRemotes[slot];
    if (!roster?.length) return undefined;
    roster.sort(bayRemoteRank);
    return roster.shift();
  }

  /** Docked remotes recharge battery and slowly repair up to their spec cap. */
  tickBayRemotes(dt: number): void {
    for (let i = 0; i < this.s.loadout.length; i++) {
      const spec = this.dockableSlotRemote(i);
      if (!spec) continue;
      const lifeMax = this.s.loadout[i]!.payload!.remote!.duration;
      const repairCap = spec.health * spec.dockRepairMax;
      for (const b of this.bayRoster(i)) {
        b.life = Math.min(lifeMax, b.life + (lifeMax / Math.max(0.1, spec.dockRechargeTime)) * dt);
        if (b.health < repairCap) {
          b.health = Math.min(repairCap, b.health + spec.health * spec.dockRepairRate * dt);
        }
      }
    }
  }

  /** Battery fraction of a dockable slot's pool (bay + live); undefined if none or unlimited. */
  remotePoolBattery(slot: number): number | undefined {
    const spec = this.dockableSlotRemote(slot);
    if (!spec || spec.unlimitedLife) return undefined;
    const lifeMax = Math.max(0.1, this.s.loadout[slot]!.payload!.remote!.duration);
    let sum = 0;
    let n = 0;
    for (const b of this.bayRoster(slot)) {
      sum += Phaser.Math.Clamp(b.life / lifeMax, 0, 1);
      n++;
    }
    for (const r of this.s.remotes) {
      if (r.detonate || r.spec.kind !== spec.kind) continue;
      sum += Phaser.Math.Clamp(r.life / lifeMax, 0, 1);
      n++;
    }
    return n ? sum / n : undefined;
  }

  /** Summed health fraction of a dockable slot's whole pool (bay + live, excluding lost). */
  remotePoolHealth(slot: number): number {
    const spec = this.dockableSlotRemote(slot);
    if (!spec) return 0;
    const max = Math.max(1, spec.health);
    let sum = 0;
    for (const b of this.bayRoster(slot)) sum += Phaser.Math.Clamp(b.health / max, 0, 1);
    for (const r of this.s.remotes) {
      if (r.detonate || r.spec.kind !== spec.kind) continue;
      sum += Phaser.Math.Clamp(r.health / max, 0, 1);
    }
    return sum;
  }
}
