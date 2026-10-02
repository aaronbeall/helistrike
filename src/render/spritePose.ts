import Phaser from "phaser";
import { troopSoftTurret, specOf, gunsOf, muzzlesOfGun, type ShotLook } from "../sim/roster";
import { textureOf, SHOT_ORIGIN, SHOT_TAIL, exhaustIsGunSpark, type Debris, type Unit, type Shot } from "../sim/combat";
import { spritePivot, spriteUvPos } from "../art/sprites";
import { gunWorldRot, lookupSpriteMuzzles, lookupSpriteOrigin, lookupSpritePoints } from "../art/spriteOrigin";
import type { RemoteCraft } from "../sim/remote";
import { craftGunScale, craftGunTex } from "../sim/crafts";
import { resolveSkin } from "./camo";
import { worldToScreen, screenVelX, screenVelY, projectHeading } from "../worldgen/world";
/** Shot sprite pose / orientation rules. */

export function shotIsGunOrBeam(s: Shot): boolean {
  if (s.beh) {
    return (
      s.beh.launch.mode === "beam" ||
      (s.beh.launch.mode === "muzzle" &&
        !s.beh.guidance &&
        (!s.beh.exhaust || exhaustIsGunSpark(s.beh.exhaust)))
    );
  }
  return !s.homePlayer && s.motor == null && !s.energyTrail && !s.energyTrails;
}

export function shotFacesHeading(s: Shot): boolean {
  if (s.beh?.art.face === "heading") return true;
  if (s.beh?.art.face === "velocity") return false;
  return !!(s.homePlayer || s.motor != null);
}

export function spriteHalf(textures: Phaser.Textures.TextureManager, key: string): number {
  if (!textures.exists(key)) return 18;
  const src = textures.get(key).getSourceImage() as { width: number; height: number };
  return Math.max(src.width, src.height) * 0.5;
}

export function debrisMountAt(textures: Phaser.Textures.TextureManager, host: Debris, mount: { x: number; y: number }): { x: number; y: number } {
  const pivot = spritePivot(host.key);
  const src = textures.exists(host.key)
    ? (textures.get(host.key).getSourceImage() as { width: number; height: number })
    : { width: 64, height: 64 };
  const sc = host.scale ?? 1;
  const dw = src.width * sc;
  const dh = src.height * sc;
  const mx = (mount.x - pivot.x) * dw;
  const my = (mount.y - pivot.y) * dh;
  const ca = Math.cos(host.angle);
  const sa = Math.sin(host.angle);
  return {
    x: host.x + mx * ca - my * sa,
    y: host.y + mx * sa + my * ca,
  };
}

/** World position of the shot exhaust / tail UV (matches trail emit + TOW wire tip). */
export function shotTailWorldPos(textures: Phaser.Textures.TextureManager, s: Shot): { x: number; y: number; z: number } {
  const look = shotLookOf(s);
  const at = worldToScreen(s.x, s.y, s.z);
  const img = textures.exists(look)
    ? (textures.get(look).getSourceImage() as { width: number; height: number })
    : { width: 48, height: 10 };
  const sc = s.scale ?? 1;
  const horiz = Math.hypot(s.vx, s.vy);
  const pitchN = Phaser.Math.Clamp(Math.abs(s.vz) / Math.max(90, Math.hypot(horiz, s.vz)), 0, 1);
  const along = 1 - pitchN * 0.52;
  const spd = Math.hypot(s.vx, s.vy, s.vz);
  const fx = spd > 1e-3 ? s.vx / spd : Math.cos(s.angle);
  const fy = spd > 1e-3 ? s.vy / spd : Math.sin(s.angle);
  const fz = spd > 1e-3 ? s.vz / spd : 0;
  const projectedX = screenVelX(fx, fy, fz, s.x, s.y, s.z);
  const projectedY = screenVelY(fy, fz, s.z, s.y);
  const projectedUnit = Math.hypot(projectedX, projectedY);
  // Edge-on / tiny projection → stay at center (avoids huge world offsets that kill the wire).
  if (projectedUnit < 1e-3) return { x: s.x, y: s.y, z: s.z };
  const screenDistance =
    (SHOT_ORIGIN.x - SHOT_TAIL.x) * img.width * sc * at.scale * along;
  const d = Math.min(screenDistance / projectedUnit, 64);
  return {
    x: s.x - fx * d,
    y: s.y - fy * d,
    z: s.z - fz * d,
  };
}

/** Forward shift so tip-origin art’s nose clears the muzzle (not the whole streak). */
export function shotTipNudge(textures: Phaser.Textures.TextureManager, 
  look: ShotLook,
  angle: number,
  x: number,
  y: number,
  z: number,
  scale = 1
): { x: number; y: number } {
  const at = worldToScreen(x, y, z);
  const img = textures.exists(look)
    ? (textures.get(look).getSourceImage() as { width: number; height: number })
    : { width: 48, height: 10 };
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  const projectedX = screenVelX(ca, sa, 0, x, y, z);
  const projectedY = screenVelY(sa, 0, z, y);
  const projectedUnit = Math.max(1e-6, Math.hypot(projectedX, projectedY));
  // Spawn is the tip-biased SHOT_ORIGIN; only push the remaining nose past the barrel.
  // (Using ox×length parked the whole tracer ahead of long guns like Spooky.)
  const screenDistance = (1 - SHOT_ORIGIN.x) * img.width * scale * at.scale;
  const d = screenDistance / projectedUnit;
  return { x: ca * d, y: sa * d };
}

/** Screen pose for UV mounts on a remote hull (accounts for bank tilt wrap). */
export function remoteBodyDrawPose(im: Phaser.GameObjects.Image): DrawPose {
  return imageDrawPose(im);
}

export function troopDrawAng(u: Unit): number {
  return troopSoftTurret(u) ? u.turret : u.angle;
}

/**
 * +1 = eject barrel-right, −1 = barrel-left.
 * Local UV only (muzzle on gun tex, else mount on hull) — never world space
 * so bob / lift / aim sway can't flip the side.
 */
export function shellEjectSide(opts: {
  muzzleUv?: { x: number; y: number };
  mountUv?: { x: number; y: number };
}): number {
  const mid = 0.5;
  const eps = 0.02;
  if (opts.muzzleUv && Math.abs(opts.muzzleUv.x - mid) > eps) {
    return opts.muzzleUv.x > mid ? 1 : -1;
  }
  if (opts.mountUv && Math.abs(opts.mountUv.x - mid) > eps) {
    return opts.mountUv.x > mid ? 1 : -1;
  }
  return 1;
}

/**
 * Screen pose for UV mounts on a hull image — accounts for jet tilt wrap
 * foreshortening so guns/exhaust stay glued to the billboard.
 */
export function imageDrawPose(im: Phaser.GameObjects.Image): {
  x: number;
  y: number;
  rotation: number;
  displayWidth: number;
  displayHeight: number;
  originX: number;
  originY: number;
} {
  const wrap = im.getData("tiltWrap") as Phaser.GameObjects.Container | undefined;
  if (!wrap?.scene) {
    return {
      x: im.x,
      y: im.y,
      rotation: im.rotation,
      displayWidth: im.displayWidth,
      displayHeight: im.displayHeight,
      originX: im.originX,
      originY: im.originY,
    };
  }
  return {
    x: wrap.x,
    y: wrap.y,
    rotation: wrap.rotation + im.rotation,
    displayWidth: im.width * Math.abs(wrap.scaleX),
    displayHeight: im.height * Math.abs(wrap.scaleY),
    originX: im.originX,
    originY: im.originY,
  };
}

/** Enemy casing side for the gun/muzzle that just fired. */
export function enemyShellEjectSide(u: Unit, gunI: number): number {
  const guns = gunsOf(u);
  const gun = guns[gunI];
  const tipIdx = u.muzzleFireTip ?? u.muzzleTip ?? 0;
  let muzzleUv: { x: number; y: number } | undefined;
  let mountUv: { x: number; y: number } | undefined;
  if (gun) {
    const tips = muzzlesOfGun(gun);
    muzzleUv = tips[tipIdx % tips.length];
    mountUv = gun.mount;
  } else {
    const bodyTips = lookupSpriteMuzzles(textureOf(u.kind));
    if (bodyTips.length) muzzleUv = bodyTips[tipIdx % bodyTips.length];
  }
  return shellEjectSide({ muzzleUv, mountUv });
}

/** Spent casing size from caliber (designation mm), else projectile scale, else dmg. */
export function shellGirth(opts: { designation?: string; scale?: number; dmg?: number }): number {
  const mm = opts.designation ? caliberMmFromDesignation(opts.designation) : undefined;
  if (mm != null) {
    return Phaser.Math.Clamp(0.2 + Math.pow(mm / 7.62, 0.55) * 0.26, 0.28, 1.2);
  }
  if (opts.scale != null) {
    return Phaser.Math.Clamp(0.26 + opts.scale * 0.5, 0.28, 1.15);
  }
  return Phaser.Math.Clamp(0.3 + Math.sqrt(Math.max(0.25, opts.dmg ?? 4)) * 0.125, 0.3, 0.85);
}

/**
 * Screen rotation for a projectile sprite.
 * Self-propelled missiles face thrust/guidance (`s.angle`); ballistic shots face travel.
 */
export function shotDrawRotation(s: Shot, x = s.x, y = s.y, z = s.z): number {
  if (shotFacesHeading(s)) {
    // Yaw from heading (thrust / steer), pitch from actual climb or dive.
    if (Math.abs(s.vz) < 1e-3) return projectHeading(s.angle, x, y, z);
    const h = Math.hypot(s.vx, s.vy);
    const hx = Math.cos(s.angle) * h;
    const hy = Math.sin(s.angle) * h;
    return Math.atan2(screenVelY(hy, s.vz, z, y), screenVelX(hx, hy, s.vz, x, y, z));
  }
  return Math.atan2(
    screenVelY(s.vy, s.vz, z, y),
    screenVelX(s.vx, s.vy, s.vz, x, y, z)
  );
}

export function enemyMuzzle(textures: Phaser.Textures.TextureManager, u: Unit, gunI = 0, tipOverride?: number): { x: number; y: number } {
  const sp = specOf(u.kind);
  const guns = gunsOf(u);
  const wpn = guns[gunI]?.weapon ?? sp.weapon;
  const gun = guns[gunI];
  const hullRot = troopDrawAng(u) + sp.rotOff;
  const hullPivot = spritePivot(textureOf(u.kind));
  const hullImg = textures.get(resolveSkin(textures, textureOf(u.kind), u.camo)).getSourceImage() as {
    width: number;
    height: number;
  };
  const atUv = (
    origin: { x: number; y: number },
    uv: { x: number; y: number },
    tw: number,
    th: number,
    x: number,
    y: number,
    rot: number
  ) => {
    const lx = (uv.x - origin.x) * tw;
    const ly = (uv.y - origin.y) * th;
    return { x: x + lx * Math.cos(rot) - ly * Math.sin(rot), y: y + lx * Math.sin(rot) + ly * Math.cos(rot) };
  };
  if (!gun || !wpn) {
    const bodyTips = lookupSpriteMuzzles(textureOf(u.kind));
    if (bodyTips.length) {
      const tipIdx =
        tipOverride ?? (u.muzzleT > 0 && u.muzzleFireTip != null ? u.muzzleFireTip : u.muzzleTip);
      const muz = bodyTips[tipIdx % bodyTips.length]!;
      return atUv(hullPivot, muz, hullImg.width, hullImg.height, u.x, u.y, hullRot);
    }
    return { x: u.x, y: u.y };
  }
  const origin = lookupSpriteOrigin(gun.tex) ?? gun.origin;
  const mount = gun.mount;
  const dw = hullImg.width;
  const dh = hullImg.height;
  const mx = (mount.x - hullPivot.x) * dw;
  const my = (mount.y - hullPivot.y) * dh;
  const hx = u.x + mx * Math.cos(hullRot) - my * Math.sin(hullRot);
  const hy = u.y + mx * Math.sin(hullRot) + my * Math.cos(hullRot);
  const gtex = textures.exists(gun.tex)
    ? (textures.get(gun.tex).getSourceImage() as { width: number; height: number })
    : { width: 24, height: 48 };
  const tips = muzzlesOfGun(gun);
  const tipIdx =
    tipOverride ?? (u.muzzleT > 0 && u.muzzleFireTip != null ? u.muzzleFireTip : u.muzzleTip);
  const muz = tips[tipIdx % tips.length]!;
  const ga = gunWorldRot(gun.tex, u.turrets[gunI] ?? u.turret);
  const gsc = gun.scale ?? 1;
  return atUv(origin, muz, gtex.width * gsc, gtex.height * gsc, hx, hy, ga);
}

/** Place remote gun overlay on the body hub for the current aim (shared by draw + fire). */
export function poseRemoteGun(textures: Phaser.Textures.TextureManager, 
  drone: RemoteCraft,
  bodyPose: {
    x: number;
    y: number;
    rotation: number;
    displayWidth: number;
    displayHeight: number;
    originX: number;
    originY: number;
  },
  bodyKey: string,
  gunIm: Phaser.GameObjects.Image
): void {
  const gunTex = craftGunTex(drone.spec);
  const gunKey = (gunTex && textures.exists(gunTex) && gunTex) || "gun_minigun";
  if (gunIm.texture.key !== gunKey) gunIm.setTexture(gunKey);
  const gOrig = lookupSpriteOrigin(gunKey) ?? { x: 0.5, y: 0.7 };
  const gunAng = drone.gunAngle ?? drone.angle;
  const mount = lookupSpritePoints(bodyKey, "gun")[0] ?? { x: 0.5, y: 0.5 };
  const hub = spriteUvPos(bodyPose, mount.x, mount.y);
  const at = worldToScreen(drone.x, drone.y, drone.z);
  gunIm
    .setVisible(true)
    .setOrigin(gOrig.x, gOrig.y)
    .setPosition(hub.x, hub.y)
    .setRotation(projectHeading(gunAng + Math.PI / 2, drone.x, drone.y, drone.z))
    .setScale(craftGunScale(drone.spec) * at.scale);
}

/** World position of a gun's mount on the hull (aim pivot), independent of barrel angle. */
export function gunMountPos(textures: Phaser.Textures.TextureManager, u: Unit, gunI = 0): { x: number; y: number } {
  const guns = gunsOf(u);
  const gun = guns[gunI];
  if (!gun) return { x: u.x, y: u.y };
  const mount = gun.mount;
  return mountAt(textures, u, resolveSkin(textures, textureOf(u.kind), u.camo), mount);
}

export function mountAt(textures: Phaser.Textures.TextureManager, host: Unit, tex: string, mount: { x: number; y: number }): { x: number; y: number } {
  const pivot = spritePivot(tex);
  const rot = host.angle + specOf(host.kind).rotOff;
  const img = textures.exists(tex)
    ? (textures.get(tex).getSourceImage() as { width: number; height: number })
    : { width: 52, height: 52 };
  const mx = (mount.x - pivot.x) * img.width;
  const my = (mount.y - pivot.y) * img.height;
  return {
    x: host.x + mx * Math.cos(rot) - my * Math.sin(rot),
    y: host.y + mx * Math.sin(rot) + my * Math.cos(rot),
  };
}

export function shotLookOf(s: Shot): ShotLook {
  if (!s.look) throw new Error(`shot ${s.id ?? "?"} missing look`);
  return s.look;
}

/** Parse `30MM` / `.50 CAL` from a catalog designation. */
export function caliberMmFromDesignation(designation: string): number | undefined {
  const mm = designation.match(/(\d+(?:\.\d+)?)\s*MM\b/i);
  if (mm) return Number(mm[1]);
  const cal = designation.match(/\.(\d+)\s*CAL/i);
  if (cal) return Number(cal[1]) * 0.254;
  return undefined;
}

/** Screen pose of a hull image (tilt-wrap aware). */
export type DrawPose = ReturnType<typeof imageDrawPose>;
