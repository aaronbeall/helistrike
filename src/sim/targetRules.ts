import { type Unit } from "./combat";
import { type RemoteCraft } from "./remote";
import { specOf, gunsOf, isNeutral, weaponIsAa } from "./roster";

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
