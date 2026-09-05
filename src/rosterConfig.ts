import Phaser from "phaser";
import {
  allCraftIds,
  craftDmgPois,
  craftGunMount,
  craftGunOrigin,
  craftId,
  craftMountsOf,
  craftOf,
  craftOrigin,
  craftSecondaryMounts,
  type CraftId,
  type CraftSpec,
} from "./craft";
import {
  allKinds,
  hullMountsOf,
  HULL_MOUNT_COLOR,
  isAerial,
  isBuilding,
  isGroundVehicle,
  isInfantry,
  isWaterCraft,
  labelOf,
  specOf,
  TROOP_WEIGHTS,
  type UnitKind,
  type UnitSpec,
  type WeaponSpec,
} from "./roster";
import { lookupSpriteMuzzles } from "./spriteOrigin";
import { nameGameTexture, spritePivot } from "./sprites";
import {
  CFG_INFO,
  CFG_LIVE,
  CFG_VALUE,
  dumpConfig,
  formatRotOff,
  makeConfigText,
  setStackedTexts,
} from "./configUi";

const DEPTH = 9250;
const MONO = "Share Tech Mono, monospace";
const GOLD = "#e8b84a";

const LIST_X = 16;
const LIST_Y = 40;
const LIST_W = 268;
const STATS_W = 400;
const LINE_H = 16;
const PART_SLOTS = 10;
const LABEL_SLOTS = 16;
const SHOT_SLOTS = 4;

type Filter = "all" | "ground" | "air" | "water" | "building" | "troop";
const FILTERS: Filter[] = ["all", "ground", "air", "water", "building", "troop"];

const ORIGIN_COLOR = 0xe8b84a;

/** Roster list row — playable craft or enemy unit. */
type RosterEntry = { cat: "craft"; id: CraftId } | { cat: "unit"; id: UnitKind };

/**
 * Lazy debug browser for CRAFTS + SPECS — list, live preview (hull + parts),
 * and a stats dump from the real craft / unit sources.
 */
export class RosterConfigTool {
  open = false;
  private built = false;
  private scene: Phaser.Scene;
  private idx = 0;
  private filter: Filter = "all";
  private zoom = 2;
  /** Radius / height / mount / muzzle overlay markers. */
  private showMarks = true;
  private pinned: { uvx: number; uvy: number } | null = null;
  private copied = "";
  private statsXY = { x: 0, y: 0 };
  private pendingStats: string[] = [];
  private pendingInfo: string[] = [];
  root: Phaser.GameObjects.Container;
  private dim!: Phaser.GameObjects.Rectangle;
  private board!: Phaser.GameObjects.Graphics;
  private hull!: Phaser.GameObjects.Image;
  private parts: Phaser.GameObjects.Image[] = [];
  private shots: Phaser.GameObjects.Image[] = [];
  private overlay!: Phaser.GameObjects.Graphics;
  private listTxt!: Phaser.GameObjects.Text;
  private statsTxt!: Phaser.GameObjects.Text;
  private liveTxt!: Phaser.GameObjects.Text;
  private infoTxt!: Phaser.GameObjects.Text;
  private hintTxt!: Phaser.GameObjects.Text;
  private mountLabels: Phaser.GameObjects.Text[] = [];
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
    this.hull = scene.add
      .image(0, 0, "__DEFAULT")
      .setName("ui_roster_hull")
      .setScrollFactor(0)
      .setDepth(DEPTH + 2)
      .setVisible(false);
    for (let i = 0; i < PART_SLOTS; i++) {
      const im = scene.add
        .image(0, 0, "__DEFAULT")
        .setName(`ui_roster_part_${i}`)
        .setScrollFactor(0)
        .setDepth(DEPTH + 3)
        .setVisible(false);
      this.parts.push(im);
    }
    for (let i = 0; i < SHOT_SLOTS; i++) {
      const im = scene.add
        .image(0, 0, "__DEFAULT")
        .setName(`ui_roster_shot_${i}`)
        .setScrollFactor(0)
        .setDepth(DEPTH + 3)
        .setVisible(false);
      this.shots.push(im);
    }
    this.overlay = scene.add.graphics().setScrollFactor(0).setDepth(DEPTH + 4).setVisible(false);
    this.listTxt = makeConfigText(scene, DEPTH + 5, { fontSize: "13px", lineSpacing: 3, color: CFG_VALUE });
    this.listTxt.setPosition(LIST_X, LIST_Y);
    this.statsTxt = makeConfigText(scene, DEPTH + 5, { fontSize: "12px", lineSpacing: 4, color: CFG_VALUE, wrapW: STATS_W - 8 });
    this.liveTxt = makeConfigText(scene, DEPTH + 5, { fontSize: "12px", lineSpacing: 4, color: CFG_LIVE, wrapW: STATS_W - 8 });
    this.infoTxt = makeConfigText(scene, DEPTH + 5, { fontSize: "12px", lineSpacing: 4, color: CFG_INFO, wrapW: STATS_W - 8 });
    this.hintTxt = scene.add
      .text(18, 14, "", { fontFamily: MONO, fontSize: "12px", color: GOLD })
      .setScrollFactor(0)
      .setDepth(DEPTH + 5)
      .setVisible(false);
    nameGameTexture(scene, this.listTxt, "ui_roster_list");
    nameGameTexture(scene, this.statsTxt, "ui_roster_stats");
    nameGameTexture(scene, this.liveTxt, "ui_roster_live");
    nameGameTexture(scene, this.infoTxt, "ui_roster_info");
    nameGameTexture(scene, this.hintTxt, "ui_roster_hint");
    for (let i = 0; i < LABEL_SLOTS; i++) {
      const t = scene.add
        .text(0, 0, "", {
          fontFamily: MONO,
          fontSize: "11px",
          color: "#c8ffc8",
          stroke: "#0c0a08",
          strokeThickness: 3,
        })
        .setScrollFactor(0)
        .setDepth(DEPTH + 6)
        .setVisible(false);
      nameGameTexture(scene, t, `ui_roster_mount_${i}`);
      this.mountLabels.push(t);
    }
    this.root.add([
      this.dim,
      this.board,
      this.hull,
      ...this.parts,
      ...this.shots,
      this.overlay,
      this.listTxt,
      this.statsTxt,
      this.liveTxt,
      this.infoTxt,
      this.hintTxt,
      ...this.mountLabels,
    ]);

    this.uiCam = scene.cameras.add(0, 0, w, h, false, "rosterRig");
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
        this.pinned = null;
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
      if (p.x >= LIST_X && p.x < LIST_X + LIST_W) {
        this.pickFromList(p.y);
        return;
      }
      const uv = this.uvAt(p);
      if (!uv) return;
      this.pinned = uv;
      const entries = this.entries();
      const ent = entries[this.idx];
      const tex = ent
        ? ent.cat === "craft"
          ? craftOf(ent.id).body
          : specOf(ent.id).texture
        : "";
      this.copied = `${tex} ${uv.uvx.toFixed(3)} ${uv.uvy.toFixed(3)}  px ${uv.px.toFixed(1)} ${uv.py.toFixed(1)}`;
      copyText(this.copied);
    });

    this.onBuilt?.(this.root);
  }

  toggle(): void {
    this.ensureBuilt();
    this.open = !this.open;
    this.root.setVisible(this.open);
    this.dim.setVisible(this.open);
    this.board.setVisible(this.open);
    this.hull.setVisible(this.open);
    this.overlay.setVisible(this.open);
    this.listTxt.setVisible(this.open);
    this.statsTxt.setVisible(this.open);
    this.liveTxt.setVisible(this.open);
    this.infoTxt.setVisible(this.open);
    this.hintTxt.setVisible(this.open);
    this.scene.input.setDefaultCursor(this.open ? "default" : "none");
    this.uiCam.setVisible(this.open);
    if (this.open) this.refreshPreview();
    else {
      this.overlay.clear();
      for (const p of this.parts) p.setVisible(false);
      for (const s of this.shots) s.setVisible(false);
      for (const t of this.mountLabels) t.setVisible(false);
    }
  }

  cycle(dir: number): void {
    if (!this.open) return;
    const n = this.entries().length;
    if (!n) return;
    this.idx = (this.idx + dir + n) % n;
    this.pinned = null;
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
    this.pinned = null;
    this.refreshPreview();
  }

  page(dir: number): void {
    if (!this.open) return;
    const entries = this.entries();
    const size = this.pageSize();
    const pages = Math.max(1, Math.ceil(entries.length / size));
    const next = (((this.pageOf(this.idx) + dir) % pages) + pages) % pages;
    this.idx = Math.min(entries.length - 1, next * size);
    this.pinned = null;
    this.refreshPreview();
  }

  pickFromList(py: number): void {
    if (!this.open) return;
    const entries = this.entries();
    const size = this.pageSize();
    const row = Math.floor((py - LIST_Y) / LINE_H) - 1;
    if (row < 0 || row >= size) return;
    const i = this.pageOf(this.idx) * size + row;
    if (i < 0 || i >= entries.length) return;
    this.idx = i;
    this.pinned = null;
    this.refreshPreview();
  }

  update(): void {
    if (!this.open) return;
    const entries = this.entries();
    if (!entries.length) return;
    if (this.idx >= entries.length) this.idx = 0;
    const ent = entries[this.idx]!;

    this.hintTxt.setText(
      `ROSTER RIG   \` cycle / close   [ ] cycle   , . page   - + zoom ${fmtZoom(this.zoom)}   G filter ${this.filter.toUpperCase()}   O marks ${this.showMarks ? "ON" : "OFF"}   gold origin · green gun · cyan rotor/radius · violet troop/leash · orange secondary/muzzle`
    );

    const size = this.pageSize();
    const pages = Math.max(1, Math.ceil(entries.length / size));
    const page = this.pageOf(this.idx);
    const start = page * size;
    const slice = entries.slice(start, start + size);
    const totalN = allCraftIds().length + allKinds().length;
    this.listTxt.setText(
      [
        `— ${this.filter.toUpperCase()}  ${page + 1} / ${pages}  (${entries.length}/${totalN}) —`,
        ...slice.map((e, i) => {
          const mark = start + i === this.idx ? "▸" : " ";
          if (e.cat === "craft") {
            const c = craftOf(e.id);
            const active = e.id === craftId() ? " ★" : "";
            return `${mark} ${c.label.padEnd(16)} PLY${active}`;
          }
          return `${mark} ${labelOf(e.id).padEnd(16)} ${categoryTag(e.id)}`;
        }),
      ].join("\n")
    );

    if (ent.cat === "craft") this.layoutCraftPreview(craftOf(ent.id));
    else this.layoutPreview(ent.id, specOf(ent.id));
    this.scene.input.setDefaultCursor(this.uvAt(this.scene.input.activePointer) ? "crosshair" : "default");
  }

  private pageSize(): number {
    return Math.max(8, Math.floor((this.scene.scale.height - LIST_Y - 28) / LINE_H) - 1);
  }

  private pageOf(idx: number): number {
    return Math.floor(idx / this.pageSize());
  }

  private entries(): RosterEntry[] {
    const crafts: RosterEntry[] =
      this.filter === "all" || this.filter === "air"
        ? allCraftIds().map((id) => ({ cat: "craft" as const, id }))
        : [];
    const units: RosterEntry[] = allKinds()
      .filter((k) => matchesFilter(k, this.filter))
      .map((id) => ({ cat: "unit" as const, id }));
    return [...crafts, ...units];
  }

  private refreshPreview(): void {
    if (!this.open || !this.built) return;
    this.update();
  }

  private layoutCraftPreview(craft: CraftSpec): void {
    const w = this.scene.scale.width;
    const h = this.scene.scale.height;
    const tex = craft.body;
    const listRight = LIST_X + LIST_W + 20;
    const gap = 28;
    const block = formatCraft(craft);
    this.pendingStats = block.stats;
    this.pendingInfo = block.info;

    if (!this.scene.textures.exists(tex)) {
      this.hull.setVisible(false);
      for (const p of this.parts) p.setVisible(false);
      for (const s of this.shots) s.setVisible(false);
      this.board.clear();
      this.overlay.clear();
      for (const t of this.mountLabels) t.setVisible(false);
      this.statsXY = { x: listRight, y: LIST_Y };
      this.applyStatsPanel(tex);
      return;
    }

    this.hull.setVisible(true).setTexture(tex);
    const pivot = { ...craftOrigin(craft) };
    this.hull.setOrigin(pivot.x, pivot.y);
    const s = this.zoom;
    this.hull.setScale(s);
    this.hull.setRotation(craft.rotOff);

    const bw = this.hull.displayWidth;
    const bh = this.hull.displayHeight;
    const cos = Math.abs(Math.cos(craft.rotOff));
    const sin = Math.abs(Math.sin(craft.rotOff));
    const boxW = bw * cos + bh * sin;
    const boxH = bw * sin + bh * cos;
    const pad = 10;
    const cx = listRight + pad + boxW * 0.5;
    const cy = Math.min(LIST_Y + pad + boxH * 0.5, h - pad - boxH * 0.5);
    this.hull.setPosition(cx, cy);

    const bx = cx - boxW * 0.5;
    const by = cy - boxH * 0.5;
    const statsX = Math.min(bx + boxW + gap, w - STATS_W - 16);
    this.statsXY = { x: statsX, y: Math.max(LIST_Y, by) };
    this.applyStatsPanel(tex);

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

    let pi = 0;
    const place = (
      part: Phaser.GameObjects.Image,
      partTex: string,
      origin: { x: number; y: number },
      mount: { x: number; y: number },
      worldRot: number,
      sc = 1
    ) => {
      if (!this.scene.textures.exists(partTex)) {
        part.setVisible(false);
        return;
      }
      const mx = (mount.x - pivot.x) * this.hull.displayWidth;
      const my = (mount.y - pivot.y) * this.hull.displayHeight;
      const ca = Math.cos(craft.rotOff);
      const sa = Math.sin(craft.rotOff);
      part
        .setVisible(true)
        .setTexture(partTex)
        .setOrigin(origin.x, origin.y)
        .setPosition(cx + mx * ca - my * sa, cy + mx * sa + my * ca)
        .setRotation(worldRot)
        .setScale(s * sc);
    };

    const gunPart = this.parts[pi++];
    if (gunPart) place(gunPart, craft.gun, craftGunOrigin(craft), craftGunMount(craft), Math.PI / 2, 1);
    const rotorPart = this.parts[pi++];
    if (rotorPart) {
      const spinKey = "heli_rotor_spin";
      const rotorKey = this.scene.textures.exists(spinKey) ? spinKey : "heli_rotor";
      place(rotorPart, rotorKey, { x: 0.5, y: 0.5 }, craftOrigin(craft), 0, 1);
    }
    for (; pi < this.parts.length; pi++) this.parts[pi]!.setVisible(false);
    for (const im of this.shots) im.setVisible(false);

    this.drawHullMarks({
      radius: craft.radius,
      height: craft.height,
      rotOff: craft.rotOff,
      mounts: craftMountsOf(craft),
      pivot,
      cx,
      cy,
      s,
      guns: [{ tex: craft.gun, origin: craftGunOrigin(craft), mount: craftGunMount(craft), scale: 1 }],
    });
  }

  private layoutPreview(kind: UnitKind, sp: UnitSpec): void {
    const w = this.scene.scale.width;
    const h = this.scene.scale.height;
    const tex = sp.texture;
    const listRight = LIST_X + LIST_W + 20;
    const gap = 28;

    if (!this.scene.textures.exists(tex)) {
      this.hull.setVisible(false);
      for (const p of this.parts) p.setVisible(false);
      for (const s of this.shots) s.setVisible(false);
      this.board.clear();
      this.overlay.clear();
      for (const t of this.mountLabels) t.setVisible(false);
      const block = formatSpec(kind, sp);
      this.statsXY = { x: listRight, y: LIST_Y };
      this.pendingStats = block.stats;
      this.pendingInfo = block.info;
      this.applyStatsPanel(tex);
      return;
    }

    this.hull.setVisible(true).setTexture(tex);
    const pivot = spritePivot(tex);
    this.hull.setOrigin(pivot.x, pivot.y);
    const s = this.zoom;
    this.hull.setScale(s);
    this.hull.setRotation(sp.rotOff);

    const bw = this.hull.displayWidth;
    const bh = this.hull.displayHeight;
    const cos = Math.abs(Math.cos(sp.rotOff));
    const sin = Math.abs(Math.sin(sp.rotOff));
    const boxW = bw * cos + bh * sin;
    const boxH = bw * sin + bh * cos;
    const pad = 10;
    const cx = listRight + pad + boxW * 0.5;
    const cy = Math.min(LIST_Y + pad + boxH * 0.5, h - pad - boxH * 0.5);
    this.hull.setPosition(cx, cy);

    const bx = cx - boxW * 0.5;
    const by = cy - boxH * 0.5;
    const statsX = Math.min(bx + boxW + gap, w - STATS_W - 16);
    const block = formatSpec(kind, sp);
    this.statsXY = { x: statsX, y: Math.max(LIST_Y, by) };
    this.pendingStats = block.stats;
    this.pendingInfo = block.info;
    this.applyStatsPanel(tex);

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

    let pi = 0;
    const place = (
      part: Phaser.GameObjects.Image,
      partTex: string,
      origin: { x: number; y: number },
      mount: { x: number; y: number },
      worldRot: number,
      sc = 1
    ) => {
      if (!this.scene.textures.exists(partTex)) {
        part.setVisible(false);
        return;
      }
      const mx = (mount.x - pivot.x) * this.hull.displayWidth;
      const my = (mount.y - pivot.y) * this.hull.displayHeight;
      const ca = Math.cos(sp.rotOff);
      const sa = Math.sin(sp.rotOff);
      part
        .setVisible(true)
        .setTexture(partTex)
        .setOrigin(origin.x, origin.y)
        .setPosition(cx + mx * ca - my * sa, cy + mx * sa + my * ca)
        .setRotation(worldRot)
        .setScale(s * sc);
    };

    for (const g of sp.guns) {
      const part = this.parts[pi++];
      if (!part) break;
      place(part, g.tex, g.origin, g.mount, Math.PI / 2, g.scale ?? 1);
    }
    for (const r of sp.rotors) {
      const part = this.parts[pi++];
      if (!part) break;
      const spinKey = `${r.tex}_spin`;
      const rotorKey =
        r.tex !== "enemy_drone_rotor" && this.scene.textures.exists(spinKey) ? spinKey : r.tex;
      place(part, rotorKey, r.origin, r.mount, 0, r.scale ?? 1);
    }
    if (sp.dish) {
      const part = this.parts[pi++];
      if (part) {
        const d = sp.dish;
        place(part, d.tex, d.origin, d.mount, 0, (d.scale ?? 1) * 1.04);
        part.setScale(part.scaleX, part.scaleY * 0.52);
      }
    }
    for (; pi < this.parts.length; pi++) this.parts[pi]!.setVisible(false);

    // Projectile previews for body + gun weapons (stats live on this unit).
    const wpns: WeaponSpec[] = [];
    if (sp.weapon) wpns.push(sp.weapon);
    for (const g of sp.guns) {
      if (g.weapon) wpns.push(g.weapon);
    }
    const shotGap = 12;
    let shotX = bx;
    const shotY = by + boxH + pad + 22;
    for (let i = 0; i < this.shots.length; i++) {
      const im = this.shots[i]!;
      const wpn = wpns[i];
      if (!wpn) {
        im.setVisible(false);
        continue;
      }
      const key = wpn.look;
      if (!this.scene.textures.exists(key)) {
        im.setVisible(false);
        continue;
      }
      im.setVisible(true).setTexture(key).setOrigin(0.5, 0.5);
      const sc = Math.min(2.5, (36 * this.zoom) / Math.max(im.width, im.height, 1));
      im.setScale(sc)
        .setRotation(0)
        .setPosition(shotX + Math.max(im.displayWidth, 28) * 0.5, shotY);
      shotX += Math.max(im.displayWidth, 28) + shotGap;
    }

    this.drawHullMarks({
      radius: sp.radius,
      height: sp.height,
      rotOff: sp.rotOff,
      mounts: hullMountsOf(sp),
      leashR: sp.crew?.mode === "leash" ? (sp.crew.leashR ?? sp.radius) : undefined,
      pivot,
      cx,
      cy,
      s,
      guns: sp.guns,
    });
  }

  private applyStatsPanel(tex: string): void {
    const origin = spritePivot(tex);
    const tw = this.hull.visible && this.hull.width ? this.hull.width : 1;
    const th = this.hull.visible && this.hull.height ? this.hull.height : 1;
    const uv = this.uvAt(this.scene.input.activePointer);
    const live = dumpConfig({
      cursor: uv
        ? {
            uv: { x: uv.uvx, y: uv.uvy },
            px: { x: uv.px, y: uv.py },
            fromOrigin: {
              x: (uv.uvx - origin.x) * tw,
              y: (uv.uvy - origin.y) * th,
            },
          }
        : "off board",
      pin: this.pinned
        ? { uv: { x: this.pinned.uvx, y: this.pinned.uvy }, copied: this.copied || "—" }
        : "click hull to copy name / uv / px",
    });
    setStackedTexts(
      [
        { txt: this.statsTxt, lines: this.pendingStats },
        { txt: this.liveTxt, lines: live },
        { txt: this.infoTxt, lines: this.pendingInfo },
      ],
      this.statsXY.x,
      this.statsXY.y
    );
  }

  private uvAt(p: Phaser.Input.Pointer): { uvx: number; uvy: number; px: number; py: number } | null {
    if (!this.hull.visible || !this.hull.width || !this.hull.height) return null;
    const lp = this.hull.getLocalPoint(p.x, p.y, undefined, this.uiCam);
    if (lp.x < -0.5 || lp.y < -0.5 || lp.x > this.hull.width + 0.5 || lp.y > this.hull.height + 0.5) {
      return null;
    }
    const px = lp.x;
    const py = lp.y;
    return { uvx: px / this.hull.width, uvy: py / this.hull.height, px, py };
  }

  private drawHullMarks(opts: {
    radius: number;
    height: number;
    rotOff: number;
    mounts: ReturnType<typeof hullMountsOf>;
    leashR?: number;
    pivot: { x: number; y: number };
    cx: number;
    cy: number;
    s: number;
    guns: {
      tex: string;
      origin: { x: number; y: number };
      mount: { x: number; y: number };
      scale?: number;
      muzzle?: { x: number; y: number };
      muzzles?: { x: number; y: number }[];
    }[];
  }): void {
    const g = this.overlay;
    g.clear();
    for (const t of this.mountLabels) t.setVisible(false);

    const hullDw = this.hull.displayWidth;
    const hullDh = this.hull.displayHeight;
    const rot = opts.rotOff;
    const pivot = opts.pivot;
    const { cx, cy, s } = opts;
    const hullUv = (u: number, v: number) => {
      const mx = (u - pivot.x) * hullDw;
      const my = (v - pivot.y) * hullDh;
      const ca = Math.cos(rot);
      const sa = Math.sin(rot);
      return { x: cx + mx * ca - my * sa, y: cy + mx * sa + my * ca };
    };

    if (this.pinned) {
      const p = hullUv(this.pinned.uvx, this.pinned.uvy);
      g.fillStyle(0xff3a2a, 1);
      g.fillCircle(p.x, p.y, 4);
      g.lineStyle(1, 0xffffff, 0.9);
      g.strokeCircle(p.x, p.y, 4);
    }

    if (!this.showMarks) return;

    g.lineStyle(1.5, 0x5ec8ff, 0.55);
    g.strokeCircle(cx, cy, opts.radius * s);
    if (opts.leashR != null) {
      g.lineStyle(2.25, HULL_MOUNT_COLOR.troop, 0.85);
      g.strokeCircle(cx, cy, opts.leashR * s);
    }
    g.lineStyle(1.2, 0x6dbb4a, 0.55);
    g.lineBetween(cx, cy, cx, cy - opts.height * s);

    g.lineStyle(1.5, ORIGIN_COLOR, 0.95);
    g.lineBetween(cx - 14, cy, cx + 14, cy);
    g.lineBetween(cx, cy - 14, cx, cy + 14);
    g.strokeCircle(cx, cy, 5);

    const mounts = opts.mounts;

    for (let i = 0; i < this.mountLabels.length; i++) {
      const lab = this.mountLabels[i]!;
      const m = mounts[i];
      if (!m) {
        lab.setVisible(false);
        continue;
      }
      const p = hullUv(m.x, m.y);
      const color = HULL_MOUNT_COLOR[m.role];
      g.fillStyle(color, 0.95);
      g.fillRect(p.x - 4, p.y - 4, 8, 8);
      g.lineStyle(1, 0x101010, 0.9);
      g.strokeRect(p.x - 4, p.y - 4, 8, 8);
      lab.setText(m.label);
      lab.setColor(hexColor(color));
      lab.setPosition(p.x + 7, p.y - 8);
      lab.setVisible(true);
    }

    for (const gun of opts.guns) {
      const muzzles = gun.muzzles?.length
        ? gun.muzzles
        : gun.muzzle
          ? [gun.muzzle]
          : lookupSpriteMuzzles(gun.tex);
      if (!muzzles.length || !this.scene.textures.exists(gun.tex)) continue;
      const gunSc = s * (gun.scale ?? 1);
      const img = this.scene.textures.get(gun.tex).get();
      const gdw = img.width * gunSc;
      const gdh = img.height * gunSc;
      const gunPos = hullUv(gun.mount.x, gun.mount.y);
      const gunRot = Math.PI / 2;
      for (const muz of muzzles) {
        const lx = (muz.x - gun.origin.x) * gdw;
        const ly = (muz.y - gun.origin.y) * gdh;
        const ca = Math.cos(gunRot);
        const sa = Math.sin(gunRot);
        const x = gunPos.x + lx * ca - ly * sa;
        const y = gunPos.y + lx * sa + ly * ca;
        g.fillStyle(0xff7a2a, 0.95);
        g.fillCircle(x, y, 5);
        g.lineStyle(1.25, 0xffe8c0, 0.95);
        g.strokeCircle(x, y, 5);
      }
    }
  }
}

function copyText(text: string): void {
  if (navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    return;
  }
  fallbackCopy(text);
}

function fallbackCopy(text: string): void {
  const el = document.createElement("textarea");
  el.value = text;
  el.setAttribute("readonly", "");
  el.style.position = "fixed";
  el.style.left = "-9999px";
  document.body.appendChild(el);
  el.select();
  try {
    document.execCommand("copy");
  } catch {
    /* ignore */
  }
  document.body.removeChild(el);
}

function hexColor(n: number): string {
  return `#${n.toString(16).padStart(6, "0")}`;
}

function fmtZoom(z: number): string {
  return `${z}×`;
}

function matchesFilter(kind: UnitKind, filter: Filter): boolean {
  if (filter === "all") return true;
  if (filter === "building") return isBuilding(kind);
  if (filter === "troop") return isInfantry(kind);
  if (filter === "air") return isAerial(kind);
  if (filter === "water") return isWaterCraft(kind);
  if (filter === "ground") {
    return isGroundVehicle(kind) || (specOf(kind).move === "tank" && !isBuilding(kind));
  }
  return true;
}

function categoryTag(kind: UnitKind): string {
  const sp = specOf(kind);
  if (sp.building) return "BLD";
  if (sp.organic) return "INF";
  if (sp.aerial) return "AIR";
  if (sp.water) return "SEA";
  if (isGroundVehicle(kind) || sp.move === "tank") return "VEH";
  return sp.move.slice(0, 3).toUpperCase();
}

function formatCraft(craft: CraftSpec): { stats: string[]; info: string[] } {
  const selected = craft.id === craftId();
  const gunMounts = (() => {
    try {
      return craftGunMount(craft);
    } catch {
      return undefined;
    }
  })();
  const stats = [
    ...dumpConfig(craft, { format: formatRotOff }),
    ...dumpConfig({
      selected: selected ? "yes ★" : "no",
      origin: craftOrigin(craft),
      ...(gunMounts ? { gunMount: gunMounts } : {}),
      gunOrigin: craftGunOrigin(craft),
      dmgPois: craftDmgPois(craft),
      secondaryMounts: craftSecondaryMounts(craft),
    }),
  ];
  return {
    stats,
    info: [
      "source: craft.ts CRAFTS",
      "select via selectCraft(id) — Heli / scenes read craftOf()",
    ],
  };
}

function formatSpec(kind: UnitKind, sp: UnitSpec): { stats: string[]; info: string[] } {
  const info = ["source: roster.ts SPECS + craft.ts CRAFTS (partsRoll / crew / drive / secondary)"];
  if (sp.crew?.mounts.length) {
    const total = TROOP_WEIGHTS.reduce((s, [, w]) => s + w, 0);
    info.push(`pickTroop n=${TROOP_WEIGHTS.length}`);
    for (const [k, w] of TROOP_WEIGHTS) {
      info.push(`· ${k} ${Math.round((w / total) * 100)}% (w: ${w})`);
    }
  }
  return {
    stats: dumpConfig({ kind, ...sp }, { format: formatRotOff }),
    info,
  };
}
