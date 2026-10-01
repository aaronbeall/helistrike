import Phaser from "phaser";
import { payloadIsRemote } from "../../sim/payload";
import { remoteSpecOf, type BayRemote, type RemoteCraft, type RemoteSpec } from "../../sim/remote";
import { craftSocketStartingAmmo } from "../../sim/crafts";
import type { MissionScene } from "../missionScene";

/** Launch order: most battery first, then most health. */
function bayRemoteRank(a: BayRemote, b: BayRemote): number {
  return b.life - a.life || b.health - a.health;
}

/** Docked remote pools per loadout slot: stow, launch pick, recharge/repair, pooled HUD stats. */
export class RemoteBay {
  /** Per-slot docked dockable remotes (life/health), kept in step with `ammo`. */
  bayRemotes: BayRemote[][] = [];

  constructor(readonly s: MissionScene) {}

  /** Per-mission state reset (called from the scene's init). */
  reset(): void {
    this.bayRemotes = this.s.loadout.map(() => []);
  }

  /**
   * Ammo shown for a host remote slot: hangar reserve + live craft.
   * Dockable remotes (Skiffs) stay "available" while airborne or mid-dock
   * (refund happens on bay arrival); count drops only when lost.
   */
  remotePoolDisplayAmmo(slot: number, reserve: number): number {
    if (this.s.debugMenu.infAmmo || !Number.isFinite(reserve)) return reserve;
    const wp = this.s.loadout[slot];
    if (!payloadIsRemote(wp?.payload)) return reserve;
    const kind = wp!.payload!.remote!.kind;
    if (!remoteSpecOf(kind).dockable) return reserve;
    let live = 0;
    for (const r of this.s.remotes) {
      if (r.detonate || r.spec.kind !== kind) continue;
      live++;
    }
    return reserve + live;
  }

  stowDockedRemote(r: RemoteCraft): void {
    for (let i = 0; i < this.s.loadout.length; i++) {
      const w = this.s.loadout[i]!;
      if (!payloadIsRemote(w.payload)) continue;
      if (w.payload!.remote!.kind !== r.spec.kind) continue;
      // Match hangar capacity (craft ammoScale / socket mul), not bare catalog ammo.
      const cap = craftSocketStartingAmmo(w.ammo, this.s.player.spec, i);
      if (!Number.isFinite(cap)) return;
      if ((this.s.ammo[i] ?? 0) < cap) {
        this.s.ammo[i] = (this.s.ammo[i] ?? 0) + 1;
        const roster = this.bayRemotes[i] ?? (this.bayRemotes[i] = []);
        roster.push({ life: Math.max(0, r.life), health: Math.max(0, r.health), ammo: r.ammo?.slice() });
        return;
      }
    }
  }

  /** Dockable remote spec launched from this.s loadout slot, if any. */
  dockableSlotRemote(slot: number): RemoteSpec | undefined {
    const kind = this.s.loadout[slot]?.payload?.remote?.kind;
    if (!kind) return undefined;
    const spec = remoteSpecOf(kind);
    return spec.dockable ? spec : undefined;
  }

  /** Bay roster for a dockable slot, padded with fresh remotes / trimmed to the hangar count. */
  bayRoster(slot: number): BayRemote[] {
    const roster = this.bayRemotes[slot] ?? (this.bayRemotes[slot] = []);
    const spec = this.dockableSlotRemote(slot);
    const n = this.s.ammo[slot] ?? 0;
    if (!spec || !Number.isFinite(n)) return roster;
    const lifeMax = this.s.loadout[slot]!.payload!.remote!.duration;
    while (roster.length < n) roster.push({ life: lifeMax, health: spec.health });
    if (roster.length > n) {
      roster.sort(bayRemoteRank);
      roster.length = Math.max(0, n);
    }
    return roster;
  }

  /** Pull the best docked remote (life first, then health) for launch. */
  takeBayRemote(slot: number): BayRemote | undefined {
    const roster = this.bayRemotes[slot];
    if (!roster?.length) return undefined;
    roster.sort(bayRemoteRank);
    return roster.shift();
  }

  /** Docked remotes recharge battery and slowly repair up to their spec cap. */
  tickBayRemotes(dt: number): void {
    for (let i = 0; i < this.s.loadout.length; i++) {
      const spec = this.dockableSlotRemote(i);
      if (!spec) continue;
      const lifeMax = this.s.loadout[i]!.payload!.remote!.duration;
      const repairCap = spec.health * spec.dockRepairMax;
      for (const b of this.bayRoster(i)) {
        b.life = Math.min(lifeMax, b.life + (lifeMax / Math.max(0.1, spec.dockRechargeTime)) * dt);
        if (b.health < repairCap) {
          b.health = Math.min(repairCap, b.health + spec.health * spec.dockRepairRate * dt);
        }
      }
    }
  }

  /** Battery fraction of a dockable slot's pool (bay + live); undefined if none or unlimited. */
  remotePoolBattery(slot: number): number | undefined {
    const spec = this.dockableSlotRemote(slot);
    if (!spec || spec.unlimitedLife) return undefined;
    const lifeMax = Math.max(0.1, this.s.loadout[slot]!.payload!.remote!.duration);
    let sum = 0;
    let n = 0;
    for (const b of this.bayRoster(slot)) {
      sum += Phaser.Math.Clamp(b.life / lifeMax, 0, 1);
      n++;
    }
    for (const r of this.s.remotes) {
      if (r.detonate || r.spec.kind !== spec.kind) continue;
      sum += Phaser.Math.Clamp(r.life / lifeMax, 0, 1);
      n++;
    }
    return n ? sum / n : undefined;
  }

  /** Summed health fraction of a dockable slot's whole pool (bay + live, excluding lost). */
  remotePoolHealth(slot: number): number {
    const spec = this.dockableSlotRemote(slot);
    if (!spec) return 0;
    const max = Math.max(1, spec.health);
    let sum = 0;
    for (const b of this.bayRoster(slot)) sum += Phaser.Math.Clamp(b.health / max, 0, 1);
    for (const r of this.s.remotes) {
      if (r.detonate || r.spec.kind !== spec.kind) continue;
      sum += Phaser.Math.Clamp(r.health / max, 0, 1);
    }
    return sum;
  }
}
