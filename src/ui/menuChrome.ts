import Phaser from "phaser";
import { craftControlScheme, craftOf, type CraftSpec } from "../sim/crafts";
import { allMissions } from "../sim/mission";
import { fbm } from "../worldgen/noise";
import { baseHeight, makeShape } from "../worldgen/shape";
import { lookColor, themeOf } from "../worldgen/theme";

/**
 * Blackbody-style heat gradient for segmented stat bars: deep red (t=0, left) through the
 * brand amber to white-hot (t=1, right) — reads as "hotter" toward the high end of the bar.
 */
export function statHeatColor(t: number): number {
  const stops: [number, number, number][] = [
    [176, 58, 30],
    [232, 184, 74],
    [255, 244, 208],
  ];
  const u = Phaser.Math.Clamp(t, 0, 1) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(u));
  const f = u - i;
  const [r0, g0, b0] = stops[i]!;
  const [r1, g1, b1] = stops[i + 1]!;
  const r = Math.round(r0 + (r1 - r0) * f);
  const g = Math.round(g0 + (g1 - g0) * f);
  const b = Math.round(b0 + (b1 - b0) * f);
  return (r << 16) | (g << 8) | b;
}

/**
 * Debug-only knob for the three-region scale's "standard band" half-width (see
 * `computeThreeRegionScale`), as a multiple of the data's median absolute deviation — shared
 * across the menu's FLIGHT PROFILE and the Field Manual's craft stats so +/- adjusts both from a
 * single live value instead of each keeping its own. Remove once the value is settled.
 */
let threeRegionMadMul = 1.25;

export function getThreeRegionMadMul(): number {
  return threeRegionMadMul;
}

/** Nudges the shared debug mad-multiplier by `delta`, clamped to [0.25, 5]. Returns the new value. */
export function adjustThreeRegionMadMul(delta: number): number {
  threeRegionMadMul = Phaser.Math.Clamp(threeRegionMadMul + delta, 0.25, 5);
  return threeRegionMadMul;
}

export interface ThreeRegionScale {
  min: number;
  standardMin: number;
  median: number;
  standardMax: number;
  max: number;
}

function medianOf(sorted: readonly number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Splits a roster's stat values into three regions around the median: a "standard" band
 * (`median ± madMul × the data's median absolute deviation` — a robust dispersion measure, so a
 * handful of extreme outliers don't widen the band the way a min/max-based spread would) and the
 * low/high tails outside it. Feeds `threeRegionNorm`, which is what actually maps a value onto
 * the three regions' bar-fill ranges.
 */
export function computeThreeRegionScale(values: number[], madMul = getThreeRegionMadMul()): ThreeRegionScale {
  const sorted = values.slice().sort((a, b) => a - b);
  const min = sorted[0] ?? 0;
  const max = sorted[sorted.length - 1] ?? 0;
  const median = medianOf(sorted);
  const mad = medianOf(sorted.map((v) => Math.abs(v - median)).sort((a, b) => a - b));
  const halfWidth = mad > 0 ? mad * madMul : (max - min) * 0.1;
  const standardMin = Phaser.Math.Clamp(median - halfWidth, min, max);
  const standardMax = Phaser.Math.Clamp(median + halfWidth, min, max);
  return { min, standardMin, median, standardMax, max };
}

/**
 * Maps a value to a continuous 0-10 bar-fill position using a three-region scale: the low tail
 * (`[min, standardMin]`) fills `[0, 3]`, the standard band (`[standardMin, standardMax]`) fills
 * `[3, 7]`, and the high tail (`[standardMax, max]`) fills `[7, 10]`. Unlike a plain linear or
 * rank-smoothed scale, extreme outliers (FIREPOWER's Warthog/Leviathan/Marauder, say) are
 * contained to the end caps and can't stretch or compress where the *typical* craft land — the
 * bulk of the roster gets the full middle of the bar to spread out in, and only actually-extreme
 * craft reach the very ends. Divide/scale the result for a bar with a segment count other than 10.
 */
export function threeRegionNorm(value: number, scale: ThreeRegionScale): number {
  const { min, standardMin, standardMax, max } = scale;
  if (value <= standardMin) {
    const span = standardMin - min;
    const t = span > 0 ? (value - min) / span : 1;
    return Phaser.Math.Clamp(t, 0, 1) * 3;
  }
  if (value >= standardMax) {
    const span = max - standardMax;
    const t = span > 0 ? (value - standardMax) / span : 1;
    return 7 + Phaser.Math.Clamp(t, 0, 1) * 3;
  }
  const span = standardMax - standardMin;
  const t = span > 0 ? (value - standardMin) / span : 0.5;
  return 3 + Phaser.Math.Clamp(t, 0, 1) * 4;
}

/**
 * Draws a segmented three-region stat bar (`threeRegionNorm` fill against `statHeatColor` heat)
 * at `(x, y)`, `y` centered on the bar's height. Shared by the menu's FLIGHT PROFILE and the
 * Field Manual's craft/remote stat rows so the fill math and segment styling stay in one place.
 */
export function drawThreeRegionBar(
  gfx: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  value: number,
  scale: ThreeRegionScale,
  opts: {
    segW: number;
    segments?: number;
    segGap?: number;
    segH?: number;
    radius?: number;
    emptyColor?: number;
    stroke?: boolean;
  }
): void {
  const segments = opts.segments ?? 10;
  const segGap = opts.segGap ?? 2;
  const segH = opts.segH ?? 6;
  const radius = opts.radius ?? 2;
  const emptyColor = opts.emptyColor ?? 0x302b22;
  const norm = threeRegionNorm(value, scale);
  const filled = Math.max(1, Math.round((norm / 10) * segments));
  for (let seg = 0; seg < segments; seg++) {
    const sx = x + seg * (opts.segW + segGap);
    const sy = y - segH / 2;
    const heat = statHeatColor(seg / (segments - 1));
    gfx.fillStyle(seg < filled ? heat : emptyColor, seg < filled ? 0.96 : 0.82);
    gfx.fillRoundedRect(sx, sy, opts.segW, segH, radius);
    if (opts.stroke) {
      gfx.lineStyle(1, seg < filled ? heat : 0x5d5544, seg < filled ? 0.9 : 0.7);
      gfx.strokeRoundedRect(sx, sy, opts.segW, segH, radius);
    }
  }
}

export function ensureMissionPreviews(textures: Phaser.Textures.TextureManager): void {
  const width = 160;
  const height = 160;
  const missions = allMissions();
  for (let m = 0; m < missions.length; m++) {
    const mission = missions[m]!;
    const key = `menu_mission_preview_${mission.kind}`;
    if (textures.exists(key)) continue;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const g = canvas.getContext("2d", { willReadFrequently: true })!;
    const img = g.createImageData(width, height);
    const p = mission.profile;
    const seed = 8101 + m * 977;
    const field = makeShape(p.shape, seed);
    const looks = themeOf(p.theme).looks;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const nx = x / width;
        const ny = y / height;
        const h = baseHeight(nx, ny, seed, p, field, 0);
        // Slots: water 0, sand 2, grass 3, rock 5, peak 6.
        const l = looks[h < 0.34 ? 0 : h < 0.4 ? 2 : h > 0.72 ? 6 : h > 0.62 ? 5 : 3]!;
        const t = l === looks[3] ? h : l === looks[6] ? 0.6 : 0.3;
        const color = [lookColor(l, t, 0), lookColor(l, t, 1), lookColor(l, t, 2)];
        const shade = 0.76 + fbm(nx * 18, ny * 18, seed + 41, 2) * 0.38;
        const i = (y * width + x) * 4;
        img.data[i] = color[0] * shade;
        img.data[i + 1] = color[1] * shade;
        img.data[i + 2] = color[2] * shade;
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    const vignette = g.createLinearGradient(0, 0, 0, height);
    vignette.addColorStop(0, "rgba(0,0,0,0.08)");
    vignette.addColorStop(1, "rgba(0,0,0,0.58)");
    g.fillStyle = vignette;
    g.fillRect(0, 0, width, height);
    textures.addCanvas(key, canvas);
  }
}

export function createControlLegend(
  scene: Phaser.Scene,
  panelW: number,
  y: number,
  craft: CraftSpec = craftOf()
): Phaser.GameObjects.GameObject[] {
  const objects: Phaser.GameObjects.GameObject[] = [];
  const controlW = panelW / 9;
  const x0 = -panelW / 2;
  const controlX = (i: number) => x0 + i * controlW + controlW / 2;
  const orbit = craftControlScheme(craft) === "orbit";
  objects.push(
    scene.add.rectangle(0, y, panelW, 72, 0x0b0a08, 0.82).setStrokeStyle(1, 0x6f6244, 0.7)
  );
  const keycap = (x: number, py: number, label: string, keyW = 24, keyH = 20) => {
    const g = scene.add.graphics();
    g.fillStyle(0x18150f, 0.96).fillRoundedRect(x - keyW / 2, py - keyH / 2, keyW, keyH, 3);
    g.lineStyle(1.4, 0xe8b84a, 0.9).strokeRoundedRect(x - keyW / 2, py - keyH / 2, keyW, keyH, 3);
    objects.push(g);
    objects.push(
      scene.add
        .text(x, py, label, {
          fontFamily: "Share Tech Mono, monospace",
          fontSize: keyW > 36 ? "9px" : "11px",
          color: "#f2d579",
        })
        .setOrigin(0.5)
    );
  };
  const mouse = (x: number, py: number, leftLit: boolean, wheelLit = false) => {
    const g = scene.add.graphics();
    if (leftLit) g.fillStyle(0xe8b84a, 0.48).fillRoundedRect(x - 12, py - 17, 12, 15, 3);
    g.lineStyle(1.5, 0xe8b84a, 0.95).strokeRoundedRect(x - 12, py - 17, 24, 34, 9);
    g.lineBetween(x, py - 16, x, py - 3);
    g.lineBetween(x - 11, py - 2, x + 11, py - 2);
    g.fillStyle(wheelLit ? 0xf2d579 : 0x6f6244, 1).fillRoundedRect(x - 2, py - 12, 4, 8, 2);
    objects.push(g);
  };
  const label = (i: number, value: string) => {
    objects.push(
      scene.add
        .text(controlX(i), y + 25, value, {
          fontFamily: "Share Tech Mono, monospace",
          fontSize: "9px",
          color: "#d8d0ba",
        })
        .setOrigin(0.5)
    );
  };
  const iconY = y - 6;
  const moveX = controlX(0);
  keycap(moveX, iconY - 10, "W", 20, 18);
  keycap(moveX - 22, iconY + 10, "A", 20, 18);
  keycap(moveX, iconY + 10, "S", 20, 18);
  keycap(moveX + 22, iconY + 10, "D", 20, 18);
  label(0, orbit ? "W/S SPEED · A/D STEER" : "MOVE");
  mouse(controlX(1), iconY, true);
  label(1, "AIM / FIRE");
  keycap(controlX(2) - 29, iconY, "SPACE", 52, 22);
  keycap(controlX(2) + 31, iconY, "SHIFT", 50, 22);
  label(2, "POP-UP / NAP-OF-EARTH");
  const weaponX = controlX(3);
  for (let i = 0; i < 4; i++) keycap(weaponX - 42 + i * 20, iconY, String(i + 1), 16, 19);
  mouse(weaponX + 46, iconY, false, true);
  label(3, "SELECT WEAPON");
  keycap(controlX(4), iconY, "F", 30, 26);
  label(4, "COUNTERMEASURE");
  keycap(controlX(5), iconY, "E", 30, 26);
  // Time Warp crafts put their CM on E too — no separate bullet time.
  label(5, craft.countermeasure === "timewarp" ? "TIME WARP" : "BULLET TIME");
  keycap(controlX(6), iconY, "M", 30, 26);
  label(6, "MAP");
  keycap(controlX(7), iconY, "T", 30, 26);
  label(7, "THERMAL VISION");
  keycap(controlX(8), iconY, "H", 30, 26);
  label(8, "HELP / TIPS");
  return objects;
}

export function drawControlLegend(scene: Phaser.Scene, width: number, y: number, craft?: CraftSpec): void {
  const panelW = Math.min(1040, width - 64);
  scene.add.container(width / 2, 0, createControlLegend(scene, panelW, y, craft ?? craftOf()));
}
