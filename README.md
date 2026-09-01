# HeliStrike

Top-down helicopter arcade shooter (Phaser 3 + Vite).

```bash
npm install
npm run dev
```

This project lives at `~/Development/github/aaronbeall/helistrike` (moved out of `abeall.com`).

## Original brief vs status

### Done

| Brief | Status |
| --- | --- |
| Browser game in Phaser | Vite + Phaser 3.90, 1280×720 FIT canvas |
| Generated 2D graphic assets | Painted unit sprites in `public/sprites/` (chroma-keyed at boot). Rotors, shots, HUD, sparks are still canvas-baked in `src/bake.ts` |
| Top-down gunship | Player Apache, enemy Hinds |
| Pseudo-3D: Z height + shadows | Heli, shots, and aerial units offset a ground shadow; altitude scales the shadow |
| Grounded start, rotors spool, then lift | `grounded` → `spool` → `liftoff` → `flight` |
| Momentum / arcade physics | Thrust, strafe, drag, speed cap, pitch/roll squash |
| WASD / arrows thrust & strafe | Forward/back + left/right strafe once airborne |
| Mouse turn toward pointer | Yaw with momentum; chain gun tracks faster and almost independently |
| Click to shoot | Left mouse; weapons 1–4 or mouse wheel |
| Space: climb, then settle | Hold Space toward max Z; release eases back to cruise |
| Autocannon | Nose gun, rapid fire, projectiles drop to ground around the aim point |
| Rocket pods | Wing-mounted, fire along heli heading, blast at ground range of the mouse |
| Hellfire | Lock on a unit near the mouse, then fire along heli heading and turn toward the target |
| TOW | Wing launch, steers toward the current mouse |
| Procedural terrain | Height, rivers, biomes (water/sand/grass/forest/rock/peak) on a 5600-unit map |
| Procedural enemies | Bases, tanks, soldiers, helis, boats, AA towers, bunkers, radar |
| Destructible enemies | Health, explosions, debris pieces that stay on the field |
| Circle minimap, lower left | Terrain clip + unit/HV dots + heading |
| Sparks / explosions | Spark, fire, smoke emitters + blast rings + camera shake |
| HV targets + tracker + direction | 4 named HVs, count, range, compass, HP%; off-screen arrows |

### Partial

- **Art pipeline:** sprites were generated in-session and processed in `src/sprites.ts`, not a ChatGPT.com download flow. Heli bodies still show painted rotors under the spinning overlay.
- **Trees / rocks:** stamped onto the terrain canvas, not separate destructible objects.
- **Player wreck:** dying ends the mission; the heli does not leave a permanent debris field the way units do.
- **Enemy AI:** simple (tanks close, helis drift in, towers/boats/infantry shoot in range). No patrols, reinforcements, or base alarms.

### Left

1. Sound: rotor loop, chain gun, rocket whoosh, explosions.
2. Destructible scenery (stamp-decor is not independent objects).
3. Player crash debris + fire on `dead`.
4. Cleaner heli sprites without baked-in rotor discs; separate gun/pod layers.
5. Tighter combat between HV sites (field can feel empty).
6. Pause, settings, seed display / replay seed.
7. Deploy (`npm run build` to static hosting). No campaign/briefing/difficulty — each run is a new seed; `R` after win/loss regenerates.

## Controls

- **WASD / arrows** — thrust and strafe
- **Mouse** — turn; **click** — fire
- **1–4 / wheel** — weapons
- **Space** — pop-up altitude
- **R** — new mission after complete or crash

## Layout

- `src/main.ts` — Phaser boot
- `src/scenes.ts` — menu, world gen load, mission loop, HUD
- `src/heli.ts` — player flight
- `src/world.ts` — procedural map and force laydown
- `src/combat.ts` — unit/weapon types
- `src/sprites.ts` / `public/sprites/` — generated art
- `src/bake.ts` — procedural FX and fallback sprites
