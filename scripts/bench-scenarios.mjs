/**
 * Perf scenarios for scripts/bench.mjs. `map` is a dev test map id (src/catalog/testMaps.ts); everything else is
 * real input the runner performs: lift off, select `weapon` (key 1–5), aim at the nearest enemies, and hold fire
 * for `onS` / release for `offS`. Times are real seconds.
 */
const GUN = { weapon: 1, onS: 3, offS: 1 };
const ROCKETS = { weapon: 2, onS: 1.5, offS: 0.5 };
const TIMING = { warmupS: 3, measureS: 10 };

export const SCENARIOS = [
  { id: "idle_empty", label: "Idle, no forces", map: "desert_empty", ...TIMING },
  { id: "gun_empty", label: "Chain gun into empty ground", map: "desert_empty", fire: GUN, ...TIMING },
  { id: "rockets_empty", label: "Rockets into empty ground", map: "desert_empty", fire: ROCKETS, ...TIMING },
  { id: "idle_cluster", label: "Idle, 120-unit cluster", map: "desert_cluster", ...TIMING },
  { id: "gun_cluster", label: "Chain gun into 120-unit cluster", map: "desert_cluster", fire: GUN, ...TIMING },
  { id: "rockets_cluster", label: "Rockets into 120-unit cluster", map: "desert_cluster", fire: ROCKETS, ...TIMING },
  { id: "starscream_cluster", label: "Starscream energy ribbons into the cluster", map: "desert_cluster_cyber", fire: { weapon: 2, onS: 2, offS: 0.5 }, ...TIMING },
  { id: "tesla_cluster", label: "Tesla beam into the cluster", map: "desert_cluster_cyber", fire: { weapon: 3, onS: 2, offS: 0.5 }, ...TIMING },
  { id: "tow_cluster", label: "TOW wire-guided missiles into the cluster", map: "desert_cluster_cobra", fire: { weapon: 3, onS: 2, offS: 0.5 }, ...TIMING },
  { id: "idle_stress", label: "Idle, cluster in a town + ~1,600 units map-wide", map: "desert_stress", ...TIMING },
  { id: "gun_stress", label: "Chain gun into the town cluster", map: "desert_stress", fire: GUN, ...TIMING },
  { id: "rockets_stress", label: "Rockets into the town cluster", map: "desert_stress", fire: ROCKETS, ...TIMING },
  { id: "mission_idle", label: "River Run, generated forces + settlements", map: "river_run", ...TIMING },
  { id: "mission_idle_s0", label: "River Run, no settlements", map: "river_run_s0", ...TIMING },
];
