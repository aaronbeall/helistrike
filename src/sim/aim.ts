import { ZOff } from "../render/depth";
import { socketHullPlacement } from "./crafts";
import { groundZ, type WorldData } from "../worldgen/world";
import { type RemoteCraft } from "./remote";

/**
 * World Z for a muzzle leave (host + remotes share this).
 * `hullPlacement: "above"` leaves from the roof (baseZ + height).
 * Default sits just under the hull (`ZOff.shot`).
 */
export function craftMuzzleLeaveZ(
  baseZ: number,
  height: number,
  hullPlacement?: "below" | "above"
): number {
  return hullPlacement === "above" ? baseZ + height : baseZ + ZOff.shot;
}

/** World Z for remote muzzle leave — same hullPlacement rules as the host craft. */
export function remoteMuzzleZ(drone: RemoteCraft, slot?: number, barrel = 0): number {
  const sockets = drone.spec.sockets;
  const sock =
    slot != null
      ? sockets?.[slot]
      : sockets?.find((s) => s.class === "turret") ?? sockets?.[0];
  let z = craftMuzzleLeaveZ(drone.z, drone.spec.height, socketHullPlacement(sock, barrel));
  // Dirt-locked AGVs skim the heightmap — lift leave so tracers clear micro-relief
  // that a heli chin gun never meets (same aim-at-ground dive, much less clearance).
  if (drone.spec.ground) {
    z += Math.max(6, drone.spec.height * 0.45);
  }
  return z;
}

/** First point along a world beam where altitude meets terrain. */
export function sightTerrainHitWorld(world: WorldData, 
  ox: number,
  oy: number,
  oz: number,
  bx: number,
  by: number,
  bz: number
): { x: number; y: number; z: number } {
  const steps = 48;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = ox + (bx - ox) * t;
    const y = oy + (by - oy) * t;
    const z = oz + (bz - oz) * t;
    if (z <= groundZ(world, x, y) + 1.5) {
      const u = Math.max(0, t - 0.5 / steps);
      return {
        x: ox + (bx - ox) * u,
        y: oy + (by - oy) * u,
        z: oz + (bz - oz) * u,
      };
    }
  }
  return { x: bx, y: by, z: bz };
}
