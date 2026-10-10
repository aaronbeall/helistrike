# Map size — plan

Planning only; nothing here is implemented beyond what "Today" says.

Goal: larger maps (2× side = 4× area first, maybe 4× side = 16× area later) without hurting runtime, and room for many more units with LOD. World-gen time is not a concern; runtime frame cost and GPU memory are.

---

## Today

One fixed size for every map, in `worldgen/dims.ts`:

```ts
export const WORLD = 5600;          // world units per side
export const TEX = 1800;            // terrain texels per side
export const SCALE = WORLD / TEX;   // ≈3.11 world units per texel
```

Missions vary the land's shape inside that square (`profile.shape`), not its size. `WORLD` is read in 22 files (136 uses), and ~25 world-gen arrays are allocated at `TEX × TEX`.

### GPU resources

| Resource | Size | Runtime traffic |
|---|---|---|
| Terrain colour (`map_terrain`, `world.canvas`) | 1800² RGBA ≈ 13 MB | uploaded once at load; also the minimap image |
| Wreck / decal layer (`groundMarks.wreckLayer`) | `WRECK_TEX` 4096² RGBA ≈ 67 MB render texture | small stamp draws as marks land |
| Shore field + water mask (`render/terrain25d.ts`) | 1800² LA + 900² L | uploaded once |
| Ripple buffer (`fx/ripples.ts`) | 1024² over a 2500-unit **window that follows the camera** | redrawn each frame |
| Terrain mesh (`Terrain25D`) | 256 cells / axis ≈ 66k vertices, 64 chunks of 32² cells | static; per-chunk screen cull |

A static texture is not "moved" or re-uploaded per frame: the GPU samples only what's on screen, so fill cost tracks the screen, not the texture. The limits are **max texture size** (4096 on some mobile / integrated GPUs, 16384 typical desktop) and **GPU memory**, which grows with the side squared.

### CPU-side grids

| Grid | Today | Scales with |
|---|---|---|
| Nav (`sim/navGrid`) | `NAV_CELL` 28 → 200² cells, ~1.5 MB; regions + clearance per mode rebuilt in ~1–2 ms when a deck dies | side² |
| Spatial (`world/spatial`) | fixed 128-unit cells over the map + air margin | side² (memory only; queries depend on local density) |
| Unit LOD (`enemy/unitLod`) | far units tick every 4th frame; sprites only for units in view | unit count |

## Cost at larger sizes (same texel density)

| | 1× (today) | 2× side | 4× side |
|---|---|---|---|
| Terrain colour | 1800², 13 MB | 3600², 52 MB | 7200², 207 MB |
| Wreck layer | 4096², 67 MB | 8192², 268 MB | 16384², ~1 GB |
| Mesh (same cell size) | 64 chunks | 256 chunks | 1024 chunks |
| Nav grid | 200², ~1.5 MB | 400², ~6 MB | 800², ~24 MB |
| Deck-death nav rebuild | 1–2 ms / mode | 4–8 ms | 16–32 ms |

The wreck layer blocks 2× already; the terrain texture blocks 2× on 4096-limited GPUs; everything blocks 4× as single textures.

## What map size does and doesn't cost per unit

Not affected (same unit count):
- Unit sim, targeting and firing loops are O(units).
- Spatial queries are O(local density): bigger maps only add empty cells.
- Shadow rays, height lookups and line of sight are O(1) per call.
- Normal-play terrain draw: the screen covers the same number of chunks.

Affected:
- **Theater map view** draws the *whole* mesh: 4× / 16× vertices.
- **Nav region rebuild** on deck death (table above): a frame hitch.
- **A\* cap** (1600 expansions): long cross-map routes fail more often.
- World gen and load-time upload (accepted).

## Design

### 1. Map size per mission (prerequisite)

- `dims.ts` constants become a per-mission `MapDims { world, tex, scale }` chosen by the mission profile (e.g. `profile.mapScale: 1 | 2 | 4`).
- Module-level users (`NAV_N`, spatial bounds, camera bounds, theater zoom, minimap span, map-edge containment, `MAP_AIR_SOFT` margins, shader `SHORE_TEX_PX`) read the mission's dims, set once in `init()` / `reset()`.
- World-gen sizes stay in **world units** where they mean physical size (town radius, runway, keep-out), not texels, so they don't grow with the map. Audit `settlements.ts`, `landforms.ts`, `shape.ts` for texel constants.

### 2. Terrain pages (needed at 2×)

- Split the terrain colour into pages (e.g. 2048²) aligned to mesh chunk groups. Each chunk group draws with its page bound; one draw per group instead of one per mesh.
- Removes the max-texture-size limit. Memory is still the whole map at 2× (52 MB, acceptable).
- Shore field and water mask tile the same way, or pack into the colour pages' spare channels.

### 3. Sparse decal pages (needed at 2×)

- The wreck layer becomes a page table: a page (e.g. 1024² over its world square) is allocated on the first stamp inside it. Marks exist only where fighting happened, so memory tracks combat, not area.
- `groundMarks` stamps route to the page(s) under the stamp; the terrain shader samples the chunk's decal page, or the shared blank page.

### 4. Overview texture (needed once terrain is paged)

- A downsampled whole-map image (e.g. 1024²) baked at load for the minimap and the theater map, instead of `map_terrain`.

### 5. Mesh scaling + far LOD

- Keep the cell size (~22 world units): `cells` scales with the side.
- Coarser index buffers per chunk (every 2nd / 4th vertex) for the theater map view and far chunks, so map view stays near today's vertex count.

### 6. Nav at scale

- **Local rebuild:** when a deck dies, rebuild regions + clearance only inside a window around it (or keep a region-merge structure) instead of the whole grid.
- **Two-level routing:** a coarse region / portal graph for long routes, cell A* only for the current leg. Most units route short distances, so this matters mostly for long marches and squads (§8).

### 7. Terrain streaming (only for 4× side)

- Keep only pages near the camera resident, a ring like the ripple window; paint and upload the rest on demand in a worker from height + biome. This also avoids holding a 207 MB canvas in memory.
- Theater map view uses the overview texture (§4), so it never needs every page.

### 8. Many more units

Today every frame still loops over all of `s.units`, including the dead (the list is append-only). For a large increase:

1. **Dormant tier:** units far from the player and remotes don't simulate at all; they're data until their spatial cell comes into range. Cost then tracks *active* units.
2. **Active list:** frame loops iterate an active index list; `s.units` stays the append-only master (spatial, LOD and sprite blocks keep keying by index).
3. **Squads:** a far group moves as one route-following agent and expands into units near the player. Long-route pathfinding becomes per squad.
4. **Shared routing:** route caches per squad / target, or flow fields when many units head for one goal.
5. **Spatial for the rest:** minimap blips, threat HUD scans and any other whole-list loop move to `s.spatial.near` queries.

## Order

1. Per-mission `MapDims` (§1), shipping at 1× with no behaviour change.
2. 2× side: terrain pages (§2), sparse decals (§3), overview texture (§4), mesh scaling + far LOD (§5), local nav rebuild (§6).
3. More units: dormant tier + active list (§8.1–2) first, squads and shared routing (§8.3–4) later.
4. 4× side: terrain streaming (§7), two-level routing (§6).

## Verification

- `npm run bench` before / after each step, relevant scenarios only; `desert_stress` (~1,600 units map-wide) is the unit-scaling baseline for §8.
- GPU memory: count resident texture bytes (terrain pages + decal pages + overview) in a debug overlay line.
- A bench scenario on a 2× map: fly corner to corner, open the theater map, destroy a bridge (nav rebuild hitch).
- Low-end check: a 4096 max-texture-size profile (Chrome flag or a mobile device) loads a 2× map.

## Open

- Which missions get which size, and does unit count scale with area or stay fixed?
- Page size (1024 vs 2048) is a trade between draw calls and memory granularity; pick after measuring.
- Does the minimap span (2600 units) stay fixed, or scale with the map?
