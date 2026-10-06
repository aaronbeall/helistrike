/** Reads docs/perf-history.csv (written by `npm run bench -- --record`) into row objects. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const HISTORY_FILE = path.join(ROOT, "docs/perf-history.csv");
/** Numeric columns (parsed to numbers; blank → null). */
const NUMERIC = new Set(["runs", "frames", "cpu_avg", "cpu_p99", "render_avg", "scene_avg", "unit_ai_avg", "interval_p99", "alloc_mbps"]);

/** Minimal CSV: quoted fields with "" escapes. */
function parseCsv(text) {
  const rows = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const out = [];
    let cur = "";
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (c === '"') q = false;
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ",") {
        out.push(cur);
        cur = "";
      } else cur += c;
    }
    out.push(cur);
    rows.push(out);
  }
  return rows;
}

/** History rows as objects, in file order. */
export function readHistory(file = HISTORY_FILE) {
  const [head, ...rows] = parseCsv(fs.readFileSync(file, "utf8"));
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, NUMERIC.has(h) ? (r[i] === "" || r[i] == null ? null : Number(r[i])) : r[i]])));
}
