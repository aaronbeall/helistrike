import type Phaser from "phaser";
import { worldDepth } from "../../../render/depth";
import { applyThermalHeat } from "../../../render/thermal";
import { range } from "../../../util/rng";
import { themeOf, underwaterTint } from "../../../worldgen/theme";
import { cameraPointVisible, groundZ, worldToScreen } from "../../../worldgen/world";
import type { MissionScene } from "../../missionScene";

const MAX_BUBBLES = 160;
/** Draw scale range for the 64px texture (most bubbles small). */
const SIZE_MIN = 0.03;
const SIZE_MAX = 0.155;
/** Size bias toward small: size01 = random ^ this. */
const SMALL_BIAS = 3.4;
/** Width / height wobble amplitude; frequency (Hz) rises as bubbles get smaller. */
const WOBBLE = 0.2;
const WOBBLE_HZ = 0.9;
const WOBBLE_HZ_SMALL = 0.3;
/** Rise speed (z / s) = base + size × gain: big bubbles rise a little faster. */
const RISE = 6;
const RISE_GAIN = 16;

type Bubble = { x: number; y: number; z: number; size: number; phase: number; hz: number; vz: number; drift: number };

/** Underwater bubbles: rise from where they're released, wobble width/height (faster when small), pop at the surface with a ripple. */
export class Bubbles {
  private live: Bubble[] = [];
  private free: Bubble[] = [];
  private g!: Phaser.GameObjects.Group;

  constructor(readonly s: MissionScene) {}

  reset(): void {
    this.free.push(...this.live);
    this.live = [];
  }

  create(): void {
    this.g = this.s.add.group();
  }

  /** Release a bubble at (x, y, z) under the water; size 0..1 picks within the range (default random, mostly small). */
  spawn(x: number, y: number, z: number, size01 = Math.pow(Math.random(), SMALL_BIAS)): void {
    if (this.live.length >= MAX_BUBBLES || z >= groundZ(this.s.world, x, y)) return;
    const size = SIZE_MIN + (SIZE_MAX - SIZE_MIN) * size01;
    const rel = 0.08 + 0.54 * size01;
    const b = this.free.pop() ?? { x: 0, y: 0, z: 0, size: 0, phase: 0, hz: 0, vz: 0, drift: 0 };
    b.x = x;
    b.y = y;
    b.z = z;
    b.size = size;
    b.phase = Math.random() * Math.PI * 2;
    b.hz = WOBBLE_HZ + WOBBLE_HZ_SMALL / rel;
    b.vz = RISE + rel * RISE_GAIN;
    b.drift = range(-6, 6);
    this.live.push(b);
  }

  update(dt: number): void {
    const w = this.s.world;
    let n = 0;
    for (const b of this.live) {
      b.z += b.vz * dt;
      b.phase += b.hz * Math.PI * 2 * dt;
      b.x += Math.sin(b.phase * 0.37) * b.drift * dt;
      const top = groundZ(w, b.x, b.y);
      if (b.z >= top) {
        // Breaks the surface: a little ring on the ripple layer.
        const rel = (b.size - SIZE_MIN) / (SIZE_MAX - SIZE_MIN);
        this.s.ripples.spawn(b.x, b.y, 6 + rel * 11, 0.25 + rel * 0.3, 0.7);
        this.free.push(b);
        continue;
      }
      this.live[n++] = b;
    }
    this.live.length = n;
    this.draw();
  }

  private draw(): void {
    while (this.g.getLength() < this.live.length) this.g.add(this.s.add.image(0, 0, "fx_bubble").setVisible(false));
    const kids = this.g.getChildren() as Phaser.GameObjects.Image[];
    const theme = themeOf(this.s.world.theme);
    const w = this.s.world;
    for (let i = 0; i < kids.length; i++) {
      const im = kids[i]!;
      const b = this.live[i];
      if (!b || !cameraPointVisible(b.z, b.y)) {
        im.setVisible(false);
        continue;
      }
      const at = worldToScreen(b.x, b.y, b.z);
      // Alternating squash: wide while short, tall while narrow.
      const wob = Math.sin(b.phase) * WOBBLE;
      im.setVisible(true)
        .setPosition(at.x, at.y)
        .setScale(b.size * (1 + wob) * at.scale, b.size * (1 - wob) * at.scale)
        .setDepth(worldDepth(b.z, 0.25, b.y))
        .setAlpha(0.9);
      applyThermalHeat(im, this.s.thermal.on, 0.12, underwaterTint(theme, groundZ(w, b.x, b.y) - b.z));
    }
  }
}
