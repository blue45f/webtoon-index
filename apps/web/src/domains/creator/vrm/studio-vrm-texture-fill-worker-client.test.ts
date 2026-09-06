import { afterEach, describe, expect, it, vi } from "vitest";

import {
  runStudioVrmTextureFillWorker,
  type StudioVrmTextureFillWorkerLike,
} from "./studio-vrm-texture-fill-worker-client";
import {
  STUDIO_VRM_TEXTURE_FILL_WORKER_PROTOCOL_VERSION,
  type StudioVrmTextureFillWorkerRunMessage,
} from "./studio-vrm-texture-fill-worker-protocol";

import type {
  StudioVrmTextureFillRequest,
  StudioVrmTextureFillResult,
} from "./studio-vrm-texture-fill";

class FakeWorker implements StudioVrmTextureFillWorkerLike {
  onmessage: StudioVrmTextureFillWorkerLike["onmessage"] = null;
  onerror: StudioVrmTextureFillWorkerLike["onerror"] = null;
  onmessageerror: StudioVrmTextureFillWorkerLike["onmessageerror"] = null;
  readonly transfers: Transferable[][] = [];
  readonly postedMessages: StudioVrmTextureFillWorkerRunMessage[] = [];
  terminateCalls = 0;
  postError: unknown = null;

  postMessage(
    message: StudioVrmTextureFillWorkerRunMessage,
    transfer: Transferable[],
  ): void {
    if (this.postError) throw this.postError;
    this.transfers.push([...transfer]);
    this.postedMessages.push(
      structuredClone(message, { transfer }) as StudioVrmTextureFillWorkerRunMessage,
    );
  }

  terminate(): void {
    this.terminateCalls += 1;
  }

  emit(data: unknown): void {
    this.onmessage?.({ data });
  }

  emitReady(): void {
    this.emit({
      type: "studio-vrm-texture-fill/ready",
      version: STUDIO_VRM_TEXTURE_FILL_WORKER_PROTOCOL_VERSION,
    });
  }

  emitError(error = new Error("worker crash")): void {
    this.onerror?.({
      error,
      message: error.message,
      preventDefault: vi.fn(),
    });
  }

  emitMessageError(): void {
    this.onmessageerror?.({ data: null });
  }
}

function requestFixture(): StudioVrmTextureFillRequest {
  return {
    pixels: new Uint8ClampedArray([
      10, 20, 30, 255,
      10, 20, 30, 255,
      50, 60, 70, 255,
      10, 20, 30, 255,
    ]),
    width: 2,
    height: 2,
    seed: { x: 0, y: 0 },
    tolerance: 12,
    scope: "contiguous",
  };
}

function resultFixture(): StudioVrmTextureFillResult {
  return {
    bitMask: new Uint8Array([0b00001011]),
    bounds: { x: 0, y: 0, width: 2, height: 2 },
    matchedCount: 3,
    seedRgba: [10, 20, 30, 255],
  };
}

function postedRequestId(worker: FakeWorker): string {
  const message = worker.postedMessages.at(0);
  if (!message) throw new Error("Worker request was not posted.");
  return message.requestId;
}

function successMessage(
  requestId: string,
  result: StudioVrmTextureFillResult = resultFixture(),
): unknown {
  return {
    type: "studio-vrm-texture-fill/success",
    version: STUDIO_VRM_TEXTURE_FILL_WORKER_PROTOCOL_VERSION,
    requestId,
    result,
  };
}

function failureMessage(requestId: string): unknown {
  return {
    type: "studio-vrm-texture-fill/failure",
    version: STUDIO_VRM_TEXTURE_FILL_WORKER_PROTOCOL_VERSION,
    requestId,
    error: {
      name: "RangeError",
      message: "fill budget exceeded",
      code: "budget-exceeded",
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("runStudioVrmTextureFillWorker", () => {
  it("waits for ready, transfers exactly the caller pixel buffer, and cleans up on success", async () => {
    const worker = new FakeWorker();
    const request = requestFixture();
    const sourceBuffer = request.pixels.buffer;
    const pending = runStudioVrmTextureFillWorker(request, {
      workerFactory: () => worker,
    });

    expect(worker.postedMessages).toHaveLength(0);
    expect(request.pixels.byteLength).toBe(16);
    worker.emitReady();

    expect(worker.postedMessages).toHaveLength(1);
    expect(worker.transfers).toHaveLength(1);
    expect(worker.transfers[0]).toEqual([sourceBuffer]);
    expect(request.pixels.byteLength).toBe(0);
    expect(worker.postedMessages[0].request.pixels.byteLength).toBe(16);
    worker.emit(successMessage(postedRequestId(worker)));

    await expect(pending).resolves.toEqual({
      execution: "worker",
      result: resultFixture(),
    });
    expect(worker.terminateCalls).toBe(1);
    expect(worker.onmessage).toBeNull();
    expect(worker.onerror).toBeNull();
    expect(worker.onmessageerror).toBeNull();
  });

  it("snapshots clone-safe scalar fields before the ready handshake", async () => {
    const worker = new FakeWorker();
    const request = requestFixture();
    const mutableSeed = request.seed as { x: number; y: number };
    const pending = runStudioVrmTextureFillWorker(request, {
      workerFactory: () => worker,
    });

    mutableSeed.x = 1;
    mutableSeed.y = 1;
    (request as { tolerance: number }).tolerance = 200;
    (request as { scope: StudioVrmTextureFillRequest["scope"] }).scope = "whole-material";
    worker.emitReady();

    expect(worker.postedMessages[0].request).toMatchObject({
      seed: { x: 0, y: 0 },
      tolerance: 12,
      scope: "contiguous",
    });
    worker.emit(successMessage(postedRequestId(worker)));
    await expect(pending).resolves.toMatchObject({ execution: "worker" });
  });

  it("rejects non-owned or non-clone-safe requests before creating a Worker", async () => {
    const factory = vi.fn(() => new FakeWorker());
    const backing = new Uint8ClampedArray(20);
    const partial = backing.subarray(4, 20);
    const malformed = {
      ...requestFixture(),
      pixels: partial,
    } as StudioVrmTextureFillRequest;

    await expect(runStudioVrmTextureFillWorker(malformed, {
      workerFactory: factory,
    })).rejects.toMatchObject({ code: "invalid-request" });
    expect(factory).not.toHaveBeenCalled();
    expect(backing.byteLength).toBe(20);
  });

  it.each([
    ["explicitly unavailable", null],
    ["factory returned null", () => null],
  ] as const)("fails closed when the Worker is %s", async (_label, workerFactory) => {
    const request = requestFixture();

    await expect(runStudioVrmTextureFillWorker(request, {
      workerFactory,
    })).rejects.toMatchObject({ code: "worker-unavailable" });
    expect(request.pixels.byteLength).toBe(16);
  });

  it("fails closed when the Worker factory throws without consuming pixels", async () => {
    const request = requestFixture();

    await expect(runStudioVrmTextureFillWorker(request, {
      workerFactory: () => {
        throw new Error("CSP denied");
      },
    })).rejects.toMatchObject({
      code: "worker-unavailable",
      cause: expect.objectContaining({ message: "CSP denied" }),
    });
    expect(request.pixels.byteLength).toBe(16);
  });

  it("rejects a pre-aborted request before creating a Worker", async () => {
    const controller = new AbortController();
    const factory = vi.fn(() => new FakeWorker());
    controller.abort();

    await expect(runStudioVrmTextureFillWorker(requestFixture(), {
      signal: controller.signal,
      workerFactory: factory,
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(factory).not.toHaveBeenCalled();
  });

  it("aborts and terminates both before and after pixel transfer", async () => {
    const beforeWorker = new FakeWorker();
    const beforeController = new AbortController();
    const beforeRequest = requestFixture();
    const before = runStudioVrmTextureFillWorker(beforeRequest, {
      signal: beforeController.signal,
      workerFactory: () => beforeWorker,
    });
    beforeController.abort();
    await expect(before).rejects.toMatchObject({ name: "AbortError" });
    expect(beforeWorker.terminateCalls).toBe(1);
    expect(beforeRequest.pixels.byteLength).toBe(16);

    const afterWorker = new FakeWorker();
    const afterController = new AbortController();
    const afterRequest = requestFixture();
    const after = runStudioVrmTextureFillWorker(afterRequest, {
      signal: afterController.signal,
      workerFactory: () => afterWorker,
    });
    afterWorker.emitReady();
    afterController.abort();
    await expect(after).rejects.toMatchObject({ name: "AbortError" });
    expect(afterWorker.terminateCalls).toBe(1);
    expect(afterRequest.pixels.byteLength).toBe(0);
  });

  it("times out a silent pre-ready Worker and terminates without consuming pixels", async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const request = requestFixture();
    const pending = runStudioVrmTextureFillWorker(request, {
      readyTimeoutMs: 25,
      workerFactory: () => worker,
    });
    const rejection = expect(pending).rejects.toMatchObject({
      code: "worker-timeout",
      name: "TimeoutError",
    });

    await vi.advanceTimersByTimeAsync(25);
    await rejection;
    expect(worker.terminateCalls).toBe(1);
    expect(request.pixels.byteLength).toBe(16);
  });

  it("fails closed on Worker errors before and after ready", async () => {
    const beforeWorker = new FakeWorker();
    const beforeRequest = requestFixture();
    const before = runStudioVrmTextureFillWorker(beforeRequest, {
      workerFactory: () => beforeWorker,
    });
    beforeWorker.emitError(new Error("startup failed"));
    await expect(before).rejects.toMatchObject({ code: "worker-unavailable" });
    expect(beforeWorker.terminateCalls).toBe(1);
    expect(beforeRequest.pixels.byteLength).toBe(16);

    const afterWorker = new FakeWorker();
    const afterRequest = requestFixture();
    const after = runStudioVrmTextureFillWorker(afterRequest, {
      workerFactory: () => afterWorker,
    });
    afterWorker.emitReady();
    afterWorker.emitError(new Error("fill crashed"));
    await expect(after).rejects.toMatchObject({ code: "worker-runtime" });
    expect(afterWorker.terminateCalls).toBe(1);
    expect(afterRequest.pixels.byteLength).toBe(0);
  });

  it("rejects and terminates when postMessage throws instead of running directly", async () => {
    const worker = new FakeWorker();
    worker.postError = new DOMException("clone rejected", "DataCloneError");
    const request = requestFixture();
    const pending = runStudioVrmTextureFillWorker(request, {
      workerFactory: () => worker,
    });

    worker.emitReady();
    await expect(pending).rejects.toMatchObject({ code: "worker-post-failed" });
    expect(worker.terminateCalls).toBe(1);
    expect(request.pixels.byteLength).toBe(16);
  });

  it.each([
    ["success", (requestId: string) => successMessage(requestId)],
    ["failure", (requestId: string) => failureMessage(requestId)],
  ] as const)("rejects a %s response received before ready", async (_label, response) => {
    const worker = new FakeWorker();
    const pending = runStudioVrmTextureFillWorker(requestFixture(), {
      workerFactory: () => worker,
    });

    worker.emit(response("early-request"));
    await expect(pending).rejects.toMatchObject({ code: "worker-protocol" });
    expect(worker.terminateCalls).toBe(1);
  });

  it("rejects version and requestId mismatches", async () => {
    const versionWorker = new FakeWorker();
    const versionPending = runStudioVrmTextureFillWorker(requestFixture(), {
      workerFactory: () => versionWorker,
    });
    versionWorker.emit({
      type: "studio-vrm-texture-fill/ready",
      version: STUDIO_VRM_TEXTURE_FILL_WORKER_PROTOCOL_VERSION + 1,
    });
    await expect(versionPending).rejects.toMatchObject({ code: "worker-protocol" });
    expect(versionWorker.terminateCalls).toBe(1);

    const idWorker = new FakeWorker();
    const idPending = runStudioVrmTextureFillWorker(requestFixture(), {
      workerFactory: () => idWorker,
    });
    idWorker.emitReady();
    idWorker.emit(successMessage(`${postedRequestId(idWorker)}-stale`));
    await expect(idPending).rejects.toMatchObject({ code: "worker-protocol" });
    expect(idWorker.terminateCalls).toBe(1);
  });

  it("rejects a correlated result whose mask or bounds do not match the request", async () => {
    const maskWorker = new FakeWorker();
    const maskPending = runStudioVrmTextureFillWorker(requestFixture(), {
      workerFactory: () => maskWorker,
    });
    maskWorker.emitReady();
    maskWorker.emit(successMessage(postedRequestId(maskWorker), {
      ...resultFixture(),
      bitMask: new Uint8Array([0b00001011, 0]),
    }));
    await expect(maskPending).rejects.toMatchObject({ code: "worker-protocol" });
    expect(maskWorker.terminateCalls).toBe(1);

    const boundsWorker = new FakeWorker();
    const boundsPending = runStudioVrmTextureFillWorker(requestFixture(), {
      workerFactory: () => boundsWorker,
    });
    boundsWorker.emitReady();
    boundsWorker.emit(successMessage(postedRequestId(boundsWorker), {
      ...resultFixture(),
      bounds: { x: 1, y: 0, width: 2, height: 2 },
    }));
    await expect(boundsPending).rejects.toMatchObject({ code: "worker-protocol" });
    expect(boundsWorker.terminateCalls).toBe(1);
  });

  it("deserializes a correlated failure and preserves its code", async () => {
    const worker = new FakeWorker();
    const pending = runStudioVrmTextureFillWorker(requestFixture(), {
      workerFactory: () => worker,
    });
    worker.emitReady();
    worker.emit(failureMessage(postedRequestId(worker)));

    await expect(pending).rejects.toMatchObject({
      name: "RangeError",
      message: "fill budget exceeded",
      code: "budget-exceeded",
    });
    expect(worker.terminateCalls).toBe(1);
  });

  it("rejects a message clone failure and ignores duplicate terminal callbacks after settlement", async () => {
    const cloneWorker = new FakeWorker();
    const clonePending = runStudioVrmTextureFillWorker(requestFixture(), {
      workerFactory: () => cloneWorker,
    });
    cloneWorker.emitMessageError();
    await expect(clonePending).rejects.toMatchObject({ code: "worker-protocol" });
    expect(cloneWorker.terminateCalls).toBe(1);

    const worker = new FakeWorker();
    const pending = runStudioVrmTextureFillWorker(requestFixture(), {
      workerFactory: () => worker,
    });
    worker.emitReady();
    const terminalListener = worker.onmessage;
    const requestId = postedRequestId(worker);
    worker.emit(successMessage(requestId));
    await expect(pending).resolves.toMatchObject({ execution: "worker" });

    terminalListener?.({ data: failureMessage(requestId) });
    expect(worker.terminateCalls).toBe(1);
  });
});
