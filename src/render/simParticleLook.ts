/** Sim (debris dust / blood) particle texture + tint. */
import { type SimParticleKind } from "../sim/combat";
import { type Biome } from "../worldgen/world";

export function simParticleTexKey(kind: SimParticleKind): string {
  return `fx_${kind}`;
}

export function simParticleLook(_kind: SimParticleKind, biome: Biome, blood = false): { tint: number; add: boolean } {
  if (blood) {
    const pal = [0xee2828, 0xdd2020, 0xe83838, 0xcc1a1a, 0xf04040];
    return { tint: pal[(Math.random() * pal.length) | 0]!, add: false };
  }
  const dirt: Record<Biome, number[]> = {
    water: [0x3a3a32, 0x2a2c28],
    river: [0x4a4638, 0x2e322c],
    sand: [0xc4a06a, 0x8a6a40, 0x3a3228],
    grass: [0x6b5a32, 0x4a3c24, 0x2a2418],
    forest: [0x3d3a28, 0x2a281c, 0x1a1810],
    rock: [0x6a6860, 0x4a4844, 0x2c2c28],
    peak: [0x9a9890, 0x6e6c66, 0x3a3a38],
  };
  const pal = dirt[biome];
  return { tint: pal[(Math.random() * pal.length) | 0]!, add: false };
}

/** Rotor-wash spray over water: white / pale blue-grey mist. */
export function mistLook(): { tint: number; add: boolean } {
  const pal = [0xf4f8f8, 0xe2eaee, 0xccd8de];
  return { tint: pal[(Math.random() * pal.length) | 0]!, add: false };
}
