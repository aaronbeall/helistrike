import Phaser from "phaser";
import { PLAYER_WPNS, type PlayerWpnSpec, type UnitClass } from "../sim/combat";
import { RIG_INFO, RIG_VALUE, makeRigText, row, setStackedTexts, syncRigSystemCursor } from "./rigUi";
import { allCrafts, craftSocketFireStreams, craftSocketIsPrimary } from "../sim/craft";
import {
  ENEMY_WPNS,
  allKinds,
  partsRollOf,
  specOf,
  type ShotKind,
  type UnitKind,
  type UnitSpec,
  type WeaponSpec,
} from "../sim/roster";
import { nameGameTexture } from "../art/sprites";

const DEPTH = 9500;
const MONO = "Share Tech Mono, monospace";
const GOLD = "#e8b84a";
const PAPER = RIG_VALUE;
const LIST_X = 16;
const LIST_Y = 40;
const LIST_W = 280;
const LINE_H = 15;
/** Inner plot padding from the chart board edges (room for ticks + titles). */
const PAD_L = 54;
const PAD_R = 18;
const PAD_T = 18;
const PAD_B = 44;

const UNIT_CLASSES: readonly UnitClass[] = ["air", "vehicle", "building", "troop"];

type BalanceCat = "craft" | "weapons" | "enemies";
const CATS: BalanceCat[] = ["craft", "weapons", "enemies"];

type WeaponFilter =
  | "all"
  | "player"
  | "enemy"
  | "cannon"
  | "rocket"
  | "missile"
  | "lock-on"
  | "guided"
  | "bomb"
  | "beam";
const WEAPON_FILTERS: WeaponFilter[] = [
  "all",
  "player",
  "enemy",
  "cannon",
  "rocket",
  "missile",
  "lock-on",
  "guided",
  "bomb",
  "beam",
];

type EnemyFilter = "all" | "troop" | "vehicle" | "aerial" | "building";
const ENEMY_FILTERS: EnemyFilter[] = ["all", "troop", "vehicle", "aerial", "building"];

type CraftFilter = "all" | "heli" | "vtol" | "plane";
const CRAFT_FILTERS: CraftFilter[] = ["all", "heli", "vtol", "plane"];

/** Chartable metric. `id` is the values key / axis title (real field path when possible). */
type AxisDef = {
  id: string;
  /** Extra detail keys to highlight when this axis is mapped (composites). */
  highlight?: string[];
};

type BalancePoint = {
  id: string;
  label: string;
  short: string;
  group: string;
  color: number;
  values: Record<string, number>;
  /** Extra match keys for F-cycle filters (weapons: type + side). */
  tags?: string[];
};

const CRAFT_AXES: AxisDef[] = [
  { id: "health" },
  { id: "maxSpeed" },
  {
    id: "thrust",
    highlight: ["forwardThrust", "strafeThrust", "verticalThrust"],
  },
  {
    id: "firepower",
    // Component keys: primary/secondary totals + `loadout.<wpnId>` — expanded at highlight time.
    // Class firepower uses dmgMul; base firepower stays unmodified.
    highlight: [
      "primaryFirepower",
      "secondaryFirepower",
      "firepower.air",
      "firepower.vehicle",
      "firepower.building",
      "firepower.troop",
    ],
  },
  { id: "primaryFirepower" },
  { id: "secondaryFirepower" },
  { id: "firepower.air" },
  { id: "firepower.vehicle" },
  { id: "firepower.building" },
  { id: "firepower.troop" },
  { id: "yawRate" },
  { id: "radius" },
  { id: "maxAgl" },
  { id: "ammoScale" },
];

const WEAPON_AXES: AxisDef[] = [
  {
    id: "dps",
    // Base dps is unmodified; class keys apply dmgMul.
    highlight: [
      "dps.air",
      "dps.vehicle",
      "dps.building",
      "dps.troop",
      "dmg",
      "fireCd",
      "salvo.count",
      "salvo.interval",
      "burst",
      "burstGap",
    ],
  },
  { id: "dps.air" },
  { id: "dps.vehicle" },
  { id: "dps.building" },
  { id: "dps.troop" },
  { id: "blast" },
  { id: "speed" },
  { id: "range", highlight: ["life"] },
  { id: "ammo" },
];

const ENEMY_AXES: AxisDef[] = [
  { id: "health" },
  { id: "radius" },
  { id: "drive.maxSpd" },
  {
    id: "dps",
    highlight: [
      "weapon.dps",
      "guns.dps",
      "secondary.dps",
      "guns.count",
      "secondary.mounts",
      "weapon.dmg",
      "weapon.fireCd",
      "weapon.burst",
      "weapon.burstGap",
    ],
  },
  { id: "weapon.blast" },
  { id: "weapon.range" },
];

const CAT_AXES: Record<BalanceCat, AxisDef[]> = {
  craft: CRAFT_AXES,
  weapons: WEAPON_AXES,
  enemies: ENEMY_AXES,
};

/** Preferred detail-panel order (mapped keys float to the top regardless). */
const CAT_DETAIL_ORDER: Record<BalanceCat, string[]> = {
  craft: [
    "health",
    "maxSpeed",
    "thrust",
    "forwardThrust",
    "strafeThrust",
    "verticalThrust",
    "firepower",
    "primaryFirepower",
    "secondaryFirepower",
    "firepower.air",
    "firepower.vehicle",
    "firepower.building",
    "firepower.troop",
    "yawRate",
    "radius",
    "maxAgl",
    "ammoScale",
  ],
  weapons: [
    "dps",
    "dps.air",
    "dps.vehicle",
    "dps.building",
    "dps.troop",
    "dmg",
    "blast",
    "fireCd",
    "speed",
    "life",
    "range",
    "ammo",
    "salvo.count",
    "salvo.interval",
    "burst",
    "burstGap",
  ],
  enemies: [
    "health",
    "radius",
    "drive.maxSpd",
    "dps",
    "weapon.dps",
    "guns.dps",
    "secondary.dps",
    "guns.count",
    "secondary.mounts",
    "weapon.dmg",
    "weapon.blast",
    "weapon.fireCd",
    "weapon.range",
    "weapon.burst",
    "weapon.burstGap",
  ],
};

const DEFAULT_AXES: Record<BalanceCat, { x: string; y: string }> = {
  craft: { x: "maxSpeed", y: "health" },
  weapons: { x: "range", y: "dps" },
  enemies: { x: "health", y: "radius" },
};

type ChartView = "scatter" | "bars" | "profile" | "ratio";
const CHART_VIEWS: ChartView[] = ["scatter", "bars", "profile", "ratio"];
const VIEW_LABEL: Record<ChartView, string> = {
  scatter: "SCATTER",
  bars: "BARS",
  profile: "PROFILE",
  ratio: "RATIO",
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
  "lock-on": 0x7ad0ff,
  guided: 0x4a9fff,
  bomb: 0xc4a06a,
  beam: 0x66e0e8,
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
export class BalanceRig {
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
  private view: ChartView = "scatter";
  private points: BalancePoint[] = [];
  private chartHits: { x0: number; y0: number; x1: number; y1: number; id: string; axis?: string }[] =
    [];
  root: Phaser.GameObjects.Container;
  private dim!: Phaser.GameObjects.Rectangle;
  private board!: Phaser.GameObjects.Graphics;
  private chart!: Phaser.GameObjects.Graphics;
  private listTxt!: Phaser.GameObjects.Text;
  private statsHeadTxt!: Phaser.GameObjects.Text;
  private statsHotTxt!: Phaser.GameObjects.Text;
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
    this.listTxt = makeRigText(scene, DEPTH + 4, { fontSize: "12px", lineSpacing: 2, color: PAPER });
    this.listTxt.setPosition(LIST_X, LIST_Y);
    const statsStyle = { fontSize: "12px", lineSpacing: 3, wrapW: 360 } as const;
    this.statsHeadTxt = makeRigText(scene, DEPTH + 4, { ...statsStyle, color: PAPER });
    this.statsHotTxt = makeRigText(scene, DEPTH + 4, { ...statsStyle, color: GOLD });
    this.statsTxt = makeRigText(scene, DEPTH + 4, { ...statsStyle, color: PAPER });
    this.hintTxt = scene.add
      .text(18, 14, "", { fontFamily: MONO, fontSize: "12px", color: GOLD })
      .setScrollFactor(0)
      .setDepth(DEPTH + 4)
      .setVisible(false);
    nameGameTexture(scene, this.listTxt, "rig_balance_list");
    nameGameTexture(scene, this.statsHeadTxt, "rig_balance_stats_head");
    nameGameTexture(scene, this.statsHotTxt, "rig_balance_stats_hot");
    nameGameTexture(scene, this.statsTxt, "rig_balance_stats");
    nameGameTexture(scene, this.hintTxt, "rig_balance_hint");
    this.root.add([
      this.dim,
      this.board,
      this.chart,
      this.listTxt,
      this.statsHeadTxt,
      this.statsHotTxt,
      this.statsTxt,
      this.hintTxt,
    ]);

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
      kb.addKey(Phaser.Input.Keyboard.KeyCodes.V).on("down", () => {
        if (!this.open) return;
        this.cycleView(1);
      });
    }

    scene.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      if (!this.open || !p.leftButtonDown()) return;
      if (p.x >= LIST_X && p.x < LIST_X + LIST_W) this.pickFromList(p.y);
      else this.pickFromChart(p.x, p.y);
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
    this.statsHeadTxt.setVisible(this.open);
    this.statsHotTxt.setVisible(this.open);
    this.statsTxt.setVisible(this.open);
    this.hintTxt.setVisible(this.open);
    syncRigSystemCursor(this.scene);
    this.uiCam.setVisible(this.open);
    if (this.open) this.refresh();
    else {
      this.chart.clear();
      this.board.clear();
      this.chartHits = [];
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
    const viewHint =
      this.view === "bars"
        ? `V ${VIEW_LABEL[this.view]} · Y`
        : this.view === "ratio"
          ? `V ${VIEW_LABEL[this.view]} · Y/X`
          : `V ${VIEW_LABEL[this.view]}`;
    this.hintTxt.setText(
      `BALANCE RIG   ↑ ↓ select   G ${this.cat.toUpperCase()}   F ${filter}   ${viewHint}   X/Y axes   L log ${this.logScale ? "ON" : "off"}   O labels ${this.showLabels ? "ON" : "OFF"}`
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

  private cycleView(dir: number): void {
    const i = CHART_VIEWS.indexOf(this.view);
    this.view = CHART_VIEWS[(i + dir + CHART_VIEWS.length) % CHART_VIEWS.length]!;
    this.refresh();
  }

  private pickFromChart(px: number, py: number): void {
    const hit = this.chartHits.find((h) => px >= h.x0 && px <= h.x1 && py >= h.y0 && py <= h.y1);
    if (!hit) return;
    if (hit.axis) {
      this.yAxis = hit.axis;
      this.refresh();
      return;
    }
    const items = this.filtered();
    const i = items.findIndex((p) => p.id === hit.id);
    if (i < 0) return;
    this.idx = i;
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
        if (this.weaponFilter === "player" || this.weaponFilter === "enemy") {
          return p.id.startsWith(`weapons:${this.weaponFilter}:`);
        }
        return p.tags?.includes(this.weaponFilter) ?? false;
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
      this.statsHeadTxt.setText("");
      this.statsHotTxt.setText("");
      this.statsTxt.setText("");
      this.chart.clear();
      this.board.clear();
      this.chartHits = [];
      for (const t of this.labelPool) t.setVisible(false);
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
        `— ${this.cat.toUpperCase()} · ${this.filterLabel()}  ${this.idx + 1}/${items.length} —`,
        ...slice.map((p, i) => {
          const mark = winStart + i === this.idx ? "▸" : " ";
          return `${mark} ${p.label.padEnd(20)} ${p.group}`;
        }),
      ].join("\n")
    );

    const axes = CAT_AXES[this.cat];
    const xDef = axes.find((a) => a.id === this.xAxis) ?? axes[0]!;
    const yDef = axes.find((a) => a.id === this.yAxis) ?? axes[1] ?? axes[0]!;
    const detailOrder = CAT_DETAIL_ORDER[this.cat];
    const ordered = orderedValueKeys(detailOrder, selected.values);
    const hotKeys = hotKeysXThenY(axes, this.xAxis, this.yAxis, detailOrder, selected.values);
    const hotSet = new Set(hotKeys);
    const hotLines = hotKeys.map((k) =>
      row(axisStatLabel(k, this.xAxis, this.yAxis), fmtNum(selected.values[k] ?? 0))
    );
    const restLines = ordered
      .filter((k) => !hotSet.has(k))
      .map((k) => row(k, fmtNum(selected.values[k] ?? 0)));
    this.drawChart(items, selected, xDef, yDef, {
      head: [selected.label, `${selected.group} · ${selected.id}`, ""],
      hot: hotLines,
      rest: restLines,
    });
  }

  private drawChart(
    items: BalancePoint[],
    selected: BalancePoint,
    xDef: AxisDef,
    yDef: AxisDef,
    stats: { head: string[]; hot: string[]; rest: string[] }
  ): void {
    const frame = this.beginPlot(stats, this.view === "scatter" ? PAD_L : 108);
    this.chartHits = [];
    this.chart.clear();
    if (this.view === "bars") {
      this.drawRankedBars(frame, items, selected, (p) => p.values[yDef.id] ?? 0, yDef.id, "Y");
      return;
    }
    if (this.view === "ratio") {
      const title = `${yDef.id} / ${xDef.id}`;
      this.drawRankedBars(
        frame,
        items,
        selected,
        (p) => ratioValue(p.values[yDef.id] ?? 0, p.values[xDef.id] ?? 0),
        title,
        "Y/X"
      );
      return;
    }
    if (this.view === "profile") {
      this.drawProfile(frame, items, selected);
      return;
    }
    this.drawScatter(frame, items, selected, xDef, yDef);
  }

  private beginPlot(
    stats: { head: string[]; hot: string[]; rest: string[] },
    padL: number
  ): PlotFrame {
    const w = this.scene.scale.width;
    const h = this.scene.scale.height;
    const left = LIST_X + LIST_W + 24;
    const right = w - 24;
    const top = 56;
    const bottom = h - 36;
    const statsX = right - 360;
    setStackedTexts(
      [
        { txt: this.statsHeadTxt, lines: stats.head },
        { txt: this.statsHotTxt, lines: stats.hot },
        { txt: this.statsTxt, lines: stats.rest },
      ],
      statsX,
      top,
      6
    );

    const plotL = left;
    const plotR = Math.min(statsX - 24, right - 20);
    const plotT = top + 8;
    const plotB = bottom - 8;
    const plotW = Math.max(120, plotR - plotL);
    const plotH = Math.max(120, plotB - plotT);
    const ix0 = plotL + padL;
    const iy0 = plotT + PAD_T;
    const ix1 = plotR - PAD_R;
    const iy1 = plotB - PAD_B;
    const innerW = Math.max(40, ix1 - ix0);
    const innerH = Math.max(40, iy1 - iy0);

    this.board.clear();
    this.board.fillStyle(0x14110e, 0.92);
    this.board.fillRect(plotL - 8, plotT - 8, plotW + 16, plotH + 16);
    this.board.lineStyle(1, 0x3a3428, 0.9);
    this.board.strokeRect(plotL - 8, plotT - 8, plotW + 16, plotH + 16);

    return { plotL, plotR, plotT, plotB, ix0, iy0, ix1, iy1, innerW, innerH };
  }

  private hideLabelsFrom(li: number): void {
    while (li < this.labelPool.length) {
      this.labelPool[li++]!.setVisible(false).setRotation(0);
    }
  }

  private labelAt(i: number): Phaser.GameObjects.Text {
    this.ensureLabels(i + 1);
    return this.labelPool[i]!;
  }

  private drawScatter(
    frame: PlotFrame,
    items: BalancePoint[],
    selected: BalancePoint,
    xDef: AxisDef,
    yDef: AxisDef
  ): void {
    const { plotL, ix0, iy0, ix1, iy1, innerW, innerH } = frame;
    const xs = items.map((p) => p.values[xDef.id] ?? 0);
    const ys = items.map((p) => p.values[yDef.id] ?? 0);
    const xDomain = axisDomain(Math.min(...xs), Math.max(...xs), this.logScale);
    const yDomain = axisDomain(Math.min(...ys), Math.max(...ys), this.logScale);
    const toX = (v: number) => ix0 + axisNorm(v, xDomain, this.logScale) * innerW;
    const toY = (v: number) => iy1 - axisNorm(v, yDomain, this.logScale) * innerH;

    this.chart.lineStyle(1, 0x2a261c, 0.85);
    for (let i = 0; i <= 4; i++) {
      const gx = ix0 + (innerW * i) / 4;
      const gy = iy0 + (innerH * i) / 4;
      this.chart.lineBetween(gx, iy0, gx, iy1);
      this.chart.lineBetween(ix0, gy, ix1, gy);
    }
    const medX = median(xs);
    const medY = median(ys);
    this.chart.lineStyle(1, 0x8a7a50, 0.4);
    this.chart.lineBetween(toX(medX), iy0, toX(medX), iy1);
    this.chart.lineBetween(ix0, toY(medY), ix1, toY(medY));
    this.chart.lineStyle(1.5, 0x5a5040, 1);
    this.chart.strokeRect(ix0, iy0, innerW, innerH);

    for (const p of items) {
      const px = toX(p.values[xDef.id] ?? 0);
      const py = toY(p.values[yDef.id] ?? 0);
      const sel = p === selected;
      const r = sel ? 7 : 4.5;
      this.chart.fillStyle(p.color, sel ? 1 : 0.82);
      this.chart.fillCircle(px, py, r);
      if (sel) {
        this.chart.lineStyle(2, 0xffffff, 0.95);
        this.chart.strokeCircle(px, py, r + 3);
      }
      this.chartHits.push({ x0: px - 10, y0: py - 10, x1: px + 10, y1: py + 10, id: p.id });
    }

    let li = 0;
    const xTitle = this.logScale ? `log ${xDef.id} (X)` : `${xDef.id} (X)`;
    const yTitle = this.logScale ? `log ${yDef.id} (Y)` : `${yDef.id} (Y)`;
    li = this.placeLabel(li, yTitle, plotL + 12, (iy0 + iy1) * 0.5, GOLD, 0.5, 0.5, -Math.PI / 2);
    li = this.placeLabel(li, fmtNum(yDomain.hi), ix0 - 6, iy0, RIG_INFO, 1, 0.5);
    li = this.placeLabel(li, fmtNum(yDomain.lo), ix0 - 6, iy1, RIG_INFO, 1, 0.5);
    li = this.placeLabel(li, fmtNum(xDomain.lo), ix0, iy1 + 6, RIG_INFO, 0, 0);
    li = this.placeLabel(li, fmtNum(xDomain.hi), ix1, iy1 + 6, RIG_INFO, 1, 0);
    li = this.placeLabel(li, xTitle, (ix0 + ix1) * 0.5, iy1 + 24, GOLD, 0.5, 0);
    li = this.placeLabel(li, `med ${fmtNum(medY)} / ${fmtNum(medX)}`, ix1, iy0 - 4, "#8a7a50", 1, 1);

    if (this.showLabels) {
      for (const p of items) {
        li = this.placeLabel(
          li,
          p.short,
          toX(p.values[xDef.id] ?? 0) + 8,
          toY(p.values[yDef.id] ?? 0) - 8,
          p === selected ? PAPER : RIG_INFO,
          0,
          0.5
        );
      }
    }
    this.hideLabelsFrom(li);
  }

  private drawRankedBars(
    frame: PlotFrame,
    items: BalancePoint[],
    selected: BalancePoint,
    valueOf: (p: BalancePoint) => number,
    metric: string,
    axisTag: string
  ): void {
    const { plotL, ix0, iy0, ix1, iy1, innerW, innerH } = frame;
    const ranked = [...items].sort((a, b) => valueOf(b) - valueOf(a) || a.label.localeCompare(b.label));
    const vals = ranked.map(valueOf);
    const domain = barDomain(Math.min(...vals), Math.max(...vals), this.logScale);
    const med = median(vals);
    const minRow = 12;
    const maxFit = Math.max(6, Math.floor(innerH / minRow));
    let vis = ranked;
    if (ranked.length > maxFit) {
      const selI = Math.max(0, ranked.indexOf(selected));
      const start = Phaser.Math.Clamp(selI - Math.floor(maxFit / 2), 0, ranked.length - maxFit);
      vis = ranked.slice(start, start + maxFit);
    }
    const rowH = innerH / vis.length;
    const barH = Math.max(5, rowH * 0.62);

    this.chart.lineStyle(1, 0x2a261c, 0.85);
    for (let i = 1; i <= 4; i++) {
      const gx = ix0 + (innerW * i) / 4;
      this.chart.lineBetween(gx, iy0, gx, iy1);
    }
    const medX = ix0 + axisNorm(med, domain, this.logScale) * innerW;
    this.chart.lineStyle(1, 0x8a7a50, 0.55);
    this.chart.lineBetween(medX, iy0, medX, iy1);
    this.chart.lineStyle(1.5, 0x5a5040, 1);
    this.chart.strokeRect(ix0, iy0, innerW, innerH);

    let li = 0;
    for (let i = 0; i < vis.length; i++) {
      const p = vis[i]!;
      const v = valueOf(p);
      const bw = Math.max(2, axisNorm(v, domain, this.logScale) * innerW);
      const rowY = iy0 + i * rowH;
      const by = rowY + (rowH - barH) * 0.5;
      const sel = p === selected;
      this.chart.fillStyle(p.color, sel ? 1 : 0.72);
      this.chart.fillRect(ix0, by, bw, barH);
      if (sel) {
        this.chart.lineStyle(1.5, 0xffffff, 0.95);
        this.chart.strokeRect(ix0, by, bw, barH);
      }
      this.chartHits.push({ x0: plotL, y0: rowY, x1: ix1 + 8, y1: rowY + rowH, id: p.id });
      const nameCol = sel ? PAPER : hexColor(p.color);
      li = this.placeLabel(li, p.short, ix0 - 8, rowY + rowH * 0.5, nameCol, 1, 0.5);
      if (this.showLabels) {
        li = this.placeLabel(li, fmtNum(v), ix0 + bw + 6, rowY + rowH * 0.5, sel ? PAPER : RIG_INFO, 0, 0.5);
      }
    }

    const title = this.logScale ? `log ${metric} (${axisTag})` : `${metric} (${axisTag})`;
    li = this.placeLabel(li, title, (ix0 + ix1) * 0.5, iy1 + 24, GOLD, 0.5, 0);
    li = this.placeLabel(li, fmtNum(domain.lo), ix0, iy1 + 6, RIG_INFO, 0, 0);
    li = this.placeLabel(li, fmtNum(domain.hi), ix1, iy1 + 6, RIG_INFO, 1, 0);
    li = this.placeLabel(li, `med ${fmtNum(med)}`, medX, iy0 - 4, "#8a7a50", 0.5, 1);
    this.hideLabelsFrom(li);
  }

  private drawProfile(frame: PlotFrame, items: BalancePoint[], selected: BalancePoint): void {
    const { plotL, ix0, iy0, ix1, iy1, innerW, innerH } = frame;
    const axes = CAT_AXES[this.cat];
    const rowH = innerH / axes.length;
    const barH = Math.max(6, rowH * 0.42);

    this.chart.lineStyle(1, 0x2a261c, 0.85);
    for (let i = 1; i <= 4; i++) {
      const gx = ix0 + (innerW * i) / 4;
      this.chart.lineBetween(gx, iy0, gx, iy1);
    }
    this.chart.lineStyle(1.5, 0x5a5040, 1);
    this.chart.strokeRect(ix0, iy0, innerW, innerH);

    let li = 0;
    for (let i = 0; i < axes.length; i++) {
      const axis = axes[i]!;
      const vals = items.map((p) => p.values[axis.id] ?? 0);
      const hi = Math.max(...vals, 1e-9);
      const med = median(vals);
      const selV = selected.values[axis.id] ?? 0;
      const rowY = iy0 + i * rowH;
      const by = rowY + (rowH - barH) * 0.5;
      this.chart.fillStyle(0x2a261c, 0.9);
      this.chart.fillRect(ix0, by, innerW, barH);
      const bw = (selV / hi) * innerW;
      const hot = axis.id === this.yAxis || axis.id === this.xAxis;
      this.chart.fillStyle(selected.color, hot ? 1 : 0.78);
      this.chart.fillRect(ix0, by, Math.max(2, bw), barH);
      const medX = ix0 + (med / hi) * innerW;
      this.chart.lineStyle(1.5, 0xe8b84a, 0.85);
      this.chart.lineBetween(medX, by - 2, medX, by + barH + 2);
      if (hot) {
        this.chart.lineStyle(1.2, 0xffffff, 0.8);
        this.chart.strokeRect(ix0, by, Math.max(2, bw), barH);
      }
      this.chartHits.push({
        x0: plotL,
        y0: rowY,
        x1: ix1 + 8,
        y1: rowY + rowH,
        id: selected.id,
        axis: axis.id,
      });
      const tag = axis.id === this.yAxis ? "Y" : axis.id === this.xAxis ? "X" : "";
      const name = tag ? `${axis.id} (${tag})` : axis.id;
      li = this.placeLabel(li, name, ix0 - 8, rowY + rowH * 0.5, hot ? GOLD : RIG_INFO, 1, 0.5);
      if (this.showLabels) {
        li = this.placeLabel(
          li,
          `${fmtNum(selV)} / ${fmtNum(hi)}`,
          ix0 + Math.max(2, bw) + 6,
          rowY + rowH * 0.5,
          PAPER,
          0,
          0.5
        );
      }
    }
    li = this.placeLabel(li, `${selected.short} vs set max · gold = median`, (ix0 + ix1) * 0.5, iy1 + 18, GOLD, 0.5, 0);
    li = this.placeLabel(li, "0", ix0, iy1 + 6, RIG_INFO, 0, 0);
    li = this.placeLabel(li, "max", ix1, iy1 + 6, RIG_INFO, 1, 0);
    this.hideLabelsFrom(li);
  }

  private placeLabel(
    i: number,
    text: string,
    x: number,
    y: number,
    color = RIG_INFO,
    originX = 0,
    originY = 0,
    rotation = 0
  ): number {
    this.labelAt(i)
      .setText(text)
      .setPosition(x, y)
      .setColor(color)
      .setVisible(true)
      .setOrigin(originX, originY)
      .setRotation(rotation);
    return i + 1;
  }

  private ensureLabels(n: number): void {
    while (this.labelPool.length < n) {
      // Keep off the main display list; parent into root for the UI camera.
      const t = this.scene.make.text({
        x: 0,
        y: 0,
        text: "",
        style: { fontFamily: MONO, fontSize: "11px", color: RIG_INFO },
        add: false,
      });
      t.setScrollFactor(0).setDepth(DEPTH + 5).setVisible(false);
      nameGameTexture(this.scene, t, `rig_balance_label_${this.labelPool.length}`);
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

/** F-cycle match keys. Most-specific type first (used for chart color). */

function playerShotKind(w: PlayerWpnSpec): ShotKind {
  if (w.launch.mode === "beam") return "beam";
  if (w.launch.mode === "drop") return "guided-missile";
  if (w.art.tracer || (w.launch.mode === "muzzle" && !w.guidance && !w.exhaust)) return "cannon";
  if (w.exhaust?.kind === "particles" && w.exhaust.smoke === "rocket" && !w.guidance) return "rocket";
  if (w.guidance?.targeting.mode === "lock_on") return "lock-on-missile";
  return "guided-missile";
}

function weaponTypeTags(kind: ShotKind, launchMode?: string): string[] {
  if (launchMode === "drop") return ["bomb"];
  if (kind === "beam" || launchMode === "beam") return kind === "cannon" ? ["beam", "cannon"] : ["beam"];
  if (kind === "cannon") return ["cannon"];
  if (kind === "rocket") return ["rocket"];
  if (kind === "lock-on-missile") return ["lock-on", "missile"];
  return ["guided", "missile"];
}

/** Burst/salvo-aware sustained DPS matching enemy fire cadence. */
function sustainedDps(
  dmg: number,
  fireCd: number,
  count = 1,
  gap = 0
): number {
  const n = Math.max(1, count);
  const cycle = fireCd + (n - 1) * Math.max(0, gap);
  return cycle > 0 ? (dmg * n) / cycle : 0;
}

function enemyWeaponDps(w: WeaponSpec | undefined): number {
  if (!w) return 0;
  return sustainedDps(w.dmg, w.fireCd, w.burst ?? 1, w.burstGap ?? 0);
}

/** Unmodified player weapon DPS (no dmgMul). */
function playerWeaponDps(w: PlayerWpnSpec): number {
  return sustainedDps(w.dmg, w.fireCd, w.fire?.salvo?.count ?? 1, w.fire?.salvo?.interval ?? 0);
}

function playerClassMul(w: PlayerWpnSpec, cls: UnitClass): number {
  return w.dmgMul?.[cls] ?? 1;
}

/** Per-class DPS values keyed as `prefix` / `prefix.air` / … Base key is unmodified. */
function classDpsValues(
  baseDps: number,
  mulOf: (cls: UnitClass) => number,
  prefix: string
): Record<string, number> {
  const out: Record<string, number> = { [prefix]: baseDps };
  for (const cls of UNIT_CLASSES) {
    out[`${prefix}.${cls}`] = baseDps * mulOf(cls);
  }
  return out;
}

/**
 * Primary gun channel DPS. Runtime fires one gun stream (alternate between mounts),
 * so identical multi-guns ≈ one weapon's DPS; mixed mounts use the mean.
 * Pick-mode partsRoll uses a weight-expected option DPS (one mount).
 */
function enemyPrimaryChannelDps(
  kind: UnitKind,
  sp: UnitSpec
): { dps: number; count: number } {
  const roll = partsRollOf(kind);
  if (roll?.mode === "pick") {
    let wSum = 0;
    let dSum = 0;
    for (const [id, wt] of roll.weights) {
      const opt = roll.options[id];
      if (!opt || wt <= 0) continue;
      wSum += wt;
      dSum += enemyWeaponDps(opt.w) * wt;
    }
    return { dps: wSum > 0 ? dSum / wSum : 0, count: 1 };
  }
  const guns = sp.guns ?? [];
  if (!guns.length) {
    return { dps: enemyWeaponDps(sp.weapon), count: 0 };
  }
  const perGun = guns.map((g) => enemyWeaponDps(g.weapon ?? sp.weapon));
  const mean = perGun.reduce((a, b) => a + b, 0) / perGun.length;
  return { dps: mean, count: guns.length };
}

/** Independent secondary hardpoint DPS (seekers, etc.). */
function enemySecondaryDps(sp: UnitSpec): { dps: number; mounts: number } {
  const sec = sp.secondary;
  if (!sec?.mounts.length) return { dps: 0, mounts: 0 };
  const avgCd = (sec.fireCdMin + sec.fireCdMax) * 0.5;
  const w = sec.wpn;
  const perVolley = sustainedDps(w.dmg, avgCd, w.burst ?? 1, w.burstGap ?? 0);
  const parallel = sec.mountFire === "simultaneous" ? sec.mounts.length : 1;
  return { dps: perVolley * parallel, mounts: sec.mounts.length };
}

type AxisDomain = { lo: number; hi: number };
type PlotFrame = {
  plotL: number;
  plotR: number;
  plotT: number;
  plotB: number;
  ix0: number;
  iy0: number;
  ix1: number;
  iy1: number;
  innerW: number;
  innerH: number;
};

function hexColor(n: number): string {
  return `#${n.toString(16).padStart(6, "0")}`;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) * 0.5;
}

function ratioValue(y: number, x: number): number {
  if (!Number.isFinite(y) || !Number.isFinite(x) || Math.abs(x) < 1e-9) return 0;
  return y / x;
}

function barDomain(min: number, max: number, log: boolean): AxisDomain {
  if (log) return axisDomain(Math.max(min, 1e-6), Math.max(max, 1e-5), true);
  const hi = Math.max(Math.abs(max), Math.abs(min), 1e-6) * 1.04;
  return { lo: Math.min(0, min), hi: min < 0 ? Math.max(0, max) + (max - min) * 0.04 || hi : hi };
}

function axisKeys(def: AxisDef | undefined, values: Record<string, number>, preferred: string[]): string[] {
  if (!def) return [];
  const keys = [def.id, ...(def.highlight ?? [])];
  // Craft firepower expands to per-slot loadout.<wpnId> components present on the point.
  if (def.id === "firepower") {
    for (const k of Object.keys(values)) {
      if (k.startsWith("loadout.") && !keys.includes(k)) keys.push(k);
    }
  }
  const present = keys.filter((k) => k in values);
  const rank = new Map(preferred.map((k, i) => [k, i]));
  present.sort((a, b) => {
    if (a === def.id) return -1;
    if (b === def.id) return 1;
    return (rank.get(a) ?? 999) - (rank.get(b) ?? 999);
  });
  return present;
}

/** Mapped stats for the panel: X axis (+components), then Y axis (+components). */
function hotKeysXThenY(
  axes: AxisDef[],
  xAxis: string,
  yAxis: string,
  preferred: string[],
  values: Record<string, number>
): string[] {
  const xDef = axes.find((a) => a.id === xAxis);
  const yDef = axes.find((a) => a.id === yAxis);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of [...axisKeys(xDef, values, preferred), ...axisKeys(yDef, values, preferred)]) {
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

function axisStatLabel(key: string, xAxis: string, yAxis: string): string {
  const tags: string[] = [];
  if (key === xAxis) tags.push("X");
  if (key === yAxis) tags.push("Y");
  return tags.length ? `${key} (${tags.join("/")})` : key;
}

function orderedValueKeys(preferred: string[], values: Record<string, number>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of preferred) {
    if (k in values && !seen.has(k)) {
      out.push(k);
      seen.add(k);
    }
    if (k === "firepower") {
      for (const lk of Object.keys(values)) {
        if (lk.startsWith("loadout.") && !seen.has(lk)) {
          out.push(lk);
          seen.add(lk);
        }
      }
    }
  }
  for (const k of Object.keys(values)) {
    if (!seen.has(k)) out.push(k);
  }
  return out;
}

function axisDomain(min: number, max: number, log: boolean): AxisDomain {
  if (!log) {
    const pad = (max - min) * 0.08 || Math.max(1, Math.abs(max) * 0.1) || 1;
    return { lo: min - pad, hi: max + pad };
  }
  const lo = Math.max(min, 1e-6);
  const hi = Math.max(max, lo * 1.01);
  const llo = Math.log10(lo);
  const lhi = Math.log10(hi);
  const pad = (lhi - llo) * 0.08 || 0.1;
  return { lo: 10 ** (llo - pad), hi: 10 ** (lhi + pad) };
}

function axisNorm(v: number, domain: AxisDomain, log: boolean): number {
  if (!log) {
    return Phaser.Math.Clamp((v - domain.lo) / (domain.hi - domain.lo), 0, 1);
  }
  const lv = Math.log10(Math.max(v, 1e-9));
  const llo = Math.log10(domain.lo);
  const lhi = Math.log10(domain.hi);
  return Phaser.Math.Clamp((lv - llo) / Math.max(1e-9, lhi - llo), 0, 1);
}

function buildBalanceCatalog(): BalancePoint[] {
  const out: BalancePoint[] = [];

  for (const c of allCrafts()) {
    const loadoutVals: Record<string, number> = {};
    let firepower = 0;
    let primaryFirepower = 0;
    let secondaryFirepower = 0;
    const classFp: Record<UnitClass, number> = {
      air: 0,
      vehicle: 0,
      building: 0,
      troop: 0,
    };
    for (let i = 0; i < c.sockets.length; i++) {
      const socket = c.sockets[i]!;
      const w = PLAYER_WPNS[socket.weapon];
      if (!w) continue;
      const streams = craftSocketFireStreams(c, i);
      const rateMul = socket.fireRateMul ?? 1;
      const dps = playerWeaponDps(w) * streams * rateMul;
      const key = `loadout.${socket.weapon}`;
      loadoutVals[key] = (loadoutVals[key] ?? 0) + dps;
      firepower += dps;
      if (craftSocketIsPrimary(socket)) primaryFirepower += dps;
      else secondaryFirepower += dps;
      for (const cls of UNIT_CLASSES) {
        classFp[cls] += dps * playerClassMul(w, cls);
      }
    }
    out.push({
      id: `craft:${c.kind}`,
      label: c.name,
      short: c.name,
      group: c.flightModel,
      color: colorOf(c.flightModel),
      values: {
        health: c.health,
        maxSpeed: c.maxSpeed,
        thrust: (c.forwardThrust + c.strafeThrust + c.verticalThrust) / 3,
        forwardThrust: c.forwardThrust,
        strafeThrust: c.strafeThrust,
        verticalThrust: c.verticalThrust,
        firepower,
        primaryFirepower,
        secondaryFirepower,
        "firepower.air": classFp.air,
        "firepower.vehicle": classFp.vehicle,
        "firepower.building": classFp.building,
        "firepower.troop": classFp.troop,
        ...loadoutVals,
        yawRate: c.yawRate,
        radius: c.radius,
        maxAgl: c.maxAgl,
        ammoScale: c.ammoScale,
      },
    });
  }

  for (const w of Object.values(PLAYER_WPNS)) {
    // Host-fire spotters (e.g. HOUND → dropship howitzer) are not separate weapons for balance.
    if (w.payload?.hostFire) continue;
    const tags = weaponTypeTags(playerShotKind(w), w.launch.mode);
    const kindGroup = tags[0] ?? "missile";
    const salvoN = w.fire?.salvo?.count ?? 1;
    const salvoGap = w.fire?.salvo?.interval ?? 0;
    const baseDps = sustainedDps(w.dmg, w.fireCd, salvoN, salvoGap);
    out.push({
      id: `weapons:player:${w.id}`,
      label: w.name,
      short: w.name.length > 12 ? w.name.slice(0, 11) + "…" : w.name,
      group: `player/${kindGroup}`,
      color: colorOf(kindGroup),
      tags,
      values: {
        ...classDpsValues(baseDps, (cls) => playerClassMul(w, cls), "dps"),
        dmg: w.dmg,
        blast: w.blast,
        fireCd: w.fireCd,
        speed: w.speed,
        life: w.life,
        range: w.speed * w.life,
        ammo: w.ammo,
        ...(w.fire?.salvo
          ? { "salvo.count": w.fire.salvo.count, "salvo.interval": w.fire.salvo.interval }
          : {}),
      },
    });
  }

  for (const p of ENEMY_WPNS) {
    const w = p.w;
    const tags = weaponTypeTags(w.kind);
    const kindGroup = tags[0] ?? "missile";
    const baseDps = sustainedDps(w.dmg, w.fireCd, w.burst ?? 1, w.burstGap ?? 0);
    out.push({
      id: `weapons:enemy:${p.id}`,
      label: p.label,
      short: p.label,
      group: `enemy/${kindGroup}`,
      color: colorOf(kindGroup),
      tags,
      values: {
        // Enemy weapons have no dmgMul — class DPS mirrors base.
        ...classDpsValues(baseDps, () => 1, "dps"),
        dmg: w.dmg,
        blast: w.blast,
        fireCd: w.fireCd,
        speed: w.speed,
        range: w.range,
        ammo: 0,
        ...(w.burst != null ? { burst: w.burst } : {}),
        ...(w.burstGap != null ? { burstGap: w.burstGap } : {}),
      },
    });
  }

  for (const kind of allKinds()) {
    const sp = specOf(kind);
    const w = sp.weapon;
    const primary = enemyPrimaryChannelDps(kind, sp);
    const secondary = enemySecondaryDps(sp);
    const bodyDps = enemyWeaponDps(w);
    let group = "other";
    if (sp.building) group = "building";
    else if (sp.organic || sp.behavior === "attack_infantry" || sp.behavior === "flee_infantry") group = "troop";
    else if ((sp.behavior === "orbit_attack_heli" || sp.behavior === "kite_attack_heli") || sp.behavior === "suicide_attack_heli" || sp.flyZ != null) group = "aerial";
    else if (sp.behavior === "orbit_attack_vehicle" || sp.behavior === "flee_vehicle" || sp.behavior === "patrol_boat") group = "vehicle";
    else if (sp.behavior === "static_hold") group = "building";
    out.push({
      id: `enemies:${kind}`,
      label: sp.label,
      short: sp.label.length > 14 ? sp.label.slice(0, 13) + "…" : sp.label,
      group,
      color: colorOf(group),
      values: {
        health: sp.health,
        radius: sp.radius,
        "drive.maxSpd": sp.drive?.maxSpd ?? 0,
        // Primary gun stream + independent secondary hardpoints.
        dps: primary.dps + secondary.dps,
        "weapon.dps": bodyDps,
        "guns.dps": primary.dps,
        "guns.count": primary.count,
        "secondary.dps": secondary.dps,
        "secondary.mounts": secondary.mounts,
        "weapon.dmg": w?.dmg ?? 0,
        "weapon.blast": w?.blast ?? 0,
        "weapon.fireCd": w?.fireCd ?? 0,
        "weapon.range": w?.range ?? 0,
        ...(w?.burst != null ? { "weapon.burst": w.burst } : {}),
        ...(w?.burstGap != null ? { "weapon.burstGap": w.burstGap } : {}),
      },
    });
  }

  return out;
}
