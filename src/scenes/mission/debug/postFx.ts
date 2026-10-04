import Phaser from "phaser";
import type { MissionScene } from "../../missionScene";

/** Survives MissionScene restart (R → load → mission). */
let persistedFxOn = true;

/** Test post-FX toggle (O): bloom + barrel pulse on the main camera. */
export class PostFxTest {
  /** Camera post-FX (toggle with F). */
  bloom?: Phaser.FX.Bloom;
  barrel?: Phaser.FX.Barrel;
  on = true;
  barrelPulse = 0;
  hud!: Phaser.GameObjects.Text;

  constructor(readonly s: MissionScene) {}

  /** Per-mission state reset (called from the scene's init). */
  reset(): void {
    this.bloom = undefined;
    this.barrel = undefined;
    this.on = persistedFxOn;
    this.barrelPulse = 0;
  }

  setup(): void {
    this.apply();
  }

  toggle(): void {
    this.on = !this.on;
    persistedFxOn = this.on;
    if (!this.on) this.barrelPulse = 0;
    this.apply();
    this.syncHud();
    this.s.debugMenu.sync();
  }

  apply(): void {
    const cam = this.s.cameras.main;
    // Phaser bloom blends with mix(scene, bloom*strength, 0.5). Strength 0 ⇒ mix with black
    // ⇒ a permanent faded frame. setActive(false) is unreliable, so remove FX entirely when off.
    const wantBloom = this.on;
    const wantBarrel = this.on;
    if (wantBloom) {
      if (this.bloom) {
        cam.postFX.remove(this.bloom);
        this.bloom = undefined;
      }
      if (this.s.thermal.on) {
        // Cheap neutral bloom on the thermal image — white, low strength, single blur pass.
        this.bloom = cam.postFX.addBloom(0xffffff, 1.1, 1.1, 0.55, 0.32, 1);
      } else {
        this.bloom = cam.postFX.addBloom(0xffe6b0, 1.1, 1.1, 1.0, 0.85, 3);
      }
    } else if (this.bloom) {
      cam.postFX.remove(this.bloom);
      this.bloom = undefined;
    }
    if (wantBarrel) {
      if (!this.barrel) {
        this.barrel = cam.postFX.addBarrel(1);
      } else {
        this.barrel.setActive(true);
        this.barrel.amount = 1;
      }
    } else if (this.barrel) {
      cam.postFX.remove(this.barrel);
      this.barrel = undefined;
    }
  }

  pulseBarrel(amount: number): void {
    if (!this.barrel || !this.on) return;
    this.barrelPulse = Math.max(this.barrelPulse, Phaser.Math.Clamp(amount, 0, 0.7));
  }

  tick(dt: number): void {
    if (!this.on || !this.barrel) return;
    if (this.barrelPulse > 0.002) {
      this.barrel.amount = 1 + this.barrelPulse;
      this.barrelPulse *= Math.pow(0.04, dt);
    } else {
      this.barrel.amount = 1;
      this.barrelPulse = 0;
    }
  }

  syncHud(): void {
    if (!this.hud) return;
    this.hud.setText(`FX  O  ${this.on ? "ON" : "off"}`);
  }
}
