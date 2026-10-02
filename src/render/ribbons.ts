import Phaser from "phaser";
import { coneDir } from "../util/vec";
import { ENERGY_TRAIL_NODE_LIFE, HELIX_TRAIL_NODE_LIFE, type Shot, type EnergyTrailNode } from "../sim/combat";
import { worldToScreen } from "../worldgen/world";

export function simulateHelixRibbon(s: Shot, dt: number, x: number, y: number, z: number): void {
  if (!s.energyTrail) s.energyTrail = [];
  const spd = Math.hypot(s.vx, s.vy, s.vz);
  const back =
    spd > 8
      ? { x: -s.vx / spd, y: -s.vy / spd, z: -s.vz / spd }
      : { x: -Math.cos(s.angle), y: -Math.sin(s.angle), z: 0 };
  // Tiny lateral shimmer so the braid isn't a perfect sine.
  const jit = (Math.random() - 0.5) * 1.4;
  const px = -Math.sin(s.angle);
  const py = Math.cos(s.angle);
  ageEnergyTrail(
    s.energyTrail,
    dt,
    { x: x + px * jit, y: y + py * jit, z: z + (Math.random() - 0.5) * 0.6 },
    0.1,
    back,
    HELIX_TRAIL_NODE_LIFE,
    "green",
    4.5
  );
}

export function energyTrailExhaust(back: { x: number; y: number; z: number }, mul = 1): { bx: number; by: number; bz: number } {
  const kick = (72 + Math.random() * 28) * mul;
  // Soft rear cone so the ribbon doesn't stack on a single reverse ray.
  const d = coneDir(back.x, back.y, back.z, 0.12, 5.5);
  return { bx: d.x * kick, by: d.y * kick, bz: d.z * kick };
}

export function ageEnergyTrail(
  trail: EnergyTrailNode[],
  dt: number,
  grow?: { x: number; y: number; z: number },
  strengthMul = 1,
  back?: { x: number; y: number; z: number },
  nodeLife = ENERGY_TRAIL_NODE_LIFE,
  hue?: EnergyTrailNode["hue"],
  minGrowDist = 8
): void {
  if (grow) {
    const last = trail[trail.length - 1];
    if (!last || Math.hypot(grow.x - last.x, grow.y - last.y, grow.z - last.z) > minGrowDist) {
      trail.push({
        ...grow,
        ...(back ? energyTrailExhaust(back, strengthMul) : { bx: 0, by: 0, bz: 0 }),
        life: nodeLife,
        max: nodeLife,
        hue,
      });
    }
  }
  const drag = Math.pow(0.22, dt);
  for (const p of trail) {
    p.x += p.bx * dt;
    p.y += p.by * dt;
    p.z += p.bz * dt;
    p.bx *= drag;
    p.by *= drag;
    p.bz *= drag;
    p.life -= dt;
  }
  let w = 0;
  for (const p of trail) {
    if (p.life > 0) trail[w++] = p;
  }
  trail.length = w;
  while (trail.length > 140) trail.shift();
}

export function drawWhipAntennaStroke(
  g: Phaser.GameObjects.Graphics,
  base: { x: number; y: number; z: number },
  tip: { x: number; y: number; z: number },
  rest: { x: number; y: number; z: number }
): void {
  const leanX = tip.x - rest.x;
  const leanY = tip.y - rest.y;
  const leanZ = tip.z - rest.z;
  const bend = 1.55;
  const c1 = {
    x: base.x + (rest.x - base.x) * 0.35 + leanX * bend * 0.55,
    y: base.y + (rest.y - base.y) * 0.35 + leanY * bend * 0.55,
    z: base.z + (rest.z - base.z) * 0.35 + leanZ * bend * 0.25,
  };
  const c2 = {
    x: base.x + (rest.x - base.x) * 0.72 + leanX * bend * 1.05,
    y: base.y + (rest.y - base.y) * 0.72 + leanY * bend * 1.05,
    z: base.z + (rest.z - base.z) * 0.72 + leanZ * bend * 0.55,
  };
  const segs = 10;
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const u = 1 - t;
    const wx =
      u * u * u * base.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * tip.x;
    const wy =
      u * u * u * base.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * tip.y;
    const wz =
      u * u * u * base.z + 3 * u * u * t * c1.z + 3 * u * t * t * c2.z + t * t * t * tip.z;
    const at = worldToScreen(wx, wy, wz);
    pts.push({ x: at.x, y: at.y });
  }
  if (pts.length < 2) return;
  const stroke = (color: number, alpha: number, width: number, dy: number) => {
    g.lineStyle(width, color, alpha);
    g.beginPath();
    g.moveTo(pts[0]!.x, pts[0]!.y + dy);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i]!.x, pts[i]!.y + dy);
    g.strokePath();
  };
  stroke(0x0c0c0e, 0.55, 1.85, 0.45);
  stroke(0x2a2c28, 0.78, 1.05, 0);
  stroke(0x3e4238, 0.35, 0.45, -0.3);
}
