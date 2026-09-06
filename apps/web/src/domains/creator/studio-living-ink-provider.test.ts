import { describe, expect, it } from "vitest";

import {
  STUDIO_LIVING_INK_EXECUTION_ENGINE_VERSION,
  STUDIO_LIVING_INK_EXECUTION_LIMITS,
  STUDIO_LIVING_INK_EXECUTION_PROTOCOL_VERSION,
  type StudioLivingInkExecutionApplied,
  type StudioLivingInkExecutionCapabilities,
  type StudioLivingInkExecutionConfig,
  type StudioLivingInkExecutionReceipt,
  type StudioLivingInkWorkerRequest,
  type StudioLivingInkWorkerResponse,
} from "./studio-living-ink-execution-protocol";
import { DEFAULT_STUDIO_LIVING_INK_MATERIAL_CONTROLS } from "./studio-living-ink-gpu-protocol";
import {
  StudioLivingInkExecutionProvider,
  type StudioLivingInkWorkerLike,
} from "./studio-living-ink-provider";

import type { StudioLivingInkOperation } from "./studio-living-ink-field";

class FakeWorker implements StudioLivingInkWorkerLike {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly messages: StudioLivingInkWorkerRequest[] = [];
  terminated = false;
  postMessage(message: StudioLivingInkWorkerRequest): void { this.messages.push(message); }
  terminate(): void { this.terminated = true; }
  respond(message: StudioLivingInkWorkerResponse): void {
    this.onmessage?.({ data: message } as MessageEvent<unknown>);
  }
  crash(message = "synthetic Living Ink Worker crash"): void {
    this.onerror?.({ message, preventDefault() {} } as ErrorEvent);
  }
  failClone(): void {
    this.onmessageerror?.({ data: null } as MessageEvent<unknown>);
  }
}

const config: StudioLivingInkExecutionConfig = {
  displayWidth: 64,
  displayHeight: 64,
  fieldWidth: 64,
  fieldHeight: 64,
  coarseBase: 128,
  seed: 17,
  material: DEFAULT_STUDIO_LIVING_INK_MATERIAL_CONTROLS,
  displayMode: "composite",
};

const capabilities: StudioLivingInkExecutionCapabilities = {
  backend: "webgl2-offscreen-half-float",
  worker: true,
  offscreenCanvas: true,
  webgl2: true,
  webgpu: false,
  halfFloatRenderable: true,
  rgba16Float: true,
  rg16Float: true,
  r16Float: true,
  maximumTextureSize: 16_384,
  pressureIterations: {
    interactive: STUDIO_LIVING_INK_EXECUTION_LIMITS.interactivePressureIterations,
    settle: STUDIO_LIVING_INK_EXECUTION_LIMITS.settlePressureIterations,
  },
};

function bitmap(): ImageBitmap & { closed: boolean } {
  const result = {
    closed: false,
    close() { result.closed = true; },
  };
  return result as unknown as ImageBitmap & { closed: boolean };
}

function operation(sequence: number): StudioLivingInkOperation {
  return { kind: "advance", version: 1, sequence, fixedTicks: 1 };
}

function receipt(
  requestId: number,
  backend: StudioLivingInkExecutionReceipt["backend"] = "webgl2-offscreen-half-float",
): StudioLivingInkExecutionReceipt {
  const base = {
    kind: "studio-living-ink-execution-receipt",
    version: STUDIO_LIVING_INK_EXECUTION_PROTOCOL_VERSION,
    engineVersion: STUDIO_LIVING_INK_EXECUTION_ENGINE_VERSION,
    requestId,
    revision: 1,
    operationKind: "advance",
    displaySha256: `sha256:${"1".repeat(64)}`,
    operationSha256: `sha256:${"2".repeat(64)}`,
    dirtyBounds: { x: 0, y: 0, width: 64, height: 64 },
    dirtyTileCount: 4,
    passCount: 12,
    pressureIterations: 10,
    simulationTicks: 1,
    elapsedMilliseconds: 4,
    fixedPigmentPolicy: "immutable",
    dryingWindowSeconds: 8,
    fixDurationSeconds: 1.2,
    determinism: "same-runtime-replay",
    crossDeviceBitExact: false,
    cpuOperationHashCrossDeviceDeterministic: true,
    canonicalFrameAuthority: "first-rendered-rgba8-frame",
    replayValidation: "bounded-visual-parity",
    gpuError: 0,
    imageOwnership: "caller-must-close",
    contextRecovery: "worker-rebuild-journal-replay",
  } as const;
  return backend === "webgpu-offscreen-half-float"
    ? {
        ...base,
        backend,
        displayReadbackOrientation: "top-left-row-major",
        readbackFormat: "rgba32float-storage-buffer-to-rgba8",
      }
    : {
        ...base,
        backend,
        displayReadbackOrientation: "webgl-bottom-left-row-major",
        readbackFormat: "rgba8-staging-fbo",
      };
}

function applied(requestId: number, revision = 1): StudioLivingInkExecutionApplied {
  return {
    kind: "living-ink/applied",
    version: STUDIO_LIVING_INK_EXECUTION_PROTOCOL_VERSION,
    engineVersion: STUDIO_LIVING_INK_EXECUTION_ENGINE_VERSION,
    requestId,
    revision,
    operationKind: "advance",
    operationSha256: `sha256:${"2".repeat(64)}`,
    backend: "webgl2-offscreen-half-float",
    dirtyBounds: { x: 0, y: 0, width: 64, height: 64 },
    dirtyTileCount: 4,
    passCount: 12,
    pressureIterations: 10,
    simulationTicks: 1,
    elapsedMilliseconds: 4,
    presented: false,
    displayReadbackCount: 0,
    imageBitmapCount: 0,
  };
}

async function initialize(provider: StudioLivingInkExecutionProvider, worker: FakeWorker): Promise<void> {
  const pending = provider.initialize();
  const request = worker.messages.at(-1)!;
  expect(request).toMatchObject({ type: "living-ink/initialize", backend: "webgl2" });
  worker.respond({ type: "living-ink/ready", version: 1, requestId: request.requestId, capabilities });
  await pending;
}

describe("StudioLivingInkExecutionProvider", () => {
  it("rejects a Worker that answers with a backend other than the explicit selection", async () => {
    const worker = new FakeWorker();
    const provider = new StudioLivingInkExecutionProvider(config, {
      backend: "webgpu",
      workerFactory: () => worker,
    });
    const pending = provider.initialize();
    const request = worker.messages.at(-1)!;
    expect(request).toMatchObject({ type: "living-ink/initialize", backend: "webgpu" });
    worker.respond({
      type: "living-ink/ready",
      version: 1,
      requestId: request.requestId,
      capabilities,
    });
    await expect(pending).rejects.toThrow("explicitly selected backend");
    expect(worker.terminated).toBe(true);
    await provider.dispose();
  });

  it("applies simulation-only input without allocating a frame, then presents once explicitly", async () => {
    const worker = new FakeWorker();
    const provider = new StudioLivingInkExecutionProvider(config, {
      backend: "webgl2",
      workerFactory: () => worker,
    });
    await initialize(provider, worker);

    const pending = provider.apply(operation(1), { present: false });
    await Promise.resolve();
    const applyRequest = worker.messages.at(-1)!;
    expect(applyRequest).toMatchObject({ type: "living-ink/apply", options: { present: false } });
    worker.respond({
      type: "living-ink/applied",
      version: 1,
      requestId: applyRequest.requestId,
      applied: applied(applyRequest.requestId),
    });
    await expect(pending).resolves.toMatchObject({
      kind: "living-ink/applied",
      presented: false,
      displayReadbackCount: 0,
      imageBitmapCount: 0,
    });

    const presented = provider.render("composite");
    await Promise.resolve();
    const renderRequest = worker.messages.at(-1)!;
    const image = bitmap();
    worker.respond({
      type: "living-ink/frame",
      version: 1,
      requestId: renderRequest.requestId,
      frame: { image, receipt: { ...receipt(renderRequest.requestId), operationKind: "restore" } },
    });
    await expect(presented).resolves.toMatchObject({ image });
    image.close();
    await provider.dispose();
  });

  it("serializes input and returns only validated caller-owned frames", async () => {
    const worker = new FakeWorker();
    const provider = new StudioLivingInkExecutionProvider(config, {
      backend: "webgl2",
      workerFactory: () => worker,
    });
    await initialize(provider, worker);
    const first = provider.apply(operation(1));
    const second = provider.apply(operation(2));
    await Promise.resolve();
    expect(worker.messages.filter((entry) => entry.type === "living-ink/apply")).toHaveLength(1);
    const firstRequest = worker.messages.at(-1)!;
    const firstBitmap = bitmap();
    worker.respond({
      type: "living-ink/frame",
      version: 1,
      requestId: firstRequest.requestId,
      frame: { image: firstBitmap, receipt: receipt(firstRequest.requestId) },
    });
    await expect(first).resolves.toMatchObject({ image: firstBitmap });
    await Promise.resolve();
    const secondRequest = worker.messages.at(-1)!;
    const secondBitmap = bitmap();
    worker.respond({
      type: "living-ink/frame",
      version: 1,
      requestId: secondRequest.requestId,
      frame: { image: secondBitmap, receipt: receipt(secondRequest.requestId) },
    });
    await expect(second).resolves.toMatchObject({ image: secondBitmap });
    expect(firstBitmap.closed).toBe(false);
    firstBitmap.close();
    secondBitmap.close();
    await provider.dispose();
  });

  it("closes malformed frames, terminates their epoch and requires explicit reinitialize", async () => {
    const firstWorker = new FakeWorker();
    const secondWorker = new FakeWorker();
    let generation = 0;
    const provider = new StudioLivingInkExecutionProvider(config, {
      backend: "webgl2",
      workerFactory: () => generation++ === 0 ? firstWorker : secondWorker,
    });
    await initialize(provider, firstWorker);
    const pending = provider.apply(operation(1));
    await Promise.resolve();
    const request = firstWorker.messages.at(-1)!;
    const invalidBitmap = bitmap();
    firstWorker.respond({
      type: "living-ink/frame",
      version: 1,
      requestId: request.requestId,
      frame: {
        image: invalidBitmap,
        receipt: { ...receipt(request.requestId), displaySha256: "sha256:bad" as `sha256:${string}` },
      },
    });
    await expect(pending).rejects.toThrow("invalid frame contract");
    expect(invalidBitmap.closed).toBe(true);
    expect(firstWorker.terminated).toBe(true);
    await expect(provider.apply(operation(2))).rejects.toThrow("not initialized");
    await initialize(provider, secondWorker);
    await provider.dispose();
  });

  it("rejects historical WebGPU receipts that falsely claim a WebGL2 FBO readback", async () => {
    const worker = new FakeWorker();
    const provider = new StudioLivingInkExecutionProvider(config, {
      backend: "webgl2",
      workerFactory: () => worker,
    });
    await initialize(provider, worker);
    const pending = provider.apply(operation(1));
    await Promise.resolve();
    const request = worker.messages.at(-1)!;
    const invalidBitmap = bitmap();
    const validWebGpuReceipt = receipt(request.requestId, "webgpu-offscreen-half-float");
    worker.respond({
      type: "living-ink/frame",
      version: 1,
      requestId: request.requestId,
      frame: {
        image: invalidBitmap,
        receipt: {
          ...validWebGpuReceipt,
          displayReadbackOrientation: "webgl-bottom-left-row-major",
          readbackFormat: "rgba8-staging-fbo",
        } as unknown as StudioLivingInkExecutionReceipt,
      },
    });
    await expect(pending).rejects.toThrow("invalid frame contract");
    expect(invalidBitmap.closed).toBe(true);
    expect(worker.terminated).toBe(true);
    await provider.dispose();
  });

  it("posts timeout cancellation before releasing the next queued input", async () => {
    const worker = new FakeWorker();
    const provider = new StudioLivingInkExecutionProvider(config, {
      backend: "webgl2",
      workerFactory: () => worker,
      requestTimeoutMilliseconds: 8,
    });
    await initialize(provider, worker);
    const first = provider.apply(operation(1));
    const second = provider.apply(operation(2));
    await expect(first).rejects.toThrow("timed out");
    const cancelIndex = worker.messages.findIndex((entry) => entry.type === "living-ink/cancel");
    const applyIndexes = worker.messages
      .map((entry, index) => entry.type === "living-ink/apply" ? index : -1)
      .filter((index) => index >= 0);
    expect(cancelIndex).toBeGreaterThan(applyIndexes[0]!);
    expect(applyIndexes[1]).toBeGreaterThan(cancelIndex);
    const request = worker.messages[applyIndexes[1]!]!;
    const image = bitmap();
    worker.respond({
      type: "living-ink/frame",
      version: 1,
      requestId: request.requestId,
      frame: { image, receipt: receipt(request.requestId) },
    });
    await second;
    image.close();
    await provider.dispose();
  });

  it("rejects every pending owner immediately on Worker crash and requires reinitialize", async () => {
    const firstWorker = new FakeWorker();
    const secondWorker = new FakeWorker();
    let generation = 0;
    const provider = new StudioLivingInkExecutionProvider(config, {
      backend: "webgl2",
      workerFactory: () => generation++ === 0 ? firstWorker : secondWorker,
      requestTimeoutMilliseconds: 30_000,
    });
    await initialize(provider, firstWorker);
    const first = provider.apply(operation(1));
    const second = provider.apply(operation(2));
    await Promise.resolve();
    firstWorker.crash();
    await expect(first).rejects.toThrow("synthetic Living Ink Worker crash");
    await expect(second).rejects.toThrow("not initialized");
    expect(firstWorker.terminated).toBe(true);
    await initialize(provider, secondWorker);
    await provider.dispose();
  });

  it("seals an epoch on main-thread structured-clone failure instead of timing out", async () => {
    const worker = new FakeWorker();
    const provider = new StudioLivingInkExecutionProvider(config, {
      backend: "webgl2",
      workerFactory: () => worker,
      requestTimeoutMilliseconds: 30_000,
    });
    await initialize(provider, worker);
    const pending = provider.apply(operation(1));
    await Promise.resolve();
    worker.failClone();
    await expect(pending).rejects.toThrow("message clone failed");
    expect(worker.terminated).toBe(true);
    await expect(provider.apply(operation(2))).rejects.toThrow("not initialized");
    await provider.dispose();
  });

  it("rejects in-flight work and terminates the Worker immediately on disposal", async () => {
    const worker = new FakeWorker();
    const provider = new StudioLivingInkExecutionProvider(config, {
      backend: "webgl2",
      workerFactory: () => worker,
      requestTimeoutMilliseconds: 30_000,
    });
    await initialize(provider, worker);
    const pending = provider.apply(operation(1), { present: false });
    await Promise.resolve();
    const started = performance.now();
    await provider.dispose();
    const elapsed = performance.now() - started;
    await expect(pending).rejects.toThrow("disposed");
    expect(worker.terminated).toBe(true);
    expect(elapsed).toBeLessThan(250);
  });
});
