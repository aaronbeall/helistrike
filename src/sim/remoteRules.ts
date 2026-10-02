import Phaser from "phaser";
import { type RemoteCraft } from "./remote";
import { craftControlScheme, craftOf, socketPointsOnKey } from "./crafts";
import { payloadIsCallStrike, payloadIsHostFire } from "./payload";
import type { PlayerWpnSpec, WpnId } from "./combat";
import { groundZ, type WorldData } from "../worldgen/world";

export function tickRemoteIdle(world: WorldData, drone: RemoteCraft, dt: number): void {
  drone.vx *= Math.pow(0.08, dt);
  drone.vy *= Math.pow(0.08, dt);
  const gnd = groundZ(world, drone.x, drone.y);
  const rest = gnd + drone.spec.cruiseAgl;
  drone.vz += (rest - drone.z) * 2.4 * dt;
  drone.vz *= Math.pow(0.2, dt);
}

/**
 * Socket emit UVs on the remote look sprite (not hull.body — Skiff overrides look).
 * Same resolver as host craftSocketPoints soft path (`socketPointsOnKey`).
 */
export function remoteSocketPoints(
  drone: RemoteCraft,
  socket: { class: string; points?: { id: string }[] }
): { x: number; y: number; id?: string }[] {
  return socketPointsOnKey(drone.spec.body, socket);
}

/**
 * Map AI face angle + throttle (−1..1) onto the same stick/aim Craft.update expects.
 * Orbit/ground: A/D yaw + W/S thrust. Plane/aim: nose follows aim, W/S throttle.
 */
export function remoteAiStickAim(
  drone: RemoteCraft,
  faceAng: number,
  throttle: number
): {
  stick: { up: boolean; down: boolean; left: boolean; right: boolean };
  aim: { x: number; y: number };
} {
  const aim = {
    x: drone.x + Math.cos(faceAng) * 220,
    y: drone.y + Math.sin(faceAng) * 220,
  };
  const hull = craftOf(drone.spec.craftLook);
  if (craftControlScheme(hull) === "orbit") {
    const err = Phaser.Math.Angle.Wrap(faceAng - drone.angle);
    return {
      aim,
      stick: {
        left: err < -0.06,
        right: err > 0.06,
        up: throttle > 0.2,
        down: throttle < -0.2,
      },
    };
  }
  return {
    aim,
    stick: {
      up: throttle > 0.2,
      down: throttle < -0.2,
      left: false,
      right: false,
    },
  };
}

/** Catalog weapon id whose host ammo a POV remote slot spends, if any. */
export function remoteHostAmmoWeapon(wp: PlayerWpnSpec): WpnId | undefined {
  if (payloadIsHostFire(wp.payload)) return wp.payload!.hostFire!.weapon;
  if (payloadIsCallStrike(wp.payload)) return wp.payload!.callStrike!.hostWeapon;
  return undefined;
}
