import Phaser from "phaser";

/** Matches terrain sun XY in `lightTerrainPixel` (world.ts). */
const LIGHT_X = -0.64;
const LIGHT_Y = -0.44;

export const EDGE_LIGHT = "EdgeLight";

/** Rim strength — 0 = off, ~0.35–0.5 soft; cranked high for testing. */
export const EDGE_LIGHT_STRENGTH = .4;

/** Bevel width in texels (1 = hairline; 6–10 = fat rim). */
export const EDGE_LIGHT_RADIUS = 8;

type EdgeData = {
  rot: number;
  texelX: number;
  texelY: number;
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  strength: number;
  radius: number;
};

const FRAG = `
#define SHADER_NAME EDGE_LIGHT_FS

#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform sampler2D uMainSampler;
uniform float uRot;
uniform vec2 uTexel;
uniform vec4 uFrame;
uniform float uStrength;
uniform float uRadius;

varying vec2 outTexCoord;
varying float outTintEffect;
varying vec4 outTint;

vec2 clampFrame(vec2 uv) {
  return clamp(uv, uFrame.xy, uFrame.zw);
}

vec2 edgeNormal(vec2 uv, vec2 step) {
  float aL = texture2D(uMainSampler, clampFrame(uv + vec2(-step.x, 0.0))).a;
  float aR = texture2D(uMainSampler, clampFrame(uv + vec2( step.x, 0.0))).a;
  float aU = texture2D(uMainSampler, clampFrame(uv + vec2(0.0, -step.y))).a;
  float aD = texture2D(uMainSampler, clampFrame(uv + vec2(0.0,  step.y))).a;
  return vec2(aL - aR, aU - aD);
}

void main ()
{
  vec4 texture = texture2D(uMainSampler, outTexCoord);
  vec4 texel = vec4(outTint.bgr * outTint.a, outTint.a);
  vec4 color = texture * texel;

  if (outTintEffect == 1.0)
  {
    color.rgb = mix(texture.rgb, outTint.bgr * outTint.a, texture.a);
  }
  else if (outTintEffect == 2.0)
  {
    color = texel;
  }

  if (texture.a > 0.04 && uStrength > 0.001)
  {
    // Wide + mid samples so the rim stays thick while keeping some sharpness.
    vec2 nWide = edgeNormal(outTexCoord, uTexel * uRadius);
    vec2 nMid = edgeNormal(outTexCoord, uTexel * max(1.0, uRadius * 0.45));
    vec2 n = nWide * 0.65 + nMid * 0.35;
    float nlen = length(n);
    if (nlen > 0.008)
    {
      n /= nlen;
      float c = cos(-uRot);
      float s = sin(-uRot);
      vec2 L = normalize(vec2(${LIGHT_X}, ${LIGHT_Y}));
      vec2 Ls = vec2(c * L.x - s * L.y, s * L.x + c * L.y);
      float ndot = dot(n, Ls);
      float edge = smoothstep(0.008, 0.22, nlen);
      color.rgb *= 1.0 + ndot * uStrength * edge;
    }
  }

  gl_FragColor = color;
}
`;

export class EdgeLightPipeline extends Phaser.Renderer.WebGL.Pipelines.SinglePipeline {
  constructor(game: Phaser.Game) {
    super({
      game,
      name: EDGE_LIGHT,
      fragShader: FRAG,
    });
  }

  boot(): void {
    super.boot();
    this.set1f("uRot", 0);
    this.set2f("uTexel", 1 / 64, 1 / 64);
    this.set4f("uFrame", 0, 0, 1, 1);
    this.set1f("uStrength", EDGE_LIGHT_STRENGTH);
    this.set1f("uRadius", EDGE_LIGHT_RADIUS);
  }

  onBind(gameObject?: Phaser.GameObjects.GameObject): void {
    super.onBind(gameObject);
    const data = (gameObject as Phaser.GameObjects.Image | undefined)?.pipelineData as
      | Partial<EdgeData>
      | undefined;
    if (!data) return;
    this.set1f("uRot", data.rot ?? 0);
    this.set2f("uTexel", data.texelX ?? 0.01, data.texelY ?? 0.01);
    this.set4f("uFrame", data.u0 ?? 0, data.v0 ?? 0, data.u1 ?? 1, data.v1 ?? 1);
    this.set1f("uStrength", data.strength ?? EDGE_LIGHT_STRENGTH);
    this.set1f("uRadius", data.radius ?? EDGE_LIGHT_RADIUS);
  }

  onBatch(gameObject?: Phaser.GameObjects.GameObject): void {
    if (gameObject) this.flush();
  }
}

export function ensureEdgeLightPipeline(game: Phaser.Game): boolean {
  const r = game.renderer;
  if (!(r instanceof Phaser.Renderer.WebGL.WebGLRenderer)) return false;
  if (!r.pipelines.has(EDGE_LIGHT)) {
    r.pipelines.add(EDGE_LIGHT, new EdgeLightPipeline(game));
  }
  return true;
}

/** Alpha-edge bevel lit by terrain sun, in this sprite's rotation. */
export function applyEdgeLight(
  img: Phaser.GameObjects.Image,
  rot: number,
  strength = EDGE_LIGHT_STRENGTH
): void {
  const r = img.scene?.game.renderer;
  if (!(r instanceof Phaser.Renderer.WebGL.WebGLRenderer) || !r.pipelines.has(EDGE_LIGHT)) return;
  if (img.pipeline?.name !== EDGE_LIGHT) img.setPipeline(EDGE_LIGHT);
  const src = img.frame.source;
  const tw = Math.max(1, src.width);
  const th = Math.max(1, src.height);
  img.setPipelineData("rot", rot);
  img.setPipelineData("texelX", 1 / tw);
  img.setPipelineData("texelY", 1 / th);
  img.setPipelineData("u0", img.frame.u0);
  img.setPipelineData("v0", img.frame.v0);
  img.setPipelineData("u1", img.frame.u1);
  img.setPipelineData("v1", img.frame.v1);
  img.setPipelineData("strength", strength);
  img.setPipelineData("radius", EDGE_LIGHT_RADIUS);
}

export function clearEdgeLight(img: Phaser.GameObjects.Image): void {
  if (img.pipeline?.name === EDGE_LIGHT) img.resetPipeline();
}
