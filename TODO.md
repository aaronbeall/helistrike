# Todo

## Content

* [ ] Mutliple terrain gen presets (current: full range, arctic: only ice->snow->rock->snowcaps, desert: lake->sand->rock, tropic: water->jungle->rock, coastal: water->beach->greenery->jungle)
* [ ] Multiple map gen presets (current, islands: small land mass, lots of water, rugged: lots of steep mountains, coastal: mixed water and land, urban: lots of roads and buildings)
* [ ] Multiple helicopters:
  * Apache (current)
  * Little Bird (faster, fixed aim guns, less arms, less armor)
  * Cobra
  * Stealthhawk
  * Cyberhawk (controls time)
  * VTOL
  * Cheyenne II
  * Warthog
  * Gunship (high flying)
  * (Secret) Prometheus (alien, cloaking)
* [ ] Single player progress, mission/vehicle unlocks, weapon/upgrade purchases
* [ ] Additional weapon options (current: chain gun, rockets, hellfires, TOWs), loadout options specific to heli type
  * Miniguns (auto shoot at enemies)
  * Spike NLOS (long-range guided)
  * Sidewinder (air-to-air)
  * Cluster bomb
  * Napalm
  * Laser beam
  * Tesla coil
  * Hellstorm (3 mini hellfies, rapid fire, target prioritization and distribution)
  * Nuke
  * MIRV
  * Flak cannon
  * Drone (drive and detonate)
  * Target painter/Orbital strike
  * Artillery (use map to designate, wait)
  * Airstrike (use map)
  * Predator strike (switch to high up view)
  * (Hidden) Rave Cannon
* [ ] Counter-measures
* [ ] Last stand / base defense game mode
* [ ] Enemy line-of-sight behavior (hide behind terrain, etc)
  * [ ] TOWs and Hellfire collide on launch making fire behind cover ineffective
* [ ] Sound effects
* [ ] Night vision / thermal vision
* [ ] Slow motion mode
* [ ] Stinger events (objective complete, mission complete)
* [ ] Mission briefing screen
* [ ] Mission outcome screen
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
  * [ ] Landed planes
  * [ ] Ammo depot (with cookoff)
* More doodads:
  * [ ] destroyed buildings
  * [ ] Pre-baked crashed vehicles
  * [ ] easter egg: waldo, crashed alien spacecraft
* [ ] Enemy air units
* [ ] Roads
* [ ] Boss enemies
* [ ] Starting landing pad/base
  * [ ] Limited repair/rearm 
* [ ] Player can shoot missiles out of sky (but hard)
* [ ] Difficulty levels (projectile speeds, damage)
* [x] Aircraft crash animations
* [x] Enemy unit damage effects like player
* [ ] Screen shock when player takes damage
* [x] Radial blur spinningblades
* [ ] Bubble explosion
* [ ] Weather effects (rain, lightning, thunder)
* [ ] Time of day lighting effects
  * [ ] Night rendering (lights)
* [ ] Steam achievements
* [ ] Shell ejecta
* [ ] Generated art height map
  * [ ] Whole image generation
  * [ ] Asset composition generation
* Circular map?

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
* [ ] Spash down debris/hulks in water should either disappear or become blue and sink to bottom, and not draw craters