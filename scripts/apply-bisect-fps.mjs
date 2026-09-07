#!/usr/bin/env node
/**
 * Inject bottom-right FPS HUD into src/scenes.ts for bisect playtests.
 * Idempotent. Works with older MissionScene (no fxHud).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.join(root, "src/scenes.ts");
let s = fs.readFileSync(file, "utf8");

if (s.includes("syncFpsHud()") && s.includes("fpsHud!:")) {
  console.log("FPS HUD already present");
  process.exit(0);
}

const steps = [];

if (!s.includes("fpsHud!:")) {
  if (s.includes("fxHud!: Phaser.GameObjects.Text;")) {
    s = s.replace(
      "fxHud!: Phaser.GameObjects.Text;",
      "fxHud!: Phaser.GameObjects.Text;\n  fpsHud!: Phaser.GameObjects.Text;"
    );
  } else if (s.includes("hud!: Phaser.GameObjects.Text;")) {
    s = s.replace(
      "hud!: Phaser.GameObjects.Text;",
      "hud!: Phaser.GameObjects.Text;\n  fpsHud!: Phaser.GameObjects.Text;"
    );
  } else {
    console.error("anchor missing: hud/fxHud field");
    process.exit(1);
  }
  steps.push("field");
}

const fpsCreate = `this.fpsHud = this.add
      .text(this.scale.width - 16, this.scale.height - 18, "", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "12px",
        color: "#8a8470",
      })
      .setOrigin(1, 1)
      .setScrollFactor(0)
      .setDepth(Layer.HUD + 5);
    `;

if (!s.includes("this.fpsHud = this.add")) {
  if (s.includes("this.syncTestFxHud();")) {
    s = s.replace("this.syncTestFxHud();", fpsCreate + "this.syncTestFxHud();");
  } else if (s.includes("this.hud = this.add")) {
    // Insert after the first hud text chain ends (next sibling assignment).
    const m = s.match(/this\.hud = this\.add[\s\S]*?\.setDepth\(Layer\.HUD\);/);
    if (!m) {
      console.error("anchor missing: hud create block");
      process.exit(1);
    }
    s = s.replace(m[0], m[0] + "\n    " + fpsCreate.trimEnd());
  } else {
    console.error("anchor missing: hud/fx create");
    process.exit(1);
  }
  steps.push("create");
}

if (!s.includes('this.fpsHud.setName("hud_fps")')) {
  if (s.includes('this.hud.setName("hud_status");')) {
    s = s.replace(
      'this.hud.setName("hud_status");',
      'this.hud.setName("hud_status");\n    this.fpsHud.setName("hud_fps");'
    );
    steps.push("name");
  }
}

if (!s.includes("this.syncFpsHud();")) {
  if (!s.includes("this.setSimTimeScale(mapPause ? 0 : this.timeScale);")) {
    console.error("anchor missing: setSimTimeScale in update");
    process.exit(1);
  }
  s = s.replace(
    "this.setSimTimeScale(mapPause ? 0 : this.timeScale);",
    "this.setSimTimeScale(mapPause ? 0 : this.timeScale);\n    this.syncFpsHud();"
  );
  steps.push("update");
}

if (!s.includes("syncFpsHud(): void")) {
  const method = `syncFpsHud(): void {
    if (!this.fpsHud) return;
    const fps = Math.round(this.game.loop.actualFps);
    this.fpsHud.setText(\`\${fps} FPS\`);
    this.fpsHud.setColor(fps >= 55 ? "#6dbb4a" : fps >= 30 ? "#e8b84a" : "#ff3a22");
  }

  `;
  if (s.includes("syncTestFxHud(): void")) {
    s = s.replace("syncTestFxHud(): void", method + "syncTestFxHud(): void");
  } else if (s.includes("syncLiftPrompt(): void")) {
    s = s.replace("syncLiftPrompt(): void", method + "syncLiftPrompt(): void");
  } else if (s.includes("setSimTimeScale(s: number): void")) {
    s = s.replace("setSimTimeScale(s: number): void", method + "setSimTimeScale(s: number): void");
  } else {
    console.error("anchor missing: method insert point");
    process.exit(1);
  }
  steps.push("method");
}

if (s.includes("this.hud,\n      this.liftPrompt,") && !s.includes("this.fpsHud,\n      this.liftPrompt")) {
  s = s.replace("this.hud,\n      this.liftPrompt,", "this.hud,\n      this.fpsHud,\n      this.liftPrompt,");
  steps.push("hudCam");
} else if (s.includes("this.hud,\n      this.hvHud,") && !s.includes("this.fpsHud,\n      this.hvHud")) {
  s = s.replace("this.hud,\n      this.hvHud,", "this.hud,\n      this.fpsHud,\n      this.hvHud,");
  steps.push("hudCam");
}

fs.writeFileSync(file, s);
fs.copyFileSync(fileURLToPath(import.meta.url), path.join(root, ".git", "apply-bisect-fps.mjs"));
console.log(`FPS HUD applied (${steps.join(", ") || "noop"})`);
