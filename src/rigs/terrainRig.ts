import Phaser from "phaser";
import { baseHeight, makeShape, MAP_SHAPES, type MapShape, type ShapeField } from "../worldgen/shape";
import { applyDunes, applyLandforms, LANDFORM_KINDS, NO_LANDFORMS, type LandformKind } from "../worldgen/landforms";
import { RIG_INFO, RIG_VALUE, makeRigText, setStackedTexts, syncRigSystemCursor } from "./rigUi";
import { nameGameTexture } from "../art/sprites";

const DEPTH = 9500;
const MONO = "Share Tech Mono, monospace";
const GOLD = "#e8b84a";
const LIST_X = 16;
const LIST_Y = 40;
const LIST_W = 260;
const LINE_H = 16;
/** Preview canvas size (px); the rig scales it by zoom. */
const SIZE = 300;
/** Stamp sandbox size (texels): landforms place by texel radius, so this sets their scale. */
const SANDBOX = 900;
const FLAT = 0.45;
const WATER = 0.34;
const CONTOUR = 0.05;

type Entry = { kind: "shape"; id: MapShape; label: string; desc: string } | { kind: "landform"; id: LandformKind; label: string; desc: string };

const ENTRIES: Entry[] = [
  ...MAP_SHAPES.map((m): Entry => ({ kind: "shape", id: m.id, label: m.label, desc: m.description })),
  ...LANDFORM_KINDS.map((l): Entry => ({ kind: "landform", id: l.id, label: l.label, desc: l.description })),
];

const VIEWS = { shape: ["FIELD", "WITH NOISE"], landform: ["RELIEF", "HEIGHT"] } as const;

/** Preview-only: map shapes and landform stamps in isolation, from the real worldgen functions on scratch buffers. */
export class TerrainRig {
  open = false;
  private built = false;
  private scene: Phaser.Scene;
  private idx = 0;
  private view = 0;
  private seed = 2024;
  private zoom = 2;
  private dirty = true;
  private canvas = document.createElement("canvas");
  private g = this.canvas.getContext("2d", { willReadFrequently: true })!;
  private previewKey = "rig_terrain_live";
  /** Values behind the preview pixels, for the hover readout. */
  private values = new Float32Array(SIZE * SIZE);
  private valueLabel = "";
  private field: ShapeField | null = null;

  root: Phaser.GameObjects.Container;
  private dim!: Phaser.GameObjects.Rectangle;
  private board!: Phaser.GameObjects.Graphics;
  private preview!: Phaser.GameObjects.Image;
  private listTxt!: Phaser.GameObjects.Text;
  private hintTxt!: Phaser.GameObjects.Text;
  private infoTxt!: Phaser.GameObjects.Text;
  private uiCam!: Phaser.Cameras.Scene2D.Camera;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.canvas.width = SIZE;
    this.canvas.height = SIZE;
    this.root = scene.add.container(0, 0).setDepth(DEPTH).setScrollFactor(0).setVisible(false);
    scene.cameras.main.ignore(this.root);
  }

  private entry(): Entry {
    return ENTRIES[this.idx]!;
  }

  private ensureBuilt(): void {
    if (this.built) return;
    this.built = true;
    const scene = this.scene;
    const w = scene.scale.width;
    const h = scene.scale.height;
    this.dim = scene.add.rectangle(0, 0, w, h, 0x0c0a08, 0.78).setOrigin(0).setScrollFactor(0).setDepth(DEPTH);
    this.board = scene.add.graphics().setScrollFactor(0).setDepth(DEPTH + 1);
    this.preview = scene.add.image(0, 0, "__DEFAULT").setName("rig_terrain_preview").setScrollFactor(0).setDepth(DEPTH + 2);
    this.listTxt = makeRigText(scene, DEPTH + 4, { fontSize: "13px", lineSpacing: 3, color: RIG_VALUE });
    this.listTxt.setPosition(LIST_X, LIST_Y);
    this.infoTxt = makeRigText(scene, DEPTH + 4, { fontSize: "12px", lineSpacing: 4, color: RIG_INFO, wrapW: 320 });
    this.hintTxt = scene.add.text(18, 14, "", { fontFamily: MONO, fontSize: "12px", color: GOLD }).setScrollFactor(0).setDepth(DEPTH + 4);
    nameGameTexture(scene, this.listTxt, "rig_terrain_list");
    nameGameTexture(scene, this.infoTxt, "rig_terrain_info");
    nameGameTexture(scene, this.hintTxt, "rig_terrain_hint");
    this.root.add([this.dim, this.board, this.preview, this.listTxt, this.infoTxt, this.hintTxt]);

    this.uiCam = scene.cameras.add(0, 0, w, h, false, "terrainRig");
    this.uiCam.transparent = true;
    this.uiCam.setVisible(false);
    for (const child of scene.children.list) if (child !== this.root) this.uiCam.ignore(child);
    scene.events.on("addedtoscene", (go: Phaser.GameObjects.GameObject) => {
      if (go !== this.root) this.uiCam.ignore(go);
    });

    const kb = scene.input.keyboard;
    kb?.addKey(Phaser.Input.Keyboard.KeyCodes.V).on("down", () => {
      if (!this.open) return;
      this.view = (this.view + 1) % VIEWS[this.entry().kind].length;
      this.dirty = true;
    });
    kb?.addKey(Phaser.Input.Keyboard.KeyCodes.R).on("down", () => {
      if (!this.open) return;
      this.seed = (Math.random() * 0xffffffff) >>> 0;
      this.dirty = true;
    });
    scene.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      if (!this.open || !p.leftButtonDown() || p.x < LIST_X || p.x >= LIST_X + LIST_W) return;
      const row = Math.floor((p.y - LIST_Y) / LINE_H) - 1;
      const i = row - (row > MAP_SHAPES.length ? 2 : 0);
      if (row >= 0 && row !== MAP_SHAPES.length && row !== MAP_SHAPES.length + 1 && i >= 0 && i < ENTRIES.length) this.select(i);
    });
  }

  toggle(): void {
    this.ensureBuilt();
    this.open = !this.open;
    // Rig texts are created hidden (makeRigText); show each piece like the other rigs.
    for (const go of [this.root, this.dim, this.board, this.preview, this.listTxt, this.infoTxt, this.hintTxt]) go.setVisible(this.open);
    this.uiCam.setVisible(this.open);
    if (this.open) this.dirty = true;
    syncRigSystemCursor(this.scene);
  }

  cycle(dir: number): void {
    if (this.open) this.select((this.idx + dir + ENTRIES.length) % ENTRIES.length);
  }

  private select(i: number): void {
    const prevKind = this.entry().kind;
    this.idx = i;
    if (this.entry().kind !== prevKind) this.view = 0;
    this.dirty = true;
  }

  nudgeZoom(dir: number): void {
    if (this.open) this.zoom = Phaser.Math.Clamp(this.zoom + dir * 0.5, 1, 3);
  }

  update(): void {
    if (!this.open) return;
    if (this.dirty) {
      this.dirty = false;
      this.render();
    }
    this.layout();
    const e = this.entry();
    const shapes = ENTRIES.filter((x) => x.kind === "shape");
    const forms = ENTRIES.filter((x) => x.kind === "landform");
    const row = (x: Entry) => `${x === e ? "▸" : " "} ${x.label}`;
    this.listTxt.setText(
      [`— SHAPES  (${shapes.length}) —`, ...shapes.map(row), "", `— LANDFORMS  (${forms.length}) —`, ...forms.map(row)].join("\n")
    );
    const hover = this.hoverValue();
    setStackedTexts(
      [
        {
          txt: this.infoTxt,
          lines: [`${e.label}  ·  ${VIEWS[e.kind][this.view]}  ·  seed ${this.seed.toString(16)}`, e.desc, "", ...this.legend(e), "", hover ?? " "],
        },
      ],
      this.infoTxt.x,
      this.infoTxt.y
    );
    this.hintTxt.setText(`TERRAIN RIG   ↑ ↓ select   V view   R reseed   - + zoom ${this.zoom}×   (preview only — map gen untouched)`);
  }

  private legend(e: Entry): string[] {
    if (e.kind === "shape" && this.view === 0)
      return [
        "Height offset added to the noise.",
        "Blue: pushed toward sea · tan: raised.",
        `Contours every ${CONTOUR}. Dim: noise flattened.`,
        "Magenta: spawn hint · red: stronghold keep.",
      ];
    if (e.kind === "shape") return ["baseHeight with warp 1, relief 1, no edge", "falloff or bias: shape + noise together.", "Water line 0.34."];
    if (this.view === 0) return ["Stamped alone on flat ground, hillshaded", "with the game's light direction.", "Colors by height band (water/ground/rock/peak)."];
    return ["Raw height after the stamp (grey ramp).", `Contours every ${CONTOUR}.`];
  }

  private render(): void {
    const e = this.entry();
    const img = this.g.createImageData(SIZE, SIZE);
    if (e.kind === "shape") this.renderShape(e.id, img.data);
    else this.renderLandform(e.id, img.data);
    this.g.putImageData(img, 0, 0);
    const tex = this.scene.textures;
    if (tex.exists(this.previewKey)) tex.remove(this.previewKey);
    tex.addCanvas(this.previewKey, this.canvas);
    this.preview.setTexture(this.previewKey);
  }

  private renderShape(id: MapShape, d: Uint8ClampedArray): void {
    const f = makeShape(id, this.seed);
    this.field = f;
    const noise = this.view === 1;
    const prof = { landBias: 0, relief: 1, edgeFalloff: 0, shape: id, warp: 1 };
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const nx = x / SIZE;
        const ny = y / SIZE;
        const v = noise ? baseHeight(nx, ny, this.seed, prof, f, 0) : f.at(nx, ny);
        this.values[y * SIZE + x] = v;
      }
    }
    this.valueLabel = noise ? "height" : "offset";
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const i = y * SIZE + x;
        const v = this.values[i]!;
        let c: number[];
        if (noise) c = bandColor(v);
        else {
          const t = Math.max(-1, Math.min(1, v / 0.3));
          const rl = f.relief ? f.relief(x / SIZE, y / SIZE) : 1;
          c = (t < 0 ? [40 + 30 * (1 + t), 80 + 40 * (1 + t), 120 + 60 * (1 + t)] : [150 + 100 * t, 140 + 90 * t, 110 + 90 * t]).map(
            (q) => q * (0.55 + 0.45 * rl)
          );
          if (this.contour(i, x, y)) c = [20, 20, 20];
          if (Math.hypot(x - f.spawnX * SIZE, y - f.spawnY * SIZE) < 4) c = [255, 0, 255];
          if (f.keep && Math.hypot(x - f.keep.x * SIZE, y - f.keep.y * SIZE) < 4) c = [255, 40, 40];
        }
        put(d, i, c);
      }
    }
  }

  private renderLandform(id: LandformKind, d: Uint8ClampedArray): void {
    this.field = null;
    const n = SANDBOX;
    const h = new Float32Array(n * n).fill(FLAT);
    const far = { x: -1e6, y: -1e6 };
    if (id === "dunes") applyDunes(h, n, 1, this.seed, far, () => true);
    else applyLandforms(h, n, { ...NO_LANDFORMS, [id]: 1 }, this.seed, far, WATER);
    // Frame the stamp's footprint.
    let x0 = n;
    let y0 = n;
    let x1 = 0;
    let y1 = 0;
    for (let i = 0; i < h.length; i++) {
      if (Math.abs(h[i]! - FLAT) < 0.002) continue;
      const x = i % n;
      const y = (i / n) | 0;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
    if (x1 < x0) [x0, y0, x1, y1] = [0, 0, n - 1, n - 1];
    const side = Math.max(x1 - x0, y1 - y0) * 1.12 + 16;
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const at = (x: number, y: number) => {
      const sx = Math.max(1, Math.min(n - 2, Math.round(cx - side / 2 + (x / SIZE) * side)));
      const sy = Math.max(1, Math.min(n - 2, Math.round(cy - side / 2 + (y / SIZE) * side)));
      return sy * n + sx;
    };
    this.valueLabel = "height";
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) this.values[y * SIZE + x] = h[at(x, y)]!;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const i = y * SIZE + x;
        const v = this.values[i]!;
        let c: number[];
        if (this.view === 0) {
          const j = at(x, y);
          const dx = (h[j + 1]! - h[j - 1]!) * 52;
          const dy = (h[j + n]! - h[j - n]!) * 52;
          const len = Math.hypot(dx, dy, 1);
          const lit = 0.38 + Math.pow(Math.max(0, Math.min(1, (-dx * -0.64 + -dy * -0.44 + 0.62) / len)), 1.15) * 0.82;
          c = bandColor(v).map((q) => q * lit);
        } else {
          const g = Math.max(0, Math.min(255, (v - 0.25) * 400));
          c = this.contour(i, x, y) ? [232, 184, 74] : [g, g, g];
        }
        put(d, i, c);
      }
    }
  }

  private contour(i: number, x: number, y: number): boolean {
    if (x >= SIZE - 1 || y >= SIZE - 1) return false;
    const b = Math.floor(this.values[i]! / CONTOUR);
    return b !== Math.floor(this.values[i + 1]! / CONTOUR) || b !== Math.floor(this.values[i + SIZE]! / CONTOUR);
  }

  private layout(): void {
    const h = this.scene.scale.height;
    this.preview.setScale(this.zoom);
    const bw = this.preview.displayWidth;
    const bh = this.preview.displayHeight;
    const bx = LIST_X + LIST_W + 20;
    const by = Math.max(40, Math.min((h - bh) / 2, h - bh - 20));
    this.preview.setPosition(bx + bw / 2, by + bh / 2);
    this.board.clear();
    this.board.lineStyle(1, 0xe8b84a, 0.55);
    this.board.strokeRect(bx - 6, by - 6, bw + 12, bh + 12);
    this.infoTxt.setPosition(bx + bw + 24, by);
  }

  private hoverValue(): string | null {
    const p = this.scene.input.activePointer;
    const lp = this.preview.getLocalPoint(p.x, p.y, undefined, this.uiCam);
    if (lp.x < 0 || lp.y < 0 || lp.x >= SIZE || lp.y >= SIZE) {
      syncRigSystemCursor(this.scene, "default");
      return null;
    }
    syncRigSystemCursor(this.scene, "crosshair");
    const x = Math.floor(lp.x);
    const y = Math.floor(lp.y);
    const v = this.values[y * SIZE + x]!;
    const rl = this.field?.relief && this.view === 0 ? `  relief ×${this.field.relief(x / SIZE, y / SIZE).toFixed(2)}` : "";
    return `${this.valueLabel} ${v >= 0 ? "+" : ""}${v.toFixed(3)}  at ${(x / SIZE).toFixed(2)}, ${(y / SIZE).toFixed(2)}${rl}`;
  }
}

function bandColor(v: number): number[] {
  if (v < WATER) return [40, 90, 120];
  if (v < 0.4) return [196, 172, 122];
  if (v > 0.72) return [226, 226, 232];
  if (v > 0.62) return [150, 110, 80];
  return [120 + (v - 0.4) * 120, 140 + (v - 0.4) * 60, 84];
}

function put(d: Uint8ClampedArray, i: number, c: number[]): void {
  const o = i * 4;
  d[o] = c[0]!;
  d[o + 1] = c[1]!;
  d[o + 2] = c[2]!;
  d[o + 3] = 255;
}
