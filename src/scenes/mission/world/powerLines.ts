import Phaser from "phaser";
import { heightOf, type EnergyTrailNode, type Unit } from "../../../sim/combat";
import { specOf } from "../../../sim/roster";
import { craftRotorDrawSpan } from "../../../sim/crafts";
import { cameraPointVisible, worldToScreen, type ScreenPos } from "../../../worldgen/world";
import { worldDepth, ZOff } from "../../../render/depth";
import { range } from "../../../util/rng";
import { ENVIRONMENT } from "../../../sim/stats";
import type { MissionScene } from "../../missionScene";

/** Wire sag at mid-span (world z). */
const SAG = 10;
/** Points per wire span. */
const SPAN_SEGS = 8;
/** Cross-arm tips carry the wires, this far out along the arm (fraction of half-length). */
const ARM_TIP = 0.85;
/** Power station gantry: wires attach this far either side of centre. */
const STATION_TIP = 14;
const WIRE_COLOR = 0x26241f;
/** Short run: steps along the wire and ms between them (~0.1s end to end). */
const SHORT_STEPS = 10;
const SHORT_STEP_MS = 10;
/** Wire strike damage, as a fraction of the craft's max health. */
const WIRE_STRIKE_DMG = 0.03;
/** Scratch projection point (no per-frame allocation). */
const P: ScreenPos = { x: 0, y: 0, scale: 1 };
const W = { x: 0, y: 0, z: 0 };

interface Span {
  a: Unit;
  b: Unit;
  cut: boolean;
}

interface Line {
  nodes: Unit[];
  spans: Span[];
  /** Unit vector across the line (wire spacing direction). */
  px: number;
  py: number;
}

/**
 * Power lines: sagging wires from each power station out along its pylons. Wires can't be shot; they short out
 * (zap run to the neighbours) when a pylon / station dies, and a heli's rotors snap any span they touch.
 */
export class PowerLines {
  private gfx!: Phaser.GameObjects.Graphics;
  private lines: Line[] = [];
  /** Nodes already handled as dead (so each death shorts once). */
  private downed = new Set<Unit>();

  constructor(readonly s: MissionScene) {}

  reset(): void {
    this.lines = [];
    this.downed = new Set();
  }

  /** After units spawn: each line's station + pylons matched to their units, in order. */
  create(): void {
    this.gfx = this.s.add.graphics();
    const at = (kind: string, x: number, y: number) => this.s.units.find((u) => u.kind === kind && u.x === x && u.y === y);
    for (const st of this.s.world.settlements) {
      if (st.kind !== "powerline") continue;
      const nodes = st.parts.map((p) => at("pylon", p.x, p.y)).filter((u): u is Unit => !!u);
      const from = st.source && at("power_station", st.source.x, st.source.y);
      const to = st.target && at("power_station", st.target.x, st.target.y);
      if (from) nodes.unshift(from);
      if (to) nodes.push(to);
      if (nodes.length < 2) continue;
      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      const ang = Math.atan2(last.y - first.y, last.x - first.x);
      const spans: Span[] = [];
      for (let i = 1; i < nodes.length; i++) spans.push({ a: nodes[i - 1]!, b: nodes[i]!, cut: false });
      this.lines.push({ nodes, spans, px: -Math.sin(ang), py: Math.cos(ang) });
    }
  }

  /** Per frame: deaths short their spans, rotors snap wires, then draw. */
  update(): void {
    for (const line of this.lines) {
      for (const n of line.nodes) {
        if (!n.dead || this.downed.has(n)) continue;
        this.downed.add(n);
        for (const sp of line.spans) {
          if (sp.cut || (sp.a !== n && sp.b !== n)) continue;
          sp.cut = true;
          this.shortSpan(line, sp, sp.a === n ? 0 : 1);
        }
      }
    }
    this.rotorStrikes();
    this.draw();
  }

  /** World point on one wire (side ±1) at `t` (0 = a, 1 = b), into `W`. */
  private wirePoint(line: Line, sp: Span, side: number, t: number): typeof W {
    const ra = this.tipReach(sp.a) * side;
    const rb = this.tipReach(sp.b) * side;
    const ax = sp.a.x + line.px * ra;
    const ay = sp.a.y + line.py * ra;
    const bx = sp.b.x + line.px * rb;
    const by = sp.b.y + line.py * rb;
    const za = sp.a.z + heightOf(sp.a.kind);
    const zb = sp.b.z + heightOf(sp.b.kind);
    W.x = ax + (bx - ax) * t;
    W.y = ay + (by - ay) * t;
    W.z = za + (zb - za) * t - SAG * 4 * t * (1 - t);
    return W;
  }

  private tipReach(u: Unit): number {
    return u.kind === "pylon" ? specOf(u.kind).box!.halfL * ARM_TIP : STATION_TIP;
  }

  /** Fast zap run along both wires from `from` (0 = a end, 1 = b end), with a fading energy ribbon. */
  private shortSpan(line: Line, sp: Span, from: number, startT = from): void {
    const dir = from === 0 ? 1 : -1;
    const span = Math.abs((from === 0 ? 1 : 0) - startT);
    for (let side = -1; side <= 1; side += 2) {
      const ribbon: EnergyTrailNode[] = [];
      for (let k = 0; k <= SHORT_STEPS; k++) {
        const t = startT + dir * span * (k / SHORT_STEPS);
        const p = this.wirePoint(line, sp, side, t);
        // Nodes near the start fade first, so the ribbon reads as a run toward the far end.
        const life = 0.2 + (k / SHORT_STEPS) * 0.35;
        ribbon.push({ x: p.x, y: p.y, z: p.z, bx: 0, by: 0, bz: 0, life, max: 0.55 });
        const x = p.x;
        const y = p.y;
        const z = p.z;
        this.s.time.delayedCall(k * SHORT_STEP_MS, () => {
          this.s.tesla.spawnZap(x + range(-8, 8), y + range(-8, 8), z + range(-6, 6), range(1.1, 1.8), range(0.7, 1.2));
          this.s.tesla.spawnZap(x + range(-12, 12), y + range(-12, 12), z + range(-8, 8), range(0.8, 1.3), range(0.5, 0.9));
          this.s.tesla.emitSparks(x, y, z, 9, 1.3);
        });
      }
      this.s.trails.lingerEnergy(ribbon);
    }
  }

  /** Heli rotors snap any intact span they touch; the short runs out both ways from the strike. */
  private rotorStrikes(): void {
    const h = this.s.player;
    if (h.phase !== "flight" || h.spec.flightModel !== "heli") return;
    // Any overlap with the craft: within the rotor disc, between hull bottom and rotor top.
    const reach = craftRotorDrawSpan(h.spec) / 2;
    const zLo = h.z;
    const zHi = h.z + h.spec.height;
    for (const line of this.lines) {
      for (const sp of line.spans) {
        if (sp.cut || sp.a.dead || sp.b.dead) continue;
        // Cheap reject: rotor disc vs the span's bounding box.
        const pad = reach + 60;
        const minX = Math.min(sp.a.x, sp.b.x) - pad;
        const maxX = Math.max(sp.a.x, sp.b.x) + pad;
        const minY = Math.min(sp.a.y, sp.b.y) - pad;
        const maxY = Math.max(sp.a.y, sp.b.y) + pad;
        if (h.x < minX || h.x > maxX || h.y < minY || h.y > maxY) continue;
        const hitT = this.rotorHit(line, sp, h.x, h.y, zLo, zHi, reach);
        if (hitT == null) continue;
        sp.cut = true;
        this.shortSpan(line, sp, 0, hitT);
        this.shortSpan(line, sp, 1, hitT);
        const p = this.wirePoint(line, sp, 1, hitT);
        const at = worldToScreen(p.x, p.y, p.z);
        this.s.fx.spawnImpactFlash(at.x, at.y, p.z, 0xc8f0ff, 70 * at.scale, 0.9, 160);
        this.joltCraft();
      }
    }
  }

  /** Wire strike on the player: small damage, zaps and sparks over the hull, electric screen flash. */
  private joltCraft(): void {
    const h = this.s.player;
    this.s.stats.hostHit({ enemy: ENVIRONMENT, weapon: "power_line" }, () => h.damage(h.spec.health * WIRE_STRIKE_DMG));
    for (let k = 0; k < 4; k++) {
      this.s.time.delayedCall(k * 45, () => {
        const r = h.spec.radius;
        this.s.tesla.spawnZap(h.x + range(-r, r), h.y + range(-r, r), h.z + range(0, h.spec.height), range(0.7, 1.15), range(0.6, 1));
        this.s.tesla.emitSparks(h.x, h.y, h.z + h.spec.height * 0.5, 7, 0.9);
      });
    }
    this.s.statusHud.jolt();
    this.s.camera.shake = Math.min(10, this.s.camera.shake + 1.5);
  }

  /** `t` along the span where a wire passes within the rotor disc, else undefined. */
  private rotorHit(line: Line, sp: Span, x: number, y: number, zLo: number, zHi: number, reach: number): number | undefined {
    for (let side = -1; side <= 1; side += 2) {
      for (let k = 0; k <= SPAN_SEGS * 2; k++) {
        const t = k / (SPAN_SEGS * 2);
        const p = this.wirePoint(line, sp, side, t);
        if (p.z >= zLo && p.z <= zHi && Math.hypot(p.x - x, p.y - y) < reach) return t;
      }
    }
    return undefined;
  }

  private draw(): void {
    const g = this.gfx;
    g.clear();
    if (!this.lines.length || this.s.camera.mapWorldHidden) return;
    let zSum = 0;
    let zN = 0;
    for (const line of this.lines) {
      for (const sp of line.spans) {
        if (sp.cut || sp.a.dead || sp.b.dead) continue;
        const za = sp.a.z + heightOf(sp.a.kind);
        const zb = sp.b.z + heightOf(sp.b.kind);
        if (!cameraPointVisible(za, sp.a.y) && !cameraPointVisible(zb, sp.b.y)) continue;
        if (!onScreen(this.s, sp.a.x, sp.a.y, za) && !onScreen(this.s, sp.b.x, sp.b.y, zb)) continue;
        zSum += za + zb;
        zN += 2;
        for (let side = -1; side <= 1; side += 2) {
          const p0 = this.wirePoint(line, sp, side, 0);
          worldToScreen(p0.x, p0.y, p0.z, P);
          g.lineStyle(Math.max(0.6, P.scale * 1.1), WIRE_COLOR, 0.85);
          g.beginPath();
          g.moveTo(P.x, P.y);
          for (let k = 1; k <= SPAN_SEGS; k++) {
            const p = this.wirePoint(line, sp, side, k / SPAN_SEGS);
            worldToScreen(p.x, p.y, p.z, P);
            g.lineTo(P.x, P.y);
          }
          g.strokePath();
        }
      }
    }
    if (zN) g.setDepth(worldDepth(zSum / zN, ZOff.rotor));
  }
}

function onScreen(s: MissionScene, x: number, y: number, z: number): boolean {
  worldToScreen(x, y, z, P);
  const v = s.cameras.main.worldView;
  return P.x > v.x - 200 && P.x < v.right + 200 && P.y > v.y - 200 && P.y < v.bottom + 200;
}
