import { type PlayerWpnSpec } from "../../sim/combat";
/** Small helpers shared by the mission scene and its subsystems. */
import { type ShotBehavior } from "../../sim/combat";
import { type ShotKind, type ShotLook } from "../../sim/roster";

/** Overlay guns are drawn barrel-up (same as hulls). World aim 0 is +X, so +90°. */
export function gunWorldRot(_tex: string, aim: number): number {
  return aim + Math.PI / 2;
}

/** Minimal behavior snapshot so enemy trails / gravity read the new exhaust model. */
export function enemyShotBeh(wpn: {
  look: ShotLook;
  scale: number;
  trailScale?: number;
  kind: ShotKind;
  speed: number;
  dmg: number;
  blast: number;
}): ShotBehavior | undefined {
  const rocket = wpn.kind === "rocket" || (wpn.trailScale != null && wpn.kind !== "cannon");
  const seek = wpn.kind === "lock-on-missile";
  if (!rocket && !seek && wpn.trailScale == null) {
    // Guns: no exhaust — shotIsGunOrBeam uses !exhaust
    return {
      art: { look: wpn.look, scale: wpn.scale, face: "velocity" },
      cam: { reticle: "round", look: { pull: 0.2, max: 88, rate: 10 } },
      control: { mode: "click" },
      launch: { mode: "muzzle", inheritMomentum: 0 },
      payload: wpn.kind === "cannon" ? { penetration: 1 } : { detonate: { look: "fire" } },
      cruiseSpeed: wpn.speed,
      dmg: wpn.dmg,
      blast: wpn.blast,
    };
  }
  return {
    art: { look: wpn.look, scale: wpn.scale, face: seek || rocket ? "heading" : "velocity" },
    cam: { reticle: "round", look: { pull: 0.2, max: 88, rate: 10 } },
    control: { mode: "click" },
    launch: { mode: "muzzle", inheritMomentum: 0 },
    payload: { detonate: { look: "fire" } },
    exhaust:
      wpn.trailScale != null
        ? {
            kind: "particles",
            size: wpn.trailScale,
            fire: "burn",
            ...(wpn.kind === "rocket" ? { fireFor: 0.1 } : {}),
            smoke: wpn.kind === "rocket" ? "rocket" : "linger",
            ...(wpn.kind === "rocket" ? { align: "heading" as const } : {}),
          }
        : seek
          ? { kind: "particles", size: 0.55, fire: "burn", smoke: "linger" }
          : undefined,
    cruiseSpeed: wpn.speed,
    dmg: wpn.dmg,
    blast: wpn.blast,
  };
}

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
