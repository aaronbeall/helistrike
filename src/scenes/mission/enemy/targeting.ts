import Phaser from "phaser";
import { radius, type Shot, type Unit } from "../../sim/combat";
import { remoteHasPovHud, type RemoteCraft } from "../../sim/remote";
import { smokeCoverAt, smokeVisionMul } from "../../sim/weaponRuntime";
import { Craft, LOW_AGL } from "../../sim/craft";
import { specOf, gunsOf, weaponIsAa } from "../../sim/roster";
import type { MissionScene } from "../missionScene";

/** Bullet time (E): world rate while on, real seconds a full meter lasts, seconds empty → full. */
/** Enemy re-target cadence (ms). */
const ENEMY_RETARGET_MS = 500;

/** Spotting reach for autonomous remotes (× their enemyAwareMul, autonomous debuff, smoke). */
const AUTO_TARGET_RANGE = 600;

/** Enemy awareness debuff vs autonomous (unpiloted) remotes. */
const AUTONOMOUS_AWARE_MUL = 0.6;

/** Distance-score penalty — enemies strongly prefer the player-controlled craft. */
const AUTO_TARGET_SCORE_MUL = 3;

/** Host's score penalty while the player flies a remote. */
const HOST_WHILE_PILOTING_SCORE_MUL = 1.6;

/** Who enemies engage: combat focus (host / piloted POV), autonomous-remote picks, awareness + smoke vision, damage routing. */
export class EnemyTargeting {

  constructor(readonly s: MissionScene) {}

  smokeVisionAt(x: number, y: number, pad = 0): number {
    return smokeVisionMul(smokeCoverAt(this.s.smokePuffs, x, y, pad));
  }

  /**
   * Enemy vision mul from smoke: cover is sampled at the aim craft (smoke screen),
   * with the unit's radius as pad — same proportions as if that unit stood on the target.
   */
  enemySmokeVision(u: Unit, at: { x: number; y: number } = this.combatFocus()): number {
    return this.smokeVisionAt(at.x, at.y, radius(u.kind));
  }

  /**
   * Piloted POV remote enemies should chase (HOUND / Raptor).
   * Spectre cam and parked-slot remotes stay off the threat board.
   */
  combatFocusRemote(): RemoteCraft | undefined {
    if (!this.s.remoteCore.remotePilotActive) return undefined;
    const pilot = this.s.remoteCore.pilotingRemote();
    if (
      !pilot ||
      !remoteHasPovHud(pilot.spec) ||
      pilot.detonate ||
      pilot.dock ||
      pilot.airborne
    ) {
      return undefined;
    }
    return pilot;
  }

  /** True when combat focus is dirt-locked (HOUND) — AA / seekers ignore it. */
  combatFocusIsGround(): boolean {
    return !!this.combatFocusRemote()?.spec.ground;
  }

  /** Remote behind a shadow Craft (undefined for the host). */
  remoteOfCraft(c: Craft): RemoteCraft | undefined {
    if (c === this.s.player) return undefined;
    for (const r of this.s.remotes) if (this.s.remoteCore.remotePilotCraft.get(r.id) === c) return r;
    return undefined;
  }

  /** Remote can be engaged by enemies (out in the world, alive, has a hull). */
  remoteTargetable(r: RemoteCraft): boolean {
    return !r.detonate && !r.dock && !r.dockPending && !r.airborne && r.health > 0 && !!r.spec.craftLook;
  }

  /** Shadow Craft for an enemy-targeted remote, pose/health synced. */
  remoteTargetCraft(r: RemoteCraft): Craft | undefined {
    const craft = this.s.remoteCore.ensureRemotePilotCraft(r);
    if (!craft || craft.phase === "dead") return undefined;
    craft.x = r.x;
    craft.y = r.y;
    craft.z = r.z;
    craft.vx = r.vx;
    craft.vy = r.vy;
    craft.vz = r.vz ?? 0;
    craft.health = r.health;
    return craft;
  }

  /** Threat HUD covers the host and the piloted POV remote, not autonomous remotes. */
  hudThreatTarget(c: Craft): boolean {
    return c === this.s.player || c === this.combatFocus();
  }

  /** Spotting multiplier for a target craft — remote roster value, autonomous debuff. */
  targetAwareMul(c: Craft): number {
    const rem = this.remoteOfCraft(c);
    if (!rem) return c.spec.enemyAwareMul ?? 1;
    const mul = rem.spec.enemyAwareMul ?? 1;
    return rem === this.combatFocusRemote() ? mul : mul * AUTONOMOUS_AWARE_MUL;
  }

  /** Score-pick the craft a unit engages; lower score wins, player-controlled heavily favored. */
  pickEnemyTarget(u: Unit, aaUnit: boolean): RemoteCraft | undefined {
    const focusRem = this.combatFocusRemote();
    let best: RemoteCraft | undefined;
    let bestScore = Infinity;
    const hostOk = this.s.cloakT <= 0;
    if (hostOk) {
      const d = Math.hypot(this.s.player.x - u.x, this.s.player.y - u.y);
      bestScore = focusRem ? d * HOST_WHILE_PILOTING_SCORE_MUL : d;
    }
    for (const r of this.s.remotes) {
      if (!this.remoteTargetable(r)) continue;
      if (aaUnit && r.spec.ground) continue;
      const d = Math.hypot(r.x - u.x, r.y - u.y);
      let score: number;
      if (r === focusRem) score = d;
      else {
        const reach =
          AUTO_TARGET_RANGE * (r.spec.enemyAwareMul ?? 1) * AUTONOMOUS_AWARE_MUL * this.smokeVisionAt(r.x, r.y, radius(u.kind));
        if (d > reach) continue;
        score = d * AUTO_TARGET_SCORE_MUL;
      }
      if (score < bestScore) {
        bestScore = score;
        best = r;
      }
    }
    if (!best && !hostOk && focusRem && !(aaUnit && focusRem.spec.ground)) return focusRem;
    return best;
  }

  /** AA burst / seeker / AAM — blind to ground HOUND. */
  enemyWeaponIsAa(wpn: { kind?: string; look?: string } | undefined): boolean {
    return weaponIsAa(wpn);
  }

  /**
   * Craft an enemy weapon engages: AA / seekers are blind to a dirt-locked combat focus
   * (HOUND) and take the host bird; everything else takes the combat focus.
   */
  enemyTargetFor(aa: boolean, focus: Craft = this.combatFocus()): Craft {
    return aa && focus !== this.s.player && this.remoteOfCraft(focus)?.spec.ground ? this.s.player : focus;
  }

  /** Craft an enemy seeker homes on — its launch remote while live (never dirt-locked), else the host. */
  enemySeekerTarget(s: Shot): Craft {
    if (s.homeRemoteId == null) return this.s.player;
    const r = this.s.remotes.find((r) => r.id === s.homeRemoteId);
    const c = r && !r.spec.ground && this.remoteTargetable(r) ? this.remoteTargetCraft(r) : undefined;
    if (c) return c;
    s.homeRemoteId = undefined;
    return this.s.player;
  }

  /** Dedicated AA platform (primary mount is AA / seeker). */
  unitIsAaEnemy(u: Unit): boolean {
    const sp = specOf(u.kind);
    const guns = gunsOf(u);
    return this.enemyWeaponIsAa(guns[0]?.weapon ?? sp.weapon);
  }

  /**
   * Per-enemy chase/aim craft. AA is blind to dirt HOUND — they see the host bird only.
   */
  unitCombatFocus(u: Unit): Craft {
    const now = this.s.time.now;
    if (u.tgtNextT == null || now >= u.tgtNextT) {
      // Staggered re-pick — acquisition lags a little so many-to-many stays cheap.
      u.tgtNextT = now + ENEMY_RETARGET_MS + (u.id % 7) * 40;
      u.tgtRemoteId = this.pickEnemyTarget(u, this.unitIsAaEnemy(u))?.id;
    }
    if (u.tgtRemoteId == null) return this.s.player;
    const rem = this.s.remotes.find((r) => r.id === u.tgtRemoteId);
    const craft = rem && this.remoteTargetable(rem) ? this.remoteTargetCraft(rem) : undefined;
    if (craft) return craft;
    u.tgtRemoteId = undefined;
    u.tgtNextT = undefined;
    return this.s.player;
  }

  /**
   * Craft enemies aim/chase/hit — piloted POV remote shadow, else host.
   * Syncs remote pose onto the shadow so unit AI sees current XYZ.
   */
  combatFocus(): Craft {
    const rem = this.combatFocusRemote();
    if (!rem) return this.s.player;
    return this.remoteTargetCraft(rem) ?? this.s.player;
  }

  /** Apply hit damage to the current combat focus (remote detonates at 0 HP). */
  damageCombatFocus(n: number, dx?: number, dy?: number): void {
    const rem = this.combatFocusRemote();
    if (!rem) this.s.player.damage(n, dx, dy);
    else this.damageRemote(rem, n, dx, dy);
  }

  /** Damage the host or a remote behind a shadow Craft. */
  damageTarget(c: Craft, n: number, dx?: number, dy?: number): void {
    const rem = this.remoteOfCraft(c);
    if (!rem) this.s.player.damage(n, dx, dy);
    else this.damageRemote(rem, n, dx, dy);
  }

  /** Apply hit damage to a remote (detonates at 0 HP). */
  damageRemote(rem: RemoteCraft, n: number, dx?: number, dy?: number): void {
    const craft = this.s.remoteCore.ensureRemotePilotCraft(rem);
    if (craft) {
      craft.damage(n, dx, dy);
      rem.health = craft.health;
      if (craft.phase === "dead" || rem.health <= 0) {
        rem.health = 0;
        rem.detonate = true;
      }
      return;
    }
    rem.health -= n;
    if (rem.health <= 0) {
      rem.health = 0;
      rem.detonate = true;
    }
  }

  /**
   * Spotting / chase-engage reach. Cloak zeros it; combat-focus `enemyAwareMul` scales it.
   * Helis (not VTOL / plane) get a slight further cut when flying low AGL.
   */
  enemyAwareReach(base: number, vision = 1, focus: Craft = this.combatFocus()): number {
    if (this.s.cloakT > 0 && focus === this.s.player) return 0;
    const craft = focus.spec;
    let mul = this.targetAwareMul(focus);
    if (craft.flightModel === "heli" && focus.phase === "flight") {
      const agl = focus.z - focus.gndSmooth;
      const cruise = craft.cruiseAgl;
      const t = Phaser.Math.Clamp((agl - LOW_AGL) / Math.max(1, cruise - LOW_AGL), 0, 1);
      // Nap-of-earth: ~18% harder to spot; fades out by cruise AGL.
      mul *= Phaser.Math.Linear(0.82, 1, t);
    }
    return base * vision * mul;
  }
}
