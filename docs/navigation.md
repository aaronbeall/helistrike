# Ground & water navigation

How enemy ground units, boats and autonomous ground remotes decide where to go and get there: around water, cliffs, the map edge and over bridges.

Code: `src/sim/navGrid.ts` (grid + search, headless), `src/scenes/mission/world/nav.ts` (per-mission module `s.nav`), callers in `enemy/unitSim.ts` and `remote/ai.ts`, debug overlay `debug/navOverlay.ts` (debug menu → "Nav grid + routes").

---

## Concept

### Two layers of movement

| Layer | Question it answers | Who owns it |
|---|---|---|
| **Navigation** (this doc) | *Which way should I head to reach my target?* | `s.nav` |
| **Local steering** | *How do I not bump into the unit / building right next to me?* | `unitSim.steerGround` / `separateGround`, remote obstacle probes |

Callers decide **what** they want (orbit point, flee, patrol waypoint, follow the host). Navigation turns that into **a point to steer at right now**. Local steering then bends that point around nearby solids, and the hull's own drive model (tank, car, boat, remote craft) moves.

### The map as a board

At mission start the map is cut into square cells. Each cell is marked:

- **dry**: drive freely
- **shallow**: drivable for every ground unit, but routes prefer to avoid it (splash + wake when crossed)
- **blocked**: deep water, or the map rim
- **water**: navigable for boats (separate layer)

Between neighbouring cells, a **crossing** can be **closed** when the ground there is too steep (a cliff), in either direction. Bridge decks are drivable cells laid over the water until the deck is destroyed.

Cells that can reach each other form a **region** (one per island / landmass, one per water body). A unit only ever aims inside its own region: a target across a lake it can't get around is swapped for the nearest reachable cell.

### How a unit heads to a target

1. **Go straight if you can.** A few times a second the unit checks whether a straight drive to the target crosses only open cells and crossings. Almost always it does, and it just drives there.
2. **Otherwise follow a route.** A shortest path around the obstacle is computed on the grid, avoiding shallows and cliff edges where reasonable, and followed corner to corner. Routes are reused for a few seconds; the unit skips ahead whenever it can already see a later corner, so it cuts corners instead of zig-zagging.
3. **Keep off edges.** Next to a shore, cliff lip or the map rim, the steer point is nudged toward open ground.

### Fleeing

Instead of a point straight away from the threat (often in the sea or off the map), a fleeing unit picks the most open reachable point roughly away from the threat and commits to it for a couple of seconds.

### Terrain ability (per hull)

Every ground hull has one terrain profile (spec `terrain`; omitted = default):

| Field | Meaning | Who |
|---|---|---|
| `climb` | `default`: blocked by cliffs (grade > 0.9) · `medium`: up to grade 1.8 · `max`: any slope | max: Hound, Wolf · medium: Humvee, tank, LAV, LAV-AA, SAM |
| `slopeSlow` | how much climbing slows it: 1 = default (down to 40% speed at grade 0.9+), 0 = never | Motorcycle 0.25 |
| `underwater` | drives along the bed under deep water; can't fire while submerged; tinted toward the water colour by depth | Hound, Wolf |
| `underwaterSpeed` / `shallowSpeed` | speed kept submerged (default 0.5) / wading shallows (default 0.8) | all ground hulls wade at 0.8 |

Hulls also squash slightly on slopes (shorter climbing, longer descending, narrower on a side slope).

### Getting unstuck (one rule for every ground hull)

If an agent that's trying to move makes no progress (or is pressed into a solid) for about a second, it **recovers** for about a second: navigation points it at the most open nearby cell, preferring cells behind it. How it gets there depends only on the hull:

- **wheeled** (needs rolling speed to turn): backs out, steering so the rear swings toward that cell
- **zero-point turn** (tracks, infantry, Hound/Wolf): rotates to face it and drives off

Then it plans again.

---

## Technical implementation

### The grid (`NavGrid`, `sim/navGrid.ts`)

Built once per mission in `Nav.build()` (after `spawnUnits`, so bridge decks exist). ~15 ms, ~1.5 MB.

| Constant | Value | Meaning |
|---|---|---|
| `NAV_CELL` | 28 world units | cell size |
| `NAV_N` | 200 | cells per side (`WORLD / NAV_CELL`) |
| `RIM_CELLS` | 2 | outermost cells blocked on both layers |

Per-cell arrays (all `NAV_N²`, typed arrays):

| Array | Contents |
|---|---|
| `land` / `landBase` | `LAND_DRY`, `LAND_SHALLOW`, `LAND_BLOCKED`; `land` = base with live decks forced dry |
| `water` | 1 = boat-navigable |
| `grades` | bed grade of each crossing to the 4 forward neighbours (the other 4 read the neighbour's); `steep` = steepest crossing per cell |
| per **mode** (lazy) | connected-region id (−1 = blocked) and clearance: cells to the nearest blocked cell (cells with a crossing too steep for the mode count as 1), capped at 6 |
| `decks` | unit indices of every deck touching this cell (segments overlap at seams); `hasDeck` / `decksAt` |

**Classification** samples at the cell centre: wet + deep (`isDeepWater`) → blocked, wet → shallow, else dry. For boats a cell is water if the centre **or any of four quarter points** is wet, so narrow rivers stay connected.

**Crossing grades**: for each crossing, the bed height (`bedZ`) at both centres and the midpoint; the steeper half's grade (Δz / distance) is stored. Checking halves keeps a narrow drop from being averaged away.

**Modes** (`NavMode`, interned by `navMode(layer, maxGrade)`): what a route is for. `layer` picks passable cells (`land`: not blocked · `seabed`: land + deep water · `water`: boats) and `maxGrade` closes crossings steeper than the hull may climb, the same limit the step rule enforces, so routes and movement agree. `Nav.modeOf(agent)` derives it from the hull's terrain profile; `LAND_MODE` (default hull) and `WATER_MODE` are the common ones. Regions + clearance are built per mode on first use.

**Regions**: 4-neighbour flood fill over passable cells through open crossings. **Clearance**: multi-source BFS from blocked cells. Every ground mode's are rebuilt (`rebuildLand`, ~1–2 ms each) whenever a deck is destroyed; `version` bumps.

**Crossing open** (`open`): water is always open; ground is open when its grade ≤ the mode's `maxGrade`, and a crossing touching a deck cell is always open (bridges span ravines).

### Queries

- `lineClear(layer, x0, y0, x1, y1)`: walks the segment in half-cell steps; every new cell must be passable and the crossing into it open.
- `nearestInRegion(layer, region, c, maxR)`: ring search outward, prefers the highest-clearance cell in the first ring that has one.
- `findPath(layer, from, to, out, maxExpand = 1600)`: A*, 8-neighbour, octile heuristic. Step cost 1 / √2, ×2.5 into shallow (`SHALLOW_COST`), ×1.6 into clearance ≤ 1. Diagonals need both side cells passable (no corner cutting). Reuses typed buffers with a search stamp (no clearing, no per-search allocation beyond heap growth). When capped, returns the path to the cell closest to the goal. ~0.26 ms worst case.

### The module (`Nav`, `world/nav.ts`)

Anything routable is a `NavAgent` (`{ x, y, angle, route? }`): enemy `Unit`s and `RemoteCraft`. Per-agent state lives in `agent.route` (`UnitNav`): the path, follow index, goal cell, timers, direct-line result, stuck sampler, flee commitment.

#### `route(agent, tx, ty, layer, dt)` → steer point

1. Mark the agent as routed this frame.
2. Agent's region; if the target's cell is in another region, swap it for `nearestInRegion` (≤ `CLAMP_CELLS` 10), else for `nearestAlong`: the first reachable cell walking from the target back toward the agent (the reachable end of the approach; never empty, the agent's own cell is reachable).
3. Track stuck, skipping no-progress time while within `ARRIVE_DIST` (1.5 cells) of that target: slowing down to arrive isn't a jam. Recovering → return the unstick cell.
4. Every `CHECK_EVERY` (0.3 s, ±20% jitter so agents don't sync) re-test `lineClear` to the target. Clear → drop any path, return the target.
5. Otherwise (re)compute the path when there is none, it's older than `REPATH_EVERY` (2.5 s ± 20%), or the goal moved more than `GOAL_DRIFT` (4) cells, and only while this frame's budget lasts (`SEARCH_BUDGET` 2 A* per frame, reset in `beginFrame()` from `unitSim.updateUnits`). Over budget → keep the old path or steer direct this frame.
6. Advance the follow index past the agent's own cell and, on line-check frames, past the next corner if it's already visible. Return the current corner's centre (or the target when the corner is the goal).

#### `fleePoint(agent, fx, fy, layer, dt)`

Nine candidates `FLEE_DIST` (320) out, spread ±`FLEE_SPREAD` (1.9 rad) around straight-away. Only cells in the agent's region; score = clearance × 40 + alignment with straight-away × 120 + distance from threat × 0.15. Held `FLEE_HOLD` (2.2 s) unless the threat swings between the agent and the point.

#### `repel(agent, wx, wy, layer)`

If the agent's cell has clearance ≤ `REPEL_CLEAR` (1), push the steer point `REPEL_PUSH` (60) along the clearance gradient (central differences of the four neighbours). One array read in the common case; this replaced the per-frame terrain probes and is why unit sim got faster.

#### Stuck detection and recovery

Runs inside `route()` for every routed agent. `stuck(agent)` is only true while the agent is being routed (this frame or the last), so a recovery never lingers on an agent that stopped driving.

- Every `STUCK_SAMPLE` (0.25 s): moved less than `STUCK_SPEED` (8 u/s) × elapsed → add to `stuckAcc`, else decay it.
- `noteJam(agent, dt)` adds to `stuckAcc` directly; drivers call it when the hull is pressed into a solid (`groundUnitBlocked` for enemies, collision penetration for remotes).
- `stuckAcc ≥ STUCK_AFTER` (0.8 s) → `stuckT = STUCK_FOR` (1.1 s), flee commitment dropped. While `stuck(agent)`, `route` returns the unstick cell: the most open passable cell within 2 cells, biased toward the agent's rear. When recovery ends the path is cleared so it replans.

Drivers only choose the manoeuvre:

| Driver | Wheeled | Zero-point turn |
|---|---|---|
| Enemy vehicle (`driveGroundVehicle`) | reverse up to `BACKUP_SPEED` (0.45 × max speed), body steered toward `want + π`, yaw rate scaled by speed | pivot toward the unstick cell + small push |
| Remote (`backOut` in `remote/ai.ts`) | throttle −1, stick steer inverted (car steering flips in reverse) so the rear swings toward the cell | normal drive toward the cell (hull yaws in place) |
| Infantry | n/a | walk toward the cell |

Wheeled vs zero-point turn is one predicate for every hull, `turnsInPlace(agent)` (`sim/navigation`): enemy ground vehicles turn in place only on treads (infantry always); remotes unless their hull has `vehicleSteering`.

#### Bridge decks

Decks are declared: `deck: true` on the bridge, steel bridge and pier specs (`catalog/settlementUnits.ts`). At build, each deck's padded footprint is sampled every 2 units, edges included, into cells (`setDeck`), marking them dry and adding the deck's unit index to each cell's list. Movement:

- `onDeck(x, y)` (`deckAt`: exact footprint test against every deck in the cell; the highest top where segments overlap) is passed to the ground-step rule: deck points are walkable over deep water, and grade checks are skipped on and off a deck.
- `surfaceZ(x, y)`: deck top (`deck.z + height`) on a deck, else the bed. Ground units and ground remotes stand at this height (wading shallows on the bed).
- `onUnitDead` (from `destruction.destroyUnit`): `clearDeck` drops the deck from its cells and restores those no other deck covers, and rebuilds land regions + clearance, so a destroyed bridge cuts its banks apart for routing.
- Riders go down with the deck (`Destruction.deckRiders`, collected while it still stands): ground units and ground remotes on it that can't be in deep water die with the same kill credit, like crew with their host; underwater hulls just drop to the bed.
- Where a unit dies decides its wreck, whatever killed it (`Destruction.placeHullWreck`): on a live deck it stays on the deck, in deep water it sinks (`sinkHull`, boats included), in shallows it splashes (boats float a surface wreck), on land it's stamped.

Boats use the water layer, where deck cells are unaffected: they pass under bridges.

Bridges come from roads: any water stretch of a road becomes a chain of deck segments (`placeBridges`): exactly one segment length apart, centred on the crossing (the ends run onto the banks); water stretches less than a segment of land apart become one straight span. Spur roads run to satellite sites listed in `ROAD_SPUR_SITES` (lookouts, AA towers, base heli pads), each with how much water its spur may bridge, ending at the site's edge, so an offshore base pad gets an access bridge from the shore when it's close enough.

At world gen, each bridge starts with 0–max(3, sections / 3) ground units on random deck sections, one per section, facing along the span (`bridgeSpawns` in `worldgen/world.ts`): kinds already in the mission's forces that fit the deck width, from their own RNG stream so the rest of the map is unchanged per seed.

### Who calls it

| Caller | Target | Layer |
|---|---|---|
| Enemy ground vehicles (`orbit_attack_vehicle`, `flee_vehicle`) | orbit ring point around the player, or `fleePoint` | land |
| Enemy infantry kiting / fleeing | kite ring point, or `fleePoint` | land |
| Boats (`patrol_boat`) | waypoint from `pickWaterWaypoint` (random open cell in the boat's own water body, 180–700 out); with spec `boatReact`, on sight of its focus it pursues (the focus, clamped into its water) or retreats (`fleePoint`), sprinting; hurt → retreat | water |
| Ground remote, reticle autopilot (`tickGroundGunAi`) | orbit point around its target, or the ring around the reticle | land |
| Ground remote, escort (`driveGroundEscort` caller) | attack orbit point, or follow point behind the host | land |

Remote moves that are only a heading (backing off / strafing a target) route toward a point `ROUTE_AHEAD` (120) along it, so every driving ground remote is routed and feeds jam detection. Steering output always goes through `repel` (and, for enemy units, `steerGround`'s solid avoidance + `mapEdgeSteer`). Not routed: aircraft, statics, pinned crew, neutral (civilian) units, and remotes under manual control.

### One ground-step rule

`groundStepOk(world, x0, y0, x1, y1, onDeck, hull)` (`sim/navigation`) decides every ground move, enemy or remote, AI or player-driven, with the hull's resolved terrain profile (`groundHull(agent)`, one shared object per spec): onto a deck → yes; into deep water → only underwater hulls; off a deck → yes; else the grade must be under the hull's climb grade. Climbing slows by the hull's `slopeSlow`. `stepOnTerrain` applies it (sliding on one axis when the full step is refused, slowing on climbs) for enemy units; remotes, whose position comes from their craft physics, replay that move through it with `settleGroundMove`. The grid's passability and closed crossings are built from the same thresholds, so routes and movement agree.

### Water handling around it

- Every ground hull wades shallows and is blocked only by deep water (the step rule above).
- Wading (`fx/ripples.wade`): every moving ground unit / ground remote in water makes splash spray + ring ripples; vehicles also leave a boat-style V wake (aircraft excluded from the wake).
- A ground hull (vehicle, infantry, ground remote; never a boat or structure) that ends up in deep water anyway (dropped in, knocked in) and isn't underwater-capable drowns (`Nav.drowns`): enemy units die through `destroyUnit` (the hulk sinks), remotes are destroyed. A boat aground steers toward the nearest water cell (`escapePoint`).

### Remotes on the ground

Every ground remote, piloted or AI, collides with buildings, statics, vehicles and other remotes (`resolveGroundRemote` inside `driveRemoteCraft`; pressing into one feeds jam detection), and autopilots look ahead and turn away from them (`RemoteAi.avoidSolids`). Submerged remotes can't fire, trail bubbles, and are invisible to everything without `sonar` (boats see them and answer with torpedoes). Autopilot status (`FOLLOWING`, `ATTACKING`, `HOLDING`, `AVOIDING`, `STUCK`, `RETURNING`) shows as a blue diamond line under the reticle (mouse-following remotes) or the host craft (`hud/remoteStatusHud`).

### Waypoint command (G)

While piloting an escort-capable remote (Hound, Wolf: `hostEscort`), G sends the **host craft** to the mouse point (`RemoteFleet.placeWaypoint`): it flies there with `hostApproach` (the same yaw-then-thrust catch-up FOLLOW uses) and switches to HOLD on arrival; C cancels it. Hint: escort chip `· G WAYPOINT`; marker: `hud/waypointHud`.

### Debug & measurement

- **Overlay** (debug menu → "Nav grid + routes"): red blocked (fainter = deep water), cyan shallow, yellow deck, faint white low clearance, ticks = too-steep crossings (orange: blocks default hulls, red: blocks medium climbers too), green = live routes (red while recovering), pink = flee targets. HUD: grid size + version, region counts, routes / stuck counts, A* per frame.
- **Test map** `?test=coast_nav`: Coastal Strike with generated forces + 100 ground units near the spawn.
- **Bench** `npm run bench -- idle_coast` (plus `idle_cluster`, `idle_stress` for regressions).

Measured (3-run medians vs. the pre-nav code): unit sim −9% on `idle_cluster`, −5% on `idle_stress`; nav itself ≈ 0.02 ms/frame for ~45 movers on `coast_nav`, worst A* frame ≈ 0.5 ms. Share of driving units making no progress over 2 s on `coast_nav`: 35% → 20–28%; units stuck most of a 30 s run: 13 → 4–8.

---

## Known issues / next steps

1. **Overlapping edge handling**: blocked rim cells, `mapEdgeSteer` (inside `steerGround`) and `containOnMap` all keep units off the map edge; `mapEdgeSteer` is probably redundant now.
2. **Not built**: shared chase / flee fields, per-unit-class slope limits, road preference, land patrol routes.
