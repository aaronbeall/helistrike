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

    const kb = this.input.keyboard;
    if (kb) {
      // Navigation only while a rig is open (open/cycle hotkeys live on menu/mission).
      kb.addKey(Phaser.Input.Keyboard.KeyCodes.OPEN_BRACKET).on("down", () => {
        if (!this.anyOpen()) return;
        this.activeRig()?.cycle(-1);
      });
      kb.addKey(Phaser.Input.Keyboard.KeyCodes.CLOSED_BRACKET).on("down", () => {
        if (!this.anyOpen()) return;
        this.activeRig()?.cycle(1);
      });
      kb.addKey(Phaser.Input.Keyboard.KeyCodes.UP).on("down", () => {
        if (!this.anyOpen()) return;
        this.activeRig()?.cycle(-1);
      });
      kb.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN).on("down", () => {
        if (!this.anyOpen()) return;
        this.activeRig()?.cycle(1);
      });
      kb.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT).on("down", () => {
        if (this.spriteRig.open) this.spriteRig.cycleFrame(-1);
      });
      kb.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT).on("down", () => {
        if (this.spriteRig.open) this.spriteRig.cycleFrame(1);
      });

      const bumpZoom = (dir: number) => {
        if (this.rosterRig.open) this.rosterRig.nudgeZoom(dir);
        else if (this.combatRig.open) this.combatRig.nudgeZoom(dir);
        else if (this.toonBlastRig.open) this.toonBlastRig.nudgeZoom(dir);
      };
      kb.addKey(Phaser.Input.Keyboard.KeyCodes.PLUS).on("down", () => bumpZoom(1));
      kb.addKey(Phaser.Input.Keyboard.KeyCodes.NUMPAD_ADD).on("down", () => bumpZoom(1));
      kb.addKey(Phaser.Input.Keyboard.KeyCodes.MINUS).on("down", () => bumpZoom(-1));
      kb.addKey(Phaser.Input.Keyboard.KeyCodes.NUMPAD_SUBTRACT).on("down", () => bumpZoom(-1));
    }

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

const HOTKEY_FLAG = "__rigHotkeys";

/** ` on menu or mission — warm-launches the overlay so the first press isn't a no-op. */
export function installRigHotkeys(from: Phaser.Scene): void {
  const kb = from.input.keyboard;
  if (!kb || (from as unknown as Record<string, boolean>)[HOTKEY_FLAG]) return;
  (from as unknown as Record<string, boolean>)[HOTKEY_FLAG] = true;

  ensureRigs(from);

  kb.addKey(Phaser.Input.Keyboard.KeyCodes.BACKTICK).on("down", () => {
    const rigs = ensureRigs(from);
    if (!rigs.ready) {
      rigs.queueOpen();
      return;
    }
    rigs.cycle();
    rigs.bringFront();
  });
}
