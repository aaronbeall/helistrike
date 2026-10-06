#!/usr/bin/env node
/**
 * Perf trend from docs/perf-history.csv (rows appended by `npm run bench -- --record "<label>"`).
 *
 *   npm run bench:history                       every scenario
 *   npm run bench:history -- gun_cluster,tesla_cluster
 *
 * Rows from different harnesses ("fixed-step" vs "real-input") aren't directly comparable.
 */
import { readHistory } from "./perf-history.mjs";

const only = process.argv.slice(2).flatMap((a) => a.split(",")).filter(Boolean);
const rows = readHistory();
const scenarios = [...new Set(rows.map((r) => r.scenario))].filter((s) => !only.length || only.includes(s));
const w = [11, 9, 38, 11, 9, 9, 9, 13, 8];
const fmt = (cols) => cols.map((c, i) => String(c).padEnd(w[i])).join(" ");
for (const sc of scenarios) {
  console.log(`\n== ${sc}`);
  console.log(fmt(["date", "commit", "label", "harness", "cpu avg", "cpu p99", "unit AI", "interval p99", "MB/s"]));
  for (const r of rows.filter((x) => x.scenario === sc)) {
    console.log(fmt([r.date, r.commit, r.label.slice(0, 37), r.harness, r.cpu_avg, r.cpu_p99, r.unit_ai_avg, r.interval_p99, r.alloc_mbps ?? ""]));
  }
}
