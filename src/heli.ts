import Phaser from "phaser";
import { groundZ, type WorldData } from "./world";

export interface Stick {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

export const CRUISE_Z = 46;
export const MAX_Z = 118;
export const LOW_Z = 12;
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
  hellfireLock: { id: number; t: number } | null = null;
  dmgSites: { f: number; s: number }[] = [];

  constructor(x: number, y: number, world: WorldData) {
    this.x = x;
    this.y = y;
    this.z = groundZ(world, x, y) + 2;
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
      const cruise = CRUISE_Z + groundZ(world, this.x, this.y);
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
      ax += ca * fwd * 520;
      ay += sa * fwd * 520;
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
    this.x = Phaser.Math.Clamp(this.x, 40, 5560);
    this.y = Phaser.Math.Clamp(this.y, 40, 5560);

    const gnd = groundZ(world, this.x, this.y);
    if (this.phase === "flight") {
      const agl = spaceDown ? MAX_Z : shiftDown ? LOW_Z : CRUISE_Z;
      const want = gnd + agl;
      const follow = spaceDown || shiftDown ? 1 - Math.pow(0.14, dt) : 1 - Math.pow(0.08, dt);
      const next = Phaser.Math.Linear(this.z, want, follow);
      this.vz = dt > 0.0001 ? (next - this.z) / dt : 0;
      this.z = next;
      if (this.z < gnd + 8) this.z = gnd + 8;
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

  damage(n: number): void {
    if (this.phase === "dead") return;
    this.health -= n;
    if (this.health <= 0) this.kill();
  }
}
