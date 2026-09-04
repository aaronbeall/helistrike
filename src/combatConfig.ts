import Phaser from "phaser";
import {
  ENEMY_HELI_MISSILE,
  HELLFIRE_LOCK_T,
  HELLFIRE_SEEK_DELAY,
  MISSILE_IGNITE,
  PLAYER_WPNS,
  type PlayerWpnSpec,
  type Wpn,
} from "./combat";
import { allKinds, labelOf, specOf, type WeaponSpec } from "./roster";
import { FX_VARIANTS, nameGameTexture, spritePivot } from "./sprites";

const DEPTH = 9300;
const MONO = "Share Tech Mono, monospace";
const GOLD = "#e8b84a";
const PAPER = "#f0e6c8";

const LIST_X = 16;
const LIST_Y = 40;
const LIST_W = 300;
const STATS_W = 420;
const LINE_H = 16;

type Filter = "all" | "player" | "enemy" | "fx";
const FILTERS: Filter[] = ["all", "player", "enemy", "fx"];

export type CombatCat = "player" | "enemy" | "fx";

export interface CombatEntry {
  id: string;
  cat: CombatCat;
  label: string;
  tag: string;
  /** Preview texture key (sheet or still). */
  tex: string;
  /** Sheet frame count when >1 (fx_* sheets). */
  frames?: number;
  /** Nose-up rotation for projectile previews. */
  rotOff?: number;
  lines: string[];
}

/**
 * Lazy debug browser for player weapons, enemy WeaponSpecs, and FX emitter / burst configs.
 * Player numbers come from PLAYER_WPNS (shared with fire logic); enemy from roster SPECS;
 * FX rows document the particle / explode params in MissionScene.
 */
export class CombatConfigTool {
  open = false;
  private built = false;
  private scene: Phaser.Scene;
  private idx = 0;
  private filter: Filter = "all";
  private zoom = 2;
  private frameT = 0;
  private entries: CombatEntry[] = [];
  root: Phaser.GameObjects.Container;
  private dim!: Phaser.GameObjects.Rectangle;
  private board!: Phaser.GameObjects.Graphics;
  private preview!: Phaser.GameObjects.Image;
  private overlay!: Phaser.GameObjects.Graphics;
  private listTxt!: Phaser.GameObjects.Text;
  private statsTxt!: Phaser.GameObjects.Text;
  private hintTxt!: Phaser.GameObjects.Text;
  private onBuilt?: (root: Phaser.GameObjects.Container) => void;
  private uiCam!: Phaser.Cameras.Scene2D.Camera;

  constructor(scene: Phaser.Scene, onBuilt?: (root: Phaser.GameObjects.Container) => void) {
    this.scene = scene;
    this.onBuilt = onBuilt;
    this.root = scene.add.container(0, 0).setDepth(DEPTH).setScrollFactor(0).setVisible(false);
    scene.cameras.main.ignore(this.root);
  }

  private ensureBuilt(): void {
    if (this.built) return;
    this.built = true;
    this.entries = buildCombatCatalog();
    const scene = this.scene;
    const w = scene.scale.width;
    const h = scene.scale.height;
    this.dim = scene.add
      .rectangle(0, 0, w, h, 0x0c0a08, 0.72)
      .setOrigin(0)
      .setScrollFactor(0)
      .setDepth(DEPTH)
      .setVisible(false);
    this.board = scene.add.graphics().setScrollFactor(0).setDepth(DEPTH + 1).setVisible(false);
    this.preview = scene.add
      .image(0, 0, "__DEFAULT")
      .setName("ui_combat_preview")
      .setScrollFactor(0)
      .setDepth(DEPTH + 2)
      .setVisible(false);
    this.overlay = scene.add.graphics().setScrollFactor(0).setDepth(DEPTH + 3).setVisible(false);
    this.listTxt = scene.add
      .text(LIST_X, LIST_Y, "", {
        fontFamily: MONO,
        fontSize: "13px",
        color: PAPER,
        lineSpacing: 3,
      })
      .setScrollFactor(0)
      .setDepth(DEPTH + 4)
      .setVisible(false);
    this.statsTxt = scene.add
      .text(0, 0, "", {
        fontFamily: MONO,
        fontSize: "12px",
        color: PAPER,
        lineSpacing: 4,
        wordWrap: { width: STATS_W - 8 },
      })
      .setScrollFactor(0)
      .setDepth(DEPTH + 4)
      .setVisible(false);
    this.hintTxt = scene.add
      .text(18, 14, "", { fontFamily: MONO, fontSize: "12px", color: GOLD })
      .setScrollFactor(0)
      .setDepth(DEPTH + 4)
      .setVisible(false);
    nameGameTexture(scene, this.listTxt, "ui_combat_list");
    nameGameTexture(scene, this.statsTxt, "ui_combat_stats");
    nameGameTexture(scene, this.hintTxt, "ui_combat_hint");
    this.root.add([this.dim, this.board, this.preview, this.overlay, this.listTxt, this.statsTxt, this.hintTxt]);

    this.uiCam = scene.cameras.add(0, 0, w, h, false, "combatRig");
    this.uiCam.setScroll(0, 0);
    this.uiCam.setZoom(1);
    this.uiCam.transparent = true;
    this.uiCam.setVisible(false);
    for (const child of scene.children.list) {
      if (child !== this.root) this.uiCam.ignore(child);
    }
    scene.events.on("addedtoscene", (go: Phaser.GameObjects.GameObject) => {
      if (go !== this.root) this.uiCam.ignore(go);
    });

    const kb = scene.input.keyboard;
    if (kb) {
      kb.addKey(Phaser.Input.Keyboard.KeyCodes.COMMA).on("down", () => {
        if (this.open) this.page(-1);
      });
      kb.addKey(Phaser.Input.Keyboard.KeyCodes.PERIOD).on("down", () => {
        if (this.open) this.page(1);
      });
      kb.addKey(Phaser.Input.Keyboard.KeyCodes.PAGE_UP).on("down", () => {
        if (this.open) this.page(-1);
      });
      kb.addKey(Phaser.Input.Keyboard.KeyCodes.PAGE_DOWN).on("down", () => {
        if (this.open) this.page(1);
      });
      kb.addKey(Phaser.Input.Keyboard.KeyCodes.G).on("down", () => {
        if (!this.open) return;
        const i = FILTERS.indexOf(this.filter);
        this.filter = FILTERS[(i + 1) % FILTERS.length]!;
        this.idx = 0;
        this.refreshPreview();
      });
    }

    scene.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      if (!this.open || !p.leftButtonDown()) return;
      if (p.x >= LIST_X && p.x < LIST_X + LIST_W) this.pickFromList(p.y);
    });

    this.onBuilt?.(this.root);
  }

  toggle(): void {
    this.ensureBuilt();
    this.open = !this.open;
    this.root.setVisible(this.open);
    this.dim.setVisible(this.open);
    this.board.setVisible(this.open);
    this.preview.setVisible(this.open);
    this.overlay.setVisible(this.open);
    this.listTxt.setVisible(this.open);
    this.statsTxt.setVisible(this.open);
    this.hintTxt.setVisible(this.open);
    this.scene.input.setDefaultCursor(this.open ? "default" : "none");
    this.uiCam.setVisible(this.open);
    if (this.open) this.refreshPreview();
    else this.overlay.clear();
  }

  cycle(dir: number): void {
    if (!this.open) return;
    const n = this.filtered().length;
    if (!n) return;
    this.idx = (this.idx + dir + n) % n;
    this.refreshPreview();
  }

  nudgeZoom(dir: number): void {
    if (!this.open) return;
    const steps = [0.5, 1, 1.5, 2, 3, 4, 6, 8];
    let i = 0;
    let best = Infinity;
    for (let k = 0; k < steps.length; k++) {
      const d = Math.abs(steps[k]! - this.zoom);
      if (d < best) {
        best = d;
        i = k;
      }
    }
    this.zoom = steps[Phaser.Math.Clamp(i + dir, 0, steps.length - 1)]!;
    this.refreshPreview();
  }

  page(dir: number): void {
    if (!this.open) return;
    const items = this.filtered();
    const size = this.pageSize();
    const pages = Math.max(1, Math.ceil(items.length / size));
    const next = (((this.pageOf(this.idx) + dir) % pages) + pages) % pages;
    this.idx = Math.min(items.length - 1, next * size);
    this.refreshPreview();
  }

  pickFromList(py: number): void {
    if (!this.open) return;
    const items = this.filtered();
    const size = this.pageSize();
    const row = Math.floor((py - LIST_Y) / LINE_H) - 1;
    if (row < 0 || row >= size) return;
    const i = this.pageOf(this.idx) * size + row;
    if (i < 0 || i >= items.length) return;
    this.idx = i;
    this.refreshPreview();
  }

  update(dt: number): void {
    if (!this.open) return;
    const items = this.filtered();
    if (!items.length) return;
    if (this.idx >= items.length) this.idx = 0;
    const e = items[this.idx]!;

    this.hintTxt.setText(
      `COMBAT RIG   \` cycle / close   [ ] cycle   , . page   - + zoom ${this.zoom}×   G filter ${this.filter.toUpperCase()}`
    );

    const size = this.pageSize();
    const pages = Math.max(1, Math.ceil(items.length / size));
    const page = this.pageOf(this.idx);
    const start = page * size;
    const slice = items.slice(start, start + size);
    this.listTxt.setText(
      [
        `— ${this.filter.toUpperCase()}  ${page + 1} / ${pages}  (${items.length}/${this.entries.length}) —`,
        ...slice.map((row, i) => {
          const mark = start + i === this.idx ? "▸" : " ";
          return `${mark} ${row.label.padEnd(22)} ${row.tag}`;
        }),
      ].join("\n")
    );

    this.statsTxt.setText(e.lines.join("\n"));
    this.layoutPreview(e, dt);
  }

  private pageSize(): number {
    return Math.max(8, Math.floor((this.scene.scale.height - LIST_Y - 28) / LINE_H) - 1);
  }

  private pageOf(idx: number): number {
    return Math.floor(idx / this.pageSize());
  }

  private filtered(): CombatEntry[] {
    if (this.filter === "all") return this.entries;
    return this.entries.filter((e) => e.cat === this.filter);
  }

  private refreshPreview(): void {
    if (!this.open || !this.built) return;
    this.update(0);
  }

  private layoutPreview(e: CombatEntry, dt: number): void {
    const w = this.scene.scale.width;
    const h = this.scene.scale.height;
    const listRight = LIST_X + LIST_W + 20;
    const gap = 28;
    const tex = e.tex;
    const frames = e.frames ?? 1;

    if (!this.scene.textures.exists(tex)) {
      this.preview.setVisible(false);
      this.board.clear();
      this.overlay.clear();
      this.statsTxt.setPosition(listRight, LIST_Y);
      return;
    }

    this.preview.setVisible(true).setTexture(tex);
    if (frames > 1) {
      this.frameT += dt;
      const fi = Math.floor(this.frameT * 8) % frames;
      if (Number(this.preview.frame.name) !== fi) this.preview.setFrame(fi);
    } else {
      this.preview.setFrame(0);
    }

    const pivot = spritePivot(tex);
    this.preview.setOrigin(e.cat === "fx" ? 0.5 : pivot.x, e.cat === "fx" ? 0.5 : pivot.y);
    const s = this.zoom;
    this.preview.setScale(s);
    const rot = e.rotOff ?? (e.cat === "fx" ? 0 : Math.PI / 2);
    this.preview.setRotation(rot);

    const bw = this.preview.displayWidth;
    const bh = this.preview.displayHeight;
    const cos = Math.abs(Math.cos(rot));
    const sin = Math.abs(Math.sin(rot));
    const boxW = bw * cos + bh * sin;
    const boxH = bw * sin + bh * cos;
    const pad = 10;
    const cx = listRight + pad + boxW * 0.5;
    const cy = Math.min(LIST_Y + pad + boxH * 0.5, h - pad - boxH * 0.5);
    this.preview.setPosition(cx, cy);

    const bx = cx - boxW * 0.5;
    const by = cy - boxH * 0.5;
    this.statsTxt.setPosition(Math.min(bx + boxW + gap, w - STATS_W - 16), Math.max(LIST_Y, by));

    this.board.clear();
    const cell = 8;
    this.board.fillStyle(0x2a2418, 1);
    this.board.fillRect(bx - pad, by - pad, boxW + pad * 2, boxH + pad * 2);
    for (let y = 0; y < boxH; y += cell) {
      for (let x = 0; x < boxW; x += cell) {
        if (((((x / cell) | 0) + ((y / cell) | 0)) & 1) === 1) this.board.fillStyle(0x3a3428, 1);
        else this.board.fillStyle(0x241e16, 1);
        this.board.fillRect(bx + x, by + y, Math.min(cell, boxW - x), Math.min(cell, boxH - y));
      }
    }
    this.board.lineStyle(1, 0xe8b84a, 0.55);
    this.board.strokeRect(bx - pad, by - pad, boxW + pad * 2, boxH + pad * 2);

    this.overlay.clear();
    if (e.cat !== "fx") {
      // Rough blast ring at preview zoom (blast is world units).
      const blast = parseBlast(e);
      if (blast > 0) {
        this.overlay.lineStyle(1.2, 0xff6a22, 0.65);
        this.overlay.strokeCircle(cx, cy, blast * s * 0.35);
      }
    }
  }
}

function parseBlast(e: CombatEntry): number {
  for (const line of e.lines) {
    const m = line.match(/\bblast\s+(\d+(?:\.\d+)?)/i);
    if (m) return Number(m[1]);
  }
  return 0;
}

export function buildCombatCatalog(): CombatEntry[] {
  return [...playerEntries(), ...enemyEntries(), ...fxEntries()];
}

function playerEntries(): CombatEntry[] {
  const order: Wpn[] = ["cannon", "rocket", "hellfire", "tow"];
  return order.map((id) => {
    const w = PLAYER_WPNS[id];
    return {
      id: `player_${id}`,
      cat: "player" as const,
      label: w.name,
      tag: "PLY",
      tex: w.tex,
      rotOff: id === "cannon" ? 0 : Math.PI / 2,
      lines: formatPlayer(w),
    };
  });
}

function formatPlayer(w: PlayerWpnSpec): string[] {
  const ammo = w.ammo === Infinity ? "∞" : String(w.ammo);
  return [
    `KIND     player / ${w.id}`,
    `LABEL    ${w.name}`,
    `AMMO     ${ammo}`,
    `FIRE CD  ${w.fireCd}s`,
    `SPEED    ${w.speed}`,
    `DMG      ${w.dmg}    blast ${w.blast}`,
    `LIFE     ${w.life}${w.id === "cannon" ? " (+0.55 air)" : ""}`,
    `TRACER   ${w.tracer ?? "—"}`,
    `TEX      ${w.tex}`,
    "",
    "TIMING",
    `  MISSILE_IGNITE     ${MISSILE_IGNITE}`,
    `  HELLFIRE_LOCK_T    ${HELLFIRE_LOCK_T}`,
    `  HELLFIRE_SEEK_DELAY ${HELLFIRE_SEEK_DELAY}`,
    "",
    "NOTES",
    ...w.notes.map((n) => `  · ${n}`),
    "",
    "source: combat.ts PLAYER_WPNS",
  ];
}

function enemyEntries(): CombatEntry[] {
  const out: CombatEntry[] = [];
  const seen = new Set<string>();

  const push = (id: string, label: string, tag: string, w: WeaponSpec, tex: string) => {
    const sig = `${w.shot}|${w.fireCd}|${w.range}|${w.speed}|${w.dmg}|${w.blast}|${w.tracer}|${w.burst ?? 0}`;
    const dedupe = `${label}|${sig}`;
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    out.push({
      id,
      cat: "enemy",
      label,
      tag,
      tex: shotTex(w.shot, w.tracer),
      rotOff: w.shot === "cannon" ? 0 : Math.PI / 2,
      lines: formatEnemy(label, w, tex),
    });
  };

  for (const kind of allKinds()) {
    const sp = specOf(kind);
    const name = labelOf(kind);
    if (sp.weapon) {
      push(`enemy_${kind}_body`, `${name} body`, "ENM", sp.weapon, sp.texture);
    }
    sp.guns.forEach((g, i) => {
      if (!g.weapon) return;
      push(`enemy_${kind}_gun_${i}`, `${name} gun[${i}]`, "GUN", g.weapon, g.tex);
    });
  }

  const m = ENEMY_HELI_MISSILE;
  out.push({
    id: "enemy_heli_pylon",
    cat: "enemy",
    label: m.label,
    tag: "ENM",
    tex: m.tex,
    rotOff: Math.PI / 2,
    lines: [
      `KIND     enemy / hardpoint (not SPECS)`,
      `LABEL    ${m.label}`,
      `SHOT     ${m.shot}`,
      `SPEED    ${m.speed}`,
      `DMG      ${m.dmg}    blast ${m.blast}`,
      `FIRE CD  ${m.fireCd}s`,
      `RANGE    ${m.range} (AI gate)`,
      `SCALE    ${m.scale}`,
      `TRACER   ${m.tracer}`,
      `MOTOR    ${m.motor}`,
      `HOME     player`,
      "",
      "source: scenes.ts gunship AI missile",
    ],
  });

  return out;
}

function shotTex(shot: WeaponSpec["shot"], tracer: WeaponSpec["tracer"]): string {
  if (shot === "rocket") return "rocket";
  if (shot === "hellfire") return "hellfire";
  if (tracer === "aa") return "tracer_aa";
  if (tracer === "small") return "tracer_sm";
  if (tracer === "shell") return "shell";
  if (tracer === "chain") return "cannon";
  return "cannon";
}

function formatEnemy(label: string, w: WeaponSpec, mountTex: string): string[] {
  const burst = w.burst ? `  burst ${w.burst}×${w.burstGap ?? "?"}` : "";
  return [
    `KIND     enemy / ${label}`,
    `SHOT     ${w.shot}`,
    `FIRE CD  ${w.fireCd}s`,
    `RANGE    ${w.range}`,
    `SPEED    ${w.speed}`,
    `DMG      ${w.dmg}    blast ${w.blast}`,
    `TRACER   ${w.tracer}${burst}`,
    `MUZZLE   len ${w.muzzleLen}${w.jitter != null ? `  jitter ${w.jitter}` : ""}`,
    `MOUNT    ${mountTex}`,
    "",
    "source: roster.ts SPECS / gun mounts",
  ];
}

function fxEntries(): CombatEntry[] {
  const sheet = (key: string, label: string, tag: string, lines: string[]): CombatEntry => ({
    id: `fx_${key}`,
    cat: "fx",
    label,
    tag,
    tex: key,
    frames: FX_VARIANTS,
    lines: [...lines, "", `TEX  ${key} ×${FX_VARIANTS}`, "source: scenes.ts particle / explode"],
  });

  return [
    sheet("fx_muzzle", "MUZZLE FLASH", "FX", [
      "KIND     showMuzzle / spawnSparks style muzzle",
      "BLEND    ADD  tint 0xfff6d0",
      "ORIGIN   0.14, 0.5",
      "PLAYER   sc 0.78  life 0.1  sparks n6",
      "MISSILE  sc 0.62  life 0.12 sparks n12 200–520",
    ]),
    sheet("fx_spark", "SPARK / TRACER", "FX", [
      "KIND     spark particles + tracer emitter",
      "TRACER   life 160  spd 40–140  ADD",
      "         scaleX 1.7→0  tint warm",
      "SPARK    life ~0.42–0.74  gravity Z_GRAVITY",
      "POOL     spawnSparks cap 280",
    ]),
    sheet("fx_flame", "FLAME", "FX", [
      "KIND     flame / burn / blastFire / ember",
      "DMG FLAME  life 480×trail  spd 8–40  gY -72",
      "BURN       life 240–420  sc ~0.7–1.4  gY -78",
      "BLAST BURN sc ~0.28–0.56",
      "BLAST FIRE life 180–320  spd 180–480  sc 1.15→0.18",
      "EMBER      sc ~0.12–0.24  gY -70",
    ]),
    sheet("fx_smoke", "SMOKE", "FX", [
      "KIND     smoke / hurt / frag / linger / heliDust",
      "SMOKE      life 900  spd 10–70  sc 0.6→2.4  gY -28",
      "HURT       life 2400–4200  spd 3–16  gY -6",
      "FRAG       life 520  sc 0.35  gY -30",
      "LINGER     life 2200–4000  sc 0.28",
      "HELI DUST  life 900–1600  spd 240–460  gY 8",
    ]),
    sheet("fx_dirt", "DIRT", "FX", [
      "KIND     spark style ground / dirt",
      "LIFE     ~0.45–0.8",
      "GRAVITY  Z_GRAVITY",
      "USES     ground explode, dust shock, hover dust",
      "BLOOD    dirt frames × multiply stamp",
    ]),
    sheet("fx_splash", "SPLASH", "FX", [
      "KIND     spark style water",
      "LIFE     ~0.32–0.6",
      "USES     water explode hits",
    ]),
    {
      id: "fx_blast_stamp",
      cat: "fx",
      label: "BLAST STAMP",
      tag: "FX",
      tex: "fx_blast_0",
      lines: [
        "KIND     wreck-map blast stamp",
        "TEX      fx_blast_0..3",
        "SCALE    (blast/72)×rand 0.55–1.05",
        "USES     explode HE, death boom, crash",
        "CANNON   stampCannonScar (tiny stretch)",
        "",
        "source: scenes.ts explode / stampWreck",
      ],
    },
    {
      id: "fx_explode",
      cat: "fx",
      label: "EXPLODE()",
      tag: "FX",
      tex: "fx_blast_1",
      lines: [
        "KIND     MissionScene.explode",
        "HE       kind !== cannon",
        "SPARKS   object / water / ground branches",
        "         n scaled by hitSparkFx(dmg)",
        "HE FIRE  heFireBurst  flame n~22  blastFire~26",
        "SMOKE    emit 16 / 6 / 8",
        "SHAKE    blast × 0.055|0.028",
        "TRAILS   spawnBlastTrails n~4–11",
        "",
        "source: scenes.ts explode / heFireBurst",
      ],
    },
    {
      id: "fx_hit_spark",
      cat: "fx",
      label: "HIT SPARK FX",
      tag: "FX",
      tex: "fx_spark",
      frames: FX_VARIANTS,
      lines: [
        "KIND     hitSparkFx(dmg)",
        "REF DMG  8 (chain baseline)",
        "SCALES   n / spd / size from dmg",
        "PICK     water→splash muzzle→flame",
        "         object→spark else dirt|spark",
        "",
        "source: scenes.ts hitSparkFx / pickSparkKind",
      ],
    },
    {
      id: "fx_dust_shock",
      cat: "fx",
      label: "DUST SHOCK",
      tag: "FX",
      tex: "fx_dirt",
      frames: FX_VARIANTS,
      lines: [
        "KIND     emitDustShock",
        "RADIUS   58 + power×48",
        "N        64×power dirt sparks",
        "LIFE     0.78–1.25  spd 220–420",
        "",
        "source: scenes.ts emitDustShock",
      ],
    },
  ];
}
