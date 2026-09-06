import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createStudioFiberBristleBrushProvider,
  createStudioFiberBristleBrushRecipe,
  type StudioFiberBristleBrushProvider,
  type StudioFiberBristleBrushRecipe,
  type StudioFiberBristleRenderRequest,
} from "./studio-fiber-bristle-brush-provider";
import {
  createStudioFiberBristleWorkerClient,
  type StudioFiberBristleWorkerLike,
} from "./studio-fiber-bristle-brush-worker-client";
import {
  installStudioFiberBristleWorkerHost,
  type StudioFiberBristleWorkerHostScope,
} from "./studio-fiber-bristle-brush-worker-host";
import {
  snapshotStudioFiberBristleWorkerInboundMessage,
  snapshotStudioFiberBristleWorkerRequest,
  snapshotStudioFiberBristleWorkerResult,
  STUDIO_FIBER_BRISTLE_WORKER_PROTOCOL_VERSION,
  studioFiberBristleRequestTransfers,
  studioFiberBristleResultTransfers,
  studioFiberBristleWireRequestToProviderRequest,
  type StudioFiberBristleWorkerExecuteMessage,
  type StudioFiberBristleWorkerInboundMessage,
  type StudioFiberBristleWorkerOutboundMessage,
  type StudioFiberBristleWorkerResultMessage,
} from "./studio-fiber-bristle-brush-worker-protocol";

interface MessageEventLike {
  readonly data: unknown;
}

interface ErrorEventLike {
  preventDefault?(): void;
}

function recipe(seed = 9): StudioFiberBristleBrushRecipe {
  const creation = createStudioFiberBristleBrushRecipe({
    seed,
    bundleShape: "fan",
    fiberCount: 6,
    diameter: 6,
    fiberLength: 1,
    stiffness: 0.7,
    stationSpacing: 1,
    baseWidth: 1,
    baseOpacity: 0.8,
    baseColor: [0.8, 0.2, 0.1],
    pressureWidth: 1,
    pressureSplay: 0.5,
    tiltSplay: 0.5,
    lagMilliseconds: 8,
    bendGain: 0.8,
    maximumBend: 6,
    initialLoad: 1,
    loadVariation: 0.1,
    depletionPerUnit: 0.01,
    velocityOpacity: 0.1,
    paper: { scale: 2, dropout: 0 },
    reload: {
      mode: "none",
      intervalDistance: 10,
      amount: 0.5,
    },
    pickup: { enabled: true, rate: 0.2 },
    dirty: { color: [0.1, 0.2, 0.8], mix: 0.1 },
  });
  expect(creation.status).toBe("ready");
  if (creation.status !== "ready") throw new Error(creation.path);
  return creation.recipe;
}

function request(
  overrides: Partial<Omit<StudioFiberBristleRenderRequest, "signal">> = {},
): Omit<StudioFiberBristleRenderRequest, "signal"> {
  return {
    requestSequence: 1,
    engineEpoch: 1,
    strokeId: "stroke-a",
    operation: "replace",
    recipe: recipe(),
    samples: [
      {
        x: 0,
        y: 0,
        timeMilliseconds: 0,
        pressure: 0.4,
        tiltRadians: 0,
        azimuthRadians: 0,
      },
      {
        x: 6,
        y: 1,
        timeMilliseconds: 12,
        pressure: 0.7,
        tiltRadians: 0.2,
        azimuthRadians: 0.1,
        pickupColor: [0.1, 0.8, 0.2],
      },
    ],
    ...overrides,
  };
}

function providerAt(epoch = 1): StudioFiberBristleBrushProvider {
  const creation = createStudioFiberBristleBrushProvider({
    initialEngineEpoch: epoch,
  });
  if (creation.status !== "ready") throw new Error(creation.path);
  return creation.provider;
}

async function providerReceipt(
  value = request(),
) {
  return providerAt(value.engineEpoch).render(value);
}

class MemoryWorker implements StudioFiberBristleWorkerLike {
  readonly inbound: StudioFiberBristleWorkerInboundMessage[] = [];
  readonly transfers: Transferable[][] = [];
  terminated = false;
  autoReady = true;
  autoRespond = true;
  readyEpoch: number;
  mutateOutputAfterEmit = false;
  private provider: StudioFiberBristleBrushProvider;
  private readonly messageListeners = new Set<
    (event: MessageEventLike) => void
  >();
  private readonly errorListeners = new Set<
    (event: ErrorEventLike) => void
  >();
  private readonly messageErrorListeners = new Set<
    (event: ErrorEventLike) => void
  >();

  public constructor(epoch = 1) {
    this.readyEpoch = epoch;
    this.provider = providerAt(epoch);
  }

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
              type: "studio-fiber-bristle/ready",
              version: STUDIO_FIBER_BRISTLE_WORKER_PROTOCOL_VERSION,
              engineEpoch: this.readyEpoch,
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
    message: StudioFiberBristleWorkerInboundMessage,
    transfer: Transferable[] = [],
  ): void {
    this.inbound.push(message);
    this.transfers.push(transfer);
    if (message.type === "studio-fiber-bristle/advance-epoch") {
      this.provider.dispose();
      this.readyEpoch = message.engineEpoch;
      this.provider = providerAt(message.engineEpoch);
      queueMicrotask(() => {
        this.emit({
          type: "studio-fiber-bristle/control-result",
          version: STUDIO_FIBER_BRISTLE_WORKER_PROTOCOL_VERSION,
          receipt: {
            kind: "studio-fiber-bristle-worker-control-receipt",
            control: "advance-epoch",
            requestId: message.requestId,
            engineEpoch: message.engineEpoch,
            released: true,
            execution: "dedicated-worker",
            mainThreadComputationFallback: false,
            workerTerminated: false,
            complete: true,
          },
        });
      });
      return;
    }
    if (
      message.type !== "studio-fiber-bristle/execute"
      || !this.autoRespond
    ) return;
    const controller = new AbortController();
    const providerRequest = studioFiberBristleWireRequestToProviderRequest(
      message.request,
      controller.signal,
    );
    void this.provider.render(providerRequest).then((receipt) => {
      if (this.terminated) return;
      const outbound: StudioFiberBristleWorkerResultMessage = {
        type: "studio-fiber-bristle/result",
        version: STUDIO_FIBER_BRISTLE_WORKER_PROTOCOL_VERSION,
        requestId: message.requestId,
        requestSequence: message.request.requestSequence,
        engineEpoch: message.request.engineEpoch,
        result: { status: "completed", receipt },
      };
      this.emit(outbound);
      if (this.mutateOutputAfterEmit) {
        receipt.artifact.fiberTopology.fill(91);
        receipt.artifact.depositions.fill(92);
        receipt.artifact.finalLoads.fill(93);
        receipt.artifact.finalColors.fill(94);
      }
    });
  }

  emit(data: unknown): void {
    for (const listener of this.messageListeners) listener({ data });
  }

  fail(type: "error" | "messageerror"): void {
    const listeners = type === "error"
      ? this.errorListeners
      : this.messageErrorListeners;
    for (const listener of listeners) listener({});
  }

  terminate(): void {
    this.terminated = true;
    this.provider.dispose();
  }
}

class MemoryHostScope implements StudioFiberBristleWorkerHostScope {
  readonly outbound: Array<{
    message: StudioFiberBristleWorkerOutboundMessage;
    transfer: Transferable[];
  }> = [];
  private readonly listeners = new Set<
    (event: MessageEventLike) => void
  >();

  postMessage(
    message: StudioFiberBristleWorkerOutboundMessage,
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

function executeEnvelope(
  requestId: number,
  value = request(),
): StudioFiberBristleWorkerExecuteMessage {
  const snapshot = snapshotStudioFiberBristleWorkerRequest(value);
  if (!snapshot.ok) throw new Error(snapshot.reason);
  return {
    type: "studio-fiber-bristle/execute",
    version: STUDIO_FIBER_BRISTLE_WORKER_PROTOCOL_VERSION,
    requestId,
    request: snapshot.request,
  };
}

async function waitForExecute(worker: MemoryWorker): Promise<void> {
  await vi.waitFor(() => {
    expect(
      worker.inbound.some(
        (message) => message.type === "studio-fiber-bristle/execute",
      ),
    ).toBe(true);
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Studio fiber bristle Worker protocol", () => {
  it("snapshots samples into an owned transferable Float32 buffer", () => {
    const original = request();
    const snapshot = snapshotStudioFiberBristleWorkerRequest(original);
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;
    expect(snapshot.request.samples).toBeInstanceOf(Float32Array);
    expect(snapshot.request.samples).toHaveLength(18);
    expect(snapshot.request.samples[0]).toBe(0);
    expect(snapshot.request.samples[15]).toBeCloseTo(0.1);
    snapshot.request.samples[0] = 99;
    expect(original.samples[0]?.x).toBe(0);
    const envelope = {
      type: "studio-fiber-bristle/execute",
      version: STUDIO_FIBER_BRISTLE_WORKER_PROTOCOL_VERSION,
      requestId: 1,
      request: snapshot.request,
    } as const;
    expect(studioFiberBristleRequestTransfers(envelope)).toEqual([
      snapshot.request.samples.buffer,
    ]);
    expect(snapshotStudioFiberBristleWorkerInboundMessage(envelope)).not
      .toBeNull();
    expect(snapshotStudioFiberBristleWorkerInboundMessage({
      ...envelope,
      legacy: true,
    })).toBeNull();
  });

  it("rejects malformed, nonfinite, byte, work and fiber budgets before dispatch", () => {
    expect(snapshotStudioFiberBristleWorkerRequest({
      ...request(),
      samples: [{ ...request().samples[0], x: Number.NaN }],
    })).toEqual({ ok: false, reason: "invalid-request" });
    expect(snapshotStudioFiberBristleWorkerRequest({
      ...request(),
      recipe: { ...recipe(), fiberCount: 513 },
    })).toEqual({ ok: false, reason: "invalid-request" });
    expect(snapshotStudioFiberBristleWorkerRequest({
      ...request(),
      samples: [
        request().samples[0],
        { ...request().samples[1], x: 20_000_000 },
      ],
    })).toEqual({ ok: false, reason: "budget-exceeded" });
    expect(snapshotStudioFiberBristleWorkerRequest({
      ...request(),
      signal: new AbortController().signal,
    })).toEqual({ ok: false, reason: "invalid-request" });
  });

  it("defensively copies and validates every completed output buffer", async () => {
    const receipt = await providerReceipt();
    const raw = {
      status: "completed",
      receipt,
    } as const;
    const snapshot = snapshotStudioFiberBristleWorkerResult(raw);
    expect(snapshot?.status).toBe("completed");
    if (snapshot?.status !== "completed") return;
    expect(snapshot.receipt.artifact.fiberTopology).not.toBe(
      receipt.artifact.fiberTopology,
    );
    expect(snapshot.receipt.artifact.depositions).not.toBe(
      receipt.artifact.depositions,
    );
    const outbound: StudioFiberBristleWorkerResultMessage = {
      type: "studio-fiber-bristle/result",
      version: STUDIO_FIBER_BRISTLE_WORKER_PROTOCOL_VERSION,
      requestId: 1,
      requestSequence: 1,
      engineEpoch: 1,
      result: snapshot,
    };
    expect(studioFiberBristleResultTransfers(outbound)).toEqual([
      snapshot.receipt.artifact.fiberTopology.buffer,
      snapshot.receipt.artifact.depositions.buffer,
      snapshot.receipt.artifact.finalLoads.buffer,
      snapshot.receipt.artifact.finalColors.buffer,
    ]);
    expect(snapshotStudioFiberBristleWorkerResult({
      status: "completed",
      receipt: {
        ...receipt,
        artifact: {
          ...receipt.artifact,
          depositions: receipt.artifact.depositions.subarray(1),
        },
      },
    })).toBeNull();
  });

  it("recomputes exact artifact and provider receipt hashes", async () => {
    const receipt = await providerReceipt();
    const depositions = new Float32Array(receipt.artifact.depositions);
    depositions[0] = (depositions[0] ?? 0) + 1;
    const tampered = {
      status: "completed",
      receipt: {
        ...receipt,
        artifact: {
          ...receipt.artifact,
          depositions,
        },
      },
    };
    expect(snapshotStudioFiberBristleWorkerResult(tampered)).toBeNull();
    expect(snapshotStudioFiberBristleWorkerResult({
      status: "completed",
      receipt: {
        ...receipt,
        receiptHash: `sha256:${"1".repeat(64)}`,
      },
    })).toBeNull();
  });
});

describe("Studio fiber bristle Worker host", () => {
  it("releases admission on release and epoch controls when execution never settles", async () => {
    const scope = new MemoryHostScope();
    const execute = vi.fn(() => new Promise<never>(() => {}));
    installStudioFiberBristleWorkerHost(scope, {
      initialEngineEpoch: 1,
      execute,
    });
    scope.dispatch(executeEnvelope(1));
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    scope.dispatch({
      type: "studio-fiber-bristle/release",
      version: STUDIO_FIBER_BRISTLE_WORKER_PROTOCOL_VERSION,
      requestId: 2,
      engineEpoch: 1,
      strokeId: "stroke-a",
    });
    scope.dispatch(executeEnvelope(3, request({ requestSequence: 2 })));
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
    scope.dispatch({
      type: "studio-fiber-bristle/advance-epoch",
      version: STUDIO_FIBER_BRISTLE_WORKER_PROTOCOL_VERSION,
      requestId: 4,
      engineEpoch: 2,
    });
    scope.dispatch(executeEnvelope(5, request({
      requestSequence: 1,
      engineEpoch: 2,
    })));
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(3));
  });

  it("executes with four owned output transfers and rejects a stale epoch", async () => {
    const scope = new MemoryHostScope();
    const host = installStudioFiberBristleWorkerHost(scope, {
      initialEngineEpoch: 1,
    });
    expect(scope.outbound[0]?.message).toMatchObject({
      type: "studio-fiber-bristle/ready",
      engineEpoch: 1,
    });
    scope.dispatch(executeEnvelope(1));
    await vi.waitFor(() => {
      expect(
        scope.outbound.some(
          ({ message }) =>
            message.type === "studio-fiber-bristle/result"
            && message.requestId === 1,
        ),
      ).toBe(true);
    });
    const completed = scope.outbound.find(
      ({ message }) =>
        message.type === "studio-fiber-bristle/result"
        && message.requestId === 1,
    );
    expect(completed?.transfer).toHaveLength(4);

    scope.dispatch({
      type: "studio-fiber-bristle/advance-epoch",
      version: STUDIO_FIBER_BRISTLE_WORKER_PROTOCOL_VERSION,
      requestId: 2,
      engineEpoch: 2,
    });
    expect(host.engineEpoch()).toBe(2);
    scope.dispatch(executeEnvelope(3, request({
      requestSequence: 2,
      engineEpoch: 1,
    })));
    await vi.waitFor(() => {
      const result = scope.outbound.find(
        ({ message }) =>
          message.type === "studio-fiber-bristle/result"
          && message.requestId === 3,
      );
      expect(result?.message).toMatchObject({
        result: { status: "rejected", reason: "engine-epoch" },
      });
    });
    host.dispose();
  });

  it("enforces host backpressure and supports release control", async () => {
    const receipt = await providerReceipt();
    let resolveExecution:
      | ((value: typeof receipt) => void)
      | undefined;
    const scope = new MemoryHostScope();
    const host = installStudioFiberBristleWorkerHost(scope, {
      execute: () => new Promise((resolve) => {
        resolveExecution = resolve;
      }),
    });
    scope.dispatch(executeEnvelope(1));
    await vi.waitFor(() => {
      expect(host.activeRequestId()).toBe(1);
    });
    scope.dispatch(executeEnvelope(2, request({
      requestSequence: 2,
      strokeId: "other",
    })));
    await vi.waitFor(() => {
      expect(scope.outbound.find(
        ({ message }) =>
          message.type === "studio-fiber-bristle/result"
          && message.requestId === 2,
      )?.message).toMatchObject({
        result: {
          status: "worker-failed",
          reason: "backpressure",
          fallback: { mainThreadComputationFallback: false },
        },
      });
    });
    resolveExecution?.(receipt);
    await vi.waitFor(() => expect(host.activeRequestId()).toBeNull());
    scope.dispatch({
      type: "studio-fiber-bristle/release",
      version: STUDIO_FIBER_BRISTLE_WORKER_PROTOCOL_VERSION,
      requestId: 3,
      engineEpoch: 1,
      strokeId: "stroke-a",
    });
    expect(scope.outbound.at(-1)?.message).toMatchObject({
      type: "studio-fiber-bristle/control-result",
      receipt: {
        control: "release",
        mainThreadComputationFallback: false,
      },
    });
    host.dispose();
  });
});

describe("Studio fiber bristle Worker client", () => {
  it("completes only through the Worker and isolates transferred result buffers", async () => {
    const worker = new MemoryWorker();
    worker.mutateOutputAfterEmit = true;
    const client = createStudioFiberBristleWorkerClient({
      currentEngineEpoch: 1,
      workerFactory: () => worker,
    });
    const original = request();
    const result = await client.render(original);
    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(worker.transfers.at(-1)).toHaveLength(1);
    expect(original.samples[0]?.x).toBe(0);
    expect(result.receipt.artifact.fiberTopology[0]).not.toBe(91);
    expect(result.receipt.artifact.depositions[0]).not.toBe(92);
    expect(result.receipt.artifact.finalLoads[0]).not.toBe(93);
    expect(result.receipt.artifact.finalColors[0]).not.toBe(94);
    expect(client.getDiagnostics()).toMatchObject({
      phase: "ready",
      workerGeneration: 1,
      activeRequestId: null,
    });
    client.dispose();
  });

  it("binds replace and append completions to exact samples and retained replay", async () => {
    const worker = new MemoryWorker();
    const client = createStudioFiberBristleWorkerClient({
      currentEngineEpoch: 1,
      workerFactory: () => worker,
    });
    await expect(client.render(request())).resolves.toMatchObject({
      status: "completed",
    });
    await expect(client.render(request({
      requestSequence: 2,
      operation: "append",
      samples: [{
        x: 12,
        y: 2,
        timeMilliseconds: 24,
        pressure: 0.8,
        tiltRadians: 0.25,
        azimuthRadians: 0.15,
      }],
    }))).resolves.toMatchObject({
      status: "completed",
      receipt: { operation: "append" },
    });
    client.dispose();
  });

  it("fails closed on construction failure and enforces one-operation backpressure", async () => {
    const failed = createStudioFiberBristleWorkerClient({
      currentEngineEpoch: 1,
      workerFactory: () => {
        throw new Error("missing");
      },
    });
    await expect(failed.render(request())).resolves.toMatchObject({
      status: "worker-failed",
      reason: "worker-unavailable",
      fallback: { mainThreadComputationFallback: false },
    });

    const worker = new MemoryWorker();
    worker.autoRespond = false;
    const client = createStudioFiberBristleWorkerClient({
      currentEngineEpoch: 1,
      workerFactory: () => worker,
    });
    const first = client.render(request());
    await waitForExecute(worker);
    await expect(client.render(request({
      requestSequence: 2,
      strokeId: "second",
    }))).resolves.toMatchObject({
      status: "worker-failed",
      reason: "backpressure",
      fallback: { mainThreadComputationFallback: false },
    });
    client.dispose();
    await expect(first).resolves.toMatchObject({
      status: "worker-failed",
      reason: "disposed",
    });
  });

  it("hard-terminates on abort and recreates a cold Worker for the next request", async () => {
    const firstWorker = new MemoryWorker();
    firstWorker.autoRespond = false;
    const secondWorker = new MemoryWorker();
    const workers = [firstWorker, secondWorker];
    const controller = new AbortController();
    const client = createStudioFiberBristleWorkerClient({
      currentEngineEpoch: 1,
      workerFactory: () => {
        const worker = workers.shift();
        if (!worker) throw new Error("exhausted");
        return worker;
      },
    });
    const pending = client.render(request(), controller.signal);
    await waitForExecute(firstWorker);
    controller.abort();
    await expect(pending).resolves.toMatchObject({
      status: "worker-failed",
      reason: "aborted",
      fallback: {
        mainThreadComputationFallback: false,
        workerTerminated: true,
      },
    });
    expect(firstWorker.terminated).toBe(true);
    await expect(client.render(request({
      requestSequence: 2,
      strokeId: "after-cancel",
    }))).resolves.toMatchObject({ status: "completed" });
    expect(client.getDiagnostics().workerGeneration).toBe(2);
    client.dispose();
  });

  it("returns a structured disposed failure when disposal is reentrant from the factory", async () => {
    const worker = new MemoryWorker();
    const holder: {
      client?: ReturnType<typeof createStudioFiberBristleWorkerClient>;
    } = {};
    const client = createStudioFiberBristleWorkerClient({
      currentEngineEpoch: 1,
      workerFactory: () => {
        holder.client?.dispose();
        return worker;
      },
    });
    holder.client = client;
    await expect(
      client.render(request(), new AbortController().signal),
    ).resolves.toMatchObject({
      status: "worker-failed",
      reason: "disposed",
      fallback: {
        mainThreadComputationFallback: false,
        workerTerminated: true,
      },
    });
    expect(worker.terminated).toBe(true);
  });

  it("hard-terminates on operation timeout, crash and messageerror", async () => {
    vi.useFakeTimers();
    const timeoutWorker = new MemoryWorker();
    timeoutWorker.autoRespond = false;
    const timeoutClient = createStudioFiberBristleWorkerClient({
      currentEngineEpoch: 1,
      operationTimeoutMilliseconds: 5,
      workerFactory: () => timeoutWorker,
    });
    const timed = timeoutClient.render(request());
    await vi.advanceTimersByTimeAsync(1);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(5);
    await expect(timed).resolves.toMatchObject({
      status: "worker-failed",
      reason: "operation-timeout",
      fallback: { workerTerminated: true },
    });
    expect(timeoutWorker.terminated).toBe(true);
    timeoutClient.dispose();
    vi.useRealTimers();

    for (const failureType of ["error", "messageerror"] as const) {
      const worker = new MemoryWorker();
      worker.autoRespond = false;
      const client = createStudioFiberBristleWorkerClient({
        currentEngineEpoch: 1,
        workerFactory: () => worker,
      });
      const pending = client.render(request());
      await waitForExecute(worker);
      worker.fail(failureType);
      await expect(pending).resolves.toMatchObject({
        status: "worker-failed",
        reason: "worker-unavailable",
        fallback: {
          mainThreadComputationFallback: false,
          workerTerminated: true,
        },
      });
      expect(worker.terminated).toBe(true);
      client.dispose();
    }
  });

  it("hard-terminates on startup timeout and malformed completion", async () => {
    vi.useFakeTimers();
    const startupWorker = new MemoryWorker();
    startupWorker.autoReady = false;
    const startupClient = createStudioFiberBristleWorkerClient({
      currentEngineEpoch: 1,
      startupTimeoutMilliseconds: 5,
      workerFactory: () => startupWorker,
    });
    const startup = startupClient.render(request());
    await vi.advanceTimersByTimeAsync(5);
    await expect(startup).resolves.toMatchObject({
      status: "worker-failed",
      reason: "startup-timeout",
      fallback: { workerTerminated: true },
    });
    startupClient.dispose();
    vi.useRealTimers();

    const malformedWorker = new MemoryWorker();
    malformedWorker.autoRespond = false;
    const malformedClient = createStudioFiberBristleWorkerClient({
      currentEngineEpoch: 1,
      workerFactory: () => malformedWorker,
    });
    const pending = malformedClient.render(request());
    await waitForExecute(malformedWorker);
    malformedWorker.emit({
      type: "studio-fiber-bristle/result",
      version: STUDIO_FIBER_BRISTLE_WORKER_PROTOCOL_VERSION,
      requestId: 1,
      requestSequence: 1,
      engineEpoch: 1,
      result: {
        status: "completed",
        receipt: { broken: true },
      },
    });
    await expect(pending).resolves.toMatchObject({
      status: "worker-failed",
      reason: "protocol-error",
      fallback: { workerTerminated: true },
    });
    malformedClient.dispose();
  });

  it("hard-resets retained state on release and epoch changes, then disposes", async () => {
    const first = new MemoryWorker();
    const second = new MemoryWorker(2);
    const workers = [first, second];
    const client = createStudioFiberBristleWorkerClient({
      currentEngineEpoch: 1,
      workerFactory: () => {
        const worker = workers.shift();
        if (!worker) throw new Error("exhausted");
        return worker;
      },
    });
    await expect(client.render(request())).resolves.toMatchObject({
      status: "completed",
    });
    const release = client.releaseStroke("stroke-a");
    expect(release).toMatchObject({
      control: "release",
      mainThreadComputationFallback: false,
      workerTerminated: true,
      released: true,
    });
    expect(first.terminated).toBe(true);
    const advanced = client.advanceEngineEpoch(2);
    expect(advanced).toMatchObject({
      control: "advance-epoch",
      engineEpoch: 2,
      released: true,
      mainThreadComputationFallback: false,
    });
    await expect(client.render(request({
      requestSequence: 2,
      engineEpoch: 1,
    }))).resolves.toMatchObject({
      status: "rejected",
      reason: "invalid-request",
    });
    await expect(client.render(request({
      requestSequence: 2,
      engineEpoch: 2,
      strokeId: "epoch-two",
    }))).resolves.toMatchObject({ status: "completed" });
    client.dispose();
    expect(second.terminated).toBe(true);
    await expect(client.render(request({
      requestSequence: 3,
      engineEpoch: 2,
    }))).resolves.toMatchObject({
      status: "worker-failed",
      reason: "disposed",
      fallback: { mainThreadComputationFallback: false },
    });
  });

  it("rejects Worker results with mismatched sequence or epoch", async () => {
    const worker = new MemoryWorker();
    worker.autoRespond = false;
    const client = createStudioFiberBristleWorkerClient({
      currentEngineEpoch: 1,
      workerFactory: () => worker,
    });
    const receipt = await providerReceipt();
    const pending = client.render(request());
    await waitForExecute(worker);
    worker.emit({
      type: "studio-fiber-bristle/result",
      version: STUDIO_FIBER_BRISTLE_WORKER_PROTOCOL_VERSION,
      requestId: 1,
      requestSequence: 2,
      engineEpoch: 1,
      result: { status: "completed", receipt },
    });
    await expect(pending).resolves.toMatchObject({
      status: "worker-failed",
      reason: "protocol-error",
      fallback: { workerTerminated: true },
    });
    client.dispose();
  });

  it("rejects a self-consistent result rendered from different samples", async () => {
    const worker = new MemoryWorker();
    worker.autoRespond = false;
    const client = createStudioFiberBristleWorkerClient({
      currentEngineEpoch: 1,
      workerFactory: () => worker,
    });
    const otherReceipt = await providerReceipt(request({
      samples: [
        {
          x: 999,
          y: 999,
          timeMilliseconds: 0,
          pressure: 0.4,
          tiltRadians: 0,
          azimuthRadians: 0,
        },
        {
          x: 1_005,
          y: 1_000,
          timeMilliseconds: 12,
          pressure: 0.7,
          tiltRadians: 0.2,
          azimuthRadians: 0.1,
        },
      ],
    }));
    const pending = client.render(request());
    await waitForExecute(worker);
    worker.emit({
      type: "studio-fiber-bristle/result",
      version: STUDIO_FIBER_BRISTLE_WORKER_PROTOCOL_VERSION,
      requestId: 1,
      requestSequence: 1,
      engineEpoch: 1,
      result: { status: "completed", receipt: otherReceipt },
    });
    await expect(pending).resolves.toMatchObject({
      status: "worker-failed",
      reason: "invalid-result",
      fallback: { workerTerminated: true },
    });
    client.dispose();
  });
});
