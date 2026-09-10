import Phaser from "phaser";
import { BalanceRig } from "./balanceRig";
import { CombatRig } from "./combatRig";
import { ToonBlastRig } from "./toonBlastRig";
import { RosterRig } from "./rosterRig";
import { SpriteRig } from "./spriteRig";
import { spritePivot } from "./sprites";

/**
 * Overlay scene for sprite / roster / combat / toon-blast / balance rigs.
 * Launched lazily (first ` or installRigHotkeys warm-up).
 *
 * All rig hotkeys live here (not on menu/mission) so they survive scene
 * restarts — Mission/Menu KeyboardPlugins shut down and wipe their keys.
 */
export class RigsScene extends Phaser.Scene {
  spriteRig!: SpriteRig;
  rosterRig!: RosterRig;
  combatRig!: CombatRig;
  toonBlastRig!: ToonBlastRig;
  balanceRig!: BalanceRig;
  /** True after create() finishes constructing tools. */
  ready = false;
  /** Open sprite rig once create() finishes (first ` raced launch). */
  private pendingOpen = false;
  /** Ignore re-entrant cycle (duplicate listeners / same-frame doubles). */
  private cycling = false;
  private hotkeysBound = false;

  constructor() {
    super("rigs");
  }

  create(): void {
    this.spriteRig = new SpriteRig(this, (key) => spritePivot(key));
    this.rosterRig = new RosterRig(this);
    this.combatRig = new CombatRig(this);
    this.toonBlastRig = new ToonBlastRig(this);
    this.balanceRig = new BalanceRig(this);
    this.ready = true;

    this.bindHotkeys();

    this.input.on("wheel", (_p: unknown, _over: unknown, _dx: number, dy: number) => {
      if (!this.anyOpen() || Math.abs(dy) < 1) return;
      this.activeRig()?.cycle(dy > 0 ? 1 : -1);
    });

    this.bringFront();
    if (this.pendingOpen) {
      this.pendingOpen = false;
      this.spriteRig.toggle();
    }
  }

  /** Bind (or re-bind) rig shortcuts on this scene's keyboard plugin. */
  bindHotkeys(): void {
    const kb = this.input.keyboard;
    if (!kb || this.hotkeysBound) return;
    this.hotkeysBound = true;

    const onBacktick = () => {
      if (!this.ready) {
        this.queueOpen();
        return;
      }
      this.cycle();
      this.bringFront();
    };
    kb.on("keydown-BACKTICK", onBacktick);

    kb.on("keydown-UP", () => {
      if (!this.anyOpen()) return;
      this.activeRig()?.cycle(-1);
    });
    kb.on("keydown-DOWN", () => {
      if (!this.anyOpen()) return;
      this.activeRig()?.cycle(1);
    });
    kb.on("keydown-LEFT", () => {
      if (this.spriteRig.open) this.spriteRig.cycleFrame(-1);
    });
    kb.on("keydown-RIGHT", () => {
      if (this.spriteRig.open) this.spriteRig.cycleFrame(1);
    });

    const zoomIn = () => this.bumpZoom(1);
    const zoomOut = () => this.bumpZoom(-1);
    kb.on("keydown-PLUS", zoomIn);
    kb.on("keydown-EQUALS", zoomIn);
    kb.on("keydown-NUMPAD_ADD", zoomIn);
    kb.on("keydown-MINUS", zoomOut);
    kb.on("keydown-NUMPAD_SUBTRACT", zoomOut);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.hotkeysBound = false;
    });
  }

  private bumpZoom(dir: number): void {
    if (!this.anyOpen()) return;
    if (this.spriteRig.open) this.spriteRig.nudgeZoom(dir);
    else if (this.rosterRig.open) this.rosterRig.nudgeZoom(dir);
    else if (this.combatRig.open) this.combatRig.nudgeZoom(dir);
    else if (this.toonBlastRig.open) this.toonBlastRig.nudgeZoom(dir);
  }

  /** Queue sprite open when ` arrives before create() finishes. */
  queueOpen(): void {
    this.pendingOpen = true;
  }

  update(_t: number, dms: number): void {
    if (!this.anyOpen()) return;
    const dt = Math.min(dms / 1000, 0.05);
    if (this.spriteRig.open) this.spriteRig.update();
    if (this.rosterRig.open) this.rosterRig.update();
    if (this.combatRig.open) this.combatRig.update(dt);
    if (this.toonBlastRig.open) this.toonBlastRig.update(dt);
    if (this.balanceRig.open) this.balanceRig.update();
  }

  anyOpen(): boolean {
    if (!this.ready) return false;
    return (
      this.spriteRig.open ||
      this.rosterRig.open ||
      this.combatRig.open ||
      this.toonBlastRig.open ||
      this.balanceRig.open
    );
  }

  /** ` cycles closed → sprite → roster → combat → toon blast → balance → closed. */
  cycle(): void {
    if (!this.ready) {
      this.pendingOpen = true;
      return;
    }
    if (this.cycling) return;
    this.cycling = true;
    try {
      // Open next before closing current so a throw doesn't leave the UI blank.
      if (this.spriteRig.open) {
        this.rosterRig.toggle();
        this.spriteRig.toggle();
        return;
      }
      if (this.rosterRig.open) {
        this.combatRig.toggle();
        this.rosterRig.toggle();
        return;
      }
      if (this.combatRig.open) {
        this.toonBlastRig.toggle();
        this.combatRig.toggle();
        return;
      }
      if (this.toonBlastRig.open) {
        this.balanceRig.toggle();
        this.toonBlastRig.toggle();
        return;
      }
      if (this.balanceRig.open) {
        this.balanceRig.toggle();
        return;
      }
      this.spriteRig.toggle();
    } catch (e) {
      console.error("[rigs] cycle failed", e);
    } finally {
      this.cycling = false;
    }
  }

  bringFront(): void {
    this.scene.bringToTop();
    // Re-bind if this scene was shut down and relaunched without a fresh create path.
    this.bindHotkeys();
  }

  private activeRig():
    | SpriteRig
    | RosterRig
    | CombatRig
    | ToonBlastRig
    | BalanceRig
    | undefined {
    if (!this.ready) return undefined;
    if (this.spriteRig.open) return this.spriteRig;
    if (this.rosterRig.open) return this.rosterRig;
    if (this.combatRig.open) return this.combatRig;
    if (this.toonBlastRig.open) return this.toonBlastRig;
    if (this.balanceRig.open) return this.balanceRig;
    return undefined;
  }
}

/** Launch once; returns the shared scene (may still be booting). */
export function ensureRigs(from: Phaser.Scene): RigsScene {
  let s = from.scene.get("rigs") as RigsScene | null;
  if (!s || !s.sys.isActive()) {
    from.scene.launch("rigs");
    s = from.scene.get("rigs") as RigsScene;
  }
  s.bringFront();
  return s;
}

export function getRigs(from: Phaser.Scene): RigsScene | undefined {
  const s = from.scene.get("rigs") as RigsScene | null;
  if (!s || !s.sys.isActive()) return undefined;
  return s;
}

export function rigsAnyOpen(from: Phaser.Scene): boolean {
  return !!getRigs(from)?.anyOpen();
}

/**
 * Warm-launch the rigs overlay from menu/mission create.
 * Hotkeys live on RigsScene so they survive mission/menu restarts.
 */
export function installRigHotkeys(from: Phaser.Scene): void {
  ensureRigs(from);
}
