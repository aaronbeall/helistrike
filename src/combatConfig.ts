import Phaser from "phaser";
import {
  HELLFIRE_LOCK_T,
  HELLFIRE_SEEK_DELAY,
  MISSILE_IGNITE,
  PLAYER_WPNS,
  SHOT_ORIGIN,
  type PlayerWpnSpec,
} from "./combat";
import { ENEMY_WPNS, usesOfWeapon } from "./roster";
import { CFG_INFO, CFG_VALUE, dumpConfig, makeConfigText, setStatsAndInfo } from "./configUi";
import {
  FX_BLAST_CELLS,
  FX_KINDS,
  FX_SHEET_SIZE,
  FX_VARIANTS,
  nameGameTexture,
  type FxKind,
} from "./sprites";

const DEPTH = 9300;
const MONO = "Share Tech Mono, monospace";
const GOLD = "#e8b84a";
const PAPER = CFG_VALUE;
const ORIGIN_COLOR = 0xe8b84a;
const CENTER_COLOR = 0x5ec8ff;

/** Geometric center of projectile art (UV). */
const SHOT_CENTER = { x: 0.5, y: 0.5 } as const;

const LIST_X = 16;
const LIST_Y = 40;
const LIST_W = 300;
const STATS_W = 420;
const LINE_H = 16;

type Filter = "all" | "player" | "preset" | "fx";
const FILTERS: Filter[] = ["all", "player", "preset", "fx"];

export type CombatCat = "player" | "preset" | "fx";

export interface CombatEntry {
  id: string;
  cat: CombatCat;
  label: string;
  tag: string;
  /** Preview texture key (sheet or still). */
  tex: string;
  /** Sheet frame count when >1 (fx_* sheets). */
  frames?: number;
  /** Nose-up rotation for projectile previews. */
  rotOff?: number;
  stats: string[];
  info: string[];
}

/**
 * Lazy debug browser for shared combat sources: player weapons (PLAYER_WPNS),
 * ENEMY_WPNS (+ usesOfWeapon), and FX_KINDS / blast cells.
 * Per-unit WeaponSpecs / secondary live on the roster rig, not here.
 */
export class CombatConfigTool {
  open = false;
  private built = false;
  private scene: Phaser.Scene;
  private idx = 0;
  private filter: Filter = "all";
  private zoom = 2;
  private frameT = 0;
  private entries: CombatEntry[] = [];
  root: Phaser.GameObjects.Container;
  private dim!: Phaser.GameObjects.Rectangle;
  private board!: Phaser.GameObjects.Graphics;
  private preview!: Phaser.GameObjects.Image;
  private overlay!: Phaser.GameObjects.Graphics;
  private listTxt!: Phaser.GameObjects.Text;
  private statsTxt!: Phaser.GameObjects.Text;
  private infoTxt!: Phaser.GameObjects.Text;
  private hintTxt!: Phaser.GameObjects.Text;
  private onBuilt?: (root: Phaser.GameObjects.Container) => void;
  private uiCam!: Phaser.Cameras.Scene2D.Camera;

  constructor(scene: Phaser.Scene, onBuilt?: (root: Phaser.GameObjects.Container) => void) {
    this.scene = scene;
    this.onBuilt = onBuilt;
    this.root = scene.add.container(0, 0).setDepth(DEPTH).setScrollFactor(0).setVisible(false);
    scene.cameras.main.ignore(this.root);
  }

  private ensureBuilt(): void {
    if (this.built) return;
    this.built = true;
    this.entries = buildCombatCatalog();
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
      .setName("ui_combat_preview")
      .setScrollFactor(0)
      .setDepth(DEPTH + 2)
      .setVisible(false);
    this.overlay = scene.add.graphics().setScrollFactor(0).setDepth(DEPTH + 3).setVisible(false);
    this.listTxt = makeConfigText(scene, DEPTH + 4, { fontSize: "13px", lineSpacing: 3, color: PAPER });
    this.listTxt.setPosition(LIST_X, LIST_Y);
    this.statsTxt = makeConfigText(scene, DEPTH + 4, { fontSize: "12px", lineSpacing: 4, color: PAPER, wrapW: STATS_W - 8 });
    this.infoTxt = makeConfigText(scene, DEPTH + 4, { fontSize: "12px", lineSpacing: 4, color: CFG_INFO, wrapW: STATS_W - 8 });
    this.hintTxt = scene.add
      .text(18, 14, "", { fontFamily: MONO, fontSize: "12px", color: GOLD })
      .setScrollFactor(0)
      .setDepth(DEPTH + 4)
      .setVisible(false);
    nameGameTexture(scene, this.listTxt, "ui_combat_list");
    nameGameTexture(scene, this.statsTxt, "ui_combat_stats");
    nameGameTexture(scene, this.infoTxt, "ui_combat_info");
    nameGameTexture(scene, this.hintTxt, "ui_combat_hint");
    this.root.add([
      this.dim,
      this.board,
      this.preview,
      this.overlay,
      this.listTxt,
      this.statsTxt,
      this.infoTxt,
      this.hintTxt,
    ]);

    this.uiCam = scene.cameras.add(0, 0, w, h, false, "combatRig");
    this.uiCam.setScroll(0, 0);
    this.uiCam.setZoom(1);
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
      kb.addKey(Phaser.Input.Keyboard.KeyCodes.COMMA).on("down", () => {
        if (this.open) this.page(-1);
      });
      kb.addKey(Phaser.Input.Keyboard.KeyCodes.PERIOD).on("down", () => {
        if (this.open) this.page(1);
      });
      kb.addKey(Phaser.Input.Keyboard.KeyCodes.PAGE_UP).on("down", () => {
        if (this.open) this.page(-1);
      });
      kb.addKey(Phaser.Input.Keyboard.KeyCodes.PAGE_DOWN).on("down", () => {
        if (this.open) this.page(1);
      });
      kb.addKey(Phaser.Input.Keyboard.KeyCodes.G).on("down", () => {
        if (!this.open) return;
        const i = FILTERS.indexOf(this.filter);
        this.filter = FILTERS[(i + 1) % FILTERS.length]!;
        this.idx = 0;
        this.refreshPreview();
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
    this.statsTxt.setVisible(this.open);
    this.infoTxt.setVisible(this.open);
    this.hintTxt.setVisible(this.open);
    this.scene.input.setDefaultCursor(this.open ? "default" : "none");
    this.uiCam.setVisible(this.open);
    if (this.open) this.refreshPreview();
    else this.overlay.clear();
  }

  cycle(dir: number): void {
    if (!this.open) return;
    const n = this.filtered().length;
    if (!n) return;
    this.idx = (this.idx + dir + n) % n;
    this.refreshPreview();
  }

  nudgeZoom(dir: number): void {
    if (!this.open) return;
    const steps = [0.5, 1, 1.5, 2, 3, 4, 6, 8];
    let i = 0;
    let best = Infinity;
    for (let k = 0; k < steps.length; k++) {
      const d = Math.abs(steps[k]! - this.zoom);
      if (d < best) {
        best = d;
        i = k;
      }
    }
    this.zoom = steps[Phaser.Math.Clamp(i + dir, 0, steps.length - 1)]!;
    this.refreshPreview();
  }

  page(dir: number): void {
    if (!this.open) return;
    const items = this.filtered();
    const size = this.pageSize();
    const pages = Math.max(1, Math.ceil(items.length / size));
    const next = (((this.pageOf(this.idx) + dir) % pages) + pages) % pages;
    this.idx = Math.min(items.length - 1, next * size);
    this.refreshPreview();
  }

  pickFromList(py: number): void {
    if (!this.open) return;
    const items = this.filtered();
    const size = this.pageSize();
    const row = Math.floor((py - LIST_Y) / LINE_H) - 1;
    if (row < 0 || row >= size) return;
    const i = this.pageOf(this.idx) * size + row;
    if (i < 0 || i >= items.length) return;
    this.idx = i;
    this.refreshPreview();
  }

  update(dt: number): void {
    if (!this.open) return;
    const items = this.filtered();
    if (!items.length) return;
    if (this.idx >= items.length) this.idx = 0;
    const e = items[this.idx]!;

    this.hintTxt.setText(
      `COMBAT RIG   \` cycle / close   [ ] cycle   , . page   - + zoom ${this.zoom}×   G filter ${this.filter.toUpperCase()}   gold origin · cyan center`
    );

    const size = this.pageSize();
    const pages = Math.max(1, Math.ceil(items.length / size));
    const page = this.pageOf(this.idx);
    const start = page * size;
    const slice = items.slice(start, start + size);
    this.listTxt.setText(
      [
        `— ${this.filter.toUpperCase()}  ${page + 1} / ${pages}  (${items.length}/${this.entries.length}) —`,
        ...slice.map((row, i) => {
          const mark = start + i === this.idx ? "▸" : " ";
          return `${mark} ${row.label.padEnd(22)} ${row.tag}`;
        }),
      ].join("\n")
    );

    this.layoutPreview(e, dt);
  }

  private pageSize(): number {
    return Math.max(8, Math.floor((this.scene.scale.height - LIST_Y - 28) / LINE_H) - 1);
  }

  private pageOf(idx: number): number {
    return Math.floor(idx / this.pageSize());
  }

  private filtered(): CombatEntry[] {
    if (this.filter === "all") return this.entries;
    return this.entries.filter((e) => e.cat === this.filter);
  }

  private refreshPreview(): void {
    if (!this.open || !this.built) return;
    this.update(0);
  }

  private layoutPreview(e: CombatEntry, dt: number): void {
    const w = this.scene.scale.width;
    const h = this.scene.scale.height;
    const listRight = LIST_X + LIST_W + 20;
    const gap = 28;
    const tex = e.tex;
    const frames = e.frames ?? 1;

    if (!this.scene.textures.exists(tex)) {
      this.preview.setVisible(false);
      this.board.clear();
      this.overlay.clear();
      setStatsAndInfo(this.statsTxt, this.infoTxt, e.stats, e.info, listRight, LIST_Y);
      return;
    }

    this.preview.setVisible(true).setTexture(tex);
    if (frames > 1) {
      this.frameT += dt;
      const fi = Math.floor(this.frameT * 8) % frames;
      if (Number(this.preview.frame.name) !== fi) this.preview.setFrame(fi);
    } else {
      this.preview.setFrame(0);
    }

    const pivot = { x: 0.5, y: 0.5 };
    this.preview.setOrigin(pivot.x, pivot.y);
    const s = this.zoom;
    this.preview.setScale(s);
    const rot = e.rotOff ?? (e.cat === "fx" ? 0 : Math.PI / 2);
    this.preview.setRotation(rot);

    const bw = this.preview.displayWidth;
    const bh = this.preview.displayHeight;
    const cos = Math.abs(Math.cos(rot));
    const sin = Math.abs(Math.sin(rot));
    const boxW = bw * cos + bh * sin;
    const boxH = bw * sin + bh * cos;
    const pad = 10;
    const cx = listRight + pad + boxW * 0.5;
    const cy = Math.min(LIST_Y + pad + boxH * 0.5, h - pad - boxH * 0.5);
    this.preview.setPosition(cx, cy);

    const bx = cx - boxW * 0.5;
    const by = cy - boxH * 0.5;
    setStatsAndInfo(
      this.statsTxt,
      this.infoTxt,
      e.stats,
      e.info,
      Math.min(bx + boxW + gap, w - STATS_W - 16),
      Math.max(LIST_Y, by)
    );

    this.board.clear();
    const cell = 8;
    this.board.fillStyle(0x2a2418, 1);
    this.board.fillRect(bx - pad, by - pad, boxW + pad * 2, boxH + pad * 2);
    for (let y = 0; y < boxH; y += cell) {
      for (let x = 0; x < boxW; x += cell) {
        if (((((x / cell) | 0) + ((y / cell) | 0)) & 1) === 1) this.board.fillStyle(0x3a3428, 1);
        else this.board.fillStyle(0x241e16, 1);
        this.board.fillRect(bx + x, by + y, Math.min(cell, boxW - x), Math.min(cell, boxH - y));
      }
    }
    this.board.lineStyle(1, 0xe8b84a, 0.55);
    this.board.strokeRect(bx - pad, by - pad, boxW + pad * 2, boxH + pad * 2);

    this.overlay.clear();
    if (e.cat !== "fx") {
      this.drawShotMarks(rot);
      // Rough blast ring at preview zoom (blast is world units).
      const blast = parseBlast(e);
      if (blast > 0) {
        this.overlay.lineStyle(1.2, 0xff6a22, 0.65);
        this.overlay.strokeCircle(cx, cy, blast * s * 0.35);
      }
    }
  }

  /** Center (cyan) + tip-biased origin (gold) on projectile art. */
  private drawShotMarks(rot: number): void {
    const spr = this.preview;
    const uv = (u: number, v: number) => {
      const mx = (u - spr.originX) * spr.displayWidth;
      const my = (v - spr.originY) * spr.displayHeight;
      const ca = Math.cos(rot);
      const sa = Math.sin(rot);
      return { x: spr.x + mx * ca - my * sa, y: spr.y + mx * sa + my * ca };
    };
    const g = this.overlay;
    const c = uv(SHOT_CENTER.x, SHOT_CENTER.y);
    g.lineStyle(1.25, CENTER_COLOR, 0.9);
    g.lineBetween(c.x - 10, c.y, c.x + 10, c.y);
    g.lineBetween(c.x, c.y - 10, c.x, c.y + 10);
    g.strokeCircle(c.x, c.y, 4);

    const o = uv(SHOT_ORIGIN.x, SHOT_ORIGIN.y);
    g.lineStyle(1.5, ORIGIN_COLOR, 0.95);
    g.lineBetween(o.x - 14, o.y, o.x + 14, o.y);
    g.lineBetween(o.x, o.y - 14, o.x, o.y + 14);
    g.strokeCircle(o.x, o.y, 6);
  }
}

function parseBlast(e: CombatEntry): number {
  for (const line of e.stats) {
    const m = line.match(/\bblast:\s*(\d+(?:\.\d+)?)/i);
    if (m) return Number(m[1]);
  }
  return 0;
}

function shotLayoutDump(): string[] {
  return dumpConfig({
    center: { x: SHOT_CENTER.x, y: SHOT_CENTER.y },
    origin: { x: SHOT_ORIGIN.x, y: SHOT_ORIGIN.y },
  });
}

export function buildCombatCatalog(): CombatEntry[] {
  return [...playerEntries(), ...presetEntries(), ...fxEntries()];
}

function playerEntries(): CombatEntry[] {
  return Object.values(PLAYER_WPNS).map((w) => {
    const block = formatPlayer(w);
    return {
      id: `player_${w.id}`,
      cat: "player" as const,
      label: w.name,
      tag: "PLY",
      tex: w.look,
      rotOff: 0,
      stats: block.stats,
      info: block.info,
    };
  });
}

function formatPlayer(w: PlayerWpnSpec): { stats: string[]; info: string[] } {
  const info = [...w.notes.map((n) => `· ${n}`), "source: combat.ts PLAYER_WPNS / SHOT_ORIGIN"];
  if (w.kind === "hellfire" || w.kind === "tow") {
    info.push(
      `MISSILE_IGNITE ${MISSILE_IGNITE}`,
      `HELLFIRE_LOCK_T ${HELLFIRE_LOCK_T}`,
      `HELLFIRE_SEEK_DELAY ${HELLFIRE_SEEK_DELAY}`
    );
  }
  return {
    stats: [...dumpConfig(w, { skip: ["notes"] }), ...shotLayoutDump()],
    info,
  };
}

/** Shared enemy weapon tables — not per-unit SPECS copies. */
function presetEntries(): CombatEntry[] {
  return ENEMY_WPNS.map((p) => {
    const uses = usesOfWeapon(p.w);
    return {
      id: `preset_${p.id}`,
      cat: "preset" as const,
      label: p.label,
      tag: "PRE",
      tex: p.w.look,
      rotOff: 0,
      stats: [...dumpConfig({ id: p.id, label: p.label, ...p.w }), ...shotLayoutDump()],
      info: [
        uses.length ? `used by: ${uses.join(" · ")}` : "used by: —",
        "source: roster.ts ENEMY_WPNS / SPECS / usesOfWeapon",
        "origin: combat.ts SHOT_ORIGIN",
      ],
    };
  });
}

/** FX sheets + blast stamps from sprites.ts bake tables — no hand-maintained encyclopedia. */
function fxEntries(): CombatEntry[] {
  const sheets: CombatEntry[] = FX_KINDS.map((kind) => fxSheetEntry(kind));
  sheets.push({
    id: "fx_blast",
    cat: "fx",
    label: "BLAST STAMP",
    tag: "FX",
    tex: "fx_blast_0",
    stats: dumpConfig({
      kind: "blast",
      tex: `fx_blast_0..${FX_BLAST_CELLS - 1}`,
      cells: FX_BLAST_CELLS,
      bake: "fit 88 from src_blasts 2×2",
    }),
    info: ["source: sprites.ts prepareArt / src_blasts"],
  });
  return sheets;
}

function fxSheetEntry(kind: FxKind): CombatEntry {
  const key = `fx_${kind}`;
  return {
    id: key,
    cat: "fx",
    label: kind.toUpperCase(),
    tag: "FX",
    tex: key,
    frames: FX_VARIANTS,
    stats: dumpConfig({
      kind,
      tex: key,
      frames: FX_VARIANTS,
      bake: FX_SHEET_SIZE[kind],
      src: `src_fx_${kind}_0..${FX_VARIANTS - 1}`,
    }),
    info: ["source: sprites.ts FX_KINDS / putFxSheet"],
  };
}
