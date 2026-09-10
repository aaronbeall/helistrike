# Plan: Organize `scenes.ts`

Do later — mechanical refactors, no gameplay changes.

## 1. Split scenes into their own files

Today [`src/scenes.ts`](../src/scenes.ts) (~13.7k lines) holds Boot / Menu / Load / Mission.

- Extract each Phaser scene into its own module, e.g.:
  - `src/scenes/boot.ts` — `BootScene`
  - `src/scenes/menu.ts` — `MenuScene`
  - `src/scenes/load.ts` — `LoadScene`
  - `src/scenes/mission.ts` — `MissionScene` (still large; OK for this step)
  - `src/scenes/index.ts` — re-export for [`main.ts`](../src/main.ts)
- Shared top-of-file types/helpers that several scenes need either:
  - stay in a thin `src/scenes/shared.ts`, or
  - move with the helper pass below first so mission doesn’t drag boot/menu along
- Keep behavior identical; update imports only (`main.ts`, any rigs that import scenes).

**Order note:** Doing this *before* or *after* helper extract both work. Splitting first makes the mission file the only place that still owns the helper drawer; extracting helpers first makes the split diffs smaller. Prefer **helpers first**, then scene split — less thrash on `mission.ts`.

## 2. Helper organization (batches 1 & 2)

Same pattern as [`weaponRuntime.ts`](../src/weaponRuntime.ts): pure `(args) → result`, no scene/pools.

### Batch 1 — Grow `weaponRuntime.ts`

Move from `scenes.ts`:

- `projectAlong`
- `gunWorldRot`
- `projectileFxScale` / `scaledProjectileFxCount` (+ `PROJECTILE_FX_*` consts)
- `shotTrailScale` / `troopMissileTrail` / `shotLookOf`
- `shellGirth` / `shellEjectSide`
- `GUN_STATION_TURN_RATE` / `AUTO_GUN_ALIGN_TOL`
- optional: `SHOT_Z_REF` / `SHOT_Z_MAX` / `HELLFIRE_Z_MAX`

### Batch 2 — New small modules

| Module | Move |
|--------|------|
| `vecMath.ts` (name flexible) | `norm3`, `steerDir`, `biasedDir`, `expBiasDir`, `jitterDisk` |
| `simParticleMath.ts` | `hitSimParticleFx`, `simParticleTexKey`, `simParticleLook`, optionally `deathBurstImpulse` |
| `mapEdge.ts` | `mapEdgeWeight` / `mapEdgeInland` / `mapEdgeSteer` + margin consts |
| `hudFormat.ts` | `bearing`, `bearingArrow`, `healthHudColor` |
| `thermalWreck.ts` | `thermalWreckTiming` / `thermalWreckDisplayScale` / `thermalSignalTint` / fade helper |

Skip for this pass: texture bakers (`ensure*Glow`), full systems (`updateShots`, `handleFire`, FX pools).

### Expected impact

- ~300–400 lines leave `scenes.ts`; net repo LOC roughly flat
- `scenes.ts` shrinks ~2–3%; call-site rewires are mechanical
- Low behavior risk if done as move + import

## Suggested sequence

1. Batch 1 (`weaponRuntime`)
2. Batch 2 (new helper modules)
3. Split Boot / Menu / Load / Mission into `src/scenes/*`
4. (Later, out of scope here) carve MissionScene into systems

## Out of scope

- ECS / full MissionScene system split
- Renaming `combat.ts` / `weaponRuntime.ts` for consistency
- Gameplay or balance changes
