import Phaser from "phaser";
import { formatDuration } from "../util/format";
import { MISSIONS, type MissionKind } from "../sim/mission";
import {
  COUNTERMEASURES,
  PLAYER_WPNS,
  SHOT_ORIGIN,
  craftCountermeasure,
  countermeasureTimingLabel,
  playerLoadoutFromSockets,
  playerWeaponClassMul,
  playerWeaponDps,
  weaponMountTex,
  wpnIdOf,
  wpnOf,
  type CountermeasureId,
  type CountermeasureSpec,
  type ExhaustTrail,
  type PlayerWpnSpec,
  type UnitClass,
  type WpnId,
} from "../sim/combat";
import {
  allCrafts,
  craftAgility,
  craftComposite,
  craftGunScale,
  craftGunSocketSlots,
  craftGunTex,
  craftSocketFireStreams,
  craftLoadoutParts,
  craftOf,
  craftPreviewFitScale,
  craftSocketPoints,
  craftSocketStartingAmmo,
  type CraftKind,
  type CraftSpec,
} from "../sim/crafts";
import {
  cmDescription,
  tipKnownFromSelection,
  orderByLeastShown,
  tipsForKnown,
  tipsForWeapon,
  tipText,
  wpnGuidedFamily,
  wpnIsAntiAir,
  wpnIsAntiArmor,
  wpnIsAntiSoft,
  wpnIsBombDrop,
  wpnIsRemoteDeploy,
  wpnPierces,
  type TacticalTip,
  type TipKnown,
} from "../sim/tips";
import { ensureImpactGlow, spritePivot, spriteUvPos } from "../art/sprites";
import { CLOAK_PREVIEW_PIPELINE, ensureCloakPreviewPipeline } from "../render/cloakPreviewFx";
import { WARP_PREVIEW_PIPELINE, ensureWarpPreviewPipeline } from "../render/warpPreviewFx";
import { lookupSpriteMuzzles } from "../art/spriteOrigin";
import {
  adjustThreeRegionMadMul,
  computeThreeRegionScale,
  createControlLegend,
  drawThreeRegionBar,
} from "./menuChrome";
import { buildCraftPreviewOverlay, type CraftPreviewOverlay } from "./craftPreview";
import {
  craftFirepowerRating,
  craftFirepowerWithRemotes,
  remoteSpecOf,
  type RemoteKind,
  type RemoteSpec,
} from "../sim/remote";
import { drawIcon, type IconName } from "../render/icons";
import { careerOf, isHostileEnemy, missionObjectives, ratio, total, type Career, type MissionOutcome } from "../sim/stats";
import { markTipShown, tipShownCounts } from "../persist/tipHistory";
import { lifetimeStats, missionHistory } from "../persist/statsStore";
import type { UnitKind } from "../sim/roster";

export interface FieldManualOptions {
  /** Live enemies for tip context (mission only — omit in the menu). */
  getEnemies?: () => readonly UnitKind[] | undefined;
  /** Fires whenever the panel opens or closes. */
  onToggle?: (open: boolean) => void;
  /** Render depth for the whole panel. Defaults high enough to sit above normal HUD chrome. */
  depth?: number;
  /** Menu only: shows ‹ › buttons beside the preview to browse the roster without leaving the panel. */
  craftBrowsable?: boolean;
  /** Menu only: fires as the ‹ › buttons cycle craft, so the menu's own selection follows along. */
  onCraftChange?: (kind: CraftKind) => void;
}

const MONO = "Share Tech Mono, monospace";
const AMBER = "#e8b84a";
const AMBER_N = 0xe8b84a;
const RECENT_MISSIONS_SHOWN = 5;
const FAVORITE_WEAPON = "FAVORITE WEAPON";
/** Recent-mission row accent + icon per outcome. */
const OUTCOME_STYLE: Record<MissionOutcome, { color: number; icon: IconName }> = {
  succeeded: { color: 0x6dcc5a, icon: "check" },
  failed: { color: 0xc8664a, icon: "cross" },
  abandoned: { color: 0x8a8470, icon: "dash" },
};
const CREAM = "#d8d0ba";
const BRIGHT = "#f0e6c8";
const DIM = "#8a8470";
const DIM_N = 0x4a4436;
/** Loadout row name color for weapons that launch a remote craft instead of firing a shot. */
const REMOTE_LABEL = "#f2c94e";

const UNIT_CLASSES: readonly UnitClass[] = ["air", "vehicle", "building", "troop"];
const CLASS_COLOR: Record<UnitClass, number> = { air: 0x5ec8ff, vehicle: 0xe8b84a, building: 0xb0a890, troop: 0xd878ff };
const CLASS_LABEL: Record<UnitClass, string> = { air: "AIR", vehicle: "VEHICLE", building: "BUILDING", troop: "TROOP" };

/** What the right-hand detail pane is currently showing. */
type Focus =
  | { kind: "preview" }
  | { kind: "stats" }
  | { kind: "weapon"; slot: number }
  | { kind: "cm" }
  | { kind: "close" };

function focusEq(a: Focus, b: Focus): boolean {
  return a.kind === b.kind && (a.kind !== "weapon" || b.kind !== "weapon" || a.slot === b.slot);
}

/** A colored, icon-led tag in a career pill list. */
/** Tag chip colors: outline, fill, label text, icon ink. */
interface TagStyle {
  stroke: number;
  fill: number;
  text: string;
  ink: number;
}

const TAG_BLUE: TagStyle = { stroke: 0x4a7a94, fill: 0x16222c, text: "#a8d8f0", ink: 0xa8d8f0 };
const TAG_GOLD: TagStyle = { stroke: 0x9a7a2e, fill: 0x2a2210, text: "#e8b84a", ink: 0xe8b84a };

/** An icon-led tag in a career list. */
interface Pill {
  text: string;
  style: TagStyle;
  icon: IconName;
}

/** Special kill stats shown as career pills (only when non-zero). */
const STAT_PILLS: { label: string; stat: "rotorKills" | "roadKills" | "stunnedKills" | "blindedKills"; style: TagStyle; icon: IconName }[] = [
  { label: "ROTOR KILLS", stat: "rotorKills", style: { stroke: 0x9a3e30, fill: 0x2a1410, text: "#f29482", ink: 0xe0503c }, icon: "rotor" },
  { label: "ROAD KILLS", stat: "roadKills", style: { stroke: 0x9a6a30, fill: 0x2a1d10, text: "#e8b47a", ink: 0xd08a3a }, icon: "tire" },
  { label: "STUNNED KILLS", stat: "stunnedKills", style: { stroke: 0x3e7aa0, fill: 0x12222e, text: "#a8e0ff", ink: 0x5ac8ff }, icon: "bolt" },
  { label: "BLINDED KILLS", stat: "blindedKills", style: { stroke: 0x6e6a60, fill: 0x1e1d1a, text: "#d4cebf", ink: 0xa8a294 }, icon: "blind" },
];

/** Truncate a text object with an ellipsis until it fits `maxW`. */
function fitText(t: Phaser.GameObjects.Text, maxW: number): void {
  if (t.width <= maxW) return;
  let s = t.text;
  while (s.length > 1 && t.width > maxW) {
    s = s.slice(0, -1);
    t.setText(`${s.trimEnd()}…`);
  }
}

/** Shared craft/weapon reference UI — the in-mission help panel and the main menu's field manual. */
export class FieldManual {
  readonly root: Phaser.GameObjects.Container;
  private _open = false;
  get isOpen(): boolean {
    return this._open;
  }

  private focus: Focus = { kind: "preview" };
  /** Tip last counted as shown (so redraws of the same tip don't recount). */
  private lastShownTipId: string | undefined;
  private careerCache: { missions: number; career: Career } | undefined;

  /** The craft currently shown — usually craftOf(), but browsable away from it in menu context. */
  private previewCraft: CraftSpec & { kind: CraftKind } = craftOf();
  private previewIndex = Math.max(0, allCrafts().findIndex((c) => c.kind === this.previewCraft.kind));

  private tipPage = 0;
  private missionTips: TacticalTip[] = [];
  private missionTipsKnown: TipKnown = {};

  private weaponTipPage = 0;
  private weaponTips: TacticalTip[] = [];
  private weaponTipsKnown: TipKnown = {};

  private readonly panelW: number;
  private readonly panelH: number;
  private readonly halfW: number;
  private readonly halfH: number;
  private readonly dividerX: number;
  /** Fallback tip-block offset used when a focus panel's content is shorter than this. */
  private static readonly DETAIL_MIN_H = 250;

  private closeBtn!: Phaser.GameObjects.Text;

  // —— Left column: preview ——
  private craftName!: Phaser.GameObjects.Text;
  private craftBody!: Phaser.GameObjects.Image;
  private craftOverlay: CraftPreviewOverlay | null = null;
  private craftRemoteInlays: (Phaser.GameObjects.Rectangle | Phaser.GameObjects.Image)[] = [];
  private prevCraftBtn?: Phaser.GameObjects.Text;
  private nextCraftBtn?: Phaser.GameObjects.Text;
  private previewBg!: Phaser.GameObjects.Rectangle;
  private previewFrame!: Phaser.GameObjects.Graphics;
  private previewHit!: Phaser.GameObjects.Rectangle;
  /** Marks the focused weapon's socket mount point(s) on the preview craft — redrawn per focus. */
  private socketIndicator!: Phaser.GameObjects.Graphics;
  private readonly previewBox: { x: number; y: number; w: number; h: number };

  // —— Left column: description + stats ——
  private craftDesc!: Phaser.GameObjects.Text;
  private craftStatBars!: Phaser.GameObjects.Graphics;
  private craftStatLabels: Phaser.GameObjects.Text[] = [];
  private craftRoleLabel!: Phaser.GameObjects.Text;
  private craftRoleValue!: Phaser.GameObjects.Text;
  private statsFrame!: Phaser.GameObjects.Graphics;
  private statsHit!: Phaser.GameObjects.Rectangle;
  private statsBoxCache = { x: 0, y: 0, w: 0, h: 0 };
  private readonly statRowH = 15;

  // —— Left column: loadout ——
  private loadoutRows: {
    frame: Phaser.GameObjects.Rectangle;
    slot: Phaser.GameObjects.Text;
    name: Phaser.GameObjects.Text;
    crew: Phaser.GameObjects.Text;
    ammo: Phaser.GameObjects.Text;
  }[] = [];
  private cmRow!: { frame: Phaser.GameObjects.Rectangle; slot: Phaser.GameObjects.Text; name: Phaser.GameObjects.Text; ammo: Phaser.GameObjects.Text };
  private readonly loadoutRowH = 17;

  // —— Right column: focus detail (rebuilt on every focus change) ——
  private detailHeader!: Phaser.GameObjects.Text;
  private detailDynamic: Phaser.GameObjects.GameObject[] = [];
  private readonly rightX0: number;
  private readonly rightW: number;
  private readonly detailY0: number;

  // —— Right column: tips (persistent, position fixed) ——
  private tipHDivider!: Phaser.GameObjects.Graphics;
  private tipHeader!: Phaser.GameObjects.Text;
  private tipBody!: Phaser.GameObjects.Text;
  private tipPrev!: Phaser.GameObjects.Text;
  private tipNext!: Phaser.GameObjects.Text;
  private tipCounter!: Phaser.GameObjects.Text;

  private controlsLegend: Phaser.GameObjects.GameObject[] = [];
  private controlsScheme: string | undefined;

  constructor(private scene: Phaser.Scene, private opts: FieldManualOptions = {}) {
    const w = scene.scale.width;
    const h = scene.scale.height;
    this.panelW = Math.min(1000, w - 40);
    this.panelH = Math.min(620, h - 30);
    this.halfW = this.panelW / 2;
    this.halfH = this.panelH / 2;
    this.dividerX = -this.halfW + this.panelW * 0.44;
    this.rightX0 = this.dividerX + 22;
    this.rightW = this.halfW - this.rightX0 - 16;
    this.detailY0 = -this.halfH + 54;
    // Same 148:128 aspect ratio as the main menu's craft/map cards, just a little larger.
    this.previewBox = { x: this.leftX(), y: -this.halfH + 135, w: 163, h: 141 };

    // Backdrop as four margin bars around the panel (not one full-screen rect) so it never
    // overlaps the panel's interactive children and can't win hit-test ties against them.
    const marginY = (h - this.panelH) / 2;
    const marginX = (w - this.panelW) / 2;
    const shadeColor = 0x080705;
    const shadeAlpha = 0.78;
    const shadeBars = [
      scene.add.rectangle(0, -h / 2 + marginY / 2, w, marginY, shadeColor, shadeAlpha),
      scene.add.rectangle(0, h / 2 - marginY / 2, w, marginY, shadeColor, shadeAlpha),
      scene.add.rectangle(-w / 2 + marginX / 2, 0, marginX, this.panelH, shadeColor, shadeAlpha),
      scene.add.rectangle(w / 2 - marginX / 2, 0, marginX, this.panelH, shadeColor, shadeAlpha),
    ].map((bar) => bar.setInteractive());
    // Interactive (with no handler) purely to absorb clicks that land on empty panel space —
    // without this, a click that misses every real control falls through to whatever's behind
    // the modal (menu cards, HUD), since drawing over something doesn't block its input.
    const panel = scene.add
      .rectangle(0, 0, this.panelW, this.panelH, 0x12100c, 0.98)
      .setStrokeStyle(2, 0xe8b84a, 0.9)
      .setInteractive();
    const title = scene.add
      .text(0, -this.halfH + 26, "FIELD MANUAL", {
        fontFamily: "Black Ops One, Impact, sans-serif",
        fontSize: "24px",
        color: AMBER,
      })
      .setOrigin(0.5);
    const closeHint = scene.add
      .text(0, this.halfH - 16, "H / ESC  CLOSE", {
        fontFamily: MONO,
        fontSize: "12px",
        color: DIM,
      })
      .setOrigin(0.5);
    this.closeBtn = scene.add
      .text(this.halfW - 24, -this.halfH + 22, "✕", {
        fontFamily: MONO,
        fontSize: "16px",
        color: DIM,
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    this.closeBtn.on("pointerdown", () => this.close());

    const divider = scene.add.graphics();
    divider.lineStyle(1, 0x6f6244, 0.6).lineBetween(this.dividerX, -this.halfH + 44, this.dividerX, this.halfH - 76);

    const content: Phaser.GameObjects.GameObject[] = [divider];
    this.buildPreview(content);
    this.buildStats(content);
    this.buildLoadout(content);
    this.buildDetail(content);
    this.buildTips(content);
    content.push(this.closeBtn);

    const legendY = this.halfH - 62;
    this.controlsLegend = createControlLegend(this.scene, this.panelW - 32, legendY, this.previewCraft);
    content.push(...this.controlsLegend);

    this.root = scene.add
      .container(w / 2, h / 2, [...shadeBars, panel, title, closeHint, ...content])
      .setDepth(opts.depth ?? 9500)
      .setScrollFactor(0)
      .setVisible(false);

    // Debug-only: +/- nudges the shared three-region mad-multiplier live (see menuChrome's
    // getThreeRegionMadMul doc comment) — only while this panel is actually open.
    scene.input.keyboard?.on("keydown-PLUS", () => this.bumpThreeRegionMadMul(0.25));
    scene.input.keyboard?.on("keydown-NUMPAD_ADD", () => this.bumpThreeRegionMadMul(0.25));
    scene.input.keyboard?.on("keydown-MINUS", () => this.bumpThreeRegionMadMul(-0.25));
    scene.input.keyboard?.on("keydown-NUMPAD_SUBTRACT", () => this.bumpThreeRegionMadMul(-0.25));
  }

  private bumpThreeRegionMadMul(delta: number): void {
    if (!this.isOpen) return;
    adjustThreeRegionMadMul(delta);
    this.syncCraft();
  }

  // ============================================================ Public API

  toggle(force?: boolean): void {
    const want = force ?? !this._open;
    this._open = want;
    if (want) {
      this.previewCraft = craftOf();
      this.previewIndex = Math.max(0, allCrafts().findIndex((c) => c.kind === this.previewCraft.kind));
      this.focus = { kind: "preview" };
      this.lastShownTipId = undefined;
      this.refreshTips();
      this.syncCraft();
      this.syncFocus();
    }
    this.root.setVisible(want);
    this.opts.onToggle?.(want);
  }

  close(): void {
    this.toggle(false);
  }

  /** Menu-only: ‹ › buttons cycle the roster and drive the actual selection via onCraftChange. */
  cycleCraft(dir: number): void {
    if (!this._open || !this.opts.craftBrowsable) return;
    const roster = allCrafts();
    this.previewIndex = (this.previewIndex + dir + roster.length) % roster.length;
    this.previewCraft = roster[this.previewIndex]!;
    this.opts.onCraftChange?.(this.previewCraft.kind);
    this.refreshTips();
    this.syncCraft();
    // A loadout item (weapon or countermeasure) is specific to the craft it was picked on —
    // switching craft always drops back to the craft preview rather than risk landing on some
    // other weapon that happens to share the slot index.
    if (this.focus.kind === "weapon" || this.focus.kind === "cm") {
      this.focus = { kind: "preview" };
    }
    this.syncFocus();
  }

  /** Up/Down (or wheel) — cycle focus through preview → stats → loadout → close. */
  nudgeFocus(dir: number): void {
    if (!this._open) return;
    const stops = this.focusStops();
    const i = stops.findIndex((s) => focusEq(s, this.focus));
    const next = stops[(Math.max(0, i) + dir + stops.length) % stops.length]!;
    this.setFocus(next);
  }

  setFocus(f: Focus): void {
    if (!this._open || focusEq(f, this.focus)) return;
    this.focus = f;
    this.syncFocus();
  }

  /** Enter/Space on the currently focused item — only the close button does anything. */
  activateFocus(): void {
    if (!this._open) return;
    if (this.focus.kind === "close") this.close();
  }

  /** Left/Right tip navigation — dispatches to whichever tip set is currently in scope. */
  nudgeTip(dir: number): void {
    if (!this._open) return;
    if (this.focus.kind === "weapon") {
      const n = Math.max(1, this.weaponTips.length);
      this.weaponTipPage = (this.weaponTipPage + dir + n) % n;
    } else {
      const n = Math.max(1, this.missionTips.length);
      this.tipPage = (this.tipPage + dir + n) % n;
    }
    this.syncTipDisplay();
  }

  destroy(): void {
    this.root.destroy();
  }

  // ============================================================ Focus

  private focusStops(): Focus[] {
    const n = playerLoadoutFromSockets(this.previewCraft.sockets).length;
    const stops: Focus[] = [{ kind: "preview" }, { kind: "stats" }];
    for (let i = 0; i < n; i++) stops.push({ kind: "weapon", slot: i });
    stops.push({ kind: "cm" }, { kind: "close" });
    return stops;
  }

  private syncFocus(): void {
    const focused = (kind: Focus["kind"], slot?: number) =>
      this.focus.kind === kind && (kind !== "weapon" || this.focus.kind !== "weapon" || this.focus.slot === slot);

    this.drawFocusBox(this.previewFrame, this.previewBox, focused("preview"));
    this.drawFocusBox(this.statsFrame, this.statsBoxRect(), focused("stats"));
    this.loadoutRows.forEach((row, i) => {
      row.frame.setStrokeStyle(focused("weapon", i) ? 2 : 0, AMBER_N, 0.9);
    });
    this.cmRow.frame.setStrokeStyle(focused("cm") ? 2 : 0, AMBER_N, 0.9);
    this.closeBtn.setColor(focused("close") ? AMBER : DIM);

    this.syncSocketIndicator();
    this.syncDetail();
    this.syncTipContext();
  }

  /** Marks the focused weapon's actual mount point(s) on the craft body — cleared otherwise. */
  private syncSocketIndicator(): void {
    const g = this.socketIndicator;
    g.clear();
    if (this.focus.kind !== "weapon" || !this.craftBody) return;
    const slot = this.focus.slot;
    const craft = this.previewCraft;
    const socket = craft.sockets[slot];
    if (!socket) return;

    // A turret's "gun" point on the hull is its pivot/base, not the barrel tip — the actual
    // muzzle is authored on the gun mount texture itself, so it has to be read off that image's
    // own live transform (spriteUvPos), not the hull's. Fixed/hardpoint sockets already resolve
    // to their real firing point directly on the hull, so they don't need this.
    let points: { x: number; y: number }[] | undefined;
    if (socket.class === "turret" && this.craftOverlay) {
      // A socket can own more than one gun part (Black Hawk's paired door guns share one socket,
      // one entry per point) — collect a muzzle from every gun image tied to this socket, not
      // just the first match.
      const overlay = this.craftOverlay;
      const slots = craftGunSocketSlots(craft);
      const found = slots
        .map((slotIdx, i) => (slotIdx === slot ? overlay.gunImages[i] : undefined))
        .filter((img): img is Phaser.GameObjects.Image => !!img)
        .flatMap((gunImg) => lookupSpriteMuzzles(gunImg.texture.key).map((m) => spriteUvPos(gunImg, m.x, m.y)));
      if (found.length) points = found;
    }
    for (const at of points ?? craftSocketPoints(craft, socket).map((p) => spriteUvPos(this.craftBody, p.x, p.y))) {
      g.lineStyle(1.5, AMBER_N, 0.95);
      g.strokeCircle(at.x, at.y, 6);
      g.fillStyle(AMBER_N, 0.3);
      g.fillCircle(at.x, at.y, 6);
      g.lineBetween(at.x - 10, at.y, at.x - 4, at.y);
      g.lineBetween(at.x + 4, at.y, at.x + 10, at.y);
      g.lineBetween(at.x, at.y - 10, at.x, at.y - 4);
      g.lineBetween(at.x, at.y + 10, at.x, at.y + 4);
    }
    this.root.bringToTop(g);
  }

  private drawFocusBox(g: Phaser.GameObjects.Graphics, rect: { x: number; y: number; w: number; h: number }, active: boolean): void {
    g.clear();
    g.lineStyle(active ? 2 : 1, active ? AMBER_N : DIM_N, active ? 0.95 : 0.5);
    g.strokeRoundedRect(rect.x - rect.w / 2, rect.y - rect.h / 2, rect.w, rect.h, 6);
  }

  private statsBoxRect(): { x: number; y: number; w: number; h: number } {
    return this.statsBoxCache;
  }

  /** Margin from the panel's left edge to the left column's content. */
  private static readonly LEFT_MARGIN = 20;
  /** Margin from the left column's content to the center divider — it must never touch it. */
  private static readonly DIVIDER_MARGIN = 20;

  private leftX(): number {
    return -this.halfW + FieldManual.LEFT_MARGIN + this.leftColW() / 2;
  }

  private leftColW(): number {
    return this.dividerX - -this.halfW - FieldManual.LEFT_MARGIN - FieldManual.DIVIDER_MARGIN;
  }

  // ============================================================ Tips

  private refreshTips(): void {
    const craft = this.previewCraft;
    this.missionTipsKnown = {
      ...tipKnownFromSelection(this.opts.getEnemies?.()),
      crafts: [craft.kind],
      weapons: playerLoadoutFromSockets(craft.sockets).map(wpnIdOf),
      cms: [craftCountermeasure(craft.countermeasure)],
    };
    const tips = tipsForKnown(this.missionTipsKnown);
    // Least-shown first (ties shuffled), starting at the top.
    this.missionTips = orderByLeastShown(tips.length ? tips : tipsForKnown({}), tipShownCounts());
    this.tipPage = 0;
  }

  private syncTipContext(): void {
    if (this.focus.kind === "weapon") {
      const craft = this.previewCraft;
      const weapons = playerLoadoutFromSockets(craft.sockets);
      const weapon = weapons[this.focus.slot];
      const id = weapon ? wpnIdOf(weapon) : undefined;
      this.weaponTipsKnown = id ? { weapons: [id] } : {};
      this.weaponTips = id ? orderByLeastShown(tipsForWeapon(id), tipShownCounts()) : [];
      this.weaponTipPage = 0;
    }
    this.syncTipDisplay();
  }

  /** Count a tip once each time it comes on screen (not on every redraw of the same one). */
  private countTipShown(tip: TacticalTip | undefined): void {
    if (!tip || tip.id === this.lastShownTipId) return;
    this.lastShownTipId = tip.id;
    markTipShown(tip.id);
  }

  private syncTipDisplay(): void {
    if (this.focus.kind === "weapon") {
      const tip = this.weaponTips[this.weaponTipPage];
      this.countTipShown(tip);
      this.tipBody.setText(tip ? tipText(tip, this.weaponTipsKnown) : "No specific tips for this weapon yet.");
      this.tipCounter.setText(this.weaponTips.length ? `${this.weaponTipPage + 1} / ${this.weaponTips.length}   ← →` : "");
    } else {
      const tip = this.missionTips[this.tipPage];
      this.countTipShown(tip);
      this.tipBody.setText(tip ? tipText(tip, this.missionTipsKnown) : "No tips for this loadout yet.");
      this.tipCounter.setText(`${Math.min(this.tipPage + 1, this.missionTips.length)} / ${Math.max(1, this.missionTips.length)}   ← →`);
    }
  }

  private buildTips(content: Phaser.GameObjects.GameObject[]): void {
    const scene = this.scene;
    this.tipHDivider = scene.add.graphics();
    content.push(this.tipHDivider);
    this.tipHeader = scene.add
      .text(this.rightX0 + this.rightW / 2, 0, "TACTICAL TIP", { fontFamily: MONO, fontSize: "11px", color: AMBER })
      .setOrigin(0.5);
    content.push(this.tipHeader);
    this.tipBody = scene.add
      .text(this.rightX0 + this.rightW / 2, 0, "", {
        fontFamily: MONO,
        fontSize: "13px",
        color: BRIGHT,
        align: "center",
        lineSpacing: 5,
        wordWrap: { width: this.rightW },
      })
      .setOrigin(0.5, 0);
    content.push(this.tipBody);
    this.tipPrev = scene.add
      .text(this.rightX0 + this.rightW / 2 - 90, 0, "‹  PREV", { fontFamily: MONO, fontSize: "12px", color: AMBER })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    this.tipNext = scene.add
      .text(this.rightX0 + this.rightW / 2 + 90, 0, "NEXT  ›", { fontFamily: MONO, fontSize: "12px", color: AMBER })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    this.tipPrev.on("pointerdown", () => this.nudgeTip(-1));
    this.tipNext.on("pointerdown", () => this.nudgeTip(1));
    this.tipCounter = scene.add
      .text(this.rightX0 + this.rightW / 2, 0, "", { fontFamily: MONO, fontSize: "11px", color: DIM })
      .setOrigin(0.5);
    content.push(this.tipPrev, this.tipNext, this.tipCounter);

    this.positionTips(this.detailY0 + FieldManual.DETAIL_MIN_H + 30);
  }

  /** Places the tip block at y0 — called with the actual bottom of whatever the focus panel rendered. */
  private positionTips(y0: number): void {
    const dividerY = y0 - 22;
    this.tipHDivider.clear().lineStyle(1, 0x6f6244, 0.5).lineBetween(this.rightX0, dividerY, this.rightX0 + this.rightW, dividerY);
    this.tipHeader.setY(y0);
    this.tipBody.setY(y0 + 18);
    const navY = y0 + 90;
    this.tipPrev.setY(navY);
    this.tipNext.setY(navY);
    this.tipCounter.setY(navY);
  }

  // ============================================================ Preview (left)

  private buildPreview(content: Phaser.GameObjects.GameObject[]): void {
    const scene = this.scene;
    const leftX = this.leftX();

    this.craftName = scene.add
      .text(leftX, -this.halfH + 54, "", {
        fontFamily: "Black Ops One, Impact, sans-serif",
        fontSize: "16px",
        color: "#f2d579",
        align: "center",
      })
      .setOrigin(0.5);
    content.push(this.craftName);

    // Solid card background, matching the menu carousel's card style (not just its aspect ratio).
    this.previewBg = scene.add.rectangle(leftX, this.previewBox.y, this.previewBox.w, this.previewBox.h, 0x0c0b09, 0.82);
    content.push(this.previewBg);

    // Body/gun/rotor/exhaust images are built fresh per-craft in syncPreview() (called on
    // every open) — their count and mounts vary by craft, so they can't be built once here.
    this.previewFrame = scene.add.graphics();
    content.push(this.previewFrame);
    this.socketIndicator = scene.add.graphics();
    content.push(this.socketIndicator);
    scene.tweens.add({
      targets: this.socketIndicator,
      alpha: { from: 0.5, to: 1 },
      duration: 550,
      yoyo: true,
      repeat: -1,
      ease: "Sine.InOut",
    });
    this.previewHit = scene.add
      .rectangle(leftX, this.previewBox.y, this.previewBox.w, this.previewBox.h, 0x000000, 0)
      .setInteractive({ useHandCursor: true });
    this.previewHit.on("pointerdown", () => this.setFocus({ kind: "preview" }));
    content.push(this.previewHit);

    if (this.opts.craftBrowsable) {
      const arrowGap = this.previewBox.w / 2 + 20;
      const arrowStyle = { fontFamily: MONO, fontSize: "26px", color: AMBER };
      this.prevCraftBtn = scene.add
        .text(leftX - arrowGap, this.previewBox.y, "‹", arrowStyle)
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });
      this.nextCraftBtn = scene.add
        .text(leftX + arrowGap, this.previewBox.y, "›", arrowStyle)
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });
      const punch = (btn: Phaser.GameObjects.Text) => {
        btn.on("pointerover", () => scene.tweens.add({ targets: btn, scale: 1.25, duration: 110, ease: "Back.Out" }));
        btn.on("pointerout", () => scene.tweens.add({ targets: btn, scale: 1, duration: 130, ease: "Sine.Out" }));
      };
      punch(this.prevCraftBtn);
      punch(this.nextCraftBtn);
      this.prevCraftBtn.on("pointerdown", () => this.cycleCraft(-1));
      this.nextCraftBtn.on("pointerdown", () => this.cycleCraft(1));
      content.push(this.prevCraftBtn, this.nextCraftBtn);
    }

    this.craftDesc = scene.add
      .text(leftX, -this.halfH + 220, "", {
        fontFamily: MONO,
        fontSize: "12px",
        color: CREAM,
        align: "center",
        lineSpacing: 4,
        wordWrap: { width: this.leftColW() },
      })
      .setOrigin(0.5, 0);
    content.push(this.craftDesc);
  }

  // ============================================================ Stats (left)

  private buildStats(content: Phaser.GameObjects.GameObject[]): void {
    const scene = this.scene;
    const leftX = this.leftX();
    this.craftStatLabels = ["SPEED", "AGILITY", "SIZE", "ARMOR", "FIREPOWER"].map((label) =>
      scene.add.text(-this.halfW + 40, 0, label, { fontFamily: MONO, fontSize: "10px", color: CREAM }).setOrigin(0, 0.5)
    );
    this.craftRoleLabel = scene.add
      .text(-this.halfW + 40, 0, "ROLE", { fontFamily: MONO, fontSize: "10px", color: CREAM })
      .setOrigin(0, 0.5);
    this.craftRoleValue = scene.add
      .text(0, 0, "", { fontFamily: MONO, fontSize: "10px", color: "#f2d579" })
      .setOrigin(0, 0.5);
    this.craftStatBars = scene.add.graphics();
    this.statsFrame = scene.add.graphics();
    this.statsHit = scene.add.rectangle(leftX, 0, this.leftColW(), this.statRowH * 6 + 14, 0x000000, 0).setInteractive({ useHandCursor: true });
    this.statsHit.on("pointerdown", () => this.setFocus({ kind: "stats" }));
    content.push(this.statsFrame, this.statsHit, ...this.craftStatLabels, this.craftRoleLabel, this.craftRoleValue, this.craftStatBars);
  }

  // ============================================================ Loadout (left)

  private buildLoadout(content: Phaser.GameObjects.GameObject[]): void {
    const scene = this.scene;
    const leftX = this.leftX();
    const rowW = this.leftColW();
    const makeRow = (interactive: boolean) => {
      const frame = scene.add.rectangle(leftX, 0, rowW, this.loadoutRowH - 2, 0x1b1710, 0.8);
      if (interactive) frame.setInteractive({ useHandCursor: true });
      const slot = scene.add.text(leftX - rowW / 2 + 10, 0, "", { fontFamily: MONO, fontSize: "11px", color: AMBER }).setOrigin(0.5);
      const name = scene.add.text(leftX - rowW / 2 + 28, 0, "", { fontFamily: MONO, fontSize: "11px", color: CREAM }).setOrigin(0, 0.5);
      const crew = scene.add
        .text(leftX - rowW / 2 + 28, 0, "", { fontFamily: MONO, fontSize: "10px", color: "#7ad0ff" })
        .setOrigin(0, 0.5)
        .setVisible(false);
      const ammo = scene.add.text(leftX + rowW / 2, 0, "", { fontFamily: MONO, fontSize: "11px", color: "#f2d579" }).setOrigin(1, 0.5);
      return { frame, slot, name, crew, ammo };
    };
    const maxSlots = Math.max(4, ...allCrafts().map((c) => c.sockets.length));
    this.loadoutRows = Array.from({ length: maxSlots }, (_, i) => {
      const row = makeRow(true);
      row.frame.on("pointerdown", () => this.setFocus({ kind: "weapon", slot: i }));
      content.push(row.frame, row.slot, row.name, row.crew, row.ammo);
      return row;
    });
    this.cmRow = makeRow(true);
    this.cmRow.frame.on("pointerdown", () => this.setFocus({ kind: "cm" }));
    content.push(this.cmRow.frame, this.cmRow.slot, this.cmRow.name, this.cmRow.ammo);
  }

  // ============================================================ Left column sync

  /**
   * Rebuilds the body/gun/rotor/exhaust images from scratch for the current craft.
   * Part counts and mounts differ per craft (e.g. planes have no rotors), so reusing the
   * previous craft's images and just repositioning them left stale rotors/guns behind.
   */
  private syncPreview(craft: CraftSpec): void {
    const scene = this.scene;
    const leftX = this.leftX();
    const previewY = this.previewBox.y;

    this.craftBody?.destroy();
    this.craftOverlay?.destroy();
    for (const go of this.craftRemoteInlays) go.destroy();

    const composite = craftComposite(craft);
    // Center on the sprite bounds, not the pivot — pivots vary per craft (overlays follow origin).
    this.craftBody = scene.add.image(leftX, previewY, composite.body.tex).setOrigin(0.5, 0.5);
    const scale = craftPreviewFitScale(this.craftBody.width, this.craftBody.height, this.previewBox.w - 16, this.previewBox.h - 16);
    this.craftBody.setScale(scale);

    // Same rotor/exhaust/gun overlay the menu carousel uses. `below`-layer guns go in front of
    // previewFrame but behind the body; `above` goes after — appended (not inserted at
    // previewFrame's index) so the craft always renders above the focus border, matching
    // the menu carousel. Nothing else in the left column overlaps this box spatially.
    this.craftOverlay = buildCraftPreviewOverlay(scene, this.craftBody, craft);
    const previewParts: (Phaser.GameObjects.Image | Phaser.GameObjects.Container)[] = [
      ...this.craftOverlay.below,
      this.craftBody,
      ...this.craftOverlay.above,
    ];
    this.root.add(previewParts);

    // Small inset previews of any remote units this craft's loadout can deploy.
    const remoteKinds = [
      ...new Set(
        playerLoadoutFromSockets(craft.sockets)
          .map((w) => w.payload.remote?.kind)
          .filter((k): k is RemoteKind => !!k)
      ),
    ];
    const inlaySize = 30;
    const inlayMargin = 4;
    const inlayY = previewY + this.previewBox.h / 2 - inlaySize / 2 - inlayMargin;
    this.craftRemoteInlays = remoteKinds.flatMap((kind, i) => {
      const hull = remoteSpecOf(kind);
      const inlayX = leftX + this.previewBox.w / 2 - inlaySize / 2 - inlayMargin - i * (inlaySize + inlayMargin);
      const frame = scene.add
        .rectangle(inlayX, inlayY, inlaySize, inlaySize, 0x0c0b09, 0.85)
        .setStrokeStyle(1, 0x5d5544, 0.9);
      const icon = scene.add.image(inlayX, inlayY, hull.body).setOrigin(0.5, 0.5);
      icon.setScale(craftPreviewFitScale(icon.width, icon.height, inlaySize - 6, inlaySize - 6));
      this.root.add([frame, icon]);
      return [frame, icon];
    });
  }

  private syncCraft(): void {
    const craft = this.previewCraft;
    this.syncPreview(craft);
    this.craftName.setText(craft.fullName.toUpperCase());
    this.craftDesc.setText(craft.description ?? "");

    // Stats stack right under the description — its wrapped height varies per craft.
    const statsY0 = this.craftDesc.y + this.craftDesc.height + 20;
    const leftX = this.leftX();
    const statBarX = -this.halfW + 130;
    // FIREPOWER uses craftFirepowerRating (ammoScale, boosted by standout burst weapons — see its
    // doc comment) rather than raw weapon burst. Every bar fills on a three-region scale (see
    // computeThreeRegionScale/threeRegionNorm's doc comments) rather than plain linear-against-
    // max, so a handful of outlier craft can't stretch or compress where the typical craft land.
    const allCraftsList = allCrafts();
    const statRaw = [
      { value: craft.maxSpeed, values: allCraftsList.map((c) => c.maxSpeed) },
      { value: craftAgility(craft), values: allCraftsList.map((c) => craftAgility(c)) },
      { value: craft.sizeM, values: allCraftsList.map((c) => c.sizeM) },
      { value: craft.health, values: allCraftsList.map((c) => c.health) },
      { value: craftFirepowerRating(craft), values: allCraftsList.map((c) => craftFirepowerRating(c)) },
    ];
    this.craftStatBars.clear();
    statRaw.forEach((stat, i) => {
      const y = statsY0 + i * this.statRowH;
      this.craftStatLabels[i]!.setPosition(-this.halfW + 40, y);
      drawThreeRegionBar(this.craftStatBars, statBarX, y, stat.value, computeThreeRegionScale(stat.values), {
        segW: 8,
        segGap: 2,
      });
    });
    const roleY = statsY0 + statRaw.length * this.statRowH + 4;
    this.craftRoleLabel.setPosition(-this.halfW + 40, roleY);
    this.craftRoleValue.setPosition(statBarX, roleY).setText(craft.role.toUpperCase());
    const blockTop = statsY0 - this.statRowH / 2 - 4;
    const blockBottom = roleY + this.statRowH / 2 + 4;
    this.statsBoxCache = { x: leftX, y: (blockTop + blockBottom) / 2, w: this.leftColW(), h: blockBottom - blockTop };
    this.statsHit.setPosition(leftX, this.statsBoxCache.y);

    if (this.controlsScheme !== craft.controlScheme) {
      this.controlsScheme = craft.controlScheme;
      for (const go of this.controlsLegend) go.destroy();
      this.controlsLegend = createControlLegend(this.scene, this.panelW - 32, this.halfH - 62, craft);
      this.root.add(this.controlsLegend);
    }

    const weapons = playerLoadoutFromSockets(craft.sockets);
    const loadoutRow0 = roleY + 28;
    this.loadoutRows.forEach((row, i) => {
      const weapon = weapons[i];
      const on = !!weapon;
      row.frame.setVisible(on);
      row.slot.setVisible(on);
      row.name.setVisible(on);
      row.crew.setVisible(on);
      row.ammo.setVisible(on);
      if (!weapon) return;
      const y = loadoutRow0 + i * this.loadoutRowH;
      row.frame.setPosition(row.frame.x, y);
      row.slot.setPosition(row.slot.x, y).setText(String(i + 1));
      row.name.setPosition(row.name.x, y);
      row.ammo.setPosition(row.ammo.x, y);
      const parts = craftLoadoutParts(craft, i, weapon.fullName);
      // Launches a remote craft rather than firing a shot — flag it right on the name.
      const isRemote = !!weapon.payload.remote;
      row.name.setText(isRemote ? `▸ ${parts.base}` : parts.base).setColor(isRemote ? REMOTE_LABEL : CREAM);
      if (parts.crew) row.crew.setText(parts.crew).setVisible(true).setPosition(row.name.x + row.name.width, y);
      else row.crew.setVisible(false);
      const capacity = craftSocketStartingAmmo(weapon.ammo, craft, i);
      row.ammo.setText(capacity === Infinity ? "∞" : String(capacity));
    });
    const cmY = loadoutRow0 + weapons.length * this.loadoutRowH;
    const cm = COUNTERMEASURES[craftCountermeasure(craft.countermeasure)];
    this.cmRow.frame.setPosition(this.cmRow.frame.x, cmY).setVisible(true);
    this.cmRow.slot.setPosition(this.cmRow.slot.x, cmY).setVisible(true).setText("F").setColor("#7ad0ff");
    this.cmRow.name.setPosition(this.cmRow.name.x, cmY).setVisible(true).setText(cm.name).setColor("#c8d4e8");
    this.cmRow.ammo.setPosition(this.cmRow.ammo.x, cmY).setVisible(true).setText(countermeasureTimingLabel(cm)).setColor("#8ec8e8");
  }

  // ============================================================ Right column: focus detail

  private buildDetail(content: Phaser.GameObjects.GameObject[]): void {
    const scene = this.scene;
    this.detailHeader = scene.add
      .text(this.rightX0, this.detailY0, "", { fontFamily: MONO, fontSize: "11px", color: "#aaa28f" })
      .setOrigin(0, 0.5);
    content.push(this.detailHeader);
  }

  private clearDetail(): void {
    for (const go of this.detailDynamic) go.destroy();
    this.detailDynamic = [];
  }

  private addDetail<T extends Phaser.GameObjects.GameObject>(go: T): T {
    this.detailDynamic.push(go);
    this.root.add(go);
    return go;
  }

  private syncDetail(): void {
    this.clearDetail();
    const y0 = this.detailY0 + 22;
    let bottom: number;
    switch (this.focus.kind) {
      case "preview":
        this.detailHeader.setText("CAREER STATS");
        bottom = this.buildCareerStats(y0);
        break;
      case "stats":
        this.detailHeader.setText("STAT COMPARISON");
        bottom = this.buildStatComparison(y0);
        break;
      case "weapon":
        this.detailHeader.setText("WEAPON PROFILE");
        bottom = this.buildWeaponDetail(y0, this.focus.slot);
        break;
      case "cm":
        this.detailHeader.setText("COUNTERMEASURE");
        bottom = this.buildCmDetail(y0);
        break;
      case "close":
        // Leave whatever was last shown, and the tip block where it was — close is a
        // highlight target, not a content view.
        return;
    }
    // Tip block sits right below the focus panel's actual content — never overlaps it,
    // regardless of how tall a given panel's content turns out to be.
    this.positionTips(Math.max(this.detailY0 + FieldManual.DETAIL_MIN_H + 30, bottom + 24));
  }

  /** This craft's lifetime stats (saved at each mission's end). */
  private buildCareerStats(y0: number): number {
    const scene = this.scene;
    const craft = this.previewCraft.kind;
    const career = this.career();
    const c = career.crafts.get(craft);
    if (c?.started) {
      let y = y0;
      const pills: Pill[] = [];
      if (career.favoriteCraft === craft) pills.push({ text: "FAVORITE CRAFT", style: TAG_GOLD, icon: "star" });
      for (const p of STAT_PILLS) if (c[p.stat] > 0) pills.push({ text: `${p.label} ${c[p.stat]}`, style: p.style, icon: p.icon });
      const decided = c.succeeded + c.failed;
      const pct = (v: number) => `${Math.round(v * 100)}%`;
      const perMin = c.timeFlown > 0 ? (c.kills / (c.timeFlown / 60)).toFixed(1) : "—";
      const tiles: { label: string; value: string; note?: string; cells?: { label: string; value: string }[] }[] = [
        { label: "MISSIONS", value: `${c.started}`, note: decided > 0 ? `${pct(ratio(c.succeeded, decided))} WON` : undefined },
        {
          label: "KILLS",
          value: `${c.kills}`,
          cells: [
            { label: "ENMY", value: `${c.unitKills}` },
            { label: "BLDG", value: `${c.buildingKills}` },
            { label: "COLL", value: `${c.collateralKills}` },
            { label: "K/MIN", value: perMin },
          ],
        },
        { label: "DEATHS", value: `${c.deaths}` },
        { label: "OBJECTIVES", value: `${c.objectives}` },
        { label: "ACCURACY", value: c.shots > 0 ? pct(ratio(c.hits, c.shots)) : "—" },
        { label: "FLIGHT TIME", value: formatDuration(c.timeFlown) },
      ];
      const gap = 8;
      const tileW = (this.rightW - gap) / 2;
      const tileH = 42;
      tiles.forEach((t, i) => {
        const x = this.rightX0 + (i % 2) * (tileW + gap);
        const ty = y - 6 + Math.floor(i / 2) * (tileH + gap);
        this.addDetail(scene.add.rectangle(x, ty, tileW, tileH, 0x0c0b09, 0.85).setOrigin(0, 0).setStrokeStyle(1, 0x5d5544, 0.8));
        this.addDetail(scene.add.text(x + 10, ty + 7, t.label, { fontFamily: MONO, fontSize: "9px", color: DIM }).setOrigin(0, 0));
        const value = this.addDetail(scene.add.text(x + 10, ty + 19, t.value, { fontFamily: MONO, fontSize: "16px", color: AMBER }).setOrigin(0, 0));
        if (t.note) {
          this.addDetail(
            scene.add.text(value.x + value.width + 8, ty + 24, t.note, { fontFamily: MONO, fontSize: "10px", color: CREAM }).setOrigin(0, 0)
          );
        }
        if (t.cells) {
          // Breakdown cells share the tile's right part, same label-over-value layout.
          const cx0 = x + Math.max(64, value.width + 30);
          const cellW = (x + tileW - 6 - cx0) / t.cells.length;
          t.cells.forEach((cell, ci) => {
            const cx = cx0 + ci * cellW;
            this.addDetail(scene.add.text(cx, ty + 7, cell.label, { fontFamily: MONO, fontSize: "8px", color: DIM }).setOrigin(0, 0));
            this.addDetail(scene.add.text(cx, ty + 21, cell.value, { fontFamily: MONO, fontSize: "11px", color: CREAM }).setOrigin(0, 0));
          });
        }
      });
      y = y - 6 + Math.ceil(tiles.length / 2) * (tileH + gap) - gap + 10;
      if (pills.length) y = this.buildPills(pills, y) + 12;
      return this.buildRecentMissions(craft, y + 4);
    }
    const note = this.addDetail(
      scene.add
        .text(this.rightX0, y0, "No missions flown in this craft yet.", {
          fontFamily: MONO,
          fontSize: "10px",
          color: DIM,
          wordWrap: { width: this.rightW },
        })
        .setOrigin(0, 0)
    );
    return y0 + note.height;
  }

  /** Lifetime career summary (rebuilt only when a new mission has been recorded). */
  private career(): Career {
    const book = lifetimeStats();
    if (!this.careerCache || this.careerCache.missions !== book.missions) {
      this.careerCache = { missions: book.missions, career: careerOf(book) };
    }
    return this.careerCache.career;
  }

  /** Colored, icon-led pills, flow-wrapped across the detail column; returns the bottom of the last row. */
  private buildPills(pills: readonly Pill[], y0: number): number {
    if (!pills.length) return y0;
    const gap = 6;
    let x = this.rightX0;
    let y = y0;
    let rowH = 0;
    for (const p of pills) {
      const tag = this.tag(p.text, p.style, p.icon);
      if (x > this.rightX0 && x + tag.w > this.rightX0 + this.rightW) {
        x = this.rightX0;
        y += rowH + gap;
        rowH = 0;
      }
      tag.place(x, y);
      rowH = Math.max(rowH, tag.h);
      x += tag.w + gap;
    }
    return y + rowH;
  }

  /** One tag chip (outline, fill, optional icon, label), measured first and drawn by `place`. */
  private tag(label: string, style: TagStyle, icon?: IconName): { w: number; h: number; place: (x: number, y: number) => void } {
    const scene = this.scene;
    const iconW = icon ? 12 : 0;
    const txt = this.addDetail(scene.add.text(0, 0, label, { fontFamily: MONO, fontSize: "9px", color: style.text }).setOrigin(0, 0.5));
    const w = txt.width + 14 + iconW;
    const h = txt.height + 8;
    return {
      w,
      h,
      place: (x, y) => {
        const g = this.addDetail(scene.add.graphics());
        g.lineStyle(1, style.stroke, 0.9).fillStyle(style.fill, 0.7);
        g.fillRoundedRect(x, y, w, h, 4);
        g.strokeRoundedRect(x, y, w, h, 4);
        if (icon) drawIcon(g, icon, x + 7 + 5, y + h / 2, style.ink, 9);
        txt.setPosition(x + 7 + iconW, y + h / 2);
        // Text was added before its chip graphic; keep it on top.
        this.root.bringToTop(txt);
      },
    };
  }

  /** This craft's last few missions as rows: outcome, date, map, flight time, hostile kills, objectives. */
  private buildRecentMissions(craft: string, y0: number): number {
    const scene = this.scene;
    const recent = missionHistory().filter((r) => r.result.craft === craft).slice(0, RECENT_MISSIONS_SHOWN);
    if (!recent.length) return y0;
    this.addDetail(scene.add.text(this.rightX0, y0, "RECENT MISSIONS", { fontFamily: MONO, fontSize: "9px", color: DIM }).setOrigin(0, 0));
    const g = this.addDetail(scene.add.graphics());
    const x0 = this.rightX0;
    const x1 = x0 + this.rightW;
    const rowH = 20;
    const gap = 3;
    // Fixed left-aligned columns at the right: time, kills, objectives.
    const objX = x1 - 52;
    const killsX = objX - 50;
    const timeX = killsX - 66;
    let y = y0 + 16;
    for (const r of recent) {
      const res = r.result;
      const o = OUTCOME_STYLE[res.outcome];
      const cy = y + rowH / 2;
      g.fillStyle(0x0c0b09, 0.85).fillRect(x0, y, this.rightW, rowH);
      g.fillStyle(o.color, 0.9).fillRect(x0, y, 2, rowH);
      drawIcon(g, o.icon, x0 + 13, cy, o.color);
      const date = new Date(res.at).toLocaleDateString(undefined, { month: "short", day: "2-digit" }).toUpperCase();
      this.addDetail(scene.add.text(x0 + 26, cy, date, { fontFamily: MONO, fontSize: "9px", color: DIM }).setOrigin(0, 0.5));
      const kills = total(r.offense, "kills", (at) => isHostileEnemy(at.enemy));
      const obj = missionObjectives(r);
      const cols = [
        { x: timeX, icon: "clock" as const, text: formatDuration(res.time) },
        { x: killsX, icon: "crosshair" as const, text: `${kills}` },
        { x: objX, icon: "flag" as const, text: obj.total != null ? `${obj.done}/${obj.total}` : `${obj.done}` },
      ];
      for (const col of cols) {
        drawIcon(g, col.icon, col.x + 5, cy, 0x8a8470);
        this.addDetail(scene.add.text(col.x + 13, cy, col.text, { fontFamily: MONO, fontSize: "10px", color: CREAM }).setOrigin(0, 0.5));
      }
      const mapX = x0 + 72;
      const mapTxt = this.addDetail(
        scene.add.text(mapX, cy, (MISSIONS[res.map as MissionKind]?.label ?? res.map).toUpperCase(), { fontFamily: MONO, fontSize: "10px", color: BRIGHT }).setOrigin(0, 0.5)
      );
      fitText(mapTxt, timeX - 12 - mapX);
      y += rowH + gap;
    }
    return y - gap;
  }

  /**
   * Flow-wraps classification tags as framed chips within the detail column's width, packing
   * each line left-to-right and optionally centering each finished line (used to sit them
   * neatly under a weapon's name). Returns the bottom of the last chip row, or y0 unchanged
   * when there are no labels.
   */
  private buildBadgeChips(labels: string[], y0: number, align: "left" | "center" = "left", gold: readonly string[] = []): number {
    type Chip = ReturnType<FieldManual["tag"]>;
    const gap = 6;
    const chips = labels.map((label) => (gold.includes(label) ? this.tag(label, TAG_GOLD, "star") : this.tag(label, TAG_BLUE)));
    const lines: Chip[][] = [];
    let cur: Chip[] = [];
    let curW = 0;
    for (const chip of chips) {
      if (cur.length && curW + gap + chip.w > this.rightW) {
        lines.push(cur);
        cur = [];
        curW = 0;
      }
      curW += (cur.length ? gap : 0) + chip.w;
      cur.push(chip);
    }
    if (cur.length) lines.push(cur);

    let y = y0;
    for (const line of lines) {
      const lineW = line.reduce((s, c) => s + c.w, 0) + gap * (line.length - 1);
      let x = align === "center" ? this.rightX0 + (this.rightW - lineW) / 2 : this.rightX0;
      const lineH = Math.max(...line.map((c) => c.h));
      for (const chip of line) {
        chip.place(x, y);
        x += chip.w + gap;
      }
      y += lineH + 6;
    }
    return lines.length ? y - 6 : y0;
  }

  /**
   * Main shot art, then the bomblets it releases packed into fixed-height columns (wrapping to
   * a new column once one fills up) — each column vertically centered on the row, not stacked
   * from the top, so a short column still reads as centered. A dotted yellow line curves from
   * the ordnance's actual tip to just left of every individual bomblet.
   */
  private buildClusterRow(
    y0: number,
    mainTex: string,
    mainOrigin: { x: number; y: number },
    mainScale: number,
    mainTint: number | undefined,
    bombletTex: string,
    count: number,
    exhaust: ExhaustTrail | undefined,
    weaponSpeed: number
  ): number {
    const scene = this.scene;
    const rowH = 66;
    const mainBoxW = 84;
    const lineGap = 30;
    const box = 14;
    const bombletGap = 2;
    const colGap = 3;

    const maxPerCol = Math.max(1, Math.floor(rowH / (box + bombletGap)));
    const cols = Math.ceil(count / maxPerCol);
    const bombletsW = cols * box + (cols - 1) * colGap;
    const totalW = mainBoxW + lineGap + bombletsW;
    const rowCY = y0 + rowH / 2;
    const x0 = this.rightX0 + this.rightW / 2 - totalW / 2;

    const mainImg = scene.add.image(x0 + mainBoxW / 2, rowCY, mainTex).setOrigin(mainOrigin.x, mainOrigin.y);
    if (mainTint != null) mainImg.setTint(mainTint);
    mainImg.setScale(craftPreviewFitScale(mainImg.width, mainImg.height, mainBoxW - 8, rowH - 8) * mainScale);
    this.addDetail(mainImg);
    if (exhaust) this.attachExhaust(mainImg, mainOrigin, exhaust, weaponSpeed);

    // The sprite's actual nose, not the layout box edge — origin.x is the pivot's fraction
    // from the sprite's left, so (1 - origin.x) * displayWidth reaches its right/nose edge.
    const tipX = mainImg.x + (1 - mainOrigin.x) * mainImg.displayWidth;
    const tipY = mainImg.y;

    const bombletsX0 = x0 + mainBoxW + lineGap;
    const positions: { x: number; y: number }[] = [];
    let remaining = count;
    for (let c = 0, cx = bombletsX0; c < cols; c++, cx += box + colGap) {
      const n = Math.min(maxPerCol, remaining);
      const colH = n * box + (n - 1) * bombletGap;
      const startY = rowCY - colH / 2 + box / 2;
      for (let i = 0; i < n; i++) positions.push({ x: cx + box / 2, y: startY + i * (box + bombletGap) });
      remaining -= n;
    }

    // Dotted curved connector from the ordnance's tip to just left of each bomblet in the
    // first column only (max 4) — standing in for "releases into these", not a full wiring
    // diagram of every submunition. Bows outward symmetrically: lines above the group's
    // center curve up, lines below curve down, a dead-center line (odd counts) stays straight.
    const lineG = scene.add.graphics();
    const firstColCount = Math.min(maxPerCol, count);
    const lineTargets = positions.slice(0, Math.min(4, firstColCount));
    const mid = (lineTargets.length - 1) / 2;
    lineTargets.forEach((pos, i) => {
      const targetX = pos.x - box / 2 - 3;
      const targetY = pos.y;
      const dx = targetX - tipX;
      const dy = targetY - tipY;
      const rel = i - mid;
      const bowDir = Math.sign(rel);
      const bowMag = Math.min(10, 3 + Math.abs(dx) * 0.06) * (mid > 0 ? Math.abs(rel) / mid : 0);
      const bow = bowDir * bowMag;
      const ctrlX = tipX + dx * 0.5;
      const ctrlY = tipY + dy * 0.5 + bow;
      const dist = Math.hypot(dx, dy);
      const steps = Math.max(6, Math.round(dist / 6));
      // Leave a little breathing room at both ends instead of starting the dots flush against
      // the tip and ending them flush against the bomblet.
      const margin = Math.min(0.3, 7 / Math.max(1, dist));
      for (let s = 1; s <= steps; s++) {
        const t = margin + (s / steps) * (1 - 2 * margin);
        const mt = 1 - t;
        const px = mt * mt * tipX + 2 * mt * t * ctrlX + t * t * targetX;
        const py = mt * mt * tipY + 2 * mt * t * ctrlY + t * t * targetY;
        lineG.fillStyle(0xf7e6a8, 0.4);
        lineG.fillCircle(px, py, 0.9);
      }
    });
    this.addDetail(lineG);

    positions.forEach((pos) => {
      const icon = scene.add.image(pos.x, pos.y, bombletTex).setOrigin(0.5, 0.5);
      icon.setScale(craftPreviewFitScale(icon.width, icon.height, box, box));
      this.addDetail(icon);
    });

    return y0 + rowH + 10;
  }

  /**
   * Photon/Warp's real in-mission look: body sprite hidden, an additive composite drawn
   * instead — soft glow bloom, a few streak "spokes", and a bright core, each gently
   * flickering (missionScene's syncPhotonFlares, minus the camera-relative spoke aiming this
   * static preview has no use for). Returns the core image, used as the exhaust trail's anchor.
   */
  private buildPhotonFlare(cx: number, cy: number, tint: number | undefined): Phaser.GameObjects.Image | undefined {
    const scene = this.scene;
    if (!scene.textures.exists("shot_photon_core")) return undefined;
    const sc = 0.42;
    const seed = Math.random() * Math.PI * 2;
    const layer = (tex: string, angle: number, sx: number, sy: number, alpha: number, depth: number) => {
      if (!scene.textures.exists(tex)) return undefined;
      const img = scene.add
        .image(cx, cy, tex)
        .setOrigin(0.5, 0.5)
        .setRotation(angle)
        .setScale(sx, sy)
        .setAlpha(alpha)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(depth);
      if (tint != null) img.setTint(tint);
      this.addDetail(img);
      return img;
    };
    const flicker = (img: Phaser.GameObjects.Image | undefined, lo: number, hi: number, duration: number) => {
      if (!img) return;
      scene.tweens.add({ targets: img, alpha: { from: hi, to: lo }, duration, yoyo: true, repeat: -1, ease: "Sine.InOut" });
    };

    const glow = layer("shot_photon_glow", 0, sc * 2.05, sc * 2.05, 0.5, 1);
    const h0 = layer("shot_photon_stream_h", 0.1 + Math.sin(seed) * 0.1, sc * 3.6, sc, 0.9, 2);
    const h1 = layer("shot_photon_stream_h", Math.PI / 2 + 0.15, sc * 2.9, sc * 0.85, 0.65, 2);
    const d0 = layer("shot_photon_stream_diag", Math.PI / 4 + Math.cos(seed) * 0.1, sc * 2.9, sc * 2.9, 0.78, 2);
    const d1 = layer("shot_photon_stream_diag", -Math.PI / 4 + Math.sin(seed * 1.3) * 0.1, sc * 2.55, sc * 2.55, 0.7, 2);
    const core = layer("shot_photon_core", 0, sc * 1.05, sc * 1.05, 1, 3);

    flicker(glow, 0.32, 0.55, 1100);
    flicker(h0, 0.55, 0.92, 780);
    flicker(h1, 0.4, 0.68, 900);
    flicker(d0, 0.5, 0.8, 650);
    flicker(d1, 0.45, 0.72, 820);
    flicker(core, 0.85, 1, 500);

    return core;
  }

  private static readonly FX_FRAMES = { frames: [0, 1, 2, 3], cycle: false as const };

  /**
   * Attaches a live exhaust trail to the tail of an already-placed, stationary weapon-art
   * image — same fx_flame/fx_smoke/fx_spark textures, tints, and blend modes as the real
   * in-mission exhaust (missionScene's emitShotTrail), but since the art itself never moves,
   * particles are launched backward much faster than their real (near-stationary, world-space)
   * counterparts and stretched into streaks — standing in for the relative motion a flying
   * shot would create, like a rocket on a test stand rather than idle ambient puffs.
   */
  /** Reference projectile speed the base exhaust tunings below assume "normal" pace at. */
  private static readonly EXHAUST_REF_SPEED = 400;

  private attachExhaust(
    img: Phaser.GameObjects.Image,
    origin: { x: number; y: number },
    exhaust: ExhaustTrail,
    weaponSpeed: number
  ): void {
    const scene = this.scene;
    // Nudged further back from the sprite's actual tail so the exhaust (rendered on top,
    // matching the real draw order) doesn't immediately cover the shot shape.
    const tailX = img.x - origin.x * img.displayWidth - 8;
    const tailY = img.y;
    const FX_FRAMES = FieldManual.FX_FRAMES;
    const BACK = { min: 172, max: 188 };
    const smokeTex = scene.textures.exists("fx_smoke_tint") ? "fx_smoke_tint" : "fx_smoke";

    // Faster projectiles get a faster-streaming (and proportionally shorter, so the plume
    // doesn't just get longer) exhaust — same trick as the base speed boost, scaled by how
    // fast this specific weapon actually flies relative to the roster's middle of the road.
    const speedMul = Phaser.Math.Clamp(weaponSpeed / FieldManual.EXHAUST_REF_SPEED, 0.4, 3);
    const lifeMul = Phaser.Math.Clamp(1 / speedMul, 0.45, 2.2);
    const scaleRange = (v: number | { min: number; max: number } | undefined, mul: number) => {
      if (v == null) return v;
      return typeof v === "number" ? v * mul : { min: v.min * mul, max: v.max * mul };
    };
    const emit = (texture: string, config: Phaser.Types.GameObjects.Particles.ParticleEmitterConfig) => {
      const scaled: Phaser.Types.GameObjects.Particles.ParticleEmitterConfig = {
        ...config,
        speed: scaleRange(config.speed as number | { min: number; max: number } | undefined, speedMul),
        lifespan: scaleRange(config.lifespan as number | { min: number; max: number } | undefined, lifeMul),
      };
      this.addDetail(scene.add.particles(tailX, tailY, texture, { emitting: true, ...scaled }));
    };

    if (exhaust.kind === "particles") {
      // Smoke/contrail added first, fire last — container child order is back-to-front, so
      // the flame needs to be the last thing added to render over the smoke, not under it.
      if (exhaust.smoke === "short") {
        emit("fx_smoke", {
          frequency: 34,
          lifespan: { min: 420, max: 620 },
          speed: { min: 26, max: 60 },
          angle: BACK,
          scaleX: { start: 0.32, end: 1.1 },
          scaleY: { start: 0.22, end: 0.6 },
          alpha: { start: 0.5, end: 0 },
          frame: FX_FRAMES,
        });
      } else if (exhaust.smoke === "linger") {
        emit("fx_smoke", {
          frequency: 55,
          lifespan: { min: 1200, max: 1900 },
          speed: { min: 20, max: 46 },
          angle: { min: 165, max: 195 },
          scaleX: { start: 0.32, end: 1.3 },
          scaleY: { start: 0.24, end: 0.8 },
          alpha: { start: 0.8, end: 0 },
          frame: FX_FRAMES,
        });
      } else if (exhaust.smoke === "rocket") {
        emit("fx_smoke", {
          frequency: 32,
          lifespan: { min: 700, max: 1150 },
          speed: { min: 30, max: 66 },
          angle: BACK,
          scaleX: { start: 0.7, end: 2.1 },
          scaleY: { start: 0.14, end: 0.36 },
          alpha: { start: 0.64, end: 0 },
          frame: FX_FRAMES,
        });
      }
      if (exhaust.fire === "burn") {
        emit("fx_flame", {
          frequency: 30,
          lifespan: { min: 200, max: 320 },
          speed: { min: 26, max: 60 },
          angle: BACK,
          scaleX: { start: 0.6, end: 0.08 },
          scaleY: { start: 0.4, end: 0.05 },
          alpha: { start: 1, end: 0 },
          blendMode: "ADD",
          tint: [0xfff4c0, 0xff9a32, 0xff5a18],
          frame: FX_FRAMES,
        });
      } else if (exhaust.fire === "hotFlame") {
        emit("fx_flame", {
          frequency: 26,
          lifespan: { min: 260, max: 400 },
          speed: { min: 34, max: 76 },
          angle: BACK,
          scaleX: { start: 0.4, end: 0.06 },
          scaleY: { start: 0.26, end: 0.04 },
          alpha: { start: 1, end: 0 },
          blendMode: "ADD",
          tint: [0xfff8d8, 0xffc050, 0xff6a22],
          frame: FX_FRAMES,
        });
      } else if (exhaust.fire === "cyanSpark") {
        emit("fx_spark", {
          frequency: 26,
          lifespan: { min: 260, max: 460 },
          speed: { min: 70, max: 160 },
          angle: { min: 150, max: 210 },
          scale: { start: 0.34, end: 0 },
          alpha: { start: 0.95, end: 0 },
          blendMode: "ADD",
          tint: [0xffffff, 0xd8ffff, 0x70e8ff, 0x3ab0ff, 0x1888ff],
          frame: FX_FRAMES,
          rotate: { min: 0, max: 360 },
        });
      }
    } else if (exhaust.kind === "signalFlare") {
      emit(smokeTex, {
        frequency: 46,
        lifespan: { min: 460, max: 760 },
        speed: { min: 22, max: 48 },
        angle: { min: 165, max: 195 },
        scaleX: { start: 0.2, end: 0.7 },
        scaleY: { start: 0.16, end: 0.45 },
        alpha: { start: 0.5, end: 0 },
        tint: [0xffb0c8, 0xff5578, 0xd02048],
        frame: FX_FRAMES,
      });
      emit("fx_flame", {
        frequency: 34,
        lifespan: { min: 300, max: 480 },
        speed: { min: 30, max: 66 },
        angle: { min: 165, max: 195 },
        scaleX: { start: 0.28, end: 0.05 },
        scaleY: { start: 0.2, end: 0.04 },
        alpha: { start: 0.95, end: 0 },
        blendMode: "ADD",
        tint: [0xffe0f0, 0xff6a9a, 0xff2a55, 0xe01040],
        frame: FX_FRAMES,
      });
      emit("fx_spark", {
        frequency: 90,
        lifespan: { min: 80, max: 190 },
        speed: { min: 90, max: 220 },
        angle: { min: 0, max: 360 },
        scale: { start: 0.2, end: 0 },
        alpha: { start: 1, end: 0 },
        blendMode: "ADD",
        tint: [0xffffff, 0xff90b0, 0xff2858],
        frame: FX_FRAMES,
        rotate: { min: 0, max: 360 },
      });
    } else if (exhaust.kind === "energy") {
      this.simulateEnergyRibbon(tailX, tailY, exhaust, speedMul);
      // Warp bomb only — the catalog's warpMotes flag layers a fine purple mote trail plus
      // occasional bigger orbs over the ribbon (missionScene's warpTrail/warpOrb emitters).
      if (exhaust.warpMotes) {
        emit("fx_spark", {
          frequency: 40,
          lifespan: { min: 500, max: 900 },
          speed: { min: 10, max: 50 },
          angle: { min: 0, max: 360 },
          scale: { start: 0.34, end: 0 },
          alpha: { start: 0.9, end: 0 },
          blendMode: "ADD",
          tint: [0xffffff, 0xf0c8ff, 0xc86cff, 0x8a3cff],
          frame: FX_FRAMES,
          rotate: { min: 0, max: 360 },
        });
        emit("fx_spark", {
          frequency: 140,
          lifespan: { min: 300, max: 550 },
          speed: { min: 14, max: 70 },
          angle: { min: 0, max: 360 },
          scale: { start: 0.5, end: 0 },
          alpha: { start: 1, end: 0 },
          blendMode: "ADD",
          tint: [0xffffff, 0xf4d8ff, 0xe090ff, 0xb050ff],
          frame: FX_FRAMES,
          rotate: { min: 0, max: 360 },
        });
      }
    }
  }

  private static readonly ENERGY_HUE_LAYERS: Record<"cyan" | "green" | "magenta", readonly [number, number, number][]> = {
    cyan: [
      [3.6, 0x1a58ff, 0.2],
      [1.7, 0x3ad8ff, 0.48],
      [0.85, 0xffffff, 0.92],
    ],
    green: [
      [3.1, 0x1a6a22, 0.22],
      [1.55, 0x55ee44, 0.52],
      [0.72, 0xeaffc8, 0.95],
    ],
    magenta: [
      [3.6, 0x6a18ff, 0.22],
      [1.7, 0xc86cff, 0.52],
      [0.85, 0xf8e8ff, 0.95],
    ],
  };

  /**
   * TOW-style command wire preview: a gently swaying twisted-wire line (same dark-strand +
   * light-highlight double stroke as missionScene's drawTowWires) trailing left from the
   * shot's tail and fading out, rather than a real sagging line to a launch point — there's
   * nothing to connect to in a static preview, just a hint of "this one has a guide wire".
   */
  private buildTowWirePreview(tailX: number, tailY: number): void {
    const scene = this.scene;
    const g = scene.add.graphics();
    this.addDetail(g);
    const length = 120;
    const segments = 16;

    const tick = (time: number) => {
      if (!g.scene) {
        scene.events.off(Phaser.Scenes.Events.UPDATE, tick);
        return;
      }
      const t = time * 0.001;
      const pts: { x: number; y: number }[] = [];
      for (let i = 0; i <= segments; i++) {
        const u = i / segments;
        const x = tailX - u * length;
        // Amplitude grows toward the far end, like a loose wire whipping gently — anchored
        // (no sway) right at the tail.
        const sway = (Math.sin(t * 1.6 + u * 3.2) * 2.6 + Math.sin(t * 0.7 - u * 1.1) * 1.3) * u;
        pts.push({ x, y: tailY + sway });
      }
      g.clear();
      for (let i = 0; i < segments; i++) {
        const fade = 1 - i / segments;
        g.lineStyle(1.35, 0x3a382e, 0.5 * fade);
        g.beginPath();
        g.moveTo(pts[i]!.x, pts[i]!.y);
        g.lineTo(pts[i + 1]!.x, pts[i + 1]!.y);
        g.strokePath();
        g.lineStyle(0.85, 0xe8e0c8, 0.8 * fade);
        g.beginPath();
        g.moveTo(pts[i]!.x, pts[i]!.y - 0.55);
        g.lineTo(pts[i + 1]!.x, pts[i + 1]!.y - 0.55);
        g.strokePath();
      }
    };
    scene.events.on(Phaser.Scenes.Events.UPDATE, tick);
  }

  /**
   * A live, self-updating version of the real energy trail (missionScene's ageEnergyTrail /
   * drawEnergyRibbon): nodes spawn at the tail with a random backward kick, drift and decay
   * under drag, and get drawn as a 3-layer (dim wide → bright thin) ribbon whose thickness and
   * alpha both fall off with node age — same jitter-and-fade-in-thickness look, just spawned
   * from a fixed point instead of a moving shot. Ticks on the scene's UPDATE event and detaches
   * itself once its Graphics object is destroyed (by the next clearDetail()).
   */
  private simulateEnergyRibbon(tailX: number, tailY: number, exhaust: Extract<ExhaustTrail, { kind: "energy" }>, speedMul: number): void {
    const scene = this.scene;
    const hue = exhaust.hue ?? "cyan";
    const layers = FieldManual.ENERGY_HUE_LAYERS[hue];
    const ribbonCount = Math.max(1, exhaust.ribbons ?? 1);
    // Shorter-lived than the real (moving-shot) node life, and much less drag — in-mission the
    // shot outruns its own nearly-stationary nodes, which is what spaces the ribbon out; here
    // the spawn point never moves, so nodes themselves have to keep drifting outward or they'd
    // just decelerate to a stop and pile up on top of newly-spawned ones at the tail.
    const nodeLife = 1.3 / Math.max(0.5, speedMul);
    const g = scene.add.graphics().setBlendMode(Phaser.BlendModes.ADD);
    this.addDetail(g);

    type Node = { x: number; y: number; bx: number; by: number; life: number };
    const trails: Node[][] = Array.from({ length: ribbonCount }, () => []);
    const spawnEvery = 0.04;
    let spawnAcc = 0;

    const tick = (_time: number, deltaMs: number) => {
      if (!g.scene) {
        scene.events.off(Phaser.Scenes.Events.UPDATE, tick);
        return;
      }
      const dt = Math.min(0.05, deltaMs / 1000);
      spawnAcc += dt;
      while (spawnAcc > spawnEvery) {
        spawnAcc -= spawnEvery;
        trails.forEach((trail, i) => {
          const rel = ribbonCount > 1 ? i - (ribbonCount - 1) / 2 : 0;
          // Spread laterally, and stagger the outer ribbons further back along the emit axis
          // so they fan out from behind the nose instead of a flat perpendicular line.
          const side = rel * 5;
          const backOffset = Math.abs(rel) * 3.5;
          // Soft rear cone (not a single reverse ray) so the ribbon braids instead of pulsing.
          const a = Math.PI + (Math.random() - 0.5) * 0.7;
          const kick = (45 + Math.random() * 30) * speedMul;
          trail.push({ x: tailX - backOffset, y: tailY + side, bx: Math.cos(a) * kick, by: Math.sin(a) * kick, life: nodeLife });
        });
      }
      const drag = Math.pow(0.42, dt);
      for (const trail of trails) {
        for (const n of trail) {
          n.x += n.bx * dt;
          n.y += n.by * dt;
          n.bx *= drag;
          n.by *= drag;
          n.life -= dt;
        }
        let w = 0;
        for (const n of trail) if (n.life > 0) trail[w++] = n;
        trail.length = w;
      }

      g.clear();
      for (const trail of trails) {
        if (trail.length < 2) continue;
        for (const [widthMul, color, alphaBase] of layers) {
          for (let i = 0; i < trail.length - 1; i++) {
            const age = Phaser.Math.Clamp(1 - (trail[i]!.life + trail[i + 1]!.life) / (2 * nodeLife), 0, 1);
            const thick = Phaser.Math.Linear(2.2, 0.3, Math.pow(age, 0.85)) * widthMul;
            g.lineStyle(thick, color, alphaBase * Phaser.Math.Linear(1, 0.12, age));
            g.beginPath();
            g.moveTo(trail[i]!.x, trail[i]!.y);
            g.lineTo(trail[i + 1]!.x, trail[i + 1]!.y);
            g.strokePath();
          }
        }
      }
    };
    scene.events.on(Phaser.Scenes.Events.UPDATE, tick);
  }

  /**
   * One stat's distribution across the whole roster as a narrow column: a bar per craft
   * (sorted ascending), this craft's bar picked out in amber, and a line at the fleet average.
   */
  private buildRankChartCol(x0: number, y0: number, colW: number, chartH: number, label: string, valueText: string, points: number[], curIdx: number): number {
    const scene = this.scene;
    const cx = x0 + colW / 2;
    this.addDetail(scene.add.text(cx, y0, label, { fontFamily: MONO, fontSize: "9px", color: CREAM }).setOrigin(0.5, 0));
    this.addDetail(scene.add.text(cx, y0 + 12, valueText, { fontFamily: MONO, fontSize: "10px", color: "#f2d579" }).setOrigin(0.5, 0));
    const barsY = y0 + 28;
    const bx0 = x0 + 4;
    const chartW = colW - 8;
    const max = Math.max(...points, 0.0001);
    const avg = points.reduce((s, v) => s + v, 0) / points.length;
    const n = Math.max(1, points.length);
    const gap = 1;
    const barW = Math.max(1, (chartW - (n - 1) * gap) / n);
    const g = this.addDetail(scene.add.graphics());
    g.fillStyle(0x1b1710, 0.6).fillRect(bx0, barsY, chartW, chartH);
    points.forEach((v, i) => {
      const h = Math.max(1, (v / max) * chartH);
      const x = bx0 + i * (barW + gap);
      const isCurrent = i === curIdx;
      g.fillStyle(isCurrent ? AMBER_N : 0x574f3c, isCurrent ? 1 : 0.85);
      g.fillRect(x, barsY + (chartH - h), barW, h);
    });
    const avgY = barsY + (chartH - (avg / max) * chartH);
    g.lineStyle(1, 0x5ec8ff, 0.9).lineBetween(bx0, avgY, bx0 + chartW, avgY);
    return barsY + chartH;
  }

  /** A single bar split into proportional air/vehicle/building/troop segments, with a legend. */
  private buildClassBar(y0: number, values: Record<UnitClass, number>, formatValue: (v: number) => string): number {
    const scene = this.scene;
    const barH = 14;
    const gap = 2;
    const sum = UNIT_CLASSES.reduce((s, c) => s + Math.max(0, values[c]), 0) || 1;
    const g = this.addDetail(scene.add.graphics());
    let x = this.rightX0;
    for (const cls of UNIT_CLASSES) {
      const w = Math.max(2, (Math.max(0, values[cls]) / sum) * this.rightW - gap);
      g.fillStyle(CLASS_COLOR[cls], 0.92);
      g.fillRoundedRect(x, y0, w, barH, 3);
      x += w + gap;
    }
    const legendY = y0 + barH + 8;
    const legendW = this.rightW / 4;
    UNIT_CLASSES.forEach((cls, i) => {
      const lx = this.rightX0 + i * legendW;
      this.addDetail(scene.add.rectangle(lx, legendY + 4, 8, 8, CLASS_COLOR[cls]).setOrigin(0, 0.5));
      this.addDetail(
        scene.add
          .text(lx + 12, legendY, `${CLASS_LABEL[cls]}\n${formatValue(values[cls])}`, {
            fontFamily: MONO,
            fontSize: "9px",
            color: CREAM,
            lineSpacing: 2,
          })
          .setOrigin(0, 0)
      );
    });
    return legendY + 26;
  }

  private buildStatComparison(y0: number): number {
    const craft = this.previewCraft;
    const all = allCrafts();
    const fp = craftFirepowerWithRemotes(craft);
    const fpByKind = new Map(all.map((c) => [c.kind, craftFirepowerWithRemotes(c).total]));

    this.addDetail(this.scene.add.rectangle(this.rightX0, y0 + 4, 8, 8, AMBER_N).setOrigin(0, 0.5));
    this.addDetail(
      this.scene.add.text(this.rightX0 + 12, y0, "THIS CRAFT", { fontFamily: MONO, fontSize: "9px", color: DIM }).setOrigin(0, 0)
    );
    this.addDetail(this.scene.add.rectangle(this.rightX0 + 90, y0 + 4, 12, 2, 0x5ec8ff).setOrigin(0, 0.5));
    this.addDetail(
      this.scene.add.text(this.rightX0 + 106, y0, "FLEET AVERAGE", { fontFamily: MONO, fontSize: "9px", color: DIM }).setOrigin(0, 0)
    );
    y0 += 20;

    // Five stats laid out as columns (not stacked rows) — bars sorted ascending so the
    // highlighted bar's position within its column reads as an at-a-glance rank.
    type Col = { label: string; valueText: string; valueOf: (c: (typeof all)[number]) => number };
    const cols: Col[] = [
      { label: "SPEED", valueText: `${Math.round(craft.maxSpeed)}`, valueOf: (c) => c.maxSpeed },
      { label: "AGILITY", valueText: craftAgility(craft).toFixed(2), valueOf: (c) => craftAgility(c) },
      { label: "SIZE", valueText: `${Math.round(craft.sizeM)}m`, valueOf: (c) => c.sizeM },
      { label: "ARMOR", valueText: `${Math.round(craft.health)}`, valueOf: (c) => c.health },
      { label: "FIREPOWER", valueText: `${Math.round(fp.total)}`, valueOf: (c) => fpByKind.get(c.kind)! },
    ];
    const colW = this.rightW / cols.length;
    const chartH = 68;
    let bottom = y0;
    cols.forEach((col, i) => {
      const sorted = [...all].sort((a, b) => col.valueOf(a) - col.valueOf(b));
      const idx = sorted.findIndex((c) => c.kind === craft.kind);
      const x0 = this.rightX0 + i * colW;
      bottom = Math.max(
        bottom,
        this.buildRankChartCol(x0, y0, colW, chartH, col.label, col.valueText, sorted.map(col.valueOf), idx)
      );
    });
    y0 = bottom + 16;

    this.addDetail(
      this.scene.add.text(this.rightX0, y0, "FIREPOWER BY CLASS", { fontFamily: MONO, fontSize: "10px", color: "#aaa28f" }).setOrigin(0, 0)
    );
    y0 += 16;
    y0 = this.buildClassBar(y0, fp.byClass, (v) => Math.round(v).toString());
    return y0;
  }

  private buildWeaponDetail(y0: number, slot: number): number {
    const scene = this.scene;
    const craft = this.previewCraft;
    const weapons = playerLoadoutFromSockets(craft.sockets);
    const weapon = weapons[slot];
    if (!weapon) return y0;
    const id = wpnIdOf(weapon);
    const socket = craft.sockets[slot];
    const isGun = socket?.class === "turret" || socket?.class === "fixed";
    const gunTex = socket ? socket.gunTex ?? weaponMountTex(socket.weapon) : undefined;

    const nameText = this.addDetail(
      scene.add
        .text(this.rightX0 + this.rightW / 2, y0, weapon.fullName, {
          fontFamily: "Black Ops One, Impact, sans-serif",
          fontSize: "14px",
          color: "#f2d579",
          align: "center",
          wordWrap: { width: this.rightW },
        })
        .setOrigin(0.5, 0)
    );

    // Classification tags as framed chips, centered right under the name.
    let y = y0 + nameText.height + 8;
    const favorite = this.career().favoriteWeapon === id;
    y = this.buildBadgeChips(favorite ? [FAVORITE_WEAPON, ...weaponBadges(id)] : weaponBadges(id), y, "center", [FAVORITE_WEAPON]) + 14;

    // A remote-deploy weapon launches a craft, not a shot — show that craft's hull, not the
    // launcher's (unrelated) projectile art.
    const remoteSpec = weapon.payload.remote ? remoteSpecOf(weapon.payload.remote.kind) : undefined;

    // Rendered at native size (no upscale) — small sprites should look crisp, not blurry.
    const tex = isGun && gunTex ? gunTex : remoteSpec ? remoteSpec.body : weapon.art.look;
    const cluster = weapon.payload.cluster;
    // Guns don't get an exhaust preview — the field's really a shot-in-flight trail.
    const exhaustForPreview = isGun ? undefined : weapon.exhaust;
    const origin =
      isGun && gunTex
        ? spritePivot(tex)
        : remoteSpec
          ? craftComposite(remoteSpec).body.origin
          : SHOT_ORIGIN;
    const mainScale = isGun || remoteSpec ? 1 : weapon.art.scale;
    const mainTint = !isGun && !remoteSpec ? weapon.art.tint : undefined;
    if (remoteSpec) {
      // It's a launched craft, not a static shot — the full preview system (body + rotors +
      // guns + exhaust glow), same as the main craft preview and menu carousel, not just the hull sprite.
      const body = scene.add.image(this.rightX0 + this.rightW / 2, y + 34, remoteSpec.body).setOrigin(0.5, 0.5);
      const fit = craftPreviewFitScale(body.width, body.height, 150, 66);
      body.setScale(fit);
      // In-mission a remote's hull draws at spec.scale × zoom but its gun at craftGunScale ×
      // zoom alone — the gun is craftGunScale / spec.scale of the hull. Divide by the
      // remote's scale here to keep that same ratio in the preview.
      const gunOverride = remoteSpec
        ? { tex: craftGunTex(remoteSpec), scale: craftGunScale(remoteSpec), hullScale: remoteSpec.scale }
        : undefined;
      const overlay = buildCraftPreviewOverlay(scene, body, remoteSpec, gunOverride ? { gun: gunOverride } : undefined);
      overlay.below.forEach((p) => this.addDetail(p));
      this.addDetail(body);
      overlay.above.forEach((p) => this.addDetail(p));
      y += 76;
    } else if (tex === "shot_photon" && scene.textures.exists("shot_photon_core")) {
      // Photon/Warp shots aren't a static sprite in-mission — the body is hidden and a
      // composited additive lens-flare (glow + streak spokes + core) is drawn instead.
      // `shot_photon` itself is just a baked alias of the core layer, so rendering it plainly
      // (like every other weapon's art) would show a small dot with none of that.
      const cx = this.rightX0 + this.rightW / 2;
      const cy = y + 34;
      const core = this.buildPhotonFlare(cx, cy, mainTint);
      if (core && exhaustForPreview) this.attachExhaust(core, { x: 0.5, y: 0.5 }, exhaustForPreview, weapon.speed);
      y += 76;
    } else if (scene.textures.exists(tex)) {
      if (cluster && scene.textures.exists(cluster.look)) {
        y = this.buildClusterRow(y, tex, origin, mainScale, mainTint, cluster.look, cluster.bomblets, exhaustForPreview, weapon.speed);
      } else {
        const img = scene.add.image(this.rightX0 + this.rightW / 2, y + 34, tex).setOrigin(origin.x, origin.y);
        if (mainTint != null) img.setTint(mainTint);
        const fit = craftPreviewFitScale(img.width, img.height, 150, 66);
        img.setScale(fit * mainScale);
        this.addDetail(img);
        if (exhaustForPreview) this.attachExhaust(img, origin, exhaustForPreview, weapon.speed);
        if (weapon.guidance?.wire) this.buildTowWirePreview(img.x - origin.x * img.displayWidth - 8, img.y);
        y += 76;
      }
    }

    // A remote-deploy weapon's own description is usually just controls ("Q recalls...") — fall
    // back to the deployed hull's flavor description, which is what actually sells the unit.
    const description = weapon.description ?? remoteSpec?.description;
    if (description) {
      const desc = this.addDetail(
        scene.add
          .text(this.rightX0 + this.rightW / 2, y, description, {
            fontFamily: MONO,
            fontSize: "11px",
            color: CREAM,
            align: "center",
            lineSpacing: 3,
            wordWrap: { width: this.rightW },
          })
          .setOrigin(0.5, 0)
      );
      y += desc.height + 14;
    }

    // Automatic stations aren't idle when you're not aiming them — crew fire them on their own
    // whenever they're not your currently-selected weapon.
    if (socket?.controller === "automatic") {
      const crewParts = craftLoadoutParts(craft, slot, weapon.fullName);
      const role = crewParts.crew?.replace(/^\s*·\s*/, "") ?? "CREW";
      const note = this.addDetail(
        scene.add
          .text(this.rightX0 + this.rightW / 2, y, `${role} — fires automatically when not your active weapon`, {
            fontFamily: MONO,
            fontSize: "10px",
            color: "#8ec8e8",
            align: "center",
            lineSpacing: 3,
            wordWrap: { width: this.rightW },
          })
          .setOrigin(0.5, 0)
      );
      y += note.height + 14;
    }

    // A remote-deploy weapon is a launched craft, not a shot with damage/rate/DPS stats —
    // show the remote's own airframe stats and loadout instead.
    if (remoteSpec) {
      return this.buildRemoteDetail(y, remoteSpec);
    }

    // Stats appropriate to the weapon's delivery type, in the same rank-chart language as the
    // craft stat comparison: a bar per weapon in the roster, this one picked out, fleet average line.
    this.addDetail(scene.add.rectangle(this.rightX0, y + 4, 8, 8, AMBER_N).setOrigin(0, 0.5));
    this.addDetail(scene.add.text(this.rightX0 + 12, y, "THIS WEAPON", { fontFamily: MONO, fontSize: "9px", color: DIM }).setOrigin(0, 0));
    this.addDetail(scene.add.rectangle(this.rightX0 + 96, y + 4, 12, 2, 0x5ec8ff).setOrigin(0, 0.5));
    this.addDetail(
      scene.add
        .text(this.rightX0 + 112, y, isGun ? "GUN AVERAGE" : "ORDNANCE AVERAGE", { fontFamily: MONO, fontSize: "9px", color: DIM })
        .setOrigin(0, 0)
    );
    y += 18;

    const statCols = weaponStatCols(weapon, craft, slot);
    const statColW = this.rightW / statCols.length;
    const statChartH = 40;
    let statsBottom = y;
    statCols.forEach((col, i) => {
      const x0 = this.rightX0 + i * statColW;
      statsBottom = Math.max(
        statsBottom,
        this.buildRankChartCol(x0, y, statColW, statChartH, col.label, col.valueText, col.points, col.curIdx)
      );
    });
    y = statsBottom + 16;

    this.addDetail(
      scene.add.text(this.rightX0, y, "DAMAGE FOCUS", { fontFamily: MONO, fontSize: "10px", color: "#aaa28f" }).setOrigin(0, 0.5)
    );
    y += 16;
    const muls = Object.fromEntries(UNIT_CLASSES.map((cls) => [cls, playerWeaponClassMul(weapon, cls)])) as Record<UnitClass, number>;
    return this.buildClassBar(y, muls, (v) => `${v.toFixed(2)}×`);
  }

  /**
   * Remote-deploy detail: the remote's own airframe stats — graded on the exact same
   * three-region scale as the player craft roster (`syncCraft`'s own stat bars), so a Skiff and
   * an Apache read on one consistent ruler. The scale itself is still derived purely from
   * `allCrafts()`, though — a remote's own value is only ever normed against it, never folded
   * into the pool, so a tiny drone can't compress or skew where the real craft land — where
   * weapon stats would normally go, and a loadout table (one column per onboard weapon, plus a
   * countermeasure column when it has one) where the damage-focus class bar would normally go.
   */
  private buildRemoteDetail(y0: number, spec: RemoteSpec): number {
    const scene = this.scene;
    let y = y0;

    // Same label+segmented-bar style as the left column's own craft stats (not the comparative
    // rank-chart used for STAT COMPARISON / weapon columns) — a remote is a small airframe, not
    // a stat to rank, so a plain proportional read fits better here.
    this.addDetail(
      scene.add.text(this.rightX0, y, "REMOTE PROFILE", { fontFamily: MONO, fontSize: "10px", color: "#aaa28f" }).setOrigin(0, 0.5)
    );
    y += 18;

    const allCraftsList = allCrafts();
    const stats = [
      { label: "SPEED", value: spec.maxSpeed, values: allCraftsList.map((c) => c.maxSpeed) },
      { label: "AGILITY", value: craftAgility(spec), values: allCraftsList.map((c) => craftAgility(c)) },
      { label: "SIZE", value: spec.sizeM, values: allCraftsList.map((c) => c.sizeM) },
      { label: "ARMOR", value: spec.health, values: allCraftsList.map((c) => c.health) },
    ];
    const labelX = this.rightX0;
    const barX = this.rightX0 + 90;
    const rowH = 15;
    const segments = 10;
    const bars = scene.add.graphics();
    this.addDetail(bars);
    stats.forEach((stat, i) => {
      const sy = y + i * rowH;
      this.addDetail(scene.add.text(labelX, sy, stat.label, { fontFamily: MONO, fontSize: "10px", color: CREAM }).setOrigin(0, 0.5));
      drawThreeRegionBar(bars, barX, sy, stat.value, computeThreeRegionScale(stat.values), {
        segW: 8,
        segments,
        segGap: 2,
      });
    });
    const roleY = y + stats.length * rowH + 4;
    this.addDetail(scene.add.text(labelX, roleY, "ROLE", { fontFamily: MONO, fontSize: "10px", color: CREAM }).setOrigin(0, 0.5));
    this.addDetail(
      scene.add.text(barX, roleY, spec.role.toUpperCase(), { fontFamily: MONO, fontSize: "10px", color: "#f2d579" }).setOrigin(0, 0.5)
    );
    y = roleY + rowH + 8;

    const weapons = playerLoadoutFromSockets(spec.sockets);
    const cm = spec.countermeasure ? COUNTERMEASURES[craftCountermeasure(spec.countermeasure)] : undefined;
    const colCount = weapons.length + (cm ? 1 : 0);
    if (colCount === 0) return y;

    this.addDetail(scene.add.text(this.rightX0, y, "LOADOUT", { fontFamily: MONO, fontSize: "10px", color: "#aaa28f" }).setOrigin(0, 0.5));
    y += 16;

    // A dedicated gutter for the row labels (DMG/RATE/...) so they never share horizontal space
    // with column 0 — everything column-related (header and stat rows alike) starts after it.
    const labelW = 34;
    const tableX0 = this.rightX0 + labelW;
    const tableW = this.rightW - labelW;
    const tableColW = tableW / colCount;
    // Same same-type-only ranking rule as the main weapon detail's stat comparison (guns only
    // rank against guns, ordnance only against ordnance).
    const allWpns = Object.values(PLAYER_WPNS) as PlayerWpnSpec[];
    const isGunWpn = (w: PlayerWpnSpec) => w.fits.includes("turret") || w.fits.includes("fixed");
    const rankOf = (weapon: PlayerWpnSpec, valueOf: (w: PlayerWpnSpec) => number, thisValue: number, pool?: PlayerWpnSpec[]) => {
      const bucket = pool ?? allWpns.filter((w) => isGunWpn(w) === isGunWpn(weapon));
      const entries = bucket.map((w) => ({ isCur: w.id === weapon.id, value: w.id === weapon.id ? thisValue : valueOf(w) }));
      entries.sort((a, b) => a.value - b.value);
      return { points: entries.map((e) => e.value), curIdx: entries.findIndex((e) => e.isCur) };
    };

    type StatCell = { text: string; points?: number[]; curIdx?: number };
    type TableCol = {
      icon?: string;
      iconOrigin: { x: number; y: number };
      name: string;
      nameColor: string;
      valueColor: string;
      rows: StatCell[];
    };
    const table: TableCol[] = weapons.map((w, i) => {
      const socket = spec.sockets[i];
      const isGunSocket = socket?.class === "turret" || socket?.class === "fixed";
      const gTex = socket ? socket.gunTex ?? weaponMountTex(socket.weapon) : undefined;
      const icon = isGunSocket && gTex ? gTex : w.art.look;
      const iconOrigin = isGunSocket && gTex ? spritePivot(icon) : SHOT_ORIGIN;
      const mountMul = craftSocketFireStreams(spec, i) * (socket?.fireRateMul ?? 1);
      // Per-barrel cadence, not multiplied by mount streams — DPS is where multi-barrel output shows up.
      const rofOf = (ww: PlayerWpnSpec) => 1 / Math.max(0.001, ww.fireCd);
      const thisDps = playerWeaponDps(w) * mountMul;
      const capacity = craftSocketStartingAmmo(w.ammo, spec, i);
      const dmgRank = rankOf(w, (ww) => ww.dmg, w.dmg);
      const rofRank = rankOf(w, rofOf, rofOf(w));
      const dpsRank = rankOf(w, playerWeaponDps, thisDps);
      // Finite-ammo weapons only — ranking against ∞ ammo would be meaningless — falling back
      // to the full bucket if this type has no finite-ammo weapons at all.
      const ammoBucket = allWpns.filter((ww) => isGunWpn(ww) === isGunWpn(w));
      const ammoPool = ammoBucket.filter((ww) => Number.isFinite(ww.ammo));
      const ammoRank = Number.isFinite(capacity) ? rankOf(w, (ww) => ww.ammo, capacity, ammoPool.length ? ammoPool : ammoBucket) : undefined;
      return {
        icon: scene.textures.exists(icon) ? icon : undefined,
        iconOrigin,
        name: w.name,
        nameColor: CREAM,
        valueColor: "#f2d579",
        rows: [
          { text: Math.round(w.dmg).toString(), points: dmgRank.points, curIdx: dmgRank.curIdx },
          { text: `${rofOf(w).toFixed(1)}/s`, points: rofRank.points, curIdx: rofRank.curIdx },
          { text: Math.round(thisDps).toString(), points: dpsRank.points, curIdx: dpsRank.curIdx },
          { text: capacity === Infinity ? "∞" : String(capacity), points: ammoRank?.points, curIdx: ammoRank?.curIdx },
        ],
      };
    });
    if (cm) {
      // Countermeasure standard styling (matches the loadout row and its own detail panel):
      // "#7ad0ff" name, "#8ec8e8" values — and DUR/CD as two short values, not one long string
      // crammed into a numeric cell's narrow slot (that was wrapping and overlapping the row above).
      const fmtSeconds = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)}s`;
      table.push({
        iconOrigin: SHOT_ORIGIN,
        name: cm.name,
        nameColor: "#7ad0ff",
        valueColor: "#8ec8e8",
        rows: [{ text: fmtSeconds(cm.duration) }, { text: `${fmtSeconds(cm.cooldown)} CD` }, { text: "" }, { text: "" }],
      });
    }

    // Header: weapon art (when it has one — countermeasures don't) + name, no slot key.
    const iconSize = 20;
    table.forEach((col, i) => {
      const x = tableX0 + i * tableColW + tableColW / 2;
      if (col.icon) {
        const img = scene.add.image(x, y + iconSize / 2, col.icon).setOrigin(col.iconOrigin.x, col.iconOrigin.y);
        img.setScale(craftPreviewFitScale(img.width, img.height, iconSize, iconSize));
        this.addDetail(img);
      }
      this.addDetail(
        scene.add
          .text(x, y + iconSize + 3, col.name, { fontFamily: MONO, fontSize: "8px", color: col.nameColor, align: "center", wordWrap: { width: tableColW - 6 } })
          .setOrigin(0.5, 0)
      );
    });
    y += iconSize + 3 + 22;

    const divider = scene.add.graphics();
    divider.lineStyle(1, 0x4a4436, 0.6).lineBetween(this.rightX0, y, this.rightX0 + this.rightW, y);
    this.addDetail(divider);
    y += 6;

    // Each numeric cell gets a small progress bar (this value vs. the bucket's highest)
    // immediately left of its value — the pair centered under the column's header, matching it.
    const rowLabels = ["DMG", "RATE", "DPS", "AMMO"];
    const chartW = Math.min(22, tableColW * 0.3);
    const chartH = 6;
    const valueW = 30;
    const groupGap = 4;
    rowLabels.forEach((label, r) => {
      this.addDetail(scene.add.text(this.rightX0, y, label, { fontFamily: MONO, fontSize: "8px", color: DIM }).setOrigin(0, 0.5));
      table.forEach((col, i) => {
        const cell = col.rows[r];
        if (!cell) return;
        const colCenter = tableX0 + i * tableColW + tableColW / 2;
        const hasChart = !!cell.points && cell.points.length > 1 && cell.curIdx != null && cell.curIdx >= 0;
        const groupW = hasChart ? chartW + groupGap + valueW : valueW;
        const groupX0 = colCenter - groupW / 2;
        if (hasChart) this.buildMicroProgress(groupX0, y - chartH / 2, chartW, chartH, cell.points!, cell.curIdx!);
        const textX = hasChart ? groupX0 + chartW + groupGap : groupX0;
        this.addDetail(
          scene.add
            .text(textX, y, cell.text, { fontFamily: MONO, fontSize: "9px", color: col.valueColor, align: "left", wordWrap: { width: valueW + 6 } })
            .setOrigin(0, 0.5)
        );
      });
      y += 14;
    });

    return y + 8;
  }

  /** A single small track+fill bar — this value as a fraction of the bucket's highest. */
  private buildMicroProgress(x: number, y: number, w: number, h: number, points: number[], curIdx: number): void {
    const scene = this.scene;
    const g = scene.add.graphics();
    this.addDetail(g);
    if (points.length === 0 || curIdx < 0) return;
    const max = Math.max(...points, 0.0001);
    const value = points[curIdx]!;
    const frac = Phaser.Math.Clamp(value / max, 0, 1);
    g.fillStyle(DIM_N, 0.5);
    g.fillRoundedRect(x, y, w, h, h / 2);
    if (frac > 0) {
      g.fillStyle(AMBER_N, 0.95);
      g.fillRoundedRect(x, y, Math.max(h, w * frac), h, h / 2);
    }
  }

  private buildCmDetail(y0: number): number {
    const scene = this.scene;
    const craft = this.previewCraft;
    const id = craftCountermeasure(craft.countermeasure);
    const cm = COUNTERMEASURES[id];
    this.addDetail(
      scene.add
        .text(this.rightX0 + this.rightW / 2, y0, cm.name, {
          fontFamily: "Black Ops One, Impact, sans-serif",
          fontSize: "14px",
          color: "#f2d579",
          align: "center",
        })
        .setOrigin(0.5, 0)
    );
    const previewY = y0 + 46;
    this.buildCmPreview(this.rightX0 + this.rightW / 2, previewY, id);
    const descY = previewY + 44;
    const desc = this.addDetail(
      scene.add
        .text(this.rightX0 + this.rightW / 2, descY, cmDescription(id), {
          fontFamily: MONO,
          fontSize: "12px",
          color: CREAM,
          align: "center",
          lineSpacing: 4,
          wordWrap: { width: this.rightW },
        })
        .setOrigin(0.5, 0)
    );
    const timingY = descY + desc.height + 16;
    this.addDetail(
      scene.add
        .text(this.rightX0 + this.rightW / 2, timingY, cmTimingFullText(cm), {
          fontFamily: MONO,
          fontSize: "11px",
          color: "#8ec8e8",
          align: "center",
          wordWrap: { width: this.rightW },
        })
        .setOrigin(0.5, 0)
    );
    return timingY + 16;
  }

  /** Dispatches to a small looping preview of this countermeasure's real in-mission effect. */
  private buildCmPreview(cx: number, cy: number, id: CountermeasureId): void {
    switch (id) {
      case "flares":
        this.buildFlarePreview(cx, cy);
        break;
      case "timewarp":
        this.buildTimewarpPreview(cx, cy);
        break;
      case "phase_cloak":
        this.buildCloakPreview(cx, cy);
        break;
      case "emp":
        this.buildEmpPreview(cx, cy);
        break;
      case "reactive_armor":
        this.buildReactiveArmorPreview(cx, cy);
        break;
      case "smoke_screen":
        this.buildSmokeScreenPreview(cx, cy);
        break;
    }
  }

  /**
   * Mission flare look in miniature (countermeasures.drawFlares): salvos fanning out both sides, each flare a
   * flickering glow head with a tapering white-hot → orange streak and a sparse drip of sparks.
   */
  private buildFlarePreview(cx: number, cy: number): void {
    const scene = this.scene;
    ensureImpactGlow(scene.textures);
    const g = scene.add.graphics().setBlendMode(Phaser.BlendModes.ADD);
    this.addDetail(g);
    const drip = scene.add.particles(0, 0, "fx_spark", {
      lifespan: { min: 380, max: 620 },
      speed: { min: 4, max: 18 },
      scale: { start: 0.32, end: 0 },
      alpha: { start: 0.95, end: 0 },
      blendMode: "ADD",
      tint: [0xfff8d0, 0xffee66, 0xffaa40, 0xff6a18],
      gravityY: 30,
      frame: FieldManual.FX_FRAMES,
      rotate: { min: 0, max: 360 },
      emitting: false,
    });
    this.addDetail(drip);
    type PFlare = { x: number; y: number; vx: number; vy: number; age: number; life: number; hist: { x: number; y: number }[]; head: Phaser.GameObjects.Image };
    const flares: PFlare[] = [];
    const LIFE = 1.5;
    const HIST = 14;
    let last = -Infinity;
    let prev = -1;
    const launch = () => {
      for (let i = 0; i < 6; i++) {
        const side = i < 3 ? -1 : 1;
        const ang = (side < 0 ? Math.PI : 0) + (Math.random() - 0.5) * 0.9 - 0.35;
        const spd = 70 + Math.random() * 50;
        const head = scene.add.image(cx, cy, "fx_glow").setBlendMode(Phaser.BlendModes.ADD).setTint(0xfff0c0);
        this.addDetail(head);
        flares.push({ x: cx, y: cy, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd, age: 0, life: LIFE * (0.85 + Math.random() * 0.3), hist: [], head });
      }
    };
    const tick = (time: number) => {
      if (!g.scene) {
        scene.events.off(Phaser.Scenes.Events.UPDATE, tick);
        return;
      }
      const dt = prev < 0 ? 0 : Math.min(0.05, (time - prev) / 1000);
      prev = time;
      if (time - last >= 1700) {
        last = time;
        launch();
      }
      g.clear();
      let w = 0;
      for (let k = 0; k < flares.length; k++) {
        const f = flares[k]!;
        f.age += dt;
        if (f.age >= f.life) {
          f.head.destroy();
          continue;
        }
        f.vx *= Math.pow(0.4, dt);
        f.vy = f.vy * Math.pow(0.4, dt) + 22 * dt;
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        f.hist.push({ x: f.x, y: f.y });
        if (f.hist.length > HIST) f.hist.shift();
        const burn = 1 - f.age / f.life;
        // Streak: newest segment brightest and widest.
        let px = f.x;
        let py = f.y;
        for (let h = f.hist.length - 1; h >= 0; h--) {
          const p = f.hist[h]!;
          const u = (f.hist.length - 1 - h) / HIST;
          const fade = (1 - u) * (1 - u) * burn;
          g.lineStyle(Math.max(0.6, 2.2 - 1.6 * u), u < 0.25 ? 0xfff2c0 : u < 0.55 ? 0xffb347 : 0xff6a1c, 0.85 * fade);
          g.lineBetween(px, py, p.x, p.y);
          px = p.x;
          py = p.y;
        }
        const flicker = 0.75 + 0.25 * Math.sin(time * 0.05 + k * 2.1) * Math.sin(time * 0.031 + k);
        f.head.setPosition(f.x, f.y).setDisplaySize(16 * (0.6 + 0.4 * burn) * (0.85 + 0.3 * flicker), 16 * (0.6 + 0.4 * burn) * (0.85 + 0.3 * flicker)).setAlpha((0.7 + 0.3 * flicker) * (0.4 + 0.6 * burn));
        if (Math.random() < 0.18 * burn) drip.emitParticleAt(f.x, f.y, 1);
        flares[w++] = f;
      }
      flares.length = w;
    };
    scene.events.on(Phaser.Scenes.Events.UPDATE, tick);
  }


  /**
   * The real phase-cloak screen distortion (same shader as the in-mission camera FX) over a
   * disc of grid lines, warped edge-to-center with a slight fisheye.
   * Canvas renderer has no shaders — falls back to the breathing rings.
   */
  private buildCloakPreview(cx: number, cy: number): void {
    const scene = this.scene;
    const pipeline = ensureCloakPreviewPipeline(scene.game);
    if (!pipeline) {
      this.buildCloakRingsPreview(cx, cy);
      return;
    }
    // Fits between the CM name (≈18px above) and its description (44px below center).
    const d = 54;
    const r = d / 2;
    const rt = scene.add.renderTexture(cx, cy, d, d).setOrigin(0.5, 0.5);
    const g = scene.make.graphics({}, false);
    // Grid lines only, as chords clipped to the disc — the shader cuts the circle and warps
    // them; violet / blue alternating so the warp and color split read strongly.
    const step = 7;
    let li = 0;
    for (let o = -r + step / 2; o < r; o += step, li++) {
      const half = Math.sqrt(Math.max(0, r * r - o * o));
      g.lineStyle(1, li % 2 ? 0x6a8cff : 0x9a6cff, 0.95);
      g.lineBetween(r + o, r - half, r + o, r + half);
      g.lineBetween(r - half, r + o, r + half, r + o);
    }
    rt.draw(g);
    g.destroy();
    // Filament scale matches the full-screen effect.
    pipeline.freq = d / scene.scale.width;
    rt.setPipeline(CLOAK_PREVIEW_PIPELINE);
    this.addDetail(rt);
  }

  /**
   * Time Warp: a replica of the in-mission warpwire lens as a bubble in the middle of a strip.
   * Rounds streak in fast from the left, crawl while crossing the bubble (grid + fisheye +
   * plate split), then snap back to speed on the way out — entering a time-warp field.
   * Canvas renderer has no shaders — falls back to purple expanding rings.
   */
  private buildTimewarpPreview(cx: number, cy: number): void {
    const scene = this.scene;
    const pipeline = ensureWarpPreviewPipeline(scene.game);
    if (!pipeline) {
      this.buildExpandingRings(cx, cy, 0xc86cff, 26, 1.6, 2, 1.6);
      return;
    }
    // Height fits between the CM name and its description; the bubble spans the height.
    const w = 150;
    const h = 54;
    const r = h / 2;
    const bx = w / 2;
    const by = h / 2;
    const rt = scene.add.renderTexture(cx, cy, w, h).setOrigin(0.5, 0.5);
    const grid = scene.make.graphics({}, false);
    const step = 7;
    grid.lineStyle(1, 0x6a4ca8, 0.75);
    for (let o = -r + step / 2; o < r; o += step) {
      const half = Math.sqrt(Math.max(0, r * r - o * o));
      grid.lineBetween(bx + o, by - half, bx + o, by + half);
      grid.lineBetween(bx - half, by + o, bx + half, by + o);
    }
    const rounds = scene.make.graphics({}, false);
    const fast = 190;
    const slow = 7;
    const respawn = (p: { x: number; y: number }) => {
      p.x = -14 - Math.random() * 90;
      p.y = by + (Math.random() * 2 - 1) * r * 0.8;
    };
    const ps = Array.from({ length: 6 }, () => {
      const p = { x: 0, y: 0 };
      respawn(p);
      p.x = Math.random() * w; // start spread across the strip
      return p;
    });
    // Sharp ease between fast (outside) and a crawl (inside the bubble).
    const insideness = (x: number, y: number) => {
      const d = Math.hypot(x - bx, y - by);
      return 1 - Phaser.Math.Clamp((d - (r - 5)) / 7, 0, 1);
    };
    const redraw = (_t: number, dms: number) => {
      const dt = Math.min(dms, 50) / 1000;
      rounds.clear();
      for (const p of ps) {
        const k = insideness(p.x, p.y);
        const spd = Phaser.Math.Linear(fast, slow, k);
        p.x += spd * dt;
        if (p.x > w + 14) respawn(p);
        // Streak length follows speed: long motion blur outside, a dot inside.
        const tail = Phaser.Math.Clamp(spd * 0.07, 2, 16);
        rounds.lineStyle(1.4, 0xc86cff, 0.6).lineBetween(p.x - tail, p.y, p.x, p.y);
        rounds.fillStyle(0xf0e4ff, 1).fillCircle(p.x, p.y, 1.5);
      }
      rt.clear();
      rt.draw(grid);
      rt.draw(rounds);
    };
    redraw(0, 0);
    scene.events.on("update", redraw);
    rt.once("destroy", () => {
      scene.events.off("update", redraw);
      grid.destroy();
      rounds.destroy();
    });
    pipeline.aspect = w / h;
    rt.setPipeline(WARP_PREVIEW_PIPELINE);
    this.addDetail(rt);
  }

  /** A slow breathing ring (out of phase with an inner one) suggesting a flickering stealth field. */
  private buildCloakRingsPreview(cx: number, cy: number): void {
    const scene = this.scene;
    const outer = scene.add.graphics();
    const inner = scene.add.graphics();
    outer.lineStyle(1.5, 0x7ad0ff, 1).strokeCircle(cx, cy, 24);
    inner.lineStyle(1.5, 0xd8f4ff, 1).strokeCircle(cx, cy, 14);
    this.addDetail(outer);
    this.addDetail(inner);
    scene.tweens.add({ targets: outer, alpha: { from: 0.85, to: 0.1 }, duration: 850, yoyo: true, repeat: -1, ease: "Sine.InOut" });
    scene.tweens.add({ targets: inner, alpha: { from: 0.1, to: 0.85 }, duration: 850, yoyo: true, repeat: -1, ease: "Sine.InOut" });
  }

  /**
   * The real EMP burst's own pieces: flickering fx_zap bolt sprites (same random frame/rotation/
   * fade as missionScene's spawnTeslaZap) plus a continuous cyan-blue sparky glow (same tint
   * ramp as its teslaSparkBurst) — no rings, no soft flash, just the electric arcs themselves.
   */
  private buildEmpPreview(cx: number, cy: number): void {
    const scene = this.scene;
    const radius = 20;

    this.addDetail(
      scene.add.particles(cx, cy, "fx_spark", {
        frequency: 55,
        lifespan: { min: 260, max: 460 },
        speed: { min: 40, max: 140 },
        angle: { min: 0, max: 360 },
        scale: { start: 0.3, end: 0 },
        alpha: { start: 1, end: 0 },
        blendMode: "ADD",
        tint: [0x8ef0ff, 0x3ad0ff, 0x1a88ff, 0x0d5cff],
        frame: FieldManual.FX_FRAMES,
        rotate: { min: 0, max: 360 },
      })
    );

    if (!scene.textures.exists("fx_zap")) return;
    const pool: Phaser.GameObjects.Image[] = Array.from({ length: 4 }, () =>
      scene.add.image(cx, cy, "fx_zap", 0).setVisible(false).setBlendMode(Phaser.BlendModes.ADD)
    );
    pool.forEach((img) => this.addDetail(img));
    const zaps: { img: Phaser.GameObjects.Image; t: number; max: number }[] = [];
    let spawnAcc = 0;
    const tick = (_time: number, deltaMs: number) => {
      if (!pool[0]!.scene) {
        scene.events.off(Phaser.Scenes.Events.UPDATE, tick);
        return;
      }
      const dt = deltaMs / 1000;
      spawnAcc += dt;
      if (spawnAcc > 0.16) {
        spawnAcc = 0;
        const img = pool.find((im) => !im.visible);
        if (img) {
          const a = Math.random() * Math.PI * 2;
          const r = Math.random() * radius;
          const life = 0.08 + Math.random() * 0.1;
          img
            .setTexture("fx_zap", (Math.random() * 4) | 0)
            .setVisible(true)
            .setPosition(cx + Math.cos(a) * r, cy + Math.sin(a) * r)
            .setRotation(Math.random() * Math.PI * 2)
            .setScale(0.22 + Math.random() * 0.32)
            .setAlpha(0.95);
          zaps.push({ img, t: life, max: life });
        }
      }
      for (let i = zaps.length - 1; i >= 0; i--) {
        const z = zaps[i]!;
        z.t -= dt;
        if (z.t <= 0) {
          z.img.setVisible(false);
          zaps.splice(i, 1);
        } else {
          z.img.setAlpha(Phaser.Math.Clamp(z.t / z.max, 0, 1) * 0.95);
        }
      }
    };
    scene.events.on(Phaser.Scenes.Events.UPDATE, tick);
  }

  /**
   * Matches missionScene's actual reactive-armor visuals: six blinking red dots ringing the
   * hull (syncReactiveArmorDots — a hard on/off blink, not a smooth pulse) plus a periodic
   * radial spark burst in the same six directions (fireReactiveArmorBurst), reusing the signal
   * flare's red/pink spark palette. Self-ticking + self-detaching, same pattern as the EMP preview.
   */
  private buildReactiveArmorPreview(cx: number, cy: number): void {
    const scene = this.scene;
    // Baked on demand (mission create does it too) — the home-screen manual may be first.
    ensureImpactGlow(scene.textures);
    const dots = 6;
    const ringR = 22;
    const sparkTint = [0xffffff, 0xff90b0, 0xff2858, 0xc01030];
    const glows = Array.from({ length: dots }, (_, i) => {
      const ang = (i / dots) * Math.PI * 2;
      const g = scene.add
        .image(cx + Math.cos(ang) * ringR, cy + Math.sin(ang) * ringR, "fx_glow")
        .setBlendMode(Phaser.BlendModes.ADD)
        .setTint(0xff2840)
        .setDisplaySize(14, 14)
        .setAlpha(0.9);
      this.addDetail(g);
      return g;
    });
    const emitters = Array.from({ length: dots }, (_, i) => {
      const angDeg = (i / dots) * 360;
      const ang = (i / dots) * Math.PI * 2;
      const ox = cx + Math.cos(ang) * ringR;
      const oy = cy + Math.sin(ang) * ringR;
      const e = scene.add.particles(ox, oy, "fx_spark", {
        lifespan: { min: 260, max: 420 },
        speed: { min: 140, max: 260 },
        angle: { min: angDeg - 6, max: angDeg + 6 },
        scaleX: { start: 2.2, end: 0.4 },
        scaleY: { start: 0.6, end: 0.15 },
        alpha: { start: 1, end: 0 },
        blendMode: "ADD",
        tint: sparkTint,
        frame: FieldManual.FX_FRAMES,
        rotate: { min: angDeg - 4, max: angDeg + 4 },
        emitting: false,
      });
      this.addDetail(e);
      return e;
    });
    let lastBurst = -Infinity;
    const burstEvery = 1300;
    const tick = (time: number) => {
      if (!glows[0]!.scene) {
        scene.events.off(Phaser.Scenes.Events.UPDATE, tick);
        return;
      }
      if (time - lastBurst >= burstEvery) {
        lastBurst = time;
        emitters.forEach((e) => e.explode(4));
      }
    };
    scene.events.on(Phaser.Scenes.Events.UPDATE, tick);
  }

  /** Gray smoke puffs drifting outward in every direction, same fx_smoke as spawnSmokePuffs. */
  private buildSmokeScreenPreview(cx: number, cy: number): void {
    const scene = this.scene;
    this.addDetail(
      scene.add.particles(cx, cy, "fx_smoke", {
        frequency: 90,
        lifespan: { min: 900, max: 1400 },
        speed: { min: 10, max: 30 },
        angle: { min: 0, max: 360 },
        scale: { start: 0.3, end: 1.1 },
        alpha: { start: 0.55, end: 0 },
        frame: FieldManual.FX_FRAMES,
        rotate: { min: -60, max: 60 },
      })
    );
  }

  /** N rings expanding from the center on a shared loop, fading out as they grow. */
  private buildExpandingRings(cx: number, cy: number, color: number, maxRadius: number, period: number, count: number, lineWidth = 1.5): void {
    const scene = this.scene;
    const g = scene.add.graphics().setBlendMode(Phaser.BlendModes.ADD);
    this.addDetail(g);
    const tick = (time: number) => {
      if (!g.scene) {
        scene.events.off(Phaser.Scenes.Events.UPDATE, tick);
        return;
      }
      const t = time * 0.001;
      g.clear();
      for (let i = 0; i < count; i++) {
        const phase = (t / period + i / count) % 1;
        const r = phase * maxRadius;
        g.lineStyle(lineWidth, color, (1 - phase) * 0.85);
        g.strokeCircle(cx, cy, r);
      }
    };
    scene.events.on(Phaser.Scenes.Events.UPDATE, tick);
  }
}

/** Full-text duration/cooldown for the countermeasure detail panel (the loadout row keeps the abbreviated form). */
function cmTimingFullText(cm: CountermeasureSpec): string {
  const dur = Number.isInteger(cm.duration) ? cm.duration : cm.duration.toFixed(1);
  const cd = Number.isInteger(cm.cooldown) ? cm.cooldown : cm.cooldown.toFixed(1);
  return `${dur} SECOND DURATION   •   ${cd} SECOND COOLDOWN`;
}

/** Player-facing weapon system tags — classification is computed in `sim/tips.ts`. */
function weaponBadges(id: WpnId): string[] {
  const w = wpnOf(id);
  const badges: string[] = [];
  if (w.fits.includes("turret") || w.fits.includes("fixed")) badges.push("GUN");
  if (w.fits.includes("hardpoint")) badges.push("HARDPOINT");
  const family = wpnGuidedFamily(id);
  if (family === "lock_on") badges.push("LOCK-ON GUIDED");
  // "steer" covers both true wire-guided weapons (a visible wire, TOW-style) and ones that just
  // drift toward the reticle with no wire drawn (guidance.wire is only true for the former).
  else if (family === "steer") badges.push(w.guidance?.wire ? "WIRE-GUIDED" : "STEERABLE");
  else if (family === "steer_commit") badges.push("COMMIT-GUIDED");
  else if (family === "waypoint") badges.push("WAYPOINT GUIDED");
  if (wpnIsAntiArmor(id)) badges.push("ANTI-ARMOR");
  if (wpnIsAntiAir(id)) badges.push("ANTI-AIR");
  if (wpnIsAntiSoft(id)) badges.push("ANTI-PERSONNEL");
  if (wpnPierces(id)) badges.push("PENETRATING");
  if (w.payload.stun) badges.push("STUN");
  if (w.payload.smoke) badges.push("BLIND");
  if (w.payload.cluster) badges.push("CLUSTER");
  if (w.payload.spider) badges.push("GROUND SKIMMER");
  if (wpnIsBombDrop(id)) badges.push("BOMB");
  if (wpnIsRemoteDeploy(id)) badges.push("REMOTE / DRONE");
  return badges;
}

type WeaponStatCol = { label: string; valueText: string; points: number[]; curIdx: number };

/**
 * Stats appropriate to this weapon's delivery type, ranked against same-bucket weapons in the
 * roster (guns compare only to guns, hardpoint ordnance only to ordnance — a gun's rate of
 * fire isn't ranked against bombs, nor a bomb's blast radius against chain guns) — the same
 * rank-chart shape as the craft stat comparison: bar per weapon, this one picked out, sorted
 * ascending. RATE OF FIRE and DPS reflect this weapon exactly as mounted in this socket —
 * multi-barrel / simultaneous-muzzle / fire-rate-multiplier sockets output more than the base
 * catalog numbers, the same streams-based multiplier `craftFirepower` uses for craft totals.
 */
function weaponStatCols(weapon: PlayerWpnSpec, craft: CraftSpec, slot: number): WeaponStatCol[] {
  const socket = craft.sockets[slot];
  const isGun = socket?.class === "turret" || socket?.class === "fixed";
  const mountMul = craftSocketFireStreams(craft, slot) * (socket?.fireRateMul ?? 1);
  const allWpns = Object.values(PLAYER_WPNS) as PlayerWpnSpec[];
  const isGunWpn = (w: PlayerWpnSpec) => w.fits.includes("turret") || w.fits.includes("fixed");
  const bucket = allWpns.filter((w) => isGunWpn(w) === isGun);

  // Ranks `weapon` against `pool` by `valueOf`, but substitutes `thisValue` (when given) for
  // weapon's own entry so the highlighted bar and its position both reflect the true mounted
  // value rather than the unmodified catalog one.
  const rank = (pool: PlayerWpnSpec[], valueOf: (w: PlayerWpnSpec) => number, thisValue?: number): { points: number[]; curIdx: number } => {
    const entries = pool.map((w) => ({ isCur: w.id === weapon.id, value: w.id === weapon.id && thisValue !== undefined ? thisValue : valueOf(w) }));
    entries.sort((a, b) => a.value - b.value);
    return { points: entries.map((e) => e.value), curIdx: entries.findIndex((e) => e.isCur) };
  };

  const cols: WeaponStatCol[] = [];

  cols.push({ label: "DAMAGE", valueText: Math.round(weapon.dmg).toString(), ...rank(bucket, (w) => w.dmg) });

  // Per-barrel cadence, not multiplied by mount streams — DPS below is where the multi-barrel
  // output shows up.
  const rofOf = (w: PlayerWpnSpec) => 1 / Math.max(0.001, w.fireCd);
  cols.push({ label: "FIRE RATE", valueText: `${rofOf(weapon).toFixed(1)}/s`, ...rank(bucket, rofOf) });

  const thisDps = playerWeaponDps(weapon) * mountMul;
  cols.push({ label: "DPS", valueText: Math.round(thisDps).toString(), ...rank(bucket, playerWeaponDps, thisDps) });

  if (!isGun) {
    cols.push({ label: "SPEED", valueText: `${Math.round(weapon.speed)}m/s`, ...rank(bucket, (w) => w.speed) });
  }

  if (weapon.blast > 0) {
    const blasty = bucket.filter((w) => w.blast > 0);
    cols.push({ label: "BLAST", valueText: `${Math.round(weapon.blast)}m`, ...rank(blasty, (w) => w.blast) });
  }

  if (weapon.payload.remote) {
    const remotes = bucket.filter((w) => w.payload.remote);
    cols.push({
      label: "DEPLOY",
      valueText: `${Math.round(weapon.payload.remote.duration)}s`,
      ...rank(remotes, (w) => w.payload.remote!.duration),
    });
  }

  const capacity = craftSocketStartingAmmo(weapon.ammo, craft, slot);
  const ammoPool = bucket.filter((w) => Number.isFinite(w.ammo));
  cols.push({
    label: "AMMO",
    valueText: capacity === Infinity ? "∞" : String(capacity),
    ...rank(ammoPool.length ? ammoPool : bucket, (w) => w.ammo),
  });

  return cols;
}

