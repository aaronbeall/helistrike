/** Baked blast-ring gradient sheet. */
import Phaser from "phaser";
import { registerArt } from "../art/sprites";

export const BLAST_RING_FRAMES = 12;

export function ensureBlastRingGradient(textures: Phaser.Textures.TextureManager): void {
  if (textures.exists("fx_blast_ring")) return;
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size * BLAST_RING_FRAMES;
  canvas.height = size;
  const g = canvas.getContext("2d", { willReadFrequently: true })!;
  for (let frame = 0; frame < BLAST_RING_FRAMES; frame++) {
    const t = frame / (BLAST_RING_FRAMES - 1);
    const holeEase = 1 - Math.pow(1 - t, 3.5);
    const hole = 0.08 + 0.54 * holeEase;
    const remaining = 1 - hole;
    const innerSoft = hole + remaining * 0.14;
    const peak = hole + remaining * 0.34;
    const outerSoft = hole + remaining * 0.72;
    const cx = frame * size + size / 2;
    const gradient = g.createRadialGradient(cx, size / 2, 0, cx, size / 2, size / 2);
    gradient.addColorStop(0, "rgba(255,255,255,0)");
    gradient.addColorStop(hole, "rgba(255,255,255,0)");
    gradient.addColorStop(innerSoft, "rgba(160,215,255,0.54)");
    gradient.addColorStop(peak, "rgba(255,255,255,1)");
    gradient.addColorStop(outerSoft, "rgba(255,190,120,0.27)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gradient;
    g.fillRect(frame * size, 0, size, size);
    const pixels = g.getImageData(frame * size, 0, size, size);
    const source = new Uint8ClampedArray(pixels.data);
    const center = size / 2;
    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        const dx = px - center;
        const dy = py - center;
        const angle = Math.atan2(dy, dx);
        const radius = Math.hypot(dx, dy);
        const waves =
          Math.sin(angle * 3 + 0.4) * 0.55 +
          Math.sin(angle * 7 - 1.1) * 0.3 +
          Math.sin(angle * 13 + 2.2) * 0.15;
        const warpedRadius = radius - waves * (0.5 + 5 * t * t);
        const sampleX = Math.round(center + Math.cos(angle) * warpedRadius);
        const sampleY = Math.round(center + Math.sin(angle) * warpedRadius);
        const dst = (py * size + px) * 4;
        if (sampleX < 0 || sampleX >= size || sampleY < 0 || sampleY >= size) {
          pixels.data[dst + 3] = 0;
          continue;
        }
        const src = (sampleY * size + sampleX) * 4;
        pixels.data[dst] = source[src]!;
        pixels.data[dst + 1] = source[src + 1]!;
        pixels.data[dst + 2] = source[src + 2]!;
        const rays =
          Math.sin(angle * 17 + 0.8) * 0.5 +
          Math.sin(angle * 31 - 1.7) * 0.3 +
          Math.sin(angle * 53 + 2.4) * 0.2;
        const rayStrength = 0.22 + 0.28 * t * t;
        pixels.data[dst + 3] = Math.min(255, source[src + 3]! * (0.78 + rays * rayStrength));
      }
    }
    g.putImageData(pixels, frame * size, 0);
  }
  textures.addSpriteSheet("fx_blast_ring", canvas as unknown as HTMLImageElement, {
    frameWidth: size,
    frameHeight: size,
    endFrame: BLAST_RING_FRAMES - 1,
  });
  registerArt("fx_blast_ring", "generated");
}
