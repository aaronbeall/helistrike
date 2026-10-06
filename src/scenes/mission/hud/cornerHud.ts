import { groundZ, castZ, type WorldData, type HvSpec } from "../../../worldgen/world";
import { labelOf } from "../../../sim/roster";
import { type Unit } from "../../../sim/combat";
import Phaser from "phaser";
import { formatMeters } from "../../../util/format";
import { type MissionScene } from "../../missionScene";
import { setTextColor } from "../../../render/textStyle";

function bearing(deg: number): string {
  const d = ((deg % 360) + 360) % 360;
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round(d / 45) % 8]!;
}

/** 0° = screen/world north (up), same convention as `bearing`. */
function bearingArrow(deg: number): string {
  const d = ((deg % 360) + 360) % 360;
  const arrows = ["↑", "↗", "→", "↘", "↓", "↙", "←", "↖"];
  return arrows[Math.round(d / 45) % 8]!;
}

/** Corner readouts: top-left flight readout, upper-right objectives + FPS stack. */
export class CornerHud {
  fpsHud!: Phaser.GameObjects.Text;
  hud!: Phaser.GameObjects.Text;
  hvHud!: Phaser.GameObjects.Text;
  hvRows: Phaser.GameObjects.Text[] = [];
  fpsHudAt = 0;

  constructor(readonly s: MissionScene) {}

  /** Top-left flight readout: ALT / ELV / SPD / time scale, phase, weapon + hover target. */
  syncReadoutHud(): void {
    const h = this.s.player;
    const w = this.s.loadout[h.weapon]!;
    const ammo = this.s.fireControl.ammo[h.weapon]!;
    const ammoShown = this.s.remoteFleet.remotePoolDisplayAmmo(h.weapon, ammo);
    const ammoS =
      this.s.debugMenu.infAmmo && Number.isFinite(ammoShown)
        ? "∞"
        : Number.isFinite(ammoShown)
          ? String(ammoShown)
          : "∞";
    const phase =
      h.phase === "grounded" || h.phase === "spool"
        ? h.spec.rotor
          ? "SPOOLING ROTORS"
          : "ENGINE START"
        : h.phase === "ready"
          ? "READY"
          : h.phase === "dead"
            ? "DOWN"
            : this.s.remoteFleet.remoteView && this.s.remoteFleet.activeRemote()
              ? "SPECTRE POV"
              : "AIRBORNE";
    const ptr = this.s.worldPointer();
    const elv = groundZ(this.s.world, ptr.x, ptr.y) | 0;
    const over = this.s.fireControl.reticleUnit();
    const overLine = over ? `\n${unitHudName(this.s.world, over)}` : "";
    this.hud.setText(
      `ALT ${castZ(this.s.world, h.x, h.y, h.z) | 0}   ELV ${elv}   SPD ${Math.hypot(h.vx, h.vy) | 0}   TIME ${this.s.liveSimScale.toFixed(2)}×\n${phase}\nWPN ${w.name}  ${ammoS}${overLine}`
    );
  }

  /** Upper-right objectives list (high-value targets). */
  syncObjectivesHud(): void {
    const lines = this.s.world.hv.map((spec) => this.hvLine(spec));
    const left = lines.filter((l) => !l.done).length;
    setTextColor(this.hvHud, "#e8b84a").setText(`OBJECTIVES  ${this.s.world.hv.length - left}/${this.s.world.hv.length}`);
    for (let i = 0; i < this.hvRows.length; i++) {
      const row = this.hvRows[i]!;
      const line = lines[i];
      if (!line) {
        row.setVisible(false);
        continue;
      }
      row.setVisible(this.hvHud.visible);
      row.setText(line.text);
      if (line.done) setTextColor(row, "#6a8a62").setAlpha(0.82);
      else setTextColor(row, "#ff3a22").setAlpha(1);
    }
  }

  syncFpsHud(): void {
    if (!this.fpsHud) return;
    const now = this.s.time.now;
    if (now - this.fpsHudAt < 200) return;
    this.fpsHudAt = now;
    const fps = Math.round(this.s.game.loop.actualFps);
    this.fpsHud.setText(`${fps} FPS`);
    setTextColor(this.fpsHud, fps >= 55 ? "#6dbb4a" : fps >= 30 ? "#e8b84a" : "#ff3a22");
  }

  hvLine(spec: HvSpec): { text: string; done: boolean } {
    const u = this.s.units.find((q) => q.hv === spec.id);
    const done = !u || u.dead;
    if (done) return { text: `× ${spec.name}  KILL`, done: true };
    const look = this.s.camera.camLookWorld();
    const dx = u.x - look.x;
    const dy = u.y - look.y;
    const dist = Math.hypot(dx, dy);
    const brg = Phaser.Math.RadToDeg(Math.atan2(dx, -dy));
    const compass = bearing(brg);
    const hp = Math.max(0, (u.health / u.max) * 100) | 0;
    return {
      text: `${bearingArrow(brg)} ${spec.name}  ${formatMeters(dist)}  ${compass}  ${hp}%`,
      done: false,
    };
  }

  /** Top-right stack: [ESC]/[H] → OBJECTIVES → FPS. */
  layoutUpperRightHud(): void {
    const right = this.s.scale.width - 16;
    let y = 12;
    const gap = 8;
    const helpLp = this.s.hudLocal(right, y);
    this.s.help.button.setOrigin(1, 0).setPosition(helpLp.x, helpLp.y);
    const exitX = right - this.s.help.button.width - gap;
    const exitLp = this.s.hudLocal(exitX, y);
    this.s.flow.exitButton.setOrigin(1, 0).setPosition(exitLp.x, exitLp.y);
    y += Math.max(this.s.help.button.height, this.s.flow.exitButton.height) + 12;

    const hvLp = this.s.hudLocal(right, y);
    this.hvHud.setOrigin(1, 0).setPosition(hvLp.x, hvLp.y);
    y += 20;
    let rowCount = 0;
    for (let i = 0; i < this.hvRows.length; i++) {
      const row = this.hvRows[i]!;
      if (!row.visible) continue;
      const lp = this.s.hudLocal(right, y + rowCount * 17);
      row.setOrigin(1, 0).setPosition(lp.x, lp.y);
      rowCount++;
    }
    y += Math.max(1, rowCount) * 17 + 10;

    const fpsLp = this.s.hudLocal(right, y);
    this.fpsHud.setOrigin(1, 0).setPosition(fpsLp.x, fpsLp.y);
  }
}

export function unitHudName(world: WorldData, u: Unit): string {
  if (u.hv) {
    const site = world.hv.find((h) => h.id === u.hv);
    if (site) return site.name.toUpperCase();
  }
  return labelOf(u.kind);
}
