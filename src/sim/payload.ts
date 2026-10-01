/** Weapon payload predicates. */
import type { WeaponLaunch, WeaponPayload } from "./combat";

export function payloadIsRemote(p: WeaponPayload | undefined): boolean {
  return !!p?.remote;
}

export function payloadIsCluster(p: WeaponPayload | undefined): boolean {
  return !!p?.cluster;
}

export function payloadIsSmoke(p: WeaponPayload | undefined): boolean {
  return !!p?.smoke;
}

export function payloadIsCallStrike(p: WeaponPayload | undefined): boolean {
  return !!p?.callStrike;
}

export function payloadIsHostFire(p: WeaponPayload | undefined): boolean {
  return !!p?.hostFire?.weapon;
}

export function payloadIsHelix(p: WeaponPayload | undefined): boolean {
  return !!p?.helix;
}

/** HE explode path: authored detonate, or HE without needing kinetic pen. */
export function payloadIsHe(p: WeaponPayload | undefined): boolean {
  return !!p?.detonate;
}

/** Gun kinetic / penetrator path (not beam). */
export function payloadIsKinetic(p: WeaponPayload | undefined, launch?: WeaponLaunch): boolean {
  if (!p) return false;
  if (p.penetration != null) return true;
  if (launch?.mode === "beam") return false;
  return (
    !p.detonate &&
    !p.cluster &&
    !p.smoke &&
    !p.remote &&
    !p.warp &&
    !p.helix &&
    !p.stun &&
    !p.callStrike &&
    !p.hostFire
  );
}
