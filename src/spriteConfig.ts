import Phaser from "phaser";
import { allSpecs } from "./roster";
import { lookupSpriteMuzzles, SPRITE_MOUNT } from "./spriteOrigin";
import { rotorLayout, tankLayout, gunLayout, isUuidTexture, nameGameTexture, nameGeneratedTextures, spritePivot } from "./sprites";

const DEPTH = 9200;
const MONO = "Share Tech Mono, monospace";
const GOLD = "#e8b84a";
const PAPER = "#f0e6c8";

const SKIP = /^(src_|__)|_sh[0-3]$/;
const GENERATED = /^(hud_|ui_|debug_|edit_|wpn_|hv_|lock_|map_|ai_label|menu_|load_|terrain|heightmap|wreck|wrecks|brush_|impact_|gen_)/;
const LIST_X = 16;
const LIST_Y = 40;
const LIST_W = 248;
const STATS_W = 360;
const LINE_H = 16;

export class SpriteConfigTool {
  open = false;
  private scene: Phaser.Scene;
  private idx = 0;
  private pinned: { uvx: number; uvy: number } | null = null;
  private copied = "";
  root: Phaser.GameObjects.Container;
  private dim: Phaser.GameObjects.Rectangle;
  private board: Phaser.GameObjects.Graphics;
  private preview: Phaser.GameObjects.Image;
  private overlay: Phaser.GameObjects.Graphics;
  private listTxt: Phaser.GameObjects.Text;
  private statsTxt: Phaser.GameObjects.Text;
  private hintTxt: Phaser.GameObjects.Text;
  private mountLabels: Phaser.GameObjects.Text[] = [];
  private originOf: (key: string) => { x: number; y: number };
  private uiCam: Phaser.Cameras.Scene2D.Camera;
  artOnly = true;

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
      .text(LIST_X, LIST_Y, "", {
        fontFamily: MONO,
        fontSize: "13px",
        color: PAPER,
        lineSpacing: 3,
      })
      .setScrollFactor(0)
      .setDepth(DEPTH + 4)
      .setVisible(false);
    this.statsTxt = scene.add
      .text(0, 0, "", {
        fontFamily: MONO,
        fontSize: "13px",
        color: PAPER,
        lineSpacing: 5,
        wordWrap: { width: STATS_W - 8 },
      })
      .setScrollFactor(0)
      .setDepth(DEPTH + 4)
      .setVisible(false);
    this.hintTxt = scene.add
      .text(18, 14, "", { fontFamily: MONO, fontSize: "12px", color: GOLD })
      .setScrollFactor(0)
      .setDepth(DEPTH + 4)
      .setVisible(false);
    nameGameTexture(scene, this.listTxt, "ui_rig_list");
    nameGameTexture(scene, this.statsTxt, "ui_rig_stats");
    nameGameTexture(scene, this.hintTxt, "ui_rig_hint");
    for (let i = 0; i < 16; i++) {
      const t = scene.add
        .text(0, 0, "", {
          fontFamily: MONO,
          fontSize: "11px",
          color: "#c8ffc8",
          stroke: "#0c0a08",
          strokeThickness: 3,
        })
        .setScrollFactor(0)
        .setDepth(DEPTH + 5)
        .setVisible(false);
      nameGameTexture(scene, t, `ui_rig_mount_${i}`);
      this.mountLabels.push(t);
    }
    this.root = scene.add.container(0, 0, [
      this.dim,
      this.board,
      this.preview,
      this.overlay,
      this.listTxt,
      this.statsTxt,
      this.hintTxt,
      ...this.mountLabels,
    ]);
    this.root.setDepth(DEPTH).setScrollFactor(0);

    this.uiCam = scene.cameras.add(0, 0, w, h, false, "spriteRig");
    this.uiCam.setScroll(0, 0);
    this.uiCam.setZoom(1);
    this.uiCam.transparent = true;
    this.uiCam.setVisible(false);
    scene.cameras.main.ignore(this.root);
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
        this.artOnly = !this.artOnly;
        this.idx = 0;
        this.pinned = null;
        nameGeneratedTextures(this.scene);
        this.refreshPreview();
      });
    }
    scene.scale.on("resize", (gameSize: Phaser.Structs.Size) => {
      this.uiCam.setSize(gameSize.width, gameSize.height);
      this.dim.setSize(gameSize.width, gameSize.height);
      if (this.open) this.refreshPreview();
    });

    scene.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      if (!this.open) return;
      if (p.x < LIST_X + LIST_W) {
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
    this.scene.input.setDefaultCursor(this.open ? "default" : "none");
    this.uiCam.setVisible(this.open);
    if (this.open) {
      nameGeneratedTextures(this.scene);
      this.refreshPreview();
    } else {
      this.overlay.clear();
      for (const t of this.mountLabels) t.setVisible(false);
    }
  }

  cycle(dir: number): void {
    if (!this.open) return;
    const n = this.available().length;
    if (!n) return;
    this.idx = (this.idx + dir + n) % n;
    this.pinned = null;
    this.refreshPreview();
  }

  page(dir: number): void {
    if (!this.open) return;
    const keys = this.available();
    const size = this.pageSize();
    const pages = Math.max(1, Math.ceil(keys.length / size));
    const next = (((this.pageOf(this.idx) + dir) % pages) + pages) % pages;
    this.idx = Math.min(keys.length - 1, next * size);
    this.pinned = null;
    this.refreshPreview();
  }

  pickFromList(py: number): void {
    if (!this.open) return;
    const keys = this.available();
    const size = this.pageSize();
    const row = Math.floor((py - LIST_Y) / LINE_H) - 1;
    if (row < 0 || row >= size) return;
    const i = this.pageOf(this.idx) * size + row;
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

    this.hintTxt.setText(
      `SPRITE RIG   \` / F9 close   [ ] cycle   , . page   G art-only ${this.artOnly ? "ON" : "OFF"}   gold origin · green gun · cyan rotor · gold dish · violet troop · orange muzzle`
    );
    const size = this.pageSize();
    const pages = Math.max(1, Math.ceil(keys.length / size));
    const page = this.pageOf(this.idx);
    const start = page * size;
    const slice = keys.slice(start, start + size);
    this.listTxt.setText(
      [
        `— ${this.artOnly ? "ART" : "ALL"}  ${page + 1} / ${pages}  (${keys.length}) —`,
        ...slice.map((k, i) => (start + i === this.idx ? `▸ ${k}` : `  ${k}`)),
      ].join("\n")
    );

    const hover = uv
      ? `CURSOR   uv  ${uv.uvx.toFixed(3)}  ${uv.uvy.toFixed(3)}\n         px  ${uv.px.toFixed(1)}  ${uv.py.toFixed(1)}\n         from origin  ${((uv.uvx - origin.x) * tw).toFixed(1)}  ${((uv.uvy - origin.y) * th).toFixed(1)}`
      : "CURSOR   off board";
    const pin = this.pinned
      ? `PIN      uv  ${this.pinned.uvx.toFixed(3)}  ${this.pinned.uvy.toFixed(3)}\n         copied  ${this.copied}`
      : "PIN      click the sprite to copy origin uv / px";
    const marks = rigMarks(key);
    const mountLines = marks.mounts.length
      ? marks.mounts
          .map((p, i) => `${i === 0 ? "MOUNT   " : "        "} ${p.label.padEnd(10)} ${fmt(p)}`)
          .join("\n")
      : "MOUNT    —";
    const muzLines = marks.muzzles.length
      ? marks.muzzles
          .map((p, i) => {
            const tag = marks.muzzles.length > 1 ? `muzzle ${i + 1}` : "muzzle";
            return `${i === 0 ? "MUZZLE  " : "        "} ${tag.padEnd(10)} ${fmt(p)}`;
          })
          .join("\n")
      : "MUZZLE   —";
    this.statsTxt.setText(
      [
        `KEY      ${key}`,
        `TEX      ${tw} × ${th}`,
        `ORIGIN   ${origin.x.toFixed(3)}  ${origin.y.toFixed(3)}`,
        `         px  ${(origin.x * tw).toFixed(1)}  ${(origin.y * th).toFixed(1)}`,
        layoutLine(key),
        spawnYawLine(key),
        mountLines,
        muzLines,
        "",
        hover,
        pin,
        "",
        "texture space · nose-up · roles from unit roster (not a flat UV dump)",
        "spawn yaw any unless listed",
      ].join("\n")
    );

    this.drawOverlay(key, origin);
  }

  private pageSize(): number {
    return Math.max(8, Math.floor((this.scene.scale.height - LIST_Y - 28) / LINE_H) - 1);
  }

  private pageOf(idx: number): number {
    return Math.floor(idx / this.pageSize());
  }

  private available(): string[] {
    const tex = this.scene.textures as Phaser.Textures.TextureManager & { getTextureKeys?: () => string[] };
    const raw = tex.getTextureKeys ? tex.getTextureKeys() : Object.keys(tex.list);
    return raw
      .filter((k) => k && !SKIP.test(k) && !isUuidTexture(k) && this.scene.textures.exists(k))
      .filter((k) => !this.artOnly || !GENERATED.test(k))
      .sort((a, b) => a.localeCompare(b));
  }

  private key(): string {
    return this.available()[this.idx] ?? "heli_body";
  }

  private refreshPreview(): void {
    const key = this.key();
    const w = this.scene.scale.width;
    const h = this.scene.scale.height;
    this.preview.setTexture(key);
    this.preview.setOrigin(0.5, 0.5);
    const listRight = LIST_X + LIST_W + 20;
    const gap = 28;
    const availW = Math.max(180, w - listRight - STATS_W - gap - 20);
    const max = Math.min(h * 0.72, availW);
    const s = max / Math.max(this.preview.width, this.preview.height, 1);
    this.preview.setScale(s);
    this.preview.setPosition(listRight + max * 0.5, h * 0.48);
    const bw = this.preview.displayWidth;
    const bh = this.preview.displayHeight;
    const bx = this.preview.x - bw * this.preview.originX;
    const by = this.preview.y - bh * this.preview.originY;
    this.statsTxt.setPosition(bx + bw + gap, Math.max(LIST_Y, by));

    this.board.clear();
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
    const lp = spr.getLocalPoint(p.x, p.y, undefined, this.uiCam);
    if (lp.x < -0.5 || lp.y < -0.5 || lp.x > spr.width + 0.5 || lp.y > spr.height + 0.5) return null;
    const px = lp.x;
    const py = lp.y;
    return { uvx: px / spr.width, uvy: py / spr.height, px, py };
  }

  private drawOverlay(key: string, origin: { x: number; y: number }): void {
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
    const marks = rigMarks(key);
    for (let i = 0; i < this.mountLabels.length; i++) {
      const lab = this.mountLabels[i];
      const p = marks.mounts[i];
      if (!p) {
        lab.setVisible(false);
        continue;
      }
      const x = toX(p.x);
      const y = toY(p.y);
      g.fillStyle(p.color, 0.95);
      g.fillRect(x - 4, y - 4, 8, 8);
      g.lineStyle(1, 0x101010, 0.9);
      g.strokeRect(x - 4, y - 4, 8, 8);
      lab.setText(p.label);
      lab.setColor(hexColor(p.color));
      lab.setPosition(x + 7, y - 8);
      lab.setVisible(true);
    }
    for (const p of marks.muzzles) {
      const x = toX(p.x);
      const y = toY(p.y);
      g.fillStyle(0xff7a2a, 0.95);
      g.fillCircle(x, y, 5);
      g.lineStyle(1.25, 0xffe8c0, 0.95);
      g.strokeCircle(x, y, 5);
    }
    g.lineStyle(1.5, 0xe8b84a, 0.95);
    g.lineBetween(ox - 18, oy, ox + 18, oy);
    g.lineBetween(ox, oy - 18, ox, oy + 18);
    g.strokeCircle(ox, oy, 6);
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

function dedupeUv(list: { x: number; y: number }[]): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (const p of list) {
    if (!out.some((q) => Math.abs(q.x - p.x) < 1e-4 && Math.abs(q.y - p.y) < 1e-4)) out.push(p);
  }
  return out;
}

type MountRole = "gun" | "rotor" | "dish" | "troop" | "reserved";

type RigMount = { x: number; y: number; role: MountRole; label: string; color: number };

const ROLE_COLOR: Record<MountRole, number> = {
  gun: 0x6adf6a,
  rotor: 0x5ec8ff,
  dish: 0xe8b84a,
  troop: 0xd878ff,
  reserved: 0x9a9480,
};

function hexColor(n: number): string {
  return `#${n.toString(16).padStart(6, "0")}`;
}

function addMount(list: RigMount[], p: { x: number; y: number }, role: MountRole, label: string): void {
  if (list.some((q) => Math.abs(q.x - p.x) < 1e-4 && Math.abs(q.y - p.y) < 1e-4 && q.role === role)) return;
  list.push({ x: p.x, y: p.y, role, label, color: ROLE_COLOR[role] });
}

function numberMounts(list: RigMount[]): void {
  const total = new Map<MountRole, number>();
  for (const m of list) total.set(m.role, (total.get(m.role) ?? 0) + 1);
  const seen = new Map<MountRole, number>();
  for (const m of list) {
    if ((total.get(m.role) ?? 0) <= 1) continue;
    const i = (seen.get(m.role) ?? 0) + 1;
    seen.set(m.role, i);
    m.label = `${m.label} ${i}`;
  }
}

function rigMarks(key: string): { mounts: RigMount[]; muzzles: { x: number; y: number }[] } {
  const k = key.replace(/__(woodland|desert|urban|snow)$/, "");
  const mounts: RigMount[] = [];
  const muzzles = lookupSpriteMuzzles(k);
  if (k === "heli_body") {
    addMount(mounts, gunLayout.mount, "gun", "gun");
    addMount(mounts, rotorLayout.player, "rotor", "rotor");
  }
  if (k === "enemy_heli") addMount(mounts, rotorLayout.enemy, "rotor", "rotor");
  for (const sp of allSpecs()) {
    const tex = sp.texture.replace(/__(woodland|desert|urban|snow)$/, "");
    if (tex === k) {
      for (const g of sp.guns) addMount(mounts, g.mount, "gun", "gun");
      for (const r of sp.rotors) addMount(mounts, r.mount, "rotor", "rotor");
      if (sp.dish) addMount(mounts, sp.dish.mount, "dish", "dish");
      if (tex === "building_lookout") addMount(mounts, SPRITE_MOUNT.building_lookout, "troop", "troop");
      if (tex === "enemy_pickup") addMount(mounts, SPRITE_MOUNT.enemy_pickup, "reserved", "gun later");
    }
    for (const g of sp.guns) {
      if (g.tex !== k) continue;
      if (g.muzzles?.length) muzzles.push(...g.muzzles);
      else if (g.muzzle) muzzles.push({ ...g.muzzle });
    }
  }
  numberMounts(mounts);
  return { mounts, muzzles: dedupeUv(muzzles) };
}

function spawnYawLine(key: string): string {
  const k = key.replace(/__(woodland|desert|urban|snow)$/, "");
  const deg = (rad: number) => `±${Math.round((rad * 180) / Math.PI)}°`;
  for (const sp of allSpecs()) {
    const tex = sp.texture.replace(/__(woodland|desert|urban|snow)$/, "");
    const hulk = sp.hulk.replace(/__(woodland|desert|urban|snow)$/, "");
    if (tex === k || hulk === k) {
      if (sp.spawnYaw == null) return "SPAWN    yaw  any";
      return `SPAWN    yaw  ${deg(sp.spawnYaw)}  around as-drawn`;
    }
  }
  for (const sp of allSpecs()) {
    const part =
      sp.guns.some((g) => g.tex === k || g.hulk === k) ||
      sp.rotors.some((r) => r.tex === k) ||
      sp.dish?.tex === k;
    if (!part || sp.spawnYaw == null) continue;
    return `SPAWN    yaw  ${deg(sp.spawnYaw)}  follows body`;
  }
  return "SPAWN    yaw  any";
}

function layoutLine(key: string): string {
  if (key === "heli_body")
    return `LAYOUT   rotorLayout.player  ${fmt(rotorLayout.player)}`;
  if (key === "enemy_heli")
    return `LAYOUT   rotorLayout.enemy   ${fmt(rotorLayout.enemy)}`;
  if (key === "heli_rotor" || key === "enemy_heli_rotor") return "LAYOUT   origin 0.5 0.5  (spin hub)";
  if (key === "heli_gun")
    return `LAYOUT   gun origin ${fmt(gunLayout.origin)}  mount on body ${fmt(gunLayout.mount)}`;
  if (key === "enemy_tank") return `LAYOUT   mountOrigin  ${fmt(tankLayout.mountOrigin)}`;
  if (key === "enemy_tank_gun") return `LAYOUT   turretOrigin  ${fmt(tankLayout.turretOrigin)}`;
  if (key === "enemy_tank_gun_hulk")
    return `LAYOUT   hulkTurretOrigin  ${fmt(tankLayout.hulkTurretOrigin)}`;
  return `LAYOUT   origin  ${fmt(spritePivot(key))}`;
}

function fmt(p: { x: number; y: number }): string {
  return `${p.x.toFixed(3)}  ${p.y.toFixed(3)}`;
}
