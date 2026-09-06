import { afterEach, describe, expect, it, vi } from "vitest";

import { smoothStrokePoints } from "../studio-brush";

import {
  STUDIO_STROKE_POSTPROCESS_WORKER_MAX_TIMEOUT_MS,
  StudioStrokePostprocessWorkerClient,
  StudioStrokePostprocessWorkerClientError,
  type StudioStrokePostprocessWorkerLike,
} from "./studio-stroke-postprocess-worker-client";
import { executeStudioStrokePostprocessWorkerRequest } from "./studio-stroke-postprocess-worker-runtime";

import type { StudioStrokePostprocessWorkerRunMessage } from "./studio-stroke-postprocess-worker-protocol";

function points(count: number): number[] {
  return Array.from({ length: count }, (_, index) => [
    index * 0.75,
    Math.sin(index / 5) * 9 + (index % 7) * 0.13,
  ]).flat();
}

class FakeWorker implements StudioStrokePostprocessWorkerLike {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: StudioStrokePostprocessWorkerLike["onerror"] = null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
  request: StudioStrokePostprocessWorkerRunMessage | null = null;
  transfers: Transferable[] = [];
  terminateCount = 0;
  postError: unknown = null;

  postMessage(message: StudioStrokePostprocessWorkerRunMessage, transfer: Transferable[]): void {
    if (this.postError) throw this.postError;
    this.request = message;
    this.transfers = transfer;
  }

  terminate(): void {
    this.terminateCount += 1;
  }

  emit(value: unknown): void {
    this.onmessage?.({ data: value } as MessageEvent<unknown>);
  }

  emitRuntimeResult(): void {
    if (!this.request) throw new Error("No request was posted.");
    this.emit(executeStudioStrokePostprocessWorkerRequest(this.request));
  }

  emitError(error: unknown = new Error("worker crashed")): void {
    this.onerror?.({ error, message: error instanceof Error ? error.message : "worker crashed" });
  }
}

function workerHarness() {
  const workers: FakeWorker[] = [];
  return {
    workers,
    factory: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("StudioStrokePostprocessWorkerClient", () => {
  it("uses an explicit immutable direct fallback for a small stroke", async () => {
    const original = points(120);
    const before = [...original];
    const factory = vi.fn(() => new FakeWorker());
    const client = new StudioStrokePostprocessWorkerClient({ workerFactory: factory });

    const result = await client.postprocess(original, 8, { preserveCorners: true });

    expect(factory).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      execution: "direct",
      fallbackReason: "below-worker-threshold",
      requestId: null,
      generationId: null,
    });
    expect(result.points).toEqual(smoothStrokePoints(before, 8, { preserveCorners: true, cornerThresholdDeg: 55 }));
    expect(result.points).not.toBe(original);
    expect(original).toEqual(before);
  });

  it("rejects and keeps the authoritative points unchanged when Worker support is unavailable", async () => {
    const original = points(2_048);
    const before = [...original];
    const client = new StudioStrokePostprocessWorkerClient({ workerFactory: null });

    await expect(client.postprocess(original, 10)).rejects.toMatchObject({
      code: "worker-unavailable",
    });
    expect(original).toEqual(before);
  });

  it("rejects rather than smoothing on the main thread when Worker construction throws", async () => {
    const original = points(2_048);
    const before = [...original];
    const client = new StudioStrokePostprocessWorkerClient({
      workerFactory: () => {
        throw new Error("worker blocked");
      },
    });

    await expect(client.postprocess(original, 10)).rejects.toMatchObject({
      code: "worker-unavailable",
    });
    expect(original).toEqual(before);
  });

  it("transfers a Float64 snapshot and returns deterministic Worker parity without mutating input", async () => {
    const harness = workerHarness();
    const client = new StudioStrokePostprocessWorkerClient({ workerFactory: harness.factory });
    const original = points(2_048);
    const before = [...original];

    const pending = client.postprocess(original, 10, {
      preserveCorners: true,
      cornerThresholdDeg: 70,
    });
    const worker = harness.workers[0];
    expect(worker?.request).toMatchObject({
      type: "studio-stroke-postprocess/run",
      requestId: 1,
      generationId: 1,
      pointCount: 2_048,
      strength: 10,
      options: { preserveCorners: true, cornerThresholdDeg: 70 },
    });
    expect(worker?.request?.points).toBeInstanceOf(Float64Array);
    expect(worker?.request?.points).not.toBe(original);
    expect(worker?.transfers).toEqual([worker?.request?.points.buffer]);

    worker?.emitRuntimeResult();
    const result = await pending;
    expect(result).toMatchObject({
      execution: "worker",
      fallbackReason: null,
      requestId: 1,
      generationId: 1,
      pointCount: 2_048,
    });
    expect(result.points).toEqual(smoothStrokePoints(before, 10, {
      preserveCorners: true,
      cornerThresholdDeg: 70,
    }));
    expect(original).toEqual(before);
    expect(worker?.terminateCount).toBe(1);
    expect(client.activeCount).toBe(0);
  });

  it("supports concurrent one-shot jobs and correlates out-of-order generations", async () => {
    const harness = workerHarness();
    const client = new StudioStrokePostprocessWorkerClient({ workerFactory: harness.factory });

    const first = client.postprocess(points(2_048), 10);
    const second = client.postprocess(points(2_100), 10);
    expect(harness.workers.map((worker) => ({
      requestId: worker.request?.requestId,
      generationId: worker.request?.generationId,
    }))).toEqual([
      { requestId: 1, generationId: 1 },
      { requestId: 2, generationId: 2 },
    ]);

    harness.workers[1]?.emitRuntimeResult();
    harness.workers[0]?.emitRuntimeResult();
    await expect(Promise.all([first, second])).resolves.toMatchObject([
      { requestId: 1, generationId: 1 },
      { requestId: 2, generationId: 2 },
    ]);
  });

  it("discards a stale response and accepts only the matching request generation", async () => {
    const harness = workerHarness();
    const client = new StudioStrokePostprocessWorkerClient({ workerFactory: harness.factory });
    const pending = client.postprocess(points(2_048), 10);
    const worker = harness.workers[0];
    const valid = worker?.request
      ? executeStudioStrokePostprocessWorkerRequest(worker.request)
      : null;
    if (!valid || valid.type !== "studio-stroke-postprocess/success") {
      throw new Error("Expected a valid runtime response.");
    }

    worker?.emit({ ...valid, requestId: valid.requestId + 99, generationId: valid.generationId + 99 });
    expect(client.activeCount).toBe(1);
    expect(worker?.terminateCount).toBe(0);
    worker?.emit(valid);

    await expect(pending).resolves.toMatchObject({ requestId: valid.requestId, generationId: valid.generationId });
    expect(worker?.terminateCount).toBe(1);
  });

  it("terminates on AbortSignal and ignores a late response from the discarded Worker", async () => {
    const harness = workerHarness();
    const controller = new AbortController();
    const client = new StudioStrokePostprocessWorkerClient({ workerFactory: harness.factory });
    const pending = client.postprocess(points(2_048), 10, { signal: controller.signal });
    const rejection = expect(pending).rejects.toMatchObject({ code: "aborted", name: "AbortError" });
    const worker = harness.workers[0];
    const late = worker?.request
      ? executeStudioStrokePostprocessWorkerRequest(worker.request)
      : null;

    controller.abort();
    await rejection;
    expect(worker?.terminateCount).toBe(1);
    worker?.emit(late);
    expect(client.activeCount).toBe(0);
  });

  it("enforces a hard timeout, discards the Worker, and creates a fresh generation next time", async () => {
    vi.useFakeTimers();
    const harness = workerHarness();
    const client = new StudioStrokePostprocessWorkerClient({
      workerFactory: harness.factory,
      timeoutMs: 25,
    });
    const first = client.postprocess(points(2_048), 10);
    const firstRejection = expect(first).rejects.toMatchObject({ code: "timeout", name: "TimeoutError" });

    await vi.advanceTimersByTimeAsync(25);
    await firstRejection;
    expect(harness.workers[0]?.terminateCount).toBe(1);

    const second = client.postprocess(points(2_048), 10);
    expect(harness.workers[1]?.request).toMatchObject({ requestId: 2, generationId: 2 });
    harness.workers[1]?.emitRuntimeResult();
    await expect(second).resolves.toMatchObject({ requestId: 2, generationId: 2 });
  });

  it("discards a crashed Worker and does not reuse it for the next request", async () => {
    const harness = workerHarness();
    const client = new StudioStrokePostprocessWorkerClient({ workerFactory: harness.factory });
    const first = client.postprocess(points(2_048), 10);
    const firstRejection = expect(first).rejects.toMatchObject({ code: "worker-failed" });

    harness.workers[0]?.emitError();
    await firstRejection;
    expect(harness.workers[0]?.terminateCount).toBe(1);

    const second = client.postprocess(points(2_048), 10);
    expect(harness.workers).toHaveLength(2);
    harness.workers[1]?.emitRuntimeResult();
    await expect(second).resolves.toMatchObject({ generationId: 2 });
  });

  it("rejects malformed, over-budget, post-failed, and disposed requests fail-closed", async () => {
    const factoryWorker = new FakeWorker();
    factoryWorker.postError = new DOMException("clone failed", "DataCloneError");
    const client = new StudioStrokePostprocessWorkerClient({ workerFactory: () => factoryWorker });

    await expect(client.postprocess([0, 0, 1], 8)).rejects.toMatchObject({ code: "invalid-input" });
    await expect(client.postprocess([0, 0, Number.NaN, 1, 2, 2], 8)).rejects.toMatchObject({
      code: "invalid-input",
    });
    await expect(client.postprocess(points(131_073), 10)).rejects.toMatchObject({
      code: "budget-exceeded",
    });
    await expect(client.postprocess(points(2_048), 10)).rejects.toMatchObject({ code: "post-failed" });
    expect(factoryWorker.terminateCount).toBe(1);

    client.dispose();
    await expect(client.postprocess(points(10), 5)).rejects.toMatchObject({ code: "disposed" });
  });

  it("rejects pre-aborted work without allocating a Worker and bounds timeout configuration", async () => {
    const controller = new AbortController();
    controller.abort();
    const factory = vi.fn(() => new FakeWorker());
    const client = new StudioStrokePostprocessWorkerClient({ workerFactory: factory });

    await expect(client.postprocess(points(2_048), 10, { signal: controller.signal })).rejects.toMatchObject({
      code: "aborted",
      name: "AbortError",
    });
    expect(factory).not.toHaveBeenCalled();
    expect(() => new StudioStrokePostprocessWorkerClient({
      workerFactory: factory,
      timeoutMs: STUDIO_STROKE_POSTPROCESS_WORKER_MAX_TIMEOUT_MS + 1,
    })).toThrow(RangeError);
  });

  it("rejects a correlated but malformed response as a protocol failure", async () => {
    const harness = workerHarness();
    const client = new StudioStrokePostprocessWorkerClient({ workerFactory: harness.factory });
    const pending = client.postprocess(points(2_048), 10);
    const rejection = expect(pending).rejects.toBeInstanceOf(StudioStrokePostprocessWorkerClientError);
    const request = harness.workers[0]?.request;

    harness.workers[0]?.emit({
      type: "studio-stroke-postprocess/success",
      version: 1,
      requestId: request?.requestId,
      generationId: request?.generationId,
      pointCount: request?.pointCount,
      coordinateByteLength: 8,
      points: new Float64Array([0]),
    });

    await rejection;
    expect(harness.workers[0]?.terminateCount).toBe(1);
  });
});
