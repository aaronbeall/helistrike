# Performance plan — October 2026

Goal: find and fix the real causes of low frame rate and freezes, with repeatable measurements instead of guesses. Follows on from `perf-investigation-2026-10.md`.

## 1. Test harness

Run with the Playwright runner (`scripts/bench.mjs`). It launches your installed Chrome visibly with throttling off, at 1280×720 and 2× pixel ratio, starts the dev server if needed, and saves results to `bench-results/` (git-ignored):

```
npm run bench                                          # all scenarios
npm run bench -- idle_cluster,rockets_cluster          # some
npm run bench -- --compare docs/perf-baseline-2026-10.json
npm run bench -- idle_empty --profile                  # CPU profile + allocation sample per scenario
```

`--profile` prints top self-time and allocating functions and saves a `.cpuprofile` per scenario (open in Chrome DevTools). Profiling skews timings, so take numbers from unprofiled runs. The runner also lists page errors and console warnings. Scenarios can be run by hand too: `http://localhost:5174/?bench=all`.

- **Scenarios:** `src/catalog/benchmarks.ts`. Each fixes the map seed, craft, forces and a fire schedule.
- **Driver:** `src/scenes/mission/debug/bench.ts` (`s.bench`).
  - seeds `Math.random` for the mission
  - wraps the game loop so the sim always steps 1/60 s
  - holds the player on station, aims at the cluster and fires on the schedule
  - no mission end, no stats saved
- **Report:** per scenario, written to `window.__benchResults` and the console (`[bench]`).
  - CPU per frame (sim + render submit), real frame interval, CPU outside the scene (mostly render)
  - every perf stage: avg / p50 / p95 / p99 / max
  - frames over 16 / 33 / 50 ms, long tasks
  - JS heap growth rate and drops (garbage collections), Chrome only
  - unit, shot, debris and particle counts
- **Live state:** `window.__benchProgress` and `window.__benchScene` (for automation).
- **By hand, use a visible, focused window.** A hidden tab throttles the frame loop and the numbers are meaningless. The runner sets the Chrome flags that prevent this.

| Scenario | What it isolates |
|---|---|
| `idle_empty` | Engine floor: terrain, HUD, player |
| `gun_empty` / `rockets_empty` | Shots, trails, particles and impacts with no units |
| `idle_cluster` | 120 engaged units (AI, steering, enemy fire), no player fire |
| `gun_cluster` / `rockets_cluster` | Player barrage into the cluster: hits, blasts, deaths |
| `mission_idle` / `mission_idle_s0` | A generated mission, with and without settlements |

## 2. Baseline (2026-10-05)

Taken with `npm run bench` (raw: `perf-baseline-2026-10.json`). Chrome, Apple M3 Max, 120 Hz display. The fixed 60 Hz sim step runs at 2× real time. Times are in ms. "Interval" is the real time between frames, so it includes GC between frames and GPU waits that the CPU column doesn't.

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

A first, manual run (Chrome over raw DevTools, console capture on for the whole suite) read 12–50% slower with CPU spikes up to 62 ms. Those spikes don't reproduce under the runner, so they're attributed to that setup.

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

## 4. Plan

1. **`Graphics` redraws.** Rank `Graphics` objects by command count per frame and convert the worst offenders, HUD first. Targets: idle allocation under 20 MB/s, and `Graphics` self time under 3% in `rockets_cluster`.
2. **Spatial grid** (`sim/spatialGrid`): a uniform 128-unit grid, rebuilt once per frame into typed arrays, with allocation-free queries. Convert in order, measuring after each:
   - ground steering, blocked check and separation
   - player shot hit test
   - blast damage
   - remote AI scans
   - guided-missile retargeting and bomblet target picks
3. **Unit AI hot path:** remove per-frame allocations (`u.turrets.slice()`) and repeated `specOf` lookups in `updateUnits` / `driveGroundVehicle`.
4. **Phaser render-side costs:** find which objects re-upload textures every frame (`texImage2D`), cut `setVisible` churn in unit sprites, reduce emitter count and depth-sort load (8 depth-banded slots per effect type).
5. **Render batching:** draw-call and texture-switch counts per frame, then fewer blend-mode breaks.
6. **Fix the ember frame warning.**
7. **Later:** input recording and replay on top of the bench driver, so input goes through one per-frame snapshot.

After each step: `npm run bench -- --compare docs/perf-baseline-2026-10.json`.
