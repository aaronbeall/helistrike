import Phaser from "phaser";

/** Bright stats / config values on config rigs. */
export const CFG_VALUE = "#f0e6c8";
/** Muted static information / notes on config rigs. */
export const CFG_INFO = "#8a8470";
/** Live probe readout (cursor / pin) — distinct from config stats. */
export const CFG_LIVE = "#7eb8a0";

const MONO = "Share Tech Mono, monospace";
/** Column width for `row` labels — sized for camelCase field names (`homePlayer`, …). */
const ROW_PAD = 14;
const DUMP_MAX_DEPTH = 6;
const NEST_INDENT = 2;

type KvPair = [string, string | number];
type KvArg = KvPair | false | null | undefined;

export type DumpFormat = (key: string, value: unknown) => string | number | undefined;

export interface DumpOpts {
  /** Top-level (or any-depth) keys to omit — e.g. `notes` for info panels. */
  skip?: string[];
  /** Leaf override; return a value to print instead of recursing. */
  format?: DumpFormat;
  /** Max nest depth (default 6). */
  depth?: number;
}

/** Row label + value: `fieldName    value` (label = code field name, preserved as-is). */
export function row(label: string, value: string | number = ""): string {
  if (value === "" || value === undefined) return label;
  return `${label.padEnd(Math.max(ROW_PAD, label.length + 1))}${value}`;
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

/** `rotOff` radians → `N.NNπ` for dumpConfig `format`. */
export function formatRotOff(key: string, value: unknown): string | number | undefined {
  if (key === "rotOff" && typeof value === "number") return `${(value / Math.PI).toFixed(2)}π`;
  return undefined;
}

/**
 * Walk a plain config object into rig stat lines (field names as labels).
 * - Object fields → `key      value` rows (root; nests that contain arrays)
 * - Object values → `key: value, …` (nested objects as `( … )`)
 * - Arrays → one `[i] value` line per index (items never expand to field rows)
 */
export function dumpConfig(value: unknown, opts: DumpOpts = {}): string[] {
  const skip = new Set(opts.skip ?? []);
  const maxDepth = opts.depth ?? DUMP_MAX_DEPTH;
  const out: string[] = [];
  dumpValue(value, "", 0, out, skip, opts.format, maxDepth);
  return out;
}

function dumpValue(
  value: unknown,
  key: string,
  depth: number,
  out: string[],
  skip: Set<string>,
  format: DumpFormat | undefined,
  maxDepth: number
): void {
  if (key && skip.has(key)) return;
  if (value === undefined) return;
  if (typeof value === "function") return;

  if (key && format) {
    const custom = format(key, value);
    if (custom !== undefined) {
      out.push(emitLine(key, custom, depth));
      return;
    }
  }

  if (isPrimitive(value)) {
    if (!key) {
      out.push(fmtLeaf(value));
      return;
    }
    out.push(emitLine(key, fmtLeaf(value), depth));
    return;
  }

  if (depth >= maxDepth) {
    if (key) out.push(emitLine(key, "…", depth));
    return;
  }

  if (Array.isArray(value)) {
    if (!value.length) return; // omit empty arrays
    dumpArray(value, key, depth, out, skip, format, maxDepth);
    return;
  }

  if (isPlainObject(value)) {
    // Root, or named field whose value contains arrays → field rows.
    // Array items never land here as expanded fields (see dumpArray).
    if (!key || hasArrays(value)) {
      if (key) out.push(emitLine(key, "", depth));
      dumpObjectFields(value, key ? depth + 1 : depth, out, skip, format, maxDepth);
      return;
    }
    out.push(emitLine(key, fmtInline(value, skip, format, 0), depth));
    return;
  }

  if (key) out.push(emitLine(key, String(value), depth));
}

function dumpObjectFields(
  obj: Record<string, unknown>,
  depth: number,
  out: string[],
  skip: Set<string>,
  format: DumpFormat | undefined,
  maxDepth: number
): void {
  const flags: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (skip.has(k) || v === undefined || typeof v === "function") continue;
    if (typeof v === "boolean") {
      flags.push(v ? k : `!${k}`);
      continue;
    }
    dumpValue(v, k, depth, out, skip, format, maxDepth);
  }
  if (flags.length) out.push(emitLine("flags", flags.join(", "), depth));
}

/** True if this object (or a nested object) has a non-empty array. */
function hasArrays(obj: Record<string, unknown>): boolean {
  for (const v of Object.values(obj)) {
    if (Array.isArray(v) && v.length > 0) return true;
    if (isPlainObject(v) && hasArrays(v)) return true;
  }
  return false;
}

/**
 * Inline any value.
 * nest 0 (field / array-item objects): bare `key: val, …`
 * nest > 0 (nested objects): `( key: val, … )`
 */
function fmtInline(
  value: unknown,
  skip: Set<string>,
  format: DumpFormat | undefined,
  nest: number
): string {
  if (nest > DUMP_MAX_DEPTH) return "…";
  if (isPrimitive(value)) return fmtLeaf(value);
  if (Array.isArray(value)) {
    if (!value.length) return "[]";
    // Items inside an array are nested relative to the parent object context.
    const itemNest = nest === 0 ? 0 : nest + 1;
    return `[${value.map((item) => fmtInline(item, skip, format, itemNest)).join(", ")}]`;
  }
  if (isPlainObject(value)) {
    const body = fmtObjectInline(value, skip, format, nest);
    return nest === 0 ? body : `( ${body} )`;
  }
  return String(value);
}

/** `key: val, key: val` — nested objects as `( … )`, arrays as `[ … ]`; bools → `flags: …`. */
function fmtObjectInline(
  obj: Record<string, unknown>,
  skip: Set<string>,
  format: DumpFormat | undefined,
  nest: number
): string {
  if (nest > DUMP_MAX_DEPTH) return "…";
  const parts: string[] = [];
  const flags: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (skip.has(k) || v === undefined || typeof v === "function") continue;
    if (typeof v === "boolean") {
      flags.push(v ? k : `!${k}`);
      continue;
    }
    if (Array.isArray(v) && !v.length) continue;
    if (format) {
      const custom = format(k, v);
      if (custom !== undefined) {
        parts.push(`${k}: ${custom}`);
        continue;
      }
    }
    parts.push(`${k}: ${fmtInline(v, skip, format, nest + 1)}`);
  }
  if (flags.length) parts.push(`flags: ${flags.join(", ")}`);
  return parts.join(", ") || "—";
}

/** One `[i] value` line per index — value always on the same line (never field-expanded). */
function dumpArray(
  arr: unknown[],
  key: string,
  depth: number,
  out: string[],
  skip: Set<string>,
  format: DumpFormat | undefined,
  _maxDepth: number
): void {
  if (arr.length === 0) return;
  arr.forEach((item, i) => {
    const body = `[${i}] ${fmtInline(item, skip, format, 0)}`;
    if (i === 0 && key) out.push(emitLine(key, body, depth));
    else if (key) out.push(emitCont(body, depth));
    else out.push(emitLine(`[${i}]`, fmtInline(item, skip, format, 0), depth));
  });
}

function emitLine(label: string, value: string | number, depth: number): string {
  if (depth <= 0) return row(label, value);
  const indent = " ".repeat(ROW_PAD + (depth - 1) * NEST_INDENT);
  if (value === "") return indent + label;
  return `${indent}${label.padEnd(Math.max(ROW_PAD, label.length + 1))}${value}`;
}

/** Continuation under a key’s value column (array items after the first). */
function emitCont(value: string, depth: number): string {
  const col = depth <= 0 ? ROW_PAD : ROW_PAD + (depth - 1) * NEST_INDENT + ROW_PAD;
  return `${" ".repeat(col)}${value}`;
}

function fmtLeaf(value: string | number | boolean | null): string {
  if (value === null) return "null";
  if (typeof value === "number") {
    if (value === Infinity) return "∞";
    if (Number.isInteger(value)) return String(value);
    return value.toFixed(2);
  }
  return String(value);
}

function isPrimitive(value: unknown): value is string | number | boolean | null {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
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
      // Share Tech Mono’s `_` sits below the default canvas metrics and gets clipped → reads as a space.
      padding: { bottom: 3 },
      // Don't use Phaser wordWrap — it restarts at column 0. Soft-wrap in setStackedTexts instead.
    })
    .setScrollFactor(0)
    .setDepth(depth)
    .setVisible(false);
  if (opts.wrapW != null) t.setData("wrapW", opts.wrapW);
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
    const wrapW = layer.txt.getData("wrapW") as number | undefined;
    const lines =
      wrapW != null && wrapW > 0
        ? softWrapLines(layer.lines, maxCharsFor(layer.txt, wrapW))
        : layer.lines;
    layer.txt.setPosition(x, cy).setText(lines.join("\n"));
    if (lines.some((l) => l.length)) cy += layer.txt.height + gap;
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

function maxCharsFor(txt: Phaser.GameObjects.Text, wrapW: number): number {
  const charW = measureMonoChar(txt);
  return Math.max(24, Math.floor(wrapW / charW));
}

function measureMonoChar(txt: Phaser.GameObjects.Text): number {
  const ctx = txt.context;
  const prev = ctx.font;
  ctx.font = `${txt.style.fontSize} ${txt.style.fontFamily}`;
  const w = ctx.measureText("0").width;
  ctx.font = prev;
  return w > 0 ? w : 7;
}

/** Soft-wrap dump lines so continuations stay under the value column. */
function softWrapLines(lines: string[], maxChars: number): string[] {
  return lines.flatMap((line) => softWrapLine(line, maxChars));
}

function softWrapLine(line: string, maxChars: number): string[] {
  if (line.length <= maxChars) return [line];
  // Continuations align under the payload — past `key` pad and any `[i] ` index prefix.
  const wrapCol = wrapColumnOf(line);
  const valueWidth = maxChars - wrapCol;
  if (valueWidth < 8) {
    // Too narrow for a value column — wrap with leading indent only.
    const lead = line.match(/^\s*/)?.[0].length ?? 0;
    const pad = " ".repeat(lead);
    const body = line.slice(lead);
    const width = Math.max(8, maxChars - lead);
    const out: string[] = [];
    for (let i = 0; i < body.length; i += width) {
      out.push((i === 0 ? line.slice(0, lead) : pad) + body.slice(i, i + width));
    }
    return out;
  }
  const head = line.slice(0, wrapCol);
  const value = line.slice(wrapCol);
  const pad = " ".repeat(wrapCol);
  const chunks = chunkText(value, valueWidth);
  return chunks.map((c, i) => (i === 0 ? head + c : pad + c));
}

/** Index where the value starts (`key` + padEnd spaces). */
function valueColumnOf(line: string): number {
  const m = /^(\s*\S+)( +)/.exec(line);
  if (m) return m[1]!.length + m[2]!.length;
  const lead = line.match(/^\s+/);
  return lead ? lead[0].length : 0;
}

/**
 * Column for wrapped continuations: value column, then past a leading `[i] `
 * so `guns [0] tex: …` wraps under `tex`, matching ` [1] tex: …` lines.
 */
function wrapColumnOf(line: string): number {
  const valueCol = valueColumnOf(line);
  const after = line.slice(valueCol);
  const idx = /^\[\d+\] /.exec(after);
  return idx ? valueCol + idx[0].length : valueCol;
}

/** Prefer breaks after `, ` when chunking a long value. */
function chunkText(text: string, width: number): string[] {
  if (text.length <= width) return [text];
  const out: string[] = [];
  let rest = text;
  while (rest.length > width) {
    let cut = width;
    const slice = rest.slice(0, width + 1);
    const comma = slice.lastIndexOf(", ");
    if (comma >= Math.floor(width * 0.4)) cut = comma + 2;
    else {
      const sp = slice.lastIndexOf(" ");
      if (sp >= Math.floor(width * 0.4)) cut = sp + 1;
    }
    out.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest.length) out.push(rest);
  return out;
}
