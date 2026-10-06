import type Phaser from "phaser";

/** `setColor` only when the color changes: Phaser re-rasterizes a Text (canvas redraw + texture upload) on every call. */
export function setTextColor(t: Phaser.GameObjects.Text, color: string): Phaser.GameObjects.Text {
  return t.style.color === color ? t : t.setColor(color);
}
