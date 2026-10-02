import Phaser from "phaser";
import { type FxClass } from "../fx/fx";
import { thermalSignalTint, setThermalPipeline, type ThermalPalette } from "../../../render/thermal";
import { PLAYER_WPNS, type Shot } from "../../../sim/combat";
import type { MissionScene } from "../../missionScene";

/** Thermal view: toggle, sensor palette + shot-linger, camera pipeline, thermal blend + particle tint. */
export class ThermalMode {
  fx?: Phaser.FX.ColorMatrix;
  on = false;
  /** Player toggled thermal with T (persists across sensor-view overlays). */
  manual = false;
  palette: ThermalPalette = "white_hot";
  /** Keep thermal/sensor palette during povCam impact linger after the shot is gone. */
  sensorLingerPalette: ThermalPalette | null = null;
  sensorLingerT = 0;

  constructor(readonly s: MissionScene) {}

  /** Per-mission state reset (called from the scene's init). */
  reset(): void {
    this.sensorLingerPalette = null;
    this.sensorLingerT = 0;
    this.on = false;
    this.manual = false;
    this.palette = "white_hot";
  }

  toggle(): void {
    this.manual = !this.manual;
    this.apply();
  }

  /** Craft-owned thermal look (sensor cams + T share this; linger must not override it). */
  craftSensorPalette(): ThermalPalette {
    return (
      this.s.remoteFleet.pilotingRemote()?.spec.sensorPalette ?? this.s.player.spec.sensorPalette ?? "white_hot"
    );
  }

  /** True when a remote or seeker cam wants thermal (palette always craft thermal). */
  activeSensorThermal(): boolean {
    const remote = this.s.remoteFleet.activeRemote();
    if (remote?.spec.thermal && this.s.remoteFleet.remoteCamT > 0.2) return true;
    return !!this.activeSensorShot();
  }

  /** Active Spike / Spectre / warp sensor projectile, preferring the selected weapon. */
  activeSensorShot(): Shot | undefined {
    const selected = this.s.loadout[this.s.player.weapon];
    if (selected?.cam.thermal) {
      const mine = this.s.shots.find(
        (s) =>
          s.from === "player" &&
          s.wpnId === selected.id &&
          !!s.st &&
          !s.st.bomblet
      );
      if (mine) return mine;
    }
    for (let i = this.s.shots.length - 1; i >= 0; i--) {
      const s = this.s.shots[i]!;
      if (s.from !== "player" || !s.wpnId || !s.st || s.st.bomblet) continue;
      if (PLAYER_WPNS[s.wpnId]?.cam.thermal) return s;
    }
    return undefined;
  }

  /** Enable/disable thermal from manual T and/or weapon sensorView. */
  apply(): void {
    const sensorOn = this.activeSensorThermal();
    const lingerOn = this.sensorLingerT > 0 && this.sensorLingerPalette != null;
    const want = this.manual || sensorOn || lingerOn;
    const palette: ThermalPalette = lingerOn
      ? this.sensorLingerPalette!
      : this.craftSensorPalette();
    if (want === this.on && (!want || this.palette === palette)) return;

    this.on = want;
    this.palette = palette;
    const cam = this.s.cameras.main;
    if (this.on) {
      const customPipeline = setThermalPipeline(cam, true, palette);
      if (customPipeline) this.fx?.reset();
      else {
        if (!this.fx) this.fx = cam.postFX.addColorMatrix();
        this.fx.set([
          0.34, 0.58, 0.08, 0, -0.08,
          0.34, 0.58, 0.08, 0, -0.06,
          0.34, 0.58, 0.08, 0, -0.02,
          0, 0, 0, 1, 0,
        ]);
      }
      this.s.groundMarks.syncAllThermalWreckMarks();
      this.s.countermeasures.syncSmokePuffSprites();
      this.s.postFx.apply();
      this.applyFxBlendMode();
    } else {
      setThermalPipeline(cam, false);
      this.fx?.reset();
      this.s.groundMarks.syncAllThermalWreckMarks();
      this.s.countermeasures.syncSmokePuffSprites();
      this.s.postFx.apply();
      this.applyFxBlendMode();
    }
    this.s.debugMenu.sync();
  }

  /**
   * Thermal needs fill-tint + NORMAL so smoke/fire/dust encode as semantic heat.
   * ADD/multiply warm colors read dull/cold in the thermal shader.
   */
  applyFxBlendMode(): void {
    for (const kind of Object.keys(this.s.fx.policies) as FxClass[]) {
      for (const em of this.s.fx.policies[kind].emitters) {
        if (this.on) {
          if (!this.s.fx.thermalSaved.has(em)) {
            this.s.fx.thermalSaved.set(em, {
              blendMode: em.blendMode as Phaser.BlendModes | string,
              tintFill: em.tintFill,
            });
          }
          em.tintFill = true;
          em.setBlendMode(Phaser.BlendModes.NORMAL);
        } else {
          const saved = this.s.fx.thermalSaved.get(em);
          if (!saved) continue;
          em.tintFill = saved.tintFill;
          em.setBlendMode(saved.blendMode as Phaser.BlendModes);
        }
      }
    }
  }

  /** After particle ops run: stamp semantic heat (fire hot, dust medium, smoke cools). */
  tintParticles(): void {
    if (!this.on) return;
    const sparkTint = thermalSignalTint(0.9);
    const dustTint = thermalSignalTint(0.42);
    for (const em of this.s.fx.policies.fire.emitters) {
      em.forEachAlive((p) => {
        const age = 1 - Phaser.Math.Clamp(p.lifeCurrent / Math.max(1, p.life), 0, 1);
        p.tint = thermalSignalTint(Phaser.Math.Linear(1, 0.78, age));
      }, this.s);
    }
    for (const em of this.s.fx.policies.short.emitters) {
      em.forEachAlive((p) => {
        p.tint = sparkTint;
      }, this.s);
    }
    for (const em of this.s.fx.policies.dust.emitters) {
      em.forEachAlive((p) => {
        p.tint = dustTint;
      }, this.s);
    }
    for (const em of this.s.fx.policies.smoke.emitters) {
      em.forEachAlive((p) => {
        const age = 1 - Phaser.Math.Clamp(p.lifeCurrent / Math.max(1, p.life), 0, 1);
        // Keep rocket / trail smoke readable in FLIR (was cooling to nearly black).
        p.tint = thermalSignalTint(Phaser.Math.Linear(0.62, 0.28, age));
      }, this.s);
    }
  }
}
