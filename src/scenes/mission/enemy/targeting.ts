import Phaser from "phaser";
import { remoteTargetable, unitIsAaEnemy, unitSightBase, weaponReach, type TargetDomain } from "../../../sim/targetRules";
import { radius, type Shot, type Unit } from "../../../sim/combat";
import { specOf, type WeaponSpec } from "../../../sim/roster";
import { remoteHasPovHud, type RemoteCraft } from "../../../sim/remote";
import { smokeCoverAt, smokeVisionMul } from "../../../sim/weaponRuntime";
import { Craft, LOW_AGL } from "../../../sim/craft";
import type { MissionScene } from "../../missionScene";

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
  private domains = new WeakMap<RemoteCraft, { frame: number; domain: TargetDomain }>();

  constructor(readonly s: MissionScene) {}

  smokeVisionAt(x: number, y: number, pad = 0): number {
    return smokeVisionMul(smokeCoverAt(this.s.countermeasures.smokePuffs, x, y, pad));
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
    if (!this.s.remoteFleet.remotePilotActive) return undefined;
    const pilot = this.s.remoteFleet.pilotingRemote();
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
    for (const r of this.s.remotes) if (this.s.remoteFleet.remotePilotCraft.get(r.id) === c) return r;
    return undefined;
  }

  /** Shadow Craft for an enemy-targeted remote, pose/health synced. */
  remoteTargetCraft(r: RemoteCraft): Craft | undefined {
    const craft = this.s.remoteFleet.ensureRemotePilotCraft(r);
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

  /** Where a remote is: submerged ground hulls are underwater, other ground hulls ground, the rest air. Cached per frame. */
  remoteDomain(r: RemoteCraft): TargetDomain {
    if (!r.spec.ground) return "air";
    const frame = this.s.game.loop.frame;
    let c = this.domains.get(r);
    if (!c) this.domains.set(r, (c = { frame: -1, domain: "ground" }));
    if (c.frame !== frame) {
      c.frame = frame;
      c.domain = this.s.nav.submerged(r.x, r.y) ? "underwater" : "ground";
    }
    return c.domain;
  }

  /** Domain of a target craft (the host always flies). */
  domainOf(c: Craft): TargetDomain {
    const rem = this.remoteOfCraft(c);
    return rem ? this.remoteDomain(rem) : "air";
  }

  /** Submerged remotes are invisible to everything without sonar. */
  sees(u: Unit, r: RemoteCraft): boolean {
    return !!specOf(u.kind).sonar || this.remoteDomain(r) !== "underwater";
  }

  /**
   * How well `u` sees target craft `c` (0 = not at all): max sight range scaled for the target, terrain line of sight,
   * then smoke. Cloak blinds everyone to the host; sonar picks up submerged hulls through the water (no terrain LOS).
   */
  visionOf(u: Unit, c: Craft): number {
    if (this.s.countermeasures.cloakT > 0 && c === this.s.player) return 0;
    const reach = this.enemyScaledReach(unitSightBase(u), 1, c);
    const sonar = this.domainOf(c) === "underwater";
    if (sonar && !specOf(u.kind).sonar) return 0;
    if (sonar ? Math.hypot(c.x - u.x, c.y - u.y) > reach : !this.s.lineOfSight.sees(u, c, reach)) return 0;
    return this.enemySmokeVision(u, c);
  }

  /** Score-pick the craft a unit engages; lower score wins, player-controlled heavily favored. */
  pickEnemyTarget(u: Unit, aaUnit: boolean): RemoteCraft | undefined {
    const focusRem = this.combatFocusRemote();
    let best: RemoteCraft | undefined;
    let bestScore = Infinity;
    const hostOk = this.s.countermeasures.cloakT <= 0;
    if (hostOk) {
      const d = Math.hypot(this.s.player.x - u.x, this.s.player.y - u.y);
      bestScore = focusRem ? d * HOST_WHILE_PILOTING_SCORE_MUL : d;
    }
    for (const r of this.s.remotes) {
      if (!remoteTargetable(r) || !this.sees(u, r)) continue;
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
    if (!best && !hostOk && focusRem && !(aaUnit && focusRem.spec.ground) && this.sees(u, focusRem)) return focusRem;
    return best;
  }

  /**
   * What one weapon of `u` engages: the unit's focus when the weapon reaches its domain, else the host (air weapons),
   * else the nearest submerged remote it can see (torpedoes); undefined = nothing this weapon can hit.
   */
  targetForWeapon(u: Unit, wpn: WeaponSpec, focus: Craft): Craft | undefined {
    const reach = weaponReach(wpn);
    if (reach.includes(this.domainOf(focus))) return focus;
    if (reach.includes("air") && this.s.countermeasures.cloakT <= 0) return this.s.player;
    if (!reach.includes("underwater")) return undefined;
    let best: RemoteCraft | undefined;
    let bestD = wpn.range;
    for (const r of this.s.remotes) {
      if (!remoteTargetable(r) || this.remoteDomain(r) !== "underwater" || !this.sees(u, r)) continue;
      const d = Math.hypot(r.x - u.x, r.y - u.y);
      if (d < bestD) {
        bestD = d;
        best = r;
      }
    }
    return best ? this.remoteTargetCraft(best) : undefined;
  }

  /** A shot can strike this remote: torpedoes only submerged ones; others never submerged ones (seekers not dirt-locked). */
  shotReaches(s: Shot, r: RemoteCraft): boolean {
    const d = this.remoteDomain(r);
    if (s.torpedo) return d === "underwater";
    return d !== "underwater" && !(s.homePlayer && d === "ground");
  }

  /** What an enemy seeker homes on: its launch remote while it can still reach it, else the host (torpedoes: nothing). */
  enemySeekerTarget(s: Shot): Craft | undefined {
    if (s.homeRemoteId != null) {
      const r = this.s.remotes.find((r) => r.id === s.homeRemoteId);
      const c = r && remoteTargetable(r) && this.shotReaches(s, r) ? this.remoteTargetCraft(r) : undefined;
      if (c) return c;
      s.homeRemoteId = undefined;
    }
    return s.torpedo ? undefined : this.s.player;
  }

  /**
   * Per-enemy chase/aim craft. AA is blind to dirt HOUND — they see the host bird only.
   */
  unitCombatFocus(u: Unit): Craft {
    const now = this.s.time.now;
    if (u.tgtNextT == null || now >= u.tgtNextT) {
      // Staggered re-pick — acquisition lags a little so many-to-many stays cheap.
      u.tgtNextT = now + ENEMY_RETARGET_MS + (u.id % 7) * 40;
      u.tgtRemoteId = this.pickEnemyTarget(u, unitIsAaEnemy(u))?.id;
    }
    if (u.tgtRemoteId == null) return this.s.player;
    const rem = this.s.remotes.find((r) => r.id === u.tgtRemoteId);
    const craft = rem && remoteTargetable(rem) && this.sees(u, rem) ? this.remoteTargetCraft(rem) : undefined;
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
    const craft = this.s.remoteFleet.ensureRemotePilotCraft(rem);
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
   * A sight or react range scaled for the target: cloak zeros it; combat-focus `enemyAwareMul` scales it.
   * Helis (not VTOL / plane) get a slight further cut when flying low AGL.
   */
  enemyScaledReach(base: number, vision = 1, focus: Craft = this.combatFocus()): number {
    if (this.s.countermeasures.cloakT > 0 && focus === this.s.player) return 0;
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
