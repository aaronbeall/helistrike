# Performance investigation — October 2026

Read-only investigation: no code was changed. It combines three parallel deep dives (per-frame unit loops, line of sight, visual effects) with headless world-generation measurements and my own checks of the key claims.

**Legend:**
- ✅ **verified:** confirmed in the code or measured
- 🔎 **reported:** a code-reading estimate, not yet profiled

---

## TL;DR

- **The most likely cause of the regression is static neutral structures** (houses, pylons, bridge segments, stations…) now living in `units`. That roughly doubles the unit list, and every system that touches units pays for them:
  - the sprite pool: 10 Images per unit, all walked and re-synced every frame
  - O(N²) ground steering
  - the shot × unit hit tests
  - reticle picking, run many times a frame
  - minimap dots
  - the display-list depth sort
- **Line of sight is not the cause.** It's hard-capped at about 2k height samples a frame (<0.1 ms). It does have correctness problems under load (§4).
- **The suspected effects are mostly cheap:**
  - **Water ripples:** zero GPU cost when idle.
  - **Power lines:** under 0.1 ms, except brief spikes during a short.
  - **Shoreline waves:** moderate. A fill-rate cost on shore pixels only.
  - **Real fixed GPU cost:** the always-on PostFX bloom plus an identity barrel pass, which predates this work.
- **The perf overlay hides render cost.** "outside/vsync" is `frame − scene`, so Phaser's render CPU work (display-list sort, batching, WebGL submits) and GPU waits land in the "idle" bucket. The quiet capture (2.4 ms scene, 5.9 ms "outside") can't tell idle time from render cost.

---

## 1. What actually changed in unit counts (measured ✅)

Headless world generation, average of 2 seeds per preset. "HEAD" means the last commit, extracted to a scratch folder.

| Preset | Combat spawns HEAD | Combat spawns now | Neutral structures now (top kinds) |
|---|---|---|---|
| River Run | 74 | 74 | **67** (house 22, pylon 21, bridge 11, station 5) |
| Coastal Strike | 43 | 43 | 46 |
| Island Chain | 49 | 49 | 36 |
| Highland Siege | 97 | 97 | 40 |
| Desert Flats | 74 | 74 | **70** (pylon 34, house 25) |
| Autumn Lakes | 68 | 68 | 63 |
| Golden Scar | — | 80 | 68 |
| Blackwater Delta | — | 61 | 15 (bridges) |
| Molten Peak | — | 78 | 0 |
| Xeno's Staircase | — | 75 | 17 (bridges) |

- **Combat spawns are unchanged.** That rules out "more combat units".
- **Structures add 40–70 units on settled maps,** about 1.9× the list. Crews spawned at runtime, and dead units (never pruned from `units`), add more.
- **A quick A/B test:** play the same preset with SETTLEMENT 0, or play Molten Peak, which has no structures. If the drop disappears, this is the cause.

---

## 2. Hotspots, ranked by likely impact

### 2.1 Sprite pool and display list ✅ (`render/unitSprites.ts:244-480`)
- **What it does:**
  - The pool holds `liveN × 10` Images. Each unit owns a shadow, body, 6 parts, muzzle and roof.
  - **Every frame**, each of those Images is set invisible and gets a `getData("tiltWrap")` lookup, then the visible ones are rebuilt from scratch.
  - With about 145 live units, that's around 1,450 Images walked per frame. Each structure adds 10, even though it needs at most 3 (shadow, body, roof).
- **Slot churn:** slots are assigned in iteration order, so when a unit dies, every unit after it shifts slots. That invalidates the cast-shadow caches and causes texture re-sets.
- **Rebuilt every frame:** static buildings on screen recompute pose, shadow, edge-light and thermal state every frame. Each visible unit also allocates `place` closures and `forEach` lambdas.
- **Fix:**
  - Give **static structures their own path**: persistent shadow/body/roof Images, created once and updated only on camera change, damage or death.
  - Size the dynamic pool by *movers*.
  - Key slots by unit id.
  - Expected: the display list shrinks by about 7 Images per structure (roughly 400–500 fewer objects), and most of the sync loop goes away.

### 2.2 Depth sorting 🔎 (Phaser behaviour; confirm with a profiler)
- **The cost:** there are about 280 `setDepth` call sites. In Phaser 3, setting `depth` queues a full display-list sort, likely even when the value doesn't change. Units, embers (up to 320 Images), thermal marks (up to 384), surface wrecks, flares and trails all call `setDepth` every frame.
  - So the scene probably sorts its whole display list every frame: thousands of objects, including the hidden sprite slots from 2.1.
- **Fix:**
  - Only call `setDepth` when the value actually changes.
  - Group objects into Layers by depth band and sort only the dynamic band.
  - Shrink the list (2.1).
- **Where it shows up:** the "outside/vsync" bucket, which is why the overlay can't see it.

### 2.3 Ground steering is O(movers × all units) ✅ (`enemy/unitSim.ts:272-388`)
- **What it does:** `steerGround` runs 2 passes, plus `groundUnitBlocked` and `separateGround`. That's about **4 full scans of `units` per moving ground unit per frame**, also used by infantry (:930/:957), stunned units (:621) and ground remotes (`remote/ai.ts:600`).
- **Neutral buildings are worst-case candidates:** they're *solid obstacles*, so each one pays `specOf`, `isGroundVehicle` and an uncached `circumRadiusOf` (a `hypot`) before the distance reject.
- **Scale:** about 40 movers × about 145 units × 4 ≈ 23k pair checks per frame. That cost scales directly with the doubled list.
- **Fix:** a **spatial grid** (§5.1). Static solids go in a grid built once; movers go in a per-frame grid. Precompute per-kind `solid`, `pad` and `circumRadius`, and cache static footprints. That's about 1–2k checks instead of 23k.

### 2.4 `reticleUnit()`: units × calls × shots 🔎 (`weapons/fireControl.ts:1926`)
- **What it does:** it scans every live unit (structures included), allocating a `footprintOf`, a `worldToScreen` and a `screenToWorldAtZ` per candidate.
- **Called many times per frame:**
  - `hostCraft`, `reticleHud`, `cornerHud`
  - `fireControl` (twice)
  - `refractor`
  - **once per guided shot in flight** (`projectiles.ts:247/840/895`), which makes it O(shots × units)
- **Fix:** compute it **once per frame** and cache the result. Cull in screen space first.
- **Related:** `hoverAerial` (:1907) samples terrain (`castZ`) for every unit before checking whether it's aerial. Reorder those checks.

### 2.5 Player shot hit tests and blasts 🔎 (`weapons/projectiles.ts:424`, `:1541`)
- **Shots:** O(shots × units), with `specOf` and a `circumRadiusOf` hypot per pair. Chaingun fire against hundreds of structures adds up. The refractor does 5 samples × all units.
- **Blasts:** `applyBlastDamage` has **no distance broadphase**: it runs `distToFootprint` on every unit for every explosion.
- **New this session:** heli-crash splash and death splashes (inferno at 5× radius) can **cascade** through dense towns. Each death triggers another full-list blast plus a full crew scan (`destroyUnit` :133). These are frame **spikes**, not the steady drop.
- **Fix:**
  - Use the grid (§5.1).
  - Add a squared-distance reject before `distToFootprint`.
  - Keep a host → crew map.
  - Defer chain deaths to the next frame, or cap deaths per frame.

### 2.6 PostFX is always on 🔎 (`debug/postFx.ts`, predates this session)
- **What runs:** with FX on (the persisted default), **bloom (3 blur passes) plus barrel** stay attached to the main camera. Barrel sits at amount 1, an identity transform, so it's a full-screen pass every frame with no visible effect.
- **Total:** about 5 full-screen passes per frame. This is the largest fixed GPU cost found.
- **Fix:** attach barrel only while `barrelPulse > 0`. Bloom at half resolution, or 1–2 blur steps.
- **What's fine:** shock, glitch, warp, cloak and thermal already add and remove themselves correctly.

### 2.7 Minimap redrawn every frame 🔎 (`hud/minimap.ts:60`)
- **What it does:** it allocates a `toMap` object per unit and `fillCircle`s every unit in the ring, every frame. Near a town that's 100+ circles re-tessellated each frame.
- **Fix:** bake static neutral dots into the minimap terrain texture once, and redraw on death. Draw only movers live.

### 2.8 Embers break render batches 🔎 (`fx/groundMarks.ts` `syncEmberGlow`)
- **What it does:** up to 160 glows × 2 ADD-blend Images, depth-sorted among NORMAL-blend sprites. Every NORMAL↔ADD switch flushes the batch, which can mean 100–300 extra draw calls near crater fields.
- **CPU side:** 3 `sin` calls, an allocating `worldToScreen`, a `setDepth` and two `setTint`s per glow per frame.
- **Fix:**
  - Put all embers on one depth band or layer, or a single ADD Blitter or particle layer.
  - Cap them around 64.
  - Use a scratch `ScreenPos`.
  - Skip off-camera glows.
- **Flares** have the same blend-switching pattern, but they're short-lived.

### 2.9 Surface wrecks are uncapped 🔎 (`fx/groundMarks.ts:170`)
- **What it does:** every wreck floating on water is synced every frame (allocating `worldToScreen`, `setDepth`, a thermal tint), visible or not, with no cap.
- **Fix:** cap them, use a scratch `ScreenPos`, and re-sync only on camera or thermal change. This also fixes the map-view bug from the code review.

### 2.10 Shoreline waves (moderate GPU) 🔎 (`render/terrain25d.ts:138-165`)
- **Where it lives:** inside the terrain fragment shader, not a post pass. The shore texture is uploaded once, and the only per-frame upload is a time uniform.
- **The cost:** pixels within 26 texels of any water edge pay 1 gate fetch plus 4 `shoreCrest` calls (4 fetches, 4 `sin`, 8 `smoothstep`), about 3–4× a normal terrain pixel. Other pixels pay 1 extra fetch.
- **When it matters:** it's free with no shore on screen, but fill-bound on integrated GPUs, especially for lake and river maps with long coastlines.
- **Fix:** sample once with hardware bilinear (5 → 2 fetches), or bake the crest into a small animated lookup. It's already a debug toggle (`shoreWaves`); make it a quality setting.

### 2.11 Water ripples (cheap when idle) 🔎 (`fx/ripples.ts`)
- **Idle:** **no GPU work.** Clear, draw and the shader read are all skipped. The CPU still walks every unit (`wade`) each frame; structures return early because their speed is 0.
- **Active:** a 1024² render texture, a scissored dirty-box clear, and about 1–2 draw calls for up to 640 quads.
- **Allocations:**
  - one object per spawn
  - a `box` closure per frame
  - `[-1, 1]` arrays per wake per frame
  - `live.shift()` at the cap, which is O(640)
- **Fix:** a ring-buffer pool, a hoisted closure, a numeric side loop, and iterate only water units and moving land units.

### 2.12 Power lines (cheap) 🔎 (`world/powerLines.ts`)
- **Steady state:** about 20 visible spans × 2 wires × 8 segments is roughly 320 line quads. Tessellation at that size is negligible. `wirePoint` re-reads `specOf`/`heightOf` about 18× per wire, still under 0.1 ms.
- **Spikes:** a short schedules 22 `delayedCall` closures with 44 zaps and about 200 sparks over 100 ms, doubled when two spans short.
- **Fix (optional):** cache endpoints per span, and skip zap FX for off-screen shorts.

### 2.13 Small per-frame waste that adds up 🔎
- **`unitSim.updateUnits`:** `u.turrets.slice()` per unit per frame (`unitSim.ts:762`).
- **`remote/ai`:** `remoteFriendlySensors()` builds a new array per unit per frame (`ai.ts:103`).
- **Other per-frame unit scans:**
  - `syncThermalHotspots` allocates a points array per frame
  - an O(hv × units) HV-alive scan (`missionScene.ts:1289`)
  - `units.find(hv)` in `cornerHud` and `camera`
- **Many `worldToScreen` calls without a scratch `out`:** roofs, wrecks, embers, thermal marks, flares.
- **Dead units are never removed from `units`,** so every loop walks corpses for the rest of the mission.
- **Arcade physics is enabled** (`main.ts`) only for one `setBounds` call. The physics world still steps every frame. Remove it if unused.

---

## 3. What your suspicions turned out to be

| Suspect | Verdict |
|---|---|
| Unit spawning changes | **Combat spawns unchanged** (measured). **Static neutral structures** doubling `units` is the prime suspect (2.1, 2.2, 2.3, 2.4, 2.5, 2.7). |
| Line of sight | **Not the regression.** Bounded at about 2k samples a frame, <0.1 ms. It has correctness problems under load (§4). |
| Shoreline waves | Moderate GPU fill cost on shore pixels only (2.10). Test it with the toggle. |
| Impact ripples | Cheap. No GPU work when idle (2.11). |
| Power lines | Cheap, under 0.1 ms. Brief spikes during shorts (2.12). |

---

## 4. Line of sight (deep dive)

### Current cost model ✅
- **Calls:** one `sees()` per live, non-neutral, non-stunned unit per frame, from `unitSim.ts:777` only. No duplicate calls.
- **Cached call:** a hypot, a WeakMap get, and the `awareBase`/`enemyAwareReach` maths in the caller.
- **Traced call:** up to 81 `groundZ` samples. Each is about 8 typed-array reads plus lerps, roughly 15–25 ns, so about 1.5–2 µs per clear ray. Blocked rays exit early.
- **Budget:** 24 traces per frame, refreshed every 350 ms ±25%. The worst case is about 2k samples per frame (**~30–60 µs**). Throughput is about 500 units in reach before refresh latency grows.

### Problems
1. **Stealth bug:** LOS reach shrinks with stealth (×0.32 for stealth craft, ×0.15 for remotes), but firing range doesn't. Turrets beyond the shrunk reach fire through hills.
   - **Fix cost:** raising reach puts up to about 10× (stealth) or about 44× (remote) more units in the traced disc. CPU stays capped by the budget, so the real cost is *latency* once more than about 500 units are in reach.
2. **Budget starvation:** traces are served in `units` order, so late units starve when demand exceeds the budget. A unit with no cache returns `true`, meaning "unknown → visible", so it can see through hills until it's served.
3. **Aware units trace forever:** they get `reach = Infinity`. On long rays the 80-step cap stretches samples to about 70 world units (about 22 texels), which can miss thin ridges.
4. **Static units retrace every ~350 ms** even when neither end has moved.

### Ranked optimisations
1. **Fix fairness first:** a ring cursor, or a queue ordered by `due`, plus "unknown = blocked for firing" (or a synchronous first trace).
2. **Temporal coherence:** skip a retrace unless the target or the unit moved more than about `LOS_STEP`, and scale the refresh interval with distance. That's about 2–5× fewer traces.
3. **Global max-height early accept:** if both ends are above `maxGroundZ + clear`, the ray is clear, in O(1).
4. **A max-pooled coarse grid (16² texels per cell, 113² cells) walked with DDA:** skip any cell whose max height is below the ray. Refine at texel resolution only in cells that might block. That's about 3–6× cheaper clear rays, *and* it fixes the coarse-sampling ridge misses.
5. **Sharing across clusters:** cache by (coarse cell, eye-z bucket, target), so garrison clusters share one trace.
6. **Small cleanups:**
   - store `Sight` on the `Unit` instead of in a WeakMap
   - compare squared distances
   - cache `awareBase` per kind
7. **Skip:** Lipschitz/sphere-tracing steps. Cliffs make the slope bound steep, so the steps stay small.

Items 1–3 are small and fix correctness. Item 4 is mainly about accuracy and allowing a larger budget.

---

## 5. Going further: making it smooth under chaos

### 5.1 Spatial partitioning (high value, moderate effort)
- **The structure:** a uniform grid, cell about 96–128 world units, so roughly 50×50 cells for a 5600-unit map.
  - **Static layer:** structures, built once and updated on death.
  - **Dynamic layer:** movers, rebuilt every frame by counting sort into flat typed arrays (`cellStart`, `cellItems`). No allocation, roughly O(n).
- **Queries:**
  - ground steering, blocked checks and separation (2.3)
  - shot hit tests (2.5) and blast damage (2.5)
  - reticle and hover picks (2.4)
  - lock-on candidates and tesla chains
  - remote AI target scans
  - LOS cluster sharing (§4.5)
- **Expected:** O(n²) and O(shots × n) costs drop to O(n·k), where k is about 5–15 neighbours. That matters most during chaos: many shots, many blasts and many movers at once.
- **Pair it with** a compact live/mover list (prune dead units, split out statics), so the grid isn't fed corpses.

### 5.2 Billboards in real 3D instead of 2D sprites (biggest lever, biggest effort)
**Today:**
- every object is projected on the CPU each frame (`worldToScreen`);
- ordering is done with `setDepth` plus Phaser's display-list sort;
- blend-mode switches break batches.

**A custom WebGL path** (a Phaser custom pipeline or render node, or a separate three.js/regl layer under the HUD) would:
- **upload per-instance world position, size, rotation, atlas frame, tint and heat**, and project in the vertex shader with the same 2.5D camera maths. That removes the CPU `worldToScreen` and `setDepth` for every object;
- **use the depth buffer** (alpha-tested or premultiplied sprites write depth) instead of sorting. Additive effects (glows, sparks, embers, muzzle flashes) are order-independent, so they render in one pass after the opaque layer, with no sort. Only translucent smoke needs a back-to-front sort, by cheap bucketing;
- **draw thousands of particles, shots, debris and units in a handful of instanced draw calls** from one texture atlas;
- **keep ground decals (craters, wrecks) as render-texture stamps,** as they are now.

**Cost:** it touches every render module: units, shadows, roofs, debris, shots, trails, particles, embers, thermal tinting and camo. Thermal and camo become shader branches (that's an upside).

**Recommended path:** do it incrementally, starting with the highest-volume, simplest categories:
1. particles, sparks, embers
2. shots and tracers
3. debris and casings
4. units last

Do 5.1 and the Tier 1 items first. They may be enough.

### 5.3 Vsync and frame pacing
- **In the browser you can't turn vsync off.** `requestAnimationFrame` is locked to the display. Phaser's `forceSetTimeOut` is worse: it adds jitter and tearing artifacts. In a desktop wrapper (Tauri/Electron), vsync can be disabled, but that trades smoothness for tearing. Not recommended.
- **On a 120 Hz display the budget is 8.33 ms.** Missing it drops a frame, which reads as stutter even at 100+ fps. Options:
  - **Frame-rate cap:** `fps: { limit: 60 }`, or a user setting "60 / 120 / uncapped", gives a 16.7 ms budget with consistent pacing. Smooth 60 beats an uneven 90–120.
  - **Fixed-timestep simulation:** run AI, physics and shots at a fixed 60 Hz with an accumulator, and render with interpolation. Gameplay stays deterministic and stable, and the render rate is free to vary.
  - **Phaser's `fps.smoothStep`** is on by default and helps absorb one-off spikes.
- **A dynamic quality governor:** if rolling p95 frame time goes over budget, step down particle density, bloom and shore waves; step back up when there's headroom. This is standard for keeping chaos smooth.

### 5.4 Standard practices worth adopting
- **Measure the hidden bucket first:**
  - Split "outside/vsync" into render CPU (timestamps on `game.events` `prerender`/`postrender`), GPU time (`EXT_disjoint_timer_query_webgl2` where available) and true idle.
  - Add draw-call and display-list counts to the overlay (wrap `gl.drawElements`).
  - Profile a combat stress scene, not a quiet one.
- **Zero-allocation hot paths:**
  - scratch outputs for `worldToScreen`, footprints and overlap results
  - ring buffers instead of `push`/`shift`
  - hoisted closures
  - no array or object literals in loops
  - avoid `getData`, `Map` and `WeakMap` in per-frame loops (use plain fields)

  This prevents GC stutter in long fights.
- **Static vs dynamic separation with dirty flags:** static things (structures, power-line geometry, minimap dots, wrecks) update only when something changes.
- **Batch-friendly rendering:**
  - a texture atlas for units, parts, FX and doodads (fewer texture switches)
  - group by blend mode into layers (all ADD together)
  - avoid interleaving NORMAL and ADD
- **AI level of detail and time slicing:**
  - update far or unaware units at reduced rates (every 2–4 frames, staggered)
  - spread expensive decisions (target selection, steering look-ahead) over frames
  - full rate only near the player
- **Data-oriented hot sets:** struct-of-arrays (typed arrays) for shots, particles, debris and ripples instead of arrays of objects. That gives cache-friendly loops and no per-entity garbage.
- **Budgets everywhere:** caps per FX family scaled by quality tier, death-chain limits per frame, LOS and steering budgets with fair round-robin.
- **Remove unused engine systems:** arcade physics.
- **Later:** move simulation (AI, LOS, steering) to a worker using SharedArrayBuffer and SoA state. Only worth it once the main-thread work is lean; it adds sync complexity.

---

## 6. Recommended order

**Tier 0: measure (½ day)**
1. Split render CPU, GPU and idle in the perf overlay, and add draw-call and display-object counts.
2. A/B the same preset with SETTLEMENT 0, and with FX (PostFX) off.
3. Take a combat stress capture.

**Tier 1: likely recovers the regression**
4. Static-structure sprite path, and a mover-sized slot pool keyed by unit id (2.1).
5. `setDepth` only on change, and layered depth bands (2.2).
6. Spatial grid plus per-kind precomputed `solid`/`radius`, for steering, shot hits, blasts and picks (2.3–2.5).
7. Cache `reticleUnit` once per frame (2.4).
8. Bake static minimap dots (2.7).
9. PostFX: barrel only while pulsing; cheaper bloom (2.6).

**Tier 2: robustness under chaos**
10. Ember and flare blend layering and caps; cap surface wrecks (2.8, 2.9).
11. Blast broadphase and a per-frame death-chain cap (2.5).
12. Zero-allocation sweep (2.11, 2.13) and pruning dead units.
13. LOS fairness, temporal coherence and max-height accept (§4 items 1–3).
14. Frame-rate cap option, a fixed-timestep sim and a quality governor (5.3).

**Tier 3: architecture, for "butter smooth with chaos"**
15. A texture atlas, and SoA typed arrays for shots, particles and debris.
16. An instanced 3D billboard renderer with a depth buffer, done incrementally (5.2).
17. AI level of detail and time slicing; later, simulation in a worker.
