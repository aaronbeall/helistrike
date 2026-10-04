/** Macro map shapes + domain warp: the designed silhouette that the noise details. */
import { fbm } from "./noise";
import { Rng } from "../util/rng";

export type MapShape =
  | "open"
  | "coast"
  | "peninsula"
  | "valley"
  | "plateau"
  | "caldera"
  | "archipelago"
  | "isthmus"
  | "rift"
  | "delta"
  | "summit"
  | "volcano"
  | "shards";

export const MAP_SHAPES: { id: MapShape; label: string; description: string }[] = [
  { id: "open", label: "OPEN", description: "Open country: rolling hills, lakes and scattered high ground with no set layout." },
  { id: "coast", label: "COAST", description: "Land on one side, open sea on the other, split by a long, broken coastline." },
  { id: "peninsula", label: "PENINSULA", description: "A long finger of land reaching out into open sea, with water on three sides." },
  { id: "valley", label: "VALLEY", description: "A broad valley floor between two ridgelines, sloping down to a bay at one end." },
  { id: "plateau", label: "PLATEAU", description: "A flat-topped plateau ringed by cliffs, rising out of the lowlands around it." },
  { id: "caldera", label: "CALDERA", description: "A ring of high ground around a sunken crater lake at the center of the map." },
  { id: "archipelago", label: "ISLANDS", description: "A scatter of islands of every size across open sea." },
  { id: "isthmus", label: "ISTHMUS", description: "Two landmasses joined by a narrow neck of land, with sea all around." },
  { id: "rift", label: "RIFT", description: "A wide, sunken rift floor strung with lakes, walled in by high escarpment shoulders." },
  { id: "delta", label: "DELTA", description: "Low, waterlogged land fanning out to the sea, cut by branching channels." },
  { id: "summit", label: "SUMMIT", description: "One huge volcanic cone rising out of the sea, gullied flanks and a crater at its peak." },
  { id: "volcano", label: "VOLCANO", description: "One great volcano whose slopes run out to every edge, a ring of jagged peaks around a deep summit crater." },
  { id: "shards", label: "SHARDS", description: "Land cracked like dried mud into raised plates split by sharp gaps, climbing from one edge of the map to the other." },
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

/** Polynomial smooth minimum (blend radius k). */
function smin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax;
  const vy = by - ay;
  const t = Math.min(1, Math.max(0, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy || 1)));
  return Math.hypot(px - (ax + vx * t), py - (ay + vy * t));
}

const OPEN_SPAWN = 0.265;
/** Shards: crack half-width range and depth below the plates. */
const SHARD_CRACK_MIN = 0.004;
const SHARD_CRACK_MAX = 0.011;
const SHARD_CRACK_DEPTH = 0.1;
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
    case "rift": {
      const a = rng.range(0, Math.PI);
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      const w = rng.range(0.11, 0.14);
      const bend = rng.range(-0.08, 0.08);
      const lakes = [rng.range(-0.32, -0.12), rng.range(0.04, 0.28)].map((u) => ({ u, r: rng.range(0.05, 0.08) }));
      // Across-rift offset (0 on the floor's centerline), bowed by `bend`.
      const across = (nx: number, ny: number, u: number) => -(nx - 0.5) * dy + (ny - 0.5) * dx - bend * (1 - 4 * u * u);
      const wall = (v: number) => smooth(w, w + 0.035, Math.abs(v));
      return {
        at: (nx, ny) => {
          const u = (nx - 0.5) * dx + (ny - 0.5) * dy;
          const v = across(nx, ny, u);
          // Sunken floor below flat tableland shoulders.
          let h = -0.085 + 0.14 * wall(v);
          for (const l of lakes) h -= 0.24 * Math.exp(-(((u - l.u) / l.r) ** 2 + (v / (w * 0.75)) ** 2));
          return h;
        },
        relief: (nx, ny) => {
          const u = (nx - 0.5) * dx + (ny - 0.5) * dy;
          return 0.3 + 0.25 * wall(across(nx, ny, u));
        },
        // Spawn up on one shoulder; stronghold down on the floor's far end.
        spawnX: 0.5 - dx * 0.2 - dy * (w + 0.17),
        spawnY: 0.5 - dy * 0.2 + dx * (w + 0.17),
        keep: { x: 0.5 + dx * 0.34, y: 0.5 + dy * 0.34 },
      };
    }
    case "delta": {
      const a = rng.range(0, Math.PI * 2);
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      // Coast pushed near the far edge: mostly delta, a thin strip of open sea.
      const coast = rng.range(0.36, 0.4);
      const ax = 0.5 - dx * 0.44;
      const ay = 0.5 - dy * 0.44;
      // Distributary channels fanning from the apex out past the coast: x, y, half-width per point.
      const SEGS = 18;
      const ns = (seed ^ 0xde17a) >>> 0;
      const chans: Float32Array[] = [];
      const boxes: number[][] = [];
      const n = 6;
      // A trunk channel, then branches that split off it at different points and meander out to sea.
      const trunkLen = rng.range(0.22, 0.3);
      const chan = (sx: number, sy: number, ang: number, len: number, w0: number, w1: number, wob: number) => {
        const freq = rng.range(2.5, 4.5);
        const ph = rng.range(0, Math.PI * 2);
        const pts = new Float32Array((SEGS + 1) * 3);
        let x0 = 1;
        let y0 = 1;
        let x1 = 0;
        let y1 = 0;
        for (let s = 0; s <= SEGS; s++) {
          const t = s / SEGS;
          const off = Math.sin(t * Math.PI * freq + ph) * wob * Math.min(1, t * 3);
          const x = sx + Math.cos(ang) * t * len - Math.sin(ang) * off;
          const y = sy + Math.sin(ang) * t * len + Math.cos(ang) * off;
          pts[s * 3] = x;
          pts[s * 3 + 1] = y;
          // Width swells and pinches along the channel.
          pts[s * 3 + 2] = (w0 + (w1 - w0) * t) * rng.range(0.78, 1.25);
          x0 = Math.min(x0, x);
          y0 = Math.min(y0, y);
          x1 = Math.max(x1, x);
          y1 = Math.max(y1, y);
        }
        chans.push(pts);
        boxes.push([x0 - 0.04, y0 - 0.04, x1 + 0.04, y1 + 0.04]);
      };
      // Trunk runs in from past the map edge (the river feeding the delta).
      chan(ax - dx * 0.3, ay - dy * 0.3, a, trunkLen + 0.3, 0.012, 0.016, 0.02);
      for (let k = 0; k < n; k++) {
        const t = rng.range(0.55, 1);
        const sx = ax + dx * trunkLen * t;
        const sy = ay + dy * trunkLen * t;
        const ang = a + (k / (n - 1) - 0.5) * rng.range(1.1, 1.5) + rng.range(-0.15, 0.15);
        chan(sx, sy, ang, 0.95 - trunkLen * t, rng.range(0.006, 0.01), rng.range(0.012, 0.02), rng.range(0.03, 0.06));
        // Distributaries split again partway down.
        if (rng.next() < 0.7) {
          const p = chans[chans.length - 1]!;
          const o = Math.round(SEGS * rng.range(0.3, 0.6)) * 3;
          const sub = ang + (rng.next() < 0.5 ? -1 : 1) * rng.range(0.3, 0.55);
          chan(p[o]!, p[o + 1]!, sub, rng.range(0.4, 0.6), p[o + 2]! * 0.6, rng.range(0.008, 0.014), rng.range(0.02, 0.045));
        }
      }
      return {
        at: (nx, ny) => {
          const sea = smooth(-0.04, 0.1, (nx - 0.5) * dx + (ny - 0.5) * dy - coast);
          // Signed distance to the channel network (negative inside), smooth-unioned so forks get rounded fillets.
          let sd = 1;
          for (let k = 0; k < chans.length; k++) {
            const b = boxes[k]!;
            if (nx < b[0]! || ny < b[1]! || nx > b[2]! || ny > b[3]!) continue;
            const p = chans[k]!;
            for (let s = 0; s < SEGS; s++) {
              const o = s * 3;
              const ax = p[o]!;
              const ay = p[o + 1]!;
              const vx = p[o + 3]! - ax;
              const vy = p[o + 4]! - ay;
              const t = Math.min(1, Math.max(0, ((nx - ax) * vx + (ny - ay) * vy) / (vx * vx + vy * vy || 1)));
              const w = p[o + 2]! + (p[o + 5]! - p[o + 2]!) * t;
              sd = smin(sd, Math.hypot(nx - ax - vx * t, ny - ay - vy * t) - w, 0.022);
            }
          }
          // Ragged banks.
          sd += (fbm(nx * 28 + 3, ny * 28 + 7, ns, 4) - 0.5) * 0.022;
          // Bank slope varies by stretch: steep cut banks to wide shelving mudflats.
          const gentle = fbm(nx * 4 + 41, ny * 4 + 13, ns + 1, 2);
          // Ramp centered on the shoreline so the slope varies but the channel width doesn't.
          const bank = 0.01 + 0.05 * gentle * gentle;
          const ch = 1 - smooth(-bank * 0.5, bank * 0.5, sd);
          // Land barely above the water line, so noise opens pools and backwaters everywhere.
          return -0.075 + (SEA + 0.075) * Math.max(sea, ch * 0.85);
        },
        relief: () => 0.4,
        spawnX: ax + dx * 0.06 - dy * 0.14,
        spawnY: ay + dy * 0.06 + dx * 0.14,
        keep: { x: 0.5 + dx * (coast - 0.06), y: 0.5 + dy * (coast - 0.06) },
      };
    }
    case "summit": {
      const cx = 0.5 + rng.range(-0.04, 0.04);
      const cy = 0.5 + rng.range(-0.04, 0.04);
      const R = rng.range(0.34, 0.38);
      const ph = rng.range(0, Math.PI * 2);
      const sa = Math.PI * 1.25 + rng.range(-0.4, 0.4);
      return {
        at: (nx, ny) => {
          const ex = nx - cx;
          const ey = ny - cy;
          const d = Math.hypot(ex, ey);
          const land = 1 - smooth(R * 0.8, R, d);
          const q = Math.max(0, 1 - d / (R * 0.92));
          // Radial gullies down the flanks, fading out toward the summit.
          const gully = 1 - 0.2 * Math.max(0, Math.cos(Math.atan2(ey, ex) * 7 + ph + d * 9)) * (1 - q);
          let cone = 0.34 * q ** 1.5 * gully;
          cone -= 0.14 * (1 - smooth(0.03, 0.065, d));
          return SEA + (LAND - SEA) * land + cone;
        },
        relief: (nx, ny) => 0.5 + 0.5 * smooth(0.08, R, Math.hypot(nx - cx, ny - cy)),
        spawnX: cx + Math.cos(sa) * R * 0.66,
        spawnY: cy + Math.sin(sa) * R * 0.66,
        keep: { x: cx, y: cy },
      };
    }
    case "volcano": {
      const cx = 0.5 + rng.range(-0.04, 0.04);
      const cy = 0.5 + rng.range(-0.04, 0.04);
      // Flanks reach past the map corners; only the lowlands at the edges dip near the waterline.
      const R = 0.74;
      const rim = rng.range(0.075, 0.095);
      const ph = rng.range(0, Math.PI * 2);
      const jag = rng.range(0, Math.PI * 2);
      const sa = Math.PI * 1.25 + rng.range(-0.4, 0.4);
      // Crater floor sunk well below the waterline: fills with water (lava on the volcanic theme).
      // Lumpy crater outline, not a perfect circle.
      const rimAt = (ang: number) => rim * (1 + 0.09 * Math.cos(ang * 3 + jag) + 0.05 * Math.sin(ang * 7 - ph));
      const floor = (d: number, ang: number) => {
        const r = rimAt(ang);
        return 1 - smooth(r * 0.72, r, d);
      };
      return {
        at: (nx, ny) => {
          const ex = nx - cx;
          const ey = ny - cy;
          const d = Math.hypot(ex, ey);
          const ang = Math.atan2(ey, ex);
          const low = -0.08 * smooth(0.2, 0.7, d);
          const q = Math.max(0, Math.min(1, (R - d) / (R - rimAt(ang))));
          const gully = 1 - 0.2 * Math.max(0, Math.cos(ang * 8 + ph + d * 10)) * (1 - q);
          // Jagged peak ring: rim height varies around the crater.
          const peaks = 0.82 + 0.18 * Math.cos(ang * 5 + jag) * Math.cos(ang * 3 - jag * 0.7);
          const cone = 0.36 * q ** 2 * gully * peaks;
          const f = floor(d, ang);
          return low + cone * (1 - f) - 0.45 * f;
        },
        relief: (nx, ny) => {
          return 0.6 - 0.35 * floor(Math.hypot(nx - cx, ny - cy), Math.atan2(ny - cy, nx - cx));
        },
        spawnX: cx + Math.cos(sa) * 0.36,
        spawnY: cy + Math.sin(sa) * 0.36,
        // Stronghold up on the crater rim, across from the spawn.
        keep: { x: cx - Math.cos(sa) * rim * 1.15, y: cy - Math.sin(sa) * rim * 1.15 },
      };
    }
    case "shards": {
      // Whole map climbs from the spawn side to the far edge.
      const ra = Math.PI / 4 + rng.range(-0.6, 0.6);
      const rx = Math.cos(ra);
      const ry = Math.sin(ra);
      const climb = (x: number, y: number) => ((x - 0.5) * rx + (y - 0.5) * ry) * 0.32;
      const ns = (seed ^ 0x5aa7d) >>> 0;
      // Cracked-mud tiles: each a raised plate, gently domed at its own height, split by sharp cracks.
      const pts: { x: number; y: number; amp: number; dome: number }[] = [];
      const G = 6;
      for (let gy = 0; gy < G; gy++) {
        for (let gx = 0; gx < G; gx++) {
          pts.push({
            x: (gx + rng.range(0.15, 0.85)) / G,
            y: (gy + rng.range(0.15, 0.85)) / G,
            amp: rng.range(0.06, 0.2),
            dome: rng.range(0.03, 0.09),
          });
        }
      }
      // Center-to-center distances, so the edge search can skip far neighbors.
      const N = pts.length;
      const gap = new Float32Array(N * N);
      for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) gap[i * N + j] = Math.hypot(pts[j]!.x - pts[i]!.x, pts[j]!.y - pts[i]!.y) || 1;
      // Scratch for the nearest-center search (no per-texel allocation).
      let near1 = 0;
      let dist1 = 0;
      /** Exact distance to the tile edge (nearest bisector over every neighbor). */
      const nearest = (nx: number, ny: number): number => {
        let d1 = Infinity;
        for (let k = 0; k < N; k++) {
          const p = pts[k]!;
          const d = (nx - p.x) ** 2 + (ny - p.y) ** 2;
          if (d < d1) {
            d1 = d;
            near1 = k;
          }
        }
        dist1 = Math.sqrt(d1);
        const a = pts[near1]!;
        let e = Infinity;
        for (let k = 0; k < N; k++) {
          if (k === near1) continue;
          const len = gap[near1 * N + k]!;
          // That bisector is at least len/2 - dist1 away.
          if (len / 2 - dist1 >= e) continue;
          const b = pts[k]!;
          e = Math.min(e, len / 2 - ((nx - a.x) * (b.x - a.x) + (ny - a.y) * (b.y - a.y)) / len);
        }
        return e;
      };
      nearest(OPEN_SPAWN, OPEN_SPAWN);
      const spawnK = near1;
      let keepK = 0;
      const top = (k: number) => pts[k]!.amp + climb(pts[k]!.x, pts[k]!.y);
      for (let k = 1; k < N; k++) if (top(k) > top(keepK)) keepK = k;
      return {
        at: (nx, ny) => {
          const e = nearest(nx, ny);
          const p = pts[near1]!;
          // Dome follows the tile's own outline: 0 at its center → 1 at its edge.
          const q = dist1 / (dist1 + e || 1);
          const plate = p.amp + p.dome * (1 - q * q);
          // Crack: width wanders along its length; sharp-lipped drop into the gap.
          const w = SHARD_CRACK_MIN + (SHARD_CRACK_MAX - SHARD_CRACK_MIN) * fbm(nx * 9 + 3, ny * 9 + 11, ns + 1, 2);
          const crack = 1 - smooth(w * 0.55, w, e);
          const lumps = (fbm(nx * 7 + 13, ny * 7 + 29, ns, 4) - 0.5) * 0.05;
          return -0.12 + climb(nx, ny) + plate * (1 - crack) - SHARD_CRACK_DEPTH * crack + lumps;
        },
        relief: () => 0.35,
        spawnX: pts[spawnK]!.x,
        spawnY: pts[spawnK]!.y,
        keep: { x: pts[keepK]!.x, y: pts[keepK]!.y },
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
