import Phaser from "phaser";

export const SHOCK_PIPELINE = "ElectricShock";

/** Electric shock: frame jolt, radial RGB split, blue desaturation, strobe, and crackling arcs (edges strongest). */
const SHOCK_FRAG = `
#define SHADER_NAME ELECTRIC_SHOCK_FS

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
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

void main() {
  vec2 uv = outTexCoord;
  float a = clamp(uAmount, 0.0, 1.0);
  if (a < 0.001) {
    gl_FragColor = texture2D(uMainSampler, uv);
    return;
  }
  float tick = floor(uTime * 32.0);

  // Jolt: the frame twitches each flicker tick.
  uv += (vec2(hash(vec2(tick, 1.3)), hash(vec2(tick, 7.1))) - 0.5) * 0.014 * a;

  // Radial chromatic split.
  vec2 c = uv - 0.5;
  float ca = 0.028 * a * (0.55 + hash(vec2(tick, 3.0)));
  float r = texture2D(uMainSampler, uv + c * ca).r;
  float g = texture2D(uMainSampler, uv).g;
  float b = texture2D(uMainSampler, uv - c * ca).b;
  vec3 col = vec3(r, g, b);

  // Wash toward electric blue, contrast punch.
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(col, vec3(l) * vec3(0.72, 0.95, 1.4), 0.6 * a);
  col = mix(col, (col - 0.5) * 1.35 + 0.5, a);

  // Strobe: hard blue-white flicker.
  float strobe = step(0.5, hash(vec2(tick, 9.9)));
  col += vec3(0.5, 0.78, 1.0) * strobe * 0.32 * a;

  // Crackling arcs: jagged noise-traced filaments, brighter toward the screen edges.
  float edge = smoothstep(0.18, 0.72, length(c) * 1.45);
  float arcs = 0.0;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    if (hash(vec2(fi, tick + 3.0)) < 0.35) continue;
    float vertical = step(0.5, hash(vec2(fi, tick + 11.0)));
    vec2 p = mix(uv, uv.yx, vertical);
    float y0 = hash(vec2(fi, tick * 0.5 + 1.7));
    float yy = y0 + (noise(vec2(p.x * 22.0 + fi * 7.0, tick)) - 0.5) * 0.16 + (noise(vec2(p.x * 90.0, tick + fi)) - 0.5) * 0.03;
    float d = abs(p.y - yy);
    arcs += 0.0018 / (d + 0.0018);
  }
  col += vec3(0.62, 0.86, 1.0) * min(arcs, 3.0) * a * mix(0.25, 1.0, edge) * 0.55;

  // Edge crackle glow.
  col += vec3(0.3, 0.55, 1.0) * edge * a * 0.4 * (0.45 + 0.55 * hash(vec2(tick, 5.0)));

  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
}
`;

export class ShockPipeline extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline {
  amount = 0;

  constructor(game: Phaser.Game) {
    super({ game, name: SHOCK_PIPELINE, fragShader: SHOCK_FRAG, renderTarget: true });
  }

  onPreRender(): void {
    this.set1f("uTime", this.game.loop.time * 0.001);
    this.set1f("uAmount", this.amount);
  }
}

export function ensureShockPipeline(game: Phaser.Game): boolean {
  const renderer = game.renderer;
  if (!(renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer)) return false;
  if (!renderer.pipelines.postPipelineClasses.has(SHOCK_PIPELINE)) {
    renderer.pipelines.addPostPipeline(SHOCK_PIPELINE, ShockPipeline);
  }
  return true;
}

export function setShockPipeline(camera: Phaser.Cameras.Scene2D.Camera | null | undefined, enabled: boolean, amount = 0): boolean {
  const game = camera?.scene?.game;
  if (!camera || !game) return false;
  if (!ensureShockPipeline(game)) return false;
  const active = camera.postPipelines?.some((pipeline) => pipeline.name === SHOCK_PIPELINE) ?? false;
  if (enabled && !active) camera.setPostPipeline(SHOCK_PIPELINE);
  else if (!enabled && active) camera.removePostPipeline(SHOCK_PIPELINE);
  if (enabled) {
    const pipeline = camera.postPipelines.find((p) => p.name === SHOCK_PIPELINE) as ShockPipeline | undefined;
    if (pipeline) pipeline.amount = Phaser.Math.Clamp(amount, 0, 1);
  }
  return true;
}
