# Performance plan — October 2026

Goal: find and fix the real causes of low frame rate and freezes, with repeatable measurements instead of guesses. Follows on from `perf-investigation-2026-10.md`.

## 1. Test harness

Playwright plays the game in your installed Chrome with **real keyboard and mouse input**, and measures from outside. The game only provides a dev-build URL launch and a read-only handle.

```
npm run bench                                          # all scenarios
npm run bench -- idle_cluster,rockets_cluster          # some
npm run bench -- --compare docs/perf-baseline-2026-10.json
npm run bench -- idle_empty --profile                  # CPU profile + allocation sample per scenario
npm run bench -- --runs 3 --record "what changed"      # median of 3 suite runs → docs/perf-history.csv
npm run bench:history -- gun_cluster,tesla_cluster     # trend per scenario
```

**Keeping results over time:**
- **`docs/perf-history.csv` (committed):** one row per scenario per milestone: date, commit, label, harness, runs, frames, CPU avg/p99, render, scene, unit AI, interval p99, garbage. Record a row after each perf change with `--runs 3 --record "<label>"`. The rows from before the real-input runner are marked `fixed-step` and aren't directly comparable with `real-input` rows.
- **`docs/perf-runs-2026-10/` (committed):** raw runs behind the milestones so far.
- **`docs/perf-baseline-2026-10.json`:** the current comparison baseline for `--compare`. Refresh it with `--runs 3 --out` when the code moves on.
- **`bench-results/` (local, git-ignored):** every run and `.cpuprofile`. Large, so not committed.

- **Game side** (dev builds only):
  - `?test=<id>` launches a test map from `src/catalog/testMaps.ts`; `?mission=…&craft=…&seed=…&settlement=…` launches any mission.
  - `&cheats=ammo,god` turns on the debug menu's infinite ammo and no damage.
  - Test maps can replace the generated patrols and garrisons with a 120-unit cluster. Objectives stay, so the mission runs normally.
  - `window.__heli` is a read-only handle (scene, game, perf labels).
  - The same maps are under **TEST MAPS** in the main-menu `/` panel, to play by hand.
- **Runner** (`scripts/bench.mjs`, scenarios in `scripts/bench-scenarios.mjs`):
  - **Launch:** Chrome at 1280×720 and 2× pixel ratio, throttling off; starts the dev server if needed.
  - **Input:** per scenario, boots the test map, presses `P` (perf stage timings on), holds Space to lift off, presses the weapon key, then re-aims the real mouse at the nearest enemies every 100 ms and holds or releases fire on the schedule.
  - **Probe:** an injected script wraps Phaser's game-loop callback from outside and records CPU per frame, the real frame interval, the perf stages, heap, long tasks and object counts.
  - **Output:** saves to `bench-results/` (git-ignored). `--compare` prints the change against a saved run; `--profile` adds a CPU profile and allocation sample (it skews timings).
- **No determinism:** real input runs in real time, so take medians over several runs.
- **Debug overlay:** the perf overlay is a DOM element (`ui/domText`), so it doesn't add canvas or texture work to the measurement.

| Scenario | Map | What it isolates |
|---|---|---|
| `idle_empty` | `desert_empty` | Engine floor: terrain, HUD, player |
| `gun_empty` / `rockets_empty` | `desert_empty` | Shots, trails, particles and impacts with no units |
| `idle_cluster` | `desert_cluster` | 120 engaged units (AI, steering, enemy fire), no player fire |
| `gun_cluster` / `rockets_cluster` | `desert_cluster` | Player barrage into the cluster: hits, blasts, deaths |
| `mission_idle` / `mission_idle_s0` | `river_run` / `river_run_s0` | A generated mission, with and without settlements |

### Real-input baseline (2026-10-05, after the HUD fix)

Raw: `perf-baseline-2026-10.json`. Times in ms. It isn't comparable with §2–4, which used the earlier fixed-step, pinned-player harness: the craft now actually flies, and units chase it.

| Scenario | CPU avg / p99 / max | Render avg / p99 | Scene avg / p99 | Unit sim avg | Interval p99 | Frames (10 s) | Alloc MB/s |
|---|---|---|---|---|---|---|---|
| idle_empty | 1.52 / 3.1 / 5.2 | 0.5 / 1.1 | 1.02 / 2.1 | 0.03 | 9.3 | — | 30 |
| gun_empty | 1.57 / 4 / 5.1 | 0.6 / 1.5 | 0.97 / 2.5 | 0.03 | 9.3 | — | 49 |
| rockets_empty | 3.15 / 4.4 / 6.2 | 2.18 / 3 | 0.96 / 1.6 | 0.03 | 9.2 | — | 251 |
| idle_cluster | 7.43 / 9.7 / 13.5 | 2.1 / 3.3 | 5.34 / 7.1 | 3.46 | 9.3 | 1207 | 434 |
| gun_cluster | 8.67 / 12.7 / 20.1 | 3.04 / 5.4 | 5.63 / 8.1 | 3.07 | 17.4 | 1000 | 365 |
| rockets_cluster | 8.46 / 14.6 / 15.9 | 4.31 / 7.2 | 4.15 / 8.2 | 1.06 | **50.8** | **735** | 238 |
| mission_idle | 2.95 / 3.8 / 4.9 | 0.43 / 0.7 | 2.53 / 3.2 | 1.65 | 9.3 | 1208 | 150 |
| mission_idle_s0 | 2.39 / 3.1 / 4.6 | 0.41 / 0.7 | 1.98 / 2.6 | 1.18 | 9.3 | 1208 | 116 |

- **Allocation is now gameplay, not `Graphics`.** Under real flight, units chase and steer, so footprint overlap (`projectRect`), `steerGround`, `separateGround` and `groundUnitBlocked` allocate about 100 MB/s in `gun_cluster`, plus particle updates. That's a spatial-grid and steering-cleanup target.
- **`rockets_cluster` drops to about 73 fps** (interval p99 51 ms) while CPU averages 8.5 ms. That's the GPU / dropped-frame item in the plan.

## 2. Baseline (2026-10-05)

Fixed-step harness (raw runs: `perf-runs-2026-10/`). Chrome, Apple M3 Max, 120 Hz display. The fixed 60 Hz sim step runs at 2× real time. Times are in ms. "Interval" is the real time between frames, so it includes GC between frames and GPU waits that the CPU column doesn't.

| Scenario | CPU avg / p99 / max | Render avg / p99 | Scene avg / p99 | Unit sim avg / p99 | Frames > 16 ms CPU | Interval p99 / max | Units (live) | Shots / particles (max) | Alloc MB/s |
|---|---|---|---|---|---|---|---|---|---|
| idle_empty | 2.15 / 4 / 4.4 | 1.41 / 2.7 | 0.74 / 1.5 | 0 / 0.1 | 0 | 9.2 / 9.4 | 0 (0) | 0 / 0 | 102 |
| gun_empty | 2.24 / 4.7 / 5.3 | 1.41 / 3 | 0.83 / 1.8 | 0 / 0.1 | 0 | 9.3 / 9.4 | 0 (0) | 7 / 267 | 115 |
| rockets_empty | 4.12 / 5.6 / 8.1 | 3.14 / 3.9 | 0.98 / 1.9 | 0 / 0.1 | 0 | 9.3 / 9.4 | 0 (0) | 4 / 279 | 201 |
| idle_cluster | 8.85 / 11.3 / 12.8 | 3.6 / 5.1 | 5.25 / 6.8 | 3.48 / 4.3 | 0 | 16.9 / 17.6 | 120 (120) | 64 / 0 | 367 |
| gun_cluster | 9.66 / 13.9 / 15 | 4.55 / 6.9 | 5.11 / 7.5 | 2.64 / 3.6 | 0 | 25 / 33.3 | 120 (102) | 76 / 277 | 342 |
| rockets_cluster | 8.7 / 13.5 / 14.6 | 5.15 / 7.7 | 3.55 / 6.2 | 0.96 / 1.8 | 0 | 33.2 / 41.7 | 120 (57) | 44 / 360 | 303 |
| mission_idle | 3.81 / 4.4 / 4.7 | 1.18 / 1.6 | 2.62 / 3 | 1.72 / 1.9 | 0 | 9.3 / 9.4 | 129 (129) | 0 / 0 | 170 |
| mission_idle_s0 | 3.23 / 3.8 / 4.3 | 1.1 / 1.5 | 2.13 / 2.5 | 1.24 / 1.5 | 0 | 9.3 / 9.4 | 80 (80) | 0 / 0 | 143 |

Taken with the earlier fixed-step harness (seeded `Math.random`, player pinned in place, simulated pointer), since replaced by real input. A first, manual run (Chrome over raw DevTools, console capture on for the whole suite) read 12–50% slower with CPU spikes up to 62 ms. Those spikes didn't reproduce under the runner, so they're attributed to that setup.

Shot sim, shot draw, debris and particle sim stages stay under 0.35 ms on average, under 1.7 ms p99, in every scenario.

**Profiles** (`npm run bench -- <id> --profile`):
- **`idle_empty`:** the main thread is 72% idle and GC is about 1%. Allocation is about 220 MB/s (sampled, including collected objects), and about 95% of it is Phaser's `Graphics` WebGL renderer: `GraphicsWebGLRenderer`, `batchLine`, `batchFillPath`, `batchStrokePath`, `earcut` triangulation. Retained heap is 23–76 MB. `performance.memory` reports multiple GB, which isn't the live heap, so the report doesn't print it.
- **`rockets_cluster`:** the main thread is about 90% busy (10% idle). GC is 1.6% while allocating about 530 MB/s. Self time:
  - `Graphics` triangulation and batching, about 13% (`earcutLinked`, `isEarHashed`, `GraphicsWebGLRenderer`, `linkedList`, `batchFillPath`)
  - particle emitters, about 8% (`update` and `preUpdate` in the particle code)
  - display-list depth sort (`StableSort`), 4%
  - transforms and sprite batching (`multiply`, `batchSprite`, `batchQuad`, image and emitter renderers)
  - unit AI, about 5% (`driveGroundVehicle`, `updateUnits`)
  - `setVisible`, 1.4%
  - texture uploads every frame (`texImage2D`), 1.4%
- **`idle_cluster`:** the top self-time function is `driveGroundVehicle` (16%), then `updateUnits`, `specOf` (3%), `steerGround` and footprint maths.

A first, manual profile showed GC at 55–62% of the main thread. That doesn't reproduce under the runner, so it came from the manual setup.

## 3. Read

1. **Dropped frames are main-thread saturation, not GC.** The display is 120 Hz, an 8.3 ms budget. With rockets into the cluster, frames average 8.7 ms of measured CPU and the main thread is about 90% busy, so the browser skips vsyncs: interval p99 is 25–33 ms, max 42 ms. On a 60 Hz display the same load mostly fits. Either way, the headroom is gone exactly in the "barrage near enemies" case.
2. **`Graphics` redraws are the largest single cost under load (about 13%) and nearly all the garbage.** Every `Graphics` object cleared and redrawn each frame is re-tessellated (`earcut` for filled paths) and allocates new arrays.
   - **Redrawn every frame:** HUD, reticle, minimap, status panel, field bars, threat arcs, lock-on boxes, HV arrows. That's about 50 `clear()` sites, most in `missionScene` and `reticleHud`.
   - **The fix:** static `Graphics` or images for fixed shapes, textures or nine-slices for rounded rects, and redrawing only what changed. Filled polygons cost the most. Lines and rects are cheaper.
   - **Why bother if GC isn't a big cost:** cutting the garbage also makes long GC pauses on slower machines less likely.
3. **Per-unit AI is expensive.** 120 engaged units cost 3.5 ms a frame on average, about 29 µs per unit.
   - **Hotspots:** `driveGroundVehicle` plus three full-list scans per ground mover (`steerGround`, `groundUnitBlocked`, `separateGround`). That's where spatial partitioning pays most.
   - **Also:** `specOf` shows up as 3% self time, which means it's called a very large number of times per frame.
4. **Render-side Phaser work grows with effects:** particle emitter updates, depth sorting of a large display list, transform and batch work, `setVisible` churn, and per-frame texture uploads (`texImage2D`, likely `Text` objects or canvas textures re-rendered every frame). Render CPU goes from 1.4 ms empty to 3.1 ms with rockets and 5.2 ms with rockets into the cluster. Shot and particle *simulation* is cheap, under 0.4 ms.
5. **Settlements cost about 0.6 ms** (`mission_idle` against `mission_idle_s0`). They aren't the main cause, which matches what you saw at 0 settlement.
6. **Line of sight is negligible**, as measured before.
7. **Bug:** about 900 Phaser warnings per suite run say `fx_ember_particle` / `fx_ember_particle_soft` have no frame `4`. Ember emitters ask for a frame that doesn't exist, and every warning is a `console.warn` in the frame path.

## 4. Before / after (2026-10-05)

Medians of 3 runs per stage (raw runs: `perf-runs-2026-10/`). Times in ms.
- **Before:** `dbb5424` (10-02), before this round of map, FX, AI and stats work, with the harness ported in.
- **Now:** `2121b9e`, the slow one.
- **HUD:** HUD shapes moved to `render/fastShapes`.

| Scenario | CPU avg (before → now → HUD) | Render avg | Unit sim avg | Interval p99 | Alloc MB/s |
|---|---|---|---|---|---|
| idle_empty | 2.16 → 2.15 → **1.93** | 1.4 → 1.39 → **0.77** | 0 | 9.3 → 9.3 → 9.4 | 102 → 102 → **10** |
| rockets_empty | 4.62 → 4.68 → **3.52** | 3.7 → 3.57 → **2.2** | 0 | 9.3 → 10.3 → 9.2 | 249 → 201 → **68** |
| idle_cluster | 9.4 → 9.42 → **7.29** | 4.5 → 3.97 → **1.84** | 2.92 → 3.54 → 3.51 | 17.4 → 17.4 → 17 | 386 → 372 → **186** |
| gun_cluster | 9.98 → 10.08 → **8.23** | 5.41 → 4.72 → **2.68** | 2.25 → 2.88 → 2.78 | 17.5 → 25.1 → 25.1 | 370 → 343 → **174** |
| rockets_cluster | 10.2 → 9.19 → **7.44** | 6.61 → 5.46 → **3.64** | 1.01 → 0.98 → 0.99 | 33 → 33.4 → 33.4 | 358 → 307 → **140** |
| mission_idle | 3.37 → 3.83 → **3.22** | 1.18 → 1.2 → **0.44** | 0.86 → 1.71 → 1.73 | 10.3 → 10.2 → 9.3 | 135 → 170 → **76** |

**Before → now:**
- **Same workload, about the same CPU.** CPU is within ±10% on identical scenarios.
- **Unit AI is about 20–28% more expensive per unit.**
- **Render CPU is 12–17% cheaper** (FX rework).
- **Real missions carry more units:** River Run went from 69 to 129 with settlements and heli pads, so unit AI doubled there.
- **The old build had 12–17 ms CPU p99 spikes in missions,** which are gone now.
- **One regression the CPU doesn't explain:** `gun_cluster` interval p99 went from 17.5 to 25 ms on all 3 runs.

**Now → HUD:**
- Render CPU dropped 33–63%, total CPU 15–25%, and allocation 50–91% (idle: 102 → 10 MB/s).
- Scene CPU rose slightly, because the triangles are now emitted during `update` instead of being tessellated in render. The total is still well down.

**Still open:** the interval p99 in the cluster scenarios (17 / 25 / 33 ms) didn't move, even though CPU now averages 7.3–8.2 ms, under the 8.3 ms budget at 120 Hz. Those dropped frames come from outside the measured main-thread work, so the GPU (fill rate: additive particles, smoke, bloom PostFX) is the next suspect. Run with FX off, or take a GPU trace, to confirm.

## 5. Plan

1. **[done]** `Graphics` redraws: HUD shapes in `render/fastShapes` (minimap, weapon bar, status panel, reticle and sight lines, lock-on, threat arcs, battery icons).
2. **[done]** Starscream energy ribbons: quads from reused buffers, adaptive subdivision, quantized alpha. CPU −17%, render −24%, garbage −30%.
3. **GPU / dropped frames:** split GPU from CPU on the fire-heavy scenarios (bloom off, particle counts, overdraw). Interval p99 is still 25–42 ms with CPU at 7–10 ms.
4. **[done]** Text rendering: `render/textStyle.setTextColor` skips no-op recolors, lock-on text isn't reset every frame, HUD distances in 10 m steps. Text cost went from 60–120 to a few ms/s. Optional follow-up: color via GPU tint with white-filled labels.
5. **[done]** Spatial grid: `sim/spatialGrid` (128-unit cells, typed-array linked lists) owned by `world/spatial` (`s.spatial.near`), with buildings in a static grid and everything else in a mover grid. It covers steering / blocked / separation, the shot hit test, blast damage, missile retargeting, bomblets, remote AI, Tesla / refractor / lock-on / fire-control picks and roadkill. Results come back in `s.units` order, so behavior is unchanged: the debug "Spatial grid" overlay cross-checks every query against brute force, and `npm run spatial:check` fuzzes the grid. On the new `desert_stress` map (~1,750 units), unit sim is −86–88% and CPU −48–61%; on the cluster maps, unit sim is −11–32%. Left as is: `terrainSteer` / `mapEdgeSteer` returned-point allocations.
   - Follow-up: far-unit sim LOD (off screen and out of every target's reach → every 4th frame with summed dt; debug toggle "Far unit LOD") and a sprite pool sized by on-screen units instead of live units. On the stress maps, CPU −24–26%, render −28–33%, unit sim −22–26%; on mission_idle, unit sim −44%.
6. **[done]** Unit AI hot path: allocation-free footprint overlap and point tests, per-frame solids list, no per-unit turret copy. Unit AI −52–71%.
7. **Phaser render-side costs:** particle emitter updates (the top CPU and allocation item under fire), depth-sort load (8 depth-banded emitter slots per effect type), `setVisible` churn in unit sprites, per-frame texture uploads.
8. **Render batching:** draw-call and texture-switch counts per frame, then fewer blend-mode breaks.
9. **[done]** Ember frame warning (`frameTotal` includes `__BASE`).
10. **[done]** Fair before/after tracking: `docs/perf-history.csv` plus `npm run bench:report`, with a 3-run baseline of the committed code.
11. **Later:** input recording and replay (deterministic repros), with input read through one per-frame snapshot.

After each step: `npm run bench -- <scenarios> --runs 3 --record "<what changed>"`, then `npm run bench:report`.
