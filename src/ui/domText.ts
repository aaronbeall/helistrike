import type Phaser from "phaser";

/** Debug text as a DOM <pre> over the canvas: no canvas raster or texture upload per update (unlike Phaser Text). */
export class DomText {
  private el: HTMLPreElement;
  private shown = "";

  /** `x`, `y`, `fontPx` in game coordinates; re-laid out against the canvas on each update. */
  constructor(
    private readonly game: Phaser.Game,
    private readonly x: number,
    private readonly y: number,
    private readonly fontPx: number,
    color: string
  ) {
    this.el = document.createElement("pre");
    Object.assign(this.el.style, {
      position: "fixed",
      margin: "0",
      pointerEvents: "none",
      fontFamily: "Share Tech Mono, monospace",
      color,
      textShadow: "0 0 3px #101418, 0 0 3px #101418",
      whiteSpace: "pre",
      zIndex: "10",
      display: "none",
    });
    document.body.appendChild(this.el);
  }

  get text(): string {
    return this.shown;
  }

  setText(text: string): this {
    if (text !== this.shown) {
      this.shown = text;
      this.el.textContent = text;
    }
    this.layout();
    return this;
  }

  setVisible(on: boolean): this {
    this.el.style.display = on ? "block" : "none";
    if (on) this.layout();
    return this;
  }

  destroy(): void {
    this.el.remove();
  }

  private layout(): void {
    const canvas = this.game.canvas;
    const r = canvas.getBoundingClientRect();
    const k = r.width / this.game.scale.width;
    this.el.style.left = `${r.left + this.x * k}px`;
    this.el.style.top = `${r.top + this.y * k}px`;
    this.el.style.fontSize = `${this.fontPx * k}px`;
  }
}
