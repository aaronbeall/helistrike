import { jitterDisk, range } from "../../util/rng";
import { cameraPointVisible, groundZ, worldToScreen, screenToWorldAtZ, projectHeading, isWater, sampleBiome } from "../../worldgen/world";
import Phaser from "phaser";
import { simParticleTexKey, simParticleLook } from "../../render/simParticleLook";
import { applyThermalHeat } from "../../render/thermal";
import { remoteHull, remoteRotorParts, remoteRotorPoolSize, type RemoteCraft } from "../../sim/remote";
import { Layer, ZOff, worldDepth } from "../../render/depth";
import { lookupSpriteOrigin, lookupSpritePoints } from "../../art/spriteOrigin";
import { craftCompositePartScale, craftExhaustFlameHue, craftExhaustMounts, craftGunId, craftGunScale, craftGunTex, craftControlScheme, craftOf, craftRotorAlongScale, craftWingTipMounts } from "../../sim/crafts";
import { spriteUvPos, FX_VARIANTS } from "../../art/sprites";
import type { MissionScene } from "../missionScene";

/** Remote rendering: hull/gun sprite sync, exhaust + plane FX, tread prints, landing thud. */
export class RemoteVisuals {
  /** Plane-remote nozzle flame/glow (Raptor) — pooled across remotes each frame. */
  remoteExhaustFlames: Phaser.GameObjects.Image[] = [];
  remoteExhaustGlows: Phaser.GameObjects.Image[] = [];
  remoteExhaustVisCursor = 0;
  remoteG!: Phaser.GameObjects.Group;

  constructor(readonly s: MissionScene) {}

  /** Per-mission state reset (called from the scene's init). */
  reset(): void {
    this.remoteExhaustFlames = [];
    this.remoteExhaustGlows = [];
  }

  /** Dirt puff + smear when a dropped HOUND hits the ground. */
  emitHoundLandingThud(drone: RemoteCraft): void {
    if (isWater(this.s.world, drone.x, drone.y)) return;
    const gnd = groundZ(this.s.world, drone.x, drone.y);
    this.s.heliDust.setDepth(worldDepth(gnd, 0.25, drone.y));
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = range(10, 42);
      const wx = drone.x + Math.cos(a) * r;
      const wy = drone.y + Math.sin(a) * r;
      const p = worldToScreen(wx, wy, groundZ(this.s.world, wx, wy));
      this.s.heliDust.setEmitterAngle(Phaser.Math.RadToDeg(a) + (Math.random() - 0.5) * 36);
      this.s.emitBudgeted("dust", this.s.heliDust, p.x, p.y, 1);
    }
    this.s.stampDirtSmears(drone.x, drone.y, drone.vx * 0.35, drone.vy * 0.35);
    const admitted = this.s.reserveSimParticleSlots("dust", 14);
    const biome = sampleBiome(this.s.world, drone.x, drone.y);
    for (let i = 0; i < admitted; i++) {
      const a = Math.random() * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const spd = range(180, 420);
      const life = range(0.35, 0.7);
      const look = simParticleLook("dirt", biome);
      this.s.simParticles.push({
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
      this.s.emitWingTipContrails({
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

    const profile = hull.exhaustProfile;
    const hullMounts = craftExhaustMounts(hull);
    const mounts = hullMounts.length
      ? hullMounts
      : lookupSpritePoints(r.spec.body, "exhaust");
    const power = Phaser.Math.Clamp(spd / Math.max(1, hull.maxSpeed), 0.2, 1);
    if ((profile?.flame ?? 1) === 0) return;
    if (profile && mounts.length) {
      const pose = this.remoteBodyDrawPose(body);
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
        this.s.paintExhaustNozzle(mi, mount, {
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
        this.s.exhaustTint = profile.tint;
        this.s.exhaustSmokeTint = profile.smoke;
        this.s.exhaustAlpha = 0.18 + power * 0.4;
        this.s.exhaustScaleX = profile.sx * (0.35 + power * 0.45);
        this.s.exhaustScaleY = profile.sy * (0.35 + power * 0.4);
        this.s.exhaustLife = profile.life;
        this.s.exhaustAngle = jetAng;
        this.s.exhaustVx = Math.cos(r.angle + Math.PI) * profile.speed * (0.4 + power * 0.45);
        this.s.exhaustVy = Math.sin(r.angle + Math.PI) * profile.speed * (0.4 + power * 0.45);
        const glowFx = this.s.fxAt(r.z, r.y, this.s.craftExhaust, ZOff.exhaust + 0.04);
        glowFx.setDepth(bodyDepth - 1.2);
        for (const mount of mounts) {
          const at = spriteUvPos(pose, mount.x, mount.y);
          const take = this.s.fxEmitCount(0.35 + power * 0.35);
          if (take) this.s.emitBudgeted("fire", glowFx, at.x, at.y, take);
        }
      }
    } else if (mounts.length && spd > min * 0.7) {
      const pose = this.remoteBodyDrawPose(body);
      this.s.withTrailFx(0.7, () => {
        for (const ex of mounts) {
          const at = spriteUvPos(pose, ex.x, ex.y);
          const take = this.s.fxEmitCount(0.45);
          if (take) {
            this.s.emitBudgeted(
              "smoke",
              this.s.fxAt(r.z, r.y, this.s.craftExhaustSmoke, ZOff.smoke - 0.2),
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
      this.s.stampWreck(
        this.s.textures.exists(key) ? key : "fx_track_mono",
        px,
        py,
        r.angle + Math.PI / 2,
        sc,
        this.s.trackPrintAlpha(0.65, px, py)
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
    const pose = this.remoteBodyDrawPose(bodyIm);
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
    const gunTex = craftGunTex(drone.spec);
    const gunKey = (gunTex && this.s.textures.exists(gunTex) && gunTex) || "gun_minigun";
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
      .setScale(craftGunScale(drone.spec) * at.scale);
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
      this.s.unwrapTilt(k);
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
      this.s.applyCastShadow(sh, r.x, r.y, r.z, key, r.angle + rotOff, sc);
      if (im.texture.key !== key) im.setTexture(key);
      im.setOrigin(orig.x, orig.y);
      // Craft-backed plane remotes: same billboard bank as player craft.
      const hull = r.spec.craftLook ? craftOf(r.spec.craftLook) : undefined;
      const planeBank = !!hull && craftControlScheme(hull) === "plane" && r.roll != null;
      if (planeBank) {
        const wrap = this.s.ensureTiltWrap(im);
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
      applyThermalHeat(im, this.s.thermalOn, 0.72);
      const bodyPose = this.remoteBodyDrawPose(im);
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
          const wrap = this.s.ensureTiltWrap(rotor);
          wrap
            .setVisible(true)
            .setPosition(hub.x, hub.y)
            .setRotation(bodyRot)
            .setScale(rotorSc, rotorSc * along)
            .setDepth(worldDepth(r.z, ZOff.rotor + ri * 0.001, r.y));
          rotor.setVisible(true).setPosition(0, 0).setRotation((part.spinSign ?? -1) * r.rotor).setScale(1);
        } else {
          this.s.unwrapTilt(rotor);
          rotor
            .setVisible(true)
            .setOrigin(part.origin.x, part.origin.y)
            .setPosition(hub.x, hub.y)
            .setRotation((part.spinSign ?? -1) * r.rotor)
            .setScale(rotorSc)
            .setDepth(worldDepth(r.z, ZOff.rotor + ri * 0.001, r.y));
        }
        applyThermalHeat(rotor, this.s.thermalOn, 0.48);
      }
      if (craftGunId(r.spec) && gunIm) {
        this.poseRemoteGun(r, bodyPose, key, gunIm);
        gunIm.setDepth(worldDepth(r.z, ZOff.body + 0.4, r.y));
        applyThermalHeat(gunIm, this.s.thermalOn, 0.55);
      }
    });
  }

  /** Screen pose for UV mounts on a remote hull (accounts for bank tilt wrap). */
  remoteBodyDrawPose(im: Phaser.GameObjects.Image): ReturnType<MissionScene["imageDrawPose"]> {
    return this.s.imageDrawPose(im);
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
        const uv = this.s.sampleSolidUv(body.texture.key, r.spec.radius);
        r.dmgSites.push({ ...uv, scale: range(0.38, 0.75) });
      }
      const { fire, smoke } = this.s.pairHurtFx(r.z, r.y, this.s.flame, this.s.hurtSmoke);
      const sizeMul = r.spec.ground ? 1 : 1.65;
      for (const site of r.dmgSites) {
        const base = spriteUvPos(body, site.u, site.v);
        const p = jitterDisk(base.x, base.y, 0.5 + site.scale * 0.4);
        this.s.withDmgFlameScale(site.scale * sizeMul, () => {
          const nFire = this.s.fxEmitCount(0.45);
          const nSmoke = this.s.fxEmitCount(0.26);
          if (nFire) this.s.emitBudgeted("fire", fire, p.x, p.y, nFire);
          if (nSmoke) this.s.emitBudgeted("smoke", smoke, p.x, p.y, nSmoke);
        });
      }
    }
  }
}
