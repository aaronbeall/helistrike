import type { WorldGenProfile } from "./world";

export type MissionKind = "river_run" | "island_chain" | "highland_siege" | "custom";

export interface MissionSpec {
  kind: MissionKind;
  label: string;
  briefing: string;
  profile: WorldGenProfile;
}

export const MISSIONS: Record<MissionKind, MissionSpec> = {
  river_run: {
    kind: "river_run",
    label: "RIVER RUN",
    briefing: "Balanced terrain · mixed armor, air defenses, and river patrols",
    profile: {
      id: "river_run",
      landBias: 0,
      relief: 1,
      edgeFalloff: 0.18,
      riverTarget: 50,
      objectiveCount: 4,
      garrisonScale: 1,
      patrolCount: 22,
      waterPatrolBias: 1,
      forceMix: "mixed",
    },
  },
  island_chain: {
    kind: "island_chain",
    label: "ISLAND CHAIN",
    briefing: "Open water · naval concentrations and exposed coastal objectives",
    profile: {
      id: "island_chain",
      landBias: -0.1,
      relief: 1.08,
      edgeFalloff: 0.42,
      riverTarget: 12,
      objectiveCount: 3,
      garrisonScale: 0.78,
      patrolCount: 30,
      waterPatrolBias: 2.4,
      forceMix: "naval",
    },
  },
  highland_siege: {
    kind: "highland_siege",
    label: "HIGHLAND SIEGE",
    briefing: "Broken high ground · dense fortified positions and heavy armor",
    profile: {
      id: "highland_siege",
      landBias: 0.08,
      relief: 1.32,
      edgeFalloff: 0.1,
      riverTarget: 18,
      objectiveCount: 5,
      garrisonScale: 1.3,
      patrolCount: 28,
      waterPatrolBias: 0.35,
      forceMix: "heavy",
    },
  },
  custom: {
    kind: "custom",
    label: "CUSTOM",
    briefing: "User-defined terrain, objectives, and force composition",
    profile: {
      id: "custom",
      landBias: 0,
      relief: 1,
      edgeFalloff: 0.18,
      riverTarget: 40,
      objectiveCount: 4,
      garrisonScale: 1,
      patrolCount: 22,
      waterPatrolBias: 1,
      forceMix: "mixed",
    },
  },
};

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
