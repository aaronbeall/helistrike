import type Phaser from "phaser";

const SRC = {
  heli: "sprites/helistrike-heli-player-nrotor.png",
  enemy: "sprites/helistrike-heli-enemy-nrotor.png",
  tankParts: "sprites/helistrike-tank-parts.png",
  units: "sprites/helistrike-units.png",
  rock: "sprites/helistrike-rock.png",
  hulks: "sprites/helistrike-hulks.png",
  debris: "sprites/helistrike-debris.png",
  tankWreck: "sprites/helistrike-tank-wreck-parts.png",
  weapons: "sprites/helistrike-weapons.png",
  blasts: "sprites/helistrike-blasts.png",
} as const;

export function preloadArt(scene: Phaser.Scene): void {
  scene.load.image("src_heli", SRC.heli);
  scene.load.image("src_enemy", SRC.enemy);
  scene.load.image("src_tank_parts", SRC.tankParts);
  scene.load.image("src_units", SRC.units);
  scene.load.image("src_rock", SRC.rock);
  scene.load.image("src_hulks", SRC.hulks);
  scene.load.image("src_debris", SRC.debris);
  scene.load.image("src_tank_wreck", SRC.tankWreck);
  scene.load.image("src_weapons", SRC.weapons);
  scene.load.image("src_blasts", SRC.blasts);
}

export const tankLayout = {
  turretOrigin: { x: 0.5, y: 0.78 },
  mountOrigin: { x: 0.5, y: 0.4 },
  hulkTurretOrigin: { x: 0.5, y: 0.78 },
};

export function prepareArt(textures: Phaser.Textures.TextureManager): void {
  put(textures, "heli_body", fit(keyImage(src(textures, "src_heli"), "studio"), 120));
  put(textures, "enemy_heli", fit(keyImage(src(textures, "src_enemy"), "magenta"), 104));
  put(textures, "rock", fit(keyImage(src(textures, "src_rock"), "magenta"), 36));

  const parts = sliceGrid(keyImage(src(textures, "src_tank_parts"), "magenta"), 2, 1);
  const hull = fit(parts[0]!, 72);
  const turret = fit(parts[1]!, 56);
  put(textures, "tank_hull", hull);
  put(textures, "tank_turret", turret);
  tankLayout.mountOrigin = darkMountOrigin(hull);
  tankLayout.turretOrigin = cupolaOrigin(turret);
  const wreck = sliceGrid(keyImage(src(textures, "src_tank_wreck"), "magenta"), 2, 1);
  put(textures, "hulk_tank_hull", fit(wreck[0]!, 70));
  const hulkTurret = fit(wreck[1]!, 70);
  put(textures, "hulk_tank_turret", hulkTurret);
  tankLayout.hulkTurretOrigin = cupolaOrigin(hulkTurret);

  const sheet = keyImage(src(textures, "src_units"), "magenta");
  const cells = sliceGrid(sheet, 3, 2);
  const keys = ["boat", "tower", "bunker", "radar", "soldier", "tree"] as const;
  const sizes = [78, 58, 92, 88, 26, 42];
  keys.forEach((key, i) => put(textures, key, fit(cells[i]!, sizes[i]!)));

  const hulks = sliceGrid(keyImage(src(textures, "src_hulks"), "magenta"), 3, 3);
  const hulkKeys = [
    "hulk_tank",
    "hulk_heli",
    "hulk_bunker",
    "hulk_radar",
    "hulk_tower",
    "hulk_boat",
    "hulk_soldier",
    "hulk_tree",
    "hulk_crater",
  ] as const;
  const hulkSizes = [70, 90, 86, 84, 58, 74, 28, 40, 48];
  hulkKeys.forEach((key, i) => put(textures, key, fit(hulks[i]!, hulkSizes[i]!)));

  const debris = sliceGrid(keyImage(src(textures, "src_debris"), "magenta"), 4, 3);
  debris.forEach((c, i) => put(textures, `frag_${i}`, fit(c, 22)));

  const wpn = sliceGrid(keyImage(src(textures, "src_weapons"), "magenta"), 2, 2);
  put(textures, "heli_gun", fit(wpn[0]!, 46));
  put(textures, "rocket", fit(wpn[1]!, 28));
  put(textures, "hellfire", fit(wpn[2]!, 36));
  put(textures, "tow", fit(wpn[3]!, 34));

  const blastSrc = src(textures, "src_blasts");
  const blasts = sliceGrid(matteMagenta(copyToCanvas(blastSrc, blastSrc.width, blastSrc.height)), 2, 2);
  blasts.forEach((c, i) => put(textures, `blast_${i}`, fit(c, 88)));

  const shadowSrc = [
    "heli_body",
    "enemy_heli",
    "cannon",
    "rocket",
    "hellfire",
    "tow",
    "tank_hull",
    "tank_turret",
    "hulk_tank_turret",
    "hulk_tank_hull",
    "boat",
    "tower",
    "bunker",
    "radar",
    "soldier",
    "frag_metal",
    "frag_sand",
    "frag_dark",
    ...Array.from({ length: 12 }, (_, i) => `frag_${i}`),
  ];
  for (const key of shadowSrc) {
    if (textures.exists(key)) bakeShadows(textures, key);
  }
}

export function shadowKey(base: string, z: number): string {
  const lvl = z < 22 ? 0 : z < 52 ? 1 : z < 88 ? 2 : 3;
  return `${base}_sh${lvl}`;
}

export function shadowOff(z: number): { x: number; y: number } {
  return { x: z * 0.24, y: z * 0.58 };
}

export function shadowAlpha(z: number): number {
  const a = 0.52 - z * 0.0009;
  return a < 0.4 ? 0.4 : a > 0.52 ? 0.52 : a;
}

function src(textures: Phaser.Textures.TextureManager, key: string): HTMLImageElement {
  return textures.get(key).getSourceImage() as HTMLImageElement;
}

function put(
  textures: Phaser.Textures.TextureManager,
  key: string,
  c: HTMLCanvasElement
): void {
  if (textures.exists(key)) textures.remove(key);
  textures.addCanvas(key, c);
}

function copyToCanvas(img: CanvasImageSource, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  g.drawImage(img, 0, 0, w, h);
  return c;
}

function keyImage(img: HTMLImageElement, mode: "magenta" | "studio"): HTMLCanvasElement {
  const c = copyToCanvas(img, img.width, img.height);
  const g = c.getContext("2d")!;
  const pix = g.getImageData(0, 0, c.width, c.height);
  const d = pix.data;
  const w = c.width;
  const h = c.height;
  const n = w * h;
  const bg = new Uint8Array(n);

  const isKey = (i: number): boolean => {
    const o = i * 4;
    const r = d[o]!;
    const gc = d[o + 1]!;
    const b = d[o + 2]!;
    if (r > 170 && b > 170 && gc < 180 && (r + b) / 2 - gc > 28) return true;
    if (mode === "studio") {
      const mx = Math.max(r, gc, b);
      const mn = Math.min(r, gc, b);
      if (mn > 198) return true;
      if (mx > 155 && mx - mn < 24 && mn > 125) return true;
    }
    return false;
  };

  const q: number[] = [];
  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = y * w + x;
    if (bg[i]) return;
    if (!isKey(i)) return;
    bg[i] = 1;
    q.push(i);
  };
  for (let x = 0; x < w; x++) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    push(0, y);
    push(w - 1, y);
  }
  if (mode === "magenta") {
    for (let i = 0; i < n; i++) {
      if (!bg[i] && isKey(i)) {
        bg[i] = 1;
        q.push(i);
      }
    }
  }
  for (let qi = 0; qi < q.length; qi++) {
    const i = q[qi]!;
    const x = i % w;
    const y = (i / w) | 0;
    push(x - 1, y);
    push(x + 1, y);
    push(x, y - 1);
    push(x, y + 1);
  }

  for (let i = 0; i < n; i++) {
    if (!bg[i]) continue;
    d[i * 4 + 3] = 0;
  }
  for (let i = 0; i < n; i++) {
    if (bg[i]) continue;
    const o = i * 4;
    const r = d[o]!;
    const gc = d[o + 1]!;
    const b = d[o + 2]!;
    if (r > 140 && b > 140 && gc < 200) {
      const spill = Math.min(r, b) - gc;
      if (spill > 8) {
        d[o] = Math.min(255, gc + 20);
        d[o + 2] = Math.min(255, gc + 12);
      }
    }
  }
  g.putImageData(pix, 0, 0);
  return trim(c);
}

function matteMagenta(src: HTMLCanvasElement): HTMLCanvasElement {
  const g = src.getContext("2d")!;
  const pix = g.getImageData(0, 0, src.width, src.height);
  const d = pix.data;
  const n = d.length / 4;
  const alpha = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const r = d[o]!;
    const gc = d[o + 1]!;
    const b = d[o + 2]!;
    const spill = Math.max(0, Math.min(r, b) - gc);
    const chroma = (r + b) * 0.5 - gc;
    const key = chroma <= 10 ? 0 : Math.min(1, (chroma - 10) / 95);
    d[o] = Math.max(0, r - spill);
    d[o + 2] = Math.max(0, b - spill);
    alpha[i] = key >= 0.97 ? 0 : (d[o + 3]! / 255) * (1 - key);
  }
  const w = src.width;
  const h = src.height;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let s = alpha[i]! * 4;
      let c = 4;
      if (x > 0) {
        s += alpha[i - 1]!;
        c++;
      }
      if (x < w - 1) {
        s += alpha[i + 1]!;
        c++;
      }
      if (y > 0) {
        s += alpha[i - w]!;
        c++;
      }
      if (y < h - 1) {
        s += alpha[i + w]!;
        c++;
      }
      d[i * 4 + 3] = (s / c) * 255;
    }
  }
  g.putImageData(pix, 0, 0);
  return src;
}

function trim(src: HTMLCanvasElement): HTMLCanvasElement {
  const g = src.getContext("2d")!;
  const pix = g.getImageData(0, 0, src.width, src.height);
  const d = pix.data;
  let x0 = src.width;
  let y0 = src.height;
  let x1 = 0;
  let y1 = 0;
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      if (d[(y * src.width + x) * 4 + 3]! < 12) continue;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < x0) return src;
  const pad = 4;
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  x1 = Math.min(src.width - 1, x1 + pad);
  y1 = Math.min(src.height - 1, y1 + pad);
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  c.getContext("2d")!.drawImage(src, x0, y0, w, h, 0, 0, w, h);
  return c;
}

function fit(src: HTMLCanvasElement, max: number): HTMLCanvasElement {
  const s = max / Math.max(src.width, src.height);
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(src.width * s));
  c.height = Math.max(1, Math.round(src.height * s));
  const g = c.getContext("2d")!;
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = "high";
  g.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

function sliceGrid(src: HTMLCanvasElement, cols: number, rows: number): HTMLCanvasElement[] {
  const cw = (src.width / cols) | 0;
  const ch = (src.height / rows) | 0;
  const out: HTMLCanvasElement[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const c = document.createElement("canvas");
      c.width = cw;
      c.height = ch;
      c.getContext("2d")!.drawImage(src, col * cw, row * ch, cw, ch, 0, 0, cw, ch);
      out.push(trim(c));
    }
  }
  return out;
}

function rowStats(src: HTMLCanvasElement): { count: number; minx: number; maxx: number }[] {
  const g = src.getContext("2d")!;
  const pix = g.getImageData(0, 0, src.width, src.height);
  const d = pix.data;
  const rows: { count: number; minx: number; maxx: number }[] = [];
  for (let y = 0; y < src.height; y++) {
    let count = 0;
    let minx = src.width;
    let maxx = 0;
    for (let x = 0; x < src.width; x++) {
      if (d[(y * src.width + x) * 4 + 3]! < 18) continue;
      count++;
      if (x < minx) minx = x;
      if (x > maxx) maxx = x;
    }
    rows.push({ count, minx, maxx });
  }
  return rows;
}

function cupolaOrigin(src: HTMLCanvasElement): { x: number; y: number } {
  const rows = rowStats(src);
  const maxCount = Math.max(1, ...rows.map((r) => r.count));
  let sx = 0;
  let sy = 0;
  let wsum = 0;
  const y0 = (src.height * 0.4) | 0;
  for (let y = y0; y < rows.length; y++) {
    const r = rows[y]!;
    if (r.count < maxCount * 0.5) continue;
    const cx = (r.minx + r.maxx) / 2;
    sx += cx * r.count;
    sy += y * r.count;
    wsum += r.count;
  }
  if (wsum < 8) return { x: 0.5, y: 0.78 };
  return { x: sx / wsum / src.width, y: sy / wsum / src.height };
}

function darkMountOrigin(src: HTMLCanvasElement): { x: number; y: number } {
  const g = src.getContext("2d")!;
  const pix = g.getImageData(0, 0, src.width, src.height);
  const d = pix.data;
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const o = (y * src.width + x) * 4;
      if (d[o + 3]! < 40) continue;
      const lum = 0.3 * d[o]! + 0.5 * d[o + 1]! + 0.2 * d[o + 2]!;
      if (lum > 58) continue;
      sx += x;
      sy += y;
      n++;
    }
  }
  if (n < 20) return { x: 0.5, y: 0.4 };
  return { x: sx / n / src.width, y: sy / n / src.height };
}

function bakeShadows(textures: Phaser.Textures.TextureManager, key: string): void {
  const img = textures.get(key).getSourceImage() as CanvasImageSource;
  const w = (img as HTMLCanvasElement).width || (img as HTMLImageElement).width;
  const h = (img as HTMLCanvasElement).height || (img as HTMLImageElement).height;
  const blurs = [0.2, 0.9, 1.8, 3.0];
  const dens = [0.88, 0.8, 0.74, 0.68];
  blurs.forEach((blur, i) => {
    const pad = Math.ceil(blur * 2) + 4;
    const c = document.createElement("canvas");
    c.width = w + pad * 2;
    c.height = h + pad * 2;
    const g = c.getContext("2d")!;
    g.filter = `blur(${blur}px)`;
    g.drawImage(img, pad, pad, w, h);
    g.filter = "none";
    const pix = g.getImageData(0, 0, c.width, c.height);
    const d = pix.data;
    const mul = dens[i]!;
    for (let p = 0; p < d.length; p += 4) {
      const a = d[p + 3]!;
      if (a < 8) continue;
      d[p] = 12;
      d[p + 1] = 10;
      d[p + 2] = 6;
      d[p + 3] = Math.min(200, a * mul);
    }
    g.putImageData(pix, 0, 0);
    put(textures, `${key}_sh${i}`, c);
  });
}
