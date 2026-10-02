import Phaser from "phaser";
import { craftGunId } from "../../../sim/crafts";
import type { MissionScene } from "../../missionScene";

/** Contextual prompts: lift-off, remote launch/recall, dock AGL alert, ARMED tag. */
export class PromptsHud {
  liftPrompt!: Phaser.GameObjects.Text;
  remotePrompt!: Phaser.GameObjects.Text;
  /** "TOO HIGH TO DOCK" while a docking ground remote waits on a too-high host. */
  dockAglAlertTxt!: Phaser.GameObjects.Text;
  remoteArmedTxt!: Phaser.GameObjects.Text;

  constructor(readonly s: MissionScene) {}

  syncLiftPrompt(): void {
    const show = this.s.player.phase === "ready" && !this.s.camera.mapView && !this.s.over;
    this.liftPrompt.setVisible(show);
    if (!show) return;
    const blink = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(this.s.time.now * 0.0075));
    this.liftPrompt.setAlpha(blink);
  }

  syncRemotePrompt(slotTop?: number): void {
    const show =
      !this.s.camera.mapView &&
      !this.s.over &&
      !!this.s.remoteFleet.pilotingRemote() &&
      !this.s.remoteFleet.povHudRemote();
    this.remotePrompt.setVisible(show);
    if (!show) return;
    const armed = this.s.remoteFleet.remoteDetonateArmed();
    const pilotedSpec = this.s.remoteFleet.pilotingRemote()?.spec;
    const gun = !!pilotedSpec && !!craftGunId(pilotedSpec);
    this.remotePrompt.setText(
      gun
        ? "HOLD LMB  FIRE\n1–N / Q  RELEASE"
        : armed
          ? "LMB  DETONATE\nQ / RMB  EXIT VIEW"
          : "Q / RMB  EXIT VIEW"
    );
    const y = slotTop != null ? slotTop - (armed || gun ? 32 : 18) : this.s.scale.height - 96;
    const lp = this.s.hudLocal(this.s.scale.width / 2, y);
    this.remotePrompt.setPosition(lp.x, lp.y);
    const blink = 0.72 + 0.28 * (0.5 + 0.5 * Math.sin(this.s.time.now * 0.006));
    this.remotePrompt.setAlpha(blink);
  }

  /** Player-flown host too high for a docking ground remote. */
  dockAglBlocked(): boolean {
    const pov = this.s.remoteFleet.povDockRemote();
    return this.s.remotes.some((r) => r.dock && !r.detonate && r !== pov && this.s.remoteFleet.groundDockBlocked(r));
  }

  /** Persistent "TOO HIGH TO DOCK" while the player-flown host blocks a ground dock. */
  syncDockAglAlert(): void {
    const show = !this.s.camera.mapView && !this.s.over && this.dockAglBlocked();
    this.dockAglAlertTxt.setVisible(show);
    if (!show) return;
    const lp = this.s.hudLocal(this.s.scale.width / 2, this.s.scale.height - 130);
    this.dockAglAlertTxt.setPosition(lp.x, lp.y);
  }
}
