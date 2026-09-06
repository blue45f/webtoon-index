import { afterEach, describe, expect, it, vi } from "vitest";

import {
  parseStudioCrdtRasterDocumentRoots,
  type StudioCrdtRasterDocumentSnapshot,
  type StudioCrdtRasterRawRoots,
} from "../../../shared/lib/studio-crdt-raster-document-contract";

import {
  runStudioCrdtRasterWorker,
  type StudioCrdtRasterWorkerLike,
} from "./studio-crdt-raster-worker-client";

import type {
  StudioCrdtRasterWorkerResponseMessage,
  StudioCrdtRasterWorkerRunMessage,
} from "./studio-crdt-raster-worker-protocol";

const EMPTY_ROOTS: StudioCrdtRasterRawRoots = {
  surfaces: [],
  operations: [],
  undoOperations: [],
  undoAcknowledgements: [],
  checkpoints: [],
};

class ControlledWorker implements StudioCrdtRasterWorkerLike {
  onmessage: StudioCrdtRasterWorkerLike["onmessage"] = null;
  onerror: StudioCrdtRasterWorkerLike["onerror"] = null;
  message: StudioCrdtRasterWorkerRunMessage | null = null;
  terminateCount = 0;

  constructor(private readonly postError?: unknown) {}

  postMessage(message: StudioCrdtRasterWorkerRunMessage): void {
    if (this.postError !== undefined) throw this.postError;
    this.message = message;
  }

  terminate(): void {
    this.terminateCount += 1;
  }

  ready(): void {
    this.onmessage?.({
      data: { type: "studio-crdt-raster/ready", version: 1 },
    } as MessageEvent<StudioCrdtRasterWorkerResponseMessage>);
  }

  success(snapshot: StudioCrdtRasterDocumentSnapshot): void {
    this.onmessage?.({
      data: { type: "studio-crdt-raster/success", version: 1, snapshot },
    } as MessageEvent<StudioCrdtRasterWorkerResponseMessage>);
  }

  fail(message: string): void {
    this.onerror?.({ message });
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe("runStudioCrdtRasterWorker", () => {
  it("runs the parser directly only when direct mode was selected up front", async () => {
    const factory = vi.fn(() => null);
    const expected = parseStudioCrdtRasterDocumentRoots(EMPTY_ROOTS);

    await expect(runStudioCrdtRasterWorker(EMPTY_ROOTS, {
      executionMode: "direct",
      workerFactory: factory,
    })).resolves.toEqual({ execution: "direct", snapshot: expected });
    expect(factory).not.toHaveBeenCalled();
  });

  it.each([
    ["null factory", null],
    ["throwing factory", () => { throw new Error("blocked by CSP"); }],
  ] as const)("rejects %s without parsing on the main thread", async (_label, workerFactory) => {
    await expect(runStudioCrdtRasterWorker(EMPTY_ROOTS, { workerFactory })).rejects.toMatchObject({
      name: "StudioCrdtRasterWorkerUnavailableError",
    });
  });

  it("accepts the selected Worker result and never invokes another backend", async () => {
    const worker = new ControlledWorker();
    const pending = runStudioCrdtRasterWorker(EMPTY_ROOTS, { workerFactory: () => worker });
    worker.ready();
    const expected = parseStudioCrdtRasterDocumentRoots(EMPTY_ROOTS);
    worker.success(expected);
    await expect(pending).resolves.toEqual({ execution: "worker", snapshot: expected });
    expect(worker.terminateCount).toBe(1);
  });

  it("keeps pre-ready, post, runtime, and ready-timeout failures terminal", async () => {
    const loadWorker = new ControlledWorker();
    const load = runStudioCrdtRasterWorker(EMPTY_ROOTS, { workerFactory: () => loadWorker });
    loadWorker.fail("module load failed");
    await expect(load).rejects.toMatchObject({ name: "StudioCrdtRasterWorkerUnavailableError" });

    const postWorker = new ControlledWorker(new Error("post failed"));
    const post = runStudioCrdtRasterWorker(EMPTY_ROOTS, { workerFactory: () => postWorker });
    postWorker.ready();
    await expect(post).rejects.toMatchObject({ name: "StudioCrdtRasterWorkerUnavailableError" });

    const runtimeWorker = new ControlledWorker();
    const runtime = runStudioCrdtRasterWorker(EMPTY_ROOTS, { workerFactory: () => runtimeWorker });
    runtimeWorker.ready();
    runtimeWorker.fail("runtime failed");
    await expect(runtime).rejects.toThrow("runtime failed");

    vi.useFakeTimers();
    const timeoutWorker = new ControlledWorker();
    const timeout = runStudioCrdtRasterWorker(EMPTY_ROOTS, {
      workerFactory: () => timeoutWorker,
    });
    const rejection = expect(timeout).rejects.toMatchObject({
      name: "StudioCrdtRasterWorkerUnavailableError",
    });
    await vi.advanceTimersByTimeAsync(3_001);
    await rejection;
    expect(timeoutWorker.message).toBeNull();
  });
});
