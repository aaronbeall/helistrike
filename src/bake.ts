/**
 * Procedural chrome (no sheet) + generic missing-art fallback for any absent texture.
 * Unit/building art comes from PNG sheets via prepareArt — not from here.
 */
import type Phaser from "phaser";
import { PLAYER_WPNS, type PlayerWpnSpec } from "./combat";
import { allCraftKinds, craftGunTexture, craftOf } from "./craft";
import { bakeToonBlast } from "./toonBlast";
import { allKinds, gunsOf, specOf, type UnitKind } from "./roster";
import { bakeShadows, bakeThermalHeatFromAlpha, bakeThermalHeatFromDarkness } from "./sprites";

type Ctx = CanvasRenderingContext2D;

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function ctxOf(c: HTMLCanvasElement): Ctx {
  const g = c.getContext("2d");
  if (!g) throw new Error("2d");
  g.imageSmoothingEnabled = true;
  return g;
}

function roundRect(
  g: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

function add(textures: Phaser.Textures.TextureManager, key: string, c: HTMLCanvasElement): void {
  if (textures.exists(key)) textures.remove(key);
  textures.addCanvas(key, c);
}

/** Magenta-key placeholder so missing sheet art is obvious in-game / rigs. */
export function drawMissingArt(label = "?", size = 64): HTMLCanvasElement {
  const c = canvas(size, size);
  const g = ctxOf(c);
  g.fillStyle = "#fa02f5";
  g.fillRect(0, 0, size, size);
  g.fillStyle = "#1a1018";
  g.fillRect(4, 4, size - 8, size - 8);
  g.strokeStyle = "#e8b84a";
  g.lineWidth = 2;
  g.strokeRect(6, 6, size - 12, size - 12);
  g.fillStyle = "#e8b84a";
  g.font = `bold ${Math.max(9, (size / 8) | 0)}px monospace`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  const text = label.length > 14 ? `${label.slice(0, 12)}…` : label;
  g.fillText("MISSING", size / 2, size / 2 - size * 0.12);
  g.font = `${Math.max(8, (size / 10) | 0)}px monospace`;
  g.fillStyle = "#c8c0b0";
  g.fillText(text, size / 2, size / 2 + size * 0.14);
  return c;
}

/** Add placeholder only when the key is absent. */
export function ensureTexture(
  textures: Phaser.Textures.TextureManager,
  key: string,
  size = 64
): void {
  if (!key || textures.exists(key)) return;
  add(textures, key, drawMissingArt(key, size));
}

function drawShadow(): HTMLCanvasElement {
  const c = canvas(64, 64);
  const g = ctxOf(c);
  const grd = g.createRadialGradient(32, 32, 4, 32, 32, 30);
  grd.addColorStop(0, "rgba(12,10,6,0.55)");
  grd.addColorStop(1, "rgba(12,10,6,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return c;
}

function drawTrack(kind: "tread" | "tire" | "dual" | "wide" | "mono" = "tread"): HTMLCanvasElement {
  const c = canvas(32, 22);
  const g = ctxOf(c);
  const dirt = (a: number) => `rgba(32,26,16,${a})`;
  if (kind === "tread") {
    g.fillStyle = dirt(0.5);
    for (let y = 2; y < 20; y += 4) {
      g.fillRect(2, y, 10, 2.2);
      g.fillRect(20, y, 10, 2.2);
    }
    return c;
  }
  if (kind === "tire") {
    g.fillStyle = dirt(0.42);
    g.fillRect(5, 3, 3.2, 16);
    g.fillRect(24, 3, 3.2, 16);
    g.fillStyle = dirt(0.22);
    for (let y = 4; y < 18; y += 5) {
      g.fillRect(5, y, 3.2, 1.1);
      g.fillRect(24, y, 3.2, 1.1);
    }
    return c;
  }
  if (kind === "mono") {
    g.fillStyle = dirt(0.48);
    g.fillRect(14, 2, 4.2, 18);
    g.fillStyle = dirt(0.24);
    for (let y = 4; y < 19; y += 5) g.fillRect(14, y, 4.2, 1.15);
    return c;
  }
  if (kind === "dual") {
    g.fillStyle = dirt(0.44);
    g.fillRect(2, 3, 3, 16);
    g.fillRect(6.5, 3, 3, 16);
    g.fillRect(22.5, 3, 3, 16);
    g.fillRect(27, 3, 3, 16);
    return c;
  }
  g.fillStyle = dirt(0.46);
  g.fillRect(3, 2, 8, 18);
  g.fillRect(21, 2, 8, 18);
  g.fillStyle = dirt(0.2);
  for (let y = 4; y < 19; y += 6) {
    g.fillRect(3, y, 8, 1.2);
    g.fillRect(21, y, 8, 1.2);
  }
  return c;
}

function drawFlame(): HTMLCanvasElement {
  const c = canvas(22, 22);
  const g = ctxOf(c);
  const blob = (x: number, y: number, r: number, inner: string, mid: string, outer: string) => {
    const grd = g.createRadialGradient(x, y, r * 0.08, x, y, r);
    grd.addColorStop(0, inner);
    grd.addColorStop(0.45, mid);
    grd.addColorStop(1, outer);
    g.fillStyle = grd;
    g.beginPath();
    g.ellipse(x, y, r * 1.05, r * 0.92, -0.25, 0, Math.PI * 2);
    g.fill();
  };
  blob(11, 12, 10, "rgba(255,80,10,0.9)", "rgba(255,50,0,0.55)", "rgba(180,0,0,0)");
  blob(10.2, 10.4, 7.2, "rgba(255,170,40,1)", "rgba(255,90,12,0.85)", "rgba(255,40,0,0)");
  blob(10.5, 10, 3.4, "rgba(255,252,230,1)", "rgba(255,220,90,0.9)", "rgba(255,140,20,0)");
  return c;
}

function drawBlast(variant: number): HTMLCanvasElement {
  const c = canvas(80, 80);
  const g = ctxOf(c);
  g.translate(40, 40);
  g.rotate(variant * 0.9);
  const outer = g.createRadialGradient(0, 0, 6, 0, 0, 38);
  outer.addColorStop(0, "rgba(22,16,10,0.72)");
  outer.addColorStop(0.35, "rgba(48,32,18,0.5)");
  outer.addColorStop(0.7, "rgba(90,62,32,0.22)");
  outer.addColorStop(1, "rgba(60,44,24,0)");
  g.fillStyle = outer;
  g.beginPath();
  g.ellipse(2, -1, 36 - variant * 2, 30 + variant, 0.2 * variant, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "rgba(10,8,6,0.7)";
  g.beginPath();
  g.ellipse(-2, 1, 12 + variant, 10, 0.4, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "rgba(18,14,10,0.55)";
  const n = 5 + variant;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + variant;
    const r = 10 + ((i * 13 + variant * 7) % 11);
    g.beginPath();
    g.ellipse(Math.cos(a) * r, Math.sin(a) * r, 7 + (i % 3), 4 + (i % 2), a, 0, Math.PI * 2);
    g.fill();
  }
  g.globalCompositeOperation = "destination-out";
  g.fillStyle = "rgba(0,0,0,0.35)";
  for (let i = 0; i < 3; i++) {
    const a = variant * 1.7 + i * 2.1;
    g.beginPath();
    g.ellipse(Math.cos(a) * 16, Math.sin(a) * 14, 4 + i, 3, a, 0, Math.PI * 2);
    g.fill();
  }
  g.globalCompositeOperation = "source-over";
  g.strokeStyle = "rgba(28,22,14,0.35)";
  g.lineWidth = 1.2;
  g.beginPath();
  g.ellipse(0, 0, 18 + variant * 2, 14, 0.3, 0.2, Math.PI * 1.6);
  g.stroke();
  return c;
}

function drawShellCasing(variant: number): HTMLCanvasElement {
  const w = 14;
  const h = 6;
  const c = canvas(w, h);
  const g = ctxOf(c);
  const cy = h / 2;
  const palettes = [
    { brass: [208, 162, 86], dark: [110, 78, 36], rim: [242, 214, 140] }, // bright
    { brass: [196, 148, 72], dark: [92, 64, 28], rim: [232, 198, 120] },
    { brass: [168, 124, 58], dark: [78, 54, 24], rim: [210, 172, 98] },
    { brass: [138, 98, 48], dark: [62, 42, 20], rim: [178, 138, 78] }, // dark
    { brass: [112, 78, 38], dark: [48, 32, 16], rim: [148, 110, 62] }, // darker
  ];
  const pal = palettes[variant % palettes.length]!;
  const { brass, dark, rim } = pal;
  const rgb = (ch: number[], a = 1) => `rgba(${ch[0]},${ch[1]},${ch[2]},${a})`;

  // Body
  g.fillStyle = rgb(brass);
  roundRect(g, 1.5, 1.1, 10.5, h - 2.2, 1.2);
  g.fill();
  // Highlight strip (dimmer on darker variants)
  const hiA = variant >= 3 ? 0.28 : variant >= 2 ? 0.4 : 0.55;
  g.fillStyle = rgb(rim, hiA);
  roundRect(g, 2.2, 1.4, 8.5, 1.2, 0.6);
  g.fill();
  // Primer / base rim (left)
  g.fillStyle = rgb(dark);
  g.beginPath();
  g.ellipse(2.2, cy, 1.35, h * 0.38, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = rgb(rim, variant >= 3 ? 0.4 : 0.7);
  g.beginPath();
  g.ellipse(2.2, cy, 0.55, h * 0.18, 0, 0, Math.PI * 2);
  g.fill();
  // Mouth (right)
  g.fillStyle = rgb(dark, 0.85);
  g.beginPath();
  g.ellipse(12.2, cy, 0.95, h * 0.32, 0, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = rgb(brass, 0.9);
  g.lineWidth = 0.6;
  g.beginPath();
  g.ellipse(12.2, cy, 0.95, h * 0.32, 0, 0, Math.PI * 2);
  g.stroke();
  return c;
}

type TracerRgb = [number, number, number];

function drawTracerShape(opts: {
  w: number;
  h: number;
  core: TracerRgb;
  mid: TracerRgb;
  rim: TracerRgb;
  /** 0 = soft tear tracer, 1 = blunt slug. */
  blunt?: number;
  glow?: number;
  twin?: boolean;
}): HTMLCanvasElement {
  const { w, h, core, mid, rim } = opts;
  const blunt = opts.blunt ?? 0;
  const glow = opts.glow ?? 0.55;
  const c = canvas(w, h);
  const g = ctxOf(c);
  const cy = h / 2;
  const headX = w * (0.76 + blunt * 0.06);
  const headR = h * (0.26 + blunt * 0.08);
  const tailX = w * 0.05;
  const rgb = (ch: TracerRgb, a: number) => `rgba(${ch[0]},${ch[1]},${ch[2]},${a})`;

  const tear = (scaleX: number, scaleY: number) => {
    const hx = headX;
    const hr = headR * scaleY;
    g.beginPath();
    g.moveTo(tailX + (1 - scaleX) * (hx - tailX) * 0.15, cy);
    g.bezierCurveTo(
      w * 0.3,
      cy - h * 0.1 * scaleY,
      hx - hr * 1.35,
      cy - hr,
      hx,
      cy - hr
    );
    if (blunt > 0.55) {
      g.lineTo(hx + hr * (0.55 + blunt * 0.35), cy - hr * 0.35);
      g.lineTo(hx + hr * (0.55 + blunt * 0.35), cy + hr * 0.35);
      g.lineTo(hx, cy + hr);
    } else {
      g.quadraticCurveTo(hx + hr * 1.2 * scaleX, cy, hx, cy + hr);
    }
    g.bezierCurveTo(
      hx - hr * 1.35,
      cy + hr,
      w * 0.3,
      cy + h * 0.1 * scaleY,
      tailX + (1 - scaleX) * (hx - tailX) * 0.15,
      cy
    );
    g.closePath();
  };

  const paint = () => {
    const along = g.createLinearGradient(tailX, cy, headX + headR, cy);
    along.addColorStop(0, rgb(rim, 0));
    along.addColorStop(0.22, rgb(rim, 0.22));
    along.addColorStop(0.55, rgb(mid, 0.85));
    along.addColorStop(0.82, rgb(core, 1));
    along.addColorStop(1, rgb(core, 0.15));

    g.save();
    tear(1.06, 1.12);
    g.fillStyle = rgb(rim, 0.28);
    g.fill();
    g.restore();

    tear(1, 1);
    g.fillStyle = along;
    g.fill();

    const coreGrad = g.createRadialGradient(headX, cy, 0, headX, cy, headR * 1.15);
    coreGrad.addColorStop(0, rgb(core, 1));
    coreGrad.addColorStop(0.45, rgb(mid, 0.7));
    coreGrad.addColorStop(1, rgb(rim, 0));
    g.beginPath();
    g.arc(headX, cy, headR * 1.05, 0, Math.PI * 2);
    g.fillStyle = coreGrad;
    g.fill();

    g.fillStyle = rgb([255, 255, 255], glow);
    g.beginPath();
    g.ellipse(headX + headR * 0.12, cy - headR * 0.12, headR * 0.28, headR * 0.18, -0.4, 0, Math.PI * 2);
    g.fill();
  };

  if (opts.twin) {
    g.save();
    g.translate(0, -h * 0.18);
    paint();
    g.restore();
    g.save();
    g.translate(0, h * 0.18);
    paint();
    g.restore();
  } else {
    paint();
  }
  return c;
}

/** Stable hue/shape seed from weapon id (unique cannon looks without authored PNGs). */
function hashHue(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 360;
}

function cannonTracerOpts(spec: PlayerWpnSpec): Parameters<typeof drawTracerShape>[0] {
  if (spec.tracer) return spec.tracer;
  const hue = hashHue(spec.id);
  const rgbAt = (h: number, s: number, l: number): TracerRgb => {
    const a = (h / 360) * 6;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((a % 2) - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (a < 1) [r, g, b] = [c, x, 0];
    else if (a < 2) [r, g, b] = [x, c, 0];
    else if (a < 3) [r, g, b] = [0, c, x];
    else if (a < 4) [r, g, b] = [0, x, c];
    else if (a < 5) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
  };
  return {
    w: 48 + (hashHue(spec.id + "w") % 40),
    h: 7 + (hashHue(spec.id + "h") % 7),
    core: rgbAt(hue, 0.35, 0.92),
    mid: rgbAt(hue, 0.75, 0.55),
    rim: rgbAt((hue + 30) % 360, 0.85, 0.4),
    blunt: (hashHue(spec.id + "b") % 100) / 140,
    glow: 0.35 + (hashHue(spec.id + "g") % 40) / 100,
  };
}

/**
 * Unique procedural cannon/beam tracers for each `shot_wpn_*` cannon look.
 * Rockets/missiles use sheet/image-gen PNGs when present.
 */
export function bakePlayerCannonLooks(textures: Phaser.Textures.TextureManager): void {
  for (const spec of Object.values(PLAYER_WPNS)) {
    if (spec.kind !== "cannon") continue;
    const key = String(spec.look);
    if (textures.exists(key)) continue;
    add(textures, key, drawTracerShape(cannonTracerOpts(spec)));
    bakeShadows(textures, key);
  }
}

/** Enemy bullet tracers — replace legacy mini-rocket / AAM placeholder looks. */
export function bakeEnemyCannonLooks(textures: Phaser.Textures.TextureManager): void {
  const presets: { key: string; opts: Parameters<typeof drawTracerShape>[0] }[] = [
    {
      key: "shot_cannon_enemy_mg",
      opts: {
        w: 42, h: 6,
        core: [255, 236, 180], mid: [255, 170, 55], rim: [200, 90, 25],
        glow: 0.4,
      },
    },
    {
      key: "shot_cannon_enemy_aa",
      opts: {
        // Long thin streak — AA used to read as AAM placeholders; keep that feel as a tracer.
        w: 110, h: 6,
        core: [255, 252, 230], mid: [255, 210, 80], rim: [255, 130, 35],
        blunt: 0, glow: 0.72,
      },
    },
    {
      key: "shot_cannon_enemy_he",
      opts: {
        w: 52, h: 10,
        core: [255, 245, 210], mid: [255, 160, 50], rim: [180, 70, 20],
        blunt: 0.7, glow: 0.35,
      },
    },
  ];
  for (const p of presets) {
    if (textures.exists(p.key)) textures.remove(p.key);
    add(textures, p.key, drawTracerShape(p.opts));
    bakeShadows(textures, p.key);
  }
}

function drawRocket(): HTMLCanvasElement {
  const c = canvas(18, 8);
  const g = ctxOf(c);
  g.fillStyle = "#3a3c38";
  roundRect(g, 2, 2, 12, 4, 1);
  g.fill();
  g.fillStyle = "#c45c28";
  g.beginPath();
  g.moveTo(14, 1);
  g.lineTo(18, 4);
  g.lineTo(14, 7);
  g.closePath();
  g.fill();
  return c;
}

function drawDebris(color: string): HTMLCanvasElement {
  const c = canvas(16, 16);
  const g = ctxOf(c);
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(3, 10);
  g.lineTo(6, 2);
  g.lineTo(13, 5);
  g.lineTo(14, 12);
  g.lineTo(7, 15);
  g.closePath();
  g.fill();
  return c;
}

function drawSpark(): HTMLCanvasElement {
  const c = canvas(12, 12);
  const g = ctxOf(c);
  const grd = g.createRadialGradient(6, 6, 0, 6, 6, 6);
  grd.addColorStop(0, "#fff6c8");
  grd.addColorStop(0.4, "#ff9a32");
  grd.addColorStop(1, "rgba(255,80,0,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 12, 12);
  return c;
}

function drawSmoke(): HTMLCanvasElement {
  const c = canvas(32, 32);
  const g = ctxOf(c);
  const grd = g.createRadialGradient(16, 16, 2, 16, 16, 15);
  grd.addColorStop(0, "rgba(80,70,55,0.55)");
  grd.addColorStop(1, "rgba(40,36,28,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 32, 32);
  return c;
}

function drawMuzzle(): HTMLCanvasElement {
  const c = canvas(16, 10);
  const g = ctxOf(c);
  const grd = g.createRadialGradient(5, 5, 0, 8, 5, 8);
  grd.addColorStop(0, "#fff8d0");
  grd.addColorStop(0.5, "#ffb040");
  grd.addColorStop(1, "rgba(255,80,0,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 16, 10);
  return c;
}

function drawReticle(): HTMLCanvasElement {
  const c = canvas(96, 96);
  const g = ctxOf(c);
  const cx = 48;
  const cy = 48;
  g.strokeStyle = "#e8b84a";
  g.lineWidth = 2;
  g.lineCap = "butt";
  g.beginPath();
  g.arc(cx, cy, 34, 0, Math.PI * 2);
  g.stroke();
  g.beginPath();
  g.moveTo(cx, 6);
  g.lineTo(cx, 26);
  g.moveTo(cx, 70);
  g.lineTo(cx, 90);
  g.moveTo(6, cy);
  g.lineTo(26, cy);
  g.moveTo(70, cy);
  g.lineTo(90, cy);
  g.stroke();
  return c;
}

function drawReticleSquare(): HTMLCanvasElement {
  const c = canvas(96, 96);
  const g = ctxOf(c);
  const cx = 48;
  const cy = 48;
  const half = 30;
  g.strokeStyle = "#e8b84a";
  g.lineWidth = 2;
  g.lineCap = "butt";
  g.strokeRect(cx - half, cy - half, half * 2, half * 2);
  g.beginPath();
  g.moveTo(cx, 6);
  g.lineTo(cx, 26);
  g.moveTo(cx, 70);
  g.lineTo(cx, 90);
  g.moveTo(6, cy);
  g.lineTo(26, cy);
  g.moveTo(70, cy);
  g.lineTo(90, cy);
  g.stroke();
  return c;
}

function drawLock(): HTMLCanvasElement {
  const c = canvas(72, 72);
  const g = ctxOf(c);
  g.strokeStyle = "#ff3a22";
  g.lineWidth = 3.2;
  g.lineCap = "square";
  const s = 16;
  g.beginPath();
  g.moveTo(s, 8);
  g.lineTo(8, 8);
  g.lineTo(8, s);
  g.moveTo(64 - s, 8);
  g.lineTo(64, 8);
  g.lineTo(64, s);
  g.moveTo(s, 64);
  g.lineTo(8, 64);
  g.lineTo(8, 64 - s);
  g.moveTo(64 - s, 64);
  g.lineTo(64, 64);
  g.lineTo(64, 64 - s);
  g.stroke();
  g.strokeStyle = "#ffd0c0";
  g.lineWidth = 1.4;
  g.strokeRect(18, 18, 36, 36);
  return c;
}

/**
 * Intentional procedural chrome (no PNG sheet). Runs before prepareArt.
 * Sheet art may overwrite rockets / FX / blasts when present.
 */
export function bakeAll(textures: Phaser.Textures.TextureManager): void {
  add(textures, "shadow", drawShadow());
  for (let i = 0; i < 5; i++) {
    const key = i === 0 ? "fx_shell" : `fx_shell_${i}`;
    const shell = drawShellCasing(i);
    add(textures, key, shell);
    // Opaque brass → heat alpha so settle marks can fade smoothly in thermal.
    add(textures, `${key}_heat`, bakeThermalHeatFromAlpha(shell));
  }
  // Fallback if shots/ PNG fails to load — prepareArt overwrites from library.
  add(textures, "shot_rocket", drawRocket());
  add(textures, "fx_debris_metal", drawDebris("#6a7064"));
  add(textures, "fx_spark", drawSpark());
  add(textures, "fx_smoke", drawSmoke());
  add(textures, "fx_muzzle", drawMuzzle());
  add(textures, "reticle", drawReticle());
  add(textures, "reticle_sq", drawReticleSquare());
  add(textures, "lock", drawLock());
  add(textures, "track", drawTrack("tread"));
  add(textures, "track_tread", drawTrack("tread"));
  add(textures, "track_tire", drawTrack("tire"));
  add(textures, "track_dual", drawTrack("dual"));
  add(textures, "track_wide", drawTrack("wide"));
  add(textures, "track_mono", drawTrack("mono"));
  add(textures, "fx_flame", drawFlame());
  for (let i = 0; i < 4; i++) {
    const blast = drawBlast(i);
    add(textures, `fx_blast_${i}`, blast);
    add(textures, `fx_blast_${i}_heat`, bakeThermalHeatFromDarkness(blast));
  }
  bakeToonBlast(textures);
}

function collectArtKeys(): string[] {
  const keys = new Set<string>();
  const addKey = (k?: string) => {
    if (k) keys.add(k);
  };
  for (const kind of allKinds()) {
    const sp = specOf(kind);
    addKey(sp.texture);
    addKey(sp.hulk);
    for (const g of gunsOf({ kind } as { kind: UnitKind })) {
      addKey(g.tex);
      addKey(g.hulk);
    }
    for (const r of sp.rotors) {
      addKey(r.tex);
      addKey(r.hulk);
    }
    if (sp.dish) {
      addKey(sp.dish.tex);
      addKey(sp.dish.hulk);
    }
  }
  for (const kind of allCraftKinds()) {
    const c = craftOf(kind);
    addKey(c.body);
    addKey(c.hulk);
    addKey(craftGunTexture(c));
    addKey(c.rotor);
  }
  for (const k of [
    "enemy_heli_rotor",
    "enemy_heli_rotor_spin",
    "enemy_drone_rotor",
    "shot_rocket",
    "fx_muzzle",
    "fx_spark",
    "fx_smoke",
    "fx_flame",
    "fx_blast_0",
    "fx_debris_metal",
    "hulk_crater",
  ]) {
    keys.add(k);
  }
  for (const spec of Object.values(PLAYER_WPNS)) {
    if (spec.kind === "cannon") keys.add(String(spec.look));
    if (spec.mount) keys.add(spec.mount);
  }
  return [...keys];
}

/**
 * After prepareArt: fill any still-missing roster/combat textures with a
 * generic placeholder, then bake drop shadows for those fills.
 */
export function bakeRosterArt(textures: Phaser.Textures.TextureManager): void {
  bakePlayerCannonLooks(textures);
  bakeEnemyCannonLooks(textures);
  for (const key of collectArtKeys()) {
    if (textures.exists(key)) continue;
    const size = /battleship|fob|bunker|radar/.test(key) ? 128 : 64;
    ensureTexture(textures, key, size);
    bakeShadows(textures, key);
  }
}
