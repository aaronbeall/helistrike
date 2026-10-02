
import Phaser from "phaser";
import { heliHudWireUv, type HeliHudWireBake } from "../../../art/sprites";
import type { MissionScene } from "../../missionScene";

export function healthHudColor(hp: number): number {
  const t = Phaser.Math.Clamp(hp, 0, 1);
  const stops: [number, number][] = [
    [1, 0x5caa3a],
    [0.66, 0xe8c44a],
    [0.33, 0xe87828],
    [0, 0xff2a18],
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    const [aT, aC] = stops[i]!;
    const [bT, bC] = stops[i + 1]!;
    if (t <= aT && t >= bT) {
      const k = (aT - t) / Math.max(0.0001, aT - bT);
      return Phaser.Display.Color.GetColor(
        Math.round(Phaser.Math.Linear((aC >> 16) & 0xff, (bC >> 16) & 0xff, k)),
        Math.round(Phaser.Math.Linear((aC >> 8) & 0xff, (bC >> 8) & 0xff, k)),
        Math.round(Phaser.Math.Linear(aC & 0xff, bC & 0xff, k))
      );
    }
  }
  return stops[stops.length - 1]![1];
}

/** Lower-left status panel: HP bar, hull wireframe with damage pins, hurt vignette. */
export class StatusHud {
  playerHud!: Phaser.GameObjects.Graphics;
  heliHudWire!: Phaser.GameObjects.Image;
  heliHudWireSh!: Phaser.GameObjects.Image;
  heliHudWireScale = 1;
  heliHudWireBake: HeliHudWireBake = { w: 1, h: 1, pivot: { x: 0.5, y: 0.5 }, srcW: 1, srcH: 1, cropX: 0, cropY: 0, scale: 1, shadowPivot: { x: 0.5, y: 0.5 } };
  /** Soft OOF blood edges (under). */
  hurtVignette!: Phaser.GameObjects.Image;
  /** Static window cracks (over). */
  hurtVignettePulse!: Phaser.GameObjects.Image;

  constructor(readonly s: MissionScene) {}

  draw(): void {
    const g = this.playerHud;
    g.clear();
    const h = this.s.player;
    const hp = Phaser.Math.Clamp(h.health / h.spec.health, 0, 1);
    const bake = this.heliHudWireBake;
    const ox = bake.pivot.x;
    const oy = bake.pivot.y;
    const drawW = bake.w * this.heliHudWireScale;
    const drawH = bake.h * this.heliHudWireScale;
    // Square panel matching minimap diameter; HP bar on the left, wire centered in the rest.
    const margin = 18;
    const panel = 180;
    const panelRight = this.s.scale.width - margin;
    const panelBottom = this.s.scale.height - margin;
    const panelLeft = panelRight - panel;
    const panelTop = panelBottom - panel;
    const barW = 9;
    const barGap = 12;
    const barPad = 3;
    const barX = panelLeft + barPad;
    const barY = panelTop + barPad;
    const barH = panel - barPad * 2;
    const boxX = barX - barPad;
    const boxY = barY - barPad;
    const boxW = barW + barPad * 2;
    const boxH = barH + barPad * 2;

    const restLeft = barX + barW + barGap;
    const restRight = panelRight;
    const restTop = panelTop;
    const restBottom = panelBottom;
    const areaCx = (restLeft + restRight) / 2;
    const areaCy = (restTop + restBottom) / 2;
    const wireX = areaCx - drawW / 2 + ox * drawW;
    const wireY = areaCy - drawH / 2 + oy * drawH;

    const segs = 10;
    const gap = 2;
    const segH = (barH - gap * (segs - 1)) / segs;
    const fill = hp * segs;
    const hpCol = healthHudColor(hp);
    for (let i = 0; i < segs; i++) {
      const sy = barY + (segs - 1 - i) * (segH + gap);
      g.fillStyle(0x141410, 0.55);
      g.fillRect(barX, sy, barW, segH);
      const part = Phaser.Math.Clamp(fill - i, 0, 1);
      if (part <= 0) continue;
      const fh = Math.max(0.5, segH * part);
      g.fillStyle(hpCol, 0.95);
      g.fillRect(barX, sy + (segH - fh), barW, fh);
    }
    g.lineStyle(1.5, 0x080808, 0.92);
    g.strokeRoundedRect(boxX, boxY, boxW, boxH, 2);
    g.lineStyle(1, 0x444438, 0.5);
    g.strokeRoundedRect(boxX + 0.5, boxY + 0.5, boxW - 1, boxH - 1, 2);

    const pulse = hp < 0.3 ? 0.55 + 0.45 * Math.sin(this.s.time.now * 0.018) : 1;
    const wirePos = this.s.hudLocal(wireX, wireY);
    this.heliHudWireSh.setPosition(wirePos.x, wirePos.y);
    this.heliHudWire.setPosition(wirePos.x, wirePos.y).setTint(hpCol).setAlpha(0.92 * pulse);

    for (let siteI = 0; siteI < h.dmgSites.length; siteI++) {
      const site = h.dmgSites[siteI]!;
      const mapped = heliHudWireUv(bake, site.u, site.v);
      const mx = wireX + (mapped.u - ox) * drawW;
      const my = wireY + (mapped.v - oy) * drawH;
      const hmPulse = 0.65 + 0.35 * Math.sin(this.s.time.now * 0.022 + siteI * 1.7);
      g.fillStyle(0xff2020, 0.9 * hmPulse);
      g.fillCircle(mx, my, 9.5);
      g.lineStyle(2.2, 0xff6644, 0.75 * hmPulse);
      g.strokeCircle(mx, my, 15);
    }

    this.drawHurtVignette(hp);
  }

  drawHurtVignette(hp: number): void {
    const blood = this.hurtVignette;
    const cracks = this.hurtVignettePulse;
    const w = this.s.scale.width;
    const h = this.s.scale.height;
    if (this.s.player.phase === "dead") {
      // Keep cockpit damage visible after death, desaturated.
      blood
        .setVisible(true)
        .setPosition(0, 0)
        .setDisplaySize(w, h)
        .setTint(0x8a8a8a)
        .setAlpha(0.58)
        .setBlendMode(Phaser.BlendModes.MULTIPLY);
      cracks
        .setVisible(true)
        .setPosition(0, 0)
        .setDisplaySize(w, h)
        .setTint(0x6e6e6e)
        .setAlpha(0.62)
        .setBlendMode(Phaser.BlendModes.NORMAL);
      return;
    }
    blood.clearTint().setBlendMode(Phaser.BlendModes.ADD);
    cracks.clearTint().setBlendMode(Phaser.BlendModes.NORMAL);
    if (hp >= 0.32) {
      blood.setVisible(false).setAlpha(0);
      cracks.setVisible(false).setAlpha(0);
      return;
    }
    const hurt = Phaser.Math.Clamp((0.32 - hp) / 0.32, 0, 1);
    // Gentle breath — never fully offs the blood pulse layer.
    const beat = 0.82 + 0.18 * Math.sin(this.s.time.now * 0.0042);
    blood
      .setVisible(true)
      .setPosition(0, 0)
      .setDisplaySize(w, h)
      .setAlpha((0.42 + hurt * 0.45) * beat);
    cracks
      .setVisible(true)
      .setPosition(0, 0)
      .setDisplaySize(w, h)
      .setAlpha(0.55 + hurt * 0.4);
  }
}
