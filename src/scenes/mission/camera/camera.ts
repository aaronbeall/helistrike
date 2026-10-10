import { craftCameraScale, craftControlScheme, craftOf, craftCloudParallax } from "../../../sim/crafts";
import { camZoomAt, worldToScreen, setCamera25DFocus, screenToWorldAtZ, groundZ, WORLD, CamTune, Camera25D } from "../../../worldgen/world";
import { PLAYER_WPNS, type PlayerWpnSpec, type Shot } from "../../../sim/combat";
import Phaser from "phaser";

import { Layer, worldDepth } from "../../../render/depth";
import { range } from "../../../util/rng";
import { MAP_AIR_SOFT, MAX_AGL, craftCameraEdgeLocked } from "../../../sim/craft";
import { remoteSpecOf } from "../../../sim/remote";
import { type ThermalPalette } from "../../../render/thermal";
import type { MissionScene } from "../../missionScene";
import { missionOf } from "../../../sim/mission";
import { setTextColor } from "../../../render/textStyle";

/** Speed pullback: `CAM_PULL_REF` at `CAM_SPEED_REF` (world / s), growing as speed^`CAM_PULL_EXP`, capped at `CAM_PULL_MAX`. */
export const CAM_SPEED_REF = 760;
export const CAM_PULL_REF = 0.4;
export const CAM_PULL_EXP = 2;
export const CAM_PULL_MAX = 0.45;

/** Framing zoom for a hull at a speed (host or remote): its size, then pullback by absolute speed (same scale for every craft). */
export function craftPlayZoom(spec: ReturnType<typeof craftOf>, z: number, vx: number, vy: number): number {
  // Perspective keeps chase-focus scale stable; Phaser zoom is framing only.
  const pull = Math.min(CAM_PULL_MAX, CAM_PULL_REF * Math.pow(Math.hypot(vx, vy) / CAM_SPEED_REF, CAM_PULL_EXP));
  return camZoomAt(z) * craftCameraScale(spec) * (1 - pull);
}

/** What the camera frames: a hull at a pose, and the weapon its look-ahead follows. */
export type CamSubject = {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  roll: number;
  pitch: number;
  hull: ReturnType<typeof craftOf>;
  weapon: PlayerWpnSpec;
  /** A piloted remote, not the host. */
  remote: boolean;
};

type AimLook = { x: number; y: number; rate: number };

/** Look-ahead toward the pointer (projected at the subject's altitude), per its weapon + hull. */
function aimLook(s: MissionScene, c: CamSubject, out: AimLook): AimLook {
  const p = s.pointerScreen();
  const aim = screenToWorldAtZ(p.x, p.y, c.z);
  const look = planeLookCam(c.weapon, craftControlScheme(c.hull) === "plane");
  out.x = (aim.x - c.x) * look.pull;
  out.y = (aim.y - c.y) * look.pull;
  const len = Math.hypot(out.x, out.y);
  if (len > look.max) {
    out.x *= look.max / len;
    out.y *= look.max / len;
  }
  out.rate = look.rate;
  return out;
}

/** Pad (projected px) around the view that unit sprites still draw in; far-unit LOD treats the same padded view as on screen. */
export const VIEW_PAD = 220;
/** Scratch point for `viewGroundRadius`. */
const VIEW_PT = { x: 0, y: 0, z: 0 };

/** Camera: play zoom + projection pose, look cam, impact linger, screen shake, theater/map view + overlay + labels, theater sky + peaks, plane cloud parallax. */
export class MissionCamera {
  mapLabel!: Phaser.GameObjects.Text;
  mapHvLabels: Phaser.GameObjects.Text[] = [];
  mapGfx!: Phaser.GameObjects.Graphics;
  shake = 0;
  mapView = false;
  mapWant = false;
  mapBlend = 0;
  mapWorldHidden = false;
  mapWorldVisibility = new Map<Phaser.GameObjects.GameObject, boolean>();
  zoom = CamTune.zoom0;
  follow = false;
  lookCamX = 0;
  lookCamY = 0;
  private hostCam = {} as CamSubject;
  private povCam = {} as CamSubject;
  private hostLook: AimLook = { x: 0, y: 0, rate: 0 };
  private povLook: AimLook = { x: 0, y: 0, rate: 0 };
  /** Fixed-wing altitude cloud sprites (scroll-factor parallax). */
  planeClouds: {
    im: Phaser.GameObjects.Image;
    baseX: number;
    baseY: number;
    driftAng: number;
    driftSpd: number;
  }[] = [];
  /** Off-map soft cloud / fog sprites (leave-theater; flat world XY). */
  leaveTheaterClouds: Phaser.GameObjects.Image[] = [];
  /** Off-map mountain peaks — 2.5D projected like units (leave-theater only). */
  leaveTheaterPeaks: {
    im: Phaser.GameObjects.Image;
    x: number;
    y: number;
    z: number;
    sx: number;
    sy: number;
  }[] = [];
  povCamLookHold = 0;
  povCamLookX = 0;
  povCamLookY = 0;
  playLastFrame = false;
  playScrollX = 0;
  playScrollY = 0;
  playViewX = 0;
  playViewY = 0;
  playViewW = 0;
  playViewH = 0;

  constructor(readonly s: MissionScene) {}

  /** Per-mission state reset (called from the scene's init). */
  reset(): void {
    this.shake = 0;
    this.mapView = false;
    this.mapWant = false;
    this.mapBlend = 0;
    this.mapWorldHidden = false;
    this.mapWorldVisibility.clear();
    this.follow = false;
    this.lookCamX = 0;
    this.lookCamY = 0;
    this.planeClouds = [];
    this.leaveTheaterClouds = [];
    this.leaveTheaterPeaks = [];
    this.povCamLookHold = 0;
    this.povCamLookX = 0;
    this.povCamLookY = 0;
    this.playLastFrame = false;
  }

  /** World distance from the camera focus to the farthest corner of the view padded by `pad`, at ground and at `MAX_AGL`. */
  viewGroundRadius(pad: number): number {
    const v = this.s.cameras.main.worldView;
    let r = 0;
    for (let k = 0; k < 8; k++) {
      const p = screenToWorldAtZ(k & 1 ? v.right + pad : v.x - pad, k & 2 ? v.bottom + pad : v.y - pad, k & 4 ? MAX_AGL : 0, VIEW_PT);
      const d = Math.hypot(p.x - Camera25D.focusX, p.y - Camera25D.focusY);
      if (!Number.isFinite(d)) return Infinity;
      if (d > r) r = d;
    }
    return r;
  }

  projectedInView(x: number, y: number, pad: number): boolean {
    const view = this.s.cameras.main.worldView;
    return (
      x >= view.x - pad &&
      x <= view.right + pad &&
      y >= view.y - pad &&
      y <= view.bottom + pad
    );
  }

  /** Hold play-cam on an impact (any povCam / wire / warp linger), optionally keeping the sensor palette. */
  beginImpactCamLinger(
    x: number,
    y: number,
    opt?: { thermal?: ThermalPalette; hold?: number }
  ): void {
    const hold = opt?.hold ?? (opt?.thermal ? 1.65 : 0.95);
    this.povCamLookX = x;
    this.povCamLookY = y;
    this.povCamLookHold = Math.max(this.povCamLookHold, hold);
    if (opt?.thermal) {
      this.s.thermal.sensorLingerPalette = opt.thermal;
      this.s.thermal.sensorLingerT = Math.max(this.s.thermal.sensorLingerT, hold);
    }
  }

  /** Wall-clock drain for impact linger — runs even while a stinger owns look. */
  tickImpactCamLinger(dt: number): void {
    if (this.povCamLookHold > 0) {
      this.povCamLookHold = Math.max(0, this.povCamLookHold - dt);
    }
    if (this.s.thermal.sensorLingerT > 0) {
      this.s.thermal.sensorLingerT = Math.max(0, this.s.thermal.sensorLingerT - dt);
      if (this.s.thermal.sensorLingerT <= 0) this.s.thermal.sensorLingerPalette = null;
    }
  }

  /** World point the play camera is looking at (heli, povCam chase, or stinger). */
  camLookWorld(): { x: number; y: number; z: number } {
    const a = this.camAnchor();
    return {
      x: a.x + this.lookCamX,
      y: a.y + this.lookCamY,
      z:
        this.s.flow.stingerT > 0 && this.s.flow.stingerTarget?.z != null && !this.s.flow.stingerReleased
          ? this.s.flow.stingerFocusZ
          : a.z,
    };
  }

  toggleMap(): void {
    if (this.s.over) return;
    this.mapWant = !this.mapWant;
    this.mapLabel
      .setVisible(true)
      .setText(this.mapWant ? "THEATER MAP   HV sites marked   M close" : "RETURNING");
  }

  theaterWorldKeep(obj: Phaser.GameObjects.GameObject): boolean {
    return (
      obj === this.s.terrain25d ||
      obj === this.s.ground ||
      obj === this.s.groundMarks.wreckLayer ||
      obj === this.s.flatWreckage ||
      obj === this.mapGfx ||
      this.mapHvLabels.some((label) => label === obj) ||
      this.s.hudSet.has(obj)
    );
  }

  setTheaterWorldHidden(hidden: boolean): void {
    if (hidden === this.mapWorldHidden) return;
    this.mapWorldHidden = hidden;
    if (hidden) {
      this.s.children.each((obj: Phaser.GameObjects.GameObject) => {
        if (this.theaterWorldKeep(obj)) return;
        const visible = (obj as Phaser.GameObjects.GameObject & { visible: boolean }).visible;
        this.mapWorldVisibility.set(obj, visible);
        (obj as Phaser.GameObjects.GameObject & { setVisible(value: boolean): unknown }).setVisible(false);
      });
      return;
    }
    for (const [obj, visible] of this.mapWorldVisibility) {
      if (obj.scene) {
        (obj as Phaser.GameObjects.GameObject & { setVisible(value: boolean): unknown }).setVisible(visible);
      }
    }
    this.mapWorldVisibility.clear();
  }

  /** Project leave-theater peaks with the same 2.5D pose as units / terrain. */
  syncLeaveTheaterPeaks(): void {
    if (!this.leaveTheaterPeaks.length) return;
    for (const p of this.leaveTheaterPeaks) {
      const at = worldToScreen(p.x, p.y, p.z);
      p.im.setPosition(at.x, at.y).setScale(p.sx * at.scale, p.sy * at.scale);
      const depth = worldDepth(p.z, -0.5, p.y);
      if (p.im.depth !== depth) p.im.setDepth(depth);
    }
  }

  createLeaveTheaterSky(): void {
    for (const im of this.leaveTheaterClouds) im.destroy();
    for (const p of this.leaveTheaterPeaks) p.im.destroy();
    this.leaveTheaterClouds = [];
    this.leaveTheaterPeaks = [];
    // Outside-map sky is only visible when the chase cam can leave the playable rect.
    const hulls = [this.s.player.spec, ...this.s.loadout.flatMap((w) => (w.payload?.remote ? [craftOf(remoteSpecOf(w.payload.remote.kind).craftLook)] : []))];
    if (hulls.every(craftCameraEdgeLocked)) return;

    const keys = ["fx_cloud_1", "fx_cloud_2", "fx_cloud_3", "fx_cloud_4"].filter((k) =>
      this.s.textures.exists(k)
    );
    if (!keys.length) return;

    const pad = MAP_AIR_SOFT + 900;
    const lo = -pad;
    const hi = WORLD + pad;
    // Behind the map: visible once the camera scrolls past the terrain edge.
    const skyDepth = Layer.TERRAIN - 2;
    // Soft fog bank over the hard map cut.
    const fogDepth = Layer.WRECK + 0.5;
    // Off-map scenery sits at the surface of the nearest map edge (sea, shore or land).
    const edgeZ = (x: number, y: number) =>
      groundZ(this.s.world, Phaser.Math.Clamp(x, 0, WORLD - 1), Phaser.Math.Clamp(y, 0, WORLD - 1));
    let ki = 0;

    const place = (
      x: number,
      y: number,
      depth: number,
      alpha: number,
      scale: number,
      tint: number,
      stretchX: number
    ) => {
      const key = keys[ki++ % keys.length]!;
      const im = this.s.add.image(x, y, key);
      const flip = Math.random() < 0.5 ? -1 : 1;
      im.setOrigin(0.5)
        .setDepth(depth)
        .setAlpha(alpha)
        .setScale(scale * stretchX * flip, scale)
        .setRotation((Math.random() - 0.5) * 0.5);
      if (tint !== 0xffffff) im.setTint(tint);
      this.leaveTheaterClouds.push(im);
    };

    // Cloud sea filling the leave-theater pad (reject samples inside the map).
    for (let n = 0, tries = 0; n < 90 && tries < 800; tries++) {
      const x = lo + Math.random() * (hi - lo);
      const y = lo + Math.random() * (hi - lo);
      if (x > -40 && x < WORLD + 40 && y > -40 && y < WORLD + 40) continue;
      place(
        x,
        y,
        skyDepth,
        range(0.38, 0.72),
        range(1.35, 2.6),
        0xc5d4e0,
        range(1.15, 1.75)
      );
      n++;
    }
    // Extra cloud banks in the mountain belt so peaks sit in a cloudy range, not empty sky.
    for (let n = 0; n < 55; n++) {
      const side = n % 4;
      const t = Math.random() * WORLD;
      const out = range(80, 520);
      let x = 0;
      let y = 0;
      if (side === 0) {
        x = t;
        y = -out;
      } else if (side === 1) {
        x = WORLD + out;
        y = t;
      } else if (side === 2) {
        x = t;
        y = WORLD + out;
      } else {
        x = -out;
        y = t;
      }
      place(
        x + range(-90, 90),
        y + range(-90, 90),
        skyDepth,
        range(0.4, 0.75),
        range(1.5, 2.8),
        0xd0dce8,
        range(1.2, 1.9)
      );
    }

    // Cloudy mountain ranges wrapping the leave-theater pad (projected like units).
    const peaks = ["fx_mountain_peak_1", "fx_mountain_peak_2", "fx_mountain_peak_3"].filter((k) =>
      this.s.textures.exists(k)
    );
    if (peaks.length) {
      let pi = 0;
      const placePeak = (
        x: number,
        y: number,
        sc: number,
        zOff: number,
        tint?: number
      ) => {
        const key = peaks[pi++ % peaks.length]!;
        const flip = Math.random() < 0.5 ? -1 : 1;
        const im = this.s.add.image(0, 0, key);
        im.setOrigin(0.5, 0.82).setAlpha(1);
        if (tint != null) im.setTint(tint);
        this.leaveTheaterPeaks.push({
          im,
          x,
          y,
          z: edgeZ(x, y) + zOff,
          sx: sc * flip,
          sy: sc,
        });
      };

      // Two depth bands per edge: mid + near (far haze band dropped for density).
      type Band = { out: number; span: number; step: number; sc: [number, number]; z: [number, number]; tint: number };
      const bands: Band[] = [
        { out: 300, span: 120, step: 170, sc: [0.95, 1.55], z: [4, 10], tint: 0xc4d0dc },
        { out: 140, span: 90, step: 140, sc: [1.2, 2.05], z: [6, 14], tint: 0xffffff },
      ];

      const alongEdge = (
        axis: "x" | "y",
        edge: number,
        outSign: number,
        band: Band
      ) => {
        for (let t = -200; t <= WORLD + 200; t += band.step) {
          const j = range(-band.step * 0.35, band.step * 0.35);
          const out = outSign * (band.out + range(-band.span * 0.4, band.span * 0.6));
          // Occasional double-stack so ridges look continuous.
          const n = Math.random() < 0.4 ? 2 : 1;
          for (let k = 0; k < n; k++) {
            const ox = range(-70, 70);
            const oy = range(-55, 55);
            const sc = range(band.sc[0], band.sc[1]) * (k === 0 ? 1 : range(0.75, 0.95));
            if (axis === "x") {
              placePeak(t + j + ox, edge + out + oy, sc, range(band.z[0], band.z[1]), band.tint);
            } else {
              placePeak(edge + out + ox, t + j + oy, sc, range(band.z[0], band.z[1]), band.tint);
            }
          }
        }
      };

      for (const band of bands) {
        alongEdge("x", 0, -1, band);
        alongEdge("x", WORLD, 1, band);
        alongEdge("y", 0, -1, band);
        alongEdge("y", WORLD, 1, band);
      }

      // Corner massifs where ranges meet.
      for (const [cx, cy, sx, sy] of [
        [0, 0, -1, -1],
        [WORLD, 0, 1, -1],
        [0, WORLD, -1, 1],
        [WORLD, WORLD, 1, 1],
      ] as const) {
        for (let i = 0; i < 9; i++) {
          const dist = range(120, 520);
          const ang = range(0.15, 1.35); // stay in the outside quadrant
          placePeak(
            cx + sx * Math.cos(ang) * dist + range(-40, 40),
            cy + sy * Math.sin(ang) * dist + range(-40, 40),
            range(0.9, 2.0),
            range(3, 14),
            i < 3 ? 0xa8b8c8 : 0xffffff
          );
        }
      }

      // Light outer-pad scatter so the sea of peaks continues.
      for (let n = 0, tries = 0; n < 22 && tries < 280; tries++) {
        const x = lo + Math.random() * (hi - lo);
        const y = lo + Math.random() * (hi - lo);
        if (x > -80 && x < WORLD + 80 && y > -80 && y < WORLD + 80) continue;
        placePeak(x, y, range(0.75, 1.45), range(1, 8), 0xb0c0d0);
        n++;
      }

      this.syncLeaveTheaterPeaks();
    }

    // Fog / cloud bank along each map edge — seam kiss + lighter outer bank.
    const step = 220;
    const fogTint = 0xdce6ee;
    const alongX = (edgeY: number, outSign: number) => {
      for (let t = -120; t <= WORLD + 120; t += step) {
        const j = range(-70, 70);
        // Seam row: small scale so half-sprite barely crosses the edge.
        place(
          t + j,
          edgeY + outSign * range(12, 55),
          fogDepth,
          range(0.35, 0.58),
          range(0.55, 0.95),
          fogTint,
          range(1.2, 1.7)
        );
        // Outer bank — a bit sparser/softer than the original double row.
        if (Math.random() < 0.72) {
          place(
            t + j * 0.6,
            edgeY + outSign * range(100, 260),
            fogDepth,
            range(0.38, 0.65),
            range(1.05, 2.0),
            fogTint,
            range(1.2, 1.9)
          );
        }
      }
    };
    const alongY = (edgeX: number, outSign: number) => {
      for (let t = -120; t <= WORLD + 120; t += step) {
        const j = range(-70, 70);
        place(
          edgeX + outSign * range(12, 55),
          t + j,
          fogDepth,
          range(0.35, 0.58),
          range(0.55, 0.95),
          fogTint,
          range(1.2, 1.7)
        );
        if (Math.random() < 0.72) {
          place(
            edgeX + outSign * range(100, 260),
            t + j * 0.6,
            fogDepth,
            range(0.38, 0.65),
            range(1.05, 2.0),
            fogTint,
            range(1.2, 1.9)
          );
        }
      }
    };
    alongX(0, -1);
    alongX(WORLD, 1);
    alongY(0, -1);
    alongY(WORLD, 1);

    // Corner puffs stay outside both edges.
    for (const [cx, cy, sx, sy] of [
      [0, 0, -1, -1],
      [WORLD, 0, 1, -1],
      [0, WORLD, -1, 1],
      [WORLD, WORLD, 1, 1],
    ] as const) {
      for (let i = 0; i < 4; i++) {
        place(
          cx + sx * range(70, 230) + range(-10, 10),
          cy + sy * range(70, 230) + range(-10, 10),
          fogDepth,
          range(0.4, 0.68),
          range(1.0, 1.85),
          fogTint,
          range(1.15, 1.75)
        );
      }
    }
  }

  createPlaneCloudParallax(): void {
    this.planeClouds = [];
    const keys = ["fx_cloud_1", "fx_cloud_2", "fx_cloud_3", "fx_cloud_4"].filter((k) =>
      this.s.textures.exists(k)
    );
    if (!keys.length) return;
    const look = craftCloudParallax(this.s.player.spec);
    const coverage = Math.max(0, missionOf().profile.clouds);
    // Above craft / world / field HUD tracking; just under chrome HUD.
    const cloudDepth = Layer.HUD - 40;
    // High cruise: distant banks (low scroll). Low cruise: nearer (scroll pulled up).
    // Keep scroll high enough that a random field still intersects the view.
    const scrollOf = (far: number) =>
      Phaser.Math.Linear(
        Math.max(far, 0.22),
        Phaser.Math.Clamp(far + 0.45, 0.5, 0.88),
        look.nearness
      );
    const layers: {
      n: number;
      scroll: number;
      alpha: [number, number];
      scale: [number, number];
      depth: number;
    }[] = [
      {
        // Far banks: largest and faintest — kept modest so they don't wash the view.
        n: 6,
        scroll: scrollOf(0.22),
        alpha: [0.22 * look.alphaMul, 0.38 * look.alphaMul],
        scale: [0.7 * look.sizeMul, 1.1 * look.sizeMul],
        depth: cloudDepth - 2,
      },
      {
        n: 7,
        scroll: scrollOf(0.34),
        alpha: [0.4 * look.alphaMul, 0.62 * look.alphaMul],
        scale: [0.65 * look.sizeMul, 1.15 * look.sizeMul],
        depth: cloudDepth - 1,
      },
      {
        n: 6,
        scroll: scrollOf(0.48),
        alpha: [0.36 * look.alphaMul, 0.58 * look.alphaMul],
        scale: [0.5 * look.sizeMul, 0.95 * look.sizeMul],
        depth: cloudDepth,
      },
    ];
    let i = 0;
    for (const layer of layers) {
      const sf = layer.scroll;
      const hx = this.s.player.x * sf;
      const hy = this.s.player.y * sf;
      // A few bank centers per layer, clouds jittered tightly around each.
      const clumpN = Math.max(2, Math.round((layer.n * Math.max(1, coverage)) / 3));
      const clumps: { cx: number; cy: number }[] = [];
      for (let c = 0; c < clumpN; c++) {
        clumps.push({
          cx: hx + range(-1800, 1800),
          cy: hy + range(-1800, 1800),
        });
      }
      const count = Math.round(layer.n * coverage);
      for (let n = 0; n < count; n++, i++) {
        const key = keys[i % keys.length]!;
        const clump = clumps[n % clumps.length]!;
        const x = clump.cx + range(-280, 280);
        const y = clump.cy + range(-200, 200);
        const im = this.s.add.image(x, y, key);
        const sc = range(layer.scale[0], layer.scale[1]);
        const flip = Math.random() < 0.5 ? -1 : 1;
        const stretchX = range(1.05, 1.4);
        im.setOrigin(0.5)
          .setScrollFactor(sf)
          .setDepth(layer.depth)
          .setAlpha(range(layer.alpha[0], layer.alpha[1]))
          .setScale(sc * stretchX * flip, sc)
          .setRotation((Math.random() - 0.5) * 0.35)
          .setVisible(true);
        this.planeClouds.push({
          im,
          baseX: x,
          baseY: y,
          driftAng: Math.random() * Math.PI * 2,
          driftSpd: range(3.5, 12),
        });
      }
    }
  }

  syncPlaneCloudParallax(dt: number): void {
    if (!this.planeClouds.length) return;
    const show = this.mapBlend < 0.45 && this.s.player.phase !== "dead";
    const cam = this.s.cameras.main;
    const viewW = cam.width / Math.max(0.05, cam.zoom) + 1600;
    const viewH = cam.height / Math.max(0.05, cam.zoom) + 1600;
    for (const c of this.planeClouds) {
      c.driftAng += dt * 0.04;
      const amp = c.driftSpd * 10;
      // Keep banks wrapping through the parallax-visible window around the camera.
      const sf = c.im.scrollFactorX;
      const originX = cam.scrollX * sf;
      const originY = cam.scrollY * sf;
      const wrap = (v: number, lo: number, span: number) => {
        if (span <= 1) return v;
        let t = (v - lo) % span;
        if (t < 0) t += span;
        return lo + t;
      };
      c.baseX = wrap(c.baseX, originX - viewW * 0.5, viewW);
      c.baseY = wrap(c.baseY, originY - viewH * 0.5, viewH);
      c.im.x = c.baseX + Math.cos(c.driftAng) * amp;
      c.im.y = c.baseY + Math.sin(c.driftAng * 0.73) * amp * 0.75;
      if (c.im.visible !== show) c.im.setVisible(show);
    }
  }

  playZoom(): number {
    return this.blendSubjects((c) => craftPlayZoom(c.hull, c.z, c.vx, c.vy));
  }

  syncProjectionPose(): void {
    const anchor = this.camAnchor();
    const focusX = anchor.x + this.lookCamX;
    const focusY = anchor.y + this.lookCamY;
    const focusZ =
      this.s.flow.stingerT > 0 && this.s.flow.stingerTarget?.z != null && !this.s.flow.stingerReleased
        ? this.s.flow.stingerFocusZ
        : anchor.z;
    setCamera25DFocus(focusX, focusY, focusZ);
    // Camera-space coordinates from getWorldPoint are stale after recentering,
    // even within the same game-loop frame.
    this.s.ptrFrame = -1;
    this.s.ptrWorldReady = false;
    if (this.mapBlend < 0.001) this.s.cameras.main.centerOn(focusX, focusY);
    this.s.syncFieldHudCam();
  }

  theaterZoom(): number {
    return Math.min(this.s.scale.width / WORLD, this.s.scale.height / WORLD) * 0.92;
  }

  capturePlayView(): void {
    const cam = this.s.cameras.main;
    const v = cam.worldView;
    this.playScrollX = cam.scrollX;
    this.playScrollY = cam.scrollY;
    this.playViewX = v.x;
    this.playViewY = v.y;
    this.playViewW = v.width;
    this.playViewH = v.height;
  }

  syncPlayView(): void {
    if (this.mapBlend < 0.001 && this.playLastFrame) this.capturePlayView();
    this.playLastFrame = this.mapBlend < 0.001;
    if (this.mapBlend > 0.001) this.stepPlayCam();
  }

  stepPlayCam(): void {
    const zoom = this.playZoom();
    const width = this.s.scale.width;
    const height = this.s.scale.height;
    const lerp = 0.12;
    const a = this.camAnchor();
    const { x: fx, y: fy } = worldToScreen(a.x, a.y, a.z);
    let sx = this.playScrollX;
    let sy = this.playScrollY;
    const midX = sx + width * 0.5;
    const midY = sy + height * 0.5;
    const dzL = midX - 40;
    const dzR = midX + 40;
    const dzT = midY - 40;
    const dzB = midY + 40;
    if (fx < dzL) sx = Phaser.Math.Linear(sx, sx - (dzL - fx), lerp);
    else if (fx > dzR) sx = Phaser.Math.Linear(sx, sx + (fx - dzR), lerp);
    if (fy < dzT) sy = Phaser.Math.Linear(sy, sy - (dzT - fy), lerp);
    else if (fy > dzB) sy = Phaser.Math.Linear(sy, sy + (fy - dzB), lerp);
    const dw = width / zoom;
    const dh = height / zoom;
    const bx = (dw - width) / 2;
    const by = (dh - height) / 2;
    const bw = Math.max(bx, bx + WORLD - dw);
    const bh = Math.max(by, by + WORLD - dh);
    // Helis / VTOL: clamp scroll to the map. Planes track freely (forced U-turn craft).
    if (craftCameraEdgeLocked(this.subjectHull())) {
      sx = Phaser.Math.Clamp(sx, bx, bw);
      sy = Phaser.Math.Clamp(sy, by, bh);
    }
    this.playScrollX = sx;
    this.playScrollY = sy;
    const displayW = Math.floor(dw + 0.5);
    const displayH = Math.floor(dh + 0.5);
    const mx = sx + width * 0.5;
    const my = sy + height * 0.5;
    this.playViewX = Math.floor(mx - displayW / 2 + 0.5);
    this.playViewY = Math.floor(my - displayH / 2 + 0.5);
    this.playViewW = displayW;
    this.playViewH = displayH;
  }

  updateTheaterCam(dt: number): void {
    const target = this.mapWant ? 1 : 0;
    const rate = 1.45;
    if (this.mapBlend < target) this.mapBlend = Math.min(target, this.mapBlend + dt * rate);
    else if (this.mapBlend > target) this.mapBlend = Math.max(target, this.mapBlend - dt * rate);

    const ease = Phaser.Math.Easing.Sine.InOut(this.mapBlend);
    this.s.terrain25d?.setProjectionBlend(1 - ease);
    const cam = this.s.cameras.main;
    const k = 1 - Math.exp(-5.2 * dt);
    this.zoom = Phaser.Math.Linear(this.zoom, this.playZoom(), k);
    cam.setZoom(Phaser.Math.Linear(this.zoom, this.theaterZoom(), ease));

    if (this.mapBlend > 0.001) {
      if (this.follow) {
        cam.stopFollow();
        this.follow = false;
      }
      cam.useBounds = false;
      const a = this.camAnchor();
      cam.centerOn(Phaser.Math.Linear(a.x, WORLD / 2, ease), Phaser.Math.Linear(a.y, WORLD / 2, ease));
      this.mapView = true;
      this.s.reticleHud.hideAimChrome();
      if (!this.mapWant && this.mapBlend < 0.08) this.mapLabel.setVisible(false);
      else this.mapLabel.setVisible(true);
    } else {
      this.mapView = false;
      this.mapLabel.setVisible(false);
      if (craftCameraEdgeLocked(this.subjectHull())) {
        cam.setBounds(0, 0, WORLD, WORLD);
        cam.useBounds = true;
      } else {
        cam.useBounds = false;
      }
    }
    this.s.syncFieldHudCam();
  }

  syncLookCam(dt: number): void {
    this.s.thermal.apply();
    // Linger drains on wall-clock even when stinger/death own the look blend.
    this.tickImpactCamLinger(dt);
    // Death cam owns look immediately — don't let HV/mission stingers steal it.
    if (this.s.player.phase !== "dead" && this.s.flow.stingerT > 0 && this.s.flow.stingerTarget && !this.s.flow.stingerReleased) {
      const elapsed = this.s.flow.stingerDuration - this.s.flow.stingerT;
      const ease = (t: number) => {
        const u = Phaser.Math.Clamp(t, 0, 1);
        return u * u * (3 - 2 * u);
      };
      const arrive = ease(elapsed / 0.55);
      const anchor = this.camAnchor();
      const fullOx = this.s.flow.stingerTarget.x - anchor.x;
      const fullOy = this.s.flow.stingerTarget.y - anchor.y;
      // If impact linger is still on (near) this site, don't ease back to the player mid-stinger.
      const lingerCovers =
        this.povCamLookHold > 0 &&
        Math.hypot(this.povCamLookX - this.s.flow.stingerTarget.x, this.povCamLookY - this.s.flow.stingerTarget.y) < 320;
      const leave = lingerCovers ? 1 : ease(this.s.flow.stingerT / 0.85);
      // Arrive from wherever we already were (e.g. povCam chase), not from zero/player.
      let ox = Phaser.Math.Linear(this.s.flow.stingerCamFromX, fullOx, arrive);
      let oy = Phaser.Math.Linear(this.s.flow.stingerCamFromY, fullOy, arrive);
      const targetZ = this.s.flow.stingerTarget.z ?? anchor.z;
      let focusZ = Phaser.Math.Linear(this.s.flow.stingerCamFromZ, targetZ, arrive);
      if (leave < 1) {
        // Leave collapses back onto the camera subject.
        ox *= leave;
        oy *= leave;
        focusZ = Phaser.Math.Linear(anchor.z, focusZ, leave);
      }
      this.s.flow.stingerFocusZ = focusZ;
      const k = 1 - Math.exp(-5.5 * dt);
      this.lookCamX = Phaser.Math.Linear(this.lookCamX, ox, k);
      this.lookCamY = Phaser.Math.Linear(this.lookCamY, oy, k);
      this.syncProjectionPose();
      return;
    }
    if (this.s.player.phase === "dead") {
      // Resting focus = mid(last live, hulk); mouse pulls away from that center.
      const anchor = this.camAnchor();
      const p = this.s.pointerScreen();
      const pointerAtFocus = screenToWorldAtZ(p.x, p.y, anchor.z);
      const pull = 0.32;
      const max = 160;
      let ox = (pointerAtFocus.x - anchor.x) * pull;
      let oy = (pointerAtFocus.y - anchor.y) * pull;
      const len = Math.hypot(ox, oy);
      if (len > max) {
        ox *= max / len;
        oy *= max / len;
      }
      const k = 1 - Math.exp(-8.5 * dt);
      this.lookCamX = Phaser.Math.Linear(this.lookCamX, ox, k);
      this.lookCamY = Phaser.Math.Linear(this.lookCamY, oy, k);
      this.syncProjectionPose();
      return;
    }
    this.s.remoteFleet.tickRemoteCamBlend(dt);
    const anchor = this.camAnchor();
    const hx = anchor.x;
    const hy = anchor.y;
    const sensor = this.s.thermal.activeSensorShot();
    if (sensor) {
      const p = this.s.pointerScreen();
      const aim = screenToWorldAtZ(p.x, p.y, anchor.z);
      // Keep the pre-fire aim look-ahead until the missile has cleared the bird.
      const aimPull = 0.55;
      const aimMax = 210;
      let aimOx = (aim.x - hx) * aimPull;
      let aimOy = (aim.y - hy) * aimPull;
      const aimSpan = Math.hypot(aimOx, aimOy);
      if (aimSpan > aimMax) {
        aimOx *= aimMax / aimSpan;
        aimOy *= aimMax / aimSpan;
      }
      // Seeker frame: lead past the missile toward the reticle so it isn't pinned to the far edge.
      const toAx = aim.x - sensor.x;
      const toAy = aim.y - sensor.y;
      const aLen = Math.hypot(toAx, toAy);
      const spd = Math.hypot(sensor.vx, sensor.vy);
      const lead = Phaser.Math.Clamp(100 + spd * 0.28, 100, 220);
      let lx = 0;
      let ly = 0;
      if (aLen > 12) {
        const use = Math.min(lead, aLen * 0.7);
        lx = (toAx / aLen) * use;
        ly = (toAy / aLen) * use;
      } else {
        lx = Math.cos(sensor.angle) * lead * 0.55;
        ly = Math.sin(sensor.angle) * lead * 0.55;
      }
      const seekOx = sensor.x + lx - hx;
      const seekOy = sensor.y + ly - hy;
      const dist = Math.hypot(sensor.x - hx, sensor.y - hy);
      const handoff = Phaser.Math.Clamp((dist - 40) / 180, 0, 1);
      const ox = Phaser.Math.Linear(aimOx, seekOx, handoff);
      const oy = Phaser.Math.Linear(aimOy, seekOy, handoff);
      const ahead = Math.hypot(sensor.x - (hx + this.lookCamX), sensor.y - (hy + this.lookCamY));
      const baseRate = sensor.wpnId && PLAYER_WPNS[sensor.wpnId]?.cam.thermal ? 3.6 : 4.2;
      const rate = baseRate + Phaser.Math.Clamp(ahead / 220, 0, 1) * 2.8;
      const k = 1 - Math.exp(-rate * dt);
      this.lookCamX = Phaser.Math.Linear(this.lookCamX, ox, k);
      this.lookCamY = Phaser.Math.Linear(this.lookCamY, oy, k);
      this.syncProjectionPose();
      return;
    }
    const look = this.subjectLook();
    let ox = look.x;
    let oy = look.y;
    let rate = look.rate;
    let pov: Shot | undefined;
    for (let i = this.s.shots.length - 1; i >= 0; i--) {
      const s = this.s.shots[i]!;
      if (s.from !== "player") continue;
      // Live shot with cam.povCam — ride it until impact linger takes over.
      if (s.povCam) {
        pov = s;
        break;
      }
    }
    if (pov) {
      this.povCamLookX = pov.x;
      this.povCamLookY = pov.y;
      // Live follow — don't accumulate linger while the shot is still airborne.
      this.povCamLookHold = 0;
      ox += (pov.x - hx) * 0.82;
      oy += (pov.y - hy) * 0.82;
      rate = 5.4;
    } else if (this.povCamLookHold > 0) {
      ox += (this.povCamLookX - hx) * 0.82;
      oy += (this.povCamLookY - hy) * 0.82;
      rate = 5.4;
    } else if (this.s.thermal.sensorLingerT <= 0) {
      this.s.thermal.sensorLingerPalette = null;
    }
    const k = 1 - Math.exp(-rate * dt);
    this.lookCamX = Phaser.Math.Linear(this.lookCamX, ox, k);
    this.lookCamY = Phaser.Math.Linear(this.lookCamY, oy, k);
    this.syncProjectionPose();
  }

  drawMapOverlay(): void {
    this.mapGfx.clear();
    const g = this.mapGfx;
    const z = Math.max(this.s.cameras.main.zoom, 0.001);
    const u = (px: number) => px / z;
    const w = this.s.scale.width;
    const h = this.s.scale.height;
    const pz = this.playZoom();
    const pw = this.playViewW || w / pz;
    const ph = this.playViewH || h / pz;
    const a = this.camAnchor();
    const vx = this.playViewW ? this.playViewX : a.x - pw / 2;
    const vy = this.playViewH ? this.playViewY : a.y - ph / 2;
    const bx = vx + pw;
    const by = vy + ph;
    const tick = Math.max(u(10), Math.min(pw, ph) * 0.18);
    g.fillStyle(0xe8b84a, 0.16);
    g.fillRect(vx, vy, pw, ph);
    g.lineStyle(u(5), 0x1a140c, 0.9);
    g.strokeRect(vx, vy, pw, ph);
    g.lineStyle(u(2.5), 0xffe08a, 1);
    g.strokeRect(vx, vy, pw, ph);
    g.lineStyle(u(3), 0xfff6d0, 1);
    g.lineBetween(vx, vy, vx + tick, vy);
    g.lineBetween(vx, vy, vx, vy + tick);
    g.lineBetween(bx, vy, bx - tick, vy);
    g.lineBetween(bx, vy, bx, vy + tick);
    g.lineBetween(vx, by, vx + tick, by);
    g.lineBetween(vx, by, vx, by - tick);
    g.lineBetween(bx, by, bx - tick, by);
    g.lineBetween(bx, by, bx, by - tick);
    for (const spec of this.s.world.hv) {
      const unit = this.s.units.find((q) => q.hv === spec.id);
      const x = unit ? unit.x : spec.x;
      const y = unit ? unit.y : spec.y;
      const dead = !unit || unit.dead;
      g.fillStyle(dead ? 0x6a6a60 : 0xff5a3a, 1);
      g.fillCircle(x, y, u(7));
      g.lineStyle(u(2), 0xe8b84a, 0.9);
      g.strokeCircle(x, y, u(11));
    }
    this.syncMapHvLabels(u);
    g.fillStyle(0xe8b84a, 1);
    g.fillCircle(this.s.player.x, this.s.player.y, u(5));
  }

  hideMapHvLabels(): void {
    for (const t of this.mapHvLabels) t.setVisible(false);
  }

  syncMapHvLabels(u: (px: number) => number): void {
    while (this.mapHvLabels.length < this.s.world.hv.length) {
      const t = this.s.add
        .text(0, 0, "", {
          fontFamily: "Share Tech Mono, monospace",
          fontSize: "12px",
          color: "#ffe08a",
          align: "left",
        })
        .setOrigin(0, 0.5)
        .setDepth(Layer.HUD + 3)
        .setStroke("#12100c", 4);
      this.mapHvLabels.push(t);
    }
    const fs = Math.max(11, u(13));
    for (let i = 0; i < this.mapHvLabels.length; i++) {
      const t = this.mapHvLabels[i]!;
      const spec = this.s.world.hv[i];
      if (!spec) {
        t.setVisible(false);
        continue;
      }
      const unit = this.s.units.find((q) => q.hv === spec.id);
      const x = unit ? unit.x : spec.x;
      const y = unit ? unit.y : spec.y;
      const dead = !unit || unit.dead;
      const kind = String(spec.kind ?? "HV").toUpperCase();
      const status = dead
        ? "DESTROYED"
        : `ACTIVE  ${(Math.max(0, (unit.health / unit.max) * 100) | 0)}%`;
      setTextColor(t, dead ? "#8a8470" : "#ffe08a")
        .setVisible(true)
        .setScrollFactor(1)
        .setPosition(x + u(16), y)
        .setText(`${spec.name}\n${kind}  ·  ${status}`)
        .setFontSize(`${fs}px`)
        .setLineSpacing(u(1.5))
        .setStroke("#12100c", Math.max(3, u(3.5)));
    }
  }

  /** Camera follow point: the subject's position (host ↔ piloted remote by the POV blend). */
  camAnchor(): { x: number; y: number; z: number } {
    return {
      x: this.blendSubjects((c) => c.x),
      y: this.blendSubjects((c) => c.y),
      z: this.blendSubjects((c) => c.z),
    };
  }

  /** The POV being flown, for discrete reads (edge lock, HUD readouts): whichever subject dominates the blend. */
  dominantSubject(): CamSubject {
    const pov = this.povSubject();
    return pov && this.s.remoteFleet.remoteCamT >= 0.5 ? pov : this.hostSubject();
  }

  /** Hull whose camera rules (edge lock) apply. */
  subjectHull(): ReturnType<typeof craftOf> {
    return this.dominantSubject().hull;
  }

  /** Any per-subject camera value, blended host → piloted remote by the POV blend. */
  blendSubjects(f: (c: CamSubject) => number): number {
    const host = f(this.hostSubject());
    const pov = this.povSubject();
    return pov ? Phaser.Math.Linear(host, f(pov), this.s.remoteFleet.remoteCamT) : host;
  }

  /** Host craft; when dead, mid(last live, hulk). */
  private hostSubject(): CamSubject {
    const h = this.s.player;
    const c = this.hostCam;
    c.hull = h.spec;
    c.weapon = this.s.loadout[h.weapon]!;
    c.remote = false;
    c.vx = h.vx;
    c.vy = h.vy;
    c.roll = h.roll;
    c.pitch = h.pitch;
    if (h.phase === "dead") {
      const d = this.s.destruction;
      const hulk = d.playerCrashDebris;
      c.x = (d.playerDeathLiveX + (hulk?.x ?? h.x)) * 0.5;
      c.y = (d.playerDeathLiveY + (hulk?.y ?? h.y)) * 0.5;
      c.z = (d.playerDeathLiveZ + (hulk?.z ?? h.z)) * 0.5;
    } else {
      c.x = h.x;
      c.y = h.y;
      c.z = h.z;
    }
    return c;
  }

  /** Remote in POV view while the blend is in (never once the host is dead). */
  private povSubject(): CamSubject | undefined {
    const fleet = this.s.remoteFleet;
    const r = fleet.activeRemote();
    if (!r || fleet.remoteCamT < 0.001 || this.s.player.phase === "dead") return undefined;
    const c = this.povCam;
    c.hull = craftOf(r.spec.craftLook);
    c.remote = true;
    c.weapon = r.loadout?.[r.weapon ?? 0] ?? this.s.loadout[this.s.player.weapon]!;
    c.x = r.x;
    c.y = r.y;
    c.z = r.z;
    c.vx = r.vx;
    c.vy = r.vy;
    c.roll = r.roll ?? 0;
    c.pitch = r.pitch ?? 0;
    return c;
  }

  /** Aim look-ahead (offset from the anchor + follow rate), blended like the anchor. */
  private subjectLook(): AimLook {
    const host = aimLook(this.s, this.hostSubject(), this.hostLook);
    const pov = this.povSubject();
    if (!pov) return host;
    const t = this.s.remoteFleet.remoteCamT;
    const l = aimLook(this.s, pov, this.povLook);
    l.x = Phaser.Math.Linear(host.x, l.x, t);
    l.y = Phaser.Math.Linear(host.y, l.y, t);
    l.rate = Phaser.Math.Linear(host.rate, l.rate, t);
    return l;
  }
}

/** Plane hardpoint / drop look-ahead boost (host + remote POV). */
export function planeLookCam(
  spec: PlayerWpnSpec,
  isPlane: boolean
): { pull: number; max: number; rate: number } {
  const look = spec.cam.look;
  if (
    isPlane &&
    spec.cam.planeLookMul !== false &&
    (spec.guidance != null || spec.launch.mode === "drop" || !!spec.exhaust)
  ) {
    return { pull: look.pull * 1.22, max: look.max * 1.28, rate: look.rate };
  }
  return { pull: look.pull, max: look.max, rate: look.rate };
}
