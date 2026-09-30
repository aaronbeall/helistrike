import Phaser from "phaser";

/**
 * Field Manual Time Warp preview: a standalone replica of the warpwire lens
 * (render/warpDistort.ts) as a per-object pipeline, so the live camera effect is untouched.
 * The lens lives in a centered bubble (diameter = object height); outside it the texture
 * draws unwarped, so things can be seen entering and leaving the warp.
 */
export const WARP_PREVIEW_PIPELINE = "WarpLensPreview";

const WARP_PREVIEW_FRAG = `
#define SHADER_NAME WARP_LENS_PREVIEW_FS

#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform sampler2D uMainSampler;
uniform float uTime;
uniform float uAmount;
uniform float uStrength;
uniform float uFisheye;
uniform float uAspect;

varying vec2 outTexCoord;
varying float outTintEffect;
varying vec4 outTint;

// Bubble space (|p| = 1 at the bubble rim) → texture UV.
vec2 toUv(vec2 p) {
  return vec2(p.x / uAspect, p.y) * 0.5 + 0.5;
}

vec4 tap(vec2 p) {
  return texture2D(uMainSampler, clamp(toUv(p), 0.0, 1.0));
}

void main() {
  vec2 uv = outTexCoord;
  vec4 plain = texture2D(uMainSampler, uv);
  vec2 p = vec2((uv.x - 0.5) * uAspect, uv.y - 0.5) * 2.0;
  float r = length(p);
  if (r >= 1.0) {
    gl_FragColor = plain * outTint.a;
    return;
  }

  float amt = clamp(uAmount, 0.0, 1.0);
  float str = max(uStrength, 0.0);
  // Fisheye: magnify the bubble middle, rim stays put.
  vec2 q = p * (1.0 - uFisheye + uFisheye * r * r);
  float edge = smoothstep(0.28, 1.18, r);
  float pulse = 0.55 + 0.45 * sin(uTime * 2.4 + r * 6.5);
  vec2 dir = p / max(r, 1e-4);
  // Radial crawl + slight swirl toward the rim (same shape as the in-mission lens).
  float push = (0.018 + 0.028 * pulse) * amt * edge * str * 2.0;
  float swirl = 0.035 * amt * edge * str * sin(uTime * 1.7 + r * 9.0);
  mat2 rot = mat2(cos(swirl), -sin(swirl), sin(swirl), cos(swirl));
  vec2 w = rot * (q + dir * push);

  // Duochrome plate separation at the bubble rim: red and cyan (G+B) plates slip apart.
  float plateEdge = smoothstep(0.55, 1.15, r) * amt * str;
  float pa = uTime * 0.35;
  vec2 plateDir = vec2(cos(pa), sin(pa) * 1.4);
  vec2 offR = (plateDir * 0.022 + w * 0.028) * plateEdge;
  vec2 offC = (-plateDir * 0.022 - w * 0.028) * plateEdge;
  float split = (0.003 + 0.01 * amt) * edge * pulse * str * 2.0;
  vec4 sr = tap(w + dir * split + offR);
  vec4 sc = tap(w - dir * split + offC);
  vec3 color = vec3(sr.r, sc.g, sc.b);
  float alpha = max(sr.a, sc.a);
  // Cool rim cast so the warp reads as space bending, not just blur.
  color = mix(color, color * vec3(0.72, 0.9, 1.35), edge * amt * 0.55);

  // Soft seam into the undistorted surround.
  float m = 1.0 - smoothstep(0.93, 1.0, r);
  vec3 outRgb = mix(plain.rgb, max(color, vec3(0.0)), m);
  float outA = mix(plain.a, alpha, m);
  gl_FragColor = vec4(outRgb, outA) * outTint.a;
}
`;

export class WarpPreviewPipeline extends Phaser.Renderer.WebGL.Pipelines.SinglePipeline {
  /** Lens multiplier — the tiny preview needs more than the full-screen effect. */
  strength = 1.8;
  /** Barrel magnify toward the bubble middle. */
  fisheye = 0.45;
  /** Object width / height — the bubble spans the height, centered. */
  aspect = 1;

  constructor(game: Phaser.Game) {
    super({ game, name: WARP_PREVIEW_PIPELINE, fragShader: WARP_PREVIEW_FRAG });
  }

  onBind(): void {
    this.set1f("uTime", this.game.loop.time * 0.001);
    this.set1f("uAmount", 0.92);
    this.set1f("uStrength", this.strength);
    this.set1f("uFisheye", this.fisheye);
    this.set1f("uAspect", this.aspect);
  }
}

/** Register the preview pipeline (WebGL only). Returns it, or undefined on Canvas. */
export function ensureWarpPreviewPipeline(game: Phaser.Game): WarpPreviewPipeline | undefined {
  const renderer = game.renderer;
  if (!(renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer)) return undefined;
  const existing = renderer.pipelines.get(WARP_PREVIEW_PIPELINE) as WarpPreviewPipeline | undefined;
  if (existing) return existing;
  return renderer.pipelines.add(WARP_PREVIEW_PIPELINE, new WarpPreviewPipeline(game)) as WarpPreviewPipeline;
}
