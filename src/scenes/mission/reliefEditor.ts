import Phaser from "phaser";
import { camoForBiome, resolveSkin } from "../../render/camo";
import { Layer } from "../../render/depth";
import { HEIGHT_BRUSHES, bakeHeightBrushes } from "../../worldgen/brushes";
import { groundZ, worldToScreen, projectHeading, paintHeightMapRect, stampHeightBrush, rebuildWorldPatch, paintRoadsRect, sampleBiome, SCALE, doodadTex } from "../../worldgen/world";
import type { MissionScene } from "../missionScene";

/** Debug terrain relief editor (B): brush painting onto the height map + decor. */
export class ReliefEditor {
  open = false;
  brush = 0;
  size = 110;
  rot = 0;
  offX = 0;
  offY = 0;
  spd = 0;
  str = 0.2;
  invert = false;
  px = 0;
  py = 0;
  acc = 0;
  uiBlock = false;
  wasPaint = false;
  dirty: { x0: number; y0: number; x1: number; y1: number } | null = null;
  root!: Phaser.GameObjects.Container;
  readout!: Phaser.GameObjects.Text;
  inkBtn!: Phaser.GameObjects.Text;
  chips: Phaser.GameObjects.Image[] = [];
  chipFrames: Phaser.GameObjects.Graphics[] = [];
  gfx!: Phaser.GameObjects.Graphics;

  constructor(readonly s: MissionScene) {}

  /** Per-mission state reset (called from the scene's init). */
  reset(): void {
    this.open = false;
    this.invert = false;
    this.dirty = null;
  }

  toggle(force?: boolean): void {
    const want = force ?? !this.open;
    if (want && this.s.help.open) return;
    if (!want && !this.root) return;
    if (want && !this.root) {
      this.setup();
      const markHudTree = (obj: Phaser.GameObjects.GameObject) => {
        this.s.bindHud(obj);
        const list = (obj as Phaser.GameObjects.Container).list;
        if (list) for (const ch of list) markHudTree(ch);
      };
      markHudTree(this.root);
    }
    this.open = want;
    this.root.setVisible(this.open);
    this.gfx.setVisible(this.open);
    this.s.input.setDefaultCursor(this.open ? "crosshair" : "none");
    if (this.open) {
      const p = this.s.worldPointer();
      this.px = p.x;
      this.py = p.y;
      this.syncHud();
    } else {
      this.gfx.clear();
      this.dirty = null;
    }
    this.s.debugMenu.sync();
  }

  setBrush(i: number): void {
    this.brush = Phaser.Math.Clamp(i, 0, HEIGHT_BRUSHES.length - 1);
    this.syncHud();
  }

  nudgeSize(dir: number): void {
    this.size = Phaser.Math.Clamp(this.size * (dir > 0 ? 1.12 : 0.89), 28, 480);
    this.syncHud();
  }

  nudgeRot(dir: number): void {
    this.rot += dir * 0.14;
    this.syncHud();
  }

  nudgeOff(dx: number, dy: number): void {
    this.offX = Phaser.Math.Clamp(this.offX + dx * 0.06, -0.45, 0.45);
    this.offY = Phaser.Math.Clamp(this.offY + dy * 0.06, -0.45, 0.45);
    this.syncHud();
  }

  setup(): void {
    for (const b of bakeHeightBrushes()) {
      const key = `brush_${b.id}`;
      if (this.s.textures.exists(key)) this.s.textures.remove(key);
      if (b.canvas) this.s.textures.addCanvas(key, b.canvas);
    }
    this.gfx = this.s.add.graphics().setDepth(Layer.FIELD + 20);
    this.gfx.setVisible(false);
    const w = 268;
    const hgt = 212;
    const x = this.s.scale.width - w - 18;
    const y = this.s.scale.height - hgt - 18;
    this.root = this.s.add.container(x, y);
    this.root.setDepth(Layer.HUD + 190);
    this.root.setScrollFactor(0);
    const panel = this.s.add.graphics();
    panel.fillStyle(0x12100c, 0.94);
    panel.fillRect(0, 0, w, hgt);
    panel.lineStyle(1.5, 0xe8b84a, 0.9);
    panel.strokeRect(0.5, 0.5, w - 1, hgt - 1);
    panel.fillStyle(0xe8b84a, 1);
    panel.fillRect(0, 0, 4, hgt);
    const title = this.s.add.text(16, 8, "RELIEF KIT   E", {
      fontFamily: "Share Tech Mono, monospace",
      fontSize: "13px",
      color: "#e8b84a",
    });
    this.chips = [];
    this.chipFrames = [];
    HEIGHT_BRUSHES.forEach((b, i) => {
      const cx = 22 + i * 80;
      const img = this.s.add.image(cx + 28, 58, `brush_${b.id}`).setDisplaySize(52, 52);
      img.setInteractive({ useHandCursor: true });
      img.on("pointerover", () => {
        this.uiBlock = true;
      });
      img.on("pointerout", () => {
        this.uiBlock = false;
      });
      img.on("pointerdown", () => this.setBrush(i));
      const frame = this.s.add.graphics();
      const lab = this.s.add.text(cx + 28, 90, b.name, {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "10px",
        color: "#8a8470",
      }).setOrigin(0.5, 0);
      this.chips.push(img);
      this.chipFrames.push(frame);
      this.root.add([frame, img, lab]);
    });
    this.readout = this.s.add.text(16, 112, "", {
      fontFamily: "Share Tech Mono, monospace",
      fontSize: "11px",
      color: "#c8c0a8",
      lineSpacing: 3,
    });
    this.inkBtn = this.s.add
      .text(16, 176, "", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "12px",
        color: "#e8b84a",
      })
      .setInteractive({ useHandCursor: true });
    this.inkBtn.on("pointerover", () => {
      this.uiBlock = true;
    });
    this.inkBtn.on("pointerout", () => {
      this.uiBlock = false;
    });
    this.inkBtn.on("pointerdown", () => this.toggleInvert());
    const hit = this.s.add.zone(0, 0, w, hgt).setOrigin(0, 0).setInteractive();
    hit.on("pointerover", () => {
      this.uiBlock = true;
    });
    hit.on("pointerout", () => {
      this.uiBlock = false;
    });
    this.root.add([panel, hit, title, this.readout, this.inkBtn]);
    this.root.sendToBack(panel);
    this.root.sendToBack(hit);
    this.root.bringToTop(this.readout);
    this.root.bringToTop(this.inkBtn);
    this.root.setVisible(false);
    this.syncHud();
  }

  toggleInvert(): void {
    this.invert = !this.invert;
    this.syncHud();
  }

  syncHud(): void {
    if (!this.readout) return;
    const deg = Math.round((((this.rot % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) * (180 / Math.PI));
    const ink = this.invert ? "BLACK" : "WHITE";
    this.readout.setText(
      `SIZE ${this.size | 0}m  [ ] WHEEL\nROT  ${deg}°     Q R\nOFF  ${this.offX.toFixed(2)} ${this.offY.toFixed(2)}  , . ; '\nLMB STAMP  ·  RMB FLIP  ·  SPD ${this.str.toFixed(2)}`
    );
    if (this.inkBtn) {
      this.inkBtn.setText(`I  INK  ${ink}`);
      this.inkBtn.setColor(this.invert ? "#8a9aaa" : "#e8b84a");
    }
    for (let i = 0; i < this.chipFrames.length; i++) {
      const g = this.chipFrames[i]!;
      const img = this.chips[i]!;
      g.clear();
      const on = i === this.brush;
      if (this.invert) {
        g.fillStyle(0xc4b898, 1);
        g.fillRect(img.x - 28, img.y - 28, 56, 56);
        img.setTint(0x1c1812);
      } else {
        img.clearTint();
      }
      g.lineStyle(on ? 2 : 1, on ? 0xe8b84a : 0x3a3428, 1);
      g.strokeRect(img.x - 28, img.y - 28, 56, 56);
    }
  }

  tick(dt: number): void {
    if (!this.open) {
      this.gfx.clear();
      return;
    }
    const p = this.s.worldPointer();
    const dist = Math.hypot(p.x - this.px, p.y - this.py);
    const inst = dt > 1e-4 ? dist / dt : 0;
    this.spd = Phaser.Math.Linear(this.spd, inst, 1 - Math.pow(0.12, dt));
    const targetStr = 0.07 + Phaser.Math.Clamp(this.spd / 480, 0, 1) * 0.38;
    this.str = Phaser.Math.Linear(this.str, targetStr, 1 - Math.pow(0.16, dt));
    const ptr = this.s.input.activePointer;
    const invert = this.invert !== (ptr.rightButtonDown() && !ptr.leftButtonDown());
    const paint = (ptr.leftButtonDown() || ptr.rightButtonDown()) && !this.uiBlock && !this.s.debugMenu.open;
    const just = paint && !this.wasPaint;
    this.wasPaint = paint;
    if (paint) {
      const spacing = Math.max(8, this.size * 0.2);
      const stamps: { x: number; y: number }[] = [];
      if (just) {
        this.acc = 0;
        stamps.push({ x: p.x, y: p.y });
      } else {
        this.acc += dist;
        while (this.acc >= spacing) {
          this.acc -= spacing;
          const t = spacing / Math.max(dist, 1e-4);
          stamps.push({
            x: Phaser.Math.Linear(p.x, this.px, t),
            y: Phaser.Math.Linear(p.y, this.py, t),
          });
        }
      }
      const brush = HEIGHT_BRUSHES[this.brush]!;
      for (const s of stamps) {
        const box = stampHeightBrush(
          this.s.world.height,
          brush.mask,
          brush.w,
          brush.h,
          s.x,
          s.y,
          this.size,
          this.rot,
          this.offX,
          this.offY,
          invert,
          this.str
        );
        this.unionDirty(box);
      }
    } else {
      this.acc = 0;
    }
    this.px = p.x;
    this.py = p.y;
    if (this.dirty) this.flushDirty();
    this.syncHud();
    this.drawCursor(p.x, p.y, invert);
  }

  unionDirty(box: { x0: number; y0: number; x1: number; y1: number }): void {
    if (!this.dirty) this.dirty = { ...box };
    else {
      this.dirty.x0 = Math.min(this.dirty.x0, box.x0);
      this.dirty.y0 = Math.min(this.dirty.y0, box.y0);
      this.dirty.x1 = Math.max(this.dirty.x1, box.x1);
      this.dirty.y1 = Math.max(this.dirty.y1, box.y1);
    }
  }

  flushDirty(): void {
    const d = this.dirty;
    if (!d) return;
    this.dirty = null;
    rebuildWorldPatch(this.s.world, d.x0, d.y0, d.x1, d.y1, this.s.biomeTiles, (g, x0, y0, x1, y1) => {
      paintRoadsRect(this.s.world, g, x0, y0, x1, y1);
      this.stampDecorRect(g, x0, y0, x1, y1);
    });
    paintHeightMapRect(this.s.heightMapCanvas, this.s.world.height, d.x0, d.y0, d.x1, d.y1, this.s.world.roads);
    (this.s.textures.get("map_terrain") as Phaser.Textures.CanvasTexture).refresh();
    (this.s.textures.get("map_height") as Phaser.Textures.CanvasTexture).refresh();
    this.s.terrain25d?.updateHeightRegion(d.x0, d.y0, d.x1, d.y1);
  }

  stampDecorRect(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
    const wx0 = x0 * SCALE;
    const wy0 = y0 * SCALE;
    const wx1 = (x1 + 1) * SCALE;
    const wy1 = (y1 + 1) * SCALE;
    g.imageSmoothingEnabled = true;
    for (const dec of this.s.world.decor) {
      const pad = dec.size * SCALE * 0.5;
      if (dec.x < wx0 - pad || dec.x > wx1 + pad || dec.y < wy0 - pad || dec.y > wy1 + pad) continue;
      const skin = resolveSkin(this.s.textures, doodadTex(dec.kind), camoForBiome(sampleBiome(this.s.world, dec.x, dec.y)));
      if (!this.s.textures.exists(skin)) continue;
      const img = this.s.textures.get(skin).getSourceImage() as CanvasImageSource;
      const s = dec.size;
      g.save();
      g.globalAlpha = 0.9;
      g.translate(dec.x / SCALE, dec.y / SCALE);
      g.rotate(dec.rot * 0.15);
      g.drawImage(img, -s / 2, -s / 2, s, s);
      g.restore();
    }
    g.globalAlpha = 1;
  }

  drawCursor(x: number, y: number, invert: boolean): void {
    const g = this.gfx;
    g.clear();
    const col = invert ? 0x6a9cb8 : 0xe8b84a;
    g.lineStyle(1.5, col, 0.95);
    const z = groundZ(this.s.world, x, y);
    const at = worldToScreen(x, y, z);
    g.save();
    g.translateCanvas(at.x, at.y);
    g.rotateCanvas(projectHeading(this.rot, x, y, z));
    const s = this.size * at.scale;
    const ox = this.offX * s;
    const oy = this.offY * s;
    g.strokeRect(-s / 2 + ox, -s / 2 + oy, s, s);
    g.lineBetween(-6, 0, 6, 0);
    g.lineBetween(0, -6, 0, 6);
    g.restore();
  }
}
