import type { WorldGenProfile } from "../worldgen/world";
import { MISSIONS } from "../catalog/missions";

export type MissionKind = "river_run" | "island_chain" | "highland_siege" | "custom";

export interface MissionSpec {
  kind: MissionKind;
  label: string;
  briefing: string;
  profile: WorldGenProfile;
}

export { MISSIONS } from "../catalog/missions";

export const DEFAULT_MISSION: MissionKind = "river_run";

let selected: MissionKind = DEFAULT_MISSION;

export function selectMission(kind: MissionKind): void {
  selected = kind;
}

export function missionKind(): MissionKind {
  return selected;
}

export function missionOf(kind: MissionKind = selected): MissionSpec {
  return MISSIONS[kind];
}

export function allMissions(): MissionSpec[] {
  return Object.values(MISSIONS);
}
