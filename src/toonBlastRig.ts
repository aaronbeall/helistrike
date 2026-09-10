import Phaser from "phaser";
import { RIG_INFO, RIG_VALUE, makeRigText } from "./rigUi";
import {
  TOON_BLAST_DEFAULTS,
  toonBlastParams,
  makeToonClusters,
  mulberry32,
  renderToonBlastFrame,
  resetToonBlastParams,
  type ToonBlastParams,
  bakeToonBlast,
  ensureToonBlastAnims,
} from "./toonBlast";
import { nameGameTexture } from "./sprites";

const DEPTH = 9450;
const MONO = "Share Tech Mono, monospace";
const GOLD = "#e8b84a";
const LIST_X = 16;
const LIST_Y = 40;
const LIST_W = 340;
const LINE_H = 16;

type ParamKey = keyof ToonBlastParams;

type ParamMeta = {
  step: number;
  stepFast: number;
  /** Randomize range only — nudge is unbounded. */
  min: number;
  max: number;
  decimals?: number;
  hex?: boolean;
  desc: string;
};

/** Must list every `ToonBlastParams` key — `satisfies` keeps it exhaustive. */
const PARAM_META = {
  // —— explosion ——
  size: { step: 8, stepFast: 32, min: 64, max: 320, desc: "Explosion bake/preview canvas size (px)." },
  frames: { step: 1, stepFast: 4, min: 8, max: 64, desc: "Spritesheet frame count when baking." },
  cutStart: { step: 0.02, stepFast: 0.08, min: 0, max: 0.8, decimals: 2, desc: "Time when blob layer cutaways begin (0–1)." },
  easePower: { step: 0.5, stepFast: 1, min: 1, max: 10, decimals: 1, desc: "Ease-out exponent for cluster motion and cuts." },
  coolAmount: { step: 0.05, stepFast: 0.15, min: 0, max: 1.5, decimals: 2, desc: "How fast fire cools into smoke then dust (0=hot, 1=full cool)." },
  bloomStrength: { step: 0.02, stepFast: 0.1, min: 0, max: 1, decimals: 2, desc: "Soft outer glow early; fades as the blast cools." },
  bloomSize: { step: 0.05, stepFast: 0.15, min: 0.8, max: 2, decimals: 2, desc: "Bloom radius relative to blob span." },

  // —— cluster ——
  largeClusters: { step: 1, stepFast: 1, min: 0, max: 8, desc: "Count of large clusters in the explosion." },
  smallClusters: { step: 1, stepFast: 1, min: 0, max: 8, desc: "Count of small clusters / late dust lobes." },
  clusterAngJitter: { step: 0.02, stepFast: 0.1, min: 0, max: 1.5, decimals: 2, desc: "Cluster ring angle noise (radians)." },
  clusterDist0Max: { step: 0.5, stepFast: 2, min: 0, max: 20, decimals: 1, desc: "Cluster max start distance from center." },
  clusterDist1Base: { step: 1, stepFast: 4, min: 4, max: 120, desc: "Cluster base outer travel distance." },
  clusterDist1Jitter: { step: 1, stepFast: 4, min: 0, max: 60, desc: "Random add to cluster outer travel." },
  clusterDist1LargeBonus: { step: 1, stepFast: 4, min: 0, max: 40, desc: "Extra travel for large clusters." },
  clusterMotionMin: { step: 0.02, stepFast: 0.1, min: 0.2, max: 1.5, decimals: 2, desc: "Fastest cluster travel remap." },
  clusterMotionMax: { step: 0.02, stepFast: 0.1, min: 0.2, max: 1.5, decimals: 2, desc: "Slowest cluster travel remap." },
  clusterLifeMin: { step: 0.02, stepFast: 0.1, min: 0.1, max: 1.2, decimals: 2, desc: "Shortest cluster cut life." },
  clusterLifeMax: { step: 0.02, stepFast: 0.1, min: 0.1, max: 1.5, decimals: 2, desc: "Longest cluster cut life." },
  clusterBlobSpreadStart: { step: 0.02, stepFast: 0.1, min: 0.2, max: 1.5, decimals: 2, desc: "Blob spacing inside a cluster at start." },
  clusterBlobSpreadEnd: { step: 0.02, stepFast: 0.1, min: 0.2, max: 2, decimals: 2, desc: "Blob spacing inside a cluster at full spread." },
  clusterVerticalBias: { step: 0.05, stepFast: 0.15, min: 0, max: 1.5, decimals: 2, desc: "Early upward stretch (fire column); eases later." },

  // —— blob ——
  blobsMin: { step: 1, stepFast: 1, min: 1, max: 8, desc: "Min blobs (particles) per cluster." },
  blobsMax: { step: 1, stepFast: 1, min: 1, max: 10, desc: "Max blobs (particles) per cluster." },
  blobRLargeMin: { step: 1, stepFast: 4, min: 4, max: 80, desc: "Min smoke-layer radius for large-cluster blobs." },
  blobRLargeMax: { step: 1, stepFast: 4, min: 4, max: 100, desc: "Max smoke-layer radius for large-cluster blobs." },
  blobRSmallMin: { step: 1, stepFast: 4, min: 4, max: 60, desc: "Min smoke-layer radius for small-cluster blobs." },
  blobRSmallMax: { step: 1, stepFast: 4, min: 4, max: 80, desc: "Max smoke-layer radius for small-cluster blobs." },
  blobLocalDistLargeMin: { step: 0.5, stepFast: 2, min: 0, max: 40, decimals: 1, desc: "Min blob offset from large cluster center." },
  blobLocalDistLargeSpan: { step: 0.5, stepFast: 2, min: 0, max: 40, decimals: 1, desc: "Random span for blob offsets in large clusters." },
  blobLocalDistSmallMin: { step: 0.5, stepFast: 2, min: 0, max: 30, decimals: 1, desc: "Min blob offset from small cluster center." },
  blobLocalDistSmallSpan: { step: 0.5, stepFast: 2, min: 0, max: 30, decimals: 1, desc: "Random span for blob offsets in small clusters." },
  blobScaleStart: { step: 0.02, stepFast: 0.1, min: 0.1, max: 1, decimals: 2, desc: "Birth scale of each blob." },
  blobScaleEnd: { step: 0.02, stepFast: 0.1, min: 0.5, max: 1.5, decimals: 2, desc: "Peak scale before cutaway." },
  blobDurMin: { step: 0.02, stepFast: 0.1, min: 0.4, max: 1, decimals: 2, desc: "Shortest blob lifetime (relative)." },
  blobDurMax: { step: 0.02, stepFast: 0.1, min: 0.6, max: 1, decimals: 2, desc: "Longest blob lifetime." },
  sparkCount: { step: 1, stepFast: 1, min: 0, max: 12, desc: "Thin yellow/orange wisps early in the blast." },
  sparkLen: { step: 1, stepFast: 4, min: 4, max: 64, desc: "Initial length of spark streaks." },
  sparkWid: { step: 0.25, stepFast: 1, min: 1, max: 8, decimals: 2, desc: "Thickness of spark streaks." },
  sparkDist: { step: 2, stepFast: 8, min: 20, max: 200, desc: "How far sparks fly from center (fast travel)." },

  // —— layer ——
  layerSmokeScale: { step: 0.02, stepFast: 0.1, min: 0.6, max: 1.4, decimals: 2, desc: "Outer smoke/dust silhouette scale." },
  layerOrangeScale: { step: 0.02, stepFast: 0.1, min: 0.3, max: 1, decimals: 2, desc: "Mid fire band nested inside smoke." },
  layerYellowScale: { step: 0.02, stepFast: 0.1, min: 0.15, max: 0.9, decimals: 2, desc: "Hot core nested inside orange." },
  layerOrangeInset: { step: 0.01, stepFast: 0.05, min: 0, max: 0.5, decimals: 2, desc: "Pull orange toward blob center." },
  layerYellowInset: { step: 0.01, stepFast: 0.05, min: 0, max: 0.6, decimals: 2, desc: "Pull yellow core further inward." },
  layerShadowOffset: { step: 0.02, stepFast: 0.1, min: 0, max: 0.6, decimals: 2, desc: "Underside crescent offset for cel volume." },
  layerShadowScale: { step: 0.02, stepFast: 0.1, min: 0.2, max: 1, decimals: 2, desc: "Size of underside shadow crescents." },
  layerYellowCutStart: { step: 0.01, stepFast: 0.05, min: 0, max: 1, decimals: 2, desc: "When yellow cores begin cutting away." },
  layerYellowCutEnd: { step: 0.01, stepFast: 0.05, min: 0, max: 1, decimals: 2, desc: "When yellow cores finish cutting." },
  layerOrangeCutStart: { step: 0.01, stepFast: 0.05, min: 0, max: 1, decimals: 2, desc: "When orange bands begin cutting." },
  layerOrangeCutEnd: { step: 0.01, stepFast: 0.05, min: 0, max: 1, decimals: 2, desc: "When orange bands finish cutting." },
  layerSmokeCutStart: { step: 0.01, stepFast: 0.05, min: 0, max: 1, decimals: 2, desc: "When smoke/dust silhouette begins cutting." },
  layerSmokeCutEnd: { step: 0.01, stepFast: 0.05, min: 0, max: 1, decimals: 2, desc: "When smoke/dust finishes (holes open late)." },
  layerRoughness: { step: 0.01, stepFast: 0.05, min: 0, max: 0.5, decimals: 2, desc: "Outline jitter — keep low for round soft bumps." },
  layerHoleScale: { step: 0.1, stepFast: 0.4, min: 0.5, max: 4, decimals: 1, desc: "How aggressively late smoke opens holes / fragments." },

  // —— color (0xRRGGBB) ——
  colYellow: { step: 0x010101, stepFast: 0x101010, min: 0, max: 0xffffff, hex: true, desc: "Hot core color (0xRRGGBB)." },
  colOrange: { step: 0x010101, stepFast: 0x101010, min: 0, max: 0xffffff, hex: true, desc: "Mid fire color (0xRRGGBB)." },
  colSmoke: { step: 0x010101, stepFast: 0x101010, min: 0, max: 0xffffff, hex: true, desc: "Smoke/dust color (0xRRGGBB)." },
  colShadow: { step: 0x010101, stepFast: 0x101010, min: 0, max: 0xffffff, hex: true, desc: "Crevice shadow color (0xRRGGBB)." },
} satisfies Record<ParamKey, ParamMeta>;

type ParamDef = { key: ParamKey; label: string } & ParamMeta;

const PARAMS: ParamDef[] = (Object.keys(PARAM_META) as ParamKey[]).map((key) => ({
  key,
  label: key,
  ...PARAM_META[key],
}));

/**
 * Live toon-blast tuner: scrub params, preview animation, bake sheets.
 */
export class ToonBlastRig {
  open = false;
  private built = false;
  private scene: Phaser.Scene;
  private idx = 0;
  private seed = 0xb1a57e;
  private animT = 0;
  private playSpeed = 1;
  /** Preview board zoom: 1× = native canvas pixels (speed uses `,` / `.`). */
  private viewZoom = 2;
  private paused = false;
  private dirtyLayout = true;
  private clusters = makeToonClusters(mulberry32(this.seed));
  private tmp = document.createElement("canvas");
  private gTmp = this.tmp.getContext("2d", { willReadFrequently: true })!;
  private previewKey = "rig_toon_live";

  root: Phaser.GameObjects.Container;
  private dim!: Phaser.GameObjects.Rectangle;
  private board!: Phaser.GameObjects.Graphics;
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
      .setName("rig_toon_preview")
      .setScrollFactor(0)
      .setDepth(DEPTH + 2)
      .setVisible(false);
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
    nameGameTexture(scene, this.listTxt, "rig_toon_list");
    nameGameTexture(scene, this.infoTxt, "rig_toon_info");
    nameGameTexture(scene, this.descTxt, "rig_toon_desc");
    nameGameTexture(scene, this.hintTxt, "rig_toon_hint");
    this.root.add([
      this.dim,
      this.board,
      this.preview,
      this.listTxt,
      this.infoTxt,
      this.descTxt,
      this.hintTxt,
    ]);

    this.uiCam = scene.cameras.add(0, 0, w, h, false, "toonBlastRig");
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
        if (this.open) this.nudge(-1);
      });
      kb.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT).on("down", () => {
        if (this.open) this.nudge(1);
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
        bakeToonBlast(scene.textures);
        ensureToonBlastAnims(scene.anims, scene.textures);
      });
      kb.addKey(Phaser.Input.Keyboard.KeyCodes.D).on("down", () => {
        if (!this.open) return;
        resetToonBlastParams();
        this.dirtyLayout = true;
        this.animT = 0;
      });
      kb.addKey(Phaser.Input.Keyboard.KeyCodes.G).on("down", () => {
        if (!this.open) return;
        this.randomize();
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
    this.listTxt.setVisible(this.open);
    this.infoTxt.setVisible(this.open);
    this.descTxt.setVisible(this.open);
    this.hintTxt.setVisible(this.open);
    this.scene.input.setDefaultCursor(this.open ? "default" : "none");
    this.uiCam.setVisible(this.open);
    if (this.open) {
      this.dirtyLayout = true;
      this.animT = 0;
    }
  }

  cycle(dir: number): void {
    if (!this.open) return;
    const n = PARAMS.length;
    this.idx = (this.idx + dir + n) % n;
  }

  nudgeZoom(dir: number): void {
    if (!this.open) return;
    const steps = [0.5, 1, 1.5, 2, 3, 4, 6, 8];
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
    this.dirtyLayout = true;
  }

  private nudge(dir: number): void {
    const def = PARAMS[this.idx]!;
    const fast = this.shiftKey?.isDown ?? false;
    const step = (fast ? def.stepFast : def.step) * dir;
    // No hard clamp — min/max are randomize hints only.
    let next = toonBlastParams[def.key] + step;
    if (def.hex) next = (next >>> 0) & 0xffffff;
    else if (Number.isInteger(def.step) && !def.decimals) next = Math.round(next);
    toonBlastParams[def.key] = next;
    if (def.key === "blobsMin" && toonBlastParams.blobsMax < next) {
      toonBlastParams.blobsMax = next;
    }
    if (def.key === "blobsMax" && toonBlastParams.blobsMin > next) {
      toonBlastParams.blobsMin = next;
    }
    this.dirtyLayout = true;
  }

  private randomize(): void {
    for (const row of PARAMS) {
      const lo = Math.min(row.min, row.max);
      const hi = Math.max(row.min, row.max);
      let v = lo + Math.random() * (hi - lo);
      if (row.hex) v = (Math.round(v) >>> 0) & 0xffffff;
      else if (row.decimals != null) {
        const p = 10 ** row.decimals;
        v = Math.round(v * p) / p;
      } else if (Number.isInteger(row.step)) v = Math.round(v);
      toonBlastParams[row.key] = v;
    }
    if (toonBlastParams.blobsMax < toonBlastParams.blobsMin) {
      const t = toonBlastParams.blobsMin;
      toonBlastParams.blobsMin = toonBlastParams.blobsMax;
      toonBlastParams.blobsMax = t;
    }
    this.dirtyLayout = true;
    this.animT = 0;
  }

  private pickFromList(py: number): void {
    const size = this.pageSize();
    const row = Math.floor((py - LIST_Y) / LINE_H) - 1;
    if (row < 0 || row >= size) return;
    const i = this.pageOf(this.idx) * size + row;
    if (i < 0 || i >= PARAMS.length) return;
    this.idx = i;
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
    if (this.dirtyLayout) {
      this.clusters = makeToonClusters(mulberry32(this.seed), toonBlastParams);
      this.dirtyLayout = false;
    }
    if (!this.paused) {
      this.animT += dt * this.playSpeed * 0.55;
      if (this.animT > 1.15) this.animT = 0;
    }
    const t = Math.max(0, Math.min(1, this.animT));
    this.paint(t);

    const size = this.pageSize();
    const pages = Math.max(1, Math.ceil(PARAMS.length / size));
    const page = this.pageOf(this.idx);
    const start = page * size;
    const slice = PARAMS.slice(start, start + size);
    this.listTxt.setText(
      [
        `— PARAMS  ${page + 1}/${pages}  seed ${this.seed.toString(16)} —`,
        ...slice.map((row, i) => {
          const mark = start + i === this.idx ? "▸" : " ";
          const v = toonBlastParams[row.key];
          const shown = row.hex
            ? `#${(v >>> 0).toString(16).padStart(6, "0")}`
            : row.decimals != null
              ? v.toFixed(row.decimals)
              : Number.isInteger(row.step)
                ? String(Math.round(v))
                : v.toFixed(2);
          const def = TOON_BLAST_DEFAULTS[row.key];
          const tag = Math.abs(v - def) > 1e-6 ? "*" : " ";
          return `${mark}${tag}${row.label.padEnd(18)}${shown}`;
        }),
      ].join("\n")
    );

    this.hintTxt.setText(
      `TOON BLAST RIG   ↑ ↓ select   ← → nudge (unbounded, Shift×)   G randomize   R reseed   Space replay   P pause   , . speed ${this.playSpeed.toFixed(2)}×   - + zoom ${this.viewZoom}×   B bake   D defaults`
    );
    const sel = PARAMS[this.idx]!;
    this.infoTxt.setPosition(LIST_X + LIST_W + 24, LIST_Y);
    this.infoTxt.setText(
      [
        `t ${t.toFixed(2)}  ${this.paused ? "PAUSED" : "PLAY"}`,
        `clusters ${this.clusters.length}  blobs ${this.clusters.reduce((n, c) => n + c.blobs.length, 0)}`,
        `hierarchy: explosion → cluster → blob → layer (smoke/orange/yellow)`,
        "",
        "Live preview uses current params.",
        "G randomizes within listed min–max hints.",
        "← → nudge is unbounded (no clamp).",
        "B rebakes fx_toon_blast_0..6",
        "into the texture cache.",
      ].join("\n")
    );
    const listRight = LIST_X + LIST_W + 20;
    const h = this.scene.scale.height;
    this.descTxt.setPosition(listRight, Math.min(h - 72, this.preview.y + this.preview.displayHeight * 0.5 + 24));
    this.descTxt.setText(`${sel.key}\n${sel.desc}`);
  }

  private paint(t: number): void {
    const p = toonBlastParams;
    const size = Math.max(32, Math.round(p.size));
    if (this.tmp.width !== size || this.tmp.height !== size) {
      this.tmp.width = size;
      this.tmp.height = size;
    }
    const frame = renderToonBlastFrame(this.clusters, t, size, p, this.tmp, this.gTmp);
    const tex = this.scene.textures;
    if (tex.exists(this.previewKey)) tex.remove(this.previewKey);
    tex.addCanvas(this.previewKey, frame);
    this.preview.setTexture(this.previewKey);
    this.preview.setOrigin(0.5, 0.5);

    const h = this.scene.scale.height;
    const listRight = LIST_X + LIST_W + 20;
    const pad = 10;
    // 1× = native canvas pixels (same as combat/roster/sprite).
    this.preview.setScale(this.viewZoom);
    const bw = this.preview.displayWidth;
    const bh = this.preview.displayHeight;
    const cx = listRight + pad + bw * 0.5;
    const cy = Math.min(h * 0.45, h - pad - bh * 0.5);
    this.preview.setPosition(cx, cy);

    const bx = cx - bw * 0.5;
    const by = cy - bh * 0.5;
    this.board.clear();
    // Neutral grey board to match reference sequence.
    this.board.fillStyle(0x6a6a6a, 1);
    this.board.fillRect(bx - 10, by - 10, bw + 20, bh + 20);
    this.board.lineStyle(1, 0xe8b84a, 0.55);
    this.board.strokeRect(bx - 10, by - 10, bw + 20, bh + 20);
  }
}
