import { afterEach, describe, expect, it, vi } from "vitest";

import {
  StudioBg3dShotPngWorkerError,
  encodeStudioBg3dShotPngInWorker,
  type StudioBg3dShotPngWorkerLike,
} from "./studio-bg3d-shot-png-worker-client";
import {
  STUDIO_BG3D_SHOT_PNG_WORKER_PROTOCOL_VERSION,
  isStudioBg3dShotPngWorkerRequest,
  isStudioBg3dShotPngWorkerResponse,
  type StudioBg3dShotPngWorkerRequest,
} from "./studio-bg3d-shot-png-worker-protocol";

import type { StudioBg3dLtRasterLayer } from "./studio-bg3d-lt-render";

interface MessageEventLike { readonly data: unknown }
interface ErrorEventLike { preventDefault?(): void }

class FakeWorker implements StudioBg3dShotPngWorkerLike {
  readonly requests: StudioBg3dShotPngWorkerRequest[] = [];
  readonly transfers: Transferable[][] = [];
  readonly messages = new Set<(event: MessageEventLike) => void>();
  readonly errors = new Set<(event: ErrorEventLike) => void>();
  readonly messageErrors = new Set<(event: ErrorEventLike) => void>();
  terminateCalls = 0;
  throwOnPost = false;

  postMessage(message: StudioBg3dShotPngWorkerRequest, transfer: Transferable[]): void {
    if (this.throwOnPost) throw new Error("structured clone failed");
    this.requests.push(message);
    this.transfers.push(transfer);
  }

  addEventListener(
    type: "message" | "error" | "messageerror",
    listener: ((event: MessageEventLike) => void) | ((event: ErrorEventLike) => void),
  ): void {
    if (type === "message") this.messages.add(listener as (event: MessageEventLike) => void);
    else if (type === "error") this.errors.add(listener as (event: ErrorEventLike) => void);
    else this.messageErrors.add(listener as (event: ErrorEventLike) => void);
  }

  removeEventListener(
    type: "message" | "error" | "messageerror",
    listener: ((event: MessageEventLike) => void) | ((event: ErrorEventLike) => void),
  ): void {
    if (type === "message") this.messages.delete(listener as (event: MessageEventLike) => void);
    else if (type === "error") this.errors.delete(listener as (event: ErrorEventLike) => void);
    else this.messageErrors.delete(listener as (event: ErrorEventLike) => void);
  }

  terminate(): void {
    this.terminateCalls += 1;
  }

  emit(data: unknown): void {
    for (const listener of this.messages) listener({ data });
  }

  emitError(type: "error" | "messageerror" = "error"): void {
    const event = { preventDefault: vi.fn() };
    const listeners = type === "error" ? this.errors : this.messageErrors;
    for (const listener of listeners) listener(event);
  }
}

function emitReady(worker: FakeWorker): void {
  worker.emit({
    version: STUDIO_BG3D_SHOT_PNG_WORKER_PROTOCOL_VERSION,
    kind: "ready",
  });
}

function layer(
  role: StudioBg3dLtRasterLayer["role"] = "color",
  width = 2,
  height = 1,
  value = 40,
): StudioBg3dLtRasterLayer {
  const data = new Uint8ClampedArray(width * height * 4);
  data.fill(value);
  return { role, width, height, data };
}

function png(width: number, height: number): Blob {
  const bytes = new Uint8Array(33);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13, false);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return new Blob([bytes], { type: "image/png" });
}

function resultFor(request: StudioBg3dShotPngWorkerRequest, value = png(request.width, request.height)) {
  return {
    version: STUDIO_BG3D_SHOT_PNG_WORKER_PROTOCOL_VERSION,
    kind: "result" as const,
    requestId: request.requestId,
    width: request.width,
    height: request.height,
    png: value,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Studio BG3D shot PNG Worker boundary", () => {
  it("waits for capability readiness, transfers snapshots, and preserves caller-owned pixels", async () => {
    const color = layer("color", 2, 1, 30);
    const line = layer("main-line", 2, 1, 200);
    const originalColorBuffer = color.data.buffer;
    const originalLineBuffer = line.data.buffer;
    const expectedColor = color.data.slice();
    const expectedLine = line.data.slice();
    const worker = new FakeWorker();
    const pending = encodeStudioBg3dShotPngInWorker([color, line], {
      workerFactory: () => worker,
    });

    expect(worker.requests).toHaveLength(0);
    color.data.fill(0);
    line.data.fill(0);
    emitReady(worker);
    const request = worker.requests[0];
    if (!request) throw new Error("missing request");

    expect(isStudioBg3dShotPngWorkerRequest(request)).toBe(true);
    expect(worker.transfers[0]).toEqual(request.layers.map((entry) => entry.dataBuffer));
    expect(request.layers[0]?.dataBuffer).not.toBe(originalColorBuffer);
    expect(request.layers[1]?.dataBuffer).not.toBe(originalLineBuffer);
    expect(new Uint8ClampedArray(request.layers[0]!.dataBuffer)).toEqual(expectedColor);
    expect(new Uint8ClampedArray(request.layers[1]!.dataBuffer)).toEqual(expectedLine);
    expect(color.data.buffer).toBe(originalColorBuffer);
    expect(line.data.buffer).toBe(originalLineBuffer);

    const encoded = png(2, 1);
    worker.emit(resultFor(request, encoded));
    await expect(pending).resolves.toBe(encoded);
    expect(worker.terminateCalls).toBe(1);
    expect(worker.messages.size).toBe(0);
    expect(worker.errors.size).toBe(0);
    expect(worker.messageErrors.size).toBe(0);
  });

  it("rejects malformed and unowned inputs before allocating a Worker", async () => {
    const workerFactory = vi.fn(() => new FakeWorker());
    await expect(encodeStudioBg3dShotPngInWorker([{
      ...layer(),
      data: new Uint8ClampedArray(7),
    }], { workerFactory })).rejects.toMatchObject({ code: "invalid-request" });
    await expect(encodeStudioBg3dShotPngInWorker([{
      ...layer(),
      extra: true,
    } as StudioBg3dLtRasterLayer], { workerFactory })).rejects.toMatchObject({ code: "invalid-request" });
    await expect(encodeStudioBg3dShotPngInWorker([
      layer("color"), layer("main-line"), layer("texture-line"), layer("tone"),
    ], { workerFactory })).rejects.toMatchObject({ code: "invalid-request" });

    if (typeof SharedArrayBuffer === "function") {
      await expect(encodeStudioBg3dShotPngInWorker([{
        role: "color",
        width: 1,
        height: 1,
        data: new Uint8ClampedArray(new SharedArrayBuffer(4)),
      }], { workerFactory })).rejects.toMatchObject({ code: "invalid-request" });
    }
    expect(workerFactory).not.toHaveBeenCalled();
  });

  it("enforces exact versioned request and response shapes", () => {
    const request = {
      version: STUDIO_BG3D_SHOT_PNG_WORKER_PROTOCOL_VERSION,
      kind: "encode",
      requestId: 1,
      width: 1,
      height: 1,
      layers: [{ role: "color", width: 1, height: 1, dataBuffer: new ArrayBuffer(4) }],
    };
    expect(isStudioBg3dShotPngWorkerRequest(request)).toBe(true);
    expect(isStudioBg3dShotPngWorkerRequest({ ...request, version: 2 })).toBe(false);
    expect(isStudioBg3dShotPngWorkerRequest({ ...request, extra: true })).toBe(false);
    expect(isStudioBg3dShotPngWorkerRequest({
      ...request,
      layers: [{ ...request.layers[0], dataBuffer: new ArrayBuffer(3) }],
    })).toBe(false);
    expect(isStudioBg3dShotPngWorkerRequest({
      ...request,
      layers: [
        { role: "main-line", width: 1, height: 1, dataBuffer: new ArrayBuffer(4) },
        { role: "color", width: 1, height: 1, dataBuffer: new ArrayBuffer(4) },
      ],
    })).toBe(false);
    expect(isStudioBg3dShotPngWorkerResponse({
      version: STUDIO_BG3D_SHOT_PNG_WORKER_PROTOCOL_VERSION,
      kind: "ready",
    })).toBe(true);
    expect(isStudioBg3dShotPngWorkerResponse({
      version: STUDIO_BG3D_SHOT_PNG_WORKER_PROTOCOL_VERSION,
      kind: "unavailable",
      code: "offscreen-canvas",
    })).toBe(true);
    expect(isStudioBg3dShotPngWorkerResponse({
      version: STUDIO_BG3D_SHOT_PNG_WORKER_PROTOCOL_VERSION,
      kind: "result",
      requestId: 1,
      width: 1,
      height: 1,
      png: png(1, 1),
      extra: true,
    })).toBe(false);
  });

  it("reports Worker construction and OffscreenCanvas capability failures without substitution", async () => {
    const construction = encodeStudioBg3dShotPngInWorker([layer()], {
      workerFactory: () => { throw new Error("CSP"); },
    });
    const constructionError = await construction.catch((error: unknown) => error);
    expect(constructionError).toMatchObject({ code: "worker-unavailable" });

    const unsupportedWorker = new FakeWorker();
    const unsupported = encodeStudioBg3dShotPngInWorker([layer()], {
      workerFactory: () => unsupportedWorker,
    });
    unsupportedWorker.emit({
      version: STUDIO_BG3D_SHOT_PNG_WORKER_PROTOCOL_VERSION,
      kind: "unavailable",
      code: "offscreen-canvas",
    });
    const unsupportedError = await unsupported.catch((error: unknown) => error);
    expect(unsupportedError).toMatchObject({ code: "offscreen-unavailable" });
    expect(unsupportedWorker.terminateCalls).toBe(1);

    const preReadyWorker = new FakeWorker();
    const preReady = encodeStudioBg3dShotPngInWorker([layer()], {
      workerFactory: () => preReadyWorker,
    });
    preReadyWorker.emitError();
    const preReadyError = await preReady.catch((error: unknown) => error);
    expect(preReadyError).toMatchObject({ code: "worker-failed" });
  });

  it("keeps post-ready protocol, encode, runtime, and transfer failures terminal", async () => {
    const malformedWorker = new FakeWorker();
    const malformed = encodeStudioBg3dShotPngInWorker([layer()], {
      workerFactory: () => malformedWorker,
    });
    emitReady(malformedWorker);
    malformedWorker.emit({ kind: "result" });
    await expect(malformed).rejects.toMatchObject({ code: "protocol" });

    const encodeWorker = new FakeWorker();
    const encodeFailure = encodeStudioBg3dShotPngInWorker([layer()], {
      workerFactory: () => encodeWorker,
    });
    emitReady(encodeWorker);
    encodeWorker.emit({
      version: STUDIO_BG3D_SHOT_PNG_WORKER_PROTOCOL_VERSION,
      kind: "error",
      requestId: encodeWorker.requests[0]?.requestId,
      code: "encode-failed",
    });
    await expect(encodeFailure).rejects.toMatchObject({ code: "encode-failed" });

    const runtimeWorker = new FakeWorker();
    const runtimeFailure = encodeStudioBg3dShotPngInWorker([layer()], {
      workerFactory: () => runtimeWorker,
    });
    emitReady(runtimeWorker);
    runtimeWorker.emitError("messageerror");
    await expect(runtimeFailure).rejects.toMatchObject({ code: "worker-failed" });

    const transferWorker = new FakeWorker();
    transferWorker.throwOnPost = true;
    const transferFailure = encodeStudioBg3dShotPngInWorker([layer()], {
      workerFactory: () => transferWorker,
    });
    emitReady(transferWorker);
    await expect(transferFailure).rejects.toMatchObject({ code: "worker-failed" });

  });

  it("rejects forged PNG headers and dimensions after terminating the Worker", async () => {
    const worker = new FakeWorker();
    const pending = encodeStudioBg3dShotPngInWorker([layer("color", 2, 1)], {
      workerFactory: () => worker,
    });
    emitReady(worker);
    const request = worker.requests[0];
    if (!request) throw new Error("missing request");
    worker.emit(resultFor(request, png(1, 1)));

    await expect(pending).rejects.toMatchObject({ code: "protocol" });
    expect(worker.terminateCalls).toBe(1);
  });

  it("terminates on cancellation and treats startup and encode timeouts as terminal", async () => {
    const controller = new AbortController();
    const abortedWorker = new FakeWorker();
    const aborted = encodeStudioBg3dShotPngInWorker([layer()], {
      signal: controller.signal,
      workerFactory: () => abortedWorker,
    });
    controller.abort();
    const abortError = await aborted.catch((error: unknown) => error);
    expect(abortError).toMatchObject({ code: "aborted", name: "AbortError" });
    expect(abortedWorker.terminateCalls).toBe(1);

    vi.useFakeTimers();
    const startupWorker = new FakeWorker();
    const startup = encodeStudioBg3dShotPngInWorker([layer()], {
      workerFactory: () => startupWorker,
      startupTimeoutMs: 100,
    });
    const startupOutcome = startup.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(100);
    const startupError = await startupOutcome;
    expect(startupError).toMatchObject({ code: "timeout", name: "TimeoutError" });

    const encodeWorker = new FakeWorker();
    const timed = encodeStudioBg3dShotPngInWorker([layer()], {
      workerFactory: () => encodeWorker,
      timeoutMs: 100,
    });
    emitReady(encodeWorker);
    const timedOutcome = timed.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(100);
    const timedError = await timedOutcome;
    expect(timedError).toMatchObject({ code: "timeout", name: "TimeoutError" });
    expect(encodeWorker.terminateCalls).toBe(1);
  });

  it("does not allocate a Worker for an already-aborted request", async () => {
    const controller = new AbortController();
    controller.abort();
    const workerFactory = vi.fn(() => new FakeWorker());
    await expect(encodeStudioBg3dShotPngInWorker([layer()], {
      signal: controller.signal,
      workerFactory,
    })).rejects.toEqual(new StudioBg3dShotPngWorkerError("aborted"));
    expect(workerFactory).not.toHaveBeenCalled();
  });
});
