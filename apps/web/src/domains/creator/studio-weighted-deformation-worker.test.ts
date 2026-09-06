import { afterEach, describe, expect, it, vi } from "vitest";

import { applyStudioWeightedDeformation } from "./studio-weighted-deformation-provider";
import {
  createStudioWeightedDeformationWorkerClient,
  type StudioWeightedDeformationWorkerLike,
} from "./studio-weighted-deformation-worker-client";
import {
  installStudioWeightedDeformationWorkerHost,
  type StudioWeightedDeformationWorkerHostScope,
} from "./studio-weighted-deformation-worker-host";
import {
  STUDIO_WEIGHTED_DEFORMATION_WORKER_PROTOCOL_VERSION,
  isStudioWeightedDeformationWorkerInboundMessage,
  isStudioWeightedDeformationWorkerOutboundMessage,
  snapshotStudioWeightedDeformationWorkerRequest,
  snapshotStudioWeightedDeformationWorkerResult,
  studioWeightedDeformationRequestTransfers,
  studioWeightedDeformationResultTransfers,
  type StudioWeightedDeformationWorkerExecuteMessage,
  type StudioWeightedDeformationWorkerInboundMessage,
  type StudioWeightedDeformationWorkerOutboundMessage,
  type StudioWeightedDeformationWorkerRequest,
} from "./studio-weighted-deformation-worker-protocol";

interface MessageEventLike {
  readonly data: unknown;
}

interface ErrorEventLike {
  preventDefault?(): void;
}

function request(
  epoch = 1,
): StudioWeightedDeformationWorkerRequest {
  return {
    requestEpoch: epoch,
    currentEpoch: epoch,
    mesh: {
      dimension: 2,
      positions: new Float32Array([0, 0, 5, 0, 20, 0]),
      textureCoordinates: new Float32Array([
        0, 0,
        0.5, 0,
        1, 0,
      ]),
    },
    sources: [
      {
        id: "curve-a",
        dimension: 2,
        restPoints: new Float32Array([0, -1, 0, 1]),
        deformedPoints: new Float32Array([3, -1, 3, 1]),
        closed: false,
        radius: 10,
        falloff: 1,
        strength: 1,
      },
    ],
  };
}

class MemoryWorker implements StudioWeightedDeformationWorkerLike {
  readonly inbound: StudioWeightedDeformationWorkerInboundMessage[] = [];
  readonly transfers: Transferable[][] = [];
  terminated = false;
  autoReady = true;
  autoRespond = true;
  responseEpochOffset = 0;
  lastRawResult: ReturnType<
    typeof applyStudioWeightedDeformation
  > | null = null;
  private readonly messageListeners = new Set<
    (event: MessageEventLike) => void
  >();
  private readonly errorListeners = new Set<
    (event: ErrorEventLike) => void
  >();
  private readonly messageErrorListeners = new Set<
    (event: ErrorEventLike) => void
  >();

  addEventListener(
    type: "message" | "error" | "messageerror",
    listener:
      | ((event: MessageEventLike) => void)
      | ((event: ErrorEventLike) => void),
  ): void {
    if (type === "message") {
      this.messageListeners.add(
        listener as (event: MessageEventLike) => void,
      );
      if (this.autoReady && this.messageListeners.size === 1) {
        queueMicrotask(() => {
          if (!this.terminated) {
            this.emit({
              type: "studio-weighted-deformation/ready",
              version:
                STUDIO_WEIGHTED_DEFORMATION_WORKER_PROTOCOL_VERSION,
              currentEpoch: 0,
            });
          }
        });
      }
      return;
    }
    const listeners = type === "error"
      ? this.errorListeners
      : this.messageErrorListeners;
    listeners.add(listener as (event: ErrorEventLike) => void);
  }

  removeEventListener(
    type: "message" | "error" | "messageerror",
    listener:
      | ((event: MessageEventLike) => void)
      | ((event: ErrorEventLike) => void),
  ): void {
    if (type === "message") {
      this.messageListeners.delete(
        listener as (event: MessageEventLike) => void,
      );
      return;
    }
    const listeners = type === "error"
      ? this.errorListeners
      : this.messageErrorListeners;
    listeners.delete(listener as (event: ErrorEventLike) => void);
  }

  postMessage(
    message: StudioWeightedDeformationWorkerInboundMessage,
    transfer: Transferable[] = [],
  ): void {
    this.inbound.push(message);
    this.transfers.push(transfer);
    if (
      message.type !== "studio-weighted-deformation/execute"
      || !this.autoRespond
    ) {
      return;
    }
    const result = applyStudioWeightedDeformation(message.request);
    this.lastRawResult = result;
    queueMicrotask(() => {
      this.emit({
        type: "studio-weighted-deformation/result",
        version: STUDIO_WEIGHTED_DEFORMATION_WORKER_PROTOCOL_VERSION,
        requestId: message.requestId,
        requestEpoch:
          message.request.requestEpoch + this.responseEpochOffset,
        result,
      });
      if (result.status === "completed") {
        result.artifact.positions.fill(99);
      }
    });
  }

  emit(message: unknown): void {
    for (const listener of this.messageListeners) {
      listener({ data: message });
    }
  }

  fail(type: "error" | "messageerror"): void {
    const listeners = type === "error"
      ? this.errorListeners
      : this.messageErrorListeners;
    for (const listener of listeners) listener({});
  }

  terminate(): void {
    this.terminated = true;
  }
}

class MemoryHostScope
  implements StudioWeightedDeformationWorkerHostScope {
  readonly outbound: Array<{
    message: StudioWeightedDeformationWorkerOutboundMessage;
    transfer: Transferable[];
  }> = [];
  private readonly listeners = new Set<
    (event: MessageEventLike) => void
  >();

  postMessage(
    message: StudioWeightedDeformationWorkerOutboundMessage,
    transfer: Transferable[],
  ): void {
    this.outbound.push({ message, transfer });
  }

  addEventListener(
    _type: "message",
    listener: (event: MessageEventLike) => void,
  ): void {
    this.listeners.add(listener);
  }

  removeEventListener(
    _type: "message",
    listener: (event: MessageEventLike) => void,
  ): void {
    this.listeners.delete(listener);
  }

  dispatch(data: unknown): void {
    for (const listener of this.listeners) listener({ data });
  }
}

async function waitForExecute(worker: MemoryWorker): Promise<void> {
  await vi.waitFor(() => {
    expect(
      worker.inbound.some(
        ({ type }) => type === "studio-weighted-deformation/execute",
      ),
    ).toBe(true);
  });
}

function executeEnvelope(
  requestId: number,
  value: StudioWeightedDeformationWorkerRequest = request(),
): StudioWeightedDeformationWorkerExecuteMessage {
  return {
    type: "studio-weighted-deformation/execute",
    version: STUDIO_WEIGHTED_DEFORMATION_WORKER_PROTOCOL_VERSION,
    requestId,
    request: value,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Studio weighted deformation Worker protocol", () => {
  it("copies every input view and transfers only owned full buffers", () => {
    const original = request();
    const snapshot = snapshotStudioWeightedDeformationWorkerRequest(
      original,
    );
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;
    expect(snapshot.request.mesh.positions).not.toBe(
      original.mesh.positions,
    );
    expect(snapshot.request.mesh.textureCoordinates).not.toBe(
      original.mesh.textureCoordinates,
    );
    expect(snapshot.request.sources[0]?.restPoints).not.toBe(
      original.sources[0]?.restPoints,
    );
    const message = executeEnvelope(1, snapshot.request);
    const transfers = studioWeightedDeformationRequestTransfers(message);
    expect(transfers).toHaveLength(4);
    expect(new Set(transfers).size).toBe(4);

    snapshot.request.mesh.positions[0] = 40;
    expect(original.mesh.positions[0]).toBe(0);
    expect(isStudioWeightedDeformationWorkerInboundMessage(message)).toBe(
      true,
    );
    expect(isStudioWeightedDeformationWorkerInboundMessage({
      ...message,
      legacyMode: true,
    })).toBe(false);
  });

  it("rejects malformed arrays and work budgets before Worker execution", () => {
    expect(
      snapshotStudioWeightedDeformationWorkerRequest({
        ...request(),
        maximumWorkUnits: 1,
      }),
    ).toEqual({ ok: false, reason: "budget-exceeded" });
    expect(
      snapshotStudioWeightedDeformationWorkerRequest({
        ...request(),
        mesh: {
          dimension: 2,
          positions: new Float32Array([0, Number.NaN]),
        },
      }),
    ).toEqual({ ok: false, reason: "invalid-request" });
    expect(
      snapshotStudioWeightedDeformationWorkerRequest({
        ...request(),
        signal: new AbortController().signal,
      }),
    ).toEqual({ ok: false, reason: "invalid-request" });
  });

  it("copies completed output and validates receipt and output budgets", () => {
    const result = applyStudioWeightedDeformation(request());
    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    const snapshot = snapshotStudioWeightedDeformationWorkerResult(result);
    expect(snapshot?.status).toBe("completed");
    if (snapshot?.status !== "completed") return;
    expect(snapshot.artifact.positions).not.toBe(
      result.artifact.positions,
    );
    const response = {
      type: "studio-weighted-deformation/result",
      version: STUDIO_WEIGHTED_DEFORMATION_WORKER_PROTOCOL_VERSION,
      requestId: 1,
      requestEpoch: 1,
      result: snapshot,
    } as const;
    expect(isStudioWeightedDeformationWorkerOutboundMessage(response)).toBe(
      true,
    );
    expect(studioWeightedDeformationResultTransfers(response)).toEqual([
      snapshot.artifact.positions.buffer,
      snapshot.artifact.textureCoordinates?.buffer,
    ]);
    expect(snapshotStudioWeightedDeformationWorkerResult({
      ...result,
      artifact: {
        ...result.artifact,
        receipt: {
          ...result.artifact.receipt,
          influencedVertices: 99,
        },
      },
    })).toBeNull();
  });
});

describe("Studio weighted deformation Worker client", () => {
  it("fails closed without main-thread execution when construction fails", async () => {
    const client = createStudioWeightedDeformationWorkerClient({
      currentEpoch: 1,
      workerFactory: () => {
        throw new Error("unavailable");
      },
    });
    await expect(client.execute(request())).resolves.toMatchObject({
      status: "worker-failed",
      reason: "worker-unavailable",
      fallback: {
        execution: "dedicated-worker",
        mainThreadComputationFallback: false,
      },
    });
    expect(client.getDiagnostics().phase).toBe("unavailable");
  });

  it("executes through Worker, preserving caller and result ownership", async () => {
    const worker = new MemoryWorker();
    const client = createStudioWeightedDeformationWorkerClient({
      currentEpoch: 1,
      workerFactory: () => worker,
    });
    const candidate = request();
    const callerPositions = new Float32Array(candidate.mesh.positions);
    const result = await client.execute(candidate);
    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(Array.from(result.artifact.positions)).toEqual([
      3, 0,
      6.5, 0,
      20, 0,
    ]);
    expect(candidate.mesh.positions).toEqual(callerPositions);
    const execute = worker.inbound.find(
      ({ type }) => type === "studio-weighted-deformation/execute",
    );
    expect(execute?.type).toBe("studio-weighted-deformation/execute");
    if (execute?.type !== "studio-weighted-deformation/execute") return;
    expect(execute.request.mesh.positions).not.toBe(
      candidate.mesh.positions,
    );
    expect(worker.transfers.at(-1)).toHaveLength(4);
    expect(worker.lastRawResult?.status).toBe("completed");
    expect(result.artifact.positions[0]).toBe(3);
    client.dispose();
    expect(worker.terminated).toBe(true);
  });

  it("enforces one active operation with deterministic backpressure", async () => {
    const worker = new MemoryWorker();
    worker.autoRespond = false;
    const client = createStudioWeightedDeformationWorkerClient({
      currentEpoch: 1,
      workerFactory: () => worker,
    });
    const first = client.execute(request());
    await waitForExecute(worker);
    await expect(client.execute(request())).resolves.toMatchObject({
      status: "worker-failed",
      reason: "backpressure",
    });
    expect(
      worker.inbound.filter(
        ({ type }) => type === "studio-weighted-deformation/execute",
      ),
    ).toHaveLength(1);
    client.dispose();
    await expect(first).resolves.toMatchObject({
      status: "worker-failed",
      reason: "disposed",
    });
  });

  it("hard-cancels synchronous work and starts a fresh Worker afterward", async () => {
    const firstWorker = new MemoryWorker();
    firstWorker.autoRespond = false;
    const secondWorker = new MemoryWorker();
    const workers = [firstWorker, secondWorker];
    const client = createStudioWeightedDeformationWorkerClient({
      currentEpoch: 1,
      workerFactory: () => {
        const worker = workers.shift();
        if (worker === undefined) throw new Error("no Worker");
        return worker;
      },
    });
    const controller = new AbortController();
    const first = client.execute(request(), controller.signal);
    await waitForExecute(firstWorker);
    controller.abort();
    await expect(first).resolves.toEqual({ status: "cancelled" });
    expect(firstWorker.inbound.map(({ type }) => type)).toContain(
      "studio-weighted-deformation/cancel",
    );
    expect(firstWorker.terminated).toBe(true);

    await expect(client.execute(request())).resolves.toMatchObject({
      status: "completed",
    });
    expect(client.getDiagnostics().workerGeneration).toBe(2);
  });

  it("invalidates active work and rejects stale Worker results", async () => {
    const firstWorker = new MemoryWorker();
    firstWorker.autoRespond = false;
    const secondWorker = new MemoryWorker();
    secondWorker.responseEpochOffset = 1;
    const workers = [firstWorker, secondWorker];
    const client = createStudioWeightedDeformationWorkerClient({
      currentEpoch: 1,
      workerFactory: () => {
        const worker = workers.shift();
        if (worker === undefined) throw new Error("no Worker");
        return worker;
      },
    });
    const first = client.execute(request());
    await waitForExecute(firstWorker);
    expect(client.advanceCurrentEpoch(2)).toBe(true);
    await expect(first).resolves.toEqual({
      status: "rejected",
      reason: "stale-epoch",
    });
    expect(firstWorker.terminated).toBe(true);

    const staleEnvelope = client.execute(request(2));
    await expect(staleEnvelope).resolves.toEqual({
      status: "rejected",
      reason: "stale-epoch",
    });
    expect(secondWorker.terminated).toBe(true);
  });

  it.each(["error", "messageerror"] as const)(
    "fails closed and terminates on Worker %s",
    async (failureType) => {
      const worker = new MemoryWorker();
      worker.autoRespond = false;
      const client = createStudioWeightedDeformationWorkerClient({
        currentEpoch: 1,
        workerFactory: () => worker,
      });
      const execution = client.execute(request());
      await waitForExecute(worker);
      worker.fail(failureType);
      await expect(execution).resolves.toMatchObject({
        status: "worker-failed",
        reason: "worker-unavailable",
      });
      expect(worker.terminated).toBe(true);
    },
  );

  it("fails closed on malformed messages and operation timeout", async () => {
    const malformedWorker = new MemoryWorker();
    malformedWorker.autoRespond = false;
    const malformedClient = createStudioWeightedDeformationWorkerClient({
      currentEpoch: 1,
      workerFactory: () => malformedWorker,
    });
    const malformedExecution = malformedClient.execute(request());
    await waitForExecute(malformedWorker);
    malformedWorker.emit({ type: "legacy/deformation-result" });
    await expect(malformedExecution).resolves.toMatchObject({
      status: "worker-failed",
      reason: "protocol-error",
    });
    expect(malformedWorker.terminated).toBe(true);

    vi.useFakeTimers();
    const timeoutWorker = new MemoryWorker();
    timeoutWorker.autoRespond = false;
    const timeoutClient = createStudioWeightedDeformationWorkerClient({
      currentEpoch: 1,
      operationTimeoutMs: 25,
      workerFactory: () => timeoutWorker,
    });
    const timeoutExecution = timeoutClient.execute(request());
    await vi.runAllTicks();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(25);
    await expect(timeoutExecution).resolves.toMatchObject({
      status: "worker-failed",
      reason: "operation-timeout",
    });
    expect(timeoutWorker.terminated).toBe(true);
  });

  it("rejects structurally valid results that do not match the request", async () => {
    const worker = new MemoryWorker();
    worker.autoRespond = false;
    const client = createStudioWeightedDeformationWorkerClient({
      currentEpoch: 1,
      workerFactory: () => worker,
    });
    const execution = client.execute(request());
    await waitForExecute(worker);
    const execute = worker.inbound.find(
      ({ type }) => type === "studio-weighted-deformation/execute",
    );
    if (execute?.type !== "studio-weighted-deformation/execute") {
      throw new Error("execute message missing");
    }
    const result = applyStudioWeightedDeformation(execute.request);
    if (result.status !== "completed") {
      throw new Error("deformation did not complete");
    }
    worker.emit({
      type: "studio-weighted-deformation/result",
      version: STUDIO_WEIGHTED_DEFORMATION_WORKER_PROTOCOL_VERSION,
      requestId: execute.requestId,
      requestEpoch: 1,
      result: {
        ...result,
        artifact: {
          ...result.artifact,
          receipt: {
            ...result.artifact.receipt,
            sourceCount: 2,
          },
        },
      },
    });
    await expect(execution).resolves.toMatchObject({
      status: "worker-failed",
      reason: "protocol-error",
    });
    expect(worker.terminated).toBe(true);
  });

  it("rejects a self-consistent result for different positions and texture coordinates", async () => {
    const worker = new MemoryWorker();
    worker.autoRespond = false;
    const client = createStudioWeightedDeformationWorkerClient({
      currentEpoch: 1,
      workerFactory: () => worker,
    });
    const execution = client.execute(request());
    await waitForExecute(worker);
    const execute = worker.inbound.find(
      ({ type }) => type === "studio-weighted-deformation/execute",
    );
    if (execute?.type !== "studio-weighted-deformation/execute") {
      throw new Error("execute message missing");
    }
    const otherRequest = request();
    otherRequest.mesh.positions[0] = 100;
    otherRequest.mesh.textureCoordinates![0] = 0.75;
    const otherResult = applyStudioWeightedDeformation(otherRequest);
    if (otherResult.status !== "completed") {
      throw new Error("alternate deformation did not complete");
    }
    worker.emit({
      type: "studio-weighted-deformation/result",
      version: STUDIO_WEIGHTED_DEFORMATION_WORKER_PROTOCOL_VERSION,
      requestId: execute.requestId,
      requestEpoch: 1,
      result: otherResult,
    });
    await expect(execution).resolves.toMatchObject({
      status: "worker-failed",
      reason: "protocol-error",
    });
    expect(worker.terminated).toBe(true);
  });

  it("fails closed on startup timeout and settles disposal", async () => {
    vi.useFakeTimers();
    const worker = new MemoryWorker();
    worker.autoReady = false;
    const client = createStudioWeightedDeformationWorkerClient({
      currentEpoch: 1,
      startupTimeoutMs: 25,
      workerFactory: () => worker,
    });
    const execution = client.execute(request());
    await vi.advanceTimersByTimeAsync(25);
    await expect(execution).resolves.toMatchObject({
      status: "worker-failed",
      reason: "startup-timeout",
    });
    expect(worker.inbound).toEqual([]);
    expect(worker.terminated).toBe(true);
    client.dispose();
    await expect(client.execute(request())).resolves.toMatchObject({
      status: "worker-failed",
      reason: "disposed",
    });
  });

  it("settles a startup reservation as disposed and terminates its Worker", async () => {
    const worker = new MemoryWorker();
    worker.autoReady = false;
    const client = createStudioWeightedDeformationWorkerClient({
      currentEpoch: 1,
      workerFactory: () => worker,
    });
    const execution = client.execute(request());
    await vi.waitFor(() => {
      expect(client.getDiagnostics().phase).toBe("starting");
    });
    client.dispose();
    await expect(execution).resolves.toMatchObject({
      status: "worker-failed",
      reason: "disposed",
    });
    expect(worker.terminated).toBe(true);
  });
});

describe("Studio weighted deformation Worker host", () => {
  it("releases admission on epoch advance even if an executor never settles", async () => {
    const scope = new MemoryHostScope();
    const execute = vi.fn(() => new Promise<never>(() => {}));
    installStudioWeightedDeformationWorkerHost(scope, {
      currentEpoch: 1,
      execute,
    });
    scope.dispatch(executeEnvelope(1));
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    scope.dispatch({
      type: "studio-weighted-deformation/advance-epoch",
      version: STUDIO_WEIGHTED_DEFORMATION_WORKER_PROTOCOL_VERSION,
      currentEpoch: 2,
    });
    scope.dispatch(executeEnvelope(2, request(2)));
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
  });

  it("executes the CPU oracle behind the host and emits owned transfers", async () => {
    const scope = new MemoryHostScope();
    const host = installStudioWeightedDeformationWorkerHost(scope, {
      currentEpoch: 1,
    });
    const candidate = request();
    const original = new Float32Array(candidate.mesh.positions);
    scope.dispatch(executeEnvelope(7, candidate));
    await vi.waitFor(() => expect(scope.outbound).toHaveLength(2));
    expect(scope.outbound[0]?.message).toEqual({
      type: "studio-weighted-deformation/ready",
      version: STUDIO_WEIGHTED_DEFORMATION_WORKER_PROTOCOL_VERSION,
      currentEpoch: 1,
    });
    const response = scope.outbound[1];
    expect(response?.message).toMatchObject({
      type: "studio-weighted-deformation/result",
      requestId: 7,
      requestEpoch: 1,
      result: { status: "completed" },
    });
    expect(response?.transfer).toHaveLength(2);
    expect(candidate.mesh.positions).toEqual(original);
    host.dispose();
  });

  it("applies host backpressure, cancellation and epoch invalidation", async () => {
    let resolveExecution!: (
      value: ReturnType<typeof applyStudioWeightedDeformation>,
    ) => void;
    const execution = new Promise<
      ReturnType<typeof applyStudioWeightedDeformation>
    >((resolve) => {
      resolveExecution = resolve;
    });
    const scope = new MemoryHostScope();
    const host = installStudioWeightedDeformationWorkerHost(scope, {
      currentEpoch: 1,
      execute: () => execution,
    });
    scope.dispatch(executeEnvelope(1));
    await vi.waitFor(() => expect(host.activeRequestId()).toBe(1));
    scope.dispatch(executeEnvelope(2));
    expect(scope.outbound[1]?.message).toMatchObject({
      type: "studio-weighted-deformation/result",
      requestId: 2,
      result: { status: "worker-failed", reason: "backpressure" },
    });
    scope.dispatch({
      type: "studio-weighted-deformation/advance-epoch",
      version: STUDIO_WEIGHTED_DEFORMATION_WORKER_PROTOCOL_VERSION,
      currentEpoch: 2,
    });
    expect(host.currentEpoch()).toBe(2);
    const complete = applyStudioWeightedDeformation(request());
    resolveExecution(complete);
    await vi.waitFor(() => expect(scope.outbound).toHaveLength(3));
    expect(scope.outbound[2]?.message).toMatchObject({
      requestId: 1,
      requestEpoch: 1,
      result: { status: "rejected", reason: "stale-epoch" },
    });
    host.dispose();
  });

  it("rejects addressable malformed messages before executing", () => {
    const execute = vi.fn(applyStudioWeightedDeformation);
    const scope = new MemoryHostScope();
    const host = installStudioWeightedDeformationWorkerHost(scope, {
      currentEpoch: 1,
      execute,
    });
    scope.dispatch({
      type: "legacy/deform",
      requestId: 9,
      payload: request(),
    });
    expect(scope.outbound[1]?.message).toMatchObject({
      type: "studio-weighted-deformation/result",
      requestId: 9,
      result: { status: "worker-failed", reason: "invalid-message" },
    });
    expect(execute).not.toHaveBeenCalled();
    host.dispose();
  });
});
