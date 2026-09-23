import Phaser from "phaser";
import { bakeAll, bakeRosterArt } from "./bake";
import { bakeCamo } from "./camo";
import { preloadArt, prepareArt } from "./sprites";

export class BootScene extends Phaser.Scene {
  private bootSub!: Phaser.GameObjects.Text;
  private bootBar!: Phaser.GameObjects.Graphics;
  private bootBarW = 320;
  private bootBarH = 8;
  private bootBarX = 0;
  private bootBarY = 0;

  constructor() {
    super("boot");
  }

  init(): void {
    this.cameras.main.setBackgroundColor("#1c1812");
    // Phaser canvas is up — drop the HTML shell so the in-game bar is visible.
    hideHtmlBoot();
  }

  preload(): void {
    const { width: w, height: h } = this.scale;
    this.bootBarW = Math.min(320, w - 80);
    this.bootBarX = w / 2 - this.bootBarW / 2;
    this.bootBarY = h * 0.58;

    this.add
      .text(w / 2, h * 0.38, "HELISTRIKE", {
        fontFamily: "Black Ops One, Impact, sans-serif",
        fontSize: "64px",
        color: "#e8b84a",
        stroke: "#1c1812",
        strokeThickness: 6,
      })
      .setOrigin(0.5);

    this.bootSub = this.add
      .text(w / 2, h * 0.5, "LOADING ASSETS  ·  0%", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "14px",
        color: "#8a8470",
      })
      .setOrigin(0.5);

    this.bootBar = this.add.graphics();
    this.drawBootBar(0);

    this.load.on("progress", (v: number) => {
      // Leave headroom for CPU bake after fetch.
      this.drawBootBar(v * 0.72, `LOADING ASSETS  ·  ${Math.round(v * 100)}%`);
    });

    preloadArt(this);
  }

  async create(): Promise<void> {
    const steps: { label: string; run: () => void; t: number }[] = [
      { label: "BAKING BASE", t: 0.78, run: () => bakeAll(this.textures) },
      {
        label: "PREPARING ART",
        t: 0.88,
        run: () => {
          try {
            prepareArt(this.textures);
          } catch {
            /* keep baked placeholders */
          }
        },
      },
      { label: "ROSTER ART", t: 0.94, run: () => bakeRosterArt(this.textures) },
      { label: "CAMO", t: 0.99, run: () => bakeCamo(this.textures) },
    ];

    for (const step of steps) {
      this.drawBootBar(step.t, `${step.label}  ·  ${Math.round(step.t * 100)}%`);
      await waitFrame();
      step.run();
      await waitFrame();
    }

    this.drawBootBar(1, "READY  ·  100%");
    await waitFrame();
    this.scene.start("menu");
  }

  private drawBootBar(t: number, label?: string): void {
    const u = Phaser.Math.Clamp(t, 0, 1);
    if (label) this.bootSub.setText(label);
    const g = this.bootBar;
    const { bootBarX: x, bootBarY: y, bootBarW: w, bootBarH: h } = this;
    g.clear();
    g.fillStyle(0x12100c, 1);
    g.fillRect(x, y, w, h);
    g.fillStyle(0xe8b84a, 1);
    g.fillRect(x, y, w * u, h);
    g.lineStyle(1, 0x3a3428, 1);
    g.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);
    g.lineStyle(1, 0x5c5344, 0.55);
    for (let i = 1; i < 10; i++) {
      const px = x + (w * i) / 10;
      const long = i === 5;
      g.lineBetween(px, y - (long ? 4 : 2), px, y + h + (long ? 4 : 2));
    }
  }
}

export function waitFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function hideHtmlBoot(): void {
  const splash = document.getElementById("boot-splash");
  if (!splash || splash.classList.contains("is-done")) return;
  splash.classList.add("is-done");
  window.setTimeout(() => splash.remove(), 400);
}
