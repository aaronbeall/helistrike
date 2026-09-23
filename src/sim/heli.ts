import Phaser from "phaser";
import {
  craftControlScheme,
  craftGunPreferOffset,
  craftOf,
  craftRotorFlightSpeed,
  craftRotorSpoolDur,
  craftRotorSpoolPeak,
  craftSocketBarrelCount,
  type CraftKind,
  type CraftSpec,
} from "./craft";
import { groundZ, WORLD, type WorldData } from "../worldgen/world";

export interface Stick {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

/** True when a world XY is inside the playable map rectangle. */
export function pointInPlayableMap(x: number, y: number): boolean {
  return x >= 0 && x <= WORLD && y >= 0 && y <= WORLD;
}

/**
 * Soft hard-stop past the playable map for leave-theater craft (planes).
 * Past the edge the camera sees sky / clouds (missionScene leave-theater field).
 */
export const MAP_AIR_SOFT = 480;

/**
 * Leave-theater + forced U-turn + free chase cam.
 * Planes (Warthog, Gunship) and plane-scheme VTOL (Lightning).
 */
export function craftHasForcedUTurn(spec: CraftSpec): boolean {
  return spec.flightModel === "plane" || craftControlScheme(spec) === "plane";
}

/**
 * Chase camera / scroll clamp only for craft without forced U-turn
 * (helis + non-plane-scheme VTOL like Osprey / Prometheus).
 */
export function craftCameraEdgeLocked(spec: CraftSpec): boolean {
  return !craftHasForcedUTurn(spec);
}

/** Nape / cruise / pop-up ceilings are AGL (added to local groundZ), not world Z. */
export const LOW_AGL = 4;
export const CRUISE_AGL = 46;
export const MAX_AGL = 118;
export const FWD_THRUST = 520;
export const STRAFE_THRUST = 340;
/** Collective climb/dive accel — matched to strafe. */
export const Z_THRUST = STRAFE_THRUST;
/** Gentle collective toward cruise. Far weaker than Z_THRUST. */
export const CRUISE_THRUST = 36;
export const CRUISE_DAMP = 2.2;
/** How fast cruise's ground reference tracks real terrain. Low = ignore rivers. */
export const GND_FOLLOW = 0.55;

/** Rotor speed before dust-off starts kicking in during spool (Apache-ref units). */
const DUST_ROTOR_MIN = 15;
const DUST_ROTOR_MIN_REF_PEAK = 26;
/** Pad sit height above ground while waiting for lift-off (landing-gear clearance). */
const PAD_AGL = 5.5;
/** Max gun depression below horizontal for jets (radians). */
export const JET_GUN_MAX_DEPRESS = (28 * Math.PI) / 180;
/** Mild upward elevation cap for jet guns. */
export const JET_GUN_MAX_ELEV = (12 * Math.PI) / 180;

export type Phase = "grounded" | "spool" | "ready" | "flight" | "dead";

export class Heli {
  craft: CraftKind;
  x: number;
  y: number;
  z: number;
  vx = 0;
  vy = 0;
  vz = 0;
  angle = 0;
  angVel = 0;
  pitch = 0;
  roll = 0;
  rotor = 0;
  rotorSpd = 0;
  /** Primary / player-aimed turret bearing (synced from the active station). */
  gunAngle = 0;
  /** Per-socket, per-barrel aim bearings — multi-gun cabins track each barrel. */
  stationAim: number[][] = [];
  health: number;
  phase: Phase = "grounded";
  /** Elapsed time in spool. */
  spool = 0;
  /**
   * After spool, if Space was already held, wait for a release before a press
   * can hand over controls (avoids auto-lift when mashing through spool).
   */
  readySpaceLatch = false;
  weapon = 0;
  fireCd = 0;
  immune = false;
  /** Hard lock for lock_on weapons (unit id). */
  lockTarget: { id: number } | null = null;
  /** Soft acquire while dwelling for lock_on (unit id + elapsed). */
  lockAcquire: { id: number; t: number } | null = null;
  /** Persistent solid-pixel damage locations on the craft body. */
  dmgSites: { u: number; v: number; scale: number }[] = [];
  gndSmooth: number;
  killDx = 0;
  killDy = 0;
  /** Fixed-wing automatic recovery turn near the theater boundary. */
  edgeTurn = false;
  /** Smoothed visual engine output; does not feed back into flight physics. */
  thrustPower = 0;
  /** Seconds of gun-brake — lowers plane minSpeed floor while cannons fire. */
  gunBrakeT = 0;

  constructor(x: number, y: number, world: WorldData, craft: CraftKind = craftOf().kind) {
    this.craft = craft;
    this.x = x;
    this.y = y;
    this.health = craftOf(craft).health;
    this.gndSmooth = groundZ(world, x, y);
    this.z = this.gndSmooth + PAD_AGL;
    this.stationAim = craftOf(craft).sockets.map((_, i) =>
      Array.from({ length: craftSocketBarrelCount(craftOf(craft), i) }, () => 0)
    );
  }

  /** Align station aims to rest headings (nose / craft→mount outward) and sync gunAngle. */
  syncStationAimToHull(): void {
    const c = this.spec;
    for (let i = 0; i < this.stationAim.length; i++) {
      const barrels = this.stationAim[i]!;
      const socket = c.sockets[i];
      const usePrefer =
        !!socket && socket.class === "turret";
      for (let b = 0; b < barrels.length; b++) {
        barrels[b] = usePrefer
          ? Phaser.Math.Angle.Wrap(this.angle + craftGunPreferOffset(c, i, b))
          : this.angle;
      }
    }
    const first = this.stationAim.find((a) => a.length > 0)?.[0];
    this.gunAngle = first ?? this.angle;
  }

  get spec() {
    return craftOf(this.craft);
  }

  get height(): number {
    return this.spec.height;
  }

  private get spoolDur(): number {
    return craftRotorSpoolDur(this.spec);
  }

  private get rotorFlight(): number {
    return craftRotorFlightSpeed(this.spec);
  }

  private get rotorSpoolPeak(): number {
    return craftRotorSpoolPeak(this.spec);
  }

  startAirborne(angle: number, world: WorldData): void {
    this.angle = angle;
    this.phase = "flight";
    this.gndSmooth = groundZ(world, this.x, this.y);
    this.z = this.gndSmooth + this.spec.cruiseAgl;
    this.vx = Math.cos(angle) * this.spec.minSpeed;
    this.vy = Math.sin(angle) * this.spec.minSpeed;
    this.vz = 0;
    const planeScheme = craftControlScheme(this.spec) === "plane";
    this.thrustPower = this.spec.flightModel === "plane" || planeScheme ? 0.55 : 0.22;
    this.syncStationAimToHull();
  }

  get noseX(): number {
    return this.x + Math.cos(this.angle) * 42;
  }
  get noseY(): number {
    return this.y + Math.sin(this.angle) * 42;
  }

  /** 0 at pad start → 1 once flight controls unlock. */
  get takeoffProgress(): number {
    if (this.phase === "grounded") return 0;
    if (this.phase === "spool") return Phaser.Math.Clamp(this.spool / this.spoolDur, 0, 1) * 0.85;
    if (this.phase === "ready") return 0.85;
    return 1;
  }

  /** Dust-off intensity 0→1: waits for visible rotor speed, then builds; holds on ready. */
  get dustPower(): number {
    if (this.phase === "spool") {
      const peak = this.rotorSpoolPeak;
      const dustMin = peak * (DUST_ROTOR_MIN / DUST_ROTOR_MIN_REF_PEAK);
      if (this.rotorSpd < dustMin) return 0;
      const u = Phaser.Math.Clamp(
        (this.rotorSpd - dustMin) / Math.max(1, peak - dustMin),
        0,
        1
      );
      return Math.pow(u, 1.35);
    }
    if (this.phase === "ready") return 1;
    return 0;
  }

  update(
    dt: number,
    world: WorldData,
    stick: Stick,
    aimX: number,
    aimY: number,
    spaceDown: boolean,
    shiftDown: boolean
  ): void {
    if (this.phase === "dead") return;
    const up = stick.up;
    const down = stick.down;
    const left = stick.left;
    const right = stick.right;

    if (this.phase === "grounded") {
      this.spool = 0;
      this.phase = "spool";
    }

    if (this.phase === "spool") {
      this.spool += dt;
      const spoolDur = this.spoolDur;
      const peak = this.rotorSpoolPeak;
      const t = Phaser.Math.Clamp(this.spool / spoolDur, 0, 1);
      // Typical helis crawl then snap; short craft spools ramp more aggressively.
      const spin = spoolDur < 1 ? t * t : t * t * t;
      this.rotorSpd = spin * peak;
      if (t >= 1) {
        this.phase = "ready";
        this.readySpaceLatch = spaceDown;
        this.rotorSpd = peak;
      }
    }

    if (this.phase === "ready") {
      this.rotorSpd = Phaser.Math.Linear(this.rotorSpd, this.rotorFlight, 1 - Math.pow(0.12, dt));
      if (this.readySpaceLatch) {
        if (!spaceDown) this.readySpaceLatch = false;
      } else if (spaceDown) {
        this.phase = "flight";
        this.vz = 0;
      }
    }

    const controllable = this.phase === "flight";
    this.rotor += this.rotorSpd * dt;
    if (this.gunBrakeT > 0) this.gunBrakeT = Math.max(0, this.gunBrakeT - dt);

    const planeScheme = craftControlScheme(this.spec) === "plane";
    const orbit = craftControlScheme(this.spec) === "orbit";
    const groundDrive = this.spec.flightModel === "ground";
    const outside = !pointInPlayableMap(this.x, this.y);
    const aimInside = pointInPlayableMap(aimX, aimY);
    // Off-map recovery: respect an in-map mouse aim; otherwise blend aim with map center.
    const turnX =
      outside && !aimInside ? (aimX + WORLD * 0.5) * 0.5 : aimX;
    const turnY =
      outside && !aimInside ? (aimY + WORLD * 0.5) * 0.5 : aimY;
    const turnAng = Math.atan2(turnY - this.y, turnX - this.x);

    // Default: nose toward reticle. Gunship yaws with A/D hold (below).
    let desired = orbit ? this.angle : turnAng;
    const uTurn = craftHasForcedUTurn(this.spec);
    if (outside && uTurn) {
      // Forced U-turn while off-map — turn target rules above always apply.
      this.edgeTurn = true;
      desired = turnAng;
    } else {
      this.edgeTurn = false;
      if (!orbit && controllable && this.spec.flightModel === "plane" && left !== right) {
        // Circling: A/D retarget yaw to ±90° from mouse aim (same momentum yaw as mouse turn).
        desired = turnAng + (right ? Math.PI / 2 : -Math.PI / 2);
      } else if (!orbit) {
        desired = turnAng;
      }
    }
    if (controllable && orbit && !outside) {
      // Hold-to-turn: A/D applies yaw rate while pressed; release stops turning.
      const steerIn = (right ? 1 : 0) + (left ? -1 : 0);
      const maxRate = this.spec.yawRate;
      const targetRate = steerIn * maxRate;
      const yawAcc = this.spec.yawAccel;
      if (this.angVel < targetRate) this.angVel = Math.min(targetRate, this.angVel + yawAcc * dt);
      else this.angVel = Math.max(targetRate, this.angVel - yawAcc * dt);
      this.angle += this.angVel * dt;
    } else if (controllable) {
      const err = Phaser.Math.Angle.Wrap(desired - this.angle);
      // Banked jets turn tighter — roll feeds yaw authority.
      const bankMul = planeScheme ? 1 + Math.abs(this.roll) * 0.85 : 1;
      const maxRate = this.spec.yawRate * bankMul;
      const targetRate = Phaser.Math.Clamp(err * 5.4, -maxRate, maxRate);
      const yawAcc = this.spec.yawAccel * (planeScheme ? 1 + Math.abs(this.roll) * 0.45 : 1);
      if (this.angVel < targetRate) this.angVel = Math.min(targetRate, this.angVel + yawAcc * dt);
      else this.angVel = Math.max(targetRate, this.angVel - yawAcc * dt);
      this.angle += this.angVel * dt;
    } else {
      this.angVel *= Math.pow(0.04, dt);
    }
    // Chin gun aim is updated in MissionScene from the mount (not heli center).

    const ca = Math.cos(this.angle);
    const sa = Math.sin(this.angle);
    let ax = 0;
    let ay = 0;
    const fwd = (up ? 1 : 0) + (down ? -1 : 0);
    const str = (right ? 1 : 0) + (left ? -1 : 0);
    const collective = (spaceDown ? 1 : 0) + (shiftDown ? -1 : 0);
    const idlePower =
      this.spec.flightModel === "plane" || planeScheme || groundDrive ? 0.55 : 0.22;
    const forwardPower = fwd < 0
      ? Math.abs(fwd) * ((this.spec.reverseThrust ?? this.spec.forwardThrust) / this.spec.forwardThrust)
      : Math.abs(fwd);
    // Spool / ready bring the engines up; flight follows stick load.
    let thrustTarget = 0;
    if (controllable) {
      const steerLoad = orbit
        ? Math.abs(this.angVel) / Math.max(0.2, this.spec.yawRate)
        : Math.abs(str);
      thrustTarget = Math.max(idlePower, forwardPower, steerLoad, Math.abs(collective));
    } else if (this.phase === "spool") {
      const spoolDur = this.spoolDur;
      const t = Phaser.Math.Clamp(this.spool / spoolDur, 0, 1);
      const spin = spoolDur < 1 ? t * t : t * t * t;
      thrustTarget = idlePower * spin;
    } else if (this.phase === "ready") {
      thrustTarget = idlePower;
    }
    this.thrustPower = Phaser.Math.Linear(
      this.thrustPower,
      thrustTarget,
      1 - Math.pow(0.08, dt)
    );
    if (controllable) {
      const load = Phaser.Math.Clamp(
        (this.thrustPower - idlePower) / Math.max(0.08, 1 - idlePower),
        0,
        1
      );
      const rotorTarget = this.rotorFlight * (1 + 0.2 * load);
      this.rotorSpd = Phaser.Math.Linear(this.rotorSpd, rotorTarget, 1 - Math.pow(0.16, dt));
      const longitudinalThrust = fwd < 0
        ? (this.spec.reverseThrust ?? this.spec.forwardThrust)
        : this.spec.forwardThrust;
      // Gunship (orbit + plane): speed trimmed below — skip axial thrust so W/S aren't cancelled by drag.
      // Hover tank / AGV (orbit + vtol|ground): W/S push forward/back along nose.
      if (!(orbit && this.spec.flightModel === "plane")) {
        ax += ca * fwd * longitudinalThrust;
        ay += sa * fwd * longitudinalThrust;
      }
      // Ground tanks never strafe — A/D is yaw only (even if strafeThrust is authored).
      if (!groundDrive) {
        ax += -sa * str * this.spec.strafeThrust;
        ay += ca * str * this.spec.strafeThrust;
      }
    }
    this.vx += ax * dt;
    this.vy += ay * dt;
    const drag = controllable ? this.spec.drag : 8;
    this.vx *= Math.pow(1 / (1 + drag * dt), 1);
    this.vy *= Math.pow(1 / (1 + drag * dt), 1);
    // Fixed-wing (incl. Gunship orbit trim): lock speed along heading.
    // Ground tanks: full heading lock — body angle is the trajectory (no slide).
    if (controllable && (this.spec.flightModel === "plane" || groundDrive)) {
      const headingX = Math.cos(this.angle);
      const headingY = Math.sin(this.angle);
      // Gun fire dips the floor so recoil can bleed speed on a gun run.
      const minFloor =
        planeScheme && this.gunBrakeT > 0 ? this.spec.minSpeed * 0.68 : this.spec.minSpeed;
      let along = this.vx * headingX + this.vy * headingY;
      if (groundDrive) {
        const maxRev = this.spec.maxReverseSpeed ?? this.spec.maxSpeed;
        along = Phaser.Math.Clamp(along, -maxRev, this.spec.maxSpeed);
        this.vx = headingX * along;
        this.vy = headingY * along;
      } else {
        if (orbit) {
          // Hold-to-trim: W climbs toward max, S bleeds toward min; coast holds current.
          const trim =
            fwd > 0 ? this.spec.maxSpeed : fwd < 0 ? minFloor : Phaser.Math.Clamp(along, minFloor, this.spec.maxSpeed);
          const catchUp = fwd !== 0 ? 2.8 : 1.6;
          along = Phaser.Math.Linear(along, trim, 1 - Math.exp(-catchUp * dt));
        }
        const forwardSpeed = Math.max(minFloor, along);
        // Jets keep more lateral momentum through a banked turn.
        const slipDamp = planeScheme ? 0.72 : 2.2;
        const lateralSpeed =
          (-this.vx * headingY + this.vy * headingX) * Math.exp(-slipDamp * dt);
        this.vx = headingX * forwardSpeed - headingY * lateralSpeed;
        this.vy = headingY * forwardSpeed + headingX * lateralSpeed;
      }
    }
    const maxReverse = this.spec.maxReverseSpeed;
    if (maxReverse != null && !groundDrive) {
      const along = this.vx * ca + this.vy * sa;
      if (along < -maxReverse) {
        const lateral = -this.vx * sa + this.vy * ca;
        this.vx = ca * -maxReverse - sa * lateral;
        this.vy = sa * -maxReverse + ca * lateral;
      }
    }
    const spd = Math.hypot(this.vx, this.vy);
    const max = this.spec.maxSpeed;
    if (spd > max) {
      this.vx *= max / spd;
      this.vy *= max / spd;
    }
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    // Leave + forced U-turn craft may exit the playable rectangle into a soft
    // off-map skirt, then U-turn inland. Everyone else is hard-clamped
    // (camera uses the same predicate via craftCameraEdgeLocked).
    if (!craftHasForcedUTurn(this.spec)) {
      const margin = 40;
      this.x = Phaser.Math.Clamp(this.x, margin, WORLD - margin);
      this.y = Phaser.Math.Clamp(this.y, margin, WORLD - margin);
      if (this.x <= margin && this.vx < 0) this.vx = 0;
      else if (this.x >= WORLD - margin && this.vx > 0) this.vx = 0;
      if (this.y <= margin && this.vy < 0) this.vy = 0;
      else if (this.y >= WORLD - margin && this.vy > 0) this.vy = 0;
    } else {
      const soft = MAP_AIR_SOFT;
      this.x = Phaser.Math.Clamp(this.x, -soft, WORLD + soft);
      this.y = Phaser.Math.Clamp(this.y, -soft, WORLD + soft);
    }

    const gnd = groundZ(world, this.x, this.y);
    this.gndSmooth += (gnd - this.gndSmooth) * (1 - Math.exp(-GND_FOLLOW * dt));
    if (groundDrive) {
      // Dirt-locked — pad AGL only, no collective loft.
      this.z = this.gndSmooth + this.spec.cruiseAgl;
      this.vz = 0;
    } else if (this.phase === "spool" || this.phase === "ready") {
      this.z = this.gndSmooth + PAD_AGL;
      this.vz = 0;
    } else if (controllable) {
      const minZ = gnd + LOW_AGL;
      const maxZ = gnd + this.spec.maxAgl;
      const restZ = this.gndSmooth + this.spec.cruiseAgl;
      const zIn = (spaceDown ? 1 : 0) + (shiftDown ? -1 : 0);
      let az = zIn * this.spec.verticalThrust;
      if (zIn === 0) {
        az += Phaser.Math.Clamp(
          restZ - this.z,
          -this.spec.cruiseThrust,
          this.spec.cruiseThrust
        );
        this.vz *= Math.pow(1 / (1 + CRUISE_DAMP * dt), 1);
      }
      const ceilPad = 26;
      const floorPad = 14;
      const toCeil = maxZ - this.z;
      const toFloor = this.z - minZ;
      if (toCeil < ceilPad) {
        const u = Phaser.Math.Clamp(1 - toCeil / ceilPad, 0, 1);
        az -= u * u * 780;
        if (this.vz > 0) this.vz *= Math.pow(1 / (1 + 8 * u * dt), 1);
      }
      if (toFloor < floorPad) {
        const u = Phaser.Math.Clamp(1 - toFloor / floorPad, 0, 1);
        az += u * u * 780;
        if (this.vz < 0) this.vz *= Math.pow(1 / (1 + 8 * u * dt), 1);
      }
      this.vz += az * dt;
      this.vz *= Math.pow(1 / (1 + drag * dt), 1);
      if (Math.abs(this.vz) > max) this.vz = Math.sign(this.vz) * max;
      this.z += this.vz * dt;
      if (this.z < minZ) {
        this.z = minZ;
        if (this.vz < 0) this.vz *= 0.2;
      } else if (this.z > maxZ) {
        this.z = maxZ;
        if (this.vz > 0) this.vz *= 0.2;
      }
    }

    const localFwd = this.vx * ca + this.vy * sa;
    const localStr = -this.vx * sa + this.vy * ca;
    if (this.spec.flatHull && controllable) {
      // Flat hulls stay upright — no roll bank (orbit yaw / plane turn / VTOL strafe).
      this.roll = Phaser.Math.Linear(this.roll, 0, 1 - Math.pow(0.04, dt));
      if (groundDrive) {
        this.pitch = Phaser.Math.Linear(this.pitch, 0, 1 - Math.pow(0.06, dt));
      } else {
        this.pitch = Phaser.Math.Linear(
          this.pitch,
          Phaser.Math.Clamp(localFwd / (planeScheme ? 320 : 280), planeScheme ? -0.28 : -0.18, planeScheme ? 0.32 : 0.18),
          1 - Math.pow(0.06, dt)
        );
      }
    } else if (planeScheme && controllable) {
      // Bank into the turn from yaw rate; keep a bit of slip lean for feel.
      const yawBank = Phaser.Math.Clamp(
        -this.angVel / Math.max(0.35, this.spec.yawRate) * 0.95,
        -0.92,
        0.92
      );
      const slipBank = Phaser.Math.Clamp(localStr / 220, -0.32, 0.32);
      this.roll = Phaser.Math.Linear(
        this.roll,
        Phaser.Math.Clamp(yawBank + slipBank, -0.95, 0.95),
        1 - Math.pow(0.02, dt)
      );
      this.pitch = Phaser.Math.Linear(
        this.pitch,
        Phaser.Math.Clamp(localFwd / 320, -0.28, 0.32),
        1 - Math.pow(0.06, dt)
      );
    } else if (orbit && controllable) {
      // Mild bank from A/D yaw rate — mouse aims guns only.
      const yawBank = Phaser.Math.Clamp(
        -this.angVel / Math.max(0.2, this.spec.yawRate) * 0.72,
        -0.55,
        0.55
      );
      this.roll = Phaser.Math.Linear(this.roll, yawBank, 1 - Math.pow(0.05, dt));
      this.pitch = Phaser.Math.Linear(
        this.pitch,
        Phaser.Math.Clamp(localFwd / 280, -0.22, 0.22),
        1 - Math.pow(0.06, dt)
      );
    } else {
      this.pitch = Phaser.Math.Linear(
        this.pitch,
        controllable ? Phaser.Math.Clamp(localFwd / 240, -0.42, 0.42) : 0,
        1 - Math.pow(0.06, dt)
      );
      this.roll = Phaser.Math.Linear(
        this.roll,
        controllable ? Phaser.Math.Clamp(localStr / 200, -0.4, 0.4) : 0,
        1 - Math.pow(0.06, dt)
      );
    }
    this.fireCd = Math.max(0, this.fireCd - dt);
  }

  /** Reverse thrust along −gun bore (physics only) — jets / opted-in sockets. */
  applyGunRecoil(impulse: number, gunAngle = this.angle): void {
    if (impulse <= 0) return;
    const ca = Math.cos(gunAngle);
    const sa = Math.sin(gunAngle);
    this.vx -= ca * impulse;
    this.vy -= sa * impulse;
    this.gunBrakeT = Math.max(this.gunBrakeT, 0.28);
  }

  kill(): void {
    this.phase = "dead";
    this.health = 0;
  }

  damage(n: number, dx?: number, dy?: number): void {
    if (this.immune) return;
    if (this.phase === "dead") return;
    if (dx != null && dy != null && (dx || dy)) {
      this.killDx = dx;
      this.killDy = dy;
    }
    this.health -= n;
    if (this.health <= 0) this.kill();
  }
}
