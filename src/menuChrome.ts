import Phaser from "phaser";
import { craftIsGunship, craftOf, type CraftSpec } from "./craft";
import { allMissions } from "./mission";
import { fbm } from "./noise";

export function ensureMissionPreviews(textures: Phaser.Textures.TextureManager): void {
  const width = 160;
  const height = 160;
  const missions = allMissions();
  for (let m = 0; m < missions.length; m++) {
    const mission = missions[m]!;
    const key = `menu_mission_preview_${mission.kind}`;
    if (textures.exists(key)) continue;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const g = canvas.getContext("2d", { willReadFrequently: true })!;
    const img = g.createImageData(width, height);
    const p = mission.profile;
    const seed = 8101 + m * 977;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const nx = x / width;
        const ny = y / height;
        const ridge = 1 - Math.abs(fbm(nx * 3.1 + 20, ny * 3.1, seed + 9, 3) * 2 - 1);
        let h = fbm(nx * 6.2, ny * 6.2, seed, 4, 2.05, 0.52) * 0.72 + ridge * 0.28;
        const radial = Math.pow(Math.hypot(nx - 0.5, ny - 0.5) * 1.15, 2);
        h = 0.5 + (h - 0.5) * p.relief;
        h -= radial * p.edgeFalloff;
        h += p.landBias;
        if (mission.kind === "river_run") {
          const riverY = 0.48 + Math.sin(nx * 11 + 0.7) * 0.13;
          if (Math.abs(ny - riverY) < 0.035) h = 0.27;
        }
        let color: [number, number, number];
        if (h < 0.34) color = [31, 75, 86];
        else if (h < 0.4) color = [174, 145, 87];
        else if (h > 0.72) color = [180, 171, 145];
        else if (h > 0.62) color = [91, 84, 66];
        else color = [76, 105, 65];
        const shade = 0.76 + fbm(nx * 18, ny * 18, seed + 41, 2) * 0.38;
        const i = (y * width + x) * 4;
        img.data[i] = color[0] * shade;
        img.data[i + 1] = color[1] * shade;
        img.data[i + 2] = color[2] * shade;
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    const vignette = g.createLinearGradient(0, 0, 0, height);
    vignette.addColorStop(0, "rgba(0,0,0,0.08)");
    vignette.addColorStop(1, "rgba(0,0,0,0.58)");
    g.fillStyle = vignette;
    g.fillRect(0, 0, width, height);
    textures.addCanvas(key, canvas);
  }
}

export function createControlLegend(
  scene: Phaser.Scene,
  panelW: number,
  y: number,
  craft: CraftSpec = craftOf()
): Phaser.GameObjects.GameObject[] {
  const objects: Phaser.GameObjects.GameObject[] = [];
  const controlW = panelW / 8;
  const x0 = -panelW / 2;
  const controlX = (i: number) => x0 + i * controlW + controlW / 2;
  const gunship = craftIsGunship(craft);
  objects.push(
    scene.add.rectangle(0, y, panelW, 72, 0x0b0a08, 0.82).setStrokeStyle(1, 0x6f6244, 0.7)
  );
  const keycap = (x: number, py: number, label: string, keyW = 24, keyH = 20) => {
    const g = scene.add.graphics();
    g.fillStyle(0x18150f, 0.96).fillRoundedRect(x - keyW / 2, py - keyH / 2, keyW, keyH, 3);
    g.lineStyle(1.4, 0xe8b84a, 0.9).strokeRoundedRect(x - keyW / 2, py - keyH / 2, keyW, keyH, 3);
    objects.push(g);
    objects.push(
      scene.add
        .text(x, py, label, {
          fontFamily: "Share Tech Mono, monospace",
          fontSize: keyW > 36 ? "9px" : "11px",
          color: "#f2d579",
        })
        .setOrigin(0.5)
    );
  };
  const mouse = (x: number, py: number, leftLit: boolean, wheelLit = false) => {
    const g = scene.add.graphics();
    if (leftLit) g.fillStyle(0xe8b84a, 0.48).fillRoundedRect(x - 12, py - 17, 12, 15, 3);
    g.lineStyle(1.5, 0xe8b84a, 0.95).strokeRoundedRect(x - 12, py - 17, 24, 34, 9);
    g.lineBetween(x, py - 16, x, py - 3);
    g.lineBetween(x - 11, py - 2, x + 11, py - 2);
    g.fillStyle(wheelLit ? 0xf2d579 : 0x6f6244, 1).fillRoundedRect(x - 2, py - 12, 4, 8, 2);
    objects.push(g);
  };
  const label = (i: number, value: string) => {
    objects.push(
      scene.add
        .text(controlX(i), y + 25, value, {
          fontFamily: "Share Tech Mono, monospace",
          fontSize: "9px",
          color: "#d8d0ba",
        })
        .setOrigin(0.5)
    );
  };
  const iconY = y - 6;
  const moveX = controlX(0);
  keycap(moveX, iconY - 10, "W", 20, 18);
  keycap(moveX - 22, iconY + 10, "A", 20, 18);
  keycap(moveX, iconY + 10, "S", 20, 18);
  keycap(moveX + 22, iconY + 10, "D", 20, 18);
  label(0, gunship ? "W/S SPEED · A/D STEER" : "MOVE");
  mouse(controlX(1), iconY, true);
  label(1, "AIM / FIRE");
  keycap(controlX(2) - 29, iconY, "SPACE", 52, 22);
  keycap(controlX(2) + 31, iconY, "SHIFT", 50, 22);
  label(2, "POP-UP / NAP-OF-EARTH");
  const weaponX = controlX(3);
  for (let i = 0; i < 4; i++) keycap(weaponX - 42 + i * 20, iconY, String(i + 1), 16, 19);
  mouse(weaponX + 46, iconY, false, true);
  label(3, "SELECT WEAPON");
  keycap(controlX(4), iconY, "E", 30, 26);
  label(4, "COUNTERMEASURE");
  keycap(controlX(5), iconY, "M", 30, 26);
  label(5, "MAP");
  keycap(controlX(6), iconY, "T", 30, 26);
  label(6, "THERMAL VISION");
  keycap(controlX(7), iconY, "H", 30, 26);
  label(7, "HELP / TIPS");
  return objects;
}

export function drawControlLegend(scene: Phaser.Scene, width: number, y: number, craft?: CraftSpec): void {
  const panelW = Math.min(1040, width - 64);
  scene.add.container(width / 2, 0, createControlLegend(scene, panelW, y, craft ?? craftOf()));
}
