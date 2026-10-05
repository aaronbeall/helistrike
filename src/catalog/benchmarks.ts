/** Hidden performance test scenarios (run with `?bench=all` or `?bench=<id>,<id>`). */
import type { CraftKind } from "../sim/crafts";
import type { MissionKind, MissionSpec } from "../sim/mission";
import type { UnitKind } from "../sim/roster";

export interface BenchCluster {
  /** Cluster centre distance from the player spawn (world units). */
  distance: number;
  /** Spread radius around the centre. */
  radius: number;
  units: { kind: UnitKind; count: number }[];
}

export interface BenchScenario {
  id: string;
  label: string;
  /** Base mission (theme + profile). */
  mission: MissionKind;
  seed: number;
  profile?: Partial<MissionSpec["profile"]>;
  craft: CraftKind;
  /** Replace the map's forces with this cluster ahead of the player; omit to keep the generated forces. */
  cluster?: BenchCluster | "none";
  /** Hold fire on loadout `slot` for `onS`, release for `offS`, repeating. */
  fire?: { slot: number; onS: number; offS: number };
  warmupS: number;
  measureS: number;
}

const CLUSTER_120: BenchCluster = {
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

const SYNTHETIC = { mission: "desert_flats", seed: 1337, profile: { settlement: 0 }, craft: "apache", warmupS: 3, measureS: 20 } as const;
const GUN = { slot: 0, onS: 3, offS: 1 };
const ROCKETS = { slot: 1, onS: 1.5, offS: 0.5 };

export const BENCH_SCENARIOS: BenchScenario[] = [
  { ...SYNTHETIC, id: "idle_empty", label: "Idle, no units", cluster: "none" },
  { ...SYNTHETIC, id: "gun_empty", label: "Chain gun into empty ground", cluster: "none", fire: GUN },
  { ...SYNTHETIC, id: "rockets_empty", label: "Rockets into empty ground", cluster: "none", fire: ROCKETS },
  { ...SYNTHETIC, id: "idle_cluster", label: "Idle, 120-unit cluster", cluster: CLUSTER_120 },
  { ...SYNTHETIC, id: "gun_cluster", label: "Chain gun into 120-unit cluster", cluster: CLUSTER_120, fire: GUN },
  { ...SYNTHETIC, id: "rockets_cluster", label: "Rockets into 120-unit cluster", cluster: CLUSTER_120, fire: ROCKETS },
  { id: "mission_idle", label: "River Run, generated forces + settlements", mission: "river_run", seed: 4242, craft: "apache", warmupS: 3, measureS: 20 },
  {
    id: "mission_idle_s0",
    label: "River Run, generated forces, no settlements",
    mission: "river_run",
    seed: 4242,
    profile: { settlement: 0 },
    craft: "apache",
    warmupS: 3,
    measureS: 20,
  },
];
