
import Phaser from "phaser";

import { heightOf } from "../../../sim/combat";
import { Layer, ZOff, worldDepth } from "../../../render/depth";
import { isNeutral, isOrganic } from "../../../sim/roster";
import { worldToScreen, cameraPointVisible } from "../../../worldgen/world";
import type { MissionScene } from "../../missionScene";
import { BATTERY_ICON_W, drawBatteryIcon } from "../../../render/icons";

/** World-space bars: unit HP bars, remote battery icons. */
export class FieldBars {
  hpGfx!: Phaser.GameObjects.Graphics;

  constructor(readonly s: MissionScene) {}

  draw(): void {
    const g = this.hpGfx;
    g.clear();
    g.setDepth(Layer.FIELD);
    for (const u of this.s.units) {
      if (u.dead || u.health >= u.max - 0.5 || isNeutral(u.kind)) continue;
      if (!cameraPointVisible(u.z, u.y)) continue;
      const at = worldToScreen(u.x, u.y, u.z);
      const zs = at.scale;
      const w = (isOrganic(u.kind) ? 16 : 32) * zs;
      const ratio = Phaser.Math.Clamp(u.health / u.max, 0, 1);
      const x = at.x - w / 2;
      const y = at.y - heightOf(u.kind) * 0.35 * zs - 14 * zs;
      g.fillStyle(0x10100c, 0.7);
      g.fillRect(x, y, w, 4 * zs);
      g.fillStyle(ratio > 0.5 ? 0x6dbb4a : ratio > 0.25 ? 0xe8b84a : 0xff4a2a, 1);
      g.fillRect(x, y, w * ratio, 4 * zs);
    }
    for (const r of this.s.remotes) {
      if (r.detonate) continue;
      if (!cameraPointVisible(r.z, r.y)) continue;
      const at = worldToScreen(r.x, r.y, r.z);
      const zs = at.scale;
      const batY = at.y - r.spec.height * zs - 22 * zs;
      if (r.health < r.spec.health - 0.5) {
        const hw = 26.4 * zs;
        const hr = Phaser.Math.Clamp(r.health / Math.max(1, r.spec.health), 0, 1);
        const hx = at.x - hw / 2;
        // Sits above the battery; takes its slot when there is none.
        const hy = r.spec.unlimitedLife ? batY + 2 * zs : batY - 6 * zs;
        g.fillStyle(0x10100c, 0.7);
        g.fillRect(hx, hy, hw, 4 * zs);
        g.fillStyle(hr > 0.5 ? 0x6dbb4a : hr > 0.25 ? 0xe8b84a : 0xff4a2a, 1);
        g.fillRect(hx, hy, hw * hr, 4 * zs);
      }
      if (r.spec.unlimitedLife) continue;
      drawBatteryIcon(this.s.time, g, at.x - BATTERY_ICON_W * zs * 0.5, batY, r.life / Math.max(0.05, r.lifeMax), zs);
    }
    const armed = this.s.remoteFleet.remoteDetonateArmed();
    const drone = armed ? this.s.remoteFleet.activeRemote() : undefined;
    if (!drone || !cameraPointVisible(drone.z, drone.y) || this.s.camera.mapView || this.s.over) {
      this.s.prompts.remoteArmedTxt.setVisible(false);
    } else {
      const at = worldToScreen(drone.x, drone.y, drone.z);
      const zs = at.scale;
      const blink = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(this.s.time.now * 0.014));
      this.s.prompts.remoteArmedTxt
        .setVisible(true)
        .setText("ARMED")
        .setPosition(
          at.x,
          at.y - drone.spec.height * zs - (drone.health < drone.spec.health - 0.5 ? 40 : 34) * zs
        )
        .setScale(zs)
        .setAlpha(blink)
        .setDepth(worldDepth(drone.z, ZOff.body + 2, drone.y));
    }
  }

}

/** Mission-scene tuning constants shared by subsystems. */
