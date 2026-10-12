import { TEX, WORLD } from "./dims";
import { themeOf, waterBandLooks, type BiomeLook, type RGB } from "./theme";
import { GROUND_Z_SCALE, SHALLOW_WATER_Z, type WorldData } from "./world";

/** Height per contour band (height-map units), and every Nth contour drawn as a darker index line. */
const TOPO_BAND = 0.035;
const TOPO_INDEX_EVERY = 4;
/** Lowest land height the band shading starts from, and the span it brightens over. */
const TOPO_LAND_LO = 0.34;
const TOPO_LAND_SPAN = 0.6;
/** Box-blur passes over the sampled heights, so contours run as clean lines instead of hatching. */
const TOPO_SMOOTH_PASSES = 2;
/** Pull toward neutral grey so the map reads as HUD, not terrain art. */
const TOPO_DESAT = 0.25;
/** Contour line darkness (× fill): normal / index. */
const TOPO_LINE = 0.56;
const TOPO_INDEX_LINE = 0.4;
/** Shoreline mix toward white. */
const TOPO_SHORE = 0.4;
const ROAD_RGBA = "rgba(236, 222, 186, 0.8)";

const mid = (l: BiomeLook): RGB => l.tint ?? [(l.lo[0] + l.hi[0]) / 2, (l.lo[1] + l.hi[1]) / 2, (l.lo[2] + l.hi[2]) / 2];

/** Topographic minimap (`px` square): theme-tinted height bands + contours, shallow / deep water, roads; `edge` = off-map fill. */
export function renderTopoMap(world: WorldData, px: number): { canvas: HTMLCanvasElement; edge: number } {
  const theme = themeOf(world.theme);
  const looks = theme.looks.map(mid);
  const bands = waterBandLooks(theme.looks[0]!);
  const shallow = bands.shallow.lo;
  const deep = bands.deep.hi;
  const n = px * px;
  // Band per pixel: water = -1 (shallow) / -2 (deep); land = contour band index.
  const band = new Int16Array(n);
  const rgb = new Float32Array(n * 3);
  const h = new Float32Array(n);
  for (let py = 0; py < px; py++) {
    const ty = Math.min(TEX - 1, Math.floor(((py + 0.5) / px) * TEX));
    for (let pxx = 0; pxx < px; pxx++) h[py * px + pxx] = world.height[ty * TEX + Math.min(TEX - 1, Math.floor(((pxx + 0.5) / px) * TEX))]!;
  }
  smooth(h, px, TOPO_SMOOTH_PASSES);
  for (let py = 0; py < px; py++) {
    const ty = Math.min(TEX - 1, Math.floor(((py + 0.5) / px) * TEX));
    for (let pxx = 0; pxx < px; pxx++) {
      const tx = Math.min(TEX - 1, Math.floor(((pxx + 0.5) / px) * TEX));
      const t = ty * TEX + tx;
      const i = py * px + pxx;
      const b = world.biome[t]!;
      let c: RGB;
      if (b <= 1) {
        const depth = (Math.max(world.water[t]!, world.height[t]!) - world.height[t]!) * GROUND_Z_SCALE;
        const isDeep = depth > SHALLOW_WATER_Z;
        band[i] = isDeep ? -2 : -1;
        c = isDeep ? deep : shallow;
      } else {
        const k = Math.max(0, Math.floor((h[i]! - TOPO_LAND_LO) / TOPO_BAND));
        band[i] = k;
        const lift = 0.72 + 0.26 * Math.min(1, (k * TOPO_BAND) / TOPO_LAND_SPAN);
        const base = looks[b]!;
        c = [base[0] * lift, base[1] * lift, base[2] * lift];
      }
      const grey = (c[0] + c[1] + c[2]) / 3;
      rgb[i * 3] = c[0] + (grey - c[0]) * TOPO_DESAT;
      rgb[i * 3 + 1] = c[1] + (grey - c[1]) * TOPO_DESAT;
      rgb[i * 3 + 2] = c[2] + (grey - c[2]) * TOPO_DESAT;
    }
  }
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = px;
  const g = canvas.getContext("2d")!;
  const img = g.createImageData(px, px);
  const d = img.data;
  let sr = 0;
  let sg = 0;
  let sb = 0;
  for (let py = 0; py < px; py++) {
    for (let pxx = 0; pxx < px; pxx++) {
      const i = py * px + pxx;
      const k = band[i]!;
      const r = pxx + 1 < px ? band[i + 1]! : k;
      const dn = py + 1 < px ? band[i + px]! : k;
      let mul = 1;
      let shore = 0;
      if (k >= 0) {
        // Contour where the band steps; index line on the higher band's multiple.
        const step = (r >= 0 && r !== k) || (dn >= 0 && dn !== k);
        if (step) mul = Math.max(k, r, dn) % TOPO_INDEX_EVERY === 0 ? TOPO_INDEX_LINE : TOPO_LINE;
      } else if (r >= 0 || dn >= 0 || (pxx > 0 && band[i - 1]! >= 0) || (py > 0 && band[i - px]! >= 0)) {
        shore = TOPO_SHORE;
      }
      const o = i * 4;
      for (let ch = 0; ch < 3; ch++) {
        const v = rgb[i * 3 + ch]! * mul;
        d[o + ch] = v + (255 - v) * shore;
      }
      d[o + 3] = 255;
      sr += d[o]!;
      sg += d[o + 1]!;
      sb += d[o + 2]!;
    }
  }
  g.putImageData(img, 0, 0);
  const k = px / WORLD;
  g.strokeStyle = ROAD_RGBA;
  g.lineCap = g.lineJoin = "round";
  for (const road of world.roads) {
    if (road.nodes.length < 2) continue;
    g.lineWidth = Math.max(1, road.width * k * (road.spur ? 0.6 : 1));
    g.beginPath();
    g.moveTo(road.nodes[0]!.x * k, road.nodes[0]!.y * k);
    for (let j = 1; j < road.nodes.length; j++) g.lineTo(road.nodes[j]!.x * k, road.nodes[j]!.y * k);
    g.stroke();
  }
  const edge = ((sr / n) * 0.55) << 16 | ((sg / n) * 0.55) << 8 | ((sb / n) * 0.55);
  return { canvas, edge };
}

/** In-place 3×3 box blur, `passes` times (edges clamp). */
function smooth(v: Float32Array, w: number, passes: number): void {
  const tmp = new Float32Array(v.length);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < w; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        tmp[i] = (v[x > 0 ? i - 1 : i]! + v[i]! + v[x < w - 1 ? i + 1 : i]!) / 3;
      }
    }
    for (let y = 0; y < w; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        v[i] = (tmp[y > 0 ? i - w : i]! + tmp[i]! + tmp[y < w - 1 ? i + w : i]!) / 3;
      }
    }
  }
}
