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
  craftLoadoutParts,
  craftOf,
  craftPreviewFitScale,
  craftSocketStartingAmmo,
  selectCraft,
} from "../sim/crafts";
import { allMissions, missionOf, selectMission } from "../sim/mission";
import { MAP_SHAPES } from "../worldgen/shape";
import { LANDFORM_KINDS } from "../worldgen/landforms";
import { OBJECTIVE_SITINGS } from "../worldgen/world";
import { TERRAIN_THEME_IDS, themeOf } from "../worldgen/theme";
import { craftFirepowerRating } from "../sim/remote";
import { installRigHotkeys, rigsAnyOpen } from "../rigs/rigs";
import { ensureExhaustGlow } from "../art/sprites";
import {
  adjustThreeRegionMadMul,
  computeThreeRegionScale,
  drawThreeRegionBar,
  ensureMissionPreviews,
  getThreeRegionMadMul,
} from "../ui/menuChrome";
import { FieldManual } from "../ui/fieldManual";
import { buildCraftPreviewOverlay, type CraftPreviewOverlay } from "../ui/craftPreview";
import { applyEdgeLight, clearEdgeLight } from "../render/edgeLight";
import { setGlitchPipeline } from "../render/glitch";
import { MenuDebugMenu } from "./menuDebugMenu";

// —— Ring carousel tuning: shared by both the craft strip and the map strip. ——
const RING_SPACING = 85;
const RING_MAX = 2;
const RING_SCALE = [1, 0.72, 0.5] as const; // indexed by |offset|, clamped to RING_MAX
const RING_ALPHA = [1, 0.55, 0.28] as const;
// Each ring slot gets its own depth band (closer to center = higher), and within a band the
// frame/art/label keep a fixed internal stacking order — so nearer cards always draw fully
// above farther ones, and a card's own layers never cross another card's.
const RING_BAND_SPAN = 10;
const RING_LAYER = { frame: 0, art: 2, label: 5 } as const;

function ringOffset(i: number, selected: number, count: number): number {
  let d = i - selected;
  const half = count / 2;
  if (d > half) d -= count;
  if (d < -half) d += count;
  return d;
}

function ringBand(ad: number): number {
  return (RING_MAX + 1 - Math.min(ad, RING_MAX + 1)) * RING_BAND_SPAN;
}

/** Main menu backdrops (paths under public/); one is picked at random each time the menu opens. */
const MENU_BACKDROPS = [
  "menu-splash.png",
  "artwork/crafts/blackhawk-cinematic-v3.png",
  "artwork/crafts/chinook-cinematic-v4.png",
  "artwork/crafts/cobra-cinematic-v2.png",
  "artwork/crafts/cyberhawk-cinematic-v4.png",
  "artwork/crafts/gunship-cinematic-v3.png",
  "artwork/crafts/lightning-ii-cinematic-v4.png",
  "artwork/crafts/littlebird-cinematic-v3.png",
  "artwork/crafts/marauder-cinematic.png",
  "artwork/crafts/murder-hornet-cinematic.png",
  "artwork/crafts/osprey-cinematic.png",
  "artwork/crafts/prometheus-cinematic-v4.png",
  "artwork/crafts/reaper-cinematic.png",
  "artwork/crafts/stealthhawk-cinematic-night.png",
  "artwork/crafts/stealthhawk-cinematic-v3.png",
  "artwork/crafts/viper-cinematic-v2.png",
  "artwork/crafts/warthog-cinematic-v2.png",
];

export class MenuScene extends Phaser.Scene {
  /** Texture key of this visit's backdrop (loaded on first use, then cached). */
  private backdropKey = "";

  constructor() {
    super("menu");
  }

  preload(): void {
    const file = MENU_BACKDROPS[Math.floor(Math.random() * MENU_BACKDROPS.length)]!;
    this.backdropKey = `menu_backdrop:${file}`;
    if (!this.textures.exists(this.backdropKey)) this.load.image(this.backdropKey, file);
  }

  create(): void {
    const { width: w, height: h } = this.scale;
    this.cameras.main.setBackgroundColor("#1c1812");
    this.input.setDefaultCursor("default");
    ensureMissionPreviews(this.textures);
    ensureExhaustGlow(this.textures);
    if (this.textures.exists(this.backdropKey)) {
      const bg = this.add.image(w / 2, h / 2, this.backdropKey).setDepth(0);
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
      type EmberParticle = Phaser.GameObjects.Particles.Particle & {
        emberScale?: number;
        emberWobbleFreq?: number;
        emberWobbleAmp?: number;
        emberWobblePhase?: number;
      };
      this.add
        .particles(0, 0, "fx_spark", {
          x: { min: 0, max: w },
          y: h + 10,
          // Much longer-lived than a spark — this is rising ash, not a flying ember — but still
          // moving briskly upward.
          lifespan: { min: 8000, max: 13000 },
          speedY: { min: -30, max: -65 },
          // speedX is emit-only in Phaser (no onUpdate) — the erratic back-and-forth wobble has
          // to come from a continuously oscillating acceleration instead, like ash caught in
          // eddies — kept subtle so it reads as a wobble, not a sideways dash.
          // Acceleration integrates over the particle's whole (long) life, so a low oscillation
          // frequency builds up a lot of sideways velocity even from a "small" amplitude —
          // higher frequency + low amplitude keeps this a tight jitter, not a sideways sweep.
          speedX: {
            onEmit: (p) => {
              const q = p as EmberParticle;
              q.emberWobbleFreq = 2.2 + Math.random() * 2.8;
              q.emberWobbleAmp = 10 + Math.random() * 18;
              q.emberWobblePhase = Math.random() * Math.PI * 2;
              return (Math.random() - 0.5) * 3;
            },
          },
          accelerationX: {
            onUpdate: (p, _k, t) => {
              const q = p as EmberParticle;
              return Math.sin(t * Math.PI * 2 * (q.emberWobbleFreq ?? 3) + (q.emberWobblePhase ?? 0)) * (q.emberWobbleAmp ?? 15);
            },
          },
          scale: {
            // Exponential bias: mostly small flecks, with large ones rare.
            onEmit: (p) => {
              const q = p as EmberParticle;
              q.emberScale = 0.16 + Math.pow(Math.random(), 4) * 0.65;
              return q.emberScale;
            },
            // Shrink to nothing over its (long) life, not just fade — dying ash visibly withers.
            onUpdate: (p, _k, t) => (p as EmberParticle).emberScale! * (1 - t),
          },
          alpha: { start: 0.9, end: 0 },
          rotate: { min: 0, max: 360 },
          frequency: 130,
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

    // —— Two-row layout: CRAFT strip (top) / MAP strip (bottom). Each strip has three zones:
    // [carousel] a rotating ring of previews | [info] stats/briefing | [more info] loadout/params. ——
    const contentX0 = 50;
    const contentX1 = 1220;
    const carouselW = 430;
    const zoneGap = 30;

    const boxPadX = 18;
    const carouselX0 = contentX0;
    const carouselX1 = carouselX0 + carouselW;
    const carouselCenterX = (carouselX0 + carouselX1) / 2;

    const infoX0 = carouselX1 + zoneGap;
    const infoW = 340;
    const infoX1 = infoX0 + infoW;

    const moreInfoX0 = infoX1 + zoneGap;
    const moreInfoX1 = contentX1;
    const moreInfoCenterX = (moreInfoX0 + moreInfoX1) / 2;

    const contentTop = 82;
    const contentBottom = 640;
    const stripGap = 24;
    const stripH = (contentBottom - contentTop - stripGap) / 2;

    const craftStripTop = contentTop;
    const craftStripBottom = craftStripTop + stripH;
    const mapStripTop = craftStripBottom + stripGap;

    const craftHeaderY = craftStripTop + 14;
    const craftCardY = craftHeaderY + 104;
    const mapHeaderY = mapStripTop + 14;
    const missionCardY = mapHeaderY + 104;

    const craftX = carouselCenterX;
    const missionX = carouselCenterX;

    const divider = this.add.graphics().setDepth(2).setAlpha(0);
    divider.lineStyle(1, 0x554c39, 0.55);
    divider.lineBetween(contentX0, (craftStripBottom + mapStripTop) / 2, contentX1, (craftStripBottom + mapStripTop) / 2);
    this.tweens.add({ targets: divider, alpha: 1, duration: 500, delay: 180 });

    const craftHeader = this.add
      .text(craftX - 20, craftHeaderY, "AIRFRAME", {
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
      .text(missionX + 20, mapHeaderY, "OPERATION", {
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

    /**
     * Positions/scales/fades a ring member toward its slot for `offset` (0 = centered/focused).
     * `layer` (RING_LAYER.*) keeps frame/art/label in a fixed stacking order within their band —
     * nearer cards' bands always sit fully above farther cards' bands.
     */
    const applyRing = (
      target: Phaser.GameObjects.Text | Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle,
      cx: number,
      cy: number,
      offset: number,
      baseScale: number,
      animate: boolean,
      layer: number,
      alphaOverride?: number
    ) => {
      const ad = Math.min(Math.abs(offset), RING_MAX + 1);
      const ringScale = ad <= RING_MAX ? RING_SCALE[ad] : 0.35;
      const alpha = alphaOverride ?? (ad <= RING_MAX ? RING_ALPHA[ad] : 0);
      const x = cx + offset * RING_SPACING;
      const scale = baseScale * ringScale;
      target.setDepth(ringBand(ad) + layer);
      if (animate) {
        this.tweens.add({ targets: target, x, y: cy, scale, alpha, duration: 280, ease: "Sine.Out" });
      } else {
        target.setPosition(x, cy);
        target.setScale(scale);
        target.setAlpha(alpha);
      }
    };

    const craftW = 148;
    const craftH = 128;
    const craftLabelY = craftCardY + craftH / 2 + 24;
    const craftCards = crafts.map((craft, i) => {
      const frame = this.add
        .rectangle(craftX, craftCardY, craftW, craftH, 0x0c0b09, 0.82)
        .setStrokeStyle(1, 0x5d5544, 0.8)
        .setDepth(2)
        .setInteractive({ useHandCursor: true });
      // Center on the sprite bounds, not the pivot — pivots vary per craft (overlays follow origin).
      const art = this.add.image(craftX, craftCardY, craft.body).setOrigin(0.5, 0.5).setDepth(3);
      // Fit the card box; never upscale past native 1:1 (keeps drones crisp).
      const artScale = craftPreviewFitScale(art.width, art.height, 138, 106);
      art.setScale(artScale);
      const label = this.add
        .text(craftX, craftLabelY, craft.name.toUpperCase(), {
          fontFamily: "Share Tech Mono, monospace",
          fontSize: "11px",
          color: "#cfc7b1",
          align: "center",
        })
        .setOrigin(0.5)
        .setDepth(5);
      // Side tiles step one toward themselves (prev / next), never jump.
      frame.on("pointerdown", () => {
        row = 0;
        const step = Math.sign(ringOffset(i, craftIndex, crafts.length));
        craftIndex = (craftIndex + step + crafts.length) % crafts.length;
        refreshSelection();
      });
      return { frame, art, label, artScale };
    });

    // Same box as the craft card so both carousels (and the field manual's preview) share one aspect ratio.
    const missionW = craftW;
    const missionH = craftH;
    const missionLabelY = missionCardY + missionH / 2 + 24;
    const missionCards = missions.map((mission, i) => {
      const frame = this.add
        .rectangle(missionX, missionCardY, missionW, missionH, 0x0b0a08, 0.88)
        .setStrokeStyle(1, 0x5d5544, 0.8)
        .setDepth(2)
        .setInteractive({ useHandCursor: true });
      // Cover the box (scale up, crop the overflow evenly) — fills it without distorting the square thumbnail.
      const art = this.add.image(missionX, missionCardY, `menu_mission_preview_${mission.kind}`).setDepth(3);
      const boxW = missionW - 4;
      const boxH = missionH - 4;
      const artScale = Math.max(boxW / art.width, boxH / art.height);
      const cropW = boxW / artScale;
      const cropH = boxH / artScale;
      art.setCrop((art.width - cropW) / 2, (art.height - cropH) / 2, cropW, cropH).setScale(artScale);
      const label = this.add
        .text(missionX, missionLabelY, mission.label, {
          fontFamily: "Share Tech Mono, monospace",
          fontSize: "11px",
          color: "#cfc7b1",
          align: "center",
        })
        .setOrigin(0.5)
        .setDepth(5);
      frame.on("pointerdown", () => {
        row = 1;
        const step = Math.sign(ringOffset(i, missionIndex, missions.length));
        missionIndex = (missionIndex + step + missions.length) % missions.length;
        refreshSelection();
      });
      return { frame, art, label, artScale };
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
        .setDepth(12)
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
    carouselArrow(carouselX0 + 16, craftCardY - 8, -1, 0);
    carouselArrow(carouselX1 - 16, craftCardY - 8, 1, 0);
    carouselArrow(carouselX0 + 16, missionCardY, -1, 1);
    carouselArrow(carouselX1 - 16, missionCardY, 1, 1);

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
    const craftDots = carouselDots(crafts.length, carouselCenterX, craftDotsY, 0);
    const missionDots = carouselDots(missions.length, carouselCenterX, missionDotsY, 1);

    // —— Focus overlay: rotors + exhaust glow (shared with the field manual's own preview),
    // rebuilt only for the craft currently centered in the ring. Repositioned every frame so it
    // tracks the card's art image in real time instead of lagging behind its ring-slide tween. ——
    let craftFocusOverlay: CraftPreviewOverlay | null = null;
    const syncCraftFocus = (craft: (typeof crafts)[number]) => {
      craftFocusOverlay?.destroy();
      craftFocusOverlay = buildCraftPreviewOverlay(this, craftCards[craftIndex]!.art, craft);
    };
    this.events.on(Phaser.Scenes.Events.UPDATE, () => craftFocusOverlay?.reposition());

    // —— Craft-strip info zone: FLIGHT PROFILE, a stat per row. ——
    // FIREPOWER uses craftFirepowerRating (ammoScale, boosted by standout burst weapons) rather
    // than raw burst — see its own doc comment for why a pure weapon-burst number misjudged
    // Gunship/Little Bird.
    const statDefs = [
      { label: "SPEED", max: Math.max(...crafts.map((c) => c.maxSpeed)), value: (c: (typeof crafts)[number]) => c.maxSpeed, fmt: (v: number) => Math.round(v).toString() },
      { label: "AGILITY", max: 1, value: (c: (typeof crafts)[number]) => craftAgility(c), fmt: (v: number) => v.toFixed(2) },
      { label: "SIZE", max: Math.max(...crafts.map((c) => c.sizeM)), value: (c: (typeof crafts)[number]) => c.sizeM, fmt: (v: number) => `${Math.round(v)}m` },
      { label: "ARMOR", max: Math.max(...crafts.map((c) => c.health)), value: (c: (typeof crafts)[number]) => c.health, fmt: (v: number) => Math.round(v).toString() },
      {
        label: "FIREPOWER",
        max: Math.max(...crafts.map((c) => craftFirepowerRating(c))),
        value: (c: (typeof crafts)[number]) => craftFirepowerRating(c),
        fmt: (v: number) => v.toFixed(2),
      },
    ];
    // Every bar fills on a three-region scale (see computeThreeRegionScale/threeRegionNorm's doc
    // comments) rather than plain linear-against-max: a handful of outlier craft can't stretch or
    // compress where the typical craft land, since the low/high tails are capped off into the
    // bar's end segments and the "standard" band gets the whole readable middle to itself.
    // Computed once per stat here (needs every craft's value, not just this one).
    // Recomputed whenever the debug +/- keys nudge the shared mad-multiplier (see below).
    const computeStatScales = () => statDefs.map((stat) => computeThreeRegionScale(crafts.map((c) => stat.value(c))));
    let statScales = computeStatScales();
    // Debug-only: +/- nudges the shared three-region mad-multiplier live (see menuChrome's
    // getThreeRegionMadMul doc comment) — refreshSelection redraws using the closed-over
    // `craft`/`row` state it already tracks, same as any other selection-changing key.
    const reapplyStatScales = () => {
      statScales = computeStatScales();
      refreshSelection();
    };
    const bumpThreeRegionMadMul = (delta: number) => {
      // The Field Manual is modal and has its own +/- binding (guarded by its own isOpen) — skip
      // here so an open panel doesn't double-apply the same keypress via both handlers.
      if (fieldManual.isOpen) return;
      adjustThreeRegionMadMul(delta);
      reapplyStatScales();
    };
    this.input.keyboard?.on("keydown-PLUS", () => bumpThreeRegionMadMul(0.25));
    this.input.keyboard?.on("keydown-NUMPAD_ADD", () => bumpThreeRegionMadMul(0.25));
    this.input.keyboard?.on("keydown-MINUS", () => bumpThreeRegionMadMul(-0.25));
    this.input.keyboard?.on("keydown-NUMPAD_SUBTRACT", () => bumpThreeRegionMadMul(-0.25));

    // —— Debug: three-region scale visualization (toggle with /, same as in-game debug menu). ——
    // One horizontal strip per stat, plotting every craft's raw value at its true position
    // between that stat's min and max, with the low/standard/high regions shaded behind them —
    // lets you see at a glance whether the "standard" band (bright) actually covers where the
    // roster bunches up, and whether the currently selected craft (the bright dot) reads sanely.
    const vizPad = 24;
    const vizX0 = vizPad;
    const vizW = w - vizPad * 2;
    const vizRowH = 26;
    const vizY0 = h - vizPad - statDefs.length * vizRowH - 20;
    let vizVisible = false;
    const vizBg = this.add
      .rectangle(vizX0 - 10, vizY0 - 22, vizW + 20, statDefs.length * vizRowH + 34, 0x0a0806, 0.92)
      .setOrigin(0, 0)
      .setStrokeStyle(1, 0x5d5544, 0.8)
      .setDepth(9600)
      .setScrollFactor(0)
      .setVisible(false);
    const vizTitle = this.add
      .text(vizX0, vizY0 - 16, "DEBUG: THREE-REGION SCALE  ( / to toggle, +/- adjusts mad×N )", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "10px",
        color: "#e8b84a",
      })
      .setDepth(9600)
      .setScrollFactor(0)
      .setVisible(false);
    const vizGfx = this.add.graphics().setDepth(9600).setScrollFactor(0).setVisible(false);
    const vizLabels = statDefs.map(() =>
      this.add
        .text(vizX0, 0, "", { fontFamily: "Share Tech Mono, monospace", fontSize: "9px", color: "#aaa28f" })
        .setDepth(9600)
        .setScrollFactor(0)
        .setVisible(false)
    );
    const drawDebugViz = (craft: (typeof crafts)[number]) => {
      if (!vizVisible) return;
      vizGfx.clear();
      statDefs.forEach((stat, i) => {
        const scale = statScales[i]!;
        const y = vizY0 + i * vizRowH;
        const barY = y + 12;
        const barH = 6;
        const span = Math.max(1e-9, scale.max - scale.min);
        const toX = (v: number) => vizX0 + Phaser.Math.Clamp((v - scale.min) / span, 0, 1) * vizW;
        const lowX0 = toX(scale.min);
        const lowX1 = toX(scale.standardMin);
        const stdX1 = toX(scale.standardMax);
        const highX1 = toX(scale.max);
        vizGfx.fillStyle(0x36404a, 0.9).fillRect(lowX0, barY, lowX1 - lowX0, barH);
        vizGfx.fillStyle(0xe8b84a, 0.85).fillRect(lowX1, barY, stdX1 - lowX1, barH);
        vizGfx.fillStyle(0x36404a, 0.9).fillRect(stdX1, barY, highX1 - stdX1, barH);
        const medX = toX(scale.median);
        vizGfx.lineStyle(1, 0xffffff, 0.9).lineBetween(medX, barY - 3, medX, barY + barH + 3);
        crafts.forEach((c) => {
          const v = stat.value(c);
          const selected = c.kind === craft.kind;
          vizGfx.fillStyle(selected ? 0xffffff : 0x12100c, selected ? 1 : 0.65);
          vizGfx.fillCircle(toX(v), barY + barH / 2, selected ? 4 : 2);
          vizGfx.lineStyle(1, selected ? 0xe8b84a : 0x1c1812, selected ? 1 : 0.5);
          vizGfx.strokeCircle(toX(v), barY + barH / 2, selected ? 4 : 2);
        });
        vizLabels[i]!.setPosition(vizX0, y - 4).setText(
          `${stat.label.padEnd(10)} min ${stat.fmt(scale.min)}  std [${stat.fmt(scale.standardMin)} .. ${stat.fmt(scale.standardMax)}]  max ${stat.fmt(scale.max)}  (madMul ${getThreeRegionMadMul().toFixed(2)})`
        );
      });
    };
    const toggleStatScales = () => {
      vizVisible = !vizVisible;
      vizBg.setVisible(vizVisible);
      vizTitle.setVisible(vizVisible);
      vizGfx.setVisible(vizVisible);
      vizLabels.forEach((l) => l.setVisible(vizVisible));
      refreshSelection();
    };
    const debugMenu = new MenuDebugMenu(this, { toggle: toggleStatScales, on: () => vizVisible });
    debugMenu.setup();
    this.input.keyboard?.on("keydown-FORWARD_SLASH", () => {
      if (fieldManual.isOpen) return;
      debugMenu.toggle();
    });

    this.add
      .text(infoX0 + boxPadX, craftHeaderY, "FLIGHT PROFILE", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "9px",
        color: "#aaa28f",
        stroke: "#1c1812",
        strokeThickness: 2,
      })
      .setDepth(3);
    const statsRow0 = craftHeaderY + 28;
    const statRowH = 30;
    const statLabelX = infoX0 + boxPadX;
    const statBarX0 = statLabelX + 62;
    const statBarX1 = infoX1 - boxPadX - 42;
    const statValueX = infoX1 - boxPadX;
    const statValueTexts = statDefs.map((stat, i) => {
      const y = statsRow0 + i * statRowH;
      this.add
        .text(statLabelX, y, stat.label, {
          fontFamily: "Share Tech Mono, monospace",
          fontSize: "10px",
          color: "#d8d0ba",
          stroke: "#1c1812",
          strokeThickness: 2,
        })
        .setOrigin(0, 0.5)
        .setDepth(3);
      return this.add
        .text(statValueX, y, "", {
          fontFamily: "Share Tech Mono, monospace",
          fontSize: "10px",
          color: "#f2d579",
          stroke: "#1c1812",
          strokeThickness: 2,
        })
        .setOrigin(1, 0.5)
        .setDepth(3);
    });
    const roleY = statsRow0 + statDefs.length * statRowH;
    this.add
      .text(statLabelX, roleY, "ROLE", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "10px",
        color: "#d8d0ba",
        stroke: "#1c1812",
        strokeThickness: 2,
      })
      .setOrigin(0, 0.5)
      .setDepth(3);
    const roleTxt = this.add
      .text(statValueX, roleY, "", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "10px",
        color: "#f2d579",
        stroke: "#1c1812",
        strokeThickness: 2,
      })
      .setOrigin(1, 0.5)
      .setDepth(3);
    const statsBottom = roleY + statRowH / 2;
    const statBars = this.add.graphics().setDepth(3);
    const drawStatBars = (craft: (typeof crafts)[number]) => {
      statBars.clear();
      const segments = 10;
      const barW = statBarX1 - statBarX0;
      const segGap = 2;
      const segW = (barW - segGap * (segments - 1)) / segments;
      statDefs.forEach((stat, i) => {
        const y = statsRow0 + i * statRowH;
        statValueTexts[i]!.setText(stat.fmt(stat.value(craft)));
        drawThreeRegionBar(statBars, statBarX0, y, stat.value(craft), statScales[i]!, {
          segW,
          segments,
          segGap,
          stroke: true,
        });
      });
    };

    // —— Craft-strip more-info zone: LOADOUT, one row per weapon + countermeasure. ——
    const maxWeaponSlots = Math.max(4, ...crafts.map((c) => c.sockets.length));
    const loadoutHeaderY = craftHeaderY;
    const loadoutRow0 = loadoutHeaderY + 26;
    const loadoutBottom = loadoutRow0 + (maxWeaponSlots + 1) * 20 + 10;
    // Extra bottom padding reserves room for the MORE INFO button pinned in this corner.
    const panelBottom = Math.max(statsBottom, loadoutBottom) + 42;
    const panelPad = 16;
    const panelBg = this.add
      .rectangle(
        (infoX0 + moreInfoX1) / 2,
        (craftHeaderY - panelPad + panelBottom) / 2,
        moreInfoX1 - infoX0,
        panelBottom - (craftHeaderY - panelPad),
        0x0b0a08,
        0.76
      )
      .setStrokeStyle(1, 0x554c39, 0.65)
      .setDepth(2)
      .setAlpha(0);
    this.tweens.add({ targets: panelBg, alpha: 1, duration: 420, delay: 260, ease: "Sine.Out" });

    // —— Field manual button, pinned to the stats panel's lower-right corner. ——
    const infoBtn = this.add
      .text(moreInfoX1 - 14, panelBottom - 14, "MORE INFO  ›", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "11px",
        color: "#1c1812",
        backgroundColor: "#e8b84a",
        padding: { x: 10, y: 5 },
      })
      .setOrigin(1, 1)
      .setDepth(4)
      .setAlpha(0)
      .setScale(0.9)
      .setInteractive({ useHandCursor: true });
    this.tweens.add({ targets: infoBtn, alpha: 1, scale: 1, duration: 380, delay: 420, ease: "Back.Out" });
    infoBtn.on("pointerover", () => {
      infoBtn.setStyle({ backgroundColor: "#f2d579" });
      this.tweens.add({ targets: infoBtn, scale: 1.06, duration: 120, ease: "Back.Out" });
    });
    infoBtn.on("pointerout", () => {
      infoBtn.setStyle({ backgroundColor: "#e8b84a" });
      this.tweens.add({ targets: infoBtn, scale: 1, duration: 140, ease: "Sine.Out" });
    });
    const fieldManual = new FieldManual(this, {
      craftBrowsable: true,
      onCraftChange: (kind) => {
        const idx = crafts.findIndex((c) => c.kind === kind);
        if (idx < 0) return;
        craftIndex = idx;
        row = 0;
        refreshSelection();
      },
    });
    const openFieldManual = () => fieldManual.toggle(true);
    infoBtn.on("pointerdown", openFieldManual);
    this.input.keyboard?.on("keydown-H", () => {
      if (!debugMenu.open) fieldManual.toggle();
    });
    this.input.keyboard?.on("keydown-ESC", () => {
      if (debugMenu.open) debugMenu.toggle(false);
      else if (fieldManual.isOpen) fieldManual.close();
    });

    const weaponX = moreInfoX0 + boxPadX;
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
      .text(moreInfoX1 - boxPadX, loadoutHeaderY, "AMMO", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "9px",
        color: "#aaa28f",
        stroke: "#1c1812",
        strokeThickness: 2,
      })
      .setOrigin(1, 0)
      .setDepth(3);
    const rowW = moreInfoX1 - boxPadX - weaponX;
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
    const weaponRows = Array.from({ length: maxWeaponSlots }, (_, i) =>
      makeLoadoutRow(loadoutRow0 + i * 20, i % 2 === 1)
    );
    const cmRow = makeLoadoutRow(loadoutRow0 + maxWeaponSlots * 20, maxWeaponSlots % 2 === 1);

    // —— Map-strip info zone: BRIEFING. ——
    this.add
      .text(infoX0, mapHeaderY, "BRIEFING", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "9px",
        color: "#aaa28f",
        stroke: "#1c1812",
        strokeThickness: 2,
      })
      .setDepth(3);
    const detailTxt = this.add
      .text(infoX0, mapHeaderY + 24, "", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "12px",
        color: "#d8d0ba",
        align: "left",
        lineSpacing: 5,
        wordWrap: { width: infoW - 12 },
        stroke: "#1c1812",
        strokeThickness: 3,
      })
      .setOrigin(0, 0)
      .setDepth(2)
      .setAlpha(0);
    this.tweens.add({ targets: detailTxt, alpha: 1, duration: 420, delay: 340, ease: "Sine.Out" });

    // —— Map-strip more-info zone: MISSION PARAMETERS, custom-map controls only — blank otherwise. ——
    const customMission = missions.find((mission) => mission.kind === "custom")!;
    const customProfile = customMission.profile;
    const forceMixes = ["mixed", "naval", "heavy"] as const;
    const forceMixInfo: Record<(typeof forceMixes)[number], string> = {
      mixed: "A balanced mix of armor, air defense, infantry and boats. Changing FORCES resets NAVAL to match.",
      naval: "Boat-heavy: gunboats and coastal defenses dominate. Changing FORCES resets NAVAL to match.",
      heavy: "Armor-heavy: tanks, artillery and fortified positions. Changing FORCES resets NAVAL to match.",
    };
    const customParams = [
      {
        label: "SHAPE",
        group: "THEATER",
        description: (p: typeof customProfile) => MAP_SHAPES.find((m) => m.id === p.shape)?.description ?? "",
        value: (p: typeof customProfile) => MAP_SHAPES.find((m) => m.id === p.shape)?.label ?? p.shape.toUpperCase(),
        adjust: (dir: number) => {
          const i = MAP_SHAPES.findIndex((m) => m.id === customProfile.shape);
          customProfile.shape = MAP_SHAPES[(i + dir + MAP_SHAPES.length) % MAP_SHAPES.length]!.id;
        },
      },
      {
        label: "THEME",
        group: "THEATER",
        description: (p: typeof customProfile) => themeOf(p.theme).description,
        value: (p: typeof customProfile) => themeOf(p.theme).label,
        adjust: (dir: number) => {
          const i = TERRAIN_THEME_IDS.indexOf(customProfile.theme);
          customProfile.theme = TERRAIN_THEME_IDS[(i + dir + TERRAIN_THEME_IDS.length) % TERRAIN_THEME_IDS.length]!;
        },
      },
      {
        label: "WARP",
        group: "THEATER",
        description: "Twists the terrain. 0 keeps smooth rounded hills; higher bends ridges and carves ragged coves and inlets.",
        value: (p: typeof customProfile) => p.warp.toFixed(2),
        adjust: (dir: number) => {
          customProfile.warp = Phaser.Math.Clamp(Math.round((customProfile.warp + dir * 0.25) * 100) / 100, 0, 2);
        },
      },
      {
        label: "CLOUDS",
        group: "THEATER",
        description: "Cloud cover drifting over the battlefield. 0 is clear skies; higher stacks more cloud banks.",
        value: (p: typeof customProfile) => p.clouds.toFixed(1),
        adjust: (dir: number) => {
          customProfile.clouds = Phaser.Math.Clamp(Math.round((customProfile.clouds + dir * 0.2) * 10) / 10, 0, 2);
        },
      },
      ...LANDFORM_KINDS.map((lf) => ({
        label: lf.label,
        group: "LANDFORMS",
        description: lf.description,
        value: (p: typeof customProfile) => String(p.landforms[lf.id]),
        adjust: (dir: number) => {
          customProfile.landforms = {
            ...customProfile.landforms,
            [lf.id]: Phaser.Math.Clamp(customProfile.landforms[lf.id] + dir, 0, lf.max),
          };
        },
      })),
      {
        label: "LAND",
        group: "WORLD",
        description: "How much of the map is land. Higher raises the ground out of the sea; lower floods it with open water.",
        value: (p: typeof customProfile) => p.landBias.toFixed(2),
        adjust: (dir: number) => {
          customProfile.landBias = Phaser.Math.Clamp(customProfile.landBias + dir * 0.025, -0.2, 0.18);
        },
      },
      {
        label: "RELIEF",
        group: "WORLD",
        description: "Elevation contrast. Higher makes taller peaks and deeper valleys; lower flattens toward rolling grassland.",
        value: (p: typeof customProfile) => p.relief.toFixed(2),
        adjust: (dir: number) => {
          customProfile.relief = Phaser.Math.Clamp(customProfile.relief + dir * 0.1, 0.7, 1.6);
        },
      },
      {
        label: "COAST",
        group: "WORLD",
        description: "How hard the map edges drop into the sea. Higher rings the battlefield with water, like one large island.",
        value: (p: typeof customProfile) => p.edgeFalloff.toFixed(2),
        adjust: (dir: number) => {
          customProfile.edgeFalloff = Phaser.Math.Clamp(customProfile.edgeFalloff + dir * 0.05, 0.05, 0.55);
        },
      },
      {
        label: "RIVERS",
        group: "WORLD",
        description: "Stream network density: how much of the land drains into visible streams, rivers and lakes.",
        value: (p: typeof customProfile) => String(p.riverTarget),
        adjust: (dir: number) => {
          customProfile.riverTarget = Phaser.Math.Clamp(customProfile.riverTarget + dir * 4, 0, 72);
        },
      },
      {
        label: "MAIN RIVER",
        group: "WORLD",
        description: "Major rivers that wind from the high ground to the sea in their own wide valley, fed by tributaries.",
        value: (p: typeof customProfile) => String(p.mainRivers),
        adjust: (dir: number) => {
          customProfile.mainRivers = Phaser.Math.Clamp(customProfile.mainRivers + dir, 0, 2);
        },
      },
      {
        label: "ROADS",
        group: "WORLD",
        description: "Road network density. 0 is no roads; higher runs spur roads out to more distant lookouts and towers.",
        value: (p: typeof customProfile) => p.roadDensity.toFixed(2),
        adjust: (dir: number) => {
          customProfile.roadDensity = Phaser.Math.Clamp(Math.round((customProfile.roadDensity + dir * 0.25) * 100) / 100, 0, 2);
        },
      },
      {
        label: "SETTLEMENT",
        group: "WORLD",
        description: "Towns, plus a port, airfield and dam where the terrain suits. 0 is wilderness; higher builds up more.",
        value: (p: typeof customProfile) => p.settlement.toFixed(2),
        adjust: (dir: number) => {
          customProfile.settlement = Phaser.Math.Clamp(Math.round((customProfile.settlement + dir * 0.25) * 100) / 100, 0, 2);
        },
      },
      {
        label: "WATER SITES",
        group: "WORLD",
        description: "Ports, dams and offshore oil fields where the water suits. OFF keeps every settlement on dry land.",
        value: (p: typeof customProfile) => (p.waterSites ? "ON" : "OFF"),
        adjust: () => {
          customProfile.waterSites = !customProfile.waterSites;
        },
      },
      {
        label: "OBJECTIVES",
        group: "FORCES",
        description: "Number of high-value targets you must destroy to win.",
        value: (p: typeof customProfile) => String(p.objectiveCount),
        adjust: (dir: number) => {
          customProfile.objectiveCount = Phaser.Math.Clamp(customProfile.objectiveCount + dir, 2, 7);
        },
      },
      {
        label: "SITING",
        group: "FORCES",
        description: (p: typeof customProfile) => OBJECTIVE_SITINGS.find((o) => o.id === p.siting)?.description ?? "",
        value: (p: typeof customProfile) => OBJECTIVE_SITINGS.find((o) => o.id === p.siting)?.label ?? p.siting.toUpperCase(),
        adjust: (dir: number) => {
          const i = OBJECTIVE_SITINGS.findIndex((o) => o.id === customProfile.siting);
          customProfile.siting = OBJECTIVE_SITINGS[(i + dir + OBJECTIVE_SITINGS.length) % OBJECTIVE_SITINGS.length]!.id;
        },
      },
      {
        label: "GARRISON",
        group: "FORCES",
        description: "Size of the defending force posted around each objective.",
        value: (p: typeof customProfile) => p.garrisonScale.toFixed(1),
        adjust: (dir: number) => {
          customProfile.garrisonScale = Phaser.Math.Clamp(customProfile.garrisonScale + dir * 0.1, 0.4, 1.8);
        },
      },
      {
        label: "PATROLS",
        group: "FORCES",
        description: "How many roaming patrol groups are scattered across the map.",
        value: (p: typeof customProfile) => String(p.patrolCount),
        adjust: (dir: number) => {
          customProfile.patrolCount = Phaser.Math.Clamp(customProfile.patrolCount + dir * 2, 8, 40);
        },
      },
      {
        label: "NAVAL",
        group: "FORCES",
        description: "Weights patrols toward the water: higher spawns more boats and fewer land patrols. 0 is no boats.",
        value: (p: typeof customProfile) => p.waterPatrolBias.toFixed(2),
        adjust: (dir: number) => {
          customProfile.waterPatrolBias = Phaser.Math.Clamp(customProfile.waterPatrolBias + dir * 0.25, 0, 3);
        },
      },
      {
        label: "FORCES",
        group: "FORCES",
        description: (p: typeof customProfile) => forceMixInfo[p.forceMix],
        value: (p: typeof customProfile) => p.forceMix.toUpperCase(),
        adjust: (dir: number) => {
          const i = forceMixes.indexOf(customProfile.forceMix);
          customProfile.forceMix = forceMixes[(i + dir + forceMixes.length) % forceMixes.length]!;
          customProfile.waterPatrolBias =
            customProfile.forceMix === "naval" ? 2.4 : customProfile.forceMix === "heavy" ? 0.35 : 1;
        },
      },
    ];
    const customParamsHeader = this.add
      .text(moreInfoX0, mapHeaderY, "MISSION PARAMETERS", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "9px",
        color: "#aaa28f",
        stroke: "#1c1812",
        strokeThickness: 2,
      })
      .setDepth(3);
    // Presets only: start a CUSTOM map from this preset's params.
    const customizeBtn = this.add
      .text(moreInfoX1, mapHeaderY + 6, "CUSTOMIZE  ›", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "10px",
        color: "#1c1812",
        backgroundColor: "#e8b84a",
        padding: { x: 8, y: 3 },
      })
      .setOrigin(1, 0.5)
      .setDepth(4)
      .setInteractive({ useHandCursor: true });
    customizeBtn.on("pointerover", () => {
      customizeBtn.setStyle({ backgroundColor: "#f2d579" });
      this.tweens.add({ targets: customizeBtn, scale: 1.06, duration: 120, ease: "Back.Out" });
    });
    customizeBtn.on("pointerout", () => {
      customizeBtn.setStyle({ backgroundColor: "#e8b84a" });
      this.tweens.add({ targets: customizeBtn, scale: 1, duration: 140, ease: "Sine.Out" });
    });
    customizeBtn.on("pointerdown", () => customizePreset());
    // Custom map only (same slot as CUSTOMIZE): roll every parameter.
    const randomizeBtn = this.add
      .text(moreInfoX1, mapHeaderY + 6, "RANDOMIZE  ›", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "10px",
        color: "#1c1812",
        backgroundColor: "#e8b84a",
        padding: { x: 8, y: 3 },
      })
      .setOrigin(1, 0.5)
      .setDepth(4)
      .setVisible(false)
      .setInteractive({ useHandCursor: true });
    randomizeBtn.on("pointerover", () => {
      randomizeBtn.setStyle({ backgroundColor: "#f2d579" });
      this.tweens.add({ targets: randomizeBtn, scale: 1.06, duration: 120, ease: "Back.Out" });
    });
    randomizeBtn.on("pointerout", () => {
      randomizeBtn.setStyle({ backgroundColor: "#e8b84a" });
      this.tweens.add({ targets: randomizeBtn, scale: 1, duration: 140, ease: "Sine.Out" });
    });
    randomizeBtn.on("pointerdown", () => randomizeCustom());
    // Steps back through RANDOMIZE rolls; history clears when leaving the custom map.
    const randomBackBtn = this.add
      .text(moreInfoX1 - randomizeBtn.width - 6, mapHeaderY + 6, "‹  BACK", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "10px",
        color: "#1c1812",
        backgroundColor: "#e8b84a",
        padding: { x: 8, y: 3 },
      })
      .setOrigin(1, 0.5)
      .setDepth(4)
      .setVisible(false)
      .setInteractive({ useHandCursor: true });
    randomBackBtn.on("pointerover", () => {
      randomBackBtn.setStyle({ backgroundColor: "#f2d579" });
      this.tweens.add({ targets: randomBackBtn, scale: 1.06, duration: 120, ease: "Back.Out" });
    });
    randomBackBtn.on("pointerout", () => {
      randomBackBtn.setStyle({ backgroundColor: "#e8b84a" });
      this.tweens.add({ targets: randomBackBtn, scale: 1, duration: 140, ease: "Sine.Out" });
    });
    randomBackBtn.on("pointerdown", () => undoRandomize());
    // Rigs share keys (roster rig uses C); only customize from the bare menu.
    this.input.keyboard?.on("keydown-C", () => {
      if (!fieldManual.isOpen && !rigsAnyOpen(this)) customizePreset();
    });
    // Grouped grid: a small sub-header per group, two columns of cards under it.
    const customParamCol = 85;
    const PARAM_ROW = 23;
    const groupLabel = (text: string, y: number, x: number) =>
      this.add
        .text(x, y, text, {
          fontFamily: "Share Tech Mono, monospace",
          fontSize: "9px",
          color: "#7f7766",
          stroke: "#1c1812",
          strokeThickness: 2,
        })
        .setOrigin(0, 0.5)
        .setDepth(3);
    // THEATER sits under the briefing; WORLD + FORCES stack in the more-info zone.
    const paramGroups = [
      { id: "THEATER", x0: infoX0, cx: infoX0 + infoW / 2 - 6 },
      { id: "LANDFORMS", x0: infoX0, cx: infoX0 + infoW / 2 - 6 },
      { id: "WORLD", x0: moreInfoX0, cx: moreInfoCenterX },
      { id: "FORCES", x0: moreInfoX0, cx: moreInfoCenterX },
    ] as const;
    const groupHeaders: Phaser.GameObjects.Text[] = [];
    const cardPos: { x: number; y: number }[] = [];
    let gy = mapHeaderY + 24;
    let iy = mapHeaderY + 92;
    for (const group of paramGroups) {
      const info = group.x0 === infoX0;
      let y = info ? iy : gy;
      groupHeaders.push(groupLabel(group.id, y, group.x0));
      const members = customParams.map((p, i) => ({ p, i })).filter(({ p }) => p.group === group.id);
      members.forEach(({ i }, k) => {
        const col = k % 2;
        const line = (k / 2) | 0;
        cardPos[i] = { x: group.cx + (col === 0 ? -customParamCol : customParamCol), y: y + 18 + line * PARAM_ROW };
      });
      y += 18 + Math.ceil(members.length / 2) * PARAM_ROW + 6;
      if (info) iy = y;
      else gy = y;
    }
    let hoverParam = -1;
    const customParamCards = customParams.map((param, i) => {
      const { x, y } = cardPos[i]!;
      const frame = this.add.rectangle(x, y, 158, 21, 0x0b0a08, 0.86).setDepth(2);
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
      // Hover shows the description; clicking selects (custom) or pins the description (presets).
      frame.setInteractive({ useHandCursor: true });
      frame.on("pointerover", () => {
        hoverParam = i;
        syncCustomParams();
      });
      frame.on("pointerout", () => {
        if (hoverParam === i) hoverParam = -1;
        syncCustomParams();
      });
      frame.on("pointerdown", () => {
        if (missions[missionIndex]!.kind === "custom") row = 3 + i;
        hoverParam = i;
        refreshSelection();
      });
      value.setText(`${param.label}  ${param.value(customProfile)}`);
      return { frame, minus, value, plus };
    });

    const customParamDesc = this.add
      .text(moreInfoX0, gy - 2, "", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "10px",
        color: "#aaa28f",
        align: "left",
        lineSpacing: 3,
        wordWrap: { width: moreInfoX1 - moreInfoX0 },
      })
      .setOrigin(0, 0)
      .setDepth(3);

    function syncCustomParams(): void {
      const mission = missions[missionIndex]!;
      const editable = mission.kind === "custom";
      const focused = editable ? row - 3 : -1;
      customParamsHeader.setVisible(true);
      customizeBtn.setVisible(!editable);
      randomizeBtn.setVisible(editable);
      randomBackBtn.setVisible(editable && randomHistory.length > 0);
      for (const h of groupHeaders) h.setVisible(true);
      customParamCards.forEach((card, i) => {
        const isFocused = i === focused;
        card.frame.setVisible(true).setStrokeStyle(isFocused ? 2 : 1, isFocused ? 0xe8b84a : 0x554c39, 0.9);
        card.minus.setVisible(editable);
        card.plus.setVisible(editable);
        card.value
          .setVisible(true)
          .setText(`${customParams[i]!.label}  ${customParams[i]!.value(mission.profile)}`)
          .setColor(editable ? "#d8d0ba" : "#aaa28f");
      });
      const shown = customParams[hoverParam >= 0 ? hoverParam : focused];
      const desc = shown ? (typeof shown.description === "function" ? shown.description(mission.profile) : shown.description) : "";
      customParamDesc.setVisible(!!shown).setText(desc);
    }

    function redrawCustomPreview(): void {
      const key = "menu_mission_preview_custom";
      const customIndex = missions.findIndex((mission) => mission.kind === "custom");
      if (customIndex >= 0) missionCards[customIndex]!.art.setTexture("menu_mission_preview_river_run");
      if (thisScene.textures.exists(key)) thisScene.textures.remove(key);
      ensureMissionPreviews(thisScene.textures);
      if (customIndex >= 0) missionCards[customIndex]!.art.setTexture(key);
    }

    function adjustCustomParam(i: number, dir: number): void {
      row = 3 + i;
      customParams[i]!.adjust(dir);
      redrawCustomPreview();
      refreshSelection();
    }

    /**
     * Random value for one param, using only its `adjust`/`value`: walk to the low end (or around, if it cycles),
     * record each distinct value stepping up, then land on a random one.
     */
    function randomizeParam(p: (typeof customParams)[number]): void {
      const read = () => p.value(customProfile);
      for (let k = 0; k < 64; k++) {
        const before = read();
        p.adjust(-1);
        if (read() === before) break;
      }
      const seen = [read()];
      for (let k = 0; k < 64; k++) {
        p.adjust(1);
        const v = read();
        if (v === seen[seen.length - 1] || v === seen[0]) break;
        seen.push(v);
      }
      for (let k = 0; k < 64 && read() !== seen[0]; k++) p.adjust(-1);
      const steps = Math.floor(Math.random() * seen.length);
      for (let k = 0; k < steps; k++) p.adjust(1);
    }

    /** Custom profiles from before each RANDOMIZE, newest last. */
    const randomHistory: (typeof customProfile)[] = [];
    const snapshotCustom = (): typeof customProfile => ({ ...customProfile, landforms: { ...customProfile.landforms } });

    function undoRandomize(): void {
      const prev = randomHistory.pop();
      if (!prev || missions[missionIndex]!.kind !== "custom") return;
      Object.assign(customProfile, prev);
      redrawCustomPreview();
      refreshSelection();
    }

    /** Roll every custom parameter (FORCES first: it resets NAVAL). */
    function randomizeCustom(): void {
      if (missions[missionIndex]!.kind !== "custom") return;
      randomHistory.push(snapshotCustom());
      const ordered = [...customParams].sort((a, b) => Number(b.label === "FORCES") - Number(a.label === "FORCES"));
      for (const p of ordered) randomizeParam(p);
      redrawCustomPreview();
      refreshSelection();
    }

    /** Copy the selected preset's profile into CUSTOM and switch to it. */
    function customizePreset(): void {
      const preset = missions[missionIndex]!;
      if (preset.kind === "custom") return;
      Object.assign(customProfile, { ...preset.profile, landforms: { ...preset.profile.landforms }, id: customProfile.id });
      missionIndex = missions.findIndex((mission) => mission.kind === "custom");
      row = 1;
      redrawCustomPreview();
      refreshSelection();
    }

    const thisScene = this;
    let firstSync = true;
    let lastCraftIndex = -1;
    const refreshSelection = () => {
      const animate = !firstSync;
      const craft = crafts[craftIndex]!;
      const mission = missions[missionIndex]!;
      if (row >= 3 && mission.kind !== "custom") row = 1;
      if (mission.kind !== "custom") randomHistory.length = 0;
      selectCraft(craft.kind);
      selectMission(mission.kind);
      craftHeader.setColor(row === 0 ? "#e8b84a" : "#8f8774");
      missionHeader.setColor(row === 1 ? "#e8b84a" : "#8f8774");
      const helpFocused = row === 2;
      panelBg.setStrokeStyle(helpFocused ? 2 : 1, helpFocused ? 0xe8b84a : 0x554c39, helpFocused ? 1 : 0.65);
      infoBtn.setStyle({ backgroundColor: helpFocused ? "#f2d579" : "#e8b84a" }).setScale(helpFocused ? 1.06 : 1);

      craftCards.forEach((card, i) => {
        const offset = ringOffset(i, craftIndex, crafts.length);
        const focused = offset === 0;
        applyRing(card.frame, craftX, craftCardY, offset, 1, animate, RING_LAYER.frame);
        applyRing(card.art, craftX, craftCardY, offset, card.artScale, animate, RING_LAYER.art);
        applyRing(card.label, craftX, craftLabelY, offset, 1, animate, RING_LAYER.label, focused ? 1 : 0);
        card.frame
          .setFillStyle(0x0c0b09, focused ? 1 : 0.7)
          .setStrokeStyle(focused && row === 0 ? 3 : 1, focused ? 0xe8b84a : 0x5d5544, focused ? 1 : 0.8);
      });
      craftDots.forEach((dot, i) =>
        dot
          .setFillStyle(i === craftIndex ? 0xe8b84a : 0x5d5544, i === craftIndex ? 1 : 0.9)
          .setScale(i === craftIndex ? 1.45 : 1)
      );
      if (craftIndex !== lastCraftIndex) {
        lastCraftIndex = craftIndex;
        syncCraftFocus(craft);
      }

      missionCards.forEach((card, i) => {
        const offset = ringOffset(i, missionIndex, missions.length);
        const focused = offset === 0;
        applyRing(card.frame, missionX, missionCardY, offset, 1, animate, RING_LAYER.frame);
        applyRing(card.art, missionX, missionCardY, offset, card.artScale, animate, RING_LAYER.art);
        applyRing(card.label, missionX, missionLabelY, offset, 1, animate, RING_LAYER.label, focused ? 1 : 0);
        card.frame
          .setFillStyle(0x0b0a08, focused ? 1 : 0.75)
          .setStrokeStyle(focused && row === 1 ? 3 : 1, focused ? 0xe8b84a : 0x5d5544, focused ? 1 : 0.8);
        if (focused) applyEdgeLight(card.art, 0, 0.35);
        else clearEdgeLight(card.art);
      });
      missionDots.forEach((dot, i) =>
        dot
          .setFillStyle(i === missionIndex ? 0xe8b84a : 0x5d5544, i === missionIndex ? 1 : 0.9)
          .setScale(i === missionIndex ? 1.45 : 1)
      );

      const weapons = playerLoadoutFromSockets(craft.sockets);
      drawStatBars(craft);
      drawDebugViz(craft);
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
        // Launches a remote craft rather than firing a shot — flag it right on the name.
        const isRemote = !!weapon.payload.remote;
        row.name.setText(isRemote ? `▸ ${parts.base}` : parts.base).setColor(isRemote ? "#f2c94e" : "#d8d0ba");
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
      cmRow.slot.setVisible(true).setPosition(weaponX + 7, cmY).setText("F").setColor("#7ad0ff");
      cmRow.name.setVisible(true).setPosition(weaponX + 23, cmY).setText(cm.name).setColor("#c8d4e8");
      cmRow.crew.setVisible(false).setText("");
      cmRow.ammo.setVisible(true).setPosition(weaponX + rowW, cmY).setText(countermeasureTimingLabel(cm)).setColor("#8ec8e8");
      detailTxt.setText(mission.briefing);
      syncCustomParams();
      firstSync = false;
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
    // While the field manual modal is open, it owns all of these — the menu underneath freezes.
    const activate = () => {
      if (debugMenu.open) {
        debugMenu.activate();
        return;
      }
      if (fieldManual.isOpen) {
        fieldManual.activateFocus();
        return;
      }
      if (row === 2) openFieldManual();
      else deploy();
    };
    this.input.keyboard?.on("keydown-ENTER", activate);
    this.input.keyboard?.on("keydown-SPACE", activate);

    const selectUp = () => {
      if (debugMenu.open) {
        debugMenu.nudge(-1);
        return;
      }
      if (fieldManual.isOpen) {
        fieldManual.nudgeFocus(-1);
        return;
      }
      const n = focusStopCount();
      row = (row - 1 + n) % n;
      refreshSelection();
    };
    const selectDown = () => {
      if (debugMenu.open) {
        debugMenu.nudge(1);
        return;
      }
      if (fieldManual.isOpen) {
        fieldManual.nudgeFocus(1);
        return;
      }
      const n = focusStopCount();
      row = (row + 1) % n;
      refreshSelection();
    };
    const selectLeft = () => (debugMenu.open ? undefined : fieldManual.isOpen ? fieldManual.nudgeTip(-1) : cycleSelection(-1));
    const selectRight = () => (debugMenu.open ? undefined : fieldManual.isOpen ? fieldManual.nudgeTip(1) : cycleSelection(1));
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
