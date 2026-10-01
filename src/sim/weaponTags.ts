import { wpnOf, type WpnId } from "./combat";

// —— Weapon system classification — shared by the tip catalog and the field manual's badges. ——

export type GuidedFamily = "lock_on" | "steer" | "steer_commit" | "waypoint";

/** Guidance family for the weapon's control style, if any. */
export function wpnGuidedFamily(id: WpnId): GuidedFamily | undefined {
  return wpnOf(id).guidance?.targeting.mode;
}

/** Bonus vs. vehicles and buildings, and a matching penalty vs. troops. */
export function wpnIsAntiArmor(id: WpnId): boolean {
  const d = wpnOf(id).dmgMul;
  return !!d && (d.vehicle ?? 1) > 1 && (d.building ?? 1) > 1 && (d.troop ?? 1) < 1;
}

/** Bonus vs. aircraft, and a matching penalty vs. vehicles. */
export function wpnIsAntiAir(id: WpnId): boolean {
  const d = wpnOf(id).dmgMul;
  return !!d && (d.air ?? 1) > 1 && (d.vehicle ?? 1) < 1;
}

/** Bonus vs. troops, and a matching penalty vs. vehicles. */
export function wpnIsAntiSoft(id: WpnId): boolean {
  const d = wpnOf(id).dmgMul;
  return !!d && (d.troop ?? 1) > 1 && (d.vehicle ?? 1) < 1;
}

/** Rounds punch through to a second target (sub-1 penetration is armor-effectiveness flavor only). */
export function wpnPierces(id: WpnId): boolean {
  return (wpnOf(id).payload.penetration ?? 0) >= 1;
}

/** Dropped ordnance (arcs with the aircraft's velocity) — excludes vehicle/drone deploys. */
export function wpnIsBombDrop(id: WpnId): boolean {
  const w = wpnOf(id);
  return w.launch.mode === "drop" && !w.payload.remote;
}

/** Deploys a pilotable/AI remote (drone, Hound, Skiff, Raptor) rather than firing ordnance. */
export function wpnIsRemoteDeploy(id: WpnId): boolean {
  return !!wpnOf(id).payload.remote;
}
