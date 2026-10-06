# HeliStrike — agent guide

Shared instructions for AI coding agents (Codex, Cursor, Claude Code, …). For what the game *is*, read `README.md`.

## Commands

```bash
npm run dev               # Vite dev server
npx tsc --noEmit -p .     # type check (run after every change; must be clean)
npm run build             # tsc + production build
npm run bench             # perf scenarios in Chrome via Playwright, real input (--compare <json>, --profile, --runs N, --record "<label>")
npm run bench:history     # perf trend per scenario from docs/perf-history.csv; see docs/perf-plan-2026-10.md
npm run spatial:check     # headless fuzz of the spatial grid vs brute force
```

There is no test suite. Verify with the type check + build, then a short in-game play-test of whatever you touched.

## Architecture

TypeScript + Phaser 3. The mission (the actual gameplay) is a Phaser scene composed of domain modules.

### Layers

Imports only flow **down** this list. A lower layer never imports a higher one at runtime (`import type` is fine).

| Layer | Owns | Rules |
|---|---|---|
| `src/catalog/` | Pure data: crafts, weapons (+ presets), units, enemy weapons, remotes, countermeasures, missions, tips | Data only. Type-only imports from `sim/`. |
| `src/sim/` | Game rules + model: `Craft` flight model, spec lookups, combat types, ballistics, navigation, targeting rules, unit factory, physics | No mission instance, no scene state. Pure functions with explicit inputs (`world`, specs, units…). Runs headless. |
| `src/worldgen/` | World generation, height/biome data, the 2.5D projection (`worldToScreen`, `Camera25D`) | |
| `src/art/` | Sprite processing, baking, sprite origin / mount / muzzle metadata | |
| `src/render/` | Shaders + pipelines, depth layers, thermal tint, camo, FX scaling, stateless drawing maths (`spritePose`, `ribbons`, `fxCurves`) | Stateless; no scene state. |
| `src/util/` | Generic helpers (`rng`, `vec`), `storage` (swappable async key/value backend: IndexedDB by default, localStorage / memory fallbacks), `format` | |
| `src/persist/` | Player persistence on top of `util/storage` (mission history, lifetime stats, tip show counts; later settings / unlocks) | `loadPersistence()` once at boot; reads are then sync from memory, writes save in the background at explicit commit points. |
| `src/ui/` | UI shared across scenes (Field Manual, menu chrome) | |
| `src/scenes/mission/` | The live mission's subsystems (see below) | May use everything above. |
| `src/scenes/missionScene.ts` | Wiring only | See below. |

### The mission scene (`src/scenes/missionScene.ts`)

The scene is **wiring**, not implementation. It holds:

- **Lifecycle:** `init()` calls each module's `reset()`; `create()` is an ordered list of phase methods (`createAssets`, `createWorld`, `createPlayer`, … `createHud`, `initCamera`); `update()` runs the frame pipeline (`stage(...)` blocks, timed when the perf overlay is on).
- **Shared world state:** `world`, `player`, `units`, `shots`, `remotes`, `debris`, `loadout`, `over`.
- **HUD/camera binding infrastructure:** `setupHudCam`, `bindHud`, `bindWorld`, `markHudTree`, `hudLocal`, `setHudVisible`, `uiOverlayOpen`.
- **Input bindings** that dispatch into modules, time scale, and `drawHud()` (which only calls HUD modules).
- **One field per subsystem**, grouped by domain at the top of the class.

New gameplay/rendering logic does **not** go in the scene; it goes in the owning module.

### Subsystem modules (`src/scenes/mission/<domain>/`)

```
enemy/        targeting · unitSim · unitLod · enemyFire · lineOfSight
remote/       fleet · ai · body
weapons/      fireControl · projectiles · lockOn · countermeasures · tesla · refractor · callStrike
fx/           fx · trails · groundMarks · ripples · emitters (function: createFxEmitters)
destruction/  destruction
render/       hostCraft · unitSprites · thermalMode
world/        powerLines · spatial
camera/       camera
flow/         missionFlow · missionStats
hud/          weaponHud · statusHud · threatHud · reticleHud · minimap · cornerHud · runStatsHud · prompts · help · fieldBars
debug/        menu · overlays · relief · sideView · perf · postFx · spatialOverlay
```

Each module file starts its class with a one-line doc comment saying what it owns — read that first.

**Module pattern:**

```ts
/** Remote fleet: launch from the bay, piloting + POV view, dock approach/capture + stow, … */
export class RemoteFleet {
  remoteView = false;              // state the module owns
  constructor(readonly s: MissionScene) {}
  reset(): void { … }              // per-mission state reset, called from the scene's init()
  // methods: implementation for this domain
}
// scene: `remoteFleet = new RemoteFleet(this);`
```

- Reach other state through the scene: `this.s.player`, `this.s.units`, `this.s.weaponHud.draw()`.
- A module owns its fields; other modules read/call through it (`this.s.countermeasures.cloakT`).
- Drawing for a domain is owned by one module; others call its methods instead of drawing on its graphics objects (e.g. all aim drawing goes through `reticleHud`, whose graphics are `private`).

### Class vs. function

- **Class (subsystem module)** only when the code owns per-mission state or Phaser objects.
- **Plain exported function** for anything stateless:
  - game rule → `src/sim/…`
  - drawing maths / sprite pose → `src/render/…`
  - generic maths → `src/util/…`
  - used by one module only → file-level function in that module's file
- Stateless functions take what they read explicitly (`world: WorldData`, `textures`, `time`) instead of the scene.

### Where things go (quick guide)

| Change | Put it in |
|---|---|
| New weapon / craft / unit / remote / countermeasure stats | `src/catalog/…` |
| Weapon behaviour while firing | `weapons/fireControl` (trigger, muzzles) or `weapons/projectiles` (flight, impact, blast) |
| A new special weapon with its own state | new `weapons/<name>.ts` module |
| Enemy movement / AI | `enemy/unitSim` (+ pure steering in `sim/navigation`) |
| Who enemies target | `enemy/targeting` (+ rules in `sim/targetRules`) |
| Enemy line of sight (terrain occlusion) | `enemy/lineOfSight` |
| Remote launch/dock/pilot | `remote/fleet`; autonomous behaviour `remote/ai`; visuals + guns `remote/body` |
| Particles / impacts / muzzle flash | `fx/fx` (emitter configs in `fx/emitters`) |
| Trails / ribbons | `fx/trails` |
| Craters, scorch, wreck stamps | `fx/groundMarks` |
| Power line wires (draw, shorting, rotor strikes) | `world/powerLines` |
| Units near a point (any many-to-many scan) | `s.spatial.near(x, y, r, mask)` from `world/spatial` (grid: `sim/spatialGrid`); call `.done()` after the loop; never loop all of `s.units` per shot / unit |
| Water ripples (splashes, wakes) | `fx/ripples` (`s.ripples.spawn` / `.splash`) |
| Deaths, crashes, debris | `destruction/destruction` |
| HUD element | the matching `hud/…` module, or a new one |
| Player stats | record in `flow/missionStats` (`s.stats.*`); fact tables + `query`/`total` rollups in `sim/stats` (add a dim or measure there, never a new fixed bucket); saved by `persist/statsStore` at mission end as a history record (one key per mission) + lifetime totals rebuilt from the history when out of step |
| Debug tool / overlay | `debug/…` |
| Dev test map (`?test=<id>`, main-menu `/` panel) | `src/catalog/testMaps.ts` (URL launch: `scenes/devLaunch.ts`) |
| Perf scenario (input script + timing) | `scripts/bench-scenarios.mjs` (runner: `scripts/bench.mjs`; reads the dev-only `window.__heli` handle) |
| Small vector icons (UI pills, HUD gauges) | `render/icons` (`drawIcon(g, name, …)`, `IconName`; triangles only, safe per frame) |
| Debug text overlay | `ui/domText` (DOM, not Phaser `Text`: no canvas raster / texture upload) |
| Dev rig (overlay tool, cycled with `` ` ``) | `src/rigs/…`, registered in `rigs.ts` |
| Map silhouette / domain warp | `src/worldgen/shape.ts` |
| Terrain palette, tiles, decor per theme | `src/worldgen/theme.ts` |
| Landform stamps (mesas, craters, volcanoes, dunes) | `src/worldgen/landforms.ts` |
| Towns (+ street grid), ports, airfields, dams, farms, oil fields, power lines, bridges | `src/worldgen/settlements.ts` (art: `src/art/structureArt.ts`; buildings in `UNIT_STRUCTURES` spawn as neutral units, the rest are printed into the terrain) |
| Neutral (civilian) units | `neutral: true` on the `UnitSpec`; player-side auto-picks filter with `hostileUnit` (`sim/targetRules`) |

## Gotchas (learned the hard way)

- **No untyped access to the scene.** Never cast the scene to `{ someField?: … }` to read state; a refactor silently breaks it. Add a typed method on the scene/module instead (see `MissionScene.uiOverlayOpen()`).
- **`create()` order matters.** Textures must be registered before objects use them; equal-depth objects draw in creation order. Don't reorder `create()` phases or move object creation between them without checking dependencies.
- **Field initializers can't read `this.s`.** Module fields are initialized before `s` is usable; derive scene-dependent values in `reset()`/`create()`.
- **Scene events survive mission restarts.** Anything registered on `this.events` (or other long-lived emitters) must be removed on `SHUTDOWN`, or handlers stack per mission.
- **Per-mission state is reset in each module's `reset()`.** A field that isn't reset there persists across missions — make that a deliberate choice.
- **Phaser reuses the scene instance** across restarts; don't rely on constructor-time state.
- **`s.units` is append-only.** Add units only through `MissionScene.addUnits`; never remove, splice, filter or reassign it mid-mission (dead units stay with `dead` set). The spatial index, unit LOD and sprite blocks key state by list index; dev builds log if this breaks.
- **Hot paths:** `update()` runs every frame for dozens of units/shots. Avoid per-frame allocations (arrays/objects in loops) in shot, trail and particle code.

## Conventions

- **Comments:** terse — one short line, even for a non-obvious *why*. History and rationale belong in commit messages, not code.
- **Catalog `description` strings** (weapons, countermeasures, crafts) are role/fantasy only: standalone, no references to other items, no tuning numbers, no mechanics. Mechanics and how-to go in tactical tips (`src/catalog/tips.ts`).
- **Don't add unrequested mechanics.** Implement what was asked; suggest extras separately.
- **Rigs read from the source.** A rig previews real code: it imports the module's own lists, constants and functions (export them if needed) instead of re-cataloguing values, thresholds or formulas.
- **Behaviour-preserving refactors:** keep them mechanical and verifiable (type check, build, and no new runtime import cycles).
- **Git:** don't commit unless explicitly asked. Keep commit messages short: a title, a one-sentence summary, and at most a few dash points.
