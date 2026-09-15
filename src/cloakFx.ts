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
  float edge = smoothstep(0.28, 1.2, r);
  vec2 dir = c / max(r, 1e-4);

  // Multi-scale phase grain — fine digital crawl + mid cells.
  float fine = noise(uv * 240.0 + vec2(uTime * 4.2, -uTime * 2.8));
  float mid = noise(uv * 86.0 + vec2(-uTime * 1.6, uTime * 2.1));
  float micro = hash(floor(uv * 520.0 + uTime * 18.0));
  float detail = fine * 0.45 + mid * 0.35 + micro * 0.2;
  float spark = step(0.78, fine) * (0.5 + 0.5 * mid);
  float band = sin(uTime * 5.2 + r * 18.0 + mid * 6.28);
  float shimmer = 0.45 + 0.55 * band;

  // Soft radial base + strong local warp locked to the fine detail.
  vec2 detailWarp = vec2(
    noise(uv * 190.0 + vec2(uTime * 5.4, 11.0)) - 0.5,
    noise(uv * 190.0 + vec2(7.0, -uTime * 4.6)) - 0.5
  );
  float local = 0.35 + detail * 0.9 + spark * 0.7;
  vec2 warped = uv + dir * (0.012 * amt * edge * shimmer);
  warped += detailWarp * (0.028 * amt * edge * local);
  warped.x += sin(uv.y * 110.0 + uTime * 8.0 + fine * 14.0) * 0.009 * amt * edge * local;
  warped.y += cos(uv.x * 88.0 - uTime * 6.4 + mid * 10.0) * 0.007 * amt * edge * local;
  // Sparse hot-pixel jitter so the rim reads as dissolving phase dust.
  warped += (vec2(micro, hash(floor(uv * 520.0) + 19.0)) - 0.5) * (0.012 * amt * edge * spark);
  warped = clamp(warped, 0.0, 1.0);

  float split = (0.007 + 0.016 * detail + 0.01 * spark) * amt * edge;
  float rr = texture2D(uMainSampler, warped + vec2(split, split * 0.35)).r;
  float gg = texture2D(uMainSampler, warped).g;
  float bb = texture2D(uMainSampler, warped - vec2(split, -split * 0.25)).b;
  vec3 color = vec3(rr, gg, bb);

  // Cool rim light with fine speckled energy on the detail peaks.
  vec3 rim = vec3(0.35, 0.85, 1.15) * (0.1 + 0.22 * shimmer + 0.35 * spark);
  color += rim * edge * amt * (0.55 + detail * 0.7);
  color = mix(color, color * vec3(0.74, 0.9, 1.28), edge * amt * (0.35 + detail * 0.35));
  color += vec3(0.55, 0.95, 1.35) * spark * edge * amt * 0.18;

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
