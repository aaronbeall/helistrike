import type Phaser from "phaser";

const SRC = {
  heli: "sprites/helistrike-heli-player.png",
  enemy: "sprites/helistrike-heli-enemy.png",
  tank: "sprites/helistrike-tank.png",
  units: "sprites/helistrike-units.png",
  rock: "sprites/helistrike-rock.png",
} as const;

export function preloadArt(scene: Phaser.Scene): void {
  scene.load.image("src_heli", SRC.heli);
  scene.load.image("src_enemy", SRC.enemy);
  scene.load.image("src_tank", SRC.tank);
  scene.load.image("src_units", SRC.units);
  scene.load.image("src_rock", SRC.rock);
}

export function prepareArt(textures: Phaser.Textures.TextureManager): void {
  put(textures, "heli_body", fit(keyImage(src(textures, "src_heli"), "studio"), 120));
  put(textures, "enemy_heli", fit(keyImage(src(textures, "src_enemy"), "magenta"), 104));
  put(textures, "tank", fit(keyImage(src(textures, "src_tank"), "magenta"), 72));
  put(textures, "rock", fit(keyImage(src(textures, "src_rock"), "magenta"), 36));

  const sheet = keyImage(src(textures, "src_units"), "magenta");
  const cells = sliceGrid(sheet, 3, 2);
  const keys = ["boat", "tower", "bunker", "radar", "soldier", "tree"] as const;
  const sizes = [78, 58, 92, 88, 26, 42];
  keys.forEach((key, i) => put(textures, key, fit(cells[i]!, sizes[i]!)));
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
