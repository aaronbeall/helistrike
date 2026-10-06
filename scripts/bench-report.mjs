#!/usr/bin/env node
/**
 * HTML report of docs/perf-history.csv: per-scenario charts + tables with deltas. Written to bench-results/
 * (git-ignored) and opened in the browser.
 *
 *   npm run bench:report             write + open bench-results/perf-report.html
 *   npm run bench:report -- --no-open
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { readHistory, ROOT } from "./perf-history.mjs";

const rows = readHistory();
const out = path.join(ROOT, "bench-results/perf-report.html");
fs.mkdirSync(path.dirname(out), { recursive: true });

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>HeliStrike Perf History</title>
<style>
:root { --bg:#14120e; --panel:#1d1a14; --line:#3a3428; --text:#e9e1cc; --dim:#9a917b; --amber:#e8b84a; --orange:#ff8a3a; --cyan:#4fd2ff; --green:#6dcc5a; --red:#ff5a46; --shade:rgba(255,255,255,0.035); }
@media (prefers-color-scheme: light) { :root { --bg:#f6f3ec; --panel:#fffdf8; --line:#ddd5c4; --text:#2a251c; --dim:#7a705c; --amber:#b8860b; --orange:#d2601a; --cyan:#1b8fc0; --green:#2f8f2f; --red:#c8321e; --shade:rgba(0,0,0,0.04); } }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--text); font:14px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width:1180px; margin:0 auto; padding:24px 16px 64px; }
h1 { font-size:22px; margin:0 0 4px; } h2 { font-size:17px; margin:0; } .dim { color:var(--dim); }
nav { display:flex; flex-wrap:wrap; gap:6px; margin:16px 0 20px; } nav a { color:var(--text); text-decoration:none; border:1px solid var(--line); border-radius:999px; padding:3px 10px; font-size:12px; } nav a:hover { border-color:var(--amber); }
.card { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:16px; margin:0 0 18px; }
.head { display:flex; justify-content:space-between; align-items:baseline; gap:12px; flex-wrap:wrap; margin-bottom:10px; }
.legend { display:flex; gap:14px; flex-wrap:wrap; font-size:12px; color:var(--dim); } .legend i { display:inline-block; width:16px; height:3px; margin-right:5px; vertical-align:middle; border-radius:2px; }
svg { width:100%; height:auto; display:block; } svg text { fill:var(--dim); font-size:11px; }
.wrap { overflow-x:auto; } table { border-collapse:collapse; width:100%; font-size:12.5px; font-variant-numeric:tabular-nums; margin-top:8px; }
th, td { text-align:right; padding:5px 8px; border-bottom:1px solid var(--line); white-space:nowrap; } th { color:var(--dim); font-weight:600; } td.l, th.l { text-align:left; }
td .d { font-size:11px; margin-left:4px; } .good { color:var(--green); } .bad { color:var(--red); }
.tag { font-size:11px; color:var(--dim); border:1px solid var(--line); border-radius:4px; padding:0 5px; }
</style>
</head>
<body>
<main>
<h1>HeliStrike perf history</h1>
<div class="dim" id="meta"></div>
<nav id="nav"></nav>
<div class="card"><div class="head"><h2>Latest vs first (real-input)</h2><span class="dim">CPU and frame-interval times in ms, lower is better</span></div><div class="wrap"><table id="summary"></table></div></div>
<div id="cards"></div>
</main>
<script>
const ROWS = ${JSON.stringify(rows)};
const GENERATED = ${JSON.stringify(new Date().toISOString().replace("T", " ").slice(0, 16))};
const SERIES = [
  { key: "cpu_avg", label: "CPU avg", color: "var(--amber)", dash: "" },
  { key: "cpu_p99", label: "CPU p99", color: "var(--orange)", dash: "5 4" },
  { key: "interval_p99", label: "Frame interval p99", color: "var(--cyan)", dash: "" },
  { key: "unit_ai_avg", label: "Unit AI avg", color: "var(--green)", dash: "2 3" },
];
/** Lower is better except frames. */
const COLS = [
  ["frames", "Frames", 1], ["cpu_avg", "CPU avg", -1], ["cpu_p99", "CPU p99", -1], ["render_avg", "Render", -1], ["scene_avg", "Scene", -1],
  ["unit_ai_avg", "Unit AI", -1], ["interval_p99", "Interval p99", -1], ["alloc_mbps", "Garbage MB/s", -1],
];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const scenarios = [...new Set(ROWS.map((r) => r.scenario))];
document.getElementById("meta").textContent = \`Generated \${GENERATED} · \${ROWS.length} rows · \${scenarios.length} scenarios · latest commit \${ROWS[ROWS.length - 1]?.commit ?? "-"}\`;
document.getElementById("nav").innerHTML = scenarios.map((s) => \`<a href="#\${s}">\${s}</a>\`).join("");

function delta(now, prev, dir) {
  if (now == null || prev == null || !prev) return "";
  const pct = ((now - prev) / prev) * 100;
  if (Math.abs(pct) < 0.5) return '<span class="d dim">±0%</span>';
  const good = pct * dir > 0;
  return \`<span class="d \${good ? "good" : "bad"}">\${pct > 0 ? "+" : ""}\${pct.toFixed(0)}%</span>\`;
}

// Summary: first vs latest real-input row per scenario.
{
  const head = "<tr><th class='l'>Scenario</th><th>CPU avg</th><th>CPU p99</th><th>Interval p99</th><th>Frames</th><th>Garbage MB/s</th><th class='l'>Span</th></tr>";
  const body = scenarios.map((s) => {
    const rs = ROWS.filter((r) => r.scenario === s && r.harness === "real-input");
    if (!rs.length) return "";
    const a = rs[0], b = rs[rs.length - 1];
    const cell = (k, dir) => \`<td>\${b[k] ?? "-"}\${rs.length > 1 ? delta(b[k], a[k], dir) : ""}</td>\`;
    return \`<tr><td class="l"><a href="#\${s}" style="color:inherit">\${s}</a></td>\${cell("cpu_avg", -1)}\${cell("cpu_p99", -1)}\${cell("interval_p99", -1)}\${cell("frames", 1)}\${cell("alloc_mbps", -1)}<td class="l dim">\${rs.length > 1 ? esc(a.label) + " → " + esc(b.label) : esc(b.label) + " (only run)"}</td></tr>\`;
  }).join("");
  document.getElementById("summary").innerHTML = head + body;
}

function chart(rs) {
  const W = 1100, H = 290, L = 44, R = 150, T = 14, B = 72;
  const n = rs.length;
  const x = (i) => (n === 1 ? L + (W - L - R) / 2 : L + (i * (W - L - R)) / (n - 1));
  const vals = rs.flatMap((r) => SERIES.map((s) => r[s.key]).filter((v) => v != null));
  const max = Math.max(17.5, ...vals) * 1.08;
  const y = (v) => T + (1 - v / max) * (H - T - B);
  let svg = \`<svg viewBox="0 0 \${W} \${H}" role="img">\`;
  // Fixed-step era shading.
  const fixed = rs.map((r, i) => (r.harness !== "real-input" ? i : -1)).filter((i) => i >= 0);
  if (fixed.length) {
    const half = n > 1 ? (W - L - R) / (n - 1) / 2 : 40;
    const x0 = Math.max(L, x(fixed[0]) - half), x1 = Math.min(W - R, x(fixed[fixed.length - 1]) + half);
    svg += \`<rect x="\${x0}" y="\${T}" width="\${x1 - x0}" height="\${H - T - B}" fill="var(--shade)"/><text x="\${x0 + 6}" y="\${T + 13}">fixed-step harness</text>\`;
  }
  for (let v = 0; v <= max; v += 5) svg += \`<line x1="\${L}" x2="\${W - R}" y1="\${y(v)}" y2="\${y(v)}" stroke="var(--line)" stroke-width="1"/><text x="\${L - 6}" y="\${y(v) + 4}" text-anchor="end">\${v}</text>\`;
  for (const [v, lab] of [[8.33, "120 Hz"], [16.67, "60 Hz"]]) svg += \`<line x1="\${L}" x2="\${W - R}" y1="\${y(v)}" y2="\${y(v)}" stroke="var(--red)" stroke-opacity="0.45" stroke-dasharray="3 4"/><text x="\${W - R - 2}" y="\${y(v) - 4}" text-anchor="end">\${lab}</text>\`;
  for (const s of SERIES) {
    const pts = rs.map((r, i) => (r[s.key] == null ? null : [x(i), y(r[s.key]), r])).filter(Boolean);
    if (pts.length > 1) svg += \`<polyline fill="none" stroke="\${s.color}" stroke-width="2.2" stroke-dasharray="\${s.dash}" points="\${pts.map((p) => p[0] + "," + p[1]).join(" ")}"/>\`;
    for (const [px, py, r] of pts) svg += \`<circle cx="\${px}" cy="\${py}" r="3.6" fill="\${s.color}"><title>\${esc(r.label)} (\${r.commit})\\n\${s.label}: \${r[s.key]} ms</title></circle>\`;
  }
  rs.forEach((r, i) => {
    const lab = r.label.length > 26 ? r.label.slice(0, 25) + "…" : r.label;
    svg += \`<text transform="translate(\${x(i)},\${H - B + 14}) rotate(18)" text-anchor="start">\${esc(lab)}</text>\`;
  });
  return svg + "</svg>";
}

function table(rs) {
  let h = "<tr><th class='l'>Date</th><th class='l'>Commit</th><th class='l'>Label</th><th class='l'>Harness</th><th>Runs</th>" + COLS.map((c) => \`<th>\${c[1]}</th>\`).join("") + "</tr>";
  rs.forEach((r, i) => {
    const prev = [...rs.slice(0, i)].reverse().find((p) => p.harness === r.harness);
    h += \`<tr><td class="l">\${r.date}</td><td class="l"><code>\${r.commit}</code></td><td class="l">\${esc(r.label)}</td><td class="l"><span class="tag">\${r.harness}</span></td><td>\${r.runs}</td>\`;
    h += COLS.map(([k, , dir]) => \`<td>\${r[k] ?? "-"}\${prev ? delta(r[k], prev[k], dir) : ""}</td>\`).join("") + "</tr>";
  });
  return h;
}

const legend = '<div class="legend">' + SERIES.map((s) => \`<span><i style="background:\${s.color}"></i>\${s.label}</span>\`).join("") + "</div>";
document.getElementById("cards").innerHTML = scenarios
  .map((s) => {
    const rs = ROWS.filter((r) => r.scenario === s);
    return \`<section class="card" id="\${s}"><div class="head"><h2>\${s}</h2>\${legend}</div>\${chart(rs)}<div class="wrap"><table>\${table(rs)}</table></div></section>\`;
  })
  .join("");
</script>
</body>
</html>
`;

fs.writeFileSync(out, page);
console.log(`[report] ${path.relative(ROOT, out)} (${rows.length} rows)`);
if (!process.argv.includes("--no-open")) {
  try {
    execSync(`${process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open"} "${out}"`);
  } catch {
    // No opener: the path above is enough.
  }
}
