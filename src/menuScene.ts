import Phaser from "phaser";
import {
  COUNTERMEASURES,
  craftCountermeasure,
  countermeasureTimingLabel,
  playerLoadoutFromSockets,
} from "./combat";
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
} from "./craft";
import { allMissions, missionOf, selectMission } from "./mission";
import { installRigHotkeys } from "./rigs";
import { ensureExhaustGlow, spriteUvPos } from "./sprites";
import { ensureMissionPreviews } from "./menuChrome";

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
      bg.setScale(Math.max(sx, sy));
      this.add
        .rectangle(w / 2, h / 2, w, h, 0x0c0a08, 0.58)
        .setDepth(1);
    }
    this.add
      .text(w / 2, 54, "HELISTRIKE", {
        fontFamily: "Black Ops One, Impact, sans-serif",
        fontSize: "54px",
        color: "#e8b84a",
        stroke: "#1c1812",
        strokeThickness: 5,
      })
      .setOrigin(0.5)
      .setDepth(2);
    const crafts = allCrafts();
    const missions = allMissions();
    let craftIndex = Math.max(0, crafts.findIndex((c) => c.kind === craftOf().kind));
    let missionIndex = Math.max(0, missions.findIndex((m) => m.kind === missionOf().kind));
    let row = 0;
    let customParamIndex = 0;

    const craftHeader = this.add
      .text(w / 2, 111, "AIRFRAME", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "13px",
        color: "#e8b84a",
        stroke: "#1c1812",
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setDepth(2);
    const missionHeader = this.add
      .text(w / 2, 374, "OPERATION", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "13px",
        color: "#e8e0cc",
        stroke: "#1c1812",
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setDepth(2);

    const craftW = 112;
    const craftH = 108;
    const craftCards = crafts.map((craft, i) => {
      const x = w / 2;
      const frame = this.add
        .rectangle(x, 190, craftW, craftH, 0x0c0b09, 0.82)
        .setStrokeStyle(1, 0x5d5544, 0.8)
        .setDepth(2)
        .setInteractive({ useHandCursor: true });
      const art = this.add.image(x, 181, craft.body).setDepth(3);
      // Fit the card box; never upscale past native 1:1 (keeps drones crisp).
      const artScale = craftPreviewFitScale(art.width, art.height, 104, 82);
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
            ? this.add.container(x, 181).setDepth(4).add(rotor)
            : rotor;
        if (along < 0.999) {
          rotor.setData("tiltWrap", host);
          (host as Phaser.GameObjects.Container).setScale(1, along);
        } else {
          rotor.setPosition(x, 181);
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
          .image(x, 181, "fx_exhaust_glow")
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
        .text(x, 229, craft.name.toUpperCase(), {
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
      };
    });

    const missionW = 134;
    const missionH = 134;
    const missionCards = missions.map((mission, i) => {
      const x = w / 2;
      const frame = this.add
        .rectangle(x, 450, missionW, missionH, 0x0b0a08, 0.88)
        .setStrokeStyle(1, 0x5d5544, 0.8)
        .setDepth(2)
        .setInteractive({ useHandCursor: true });
      const art = this.add
        .image(x, 450, `menu_mission_preview_${mission.kind}`)
        .setDisplaySize(missionW - 8, missionH - 8)
        .setDepth(3);
      const artScaleX = art.scaleX;
      const artScaleY = art.scaleY;
      const strip = this.add.rectangle(x, 497, missionW - 8, 28, 0x090908, 0.88).setDepth(3);
      const label = this.add
        .text(x, 497, mission.label, {
          fontFamily: "Share Tech Mono, monospace",
          fontSize: "14px",
          color: "#d8d0ba",
        })
        .setOrigin(0.5)
        .setDepth(4);
      frame.on("pointerdown", () => {
        row = 1;
        missionIndex = i;
        refreshSelection();
      });
      return { frame, art, strip, label, artScaleX, artScaleY };
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
      arrow.on("pointerdown", () => {
        row = targetRow;
        if (targetRow === 0) craftIndex = (craftIndex + dir + crafts.length) % crafts.length;
        else missionIndex = (missionIndex + dir + missions.length) % missions.length;
        refreshSelection();
      });
      return arrow;
    };
    carouselArrow(w / 2 - 112, 179, -1, 0);
    carouselArrow(w / 2 + 112, 179, 1, 0);
    carouselArrow(w / 2 - 112, 450, -1, 1);
    carouselArrow(w / 2 + 112, 450, 1, 1);

    const carouselDots = (count: number, y: number, targetRow: 0 | 1) =>
      Array.from({ length: count }, (_, i) => {
        const x = w / 2 + (i - (count - 1) / 2) * 14;
        const dot = this.add
          .circle(x, y, 3.5, 0x5d5544, 0.9)
          .setStrokeStyle(1, 0x1c1812, 0.9)
          .setDepth(8)
          .setInteractive({ useHandCursor: true });
        dot.on("pointerdown", () => {
          row = targetRow;
          if (targetRow === 0) craftIndex = i;
          else missionIndex = i;
          refreshSelection();
        });
        return dot;
      });
    const craftDots = carouselDots(crafts.length, 242, 0);
    const missionDots = carouselDots(missions.length, 524, 1);

    const statDefs = [
      { label: "SPEED", max: Math.max(...crafts.map((craft) => craft.maxSpeed)), value: (craft: (typeof crafts)[number]) => craft.maxSpeed },
      { label: "AGILITY", max: 1, value: (craft: (typeof crafts)[number]) => craftAgility(craft) },
      { label: "SIZE", max: Math.max(...crafts.map((craft) => craft.sizeM)), value: (craft: (typeof crafts)[number]) => craft.sizeM },
      { label: "ARMOR", max: Math.max(...crafts.map((craft) => craft.health)), value: (craft: (typeof crafts)[number]) => craft.health },
    ];
    const loadoutRow0 = 271;
    const maxWeaponSlots = Math.max(4, ...crafts.map((c) => c.sockets.length));
    const infoTop = 248;
    const profileRows = statDefs.length + 1; // + ROLE
    const infoBottom = Math.max(
      loadoutRow0 + (maxWeaponSlots + 1) * 20 + 14,
      271 + profileRows * 20 + 14
    );
    const infoH = infoBottom - infoTop;
    const infoCy = (infoTop + infoBottom) / 2;
    this.add
      .rectangle(w / 2, infoCy, 700, infoH, 0x0b0a08, 0.76)
      .setStrokeStyle(1, 0x554c39, 0.65)
      .setDepth(2);
    const infoRule = this.add.graphics().setDepth(3);
    infoRule.lineStyle(1, 0x554c39, 0.7).lineBetween(w / 2 + 20, 256, w / 2 + 20, infoBottom - 8);
    const statLabelX = w / 2 - 315;
    const statBarX = w / 2 - 205;
    this.add
      .text(statLabelX, 253, "FLIGHT PROFILE", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "9px",
        color: "#aaa28f",
        stroke: "#1c1812",
        strokeThickness: 2,
      })
      .setDepth(3);
    statDefs.forEach((stat, i) => {
      this.add
        .text(statLabelX, 271 + i * 20, stat.label, {
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
      .text(statLabelX, 271 + statDefs.length * 20, "ROLE", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "10px",
        color: "#d8d0ba",
        stroke: "#1c1812",
        strokeThickness: 2,
      })
      .setOrigin(0, 0.5)
      .setDepth(3);
    const roleTxt = this.add
      .text(statBarX, 271 + statDefs.length * 20, "", {
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
        const y = 268 + statI * 20;
        for (let segment = 0; segment < segments; segment++) {
          const x = statBarX + segment * (segmentW + segmentGap);
          statBars.fillStyle(segment < filled ? 0xe8b84a : 0x302b22, segment < filled ? 0.96 : 0.82);
          statBars.fillRoundedRect(x, y, segmentW, segmentH, 2);
          statBars.lineStyle(1, segment < filled ? 0xf2d579 : 0x5d5544, 0.7);
          statBars.strokeRoundedRect(x, y, segmentW, segmentH, 2);
        }
      });
    };

    const weaponX = w / 2 + 50;
    this.add
      .text(weaponX, 253, "LOADOUT", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "9px",
        color: "#aaa28f",
        stroke: "#1c1812",
        strokeThickness: 2,
      })
      .setDepth(3);
    this.add
      .text(weaponX + 255, 253, "AMMO", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "9px",
        color: "#aaa28f",
        stroke: "#1c1812",
        strokeThickness: 2,
      })
      .setOrigin(1, 0)
      .setDepth(3);
    const maxLoadoutSlots = maxWeaponSlots;
    const makeLoadoutRow = (y: number, alt: boolean) => {
      const frame = this.add
        .rectangle(weaponX + 128, y, 270, 17, alt ? 0x15120d : 0x1b1710, 0.78)
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
        .text(weaponX + 255, y, "", {
          fontFamily: "Share Tech Mono, monospace",
          fontSize: "10px",
          color: "#f2d579",
        })
        .setOrigin(1, 0.5)
        .setDepth(4);
      return { frame, slot, name, crew, ammo };
    };
    const weaponRows = Array.from({ length: maxLoadoutSlots }, (_, i) =>
      makeLoadoutRow(loadoutRow0 + i * 20, i % 2 === 1)
    );
    const cmRow = makeLoadoutRow(loadoutRow0 + maxLoadoutSlots * 20, maxLoadoutSlots % 2 === 1);

    const detailTxt = this.add
      .text(w / 2, 542, "", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "11px",
        color: "#d8d0ba",
        align: "center",
        lineSpacing: 3,
        wordWrap: { width: Math.min(1120, w - 80) },
        stroke: "#1c1812",
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setDepth(2);

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
    const customParamCards = customParams.map((param, i) => {
      const col = i % 5;
      const line = (i / 5) | 0;
      const x = w / 2 - 425 + col * 170 + 85;
      const y = 564 + line * 27;
      const frame = this.add.rectangle(x, y, 162, 23, 0x0b0a08, 0.86).setDepth(2);
      const minus = this.add
        .text(x - 66, y, "−", {
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
          fontSize: "11px",
          color: "#d8d0ba",
        })
        .setOrigin(0.5)
        .setDepth(3);
      const plus = this.add
        .text(x + 66, y, "+", {
          fontFamily: "Share Tech Mono, monospace",
          fontSize: "16px",
          color: "#e8b84a",
        })
        .setOrigin(0.5)
        .setDepth(3)
        .setInteractive({ useHandCursor: true });
      minus.on("pointerdown", () => adjustCustomParam(i, -1));
      plus.on("pointerdown", () => adjustCustomParam(i, 1));
      value.setText(`${param.label}  ${param.value()}`);
      return { frame, minus, value, plus };
    });

    function syncCustomParams(): void {
      const visible = missions[missionIndex]!.kind === "custom";
      customParamCards.forEach((card, i) => {
        card.frame
          .setVisible(visible)
          .setStrokeStyle(i === customParamIndex && row === 2 ? 2 : 1, i === customParamIndex && row === 2 ? 0xe8b84a : 0x554c39, 0.9);
        card.minus.setVisible(visible);
        card.plus.setVisible(visible);
        card.value.setVisible(visible).setText(`${customParams[i]!.label}  ${customParams[i]!.value()}`);
      });
    }

    function adjustCustomParam(i: number, dir: number): void {
      row = 2;
      customParamIndex = i;
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
      if (row === 2 && mission.kind !== "custom") row = 1;
      selectCraft(craft.kind);
      selectMission(mission.kind);
      craftHeader.setColor(row === 0 ? "#e8b84a" : "#8f8774");
      missionHeader.setColor(row === 1 ? "#e8b84a" : "#8f8774");
      craftCards.forEach((card, i) => {
        const selected = i === craftIndex;
        card.frame
          .setVisible(selected)
          .setPosition(w / 2, 179)
          .setScale(1.05)
          .setDepth(7)
          .setFillStyle(0x241e10, 0.96)
          .setStrokeStyle(row === 0 ? 3 : 2, 0xe8b84a, 1);
        card.art
          .setVisible(selected)
          .setPosition(w / 2, 170)
          .setScale(Math.min(1, card.artScale * 1.05))
          .setDepth(8)
          .setAlpha(1);
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
              .setAlpha(1);
            rotor.setPosition(0, 0).setScale(1).setVisible(selected).setAlpha(1);
          } else {
            rotor
              .setVisible(selected)
              .setPosition(at.x, at.y)
              .setScale(sc)
              .setDepth(9)
              .setAlpha(1);
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
          .setPosition(w / 2, 220)
          .setScale(1)
          .setDepth(10)
          .setColor("#f2d579");
      });
      craftDots.forEach((dot, i) =>
        dot
          .setFillStyle(i === craftIndex ? 0xe8b84a : 0x5d5544, i === craftIndex ? 1 : 0.9)
          .setScale(i === craftIndex ? 1.45 : 1)
      );
      missionCards.forEach((card, i) => {
        const selected = i === missionIndex;
        card.frame
          .setVisible(selected)
          .setPosition(w / 2, 450)
          .setScale(1)
          .setDepth(7)
          .setFillStyle(0x241e10, 0.96)
          .setStrokeStyle(row === 1 ? 3 : 2, 0xe8b84a, 1);
        card.art
          .setVisible(selected)
          .setPosition(w / 2, 450)
          .setScale(card.artScaleX, card.artScaleY)
          .setDepth(8)
          .setAlpha(1);
        card.strip
          .setVisible(selected)
          .setPosition(w / 2, 497)
          .setScale(1)
          .setDepth(8)
          .setAlpha(0.94);
        card.label
          .setVisible(selected)
          .setPosition(w / 2, 497)
          .setScale(1)
          .setDepth(9)
          .setColor("#f2d579");
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
      cmRow.frame.setVisible(true).setPosition(weaponX + 128, cmY);
      cmRow.slot.setVisible(true).setPosition(weaponX + 7, cmY).setText("E").setColor("#7ad0ff");
      cmRow.name.setVisible(true).setPosition(weaponX + 23, cmY).setText(cm.name).setColor("#c8d4e8");
      cmRow.crew.setVisible(false).setText("");
      cmRow.ammo.setVisible(true).setPosition(weaponX + 255, cmY).setText(countermeasureTimingLabel(cm)).setColor("#8ec8e8");
      detailTxt.setText(`${mission.label}  ·  ${mission.briefing}`);
      syncCustomParams();
    };

    const cycleSelection = (dir: number) => {
      if (row === 0) craftIndex = (craftIndex + dir + crafts.length) % crafts.length;
      else if (row === 1) missionIndex = (missionIndex + dir + missions.length) % missions.length;
      else adjustCustomParam(customParamIndex, dir);
      refreshSelection();
    };
    refreshSelection();

    const go = this.add
      .text(w / 2, 650, "[  DEPLOY  ]", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "22px",
        color: "#1c1812",
        backgroundColor: "#e8b84a",
        padding: { x: 18, y: 10 },
      })
      .setOrigin(0.5)
      .setDepth(2)
      .setInteractive({ useHandCursor: true });
    go.on("pointerdown", () => this.scene.start("load"));
    this.input.keyboard?.once("keydown-ENTER", () => this.scene.start("load"));
    this.input.keyboard?.once("keydown-SPACE", () => this.scene.start("load"));

    const selectUp = () => {
      const rows = missions[missionIndex]!.kind === "custom" ? 3 : 2;
      row = (row - 1 + rows) % rows;
      refreshSelection();
    };
    const selectDown = () => {
      const rows = missions[missionIndex]!.kind === "custom" ? 3 : 2;
      row = (row + 1) % rows;
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
    });
    installRigHotkeys(this);
  }
}
