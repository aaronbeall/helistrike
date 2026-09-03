import Phaser from "phaser";
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
export const Z_THRUST = 520;
/** Gentle collective toward cruise. Far weaker than Z_THRUST. */
export const CRUISE_THRUST = 36;
export const CRUISE_DAMP = 2.2;
/** How fast cruise's ground reference tracks real terrain. Low = ignore rivers. */
export const GND_FOLLOW = 0.55;
export const HELI_HEIGHT = 14;

export type Phase = "grounded" | "spool" | "liftoff" | "flight" | "dead";

export class Heli {
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
  gunAngle = 0;
  health = 100;
  phase: Phase = "grounded";
  spool = 0;
  weapon = 0;
  fireCd = 0;
  immune = false;
  hellfireLock: { id: number } | null = null;
  hellfireSeek: { id: number; t: number } | null = null;
  /** Indices into player damage POIs: 0 center, 1 gun, 2 rotor. */
  dmgSites: { poi: number; scale: number }[] = [];
  gndSmooth: number;
  killDx = 0;
  killDy = 0;

  constructor(x: number, y: number, world: WorldData) {
    this.x = x;
    this.y = y;
    this.gndSmooth = groundZ(world, x, y);
    this.z = this.gndSmooth + 2;
  }

  get noseX(): number {
    return this.x + Math.cos(this.angle) * 42;
  }
  get noseY(): number {
    return this.y + Math.sin(this.angle) * 42;
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
      this.spool += dt * 0.35;
      if (this.spool > 0.15) this.phase = "spool";
    }
    if (this.phase === "spool") {
      this.rotorSpd = Phaser.Math.Linear(this.rotorSpd, 18, 1 - Math.pow(0.08, dt));
      this.spool += dt;
      if (this.spool > 1.8) this.phase = "liftoff";
    }
    if (this.phase === "liftoff") {
      this.rotorSpd = Phaser.Math.Linear(this.rotorSpd, 28, 1 - Math.pow(0.05, dt));
      const cruise = CRUISE_AGL + groundZ(world, this.x, this.y);
      this.z = Phaser.Math.Linear(this.z, cruise, 1 - Math.pow(0.12, dt));
      if (this.z > cruise - 4) this.phase = "flight";
    }

    const airborne = this.phase === "flight" || this.phase === "liftoff";
    this.rotor += this.rotorSpd * dt;
    if (this.phase === "flight") {
      this.rotorSpd = Phaser.Math.Linear(this.rotorSpd, 32, 1 - Math.pow(0.2, dt));
    }

    const desired = Math.atan2(aimY - this.y, aimX - this.x);
    if (airborne) {
      const err = Phaser.Math.Angle.Wrap(desired - this.angle);
      const maxRate = 2.55;
      const targetRate = Phaser.Math.Clamp(err * 5.4, -maxRate, maxRate);
      const yawAcc = 11;
      if (this.angVel < targetRate) this.angVel = Math.min(targetRate, this.angVel + yawAcc * dt);
      else this.angVel = Math.max(targetRate, this.angVel - yawAcc * dt);
      this.angle += this.angVel * dt;
    } else {
      this.angVel *= Math.pow(0.04, dt);
    }
    this.gunAngle = Phaser.Math.Angle.RotateTo(this.gunAngle, desired, 6.4 * dt);

    const ca = Math.cos(this.angle);
    const sa = Math.sin(this.angle);
    let ax = 0;
    let ay = 0;
    const fwd = (up ? 1 : 0) + (down ? -1 : 0);
    const str = (right ? 1 : 0) + (left ? -1 : 0);
    if (airborne && this.phase === "flight") {
      ax += ca * fwd * Z_THRUST;
      ay += sa * fwd * Z_THRUST;
      ax += -sa * str * 340;
      ay += ca * str * 340;
    }
    this.vx += ax * dt;
    this.vy += ay * dt;
    const drag = airborne ? 1.65 : 8;
    this.vx *= Math.pow(1 / (1 + drag * dt), 1);
    this.vy *= Math.pow(1 / (1 + drag * dt), 1);
    const spd = Math.hypot(this.vx, this.vy);
    const max = 340;
    if (spd > max) {
      this.vx *= max / spd;
      this.vy *= max / spd;
    }
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.x = Phaser.Math.Clamp(this.x, 40, WORLD - 40);
    this.y = Phaser.Math.Clamp(this.y, 40, WORLD - 40);

    const gnd = groundZ(world, this.x, this.y);
    this.gndSmooth += (gnd - this.gndSmooth) * (1 - Math.exp(-GND_FOLLOW * dt));
    if (airborne && this.phase === "flight") {
      const minZ = gnd + LOW_AGL;
      const maxZ = gnd + MAX_AGL;
      const restZ = this.gndSmooth + CRUISE_AGL;
      const zIn = (spaceDown ? 1 : 0) + (shiftDown ? -1 : 0);
      let az = zIn * Z_THRUST;
      if (zIn === 0) {
        az += Phaser.Math.Clamp(restZ - this.z, -CRUISE_THRUST, CRUISE_THRUST);
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
      Phaser.Math.Clamp(localFwd / 240, -0.42, 0.42),
      1 - Math.pow(0.06, dt)
    );
    this.roll = Phaser.Math.Linear(
      this.roll,
      Phaser.Math.Clamp(localStr / 200, -0.4, 0.4),
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
