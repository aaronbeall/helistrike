import type Phaser from "phaser";
import { bakeShadows } from "./sprites";

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
  add(textures, "heli_gun", drawGun());
  add(textures, "enemy_heli", drawEnemyHeli());
  add(textures, "tank", drawTank());
  add(textures, "enemy_boat", drawBoat());
  add(textures, "building_tower", drawTower());
  add(textures, "building_bunker", drawBunker());
  add(textures, "building_radar", drawRadar());
  add(textures, "enemy_troop_soldier", drawSoldier());
  add(textures, "doodad_tree", drawTree());
  add(textures, "doodad_pine", drawPine());
  add(textures, "doodad_palm", drawPalm());
  add(textures, "doodad_cactus", drawCactus(false));
  add(textures, "doodad_cactus2", drawCactus(true));
  add(textures, "doodad_bush", drawBush("#2e5a32", "#4a7a3c"));
  add(textures, "doodad_shrub", drawBush("#5a4a28", "#8a7040"));
  add(textures, "doodad_rock", drawRock());
  add(textures, "doodad_boulder", drawBoulder());
  add(textures, "doodad_reed", drawReed());
  add(textures, "doodad_dead", drawDeadTree());
  add(textures, "doodad_snowrock", drawSnowRock());
  add(textures, "cannon", drawTracer("chain"));
  add(textures, "shell", drawTracer("shell"));
  add(textures, "tracer_sm", drawTracer("small"));
  add(textures, "tracer_aa", drawTracer("aa"));
  add(textures, "rocket", drawRocket());
  add(textures, "hellfire", drawMissile("#c45c1a"));
  add(textures, "tow", drawMissile("#c8b45a"));
  add(textures, "fx_frag_metal", drawFrag("#6a7064"));
  add(textures, "fx_frag_sand", drawFrag("#b89a6a"));
  add(textures, "fx_frag_dark", drawFrag("#3a3c38"));
  add(textures, "fx_spark", drawSpark());
  add(textures, "fx_smoke", drawSmoke());
  add(textures, "fx_muzzle", drawMuzzle());
  add(textures, "reticle", drawReticle());
  add(textures, "reticle_sq", drawReticleSquare());
  add(textures, "lock", drawLock());
  add(textures, "minimap_mask", drawMinimapMask());
  add(textures, "track", drawTrack("tread"));
  add(textures, "track_tread", drawTrack("tread"));
  add(textures, "track_tire", drawTrack("tire"));
  add(textures, "track_dual", drawTrack("dual"));
  add(textures, "track_wide", drawTrack("wide"));
  add(textures, "track_mono", drawTrack("mono"));
  add(textures, "fx_flame", drawFlame());
  add(textures, "fx_blast_0", drawBlast(0));
  add(textures, "fx_blast_1", drawBlast(1));
  add(textures, "fx_blast_2", drawBlast(2));
  add(textures, "fx_blast_3", drawBlast(3));
  add(textures, "enemy_tank", drawTank());
  add(textures, "enemy_tank_gun", drawTurret());
  add(textures, "enemy_tank_hulk", drawTank());
  add(textures, "enemy_tank_gun_hulk", drawHulkTurret());
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
  const c = canvas(28, 52);
  const g = ctxOf(c);
  g.translate(14, 8);
  g.fillStyle = "#2a2e28";
  g.fillRect(-5, -4, 10, 10);
  g.fillStyle = "#4a4e46";
  roundRect(g, -2.5, 4, 5, 36, 2);
  g.fill();
  g.fillStyle = "#1a1c18";
  g.fillRect(-1.5, 36, 3, 6);
  return c;
}

function drawTrack(kind: "tread" | "tire" | "dual" | "wide" | "mono" = "tread"): HTMLCanvasElement {
  const c = canvas(32, 22);
  const g = ctxOf(c);
  const dirt = (a: number) => `rgba(32,26,16,${a})`;
  if (kind === "tread") {
    g.fillStyle = dirt(0.5);
    g.fillRect(2, 2, 10, 18);
    g.fillRect(20, 2, 10, 18);
    g.fillStyle = dirt(0.28);
    for (let y = 3; y < 19; y += 4) {
      g.fillRect(3, y, 8, 1.4);
      g.fillRect(21, y, 8, 1.4);
    }
    return c;
  }
  if (kind === "tire") {
    g.fillStyle = dirt(0.42);
    g.fillRect(5, 3, 3.2, 16);
    g.fillRect(24, 3, 3.2, 16);
    g.fillStyle = dirt(0.22);
    for (let y = 4; y < 18; y += 5) {
      g.fillRect(5, y, 3.2, 1.1);
      g.fillRect(24, y, 3.2, 1.1);
    }
    return c;
  }
  if (kind === "mono") {
    g.fillStyle = dirt(0.48);
    g.fillRect(14, 2, 4.2, 18);
    g.fillStyle = dirt(0.24);
    for (let y = 4; y < 19; y += 5) g.fillRect(14, y, 4.2, 1.15);
    return c;
  }
  if (kind === "dual") {
    g.fillStyle = dirt(0.44);
    g.fillRect(2, 3, 3, 16);
    g.fillRect(6.5, 3, 3, 16);
    g.fillRect(22.5, 3, 3, 16);
    g.fillRect(27, 3, 3, 16);
    return c;
  }
  g.fillStyle = dirt(0.46);
  g.fillRect(3, 2, 8, 18);
  g.fillRect(21, 2, 8, 18);
  g.fillStyle = dirt(0.2);
  for (let y = 4; y < 19; y += 6) {
    g.fillRect(3, y, 8, 1.2);
    g.fillRect(21, y, 8, 1.2);
  }
  return c;
}

function drawFlame(): HTMLCanvasElement {
  const c = canvas(22, 22);
  const g = ctxOf(c);
  const blob = (x: number, y: number, r: number, inner: string, mid: string, outer: string) => {
    const grd = g.createRadialGradient(x, y, r * 0.08, x, y, r);
    grd.addColorStop(0, inner);
    grd.addColorStop(0.45, mid);
    grd.addColorStop(1, outer);
    g.fillStyle = grd;
    g.beginPath();
    g.ellipse(x, y, r * 1.05, r * 0.92, -0.25, 0, Math.PI * 2);
    g.fill();
  };
  blob(11, 12, 10, "rgba(255,80,10,0.9)", "rgba(255,50,0,0.55)", "rgba(180,0,0,0)");
  blob(10.2, 10.4, 7.2, "rgba(255,170,40,1)", "rgba(255,90,12,0.85)", "rgba(255,40,0,0)");
  blob(10.5, 10, 3.4, "rgba(255,252,230,1)", "rgba(255,220,90,0.9)", "rgba(255,140,20,0)");
  return c;
}

function drawBlast(variant: number): HTMLCanvasElement {
  const c = canvas(80, 80);
  const g = ctxOf(c);
  g.translate(40, 40);
  g.rotate(variant * 0.9);
  const outer = g.createRadialGradient(0, 0, 6, 0, 0, 38);
  outer.addColorStop(0, "rgba(22,16,10,0.72)");
  outer.addColorStop(0.35, "rgba(48,32,18,0.5)");
  outer.addColorStop(0.7, "rgba(90,62,32,0.22)");
  outer.addColorStop(1, "rgba(60,44,24,0)");
  g.fillStyle = outer;
  g.beginPath();
  g.ellipse(2, -1, 36 - variant * 2, 30 + variant, 0.2 * variant, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "rgba(10,8,6,0.7)";
  g.beginPath();
  g.ellipse(-2, 1, 12 + variant, 10, 0.4, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "rgba(18,14,10,0.55)";
  const n = 5 + variant;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + variant;
    const r = 10 + ((i * 13 + variant * 7) % 11);
    g.beginPath();
    g.ellipse(Math.cos(a) * r, Math.sin(a) * r, 7 + (i % 3), 4 + (i % 2), a, 0, Math.PI * 2);
    g.fill();
  }
  g.globalCompositeOperation = "destination-out";
  g.fillStyle = "rgba(0,0,0,0.35)";
  for (let i = 0; i < 3; i++) {
    const a = variant * 1.7 + i * 2.1;
    g.beginPath();
    g.ellipse(Math.cos(a) * 16, Math.sin(a) * 14, 4 + i, 3, a, 0, Math.PI * 2);
    g.fill();
  }
  g.globalCompositeOperation = "source-over";
  g.strokeStyle = "rgba(28,22,14,0.35)";
  g.lineWidth = 1.2;
  g.beginPath();
  g.ellipse(0, 0, 18 + variant * 2, 14, 0.3, 0.2, Math.PI * 1.6);
  g.stroke();
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
  return c;
}

function drawTurret(): HTMLCanvasElement {
  const c = canvas(48, 64);
  const g = ctxOf(c);
  g.translate(24, 28);
  g.fillStyle = "#4a5240";
  g.beginPath();
  g.arc(0, 0, 11, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#2e3228";
  g.fillRect(-3, 0, 6, 30);
  g.fillStyle = "#8a9a6a";
  g.fillRect(-4, -4, 8, 4);
  return c;
}

function drawHulkTurret(): HTMLCanvasElement {
  const c = canvas(52, 72);
  const g = ctxOf(c);
  g.translate(26, 34);
  g.fillStyle = "#2a2418";
  g.beginPath();
  g.arc(0, 0, 13, 0.4, Math.PI * 1.85);
  g.lineTo(10, 4);
  g.lineTo(4, -2);
  g.closePath();
  g.fill();
  g.fillStyle = "#3a3428";
  g.beginPath();
  g.arc(-2, 1, 8, 0, Math.PI * 2);
  g.fill();
  g.save();
  g.rotate(0.28);
  g.fillStyle = "#1e1c16";
  g.fillRect(-2.5, -4, 5, 34);
  g.fillStyle = "#4a4030";
  g.fillRect(-2, 8, 4, 10);
  g.fillStyle = "#12100c";
  g.fillRect(-3, 28, 7, 5);
  g.restore();
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
  g.beginPath();
  g.arc(4, 0, 5, 0, Math.PI * 2);
  g.fill();
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
  g.fillStyle = "#3a3c34";
  roundRect(g, -10, -4, 20, 18, 3);
  g.fill();
  g.fillStyle = "#2a2e28";
  g.fillRect(-3, -18, 6, 22);
  g.fillStyle = "#8a8478";
  g.beginPath();
  g.arc(0, -16, 5, 0, Math.PI * 2);
  g.fill();
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

function drawPine(): HTMLCanvasElement {
  const c = canvas(32, 36);
  const g = ctxOf(c);
  g.translate(16, 20);
  g.fillStyle = "#1e3a28";
  g.beginPath();
  g.moveTo(0, -16);
  g.lineTo(11, 4);
  g.lineTo(-11, 4);
  g.closePath();
  g.fill();
  g.fillStyle = "#2f5a38";
  g.beginPath();
  g.moveTo(0, -12);
  g.lineTo(7, 1);
  g.lineTo(-7, 1);
  g.closePath();
  g.fill();
  g.fillStyle = "#3a2c20";
  g.fillRect(-1.5, 2, 3, 8);
  return c;
}

function drawPalm(): HTMLCanvasElement {
  const c = canvas(36, 36);
  const g = ctxOf(c);
  g.translate(18, 22);
  g.fillStyle = "#6a4a28";
  g.beginPath();
  g.moveTo(-1.5, 8);
  g.lineTo(0, -6);
  g.lineTo(1.8, 8);
  g.closePath();
  g.fill();
  g.fillStyle = "#2f6a38";
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI * 0.85 + i * 0.42;
    g.beginPath();
    g.ellipse(Math.cos(a) * 8, Math.sin(a) * 6 - 8, 8, 3.2, a, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}

function drawCactus(branched: boolean): HTMLCanvasElement {
  const c = canvas(28, 36);
  const g = ctxOf(c);
  g.translate(14, 20);
  g.fillStyle = "#2d6a42";
  g.beginPath();
  g.roundRect(-3.5, -14, 7, 26, 3);
  g.fill();
  if (branched) {
    g.beginPath();
    g.roundRect(2, -8, 10, 4, 2);
    g.fill();
    g.beginPath();
    g.roundRect(8, -14, 4, 10, 2);
    g.fill();
    g.beginPath();
    g.roundRect(-12, -4, 10, 4, 2);
    g.fill();
    g.beginPath();
    g.roundRect(-12, -10, 4, 10, 2);
    g.fill();
  }
  g.fillStyle = "#c8d878";
  g.fillRect(-1, -14, 2, 2);
  return c;
}

function drawBush(dark: string, light: string): HTMLCanvasElement {
  const c = canvas(28, 22);
  const g = ctxOf(c);
  g.translate(14, 12);
  g.fillStyle = dark;
  g.beginPath();
  g.arc(-4, 2, 8, 0, Math.PI * 2);
  g.arc(5, 3, 7, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = light;
  g.beginPath();
  g.arc(-2, -1, 5, 0, Math.PI * 2);
  g.fill();
  return c;
}

function drawBoulder(): HTMLCanvasElement {
  const c = canvas(34, 26);
  const g = ctxOf(c);
  g.fillStyle = "#5a5248";
  g.beginPath();
  g.moveTo(4, 18);
  g.lineTo(8, 6);
  g.lineTo(18, 2);
  g.lineTo(30, 8);
  g.lineTo(32, 18);
  g.lineTo(20, 24);
  g.closePath();
  g.fill();
  g.fillStyle = "#8a8274";
  g.beginPath();
  g.moveTo(12, 8);
  g.lineTo(22, 7);
  g.lineTo(18, 14);
  g.closePath();
  g.fill();
  return c;
}

function drawReed(): HTMLCanvasElement {
  const c = canvas(20, 28);
  const g = ctxOf(c);
  g.strokeStyle = "#3a5a32";
  g.lineWidth = 1.4;
  g.lineCap = "round";
  for (let i = 0; i < 5; i++) {
    g.beginPath();
    g.moveTo(6 + i * 2.2, 24);
    g.quadraticCurveTo(8 + i * 2, 12, 4 + i * 3, 4);
    g.stroke();
  }
  g.fillStyle = "#8a9a40";
  g.fillRect(5, 3, 2, 4);
  g.fillRect(12, 5, 2, 4);
  return c;
}

function drawDeadTree(): HTMLCanvasElement {
  const c = canvas(28, 32);
  const g = ctxOf(c);
  g.translate(14, 18);
  g.strokeStyle = "#4a3a2c";
  g.lineWidth = 2.2;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(0, 10);
  g.lineTo(0, -8);
  g.moveTo(0, -2);
  g.lineTo(-7, -10);
  g.moveTo(0, -4);
  g.lineTo(6, -12);
  g.stroke();
  return c;
}

function drawSnowRock(): HTMLCanvasElement {
  const c = canvas(30, 22);
  const g = ctxOf(c);
  g.fillStyle = "#6a6864";
  g.beginPath();
  g.moveTo(3, 16);
  g.lineTo(8, 5);
  g.lineTo(20, 3);
  g.lineTo(28, 14);
  g.lineTo(16, 20);
  g.closePath();
  g.fill();
  g.fillStyle = "#e8eef2";
  g.beginPath();
  g.moveTo(8, 6);
  g.lineTo(20, 4);
  g.lineTo(16, 10);
  g.closePath();
  g.fill();
  return c;
}

function drawTracer(style: "chain" | "shell" | "small" | "aa"): HTMLCanvasElement {
  const cfg = {
    chain: { w: 64, h: 10, core: [255, 250, 220], mid: [255, 210, 80], rim: [255, 140, 32] },
    shell: { w: 72, h: 13, core: [255, 252, 236], mid: [255, 188, 64], rim: [255, 110, 24] },
    small: { w: 36, h: 7, core: [255, 236, 180], mid: [220, 160, 56], rim: [168, 96, 28] },
    aa: { w: 110, h: 6, core: [255, 250, 210], mid: [255, 170, 48], rim: [255, 90, 20] },
  }[style];
  const { w, h } = cfg;
  const c = canvas(w, h);
  const g = ctxOf(c);
  const cy = h / 2;
  const headX = w * 0.8;
  const headR = h * 0.28;
  const tailX = w * 0.05;
  const rgb = (ch: number[], a: number) => `rgba(${ch[0]},${ch[1]},${ch[2]},${a})`;

  const tear = (scaleX: number, scaleY: number) => {
    const hx = headX;
    const hr = headR * scaleY;
    g.beginPath();
    g.moveTo(tailX + (1 - scaleX) * (hx - tailX) * 0.15, cy);
    g.bezierCurveTo(
      w * 0.3,
      cy - h * 0.1 * scaleY,
      hx - hr * 1.35,
      cy - hr,
      hx,
      cy - hr
    );
    g.quadraticCurveTo(hx + hr * 1.2 * scaleX, cy, hx, cy + hr);
    g.bezierCurveTo(
      hx - hr * 1.35,
      cy + hr,
      w * 0.3,
      cy + h * 0.1 * scaleY,
      tailX + (1 - scaleX) * (hx - tailX) * 0.15,
      cy
    );
    g.closePath();
  };

  const along = g.createLinearGradient(tailX, cy, headX + headR, cy);
  along.addColorStop(0, rgb(cfg.rim, 0));
  along.addColorStop(0.22, rgb(cfg.rim, 0.22));
  along.addColorStop(0.55, rgb(cfg.mid, 0.85));
  along.addColorStop(0.82, rgb(cfg.core, 1));
  along.addColorStop(1, rgb(cfg.core, 0.15));

  g.save();
  tear(1.06, 1.12);
  g.fillStyle = rgb(cfg.rim, 0.28);
  g.fill();
  g.restore();

  tear(1, 1);
  g.fillStyle = along;
  g.fill();

  const core = g.createRadialGradient(headX, cy, 0, headX, cy, headR * 1.15);
  core.addColorStop(0, rgb(cfg.core, 1));
  core.addColorStop(0.45, rgb(cfg.mid, 0.7));
  core.addColorStop(1, rgb(cfg.rim, 0));
  g.beginPath();
  g.arc(headX, cy, headR * 1.05, 0, Math.PI * 2);
  g.fillStyle = core;
  g.fill();

  g.fillStyle = rgb([255, 255, 255], style === "small" ? 0.35 : 0.55);
  g.beginPath();
  g.ellipse(headX + headR * 0.12, cy - headR * 0.12, headR * 0.28, headR * 0.18, -0.4, 0, Math.PI * 2);
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
  const c = canvas(16, 10);
  const g = ctxOf(c);
  const grd = g.createRadialGradient(5, 5, 0, 8, 5, 8);
  grd.addColorStop(0, "#fff8d0");
  grd.addColorStop(0.5, "#ffb040");
  grd.addColorStop(1, "rgba(255,80,0,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 16, 10);
  return c;
}

function drawReticle(): HTMLCanvasElement {
  const c = canvas(96, 96);
  const g = ctxOf(c);
  const cx = 48;
  const cy = 48;
  g.strokeStyle = "#e8b84a";
  g.lineWidth = 2;
  g.lineCap = "butt";
  g.beginPath();
  g.arc(cx, cy, 34, 0, Math.PI * 2);
  g.stroke();
  g.beginPath();
  g.moveTo(cx, 6);
  g.lineTo(cx, 26);
  g.moveTo(cx, 70);
  g.lineTo(cx, 90);
  g.moveTo(6, cy);
  g.lineTo(26, cy);
  g.moveTo(70, cy);
  g.lineTo(90, cy);
  g.stroke();
  return c;
}

function drawReticleSquare(): HTMLCanvasElement {
  const c = canvas(96, 96);
  const g = ctxOf(c);
  const cx = 48;
  const cy = 48;
  const half = 30;
  g.strokeStyle = "#e8b84a";
  g.lineWidth = 2;
  g.lineCap = "butt";
  g.strokeRect(cx - half, cy - half, half * 2, half * 2);
  g.beginPath();
  g.moveTo(cx, 6);
  g.lineTo(cx, 26);
  g.moveTo(cx, 70);
  g.lineTo(cx, 90);
  g.moveTo(6, cy);
  g.lineTo(26, cy);
  g.moveTo(70, cy);
  g.lineTo(90, cy);
  g.stroke();
  return c;
}

function drawLock(): HTMLCanvasElement {
  const c = canvas(72, 72);
  const g = ctxOf(c);
  g.strokeStyle = "#ff3a22";
  g.lineWidth = 3.2;
  g.lineCap = "square";
  const s = 16;
  g.beginPath();
  g.moveTo(s, 8);
  g.lineTo(8, 8);
  g.lineTo(8, s);
  g.moveTo(64 - s, 8);
  g.lineTo(64, 8);
  g.lineTo(64, s);
  g.moveTo(s, 64);
  g.lineTo(8, 64);
  g.lineTo(8, 64 - s);
  g.moveTo(64 - s, 64);
  g.lineTo(64, 64);
  g.lineTo(64, 64 - s);
  g.stroke();
  g.strokeStyle = "#ffd0c0";
  g.lineWidth = 1.4;
  g.strokeRect(18, 18, 36, 36);
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

function scorch(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = canvas(src.width, src.height);
  const g = ctxOf(c);
  g.drawImage(src, 0, 0);
  g.globalCompositeOperation = "multiply";
  g.fillStyle = "#5a4a38";
  g.fillRect(0, 0, c.width, c.height);
  g.globalCompositeOperation = "source-atop";
  g.fillStyle = "rgba(18,12,8,0.4)";
  g.fillRect(0, 0, c.width, c.height);
  g.globalCompositeOperation = "source-over";
  g.fillStyle = "rgba(32,22,14,0.6)";
  for (let i = 0; i < 7; i++) {
    g.beginPath();
    g.ellipse(
      c.width * (0.15 + ((i * 37) % 70) / 100),
      c.height * (0.2 + ((i * 53) % 60) / 100),
      3 + (i % 4) * 2,
      2 + (i % 3),
      i * 0.4,
      0,
      Math.PI * 2
    );
    g.fill();
  }
  return c;
}

function drawGunBarrel(len: number, thick: number, olive = "#3a4234"): HTMLCanvasElement {
  const w = Math.ceil(thick * 4);
  const h = Math.ceil(len + thick * 4);
  const c = canvas(w, h);
  const g = ctxOf(c);
  g.translate(w / 2, h * 0.28);
  g.fillStyle = "#4a5240";
  g.beginPath();
  g.arc(0, 0, thick * 1.6, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = olive;
  g.fillRect(-thick * 0.45, 0, thick * 0.9, len);
  g.fillStyle = "#8a9a6a";
  g.fillRect(-thick * 0.55, -thick * 0.5, thick * 1.1, thick * 0.55);
  g.fillStyle = "#1a1c16";
  g.fillRect(-thick * 0.5, len - 2, thick, 4);
  return c;
}

function drawRadarDisk(): HTMLCanvasElement {
  const c = canvas(72, 40);
  const g = ctxOf(c);
  g.translate(36, 22);
  g.fillStyle = "#d8d0c0";
  g.beginPath();
  g.ellipse(0, 0, 30, 11, 0, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = "#8a8478";
  g.lineWidth = 3;
  g.stroke();
  g.fillStyle = "#4a4840";
  g.fillRect(-4, -2, 8, 8);
  return c;
}

function drawTroop(body: string, head: string, weapon: "rifle" | "rpg" | "mg" | "stinger" | "none", extra?: string): HTMLCanvasElement {
  const c = canvas(24, 24);
  const g = ctxOf(c);
  g.translate(12, 13);
  g.fillStyle = body;
  g.beginPath();
  g.arc(0, 2, 5.2, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = head;
  g.beginPath();
  g.arc(0, -2.2, 3.3, 0, Math.PI * 2);
  g.fill();
  if (weapon === "rifle") {
    g.fillStyle = "#2a2e28";
    g.fillRect(2, 0, 9, 2);
  } else if (weapon === "mg") {
    g.fillStyle = "#1e221c";
    g.fillRect(1, -0.5, 12, 2.6);
    g.fillRect(8, -2.2, 2, 2);
  } else if (weapon === "rpg") {
    g.fillStyle = "#4a4030";
    g.fillRect(-2, -1, 14, 3.4);
    g.fillStyle = "#c45c28";
    g.fillRect(10, -1.4, 3, 4.2);
  } else if (weapon === "stinger") {
    g.fillStyle = "#5a6248";
    g.fillRect(-1, -2, 13, 4);
    g.fillStyle = "#2a2e28";
    g.fillRect(10, -2.6, 2, 5.2);
  }
  if (extra === "cap") {
    g.fillStyle = "#2a3a28";
    g.fillRect(-3.4, -5.2, 6.8, 2);
  } else if (extra === "officer") {
    g.fillStyle = "#c42820";
    g.fillRect(-3.8, -5.6, 7.6, 2.6);
    g.fillRect(-6.2, 0.4, 2.4, 3.2);
    g.fillRect(3.8, 0.4, 2.4, 3.2);
    g.fillStyle = "#d4b45a";
    g.fillRect(-0.6, -5.8, 2.2, 1.1);
  } else if (extra === "wrench") {
    g.fillStyle = "#8a8e86";
    g.fillRect(-8, 1, 7, 2);
  }
  return c;
}

function drawPickup(): HTMLCanvasElement {
  const c = canvas(64, 36);
  const g = ctxOf(c);
  g.translate(32, 18);
  g.fillStyle = "#6a4a28";
  roundRect(g, -26, -12, 28, 24, 3);
  g.fill();
  g.fillStyle = "#c4a06a";
  roundRect(g, 0, -11, 24, 22, 2);
  g.fill();
  g.fillStyle = "#2a2e26";
  g.fillRect(-24, -14, 6, 28);
  g.fillRect(16, -14, 6, 28);
  g.fillStyle = "#8ab0c8";
  g.fillRect(-20, -8, 10, 16);
  return c;
}

function drawTruck(): HTMLCanvasElement {
  const c = canvas(72, 38);
  const g = ctxOf(c);
  g.translate(36, 19);
  g.fillStyle = "#4a5238";
  roundRect(g, -32, -12, 22, 24, 3);
  g.fill();
  g.fillStyle = "#c8b888";
  roundRect(g, -10, -14, 38, 28, 3);
  g.fill();
  g.fillStyle = "#8a7a58";
  g.fillRect(-8, -12, 34, 4);
  g.fillStyle = "#2a2e26";
  g.fillRect(-28, -16, 6, 32);
  g.fillRect(20, -16, 6, 32);
  g.fillStyle = "#8ab0c8";
  g.fillRect(-28, -8, 10, 16);
  return c;
}

function drawTanker(): HTMLCanvasElement {
  const c = canvas(76, 36);
  const g = ctxOf(c);
  g.translate(38, 18);
  g.fillStyle = "#4a4e42";
  roundRect(g, -34, -11, 20, 22, 3);
  g.fill();
  g.fillStyle = "#8a6a38";
  roundRect(g, -14, -10, 44, 20, 10);
  g.fill();
  g.fillStyle = "#c45c28";
  g.fillRect(22, -4, 8, 8);
  g.fillStyle = "#2a2e26";
  g.fillRect(-30, -14, 6, 28);
  g.fillRect(20, -14, 6, 28);
  return c;
}

function drawLav(): HTMLCanvasElement {
  const c = canvas(56, 36);
  const g = ctxOf(c);
  g.translate(28, 18);
  g.fillStyle = "#4a5240";
  roundRect(g, -22, -12, 44, 24, 5);
  g.fill();
  g.fillStyle = "#2a2e26";
  g.fillRect(-24, -14, 8, 28);
  g.fillRect(16, -14, 8, 28);
  g.fillStyle = "#5a624c";
  roundRect(g, -10, -8, 20, 16, 3);
  g.fill();
  return c;
}

function drawSam(): HTMLCanvasElement {
  const c = canvas(72, 40);
  const g = ctxOf(c);
  g.translate(36, 20);
  g.fillStyle = "#4a4e40";
  roundRect(g, -32, -12, 24, 24, 3);
  g.fill();
  g.fillStyle = "#6a6248";
  roundRect(g, -8, -14, 36, 28, 3);
  g.fill();
  g.fillStyle = "#2a2e26";
  g.fillRect(-28, -16, 6, 32);
  g.fillRect(22, -16, 6, 32);
  return c;
}

function drawSamGun(): HTMLCanvasElement {
  const c = canvas(40, 48);
  const g = ctxOf(c);
  g.translate(20, 18);
  g.fillStyle = "#4a5240";
  roundRect(g, -12, -8, 24, 16, 2);
  g.fill();
  g.fillStyle = "#2e3228";
  g.fillRect(-4, 4, 8, 22);
  g.fillRect(-9, 6, 6, 18);
  g.fillRect(3, 6, 6, 18);
  return c;
}

function drawPtBoat(): HTMLCanvasElement {
  const c = canvas(64, 32);
  const g = ctxOf(c);
  g.translate(32, 16);
  g.fillStyle = "#2e4a48";
  g.beginPath();
  g.moveTo(-26, -8);
  g.lineTo(22, -6);
  g.lineTo(28, 0);
  g.lineTo(22, 6);
  g.lineTo(-26, 8);
  g.lineTo(-30, 0);
  g.closePath();
  g.fill();
  g.fillStyle = "#c8c4b8";
  roundRect(g, -8, -6, 16, 12, 2);
  g.fill();
  return c;
}

function drawBattleship(): HTMLCanvasElement {
  const c = canvas(140, 48);
  const g = ctxOf(c);
  g.translate(70, 24);
  g.fillStyle = "#3a4848";
  g.beginPath();
  g.moveTo(-64, -12);
  g.lineTo(50, -10);
  g.lineTo(66, 0);
  g.lineTo(50, 10);
  g.lineTo(-64, 12);
  g.lineTo(-68, 0);
  g.closePath();
  g.fill();
  g.fillStyle = "#c4c0b4";
  roundRect(g, -20, -8, 48, 16, 2);
  g.fill();
  g.fillStyle = "#5a584c";
  g.fillRect(-8, -14, 10, 28);
  g.fillStyle = "#2a2e28";
  g.beginPath();
  g.arc(-28, 0, 6, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.arc(4, 0, 6, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.arc(32, 0, 6, 0, Math.PI * 2);
  g.fill();
  return c;
}

function drawBarn(): HTMLCanvasElement {
  const c = canvas(88, 64);
  const g = ctxOf(c);
  g.translate(44, 32);
  g.fillStyle = "#8a4a32";
  roundRect(g, -36, -10, 72, 28, 3);
  g.fill();
  g.fillStyle = "#5a3224";
  g.beginPath();
  g.moveTo(-40, -10);
  g.lineTo(0, -28);
  g.lineTo(40, -10);
  g.closePath();
  g.fill();
  g.fillStyle = "#2a1c14";
  g.fillRect(-8, -4, 16, 20);
  return c;
}

function drawTent(): HTMLCanvasElement {
  const c = canvas(56, 40);
  const g = ctxOf(c);
  g.translate(28, 22);
  g.fillStyle = "#6a7a48";
  g.beginPath();
  g.moveTo(0, -16);
  g.lineTo(22, 12);
  g.lineTo(-22, 12);
  g.closePath();
  g.fill();
  g.fillStyle = "#4a5234";
  g.beginPath();
  g.moveTo(0, -16);
  g.lineTo(6, 12);
  g.lineTo(-6, 12);
  g.closePath();
  g.fill();
  return c;
}

function drawFob(): HTMLCanvasElement {
  const c = canvas(96, 80);
  const g = ctxOf(c);
  g.translate(48, 40);
  g.fillStyle = "#6a6458";
  roundRect(g, -40, -28, 80, 56, 4);
  g.fill();
  g.fillStyle = "#4a463c";
  g.fillRect(-40, -28, 80, 8);
  g.fillRect(-40, 20, 80, 8);
  g.fillStyle = "#c4b898";
  roundRect(g, -16, -12, 32, 24, 2);
  g.fill();
  g.fillStyle = "#c45c28";
  g.fillRect(-36, -22, 10, 6);
  return c;
}

function drawLookout(): HTMLCanvasElement {
  const c = canvas(40, 72);
  const g = ctxOf(c);
  g.translate(20, 40);
  g.fillStyle = "#5a4a38";
  g.fillRect(-6, -8, 12, 36);
  g.fillStyle = "#8a7a60";
  roundRect(g, -16, -28, 32, 22, 2);
  g.fill();
  g.fillStyle = "#2a2e28";
  g.fillRect(-12, -24, 8, 6);
  g.fillRect(4, -24, 8, 6);
  return c;
}

function drawDrone(): HTMLCanvasElement {
  const c = canvas(36, 36);
  const g = ctxOf(c);
  g.translate(18, 18);
  g.fillStyle = "#3a3c38";
  roundRect(g, -8, -6, 16, 12, 3);
  g.fill();
  g.strokeStyle = "#2a2e28";
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(-14, -12);
  g.lineTo(14, 12);
  g.moveTo(14, -12);
  g.lineTo(-14, 12);
  g.stroke();
  g.fillStyle = "#c45c28";
  g.beginPath();
  g.arc(0, 0, 3, 0, Math.PI * 2);
  g.fill();
  return c;
}

function drawHeliSmall(): HTMLCanvasElement {
  const c = canvas(56, 44);
  const g = ctxOf(c);
  g.translate(28, 22);
  g.fillStyle = "#4a3a28";
  roundRect(g, -18, -8, 36, 16, 6);
  g.fill();
  g.fillStyle = "#2a2218";
  g.fillRect(10, -3, 16, 6);
  g.fillStyle = "#8ab0c8";
  g.fillRect(-10, -5, 10, 10);
  return c;
}

function drawHeliHeavy(): HTMLCanvasElement {
  const c = canvas(96, 48);
  const g = ctxOf(c);
  g.translate(48, 24);
  g.fillStyle = "#3a4034";
  roundRect(g, -40, -12, 80, 24, 8);
  g.fill();
  g.fillStyle = "#2a2e26";
  g.beginPath();
  g.arc(-18, 0, 10, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.arc(18, 0, 10, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#5a624c";
  roundRect(g, -12, -8, 24, 16, 3);
  g.fill();
  g.fillStyle = "#8ab0c8";
  g.fillRect(-8, -5, 8, 10);
  return c;
}

function drawMinigun(): HTMLCanvasElement {
  return drawHeliChinGun(true);
}

function drawHeliChinGun(heavy = false): HTMLCanvasElement {
  const c = canvas(heavy ? 26 : 22, heavy ? 52 : 46);
  const g = ctxOf(c);
  g.translate(c.width / 2, heavy ? 12 : 10);
  g.fillStyle = "#2e322e";
  g.beginPath();
  g.ellipse(0, 0, heavy ? 7 : 5.5, heavy ? 6 : 4.5, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#4a4e48";
  roundRect(g, heavy ? -3 : -2.2, 2, heavy ? 6 : 4.4, heavy ? 34 : 30, 1.6);
  g.fill();
  if (heavy) {
    g.fillStyle = "#3a3e38";
    roundRect(g, -5.2, 6, 3.2, 26, 1);
    g.fill();
    roundRect(g, 2, 6, 3.2, 26, 1);
    g.fill();
  }
  g.fillStyle = "#1a1c18";
  g.fillRect(heavy ? -2 : -1.4, heavy ? 34 : 30, heavy ? 4 : 2.8, 5);
  return c;
}

function drawHeliGunEnemy(): HTMLCanvasElement {
  return drawHeliChinGun(false);
}

function drawShipArty(): HTMLCanvasElement {
  const c = canvas(36, 52);
  const g = ctxOf(c);
  g.translate(18, 22);
  g.fillStyle = "#3a464c";
  g.beginPath();
  g.ellipse(0, 2, 14, 11, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#2a3438";
  g.beginPath();
  g.ellipse(0, 2, 9, 7, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#4a585e";
  g.fillRect(-8.5, -18, 5.2, 28);
  g.fillRect(3.3, -18, 5.2, 28);
  g.fillStyle = "#1a2226";
  g.fillRect(-7.6, -22, 3.4, 5);
  g.fillRect(4.2, -22, 3.4, 5);
  return c;
}

function drawShipGatling(): HTMLCanvasElement {
  const c = canvas(28, 44);
  const g = ctxOf(c);
  g.translate(14, 16);
  g.fillStyle = "#3a4448";
  g.beginPath();
  g.arc(0, 2, 8, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#2a3236";
  for (const x of [-4.2, -1.4, 1.4, 4.2]) g.fillRect(x, -16, 2.2, 24);
  g.fillStyle = "#5a6468";
  g.fillRect(-6, 6, 12, 5);
  return c;
}

function drawShipSamPod(): HTMLCanvasElement {
  const c = canvas(30, 40);
  const g = ctxOf(c);
  g.translate(15, 16);
  g.fillStyle = "#3a4448";
  roundRect(g, -11, -8, 22, 20, 2);
  g.fill();
  g.fillStyle = "#2a3236";
  roundRect(g, -9, -14, 18, 10, 1.5);
  g.fill();
  g.fillStyle = "#1a2226";
  for (let i = 0; i < 4; i++) {
    g.beginPath();
    g.arc(-5.4 + (i % 2) * 10.8, -10 + ((i / 2) | 0) * 6, 2.4, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = "#5a6468";
  g.fillRect(-8, 10, 16, 4);
  return c;
}

function drawTowerAa(): HTMLCanvasElement {
  const c = canvas(24, 46);
  const g = ctxOf(c);
  g.translate(12, 14);
  g.fillStyle = "#4a5248";
  g.beginPath();
  g.arc(0, 0, 7, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#2a2e28";
  g.fillRect(-5, -18, 3.2, 26);
  g.fillRect(1.8, -18, 3.2, 26);
  g.fillStyle = "#1a1c18";
  g.fillRect(-4.4, -22, 2, 5);
  g.fillRect(2.4, -22, 2, 5);
  return c;
}

function drawTowerSam(): HTMLCanvasElement {
  const c = canvas(28, 42);
  const g = ctxOf(c);
  g.translate(14, 18);
  g.fillStyle = "#4a5248";
  roundRect(g, -10, -6, 20, 16, 2);
  g.fill();
  g.fillStyle = "#2e3228";
  g.save();
  g.rotate(-0.12);
  roundRect(g, -7, -16, 6, 18, 1);
  g.fill();
  roundRect(g, 1, -16, 6, 18, 1);
  g.fill();
  g.restore();
  g.fillStyle = "#1a1c18";
  g.beginPath();
  g.arc(-4, -16, 2.2, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.arc(4, -16, 2.2, 0, Math.PI * 2);
  g.fill();
  return c;
}

function drawDroneRotor(): HTMLCanvasElement {
  const c = canvas(5, 5);
  const g = ctxOf(c);
  g.translate(2.5, 2.5);
  g.fillStyle = "#2a2c28";
  g.fillRect(-2.4, -0.45, 4.8, 0.9);
  g.fillRect(-0.45, -2.4, 0.9, 4.8);
  g.fillStyle = "#4a4c46";
  g.beginPath();
  g.arc(0, 0, 0.9, 0, Math.PI * 2);
  g.fill();
  return c;
}

export function bakeRosterArt(textures: Phaser.Textures.TextureManager): void {
  const fill = (key: string, c: HTMLCanvasElement) => {
    if (textures.exists(key)) return;
    add(textures, key, c);
  };
  const live: [string, HTMLCanvasElement][] = [
    ["enemy_boat", drawBoat()],
    ["building_tower", drawTower()],
    ["building_radar", drawRadar()],
    ["building_tower_gun", drawGunBarrel(26, 4.5)],
    ["building_tower_aa", drawTowerAa()],
    ["building_tower_sam", drawTowerSam()],
    ["enemy_boat_gun", drawGunBarrel(22, 5)],
    ["enemy_ptboat_gun", drawGunBarrel(18, 4)],
    ["enemy_battleship_gun", drawShipArty()],
    ["enemy_battleship_gun_aa", drawShipGatling()],
    ["enemy_battleship_gun_sam", drawShipSamPod()],
    ["enemy_lav_gun", drawGunBarrel(20, 4.2)],
    ["enemy_sam_gun", drawSamGun()],
    ["building_radar_disk", drawRadarDisk()],
    ["enemy_pickup", drawPickup()],
    ["enemy_truck", drawTruck()],
    ["enemy_tanker", drawTanker()],
    ["enemy_lav", drawLav()],
    ["enemy_sam", drawSam()],
    ["enemy_ptboat", drawPtBoat()],
    ["enemy_battleship", drawBattleship()],
    ["enemy_troop_rpg", drawTroop("#3a4a32", "#c4a070", "rpg")],
    ["enemy_troop_gunner", drawTroop("#3a4a32", "#c4a070", "mg")],
    ["enemy_troop_stinger", drawTroop("#3a4a32", "#c4a070", "stinger")],
    ["enemy_troop_mechanic", drawTroop("#4a4a3a", "#c4a070", "none", "wrench")],
    ["enemy_troop_officer", drawTroop("#2a3a28", "#c4a070", "none", "officer")],
    ["building_barn", drawBarn()],
    ["building_tent", drawTent()],
    ["building_fob", drawFob()],
    ["building_lookout", drawLookout()],
    ["enemy_drone", drawDrone()],
    ["enemy_drone_rotor", drawDroneRotor()],
    ["enemy_heli_small", drawHeliSmall()],
    ["enemy_heli_heavy", drawHeliHeavy()],
    ["enemy_heli_heavy_gun", drawMinigun()],
    ["enemy_heli_gun", drawHeliGunEnemy()],
    ["tracer_aa", drawTracer("aa")],
  ];
  for (const [key, c] of live) fill(key, c);
  for (const [key, c] of live) {
    if (key === "tracer_aa" || key === "building_radar_disk") continue;
    const hulk = `${key}_hulk`;
    if (!textures.exists(hulk)) add(textures, hulk, scorch(c));
  }
  if (textures.exists("enemy_heli_rotor") && !textures.exists("enemy_heli_rotor_hulk")) {
    const img = textures.get("enemy_heli_rotor").getSourceImage() as CanvasImageSource;
    const rc = canvas((img as HTMLImageElement).width || 64, (img as HTMLImageElement).height || 64);
    rc.getContext("2d")!.drawImage(img, 0, 0);
    add(textures, "enemy_heli_rotor_hulk", scorch(rc));
  }
  const shadowKeys = [
    "enemy_boat",
    "building_tower",
    "building_radar",
    "building_tower_gun",
    "enemy_boat_gun",
    "enemy_ptboat_gun",
    "enemy_battleship_gun",
    "enemy_lav_gun",
    "enemy_sam_gun",
    "building_radar_disk",
    "enemy_pickup",
    "enemy_truck",
    "enemy_tanker",
    "enemy_lav",
    "enemy_sam",
    "enemy_ptboat",
    "enemy_battleship",
    "enemy_troop_rpg",
    "enemy_troop_gunner",
    "enemy_troop_stinger",
    "enemy_troop_mechanic",
    "enemy_troop_officer",
    "building_barn",
    "building_tent",
    "building_fob",
    "building_lookout",
    "enemy_drone",
    "enemy_heli_small",
    "enemy_heli_heavy",
    "enemy_heli_heavy_gun",
    "enemy_heli_gun",
    "enemy_battleship_gun_aa",
    "enemy_battleship_gun_sam",
    "building_tower_aa",
    "building_tower_sam",
    "enemy_drone_rotor",
    "tracer_aa",
    "shell",
    "tracer_sm",
  ];
  for (const key of shadowKeys) {
    if (textures.exists(key)) bakeShadows(textures, key);
  }
}

