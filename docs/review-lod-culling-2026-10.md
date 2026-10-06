# Review: far-unit LOD + on-screen sprite pool (2026-10-06)

Review of the uncommitted work on top of `ee21dad` (spatial grid). The change cuts stress-map CPU by 24–26% and render by 28–33%. One LOD correctness gap and a few design issues should be addressed before committing.

## Summary

Two optimizations, plus wiring:

- **Far-unit sim LOD** (`enemy/unitSim.ts`): hostile units that are off screen *and* outside their reach of every target update every 4th frame with the summed `dt`. Debug-menu toggle "Far unit LOD"; perf overlay line `units full / far (ticked) / sprites`.
- **On-screen sprite pool** (`render/unitSprites.ts`): image blocks are held only by on-screen units and recycled through a free list, instead of 10 images per live unit (about 17,500 on the stress map).
- **Wiring:** `reset()` for both modules in `MissionScene.init`, the debug-menu item, the perf HUD line, a perf-plan note, bench rows in `docs/perf-history.csv`.

## Results

3-run medians, times in ms. Baseline = `ee21dad` re-run on its own dev server; after = this change.

| Scenario | Frames | CPU avg | CPU p99 | Render | Unit sim | Interval p99 |
|---|---|---|---|---|---|---|
| idle_stress | 879 → 921 | 10.89 → 8.23 (−24%) | 14.0 → 10.1 (−28%) | 4.08 → 2.93 (−28%) | 2.27 → 1.74 (−23%) | 17.8 → 17.4 |
| gun_stress | 621 → 685 | 13.17 → 10.02 (−24%) | 20.2 → 15.6 (−23%) | 5.63 → 4.04 (−28%) | 2.33 → 1.72 (−26%) | 25.9 → 25.2 |
| rockets_stress | 617 → 644 | 14.16 → 10.43 (−26%) | 23.7 → 17.2 (−27%) | 7.04 → 4.70 (−33%) | 1.84 → 1.43 (−22%) | 58.3 → 50.1 (−14%) |
| idle_cluster | 1208 → 1208 | 3.67 → 3.42 (−7%) | 5.1 → 4.8 | 1.84 → 1.68 (−9%) | 0.75 → 0.72 | 10.2 → 10.0 |
| gun_cluster | 982 → 1100 | 6.25 → 5.78 (−8%) | 10.2 → 9.8 | 3.44 → 3.16 (−8%) | 0.80 → 0.79 | 23.8 → 17.1 (−28%) |
| mission_idle | 1208 → 1208 | 1.74 → 1.51 (−13%) | 5.6 → 4.4 (−21%) | 0.66 → 0.63 | 0.48 → 0.27 (−44%) | 10.2 → 10.2 |

- The render drop comes from culling: a much smaller display list for Phaser to walk and depth-sort. The unit sim drop comes mostly from LOD.
- Stress-map frame counts rise only a little; they're now limited by the GPU and display refresh, not CPU.
- Normal maps gain little, because they have few units and most are near the player. The gain scales with how many units are idle and off screen.
- For context, the spatial grid step before this took the stress maps from 29–32 ms to 11–16 ms CPU. Combined, the stress maps went from about 30 ms to 8–10 ms a frame.

The sort the grid does on every query (to keep results in `s.units` order) was profiled at 0.1% CPU, about 0.01 ms a frame, so it stays.

## How it works

### Far-unit sim LOD (`UnitSim.updateUnits`)

1. `prepLod()` runs once per frame:
   - projects the four screen corners onto the ground (at z = 0 and z = `MAX_AGL`) to get a view radius around the camera focus, plus `LOD_MARGIN` (300);
   - builds a flat `[x, y, awareMul]` list for the player and each targetable remote.
2. `isFar(u)` is false when either holds:
   - the unit is inside the view radius;
   - any target is within `reach × awareMul + LOD_MARGIN`, where reach = max(sight base, weapon and gun ranges), cached per unit kind.
3. Per unit, `lodAcc[i]` accumulates `dt`. A far unit runs only when `(frame + i) % LOD_EVERY == 0` (every 4th frame, staggered by index) or its accumulated time reaches `LOD_MAX_DT` (0.1 s). It then gets the whole accumulated `dt`, so speeds, timers and cooldowns stay correct. Near units also flush any leftover time; so does the next update after LOD is toggled off.
4. Skipped units `continue` before `cur` and `spatial.moved` are set. The spatial grid stays correct because the unit didn't move.

### On-screen sprite pool (`UnitSprites.sync`)

1. `slotOf[unitIndex]` is the image block a unit holds, or −1.
   - `claimSlot` pops a block from the free list, or creates a new 10-image block (shadow, body, 6 parts, muzzle flash, roof).
   - `releaseSlot` returns it.
2. Each frame, every unit's held block is hidden first.
   - Dead or off-screen units release their block.
   - Visible units keep theirs (or claim one) and run the existing pose code, using the block index where the old code used a live-unit counter.
3. Blocks are never destroyed: the pool grows to the peak on-screen count (about 285 blocks at spawn on the stress map). Opening the theater map doesn't inflate it, because the sim pauses while the map is open.

## Findings

| # | Severity | Area | Finding | Fix | Status |
|---|---|---|---|---|---|
| 1 | High | LOD correctness | Reach is cached per unit kind, but `gunsOf(u)` returns per-unit rolled `parts` (and `sightBase(u)` reads them). A unit with a longer-range rolled gun than the first of its kind gets underestimated reach, so it can be treated as far inside its own weapon range. It then updates at about 15 Hz instead of every frame. | Cache reach per unit (an index-keyed array computed on first sight), or key the cache by the parts array. | Open |
| 2 | Medium | Hot path | `prepLod` allocates small arrays every frame (`[0, MAX_AGL]` and the corner tuples), breaking the no-allocation rule for `update()`. | Hoist them to module constants. | Open |
| 3 | Medium | Layering | The reach rule is a game rule inside UnitSim, and it repeats `sightBase`'s weapon-range scan. | Move `unitSightBase(u)` / `unitEngageReach(u)` to `sim/` as pure functions shared by AI and LOD (AGENTS: "game rule → `src/sim/…`"). | Open |
| 4 | Medium | Cohesion / reuse | The LOD policy (`lodOn`, `lodStats`, `lodAcc`, `lodFrame`, `viewR`, `lodTargets`, `prepLod`, `isFar`, the skip/flush branch) is a separate concern added to a module of about 1,350 lines. Other loops that walk every unit every frame (`fx.emitUnitDamageFx`, `ripples.update`, line-of-sight) can't reuse the "far" verdict. | Extract `enemy/unitLod.ts`: `prepare()` plus `step(i, u, dt)` returning the `dt` to run, or `null` to skip. | Open |
| 5 | Medium | Maintainability | Per-unit-index side arrays are multiplying, each with copy-pasted grow code: the spatial index, `unitSim.lodAcc`, `unitSprites.slotOf`, `SpatialGrid.ensure` / `SlotList.push`. All silently assume `s.units` is append-only and never reordered. | Add a `util/typed.ts` `grow(arr, n, fill?)` helper, plus one owner of the index contract: `MissionScene.addUnits(...)` (spawn and debug spawn; it runs `spatial.sync`) with a dev-only append-only assert. | Open |
| 6 | Medium | Coherence | Two independent definitions of "on screen": sprites use the projected screen rect plus a 220 px pad (`camera.projectedInView`); LOD uses a world radius around the focus plus 300. LOD's "off screen" must cover at least everything sprites can draw. That holds today, but nothing ties the two together. | A camera helper (e.g. `groundViewRadius()`, once per frame) that both pads derive from. | Open |
| 7 | Low | Readability | The sprite block layout is magic index math (`i*10`, `+1`, `+2…+7`, `+8`, `+9`). `kids` stays valid after `claimSlot` only because Phaser's `Group.getChildren()` returns its internal array. `hideSlot` does a `getData("tiltWrap")` lookup per image per frame. | Build a per-block struct at claim time, `{ shadow, body, parts[6], flash, roof, wrap? }`, in a `blocks[]` array. | Open |
| 8 | Low | Naming | "Slot" means a unit's index in `s.units` in the spatial code, but an image-block index in `unitSprites`. | Rename the sprite one to "block" (`blockOf`, `claimBlock`, `freeBlocks`). | Open |
| 9 | Low | Debug | With LOD off, `lodStats` stays at zero, so the perf line reads "full 0 far 0". | Count full-rate updates either way. | Open |
| 10 | Low | Tidiness | `new Int32Array(0).fill(-1)` is a no-op fill; the never-shrinking pool is undocumented. | Drop the fill; add a one-line note. | Open |

### Next step for performance (not a defect)

`unitSprites.sync` and the LOD pass still loop over all units each frame. Sprite sync calls `worldToScreen` on every live unit before checking whether it's in view. The spatial index can already list the units in the view region. Sprite sync could then touch only on-screen units plus its held blocks, and the LOD pass could flip to "everything not near a view or a target is far". Both would then scale with what's visible rather than with map population.

## Recommendation

Before committing:

- [ ] Fix 1: per-unit LOD reach
- [ ] Fix 2: no per-frame allocations in `prepLod`

Follow-up refactor (behaviour-preserving; verify with type check, build and the same bench scenarios):

- [ ] Move the sight / engage-reach rules to `sim/` (3)
- [ ] Extract `enemy/unitLod.ts` (4)
- [ ] Add a camera view-radius helper used by LOD and sprite culling (6)
- [ ] Add a `util/typed.ts` grow helper and a single `MissionScene.addUnits` entry point with an append-only assert (5)
- [ ] Sprite blocks as structs, renamed to "block" (7, 8)
- [ ] Debug-stat and tidiness nits (9, 10)
