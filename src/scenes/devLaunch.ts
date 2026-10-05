/**
 * Dev launch (dev builds only): boot straight into a mission from the URL, for repro and perf runs.
 *   ?test=desert_cluster                     a named test map (catalog/testMaps)
 *   ?mission=river_run&craft=apache&seed=42  any mission; &settlement=0 overrides that profile value
 *   &cheats=ammo,god                         debug-menu infinite ammo / no damage
 */
import type Phaser from "phaser";
import { MISSIONS } from "../catalog/missions";
import { CRAFTS } from "../catalog/crafts";
import { TEST_MAPS, type TestCluster, type TestMap } from "../catalog/testMaps";
import { selectCraft, type CraftKind } from "../sim/crafts";
import { selectMission, type MissionKind } from "../sim/mission";
import type { UnitKind } from "../sim/roster";
import { Rng } from "../util/rng";
import { isWater, WORLD, type WorldData } from "../worldgen/world";

export interface DevLaunch {
  mission: MissionKind;
  craft: CraftKind;
  seed?: number;
  profile?: TestMap["profile"];
  forces?: TestMap["forces"];
  cheats: { ammo: boolean; god: boolean };
}

/** Launch from the URL, if it asks for one (dev builds only). */
export function devLaunchFromUrl(): DevLaunch | undefined {
  if (!import.meta.env.DEV) return undefined;
  const q = new URLSearchParams(globalThis.location?.search ?? "");
  const cheats = new Set((q.get("cheats") ?? "").split(","));
  const flags = { ammo: cheats.has("ammo"), god: cheats.has("god") };
  const test = TEST_MAPS.find((t) => t.id === q.get("test"));
  if (test) return { ...testMapLaunch(test), cheats: flags };
  const mission = q.get("mission");
  if (!mission || !(mission in MISSIONS)) return undefined;
  const craft = q.get("craft");
  const seed = q.get("seed");
  const settlement = q.get("settlement");
  return {
    mission: mission as MissionKind,
    craft: craft && craft in CRAFTS ? (craft as CraftKind) : "apache",
    seed: seed != null ? Number(seed) >>> 0 : undefined,
    profile: settlement != null ? { settlement: Number(settlement) } : undefined,
    cheats: flags,
  };
}

export function testMapLaunch(t: TestMap): DevLaunch {
  return { mission: t.mission, craft: t.craft, seed: t.seed, profile: t.profile, forces: t.forces, cheats: { ammo: false, god: false } };
}

/** Select the launch's craft + mission and load it. */
export function startDevLaunch(scene: Phaser.Scene, launch: DevLaunch): void {
  selectCraft(launch.craft);
  selectMission(launch.mission);
  scene.scene.start("load", { dev: launch });
}

/** Replace a freshly generated world's patrols and garrisons with the launch's forces; objectives stay. */
export function applyDevForces(world: WorldData, launch: DevLaunch): void {
  const forces = launch.forces;
  if (!forces) return;
  world.spawns = world.spawns.filter((s) => s.hv);
  if (forces === "none") return;
  placeCluster(world, forces, launch.seed ?? 1);
}

/** Cluster centre: `distance` from spawn toward the map centre. */
export function clusterCentre(world: WorldData, distance: number): { x: number; y: number } {
  const a = Math.atan2(WORLD / 2 - world.spawnY, WORLD / 2 - world.spawnX);
  return { x: world.spawnX + Math.cos(a) * distance, y: world.spawnY + Math.sin(a) * distance };
}

function placeCluster(world: WorldData, cluster: TestCluster, seed: number): void {
  const c = clusterCentre(world, cluster.distance);
  const kinds: UnitKind[] = [];
  for (const g of cluster.units) for (let i = 0; i < g.count; i++) kinds.push(g.kind);
  const rng = new Rng(seed);
  for (let i = kinds.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [kinds[i], kinds[j]] = [kinds[j]!, kinds[i]!];
  }
  // Golden-angle spiral: even, repeatable spread; dry spots only.
  for (let i = 0; i < kinds.length; i++) {
    const a = i * 2.39996;
    for (let k = 0; k < 8; k++) {
      const r = cluster.radius * Math.sqrt((i + 0.5) / kinds.length) + k * 30;
      const x = c.x + Math.cos(a) * r;
      const y = c.y + Math.sin(a) * r;
      if (isWater(world, x, y)) continue;
      world.spawns.push({ kind: kinds[i]!, x, y });
      break;
    }
  }
}
