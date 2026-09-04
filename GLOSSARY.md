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
| **look** | Projectile texture key (`ShotLook`) |
| **wpn** | Weapon preset id / `wpn()` fork helper |
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
| **SAM** | Surface-to-air launcher / unit (fires seeker) |
| **ARTY** | Artillery |
| **HE** | High-explosive shell preset |
| **MG / LMG** | Machine-gun preset |
| **BLD / VEH / INF / AIR / SEA** | Roster tags |

## Combat / weapons

| | |
|---|---|
| **ENEMY_WPNS** | Shared named enemy weapons (combat rig list) |
| **WPN.\*** | Stable refs into that list (`WPN.aa`, …) |
| **wpn(id, over)** | Fork a named preset (new object) |
| **look** | Projectile art key (= Phaser texture) |
| **shotKind(look)** | Behavior from texture: streaks → `cannon`, else rocket / hellfire / tow |
| **shot_*** | Projectile texture prefix (streaks + missiles) |
| **seeker** | Homing missile preset (`WPN.seeker` — body or secondary) |
| **secondary** | Hull hardpoint weapon / mounts (`SPECS.secondary`, craft `secondary` UVs) |
| **cooldown** | Delay before next shot |
| **burst** | Rapid shots in one fire cycle |
| **burstGap** | Delay between shots in a burst |
| **jitter** | Random aim spread |
| **muzzle** | Barrel tip (flash / spawn point) |
| **blast** | Explosion radius |
| **lock** | Time-on-target before a guided shot fires |
| **TOW** | Wire-guided missile (player steers) |
| **Hellfire** | Homing missile |

### Projectile textures (`look`)

| Key | |
|-----|---|
| `shot_chain` | Player chain-gun streak |
| `shot_shell` | HE / arty streak |
| `shot_small` | Light MG streak |
| `shot_aa` | AA burst streak |
| `shot_rocket` | Unguided rocket |
| `shot_hellfire` | Homing missile |
| `shot_tow` | TOW missile |

## Sprites / art

| | |
|---|---|
| **SPRITE_SPECS** | Central per-texture catalog (`spriteOrigin.ts`): origin, mounts, muzzles |
| **origin / pivot** | Sprite anchor from `SPRITE_SPECS` / `lookupSpriteOrigin` |
| **mount** | Tagged hull UV (`gun` / `rotor` / `troop` / `secondary` / … via `hullMountsOf` / `mountOf`) |
| **HULL_MOUNT_SOURCES** | Registry of SPECS mount kinds — add here when a new mount field appears |
| **hulk** | Wreck / debris art for a live sprite |
| **atlas / sheet** | Texture with multiple frames |
| **bake** | Offline / boot-time art processing |
| **camo** | Biome skin variant |
| **POI** | Damage interest UVs (player `dmg` role); not general mounts |
| **rig** | Debug config browser (sprite / roster / combat) |

## Units / AI

| | |
|---|---|
| **SPECS** | Per-kind unit config table |
| **CRAFTS** | Playable heli catalog (`craftOf` / `selectCraft`) |
| **craft** | Selected player helicopter id (`CraftId`) |
| **label** | Display name on the unit (`labelOf`) |
| **partsRoll** | Declared gun roll (`pick` or `fixed`) |
| **crew** | Pinned seats (`snap` or `leash`) |
| **snap** | Crew glued to a mount UV |
| **leash** | Crew roam within `leashR` |
| **move** | Locomotion class (`tank`, `inf`, `heli`, …) |
| **drive** | Ground vehicle physics (`maxSpd`, `accel`, `brake`, `turn`, `track`, …) |
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
