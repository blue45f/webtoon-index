import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createStudioProceduralMediaSurfaceProvider,
  createStudioProceduralMediaSurfaceRecipe,
  type StudioProceduralMediaSurfaceProvider,
  type StudioProceduralMediaSurfaceRecipe,
  type StudioProceduralMediaSurfaceRenderReceipt,
  type StudioProceduralMediaSurfaceRenderRequest,
  verifyStudioProceduralMediaSurfaceRenderReceiptIntegrityCooperatively,
} from "./studio-procedural-media-surface-provider";
import {
  createStudioProceduralMediaSurfaceWorkerClient,
  type StudioProceduralMediaSurfaceWorkerLike,
} from "./studio-procedural-media-surface-worker-client";
import {
  installStudioProceduralMediaSurfaceWorkerHost,
  type StudioProceduralMediaSurfaceWorkerHostScope,
} from "./studio-procedural-media-surface-worker-host";
import {
  createStudioProceduralMediaSurfaceWorkerVerifiedAttestation,
  snapshotStudioProceduralMediaSurfaceWorkerInboundMessage,
  snapshotStudioProceduralMediaSurfaceWorkerRequest,
  snapshotStudioProceduralMediaSurfaceWorkerResult,
  snapshotStudioProceduralMediaSurfaceWorkerResultCooperatively,
  STUDIO_PROCEDURAL_MEDIA_SURFACE_WORKER_PROTOCOL_VERSION,
  studioProceduralMediaSurfaceRequestTransfers,
  studioProceduralMediaSurfaceResultTransfers,
  studioProceduralMediaSurfaceWireRequestToProviderRequest,
  type StudioProceduralMediaSurfaceWorkerExecuteMessage,
  type StudioProceduralMediaSurfaceWorkerInboundMessage,
  type StudioProceduralMediaSurfaceWorkerOutboundMessage,
  type StudioProceduralMediaSurfaceWorkerResult,
  type StudioProceduralMediaSurfaceWorkerResultMessage,
} from "./studio-procedural-media-surface-worker-protocol";

interface MessageEventLike {
  readonly data: unknown;
}

interface ErrorEventLike {
  preventDefault?(): void;
}

function recipe(seed = 41): StudioProceduralMediaSurfaceRecipe {
  const creation = createStudioProceduralMediaSurfaceRecipe({
    seed,
    worldScale: 16,
    rotationRadians: 0.2,
    offset: [2, -3],
    contrast: 1.1,
    seamlessPeriod: [24, 20],
    relief: {
      frequency: 1,
      octaves: 3,
      lacunarity: 2,
      gain: 0.5,
      amplitude: 0.5,
    },
    fibers: {
      frequency: 6,
      amplitude: 0.2,
      directionRadians: 0.4,
      irregularity: 0.3,
    },
    weave: {
      warpFrequency: 4,
      weftFrequency: 5,
      amplitude: 0.15,
      balance: 0.5,
    },
    pores: { frequency: 10, density: 0.15, amplitude: 0.2 },
    speckles: { frequency: 18, density: 0.1, amplitude: 0.1 },
    channels: {
      absorbencyBase: 0.4,
      reliefToAbsorbency: 0.2,
      poreToAbsorbency: 0.3,
      speckleToAbsorbency: 0.1,
      grainBase: 0.2,
      reliefToGrain: 0.2,
      fiberToGrain: 0.3,
      weaveToGrain: 0.2,
      speckleToGrain: 0.1,
    },
    flow: {
      gradientStep: 0.5,
      downhillWeight: 0.8,
      tangentWeight: 0.2,
      gravity: [0, 0.15],
      wind: [0.05, 0],
    },
  });
  expect(creation.status).toBe("ready");
  if (creation.status !== "ready") throw new Error(creation.path);
  return creation.recipe;
}

function request(
  overrides: Partial<Omit<
    StudioProceduralMediaSurfaceRenderRequest,
    "signal"
  >> = {},
): Omit<StudioProceduralMediaSurfaceRenderRequest, "signal"> {
  return {
    requestSequence: 1,
    engineEpoch: 1,
    recipe: recipe(),
    region: {
      originX: 0,
      originY: 0,
      width: 6,
      height: 5,
      halo: 1,
    },
    ...overrides,
  };
}

function providerAt(
  epoch = 1,
): StudioProceduralMediaSurfaceProvider {
  const creation = createStudioProceduralMediaSurfaceProvider({
    initialEngineEpoch: epoch,
  });
  if (creation.status !== "ready") throw new Error(creation.path);
  return creation.provider;
}

async function directReceipt(
  value = request(),
) {
  return providerAt(value.engineEpoch).render(value);
}

class MemoryWorker implements StudioProceduralMediaSurfaceWorkerLike {
  readonly inbound: StudioProceduralMediaSurfaceWorkerInboundMessage[] = [];
  readonly transfers: Transferable[][] = [];
  terminated = false;
  autoReady = true;
  autoRespond = true;
  readyEpoch: number;
  mutateOutputAfterEmit = false;
  private provider: StudioProceduralMediaSurfaceProvider;
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
          if (!this.terminated) this.emit({
            type: "studio-procedural-media-surface/ready",
            version:
              STUDIO_PROCEDURAL_MEDIA_SURFACE_WORKER_PROTOCOL_VERSION,
            engineEpoch: this.readyEpoch,
          });
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
    message: StudioProceduralMediaSurfaceWorkerInboundMessage,
    transfer: Transferable[] = [],
  ): void {
    this.inbound.push(message);
    this.transfers.push(transfer);
    if (
      message.type === "studio-procedural-media-surface/advance-epoch"
    ) {
      this.provider.dispose();
      this.readyEpoch = message.engineEpoch;
      this.provider = providerAt(message.engineEpoch);
      queueMicrotask(() => this.emit({
        type: "studio-procedural-media-surface/control-result",
        version: STUDIO_PROCEDURAL_MEDIA_SURFACE_WORKER_PROTOCOL_VERSION,
        receipt: {
          kind: "studio-procedural-media-surface-worker-control-receipt",
          control: "advance-epoch",
          requestId: message.requestId,
          engineEpoch: message.engineEpoch,
          released: true,
          execution: "dedicated-worker",
          mainThreadComputationFallback: false,
          workerTerminated: false,
          complete: true,
        },
      }));
      return;
    }
    if (
      message.type !== "studio-procedural-media-surface/execute"
      || !this.autoRespond
    ) return;
    const providerRequest =
      studioProceduralMediaSurfaceWireRequestToProviderRequest(
        message.request,
        new AbortController().signal,
      );
    void this.provider.render(providerRequest).then((receipt) => {
      if (this.terminated) return;
      const outbound: StudioProceduralMediaSurfaceWorkerResultMessage = {
        type: "studio-procedural-media-surface/result",
        version: STUDIO_PROCEDURAL_MEDIA_SURFACE_WORKER_PROTOCOL_VERSION,
        requestId: message.requestId,
        requestSequence: message.request.requestSequence,
        engineEpoch: message.request.engineEpoch,
        result: { status: "completed", receipt },
        verification:
          createStudioProceduralMediaSurfaceWorkerVerifiedAttestation(
            message.requestId,
            receipt,
          ),
      };
      this.emit(outbound);
      if (this.mutateOutputAfterEmit) {
        receipt.artifact.heightField.fill(91);
        receipt.artifact.absorbency.fill(92);
        receipt.artifact.grain.fill(93);
        receipt.artifact.flow.fill(94);
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

class MemoryHostScope
  implements StudioProceduralMediaSurfaceWorkerHostScope {
  readonly outbound: Array<{
    message: StudioProceduralMediaSurfaceWorkerOutboundMessage;
    transfer: Transferable[];
  }> = [];
  private readonly listeners = new Set<
    (event: MessageEventLike) => void
  >();

  postMessage(
    message: StudioProceduralMediaSurfaceWorkerOutboundMessage,
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
): StudioProceduralMediaSurfaceWorkerExecuteMessage {
  const snapshot =
    snapshotStudioProceduralMediaSurfaceWorkerRequest(value);
  if (!snapshot.ok) throw new Error(snapshot.reason);
  return {
    type: "studio-procedural-media-surface/execute",
    version: STUDIO_PROCEDURAL_MEDIA_SURFACE_WORKER_PROTOCOL_VERSION,
    requestId,
    request: snapshot.request,
  };
}

async function waitForExecute(worker: MemoryWorker): Promise<void> {
  await vi.waitFor(() => {
    expect(worker.inbound.some(
      (message) =>
        message.type === "studio-procedural-media-surface/execute",
    )).toBe(true);
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Studio procedural media surface Worker protocol", () => {
  it("snapshots recipe vectors into an owned transferable Float64 buffer", () => {
    const original = request();
    const snapshot =
      snapshotStudioProceduralMediaSurfaceWorkerRequest(original);
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;
    expect(snapshot.request.recipe.vectors).toBeInstanceOf(Float64Array);
    expect(Array.from(snapshot.request.recipe.vectors)).toEqual([
      2, -3, 24, 20, 0, 0.15, 0.05, 0,
    ]);
    snapshot.request.recipe.vectors[0] = 999;
    expect(original.recipe.offset[0]).toBe(2);
    const envelope = {
      type: "studio-procedural-media-surface/execute",
      version: STUDIO_PROCEDURAL_MEDIA_SURFACE_WORKER_PROTOCOL_VERSION,
      requestId: 1,
      request: snapshot.request,
    } as const;
    expect(studioProceduralMediaSurfaceRequestTransfers(envelope)).toEqual([
      snapshot.request.recipe.vectors.buffer,
    ]);
    expect(
      snapshotStudioProceduralMediaSurfaceWorkerInboundMessage(envelope),
    ).not.toBeNull();
    expect(
      snapshotStudioProceduralMediaSurfaceWorkerInboundMessage({
        ...envelope,
        legacy: true,
      }),
    ).toBeNull();
  });

  it("rejects malformed recipes and output/work/resident budgets before dispatch", () => {
    expect(snapshotStudioProceduralMediaSurfaceWorkerRequest({
      ...request(),
      recipe: { ...recipe(), worldScale: Number.NaN },
    })).toEqual({ ok: false, reason: "invalid-request" });
    expect(snapshotStudioProceduralMediaSurfaceWorkerRequest({
      ...request(),
      region: {
        originX: 0,
        originY: 0,
        width: 16_384,
        height: 16_384,
        halo: 1_024,
      },
    })).toEqual({ ok: false, reason: "budget-exceeded" });
    expect(snapshotStudioProceduralMediaSurfaceWorkerRequest({
      ...request(),
      signal: new AbortController().signal,
    })).toEqual({ ok: false, reason: "invalid-request" });
    const admitted = snapshotStudioProceduralMediaSurfaceWorkerRequest(
      request(),
    );
    expect(admitted.ok).toBe(true);
    if (admitted.ok) {
      expect(admitted.residentBytes).toBe(
        admitted.outputPixels * 12 * Float32Array.BYTES_PER_ELEMENT,
      );
    }
  });

  it("copies, transfers and shape-validates all four output arrays", async () => {
    const receipt = await directReceipt();
    const snapshot = snapshotStudioProceduralMediaSurfaceWorkerResult({
      status: "completed",
      receipt,
    });
    expect(snapshot?.status).toBe("completed");
    if (snapshot?.status !== "completed") return;
    expect(snapshot.receipt.artifact.heightField).not.toBe(
      receipt.artifact.heightField,
    );
    expect(snapshot.receipt.artifact.flow).not.toBe(receipt.artifact.flow);
    const outbound: StudioProceduralMediaSurfaceWorkerResultMessage = {
      type: "studio-procedural-media-surface/result",
      version: STUDIO_PROCEDURAL_MEDIA_SURFACE_WORKER_PROTOCOL_VERSION,
      requestId: 1,
      requestSequence: 1,
      engineEpoch: 1,
      result: snapshot,
      verification:
        createStudioProceduralMediaSurfaceWorkerVerifiedAttestation(
          1,
          snapshot.receipt,
        ),
    };
    expect(studioProceduralMediaSurfaceResultTransfers(outbound)).toEqual([
      snapshot.receipt.artifact.heightField.buffer,
      snapshot.receipt.artifact.absorbency.buffer,
      snapshot.receipt.artifact.grain.buffer,
      snapshot.receipt.artifact.flow.buffer,
    ]);
    expect(snapshotStudioProceduralMediaSurfaceWorkerResult({
      status: "completed",
      receipt: {
        ...receipt,
        artifact: {
          ...receipt.artifact,
          flow: receipt.artifact.flow.subarray(1),
        },
      },
    })).toBeNull();
  });

  it("cooperatively cancels large result copies and hash verification", async () => {
    const target = request({
      region: {
        originX: 0,
        originY: 0,
        width: 130,
        height: 130,
        halo: 0,
      },
    });
    const receipt = await directReceipt(target);
    let copyActive = true;
    const copyGate = new MessageChannel();
    copyGate.port1.onmessage = () => {
      copyActive = false;
      copyGate.port1.close();
      copyGate.port2.close();
    };
    copyGate.port2.postMessage(undefined);
    await expect(
      snapshotStudioProceduralMediaSurfaceWorkerResultCooperatively(
        { status: "completed", receipt },
        () => copyActive,
      ),
    ).resolves.toBeNull();

    let hashActive = true;
    const hashGate = new MessageChannel();
    hashGate.port1.onmessage = () => {
      hashActive = false;
      hashGate.port1.close();
      hashGate.port2.close();
    };
    hashGate.port2.postMessage(undefined);
    await expect(
      verifyStudioProceduralMediaSurfaceRenderReceiptIntegrityCooperatively(
        receipt,
        target,
        () => {
          if (!hashActive) throw new Error("cancelled");
        },
      ),
    ).resolves.toBe(false);
  });
});

describe("Studio procedural media surface Worker host", () => {
  it("executes with four owned output transfers and rejects stale epochs", async () => {
    const scope = new MemoryHostScope();
    const host = installStudioProceduralMediaSurfaceWorkerHost(scope);
    expect(scope.outbound[0]?.message).toMatchObject({
      type: "studio-procedural-media-surface/ready",
      engineEpoch: 1,
    });
    scope.dispatch(executeEnvelope(1));
    await vi.waitFor(() => {
      expect(scope.outbound.find(
        ({ message }) =>
          message.type === "studio-procedural-media-surface/result"
          && message.requestId === 1,
      )?.transfer).toHaveLength(4);
    });
    scope.dispatch({
      type: "studio-procedural-media-surface/advance-epoch",
      version: STUDIO_PROCEDURAL_MEDIA_SURFACE_WORKER_PROTOCOL_VERSION,
      requestId: 2,
      engineEpoch: 2,
    });
    scope.dispatch(executeEnvelope(3, request({
      requestSequence: 2,
      engineEpoch: 1,
    })));
    await vi.waitFor(() => expect(scope.outbound.find(
      ({ message }) =>
        message.type === "studio-procedural-media-surface/result"
        && message.requestId === 3,
    )?.message).toMatchObject({
      result: { status: "rejected", reason: "engine-epoch" },
    }));
    expect(host.engineEpoch()).toBe(2);
    host.dispose();
  });

  it("enforces host backpressure and release control", async () => {
    const receipt = await directReceipt();
    let resolveExecution:
      | ((value: typeof receipt) => void)
      | undefined;
    const scope = new MemoryHostScope();
    const host = installStudioProceduralMediaSurfaceWorkerHost(scope, {
      execute: () => new Promise((resolve) => {
        resolveExecution = resolve;
      }),
    });
    scope.dispatch(executeEnvelope(1));
    await vi.waitFor(() => expect(host.activeRequestId()).toBe(1));
    scope.dispatch(executeEnvelope(2, request({ requestSequence: 2 })));
    await vi.waitFor(() => expect(scope.outbound.find(
      ({ message }) =>
        message.type === "studio-procedural-media-surface/result"
        && message.requestId === 2,
    )?.message).toMatchObject({
      result: {
        status: "worker-failed",
        reason: "backpressure",
        fallback: { mainThreadComputationFallback: false },
      },
    }));
    resolveExecution?.(receipt);
    await vi.waitFor(() => expect(host.activeRequestId()).toBeNull());
    scope.dispatch({
      type: "studio-procedural-media-surface/release",
      version: STUDIO_PROCEDURAL_MEDIA_SURFACE_WORKER_PROTOCOL_VERSION,
      requestId: 3,
      engineEpoch: 1,
    });
    expect(scope.outbound.at(-1)?.message).toMatchObject({
      type: "studio-procedural-media-surface/control-result",
      receipt: {
        control: "release",
        released: true,
        mainThreadComputationFallback: false,
      },
    });
    host.dispose();
  });

  it("admits the new epoch when the aborted executor never settles", async () => {
    const scope = new MemoryHostScope();
    let executionCount = 0;
    const host = installStudioProceduralMediaSurfaceWorkerHost(scope, {
      execute: (value) => {
        executionCount += 1;
        if (executionCount === 1) {
          return new Promise(() => {
            // Deliberately ignores AbortSignal forever.
          });
        }
        return providerAt(value.engineEpoch).render(value);
      },
    });
    scope.dispatch(executeEnvelope(1));
    await vi.waitFor(() => expect(host.activeRequestId()).toBe(1));
    scope.dispatch({
      type: "studio-procedural-media-surface/advance-epoch",
      version: STUDIO_PROCEDURAL_MEDIA_SURFACE_WORKER_PROTOCOL_VERSION,
      requestId: 2,
      engineEpoch: 2,
    });
    expect(host.activeRequestId()).toBeNull();
    scope.dispatch(executeEnvelope(3, request({
      requestSequence: 1,
      engineEpoch: 2,
    })));
    await vi.waitFor(() => expect(scope.outbound.find(
      ({ message }) =>
        message.type === "studio-procedural-media-surface/result"
        && message.requestId === 3,
    )?.message).toMatchObject({
      result: { status: "completed" },
    }));
    expect(executionCount).toBe(2);
    host.dispose();
  });

  it("refuses executor bytes that do not match their receipt hashes", async () => {
    const corrupted = await directReceipt();
    corrupted.artifact.heightField[0] = Math.fround(
      (corrupted.artifact.heightField[0] ?? 0) + 0.5,
    );
    const scope = new MemoryHostScope();
    const host = installStudioProceduralMediaSurfaceWorkerHost(scope, {
      execute: () => corrupted,
    });
    scope.dispatch(executeEnvelope(1));
    await vi.waitFor(() => expect(scope.outbound.find(
      ({ message }) =>
        message.type === "studio-procedural-media-surface/result"
        && message.requestId === 1,
    )).toMatchObject({
      transfer: [],
      message: {
        result: {
          status: "worker-failed",
          reason: "invalid-result",
        },
        verification: null,
      },
    }));
    host.dispose();
  });
});

describe("Studio procedural media surface Worker client", () => {
  it("executes only in Worker and isolates transferred output buffers", async () => {
    const worker = new MemoryWorker();
    worker.mutateOutputAfterEmit = true;
    const client = createStudioProceduralMediaSurfaceWorkerClient({
      currentEngineEpoch: 1,
      workerFactory: () => worker,
    });
    const result = await client.render(request());
    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(worker.transfers.at(-1)).toHaveLength(1);
    expect(result.receipt.artifact.heightField[0]).not.toBe(91);
    expect(result.receipt.artifact.absorbency[0]).not.toBe(92);
    expect(result.receipt.artifact.grain[0]).not.toBe(93);
    expect(result.receipt.artifact.flow[0]).not.toBe(94);
    expect(client.getDiagnostics()).toMatchObject({
      phase: "ready",
      workerGeneration: 1,
      activeRequestId: null,
    });
    client.dispose();
  });

  it("fails closed on construction failure and client backpressure", async () => {
    const failed = createStudioProceduralMediaSurfaceWorkerClient({
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
    const client = createStudioProceduralMediaSurfaceWorkerClient({
      currentEngineEpoch: 1,
      workerFactory: () => worker,
    });
    const first = client.render(request());
    await waitForExecute(worker);
    await expect(client.render(request({
      requestSequence: 2,
    }))).resolves.toMatchObject({
      status: "worker-failed",
      reason: "backpressure",
    });
    client.dispose();
    await expect(first).resolves.toMatchObject({
      status: "worker-failed",
      reason: "disposed",
    });
  });

  it("hard-terminates on abort and recreates a cold Worker", async () => {
    const firstWorker = new MemoryWorker();
    firstWorker.autoRespond = false;
    const secondWorker = new MemoryWorker();
    const workers = [firstWorker, secondWorker];
    const controller = new AbortController();
    const client = createStudioProceduralMediaSurfaceWorkerClient({
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
    await expect(client.render(request({
      requestSequence: 2,
    }))).resolves.toMatchObject({ status: "completed" });
    expect(client.getDiagnostics().workerGeneration).toBe(2);
    client.dispose();
  });

  it("cancels provisional admission when lifecycle controls win the ready gap", async () => {
    const releaseWorker = new MemoryWorker();
    const releaseClient = createStudioProceduralMediaSurfaceWorkerClient({
      currentEngineEpoch: 1,
      workerFactory: () => releaseWorker,
    });
    await expect(releaseClient.render(request())).resolves.toMatchObject({
      status: "completed",
    });
    const releasedPending = releaseClient.render(request({
      requestSequence: 2,
    }));
    expect(releaseClient.release()).toMatchObject({
      control: "release",
      released: true,
    });
    await expect(releasedPending).resolves.toMatchObject({
      status: "worker-failed",
      reason: "aborted",
    });
    expect(releaseWorker.inbound.filter(
      ({ type }) => type === "studio-procedural-media-surface/execute",
    )).toHaveLength(1);
    releaseClient.dispose();

    const epochWorker = new MemoryWorker();
    const epochClient = createStudioProceduralMediaSurfaceWorkerClient({
      currentEngineEpoch: 1,
      workerFactory: () => epochWorker,
    });
    await expect(epochClient.render(request())).resolves.toMatchObject({
      status: "completed",
    });
    const epochPending = epochClient.render(request({
      requestSequence: 2,
    }));
    expect(epochClient.advanceEngineEpoch(2)).toMatchObject({
      control: "advance-epoch",
      released: true,
      engineEpoch: 2,
    });
    await expect(epochPending).resolves.toMatchObject({
      status: "worker-failed",
      reason: "aborted",
    });
    expect(epochWorker.inbound.filter(
      ({ type }) => type === "studio-procedural-media-surface/execute",
    )).toHaveLength(1);
    epochClient.dispose();

    const disposeWorker = new MemoryWorker();
    const disposeClient = createStudioProceduralMediaSurfaceWorkerClient({
      currentEngineEpoch: 1,
      workerFactory: () => disposeWorker,
    });
    await expect(disposeClient.render(request())).resolves.toMatchObject({
      status: "completed",
    });
    const disposedPending = disposeClient.render(request({
      requestSequence: 2,
    }));
    disposeClient.dispose();
    await expect(disposedPending).resolves.toMatchObject({
      status: "worker-failed",
      reason: "disposed",
    });
    expect(disposeWorker.inbound.filter(
      ({ type }) => type === "studio-procedural-media-surface/execute",
    )).toHaveLength(1);
  });

  it("does not resurrect a Worker when release reenters request snapshotting", async () => {
    const workers: MemoryWorker[] = [];
    const client = createStudioProceduralMediaSurfaceWorkerClient({
      currentEngineEpoch: 1,
      workerFactory: () => {
        const worker = new MemoryWorker();
        workers.push(worker);
        return worker;
      },
    });
    const candidate = request();
    let released = false;
    const hostileCandidate = new Proxy(candidate, {
      ownKeys(target): ArrayLike<string | symbol> {
        if (!released) {
          released = true;
          expect(client.release()).toMatchObject({
            control: "release",
            released: false,
          });
        }
        return Reflect.ownKeys(target);
      },
    });

    await expect(client.render(hostileCandidate)).resolves.toMatchObject({
      status: "worker-failed",
      reason: "aborted",
    });
    expect(workers).toEqual([]);
    expect(client.getDiagnostics()).toMatchObject({
      phase: "cold",
      workerGeneration: 0,
      activeRequestId: null,
      operationReserved: false,
    });
    client.dispose();
  });

  it("terminates a provisional Worker when release reenters its factory", async () => {
    const provisionalWorker = new MemoryWorker();
    const client = createStudioProceduralMediaSurfaceWorkerClient({
      currentEngineEpoch: 1,
      workerFactory: () => {
        expect(client.release()).toMatchObject({
          control: "release",
          released: false,
        });
        return provisionalWorker;
      },
    });

    await expect(client.render(request())).resolves.toMatchObject({
      status: "worker-failed",
      reason: "aborted",
      fallback: { workerTerminated: true },
    });
    expect(provisionalWorker.terminated).toBe(true);
    expect(client.getDiagnostics()).toMatchObject({
      phase: "cold",
      activeRequestId: null,
      operationReserved: false,
    });
    client.dispose();
  });

  it("rolls back hostile AbortSignals at readiness and active admission", async () => {
    const readinessWorker = new MemoryWorker();
    const readinessClient =
      createStudioProceduralMediaSurfaceWorkerClient({
        currentEngineEpoch: 1,
        workerFactory: () => readinessWorker,
      });
    const readinessSignal = new AbortController().signal;
    Object.defineProperty(readinessSignal, "addEventListener", {
      value(): void {
        throw new Error("hostile readiness add");
      },
    });
    await expect(
      readinessClient.render(request(), readinessSignal),
    ).resolves.toEqual({
      status: "rejected",
      reason: "invalid-request",
    });
    expect(readinessClient.getDiagnostics()).toMatchObject({
      phase: "ready",
      activeRequestId: null,
      operationReserved: false,
    });
    await expect(readinessClient.render(request({
      requestSequence: 2,
    }))).resolves.toMatchObject({ status: "completed" });
    readinessClient.dispose();

    const activeWorker = new MemoryWorker();
    const activeClient = createStudioProceduralMediaSurfaceWorkerClient({
      currentEngineEpoch: 1,
      workerFactory: () => activeWorker,
    });
    const activeSignal = new AbortController().signal;
    const nativeAdd = AbortSignal.prototype.addEventListener;
    const nativeRemove = AbortSignal.prototype.removeEventListener;
    let addCalls = 0;
    Object.defineProperties(activeSignal, {
      addEventListener: {
        value(
          type: string,
          listener: EventListenerOrEventListenerObject,
          options?: boolean | AddEventListenerOptions,
        ): void {
          addCalls += 1;
          if (addCalls === 2) throw new Error("hostile active add");
          nativeAdd.call(this, type, listener, options);
        },
      },
      removeEventListener: {
        value(
          type: string,
          listener: EventListenerOrEventListenerObject,
          options?: boolean | EventListenerOptions,
        ): void {
          nativeRemove.call(this, type, listener, options);
        },
      },
    });
    await expect(
      activeClient.render(request(), activeSignal),
    ).resolves.toEqual({
      status: "rejected",
      reason: "invalid-request",
    });
    expect(addCalls).toBe(2);
    expect(activeClient.getDiagnostics()).toMatchObject({
      phase: "ready",
      activeRequestId: null,
      operationReserved: false,
    });
    await expect(activeClient.render(request({
      requestSequence: 2,
    }))).resolves.toMatchObject({ status: "completed" });
    expect(activeWorker.inbound.find(
      (message) =>
        message.type === "studio-procedural-media-surface/execute",
    )?.requestId).toBe(1);
    activeClient.dispose();
  });

  it("keeps provisional ownership across hostile getter reentry", async () => {
    const worker = new MemoryWorker();
    const client = createStudioProceduralMediaSurfaceWorkerClient({
      currentEngineEpoch: 1,
      workerFactory: () => worker,
    });
    const nested: Array<
      Promise<StudioProceduralMediaSurfaceWorkerResult>
    > = [];
    let nestedSequence = 100;
    const reenter = (): void => {
      nested.push(client.render(request({
        requestSequence: nestedSequence,
      })));
      nestedSequence += 1;
    };
    const hostileSignal = new AbortController().signal;
    Object.defineProperty(hostileSignal, "aborted", {
      configurable: true,
      get(): boolean {
        reenter();
        return false;
      },
    });
    const hostileCandidate = {
      ...request(),
      get requestSequence(): number {
        reenter();
        return 1;
      },
    };
    await expect(
      client.render(hostileCandidate, hostileSignal),
    ).resolves.toMatchObject({ status: "completed" });
    expect(nested.length).toBeGreaterThanOrEqual(3);
    for (const pending of nested) {
      await expect(pending).resolves.toMatchObject({
        status: "worker-failed",
        reason: "backpressure",
      });
    }
    expect(client.getDiagnostics()).toMatchObject({
      phase: "ready",
      activeRequestId: null,
      operationReserved: false,
    });
    expect(worker.inbound.filter(
      (message) =>
        message.type === "studio-procedural-media-surface/execute",
    ).map((message) => message.requestId)).toEqual([1]);
    await expect(client.render(request({
      requestSequence: 2,
    }))).resolves.toMatchObject({ status: "completed" });
    client.dispose();
  });

  it("does not consume Worker state or request IDs for reflected invalid input", async () => {
    const worker = new MemoryWorker();
    const client = createStudioProceduralMediaSurfaceWorkerClient({
      currentEngineEpoch: 1,
      workerFactory: () => worker,
    });
    const hostileCandidate = new Proxy({}, {
      ownKeys(): never {
        throw new Error("hostile ownKeys");
      },
    });
    await expect(client.render(hostileCandidate)).resolves.toEqual({
      status: "rejected",
      reason: "invalid-request",
    });
    expect(client.getDiagnostics()).toMatchObject({
      phase: "cold",
      workerGeneration: 0,
      activeRequestId: null,
      operationReserved: false,
    });
    await expect(client.render(request())).resolves.toMatchObject({
      status: "completed",
    });
    expect(worker.inbound.find(
      (message) =>
        message.type === "studio-procedural-media-surface/execute",
    )?.requestId).toBe(1);
    client.dispose();
  });

  it("hard-terminates on operation timeout, crash and messageerror", async () => {
    vi.useFakeTimers();
    const timeoutWorker = new MemoryWorker();
    timeoutWorker.autoRespond = false;
    const timeoutClient = createStudioProceduralMediaSurfaceWorkerClient({
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
    timeoutClient.dispose();
    vi.useRealTimers();

    for (const failureType of ["error", "messageerror"] as const) {
      const worker = new MemoryWorker();
      worker.autoRespond = false;
      const client = createStudioProceduralMediaSurfaceWorkerClient({
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
      client.dispose();
    }
  });

  it("hard-terminates on startup timeout and malformed output", async () => {
    vi.useFakeTimers();
    const startupWorker = new MemoryWorker();
    startupWorker.autoReady = false;
    const startupClient = createStudioProceduralMediaSurfaceWorkerClient({
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
    const malformedClient =
      createStudioProceduralMediaSurfaceWorkerClient({
        currentEngineEpoch: 1,
        workerFactory: () => malformedWorker,
      });
    const pending = malformedClient.render(request());
    await waitForExecute(malformedWorker);
    malformedWorker.emit({
      type: "studio-procedural-media-surface/result",
      version: STUDIO_PROCEDURAL_MEDIA_SURFACE_WORKER_PROTOCOL_VERSION,
      requestId: 1,
      requestSequence: 1,
      engineEpoch: 1,
      result: { status: "completed", receipt: { broken: true } },
    });
    await expect(pending).resolves.toMatchObject({
      status: "worker-failed",
      reason: "protocol-error",
      fallback: { workerTerminated: true },
    });
    malformedClient.dispose();
  });

  it("rejects wrong-region and hash-corrupted completed payloads", async () => {
    const wrongRegionWorker = new MemoryWorker();
    wrongRegionWorker.autoRespond = false;
    const wrongRegionClient =
      createStudioProceduralMediaSurfaceWorkerClient({
        currentEngineEpoch: 1,
        workerFactory: () => wrongRegionWorker,
      });
    const wrongRegionReceipt = await directReceipt(request({
      region: {
        originX: 100,
        originY: 200,
        width: 8,
        height: 7,
        halo: 0,
      },
    }));
    const wrongRegionPending = wrongRegionClient.render(request());
    await waitForExecute(wrongRegionWorker);
    wrongRegionWorker.emit({
      type: "studio-procedural-media-surface/result",
      version: STUDIO_PROCEDURAL_MEDIA_SURFACE_WORKER_PROTOCOL_VERSION,
      requestId: 1,
      requestSequence: 1,
      engineEpoch: 1,
      result: { status: "completed", receipt: wrongRegionReceipt },
      verification:
        createStudioProceduralMediaSurfaceWorkerVerifiedAttestation(
          1,
          wrongRegionReceipt,
        ),
    });
    await expect(wrongRegionPending).resolves.toMatchObject({
      status: "worker-failed",
      reason: "invalid-result",
      fallback: { workerTerminated: true },
    });
    wrongRegionClient.dispose();

    const corruptedWorker = new MemoryWorker();
    corruptedWorker.autoRespond = false;
    const corruptedClient =
      createStudioProceduralMediaSurfaceWorkerClient({
        currentEngineEpoch: 1,
        workerFactory: () => corruptedWorker,
      });
    const corruptedReceipt = await directReceipt();
    const verification =
      createStudioProceduralMediaSurfaceWorkerVerifiedAttestation(
        1,
        corruptedReceipt,
      );
    corruptedReceipt.artifact.heightField[0] = Math.fround(
      (corruptedReceipt.artifact.heightField[0] ?? 0) + 0.25,
    );
    const corruptedPending = corruptedClient.render(request());
    await waitForExecute(corruptedWorker);
    corruptedWorker.emit({
      type: "studio-procedural-media-surface/result",
      version: STUDIO_PROCEDURAL_MEDIA_SURFACE_WORKER_PROTOCOL_VERSION,
      requestId: 1,
      requestSequence: 1,
      engineEpoch: 1,
      result: { status: "completed", receipt: corruptedReceipt },
      verification,
    });
    await expect(corruptedPending).resolves.toMatchObject({
      status: "worker-failed",
      reason: "invalid-result",
      fallback: { workerTerminated: true },
    });
    corruptedClient.dispose();
  });

  it.each([
    ["periodic mode", "periodicMode"],
    ["work units", "workUnits"],
    ["resident bytes", "residentBytes"],
  ] as const)("binds receipt %s exactly to the active request", async (
    _label,
    field,
  ) => {
    const worker = new MemoryWorker();
    worker.autoRespond = false;
    const client = createStudioProceduralMediaSurfaceWorkerClient({
      currentEngineEpoch: 1,
      workerFactory: () => worker,
    });
    const original = await directReceipt();
    const originalSurfaceReceipt = original.artifact.receipt;
    const replacement = field === "periodicMode"
      ? (
          originalSurfaceReceipt.periodicMode === "aperiodic"
            ? "integer-fourier-torus"
            : "aperiodic"
        )
      : field === "workUnits"
        ? originalSurfaceReceipt.workUnits + 1
        : originalSurfaceReceipt.residentBytes + 4;
    const tampered = {
      ...original,
      artifact: {
        ...original.artifact,
        receipt: {
          ...originalSurfaceReceipt,
          [field]: replacement,
        },
      },
    } as StudioProceduralMediaSurfaceRenderReceipt;
    const pending = client.render(request());
    await waitForExecute(worker);
    worker.emit({
      type: "studio-procedural-media-surface/result",
      version: STUDIO_PROCEDURAL_MEDIA_SURFACE_WORKER_PROTOCOL_VERSION,
      requestId: 1,
      requestSequence: 1,
      engineEpoch: 1,
      result: { status: "completed", receipt: tampered },
      verification:
        createStudioProceduralMediaSurfaceWorkerVerifiedAttestation(
          1,
          tampered,
        ),
    });
    await expect(pending).resolves.toMatchObject({
      status: "worker-failed",
      reason: "invalid-result",
      fallback: { workerTerminated: true },
    });
    client.dispose();
  });

  it("hard-resets on release and epoch changes, then disposes", async () => {
    const first = new MemoryWorker();
    const second = new MemoryWorker(2);
    const workers = [first, second];
    const client = createStudioProceduralMediaSurfaceWorkerClient({
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
    expect(client.release()).toMatchObject({
      control: "release",
      released: true,
      workerTerminated: true,
      mainThreadComputationFallback: false,
    });
    expect(first.terminated).toBe(true);
    expect(client.advanceEngineEpoch(2)).toMatchObject({
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

  it("rejects mismatched sequence and epoch results", async () => {
    const worker = new MemoryWorker();
    worker.autoRespond = false;
    const client = createStudioProceduralMediaSurfaceWorkerClient({
      currentEngineEpoch: 1,
      workerFactory: () => worker,
    });
    const receipt = await directReceipt();
    const pending = client.render(request());
    await waitForExecute(worker);
    worker.emit({
      type: "studio-procedural-media-surface/result",
      version: STUDIO_PROCEDURAL_MEDIA_SURFACE_WORKER_PROTOCOL_VERSION,
      requestId: 1,
      requestSequence: 2,
      engineEpoch: 1,
      result: { status: "completed", receipt },
      verification:
        createStudioProceduralMediaSurfaceWorkerVerifiedAttestation(
          1,
          receipt,
        ),
    });
    await expect(pending).resolves.toMatchObject({
      status: "worker-failed",
      reason: "protocol-error",
      fallback: { workerTerminated: true },
    });
    client.dispose();
  });
});
