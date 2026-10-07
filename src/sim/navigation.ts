import Phaser from "phaser";
import { type Unit } from "./combat";
import { specOf, isGroundVehicle, driveOf } from "./roster";
import { bedZ, isWater, WORLD, type WorldData, isDeepWater } from "../worldgen/world";
import { MAP_AIR_SOFT } from "./craft";
import { craftOf } from "./crafts";
import { type RemoteCraft } from "./remote";

/**
 * Sim yaw toward `want`. Caps hitch dt and per-tick step so units never
 * flip 180° in one frame even with high turn rates or large dt spikes.
 */
/** Ground grade (z rise per world unit) at which a slope becomes an impassable cliff (~42°). */
export const CLIFF_GRADE = 0.9;
/** Speed kept at the steepest climbable grade (uphill only; linear in between). */
const UPHILL_MIN_SPEED = 0.4;

/** Grade from (x0, y0) to (x1, y1) along the ground (positive = uphill). */
export function groundGrade(world: WorldData, x0: number, y0: number, x1: number, y1: number): number {
  const d = Math.hypot(x1 - x0, y1 - y0);
  return d < 1e-6 ? 0 : (bedZ(world, x1, y1) - bedZ(world, x0, y0)) / d;
}

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

/** Anything moved by `stepOnTerrain`: a unit, a ground remote, a remote's pilot craft. */
export interface GroundMover {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/**
 * The one ground-step rule for every ground hull: wade shallows, never into deep water (bridge decks excepted), never
 * a cliff-steep step up or down (on / off a deck excepted). Stranded in deep water, any move is allowed (way out).
 */
export function groundStepOk(world: WorldData, x0: number, y0: number, x1: number, y1: number, onDeck?: (x: number, y: number) => boolean): boolean {
  if (onDeck?.(x1, y1)) return true;
  if (isDeepWater(world, x1, y1)) return isDeepWater(world, x0, y0) && !onDeck?.(x0, y0);
  if (onDeck?.(x0, y0)) return true;
  return Math.abs(groundGrade(world, x0, y0, x1, y1)) < CLIFF_GRADE;
}

/**
 * Step on preferred terrain only; slide on axes or brake if blocked. Ground: `groundStepOk`, plus slowing on climbs.
 * Boats (`preferWater`): water only.
 */
export function stepOnTerrain(
  world: WorldData,
  u: GroundMover,
  dx: number,
  dy: number,
  preferWater: boolean,
  onDeck?: (x: number, y: number) => boolean
): void {
  const fromDeck = !preferWater && !!onDeck?.(u.x, u.y);
  if (!preferWater && !fromDeck) {
    const g = groundGrade(world, u.x, u.y, u.x + dx, u.y + dy);
    if (g > 0) {
      const k = 1 - (1 - UPHILL_MIN_SPEED) * Math.min(1, g / CLIFF_GRADE);
      dx *= k;
      dy *= k;
    }
  }
  const ok = (px: number, py: number) => (preferWater ? isWater(world, px, py) : groundStepOk(world, u.x, u.y, px, py, onDeck));
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

/** A ground hull already integrated from (x0, y0) by its own physics: replay the move through `stepOnTerrain`. */
export function settleGroundMove(world: WorldData, m: GroundMover, x0: number, y0: number, onDeck?: (x: number, y: number) => boolean): void {
  const dx = m.x - x0;
  const dy = m.y - y0;
  if (Math.abs(dx) < 1e-4 && Math.abs(dy) < 1e-4) return;
  m.x = x0;
  m.y = y0;
  stepOnTerrain(world, m, dx, dy, false, onDeck);
}

/** Zero-point turn (tracks, infantry, walker / hover remotes) vs car steering that needs rolling speed: rotate vs back out of a jam. */
export function turnsInPlace(a: Unit | RemoteCraft): boolean {
  if ("spec" in a) return !craftOf(a.spec.craftLook).vehicleSteering;
  return !isGroundVehicle(a.kind) || driveOf(a.kind).track === "tread";
}
