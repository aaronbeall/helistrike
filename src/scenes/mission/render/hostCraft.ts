import Phaser from "phaser";
import { imageDrawPose, remoteBodyDrawPose, type DrawPose } from "../../../render/spritePose";
import { simParticleTexKey, simParticleLook } from "../../../render/simParticleLook";
import { applyThermalHeat } from "../../../render/thermal";
import { launchIsArcBeam } from "../../../sim/combat";
import { type RemoteCraft } from "../../../sim/remote";
import { ZOff, worldDepth } from "../../../render/depth";
import { range } from "../../../util/rng";
import { lookupSpriteMuzzles } from "../../../art/spriteOrigin";
import { craftAimsWithTurret, craftCompositePartScale, craftExhaustFlameHue, craftExhaustFlameSheet, craftExhaustMounts, craftGunSocketSlots, craftControlScheme, craftOrigin, craftPreviewExhaustScale, craftRotorAlongScale, craftRotorFlightSpeed, craftRotorTiltMul, craftSocketGunScale, craftWingTipMounts, type CraftComposite } from "../../../sim/crafts";
import { applyEdgeLight, clearEdgeLight } from "../../../render/edgeLight";
import { shadowAlpha, shadowKey, spriteUvPos, FX_VARIANTS, muzzleGlowKey } from "../../../art/sprites";
import { groundZ, worldToScreen, cameraPointVisible, screenToWorldAtZ, projectHeading, castZ, castShadowToGround, isWater, sampleBiome } from "../../../worldgen/world";
import type { MissionScene } from "../../missionScene";

/** Host craft rendering: hull/rotor/gun sprites + tilt wraps, cast shadow, gun tips + heat glow, mount positions, exhaust plumes, contrails, dust-off. */
/** Shadow on a bed under water: softer + slightly spread, full effect by this water depth (z). */
const UNDERWATER_SHADOW_FULL = 24;

export class HostCraft {
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
  /** Sim-time accumulator for the player hover bob, so it scales with timeScale. */
  bobPhase = 0;

  constructor(readonly s: MissionScene) {}

  /** Per-mission state reset (called from the scene's init). */
  reset(): void {
    this.exhaustPrevWorld = [];
    this.exhaustMountCursor = 0;
    this.wingTrailPrevScreen = [];
    this.wingTrailEmitCarry = 0;
    this.wingTrailMountCursor = 0;
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
      underwater: number;
      sourceX: number;
      sourceY: number;
      sourceZ: number;
      frame: number;
      owner?: object;
    };
    const frame = this.s.game.loop.frame;
    let hit = sh.getData("shadowHit") as CachedShadow | undefined;
    const movedFar =
      !hit ||
      hit.owner !== cacheOwner ||
      Math.abs(x - hit.sourceX) > 48 ||
      Math.abs(y - hit.sourceY) > 48 ||
      Math.abs(z - hit.sourceZ) > 24;
    if (movedFar || raycastInterval <= 1 || frame - hit!.frame >= raycastInterval) {
      const fresh = castShadowToGround(this.s.world, x, y, z);
      hit ??= {
        x: 0,
        y: 0,
        z: 0,
        cast: 0,
        underwater: 0,
        sourceX: 0,
        sourceY: 0,
        sourceZ: 0,
        frame: -1,
      };
      hit.x = fresh.x;
      hit.y = fresh.y;
      hit.z = fresh.z;
      hit.cast = fresh.cast;
      hit.underwater = fresh.underwater;
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
    // On a bed under water: the normal shadow, softened (blurriest level) and slightly spread by the water.
    const wet = resolved.underwater > 0.5 ? Math.min(1, resolved.underwater / UNDERWATER_SHADOW_FULL) : 0;
    const want = shadowKey(tex, wet > 0 ? Math.max(cast, 90) : cast);
    const sk = this.s.textures.exists(want) ? want : "fx_shadow";
    if (sh.texture.key !== sk) sh.setTexture(sk);
    sh.setPosition(at.x, at.y)
      .setRotation(
        screenRot != null && Number.isFinite(screenRot)
          ? screenRot
          : projectHeading(rot, resolved.x, resolved.y, resolved.z)
      )
      .setAlpha(shadowAlpha(cast) * (1 - 0.2 * wet))
      .setScale(scale * at.scale * (1 + 0.1 * wet));
    const depth = worldDepth(resolved.z, -12, resolved.y);
    if (sh.depth !== depth) sh.setDepth(depth);
  }

  sync(dt = 1 / 60): void {
    const h = this.s.player;
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
      for (const muzzle of this.s.fx.muzzlePool) muzzle.setVisible(false);
      for (const glow of this.s.fx.muzzleGlowPool) glow.setVisible(false);
      for (const flame of this.exhaustFlames) flame.setVisible(false);
      for (const glow of this.exhaustEngineGlows) glow.setVisible(false);
      for (const glow of this.s.countermeasures.reactiveArmorGlows) glow.setVisible(false);
      this.s.reticleHud.hideAimChrome();
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
    const bodyPose = this.bodyDrawPose();
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
      const arcSpec = this.s.loadout[h.weapon];
      const arcAim =
        launchIsArcBeam(arcSpec?.launch)
          ? this.s.tesla.pickTarget(
              this.s.tesla.muzzleOrigin(h.weapon),
              this.s.worldPointer()
            )
          : undefined;
      const aim = this.s.fireControl.reticleAimWorld(arcAim ?? this.s.fireControl.reticleUnit());
      const gunI = aimSlot != null ? this.gunVisualIndexForSlot(aimSlot) : 0;
      const from = this.guns[gunI]?.visible
        ? this.gunTip(gunI)
        : screenToWorldAtZ(aimMount.x, aimMount.y + bob, h.z);
      let want = Math.atan2(aim.y - from.y, aim.x - from.x);
      // Spotting / call-strike: drive the host howitzer station (may be automatic).
      const spotSlot = this.s.fireControl.hostSpotSlewSlot();
      const hostWalk = this.s.callStrike.marks.find(
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
      this.s.fireControl.slewCraftTurretStations(h, want, this.s.playerDt, spotSlot >= 0 ? spotSlot : h.weapon);
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
      applyThermalHeat(gun, this.s.thermal.on, 0.3);
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
        const useSpin = !!spinKey && h.rotorSpd >= craftRotorFlightSpeed(craft) * 0.5 && this.s.textures.exists(spinKey);
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
        applyThermalHeat(rotor, this.s.thermal.on, 0.48);
      });
    }
    applyEdgeLight(this.body, bodyRot);
    applyThermalHeat(this.body, this.s.thermal.on, 0.78);
    const cloakA = this.s.countermeasures.cloakT > 0 ? 0.14 : 1;
    this.body.setAlpha(cloakA);
    this.shadow.setVisible(this.s.countermeasures.cloakT <= 0 && this.shadow.visible);
    this.shadow.setAlpha(this.s.countermeasures.cloakT > 0 ? 0 : this.shadow.alpha);
    for (const rotor of this.rotors) {
      rotor.setAlpha(cloakA);
      const wrap = rotor.getData("tiltWrap") as Phaser.GameObjects.Container | undefined;
      if (wrap?.scene) wrap.setAlpha(cloakA);
    }
    for (const gun of this.guns) gun.setAlpha(cloakA);
    if (this.s.player.spec.antenna) this.s.remoteBody.tickHeliAntenna(dt);
    const bodyDepth = worldDepth(h.z, ZOff.body, h.y);
    const bodyWrap = this.body.getData("tiltWrap") as Phaser.GameObjects.Container | undefined;
    if (bodyWrap?.scene) {
      if (bodyWrap.depth !== bodyDepth) bodyWrap.setDepth(bodyDepth);
      bodyWrap.setAlpha(cloakA);
    } else {
      this.body.setDepth(bodyDepth);
    }
    this.s.fx.muzzle.setDepth(worldDepth(h.z, ZOff.muzzle, h.y));
    this.s.reticleHud.sync();
    this.emitDustOff(dt);
    // Craft-driven trails pace on the craft's own (Time Warp privileged) step, or each emit
    // spans a huge gap and the stretched segments smear.
    this.emitCraftExhaust(this.s.playerDt);
    this.emitJetWingTrails(this.s.playerDt);
    this.s.countermeasures.syncReactiveArmorGlow();
  }

  /** Parent the player hull in a tilt wrap (jet banking billboard). */
  ensureBodyTiltWrap(): Phaser.GameObjects.Container {
    return this.ensureTiltWrap(this.body);
  }

  /** Parent an image in a tilt wrap (jet bank / forward-facing prop foreshorten). */
  ensureTiltWrap(part: Phaser.GameObjects.Image): Phaser.GameObjects.Container {
    let wrap = part.getData("tiltWrap") as Phaser.GameObjects.Container | undefined;
    if (!wrap || !wrap.scene) {
      wrap = this.s.add.container(0, 0);
      wrap.add(part);
      part.setData("tiltWrap", wrap);
    }
    return wrap;
  }

  /** Player hull draw pose (tilt wrap aware). */
  bodyDrawPose(): DrawPose {
    return imageDrawPose(this.body);
  }

  /**
   * Shared nozzle glow + flame for host craft exhaust and remote plane FX.
   * Keeps Raptor / jet remotes on the same breath / flicker / thermal rules.
   */
  paintExhaustNozzle(
    i: number,
    mount: { x: number; y: number },
    opts: {
      pose: DrawPose;
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
    const breath = 0.94 + Math.sin(this.s.time.now * 0.0068 + i * 1.7) * 0.07;
    const thrust = 0.62 + power * 0.55;
    glow
      .setVisible(true)
      .setPosition(at.x, at.y)
      .setRotation(glowAng)
      .setScale(base.x * thrust * breath, base.y * thrust * breath)
      .setAlpha((0.28 + power * 0.7) * cloakMul)
      .setDepth(bodyDepth + 0.15);
    if (this.s.thermal.on) applyThermalHeat(glow, true, 0.9);
    else glow.clearTint().setTint(glowTint);

    const frameStep = Math.floor(this.s.time.now / 55);
    const flicker = 0.92 + Math.sin(this.s.time.now * 0.043 + i * 2.17) * 0.08;
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
    if (this.s.thermal.on) {
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
    const h = this.s.player;
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
    this.s.fx.exhaustAngle = jetAng;
    const zs = worldToScreen(h.x, h.y, h.z).scale;
    const bodyDepth =
      ((this.body.getData("tiltWrap") as Phaser.GameObjects.Container | undefined)?.depth ??
        this.body.depth);
    const cloakMul = this.s.countermeasures.cloakT > 0 ? 0.12 : 1;

    // Soft engine glow — top-middle pinned to the nozzle; local +Y = exhaust.
    // glowFollowsHull: body axes (rear vent row). Else: thrust direction.
    const pose = this.bodyDrawPose();
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
    this.s.fx.exhaustTint = profile.tint;
    this.s.fx.exhaustSmokeTint = profile.smoke;
    // Thrust drives trail opacity and thickness at emit.
    this.s.fx.exhaustAlpha = 0.22 + power * 0.76;
    this.s.fx.exhaustScaleY = profile.sy * (0.34 + power * 0.52);
    this.s.fx.exhaustLife = profile.life;

    const glow = this.s.fx.at(h.z, h.y, this.s.fx.craftExhaust, ZOff.exhaust + 0.04);
    const mote = this.s.fx.at(h.z, h.y, this.s.fx.craftExhaustMote, ZOff.exhaust + 0.08);
    const smoke = this.s.fx.at(h.z, h.y, this.s.fx.craftExhaustSmoke, ZOff.exhaust - 0.35);
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
      this.s.fx.exhaustScaleX = baseScaleX;
      const frameWidth = Math.max(
        1,
        this.s.textures.get(craftExhaustFlameSheet(h.spec.kind)).get(0).cutWidth
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
          this.s.fx.exhaustScaleX = Math.max(baseScaleX * 0.28, (span / frameWidth) * stretch);
          prevScreenX = previousAt.x;
          prevScreenY = previousAt.y;
        }
      }
      this.exhaustPrevWorld[mountI] = current;

      // Keep the nozzle-side edge of the scaled sprite at/aft of the tip (no body backspill).
      const halfLen = frameWidth * this.s.fx.exhaustScaleX * 0.5;
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
      this.s.fx.exhaustAngle = connectionAngle;
      const motionAngle = connectionAngle + range(-0.045, 0.045);
      const motionSpeed = jetSpeed * range(0.94, 1.06);
      this.s.fx.exhaustVx = Math.cos(motionAngle) * motionSpeed;
      this.s.fx.exhaustVy = Math.sin(motionAngle) * motionSpeed;
      // Dense ribbon for every craft with an exhaust profile (jets + Cyberhawk/Prometheus).
      const nGlow = Math.max(1, this.s.fx.emitCount(ribbonDense ? 2.2 : 1.7));
      if (nGlow) this.s.fx.emitBudgeted("fire", glow, emitX, emitY, nGlow);
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
          this.s.fx.emitBudgeted("fire", glow, fx, fy, 1);
        }
      }
      const nMote = this.s.fx.emitCount(ribbonDense ? 0.28 + power * 0.18 : 0.4 + power * 0.22);
      if (nMote) {
        this.s.fx.emitBudgeted(
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
      const nSmoke = this.s.fx.emitCount(0.9);
      if (nSmoke) this.s.fx.emitBudgeted("smoke", smoke, smokeX, smokeY, nSmoke);
    }
  }

  /** Contrails from jet wingtips — density scales with bank angle. */
  emitJetWingTrails(dt: number): void {
    const h = this.s.player;
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
      pose: this.bodyDrawPose(),
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
    this.s.fx.wingTrailTint = 0xffffff;
    this.s.fx.wingTrailLife = 700 + bankT * 1100;
    this.s.fx.wingTrailScaleY = (0.12 + bankT * 0.22) * (0.85 + Math.random() * 0.2);

    const trail = this.s.fx.at(opts.z, opts.y, this.s.fx.jetWingTrail, ZOff.exhaust - 0.5);
    trail.setDepth(opts.bodyDepth - 1.6);

    const tintKey = this.s.textures.exists("fx_smoke_tint") ? "fx_smoke_tint" : "fx_smoke";
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
      this.s.fx.wingTrailScaleX = baseSx;

      const previous = state.prevScreen[tipI];
      if (previous && Math.hypot(currentX - previous.x, currentY - previous.y) < 280) {
        const dx = previous.x - currentX;
        const dy = previous.y - currentY;
        const span = Math.hypot(dx, dy);
        if (span > 0.5) {
          emitX = (currentX + previous.x) * 0.5;
          emitY = (currentY + previous.y) * 0.5;
          connectionAngle = Math.atan2(dy, dx);
          const frameWidth = Math.max(1, this.s.textures.get(tintKey).get(0).cutWidth);
          this.s.fx.wingTrailScaleX = Math.max(baseSx * 0.35, (span / frameWidth) * 1.45);
        }
      }
      state.prevScreen[tipI] = { x: currentX, y: currentY };

      this.s.fx.wingTrailAngle = connectionAngle;
      this.s.fx.wingTrailVx = Math.cos(connectionAngle) * drift * range(0.9, 1.1);
      this.s.fx.wingTrailVy = Math.sin(connectionAngle) * drift * range(0.9, 1.1);
      const n = Math.max(1, this.s.fx.emitCount(0.9 + bankT * 0.8));
      this.s.fx.emitBudgeted("smoke", trail, emitX, emitY, n);
    }
  }

  emitDustOff(dt: number): void {
    const h = this.s.player;
    if (h.phase === "dead") return;
    const agl = castZ(this.s.world, h.x, h.y, h.z);
    const takeoff = h.phase === "spool" || h.phase === "ready";
    const low = h.phase === "flight" && agl < 26;
    if (!takeoff && !low) return;
    const power = takeoff
      ? h.dustPower
      : Phaser.Math.Clamp(1 - agl / 26, 0, 1) * 0.72;
    if (power < 0.04) return;
    const rate = Phaser.Math.Clamp(dt, 0, 0.05) * 60;
    const gnd = groundZ(this.s.world, h.x, h.y);
    const wet = isWater(this.s.world, h.x, h.y);
    this.s.fx.heliDust.setDepth(worldDepth(gnd, 0.2, h.y));
    const puffs = Math.max(0, Math.round((takeoff ? 0.4 + power * 4.5 : 0.6 + power * 1.4) * rate));
    for (let i = 0; i < puffs; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = range(16, 56 + power * 36);
      const wx = h.x + Math.cos(a) * r;
      const wy = h.y + Math.sin(a) * r;
      const at = worldToScreen(wx, wy, groundZ(this.s.world, wx, wy));
      this.s.fx.heliDust.setEmitterAngle(Phaser.Math.RadToDeg(a) + (Math.random() - 0.5) * 28);
      this.s.fx.emitBudgeted("dust", this.s.fx.heliDust, at.x, at.y, 1);
    }
    if (wet) return;
    const n = Math.max(0, Math.round((takeoff ? 0.5 + power * 9 : 1 + power * 3) * rate));
    if (n < 1) return;
    const admitted = this.s.fx.reserveSimParticleSlots("dust", n);
    const biome = sampleBiome(this.s.world, h.x, h.y);
    const spinSign = h.rotorSpd >= 0 ? 1 : -1;
    for (let i = 0; i < admitted; i++) {
      const a = Math.random() * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const r0 = range(8, 26);
      const spd = range(420, 800) * (0.35 + power * 0.9);
      const life = range(0.48, 0.86);
      const look = simParticleLook("dirt", biome);
      this.s.fx.simParticles.push({
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
    const gnd = groundZ(this.s.world, x, y);
    const wet = isWater(this.s.world, x, y);
    if (wet) return;
    const n = Math.round(64 * power);
    const admitted = this.s.fx.reserveSimParticleSlots("dust", n);
    const biome = sampleBiome(this.s.world, x, y);
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
      this.s.fx.simParticles.push({
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
    const at = screenToWorldAtZ(sx, sy, this.s.player.z);
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
    if (tipHeat < 0.02 || !gun.visible || !this.s.textures.exists(glowTex)) {
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
    if (this.s.thermal.on) {
      glow.setBlendMode(Phaser.BlendModes.NORMAL);
      applyThermalHeat(glow, true, Phaser.Math.Linear(0.55, 1, tipHeat));
    } else {
      glow.clearTint();
      glow.setBlendMode(Phaser.BlendModes.ADD);
    }
  }

  /** World position of an authored mount UV on the active craft body (live draw pose). */
  craftBodyMountWorldPos(mount: { x: number; y: number }): { x: number; y: number } {
    const h = this.s.player;
    if (this.body?.visible) {
      const pose = this.bodyDrawPose();
      const scr = spriteUvPos(pose, mount.x, mount.y);
      // Mid-hull projection plane for XY only — shot leave Z is playerMuzzleZ.
      const z = h.z + h.spec.height * 0.55;
      const at = screenToWorldAtZ(scr.x, scr.y, z);
      return { x: at.x, y: at.y };
    }
    // Pre-sync fallback: rotate UV offset around craft origin in world space.
    const craft = h.spec;
    const pivot = craftOrigin(craft);
    const img = this.s.textures.exists(craft.body)
      ? (this.s.textures.get(craft.body).getSourceImage() as { width: number; height: number })
      : { width: 120, height: 120 };
    const hullRot = h.angle + craft.rotOff;
    const mx = (mount.x - pivot.x) * img.width;
    const my = (mount.y - pivot.y) * img.height;
    return {
      x: h.x + mx * Math.cos(hullRot) - my * Math.sin(hullRot),
      y: h.y + mx * Math.sin(hullRot) + my * Math.cos(hullRot),
    };
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

    const pose = remoteBodyDrawPose(body);
    const wrap = body.getData("tiltWrap") as Phaser.GameObjects.Container | undefined;
    const bodyDepth = wrap?.depth ?? body.depth;
    const jetAng = projectHeading(r.angle + Math.PI, r.x, r.y, r.z);
    const backX = -Math.cos(r.angle) * spd * 0.1;
    const backY = -Math.sin(r.angle) * spd * 0.1;

    this.s.fx.withTrail(0.9, () => {
      const rgb = profile.smoke;
      const pale = ((rgb >> 16) & 0xff) + ((rgb >> 8) & 0xff) + (rgb & 0xff) > 0x2a0;
      if (pale) {
        this.s.fx.wingTrailTint = profile.smoke;
        this.s.fx.wingTrailLife = profile.life * (0.7 + power * 0.45);
        this.s.fx.wingTrailScaleX = profile.sx * (0.85 + power * 0.35);
        this.s.fx.wingTrailScaleY = profile.sy * (0.85 + power * 0.3);
        this.s.fx.wingTrailAngle = jetAng;
        this.s.fx.wingTrailVx = backX + range(-4, 4);
        this.s.fx.wingTrailVy = backY + range(-4, 4);
        const trail = this.s.fx.at(r.z, r.y, this.s.fx.jetWingTrail, ZOff.exhaust - 0.35);
        trail.setDepth(bodyDepth - 1.15);
        for (const mount of mounts) {
          const at = spriteUvPos(pose, mount.x, mount.y);
          this.s.fx.emitBudgeted("smoke", trail, at.x, at.y, n);
        }
      } else {
        this.s.fx.exhaustSmokeTint = profile.smoke;
        this.s.fx.exhaustScaleY = profile.sy * (0.75 + power * 0.45);
        this.s.fx.exhaustAlpha = 0.22 + power * 0.38;
        this.s.fx.exhaustVx = backX * 1.2 + range(-6, 6);
        this.s.fx.exhaustVy = backY * 1.2 + range(-6, 6);
        this.s.fx.exhaustAngle = jetAng;
        const smoke = this.s.fx.at(r.z, r.y, this.s.fx.craftExhaustSmoke, ZOff.smoke - 0.2);
        smoke.setDepth(bodyDepth - 1.1);
        for (const mount of mounts) {
          const at = spriteUvPos(pose, mount.x, mount.y);
          this.s.fx.emitBudgeted("smoke", smoke, at.x, at.y, n);
        }
      }
    });
  }

  /** Gun overlay index for a loadout socket barrel, or 0 if the socket has no overlay. */
  gunVisualIndexForSlot(slot: number, barrel = 0): number {
    const slots = craftGunSocketSlots(this.s.player.spec);
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
    const slots = craftGunSocketSlots(this.s.player.spec);
    const slot = slots[visualIndex];
    if (slot == null) return 0;
    let barrel = 0;
    for (let i = 0; i < visualIndex; i++) {
      if (slots[i] === slot) barrel++;
    }
    return barrel;
  }

  unwrapTilt(part: Phaser.GameObjects.Image): void {
    const wrap = part.getData("tiltWrap") as Phaser.GameObjects.Container | undefined;
    if (!wrap) return;
    part.setData("tiltWrap", undefined);
    if (wrap.scene) {
      wrap.remove(part);
      this.s.add.existing(part);
      wrap.destroy();
    }
  }
}
