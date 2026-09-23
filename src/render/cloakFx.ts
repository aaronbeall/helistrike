import Phaser from "phaser";

/** Phase-cloak edge shimmer — only attached while cloak is active. */
export const CLOAK_FX_PIPELINE = "PhaseCloakFx";

const CLOAK_FRAG = `
#define SHADER_NAME PHASE_CLOAK_FX_FS

#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform sampler2D uMainSampler;
uniform float uTime;
uniform float uAmount;

varying vec2 outTexCoord;

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

void main() {
  vec2 uv = outTexCoord;
  float amt = clamp(uAmount, 0.0, 1.0);
  if (amt < 0.001) {
    gl_FragColor = texture2D(uMainSampler, uv);
    return;
  }

  vec2 c = uv * 2.0 - 1.0;
  float r = length(c);
  // Soft center, strong rim — distortion lives at the frame edge.
  float edge = smoothstep(0.38, 1.05, r);
  edge *= edge;
  vec2 dir = c / max(r, 1e-4);

  // Fine phase veil — high-freq pattern that drives the warp.
  vec2 drift = vec2(uTime * 0.55, -uTime * 0.38);
  float n1 = noise(uv * 96.0 + drift);
  float n2 = noise(uv * 210.0 - drift * 1.7 + 17.0);
  float n3 = noise(uv * 420.0 + drift * 2.4 + 41.0);
  // Ridged detail so the pattern reads as thin filaments, not soft blobs.
  float ridge = 1.0 - abs(n1 * 2.0 - 1.0);
  float detail = ridge * 0.5 + n2 * 0.32 + n3 * 0.18;
  float filament = smoothstep(0.42, 0.92, detail);

  // Pattern gradient → local warp direction (screen bends along the fine details).
  float eps = 0.0028;
  float dx = noise((uv + vec2(eps, 0.0)) * 96.0 + drift)
           - noise((uv - vec2(eps, 0.0)) * 96.0 + drift);
  float dy = noise((uv + vec2(0.0, eps)) * 96.0 + drift)
           - noise((uv - vec2(0.0, eps)) * 96.0 + drift);
  vec2 g = vec2(dx, dy);
  float gLen = max(length(g), 1e-4);
  vec2 gDir = g / gLen;
  // Tangential crawl along filaments + radial push scaled by detail.
  vec2 tang = vec2(-gDir.y, gDir.x);
  float push = (0.022 + 0.045 * filament) * amt * edge;
  vec2 warped = uv;
  warped += gDir * ((detail - 0.5) * 2.0) * push;
  warped += tang * (n2 - 0.5) * push * 1.35;
  warped += dir * (filament * 0.018 * amt * edge);
  // Extra fine jitter on the hottest filaments so edges look liquid.
  warped += (vec2(n3, n2) - 0.5) * (0.014 * amt * edge * filament);
  warped = clamp(warped, 0.0, 1.0);

  float split = (0.004 + 0.012 * filament) * amt * edge;
  float rr = texture2D(uMainSampler, warped + gDir * split).r;
  float gg = texture2D(uMainSampler, warped).g;
  float bb = texture2D(uMainSampler, warped - gDir * split).b;
  vec3 color = vec3(rr, gg, bb);

  // Light cool tint only — keep the warp readable.
  color = mix(color, color * vec3(0.78, 0.92, 1.22), edge * amt * (0.25 + filament * 0.35));
  color += vec3(0.25, 0.7, 1.05) * filament * edge * amt * 0.08;

  gl_FragColor = vec4(max(color, vec3(0.0)), 1.0);
}
`;

export class CloakFxPipeline extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline {
  amount = 0;

  constructor(game: Phaser.Game) {
    super({
      game,
      name: CLOAK_FX_PIPELINE,
      fragShader: CLOAK_FRAG,
      renderTarget: true,
    });
  }

  onPreRender(): void {
    this.set1f("uTime", this.game.loop.time * 0.001);
    this.set1f("uAmount", this.amount);
  }
}

export function ensureCloakFxPipeline(game: Phaser.Game): boolean {
  const renderer = game.renderer;
  if (!(renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer)) return false;
  if (!renderer.pipelines.postPipelineClasses.has(CLOAK_FX_PIPELINE)) {
    renderer.pipelines.addPostPipeline(CLOAK_FX_PIPELINE, CloakFxPipeline);
  }
  return true;
}

/** Attach only while enabled — zero cost when removed from the camera. */
export function setCloakFxPipeline(
  camera: Phaser.Cameras.Scene2D.Camera | null | undefined,
  enabled: boolean,
  amount = 0
): boolean {
  const game = camera?.scene?.game;
  if (!camera || !game) return false;
  if (!ensureCloakFxPipeline(game)) return false;
  const active =
    camera.postPipelines?.some((pipeline) => pipeline.name === CLOAK_FX_PIPELINE) ?? false;
  if (enabled && !active) camera.setPostPipeline(CLOAK_FX_PIPELINE);
  else if (!enabled && active) camera.removePostPipeline(CLOAK_FX_PIPELINE);
  if (enabled) {
    const pipeline = camera.postPipelines.find(
      (candidate) => candidate.name === CLOAK_FX_PIPELINE
    ) as CloakFxPipeline | undefined;
    if (pipeline) pipeline.amount = Phaser.Math.Clamp(amount, 0, 1);
  }
  return true;
}
