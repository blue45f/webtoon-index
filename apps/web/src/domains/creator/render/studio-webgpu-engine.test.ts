import { describe, expect, it, vi } from "vitest";

import {
  STUDIO_INK_PRESSURE_MODEL_LINEAR_FULL_V1,
  STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_PATH_V3,
  STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_V2,
} from "../brush/studio-ink-pressure-model";
import { studioHighBitSrgbToLinear } from "../studio-highbit-transfer";

import {
  isValidStudioGpuStroke,
  planStudioGpuDabUpdate,
  planStudioGpuDabs,
  planStudioGpuStrokeExtensionInRect,
  STUDIO_GPU_MAX_DABS,
} from "./studio-webgpu-dab-planner";
import {
  fingerprintStudioGpuFrame,
  StudioWebGpuEngine,
} from "./studio-webgpu-engine";
import { planStudioGpuLiveStroke } from "./studio-webgpu-live-stroke-plan";
import { STUDIO_GPU_DAB_INSTANCE_FLOATS } from "./studio-webgpu-tile-compositor";

import type { StudioGpuFrameReceipt } from "./studio-webgpu-frame-contract";
import type { StudioGpuStroke } from "./studio-webgpu-stroke";
import type { StudioGpuStrokeSuffixPatch } from "./studio-webgpu-stroke-feed";

interface Deferred<Value> {
  promise: Promise<Value>;
  resolve: (value: Value) => void;
}

interface FakeCanvas2d {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  arcs: Array<{ x: number; y: number; radius: number }>;
  composites: GlobalCompositeOperation[];
  clearRect: ReturnType<typeof vi.fn>;
  getImageData: ReturnType<typeof vi.fn>;
}

function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function fakeCanvas2d(): FakeCanvas2d {
  const arcs: FakeCanvas2d["arcs"] = [];
  const composites: GlobalCompositeOperation[] = [];
  let composite: GlobalCompositeOperation = "source-over";
  let fillStyle: string | CanvasGradient | CanvasPattern = "#000000";
  const clearRect = vi.fn();
  const getImageData = vi.fn((_x: number, _y: number, width: number, height: number) => ({
    data: new Uint8ClampedArray(width * height * 4),
  }));
  const context = {
    save: vi.fn(),
    restore: vi.fn(),
    setTransform: vi.fn(),
    clearRect,
    getImageData,
    beginPath: vi.fn(),
    arc: vi.fn((x: number, y: number, radius: number) => arcs.push({ x, y, radius })),
    fill: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
  Object.defineProperties(context, {
    globalCompositeOperation: {
      get: () => composite,
      set: (value: GlobalCompositeOperation) => {
        composite = value;
        composites.push(value);
      },
    },
    fillStyle: {
      get: () => fillStyle,
      set: (value: string | CanvasGradient | CanvasPattern) => {
        fillStyle = value;
      },
    },
  });
  const canvas = {
    width: 300,
    height: 150,
    style: {},
    getContext: vi.fn((kind: string) => kind === "2d" ? context : null),
  } as unknown as HTMLCanvasElement;
  return { canvas, context, arcs, composites, clearRect, getImageData };
}

function fakeGpuCanvas(context: GPUCanvasContext | null) {
  return {
    width: 300,
    height: 150,
    style: {},
    getContext: vi.fn((kind: string) => kind === "webgpu" ? context : null),
  } as unknown as HTMLCanvasElement;
}

function stroke(overrides: Partial<StudioGpuStroke> = {}): StudioGpuStroke {
  return {
    id: "stroke-1",
    points: [5, 10, 35, 10],
    pressures: [0.5, 1],
    color: "#ff3366",
    size: 8,
    opacity: 0.75,
    ...overrides,
  };
}

function fakeGpuDevice(
  lost: Promise<GPUDeviceLostInfo>,
  onSubmittedWorkDone: () => Promise<void> = async () => undefined,
  maxTextureDimension2D = 4_096
) {
  const draw = vi.fn();
  const setPipeline = vi.fn();
  const setVertexBuffer = vi.fn();
  const pass = {
    setPipeline,
    setVertexBuffer,
    setBindGroup: vi.fn(),
    draw,
    end: vi.fn(),
  };
  const buffer = { destroy: vi.fn() };
  const texture = { createView: vi.fn(() => ({ retainedView: true })), destroy: vi.fn() };
  const textures: Array<GPUTexture & { descriptor: GPUTextureDescriptor }> = [];
  const readbackBuffers: Array<GPUBuffer & { storage: ArrayBuffer }> = [];
  const encoder = {
    beginRenderPass: vi.fn(() => pass),
    copyTextureToTexture: vi.fn(),
    copyTextureToBuffer: vi.fn(),
    finish: vi.fn(() => ({ command: true })),
  };
  const device = {
    lost,
    limits: { maxTextureDimension2D },
    queue: {
      writeBuffer: vi.fn(),
      submit: vi.fn(),
      onSubmittedWorkDone: vi.fn(onSubmittedWorkDone),
    },
    createShaderModule: vi.fn(() => ({ shader: true })),
    createRenderPipeline: vi.fn((descriptor: GPURenderPipelineDescriptor) => ({
      descriptor,
      getBindGroupLayout: vi.fn(() => ({ layout: true })),
    })),
    createSampler: vi.fn(() => ({ sampler: true })),
    createBindGroup: vi.fn((descriptor: GPUBindGroupDescriptor) => ({ descriptor })),
    createBuffer: vi.fn((descriptor: GPUBufferDescriptor) => {
      if ((Number(descriptor.usage) & 0x01) !== 0) {
        const storage = new ArrayBuffer(Number(descriptor.size));
        const readback = {
          storage,
          mapAsync: vi.fn(async () => undefined),
          getMappedRange: vi.fn(() => storage),
          unmap: vi.fn(),
          destroy: vi.fn(),
        } as unknown as GPUBuffer & { storage: ArrayBuffer };
        readbackBuffers.push(readback);
        return readback;
      }
      return buffer;
    }),
    createTexture: vi.fn((descriptor: GPUTextureDescriptor) => {
      if (String(descriptor.label).startsWith("Studio retained tile ")) return texture;
      const created = {
        descriptor,
        createView: vi.fn(() => ({ retainedView: true })),
        destroy: vi.fn(),
      } as unknown as GPUTexture & { descriptor: GPUTextureDescriptor };
      textures.push(created);
      return created;
    }),
    createCommandEncoder: vi.fn(() => encoder),
    destroy: vi.fn(),
  } as unknown as GPUDevice;
  return {
    device,
    draw,
    setPipeline,
    setVertexBuffer,
    buffer,
    texture,
    textures,
    readbackBuffers,
    encoder,
  };
}

function renderPassDescriptors(
  fake: ReturnType<typeof fakeGpuDevice>
): readonly GPURenderPassDescriptor[] {
  return (
    fake.encoder.beginRenderPass.mock.calls as unknown as [GPURenderPassDescriptor][]
  ).map(([descriptor]) => descriptor);
}

describe("StudioWebGpuEngine", () => {
  it("invalidates first and acknowledges only a completely covered Canvas2D frame request", () => {
    const gpuSurface = fakeGpuCanvas(null);
    const fallback = fakeCanvas2d();
    const events: string[] = [];
    const onFrameReady = vi.fn((receipt: StudioGpuFrameReceipt) => (
      events.push(`ready:${receipt.requestId}`)
    ));
    const engine = new StudioWebGpuEngine({
      canvas: gpuSurface,
      canvas2dCanvas: fallback.canvas,
      selectedBackend: "canvas2d",
      gpu: null,
      onFrameInvalid: () => events.push("invalid"),
      onFrameReady,
    });
    engine.resize({ logicalWidth: 100, logicalHeight: 80 });
    events.length = 0;
    onFrameReady.mockClear();

    engine.render([stroke()], "draft:7");

    expect(events).toEqual(["invalid", "ready:draft:7"]);
    expect(onFrameReady).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "draft:7",
      backend: "canvas2d",
      complete: true,
      strokeCount: 1,
      physicalWidth: 100,
      physicalHeight: 80,
    }));
    expect(onFrameReady.mock.calls[0]?.[0].fingerprint).toBe(
      fingerprintStudioGpuFrame(
        [stroke()],
        { logicalWidth: 100, logicalHeight: 80 },
        100,
        80
      )
    );
  });

  it("binds an active surface resize to a fresh request before either backing store changes", () => {
    const gpuSurface = fakeGpuCanvas(null);
    const fallback = fakeCanvas2d();
    const events: string[] = [];
    const onFrameReady = vi.fn((receipt: StudioGpuFrameReceipt) => {
      events.push(`ready:${receipt.requestId}:${gpuSurface.width}`);
    });
    const engine = new StudioWebGpuEngine({
      canvas: gpuSurface,
      canvas2dCanvas: fallback.canvas,
      selectedBackend: "canvas2d",
      gpu: null,
      onFrameInvalid: () => {
        events.push(`invalid:${gpuSurface.width}:${fallback.canvas.width}`);
      },
      onFrameReady,
    });
    engine.resize({ logicalWidth: 100, logicalHeight: 80 });
    engine.render([stroke()], "resize:old");
    events.length = 0;
    onFrameReady.mockClear();

    const outcome = engine.resize(
      {
        logicalWidth: 120,
        logicalHeight: 80,
        cssWidth: 120,
        cssHeight: 80,
      },
      {
        requestId: "resize:new",
        onBeforeSurfaceMutation: (requestId) => {
          events.push(`before:${requestId}:${gpuSurface.width}:${fallback.canvas.width}`);
        },
      }
    );

    expect(outcome).toEqual({
      status: "resized",
      requestId: "resize:new",
      rerendered: true,
    });
    expect(events).toEqual([
      "before:resize:new:100:100",
      "invalid:100:100",
      "ready:resize:new:120",
    ]);
    expect(onFrameReady).toHaveBeenCalledTimes(1);
    expect(onFrameReady).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "resize:new",
      physicalWidth: 120,
      physicalHeight: 80,
    }));
  });

  it("defers resize rasterization to the exact following journal request without an old-feed receipt", () => {
    const fallback = fakeCanvas2d();
    const onFrameReady = vi.fn((_receipt: StudioGpuFrameReceipt) => undefined);
    const onFrameInvalid = vi.fn();
    const engine = new StudioWebGpuEngine({
      canvas: fakeGpuCanvas(null),
      canvas2dCanvas: fallback.canvas,
      selectedBackend: "canvas2d",
      gpu: null,
      onFrameInvalid,
      onFrameReady,
    });
    engine.resize({ logicalWidth: 100, logicalHeight: 80 });
    engine.replaceStrokeFeed([stroke()], "journal:old");
    onFrameReady.mockClear();
    onFrameInvalid.mockClear();

    const outcome = engine.resize(
      {
        logicalWidth: 100,
        logicalHeight: 80,
        scaleX: 1.25,
      },
      {
        requestId: "journal:resized",
        render: false,
      }
    );

    expect(outcome).toEqual({
      status: "resized",
      requestId: "journal:resized",
      rerendered: false,
    });
    expect(onFrameInvalid).toHaveBeenCalledTimes(1);
    expect(onFrameReady).not.toHaveBeenCalled();

    engine.retainStrokeFeed("journal:resized");

    expect(onFrameInvalid).toHaveBeenCalledTimes(1);
    expect(onFrameReady).toHaveBeenCalledTimes(1);
    expect(onFrameReady).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "journal:resized",
      complete: true,
    }));
  });

  it("does not mint a resize boundary or receipt when the normalized viewport is unchanged", () => {
    const fallback = fakeCanvas2d();
    const onFrameReady = vi.fn((_receipt: StudioGpuFrameReceipt) => undefined);
    const engine = new StudioWebGpuEngine({
      canvas: fakeGpuCanvas(null),
      canvas2dCanvas: fallback.canvas,
      selectedBackend: "canvas2d",
      gpu: null,
      onFrameReady,
    });
    engine.resize({ logicalWidth: 100, logicalHeight: 80 });
    engine.render([stroke()], "stable:old");
    onFrameReady.mockClear();
    const onBeforeSurfaceMutation = vi.fn();

    const outcome = engine.resize(
      { logicalWidth: 100, logicalHeight: 80 },
      {
        requestId: "stable:unused",
        onBeforeSurfaceMutation,
      }
    );

    expect(outcome).toEqual({
      status: "unchanged",
      requestId: "stable:unused",
      rerendered: false,
    });
    expect(onBeforeSurfaceMutation).not.toHaveBeenCalled();
    expect(onFrameReady).not.toHaveBeenCalled();
  });

  it("captures only the exact current Canvas2D receipt and rejects stale receipt objects", async () => {
    const fallback = fakeCanvas2d();
    const onFrameReady = vi.fn((_receipt: StudioGpuFrameReceipt) => undefined);
    const engine = new StudioWebGpuEngine({
      canvas: fakeGpuCanvas(null),
      canvas2dCanvas: fallback.canvas,
      selectedBackend: "canvas2d",
      gpu: null,
      onFrameReady,
    });
    engine.resize({
      logicalWidth: 100,
      logicalHeight: 80,
      cssWidth: 50,
      cssHeight: 40,
      dpr: 2,
    });
    engine.render([stroke()], "capture:canvas");
    const receipt = onFrameReady.mock.calls.at(-1)![0];
    fallback.getImageData.mockImplementationOnce((_x, _y, width, height) => ({
      data: new Uint8ClampedArray(width * height * 4).fill(17),
    }));

    await expect(engine.captureFrame({
      receipt,
      area: { kind: "document", rect: { x: 10, y: 10, width: 20, height: 10 } },
    })).resolves.toEqual(expect.objectContaining({
      status: "captured",
      receipt,
      pixelRect: { x: 10, y: 10, width: 20, height: 10 },
      width: 20,
      height: 10,
      pixels: new Uint8ClampedArray(800).fill(17),
    }));

    await expect(engine.captureFrame({
      receipt: { ...receipt },
      area: { kind: "viewport" },
    })).resolves.toEqual({ status: "rejected", reason: "stale-frame" });
    await expect(engine.captureFrame(
      null as unknown as Parameters<StudioWebGpuEngine["captureFrame"]>[0]
    )).resolves.toEqual({ status: "rejected", reason: "invalid-area" });
    await expect(engine.captureFrame({
      receipt,
      area: null as unknown as { kind: "viewport" },
    })).resolves.toEqual({ status: "rejected", reason: "invalid-area" });
    await expect(engine.captureFrame({
      area: { kind: "viewport" },
    } as unknown as Parameters<StudioWebGpuEngine["captureFrame"]>[0])).resolves.toEqual({
      status: "rejected",
      reason: "invalid-area",
    });
    engine.render([stroke({ id: "new" })], "capture:new");
    await expect(engine.captureFrame({
      receipt,
      area: { kind: "viewport" },
    })).resolves.toEqual({ status: "rejected", reason: "stale-frame" });
  });

  it("reports a tainted Canvas2D frame without leaking partial pixels", async () => {
    const fallback = fakeCanvas2d();
    const onFrameReady = vi.fn((_receipt: StudioGpuFrameReceipt) => undefined);
    const engine = new StudioWebGpuEngine({
      canvas: fakeGpuCanvas(null),
      canvas2dCanvas: fallback.canvas,
      selectedBackend: "canvas2d",
      gpu: null,
      onFrameReady,
    });
    engine.resize({ logicalWidth: 100, logicalHeight: 80 });
    engine.render([stroke()], "capture:tainted");
    const receipt = onFrameReady.mock.calls.at(-1)![0];
    fallback.getImageData.mockImplementationOnce(() => {
      throw Object.assign(new Error("cross-origin"), { name: "SecurityError" });
    });

    await expect(engine.captureFrame({ receipt, area: { kind: "viewport" } })).resolves.toEqual({
      status: "rejected",
      reason: "tainted",
    });
  });

  it("refuses frame authority for an overflowing brush contract", () => {
    const onFrameReady = vi.fn();
    const engine = new StudioWebGpuEngine({
      canvas: fakeGpuCanvas(null),
      canvas2dCanvas: fakeCanvas2d().canvas,
      selectedBackend: "canvas2d",
      gpu: null,
      onFrameReady,
    });
    engine.resize({ logicalWidth: 100, logicalHeight: 80 });
    onFrameReady.mockClear();

    engine.render([stroke({ size: Number.MAX_VALUE })], "invalid:overflow");

    expect(onFrameReady).not.toHaveBeenCalled();
  });

  it("renders linear-full pressure as zero to the selected diameter and fingerprints the model", () => {
    const pressureModel = STUDIO_INK_PRESSURE_MODEL_LINEAR_FULL_V1;
    const linear = stroke({
      points: [0, 0, 5, 0, 10, 0],
      pressures: [0, 0.5, 1],
      size: 10,
      pressureModel,
    });
    const plan = planStudioGpuDabs([linear]);

    expect(plan.complete).toBe(true);
    expect(plan.dabs[0]).toMatchObject({ x: 0, y: 0, radius: 0 });
    expect(plan.dabs.find(({ x }) => x === 5)).toMatchObject({ radius: 2.5 });
    expect(plan.dabs.at(-1)).toMatchObject({ x: 10, y: 0, radius: 5 });
    expect(fingerprintStudioGpuFrame([linear], {
      logicalWidth: 100,
      logicalHeight: 80,
    }, 100, 80)).not.toBe(fingerprintStudioGpuFrame([
      { ...linear, pressureModel: undefined },
    ], {
      logicalWidth: 100,
      logicalHeight: 80,
    }, 100, 80));
    expect(isValidStudioGpuStroke(linear)).toBe(true);
    expect(isValidStudioGpuStroke({
      ...linear,
      pressureModel: "future-model",
    } as unknown as StudioGpuStroke)).toBe(false);
  });

  it("uses full nominal pressure for short linear arrays and half pressure for legacy arrays", () => {
    const linear = planStudioGpuDabs([stroke({
      points: [0, 0],
      pressures: [],
      size: 10,
      pressureModel: STUDIO_INK_PRESSURE_MODEL_LINEAR_FULL_V1,
    })]);
    const legacy = planStudioGpuDabs([stroke({
      points: [0, 0],
      pressures: [],
      size: 10,
    })]);

    expect(linear.dabs[0]?.radius).toBe(5);
    expect(legacy.dabs[0]?.radius).toBe(5);
  });

  it("renders normal and erase strokes only through an explicit Canvas2D selection", async () => {
    const gpuSurface = fakeGpuCanvas(null);
    const fallback = fakeCanvas2d();
    const gpu = {
      requestAdapter: vi.fn(),
      getPreferredCanvasFormat: vi.fn(() => "bgra8unorm"),
    } as unknown as GPU;
    const engine = new StudioWebGpuEngine({
      canvas: gpuSurface,
      canvas2dCanvas: fallback.canvas,
      selectedBackend: "canvas2d",
      gpu,
    });

    engine.resize({
      logicalWidth: 100,
      logicalHeight: 80,
      cssWidth: 100,
      cssHeight: 80,
      dpr: 2,
    });
    engine.render([
      stroke(),
      stroke({ id: "eraser", composite: "erase", points: [10, 10, 20, 10] }),
    ]);

    await expect(engine.initialize()).resolves.toBe("canvas2d");
    expect(gpu.requestAdapter).not.toHaveBeenCalled();
    expect(fallback.canvas.width).toBe(200);
    expect(fallback.canvas.height).toBe(160);
    expect(fallback.arcs.length).toBeGreaterThan(4);
    expect(fallback.composites).toContain("source-over");
    expect(fallback.composites).toContain("destination-out");
    expect(gpuSurface.style.visibility).toBe("hidden");
    expect(fallback.canvas.style.visibility).toBe("visible");

    engine.clear();
    expect(fallback.clearRect).toHaveBeenLastCalledWith(0, 0, 200, 160);
  });

  it("keeps default WebGPU unavailable when initialization fails without drawing Canvas2D", async () => {
    const gpuSurface = fakeGpuCanvas(null);
    const canvas2d = fakeCanvas2d();
    const onBackendChange = vi.fn();
    const onFrameInvalid = vi.fn();
    const engine = new StudioWebGpuEngine({
      canvas: gpuSurface,
      canvas2dCanvas: canvas2d.canvas,
      gpu: null,
      onBackendChange,
      onFrameInvalid,
    });

    engine.resize({ logicalWidth: 100, logicalHeight: 80 });
    engine.render([stroke()], "webgpu:unavailable");
    await expect(engine.initialize()).resolves.toBe("webgpu");

    expect(engine.getBackend()).toBe("webgpu");
    expect(engine.isBackendAvailable()).toBe(false);
    expect(onBackendChange).toHaveBeenCalledTimes(1);
    expect(onBackendChange).toHaveBeenCalledWith("webgpu");
    expect(onFrameInvalid).toHaveBeenCalled();
    expect(canvas2d.arcs).toHaveLength(0);
    expect(gpuSurface.style.visibility).toBe("hidden");
    expect(canvas2d.canvas.style.visibility).toBe("hidden");
  });

  it("uses CSS size times DPR while preserving aspect ratio under the device texture limit", () => {
    const gpuSurface = fakeGpuCanvas(null);
    const fallback = fakeCanvas2d();
    const engine = new StudioWebGpuEngine({
      canvas: gpuSurface,
      canvas2dCanvas: fallback.canvas,
      selectedBackend: "canvas2d",
      gpu: null,
    });

    engine.resize({
      logicalWidth: 800,
      logicalHeight: 1_200,
      cssWidth: 240,
      cssHeight: 360,
      dpr: 2.5,
    });

    expect(gpuSurface.width).toBe(600);
    expect(gpuSurface.height).toBe(900);
    expect(fallback.canvas.width).toBe(600);
    expect(fallback.canvas.height).toBe(900);
  });

  it("appends only new Canvas2D segment dabs and rebuilds after divergence or resize", () => {
    const gpuSurface = fakeGpuCanvas(null);
    const fallback = fakeCanvas2d();
    const engine = new StudioWebGpuEngine({
      canvas: gpuSurface,
      canvas2dCanvas: fallback.canvas,
      selectedBackend: "canvas2d",
      gpu: null,
    });
    const initial = stroke({ points: [0, 0, 20, 0], pressures: [0.5, 0.6] });
    const extension = stroke({ points: [0, 0, 20, 0, 24, 0], pressures: [0.5, 0.6, 0.7] });

    engine.resize({ logicalWidth: 100, logicalHeight: 80 });
    engine.render([initial]);
    const clearsAfterInitial = fallback.clearRect.mock.calls.length;
    const arcsAfterInitial = fallback.arcs.length;
    engine.render([extension]);

    const suffix = planStudioGpuDabUpdate([initial], [extension]);
    expect(suffix.mode).toBe("append");
    expect(fallback.clearRect).toHaveBeenCalledTimes(clearsAfterInitial);
    expect(fallback.arcs).toHaveLength(arcsAfterInitial + suffix.dabs.length);

    const diverged = stroke({
      points: [0, 0, 19, 1, 24, 0, 28, 0],
      pressures: [0.5, 0.6, 0.7, 0.8],
    });
    engine.render([diverged]);
    expect(fallback.clearRect).toHaveBeenCalledTimes(clearsAfterInitial + 1);

    engine.resize({ logicalWidth: 100, logicalHeight: 80, scaleX: 1.1 });
    expect(fallback.clearRect).toHaveBeenCalledTimes(clearsAfterInitial + 2);
    engine.resize({ logicalWidth: 100, logicalHeight: 80, scaleX: 1.1 });
    expect(fallback.clearRect).toHaveBeenCalledTimes(clearsAfterInitial + 2);
  });

  it("feeds a tap, pointer suffix, and final seal without rereading retained point history", () => {
    const gpuSurface = fakeGpuCanvas(null);
    const fallback = fakeCanvas2d();
    const engine = new StudioWebGpuEngine({
      canvas: gpuSurface,
      canvas2dCanvas: fallback.canvas,
      selectedBackend: "canvas2d",
      gpu: null,
    });
    const tap = stroke({ points: [2, 3], pressures: [0.5] });
    engine.resize({ logicalWidth: 100, logicalHeight: 80 });
    engine.replaceStrokeFeed([tap], "feed:tap");
    expect(fallback.arcs).toHaveLength(1);
    const clearsAfterTap = fallback.clearRect.mock.calls.length;

    const movedPoints = new Proxy([2, 3, 9, 7], {
      get(target, property, receiver) {
        if (property === "0" || property === "1") {
          throw new Error("retained tap history was read");
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const moved = stroke({ points: movedPoints, pressures: [0.5, 0.8] });
    const movedPatch: StudioGpuStrokeSuffixPatch = {
      strokeIndex: 0,
      previousPointCount: 1,
      suffixPoints: [9, 7],
      suffixPressures: [0.8],
      nextStroke: moved,
      fallbackStrokes: [moved],
    };
    expect(engine.appendStrokeFeedSuffix(movedPatch, "feed:moved")).toBe("appended");
    const arcsAfterMove = fallback.arcs.length;
    expect(arcsAfterMove).toBeGreaterThan(1);
    expect(fallback.clearRect).toHaveBeenCalledTimes(clearsAfterTap);

    const sealedPoints = new Proxy([2, 3, 9, 7, 10, 8], {
      get(target, property, receiver) {
        if (["0", "1", "2", "3"].includes(String(property))) {
          throw new Error("retained move history was read");
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const sealed = stroke({ points: sealedPoints, pressures: [0.5, 0.8, 0.7] });
    expect(engine.appendStrokeFeedSuffix({
      strokeIndex: 0,
      previousPointCount: 2,
      suffixPoints: [10, 8],
      suffixPressures: [0.7],
      nextStroke: sealed,
      fallbackStrokes: [sealed],
    }, "feed:sealed")).toBe("appended");
    expect(fallback.arcs.length).toBeGreaterThan(arcsAfterMove);
    expect(fallback.clearRect).toHaveBeenCalledTimes(clearsAfterTap);
  });

  it("advances a symmetry suffix group with one engine request and rejects torn groups", () => {
    const gpuSurface = fakeGpuCanvas(null);
    const fallback = fakeCanvas2d();
    const engine = new StudioWebGpuEngine({
      canvas: gpuSurface,
      canvas2dCanvas: fallback.canvas,
      selectedBackend: "canvas2d",
      gpu: null,
    });
    const initial = [
      stroke({ id: "live", orderKey: "group", points: [2, 3], pressures: [0.5] }),
      stroke({
        id: "live:gpu-symmetry:1",
        orderKey: "group",
        points: [98, 3],
        pressures: [0.5],
      }),
    ];
    engine.resize({ logicalWidth: 100, logicalHeight: 80 });
    engine.replaceStrokeFeed(initial, "symmetry:tap");

    const fallbackStrokes = [
      stroke({
        id: "live",
        orderKey: "group",
        points: [2, 3, 9, 7],
        pressures: [0.5, 0.8],
      }),
      stroke({
        id: "live:gpu-symmetry:1",
        orderKey: "group",
        points: [98, 3, 91, 7],
        pressures: [0.5, 0.8],
      }),
    ];
    const patches = fallbackStrokes.map((nextStroke, strokeIndex) => ({
      strokeIndex,
      previousPointCount: 1,
      suffixPoints: nextStroke.points.slice(2),
      suffixPressures: [0.8],
      nextStroke,
      fallbackStrokes,
    }));

    expect(engine.appendStrokeFeedSuffixBatch({
      patches,
      fallbackStrokes,
    }, "symmetry:move")).toBe("appended");
    expect(fallback.arcs.some(({ x, y }) => x === 9 && y === 7)).toBe(true);
    expect(fallback.arcs.some(({ x, y }) => x === 91 && y === 7)).toBe(true);

    expect(engine.appendStrokeFeedSuffixBatch({
      patches,
      fallbackStrokes,
    }, "symmetry:stale")).toBe("rebuilt");
  });

  it("runs suffix-only journal frames from internal revision receipts and rolls stale input back", () => {
    const gpuSurface = fakeGpuCanvas(null);
    const fallback = fakeCanvas2d();
    const onFrameReady = vi.fn();
    const engine = new StudioWebGpuEngine({
      canvas: gpuSurface,
      canvas2dCanvas: fallback.canvas,
      selectedBackend: "canvas2d",
      gpu: null,
      onFrameReady,
    });
    const rootPoints = [2, 3];
    const rootPressures = [0.5];
    engine.resize({ logicalWidth: 100, logicalHeight: 80 });
    expect(engine.replaceStrokeFeedJournalBaseline([
      stroke({ points: rootPoints, pressures: rootPressures }),
    ], "journal:root")).toBe("replaced");
    const clearsAfterRoot = fallback.clearRect.mock.calls.length;
    const suffixPoints = [9, 7, 10, 8];
    const suffixPressures = [0.8, 0.7];

    expect(engine.appendStrokeFeedJournalSuffix({
      strokeIndex: 0,
      previousPointCount: 1,
      suffixPoints,
      suffixPressures,
    }, "journal:move")).toBe("appended");
    expect(fallback.arcs.some(({ x, y }) => x === 9 && y === 7)).toBe(true);
    expect(fallback.arcs.some(({ x, y }) => x === 10 && y === 8)).toBe(true);
    expect(fallback.clearRect).toHaveBeenCalledTimes(clearsAfterRoot);
    expect(Object.isFrozen(rootPoints)).toBe(false);
    expect(Object.isFrozen(rootPressures)).toBe(false);
    expect(Object.isFrozen(suffixPoints)).toBe(false);
    expect(Object.isFrozen(suffixPressures)).toBe(false);

    const compactStrokes = (engine as unknown as {
      lastStrokes: readonly StudioGpuStroke[];
    }).lastStrokes;
    expect(compactStrokes[0]!.points).toEqual([2, 3]);
    const arcsAfterMove = fallback.arcs.length;
    expect(engine.appendStrokeFeedJournalSuffix({
      strokeIndex: 0,
      previousPointCount: 1,
      suffixPoints: [99, 99],
      suffixPressures: [1],
    }, "journal:stale")).toBe("rejected");
    expect(fallback.arcs).toHaveLength(arcsAfterMove);
    expect(fallback.clearRect).toHaveBeenCalledTimes(clearsAfterRoot);
    expect(onFrameReady).toHaveBeenLastCalledWith(expect.objectContaining({
      requestId: "journal:stale",
    }));
    expect(engine.replaceStrokeFeedJournalBaseline([
      stroke({ points: [0, 0, Number.NaN, 1] }),
    ], "journal:invalid-root")).toBe("rejected");
    expect(fallback.arcs).toHaveLength(arcsAfterMove);
    expect(fallback.clearRect).toHaveBeenCalledTimes(clearsAfterRoot);
    expect(onFrameReady).toHaveBeenLastCalledWith(expect.objectContaining({
      requestId: "journal:invalid-root",
    }));
  });

  it("rejects a torn journal symmetry batch without publishing any variation", () => {
    const gpuSurface = fakeGpuCanvas(null);
    const fallback = fakeCanvas2d();
    const engine = new StudioWebGpuEngine({
      canvas: gpuSurface,
      canvas2dCanvas: fallback.canvas,
      selectedBackend: "canvas2d",
      gpu: null,
    });
    engine.resize({ logicalWidth: 100, logicalHeight: 80 });
    expect(engine.replaceStrokeFeedJournalBaseline([
      stroke({ id: "left", points: [2, 3], pressures: [0.5] }),
      stroke({ id: "right", points: [98, 3], pressures: [0.5] }),
    ], "journal-batch:root")).toBe("replaced");
    const arcsBefore = fallback.arcs.length;
    const clearsBefore = fallback.clearRect.mock.calls.length;

    expect(engine.appendStrokeFeedJournalSuffixBatch({
      patches: [
        {
          strokeIndex: 0,
          previousPointCount: 1,
          suffixPoints: [9, 7],
          suffixPressures: [0.8],
        },
        {
          strokeIndex: 1,
          previousPointCount: 0,
          suffixPoints: [91, 7],
          suffixPressures: [0.8],
        },
      ],
    }, "journal-batch:torn")).toBe("rejected");
    expect(fallback.arcs).toHaveLength(arcsBefore);
    expect(fallback.clearRect).toHaveBeenCalledTimes(clearsBefore);

    expect(engine.appendStrokeFeedJournalSuffixBatch({
      patches: [
        {
          strokeIndex: 0,
          previousPointCount: 1,
          suffixPoints: [9, 7],
          suffixPressures: [0.8],
        },
        {
          strokeIndex: 1,
          previousPointCount: 1,
          suffixPoints: [91, 7],
          suffixPressures: [0.8],
        },
      ],
    }, "journal-batch:valid")).toBe("appended");
    expect(fallback.arcs.some(({ x, y }) => x === 9 && y === 7)).toBe(true);
    expect(fallback.arcs.some(({ x, y }) => x === 91 && y === 7)).toBe(true);
  });

  it("appends residual V2 feed dabs from cached phase without rereading retained coordinates", () => {
    const gpuSurface = fakeGpuCanvas(null);
    const fallback = fakeCanvas2d();
    const engine = new StudioWebGpuEngine({
      canvas: gpuSurface,
      canvas2dCanvas: fallback.canvas,
      selectedBackend: "canvas2d",
      gpu: null,
    });
    const pressureModel = STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_V2;
    const tap = stroke({
      points: [0, 0],
      pressures: [1],
      size: 16,
      pressureModel,
    });
    engine.resize({ logicalWidth: 100, logicalHeight: 80 });
    engine.replaceStrokeFeed([tap], "residual:tap");
    const clearsAfterTap = fallback.clearRect.mock.calls.length;

    const extendedPoints = new Proxy([0, 0, 4, 0], {
      get(target, property, receiver) {
        if (property === "0" || property === "1") {
          throw new Error("residual feed reread retained tap coordinates");
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const extended = stroke({
      points: extendedPoints,
      pressures: [1, 1],
      size: 16,
      pressureModel,
    });
    expect(engine.appendStrokeFeedSuffix({
      strokeIndex: 0,
      previousPointCount: 1,
      suffixPoints: [4, 0],
      suffixPressures: [1],
      nextStroke: extended,
      fallbackStrokes: [extended],
    }, "residual:move")).toBe("appended");

    expect(fallback.clearRect).toHaveBeenCalledTimes(clearsAfterTap);
    expect(fallback.arcs.map(({ x }) => x)).toEqual([0, 3.2]);
  });

  it("falls back to a full rebuild when an append patch has stale lineage", () => {
    const gpuSurface = fakeGpuCanvas(null);
    const fallback = fakeCanvas2d();
    const engine = new StudioWebGpuEngine({
      canvas: gpuSurface,
      canvas2dCanvas: fallback.canvas,
      selectedBackend: "canvas2d",
      gpu: null,
    });
    const initial = stroke({ points: [0, 0, 10, 0], pressures: [0.4, 0.6] });
    engine.resize({ logicalWidth: 100, logicalHeight: 80 });
    engine.replaceStrokeFeed([initial], "feed:initial");
    const clearsAfterInitial = fallback.clearRect.mock.calls.length;
    const replacement = stroke({
      points: [0, 0, 9, 1, 14, 2],
      pressures: [0.4, 0.7, 0.8],
    });

    expect(engine.appendStrokeFeedSuffix({
      strokeIndex: 0,
      previousPointCount: 1,
      suffixPoints: [14, 2],
      suffixPressures: [0.8],
      nextStroke: replacement,
      fallbackStrokes: [replacement],
    }, "feed:rebuild")).toBe("rebuilt");
    expect(fallback.clearRect).toHaveBeenCalledTimes(clearsAfterInitial + 1);
  });

  it("appends a newly-started operation without replaying retained strokes", () => {
    const gpuSurface = fakeGpuCanvas(null);
    const fallback = fakeCanvas2d();
    const engine = new StudioWebGpuEngine({
      canvas: gpuSurface,
      canvas2dCanvas: fallback.canvas,
      selectedBackend: "canvas2d",
      gpu: null,
    });
    const completed = stroke({ id: "completed", points: [0, 0, 10, 0] });
    engine.resize({ logicalWidth: 100, logicalHeight: 80 });
    engine.replaceStrokeFeed([completed], "feed:completed");
    const clearsAfterCompleted = fallback.clearRect.mock.calls.length;
    const arcsAfterCompleted = fallback.arcs.length;
    const next = stroke({ id: "next", points: [20, 20], pressures: [0.6] });

    expect(engine.appendStrokeFeedOperations({
      previousStrokeCount: 1,
      suffixStrokes: [next],
      fallbackStrokes: [completed, next],
    }, "feed:next")).toBe("appended");
    expect(fallback.clearRect).toHaveBeenCalledTimes(clearsAfterCompleted);
    expect(fallback.arcs).toHaveLength(arcsAfterCompleted + 1);

    const editedCompleted = stroke({ id: "completed", points: [0, 0, 9, 1] });
    const third = stroke({ id: "third", points: [30, 30], pressures: [0.7] });
    expect(engine.appendStrokeFeedOperations({
      previousStrokeCount: 2,
      suffixStrokes: [third],
      fallbackStrokes: [editedCompleted, next, third],
    }, "feed:edited-prefix")).toBe("rebuilt");
    expect(fallback.clearRect).toHaveBeenCalledTimes(clearsAfterCompleted + 1);
  });

  it("snapshots retained operations so an in-place pointer tail cannot receive a stale receipt", () => {
    const gpuSurface = fakeGpuCanvas(null);
    const fallback = fakeCanvas2d();
    const onFrameReady = vi.fn();
    const engine = new StudioWebGpuEngine({
      canvas: gpuSurface,
      canvas2dCanvas: fallback.canvas,
      selectedBackend: "canvas2d",
      gpu: null,
      onFrameReady,
    });
    const mutable = stroke({
      points: [0, 0, 20, 0],
      pressures: [0.5, 0.6],
    });
    const renderedSnapshot = {
      ...mutable,
      points: [...mutable.points],
      pressures: [...(mutable.pressures ?? [])],
    };
    engine.resize({ logicalWidth: 100, logicalHeight: 80 });
    engine.render([mutable], "mutable:before");
    const arcsBeforeTail = fallback.arcs.length;
    onFrameReady.mockClear();

    (mutable.points as number[]).push(30, 2);
    (mutable.pressures as number[]).push(0.9);
    engine.render([mutable], "mutable:after");

    const expected = planStudioGpuDabUpdate([renderedSnapshot], [mutable]);
    expect(expected.mode).toBe("append");
    expect(expected.dabs.length).toBeGreaterThan(0);
    expect(fallback.arcs).toHaveLength(arcsBeforeTail + expected.dabs.length);
    expect(onFrameReady).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "mutable:after",
      complete: true,
    }));
  });

  it("incrementally destination-outs a newly appended eraser on explicit Canvas2D", () => {
    const gpuSurface = fakeGpuCanvas(null);
    const fallback = fakeCanvas2d();
    const engine = new StudioWebGpuEngine({
      canvas: gpuSurface,
      canvas2dCanvas: fallback.canvas,
      selectedBackend: "canvas2d",
      gpu: null,
    });
    const ink = stroke({ id: "ink", orderKey: "a" });
    const eraser = stroke({
      id: "eraser",
      orderKey: "b",
      points: [12, 10, 24, 10],
      pressures: [0.4, 0.8],
      opacity: 0.6,
      composite: "erase",
    });

    engine.resize({ logicalWidth: 100, logicalHeight: 80 });
    engine.render([ink]);
    const clearsAfterInk = fallback.clearRect.mock.calls.length;
    const arcsAfterInk = fallback.arcs.length;
    const compositesAfterInk = fallback.composites.length;
    engine.render([ink, eraser]);

    expect(fallback.clearRect).toHaveBeenCalledTimes(clearsAfterInk);
    expect(fallback.arcs).toHaveLength(arcsAfterInk + planStudioGpuDabs([eraser]).dabs.length);
    expect(fallback.composites.slice(compositesAfterInk)).not.toHaveLength(0);
    expect(fallback.composites.slice(compositesAfterInk)).toEqual(
      expect.arrayContaining(["destination-out"])
    );
  });

  it("creates WebGPU pipelines and becomes unavailable without switching on device loss", async () => {
    const lost = deferred<GPUDeviceLostInfo>();
    const fake = fakeGpuDevice(lost.promise);
    const context = {
      configure: vi.fn(),
      unconfigure: vi.fn(),
      getCurrentTexture: vi.fn(() => ({ createView: vi.fn(() => ({ view: true })) })),
    } as unknown as GPUCanvasContext;
    const adapter = { requestDevice: vi.fn(async () => fake.device) } as unknown as GPUAdapter;
    const gpu = {
      requestAdapter: vi.fn(async () => adapter),
      getPreferredCanvasFormat: vi.fn(() => "bgra8unorm"),
    } as unknown as GPU;
    const gpuSurface = fakeGpuCanvas(context);
    const fallback = fakeCanvas2d();
    const onBackendChange = vi.fn();
    const onDeviceLost = vi.fn();
    const onFrameInvalid = vi.fn();
    const engine = new StudioWebGpuEngine({
      canvas: gpuSurface,
      canvas2dCanvas: fallback.canvas,
      gpu,
      autoRecover: false,
      onBackendChange,
      onDeviceLost,
      onFrameInvalid,
    });
    engine.resize({ logicalWidth: 100, logicalHeight: 80, cssWidth: 100, cssHeight: 80, dpr: 2 });
    expect(engine.replaceStrokeFeedJournalBaseline([
      stroke(),
      stroke({ id: "erase", composite: "erase", orderKey: "z" }),
    ], "device-loss:root")).toBe("replaced");

    await expect(engine.initialize()).resolves.toBe("webgpu");
    const pipelineCalls = vi.mocked(fake.device.createRenderPipeline).mock.calls;
    expect(pipelineCalls).toHaveLength(3);
    expect(pipelineCalls[0]?.[0].fragment?.targets?.[0]?.blend?.color).toMatchObject({
      srcFactor: "one",
      dstFactor: "one-minus-src-alpha",
    });
    expect(pipelineCalls[0]?.[0].fragment?.targets?.[0]?.format).toBe("rgba16float");
    expect(pipelineCalls[1]?.[0].fragment?.targets?.[0]?.blend?.color).toMatchObject({
      srcFactor: "zero",
      dstFactor: "one-minus-src-alpha",
    });
    expect(pipelineCalls[1]?.[0].fragment?.targets?.[0]?.format).toBe("rgba16float");
    expect(pipelineCalls[2]?.[0]).toMatchObject({
      label: "Studio retained tile presentation pipeline",
      fragment: { targets: [{ format: "bgra8unorm" }] },
    });
    expect(pipelineCalls[0]?.[0].vertex.buffers?.[0]).toMatchObject({
      arrayStride: STUDIO_GPU_DAB_INSTANCE_FLOATS * Float32Array.BYTES_PER_ELEMENT,
      attributes: expect.arrayContaining([
        { shaderLocation: 3, offset: 32, format: "float32" },
      ]),
    });
    expect(context.configure).toHaveBeenCalledWith(expect.objectContaining({
      device: fake.device,
      format: "bgra8unorm",
      alphaMode: "premultiplied",
    }));
    expect(fake.device.queue.writeBuffer).toHaveBeenCalled();
    expect(fake.device.queue.submit).toHaveBeenCalled();
    await vi.waitFor(() => expect(fake.draw).toHaveBeenCalled());
    expect(fake.draw.mock.calls.some(([, instanceCount]) => Number(instanceCount) > 0)).toBe(true);
    expect(gpuSurface.style.visibility).toBe("visible");

    expect(engine.appendStrokeFeedJournalSuffix({
      strokeIndex: 1,
      previousPointCount: 2,
      suffixPoints: [50, 12],
      suffixPressures: [0.9],
    }, "device-loss:suffix")).toBe("appended");

    const lossInfo = { reason: "unknown", message: "test loss" } as GPUDeviceLostInfo;
    lost.resolve(lossInfo);
    await vi.waitFor(() => expect(onDeviceLost).toHaveBeenCalledWith(lossInfo));
    expect(engine.getBackend()).toBe("webgpu");
    expect(engine.isBackendAvailable()).toBe(false);
    expect(onBackendChange).toHaveBeenCalledTimes(1);
    expect(onBackendChange).toHaveBeenCalledWith("webgpu");
    expect(onFrameInvalid).toHaveBeenCalled();
    expect(fallback.arcs).toHaveLength(0);
    expect(gpuSurface.style.visibility).toBe("hidden");
    expect(fallback.canvas.style.visibility).toBe("hidden");
    expect(context.unconfigure).toHaveBeenCalled();

    engine.dispose();
    expect(fake.buffer.destroy).toHaveBeenCalled();
  });

  it("submits corrected symmetric translucency and destination-out erasing to real GPU batches", async () => {
    const fake = fakeGpuDevice(new Promise<GPUDeviceLostInfo>(() => undefined));
    const context = {
      configure: vi.fn(),
      unconfigure: vi.fn(),
      getCurrentTexture: vi.fn(() => ({ createView: vi.fn(() => ({ view: true })) })),
    } as unknown as GPUCanvasContext;
    const adapter = { requestDevice: vi.fn(async () => fake.device) } as unknown as GPUAdapter;
    const gpu = {
      requestAdapter: vi.fn(async () => adapter),
      getPreferredCanvasFormat: vi.fn(() => "bgra8unorm"),
    } as unknown as GPU;
    const normal = planStudioGpuLiveStroke({
      id: "corrected-alpha",
      points: [5, 10, 20, 14],
      correctedPoints: [5, 10, 18, 12, 30, 10],
      correctedPressures: [0.4, 0.7, 0.9],
      color: "rgba(100, 50, 25, 0.5)",
      size: 8,
      opacity: 0.4,
      orderKey: "a",
      symmetry: { type: "vertical", centerX: 50, centerY: 40 },
    });
    const erase = planStudioGpuLiveStroke({
      id: "erase-alpha",
      points: [8, 10, 24, 10],
      pressures: [0.5, 1],
      color: "transparent",
      size: 10,
      opacity: 0.3,
      composite: "erase",
      destination: "retained-layer",
      orderKey: "b",
    });
    expect(normal?.preparation).toMatchObject({
      opacity: 0.4,
      symmetry: "expanded",
      geometry: "post-corrected",
    });
    expect(erase?.preparation).toMatchObject({ composite: "erase", opacity: 0.3 });

    const engine = new StudioWebGpuEngine({
      canvas: fakeGpuCanvas(context),
      canvas2dCanvas: fakeCanvas2d().canvas,
      gpu,
      retainReadbackSnapshot: false,
    });
    engine.resize({ logicalWidth: 100, logicalHeight: 80, cssWidth: 100, cssHeight: 80 });
    engine.render([...normal!.strokes, ...erase!.strokes], "advanced-live");

    await expect(engine.initialize()).resolves.toBe("webgpu");
    await vi.waitFor(() => {
      const pipelineLabels = fake.setPipeline.mock.calls.map(([pipeline]) => (
        (pipeline as { descriptor?: GPURenderPipelineDescriptor }).descriptor?.label
      ));
      expect(pipelineLabels).toEqual(expect.arrayContaining([
        "Studio round-dab brush pipeline",
        "Studio destination-out round-dab pipeline",
      ]));
    });
    const instanceWrite = vi.mocked(fake.device.queue.writeBuffer).mock.calls.find((call) => (
      call.length >= 5
      && call[2] instanceof ArrayBuffer
      && Number(call[4]) >= STUDIO_GPU_DAB_INSTANCE_FLOATS * Float32Array.BYTES_PER_ELEMENT
      && Number(call[4]) % (STUDIO_GPU_DAB_INSTANCE_FLOATS * Float32Array.BYTES_PER_ELEMENT) === 0
    ));
    expect(instanceWrite).toBeDefined();
    const packed = new Float32Array(
      instanceWrite![2] as ArrayBuffer,
      Number(instanceWrite![3]),
      Number(instanceWrite![4]) / Float32Array.BYTES_PER_ELEMENT
    );
    // rgba alpha .5 × element opacity .4 = .2, packed as premultiplied linear-light color.
    expect(packed[7]).toBeCloseTo(0.2, 6);
    expect(packed[4]).toBeCloseTo(studioHighBitSrgbToLinear(100 / 255) * 0.2, 6);
    expect(fake.draw).toHaveBeenCalled();
    engine.dispose();
  });

  it("keeps retained tiles linear and converts straight RGB exactly once at presentation", async () => {
    const neverLost = new Promise<GPUDeviceLostInfo>(() => undefined);
    const fake = fakeGpuDevice(neverLost);
    const context = {
      configure: vi.fn(),
      unconfigure: vi.fn(),
      getCurrentTexture: vi.fn(() => ({ createView: vi.fn(() => ({ view: true })) })),
    } as unknown as GPUCanvasContext;
    const adapter = { requestDevice: vi.fn(async () => fake.device) } as unknown as GPUAdapter;
    const gpu = {
      requestAdapter: vi.fn(async () => adapter),
      getPreferredCanvasFormat: vi.fn(() => "bgra8unorm"),
    } as unknown as GPU;
    const engine = new StudioWebGpuEngine({
      canvas: fakeGpuCanvas(context),
      canvas2dCanvas: fakeCanvas2d().canvas,
      gpu,
    });

    await engine.initialize();

    const shaderSources = vi.mocked(fake.device.createShaderModule).mock.calls.map(
      ([descriptor]) => String(descriptor.code)
    );
    const presentation = shaderSources.find((source) => (
      source.includes("linear_premultiplied_to_srgb")
    ));
    expect(presentation).toContain("value.rgb / value.a");
    expect(presentation).toContain("channel <= 0.0031308");
    expect(presentation).toContain("encoded * value.a");
    engine.dispose();
  });

  it("recovers the same provider without replaying the failed operation", async () => {
    const firstLost = deferred<GPUDeviceLostInfo>();
    const firstSubmission = deferred<void>();
    const first = fakeGpuDevice(firstLost.promise, () => firstSubmission.promise);
    const secondSubmissions = Array.from({ length: 2 }, () => deferred<void>());
    let secondSubmissionIndex = 0;
    const second = fakeGpuDevice(
      new Promise<GPUDeviceLostInfo>(() => undefined),
      () => secondSubmissions[secondSubmissionIndex++]!.promise
    );
    const context = {
      configure: vi.fn(),
      unconfigure: vi.fn(),
      getCurrentTexture: vi.fn(() => ({ createView: vi.fn(() => ({ view: true })) })),
    } as unknown as GPUCanvasContext;
    const adapter = {
      requestDevice: vi.fn()
        .mockResolvedValueOnce(first.device)
        .mockResolvedValueOnce(second.device),
    } as unknown as GPUAdapter;
    const gpu = {
      requestAdapter: vi.fn(async () => adapter),
      getPreferredCanvasFormat: vi.fn(() => "bgra8unorm"),
    } as unknown as GPU;
    const onFrameReady = vi.fn((_receipt: StudioGpuFrameReceipt) => undefined);
    const engine = new StudioWebGpuEngine({
      canvas: fakeGpuCanvas(context),
      canvas2dCanvas: fakeCanvas2d().canvas,
      gpu,
      onFrameReady,
    });
    const initialStroke = stroke({ id: "recover-initial", orderKey: "a" });
    const latestStrokes = [
      initialStroke,
      stroke({ id: "recover-latest", orderKey: "b", points: [10, 20, 30, 20] }),
    ];

    engine.resize({ logicalWidth: 100, logicalHeight: 80 });
    await expect(engine.initialize()).resolves.toBe("webgpu");
    await vi.waitFor(() => expect(first.device.queue.onSubmittedWorkDone).toHaveBeenCalledTimes(1));
    engine.render([initialStroke], "recover:initial");

    firstLost.resolve({ reason: "unknown", message: "hung submission" } as GPUDeviceLostInfo);
    await vi.waitFor(() => expect(adapter.requestDevice).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(engine.isBackendAvailable()).toBe(true));
    // Reacquiring WebGPU does not replay or continue the operation that failed on the lost device.
    expect(second.device.queue.submit).not.toHaveBeenCalled();

    // A late completion from the lost device must not clear the recovered device's flight lock.
    firstSubmission.resolve(undefined);
    await Promise.resolve();
    await Promise.resolve();
    engine.render(latestStrokes, "recover:latest");
    expect(second.device.queue.submit).toHaveBeenCalledTimes(2);

    secondSubmissions[0]!.resolve(undefined);
    await vi.waitFor(() => expect(onFrameReady).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "recover:latest",
      backend: "webgpu",
      complete: true,
    })));
    engine.dispose();
  });

  it("releases an unpublished presentation snapshot as soon as its device is lost", async () => {
    const lost = deferred<GPUDeviceLostInfo>();
    const hungPresentation = deferred<void>();
    const fake = fakeGpuDevice(lost.promise, () => hungPresentation.promise);
    const context = {
      configure: vi.fn(),
      unconfigure: vi.fn(),
      getCurrentTexture: vi.fn(() => ({ createView: vi.fn(() => ({ view: true })) })),
    } as unknown as GPUCanvasContext;
    const adapter = { requestDevice: vi.fn(async () => fake.device) } as unknown as GPUAdapter;
    const gpu = {
      requestAdapter: vi.fn(async () => adapter),
      getPreferredCanvasFormat: vi.fn(() => "bgra8unorm"),
    } as unknown as GPU;
    const engine = new StudioWebGpuEngine({
      canvas: fakeGpuCanvas(context),
      canvas2dCanvas: fakeCanvas2d().canvas,
      gpu,
      autoRecover: false,
    });

    engine.resize({ logicalWidth: 100, logicalHeight: 80 });
    await expect(engine.initialize()).resolves.toBe("webgpu");
    await vi.waitFor(() => expect(fake.textures).toHaveLength(1));
    expect(fake.textures[0]?.destroy).not.toHaveBeenCalled();

    lost.resolve({ reason: "unknown", message: "hung presentation" } as GPUDeviceLostInfo);
    await vi.waitFor(() => expect(engine.isBackendAvailable()).toBe(false));
    expect(engine.getBackend()).toBe("webgpu");

    // The queue promise intentionally remains pending: device-loss cleanup, not eventual render
    // completion, must release this unpublished copy-on-write surface.
    expect(fake.textures[0]?.destroy).toHaveBeenCalledTimes(1);

    engine.dispose();
    hungPresentation.resolve(undefined);
    await hungPresentation.promise;
    await Promise.resolve();
    expect(fake.textures[0]?.destroy).toHaveBeenCalledTimes(1);
  });

  it("releases an unpublished presentation snapshot when disposed during a hung queue flight", async () => {
    const neverLost = new Promise<GPUDeviceLostInfo>(() => undefined);
    const hungPresentation = deferred<void>();
    const fake = fakeGpuDevice(neverLost, () => hungPresentation.promise);
    const context = {
      configure: vi.fn(),
      unconfigure: vi.fn(),
      getCurrentTexture: vi.fn(() => ({ createView: vi.fn(() => ({ view: true })) })),
    } as unknown as GPUCanvasContext;
    const adapter = { requestDevice: vi.fn(async () => fake.device) } as unknown as GPUAdapter;
    const gpu = {
      requestAdapter: vi.fn(async () => adapter),
      getPreferredCanvasFormat: vi.fn(() => "bgra8unorm"),
    } as unknown as GPU;
    const engine = new StudioWebGpuEngine({
      canvas: fakeGpuCanvas(context),
      canvas2dCanvas: fakeCanvas2d().canvas,
      gpu,
    });

    engine.resize({ logicalWidth: 100, logicalHeight: 80 });
    await expect(engine.initialize()).resolves.toBe("webgpu");
    await vi.waitFor(() => expect(fake.textures).toHaveLength(1));

    engine.dispose();
    expect(fake.textures[0]?.destroy).toHaveBeenCalledTimes(1);

    hungPresentation.resolve(undefined);
    await hungPresentation.promise;
    await Promise.resolve();
    expect(fake.textures[0]?.destroy).toHaveBeenCalledTimes(1);
  });

  it("drops stale WebGPU queue receipts and authorizes only the latest request", async () => {
    const neverLost = new Promise<GPUDeviceLostInfo>(() => undefined);
    const submitted = Array.from({ length: 3 }, () => deferred<void>());
    let submissionIndex = 0;
    const fake = fakeGpuDevice(neverLost, () => submitted[submissionIndex++]!.promise);
    const context = {
      configure: vi.fn(),
      unconfigure: vi.fn(),
      getCurrentTexture: vi.fn(() => ({ createView: vi.fn(() => ({ view: true })) })),
    } as unknown as GPUCanvasContext;
    const adapter = { requestDevice: vi.fn(async () => fake.device) } as unknown as GPUAdapter;
    const gpu = {
      requestAdapter: vi.fn(async () => adapter),
      getPreferredCanvasFormat: vi.fn(() => "bgra8unorm"),
    } as unknown as GPU;
    const onFrameReady = vi.fn();
    const engine = new StudioWebGpuEngine({
      canvas: fakeGpuCanvas(context),
      canvas2dCanvas: fakeCanvas2d().canvas,
      gpu,
      onFrameReady,
    });
    engine.resize({ logicalWidth: 100, logicalHeight: 80 });
    await engine.initialize();
    submitted[0]!.resolve(undefined);
    await vi.waitFor(() => expect(onFrameReady).toHaveBeenCalledWith(expect.objectContaining({
      backend: "webgpu",
      requestId: "initial",
    })));
    onFrameReady.mockClear();
    vi.mocked(fake.device.queue.writeBuffer).mockClear();
    vi.mocked(fake.encoder.beginRenderPass).mockClear();
    const older = stroke({
      points: [5, 10, 20, 10],
      pressures: [0.5, 0.6],
    });
    const middle = stroke({
      points: [5, 10, 20, 10, 30, 10],
      pressures: [0.5, 0.6, 0.7],
    });
    const latest = stroke({
      points: [5, 10, 20, 10, 30, 10, 45, 10],
      pressures: [0.5, 0.6, 0.7, 0.9],
    });
    engine.render([older], "request:older");
    engine.render([middle], "request:middle");
    engine.render([latest], "request:latest");

    // The older submitted frame remains in flight while only the latest request is retained.
    await vi.waitFor(() => expect(fake.device.queue.onSubmittedWorkDone).toHaveBeenCalledTimes(2));
    submitted[1]!.resolve(undefined);
    await vi.waitFor(() => expect(fake.device.queue.onSubmittedWorkDone).toHaveBeenCalledTimes(3));
    expect(onFrameReady).not.toHaveBeenCalled();
    submitted[2]!.resolve(undefined);
    await vi.waitFor(() => expect(onFrameReady).toHaveBeenCalledTimes(1));
    expect(onFrameReady).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "request:latest",
      backend: "webgpu",
      complete: true,
    }));
    const suffix = planStudioGpuDabUpdate([older], [latest]);
    expect(renderPassDescriptors(fake).some((descriptor) => (
      descriptor.colorAttachments.some((attachment) => attachment?.loadOp === "load")
    ))).toBe(true);
    expect(vi.mocked(fake.device.queue.writeBuffer).mock.calls.some((call) => (
      call[4] === suffix.dabs.length * STUDIO_GPU_DAB_INSTANCE_FLOATS * Float32Array.BYTES_PER_ELEMENT
    ))).toBe(true);
    expect(fake.texture.destroy).not.toHaveBeenCalled();
  });

  it("pipelines at most two GPU presentations and coalesces excess pointer frames to latest", async () => {
    const neverLost = new Promise<GPUDeviceLostInfo>(() => undefined);
    const submitted = Array.from({ length: 4 }, () => deferred<void>());
    let submissionIndex = 0;
    const fake = fakeGpuDevice(neverLost, () => submitted[submissionIndex++]!.promise);
    const context = {
      configure: vi.fn(),
      unconfigure: vi.fn(),
      getCurrentTexture: vi.fn(() => ({ createView: vi.fn(() => ({ view: true })) })),
    } as unknown as GPUCanvasContext;
    const adapter = { requestDevice: vi.fn(async () => fake.device) } as unknown as GPUAdapter;
    const gpu = {
      requestAdapter: vi.fn(async () => adapter),
      getPreferredCanvasFormat: vi.fn(() => "bgra8unorm"),
    } as unknown as GPU;
    const onFrameReady = vi.fn();
    const engine = new StudioWebGpuEngine({
      canvas: fakeGpuCanvas(context),
      canvas2dCanvas: fakeCanvas2d().canvas,
      gpu,
      onFrameReady,
    });
    engine.resize({ logicalWidth: 100, logicalHeight: 80 });
    await engine.initialize();
    submitted[0]!.resolve(undefined);
    await vi.waitFor(() => expect(onFrameReady).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "initial",
    })));
    onFrameReady.mockClear();
    vi.mocked(fake.device.queue.submit).mockClear();

    const first = stroke({ points: [5, 10, 20, 10], pressures: [0.5, 0.6] });
    const second = stroke({
      points: [5, 10, 20, 10, 30, 10],
      pressures: [0.5, 0.6, 0.7],
    });
    const latest = stroke({
      points: [5, 10, 20, 10, 30, 10, 45, 10],
      pressures: [0.5, 0.6, 0.7, 0.9],
    });
    engine.render([first], "pipeline:first");
    await vi.waitFor(() => expect(fake.device.queue.onSubmittedWorkDone).toHaveBeenCalledTimes(2));
    engine.render([second], "pipeline:second");
    await vi.waitFor(() => expect(fake.device.queue.onSubmittedWorkDone).toHaveBeenCalledTimes(3));
    expect(fake.device.queue.submit).toHaveBeenCalledTimes(4);

    engine.render([latest], "pipeline:latest");
    await Promise.resolve();
    await Promise.resolve();
    // Two frames are already fenced, so the third request stays as one newest-only pending value.
    expect(fake.device.queue.onSubmittedWorkDone).toHaveBeenCalledTimes(3);
    expect(fake.device.queue.submit).toHaveBeenCalledTimes(4);

    submitted[1]!.resolve(undefined);
    await vi.waitFor(() => expect(fake.device.queue.onSubmittedWorkDone).toHaveBeenCalledTimes(4));
    expect(fake.device.queue.submit).toHaveBeenCalledTimes(6);
    expect(onFrameReady).not.toHaveBeenCalled();

    submitted[2]!.resolve(undefined);
    submitted[3]!.resolve(undefined);
    await vi.waitFor(() => expect(onFrameReady).toHaveBeenCalledTimes(1));
    expect(onFrameReady).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "pipeline:latest",
      complete: true,
    }));
    engine.dispose();
  });

  it("loads a retained tile and writes only the exact suffix of one live stroke", async () => {
    const neverLost = new Promise<GPUDeviceLostInfo>(() => undefined);
    const fake = fakeGpuDevice(neverLost);
    const context = {
      configure: vi.fn(),
      unconfigure: vi.fn(),
      getCurrentTexture: vi.fn(() => ({ createView: vi.fn(() => ({ view: true })) })),
    } as unknown as GPUCanvasContext;
    const adapter = { requestDevice: vi.fn(async () => fake.device) } as unknown as GPUAdapter;
    const gpu = {
      requestAdapter: vi.fn(async () => adapter),
      getPreferredCanvasFormat: vi.fn(() => "bgra8unorm"),
    } as unknown as GPU;
    const onFrameReady = vi.fn();
    const engine = new StudioWebGpuEngine({
      canvas: fakeGpuCanvas(context),
      canvas2dCanvas: fakeCanvas2d().canvas,
      gpu,
      onFrameReady,
    });
    const initial = stroke({
      points: [0, 10, 20, 10],
      pressures: [0.5, 0.6],
    });
    const expectedExtended = stroke({
      points: [0, 10, 20, 10, 40, 10],
      pressures: [0.5, 0.6, 0.8],
    });
    const extended = stroke({
      points: new Proxy([0, 10, 20, 10, 40, 10], {
        get(target, property, receiver) {
          if (["0", "1", "2", "3"].includes(String(property))) {
            throw new Error("WebGPU feed reread retained point history");
          }
          return Reflect.get(target, property, receiver);
        },
      }),
      pressures: [0.5, 0.6, 0.8],
    });
    engine.resize({ logicalWidth: 100, logicalHeight: 80 });
    engine.replaceStrokeFeed([initial], "suffix:initial");
    await engine.initialize();
    await vi.waitFor(() => expect(onFrameReady).toHaveBeenCalledWith(expect.objectContaining({
      backend: "webgpu",
      requestId: "suffix:initial",
    })));

    vi.mocked(fake.device.queue.writeBuffer).mockClear();
    vi.mocked(fake.encoder.beginRenderPass).mockClear();
    expect(engine.appendStrokeFeedSuffix({
      strokeIndex: 0,
      previousPointCount: 2,
      suffixPoints: [40, 10],
      suffixPressures: [0.8],
      nextStroke: extended,
      fallbackStrokes: [extended],
    }, "suffix:extended")).toBe("appended");
    await vi.waitFor(() => expect(onFrameReady).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "suffix:extended",
    })));

    const suffix = planStudioGpuDabUpdate([initial], [expectedExtended]);
    expect(renderPassDescriptors(fake).some((descriptor) => (
      descriptor.colorAttachments.some((attachment) => attachment?.loadOp === "load")
    ))).toBe(true);
    expect(vi.mocked(fake.device.queue.writeBuffer).mock.calls[0]?.[4]).toBe(
      suffix.dabs.length * STUDIO_GPU_DAB_INSTANCE_FLOATS * Float32Array.BYTES_PER_ELEMENT
    );
    expect(vi.mocked(fake.device.createTexture).mock.calls.filter(([descriptor]) => (
      String(descriptor.label).startsWith("Studio retained tile ")
    ))).toHaveLength(1);
    expect(vi.mocked(fake.device.createTexture).mock.calls.filter(([descriptor]) => (
      descriptor.label === "Studio authoritative frame readback snapshot"
    ))).toHaveLength(1);
    expect(fake.texture.destroy).not.toHaveBeenCalled();
  });

  it("reuses retained-tile presentation bindings and reports bounded allocation metrics", async () => {
    const neverLost = new Promise<GPUDeviceLostInfo>(() => undefined);
    const fake = fakeGpuDevice(neverLost);
    const context = {
      configure: vi.fn(),
      unconfigure: vi.fn(),
      getCurrentTexture: vi.fn(() => ({ createView: vi.fn(() => ({ view: true })) })),
    } as unknown as GPUCanvasContext;
    const adapter = { requestDevice: vi.fn(async () => fake.device) } as unknown as GPUAdapter;
    const gpu = {
      requestAdapter: vi.fn(async () => adapter),
      getPreferredCanvasFormat: vi.fn(() => "bgra8unorm"),
    } as unknown as GPU;
    const onFrameReady = vi.fn((_receipt: StudioGpuFrameReceipt) => undefined);
    const engine = new StudioWebGpuEngine({
      canvas: fakeGpuCanvas(context),
      canvas2dCanvas: fakeCanvas2d().canvas,
      gpu,
      retainReadbackSnapshot: false,
      onFrameReady,
    });
    const retained = stroke({
      id: "binding-cache",
      points: [8, 12, 36, 12],
      pressures: [0.5, 0.8],
    });

    engine.resize({ logicalWidth: 100, logicalHeight: 80 });
    engine.render([retained], "binding:first");
    await engine.initialize();
    await vi.waitFor(() => expect(onFrameReady).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "binding:first",
      backend: "webgpu",
    })));

    const firstBindGroupCount = vi.mocked(fake.device.createBindGroup).mock.calls.length;
    const firstMetrics = engine.getPerformanceMetrics();
    expect(firstBindGroupCount).toBeGreaterThan(0);
    expect(firstMetrics).toMatchObject({
      instanceBufferAllocations: 1,
      presentationBufferAllocations: 1,
      presentationBindGroupAllocations: firstBindGroupCount,
      presentationBindGroupReuses: 0,
    });
    expect(Object.isFrozen(firstMetrics)).toBe(true);

    engine.render([retained], "binding:second");
    await vi.waitFor(() => expect(onFrameReady).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "binding:second",
      backend: "webgpu",
    })));

    expect(vi.mocked(fake.device.createBindGroup)).toHaveBeenCalledTimes(firstBindGroupCount);
    expect(engine.getPerformanceMetrics()).toEqual({
      instanceBufferAllocations: 1,
      presentationBufferAllocations: 1,
      presentationBindGroupAllocations: firstBindGroupCount,
      presentationBindGroupReuses: firstBindGroupCount,
    });

    engine.suspend("binding:suspended");
    engine.render([retained], "binding:after-suspend");
    await vi.waitFor(() => expect(onFrameReady).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "binding:after-suspend",
      backend: "webgpu",
    })));
    expect(vi.mocked(fake.device.createBindGroup)).toHaveBeenCalledTimes(
      firstBindGroupCount * 2
    );
    expect(engine.getPerformanceMetrics()).toEqual({
      instanceBufferAllocations: 1,
      presentationBufferAllocations: 1,
      presentationBindGroupAllocations: firstBindGroupCount * 2,
      presentationBindGroupReuses: firstBindGroupCount,
    });
  });

  it("retains exact tiles, appends immutable operations, and rebuilds changed history", async () => {
    const neverLost = new Promise<GPUDeviceLostInfo>(() => undefined);
    const fake = fakeGpuDevice(neverLost);
    const onFrameReady = vi.fn();
    const context = {
      configure: vi.fn(),
      unconfigure: vi.fn(),
      getCurrentTexture: vi.fn(() => ({ createView: vi.fn(() => ({ view: true })) })),
    } as unknown as GPUCanvasContext;
    const adapter = { requestDevice: vi.fn(async () => fake.device) } as unknown as GPUAdapter;
    const gpu = {
      requestAdapter: vi.fn(async () => adapter),
      getPreferredCanvasFormat: vi.fn(() => "bgra8unorm"),
    } as unknown as GPU;
    const engine = new StudioWebGpuEngine({
      canvas: fakeGpuCanvas(context),
      canvas2dCanvas: fakeCanvas2d().canvas,
      gpu,
      onFrameReady,
    });
    const initial = stroke({
      orderKey: "a",
      points: [0, 0, 20, 0],
      pressures: [0.5, 0.6],
    });
    const appended = stroke({
      id: "second",
      orderKey: "z",
      points: [4, 4, 24, 4],
      pressures: [0.5, 0.7],
    });
    engine.resize({ logicalWidth: 100, logicalHeight: 80 });
    engine.render([initial]);
    await engine.initialize();
    await vi.waitFor(() => expect(onFrameReady).toHaveBeenCalledWith(expect.objectContaining({
      backend: "webgpu",
    })));

    vi.mocked(fake.device.queue.writeBuffer).mockClear();
    vi.mocked(fake.encoder.beginRenderPass).mockClear();
    vi.mocked(fake.encoder.copyTextureToTexture).mockClear();
    expect(vi.mocked(fake.device.createTexture).mock.calls.filter(([descriptor]) => (
      String(descriptor.label).startsWith("Studio retained tile ")
    ))).toHaveLength(1);
    expect(vi.mocked(fake.device.createTexture).mock.calls.filter(([descriptor]) => (
      descriptor.label === "Studio authoritative frame readback snapshot"
    ))).toHaveLength(1);
    engine.render([initial, appended], "tiles:append");
    await vi.waitFor(() => expect(onFrameReady).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "tiles:append",
    })));
    expect(renderPassDescriptors(fake).some((descriptor) => (
      descriptor.colorAttachments.some((attachment) => attachment?.loadOp === "load")
    ))).toBe(true);
    expect(vi.mocked(fake.device.queue.writeBuffer).mock.calls[0]?.[4]).toBe(
      planStudioGpuDabs([appended]).dabs.length * STUDIO_GPU_DAB_INSTANCE_FLOATS * Float32Array.BYTES_PER_ELEMENT
    );
    expect(vi.mocked(fake.device.createTexture).mock.calls.filter(([descriptor]) => (
      String(descriptor.label).startsWith("Studio retained tile ")
    ))).toHaveLength(1);
    expect(vi.mocked(fake.device.createTexture).mock.calls.filter(([descriptor]) => (
      descriptor.label === "Studio authoritative frame readback snapshot"
    ))).toHaveLength(1);
    expect(fake.encoder.copyTextureToTexture).toHaveBeenCalledTimes(1);

    const changedHistory = stroke({
      orderKey: "a",
      points: [0, 0, 19, 1, 24, 0],
      pressures: [0.5, 0.6, 0.7],
    });
    vi.mocked(fake.encoder.beginRenderPass).mockClear();
    engine.render([changedHistory, appended], "tiles:rebuild");
    await vi.waitFor(() => expect(onFrameReady).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "tiles:rebuild",
    })));
    expect(renderPassDescriptors(fake).some((descriptor) => (
      descriptor.label === "Studio retained tile 0:0"
      && descriptor.colorAttachments.some((attachment) => attachment?.loadOp === "clear")
    ))).toBe(true);

    const textureCount = vi.mocked(fake.device.createTexture).mock.calls.length;
    vi.mocked(fake.encoder.beginRenderPass).mockClear();
    engine.resize({ logicalWidth: 100, logicalHeight: 80, offsetX: 4 });
    await vi.waitFor(() => expect(fake.encoder.beginRenderPass).toHaveBeenCalledWith(
      expect.objectContaining({ label: "Studio retained tile presentation" })
    ));
    expect(renderPassDescriptors(fake).some((descriptor) => (
      descriptor.label === "Studio retained tile 0:0"
    ))).toBe(false);
    expect(fake.device.createTexture).toHaveBeenCalledTimes(textureCount);
  });

  it("captures an aligned WebGPU snapshot and reuses a bounded copy-on-write texture ring", async () => {
    const neverLost = new Promise<GPUDeviceLostInfo>(() => undefined);
    const fake = fakeGpuDevice(neverLost);
    const onFrameReady = vi.fn((_receipt: StudioGpuFrameReceipt) => undefined);
    const context = {
      configure: vi.fn(),
      unconfigure: vi.fn(),
      getCurrentTexture: vi.fn(() => ({ createView: vi.fn(() => ({ view: true })) })),
    } as unknown as GPUCanvasContext;
    const adapter = { requestDevice: vi.fn(async () => fake.device) } as unknown as GPUAdapter;
    const gpu = {
      requestAdapter: vi.fn(async () => adapter),
      getPreferredCanvasFormat: vi.fn(() => "bgra8unorm"),
    } as unknown as GPU;
    const engine = new StudioWebGpuEngine({
      canvas: fakeGpuCanvas(context),
      canvas2dCanvas: fakeCanvas2d().canvas,
      gpu,
      onFrameReady,
    });
    engine.resize({ logicalWidth: 100, logicalHeight: 80 });
    await engine.initialize();
    await vi.waitFor(() => expect(onFrameReady).toHaveBeenCalled());

    for (let index = 0; index < 3; index += 1) {
      const requestId = `snapshot:reuse:${index}`;
      engine.render([stroke({ points: [5, 10, 35 + index, 10] })], requestId);
      await vi.waitFor(() => expect(onFrameReady).toHaveBeenCalledWith(expect.objectContaining({
        requestId,
      })));
    }
    expect(fake.textures).toHaveLength(1);
    const receipt = onFrameReady.mock.calls.at(-1)![0];
    vi.mocked(fake.encoder.copyTextureToBuffer).mockImplementationOnce((
      _source,
      destination
    ) => {
      const readback = destination.buffer as GPUBuffer & { storage: ArrayBuffer };
      new Uint8Array(readback.storage).set([25, 50, 100, 128]);
    });

    const captured = await engine.captureFrame({ receipt, area: { kind: "viewport" } });
    expect(captured).toEqual(expect.objectContaining({
      status: "captured",
      receipt,
      width: 100,
      height: 80,
      pixelRect: { x: 0, y: 0, width: 100, height: 80 },
    }));
    expect(captured.status === "captured" ? [...captured.pixels.slice(0, 4)] : null).toEqual([
      199, 100, 50, 128,
    ]);
    expect(fake.readbackBuffers.at(-1)?.unmap).toHaveBeenCalledTimes(1);
    expect(fake.readbackBuffers.at(-1)?.destroy).toHaveBeenCalledTimes(1);

    const captureSubmission = deferred<undefined>();
    vi.mocked(fake.device.queue.onSubmittedWorkDone).mockImplementationOnce(
      () => captureSubmission.promise
    );
    const staleCapture = engine.captureFrame({ receipt, area: { kind: "viewport" } });
    await vi.waitFor(() => expect(fake.encoder.copyTextureToBuffer).toHaveBeenCalledTimes(2));
    engine.render([stroke({ points: [5, 10, 60, 10] })], "snapshot:cow");
    await vi.waitFor(() => expect(onFrameReady).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "snapshot:cow",
    })));
    expect(fake.textures).toHaveLength(2);

    captureSubmission.resolve(undefined);
    await expect(staleCapture).resolves.toEqual({
      status: "rejected",
      reason: "stale-frame",
    });
    engine.render([stroke({ points: [5, 10, 70, 10] })], "snapshot:reuse-after-reader");
    await vi.waitFor(() => expect(onFrameReady).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "snapshot:reuse-after-reader",
    })));
    expect(fake.textures).toHaveLength(2);
  });

  it("keeps direct-engine readback opt-in compatible but skips every snapshot cost when disabled", async () => {
    const neverLost = new Promise<GPUDeviceLostInfo>(() => undefined);
    const fake = fakeGpuDevice(neverLost);
    const onFrameReady = vi.fn((_receipt: StudioGpuFrameReceipt) => undefined);
    const context = {
      configure: vi.fn(),
      unconfigure: vi.fn(),
      getCurrentTexture: vi.fn(() => ({ createView: vi.fn(() => ({ view: true })) })),
    } as unknown as GPUCanvasContext;
    const adapter = { requestDevice: vi.fn(async () => fake.device) } as unknown as GPUAdapter;
    const gpu = {
      requestAdapter: vi.fn(async () => adapter),
      getPreferredCanvasFormat: vi.fn(() => "bgra8unorm"),
    } as unknown as GPU;
    const engine = new StudioWebGpuEngine({
      canvas: fakeGpuCanvas(context),
      canvas2dCanvas: fakeCanvas2d().canvas,
      gpu,
      retainReadbackSnapshot: false,
      onFrameReady,
    });
    engine.resize({ logicalWidth: 100, logicalHeight: 80 });
    engine.render([stroke()], "display-only:no-readback");
    await engine.initialize();
    await vi.waitFor(() => expect(onFrameReady).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "display-only:no-readback",
      backend: "webgpu",
    })));
    const receipt = onFrameReady.mock.calls.at(-1)![0];

    expect(vi.mocked(fake.device.createTexture).mock.calls.filter(([descriptor]) => (
      descriptor.label === "Studio authoritative frame readback snapshot"
    ))).toHaveLength(0);
    expect(fake.encoder.copyTextureToTexture).not.toHaveBeenCalled();
    expect(vi.mocked(context.configure).mock.calls.length).toBeGreaterThan(0);
    expect(vi.mocked(context.configure).mock.calls.every(([descriptor]) => (
      (Number(descriptor.usage) & 0x01) === 0
    ))).toBe(true);
    await expect(engine.captureFrame({ receipt, area: { kind: "viewport" } })).resolves.toEqual({
      status: "rejected",
      reason: "frame-unavailable",
    });
  });

  it("suspends without a blank GPU frame, releases retained presentation, and reuses the device", async () => {
    const neverLost = new Promise<GPUDeviceLostInfo>(() => undefined);
    const fake = fakeGpuDevice(neverLost);
    const onFrameInvalid = vi.fn();
    const onFrameReady = vi.fn((_receipt: StudioGpuFrameReceipt) => undefined);
    const context = {
      configure: vi.fn(),
      unconfigure: vi.fn(),
      getCurrentTexture: vi.fn(() => ({ createView: vi.fn(() => ({ view: true })) })),
    } as unknown as GPUCanvasContext;
    const adapter = { requestDevice: vi.fn(async () => fake.device) } as unknown as GPUAdapter;
    const gpu = {
      requestAdapter: vi.fn(async () => adapter),
      getPreferredCanvasFormat: vi.fn(() => "bgra8unorm"),
    } as unknown as GPU;
    const gpuCanvas = fakeGpuCanvas(context);
    const fallback = fakeCanvas2d();
    const engine = new StudioWebGpuEngine({
      canvas: gpuCanvas,
      canvas2dCanvas: fallback.canvas,
      gpu,
      onFrameInvalid,
      onFrameReady,
    });
    engine.resize({ logicalWidth: 100, logicalHeight: 80 });
    engine.render([stroke()], "suspend:active");
    await engine.initialize();
    await vi.waitFor(() => expect(onFrameReady).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "suspend:active",
      backend: "webgpu",
    })));
    const activeReceipt = onFrameReady.mock.calls.at(-1)![0];
    const snapshotTexture = fake.textures[0]!;

    onFrameInvalid.mockClear();
    onFrameReady.mockClear();
    vi.mocked(fake.encoder.beginRenderPass).mockClear();
    vi.mocked(fake.device.queue.submit).mockClear();
    engine.suspend("suspend:empty");
    expect(engine.releaseSuspendedSurfaceBackingStores()).toBe(true);

    expect(onFrameInvalid).toHaveBeenCalledTimes(1);
    expect(gpuCanvas.style.visibility).toBe("hidden");
    expect(fallback.canvas.style.visibility).toBe("hidden");
    expect([gpuCanvas.width, gpuCanvas.height]).toEqual([1, 1]);
    expect([fallback.canvas.width, fallback.canvas.height]).toEqual([1, 1]);
    expect(context.unconfigure).toHaveBeenCalledTimes(1);
    expect(snapshotTexture.destroy).toHaveBeenCalledTimes(1);
    expect(fake.texture.destroy).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fake.device.destroy)).not.toHaveBeenCalled();
    await expect(engine.captureFrame({
      receipt: activeReceipt,
      area: { kind: "viewport" },
    })).resolves.toEqual({ status: "rejected", reason: "stale-frame" });

    engine.resize({
      logicalWidth: 100,
      logicalHeight: 80,
      cssWidth: 120,
      cssHeight: 96,
    });
    await Promise.resolve();
    expect([gpuCanvas.width, gpuCanvas.height]).toEqual([120, 96]);
    expect([fallback.canvas.width, fallback.canvas.height]).toEqual([120, 96]);
    expect(fake.encoder.beginRenderPass).not.toHaveBeenCalled();
    expect(vi.mocked(fake.device.queue.submit)).not.toHaveBeenCalled();
    expect(onFrameReady).not.toHaveBeenCalled();

    engine.render([stroke({ points: [10, 12, 48, 12] })], "suspend:resumed");
    await vi.waitFor(() => expect(onFrameReady).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "suspend:resumed",
      backend: "webgpu",
    })));
    expect(gpu.requestAdapter).toHaveBeenCalledTimes(1);
    expect(adapter.requestDevice).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fake.device.destroy)).not.toHaveBeenCalled();
    expect(gpuCanvas.style.visibility).toBe("visible");
  });

  it("defers suspended snapshot destruction until an active readback releases its reader", async () => {
    const neverLost = new Promise<GPUDeviceLostInfo>(() => undefined);
    const fake = fakeGpuDevice(neverLost);
    const onFrameReady = vi.fn((_receipt: StudioGpuFrameReceipt) => undefined);
    const context = {
      configure: vi.fn(),
      unconfigure: vi.fn(),
      getCurrentTexture: vi.fn(() => ({ createView: vi.fn(() => ({ view: true })) })),
    } as unknown as GPUCanvasContext;
    const adapter = { requestDevice: vi.fn(async () => fake.device) } as unknown as GPUAdapter;
    const gpu = {
      requestAdapter: vi.fn(async () => adapter),
      getPreferredCanvasFormat: vi.fn(() => "bgra8unorm"),
    } as unknown as GPU;
    const engine = new StudioWebGpuEngine({
      canvas: fakeGpuCanvas(context),
      canvas2dCanvas: fakeCanvas2d().canvas,
      gpu,
      onFrameReady,
    });
    engine.resize({ logicalWidth: 100, logicalHeight: 80 });
    engine.render([stroke()], "suspend:reader");
    await engine.initialize();
    await vi.waitFor(() => expect(onFrameReady).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "suspend:reader",
      backend: "webgpu",
    })));
    const receipt = onFrameReady.mock.calls.at(-1)![0];
    const snapshotTexture = fake.textures[0]!;
    const readbackWork = deferred<undefined>();
    vi.mocked(fake.device.queue.onSubmittedWorkDone).mockImplementationOnce(
      () => readbackWork.promise
    );
    const capture = engine.captureFrame({ receipt, area: { kind: "viewport" } });
    await vi.waitFor(() => expect(fake.readbackBuffers).toHaveLength(1));

    engine.suspend("suspend:reader-empty");
    expect(snapshotTexture.destroy).not.toHaveBeenCalled();

    readbackWork.resolve(undefined);
    await expect(capture).resolves.toEqual({ status: "rejected", reason: "stale-frame" });
    expect(snapshotTexture.destroy).toHaveBeenCalledTimes(1);
  });

  it("publishes oversized WebGPU display frames without allocating or copying a readback snapshot", async () => {
    const neverLost = new Promise<GPUDeviceLostInfo>(() => undefined);
    const fake = fakeGpuDevice(neverLost, async () => undefined, 8_192);
    const onFrameReady = vi.fn((_receipt: StudioGpuFrameReceipt) => undefined);
    const context = {
      configure: vi.fn(),
      unconfigure: vi.fn(),
      getCurrentTexture: vi.fn(() => ({ createView: vi.fn(() => ({ view: true })) })),
    } as unknown as GPUCanvasContext;
    const adapter = { requestDevice: vi.fn(async () => fake.device) } as unknown as GPUAdapter;
    const gpu = {
      requestAdapter: vi.fn(async () => adapter),
      getPreferredCanvasFormat: vi.fn(() => "bgra8unorm"),
    } as unknown as GPU;
    const engine = new StudioWebGpuEngine({
      canvas: fakeGpuCanvas(context),
      canvas2dCanvas: fakeCanvas2d().canvas,
      gpu,
      onFrameReady,
    });
    engine.resize({
      logicalWidth: 4_097,
      logicalHeight: 4_097,
      cssWidth: 4_097,
      cssHeight: 4_097,
    });
    await engine.initialize();
    await vi.waitFor(() => expect(onFrameReady).toHaveBeenCalledWith(expect.objectContaining({
      backend: "webgpu",
      physicalWidth: 4_097,
      physicalHeight: 4_097,
    })));
    const receipt = onFrameReady.mock.calls.at(-1)![0];

    expect(fake.textures).toHaveLength(0);
    expect(fake.encoder.copyTextureToTexture).not.toHaveBeenCalled();
    await expect(engine.captureFrame({ receipt, area: { kind: "viewport" } })).resolves.toEqual({
      status: "rejected",
      reason: "oversize",
    });
    await expect(engine.captureFrame({
      receipt,
      area: { kind: "document", rect: { x: 0, y: 0, width: 1, height: 1 } },
    })).resolves.toEqual({ status: "rejected", reason: "oversize" });
  });

  it("rejects nonlinear presentation formats instead of unpremultiplying sRGB bytes", async () => {
    const neverLost = new Promise<GPUDeviceLostInfo>(() => undefined);
    const fake = fakeGpuDevice(neverLost);
    const onFrameReady = vi.fn((_receipt: StudioGpuFrameReceipt) => undefined);
    const context = {
      configure: vi.fn(),
      unconfigure: vi.fn(),
      getCurrentTexture: vi.fn(() => ({ createView: vi.fn(() => ({ view: true })) })),
    } as unknown as GPUCanvasContext;
    const adapter = { requestDevice: vi.fn(async () => fake.device) } as unknown as GPUAdapter;
    const gpu = {
      requestAdapter: vi.fn(async () => adapter),
      getPreferredCanvasFormat: vi.fn(() => "bgra8unorm-srgb"),
    } as unknown as GPU;
    const engine = new StudioWebGpuEngine({
      canvas: fakeGpuCanvas(context),
      canvas2dCanvas: fakeCanvas2d().canvas,
      gpu,
      onFrameReady,
    });
    engine.resize({ logicalWidth: 100, logicalHeight: 80 });
    await engine.initialize();
    await vi.waitFor(() => expect(onFrameReady).toHaveBeenCalledWith(expect.objectContaining({
      backend: "webgpu",
    })));
    const receipt = onFrameReady.mock.calls.at(-1)![0];

    expect(fake.textures).toHaveLength(0);
    expect(fake.encoder.copyTextureToTexture).not.toHaveBeenCalled();
    await expect(engine.captureFrame({ receipt, area: { kind: "viewport" } })).resolves.toEqual({
      status: "rejected",
      reason: "unsupported-format",
    });
  });

  it("caps snapshot memory at two reader-held surfaces and still publishes the newest display", async () => {
    const neverLost = new Promise<GPUDeviceLostInfo>(() => undefined);
    const fake = fakeGpuDevice(neverLost);
    const onFrameReady = vi.fn((_receipt: StudioGpuFrameReceipt) => undefined);
    const context = {
      configure: vi.fn(),
      unconfigure: vi.fn(),
      getCurrentTexture: vi.fn(() => ({ createView: vi.fn(() => ({ view: true })) })),
    } as unknown as GPUCanvasContext;
    const adapter = { requestDevice: vi.fn(async () => fake.device) } as unknown as GPUAdapter;
    const gpu = {
      requestAdapter: vi.fn(async () => adapter),
      getPreferredCanvasFormat: vi.fn(() => "bgra8unorm"),
    } as unknown as GPU;
    const engine = new StudioWebGpuEngine({
      canvas: fakeGpuCanvas(context),
      canvas2dCanvas: fakeCanvas2d().canvas,
      gpu,
      onFrameReady,
    });
    engine.resize({ logicalWidth: 100, logicalHeight: 80 });
    await engine.initialize();
    await vi.waitFor(() => expect(onFrameReady).toHaveBeenCalled());
    const firstReceipt = onFrameReady.mock.calls.at(-1)![0];
    const firstRead = deferred<undefined>();
    vi.mocked(fake.device.queue.onSubmittedWorkDone).mockImplementationOnce(
      () => firstRead.promise
    );
    const firstCapture = engine.captureFrame({
      receipt: firstReceipt,
      area: { kind: "viewport" },
    });
    await vi.waitFor(() => expect(fake.readbackBuffers).toHaveLength(1));

    engine.render([stroke({ points: [5, 10, 50, 10] })], "budget:second");
    await vi.waitFor(() => expect(onFrameReady).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "budget:second",
    })));
    const secondReceipt = onFrameReady.mock.calls.at(-1)![0];
    const secondRead = deferred<undefined>();
    vi.mocked(fake.device.queue.onSubmittedWorkDone).mockImplementationOnce(
      () => secondRead.promise
    );
    const secondCapture = engine.captureFrame({
      receipt: secondReceipt,
      area: { kind: "viewport" },
    });
    await vi.waitFor(() => expect(fake.readbackBuffers).toHaveLength(2));

    engine.render([stroke({ points: [5, 10, 60, 10] })], "budget:display-only");
    await vi.waitFor(() => expect(onFrameReady).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "budget:display-only",
    })));
    const displayOnlyReceipt = onFrameReady.mock.calls.at(-1)![0];
    expect(fake.textures).toHaveLength(2);
    expect(fake.encoder.copyTextureToTexture).toHaveBeenCalledTimes(2);
    await expect(engine.captureFrame({
      receipt: displayOnlyReceipt,
      area: { kind: "viewport" },
    })).resolves.toEqual({ status: "rejected", reason: "frame-unavailable" });

    firstRead.resolve(undefined);
    secondRead.resolve(undefined);
    await expect(firstCapture).resolves.toEqual({ status: "rejected", reason: "stale-frame" });
    await expect(secondCapture).resolves.toEqual({ status: "rejected", reason: "stale-frame" });
  });

  it("rejects a third concurrent WebGPU read and cleans up a failed map", async () => {
    const neverLost = new Promise<GPUDeviceLostInfo>(() => undefined);
    const fake = fakeGpuDevice(neverLost);
    const onFrameReady = vi.fn((_receipt: StudioGpuFrameReceipt) => undefined);
    const context = {
      configure: vi.fn(),
      unconfigure: vi.fn(),
      getCurrentTexture: vi.fn(() => ({ createView: vi.fn(() => ({ view: true })) })),
    } as unknown as GPUCanvasContext;
    const adapter = { requestDevice: vi.fn(async () => fake.device) } as unknown as GPUAdapter;
    const gpu = {
      requestAdapter: vi.fn(async () => adapter),
      getPreferredCanvasFormat: vi.fn(() => "rgba8unorm"),
    } as unknown as GPU;
    const engine = new StudioWebGpuEngine({
      canvas: fakeGpuCanvas(context),
      canvas2dCanvas: fakeCanvas2d().canvas,
      gpu,
      onFrameReady,
    });
    engine.resize({ logicalWidth: 100, logicalHeight: 80 });
    await engine.initialize();
    await vi.waitFor(() => expect(onFrameReady).toHaveBeenCalled());
    const receipt = onFrameReady.mock.calls.at(-1)![0];
    const firstRead = deferred<undefined>();
    const secondRead = deferred<undefined>();
    vi.mocked(fake.device.queue.onSubmittedWorkDone)
      .mockImplementationOnce(() => firstRead.promise)
      .mockImplementationOnce(() => secondRead.promise);
    const firstCapture = engine.captureFrame({ receipt, area: { kind: "viewport" } });
    const secondCapture = engine.captureFrame({ receipt, area: { kind: "viewport" } });
    await vi.waitFor(() => expect(fake.readbackBuffers).toHaveLength(2));

    await expect(engine.captureFrame({ receipt, area: { kind: "viewport" } })).resolves.toEqual({
      status: "rejected",
      reason: "busy",
    });
    expect(fake.readbackBuffers).toHaveLength(2);
    firstRead.resolve(undefined);
    secondRead.resolve(undefined);
    await expect(firstCapture).resolves.toEqual(expect.objectContaining({ status: "captured" }));
    await expect(secondCapture).resolves.toEqual(expect.objectContaining({ status: "captured" }));

    const mapFailure = engine.captureFrame({ receipt, area: { kind: "viewport" } });
    const failedBuffer = fake.readbackBuffers.at(-1)!;
    vi.mocked(failedBuffer.mapAsync).mockRejectedValueOnce(new Error("map failed"));
    await expect(mapFailure).resolves.toEqual({ status: "rejected", reason: "readback-failed" });
    expect(failedBuffer.unmap).not.toHaveBeenCalled();
    expect(failedBuffer.destroy).toHaveBeenCalledTimes(1);
  });

  it("evicts reader-retired snapshot textures when the presentation size changes", async () => {
    const neverLost = new Promise<GPUDeviceLostInfo>(() => undefined);
    const fake = fakeGpuDevice(neverLost);
    const onFrameReady = vi.fn((_receipt: StudioGpuFrameReceipt) => undefined);
    const context = {
      configure: vi.fn(),
      unconfigure: vi.fn(),
      getCurrentTexture: vi.fn(() => ({ createView: vi.fn(() => ({ view: true })) })),
    } as unknown as GPUCanvasContext;
    const adapter = { requestDevice: vi.fn(async () => fake.device) } as unknown as GPUAdapter;
    const gpu = {
      requestAdapter: vi.fn(async () => adapter),
      getPreferredCanvasFormat: vi.fn(() => "bgra8unorm"),
    } as unknown as GPU;
    const engine = new StudioWebGpuEngine({
      canvas: fakeGpuCanvas(context),
      canvas2dCanvas: fakeCanvas2d().canvas,
      gpu,
      onFrameReady,
    });
    engine.resize({ logicalWidth: 100, logicalHeight: 80 });
    await engine.initialize();
    await vi.waitFor(() => expect(onFrameReady).toHaveBeenCalled());
    const firstReceipt = onFrameReady.mock.calls.at(-1)![0];
    const read = deferred<undefined>();
    vi.mocked(fake.device.queue.onSubmittedWorkDone).mockImplementationOnce(() => read.promise);
    const capture = engine.captureFrame({ receipt: firstReceipt, area: { kind: "viewport" } });
    await vi.waitFor(() => expect(fake.readbackBuffers).toHaveLength(1));
    engine.render([stroke()], "resize:second");
    await vi.waitFor(() => expect(onFrameReady).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "resize:second",
    })));
    expect(fake.textures).toHaveLength(2);
    read.resolve(undefined);
    await expect(capture).resolves.toEqual({ status: "rejected", reason: "stale-frame" });
    expect(fake.textures.every((texture) => !vi.mocked(texture.destroy).mock.calls.length)).toBe(true);

    engine.resize({ logicalWidth: 120, logicalHeight: 80, cssWidth: 120, cssHeight: 80 });
    await vi.waitFor(() => expect(onFrameReady).toHaveBeenCalledWith(expect.objectContaining({
      physicalWidth: 120,
      physicalHeight: 80,
    })));
    expect(fake.textures).toHaveLength(3);
    expect(fake.textures[0]?.destroy).toHaveBeenCalledTimes(1);
    expect(fake.textures[1]?.destroy).toHaveBeenCalledTimes(1);
    expect(fake.textures[2]?.descriptor.size).toEqual({
      width: 120,
      height: 80,
      depthOrArrayLayers: 1,
    });
  });

  it("rejects an in-flight WebGPU readback on device loss and releases its staging resources", async () => {
    const lost = deferred<GPUDeviceLostInfo>();
    const fake = fakeGpuDevice(lost.promise);
    const onFrameReady = vi.fn((_receipt: StudioGpuFrameReceipt) => undefined);
    const context = {
      configure: vi.fn(),
      unconfigure: vi.fn(),
      getCurrentTexture: vi.fn(() => ({ createView: vi.fn(() => ({ view: true })) })),
    } as unknown as GPUCanvasContext;
    const adapter = { requestDevice: vi.fn(async () => fake.device) } as unknown as GPUAdapter;
    const gpu = {
      requestAdapter: vi.fn(async () => adapter),
      getPreferredCanvasFormat: vi.fn(() => "bgra8unorm"),
    } as unknown as GPU;
    const engine = new StudioWebGpuEngine({
      canvas: fakeGpuCanvas(context),
      canvas2dCanvas: fakeCanvas2d().canvas,
      gpu,
      autoRecover: false,
      onFrameReady,
    });
    engine.resize({ logicalWidth: 100, logicalHeight: 80 });
    await engine.initialize();
    await vi.waitFor(() => expect(onFrameReady).toHaveBeenCalled());
    const receipt = onFrameReady.mock.calls.at(-1)![0];
    const readbackSubmission = deferred<undefined>();
    vi.mocked(fake.device.queue.onSubmittedWorkDone).mockImplementationOnce(
      () => readbackSubmission.promise
    );
    const capture = engine.captureFrame({ receipt, area: { kind: "viewport" } });
    await vi.waitFor(() => expect(fake.readbackBuffers).toHaveLength(1));

    lost.resolve({ reason: "unknown", message: "lost during capture" } as GPUDeviceLostInfo);
    await vi.waitFor(() => expect(engine.isBackendAvailable()).toBe(false));
    expect(engine.getBackend()).toBe("webgpu");
    readbackSubmission.resolve(undefined);

    await expect(capture).resolves.toEqual({ status: "rejected", reason: "device-lost" });
    expect(fake.readbackBuffers[0]?.destroy).toHaveBeenCalledTimes(1);
    expect(fake.textures[0]?.destroy).toHaveBeenCalledTimes(1);
  });

  it("keeps viewport-bounded WebGPU authority when only offscreen ink exceeds the dab cap", async () => {
    const neverLost = new Promise<GPUDeviceLostInfo>(() => undefined);
    const fake = fakeGpuDevice(neverLost);
    const onFrameReady = vi.fn((_receipt: StudioGpuFrameReceipt) => undefined);
    const context = {
      configure: vi.fn(),
      unconfigure: vi.fn(),
      getCurrentTexture: vi.fn(() => ({ createView: vi.fn(() => ({ view: true })) })),
    } as unknown as GPUCanvasContext;
    const adapter = { requestDevice: vi.fn(async () => fake.device) } as unknown as GPUAdapter;
    const gpu = {
      requestAdapter: vi.fn(async () => adapter),
      getPreferredCanvasFormat: vi.fn(() => "bgra8unorm"),
    } as unknown as GPU;
    const engine = new StudioWebGpuEngine({
      canvas: fakeGpuCanvas(context),
      canvas2dCanvas: fakeCanvas2d().canvas,
      gpu,
      onFrameReady,
    });
    engine.resize({
      logicalWidth: 100,
      logicalHeight: 100_000,
      cssWidth: 100,
      cssHeight: 80,
      scaleY: 1_000,
    });
    await engine.initialize();
    await vi.waitFor(() => expect(onFrameReady).toHaveBeenCalledWith(expect.objectContaining({
      backend: "webgpu",
    })));
    onFrameReady.mockClear();

    const offscreenInk = [
      stroke({
        id: "offscreen-a",
        points: [10, 10_000, 10, 35_001],
        pressures: [1, 1],
        size: 1,
      }),
      stroke({
        id: "offscreen-b",
        points: [20, 10_000, 20, 35_001],
        pressures: [1, 1],
        size: 1,
      }),
    ];
    expect(planStudioGpuDabs(offscreenInk).complete).toBe(false);

    engine.render(offscreenInk, "tiles:offscreen-cap");

    await vi.waitFor(() => expect(onFrameReady).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "tiles:offscreen-cap",
      backend: "webgpu",
      complete: true,
      dabCount: 0,
    })));
    expect(engine.getBackend()).toBe("webgpu");

    onFrameReady.mockClear();
    const crossing = stroke({
      id: "visible-crossing",
      points: [-100_000, 40, 100_000, 40],
      pressures: [1, 1],
      size: 1,
    });
    expect(planStudioGpuDabs([crossing]).complete).toBe(false);

    engine.render([crossing], "tiles:visible-crossing-cap");

    await vi.waitFor(() => expect(onFrameReady).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "tiles:visible-crossing-cap",
      backend: "webgpu",
      complete: true,
    })));
    const crossingReceipt = onFrameReady.mock.calls[0]![0];
    expect(crossingReceipt.dabCount).toBeGreaterThan(0);
    expect(crossingReceipt.dabCount).toBeLessThan(1_000);
    expect(engine.getBackend()).toBe("webgpu");
  });

  it("destroys a device that resolves after initialization was cancelled", async () => {
    const requestDevice = deferred<GPUDevice>();
    const neverLost = new Promise<GPUDeviceLostInfo>(() => undefined);
    const fake = fakeGpuDevice(neverLost);
    const adapter = { requestDevice: vi.fn(() => requestDevice.promise) } as unknown as GPUAdapter;
    const gpu = {
      requestAdapter: vi.fn(async () => adapter),
      getPreferredCanvasFormat: vi.fn(() => "bgra8unorm"),
    } as unknown as GPU;
    const fallback = fakeCanvas2d();
    const engine = new StudioWebGpuEngine({
      canvas: fakeGpuCanvas(null),
      canvas2dCanvas: fallback.canvas,
      gpu,
    });

    const initialization = engine.initialize();
    await vi.waitFor(() => expect(adapter.requestDevice).toHaveBeenCalled());
    engine.dispose();
    requestDevice.resolve(fake.device);

    await expect(initialization).resolves.toBe("webgpu");
    expect(engine.isBackendAvailable()).toBe(false);
    expect(fake.device.destroy).toHaveBeenCalledTimes(1);
  });

  it("does not authorize a WebGPU frame below the requested physical preview quality", async () => {
    const neverLost = new Promise<GPUDeviceLostInfo>(() => undefined);
    const fake = fakeGpuDevice(neverLost);
    const context = {
      configure: vi.fn(),
      unconfigure: vi.fn(),
      getCurrentTexture: vi.fn(() => ({ createView: vi.fn(() => ({ view: true })) })),
    } as unknown as GPUCanvasContext;
    const adapter = { requestDevice: vi.fn(async () => fake.device) } as unknown as GPUAdapter;
    const gpu = {
      requestAdapter: vi.fn(async () => adapter),
      getPreferredCanvasFormat: vi.fn(() => "bgra8unorm"),
    } as unknown as GPU;
    const onFrameReady = vi.fn();
    const onFrameInvalid = vi.fn();
    const engine = new StudioWebGpuEngine({
      canvas: fakeGpuCanvas(context),
      canvas2dCanvas: fakeCanvas2d().canvas,
      gpu,
      onFrameReady,
      onFrameInvalid,
    });
    engine.resize({
      logicalWidth: 100,
      logicalHeight: 80,
      cssWidth: 100,
      cssHeight: 80,
      dpr: 2,
      scaleX: 3,
      scaleY: 3,
    });
    onFrameReady.mockClear();
    await engine.initialize();
    await Promise.resolve();
    onFrameReady.mockClear();
    vi.mocked(fake.device.queue.submit).mockClear();

    engine.render([stroke()], "quality:over-cap");
    await Promise.resolve();

    expect(engine.getBackend()).toBe("webgpu");
    expect(onFrameInvalid).toHaveBeenCalled();
    expect(onFrameReady).not.toHaveBeenCalled();
    expect(fake.device.queue.submit).not.toHaveBeenCalled();
  });

  it("re-rasterizes tiles at the exact presentation density beyond 4x zoom-out", async () => {
    const neverLost = new Promise<GPUDeviceLostInfo>(() => undefined);
    const fake = fakeGpuDevice(neverLost);
    const context = {
      configure: vi.fn(),
      unconfigure: vi.fn(),
      getCurrentTexture: vi.fn(() => ({ createView: vi.fn(() => ({ view: true })) })),
    } as unknown as GPUCanvasContext;
    const adapter = { requestDevice: vi.fn(async () => fake.device) } as unknown as GPUAdapter;
    const gpu = {
      requestAdapter: vi.fn(async () => adapter),
      getPreferredCanvasFormat: vi.fn(() => "bgra8unorm"),
    } as unknown as GPU;
    const onFrameReady = vi.fn((_receipt: StudioGpuFrameReceipt) => undefined);
    const engine = new StudioWebGpuEngine({
      canvas: fakeGpuCanvas(context),
      canvas2dCanvas: fakeCanvas2d().canvas,
      gpu,
      onFrameReady,
    });
    // 10x zoom-out: presentation density 0.1 texel per logical pixel on both axes.
    engine.resize({
      logicalWidth: 2_000,
      logicalHeight: 1_000,
      cssWidth: 200,
      cssHeight: 100,
    });
    await engine.initialize();
    await vi.waitFor(() => expect(onFrameReady).toHaveBeenCalledWith(expect.objectContaining({
      backend: "webgpu",
    })));
    onFrameReady.mockClear();

    engine.render([stroke()], "tiles:zoom-out");
    await vi.waitFor(() => expect(onFrameReady).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "tiles:zoom-out",
      backend: "webgpu",
      complete: true,
    })));
    expect(engine.getBackend()).toBe("webgpu");

    const tileTextureSizes = vi.mocked(fake.device.createTexture).mock.calls
      .map(([descriptor]) => descriptor)
      .filter((descriptor) => String(descriptor.label).startsWith("Studio retained tile "))
      .map((descriptor) => descriptor.size as { width: number; height: number });
    expect(tileTextureSizes.length).toBeGreaterThan(0);
    // A 512-logical tile at the 0.1 presentation scale is 51 content texels plus one bleed texel
    // per side. The old 0.25 raster floor allocated 130x130 here, which the non-mipmapped bilinear
    // presentation sampler then minified 2.5x, causing shimmer on detailed strokes.
    for (const size of tileTextureSizes) {
      expect(size.width).toBe(53);
      expect(size.height).toBe(53);
    }
  });

  it("clamps degenerate near-zero viewport scales at the absolute raster floor", async () => {
    const neverLost = new Promise<GPUDeviceLostInfo>(() => undefined);
    const fake = fakeGpuDevice(neverLost);
    const context = {
      configure: vi.fn(),
      unconfigure: vi.fn(),
      getCurrentTexture: vi.fn(() => ({ createView: vi.fn(() => ({ view: true })) })),
    } as unknown as GPUCanvasContext;
    const adapter = { requestDevice: vi.fn(async () => fake.device) } as unknown as GPUAdapter;
    const gpu = {
      requestAdapter: vi.fn(async () => adapter),
      getPreferredCanvasFormat: vi.fn(() => "bgra8unorm"),
    } as unknown as GPU;
    const onFrameReady = vi.fn((_receipt: StudioGpuFrameReceipt) => undefined);
    const engine = new StudioWebGpuEngine({
      canvas: fakeGpuCanvas(context),
      canvas2dCanvas: fakeCanvas2d().canvas,
      gpu,
      onFrameReady,
    });
    // Raw presentation density 0.0125 sits below STUDIO_GPU_MIN_TILE_RESOLUTION_SCALE (1/64).
    engine.resize({
      logicalWidth: 8_000,
      logicalHeight: 512,
      cssWidth: 100,
      cssHeight: 6,
    });
    await engine.initialize();
    await vi.waitFor(() => expect(onFrameReady).toHaveBeenCalledWith(expect.objectContaining({
      backend: "webgpu",
    })));
    onFrameReady.mockClear();

    engine.render([stroke()], "tiles:raster-floor");
    await vi.waitFor(() => expect(onFrameReady).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "tiles:raster-floor",
      backend: "webgpu",
      complete: true,
    })));

    const tileTextureSizes = vi.mocked(fake.device.createTexture).mock.calls
      .map(([descriptor]) => descriptor)
      .filter((descriptor) => String(descriptor.label).startsWith("Studio retained tile "))
      .map((descriptor) => descriptor.size as { width: number; height: number });
    expect(tileTextureSizes.length).toBeGreaterThan(0);
    // At the 1/64 floor a 512-logical tile keeps 8 content texels plus one bleed texel per side;
    // following the raw 0.0125 scale would collapse it to 6 (and near-zero scales to 1).
    for (const size of tileTextureSizes) {
      expect(size.width).toBe(10);
      expect(size.height).toBe(10);
    }
  });

  it("fails closed for empty or wholly non-finite strokes instead of approving a blank tile frame", async () => {
    const neverLost = new Promise<GPUDeviceLostInfo>(() => undefined);
    const fake = fakeGpuDevice(neverLost);
    const context = {
      configure: vi.fn(),
      unconfigure: vi.fn(),
      getCurrentTexture: vi.fn(() => ({ createView: vi.fn(() => ({ view: true })) })),
    } as unknown as GPUCanvasContext;
    const adapter = { requestDevice: vi.fn(async () => fake.device) } as unknown as GPUAdapter;
    const gpu = {
      requestAdapter: vi.fn(async () => adapter),
      getPreferredCanvasFormat: vi.fn(() => "bgra8unorm"),
    } as unknown as GPU;
    const onFrameReady = vi.fn();
    const gpuSurface = fakeGpuCanvas(context);
    const canvas2d = fakeCanvas2d();
    const engine = new StudioWebGpuEngine({
      canvas: gpuSurface,
      canvas2dCanvas: canvas2d.canvas,
      gpu,
      onFrameReady,
    });
    engine.resize({ logicalWidth: 100, logicalHeight: 80 });
    await engine.initialize();
    await vi.waitFor(() => expect(onFrameReady).toHaveBeenCalled());
    onFrameReady.mockClear();

    expect(isValidStudioGpuStroke(stroke({ points: [] }))).toBe(false);
    expect(isValidStudioGpuStroke(stroke({
      points: [Number.NaN, Number.NaN, Number.POSITIVE_INFINITY, 0],
    }))).toBe(false);
    engine.render([stroke({ points: [] })], "invalid:empty");
    await vi.waitFor(() => expect(engine.isBackendAvailable()).toBe(false));

    expect(onFrameReady).not.toHaveBeenCalled();
    expect(engine.getBackend()).toBe("webgpu");
    expect(canvas2d.arcs).toHaveLength(0);
    expect(gpuSurface.style.visibility).toBe("hidden");
    expect(canvas2d.canvas.style.visibility).toBe("hidden");
  });

  it("keeps initialize idempotent once a live WebGPU device is installed", async () => {
    const neverLost = new Promise<GPUDeviceLostInfo>(() => undefined);
    const fake = fakeGpuDevice(neverLost);
    const context = {
      configure: vi.fn(),
      unconfigure: vi.fn(),
      getCurrentTexture: vi.fn(() => ({ createView: vi.fn(() => ({ view: true })) })),
    } as unknown as GPUCanvasContext;
    const adapter = { requestDevice: vi.fn(async () => fake.device) } as unknown as GPUAdapter;
    const gpu = {
      requestAdapter: vi.fn(async () => adapter),
      getPreferredCanvasFormat: vi.fn(() => "bgra8unorm"),
    } as unknown as GPU;
    const engine = new StudioWebGpuEngine({
      canvas: fakeGpuCanvas(context),
      canvas2dCanvas: fakeCanvas2d().canvas,
      gpu,
    });

    await expect(engine.initialize()).resolves.toBe("webgpu");
    await expect(engine.initialize()).resolves.toBe("webgpu");

    expect(gpu.requestAdapter).toHaveBeenCalledTimes(1);
    expect(adapter.requestDevice).toHaveBeenCalledTimes(1);
    expect(fake.device.destroy).not.toHaveBeenCalled();
  });

  it("coalesces concurrent initialization and requests the quality-first GPU adapter", async () => {
    const neverLost = new Promise<GPUDeviceLostInfo>(() => undefined);
    const requestedDevice = deferred<GPUDevice>();
    const fake = fakeGpuDevice(neverLost);
    const context = {
      configure: vi.fn(),
      unconfigure: vi.fn(),
      getCurrentTexture: vi.fn(() => ({ createView: vi.fn(() => ({ view: true })) })),
    } as unknown as GPUCanvasContext;
    const adapter = {
      requestDevice: vi.fn(() => requestedDevice.promise),
    } as unknown as GPUAdapter;
    const gpu = {
      requestAdapter: vi.fn(async () => adapter),
      getPreferredCanvasFormat: vi.fn(() => "bgra8unorm"),
    } as unknown as GPU;
    const engine = new StudioWebGpuEngine({
      canvas: fakeGpuCanvas(context),
      canvas2dCanvas: fakeCanvas2d().canvas,
      gpu,
    });

    const first = engine.initialize();
    const second = engine.initialize();

    expect(second).toBe(first);
    expect(gpu.requestAdapter).toHaveBeenCalledTimes(1);
    expect(vi.mocked(gpu.requestAdapter).mock.calls[0]).toEqual([
      { powerPreference: "high-performance" },
    ]);
    await vi.waitFor(() => expect(adapter.requestDevice).toHaveBeenCalledTimes(1));

    requestedDevice.resolve(fake.device);

    await expect(Promise.all([first, second])).resolves.toEqual(["webgpu", "webgpu"]);
    expect(fake.device.destroy).not.toHaveBeenCalled();
  });

  it("allows a later adapter retry without replaying the initialization-failed operation", async () => {
    const neverLost = new Promise<GPUDeviceLostInfo>(() => undefined);
    const fake = fakeGpuDevice(neverLost);
    const context = {
      configure: vi.fn(),
      unconfigure: vi.fn(),
      getCurrentTexture: vi.fn(() => ({ createView: vi.fn(() => ({ view: true })) })),
    } as unknown as GPUCanvasContext;
    const adapter = {
      requestDevice: vi.fn(async () => fake.device),
    } as unknown as GPUAdapter;
    let adapterAttempt = 0;
    const gpu = {
      requestAdapter: vi.fn(async () => {
        adapterAttempt += 1;
        return adapterAttempt === 1 ? null : adapter;
      }),
      getPreferredCanvasFormat: vi.fn(() => "bgra8unorm"),
    } as unknown as GPU;
    const onFrameReady = vi.fn();
    const engine = new StudioWebGpuEngine({
      canvas: fakeGpuCanvas(context),
      canvas2dCanvas: fakeCanvas2d().canvas,
      gpu,
      onFrameReady,
    });

    engine.render([stroke({ id: "failed-initialization" })], "init:failed-operation");
    await expect(engine.initialize()).resolves.toBe("webgpu");
    expect(engine.isBackendAvailable()).toBe(false);
    await expect(engine.initialize()).resolves.toBe("webgpu");

    expect(gpu.requestAdapter).toHaveBeenCalledTimes(2);
    expect(adapter.requestDevice).toHaveBeenCalledTimes(1);
    expect(engine.getBackend()).toBe("webgpu");
    expect(engine.isBackendAvailable()).toBe(true);
    expect(fake.device.queue.submit).not.toHaveBeenCalled();
    expect(onFrameReady).not.toHaveBeenCalled();
  });
});

describe("planStudioGpuDabs", () => {
  it("keeps V3 corner dabs on-path and appends only the retained suffix", () => {
    const pressureModel = STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_PATH_V3;
    const initial = stroke({
      points: [0, 0, 4, 0],
      pressures: [1, 1],
      size: 16,
      pressureModel,
    });
    const extended = stroke({
      points: [0, 0, 4, 0, 4, 4, 8, 4],
      pressures: [1, 1, 1, 1],
      size: 16,
      pressureModel,
    });
    const subdivided = stroke({
      points: [0, 0, 2, 0, 4, 0, 4, 2, 4, 4, 6, 4, 8, 4],
      pressures: Array.from({ length: 7 }, () => 1),
      size: 16,
      pressureModel,
    });
    const retained = planStudioGpuDabs([initial]);
    const complete = planStudioGpuDabs([extended]);
    const fine = planStudioGpuDabs([subdivided]);
    const append = planStudioGpuDabUpdate([initial], [extended]);
    const tiled = planStudioGpuStrokeExtensionInRect(
      extended,
      initial.points.length / 2,
      { x: -100, y: -100, width: 300, height: 300 }
    );
    const rounded = (dabs: typeof complete.dabs) => dabs.map(({ x, y, radius }) => ({
      x: Number(x.toFixed(10)),
      y: Number(y.toFixed(10)),
      radius: Number(radius.toFixed(10)),
    }));

    expect(complete.complete).toBe(true);
    expect(rounded(complete.dabs)).toEqual([
      { x: 0, y: 0, radius: 8 },
      { x: 3.2, y: 0, radius: 8 },
      { x: 4, y: 2.4, radius: 8 },
      { x: 5.6, y: 4, radius: 8 },
    ]);
    expect(rounded(fine.dabs)).toEqual(rounded(complete.dabs));
    expect(append.mode).toBe("append");
    expect(rounded(retained.dabs.concat(append.dabs))).toEqual(rounded(complete.dabs));
    expect(rounded(tiled.dabs)).toEqual(rounded(append.dabs));
    expect(fingerprintStudioGpuFrame([extended], {
      logicalWidth: 100,
      logicalHeight: 80,
    }, 100, 80)).not.toBe(fingerprintStudioGpuFrame([{
      ...extended,
      pressureModel: STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_V2,
    }], {
      logicalWidth: 100,
      logicalHeight: 80,
    }, 100, 80));
  });

  it("matches V3 variable-pressure planning across coarse and dense source samples", () => {
    const pressureModel = STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_PATH_V3;
    const coarse = planStudioGpuDabs([stroke({
      points: [0, 0, 20, 0],
      pressures: [0.25, 1],
      size: 16,
      pressureModel,
    })]);
    const fine = planStudioGpuDabs([stroke({
      points: [0, 0, 5, 0, 10, 0, 15, 0, 20, 0],
      pressures: [0.25, 0.4375, 0.625, 0.8125, 1],
      size: 16,
      pressureModel,
    })]);

    expect(fine.dabs).toHaveLength(coarse.dabs.length);
    fine.dabs.forEach((dab, index) => {
      expect(dab.x).toBeCloseTo(coarse.dabs[index]!.x, 11);
      expect(dab.radius).toBeCloseTo(coarse.dabs[index]!.radius, 11);
    });
  });

  it("uses Magma residual placement for V2 regardless of source subdivision", () => {
    const pressureModel = STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_V2;
    const subdivided = planStudioGpuDabs([stroke({
      points: Array.from({ length: 13 }, (_, index) => [index, 0]).flat(),
      pressures: Array.from({ length: 13 }, () => 1),
      size: 16,
      pressureModel,
    })]);
    const singleSegment = planStudioGpuDabs([stroke({
      points: [0, 0, 12, 0],
      pressures: [1, 1],
      size: 16,
      pressureModel,
    })]);

    expect(subdivided.complete).toBe(true);
    expect(subdivided.dabs.map(({ x }) => x)).toEqual([0, 3.2, 6.4, 9.600000000000001]);
    expect(singleSegment.dabs).toEqual(subdivided.dabs);
  });

  it("appends only the exact residual V2 suffix for full-frame and tiled feeds", () => {
    const pressureModel = STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_V2;
    const initial = stroke({
      points: [0, 0, 1, 0, 2, 0, 3, 0, 4, 0, 5, 0],
      pressures: [1, 1, 1, 1, 1, 1],
      size: 16,
      pressureModel,
    });
    const extended = stroke({
      points: [0, 0, 1, 0, 2, 0, 3, 0, 4, 0, 5, 0, 6, 0, 7, 0, 8, 0, 9, 0, 10, 0, 11, 0, 12, 0],
      pressures: Array.from({ length: 13 }, () => 1),
      size: 16,
      pressureModel,
    });
    const retained = planStudioGpuDabs([initial]);
    const complete = planStudioGpuDabs([extended]);
    const append = planStudioGpuDabUpdate([initial], [extended]);
    const tiled = planStudioGpuStrokeExtensionInRect(
      extended,
      initial.points.length / 2,
      { x: -100, y: -100, width: 300, height: 300 }
    );

    expect(append.mode).toBe("append");
    expect(retained.dabs.concat(append.dabs)).toEqual(complete.dabs);
    expect(append.dabs.map(({ x }) => x)).toEqual([6.4, 9.600000000000001]);
    expect(tiled).toEqual({
      complete: true,
      dabs: append.dabs,
      batches: append.batches,
    });
  });

  it("keeps dabs/batches paired when a residual V2 extension is cut short by the dab budget", () => {
    // Regression: the truncated-by-budget early returns used to pair non-empty dabs with an
    // empty batches array, unlike the legacy planner which always commits a trailing batch for
    // whatever dabs it already pushed. No current caller reads a partial (complete:false) result,
    // but the pairing itself must stay internally consistent for any future caller that does.
    const pressureModel = STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_V2;
    const extended = stroke({
      points: [0, 0, 4, 0, 8, 0, 12, 0, 16, 0, 20, 0],
      pressures: Array.from({ length: 6 }, () => 1),
      size: 16,
      pressureModel,
    });
    const truncated = planStudioGpuStrokeExtensionInRect(
      extended,
      1,
      { x: -100, y: -100, width: 300, height: 300 },
      2
    );

    expect(truncated.complete).toBe(false);
    expect(truncated.dabs.length).toBeGreaterThan(0);
    expect(truncated.batches).toEqual([
      { composite: "normal", firstInstance: 0, instanceCount: truncated.dabs.length },
    ]);
  });

  it("plans only the bridge and new samples for a retained point suffix", () => {
    const initial = stroke({
      points: [0, 0, 20, 0],
      pressures: [0.5, 0.6],
    });
    const extended = stroke({
      points: [0, 0, 20, 0, 40, 0],
      pressures: [0.5, 0.6, 0.8],
    });
    const expected = planStudioGpuDabUpdate([initial], [extended]);
    const planned = planStudioGpuStrokeExtensionInRect(
      extended,
      2,
      { x: -100, y: -100, width: 300, height: 300 }
    );

    expect(planned).toEqual({
      complete: true,
      dabs: expected.dabs,
      batches: expected.batches,
    });
    expect(planned.dabs[0]?.x).toBeGreaterThan(20);
    expect(planned.dabs.at(-1)?.x).toBe(40);
  });

  it("fails closed instead of looping on finite endpoints whose segment math overflows", () => {
    const overflowingSegment = planStudioGpuDabs([
      stroke({
        points: [-Number.MAX_VALUE, 0, Number.MAX_VALUE, 0],
        pressures: [0.5, 0.5],
      }),
    ]);
    const overflowingRadius = planStudioGpuDabs([
      stroke({ size: Number.MAX_VALUE }),
    ]);

    expect(overflowingSegment.complete).toBe(false);
    expect(overflowingSegment.dabs).toHaveLength(0);
    expect(overflowingRadius).toMatchObject({ complete: false, dabs: [] });
  });

  it("reports incomplete coverage instead of authorizing a silently truncated frame", () => {
    const planned = planStudioGpuDabs([
      stroke({
        size: 1,
        points: [0, 0, 50_001, 0],
        pressures: [1, 1],
      }),
    ]);

    expect(planned.complete).toBe(false);
    expect(planned.dabs).toHaveLength(STUDIO_GPU_MAX_DABS);
  });

  it("fails closed at the V2 residual cap instead of authorizing blank GPU coverage", () => {
    const planned = planStudioGpuDabs([stroke({
      points: [0, 0, 50_001, 0],
      pressures: [1, 1],
      size: 1,
      pressureModel: STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_V2,
    })]);

    expect(planned.complete).toBe(false);
    // V2 discards the partial operation atomically; `complete:false` prevents frame authority.
    expect(planned.dabs).toHaveLength(0);
  });

  it("uses locale-independent operation order and color-independent erase coverage", () => {
    const planned = planStudioGpuDabs([
      stroke({ id: "umlaut", orderKey: "ä", points: [20, 0], color: "#ff0000" }),
      stroke({ id: "ascii", orderKey: "z", points: [10, 0], color: "#00ff00" }),
      stroke({
        id: "transparent-eraser",
        orderKey: "🙂",
        points: [30, 0],
        color: "transparent",
        opacity: 0.6,
        composite: "erase",
      }),
    ]);

    expect(planned.dabs.map(({ x }) => x)).toEqual([10, 20, 30]);
    expect(planned.dabs.at(-1)).toMatchObject({
      composite: "erase",
      alpha: 0.6,
    });
  });

  it("covers a segment with pressure-aware round dabs and deterministic batches", () => {
    const planned = planStudioGpuDabs([
      stroke({ id: "later", orderKey: "b", points: [0, 0, 12, 0] }),
      stroke({ id: "first", orderKey: "a", points: [0, 10, 12, 10], composite: "erase" }),
    ]);

    expect(planned.dabs.length).toBeGreaterThan(8);
    expect(planned.dabs[0]).toMatchObject({ x: 0, y: 10, composite: "erase" });
    expect(planned.dabs.at(-1)).toMatchObject({ x: 12, y: 0, composite: "normal" });
    expect(planned.batches.map((batch) => batch.composite)).toEqual(["erase", "normal"]);
    expect(planned.dabs[0]!.radius).toBeLessThan(planned.dabs.find((dab) => dab.x === 12 && dab.y === 10)!.radius);
  });

  it("plans only a strict compatible suffix and rebuilds replaced prediction tails", () => {
    const initial = stroke({
      points: [0, 0, 10, 0, 20, 0],
      pressures: [0.4, 0.5, 0.6],
    });
    const extended = stroke({
      points: [0, 0, 10, 0, 20, 0, 24, 2],
      pressures: [0.4, 0.5, 0.6, 0.8],
    });
    const initialPlan = planStudioGpuDabs([initial]);
    const fullExtendedPlan = planStudioGpuDabs([extended]);
    const append = planStudioGpuDabUpdate([initial], [extended]);

    expect(append.mode).toBe("append");
    expect(append.dabs.length).toBeLessThan(initialPlan.dabs.length);
    expect(initialPlan.dabs.concat(append.dabs)).toEqual(fullExtendedPlan.dabs);

    const predictionReplaced = stroke({
      points: [0, 0, 10, 0, 19, 1, 24, 2],
      pressures: [0.4, 0.5, 0.6, 0.8],
    });
    const rebuild = planStudioGpuDabUpdate([extended], [predictionReplaced]);
    expect(rebuild.mode).toBe("rebuild");
    expect(rebuild.dabs).toEqual(planStudioGpuDabs([predictionReplaced]).dabs);
  });

  it("appends deterministic normal/erase operation-log suffixes and rebuilds reordered history", () => {
    const ink = stroke({ id: "ink", orderKey: "a" });
    const eraser = stroke({
      id: "eraser",
      orderKey: "b",
      points: [8, 10, 18, 10],
      composite: "erase",
    });
    const appendEraser = planStudioGpuDabUpdate([ink], [ink, eraser]);

    expect(appendEraser.mode).toBe("append");
    expect(appendEraser.dabs).toEqual(planStudioGpuDabs([eraser]).dabs);
    expect(appendEraser.batches.map((batch) => batch.composite)).toEqual(["erase"]);
    expect(planStudioGpuDabs([ink]).dabs.concat(appendEraser.dabs)).toEqual(
      planStudioGpuDabs([ink, eraser]).dabs
    );

    const insertedBefore = stroke({ id: "inserted", orderKey: "0", points: [0, 20, 5, 20] });
    const reordered = planStudioGpuDabUpdate([ink], [ink, insertedBefore]);
    expect(reordered.mode).toBe("rebuild");
    expect(reordered.dabs).toEqual(planStudioGpuDabs([insertedBefore, ink]).dabs);
  });

  it("extends only the terminal live stroke after immutable completed operations", () => {
    const completed = stroke({ id: "completed", orderKey: "a", points: [0, 10, 10, 10] });
    const live = stroke({
      id: "live",
      orderKey: "b",
      points: [0, 20, 10, 20],
      pressures: [0.4, 0.5],
    });
    const extended = stroke({
      id: "live",
      orderKey: "b",
      points: [0, 20, 10, 20, 16, 22],
      pressures: [0.4, 0.5, 0.8],
    });
    const append = planStudioGpuDabUpdate([completed, live], [completed, extended]);

    expect(append.mode).toBe("append");
    expect(planStudioGpuDabs([completed, live]).dabs.concat(append.dabs)).toEqual(
      planStudioGpuDabs([completed, extended]).dabs
    );
  });
});
