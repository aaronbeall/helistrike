# Todo

## Release blockers (arcade 1.0)

Must-haves for a paid itch / Steam-shaped build (see also `docs/selling.md`):

* [ ] **Sound** — SFX (guns, impacts, rotors, UI) + at least one music bed; volume in settings
* [ ] **Settings** — pause already exists; add fullscreen, master/SFX/music volume, documented keys (rebinds optional)
* [ ] **Desktop package** — Windows (and ideally macOS) wrapper over the Vite build (Tauri/Electron); not “open a URL”
* [ ] **Mission wrapper polish** — clearer briefing → play → outcome/debrief with basic mission stats (kills, time, HV)
* [ ] **Content honesty** — 2–3 theaters or gen presets that *feel* different, or ship with explicit “skirmish / proc-gen” framing
* [ ] **Persistence** — options + unlocks/progress (even a thin Skirmish unlock table beats session-only selection)
* [ ] **Ship hygiene** — gate rig/debug hotkeys out of public builds; trademark-safe display names for store
* [ ] **Store packaging** — capsules, 5+ screenshots, trailer, demo App ID (Steam); credits/legal in-game or on page

Not required for 1.0: full campaign, Rogue Operation, Steam achievements, controller, mobile, every craft/weapon fantasy line below.

---

## Content

* [x] Mutliple terrain biome textures (current: full range, arctic: ice->snow->rock snow->snowcaps, desert: lake->sand->rock, tropic: water->jungle->rock, coastal: water->beach->greenery->jungle)
  * [x] Terrain themes (`worldgen/theme.ts`) — palette + tinted existing tiles + decor swaps
  * [ ] Dedicated tile art per theme (currently recolored shared tiles)
* [x] Multiple map gen presets (river_run, coastal_strike, island_chain, highland_siege, desert_flats, custom; macro shapes in `worldgen/shape.ts`)
  * [x] Current / river
  * [x] Islands
  * [x] Highland / rugged-ish
  * [ ] Coastal theater pack
  * [x] Urban (roads + buildings heavy): towns, ports, airfields, dams, farms, oil fields, power lines
    * [x] Civilian buildings + boats are destructible neutral units (no HP bar, gray on minimap, never auto-targeted)
    * [x] Oil rigs: chained inferno deaths; pylons: electrical short (tesla zaps) + live wires
    * [ ] Critters: cows, deer, birds, fish, sharks, etc.
    * [ ] Building roof height: draw building art at its roof (`z + height`) so tall buildings sit up in 2.5D, not flat on the ground
    * [x] Building cast shadows: buildings cast shadows from their height across the terrain (simple: footprint shadow offset from roof height, not an extruded silhouette)
* [x] Multiple helicopters / craft (playable roster in `craft.ts`; menu select)
  * [x] Apache
  * [x] Little Bird
  * [x] Cobra
  * [x] Viper (extra vs original list)
  * [x] Stealthhawk
  * [x] Cyberhawk (time warp)
  * [x] Osprey (VTOL)
  * [ ] Cheyenne II (VTOL)
  * [x] Warthog (Jet)
  * [x] Lightning II (extra)
  * [x] Gunship
  * [x] Chinook (flyable; drops via Humvee cargo bay)
  * [x] Black Hawk (extra)
  * [x] Murder Hornet (extra)
  * [x] (Secret) Prometheus (cloak)
  * [x] Steamship (steampunk airship — Leviathan)
  * [ ] Destroyer (water ship with heli remote)
  * [ ] Carrier (big water ship with lots of remotes)
* [ ] Customize craft paint (camo pattern, color)
* [ ] Single player progress, mission/vehicle unlocks, weapon/upgrade purchases
  * [ ] Campaign: multiple theater hand crafted missions with a light story, craft/weapon unlocks, between mission resource management, and progress pathing
  * [ ] Rogue Operation: a roguelike mode that uses procedural generated series of increasingly difficult missions, unlocks (craft and weapons) stick across playthroughs
  * [ ] Skirmish: single randomly generated mission, shares unlocks with Rogue Operation
* [x] Additional weapon options + per-craft loadouts (large `PLAYER_WPNS` catalog; sockets in `craft.ts`)
  * [x] Miniguns / gatling family
  * [x] Spike NLOS (`tv_missile`)
  * [x] Sidewinder (air-to-air)
  * [x] Cluster bomb
  * [ ] Napalm (sets things on fire)
  * [x] Laser / energy beams (laser rocket, tesla, refractor-style)
  * [x] Tesla coil
  * [ ] Hellstorm (3 mini hellfires, rapid fire, target prioritization and distribution) — have Micro-Hellfire / related, not full design
  * [ ] Nuke
  * [ ] MIRV
  * [ ] Flak cannon (shotgun like spread, effective on troops)
  * [x] Drone (drive and detonate / Spectre remote)
  * [ ] Target painter/Orbital strike
  * [x] Artillery / howitzer (gunship) — map-designate wait loop still incomplete
  * [ ] Airstrike (use map)
  * [x] EMP (countermeasure; also disables)
  * [ ] Predator strike (switch to high up view)
  * [ ] Torpedo
  * [ ] (Hidden) Rave Cannon
  * [x] (Alien) Plasma helix
  * [x] (Alien) Photon missile
  * [x] (Alien) Refractor / laser rocket family
  * [x] (Alien) Warp bomb
* [x] Counter-measures (partial)
  * [x] Flares (default)
  * [x] Smokescreen (smoke_screen CM on several craft / remotes; smoke bomb weapon too)
  * [x] Timewarp (cyber) — pausable charge meter; world crawls while the craft keeps a movement + turret-aim bonus; warpwire lens
  * [x] Phase cloak (prometheus)
  * [x] EMP
  * [x] Reactive Armor
  * [ ] Turtle (drone)
* [ ] Last stand / base defense game mode
* [ ] Moving patrols: ground/boat/air groups that travel routes around the map (roads, rivers, between objectives) instead of holding their spawn
* [x] Enemy line-of-sight behavior (hide behind terrain, etc) (staggered terrain-occlusion LOS gates awareness; debug: Line of sight)
  * [ ] TOWs and Hellfire collide on launch making fire behind cover ineffective
* [ ] Sound effects
* [x] Night vision / thermal vision (thermal; dedicated NV still open)
* [x] Slow motion mode (timewarp CM + warp bomb + global bullet time on E, rechargeable meter)
* [x] Stinger events (objective complete, mission complete)
* [x] Mission briefing screen (light: mission briefing copy on menu — not a dedicated scene)
* [x] Mission outcome screen (MISSION COMPLETE / AIRCRAFT DOWN)
* [x] Water wreckage should sink
* [ ] Water ripples and wakes
* [ ] Water surface animation (waves, shimmer, shoreline foam)
* [ ] Lava: glowing volcano summit crater, lava flows down the flanks (damaging / impassable)
* [x] Laser sight ray should collide with terrain
* [x] Landform stamps (mesas + buttes, craters, volcanoes, dunes) and trunk rivers with carved valleys
  * [x] Lakes/dams
  * [ ] Escarpments, canyons (removed: smooth faces, seams at bends, biome banding — rebuild with a continuous signed distance, rough strata faces, post-biome stamping)
* [ ] Settlement structures as real buildings (volumetric, destructible, collision) + final art
* [ ] Designed maps (seed + brush + placements)
* More enemy targets:
  * [ ] HV: missile silo
  * [ ] Hover tank with laser
  * [ ] Submarines
  * [ ] VTOL aircraft
  * [ ] HV: nuclear weapons facility
  * [ ] Runway/landing pad
  * [ ] Drone swarm truck
  * [ ] Troop truck
  * [ ] Landed planes on runways
  * [ ] Ammo depot (with cookoff)
  * [ ] Explosive tanks
  * [ ] Explosive trucks
  * [ ] Destroyer
  * [ ] Carrier
  * [ ] APC
  * [ ] Trains
* More doodads:
  * [ ] destroyed buildings
  * [ ] Pre-baked crashed vehicles
  * [ ] easter egg: waldo, crashed alien spacecraft
* [x] Enemy air units
* [x] Roads, bridges (partial — gen places roads/bridges; walls/fences still open)
  * [ ] walls/fences
* [ ] Boss enemies
* [ ] Starting landing pad/base
  * [x] Spool from ground (pad AGL) — not a real base
  * [ ] Limited repair/rearm
* [ ] Player can shoot missiles out of sky (but hard)
* [ ] Difficulty levels (projectile speeds, damage)
* [x] Aircraft crash animations
* [x] Enemy unit damage effects like player
* [x] Screen shock when player takes damage
* [x] Radial blur spinningblades
* [ ] Bubble explosion
* [ ] Improve toon blast with volume bubbling
* [ ] Weather effects (rain, lightning, thunder)
* [ ] Time of day lighting effects
  * [ ] Night rendering (lights)
* [ ] Steam achievements
* [x] Shell ejecta
* [ ] Generated art height map
  * [ ] Whole image generation
  * [ ] Asset composition generation
* [ ] Circular map?
* [ ] Hit force (knockback, torque)
* [ ] Unit spawners
  * [ ] Tents -> troops
  * [ ] Hanger -> tanks
  * [ ] Docks -> boats
* [ ] Rotors push smoke
* [x] Roadkill organic units with rotors (rotor blades + crushing hulls)
* [x] Units affected by cliffs/slope -- slow travel uphill, slope limit; AI paths around cliffs or is blocked by them instead of driving through
* [x] Player craft blocked by cliffs while holding Shift
* [ ] Pathfinding units: route around terrain/water instead of local steering; prefer roads when available
* [ ] Tail rotor (with tilt)
* [ ] Pseudo 3d tilt graphic (jets/gunship props partial)
* [x] Clouds
* [x] Drive ground vehicles (pilotable ground remotes: HOUND, WOLF)
* [ ] Eject, infiltrate, hijack
* [ ] Hulk break-apart effect (dynamic splitting of hulk graphics into individual parts)
* [ ] Predictive firing (enemy units and craft gunners, fire at predicted location, accuracy of prediction falls off with range and speed)
* [ ] Automatic turrets prioritize targets by their weapon damage multipliers (e.g. anti-armor stations pick vehicles, flak picks troops)
* [ ] Popped turrets should do a little damage on landing -- enough to kill a troop or break a house
* [ ] Lens flare
* [ ] Stats (mission, all time)
* [ ] Score
  * [ ] Kill
  * [ ] Bonuses: Double/Tripple/Multi kill
  * [ ] Records
* [ ] Power lines -- poles and wires that break/fall, lots of sparks

## Fix

* [ ] Low flying shooting just immediately hits ground
* [ ] Enemies should not leave map
* [ ] Enemy collision/avoidance sucks/doesn't work -- should avoid unit-to-unit collisions and buildings
* [x] Building placement should avoid overlaps
* [x] Unit/building spawns should not overlap water or cliffs (check the footprint, not just the center point)
* [ ] Ground units should avoid water -- partially implemented but it sucks
* [ ] Z-ordering is not ideal -- debris/missiles flicker above and below their flame trail (trail smoke-over-flame across depth bands fixed; debris still open)
* [x] Mech debris should not include vehicle type specific parts (rotors, treads, wheels)
  * [x] Add wheels to wheeled vehicle debris
* [x] Enemy helis rotar hulks are wrong -- should be the 5 point and sized correctly
* [x] Cleanup unused sprites
* [x] Hit areas -- use rects where appropriate?
* [x] Boat spawns should happen only with enough space
* [ ] Chroma key bleed
* [x] Camera change shouldn't change reticle location
* [ ] Spash down debris/hulks/shells in water should either disappear or become blue and sink to bottom, and not draw craters
* [ ] Switching from thermal to normal reveals pink graphics
* [ ] Dropship artillery strike should not follow the player reticle while active -- it messes it up
* [ ] Map/theater view draws the current-view frame in the wrong location -- likely the captured play-camera view vs the map's zoom/projection pose (pre-existing)
* [ ] Sustained Starscream fire causes big framerate drops and short freezes (GC?) -- energy ribbons allocate per frame across dozens of live shots + bomblets; reuse buffers, profile explosion cost (pre-existing)
* [ ] Map edge shows for helis -- out-of-bounds cloud mountains don't hide the seam everywhere (e.g. top of the plane map)
* [ ] Out-of-bounds cloud mountains have a lot of pink/magenta contamination
* [ ] Optimize minimap -- don't render from the live terrain

## Stats

Candidates for the stats system (`sim/stats` fact tables). **Additive** = new measure, new table, or new mission-result field: safe any time. **Breaking** = a new dim on an existing table: bumps the stats version and discards saved data (no migration). Stats only count from when they're added; no backfill.

* Achievement prerequisites (see Achievements below)
  * [ ] Multi-kills + kill streaks (kills within a short window, longest streak) — additive measures; Coming in Hot, Brrrrrt, Armeggedon, Death from Above, Kabob
  * [x] Kills while the enemy was debuffed (EMP/tesla stunned, smoke-blinded) — additive measures; Lights Out, Dark Knight Rises, Silent Assassin
  * [x] Kill context: NLOS (target's cached line of sight), kill range (close / mid / long), debuff — `killContext` table; You Can't Hide, Search and Destroy, Never Saw it Coming
  * [ ] Kill context: attacker above target — Ride The Lightning
  * [x] Missiles dodged (locked missiles that missed, how many flared off) — additive; Can't Touch This
  * [ ] Per-mission flags: no damage taken, guns only, thrust held the whole mission, % of time firing — additive mission-result fields; Knife Fight, Guns Blazing, Lightning Round, Thunder Run
* Combat depth
  * [ ] Lock-ons acquired; guided hits on the locked target (lock accuracy)
  * [ ] Overkill (damage past a target's remaining health); shots with nothing in range
  * [ ] Enemy shots fired at the player vs hits taken (dodge rate, per enemy / enemy weapon)
  * [x] Kill distance buckets (close / mid / long) per weapon
* Survival + flying
  * [ ] Health repaired / docked; closest call (lowest health while surviving)
  * [ ] Time nap-of-earth (Shift / low AGL) vs cruise; time in bullet time / time warp; distance flown per craft
* Collateral + objectives
  * [ ] Civilian collateral per mission (civilians / buildings destroyed) as named result fields — Surgical, Oopsie Daisy
  * [ ] Time to each objective; objective type completed (bunker, SAM, officer…)
* Remotes + meta
  * [ ] Remote launches / docks / losses per remote craft (remote survival rate) — launches done (`remoteLaunches`); docks / losses open
  * [ ] Session play time (outside missions); favorite craft / weapon (derivable)

## Achievements

* Craft unlocks
* Per-weapon kill totals
* Per-craft objects completed
* Enemy type kills (air, troop, attack vehicle, flee vehicle, building, boat)
* All time total kills
* Game completions (campaign, rogue, skirmish, difficulty setting)
* Specials
  * Ride The Lightning -- kill a vehicle with tesla coil from directly above
  * Search and destroy -- kill a vehicle beyond radar range with a guided missile (TOW, Spike NLOS, etc)
  * Coming in Hot -- kill 5+ enemies with a single sustained burst of gun fire, without stopping
  * You Can't Hide -- kill an enemy with lock-on missile without line of sight
  * Death from Above -- kill 5+ enemies with a single howitzer shot
  * Brrrrrt -- kill 5+ enemies with Avenger cannon in a single sustained burst
  * Dark Knight Rises -- kill 5 enemies while blinded from the same smoke bomb
  * Lights Out -- kill 5 enemies who are stunned by the same EMP
  * Kabob -- shoot through and kill 2+ enemies with a single railgun round
  * Lightning Round -- beat a mission without ever letting go of thrust
  * Thunder Run -- beat a mission with 90% of time spent firing
  * Guns Blazing -- complete a mission with guns only (no missiles, rockets, bombs or flares)
  * Knife Fight -- complete a mission with Little Bird, Murder Hornet or Cyber Hawk without taking damage
  * Can't Touch This -- dodge 50 locked on missiles in a single mission
  * Silent Assassin -- kill an armored enemy with whisper cannons while they are blinded
  * Never Saw it Coming -- sneak up and kill an enemy from close range using cover
  * Armeggedon -- wipe out an entire garrison with a single bomb (MOAB, Rockeye, etc)
  * Top Hat Double Tap -- kill a field officer with kinetic slugs
  * Leadership Decapitation -- kill a field officer with rotors
  * Flying Circus -- beat a mission with the biplane
  * Red Baron -- beat a mission with the biplane without taking any damage
  * Buzzcut -- rotor kill a troop with the Murder Hornet
  * Surgical -- beat a mission with 0% collateral damage
  * Oopsie Daisy -- beat a mission with 100% collateral damage
  * SHocking Habit -- destroy 1000 powerlines
