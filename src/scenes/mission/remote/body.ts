import { heightOf, COUNTERMEASURES, craftCountermeasure, nextId, shotBehaviorOf, exhaustIsEnergy, exhaustRibbons, PLAYER_WPNS, wpnIdOf, type Shot, type Unit, type PlayerWpnSpec, type WeaponPayload, type EnergyTrailNode } from "../../../sim/combat";
import { tickWhipAntenna, whipAntennaRest } from "../../../sim/physics";
import { remoteHostAmmoWeapon, remoteSocketPoints } from "../../../sim/remoteRules";
import { poseRemoteGun, remoteBodyDrawPose, shellEjectSide, slopeSquash } from "../../../render/spritePose";
import { estimateBombFallTime, remoteBombReleaseVelocity } from "../../../sim/ballistics";
import { trackPrintAlpha } from "../../../render/fxCurves";
import { drawWhipAntennaStroke } from "../../../render/ribbons";
import { remoteMuzzleZ } from "../../../sim/aim";
import { ZOff, Layer, worldDepth } from "../../../render/depth";
import { craftOf, socketHullPlacement, craftAimsWithTurret, craftGunId, craftGunScale, craftControlScheme, craftCompositePartScale, craftExhaustFlameHue, craftExhaustMounts, craftRotorAlongScale, craftWingTipMounts } from "../../../sim/crafts";
import Phaser from "phaser";
import { AI_AIM_NARROW_BASE, AI_AIM_WIDE_MUL, launchGravity, targetingMode, specIsShellGun, specIsRocketPod, hardpointAmmoIndex, collapseSightTips, advanceAimHold, aimPrecisionSpread } from "../../../sim/weaponRuntime";
import { projectileFxScale, playerMuzzleFxMul, scaledProjectileFxCount } from "../../../render/fxScale";
import { payloadIsCallStrike, payloadIsHostFire } from "../../../sim/payload";
import { remoteHull, remoteRotorParts, remoteRotorPoolSize, type RemoteCraft } from "../../../sim/remote";
import { range, jitterDisk } from "../../../util/rng";
import { lookupSpriteMuzzles, lookupSpritePoints, lookupSpriteOrigin } from "../../../art/spriteOrigin";
import { spriteUvPos, FX_VARIANTS } from "../../../art/sprites";
import { groundZ, worldToScreen, screenToWorldAtZ, cameraPointVisible, projectHeading, isWater, sampleBiome } from "../../../worldgen/world";
import { themeOf, underwaterTint } from "../../../worldgen/theme";
import { groundHull } from "../../../sim/navigation";
import type { MissionScene } from "../../missionScene";
import { simParticleTexKey, simParticleLook } from "../../../render/simParticleLook";
import { applyThermalHeat } from "../../../render/thermal";
import { hostileUnit } from "../../../sim/targetRules";
import { remoteCraftKey } from "../flow/missionStats";

/** Remote body: sprites + gun pose, remote weapon fire, plane/exhaust FX, tread prints, landing thud, damage FX, whip antennas. */
export class RemoteBody {
  remoteAntennaGfx!: Phaser.GameObjects.Graphics;
  /** Plane-remote nozzle flame/glow (Raptor) — pooled across remotes each frame. */
  remoteExhaustFlames: Phaser.GameObjects.Image[] = [];
  remoteExhaustGlows: Phaser.GameObjects.Image[] = [];
  remoteExhaustVisCursor = 0;
  remoteG!: Phaser.GameObjects.Group;
  /**
   * Player craft whip tip (Wraith cupola, …). Same spring as remote antennas;
   * base tracks the gun overlay so hull + turret motion both whip it.
   */
  heliAntenna?: {
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    vz: number;
    bx: number;
    by: number;
    bz: number;
    bvx: number;
    bvy: number;
    angle: number;
  };

  constructor(readonly s: MissionScene) {}

  /** Per-mission state reset (called from the scene's init). */
  reset(): void {
    this.remoteExhaustFlames = [];
    this.remoteExhaustGlows = [];
    this.heliAntenna = undefined;
  }

  /** Onboard remote gun — hold-fire in POV, or AI auto-fire toward aim. */
  /** Weapons are dead while the hull is submerged. */
  canFire(drone: RemoteCraft): boolean {
    return !(drone.spec.ground && this.s.nav.submerged(drone.x, drone.y));
  }

  fireRemoteGun(
    drone: RemoteCraft,
    dt: number,
    aimAt?: { x: number; y: number },
    targetId = drone.aiTargetId
  ): void {
    if (!this.canFire(drone)) return;
    const gunId = craftGunId(drone.spec);
    if (!gunId) return;
    const spec = PLAYER_WPNS[gunId];
    if (!spec) return;
    // AI (not player-piloted POV): aim jitter narrows the longer it's held on the same target.
    const isAi = aimAt != null;
    if (isAi) {
      const sameTarget = drone.aimHoldTargetId === targetId;
      drone.aimHoldTargetId = targetId;
      drone.aimHoldT = advanceAimHold(drone.aimHoldT ?? 0, dt, sameTarget);
    }
    drone.gunCd = (drone.gunCd ?? 0) - dt;
    if (drone.gunCd > 0) return;
    drone.gunCd = spec.fireCd;

    const aim = aimAt ?? this.s.worldPointer();
    const baseJitter = spec.fire?.jitter ?? 0.08;
    const jitterAmp = isAi
      ? aimPrecisionSpread(drone.aimHoldT ?? 0, AI_AIM_NARROW_BASE, baseJitter * AI_AIM_WIDE_MUL, baseJitter)
      : baseJitter;
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
            const bodyMuzzles = lookupSpritePoints(drone.spec.body, "muzzle");
            if (bodyMuzzles.length > 1) {
              const leaveZ = remoteMuzzleZ(drone);
              return bodyMuzzles.map((uv) => {
                const p = this.remoteBodyMountWorldPos(drone, uv);
                return { x: p.x, y: p.y, z: leaveZ };
              });
            }
            return [this.remoteGunMuzzle(drone)];
          })();
    const fxInterval = spec.fireCd / Math.max(1, tips.length);

    for (const muzzle of tips) {
      const mx = muzzle.x;
      const my = muzzle.y;
      const mz = muzzle.z;
      const aimAng = baseAng + (Math.random() - 0.5) * jitterAmp;
      const spd = spec.speed;
      const clip = this.s.fireControl.playerSightAimWorld(mx, my, mz, aimAng, undefined, aim);
      const dx = clip.x - mx;
      const dy = clip.y - my;
      const dz = clip.z - mz;
      const dist3 = Math.max(8, Math.hypot(dx, dy, dz));
      const hFrac = Math.hypot(dx, dy) / dist3;
      const beh = shotBehaviorOf(spec);
      const aimVel = this.s.fireControl.muzzleAimVelocity({
        dx,
        dy,
        dz,
        z0: mz,
        tz: clip.z,
        spd,
        vx: Math.cos(aimAng) * spd * hFrac,
        vy: Math.sin(aimAng) * spd * hFrac,
      });
      this.s.projectiles.spawnShot({
        from: "player",
        statCraft: remoteCraftKey(drone),
      statCtl: this.s.stats.controlOf(drone),
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
      this.emitRemoteMuzzleFx(drone, spec, mx, my, mz, aimAng, fxInterval);
    }
  }

  /** Remote gun muzzle FX (sparks, flash, light, casing) — shared by AI and POV fire. */
  emitRemoteMuzzleFx(
    drone: RemoteCraft,
    spec: PlayerWpnSpec,
    mx: number,
    my: number,
    mz: number,
    aimAng: number,
    fxInterval: number
  ): void {
    const muzzleMul = playerMuzzleFxMul(spec);
    const gunSc = craftGunScale(drone.spec);
    const fxScale = projectileFxScale("player", fxInterval) * 0.7;
    this.s.fx.emitVisualBurst(mx, my, mz, {
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
    }, this.s.fx.muzzleBurst);
    const flashMul = 0.95 * muzzleMul * range(0.9, 1.12);
    this.s.fx.showMuzzle({
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
    this.s.fx.spawnMuzzleLight(at.x, at.y, mz, 18 * at.scale);
    this.s.fx.emitVisualBurst(mx, my, mz, {
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
    }, this.s.fx.muzzleBurst);
    if (specIsShellGun(spec)) {
      const gunIm = this.remoteGunImage(drone);
      const gunTips = gunIm ? lookupSpriteMuzzles(gunIm.texture.key) : [];
      const side = shellEjectSide({ muzzleUv: gunTips[0] });
      const ejectAt = gunIm
        ? screenToWorldAtZ(gunIm.x, gunIm.y, mz)
        : { x: mx, y: my };
      this.s.fx.spawnShellEject({
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
    if (!this.canFire(drone)) return;

    let wantFire = false;
    if (spec.control.mode === "hold_mouse_down") wantFire = down;
    else if (spec.control.mode === "click" || spec.control.mode === "click_then_click_to_commit") {
      wantFire = pressed;
    } else if (spec.control.mode === "lock_then_click") {
      wantFire = (pressed || down) && !!this.s.player.lockTarget;
    } else if (spec.control.mode === "click_to_set_target") {
      if (pressed) this.s.fireControl.designateLatch = { x: ptr.x, y: ptr.y };
      if (down && this.s.fireControl.designateLatch) this.s.fireControl.designateLatch = { x: ptr.x, y: ptr.y };
      wantFire = released && !!this.s.fireControl.designateLatch;
      if (wantFire) this.s.fireControl.designateLatch = null;
    }

    if (!wantFire || (drone.fireCd ?? 0) > 0) return;

    const hostWpn = remoteHostAmmoWeapon(spec);
    if (hostWpn) {
      // Barrage owns the howitzer — no spot fire or new strike until it finishes.
      if (this.s.fireControl.hostWeaponStrikeActive(hostWpn)) return;
      const hostLeft = this.s.fireControl.hostWeaponAmmoLeft(hostWpn);
      if (hostLeft == null) return;
      if (!this.s.debugMenu.infAmmo && Number.isFinite(hostLeft) && hostLeft <= 0) return;

      // Spot howitzer: real station fire + shared CD (not the flare / call-strike path).
      if (payloadIsHostFire(spec.payload)) {
        if (!this.s.fireControl.hostStationFireReady(hostWpn)) return;
        const ok = this.s.fireControl.fireHostWeaponAt(hostWpn, ptr);
        if (ok) {
          const hostSpec = PLAYER_WPNS[hostWpn];
          drone.fireCd = hostSpec?.fireCd ?? spec.fireCd;
        }
        return;
      }
      // Call-strike: spend remote flare ammo below; howitzer bank must still have shells.
    }

    if (!this.s.debugMenu.infAmmo && Number.isFinite(ammo[slot]!) && ammo[slot]! <= 0) return;

    drone.fireCd = spec.fireCd;
    if (!this.s.debugMenu.infAmmo && Number.isFinite(ammo[slot]!)) ammo[slot]!--;
    this.fireRemoteLoadoutWeapon(drone, slot, spec, ptr);
  }

  /** Spawn one remote-loadout round from the remote (or host, for call-strike / hostFire). */
  fireRemoteLoadoutWeapon(
    drone: RemoteCraft,
    slot: number,
    spec: PlayerWpnSpec,
    ptr: { x: number; y: number }
  ): void {
    if (!this.canFire(drone)) return;
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
      const ok = this.s.fireControl.fireHostWeaponAt(spec.payload.hostFire!.weapon, ptr);
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

    // Hardpoint rails use the same leave as the host craft (loft, catalog life, flash).
    const fireAng =
      socket?.class === "hardpoint" && hull && craftControlScheme(hull) === "plane"
        ? drone.angle
        : aimAng;
    const rocketPod = specIsRocketPod(spec);
    const railMuzzle =
      !rocketPod &&
      socket?.class === "hardpoint" &&
      (launch.mode === "muzzle" || launch.mode === "beam");
    if (rocketPod || railMuzzle) {
      const tips = this.remoteFireTips(drone, slot);
      const beh = shotBehaviorOf(spec);
      const fxInterval = spec.fireCd / Math.max(1, tips.length);
      const guided = spec.guidance;
      const lockOn = targetingMode(guided) === "lock_on";
      const lockId = lockOn ? this.s.player.lockTarget?.id : undefined;
      for (const muzzle of tips) {
        const jitter = spec.fire?.jitter ?? 0;
        const ang = fireAng + (jitter ? (Math.random() - 0.5) * jitter : 0);
        this.s.fireControl.spawnCraftMuzzleShot({
          spec,
          beh,
          st: {
            age: 0,
            launchAngle: ang,
            callStrikeFromHost: spec.payload.callStrike ? true : undefined,
          },
          slot,
          x: muzzle.x,
          y: muzzle.y,
          z0: muzzle.z,
          ang,
          pitchJit: jitter ? (Math.random() - 0.5) * jitter * 0.45 : 0,
          side: 1,
          craftVx: drone.vx,
          craftVy: drone.vy,
          craftVz: drone.vz,
          lockOn,
          lockId,
          aimAt: ptr,
          fxInterval,
          depthOff:
            socket && socketHullPlacement(socket) === "above" ? ZOff.turret + 0.25 : undefined,
        });
      }
      return;
    }

    // Fixed / turret guns — barrel tips, not a pylon rail.
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
      const origin = this.s.fireControl.playerShotOrigin(muzzle, ang, spec);
      const mx = origin.x;
      const my = origin.y;
      const mz = origin.z;
      const clip = this.s.fireControl.playerSightAimWorld(mx, my, mz, ang, undefined, ptr);
      const dx = clip.x - mx;
      const dy = clip.y - my;
      const dz = clip.z - mz;
      const dist3 = Math.max(8, Math.hypot(dx, dy, dz));
      const hFrac = Math.hypot(dx, dy) / dist3;
      const beh = shotBehaviorOf(spec);
      const grav = launchGravity(spec.launch);
      const aimVel = this.s.fireControl.muzzleAimVelocity({
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
      this.s.projectiles.spawnShot({
        from: "player",
        statCraft: remoteCraftKey(drone),
      statCtl: this.s.stats.controlOf(drone),
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
      if (spec.fire?.muzzleFlash ?? true) this.emitRemoteMuzzleFx(drone, spec, mx, my, mz, ang, fxInterval);
    }
  }

  /** Gravity bomb from a remote bay. */
  fireRemoteDropShot(
    drone: RemoteCraft,
    slot: number,
    spec: PlayerWpnSpec,
    ptr: { x: number; y: number }
  ): void {
    if (!this.canFire(drone)) return;
    const launch = spec.launch;
    if (launch.mode !== "drop") return;
    const tip = this.remoteFireTips(drone, slot)[0] ?? {
      x: drone.x,
      y: drone.y,
      z: drone.z,
    };
    const release = remoteBombReleaseVelocity(this.s.world, drone, spec, tip.x, tip.y, ptr, slot);
    const dropZ = tip.z;
    const grav = launchGravity(spec.launch);
    const beh = shotBehaviorOf(spec);
    const fallT = estimateBombFallTime(
      dropZ,
      release.vz,
      groundZ(this.s.world, ptr.x, ptr.y),
      grav?.acceleration ?? 210,
      grav?.terminalVelocity ?? 520
    );
    this.s.projectiles.spawnShot({
      from: "player",
      statCraft: remoteCraftKey(drone),
      statCtl: this.s.stats.controlOf(drone),
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
        ? this.s.player.lockTarget?.id
        : undefined;
    const side = Math.random() < 0.5 ? -1 : 1;
    const tips = this.remoteFireTips(drone, slot);
    for (const muzzle of tips) {
      this.s.projectiles.spawnShot({
        from: "player",
        statCraft: remoteCraftKey(drone),
      statCtl: this.s.stats.controlOf(drone),
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
      this.s.fireControl.missileMuzzle(
        muzzle.x,
        muzzle.y,
        muzzle.z,
        aimAng,
        projectileFxScale("player", spec.fireCd)
      );
    }
  }

  /**
   * Fire origins for a remote socket — simultaneous / alternate body muzzles,
   * hardpoint ammo-phase (same as host `hardpointPylon`), or turret tips.
   * Leave Z matches host `playerMuzzleZ` (hullPlacement); turret XY plane matches `gunTip` (base Z).
   */
  remoteFireTips(
    drone: RemoteCraft,
    slot: number
  ): { x: number; y: number; z: number }[] {
    const leaveZ = remoteMuzzleZ(drone, slot);
    const socket = drone.spec.sockets?.[slot];
    if (socket && (socket.class === "fixed" || socket.class === "hardpoint")) {
      const authored = remoteSocketPoints(drone, socket);
      if (authored.length) {
        let uvs = authored;
        if (socket.class === "hardpoint") {
          // Match host: ammo already spent in handlePovRemoteFire.
          uvs = [authored[hardpointAmmoIndex(drone.ammo?.[slot] ?? 0, authored.length, true)]!];
        } else if (socket.muzzleFire === "simultaneous") {
          uvs = authored;
        } else if (socket.muzzleFire === "alternate") {
          uvs = [authored[this.s.fireControl.playerGunSide++ % authored.length]!];
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
        const pose = remoteBodyDrawPose(bodyIm);
        poseRemoteGun(this.s.textures, drone, pose, bodyIm.texture.key, gunIm);
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
          const tipUv = tips[this.s.fireControl.playerGunSide++ % tips.length]!;
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
    const leaveZ = remoteMuzzleZ(drone, slot);
    const socket = drone.spec.sockets?.[slot];
    if (socket && (socket.class === "fixed" || socket.class === "hardpoint")) {
      const authored = remoteSocketPoints(drone, socket);
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
        const pose = remoteBodyDrawPose(bodyIm);
        poseRemoteGun(this.s.textures, drone, pose, bodyIm.texture.key, gunIm);
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
    const leaveZ = remoteMuzzleZ(drone, slot);
    const gunAng = drone.gunAngle ?? drone.angle;
    const gunIm = this.remoteGunImage(drone);
    const bodyIm = this.remoteBodyImage(drone);
    if (gunIm && bodyIm?.visible) {
      const pose = remoteBodyDrawPose(bodyIm);
      poseRemoteGun(this.s.textures, drone, pose, bodyIm.texture.key, gunIm);
      const tips = lookupSpriteMuzzles(gunIm.texture.key);
      const tipUv = tips[0] ?? { x: 0.5, y: 0.05 };
      // Match host gunTip: unproject at hull base Z.
      const scr = spriteUvPos(gunIm, tipUv.x, tipUv.y);
      const at = screenToWorldAtZ(scr.x, scr.y, drone.z);
      return { x: at.x, y: at.y, z: leaveZ };
    }
    // Body muzzle fallback when there is no gun overlay (Raptor fixed nose guns).
    const bodyMuzzles = lookupSpritePoints(drone.spec.body, "muzzle");
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
    const release = remoteBombReleaseVelocity(this.s.world, drone, spec, tip.x, tip.y, aim, slot);
    this.s.reticleHud.drawTrajectoryArc(tip, release, spec, aim, drone.y);
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
      prey = this.s.unitSim.unitById(s.targetId);
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
      const nearby = this.s.spatial.near(s.x, s.y, spider.engageRange);
      for (let qi = 0; qi < nearby.n; qi++) {
        const u = nearby.at(qi);
        if (!hostileUnit(u)) continue;
        const d = Math.hypot(u.x - s.x, u.y - s.y);
        if (d < bestD) {
          bestD = d;
          best = u;
        }
      }
      nearby.done();
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

    const gnd = groundZ(this.s.world, s.x, s.y);
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

  /** Smoke screen on a piloted remote (HOUND). Own cooldown, cloud stays on the vehicle. */
  tryRemoteCountermeasure(r: RemoteCraft): void {
    const id = craftCountermeasure(r.spec.countermeasure);
    if (id !== "smoke_screen" || (r.cmCd ?? 0) > 0 || (r.smokeT ?? 0) > 0) return;
    const spec = COUNTERMEASURES.smoke_screen;
    r.cmCd = spec.cooldown;
    r.smokeT = spec.duration;
    this.s.stats.countermeasure("smoke_screen", remoteCraftKey(r), this.s.stats.controlOf(r));
    this.s.countermeasures.fireSmokeScreen(3, r);
  }

  /** Dirt puff + smear when a dropped HOUND hits the ground. */
  emitHoundLandingThud(drone: RemoteCraft): void {
    if (isWater(this.s.world, drone.x, drone.y)) {
      // Water landing: splash spray + ripple and the mist shock (the water side of the dust thud).
      this.s.destruction.waterSplash(drone.x, drone.y, groundZ(this.s.world, drone.x, drone.y), Math.min(1.2, drone.spec.radius / 22));
      this.s.hostCraft.emitMistShock(drone.x, drone.y, 0.8);
      return;
    }
    const gnd = groundZ(this.s.world, drone.x, drone.y);
    this.s.fx.heliDust.setDepth(worldDepth(gnd, 0.25, drone.y));
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = range(10, 42);
      const wx = drone.x + Math.cos(a) * r;
      const wy = drone.y + Math.sin(a) * r;
      const p = worldToScreen(wx, wy, groundZ(this.s.world, wx, wy));
      this.s.fx.heliDust.setEmitterAngle(Phaser.Math.RadToDeg(a) + (Math.random() - 0.5) * 36);
      this.s.fx.emitBudgeted("dust", this.s.fx.heliDust, p.x, p.y, 1);
    }
    this.s.groundMarks.stampDirtSmears(drone.x, drone.y, drone.vx * 0.35, drone.vy * 0.35);
    const admitted = this.s.fx.reserveSimParticleSlots("dust", 14);
    const biome = sampleBiome(this.s.world, drone.x, drone.y);
    for (let i = 0; i < admitted; i++) {
      const a = Math.random() * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const spd = range(180, 420);
      const life = range(0.35, 0.7);
      const look = simParticleLook("dirt", biome);
      this.s.fx.simParticles.push({
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

  ensureRemoteExhaustVisual(i: number): {
    flame: Phaser.GameObjects.Image;
    glow: Phaser.GameObjects.Image;
  } {
    while (this.remoteExhaustFlames.length <= i) {
      this.remoteExhaustFlames.push(
        this.s.add
          .image(0, 0, "fx_exhaust")
          .setDepth(Layer.WORLD)
          .setOrigin(0, 0.5)
          .setBlendMode(Phaser.BlendModes.ADD)
          .setVisible(false)
      );
      this.remoteExhaustGlows.push(
        this.s.add
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
    const hull = remoteHull(r.spec);
    const min = hull.minSpeed || 120;
    if (spd < min * 0.55) return;

    const tips = craftWingTipMounts(hull);
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
      this.s.hostCraft.emitWingTipContrails({
        dt,
        tips,
        bank: Math.abs(r.roll ?? 0),
        heading: r.angle,
        x: r.x,
        y: r.y,
        z: r.z,
        pose: remoteBodyDrawPose(body),
        bodyDepth,
        state,
      });
      r.wingTrailEmitCarry = state.emitCarry;
      r.wingTrailMountCursor = state.mountCursor;
    }

    const profile = hull.exhaustProfile;
    const hullMounts = craftExhaustMounts(hull);
    const mounts = hullMounts.length
      ? hullMounts
      : lookupSpritePoints(r.spec.body, "exhaust");
    const power = Phaser.Math.Clamp(spd / Math.max(1, hull.maxSpeed), 0.2, 1);
    if ((profile?.flame ?? 1) === 0) return;
    if (profile && mounts.length) {
      const pose = remoteBodyDrawPose(body);
      const bodyDepth =
        (body.getData("tiltWrap") as Phaser.GameObjects.Container | undefined)?.depth ??
        body.depth;
      const jetAng = projectHeading(r.angle + Math.PI, r.x, r.y, r.z);
      const zs = worldToScreen(r.x, r.y, r.z).scale;
      const glowAng = profile.glowFollowsHull ? pose.rotation : jetAng - Math.PI / 2;
      const flameHue = profile.flameHue ?? craftExhaustFlameHue(hull.kind);
      for (let mi = 0; mi < mounts.length; mi++) {
        const mount = mounts[mi]!;
        const { flame, glow } = this.ensureRemoteExhaustVisual(this.remoteExhaustVisCursor++);
        this.s.hostCraft.paintExhaustNozzle(mi, mount, {
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
        this.s.fx.exhaustTint = profile.tint;
        this.s.fx.exhaustSmokeTint = profile.smoke;
        this.s.fx.exhaustAlpha = 0.18 + power * 0.4;
        this.s.fx.exhaustScaleX = profile.sx * (0.35 + power * 0.45);
        this.s.fx.exhaustScaleY = profile.sy * (0.35 + power * 0.4);
        this.s.fx.exhaustLife = profile.life;
        this.s.fx.exhaustAngle = jetAng;
        this.s.fx.exhaustVx = Math.cos(r.angle + Math.PI) * profile.speed * (0.4 + power * 0.45);
        this.s.fx.exhaustVy = Math.sin(r.angle + Math.PI) * profile.speed * (0.4 + power * 0.45);
        const glowFx = this.s.fx.at(r.z, r.y, this.s.fx.craftExhaust, ZOff.exhaust + 0.04);
        glowFx.setDepth(bodyDepth - 1.2);
        for (const mount of mounts) {
          const at = spriteUvPos(pose, mount.x, mount.y);
          const take = this.s.fx.emitCount(0.35 + power * 0.35);
          if (take) this.s.fx.emitBudgeted("fire", glowFx, at.x, at.y, take);
        }
      }
    } else if (mounts.length && spd > min * 0.7) {
      const pose = remoteBodyDrawPose(body);
      this.s.fx.withTrail(0.7, () => {
        for (const ex of mounts) {
          const at = spriteUvPos(pose, ex.x, ex.y);
          const take = this.s.fx.emitCount(0.45);
          if (take) {
            this.s.fx.emitBudgeted(
              "smoke",
              this.s.fx.at(r.z, r.y, this.s.fx.craftExhaustSmoke, ZOff.smoke - 0.2),
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
    if (isWater(this.s.world, r.x, r.y)) return;
    const printGap = gap * 0.8;
    const first = printGap - (r.track ?? 0);
    for (let dist = first; dist <= step; dist += printGap) {
      const t = step > 0 ? Phaser.Math.Clamp(dist / step, 0, 1) : 1;
      const key = `fx_track_${kind}`;
      const back = r.spec.radius * 0.55;
      const px = Phaser.Math.Linear(x0, r.x, t) - Math.cos(r.angle) * back;
      const py = Phaser.Math.Linear(y0, r.y, t) - Math.sin(r.angle) * back;
      this.s.groundMarks.stampTrack(
        this.s.textures.exists(key) ? key : "fx_track_mono",
        px,
        py,
        r.angle + Math.PI / 2,
        sc,
        trackPrintAlpha(0.65, px, py)
      );
    }
    r.track = ((r.track ?? 0) + step) % printGap;
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
      const pose = remoteBodyDrawPose(bodyIm);
      const scr = spriteUvPos(pose, mount.x, mount.y);
      // Same mid-hull plane as craftBodyMountWorldPos — leave Z is remoteMuzzleZ.
      const z = drone.z + drone.spec.height * 0.55;
      const at = screenToWorldAtZ(scr.x, scr.y, z);
      return { x: at.x, y: at.y };
    }
    // Pre-sync fallback: rotate UV offset around craft origin in world space.
    const key = drone.spec.body;
    const pivot = lookupSpriteOrigin(key) ?? { x: 0.5, y: 0.5 };
    const img = this.s.textures.exists(key)
      ? (this.s.textures.get(key).getSourceImage() as { width: number; height: number })
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

  /** Live body Image for a remote in `remoteG`. */
  remoteBodyImage(drone: RemoteCraft): Phaser.GameObjects.Image | undefined {
    const i = this.s.remotes.indexOf(drone);
    if (i < 0) return undefined;
    const nRotors = remoteRotorPoolSize();
    const stride = 2 + nRotors + 1;
    const kids = this.remoteG.getChildren() as Phaser.GameObjects.Image[];
    return kids[i * stride + 1];
  }

  /** Live gun Image for a remote in `remoteG` (stride: shadow, body, rotors…, gun). */
  remoteGunImage(drone: RemoteCraft): Phaser.GameObjects.Image | undefined {
    const i = this.s.remotes.indexOf(drone);
    if (i < 0) return undefined;
    const nRotors = remoteRotorPoolSize();
    const stride = 2 + nRotors + 1;
    const kids = this.remoteG.getChildren() as Phaser.GameObjects.Image[];
    return kids[i * stride + 2 + nRotors];
  }

  syncRemoteSprites(): void {
    const nRotors = remoteRotorPoolSize();
    const stride = 2 + nRotors + 1; // shadow, body, rotors…, gun
    while (this.remoteG.getLength() < this.s.remotes.length * stride) {
      this.remoteG.add(this.s.add.image(0, 0, "fx_shadow"));
      this.remoteG.add(this.s.add.image(0, 0, "craft_quad_drone"));
      for (let ri = 0; ri < nRotors; ri++) {
        this.remoteG.add(this.s.add.image(0, 0, "craft_quad_drone_rotor").setOrigin(0.5, 0.5));
      }
      this.remoteG.add(this.s.add.image(0, 0, "gun_minigun"));
    }
    const kids = this.remoteG.getChildren() as Phaser.GameObjects.Image[];
    for (const k of kids) {
      this.s.hostCraft.unwrapTilt(k);
      k.setVisible(false);
    }
    this.s.remotes.forEach((r, i) => {
      const sh = kids[i * stride]!;
      const im = kids[i * stride + 1]!;
      const gunIm = kids[i * stride + 2 + nRotors]!;
      if (!cameraPointVisible(r.z, r.y)) return;
      const key = this.s.textures.exists(r.spec.body)
        ? r.spec.body
        : this.s.textures.exists("craft_hover_tank")
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
      this.s.hostCraft.applyCastShadow(sh, r.x, r.y, r.z, key, r.angle + rotOff, sc);
      if (im.texture.key !== key) im.setTexture(key);
      im.setOrigin(orig.x, orig.y);
      // Craft-backed plane remotes: same billboard bank as player craft.
      const hull = r.spec.craftLook ? craftOf(r.spec.craftLook) : undefined;
      const planeBank = !!hull && craftControlScheme(hull) === "plane" && r.roll != null;
      if (planeBank) {
        const wrap = this.s.hostCraft.ensureTiltWrap(im);
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
        const sq = r.spec.ground && !r.airborne ? slopeSquash(this.s.world, r.x, r.y, r.angle) : undefined;
        im.setVisible(true)
          .setPosition(at.x, at.y)
          .setRotation(bodyRot)
          .setScale(bodyScale * (sq?.sx ?? 1), bodyScale * (sq?.sy ?? 1))
          .setDepth(bodyDepth);
      }
      // Underwater hulls take on the water colour by how far below the surface they are (none while above it, e.g. dropping).
      const below = isWater(this.s.world, r.x, r.y) ? groundZ(this.s.world, r.x, r.y) - r.z : 0;
      const waterTint = r.spec.ground && groundHull(r).underwater && below > 0 ? underwaterTint(themeOf(this.s.world.theme), below) : undefined;
      applyThermalHeat(im, this.s.thermal.on, 0.72, waterTint);
      const bodyPose = remoteBodyDrawPose(im);
      const rotorParts = remoteRotorParts(r.spec);
      for (let ri = 0; ri < rotorParts.length; ri++) {
        const rotor = kids[i * stride + 2 + ri];
        const part = rotorParts[ri]!;
        if (!rotor) continue;
        const spinKey = part.spinTex;
        const useSpin = !!spinKey && this.s.textures.exists(spinKey);
        const rotorKey = useSpin ? spinKey! : part.tex;
        if (rotor.texture.key !== rotorKey) rotor.setTexture(rotorKey);
        const hub = spriteUvPos(bodyPose, part.mount.x, part.mount.y);
        const along = r.spec.craftLook ? craftRotorAlongScale(craftOf(r.spec.craftLook)) : 1;
        const rotorSc = craftCompositePartScale(part, rotor.width, bodyScale);
        if (along < 0.999) {
          const wrap = this.s.hostCraft.ensureTiltWrap(rotor);
          wrap
            .setVisible(true)
            .setPosition(hub.x, hub.y)
            .setRotation(bodyRot)
            .setScale(rotorSc, rotorSc * along)
            .setDepth(worldDepth(r.z, ZOff.rotor + ri * 0.001, r.y));
          rotor.setVisible(true).setPosition(0, 0).setRotation((part.spinSign ?? -1) * r.rotor).setScale(1);
        } else {
          this.s.hostCraft.unwrapTilt(rotor);
          rotor
            .setVisible(true)
            .setOrigin(part.origin.x, part.origin.y)
            .setPosition(hub.x, hub.y)
            .setRotation((part.spinSign ?? -1) * r.rotor)
            .setScale(rotorSc)
            .setDepth(worldDepth(r.z, ZOff.rotor + ri * 0.001, r.y));
        }
        applyThermalHeat(rotor, this.s.thermal.on, 0.48);
      }
      if (craftGunId(r.spec) && gunIm) {
        poseRemoteGun(this.s.textures, r, bodyPose, key, gunIm);
        gunIm.setDepth(worldDepth(r.z, ZOff.body + 0.4, r.y));
        applyThermalHeat(gunIm, this.s.thermal.on, 0.55, waterTint);
      }
    });
  }

  /** Submerged ground remotes release bubbles from the hull while moving (more the faster they go). */
  emitUnderwaterBubbles(): void {
    for (const r of this.s.remotes) {
      if (!r.spec.ground || r.airborne || r.dock || r.detonate || !this.s.nav.submerged(r.x, r.y)) continue;
      const spd = Math.hypot(r.vx, r.vy);
      if (Math.random() >= 0.03 + Math.min(0.15, spd / 360)) continue;
      const k = r.spec.radius * 0.6;
      this.s.bubbles.spawn(r.x + range(-k, k), r.y + range(-k, k), r.z + range(2, 8));
    }
  }

  emitRemoteDamageFx(): void {
    for (const r of this.s.remotes) {
      if (r.detonate) continue;
      const ratio = r.health / Math.max(1, r.spec.health);
      const want = ratio < 0.25 ? 3 : ratio < 0.45 ? 2 : ratio < 0.75 ? 1 : 0;
      if (!r.dmgSites) r.dmgSites = [];
      if (!want) {
        if (r.dmgSites.length) r.dmgSites.length = 0;
        continue;
      }
      const body = this.remoteBodyImage(r);
      if (!body?.visible || !cameraPointVisible(r.z, r.y)) continue;
      while (r.dmgSites.length > want) r.dmgSites.pop();
      while (r.dmgSites.length < want) {
        const uv = this.s.unitSprites.sampleSolidUv(body.texture.key, r.spec.radius);
        r.dmgSites.push({ ...uv, scale: range(0.38, 0.75) });
      }
      const { fire, smoke } = this.s.fx.pairHurt(r.z, r.y, this.s.fx.flame, this.s.fx.hurtSmoke);
      const sizeMul = r.spec.ground ? 1 : 1.65;
      for (const site of r.dmgSites) {
        const base = spriteUvPos(body, site.u, site.v);
        const p = jitterDisk(base.x, base.y, 0.5 + site.scale * 0.4);
        if (this.s.fx.hurtBubbles(p.x, p.y, r.z, site.scale * sizeMul)) continue;
        this.s.fx.withDmgFlameScale(site.scale * sizeMul, () => {
          const nFire = this.s.fx.emitCount(0.45);
          const nSmoke = this.s.fx.emitCount(0.26);
          if (nFire) this.s.fx.emitBudgeted("fire", fire, p.x, p.y, nFire);
          if (nSmoke) this.s.fx.emitBudgeted("smoke", smoke, p.x, p.y, nSmoke);
        });
      }
    }
  }

  /** World base for a remote whip antenna — sprite UV when the body is posed. */
  remoteAntennaBase(drone: RemoteCraft): { x: number; y: number; z: number } | undefined {
    if (!drone.spec.antenna) return undefined;
    const z = drone.z + drone.spec.height * 0.42;
    const body = this.remoteBodyImage(drone);
    const look = body?.visible ? body.texture.key : drone.spec.body;
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

  /**
   * Player craft antenna base — UV on the turret/gun overlay that authors `antenna`
   * (Wraith rail cupola). Falls back to hull body UV if needed.
   */
  heliAntennaBase(): { x: number; y: number; z: number; face: number } | undefined {
    const cfg = this.s.player.spec.antenna;
    if (!cfg) return undefined;
    const h = this.s.player;
    const z = h.z + h.spec.height * 0.55;
    const face = h.gunAngle;
    for (const gun of this.s.hostCraft.guns) {
      if (!gun.visible) continue;
      const uv = lookupSpritePoints(gun.texture.key, "antenna")[0];
      if (!uv) continue;
      const scr = spriteUvPos(gun, uv.x, uv.y);
      const at = screenToWorldAtZ(scr.x, scr.y, z);
      return { x: at.x, y: at.y, z, face };
    }
    const body = this.s.hostCraft.body;
    if (body?.visible) {
      const uv = lookupSpritePoints(body.texture.key, "antenna")[0];
      if (uv) {
        const scr = spriteUvPos(body, uv.x, uv.y);
        const at = screenToWorldAtZ(scr.x, scr.y, z);
        return { x: at.x, y: at.y, z, face: h.angle };
      }
    }
    return {
      x: h.x - Math.cos(face) * h.spec.radius * 0.35,
      y: h.y - Math.sin(face) * h.spec.radius * 0.35,
      z,
      face,
    };
  }

  tickRemoteAntenna(drone: RemoteCraft, dt: number): void {
    const cfg = drone.spec.antenna;
    if (!cfg || dt <= 1e-6) return;
    const base = this.remoteAntennaBase(drone);
    if (!base) return;
    drone.antenna = tickWhipAntenna(drone.antenna, base, drone.angle, cfg, dt);
  }

  tickHeliAntenna(dt: number): void {
    const cfg = this.s.player.spec.antenna;
    if (!cfg || dt <= 1e-6) return;
    if (this.s.player.phase === "dead") {
      this.heliAntenna = undefined;
      return;
    }
    const base = this.heliAntennaBase();
    if (!base) return;
    this.heliAntenna = tickWhipAntenna(this.heliAntenna, base, base.face, cfg, dt);
  }

  drawRemoteAntennas(): void {
    const g = this.remoteAntennaGfx;
    if (!g) return;
    g.clear();
    // Seed high so Math.min keeps real worldDepth values (Layer.WORLD alone
    // clamped the stroke under turret sprites at ~focal bias).
    let depth = Number.POSITIVE_INFINITY;
    let drew = false;
    // Sort with the host hull z/y (same as gun overlays), not whip tip altitude,
    // and sit above cupola/coax (turret + coaxBias ≤ ~0.6).
    const antOff = ZOff.turret + 0.85;
    for (const r of this.s.remotes) {
      if (!r.spec.antenna || r.detonate || r.dock) continue;
      if (!cameraPointVisible(r.z, r.y)) continue;
      const base = this.remoteAntennaBase(r);
      const tip = r.antenna;
      if (!base || !tip) continue;
      const rest = whipAntennaRest(base, r.angle, r.spec.antenna);
      drawWhipAntennaStroke(g, base, tip, rest);
      depth = Math.min(depth, worldDepth(r.z, antOff, r.y));
      drew = true;
    }
    const heliCfg = this.s.player.spec.antenna;
    if (heliCfg && this.s.player.phase !== "dead" && this.heliAntenna) {
      const base = this.heliAntennaBase();
      if (base && cameraPointVisible(base.z, base.y)) {
        const rest = whipAntennaRest(base, base.face, heliCfg);
        drawWhipAntennaStroke(g, base, this.heliAntenna, rest);
        const h = this.s.player;
        depth = Math.min(depth, worldDepth(h.z, antOff, h.y));
        drew = true;
      }
    }
    if (drew) g.setDepth(depth);
  }
}
