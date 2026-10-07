# Game modes — plan

Planning only; nothing here is implemented beyond what "Today" says.

| Mode | Missions | Between missions | Progress |
|---|---|---|---|
| Random Skirmish | One procedurally generated mission | — | None (per mission) |
| Story Campaign | 3 episodes × ~10 designed missions + boss | Friendly base view | Campaign-only craft unlocks, completed missions replayable |
| Rogue Operation | Procedural run with light branching | Base: buy / repair | Run state with permadeath; craft unlocks are permanent |
| Last Stand | Endless waves | — (maybe between waves, TBD) | Best wave / score |

---

## Random Skirmish

Essentially what we have now: pick a theater, craft and loadout, fly one generated mission.

**Today:** mission presets in `catalog/missions.ts`, world gen in `worldgen/`, mission stats + history in `persist/statsStore`.

**Open:**
- Does Skirmish gate crafts behind Rogue unlocks (TODO.md says "shares unlocks with Rogue Operation"), or is everything open?

## Story Campaign

Single-player campaign with a retro feel.

**Structure**
- 3 sectors / episodes, each ~10 missions ending in a boss mission.
- Any episode can be started at any time.
- Any completed mission, from any episode, can be replayed.

**Craft progression (campaign only)**
- Missions unlock craft one at a time, in order.
- Played in order, each mission gives an unlock, and the next mission is tailored to that unlock's strengths.
- Choose the craft before each mission, from those unlocked so far.

**Between missions: base view**
- Friendly base where you inspect your craft, weapons, etc.
- Maybe light customization (camo paint) and special items (TBD).

**Missions are designed, not generated**
- Pre-drawn map shape, set unit composition, set objectives; maybe some randomness on top.
- A few unique objectives / mechanics, e.g.:
  - defend an objective
  - recover an objective
  - infiltrate
  - destroy everything
  - rescue
  - extraction

**Open:**
- Episode independence: if any episode can be started anytime, does each episode carry its own unlock track, or do unlocks span episodes? (Episode 3 mission 1 needs a sensible craft set.)
- Weapons/loadouts: unlocked like craft, fixed per craft, or freely chosen?
- Story delivery for the retro feel: briefing cards, stingers, in-mission radio text?
- Boss missions: a unique boss unit, a fortress, or a set-piece objective?
- What the special items are.
- How much randomness designed missions get (unit placement jitter, composition rolls, seed per replay?).

## Rogue Operation

Roguelike mode built from generated missions.

**Run loop**
1. A mission presents its objectives.
2. Launch, do what you can, return to base. Completing the objectives is not required to proceed.
3. Earn money from objectives and kills.
4. At base, spend it, then choose the next mission from a lightly branching path.

**Carries over between missions (run state):** health, ammo, permadeath.

**Shop:**
- new craft
- ammo
- repairs for damaged craft
- repairs for the base

**Meta progression:** craft unlocks are permanent. Choose a starting craft from your unlocked set when beginning a new operation.

**Open:**
- Permadeath scope: does losing the current craft end the run, or only losing the base / every craft?
- Base damage: what damages the base, and what a damaged base costs you (fewer shop slots, higher prices, worse repairs?).
- Branch choice: what differs between branches (theater, difficulty, reward, mission type)?
- Run length and ending: fixed number of missions with a final mission, or endless with scaling?
- Fleet: is a bought craft added to a hangar you switch between, or does it replace the current one?
- How permanent unlocks are earned: run milestones, objectives, money?

## Last Stand

Wave-defense arcade mode: survive as many waves as possible; each wave brings more numerous and more dangerous enemies.

**Open:**
- What you defend: just yourself, or a base / objective that ends the run when it falls?
- Resupply between waves (ammo / repair), and whether it is free, timed or earned?
- Map: one fixed arena per theater, or generated?
- Score: waves survived, kills, time, or a combined score; per-craft leaderboards?

---

## Shared systems to plan

These are needed by more than one mode; worth designing once.

| System | Used by | Notes |
|---|---|---|
| Mode-aware persistence | Campaign, Rogue, Last Stand | Separate saves: campaign progress, rogue meta unlocks, rogue run in progress, Last Stand bests. Builds on `persist/`. |
| Unlock tables | Campaign, Rogue (+ Skirmish?) | Campaign unlocks are campaign-only; Rogue unlocks are permanent. Two tables, same shape. |
| Objective types | Campaign (designed), Rogue (generated) | Defend, recover, infiltrate, destroy all, rescue, extraction. Rogue can reuse them as generated objectives. |
| Mission authoring format | Campaign | Pre-drawn shape + placed units + objectives, layered on world gen. Needs a format and probably an editor or rig. |
| Base / between-mission scene | Campaign, Rogue | Campaign: inspect + light customization. Rogue: shop + repairs + path choice. Possibly one scene with mode-specific panels. |
| Run state across missions | Rogue | Craft health, ammo, money, base condition. |
| Mission end → next step | All except Skirmish | Debrief, rewards, then return to base / next wave. |
| Wave spawner | Last Stand | Scaling composition and count per wave; may share spawn rules with world gen. |
| Craft paint | Campaign (maybe Rogue) | Camo patterns already exist for enemies (`render/camo`); player craft skinning is a TODO. |

## Existing TODO entries this replaces / touches

- TODO.md "Single player progress" (Campaign / Rogue Operation / Skirmish) and "Last stand / base defense game mode".
- TODO.md mentions "between mission resource management" for the campaign; this plan puts resource management in Rogue and gives the campaign a base view. Decide which is intended.
- TODO.md lists "full campaign, Rogue Operation" as not required for 1.0.
