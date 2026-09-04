# Glossary

Short labels from the config rigs, plus terms used in code / design.

## Rig abbreviations

| | |
|---|---|
| **cd** | Cooldown (`fireCd`) — time between shots |
| **spd** | Speed (projectile or drive) |
| **dmg** | Damage |
| **sc** | Scale |
| **tex** | Texture key |
| **wpn** | Weapon preset id |
| **uv** | Texture coords 0–1 |
| **px** | Pixel coords in the texture |
| **n** | Index / count |
| **p** | Probability (% of roll weight) |
| **w** | Raw roll weight |
| **len** | Muzzle length |
| **gap** | Spacing (track gap, or burst interval) |
| **accel** | Acceleration |
| **leashR** | Crew roam radius |
| **flyZ** | Flight height offset |
| **rotOff** | Sprite rotation offset |
| **frag** | Death debris category |
| **HP** | Health |
| **HV** | High-value map objective |
| **FX** | Visual effects |
| **AA** | Anti-air |
| **SAM** | Surface-to-air missile |
| **ARTY** | Artillery |
| **BLD / VEH / INF / AIR / SEA** | Roster tags |

## Combat / weapons

| | |
|---|---|
| **cooldown** | Delay before next shot |
| **burst** | Rapid shots in one fire cycle |
| **burstGap** | Delay between shots in a burst |
| **tracer** | Visible projectile style |
| **jitter** | Random aim spread |
| **muzzle** | Barrel tip (flash / spawn point) |
| **blast** | Explosion radius |
| **shot** | Projectile type (`cannon` / `rocket` / `hellfire`) |
| **lock** | Time-on-target before a guided shot fires |
| **TOW** | Wire-guided missile (player steers) |
| **Hellfire** | Homing missile |

## Sprites / art

| | |
|---|---|
| **origin / pivot** | Sprite anchor (where the unit “sits”) |
| **mount** | UV where a part attaches to the hull |
| **hulk** | Wreck / debris art for a live sprite |
| **atlas / sheet** | Texture with multiple frames |
| **bake** | Offline / boot-time art processing |
| **camo** | Biome skin variant |
| **POI** | Point of interest (dmg / mount markers) |
| **rig** | Debug config browser (sprite / roster / combat) |

## Units / AI

| | |
|---|---|
| **SPECS** | Per-kind unit config table |
| **partsRoll** | Declared gun roll (`pick` or `fixed`) |
| **crew** | Pinned seats (`snap` or `leash`) |
| **snap** | Crew glued to a mount UV |
| **leash** | Crew roam within `leashR` |
| **move** | Locomotion class (`tank`, `inf`, `heli`, …) |
| **kite** | Fight while backing off |
| **flee** | Run away (no engage) |
| **orbit** | Circle the player |
| **fixedAim** | Must face target to shoot (no turret) |
| **AGL** | Above ground level |

## World / FX

| | |
|---|---|
| **frag** | Flying debris piece |
| **stamp** | Drawn permanently onto wreck/terrain layer |
| **trail** | Smoke / fire along a frag or missile |
| **cast** | Shadow projection height |
| **spawn** | Placed unit / projectile birth |
