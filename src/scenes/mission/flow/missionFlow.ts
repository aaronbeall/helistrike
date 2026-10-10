import Phaser from "phaser";
import { Layer } from "../../../render/depth";
import type { MissionScene } from "../../missionScene";

type StingerJob = {
  title: string;
  detail: string;
  color: number;
  duration: number;
  target?: { x: number; y: number; z?: number };
  done?: () => void;
  /** Subtle = no bar, quieter type; Space frees cam/message early (time warp stays). */
  style?: "dramatic" | "subtle";
};

/** Mission flow: stinger title cards (+ stinger camera), exit menu, mission end + end prompt. */
export class MissionFlow {
  win = false;
  stingerRoot?: Phaser.GameObjects.Container;
  stingerText?: Phaser.GameObjects.Text;
  stingerT = 0;
  stingerDuration = 0;
  stingerDone?: () => void;
  stingerTarget?: { x: number; y: number; z?: number };
  /** Queued while another stinger is on screen. */
  stingerQueue: StingerJob[] = [];
  stingerStyle: "dramatic" | "subtle" = "dramatic";
  /** Space dismissed subtle stinger chrome/cam early; timer (time warp) continues. */
  stingerReleased = false;
  /**
   * Subtle Space-dismiss is armed only after Space goes up once (so a held climb
   * key doesn't eat the focus cam) and after the arrive window.
   */
  stingerSpaceArmed = false;
  /** Look offset when the current stinger started — ease from here, not from the player. */
  stingerCamFromX = 0;
  stingerCamFromY = 0;
  /** Focus altitude when the stinger started — ease with look so 2.5D scale doesn't pop. */
  stingerCamFromZ = 0;
  /** Live blended focus Z while a stinger owns the cam. */
  stingerFocusZ = 0;
  /** End-screen prompt (BIRD DOWN / MISSION COMPLETE) — sim keeps running. */
  endPromptRoot?: Phaser.GameObjects.Container;
  exitOpen = false;
  exitRoot!: Phaser.GameObjects.Container;
  exitButton!: Phaser.GameObjects.Text;

  constructor(readonly s: MissionScene) {}

  /** Per-mission state reset (called from the scene's init). */
  reset(): void {
    this.win = false;
    this.stingerRoot = undefined;
    this.stingerText = undefined;
    this.stingerT = 0;
    this.stingerDuration = 0;
    this.stingerDone = undefined;
    this.stingerTarget = undefined;
    this.stingerQueue = [];
    this.endPromptRoot = undefined;
    this.stingerReleased = false;
    this.stingerSpaceArmed = false;
    this.stingerCamFromX = 0;
    this.stingerCamFromY = 0;
    this.stingerCamFromZ = 0;
    this.stingerFocusZ = 0;
    this.exitOpen = false;
  }

  setupExitMenu(): void {
    // Screen chrome only — no craft art. Text canvases get exit_* names.
    const { width: w, height: h } = this.s.scale;
    const panel = this.s.add
      .rectangle(w / 2, h / 2, 360, 210, 0x0b0a08, 0.96)
      .setStrokeStyle(2, 0xe8b84a, 0.9);
    const title = this.s.add
      .text(w / 2, h / 2 - 70, "PAUSED", {
        fontFamily: "Black Ops One, Impact, sans-serif",
        fontSize: "30px",
        color: "#e8b84a",
      })
      .setOrigin(0.5);
    const resume = this.s.add
      .text(w / 2, h / 2 - 10, "[ RESUME ]", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "18px",
        color: "#e8e0cc",
        backgroundColor: "#252017",
        padding: { x: 18, y: 8 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    const selection = this.s.add
      .text(w / 2, h / 2 + 48, "[ RETURN TO SELECTION ]", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "16px",
        color: "#ffb05a",
        backgroundColor: "#2b1710",
        padding: { x: 18, y: 8 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    resume.on("pointerdown", () => this.toggleExitMenu(false));
    selection.on("pointerdown", () => this.s.scene.start("menu"));
    this.exitRoot = this.s.add
      .container(0, 0, [panel, title, resume, selection])
      .setDepth(Layer.HUD + 600)
      .setScrollFactor(0)
      .setVisible(false);
    this.exitButton = this.s.add
      .text(w - 140, 12, "[ ESC ]  MENU", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "13px",
        color: "#d8d0ba",
        backgroundColor: "#12100c",
        padding: { x: 8, y: 5 },
      })
      .setOrigin(1, 0)
      .setDepth(Layer.HUD + 200)
      .setScrollFactor(0);
  }

  toggleExitMenu(force?: boolean): void {
    const want = force ?? !this.exitOpen;
    if (want && (this.s.camera.mapWant || this.s.camera.mapBlend > 0.02)) return;
    if (want && this.s.help.open) this.s.help.toggle(false);
    this.exitOpen = want;
    this.exitRoot.setVisible(want);
    this.s.input.setDefaultCursor(want ? "default" : "none");
  }

  showStinger(
    title: string,
    detail: string,
    color: number,
    duration: number,
    target?: { x: number; y: number; z?: number },
    done?: () => void,
    style: "dramatic" | "subtle" = "dramatic"
  ): void {
    if (this.stingerT > 0) {
      this.stingerQueue.push({ title, detail, color, duration, target, done, style });
      return;
    }
    this.presentStinger({ title, detail, color, duration, target, done, style });
  }

  presentStinger(job: StingerJob): void {
    this.stingerRoot?.destroy(true);
    const { width, height } = this.s.scale;
    const style = job.style ?? "dramatic";
    this.stingerStyle = style;
    this.stingerReleased = false;
    // Held Space (climb) must release before subtle dismiss can fire.
    this.stingerSpaceArmed = !this.s.keySpace?.isDown;
    // Ease from current look / focus altitude (e.g. gunship AGL), never snap 2.5D scale.
    this.stingerCamFromX = this.s.camera.lookCamX;
    this.stingerCamFromY = this.s.camera.lookCamY;
    this.stingerCamFromZ = this.s.camera.camAnchor().z;
    this.stingerFocusZ = this.stingerCamFromZ;
    const kids: Phaser.GameObjects.GameObject[] = [];
    if (style === "dramatic") {
      kids.push(this.s.add.rectangle(width / 2, height / 2, width, 92, 0x090908, 0.82));
      kids.push(this.s.add.rectangle(width / 2, height / 2 - 46, width, 2, job.color, 0.9));
      kids.push(this.s.add.rectangle(width / 2, height / 2 + 46, width, 2, job.color, 0.9));
    }
    const titleSize = style === "subtle" ? "26px" : "38px";
    const titleAlpha = style === "subtle" ? 0.88 : 1;
    const text = this.s.add
      .text(width / 2, height / 2 - (style === "subtle" ? 4 : 8), job.title, {
        fontFamily: "Black Ops One, Impact, sans-serif",
        fontSize: titleSize,
        color: `#${job.color.toString(16).padStart(6, "0")}`,
        align: "center",
      })
      .setOrigin(0.5)
      .setAlpha(titleAlpha);
    const sub = this.s.add
      .text(width / 2, height / 2 + (style === "subtle" ? 22 : 26), job.detail, {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: style === "subtle" ? "12px" : "14px",
        color: style === "subtle" ? "#c8c0aa" : "#e8e0cc",
      })
      .setOrigin(0.5)
      .setAlpha(style === "subtle" ? 0.82 : 1);
    if (style === "subtle") {
      text.setStroke("#0c0a08", 5).setShadow(0, 2, "#000000", 8, true, true);
      sub.setStroke("#0c0a08", 4).setShadow(0, 2, "#000000", 6, true, true);
    }
    kids.push(text, sub);
    const root = this.s.add
      .container(0, 0, kids)
      .setScrollFactor(0)
      .setDepth(Layer.HUD + 80)
      .setAlpha(0);
    // Children were bindWorld'd on add — retarget the whole tree to hudCam.
    this.s.markHudTree(root);
    this.stingerRoot = root;
    this.stingerText = text;
    this.stingerT = job.duration;
    this.stingerDuration = job.duration;
    this.stingerTarget = job.target;
    this.stingerDone = job.done;
  }

  /** Subtle objective stinger: Space frees camera + hides banner; time warp keeps running. */
  releaseSubtleStingerEarly(): void {
    if (this.stingerT <= 0 || this.stingerStyle !== "subtle" || this.stingerReleased) return;
    this.stingerReleased = true;
    this.stingerTarget = undefined;
    this.stingerRoot?.setVisible(false);
  }

  tickStinger(wallDt: number): void {
    if (this.stingerT <= 0 || !this.stingerRoot) return;
    const elapsedBefore = this.stingerDuration - this.stingerT;
    if (this.stingerStyle === "subtle" && !this.stingerReleased) {
      // Spectre POV: Space is unused by the drone and was eating the focus cam
      // (mission complete is dramatic → no Space dismiss). Keep focus while remoteView.
      if (this.s.remoteFleet.remoteView) {
        this.stingerSpaceArmed = false;
      } else if (!this.stingerSpaceArmed) {
        if (!this.s.keySpace.isDown) this.stingerSpaceArmed = true;
      } else if (
        // Let arrive finish before Space can drop the focus.
        elapsedBefore >= 0.55 &&
        Phaser.Input.Keyboard.JustDown(this.s.keySpace)
      ) {
        this.releaseSubtleStingerEarly();
      }
    }
    this.stingerT = Math.max(0, this.stingerT - wallDt);
    const elapsed = this.stingerDuration - this.stingerT;
    const fadeIn = Phaser.Math.Clamp(elapsed / 0.12, 0, 1);
    const fadeOut = Phaser.Math.Clamp(this.stingerT / 0.22, 0, 1);
    if (!this.stingerReleased) {
      this.stingerRoot.setAlpha(Math.min(fadeIn, fadeOut));
    }
    if (this.stingerText && !this.stingerReleased) {
      this.stingerText.setScale(Phaser.Math.Linear(1.12, 1, Phaser.Math.Clamp(elapsed / 0.3, 0, 1)));
    }
    if (this.stingerT === 0) {
      this.stingerRoot.destroy(true);
      this.stingerRoot = undefined;
      this.stingerText = undefined;
      this.stingerTarget = undefined;
      this.stingerReleased = false;
      this.stingerSpaceArmed = false;
      const done = this.stingerDone;
      this.stingerDone = undefined;
      done?.();
      const next = this.stingerQueue.shift();
      if (next) this.presentStinger(next);
    }
  }

  end(win: boolean): void {
    this.s.stats.finish(win ? "succeeded" : "failed");
    if (win) {
      // May already be over from mission-success lockout during the stinger.
      if (this.endPromptRoot) return;
      this.s.over = true;
      this.win = true;
      this.s.reticleHud.hideAimChrome();
      const { width, height } = this.s.scale;
      const title = this.s.add
        .text(width / 2, height / 2 - 18, "MISSION COMPLETE", {
          fontFamily: "Black Ops One, Impact, sans-serif",
          fontSize: "42px",
          color: "#e8b84a",
          align: "center",
        })
        .setOrigin(0.5);
      const sub = this.s.add
        .text(width / 2, height / 2 + 28, "R  RESTART      ESC  MENU", {
          fontFamily: "Share Tech Mono, monospace",
          fontSize: "16px",
          color: "#e8e0cc",
          align: "center",
        })
        .setOrigin(0.5);
      this.endPromptRoot = this.s.add
        .container(0, 0, [title, sub])
        .setScrollFactor(0)
        .setDepth(Layer.HUD + 50);
      this.s.markHudTree(this.endPromptRoot);
      return;
    }
    if (this.s.over) return;
    this.s.over = true;
    this.win = false;
    this.s.reticleHud.hideAimChrome();
    this.endPromptRoot?.destroy(true);
    this.endPromptRoot = undefined;
    // After crash sequence: stinger replaces the old centered R/Esc dialog.
    this.stingerQueue = [];
    this.stingerDone = undefined;
    this.presentStinger({
      title: "AIRCRAFT DOWN",
      detail: "R  RESTART      ESC  MENU",
      color: 0xff6a3a,
      // Hold until restart / menu — effectively persistent.
      duration: 1e9,
    });
  }
}
