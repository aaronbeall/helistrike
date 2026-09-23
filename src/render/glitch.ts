import Phaser from "phaser";

export const GLITCH_PIPELINE = "EmpGlitch";

const GLITCH_FRAG = `
#define SHADER_NAME EMP_GLITCH_FS

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

void main() {
  vec2 uv = outTexCoord;
  float amt = clamp(uAmount, 0.0, 1.0);
  if (amt < 0.001) {
    gl_FragColor = texture2D(uMainSampler, uv);
    return;
  }

  float tick = floor(uTime * 18.0);
  float band = floor(uv.y * (10.0 + 28.0 * amt));
  float tear = hash(vec2(band, tick));
  if (tear > 0.62) {
    uv.x = fract(uv.x + (tear - 0.5) * 0.14 * amt);
  }
  float block = hash(vec2(floor(uv.y * 7.0), tick * 0.37));
  if (block > 0.84) {
    uv.x = fract(uv.x + (block - 0.5) * 0.22 * amt);
  }

  float split = (0.004 + 0.012 * amt) * (0.55 + hash(vec2(tick, 2.7)));
  float r = texture2D(uMainSampler, uv + vec2(split, 0.0)).r;
  float g = texture2D(uMainSampler, uv).g;
  float b = texture2D(uMainSampler, uv - vec2(split, 0.0)).b;
  vec3 color = vec3(r, g, b);
  color = mix(color, color * vec3(0.62, 0.88, 1.35), amt * 0.7);

  float scan = (fract(gl_FragCoord.y * 0.28 + uTime * 9.0) - 0.5) * 0.09 * amt;
  float grain = (hash(gl_FragCoord.xy + vec2(uTime * 41.0, uTime * 23.0)) - 0.5) * 0.08 * amt;
  color += scan + grain;

  gl_FragColor = vec4(max(color, vec3(0.0)), 1.0);
}
`;

export class GlitchPipeline extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline {
  amount = 0;

  constructor(game: Phaser.Game) {
    super({
      game,
      name: GLITCH_PIPELINE,
      fragShader: GLITCH_FRAG,
      renderTarget: true,
    });
  }

  onPreRender(): void {
    this.set1f("uTime", this.game.loop.time * 0.001);
    this.set1f("uAmount", this.amount);
  }
}

export function ensureGlitchPipeline(game: Phaser.Game): boolean {
  const renderer = game.renderer;
  if (!(renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer)) return false;
  if (!renderer.pipelines.postPipelineClasses.has(GLITCH_PIPELINE)) {
    renderer.pipelines.addPostPipeline(GLITCH_PIPELINE, GlitchPipeline);
  }
  return true;
}

export function setGlitchPipeline(
  camera: Phaser.Cameras.Scene2D.Camera | null | undefined,
  enabled: boolean,
  amount = 0
): boolean {
  const game = camera?.scene?.game;
  if (!camera || !game) return false;
  if (!ensureGlitchPipeline(game)) return false;
  const active = camera.postPipelines?.some((pipeline) => pipeline.name === GLITCH_PIPELINE) ?? false;
  if (enabled && !active) camera.setPostPipeline(GLITCH_PIPELINE);
  else if (!enabled && active) camera.removePostPipeline(GLITCH_PIPELINE);
  if (enabled) {
    const pipeline = camera.postPipelines.find(
      (candidate) => candidate.name === GLITCH_PIPELINE
    ) as GlitchPipeline | undefined;
    if (pipeline) pipeline.amount = Phaser.Math.Clamp(amount, 0, 1);
  }
  return true;
}
