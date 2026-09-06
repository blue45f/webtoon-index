import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createStudioMultiLightSurfaceProvider,
  createStudioMultiLightSurfaceRecipe,
  STUDIO_MULTI_LIGHT_SURFACE_COLOR_CONTRACT,
  type StudioMultiLightSurfaceProvider,
  type StudioMultiLightSurfaceReceipt,
  type StudioMultiLightSurfaceRequest,
} from "./studio-multi-light-surface-provider";
import {
  createStudioMultiLightSurfaceWorkerClient,
  type StudioMultiLightSurfaceWorkerLike,
} from "./studio-multi-light-surface-worker-client";
import {
  installStudioMultiLightSurfaceWorkerHost,
  type StudioMultiLightSurfaceWorkerHostScope,
} from "./studio-multi-light-surface-worker-host";
import {
  isStudioMultiLightSurfaceWorkerInboundMessage,
  isStudioMultiLightSurfaceWorkerOutboundMessage,
  snapshotStudioMultiLightSurfaceWorkerRequest,
  snapshotStudioMultiLightSurfaceWorkerResult,
  STUDIO_MULTI_LIGHT_SURFACE_WORKER_PROTOCOL_VERSION,
  studioMultiLightSurfaceRequestTransfers,
  studioMultiLightSurfaceResultTransfers,
  type StudioMultiLightSurfaceWorkerExecuteMessage,
  type StudioMultiLightSurfaceWorkerInboundMessage,
  type StudioMultiLightSurfaceWorkerOutboundMessage,
  type StudioMultiLightSurfaceWorkerRequest,
} from "./studio-multi-light-surface-worker-protocol";

interface MessageEventLike {
  readonly data: unknown;
}

interface ErrorEventLike {
  preventDefault?(): void;
}

function recipe(allMaps = false) {
  const created = createStudioMultiLightSurfaceRecipe({
    height: allMaps
      ? { source: "separate", scale: 1 }
      : {
          source: "source",
          channel: "alpha",
          midpoint: 0.5,
          scale: 0,
        },
    normal: allMaps
      ? { source: "height-and-map", strength: 0.5 }
      : { source: "height" },
    material: {
      tint: [1, 1, 1],
      diffuseStrength: 1,
      specularStrength: 0.25,
      roughness: allMaps
        ? { source: "map", value: 0.5 }
        : { source: "constant", value: 0.5 },
      metalness: allMaps
        ? { source: "map", value: 0 }
        : { source: "constant", value: 0 },
    },
    ambient: { color: [1, 1, 1], intensity: 0.1 },
    lights: [
      {
        id: "rim",
        kind: "directional",
        direction: [0, 0, 1],
        color: [0.25, 0.5, 1],
        intensity: 1,
      },
      {
        id: "key",
        kind: "directional",
        direction: [0, 0, 1],
        color: [1, 0.5, 0.25],
        intensity: 1,
      },
    ],
  });
  if (created.status !== "ready") throw new Error(created.path);
  return created.recipe;
}

function request(
  deviceEpoch = 1,
  requestSequence = 1,
  allMaps = false,
): StudioMultiLightSurfaceWorkerRequest {
  return {
    requestSequence,
    deviceEpoch,
    recipe: recipe(allMaps),
    source: {
      kind: "studio-multi-light-surface-image",
      version: 1,
      width: 2,
      height: 1,
      colorContract: STUDIO_MULTI_LIGHT_SURFACE_COLOR_CONTRACT,
      data: new Float32Array([
        0.8, 0.4, 0.2, 0.75,
        0.2, 0.6, 0.9, 0.5,
      ]),
    },
    ...(allMaps
      ? {
          heightMap: {
            kind: "studio-multi-light-surface-scalar-map" as const,
            version: 1 as const,
            width: 2,
            height: 1,
            semantic: "signed-height" as const,
            data: new Float32Array([0, 0.25]),
          },
          roughnessMap: {
            kind: "studio-multi-light-surface-scalar-map" as const,
            version: 1 as const,
            width: 1,
            height: 1,
            semantic: "roughness" as const,
            data: new Float32Array([0.4]),
          },
          metalnessMap: {
            kind: "studio-multi-light-surface-scalar-map" as const,
            version: 1 as const,
            width: 1,
            height: 1,
            semantic: "metalness" as const,
            data: new Float32Array([0.15]),
          },
          normalMap: {
            kind: "studio-multi-light-surface-normal-map" as const,
            version: 1 as const,
            width: 1,
            height: 1,
            space: "surface" as const,
            data: new Float32Array([0, 0, 1]),
          },
        }
      : {}),
  };
}

function createProvider(epoch: number): StudioMultiLightSurfaceProvider {
  const created = createStudioMultiLightSurfaceProvider({
    initialDeviceEpoch: epoch,
  });
  if (created.status !== "ready") throw new Error(created.path);
  return created.provider;
}

class MemoryWorker implements StudioMultiLightSurfaceWorkerLike {
  readonly inbound: StudioMultiLightSurfaceWorkerInboundMessage[] = [];
  readonly transfers: Transferable[][] = [];
  terminated = false;
  autoReady = true;
  autoRespond = true;
  responseEpochOffset = 0;
  mutateAfterDelivery = false;
  private currentEpoch = 1;
  private provider = createProvider(1);
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
              type: "studio-multi-light-surface/ready",
              version: STUDIO_MULTI_LIGHT_SURFACE_WORKER_PROTOCOL_VERSION,
              currentEpoch: this.currentEpoch,
            });
          }
        });
      }
      return;
    }
    (type === "error"
      ? this.errorListeners
      : this.messageErrorListeners
    ).add(listener as (event: ErrorEventLike) => void);
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
    (type === "error"
      ? this.errorListeners
      : this.messageErrorListeners
    ).delete(listener as (event: ErrorEventLike) => void);
  }

  postMessage(
    message: StudioMultiLightSurfaceWorkerInboundMessage,
    transfer: Transferable[] = [],
  ): void {
    this.inbound.push(message);
    this.transfers.push(transfer);
    if (message.type === "studio-multi-light-surface/advance-epoch") {
      this.currentEpoch = message.currentEpoch;
      this.provider.dispose();
      this.provider = createProvider(this.currentEpoch);
      return;
    }
    if (
      message.type !== "studio-multi-light-surface/execute"
      || !this.autoRespond
    ) return;
    void this.provider.execute(message.request).then((receipt) => {
      const envelope = {
        type: "studio-multi-light-surface/result" as const,
        version: STUDIO_MULTI_LIGHT_SURFACE_WORKER_PROTOCOL_VERSION,
        requestId: message.requestId,
        deviceEpoch:
          message.request.deviceEpoch + this.responseEpochOffset,
        requestSequence: message.request.requestSequence,
        result: {
          status: "completed" as const,
          receipt,
        },
      };
      this.emit(envelope);
      if (this.mutateAfterDelivery) receipt.output.data.fill(99);
    });
  }

  emit(message: unknown): void {
    for (const listener of this.messageListeners) {
      listener({ data: message });
    }
  }

  fail(type: "error" | "messageerror"): void {
    for (const listener of (
      type === "error"
        ? this.errorListeners
        : this.messageErrorListeners
    )) listener({});
  }

  terminate(): void {
    this.terminated = true;
    this.provider.dispose();
  }
}

class MemoryHostScope implements StudioMultiLightSurfaceWorkerHostScope {
  readonly outbound: Array<{
    message: StudioMultiLightSurfaceWorkerOutboundMessage;
    transfer: Transferable[];
  }> = [];
  private readonly listeners = new Set<
    (event: MessageEventLike) => void
  >();

  postMessage(
    message: StudioMultiLightSurfaceWorkerOutboundMessage,
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

function envelope(
  requestId: number,
  value = request(),
): StudioMultiLightSurfaceWorkerExecuteMessage {
  return {
    type: "studio-multi-light-surface/execute",
    version: STUDIO_MULTI_LIGHT_SURFACE_WORKER_PROTOCOL_VERSION,
    requestId,
    request: value,
  };
}

async function receiptFor(
  value: StudioMultiLightSurfaceWorkerRequest,
): Promise<StudioMultiLightSurfaceReceipt> {
  const provider = createProvider(value.deviceEpoch);
  const receipt = await provider.execute(value);
  provider.dispose();
  return receipt;
}

async function waitForExecute(worker: MemoryWorker): Promise<void> {
  await vi.waitFor(() => {
    expect(worker.inbound.some(
      ({ type }) => type === "studio-multi-light-surface/execute",
    )).toBe(true);
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Studio multi-light surface Worker protocol", () => {
  it("owns every input map, transfers full buffers, and rejects extra keys", () => {
    const original = request(1, 1, true);
    const snapshot = snapshotStudioMultiLightSurfaceWorkerRequest(original);
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;
    expect(snapshot.request.source.data).not.toBe(original.source.data);
    expect(snapshot.request.heightMap?.data).not.toBe(
      original.heightMap?.data,
    );
    expect(snapshot.request.roughnessMap?.data).not.toBe(
      original.roughnessMap?.data,
    );
    expect(snapshot.request.metalnessMap?.data).not.toBe(
      original.metalnessMap?.data,
    );
    expect(snapshot.request.normalMap?.data).not.toBe(
      original.normalMap?.data,
    );
    const message = envelope(1, snapshot.request);
    const transfers = studioMultiLightSurfaceRequestTransfers(message);
    expect(transfers).toHaveLength(5);
    expect(new Set(transfers).size).toBe(5);
    snapshot.request.source.data[0] = 42;
    expect(original.source.data[0]).toBeCloseTo(0.8);
    expect(isStudioMultiLightSurfaceWorkerInboundMessage(message)).toBe(true);
    expect(isStudioMultiLightSurfaceWorkerInboundMessage({
      ...message,
      legacy: true,
    })).toBe(false);
    expect(snapshotStudioMultiLightSurfaceWorkerRequest({
      ...original,
      signal: new AbortController().signal,
    })).toEqual({ ok: false, reason: "invalid-request" });
    expect(snapshotStudioMultiLightSurfaceWorkerRequest({
      ...original,
      recipe: {
        ...original.recipe,
        fingerprint: `sha256:${"f".repeat(64)}`,
      },
    })).toEqual({ ok: false, reason: "invalid-request" });
  });

  it("cross-validates output dimensions, hashes, rig order, and receipt hash", async () => {
    const value = request();
    const receipt = await receiptFor(value);
    const result = {
      status: "completed" as const,
      receipt,
    };
    const snapshot = snapshotStudioMultiLightSurfaceWorkerResult(result);
    expect(snapshot?.status).toBe("completed");
    if (snapshot?.status !== "completed") return;
    expect(snapshot.receipt.output.data).not.toBe(receipt.output.data);
    const response = {
      type: "studio-multi-light-surface/result",
      version: STUDIO_MULTI_LIGHT_SURFACE_WORKER_PROTOCOL_VERSION,
      requestId: 1,
      deviceEpoch: 1,
      requestSequence: 1,
      result: snapshot,
    } as const;
    expect(isStudioMultiLightSurfaceWorkerOutboundMessage(response)).toBe(
      true,
    );
    expect(studioMultiLightSurfaceResultTransfers(response)).toEqual([
      snapshot.receipt.output.data.buffer,
    ]);
    expect(snapshotStudioMultiLightSurfaceWorkerResult({
      ...result,
      receipt: {
        ...receipt,
        oracle: {
          ...receipt.oracle,
          sourceSize: [99, 1],
        },
      },
    })).toBeNull();
    const corrupt = new Float32Array(receipt.output.data);
    corrupt[0] += 0.25;
    expect(snapshotStudioMultiLightSurfaceWorkerResult({
      ...result,
      receipt: {
        ...receipt,
        output: { ...receipt.output, data: corrupt },
      },
    })).toBeNull();
  });
});

describe("Studio multi-light surface Worker client", () => {
  it("fails closed without any main-thread execution fallback", async () => {
    const client = createStudioMultiLightSurfaceWorkerClient({
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
  });

  it("executes in a Worker with input and output alias isolation", async () => {
    const worker = new MemoryWorker();
    worker.mutateAfterDelivery = true;
    const client = createStudioMultiLightSurfaceWorkerClient({
      currentEpoch: 1,
      workerFactory: () => worker,
    });
    const candidate = request(1, 1, true);
    const callerSource = new Float32Array(candidate.source.data);
    const result = await client.execute(candidate);
    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(candidate.source.data).toEqual(callerSource);
    expect(result.receipt.output.data[0]).not.toBe(99);
    expect(result.receipt.output.width).toBe(2);
    expect(result.receipt.oracle.rigOrder).toEqual(["rim", "key"]);
    expect(result.receipt.oracle.evaluationOrder).toEqual(["key", "rim"]);
    const execute = worker.inbound.find(
      ({ type }) => type === "studio-multi-light-surface/execute",
    );
    expect(execute?.type).toBe("studio-multi-light-surface/execute");
    if (execute?.type !== "studio-multi-light-surface/execute") return;
    expect(execute.request.source.data).not.toBe(candidate.source.data);
    expect(worker.transfers.at(-1)).toHaveLength(5);
    client.dispose();
    expect(worker.terminated).toBe(true);
  });

  it("enforces deterministic one-operation backpressure", async () => {
    const worker = new MemoryWorker();
    worker.autoRespond = false;
    const client = createStudioMultiLightSurfaceWorkerClient({
      currentEpoch: 1,
      workerFactory: () => worker,
    });
    const first = client.execute(request());
    await waitForExecute(worker);
    await expect(client.execute(request(1, 2))).resolves.toMatchObject({
      status: "worker-failed",
      reason: "backpressure",
    });
    expect(worker.inbound.filter(
      ({ type }) => type === "studio-multi-light-surface/execute",
    )).toHaveLength(1);
    client.dispose();
    await expect(first).resolves.toMatchObject({
      status: "worker-failed",
      reason: "disposed",
    });
  });

  it("hard-cancels and recreates a fresh Worker", async () => {
    const firstWorker = new MemoryWorker();
    firstWorker.autoRespond = false;
    const secondWorker = new MemoryWorker();
    const workers = [firstWorker, secondWorker];
    const client = createStudioMultiLightSurfaceWorkerClient({
      currentEpoch: 1,
      workerFactory: () => {
        const worker = workers.shift();
        if (!worker) throw new Error("no Worker");
        return worker;
      },
    });
    const controller = new AbortController();
    const first = client.execute(request(), controller.signal);
    await waitForExecute(firstWorker);
    controller.abort();
    await expect(first).resolves.toEqual({ status: "cancelled" });
    expect(firstWorker.inbound.map(({ type }) => type)).toContain(
      "studio-multi-light-surface/cancel",
    );
    expect(firstWorker.terminated).toBe(true);
    await expect(client.execute(request(1, 1))).resolves.toMatchObject({
      status: "completed",
    });
    expect(client.getDiagnostics().workerGeneration).toBe(2);
  });

  it("hard-cancels during startup and still permits recreation", async () => {
    const startingWorker = new MemoryWorker();
    startingWorker.autoReady = false;
    const replacementWorker = new MemoryWorker();
    const workers = [startingWorker, replacementWorker];
    const client = createStudioMultiLightSurfaceWorkerClient({
      currentEpoch: 1,
      workerFactory: () => {
        const worker = workers.shift();
        if (!worker) throw new Error("no Worker");
        return worker;
      },
    });
    const controller = new AbortController();
    const starting = client.execute(request(), controller.signal);
    controller.abort();
    await expect(starting).resolves.toEqual({ status: "cancelled" });
    expect(startingWorker.terminated).toBe(true);
    await expect(client.execute(request())).resolves.toMatchObject({
      status: "completed",
    });
    expect(client.getDiagnostics().workerGeneration).toBe(2);
  });

  it("rejects stale epochs and recreates after active invalidation", async () => {
    const firstWorker = new MemoryWorker();
    firstWorker.autoRespond = false;
    const secondWorker = new MemoryWorker();
    const workers = [firstWorker, secondWorker];
    const client = createStudioMultiLightSurfaceWorkerClient({
      currentEpoch: 1,
      workerFactory: () => {
        const worker = workers.shift();
        if (!worker) throw new Error("no Worker");
        return worker;
      },
    });
    const first = client.execute(request());
    await waitForExecute(firstWorker);
    expect(client.advanceCurrentEpoch(2)).toBe(true);
    await expect(first).resolves.toMatchObject({
      status: "rejected",
      code: "device-epoch",
    });
    expect(firstWorker.terminated).toBe(true);
    await expect(client.execute(request(2, 1))).resolves.toMatchObject({
      status: "completed",
    });
  });

  it("rejects a stale result envelope and terminates its Worker", async () => {
    const worker = new MemoryWorker();
    worker.responseEpochOffset = 1;
    const client = createStudioMultiLightSurfaceWorkerClient({
      currentEpoch: 1,
      workerFactory: () => worker,
    });
    await expect(client.execute(request())).resolves.toMatchObject({
      status: "rejected",
      code: "device-epoch",
    });
    expect(worker.terminated).toBe(true);
    expect(client.getDiagnostics().phase).toBe("cold");
  });

  it.each(["error", "messageerror"] as const)(
    "hard-terminates on Worker %s",
    async (failureType) => {
      const worker = new MemoryWorker();
      worker.autoRespond = false;
      const client = createStudioMultiLightSurfaceWorkerClient({
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

  it("fails closed on malformed output and operation timeout", async () => {
    const malformedWorker = new MemoryWorker();
    malformedWorker.autoRespond = false;
    const malformedClient = createStudioMultiLightSurfaceWorkerClient({
      currentEpoch: 1,
      workerFactory: () => malformedWorker,
    });
    const malformed = malformedClient.execute(request());
    await waitForExecute(malformedWorker);
    malformedWorker.emit({
      type: "studio-multi-light-surface/result",
      version: STUDIO_MULTI_LIGHT_SURFACE_WORKER_PROTOCOL_VERSION,
      requestId: 1,
      deviceEpoch: 1,
      requestSequence: 1,
      result: { status: "completed", receipt: { width: 99 } },
    });
    await expect(malformed).resolves.toMatchObject({
      status: "worker-failed",
      reason: "protocol-error",
    });
    expect(malformedWorker.terminated).toBe(true);

    vi.useFakeTimers();
    const timeoutWorker = new MemoryWorker();
    timeoutWorker.autoRespond = false;
    const timeoutClient = createStudioMultiLightSurfaceWorkerClient({
      currentEpoch: 1,
      operationTimeoutMs: 25,
      workerFactory: () => timeoutWorker,
    });
    const timed = timeoutClient.execute(request());
    await vi.runAllTicks();
    await vi.advanceTimersByTimeAsync(25);
    await expect(timed).resolves.toMatchObject({
      status: "worker-failed",
      reason: "operation-timeout",
    });
    expect(timeoutWorker.terminated).toBe(true);
  });

  it("times out startup and terminates on dispose", async () => {
    vi.useFakeTimers();
    const startupWorker = new MemoryWorker();
    startupWorker.autoReady = false;
    const client = createStudioMultiLightSurfaceWorkerClient({
      currentEpoch: 1,
      startupTimeoutMs: 25,
      workerFactory: () => startupWorker,
    });
    const execution = client.execute(request());
    await vi.advanceTimersByTimeAsync(25);
    await expect(execution).resolves.toMatchObject({
      status: "worker-failed",
      reason: "startup-timeout",
    });
    expect(startupWorker.terminated).toBe(true);

    const worker = new MemoryWorker();
    const disposable = createStudioMultiLightSurfaceWorkerClient({
      currentEpoch: 1,
      workerFactory: () => worker,
    });
    const ready = disposable.execute(request());
    await vi.runAllTicks();
    disposable.dispose();
    await expect(ready).resolves.toMatchObject({
      status: "worker-failed",
      reason: "disposed",
    });
    expect(worker.terminated).toBe(true);
  });
});

describe("Studio multi-light surface Worker host", () => {
  it("releases admission on epoch advance when an executor never settles", async () => {
    const scope = new MemoryHostScope();
    const execute = vi.fn(() => new Promise<never>(() => {}));
    installStudioMultiLightSurfaceWorkerHost(scope, {
      currentEpoch: 1,
      execute,
    });
    scope.dispatch(envelope(1, request(1, 1)));
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    scope.dispatch({
      type: "studio-multi-light-surface/advance-epoch",
      version: STUDIO_MULTI_LIGHT_SURFACE_WORKER_PROTOCOL_VERSION,
      currentEpoch: 2,
    });
    scope.dispatch(envelope(2, request(2, 1)));
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
  });

  it("announces readiness, enforces backpressure, and cancels injected work", async () => {
    const scope = new MemoryHostScope();
    const deferred: {
      resolve?: (receipt: StudioMultiLightSurfaceReceipt) => void;
    } = {};
    let observedSignal: AbortSignal | undefined;
    const host = installStudioMultiLightSurfaceWorkerHost(scope, {
      currentEpoch: 1,
      execute: (value: StudioMultiLightSurfaceRequest) => {
        observedSignal = value.signal;
        return new Promise<StudioMultiLightSurfaceReceipt>((resolve) => {
          deferred.resolve = resolve;
        });
      },
    });
    expect(scope.outbound[0]?.message).toEqual({
      type: "studio-multi-light-surface/ready",
      version: STUDIO_MULTI_LIGHT_SURFACE_WORKER_PROTOCOL_VERSION,
      currentEpoch: 1,
    });
    scope.dispatch(envelope(1));
    await vi.waitFor(() => expect(host.activeRequestId()).toBe(1));
    scope.dispatch(envelope(2, request(1, 2)));
    expect(scope.outbound.at(-1)?.message).toMatchObject({
      type: "studio-multi-light-surface/result",
      result: { status: "worker-failed", reason: "backpressure" },
    });
    scope.dispatch({
      type: "studio-multi-light-surface/cancel",
      version: STUDIO_MULTI_LIGHT_SURFACE_WORKER_PROTOCOL_VERSION,
      requestId: 1,
    });
    expect(observedSignal?.aborted).toBe(true);
    deferred.resolve?.(await receiptFor(request()));
    await vi.waitFor(() => {
      expect(scope.outbound.some(({ message }) => (
        message.type === "studio-multi-light-surface/result"
        && message.requestId === 1
        && message.result.status === "cancelled"
      ))).toBe(true);
    });
    host.dispose();
  });
});
