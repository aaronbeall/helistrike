import type { Unit } from "../../../sim/combat";
import { isNeutral, type UnitKind } from "../../../sim/roster";
import { kindEngageReach, remoteTargetable } from "../../../sim/targetRules";
import { Camera25D } from "../../../worldgen/world";
import { VIEW_PAD } from "../camera/camera";
import type { MissionScene } from "../../missionScene";

/** Far units update every Nth frame with the summed dt (staggered by index). */
const LOD_EVERY = 4;
/** ...or sooner once this much time has built up (low frame rates). */
const LOD_MAX_DT = 0.1;
/** Slack past a unit's reach and past the padded view before it counts as far. */
const LOD_MARGIN = 300;

/** Far-unit sim LOD: units off screen and out of every target's reach update at a reduced rate. */
export class UnitLod {
  /** Debug toggle. */
  on = true;
  /** Last frame: units updated at full rate, far units skipped, far units ticked. */
  stats = { full: 0, skipped: 0, ticked: 0 };
  /** Unticked time per `s.units` index. */
  private acc = new Float64Array(0);
  private frame = 0;
  private reachByKind = new Map<UnitKind, number>();
  private viewR2 = 0;
  /** This frame's targets, flat: x, y, aware mul. */
  private targets: number[] = [];

  constructor(readonly s: MissionScene) {}

  reset(): void {
    this.on = true;
    this.acc = new Float64Array(0);
    this.frame = 0;
  }

  setOn(on: boolean): void {
    this.on = on;
    this.s.debugMenu.sync();
  }

  /** Once per sim frame, before `step`. */
  prepare(unitCount: number): void {
    if (this.acc.length < unitCount) {
      const g = new Float64Array(Math.max(unitCount, this.acc.length * 2));
      g.set(this.acc);
      this.acc = g;
    }
    const st = this.stats;
    st.full = st.skipped = st.ticked = 0;
    this.frame++;
    if (!this.on) return;
    const r = this.s.camera.viewGroundRadius(VIEW_PAD) + LOD_MARGIN;
    this.viewR2 = r * r;
    const t = this.targets;
    t.length = 0;
    t.push(this.s.player.x, this.s.player.y, this.s.targeting.targetAwareMul(this.s.player));
    // Spec mul is the upper bound (autonomous remotes are scaled down from it).
    for (const rem of this.s.remotes) if (remoteTargetable(rem)) t.push(rem.x, rem.y, rem.spec.enemyAwareMul ?? 1);
  }

  /** dt to update unit `i` with now (including skipped time), or null to skip it this frame. */
  step(i: number, u: Unit, dt: number): number | null {
    const acc = this.acc[i]! + dt;
    if (this.on && !u.dead && !isNeutral(u.kind)) {
      if (this.isFar(u)) {
        if ((this.frame + i) % LOD_EVERY !== 0 && acc < LOD_MAX_DT) {
          this.acc[i] = acc;
          this.stats.skipped++;
          return null;
        }
        this.stats.ticked++;
      } else this.stats.full++;
    }
    this.acc[i] = 0;
    return acc;
  }

  /** Off screen and out of sight / weapon reach of every target. */
  private isFar(u: Unit): boolean {
    const fx = u.x - Camera25D.focusX;
    const fy = u.y - Camera25D.focusY;
    if (fx * fx + fy * fy < this.viewR2) return false;
    let reach = this.reachByKind.get(u.kind);
    if (reach == null) {
      reach = kindEngageReach(u.kind);
      this.reachByKind.set(u.kind, reach);
    }
    const t = this.targets;
    for (let k = 0; k < t.length; k += 3) {
      const r = reach * t[k + 2]! + LOD_MARGIN;
      const dx = u.x - t[k]!;
      const dy = u.y - t[k + 1]!;
      if (dx * dx + dy * dy < r * r) return false;
    }
    return true;
  }
}
