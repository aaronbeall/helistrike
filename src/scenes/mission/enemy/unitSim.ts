import { resolveSkin } from "../../../render/camo";
import { containOnMap, groundHull, mapEdgeSteer, steerUnitAngle, stepOnTerrain, turnsInPlace } from "../../../sim/navigation";
import { WATER_MODE } from "../../../sim/navGrid";
import { rollSoldierMood } from "../../../sim/units";
import { troopSoftTurret } from "../../../sim/roster";
import { enemyWeaponIsAa, REACT_DRONE, REACT_FLEE, REACT_INFANTRY, REACT_ORBIT, REACT_SCOUT, REACT_VEHICLE, weaponUnderwater } from "../../../sim/targetRules";
import { craftRotorDiscs, mountAt, rotorDiscs, spriteHalf } from "../../../render/spritePose";
import { trackPrintAlpha } from "../../../render/fxCurves";
import { noteEnemyVolley } from "./enemyFire";
import { textureOf, heightOf, radius, unitStunned, tickStunKinematics, recordUnitSpin, type Unit } from "../../../sim/combat";
import { specOf, gunsOf, crewOf, isGroundVehicle, isInfantry, isNeutral, driveOf } from "../../../sim/roster";
import { groundZ, worldToScreen, cameraPointVisible, isWater } from "../../../worldgen/world";
import Phaser from "phaser";
import { enemyShotBeh, AI_LOCK_BASE, AI_AIM_NARROW_BASE, AI_AIM_WIDE_MUL, advanceAimHold, aimNarrowTime, aimPrecisionSpread, holdProgress, lockAcquireTime } from "../../../sim/weaponRuntime";

import { projectileFxScale } from "../../../render/fxScale";
import { range } from "../../../util/rng";
import { CRUISE_AGL, Craft, LOW_AGL, MAX_AGL } from "../../../sim/craft";
import { circumRadiusOf, footprintInto, footprintOverlap, pointInFootprint } from "../../../render/footprint";
import { lookupSpriteMuzzles } from "../../../art/spriteOrigin";
import { type CraftSpec } from "../../../sim/crafts";
import { spritePivot } from "../../../art/sprites";
import { CRUSH_KILL, enemyWeaponKey, ROTOR_KILL } from "../../../sim/stats";
import type { StatBy } from "../flow/missionStats";
import { SP_INFANTRY, SP_SOLID, SP_STATIC, SP_VEHICLE, type UnitHits } from "../world/spatial";
import type { MissionScene } from "../../missionScene";

/** Max AGL drones will climb/charge to — covers Lightning/Warthog, excludes Reaper (~620). */
const DRONE_KAMIKAZE_AGL = 400;

/** Recovery reverse speed, as a fraction of max speed. */
const BACKUP_SPEED = 0.45;
/** Max steering / separation pad around a solid (see `steerGround`, `separateGround`). */
const STEER_PAD = 42;
const BLOCK_PAD = 12;
const SEP_PAD = 10;
/** Separation pushes the unit; re-query once it has moved this far from the query point. */
const SEP_REQUERY = 32;
/** Scratch copy of a unit's turret angles for spin recording (one unit at a time). */
const PREV_TURRETS: number[] = [];

/** Stats weapon key for a kamikaze drone ramming the player. */
const KAMIKAZE_RAM = "ram";

/** Boat sprint multiplier while pursuing / retreating (spec `boatReact.sprint` overrides). */
const BOAT_SPRINT = 1.5;
/** Pursuing boats drop back to cruise inside this range of their focus. */
const BOAT_STANDOFF = 160;

/** What a boat does about its focus right now (spec `boatReact`): needs sight of a flying focus; hurt overrides seen. */
function boatReaction(u: Unit, h: Craft, vision: number): "pursue" | "retreat" | undefined {
  const r = specOf(u.kind).boatReact;
  if (!r || vision <= 0 || h.phase !== "flight") return undefined;
  if (r.hurt && u.health < u.max * (r.hurtBelow ?? 0.5)) return r.hurt;
  return r.seen;
}

/** Enemy unit simulation: per-frame update loop, air/ground/boat drive, terrain + map-edge steering, stun, bleed-out, roadkill. */
export class UnitSim {
  /** Live unit id → unit (rebuilt each sim frame). */
  unitIdMap = new Map<number, Unit>();
  /** `s.units` index of the unit being updated (-1 outside the loop). */
  private cur = -1;

  constructor(readonly s: MissionScene) {}

  reset(): void {
    this.cur = -1;
  }

  leashPinned(u: Unit): void {
    if (u.pinId == null) return;
    const post = this.unitById(u.pinId);
    if (!post) {
      u.pinId = undefined;
      u.pinMount = undefined;
      return;
    }
    const crew = crewOf(post.kind);
    if (!crew?.mounts.length) {
      u.pinId = undefined;
      u.pinMount = undefined;
      return;
    }
    if (crew.mode === "snap") {
      const m = crew.mounts[u.pinMount ?? 0] ?? crew.mounts[0]!;
      const tex = resolveSkin(this.s.textures, textureOf(post.kind), post.camo);
      const at = mountAt(this.s.textures, post, tex, m);
      u.x = at.x;
      u.y = at.y;
      return;
    }
    const r = crew.leashR ?? radius(post.kind);
    const dx = u.x - post.x;
    const dy = u.y - post.y;
    const d = Math.hypot(dx, dy);
    if (d <= r || d < 0.001) return;
    u.x = post.x + (dx / d) * r;
    u.y = post.y + (dy / d) * r;
  }

  driveDrone(u: Unit, dt: number, h: Craft, dist: number, _dx: number, _dy: number, vision = 1): void {
    if (vision > 0 && dist < this.s.targeting.enemyScaledReach(REACT_DRONE, vision, h) && h.phase === "flight") {
      const playerAgl = Math.max(LOW_AGL + 8, h.z - h.gndSmooth);
      const inAltReach = playerAgl <= DRONE_KAMIKAZE_AGL;
      // Lead the intercept — Lightning / jets outrun pure pursuit easily.
      const leadT = Phaser.Math.Clamp(dist / 420, 0.12, 0.55);
      const tx = h.x + h.vx * leadT;
      const ty = h.y + h.vy * leadT;
      const ldx = tx - u.x;
      const ldy = ty - u.y;
      const want = Math.atan2(ldy, ldx);
      const err = Math.abs(Phaser.Math.Angle.Wrap(want - u.angle));
      const turn = err > 1.0 ? 5.2 : err > 0.4 ? 3.8 : 2.8;
      u.angle = steerUnitAngle(u.angle, want, turn, dt);

      const facing = err < 0.16;
      if (facing && inAltReach) {
        const fx = Math.cos(u.angle);
        const fy = Math.sin(u.angle);
        const along = u.vx * fx + u.vy * fy;
        const lx = u.vx - fx * along;
        const ly = u.vy - fy * along;
        const sideKeep = Math.pow(0.25, dt);
        u.vx = fx * along + lx * sideKeep;
        u.vy = fy * along + ly * sideKeep;
        u.vx += fx * 360 * dt;
        u.vy += fy * 360 * dt;
        u.vx *= Math.pow(0.94, dt);
        u.vy *= Math.pow(0.94, dt);
        const maxSpd = 320;
        const s = Math.hypot(u.vx, u.vy);
        if (s > maxSpd) {
          u.vx *= maxSpd / s;
          u.vy *= maxSpd / s;
        }
        u.aiState = "CHARGE";
      } else if (facing && !inAltReach) {
        // Above drone ceiling (e.g. Reaper) — track heading but do not dive-charge.
        u.vx *= Math.pow(0.42, dt);
        u.vy *= Math.pow(0.42, dt);
        u.aiState = "HOLD";
      } else {
        // Coast: no thrust, mild drag so it overshoots then slows while turning
        u.vx *= Math.pow(0.52, dt);
        u.vy *= Math.pow(0.52, dt);
        u.aiState = "TURN";
      }
      u.aiTx = tx;
      u.aiTy = ty;
      // 3D proximity — only when altitude is within kamikaze reach.
      if (inAltReach) {
        const dist3 = Math.hypot(h.x - u.x, h.y - u.y, h.z - u.z);
        if (dist3 < h.spec.radius + radius(u.kind)) {
          this.s.stats.craftHit({ enemy: u.kind, weapon: KAMIKAZE_RAM }, h, () => this.s.targeting.damageTarget(h, 38, u.vx, u.vy));
          // Kamikaze: explode in place — no falling crash hull.
          this.s.destruction.destroyUnit(u, false, false, true);
          return;
        }
      }
    } else {
      u.vx *= Math.pow(0.38, dt);
      u.vy *= Math.pow(0.38, dt);
    }
    u.x += u.vx * dt;
    u.y += u.vy * dt;
  }

  driveScoutHeli(u: Unit, dt: number, h: Craft, dist: number, dx: number, dy: number, vision = 1): void {
    u.moodT = (u.moodT ?? 0) - dt;
    if ((u.moodT ?? 0) <= 0 && u.aiMood === "flee") u.aiMood = undefined;
    const flee = u.aiMood === "flee";
    const kite = u.aiMood === "kite";
    const toAng = Math.atan2(dy, dx);
    const side = (u.id & 1) === 0 ? 1 : -1;
    const prefDist = 380;

    if (vision > 0 && dist < this.s.targeting.enemyScaledReach(REACT_SCOUT, vision, h) && h.phase === "flight") {
      const fwdX = dx / (dist || 1);
      const fwdY = dy / (dist || 1);
      const latX = -fwdY * side;
      const latY = fwdX * side;
      const fx = Math.cos(u.angle);
      const fy = Math.sin(u.angle);

      if (flee) {
        const awayAng = Math.atan2(-dy, -dx);
        u.angle = steerUnitAngle(u.angle, awayAng, 2.8, dt);
        const face = Math.max(0, Math.cos(Phaser.Math.Angle.Wrap(awayAng - u.angle)));
        u.vx += fx * 170 * face * dt;
        u.vy += fy * 170 * face * dt;
      } else if (kite && dist < 900) {
        u.angle = steerUnitAngle(u.angle, toAng, 3.4, dt);
        const face = Math.max(0, Math.cos(Phaser.Math.Angle.Wrap(toAng - u.angle)));
        const radial = Phaser.Math.Clamp((dist - prefDist) * 0.4, -100, 100);
        // Main thrust along nose; light strafe only once roughly facing.
        u.vx += (fx * radial + latX * 130 * face) * face * dt;
        u.vy += (fy * radial + latY * 130 * face) * face * dt;
      } else {
        u.angle = steerUnitAngle(u.angle, toAng, 2.8, dt);
        const face = Math.max(0, Math.cos(Phaser.Math.Angle.Wrap(toAng - u.angle)));
        const thrust = dist > prefDist ? 155 : 60;
        u.vx += fx * thrust * face * dt;
        u.vy += fy * thrust * face * dt;
        if (kite && dist > 1100) u.aiMood = undefined;
      }
    }
    const damp = flee ? 0.55 : kite ? 0.62 : 0.55;
    u.vx *= Math.pow(damp, dt);
    u.vy *= Math.pow(damp, dt);
    u.x += u.vx * dt;
    u.y += u.vy * dt;
    u.aiState = flee ? "RETREAT" : kite ? "KITE" : "ATTACK";
    u.aiTx = h.x;
    u.aiTy = h.y;
  }

  driveOrbitHeli(u: Unit, dt: number, h: Craft, dist: number, dx: number, dy: number, vision = 1): void {
    // Always-orbit heavies omit combatMood; gunships cycle through combatMood.
    const heavy = !specOf(u.kind).combatMood;
    if (heavy) {
      // Heavy: always orbit and shoot, no kiting
      if (vision > 0 && dist < this.s.targeting.enemyScaledReach(REACT_ORBIT, vision, h) && h.phase === "flight") {
        u.orbit += 0.2 * dt;
        const ring = 430;
        const ox = h.x + Math.cos(u.orbit) * ring;
        const oy = h.y + Math.sin(u.orbit) * ring;
        const to = Math.atan2(oy - u.y, ox - u.x);
        u.angle = steerUnitAngle(u.angle, to, 1.15, dt);
        u.vx += Math.cos(u.angle) * 58 * dt;
        u.vy += Math.sin(u.angle) * 58 * dt;
        u.aiState = "ORBIT";
        u.aiTx = ox;
        u.aiTy = oy;
      } else {
        u.aiState = "HOLD";
        u.aiTx = undefined;
        u.aiTy = undefined;
      }
      u.vx *= 0.98;
      u.vy *= 0.98;
    } else {
      // Gunship: attack -> kite -> orbit, always shooting
      u.moodT = (u.moodT ?? 0) - dt;
      if ((u.moodT ?? 0) <= 0 && u.aiMood === "flee") u.aiMood = undefined;
      const orbit = u.aiMood === "flee";
      const kite = u.aiMood === "kite";
      const toAng = Math.atan2(dy, dx);
      const side = (u.id & 1) === 0 ? 1 : -1;
      const closeDist = 280;
      const orbitRing = 380;

      if (vision > 0 && dist < this.s.targeting.enemyScaledReach(REACT_ORBIT, vision, h) && h.phase === "flight") {
        const fwdX = dx / (dist || 1);
        const fwdY = dy / (dist || 1);
        const latX = -fwdY * side;
        const latY = fwdX * side;
        const fx = Math.cos(u.angle);
        const fy = Math.sin(u.angle);

        if (orbit) {
          u.orbit += 0.28 * dt;
          const ox = h.x + Math.cos(u.orbit) * orbitRing;
          const oy = h.y + Math.sin(u.orbit) * orbitRing;
          const to = Math.atan2(oy - u.y, ox - u.x);
          u.angle = steerUnitAngle(u.angle, to, 1.6, dt);
          u.vx += fx * 78 * dt;
          u.vy += fy * 78 * dt;
        } else if (kite && dist < 700) {
          u.angle = steerUnitAngle(u.angle, toAng, 1.85, dt);
          const face = Math.max(0, Math.cos(Phaser.Math.Angle.Wrap(toAng - u.angle)));
          const radial = Phaser.Math.Clamp((dist - closeDist) * 0.3, -65, 65);
          u.vx += (fx * radial + latX * 72 * face) * face * dt;
          u.vy += (fy * radial + latY * 72 * face) * face * dt;
        } else {
          u.angle = steerUnitAngle(u.angle, toAng, 1.6, dt);
          const face = Math.max(0, Math.cos(Phaser.Math.Angle.Wrap(toAng - u.angle)));
          const thrust = dist > closeDist ? 85 : 30;
          u.vx += fx * thrust * face * dt;
          u.vy += fy * thrust * face * dt;
          if (kite && dist > 900) u.aiMood = undefined;
        }
        u.aiState = orbit ? "ORBIT" : kite ? "KITE" : "ATTACK";
        u.aiTx = h.x;
        u.aiTy = h.y;
      } else {
        u.aiState = "HOLD";
        u.aiTx = undefined;
        u.aiTy = undefined;
      }
      const damp = orbit ? 0.92 : kite ? 0.65 : 0.6;
      u.vx *= Math.pow(damp, dt);
      u.vy *= Math.pow(damp, dt);
    }
    u.x += u.vx * dt;
    u.y += u.vy * dt;
  }

  /** Solids near (x, y), with the updating unit re-indexed first so the index stays exact. */
  private solidsNear(u: Unit, x: number, y: number, r: number, mask: number): UnitHits {
    if (this.cur >= 0 && this.s.units[this.cur] === u) this.s.spatial.moved(this.cur, u);
    return this.s.spatial.near(x, y, r, mask);
  }

  /** Solids are skipped when dead, self, or the post a unit is pinned to (its platform, never an obstacle). */
  steerGround(u: Unit, wantX: number, wantY: number): { x: number; y: number } {
    let wx = wantX;
    let wy = wantY;
    const uR = circumRadiusOf(u.kind);
    const uFp = footprintInto(u, 0, 0);
    // Buildings, statics, ground vehicles, and infantry all block.
    const near = this.solidsNear(u, u.x, u.y, uR + STEER_PAD, SP_SOLID);
    for (let i = 0; i < near.n; i++) {
      const o = near.at(i);
      if (o === u || o.dead || o.id === u.pinId) continue;
      const hard = near.mask(i) === SP_STATIC;
      const pad = hard ? 40 : 28;
      const maxR = uR + near.radius(i) + pad + 2;
      const dx = u.x - o.x;
      const dy = u.y - o.y;
      if (dx * dx + dy * dy > maxR * maxR) continue;
      const ov = footprintOverlap(uFp, footprintInto(o, pad, 1));
      if (!ov.hit || ov.depth <= 0) continue;
      const strength = hard ? 3.2 : 2.4;
      const push = ov.depth * strength;
      wx += ov.nx * push;
      wy += ov.ny * push;
    }
    near.done();
    // Short look-ahead: if heading into a solid, bias the want sideways.
    const hx = wx - u.x;
    const hy = wy - u.y;
    const hd = Math.hypot(hx, hy) || 1;
    const nx = hx / hd;
    const ny = hy / hd;
    const look = radius(u.kind) + 52;
    const lx = u.x + nx * look;
    const ly = u.y + ny * look;
    const lookPad = radius(u.kind) + 22;
    const ahead = this.solidsNear(u, lx, ly, lookPad + 2, SP_STATIC | SP_VEHICLE);
    for (let i = 0; i < ahead.n; i++) {
      const o = ahead.at(i);
      if (o === u || o.dead || o.id === u.pinId) continue;
      const maxR = ahead.radius(i) + lookPad + 2;
      const odx = lx - o.x;
      const ody = ly - o.y;
      if (odx * odx + ody * ody > maxR * maxR) continue;
      if (pointInFootprint(lx, ly, footprintInto(o, lookPad, 1))) {
        wx += -ny * 56;
        wy += nx * 56;
        wx -= nx * 28;
        wy -= ny * 28;
        break;
      }
    }
    ahead.done();
    const dry = this.s.nav.repel(u, wx, wy, this.s.nav.modeOf(u));
    return mapEdgeSteer(u.x, u.y, dry.x, dry.y);
  }

  /** True when this hull is pressed into another solid — unlocks wheeled pivot. */
  groundUnitBlocked(u: Unit): boolean {
    const uR = circumRadiusOf(u.kind);
    const near = this.solidsNear(u, u.x, u.y, uR + BLOCK_PAD, SP_SOLID);
    let blocked = false;
    for (let i = 0; i < near.n; i++) {
      const o = near.at(i);
      if (o === u || o.dead || o.id === u.pinId) continue;
      // Buildings / statics: easier jam. Soft infantry brush needs a deeper press.
      const kind = near.mask(i);
      const solid = kind !== SP_INFANTRY;
      const pad = kind === SP_STATIC ? 10 : 6;
      const maxR = uR + near.radius(i) + pad + 2;
      const dx = u.x - o.x;
      const dy = u.y - o.y;
      if (dx * dx + dy * dy > maxR * maxR) continue;
      const ov = footprintOverlap(footprintInto(u, 0, 0), footprintInto(o, pad, 1));
      const need = solid ? 2.5 : 5;
      if (ov.hit && ov.depth > need) {
        blocked = true;
        break;
      }
    }
    near.done();
    return blocked;
  }

  /** Soft depenetration vs buildings / other ground units after a move. */
  separateGround(u: Unit): void {
    const uR = circumRadiusOf(u.kind);
    let qx = u.x;
    let qy = u.y;
    let near = this.solidsNear(u, qx, qy, uR + SEP_PAD + SEP_REQUERY, SP_SOLID);
    for (let i = 0; i < near.n; i++) {
      if (Math.abs(u.x - qx) + Math.abs(u.y - qy) > SEP_REQUERY) {
        // Pushed far from the query point: re-query here, resume after the last slot visited.
        const last = i > 0 ? near.slot(i - 1) : -1;
        near.done();
        qx = u.x;
        qy = u.y;
        near = this.solidsNear(u, qx, qy, uR + SEP_PAD + SEP_REQUERY, SP_SOLID);
        i = 0;
        while (i < near.n && near.slot(i) <= last) i++;
        if (i >= near.n) break;
      }
      const o = near.at(i);
      if (o === u || o.dead || o.id === u.pinId) continue;
      const hard = near.mask(i) === SP_STATIC;
      const pad = hard ? 8 : 4;
      const maxR = uR + near.radius(i) + pad + 2;
      const dx = u.x - o.x;
      const dy = u.y - o.y;
      if (dx * dx + dy * dy > maxR * maxR) continue;
      const ov = footprintOverlap(footprintInto(u, 0, 0), footprintInto(o, pad, 1));
      if (!ov.hit || ov.depth <= 0) continue;
      const push = ov.depth * (hard ? 0.85 : 0.45);
      u.x += ov.nx * push;
      u.y += ov.ny * push;
      // Kill residual closing speed into the obstacle.
      const vn = u.vx * ov.nx + u.vy * ov.ny;
      if (vn < 0) {
        u.vx -= ov.nx * vn;
        u.vy -= ov.ny * vn;
      }
    }
    near.done();
  }

  /** A ground hull that can't be in deep water dies there (normal death rules: it sinks). */
  private drownIfDeep(u: Unit): boolean {
    if (!this.s.nav.drowns(u)) return false;
    // Quiet + intact: no explosion or blast, nothing thrown off; the wreck rule sinks the hull.
    this.s.destruction.destroyUnit(u, true, true, true, false, true);
    return true;
  }

  driveBoat(u: Unit, dt: number, h: Craft, dist: number, vision: number): void {
    const sp = specOf(u.kind);
    const yaw = sp.boatYaw ?? 0.85;
    let spd = sp.boatSpeed ?? 22;
    if (!isWater(this.s.world, u.x, u.y)) {
      const out = this.s.nav.escapePoint(u, WATER_MODE);
      const want = out ? Math.atan2(out.y - u.y, out.x - u.x) : u.angle;
      u.angle = steerUnitAngle(u.angle, want, yaw * 1.4, dt);
      const step = spd * 0.35 * dt;
      // Stranded: crawl over land toward water (don't require wet cells yet).
      u.x += Math.cos(u.angle) * step;
      u.y += Math.sin(u.angle) * step;
      u.vx = Math.cos(u.angle) * spd * 0.35;
      u.vy = Math.sin(u.angle) * spd * 0.35;
      u.aiState = "SEEK WATER";
      return;
    }
    const react = boatReaction(u, h, vision);
    const sprint = sp.boatReact?.sprint ?? BOAT_SPRINT;
    if (react === "retreat") {
      const f = this.s.nav.fleePoint(u, h.x, h.y, WATER_MODE, dt);
      u.aiTx = f.x;
      u.aiTy = f.y;
      spd *= sprint;
    } else if (react === "pursue") {
      u.aiTx = h.x;
      u.aiTy = h.y;
      if (dist > BOAT_STANDOFF) spd *= sprint;
    } else if (u.reacting || u.aiTx == null || u.aiTy == null || Math.hypot(u.aiTx - u.x, u.aiTy - u.y) < 40) {
      // Back to patrol (or the last leg is done): a fresh waypoint, not the threat's last position.
      this.s.nav.pickWaterWaypoint(u);
    }
    u.reacting = !!react;
    const r = this.s.nav.route(u, u.aiTx ?? u.x, u.aiTy ?? u.y, WATER_MODE, dt);
    const steered = this.s.nav.repel(u, r.x, r.y, WATER_MODE);
    const want = Math.atan2(steered.y - u.y, steered.x - u.x);
    u.angle = steerUnitAngle(u.angle, want, yaw, dt);
    const step = spd * dt;
    stepOnTerrain(this.s.world, u, Math.cos(u.angle) * step, Math.sin(u.angle) * step, true);
    u.vx = Math.cos(u.angle) * spd;
    u.vy = Math.sin(u.angle) * spd;
    u.aiState = react === "retreat" ? "RETREAT" : react === "pursue" ? "PURSUE" : "PATROL";
  }

  driveGroundVehicle(u: Unit, dt: number, h: Craft, dist: number, vision = 1): void {
    const d = driveOf(u.kind);
    const sp = specOf(u.kind);
    const combat = sp.behavior === "orbit_attack_vehicle";
    let drive = false;
    let wantX = u.x;
    let wantY = u.y;
    if (combat) {
      if (vision > 0 && dist < this.s.targeting.enemyScaledReach(REACT_VEHICLE, vision, h) && h.phase === "flight") {
        u.orbit += 0.24 * dt;
        const ring = 350 + (u.id % 5) * 28;
        // Chase a lead point on the ring so we rarely sit on the waypoint
        // (atan2 thrash there looks like instant hull snaps).
        const lead = u.orbit + 0.55;
        wantX = h.x + Math.cos(lead) * ring;
        wantY = h.y + Math.sin(lead) * ring;
        drive = true;
        u.aiState = "ORBIT";
        u.aiTx = wantX;
        u.aiTy = wantY;
      } else {
        u.aiState = "IDLE";
        u.aiTx = undefined;
        u.aiTy = undefined;
      }
    } else if (
      dist < this.s.targeting.enemyScaledReach(sp.fleeReactRange ?? REACT_FLEE, vision, h) &&
      h.phase === "flight"
    ) {
      if (vision > 0) {
        u.reacting = true;
        const flee = this.s.nav.fleePoint(u, h.x, h.y, this.s.nav.modeOf(u), dt);
        wantX = flee.x;
        wantY = flee.y;
        drive = true;
        u.aiState = "FLEE";
        u.aiTx = wantX;
        u.aiTy = wantY;
      } else {
        u.reacting = false;
        u.aiState = Math.hypot(u.vx, u.vy) > 8 ? "COAST" : "IDLE";
        u.aiTx = undefined;
        u.aiTy = undefined;
      }
    } else {
      u.reacting = false;
      u.aiState = Math.hypot(u.vx, u.vy) > 8 ? "COAST" : "IDLE";
      u.aiTx = undefined;
      u.aiTy = undefined;
    }
    if (drive) {
      const r = this.s.nav.route(u, wantX, wantY, this.s.nav.modeOf(u), dt);
      wantX = r.x;
      wantY = r.y;
    } else if (u.route) u.route.path.length = 0;
    const wantSteer = this.steerGround(u, wantX, wantY);
    wantX = wantSteer.x;
    wantY = wantSteer.y;
    const twx = wantX - u.x;
    const twy = wantY - u.y;
    const twd = Math.hypot(twx, twy);
    const spd = Math.hypot(u.vx, u.vy);
    let want: number;
    if (twd < 42) {
      // Near chase point: don't use noisy atan2(ε,ε) — that flips want and snaps hull.
      if (combat && drive) want = Math.atan2(u.y - h.y, u.x - h.x) + Math.PI / 2;
      else if (spd > 6) want = Math.atan2(u.vy, u.vx);
      else want = u.angle;
    } else {
      want = Math.atan2(twy, twx);
    }
    const slow = 1 - Math.min(1, spd / Math.max(d.maxSpd, 1));
    const wheeled = !turnsInPlace(u);
    // Wheeled: need forward speed to yaw (car-like). Default higher than old 7 so
    // trucks don't spin on a crawl. Motorcycle sets minTurnSpd explicitly.
    const minTurnSpd = sp.minTurnSpd ?? 14;
    const jammed = this.groundUnitBlocked(u);
    if (jammed && drive) this.s.nav.noteJam(u, dt);
    // Jam recovery (shared nav): wheeled hulls back out, rear swinging toward open ground; treads pivot toward it.
    const recovering = drive && this.s.nav.stuck(u);
    const backing = recovering && wheeled;
    const turnDt = Math.min(dt, 1 / 20);
    if (backing) {
      const turnGate = Phaser.Math.Clamp(spd / (minTurnSpd + 10), 0.3, 1);
      u.angle = steerUnitAngle(u.angle, want + Math.PI, d.turn * turnGate, turnDt);
    } else if (drive) {
      if (!wheeled) {
        // Treads: pivot OK; slightly snappier when slow.
        u.angle = steerUnitAngle(
          u.angle,
          want,
          d.turn * (0.45 + 0.55 * slow),
          turnDt
        );
      } else if (spd > minTurnSpd) {
        // Turning radius feel: yaw rate scales with speed (ω ∝ v), never while stopped.
        const turnGate = Phaser.Math.Clamp(spd / Math.max(d.maxSpd * 0.55, minTurnSpd + 10), 0, 1);
        u.angle = steerUnitAngle(u.angle, want, d.turn * turnGate, turnDt);
      }
    }
    if (!wheeled && (jammed || recovering) && spd < 18) {
      u.vx += Math.cos(want) * 50 * dt;
      u.vy += Math.sin(want) * 50 * dt;
    }
    const nx = Math.cos(u.angle);
    const ny = Math.sin(u.angle);
    const align = drive ? Math.cos(Phaser.Math.Angle.Wrap(want - u.angle)) : 1;
    let a = -d.brake;
    if (backing) a = -d.accel;
    else if (drive && wheeled && spd <= minTurnSpd) a = d.accel;
    else if (drive && align > 0.2) a = d.accel * Phaser.Math.Clamp(align, 0.25, 1);
    else if (drive) a = -d.brake * 0.65;
    let vx = u.vx + nx * a * dt;
    let vy = u.vy + ny * a * dt;
    let fwd = vx * nx + vy * ny;
    // Brakes don't roll a hull backward; only a recovery reverse does.
    if (backing) fwd = Math.max(fwd, -d.maxSpd * BACKUP_SPEED);
    else if (fwd < 0) fwd *= 0.35;
    vx = nx * fwd;
    vy = ny * fwd;
    const s = Math.hypot(vx, vy);
    if (s > d.maxSpd) {
      vx *= d.maxSpd / s;
      vy *= d.maxSpd / s;
    }
    u.vx = vx;
    u.vy = vy;
    const trackX0 = u.x;
    const trackY0 = u.y;
    stepOnTerrain(this.s.world, u, vx * dt, vy * dt, false, this.s.nav.onDeck, groundHull(u));
    this.separateGround(u);
    const step = Math.hypot(u.vx, u.vy) * dt;
    if (Math.hypot(u.vx, u.vy) > 6 && !isWater(this.s.world, u.x, u.y)) {
      const printGap = d.trackGap * 0.8;
      const first = printGap - u.track;
      for (let dist = first; dist <= step; dist += printGap) {
        const t = step > 0 ? Phaser.Math.Clamp(dist / step, 0, 1) : 1;
        const key = `fx_track_${d.track}`;
        const back = specOf(u.kind).radius * 0.72;
        const px = Phaser.Math.Linear(trackX0, u.x, t) - Math.cos(u.angle) * back;
        const py = Phaser.Math.Linear(trackY0, u.y, t) - Math.sin(u.angle) * back;
        this.s.groundMarks.stampWreck(
          this.s.textures.exists(key) ? key : "fx_track_mono",
          px,
          py,
          u.angle + Math.PI / 2,
          d.trackScale * 0.85,
          trackPrintAlpha(0.7, px, py)
        );
      }
      u.track = (u.track + step) % printGap;
    }
  }

  /**
   * Wounded troops bleed toward death past the downed floor. HV troops never bleed out;
   * others only expire once off screen. Returns true if the unit died.
   */
  tickBleedOut(u: Unit, dt: number): boolean {
    const rate = u.health <= 1 ? 0.028 : 0.05;
    u.health -= u.max * rate * dt;
    if (u.hv) {
      u.health = Math.max(u.health, 0.5);
      return false;
    }
    if (u.health > 0) return false;
    const at = worldToScreen(u.x, u.y, u.z);
    if (cameraPointVisible(u.z, u.y) && this.s.camera.projectedInView(at.x, at.y, 24)) {
      u.health = 0.01;
      return false;
    }
    this.s.destruction.destroyUnit(u, true);
    return true;
  }

  /**
   * No AI: no drive, turn, turret track, or fire. Existing velocity / spin coasts with friction.
   */
  tickStunnedUnit(u: Unit, dt: number): void {
    tickStunKinematics(u, dt);
    if (!gunsOf(u).length) u.fireCd -= dt; // turrets keep their own cooldowns
    u.muzzleT = Math.max(0, u.muzzleT - dt);
    const sp = specOf(u.kind);
    if (sp.dish) u.rotor += 0.55 * dt;
    if (sp.rotors.length) u.rotor += (sp.rotorSpinRate ?? 28) * dt;
    if (sp.organic && u.health < u.max && this.tickBleedOut(u, dt)) return;
    if ((sp.behavior === "orbit_attack_heli" || sp.behavior === "kite_attack_heli") || sp.behavior === "suicide_attack_heli") {
      u.x += u.vx * dt;
      u.y += u.vy * dt;
    } else if (sp.behavior === "patrol_boat") {
      stepOnTerrain(this.s.world, u, u.vx * dt, u.vy * dt, true);
      u.z = groundZ(this.s.world, u.x, u.y);
    } else if (isGroundVehicle(u.kind) || sp.behavior === "attack_infantry" || sp.behavior === "flee_infantry") {
      stepOnTerrain(this.s.world, u, u.vx * dt, u.vy * dt, false, this.s.nav.onDeck, groundHull(u));
      this.separateGround(u);
      u.z = this.s.nav.surfaceZ(u.x, u.y);
      if (this.drownIfDeep(u)) return;
    }
    containOnMap(u, dt);
    this.tickStunZapFx(u, dt);
    u.aiState = "STUN";
  }

  /** Periodic zap stamps on a stunned hull — same overlay language as Tesla / EMP. */
  tickStunZapFx(u: Unit, dt: number): void {
    if (!cameraPointVisible(u.z, u.y)) return;
    if (u.stunZapT == null) u.stunZapT = (u.id % 11) * 0.028;
    u.stunZapT -= dt;
    if (u.stunZapT > 0) return;
    u.stunZapT = 0.11 + Math.random() * 0.2;
    this.spawnStunZaps(u);
  }

  spawnStunZaps(u: Unit): void {
    const r = radius(u.kind);
    const hgt = heightOf(u.kind);
    const sc = Phaser.Math.Clamp(r / 26, 0.42, 1.35);
    const n = Math.random() < 0.38 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.sqrt(Math.random()) * r * 0.78;
      this.s.tesla.spawnZap(
        u.x + Math.cos(a) * d,
        u.y + Math.sin(a) * d,
        u.z + hgt * (0.12 + Math.random() * 0.8),
        sc * range(0.48, 1.02),
        range(1.3, 2.2)
      );
    }
    if (Math.random() < 0.3) {
      this.s.tesla.emitSparks(u.x, u.y, u.z + hgt * 0.45, 3, 0.26 * sc);
    }
  }

  /** Roadkill (rotor strike / crush) is a player-side mechanic — the player's craft and its remotes, never enemies. */
  tickRoadkill(): void {
    const h = this.s.player;
    if (h.phase === "flight") this.roadkillCraft(h.x, h.y, h.z, h.vx, h.vy, h.angle, h.spec, 1, this.s.stats.hostCredit(ROTOR_KILL));
    for (const r of this.s.remotes) {
      if (r.detonate || r.dock || r.airborne || !r.spec.craftLook) continue;
      this.roadkillCraft(r.x, r.y, r.z, r.vx, r.vy, r.angle, r.spec, r.spec.scale, this.s.stats.remoteCredit(r, ROTOR_KILL));
    }
  }

  roadkillCraft(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    angle: number,
    spec: CraftSpec,
    drawScale: number,
    by: StatBy
  ): void {
    const crush = !!spec.crushesInfantry;
    if (crush) {
      const hullR = Math.max(spec.radius, spriteHalf(this.s.textures, spec.body) * drawScale * 0.72);
      const spd = Math.hypot(vx, vy);
      if (spd > 32) this.roadkillSweep(x, y, z, vx, vy, hullR, spec.cruiseAgl + 8, this.s.stats.credit(by.craft, by.control, CRUSH_KILL));
    }
    const discs = craftRotorDiscs(this.s.textures, spec, x, y, angle, drawScale);
    for (let i = 0; i < discs; i++) {
      const d = rotorDiscs[i]!;
      this.roadkillBlades(d.x, d.y, z, vx, vy, spec.height, d.r, by);
    }
  }

  /** Disc strikes when the hub is within reach of a standing troop. */
  roadkillBlades(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    hullHeight: number,
    discR: number,
    by: StatBy
  ): void {
    const reachBelowHub = 20;
    const nearby = this.s.spatial.near(x, y, discR);
    for (let qi = 0; qi < nearby.n; qi++) {
      const u = nearby.at(qi);
      if (u.dead || !isInfantry(u.kind)) continue;
      const sp = specOf(u.kind);
      const agl = z - groundZ(this.s.world, u.x, u.y);
      if (agl + hullHeight > sp.height + reachBelowHub) continue;
      if (Math.hypot(u.x - x, u.y - y) > discR + sp.radius) continue;
      this.roadkillTroop(u, vx, vy, by);
    }
    nearby.done();
  }

  /** Hull sweep. `maxAgl` is the highest belly altitude that still runs troops over. */
  roadkillSweep(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    hullR: number,
    maxAgl: number,
    by: StatBy
  ): void {
    const nearby = this.s.spatial.near(x, y, hullR);
    for (let qi = 0; qi < nearby.n; qi++) {
      const u = nearby.at(qi);
      if (u.dead || !isInfantry(u.kind)) continue;
      const sp = specOf(u.kind);
      const agl = z - groundZ(this.s.world, u.x, u.y);
      if (agl > maxAgl) continue;
      if (Math.hypot(u.x - x, u.y - y) > hullR + sp.radius) continue;
      this.roadkillTroop(u, vx, vy, by);
    }
    nearby.done();
  }

  roadkillTroop(u: Unit, vx: number, vy: number, by: StatBy): void {
    u.killDx = vx;
    u.killDy = vy;
    u.killDz = 80;
    u.killDmg = u.max;
    this.s.projectiles.hurt(u, u.health + 1, false, by);
  }

  updateUnits(dt: number): void {
    this.tickRoadkill();
    this.s.nav.beginFrame();
    this.s.spatial.sync();
    const units = this.s.units;
    const lod = this.s.unitLod;
    lod.prepare(units.length);
    for (let i = 0; i < units.length; i++) {
      const u = units[i]!;
      const udt = lod.step(i, u, dt);
      if (udt == null) continue;
      this.cur = i;
      this.updateUnit(u, udt);
      this.s.spatial.moved(i, u);
    }
    this.cur = -1;
    this.s.spatial.sync();
    if (this.s.perf.enabled) {
      const t = performance.now();
      this.s.unitSprites.sync();
      this.s.perf.current![4] = performance.now() - t;
    } else {
      this.s.unitSprites.sync();
    }
  }

  private updateUnit(u: Unit, dt: number): void {
    const prevTurrets = PREV_TURRETS;
    if (u.dead || isNeutral(u.kind)) return;
    u.paintT = undefined;
    const prevAngle = u.angle;
    const prevTurret = u.turret;
    prevTurrets.length = u.turrets.length;
    for (let i = 0; i < u.turrets.length; i++) prevTurrets[i] = u.turrets[i]!;
    if (unitStunned(u)) {
      this.tickStunnedUnit(u, dt);
      if (!u.dead) recordUnitSpin(u, prevAngle, prevTurret, prevTurrets, dt);
      return;
    }
    if (!gunsOf(u).length) u.fireCd -= dt; // turrets keep their own cooldowns
    // AA platforms are blind to dirt HOUND — chase/aim the host instead.
    const h = this.s.targeting.unitCombatFocus(u);
    const aimMul = h.spec.enemyAimMul ?? 1;
    const dx = h.x - u.x;
    const dy = h.y - u.y;
    const dist = Math.hypot(dx, dy);
    // Cloak: complete sensor blackout. Smoke: blinds all enemies when the player is covered.
    // Max sight range, then terrain line of sight, gate vision entirely: no sight, no pursuit / aim / fire.
    const vision = this.s.targeting.visionOf(u, h);
    if (this.s.countermeasures.cloakT > 0 && h === this.s.player && (u.reacting || u.aiMood || u.aiTx != null)) {
      u.reacting = false;
      u.aiMood = undefined;
      u.moodT = 0;
      u.aiTx = undefined;
      u.aiTy = undefined;
      u.burstLeft = 0;
    }
    const sp = specOf(u.kind);
    u.muzzleT = Math.max(0, u.muzzleT - dt);
    if (sp.dish) u.rotor += 0.55 * dt;
    if (sp.rotors.length) u.rotor += (sp.rotorSpinRate ?? 28) * dt;
    if (
      sp.behavior === "orbit_attack_heli" ||
      sp.behavior === "kite_attack_heli" ||
      sp.behavior === "suicide_attack_heli"
    ) {
      if (sp.behavior === "suicide_attack_heli") this.driveDrone(u, dt, h, dist, dx, dy, vision);
      else if (sp.behavior === "kite_attack_heli") this.driveScoutHeli(u, dt, h, dist, dx, dy, vision);
      else this.driveOrbitHeli(u, dt, h, dist, dx, dy, vision);
      if (u.dead) return;
      const g = groundZ(this.s.world, u.x, u.y);
      if ((sp.behavior === "orbit_attack_heli" || sp.behavior === "kite_attack_heli")) {
        // Slow climb/descend toward the player's AGL (terrain-relative).
        const playerAgl = Math.max(LOW_AGL + 8, h.z - h.gndSmooth);
        u.bobT = (u.bobT ?? u.id) + dt;
        const bob = Math.sin(u.bobT * 2) * 4;
        const wantZ = g + playerAgl + bob;
        const err = wantZ - u.z;
        const thrust = Phaser.Math.Clamp(err * 0.9, -38, 38);
        u.vz = (u.vz ?? 0) + thrust * dt;
        u.vz *= Math.pow(0.32, dt);
        u.vz = Phaser.Math.Clamp(u.vz, -52, 52);
        u.z += u.vz * dt;
        const minZ = g + LOW_AGL + 6;
        const maxZ = g + Math.max(MAX_AGL, playerAgl + 24);
        if (u.z < minZ) {
          u.z = minZ;
          if (u.vz < 0) u.vz *= 0.15;
        } else if (u.z > maxZ) {
          u.z = maxZ;
          if (u.vz > 0) u.vz *= 0.15;
        }
      } else if (sp.behavior === "suicide_attack_heli") {
        // Climb toward player only when within kamikaze AGL; otherwise loiter at cruise.
        const playerAgl = Math.max(LOW_AGL + 8, h.z - h.gndSmooth);
        const kamikazeCeil = DRONE_KAMIKAZE_AGL;
        u.bobT = (u.bobT ?? u.id) + dt;
        const bob = Math.sin(u.bobT * 2) * 5;
        if (playerAgl > kamikazeCeil) {
          const cruise = g + CRUISE_AGL + 10 + bob;
          u.z = Phaser.Math.Linear(u.z, cruise, 1 - Math.pow(0.12, dt));
          u.vz = (u.vz ?? 0) * Math.pow(0.25, dt);
        } else {
          const wantZ = g + playerAgl + bob;
          const charging = u.aiState === "CHARGE";
          const closeXy = dist < 220;
          const climbMul = charging ? (closeXy ? 2.4 : 1.55) : 0.95;
          const err = wantZ - u.z;
          const thrust = Phaser.Math.Clamp(
            err * climbMul,
            charging ? -90 : -42,
            charging ? 110 : 48
          );
          u.vz = (u.vz ?? 0) + thrust * dt;
          u.vz *= Math.pow(charging ? 0.28 : 0.35, dt);
          u.vz = Phaser.Math.Clamp(u.vz, charging ? -95 : -55, charging ? 120 : 58);
          u.z += u.vz * dt;
          const minZ = g + LOW_AGL + 6;
          const maxZ = g + kamikazeCeil + 16;
          if (u.z < minZ) {
            u.z = minZ;
            if (u.vz < 0) u.vz *= 0.15;
          } else if (u.z > maxZ) {
            u.z = maxZ;
            if (u.vz > 0) u.vz *= 0.15;
          }
        }
      } else {
        const cruise = g + CRUISE_AGL + 10 + Math.sin(this.s.time.now * 0.002 + u.id) * 6;
        u.z = Phaser.Math.Linear(u.z, cruise, 1 - Math.pow(0.1, dt));
      }
    } else {
      if (sp.behavior === "patrol_boat") this.driveBoat(u, dt, h, dist, vision);
      if (isGroundVehicle(u.kind)) {
        this.driveGroundVehicle(u, dt, h, dist, vision);
      }
      if ((sp.behavior === "attack_infantry" || sp.behavior === "flee_infantry") && !this.s.unitSprites.snapHost(u)) {
        const canShoot = !!sp.weapon;
        if (sp.organic && u.health < u.max && this.tickBleedOut(u, dt)) return;
        const reactR = this.s.targeting.enemyScaledReach(REACT_INFANTRY, vision, h);
        const screenR = this.s.scale.width / Math.max(this.s.cameras.main.zoom, 0.001);
        const wounded = u.health < u.max;
        const downed = sp.organic && wounded && u.health <= 1;
        if (downed) u.aiMood = undefined;
        else if (wounded && u.aiMood !== "flee") rollSoldierMood(u, true);
        else if (sp.behavior === "flee_infantry" && !u.reacting && dist < reactR && h.phase === "flight") {
          if (vision > 0) {
            u.reacting = true;
            u.aiMood = "flee";
            u.moodT = 4;
          }
        }
        if (!u.reacting && dist < reactR && dist > 36 && h.phase === "flight") {
          if (vision > 0) {
            u.reacting = true;
            rollSoldierMood(u, wounded || !canShoot || Math.random() < 0.4);
          }
        }
        if (u.aiMood) {
          u.moodT = (u.moodT ?? 0) - dt;
          if ((u.moodT ?? 0) <= 0) {
            if (wounded || (dist < reactR && dist > 36)) rollSoldierMood(u, wounded || !canShoot || u.aiMood === "kite");
            else {
              u.reacting = false;
              u.aiMood = undefined;
            }
          }
        } else if (!wounded && (dist >= reactR || dist <= 36)) {
          u.reacting = false;
        }
        const fleeing = !downed && u.aiMood === "flee";
        const kiting = canShoot && !downed && u.aiMood === "kite" && dist < reactR && dist > 36;
        if (downed) {
          u.vx = 0;
          u.vy = 0;
          if (vision > 0) {
            u.turret = steerUnitAngle(u.turret, Math.atan2(dy, dx), 1.8 * aimMul, dt);
            u.aiTx = h.x;
            u.aiTy = h.y;
          } else {
            u.aiTx = undefined;
            u.aiTy = undefined;
          }
          u.aiState = (u.burstLeft ?? 0) > 0 ? "BURST" : "DOWN";
          if (u.track < -8) u.track = 0;
          u.track += dt;
          if (u.track > 0) {
            this.s.groundMarks.stampSoldierBlood(u, range(-4.5, 4.5), range(-4.5, 4.5), range(0, Math.PI * 2));
            u.track = -range(1.5, 3.4);
          }
        } else if ((fleeing || kiting) && vision > 0) {
          u.orbit += (fleeing ? 0.35 : 0.55) * dt;
          const away = Math.atan2(-dy, -dx);
          const ring = fleeing ? screenR : 250;
          const weave = fleeing ? 0.35 : 0.7;
          let ox = h.x + Math.cos(away + Math.sin(u.orbit) * weave) * ring;
          let oy = h.y + Math.sin(away + Math.sin(u.orbit) * weave) * ring;
          if (fleeing) {
            const f = this.s.nav.fleePoint(u, h.x, h.y, this.s.nav.modeOf(u), dt);
            ox = f.x;
            oy = f.y;
          }
          const r = this.s.nav.route(u, ox, oy, this.s.nav.modeOf(u), dt);
          const steered = this.steerGround(u, r.x, r.y);
          const twx = steered.x - u.x;
          const twy = steered.y - u.y;
          const twd = Math.hypot(twx, twy);
          const want = twd < 12 ? u.angle : Math.atan2(twy, twx);
          // Invisible base faces / walks the path.
          u.angle = steerUnitAngle(
            u.angle,
            want,
            fleeing ? 2.4 : 2.1,
            dt
          );
          const limp = fleeing && wounded && sp.organic;
          const gaitHz = limp ? 0.0044 : fleeing ? 0.0128 : 0.0075;
          const walk = Math.sin(this.s.time.now * gaitHz + u.id * 2.1);
          const gait = 0.22 + 0.78 * Math.pow(0.5 + 0.5 * walk, 1.45);
          const base =
            sp.behavior === "flee_infantry" && !sp.organic
              ? (sp.fleeRunSpeed ?? 90)
              : fleeing
                ? 78
                : 58;
          const align = Math.max(0.15, Math.cos(Phaser.Math.Angle.Wrap(want - u.angle)));
          const step = (limp ? 22 : base) * gait * align * dt;
          u.vx = Math.cos(u.angle) * (step / Math.max(dt, 1e-6));
          u.vy = Math.sin(u.angle) * (step / Math.max(dt, 1e-6));
          stepOnTerrain(this.s.world, u, Math.cos(u.angle) * step, Math.sin(u.angle) * step, false, this.s.nav.onDeck, groundHull(u));
          this.separateGround(u);
          if (limp) {
            u.track += step;
            if (u.track > 0) {
              const side = walk > 0 ? 1 : -1;
              const px = -Math.sin(u.angle);
              const py = Math.cos(u.angle);
              this.s.groundMarks.stampSoldierBlood(
                u,
                px * range(2.2, 5.5) * side,
                py * range(2.2, 5.5) * side,
                u.angle + range(-0.35, 0.35)
              );
              u.track = -range(22, 48);
            }
          }
          u.aiState = fleeing ? "FLEE" : (u.burstLeft ?? 0) > 0 ? "BURST" : "KITE";
          u.aiTx = ox;
          u.aiTy = oy;
        } else {
          u.vx = 0;
          u.vy = 0;
          u.aiState = (u.burstLeft ?? 0) > 0 ? "BURST" : "IDLE";
          u.aiTx = undefined;
          u.aiTy = undefined;
        }
      }
      this.leashPinned(u);
      // Boats ride the water surface; land units stand on the bed (wading shallows).
      u.z = sp.water ? groundZ(this.s.world, u.x, u.y) : this.s.nav.surfaceZ(u.x, u.y);
      if (this.drownIfDeep(u)) return;
    }
    containOnMap(u, dt);
    const guns = gunsOf(u);
    // Unit-level weapon / target are fixed-mount only; turret units target per turret below.
    const wpn = guns.length ? undefined : sp.weapon;
    const aaWpn = enemyWeaponIsAa(wpn);
    // The fixed weapon's own pick (it may not reach the unit's focus); nothing reachable → aim at the focus, hold fire.
    const wpnTgt = wpn ? this.s.targeting.targetForWeapon(u, wpn, h) : h;
    const aimTgt = wpnTgt ?? h;
    const wpnVision = !wpnTgt ? 0 : wpnTgt === h ? vision : this.s.targeting.visionOf(u, wpnTgt);
    const aimDx = aimTgt.x - u.x;
    const aimDy = aimTgt.y - u.y;
    const aimDist = Math.hypot(aimDx, aimDy);
    const aim = Math.atan2(aimDy, aimDx);
    const atkRange = (wpn?.range ?? 0) * wpnVision;
    const elev = aimTgt.z - u.z;
    // Elevation lob limit: troops stay low; tanks can reach jet cruise; dedicated
    // AA / seekers go higher. Reaper-class cruise (~620) sits above tank/building HE;
    // enemy drones stay low and cannot lob/kamikaze to it — helis can climb.
    const elevCeilFor = (aa: boolean) =>
      sp.aerial
        ? sp.behavior === "suicide_attack_heli"
          ? DRONE_KAMIKAZE_AGL
          : 1e9
        : aa
          ? 720
          : sp.building
            ? 560
            : isGroundVehicle(u.kind)
              ? 360
              : 130;
    const inRange = !!(
      wpnTgt &&
      atkRange &&
      aimDist < atkRange &&
      aimDist > 40 &&
      aimTgt.phase === "flight" &&
      elev < elevCeilFor(aaWpn)
    );
    const hullFlee =
      (sp.behavior === "attack_infantry" && u.aiMood === "flee" && !(sp.organic && u.health <= 1) && !this.s.unitSprites.snapHost(u)) ||
      (sp.behavior === "kite_attack_heli" && u.aiMood === "flee");
    const strafeHeli =
      (sp.behavior === "orbit_attack_heli" || sp.behavior === "kite_attack_heli") &&
      sp.strafeAim !== false;
    const softTurret = troopSoftTurret(u);
    if (softTurret) {
      // Aim like a turret: track player when engaging, otherwise point where the base is going.
      const aimTo =
        wpnVision > 0 && !hullFlee && (inRange || (u.burstLeft ?? 0) > 0 || (sp.organic && u.health <= 1 && u.health < u.max))
          ? aim
          : u.angle;
      u.turret = steerUnitAngle(u.turret, aimTo, 2.4 * aimMul * Math.max(0.12, wpnVision), dt);
    } else if (sp.fixedAim && !guns.length && wpn && inRange && !hullFlee && !strafeHeli) {
      const turn = (sp.behavior === "orbit_attack_heli" || sp.behavior === "kite_attack_heli") ? 1.7 : 2.2;
      u.angle = steerUnitAngle(u.angle, aim, turn * aimMul * Math.max(0.12, wpnVision), dt);
    }
    const inf = sp.behavior === "attack_infantry";
    const soldierDown = inf && u.health <= 1 && u.health < u.max;
    const continueBurst =
      inf && (u.burstLeft ?? 0) > 0 && aimTgt.phase === "flight" && (soldierDown || u.aiMood !== "flee");
    const soldierFlee = inf && u.aiMood === "flee" && !soldierDown && !this.s.unitSprites.snapHost(u);
    const scoutFlee = sp.behavior === "kite_attack_heli" && u.aiMood === "flee";
    if (vision <= 0 && u.reacting) {
      u.reacting = false;
      if (u.aiMood === "kite") u.aiMood = undefined;
    }
    // Target actually engaged this frame — drives static units' ENGAGE state / lead aim.
    let engagedTgt: Craft | undefined;
    if (guns.length) {
      // Turret units: every gun part targets, aims, locks and fires independently.
      engagedTgt = this.s.enemyFire.tickEnemyTurretFire(u, h, dt, vision, aimMul, soldierFlee || scoutFlee, elevCeilFor);
    } else {
      if (inRange) engagedTgt = aimTgt;
      // Fixed mounts (hull muzzles / troops): one weapon; muzzleFire picks alternate / simultaneous tips.
      const gunAim = Math.atan2(aimTgt.y - u.y, aimTgt.x - u.x);
      const barrelAng = softTurret ? u.turret : u.angle;
      const facingOk = Math.abs(Phaser.Math.Angle.Wrap(gunAim - barrelAng)) < 0.16;
      // Aim precision: jitter narrows the longer this unit has been continuously tracking its
      // target (reset the moment it stops engaging) — harder-to-spot target craft (enemyAwareMul)
      // narrow slower. Seeker weapons instead gate on a separate lock-on hold below.
      const engaging = !!wpn && !soldierFlee && !scoutFlee && wpnVision > 0 && (inRange || continueBurst);
      u.aimHoldT = advanceAimHold(u.aimHoldT ?? 0, dt, engaging);
      const isSeekerWpn = wpn?.kind === "lock-on-missile";
      if (isSeekerWpn) {
        const tracking = engaging && facingOk;
        u.lockT = tracking ? (u.lockT ?? 0) + dt : 0;
        const lockReq = lockAcquireTime(AI_LOCK_BASE, aimTgt.spec.enemySeekerMul ?? 1);
        u.debugLockT = tracking ? holdProgress(u.lockT, lockReq) : undefined;
        if (tracking && this.s.targeting.hudThreatTarget(aimTgt)) {
          u.paintT = holdProgress(u.lockT, lockReq);
          u.paintHost = aimTgt === this.s.player;
          u.paintTorpedo = weaponUnderwater(wpn!);
        }
      } else {
        u.debugLockT = undefined;
      }
      if (engaging && !isSeekerWpn && wpn) {
        const narrowT = aimNarrowTime(AI_AIM_NARROW_BASE, this.s.targeting.targetAwareMul(aimTgt));
        u.debugAimT = holdProgress(u.aimHoldT, narrowT);
        u.debugAimSpreadRad = aimPrecisionSpread(u.aimHoldT, narrowT, (wpn.jitter ?? 0) * AI_AIM_WIDE_MUL, wpn.jitter ?? 0);
      } else {
        u.debugAimT = undefined;
        u.debugAimSpreadRad = undefined;
      }
      const lockReady =
        !isSeekerWpn || (u.lockT ?? 0) >= lockAcquireTime(AI_LOCK_BASE, aimTgt.spec.enemySeekerMul ?? 1);
      if (wpn && u.fireCd <= 0 && !soldierFlee && !scoutFlee && facingOk && wpnVision > 0 && (inRange || continueBurst) && lockReady) {
        const burstN = wpn.burst ?? 0;
        const fxInterval = burstN > 0 ? (wpn.burstGap ?? 0.075) : wpn.fireCd;
        if (burstN) {
          if (!u.burstLeft) u.burstLeft = burstN;
          u.burstLeft--;
          u.fireCd = u.burstLeft > 0 ? (wpn.burstGap ?? 0.075) : wpn.fireCd;
        } else {
          u.fireCd = wpn.fireCd;
        }
        if (isSeekerWpn) u.lockT = 0; // fire-and-forget — re-acquire lock for the next shot.
        const tipCount = lookupSpriteMuzzles(textureOf(u.kind)).length || 1;
        const simultaneous = wpn.muzzleFire === "simultaneous" && tipCount > 1;
        const tipI = wpn.muzzleFire === "alternate" ? u.muzzleTip % tipCount : 0;
        const fireTips = simultaneous ? Array.from({ length: tipCount }, (_, i) => i) : [tipI];
        u.muzzleTip = tipCount > 1 && wpn.muzzleFire === "alternate" ? (tipI + 1) % tipCount : tipI;
        for (const tip of fireTips) {
          this.s.enemyFire.fireEnemyRound(u, wpn, 0, tip, barrelAng, aimTgt, u.aimHoldT ?? 0, fxInterval, simultaneous && tip !== tipI);
        }
        noteEnemyVolley(u, (u.burstLeft ?? 0) <= 0);
      }
    }
    if (sp.building || sp.behavior === "static_hold") {
      u.aiState = engagedTgt ? "ENGAGE" : u.aiState ?? "IDLE";
      if (engagedTgt) {
        u.aiTx = engagedTgt.x + engagedTgt.vx * 0.15;
        u.aiTy = engagedTgt.y + engagedTgt.vy * 0.15;
      }
    }
    const sec = sp.secondary;
    // The secondary's own pick: seekers take the host over a dirt-locked focus, torpedoes a submerged remote.
    const secTgt = sec ? this.s.targeting.targetForWeapon(u, sec.wpn, h) : undefined;
    // Its own target's visibility (it may not be the unit's focus).
    const secVision = !secTgt ? 0 : secTgt === h ? vision : this.s.targeting.visionOf(u, secTgt);
    const secDx = secTgt ? secTgt.x - u.x : 0;
    const secDy = secTgt ? secTgt.y - u.y : 0;
    const secDist = Math.hypot(secDx, secDy);
    if (sec?.mounts.length && secTgt && (!sp.aerial || secTgt.phase === "flight")) {
      const pw = sec.wpn;
      const minR = sec.minRange ?? 80;
      const aimCone = sec.aimCone ?? Math.PI / 2;
      if (secVision > 0 && secDist < pw.range * secVision && secDist > minR) {
        const aimErr = Math.abs(Phaser.Math.Angle.Wrap(Math.atan2(secDy, secDx) - u.angle));
        const secTracking = aimErr < aimCone;
        u.secLockT = secTracking ? (u.secLockT ?? 0) + dt : 0;
        const secLockReq = lockAcquireTime(AI_LOCK_BASE, secTgt.spec.enemySeekerMul ?? 1);
        u.debugLockT = secTracking ? holdProgress(u.secLockT, secLockReq) : u.debugLockT;
        if (secTracking) {
          const p = holdProgress(u.secLockT, secLockReq);
          if (p >= (u.paintT ?? -1) && this.s.targeting.hudThreatTarget(secTgt)) {
            u.paintT = p;
            u.paintHost = secTgt === this.s.player;
            u.paintTorpedo = weaponUnderwater(sec.wpn);
          }
        }
        u.missileCd = (u.missileCd ?? (4 + Math.random() * 3)) - dt;
        if (u.missileCd <= 0 && secTracking && u.secLockT >= secLockReq) {
          u.missileCd = sec.fireCdMin + Math.random() * (sec.fireCdMax - sec.fireCdMin);
          u.secLockT = 0; // fire-and-forget — re-acquire lock for the next volley.
          const mounts = sec.mounts;
          const side = (u.missileSide ?? 0) % mounts.length;
          const firingMounts = sec.mountFire === "simultaneous" ? mounts : [mounts[side]!];
          const fxInterval =
            ((sec.fireCdMin + sec.fireCdMax) * 0.5) / Math.max(1, firingMounts.length);
          if (sec.mountFire === "alternate") u.missileSide = side + 1;
          const pivot = spritePivot(textureOf(u.kind));
          const hullRot = u.angle + sp.rotOff;
          const hullImg = this.s.textures.exists(textureOf(u.kind))
            ? (this.s.textures.get(textureOf(u.kind)).getSourceImage() as { width: number; height: number })
            : { width: 64, height: 64 };
          const dw = hullImg.width;
          const dh = hullImg.height;
          for (const mount of firingMounts) {
            const mx = (mount.x - pivot.x) * dw;
            const my = (mount.y - pivot.y) * dh;
            const px = u.x + mx * Math.cos(hullRot) - my * Math.sin(hullRot);
            const py = u.y + mx * Math.sin(hullRot) + my * Math.cos(hullRot);
            const muzzleZ = u.z + heightOf(u.kind) * 0.5;
            const jit = pw.jitter ?? 0.04;
            const torpedo = weaponUnderwater(pw);
            // Torpedoes leave the tube toward the target (they steer underwater); missiles off the hull heading.
            const fireAng = (torpedo ? Math.atan2(secDy, secDx) : u.angle) + (Math.random() - 0.5) * jit;
            const tgtZ = secTgt.z + secTgt.height * 0.5;
            const spawn = this.s.projectiles.shotSpawnXY(
              px,
              py,
              fireAng,
              muzzleZ,
              pw.look,
              pw.scale * (sec.scale ?? 1)
            );
            const leaveSpd = Math.max(70, pw.speed * 0.3);
            const missileT = Math.max(0.45, Math.hypot(secTgt.x - spawn.x, secTgt.y - spawn.y) / (pw.speed * 0.72));
            const home = sec.homePlayer !== false;
            this.s.projectiles.spawnShot({
              from: "enemy",
              srcKind: u.kind,
              srcWpn: enemyWeaponKey(pw),
              x: px,
              y: py,
              z: muzzleZ,
              vx: Math.cos(fireAng) * leaveSpd,
              vy: Math.sin(fireAng) * leaveSpd,
              vz: Phaser.Math.Clamp((tgtZ - muzzleZ) / missileT, -280, 420),
              angle: fireAng,
              life: missileT + 1.5,
              blast: pw.blast,
              dmg: pw.dmg,
              look: pw.look,
              homePlayer: home,
              homeRemoteId: home ? this.s.targeting.remoteOfCraft(secTgt)?.id : undefined,
              torpedo: torpedo || undefined,
              motor: sec.motor,
              cruise: pw.speed,
              scale: pw.scale * (sec.scale ?? 1),
              beh: enemyShotBeh(pw),
              fxInterval,
            });
            if (torpedo) this.s.ripples.splash(px, py, 16, 0.6);
            else this.s.fireControl.missileMuzzle(px, py, u.z, fireAng, projectileFxScale("enemy", fxInterval));
          }
        }
      } else {
        u.secLockT = 0;
      }
    } else {
      u.secLockT = 0;
    }
    recordUnitSpin(u, prevAngle, prevTurret, prevTurrets, dt);
  }

  rebuildUnitIdMap(): void {
    const map = this.unitIdMap;
    map.clear();
    for (const u of this.s.units) {
      if (!u.dead) map.set(u.id, u);
    }
  }

  unitById(id: number): Unit | undefined {
    const u = this.unitIdMap.get(id);
    return u && !u.dead ? u : undefined;
  }
}
