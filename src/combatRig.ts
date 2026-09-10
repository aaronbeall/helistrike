import Phaser from "phaser";
import {
  HELLFIRE_LOCK_T,
  HELLFIRE_SEEK_DELAY,
  MISSILE_IGNITE,
  PLAYER_WPNS,
  SHOT_ORIGIN,
  SHOT_TAIL,
  type PlayerWpnSpec,
} from "./combat";
import { allCrafts } from "./craft";
import { ENEMY_WPNS, usesOfWeapon } from "./roster";
import { RIG_INFO, RIG_VALUE, dumpRig, makeRigText, setStatsAndInfo } from "./rigUi";
import { lookupSpriteMuzzles, lookupSpriteOrigin } from "./spriteOrigin";
import {
  TOON_BLAST_FRAMES,
  TOON_BLAST_KEY,
  TOON_BLAST_SIZE,
  TOON_BLAST_VARIANTS,
  toonBlastKey,
} from "./toonBlast";
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
const PAPER = RIG_VALUE;
const ORIGIN_COLOR = 0xe8b84a;
const TAIL_COLOR = 0xff6a40;
const MUZZLE_COLOR = 0xff7a2a;

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
  /** Optional gun-mount body texture (player cannons). */
  mountTex?: string;
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
export class CombatRig {
  open = false;
  private built = false;
  private scene: Phaser.Scene;
  private idx = 0;
  private filter: Filter = "all";
  private zoom = 2;
  private frameT = 0;
  private showMarks = true;
  private entries: CombatEntry[] = [];
  root: Phaser.GameObjects.Container;
  private dim!: Phaser.GameObjects.Rectangle;
  private board!: Phaser.GameObjects.Graphics;
  private preview!: Phaser.GameObjects.Image;
  private mountPreview!: Phaser.GameObjects.Image;
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
      .setName("rig_combat_preview")
      .setScrollFactor(0)
      .setDepth(DEPTH + 2)
      .setVisible(false);
    this.mountPreview = scene.add
      .image(0, 0, "__DEFAULT")
      .setName("rig_combat_mount")
      .setScrollFactor(0)
      .setDepth(DEPTH + 2)
      .setVisible(false);
    this.overlay = scene.add.graphics().setScrollFactor(0).setDepth(DEPTH + 3).setVisible(false);
    this.listTxt = makeRigText(scene, DEPTH + 4, { fontSize: "13px", lineSpacing: 3, color: PAPER });
    this.listTxt.setPosition(LIST_X, LIST_Y);
    this.statsTxt = makeRigText(scene, DEPTH + 4, { fontSize: "12px", lineSpacing: 4, color: PAPER, wrapW: STATS_W - 8 });
    this.infoTxt = makeRigText(scene, DEPTH + 4, { fontSize: "12px", lineSpacing: 4, color: RIG_INFO, wrapW: STATS_W - 8 });
    this.hintTxt = scene.add
      .text(18, 14, "", { fontFamily: MONO, fontSize: "12px", color: GOLD })
      .setScrollFactor(0)
      .setDepth(DEPTH + 4)
      .setVisible(false);
    nameGameTexture(scene, this.listTxt, "rig_combat_list");
    nameGameTexture(scene, this.statsTxt, "rig_combat_stats");
    nameGameTexture(scene, this.infoTxt, "rig_combat_info");
    nameGameTexture(scene, this.hintTxt, "rig_combat_hint");
    this.root.add([
      this.dim,
      this.board,
      this.mountPreview,
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
      kb.addKey(Phaser.Input.Keyboard.KeyCodes.O).on("down", () => {
        if (!this.open) return;
        this.showMarks = !this.showMarks;
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
    this.mountPreview.setVisible(this.open);
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
      `COMBAT RIG   ↑ ↓ select   , . page   - + zoom ${this.zoom}×   G filter ${this.filter.toUpperCase()}   O marks ${this.showMarks ? "ON" : "OFF"}`
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
    const panelGap = 16;
    const pad = 10;
    const s = this.zoom;
    const hasShot = this.scene.textures.exists(e.tex);
    const hasMount = !!(e.mountTex && this.scene.textures.exists(e.mountTex));

    this.board.clear();
    this.overlay.clear();

    if (!hasShot && !hasMount) {
      this.preview.setVisible(false);
      this.mountPreview.setVisible(false);
      setStatsAndInfo(this.statsTxt, this.infoTxt, e.stats, e.info, listRight, LIST_Y);
      return;
    }

    type Panel = { spr: Phaser.GameObjects.Image; boxW: number; boxH: number; rot: number };
    const panels: Panel[] = [];

    if (hasMount) {
      const mountOrigin = lookupSpriteOrigin(e.mountTex!) ?? { x: 0.5, y: 0.7 };
      this.mountPreview.setVisible(true).setTexture(e.mountTex!);
      this.mountPreview.setOrigin(mountOrigin.x, mountOrigin.y);
      this.mountPreview.setScale(s).setRotation(0);
      panels.push({
        spr: this.mountPreview,
        boxW: this.mountPreview.displayWidth,
        boxH: this.mountPreview.displayHeight,
        rot: 0,
      });
    } else {
      this.mountPreview.setVisible(false);
    }

    if (hasShot) {
      const frames = e.frames ?? 1;
      this.preview.setVisible(true).setTexture(e.tex);
      if (frames > 1) {
        this.frameT += dt;
        const fi = Math.floor(this.frameT * 8) % frames;
        if (Number(this.preview.frame.name) !== fi) this.preview.setFrame(fi);
      } else {
        this.preview.setFrame(0);
      }
      this.preview.setOrigin(0.5, 0.5);
      this.preview.setScale(s);
      const rot = e.rotOff ?? (e.cat === "fx" ? 0 : Math.PI / 2);
      this.preview.setRotation(rot);
      const bw = this.preview.displayWidth;
      const bh = this.preview.displayHeight;
      const cos = Math.abs(Math.cos(rot));
      const sin = Math.abs(Math.sin(rot));
      panels.push({
        spr: this.preview,
        boxW: bw * cos + bh * sin,
        boxH: bw * sin + bh * cos,
        rot,
      });
    } else {
      this.preview.setVisible(false);
    }

    const totalW = panels.reduce((sum, p) => sum + p.boxW, 0) + panelGap * (panels.length - 1);
    const maxH = Math.max(...panels.map((p) => p.boxH));
    let x = listRight + pad;
    const cy = Math.min(LIST_Y + pad + maxH * 0.5, h - pad - maxH * 0.5);
    const unionLeft = x;
    const unionTop = cy - maxH * 0.5;

    for (const panel of panels) {
      const cx = x + panel.boxW * 0.5;
      panel.spr.setPosition(cx, cy);
      this.drawCheckerPanel(cx - panel.boxW * 0.5, cy - panel.boxH * 0.5, panel.boxW, panel.boxH, pad);
      x += panel.boxW + panelGap;
    }

    setStatsAndInfo(
      this.statsTxt,
      this.infoTxt,
      e.stats,
      e.info,
      Math.min(unionLeft + totalW + pad + gap, w - STATS_W - 16),
      Math.max(LIST_Y, unionTop)
    );

    if (e.cat !== "fx" && this.showMarks) {
      if (hasShot) {
        const shot = panels[panels.length - 1]!;
        const bx = shot.spr.x - shot.boxW * 0.5;
        const by = shot.spr.y - shot.boxH * 0.5;
        this.drawShotMarks(shot.rot, bx, by, shot.boxW, shot.boxH);
        const blast = parseBlast(e);
        if (blast > 0) {
          this.overlay.lineStyle(1.2, 0xff6a22, 0.65);
          this.overlay.strokeCircle(shot.spr.x, shot.spr.y, blast * s * 0.35);
        }
      }
      if (hasMount) this.drawMountMarks(panels[0]!.spr, e.mountTex!);
    }
  }

  /** Pivot + authored muzzle tips on the gun-mount texture (SPRITE_SPECS). */
  private drawMountMarks(spr: Phaser.GameObjects.Image, tex: string): void {
    const g = this.overlay;
    const toX = (u: number) => spr.x + (u - spr.originX) * spr.displayWidth;
    const toY = (v: number) => spr.y + (v - spr.originY) * spr.displayHeight;
    const origin = lookupSpriteOrigin(tex) ?? { x: 0.5, y: 0.7 };
    const ox = toX(origin.x);
    const oy = toY(origin.y);
    for (const p of lookupSpriteMuzzles(tex)) {
      const x = toX(p.x);
      const y = toY(p.y);
      g.fillStyle(MUZZLE_COLOR, 0.95);
      g.fillCircle(x, y, 5);
      g.lineStyle(1.25, 0xffe8c0, 0.95);
      g.strokeCircle(x, y, 5);
    }
    g.lineStyle(1.5, ORIGIN_COLOR, 0.95);
    g.strokeCircle(ox, oy, 4);
    g.lineBetween(ox - 7, oy, ox + 7, oy);
    g.lineBetween(ox, oy - 7, ox, oy + 7);
  }

  private drawCheckerPanel(bx: number, by: number, boxW: number, boxH: number, pad: number): void {
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
  }

  /** Edge ticks for tip origin / trail tail — no marks over the art. */
  private drawShotMarks(rot: number, bx: number, by: number, boxW: number, boxH: number): void {
    const spr = this.preview;
    const uv = (u: number, v: number) => {
      const mx = (u - spr.originX) * spr.displayWidth;
      const my = (v - spr.originY) * spr.displayHeight;
      const ca = Math.cos(rot);
      const sa = Math.sin(rot);
      return { x: spr.x + mx * ca - my * sa, y: spr.y + mx * sa + my * ca };
    };
    const g = this.overlay;
    const tick = 7;
    const mark = (u: number, v: number, color: number) => {
      const p = uv(u, v);
      const x = Phaser.Math.Clamp(p.x, bx, bx + boxW);
      g.lineStyle(1.5, color, 0.95);
      g.lineBetween(x, by - 1, x, by - 1 - tick);
      g.lineBetween(x, by + boxH + 1, x, by + boxH + 1 + tick);
    };
    mark(SHOT_ORIGIN.x, SHOT_ORIGIN.y, ORIGIN_COLOR);
    mark(SHOT_TAIL.x, SHOT_TAIL.y, TAIL_COLOR);
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
  return dumpRig({
    origin: { x: SHOT_ORIGIN.x, y: SHOT_ORIGIN.y },
    tail: { x: SHOT_TAIL.x, y: SHOT_TAIL.y },
  });
}

/** Read-only gun-mount UV layout from SPRITE_SPECS (edit in the sprite rig). */
function mountLayoutDump(tex: string): string[] {
  const origin = lookupSpriteOrigin(tex) ?? { x: 0.5, y: 0.5 };
  const muzzles = lookupSpriteMuzzles(tex);
  return dumpRig({
    mountOrigin: origin,
    mountMuzzles: muzzles.length ? muzzles : "— (none; runtime gunTip)",
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
      ...(w.mount ? { mountTex: w.mount } : {}),
      rotOff: 0,
      stats: block.stats,
      info: block.info,
    };
  });
}

function craftsUsingWeapon(wpnId: string): string[] {
  return allCrafts()
    .filter((c) => c.sockets.some((s) => s.weapon === wpnId))
    .map((c) => c.name);
}

function formatPlayer(w: PlayerWpnSpec): { stats: string[]; info: string[] } {
  const crafts = craftsUsingWeapon(w.id);
  const info = [
    ...w.notes.map((n) => `· ${n}`),
    crafts.length ? `used by: ${crafts.join(" · ")}` : "used by: —",
    "source: combat.ts PLAYER_WPNS / SHOT_ORIGIN / SHOT_TAIL",
  ];
  if (w.mount) {
    info.push(`mount UVs: spriteOrigin.ts SPRITE_SPECS[${w.mount}] (edit in sprite rig)`);
  }
  if (w.kind === "lock-on-missile" || w.kind === "guided-missile") {
    info.push(
      `MISSILE_IGNITE ${MISSILE_IGNITE}`,
      `HELLFIRE_LOCK_T ${HELLFIRE_LOCK_T}`,
      `HELLFIRE_SEEK_DELAY ${HELLFIRE_SEEK_DELAY}`
    );
  }
  return {
    stats: [
      ...dumpRig(w, { skip: ["notes"] }),
      ...shotLayoutDump(),
      ...(w.mount ? mountLayoutDump(w.mount) : []),
    ],
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
      stats: [...dumpRig({ id: p.id, label: p.label, ...p.w }), ...shotLayoutDump()],
      info: [
        uses.length ? `used by: ${uses.join(" · ")}` : "used by: —",
        "source: roster.ts ENEMY_WPNS / SPECS / usesOfWeapon",
        "origin: combat.ts SHOT_ORIGIN",
        "tail: combat.ts SHOT_TAIL (trail emit)",
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
    stats: dumpRig({
      kind: "blast",
      tex: `fx_blast_0..${FX_BLAST_CELLS - 1}`,
      cells: FX_BLAST_CELLS,
      bake: "fit 88 from src_blasts 2×2",
    }),
    info: ["source: sprites.ts prepareArt / src_blasts"],
  });
  for (let v = 0; v < TOON_BLAST_VARIANTS; v++) {
    const key = toonBlastKey(v);
    sheets.push({
      id: key,
      cat: "fx",
      label: `TOON BLAST ${v + 1}`,
      tag: "FX",
      tex: key,
      frames: TOON_BLAST_FRAMES,
      stats: dumpRig({
        kind: "toon_blast",
        tex: key,
        variant: v,
        variants: TOON_BLAST_VARIANTS,
        frames: TOON_BLAST_FRAMES,
        size: TOON_BLAST_SIZE,
        bake: "cel fire→smoke→dust cluster + cool",
      }),
      info: [
        "source: toonBlast.ts / bakeToonBlast",
        v === 0 ? `alias: ${TOON_BLAST_KEY}` : "unique jitter seed",
      ],
    });
  }
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
    stats: dumpRig({
      kind,
      tex: key,
      frames: FX_VARIANTS,
      bake: FX_SHEET_SIZE[kind],
      src: `src_fx_${kind}_0..${FX_VARIANTS - 1}`,
    }),
    info: ["source: sprites.ts FX_KINDS / putFxSheet"],
  };
}
