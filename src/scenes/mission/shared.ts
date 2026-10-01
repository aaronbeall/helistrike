import { type PlayerWpnSpec } from "../../sim/combat";
/** Small helpers shared by the mission scene and its subsystems. */

/** Plane hardpoint / drop look-ahead boost (host + remote POV). */
export function planeLookCam(
  spec: PlayerWpnSpec,
  isPlane: boolean
): { pull: number; max: number; rate: number } {
  const look = spec.cam.look;
  if (
    isPlane &&
    spec.cam.planeLookMul !== false &&
    (spec.guidance != null || spec.launch.mode === "drop" || !!spec.exhaust)
  ) {
    return { pull: look.pull * 1.22, max: look.max * 1.28, rate: look.rate };
  }
  return { pull: look.pull, max: look.max, rate: look.rate };
}
