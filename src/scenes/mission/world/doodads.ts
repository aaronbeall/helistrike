import Phaser from "phaser";
import { DOODAD_SPECS, FOLIAGE_TOP_MAX } from "../../../catalog/doodads";
import { bakeShadows } from "../../../art/sprites";
import { NAV_N } from "../../../sim/navGrid";
import { ZOff, worldDepth } from "../../../render/depth";
import { applyThermalHeat } from "../../../render/thermal";
import { cameraPointVisible, doodadTex, groundZ, SCALE, WORLD, worldToScreen, type Doodad, type ScreenPos, type WorldData } from "../../../worldgen/world";
import { VIEW_PAD } from "../camera/camera";
import type { MissionScene } from "../../missionScene";

/** Thermal: foliage is cover, not a heat source — a neutral tint, part see-through so units beneath show. */
const THERMAL_HEAT = 0.5;
const THERMAL_ALPHA = 0.45;
/** Blast-query grid cell (world units). */
const CELL = 128;
/** Death burst: fireball size, dirt count, scorch scale. */
const DEATH_BLAST = 22;
const DEATH_DIRT = 7;
const DEATH_SCORCH = 0.3;

/** Live (foliage object) vs printed into the terrain (decor kinds, undergrowth). */
export function doodadIsObject(d: Doodad): boolean {
  return !d.print && DOODAD_SPECS[d.kind].layer === "foliage";
}

/** Prints every non-object doodad into the terrain canvas (once, before terrain lighting). */
export function printDecor(world: WorldData, textures: Phaser.Textures.TextureManager): void {
  const g = world.canvas.getContext("2d", { willReadFrequently: true })!;
  g.imageSmoothingEnabled = true;
  for (const d of world.doodads) {
    if (doodadIsObject(d)) continue;
    const tex = doodadTex(d.kind);
    if (!textures.exists(tex)) continue;
    const img = textures.get(tex).getSourceImage() as CanvasImageSource;
    g.save();
    g.globalAlpha = 0.9;
    g.translate(d.x / SCALE, d.y / SCALE);
    g.rotate(d.rot * 0.15);
    g.drawImage(img, -d.size / 2, -d.size / 2, d.size, d.size);
    g.restore();
  }
  g.globalAlpha = 1;
}

interface LiveDoodad {
  x: number;
  y: number;
  /** Ground under it, and its drawn top (canopy) height. */
  z: number;
  top: number;
  /** World diameter. */
  size: number;
  rot: number;
  tex: string;
  hp: number;
  dead: boolean;
  /** Pooled sprite pair while on screen, else -1. */
  slot: number;
}

/** Foliage as live world objects: canopies at height (ground units hide under), see-through in thermal, cover routes prefer, destroyed by blasts. */
export class Doodads {
  private list: LiveDoodad[] = [];
  /** Static grid for blast queries: doodad indices per cell (CSR). */
  private cellStart = new Int32Array(0);
  private cellItems = new Int32Array(0);
  private cols = 0;
  private bodies: Phaser.GameObjects.Image[] = [];
  private shadows: Phaser.GameObjects.Image[] = [];
  private free: number[] = [];
  private scr: ScreenPos = { x: 0, y: 0, scale: 1 };

  constructor(readonly s: MissionScene) {}

  reset(): void {
    this.list = [];
    this.bodies = [];
    this.shadows = [];
    this.free = [];
  }

  /** After the world and nav grid: live foliage list, shadow bakes, blast grid, nav cover. */
  create(): void {
    const textures = this.s.textures;
    const world = this.s.world;
    for (const d of world.doodads) {
      if (!doodadIsObject(d)) continue;
      const tex = doodadTex(d.kind);
      if (!textures.exists(tex)) continue;
      if (!textures.exists(`${tex}_sh0`)) bakeShadows(textures, tex);
      const spec = DOODAD_SPECS[d.kind];
      const size = d.size * SCALE;
      const z = groundZ(world, d.x, d.y);
      const live: LiveDoodad = { x: d.x, y: d.y, z, top: z + Math.min(FOLIAGE_TOP_MAX, size * spec.height), size, rot: d.rot * 0.15, tex, hp: spec.health, dead: false, slot: -1 };
      this.list.push(live);
      this.cover(live, 1);
    }
    this.buildGrid();
  }

  /** Add / remove this doodad's cover on the nav cells under its canopy. */
  private cover(d: LiveDoodad, delta: number): void {
    const grid = this.s.nav.grid;
    const r = d.size * 0.5;
    const lo = grid.cellAt(d.x - r, d.y - r);
    const hi = grid.cellAt(d.x + r, d.y + r);
    for (let cy = (lo / NAV_N) | 0; cy <= ((hi / NAV_N) | 0); cy++) {
      for (let cx = lo % NAV_N; cx <= hi % NAV_N; cx++) grid.addCover(cy * NAV_N + cx, delta);
    }
  }

  private buildGrid(): void {
    const cols = (this.cols = Math.ceil(WORLD / CELL));
    const cellOf = (d: LiveDoodad) => Math.min(cols - 1, Math.max(0, Math.floor(d.y / CELL))) * cols + Math.min(cols - 1, Math.max(0, Math.floor(d.x / CELL)));
    const start = new Int32Array(cols * cols + 1);
    for (const d of this.list) start[cellOf(d) + 1]!++;
    for (let c = 0; c < cols * cols; c++) start[c + 1]! += start[c]!;
    const fill = start.slice();
    const items = new Int32Array(this.list.length);
    this.list.forEach((d, i) => (items[fill[cellOf(d)]!++] = i));
    this.cellStart = start;
    this.cellItems = items;
  }

  /** Per frame: place pooled sprites for on-screen foliage (canopy at its height, shadow cast once). */
  sync(): void {
    const hidden = this.s.camera.mapWorldHidden;
    const thermal = this.s.thermal.on;
    for (const d of this.list) {
      const on = !d.dead && !hidden && cameraPointVisible(d.top, d.y) && this.inView(d);
      if (!on) {
        if (d.slot >= 0) this.release(d);
        continue;
      }
      if (d.slot < 0) d.slot = this.claim();
      const body = this.bodies[d.slot]!;
      const sh = this.shadows[d.slot]!;
      const at = this.scr;
      if (body.texture.key !== d.tex) body.setTexture(d.tex);
      body
        .setVisible(true)
        .setPosition(at.x, at.y)
        .setRotation(d.rot)
        .setScale((d.size / body.width) * at.scale)
        .setAlpha(thermal ? THERMAL_ALPHA : 1);
      const depth = worldDepth(d.top, ZOff.body, d.y);
      if (body.depth !== depth) body.setDepth(depth);
      applyThermalHeat(body, thermal, THERMAL_HEAT);
      if (thermal) {
        if (sh.visible) sh.setVisible(false);
        continue;
      }
      sh.setVisible(true);
      // Static: the ground cast is cached on this pair until it's released.
      this.s.hostCraft.applyCastShadow(sh, d.x, d.y, d.top, d.tex, d.rot, d.size / body.width, Infinity, d);
    }
  }

  private inView(d: LiveDoodad): boolean {
    const at = worldToScreen(d.x, d.y, d.top, this.scr);
    return this.s.camera.projectedInView(at.x, at.y, VIEW_PAD);
  }

  private claim(): number {
    const free = this.free.pop();
    if (free != null) return free;
    const img = () => this.s.add.image(0, 0, "fx_shadow").setVisible(false);
    this.shadows.push(img());
    this.bodies.push(img());
    return this.bodies.length - 1;
  }

  private release(d: LiveDoodad): void {
    this.bodies[d.slot]!.setVisible(false);
    this.shadows[d.slot]!.setVisible(false).setData("shadowHit", undefined);
    this.free.push(d.slot);
    d.slot = -1;
  }

  /** Blast at (x, y): foliage within `r` of its edge takes `dmg`, falling off linearly to 0 at `r`. */
  blast(x: number, y: number, r: number, dmg: number): void {
    const cols = this.cols;
    if (!cols) return;
    const c0 = Math.max(0, Math.floor((x - r) / CELL));
    const c1 = Math.min(cols - 1, Math.floor((x + r) / CELL));
    const r0 = Math.max(0, Math.floor((y - r) / CELL));
    const r1 = Math.min(cols - 1, Math.floor((y + r) / CELL));
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const cell = row * cols + col;
        for (let k = this.cellStart[cell]!; k < this.cellStart[cell + 1]!; k++) {
          const d = this.list[this.cellItems[k]!]!;
          if (d.dead) continue;
          const dist = Math.max(0, Math.hypot(d.x - x, d.y - y) - d.size * 0.5);
          if (dist >= r) continue;
          d.hp -= dmg * (1 - dist / r);
          if (d.hp <= 0) this.destroy(d);
        }
      }
    }
  }

  /** A bit of dirt, a few sparks, a small scorch; its cover is gone. */
  private destroy(d: LiveDoodad): void {
    d.dead = true;
    if (d.slot >= 0) this.release(d);
    this.cover(d, -1);
    this.s.fx.heFireBurst(d.x, d.y, d.z + 2, 0, 0, 1, DEATH_BLAST, true, 0.6, 0.18, 0.5);
    this.s.fx.spawnDirtParticles(d.x, d.y, d.z + 2, { n: DEATH_DIRT, spdMin: 40, spdMax: 140, bx: 0, by: 0, bz: 180, tight: 0.5, scaleMul: 0.7 });
    this.s.groundMarks.stampBlastCrater(d.x, d.y, DEATH_SCORCH);
  }
}
