import { type Unit } from "./combat";
import { type RemoteCraft } from "./remote";
import { specOf, gunsOf, isNeutral, weaponIsAa, isGroundVehicle } from "./roster";

/** Base react radii by role: how close a sighted target must be to be pursued / fled (scaled by `targeting.enemyScaledReach`). */
export const REACT_DRONE = 1400;
export const REACT_SCOUT = 1600;
export const REACT_ORBIT = 1500;
export const REACT_VEHICLE = 980;
export const REACT_FLEE = 520;
export const REACT_INFANTRY = 400;

/** Base max sight range: `sightRange`, else the widest weapon or role react range. */
export function unitSightBase(u: Unit): number {
  const sp = specOf(u.kind);
  if (sp.sightRange != null) return sp.sightRange;
  let r = Math.max(sp.weapon?.range ?? 0, sp.secondary?.wpn.range ?? 0);
  for (const g of gunsOf(u)) r = Math.max(r, g.weapon?.range ?? 0);
  if (sp.behavior === "suicide_attack_heli") r = Math.max(r, REACT_DRONE);
  else if (sp.behavior === "kite_attack_heli") r = Math.max(r, REACT_SCOUT);
  else if (sp.behavior === "orbit_attack_heli") r = Math.max(r, REACT_ORBIT);
  if (isGroundVehicle(u.kind)) r = Math.max(r, REACT_VEHICLE, sp.fleeReactRange ?? REACT_FLEE);
  if (sp.behavior === "attack_infantry" || sp.behavior === "flee_infantry") r = Math.max(r, REACT_INFANTRY);
  return r;
}

/** Farthest a unit can see or shoot, before target-awareness scaling. */
export function unitEngageReach(u: Unit): number {
  const sp = specOf(u.kind);
  let r = Math.max(unitSightBase(u), sp.weapon?.range ?? 0, sp.secondary?.wpn.range ?? 0);
  for (const g of gunsOf(u)) r = Math.max(r, g.weapon?.range ?? 0);
  return r;
}

/** AA burst / seeker / AAM — blind to ground HOUND. */
export function enemyWeaponIsAa(wpn: { kind?: string; look?: string } | undefined): boolean {
  return weaponIsAa(wpn);
}

/** Live enemy unit — a valid pick for auto-aim, locks and friendly AI (not dead, not civilian). */
export function hostileUnit(u: Unit): boolean {
  return !u.dead && !isNeutral(u.kind);
}

/** Remote can be engaged by enemies (out in the world, alive, has a hull). */
export function remoteTargetable(r: RemoteCraft): boolean {
  return !r.detonate && !r.dock && !r.dockPending && !r.airborne && r.health > 0 && !!r.spec.craftLook;
}

/** Dedicated AA platform (primary mount is AA / seeker). */
export function unitIsAaEnemy(u: Unit): boolean {
  const sp = specOf(u.kind);
  const guns = gunsOf(u);
  return enemyWeaponIsAa(guns[0]?.weapon ?? sp.weapon);
}
