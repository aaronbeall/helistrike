/** Shot sprite pose / orientation rules. */
import { exhaustIsGunSpark, type Shot } from "../sim/combat";

export function shotIsGunOrBeam(s: Shot): boolean {
  if (s.beh) {
    return (
      s.beh.launch.mode === "beam" ||
      (s.beh.launch.mode === "muzzle" &&
        !s.beh.guidance &&
        (!s.beh.exhaust || exhaustIsGunSpark(s.beh.exhaust)))
    );
  }
  return !s.homePlayer && s.motor == null && !s.energyTrail && !s.energyTrails;
}

export function shotFacesHeading(s: Shot): boolean {
  if (s.beh?.art.face === "heading") return true;
  if (s.beh?.art.face === "velocity") return false;
  return !!(s.homePlayer || s.motor != null);
}
