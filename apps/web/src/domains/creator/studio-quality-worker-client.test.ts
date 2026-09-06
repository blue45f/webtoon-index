import { afterEach, describe, expect, it, vi } from "vitest";

import {
  StudioQualityWorkerClient,
  StudioQualityWorkerClientError,
  type StudioQualityWorkerLike,
} from "./studio-quality-worker-client";
import {
  STUDIO_QUALITY_WORKER_BUDGETS,
  STUDIO_QUALITY_WORKER_PROTOCOL_REVISION,
  STUDIO_QUALITY_WORKER_PROVIDER_PROFILE,
  type StudioQualityWorkerInboundMessage,
  type StudioQualityWorkerResponseMessage,
} from "./studio-quality-worker-protocol";
import {
  createStudioQualityWorkerRuntime,
} from "./studio-quality-worker-runtime";

import type { StudioQualityEngine } from "./render/studio-canvaskit-adapter";

function fakeProvider(
  pathOp = vi.fn(() => ({ ok: true, pathData: "M0 0H10Z" } as const)),
): StudioQualityEngine {
  return {
    id: "canvaskit",
    capabilities: {
      textShaping: false,
      pathBoolean: true,
      strokeToPath: true,
      fontSubsetting: false,
    },
    shapeText() {
      throw new Error("not used");
    },
    pathOp,
    strokeToPath(pathData, style) {
      return { ok: true, pathData: `${pathData}|${style.widthPx}` };
    },
  };
}

function ready(epoch = 77): StudioQualityWorkerResponseMessage {
  return {
    type: "studio-quality/ready",
    protocolRevision: STUDIO_QUALITY_WORKER_PROTOCOL_REVISION,
    workerEpoch: epoch,
    providerProfile: STUDIO_QUALITY_WORKER_PROVIDER_PROFILE,
    providerId: "canvaskit",
    capabilities: {
      pathBoolean: true,
      strokeToPath: true,
    },
    limits: {
      maxQueuedRequests: STUDIO_QUALITY_WORKER_BUDGETS.maxQueuedRequests,
      maxInputPathCodeUnits:
        STUDIO_QUALITY_WORKER_BUDGETS.maxInputPathCodeUnits,
      maxTotalInputCodeUnits:
        STUDIO_QUALITY_WORKER_BUDGETS.maxTotalInputCodeUnits,
      maxOutputPathCodeUnits:
        STUDIO_QUALITY_WORKER_BUDGETS.maxOutputPathCodeUnits,
    },
  };
}

class ControlledWorker implements StudioQualityWorkerLike {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: StudioQualityWorkerLike["onerror"] = null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
  readonly posted: StudioQualityWorkerInboundMessage[] = [];
  terminated = false;
  throwOnPost = false;

  postMessage(message: StudioQualityWorkerInboundMessage): void {
    if (this.throwOnPost) throw new Error("post failed");
    this.posted.push(structuredClone(message));
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(message: unknown): void {
    this.onmessage?.({ data: message } as MessageEvent<unknown>);
  }
}

class RuntimeLoopbackWorker implements StudioQualityWorkerLike {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: StudioQualityWorkerLike["onerror"] = null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
  readonly posted: StudioQualityWorkerInboundMessage[] = [];
  terminated = false;
  readonly runtime;

  constructor(providerFactory: () => Promise<StudioQualityEngine> | StudioQualityEngine) {
    this.runtime = createStudioQualityWorkerRuntime({
      port: {
        postMessage: (message) => {
          queueMicrotask(() => {
            if (!this.terminated) {
              this.onmessage?.({ data: structuredClone(message) } as MessageEvent<unknown>);
            }
          });
        },
      },
      providerFactory,
    });
  }

  postMessage(message: StudioQualityWorkerInboundMessage): void {
    this.posted.push(structuredClone(message));
    queueMicrotask(() => {
      if (!this.terminated) this.runtime.handleMessage(structuredClone(message));
    });
  }

  terminate(): void {
    this.terminated = true;
    this.runtime.dispose();
  }
}

async function flushMicrotasks(rounds = 12): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await Promise.resolve();
  }
}

function emittedResult(
  request: Extract<StudioQualityWorkerInboundMessage, { type: "studio-quality/request" }>,
  pathData = "M0 0Z",
): StudioQualityWorkerResponseMessage {
  return {
    type: "studio-quality/result",
    protocolRevision: STUDIO_QUALITY_WORKER_PROTOCOL_REVISION,
    workerEpoch: request.workerEpoch,
    requestId: request.requestId,
    requestToken: request.requestToken,
    operationKind: request.operation.kind,
    providerId: "canvaskit",
    result: { ok: true, pathData },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Studio quality Worker client", () => {
  it("lazily creates one persistent Worker/provider for concurrent operations", async () => {
    const providerFactory = vi.fn(() => fakeProvider());
    const worker = new RuntimeLoopbackWorker(providerFactory);
    const workerFactory = vi.fn(() => worker);
    const client = new StudioQualityWorkerClient({
      workerFactory,
      workerEpoch: 77,
    });

    expect(workerFactory).not.toHaveBeenCalled();
    const first = client.pathBoolean("M0 0Z", "M1 1Z", "union");
    const second = client.strokeToFill("M0 0L2 2", {
      widthPx: 4,
      cap: "round",
      join: "round",
      miterLimit: 4,
    });
    await expect(first).resolves.toMatchObject({
      workerEpoch: 77,
      requestId: 1,
      operationKind: "path-boolean",
      result: { ok: true, pathData: "M0 0H10Z" },
    });
    await expect(second).resolves.toMatchObject({
      workerEpoch: 77,
      requestId: 2,
      operationKind: "stroke-to-fill",
      result: { ok: true, pathData: "M0 0L2 2|4" },
    });
    expect(workerFactory).toHaveBeenCalledTimes(1);
    expect(providerFactory).toHaveBeenCalledTimes(1);
    expect(
      worker.posted.filter((message) => message.type === "studio-quality/initialize"),
    ).toHaveLength(1);
    client.dispose();
  });

  it("rejects malformed or oversized input before creating a Worker", async () => {
    const workerFactory = vi.fn(() => new ControlledWorker());
    const client = new StudioQualityWorkerClient({
      workerFactory,
      workerEpoch: 77,
    });
    await expect(
      client.pathBoolean("", "M0 0Z", "union"),
    ).rejects.toMatchObject({ code: "invalid-input" });
    await expect(
      client.strokeToFill("M0 0Z", {
        widthPx: 0,
        cap: "round",
        join: "round",
        miterLimit: 4,
      }),
    ).rejects.toMatchObject({ code: "invalid-input" });
    expect(workerFactory).not.toHaveBeenCalled();
    client.dispose();
  });

  it("snapshots mutable stroke style while initialization is pending", async () => {
    const worker = new ControlledWorker();
    const client = new StudioQualityWorkerClient({
      workerFactory: () => worker,
      workerEpoch: 77,
    });
    const style = {
      widthPx: 4,
      cap: "round" as const,
      join: "round" as const,
      miterLimit: 4,
      dash: { pattern: [2, 1], phase: 0 },
    };
    const promise = client.strokeToFill("M0 0L2 2", style);
    style.widthPx = 99;
    style.dash.pattern[0] = 99;
    worker.emit(ready());
    await flushMicrotasks();
    const posted = worker.posted.find(
      (message) => message.type === "studio-quality/request",
    );
    expect(posted).toMatchObject({
      operation: {
        kind: "stroke-to-fill",
        style: {
          widthPx: 4,
          dash: { pattern: [2, 1] },
        },
      },
    });
    if (!posted || posted.type !== "studio-quality/request") {
      throw new Error("request was not posted");
    }
    worker.emit(emittedResult(posted));
    await expect(promise).resolves.toMatchObject({ requestId: 1 });
    client.dispose();
  });

  it("sends correlated cancellation and rejects locally with AbortError", async () => {
    const worker = new ControlledWorker();
    const controller = new AbortController();
    const client = new StudioQualityWorkerClient({
      workerFactory: () => worker,
      workerEpoch: 77,
    });
    const promise = client.pathBoolean(
      "M0 0Z",
      "M1 1Z",
      "union",
      { signal: controller.signal },
    );
    worker.emit(ready());
    await flushMicrotasks();
    controller.abort();
    await expect(promise).rejects.toMatchObject({
      name: "AbortError",
      code: "aborted",
    });
    expect(worker.posted.at(-1)).toMatchObject({
      type: "studio-quality/cancel",
      workerEpoch: 77,
      requestId: 1,
      requestToken: "q:77:1:path-boolean",
      operationKind: "path-boolean",
    });
    client.dispose();
  });

  it("does not allocate a Worker for a pre-aborted operation", async () => {
    const workerFactory = vi.fn(() => new ControlledWorker());
    const controller = new AbortController();
    controller.abort();
    const client = new StudioQualityWorkerClient({
      workerFactory,
      workerEpoch: 77,
    });
    await expect(
      client.pathBoolean(
        "M0 0Z",
        "M1 1Z",
        "union",
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ code: "aborted" });
    expect(workerFactory).not.toHaveBeenCalled();
    client.dispose();
  });

  it("fails the session on a response with mismatched exact correlation", async () => {
    const worker = new ControlledWorker();
    const client = new StudioQualityWorkerClient({
      workerFactory: () => worker,
      workerEpoch: 77,
    });
    const promise = client.pathBoolean("M0 0Z", "M1 1Z", "union");
    worker.emit(ready());
    await flushMicrotasks();
    const posted = worker.posted.find(
      (message) => message.type === "studio-quality/request",
    );
    if (!posted || posted.type !== "studio-quality/request") {
      throw new Error("request was not posted");
    }
    worker.emit({
      ...emittedResult(posted),
      requestToken: "q:77:1:stroke-to-fill",
    });
    await expect(promise).rejects.toMatchObject({ code: "protocol" });
    expect(worker.terminated).toBe(true);
  });

  it("ignores a duplicate response for settled work without poisoning later requests", async () => {
    const worker = new ControlledWorker();
    const client = new StudioQualityWorkerClient({
      workerFactory: () => worker,
      workerEpoch: 77,
    });
    const firstPromise = client.pathBoolean("M0 0Z", "M1 1Z", "union");
    worker.emit(ready());
    await flushMicrotasks();
    const first = worker.posted.find(
      (message) => message.type === "studio-quality/request",
    );
    if (!first || first.type !== "studio-quality/request") {
      throw new Error("first request was not posted");
    }
    const firstResponse = emittedResult(first, "M-first");
    worker.emit(firstResponse);
    await expect(firstPromise).resolves.toMatchObject({ requestId: 1 });
    worker.emit(firstResponse);

    const secondPromise = client.pathBoolean("M2 2Z", "M3 3Z", "intersect");
    await flushMicrotasks();
    const requests = worker.posted.filter(
      (message) => message.type === "studio-quality/request",
    );
    const second = requests[1];
    if (!second || second.type !== "studio-quality/request") {
      throw new Error("second request was not posted");
    }
    worker.emit(emittedResult(second, "M-second"));
    await expect(secondPromise).resolves.toMatchObject({
      requestId: 2,
      result: { pathData: "M-second" },
    });
    expect(worker.terminated).toBe(false);
    client.dispose();
  });

  it("surfaces explicit provider initialization fatal responses", async () => {
    const worker = new ControlledWorker();
    const client = new StudioQualityWorkerClient({
      workerFactory: () => worker,
      workerEpoch: 77,
    });
    const promise = client.pathBoolean("M0 0Z", "M1 1Z", "union");
    worker.emit({
      type: "studio-quality/fatal",
      protocolRevision: STUDIO_QUALITY_WORKER_PROTOCOL_REVISION,
      workerEpoch: 77,
      requestId: null,
      stage: "initialization",
      error: {
        code: "provider-init-failed",
        message: "WASM init failed",
      },
    });
    await expect(promise).rejects.toMatchObject({
      code: "provider-init-failed",
      message: "WASM init failed",
    });
    expect(worker.terminated).toBe(true);
  });

  it("fails closed on malformed/future responses and Worker transport errors", async () => {
    const malformedWorker = new ControlledWorker();
    const malformedClient = new StudioQualityWorkerClient({
      workerFactory: () => malformedWorker,
      workerEpoch: 77,
    });
    const malformed = malformedClient.pathBoolean("M0 0Z", "M1 1Z", "union");
    malformedWorker.emit({
      ...ready(),
      protocolRevision: STUDIO_QUALITY_WORKER_PROTOCOL_REVISION + 1,
    });
    await expect(malformed).rejects.toMatchObject({ code: "protocol" });

    const crashedWorker = new ControlledWorker();
    const crashedClient = new StudioQualityWorkerClient({
      workerFactory: () => crashedWorker,
      workerEpoch: 78,
    });
    const crashed = crashedClient.pathBoolean("M0 0Z", "M1 1Z", "union");
    crashedWorker.onerror?.({
      error: new Error("worker crashed"),
      message: "worker crashed",
    });
    await expect(crashed).rejects.toMatchObject({
      code: "worker-failed",
      message: "worker crashed",
    });
  });

  it("enforces client queue depth while initialization is pending", async () => {
    const worker = new ControlledWorker();
    const client = new StudioQualityWorkerClient({
      workerFactory: () => worker,
      workerEpoch: 77,
    });
    const pending = Array.from(
      { length: STUDIO_QUALITY_WORKER_BUDGETS.maxQueuedRequests },
      (_, index) =>
        client.pathBoolean(`M${index} 0Z`, "M0 0Z", "union").catch(
          (error: unknown) => error,
        ),
    );
    await expect(
      client.pathBoolean("M-overflow", "M0 0Z", "union"),
    ).rejects.toMatchObject({ code: "queue-full" });
    client.dispose();
    await Promise.all(pending);
  });

  it("times out a posted request and emits best-effort cancellation", async () => {
    vi.useFakeTimers();
    const worker = new ControlledWorker();
    const client = new StudioQualityWorkerClient({
      workerFactory: () => worker,
      workerEpoch: 77,
      runTimeoutMs: 10,
    });
    const promise = client.pathBoolean("M0 0Z", "M1 1Z", "union");
    const rejection = expect(promise).rejects.toMatchObject({
      name: "TimeoutError",
      code: "timeout",
    });
    worker.emit(ready());
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(11);
    await rejection;
    expect(worker.posted.at(-1)).toMatchObject({
      type: "studio-quality/cancel",
      requestId: 1,
    });
    client.dispose();
  });

  it("posts dispose, rejects all work, and terminates ownership", async () => {
    const worker = new ControlledWorker();
    const client = new StudioQualityWorkerClient({
      workerFactory: () => worker,
      workerEpoch: 77,
    });
    const pending = client.pathBoolean("M0 0Z", "M1 1Z", "union");
    client.dispose();
    await expect(pending).rejects.toMatchObject({ code: "disposed" });
    expect(worker.posted.at(-1)).toEqual({
      type: "studio-quality/dispose",
      protocolRevision: STUDIO_QUALITY_WORKER_PROTOCOL_REVISION,
      workerEpoch: 77,
    });
    expect(worker.terminated).toBe(true);
    await expect(
      client.pathBoolean("M0 0Z", "M1 1Z", "union"),
    ).rejects.toMatchObject({ code: "disposed" });
  });

  it("maps postMessage failure to an explicit terminal client error", async () => {
    const worker = new ControlledWorker();
    worker.throwOnPost = true;
    const client = new StudioQualityWorkerClient({
      workerFactory: () => worker,
      workerEpoch: 77,
    });
    await expect(
      client.pathBoolean("M0 0Z", "M1 1Z", "union"),
    ).rejects.toMatchObject({ code: "post-failed" });
    expect(worker.terminated).toBe(true);
  });

  it("uses a typed client error surface", () => {
    const error = new StudioQualityWorkerClientError("invalid-input", "bad");
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({
      name: "StudioQualityWorkerClientError",
      code: "invalid-input",
      message: "bad",
    });
  });
});
