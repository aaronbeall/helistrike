import { type Unit } from "./combat";
import { type RemoteCraft } from "./remote";
import { specOf, gunsOf, isNeutral, weaponIsAa, isGroundVehicle, partsRollOf, type UnitKind, type WeaponSpec } from "./roster";

/** What a target is, for who can see / hit it: the host and air remotes fly; ground remotes are on land or submerged. */
export type TargetDomain = "air" | "ground" | "underwater";

/** Domains a weapon engages: explicit `reach`, else AA / seekers air only, everything else air + ground. */
export function weaponReach(wpn: WeaponSpec): readonly TargetDomain[] {
  return wpn.reach ?? (weaponIsAa(wpn) ? AIR_ONLY : AIR_GROUND);
}
const AIR_ONLY: readonly TargetDomain[] = ["air"];
const AIR_GROUND: readonly TargetDomain[] = ["air", "ground"];

/** Weapon that runs underwater (torpedo): stays below the surface, dies at the shore. */
export function weaponUnderwater(wpn: WeaponSpec): boolean {
  return weaponReach(wpn).includes("underwater");
}

/** Base react radii by role: how close a sighted target must be to be pursued / fled (scaled by `targeting.enemyScaledReach`). */
export const REACT_DRONE = 1400;
export const REACT_SCOUT = 1600;
export const REACT_ORBIT = 1500;
export const REACT_VEHICLE = 980;
export const REACT_FLEE = 520;
export const REACT_INFANTRY = 400;

/** Base max sight range: `sightRange`, else the widest weapon or role react range. */
export function unitSightBase(u: Unit): number {
  return sightFor(u.kind, gunRange(gunsOf(u)));
}

/** Farthest any unit of `kind` can see or shoot, over every gun roll option, before target-awareness scaling. */
export function kindEngageReach(kind: UnitKind): number {
  const sp = specOf(kind);
  let guns = gunRange(sp.guns);
  const roll = partsRollOf(kind);
  if (roll) for (const o of Object.values(roll.options)) guns = Math.max(guns, o.w.range ?? 0);
  return Math.max(sightFor(kind, guns), sp.weapon?.range ?? 0, sp.secondary?.wpn.range ?? 0, guns);
}

function gunRange(guns: readonly { weapon?: { range?: number } }[]): number {
  let r = 0;
  for (const g of guns) r = Math.max(r, g.weapon?.range ?? 0);
  return r;
}

function sightFor(kind: UnitKind, guns: number): number {
  const sp = specOf(kind);
  if (sp.sightRange != null) return sp.sightRange;
  let r = Math.max(sp.weapon?.range ?? 0, sp.secondary?.wpn.range ?? 0, guns);
  if (sp.behavior === "suicide_attack_heli") r = Math.max(r, REACT_DRONE);
  else if (sp.behavior === "kite_attack_heli") r = Math.max(r, REACT_SCOUT);
  else if (sp.behavior === "orbit_attack_heli") r = Math.max(r, REACT_ORBIT);
  if (isGroundVehicle(kind)) r = Math.max(r, REACT_VEHICLE, sp.fleeReactRange ?? REACT_FLEE);
  if (sp.behavior === "attack_infantry" || sp.behavior === "flee_infantry") r = Math.max(r, REACT_INFANTRY);
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
