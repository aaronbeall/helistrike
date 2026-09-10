import Phaser from "phaser";
import { craftOf, type CraftKind } from "./craft";
import { groundZ, WORLD, type WorldData } from "./world";

export interface Stick {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
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

/** Rotor spool before the lift-off prompt (seconds). */
export const SPOOL_DUR = 2.35;
const ROTOR_SPOOL_PEAK = 26;
const ROTOR_FLIGHT = 32;
/** Rotor speed before dust-off starts kicking in during spool. */
const DUST_ROTOR_MIN = 15;
/** Pad sit height above ground while waiting for lift-off (landing-gear clearance). */
const PAD_AGL = 5.5;

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
  /** Primary / player-aimed turret bearing (synced from the active gunner station). */
  gunAngle = 0;
  /** Per-socket aim bearing — automatic stations track independently of player aim. */
  stationAim: number[] = [];
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
  hellfireLock: { id: number } | null = null;
  hellfireSeek: { id: number; t: number } | null = null;
  /** Persistent solid-pixel damage locations on the craft body. */
  dmgSites: { u: number; v: number; scale: number }[] = [];
  gndSmooth: number;
  killDx = 0;
  killDy = 0;
  /** Fixed-wing automatic recovery turn near the theater boundary. */
  edgeTurn = false;
  /** Smoothed visual engine output; does not feed back into flight physics. */
  thrustPower = 0;

  constructor(x: number, y: number, world: WorldData, craft: CraftKind = craftOf().kind) {
    this.craft = craft;
    this.x = x;
    this.y = y;
    this.health = craftOf(craft).health;
    this.gndSmooth = groundZ(world, x, y);
    this.z = this.gndSmooth + PAD_AGL;
    this.stationAim = craftOf(craft).sockets.map(() => 0);
  }

  /** Align all station aims (and gunAngle) to the current hull heading. */
  syncStationAimToHull(): void {
    for (let i = 0; i < this.stationAim.length; i++) this.stationAim[i] = this.angle;
    this.gunAngle = this.angle;
  }

  get spec() {
    return craftOf(this.craft);
  }

  get height(): number {
    return this.spec.height;
  }

  private get spoolDur(): number {
    return this.spec.spoolDur ?? SPOOL_DUR;
  }

  private get rotorFlight(): number {
    return this.spec.rotorFlight ?? ROTOR_FLIGHT;
  }

  private get rotorSpoolPeak(): number {
    return this.spec.rotorFlight != null
      ? this.spec.rotorFlight * (ROTOR_SPOOL_PEAK / ROTOR_FLIGHT)
      : ROTOR_SPOOL_PEAK;
  }

  startAirborne(angle: number, world: WorldData): void {
    this.angle = angle;
    this.phase = "flight";
    this.gndSmooth = groundZ(world, this.x, this.y);
    this.z = this.gndSmooth + this.spec.cruiseAgl;
    this.vx = Math.cos(angle) * this.spec.minSpeed;
    this.vy = Math.sin(angle) * this.spec.minSpeed;
    this.vz = 0;
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
      const dustMin = peak * (DUST_ROTOR_MIN / ROTOR_SPOOL_PEAK);
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
    if (controllable) {
      this.rotorSpd = Phaser.Math.Linear(this.rotorSpd, this.rotorFlight, 1 - Math.pow(0.2, dt));
    }

    let desired = Math.atan2(aimY - this.y, aimX - this.x);
    if (this.spec.flightModel === "plane") {
      const margin = 40;
      const outside =
        this.x <= margin ||
        this.x >= WORLD - margin ||
        this.y <= margin ||
        this.y >= WORLD - margin;
      if (outside) this.edgeTurn = true;
      const inlandPad = 220;
      const safelyInland =
        this.x > margin + inlandPad &&
        this.x < WORLD - margin - inlandPad &&
        this.y > margin + inlandPad &&
        this.y < WORLD - margin - inlandPad;
      const midX = (WORLD * 0.5 + aimX) * 0.5;
      const midY = (WORLD * 0.5 + aimY) * 0.5;
      const toMx = midX - this.x;
      const toMy = midY - this.y;
      const toMLen = Math.max(1, Math.hypot(toMx, toMy));
      const headingIn =
        (Math.cos(this.angle) * toMx + Math.sin(this.angle) * toMy) / toMLen;
      if (this.edgeTurn && safelyInland && headingIn > 0.55) this.edgeTurn = false;
      if (this.edgeTurn) desired = Math.atan2(toMy, toMx);
    }
    if (controllable) {
      const err = Phaser.Math.Angle.Wrap(desired - this.angle);
      const maxRate = this.spec.yawRate;
      const targetRate = Phaser.Math.Clamp(err * 5.4, -maxRate, maxRate);
      const yawAcc = this.spec.yawAccel;
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
    const idlePower = this.spec.flightModel === "plane" ? 0.55 : 0.22;
    const forwardPower = fwd < 0
      ? Math.abs(fwd) * ((this.spec.reverseThrust ?? this.spec.forwardThrust) / this.spec.forwardThrust)
      : Math.abs(fwd);
    const thrustTarget = controllable
      ? Math.max(idlePower, forwardPower, Math.abs(str), Math.abs(collective))
      : 0;
    this.thrustPower = Phaser.Math.Linear(
      this.thrustPower,
      thrustTarget,
      1 - Math.pow(0.08, dt)
    );
    if (controllable) {
      const longitudinalThrust = fwd < 0
        ? (this.spec.reverseThrust ?? this.spec.forwardThrust)
        : this.spec.forwardThrust;
      ax += ca * fwd * longitudinalThrust;
      ay += sa * fwd * longitudinalThrust;
      ax += -sa * str * this.spec.strafeThrust;
      ay += ca * str * this.spec.strafeThrust;
    }
    this.vx += ax * dt;
    this.vy += ay * dt;
    const drag = controllable ? this.spec.drag : 8;
    this.vx *= Math.pow(1 / (1 + drag * dt), 1);
    this.vy *= Math.pow(1 / (1 + drag * dt), 1);
    if (controllable && this.spec.flightModel === "plane") {
      const headingX = Math.cos(this.angle);
      const headingY = Math.sin(this.angle);
      const forwardSpeed = Math.max(
        this.spec.minSpeed,
        this.vx * headingX + this.vy * headingY
      );
      const lateralSpeed =
        (-this.vx * headingY + this.vy * headingX) * Math.exp(-2.2 * dt);
      this.vx = headingX * forwardSpeed - headingY * lateralSpeed;
      this.vy = headingY * forwardSpeed + headingX * lateralSpeed;
    }
    const maxReverse = this.spec.maxReverseSpeed;
    if (maxReverse != null) {
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
    this.x = Phaser.Math.Clamp(this.x, 40, WORLD - 40);
    this.y = Phaser.Math.Clamp(this.y, 40, WORLD - 40);
    if (this.spec.flightModel === "plane") {
      if (this.x <= 40 && this.vx < 0) this.vx = 0;
      else if (this.x >= WORLD - 40 && this.vx > 0) this.vx = 0;
      if (this.y <= 40 && this.vy < 0) this.vy = 0;
      else if (this.y >= WORLD - 40 && this.vy > 0) this.vy = 0;
    }

    const gnd = groundZ(world, this.x, this.y);
    this.gndSmooth += (gnd - this.gndSmooth) * (1 - Math.exp(-GND_FOLLOW * dt));
    if (this.phase === "spool" || this.phase === "ready") {
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
    this.fireCd = Math.max(0, this.fireCd - dt);
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
