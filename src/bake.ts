import type Phaser from "phaser";

type Ctx = CanvasRenderingContext2D;

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function ctxOf(c: HTMLCanvasElement): Ctx {
  const g = c.getContext("2d");
  if (!g) throw new Error("2d");
  g.imageSmoothingEnabled = true;
  return g;
}

function roundRect(
  g: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

export function bakeAll(textures: Phaser.Textures.TextureManager): void {
  add(textures, "shadow", drawShadow());
  add(textures, "heli_body", drawPlayerHeli());
  add(textures, "heli_rotor", drawRotor(118, "#1c1e1a", "#3a3d36"));
  add(textures, "heli_gun", drawGun());
  add(textures, "enemy_heli", drawEnemyHeli());
  add(textures, "enemy_rotor", drawRotor(96, "#2a1810", "#5a3a28"));
  add(textures, "tank", drawTank());
  add(textures, "boat", drawBoat());
  add(textures, "tower", drawTower());
  add(textures, "bunker", drawBunker());
  add(textures, "radar", drawRadar());
  add(textures, "soldier", drawSoldier());
  add(textures, "tree", drawTree());
  add(textures, "rock", drawRock());
  add(textures, "cannon", drawCannon());
  add(textures, "rocket", drawRocket());
  add(textures, "hellfire", drawMissile("#c45c1a"));
  add(textures, "tow", drawMissile("#c8b45a"));
  add(textures, "frag_metal", drawFrag("#6a7064"));
  add(textures, "frag_sand", drawFrag("#b89a6a"));
  add(textures, "frag_dark", drawFrag("#3a3c38"));
  add(textures, "spark", drawSpark());
  add(textures, "smoke", drawSmoke());
  add(textures, "muzzle", drawMuzzle());
  add(textures, "reticle", drawReticle());
  add(textures, "lock", drawLock());
  add(textures, "minimap_mask", drawMinimapMask());
}

function add(
  textures: Phaser.Textures.TextureManager,
  key: string,
  c: HTMLCanvasElement
): void {
  if (textures.exists(key)) textures.remove(key);
  textures.addCanvas(key, c);
}

function drawShadow(): HTMLCanvasElement {
  const c = canvas(64, 64);
  const g = ctxOf(c);
  const grd = g.createRadialGradient(32, 32, 4, 32, 32, 30);
  grd.addColorStop(0, "rgba(12,10,6,0.55)");
  grd.addColorStop(1, "rgba(12,10,6,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return c;
}

function drawRotor(size: number, dark: string, light: string): HTMLCanvasElement {
  const c = canvas(size, size);
  const g = ctxOf(c);
  const m = size / 2;
  g.translate(m, m);
  g.strokeStyle = dark;
  g.lineWidth = 5;
  g.lineCap = "round";
  for (let i = 0; i < 4; i++) {
    g.save();
    g.rotate((i * Math.PI) / 2);
    g.beginPath();
    g.moveTo(6, 0);
    g.lineTo(m - 4, 0);
    g.stroke();
    g.strokeStyle = light;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(8, -1.5);
    g.lineTo(m - 6, -1.5);
    g.stroke();
    g.strokeStyle = dark;
    g.lineWidth = 5;
    g.restore();
  }
  g.fillStyle = "#8a9084";
  g.beginPath();
  g.arc(0, 0, 7, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#2e322c";
  g.beginPath();
  g.arc(0, 0, 3, 0, Math.PI * 2);
  g.fill();
  return c;
}

function drawPlayerHeli(): HTMLCanvasElement {
  const c = canvas(128, 128);
  const g = ctxOf(c);
  g.translate(64, 64);
  // tail boom
  g.fillStyle = "#5c6458";
  roundRect(g, -8, -58, 16, 52, 4);
  g.fill();
  g.fillStyle = "#3e463c";
  roundRect(g, -3, -62, 6, 18, 2);
  g.fill();
  // tail rotor stub
  g.fillStyle = "#2a2e28";
  g.fillRect(6, -60, 14, 5);
  // wings / pylons
  g.fillStyle = "#4a5248";
  roundRect(g, -52, -6, 104, 10, 3);
  g.fill();
  // rocket pods
  g.fillStyle = "#2c3028";
  roundRect(g, -50, -4, 16, 22, 3);
  g.fill();
  roundRect(g, 34, -4, 16, 22, 3);
  g.fill();
  g.fillStyle = "#1a1c18";
  for (let i = 0; i < 3; i++) {
    g.fillRect(-47 + i * 4, 10, 3, 8);
    g.fillRect(37 + i * 4, 10, 3, 8);
  }
  // fuselage
  g.fillStyle = "#6e766a";
  g.beginPath();
  g.ellipse(0, 8, 18, 36, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#8a9284";
  g.beginPath();
  g.ellipse(0, 18, 12, 22, 0, 0, Math.PI * 2);
  g.fill();
  // canopy
  g.fillStyle = "#1a2830";
  g.beginPath();
  g.ellipse(0, 28, 9, 14, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "rgba(140,190,210,0.35)";
  g.beginPath();
  g.ellipse(-3, 26, 4, 8, -0.3, 0, Math.PI * 2);
  g.fill();
  // nose
  g.fillStyle = "#5a6256";
  g.beginPath();
  g.moveTo(-8, 40);
  g.lineTo(0, 56);
  g.lineTo(8, 40);
  g.closePath();
  g.fill();
  // national flash
  g.fillStyle = "#c45c28";
  g.fillRect(-4, 2, 8, 4);
  return c;
}

function drawGun(): HTMLCanvasElement {
  const c = canvas(40, 40);
  const g = ctxOf(c);
  g.translate(20, 20);
  g.fillStyle = "#2a2e28";
  g.fillRect(-4, -4, 8, 8);
  g.fillStyle = "#4a4e46";
  roundRect(g, -3, 0, 6, 18, 2);
  g.fill();
  return c;
}

function drawEnemyHeli(): HTMLCanvasElement {
  const c = canvas(110, 110);
  const g = ctxOf(c);
  g.translate(55, 55);
  g.fillStyle = "#5a3a28";
  roundRect(g, -7, -48, 14, 44, 3);
  g.fill();
  g.fillStyle = "#7a4a30";
  g.beginPath();
  g.ellipse(0, 10, 16, 30, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#1a2024";
  g.beginPath();
  g.ellipse(0, 22, 8, 12, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#3a2418";
  roundRect(g, -40, -4, 80, 8, 2);
  g.fill();
  g.fillStyle = "#c8a030";
  g.fillRect(-3, 0, 6, 3);
  return c;
}

function drawTank(): HTMLCanvasElement {
  const c = canvas(72, 72);
  const g = ctxOf(c);
  g.translate(36, 36);
  g.fillStyle = "#3a4034";
  roundRect(g, -28, -18, 56, 36, 4);
  g.fill();
  g.fillStyle = "#2a2e26";
  roundRect(g, -30, -20, 10, 40, 2);
  g.fill();
  roundRect(g, 20, -20, 10, 40, 2);
  g.fill();
  g.fillStyle = "#5a624c";
  roundRect(g, -16, -14, 32, 28, 4);
  g.fill();
  g.fillStyle = "#4a5240";
  g.beginPath();
  g.arc(0, 0, 10, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#2e3228";
  g.fillRect(-3, 0, 6, 28);
  g.fillStyle = "#8a9a6a";
  g.fillRect(-4, -4, 8, 4);
  return c;
}

function drawBoat(): HTMLCanvasElement {
  const c = canvas(80, 48);
  const g = ctxOf(c);
  g.translate(40, 24);
  g.fillStyle = "#3a4a48";
  g.beginPath();
  g.moveTo(-34, -10);
  g.lineTo(30, -8);
  g.lineTo(36, 0);
  g.lineTo(30, 8);
  g.lineTo(-34, 10);
  g.lineTo(-38, 0);
  g.closePath();
  g.fill();
  g.fillStyle = "#c8c4b8";
  roundRect(g, -12, -8, 22, 16, 3);
  g.fill();
  g.fillStyle = "#2a2e28";
  g.fillRect(8, -2, 18, 4);
  return c;
}

function drawTower(): HTMLCanvasElement {
  const c = canvas(56, 56);
  const g = ctxOf(c);
  g.translate(28, 28);
  g.fillStyle = "#6a6458";
  g.fillRect(-16, -16, 32, 32);
  g.fillStyle = "#4a463c";
  g.fillRect(-20, -20, 40, 8);
  g.fillRect(-20, 12, 40, 8);
  g.fillStyle = "#2e3228";
  g.beginPath();
  g.arc(0, 0, 8, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#8a8478";
  g.fillRect(-2, -22, 4, 18);
  return c;
}

function drawBunker(): HTMLCanvasElement {
  const c = canvas(96, 80);
  const g = ctxOf(c);
  g.translate(48, 40);
  g.fillStyle = "#7a6e58";
  roundRect(g, -40, -24, 80, 48, 6);
  g.fill();
  g.fillStyle = "#5a5244";
  roundRect(g, -28, -16, 56, 32, 4);
  g.fill();
  g.fillStyle = "#1a1c18";
  g.fillRect(-8, -6, 16, 12);
  g.fillStyle = "#c45c28";
  g.fillRect(-36, -20, 10, 6);
  return c;
}

function drawRadar(): HTMLCanvasElement {
  const c = canvas(88, 88);
  const g = ctxOf(c);
  g.translate(44, 44);
  g.fillStyle = "#5a584c";
  g.fillRect(-22, -14, 44, 36);
  g.fillStyle = "#d8d0c0";
  g.beginPath();
  g.ellipse(0, -8, 28, 10, -0.4, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = "#8a8478";
  g.lineWidth = 3;
  g.stroke();
  g.fillStyle = "#2a2e28";
  g.fillRect(-3, -18, 6, 24);
  return c;
}

function drawSoldier(): HTMLCanvasElement {
  const c = canvas(20, 20);
  const g = ctxOf(c);
  g.translate(10, 10);
  g.fillStyle = "#3a4a32";
  g.beginPath();
  g.arc(0, 2, 5, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#c4a070";
  g.beginPath();
  g.arc(0, -2, 3.2, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#2a2e28";
  g.fillRect(2, 0, 8, 2);
  return c;
}

function drawTree(): HTMLCanvasElement {
  const c = canvas(36, 36);
  const g = ctxOf(c);
  g.translate(18, 18);
  g.fillStyle = "#2a4a30";
  g.beginPath();
  g.arc(0, 0, 14, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#3a6a3c";
  g.beginPath();
  g.arc(-3, -2, 8, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#4a3a28";
  g.beginPath();
  g.arc(0, 0, 3, 0, Math.PI * 2);
  g.fill();
  return c;
}

function drawRock(): HTMLCanvasElement {
  const c = canvas(28, 22);
  const g = ctxOf(c);
  g.fillStyle = "#6a655c";
  g.beginPath();
  g.moveTo(4, 16);
  g.lineTo(8, 4);
  g.lineTo(20, 2);
  g.lineTo(26, 14);
  g.lineTo(14, 20);
  g.closePath();
  g.fill();
  g.fillStyle = "#8a8478";
  g.beginPath();
  g.moveTo(10, 8);
  g.lineTo(18, 6);
  g.lineTo(16, 12);
  g.closePath();
  g.fill();
  return c;
}

function drawCannon(): HTMLCanvasElement {
  const c = canvas(10, 10);
  const g = ctxOf(c);
  g.fillStyle = "#e8d090";
  g.beginPath();
  g.arc(5, 5, 3, 0, Math.PI * 2);
  g.fill();
  return c;
}

function drawRocket(): HTMLCanvasElement {
  const c = canvas(18, 8);
  const g = ctxOf(c);
  g.fillStyle = "#3a3c38";
  roundRect(g, 2, 2, 12, 4, 1);
  g.fill();
  g.fillStyle = "#c45c28";
  g.beginPath();
  g.moveTo(14, 1);
  g.lineTo(18, 4);
  g.lineTo(14, 7);
  g.closePath();
  g.fill();
  return c;
}

function drawMissile(color: string): HTMLCanvasElement {
  const c = canvas(24, 10);
  const g = ctxOf(c);
  g.fillStyle = color;
  roundRect(g, 2, 2, 16, 6, 2);
  g.fill();
  g.fillStyle = "#e8e0d0";
  g.fillRect(4, 3, 6, 4);
  return c;
}

function drawFrag(color: string): HTMLCanvasElement {
  const c = canvas(16, 16);
  const g = ctxOf(c);
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(3, 10);
  g.lineTo(6, 2);
  g.lineTo(13, 5);
  g.lineTo(14, 12);
  g.lineTo(7, 15);
  g.closePath();
  g.fill();
  return c;
}

function drawSpark(): HTMLCanvasElement {
  const c = canvas(12, 12);
  const g = ctxOf(c);
  const grd = g.createRadialGradient(6, 6, 0, 6, 6, 6);
  grd.addColorStop(0, "#fff6c8");
  grd.addColorStop(0.4, "#ff9a32");
  grd.addColorStop(1, "rgba(255,80,0,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 12, 12);
  return c;
}

function drawSmoke(): HTMLCanvasElement {
  const c = canvas(32, 32);
  const g = ctxOf(c);
  const grd = g.createRadialGradient(16, 16, 2, 16, 16, 15);
  grd.addColorStop(0, "rgba(80,70,55,0.55)");
  grd.addColorStop(1, "rgba(40,36,28,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 32, 32);
  return c;
}

function drawMuzzle(): HTMLCanvasElement {
  const c = canvas(28, 16);
  const g = ctxOf(c);
  const grd = g.createRadialGradient(8, 8, 0, 14, 8, 14);
  grd.addColorStop(0, "#fff8d0");
  grd.addColorStop(0.5, "#ffb040");
  grd.addColorStop(1, "rgba(255,80,0,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 28, 16);
  return c;
}

function drawReticle(): HTMLCanvasElement {
  const c = canvas(48, 48);
  const g = ctxOf(c);
  g.strokeStyle = "rgba(232,184,74,0.9)";
  g.lineWidth = 1.5;
  g.beginPath();
  g.arc(24, 24, 16, 0, Math.PI * 2);
  g.stroke();
  g.beginPath();
  g.moveTo(24, 4);
  g.lineTo(24, 12);
  g.moveTo(24, 36);
  g.lineTo(24, 44);
  g.moveTo(4, 24);
  g.lineTo(12, 24);
  g.moveTo(36, 24);
  g.lineTo(44, 24);
  g.stroke();
  return c;
}

function drawLock(): HTMLCanvasElement {
  const c = canvas(40, 40);
  const g = ctxOf(c);
  g.strokeStyle = "#ff5a3a";
  g.lineWidth = 2;
  const s = 8;
  g.beginPath();
  g.moveTo(s, 4);
  g.lineTo(4, 4);
  g.lineTo(4, s);
  g.moveTo(36 - s, 4);
  g.lineTo(36, 4);
  g.lineTo(36, s);
  g.moveTo(s, 36);
  g.lineTo(4, 36);
  g.lineTo(4, 36 - s);
  g.moveTo(36 - s, 36);
  g.lineTo(36, 36);
  g.lineTo(36, 36 - s);
  g.stroke();
  return c;
}

function drawMinimapMask(): HTMLCanvasElement {
  const c = canvas(200, 200);
  const g = ctxOf(c);
  g.fillStyle = "#fff";
  g.beginPath();
  g.arc(100, 100, 96, 0, Math.PI * 2);
  g.fill();
  return c;
}
