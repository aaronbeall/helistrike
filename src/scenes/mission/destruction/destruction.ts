import Phaser from "phaser";
import { debrisStampOrigin, debrisTrailLifeMul, softCapBlastCraterScale, wreckDrawScale } from "../../../render/fxCurves";
import { debrisMountAt, gunMountPos, mountAt, troopDrawAng } from "../../../render/spritePose";
import { bounceDebrisSlope, deathBurstImpulse } from "../../../sim/physics";
import { groundHull, onGroundHull } from "../../../sim/navigation";
import type { RemoteCraft } from "../../../sim/remote";
import { biasedDir } from "../../../util/vec";
import { range } from "../../../util/rng";
import { applyThermalHeat } from "../../../render/thermal";
import { resolveSkin } from "../../../render/camo";
import { debrisKeys, heightOf, hulkOf, radius, textureOf, wheelDebrisKeys, type Debris, type Unit } from "../../../sim/combat";
import { Layer, ZOff, Z_GRAVITY, worldDepth } from "../../../render/depth";
import { isGroundVehicle, hasSoftBlood, specOf, gunsOf } from "../../../sim/roster";
import { circumRadiusOf, footprintOf, randomInFootprint, type Footprint } from "../../../render/footprint";
import { craftGunSocketSlots, craftOrigin, craftRotorIsProp, craftRotorMounts, rotorDrawSpan, rotorMountsOf, rotorSpinSign, type CraftSpec } from "../../../sim/crafts";
import { themeOf, shallowTint } from "../../../worldgen/theme";
import { ensureSinkTexture, shadowKey, FX_VARIANTS, spritePivot } from "../../../art/sprites";
import { groundSlope, groundZ, worldToScreen, cameraPointVisible, screenVelX, screenVelY, projectHeading, castZ, isWater, isDeepWater, bedZ, screenToWorldAtZ, zScale } from "../../../worldgen/world";
import type { MissionScene } from "../../missionScene";
import { hulkBreakKeys } from "../../../art/hulkBreak";

/** Wrecks settled in shallow water: how far their tint leans to the theme's shallow-water colour. */
const SHALLOW_WRECK_MIX = 0.5;
/** Heli crash impact damage per unit of `impactDust` (hull size, ~0.32 drone … 0.72 heavy). */
const CRASH_DMG = 120;
/** Collapse deaths: dirt/bit throw speed and spark size, vs the full HE blast. */
const COLLAPSE_DIRT_SPEED = 0.5;
const COLLAPSE_SPARK_SCALE = 0.5;
/** Popped turrets / parts: spin magnitude range (rad/s) — always visibly tumbling. */
const POP_SPIN_MIN = 3.5;
const POP_SPIN_MAX = 8;
/** Popped roofs: slow but never still. */
const ROOF_SPIN_MIN = 0.5;
const ROOF_SPIN_MAX = 1.4;
/** Popped roofs: horizontal throw and upward pop speeds (vs turrets' 90–200 / 190–270). */
const ROOF_THROW_MIN = 25;
const ROOF_THROW_MAX = 70;
const ROOF_LOFT_MIN = 110;
const ROOF_LOFT_MAX = 170;

/** Random-direction toss velocity. */
function tossVel(min: number, max: number, loftMin: number, loftMax: number): { vx: number; vy: number; vz: number } {
  const a = Math.random() * Math.PI * 2;
  const spd = range(min, max);
  return { vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, vz: range(loftMin, loftMax) };
}

/** Random spin of magnitude [min, max] with a random sign. */
function spinBetween(min: number, max: number): number {
  return range(min, max) * (Math.random() < 0.5 ? -1 : 1);
}

/** Keep a bouncing piece's spin at or above its `minSpin`. */
function floorSpin(f: Debris): void {
  if (f.minSpin && Math.abs(f.spin) < f.minSpin) f.spin = (f.spin < 0 ? -1 : 1) * f.minSpin;
}

/** Casing bounces: keep fractions, smallest upward hop, and the speed below which they settle. */
const CASING_BOUNCE_KEEP_Z = 0.55;
const CASING_BOUNCE_KEEP_XY = 0.55;
const CASING_BOUNCE_MIN_HOP = 75;
const CASING_BOUNCE_MIN_SPD = 28;
/** Shot-down heli hulls: upward pop speed range (before DEBRIS_LOFT). */
const HELI_CRASH_LOFT_MIN = 140;
const HELI_CRASH_LOFT_MAX = 200;
/** Shot-down heli hulls fall at this fraction of normal gravity. */
const HELI_CRASH_GRAVITY = 0.5;
/** Upward launch speed × for gravity debris (constant Z_GRAVITY arcs). */
const DEBRIS_LOFT = 1.4;
/** Flame trail radius on a popped roof part. */
const ROOF_POP_TRAIL_R = 5;

/** Sinking debris spin kept per second (slow decay after the entry cut). */
const SINK_SPIN_DECAY = 0.7;

/** Generic debris touchdown bounce test (fast, steep impact with bounces left). */
function debrisWillBounce(f: Debris): boolean {
  return f.bounces > 0 && f.vz < -50 && Math.hypot(f.vx, f.vy, f.vz) > 120;
}

/** A wreck piece: art, world spot, draw rotation and scale. */
type WreckPart = { key: string; x: number; y: number; rot: number; scale: number };

/** Destruction: unit death, vehicle/heli crashes, boat sinking, player crash, rotor hulks, debris sim + settle + trails + sprites. */
export class Destruction {
  debrisG!: Phaser.GameObjects.Group;
  playerCrashStarted = false;
  playerCrashLanded = false;
  /** <0 = waiting for crash simmer; >=0 = countdown to BIRD DOWN. */
  playerCrashEndT = -1;
  /** Scene-owned simmer so BIRD DOWN isn't lost if the hull debris is culled. */
  playerCrashSimmerT = 0;
  /** Last live heli pose — death cam rests at mid(this, hulk). */
  playerDeathLiveX = 0;
  playerDeathLiveY = 0;
  playerDeathLiveZ = 0;
  /** Live player crash hulk for camera follow. */
  playerCrashDebris?: Debris;

  constructor(readonly s: MissionScene) {}

  /** Per-mission state reset (called from the scene's init). */
  reset(): void {
    this.playerCrashStarted = false;
    this.playerCrashLanded = false;
    this.playerCrashEndT = -1;
    this.playerCrashSimmerT = 0;
    this.playerCrashDebris = undefined;
    this.playerDeathLiveX = 0;
    this.playerDeathLiveY = 0;
    this.playerDeathLiveZ = 0;
  }

  /** Admit debris by lifecycle importance; only ephemeral trail carriers are replaceable. */
  admitDebris(piece: Debris): boolean {
    // Launch loft retuned for constant gravity (keeps apex heights near the old hang-time arcs).
    if (piece.gravity && !piece.settled && piece.vz > 0) piece.vz *= DEBRIS_LOFT;
    const debrisClass = piece.debrisClass ?? "consequential";
    piece.debrisClass = debrisClass;
    if (debrisClass === "consequential") {
      if (this.s.debris.reduce((n, f) => n + ((f.debrisClass ?? "consequential") === "consequential" ? 1 : 0), 0) >= 192) {
        return false;
      }
    } else if (debrisClass === "ephemeral") {
      const ephemeral = this.s.debris.reduce((n, f) => n + (f.debrisClass === "ephemeral" ? 1 : 0), 0);
      if (ephemeral >= 64) {
        const oldest = this.s.debris.findIndex((f) => f.debrisClass === "ephemeral");
        if (oldest >= 0) this.s.debris.splice(oldest, 1);
        else return false;
      }
    }
    this.s.debris.push(piece);
    return true;
  }

  /** `intact`: the hull goes down whole (drowning): nothing thrown off, no crash arc, just the location-based wreck. */
  destroyUnit(u: Unit, quiet = false, skipSplash = false, skipAirCrash = false, freefall = false, intact = false): void {
    if (u.dead) return;
    // Riders of a bridge deck (found while it still stands) go down with it, like crew with their host.
    const riders = specOf(u.kind).deck ? this.deckRiders(u) : undefined;
    u.dead = true;
    this.s.stats.kill(u);
    this.s.nav.onUnitDead(u);
    for (const crew of this.s.units) {
      if (crew.dead || crew.pinId !== u.id) continue;
      // Crew go down with their host: same kill credit.
      crew.statBy ??= u.statBy;
      this.destroyUnit(crew);
    }
    if (riders) {
      for (const r of riders.units) {
        r.statBy ??= u.statBy;
        this.destroyUnit(r);
      }
      for (const r of riders.remotes) this.s.targeting.damageRemote(r, r.health + 1);
    }
    const sp = specOf(u.kind);
    const building = !!sp.building;
    const mech =
      building ||
      isGroundVehicle(u.kind) ||
      !!sp.water ||
      !!sp.aerial;
    const boom = Phaser.Math.Clamp((radius(u.kind) - 6) / 86, 0.16, 1);
    if (!quiet) {
      const hz = u.z + heightOf(u.kind) * 0.5;
      const blast = Math.max(42, radius(u.kind) * 2.4) * (building ? 1.4 : 1);
      const body = footprintOf(u);
      const bodyR = circumRadiusOf(u.kind);
      const near = Math.hypot(u.x - this.s.player.x, u.y - this.s.player.y);
      const zap = sp.deathFx === "zap";
      const collapse = sp.deathFx === "collapse";
      // Barrel pulse only for full HE building deaths (not collapses or zaps).
      if (building && !zap && !collapse) {
        const killPulse =
          Phaser.Math.Clamp(1.2 - near / 1100, 0.18, 0.62) * Phaser.Math.Linear(0.55, 1.15, boom);
        this.s.postFx.pulseBarrel(killPulse);
      }
      let burst: { dx: number; dy: number; dz: number; power: number } | null = null;
      if (sp.organic) {
        this.s.fx.heFireBurst(u.x, u.y, hz, 0, 0, 1, blast, true, building ? 2.25 : 1, boom, 1, 0, body);
      } else {
        burst = deathBurstImpulse(u);
        if (zap) {
          // Metal structure shorting out: a little fire and a dirt kick at the base, no HE fireball.
          this.s.fx.heFireBurst(u.x, u.y, u.z + 6, 0, 0, 1, blast * 0.3, false, 1, 0.22, 0.6);
          this.s.fx.emitBigBoomDebris(u.x, u.y, u.z + 6, 0.35, burst.dx, burst.dy, burst.dz);
        } else if (collapse) {
          // Light structure coming down: a smaller, slower fire burst and a debris/dust kick; no fireball.
          this.s.fx.heFireBurst(u.x, u.y, hz, burst.dx, burst.dy, burst.dz, blast * 0.55, false, 1.3, boom * 0.6, 0.7, radius(u.kind), body);
          this.s.fx.emitBigBoomDebris(u.x, u.y, hz, 0.42, burst.dx, burst.dy, burst.dz, COLLAPSE_DIRT_SPEED);
          this.s.fx.emitBigBoomSparks(u.x, u.y, hz + 6, 0.3, burst.dx, burst.dy, burst.dz, COLLAPSE_SPARK_SCALE, 0.7);
        } else {
          this.s.fx.heFireBurst(
            u.x,
            u.y,
            hz,
            burst.dx,
            burst.dy,
            burst.dz,
            blast,
            false,
            building ? 2.25 : 1,
            boom,
            burst.power,
            mech ? radius(u.kind) : 0,
            body
          );
          // Dramatic additive fireball on vehicles & buildings.
          this.s.fx.spawnToonBlast(u.x, u.y, hz, {
            building,
            size01: boom,
            waveMul: building ? 1.15 : 1,
          });
          if (u.hv || building || boom > 0.62) {
            const boomSize = Math.max(boom, u.hv ? 0.85 : 0.55);
            const kdx = burst?.dx ?? 0;
            const kdy = burst?.dy ?? 0;
            const kdz = burst?.dz ?? 1;
            this.s.fx.emitBigBoomSparks(u.x, u.y, hz + 8, boomSize, kdx, kdy, kdz);
            this.s.fx.emitBigBoomDebris(u.x, u.y, hz + 8, boomSize, kdx, kdy, kdz);
          } else if (isGroundVehicle(u.kind) || sp.water) {
            // Smaller vehicles: the small-building spark shower.
            this.s.fx.emitBigBoomSparks(u.x, u.y, hz + 6, 0.3, burst.dx, burst.dy, burst.dz, COLLAPSE_SPARK_SCALE, 0.7);
          }
        }
      }
      if (building) this.s.hostCraft.emitDustShock(u.x, u.y, collapse ? 1.35 : 1);
      else if (sp.water) this.s.hostCraft.emitMistShock(u.x, u.y, Phaser.Math.Linear(0.7, 1.3, boom));
      if (sp.deathFx === "sparks" || zap) this.s.fx.electricShort(u.x, u.y, u.z + heightOf(u.kind) * 0.9, u.angle, (sp.box?.halfL ?? radius(u.kind)) * 0.85);
      if (sp.deathFx === "inferno") {
        this.s.fx.infernoChain(u.x, u.y, hz, bodyR * 0.7);
        this.s.postFx.pulseBarrel(0.7);
      }
      // Smoke puffs from a few footprint points, not only the center.
      const smokeN = zap ? 5 : 16;
      const smokeClusters = Math.min(5, smokeN);
      for (let s = 0; s < smokeClusters; s++) {
        const o = randomInFootprint(body, Math.min(bodyR * 0.2, 8));
        const smokeAt = worldToScreen(o.x, o.y, u.z);
        this.s.fx.smoke.setDepth(worldDepth(u.z, 0.2, o.y));
        this.s.fx.emitBudgeted(
          "smoke",
          this.s.fx.smoke,
          smokeAt.x,
          smokeAt.y + 12,
          Math.ceil(smokeN / smokeClusters)
        );
      }
      this.s.camera.shake = Math.min(10, this.s.camera.shake + (zap ? 1.2 : collapse ? 1.8 : 3));
      // Buildings/vehicles: weak splash at ~3× body radius (FX blast can be larger).
      if (!skipSplash && !sp.organic) {
        if (mech) {
          const inferno = sp.deathFx === "inferno";
          const splashR = radius(u.kind) * (inferno ? 5 : 3);
          const deathDmg = inferno ? 90 : u.max * (building ? 0.05 : 0.1);
          this.s.projectiles.applyBlastDamage(
            u.x,
            u.y,
            u.z,
            splashR,
            deathDmg,
            undefined,
            u.killDx ?? 0,
            u.killDy ?? 0,
            u.killDz ?? 0,
            false
          );
        }
      }
      const n = Math.max(2, Math.round((sp.organic ? 4 : zap ? 6 : collapse ? 10 : building ? 16 : 10) * Phaser.Math.Linear(0.4, 1.2, boom)));
      // Collapse: debris tumbles out low and slow rather than blasting skyward.
      const throwMul = collapse ? 0.6 : 1;
      const keys = debrisKeys(u.kind);
      const debrisSpdMul = burst ? Phaser.Math.Linear(0.98, 1.35, Math.min(1, (burst.power - 0.5) / 1.9)) : 1;
      const debrisTight = burst ? Phaser.Math.Linear(0.48, 0.72, Math.min(1, (burst.power - 0.5) / 1.9)) : 0;
      for (let i = 0; i < n; i++) {
        const key = this.s.textures.exists(keys[i % keys.length]!)
          ? keys[i % keys.length]!
          : "fx_debris_metal";
        const organic = !!sp.organic;
        // HV buildings were throwing outsized chunks; keep mid/vehicle debris as-is.
        const maxSc = u.hv && !organic ? 1.18 : 1.5;
        const maxTrail = u.hv && !organic ? 1.12 : 1.4;
        const scale = (organic ? 0.78 : 1) * Phaser.Math.Linear(0.32, maxSc, boom) * (collapse ? 0.8 : 1);
        const trailR = organic
          ? range(6.8, 7.6)
          : this.s.trails.texTrailR(key) * Phaser.Math.Linear(0.4, maxTrail, boom);
        // Inset by ~half the piece so the chunk stays inside the footprint.
        const pieceR = Phaser.Math.Clamp(
          organic ? trailR * 0.35 : this.s.trails.texTrailR(key) * scale * 0.28,
          2,
          bodyR * 0.45
        );
        const origin = randomInFootprint(body, pieceR);
        let vx: number;
        let vy: number;
        let vz: number;
        let angle: number;
        if (burst) {
          const reverse = Math.random() < 0.14;
          const d = biasedDir(burst.dx, burst.dy, burst.dz, debrisTight, reverse);
          const spd = range(55, 255) * debrisSpdMul * throwMul;
          const jit = 0.28;
          vx = d.x * spd + range(-spd * jit * 0.5, spd * jit * 0.5);
          vy = d.y * spd + range(-spd * jit * 0.5, spd * jit * 0.5);
          vz = (range(170, 330) * Phaser.Math.Linear(0.95, 1.12, Math.min(1, (burst.power - 0.5) / 1.9)) + d.z * 35) * throwMul;
          angle = Math.atan2(vy, vx);
        } else {
          angle = Math.random() * Math.PI * 2;
          const spd = range(55, 255) * throwMul;
          vx = Math.cos(angle) * spd;
          vy = Math.sin(angle) * spd;
          vz = range(170, 330) * throwMul;
        }
        // Organic debris sprite scale stays varied; flame size is a fixed mid band (see emitDebrisTrail).
        this.admitDebris({
          x: origin.x,
          y: origin.y,
          z: u.z + range(8, 22),
          vx,
          vy,
          vz,
          angle,
          spin: range(-5, 5),
          life: range(0.45, 0.85),
          key,
          settled: false,
          gravity: true,
          bounces: Math.random() < 1 / 3 ? 2 + ((Math.random() * 2) | 0) : 0,
          trailR,
          scale,
          trailSoft: organic,
        });
      }
      if (!sp.noCrater && !sp.crashPop) {
        let sc = (radius(u.kind) / 20) * range(0.72, 1.42);
        if (sp.wreckScale != null) sc *= sp.wreckScale;
        this.s.groundMarks.stampBlastCrater(u.x, u.y, sc);
        // Embers only on mech / building death craters — not troops or soft organics.
        if (mech && !sp.organic) {
          this.s.groundMarks.spawnCraterEmbers(u.x, u.y, softCapBlastCraterScale(sc));
        }
      }
    }
    const guns = gunsOf(u);
    // Helis and drones: spinning hull falls then impacts — not on suicide/kamikaze pops.
    if (((sp.behavior === "orbit_attack_heli" || sp.behavior === "kite_attack_heli") || sp.behavior === "suicide_attack_heli") && !skipAirCrash) {
      this.spawnHeliCrash({
        x: u.x,
        y: u.y,
        z: u.z,
        vx: u.vx,
        vy: u.vy,
        angle: u.angle,
        rotor: u.rotor,
        kind: u.kind,
        camo: u.camo,
        dmgSites: u.dmgSites,
        radius: radius(u.kind),
        kickDx: freefall ? 0 : u.killDx,
        kickDy: freefall ? 0 : u.killDy,
        freefall,
      });
    } else {
      const throwGuns = !intact && !!(sp.throwGuns && guns.length > 0);
      const throwRotors = sp.rotors.length > 0;
      const throwDish = !!sp.dish;
      if (throwGuns || throwRotors || throwDish) {
        this.placeHullWreck(u, resolveSkin(this.s.textures, sp.hulk, u.camo), troopDrawAng(u) + Math.PI / 2);
        const throwOff = (key: string, ang: number, x: number, y: number, scale = 1, extra: Partial<Debris> = {}) =>
          this.throwPart(key, ang, x, y, u.z + 18, scale, extra);
        if (throwGuns) {
          this.gunWreckParts(u).forEach((part) => {
            // Turret hulks are large textures; don't inherit full debris trailR bump.
            throwOff(part.key, part.rot, part.x, part.y, part.scale, {
              trailR: this.s.trails.texTrailR(part.key) * part.scale * 0.38,
              turretPop: true,
            });
          });
        }
        if (throwRotors) {
          const rotorMounts = rotorMountsOf(textureOf(u.kind));
          sp.rotors.forEach((r, ri) => {
            const rk = this.s.textures.exists(r.hulk ?? "") ? r.hulk! : r.tex;
            const at = mountAt(this.s.textures, u, resolveSkin(this.s.textures, textureOf(u.kind), u.camo), r.mount);
            const scale = this.rotorHulkScale(r.tex, rk, r.scale ?? 1);
            // Full heli discs get pin flames; angled props / drone pads do not.
            const heliRotor = r.tex.includes("rotor") && r.tex !== "enemy_drone_rotor";
            const flamePts = heliRotor
              ? this.s.unitSprites.sampleSolidLocalPoints(
                  rk,
                  radius(u.kind) / Math.max(scale, 0.01),
                  1 + ((Math.random() * 2) | 0),
                  0.7
                )
              : [];
            const rotorAng = rotorSpinSign(rotorMounts, ri) * u.rotor;
            if (heliRotor) {
              this.throwRotorHulk({
                key: rk,
                x: at.x,
                y: at.y,
                z: u.z + 18,
                rotorAng,
                scale,
                flamePts,
              });
            } else {
              throwOff(rk, rotorAng, at.x, at.y, scale, {
                flamePts,
              });
            }
          });
        }
        if (throwDish && sp.dish) {
          const d = sp.dish;
          const raw = this.s.textures.exists(d.hulk ?? "") ? d.hulk! : `${d.tex}_hulk`;
          const dishKey = this.s.textures.exists(raw) ? raw : d.tex;
          const liveSpan = this.s.unitSprites.texSpan(d.tex);
          const hulkSpan = this.s.unitSprites.texSpan(dishKey);
          const scale = (d.scale ?? 1) * (liveSpan / Math.max(hulkSpan, 1)) * 0.82;
          const at = mountAt(this.s.textures, u, resolveSkin(this.s.textures, textureOf(u.kind), u.camo), d.mount);
          const span = this.s.unitSprites.texSpan(dishKey) * scale * 0.42;
          // A couple of burn columns near the middle, not a scatter across the dish.
          const n = 1 + ((Math.random() * 2) | 0);
          const flamePts: { lx: number; ly: number; sc: number }[] = [{ lx: 0, ly: 0, sc: 0.72 }];
          for (let i = 0; i < n; i++) {
            const rad = range(0.12, 0.4) * span;
            const ang = Math.random() * Math.PI * 2;
            flamePts.push({
              lx: Math.cos(ang) * rad,
              ly: Math.sin(ang) * rad,
              sc: range(0.28, 0.52),
            });
          }
          throwOff(dishKey, u.rotor, at.x, at.y, scale, {
            flamePts,
            dishFlat: true,
            spin: range(-7, 7),
            trailR: this.s.trails.texTrailR(dishKey) * scale * 0.4,
            bounces: 0,
          });
        }
      } else if (sp.crashPop && !intact) {
        this.spawnLightVehicleCrash(u);
        if (hasSoftBlood(u.kind) && this.s.textures.exists("fx_dirt") && !isWater(this.s.world, u.x, u.y)) {
          const kdx = u.killDx ?? 0;
          const kdy = u.killDy ?? 0;
          const impactAng = (kdx || kdy) ? Math.atan2(kdy, kdx) : u.angle;
          const nStreaks = 1 + ((Math.random() * 3) | 0);
          const blood = [0xee2828, 0xdd2020, 0xe83838, 0xcc1a1a];
          for (let si = 0; si < nStreaks; si++) {
            const ang = impactAng + range(-0.45, 0.45);
            const dist = range(4, 12);
            const ox = Math.cos(ang) * dist;
            const oy = Math.sin(ang) * dist;
            const col = blood[(Math.random() * blood.length) | 0]!;
            const sx = range(1.4, 3.2);
            const sy = range(0.35, 0.7);
            this.s.groundMarks.stampWreck(
              "fx_dirt",
              u.x + ox,
              u.y + oy,
              ang + range(-0.12, 0.12),
              sx,
              range(0.75, 0.95),
              0.5,
              0.5,
              sy,
              (Math.random() * FX_VARIANTS) | 0,
              col
            );
          }
        }
      } else {
        const broken = sp.breakApart ? hulkBreakKeys(this.s.textures, sp.hulk) : [];
        const hulkKey = broken.length
          ? broken[(Math.random() * broken.length) | 0]!
          : resolveSkin(this.s.textures, hulkOf(u.kind), u.camo);
        this.placeHullWreck(u, hulkKey, u.angle + Math.PI / 2 + (sp.wreckJitter ? range(-sp.wreckJitter, sp.wreckJitter) : 0));
        // Whole-hull deaths (drowning): the guns go down with it instead of popping off.
        if (intact && this.hullSinksAt(u)) this.sinkParts(this.gunWreckParts(u), u);
        if (hasSoftBlood(u.kind) && this.s.textures.exists("fx_dirt") && !isWater(this.s.world, u.x, u.y)) {
          const kdx = u.killDx ?? 0;
          const kdy = u.killDy ?? 0;
          const impactAng = (kdx || kdy) ? Math.atan2(kdy, kdx) : u.angle;
          const nStreaks = 1 + ((Math.random() * 3) | 0);
          const blood = [0xee2828, 0xdd2020, 0xe83838, 0xcc1a1a];
          for (let si = 0; si < nStreaks; si++) {
            const ang = impactAng + range(-0.45, 0.45);
            const dist = range(4, 12);
            const ox = Math.cos(ang) * dist;
            const oy = Math.sin(ang) * dist;
            const col = blood[(Math.random() * blood.length) | 0]!;
            const sx = range(1.4, 3.2);
            const sy = range(0.35, 0.7);
            this.s.groundMarks.stampWreck(
              "fx_dirt",
              u.x + ox,
              u.y + oy,
              ang + range(-0.12, 0.12),
              sx,
              range(0.75, 0.95),
              0.5,
              0.5,
              sy,
              (Math.random() * FX_VARIANTS) | 0,
              col
            );
          }
        }
      }
    }
    // Roof part pops off the top like a turret, but lands dead (no bounce).
    if (sp.roof?.hulk && this.s.textures.exists(sp.roof.hulk)) {
      // Fixed small trail: texTrailR scales with the longest side, huge for thin cross-arms.
      this.throwPart(sp.roof.hulk, u.angle + Math.PI / 2, u.x, u.y, u.z + heightOf(u.kind), 1, {
        debrisClass: "critical",
        trailR: ROOF_POP_TRAIL_R,
        bounces: 0,
        spin: spinBetween(ROOF_SPIN_MIN, ROOF_SPIN_MAX),
        // Short toss: roofs slump off rather than fly like turrets.
        ...tossVel(ROOF_THROW_MIN, ROOF_THROW_MAX, ROOF_LOFT_MIN, ROOF_LOFT_MAX),
      });
    }
    if (!intact) this.spawnWheelDebris(u);
  }

  /**
   * Light-vehicle death: hulk launches in a spinning flaming arc biased toward
   * the killing impact, then stamps wreck + crater + embers where it lands.
   */
  spawnLightVehicleCrash(u: Unit): void {
    const sp = specOf(u.kind);
    const hulkKey = resolveSkin(this.s.textures, hulkOf(u.kind), u.camo);
    const key = this.s.textures.exists(hulkKey) ? hulkKey : "fx_hulk_crater";
    const burst = deathBurstImpulse(u);
    const reverse = Math.random() < 0.05;
    const d = biasedDir(burst.dx, burst.dy, burst.dz, 0.9, reverse);
    const spdMul = Phaser.Math.Linear(0.92, 1.1, Math.min(1, (burst.power - 0.5) / 1.9));
    const spd = range(70, 130) * spdMul;
    const jit = 0.1;
    const vx = d.x * spd + range(-spd * jit, spd * jit);
    const vy = d.y * spd + range(-spd * jit, spd * jit);
    const vz = range(140, 220) + Math.max(0, d.z) * 28;
    let craterSc = (radius(u.kind) / 20) * range(0.78, 1.35);
    if (sp.wreckScale != null) craterSc *= sp.wreckScale;
    this.admitDebris({
      x: u.x,
      y: u.y,
      z: u.z + 18,
      vx,
      vy,
      vz,
      angle: u.angle + Math.PI / 2,
      spin: range(9, 18) * (Math.random() < 0.5 ? -1 : 1),
      life: 10,
      key,
      settled: false,
      gravity: true,
      bounces: 0,
      trailR: this.s.trails.texTrailR(key) * 0.62,
      scale: 1,
      debrisClass: "critical",
      linger: true,
      crashPop: true,
      crashCraterScale: craterSc,
    });
  }

  /** Pop a detached part (turret hulk, dish…) off a wreck: random toss, spin, maybe bounce. */
  throwPart(key: string, ang: number, x: number, y: number, z: number, scale = 1, extra: Partial<Debris> = {}): void {
    const a = Math.random() * Math.PI * 2;
    const throwSp = range(90, 200);
    this.admitDebris({
      x,
      y,
      z,
      vx: Math.cos(a) * throwSp,
      vy: Math.sin(a) * throwSp,
      vz: range(190, 270),
      angle: ang,
      spin: spinBetween(POP_SPIN_MIN, POP_SPIN_MAX),
      minSpin: POP_SPIN_MIN,
      life: 5,
      key,
      settled: false,
      gravity: true,
      bounces: Math.random() < 1 / 3 ? 2 + ((Math.random() * 2) | 0) : 0,
      trailR: this.s.trails.texTrailR(key) * scale,
      scale,
      debrisClass: "critical",
      ...extra,
    });
  }

  /**
   * Craft turret hulks: every live turret overlay whose socket has `gunHulk` pops off like an enemy turret.
   * Position + size come from the live turret sprite (screen → world), so it matches what was on screen.
   */
  popCraftTurrets(spec: CraftSpec, guns: { im: Phaser.GameObjects.Image | undefined; slot: number }[], z: number, gunAngle: number): void {
    for (const part of this.turretWreckParts(spec, guns, z, gunAngle)) {
      this.throwPart(part.key, part.rot, part.x, part.y, z + 18, part.scale, {
        trailR: this.s.trails.texTrailR(part.key) * part.scale * 0.38,
        turretPop: true,
      });
    }
  }

  /** A craft's turret wreck pieces (hulk art at the live turret's spot and size): thrown on a kill, sunk on a drowning. */
  turretWreckParts(spec: CraftSpec, guns: { im: Phaser.GameObjects.Image | undefined; slot: number }[], z: number, gunAngle: number): WreckPart[] {
    const out: WreckPart[] = [];
    for (const { im, slot } of guns) {
      const hulk = spec.sockets[slot]?.gunHulk;
      if (!hulk || !im || !im.visible || !this.s.textures.exists(hulk)) continue;
      const at = screenToWorldAtZ(im.x, im.y, z);
      // Hulk is the same size as the live turret; slightly under so it reads as wreckage (like enemies).
      out.push({ key: hulk, x: at.x, y: at.y, rot: gunAngle + Math.PI / 2, scale: (im.scaleX / Math.max(zScale(z, at.y), 1e-3)) * 0.86 });
    }
    return out;
  }

  /** A unit's gun wreck pieces (hulk art, else live art, at each mount and aim): thrown on a kill, sunk on a drowning. */
  gunWreckParts(u: Unit): WreckPart[] {
    return gunsOf(u).map((g, gi) => {
      const raw = this.s.textures.exists(g.hulk ?? "") ? g.hulk! : g.tex;
      const key = resolveSkin(this.s.textures, raw, u.camo);
      const liveSpan = this.s.unitSprites.texSpan(resolveSkin(this.s.textures, g.tex, u.camo));
      const hulkSpan = this.s.unitSprites.texSpan(key);
      const at = gunMountPos(this.s.textures, u, gi);
      // Slightly under live gun size so pop hulks read as wreckage, not spare parts.
      return { key, x: at.x, y: at.y, rot: (u.turrets[gi] ?? u.turret) + Math.PI / 2, scale: (g.scale ?? 1) * (liveSpan / Math.max(hulkSpan, 1)) * 0.86 };
    });
  }

  /** Wreck pieces going down with their hull (no splash of their own). */
  sinkParts(parts: readonly WreckPart[], at: { vx: number; vy: number }): void {
    for (const p of parts) this.sinkWreck({ x: p.x, y: p.y, vx: at.vx, vy: at.vy }, 8, p.key, p.rot, p.scale, false);
  }

  spawnWheelDebris(u: Unit): void {
    const sp = specOf(u.kind);
    if (sp.wheels) this.spawnWheels(u.x, u.y, u.z, sp.wheels, sp.wheelDebrisScale);
  }

  /** Throw 1–2 (≤ maxW) rolling wheels from a wrecked ground vehicle (units + ground remotes). */
  spawnWheels(x: number, y: number, z: number, maxW: number, scaleRange: [number, number] = [0.78, 0.95]): void {
    const keys = wheelDebrisKeys().filter((k) => this.s.textures.exists(k));
    if (!keys.length) return;
    const n = Math.min(maxW, 1 + ((Math.random() * 2) | 0));
    const sc = range(scaleRange[0], scaleRange[1]);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const throwSp = range(120, 260);
      const key = keys[(Math.random() * keys.length) | 0]!;
      this.admitDebris({
        x: x + range(-10, 10),
        y: y + range(-10, 10),
        z: z + range(14, 32),
        vx: Math.cos(a) * throwSp,
        vy: Math.sin(a) * throwSp,
        vz: range(170, 300),
        angle: Math.random() * Math.PI * 2,
        spin: range(-14, 14),
        life: 20,
        key,
        settled: false,
        gravity: true,
        bounces: 1 + ((Math.random() * 2) | 0),
        trailR: this.s.trails.texTrailR(key) * sc * 0.7,
        scale: sc,
        wheelRoll: true,
        track: 0,
      });
    }
  }

  /** On-screen rotor span (pre-zScale), matching syncHeli / syncUnitSprites. */
  liveRotorDrawPx(tex: string, partScale = 1): number {
    if (tex.includes("rotor") && tex !== "enemy_drone_rotor") return rotorDrawSpan(tex, partScale);
    return this.s.unitSprites.texSpan(tex) * partScale;
  }

  /** Debris scale so a rotor hulk draws ~60% of the live rotor size. */
  rotorHulkScale(liveTex: string, hulkKey: string, partScale = 1): number {
    return (this.liveRotorDrawPx(liveTex, partScale) * 0.6) / Math.max(this.s.unitSprites.texSpan(hulkKey), 1);
  }

  /** Where a dead unit's hull sinks (deep water, off any deck; water buildings stay afloat). */
  hullSinksAt(u: Unit): boolean {
    const d = this.s.nav.deckAt(u.x, u.y);
    return !(d && d !== u) && !specOf(u.kind).building && isDeepWater(this.s.world, u.x, u.y);
  }

  /**
   * A dead unit's hull wreck, decided by where it died (whatever killed it): on a bridge deck it stays on the deck;
   * in deep water it sinks (water buildings excepted: they stay afloat); in shallows it splashes, water units then
   * float it on the surface (roofed decks at the roof); on land (and shallows) it's stamped into the ground + thermal mark.
   */
  placeHullWreck(u: Unit, key: string, rot: number): void {
    const sp = specOf(u.kind);
    const tex = this.s.textures.exists(key) ? key : "fx_hulk_crater";
    const hp = spritePivot(key);
    const deck = this.s.nav.deckAt(u.x, u.y);
    if (deck && deck !== u) {
      this.s.groundMarks.addSurfaceWreck(tex, u.x, u.y, deck.z + heightOf(deck.kind), rot, hp.x, hp.y);
      return;
    }
    if (this.hullSinksAt(u)) {
      this.sinkHull(u, tex, rot);
      return;
    }
    const wet = isWater(this.s.world, u.x, u.y);
    if (wet && !sp.building) this.waterSplash(u.x, u.y, groundZ(this.s.world, u.x, u.y), Math.min(1.2, radius(u.kind) / 30));
    if (sp.water && wet) {
      this.s.groundMarks.addSurfaceWreck(tex, u.x, u.y, u.z + (sp.roof ? heightOf(u.kind) : 0), rot, hp.x, hp.y);
      return;
    }
    const hs = wreckDrawScale(this.s.world, u.x, u.y, u.z, 1, isGroundVehicle(u.kind), u.angle);
    this.s.groundMarks.stampWreck(tex, u.x, u.y, rot, hs.sx, 0.95, hp.x, hp.y, hs.sy);
    if (!hasSoftBlood(u.kind)) this.s.groundMarks.addThermalWreckMark(tex, u.x, u.y, rot, hs.sx, hs.sy, hp.x, hp.y, undefined, "hulk");
  }

  /**
   * Who falls when a deck goes: ground units / ground remotes standing on it that can't be in deep water
   * (underwater hulls just drop to the bed).
   */
  deckRiders(deck: Unit): { units: Unit[]; remotes: RemoteCraft[] } {
    const on = (x: number, y: number) => this.s.nav.deckAt(x, y) === deck;
    return {
      units: this.s.units.filter((o) => !o.dead && o !== deck && onGroundHull(o) && !groundHull(o).underwater && on(o.x, o.y)),
      remotes: this.s.remotes.filter((r) => r.spec.ground && !r.airborne && !r.detonate && !groundHull(r).underwater && on(r.x, r.y)),
    };
  }

  /** A dead unit's hull going down in deep water. */
  sinkHull(u: Unit, key: string, rot: number): void {
    this.sinkWreck(u, radius(u.kind), key, rot);
  }

  /** A hull (unit or remote) going down in deep water at its draw `scale`: splash + ripple, then it sinks to the bed tinting blue. */
  sinkWreck(at: { x: number; y: number; vx: number; vy: number }, r: number, key: string, rot: number, scale = 1, splash = true): void {
    const sinkKey = ensureSinkTexture(this.s.textures, key);
    if (splash) {
      this.s.ripples.splash(at.x, at.y, r * 2.6, 1);
      this.waterSplash(at.x, at.y, groundZ(this.s.world, at.x, at.y), Math.min(1.4, r / 30));
    }
    this.admitDebris({
      x: at.x,
      y: at.y,
      z: groundZ(this.s.world, at.x, at.y),
      vx: at.vx * 0.35 + range(-14, 14),
      vy: at.vy * 0.35 + range(-14, 14),
      vz: 0,
      angle: rot,
      // Big hulls turn slower as they go down.
      spin: (range(0.18, 0.42) * (Math.random() < 0.5 ? -1 : 1)) / Math.max(1, r / 40),
      life: 22,
      key: sinkKey,
      settled: false,
      gravity: false,
      bounces: 0,
      trailR: this.s.trails.texTrailR(sinkKey) * 0.45 * scale,
      scale,
      boatSink: true,
      sinkT: 0,
      sinkMax: range(5.2, 7.5),
      debrisClass: "critical",
    });
  }

  spawnHeliCrash(opts: {
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    angle: number;
    rotor: number;
    kind?: Unit["kind"];
    camo?: Unit["camo"];
    dmgSites?: { u: number; v: number; scale: number }[];
    radius: number;
    player?: boolean;
    kickDx?: number;
    kickDy?: number;
    /** EMP / power-cut: no loft kick, tumble into the ground. */
    freefall?: boolean;
  }): void {
    const player = !!opts.player;
    const freefall = !!opts.freefall;
    const sp = opts.kind ? specOf(opts.kind) : undefined;
    const craft = player ? this.s.player.spec : undefined;
    const hullKey = player
      ? this.s.textures.exists(craft!.hulk)
        ? craft!.hulk
        : craft!.body
      : resolveSkin(this.s.textures, sp!.hulk, opts.camo);
    const hullAng = opts.angle + (craft?.rotOff ?? Math.PI / 2);
    const dmgFlames = this.s.fx.crashDmgFlames(opts.dmgSites, hullKey, opts.radius);
    const spinSign = Math.random() < 0.5 ? -1 : 1;
    const kn = Math.hypot(opts.kickDx ?? 0, opts.kickDy ?? 0);
    const boost = freefall ? range(8, 28) : range(110, 170);
    const kx = kn > 1 ? ((opts.kickDx ?? 0) / kn) * boost : freefall ? range(-22, 22) : 0;
    const ky = kn > 1 ? ((opts.kickDy ?? 0) / kn) * boost : freefall ? range(-22, 22) : 0;
    const hull: Debris = {
      x: opts.x,
      y: opts.y,
      z: opts.z,
      vx: opts.vx * (freefall ? 0.55 : 0.9) + kx + range(-18, 18),
      vy: opts.vy * (freefall ? 0.55 : 0.9) + ky + range(-18, 18),
      // Upward pop on death so the hull arcs and hangs before the ground boom (freefall EMP drones loft higher).
      vz: freefall ? range(110, 220) : range(HELI_CRASH_LOFT_MIN, HELI_CRASH_LOFT_MAX),
      angle: hullAng,
      spin: spinSign * (freefall ? range(2.4, 4.2) : range(0.85, 1.55)),
      spinAccel: freefall ? range(3.2, 5.5) : range(2.4, 4.6),
      life: 12,
      key: hullKey,
      settled: false,
      gravity: true,
      bounces: 0,
      trailR: this.s.trails.texTrailR(hullKey) * 0.55,
      scale: 1,
      heliCrash: true,
      // Spinning rotor still bites air: slower fall, longer hang.
      gravityMul: HELI_CRASH_GRAVITY,
      playerCrash: player,
      debrisClass: "critical",
      impactDust: Phaser.Math.Clamp(opts.radius / 48, 0.32, 0.72),
      dmgFlames,
      simmer: 0,
    };
    this.admitDebris(hull);
    if (player) this.playerCrashDebris = hull;

    const rotors = player
      ? craft!.rotor
        ? craftRotorMounts(craft!).map((mount) => ({
              tex: craft!.rotor!,
              hulk: craft!.rotorHulk ?? `${craft!.rotor}_hulk`,
              mount,
              scale: (craft!.rotorScale ?? 1) * (mount.scale ?? 1),
            }))
        : []
      : (sp?.rotors ?? []).map((r) => ({
          tex: r.tex,
          hulk: this.s.textures.exists(r.hulk ?? "") ? r.hulk! : r.tex,
          mount: r.mount,
          scale: r.scale ?? 1,
        }));

    const propDisc = !!(craft && craftRotorIsProp(craft));
    rotors.forEach((r, ri) => {
      const rk = this.s.textures.exists(r.hulk) ? r.hulk : r.tex;
      let x = opts.x;
      let y = opts.y;
      if (player && craft) {
        const pivot = craftOrigin(craft);
        const source = this.s.textures.get(craft.body).getSourceImage() as { width: number; height: number };
        const hullRot = opts.angle + craft.rotOff;
        const mx = (r.mount.x - pivot.x) * source.width;
        const my = (r.mount.y - pivot.y) * source.height;
        x += mx * Math.cos(hullRot) - my * Math.sin(hullRot);
        y += mx * Math.sin(hullRot) + my * Math.cos(hullRot);
      } else if (opts.kind) {
        const at = mountAt(this.s.textures, 
          {
            id: 0,
            kind: opts.kind,
            x: opts.x,
            y: opts.y,
            z: opts.z,
            vx: 0,
            vy: 0,
            angle: opts.angle,
            turret: 0,
            health: 1,
            max: 1,
            dead: false,
            fireCd: 0,
            orbit: 0,
            rotor: opts.rotor,
            track: 0,
            turrets: [],
            muzzleT: 0,
            muzzleGun: 0,
            muzzleTip: 0,
            camo: opts.camo,
          },
          resolveSkin(this.s.textures, textureOf(opts.kind), opts.camo),
          r.mount
        );
        x = at.x;
        y = at.y;
      }
      const scale = this.rotorHulkScale(r.tex, rk, r.scale);
      // Full lift discs get pin flames; angled props (plane/orbit foreshorten) / drone pads do not.
      const fullRotor =
        !propDisc && r.tex.includes("rotor") && r.tex !== "enemy_drone_rotor";
      const flamePts = fullRotor
        ? this.s.unitSprites.sampleSolidLocalPoints(
            rk,
            opts.radius / Math.max(scale, 0.01),
            1 + ((Math.random() * 2) | 0),
            0.7
          )
        : [];
      const spinMounts =
        player && craft
          ? craftRotorMounts(craft)
          : opts.kind
            ? rotorMountsOf(textureOf(opts.kind))
            : [{ x: 0.5, y: 0.5 }];
      const rotorAng = rotorSpinSign(spinMounts, ri) * opts.rotor;
      // Suicide drones: all rotors always fly off — never pin to the falling hull.
      const pin =
        (!opts.kind || specOf(opts.kind).behavior !== "suicide_attack_heli") && Math.random() < 0.4;
      if (pin) {
        const spinSign = rotorAng >= 0 ? 1 : -1;
        this.admitDebris({
          x,
          y,
          z: opts.z + 6,
          vx: 0,
          vy: 0,
          vz: 0,
          angle: rotorAng,
          spin: spinSign * range(18, 32),
          life: 14,
          key: rk,
          settled: false,
          gravity: false,
          bounces: 0,
          trailR: this.s.trails.texTrailR(rk) * 0.35,
          scale,
          flamePts,
          pinHost: hull,
          pinMount: { ...r.mount },
          rotorSkew: true,
          skewAng: range(-0.4, 0.4) + (Math.random() < 0.5 ? 0 : Math.PI / 2),
          debrisClass: "critical",
        });
      } else {
        this.throwRotorHulk({
          key: rk,
          x,
          y,
          z: opts.z + 8,
          rotorAng,
          scale,
          flamePts,
        });
      }
    });
  }

  throwRotorHulk(opts: {
    key: string;
    x: number;
    y: number;
    z: number;
    rotorAng: number;
    scale: number;
    flamePts: { lx: number; ly: number; sc: number }[];
  }): void {
    const a = Math.random() * Math.PI * 2;
    const throwSp = range(240, 420);
    const spinSign = opts.rotorAng >= 0 ? 1 : -1;
    this.admitDebris({
      x: opts.x,
      y: opts.y,
      z: opts.z,
      vx: Math.cos(a) * throwSp,
      vy: Math.sin(a) * throwSp,
      vz: range(220, 360),
      angle: opts.rotorAng,
      spin: spinSign * range(22, 38),
      life: 8,
      key: opts.key,
      settled: false,
      gravity: true,
      bounces: 0,
      trailR: this.s.trails.texTrailR(opts.key) * 0.35,
      scale: opts.scale,
      rotorThrow: true,
      rotorSkew: true,
      skewAng: range(-0.5, 0.5) + (Math.random() < 0.5 ? 0 : Math.PI / 2),
      flamePts: opts.flamePts,
      debrisClass: "critical",
    });
  }

  beginPlayerCrash(): void {
    if (this.playerCrashStarted) return;
    this.playerCrashStarted = true;
    this.s.reticleHud.hideAimChrome();
    const h = this.s.player;
    this.playerDeathLiveX = h.x;
    this.playerDeathLiveY = h.y;
    this.playerDeathLiveZ = h.z;
    // Death stinger waits until crash + simmer + delay (see end(false)).
    this.s.hostCraft.unwrapTilt(this.s.hostCraft.body);
    this.s.hostCraft.body.setVisible(false);
    for (const rotor of this.s.hostCraft.rotors) rotor.setVisible(false);
    const gunSlots = craftGunSocketSlots(h.spec);
    this.popCraftTurrets(h.spec, this.s.hostCraft.guns.map((im, i) => ({ im, slot: gunSlots[i] ?? -1 })), h.z, h.gunAngle);
    for (const gun of this.s.hostCraft.guns) gun.setVisible(false);
    this.s.hostCraft.gun.setVisible(false);
    for (const glow of this.s.hostCraft.gunHeatGlows) glow.setVisible(false);
    this.s.hostCraft.shadow.setVisible(false);
    const hz = h.z + h.height * 0.5;
    const blast = 56;
    const body: Footprint = { shape: "circle", x: h.x, y: h.y, r: h.spec.radius };
    this.s.fx.heFireBurst(h.x, h.y, hz, 0, 0, 1, blast, false, 1, 0.55, 1, 0, body);
    for (let s = 0; s < 4; s++) {
      const o = randomInFootprint(body, Math.min(h.spec.radius * 0.2, 8));
      const smokeAt = worldToScreen(o.x, o.y, h.z);
      this.s.fx.smoke.setDepth(worldDepth(h.z, 0.2, o.y));
      this.s.fx.emitBudgeted("smoke", this.s.fx.smoke, smokeAt.x, smokeAt.y + 12, 4);
    }
    this.s.camera.shake = Math.min(10, this.s.camera.shake + 4);
    const n = 8;
    const keys = debrisKeys("heli");
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const spd = range(55, 220);
      const key = this.s.textures.exists(keys[i % keys.length]!) ? keys[i % keys.length]! : "fx_debris_metal";
      const scale = Phaser.Math.Linear(0.32, 1.3, 0.55);
      const pieceR = Phaser.Math.Clamp(this.s.trails.texTrailR(key) * scale * 0.28, 2, h.spec.radius * 0.45);
      const origin = randomInFootprint(body, pieceR);
      this.admitDebris({
        x: origin.x,
        y: origin.y,
        z: h.z + range(8, 22),
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd,
        vz: range(170, 330),
        angle: a,
        spin: range(-5, 5),
        life: range(0.45, 0.85),
        key,
        settled: false,
        gravity: true,
        bounces: Math.random() < 1 / 3 ? 2 + ((Math.random() * 2) | 0) : 0,
        trailR: this.s.trails.texTrailR(key) * Phaser.Math.Linear(0.4, 1.2, 0.55),
        scale,
      });
    }
    this.spawnHeliCrash({
      x: h.x,
      y: h.y,
      z: h.z,
      vx: h.vx,
      vy: h.vy,
      angle: h.angle,
      rotor: h.rotor,
      radius: h.spec.radius,
      player: true,
      dmgSites: h.dmgSites,
      kickDx: h.killDx,
      kickDy: h.killDy,
    });
  }

  updateDebris(dt: number): void {
    const keep: Debris[] = [];
    for (const f of this.s.debris) {
      if (f.trailOnly && !f.settled) f.life -= dt;
      if (f.settled) {
        if (f.heliCrash) {
          if ((f.simmer ?? 0) > 0) {
            f.simmer! -= dt;
            keep.push(f);
          } else if (f.playerCrash && this.playerCrashEndT < 0) {
            this.playerCrashEndT = 0.55;
          }
          continue;
        }
        // Boat hulks leave a wreck stamp only — never burn/smoke trails.
        if (!f.boatSink) this.tickDebrisTrailFade(f, dt);
        if (!f.trailOnly || (f.trailFade ?? 0) > 0) keep.push(f);
        continue;
      }
      if (f.heliCrash) {
        const sign = f.spin >= 0 ? 1 : -1;
        f.spin += sign * (f.spinAccel ?? 10) * dt;
      }
      if (f.rolling && f.wheelRoll && !f.settled) {
        this.tickWheelRoll(f, dt);
        if (!f.settled) keep.push(f);
        else if (!f.trailOnly || (f.trailFade ?? 0) > 0) keep.push(f);
        continue;
      }
      if (f.boatSink && !f.settled) {
        this.tickBoatSink(f, dt);
        if (!f.settled) keep.push(f);
        else if (!f.trailOnly || (f.trailFade ?? 0) > 0) keep.push(f);
        continue;
      }
      if (f.pinHost && !f.settled) {
        this.tickPinnedRotor(f, dt);
        if (!f.settled) keep.push(f);
        else if (!f.trailOnly || (f.trailFade ?? 0) > 0) keep.push(f);
        continue;
      }
      if (f.rotorThrow) {
        // Bleed horizontal speed and spin so it floats out then settles before stamp.
        f.vx *= Math.pow(0.42, dt);
        f.vy *= Math.pow(0.42, dt);
        f.spin *= Math.pow(0.28, dt);
        if (f.vz > 40) f.vz *= Math.pow(0.55, dt);
      }
      if (f.linger) {
        f.wobble = (f.wobble ?? 0) + (f.wobFreq ?? 12) * dt;
        const spd = Math.hypot(f.vx, f.vy) || 1;
        const nx = f.vx / spd;
        const ny = f.vy / spd;
        const px = -ny;
        const py = nx;
        const w = f.wobble;
        const amp = f.wobAmp ?? 160;
        const osc = Math.sin(w) * amp + Math.sin(w * 2.37 + 0.8) * amp * 0.55;
        f.vx += px * osc * dt + range(-35, 35) * dt;
        f.vy += py * osc * dt + range(-35, 35) * dt;
        f.vz += Math.cos(w * 1.6) * amp * 0.35 * dt + range(-25, 25) * dt;
      }
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.angle += f.spin * dt;
      if (f.gravity) {
        f.z += f.vz * dt;
        f.vz -= Z_GRAVITY * (f.gravityMul ?? 1) * dt;
        if (f.shellEject) {
          // Casings: air drag + slope bounce, then damp so they don't skim far from the drop.
          if (f.shellHeat != null && f.shellHeat > 0) {
            // ~7s live cool; ground stamp keeps glowing after settle.
            f.shellHeat = Math.max(0, f.shellHeat - dt / 7);
          }
          f.vx *= Math.pow(0.86, dt);
          f.vy *= Math.pow(0.86, dt);
          if (f.vz <= 0) {
            const g = groundZ(this.s.world, f.x, f.y);
            if (f.z <= g && isWater(this.s.world, f.x, f.y)) {
              f.z = g;
              this.vanishInWater(f, 0.1);
            } else if (f.z <= g) {
              f.z = g;
              const spd = Math.hypot(f.vx, f.vy, f.vz);
              if (f.bounces > 0 && spd > CASING_BOUNCE_MIN_SPD) {
                f.bounces--;
                bounceDebrisSlope(this.s.world, f, 0.45);
                f.vx *= CASING_BOUNCE_KEEP_XY;
                f.vy *= CASING_BOUNCE_KEEP_XY;
                // Constant gravity: bounce lively with a minimum hop so it reads as a clink, not a blip.
                f.vz = Math.max(Math.abs(f.vz) * CASING_BOUNCE_KEEP_Z, CASING_BOUNCE_MIN_HOP);
                f.spin *= 0.55;
                floorSpin(f);
              } else {
                this.settleDebris(f);
              }
            }
          }
        } else {
          const drag = f.heliCrash ? 0.94 : f.rotorThrow ? 0.88 : f.boomBit ? 0.82 : 0.78;
          f.vx *= Math.pow(drag, dt);
          f.vy *= Math.pow(drag, dt);
          if (f.z > groundZ(this.s.world, f.x, f.y) + 2) {
            this.emitDebrisTrail(f, 1);
          }
          const g = groundZ(this.s.world, f.x, f.y);
          if (f.z <= g) {
            f.z = g;
            if (f.boomBit) {
              this.settleBoomBit(f);
            } else if (!f.trailOnly && isDeepWater(this.s.world, f.x, f.y)) {
              // Deep water: hulks, parts, rotors, turrets splash and sink (crash hulks still get their impact
              // burst, keeping their spin). Shallows fall through to the normal land death.
              if (f.heliCrash) {
                const spin = f.spin;
                this.impactHeliCrash(f);
                f.spin = spin;
              }
              this.beginWaterSink(f);
            } else {
              // Shallows: the normal land death below, plus the water impact (spray + ripple) deep water gets.
              if (!f.trailOnly && isWater(this.s.world, f.x, f.y)) this.waterSplash(f.x, f.y, f.z, Math.min(1.4, 0.3 + (f.scale ?? 1) * 0.7));
              if (!f.linger) this.s.groundMarks.stampDirtSmears(f.x, f.y, f.vx, f.vy);
              if (f.turretPop) this.turretTouchdown(f);
              if (f.heliCrash) {
                this.impactHeliCrash(f);
                this.settleDebris(f);
              } else if (f.rotorThrow) {
                f.spin *= 0.15;
                f.vx *= 0.2;
                f.vy *= 0.2;
                this.settleDebris(f);
              } else if (f.wheelRoll) {
                if (f.bounces > 0 && f.vz < -40) {
                  f.bounces--;
                  bounceDebrisSlope(this.s.world, f, 1);
                  f.spin *= 0.65;
                  this.s.groundMarks.stampDirtSmears(f.x, f.y, f.vx, f.vy);
                  const bang = Math.hypot(f.vx, f.vy) > 8 ? Math.atan2(f.vy, f.vx) : f.angle;
                  this.s.groundMarks.stampWheelTrack(f.x, f.y, bang, range(0.7, 0.95), range(0.32, 0.48));
                } else {
                  f.rolling = true;
                  f.vz = 0;
                  f.z = g;
                  const hang = Math.hypot(f.vx, f.vy) > 8 ? Math.atan2(f.vy, f.vx) : f.angle;
                  this.s.groundMarks.stampWheelTrack(f.x, f.y, hang, range(0.65, 0.9), range(0.28, 0.44));
                }
              } else if (debrisWillBounce(f)) {
                const ivx = f.vx;
                const ivy = f.vy;
                f.bounces--;
                // Same elevation bounce as wheels, weaker so flight path barely turns.
                bounceDebrisSlope(this.s.world, f, 0.32);
                if (!f.key.includes("organic")) this.s.groundMarks.stampDebrisBounceScorch(f.x, f.y, ivx, ivy);
                f.spin *= range(0.78, 1.22);
                f.spin += range(-2.4, 2.4);
                floorSpin(f);
                f.angle += range(-0.28, 0.28);
              } else {
                this.settleDebris(f);
              }
            }
          }
        }
      } else {
        f.vx *= Math.pow(0.08, dt);
        f.vy *= Math.pow(0.08, dt);
        f.life -= dt;
        if (f.life <= 0 || Math.hypot(f.vx, f.vy) < 8) {
          this.settleDebris(f);
        }
      }
      if (!(f.trailOnly && f.life <= 0 && !f.settled)) keep.push(f);
    }
    this.s.debris = keep;
    if (this.s.perf.enabled) {
      const t = performance.now();
      this.syncDebrisSprites();
      this.s.perf.current![8] = performance.now() - t;
    } else {
      this.syncDebrisSprites();
    }
  }

  tickPinnedRotor(f: Debris, dt: number): void {
    const host = f.pinHost!;
    const mount = f.pinMount ?? { x: 0.5, y: 0.5 };
    const at = debrisMountAt(this.s.textures, host, mount);
    f.x = at.x;
    f.y = at.y;
    f.z = host.z + 4;
    if (host.settled) {
      // Coast down very slowly after the hull lands.
      f.spin *= Math.pow(0.72, dt);
    }
    f.angle += f.spin * dt;
    const spinMag = Math.abs(f.spin);
    if (spinMag > 0.12 || !host.settled) {
      const dim = host.settled ? Phaser.Math.Clamp(spinMag / 8, 0.2, 1) : 1;
      this.emitDebrisTrail(f, dim);
    }
    if (host.settled && spinMag < 0.1) {
      this.settleDebris(f);
    }
  }

  tickWheelRoll(f: Debris, dt: number): void {
    const sl = groundSlope(this.s.world, f.x, f.y);
    const steep = Math.hypot(sl.dx, sl.dy);
    let ax = -sl.dx;
    let ay = -sl.dy;
    const al = Math.hypot(ax, ay);
    if (al > 1e-4) {
      ax /= al;
      ay /= al;
      const pull = 520 * steep;
      f.vx += ax * pull * dt;
      f.vy += ay * pull * dt;
    }
    const wet = isWater(this.s.world, f.x, f.y);
    // Rolled into deep water: splash and sink like other debris.
    if (wet && !f.trailOnly && isDeepWater(this.s.world, f.x, f.y)) {
      this.beginWaterSink(f);
      return;
    }
    const fric = steep > 0.07 ? 0.88 : steep > 0.04 ? 0.62 : 0.38;
    f.vx *= Math.pow(fric, dt);
    f.vy *= Math.pow(fric, dt);
    const spd = Math.hypot(f.vx, f.vy);
    const rad = Math.max(6, 11 * (f.scale ?? 1));
    if (spd > 1) {
      const cross = f.vx * ay - f.vy * ax;
      const sign = cross >= 0 ? 1 : -1;
      f.angle += (spd / rad) * dt * sign;
      f.spin = (spd / rad) * sign;
    } else {
      f.spin *= Math.pow(0.2, dt);
    }
    f.x += f.vx * dt;
    f.y += f.vy * dt;
    f.z = groundZ(this.s.world, f.x, f.y);
    if (spd > 22) this.emitDebrisTrail(f, 1);
    else if (spd > 10) this.emitDebrisTrail(f, 0.5);
    if (!wet && spd > 4) {
      f.track = (f.track ?? 0) + spd * dt;
      const gap = range(5, 14);
      if (f.track >= gap) {
        f.track = 0;
        const ang = Math.atan2(f.vy, f.vx);
        const sc = range(0.55, 0.88) * (f.scale ?? 1);
        this.s.groundMarks.stampWheelTrack(f.x, f.y, ang, sc, range(0.22, 0.42));
      }
    }
    if (wet || (spd < 6 && steep < 0.04)) {
      this.settleDebris(f);
    }
  }

  tickBoatSink(f: Debris, dt: number): void {
    const max = Math.max(0.5, f.sinkMax ?? 6);
    f.sinkT = (f.sinkT ?? 0) + dt;
    const u = Phaser.Math.Clamp(f.sinkT / max, 0, 1);
    // Ease in: slow at first, then drop under faster.
    const ease = u * u;
    f.x += f.vx * dt;
    f.y += f.vy * dt;
    f.vx *= Math.pow(0.35, dt);
    f.vy *= Math.pow(0.35, dt);
    f.angle += f.spin * dt;
    // Boats ease to a gentle yaw; other debris keeps its stunted spin, decaying slowly as it goes down.
    if (!f.waterSink) f.spin = Phaser.Math.Linear(f.spin, f.spin >= 0 ? 0.12 : -0.12, 1 - Math.pow(0.5, dt));
    else f.spin *= Math.pow(SINK_SPIN_DECAY, dt);
    // Water surface → bed below it; the camera projection shows the depth (no extra shrink).
    const surface = groundZ(this.s.world, f.x, f.y);
    const bed = bedZ(this.s.world, f.x, f.y);
    f.z = Phaser.Math.Linear(surface, bed, ease);
    f.vz = 0;
    f.scale = f.sinkScale0 ?? f.scale ?? 1;
    if (u >= 1) this.settleBoatSink(f);
  }

  settleBoatSink(f: Debris): void {
    f.settled = true;
    f.vx = 0;
    f.vy = 0;
    f.vz = 0;
    if (!f.trailOnly) {
      const o = debrisStampOrigin(f.key);
      const hs = wreckDrawScale(this.s.world, f.x, f.y, f.z || 0, f.scale ?? 1);
      // Baked blue sink art (boats and other sunk debris alike) — no runtime tint.
      this.s.groundMarks.stampWreck(f.key, f.x, f.y, f.angle, hs.sx, 0.8, o.x, o.y, hs.sy);
      f.trailOnly = true;
    }
    f.trailFade = 0;
    f.life = 0;
  }

  /** First touchdown of a popped-off turret: a small version of the heli-crash dust kick. */
  turretTouchdown(f: Debris): void {
    f.turretPop = false;
    if (isWater(this.s.world, f.x, f.y)) return;
    const s = Phaser.Math.Clamp(f.scale ?? 1, 0.4, 1.4);
    this.s.hostCraft.emitDustShock(f.x, f.y, 0.22 * s);
    // Skipping off: dirt sprays along the travel. Thudding to rest: it kicks straight up.
    const skip = debrisWillBounce(f);
    this.s.fx.spawnDirtParticles(f.x, f.y, f.z + 2, {
      n: Math.round(9 * s),
      spdMin: 50,
      spdMax: skip ? 150 : 170,
      bx: skip ? f.vx : f.vx * 0.15,
      by: skip ? f.vy : f.vy * 0.15,
      bz: skip ? 120 : 260,
      tight: skip ? 0.35 : 0.6,
      scaleMul: 0.8 * s,
    });
  }

  impactHeliCrash(f: Debris): void {
    const blast = 38 + (f.impactDust ?? 0.5) * 36;
    this.s.fx.heFireBurst(f.x, f.y, f.z + 6, 0, 0, 1, blast, false, 1.15, 0.42);
    // Crash splash: kills troops, dents vehicles, flattens light buildings.
    this.s.projectiles.applyBlastDamage(f.x, f.y, f.z, blast * 0.9, (f.impactDust ?? 0.5) * CRASH_DMG, undefined, f.vx, f.vy, 1);
    this.s.hostCraft.emitDustShock(f.x, f.y, f.impactDust ?? 0.5);
    this.s.camera.shake = Math.min(10, this.s.camera.shake + 2.4);
    let sc = Phaser.Math.Linear(0.85, 1.45, f.impactDust ?? 0.5) * range(0.9, 1.2);
    if (f.playerCrash) sc *= 1.12;
    if (!isDeepWater(this.s.world, f.x, f.y)) {
      this.s.groundMarks.stampBlastCrater(f.x, f.y, sc);
      this.s.groundMarks.spawnCraterEmbers(f.x, f.y, softCapBlastCraterScale(sc));
    }
    f.simmer = range(2.6, 4.4);
    f.spin = 0;
    f.spinAccel = 0;
    if (f.playerCrash) {
      this.playerCrashLanded = true;
      this.playerCrashSimmerT = Math.max(f.simmer ?? 2.6, 2.2);
      this.playerCrashEndT = -1; // wait for simmer to finish
    }
  }

  settleDebris(f: Debris): void {
    if (!f.shellEject && isWater(this.s.world, f.x, f.y)) this.s.ripples.spawn(f.x, f.y, 22 + 26 * (f.scale ?? 1), 0.6);
    if (f.linger) this.s.groundMarks.stampLightBlast(f.x, f.y, f.vx, f.vy);
    if (f.dishFlat) {
      this.s.hostCraft.emitDustShock(f.x, f.y, 0.95);
      this.s.groundMarks.stampDirtSmears(f.x, f.y, f.vx || range(-40, 40), f.vy || range(-40, 40));
    }
    if (f.crashPop && !isDeepWater(this.s.world, f.x, f.y)) {
      const sc = f.crashCraterScale ?? 0.9;
      this.s.groundMarks.stampBlastCrater(f.x, f.y, sc);
      this.s.groundMarks.spawnCraterEmbers(f.x, f.y, softCapBlastCraterScale(sc));
      this.s.hostCraft.emitDustShock(f.x, f.y, 0.55);
    }
    f.settled = true;
    f.vx = 0;
    f.vy = 0;
    f.vz = 0;
    if (!f.trailOnly) {
      const o = debrisStampOrigin(f.key);
      const hs = wreckDrawScale(this.s.world, f.x, f.y, f.z || 0, f.scale ?? 1);
      let sx = hs.sx;
      let sy = hs.sy;
      if (f.dishFlat) {
        sx *= 1.04;
        sy *= 0.76;
      } else if (f.rotorSkew) {
        sx *= 1.08;
        sy *= 0.78;
      }
      // Normal land death; small wreckage in shallows gets a light water tint (hulks keep theirs; the crater shows the water).
      const hulk = f.heliCrash || f.crashPop;
      const shallow = !hulk && isWater(this.s.world, f.x, f.y) ? shallowTint(themeOf(this.s.world.theme), SHALLOW_WRECK_MIX) : undefined;
      this.s.groundMarks.stampWreck(f.key, f.x, f.y, f.angle, sx, 0.92, o.x, o.y, sy, undefined, undefined, true, shallow);
      if (f.shellEject) {
        this.s.groundMarks.addThermalWreckMark(
          f.key,
          f.x,
          f.y,
          f.angle,
          sx,
          sy,
          o.x,
          o.y,
          undefined,
          "shell",
          f.shellHeat ?? 1
        );
      } else if (f.heliCrash || f.crashPop) {
        this.s.groundMarks.addThermalWreckMark(f.key, f.x, f.y, f.angle, sx, sy, o.x, o.y, undefined, "hulk");
      }
      f.trailOnly = true;
    }
    if (!f.heliCrash && !f.shellEject && !f.boomBit) this.beginDebrisTrailFade(f);
  }

  /** Water splash spray + ripple, sized 0..1+ (small bits ~0.1, hulks ~1). */
  waterSplash(x: number, y: number, z: number, size: number): void {
    const sc = Math.max(0.08, size);
    this.s.ripples.spawn(x, y, 10 + sc * 34, Math.min(1, 0.35 + sc * 0.5), 1.1 + sc * 0.6);
    this.s.fx.emitVisualBurst(
      x,
      y,
      z + 2,
      {
        n: Math.max(1, Math.round(2 + sc * 10)),
        spdMin: 40,
        spdMax: 140 + sc * 60,
        bx: 0,
        by: -0.35,
        bz: 1,
        tight: 0.55,
        scaleMul: 0.35 + sc * 0.9,
        gravity: 220,
        depthOff: ZOff.fire + 0.3,
      },
      this.s.fx.splashBurst
    );
  }

  /** Small object hits water: splash and remove (casings, flecks). */
  vanishInWater(f: Debris, size: number): void {
    this.waterSplash(f.x, f.y, f.z, size);
    f.vx = 0;
    f.vy = 0;
    f.vz = 0;
    f.trailOnly = true;
    // Not marked settled so the trailOnly+life cull can remove it this tick.
    f.trailFade = 0;
    f.life = 0;
    f.settled = false;
  }

  /** Debris / hulk lands in water: splash, then sink to the bed tinting blue (shares the boat-sink tick). */
  beginWaterSink(f: Debris): void {
    const sc = f.scale ?? 1;
    this.waterSplash(f.x, f.y, f.z, Math.min(1.4, 0.3 + sc * 0.7));
    f.z = groundZ(this.s.world, f.x, f.y);
    f.gravity = false;
    f.boatSink = true;
    f.waterSink = true;
    f.sinkT = 0;
    f.sinkMax = 2 + Math.min(3, sc * 2.4);
    f.sinkScale0 = sc;
    // Same submerged look as boat hulks: blue `_sink` art from the first frame.
    f.key = ensureSinkTexture(this.s.textures, f.key);
    f.vx *= 0.35;
    f.vy *= 0.35;
    f.vz = 0;
    // Water stunts spin ~85% but doesn't kill it (spinning heli hulks keep turning slowly as they go down).
    f.spin *= 0.15;
    f.spinAccel = 0;
    f.rolling = false;
  }

  /** Tiny mech fleck from a big boom: stamp on land, splash+delete in water. */
  settleBoomBit(f: Debris): void {
    f.vx = 0;
    f.vy = 0;
    f.vz = 0;
    if (!f.trailOnly) {
      if (isWater(this.s.world, f.x, f.y)) {
        this.waterSplash(f.x, f.y, f.z, Math.max(0.08, f.scale ?? 0.2));
      } else {
        const o = debrisStampOrigin(f.key);
        const sc = Math.max(0.05, f.scale ?? 0.08);
        const hs = wreckDrawScale(this.s.world, f.x, f.y, f.z || 0, sc);
        this.s.groundMarks.stampWreck(f.key, f.x, f.y, f.angle, hs.sx, 0.78, o.x, o.y, hs.sy);
      }
      f.trailOnly = true;
    }
    // Not marked settled so the trailOnly+life cull can remove it this tick.
    f.trailFade = 0;
    f.life = 0;
    f.settled = false;
  }

  beginDebrisTrailFade(f: Debris): void {
    // Unclamped size (emitDebrisTrail still clamps draw scale). Mid (~1) keeps current fade.
    const flameSc = this.debrisTrailSize(f);
    const over = Math.max(0, flameSc - 1.05);
    const stretch = 1 + over * (f.linger ? 0.7 : 1.35);
    const base = f.linger ? range(2.2, 3.8) : range(0.55, 1.05);
    f.trailFadeMax = base * stretch;
    f.trailFade = f.trailFadeMax;
  }

  /** Unclamped trail size band used for fade duration and particle lifespan. */
  debrisTrailSize(f: Debris): number {
    const r = f.trailR;
    if (f.trailSoft) return r / 4.8;
    let size = (r * Math.min(f.scale ?? 1, 1)) / (f.linger ? 6 : 6.5);
    // Dish trails keep trailR small for emit rate; lifespan should follow the big sprite.
    if (f.dishFlat || f.flamePts?.length) {
      size = Math.max(size, (this.s.unitSprites.texSpan(f.key) * (f.scale ?? 1)) / 48);
    }
    return size;
  }

  tickDebrisTrailFade(f: Debris, dt: number): void {
    if (f.trailFade == null) this.beginDebrisTrailFade(f);
    if ((f.trailFade ?? 0) <= 0) return;
    f.trailFade! -= dt;
    const dim = Phaser.Math.Clamp(f.trailFade! / (f.trailFadeMax || 1), 0, 1);
    if (dim > 0) this.emitDebrisTrail(f, dim * dim);
  }

  emitDebrisTrail(f: Debris, dim: number): void {
    if (dim <= 0.02) return;
    if (!cameraPointVisible(f.z, f.y)) return;
    if (f.boomBit) {
      // Sparse Hydra-style long smoke — not dense fire trails.
      const at = worldToScreen(f.x, f.y, f.z);
      this.s.fx.shotTrailAngle = Math.atan2(
        screenVelY(f.vy, f.vz, f.z, f.y),
        screenVelX(f.vx, f.vy, f.vz, f.x, f.y, f.z)
      );
      const n = this.s.fx.emitCount(0.22 * dim);
      if (n) {
        this.s.fx.withTrail(0.55 * (f.scale ?? 0.25) + 0.35, () =>
          this.s.fx.emitBudgeted(
            "smoke",
            this.s.fx.at(f.z, f.y, this.s.fx.rocketSmoke, ZOff.smoke - 0.2),
            at.x,
            at.y,
            n
          )
        );
      }
      return;
    }
    // Trails sit under the debris sprite (body ≈ 0); keep fire above smoke within the pair.
    const trailFire = -0.35;
    const trailSmoke = -1.15;
    const lifeMul = debrisTrailLifeMul(this.debrisTrailSize(f));
    if (f.flamePts?.length) {
      const ca = Math.cos(f.angle);
      const sa = Math.sin(f.angle);
      const flatX = f.dishFlat ? 1.04 : f.rotorSkew ? 1.08 : 1;
      const flatY = f.dishFlat ? 0.76 : f.rotorSkew ? 0.78 : 1;
      const { fire, smoke } = this.s.fx.pair(f.z, f.y, this.s.fx.flame, this.s.fx.hurtSmoke, trailFire, trailSmoke);
      // Flame trails keep their original smoke size (no fire-size match).
      this.s.fx.smokeMatchFire = 0;
      const prevLife = this.s.fx.trailFxLife;
      const prevDmg = this.s.fx.dmgFlameScale;
      this.s.fx.trailFxLife = lifeMul;
      try {
        for (const p of f.flamePts) {
          const lx = p.lx * flatX;
          const ly = p.ly * flatY;
          const worldX = f.x + lx * ca - ly * sa;
          const worldY = f.y + lx * sa + ly * ca;
          const at = worldToScreen(worldX, worldY, f.z);
          this.s.fx.dmgFlameScale = p.sc * (f.scale ?? 1) * (f.dishFlat ? 0.85 : 1.15);
          // Dense per point so each reads as a burning column, not lone sparks.
          const nFire = this.s.fx.emitCount(1.7 * dim);
          const nSmoke = this.s.fx.emitCount(0.7 * dim);
          if (nFire) this.s.fx.emitBudgeted("fire", fire, at.x, at.y, nFire * (p.lx === 0 && p.ly === 0 ? 2 : 1));
          if (nSmoke) this.s.fx.emitBudgeted("smoke", smoke, at.x, at.y, nSmoke);
        }
      } finally {
        this.s.fx.trailFxLife = prevLife;
        this.s.fx.dmgFlameScale = prevDmg;
      }
      return;
    }
    if (f.heliCrash) return;
    if (f.shellEject) return;
    if (f.trailLx == null || f.trailLy == null) {
      const rad = Math.max(3, Math.min((this.s.unitSprites.texSpan(f.key) * (f.scale ?? 1)) * 0.42, f.trailR * 0.9));
      const a = Math.random() * Math.PI * 2;
      const d = range(0.28, 0.92) * rad;
      f.trailLx = Math.cos(a) * d;
      f.trailLy = Math.sin(a) * d;
    }
    const ca = Math.cos(f.angle);
    const sa = Math.sin(f.angle);
    const lx = f.trailLx;
    const ly = f.trailLy;
    const trailAt = worldToScreen(
      f.x + lx * ca - ly * sa,
      f.y + lx * sa + ly * ca,
      f.z
    );
    const fireProto = f.trailSoft ? this.s.fx.tinyBurn : f.linger ? this.s.fx.lingerBurn : this.s.fx.burn;
    // Same long-lived drifting smoke as unit fires (short-trail smoke is a missile streak, gone in ~0.5s).
    const puffProto = f.linger ? this.s.fx.lingerSmoke : this.s.fx.hurtSmoke;
    const rawSc = this.debrisTrailSize(f);
    // Soft trails: size from trailR only (ignore debris sprite scale) so debris + blast embers match.
    const sc = f.trailSoft
      ? Phaser.Math.Clamp(rawSc, 1.4, 1.65)
      : Phaser.Math.Clamp(rawSc, 0.35, 2.75);
    // Soft fire uses tinyBurn (tiny base); keep smoke from inheriting its boost.
    const smokeSc = f.trailSoft ? Phaser.Math.Clamp(sc * 0.28, 0.32, 0.48) : sc;
    // No jitter: the trail rides the piece's offset point, so a spinning piece sweeps its flame around.
    const { fire, smoke: puff } = this.s.fx.pair(f.z, f.y, fireProto, puffProto, trailFire, trailSmoke);
    // Flame trails keep their original smoke size (no fire-size match).
    this.s.fx.smokeMatchFire = 0;
    const p = trailAt;
    const nFire = this.s.fx.emitCount((f.trailOnly ? 0.85 : 0.7) * dim);
    const nSmoke = this.s.fx.emitCount((f.trailOnly ? 0.65 : 0.5) * dim);
    if (nFire) {
      this.s.fx.withTrail(sc, () => this.s.fx.emitBudgeted("fire", fire, p.x, p.y, nFire), lifeMul);
    }
    if (nSmoke) {
      this.s.fx.withTrail(smokeSc, () => this.s.fx.emitBudgeted("smoke", puff, p.x, p.y, nSmoke), lifeMul);
    }
  }

  syncDebrisSprites(): void {
    let visN = 0;
    for (const f of this.s.debris) if (!f.trailOnly) visN++;
    while (this.debrisG.getLength() < visN * 2) {
      this.debrisG.add(this.s.add.image(0, 0, "fx_shadow"));
      this.debrisG.add(this.s.add.image(0, 0, "fx_debris_metal"));
    }
    const kids = this.debrisG.getChildren() as Phaser.GameObjects.Image[];
    for (const k of kids) {
      k.setVisible(false);
      const wrap = k.getData("tiltWrap") as Phaser.GameObjects.Container | undefined;
      if (wrap) wrap.setVisible(false);
    }
    let vi = 0;
    for (const f of this.s.debris) {
      if (f.trailOnly) continue;
      const i = vi++;
      const sh = kids[i * 2]!;
      const im = kids[i * 2 + 1]!;
      if (!cameraPointVisible(f.z || 0, f.y)) continue;
      const z = f.z || 0;
      const at = worldToScreen(f.x, f.y, z);
      const drawX = at.x;
      const drawY = at.y;
      if (!this.s.camera.projectedInView(drawX, drawY, 180)) continue;
      const { x: ox, y: oy } = spritePivot(f.key);
      const sc = (f.scale ?? 1) * at.scale;
      let sx = sc;
      let sy = sc;
      if (f.dishFlat) {
        sx = sc * 1.04;
        sy = sc * 0.76;
      } else if (f.rotorSkew) {
        sx = sc * 1.08;
        sy = sc * 0.78;
      }
      const cast = castZ(this.s.world, f.x, f.y, z);
      // Pinned rotors skip shadows (stay with hull). Thrown rotors / gun hulks need a baked atlas.
      const canShadow =
        !f.pinHost && !f.boatSink && !f.shellEject && this.s.textures.exists(shadowKey(f.key, cast));
      const depth = f.settled
        ? Layer.WRECK
        : f.shellEject
          ? worldDepth(z, f.shellUnder ? ZOff.shot - 0.4 : ZOff.turret + 0.85, f.y)
          : f.boomBit
            ? worldDepth(z, ZOff.fire + 3.6, f.y)
            : worldDepth(z, ZOff.body + (f.pinHost ? 0.55 : 0.35), f.y);
      const spd = Math.hypot(f.vx, f.vy);
      // Squash along travel; inner image keeps f.angle spin relative to heading.
      const wheelSquash = !!f.wheelRoll && !f.settled && spd > 8;
      if (wheelSquash) {
        const travelWorld = Math.atan2(f.vy, f.vx);
        const travel = projectHeading(travelWorld, f.x, f.y, z);
        const t = Phaser.Math.Clamp((spd - 8) / 160, 0, 1);
        // Squash perpendicular to travel (narrow across, slightly longer along).
        const along = Phaser.Math.Linear(1.04, 1.2, t);
        const across = Phaser.Math.Linear(0.9, 0.66, t);
        let wrap = im.getData("tiltWrap") as Phaser.GameObjects.Container | undefined;
        if (!wrap || !wrap.scene) {
          wrap = this.s.add.container(drawX, drawY);
          wrap.add(im);
          im.setData("tiltWrap", wrap);
        }
        wrap
          .setVisible(true)
          .setPosition(drawX, drawY)
          .setRotation(travel)
          .setScale(sc * along, sc * across)
          .setAlpha(1);
        if (wrap.depth !== depth) wrap.setDepth(depth);
        im.setVisible(true);
        if (im.texture.key !== f.key) im.setTexture(f.key);
        im.setOrigin(ox, oy)
          .setPosition(0, 0)
          .setRotation(f.angle - travel)
          .setScale(1)
          .setAlpha(1);
        applyThermalHeat(im, this.s.thermal.on, f.settled ? 0.27 : 0.62);
        if (canShadow) {
          sh.setVisible(true).setOrigin(ox, oy);
          this.s.hostCraft.applyCastShadow(sh, f.x, f.y, z, f.key, travel, f.scale ?? 1, 2, f);
          sh.setScale(sh.scaleX * along, sh.scaleY * across);
          if (cast < 1) sh.setAlpha(0.22);
        }
        continue;
      }
      // Rotor hulks: fixed foreshortened tilt plane; blades spin inside the wrap.
      if (f.rotorSkew && !f.settled) {
        const skew = f.skewAng ?? 0.28;
        const along = 1.08;
        const across = 0.78;
        let wrap = im.getData("tiltWrap") as Phaser.GameObjects.Container | undefined;
        if (!wrap || !wrap.scene) {
          wrap = this.s.add.container(drawX, drawY);
          wrap.add(im);
          im.setData("tiltWrap", wrap);
        }
        wrap
          .setVisible(true)
          .setPosition(drawX, drawY)
          .setRotation(skew)
          .setScale(sc * along, sc * across)
          .setAlpha(1);
        if (wrap.depth !== depth) wrap.setDepth(depth);
        im.setVisible(true);
        if (im.texture.key !== f.key) im.setTexture(f.key);
        im.setOrigin(ox, oy)
          .setPosition(0, 0)
          .setRotation(f.angle - skew)
          .setScale(1)
          .setAlpha(1);
        applyThermalHeat(im, this.s.thermal.on, f.settled ? 0.27 : 0.62);
        if (canShadow) {
          sh.setVisible(true).setOrigin(ox, oy);
          this.s.hostCraft.applyCastShadow(sh, f.x, f.y, z, f.key, skew, f.scale ?? 1, 2, f);
          sh.setScale(sh.scaleX * along, sh.scaleY * across);
          if (cast < 1) sh.setAlpha(0.22);
        }
        continue;
      }
      this.s.hostCraft.unwrapTilt(im);
      if (canShadow) {
        sh.setVisible(true).setOrigin(ox, oy);
        this.s.hostCraft.applyCastShadow(sh, f.x, f.y, z, f.key, f.angle, f.scale ?? 1, 2, f);
        if (f.dishFlat) sh.setScale(sh.scaleX * 1.04, sh.scaleY * 0.76);
        if (f.rotorSkew) sh.setScale(sh.scaleX * 1.08, sh.scaleY * 0.78);
        if (cast < 1) sh.setAlpha(0.22);
      }
      const sinkU =
        f.boatSink && !f.settled
          ? Phaser.Math.Clamp((f.sinkT ?? 0) / Math.max(0.5, f.sinkMax ?? 6), 0, 1)
          : -1;
      im.clearTint();
      im.setVisible(true);
      if (im.texture.key !== f.key) im.setTexture(f.key);
      im.setOrigin(ox, oy)
        .setPosition(drawX, drawY)
        .setRotation(projectHeading(f.angle, f.x, f.y, z))
        .setScale(sx, sy)
        .setAlpha(
          f.settled ? 0.92 : sinkU >= 0 ? Phaser.Math.Linear(0.92, 0.78, sinkU * sinkU) : 1
        );
      // Casings: timed cool-down (not speed); ground stamp keeps a longer thermal mark.
      if (f.shellEject) {
        const shellHeat = (f.shellHeat ?? 0) * 0.72;
        if (shellHeat > 0.02) applyThermalHeat(im, this.s.thermal.on, shellHeat);
      } else {
        applyThermalHeat(im, this.s.thermal.on, f.settled ? 0.27 : 0.64);
      }
      if (im.depth !== depth) im.setDepth(depth);
    }
  }
}
