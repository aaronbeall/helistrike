import type Phaser from "phaser";
import { rotorLayout, tankLayout, gunLayout } from "./sprites";

const DEPTH = 9200;
const MONO = "Share Tech Mono, monospace";
const GOLD = "#e8b84a";
const PAPER = "#f0e6c8";

const KEYS = [
  "heli_body",
  "heli_rotor",
  "heli_gun",
  "enemy_heli",
  "enemy_rotor",
  "tank_hull",
  "tank_turret",
  "hulk_tank_hull",
  "hulk_tank_turret",
  "boat",
  "tower",
  "bunker",
  "radar",
  "soldier",
  "tree",
  "rock",
  "cannon",
  "rocket",
  "hellfire",
  "tow",
] as const;

export class SpriteConfigTool {
  open = false;
  private scene: Phaser.Scene;
  private idx = 0;
  private pinned: { uvx: number; uvy: number } | null = null;
  private copied = "";
  private root: Phaser.GameObjects.Container;
  private dim: Phaser.GameObjects.Rectangle;
  private board: Phaser.GameObjects.Graphics;
  private preview: Phaser.GameObjects.Image;
  private overlay: Phaser.GameObjects.Graphics;
  private listTxt: Phaser.GameObjects.Text;
  private statsTxt: Phaser.GameObjects.Text;
  private hintTxt: Phaser.GameObjects.Text;
  private originOf: (key: string) => { x: number; y: number };

  constructor(scene: Phaser.Scene, originOf: (key: string) => { x: number; y: number }) {
    this.scene = scene;
    this.originOf = originOf;
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
      .image(0, 0, "heli_body")
      .setScrollFactor(0)
      .setDepth(DEPTH + 2)
      .setVisible(false);
    this.overlay = scene.add.graphics().setScrollFactor(0).setDepth(DEPTH + 3).setVisible(false);
    this.listTxt = scene.add
      .text(18, 42, "", { fontFamily: MONO, fontSize: "13px", color: PAPER, lineSpacing: 4 })
      .setScrollFactor(0)
      .setDepth(DEPTH + 4)
      .setVisible(false);
    this.statsTxt = scene.add
      .text(0, 0, "", { fontFamily: MONO, fontSize: "13px", color: PAPER, lineSpacing: 5 })
      .setScrollFactor(0)
      .setDepth(DEPTH + 4)
      .setVisible(false);
    this.hintTxt = scene.add
      .text(18, 14, "", { fontFamily: MONO, fontSize: "12px", color: GOLD })
      .setScrollFactor(0)
      .setDepth(DEPTH + 4)
      .setVisible(false);
    this.root = scene.add.container(0, 0, [
      this.dim,
      this.board,
      this.preview,
      this.overlay,
      this.listTxt,
      this.statsTxt,
      this.hintTxt,
    ]);
    this.root.setDepth(DEPTH).setScrollFactor(0);

    scene.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      if (!this.open) return;
      if (p.x < 210) {
        this.pickFromList(p.y);
        return;
      }
      const uv = this.uvAt(p);
      if (!uv) return;
      this.pinned = uv;
      const key = this.key();
      this.copied = `${key}  origin ${uv.uvx.toFixed(3)} ${uv.uvy.toFixed(3)}  px ${uv.px.toFixed(1)} ${uv.py.toFixed(1)}`;
      copyText(this.copied);
    });
  }

  toggle(): void {
    this.open = !this.open;
    this.dim.setVisible(this.open);
    this.board.setVisible(this.open);
    this.preview.setVisible(this.open);
    this.overlay.setVisible(this.open);
    this.listTxt.setVisible(this.open);
    this.statsTxt.setVisible(this.open);
    this.hintTxt.setVisible(this.open);
    this.scene.input.setDefaultCursor(this.open ? "crosshair" : "none");
    if (this.open) this.refreshPreview();
    else this.overlay.clear();
  }

  cycle(dir: number): void {
    if (!this.open) return;
    const n = this.available().length;
    this.idx = (this.idx + dir + n) % n;
    this.pinned = null;
    this.refreshPreview();
  }

  pickFromList(py: number): void {
    if (!this.open) return;
    const keys = this.available();
    const lineH = 17;
    const i = Math.floor((py - 42) / lineH);
    if (i < 0 || i >= keys.length) return;
    this.idx = i;
    this.pinned = null;
    this.refreshPreview();
  }

  update(): void {
    if (!this.open) return;
    const keys = this.available();
    if (!keys.length) return;
    if (this.idx >= keys.length) this.idx = 0;
    const key = this.key();
    const p = this.scene.input.activePointer;
    const uv = this.uvAt(p);
    const origin = this.originOf(key);
    const tex = this.scene.textures.get(key);
    const src = tex.getSourceImage() as HTMLImageElement | HTMLCanvasElement;
    const tw = src.width;
    const th = src.height;

    this.hintTxt.setText("SPRITE RIG   ` or F9 close   [ ] cycle   click sprite copies origin uv");
    this.listTxt.setText(
      keys.map((k, i) => (i === this.idx ? `▸ ${k}` : `  ${k}`)).join("\n")
    );

    const hover = uv
      ? `CURSOR   uv  ${uv.uvx.toFixed(3)}  ${uv.uvy.toFixed(3)}\n         px  ${uv.px.toFixed(1)}  ${uv.py.toFixed(1)}\n         from origin  ${((uv.uvx - origin.x) * tw).toFixed(1)}  ${((uv.uvy - origin.y) * th).toFixed(1)}`
      : "CURSOR   off board";
    const pin = this.pinned
      ? `PIN      uv  ${this.pinned.uvx.toFixed(3)}  ${this.pinned.uvy.toFixed(3)}\n         copied  ${this.copied}`
      : "PIN      click the sprite to copy origin uv / px";
    this.statsTxt.setText(
      [
        `KEY      ${key}`,
        `TEX      ${tw} × ${th}`,
        `ORIGIN   ${origin.x.toFixed(3)}  ${origin.y.toFixed(3)}`,
        `         px  ${(origin.x * tw).toFixed(1)}  ${(origin.y * th).toFixed(1)}`,
        layoutLine(key),
        "",
        hover,
        pin,
        "",
        "texture space · nose-up · origin = player/unit center",
      ].join("\n")
    );

    this.drawOverlay(origin, uv);
  }

  private available(): string[] {
    return KEYS.filter((k) => this.scene.textures.exists(k));
  }

  private key(): string {
    return this.available()[this.idx] ?? "heli_body";
  }

  private refreshPreview(): void {
    const key = this.key();
    const w = this.scene.scale.width;
    const h = this.scene.scale.height;
    const origin = this.originOf(key);
    this.preview.setTexture(key);
    this.preview.setOrigin(origin.x, origin.y);
    const max = Math.min(h * 0.62, w * 0.42);
    const s = max / Math.max(this.preview.width, this.preview.height);
    this.preview.setScale(s);
    this.preview.setPosition(w * 0.58, h * 0.42);
    this.statsTxt.setPosition(w * 0.58 - max * 0.55, h * 0.42 + this.preview.displayHeight * 0.52 + 18);

    this.board.clear();
    const bx = this.preview.x - this.preview.displayWidth * this.preview.originX;
    const by = this.preview.y - this.preview.displayHeight * this.preview.originY;
    const bw = this.preview.displayWidth;
    const bh = this.preview.displayHeight;
    const cell = 14;
    this.board.fillStyle(0x2a2418, 1);
    this.board.fillRect(bx - 10, by - 10, bw + 20, bh + 20);
    for (let y = 0; y < bh; y += cell) {
      for (let x = 0; x < bw; x += cell) {
        if (((((x / cell) | 0) + ((y / cell) | 0)) & 1) === 1) this.board.fillStyle(0x3a3428, 1);
        else this.board.fillStyle(0x241e16, 1);
        this.board.fillRect(bx + x, by + y, Math.min(cell, bw - x), Math.min(cell, bh - y));
      }
    }
    this.board.lineStyle(1, 0xe8b84a, 0.55);
    this.board.strokeRect(bx - 10, by - 10, bw + 20, bh + 20);
  }

  private uvAt(p: Phaser.Input.Pointer): { uvx: number; uvy: number; px: number; py: number } | null {
    const spr = this.preview;
    const lp = spr.getLocalPoint(p.worldX, p.worldY);
    if (lp.x < -0.5 || lp.y < -0.5 || lp.x > spr.width + 0.5 || lp.y > spr.height + 0.5) return null;
    const px = lp.x;
    const py = lp.y;
    return { uvx: px / spr.width, uvy: py / spr.height, px, py };
  }

  private drawOverlay(origin: { x: number; y: number }, uv: { uvx: number; uvy: number } | null): void {
    const g = this.overlay;
    g.clear();
    const spr = this.preview;
    const toX = (u: number) => spr.x + (u - spr.originX) * spr.displayWidth;
    const toY = (v: number) => spr.y + (v - spr.originY) * spr.displayHeight;
    const ox = toX(origin.x);
    const oy = toY(origin.y);
    const left = toX(0);
    const right = toX(1);
    const top = toY(0);
    const bot = toY(1);
    const midX = toX(0.5);
    const midY = toY(0.5);
    g.lineStyle(1, 0xe8e0c8, 0.28);
    g.lineBetween(midX, top, midX, bot);
    g.lineBetween(left, midY, right, midY);
    g.lineStyle(1.5, 0xe8b84a, 0.95);
    g.lineBetween(ox - 18, oy, ox + 18, oy);
    g.lineBetween(ox, oy - 18, ox, oy + 18);
    g.strokeCircle(ox, oy, 6);
    if (uv) {
      const cx = toX(uv.uvx);
      const cy = toY(uv.uvy);
      g.lineStyle(1.25, 0x5ec8ff, 0.95);
      g.lineBetween(cx - 22, cy, cx + 22, cy);
      g.lineBetween(cx, cy - 22, cx, cy + 22);
    }
    if (this.pinned) {
      const px = toX(this.pinned.uvx);
      const py = toY(this.pinned.uvy);
      g.fillStyle(0xff3a2a, 1);
      g.fillCircle(px, py, 4);
      g.lineStyle(1, 0xffffff, 0.9);
      g.strokeCircle(px, py, 4);
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
  document.execCommand("copy");
  document.body.removeChild(el);
}

function layoutLine(key: string): string {
  if (key === "heli_body")
    return `LAYOUT   rotorLayout.player  ${fmt(rotorLayout.player)}`;
  if (key === "enemy_heli")
    return `LAYOUT   rotorLayout.enemy   ${fmt(rotorLayout.enemy)}`;
  if (key === "heli_rotor" || key === "enemy_rotor") return "LAYOUT   origin 0.5 0.5  (spin hub)";
  if (key === "heli_gun")
    return `LAYOUT   gun origin ${fmt(gunLayout.origin)}  mount on body ${fmt(gunLayout.mount)}`;
  if (key === "tank_hull") return `LAYOUT   mountOrigin  ${fmt(tankLayout.mountOrigin)}`;
  if (key === "tank_turret") return `LAYOUT   turretOrigin  ${fmt(tankLayout.turretOrigin)}`;
  if (key === "hulk_tank_turret")
    return `LAYOUT   hulkTurretOrigin  ${fmt(tankLayout.hulkTurretOrigin)}`;
  return "LAYOUT   origin 0.5 0.5";
}

function fmt(p: { x: number; y: number }): string {
  return `${p.x.toFixed(3)}  ${p.y.toFixed(3)}`;
}
