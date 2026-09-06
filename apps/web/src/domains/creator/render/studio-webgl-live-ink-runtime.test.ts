import { describe, expect, it, vi } from "vitest";

import { STUDIO_INK_PRESSURE_MODEL_LINEAR_FULL_V1 } from "../brush/studio-ink-pressure-model";

import {
  createStudioWebGlLiveInkRenderer,
  type StudioWebGlLiveInkState,
} from "./studio-webgl-live-ink-runtime";

import type { StudioGpuStroke } from "./studio-webgpu-stroke";

function stroke(overrides: Partial<StudioGpuStroke> = {}): StudioGpuStroke {
  return {
    id: "stroke-1",
    points: [10, 20, 30, 40, 50, 60],
    pressures: [0.25, 0.5, 1],
    color: "#3366ff",
    size: 12,
    pressureModel: STUDIO_INK_PRESSURE_MODEL_LINEAR_FULL_V1,
    opacity: 0.75,
    ...overrides,
  };
}

const surface = {
  left: 0,
  top: 0,
  width: 100,
  height: 80,
  documentScale: 1,
  documentWidth: 100,
  flipX: false,
  devicePixelRatio: 2,
} as const;

function fakeWebGl2() {
  let lost = false;
  const bufferData = vi.fn();
  const bufferSubData = vi.fn();
  const clear = vi.fn();
  const drawArrays = vi.fn();
  const deleteBuffer = vi.fn();
  const deleteVertexArray = vi.fn();
  const deleteProgram = vi.fn();
  const deleteShader = vi.fn();
  const viewport = vi.fn();
  const gl = {
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    ARRAY_BUFFER: 0x8892,
    DYNAMIC_DRAW: 0x88e8,
    FLOAT: 0x1406,
    BLEND: 0x0be2,
    SRC_ALPHA: 0x0302,
    ONE_MINUS_SRC_ALPHA: 0x0303,
    TRIANGLE_STRIP: 0x0005,
    COLOR_BUFFER_BIT: 0x4000,
    MAX_VIEWPORT_DIMS: 0x0d3a,
    createShader: vi.fn(() => ({})),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => true),
    deleteShader,
    createProgram: vi.fn(() => ({})),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => true),
    deleteProgram,
    getAttribLocation: vi.fn(() => 0),
    getUniformLocation: vi.fn(() => ({})),
    createVertexArray: vi.fn(() => ({})),
    bindVertexArray: vi.fn(),
    deleteVertexArray,
    createBuffer: vi.fn(() => ({})),
    bindBuffer: vi.fn(),
    bufferData,
    bufferSubData,
    deleteBuffer,
    enableVertexAttribArray: vi.fn(),
    vertexAttribPointer: vi.fn(),
    getParameter: vi.fn(() => new Int32Array([4_096, 4_096])),
    viewport,
    clearColor: vi.fn(),
    clear,
    useProgram: vi.fn(),
    enable: vi.fn(),
    blendFunc: vi.fn(),
    uniform4f: vi.fn(),
    drawArrays,
    isContextLost: vi.fn(() => lost),
  } as unknown as WebGL2RenderingContext;
  return {
    gl,
    bufferData,
    bufferSubData,
    clear,
    drawArrays,
    deleteBuffer,
    deleteVertexArray,
    deleteProgram,
    deleteShader,
    viewport,
    setLost: (value: boolean) => {
      lost = value;
    },
  };
}

function fakeCanvas(gl: WebGL2RenderingContext | null) {
  const listeners = new Map<string, EventListener>();
  const getContext = vi.fn((kind: string, _attributes?: WebGLContextAttributes) => (
    kind === "webgl2" ? gl : null
  ));
  const addEventListener = vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
    if (typeof listener === "function") listeners.set(type, listener);
  });
  const removeEventListener = vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
    if (listeners.get(type) === listener) listeners.delete(type);
  });
  const canvas = {
    width: 300,
    height: 150,
    getContext,
    addEventListener,
    removeEventListener,
  } as unknown as HTMLCanvasElement;
  return {
    canvas,
    getContext,
    addEventListener,
    removeEventListener,
    emit: (type: string, event: Event) => listeners.get(type)?.(event),
    hasListener: (type: string) => listeners.has(type),
  };
}

describe("StudioWebGlLiveInkRenderer", () => {
  it("detects unavailable WebGL2 and forces preserveDrawingBuffer off", () => {
    const unavailable = fakeCanvas(null);
    expect(createStudioWebGlLiveInkRenderer(unavailable.canvas))
      .toEqual({ ok: false, reason: "context-unavailable" });

    const fake = fakeWebGl2();
    const available = fakeCanvas(fake.gl);
    const result = createStudioWebGlLiveInkRenderer(available.canvas, {
      contextAttributes: { preserveDrawingBuffer: true },
    });
    expect(result.ok).toBe(true);
    expect(available.getContext).toHaveBeenCalledWith("webgl2", expect.objectContaining({
      alpha: true,
      desynchronized: true,
      preserveDrawingBuffer: false,
    }));
    if (result.ok) result.renderer.dispose();
  });

  it("allocates one bounded buffer and renders a variable-width triangle strip", () => {
    const fake = fakeWebGl2();
    const host = fakeCanvas(fake.gl);
    const result = createStudioWebGlLiveInkRenderer(host.canvas, { maximumBufferBytes: 64 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(fake.bufferData).toHaveBeenCalledWith(fake.gl.ARRAY_BUFFER, 64, fake.gl.DYNAMIC_DRAW);
    expect(result.renderer.maximumVertices).toBe(8);
    expect(result.renderer.setSurface(surface)).toEqual({ ok: true, vertexCount: 0 });
    expect(result.renderer.render(stroke())).toEqual({ ok: true, vertexCount: 6 });
    expect(fake.bufferSubData).toHaveBeenCalledWith(
      fake.gl.ARRAY_BUFFER,
      0,
      expect.any(Float32Array)
    );
    expect(fake.drawArrays).toHaveBeenCalledWith(fake.gl.TRIANGLE_STRIP, 0, 6);
    expect(fake.viewport).toHaveBeenLastCalledWith(0, 0, 200, 160);
  });

  it("clears stale preview pixels and reports invalid input without issuing another draw", () => {
    const fake = fakeWebGl2();
    const host = fakeCanvas(fake.gl);
    const result = createStudioWebGlLiveInkRenderer(host.canvas);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    result.renderer.setSurface(surface);
    expect(result.renderer.render(stroke()).ok).toBe(true);
    const clearCount = fake.clear.mock.calls.length;
    const drawCount = fake.drawArrays.mock.calls.length;

    expect(result.renderer.render(stroke({ points: [0, 0, Number.NaN, 1] })))
      .toEqual({ ok: false, reason: "invalid-stroke" });
    expect(fake.clear.mock.calls.length).toBe(clearCount + 1);
    expect(fake.drawArrays).toHaveBeenCalledTimes(drawCount);
  });

  it("rejects vertex and backing-surface budgets before uploading", () => {
    const fake = fakeWebGl2();
    const host = fakeCanvas(fake.gl);
    const result = createStudioWebGlLiveInkRenderer(host.canvas, { maximumBufferBytes: 32 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    result.renderer.setSurface(surface);

    expect(result.renderer.render(stroke()))
      .toEqual({ ok: false, reason: "vertex-budget-exceeded" });
    expect(fake.bufferSubData).not.toHaveBeenCalled();
    expect(result.renderer.setSurface({
      ...surface,
      width: 10_000,
      height: 10_000,
      devicePixelRatio: 1,
    })).toEqual({ ok: false, reason: "surface-budget-exceeded" });
    expect(result.renderer.resolvedSurface).toBeNull();
  });

  it("prevents default on context loss and restores empty, reusable GPU resources", () => {
    const fake = fakeWebGl2();
    const host = fakeCanvas(fake.gl);
    const states: Array<[StudioWebGlLiveInkState, string | undefined]> = [];
    const result = createStudioWebGlLiveInkRenderer(host.canvas, {
      onStateChange: (state, reason) => states.push([state, reason]),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    result.renderer.setSurface(surface);
    result.renderer.render(stroke());
    const drawCount = fake.drawArrays.mock.calls.length;

    const preventDefault = vi.fn();
    fake.setLost(true);
    host.emit("webglcontextlost", { preventDefault } as unknown as Event);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(result.renderer.state).toBe("lost");
    expect(result.renderer.render(stroke())).toEqual({ ok: false, reason: "context-lost" });
    expect(fake.deleteBuffer).not.toHaveBeenCalled();

    fake.setLost(false);
    host.emit("webglcontextrestored", new Event("webglcontextrestored"));
    expect(result.renderer.state).toBe("ready");
    expect(result.renderer.resolvedSurface).toMatchObject({ backingWidth: 200, backingHeight: 160 });
    expect(fake.drawArrays).toHaveBeenCalledTimes(drawCount);
    expect(result.renderer.render(stroke()).ok).toBe(true);
    expect(states).toEqual([
      ["ready", undefined],
      ["lost", "context-lost"],
      ["ready", undefined],
    ]);
  });

  it("disposes GPU resources and event listeners exactly once", () => {
    const fake = fakeWebGl2();
    const host = fakeCanvas(fake.gl);
    const result = createStudioWebGlLiveInkRenderer(host.canvas);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(host.hasListener("webglcontextlost")).toBe(true);
    expect(host.hasListener("webglcontextrestored")).toBe(true);

    result.renderer.dispose();
    result.renderer.dispose();
    expect(result.renderer.state).toBe("disposed");
    expect(result.renderer.render(stroke())).toEqual({ ok: false, reason: "disposed" });
    expect(fake.deleteBuffer).toHaveBeenCalledOnce();
    expect(fake.deleteVertexArray).toHaveBeenCalledOnce();
    expect(fake.deleteProgram).toHaveBeenCalledOnce();
    expect(fake.deleteShader).toHaveBeenCalledTimes(2);
    expect(host.hasListener("webglcontextlost")).toBe(false);
    expect(host.hasListener("webglcontextrestored")).toBe(false);
  });

  it("transitions to a stable failed state when a GPU command throws", () => {
    const fake = fakeWebGl2();
    const host = fakeCanvas(fake.gl);
    const result = createStudioWebGlLiveInkRenderer(host.canvas);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    result.renderer.setSurface(surface);
    fake.bufferSubData.mockImplementationOnce(() => {
      throw new Error("simulated driver failure");
    });

    expect(result.renderer.render(stroke()))
      .toEqual({ ok: false, reason: "gpu-command-failed" });
    expect(result.renderer.state).toBe("failed");
    expect(result.renderer.render(stroke()))
      .toEqual({ ok: false, reason: "renderer-failed" });
  });
});
