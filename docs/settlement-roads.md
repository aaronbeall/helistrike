# Settlement roads — plan

Planning only; nothing here is implemented beyond what "Today" says.

Goal: the road network plugs into settlements instead of cutting through them. A trunk either enters a settlement at a gate, rides its main street and leaves by another gate, or goes around it. A settlement no trunk passes gets a connector from one of its gates. No road crosses a settlement except along its own streets.

---

## Today

Order in `generateWorld` (`worldgen/world.ts`): forces + HV → `placeSettlements` → `makeRoads` → `townStreets` → `placeBridges`.

- **Placement is terrain-only.** Each settlement kind samples random spots and keeps the best-scoring clear one (flattest strip for an airfield, a sea cove for a port, a narrow ravine for a dam, flat mostly-dry ground for a town, flat grass for a farm, open sea for an oil field). Roads play no part. Plan A keeps this.
- **Trunks** (`makeRoads`): an MST between HV objectives, each edge routed with A* on `RoadGrid` (cost = distance × wobble, grade², high ground, + water, + `ROAD_BUILDING` per cell under a building disc, × `ROAD_REUSE` on cells already used). Building cost only applies under each building's own disc. The gaps between houses are as cheap as open ground, and towns sit on the flattest terrain, so trunks cut straight across towns.
- **Connectors**: `routeToNetwork` from `Settlement.x/y` (the town plaza, the farm centre, beside the airfield hangars, behind the port sheds, a dam abutment) to the cheapest reachable used cell, within `ROAD_SETTLEMENT_REACH`. From the plaza that means driving out through houses. Power lines and oil fields get none.
- **Town streets** (`townStreets`) are generated after routing, from `Settlement.grid`. Routing never sees them.
- **Smoothing** (`RoadGrid.toNodes`): Douglas–Peucker, then 3× Chaikin, with only bridge (wet) points pinned.

## Design

### 1. Settlements declare their road layout

New on `Settlement` (`worldgen/settlements.ts`), built by each `place*` alongside its buildings:

```ts
interface SettlementRoads {
  /** Area no road may cross except along `streets` (world): the placement zone, kept. */
  zone: { x: number; y: number; r: number };
  /** Internal roads: `main` streets carry through traffic, the rest only reach buildings. */
  streets: { nodes: { x: number; y: number }[]; width: number; main: boolean }[];
  /** Where main streets leave the zone (world), with the outward heading. */
  gates: { x: number; y: number; dir: number }[];
}
// Settlement.roads?: SettlementRoads   (replaces Settlement.grid; townStreets moves into placeTown)
```

Per kind:

| Kind | Main streets | Gates | Local streets |
|---|---|---|---|
| Town | the two street lines either side of the plaza, on both axes: a ring around the plaza with 4 arms out to the edge | the arm ends (up to 8, wet ones dropped) | the rest of today's grid, clipped to dry land |
| Airfield | a service road parallel to the runway on the hangar side | both ends | a stub to the helipad |
| Farm | the empty middle row (gv = 0, where the house and silo sit) | both ends | none |
| Dam | the dam crest, abutment to abutment | one per bank | none |
| Port | none (dead end) | 1, on the land side behind the sheds | a lane to the pier root |
| Oil field / power line | none | none | none |

Gates sit just outside the zone edge so a route can start or end there on open ground.

### 2. The road grid respects zones

`RoadGrid` gains:
- `zone: Uint8Array`: cells inside any settlement zone are **impassable** (the search skips them).
- `owner: Int16Array`: which settlement a stamped street cell belongs to (−1 none).
- `stampStreet(nodes, owner)`: rasterises a **main** street into cells, clears `zone` on them and marks them `used`, so they cost like existing road (`ROAD_REUSE`). Local streets aren't stamped; they're drawn only.

`makeRoads` stamps every settlement's main streets **before** the trunks. The trunk A* is unchanged: a zone is now a wall with cheap streets through it, so a trunk goes around a settlement or threads its main street, whichever costs less. Because existing road is discounted, a town near a trunk's line pulls the trunk through its high street.

### 3. Connectors from gates

After the trunks, a settlement whose stamped cells no trunk used gets a connector:
- `routeToNetwork` from each of its gates (multi-source: all gates seeded at cost 0). It stops at the first `used` cell whose `owner` is not this settlement, so its own streets don't count as reaching the network. The network can be any trunk, bridge, spur or another settlement's main street.
- Same `ROAD_SETTLEMENT_REACH` cap as today; out of reach → no road (as now).
- The gate is joined to the main streets inside the zone already, so the settlement is connected.

Spur roads (lookouts, AA towers, heli pads) are unchanged; they can't enter zones either.

### 4. Streets keep their shape

A trunk riding a main street must follow the street line, not cell centres (up to half a road cell off), and must not be rounded into the houses.
- `RoadNode` gains `pin?: true`. In `toNodes`, cells with an `owner` are replaced by their projection onto that settlement's street polyline, then marked pinned.
- `simplifyRoad` always keeps pinned points; the Chaikin pass skips a segment whose either end is pinned (as it already does for wet points).

### 5. Drawing

- A trunk along a main street draws at trunk width over the street: a wider "high street".
- Local and unused main streets draw at street width (`STREET_WIDTH`), as `townStreets` does today.
- Bridges are unchanged. `placeBridges` reads road nodes as before, and a connector leaving a gate over water still becomes a bridge.

### Order after the change

forces + HV → `placeSettlements` (now with `roads`) → `makeRoads`: stamp main streets → trunks → gate connectors → spurs → collect all settlement streets as `Road`s → `placeBridges`.

## Decisions (recommended defaults, revisit when implementing)

1. **Dam crossings:** trunks may cross rivers over the dam crest (gates on both banks). Recommended: yes; it's free once the dam has gates.
2. **Town through-traffic:** the plaza ring + 4 arms only (straight, readable routes) rather than the whole grid (zig-zag). Recommended: ring only.
3. **Seeds:** every seed's road layout changes (bridges, and units on them, move with it). Accepted; no migration.

## Edge cases

- **HV / spawn near a zone:** placement already keeps zones 120 texels from them, so trunk endpoints are never inside a zone.
- **Gate in water or on a cliff:** drop gates that aren't buildable at placement; a settlement with no usable gate gets no connector (logged in dev).
- **Trunk endpoints separated by a settlement:** the trunk goes around or through by cost; a zone can't make a pair of HVs unreachable because zones are discs with open ground around them.
- **Overlapping zones:** placement keeps zones disjoint (`clear`), so cells have a single owner.
- **Partially wet zones (ports, dams):** wet zone cells stay impassable; the pier and dam crest are the only ways across.

## Files

- `worldgen/settlements.ts`: `SettlementRoads` on `Settlement`; each `place*` builds streets + gates; `townStreets` logic moves into `placeTown`; `Settlement.grid` removed.
- `worldgen/world.ts`: `RoadGrid` (`zone`, `owner`, `stampStreet`, owner-aware `routeToNetwork` with multi-source gates, pinned projection in `toNodes`); `makeRoads` order; `simplifyRoad` / Chaikin keep pinned points; `townStreets` removed.
- `docs/navigation.md`: the "bridges come from roads" paragraph (gates, high streets).

## Verification

- Debug paint (`paintRoadNodesDebug`): zones, gates, main vs local streets, pinned nodes.
- Headless check over ~10 seeds per theme: no unpinned road node inside any zone; every settlement with a usable gate is connected or past reach; no trunk node under a building footprint.
- In-game look at a town, an airfield and a farm on a couple of seeds; bridges still placed and drivable.
- World-gen time before / after (should stay within noise: same A*, extra stamping is one pass per settlement).
