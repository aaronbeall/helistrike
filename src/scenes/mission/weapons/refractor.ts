import Phaser from "phaser";
import { norm3, coneDir } from "../../../util/vec";
import { heightOf, type Unit, type PlayerWpnSpec } from "../../../sim/combat";
import { ZOff, worldDepth } from "../../../render/depth";
import { range } from "../../../util/rng";
import { circumRadiusOf, footprintInto, pointInFootprint } from "../../../render/footprint";
import { craftSocketPoints } from "../../../sim/crafts";
import { groundZ, worldToScreen } from "../../../worldgen/world";
import type { MissionScene } from "../../missionScene";

/** Refractor beam: ray cast with unit walk-hits, beam lifetimes, impacts, drawing. */
export class Refractor {
  /** Fading Refractor beam segments (solid glowy lines). */
  beams: {
    x0: number;
    y0: number;
    z0: number;
    x1: number;
    y1: number;
    z1: number;
    life: number;
    max: number;
    width: number;
    color: number;
  }[] = [];
  gfx!: Phaser.GameObjects.Graphics;

  constructor(readonly s: MissionScene) {}

  /** Per-mission state reset (called from the scene's init). */
  reset(): void {
    this.beams = [];
  }

  /** Refractor: primary beam to 30% of muzzle→aim, then a tight fan of reflecting child rays. */
  fire(
    slot: number,
    spec: PlayerWpnSpec,
    _ptr: { x: number; y: number },
    yawOff: number,
    barrelIndex = 0
  ): void {
    const h = this.s.player;
    const payload = spec.payload;
    if (spec.launch.mode !== "beam") return;
    const launch = spec.launch;
    const range = launch.mode === "beam" ? launch.range : 780;
    const socket = h.spec.sockets[slot]!;
    let tip: { x: number; y: number };
    let ang = h.angle + yawOff;
    if (socket.class === "hardpoint") {
      tip = this.s.hardpointPylon(slot, true);
    } else if (socket.class === "fixed") {
      const authored = craftSocketPoints(h.spec, socket);
      const uv =
        socket.muzzleFire === "alternate" && authored.length > 1
          ? authored[this.s.playerGunSide++ % authored.length]
          : authored[0];
      tip = uv ? this.s.craftBodyMountWorldPos(uv) : this.s.hardpointPylon(slot, true);
    } else {
      const gunI = this.s.gunVisualIndexForSlot(slot, barrelIndex);
      tip = this.s.gunTip(gunI);
      ang = h.stationAim[slot]?.[barrelIndex] ?? h.gunAngle;
    }
    const tipZ = h.z + ZOff.shot;
    const aim = this.s.playerSightAimWorld(tip.x, tip.y, tipZ, ang, this.s.reticleUnit());
    let dx = aim.x - tip.x;
    let dy = aim.y - tip.y;
    let dz = aim.z - tipZ;
    const len = Math.max(1e-3, Math.hypot(dx, dy, dz));
    dx /= len;
    dy /= len;
    dz /= len;
    const aimDist = Math.min(range, len);
    const bounces = payload.bounce ? payload.bounce.maxBounces ?? 3 : 0;
    const splitAt = payload.split?.at;
    const splitN = payload.split?.count ?? 0;
    const doSplit = splitAt != null && splitAt > 0 && splitAt < 1 && splitN >= 2;

    if (!doSplit) {
      this.castRay(tip.x, tip.y, tipZ, dx, dy, dz, range, bounces, spec, 1);
    } else {
      const splitDist = Math.max(36, aimDist * splitAt);
      // Primary stub has no bounce — unit/ground before the fork ends the shot.
      const end = this.castRay(
        tip.x,
        tip.y,
        tipZ,
        dx,
        dy,
        dz,
        splitDist,
        0,
        spec,
        1
      );
      if (end) {
        // Fork point: sparks only, strongly biased along the beam (no backsplash / fireball).
        this.s.emitVisualBurst(
          end.x,
          end.y,
          end.z,
          {
            n: 28,
            spdMin: 140,
            spdMax: 420,
            bx: dx,
            by: dy,
            bz: dz,
            tight: 0.88,
            scaleMul: 0.52,
            stretchMul: 2.35,
            coneHalf: 0.32,
          },
          this.s.teslaSparkBurst
        );
        this.s.emitVisualBurst(
          end.x,
          end.y,
          end.z,
          {
            n: 12,
            spdMin: 70,
            spdMax: 220,
            bx: dx,
            by: dy,
            bz: dz,
            tight: 0.72,
            scaleMul: 0.4,
            stretchMul: 1.85,
            coneHalf: 0.55,
          },
          this.s.teslaSparkBurst
        );
        const splitAt = worldToScreen(end.x, end.y, end.z);
        this.s.spawnImpactFlash(splitAt.x, splitAt.y, end.z, 0xc070ff, 48 * splitAt.scale, 0.55, 200);
        this.s.spawnImpactFlash(splitAt.x, splitAt.y, end.z, 0xf0d0ff, 22 * splitAt.scale, 0.85, 140);
        let ax = aim.x - end.x;
        let ay = aim.y - end.y;
        let az = aim.z - end.z;
        const al = Math.max(1e-3, Math.hypot(ax, ay, az));
        ax /= al;
        ay /= al;
        az /= al;
        const rem = Math.max(al, Math.max(80, range - splitDist));
        let ux = -ay;
        let uy = ax;
        let uz = 0;
        let ul = Math.hypot(ux, uy, uz);
        if (ul < 1e-4) {
          ux = 1;
          uy = 0;
          uz = 0;
        } else {
          ux /= ul;
          uy /= ul;
          uz /= ul;
        }
        let vx = ay * uz - az * uy;
        let vy = az * ux - ax * uz;
        let vz = ax * uy - ay * ux;
        const vl = Math.max(1e-3, Math.hypot(vx, vy, vz));
        vx /= vl;
        vy /= vl;
        vz /= vl;
        for (let i = 0; i < splitN; i++) {
          // Wide fan: one center ray + outer cone (~22° half-angle).
          const ring = i === 0 ? 0 : 0.4;
          const a = i === 0 ? 0 : ((i - 1) / Math.max(1, splitN - 1)) * Math.PI * 2;
          let rx = ax + (ux * Math.cos(a) + vx * Math.sin(a)) * ring;
          let ry = ay + (uy * Math.cos(a) + vy * Math.sin(a)) * ring;
          let rz = az + (uz * Math.cos(a) + vz * Math.sin(a)) * ring;
          const rn = Math.max(1e-3, Math.hypot(rx, ry, rz));
          this.castRay(
            end.x,
            end.y,
            end.z,
            rx / rn,
            ry / rn,
            rz / rn,
            rem,
            bounces,
            spec,
            i === 0 ? 0.7 : 0.38
          );
        }
      }
    }

    this.s.emitVisualBurst(
      tip.x,
      tip.y,
      tipZ,
      {
        n: 10,
        spdMin: 40,
        spdMax: 180,
        bx: dx,
        by: dy,
        bz: dz,
        tight: 0.75,
        scaleMul: 0.55,
        stretchMul: 1.8,
      },
      this.s.teslaSparkBurst
    );
  }

  /**
   * March a Refractor ray with ground reflection. Returns the endpoint if the full
   * `rangeLeft` cleared without a unit/ground stop (for mid-air forks).
   */
  castRay(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    rangeLeft: number,
    bouncesLeft: number,
    spec: PlayerWpnSpec,
    dmgMul: number
  ): { x: number; y: number; z: number } | null {
    const step = 14;
    let x = ox;
    let y = oy;
    let z = oz;
    let traveled = 0;
    const seg0 = { x, y, z };
    while (traveled < rangeLeft) {
      const nx = x + dx * step;
      const ny = y + dy * step;
      const nz = z + dz * step;
      const g0 = groundZ(this.s.world, x, y);
      const g1 = groundZ(this.s.world, nx, ny);
      const a0 = z - g0;
      const a1 = nz - g1;
      // Ground reflection.
      if (a0 > 1 && a1 <= 1) {
        const u = a0 / Math.max(1e-4, a0 - a1);
        const hx = x + (nx - x) * u;
        const hy = y + (ny - y) * u;
        const hz = g0 + (g1 - g0) * u;
        this.pushBeam(seg0.x, seg0.y, seg0.z, hx, hy, hz, spec, dmgMul);
        this.impact(hx, hy, hz, dx, dy, dz, spec, true);
        if (bouncesLeft <= 0) return null;
        // Bounce = refract: a few smaller beams fan in random directions off the hit.
        const rem = Math.max(70, rangeLeft - traveled);
        const base = norm3(dx, dy, Math.max(0.25, -dz * 0.92));
        const n = 3 + ((Math.random() * 2) | 0); // 3–4 shards
        for (let i = 0; i < n; i++) {
          const d = coneDir(base.x, base.y, base.z, 0.85, 1.6);
          // Keep shards above ground — never bury into the terrain.
          const up = Math.max(0.22, d.z);
          const rn = Math.max(1e-3, Math.hypot(d.x, d.y, up));
          const rx = d.x / rn;
          const ry = d.y / rn;
          const rz = up / rn;
          this.castRay(
            hx + rx * 6,
            hy + ry * 6,
            hz + 5,
            rx,
            ry,
            rz,
            rem * range(0.5, 0.85),
            0,
            spec,
            dmgMul * range(0.28, 0.42)
          );
        }
        return null;
      }
      // Coarse unit walk — sample several points along this step.
      const hit = this.unitWalkHit(x, y, z, nx, ny, nz);
      if (hit) {
        this.pushBeam(seg0.x, seg0.y, seg0.z, hit.x, hit.y, hit.z, spec, dmgMul);
        this.impact(hit.x, hit.y, hit.z, dx, dy, dz, spec, false);
        // Damage without HE fireball — beam explode path stays kinetic when kind is beam.
        this.s.explode(
          hit.x,
          hit.y,
          hit.z,
          spec.blast * 0.55 * dmgMul,
          spec.dmg * dmgMul,
          hit.u,
          dx * 120,
          dy * 120,
          dz * 60,
          true,
          "beam",
          1.1
        );
        return null;
      }
      x = nx;
      y = ny;
      z = nz;
      traveled += step;
    }
    this.pushBeam(seg0.x, seg0.y, seg0.z, x, y, z, spec, dmgMul);
    return { x, y, z };
  }

  /** Sample a segment against unit footprints (coarse walk, generous height). */
  unitWalkHit(
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number
  ): { x: number; y: number; z: number; u: Unit } | null {
    const samples = 4;
    let best: { x: number; y: number; z: number; u: Unit; t: number } | null = null;
    for (let s = 0; s <= samples; s++) {
      const t = s / samples;
      const px = x0 + (x1 - x0) * t;
      const py = y0 + (y1 - y0) * t;
      const pz = z0 + (z1 - z0) * t;
      for (const u of this.s.units) {
        if (u.dead) continue;
        const hr = circumRadiusOf(u.kind) + 14;
        if (Math.hypot(px - u.x, py - u.y) > hr) continue;
        if (!pointInFootprint(px, py, footprintInto(u, 12, 0))) continue;
        const top = u.z + heightOf(u.kind);
        // Generous vertical slab so aiming past a hull still clips the body.
        if (pz > top + 18 || pz < u.z - 10) continue;
        if (!best || t < best.t) best = { x: px, y: py, z: pz, u, t };
      }
    }
    return best ? { x: best.x, y: best.y, z: best.z, u: best.u } : null;
  }

  pushBeam(
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    spec: PlayerWpnSpec,
    dmgMul: number
  ): void {
    const life = Math.max(0.22, spec.life * 1.6 * (0.85 + dmgMul * 0.2));
    this.beams.push({
      x0,
      y0,
      z0,
      x1,
      y1,
      z1,
      life,
      max: life,
      width: Phaser.Math.Linear(7, 14, dmgMul),
      color: dmgMul > 0.7 ? 0xe8a0ff : 0xb06cff,
    });
    while (this.beams.length > 48) this.beams.shift();
  }

  impact(
    x: number,
    y: number,
    z: number,
    dx: number,
    dy: number,
    dz: number,
    _spec: PlayerWpnSpec,
    ground: boolean
  ): void {
    this.s.tesla.spawnZap(x, y, z, ground ? 1.15 : 1.35, 1.4);
    this.s.tesla.spawnZap(x, y, z + 6, 0.85, 1.1);
    this.s.tesla.emitSparks(x, y, z, ground ? 14 : 18, ground ? 0.9 : 1.15);
    // Colorful spark spray — no HE fireball / blast trails on energy hits.
    this.s.emitVisualBurst(
      x,
      y,
      z + 2,
      {
        n: 16,
        spdMin: 60,
        spdMax: 280,
        bx: -dx,
        by: -dy,
        bz: Math.abs(dz) + 0.4,
        tight: 0.35,
        scaleMul: 0.7,
        stretchMul: 1.6,
      },
      this.s.teslaSparkBurst
    );
    const at = worldToScreen(x, y, z);
    this.s.spawnImpactFlash(at.x, at.y, z, 0xd090ff, 22 * at.scale, 0.7, 120);
    this.s.shake = Math.min(5.5, this.s.shake + (ground ? 0.55 : 0.85));
  }

  tick(dt: number): void {
    let w = 0;
    for (const b of this.beams) {
      b.life -= dt;
      if (b.life > 0) this.beams[w++] = b;
    }
    this.beams.length = w;
  }

  draw(): void {
    const g = this.gfx;
    g.clear();
    if (!this.beams.length) return;
    let depth = Number.POSITIVE_INFINITY;
    for (const b of this.beams) {
      const fade = Phaser.Math.Clamp(b.life / b.max, 0, 1);
      const s0 = worldToScreen(b.x0, b.y0, b.z0);
      const s1 = worldToScreen(b.x1, b.y1, b.z1);
      depth = Math.min(
        depth,
        worldDepth(b.z0, ZOff.shot, b.y0),
        worldDepth(b.z1, ZOff.shot, b.y1)
      );
      const w = Math.max(2.2, b.width * (0.35 + 0.65 * fade));
      g.lineStyle(w * 2.1, b.color, 0.28 * fade);
      g.lineBetween(s0.x, s0.y, s1.x, s1.y);
      g.lineStyle(w * 1.15, 0xe8b0ff, 0.55 * fade);
      g.lineBetween(s0.x, s0.y, s1.x, s1.y);
      g.lineStyle(Math.max(1.4, w * 0.42), 0xfff8ff, 0.95 * fade);
      g.lineBetween(s0.x, s0.y, s1.x, s1.y);
    }
    if (Number.isFinite(depth)) g.setDepth(depth);
  }
}
