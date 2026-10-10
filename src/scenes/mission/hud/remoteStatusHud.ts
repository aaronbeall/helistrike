import Phaser from "phaser";
import { Layer } from "../../../render/depth";
import { setTextColor } from "../../../render/textStyle";
import { craftOf } from "../../../sim/crafts";
import { worldToScreen } from "../../../worldgen/world";
import type { MissionScene } from "../../missionScene";

const BLUE = 0x7ad0ff;
const LINE_H = 13;
const DIAMOND = 3.5;
/** Gap below the reticle centre (screen px). */
const RETICLE_GAP = 40;
const FONT = { fontFamily: "Share Tech Mono, monospace", fontSize: "10px", color: "#7ad0ff" };
/** State colour by action: attacking orange, holding (idle) gray, stuck red, everything else blue. */
const STATE_COLOR: Record<string, string> = {
  ATTACKING: "#ff9a3a",
  HOLDING: "#9aa0a6",
  STUCK: "#ff4a3a",
  "BACKING OUT": "#ff4a3a",
};

type Row = { name: Phaser.GameObjects.Text; state: Phaser.GameObjects.Text };
type Line = { name: string; state: string };

/** Autonomous remote status: blue diamond + "WOLF · FOLLOWING" lines under what each follows (the reticle or the host craft). */
export class RemoteStatusHud {
  /** Diamonds under the reticle (HUD camera) / under the host craft (field camera). */
  mouseGfx!: Phaser.GameObjects.Graphics;
  hostGfx!: Phaser.GameObjects.Graphics;
  private mouseRows: Row[] = [];
  private hostRows: Row[] = [];
  private mouseLines: Line[] = [];
  private hostLines: Line[] = [];

  constructor(readonly s: MissionScene) {}

  create(): void {
    this.mouseGfx = this.s.add.graphics().setDepth(Layer.HUD + 6).setScrollFactor(0);
    this.hostGfx = this.s.add.graphics().setDepth(Layer.FIELD + 6);
    this.mouseRows = [];
    this.hostRows = [];
  }

  draw(): void {
    const mouse = this.mouseLines;
    const host = this.hostLines;
    mouse.length = 0;
    host.length = 0;
    if (!this.s.camera.mapView && !this.s.over) {
      const piloted = this.s.remoteFleet.pilotingRemote();
      for (const r of this.s.remotes) {
        if (!r.spec.ai || r === piloted || r.detonate || !r.aiStatus) continue;
        const name = (r.spec.craftLook ? craftOf(r.spec.craftLook).name : r.spec.kind).toUpperCase();
        (r.aiAnchor === "mouse" ? mouse : host).push({ name: `${name} · `, state: r.aiStatus });
      }
    }
    // Same screen space as the reticle image.
    const p = this.s.input.activePointer;
    this.place(this.mouseRows, this.mouseGfx, mouse, p.x, p.y + RETICLE_GAP, 1, true);
    const h = this.s.player;
    const at = worldToScreen(h.x, h.y, h.z);
    this.place(this.hostRows, this.hostGfx, host, at.x, at.y + (h.spec.radius + 18) * at.scale, at.scale, false);
  }

  /** Lines centred under (x, y), each a diamond, the remote name, then its state in the state's colour. */
  private place(rows: Row[], g: Phaser.GameObjects.Graphics, lines: readonly Line[], x: number, y: number, scale: number, hud: boolean): void {
    g.clear();
    while (rows.length < lines.length) rows.push(this.row(hud));
    g.fillStyle(BLUE, 0.95);
    const d = DIAMOND * scale;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      const line = lines[i];
      if (!line) {
        row.name.setVisible(false);
        row.state.setVisible(false);
        continue;
      }
      row.name.setVisible(true).setText(line.name).setScale(scale);
      setTextColor(row.state.setVisible(true).setText(line.state), STATE_COLOR[line.state] ?? "#7ad0ff").setScale(scale);
      const lead = (DIAMOND * 2 + 5) * scale;
      const w = lead + (row.name.width + row.state.width) * scale;
      const left = x - w / 2;
      const cy = y + (i + 0.5) * LINE_H * scale;
      const cx = left + DIAMOND * scale;
      g.fillTriangle(cx, cy - d, cx + d, cy, cx, cy + d);
      g.fillTriangle(cx, cy - d, cx, cy + d, cx - d, cy);
      row.name.setPosition(left + lead, cy);
      row.state.setPosition(left + lead + row.name.width * scale, cy);
    }
  }

  private row(hud: boolean): Row {
    const make = () => {
      const t = this.s.add.text(0, 0, "", FONT).setOrigin(0, 0.5).setStroke("#0a1418", 3);
      if (hud) {
        t.setDepth(Layer.HUD + 6).setScrollFactor(0);
        this.s.bindHud(t);
      } else {
        t.setDepth(Layer.FIELD + 6);
        this.s.bindFieldHud(t);
      }
      return t;
    };
    return { name: make(), state: make() };
  }
}
