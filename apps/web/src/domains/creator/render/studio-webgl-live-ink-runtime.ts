import {
  planStudioWebGlLiveInkGeometry,
  resolveStudioWebGlLiveInkSurface,
  STUDIO_WEBGL_LIVE_INK_DEFAULT_MAX_BUFFER_BYTES,
  STUDIO_WEBGL_LIVE_INK_DEFAULT_MAX_DIMENSION,
  STUDIO_WEBGL_LIVE_INK_HARD_MAX_BUFFER_BYTES,
  STUDIO_WEBGL_LIVE_INK_VERTEX_BYTES,
  STUDIO_WEBGL_LIVE_INK_VERTEX_FLOATS,
  type ResolvedStudioWebGlLiveInkSurface,
  type StudioWebGlLiveInkGeometryFailureReason,
  type StudioWebGlLiveInkSurfaceFailureReason,
  type StudioWebGlLiveInkSurfaceInput,
} from "./studio-webgl-live-ink";

import type { StudioGpuStroke } from "./studio-webgpu-stroke";

const VERTEX_SHADER_SOURCE = `#version 300 es
layout(location = 0) in vec2 a_position;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER_SOURCE = `#version 300 es
precision mediump float;

uniform vec4 u_color;
out vec4 out_color;

void main() {
  // premultipliedAlpha:true 캔버스 계약에 맞춰 셰이더가 직접 premultiply 출력한다.
  // straight 출력+SRC_ALPHA 블렌드 조합은 프레임버퍼 알파가 a²이 되어 반투명 라이브 잉크가
  // 커밋 픽셀보다 밝고 투명하게 보이던 버그(브러시 품질 감사 #7b)의 원인이었다.
  out_color = vec4(u_color.rgb * u_color.a, u_color.a);
}
`;

export type StudioWebGlLiveInkState = "ready" | "lost" | "failed" | "disposed";

export type StudioWebGlLiveInkFailureReason =
  | StudioWebGlLiveInkSurfaceFailureReason
  | StudioWebGlLiveInkGeometryFailureReason
  | "context-lost"
  | "disposed"
  | "renderer-failed"
  | "surface-unconfigured"
  | "gpu-command-failed";

export type StudioWebGlLiveInkCreateFailureReason =
  | "invalid-options"
  | "context-unavailable"
  | "shader-compile-failed"
  | "program-link-failed"
  | "resource-allocation-failed";

export interface StudioWebGlLiveInkRendererOptions {
  readonly maximumBufferBytes?: number;
  readonly contextAttributes?: WebGLContextAttributes;
  readonly onStateChange?: (
    state: StudioWebGlLiveInkState,
    reason?: StudioWebGlLiveInkFailureReason
  ) => void;
}

export type StudioWebGlLiveInkCreateResult =
  | {
      readonly ok: true;
      readonly renderer: StudioWebGlLiveInkRenderer;
    }
  | {
      readonly ok: false;
      readonly reason: StudioWebGlLiveInkCreateFailureReason;
    };

export type StudioWebGlLiveInkOperationResult =
  | {
      readonly ok: true;
      readonly vertexCount: number;
    }
  | {
      readonly ok: false;
      readonly reason: StudioWebGlLiveInkFailureReason;
    };

interface StudioWebGlResources {
  readonly program: WebGLProgram;
  readonly vertexShader: WebGLShader;
  readonly fragmentShader: WebGLShader;
  readonly vertexArray: WebGLVertexArrayObject;
  readonly vertexBuffer: WebGLBuffer;
  readonly colorLocation: WebGLUniformLocation;
}

const DEFAULT_CONTEXT_ATTRIBUTES: WebGLContextAttributes = {
  alpha: true,
  antialias: true,
  depth: false,
  desynchronized: true,
  failIfMajorPerformanceCaveat: false,
  powerPreference: "high-performance",
  premultipliedAlpha: true,
  preserveDrawingBuffer: false,
  stencil: false,
};

function resolveBufferBytes(value: unknown): number | null {
  if (value === undefined) return STUDIO_WEBGL_LIVE_INK_DEFAULT_MAX_BUFFER_BYTES;
  if (typeof value !== "number" || !Number.isFinite(value) || value < STUDIO_WEBGL_LIVE_INK_VERTEX_BYTES * 4) {
    return null;
  }
  const bounded = Math.min(Math.floor(value), STUDIO_WEBGL_LIVE_INK_HARD_MAX_BUFFER_BYTES);
  return Math.floor(bounded / STUDIO_WEBGL_LIVE_INK_VERTEX_BYTES)
    * STUDIO_WEBGL_LIVE_INK_VERTEX_BYTES;
}

function queryMaximumViewportDimension(gl: WebGL2RenderingContext): number {
  try {
    const dimensions = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as unknown;
    if (Array.isArray(dimensions) || ArrayBuffer.isView(dimensions)) {
      const values = dimensions as unknown as ArrayLike<unknown>;
      if (Number.isFinite(Number(values[0])) && Number.isFinite(Number(values[1]))) {
        return Math.max(1, Math.floor(Math.min(Number(values[0]), Number(values[1]))));
      }
    }
  } catch {
    // Some embedded WebViews have thrown during capability queries. The conservative default is
    // still validated by the actual canvas resize and command boundary below.
  }
  return STUDIO_WEBGL_LIVE_INK_DEFAULT_MAX_DIMENSION;
}

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) === true) return shader;
  gl.deleteShader(shader);
  return null;
}

/**
 * Dedicated WebGL2 boundary for a transparent, non-authoritative live-stroke canvas. It never
 * reads pixels and never claims document/export ownership; every failure is surfaced so the
 * caller can atomically reveal the existing Canvas2D path.
 */
export class StudioWebGlLiveInkRenderer {
  private stateValue: StudioWebGlLiveInkState = "failed";
  private resources: StudioWebGlResources | null = null;
  private surface: ResolvedStudioWebGlLiveInkSurface | null = null;
  private surfaceInput: StudioWebGlLiveInkSurfaceInput | null = null;

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly gl: WebGL2RenderingContext,
    private readonly maximumBufferBytes: number,
    private readonly onStateChange?: StudioWebGlLiveInkRendererOptions["onStateChange"]
  ) {
    canvas.addEventListener("webglcontextlost", this.handleContextLost, false);
    canvas.addEventListener("webglcontextrestored", this.handleContextRestored, false);
  }

  static create(
    canvas: HTMLCanvasElement,
    options: StudioWebGlLiveInkRendererOptions = {}
  ): StudioWebGlLiveInkCreateResult {
    const maximumBufferBytes = resolveBufferBytes(options.maximumBufferBytes);
    if (maximumBufferBytes === null) return { ok: false, reason: "invalid-options" };

    const gl = (() => {
      try {
        return canvas.getContext("webgl2", {
          ...DEFAULT_CONTEXT_ATTRIBUTES,
          ...options.contextAttributes,
          // Retaining the default framebuffer turns a transient overlay into a bandwidth-heavy
          // accidental document surface. Keep this invariant even if an embedding option disagrees.
          preserveDrawingBuffer: false,
        });
      } catch {
        return null;
      }
    })();
    if (!gl) return { ok: false, reason: "context-unavailable" };

    const renderer = new StudioWebGlLiveInkRenderer(
      canvas,
      gl,
      maximumBufferBytes,
      options.onStateChange
    );
    const initialized = renderer.initializeResources();
    if (!initialized.ok) {
      renderer.dispose(false);
      return initialized;
    }
    renderer.stateValue = "ready";
    renderer.notifyState("ready");
    return { ok: true, renderer };
  }

  get state(): StudioWebGlLiveInkState {
    return this.stateValue;
  }

  get maximumVertices(): number {
    return Math.floor(this.maximumBufferBytes / STUDIO_WEBGL_LIVE_INK_VERTEX_BYTES);
  }

  get resolvedSurface(): ResolvedStudioWebGlLiveInkSurface | null {
    return this.surface;
  }

  setSurface(input: StudioWebGlLiveInkSurfaceInput): StudioWebGlLiveInkOperationResult {
    const unavailable = this.unavailableResult();
    if (unavailable) return unavailable;

    const plan = resolveStudioWebGlLiveInkSurface(
      input,
      queryMaximumViewportDimension(this.gl)
    );
    if (!plan.ok) {
      this.failClosedClear();
      this.surface = null;
      this.surfaceInput = null;
      return plan;
    }

    this.surfaceInput = { ...input };
    this.surface = plan.surface;
    try {
      if (this.canvas.width !== plan.surface.backingWidth) {
        this.canvas.width = plan.surface.backingWidth;
      }
      if (this.canvas.height !== plan.surface.backingHeight) {
        this.canvas.height = plan.surface.backingHeight;
      }
      this.gl.viewport(0, 0, plan.surface.backingWidth, plan.surface.backingHeight);
      this.clearInternal();
      return { ok: true, vertexCount: 0 };
    } catch {
      return this.failRenderer("gpu-command-failed");
    }
  }

  render(stroke: StudioGpuStroke): StudioWebGlLiveInkOperationResult {
    const unavailable = this.unavailableResult();
    if (unavailable) return unavailable;
    const surface = this.surface;
    const resources = this.resources;
    if (!surface) return { ok: false, reason: "surface-unconfigured" };
    if (!resources) return this.failRenderer("renderer-failed");

    const plan = planStudioWebGlLiveInkGeometry(stroke, surface, this.maximumVertices);
    if (!plan.ok) {
      this.failClosedClear();
      return plan;
    }

    try {
      const { geometry } = plan;
      const gl = this.gl;
      gl.viewport(0, 0, surface.backingWidth, surface.backingHeight);
      this.clearInternal();
      if (geometry.vertexCount === 0) return { ok: true, vertexCount: 0 };

      gl.useProgram(resources.program);
      gl.bindVertexArray(resources.vertexArray);
      gl.bindBuffer(gl.ARRAY_BUFFER, resources.vertexBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, geometry.vertices);
      gl.enable(gl.BLEND);
      // premultiplied 출력이므로 ONE/ONE_MINUS_SRC_ALPHA — 셰이더 premultiply와 한 쌍의 계약.
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniform4f(
        resources.colorLocation,
        geometry.color[0],
        geometry.color[1],
        geometry.color[2],
        geometry.color[3]
      );
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, geometry.vertexCount);
      gl.bindVertexArray(null);
      return { ok: true, vertexCount: geometry.vertexCount };
    } catch {
      return this.failRenderer("gpu-command-failed");
    }
  }

  clear(): StudioWebGlLiveInkOperationResult {
    const unavailable = this.unavailableResult();
    if (unavailable) return unavailable;
    try {
      this.clearInternal();
      return { ok: true, vertexCount: 0 };
    } catch {
      return this.failRenderer("gpu-command-failed");
    }
  }

  dispose(notify = true): void {
    if (this.stateValue === "disposed") return;
    if (this.stateValue === "ready") this.failClosedClear();
    this.releaseResources(this.stateValue !== "lost");
    this.canvas.removeEventListener("webglcontextlost", this.handleContextLost, false);
    this.canvas.removeEventListener("webglcontextrestored", this.handleContextRestored, false);
    this.surface = null;
    this.surfaceInput = null;
    this.stateValue = "disposed";
    if (notify) this.notifyState("disposed", "disposed");
  }

  private initializeResources():
    | { readonly ok: true }
    | { readonly ok: false; readonly reason: StudioWebGlLiveInkCreateFailureReason } {
    const gl = this.gl;
    let vertexShader: WebGLShader | null = null;
    let fragmentShader: WebGLShader | null = null;
    let program: WebGLProgram | null = null;
    let vertexArray: WebGLVertexArrayObject | null = null;
    let vertexBuffer: WebGLBuffer | null = null;
    try {
      vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE);
      fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SOURCE);
      if (!vertexShader || !fragmentShader) {
        if (vertexShader) gl.deleteShader(vertexShader);
        if (fragmentShader) gl.deleteShader(fragmentShader);
        return { ok: false, reason: "shader-compile-failed" };
      }

      program = gl.createProgram();
      if (!program) {
        gl.deleteShader(vertexShader);
        gl.deleteShader(fragmentShader);
        return { ok: false, reason: "resource-allocation-failed" };
      }
      gl.attachShader(program, vertexShader);
      gl.attachShader(program, fragmentShader);
      gl.linkProgram(program);
      if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) {
        gl.deleteProgram(program);
        gl.deleteShader(vertexShader);
        gl.deleteShader(fragmentShader);
        return { ok: false, reason: "program-link-failed" };
      }

      const positionLocation = gl.getAttribLocation(program, "a_position");
      const colorLocation = gl.getUniformLocation(program, "u_color");
      vertexArray = gl.createVertexArray();
      vertexBuffer = gl.createBuffer();
      if (positionLocation < 0 || !colorLocation || !vertexArray || !vertexBuffer) {
        if (vertexArray) gl.deleteVertexArray(vertexArray);
        if (vertexBuffer) gl.deleteBuffer(vertexBuffer);
        gl.deleteProgram(program);
        gl.deleteShader(vertexShader);
        gl.deleteShader(fragmentShader);
        return { ok: false, reason: "resource-allocation-failed" };
      }

      gl.bindVertexArray(vertexArray);
      gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, this.maximumBufferBytes, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(positionLocation);
      gl.vertexAttribPointer(
        positionLocation,
        STUDIO_WEBGL_LIVE_INK_VERTEX_FLOATS,
        gl.FLOAT,
        false,
        STUDIO_WEBGL_LIVE_INK_VERTEX_BYTES,
        0
      );
      gl.bindVertexArray(null);
      this.resources = {
        program,
        vertexShader,
        fragmentShader,
        vertexArray,
        vertexBuffer,
        colorLocation,
      };
      return { ok: true };
    } catch {
      if (vertexArray) gl.deleteVertexArray(vertexArray);
      if (vertexBuffer) gl.deleteBuffer(vertexBuffer);
      if (program) gl.deleteProgram(program);
      if (vertexShader) gl.deleteShader(vertexShader);
      if (fragmentShader) gl.deleteShader(fragmentShader);
      return { ok: false, reason: "resource-allocation-failed" };
    }
  }

  private readonly handleContextLost = (event: Event): void => {
    if (this.stateValue === "disposed") return;
    event.preventDefault();
    this.releaseResources(false);
    this.stateValue = "lost";
    this.notifyState("lost", "context-lost");
  };

  private readonly handleContextRestored = (): void => {
    if (this.stateValue !== "lost") return;
    const initialized = this.initializeResources();
    if (!initialized.ok) {
      this.stateValue = "failed";
      this.notifyState("failed", "renderer-failed");
      return;
    }
    this.stateValue = "ready";
    const input = this.surfaceInput;
    if (input) {
      const restoredSurface = this.setSurface(input);
      if (!restoredSurface.ok) return;
    } else {
      this.failClosedClear();
    }
    // Restored resources contain no old pixels or geometry. The caller must submit the current
    // transient stroke again; this callback only declares the boundary safe to use.
    this.notifyState("ready");
  };

  private unavailableResult(): StudioWebGlLiveInkOperationResult | null {
    if (this.stateValue === "ready") return null;
    if (this.stateValue === "lost") return { ok: false, reason: "context-lost" };
    if (this.stateValue === "disposed") return { ok: false, reason: "disposed" };
    return { ok: false, reason: "renderer-failed" };
  }

  private clearInternal(): void {
    const gl = this.gl;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  private failClosedClear(): void {
    if (this.stateValue !== "ready" || this.gl.isContextLost()) return;
    try {
      this.clearInternal();
    } catch {
      // The public operation that triggered this path already reports failure to the caller.
    }
  }

  private failRenderer(reason: StudioWebGlLiveInkFailureReason): StudioWebGlLiveInkOperationResult {
    this.failClosedClear();
    this.releaseResources(!this.gl.isContextLost());
    this.stateValue = "failed";
    this.notifyState("failed", reason);
    return { ok: false, reason };
  }

  private releaseResources(deleteObjects: boolean): void {
    const resources = this.resources;
    this.resources = null;
    if (!resources || !deleteObjects) return;
    try {
      this.gl.deleteBuffer(resources.vertexBuffer);
      this.gl.deleteVertexArray(resources.vertexArray);
      this.gl.deleteProgram(resources.program);
      this.gl.deleteShader(resources.vertexShader);
      this.gl.deleteShader(resources.fragmentShader);
    } catch {
      // Cleanup is best-effort and idempotent; state has already stopped accepting commands.
    }
  }

  private notifyState(
    state: StudioWebGlLiveInkState,
    reason?: StudioWebGlLiveInkFailureReason
  ): void {
    try {
      this.onStateChange?.(state, reason);
    } catch {
      // Consumer telemetry must never break the renderer lifecycle.
    }
  }
}

export function createStudioWebGlLiveInkRenderer(
  canvas: HTMLCanvasElement,
  options: StudioWebGlLiveInkRendererOptions = {}
): StudioWebGlLiveInkCreateResult {
  return StudioWebGlLiveInkRenderer.create(canvas, options);
}
