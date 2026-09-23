/** Procedural cannon tracer sprites (bake + art-gen rig). */

export type TracerRgb = [number, number, number];

export type TracerShapeOpts = {
  w: number;
  h: number;
  core: TracerRgb;
  mid: TracerRgb;
  rim: TracerRgb;
  /** 0 = soft tear tracer, 1 = blunt slug. */
  blunt?: number;
  glow?: number;
  twin?: boolean;
  /** `tear` default. `bolt` = faceted rail dart. `orb` = elongated blob. */
  shape?: "tear" | "bolt" | "orb";
};

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function ctxOf(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const g = c.getContext("2d", { willReadFrequently: true });
  if (!g) throw new Error("2d");
  g.imageSmoothingEnabled = true;
  return g;
}

export function drawTracerShape(opts: TracerShapeOpts): HTMLCanvasElement {
  const { w, h, core, mid, rim } = opts;
  const blunt = opts.blunt ?? 0;
  const glow = opts.glow ?? 0.55;
  const shape = opts.shape ?? "tear";
  const c = canvas(w, h);
  const g = ctxOf(c);
  const cy = h / 2;
  const headX =
    shape === "orb" ? w * 0.56 : shape === "bolt" ? w * 0.86 : w * (0.76 + blunt * 0.06);
  const headR =
    shape === "orb" ? h * 0.34 : shape === "bolt" ? h * 0.16 : h * (0.26 + blunt * 0.08);
  const tailX = shape === "orb" ? w * 0.18 : w * 0.05;
  const rgb = (ch: TracerRgb, a: number) => `rgba(${ch[0]},${ch[1]},${ch[2]},${a})`;

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
    if (blunt > 0.55) {
      g.lineTo(hx + hr * (0.55 + blunt * 0.35), cy - hr * 0.35);
      g.lineTo(hx + hr * (0.55 + blunt * 0.35), cy + hr * 0.35);
      g.lineTo(hx, cy + hr);
    } else {
      g.quadraticCurveTo(hx + hr * 1.2 * scaleX, cy, hx, cy + hr);
    }
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

  const bolt = (scaleX: number, scaleY: number) => {
    const half = h * 0.26 * scaleY;
    const waist = h * 0.12 * scaleY;
    const nose = w * 0.93 * scaleX + (1 - scaleX) * w * 0.5;
    const body = w * 0.38;
    const chin = w * 0.72;
    const tail = w * 0.07;
    g.beginPath();
    g.moveTo(tail, cy);
    g.lineTo(tail + w * 0.1, cy - waist);
    g.lineTo(body, cy - half);
    g.lineTo(chin, cy - half);
    g.lineTo(nose, cy);
    g.lineTo(chin, cy + half);
    g.lineTo(body, cy + half);
    g.lineTo(tail + w * 0.1, cy + waist);
    g.closePath();
  };

  const orb = (scaleX: number, scaleY: number) => {
    g.beginPath();
    g.ellipse(w * 0.56, cy, w * 0.34 * scaleX, h * 0.36 * scaleY, 0, 0, Math.PI * 2);
    g.closePath();
  };

  const profile = (scaleX: number, scaleY: number) => {
    if (shape === "bolt") bolt(scaleX, scaleY);
    else if (shape === "orb") orb(scaleX, scaleY);
    else tear(scaleX, scaleY);
  };

  const paintOrb = () => {
    // Soft round glow pellet — radial only, centered on SHOT_ORIGIN (tip).
    // Tip sits at 0.84×w, so the halo must fit in the remaining tip-side margin
    // or it clips hard on the right (visible as a flat cutoff in the combat rig).
    const ox = w * 0.84;
    const oy = cy;
    const rFit = Math.min(ox, w - ox, oy, h - oy);
    const r = rFit * 0.98;
    const halo = g.createRadialGradient(ox, oy, 0, ox, oy, r);
    halo.addColorStop(0, rgb(core, 1));
    halo.addColorStop(0.22, rgb(core, 0.95));
    halo.addColorStop(0.48, rgb(mid, 0.85));
    halo.addColorStop(0.72, rgb(rim, 0.45));
    halo.addColorStop(1, rgb(rim, 0));
    g.beginPath();
    g.arc(ox, oy, r, 0, Math.PI * 2);
    g.fillStyle = halo;
    g.fill();

    const hot = g.createRadialGradient(ox - r * 0.08, oy - r * 0.1, 0, ox, oy, r * 0.42);
    hot.addColorStop(0, rgb([255, 255, 255], Math.min(1, glow + 0.15)));
    hot.addColorStop(0.35, rgb(core, 0.85));
    hot.addColorStop(1, rgb(mid, 0));
    g.beginPath();
    g.arc(ox, oy, r * 0.42, 0, Math.PI * 2);
    g.fillStyle = hot;
    g.fill();
  };

  const paint = () => {
    if (shape === "orb") {
      paintOrb();
      return;
    }

    const along = g.createLinearGradient(tailX, cy, headX + headR, cy);
    along.addColorStop(0, rgb(rim, 0));
    along.addColorStop(0.22, rgb(rim, 0.22));
    along.addColorStop(0.55, rgb(mid, 0.85));
    along.addColorStop(0.82, rgb(core, 1));
    along.addColorStop(1, rgb(core, 0.15));

    g.save();
    profile(1.06, 1.12);
    g.fillStyle = rgb(rim, 0.28);
    g.fill();
    g.restore();

    profile(1, 1);
    g.fillStyle = along;
    g.fill();

    const coreGrad = g.createRadialGradient(headX, cy, 0, headX, cy, headR * 1.15);
    coreGrad.addColorStop(0, rgb(core, 1));
    coreGrad.addColorStop(0.45, rgb(mid, 0.7));
    coreGrad.addColorStop(1, rgb(rim, 0));
    g.beginPath();
    if (shape === "bolt") {
      g.moveTo(headX + headR * 1.4, cy);
      g.lineTo(headX - headR * 0.4, cy - headR);
      g.lineTo(headX - headR * 0.4, cy + headR);
      g.closePath();
    } else {
      g.arc(headX, cy, headR * 1.05, 0, Math.PI * 2);
    }
    g.fillStyle = coreGrad;
    g.fill();

    g.fillStyle = rgb([255, 255, 255], glow);
    g.beginPath();
    g.ellipse(headX + headR * 0.12, cy - headR * 0.12, headR * 0.28, headR * 0.18, -0.4, 0, Math.PI * 2);
    g.fill();
  };

  if (opts.twin) {
    g.save();
    g.translate(0, -h * 0.18);
    paint();
    g.restore();
    g.save();
    g.translate(0, h * 0.18);
    paint();
    g.restore();
  } else {
    paint();
  }
  return c;
}
