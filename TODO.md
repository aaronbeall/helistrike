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

* [ ] Mutliple terrain biome textures (current: full range, arctic: ice->snow->rock snow->snowcaps, desert: lake->sand->rock, tropic: water->jungle->rock, coastal: water->beach->greenery->jungle)
* [x] Multiple map gen presets (partial: river_run, island_chain, highland_siege, custom — still want urban / richer coastal / rugged as distinct feel)
  * [x] Current / river
  * [x] Islands
  * [x] Highland / rugged-ish
  * [ ] Coastal theater pack
  * [ ] Urban (roads + buildings heavy)
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
  * [x] Chinook (flyable; pick-up/drop still TODO)
  * [x] Black Hawk (extra)
  * [x] Murder Drone (extra)
  * [x] (Secret) Prometheus (cloak)
  * [ ] Steamship (steampunk airship)
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
  * [ ] Smokescreen (stealth) — smoke bomb weapon exists; not a CM
  * [x] Timewarp (cyber)
  * [x] Phase cloak (prometheus)
  * [x] EMP
  * [ ] Reactive Armor
  * [ ] Turtle (drone)
* [ ] Last stand / base defense game mode
* [ ] Enemy line-of-sight behavior (hide behind terrain, etc)
  * [ ] TOWs and Hellfire collide on launch making fire behind cover ineffective
* [ ] Sound effects
* [x] Night vision / thermal vision (thermal; dedicated NV still open)
* [x] Slow motion mode (timewarp CM + warp bomb)
* [x] Stinger events (objective complete, mission complete)
* [x] Mission briefing screen (light: mission briefing copy on menu — not a dedicated scene)
* [x] Mission outcome screen (MISSION COMPLETE / AIRCRAFT DOWN)
* [x] Water wreckage should sink
* [ ] Water ripples and wakes
* [x] Laser sight ray should collide with terrain
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
* [ ] Roadkill organic units with rotors
* [ ] Unit speed impact by slope, slope limit
* [ ] Tail rotor (with tilt)
* [ ] Pseudo 3d tilt graphic (jets/gunship props partial)
* [x] Clouds
* [ ] Drive ground vehicles
* [ ] Eject, infiltrate, hijack
* [ ] Hulk break-apart effect (dynamic splitting of hulk graphics into individual parts)
* [ ] Predictive firing (enemy units and craft gunners, fire at predicted location, accuracy of prediction falls off with range and speed)
* [ ] Lens flare
* [ ] Stats (mission, all time)

## Fix

* [ ] Low flying shooting just immediately hits ground
* [ ] Enemies should not leave map
* [ ] Enemy collision/avoidance sucks/doesn't work -- should avoid unit-to-unit collisions and buildings
* [ ] Building placement should avoid overlaps
* [ ] Ground units should avoid water -- partially implemented but it sucks
* [ ] Z-ordering is not ideal -- debris/missiles flicker above and below their flame trail
* [ ] Mech debris should not include vehicle type specific parts (rotors, treads, wheels)
  * [ ] Add wheels to wheeled vehicle debris
* [ ] Enemy helis rotar hulks are wrong -- should be the 5 point and sized correctly
* [ ] Cleanup unused sprites
* [ ] Hit areas -- use rects where appropriate?
* [ ] Boat spawns should happen only with enough space
* [ ] Chroma key bleed
* [ ] Camera change shouldn't change reticle location
* [ ] Spash down debris/hulks/shells in water should either disappear or become blue and sink to bottom, and not draw craters
* [ ] Switching from thermal to normal reveals pink graphics

## Achievements

* Craft unlocks
* Per-weapon kill totals
* All time total kills
* Specials
  * Ride The Lightning -- kill a vehicle with tesla coil from directly above
  * Search and destroy -- kill a vehicle beyond radar range with a guided missile (TOW, SPIKE)
  * Coming in Hot -- kill 5+ enemies with a single sustained burst of gun fire, without stopping
  * You Can't Hide -- kill an enemy with lock-on missile without line of sight
  * Death from Above -- kill 5+ enemies with single howitzer shot
  * Brrrrrt -- kill 5+ enemies with Avenger cannon in a single sustained burst
  * Dark Knight Rises -- kill 5 enemies while blinded from the same smoke bomb
  * Lights Out -- kill 5 enemies who are stunned by the same EMP
  * Pinned Down -- shoot through 2+ enemies with a single railgun round
  * Thunder Run -- beat a mission without ever letting go of thrust
  * Knife Fight -- complete a mission with guns only (no missiles, rockets, bombs or flares)
  * Can't Touch This -- dodge 100 locked on missiles
