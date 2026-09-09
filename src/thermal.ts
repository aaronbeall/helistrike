import Phaser from "phaser";

export const THERMAL_PIPELINE = "ThermalWhiteHot";
export type ThermalPalette = "white_hot" | "full_spectrum";

const THERMAL_FRAG = `
#define SHADER_NAME THERMAL_WHITE_HOT_FS

#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform sampler2D uMainSampler;
uniform float uTime;
uniform float uPalette;

varying vec2 outTexCoord;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 fullSpectrum(float heat) {
  vec3 black = vec3(0.002, 0.004, 0.012);
  vec3 violet = vec3(0.12, 0.0, 0.34);
  vec3 blue = vec3(0.0, 0.16, 0.92);
  vec3 cyan = vec3(0.0, 0.9, 1.0);
  vec3 green = vec3(0.05, 0.92, 0.28);
  vec3 yellow = vec3(1.0, 0.94, 0.0);
  vec3 red = vec3(1.0, 0.08, 0.0);
  vec3 white = vec3(1.0, 0.98, 0.86);
  vec3 color = mix(black, violet, smoothstep(0.0, 0.1, heat));
  color = mix(color, blue, smoothstep(0.07, 0.2, heat));
  color = mix(color, cyan, smoothstep(0.18, 0.32, heat));
  color = mix(color, green, smoothstep(0.29, 0.42, heat));
  color = mix(color, yellow, smoothstep(0.39, 0.56, heat));
  color = mix(color, red, smoothstep(0.53, 0.76, heat));
  return mix(color, white, smoothstep(0.73, 1.0, heat));
}

void main() {
  vec4 source = texture2D(uMainSampler, outTexCoord);
  float luma = dot(source.rgb, vec3(0.299, 0.587, 0.114));
  float brightest = max(source.r, max(source.g, source.b));

  // Semantic heat is encoded as magenta by hot Game Objects. Ordinary terrain
  // can retain subtle detail, but its luminance is capped far below live targets.
  float semanticHeat = clamp(min(source.r, source.b) - source.g * 0.72, 0.0, 1.0);
  semanticHeat = smoothstep(0.025, 0.82, semanticHeat);
  float sceneHeat = smoothstep(0.04, 0.9, luma) * 0.27;
  float naturalHot = smoothstep(0.76, 1.0, brightest) * 0.42;
  float heat = max(semanticHeat, max(sceneHeat, naturalHot));

  vec3 cold = vec3(0.006, 0.012, 0.022);
  vec3 cool = vec3(0.045, 0.075, 0.105);
  vec3 warm = vec3(0.34, 0.38, 0.42);
  vec3 hot = vec3(1.0, 0.985, 0.91);
  vec3 color = mix(cold, cool, smoothstep(0.0, 0.3, heat));
  color = mix(color, warm, smoothstep(0.22, 0.7, heat));
  color = mix(color, hot, smoothstep(0.62, 1.0, heat));
  color = mix(color, fullSpectrum(heat), step(0.5, uPalette));

  // Single-pass sensor texture: cheap grain, subtle scan structure, and vignette.
  float grain = hash(gl_FragCoord.xy + vec2(uTime * 37.0, uTime * 19.0)) - 0.5;
  float scan = (fract(gl_FragCoord.y * 0.25 + uTime * 0.3) - 0.5) * 0.012;
  vec2 centered = outTexCoord * 2.0 - 1.0;
  float vignette = 1.0 - smoothstep(0.48, 1.42, dot(centered, centered)) * 0.24;
  color = (color + grain * 0.018 + scan) * vignette;

  gl_FragColor = vec4(max(color, vec3(0.0)), source.a);
}
`;

export class ThermalPipeline extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline {
  palette: ThermalPalette = "white_hot";

  constructor(game: Phaser.Game) {
    super({
      game,
      name: THERMAL_PIPELINE,
      fragShader: THERMAL_FRAG,
      renderTarget: true,
    });
  }

  onPreRender(): void {
    this.set1f("uTime", this.game.loop.time * 0.001);
    this.set1f("uPalette", this.palette === "full_spectrum" ? 1 : 0);
  }
}

export function ensureThermalPipeline(game: Phaser.Game): boolean {
  const renderer = game.renderer;
  if (!(renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer)) return false;
  if (!renderer.pipelines.postPipelineClasses.has(THERMAL_PIPELINE)) {
    renderer.pipelines.addPostPipeline(THERMAL_PIPELINE, ThermalPipeline);
  }
  return true;
}

export function setThermalPipeline(
  camera: Phaser.Cameras.Scene2D.Camera,
  enabled: boolean,
  palette: ThermalPalette = "white_hot"
): boolean {
  if (!ensureThermalPipeline(camera.scene.game)) return false;
  const active = camera.postPipelines.some((pipeline) => pipeline.name === THERMAL_PIPELINE);
  if (enabled && !active) camera.setPostPipeline(THERMAL_PIPELINE);
  else if (!enabled && active) camera.removePostPipeline(THERMAL_PIPELINE);
  if (enabled) {
    const pipeline = camera.postPipelines.find(
      (candidate) => candidate.name === THERMAL_PIPELINE
    ) as ThermalPipeline | undefined;
    if (pipeline) pipeline.palette = palette;
  }
  return true;
}
