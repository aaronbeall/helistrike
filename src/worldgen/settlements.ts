/** Settlements: towns, ports, airfields and dams — placed on suitable terrain, returned as structure footprints. */
import { Rng } from "../util/rng";
import { UNIT_SPECS } from "../catalog/units";
import type { UnitKind } from "../sim/roster";

export type StructureKind =
  | "house"
  | "warehouse"
  | "plaza"
  | "runway"
  | "hangar"
  | "control_tower"
  | "pier"
  | "dock_shed"
  | "dam"
  | "field_wheat"
  | "field_green"
  | "field_plowed"
  | "helipad"
  | "pylon"
  | "power_station"
  | "bridge"
  | "bridge_steel"
  | "silo"
  | "silo_single"
  | "oil_rig"
  | "heli_platform"
  | "dock_building"
  | "fishing_boat"
  | "yacht";
export type SettlementKind = "town" | "port" | "airfield" | "dam" | "farm" | "oil_field" | "power_station" | "powerline" | "bridge";

/** Structures that spawn as destructible units (buildings + civilian boats); the rest are terrain decor prints. */
export const UNIT_STRUCTURES = [
  "house",
  "warehouse",
  "hangar",
  "control_tower",
  "dock_shed",
  "pylon",
  "power_station",
  "bridge",
  "bridge_steel",
  "pier",
  "silo",
  "silo_single",
  "oil_rig",
  "heli_platform",
  "dock_building",
  "fishing_boat",
  "yacht",
] as const satisfies readonly (StructureKind & UnitKind)[];
export type UnitStructureKind = (typeof UNIT_STRUCTURES)[number];

export function isUnitStructure(kind: StructureKind): kind is UnitStructureKind {
  return (UNIT_STRUCTURES as readonly StructureKind[]).includes(kind);
}

/** Flat ground prints painted under the road network (everything else printed paints over it). */
export function isGroundPrint(kind: StructureKind): boolean {
  return kind === "field_wheat" || kind === "field_green" || kind === "field_plowed";
}

/** A footprint in world units: centered at (x, y), `l` along `rot`, `w` across. */
export interface Structure {
  kind: StructureKind;
  x: number;
  y: number;
  rot: number;
  w: number;
  l: number;
  /** Base z for the spawned unit (bridge decks); default = ground. */
  z?: number;
}

export interface Settlement {
  kind: SettlementKind;
  /** Road hookup point (world). */
  x: number;
  y: number;
  parts: Structure[];
  /** Town street grid (world): centre, heading, cell spacing, radius. */
  grid?: { x: number; y: number; a: number; spacing: number; radius: number };
  /** Power line: the power stations it runs between (world), wired to the first / last pylon. */
  source?: { x: number; y: number };
  target?: { x: number; y: number };
}

/** What placement needs from the world (texel grid TEX × TEX; world = texel × scale). */
export interface SettlementInput {
  tex: number;
  scale: number;
  /** Final ground / bed height (writable: pads are levelled). */
  height: Float32Array;
  /** Water surface per texel, -1 dry. */
  water: Float32Array;
  /** Sea level (sea surface == this). */
  seaLevel: number;
  /** Dry, buildable ground (not water / river / rock / peak). */
  buildable: (i: number) => boolean;
  /** Farmable ground (grassland). */
  fertile: (i: number) => boolean;
  /** River channel texel. */
  river: (i: number) => boolean;
  /** River half-width (texels) at a river texel. */
  riverRad: Float32Array;
  rng: Rng;
  /** World points to keep clear of (spawn, objectives). */
  avoid: { x: number; y: number }[];
  /** 0 = none … 2 = dense. */
  density: number;
  /** World discs already taken by units (buildings skip overlapping spots). */
  occupied: { x: number; y: number; r: number }[];
  /** No water sites: skips ports, dams and oil fields. */
  dryOnly?: boolean;
}

// Sizes in texels.
const RUNWAY_HALF_LEN = 100;
const RUNWAY_HALF_W = 6;
const TOWN_RADIUS = 70;
const TOWN_GRID = 30;
const HELIPAD = 20;
const PLAZA = 16;
/** Dam abutments added past the ravine span (texels). */
const DAM_ABUTMENTS = 16;
/** A middling ravine span (texels), for previews; real dams fit their ravine. */
const DAM_TYPICAL_SPAN = 30;
const FARM_RADIUS = 62;
/** Field size (texels, long × short) and gap between fields. */
const FIELD_L = 30;
const FIELD_W = 20;
const FIELD_GAP = 3;
/** Pylon spacing along a power line (texels). */
const PYLON_STEP = 58;
const FIELD_KINDS = ["field_wheat", "field_green", "field_plowed"] as const;

/** Typical long side (texels) of each terrain decor print, for previews (sprite rig). */
export const DECOR_TYPICAL_LEN: Record<Exclude<StructureKind, UnitStructureKind>, number> = {
  plaza: PLAZA,
  runway: RUNWAY_HALF_LEN * 2,
  dam: DAM_TYPICAL_SPAN + DAM_ABUTMENTS,
  field_wheat: FIELD_L,
  field_green: FIELD_L,
  field_plowed: FIELD_L,
  helipad: HELIPAD,
};
const PIER_LEN = 30;
const KEEP_CLEAR = 120;

export function placeSettlements(inp: SettlementInput): Settlement[] {
  const out: Settlement[] = [];
  if (inp.density <= 0) return out;
  const towns = Math.round(2 * inp.density);
  const wet = !inp.dryOnly;
  const ports = wet && inp.density >= 0.4 ? Math.round(inp.density) : 0;
  const airfields = inp.density >= 0.5 ? 1 : 0;
  const dams = wet && inp.density >= 0.8 ? 1 : 0;
  const farms = Math.round(1.5 * inp.density);
  const oilFields = wet && inp.density >= 0.5 ? 1 : 0;
  const taken: { x: number; y: number; r: number }[] = inp.avoid.map((p) => ({ x: p.x / inp.scale, y: p.y / inp.scale, r: KEEP_CLEAR }));
  const clear = (x: number, y: number, r: number) => taken.every((t) => Math.hypot(t.x - x, t.y - y) > t.r + r);
  for (let k = 0; k < airfields; k++) {
    const s = placeAirfield(inp, clear);
    if (s) taken.push(s.zone), out.push(s.settlement);
  }
  for (let k = 0; k < ports; k++) {
    const s = placePort(inp, clear);
    if (s) taken.push(s.zone), out.push(s.settlement);
  }
  for (let k = 0; k < dams; k++) {
    const s = placeDam(inp, clear);
    if (s) taken.push(s.zone), out.push(s.settlement);
  }
  for (let k = 0; k < towns; k++) {
    const s = placeTown(inp, clear);
    if (s) taken.push(s.zone), out.push(s.settlement);
  }
  for (let k = 0; k < farms; k++) {
    const s = placeFarm(inp, clear);
    if (s) taken.push(s.zone), out.push(s.settlement);
  }
  for (let k = 0; k < oilFields; k++) {
    const s = placeOilField(inp, clear);
    if (s) taken.push(s.zone), out.push(s.settlement);
  }
  out.push(...placePowerLines(inp, out, taken));
  return out;
}

type Placed = { settlement: Settlement; zone: { x: number; y: number; r: number } };

function part(inp: SettlementInput, kind: StructureKind, tx: number, ty: number, rot: number, w: number, l: number): Structure {
  return { kind, x: tx * inp.scale, y: ty * inp.scale, rot, w: w * inp.scale, l: l * inp.scale };
}

/** Unit-backed building sized from its unit box; pad levelled. Null when the spot is wet, unbuildable or taken. */
function building(inp: SettlementInput, kind: UnitStructureKind, tx: number, ty: number, rot: number): Structure | null {
  const sp = UNIT_SPECS[kind];
  const box = sp.box!;
  const hl = box.halfL / inp.scale;
  const hw = box.halfW / inp.scale;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const wet = !!sp.water;
  for (const [u, v] of [[0, 0], [hl, hw], [hl, -hw], [-hl, hw], [-hl, -hw]] as const) {
    const px = Math.round(tx + u * c - v * s);
    const py = Math.round(ty + u * s + v * c);
    if (px < 0 || py < 0 || px >= inp.tex || py >= inp.tex) return null;
    const i = py * inp.tex + px;
    if (wet ? inp.water[i]! < 0 : !inp.buildable(i)) return null;
  }
  const r = (box.halfL + box.halfW) / 2;
  const wx = tx * inp.scale;
  const wy = ty * inp.scale;
  if (inp.occupied.some((o) => Math.hypot(o.x - wx, o.y - wy) < o.r + r)) return null;
  if (!wet) levelRect(inp, tx, ty, rot, hl, hw, 4);
  inp.occupied.push({ x: wx, y: wy, r });
  return { kind, x: wx, y: wy, rot, w: box.halfW * 2, l: box.halfL * 2 };
}

/** Level a rotated rect (texels) toward its mean height, blending out over `margin`. */
function levelRect(inp: SettlementInput, cx: number, cy: number, rot: number, halfL: number, halfW: number, margin: number): void {
  const { tex, height } = inp;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const R = Math.ceil(Math.hypot(halfL, halfW) + margin);
  let sum = 0;
  let n = 0;
  for (let y = -R; y <= R; y++) {
    for (let x = -R; x <= R; x++) {
      const u = Math.abs(x * c + y * s);
      const v = Math.abs(-x * s + y * c);
      if (u > halfL || v > halfW) continue;
      const tx = Math.round(cx + x);
      const ty = Math.round(cy + y);
      if (tx < 0 || ty < 0 || tx >= tex || ty >= tex) continue;
      sum += height[ty * tex + tx]!;
      n++;
    }
  }
  if (!n) return;
  const mean = sum / n;
  for (let y = -R; y <= R; y++) {
    for (let x = -R; x <= R; x++) {
      const tx = Math.round(cx + x);
      const ty = Math.round(cy + y);
      if (tx < 0 || ty < 0 || tx >= tex || ty >= tex) continue;
      const i = ty * tex + tx;
      if (inp.water[i]! >= 0) continue;
      const du = Math.max(0, Math.abs(x * c + y * s) - halfL);
      const dv = Math.max(0, Math.abs(-x * s + y * c) - halfW);
      const d = Math.hypot(du, dv);
      if (d > margin) continue;
      const t = 1 - d / margin;
      height[i] = height[i]! + (mean - height[i]!) * t * t * (3 - 2 * t);
    }
  }
}

/** Airfield: the flattest long dry strip that fits a runway; levelled, with hangars and a tower beside it. */
function placeAirfield(inp: SettlementInput, clear: (x: number, y: number, r: number) => boolean): Placed | null {
  const { tex, height, buildable, rng } = inp;
  let best: { x: number; y: number; a: number; score: number } | null = null;
  const m = RUNWAY_HALF_LEN + 20;
  for (let t = 0; t < 900; t++) {
    const x = rng.range(m, tex - m);
    const y = rng.range(m, tex - m);
    if (!clear(x, y, RUNWAY_HALF_LEN)) continue;
    const a = rng.range(0, Math.PI);
    const c = Math.cos(a);
    const s = Math.sin(a);
    let lo = Infinity;
    let hi = -Infinity;
    let ok = true;
    for (let u = -RUNWAY_HALF_LEN; u <= RUNWAY_HALF_LEN && ok; u += 8) {
      for (const v of [-RUNWAY_HALF_W - 4, 0, RUNWAY_HALF_W + 4]) {
        const i = Math.round(y + u * s + v * c) * tex + Math.round(x + u * c - v * s);
        if (!buildable(i)) {
          ok = false;
          break;
        }
        lo = Math.min(lo, height[i]!);
        hi = Math.max(hi, height[i]!);
      }
    }
    if (!ok) continue;
    const score = hi - lo;
    if (score < 0.035 && (!best || score < best.score)) best = { x, y, a, score };
  }
  if (!best) return null;
  const { x, y, a } = best;
  levelRect(inp, x, y, a, RUNWAY_HALF_LEN + 6, RUNWAY_HALF_W + 14, 14);
  const c = Math.cos(a);
  const s = Math.sin(a);
  const side = rng.chance(0.5) ? 1 : -1;
  const off = (u: number, v: number): [number, number] => [x + u * c - v * s * side, y + u * s + v * c * side];
  const parts: Structure[] = [part(inp, "runway", x, y, a, RUNWAY_HALF_W * 2, RUNWAY_HALF_LEN * 2)];
  const add = (b: Structure | null) => b && parts.push(b);
  for (const u of [-44, -6]) add(building(inp, "hangar", ...off(u, RUNWAY_HALF_W + 28), a + Math.PI / 2));
  add(building(inp, "control_tower", ...off(22, RUNWAY_HALF_W + 13), a));
  parts.push(part(inp, "helipad", ...off(44, RUNWAY_HALF_W + 16), a, HELIPAD, HELIPAD));
  const [rx, ry] = off(30, RUNWAY_HALF_W + 40);
  return {
    settlement: { kind: "airfield", x: rx * inp.scale, y: ry * inp.scale, parts },
    zone: { x, y, r: RUNWAY_HALF_LEN + 20 },
  };
}

/** Port: a sheltered sea shore (cove) — pier out into the water, sheds on the flat shore behind. */
function placePort(inp: SettlementInput, clear: (x: number, y: number, r: number) => boolean): Placed | null {
  const { tex, water, seaLevel, buildable, rng } = inp;
  const sea = (i: number) => water[i]! >= 0 && Math.abs(water[i]! - seaLevel) < 1e-4;
  let best: { x: number; y: number; nx: number; ny: number; score: number } | null = null;
  for (let t = 0; t < 2500; t++) {
    const x = rng.int(40, tex - 41);
    const y = rng.int(40, tex - 41);
    const i = y * tex + x;
    if (!buildable(i)) continue;
    // Shore: sea within a few texels.
    let wx = 0;
    let wy = 0;
    let wet = 0;
    let total = 0;
    for (let oy = -24; oy <= 24; oy += 3) {
      for (let ox = -24; ox <= 24; ox += 3) {
        total++;
        if (!sea((y + oy) * tex + x + ox)) continue;
        wet++;
        wx += ox;
        wy += oy;
      }
    }
    if (!wet) continue;
    const frac = wet / total;
    // A cove: water on one side but land wrapping round (not an open headland).
    if (frac < 0.25 || frac > 0.6) continue;
    const len = Math.hypot(wx, wy) || 1;
    const nx = wx / len;
    const ny = wy / len;
    let nearSea = false;
    for (let d = 2; d <= 10 && !nearSea; d++) nearSea = sea(Math.round(y + ny * d) * tex + Math.round(x + nx * d));
    if (!nearSea || !clear(x, y, 50)) continue;
    const score = -Math.abs(frac - 0.42);
    if (!best || score > best.score) best = { x, y, nx, ny, score };
  }
  if (!best) return null;
  const { x, y, nx, ny } = best;
  const a = Math.atan2(ny, nx);
  levelRect(inp, x - nx * 19, y - ny * 19, a, 16, 24, 10);
  // Pier: a unit (root may touch the shore, so no all-water footprint check), sized from its unit box.
  const pierBox = UNIT_SPECS.pier.box!;
  const parts: Structure[] = [
    {
      kind: "pier",
      x: (x + nx * (PIER_LEN / 2 + 3)) * inp.scale,
      y: (y + ny * (PIER_LEN / 2 + 3)) * inp.scale,
      rot: a,
      w: pierBox.halfW * 2,
      l: pierBox.halfL * 2,
    },
  ];
  for (const side of [-1, 1]) {
    const b = building(inp, "dock_shed", x - nx * 19 - ny * side * 13, y - ny * 19 + nx * side * 13, a);
    if (b) parts.push(b);
  }
  // Over the water beside the pier: a dock house one side, moored boats the other.
  const side = rng.chance(0.5) ? 1 : -1;
  const px = -ny;
  const py = nx;
  const along = (u: number, v: number): [number, number] => [x + nx * u + px * v, y + ny * u + py * v];
  const add = (b: Structure | null) => b && parts.push(b);
  add(building(inp, "dock_building", ...along(22, side * 14), a));
  for (const u of [15, 30]) {
    if (rng.chance(0.8)) add(building(inp, rng.chance(0.5) ? "fishing_boat" : "yacht", ...along(u, -side * 6.5), a + (rng.chance(0.5) ? 0 : Math.PI)));
  }
  if (rng.chance(0.6)) add(building(inp, rng.chance(0.5) ? "fishing_boat" : "yacht", ...along(PIER_LEN + 8, 0), a));
  return {
    settlement: { kind: "port", x: (x - nx * 40) * inp.scale, y: (y - ny * 40) * inp.scale, parts },
    zone: { x, y, r: 70 },
  };
}

/** Dam: across a narrow river ravine with high walls; a wall perpendicular to the flow. */
function placeDam(inp: SettlementInput, clear: (x: number, y: number, r: number) => boolean): Placed | null {
  const { tex, height, water, river, riverRad, rng } = inp;
  let best: { x: number; y: number; a: number; span: number; score: number } | null = null;
  for (let t = 0; t < 3000; t++) {
    const x = rng.int(50, tex - 51);
    const y = rng.int(50, tex - 51);
    const i = y * tex + x;
    if (!river(i) || riverRad[i]! < 2 || riverRad[i]! > 9 || !clear(x, y, 30)) continue;
    // Flow direction: principal axis of nearby river texels.
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    for (let oy = -6; oy <= 6; oy++) {
      for (let ox = -6; ox <= 6; ox++) {
        if (!river((y + oy) * tex + x + ox)) continue;
        sxx += ox * ox;
        syy += oy * oy;
        sxy += ox * oy;
      }
    }
    const flow = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    const px = -Math.sin(flow);
    const py = Math.cos(flow);
    // Ravine walls: dry ground both sides within reach, well above the water.
    let span = 0;
    let rise = Infinity;
    for (const side of [-1, 1]) {
      let d = 1;
      while (d < 30 && water[Math.round(y + py * d * side) * tex + Math.round(x + px * d * side)]! >= 0) d++;
      if (d >= 30) {
        rise = -1;
        break;
      }
      span += d;
      const bank = height[Math.round(y + py * (d + 8) * side) * tex + Math.round(x + px * (d + 8) * side)]!;
      rise = Math.min(rise, bank - water[i]!);
    }
    if (rise < 0.03) continue;
    const score = rise - span * 0.002;
    if (!best || score > best.score) best = { x, y, a: flow, span, score };
  }
  if (!best) return null;
  const { x, y, a, span } = best;
  const parts: Structure[] = [part(inp, "dam", x, y, a + Math.PI / 2, 6, span + DAM_ABUTMENTS)];
  const ex = x - Math.sin(a) * (span / 2 + 14);
  const ey = y + Math.cos(a) * (span / 2 + 14);
  return { settlement: { kind: "dam", x: ex * inp.scale, y: ey * inp.scale, parts }, zone: { x, y, r: 40 } };
}

/** Town: flat dry ground (preferably near water), a plaza and buildings on a jittered street grid. */
function placeTown(inp: SettlementInput, clear: (x: number, y: number, r: number) => boolean): Placed | null {
  const { tex, height, water, buildable, rng } = inp;
  let best: { x: number; y: number; score: number } | null = null;
  for (let t = 0; t < 1200; t++) {
    const x = rng.range(TOWN_RADIUS + 20, tex - TOWN_RADIUS - 20);
    const y = rng.range(TOWN_RADIUS + 20, tex - TOWN_RADIUS - 20);
    const i = Math.round(y) * tex + Math.round(x);
    if (!buildable(i) || !clear(x, y, TOWN_RADIUS + 30)) continue;
    let lo = Infinity;
    let hi = -Infinity;
    let dry = 0;
    let n = 0;
    let nearWater = false;
    for (let oy = -TOWN_RADIUS; oy <= TOWN_RADIUS; oy += 7) {
      for (let ox = -TOWN_RADIUS; ox <= TOWN_RADIUS; ox += 7) {
        const j = Math.round(y + oy) * tex + Math.round(x + ox);
        n++;
        if (water[j]! >= 0) nearWater = true;
        if (!buildable(j)) continue;
        dry++;
        lo = Math.min(lo, height[j]!);
        hi = Math.max(hi, height[j]!);
      }
    }
    if (dry < n * 0.7) continue;
    const score = -(hi - lo) + (nearWater ? 0.03 : 0) + rng.range(0, 0.01);
    if (!best || score > best.score) best = { x, y, score };
  }
  if (!best) return null;
  const { x, y } = best;
  const a = rng.range(0, Math.PI);
  const c = Math.cos(a);
  const s = Math.sin(a);
  levelRect(inp, x, y, a, 8, 8, 10);
  const parts: Structure[] = [part(inp, "plaza", x, y, a, PLAZA, PLAZA)];
  const grid = TOWN_GRID;
  const R = Math.floor(TOWN_RADIUS / grid);
  // Some towns give one cell next to the plaza to a helipad; every town gives an outer cell to its power station.
  const pad = rng.chance(0.5) ? rng.pick([[1, 0], [-1, 0], [0, 1], [0, -1]] as const) : null;
  const outer: [number, number][] = [];
  for (let gu = -R; gu <= R; gu++) {
    for (let gv = -R; gv <= R; gv++) {
      if ((Math.abs(gu) === R || Math.abs(gv) === R) && Math.hypot(gu * grid, gv * grid) <= TOWN_RADIUS) outer.push([gu, gv]);
    }
  }
  const power = outer.length ? rng.pick(outer) : null;
  let powered = false;
  for (let gu = -R; gu <= R; gu++) {
    for (let gv = -R; gv <= R; gv++) {
      if (gu === 0 && gv === 0) continue;
      const u = gu * grid + rng.range(-1, 1);
      const v = gv * grid + rng.range(-1, 1);
      if (Math.hypot(u, v) > TOWN_RADIUS || rng.chance(0.18)) continue;
      const bx = x + u * c - v * s;
      const by = y + u * s + v * c;
      if (!powered && power && gu === power[0] && gv === power[1]) {
        const st = building(inp, "power_station", bx, by, a);
        if (st) {
          parts.push(st);
          powered = true;
          continue;
        }
      }
      if (pad && gu === pad[0] && gv === pad[1]) {
        if (buildable(Math.round(by) * tex + Math.round(bx))) parts.push(part(inp, "helipad", bx, by, a, HELIPAD, HELIPAD));
        continue;
      }
      const b = building(inp, rng.chance(0.15) ? "warehouse" : "house", bx, by, a + (rng.chance(0.5) ? 0 : Math.PI / 2));
      if (b) parts.push(b);
    }
  }
  const streets = { x: x * inp.scale, y: y * inp.scale, a, spacing: grid * inp.scale, radius: TOWN_RADIUS * inp.scale };
  return { settlement: { kind: "town", x: x * inp.scale, y: y * inp.scale, parts, grid: streets }, zone: { x, y, r: TOWN_RADIUS + 10 } };
}

/** Farm: flat open grass — a silo and farmhouse in the middle of a patchwork of printed fields. */
function placeFarm(inp: SettlementInput, clear: (x: number, y: number, r: number) => boolean): Placed | null {
  const { tex, height, fertile, rng } = inp;
  let best: { x: number; y: number; score: number } | null = null;
  for (let t = 0; t < 900; t++) {
    const x = rng.range(FARM_RADIUS + 20, tex - FARM_RADIUS - 20);
    const y = rng.range(FARM_RADIUS + 20, tex - FARM_RADIUS - 20);
    if (!fertile(Math.round(y) * tex + Math.round(x)) || !clear(x, y, FARM_RADIUS + 20)) continue;
    let lo = Infinity;
    let hi = -Infinity;
    let dry = 0;
    let n = 0;
    for (let oy = -FARM_RADIUS; oy <= FARM_RADIUS; oy += 8) {
      for (let ox = -FARM_RADIUS; ox <= FARM_RADIUS; ox += 8) {
        const j = Math.round(y + oy) * tex + Math.round(x + ox);
        n++;
        if (!fertile(j)) continue;
        dry++;
        lo = Math.min(lo, height[j]!);
        hi = Math.max(hi, height[j]!);
      }
    }
    if (dry < n * 0.75) continue;
    const score = -(hi - lo) + rng.range(0, 0.01);
    if (!best || score > best.score) best = { x, y, score };
  }
  if (!best) return null;
  const { x, y } = best;
  const a = rng.range(0, Math.PI);
  const c = Math.cos(a);
  const s = Math.sin(a);
  const parts: Structure[] = [];
  const add = (b: Structure | null) => b && parts.push(b);
  add(building(inp, rng.chance(0.5) ? "silo" : "silo_single", x + 15 * c, y + 15 * s, a));
  add(building(inp, "house", x - 14 * c, y - 14 * s, a + Math.PI / 2));
  const du = FIELD_L + FIELD_GAP;
  const dv = FIELD_W + FIELD_GAP;
  for (let gu = -2; gu <= 2; gu++) {
    for (let gv = -2; gv <= 2; gv++) {
      if (Math.abs(gu) <= 1 && gv === 0) continue;
      const u = gu * du;
      const v = gv * dv;
      if (Math.hypot(u, v) > FARM_RADIUS + 10 || rng.chance(0.15)) continue;
      const fx = x + u * c - v * s;
      const fy = y + u * s + v * c;
      let ok = true;
      for (const [cu, cv] of [[0, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
        const ex = fx + (cu * FIELD_L * c - cv * FIELD_W * s) / 2;
        const ey = fy + (cu * FIELD_L * s + cv * FIELD_W * c) / 2;
        if (!fertile(Math.round(ey) * tex + Math.round(ex))) ok = false;
      }
      if (ok) parts.push(part(inp, rng.pick([...FIELD_KINDS]), fx, fy, a, FIELD_W, FIELD_L));
    }
  }
  if (parts.length < 4) return null;
  return { settlement: { kind: "farm", x: x * inp.scale, y: y * inp.scale, parts }, zone: { x, y, r: FARM_RADIUS + 10 } };
}

/** Oil field: open sea well away from any shore — a rig with a heli platform beside it. */
function placeOilField(inp: SettlementInput, clear: (x: number, y: number, r: number) => boolean): Placed | null {
  const { tex, water, seaLevel, rng } = inp;
  const sea = (x: number, y: number) => {
    const rx = Math.round(x);
    const ry = Math.round(y);
    if (rx < 0 || ry < 0 || rx >= tex || ry >= tex) return true;
    const w = water[ry * tex + rx]!;
    return w >= 0 && Math.abs(w - seaLevel) < 1e-4;
  };
  const SHORE = 60;
  for (let t = 0; t < 1500; t++) {
    const x = rng.range(60, tex - 60);
    const y = rng.range(60, tex - 60);
    if (!sea(x, y) || !clear(x, y, SHORE)) continue;
    let open = true;
    for (let k = 0; k < 16 && open; k++) {
      const ang = (k / 16) * Math.PI * 2;
      for (const d of [SHORE * 0.5, SHORE]) if (!sea(x + Math.cos(ang) * d, y + Math.sin(ang) * d)) open = false;
    }
    if (!open) continue;
    const a = rng.range(0, Math.PI * 2);
    const rig = building(inp, "oil_rig", x, y, a);
    if (!rig) continue;
    const parts: Structure[] = [rig];
    const pa = a + rng.range(-0.6, 0.6);
    const pad = building(inp, "heli_platform", x + Math.cos(pa) * 62, y + Math.sin(pa) * 62, a);
    if (pad) parts.push(pad);
    return { settlement: { kind: "oil_field", x: x * inp.scale, y: y * inp.scale, parts }, zone: { x, y, r: 90 } };
  }
  return null;
}

/** Power grid: town power stations (plus one beside a dam, as the source) linked station to station by pylon lines. */
function placePowerLines(inp: SettlementInput, placed: Settlement[], taken: { x: number; y: number; r: number }[]): Settlement[] {
  const { tex, water, river, rng } = inp;
  const out: Settlement[] = [];
  // Texel coords for layout; exact world coords (wx, wy) so the mission can find the station units.
  const stations: { x: number; y: number; wx: number; wy: number }[] = [];
  for (const st of placed) {
    for (const p of st.parts) if (p.kind === "power_station") stations.push({ x: p.x / inp.scale, y: p.y / inp.scale, wx: p.x, wy: p.y });
  }
  const clear = (x: number, y: number, r: number) => taken.every((t) => Math.hypot(t.x - x, t.y - y) > t.r + r);
  // Dams (the source), airfields, ports and any town without one get a station beside them.
  const needs = placed.filter(
    (st) =>
      st.kind === "dam" || st.kind === "airfield" || st.kind === "port" || (st.kind === "town" && !st.parts.some((p) => p.kind === "power_station"))
  );
  needs.sort((p, q) => Number(q.kind === "dam") - Number(p.kind === "dam"));
  for (const site of needs) {
    const dx = site.x / inp.scale;
    const dy = site.y / inp.scale;
    for (let t = 0; t < 300; t++) {
      const a = rng.range(0, Math.PI * 2);
      const d = rng.range(40, 110);
      const x = dx + Math.cos(a) * d;
      const y = dy + Math.sin(a) * d;
      if (x < 30 || y < 30 || x > tex - 30 || y > tex - 30 || !clear(x, y, 20)) continue;
      const b = building(inp, "power_station", x, y, rng.range(0, Math.PI));
      if (!b) continue;
      // Dam station first: the grid grows out from it.
      if (site.kind === "dam") stations.unshift({ x, y, wx: b.x, wy: b.y });
      else stations.push({ x, y, wx: b.x, wy: b.y });
      taken.push({ x, y, r: 20 });
      out.push({ kind: "power_station", x: (x - 18) * inp.scale, y: y * inp.scale, parts: [b] });
      break;
    }
  }
  if (stations.length < 2) return out;
  // Nearest-neighbour tree over the stations; each edge is one line.
  const linked = new Set<number>([0]);
  while (linked.size < stations.length) {
    let bi = -1;
    let bj = -1;
    let bd = Infinity;
    for (const i of linked) {
      for (let j = 0; j < stations.length; j++) {
        if (linked.has(j)) continue;
        const d = Math.hypot(stations[j]!.x - stations[i]!.x, stations[j]!.y - stations[i]!.y);
        if (d < bd) (bd = d), (bi = i), (bj = j);
      }
    }
    if (bj < 0) break;
    linked.add(bj);
    if (bd > tex * 0.75) continue;
    const a = stations[bi]!;
    const b = stations[bj]!;
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const steps = Math.max(2, Math.round(bd / PYLON_STEP));
    const parts: Structure[] = [];
    let wetRun = 0;
    let ok = true;
    for (let k = 1; k < steps; k++) {
      const t = k / steps;
      const x = a.x + (b.x - a.x) * t + rng.range(-3, 3);
      const y = a.y + (b.y - a.y) * t + rng.range(-3, 3);
      const i = Math.round(y) * tex + Math.round(x);
      if (water[i]! >= 0 || river(i)) {
        if (++wetRun > 3) ok = false;
        continue;
      }
      wetRun = 0;
      // Lines run into their own end settlements, but not across anyone else's.
      if (taken.some((z) => Math.hypot(z.x - x, z.y - y) < z.r && Math.hypot(z.x - a.x, z.y - a.y) > z.r && Math.hypot(z.x - b.x, z.y - b.y) > z.r)) continue;
      const wx = x * inp.scale;
      const wy = y * inp.scale;
      const box = UNIT_SPECS.pylon.box!;
      const r = box.halfL * 0.4;
      if (inp.occupied.some((o) => Math.hypot(o.x - wx, o.y - wy) < o.r + r)) continue;
      inp.occupied.push({ x: wx, y: wy, r });
      parts.push({ kind: "pylon", x: wx, y: wy, rot: ang + Math.PI / 2, w: box.halfW * 2, l: box.halfL * 2 });
    }
    if (!ok) continue;
    out.push({
      kind: "powerline",
      x: a.wx,
      y: a.wy,
      parts,
      source: { x: a.wx, y: a.wy },
      target: { x: b.wx, y: b.wy },
    });
  }
  return out;
}
