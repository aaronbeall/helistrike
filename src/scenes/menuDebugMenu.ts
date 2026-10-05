import Phaser from "phaser";
import { TEST_MAPS } from "../catalog/testMaps";
import { fillRoundedRectFast, strokeRoundedRectFast } from "../render/fastShapes";
import { startDevLaunch, testMapLaunch } from "./devLaunch";

type MenuItem =
  | { section: string }
  | { label: string; run: () => void; on?: () => boolean };

const FONT = "Share Tech Mono, monospace";
const ROW_H = 22;
const PANEL_MIN_W = 330;

/** Main-menu debug menu (/): menu diagnostics + launching dev test maps. */
export class MenuDebugMenu {
  open = false;
  private root!: Phaser.GameObjects.Container;
  private panel!: Phaser.GameObjects.Graphics;
  private rows: Phaser.GameObjects.Text[] = [];
  private items: MenuItem[] = [];
  private focus = 0;

  constructor(
    readonly scene: Phaser.Scene,
    private readonly statScales: { toggle: () => void; on: () => boolean }
  ) {}

  setup(): void {
    this.items = [
      { section: "MENU" },
      { label: "Craft stat scales", run: () => this.statScales.toggle(), on: () => this.statScales.on() },
      { section: "TEST MAPS" },
      ...TEST_MAPS.map((m) => ({ label: `${m.id.padEnd(16)} ${m.label}`, run: () => this.launch(m.id) })),
    ];
    this.root = this.scene.add.container(22, 86).setDepth(1e5).setScrollFactor(0);
    this.panel = this.scene.add.graphics();
    const title = this.scene.add.text(12, 10, "/  DEBUG    ↑↓ select   ENTER activate", { fontFamily: FONT, fontSize: "13px", color: "#e8b84a" });
    this.rows = this.items.map((item, i) => {
      const t = this.scene.add.text(12, 38 + i * ROW_H, "", { fontFamily: FONT, fontSize: "13px", color: "#f0e6c8" });
      if ("run" in item) {
        t.setInteractive({ useHandCursor: true });
        t.on("pointerdown", () => {
          this.focus = i;
          this.activate();
        });
      }
      return t;
    });
    this.root.add([this.panel, title, ...this.rows]);
    this.root.setVisible(false);
    this.focus = this.items.findIndex((item) => "run" in item);
    this.sync();
    const w = Math.max(PANEL_MIN_W, title.width, ...this.rows.map((r) => r.width)) + 24;
    const hgt = 48 + this.items.length * ROW_H;
    this.panel.fillStyle(0x12100c, 0.92);
    fillRoundedRectFast(this.panel, 0, 0, w, hgt, 3);
    strokeRoundedRectFast(this.panel, 0, 0, w, hgt, 3, 1.5, 0xe8b84a, 0.85);
  }

  toggle(force?: boolean): void {
    this.open = force ?? !this.open;
    this.root.setVisible(this.open);
    if (this.open) this.sync();
  }

  /** Move focus by `dir` rows, skipping section headers. */
  nudge(dir: number): void {
    const n = this.items.length;
    let i = this.focus;
    do i = (i + dir + n) % n;
    while (!("run" in this.items[i]!));
    this.focus = i;
    this.sync();
  }

  activate(): void {
    const item = this.items[this.focus];
    if (!item || !("run" in item)) return;
    item.run();
    this.sync();
  }

  private launch(id: string): void {
    const map = TEST_MAPS.find((m) => m.id === id);
    if (!map) return;
    this.toggle(false);
    startDevLaunch(this.scene, testMapLaunch(map));
  }

  private sync(): void {
    this.items.forEach((item, i) => {
      const row = this.rows[i]!;
      if ("section" in item) {
        row.setText(item.section).setColor("#6a8a62");
        return;
      }
      const focus = i === this.focus;
      const mark = focus ? "▸" : " ";
      const on = item.on?.();
      if (on != null) {
        row.setText(`${mark}  ${item.label.padEnd(25)} ${on ? "ON" : "OFF"}`).setColor(focus ? "#e8b84a" : on ? "#c8b87a" : "#8a8470");
      } else {
        row.setText(`${mark}  ${item.label}`).setColor(focus ? "#e8b84a" : "#f0e6c8");
      }
    });
  }
}
