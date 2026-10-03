import Phaser from "phaser";
import { type Unit } from "./combat";
import { specOf, isGroundVehicle, driveOf } from "./roster";
import { isWater, WORLD, type WorldData, isDeepWater } from "../worldgen/world";
import { MAP_AIR_SOFT } from "./craft";
import { type RemoteCraft } from "./remote";

/**
 * Sim yaw toward `want`. Caps hitch dt and per-tick step so units never
 * flip 180° in one frame even with high turn rates or large dt spikes.
 */
/** Soft rim where map-edge steering ramps up. */
export const MAP_EDGE_MARGIN = 280;
/** Hard pad ground units cannot cross. */
export const MAP_EDGE_PAD = 40;

export function steerUnitAngle(angle: number, want: number, rate: number, dt: number): number {
  const stepDt = Math.min(Math.max(0, dt), 1 / 20);
  // ~10°/tick hard cap — turns always take multiple frames, never axis snaps.
  const maxStep = Math.min(Math.abs(rate) * stepDt, 0.18);
  return Phaser.Math.Angle.RotateTo(angle, want, maxStep);
}

/**
 * Bias a chase point toward dry land (`preferWater=false`) or open water (`true`).
 * Samples look-ahead along want / facing and a local ring so units turn before crossing.
 */
export function terrainSteer(world: WorldData, 
  x: number,
  y: number,
  wantX: number,
  wantY: number,
  preferWater: boolean,
  facing?: number
): { x: number; y: number } {
  let wx = wantX;
  let wy = wantY;
  const ok = (px: number, py: number) => {
    const wet = isWater(world, px, py);
    return preferWater ? wet : !wet;
  };
  const bad = (px: number, py: number) => !ok(px, py);

  const hx = wantX - x;
  const hy = wantY - y;
  const hd = Math.hypot(hx, hy) || 1;
  const dirs: { nx: number; ny: number }[] = [{ nx: hx / hd, ny: hy / hd }];
  if (facing != null) dirs.push({ nx: Math.cos(facing), ny: Math.sin(facing) });

  for (const { nx, ny } of dirs) {
    for (const dist of [28, 52, 84, 120]) {
      if (!bad(x + nx * dist, y + ny * dist)) continue;
      const strength = Phaser.Math.Clamp(1.25 - dist / 150, 0.4, 1.15);
      wx -= nx * 62 * strength;
      wy -= ny * 62 * strength;
      const leftOk = ok(x - ny * 44, y + nx * 44);
      const rightOk = ok(x + ny * 44, y - nx * 44);
      if (leftOk && !rightOk) {
        wx += -ny * 78 * strength;
        wy += nx * 78 * strength;
      } else if (rightOk && !leftOk) {
        wx += ny * 78 * strength;
        wy += -nx * 78 * strength;
      } else {
        wx += -ny * 48 * strength;
        wy += nx * 48 * strength;
      }
      break;
    }
  }

  if (bad(x, y)) {
    let gx = 0;
    let gy = 0;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      if (ok(x + Math.cos(a) * 52, y + Math.sin(a) * 52)) {
        gx += Math.cos(a);
        gy += Math.sin(a);
      }
    }
    const gd = Math.hypot(gx, gy);
    if (gd > 0.2) {
      wx += (gx / gd) * 140;
      wy += (gy / gd) * 140;
    }
  } else {
    // Soft shore margin: ease away before the look-ahead hits.
    let bx = 0;
    let by = 0;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      if (bad(x + Math.cos(a) * 40, y + Math.sin(a) * 40)) {
        bx -= Math.cos(a);
        by -= Math.sin(a);
      }
    }
    const bd = Math.hypot(bx, by);
    if (bd > 0.2) {
      wx += (bx / bd) * 58;
      wy += (by / bd) * 58;
    }
  }
  return { x: wx, y: wy };
}

/** Bend an autonomous ground remote's heading away from water ahead (shared enemy look-ahead). */
export function waterSteerWant(world: WorldData, drone: RemoteCraft, want: number): number {
  const tx = drone.x + Math.cos(want) * 120;
  const ty = drone.y + Math.sin(want) * 120;
  const p = terrainSteer(world, drone.x, drone.y, tx, ty, false, drone.angle);
  return Math.atan2(p.y - drone.y, p.x - drone.x);
}

/** 0 at inland → 1 deep in the map rim. */
export function mapEdgeWeight(x: number, y: number): number {
  const lo = MAP_EDGE_PAD;
  const hi = WORLD - MAP_EDGE_PAD;
  const m = MAP_EDGE_MARGIN;
  let px = 0;
  let py = 0;
  if (x < lo + m) px += 1 - Phaser.Math.Clamp((x - lo) / m, 0, 1);
  if (x > hi - m) px -= 1 - Phaser.Math.Clamp((hi - x) / m, 0, 1);
  if (y < lo + m) py += 1 - Phaser.Math.Clamp((y - lo) / m, 0, 1);
  if (y > hi - m) py -= 1 - Phaser.Math.Clamp((hi - y) / m, 0, 1);
  return Math.min(1, Math.hypot(px, py));
}

/** Inward unit vector from map rim (0,0 if inland). */
export function mapEdgeInland(x: number, y: number): { x: number; y: number; w: number } {
  const lo = MAP_EDGE_PAD;
  const hi = WORLD - MAP_EDGE_PAD;
  const m = MAP_EDGE_MARGIN;
  let px = 0;
  let py = 0;
  if (x < lo + m) px += 1 - Phaser.Math.Clamp((x - lo) / m, 0, 1);
  if (x > hi - m) px -= 1 - Phaser.Math.Clamp((hi - x) / m, 0, 1);
  if (y < lo + m) py += 1 - Phaser.Math.Clamp((y - lo) / m, 0, 1);
  if (y > hi - m) py -= 1 - Phaser.Math.Clamp((hi - y) / m, 0, 1);
  const w = Math.hypot(px, py);
  if (w < 0.02) return { x: 0, y: 0, w: 0 };
  return { x: px / w, y: py / w, w: Math.min(1, w) };
}

/** Kill outbound velocity and clamp; aircraft may leave then forced-turn inland. */
export function containOnMap(u: Unit, dt: number): void {
  const sp = specOf(u.kind);
  if (sp.building || sp.behavior === "static_hold") return;
  const lo = MAP_EDGE_PAD;
  const hi = WORLD - MAP_EDGE_PAD;
  const m = MAP_EDGE_MARGIN;
  const aircraft = !!sp.aerial;
  const boatish = !!(sp.water || sp.behavior === "patrol_boat");
  if (u.x < lo + m && u.vx < 0) u.vx *= Phaser.Math.Clamp((u.x - lo) / m, 0, 1);
  if (u.x > hi - m && u.vx > 0) u.vx *= Phaser.Math.Clamp((hi - u.x) / m, 0, 1);
  if (u.y < lo + m && u.vy < 0) u.vy *= Phaser.Math.Clamp((u.y - lo) / m, 0, 1);
  if (u.y > hi - m && u.vy > 0) u.vy *= Phaser.Math.Clamp((hi - u.y) / m, 0, 1);

  const outsidePlayable =
    aircraft && (u.x < 0 || u.x > WORLD || u.y < 0 || u.y > WORLD);
  const edge = mapEdgeInland(u.x, u.y);
  const turnW = outsidePlayable ? 1 : edge.w;
  if (turnW > 0.02) {
    const t = turnW;
    const inlandX = outsidePlayable ? WORLD * 0.5 - u.x : edge.x;
    const inlandY = outsidePlayable ? WORLD * 0.5 - u.y : edge.y;
    const len = Math.max(1e-3, Math.hypot(inlandX, inlandY));
    const nx = inlandX / len;
    const ny = inlandY / len;
    if (aircraft || boatish) {
      const thrust = (aircraft ? 160 : 70) * t * t;
      u.vx += nx * thrust * dt;
      u.vy += ny * thrust * dt;
      const out = u.vx * -nx + u.vy * -ny;
      if (out > 0) {
        u.vx += nx * out * Math.min(1, t * 1.4);
        u.vy += ny * out * Math.min(1, t * 1.4);
      }
      if (t > 0.25 || outsidePlayable) {
        u.angle = steerUnitAngle(
          u.angle,
          Math.atan2(ny, nx),
          (outsidePlayable ? 3.6 : 2.8) * Math.max(t, outsidePlayable ? 1 : 0),
          dt
        );
      }
    } else if (isGroundVehicle(u.kind) || sp.behavior === "attack_infantry" || sp.behavior === "flee_infantry") {
      const ground = isGroundVehicle(u.kind);
      const wheeled = ground && driveOf(u.kind).track !== "tread";
      const spd = Math.hypot(u.vx, u.vy);
      const minTurnSpd = sp.minTurnSpd ?? 14;
      // Wheeled: only yaw at the rim while moving, or when deeply stuck (hard rim).
      if (t > 0.28 && (!wheeled || spd > minTurnSpd || t > 0.55)) {
        u.angle = steerUnitAngle(u.angle, Math.atan2(ny, nx), 2.4 * t, dt);
      }
      if (t > 0.4 && spd < 18) {
        u.vx += nx * 55 * t * dt;
        u.vy += ny * 55 * t * dt;
      }
    }
  }
  if (aircraft) {
    u.x = Phaser.Math.Clamp(u.x, -MAP_AIR_SOFT, WORLD + MAP_AIR_SOFT);
    u.y = Phaser.Math.Clamp(u.y, -MAP_AIR_SOFT, WORLD + MAP_AIR_SOFT);
  } else {
    u.x = Phaser.Math.Clamp(u.x, lo, hi);
    u.y = Phaser.Math.Clamp(u.y, lo, hi);
  }
}

/** Wet samples over the hull footprint (center + ring), heading-independent. */
export function groundRemoteWetness(world: WorldData, drone: RemoteCraft, x: number, y: number): number {
  const r = drone.spec.radius * 0.75;
  let n = isWater(world, x, y) ? 1 : 0;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    if (isWater(world, x + Math.cos(a) * r, y + Math.sin(a) * r)) n++;
  }
  return n;
}

/** Revert a ground remote's move that would put it (further) over water. */
export function gateGroundRemoteWater(world: WorldData, drone: RemoteCraft, x0: number, y0: number): void {
  if (!drone.spec.ground || drone.airborne) return;
  if (!groundRemoteEntersWater(world, drone, x0, y0, drone.x, drone.y)) return;
  drone.x = x0;
  drone.y = y0;
  drone.vx = 0;
  drone.vy = 0;
}

export function pickBoatWaypoint(world: WorldData, u: Unit): void {
  const lo = MAP_EDGE_PAD + 80;
  const hi = WORLD - MAP_EDGE_PAD - 80;
  for (let i = 0; i < 18; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = 140 + Math.random() * 280;
    const x = Phaser.Math.Clamp(u.x + Math.cos(a) * d, lo, hi);
    const y = Phaser.Math.Clamp(u.y + Math.sin(a) * d, lo, hi);
    const mx = (u.x + x) / 2;
    const my = (u.y + y) / 2;
    // Prefer open water: target, mid, and a ring around the target must stay wet.
    if (
      isWater(world, x, y) &&
      isWater(world, mx, my) &&
      isWater(world, x + 36, y) &&
      isWater(world, x - 36, y) &&
      isWater(world, x, y + 36) &&
      isWater(world, x, y - 36)
    ) {
      u.aiTx = x;
      u.aiTy = y;
      return;
    }
  }
  // Fallback: any wet point still clear of the shoreline look-ahead.
  for (let i = 0; i < 10; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = 80 + Math.random() * 160;
    const x = Phaser.Math.Clamp(u.x + Math.cos(a) * d, lo, hi);
    const y = Phaser.Math.Clamp(u.y + Math.sin(a) * d, lo, hi);
    if (isWater(world, x, y) && isWater(world, (u.x + x) / 2, (u.y + y) / 2)) {
      u.aiTx = x;
      u.aiTy = y;
      return;
    }
  }
  u.aiTx = Phaser.Math.Clamp(u.x + Math.cos(u.angle) * 80, lo, hi);
  u.aiTy = Phaser.Math.Clamp(u.y + Math.sin(u.angle) * 80, lo, hi);
}

/** Step on preferred terrain only; slide on axes or brake if blocked. Land units can wade shallows (not depths). */
export function stepOnTerrain(world: WorldData, u: Unit, dx: number, dy: number, preferWater: boolean): void {
  const ok = (px: number, py: number) => (preferWater ? isWater(world, px, py) : !isDeepWater(world, px, py));
  const nx = u.x + dx;
  const ny = u.y + dy;
  if (ok(nx, ny)) {
    u.x = nx;
    u.y = ny;
    return;
  }
  if (ok(u.x + dx, u.y)) {
    u.x += dx;
    u.vy *= 0.35;
    return;
  }
  if (ok(u.x, u.y + dy)) {
    u.y += dy;
    u.vx *= 0.35;
    return;
  }
  u.vx *= 0.15;
  u.vy *= 0.15;
}

/** Inward aim that overrides other steer wants near the map rim. */
export function mapEdgeSteer(x: number, y: number, wantX: number, wantY: number): { x: number; y: number } {
  const edge = mapEdgeInland(x, y);
  if (edge.w < 0.02) return { x: wantX, y: wantY };
  const t = Math.min(1, edge.w * 1.2);
  const inlandX = x + edge.x * (220 + t * 400);
  const inlandY = y + edge.y * (220 + t * 400);
  return {
    x: Phaser.Math.Linear(wantX, inlandX, t),
    y: Phaser.Math.Linear(wantY, inlandY, t),
  };
}

/** True when a ground move leaves more of the hull over water (only drying moves allowed once wet). */
export function groundRemoteEntersWater(world: WorldData, drone: RemoteCraft, x0: number, y0: number, x1: number, y1: number): boolean {
  if (Math.abs(x1 - x0) < 1e-4 && Math.abs(y1 - y0) < 1e-4) return false;
  const wet1 = groundRemoteWetness(world, drone, x1, y1);
  if (wet1 === 0) return false;
  return wet1 >= groundRemoteWetness(world, drone, x0, y0);
}
