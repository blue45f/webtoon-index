import { describe, expect, it } from "vitest";

import { applyAdvancedFill } from "./studio-advanced-fill";
import {
  runStudioAdvancedFillWorker,
  type StudioAdvancedFillWorkerLike,
} from "./studio-advanced-fill-worker-client";
import { postprocessStudioAdvancedFillWorkerResult } from "./studio-advanced-fill-worker-postprocess";
import {
  studioAdvancedFillSuccessTransfers,
  type StudioAdvancedFillWorkerResponseMessage,
  type StudioAdvancedFillWorkerRunMessage,
  type StudioAdvancedFillWorkerRunRequest,
  type StudioAdvancedFillWorkerSuccessMessage,
} from "./studio-advanced-fill-worker-protocol";

function rgba(...pixels: Array<readonly [number, number, number, number]>): Uint8ClampedArray {
  return new Uint8ClampedArray(pixels.flat());
}

function requestFixture(includeReference = false): StudioAdvancedFillWorkerRunRequest {
  return {
    target: {
      data: rgba([0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]),
      width: 3,
      height: 1,
    },
    referenceImage: includeReference
      ? {
          data: rgba([0, 0, 0, 0], [0, 0, 0, 255], [0, 0, 0, 0]),
          width: 3,
          height: 1,
        }
      : undefined,
    referenceMask: includeReference
      ? { data: new Uint8Array([255, 255, 255]), width: 3, height: 1 }
      : undefined,
    seeds: [{ x: 0, y: 0 }],
    fill: [240, 80, 40, 255],
    options: { tolerance: 0, contiguous: true, maxAreaRatio: 1 },
  };
}

class ApplyingWorker implements StudioAdvancedFillWorkerLike {
  onmessage: StudioAdvancedFillWorkerLike["onmessage"] = null;
  onerror: StudioAdvancedFillWorkerLike["onerror"] = null;
  terminateCount = 0;
  requestTransferCount = 0;

  constructor() {
    queueMicrotask(() => {
      this.onmessage?.({
        data: { type: "studio-advanced-fill/ready", version: 1 },
      } as MessageEvent<StudioAdvancedFillWorkerResponseMessage>);
    });
  }

  postMessage(message: StudioAdvancedFillWorkerRunMessage, transfer: Transferable[]): void {
    this.requestTransferCount = transfer.length;
    const received = structuredClone(message, { transfer });
    queueMicrotask(() => {
      if (this.terminateCount > 0) return;
      const response: StudioAdvancedFillWorkerSuccessMessage = {
        type: "studio-advanced-fill/success",
        version: received.version,
        originalTarget: received.request.target,
        result: postprocessStudioAdvancedFillWorkerResult(
          received.request,
          applyAdvancedFill(received.request),
        ),
      };
      const returned = structuredClone(response, {
        transfer: studioAdvancedFillSuccessTransfers(response),
      });
      this.onmessage?.({ data: returned } as MessageEvent<StudioAdvancedFillWorkerResponseMessage>);
    });
  }

  terminate(): void {
    this.terminateCount++;
  }
}

class HangingWorker implements StudioAdvancedFillWorkerLike {
  onmessage: StudioAdvancedFillWorkerLike["onmessage"] = null;
  onerror: StudioAdvancedFillWorkerLike["onerror"] = null;
  terminateCount = 0;

  constructor(emitReady = true) {
    if (emitReady) {
      queueMicrotask(() => {
        this.onmessage?.({
          data: { type: "studio-advanced-fill/ready", version: 1 },
        } as MessageEvent<StudioAdvancedFillWorkerResponseMessage>);
      });
    }
  }

  postMessage(): void {}

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
          type: "studio-advanced-fill/failure",
          version: 1,
          error: { name: "RangeError", message: "source is too large" },
        },
      } as MessageEvent<StudioAdvancedFillWorkerResponseMessage>);
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

describe("runStudioAdvancedFillWorker", () => {
  it("runs direct without detaching input only when direct mode is selected explicitly", async () => {
    const request = requestFixture();
    const targetData = request.target.data;

    const output = await runStudioAdvancedFillWorker(request, { executionMode: "direct" });

    expect(output.execution).toBe("direct");
    expect(output.originalTarget.data).toBe(targetData);
    expect(targetData.byteLength).toBe(12);
    expect(output.result.diagnostics.status).toBe("applied");
  });

  it("transfers target, reference, and mask ownership and returns target plus result buffers", async () => {
    const request = requestFixture(true);
    const originalTarget = [...request.target.data];
    const worker = new ApplyingWorker();

    const pending = runStudioAdvancedFillWorker(request, { workerFactory: () => worker });
    await Promise.resolve();
    expect(request.target.data.byteLength).toBe(0);
    expect(request.referenceImage?.data.byteLength).toBe(0);
    expect(request.referenceMask?.data.byteLength).toBe(0);

    const output = await pending;
    expect(output.execution).toBe("worker");
    expect(worker.requestTransferCount).toBe(3);
    expect(worker.terminateCount).toBe(1);
    expect([...output.originalTarget.data]).toEqual(originalTarget);
    expect(output.result.imageData.data.byteLength).toBe(12);
    expect(output.result.matchedMask.byteLength).toBe(3);
    expect(output.result.mask.byteLength).toBe(3);
    expect(output.result.diagnostics.paintedPixelCount).toBe(1);
  });

  it("strips browser lifecycle functions instead of falling back from DataCloneError", async () => {
    const request = requestFixture(true);
    Object.assign(request.target, { release() {} });
    Object.assign(request.referenceImage!, { release() {} });
    Object.assign(request.referenceMask!, { release() {} });
    const worker = new ApplyingWorker();

    const output = await runStudioAdvancedFillWorker(request, { workerFactory: () => worker });

    expect(output.execution).toBe("worker");
    expect(worker.requestTransferCount).toBe(3);
    expect(worker.terminateCount).toBe(1);
    expect(output.result.diagnostics.status).toBe("applied");
  });

  it("keeps edge softening on the worker side before returning the result", async () => {
    const request = { ...requestFixture(true), softenEdges: true };
    const worker = new ApplyingWorker();

    const output = await runStudioAdvancedFillWorker(request, { workerFactory: () => worker });

    expect(output.execution).toBe("worker");
    expect(output.result.imageData.data[3]).toBe(231);
  });

  it("enforces Alpha Lock and incremental diagnostics inside the worker", async () => {
    const request = { ...requestFixture(true), enforceAlphaLock: true };
    const worker = new ApplyingWorker();

    const output = await runStudioAdvancedFillWorker(request, { workerFactory: () => worker });

    expect(output.execution).toBe("worker");
    expect(output.result.diagnostics.status).toBe("noop");
    expect(output.result.diagnostics.paintedPixelCount).toBe(0);
    expect(output.result.imageData.data).toEqual(output.originalTarget.data);
  });

  it("transfers a separate immutable Alpha Lock source for continuous previews", async () => {
    const request = {
      ...requestFixture(true),
      enforceAlphaLock: true,
      alphaLockSource: {
        data: rgba([10, 10, 10, 255], [10, 10, 10, 255], [10, 10, 10, 255]),
        width: 3,
        height: 1,
      },
    };
    const worker = new ApplyingWorker();

    const output = await runStudioAdvancedFillWorker(request, { workerFactory: () => worker });

    expect(output.execution).toBe("worker");
    expect(worker.requestTransferCount).toBe(4);
    expect(request.alphaLockSource.data.byteLength).toBe(0);
    expect(output.result.diagnostics.paintedPixelCount).toBe(3);
    expect(output.result.imageData.data[3]).toBe(255);
  });

  it("terminates an in-flight worker and rejects with AbortError", async () => {
    const worker = new HangingWorker();
    const controller = new AbortController();
    const pending = runStudioAdvancedFillWorker(requestFixture(), {
      signal: controller.signal,
      workerFactory: () => worker,
    });

    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(worker.terminateCount).toBe(1);
  });

  it("rejects when Worker construction is blocked without running direct", async () => {
    await expect(runStudioAdvancedFillWorker(requestFixture(), {
      workerFactory: () => {
        throw new Error("worker blocked by policy");
      },
    })).rejects.toMatchObject({ name: "StudioAdvancedFillWorkerUnavailableError" });
  });

  it("rejects after an asynchronous module-load error before ownership transfer", async () => {
    const request = requestFixture();
    const targetData = request.target.data;
    const worker = new LoadErrorWorker();

    await expect(runStudioAdvancedFillWorker(request, { workerFactory: () => worker }))
      .rejects.toThrow("worker chunk failed to load");
    expect(targetData.byteLength).toBe(12);
    expect(worker.terminateCount).toBe(1);
  });

  it("fails closed before a large raster can block the main-thread fallback", async () => {
    const request = requestFixture();
    const oversized = {
      ...request,
      target: { data: new Uint8ClampedArray(0), width: 4 * 1024 * 1024 + 1, height: 1 },
    };

    await expect(
      runStudioAdvancedFillWorker(oversized, { executionMode: "direct" }),
    ).rejects.toThrow("직접 계산 안전 상한");
  });

  it("rejects when posting to the Worker is synchronously blocked", async () => {
    const worker = new ThrowingPostWorker();
    await expect(runStudioAdvancedFillWorker(requestFixture(), {
      workerFactory: () => worker,
    })).rejects.toMatchObject({ name: "StudioAdvancedFillWorkerUnavailableError" });
    expect(worker.terminateCount).toBe(1);
  });

  it("rejects when the selected Worker authority is unavailable", async () => {
    await expect(runStudioAdvancedFillWorker(requestFixture(), { workerFactory: null }))
      .rejects.toMatchObject({ name: "StudioAdvancedFillWorkerUnavailableError" });
  });

  it("preserves a serialized worker error name and message", async () => {
    const worker = new FailingWorker();
    await expect(
      runStudioAdvancedFillWorker(requestFixture(), { workerFactory: () => worker }),
    ).rejects.toMatchObject({ name: "RangeError", message: "source is too large" });
    expect(worker.terminateCount).toBe(1);
  });

  it("rejects an already-aborted request before constructing a worker", async () => {
    const controller = new AbortController();
    controller.abort();
    let factoryCalls = 0;

    await expect(
      runStudioAdvancedFillWorker(requestFixture(), {
        signal: controller.signal,
        workerFactory: () => {
          factoryCalls++;
          return new HangingWorker();
        },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(factoryCalls).toBe(0);
  });
});
