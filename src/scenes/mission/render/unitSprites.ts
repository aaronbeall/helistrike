import Phaser from "phaser";
import { footprintHalfY, footprintInto } from "../../../render/footprint";
import { steerUnitAngle } from "../../../sim/navigation";
import { enemyMuzzle, slopeSquash, troopDrawAng } from "../../../render/spritePose";
import { troopSoftTurret } from "../../../sim/roster";
import { gunWorldRot, lookupSpriteOrigin } from "../../../art/spriteOrigin";
import { thermalSignalTint, applyThermalHeat } from "../../../render/thermal";
import { resolveSkin } from "../../../render/camo";
import { heightOf, radius, textureOf, type Unit } from "../../../sim/combat";
import { ZOff, worldDepth } from "../../../render/depth";
import { range } from "../../../util/rng";
import { isGroundVehicle, specOf, gunsOf, crewOf } from "../../../sim/roster";
import { rotorMountsOf, rotorSpinSign } from "../../../sim/crafts";
import { applyEdgeLight, clearEdgeLight } from "../../../render/edgeLight";
import { spritePivot } from "../../../art/sprites";
import { worldToScreen, cameraPointVisible, screenVelX, screenVelY, projectHeading } from "../../../worldgen/world";
import { VIEW_PAD } from "../camera/camera";
import type { MissionScene } from "../../missionScene";

/** Part images per sprite block (guns, then rotors, then dish). */
const BLOCK_PARTS = 6;

/** Pooled images for one on-screen unit. */
interface SpriteBlock {
  shadow: Phaser.GameObjects.Image;
  body: Phaser.GameObjects.Image;
  parts: Phaser.GameObjects.Image[];
  flash: Phaser.GameObjects.Image;
  roof: Phaser.GameObjects.Image;
  /** Dish tilt container, once a part has been wrapped. */
  wrap?: Phaser.GameObjects.Container;
}
/** Buildings cast their shadow from this fraction of their height. */
const BUILDING_SHADOW_HEIGHT = 0.25;
/** Deck shadows: full length so spans join, inset width so the edges don't peek out. */
const DECK_SHADOW_SCALE = { x: 1, y: 0.92 } as const;
/** Ground vehicles cast their shadow from this fraction of their height. */
const VEHICLE_SHADOW_HEIGHT = 0.5;

type TextureAlphaBounds = {
  width: number;
  height: number;
  alpha: Uint8ClampedArray;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

/** Unit rendering: sprite sync, draw rotations, thermal hotspots, texture metrics (span / alpha bounds / solid-UV sampling). */
export class UnitSprites {
  thermalHotspotG!: Phaser.GameObjects.Group;
  /** Cached texture span / trail radius (key → px). */
  texSpanCache = new Map<string, number>();
  textureAlphaCache = new Map<string, TextureAlphaBounds | null>();

  /** Image block per on-screen unit (`s.units` index → block, -1 none); blocks are pooled, never destroyed. */
  private blockOf = new Int32Array(0);
  private blocks: SpriteBlock[] = [];
  private freeBlocks: number[] = [];
  /** Kinds already reported for having more parts than a block holds (dev). */
  private partOverflow = new Set<string>();

  constructor(readonly s: MissionScene) {}

  /** Per-mission state reset (called from the scene's init). */
  reset(): void {
    this.blockOf = new Int32Array(0);
    this.blocks = [];
    this.freeBlocks = [];
  }

  /** Image blocks in use (debug). */
  blocksInUse(): number {
    return this.blocks.length - this.freeBlocks.length;
  }

  private claimBlock(ui: number): number {
    let block = this.freeBlocks.pop();
    if (block == null) {
      block = this.blocks.length;
      const img = (key: string) => this.s.add.image(0, 0, key).setVisible(false);
      const shadow = img("fx_shadow");
      const body = img("enemy_tank");
      const parts: Phaser.GameObjects.Image[] = [];
      for (let p = 0; p < BLOCK_PARTS; p++) parts.push(img("enemy_heli_rotor"));
      const flash = img("fx_muzzle").setBlendMode(Phaser.BlendModes.ADD);
      const roof = img("fx_shadow");
      this.blocks.push({ shadow, body, parts, flash, roof });
    }
    this.blockOf[ui] = block;
    return block;
  }

  private releaseBlock(ui: number): void {
    this.freeBlocks.push(this.blockOf[ui]!);
    this.blockOf[ui] = -1;
  }

  private hideBlock(b: SpriteBlock): void {
    if (b.shadow.visible) b.shadow.setVisible(false);
    if (b.body.visible) b.body.setVisible(false);
    for (const p of b.parts) if (p.visible) p.setVisible(false);
    if (b.flash.visible) b.flash.setVisible(false);
    if (b.roof.visible) b.roof.setVisible(false);
    if (b.wrap?.scene && b.wrap.visible) b.wrap.setVisible(false);
  }

  /** Part image `i` of a block; past the block's capacity the part is skipped (reported once per kind in dev). */
  private blockPart(b: SpriteBlock, i: number, kind: string): Phaser.GameObjects.Image | undefined {
    const p = b.parts[i];
    if (!p && import.meta.env.DEV && !this.partOverflow.has(kind)) {
      this.partOverflow.add(kind);
      console.error(`[unitSprites] ${kind} has more than ${BLOCK_PARTS} parts; extras are not drawn`);
    }
    return p;
  }

  spriteOrigin(key: string): { x: number; y: number } {
    if (key === "craft_apache_rotor") return { x: this.s.hostCraft.rotor.originX, y: this.s.hostCraft.rotor.originY };
    return spritePivot(key);
  }

  /**
   * Projected hull facing with rate-limited draw rotation.
   * Near 2.5D poles, hold or prefer π continuity; otherwise always chase true
   * projection so a one-frame flip cannot lock the sprite nose-aft forever.
   */
  unitDrawRot(u: Unit, worldRot: number): number {
    const vx = Math.cos(worldRot);
    const vy = Math.sin(worldRot);
    const sx = screenVelX(vx, vy, 0, u.x, u.y, u.z);
    const sy = screenVelY(vy, 0, u.z, u.y);
    const mag = Math.hypot(sx, sy);
    let raw = Math.atan2(sy, sx);
    const prev = u.drawRot;
    if (prev == null || !Number.isFinite(prev)) {
      u.drawRot = raw;
      return raw;
    }
    // Collapsed projection (into/out of camera) → hold prior draw facing.
    if (mag < 0.08) return prev;
    // Only near the singularity: π-flip toward prev. Healthy mag always trusts raw.
    if (mag < 0.35) {
      const jump = Math.abs(Phaser.Math.Angle.Wrap(raw - prev));
      if (jump > Math.PI * 0.55) {
        const flipped = Phaser.Math.Angle.Wrap(raw + Math.PI);
        if (Math.abs(Phaser.Math.Angle.Wrap(flipped - prev)) < jump) raw = flipped;
        else return prev;
      }
    }
    const visDt = Math.min(0.05, (this.s.game.loop.delta || 16) / 1000);
    u.drawRot = steerUnitAngle(prev, raw, 2.8, visDt);
    return u.drawRot;
  }

  /** Smoothed projected aim for overlay guns / soft troop facing. */
  unitAimDrawRot(u: Unit, key: string, worldRot: number): number {
    if (!u.aimDrawRots) u.aimDrawRots = {};
    const vx = Math.cos(worldRot);
    const vy = Math.sin(worldRot);
    const sx = screenVelX(vx, vy, 0, u.x, u.y, u.z);
    const sy = screenVelY(vy, 0, u.z, u.y);
    const mag = Math.hypot(sx, sy);
    let raw = Math.atan2(sy, sx);
    const prev = u.aimDrawRots[key];
    if (prev == null || !Number.isFinite(prev)) {
      u.aimDrawRots[key] = raw;
      return raw;
    }
    if (mag < 0.08) return prev;
    if (mag < 0.35) {
      const jump = Math.abs(Phaser.Math.Angle.Wrap(raw - prev));
      if (jump > Math.PI * 0.55) {
        const flipped = Phaser.Math.Angle.Wrap(raw + Math.PI);
        if (Math.abs(Phaser.Math.Angle.Wrap(flipped - prev)) < jump) raw = flipped;
        else return prev;
      }
    }
    const visDt = Math.min(0.05, (this.s.game.loop.delta || 16) / 1000);
    u.aimDrawRots[key] = steerUnitAngle(prev, raw, 3.2, visDt);
    return u.aimDrawRots[key]!;
  }

  /** Host that snaps pinned crew to a mount UV (e.g. vehicle bed) — blocks flee/walk. */
  snapHost(u: Unit): Unit | undefined {
    if (u.pinId == null) return undefined;
    const post = this.s.unitSim.unitById(u.pinId);
    if (!post) return undefined;
    return crewOf(post.kind)?.mode === "snap" ? post : undefined;
  }

  texWidth(key: string): number {
    return this.texSpan(key);
  }

  texSpan(key: string): number {
    const hit = this.texSpanCache.get(key);
    if (hit != null) return hit;
    if (!this.s.textures.exists(key)) return 64;
    const src = this.s.textures.get(key).getSourceImage() as { width: number; height: number };
    const v = Math.max(1, src.width, src.height);
    this.texSpanCache.set(key, v);
    return v;
  }

  textureAlphaBounds(key: string): TextureAlphaBounds | null {
    if (this.textureAlphaCache.has(key)) return this.textureAlphaCache.get(key) ?? null;
    if (!this.s.textures.exists(key)) {
      this.textureAlphaCache.set(key, null);
      return null;
    }
    try {
      const src = this.s.textures.get(key).getSourceImage() as CanvasImageSource & {
        width: number;
        height: number;
      };
      const width = Math.max(1, src.width);
      const height = Math.max(1, src.height);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(src, 0, 0);
      const rgba = ctx.getImageData(0, 0, width, height).data;
      const alpha = new Uint8ClampedArray(width * height);
      let minX = width;
      let minY = height;
      let maxX = -1;
      let maxY = -1;
      for (let i = 0; i < alpha.length; i++) {
        const a = rgba[i * 4 + 3]!;
        alpha[i] = a;
        if (a < 48) continue;
        const x = i % width;
        const y = (i / width) | 0;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
      const result =
        maxX >= minX
          ? { width, height, alpha, minX, minY, maxX, maxY }
          : null;
      this.textureAlphaCache.set(key, result);
      return result;
    } catch {
      this.textureAlphaCache.set(key, null);
      return null;
    }
  }

  solidAtUv(key: string, u: number, v: number): boolean {
    const tex = this.textureAlphaBounds(key);
    if (!tex) return false;
    const x = Phaser.Math.Clamp(Math.floor(u * tex.width), 0, tex.width - 1);
    const y = Phaser.Math.Clamp(Math.floor(v * tex.height), 0, tex.height - 1);
    return tex.alpha[y * tex.width + x]! >= 48;
  }

  /**
   * Bounded random solid-pixel pick, with an object-radius fallback around the pivot.
   * `maxCenterFrac` (e.g. 0.7 for rotors) limits picks to that fraction of half the
   * texture span from the sprite pivot — still requires a solid pixel.
   */
  sampleSolidUv(
    key: string,
    fallbackRadius: number,
    attempts = 24,
    maxCenterFrac?: number
  ): { u: number; v: number } {
    const tex = this.textureAlphaBounds(key);
    const pivot = spritePivot(key);
    const width = tex?.width ?? Math.max(1, this.texSpan(key));
    const height = tex?.height ?? Math.max(1, this.texSpan(key));
    const cx = pivot.x * width;
    const cy = pivot.y * height;
    const rotorR = Math.max(width, height) * 0.5;
    const maxDist = maxCenterFrac != null ? rotorR * maxCenterFrac : null;
    if (tex) {
      const tries = maxDist != null ? Math.max(attempts, 64) : attempts;
      for (let i = 0; i < tries; i++) {
        const x = tex.minX + ((Math.random() * (tex.maxX - tex.minX + 1)) | 0);
        const y = tex.minY + ((Math.random() * (tex.maxY - tex.minY + 1)) | 0);
        if (maxDist != null && Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > maxDist) continue;
        if (tex.alpha[y * tex.width + x]! >= 48) {
          return { u: (x + 0.5) / tex.width, v: (y + 0.5) / tex.height };
        }
      }
    }
    const ang = Math.random() * Math.PI * 2;
    const cap = maxDist ?? Math.max(1, fallbackRadius);
    const dist = Math.sqrt(Math.random()) * cap;
    return {
      u: Phaser.Math.Clamp(pivot.x + (Math.cos(ang) * dist) / width, 0, 1),
      v: Phaser.Math.Clamp(pivot.y + (Math.sin(ang) * dist) / height, 0, 1),
    };
  }

  sampleSolidLocalPoints(
    key: string,
    fallbackRadius: number,
    count: number,
    maxCenterFrac?: number
  ): { lx: number; ly: number; sc: number }[] {
    const tex = this.textureAlphaBounds(key);
    const width = tex?.width ?? Math.max(1, this.texSpan(key));
    const height = tex?.height ?? Math.max(1, this.texSpan(key));
    const pivot = spritePivot(key);
    return Array.from({ length: count }, (_, i) => {
      const uv = this.sampleSolidUv(key, fallbackRadius, 24, maxCenterFrac);
      return {
        lx: (uv.u - pivot.x) * width,
        ly: (uv.v - pivot.y) * height,
        sc: i === 0 ? 1 : range(0.42, 0.62),
      };
    });
  }

  sync(): void {
    const units = this.s.units;
    if (this.blockOf.length < units.length) {
      const g = new Int32Array(Math.max(units.length, this.blockOf.length * 2)).fill(-1);
      g.set(this.blockOf);
      this.blockOf = g;
    }
    for (let ui = 0; ui < units.length; ui++) {
      const u = units[ui]!;
      const held = this.blockOf[ui]!;
      if (held >= 0) this.hideBlock(this.blocks[held]!);
      if (u.dead) {
        if (held >= 0) this.releaseBlock(ui);
        continue;
      }
      const sp = specOf(u.kind);
      const roofZ = u.z + heightOf(u.kind);
      if (!cameraPointVisible(u.z, u.y) && !(sp.roof && cameraPointVisible(roofZ, u.y))) {
        if (held >= 0) this.releaseBlock(ui);
        continue;
      }
      const tex = resolveSkin(this.s.textures, textureOf(u.kind), u.camo);
      const rot = troopDrawAng(u) + sp.rotOff;
      const scr = worldToScreen(u.x, u.y, u.z);
      const scrX = scr.x;
      const scrY = scr.y;
      const roofScr = sp.roof ? worldToScreen(u.x, u.y, roofZ) : undefined;
      if (!this.s.camera.projectedInView(scrX, scrY, VIEW_PAD) && !(roofScr && this.s.camera.projectedInView(roofScr.x, roofScr.y, VIEW_PAD))) {
        if (held >= 0) this.releaseBlock(ui);
        continue;
      }
      const i = held >= 0 ? held : this.claimBlock(ui);
      const guns = gunsOf(u);
      const blk = this.blocks[i]!;
      const sh = blk.shadow;
      const im = blk.body;
      const flash = blk.flash;
      const roofIm = blk.roof;
      const drawRot = this.unitDrawRot(u, rot);
      const zs = scr.scale;
      const pivot = spritePivot(textureOf(u.kind));
      const ox = pivot.x;
      const oy = pivot.y;
      const zBias = u.pinId != null ? ZOff.posted : 0;
      const bodyDepth = worldDepth(u.z, ZOff.body + zBias, u.y);
      const damageHeat = Phaser.Math.Clamp(1 - u.health / Math.max(1, u.max), 0, 1) * 0.14;
      const bodyHeat = Phaser.Math.Clamp(
        (sp.organic
          ? 0.98
          : sp.aerial
            ? 0.82
            : isGroundVehicle(u.kind)
              ? 0.7
              : sp.building
                ? 0.25
                : sp.water
                  ? 0.34
                  : 0.48) + damageHeat,
        0,
        1
      );
      sh.setVisible(true).setOrigin(ox, oy);
      // Roofed structures cast from the roof; buildings and ground vehicles from a fraction of their height
      // (a short shadow peeking out, instead of one hidden exactly underneath).
      this.s.hostCraft.applyCastShadow(
        sh,
        u.x,
        u.y,
        sp.roof
          ? roofZ
          : sp.building
            ? u.z + heightOf(u.kind) * BUILDING_SHADOW_HEIGHT
            : isGroundVehicle(u.kind)
              ? u.z + heightOf(u.kind) * VEHICLE_SHADOW_HEIGHT
              : u.z,
        sp.roof?.tex ?? tex,
        rot,
        sp.aerial ? 1 : sp.deck ? DECK_SHADOW_SCALE : 0.92,
        sp.aerial ? 2 : sp.building ? 8 : 1,
        u,
        drawRot
      );
      im.setVisible(!sp.roof?.noBody);
      if (im.texture.key !== tex) im.setTexture(tex);
      im.setOrigin(ox, oy)
        .setPosition(scrX, scrY)
        .setRotation(drawRot);
      if (im.depth !== bodyDepth) im.setDepth(bodyDepth);
      if (isGroundVehicle(u.kind)) {
        const sq = slopeSquash(this.s.world, u.x, u.y, u.angle);
        im.setScale(sq.sx * zs, sq.sy * zs);
      } else im.setScale(zs);
      if (sp.building) clearEdgeLight(im);
      else applyEdgeLight(im, drawRot);
      applyThermalHeat(im, this.s.thermal.on, bodyHeat);
      if (sp.roof && roofScr) {
        roofIm.setVisible(true);
        if (roofIm.texture.key !== sp.roof.tex) roofIm.setTexture(sp.roof.tex);
        roofIm
          .setOrigin(ox, oy)
          .setPosition(roofScr.x, roofScr.y)
          .setRotation(drawRot)
          .setScale(roofScr.scale)
          // Decks sort from their far edge so anything standing on them draws above.
          .setDepth(worldDepth(roofZ, ZOff.body + zBias, sp.deck ? u.y - footprintHalfY(footprintInto(u)) : u.y));
        clearEdgeLight(roofIm);
        applyThermalHeat(roofIm, this.s.thermal.on, bodyHeat);
      }
      let pi = 0;
      const gunDepth = (sp.behavior === "orbit_attack_heli" || sp.behavior === "kite_attack_heli") ? ZOff.gun : ZOff.turret;
      const place = (
        part: Phaser.GameObjects.Image,
        texKey: string,
        origin: { x: number; y: number },
        mount: { x: number; y: number },
        worldRot: number,
        depth: number,
        sc = 1,
        edgeLit = false,
        aimKey?: string
      ) => {
        if (!this.s.textures.exists(texKey)) return;
        this.s.hostCraft.unwrapTilt(part);
        const mx = (mount.x - ox) * im.displayWidth;
        const my = (mount.y - oy) * im.displayHeight;
        const partRot = texKey.includes("rotor")
          ? worldRot
          : aimKey
            ? this.unitAimDrawRot(u, aimKey, worldRot)
            : drawRot;
        const pd = worldDepth(u.z, depth + zBias, u.y);
        part.setVisible(true);
        if (part.texture.key !== texKey) part.setTexture(texKey);
        part
          .setOrigin(origin.x, origin.y)
          .setPosition(
            im.x + mx * Math.cos(drawRot) - my * Math.sin(drawRot),
            im.y + mx * Math.sin(drawRot) + my * Math.cos(drawRot)
          )
          .setRotation(partRot)
          .setAlpha(1)
          .setScale(im.scaleX * sc, im.scaleY * sc);
        if (part.depth !== pd) part.setDepth(pd);
        if (edgeLit && !sp.building) applyEdgeLight(part, partRot);
        else clearEdgeLight(part);
        applyThermalHeat(
          part,
          this.s.thermal.on,
          texKey.includes("rotor")
            ? bodyHeat * 0.48
            : sp.building
              // AA / SAM / tower guns are live emitters — hot vs cold concrete.
              ? 0.9
              : Math.min(1, bodyHeat + 0.08)
        );
      };
      guns.forEach((g, gi) => {
        const part = this.blockPart(blk, pi++, u.kind);
        if (!part) return;
        const gorig = lookupSpriteOrigin(g.tex) ?? g.origin;
        const gmount = g.mount;
        place(
          part,
          resolveSkin(this.s.textures, g.tex, u.camo),
          gorig,
          gmount,
          gunWorldRot(g.tex, u.turrets[gi] ?? u.turret),
          gunDepth,
          g.scale ?? 1,
          true,
          `gun${gi}`
        );
      });
      sp.rotors.forEach((r, ri) => {
        const part = this.blockPart(blk, pi++, u.kind);
        if (!part) return;
        const spinKey = `${r.tex}_spin`;
        const rotorKey =
          r.tex !== "enemy_drone_rotor" && this.s.textures.exists(spinKey) ? spinKey : r.tex;
        const mounts = rotorMountsOf(textureOf(u.kind));
        const sign = rotorSpinSign(mounts, ri);
        place(part, rotorKey, r.origin, r.mount, sign * u.rotor, ZOff.rotor, r.scale ?? 1);
        if (r.tex.includes("rotor")) {
          const px = this.s.destruction.liveRotorDrawPx(r.tex, r.scale ?? 1);
          part.setScale((px / Math.max(part.width, 1)) * zs);
        }
      });
      if (sp.dish) {
        const part = this.blockPart(blk, pi++, u.kind);
        if (part && this.s.textures.exists(sp.dish.tex)) {
          const d = sp.dish;
          const mx = (d.mount.x - ox) * im.displayWidth;
          const my = (d.mount.y - oy) * im.displayHeight;
          const px = im.x + mx * Math.cos(drawRot) - my * Math.sin(drawRot);
          const py = im.y + mx * Math.sin(drawRot) + my * Math.cos(drawRot);
          const sc = d.scale ?? 1;
          let wrap = part.getData("tiltWrap") as Phaser.GameObjects.Container | undefined;
          if (!wrap || !wrap.scene) {
            wrap = this.s.add.container(px, py);
            wrap.add(part);
            part.setData("tiltWrap", wrap);
          }
          blk.wrap = wrap;
          const dishDepth = worldDepth(u.z, ZOff.turret + zBias, u.y);
          wrap
            .setVisible(true)
            .setPosition(px, py)
            .setScale(im.scaleX * sc * 1.04, im.scaleY * sc * 0.76)
            .setRotation(u.rotor);
          if (wrap.depth !== dishDepth) wrap.setDepth(dishDepth);
          part.setVisible(true);
          if (part.texture.key !== d.tex) part.setTexture(d.tex);
          part
            .setOrigin(d.origin.x, d.origin.y)
            .setPosition(0, 0)
            .setRotation(0)
            .setAlpha(1)
            .setScale(1);
          clearEdgeLight(part);
          applyThermalHeat(part, this.s.thermal.on, bodyHeat * 0.62);
        }
      }
      if (u.muzzleT > 0 && (sp.weapon || guns.length)) {
        const tip = enemyMuzzle(this.s.textures, u, u.muzzleGun);
        const ang = troopSoftTurret(u)
          ? u.turret
          : !guns.length
            ? u.angle
            : u.turrets[u.muzzleGun] ?? u.turret;
        const jitS = u.muzzleJitS ?? 1;
        const jitR = u.muzzleJitR ?? 0;
        const tipScr = worldToScreen(tip.x, tip.y, u.z);
        const flashDepth = worldDepth(u.z, gunDepth + 0.4 + zBias, u.y);
        flash.setVisible(true);
        if (flash.texture.key !== "fx_muzzle") flash.setTexture("fx_muzzle");
        flash
          .setFrame(u.muzzleFrame ?? 0)
          .setOrigin(0.15, 0.5)
          .setPosition(tipScr.x, tipScr.y)
          .setRotation(projectHeading(ang + jitR, tip.x, tip.y, u.z))
          .setScale((sp.organic ? 0.7 : 1.15) * zs * jitS)
          .setAlpha(Phaser.Math.Clamp(u.muzzleT / 0.07, 0, 1));
        if (this.s.thermal.on) {
          flash.setBlendMode(Phaser.BlendModes.NORMAL);
          applyThermalHeat(flash, true, 0.96 * Phaser.Math.Clamp(u.muzzleT / 0.07, 0, 1));
        } else {
          flash.setBlendMode(Phaser.BlendModes.ADD);
          applyThermalHeat(flash, false, 0, 0xfff6d0);
        }
        if (flash.depth !== flashDepth) flash.setDepth(flashDepth);
        clearEdgeLight(flash);
      }
    }
    this.syncThermalHotspots();
  }

  /** Low-cost semantic engine heat: one pooled glow per active vehicle/aircraft. */
  syncThermalHotspots(): void {
    const kids = this.thermalHotspotG.getChildren() as Phaser.GameObjects.Image[];
    for (const image of kids) image.setVisible(false);
    if (!this.s.thermal.on) return;

    const points: { x: number; y: number; z: number; angle: number; radius: number; heat: number }[] = [];
    const h = this.s.player;
    if (h.phase !== "dead" && this.s.countermeasures.cloakT <= 0) {
      points.push({
        x: h.x,
        y: h.y,
        z: h.z,
        angle: h.angle,
        radius: h.spec.radius,
        heat: 1,
      });
    }
    for (const u of this.s.units) {
      if (u.dead) continue;
      const sp = specOf(u.kind);
      if (!sp.aerial && !isGroundVehicle(u.kind)) continue;
      points.push({
        x: u.x,
        y: u.y,
        z: u.z,
        angle: u.angle,
        radius: radius(u.kind),
        heat: sp.aerial ? 0.96 : 0.88,
      });
    }
    while (this.thermalHotspotG.getLength() < points.length) {
      this.thermalHotspotG.add(
        this.s.add
          .image(0, 0, "fx_exhaust_glow")
          .setOrigin(0.5, 0.5)
          .setBlendMode(Phaser.BlendModes.ADD)
          .setTintFill(thermalSignalTint(1))
      );
    }
    const pool = this.thermalHotspotG.getChildren() as Phaser.GameObjects.Image[];
    points.forEach((p, i) => {
      const back = p.radius * 0.42;
      const x = p.x - Math.cos(p.angle) * back;
      const y = p.y - Math.sin(p.angle) * back;
      const at = worldToScreen(x, y, p.z);
      const size = Math.max(5, p.radius * 0.7 * at.scale);
      pool[i]!
        .setVisible(true)
        .setPosition(at.x, at.y)
        .setDisplaySize(size, size)
        .setAlpha(0.24 + p.heat * 0.2)
        .setDepth(worldDepth(p.z, ZOff.fire + 0.12, y));
    });
  }
}
