import { remoteHostAmmoWeapon } from "../../../sim/remoteRules";
import { sightTerrainHitWorld } from "../../../sim/aim";
import { thermalSignalTint } from "../../../render/thermal";
import { launchGravity, targetingMode, collapseSightTips } from "../../../sim/weaponRuntime";
import { lookupSpriteMuzzles } from "../../../art/spriteOrigin";
import { craftFixedMuzzles, craftSocketBarrelCount, craftSocketPoints, socketHullPlacement, craftGunId, craftControlScheme, craftOf, craftSocketFireCd, craftSocketStartingAmmo } from "../../../sim/crafts";
import { groundZ, worldToScreen, screenToWorldAtZ } from "../../../worldgen/world";
import Phaser from "phaser";
import { payloadIsRemote, payloadIsHostFire } from "../../../sim/payload";
import { launchIsArcBeam, PLAYER_WPNS, type PlayerWpnSpec, type WpnId } from "../../../sim/combat";
import { remoteHasPovHud } from "../../../sim/remote";
import { Layer, ZOff, worldDepth } from "../../../render/depth";
import type { MissionScene } from "../../missionScene";

/** Weapons with an authored cooldown at least this long (s) show the reticle cooldown radial. */
const RETICLE_CD_MIN = 1.0;

/** Cursor texture: remote deploy, bomb drop, else the cam's round/square. */
export function reticleTexFor(textures: Phaser.Textures.TextureManager, spec: PlayerWpnSpec, square: boolean): string {
  const want = payloadIsRemote(spec.payload)
    ? "mark_reticle_remote"
    : spec.launch.mode === "drop"
      ? "mark_reticle_bomb"
      : square
        ? "mark_reticle_sq"
        : "mark_reticle";
  return textures.exists(want) ? want : "mark_reticle";
}

/** Aim reticle: per-weapon reticle art, lock/salvo tally, ammo + cooldown arcs. */
export class ReticleHud {
  private reticle!: Phaser.GameObjects.Image;
  private reticleMark!: Phaser.GameObjects.Graphics;
  private sight!: Phaser.GameObjects.Graphics;

  constructor(readonly s: MissionScene) {}

  sync(): void {
    const p = this.s.input.activePointer;
    this.reticle.setPosition(p.x, p.y);
    const h = this.s.player;
    const aim = this.s.worldPointer();
    const spec = this.s.loadout[h.weapon]!;
    const bombDrop = spec.launch.mode === "drop";
    const square = spec.cam.reticle === "square";
    // Former kind==="cannon": tracer muzzle guns (incl. plasma energy trail).
    const gunSight =
      spec.launch.mode !== "beam" &&
      spec.launch.mode !== "drop" &&
      !spec.guidance &&
      (!!spec.art.tracer || (spec.launch.mode === "muzzle" && !spec.exhaust));
    this.reticle.setTexture(reticleTexFor(this.s.textures, spec, square));
    const ammoLeft = this.s.fireControl.ammo[h.weapon] ?? 0;
    const ammoShown = this.s.remoteFleet.remotePoolDisplayAmmo(h.weapon, ammoLeft);
    const ammoCap = Math.max(
      craftSocketStartingAmmo(spec.ammo, h.spec, h.weapon),
      Number.isFinite(ammoShown) ? ammoShown : 0
    );
    if (spec.launch.mode === "beam") {
      this.drawReticleAmmoBar(p.x, p.y, ammoShown, ammoCap);
    } else {
      // Remotes: filled = ready in the bay, outline = deployed (alive pool).
      const remote = payloadIsRemote(spec.payload);
      if (remote) {
        const alive = Number.isFinite(ammoShown) ? ammoShown : ammoCap;
        const ready = this.s.debugMenu.infAmmo ? alive : Math.min(ammoLeft, alive);
        this.drawReticleTally(p.x, p.y, ready, alive, "vehicle");
      } else {
        this.drawReticleTally(p.x, p.y, !gunSight ? ammoShown : 0, ammoCap);
      }
    }
    const outOfAmmo = !this.s.debugMenu.infAmmo && Number.isFinite(ammoLeft) && ammoLeft <= 0;
    if (spec.fireCd >= RETICLE_CD_MIN && !outOfAmmo) {
      this.drawReticleCooldown(p.x, p.y, h.fireCd, craftSocketFireCd(spec.fireCd, h.spec, h.weapon));
    }
    // Remote slot: gun remotes keep a POV sight while selected; others have no laser.
    // POV-HUD remotes (HOUND) fall through to their own loadout sight below.
    if (payloadIsRemote(spec.payload)) {
      const live = this.s.remoteFleet.selectedSlotRemote();
      if (live && remoteHasPovHud(live.spec)) {
        // Handled by povHudRemote sight path.
      } else if (live && craftGunId(live.spec) && !(live.spec.ai && !live.spec.pilotable)) {
        this.sight.setVisible(true);
        this.sight.clear();
        const aimAng = live.gunAngle ?? live.angle;
        const muzzle = this.s.remoteBody.remoteGunMuzzle(live);
        const gunSpec = this.s.loadout[h.weapon]!;
        const origin = this.s.fireControl.playerShotOrigin(muzzle, aimAng, gunSpec, h.weapon);
        const clip = this.s.fireControl.playerSightAimWorld(origin.x, origin.y, origin.z, aimAng);
        if (this.sightPastMuzzle(origin, clip, h.weapon, { x: live.x, y: live.y })) {
          const from = worldToScreen(origin.x, origin.y, origin.z);
          const to = worldToScreen(clip.x, clip.y, clip.z);
          this.drawSightLine(from.x, from.y, to.x, to.y, "cannon", false, clip);
        }
        this.sight.setDepth(worldDepth(muzzle.z, ZOff.shot + 2, live.y));
        return;
      } else {
        this.sight.clear();
        this.sight.setVisible(false);
        return;
      }
    }
    const povRem = this.s.remoteFleet.povHudRemote();
    if (povRem) {
      const remSpec = this.s.fireControl.hudLoadout()[this.s.fireControl.hudWeapon()]!;
      const ammoLeft = this.s.fireControl.hudAmmo()[this.s.fireControl.hudWeapon()] ?? 0;
      const remSlot = Phaser.Math.Clamp(povRem.weapon ?? 0, 0, (povRem.loadout?.length ?? 1) - 1);
      const remSocket = povRem.spec.sockets?.[remSlot];
      const bombDrop = remSpec.launch.mode === "drop";
      const remGunSight =
        remSpec.launch.mode !== "beam" &&
        remSpec.launch.mode !== "drop" &&
        !remSpec.guidance &&
        (!!remSpec.art.tracer || (remSpec.launch.mode === "muzzle" && !remSpec.exhaust));
      this.reticle.setTexture(reticleTexFor(this.s.textures, remSpec, remSpec.cam.reticle === "square"));
      const hostAmmoId = remoteHostAmmoWeapon(remSpec);
      const hostSlot = hostAmmoId ? this.s.fireControl.hostWeaponSlot(hostAmmoId) : -1;
      const hostSpec = hostAmmoId ? PLAYER_WPNS[hostAmmoId as WpnId] : undefined;
      const remAmmoCap = Math.max(
        hostSpec && hostSlot >= 0
          ? craftSocketStartingAmmo(hostSpec.ammo, h.spec, hostSlot)
          : craftSocketStartingAmmo(remSpec.ammo, povRem.spec, remSlot),
        Number.isFinite(ammoLeft) ? ammoLeft : 0
      );
      if (remSpec.launch.mode === "beam") {
        this.drawReticleAmmoBar(p.x, p.y, ammoLeft, remAmmoCap);
      } else {
        this.drawReticleTally(p.x, p.y, !remGunSight ? ammoLeft : 0, remAmmoCap);
      }
      const remCdTotal = hostSpec && payloadIsHostFire(remSpec.payload) ? hostSpec.fireCd : remSpec.fireCd;
      const remOut = !this.s.debugMenu.infAmmo && Number.isFinite(ammoLeft) && ammoLeft <= 0;
      if (remCdTotal >= RETICLE_CD_MIN && !remOut) {
        this.drawReticleCooldown(p.x, p.y, povRem.fireCd ?? 0, remCdTotal);
      }
      this.sight.setVisible(true);
      this.sight.clear();
      if (bombDrop) {
        this.s.remoteBody.drawRemoteBombTrajectory(povRem, remSlot, remSpec, this.s.worldPointer());
        return;
      }
      const hull = povRem.spec.craftLook ? craftOf(povRem.spec.craftLook) : undefined;
      const planeFixed =
        !!hull &&
        craftControlScheme(hull) === "plane" &&
        remSocket?.class === "fixed";
      const aimAng = planeFixed
        ? povRem.angle
        : remSocket?.class === "hardpoint"
          ? povRem.angle
          : (povRem.gunAngle ?? povRem.angle);
      const tips = this.s.remoteBody.remoteSightOrigins(povRem, remSlot);
      let drew = false;
      let tipZ = tips[0]?.z ?? povRem.z;
      const pivot = { x: povRem.x, y: povRem.y };
      for (const tip of tips) {
        const origin = this.s.fireControl.playerShotOrigin(tip, aimAng, remSpec, remSlot);
        const clip = this.s.fireControl.playerSightAimWorld(origin.x, origin.y, origin.z, aimAng);
        if (!this.sightPastMuzzle(origin, clip, remSlot, pivot)) continue;
        const from = worldToScreen(origin.x, origin.y, origin.z);
        const to = worldToScreen(clip.x, clip.y, clip.z);
        this.drawSightLine(
          from.x,
          from.y,
          to.x,
          to.y,
          remGunSight ? "cannon" : "missile",
          !remGunSight,
          clip
        );
        tipZ = tip.z;
        drew = true;
      }
      if (!drew) this.sight.clear();
      this.sight.setDepth(worldDepth(tipZ, ZOff.shot + 2, povRem.y));
      return;
    }
    if (launchIsArcBeam(spec.launch)) {
      this.sight.clear();
      this.sight.setVisible(false);
      return;
    }
    this.sight.setVisible(true);
    this.syncSightDepth(h.weapon);
    if (bombDrop) {
      this.drawBombTrajectory(aim);
      return;
    }
    // Mouse designator: free aim at reticle from socket muzzle mounts (spiders, laser/command AG).
    if (spec.cam.sight === "mouse") {
      this.drawMouseDesignatorSight(h.weapon);
      return;
    }
    if (gunSight) {
      const tips = this.cannonSightOrigins(h.weapon);
      const socket = h.spec.sockets[h.weapon];
      const aimAng =
        socket?.class === "fixed"
          ? h.angle
          : (h.stationAim[h.weapon]?.[0] ?? h.gunAngle);
      this.sight.clear();
      let drew = false;
      for (const tip of tips) {
        const origin = this.s.fireControl.playerShotOrigin(tip, aimAng, spec, h.weapon);
        const clip = this.s.fireControl.playerSightAimWorld(origin.x, origin.y, origin.z, aimAng);
        if (!this.sightPastMuzzle(origin, clip, h.weapon)) continue;
        const from = worldToScreen(origin.x, origin.y, origin.z);
        const to = worldToScreen(clip.x, clip.y, clip.z);
        this.drawSightLine(from.x, from.y, to.x, to.y, "cannon", false, clip);
        drew = true;
      }
      if (!drew) this.sight.clear();
      return;
    }
    const pylon = this.s.fireControl.hardpointPylon();
    const origin = this.s.fireControl.playerShotOrigin(pylon, h.angle, spec, h.weapon);
    const clip = this.s.fireControl.playerSightAimWorld(origin.x, origin.y, origin.z, h.angle);
    if (!this.sightPastMuzzle(pylon, clip, h.weapon)) {
      this.sight.clear();
      return;
    }
    const from = worldToScreen(origin.x, origin.y, origin.z);
    const to = worldToScreen(clip.x, clip.y, clip.z);
    this.drawSightLine(from.x, from.y, to.x, to.y, "missile", true, clip);
  }

  drawReticleTally(
    cx: number,
    cy: number,
    count: number,
    max = count,
    shape: "tick" | "vehicle" = "tick"
  ): void {
    const g = this.reticleMark;
    g.clear();
    const n = Math.max(0, Math.floor(count));
    // Vehicles stay up with none ready so deployed outlines still show.
    const none = shape === "vehicle" ? Math.floor(max) <= 0 : n <= 0;
    if (none || !Number.isFinite(max) || max <= 0) {
      g.setVisible(false);
      return;
    }
    g.setVisible(true);
    // Capacity must cover live count (socket mul / remote pool can exceed catalog ammo).
    const cap = Math.max(Math.floor(max), n);
    if (shape === "vehicle") {
      // One diamond per vehicle: filled = ready, outline = deployed.
      const r = 3.6;
      const step = 9.5;
      const perRow = 5;
      const color = 0xe8b84a;
      for (let i = 0; i < cap; i++) {
        const x = cx + 44 + (i % perRow) * step;
        const y = cy - 26 + Math.floor(i / perRow) * step;
        const pts = [
          new Phaser.Math.Vector2(x, y - r),
          new Phaser.Math.Vector2(x + r, y),
          new Phaser.Math.Vector2(x, y + r),
          new Phaser.Math.Vector2(x - r, y),
        ];
        if (i < n) {
          g.fillStyle(color, 0.92);
          g.fillPoints(pts, true);
        } else {
          g.lineStyle(1.2, color, 0.45);
          g.strokePoints(pts, true);
        }
      }
      return;
    }
    // Low: groups of 5 ticks. High: same section footprint as 5×4 dots (20).
    const highCap = cap > 25;
    const perGroup = highCap ? 20 : 5;
    const groupCount = Math.ceil(cap / perGroup);
    const wrap = 2;
    const tickH = 10;
    const tickGap = 3.15;
    const rowH = tickH + 5;
    const colW = tickGap * 4 + 9;
    const ox = cx + 44;
    const oy = cy - 30;
    const color = 0xe8b84a;
    for (let i = 0; i < groupCount; i++) {
      const filled = Phaser.Math.Clamp(n - i * perGroup, 0, perGroup);
      const col = i % wrap;
      const row = Math.floor(i / wrap);
      const x = ox + col * colW;
      const y = oy + row * rowH;
      if (highCap) {
        // 5 across × 4 down inside the tick-section box.
        const cols = 5;
        const rows = 4;
        const gapY = tickH / (rows - 1);
        g.fillStyle(color, 0.92);
        for (let d = 0; d < filled; d++) {
          const dc = d % cols;
          const dr = (d / cols) | 0;
          g.fillCircle(x + dc * tickGap, y + dr * gapY, 1.15);
        }
      } else {
        g.lineStyle(1.35, color, 0.92);
        for (let t = 0; t < filled; t++) {
          const tx = x + t * tickGap;
          g.lineBetween(tx, y, tx, y + tickH);
        }
      }
    }
  }

  /** Beam weapons: subtle circular reserve (drains clockwise from full). */
  drawReticleAmmoBar(cx: number, cy: number, count: number, max: number): void {
    const g = this.reticleMark;
    g.clear();
    if (!Number.isFinite(max) || max <= 0) {
      g.setVisible(false);
      return;
    }
    g.setVisible(true);
    const frac = Phaser.Math.Clamp(
      this.s.debugMenu.infAmmo || !Number.isFinite(count) ? 1 : count / max,
      0,
      1
    );
    // Top-right of the reticle mark, clear of the reticle ring.
    const r = 7;
    const ox = cx + 34;
    const oy = cy - 34;
    const start = -Math.PI / 2;
    // Track
    g.lineStyle(1.5, 0x000000, 0.4);
    g.beginPath();
    g.arc(ox, oy, r, 0, Math.PI * 2, false);
    g.strokePath();
    g.lineStyle(1.15, 0xe8b84a, 0.22);
    g.beginPath();
    g.arc(ox, oy, r, 0, Math.PI * 2, false);
    g.strokePath();
    // Remaining ammo arc (full ring → empty), clockwise from 12 o'clock.
    if (frac > 0.002) {
      const end = start + Math.PI * 2 * frac;
      g.lineStyle(1.6, 0xe8b84a, 0.62);
      g.beginPath();
      g.arc(ox, oy, r, start, end, false);
      g.strokePath();
    }
  }

  /** Long-cooldown weapons: radial fills clockwise during cooldown, gone when ready. */
  drawReticleCooldown(cx: number, cy: number, remaining: number, total: number): void {
    if (!(total > 0) || !(remaining > 0)) return;
    const frac = Phaser.Math.Clamp(1 - remaining / total, 0, 1);
    if (frac >= 1) return;
    const g = this.reticleMark;
    g.setVisible(true);
    const r = 7;
    const ox = cx - 34;
    const oy = cy - 34;
    const start = -Math.PI / 2;
    g.lineStyle(1.5, 0x000000, 0.4);
    g.beginPath();
    g.arc(ox, oy, r, 0, Math.PI * 2, false);
    g.strokePath();
    g.lineStyle(1.15, 0xe8b84a, 0.22);
    g.beginPath();
    g.arc(ox, oy, r, 0, Math.PI * 2, false);
    g.strokePath();
    if (frac > 0.002) {
      g.lineStyle(1.6, 0xe8b84a, 0.85);
      g.beginPath();
      g.arc(ox, oy, r, start, start + Math.PI * 2 * frac, false);
      g.strokePath();
    }
  }

  /**
   * Free-aim laser at the reticle (not boresight). Emits from socket muzzle
   * mounts — hull ports / gun tips — never from wing hardpoint pylons.
   */
  drawMouseDesignatorSight(slot = this.s.player.weapon): void {
    const tips = this.designatorSightOrigins(slot);
    const z = this.s.fireControl.playerMuzzleZ(slot);
    const tgt = this.s.fireControl.reticleAimWorld(this.s.fireControl.reticleUnit());
    this.sight.clear();
    let drew = false;
    for (const tip of tips) {
      const clip = sightTerrainHitWorld(this.s.world, tip.x, tip.y, z, tgt.x, tgt.y, tgt.z);
      if (!this.sightPastMuzzle(tip, clip, slot)) continue;
      const from = worldToScreen(tip.x, tip.y, z);
      const to = worldToScreen(clip.x, clip.y, clip.z);
      this.drawSightLine(from.x, from.y, to.x, to.y, "missile", false, clip);
      drew = true;
    }
    if (!drew) this.sight.clear();
  }

  /**
   * Designator emit tips for the selected slot: authored muzzle / socket points
   * only (fixed→body muzzles, turret→gun tips, hardpoint→that socket's mounts).
   * Does not fall back to other wing pylons.
   */
  designatorSightOrigins(slot = this.s.player.weapon): { x: number; y: number }[] {
    const h = this.s.player;
    const socket = h.spec.sockets[slot];
    let tips: { x: number; y: number }[] = [];
    if (socket?.class === "turret") {
      const barrelN = Math.max(1, craftSocketBarrelCount(h.spec, slot));
      for (let b = 0; b < barrelN; b++) {
        const gunI = this.s.hostCraft.gunVisualIndexForSlot(slot, b);
        const gun = this.s.hostCraft.guns[gunI] ?? this.s.hostCraft.gun;
        if (!gun?.visible) continue;
        const muzzles = lookupSpriteMuzzles(gun.texture.key);
        if (!muzzles.length) continue;
        for (let i = 0; i < muzzles.length; i++) tips.push(this.s.hostCraft.gunTip(gunI, i));
      }
    } else if (socket) {
      // fixed → muzzle UVs; hardpoint → this socket's stores only (not every rack).
      const mounts = craftSocketPoints(h.spec, socket);
      if (mounts.length) tips = mounts.map((m) => this.s.hostCraft.craftBodyMountWorldPos(m));
    }
    if (!tips.length) {
      const bodyMuzzles = craftFixedMuzzles(h.spec);
      if (bodyMuzzles.length) tips = bodyMuzzles.map((m) => this.s.hostCraft.craftBodyMountWorldPos(m));
      else tips = [{ x: h.x, y: h.y }];
    }
    // One beam at the average multi-muzzle / multi-gun tip.
    return collapseSightTips(tips);
  }

  /** Laser sorts under the hull for chin guns; above for roof mounts. */
  syncSightDepth(slot = this.s.player.weapon): void {
    const h = this.s.player;
    const z = this.s.fireControl.playerMuzzleZ(slot);
    const off =
      socketHullPlacement(h.spec.sockets[slot]) === "above"
        ? this.s.fireControl.playerMuzzleDepthOff(slot)
        : ZOff.body - 0.2;
    this.sight.setDepth(worldDepth(z, off, h.y));
  }

  /** True once the aim point is past the barrel (pivot → muzzle + 1). */
  sightPastMuzzle(
    emit: { x: number; y: number },
    clip: { x: number; y: number },
    slot = this.s.player.weapon,
    pivot?: { x: number; y: number }
  ): boolean {
    let px = pivot?.x ?? this.s.player.x;
    let py = pivot?.y ?? this.s.player.y;
    if (!pivot) {
      const h = this.s.player;
      const socket = h.spec.sockets[slot];
      if (socket?.class === "turret") {
        const gun = this.s.hostCraft.guns[this.s.hostCraft.gunVisualIndexForSlot(slot)] ?? this.s.hostCraft.gun;
        if (gun?.visible) {
          const at = screenToWorldAtZ(gun.x, gun.y, h.z);
          px = at.x;
          py = at.y;
        }
      }
    }
    const near = Math.hypot(emit.x - px, emit.y - py) + 1;
    return Math.hypot(clip.x - px, clip.y - py) > near;
  }

  /** Dotted curve estimating gravity-bomb path from the active bay. */
  drawBombTrajectory(aim: { x: number; y: number }): void {
    const h = this.s.player;
    const spec = this.s.loadout[h.weapon]!;
    const g = this.sight;
    g.clear();
    const pylon = this.s.fireControl.dropShotOrigin(h.weapon);
    const release = this.s.fireControl.bombReleaseVelocity(spec, pylon.x, pylon.y, aim, 0, h.weapon);
    this.strokeBombTrajectoryPath(
      pylon.x,
      pylon.y,
      h.z + ZOff.shot,
      release,
      spec,
      aim
    );
  }

  strokeBombTrajectoryPath(
    ox: number,
    oy: number,
    oz: number,
    release: { vx: number; vy: number; vz: number },
    spec: PlayerWpnSpec,
    aim: { x: number; y: number }
  ): void {
    const g = this.sight;
    let x = ox;
    let y = oy;
    let z = oz;
    let vx = release.vx;
    let vy = release.vy;
    let vz = release.vz;
    const grav = launchGravity(spec.launch)?.acceleration ?? 210;
    const term = launchGravity(spec.launch)?.terminalVelocity ?? 520;
    const step = 1 / 36;
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i < 140; i++) {
      vz = Math.max(-term, vz - grav * step);
      x += vx * step;
      y += vy * step;
      z += vz * step;
      const gnd = groundZ(this.s.world, x, y);
      const at = worldToScreen(x, y, z);
      pts.push({ x: at.x, y: at.y });
      if (z <= gnd + 4) break;
      if (targetingMode(spec.guidance) === "waypoint") {
        const want = Math.atan2(aim.y - y, aim.x - x);
        const da = Phaser.Math.Angle.Wrap(want - Math.atan2(vy, vx));
        const rate = (spec.guidance?.flight.turnRate ?? 1.5) * step;
        const face = Math.atan2(vy, vx) + Phaser.Math.Clamp(da, -rate, rate);
        const horiz = Math.hypot(vx, vy);
        vx = Math.cos(face) * horiz;
        vy = Math.sin(face) * horiz;
      }
    }
    g.lineStyle(2, 0xf0d56a, 0.85);
    for (let i = 0; i < pts.length; i++) {
      if (i % 2 === 1) continue;
      const a = pts[i]!;
      const b = pts[Math.min(i + 1, pts.length - 1)]!;
      g.lineBetween(a.x, a.y, b.x, b.y);
    }
    const impact = pts[pts.length - 1];
    if (impact) {
      g.lineStyle(1.8, 0xf0d56a, 0.95);
      g.strokeCircle(impact.x, impact.y, 9);
      g.lineStyle(1.2, 0xf0d56a, 0.55);
      g.strokeCircle(impact.x, impact.y, 14);
    }
  }

  drawSightLine(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    kind: "cannon" | "missile",
    clear = true,
    /** World hit used for tip sparkle (terrain-swept reflection flicker). */
    tipHit?: { x: number; y: number; z: number }
  ): void {
    const g = this.sight;
    if (clear) g.clear();
    const missile = kind === "missile";
    const thermal = this.s.thermal.on;
    // Thermal: encode as semantic heat (magenta) so the post shader reads the beam as hot.
    const line = thermal ? thermalSignalTint(1) : missile ? 0xff2a18 : 0x4dff62;
    const glow = thermal ? thermalSignalTint(0.92) : missile ? 0xff6a3a : line;
    const halo = thermal ? thermalSignalTint(0.98) : missile ? 0xff8a62 : 0x5cff6a;
    const core = thermal ? thermalSignalTint(1) : missile ? 0xffece4 : 0xd8ffc4;
    const aMul = thermal ? 1.35 : 1;
    const dx = x1 - x0;
    const dy = y1 - y0;
    if (dx * dx + dy * dy >= 36) {
      const segs = 28;
      for (let i = 0; i < segs; i++) {
        const t0 = i / segs;
        const t1 = (i + 1) / segs;
        // Normal: quadratic fade (dead zone near muzzle). Thermal: linear so it
        // fades out all the way to the origin instead of vanishing early.
        const t = thermal ? t1 : t1 * t1;
        if (thermal) {
          // Same stroke widths as missile, hotter alphas + faint halo.
          g.lineStyle(4.6, glow, Math.min(1, t * 0.16 * aMul));
          g.lineBetween(x0 + dx * t0, y0 + dy * t0, x0 + dx * t1, y0 + dy * t1);
          g.lineStyle(2.4, glow, Math.min(1, t * 0.48 * aMul));
          g.lineBetween(x0 + dx * t0, y0 + dy * t0, x0 + dx * t1, y0 + dy * t1);
          g.lineStyle(1.15, line, Math.min(1, t * 0.82 * aMul));
          g.lineBetween(x0 + dx * t0, y0 + dy * t0, x0 + dx * t1, y0 + dy * t1);
        } else if (missile) {
          g.lineStyle(2.4, glow, Math.min(1, t * 0.32 * aMul));
          g.lineBetween(x0 + dx * t0, y0 + dy * t0, x0 + dx * t1, y0 + dy * t1);
          g.lineStyle(1.15, line, Math.min(1, t * 0.55 * aMul));
          g.lineBetween(x0 + dx * t0, y0 + dy * t0, x0 + dx * t1, y0 + dy * t1);
        } else {
          g.lineStyle(1, line, t * 0.42);
          g.lineBetween(x0 + dx * t0, y0 + dy * t0, x0 + dx * t1, y0 + dy * t1);
        }
      }
    }
    this.drawSightTip(x1, y1, {
      missile,
      thermal,
      aMul,
      glow,
      halo,
      core,
      tipHit,
    });
  }

  /**
   * Soft bloom at the laser contact point. Size jitters from a spatial hash of the
   * hit (incl. ground z as salt) so sweeping across terrain reads as a live reflection.
   */
  drawSightTip(
    x: number,
    y: number,
    opt: {
      missile: boolean;
      thermal: boolean;
      aMul: number;
      glow: number;
      halo: number;
      core: number;
      tipHit?: { x: number; y: number; z: number };
    }
  ): void {
    const g = this.sight;
    const hit = opt.tipHit;
    let sparkle = 0.55;
    if (hit) {
      // Cheap hash — continuous enough that neighboring cells blend, discrete enough to flicker.
      const n =
        Math.sin(hit.x * 0.071 + hit.z * 0.13) * 12.9898 +
        Math.cos(hit.y * 0.063 - hit.z * 0.09) * 78.233 +
        Math.sin((hit.x + hit.y) * 0.037 + hit.z * 0.21) * 4.141;
      sparkle = Phaser.Math.Clamp(0.5 + 0.5 * Math.sin(n), 0, 1);
      // Mild temporal shimmer so a parked tip still breathes.
      const t = this.s.time.now * 0.001;
      sparkle = Phaser.Math.Clamp(
        sparkle * (0.9 + 0.1 * Math.sin(t * 11.3 + n * 0.7)) +
          0.05 * Math.sin(t * 23.1 + hit.z * 0.4),
        0,
        1
      );
    }
    const sizeMul = Phaser.Math.Linear(0.72, 1.32, sparkle);
    const base = opt.thermal ? 2.35 : opt.missile ? 2.05 : 1.55;
    const r = base * sizeMul;
    const a = opt.aMul;
    // Soft falloff rings (outer → core) instead of three hard discs.
    g.fillStyle(opt.glow, Math.min(1, 0.1 * a));
    g.fillCircle(x, y, r * 2.55);
    g.fillStyle(opt.glow, Math.min(1, 0.18 * a));
    g.fillCircle(x, y, r * 1.85);
    g.fillStyle(opt.halo, Math.min(1, 0.32 * a));
    g.fillCircle(x, y, r * 1.28);
    g.fillStyle(opt.halo, Math.min(1, 0.58 * a));
    g.fillCircle(x, y, r * 0.82);
    g.fillStyle(opt.core, Math.min(1, 0.92 * a));
    g.fillCircle(x, y, r * 0.42);
    g.fillStyle(opt.core, 1);
    g.fillCircle(x, y, r * 0.22);
  }

  /**
   * Laser-sight emit points for the selected cannon slot.
   * Multi-muzzle / multi-gun stations collapse to one beam at the average tip.
   */
  cannonSightOrigins(slot = this.s.player.weapon): { x: number; y: number }[] {
    const h = this.s.player;
    const socket = h.spec.sockets[slot];
    let tips: { x: number; y: number }[] = [];
    if (socket?.class === "fixed") {
      const muzzles = craftSocketPoints(h.spec, socket);
      if (muzzles.length) tips = muzzles.map((m) => this.s.hostCraft.craftBodyMountWorldPos(m));
    } else if (socket?.class === "turret") {
      const barrelN = Math.max(1, craftSocketBarrelCount(h.spec, slot));
      for (let b = 0; b < barrelN; b++) {
        const gunI = this.s.hostCraft.gunVisualIndexForSlot(slot, b);
        const gun = this.s.hostCraft.guns[gunI] ?? this.s.hostCraft.gun;
        if (!gun?.visible) continue;
        const muzzles = lookupSpriteMuzzles(gun.texture.key);
        if (!muzzles.length) continue;
        for (let i = 0; i < muzzles.length; i++) tips.push(this.s.hostCraft.gunTip(gunI, i));
      }
    }
    if (!tips.length) {
      const bodyMuzzles = craftFixedMuzzles(h.spec);
      if (bodyMuzzles.length) tips = bodyMuzzles.map((m) => this.s.hostCraft.craftBodyMountWorldPos(m));
      else tips = [this.s.hostCraft.gunTip(this.s.hostCraft.gunVisualIndexForSlot(slot))];
    }
    return collapseSightTips(tips);
  }

  /** Hide reticle + laser when the bird is dead / mission over. */
  /** Build the reticle, reticle mark and laser-sight graphics (scene create). */
  create(): void {
    this.reticle = this.s.add.image(0, 0, "mark_reticle").setDepth(Layer.HUD).setScrollFactor(0);
    this.reticleMark = this.s.add.graphics().setDepth(Layer.HUD).setScrollFactor(0);
    this.sight = this.s.add.graphics().setDepth(Layer.WORLD);
  }

  /** Reticle + mark are HUD chrome; the laser sight is world-depth under the hull. */
  bindCameras(): void {
    this.s.bindHud(this.reticle);
    this.s.bindHud(this.reticleMark);
    this.s.hudSet.delete(this.sight);
    this.sight.cameraFilter = this.s.hudCam.id | this.s.fieldHudCam.id;
  }

  /** Remote bomb drop arc from a release point (remote weapons supply the physics). */
  drawTrajectoryArc(
    tip: { x: number; y: number; z: number },
    release: Parameters<ReticleHud["strokeBombTrajectoryPath"]>[3],
    spec: Parameters<ReticleHud["strokeBombTrajectoryPath"]>[4],
    aim: Parameters<ReticleHud["strokeBombTrajectoryPath"]>[5],
    depthY: number
  ): void {
    this.sight.clear();
    this.strokeBombTrajectoryPath(tip.x, tip.y, tip.z, release, spec, aim);
    this.sight.setDepth(worldDepth(tip.z, ZOff.shot + 2, depthY));
  }

  showAimChrome(): void {
    this.reticle.setVisible(true);
    this.reticleMark.setVisible(true);
    this.sight.setVisible(true);
  }

  hideAimChrome(): void {
    this.reticle?.setVisible(false);
    this.reticleMark?.setVisible(false);
    this.reticleMark?.clear();
    this.sight?.setVisible(false);
    this.sight?.clear();
  }
}
