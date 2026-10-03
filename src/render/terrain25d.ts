import Phaser from "phaser";
import {
  Camera25D,
  GROUND_H_ZERO,
  GROUND_Z_SCALE,
  TEX,
  WORLD,
  Z_SCALE_NEAR,
  type WorldData,
} from "../worldgen/world";
import { fbm } from "../worldgen/noise";

export type Terrain25DTexture =
  | string
  | Phaser.Textures.Texture
  | Phaser.GameObjects.RenderTexture;

export interface Terrain25DOptions {
  /** Base terrain CanvasTexture (normally the key "map_terrain"). */
  terrain: Terrain25DTexture;
  /** Optional transparent world-sized Dynamic/RenderTexture decal layer. */
  decal?: Terrain25DTexture | null;
  /** Number of cells along each world axis. Defaults to 256. */
  cells?: number;
  /** Cells per independently culled/uploaded chunk. Defaults to 32. */
  chunkCells?: number;
  /** Opacity of the optional decal layer. Defaults to 1. */
  decalOpacity?: number;
  /** Display-list depth. */
  depth?: number;
  /** Disable conservative per-chunk screen culling for diagnostics. */
  cullChunks?: boolean;
  /** Optional world-sized ripple buffer (alpha = ripple brightness), masked to water. */
  ripple?: Terrain25DTexture | null;
}

type GLTextureWrapper = Phaser.Renderer.WebGL.Wrappers.WebGLTextureWrapper;

interface Chunk {
  x0: number;
  y0: number;
  cellsX: number;
  cellsY: number;
  vertexData: Float32Array;
  indices: Uint16Array;
  vertexBuffer: WebGLBuffer | null;
  indexBuffer: WebGLBuffer | null;
  minZ: number;
  maxZ: number;
}

interface Uniforms {
  pose: WebGLUniformLocation | null;
  basis: WebGLUniformLocation | null;
  focalNear: WebGLUniformLocation | null;
  camera0: WebGLUniformLocation | null;
  camera1: WebGLUniformLocation | null;
  viewport: WebGLUniformLocation | null;
  terrain: WebGLUniformLocation | null;
  decal: WebGLUniformLocation | null;
  decalParams: WebGLUniformLocation | null;
  projectionBlend: WebGLUniformLocation | null;
  shore: WebGLUniformLocation | null;
  shoreParams: WebGLUniformLocation | null;
  ripple: WebGLUniformLocation | null;
  waterMask: WebGLUniformLocation | null;
  rippleParams: WebGLUniformLocation | null;
  rippleRect: WebGLUniformLocation | null;
}

interface CameraMatrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

const VERTEX_STRIDE = 5;

const VERTEX_SHADER = `
precision highp float;
attribute vec3 aPosition;
attribute vec2 aUV;
uniform vec4 uPose;
uniform vec4 uBasis;
uniform vec2 uFocalNear;
uniform vec4 uCamera0;
uniform vec4 uCamera1;
uniform vec2 uViewport;
uniform float uProjectionBlend;
varying vec2 vUV;

void main(void) {
  float ry = aPosition.y - uPose.w;
  float rz = aPosition.z - uBasis.x;
  float depth = max(uFocalNear.y, ry * uBasis.y + rz * uBasis.z);
  float scale = uFocalNear.x / depth;
  float px = uPose.x + (aPosition.x - uPose.x) * scale;
  float py = uPose.y + (ry * uBasis.w + rz * uPose.z) * scale;
  px = mix(aPosition.x, px, uProjectionBlend);
  py = mix(aPosition.y, py, uProjectionBlend);
  float sx = uCamera0.x * px + uCamera0.z * py + uCamera0.w;
  float sy = uCamera0.y * px + uCamera1.x * py + uCamera1.y;
  float z01 = clamp((depth - uFocalNear.y) / max(1.0, uCamera1.z - uFocalNear.y), 0.0, 1.0);
  float clipW = mix(1.0, depth / uFocalNear.x, uProjectionBlend);
  gl_Position = vec4(
    (sx * 2.0 / uViewport.x - 1.0) * clipW,
    (1.0 - sy * 2.0 / uViewport.y) * clipW,
    (z01 * 2.0 - 1.0) * clipW,
    clipW
  );
  vUV = aUV;
}
`;

const FRAGMENT_SHADER_SRC = `
// Texel-space math (vUV × 1800) needs more than mediump's ~10-bit mantissa.
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D uTerrain;
uniform sampler2D uDecal;
uniform vec2 uDecalParams;
uniform sampler2D uShore;
uniform vec3 uShoreParams;
uniform sampler2D uRipple;
uniform sampler2D uWaterMask;
uniform vec2 uRippleParams;
uniform vec3 uRippleRect;
varying vec2 vUV;

const float SHORE_TEX = SHORE_TEX_PX;

float shoreCrest(vec2 uv) {
  vec4 sh = texture2D(uShore, uv);
  if (sh.r <= 0.004) return 0.0;
  float d = (1.0 - sh.r) * uShoreParams.z;
  float wave = sin(d * 1.25 - uShoreParams.y * 2.1 + sh.a * 6.2832);
  float fade = sh.r * sh.r;
  // Crests widen as they age (travel outward): thin at the edge, broad by the end of the reach.
  float lo = mix(0.72, 0.25, 1.0 - sh.r);
  return smoothstep(lo, 1.0, wave) * fade * 0.42 + smoothstep(0.86, 1.0, sh.r) * 0.14;
}

void main(void) {
  vec4 base = texture2D(uTerrain, vUV);
  // Shoreline pulse: soft bright bands moving outward from every water edge (shore texture: L = closeness,
  // A = phase noise). Evaluated at terrain texel centers and blended bilinearly, so it has the same
  // on-screen resolution as the painted map instead of being pixel-sharp.
  if (uShoreParams.x > 0.5 && texture2D(uShore, vUV).r > 0.0) {
    vec2 tp = vUV * SHORE_TEX - 0.5;
    vec2 f = fract(tp);
    vec2 c0 = (floor(tp) + 0.5) / SHORE_TEX;
    vec2 dt = vec2(1.0 / SHORE_TEX, 0.0);
    float crest = mix(
      mix(shoreCrest(c0), shoreCrest(c0 + dt.xy), f.x),
      mix(shoreCrest(c0 + dt.yx), shoreCrest(c0 + dt.xx), f.x),
      f.y
    );
    base.rgb += vec3(0.78, 0.92, 0.95) * crest;
  }
  // Ripple buffer (splashes, wakes), clipped to water by the mask.
  if (uRippleParams.x > 0.5) {
    vec2 rUV = (vUV - uRippleRect.xy) / uRippleRect.z;
    if (rUV.x >= 0.0 && rUV.y >= 0.0 && rUV.x <= 1.0 && rUV.y <= 1.0) {
      rUV.y = mix(rUV.y, 1.0 - rUV.y, uRippleParams.y);
      float rp = texture2D(uRipple, rUV).a;
      if (rp > 0.004) base.rgb += vec3(0.8, 0.93, 0.96) * min(rp, 1.0) * texture2D(uWaterMask, vUV).r * 0.85;
    }
  }
  vec2 decalUV = vec2(vUV.x, mix(vUV.y, 1.0 - vUV.y, uDecalParams.y));
  vec4 mark = texture2D(uDecal, decalUV);
  float a = clamp(mark.a * uDecalParams.x, 0.0, 1.0);
  gl_FragColor = vec4(
    mark.rgb * uDecalParams.x + base.rgb * (1.0 - a),
    a + base.a * (1.0 - a)
  );
}
`;

const FRAGMENT_SHADER = FRAGMENT_SHADER_SRC.replace("SHORE_TEX_PX", TEX.toFixed(1));

/** Shore wave reach (texels into the water from sea / lake edges). */
const SHORE_REACH = 26;

/**
 * Shore field (TEX × TEX, LUMINANCE_ALPHA): L = closeness to the nearest water edge — sea, lake or river (255 at
 * the edge → 0 by SHORE_REACH; 0 on land), A = slow phase noise so crests don't line up along the coast.
 */
function buildShoreField(world: WorldData): Uint8Array {
  const n = TEX * TEX;
  const out = new Uint8Array(n * 2);
  const dist = new Float32Array(n).fill(Infinity);
  const wet = (i: number) => world.water[i]! >= 0;
  const q: number[] = [];
  for (let y = 1; y < TEX - 1; y++) {
    for (let x = 1; x < TEX - 1; x++) {
      const i = y * TEX + x;
      if (!wet(i)) continue;
      if (!wet(i - 1) || !wet(i + 1) || !wet(i - TEX) || !wet(i + TEX)) {
        dist[i] = 0;
        q.push(i);
      }
    }
  }
  const nb: [number, number][] = [[1, 1], [-1, 1], [TEX, 1], [-TEX, 1], [TEX + 1, Math.SQRT2], [TEX - 1, Math.SQRT2], [-TEX + 1, Math.SQRT2], [-TEX - 1, Math.SQRT2]];
  for (let h = 0; h < q.length; h++) {
    const i = q[h]!;
    for (const [o, w] of nb) {
      const j = i + o;
      if (j < 0 || j >= n || !wet(j)) continue;
      const d = dist[i]! + w;
      if (d >= dist[j]! || d > SHORE_REACH) continue;
      dist[j] = d;
      q.push(j);
    }
  }
  for (let i = 0; i < n; i++) {
    const d = dist[i]!;
    if (d === Infinity) continue;
    out[i * 2] = Math.max(1, Math.round(255 * (1 - d / SHORE_REACH)));
    const x = i % TEX;
    const y = (i / TEX) | 0;
    out[i * 2 + 1] = Math.round(255 * fbm(x * 0.012, y * 0.012, 913, 2));
  }
  return out;
}

/** Water mask resolution (half the height map: smooth, and cheap). */
const WATER_MASK_TEX = TEX / 2;

/** 255 where any water (sea, lake, river) is in the 2×2 texel block, else 0 — clips ripples at shorelines. */
function buildWaterMask(world: WorldData): Uint8Array {
  const n = WATER_MASK_TEX;
  const out = new Uint8Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * 2 * TEX + x * 2;
      if (world.water[i]! >= 0 || world.water[i + 1]! >= 0 || world.water[i + TEX]! >= 0 || world.water[i + TEX + 1]! >= 0) out[y * n + x] = 255;
    }
  }
  return out;
}

function clampInt(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(value)));
}

function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Terrain25D: unable to allocate shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? "unknown shader error";
    gl.deleteShader(shader);
    throw new Error(`Terrain25D shader compile failed: ${message}`);
  }
  return shader;
}

function createProgram(gl: WebGLRenderingContext): WebGLProgram {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    throw new Error("Terrain25D: unable to allocate shader program");
  }
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.bindAttribLocation(program, 0, "aPosition");
  gl.bindAttribLocation(program, 1, "aUV");
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) ?? "unknown link error";
    gl.deleteProgram(program);
    throw new Error(`Terrain25D program link failed: ${message}`);
  }
  return program;
}

/**
 * WebGL-only projected heightfield GameObject. Simulation and all other objects
 * remain in normal Phaser world coordinates; the vertex shader exactly mirrors
 * worldToScreen before applying the active Phaser camera.
 */
export class Terrain25D extends Phaser.GameObjects.GameObject {
  readonly world: WorldData;
  readonly cells: number;
  readonly chunkCells: number;
  terrainTexture: Terrain25DTexture;
  decalTexture: Terrain25DTexture | null;
  decalOpacity: number;
  projectionBlend = 1;
  cullChunks: boolean;
  visible = true;
  blendMode = Phaser.BlendModes.NORMAL;
  _depth = 0;

  private readonly webglRenderer: Phaser.Renderer.WebGL.WebGLRenderer;
  private readonly chunks: Chunk[] = [];
  private program: WebGLProgram | null = null;
  private uniforms: Uniforms | null = null;
  private whiteTexture: WebGLTexture | null = null;
  private shoreTexture: WebGLTexture | null = null;
  private shoreData: Uint8Array | null = null;
  private waterMaskTexture: WebGLTexture | null = null;
  private waterMaskData: Uint8Array | null = null;
  rippleTexture: Terrain25DTexture | null;
  /** Ripple window in map UV: origin x, y and size. */
  private rippleRect: [number, number, number] = [0, 0, 1];
  shoreWaves = true;

  constructor(scene: Phaser.Scene, world: WorldData, options: Terrain25DOptions) {
    super(scene, "Terrain25D");
    const renderer = scene.game.renderer;
    if (!(renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer)) {
      throw new Error("Terrain25D requires Phaser.WEBGL; use the caller's flat Canvas fallback");
    }
    this.webglRenderer = renderer;
    this.world = world;
    this.cells = clampInt(options.cells ?? 256, 2, 2048);
    this.chunkCells = clampInt(options.chunkCells ?? 32, 1, 128);
    this.terrainTexture = options.terrain;
    this.decalTexture = options.decal ?? null;
    this.decalOpacity = Phaser.Math.Clamp(options.decalOpacity ?? 1, 0, 1);
    this.cullChunks = options.cullChunks ?? true;
    this._depth = options.depth ?? 0;
    this.buildChunks();
    this.shoreData = buildShoreField(world);
    this.waterMaskData = buildWaterMask(world);
    this.rippleTexture = options.ripple ?? null;
    renderer.pipelines.clear();
    try {
      this.createResources();
    } finally {
      renderer.pipelines.rebind();
    }
    renderer.on(Phaser.Renderer.Events.RESTORE_WEBGL, this.handleContextRestore, this);
  }

  get depth(): number {
    return this._depth;
  }

  set depth(value: number) {
    this._depth = value;
    this.displayList?.queueDepthSort();
  }

  setDepth(value = 0): this {
    this.depth = value;
    return this;
  }

  setVisible(value = true): this {
    this.visible = value;
    return this;
  }

  setTerrainTexture(texture: Terrain25DTexture): this {
    this.terrainTexture = texture;
    return this;
  }

  setDecalTexture(texture: Terrain25DTexture | null, opacity = this.decalOpacity): this {
    this.decalTexture = texture;
    this.decalOpacity = Phaser.Math.Clamp(opacity, 0, 1);
    return this;
  }

  /** Ripple buffer covering the map-UV window (u0, v0) .. (u0 + size, v0 + size). */
  setRippleTexture(texture: Terrain25DTexture | null, u0 = 0, v0 = 0, size = 1): this {
    this.rippleTexture = texture;
    this.rippleRect = [u0, v0, size];
    return this;
  }

  setShoreWaves(on: boolean): this {
    this.shoreWaves = on;
    return this;
  }

  setProjectionBlend(value: number): this {
    this.projectionBlend = Phaser.Math.Clamp(value, 0, 1);
    return this;
  }

  /**
   * Re-samples height vertices touched by a dirty height-map texel rectangle and
   * uploads only affected chunks. Call after modifying WorldData.height.
   */
  updateHeightRegion(x0: number, y0: number, x1: number, y1: number): this {
    const loX = Math.max(0, Math.min(x0, x1) - 1);
    const loY = Math.max(0, Math.min(y0, y1) - 1);
    const hiX = Math.min(TEX - 1, Math.max(x0, x1) + 1);
    const hiY = Math.min(TEX - 1, Math.max(y0, y1) + 1);
    const gl = this.webglRenderer.gl;
    this.webglRenderer.pipelines.clear();
    try {
      for (const chunk of this.chunks) {
        // Skirt chunks share rim texels — clamp AABB into TEX for dirty tests.
        const tx0 = Phaser.Math.Clamp((chunk.x0 / this.cells) * TEX, 0, TEX);
        const ty0 = Phaser.Math.Clamp((chunk.y0 / this.cells) * TEX, 0, TEX);
        const tx1 = Phaser.Math.Clamp(((chunk.x0 + chunk.cellsX) / this.cells) * TEX, 0, TEX);
        const ty1 = Phaser.Math.Clamp(((chunk.y0 + chunk.cellsY) / this.cells) * TEX, 0, TEX);
        if (tx1 < loX || ty1 < loY || tx0 > hiX || ty0 > hiY) continue;
        this.fillChunkVertices(chunk);
        if (chunk.vertexBuffer && !this.webglRenderer.contextLost) {
          gl.bindBuffer(gl.ARRAY_BUFFER, chunk.vertexBuffer);
          gl.bufferData(gl.ARRAY_BUFFER, chunk.vertexData, gl.DYNAMIC_DRAW);
        }
      }
    } finally {
      this.webglRenderer.pipelines.rebind();
    }
    return this;
  }

  /**
   * Uploads the CanvasTexture after world.canvas was repainted. Phaser 3.90's
   * CanvasTexture API uploads the whole canvas; geometry remains region-updated.
   */
  refreshTerrainTexture(): this {
    const texture = this.resolveTextureObject(this.terrainTexture);
    if (texture instanceof Phaser.Textures.CanvasTexture) texture.refresh();
    return this;
  }

  renderWebGL(
    renderer: Phaser.Renderer.WebGL.WebGLRenderer,
    _src: Terrain25D,
    camera: Phaser.Cameras.Scene2D.Camera,
    _parentMatrix: Phaser.GameObjects.Components.TransformMatrix
  ): void {
    if (!this.visible || !this.program || renderer.contextLost) return;
    const terrain = this.resolveGLTexture(this.terrainTexture);
    if (!terrain?.webGLTexture) return;
    const decal = this.decalTexture ? this.resolveGLTexture(this.decalTexture) : null;
    const decalGL = decal?.webGLTexture ?? this.whiteTexture;
    if (!decalGL) return;

    camera.addToRenderList(this);
    renderer.pipelines.clear();
    const gl = renderer.gl;
    try {
      gl.useProgram(this.program);
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(true);
      gl.depthFunc(gl.LEQUAL);
      gl.disable(gl.CULL_FACE);
      gl.enable(gl.BLEND);
      gl.blendEquation(gl.FUNC_ADD);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.clear(gl.DEPTH_BUFFER_BIT);

      this.setUniforms(
        gl,
        camera,
        this.decalTexture instanceof Phaser.GameObjects.RenderTexture
      );
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, terrain.webGLTexture);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, decalGL);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.shoreTexture ?? this.whiteTexture);
      const ripple = this.rippleTexture ? this.resolveGLTexture(this.rippleTexture)?.webGLTexture ?? null : null;
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, ripple ?? this.whiteTexture);
      gl.activeTexture(gl.TEXTURE4);
      gl.bindTexture(gl.TEXTURE_2D, this.waterMaskTexture ?? this.whiteTexture);
      this.setRippleUniforms(gl, !!ripple && !!this.waterMaskTexture);

      gl.enableVertexAttribArray(0);
      gl.enableVertexAttribArray(1);
      for (const chunk of this.chunks) {
        if (this.cullChunks && !this.chunkVisible(chunk, camera)) continue;
        if (!chunk.vertexBuffer || !chunk.indexBuffer) continue;
        gl.bindBuffer(gl.ARRAY_BUFFER, chunk.vertexBuffer);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, VERTEX_STRIDE * 4, 0);
        gl.vertexAttribPointer(1, 2, gl.FLOAT, false, VERTEX_STRIDE * 4, 3 * 4);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, chunk.indexBuffer);
        gl.drawElements(gl.TRIANGLES, chunk.indices.length, gl.UNSIGNED_SHORT, 0);
      }
      gl.disableVertexAttribArray(0);
      gl.disableVertexAttribArray(1);
    } finally {
      renderer.pipelines.rebind();
    }
  }

  override destroy(fromScene?: boolean): void {
    this.webglRenderer.off(Phaser.Renderer.Events.RESTORE_WEBGL, this.handleContextRestore, this);
    this.deleteResources();
    this.chunks.length = 0;
    super.destroy(fromScene);
  }

  private buildChunks(): void {
    for (let y0 = 0; y0 < this.cells; y0 += this.chunkCells) {
      for (let x0 = 0; x0 < this.cells; x0 += this.chunkCells) {
        const cellsX = Math.min(this.chunkCells, this.cells - x0);
        const cellsY = Math.min(this.chunkCells, this.cells - y0);
        const vertices = (cellsX + 1) * (cellsY + 1);
        const chunk: Chunk = {
          x0,
          y0,
          cellsX,
          cellsY,
          vertexData: new Float32Array(vertices * VERTEX_STRIDE),
          indices: this.buildIndices(cellsX, cellsY),
          vertexBuffer: null,
          indexBuffer: null,
          minZ: 0,
          maxZ: 0,
        };
        this.fillChunkVertices(chunk);
        this.chunks.push(chunk);
      }
    }
  }

  private buildIndices(cellsX: number, cellsY: number): Uint16Array {
    const out = new Uint16Array(cellsX * cellsY * 6);
    const stride = cellsX + 1;
    let o = 0;
    for (let y = 0; y < cellsY; y++) {
      for (let x = 0; x < cellsX; x++) {
        const a = y * stride + x;
        const b = a + 1;
        const c = a + stride;
        const d = c + 1;
        out[o++] = a;
        out[o++] = c;
        out[o++] = b;
        out[o++] = b;
        out[o++] = c;
        out[o++] = d;
      }
    }
    return out;
  }

  private fillChunkVertices(chunk: Chunk): void {
    let o = 0;
    let minZ = Number.POSITIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;
    for (let y = 0; y <= chunk.cellsY; y++) {
      const gy = chunk.y0 + y;
      const v = gy / this.cells;
      for (let x = 0; x <= chunk.cellsX; x++) {
        const gx = chunk.x0 + x;
        const u = gx / this.cells;
        const z = this.sampleGroundZ(
          Math.min(TEX - 1.001, u * TEX),
          Math.min(TEX - 1.001, v * TEX)
        );
        chunk.vertexData[o++] = u * WORLD;
        chunk.vertexData[o++] = v * WORLD;
        chunk.vertexData[o++] = z;
        chunk.vertexData[o++] = u;
        chunk.vertexData[o++] = v;
        minZ = Math.min(minZ, z);
        maxZ = Math.max(maxZ, z);
      }
    }
    chunk.minZ = minZ;
    chunk.maxZ = maxZ;
  }

  private sampleGroundZ(tx: number, ty: number): number {
    const x0 = Math.floor(tx);
    const y0 = Math.floor(ty);
    const x1 = Math.min(TEX - 1, x0 + 1);
    const y1 = Math.min(TEX - 1, y0 + 1);
    const fx = tx - x0;
    const fy = ty - y0;
    const h = this.world.height;
    const a = h[y0 * TEX + x0]!;
    const b = h[y0 * TEX + x1]!;
    const c = h[y1 * TEX + x0]!;
    const d = h[y1 * TEX + x1]!;
    const top = a + (b - a) * fx;
    const bottom = c + (d - c) * fx;
    return Math.max(0, (top + (bottom - top) * fy - GROUND_H_ZERO) * GROUND_Z_SCALE);
  }

  private createResources(): void {
    const gl = this.webglRenderer.gl;
    this.program = createProgram(gl);
    this.uniforms = {
      pose: gl.getUniformLocation(this.program, "uPose"),
      basis: gl.getUniformLocation(this.program, "uBasis"),
      focalNear: gl.getUniformLocation(this.program, "uFocalNear"),
      camera0: gl.getUniformLocation(this.program, "uCamera0"),
      camera1: gl.getUniformLocation(this.program, "uCamera1"),
      viewport: gl.getUniformLocation(this.program, "uViewport"),
      terrain: gl.getUniformLocation(this.program, "uTerrain"),
      decal: gl.getUniformLocation(this.program, "uDecal"),
      decalParams: gl.getUniformLocation(this.program, "uDecalParams"),
      projectionBlend: gl.getUniformLocation(this.program, "uProjectionBlend"),
      shore: gl.getUniformLocation(this.program, "uShore"),
      shoreParams: gl.getUniformLocation(this.program, "uShoreParams"),
      ripple: gl.getUniformLocation(this.program, "uRipple"),
      waterMask: gl.getUniformLocation(this.program, "uWaterMask"),
      rippleParams: gl.getUniformLocation(this.program, "uRippleParams"),
      rippleRect: gl.getUniformLocation(this.program, "uRippleRect"),
    };
    if (this.waterMaskData) {
      this.waterMaskTexture = gl.createTexture();
      gl.activeTexture(gl.TEXTURE4);
      gl.bindTexture(gl.TEXTURE_2D, this.waterMaskTexture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, WATER_MASK_TEX, WATER_MASK_TEX, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, this.waterMaskData);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      gl.activeTexture(gl.TEXTURE0);
    }
    if (this.shoreData) {
      this.shoreTexture = gl.createTexture();
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.shoreTexture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE_ALPHA, TEX, TEX, 0, gl.LUMINANCE_ALPHA, gl.UNSIGNED_BYTE, this.shoreData);
      gl.activeTexture(gl.TEXTURE0);
    }
    this.whiteTexture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.whiteTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([0, 0, 0, 0])
    );
    for (const chunk of this.chunks) {
      chunk.vertexBuffer = gl.createBuffer();
      chunk.indexBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, chunk.vertexBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, chunk.vertexData, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, chunk.indexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, chunk.indices, gl.STATIC_DRAW);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  private deleteResources(): void {
    const gl = this.webglRenderer.gl;
    if (this.program) gl.deleteProgram(this.program);
    if (this.whiteTexture) gl.deleteTexture(this.whiteTexture);
    if (this.shoreTexture) gl.deleteTexture(this.shoreTexture);
    this.shoreTexture = null;
    if (this.waterMaskTexture) gl.deleteTexture(this.waterMaskTexture);
    this.waterMaskTexture = null;
    this.program = null;
    this.uniforms = null;
    this.whiteTexture = null;
    for (const chunk of this.chunks) {
      if (chunk.vertexBuffer) gl.deleteBuffer(chunk.vertexBuffer);
      if (chunk.indexBuffer) gl.deleteBuffer(chunk.indexBuffer);
      chunk.vertexBuffer = null;
      chunk.indexBuffer = null;
    }
  }

  private handleContextRestore(): void {
    this.webglRenderer.pipelines.clear();
    try {
      this.deleteResources();
      this.createResources();
    } finally {
      this.webglRenderer.pipelines.rebind();
    }
  }

  private resolveTextureObject(source: Terrain25DTexture): Phaser.Textures.Texture {
    if (typeof source === "string") return this.scene.textures.get(source);
    if (source instanceof Phaser.GameObjects.RenderTexture) return source.texture;
    return source;
  }

  private resolveGLTexture(source: Terrain25DTexture): GLTextureWrapper | null {
    return this.resolveTextureObject(source).source[0]?.glTexture ?? null;
  }

  private setUniforms(
    gl: WebGLRenderingContext,
    camera: Phaser.Cameras.Scene2D.Camera,
    decalFlipY: boolean
  ): void {
    const uniforms = this.uniforms!;
    const matrix = this.cameraMatrix(camera);
    const tx = matrix.e - matrix.a * camera.scrollX - matrix.c * camera.scrollY;
    const ty = matrix.f - matrix.b * camera.scrollX - matrix.d * camera.scrollY;
    gl.uniform4f(
      uniforms.pose,
      Camera25D.focusX,
      Camera25D.focusY,
      Camera25D.downZ,
      Camera25D.eyeY
    );
    gl.uniform4f(
      uniforms.basis,
      Camera25D.eyeZ,
      Camera25D.forwardY,
      Camera25D.forwardZ,
      Camera25D.downY
    );
    gl.uniform2f(uniforms.focalNear, Camera25D.focal, Z_SCALE_NEAR);
    gl.uniform4f(uniforms.camera0, matrix.a, matrix.b, matrix.c, tx);
    gl.uniform4f(uniforms.camera1, matrix.d, ty, WORLD * 4, 0);
    gl.uniform2f(uniforms.viewport, this.webglRenderer.width, this.webglRenderer.height);
    gl.uniform1i(uniforms.terrain, 0);
    gl.uniform1i(uniforms.decal, 1);
    gl.uniform1i(uniforms.shore, 2);
    gl.uniform3f(
      uniforms.shoreParams,
      this.shoreWaves && this.shoreTexture ? 1 : 0,
      this.scene.time.now * 0.001,
      SHORE_REACH
    );
    gl.uniform1f(uniforms.projectionBlend, this.projectionBlend);
    gl.uniform2f(
      uniforms.decalParams,
      this.decalTexture ? this.decalOpacity : 0,
      decalFlipY ? 1 : 0
    );
  }

  private setRippleUniforms(gl: WebGLRenderingContext, on: boolean): void {
    const u = this.uniforms!;
    gl.uniform1i(u.ripple, 3);
    gl.uniform1i(u.waterMask, 4);
    gl.uniform2f(u.rippleParams, on ? 1 : 0, this.rippleTexture instanceof Phaser.GameObjects.RenderTexture ? 1 : 0);
    gl.uniform3f(u.rippleRect, ...this.rippleRect);
  }

  private chunkVisible(chunk: Chunk, camera: Phaser.Cameras.Scene2D.Camera): boolean {
    const wx0 = (chunk.x0 / this.cells) * WORLD;
    const wy0 = (chunk.y0 / this.cells) * WORLD;
    const wx1 = ((chunk.x0 + chunk.cellsX) / this.cells) * WORLD;
    const wy1 = ((chunk.y0 + chunk.cellsY) / this.cells) * WORLD;
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    const matrix = this.cameraMatrix(camera);
    for (let iz = 0; iz < 2; iz++) {
      const z = iz === 0 ? chunk.minZ : chunk.maxZ;
      for (let iy = 0; iy < 2; iy++) {
        const y = iy === 0 ? wy0 : wy1;
        const ry = y - Camera25D.eyeY;
        const rz = z - Camera25D.eyeZ;
        const depth = Math.max(
          Z_SCALE_NEAR,
          ry * Camera25D.forwardY + rz * Camera25D.forwardZ
        );
        const scale = Camera25D.focal / depth;
        const projectedY =
          Camera25D.focusY +
          (ry * Camera25D.downY + rz * Camera25D.downZ) * scale;
        const py = Phaser.Math.Linear(y, projectedY, this.projectionBlend);
        for (let ix = 0; ix < 2; ix++) {
          const x = ix === 0 ? wx0 : wx1;
          const projectedX = Camera25D.focusX + (x - Camera25D.focusX) * scale;
          const px = Phaser.Math.Linear(x, projectedX, this.projectionBlend);
          const cx = px - camera.scrollX;
          const cy = py - camera.scrollY;
          const sx = matrix.a * cx + matrix.c * cy + matrix.e;
          const sy = matrix.b * cx + matrix.d * cy + matrix.f;
          minX = Math.min(minX, sx);
          minY = Math.min(minY, sy);
          maxX = Math.max(maxX, sx);
          maxY = Math.max(maxY, sy);
        }
      }
    }
    return !(
      maxX < camera.x ||
      maxY < camera.y ||
      minX > camera.x + camera.width ||
      minY > camera.y + camera.height
    );
  }

  private cameraMatrix(camera: Phaser.Cameras.Scene2D.Camera): CameraMatrix {
    // Runtime Camera exposes this TransformMatrix; Phaser's 3.90 declaration
    // currently omits it from the public Camera type.
    return (camera as unknown as { matrix: CameraMatrix }).matrix;
  }
}

/** Constructs and adds the renderer to the Scene display list. */
export function createTerrain25D(
  scene: Phaser.Scene,
  world: WorldData,
  options: Terrain25DOptions
): Terrain25D {
  const terrain = new Terrain25D(scene, world, options);
  scene.add.existing(terrain);
  return terrain;
}
