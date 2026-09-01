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

export type Phase = "grounded" | "spool" | "liftoff" | "flight" | "dead";

export class Heli {
  x: number;
  y: number;
  z: number;
  vx = 0;
  vy = 0;
  vz = 0;
  angle = 0;
  av = 0;
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

  constructor(x: number, y: number, world: WorldData) {
    this.x = x;
    this.y = y;
    this.z = groundZ(world, x, y) + 2;
  }

  get noseX(): number {
    return this.x + Math.cos(this.angle) * 28;
  }
  get noseY(): number {
    return this.y + Math.sin(this.angle) * 28;
  }

  update(
    dt: number,
    world: WorldData,
    stick: Stick,
    pointer: Phaser.Input.Pointer,
    spaceDown: boolean
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

    const wx = pointer.worldX;
    const wy = pointer.worldY;
    const desired = Math.atan2(wy - this.y, wx - this.x);
    let da = Phaser.Math.Angle.Wrap(desired - this.angle);
    const turnAccel = airborne ? 10 : 0;
    this.av += Phaser.Math.Clamp(da * 6, -turnAccel, turnAccel) * dt;
    this.av *= Math.pow(0.08, dt);
    this.av = Phaser.Math.Clamp(this.av, -2.9, 2.9);
    this.angle = Phaser.Math.Angle.Wrap(this.angle + this.av * dt);

    let gda = Phaser.Math.Angle.Wrap(desired - this.gunAngle);
    this.gunAngle = Phaser.Math.Angle.Wrap(this.gunAngle + Phaser.Math.Clamp(gda, -14 * dt, 14 * dt));

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
      const targetZ = spaceDown ? MAX_Z : CRUISE_Z;
      const want = gnd + targetZ;
      const k = spaceDown ? 2.4 : 1.15;
      this.vz += (want - this.z) * k * dt;
      this.vz *= Math.pow(0.18, dt);
      this.z += this.vz * 40 * dt;
      this.z = Phaser.Math.Clamp(this.z, gnd + 8, gnd + MAX_Z);
      if (this.z < gnd + 6) this.kill();
    }

    const localFwd = this.vx * ca + this.vy * sa;
    const localStr = -this.vx * sa + this.vy * ca;
    this.pitch = Phaser.Math.Linear(this.pitch, Phaser.Math.Clamp(localFwd / 280, -0.45, 0.45), 1 - Math.pow(0.04, dt));
    this.roll = Phaser.Math.Linear(this.roll, Phaser.Math.Clamp(localStr / 240, -0.5, 0.5), 1 - Math.pow(0.04, dt));
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
