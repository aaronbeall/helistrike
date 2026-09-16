import Phaser from "phaser";
import { waitFrame } from "./bootScene";
import {
  craftComposite,
  craftCompositePartScale,
  craftExhaustFlameHue,
  craftExhaustMounts,
  craftOf,
  craftPreviewExhaustScale,
  craftPreviewExhaustTint,
  craftRotorAlongScale,
  craftRotorFlightSpeed,
  type CraftComposite,
} from "./craft";
import { drawControlLegend } from "./menuChrome";
import { pickRandomTip, tipContextFromSelection } from "./tips";
import { ensureExhaustGlow, extractBiomeTiles, FX_VARIANTS, spriteUvPos } from "./sprites";
import { missionOf } from "./mission";
import { generateWorldAsync, type WorldData } from "./world";

export class LoadScene extends Phaser.Scene {
  private body!: Phaser.GameObjects.Image;
  private rotors: Phaser.GameObjects.Image[] = [];
  private rotorDiscs: Phaser.GameObjects.Image[] = [];
  private rotorParts: CraftComposite["rotors"] = [];
  private exhaustGlows: Phaser.GameObjects.Image[] = [];
  private exhaustFlames: Phaser.GameObjects.Image[] = [];
  private exhaustMounts: { x: number; y: number }[] = [];
  private exhaustFlameMul = 0.78;
  private exhaustHeat = 0;
  private heliY = 0;
  private rotorAng = 0;
  private rotorSpd = 4;
  private rotorFlight = 32;
  private loadU = 0.02;

  constructor() {
    super("load");
  }
  create(): void {
    // Craft preview reuses craft_* textures; chrome Text/Graphics get load_* names.
    const { width: w, height: h } = this.scale;
    this.cameras.main.setBackgroundColor("#1c1812");
    this.input.setDefaultCursor("default");
    ensureExhaustGlow(this.textures);
    this.heliY = h * 0.34;
    const hx = w / 2;
    const zs = 0.925;
    const craft = craftOf();
    this.rotorFlight = craftRotorFlightSpeed(craft);
    this.rotorSpd = this.rotorFlight * 0.12;
    this.exhaustFlameMul =
      craft.kind === "warthog"
        ? 0.7
        : craft.kind === "lightning_ii"
          ? 0.72
          : craft.kind === "prometheus"
            ? 0.58
            : 0.5;
    const composite = craftComposite(craft);
    this.body = this.add
      .image(hx, this.heliY, composite.body.tex)
      .setOrigin(composite.body.origin.x, composite.body.origin.y)
      .setScale(zs);
    this.add
      .text(hx, this.heliY - this.body.displayHeight * composite.body.origin.y - 18, craft.fullName.toUpperCase(), {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "13px",
        color: "#e8b84a",
        stroke: "#1c1812",
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1);
    this.rotorParts = composite.rotors;
    const along = craftRotorAlongScale(craft);
    this.rotors = this.rotorParts.map((part) => {
      const at = spriteUvPos(this.body, part.mount.x, part.mount.y);
      const rotor = this.add
        .image(0, 0, part.tex)
        .setOrigin(part.origin.x, part.origin.y);
      const sc = craftCompositePartScale(part, rotor.width, zs);
      if (along < 0.999) {
        const wrap = this.add.container(at.x, at.y).setScale(sc, sc * along);
        wrap.add(rotor);
        rotor.setData("tiltWrap", wrap);
      } else {
        rotor.setPosition(at.x, at.y).setScale(sc);
      }
      return rotor;
    });
    this.rotorDiscs = this.rotorParts.map((part, i) => {
      const at = spriteUvPos(this.body, part.mount.x, part.mount.y);
      const spinTex = part.spinTex;
      const disc = this.add
        .image(0, 0, spinTex && this.textures.exists(spinTex) ? spinTex : part.tex)
        .setOrigin(part.origin.x, part.origin.y)
        .setAlpha(0);
      const sc = craftCompositePartScale(part, this.rotors[i]?.width ?? 1, zs) * 1.04;
      if (along < 0.999) {
        const wrap = this.add.container(at.x, at.y).setScale(sc, sc * along);
        wrap.add(disc);
        disc.setData("tiltWrap", wrap);
      } else {
        disc.setPosition(at.x, at.y).setScale(sc);
      }
      return disc;
    });
    this.exhaustMounts = craftExhaustMounts(craft);
    const exhaustTint = craftPreviewExhaustTint(craft.kind);
    const flameHue = craftExhaustFlameHue(craft.kind);
    this.exhaustGlows = this.exhaustMounts.map((mount, exhaustI) => {
      const at = spriteUvPos(this.body, mount.x, mount.y);
      const glowSc = craftPreviewExhaustScale(zs);
      const glow = this.add
        .image(at.x, at.y, "fx_exhaust_glow")
        .setBlendMode(Phaser.BlendModes.ADD)
        .setTint(exhaustTint)
        .setScale(glowSc.x, glowSc.y)
        .setDepth(this.body.depth + 0.5);
      this.tweens.add({
        targets: glow,
        alpha: { from: 0.5 + (exhaustI % 2) * 0.08, to: 0.96 },
        duration: 780 + exhaustI * 90,
        yoyo: true,
        repeat: -1,
        ease: "Sine.InOut",
      });
      return glow;
    });
    this.exhaustFlames = this.exhaustMounts.map((mount) => {
      const at = spriteUvPos(this.body, mount.x, mount.y);
      return this.add
        .image(at.x, at.y, "fx_exhaust")
        .setOrigin(0, 0.5)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setRotation(Math.PI / 2)
        .setScale(0)
        .setAlpha(0)
        .setDepth(this.body.depth + 0.55);
    });
    this.exhaustFlames.map((flame) => {
      const fx = flame.preFX?.addColorMatrix();
      if (fx) fx.hue(flameHue);
    });
    this.add
      .text(w / 2, h * 0.48, "SURVEYING THEATER", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "18px",
        color: "#e8b84a",
      })
      .setOrigin(0.5);
    const sub = this.add
      .text(w / 2, h * 0.54, "procedural relief", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "13px",
        color: "#8a8470",
      })
      .setOrigin(0.5);
    const barW = 320;
    const barH = 8;
    const barX = w / 2 - barW / 2;
    const barY = h * 0.6;
    const bar = this.add.graphics();
    const tip = pickRandomTip(tipContextFromSelection()).text;
    this.add
      .text(w / 2, h * 0.72, `TIP  ·  ${tip}`, {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "14px",
        color: "#c8c0a8",
        align: "center",
        wordWrap: { width: Math.min(520, w - 48) },
      })
      .setOrigin(0.5, 0);
    drawControlLegend(this, w, h * 0.87);
    const drawBar = (t: number, label: string) => {
      const u = Phaser.Math.Clamp(t, 0, 1);
      bar.clear();
      bar.fillStyle(0x12100c, 1);
      bar.fillRect(barX, barY, barW, barH);
      bar.fillStyle(0xe8b84a, 1);
      bar.fillRect(barX, barY, barW * u, barH);
      bar.lineStyle(1, 0x3a3428, 1);
      bar.strokeRect(barX - 0.5, barY - 0.5, barW + 1, barH + 1);
      bar.lineStyle(1, 0x5c5344, 0.55);
      for (let i = 1; i < 10; i++) {
        const x = barX + (barW * i) / 10;
        const long = i === 5;
        bar.lineBetween(x, barY - (long ? 4 : 2), x, barY + barH + (long ? 4 : 2));
      }
      this.loadU = u;
      sub.setText(`${label.toUpperCase()}  ·  ${Math.round(u * 100)}%`);
    };
    drawBar(0.02, "relief");
    this.time.delayedCall(16, () => {
      const seed = (Date.now() ^ (Math.random() * 1e9)) >>> 0;
      const tiles = extractBiomeTiles(this.textures);
      const mission = missionOf();
      sub.setText(`${mission.label}  ·  RELIEF  ·  2%`);
      const go = async (world: WorldData) => {
        drawBar(1, "ready");
        await waitFrame();
        await waitFrame();
        if (!this.scene.isActive()) return;
        this.scene.start("mission", { world });
      };
      generateWorldAsync(seed, tiles, (t, label) => drawBar(t, label), mission.profile)
        .then(go)
        .catch((err) => {
          // Never fall back to sync generateWorld on the main thread — that freezes the UI
          // (Chrome "Page Unresponsive") exactly at whatever stage the worker died on.
          console.error("[boot] world worker failed", err);
          sub.setText("WORLD GEN FAILED  ·  SEE CONSOLE");
          drawBar(this.loadU, "failed");
        });
    });
  }

  update(_t: number, dt: number): void {
    const dts = dt / 1000;
    const flight = this.rotorFlight;
    const idle = flight * 0.12;
    const targetSpd = idle + this.loadU * (flight * 1.06 - idle);
    this.rotorSpd = Phaser.Math.Linear(this.rotorSpd, targetSpd, 1 - Math.pow(0.14, dts));
    this.rotorAng += this.rotorSpd * dts;
    // Lag load progress so nozzle heat ramps after rotors start spooling.
    const heatTarget = Phaser.Math.Clamp(this.loadU * 1.08, 0, 1);
    this.exhaustHeat = Phaser.Math.Linear(this.exhaustHeat, heatTarget, 1 - Math.pow(0.28, dts));
    const heat = this.exhaustHeat;
    const disc = Phaser.Math.Clamp((this.rotorSpd - flight * 0.3) / Math.max(1, flight * 0.7), 0, 1);
    const bob = Math.sin(_t / 420) * 1.6;
    this.body.y = this.heliY + bob;
    this.rotors.forEach((rotor, i) => {
      const part = this.rotorParts[i]!;
      const at = spriteUvPos(this.body, part.mount.x, part.mount.y);
      const sign = part.spinSign ?? -1;
      const wrap = rotor.getData("tiltWrap") as Phaser.GameObjects.Container | undefined;
      if (wrap?.scene) {
        wrap.setPosition(at.x, at.y);
        rotor.setRotation(sign * this.rotorAng).setAlpha(1 - disc * 0.38);
      } else {
        rotor
          .setPosition(at.x, at.y)
          .setRotation(sign * this.rotorAng)
          .setAlpha(1 - disc * 0.38);
      }
      const discIm = this.rotorDiscs[i];
      const discWrap = discIm?.getData("tiltWrap") as Phaser.GameObjects.Container | undefined;
      if (discWrap?.scene) {
        discWrap.setPosition(at.x, at.y);
        discIm!.setRotation(sign * this.rotorAng + Math.PI / 8).setAlpha(disc * 0.32);
      } else {
        discIm
          ?.setPosition(at.x, at.y)
          .setRotation(sign * this.rotorAng + Math.PI / 8)
          .setAlpha(disc * 0.32);
      }
    });
    const frameStep = Math.floor(_t / 55);
    const zs = this.body.scaleX;
    const glowSc = craftPreviewExhaustScale(zs);
    this.exhaustGlows.forEach((glow, exhaustI) => {
      const mount = this.exhaustMounts[exhaustI]!;
      const at = spriteUvPos(this.body, mount.x, mount.y);
      glow.setPosition(at.x, at.y).setScale(glowSc.x, glowSc.y);
    });
    this.exhaustFlames.forEach((flame, i) => {
      const mount = this.exhaustMounts[i]!;
      const at = spriteUvPos(this.body, mount.x, mount.y);
      const flicker = 0.9 + Math.sin(_t * 0.043 + i * 2.17) * 0.1;
      const sc = this.exhaustFlameMul * zs * (0.18 + heat * 0.9);
      flame
        .setVisible(heat > 0.03)
        .setFrame((frameStep + i) % FX_VARIANTS)
        .setPosition(at.x, at.y)
        .setRotation(Math.PI / 2)
        .setScale(sc * flicker, sc * (1.04 - flicker * 0.12))
        .setAlpha(heat * (0.45 + heat * 0.5) * flicker);
    });
  }
}
