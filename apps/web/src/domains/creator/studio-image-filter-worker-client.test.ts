import { describe, expect, it, vi } from "vitest";

import { applyImageFilters, buildImageFilters, registerStudioKonvaFilters, type KonvaLike } from "./render/studio-konva-filters";
import {
  createStudioImageFilterResidentWorkerSession,
  createStudioImageFilterWorkerSession,
  runStudioImageFilterWorker,
  type StudioImageFilterWorkerLike,
} from "./studio-image-filter-worker-client";
import {
  studioImageFilterSourceSuccessTransfers,
  studioImageFilterSuccessTransfers,
  type StudioImageFilterWorkerLoadSourceMessage,
  type StudioImageFilterWorkerRequestMessage,
  type StudioImageFilterWorkerResponseMessage,
  type StudioImageFilterWorkerRunMessage,
  type StudioImageFilterWorkerRunRequest,
  type StudioImageFilterWorkerRunSourceMessage,
  type StudioImageFilterWorkerSourceSuccessMessage,
  type StudioImageFilterWorkerSuccessMessage,
} from "./studio-image-filter-worker-protocol";

import type { ImageFilterFields } from "./render/studio-konva-filter-fields";

function makeImageData(width: number, height: number): { data: Uint8ClampedArray; width: number; height: number } {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 40;
    data[i + 1] = 80;
    data[i + 2] = 120;
    data[i + 3] = 255;
  }
  return { data, width, height };
}

function requestFixture(el: ImageFilterFields = { brightness: 0.3, contrast: 20 }): StudioImageFilterWorkerRunRequest {
  return { imageData: makeImageData(3, 2), el };
}

const testRegistry: KonvaLike = { Filters: {} };
registerStudioKonvaFilters(testRegistry);

function expectedPixels(el: ImageFilterFields): Uint8ClampedArray {
  const image = makeImageData(3, 2);
  const { filters, attrs } = buildImageFilters(el, testRegistry);
  applyImageFilters(image, filters, attrs);
  return image.data;
}

class ApplyingWorker implements StudioImageFilterWorkerLike {
  onmessage: StudioImageFilterWorkerLike["onmessage"] = null;
  onerror: StudioImageFilterWorkerLike["onerror"] = null;
  terminateCount = 0;
  requestTransferCount = 0;

  constructor() {
    queueMicrotask(() => {
      this.onmessage?.({
        data: { type: "studio-image-filter/ready", version: 1 },
      } as MessageEvent<StudioImageFilterWorkerResponseMessage>);
    });
  }

  postMessage(message: StudioImageFilterWorkerRunMessage, transfer: Transferable[]): void {
    this.requestTransferCount = transfer.length;
    const received = structuredClone(message, { transfer });
    queueMicrotask(() => {
      if (this.terminateCount > 0) return;
      const { filters, attrs } = buildImageFilters(received.request.el, testRegistry, "worker");
      applyImageFilters(received.request.imageData, filters, attrs);
      const response: StudioImageFilterWorkerSuccessMessage = {
        type: "studio-image-filter/success",
        version: received.version,
        imageData: received.request.imageData,
      };
      const returned = structuredClone(response, { transfer: studioImageFilterSuccessTransfers(response) });
      this.onmessage?.({ data: returned } as MessageEvent<StudioImageFilterWorkerResponseMessage>);
    });
  }

  terminate(): void {
    this.terminateCount++;
  }
}

class CapturingApplyingWorker extends ApplyingWorker {
  postedEl: ImageFilterFields | null = null;

  override postMessage(message: StudioImageFilterWorkerRunMessage, transfer: Transferable[]): void {
    this.postedEl = message.request.el;
    super.postMessage(message, transfer);
  }
}

class HangingWorker implements StudioImageFilterWorkerLike {
  onmessage: StudioImageFilterWorkerLike["onmessage"] = null;
  onerror: StudioImageFilterWorkerLike["onerror"] = null;
  terminateCount = 0;

  constructor(emitReady = true) {
    if (emitReady) {
      queueMicrotask(() => {
        this.onmessage?.({
          data: { type: "studio-image-filter/ready", version: 1 },
        } as MessageEvent<StudioImageFilterWorkerResponseMessage>);
      });
    }
  }

  postMessage(_message: StudioImageFilterWorkerRunMessage, _transfer: Transferable[]): void {}

  terminate(): void {
    this.terminateCount++;
  }
}

class ThrowingPostWorker extends HangingWorker {
  override postMessage(): void {
    throw new DOMException("blocked", "DataCloneError");
  }
}

class FailingWorker extends HangingWorker {
  override postMessage(): void {
    queueMicrotask(() => {
      this.onmessage?.({
        data: {
          type: "studio-image-filter/failure",
          version: 1,
          error: { name: "RangeError", message: "boom" },
        },
      } as MessageEvent<StudioImageFilterWorkerResponseMessage>);
    });
  }
}

class LoadErrorWorker extends HangingWorker {
  constructor() {
    super(false);
    queueMicrotask(() => {
      this.onerror?.({ message: "worker chunk failed to load" });
    });
  }
}

class ImmediateApplyingWorker extends HangingWorker {
  override postMessage(message: StudioImageFilterWorkerRunMessage, transfer: Transferable[]): void {
    const received = structuredClone(message, { transfer });
    const { filters, attrs } = buildImageFilters(received.request.el, testRegistry, "worker");
    applyImageFilters(received.request.imageData, filters, attrs);
    this.onmessage?.({
      data: {
        type: "studio-image-filter/success",
        version: 1,
        imageData: received.request.imageData,
      },
    } as MessageEvent<StudioImageFilterWorkerResponseMessage>);
  }
}

class InvalidSuccessWorker extends HangingWorker {
  override postMessage(): void {
    queueMicrotask(() => {
      this.onmessage?.({
        data: {
          type: "studio-image-filter/success",
          version: 1,
          imageData: { data: new Uint8ClampedArray(4), width: 2, height: 2 },
        },
      } as MessageEvent<StudioImageFilterWorkerResponseMessage>);
    });
  }
}

class ResidentApplyingWorker implements StudioImageFilterWorkerLike {
  onmessage: StudioImageFilterWorkerLike["onmessage"] = null;
  onerror: StudioImageFilterWorkerLike["onerror"] = null;
  terminateCount = 0;
  loadCount = 0;
  runCount = 0;
  readonly transfers: number[] = [];
  readonly messages: StudioImageFilterWorkerRequestMessage[] = [];
  private source: {
    data: Uint8ClampedArray;
    height: number;
    sourceGeneration: number;
    sourceId: string;
    width: number;
  } | null = null;

  constructor() {
    queueMicrotask(() => {
      this.onmessage?.({
        data: { type: "studio-image-filter/ready", version: 1 },
      } as MessageEvent<StudioImageFilterWorkerResponseMessage>);
    });
  }

  postMessage(message: StudioImageFilterWorkerRequestMessage, transfer: Transferable[]): void {
    this.transfers.push(transfer.length);
    const received = structuredClone(message, { transfer });
    this.messages.push(received);
    if (received.type === "studio-image-filter/load-source") {
      this.loadCount++;
      this.source = {
        data: received.imageData.data,
        height: received.imageData.height,
        sourceGeneration: received.sourceGeneration,
        sourceId: received.sourceId,
        width: received.imageData.width,
      };
      queueMicrotask(() => {
        this.onmessage?.({
          data: {
            type: "studio-image-filter/source-loaded",
            version: 1,
            sourceId: received.sourceId,
            sourceGeneration: received.sourceGeneration,
          },
        } as MessageEvent<StudioImageFilterWorkerResponseMessage>);
      });
      return;
    }
    if (received.type !== "studio-image-filter/run-source") {
      throw new Error(`Unexpected resident request: ${received.type}`);
    }
    this.runCount++;
    const source = this.source;
    queueMicrotask(() => {
      if (
        !source
        || source.sourceId !== received.sourceId
        || source.sourceGeneration !== received.sourceGeneration
      ) {
        this.onmessage?.({
          data: {
            type: "studio-image-filter/source-failure",
            version: 1,
            sourceId: received.sourceId,
            sourceGeneration: received.sourceGeneration,
            requestId: received.requestId,
            error: { name: "Error", message: "source mismatch" },
          },
        } as MessageEvent<StudioImageFilterWorkerResponseMessage>);
        return;
      }
      const imageData = {
        data: new Uint8ClampedArray(source.data),
        height: source.height,
        width: source.width,
      };
      const { filters, attrs } = buildImageFilters(received.el, testRegistry, "worker");
      applyImageFilters(imageData, filters, attrs);
      const response: StudioImageFilterWorkerSourceSuccessMessage = {
        type: "studio-image-filter/source-success",
        version: 1,
        sourceId: received.sourceId,
        sourceGeneration: received.sourceGeneration,
        requestId: received.requestId,
        imageData,
      };
      const returned = structuredClone(response, {
        transfer: studioImageFilterSourceSuccessTransfers(response),
      });
      this.onmessage?.({ data: returned } as MessageEvent<StudioImageFilterWorkerResponseMessage>);
    });
  }

  terminate(): void {
    this.terminateCount++;
  }
}

class ManualResidentWorker implements StudioImageFilterWorkerLike {
  onmessage: StudioImageFilterWorkerLike["onmessage"] = null;
  onerror: StudioImageFilterWorkerLike["onerror"] = null;
  terminateCount = 0;
  readonly messages: StudioImageFilterWorkerRequestMessage[] = [];

  constructor() {
    queueMicrotask(() => {
      this.onmessage?.({
        data: { type: "studio-image-filter/ready", version: 1 },
      } as MessageEvent<StudioImageFilterWorkerResponseMessage>);
    });
  }

  postMessage(message: StudioImageFilterWorkerRequestMessage, _transfer: Transferable[]): void {
    this.messages.push(message);
  }

  emitSourceLoaded(message: StudioImageFilterWorkerLoadSourceMessage): void {
    this.onmessage?.({
      data: {
        type: "studio-image-filter/source-loaded",
        version: 1,
        sourceId: message.sourceId,
        sourceGeneration: message.sourceGeneration,
      },
    } as MessageEvent<StudioImageFilterWorkerResponseMessage>);
  }

  emitSuccess(
    message: StudioImageFilterWorkerRunSourceMessage,
    overrides: Partial<Pick<
      StudioImageFilterWorkerSourceSuccessMessage,
      "requestId" | "sourceGeneration" | "sourceId"
    >> = {},
  ): void {
    this.onmessage?.({
      data: {
        type: "studio-image-filter/source-success",
        version: 1,
        sourceId: overrides.sourceId ?? message.sourceId,
        sourceGeneration: overrides.sourceGeneration ?? message.sourceGeneration,
        requestId: overrides.requestId ?? message.requestId,
        imageData: makeImageData(3, 2),
      },
    } as MessageEvent<StudioImageFilterWorkerResponseMessage>);
  }

  terminate(): void {
    this.terminateCount++;
  }
}

describe("runStudioImageFilterWorker", () => {
  it("runs direct only when the caller explicitly selects the independent direct mode", async () => {
    const request = requestFixture();
    const expected = expectedPixels(request.el);

    const output = await runStudioImageFilterWorker(request, { executionMode: "direct" });

    expect(output.execution).toBe("direct");
    expect(Array.from(output.imageData.data)).toEqual(Array.from(expected));
  });

  it.each([
    ["worker unavailable", null],
    ["worker postMessage failure", () => new ThrowingPostWorker()],
  ] as const)("%s rejects without running an expensive advanced blur on the main thread", async (
    _label,
    workerFactory,
  ) => {
    const width = 50_000;
    const request: StudioImageFilterWorkerRunRequest = {
      imageData: makeImageData(width, 1),
      el: {
        lensBlur: {
          radius: 4,
          sampleCount: 21,
          apertureBlades: 6,
          apertureRotationRadians: 0,
        },
      },
    };

    await expect(runStudioImageFilterWorker(request, { workerFactory }))
      .rejects.toMatchObject({ name: "StudioImageFilterWorkerUnavailableError" });
  });

  it.each([
    ["worker unavailable", null],
    ["worker postMessage failure", () => new ThrowingPostWorker()],
  ] as const)("%s rejects without running an expensive professional filter on the main thread", async (
    _label,
    workerFactory,
  ) => {
    const width = 120_000;
    const request: StudioImageFilterWorkerRunRequest = {
      imageData: makeImageData(width, 1),
      el: {
        dustScratches: { radius: 2, threshold: 24, strength: 1 },
      },
    };

    await expect(runStudioImageFilterWorker(request, { workerFactory }))
      .rejects.toMatchObject({ name: "StudioImageFilterWorkerUnavailableError" });
  });

  it.each([
    ["worker unavailable", null],
    ["worker postMessage failure", () => new ThrowingPostWorker()],
  ] as const)("%s rejects without running expensive tone cleanup on the main thread", async (
    _label,
    workerFactory,
  ) => {
    const width = 400_000;
    const request: StudioImageFilterWorkerRunRequest = {
      imageData: makeImageData(width, 1),
      el: {
        screentoneRemoval: { radius: 2, strength: 1, inkLumaThreshold: 72 },
      },
    };

    await expect(runStudioImageFilterWorker(request, { workerFactory }))
      .rejects.toMatchObject({ name: "StudioImageFilterWorkerUnavailableError" });
  });

  it("projects an element-shaped source before direct execution and reads each filter field once", async () => {
    const el = {} as ImageFilterFields;
    let brightnessReads = 0;
    const unrelatedGetter = vi.fn(() => {
      throw new Error("unrelated metadata must not be read");
    });
    Object.defineProperties(el, {
      brightness: {
        enumerable: true,
        get: () => {
          brightnessReads++;
          return 0.3;
        },
      },
      provenance: { enumerable: true, get: unrelatedGetter },
    });
    const request = requestFixture(el);
    const expected = expectedPixels({ brightness: 0.3 });

    const output = await runStudioImageFilterWorker(request, { executionMode: "direct" });

    expect(output.execution).toBe("direct");
    expect(brightnessReads).toBe(1);
    expect(unrelatedGetter).not.toHaveBeenCalled();
    expect(Array.from(output.imageData.data)).toEqual(Array.from(expected));
  });

  it("skips over Konva-native filters (Blur/HSL) too via the direct path", async () => {
    const el: ImageFilterFields = { blur: 4, saturation: 0.5, hue: 90 };
    const request = requestFixture(el);
    const expected = expectedPixels(el);

    const output = await runStudioImageFilterWorker(request, { executionMode: "direct" });

    expect(Array.from(output.imageData.data)).toEqual(Array.from(expected));
  });

  it("transfers imageData ownership and returns worker-computed pixels matching the direct path", async () => {
    const request = requestFixture({ screentone: true, chromatic: 3 });
    const expected = expectedPixels(request.el);
    const worker = new ApplyingWorker();

    const pending = runStudioImageFilterWorker(request, { workerFactory: () => worker });
    await Promise.resolve();
    expect(request.imageData.data.byteLength).toBe(0);

    const output = await pending;
    expect(output.execution).toBe("worker");
    expect(worker.requestTransferCount).toBe(1);
    expect(worker.terminateCount).toBe(1);
    expect(Array.from(output.imageData.data)).toEqual(Array.from(expected));
  });

  it("preserves deterministic union-wave fields and matches direct pixels in the Worker path", async () => {
    const el: ImageFilterFields = {
      filterUnionWave: {
        kind: "film-grain-pro",
        amount: 48,
        scale: 1,
        detail: 50,
        seed: 4242,
        centerX: 50,
        centerY: 50,
        angle: 0,
      },
    };
    const request = requestFixture(el);
    const expected = expectedPixels(el);
    const worker = new ApplyingWorker();

    const output = await runStudioImageFilterWorker(request, {
      workerFactory: () => worker,
    });

    expect(output.execution).toBe("worker");
    expect(Array.from(output.imageData.data)).toEqual(Array.from(expected));
    expect(Array.from(output.imageData.data)).not.toEqual(
      Array.from(makeImageData(3, 2).data),
    );
  });

  it("copies a partial ArrayBuffer view so unrelated caller bytes and sibling views are not detached", async () => {
    const backing = new ArrayBuffer(40);
    const pixels = new Uint8ClampedArray(backing, 8, 24);
    pixels.set(makeImageData(3, 2).data);
    const sibling = new Uint8Array(backing, 0, 4);
    sibling.set([9, 8, 7, 6]);
    const worker = new ApplyingWorker();

    const output = await runStudioImageFilterWorker(
      { imageData: { data: pixels, width: 3, height: 2 }, el: { brightness: 0.3 } },
      { workerFactory: () => worker },
    );

    expect(output.execution).toBe("worker");
    expect(backing.byteLength).toBe(40);
    expect(Array.from(sibling)).toEqual([9, 8, 7, 6]);
    expect(worker.requestTransferCount).toBe(1);
  });

  it("accepts a synchronous worker result without misclassifying it as a pre-ready race", async () => {
    const output = await runStudioImageFilterWorker(requestFixture(), {
      workerFactory: () => new ImmediateApplyingWorker(),
    });

    expect(output.execution).toBe("worker");
  });

  it("strips browser lifecycle helpers instead of falling back from DataCloneError", async () => {
    const request = requestFixture();
    Object.assign(request.imageData, { release() {} });
    const worker = new ApplyingWorker();

    const output = await runStudioImageFilterWorker(request, { workerFactory: () => worker });

    expect(output.execution).toBe("worker");
    expect(worker.requestTransferCount).toBe(1);
  });

  it("posts only ImageFilterFields when the caller passes a full Studio element", async () => {
    const unrelatedGetter = vi.fn(() => {
      throw new Error("unrelated metadata must not be cloned");
    });
    const el = {
      brightness: 0.3,
      contrast: 20,
      exposureAdjustment: { exposure: 1, gamma: 0.9, offset: 0.02 },
      unsharpMask: { amount: 0.8, radius: 2, threshold: 8 },
      morphology: { mode: "erode", radius: 1 },
      pixelOffset: { x: 2, y: -1, edge: "wrap" },
      convolution: { kernel: [0, -1, 0, -1, 5, -1, 0, -1, 0], divisor: 1, bias: 0 },
      clouds: { amount: 0.2, scale: 64, seed: 42, mode: "overlay" },
      lineCleanup: { threshold: 0.6, strength: 0.5 },
      screentoneRemoval: { radius: 2, strength: 0.88, inkLumaThreshold: 72 },
      jpegArtifactReduction: {
        deblockStrength: 0.72,
        deringStrength: 0.45,
        boundaryThreshold: 6,
        protectedEdgeThreshold: 88,
        ringingThreshold: 18,
        inkLumaThreshold: 64,
      },
      edgeAwareDenoise: { radius: 1, strength: 0.78, rangeThreshold: 72 },
      lensBlur: {
        radius: 4,
        sampleCount: 21,
        apertureBlades: 6,
        apertureRotationRadians: 0,
      },
      fieldIrisBlur: {
        focusCenterX: 0.5,
        focusCenterY: 0.5,
        focusRadius: 0.16,
        feather: 0.24,
        maximumBlurRadius: 7,
        sampleCount: 21,
        apertureBlades: 8,
      },
      tiltShiftBlur: {
        axisRadians: 0,
        focusWidth: 0.2,
        feather: 0.22,
        maximumBlurRadius: 7,
        sampleCount: 19,
      },
      selectiveGaussianBlur: {
        radius: 3,
        spatialSigma: 2,
        edgeThreshold: 20,
        edgeSoftness: 0.35,
      },
      tileableBlur: { radius: 5, sigma: 2.2, strength: 0.8 },
      dustScratches: { radius: 2, threshold: 24, strength: 0.9 },
      differenceOfGaussians: {
        smallSigma: 0.8,
        largeSigma: 2,
        threshold: 1.5,
        strength: 12,
      },
      colorToAlpha: { keyColor: "#ffffff", strength: 85 },
      filterUnionWave: {
        kind: "wave-warp",
        amount: 42,
        scale: 28,
        detail: 50,
        seed: 1337,
        centerX: 50,
        centerY: 50,
        angle: 0,
      },
      src: "blob:large-source",
      frames: [{ src: "blob:animation-frame" }],
      scene3d: { render() {} },
      vrm: { dispose() {} },
      provenance: new WeakMap<object, unknown>(),
    } as unknown as ImageFilterFields;
    Object.defineProperty(el, "runtimeGraph", {
      enumerable: true,
      get: unrelatedGetter,
    });
    const worker = new CapturingApplyingWorker();

    const output = await runStudioImageFilterWorker(requestFixture(el), {
      workerFactory: () => worker,
    });

    expect(output.execution).toBe("worker");
    expect(unrelatedGetter).not.toHaveBeenCalled();
    expect(Object.is(worker.postedEl, el)).toBe(false);
    for (const key of ["src", "frames", "scene3d", "vrm", "provenance", "runtimeGraph"]) {
      expect(worker.postedEl).not.toHaveProperty(key);
    }
    expect(worker.postedEl).toMatchObject({
      brightness: 0.3,
      contrast: 20,
      exposureAdjustment: { exposure: 1, gamma: 0.9, offset: 0.02 },
      unsharpMask: { amount: 0.8, radius: 2, threshold: 8 },
      morphology: { mode: "erode", radius: 1 },
      pixelOffset: { x: 2, y: -1, edge: "wrap" },
      convolution: { kernel: [0, -1, 0, -1, 5, -1, 0, -1, 0], divisor: 1, bias: 0 },
      clouds: { amount: 0.2, scale: 64, seed: 42, mode: "overlay" },
      lineCleanup: { threshold: 0.6, strength: 0.5 },
      screentoneRemoval: { radius: 2, strength: 0.88, inkLumaThreshold: 72 },
      jpegArtifactReduction: {
        deblockStrength: 0.72,
        deringStrength: 0.45,
        boundaryThreshold: 6,
        protectedEdgeThreshold: 88,
        ringingThreshold: 18,
        inkLumaThreshold: 64,
      },
      edgeAwareDenoise: { radius: 1, strength: 0.78, rangeThreshold: 72 },
      lensBlur: {
        radius: 4,
        sampleCount: 21,
        apertureBlades: 6,
        apertureRotationRadians: 0,
      },
      fieldIrisBlur: {
        focusCenterX: 0.5,
        focusCenterY: 0.5,
        focusRadius: 0.16,
        feather: 0.24,
        maximumBlurRadius: 7,
        sampleCount: 21,
        apertureBlades: 8,
      },
      tiltShiftBlur: {
        axisRadians: 0,
        focusWidth: 0.2,
        feather: 0.22,
        maximumBlurRadius: 7,
        sampleCount: 19,
      },
      selectiveGaussianBlur: {
        radius: 3,
        spatialSigma: 2,
        edgeThreshold: 20,
        edgeSoftness: 0.35,
      },
      tileableBlur: { radius: 5, sigma: 2.2, strength: 0.8 },
      dustScratches: { radius: 2, threshold: 24, strength: 0.9 },
      differenceOfGaussians: {
        smallSigma: 0.8,
        largeSigma: 2,
        threshold: 1.5,
        strength: 12,
      },
      colorToAlpha: { keyColor: "#ffffff", strength: 85 },
      filterUnionWave: {
        kind: "wave-warp",
        amount: 42,
        scale: 28,
        detail: 50,
        seed: 1337,
        centerX: 50,
        centerY: 50,
        angle: 0,
      },
    });
  });

  it("normalizes new smart-filter engines into one ordered Worker program", async () => {
    const worker = new CapturingApplyingWorker();
    const el: ImageFilterFields = {
      smartFilters: {
        version: 1,
        entries: [
          { id: "spin", engine: "spin-blur", enabled: true, params: { radius: 12, strength: 70 } },
          { id: "lens-a", engine: "lens-blur", enabled: true, params: { radius: 4, sampleCount: 17 } },
          { id: "lens-b", engine: "lens-blur", enabled: true, params: { radius: 7, sampleCount: 23 } },
          { id: "tile-a", engine: "tileable-blur", enabled: true, params: { radius: 3, sigma: 1.4, strength: 0.8 } },
          { id: "tile-b", engine: "tileable-blur", enabled: true, params: { radius: 5, sigma: 2.2, strength: 0.6 } },
          { id: "mosaic", engine: "pixelate", enabled: true, params: { size: 6 } },
          { id: "lines", engine: "line-extraction", enabled: false, params: {} },
          { id: "halftone", engine: "color-halftone", enabled: true, params: { mode: "cmyk", dotSize: 4, strength: 80 } },
        ],
      },
    };

    const output = await runStudioImageFilterWorker(requestFixture(el), {
      workerFactory: () => worker,
    });

    expect(output.execution).toBe("worker");
    expect(worker.postedEl?.smartFilters).toBeUndefined();
    expect(worker.postedEl?.smartFilterOperations?.map((entry) => entry.engine))
      .toEqual([
        "spin-blur",
        "lens-blur",
        "lens-blur",
        "tileable-blur",
        "tileable-blur",
        "pixelate",
        "color-halftone",
      ]);
  });

  it("rejects without direct execution when postMessage throws synchronously", async () => {
    const request = requestFixture();
    const worker = new ThrowingPostWorker();

    await expect(runStudioImageFilterWorker(request, { workerFactory: () => worker }))
      .rejects.toMatchObject({ name: "StudioImageFilterWorkerUnavailableError" });
    expect(worker.terminateCount).toBe(1);
  });

  it("rejects with the worker's reported error", async () => {
    const request = requestFixture();
    const worker = new FailingWorker();

    await expect(
      runStudioImageFilterWorker(request, { workerFactory: () => worker }),
    ).rejects.toThrow("boom");
  });

  it("rejects on a worker load error before any request is posted", async () => {
    const request = requestFixture();
    const worker = new LoadErrorWorker();

    await expect(runStudioImageFilterWorker(request, { workerFactory: () => worker }))
      .rejects.toThrow("worker chunk failed to load");
    expect(worker.terminateCount).toBe(1);
  });

  it("rejects and terminates when a worker never announces readiness", async () => {
    vi.useFakeTimers();
    try {
      const request = requestFixture();
      const worker = new HangingWorker(false);
      const pending = runStudioImageFilterWorker(request, { workerFactory: () => worker });
      const rejection = expect(pending).rejects.toMatchObject({
        name: "StudioImageFilterWorkerUnavailableError",
      });

      await vi.advanceTimersByTimeAsync(3_000);

      await rejection;
      expect(worker.terminateCount).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects malformed dimensions and oversized requests before constructing a worker", async () => {
    const constructed = vi.fn(() => new HangingWorker());
    await expect(runStudioImageFilterWorker({
      imageData: { data: new Uint8ClampedArray(4), width: 2, height: 2 },
      el: {},
    }, { workerFactory: constructed })).rejects.toThrow(/버퍼 길이/);
    await expect(runStudioImageFilterWorker({
      imageData: { data: new Uint8ClampedArray(4), width: 8193, height: 8193 },
      el: {},
    }, { workerFactory: constructed })).rejects.toThrow(/안전 한도/);
    expect(constructed).not.toHaveBeenCalled();
  });

  it("treats non-finite scalar filter values as no-ops instead of blackening pixels", async () => {
    const request = requestFixture({ brightness: Number.NaN, contrast: Number.POSITIVE_INFINITY });
    const original = Array.from(request.imageData.data);

    const output = await runStudioImageFilterWorker(request, { executionMode: "direct" });

    expect(Array.from(output.imageData.data)).toEqual(original);
  });

  it("rejects an invalid success payload and terminates the worker", async () => {
    const worker = new InvalidSuccessWorker();

    await expect(runStudioImageFilterWorker(requestFixture(), {
      workerFactory: () => worker,
    })).rejects.toThrow(/버퍼 길이/);
    expect(worker.terminateCount).toBe(1);
  });

  it("terminates an in-flight worker and rejects with AbortError when the signal aborts", async () => {
    const worker = new HangingWorker();
    const controller = new AbortController();
    const request = requestFixture();

    const pending = runStudioImageFilterWorker(request, {
      workerFactory: () => worker,
      signal: controller.signal,
    });
    await Promise.resolve();
    controller.abort();

    await expect(pending).rejects.toThrow(/취소/);
    expect(worker.terminateCount).toBe(1);
  });

  it("rejects immediately for an already-aborted signal without constructing a worker", async () => {
    const controller = new AbortController();
    controller.abort();
    let constructed = false;

    await expect(
      runStudioImageFilterWorker(requestFixture(), {
        workerFactory: () => {
          constructed = true;
          return new HangingWorker();
        },
        signal: controller.signal,
      }),
    ).rejects.toThrow(/취소/);
    expect(constructed).toBe(false);
  });
});

describe("createStudioImageFilterWorkerSession", () => {
  it("rejects when its selected Worker authority is unavailable", async () => {
    const session = createStudioImageFilterWorkerSession({ workerFactory: null });

    await expect(session.run(requestFixture())).rejects.toMatchObject({
      name: "StudioImageFilterWorkerUnavailableError",
    });
    session.dispose();
  });

  it("reuses one ready Worker across sequential slider ticks until explicit disposal", async () => {
    const worker = new ApplyingWorker();
    const factory = vi.fn(() => worker);
    const session = createStudioImageFilterWorkerSession({ workerFactory: factory });

    const first = await session.run(requestFixture({ brightness: 0.1 }));
    const second = await session.run(requestFixture({ brightness: 0.2 }));

    expect(first.execution).toBe("worker");
    expect(second.execution).toBe("worker");
    expect(factory).toHaveBeenCalledTimes(1);
    expect(worker.terminateCount).toBe(0);

    session.dispose();
    expect(worker.terminateCount).toBe(1);
  });

  it("drops an aborted queued tick without terminating the in-flight reusable Worker", async () => {
    const worker = new HangingWorker();
    const session = createStudioImageFilterWorkerSession({ workerFactory: () => worker });
    const first = session.run(requestFixture({ brightness: 0.1 }));
    await Promise.resolve();
    const controller = new AbortController();
    const queued = session.run(requestFixture({ brightness: 0.2 }), { signal: controller.signal });
    controller.abort();

    await expect(queued).rejects.toThrow(/취소/);
    expect(worker.terminateCount).toBe(0);

    session.dispose();
    await expect(first).rejects.toThrow(/취소/);
    expect(worker.terminateCount).toBe(1);
  });
});

describe("createStudioImageFilterResidentWorkerSession", () => {
  it("rejects rather than switching a selected resident Worker session to direct", async () => {
    const session = createStudioImageFilterResidentWorkerSession({ workerFactory: null });
    const source = makeImageData(3, 2);
    const before = Array.from(source.data);

    await expect(session.run(
      { imageData: source, el: { brightness: 0.2 } },
      { sourceRevision: "worker-required" },
    )).rejects.toMatchObject({ name: "StudioImageFilterWorkerUnavailableError" });
    expect(Array.from(source.data)).toEqual(before);
    session.dispose();
  });

  it("loads one immutable source and sends only filter parameters on later slider ticks", async () => {
    const worker = new ResidentApplyingWorker();
    const session = createStudioImageFilterResidentWorkerSession({
      workerFactory: () => worker,
    });
    const source = makeImageData(3, 2);
    const original = Array.from(source.data);
    const firstEl: ImageFilterFields = { brightness: 0.1 };
    const secondEl: ImageFilterFields = { brightness: 0.35, contrast: 12 };

    const first = await session.run(
      { imageData: source, el: firstEl },
      { sourceRevision: 1 },
    );
    const second = await session.run(
      { imageData: source, el: secondEl },
      { sourceRevision: 1 },
    );

    expect(first.execution).toBe("worker");
    expect(second.execution).toBe("worker");
    expect(Array.from(first.imageData.data)).toEqual(Array.from(expectedPixels(firstEl)));
    expect(Array.from(second.imageData.data)).toEqual(Array.from(expectedPixels(secondEl)));
    expect(Array.from(source.data)).toEqual(original);
    expect(source.data.byteLength).toBe(24);
    expect(worker.loadCount).toBe(1);
    expect(worker.runCount).toBe(2);
    expect(worker.messages.map((message) => message.type)).toEqual([
      "studio-image-filter/load-source",
      "studio-image-filter/run-source",
      "studio-image-filter/run-source",
    ]);
    expect(worker.transfers).toEqual([1, 0, 0]);

    session.dispose();
    expect(worker.terminateCount).toBe(1);
  });

  it("reloads on revision or pixel identity changes and never reuses the wrong resident pixels", async () => {
    const worker = new ResidentApplyingWorker();
    const session = createStudioImageFilterResidentWorkerSession({
      workerFactory: () => worker,
    });
    const firstSource = makeImageData(3, 2);
    const secondSource = makeImageData(3, 2);
    secondSource.data.fill(0);
    for (let index = 3; index < secondSource.data.length; index += 4) {
      secondSource.data[index] = 255;
    }
    const el: ImageFilterFields = { invert: true };

    await session.run({ imageData: firstSource, el }, { sourceRevision: "source-a" });
    await session.run({ imageData: firstSource, el }, { sourceRevision: "source-b" });
    const secondResult = await session.run(
      { imageData: secondSource, el },
      // Even an accidentally reused caller revision cannot alias another typed-array identity.
      { sourceRevision: "source-b" },
    );

    const expected = {
      data: new Uint8ClampedArray(secondSource.data),
      height: secondSource.height,
      width: secondSource.width,
    };
    const built = buildImageFilters(el, testRegistry);
    applyImageFilters(expected, built.filters, built.attrs);

    expect(worker.loadCount).toBe(3);
    expect(
      worker.messages
        .filter((message): message is StudioImageFilterWorkerLoadSourceMessage =>
          message.type === "studio-image-filter/load-source"
        )
        .map((message) => message.sourceGeneration)
    ).toEqual([1, 2, 3]);
    expect(Array.from(secondResult.imageData.data)).toEqual(Array.from(expected.data));
    expect(Array.from(secondSource.data)).not.toEqual(Array.from(secondResult.imageData.data));

    session.dispose();
  });

  it("rejects a stale generation response and terminates the contaminated Worker", async () => {
    const worker = new ManualResidentWorker();
    const session = createStudioImageFilterResidentWorkerSession({
      workerFactory: () => worker,
    });
    const pending = session.run(requestFixture(), { sourceRevision: 1 });
    await Promise.resolve();

    const loadMessage = worker.messages[0];
    expect(loadMessage?.type).toBe("studio-image-filter/load-source");
    if (loadMessage?.type !== "studio-image-filter/load-source") {
      throw new Error("resident load request expected");
    }
    worker.emitSourceLoaded(loadMessage);
    const runMessage = worker.messages[1];
    expect(runMessage?.type).toBe("studio-image-filter/run-source");
    if (runMessage?.type !== "studio-image-filter/run-source") {
      throw new Error("resident run request expected");
    }
    worker.emitSuccess(runMessage, {
      sourceGeneration: runMessage.sourceGeneration + 1,
    });

    await expect(pending).rejects.toThrow(/오래되었거나 잘못된 필터 결과/);
    expect(worker.terminateCount).toBe(1);
  });

  it("uses an isolated direct copy only in an explicitly selected direct session", async () => {
    const session = createStudioImageFilterResidentWorkerSession({
      executionMode: "direct",
    });
    const source = makeImageData(3, 2);
    const original = Array.from(source.data);
    const el: ImageFilterFields = { brightness: 0.2, contrast: 30 };

    const output = await session.run(
      { imageData: source, el },
      { sourceRevision: "direct-source" },
    );

    expect(output.execution).toBe("direct");
    expect(Array.from(output.imageData.data)).toEqual(Array.from(expectedPixels(el)));
    expect(Array.from(source.data)).toEqual(original);
    session.dispose();
  });

  it("keeps the loaded source after an aborted result and reuses it for the latest slider tick", async () => {
    const worker = new ManualResidentWorker();
    const session = createStudioImageFilterResidentWorkerSession({
      workerFactory: () => worker,
    });
    const source = makeImageData(3, 2);
    const controller = new AbortController();
    const first = session.run(
      { imageData: source, el: { brightness: 0.1 } },
      { signal: controller.signal, sourceRevision: 1 },
    );
    await Promise.resolve();
    const loadMessage = worker.messages[0];
    if (loadMessage?.type !== "studio-image-filter/load-source") {
      throw new Error("resident load request expected");
    }
    worker.emitSourceLoaded(loadMessage);
    const firstRun = worker.messages[1];
    if (firstRun?.type !== "studio-image-filter/run-source") {
      throw new Error("first resident run request expected");
    }
    controller.abort();
    await expect(first).rejects.toThrow(/취소/);

    const latest = session.run(
      { imageData: source, el: { brightness: 0.3 } },
      { sourceRevision: 1 },
    );
    worker.emitSuccess(firstRun);
    await Promise.resolve();
    const secondRun = worker.messages[2];
    expect(secondRun?.type).toBe("studio-image-filter/run-source");
    expect(
      worker.messages.filter((message) => message.type === "studio-image-filter/load-source")
    ).toHaveLength(1);
    if (secondRun?.type !== "studio-image-filter/run-source") {
      throw new Error("second resident run request expected");
    }
    worker.emitSuccess(secondRun);

    await expect(latest).resolves.toMatchObject({ execution: "worker" });
    session.dispose();
  });

  it("reloads the source into a fresh Worker after an in-flight Worker failure", async () => {
    const firstWorker = new ManualResidentWorker();
    const replacement = { worker: null as ManualResidentWorker | null };
    const factory = vi.fn()
      .mockReturnValueOnce(firstWorker)
      .mockImplementationOnce(() => {
        replacement.worker = new ManualResidentWorker();
        return replacement.worker;
      });
    const session = createStudioImageFilterResidentWorkerSession({
      workerFactory: factory,
    });
    const request = requestFixture();
    const first = session.run(request, { sourceRevision: 1 });
    await Promise.resolve();
    const firstLoad = firstWorker.messages[0];
    if (firstLoad?.type !== "studio-image-filter/load-source") {
      throw new Error("first resident load request expected");
    }
    firstWorker.emitSourceLoaded(firstLoad);
    expect(firstWorker.messages[1]?.type).toBe("studio-image-filter/run-source");
    firstWorker.onerror?.({ error: new Error("worker crashed"), preventDefault: vi.fn() });

    await expect(first).rejects.toThrow("worker crashed");
    const second = session.run(request, { sourceRevision: 1 });
    await Promise.resolve();

    expect(factory).toHaveBeenCalledTimes(2);
    expect(firstWorker.terminateCount).toBe(1);
    expect(replacement.worker?.messages[0]?.type).toBe("studio-image-filter/load-source");

    session.dispose();
    await expect(second).rejects.toThrow(/취소/);
    expect(replacement.worker?.terminateCount).toBe(1);
  });

  it("disposal terminates the Worker, rejects pending work, and rejects future runs", async () => {
    const worker = new ManualResidentWorker();
    const session = createStudioImageFilterResidentWorkerSession({
      workerFactory: () => worker,
    });
    const pending = session.run(requestFixture(), { sourceRevision: 1 });
    await Promise.resolve();

    session.dispose();

    await expect(pending).rejects.toThrow(/취소/);
    await expect(session.run(requestFixture(), { sourceRevision: 1 })).rejects.toThrow(/취소/);
    expect(worker.terminateCount).toBe(1);
  });
});
