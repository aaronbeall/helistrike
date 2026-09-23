import Phaser from "phaser";
import {
  artGens,
  formatArtGenValue,
  nudgeArtGenParam,
  randomizeArtGen,
  resetArtGen,
  type ArtGenDef,
} from "../art/artGen";
import { RIG_INFO, RIG_VALUE, drawRigSpritePreviewGuides, makeRigText, syncRigSystemCursor } from "./rigUi";
import { nameGameTexture } from "../art/sprites";

const DEPTH = 9450;
const MONO = "Share Tech Mono, monospace";
const GOLD = "#e8b84a";
const LIST_X = 16;
const LIST_Y = 40;
const LIST_W = 340;
const LINE_H = 16;

type Focus = "gens" | "params";

/**
 * General-purpose art generation rig: catalog of procedural gens + shared
 * param harness (nudge / randomize / reseed / bake / preview).
 */
export class ArtGenRig {
  open = false;
  private built = false;
  private scene: Phaser.Scene;
  private genIdx = 0;
  private paramIdx = 0;
  private focus: Focus = "gens";
  private seed = 0xb1a57e;
  private animT = 0;
  private playSpeed = 1;
  private viewZoom = 2;
  private paused = false;
  private dirtyLayout = true;
  private prepared: unknown;
  private tmp = document.createElement("canvas");
  private gTmp = this.tmp.getContext("2d", { willReadFrequently: true })!;
  private previewKey = "rig_artgen_live";

  root: Phaser.GameObjects.Container;
  private dim!: Phaser.GameObjects.Rectangle;
  private board!: Phaser.GameObjects.Graphics;
  private overlay!: Phaser.GameObjects.Graphics;
  private preview!: Phaser.GameObjects.Image;
  private listTxt!: Phaser.GameObjects.Text;
  private hintTxt!: Phaser.GameObjects.Text;
  private infoTxt!: Phaser.GameObjects.Text;
  private descTxt!: Phaser.GameObjects.Text;
  private uiCam!: Phaser.Cameras.Scene2D.Camera;
  private shiftKey?: Phaser.Input.Keyboard.Key;
  private onBuilt?: (root: Phaser.GameObjects.Container) => void;

  constructor(scene: Phaser.Scene, onBuilt?: (root: Phaser.GameObjects.Container) => void) {
    this.scene = scene;
    this.onBuilt = onBuilt;
    this.root = scene.add.container(0, 0).setDepth(DEPTH).setScrollFactor(0).setVisible(false);
    scene.cameras.main.ignore(this.root);
  }

  private gens(): readonly ArtGenDef[] {
    return artGens();
  }

  private gen(): ArtGenDef {
    const list = this.gens();
    return list[Phaser.Math.Clamp(this.genIdx, 0, list.length - 1)]!;
  }

  private paramKeys(def: ArtGenDef): string[] {
    return Object.keys(def.meta);
  }

  private ensureBuilt(): void {
    if (this.built) return;
    this.built = true;
    const scene = this.scene;
    const w = scene.scale.width;
    const h = scene.scale.height;
    this.dim = scene.add
      .rectangle(0, 0, w, h, 0x0c0a08, 0.72)
      .setOrigin(0)
      .setScrollFactor(0)
      .setDepth(DEPTH)
      .setVisible(false);
    this.board = scene.add.graphics().setScrollFactor(0).setDepth(DEPTH + 1).setVisible(false);
    this.preview = scene.add
      .image(0, 0, "__DEFAULT")
      .setName("rig_artgen_preview")
      .setScrollFactor(0)
      .setDepth(DEPTH + 2)
      .setVisible(false);
    this.overlay = scene.add.graphics().setScrollFactor(0).setDepth(DEPTH + 3).setVisible(false);
    this.listTxt = makeRigText(scene, DEPTH + 4, { fontSize: "13px", lineSpacing: 3, color: RIG_VALUE });
    this.listTxt.setPosition(LIST_X, LIST_Y);
    this.infoTxt = makeRigText(scene, DEPTH + 4, {
      fontSize: "12px",
      lineSpacing: 4,
      color: RIG_INFO,
      wrapW: 360,
    });
    this.descTxt = makeRigText(scene, DEPTH + 4, {
      fontSize: "13px",
      lineSpacing: 4,
      color: GOLD,
      wrapW: 420,
    });
    this.hintTxt = scene.add
      .text(18, 14, "", { fontFamily: MONO, fontSize: "12px", color: GOLD })
      .setScrollFactor(0)
      .setDepth(DEPTH + 4)
      .setVisible(false);
    nameGameTexture(scene, this.listTxt, "rig_artgen_list");
    nameGameTexture(scene, this.infoTxt, "rig_artgen_info");
    nameGameTexture(scene, this.descTxt, "rig_artgen_desc");
    nameGameTexture(scene, this.hintTxt, "rig_artgen_hint");
    this.root.add([
      this.dim,
      this.board,
      this.preview,
      this.overlay,
      this.listTxt,
      this.infoTxt,
      this.descTxt,
      this.hintTxt,
    ]);

    this.uiCam = scene.cameras.add(0, 0, w, h, false, "artGenRig");
    this.uiCam.setScroll(0, 0);
    this.uiCam.transparent = true;
    this.uiCam.setVisible(false);
    for (const child of scene.children.list) {
      if (child !== this.root) this.uiCam.ignore(child);
    }
    scene.events.on("addedtoscene", (go: Phaser.GameObjects.GameObject) => {
      if (go !== this.root) this.uiCam.ignore(go);
    });

    const kb = scene.input.keyboard;
    if (kb) {
      kb.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT).on("down", () => {
        if (!this.open) return;
        if (this.focus === "params") this.nudge(-1);
        else this.focus = "params";
      });
      kb.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT).on("down", () => {
        if (!this.open) return;
        if (this.focus === "params") this.nudge(1);
        else this.focus = "params";
      });
      kb.addKey(Phaser.Input.Keyboard.KeyCodes.TAB).on("down", (e: KeyboardEvent) => {
        if (!this.open) return;
        e.preventDefault?.();
        this.focus = this.focus === "gens" ? "params" : "gens";
      });
      kb.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER).on("down", () => {
        if (!this.open) return;
        this.focus = "params";
      });
      kb.addKey(Phaser.Input.Keyboard.KeyCodes.BACKSPACE).on("down", () => {
        if (!this.open) return;
        this.focus = "gens";
      });
      this.shiftKey = kb.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
      kb.addKey(Phaser.Input.Keyboard.KeyCodes.R).on("down", () => {
        if (!this.open) return;
        this.seed = (Math.random() * 0xffffffff) >>> 0;
        this.dirtyLayout = true;
        this.animT = 0;
      });
      kb.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE).on("down", () => {
        if (!this.open) return;
        this.animT = 0;
      });
      kb.addKey(Phaser.Input.Keyboard.KeyCodes.P).on("down", () => {
        if (this.open) this.paused = !this.paused;
      });
      kb.addKey(Phaser.Input.Keyboard.KeyCodes.B).on("down", () => {
        if (!this.open) return;
        const def = this.gen();
        def.bake({ textures: scene.textures, anims: scene.anims });
        def.ensureAnims?.(scene.anims, scene.textures, true);
      });
      kb.addKey(Phaser.Input.Keyboard.KeyCodes.D).on("down", () => {
        if (!this.open) return;
        resetArtGen(this.gen());
        this.dirtyLayout = true;
        this.animT = 0;
      });
      kb.addKey(Phaser.Input.Keyboard.KeyCodes.G).on("down", () => {
        if (!this.open) return;
        randomizeArtGen(this.gen());
        this.dirtyLayout = true;
        this.animT = 0;
      });
      kb.addKey(Phaser.Input.Keyboard.KeyCodes.COMMA).on("down", () => {
        if (this.open) this.playSpeed = Math.max(0.25, this.playSpeed / 1.25);
      });
      kb.addKey(Phaser.Input.Keyboard.KeyCodes.PERIOD).on("down", () => {
        if (this.open) this.playSpeed = Math.min(4, this.playSpeed * 1.25);
      });
    }

    scene.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      if (!this.open || !p.leftButtonDown()) return;
      if (p.x >= LIST_X && p.x < LIST_X + LIST_W) this.pickFromList(p.y);
    });

    this.onBuilt?.(this.root);
  }

  toggle(): void {
    this.ensureBuilt();
    this.open = !this.open;
    this.root.setVisible(this.open);
    this.dim.setVisible(this.open);
    this.board.setVisible(this.open);
    this.preview.setVisible(this.open);
    this.overlay.setVisible(this.open);
    this.listTxt.setVisible(this.open);
    this.infoTxt.setVisible(this.open);
    this.descTxt.setVisible(this.open);
    this.hintTxt.setVisible(this.open);
    syncRigSystemCursor(this.scene);
    this.uiCam.setVisible(this.open);
    if (this.open) {
      const zoom = this.gen().defaultZoom;
      if (zoom != null) this.viewZoom = zoom;
      this.dirtyLayout = true;
      this.animT = 0;
    }
  }

  cycle(dir: number): void {
    if (!this.open) return;
    if (this.focus === "gens") {
      const n = this.gens().length;
      if (!n) return;
      this.genIdx = (this.genIdx + dir + n) % n;
      this.paramIdx = 0;
      const zoom = this.gen().defaultZoom;
      if (zoom != null) this.viewZoom = zoom;
      this.dirtyLayout = true;
      this.animT = 0;
      return;
    }
    const keys = this.paramKeys(this.gen());
    if (!keys.length) return;
    this.paramIdx = (this.paramIdx + dir + keys.length) % keys.length;
  }

  nudgeZoom(dir: number): void {
    if (!this.open) return;
    const steps = [0.5, 1, 1.5, 2, 3, 4, 6, 8, 12, 16];
    let i = 0;
    let best = Infinity;
    for (let k = 0; k < steps.length; k++) {
      const d = Math.abs(steps[k]! - this.viewZoom);
      if (d < best) {
        best = d;
        i = k;
      }
    }
    this.viewZoom = steps[Phaser.Math.Clamp(i + dir, 0, steps.length - 1)]!;
  }

  private nudge(dir: number): void {
    const def = this.gen();
    const keys = this.paramKeys(def);
    const key = keys[this.paramIdx];
    if (!key) return;
    const fast = this.shiftKey?.isDown ?? false;
    nudgeArtGenParam(def, key, dir, fast);
    this.dirtyLayout = true;
  }

  private pickFromList(py: number): void {
    const size = this.pageSize();
    const row = Math.floor((py - LIST_Y) / LINE_H) - 1;
    if (row < 0 || row >= size) return;
    if (this.focus === "gens") {
      const i = this.pageOf(this.genIdx) * size + row;
      if (i < 0 || i >= this.gens().length) return;
      this.genIdx = i;
      this.paramIdx = 0;
      const zoom = this.gen().defaultZoom;
      if (zoom != null) this.viewZoom = zoom;
      this.dirtyLayout = true;
      this.animT = 0;
      return;
    }
    const keys = this.paramKeys(this.gen());
    const i = this.pageOf(this.paramIdx) * size + row;
    if (i < 0 || i >= keys.length) return;
    this.paramIdx = i;
  }

  private pageSize(): number {
    return Math.max(8, Math.floor((this.scene.scale.height - LIST_Y - 28) / LINE_H) - 1);
  }

  private pageOf(idx: number): number {
    return Math.floor(idx / this.pageSize());
  }

  update(dt: number): void {
    if (!this.open) return;
    this.ensureBuilt();
    const def = this.gen();
    if (this.dirtyLayout) {
      this.prepared = def.prepare?.(this.seed, def.params, this.scene.textures);
      this.dirtyLayout = false;
    }
    if (def.animated && !this.paused) {
      const loop = def.loopSec ?? 1;
      this.animT += dt * this.playSpeed * (1 / loop);
      if (this.animT > 1) this.animT = 0;
    }
    const t = def.animated ? Math.max(0, Math.min(1, this.animT)) : 0;
    this.paint(def, t);

    const size = this.pageSize();
    if (this.focus === "gens") {
      const list = this.gens();
      const pages = Math.max(1, Math.ceil(list.length / size));
      const page = this.pageOf(this.genIdx);
      const start = page * size;
      const slice = list.slice(start, start + size);
      this.listTxt.setText(
        [
          `— ART GENS  ${page + 1}/${pages}  (${list.length}) —`,
          ...slice.map((g, i) => {
            const mark = start + i === this.genIdx ? "▸" : " ";
            const tag = g.animated ? "ANI" : "STK";
            return `${mark} ${g.label.padEnd(14)} ${tag}`;
          }),
        ].join("\n")
      );
      this.descTxt.setText(`${def.label}\n${def.blurb}`);
    } else {
      const keys = this.paramKeys(def);
      const pages = Math.max(1, Math.ceil(keys.length / size));
      const page = this.pageOf(this.paramIdx);
      const start = page * size;
      const slice = keys.slice(start, start + size);
      this.listTxt.setText(
        [
          `— ${def.label} PARAMS  ${page + 1}/${pages}  seed ${this.seed.toString(16)} —`,
          ...slice.map((key, i) => {
            const mark = start + i === this.paramIdx ? "▸" : " ";
            const v = formatArtGenValue(def, key);
            const defV = def.defaults[key];
            const cur = def.params[key];
            const tag = cur !== defV ? "*" : " ";
            return `${mark}${tag}${key.padEnd(18)}${v}`;
          }),
        ].join("\n")
      );
      const key = keys[this.paramIdx];
      const meta = key ? def.meta[key] : undefined;
      this.descTxt.setText(key && meta ? `${key}\n${meta.desc}` : def.blurb);
    }

    this.hintTxt.setText(
      `ART GEN RIG   Tab/Enter params · Backspace gens   ↑ ↓ select   ← → nudge (Shift×)   G randomize   R reseed   Space replay   P pause   , . speed ${this.playSpeed.toFixed(2)}×   - + zoom ${this.viewZoom}×   B bake   D defaults`
    );
    this.infoTxt.setPosition(LIST_X + LIST_W + 24, LIST_Y);
    this.infoTxt.setText(
      [
        `${def.label}  ·  ${def.animated ? `t ${t.toFixed(2)}  ${this.paused ? "PAUSED" : "PLAY"}` : "static"}`,
        def.blurb,
        "",
        "Live preview uses current params.",
        "B rebakes this generator into the texture cache.",
        "G randomizes within listed min–max hints.",
        "← → nudge is unbounded unless marked clamp.",
      ].join("\n")
    );
    const listRight = LIST_X + LIST_W + 20;
    const h = this.scene.scale.height;
    this.descTxt.setPosition(
      listRight,
      Math.min(h - 72, this.preview.y + this.preview.displayHeight * 0.5 + 24)
    );
  }

  private paint(def: ArtGenDef, t: number): void {
    // Toon (and similar) expect a sized scratch canvas.
    if (def.params.size != null) {
      const sizeHint = Math.max(32, Math.round(Number(def.params.size) || 192));
      if (this.tmp.width !== sizeHint || this.tmp.height !== sizeHint) {
        this.tmp.width = sizeHint;
        this.tmp.height = sizeHint;
      }
    }
    const frame = def.render(t, this.seed, def.params, this.tmp, this.gTmp, this.prepared);
    const tex = this.scene.textures;
    if (tex.exists(this.previewKey)) tex.remove(this.previewKey);
    tex.addCanvas(this.previewKey, frame);
    this.preview.setTexture(this.previewKey);
    this.preview.setOrigin(0.5, 0.5);

    const h = this.scene.scale.height;
    const listRight = LIST_X + LIST_W + 20;
    const pad = 10;
    this.preview.setScale(this.viewZoom);
    const bw = this.preview.displayWidth;
    const bh = this.preview.displayHeight;
    const cx = listRight + pad + bw * 0.5;
    const cy = Math.min(h * 0.45, h - pad - bh * 0.5);
    this.preview.setPosition(cx, cy);

    const bx = cx - bw * 0.5;
    const by = cy - bh * 0.5;
    this.board.clear();
    this.board.fillStyle(def.animated ? 0x6a6a6a : 0x2a2418, 1);
    this.board.fillRect(bx - 10, by - 10, bw + 20, bh + 20);
    this.board.lineStyle(1, 0xe8b84a, 0.55);
    this.board.strokeRect(bx - 10, by - 10, bw + 20, bh + 20);
    this.overlay.clear();
    const hover = this.hoverUvOn(this.preview);
    drawRigSpritePreviewGuides(this.overlay, this.preview, {
      hoverUv: hover,
    });
    syncRigSystemCursor(this.scene, hover ? "crosshair" : "default");
  }

  private hoverUvOn(spr: Phaser.GameObjects.Image): { x: number; y: number } | null {
    if (!spr.visible || !spr.width || !spr.height) return null;
    const lp = spr.getLocalPoint(
      this.scene.input.activePointer.x,
      this.scene.input.activePointer.y,
      undefined,
      this.uiCam
    );
    if (lp.x < -0.5 || lp.y < -0.5 || lp.x > spr.width + 0.5 || lp.y > spr.height + 0.5) {
      return null;
    }
    return { x: lp.x / spr.width, y: lp.y / spr.height };
  }
}
