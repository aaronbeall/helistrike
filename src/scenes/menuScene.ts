import Phaser from "phaser";
import {
  COUNTERMEASURES,
  craftCountermeasure,
  countermeasureTimingLabel,
  playerLoadoutFromSockets,
} from "../sim/combat";
import {
  allCrafts,
  craftAgility,
  craftComposite,
  craftCompositePartScale,
  craftExhaustMounts,
  craftLoadoutParts,
  craftOf,
  craftPreviewExhaustScale,
  craftPreviewExhaustTint,
  craftPreviewFitScale,
  craftRotorAlongScale,
  craftRotorPreviewSpinMs,
  craftSocketStartingAmmo,
  selectCraft,
} from "../sim/craft";
import { allMissions, missionOf, selectMission } from "../sim/mission";
import { installRigHotkeys } from "../rigs/rigs";
import { ensureExhaustGlow, spriteUvPos } from "../art/sprites";
import { ensureMissionPreviews } from "../ui/menuChrome";
import { applyEdgeLight, clearEdgeLight } from "../render/edgeLight";
import { setGlitchPipeline } from "../render/glitch";

export class MenuScene extends Phaser.Scene {
  constructor() {
    super("menu");
  }

  create(): void {
    const { width: w, height: h } = this.scale;
    this.cameras.main.setBackgroundColor("#1c1812");
    this.input.setDefaultCursor("default");
    ensureMissionPreviews(this.textures);
    ensureExhaustGlow(this.textures);
    if (this.textures.exists("menu_splash")) {
      const bg = this.add.image(w / 2, h / 2, "menu_splash").setDepth(0);
      const sx = w / bg.width;
      const sy = h / bg.height;
      // Overscan so mouse parallax + the slow zoom never reveal an edge.
      const baseScale = Math.max(sx, sy) * 1.1;
      bg.setScale(baseScale);
      this.add
        .rectangle(w / 2, h / 2, w, h, 0x0c0a08, 0.58)
        .setDepth(1);

      // —— Parallax: background drifts opposite the cursor, plus a slow perpetual zoom breathe. ——
      const parallaxStrength = 22;
      let parallaxTargetX = 0;
      let parallaxTargetY = 0;
      this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
        parallaxTargetX = ((p.x / w) * 2 - 1) * -parallaxStrength;
        parallaxTargetY = ((p.y / h) * 2 - 1) * -parallaxStrength * 0.6;
      });
      this.tweens.add({
        targets: bg,
        scale: baseScale * 1.055,
        duration: 14000,
        yoyo: true,
        repeat: -1,
        ease: "Sine.InOut",
      });
      this.events.on(Phaser.Scenes.Events.UPDATE, () => {
        bg.x = Phaser.Math.Linear(bg.x, w / 2 + parallaxTargetX, 0.04);
        bg.y = Phaser.Math.Linear(bg.y, h / 2 + parallaxTargetY, 0.04);
      });
    }

    // —— Ambient atmosphere: drifting battlefield smoke + embers (same fx art as in-mission). ——
    if (this.textures.exists("fx_smoke")) {
      this.add
        .particles(0, 0, "fx_smoke", {
          x: { min: -40, max: w + 40 },
          y: h + 30,
          lifespan: { min: 12000, max: 18000 },
          speedY: { min: -30, max: -55 },
          speedX: { min: -6, max: 6 },
          scale: { start: 0.9, end: 2.6 },
          alpha: { start: 0, end: 0.16, ease: "Sine.In" },
          frame: { frames: [0, 1, 2, 3], cycle: false },
          rotate: { min: -30, max: 30 },
          frequency: 320,
          quantity: 1,
          tint: 0x3a342a,
        })
        .setDepth(1.4);
    }
    if (this.textures.exists("fx_spark")) {
      this.add
        .particles(0, 0, "fx_spark", {
          x: { min: 0, max: w },
          y: h + 10,
          lifespan: { min: 5000, max: 8000 },
          speedY: { min: -40, max: -80 },
          speedX: { min: -10, max: 10 },
          scale: { start: 0.34, end: 0 },
          alpha: { start: 0.9, end: 0 },
          rotate: { min: 0, max: 360 },
          frequency: 80,
          quantity: 2,
          tint: 0xffb050,
          blendMode: Phaser.BlendModes.ADD,
        })
        .setDepth(1.4);
    }

    // —— Boot flourish: fade up through a resolving signal-glitch (same EMP shader as in-mission). ——
    this.cameras.main.fadeIn(420, 28, 22, 16);
    setGlitchPipeline(this.cameras.main, true, 1);
    const bootGlitch = { amount: 1 };
    this.tweens.add({
      targets: bootGlitch,
      amount: 0,
      duration: 700,
      ease: "Sine.Out",
      onUpdate: () => setGlitchPipeline(this.cameras.main, true, bootGlitch.amount),
      onComplete: () => setGlitchPipeline(this.cameras.main, false),
    });

    /** Hover feedback: scale toward `restScale() * mul` on pointerover, back to `restScale()` on pointerout. */
    const hoverPunch = (
      target: Phaser.GameObjects.GameObject & { scale: number },
      restScale: () => number,
      mul = 1.18
    ) => {
      target.on("pointerover", () => {
        this.tweens.add({ targets: target, scale: restScale() * mul, duration: 130, ease: "Back.Out" });
      });
      target.on("pointerout", () => {
        this.tweens.add({ targets: target, scale: restScale(), duration: 150, ease: "Sine.Out" });
      });
    };

    const title = this.add
      .text(w / 2, 42, "HELISTRIKE", {
        fontFamily: "Black Ops One, Impact, sans-serif",
        fontSize: "42px",
        color: "#e8b84a",
        stroke: "#1c1812",
        strokeThickness: 5,
      })
      .setOrigin(0.5)
      .setDepth(2)
      .setScale(0.82)
      .setAlpha(0);
    this.tweens.add({ targets: title, scale: 1, alpha: 1, duration: 480, delay: 80, ease: "Back.Out" });

    const crafts = allCrafts();
    const missions = allMissions();
    let craftIndex = Math.max(0, crafts.findIndex((c) => c.kind === craftOf().kind));
    let missionIndex = Math.max(0, missions.findIndex((m) => m.kind === missionOf().kind));
    // Focus stops for UP/DOWN: 0 = craft, 1 = mission, 2 = stats/help, 3+ = custom map option (row - 3).
    let row = 0;

    // —— Two-column layout: AIRFRAME (left) / OPERATION (right) — never share a row. ——
    const craftX = 300;
    const missionX = 970;
    const dividerX = 636;
    const headerY = 92;
    const cardY = 196;

    const divider = this.add
      .graphics()
      .setDepth(2)
      .setAlpha(0)
      .lineStyle(1, 0x554c39, 0.55)
      .lineBetween(dividerX, 82, dividerX, 616);
    this.tweens.add({ targets: divider, alpha: 1, duration: 500, delay: 180 });

    const craftHeader = this.add
      .text(craftX - 20, headerY, "AIRFRAME", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "14px",
        color: "#e8b84a",
        stroke: "#1c1812",
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setDepth(2)
      .setAlpha(0);
    this.tweens.add({ targets: craftHeader, x: craftX, alpha: 1, duration: 420, delay: 160, ease: "Sine.Out" });
    const missionHeader = this.add
      .text(missionX + 20, headerY, "OPERATION", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "14px",
        color: "#e8e0cc",
        stroke: "#1c1812",
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setDepth(2)
      .setAlpha(0);
    this.tweens.add({ targets: missionHeader, x: missionX, alpha: 1, duration: 420, delay: 160, ease: "Sine.Out" });

    const craftW = 148;
    const craftH = 128;
    const craftCards = crafts.map((craft, i) => {
      const x = craftX;
      const frame = this.add
        .rectangle(x, cardY, craftW, craftH, 0x0c0b09, 0.82)
        .setStrokeStyle(1, 0x5d5544, 0.8)
        .setDepth(2)
        .setInteractive({ useHandCursor: true });
      const art = this.add.image(x, cardY - 8, craft.body).setDepth(3);
      // Fit the card box; never upscale past native 1:1 (keeps drones crisp).
      const artScale = craftPreviewFitScale(art.width, art.height, 138, 106);
      art.setScale(artScale);
      const composite = craftComposite(craft);
      const rotors = composite.rotors.map((part) => {
        const along = craftRotorAlongScale(craft);
        const rotor = this.add
          .image(0, 0, part.tex)
          .setOrigin(part.origin.x, part.origin.y)
          .setDepth(4);
        const host =
          along < 0.999
            ? this.add.container(x, cardY - 8).setDepth(4).add(rotor)
            : rotor;
        if (along < 0.999) {
          rotor.setData("tiltWrap", host);
          (host as Phaser.GameObjects.Container).setScale(1, along);
        } else {
          rotor.setPosition(x, cardY - 8);
        }
        const sign = part.spinSign ?? -1;
        this.tweens.add({
          targets: rotor,
          rotation: sign * Math.PI * 2,
          duration: craftRotorPreviewSpinMs(craft),
          repeat: -1,
          ease: "Linear",
        });
        return rotor;
      });
      const exhaustMounts = craftExhaustMounts(craft);
      const exhaustTint = craftPreviewExhaustTint(craft.kind);
      const exhaustGlows = exhaustMounts.map((_, exhaustI) => {
        const glow = this.add
          .image(x, cardY - 8, "fx_exhaust_glow")
          .setOrigin(0.5, 0)
          .setBlendMode(Phaser.BlendModes.ADD)
          .setTint(exhaustTint)
          .setDepth(8.5)
          .setVisible(false);
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
      const label = this.add
        .text(x, cardY + craftH / 2 + 24, craft.name.toUpperCase(), {
          fontFamily: "Share Tech Mono, monospace",
          fontSize: "11px",
          color: "#cfc7b1",
          align: "center",
        })
        .setOrigin(0.5)
        .setDepth(5);
      frame.on("pointerdown", () => {
        row = 0;
        craftIndex = i;
        refreshSelection();
      });
      return {
        frame,
        art,
        label,
        artScale,
        rotorParts: composite.rotors,
        rotors,
        rotorAlong: craftRotorAlongScale(craft),
        exhaustMounts,
        exhaustGlows,
        wasSelected: false,
      };
    });

    const missionW = 156;
    const missionH = 156;
    const missionCards = missions.map((mission, i) => {
      const x = missionX;
      const frame = this.add
        .rectangle(x, cardY, missionW, missionH, 0x0b0a08, 0.88)
        .setStrokeStyle(1, 0x5d5544, 0.8)
        .setDepth(2)
        .setInteractive({ useHandCursor: true });
      const art = this.add
        .image(x, cardY, `menu_mission_preview_${mission.kind}`)
        .setDisplaySize(missionW - 8, missionH - 8)
        .setDepth(3);
      const artScaleX = art.scaleX;
      const artScaleY = art.scaleY;
      const label = this.add
        .text(x, cardY + missionH / 2 + 24, mission.label, {
          fontFamily: "Share Tech Mono, monospace",
          fontSize: "11px",
          color: "#cfc7b1",
          align: "center",
        })
        .setOrigin(0.5)
        .setDepth(5);
      frame.on("pointerdown", () => {
        row = 1;
        missionIndex = i;
        refreshSelection();
      });
      return { frame, art, label, artScaleX, artScaleY, wasSelected: false };
    });

    const carouselArrow = (x: number, y: number, dir: -1 | 1, targetRow: 0 | 1) => {
      const arrow = this.add
        .text(x, y, dir < 0 ? "‹" : "›", {
          fontFamily: "Share Tech Mono, monospace",
          fontSize: "42px",
          color: "#e8b84a",
          stroke: "#1c1812",
          strokeThickness: 4,
        })
        .setOrigin(0.5)
        .setDepth(8)
        .setInteractive({ useHandCursor: true });
      hoverPunch(arrow, () => 1, 1.24);
      arrow.on("pointerdown", () => {
        row = targetRow;
        if (targetRow === 0) craftIndex = (craftIndex + dir + crafts.length) % crafts.length;
        else missionIndex = (missionIndex + dir + missions.length) % missions.length;
        refreshSelection();
      });
      return arrow;
    };
    carouselArrow(craftX - craftW / 2 - 32, cardY - 8, -1, 0);
    carouselArrow(craftX + craftW / 2 + 32, cardY - 8, 1, 0);
    carouselArrow(missionX - missionW / 2 - 32, cardY, -1, 1);
    carouselArrow(missionX + missionW / 2 + 32, cardY, 1, 1);

    const craftLabelY = cardY + craftH / 2 + 24;
    const missionLabelY = cardY + missionH / 2 + 24;
    const craftDotsY = craftLabelY + 18;
    const missionDotsY = missionLabelY + 18;

    const carouselDots = (count: number, cx: number, y: number, targetRow: 0 | 1) =>
      Array.from({ length: count }, (_, i) => {
        const spacing = Math.min(13, 320 / Math.max(1, count - 1));
        const x = cx + (i - (count - 1) / 2) * spacing;
        const dot = this.add
          .circle(x, y, 3, 0x5d5544, 0.9)
          .setStrokeStyle(1, 0x1c1812, 0.9)
          .setDepth(8)
          .setInteractive({ useHandCursor: true });
        hoverPunch(dot, () => (i === (targetRow === 0 ? craftIndex : missionIndex) ? 1.45 : 1), 1.35);
        dot.on("pointerdown", () => {
          row = targetRow;
          if (targetRow === 0) craftIndex = i;
          else missionIndex = i;
          refreshSelection();
        });
        return dot;
      });
    const craftDots = carouselDots(crafts.length, craftX, craftDotsY, 0);
    const missionDots = carouselDots(missions.length, missionX, missionDotsY, 1);

    // —— Left column, stacked below the craft carousel: flight profile, then loadout. ——
    const statDefs = [
      { label: "SPEED", max: Math.max(...crafts.map((craft) => craft.maxSpeed)), value: (craft: (typeof crafts)[number]) => craft.maxSpeed },
      { label: "AGILITY", max: 1, value: (craft: (typeof crafts)[number]) => craftAgility(craft) },
      { label: "SIZE", max: Math.max(...crafts.map((craft) => craft.sizeM)), value: (craft: (typeof crafts)[number]) => craft.sizeM },
      { label: "ARMOR", max: Math.max(...crafts.map((craft) => craft.health)), value: (craft: (typeof crafts)[number]) => craft.health },
    ];
    const profileRows = statDefs.length + 1; // + ROLE
    const statsHeaderY = craftDotsY + 34;
    const statsRow0 = statsHeaderY + 18;
    const statsBottom = statsRow0 + (profileRows - 1) * 20 + 10;

    const maxWeaponSlots = Math.max(4, ...crafts.map((c) => c.sockets.length));
    const loadoutHeaderY = statsBottom + 28;
    const loadoutRow0 = loadoutHeaderY + 18;
    const loadoutBottom = loadoutRow0 + maxWeaponSlots * 20 + 10;

    const panelPad = 16;
    const panelBg = this.add
      .rectangle(
        craftX,
        (statsHeaderY - panelPad + loadoutBottom) / 2,
        craftW + 260,
        loadoutBottom - (statsHeaderY - panelPad),
        0x0b0a08,
        0.76
      )
      .setStrokeStyle(1, 0x554c39, 0.65)
      .setDepth(2)
      .setAlpha(0);
    this.tweens.add({ targets: panelBg, alpha: 1, duration: 420, delay: 260, ease: "Sine.Out" });

    // —— Field manual button, pinned to the panel's top-right corner (popup content comes later) ——
    const panelTop = statsHeaderY - panelPad;
    const panelRight = craftX + (craftW + 260) / 2;
    const infoBtn = this.add
      .circle(panelRight - 18, panelTop + 18, 13, 0x0b0a08, 0.9)
      .setStrokeStyle(1.5, 0xe8b84a, 0.9)
      .setDepth(4)
      .setAlpha(0)
      .setInteractive({ useHandCursor: true });
    const infoBtnGlyph = this.add
      .text(panelRight - 18, panelTop + 18, "?", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "14px",
        color: "#e8b84a",
      })
      .setOrigin(0.5)
      .setDepth(5)
      .setAlpha(0);
    this.tweens.add({ targets: [infoBtn, infoBtnGlyph], alpha: 1, duration: 380, delay: 420, ease: "Sine.Out" });
    this.tweens.add({
      targets: infoBtn,
      alpha: { from: 0.78, to: 1 },
      duration: 1500,
      delay: 900,
      yoyo: true,
      repeat: -1,
      ease: "Sine.InOut",
    });
    hoverPunch(infoBtn, () => 1, 1.28);
    const openFieldManual = () => {
      // TODO: open the field manual once it exists.
    };
    infoBtn.on("pointerdown", openFieldManual);

    const colHalf = (craftW + 260) / 2 - 14;
    const statLabelX = craftX - colHalf;
    const statBarX = statLabelX + 122;
    this.add
      .text(statLabelX, statsHeaderY, "FLIGHT PROFILE", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "9px",
        color: "#aaa28f",
        stroke: "#1c1812",
        strokeThickness: 2,
      })
      .setDepth(3);
    statDefs.forEach((stat, i) => {
      this.add
        .text(statLabelX, statsRow0 + i * 20, stat.label, {
          fontFamily: "Share Tech Mono, monospace",
          fontSize: "10px",
          color: "#d8d0ba",
          stroke: "#1c1812",
          strokeThickness: 2,
        })
        .setOrigin(0, 0.5)
        .setDepth(3);
    });
    this.add
      .text(statLabelX, statsRow0 + statDefs.length * 20, "ROLE", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "10px",
        color: "#d8d0ba",
        stroke: "#1c1812",
        strokeThickness: 2,
      })
      .setOrigin(0, 0.5)
      .setDepth(3);
    const roleTxt = this.add
      .text(statBarX, statsRow0 + statDefs.length * 20, "", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "10px",
        color: "#f2d579",
        stroke: "#1c1812",
        strokeThickness: 2,
      })
      .setOrigin(0, 0.5)
      .setDepth(3);
    const statBars = this.add.graphics().setDepth(3);
    const drawStatBars = (craft: (typeof crafts)[number]) => {
      statBars.clear();
      const segments = 8;
      const segmentW = 11;
      const segmentH = 6;
      const segmentGap = 3;
      statDefs.forEach((stat, statI) => {
        const filled = Math.max(1, Math.round((stat.value(craft) / stat.max) * segments));
        const y = statsRow0 - 3 + statI * 20;
        for (let segment = 0; segment < segments; segment++) {
          const x = statBarX + segment * (segmentW + segmentGap);
          statBars.fillStyle(segment < filled ? 0xe8b84a : 0x302b22, segment < filled ? 0.96 : 0.82);
          statBars.fillRoundedRect(x, y, segmentW, segmentH, 2);
          statBars.lineStyle(1, segment < filled ? 0xf2d579 : 0x5d5544, 0.7);
          statBars.strokeRoundedRect(x, y, segmentW, segmentH, 2);
        }
      });
    };

    const weaponX = craftX - colHalf;
    this.add
      .text(weaponX, loadoutHeaderY, "LOADOUT", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "9px",
        color: "#aaa28f",
        stroke: "#1c1812",
        strokeThickness: 2,
      })
      .setDepth(3);
    this.add
      .text(weaponX + colHalf * 2, loadoutHeaderY, "AMMO", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "9px",
        color: "#aaa28f",
        stroke: "#1c1812",
        strokeThickness: 2,
      })
      .setOrigin(1, 0)
      .setDepth(3);
    const rowW = colHalf * 2;
    const makeLoadoutRow = (y: number, alt: boolean) => {
      const frame = this.add
        .rectangle(weaponX + rowW / 2, y, rowW, 17, alt ? 0x15120d : 0x1b1710, 0.78)
        .setDepth(3);
      const slot = this.add
        .text(weaponX + 7, y, "", {
          fontFamily: "Share Tech Mono, monospace",
          fontSize: "10px",
          color: "#e8b84a",
          stroke: "#1c1812",
          strokeThickness: 2,
        })
        .setOrigin(0.5)
        .setDepth(4);
      const name = this.add
        .text(weaponX + 23, y, "", {
          fontFamily: "Share Tech Mono, monospace",
          fontSize: "9px",
          color: "#d8d0ba",
        })
        .setOrigin(0, 0.5)
        .setDepth(4);
      const crew = this.add
        .text(weaponX + 23, y, "", {
          fontFamily: "Share Tech Mono, monospace",
          fontSize: "9px",
          color: "#7ad0ff",
        })
        .setOrigin(0, 0.5)
        .setDepth(4)
        .setVisible(false);
      const ammo = this.add
        .text(weaponX + rowW, y, "", {
          fontFamily: "Share Tech Mono, monospace",
          fontSize: "10px",
          color: "#f2d579",
        })
        .setOrigin(1, 0.5)
        .setDepth(4);
      return { frame, slot, name, crew, ammo };
    };
    const maxLoadoutSlots = maxWeaponSlots;
    const weaponRows = Array.from({ length: maxLoadoutSlots }, (_, i) =>
      makeLoadoutRow(loadoutRow0 + i * 20, i % 2 === 1)
    );
    const cmRow = makeLoadoutRow(loadoutRow0 + maxLoadoutSlots * 20, maxLoadoutSlots % 2 === 1);

    // —— Right column, stacked below the mission carousel: briefing, then custom params. ——
    const briefingY = missionDotsY + 36;
    const detailTxt = this.add
      .text(missionX, briefingY, "", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "12px",
        color: "#d8d0ba",
        align: "center",
        lineSpacing: 5,
        wordWrap: { width: 420 },
        stroke: "#1c1812",
        strokeThickness: 3,
      })
      .setOrigin(0.5, 0)
      .setDepth(2)
      .setAlpha(0);
    this.tweens.add({ targets: detailTxt, alpha: 1, duration: 420, delay: 340, ease: "Sine.Out" });

    const customMission = missions.find((mission) => mission.kind === "custom")!;
    const customProfile = customMission.profile;
    const forceMixes = ["mixed", "naval", "heavy"] as const;
    const customParams = [
      {
        label: "LAND",
        value: () => customProfile.landBias.toFixed(2),
        adjust: (dir: number) => {
          customProfile.landBias = Phaser.Math.Clamp(customProfile.landBias + dir * 0.025, -0.2, 0.18);
        },
      },
      {
        label: "RELIEF",
        value: () => customProfile.relief.toFixed(2),
        adjust: (dir: number) => {
          customProfile.relief = Phaser.Math.Clamp(customProfile.relief + dir * 0.1, 0.7, 1.6);
        },
      },
      {
        label: "COAST",
        value: () => customProfile.edgeFalloff.toFixed(2),
        adjust: (dir: number) => {
          customProfile.edgeFalloff = Phaser.Math.Clamp(customProfile.edgeFalloff + dir * 0.05, 0.05, 0.55);
        },
      },
      {
        label: "RIVERS",
        value: () => String(customProfile.riverTarget),
        adjust: (dir: number) => {
          customProfile.riverTarget = Phaser.Math.Clamp(customProfile.riverTarget + dir * 4, 0, 72);
        },
      },
      {
        label: "OBJECTIVES",
        value: () => String(customProfile.objectiveCount),
        adjust: (dir: number) => {
          customProfile.objectiveCount = Phaser.Math.Clamp(customProfile.objectiveCount + dir, 2, 7);
        },
      },
      {
        label: "GARRISON",
        value: () => customProfile.garrisonScale.toFixed(1),
        adjust: (dir: number) => {
          customProfile.garrisonScale = Phaser.Math.Clamp(customProfile.garrisonScale + dir * 0.1, 0.4, 1.8);
        },
      },
      {
        label: "PATROLS",
        value: () => String(customProfile.patrolCount),
        adjust: (dir: number) => {
          customProfile.patrolCount = Phaser.Math.Clamp(customProfile.patrolCount + dir * 2, 8, 40);
        },
      },
      {
        label: "NAVAL",
        value: () => customProfile.waterPatrolBias.toFixed(2),
        adjust: (dir: number) => {
          customProfile.waterPatrolBias = Phaser.Math.Clamp(customProfile.waterPatrolBias + dir * 0.25, 0.25, 3);
        },
      },
      {
        label: "FORCES",
        value: () => customProfile.forceMix.toUpperCase(),
        adjust: (dir: number) => {
          const i = forceMixes.indexOf(customProfile.forceMix);
          customProfile.forceMix = forceMixes[(i + dir + forceMixes.length) % forceMixes.length]!;
          customProfile.waterPatrolBias =
            customProfile.forceMix === "naval" ? 2.4 : customProfile.forceMix === "heavy" ? 0.35 : 1;
        },
      },
    ];
    const customParamsY0 = briefingY + 96;
    const customParamCards = customParams.map((param, i) => {
      const col = i % 3;
      const line = (i / 3) | 0;
      const x = missionX - 168 + col * 168;
      const y = customParamsY0 + line * 27;
      const frame = this.add.rectangle(x, y, 158, 23, 0x0b0a08, 0.86).setDepth(2);
      const minus = this.add
        .text(x - 64, y, "−", {
          fontFamily: "Share Tech Mono, monospace",
          fontSize: "16px",
          color: "#e8b84a",
        })
        .setOrigin(0.5)
        .setDepth(3)
        .setInteractive({ useHandCursor: true });
      const value = this.add
        .text(x, y, "", {
          fontFamily: "Share Tech Mono, monospace",
          fontSize: "10px",
          color: "#d8d0ba",
        })
        .setOrigin(0.5)
        .setDepth(3);
      const plus = this.add
        .text(x + 64, y, "+", {
          fontFamily: "Share Tech Mono, monospace",
          fontSize: "16px",
          color: "#e8b84a",
        })
        .setOrigin(0.5)
        .setDepth(3)
        .setInteractive({ useHandCursor: true });
      hoverPunch(minus, () => 1, 1.3);
      hoverPunch(plus, () => 1, 1.3);
      minus.on("pointerdown", () => adjustCustomParam(i, -1));
      plus.on("pointerdown", () => adjustCustomParam(i, 1));
      value.setText(`${param.label}  ${param.value()}`);
      return { frame, minus, value, plus };
    });

    function syncCustomParams(): void {
      const visible = missions[missionIndex]!.kind === "custom";
      const focused = row - 3;
      customParamCards.forEach((card, i) => {
        const isFocused = visible && i === focused;
        card.frame
          .setVisible(visible)
          .setStrokeStyle(isFocused ? 2 : 1, isFocused ? 0xe8b84a : 0x554c39, 0.9);
        card.minus.setVisible(visible);
        card.plus.setVisible(visible);
        card.value.setVisible(visible).setText(`${customParams[i]!.label}  ${customParams[i]!.value()}`);
      });
    }

    function adjustCustomParam(i: number, dir: number): void {
      row = 3 + i;
      customParams[i]!.adjust(dir);
      const key = "menu_mission_preview_custom";
      const customIndex = missions.findIndex((mission) => mission.kind === "custom");
      if (customIndex >= 0) missionCards[customIndex]!.art.setTexture("menu_mission_preview_river_run");
      if (thisScene.textures.exists(key)) thisScene.textures.remove(key);
      ensureMissionPreviews(thisScene.textures);
      if (customIndex >= 0) missionCards[customIndex]!.art.setTexture(key);
      refreshSelection();
    }

    const thisScene = this;
    const refreshSelection = () => {
      const craft = crafts[craftIndex]!;
      const mission = missions[missionIndex]!;
      if (row >= 3 && mission.kind !== "custom") row = 1;
      selectCraft(craft.kind);
      selectMission(mission.kind);
      craftHeader.setColor(row === 0 ? "#e8b84a" : "#8f8774");
      missionHeader.setColor(row === 1 ? "#e8b84a" : "#8f8774");
      const helpFocused = row === 2;
      panelBg.setStrokeStyle(helpFocused ? 2 : 1, helpFocused ? 0xe8b84a : 0x554c39, helpFocused ? 1 : 0.65);
      infoBtn.setStrokeStyle(helpFocused ? 2.5 : 1.5, 0xe8b84a, 0.9);
      craftCards.forEach((card, i) => {
        const selected = i === craftIndex;
        const justSelected = selected && !card.wasSelected;
        card.wasSelected = selected;
        const popAlpha = justSelected ? 0 : 1;
        card.frame
          .setVisible(selected)
          .setPosition(craftX, cardY)
          .setScale(1.05)
          .setDepth(7)
          .setAlpha(popAlpha)
          .setFillStyle(0x241e10, 0.96)
          .setStrokeStyle(row === 0 ? 3 : 2, 0xe8b84a, 1);
        card.art
          .setVisible(selected)
          .setPosition(craftX, cardY - 8)
          .setScale(Math.min(1, card.artScale * 1.05))
          .setDepth(8)
          .setAlpha(popAlpha);
        // Live-object bevel glow (same shader as in-mission units) on the selected airframe only.
        if (selected) applyEdgeLight(card.art, 0, 0.42);
        else clearEdgeLight(card.art);
        const fadeTargets: Phaser.GameObjects.GameObject[] = [card.frame, card.art, card.label];
        card.rotors.forEach((rotor, rotorI) => {
          const part = card.rotorParts[rotorI]!;
          const at = spriteUvPos(card.art, part.mount.x, part.mount.y);
          const sc = craftCompositePartScale(part, rotor.width, card.art.scaleX);
          const along = card.rotorAlong;
          const wrap = rotor.getData("tiltWrap") as Phaser.GameObjects.Container | undefined;
          if (wrap?.scene) {
            wrap
              .setVisible(selected)
              .setPosition(at.x, at.y)
              .setScale(sc, sc * along)
              .setDepth(9)
              .setAlpha(popAlpha);
            rotor.setPosition(0, 0).setScale(1).setVisible(selected).setAlpha(1);
            fadeTargets.push(wrap);
          } else {
            rotor
              .setVisible(selected)
              .setPosition(at.x, at.y)
              .setScale(sc)
              .setDepth(9)
              .setAlpha(popAlpha);
            fadeTargets.push(rotor);
          }
        });
        card.exhaustGlows.forEach((glow, exhaustI) => {
          const mount = card.exhaustMounts[exhaustI]!;
          const at = spriteUvPos(card.art, mount.x, mount.y);
          const glowSc = craftPreviewExhaustScale(card.art.scaleX);
          glow
            .setVisible(selected)
            .setPosition(at.x, at.y)
            .setScale(glowSc.x, glowSc.y)
            .setDepth(8.5);
        });
        card.label
          .setVisible(selected)
          .setPosition(craftX, craftLabelY)
          .setScale(1)
          .setDepth(10)
          .setAlpha(popAlpha)
          .setColor("#f2d579");
        if (justSelected) {
          this.tweens.add({ targets: fadeTargets, alpha: 1, duration: 260, ease: "Sine.Out" });
          card.frame.setScale(0.94);
          this.tweens.add({ targets: card.frame, scale: 1.05, duration: 240, ease: "Back.Out" });
        }
      });
      craftDots.forEach((dot, i) =>
        dot
          .setFillStyle(i === craftIndex ? 0xe8b84a : 0x5d5544, i === craftIndex ? 1 : 0.9)
          .setScale(i === craftIndex ? 1.45 : 1)
      );
      missionCards.forEach((card, i) => {
        const selected = i === missionIndex;
        const justSelected = selected && !card.wasSelected;
        card.wasSelected = selected;
        const popAlpha = justSelected ? 0 : 1;
        card.frame
          .setVisible(selected)
          .setPosition(missionX, cardY)
          .setScale(1)
          .setDepth(7)
          .setAlpha(popAlpha)
          .setFillStyle(0x241e10, 0.96)
          .setStrokeStyle(row === 1 ? 3 : 2, 0xe8b84a, 1);
        card.art
          .setVisible(selected)
          .setPosition(missionX, cardY)
          .setScale(card.artScaleX, card.artScaleY)
          .setDepth(8)
          .setAlpha(popAlpha);
        // Live-object bevel glow (same shader as in-mission units) on the selected theater only.
        if (selected) applyEdgeLight(card.art, 0, 0.35);
        else clearEdgeLight(card.art);
        card.label
          .setVisible(selected)
          .setPosition(missionX, missionLabelY)
          .setScale(1)
          .setDepth(10)
          .setAlpha(popAlpha)
          .setColor("#f2d579");
        if (justSelected) {
          this.tweens.add({ targets: [card.frame, card.art, card.label], alpha: 1, duration: 260, ease: "Sine.Out" });
          card.frame.setScale(0.94);
          this.tweens.add({ targets: card.frame, scale: 1, duration: 240, ease: "Back.Out" });
        }
      });
      missionDots.forEach((dot, i) =>
        dot
          .setFillStyle(i === missionIndex ? 0xe8b84a : 0x5d5544, i === missionIndex ? 1 : 0.9)
          .setScale(i === missionIndex ? 1.45 : 1)
      );
      const weapons = playerLoadoutFromSockets(craft.sockets);
      drawStatBars(craft);
      roleTxt.setText(craft.role.toUpperCase());
      weaponRows.forEach((row, i) => {
        const weapon = weapons[i];
        const on = !!weapon;
        row.frame.setVisible(on);
        row.slot.setVisible(on);
        row.name.setVisible(on);
        row.crew.setVisible(on);
        row.ammo.setVisible(on);
        if (!weapon) return;
        row.slot.setText(String(i + 1)).setColor("#e8b84a");
        const parts = craftLoadoutParts(craft, i, weapon.fullName);
        row.name.setText(parts.base);
        if (parts.crew) {
          row.crew
            .setText(parts.crew)
            .setVisible(true)
            .setPosition(row.name.x + row.name.width, row.name.y);
        } else {
          row.crew.setText("").setVisible(false);
        }
        const capacity = craftSocketStartingAmmo(weapon.ammo, craft, i);
        row.ammo.setText(capacity === Infinity ? "∞" : String(capacity));
      });
      const cm = COUNTERMEASURES[craftCountermeasure(craft.countermeasure)];
      const cmY = loadoutRow0 + weapons.length * 20;
      cmRow.frame.setVisible(true).setPosition(weaponX + rowW / 2, cmY);
      cmRow.slot.setVisible(true).setPosition(weaponX + 7, cmY).setText("E").setColor("#7ad0ff");
      cmRow.name.setVisible(true).setPosition(weaponX + 23, cmY).setText(cm.name).setColor("#c8d4e8");
      cmRow.crew.setVisible(false).setText("");
      cmRow.ammo.setVisible(true).setPosition(weaponX + rowW, cmY).setText(countermeasureTimingLabel(cm)).setColor("#8ec8e8");
      detailTxt.setText(mission.briefing);
      syncCustomParams();
    };

    // Custom map options only count as UP/DOWN stops while a custom mission is selected.
    const focusStopCount = () => 3 + (missions[missionIndex]!.kind === "custom" ? customParams.length : 0);

    const cycleSelection = (dir: number) => {
      if (row === 0) craftIndex = (craftIndex + dir + crafts.length) % crafts.length;
      else if (row === 1) missionIndex = (missionIndex + dir + missions.length) % missions.length;
      else if (row >= 3) adjustCustomParam(row - 3, dir);
      refreshSelection();
    };
    refreshSelection();

    const go = this.add
      .text(w / 2, 672, "[  DEPLOY  ]", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "22px",
        color: "#1c1812",
        backgroundColor: "#e8b84a",
        padding: { x: 18, y: 10 },
      })
      .setOrigin(0.5)
      .setDepth(2)
      .setAlpha(0)
      .setScale(0.88)
      .setInteractive({ useHandCursor: true });
    this.tweens.add({ targets: go, alpha: 1, scale: 1, duration: 420, delay: 560, ease: "Back.Out" });
    go.on("pointerover", () => {
      go.setStyle({ backgroundColor: "#f2d579" });
      this.tweens.add({ targets: go, scale: 1.06, duration: 130, ease: "Back.Out" });
    });
    go.on("pointerout", () => {
      go.setStyle({ backgroundColor: "#e8b84a" });
      this.tweens.add({ targets: go, scale: 1, duration: 150, ease: "Sine.Out" });
    });

    // —— Deploy: press punch, glitch-out through the same EMP shader, then hand off to loadout. ——
    let deploying = false;
    const deploy = () => {
      if (deploying) return;
      deploying = true;
      go.disableInteractive();
      this.tweens.add({ targets: go, scale: 0.92, duration: 90, yoyo: true, ease: "Sine.Out" });
      setGlitchPipeline(this.cameras.main, true, 0);
      const deployGlitch = { amount: 0 };
      this.tweens.add({
        targets: deployGlitch,
        amount: 1,
        duration: 300,
        ease: "Sine.In",
        onUpdate: () => setGlitchPipeline(this.cameras.main, true, deployGlitch.amount),
      });
      this.cameras.main.fadeOut(320, 12, 10, 8);
      this.time.delayedCall(340, () => this.scene.start("load"));
    };
    go.on("pointerdown", deploy);
    // ENTER/SPACE activate whatever currently has focus: help, or deploy from anywhere else.
    const activate = () => {
      if (row === 2) openFieldManual();
      else deploy();
    };
    this.input.keyboard?.on("keydown-ENTER", activate);
    this.input.keyboard?.on("keydown-SPACE", activate);

    const selectUp = () => {
      const n = focusStopCount();
      row = (row - 1 + n) % n;
      refreshSelection();
    };
    const selectDown = () => {
      const n = focusStopCount();
      row = (row + 1) % n;
      refreshSelection();
    };
    const selectLeft = () => cycleSelection(-1);
    const selectRight = () => cycleSelection(1);
    this.input.keyboard?.on("keydown-UP", selectUp);
    this.input.keyboard?.on("keydown-DOWN", selectDown);
    this.input.keyboard?.on("keydown-LEFT", selectLeft);
    this.input.keyboard?.on("keydown-RIGHT", selectRight);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.keyboard?.off("keydown-UP", selectUp);
      this.input.keyboard?.off("keydown-DOWN", selectDown);
      this.input.keyboard?.off("keydown-LEFT", selectLeft);
      this.input.keyboard?.off("keydown-RIGHT", selectRight);
      this.input.keyboard?.off("keydown-ENTER", activate);
      this.input.keyboard?.off("keydown-SPACE", activate);
    });
    installRigHotkeys(this);
  }
}
