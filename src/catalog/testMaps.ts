/** Dev test maps: fixed seed + map + craft, optional test cluster (launch with `?test=<id>`; perf runner scenarios use these). */
import type { CraftKind } from "../sim/crafts";
import type { MissionKind, MissionSpec } from "../sim/mission";
import type { UnitKind } from "../sim/roster";

/** Units replacing the map's patrols / garrisons (objectives stay), `distance` ahead of the spawn. */
export interface TestCluster {
  distance: number;
  radius: number;
  units: { kind: UnitKind; count: number }[];
}

export interface TestMap {
  id: string;
  label: string;
  mission: MissionKind;
  seed: number;
  profile?: Partial<MissionSpec["profile"]>;
  craft: CraftKind;
  /** Replace the generated forces (objectives kept): "none" or a cluster. Omit to keep them. */
  forces?: TestCluster | "none";
}

/** Mixed armor + infantry block for combat load tests. */
export const TEST_CLUSTER_120: TestCluster = {
  distance: 460,
  radius: 300,
  units: [
    { kind: "soldier", count: 40 },
    { kind: "rpg", count: 15 },
    { kind: "gunner", count: 10 },
    { kind: "tank", count: 20 },
    { kind: "truck", count: 10 },
    { kind: "lav", count: 10 },
    { kind: "lav_aa", count: 5 },
    { kind: "mounted_mg", count: 10 },
  ],
};

const DESERT = { mission: "desert_flats", seed: 1337, profile: { settlement: 0 }, craft: "apache" } as const;

export const TEST_MAPS: TestMap[] = [
  { ...DESERT, id: "desert_empty", label: "Desert, no forces", forces: "none" },
  { ...DESERT, id: "desert_cluster", label: "Desert, 120-unit cluster ahead", forces: TEST_CLUSTER_120 },
  { ...DESERT, id: "desert_cluster_cyber", label: "Desert cluster, CyberHawk (Starscream, Tesla)", craft: "cyberhawk", forces: TEST_CLUSTER_120 },
  { ...DESERT, id: "desert_cluster_cobra", label: "Desert cluster, Cobra (TOW)", craft: "cobra", forces: TEST_CLUSTER_120 },
  { id: "river_run", label: "River Run, generated forces + settlements", mission: "river_run", seed: 4242, craft: "apache" },
  {
    id: "river_run_s0",
    label: "River Run, generated forces, no settlements",
    mission: "river_run",
    seed: 4242,
    profile: { settlement: 0 },
    craft: "apache",
  },
];
