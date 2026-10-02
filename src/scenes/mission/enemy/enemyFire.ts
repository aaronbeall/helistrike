import Phaser from "phaser";
import { gunWorldRot } from "../../../art/spriteOrigin";
import { enemyShotBeh } from "../../../sim/weaponRuntime";
import { AI_LOCK_BASE, AI_AIM_NARROW_BASE, AI_AIM_WIDE_MUL } from "../../../sim/weaponRuntime";
import { resolveSkin } from "../../../render/camo";
import { heightOf, textureOf, type Unit } from "../../../sim/combat";
import { advanceAimHold, aimNarrowTime, aimPrecisionSpread, clampAimToStationArc, holdProgress, lockAcquireTime } from "../../../sim/weaponRuntime";
import { ZOff } from "../../../render/depth";
import { range } from "../../../util/rng";
import { Craft } from "../../../sim/craft";
import { specOf, gunsOf, muzzlesOfGun, type WeaponSpec } from "../../../sim/roster";
import { lookupSpriteMuzzles, lookupSpriteOrigin } from "../../../art/spriteOrigin";
import { FX_VARIANTS, spritePivot } from "../../../art/sprites";
import { worldToScreen } from "../../../worldgen/world";
import type { MissionScene } from "../../missionScene";

/** Enemy weapons: per-turret aim/lock/fire, rounds + seekers, muzzle points and volley notes. */
export class EnemyFire {

  constructor(readonly s: MissionScene) {}

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
    return this.s.fx.shellEjectSide({ muzzleUv, mountUv });
  }

  /**
   * Independent enemy turrets, one pass per gun part: pick its own target (AA ignores a dirt
   * HOUND), slew within its traverse arc, check its own range / elevation / facing, and run its
   * own lock, aim hold, cooldown, burst and muzzle-tip cycle — same as player turret stations.
   * Writes unit-level summaries after; returns the first target a turret engaged this frame.
   */
  tickEnemyTurretFire(
    u: Unit,
    focus: Craft,
    dt: number,
    vision: number,
    aimMul: number,
    holdFire: boolean,
    elevCeilFor: (aa: boolean) => number
  ): Craft | undefined {
    const sp = specOf(u.kind);
    const guns = gunsOf(u);
    const states = u.gunStates ?? (u.gunStates = []);
    let burstMax = 0;
    let lockMax = 0;
    let holdMax = 0;
    let flashUsed = false;
    let engagedTgt: Craft | undefined;
    const trackRate = 1.65 * aimMul * Math.max(0.12, vision);
    u.debugLockT = undefined;
    u.debugAimT = undefined;
    u.debugAimSpreadRad = undefined;
    for (let gi = 0; gi < guns.length; gi++) {
      const wpn = guns[gi]!.weapon ?? sp.weapon;
      if (!wpn) continue;
      // Random first cooldown so turrets (and units) don't open fire in lockstep.
      const st =
        states[gi] ??
        (states[gi] = { cd: Math.random() * wpn.fireCd, burst: 0, lockT: 0, holdT: 0, tip: 0 });
      st.cd -= dt;
      const aa = this.s.targeting.enemyWeaponIsAa(wpn);
      const tgt = this.s.targeting.enemyTargetFor(aa, focus);
      const gp = this.s.gunMountPos(u, gi);
      const dist = Math.hypot(tgt.x - gp.x, tgt.y - gp.y);
      const trav = guns[gi]!.traverse;
      // Keep a limited turret inside its arc as the hull turns under it.
      if (trav) u.turrets[gi] = clampAimToStationArc(u.turrets[gi] ?? u.angle, u.angle, trav);
      const want = Math.atan2(tgt.y - gp.y, tgt.x - gp.x);
      // Slew slightly past fire range so the barrel is on target as it enters.
      if (vision > 0 && dist < wpn.range * vision * 1.15) {
        // Out-of-arc targets park the barrel at the arc edge; the facing check then blocks fire.
        const slewTo = trav ? clampAimToStationArc(want, u.angle, trav) : want;
        u.turrets[gi] = this.s.steerUnitAngle(u.turrets[gi] ?? 0, slewTo, trackRate, dt);
        if (trav) u.turrets[gi] = clampAimToStationArc(u.turrets[gi]!, u.angle, trav);
      }
      const inRange =
        dist < wpn.range * vision && dist > 40 && tgt.phase === "flight" && tgt.z - u.z < elevCeilFor(aa);
      const barrelAng = u.turrets[gi] ?? u.turret;
      const facingOk = Math.abs(Phaser.Math.Angle.Wrap(want - barrelAng)) < 0.16;
      const engaging = !holdFire && vision > 0 && inRange;
      if (engaging && !engagedTgt) engagedTgt = tgt;
      st.holdT = advanceAimHold(st.holdT, dt, engaging);
      const seeker = wpn.kind === "lock-on-missile";
      const lockReq = lockAcquireTime(AI_LOCK_BASE, tgt.spec.enemySeekerMul ?? 1);
      if (seeker) {
        const tracking = engaging && facingOk;
        st.lockT = tracking ? st.lockT + dt : 0;
        if (tracking) {
          const p = holdProgress(st.lockT, lockReq);
          u.debugLockT = Math.max(u.debugLockT ?? 0, p);
          if (p >= (u.paintT ?? -1) && this.s.targeting.hudThreatTarget(tgt)) {
            u.paintT = p;
            u.paintHost = tgt === this.s.player;
          }
        }
      } else if (engaging && gi === 0) {
        const narrowT = aimNarrowTime(AI_AIM_NARROW_BASE, this.s.targeting.targetAwareMul(tgt));
        u.debugAimT = holdProgress(st.holdT, narrowT);
        u.debugAimSpreadRad = aimPrecisionSpread(st.holdT, narrowT, (wpn.jitter ?? 0) * AI_AIM_WIDE_MUL, wpn.jitter ?? 0);
      }
      const lockReady = !seeker || st.lockT >= lockReq;
      if (st.cd <= 0 && engaging && facingOk && lockReady) {
        const burstN = wpn.burst ?? 0;
        const fxInterval = burstN > 0 ? (wpn.burstGap ?? 0.075) : wpn.fireCd;
        if (burstN) {
          if (!st.burst) st.burst = burstN;
          st.burst--;
          st.cd = st.burst > 0 ? (wpn.burstGap ?? 0.075) : wpn.fireCd;
        } else {
          st.cd = wpn.fireCd;
        }
        if (seeker) st.lockT = 0; // fire-and-forget — re-acquire lock for the next shot.
        // Multi-tip turrets (dual barrels) still honor muzzleFire on their own tips.
        const tipCount = guns[gi]!.muzzles?.length || 1;
        const simultaneous = wpn.muzzleFire === "simultaneous" && tipCount > 1;
        const tipI = wpn.muzzleFire === "alternate" ? st.tip % tipCount : 0;
        const fireTips = simultaneous ? Array.from({ length: tipCount }, (_, i) => i) : [tipI];
        st.tip = tipCount > 1 && wpn.muzzleFire === "alternate" ? (tipI + 1) % tipCount : tipI;
        for (const tip of fireTips) {
          const extra = flashUsed || (simultaneous && tip !== tipI);
          this.fireEnemyRound(u, wpn, gi, tip, barrelAng, tgt, st.holdT, fxInterval, extra);
        }
        flashUsed = true;
        this.noteEnemyVolley(u, st.burst <= 0);
      } else if (!engaging) {
        st.burst = 0;
      }
      burstMax = Math.max(burstMax, st.burst);
      lockMax = Math.max(lockMax, st.lockT);
      holdMax = Math.max(holdMax, st.holdT);
    }
    // Unit-level summaries for AI state, HUD paint text and debug.
    u.turret = u.turrets[0] ?? u.turret;
    u.burstLeft = burstMax;
    u.lockT = lockMax;
    u.aimHoldT = holdMax;
    return engagedTgt;
  }

  /**
   * Spawn one enemy round from gun `gunI` (hull when the unit has no gun parts) at muzzle `tip`.
   * `extraFlash`: another round already owns the unit's pooled flash this frame — use a one-shot.
   */
  fireEnemyRound(
    u: Unit,
    wpn: WeaponSpec,
    gunI: number,
    tip: number,
    barrelAng: number,
    aimTgt: Craft,
    holdT: number,
    fxInterval: number,
    extraFlash: boolean
  ): void {
    const sp = specOf(u.kind);
    const guns = gunsOf(u);
    const home = wpn.kind === "lock-on-missile";
    const muzzleZ = u.z + heightOf(u.kind) * 0.7 + ZOff.shot;
    const tgtZ = aimTgt.z + aimTgt.height * 0.5;
    const leaveSpd = home ? Math.max(70, wpn.speed * 0.3) : wpn.speed;
    const jitter = home
      ? (Math.random() - 0.5) * (wpn.jitter ?? 0)
      : (Math.random() - 0.5) *
        aimPrecisionSpread(
          holdT,
          aimNarrowTime(AI_AIM_NARROW_BASE, this.s.targeting.targetAwareMul(aimTgt)),
          (wpn.jitter ?? 0) * AI_AIM_WIDE_MUL,
          wpn.jitter ?? 0
        );
    const muzzle = this.enemyMuzzle(u, gunI, tip);
    if (extraFlash) {
      this.s.fx.spawnExtraMuzzleFlash(muzzle.x, muzzle.y, u.z, barrelAng, sp.organic ? 0.7 : 1.15);
    } else {
      u.muzzleGun = gunI;
      u.muzzleFireTip = tip;
      u.muzzleT = 0.07;
      u.muzzleJitS = range(0.9, 1.12);
      u.muzzleJitR = range(-0.1, 0.1);
      u.muzzleFrame = (Math.random() * FX_VARIANTS) | 0;
    }
    const fireAng = barrelAng + jitter;
    // Flight time from post-nudge tip (spawnShot advances by SHOT_ORIGIN).
    const spawn = this.s.projectiles.shotSpawnXY(muzzle.x, muzzle.y, fireAng, muzzleZ, wpn.look, wpn.scale);
    const shotDist = Math.max(40, Math.hypot(aimTgt.x - spawn.x, aimTgt.y - spawn.y));
    const muzzleAt = worldToScreen(muzzle.x, muzzle.y, u.z);
    this.s.fx.spawnMuzzleLight(
      muzzleAt.x,
      muzzleAt.y,
      u.z,
      (sp.organic ? 18 : 28) * muzzleAt.scale * (u.muzzleJitS ?? 1)
    );
    const flightT = Math.max(0.12, shotDist / (home ? wpn.speed * 0.72 : wpn.speed));
    this.s.projectiles.spawnShot({
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
      homeRemoteId: home ? this.s.targeting.remoteOfCraft(aimTgt)?.id : undefined,
      motor: home ? -0.06 : undefined,
      cruise: home ? wpn.speed : undefined,
      scale: wpn.scale,
      beh: enemyShotBeh(wpn),
      fxInterval,
    });
    if (wpn.kind === "cannon") {
      const ejectAt = guns.length ? this.s.gunMountPos(u, gunI) : { x: u.x, y: u.y };
      const shellZ = sp.aerial ? u.z - 10 : u.z + heightOf(u.kind) + 6;
      // Casing side reads the firing tip; keep the pooled flash's tip intact.
      const flashTip = u.muzzleFireTip;
      u.muzzleFireTip = tip;
      const side = this.enemyShellEjectSide(u, gunI);
      u.muzzleFireTip = flashTip;
      this.s.fx.spawnShellEject({
        x: ejectAt.x,
        y: ejectAt.y,
        z: shellZ,
        barrelAng: fireAng,
        scale: wpn.scale,
        dmg: wpn.dmg,
        side,
        aerial: !!sp.aerial,
        fireCd: (wpn.burst ?? 0) > 0 ? (wpn.burstGap ?? 0.075) : wpn.fireCd,
      });
    }
  }

  /** Combat mood: kite while firing; each finished volley is a strike, enough and it flees. */
  noteEnemyVolley(u: Unit, volleyDone: boolean): void {
    const mood = specOf(u.kind).combatMood;
    if (!mood) return;
    if (u.aiMood !== "flee") u.aiMood = "kite";
    if (!volleyDone) return;
    u.strike = (u.strike ?? 0) + 1;
    if (u.strike >= mood.strikesBeforeFlee) {
      u.aiMood = "flee";
      const [lo, hi] = mood.fleeDuration;
      u.moodT = lo + Math.random() * (hi - lo);
      u.strike = 0;
    }
  }

  enemyMuzzle(u: Unit, gunI = 0, tipOverride?: number): { x: number; y: number } {
    const sp = specOf(u.kind);
    const guns = gunsOf(u);
    const wpn = guns[gunI]?.weapon ?? sp.weapon;
    const gun = guns[gunI];
    const hullRot = this.s.troopDrawAng(u) + sp.rotOff;
    const hullPivot = spritePivot(textureOf(u.kind));
    const hullImg = this.s.textures.get(resolveSkin(this.s.textures, textureOf(u.kind), u.camo)).getSourceImage() as {
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
          tipOverride ?? (u.muzzleT > 0 && u.muzzleFireTip != null ? u.muzzleFireTip : u.muzzleTip);
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
    const gtex = this.s.textures.exists(gun.tex)
      ? (this.s.textures.get(gun.tex).getSourceImage() as { width: number; height: number })
      : { width: 24, height: 48 };
    const tips = muzzlesOfGun(gun);
    const tipIdx =
      tipOverride ?? (u.muzzleT > 0 && u.muzzleFireTip != null ? u.muzzleFireTip : u.muzzleTip);
    const muz = tips[tipIdx % tips.length]!;
    const ga = gunWorldRot(gun.tex, u.turrets[gunI] ?? u.turret);
    const gsc = gun.scale ?? 1;
    return atUv(origin, muz, gtex.width * gsc, gtex.height * gsc, hx, hy, ga);
  }
}
