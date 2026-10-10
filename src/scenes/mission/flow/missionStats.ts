import { craftOf } from "../../../sim/crafts";
import { missionOf } from "../../../sim/mission";
import { isNeutral, specOf } from "../../../sim/roster";
import type { RemoteCraft } from "../../../sim/remote";
import type { Craft } from "../../../sim/craft";
import {
  AI,
  bump,
  bumpKey,
  ENVIRONMENT,
  isHostileEnemy,
  killRange,
  newRun,
  NO_DIM,
  PLAYER,
  rowKey,
  UNKNOWN_WEAPON,
  type Control,
  type KillDebuff,
  type MissionOutcome,
  type MissionRun,
} from "../../../sim/stats";
import { heightOf, unitStunned, type Shot, type Unit } from "../../../sim/combat";
import { commitRun } from "../../../persist/statsStore";
import type { MissionScene } from "../../missionScene";

/** What hurt the player's side (enemy unit kind + its weapon, or ENVIRONMENT + a cause). */
export interface DamageSource {
  enemy: string;
  weapon: string;
}

/** Credit for player-side damage: weapon, the craft that used it, who controlled it. Shared per combination. */
export interface StatBy {
  readonly weapon: string;
  readonly craft: string;
  readonly control: Control;
  /** Offense row keys by enemy kind. */
  readonly keys: Map<string, string>;
}

/** Stats key for a remote: its craft key (e.g. HOUND), so it reads like any other craft. */
export function remoteCraftKey(r: RemoteCraft): string {
  return r.spec.craftLook ?? r.spec.kind;
}

/** Damage below this per frame that no hit accounted for is ignored (float noise). */
const UNATTRIBUTED_EPS = 0.01;
/** Cause recorded for host damage / death no tracked hit explains (terrain, crash). */
const UNATTRIBUTED: DamageSource = { enemy: ENVIRONMENT, weapon: "other" };

/** An enemy seeker in flight at the player's side, resolved as hit or dodged once it's gone. */
interface PendingSeeker {
  shot: Shot;
  craft: string;
  control: Control;
}

/**
 * Mission stats: records this run into in-memory fact tables (offense, damage taken, sorties, countermeasures,
 * kill context, remote launches), tagged with the player-side craft and player / AI control, and commits them
 * once when the mission ends or is left. Hot paths don't allocate: credits + row keys are cached, time sums in numbers.
 */
export class MissionStats {
  private run: MissionRun = newRun("", "");
  private committed = false;
  /** Control new host shots are credited to (AI while automatic crew stations fire). */
  private hostControl: Control = PLAYER;
  /** Remote the player is piloting (refreshed each tick). */
  private piloted: RemoteCraft | undefined;
  /** Cached credits: control → craft → weapon. */
  private credits: Record<Control, Map<string, Map<string, StatBy>>> = { player: new Map(), ai: new Map() };

  /** Hostile units destroyed by the player's side. */
  kills = 0;
  /** Neutral units destroyed by the player's side. */
  collateral = 0;
  objectives = 0;
  /** Host seconds in flight. */
  timeFlown = 0;
  private timePlayed = 0;
  /** Remote seconds alive, by control then craft key. */
  private remoteTime: Record<Control, Map<string, number>> = { player: new Map(), ai: new Map() };

  /** Host health last frame, -1 until the first tick. */
  private lastHealth = -1;
  /** Host damage this frame already attributed by a hit. */
  private attributed = 0;
  private lastSource: DamageSource = UNATTRIBUTED;
  private hostDeathRecorded = false;
  /** Defense row for host damage no hit explains (built on first use). */
  private unattributedKey: string | undefined;
  private seekers: PendingSeeker[] = [];

  constructor(readonly s: MissionScene) {}

  reset(): void {
    this.run = newRun(craftOf().kind, missionOf().kind);
    this.committed = false;
    this.hostControl = PLAYER;
    this.piloted = undefined;
    this.credits = { player: new Map(), ai: new Map() };
    this.kills = 0;
    this.collateral = 0;
    this.objectives = 0;
    this.timeFlown = 0;
    this.timePlayed = 0;
    this.remoteTime = { player: new Map(), ai: new Map() };
    this.lastHealth = -1;
    this.attributed = 0;
    this.lastSource = UNATTRIBUTED;
    this.hostDeathRecorded = false;
    this.unattributedKey = undefined;
    this.seekers = [];
  }

  // —— Actors + credits ——

  /** Who's driving a remote: the player only while piloting it. */
  controlOf(r: RemoteCraft): Control {
    return r === this.piloted ? PLAYER : AI;
  }

  /** Shared credit for `weapon` on `craft` under `control`. */
  credit(craft: string, control: Control, weapon: string): StatBy {
    const byCraft = this.credits[control];
    let byWeapon = byCraft.get(craft);
    if (!byWeapon) byCraft.set(craft, (byWeapon = new Map()));
    let by = byWeapon.get(weapon);
    if (!by) byWeapon.set(weapon, (by = { weapon, craft, control, keys: new Map() }));
    return by;
  }

  /** Credit for a host weapon (player-controlled). */
  hostCredit(weapon: string): StatBy {
    return this.credit(this.run.craft, PLAYER, weapon);
  }

  /** Credit for a remote's weapon / ram. */
  remoteCredit(r: RemoteCraft, weapon: string): StatBy {
    return this.credit(remoteCraftKey(r), this.controlOf(r), weapon);
  }

  /** Control new host shots are credited to (AI around automatic crew stations); returns the previous one. */
  setHostControl(control: Control): Control {
    const prev = this.hostControl;
    this.hostControl = control;
    return prev;
  }

  /** Stamp a new player-side shot with craft / control (unless set, e.g. a remote's or a parent's) and origin. */
  stamp(shot: Shot): void {
    shot.statCraft ??= this.run.craft;
    shot.statCtl ??= this.hostControl;
    shot.statX ??= shot.x;
    shot.statY ??= shot.y;
    shot.statZ ??= shot.z;
  }

  /** Credit for a player-side shot's damage. */
  byShot(shot: Shot): StatBy {
    return this.credit(shot.statCraft ?? this.run.craft, shot.statCtl ?? PLAYER, shot.wpnId ?? UNKNOWN_WEAPON);
  }

  private offenseKey(by: StatBy, enemy: string): string {
    let key = by.keys.get(enemy);
    if (key === undefined) {
      key = rowKey(this.run.offense, { craft: by.craft, control: by.control, map: this.run.map, weapon: by.weapon, enemy });
      by.keys.set(enemy, key);
    }
    return key;
  }

  // —— Offense ——

  /** A player-side shot left the gun. */
  shot(shot: Shot): void {
    bumpKey(this.run.offense, this.offenseKey(this.byShot(shot), NO_DIM), "shots");
  }

  /** A player-side shot damaged its first unit (counted once per shot). */
  hit(shot: Shot, u: Unit): void {
    bumpKey(this.run.offense, this.offenseKey(this.byShot(shot), u.kind), "hits");
  }

  /** Player-side damage landed on `u`, fired from (ox, oy, oz); remembered for kill credit. */
  dealt(by: StatBy, u: Unit, dmg: number, ox?: number, oy?: number, oz?: number): void {
    if (dmg <= 0) return;
    u.statBy = by;
    u.statOx = ox;
    u.statOy = oy;
    u.statOz = oz;
    bumpKey(this.run.offense, this.offenseKey(by, u.kind), "damageDealt", dmg);
  }

  /** `u` died; credited to the last player-side weapon that hurt it, if any, with its kill context. */
  kill(u: Unit): void {
    const last = u.statBy;
    if (!last) return;
    const by = this.credit(last.craft, last.control, last.weapon);
    bumpKey(this.run.offense, this.offenseKey(by, u.kind), "kills");
    if (isHostileEnemy(u.kind)) this.kills++;
    else this.collateral++;
    const tz = u.z + heightOf(u.kind) * 0.5;
    const ox = u.statOx ?? u.x;
    const oy = u.statOy ?? u.y;
    const oz = u.statOz ?? tz;
    const stunned = unitStunned(u);
    const blinded = this.s.targeting.enemySmokeVision(u) <= 0;
    const debuff: KillDebuff = stunned && blinded ? "both" : stunned ? "stunned" : blinded ? "blinded" : "none";
    bump(
      this.run.killContext,
      {
        craft: by.craft,
        control: by.control,
        map: this.run.map,
        weapon: by.weapon,
        enemy: u.kind,
        range: killRange(Math.hypot(u.x - ox, u.y - oy, tz - oz)),
        // The target's own cached line of sight to its focus (no new trace): it couldn't see us = NLOS kill.
        sight: this.s.lineOfSight.lastSaw(u) ? "los" : "nlos",
        debuff,
      },
      "kills"
    );
  }

  /** The host launched a remote (`remote` = its craft key). */
  remoteLaunch(remote: string): void {
    bump(this.run.remoteLaunches, { craft: this.run.craft, map: this.run.map, remote }, "launches");
  }

  objective(): void {
    this.objectives++;
  }

  countermeasure(id: string, craft = this.run.craft, control: Control = PLAYER): void {
    bump(this.run.countermeasures, { craft, control, map: this.run.map, countermeasure: id }, "uses");
  }

  // —— Defense (enemy fire at the player's side: low rate, keyed per event) ——

  private defense(craft: string, control: Control, enemy: string, enemyWeapon: string) {
    return { craft, control, map: this.run.map, enemy, enemyWeapon };
  }

  /** An enemy seeker locked on the player's side left the launcher in shot pass `frame`; tracked until hit or dodged. */
  seekerFired(shot: Shot, frame: number): void {
    const rem = shot.homeRemoteId != null ? this.s.remotes.find((r) => r.id === shot.homeRemoteId) : undefined;
    const craft = rem ? remoteCraftKey(rem) : this.run.craft;
    const control = rem ? this.controlOf(rem) : PLAYER;
    shot.statFrame = frame;
    bump(this.run.defense, this.defense(craft, control, shot.srcKind ?? UNKNOWN_WEAPON, shot.srcWpn ?? UNKNOWN_WEAPON), "seekersFired");
    this.seekers.push({ shot, craft, control });
  }

  /**
   * Run `apply` (something that may damage the victim) and record whatever actually landed, read off `health`:
   * a hit taken, its damage, and a death if it was the killing blow.
   */
  private recordHit(
    src: DamageSource,
    craft: string,
    control: Control,
    isHost: boolean,
    health: () => number,
    apply: () => void
  ): number {
    const before = health();
    apply();
    const after = health();
    const dmg = before - after;
    if (dmg <= 0 || this.committed) return Math.max(0, dmg);
    const key = rowKey(this.run.defense, this.defense(craft, control, src.enemy, src.weapon));
    bumpKey(this.run.defense, key, "hitsTaken");
    bumpKey(this.run.defense, key, "damageTaken", dmg);
    if (isHost) {
      this.attributed += dmg;
      this.lastSource = src;
    }
    if (before > 0 && after <= 0) {
      if (isHost) this.recordHostDeath(src);
      else bumpKey(this.run.defense, key, "deaths");
    }
    return dmg;
  }

  /** Damage that may hit the host craft; returns the damage that landed. */
  hostHit(src: DamageSource, apply: () => void): number {
    return this.recordHit(src, this.run.craft, PLAYER, true, () => this.s.player.health, apply);
  }

  /** Damage that may hit a remote; returns the damage that landed. */
  remoteHit(src: DamageSource, r: RemoteCraft, apply: () => void): number {
    return this.recordHit(src, remoteCraftKey(r), this.controlOf(r), false, () => r.health, apply);
  }

  /** Damage aimed at a combat Craft: the host, or the remote behind a shadow craft; returns the damage that landed. */
  craftHit(src: DamageSource, c: Craft, apply: () => void): number {
    const rem = this.s.targeting.remoteOfCraft(c);
    return rem ? this.remoteHit(src, rem, apply) : this.hostHit(src, apply);
  }

  private recordHostDeath(src: DamageSource): void {
    if (this.hostDeathRecorded) return;
    this.hostDeathRecorded = true;
    bump(this.run.defense, this.defense(this.run.craft, PLAYER, src.enemy, src.weapon), "deaths");
  }

  // —— Per frame ——

  /** Per frame, after the shot pass `shotFrame`: time, seekers, host damage / death no hit accounted for. */
  tick(dt: number, shotFrame: number): void {
    if (this.committed) return;
    const p = this.s.player;
    const fleet = this.s.remoteFleet;
    this.piloted = fleet.remotePilotActive ? fleet.pilotingRemote() : undefined;
    if (!this.s.over) {
      this.timePlayed += dt;
      if (p.phase === "flight") this.timeFlown += dt;
      for (const r of this.s.remotes) {
        if (r.detonate || r.dock || r.health <= 0) continue;
        const times = this.remoteTime[this.controlOf(r)];
        const craft = remoteCraftKey(r);
        times.set(craft, (times.get(craft) ?? 0) + dt);
      }
    }
    if (this.lastHealth >= 0) {
      const extra = this.lastHealth - p.health - this.attributed;
      if (extra > UNATTRIBUTED_EPS) {
        this.unattributedKey ??= rowKey(this.run.defense, this.defense(this.run.craft, PLAYER, UNATTRIBUTED.enemy, UNATTRIBUTED.weapon));
        bumpKey(this.run.defense, this.unattributedKey, "damageTaken", extra);
      }
    }
    this.resolveSeekers(shotFrame);
    // A host death no tracked hit caused (e.g. terrain): blame the last thing that hurt us.
    if (p.phase === "dead") this.recordHostDeath(this.lastSource);
    this.lastHealth = p.health;
    this.attributed = 0;
  }

  /** Seekers not kept by the latest shot pass are gone: dodged unless they landed damage. */
  private resolveSeekers(shotFrame: number): void {
    if (!this.seekers.length) return;
    let w = 0;
    for (const p of this.seekers) {
      if ((p.shot.statFrame ?? 0) >= shotFrame) {
        this.seekers[w++] = p;
        continue;
      }
      if (!p.shot.statHitPlayer) {
        const at = this.defense(p.craft, p.control, p.shot.srcKind ?? UNKNOWN_WEAPON, p.shot.srcWpn ?? UNKNOWN_WEAPON);
        bump(this.run.defense, at, "seekersDodged");
      }
    }
    this.seekers.length = w;
  }

  /** Close the run and save it (once). Without an outcome it's inferred: all objectives, crashed, or left early (not saved if it never moved). */
  finish(outcome?: MissionOutcome): void {
    if (this.committed) return;
    this.committed = true;
    const s = this.s;
    const map = this.run.map;
    const hvTotal = s.world.hv.length;
    const done = outcome ?? (hvTotal > 0 && s.completedHv.size >= hvTotal ? "succeeded" : s.player.phase === "dead" ? "failed" : "abandoned");
    // Left before ever moving (never flew, no remote time): not a sortie, nothing saved.
    if (done === "abandoned" && this.timeFlown <= 0 && ![PLAYER, AI].some((c) => this.remoteTime[c].size)) return;
    const host = { craft: this.run.craft, control: PLAYER, map };
    bump(this.run.sorties, host, "started");
    bump(this.run.sorties, host, done);
    bump(this.run.sorties, host, "objectives", this.objectives);
    bump(this.run.sorties, host, "timePlayed", this.timePlayed);
    bump(this.run.sorties, host, "timeFlown", this.timeFlown);
    for (const control of [PLAYER, AI]) {
      for (const [craft, t] of this.remoteTime[control]) bump(this.run.sorties, { craft, control, map }, "timeFlown", t);
    }
    let enemies = 0;
    let enemiesDead = 0;
    let neutrals = 0;
    let neutralsDead = 0;
    let buildings = 0;
    let buildingsDead = 0;
    for (const u of s.units) {
      if (isNeutral(u.kind)) {
        neutrals++;
        if (u.dead) neutralsDead++;
      } else {
        enemies++;
        if (u.dead) enemiesDead++;
      }
      if (specOf(u.kind).building) {
        buildings++;
        if (u.dead) buildingsDead++;
      }
    }
    const pct = (n: number, of: number) => (of > 0 ? n / of : 0);
    this.run.result = {
      map,
      craft: this.run.craft,
      outcome: done,
      time: this.timePlayed,
      enemyKillPct: pct(enemiesDead, enemies),
      neutralKillPct: pct(neutralsDead, neutrals),
      buildingKillPct: pct(buildingsDead, buildings),
      objectivePct: pct(s.completedHv.size, hvTotal),
      objectiveTotal: hvTotal,
      at: Date.now(),
    };
    commitRun(this.run);
  }
}
