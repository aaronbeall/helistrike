
import Phaser from "phaser";
import { remoteHostAmmoWeapon } from "../../../sim/remoteRules";
import { drawBatteryIcon, BATTERY_ICON_W } from "../../../render/icons";
import { BULLET_TIME_DURATION } from "../weapons/countermeasures";
import { payloadIsRemote } from "../../../sim/payload";
import { PLAYER_WPNS, COUNTERMEASURES, type WpnId } from "../../../sim/combat";
import { Layer } from "../../../render/depth";
import { craftCrewHudTag, craftSocketMultiplicity, craftSocketStartingAmmo } from "../../../sim/crafts";
import type { MissionScene } from "../../missionScene";
import { fillRoundedRectFast, strokeRoundedRectFast } from "../../../render/fastShapes";
import { setTextColor } from "../../../render/textStyle";

/** Truncate a HUD label so `text` width stays within `maxW` (ellipsis). */
export function fitHudLabel(text: Phaser.GameObjects.Text, label: string, maxW: number): string {
  text.setText(label);
  if (text.width <= maxW) return label;
  let t = label;
  while (t.length > 1) {
    t = t.slice(0, -1);
    text.setText(`${t}…`);
    if (text.width <= maxW) return `${t}…`;
  }
  return "…";
}

/** Bottom weapon bar: loadout slots, escort/exit chips, countermeasure + bullet-time strips. */
export class WeaponHud {
  wpnBar!: Phaser.GameObjects.Graphics;
  /** Per-loadout-slot HUD chrome: key / name / ammo + optional crew status under the box. */
  wpnHudSlots!: {
    key: Phaser.GameObjects.Text;
    name: Phaser.GameObjects.Text;
    ammo: Phaser.GameObjects.Text;
    status: Phaser.GameObjects.Text;
  }[];
  /** Extra HUD chrome for POV remotes — Q to exit back to the bird. */
  exitHudSlot!: {
    key: Phaser.GameObjects.Text;
    name: Phaser.GameObjects.Text;
  };
  /** POV remotes with host escort — F toggles FOLLOW / HOLD. `status` names the host. */
  escortHudSlot!: {
    key: Phaser.GameObjects.Text;
    name: Phaser.GameObjects.Text;
    status: Phaser.GameObjects.Text;
  };
  /** Countermeasure prompt under the weapon slots. */
  cmHudLabel!: Phaser.GameObjects.Text;
  cmHudTime!: Phaser.GameObjects.Text;
  btHudLabel!: Phaser.GameObjects.Text;
  btHudTime!: Phaser.GameObjects.Text;

  constructor(readonly s: MissionScene) {}

  /** Grow weapon HUD text rows if a POV remote loadout is longer than the bird's. */
  ensureWpnHudSlots(n: number): void {
    const mk = (size: string, color: string, originX: number, originY = 0.5) =>
      this.s.add
        .text(0, 0, "", {
          fontFamily: "Share Tech Mono, monospace",
          fontSize: size,
          color,
        })
        .setOrigin(originX, originY)
        .setScrollFactor(0)
        .setDepth(Layer.HUD + 1)
        .setStroke("#12100c", 3);
    while (this.wpnHudSlots.length < n) {
      this.wpnHudSlots.push({
        key: mk("12px", "#a89868", 0, 0.5),
        name: mk("13px", "#f0d56a", 0, 0.5),
        ammo: mk("13px", "#e8d49a", 1, 0.5),
        status: mk("10px", "#7ad0ff", 0.5, 0).setStroke("#12100c", 2),
      });
    }
  }

  draw(): void {
    const h = this.s.player;
    const g = this.wpnBar;
    g.clear();
    const pov = this.s.remoteFleet.povHudRemote();
    const loadout = this.s.fireControl.hudLoadout();
    const ammoArr = this.s.fireControl.hudAmmo();
    const selected = this.s.fireControl.hudWeapon();
    const slotW = 168;
    const slotH = 38;
    const gap = 8;
    const escortOn = !!(pov?.spec.hostEscort);
    const escortW = escortOn ? 118 : 0;
    const escortGap = escortOn ? gap : 0;
    const exitW = pov ? 92 : 0;
    const exitGap = pov ? gap : 0;
    const n = loadout.length;
    this.ensureWpnHudSlots(n);
    const total =
      n * slotW +
      Math.max(0, n - 1) * gap +
      escortGap +
      escortW +
      exitGap +
      exitW;
    const x0 = this.s.scale.width / 2 - total / 2;
    const anyAuto =
      !pov && h.spec.sockets.some((s) => s.controller === "automatic");
    const povCm = pov ? pov.spec.countermeasure : undefined;
    const showCm = !pov || !!povCm;
    const cmStripH = showCm ? 30 : 8;
    const crewPad = anyAuto || escortOn ? 15 : 2;
    const y = this.s.scale.height - 10 - cmStripH - crewPad - slotH;
    const padX = 8;
    const barH = 3;
    const barY = y + slotH - 7;
    const barPad = 6;

    for (let i = 0; i < n; i++) {
      const wp = loadout[i]!;
      const reserve = ammoArr[i]!;
      const a =
        !pov && payloadIsRemote(wp.payload)
          ? this.s.remoteFleet.remotePoolDisplayAmmo(i, reserve)
          : reserve;
      const hostAmmoId = pov ? remoteHostAmmoWeapon(wp) : undefined;
      const hostSlot = hostAmmoId ? this.s.fireControl.hostWeaponSlot(hostAmmoId) : -1;
      const hostSpec = hostAmmoId ? PLAYER_WPNS[hostAmmoId as WpnId] : undefined;
      const cap =
        pov && hostSpec && hostSlot >= 0
          ? craftSocketStartingAmmo(hostSpec.ammo, h.spec, hostSlot)
          : pov
            ? craftSocketStartingAmmo(wp.ammo, pov.spec, i)
            : craftSocketStartingAmmo(wp.ammo, h.spec, i);
      // Launch gate uses hangar reserve; display can include live dockable remotes.
      const empty = !this.s.debugMenu.infAmmo && Number.isFinite(a) && a <= 0;
      // Dockable pools fill by summed remote health, not head count.
      const pooled = !pov && !!this.s.remoteFleet.dockableSlotRemote(i);
      const frac =
        this.s.debugMenu.infAmmo || !Number.isFinite(a) || !Number.isFinite(cap) || cap <= 0
          ? 1
          : Phaser.Math.Clamp((pooled ? this.s.remoteFleet.remotePoolHealth(i) : a) / cap, 0, 1);
      const low = !empty && Number.isFinite(a) && frac > 0 && frac <= 0.25;
      const sel = i === selected;
      const socket = pov ? pov.spec.sockets?.[i] : h.spec.sockets[i];
      const auto = !pov && socket?.controller === "automatic";
      const gunner = auto && !sel;
      // POV remote: its weapons are dead while it's submerged.
      const disabled = pov ? !this.s.remoteBody.canFire(pov) : this.s.fireControl.weaponSlotDisabled(i);
      const x = x0 + i * (slotW + gap);

      // Slot chrome — disabled is a shared visual (cloak today; other gates later).
      if (disabled) {
        g.fillStyle(sel ? 0x1a1a1c : 0x0e0e10, sel ? 0.88 : 0.62);
        fillRoundedRectFast(g, x, y, slotW, slotH, 3);
        g.lineStyle(1.4, sel ? 0x5a5a62 : 0x3a3a42, sel ? 0.85 : 0.55);
        strokeRoundedRectFast(g, x, y, slotW, slotH, 3, 1.4, sel ? 0x5a5a62 : 0x3a3a42, sel ? 0.85 : 0.55);
      } else if (sel) {
        g.fillStyle(empty ? 0xff3a2a : low ? 0xe89a3a : 0xe8b84a, 1);
        fillRoundedRectFast(g, x, y, slotW, slotH, 3);
      } else if (empty) {
        g.fillStyle(0x3a1410, 0.92);
        fillRoundedRectFast(g, x, y, slotW, slotH, 3);
        g.lineStyle(1.5, 0xff3a2a, 0.95);
        strokeRoundedRectFast(g, x, y, slotW, slotH, 3, 1.5, 0xff3a2a, 0.95);
      } else if (gunner && low) {
        g.fillStyle(0x142028, 0.82);
        fillRoundedRectFast(g, x, y, slotW, slotH, 3);
        g.lineStyle(1.5, 0xe89a3a, 0.9);
        strokeRoundedRectFast(g, x, y, slotW, slotH, 3, 1.5, 0xe89a3a, 0.9);
      } else if (gunner) {
        g.fillStyle(0x101820, 0.72);
        fillRoundedRectFast(g, x, y, slotW, slotH, 3);
        g.lineStyle(1.5, 0x4aa8e8, 0.9);
        strokeRoundedRectFast(g, x, y, slotW, slotH, 3, 1.5, 0x4aa8e8, 0.9);
      } else if (low) {
        g.fillStyle(0x2a1a0c, 0.78);
        fillRoundedRectFast(g, x, y, slotW, slotH, 3);
        g.lineStyle(1.4, 0xe89a3a, 0.9);
        strokeRoundedRectFast(g, x, y, slotW, slotH, 3, 1.4, 0xe89a3a, 0.9);
      } else {
        g.fillStyle(0x12100c, 0.55);
        fillRoundedRectFast(g, x, y, slotW, slotH, 3);
        g.lineStyle(1.2, 0xc4a24a, 0.55);
        strokeRoundedRectFast(g, x, y, slotW, slotH, 3, 1.2, 0xc4a24a, 0.55);
      }

      // Ammo fraction bar
      {
        const barX = x + barPad;
        const barW = slotW - barPad * 2;
        g.fillStyle(0x000000, sel ? 0.35 : 0.45);
        g.fillRect(barX, barY, barW, barH);
        const fill = empty
          ? 0xff3a2a
          : low
            ? sel
              ? 0x6a2a08
              : 0xe89a3a
            : sel
              ? 0x1c1812
              : gunner
                ? 0x5eb4e8
                : 0xc4a24a;
        g.fillStyle(fill, disabled ? 0.55 : sel ? 0.85 : 0.95);
        g.fillRect(barX, barY, Math.max(2, barW * frac), barH);
        // Pool battery badge on the top-right edge, only while not full.
        const batt = pooled ? this.s.remoteFleet.remotePoolBattery(i) : undefined;
        if (batt != null && batt < 0.999) {
          drawBatteryIcon(this.s.time, g, x + slotW - BATTERY_ICON_W - 6, y - 4, batt, 1);
        }
      }

      const row = this.wpnHudSlots[i]!;
      const midY = y + (slotH - barH - 4) / 2;
      const keyLp = this.s.hudLocal(x + padX, midY);
      const ammoLp = this.s.hudLocal(x + slotW - padX, midY);

      const ammoS = empty
        ? "—"
        : this.s.debugMenu.infAmmo || !Number.isFinite(a)
          ? "∞"
          : String(a | 0);
      const liveRemotes =
        !pov && payloadIsRemote(wp.payload)
          ? this.s.remotes.filter(
              (r) => !r.detonate && !r.dock && r.spec.kind === wp.payload!.remote!.kind
            )
          : [];
      const liveRemote = liveRemotes[0];
      const liveCount = liveRemotes.length;
      const pilotingThis =
        !!liveRemote &&
        this.s.remoteFleet.remoteView &&
        this.s.remoteFleet.pilotingRemote()?.id === liveRemote.id;
      const liveMark = liveCount > 0 && !pilotingThis && !disabled;
      const mult = pov ? 1 : craftSocketMultiplicity(h.spec, i);
      const rawName = liveRemote
        ? pilotingThis
          ? `${wp.name}  CTRL`
          : liveCount > 1
            ? `${wp.name}  LIVE ×${liveCount}`
            : `${wp.name}  LIVE`
        : mult > 1
          ? `${mult}× ${wp.name}`
          : wp.name;

      // Colors by state
      let keyCol = "#a89868";
      let nameCol = "#f0d56a";
      let ammoCol = "#e8d49a";
      let stroke = "#12100c";
      let strokeW = 3;
      if (disabled) {
        keyCol = nameCol = ammoCol = sel ? "#8a8a92" : "#6a6a72";
        stroke = "#0a0a0c";
        strokeW = 2;
      } else if (sel) {
        keyCol = nameCol = ammoCol = empty ? "#2a0808" : "#1c1812";
        stroke = empty ? "#2a0808" : "#1c1812";
        strokeW = 0;
      } else if (empty) {
        keyCol = nameCol = ammoCol = "#ff4a2a";
        stroke = "#1a0808";
      } else if (gunner) {
        keyCol = "#6aa8c8";
        nameCol = "#7ad0ff";
        ammoCol = low ? "#ff9a3a" : "#9ad8f0";
      } else if (low) {
        ammoCol = "#ff9a3a";
        nameCol = "#f0c878";
      }
      // Spectre airborne in bird-cam: green LIVE stands out from the yellow loadout chrome.
      if (liveMark) nameCol = sel ? "#0a4020" : "#3dff88";

      const textA = disabled ? (sel ? 0.55 : 0.4) : 1;
      setTextColor(row.key, keyCol)
        .setVisible(true)
        .setPosition(keyLp.x, keyLp.y)
        .setText(String(i + 1))
        .setStroke(stroke, strokeW)
        .setFontSize("12px")
        .setAlpha(disabled ? textA : sel ? 0.7 : 0.85);

      setTextColor(row.ammo, ammoCol)
        .setVisible(true)
        .setPosition(ammoLp.x, ammoLp.y)
        .setText(ammoS)
        .setStroke(stroke, strokeW)
        .setFontSize(low && !sel && !disabled ? "13px" : "12px")
        .setAlpha(textA);

      // Name sits between key and ammo; truncate so it never spills the box.
      const nameMaxW = Math.max(
        24,
        slotW - padX * 2 - row.key.width - 10 - row.ammo.width - 8
      );
      const nameStr = fitHudLabel(row.name, rawName, nameMaxW);
      const nameLp = this.s.hudLocal(x + padX + row.key.width + 6, midY);
      const liveBlink = liveMark
        ? 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(this.s.time.now * 0.014))
        : 1;
      setTextColor(row.name, nameCol)
        .setVisible(true)
        .setPosition(nameLp.x, nameLp.y)
        .setText(nameStr)
        .setStroke(stroke, strokeW)
        .setFontSize("13px")
        .setAlpha(disabled ? textA : liveBlink);

      if (auto) {
        const player = sel;
        const statusLp = this.s.hudLocal(x + slotW / 2, y + slotH + 3);
        const label = player
          ? "PILOT"
          : `${craftCrewHudTag(socket!) ?? "CREW"} GUNNER`;
        setTextColor(row.status, disabled ? "#6a6a72" : player ? "#e8b84a" : "#8ec8e8")
          .setVisible(true)
          .setPosition(statusLp.x, statusLp.y)
          .setText(label)
          .setStroke("#12100c", 2)
          .setAlpha(disabled ? 0.45 : player ? 0.95 : 0.85)
          .setFontSize("10px");
      } else if (liveMark && liveRemote?.spec.dockable) {
        const statusLp = this.s.hudLocal(x + slotW / 2, y + slotH + 3);
        setTextColor(row.status, sel ? "#0a4020" : "#3dff88")
          .setVisible(true)
          .setPosition(statusLp.x, statusLp.y)
          .setText("Q RECALL")
          .setStroke("#12100c", 2)
          .setAlpha(0.9)
          .setFontSize("10px");
      } else {
        row.status.setVisible(false).setText("");
      }
    }

    // POV remote: escort FOLLOW/HOLD chrome + Q EXIT (not weapon slots).
    if (escortOn) {
      const x = x0 + n * (slotW + gap);
      const follow = this.s.remoteFleet.hostEscortMode === "follow";
      g.fillStyle(follow ? 0x142028 : 0x12100c, follow ? 0.82 : 0.62);
      fillRoundedRectFast(g, x, y, escortW, slotH, 3);
      g.lineStyle(1.3, follow ? 0x4aa8e8 : 0x8a8470, follow ? 0.9 : 0.75);
      strokeRoundedRectFast(g, x, y, escortW, slotH, 3, 1.3, follow ? 0x4aa8e8 : 0x8a8470, follow ? 0.9 : 0.75);
      const midY = y + slotH / 2;
      const keyLp = this.s.hudLocal(x + padX, midY);
      setTextColor(this.escortHudSlot.key, follow ? "#6aa8c8" : "#a89868")
        .setVisible(true)
        .setPosition(keyLp.x, keyLp.y)
        .setText("C")
        .setStroke("#12100c", 3)
        .setFontSize("12px")
        .setAlpha(0.9);
      const nameLp = this.s.hudLocal(x + padX + this.escortHudSlot.key.width + 6, midY);
      setTextColor(this.escortHudSlot.name, follow ? "#7ad0ff" : "#f0d56a")
        .setVisible(true)
        .setPosition(nameLp.x, nameLp.y)
        .setText(this.s.remoteFleet.activeHostWaypoint() ? "WAYPOINT" : follow ? "FOLLOW" : "HOLD")
        .setStroke("#12100c", 3)
        .setFontSize("13px")
        .setAlpha(0.95);
      const statusLp = this.s.hudLocal(x + escortW / 2, y + slotH + 2);
      setTextColor(this.escortHudSlot.status, follow ? "#7ad0ff" : "#c4b48a")
        .setVisible(true)
        .setPosition(statusLp.x, statusLp.y)
        .setText(`${h.spec.name.toUpperCase()} · G WAYPOINT`)
        .setStroke("#12100c", 2)
        .setFontSize("10px")
        .setAlpha(0.9);
    } else {
      this.escortHudSlot.key.setVisible(false);
      this.escortHudSlot.name.setVisible(false);
      this.escortHudSlot.status.setVisible(false);
    }
    if (pov) {
      const x = x0 + n * (slotW + gap) + escortGap + escortW;
      g.fillStyle(0x12100c, 0.62);
      fillRoundedRectFast(g, x, y, exitW, slotH, 3);
      g.lineStyle(1.3, 0x8a8470, 0.75);
      strokeRoundedRectFast(g, x, y, exitW, slotH, 3, 1.3, 0x8a8470, 0.75);
      const midY = y + slotH / 2;
      const keyLp = this.s.hudLocal(x + padX, midY);
      setTextColor(this.exitHudSlot.key, "#a89868")
        .setVisible(true)
        .setPosition(keyLp.x, keyLp.y)
        .setText("Q")
        .setStroke("#12100c", 3)
        .setFontSize("12px")
        .setAlpha(0.9);
      const nameLp = this.s.hudLocal(x + padX + this.exitHudSlot.key.width + 6, midY);
      const canDock = !!(pov.spec.dockable && this.s.remoteFleet.remoteNearHost(pov));
      setTextColor(this.exitHudSlot.name, canDock ? "#3dff88" : "#f0d56a")
        .setVisible(true)
        .setPosition(nameLp.x, nameLp.y)
        .setText(canDock ? "DOCK" : "EXIT")
        .setStroke("#12100c", 3)
        .setFontSize("13px")
        .setAlpha(0.95);
    } else {
      this.exitHudSlot.key.setVisible(false);
      this.exitHudSlot.name.setVisible(false);
    }

    if (showCm) {
      this.drawCountermeasureHud(y + slotH + crewPad + 2);
    } else {
      this.cmHudLabel?.setVisible(false);
      this.cmHudTime?.setVisible(false);
    }
    this.drawBulletTimeHud(y + slotH + crewPad + 2 + (showCm ? 18 : 0));
    this.s.prompts.syncRemotePrompt(y);
    // Hide unused rows if loadout shrank (shouldn't normally).
    for (let i = n; i < this.wpnHudSlots.length; i++) {
      const row = this.wpnHudSlots[i]!;
      row.key.setVisible(false);
      row.name.setVisible(false);
      row.ammo.setVisible(false);
      row.status.setVisible(false);
    }
  }

  drawCountermeasureHud(y: number): void {
    const g = this.wpnBar;
    const pov = this.s.remoteFleet.povHudRemote();
    const id = this.s.countermeasures.craftCmId();
    if (!this.cmHudLabel) {
      this.cmHudTime?.setVisible(false);
      return;
    }
    const spec = COUNTERMEASURES[id];
    const cd = pov ? (pov.cmCd ?? 0) : this.s.countermeasures.cd;
    const cx = this.s.scale.width / 2;
    let activeT = 0;
    let activeMax = 0;
    let barCol = 0xc4a24a;
    // Time Warp is a charge meter (pausable): bar = charge, recharge shows as a percentage.
    const warpMeter = !pov && id === "timewarp";
    if (warpMeter && this.s.countermeasures.timewarpT > 0) {
      activeT = this.s.countermeasures.timewarpT;
      activeMax = spec.duration;
      barCol = 0x5ce8ff;
    } else if (!pov && id === "phase_cloak" && this.s.countermeasures.cloakT > 0) {
      activeT = this.s.countermeasures.cloakT;
      activeMax = spec.duration;
      barCol = 0xc8d4e8;
    } else if (!pov && id === "reactive_armor" && this.s.countermeasures.reactiveArmorT > 0) {
      activeT = this.s.countermeasures.reactiveArmorT;
      activeMax = spec.duration;
      barCol = 0xffb040;
    } else if (id === "smoke_screen" && (pov ? (pov.smokeT ?? 0) : this.s.countermeasures.smokeScreenT) > 0) {
      activeT = pov ? (pov.smokeT ?? 0) : this.s.countermeasures.smokeScreenT;
      activeMax = spec.duration;
      barCol = 0xa8a090;
    }
    const warpCharging = warpMeter && activeT <= 0 && this.s.countermeasures.timewarpCharge < 0.999;
    const cooling = warpMeter ? warpCharging : cd > 0;
    const frac = warpMeter
      ? this.s.countermeasures.timewarpCharge
      : cooling
        ? Phaser.Math.Clamp(1 - cd / spec.cooldown, 0, 1)
        : activeT > 0
          ? Phaser.Math.Clamp(activeT / Math.max(0.05, activeMax), 0, 1)
          : 1;
    const label = `(${warpMeter ? "E/F" : "F"}) ${spec.name}`;
    const timeS = activeT > 0
      ? `${activeT.toFixed(1)}s`
      : warpCharging
        ? `${Math.round(this.s.countermeasures.timewarpCharge * 100)}%`
        : cooling
          ? `${cd.toFixed(1)}s`
          : "READY";
    const labelCol = activeT > 0 ? (id === "timewarp" || id === "emp" ? "#8ee8ff" : "#f0d56a") : cooling ? "#c4a24a" : "#e8b84a";
    const timeCol = activeT > 0 ? (id === "timewarp" || id === "emp" ? "#b8ffff" : "#f0d56a") : cooling ? "#e89a3a" : "#8a8470";
    const barW = 168;
    const barH = 5;
    const timeGap = 8;
    const labelGap = 10;
    this.cmHudTime.setText(timeS).setFontSize("11px");
    const timeW = this.cmHudTime.width;
    const rowW = barW + timeGap + timeW;
    const barX = cx - rowW / 2;
    const barY = y + 13;
    g.fillStyle(0x000000, 0.4);
    fillRoundedRectFast(g, barX - 2, barY - 2, barW + 4, barH + 4, 2);
    g.fillStyle(activeT > 0 ? 0x163048 : 0x1c1812, 0.88);
    fillRoundedRectFast(g, barX, barY, barW, barH, 2);
    if (frac > 0) {
      g.fillStyle(cooling ? 0xa07030 : barCol, 0.95);
      fillRoundedRectFast(g, barX, barY, Math.max(2, barW * frac), barH, 2);
    }
    const midY = barY + barH / 2;
    const labelLp = this.s.hudLocal(barX - labelGap, midY);
    setTextColor(this.cmHudLabel, labelCol)
      .setVisible(true)
      .setPosition(labelLp.x, labelLp.y)
      .setText(label)
      .setAlpha(1);
    const timeLp = this.s.hudLocal(barX + barW + timeGap, midY);
    setTextColor(this.cmHudTime, timeCol)
      .setVisible(true)
      .setPosition(timeLp.x, timeLp.y)
      .setAlpha(1);
  }

  /** Bullet-time meter row (E), same layout as the CM row — only while below full. */
  drawBulletTimeHud(y: number): void {
    const show = this.s.countermeasures.bulletMeter < 0.999 && !!this.btHudLabel;
    this.btHudLabel?.setVisible(show);
    this.btHudTime?.setVisible(show);
    if (!show) return;
    const g = this.wpnBar;
    const on = this.s.countermeasures.bulletOn;
    const barW = 168;
    const barH = 5;
    const timeGap = 8;
    const labelGap = 10;
    this.btHudTime
      .setText(on ? `${(this.s.countermeasures.bulletMeter * BULLET_TIME_DURATION).toFixed(1)}s` : `${Math.round(this.s.countermeasures.bulletMeter * 100)}%`)
      .setFontSize("11px");
    const rowW = barW + timeGap + this.btHudTime.width;
    const barX = this.s.scale.width / 2 - rowW / 2;
    const barY = y + 13;
    g.fillStyle(0x000000, 0.4);
    fillRoundedRectFast(g, barX - 2, barY - 2, barW + 4, barH + 4, 2);
    g.fillStyle(on ? 0x221638 : 0x1c1812, 0.88);
    fillRoundedRectFast(g, barX, barY, barW, barH, 2);
    if (this.s.countermeasures.bulletMeter > 0) {
      g.fillStyle(on ? 0xb48cff : 0x7a6cc8, 0.95);
      fillRoundedRectFast(g, barX, barY, Math.max(2, barW * this.s.countermeasures.bulletMeter), barH, 2);
    }
    const midY = barY + barH / 2;
    const labelLp = this.s.hudLocal(barX - labelGap, midY);
    setTextColor(this.btHudLabel, on ? "#d6c2ff" : "#a898d8")
      .setPosition(labelLp.x, labelLp.y)
      .setText("(E) BULLET TIME");
    const timeLp = this.s.hudLocal(barX + barW + timeGap, midY);
    setTextColor(this.btHudTime.setPosition(timeLp.x, timeLp.y), on ? "#e8dcff" : "#8a80a8");
  }

}
