
import Phaser from "phaser";
import { makeUnit, spawnCrewFor } from "../../../sim/units";
import { Layer } from "../../../render/depth";
import { labelOf, allKinds } from "../../../sim/roster";
import { CamTune } from "../../../worldgen/world";
import type { MissionScene } from "../../missionScene";

const DEBUG_MENU_ITEMS = [
  { section: "GAMEPLAY" },
  { action: "seed", label: "Mission seed" },
  { action: "noDamage", label: "No damage" },
  { action: "infAmmo", label: "Infinite ammo" },
  { section: "DIAGNOSTICS" },
  { action: "performance", label: "Performance", shortcut: "P" },
  { action: "height", label: "Height + colliders", shortcut: "K" },
  { action: "ai", label: "AI" },
  { action: "blast", label: "Blast radii" },
  { action: "sideView", label: "Side view" },
  { section: "RENDERING" },
  { action: "terrainMesh", label: "Terrain mesh" },
  { action: "fx", label: "Post FX", shortcut: "O" },
  { section: "TOOLS" },
  { action: "relief", label: "Terrain editor", shortcut: "B" },
  { action: "camera", label: "Camera…" },
  { action: "spawn", label: "Spawn…" },
] as const;

const CAMERA_PRESETS = [
  { name: "SUBTLE", pitch: 0.025, cam: 1300, zoom0: 1.45 },
  { name: "CURRENT", pitch: 0.05, cam: 900, zoom0: 1.45 },
  { name: "DRAMATIC", pitch: 0.09, cam: 600, zoom0: 1.45 },
] as const;

export function activeCameraPreset(): (typeof CAMERA_PRESETS)[number] | undefined {
  return CAMERA_PRESETS.find(
    (preset) =>
      CamTune.pitch === preset.pitch &&
      CamTune.cam === preset.cam &&
      CamTune.zoom0 === preset.zoom0
  );
}

/** In-mission debug menu (`): toggles, camera tuning and unit spawn sub-menus. */
export class DebugMenu {
  noDamage = false;
  infAmmo = false;
  open = false;
  root!: Phaser.GameObjects.Container;
  panel!: Phaser.GameObjects.Graphics;
  rows: Phaser.GameObjects.Text[] = [];
  title!: Phaser.GameObjects.Text;
  spawnOpen = false;
  spawnIdx = 0;
  spawnRows: Phaser.GameObjects.Text[] = [];
  seedCopyNoticeUntil = 0;
  camOpen = false;
  camIdx = 0;
  camRows: Phaser.GameObjects.Text[] = [];
  /** Focused row on the main debug list (arrow-key nav). */
  menuIdx = 0;
  spawnHint!: Phaser.GameObjects.Text;

  constructor(readonly s: MissionScene) {}

  /** Per-mission state reset (called from the scene's init). */
  reset(): void {
    this.open = false;
    this.spawnOpen = false;
    this.camOpen = false;
    this.noDamage = false;
    this.infAmmo = false;
  }

  toggle(force?: boolean): void {
    const want = force ?? !this.open;
    if (want && this.s.help.open) return;
    this.open = want;
    if (!this.open) {
      this.spawnOpen = false;
      this.camOpen = false;
    }
    this.root.setVisible(this.open);
    if (this.open) this.sync();
  }

  setup(): void {
    const x = 22;
    const y = 86;
    const rowH = 22;
    this.root = this.s.add.container(x, y);
    this.root.setDepth(Layer.HUD + 180);
    this.root.setScrollFactor(0);
    this.panel = this.s.add.graphics();
    this.title = this.s.add.text(12, 10, "/  DEBUG    ↑↓ select   ENTER activate", {
      fontFamily: "Share Tech Mono, monospace",
      fontSize: "13px",
      color: "#e8b84a",
    });
    this.rows = DEBUG_MENU_ITEMS.map((item, i) => {
      const t = this.s.add
        .text(12, 38 + i * rowH, "", {
          fontFamily: "Share Tech Mono, monospace",
          fontSize: "13px",
          color: "#f0e6c8",
        });
      if ("action" in item) {
        t.setInteractive({ useHandCursor: true });
        t.on("pointerdown", () => {
          if (this.spawnOpen || this.camOpen) return;
          this.menuIdx = i;
          this.activateRow(i);
        });
      }
      return t;
    });
    this.spawnHint = this.s.add
      .text(12, 10, "", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "12px",
        color: "#e8b84a",
      })
      .setVisible(false);
    const camLabels = ["PITCH", "EYE", "ZOOM0", "PRESET"];
    this.camRows = camLabels.map((_label, i) => {
      const t = this.s.add
        .text(12, 34 + i * 22, "", {
          fontFamily: "Share Tech Mono, monospace",
          fontSize: "13px",
          color: "#f0e6c8",
        })
        .setInteractive({ useHandCursor: true })
        .setVisible(false);
      t.on("pointerdown", () => {
        if (!this.camOpen) return;
        this.camIdx = i;
        this.activateCamRow();
      });
      return t;
    });
    const kinds = allKinds();
    this.spawnRows = kinds.map((_kind, i) => {
      const t = this.s.add
        .text(12, 34 + i * 18, "", {
          fontFamily: "Share Tech Mono, monospace",
          fontSize: "13px",
          color: "#f0e6c8",
        })
        .setInteractive({ useHandCursor: true })
        .setVisible(false);
      t.on("pointerdown", () => {
        if (!this.spawnOpen) return;
        this.spawnIdx = i;
        this.spawnSelected();
      });
      return t;
    });
    this.root.add([
      this.panel,
      this.title,
      ...this.rows,
      this.spawnHint,
      ...this.camRows,
      ...this.spawnRows,
    ]);
    this.root.setVisible(false);
    this.menuIdx = DEBUG_MENU_ITEMS.findIndex((item) => "action" in item);
    this.sync();
  }

  sync(): void {
    if (!this.rows.length) return;
    const w = 330;
    const rowH = 22;
    if (this.camOpen) {
      const n = this.camRows.length;
      const hgt = 36 + n * 22 + 10;
      this.panel.clear();
      this.panel.fillStyle(0x12100c, 0.92);
      this.panel.fillRoundedRect(0, 0, w, hgt, 3);
      this.panel.lineStyle(1.5, 0xe8b84a, 0.85);
      this.panel.strokeRoundedRect(0, 0, w, hgt, 3);
      for (const t of this.rows) t.setVisible(false);
      for (const t of this.spawnRows) t.setVisible(false);
      this.title.setVisible(false);
      this.spawnHint
        .setVisible(true)
        .setText("CAMERA  ↑↓ select  ←→ adjust  ENTER");
      const vals = [
        CamTune.pitch.toFixed(3),
        String(CamTune.cam | 0),
        CamTune.zoom0.toFixed(2),
        activeCameraPreset()?.name ?? "CUSTOM",
      ];
      const names = ["PITCH", "EYE", "ZOOM0", "PRESET"];
      for (let i = 0; i < this.camRows.length; i++) {
        const row = this.camRows[i]!;
        const sel = i === this.camIdx;
        row
          .setVisible(true)
          .setText(`${sel ? "▸" : " "}  ${names[i]!}  ${vals[i]!}`)
          .setColor(sel ? "#e8b84a" : "#c8c0a8");
      }
      return;
    }
    if (this.spawnOpen) {
      const kinds = allKinds();
      const n = kinds.length;
      const hgt = 36 + n * 18 + 10;
      this.panel.clear();
      this.panel.fillStyle(0x12100c, 0.92);
      this.panel.fillRoundedRect(0, 0, w, hgt, 3);
      this.panel.lineStyle(1.5, 0xe8b84a, 0.85);
      this.panel.strokeRoundedRect(0, 0, w, hgt, 3);
      for (const t of this.rows) t.setVisible(false);
      for (const t of this.camRows) t.setVisible(false);
      this.title.setVisible(false);
      this.spawnHint
        .setVisible(true)
        .setText("SPAWN   ↑↓  ENTER place   ESC back");
      for (let i = 0; i < this.spawnRows.length; i++) {
        const row = this.spawnRows[i]!;
        const kind = kinds[i]!;
        const sel = i === this.spawnIdx;
        row
          .setVisible(true)
          .setText(`${sel ? "▸" : " "}  ${labelOf(kind)}`)
          .setColor(sel ? "#e8b84a" : "#c8c0a8");
      }
      return;
    }
    const hgt = 48 + this.rows.length * rowH;
    this.panel.clear();
    this.panel.fillStyle(0x12100c, 0.92);
    this.panel.fillRoundedRect(0, 0, w, hgt, 3);
    this.panel.lineStyle(1.5, 0xe8b84a, 0.85);
    this.panel.strokeRoundedRect(0, 0, w, hgt, 3);
    this.title.setVisible(true);
    this.spawnHint.setVisible(false);
    for (const t of this.spawnRows) t.setVisible(false);
    for (const t of this.camRows) t.setVisible(false);
    if (
      this.menuIdx >= DEBUG_MENU_ITEMS.length ||
      !("action" in DEBUG_MENU_ITEMS[this.menuIdx]!)
    ) {
      this.menuIdx = DEBUG_MENU_ITEMS.findIndex((item) => "action" in item);
    }
    for (let i = 0; i < this.rows.length; i++) {
      const row = this.rows[i]!;
      const item = DEBUG_MENU_ITEMS[i]!;
      row.setVisible(true);
      if ("section" in item) {
        row.setText(item.section).setColor("#6a8a62");
        continue;
      }
      const focus = i === this.menuIdx;
      const mark = focus ? "▸" : " ";
      const shortcut = "shortcut" in item ? `[${item.shortcut}]` : "";
      if (item.action === "seed") {
        const notice = this.s.time.now < this.seedCopyNoticeUntil ? "COPIED" : "COPY";
        row
          .setText(`${mark}  ${item.label}  ${this.s.world.seed}  [${notice}]`)
          .setColor(focus ? "#e8b84a" : "#f0e6c8");
        continue;
      }
      const on =
        item.action === "noDamage"
          ? this.noDamage
          : item.action === "infAmmo"
            ? this.infAmmo
            : item.action === "performance"
              ? this.s.perf.enabled
              : item.action === "height"
                ? this.s.overlays.showHeightMap
                : item.action === "ai"
                  ? this.s.overlays.aiOn
                  : item.action === "blast"
                    ? this.s.overlays.blastOn
                    : item.action === "sideView"
                    ? this.s.sideView.on
                    : item.action === "terrainMesh"
                      ? this.s.terrainMesh
                      : item.action === "fx"
                        ? this.s.postFx.on
                        : item.action === "relief"
                          ? this.s.relief.open
                          : undefined;
      const label = `${item.label}${shortcut ? `  ${shortcut}` : ""}`;
      if (on != null) {
        row.setText(`${mark}  ${label.padEnd(25)} ${on ? "ON" : "OFF"}`);
        row.setColor(focus ? "#e8b84a" : on ? "#c8b87a" : "#8a8470");
      } else {
        row.setText(`${mark}  ${label}`);
        row.setColor(focus ? "#e8b84a" : "#f0e6c8");
      }
    }
  }

  nudge(dir: number): void {
    const n = this.rows.length;
    if (!n) return;
    do {
      this.menuIdx = (this.menuIdx + dir + n) % n;
    } while (!("action" in DEBUG_MENU_ITEMS[this.menuIdx]!));
    this.sync();
  }

  activateRow(i: number): void {
    const item = DEBUG_MENU_ITEMS[i];
    if (!item || !("action" in item)) return;
    if (item.action === "seed") void this.copyMissionSeed();
    else if (item.action === "noDamage") this.setNoDamage(!this.noDamage);
    else if (item.action === "infAmmo") this.setInfAmmo(!this.infAmmo);
    else if (item.action === "performance") this.s.perf.toggle();
    else if (item.action === "height") this.s.overlays.toggleHeightMap();
    else if (item.action === "ai") this.s.overlays.setAi(!this.s.overlays.aiOn);
    else if (item.action === "blast") this.s.overlays.setBlast(!this.s.overlays.blastOn);
    else if (item.action === "sideView") this.s.sideView.setOn(!this.s.sideView.on);
    else if (item.action === "terrainMesh") this.s.toggleTerrainMesh();
    else if (item.action === "fx") this.s.postFx.toggle();
    else if (item.action === "relief") this.s.relief.toggle();
    else if (item.action === "camera") this.openCam();
    else if (item.action === "spawn") this.openSpawn();
    this.sync();
  }

  async copyMissionSeed(): Promise<void> {
    try {
      await navigator.clipboard.writeText(String(this.s.world.seed));
      this.seedCopyNoticeUntil = this.s.time.now + 900;
      this.sync();
      this.s.time.delayedCall(900, () => this.sync());
    } catch {
      // The seed remains visible for manual copying if clipboard access is denied.
    }
  }

  nudgeCamPitch(dir: number): void {
    CamTune.pitch = Phaser.Math.Clamp(Math.round((CamTune.pitch + dir * 0.005) * 1000) / 1000, 0.01, 0.2);
    this.s.camera.syncProjectionPose();
    this.sync();
  }

  nudgeCamProj(dir: number): void {
    CamTune.cam = Phaser.Math.Clamp(CamTune.cam + dir * 40, 320, 1800);
    this.s.camera.syncProjectionPose();
    this.sync();
  }

  nudgeCamZoom0(dir: number): void {
    CamTune.zoom0 = Phaser.Math.Clamp(Math.round((CamTune.zoom0 + dir * 0.05) * 100) / 100, 0.4, 4);
    this.sync();
  }

  openCam(): void {
    this.camOpen = true;
    this.spawnOpen = false;
    if (this.camIdx >= this.camRows.length) this.camIdx = 0;
    this.sync();
  }

  closeCam(): void {
    this.camOpen = false;
    this.sync();
  }

  nudgeCamSel(dir: number): void {
    const n = this.camRows.length;
    if (!n) return;
    this.camIdx = (this.camIdx + dir + n) % n;
    this.sync();
  }

  nudgeCam(dir: number): void {
    if (this.camIdx === 0) this.nudgeCamPitch(dir);
    else if (this.camIdx === 1) this.nudgeCamProj(dir);
    else if (this.camIdx === 2) this.nudgeCamZoom0(dir);
    else this.cycleCameraPreset(dir);
  }

  activateCamRow(): void {
    if (this.camIdx < 3) {
      this.nudgeCam(1);
      return;
    }
    this.cycleCameraPreset(1);
  }

  cycleCameraPreset(dir: number): void {
    const active = activeCameraPreset();
    const current = active ? CAMERA_PRESETS.indexOf(active) : 1;
    const index = (current + (dir < 0 ? -1 : 1) + CAMERA_PRESETS.length) % CAMERA_PRESETS.length;
    const preset = CAMERA_PRESETS[index]!;
    CamTune.pitch = preset.pitch;
    CamTune.cam = preset.cam;
    CamTune.zoom0 = preset.zoom0;
    this.s.camera.zoom = preset.zoom0;
    this.s.camera.syncProjectionPose();
    this.sync();
  }

  openSpawn(): void {
    this.spawnOpen = true;
    this.camOpen = false;
    this.sync();
  }

  closeSpawn(): void {
    this.spawnOpen = false;
    this.sync();
  }

  nudgeSpawn(dir: number): void {
    const n = allKinds().length;
    if (!n) return;
    this.spawnIdx = (this.spawnIdx + dir + n) % n;
    this.sync();
  }

  spawnSelected(): void {
    const kind = allKinds()[this.spawnIdx];
    if (!kind) return;
    const h = this.s.player;
    const a = Math.random() * Math.PI * 2;
    const d = 80 + Math.random() * 140;
    const x = h.x + Math.cos(a) * d;
    const y = h.y + Math.sin(a) * d;
    const u = makeUnit(this.s.world, kind, x, y);
    this.s.units.push(u);
    this.s.units.push(...spawnCrewFor(this.s.world, this.s.textures, u));
  }

  setNoDamage(on: boolean): void {
    this.noDamage = on;
    this.s.player.immune = on;
    this.sync();
  }

  setInfAmmo(on: boolean): void {
    this.infAmmo = on;
    this.sync();
  }
}
