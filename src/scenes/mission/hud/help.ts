import Phaser from "phaser";
import { Layer } from "../../../render/depth";
import { FieldManual } from "../../../ui/fieldManual";
import type { MissionScene } from "../../missionScene";
import { isNeutral } from "../../../sim/roster";

/** In-mission help (H): Field Manual overlay + its button. */
export class HelpPanel {
  open = false;
  /** Shared craft/weapon reference panel — in-mission "H" help and the menu's field manual. */
  fieldManual!: FieldManual;
  button!: Phaser.GameObjects.Text;

  constructor(readonly s: MissionScene) {}

  /** Per-mission state reset (called from the scene's init). */
  reset(): void {
    this.open = false;
  }

  setup(): void {
    this.fieldManual = new FieldManual(this.s, {
      getEnemies: () =>
        this.s.units.length ? [...new Set(this.s.units.filter((u) => !u.dead && !isNeutral(u.kind)).map((u) => u.kind))] : undefined,
      onToggle: (open) => {
        this.open = open;
      },
      depth: Layer.HUD + 500,
    });
    this.button = this.s.add
      .text(this.s.scale.width - 16, 12, "[ H ]  HELP", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "13px",
        color: "#e8b84a",
        backgroundColor: "#12100c",
        padding: { x: 8, y: 5 },
      })
      .setOrigin(1, 0)
      .setDepth(Layer.HUD + 200)
      .setScrollFactor(0);
  }

  toggle(force?: boolean): void {
    const want = force ?? !this.open;
    if (want && (this.s.camera.mapWant || this.s.camera.mapBlend > 0.02 || this.s.over)) return;
    if (want && this.s.debugMenu.open) this.s.debugMenu.toggle(false);
    if (want && this.s.relief.open) this.s.relief.toggle(false);
    this.fieldManual.toggle(want);
    this.s.input.setDefaultCursor(want ? "default" : "none");
  }

  nudge(dir: number): void {
    this.fieldManual.nudgeTip(dir);
  }

  nudgeFocus(dir: number): void {
    this.fieldManual.nudgeFocus(dir);
  }
}
