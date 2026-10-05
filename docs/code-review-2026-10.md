# Code review — October 2026 session

Scope: **every uncommitted file on disk**: about 45 changed files (+2.5k / −0.6k lines), 7 new modules and 53 new asset files.
- **First pass:** three parallel reviews by area: world generation; destruction, FX and power lines; units, art, rendering and rigs.
- **Gap pass:** the files the area split missed: `AGENTS.md`, `TODO.md`, `catalog/weapons.ts`, the full `menuScene.ts` diff, `camera/camera.ts`, `debug/menu.ts`, `hud/fieldBars.ts`, `hud/help.ts`, and every untracked file under `public/`.
- **Checks:** I verified the top findings against the code myself.

**Legend:**
- ✅ **verified:** confirmed in the code
- 🔎 **reported:** a reviewer's claim, plausible but not independently checked
- ❌ **dropped:** checked and turned out to be intended or not a bug

---

## 1. What changed (systems summary)

### Map generation
- **Map shapes** (`worldgen/shape.ts`):
  - **New:** `rift`, `delta`, `summit`, `volcano`, `shards`.
  - **Dropped:** `rings` and `spiral`. Escarpments and canyons were cut from `landforms.ts`.
  - **Delta:** a trunk channel from past the map edge, branches and sub-branches merged smoothly (`smin`), ragged banks, bank slopes that vary while channel width doesn't, and a thin sea strip.
  - **Volcano:** a lumpy crater sunk below the waterline, a jagged peak ring, and slopes that run out to every edge.
  - **Shards:** cracked-mud Voronoi plates, each gently domed at its own height and split by sharp cracks of varying width, on an edge-to-edge climb. Cracks flood on the low side.
- **Landforms:** `pyramid`: smooth or stepped, about 40% with a smooth ramp up one face, up to 12.
- **Themes** (`worldgen/theme.ts`):
  - **New:** savanna, swamp, volcanic (orange "molten" water, colour only) and alien.
  - **Autumn:** rugged rock peaks.
  - **Coastal:** limestone peaks were reverted to snow.
  - **Trees:** foliage tints are baked by hue shift (`FOLIAGE_TINTS` in `art/sprites.ts`).
- **Settlements** (`worldgen/settlements.ts`, new):
  - **Places:**
    - towns with a street grid, helipad and power station
    - ports with a pier unit, dock house and moored boats
    - airfields, dams, farms (printed under roads)
    - oil fields with a rig and sea platform
  - **Power lines:** pylon chains between stations.
  - **Bridges:** water crossings become destructible deck units (`placeBridges`).
  - **Roads:** routed with A* (`RoadGrid`), plus town streets. The paved road and steel bridge art are kept but switched off (`Road.paved` is never set).
- **Profile / menu:**
  - `waterSites` (ports, dams and oil fields on/off).
  - NAVAL can go to 0, meaning no boats.
  - PYRAMIDS count.
  - RANDOMIZE has a ‹ BACK history.
  - The mission thumbnails come from `paintTerrainPreview()`, which uses the real shape, landforms, biomes, theme colours and terracing with hill shading. Each takes about 15–30 ms.
- **Presets:** GOLDEN SCAR, BLACKWATER DELTA, MOLTEN PEAK, XENO'S STAIRCASE.

### Units and structures
- **Buildings as units:** the `civ()` helper (`catalog/units.ts`) with the presets `WET`, `OFFSHORE` and `MILITARY`.
  - Neutral civilian units: no health bar, grey on the minimap, filtered by `hostileUnit`.
  - Military buildings are enemies.
- **New `UnitSpec` fields:** `neutral`, `roof {tex, hulk, noBody}`, `deathFx` (inferno / sparks / zap / collapse), `breakApart`, `wreckJitter`.
- **Structure art:** `art/structureArt.ts` + `boxArt` baking (1 px = 1 world unit), with a darkened fallback when there's no hulk art and a cropped single silo.
- **Break-apart wrecks** (`art/hulkBreak.ts`): variants generated at load, plus an art rig tool.
- **Power lines** (`scenes/mission/world/powerLines.ts`):
  - wires drawn between pylons
  - a zap run along the wires when a pylon or station dies
  - rotor strikes snap a wire and jolt the player: shock post-FX (`render/shockFx.ts`) plus 3% damage
- **Sinking:** battleships sink like boats.
- **Crashes:** heli crashes damage what they land on, with more loft and half gravity.
- **Line of sight** (`enemy/lineOfSight.ts`): budgeted, staggered terrain traces, only within each unit's awareness reach.

### FX
- **Fire:**
  - a soft cap on flame size, and flames emit from a small area
  - smoke matched to fire size via `pair`/`pairHurt` (flame trails opted out)
  - stronger damage smoke
  - the puff and blast-fire particles removed
- **Debris:** constant gravity with a loft factor (`DEBRIS_LOFT`), livelier casing bounces, and roof pops with a slow spin and no bounce.
- **Flares:** rebuilt as a streak, a glowing head and sparse particles. The Field Manual preview was updated to match.
- **Embers:** last about 4× longer, tinted orange→red like coals, and read 75% hot on thermal.
- **Thermal hulks:** hulk wreck marks glow and cool down like casings (hold 4 s, fade 22–36 s).
- **Shallow-water craters:** craters in shallow water get a light blue tint and no embers. Crash hulks there keep their normal tint.
- **Shadows:** buildings cast from 25% of their height, ground vehicles from 50%.

---

## 2. Performance context

Quiet in-game capture (144 units, 0 shots, 3 debris, 0 particles, 120 Hz display):

| | avg ms | p95 ms |
|---|---|---|
| Frame | 8.33 | 8.40 |
| Scene total | 2.40 | 2.90 |
| Unit sim | 1.21 | 1.40 |
| Unit draw | 0.16 | 0.20 |
| Scene other | 0.66 | 0.90 |
| Idle (vsync) | 5.93 | 6.27 |

- **Frame time isn't a concern at rest.** The scene uses about 29% of the frame budget, and p95 sits almost on the average, so there are no hitches.
- **Unit sim is the biggest slice** (half the scene). Neutral buildings skip the AI early (`unitSim.ts:757`), so the cost is the combat units: AI, steering, targeting, LOS and firing. Profile here first if needed.
- **Draw-side worries were overstated.** The 10th sprite slot per unit and the roof and shadow work all fit inside 0.16 ms.
- **What this capture can't show:** combat. Most per-frame allocations live in the shot, debris, particle, flare and power-line short paths, and their risk is GC stutter during heavy fighting, not average frame time. **TODO:** take a combat stress capture (several flares out, sustained fire, an oil-rig chain explosion, a pylon short) and check p95 and max.
- **Load time is separate.** Delta maps take about 5–7 s to generate versus about 2.5–3.5 s for other shapes (measured headlessly).

So: per-frame micro-optimisations are **deprioritised** until a combat capture shows a problem. Correctness and design items keep their priority.

---

## 3. Bugs

### High
1. ✅ **Enemies fire through terrain when the player flies low.** `unitSim.ts:777` traces LOS only out to `enemyAwareReach(awareBase(u), 1, h)`, which shrinks with the target's awareness multiplier (×0.82 at nap-of-earth, less for stealthy craft). Past that reach, `lineOfSight.sees()` returns `true` without tracing (`lineOfSight.ts:58`). Firing is gated on the unshrunk `wpn.range * vision` (`enemyFire.ts:79/86`). So in the band between the shrunk reach and the weapon range, turrets shoot through hills, exactly when the player is using terrain cover.
   *Fix:* `losReach = max(enemyAwareReach(...), awareBase(u) * 1.15)`, so the trace never covers less than the fire and slew envelope.
   **Resolved (2026-10-05):** fixed the other way round. Beyond sight range a unit can't see, so it neither aims nor fires (`lineOfSight.sees()` returns false).
2. ✅ **Floating wrecks show through the theater/map view.** `groundMarks.ts:172` `syncSurfaceWreck` calls `setVisible(true)` every frame and ignores the map overlay, whose hide only applies once (`camera.setTheaterWorldHidden`). The same pattern needed `hideFlareVisuals` before.
   *Fix:* return early on `s.camera.mapWorldHidden` (or `mapBlend > 0.12`).
3. ✅ **FIXED: seams inside Shards tiles.** The edge distance used only the second-nearest centre's bisector, so it jumped where that switched. It now uses the exact nearest bisector over every neighbour, culled with a precomputed centre-gap table. Shards has since been reworked into cracked-mud plates with sharp gaps, so its tiles no longer have peaks that could crease.

### Medium
4. ✅ **Settlement prints ignore unit footprints.** Airfields, the town plaza, helipads and farm fields only check `clear()` (spawn and objective zones). `occupied` is checked only by `building()` (`settlements.ts:200`). Runways and fields can print under patrols and garrisons, and `levelRect` flattens the ground beneath them.
   *Fix:* test the footprint against `inp.occupied` too.
5. ✅ **`water` is overloaded,** so offshore buildings aren't obstacles. `unitSim.ts:280` (and 314/337/368) skips every `osp.water` unit when checking collisions. `water` currently means three things: sinks (boats), wreck stays at deck height (bridges and piers), and doesn't block movement. A dock house or pier that ends up on land is drive-through.
   *Fix:* split it into explicit fields (see §4).
6. 🔎 **The oil-rig inferno pulse has no distance falloff.** `destruction.ts:208` calls `pulseBarrel(0.7)` with a fixed strength, and `infernoChain` adds +4 shake ×5. An off-screen rig chain gives full-screen warp and shake.
   *Fix:* scale by the same `near` factor `killPulse` uses.
   ❌ *Dropped:* "barrel pulse ~4× stronger on all deaths". That's the restore you asked for.
7. ✅ **Ports round to 0 at their own threshold.** `settlements.ts:140`: at `density >= 0.4`, `Math.round(0.4)` gives 0.
   *Fix:* `Math.max(1, Math.round(density))`.
8. 🔎 **Roads can bridge open sea.** `RoadGrid` water cost (`ROAD_WATER`) is expensive but never blocking. On island or isthmus maps a trunk road can cross open sea, and `placeBridges` then spawns one deck unit per 62 world units, possibly dozens.
   *Fix:* cap the wet run length, or skip spans longer than a maximum.
9. 🔎 **Structures can turn invisible.** `structureArt.ts` `drawStub` has no `default:` case. If an art file fails to load, these bake as transparent but solid, destructible units: pylon, bridge, power_station, silo, oil_rig, sea_platform, dock_building, fishing_boat, yacht, the fields and the helipad.
   *Fix:* a generic outlined-box default.
10. 🔎 **Authored hulks are darkened twice.** `sprites.ts` (~1129) applies `darkenWreck` to authored `_hulk.png` art too. The comment says darkening is only the no-hulk fallback. Decide which is intended and make the code match.

### Low
11. 🔎 **Unreachable border cells in road routing.** `RoadGrid.search` skips neighbours on the border, but `cell()` clamps goals into them. A goal on the border floods the whole grid, then falls back to a straight line.
    *Fix:* clamp `cell()` to `[1, n-2]`.
12. 🔎 **Double jolt.** `rotorStrikes` can jolt the player twice in one frame when the rotor clips two spans at a pylon.
    *Fix:* gate the jolt to once per frame.
13. 🔎 **Inferno and crash splash damage can cascade.** `applyBlastDamage(..., skipDeathSplash=false)` runs inside death handling, so a cluster of rigs or tanks can chain-kill recursively. Confirm that's intended.
14. 🔎 **Stale LOS when switching targets.** When the target switches and the per-frame trace budget is already spent, `sees()` returns the previous target's cached result. Units re-entering reach also read as "visible" until budget frees up.
    **Resolved (2026-10-05):** entering range or switching target starts unsighted until a check sets it.
15. 🔎 **Phantom pylon reservations.** `placePowerLines` reserves pylon discs in `occupied` before it knows whether the line will be kept.
16. 🔎 **Duplicate break variants.** `breakApart` seeds use `i*7919 + hulk.length`, so hulks with the same key length get identical breaks.
    *Fix:* hash the key.
17. 🔎 **Reset gap:** `StatusHud.reset` doesn't reset `jolting` (harmless today).

### From the gap pass
18. 🔎 **RANDOMIZE can roll contradictory settings** (`menuScene.ts` ~1257). FORCES is rolled first and sets NAVAL, then NAVAL is rolled independently across 0–3, so FORCES=NAVAL with NAVAL=0.00 is a likely result.
    *Fix:* skip NAVAL in the roll (FORCES derives it), or roll it in a range that depends on FORCES.
19. 🔎 **BACK can undo manual edits** (`menuScene.ts` ~1246). The history only snapshots before each RANDOMIZE. Randomize → tweak params → BACK silently drops the tweaks. The history is also unbounded.
    *Fix:* clear the history in `adjustCustomParam` (or snapshot there too).
20. 🔎 **LAND may never roll its top value.** `randomizeParam` finds distinct values by comparing displayed strings. LAND steps by 0.025 with no rounding but shows 2 decimals, so 0.175 ("0.18") collides with the clamped 0.18 and the scan stops early.
    *Fix:* round LAND the way SETTLEMENT and ROADS are.
21. 🔎 **NAVAL's description overstates.** "0 is no boats", but civilian moored boats still spawn with WATER SITES on. → "0 is no patrol boats".
22. 🔎 **Fragile declaration order** (`menuScene.ts`). `syncCustomParams` (~1186) reads `randomHistory`, which is declared later (~1243). It's safe today because the first call comes after it, but moving the declaration up removes the trap.
23. 🔎 **Maverick launch pitch** (`weapons.ts` ~636). Pitch `-0.08` rad means it descends for the 0.28 s before guidance kicks in. From a very low hover it could clip rising terrain. Play-test it.
24. 🔎 **Two definitions of "not an enemy."** `fieldBars.ts:56` and `help.ts:24` use `isNeutral(u.kind)`, while targeting uses `hostileUnit(u)`. Use one everywhere.
25. 🔎 **Stale camera comment** (`camera.ts` ~504). "Far banks: largest and faintest", but that cloud layer's max scale is now 1.1, below the middle layer's 1.15.

---

## 4. Design and scalability

### 4.1 Kind-string branching that belongs in specs (highest long-term cost)
- **Death effects.** `destruction.ts:150–258` checks `deathFx` in about 10 places: barrel, burst type, dust multiplier, short circuit, smoke count, shake, splash radius and damage (magic `90`), debris count, throw and scale. A new effect touches all of them.
  → One `DEATH_FX: Record<DeathFx | "he", { fireball, smokeN, shake, debrisN, throwMul, debrisScale, dustMul, splashRMul, splashDmg?, barrel?, extra?(s, u) }>` table.
- **Wreck routing.** `destruction.ts:325` `behavior === "patrol_boat" || (water && !building)`, plus behaviour strings for heli crashes.
  → `wreck: "sink" | "airCrash" | "surface" | "ground"` on `UnitSpec`.
- **The `water` flag** (see bug 5).
  → Explicit `sinks`, `obstacle: false` and `surfaceWreck` fields.
- **Small kind checks:**
  - `minimap.ts:65` `kind === "pylon"` → `mapDot?: number`
  - `powerLines.ts:114` `kind === "pylon"` → `wireReach?: number`
  - `structureArt.ts:79` runway/pier/dam/bridge_steel aspect chain → `stubAspect` on `StructureArtSpec`
  - `unitSprites.ts:315` shadow-height ternary → `shadowFrac` with per-category defaults
- **Settlement rules** are spread over the count formulas (`settlements.ts:138–144`), the power `needs` filter, the road skip list (`world.ts`) and `isGroundPrint`.
  → A `SETTLEMENT_SPECS` record (`place`, `count(density)`, `wet`, `road`, `power`) and a print layer per structure.
- **Decor classification by name:** `generateWorld` uses `d.kind.startsWith("tree_")`.
  → A `DecorKind → class` record.
- **Randomize ordering:** `randomizeCustom` sorts on `label === "FORCES"`.
  → An explicit `rollFirst` / `derives: ["NAVAL"]` on the param (this also fixes bug 18).
- **Menu buttons:** CUSTOMIZE, RANDOMIZE and BACK repeat the same pill-button style and hover tweens.
  → A local `pillButton(x, y, label, onDown)` helper.

### 4.2 Lists that must be edited together
**Adding a structure unit** means editing:
1. `UnitKind` (`sim/roster.ts`)
2. `StructureKind` and `UNIT_STRUCTURES` (`settlements.ts`)
3. `UNIT_SPECS` entry (`civ(...)`)
4. `STRUCTURE_ART`, plus a stub case and aspect
5. the art files
6. the placement code
7. `HULK_BREAK_SOURCES` (hard-coded in `artGen.ts`, so the rig doesn't read from source)
8. any kind special cases

→ Derive `UNIT_STRUCTURES` from specs that have structure art. Define `StructureKind = UnitStructureKind | PaintedKind`. Derive `HULK_BREAK_SOURCES` from `UNIT_SPECS` where `breakApart` is set.

**Adding a landform** means editing the union, `NO_LANDFORMS`, `LANDFORM_KINDS`, the loop in `applyLandforms`, the defaults, and **every mission literal** (11 places).
→ Make `landforms: Partial<Landforms>` and normalise it in world generation (the catalog can't spread `NO_LANDFORMS` at runtime).

**Adding a shape or mission** means editing the union, the list and the switch.
→ Derive the unions from `as const` lists.

Themes are fine: the `Record` gives exhaustiveness.

### 4.3 State you have to opt out of
- **`fx.smokeMatchFire`.** `pair`/`pairHurt` set it (`fx.ts:1449/1485`), and it stays set until the next `at`/`atWorld` call clears it. Three callers already reset it by hand (`destruction.ts` ×2, `trails.ts`). Any unrelated emit after a `pair()` inherits the setting.
  → Opt in per call, as a scoped helper like `withDmgFlameScale` or a parameter.
  ❌ *Dropped:* "missile impact smoke unintentionally 1.12×". That call is a `pair()`, where matching is intended.
- **`fireMeanScale`** hard-codes emitter mean sizes that duplicate `emitters.ts`.
  → Record the mean scale where each emitter is created.
- **`DEBRIS_LOFT`** is applied silently inside `admitDebris`, so every caller's `vz` is really "pre-loft".
  → Fold it into the constants or into gravity.
- **Power-line node matching** compares exact floats between settlement parts and spawned units (`powerLines.ts:62`). Any snap drops the wires silently.
  → Have `makeSettlementUnits` return the part→unit map.

### 4.4 Duplication
- **Maths helpers:** `smooth`, `smooth01`, `clamp`, `lerp` and an inline smoothstep live in shape, landforms, world and brushes.
  → `worldgen/math.ts` (or `util/`).
- **Cone and radial gullies:** repeated in the `summit` and `volcano` shapes and the volcano landform.
  → A shared helper.
- **Placement loops:** the six `placeX` functions repeat "N tries → score → keep best".
  → A `bestSite(tries, sample, score)` helper. `clear` is also defined twice in `settlements.ts`.
- **Blood streaks:** the block is duplicated in `destruction.ts` (pre-existing).
  → `stampBloodStreaks(u)`.
- **Wreck stamping:** `stampWreck(...)` is followed by `addThermalWreckMark(..., "hulk")` in 3 places.
  → Let `stampWreck`'s `thermal` parameter take a `ThermalWreckKind | false`.
- **Colour interpolation:** `lerpRgb` (`groundMarks.ts`) duplicates `Phaser.Display.Color.Interpolate`.

### 4.5 Layering and ownership
- **World generation isn't headless any more.** It imports `roadArt` and `structureArt` and uses `document` (`paintSettlementsOntoCanvas`, `halveTo`), extending the existing `artGen` dependency.
  → Move canvas painting to `art/` or `render/`.
- **Shock post-FX ownership.** It's driven from `statusHud`, but camera post-FX belongs to `postFx`/camera, and the debug `PostFxTest` module is now gameplay-critical.
  → Move ownership to the camera/postFx domain.
- **Wire depth.** All power-line wires share one depth (the mean z of visible spans), so they sort wrongly against nearby units.
  → One graphics object (or depth) per line.
- **Hulk heat eviction.** Hulk thermal marks (22–36 s) share the 384-mark cap with casings, so heavy gunfire evicts hulk heat early.
  → A separate cap.

### 4.6 Per-frame work (deprioritised; see §2)
These are fine at the measured idle numbers. Revisit if a combat capture shows GC spikes.
- `worldToScreen` without a scratch `out`: roofs (`unitSprites.ts:283`), floating wrecks, flare heads (`countermeasures.ts:914/922`).
- Flare trail history: `push({x,y,z})` plus `shift()` every 35 ms per flare.
  → A ring buffer.
- Power-line wires: `wirePoint` re-reads specs and heights about 36× per span per frame.
  → Precompute endpoints in `create()`.
- `SLOTS` 9→10 for every unit, including hundreds of static houses and pylons.
- Shorts and `electricShort` schedule 20+ closures whether or not the camera can see them.
- The `onScreen` endpoint test culls long spans whose middle crosses the view (a visual bug, not a performance one).

### 4.7 Load-time / world generation cost
- **Delta `at()` per texel:** branch bounding boxes cover almost the whole map, so most texels evaluate 100–200 segments, plus `smin` and two `fbm` calls, over 3.24M texels. That's the 5–7 s generation time.
  → Rasterise the channel signed distance once on a coarse grid (~450²) and sample it bilinearly, or bucket segments.
- **Volcano** `rimAt()` runs twice per `at()` call, and `relief()` recomputes `hypot`, `atan2` and the rim.
  → Cache them.
- **Shards** lumps ignore `detail`, so menu previews pay full noise octaves.
- **`breakApart`** runs 4 noise closures per pixel. The edges depend only on the cross-axis coordinate, so they can be precomputed per column (negligible at current sizes).

### 4.8 Docs and assets
- **TODO.md is stale:**
  - "Hulk break-apart effect" is still `[ ]` (done: `art/hulkBreak.ts`).
  - "Power lines… break/fall, lots of sparks" is still `[ ]` (mostly done; falling poles not yet).
  - The water-splash sink item looks done too.
- **AGENTS.md "where things go"** is missing rows for wreck break-apart (`art/hulkBreak.ts`), road art (`art/roadArt.ts`) and `render/shockFx.ts`. The rows that were added (lineOfSight, world/powerLines, settlements, neutral units) are accurate.
- **Orphan assets:** the 11 `public/artwork/crafts/*-cinematic-v2/v3.png` files (~2.5 MB each, ~27 MB total) aren't referenced anywhere in `src/`, but Vite copies them into every build. These weren't made this session, so you'll know whether they're planned. If not, move them out of `public/`.
- **Structure sprites:** all 38, plus the 2 road tiles, are referenced, and no referenced path is missing. They total about 9 MB. The largest hulks (`warehouse_hulk` 427 KB, `sea_platform_hulk` 408 KB) are worth running through a PNG optimiser.

### 4.9 Small cleanups
- **Magic numbers:**
  - power-station hookup offset `x - 18`
  - `PIER_LEN = 30` (derive it from `UNIT_SPECS.pier.box`)
  - search radii 24, 30, 62
  - decor clear radius `max(w,l)*0.6 + 6` (a runway becomes a large keep-clear disc)
- **Wrong comment:** the MILITARY preset comment says "hardened toughness", but it only flips `neutral`/`deathFx`.
- **`civ()` call sites:** five positional numbers are hard to read.
  → An options object.
- **Art rig state:** `hulkBreakRigParams.source` writes a string into a numeric params record via a double cast.
  → Keep the rig selection in its own state.
- **Paved roads and steel bridges** are inactive by design: `Road.paved` is never set, and the `bridge_steel` bake, shadows and branch are unreachable for now.

---

## 5. What's solid
- **Neutral filtering:** `hostileUnit` is applied consistently across auto-pick, lock-on, tesla and remote AI. `isNeutral` gates AI, health bars and help.
- **Spec-driven structure options:** `roof`, `breakApart`, `wreckJitter` and `deathFx` are spec fields, not kind checks (their *handling* still needs §4.1).
- **Line of sight:** budgeted, staggered, no per-trace allocation, and skipped beyond reach.
- **Road and decor placement:** `RoadGrid` A* reuses buffers via a stamp counter and simplifies paths with Douglas–Peucker before Chaikin smoothing. `DecorSpacing` uses a spatial hash.
- **Rigs read from source:** `paintTerrainPreview` and the terrain rig reuse the real generation code, not copies.
- **Cleanup:** new modules reset in `init()`, and the shock pipeline is removed on SHUTDOWN.
- **Pure render maths:** `flameSizeCap` and `flameDensityMul` live in `render/fxCurves`.

---

## 6. Suggested order
1. **One-line bugs:**
   - LOS reach (1)
   - floating wrecks in map view (2)
   - inferno pulse falloff (6)
   - port rounding (7)
   - stub default (9)
   - double jolt (12)
   - road border cells (11)
   - LAND rounding (20)
   - NAVAL wording (21)
   - camera comment (25)
2. **Larger bugs:**
   - prints vs `occupied` (4)
   - road sea-crossing cap (8)
   - decide on the hulk double-darkening (10)
   - RANDOMIZE vs NAVAL (18)
   - BACK vs manual edits (19)
3. **Docs:** update TODO.md and AGENTS.md (§4.8), and decide on the orphan cinematic art.
4. **Spec refactors:** split `water` into explicit fields (fixes 5), add the `DEATH_FX` table, add `wreck` routing.
5. **Lockstep lists:** derive the type lists, make `landforms` partial, derive `HULK_BREAK_SOURCES` from specs.
6. **Opt-in state:** opt-in `smokeMatchFire`, the power-line node map, and `DEBRIS_LOFT` folded in.
7. **Load time:** precompute the delta channel field.
8. **Combat capture:** take one, then decide on §4.6.
9. **Remaining cleanups:** §4.4, §4.5, §4.9.
