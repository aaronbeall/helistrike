import Phaser from "phaser";
import { PLAYER_WPNS } from "./combat";
import { CFG_INFO, CFG_VALUE, makeConfigText, row } from "./configUi";
import { allCrafts } from "./craft";
import { ENEMY_WPNS, allKinds, specOf } from "./roster";
import { nameGameTexture } from "./sprites";

const DEPTH = 9500;
const MONO = "Share Tech Mono, monospace";
const GOLD = "#e8b84a";
const PAPER = CFG_VALUE;
const LIST_X = 16;
const LIST_Y = 40;
const LIST_W = 280;
const LINE_H = 15;
const CHART_PAD = 28;

type BalanceCat = "craft" | "weapons" | "enemies";
const CATS: BalanceCat[] = ["craft", "weapons", "enemies"];

type WeaponFilter = "all" | "player" | "enemy";
const WEAPON_FILTERS: WeaponFilter[] = ["all", "player", "enemy"];

type EnemyFilter = "all" | "troop" | "vehicle" | "aerial" | "building";
const ENEMY_FILTERS: EnemyFilter[] = ["all", "troop", "vehicle", "aerial", "building"];

type CraftFilter = "all" | "heli" | "vtol" | "plane";
const CRAFT_FILTERS: CraftFilter[] = ["all", "heli", "vtol", "plane"];

type AxisDef = { id: string; label: string };

type BalancePoint = {
  id: string;
  label: string;
  short: string;
  group: string;
  color: number;
  values: Record<string, number>;
};

const CRAFT_AXES: AxisDef[] = [
  { id: "health", label: "health" },
  { id: "maxSpeed", label: "maxSpeed" },
  { id: "forwardThrust", label: "forwardThrust" },
  { id: "strafeThrust", label: "strafeThrust" },
  { id: "verticalThrust", label: "verticalThrust" },
  { id: "yawRate", label: "yawRate" },
  { id: "radius", label: "radius" },
  { id: "maxAgl", label: "maxAgl" },
  { id: "ammoScale", label: "ammoScale" },
];

const WEAPON_AXES: AxisDef[] = [
  { id: "dps", label: "dps" },
  { id: "blast", label: "blast" },
  { id: "fireCd", label: "fireCd" },
  { id: "speed", label: "speed" },
  { id: "range", label: "range" },
  { id: "ammo", label: "ammo" },
];

const ENEMY_AXES: AxisDef[] = [
  { id: "health", label: "health" },
  { id: "radius", label: "radius" },
  { id: "driveSpd", label: "driveSpd" },
  { id: "wpnDps", label: "wpnDps" },
  { id: "wpnBlast", label: "wpnBlast" },
  { id: "wpnFireCd", label: "wpnFireCd" },
  { id: "wpnRange", label: "wpnRange" },
];

const CAT_AXES: Record<BalanceCat, AxisDef[]> = {
  craft: CRAFT_AXES,
  weapons: WEAPON_AXES,
  enemies: ENEMY_AXES,
};

const DEFAULT_AXES: Record<BalanceCat, { x: string; y: string }> = {
  craft: { x: "maxSpeed", y: "health" },
  weapons: { x: "fireCd", y: "dps" },
  enemies: { x: "health", y: "radius" },
};

const GROUP_COLORS: Record<string, number> = {
  heli: 0x6adf6a,
  vtol: 0x5ec8ff,
  plane: 0xe8b84a,
  player: 0x6adf6a,
  enemy: 0xff6a40,
  cannon: 0xe8b84a,
  rocket: 0xff8c42,
  missile: 0x5ec8ff,
  vehicle: 0xe8b84a,
  troop: 0xd878ff,
  aerial: 0x5ec8ff,
  building: 0xb0a890,
  other: 0x8a8470,
};

/**
 * Lazy balance scatter for craft / weapons / enemies.
 * Zero cost until opened — UI + catalog built on first toggle.
 */
export class BalanceConfigTool {
  open = false;
  private built = false;
  private scene: Phaser.Scene;
  private cat: BalanceCat = "craft";
  private xAxis = DEFAULT_AXES.craft.x;
  private yAxis = DEFAULT_AXES.craft.y;
  private idx = 0;
  private showLabels = true;
  private logScale = false;
  private weaponFilter: WeaponFilter = "all";
  private enemyFilter: EnemyFilter = "all";
  private craftFilter: CraftFilter = "all";
  private points: BalancePoint[] = [];
  root: Phaser.GameObjects.Container;
  private dim!: Phaser.GameObjects.Rectangle;
  private board!: Phaser.GameObjects.Graphics;
  private chart!: Phaser.GameObjects.Graphics;
  private listTxt!: Phaser.GameObjects.Text;
  private statsTxt!: Phaser.GameObjects.Text;
  private hintTxt!: Phaser.GameObjects.Text;
  private labelPool: Phaser.GameObjects.Text[] = [];
  private uiCam!: Phaser.Cameras.Scene2D.Camera;
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
    this.points = buildBalanceCatalog();
    const scene = this.scene;
    const w = scene.scale.width;
    const h = scene.scale.height;
    this.dim = scene.add
      .rectangle(0, 0, w, h, 0x0c0a08, 0.78)
      .setOrigin(0)
      .setScrollFactor(0)
      .setDepth(DEPTH)
      .setVisible(false);
    this.board = scene.add.graphics().setScrollFactor(0).setDepth(DEPTH + 1).setVisible(false);
    this.chart = scene.add.graphics().setScrollFactor(0).setDepth(DEPTH + 2).setVisible(false);
    this.listTxt = makeConfigText(scene, DEPTH + 4, { fontSize: "12px", lineSpacing: 2, color: PAPER });
    this.listTxt.setPosition(LIST_X, LIST_Y);
    this.statsTxt = makeConfigText(scene, DEPTH + 4, {
      fontSize: "12px",
      lineSpacing: 3,
      color: PAPER,
      wrapW: 360,
    });
    this.hintTxt = scene.add
      .text(18, 14, "", { fontFamily: MONO, fontSize: "12px", color: GOLD })
      .setScrollFactor(0)
      .setDepth(DEPTH + 4)
      .setVisible(false);
    nameGameTexture(scene, this.listTxt, "ui_balance_list");
    nameGameTexture(scene, this.statsTxt, "ui_balance_stats");
    nameGameTexture(scene, this.hintTxt, "ui_balance_hint");
    this.root.add([this.dim, this.board, this.chart, this.listTxt, this.statsTxt, this.hintTxt]);

    this.uiCam = scene.cameras.add(0, 0, w, h, false, "balanceRig");
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
      kb.addKey(Phaser.Input.Keyboard.KeyCodes.G).on("down", () => {
        if (!this.open) return;
        this.cycleCategory(1);
      });
      kb.addKey(Phaser.Input.Keyboard.KeyCodes.X).on("down", () => {
        if (!this.open) return;
        this.cycleAxis("x", 1);
      });
      kb.addKey(Phaser.Input.Keyboard.KeyCodes.Y).on("down", () => {
        if (!this.open) return;
        this.cycleAxis("y", 1);
      });
      kb.addKey(Phaser.Input.Keyboard.KeyCodes.COMMA).on("down", () => {
        if (!this.open) return;
        this.cycleAxis("x", 1);
      });
      kb.addKey(Phaser.Input.Keyboard.KeyCodes.PERIOD).on("down", () => {
        if (!this.open) return;
        this.cycleAxis("y", 1);
      });
      kb.addKey(Phaser.Input.Keyboard.KeyCodes.O).on("down", () => {
        if (!this.open) return;
        this.showLabels = !this.showLabels;
        this.refresh();
      });
      kb.addKey(Phaser.Input.Keyboard.KeyCodes.F).on("down", () => {
        if (!this.open) return;
        this.cycleFilter(1);
      });
      kb.addKey(Phaser.Input.Keyboard.KeyCodes.L).on("down", () => {
        if (!this.open) return;
        this.logScale = !this.logScale;
        this.refresh();
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
    this.chart.setVisible(this.open);
    this.listTxt.setVisible(this.open);
    this.statsTxt.setVisible(this.open);
    this.hintTxt.setVisible(this.open);
    this.scene.input.setDefaultCursor(this.open ? "default" : "none");
    this.uiCam.setVisible(this.open);
    if (this.open) this.refresh();
    else {
      this.chart.clear();
      this.board.clear();
      for (const t of this.labelPool) t.setVisible(false);
    }
  }

  cycle(dir: number): void {
    if (!this.open) return;
    const items = this.filtered();
    if (!items.length) return;
    this.idx = (this.idx + dir + items.length) % items.length;
    this.refresh();
  }

  update(): void {
    if (!this.open) return;
    const filter = this.filterLabel();
    this.hintTxt.setText(
      `BALANCE RIG   \` close   [ ] select   G ${this.cat.toUpperCase()}   F ${filter}   X/Y axes   L log ${this.logScale ? "ON" : "off"}   O labels ${this.showLabels ? "ON" : "OFF"}`
    );
  }

  private filterLabel(): string {
    if (this.cat === "weapons") return this.weaponFilter.toUpperCase();
    if (this.cat === "enemies") return this.enemyFilter.toUpperCase();
    return this.craftFilter.toUpperCase();
  }

  private cycleCategory(dir: number): void {
    const i = CATS.indexOf(this.cat);
    this.cat = CATS[(i + dir + CATS.length) % CATS.length]!;
    this.xAxis = DEFAULT_AXES[this.cat].x;
    this.yAxis = DEFAULT_AXES[this.cat].y;
    this.idx = 0;
    this.refresh();
  }

  private cycleFilter(dir: number): void {
    if (this.cat === "weapons") {
      const i = WEAPON_FILTERS.indexOf(this.weaponFilter);
      this.weaponFilter = WEAPON_FILTERS[(i + dir + WEAPON_FILTERS.length) % WEAPON_FILTERS.length]!;
    } else if (this.cat === "enemies") {
      const i = ENEMY_FILTERS.indexOf(this.enemyFilter);
      this.enemyFilter = ENEMY_FILTERS[(i + dir + ENEMY_FILTERS.length) % ENEMY_FILTERS.length]!;
    } else {
      const i = CRAFT_FILTERS.indexOf(this.craftFilter);
      this.craftFilter = CRAFT_FILTERS[(i + dir + CRAFT_FILTERS.length) % CRAFT_FILTERS.length]!;
    }
    this.idx = 0;
    this.refresh();
  }

  private cycleAxis(which: "x" | "y", dir: number): void {
    const axes = CAT_AXES[this.cat];
    const cur = which === "x" ? this.xAxis : this.yAxis;
    const i = Math.max(0, axes.findIndex((a) => a.id === cur));
    const next = axes[(i + dir + axes.length) % axes.length]!.id;
    if (which === "x") this.xAxis = next;
    else this.yAxis = next;
    this.refresh();
  }

  private filtered(): BalancePoint[] {
    const prefix = `${this.cat}:`;
    return this.points.filter((p) => {
      if (!p.id.startsWith(prefix)) return false;
      if (this.cat === "weapons") {
        if (this.weaponFilter === "all") return true;
        return p.id.startsWith(`weapons:${this.weaponFilter}:`);
      }
      if (this.cat === "enemies") {
        if (this.enemyFilter === "all") return true;
        return p.group === this.enemyFilter;
      }
      if (this.craftFilter === "all") return true;
      return p.group === this.craftFilter;
    });
  }

  private pageSize(): number {
    return Math.max(8, Math.floor((this.scene.scale.height - LIST_Y - 80) / LINE_H));
  }

  private pickFromList(py: number): void {
    const items = this.filtered();
    const size = this.pageSize();
    const rowI = Math.floor((py - LIST_Y) / LINE_H) - 1;
    if (rowI < 0 || rowI >= size) return;
    const winStart = Phaser.Math.Clamp(
      this.idx - Math.floor(size / 2),
      0,
      Math.max(0, items.length - size)
    );
    const i = winStart + rowI;
    if (i < 0 || i >= items.length) return;
    this.idx = i;
    this.refresh();
  }

  private refresh(): void {
    const items = this.filtered();
    if (!items.length) {
      this.listTxt.setText(`— ${this.cat.toUpperCase()} (empty) —`);
      this.statsTxt.setText("");
      this.chart.clear();
      this.board.clear();
      return;
    }
    if (this.idx >= items.length) this.idx = 0;
    const selected = items[this.idx]!;
    const size = this.pageSize();
    const winStart = Phaser.Math.Clamp(
      this.idx - Math.floor(size / 2),
      0,
      Math.max(0, items.length - size)
    );
    const slice = items.slice(winStart, winStart + size);
    this.listTxt.setText(
      [
        `— ${this.cat.toUpperCase()}  ${this.idx + 1}/${items.length} —`,
        ...slice.map((p, i) => {
          const mark = winStart + i === this.idx ? "▸" : " ";
          return `${mark} ${p.label.padEnd(20)} ${p.group}`;
        }),
      ].join("\n")
    );

    const axes = CAT_AXES[this.cat];
    const xDef = axes.find((a) => a.id === this.xAxis) ?? axes[0]!;
    const yDef = axes.find((a) => a.id === this.yAxis) ?? axes[1] ?? axes[0]!;
    const valueLines = axes.map((a) => row(a.label, fmtNum(selected.values[a.id] ?? 0)));
    this.statsTxt.setText(
      [
        selected.label,
        `${selected.group} · ${selected.id}`,
        "",
        `X  ${xDef.label}`,
        `Y  ${yDef.label}`,
        "",
        ...valueLines,
      ].join("\n")
    );

    this.drawChart(items, selected, xDef, yDef);
  }

  private drawChart(
    items: BalancePoint[],
    selected: BalancePoint,
    xDef: AxisDef,
    yDef: AxisDef
  ): void {
    const w = this.scene.scale.width;
    const h = this.scene.scale.height;
    const left = LIST_X + LIST_W + 24;
    const right = w - 24;
    const top = 56;
    const bottom = h - 36;
    const statsX = right - 360;
    this.statsTxt.setPosition(statsX, top);

    const plotL = left;
    const plotR = Math.min(statsX - 24, right - 20);
    const plotT = top + 8;
    const plotB = bottom - 8;
    const plotW = Math.max(120, plotR - plotL);
    const plotH = Math.max(120, plotB - plotT);

    this.board.clear();
    this.board.fillStyle(0x14110e, 0.92);
    this.board.fillRect(plotL - 8, plotT - 8, plotW + 16, plotH + 16);
    this.board.lineStyle(1, 0x3a3428, 0.9);
    this.board.strokeRect(plotL - 8, plotT - 8, plotW + 16, plotH + 16);

    const xs = items.map((p) => p.values[xDef.id] ?? 0);
    const ys = items.map((p) => p.values[yDef.id] ?? 0);
    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    const yMin = Math.min(...ys);
    const yMax = Math.max(...ys);
    const xPad = (xMax - xMin) * 0.08 || Math.max(1, Math.abs(xMax) * 0.1) || 1;
    const yPad = (yMax - yMin) * 0.08 || Math.max(1, Math.abs(yMax) * 0.1) || 1;
    const x0 = xMin - xPad;
    const x1 = xMax + xPad;
    const y0 = yMin - yPad;
    const y1 = yMax + yPad;

    const toX = (v: number) => plotL + CHART_PAD + ((v - x0) / (x1 - x0)) * (plotW - CHART_PAD * 2);
    const toY = (v: number) => plotB - CHART_PAD - ((v - y0) / (y1 - y0)) * (plotH - CHART_PAD * 2);

    this.chart.clear();
    // Grid
    this.chart.lineStyle(1, 0x2a261c, 0.85);
    for (let i = 0; i <= 4; i++) {
      const gx = plotL + CHART_PAD + ((plotW - CHART_PAD * 2) * i) / 4;
      const gy = plotT + CHART_PAD + ((plotH - CHART_PAD * 2) * i) / 4;
      this.chart.lineBetween(gx, plotT + CHART_PAD, gx, plotB - CHART_PAD);
      this.chart.lineBetween(plotL + CHART_PAD, gy, plotR - CHART_PAD, gy);
    }
    this.chart.lineStyle(1.5, 0x5a5040, 1);
    this.chart.strokeRect(plotL + CHART_PAD, plotT + CHART_PAD, plotW - CHART_PAD * 2, plotH - CHART_PAD * 2);

    // Axis titles via hint-adjacent board text in stats; draw ticks as dots.
    for (const p of items) {
      const xv = p.values[xDef.id] ?? 0;
      const yv = p.values[yDef.id] ?? 0;
      const px = toX(xv);
      const py = toY(yv);
      const sel = p === selected;
      const r = sel ? 7 : 4.5;
      this.chart.fillStyle(p.color, sel ? 1 : 0.82);
      this.chart.fillCircle(px, py, r);
      if (sel) {
        this.chart.lineStyle(2, 0xffffff, 0.95);
        this.chart.strokeCircle(px, py, r + 3);
      }
    }

    // Axis end labels (always on) + optional point names.
    this.ensureLabels(items.length + 6);
    let li = 0;
    const place = (text: string, x: number, y: number, color = CFG_INFO) => {
      const t = this.labelPool[li++]!;
      t.setText(text)
        .setPosition(x, y)
        .setColor(color)
        .setVisible(true)
        .setOrigin(0, 0);
    };
    place(`${xDef.label} →`, plotL + CHART_PAD, plotB - 18, GOLD);
    place(`↑ ${yDef.label}`, plotL + 4, plotT + CHART_PAD, GOLD);
    place(fmtNum(x0), plotL + CHART_PAD, plotB - CHART_PAD + 4);
    place(fmtNum(x1), plotR - CHART_PAD - 40, plotB - CHART_PAD + 4);
    place(fmtNum(y0), plotL + 2, plotB - CHART_PAD - 12);
    place(fmtNum(y1), plotL + 2, plotT + CHART_PAD);

    if (this.showLabels) {
      for (const p of items) {
        if (li >= this.labelPool.length) this.ensureLabels(li + 8);
        const xv = p.values[xDef.id] ?? 0;
        const yv = p.values[yDef.id] ?? 0;
        const t = this.labelPool[li++]!;
        t.setText(p.short)
          .setPosition(toX(xv) + 8, toY(yv) - 8)
          .setColor(p === selected ? PAPER : CFG_INFO)
          .setVisible(true)
          .setOrigin(0, 0.5);
      }
    }
    while (li < this.labelPool.length) {
      this.labelPool[li++]!.setVisible(false);
    }
  }

  private ensureLabels(n: number): void {
    while (this.labelPool.length < n) {
      // Keep off the main display list; parent into root for the UI camera.
      const t = this.scene.make.text({
        x: 0,
        y: 0,
        text: "",
        style: { fontFamily: MONO, fontSize: "11px", color: CFG_INFO },
        add: false,
      });
      t.setScrollFactor(0).setDepth(DEPTH + 5).setVisible(false);
      nameGameTexture(this.scene, t, `ui_balance_label_${this.labelPool.length}`);
      this.root.add(t);
      // addedtoscene ignore-all can still tag container children — allow uiCam through.
      t.cameraFilter &= ~this.uiCam.id;
      this.labelPool.push(t);
    }
  }
}

function fmtNum(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a >= 100) return v.toFixed(0);
  if (a >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

function colorOf(group: string): number {
  return GROUP_COLORS[group] ?? GROUP_COLORS.other!;
}

function buildBalanceCatalog(): BalancePoint[] {
  const out: BalancePoint[] = [];

  for (const c of allCrafts()) {
    out.push({
      id: `craft:${c.kind}`,
      label: c.name,
      short: c.name,
      group: c.flightModel,
      color: colorOf(c.flightModel),
      values: {
        health: c.health,
        maxSpeed: c.maxSpeed,
        forwardThrust: c.forwardThrust,
        strafeThrust: c.strafeThrust,
        verticalThrust: c.verticalThrust,
        yawRate: c.yawRate,
        radius: c.radius,
        maxAgl: c.maxAgl,
        ammoScale: c.ammoScale,
      },
    });
  }

  for (const w of Object.values(PLAYER_WPNS)) {
    const kindGroup =
      w.kind === "cannon" ? "cannon" : w.kind === "rocket" ? "rocket" : "missile";
    out.push({
      id: `weapons:player:${w.id}`,
      label: w.name,
      short: w.name.length > 12 ? w.name.slice(0, 11) + "…" : w.name,
      group: `player/${kindGroup}`,
      color: colorOf("player"),
      values: {
        // Rate-normalized damage (dmg / fireCd).
        dps: w.fireCd > 0 ? w.dmg / w.fireCd : 0,
        blast: w.blast,
        fireCd: w.fireCd,
        speed: w.speed,
        // Approx engagement reach so player + enemy can share a range axis.
        range: w.speed * w.life,
        ammo: w.ammo,
      },
    });
  }

  for (const p of ENEMY_WPNS) {
    const w = p.w;
    const kindGroup =
      w.kind === "cannon" ? "cannon" : w.kind === "rocket" ? "rocket" : "missile";
    out.push({
      id: `weapons:enemy:${p.id}`,
      label: p.label,
      short: p.label,
      group: `enemy/${kindGroup}`,
      color: colorOf("enemy"),
      values: {
        dps: w.fireCd > 0 ? w.dmg / w.fireCd : 0,
        blast: w.blast,
        fireCd: w.fireCd,
        speed: w.speed,
        range: w.range,
        ammo: 0,
      },
    });
  }

  for (const kind of allKinds()) {
    const sp = specOf(kind);
    const w = sp.weapon;
    let group = "other";
    if (sp.building) group = "building";
    else if (sp.organic || sp.move === "inf" || sp.move === "flee") group = "troop";
    else if (sp.move === "heli" || sp.move === "drone" || sp.flyZ != null) group = "aerial";
    else if (sp.move === "tank" || sp.move === "vehicle" || sp.move === "boat") group = "vehicle";
    else if (sp.move === "static") group = "building";
    out.push({
      id: `enemies:${kind}`,
      label: sp.label,
      short: sp.label.length > 14 ? sp.label.slice(0, 13) + "…" : sp.label,
      group,
      color: colorOf(group),
      values: {
        health: sp.health,
        radius: sp.radius,
        driveSpd: sp.drive?.maxSpd ?? 0,
        wpnDps: w && w.fireCd > 0 ? w.dmg / w.fireCd : 0,
        wpnBlast: w?.blast ?? 0,
        wpnFireCd: w?.fireCd ?? 0,
        wpnRange: w?.range ?? 0,
      },
    });
  }

  return out;
}
