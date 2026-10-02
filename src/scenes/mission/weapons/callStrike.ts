import Phaser from "phaser";
import { jitterDisk } from "../../../util/rng";
import { PLAYER_WPNS, type WpnId, type WeaponPayload } from "../../../sim/combat";
import { Layer, ZOff, worldDepth } from "../../../render/depth";
import { range } from "../../../util/rng";
import { groundZ, worldToScreen, cameraPointVisible, WORLD } from "../../../worldgen/world";
import type { MissionScene } from "../../missionScene";

/** Call strike: arming, host aim, ground marks + ETA text, shell spawn, impact notes. */
export class CallStrike {
  /**
   * Active call-strike marks (flare settled → off-map barrage).
   * Payload-driven; any craft weapon with `callStrike` can arm one.
   */
  marks: {
    id: number;
    x: number;
    y: number;
    z: number;
    /** Countdown to first shell (from `callStrike.delay`; 0 = immediate). */
    delayT: number;
    roundsLeft: number;
    interval: number;
    intervalT: number;
    jitter: number;
    shellDmg: number;
    shellBlast: number;
    shellLook: string;
    shellSpeed: number;
    /** Fixed off-map origin for this barrage's shells (target X + map width). */
    spawnX: number;
    spawnY: number;
    spawnZ: number;
    /** Shells that have already impacted. */
    hitsLanded: number;
    /** Keep flare FX until this many hits. */
    flareUntilHits: number;
    /** Countdown to first shell impact — ETA label hides when this hits 0. */
    firstImpactEta: number;
    /**
     * When set (HOUND / POV observer), each round fires this host craft weapon
     * at the mark instead of a synthetic off-map shell.
     */
    hostWeapon?: WpnId;
    /** Host-walk aim oscillator (seconds). */
    wobbleT?: number;
    /** Live slew/fire point — wobbles around the mark for host howitzer walks. */
    aimX?: number;
    aimY?: number;
  }[] = [];
  nextMarkId = 1;
  /** Pooled ETA labels for live call-strike flares. */
  etaTxt: Phaser.GameObjects.Text[] = [];

  constructor(readonly s: MissionScene) {}

  /** Per-mission state reset (called from the scene's init). */
  reset(): void {
    this.marks = [];
    this.nextMarkId = 1;
    this.etaTxt = [];
  }

  /** Arm a reusable mark-then-call barrage at the flare's rest point. */
  arm(
    x: number,
    y: number,
    z: number,
    spec: NonNullable<WeaponPayload["callStrike"]>,
    spawnFrom?: { x: number; y: number; z: number },
    hostWeapon?: WpnId
  ): void {
    const markZ = Math.max(z, groundZ(this.s.world, x, y));
    // Default: inbound from one map-width to the right. Host-spawn = dropship fire support.
    const spawnX = spawnFrom?.x ?? x + WORLD;
    const spawnY = spawnFrom?.y ?? y;
    const spawnZ = spawnFrom?.z ?? 1500;
    const delayT = Math.max(0, spec.delay ?? 0);
    const hostSpec = hostWeapon ? PLAYER_WPNS[hostWeapon] : undefined;
    const shellSpeed = hostSpec?.speed ?? spec.shellSpeed ?? 400;
    const interval = hostSpec
      ? Math.max(0.12, hostSpec.fireCd)
      : Math.max(0.12, spec.interval);
    let roundsLeft = Math.max(1, spec.rounds | 0);
    if (hostWeapon && !this.s.debugMenu.infAmmo) {
      const left = this.s.hostWeaponAmmoLeft(hostWeapon);
      if (left != null && Number.isFinite(left)) {
        roundsLeft = Math.min(roundsLeft, Math.max(0, left | 0));
      }
    }
    if (roundsLeft <= 0) return;
    const flightDist = hostWeapon
      ? Math.hypot(this.s.player.x - x, this.s.player.y - y)
      : Math.hypot(spawnX - x, spawnY - y);
    const firstImpactEta = delayT + flightDist / Math.max(80, shellSpeed);
    this.marks.push({
      id: this.nextMarkId++,
      x,
      y,
      z: markZ,
      delayT,
      roundsLeft,
      interval,
      intervalT: 0,
      jitter: Math.max(8, spec.jitter),
      shellDmg: hostSpec?.dmg ?? spec.shellDmg,
      shellBlast: hostSpec?.blast ?? spec.shellBlast,
      shellLook: hostSpec?.art.look ?? spec.shellLook,
      shellSpeed,
      spawnX,
      spawnY,
      spawnZ,
      hitsLanded: 0,
      flareUntilHits: Math.max(1, spec.flareUntilHits ?? 3),
      firstImpactEta,
      hostWeapon,
      wobbleT: 0,
      aimX: x,
      aimY: y,
    });
  }

  /** Back-and-forth walk aim around a host call-strike mark (slew + fire point). */
  tickHostAim(
    m: (typeof this.marks)[number],
    dt: number
  ): void {
    m.wobbleT = (m.wobbleT ?? 0) + dt;
    const t = m.wobbleT;
    // Slow rotating axis; primary sin back-forth + lighter lateral sway.
    const axis = t * 0.41;
    const amp = m.jitter * (0.5 + 0.45 * (0.5 + 0.5 * Math.sin(t * 0.85)));
    const along = Math.sin(t * 2.15) * amp;
    const side = Math.sin(t * 0.73 + 1.1) * amp * 0.32;
    const ca = Math.cos(axis);
    const sa = Math.sin(axis);
    m.aimX = m.x + ca * along - sa * side;
    m.aimY = m.y + sa * along + ca * side;
  }

  tickMarks(dt: number): void {
    if (!this.marks.length) {
      this.hideEtaTxt();
      return;
    }
    let w = 0;
    let etaI = 0;
    for (const m of this.marks) {
      // Host howitzer walk: flare dies when the last shell is fired (hits aren't tagged).
      // Off-map barrages: keep signaling until the first few impacts land.
      const showFlare = m.hostWeapon
        ? m.roundsLeft > 0
        : m.hitsLanded < m.flareUntilHits;
      if (m.firstImpactEta > 0) m.firstImpactEta = Math.max(0, m.firstImpactEta - dt);

      // Heavy upward flare column while the mark is still signaling.
      if (showFlare && cameraPointVisible(m.z, m.y) && this.s.fxChance(0.92)) {
        const at = worldToScreen(m.x, m.y, m.z + 6);
        this.s.withTrailFx(1.7, () => {
          const nf = this.s.fxEmitCount(1.45);
          const ns = this.s.fxEmitCount(1.35);
          if (nf) {
            this.s.emitBudgeted(
              "fire",
              this.s.fxAt(m.z, m.y, this.s.signalFlareTrail, ZOff.fire + 0.4),
              at.x,
              at.y,
              nf
            );
          }
          if (ns) {
            this.s.emitBudgeted(
              "smoke",
              this.s.fxAt(m.z, m.y, this.s.signalFlareSmoke, ZOff.smoke),
              at.x,
              at.y,
              ns
            );
          }
        });
        if (this.s.fxChance(0.7)) {
          this.s.emitVisualBurst(
            m.x,
            m.y,
            m.z + 10,
            {
              n: 3,
              spdMin: 80,
              spdMax: 280,
              bx: range(-0.12, 0.12),
              by: -0.95,
              bz: 1.45,
              tight: 0.42,
              scaleMul: 0.75,
              gravity: 28,
              depthOff: ZOff.fire + 0.8,
            },
            this.s.signalFlareSpark
          );
        }
      }

      // ETA only until first impact — then the label goes away.
      if (m.firstImpactEta > 0) {
        this.syncEtaTxt(m, etaI++);
      }

      if (m.delayT > 0) {
        m.delayT -= dt;
        if (m.hostWeapon) this.tickHostAim(m, dt);
        this.marks[w++] = m;
        continue;
      }

      if (m.hostWeapon) {
        // Real howitzer walk: shared station CD, wobble aim, one shell per ready cycle.
        this.tickHostAim(m, dt);
        const aim = { x: m.aimX ?? m.x, y: m.aimY ?? m.y };
        if (this.s.hostStationFireReady(m.hostWeapon) && this.s.hostStationAlignedTo(m.hostWeapon, aim)) {
          const ok = this.s.fireHostWeaponAt(m.hostWeapon, aim, { fromStrike: true });
          if (!ok) {
            // Dry / missing mount — end the walk. CD-not-ready is handled above.
            m.roundsLeft = 0;
          } else {
            m.roundsLeft--;
          }
        }
        if (m.roundsLeft > 0) this.marks[w++] = m;
        continue;
      }

      m.intervalT -= dt;
      while (m.intervalT <= 0 && m.roundsLeft > 0) {
        this.spawnShell(m);
        m.roundsLeft--;
        m.intervalT += m.interval;
      }
      // Off-map: keep until authored rounds AND flare-until-hits are satisfied.
      if (m.roundsLeft > 0 || m.hitsLanded < m.flareUntilHits) {
        this.marks[w++] = m;
      }
    }
    this.marks.length = w;
    for (let i = etaI; i < this.etaTxt.length; i++) {
      const t = this.etaTxt[i];
      if (t?.active) t.setVisible(false);
    }
  }

  hideEtaTxt(): void {
    for (const t of this.etaTxt) {
      if (t?.active) t.setVisible(false);
    }
  }

  syncEtaTxt(
    m: (typeof this.marks)[number],
    i: number
  ): void {
    const at = worldToScreen(m.x, m.y, m.z + 10);
    if (!this.s.projectedInView(at.x, at.y, 80) || m.firstImpactEta <= 0) {
      const existing = this.etaTxt[i];
      if (existing?.active) existing.setVisible(false);
      return;
    }
    const txt = this.acquireEtaTxt(i);
    txt
      .setText(`${Math.max(1, Math.ceil(m.firstImpactEta))}s`)
      .setVisible(true)
      .setPosition(at.x, at.y - 18 * at.scale)
      .setDepth(worldDepth(m.z, ZOff.fire + 2, m.y))
      .setScale(Math.max(0.85, at.scale))
      .setAlpha(0.9);
  }

  acquireEtaTxt(i: number): Phaser.GameObjects.Text {
    while (this.etaTxt.length <= i) {
      this.etaTxt.push(this.makeEtaTxt());
    }
    const existing = this.etaTxt[i];
    if (!existing || !existing.active || !existing.scene) {
      this.etaTxt[i] = this.makeEtaTxt();
    }
    return this.etaTxt[i]!;
  }

  makeEtaTxt(): Phaser.GameObjects.Text {
    const t = this.s.add
      .text(0, 0, "", {
        fontFamily: "Share Tech Mono, monospace",
        fontSize: "13px",
        color: "#ff6a7a",
      })
      .setOrigin(0.5, 1)
      .setDepth(Layer.FIELD)
      .setVisible(false)
      .setStroke("#2a080c", 3)
      .setAlpha(0.9);
    this.s.bindFieldHud(t);
    return t;
  }

  /** One off-map shell on a lofted ballistic arc toward the mark (+disk jitter). */
  spawnShell(m: (typeof this.marks)[number]): void {
    const hit = jitterDisk(m.x, m.y, m.jitter);
    const tx = hit.x;
    const ty = hit.y;
    const tz = groundZ(this.s.world, tx, ty);
    // Same spawn for every round so inbound timing stays consistent.
    const sx = m.spawnX;
    const sy = m.spawnY;
    const sz = m.spawnZ;
    const dx = tx - sx;
    const dy = ty - sy;
    const distXY = Math.max(80, Math.hypot(dx, dy));
    const spd = Math.max(80, m.shellSpeed);
    const flightT = distXY / spd;
    const vx = (dx / distXY) * spd;
    const vy = (dy / distXY) * spd;
    // Mild gravity on a high spawn: mostly aimed at the mark, with a gentle
    // descending curve (not a sky-high loft) that steepens a bit on the way in.
    const grav = { acceleration: 22, terminalVelocity: 720 };
    const vz = this.s.solveBallisticMuzzleVz(
      sz,
      tz,
      flightT,
      grav.acceleration,
      grav.terminalVelocity
    );
    const ang = Math.atan2(dy, dx);
    this.s.spawnShot({
      from: "player",
      beh: {
        art: { look: m.shellLook, scale: 0.58, face: "velocity" },
        exhaust: {
          kind: "particles",
          size: 0.55,
          density: 0.85,
          contrail: true,
          // Base of the warhead (nose is tip-biased SHOT_ORIGIN).
          emitUv: { x: 0.08, y: 0.5 },
        },
        cam: { reticle: "round", look: { pull: 0.2, max: 88, rate: 10 } },
        control: { mode: "click" },
        launch: {
          mode: "muzzle",
          inheritMomentum: 0,
          gravity: grav,
        },
        payload: { detonate: { look: "fire", bigBoom: true } },
        cruiseSpeed: spd,
        dmg: m.shellDmg,
        blast: m.shellBlast,
        dmgMul: { building: 1.4, vehicle: 1.2, troop: 0.85, air: 0.2 },
      },
      st: {
        age: 0,
        launchAngle: ang,
        bomblet: true,
        opened: true,
        callStrikeMarkId: m.id,
        callStrikeTx: tx,
        callStrikeTy: ty,
        callStrikeTz: tz,
      },
      x: sx,
      y: sy,
      z: sz,
      vx,
      vy,
      vz,
      angle: ang,
      life: flightT + 0.35,
      blast: m.shellBlast,
      dmg: m.shellDmg,
      look: m.shellLook,
      scale: 0.58,
      fxInterval: 0.12,
    });
  }

  noteImpact(markId: number): void {
    for (const m of this.marks) {
      if (m.id === markId) {
        m.hitsLanded++;
        return;
      }
    }
  }
}
