import Phaser from "phaser";
import {
  allKinds,
  driveOf,
  isAerial,
  isBuilding,
  isGroundVehicle,
  isInfantry,
  isWaterCraft,
  labelOf,
  specOf,
  type MoveKind,
  type UnitKind,
  type UnitSpec,
  type WeaponSpec,
} from "./roster";
import { nameGameTexture, spritePivot } from "./sprites";

const DEPTH = 9250;
const MONO = "Share Tech Mono, monospace";
const GOLD = "#e8b84a";
const PAPER = "#f0e6c8";

const LIST_X = 16;
const LIST_Y = 40;
const LIST_W = 268;
const STATS_W = 400;
const LINE_H = 16;
const PART_SLOTS = 10;

type Filter = "all" | "ground" | "air" | "water" | "building" | "troop";
const FILTERS: Filter[] = ["all", "ground", "air", "water", "building", "troop"];

/**
 * Lazy debug browser for every roster UnitSpec — list, live preview (hull + parts),
 * and a stats dump derived from the real SPECS / driveOf source.
 */
export class RosterConfigTool {
  open = false;
  private built = false;
  private scene: Phaser.Scene;
  private idx = 0;
  private filter: Filter = "all";
  private zoom = 2;
  root: Phaser.GameObjects.Container;
  private dim!: Phaser.GameObjects.Rectangle;
  private board!: Phaser.GameObjects.Graphics;
  private hull!: Phaser.GameObjects.Image;
  private parts: Phaser.GameObjects.Image[] = [];
  private overlay!: Phaser.GameObjects.Graphics;
  private listTxt!: Phaser.GameObjects.Text;
  private statsTxt!: Phaser.GameObjects.Text;
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
    this.overlay = scene.add.graphics().setScrollFactor(0).setDepth(DEPTH + 4).setVisible(false);
    this.listTxt = scene.add
      .text(LIST_X, LIST_Y, "", {
        fontFamily: MONO,
        fontSize: "13px",
        color: PAPER,
        lineSpacing: 3,
      })
      .setScrollFactor(0)
      .setDepth(DEPTH + 5)
      .setVisible(false);
    this.statsTxt = scene.add
      .text(0, 0, "", {
        fontFamily: MONO,
        fontSize: "12px",
        color: PAPER,
        lineSpacing: 4,
        wordWrap: { width: STATS_W - 8 },
      })
      .setScrollFactor(0)
      .setDepth(DEPTH + 5)
      .setVisible(false);
    this.hintTxt = scene.add
      .text(18, 14, "", { fontFamily: MONO, fontSize: "12px", color: GOLD })
      .setScrollFactor(0)
      .setDepth(DEPTH + 5)
      .setVisible(false);
    nameGameTexture(scene, this.listTxt, "ui_roster_list");
    nameGameTexture(scene, this.statsTxt, "ui_roster_stats");
    nameGameTexture(scene, this.hintTxt, "ui_roster_hint");
    this.root.add([
      this.dim,
      this.board,
      this.hull,
      ...this.parts,
      this.overlay,
      this.listTxt,
      this.statsTxt,
      this.hintTxt,
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
    this.hull.setVisible(this.open);
    this.overlay.setVisible(this.open);
    this.listTxt.setVisible(this.open);
    this.statsTxt.setVisible(this.open);
    this.hintTxt.setVisible(this.open);
    this.scene.input.setDefaultCursor(this.open ? "default" : "none");
    this.uiCam.setVisible(this.open);
    if (this.open) this.refreshPreview();
    else {
      this.overlay.clear();
      for (const p of this.parts) p.setVisible(false);
    }
  }

  cycle(dir: number): void {
    if (!this.open) return;
    const n = this.kinds().length;
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
    const kinds = this.kinds();
    const size = this.pageSize();
    const pages = Math.max(1, Math.ceil(kinds.length / size));
    const next = (((this.pageOf(this.idx) + dir) % pages) + pages) % pages;
    this.idx = Math.min(kinds.length - 1, next * size);
    this.refreshPreview();
  }

  pickFromList(py: number): void {
    if (!this.open) return;
    const kinds = this.kinds();
    const size = this.pageSize();
    const row = Math.floor((py - LIST_Y) / LINE_H) - 1;
    if (row < 0 || row >= size) return;
    const i = this.pageOf(this.idx) * size + row;
    if (i < 0 || i >= kinds.length) return;
    this.idx = i;
    this.refreshPreview();
  }

  update(): void {
    if (!this.open) return;
    const kinds = this.kinds();
    if (!kinds.length) return;
    if (this.idx >= kinds.length) this.idx = 0;
    const kind = kinds[this.idx]!;
    const sp = specOf(kind);

    this.hintTxt.setText(
      `ROSTER RIG   \` cycle / close   [ ] cycle   , . page   - + zoom ${fmtZoom(this.zoom)}   G filter ${this.filter.toUpperCase()}   derived from roster SPECS`
    );

    const size = this.pageSize();
    const pages = Math.max(1, Math.ceil(kinds.length / size));
    const page = this.pageOf(this.idx);
    const start = page * size;
    const slice = kinds.slice(start, start + size);
    this.listTxt.setText(
      [
        `— ${this.filter.toUpperCase()}  ${page + 1} / ${pages}  (${kinds.length}/${allKinds().length}) —`,
        ...slice.map((k, i) => {
          const mark = start + i === this.idx ? "▸" : " ";
          const tag = categoryTag(k);
          return `${mark} ${labelOf(k).padEnd(16)} ${tag}`;
        }),
      ].join("\n")
    );

    this.statsTxt.setText(formatSpec(kind, sp));
    this.layoutPreview(kind, sp);
  }

  private pageSize(): number {
    return Math.max(8, Math.floor((this.scene.scale.height - LIST_Y - 28) / LINE_H) - 1);
  }

  private pageOf(idx: number): number {
    return Math.floor(idx / this.pageSize());
  }

  private kinds(): UnitKind[] {
    return allKinds().filter((k) => matchesFilter(k, this.filter));
  }

  private refreshPreview(): void {
    if (!this.open || !this.built) return;
    this.update();
  }

  private layoutPreview(_kind: UnitKind, sp: UnitSpec): void {
    const w = this.scene.scale.width;
    const h = this.scene.scale.height;
    const tex = sp.texture;
    const listRight = LIST_X + LIST_W + 20;
    const gap = 28;

    if (!this.scene.textures.exists(tex)) {
      this.hull.setVisible(false);
      for (const p of this.parts) p.setVisible(false);
      this.board.clear();
      this.overlay.clear();
      this.statsTxt.setPosition(listRight, LIST_Y);
      return;
    }

    this.hull.setVisible(true).setTexture(tex);
    const pivot = spritePivot(tex);
    this.hull.setOrigin(pivot.x, pivot.y);
    // Controllable preview zoom (− / +); default 2×.
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
    this.statsTxt.setPosition(statsX, Math.max(LIST_Y, by));

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

    // Collision radius / height at preview zoom.
    this.overlay.clear();
    this.overlay.lineStyle(1.5, 0x5ec8ff, 0.75);
    this.overlay.strokeCircle(cx, cy, sp.radius * s);
    this.overlay.lineStyle(1.2, 0x6dbb4a, 0.7);
    this.overlay.lineBetween(cx, cy, cx, cy - sp.height * s);
    this.overlay.fillStyle(0xe8b84a, 0.9);
    this.overlay.fillCircle(cx, cy, 2);
  }
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

function formatWeapon(w: WeaponSpec, indent = "         "): string[] {
  const burst = w.burst ? `  burst ${w.burst}×${w.burstGap ?? "?"}` : "";
  return [
    `${indent}${w.shot}  dmg ${w.dmg}  blast ${w.blast}  spd ${w.speed}`,
    `${indent}cd ${w.fireCd}  range ${w.range}  ${w.tracer}${burst}`,
  ];
}

function formatSpec(kind: UnitKind, sp: UnitSpec): string {
  const flags = [
    sp.building && "building",
    sp.aerial && "aerial",
    sp.water && "water",
    sp.organic && "organic",
    sp.softBlood && "softBlood",
    sp.hv && "hv",
    sp.noCrater && "noCrater",
    sp.throwGuns && "throwGuns",
    sp.fixedAim && "fixedAim",
    sp.wheels != null && `wheels:${sp.wheels}`,
  ].filter(Boolean) as string[];

  const lines: string[] = [
    `KIND     ${kind}`,
    `LABEL    ${labelOf(kind)}`,
    `HP       ${sp.health}    radius ${sp.radius}    height ${sp.height}${sp.flyZ != null ? `    flyZ ${sp.flyZ}` : ""}`,
    `MOVE     ${sp.move}    frag ${sp.frag}    rotOff ${(sp.rotOff / Math.PI).toFixed(2)}π`,
    `TEX      ${sp.texture}`,
    `HULK     ${sp.hulk}`,
    `FLAGS    ${flags.length ? flags.join(" · ") : "—"}`,
  ];

  if (sp.spawnYaw != null) {
    lines.push(`SPAWN    yaw ±${((sp.spawnYaw * 180) / Math.PI).toFixed(1)}°`);
  }

  const driveKinds: MoveKind[] = ["tank", "vehicle"];
  if (driveKinds.includes(sp.move)) {
    const d = driveOf(kind);
    lines.push(
      `DRIVE    spd ${d.maxSpd}  accel ${d.accel}  brake ${d.brake}  turn ${d.turn}`,
      `         track ${d.track}  gap ${d.trackGap}  sc ${d.trackScale}`
    );
  }

  if (sp.weapon) {
    lines.push(`WEAPON   (body)`);
    lines.push(...formatWeapon(sp.weapon));
  }

  if (sp.guns.length) {
    lines.push(`GUNS     ${sp.guns.length}`);
    sp.guns.forEach((g, i) => {
      lines.push(
        `  [${i}] ${g.tex}${g.hulk ? ` → ${g.hulk}` : ""}  sc ${g.scale ?? 1}`,
        `       mount ${g.mount.x.toFixed(3)},${g.mount.y.toFixed(3)}  origin ${g.origin.x.toFixed(3)},${g.origin.y.toFixed(3)}`
      );
      if (g.weapon) lines.push(...formatWeapon(g.weapon, "       "));
    });
  } else {
    lines.push(`GUNS     —`);
  }

  if (sp.rotors.length) {
    lines.push(`ROTORS   ${sp.rotors.length}`);
    sp.rotors.forEach((r, i) => {
      lines.push(
        `  [${i}] ${r.tex}${r.hulk ? ` → ${r.hulk}` : ""}  sc ${r.scale ?? 1}`,
        `       mount ${r.mount.x.toFixed(3)},${r.mount.y.toFixed(3)}`
      );
    });
  } else {
    lines.push(`ROTORS   —`);
  }

  if (sp.dish) {
    const d = sp.dish;
    lines.push(
      `DISH     ${d.tex}${d.hulk ? ` → ${d.hulk}` : ""}  sc ${d.scale ?? 1}`,
      `         mount ${d.mount.x.toFixed(3)},${d.mount.y.toFixed(3)}`
    );
  } else {
    lines.push(`DISH     —`);
  }

  const splash = sp.building
    ? `death splash  ${(sp.health * 0.05).toFixed(1)} dmg @ r×3`
    : !sp.organic && (isGroundVehicle(kind) || sp.water || sp.aerial || sp.move === "tank")
      ? `death splash  ${(sp.health * 0.1).toFixed(1)} dmg @ r×3`
      : `death splash  —`;
  lines.push("", splash, "", "source: roster.ts SPECS / driveOf / labelOf");

  return lines.join("\n");
}
