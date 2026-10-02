# HeliStrike — agent guide

Shared instructions for AI coding agents (Codex, Cursor, Claude Code, …). For what the game *is*, read `README.md`.

## Commands

```bash
npm run dev               # Vite dev server
npx tsc --noEmit -p .     # type check (run after every change; must be clean)
npm run build             # tsc + production build
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
| `src/util/` | Generic helpers (`rng`, `vec`) | |
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
enemy/        targeting · unitSim · enemyFire
remote/       fleet · ai · body
weapons/      fireControl · projectiles · lockOn · countermeasures · tesla · refractor · callStrike
fx/           fx · trails · groundMarks · emitters (function: createFxEmitters)
destruction/  destruction
render/       hostCraft · unitSprites · thermalMode
camera/       camera
flow/         missionFlow
hud/          weaponHud · statusHud · threatHud · reticleHud · minimap · cornerHud · prompts · help · fieldBars
debug/        menu · overlays · relief · sideView · perf · postFx
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
| Remote launch/dock/pilot | `remote/fleet`; autonomous behaviour `remote/ai`; visuals + guns `remote/body` |
| Particles / impacts / muzzle flash | `fx/fx` (emitter configs in `fx/emitters`) |
| Trails / ribbons | `fx/trails` |
| Craters, scorch, wreck stamps | `fx/groundMarks` |
| Deaths, crashes, debris | `destruction/destruction` |
| HUD element | the matching `hud/…` module, or a new one |
| Debug tool / overlay | `debug/…` |

## Gotchas (learned the hard way)

- **No untyped access to the scene.** Never cast the scene to `{ someField?: … }` to read state; a refactor silently breaks it. Add a typed method on the scene/module instead (see `MissionScene.uiOverlayOpen()`).
- **`create()` order matters.** Textures must be registered before objects use them; equal-depth objects draw in creation order. Don't reorder `create()` phases or move object creation between them without checking dependencies.
- **Field initializers can't read `this.s`.** Module fields are initialized before `s` is usable; derive scene-dependent values in `reset()`/`create()`.
- **Scene events survive mission restarts.** Anything registered on `this.events` (or other long-lived emitters) must be removed on `SHUTDOWN`, or handlers stack per mission.
- **Per-mission state is reset in each module's `reset()`.** A field that isn't reset there persists across missions — make that a deliberate choice.
- **Phaser reuses the scene instance** across restarts; don't rely on constructor-time state.
- **Hot paths:** `update()` runs every frame for dozens of units/shots. Avoid per-frame allocations (arrays/objects in loops) in shot, trail and particle code.

## Conventions

- **Comments:** terse — one short line, even for a non-obvious *why*. History and rationale belong in commit messages, not code.
- **Catalog `description` strings** (weapons, countermeasures, crafts) are role/fantasy only: standalone, no references to other items, no tuning numbers, no mechanics. Mechanics and how-to go in tactical tips (`src/catalog/tips.ts`).
- **Don't add unrequested mechanics.** Implement what was asked; suggest extras separately.
- **Behaviour-preserving refactors:** keep them mechanical and verifiable (type check, build, and no new runtime import cycles).
- **Git:** don't commit unless explicitly asked. Keep commit messages short: a title, a one-sentence summary, and at most a few dash points.
