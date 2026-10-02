/** Macro map shapes + domain warp: the designed silhouette that the noise details. */
import { fbm } from "./noise";
import { Rng } from "../util/rng";

export type MapShape = "open" | "coast" | "peninsula" | "valley" | "plateau" | "caldera" | "archipelago" | "isthmus";

export const MAP_SHAPES: { id: MapShape; label: string; description: string }[] = [
  { id: "open", label: "OPEN", description: "Open country: rolling hills, lakes and scattered high ground with no set layout." },
  { id: "coast", label: "COAST", description: "Land on one side, open sea on the other, split by a long, broken coastline." },
  { id: "peninsula", label: "PENINSULA", description: "A long finger of land reaching out into open sea, with water on three sides." },
  { id: "valley", label: "VALLEY", description: "A broad valley floor between two ridgelines, sloping down to a bay at one end." },
  { id: "plateau", label: "PLATEAU", description: "A flat-topped plateau ringed by cliffs, rising out of the lowlands around it." },
  { id: "caldera", label: "CALDERA", description: "A ring of high ground around a sunken crater lake at the center of the map." },
  { id: "archipelago", label: "ISLANDS", description: "A scatter of islands of every size across open sea." },
  { id: "isthmus", label: "ISTHMUS", description: "Two landmasses joined by a narrow neck of land, with sea all around." },
];

/** Height inputs read by the base height pass (subset of WorldGenProfile). */
export interface HeightProfile {
  landBias: number;
  relief: number;
  edgeFalloff: number;
  shape: MapShape;
  /** Domain warp strength (0 = none). */
  warp: number;
}

export interface ShapeField {
  /** Height offset at normalized map coords. */
  at(nx: number, ny: number): number;
  /** Noise contrast multiplier (flat valley floors, mesa tops). */
  relief?(nx: number, ny: number): number;
  /** Preferred player spawn, normalized. */
  spawnX: number;
  spawnY: number;
  /** Natural stronghold spot (plateau top, peninsula tip…), normalized. */
  keep?: { x: number; y: number };
}

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax;
  const vy = by - ay;
  const t = Math.min(1, Math.max(0, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy || 1)));
  return Math.hypot(px - (ax + vx * t), py - (ay + vy * t));
}

const OPEN_SPAWN = 0.265;
/** Land / sea offsets the templates blend between. */
const LAND = 0;
const SEA = -0.3;

export function makeShape(shape: MapShape, seed: number): ShapeField {
  const rng = new Rng((seed ^ 0x5a17e) >>> 0);
  switch (shape) {
    case "coast": {
      // Sea faces away from the spawn corner, give or take.
      const a = Math.PI / 4 + rng.range(-0.9, 0.9);
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      const off = rng.range(0.08, 0.2);
      return {
        at: (nx, ny) => {
          const t = (nx - 0.5) * dx + (ny - 0.5) * dy - off;
          return LAND + (SEA - LAND) * smooth(-0.1, 0.16, t);
        },
        spawnX: 0.5 - dx * 0.26,
        spawnY: 0.5 - dy * 0.26,
      };
    }
    case "peninsula": {
      const a = rng.range(0, Math.PI * 2);
      const ax = 0.5 + Math.cos(a) * 0.62;
      const ay = 0.5 + Math.sin(a) * 0.62;
      const bend = rng.range(-0.18, 0.18);
      const bx = 0.5 - Math.cos(a + bend) * 0.22;
      const by = 0.5 - Math.sin(a + bend) * 0.22;
      const w = rng.range(0.19, 0.25);
      return {
        at: (nx, ny) => LAND + (SEA - LAND) * smooth(w * 0.55, w, segDist(nx, ny, ax, ay, bx, by)),
        spawnX: ax + (bx - ax) * 0.3,
        spawnY: ay + (by - ay) * 0.3,
        keep: { x: bx, y: by },
      };
    }
    case "valley": {
      const a = rng.range(0, Math.PI);
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      const curve = rng.range(-0.12, 0.12);
      const w = rng.range(0.07, 0.11);
      const side = (nx: number, ny: number) => {
        const u = (nx - 0.5) * dx + (ny - 0.5) * dy;
        return smooth(w, w + 0.2, Math.abs(-(nx - 0.5) * dy + (ny - 0.5) * dx - curve * (1 - 4 * u * u)));
      };
      // Floor tilts down-valley into a bay, so rivers drain along it.
      const tilt = (nx: number, ny: number) => smooth(-0.05, 0.5, (nx - 0.5) * dx + (ny - 0.5) * dy);
      return {
        at: (nx, ny) => {
          const sd = side(nx, ny);
          return -0.04 + 0.12 * sd - 0.22 * tilt(nx, ny) * (1 - sd * 0.7);
        },
        relief: (nx, ny) => 0.45 + 0.55 * side(nx, ny),
        keep: { x: 0.5 + dx * 0.22, y: 0.5 + dy * 0.22 },
        spawnX: 0.5 - dx * 0.3 - dy * curve * 0.64,
        spawnY: 0.5 - dy * 0.3 + dx * curve * 0.64,
      };
    }
    case "plateau": {
      const cx = 0.5 + rng.range(-0.06, 0.06);
      const cy = 0.5 + rng.range(-0.06, 0.06);
      const r = rng.range(0.2, 0.26);
      const top = (nx: number, ny: number) => 1 - smooth(r, r + 0.035, Math.hypot(nx - cx, ny - cy));
      return {
        at: (nx, ny) => -0.05 + 0.19 * top(nx, ny),
        relief: (nx, ny) => 1 - 0.6 * top(nx, ny),
        spawnX: OPEN_SPAWN * 0.7,
        spawnY: OPEN_SPAWN * 0.7,
        keep: { x: cx, y: cy },
      };
    }
    case "caldera": {
      const cx = 0.5 + rng.range(-0.05, 0.05);
      const cy = 0.5 + rng.range(-0.05, 0.05);
      const r = rng.range(0.22, 0.27);
      return {
        at: (nx, ny) => {
          const d = Math.hypot(nx - cx, ny - cy);
          const rim = Math.exp(-(((d - r) / 0.075) ** 2));
          return -0.02 + 0.24 * rim - 0.36 * (1 - smooth(r * 0.45, r * 0.85, d));
        },
        spawnX: OPEN_SPAWN * 0.8,
        spawnY: OPEN_SPAWN * 0.8,
        keep: { x: cx + r * 0.7, y: cy + r * 0.7 },
      };
    }
    case "archipelago": {
      const isles: { x: number; y: number; r: number }[] = [{ x: OPEN_SPAWN, y: OPEN_SPAWN, r: 0.09 }];
      for (let k = 0; k < 400 && isles.length < 13; k++) {
        const x = rng.range(0.1, 0.9);
        const y = rng.range(0.1, 0.9);
        const r = rng.range(0.035, 0.085);
        if (isles.some((o) => Math.hypot(o.x - x, o.y - y) < o.r + r + 0.06)) continue;
        isles.push({ x, y, r });
      }
      return {
        at: (nx, ny) => {
          let l = 0;
          for (const o of isles) l = Math.max(l, 1 - smooth(o.r * 0.5, o.r * 1.25, Math.hypot(nx - o.x, ny - o.y)));
          return SEA + (LAND - SEA) * l;
        },
        spawnX: OPEN_SPAWN,
        spawnY: OPEN_SPAWN,
      };
    }
    case "isthmus": {
      const a = Math.PI / 4 + rng.range(-0.5, 0.5);
      const ax = 0.5 - Math.cos(a) * 0.27;
      const ay = 0.5 - Math.sin(a) * 0.27;
      const bx = 0.5 + Math.cos(a) * 0.27;
      const by = 0.5 + Math.sin(a) * 0.27;
      const ra = rng.range(0.19, 0.24);
      const rb = rng.range(0.19, 0.24);
      const neck = rng.range(0.035, 0.055);
      return {
        at: (nx, ny) => {
          const la = 1 - smooth(ra * 0.7, ra, Math.hypot(nx - ax, ny - ay));
          const lb = 1 - smooth(rb * 0.7, rb, Math.hypot(nx - bx, ny - by));
          const ln = 1 - smooth(neck * 0.5, neck, segDist(nx, ny, ax, ay, bx, by));
          return SEA + (LAND - SEA) * Math.max(la, lb, ln);
        },
        spawnX: ax,
        spawnY: ay,
        keep: { x: bx, y: by },
      };
    }
    default:
      return { at: () => 0, spawnX: OPEN_SPAWN, spawnY: OPEN_SPAWN };
  }
}

/** Pre-terrace height at normalized coords; `detail` trims octaves for cheap previews. */
export function baseHeight(nx: number, ny: number, seed: number, p: HeightProfile, field: ShapeField, detail = 1): number {
  let wx = nx;
  let wy = ny;
  if (p.warp > 0) {
    const w = p.warp * 0.06;
    wx += (fbm(nx * 2.6 + 71, ny * 2.6, seed + 211, 3) - 0.5) * 2 * w;
    wy += (fbm(nx * 2.6, ny * 2.6 + 53, seed + 223, 3) - 0.5) * 2 * w;
  }
  const ridge = 1 - Math.abs(fbm(wx * 3.1 + 20, wy * 3.1, seed + 9, detail < 1 ? 3 : 4) * 2 - 1);
  let h = fbm(wx * 6.2, wy * 6.2, seed, detail < 1 ? 4 : 6, 2.05, 0.52) * 0.72 + ridge * 0.28;
  h = 0.5 + (h - 0.5) * p.relief * (field.relief ? field.relief(wx, wy) : 1);
  h -= Math.pow(Math.hypot(nx - 0.5, ny - 0.5) * 1.15, 2) * p.edgeFalloff;
  h += field.at(wx, wy);
  return h + p.landBias;
}
