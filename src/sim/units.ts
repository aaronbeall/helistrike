import { mountAt } from "../render/spritePose";
import Phaser from "phaser";
import { camoForBiome, resolveSkin } from "../render/camo";
import { nextId, stats, textureOf, type Unit } from "./combat";
import { specOf, spawnAngle, pickTroop, gunsOf, rollParts, crewOf } from "./roster";
import { groundZ, sampleBiome, type WorldData } from "../worldgen/world";
import { isUnitStructure } from "../worldgen/settlements";
import { CRUISE_AGL } from "./craft";

export function makeUnit(world: WorldData, kind: Unit["kind"], x: number, y: number, pinId?: number, pinMount?: number): Unit {
  const st = stats(kind);
  const sp = specOf(kind);
  const parts = rollParts(kind);
  const guns = gunsOf({ kind, parts });
  const ang = spawnAngle(kind);
  return {
    id: nextId(),
    kind,
    x,
    y,
    z: sp.aerial ? groundZ(world, x, y) + CRUISE_AGL : groundZ(world, x, y),
    vx: 0,
    vy: 0,
    angle: ang,
    turret: ang,
    health: st.health,
    max: st.health,
    dead: false,
    fireCd: Math.random(),
    burstLeft: 0,
    orbit: Math.random() * Math.PI * 2,
    rotor: 0,
    track: 0,
    turrets: guns.map(() => Math.random() * Math.PI * 2),
    muzzleT: 0,
    muzzleGun: 0,
    muzzleTip: 0,
    pinId,
    pinMount,
    parts,
    camo: specOf(kind).forcedCamo ?? camoForBiome(sampleBiome(world, x, y)),
  };
}

/** Neutral civilian buildings from the world's settlements, facing their layout. */
export function makeSettlementUnits(world: WorldData): Unit[] {
  const out: Unit[] = [];
  for (const st of world.settlements) {
    for (const p of st.parts) {
      if (!isUnitStructure(p.kind)) continue;
      const u = makeUnit(world, p.kind, p.x, p.y);
      u.angle = u.turret = p.rot;
      if (p.z != null) u.z = p.z;
      u.camo = undefined;
      out.push(u);
    }
  }
  return out;
}

/** Spawn pinned crew from host UnitSpec.crew (any kind with seats). */
export function spawnCrewFor(world: WorldData, textures: Phaser.Textures.TextureManager, host: Unit): Unit[] {
  const crew = crewOf(host.kind);
  if (!crew?.mounts.length) return [];
  const tex = resolveSkin(textures, textureOf(host.kind), host.camo);
  const chance = crew.chance ?? 1;
  const out: Unit[] = [];
  for (let i = 0; i < crew.mounts.length; i++) {
    if (Math.random() >= chance) continue;
    const m = crew.mounts[i]!;
    const at = mountAt(textures, host, tex, m);
    out.push(makeUnit(world, pickTroop(), at.x, at.y, host.id, i));
  }
  return out;
}

export function rollSoldierMood(u: Unit, flee: boolean): void {
  if (u.health <= 1 && u.health < u.max) {
    u.aiMood = undefined;
    return;
  }
  if (flee || u.health < u.max) {
    u.aiMood = "flee";
    u.moodT = 2.8 + Math.random() * 1.8;
    u.burstLeft = 0;
  } else {
    u.aiMood = "kite";
    u.moodT = 10 + Math.random() * 8;
  }
}
