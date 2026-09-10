import Phaser from "phaser";
import {
  Camera25D,
  GROUND_H_ZERO,
  GROUND_Z_SCALE,
  TEX,
  WORLD,
  Z_SCALE_NEAR,
  type WorldData,
} from "./world";

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

const FRAGMENT_SHADER = `
precision mediump float;
uniform sampler2D uTerrain;
uniform sampler2D uDecal;
uniform vec2 uDecalParams;
varying vec2 vUV;

void main(void) {
  vec4 base = texture2D(uTerrain, vUV);
  vec2 decalUV = vec2(vUV.x, mix(vUV.y, 1.0 - vUV.y, uDecalParams.y));
  vec4 mark = texture2D(uDecal, decalUV);
  float a = clamp(mark.a * uDecalParams.x, 0.0, 1.0);
  gl_FragColor = vec4(
    mark.rgb * uDecalParams.x + base.rgb * (1.0 - a),
    a + base.a * (1.0 - a)
  );
}
`;

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
        const tx0 = (chunk.x0 / this.cells) * TEX;
        const ty0 = (chunk.y0 / this.cells) * TEX;
        const tx1 = ((chunk.x0 + chunk.cellsX) / this.cells) * TEX;
        const ty1 = ((chunk.y0 + chunk.cellsY) / this.cells) * TEX;
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
    };
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
    gl.uniform1f(uniforms.projectionBlend, this.projectionBlend);
    gl.uniform2f(
      uniforms.decalParams,
      this.decalTexture ? this.decalOpacity : 0,
      decalFlipY ? 1 : 0
    );
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
