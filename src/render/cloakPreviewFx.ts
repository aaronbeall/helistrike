import Phaser from "phaser";

/**
 * Field Manual phase-cloak preview: a standalone replica of the in-mission cloak distortion
 * (render/cloakFx.ts) as a per-object pipeline, so the live camera effect is untouched.
 * UVs span the object; coverage comes from the warped texture alpha, cut to a disc.
 */
export const CLOAK_PREVIEW_PIPELINE = "PhaseCloakPreview";

const CLOAK_PREVIEW_FRAG = `
#define SHADER_NAME PHASE_CLOAK_PREVIEW_FS

#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform sampler2D uMainSampler;
uniform float uTime;
uniform float uAmount;
uniform float uFreq;
uniform float uStrength;
uniform float uCenter;
uniform float uFisheye;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

vec4 cloakColor(vec2 uv, float amt) {
  float fq = max(uFreq, 0.001);
  vec2 c = uv * 2.0 - 1.0;
  float r = length(c);
  // Soft center, strong rim — distortion lives at the frame edge.
  float edge = smoothstep(0.38, 1.05, r);
  edge *= edge;
  // uCenter > 0 carries the distortion across the whole frame (preview disc).
  edge = mix(edge, 0.6 + 0.4 * edge, clamp(uCenter, 0.0, 1.0));
  // Fisheye: magnify the middle, rim stays put (0 = off).
  vec2 base = 0.5 + 0.5 * c * (1.0 - uFisheye + uFisheye * r * r);
  vec2 dir = c / max(r, 1e-4);

  // Fine phase veil — high-freq pattern that drives the warp.
  vec2 drift = vec2(uTime * 0.55, -uTime * 0.38);
  float n1 = noise(uv * 96.0 * fq + drift);
  float n2 = noise(uv * 210.0 * fq - drift * 1.7 + 17.0);
  float n3 = noise(uv * 420.0 * fq + drift * 2.4 + 41.0);
  // Ridged detail so the pattern reads as thin filaments, not soft blobs.
  float ridge = 1.0 - abs(n1 * 2.0 - 1.0);
  float detail = ridge * 0.5 + n2 * 0.32 + n3 * 0.18;
  float filament = smoothstep(0.42, 0.92, detail);

  // Pattern gradient → local warp direction (screen bends along the fine details).
  float eps = 0.0028 / fq;
  float dx = noise((uv + vec2(eps, 0.0)) * 96.0 * fq + drift)
           - noise((uv - vec2(eps, 0.0)) * 96.0 * fq + drift);
  float dy = noise((uv + vec2(0.0, eps)) * 96.0 * fq + drift)
           - noise((uv - vec2(0.0, eps)) * 96.0 * fq + drift);
  vec2 g = vec2(dx, dy);
  float gLen = max(length(g), 1e-4);
  vec2 gDir = g / gLen;
  // Tangential crawl along filaments + radial push scaled by detail.
  vec2 tang = vec2(-gDir.y, gDir.x);
  float str = max(uStrength, 0.0);
  float push = (0.022 + 0.045 * filament) * amt * edge * str;
  vec2 warped = base;
  warped += gDir * ((detail - 0.5) * 2.0) * push;
  warped += tang * (n2 - 0.5) * push * 1.35;
  warped += dir * (filament * 0.018 * amt * edge * str);
  // Extra fine jitter on the hottest filaments so edges look liquid.
  warped += (vec2(n3, n2) - 0.5) * (0.014 * amt * edge * filament * str);
  warped = clamp(warped, 0.0, 1.0);

  float split = (0.004 + 0.012 * filament) * amt * edge * str;
  vec4 sr = texture2D(uMainSampler, warped + gDir * split);
  vec4 sg = texture2D(uMainSampler, warped);
  vec4 sb = texture2D(uMainSampler, warped - gDir * split);
  vec3 color = vec3(sr.r, sg.g, sb.b);
  // Coverage follows the warped samples, so transparent-backed art visibly moves.
  float alpha = max(sg.a, max(sr.a, sb.a));

  // Light cool tint only — keep the warp readable.
  color = mix(color, color * vec3(0.78, 0.92, 1.22), edge * amt * (0.25 + filament * 0.35));
  color += vec3(0.25, 0.7, 1.05) * filament * edge * amt * 0.08;
  return vec4(max(color, vec3(0.0)), alpha);
}
varying vec2 outTexCoord;
varying float outTintEffect;
varying vec4 outTint;

void main() {
  float amt = clamp(uAmount, 0.0, 1.0);
  vec4 cc = cloakColor(outTexCoord, amt);
  // Cut to a disc; premultiplied output (texture samples already are).
  float disc = (1.0 - smoothstep(0.96, 1.0, length(outTexCoord * 2.0 - 1.0))) * outTint.a;
  gl_FragColor = vec4(cc.rgb * disc, cc.a * disc);
}
`;

/** Looping preview with the in-mission pulse (tickCloakFx). */
export class CloakPreviewPipeline extends Phaser.Renderer.WebGL.Pipelines.SinglePipeline {
  /** Preview px over screen px — filament scale matches the full-screen effect. */
  freq = 0.1;
  /** Warp / split multiplier — the tiny preview needs more than the full-screen effect. */
  strength = 2.4;
  /** 1 = distortion reaches the disc center (not just the rim). */
  center = 1;
  /** Barrel magnify toward the middle. */
  fisheye = 0.35;

  constructor(game: Phaser.Game) {
    super({ game, name: CLOAK_PREVIEW_PIPELINE, fragShader: CLOAK_PREVIEW_FRAG });
  }

  onBind(): void {
    const t = this.game.loop.time;
    this.set1f("uTime", t * 0.001);
    this.set1f("uAmount", 0.72 + 0.28 * Math.sin(t * 0.006));
    this.set1f("uFreq", this.freq);
    this.set1f("uStrength", this.strength);
    this.set1f("uCenter", this.center);
    this.set1f("uFisheye", this.fisheye);
  }
}

/** Register the preview pipeline (WebGL only). Returns it, or undefined on Canvas. */
export function ensureCloakPreviewPipeline(game: Phaser.Game): CloakPreviewPipeline | undefined {
  const renderer = game.renderer;
  if (!(renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer)) return undefined;
  const existing = renderer.pipelines.get(CLOAK_PREVIEW_PIPELINE) as CloakPreviewPipeline | undefined;
  if (existing) return existing;
  return renderer.pipelines.add(CLOAK_PREVIEW_PIPELINE, new CloakPreviewPipeline(game)) as CloakPreviewPipeline;
}
