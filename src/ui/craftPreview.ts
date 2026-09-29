import Phaser from "phaser";
import {
  craftComposite,
  craftCompositePartScale,
  craftExhaustMounts,
  craftGunSocketSlots,
  craftPreviewExhaustScale,
  craftPreviewExhaustTint,
  craftRotorAlongScale,
  craftRotorPreviewSpinMs,
  type CraftComposite,
  type CraftSpec,
} from "../sim/crafts";
import { spritePivot, spriteUvPos } from "../art/sprites";

export interface CraftPreviewOverrides {
  /**
   * Replaces every gun mount's art/scale. Remotes (RemoteSpec.gun/gunTex/gunScale) can carry an
   * onboard gun that differs from whatever's in the underlying hull's own socket loadout — the
   * hull is just borrowed for flight/sockets, not what's actually mounted on this specific unit.
   */
  gun?: { tex?: string; scale?: number; hullScale?: number };
}

export interface CraftPreviewOverlay {
  /** Guns whose mount layer is "below" — must render behind `art`, not in front of it. */
  below: (Phaser.GameObjects.Image | Phaser.GameObjects.Container)[];
  /** Everything else (guns "above", exhaust glow, rotors) — renders in front of `art`. */
  above: (Phaser.GameObjects.Image | Phaser.GameObjects.Container)[];
  /**
   * Gun overlay images, parallel to `craftGunSocketSlots(craft)` (same order/index) — the hull's
   * own "gun" role point is the turret's pivot/base, not its muzzle; finding a specific gun's
   * actual barrel tip means reading a "muzzle" point off its own texture via this image's live
   * transform (spriteUvPos), not the hull's.
   */
  gunImages: Phaser.GameObjects.Image[];
  /** Re-reads `art`'s current transform and re-positions every part — call this each frame
   * while `art` is still animating (e.g. mid-tween) so the overlay never lags behind it. */
  reposition(): void;
  destroy(): void;
}

/**
 * Builds the idle rotor/exhaust/gun overlay for a craft body image already in the scene — the
 * shared preview used by the menu carousel and the field manual. Positions come from `art`'s
 * current transform (spriteUvPos); depth is set relative to `art.depth` so the overlay always
 * stacks above the body no matter what depth `art` itself is at. Call `reposition()` whenever
 * `art` moves/scales on its own (e.g. a tween) to keep the overlay glued to it in real time.
 */
export function buildCraftPreviewOverlay(
  scene: Phaser.Scene,
  art: Phaser.GameObjects.Image,
  craft: CraftSpec,
  overrides?: CraftPreviewOverrides
): CraftPreviewOverlay {
  const composite: CraftComposite = craftComposite(craft);
  const along = craftRotorAlongScale(craft);
  const gunSlots = craftGunSocketSlots(craft);
  const gunOverrideTex = overrides?.gun?.tex && scene.textures.exists(overrides.gun.tex) ? overrides.gun.tex : undefined;

  const guns = composite.guns.map((part, i) => {
    const sock = craft.sockets[gunSlots[i] ?? -1];
    const tex = gunOverrideTex ?? part.tex;
    const origin = gunOverrideTex ? spritePivot(gunOverrideTex) : part.origin;
    const img = scene.add.image(0, 0, tex).setOrigin(origin.x, origin.y).setRotation(part.heading ?? 0);
    const isOverride = overrides?.gun != null;
    // In-mission a remote's hull draws at spec.scale × zoom but its gun at gunScale × zoom, so the
    // gun is gunScale / spec.scale of the hull — divide by the hull's scale to keep that ratio here.
    const gunScale = isOverride
      ? (overrides!.gun!.scale ?? sock?.gunScale ?? 1) / (overrides!.gun!.hullScale || 1)
      : (sock?.gunScale ?? 1);
    return { img, part, gunScale, isOverride };
  });

  const exhaustMounts = craftExhaustMounts(craft);
  const exhaustTint = craftPreviewExhaustTint(craft.kind);
  const exhaust = exhaustMounts.map((mount, i) => {
    const img = scene.add
      .image(0, 0, "fx_exhaust_glow")
      .setOrigin(0.5, 0)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(exhaustTint);
    scene.tweens.add({
      targets: img,
      alpha: { from: 0.5 + (i % 2) * 0.08, to: 0.96 },
      duration: 780 + i * 90,
      yoyo: true,
      repeat: -1,
      ease: "Sine.InOut",
    });
    return { img, mount };
  });

  const rotors = composite.rotors.map((part) => {
    const rotor = scene.add.image(0, 0, part.tex).setOrigin(part.origin.x, part.origin.y);
    const sign = part.spinSign ?? -1;
    scene.tweens.add({
      targets: rotor,
      rotation: sign * Math.PI * 2,
      duration: craftRotorPreviewSpinMs(craft),
      repeat: -1,
      ease: "Linear",
    });
    const host = along < 0.999 ? scene.add.container(0, 0).add(rotor) : rotor;
    return { host, rotor, part };
  });

  // "below" (the mount data's default) must render behind the body, not just behind the other
  // overlay parts — e.g. a side-mounted gun partly hidden by the fuselage. Only "above" mounts
  // (dorsal turrets, etc.) sit in front of it.
  const gunsBelow = guns.filter((g) => g.part.layer !== "above").map((g) => g.img);
  const gunsAbove = guns.filter((g) => g.part.layer === "above").map((g) => g.img);
  const below = gunsBelow;
  const above = [...exhaust.map((e) => e.img), ...gunsAbove, ...rotors.map((r) => r.host)];

  const reposition = () => {
    guns.forEach(({ img, part, gunScale, isOverride }) => {
      const at = spriteUvPos(art, part.mount.x, part.mount.y);
      // An override's scale is already the whole story (matches how a live remote's own gun is
      // scaled in-mission — spec.gunScale × camera scale, with no separate hull overlay term).
      const gunSc = isOverride ? gunScale * art.scaleX : (craft.gunOverlayScale ?? 1) * gunScale * art.scaleX;
      img.setPosition(at.x, at.y).setScale(gunSc);
    });
    exhaust.forEach(({ img, mount }) => {
      const at = spriteUvPos(art, mount.x, mount.y);
      const sc = craftPreviewExhaustScale(art.scaleX);
      img.setPosition(at.x, at.y).setScale(sc.x, sc.y);
    });
    rotors.forEach(({ host, rotor, part }) => {
      const at = spriteUvPos(art, part.mount.x, part.mount.y);
      const sc = craftCompositePartScale(part, rotor.width, art.scaleX);
      if (host !== rotor) {
        (host as Phaser.GameObjects.Container).setPosition(at.x, at.y).setScale(sc, sc * along);
      } else {
        host.setPosition(at.x, at.y).setScale(sc);
      }
    });
    // Depth is only meaningful for callers that stack by absolute depth (e.g. the menu ring);
    // callers that stack by container child order (e.g. the field manual) ignore this and use
    // `below`/`above` to insert relative to the body instead. Small fractional steps keep
    // `below` under `art.depth` without assuming how much depth headroom the caller left below it.
    below.forEach((part, i) => part.setDepth(art.depth - 0.3 - i * 0.2));
    above.forEach((part, i) => part.setDepth(art.depth + 1 + i));
  };
  reposition();

  return {
    below,
    above,
    gunImages: guns.map((g) => g.img),
    reposition,
    destroy: () => [...below, ...above].forEach((p) => p.destroy()),
  };
}
