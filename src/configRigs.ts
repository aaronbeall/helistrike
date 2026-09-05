import Phaser from "phaser";
import { CombatConfigTool } from "./combatConfig";
import { RosterConfigTool } from "./rosterConfig";
import { SpriteConfigTool } from "./spriteConfig";
import { spritePivot } from "./sprites";

/**
 * Overlay scene for sprite / roster / combat config rigs.
 * Launched lazily (first ` or installConfigRigHotkeys warm-up).
 */
export class ConfigRigsScene extends Phaser.Scene {
  spriteCfg!: SpriteConfigTool;
  rosterCfg!: RosterConfigTool;
  combatCfg!: CombatConfigTool;
  /** True after create() finishes constructing tools. */
  ready = false;
  /** Open sprite rig once create() finishes (first ` raced launch). */
  private pendingOpen = false;
  /** Ignore re-entrant cycle (duplicate listeners / same-frame doubles). */
  private cycling = false;

  constructor() {
    super("configRigs");
  }

  create(): void {
    this.spriteCfg = new SpriteConfigTool(this, (key) => spritePivot(key));
    this.rosterCfg = new RosterConfigTool(this);
    this.combatCfg = new CombatConfigTool(this);
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
        if (this.spriteCfg.open) this.spriteCfg.cycleFrame(-1);
      });
      kb.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT).on("down", () => {
        if (this.spriteCfg.open) this.spriteCfg.cycleFrame(1);
      });

      const bumpZoom = (dir: number) => {
        if (this.rosterCfg.open) this.rosterCfg.nudgeZoom(dir);
        else if (this.combatCfg.open) this.combatCfg.nudgeZoom(dir);
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
      this.spriteCfg.toggle();
    }
  }

  /** Queue sprite open when ` arrives before create() finishes. */
  queueOpen(): void {
    this.pendingOpen = true;
  }

  update(_t: number, dms: number): void {
    if (!this.anyOpen()) return;
    if (this.spriteCfg.open) this.spriteCfg.update();
    if (this.rosterCfg.open) this.rosterCfg.update();
    if (this.combatCfg.open) this.combatCfg.update(Math.min(dms / 1000, 0.05));
  }

  anyOpen(): boolean {
    if (!this.ready) return false;
    return this.spriteCfg.open || this.rosterCfg.open || this.combatCfg.open;
  }

  /** ` cycles closed → sprite → roster → combat → closed. */
  cycle(): void {
    if (!this.ready) {
      this.pendingOpen = true;
      return;
    }
    if (this.cycling) return;
    this.cycling = true;
    try {
      // Open next before closing current so a throw doesn't leave the UI blank.
      if (this.spriteCfg.open) {
        this.rosterCfg.toggle();
        this.spriteCfg.toggle();
        return;
      }
      if (this.rosterCfg.open) {
        this.combatCfg.toggle();
        this.rosterCfg.toggle();
        return;
      }
      if (this.combatCfg.open) {
        this.combatCfg.toggle();
        return;
      }
      this.spriteCfg.toggle();
    } catch (e) {
      console.error("[configRigs] cycle failed", e);
    } finally {
      this.cycling = false;
    }
  }

  bringFront(): void {
    this.scene.bringToTop();
  }

  private activeRig(): SpriteConfigTool | RosterConfigTool | CombatConfigTool | undefined {
    if (!this.ready) return undefined;
    if (this.spriteCfg.open) return this.spriteCfg;
    if (this.rosterCfg.open) return this.rosterCfg;
    if (this.combatCfg.open) return this.combatCfg;
    return undefined;
  }
}

/** Launch once; returns the shared scene (may still be booting). */
export function ensureConfigRigs(from: Phaser.Scene): ConfigRigsScene {
  let s = from.scene.get("configRigs") as ConfigRigsScene | null;
  if (!s || !s.sys.isActive()) {
    from.scene.launch("configRigs");
    s = from.scene.get("configRigs") as ConfigRigsScene;
  }
  s.bringFront();
  return s;
}

export function getConfigRigs(from: Phaser.Scene): ConfigRigsScene | undefined {
  const s = from.scene.get("configRigs") as ConfigRigsScene | null;
  if (!s || !s.sys.isActive()) return undefined;
  return s;
}

export function configRigsAnyOpen(from: Phaser.Scene): boolean {
  return !!getConfigRigs(from)?.anyOpen();
}

const HOTKEY_FLAG = "__configRigHotkeys";

/** ` on menu or mission — warm-launches the overlay so the first press isn't a no-op. */
export function installConfigRigHotkeys(from: Phaser.Scene): void {
  const kb = from.input.keyboard;
  if (!kb || (from as unknown as Record<string, boolean>)[HOTKEY_FLAG]) return;
  (from as unknown as Record<string, boolean>)[HOTKEY_FLAG] = true;

  ensureConfigRigs(from);

  kb.addKey(Phaser.Input.Keyboard.KeyCodes.BACKTICK).on("down", () => {
    const rigs = ensureConfigRigs(from);
    if (!rigs.ready) {
      rigs.queueOpen();
      return;
    }
    rigs.cycle();
    rigs.bringFront();
  });
}
