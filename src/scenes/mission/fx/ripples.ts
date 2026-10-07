import Phaser from "phaser";
import { Camera25D, groundZ, isWater, WORLD } from "../../../worldgen/world";
import { specOf } from "../../../sim/roster";
import type { MissionScene } from "../../missionScene";

/** Ripple buffer: RIPPLE_TEX² texels over a RIPPLE_SPAN² world window that follows the camera. */
export const RIPPLE_TEX = 1024;
const RIPPLE_SPAN = 2500;
const CREST_KEY = "fx_ripple_crests";
const DASH_KEY = "fx_wake_dash";
const CREST_PX = 64;
const DASH_W = 32;
const DASH_H = 12;
const MAX_RIPPLES = 640;
/** Wake: a segment dropped this often (s) above this speed (world units / s). */
const WAKE_EVERY = 0.22;
const WAKE_MIN_SPEED = 6;
/** Land units wading shallows splash this often (s) above this speed. */
const WADE_EVERY = 0.18;
const WADE_MIN_SPEED = 5;
const WAKE_LIFE = 3.2;
/** Kelvin-like wake arm half-angle: arms spread sideways at tan(angle) × boat speed. */
const WAKE_ARM = 0.34;

type Ripple =
  | { kind: "crest"; x: number; y: number; t: number; life: number; r0: number; r1: number; strength: number }
  | { kind: "wake"; x: number; y: number; t: number; life: number; heading: number; spread: number; len: number; strength: number };

/**
 * Water ripples: splash crest rings and boat V-wakes, stamped each frame into a world-space buffer that the
 * terrain shader reads (masked to water).
 */
export class Ripples {
  layer!: Phaser.GameObjects.RenderTexture;
  private crest!: Phaser.GameObjects.Image;
  private dash!: Phaser.GameObjects.Image;
  private live: Ripple[] = [];
  /** Buffer currently holds stamps (needs a clear before it's empty again). */
  private drawn = false;
  /** Buffer-space box of last frame's stamps — the only area that needs clearing. */
  private dirty = { x0: 0, y0: 0, x1: 0, y1: 0 };
  /** World-space origin of the buffer window. */
  private ox = 0;
  private oy = 0;
  private wakeT = new WeakMap<object, number>();

  constructor(readonly s: MissionScene) {}

  reset(): void {
    this.live = [];
    this.drawn = false;
    this.wakeT = new WeakMap();
  }

  create(): void {
    ensureCrestTexture(this.s.textures);
    ensureDashTexture(this.s.textures);
    this.layer = this.s.add.renderTexture(0, 0, RIPPLE_TEX, RIPPLE_TEX).setOrigin(0, 0).setVisible(false);
    (this.layer.texture as Phaser.Textures.DynamicTexture).setIsSpriteTexture(false);
    this.crest = this.s.make.image({ key: CREST_KEY, add: false }).setOrigin(0.5, 0.5);
    this.dash = this.s.make.image({ key: DASH_KEY, add: false }).setOrigin(0.5, 0.5);
  }

  private push(r: Ripple): void {
    if (this.live.length >= MAX_RIPPLES) this.live.shift();
    this.live.push(r);
  }

  /** One expanding wave train (three crests). `size` ≈ final outer radius (world units). */
  spawn(x: number, y: number, size: number, strength = 1, life = 1.8): void {
    if (!isWater(this.s.world, x, y)) return;
    this.push({ kind: "crest", x, y, t: 0, life, r0: size * 0.2, r1: size, strength });
  }

  /** Splash: a wave train sized to the impact. */
  splash(x: number, y: number, size: number, strength = 1): void {
    this.spawn(x, y, size, strength, 2.1);
  }

  /** Ground unit / remote moving through shallows: periodic splash spray + ripple (+ V wake for vehicles). */
  private wade(u: { x: number; y: number; vx: number; vy: number }, r: number, vehicle: boolean, dt: number): void {
    const spd = Math.hypot(u.vx, u.vy);
    if (spd < WADE_MIN_SPEED || !isWater(this.s.world, u.x, u.y)) return;
    const t = (this.wakeT.get(u) ?? 0) + dt;
    if (t < WADE_EVERY) {
      this.wakeT.set(u, t);
      return;
    }
    this.wakeT.set(u, 0);
    this.spawn(u.x, u.y, r * 1.8, 0.6, 1.2);
    // Vehicles also leave a boat-style V wake (troops just splash).
    if (vehicle) {
      const sx = u.x - (u.vx / spd) * r * 0.8;
      const sy = u.y - (u.vy / spd) * r * 0.8;
      if (isWater(this.s.world, sx, sy)) {
        this.push({
          kind: "wake",
          x: sx,
          y: sy,
          t: 0,
          life: WAKE_LIFE * 0.75,
          heading: Math.atan2(u.vy, u.vx),
          spread: spd * Math.tan(WAKE_ARM),
          len: r * 0.9,
          strength: Math.min(0.85, 0.35 + spd / 100),
        });
      }
    }
    this.s.fx.emitVisualBurst(
      u.x,
      u.y,
      groundZ(this.s.world, u.x, u.y) + 2,
      {
        n: Math.max(2, Math.round(r / 6)),
        spdMin: 30,
        spdMax: 90 + spd,
        bx: u.vx,
        by: u.vy,
        bz: 160,
        tight: 0.35,
        scaleMul: 0.4 + r / 60,
        gravity: 220,
      },
      this.s.fx.splashBurst
    );
  }

  update(dt: number): void {
    for (const u of this.s.units) {
      if (u.dead) continue;
      const sp = specOf(u.kind);
      if (!sp.water) {
        this.wade(u, sp.radius, !sp.organic && !sp.aerial, dt);
        continue;
      }
      const spd = Math.hypot(u.vx, u.vy);
      if (spd < WAKE_MIN_SPEED) continue;
      const t = (this.wakeT.get(u) ?? 0) + dt;
      if (t < WAKE_EVERY) {
        this.wakeT.set(u, t);
        continue;
      }
      this.wakeT.set(u, 0);
      const r = specOf(u.kind).radius;
      const sx = u.x - (u.vx / spd) * r * 0.8;
      const sy = u.y - (u.vy / spd) * r * 0.8;
      if (!isWater(this.s.world, sx, sy)) continue;
      this.push({
        kind: "wake",
        x: sx,
        y: sy,
        t: 0,
        life: WAKE_LIFE,
        heading: Math.atan2(u.vy, u.vx),
        spread: spd * Math.tan(WAKE_ARM),
        len: r * 0.9,
        strength: Math.min(1, 0.45 + spd / 90),
      });
    }
    for (const r of this.s.remotes) {
      if (r.spec.ground && !r.airborne && !r.dock) this.wade(r, r.spec.radius, true, dt);
    }
    const k = RIPPLE_TEX / RIPPLE_SPAN;
    // Idle: nothing to draw and the buffer is already empty — skip the clear and the shader reads.
    if (!this.live.length) {
      if (this.drawn) {
        this.clearDirty();
        this.drawn = false;
        this.s.terrain25d?.setRippleTexture(null);
      }
      return;
    }
    // Window follows the camera, snapped to whole texels so stamps don't shimmer as it moves.
    const texel = RIPPLE_SPAN / RIPPLE_TEX;
    this.ox = Math.floor((Camera25D.focusX - RIPPLE_SPAN / 2) / texel) * texel;
    this.oy = Math.floor((Camera25D.focusY - RIPPLE_SPAN / 2) / texel) * texel;
    this.s.terrain25d?.setRippleTexture(this.layer, this.ox / WORLD, this.oy / WORLD, RIPPLE_SPAN / WORLD);
    this.clearDirty();
    this.drawn = true;
    const d = this.dirty;
    d.x0 = RIPPLE_TEX;
    d.y0 = RIPPLE_TEX;
    d.x1 = 0;
    d.y1 = 0;
    const box = (bx: number, by: number, r: number): boolean => {
      if (bx + r < 0 || by + r < 0 || bx - r > RIPPLE_TEX || by - r > RIPPLE_TEX) return false;
      d.x0 = Math.min(d.x0, bx - r);
      d.y0 = Math.min(d.y0, by - r);
      d.x1 = Math.max(d.x1, bx + r);
      d.y1 = Math.max(d.y1, by + r);
      return true;
    };
    this.layer.beginDraw();
    let w = 0;
    for (const p of this.live) {
      p.t += dt;
      if (p.t >= p.life) continue;
      this.live[w++] = p;
      const u = p.t / p.life;
      const fade = p.kind === "wake" ? Math.pow(1 - u, 1.3) : (1 - u) * (1 - u);
      if (p.kind === "crest") {
        const radius = p.r0 + (p.r1 - p.r0) * (1 - (1 - u) * (1 - u));
        const bx = (p.x - this.ox) * k;
        const by = (p.y - this.oy) * k;
        if (!box(bx, by, radius * k + 2)) continue;
        this.crest.setScale((radius * 2 * k) / CREST_PX).setAlpha(p.strength * fade);
        this.layer.batchDraw(this.crest, bx, by);
        continue;
      }
      // Wake segment: two slanted dashes drifting apart sideways (the V's arms), lengthening as they age.
      const off = p.len * 0.4 + p.spread * p.t;
      const len = p.len * (1 + u * 1.6);
      const cx = Math.cos(p.heading);
      const cy = Math.sin(p.heading);
      for (const side of [-1, 1]) {
        const ax = (p.x - cy * off * side - this.ox) * k;
        const ay = (p.y + cx * off * side - this.oy) * k;
        if (!box(ax, ay, len * 0.5 * k + 2)) continue;
        this.dash
          // Feather crests ~55° to the track, outer end trailing (Kelvin diverging waves).
          .setRotation(p.heading - side * (Math.PI / 2 - 0.55))
          .setScale((len * k) / DASH_W, Math.max(1.2, len * 0.1 * k) / DASH_H)
          .setAlpha(p.strength * fade);
        this.layer.batchDraw(this.dash, ax, ay);
      }
    }
    this.live.length = w;
    this.layer.endDraw();
  }

  /** Clear only the area stamped last frame (clamped to the buffer). */
  private clearDirty(): void {
    const d = this.dirty;
    const x0 = Math.max(0, Math.floor(d.x0));
    const y0 = Math.max(0, Math.floor(d.y0));
    const x1 = Math.min(RIPPLE_TEX, Math.ceil(d.x1));
    const y1 = Math.min(RIPPLE_TEX, Math.ceil(d.y1));
    // gl.scissor counts rows from the bottom, but draw coords are top-down (the stored image is flipped).
    if (x1 > x0 && y1 > y0) (this.layer.texture as Phaser.Textures.DynamicTexture).clear(x0, RIPPLE_TEX - y1, x1 - x0, y1 - y0);
  }
}

/** Three soft concentric crests, strongest on the outside (a spreading wave train). */
function ensureCrestTexture(textures: Phaser.Textures.TextureManager): void {
  if (textures.exists(CREST_KEY)) return;
  const n = CREST_PX;
  const c = document.createElement("canvas");
  c.width = n;
  c.height = n;
  const g = c.getContext("2d")!;
  const img = g.createImageData(n, n);
  const h = n / 2;
  const crests: [number, number][] = [
    [0.9, 1],
    [0.7, 0.55],
    [0.5, 0.28],
  ];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const d = Math.hypot(x + 0.5 - h, y + 0.5 - h) / h;
      let a = 0;
      for (const [at, amp] of crests) a = Math.max(a, amp * Math.max(0, 1 - Math.abs(d - at) / 0.075));
      const o = (y * n + x) * 4;
      img.data[o] = 255;
      img.data[o + 1] = 255;
      img.data[o + 2] = 255;
      img.data[o + 3] = Math.round(255 * a * a * (3 - 2 * a));
    }
  }
  g.putImageData(img, 0, 0);
  textures.addCanvas(CREST_KEY, c);
}

/** Soft streak, tapered at both ends — one crest of a wake arm. */
function ensureDashTexture(textures: Phaser.Textures.TextureManager): void {
  if (textures.exists(DASH_KEY)) return;
  const c = document.createElement("canvas");
  c.width = DASH_W;
  c.height = DASH_H;
  const g = c.getContext("2d")!;
  const img = g.createImageData(DASH_W, DASH_H);
  for (let y = 0; y < DASH_H; y++) {
    for (let x = 0; x < DASH_W; x++) {
      const u = (x + 0.5) / DASH_W;
      const v = ((y + 0.5) / DASH_H) * 2 - 1;
      const along = Math.sin(Math.PI * u);
      const across = Math.exp(-v * v * 4);
      const o = (y * DASH_W + x) * 4;
      img.data[o] = 255;
      img.data[o + 1] = 255;
      img.data[o + 2] = 255;
      img.data[o + 3] = Math.round(255 * along * across);
    }
  }
  g.putImageData(img, 0, 0);
  textures.addCanvas(DASH_KEY, c);
}
