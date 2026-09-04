import Phaser from "phaser";

/** Bright stats / config values on config rigs. */
export const CFG_VALUE = "#f0e6c8";
/** Muted static information / notes on config rigs. */
export const CFG_INFO = "#8a8470";
/** Live probe readout (cursor / pin) — distinct from config stats. */
export const CFG_LIVE = "#7eb8a0";

const MONO = "Share Tech Mono, monospace";
const ROW_PAD = 11;

type KvPair = [string, string | number];
type KvArg = KvPair | false | null | undefined;

/** Row label + value: `LABEL    value`. */
export function row(label: string, value: string | number = ""): string {
  const lab = label.toUpperCase();
  if (value === "" || value === undefined) return lab;
  return `${lab.padEnd(Math.max(ROW_PAD, lab.length + 1))}${value}`;
}

/** Indented continuation under a row (sub-value block). */
export function rowCont(value: string): string {
  return `${" ".repeat(ROW_PAD)}${value}`;
}

/** One sub-value pair: `(stat: value)`. */
export function kv(stat: string, value: string | number): string {
  return `(${stat}: ${value})`;
}

/** Concatenate sub-value pairs: `(a: 1)(b: 2)`. Falsy entries skipped. */
export function kvs(...pairs: KvArg[]): string {
  let out = "";
  for (const p of pairs) {
    if (!p) continue;
    out += kv(p[0], p[1]);
  }
  return out;
}

export function makeConfigText(
  scene: Phaser.Scene,
  depth: number,
  opts: { fontSize?: string; lineSpacing?: number; color?: string; wrapW?: number } = {}
): Phaser.GameObjects.Text {
  const t = scene.add
    .text(0, 0, "", {
      fontFamily: MONO,
      fontSize: opts.fontSize ?? "12px",
      color: opts.color ?? CFG_VALUE,
      lineSpacing: opts.lineSpacing ?? 4,
      ...(opts.wrapW != null ? { wordWrap: { width: opts.wrapW } } : {}),
    })
    .setScrollFactor(0)
    .setDepth(depth)
    .setVisible(false);
  return t;
}

/** Stack text blocks top-to-bottom (empty blocks collapse). */
export function setStackedTexts(
  layers: { txt: Phaser.GameObjects.Text; lines: string[] }[],
  x: number,
  y: number,
  gap = 10
): void {
  let cy = y;
  for (const layer of layers) {
    const body = layer.lines.join("\n");
    layer.txt.setPosition(x, cy).setText(body);
    if (layer.lines.some((l) => l.length)) cy += layer.txt.height + gap;
  }
}

/** Stats (value color) stacked above info notes (muted). */
export function setStatsAndInfo(
  stats: Phaser.GameObjects.Text,
  info: Phaser.GameObjects.Text,
  statsLines: string[],
  infoLines: string[],
  x: number,
  y: number,
  gap = 10
): void {
  setStackedTexts(
    [
      { txt: stats, lines: statsLines },
      { txt: info, lines: infoLines },
    ],
    x,
    y,
    gap
  );
}
