import Phaser from "phaser";

/** Screen-edge timewarp refraction — only attached while warp is active. */
export const WARP_DISTORT_PIPELINE = "WarpEdgeDistort";

const WARP_FRAG = `
#define SHADER_NAME WARP_EDGE_DISTORT_FS

#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform sampler2D uMainSampler;
uniform float uTime;
uniform float uAmount;

varying vec2 outTexCoord;

void main() {
  vec2 uv = outTexCoord;
  float amt = clamp(uAmount, 0.0, 1.0);
  if (amt < 0.001) {
    gl_FragColor = texture2D(uMainSampler, uv);
    return;
  }

  vec2 c = uv * 2.0 - 1.0;
  float r = length(c);
  float edge = smoothstep(0.28, 1.18, r);
  float pulse = 0.55 + 0.45 * sin(uTime * 2.4 + r * 6.5);
  vec2 dir = c / max(r, 1e-4);
  // Radial crawl + slight swirl at the frame rim only.
  float push = (0.018 + 0.028 * pulse) * amt * edge;
  float swirl = 0.035 * amt * edge * sin(uTime * 1.7 + r * 9.0);
  mat2 rot = mat2(cos(swirl), -sin(swirl), sin(swirl), cos(swirl));
  vec2 warped = uv + dir * push;
  warped = 0.5 + rot * (warped * 2.0 - 1.0) * 0.5;
  warped = clamp(warped, 0.0, 1.0);

  float split = (0.003 + 0.01 * amt) * edge * pulse;
  float rr = texture2D(uMainSampler, warped + dir * split).r;
  float gg = texture2D(uMainSampler, warped).g;
  float bb = texture2D(uMainSampler, warped - dir * split).b;
  vec3 color = vec3(rr, gg, bb);
  // Cool rim cast so the warp reads as space bending, not just blur.
  color = mix(color, color * vec3(0.72, 0.9, 1.35), edge * amt * 0.55);

  gl_FragColor = vec4(max(color, vec3(0.0)), 1.0);
}
`;

export class WarpDistortPipeline extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline {
  amount = 0;

  constructor(game: Phaser.Game) {
    super({
      game,
      name: WARP_DISTORT_PIPELINE,
      fragShader: WARP_FRAG,
      renderTarget: true,
    });
  }

  onPreRender(): void {
    this.set1f("uTime", this.game.loop.time * 0.001);
    this.set1f("uAmount", this.amount);
  }
}

export function ensureWarpDistortPipeline(game: Phaser.Game): boolean {
  const renderer = game.renderer;
  if (!(renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer)) return false;
  if (!renderer.pipelines.postPipelineClasses.has(WARP_DISTORT_PIPELINE)) {
    renderer.pipelines.addPostPipeline(WARP_DISTORT_PIPELINE, WarpDistortPipeline);
  }
  return true;
}

/** Attach only while enabled — zero cost when removed from the camera. */
export function setWarpDistortPipeline(
  camera: Phaser.Cameras.Scene2D.Camera | null | undefined,
  enabled: boolean,
  amount = 0
): boolean {
  const game = camera?.scene?.game;
  if (!camera || !game) return false;
  if (!ensureWarpDistortPipeline(game)) return false;
  const active =
    camera.postPipelines?.some((pipeline) => pipeline.name === WARP_DISTORT_PIPELINE) ?? false;
  if (enabled && !active) camera.setPostPipeline(WARP_DISTORT_PIPELINE);
  else if (!enabled && active) camera.removePostPipeline(WARP_DISTORT_PIPELINE);
  if (enabled) {
    const pipeline = camera.postPipelines.find(
      (candidate) => candidate.name === WARP_DISTORT_PIPELINE
    ) as WarpDistortPipeline | undefined;
    if (pipeline) pipeline.amount = Phaser.Math.Clamp(amount, 0, 1);
  }
  return true;
}
