/** Launched, player-controlled craft — Spectre today, reusable for other pods. */
export type RemoteKind = "spectre";

export interface RemoteSpec {
  kind: RemoteKind;
  name: string;
  health: number;
  radius: number;
  height: number;
  maxSpeed: number;
  thrust: number;
  strafe: number;
  yawRate: number;
  climbRate: number;
  cruiseAgl: number;
  life: number;
  detonateDmg: number;
  detonateBlast: number;
  launchSpeed: number;
  look: string;
  scale: number;
  thermal?: boolean;
}

export interface RemoteCraft {
  id: number;
  spec: RemoteSpec;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  angle: number;
  health: number;
  life: number;
  lifeMax: number;
  rotor: number;
  detonate?: boolean;
}

export const REMOTE_CRAFTS: Record<RemoteKind, RemoteSpec> = {
  spectre: {
    kind: "spectre",
    name: "SPECTRE",
    health: 28,
    radius: 7,
    height: 4,
    maxSpeed: 360,
    thrust: 560,
    strafe: 500,
    yawRate: 5.4,
    climbRate: 300,
    cruiseAgl: 26,
    life: 45,
    detonateDmg: 258,
    detonateBlast: 140,
    launchSpeed: 280,
    look: "craft_quad_drone",
    scale: 0.42,
    thermal: true,
  },
};

export function remoteSpecOf(kind: RemoteKind): RemoteSpec {
  return REMOTE_CRAFTS[kind];
}
