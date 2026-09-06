import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createStudioPhysicsParticleBrushProvider,
  type StudioPhysicsParticleBrushArtifact,
  type StudioPhysicsParticleBrushRecipe,
  type StudioPhysicsParticleBrushRequest,
  type StudioPhysicsParticleBrushReceipt,
} from "./studio-physics-particle-brush-provider";
import {
  createStudioPhysicsParticleWorkerClient,
  type StudioPhysicsParticleWorkerLike,
} from "./studio-physics-particle-brush-worker-client";
import {
  installStudioPhysicsParticleWorkerHost,
  type StudioPhysicsParticleWorkerHostScope,
} from "./studio-physics-particle-brush-worker-host";
import {
  packStudioPhysicsParticleWorkerSamples,
  snapshotStudioPhysicsParticleWorkerInboundMessage,
  snapshotStudioPhysicsParticleWorkerOutboundMessage,
  snapshotStudioPhysicsParticleWorkerRequest,
  snapshotStudioPhysicsParticleWorkerRequestCooperatively,
  STUDIO_PHYSICS_PARTICLE_WORKER_PROTOCOL_VERSION,
  studioPhysicsParticleWireRequestToProviderRequest,
  studioPhysicsParticleWorkerRequestTransfers,
  studioPhysicsParticleWorkerResultTransfers,
  type StudioPhysicsParticleWorkerExecuteMessage,
  type StudioPhysicsParticleWorkerInboundMessage,
  type StudioPhysicsParticleWorkerOutboundMessage,
  type StudioPhysicsParticleWorkerResultMessage,
  type StudioPhysicsParticleWorkerWireRequest,
} from "./studio-physics-particle-brush-worker-protocol";

interface MessageEventLike {
  readonly data: unknown;
}

interface ErrorEventLike {
  preventDefault?(): void;
}

function recipe(): StudioPhysicsParticleBrushRecipe {
  return {
    mode: "orbital",
    seed: 1_337,
    common: {
      count: 3,
      spawnSpacing: 5,
      fixedTimeStepSeconds: 1 / 60,
      globalChaos: 0.3,
      localChaos: 0.2,
      chaosSmoothing: 0.7,
      damping: 0.2,
      dampingJitter: 0.1,
      directionalForce: 0.5,
      forceDirectionRadians: 0.4,
      baseRadius: 2,
      baseAlpha: 0.8,
      baseWeight: 1.2,
      baseGlow: 0.1,
      expressions: {
        radius: {
          source: "pressure",
          minimum: 0.5,
          maximum: 1.5,
        },
      },
    },
    orbital: {
      steps: 4,
      velocity: 8,
      acceleration: -1,
      spin: 1.2,
      orbitRadius: 3,
      orbitRadiusJitter: 0.2,
    },
  };
}

function wireRequest(
  overrides: Partial<StudioPhysicsParticleWorkerWireRequest> = {},
): StudioPhysicsParticleWorkerWireRequest {
  return {
    requestEpoch: 1,
    recipe: recipe(),
    samples: packStudioPhysicsParticleWorkerSamples([
      {
        x: 0,
        y: 0,
        pressure: 0.3,
        speed: 0.2,
        tiltX: 0,
        tiltY: 0,
      },
      {
        x: 10,
        y: 0,
        pressure: 0.8,
        speed: 0.7,
        tiltX: 0.5,
        tiltY: -0.5,
      },
    ]),
    ...overrides,
  };
}

async function artifactFor(
  request: StudioPhysicsParticleBrushRequest,
): Promise<StudioPhysicsParticleBrushArtifact> {
  const receipt = await createStudioPhysicsParticleBrushProvider({
    epoch: request.epoch,
  }).render(request);
  if (!receipt.artifact) throw new Error("Expected a complete artifact");
  return receipt.artifact;
}

class MemoryWorker implements StudioPhysicsParticleWorkerLike {
  readonly inbound: StudioPhysicsParticleWorkerInboundMessage[] = [];
  readonly transfers: Transferable[][] = [];
  terminated = false;
  autoReady = true;
  autoRespond = true;
  malformedResult = false;
  mutateOutputAfterEmit = false;
  responseRecipe: StudioPhysicsParticleBrushRecipe | null = null;
  readyEpoch = 0;
  private readonly provider = createStudioPhysicsParticleBrushProvider();
  private activeController: AbortController | null = null;
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
          if (!this.terminated) this.emitReady();
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
    message: StudioPhysicsParticleWorkerInboundMessage,
    transfer: Transferable[] = [],
  ): void {
    this.inbound.push(message);
    this.transfers.push(transfer);
    if (message.type === "studio-physics-particle/advance-epoch") {
      this.readyEpoch = message.epoch;
      this.provider.setEpoch(message.epoch);
      queueMicrotask(() => this.emitReady());
      return;
    }
    if (
      message.type === "studio-physics-particle/cancel"
      || message.type === "studio-physics-particle/release"
    ) {
      this.activeController?.abort();
      return;
    }
    if (!this.autoRespond) return;
    const controller = new AbortController();
    this.activeController = controller;
    const providerRequest = studioPhysicsParticleWireRequestToProviderRequest(
      message.request,
      controller.signal,
    );
    void this.provider.render({
      ...providerRequest,
      recipe: this.responseRecipe ?? providerRequest.recipe,
    }).then((receipt) => {
      if (this.terminated || controller.signal.aborted) return;
      const outbound: StudioPhysicsParticleWorkerResultMessage = {
        type: "studio-physics-particle/result",
        version: STUDIO_PHYSICS_PARTICLE_WORKER_PROTOCOL_VERSION,
        requestId: message.requestId,
        requestEpoch: message.request.requestEpoch,
        workerSequence: message.workerSequence,
        result: { status: "completed", receipt },
      };
      if (this.malformedResult) {
        this.emit({ ...outbound, result: { status: "completed" } });
      } else {
        this.emit(outbound);
      }
      if (this.mutateOutputAfterEmit && receipt.artifact) {
        receipt.artifact.path.positions.fill(91);
        receipt.artifact.deposition.alpha.fill(0);
      }
    });
  }

  emit(data: unknown): void {
    for (const listener of this.messageListeners) listener({ data });
  }

  emitReady(): void {
    this.emit({
      type: "studio-physics-particle/ready",
      version: STUDIO_PHYSICS_PARTICLE_WORKER_PROTOCOL_VERSION,
      epoch: this.readyEpoch,
      workerSequence: 0,
    });
  }

  fail(type: "error" | "messageerror"): void {
    const listeners = type === "error"
      ? this.errorListeners
      : this.messageErrorListeners;
    for (const listener of listeners) listener({});
  }

  terminate(): void {
    this.terminated = true;
    this.activeController?.abort();
    this.provider.dispose();
  }
}

class MemoryHostScope implements StudioPhysicsParticleWorkerHostScope {
  readonly outbound: StudioPhysicsParticleWorkerOutboundMessage[] = [];
  readonly transfers: Transferable[][] = [];
  private readonly listeners = new Set<
    (event: MessageEventLike) => void
  >();

  postMessage(
    message: StudioPhysicsParticleWorkerOutboundMessage,
    transfer: Transferable[],
  ): void {
    this.outbound.push(message);
    this.transfers.push(transfer);
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

afterEach(() => {
  vi.useRealTimers();
});

describe("Studio physics particle dedicated Worker boundary", () => {
  it("defensively snapshots samples, flow fields, and append artifacts", async () => {
    const previous = await artifactFor({
      recipe: recipe(),
      samples: [
        { x: 0, y: 0, pressure: 0.3 },
        { x: 5, y: 0, pressure: 0.5 },
      ],
      epoch: 1,
    });
    const samples = wireRequest().samples;
    const heights = new Float32Array([
      0, 1, 2,
      1, 2, 3,
      2, 3, 4,
    ]);
    const snapshot = snapshotStudioPhysicsParticleWorkerRequest({
      ...wireRequest({
        samples,
        flowField: {
          width: 3,
          height: 3,
          originX: 0,
          originY: -5,
          cellSize: 5,
          heights,
        },
        append: { previous },
      }),
    });
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;
    const originalSample = snapshot.request.samples[0];
    const originalHeight = snapshot.request.flowField?.heights[0];
    const originalPath = snapshot.request.append?.previous.path.positions[0];
    samples.fill(99);
    heights.fill(99);
    previous.path.positions.fill(99);
    expect(snapshot.request.samples[0]).toBe(originalSample);
    expect(snapshot.request.flowField?.heights[0]).toBe(originalHeight);
    expect(
      snapshot.request.append?.previous.path.positions[0],
    ).toBe(originalPath);
  });

  it("keeps synchronous and cooperative non-append snapshots byte-exact", async () => {
    const candidate = wireRequest({
      flowField: {
        width: 3,
        height: 3,
        originX: -5,
        originY: -5,
        cellSize: 5,
        heights: new Float32Array([
          0, 1, 2,
          1, 2, 3,
          2, 3, 4,
        ]),
      },
    });
    const synchronous = snapshotStudioPhysicsParticleWorkerRequest(candidate);
    const cooperative =
      await snapshotStudioPhysicsParticleWorkerRequestCooperatively(candidate);

    expect(cooperative).toEqual(synchronous);
  });

  it("rejects aggregate clone residency before touching append payload planes", () => {
    let payloadTouched = false;
    const hostilePrevious = {
      outputBytes: 200 * 1_048_576,
      get emitterStations(): never {
        payloadTouched = true;
        throw new Error("payload must not be inspected");
      },
    };
    const snapshot = snapshotStudioPhysicsParticleWorkerRequest({
      ...wireRequest(),
      append: { previous: hostilePrevious },
    });
    expect(snapshot).toEqual({ ok: false, reason: "budget-exceeded" });
    expect(payloadTouched).toBe(false);
  });

  it("cancels a large append snapshot cooperatively before Worker creation", async () => {
    const largeRecipe: StudioPhysicsParticleBrushRecipe = {
      ...recipe(),
      common: {
        ...recipe().common,
        count: 64,
        spawnSpacing: 5,
      },
      orbital: {
        ...recipe().orbital!,
        steps: 32,
      },
    };
    const largeSamples: readonly [
      StudioPhysicsParticleBrushRequest["samples"][number],
      StudioPhysicsParticleBrushRequest["samples"][number],
    ] = [
      { x: 0, y: 0, pressure: 0.3 },
      { x: 320, y: 0, pressure: 0.8 },
    ];
    const previous = await artifactFor({
      recipe: largeRecipe,
      samples: largeSamples,
      epoch: 1,
    });
    expect(previous.path.positions.byteLength).toBeGreaterThan(1_048_576);
    const controller = new AbortController();
    let workerCreations = 0;
    const client = createStudioPhysicsParticleWorkerClient({
      currentEpoch: 1,
      workerFactory: () => {
        workerCreations += 1;
        return new MemoryWorker();
      },
    });
    const pending = client.render(wireRequest({
      recipe: largeRecipe,
      samples: packStudioPhysicsParticleWorkerSamples(largeSamples),
      append: { previous },
    }), controller.signal);
    setTimeout(() => controller.abort(), 0);
    await expect(pending).resolves.toMatchObject({
      status: "worker-failed",
      reason: "aborted",
      fallback: { workerTerminated: false },
    });
    expect(workerCreations).toBe(0);
    expect(client.getDiagnostics()).toMatchObject({
      phase: "cold",
      operationReserved: false,
    });
    client.dispose();

    let releasedWorkerCreations = 0;
    const releasedClient = createStudioPhysicsParticleWorkerClient({
      currentEpoch: 1,
      workerFactory: () => {
        releasedWorkerCreations += 1;
        return new MemoryWorker();
      },
    });
    const released = releasedClient.render(wireRequest({
      recipe: largeRecipe,
      samples: packStudioPhysicsParticleWorkerSamples(largeSamples),
      append: { previous },
    }));
    setTimeout(() => releasedClient.release(), 0);
    await expect(released).resolves.toMatchObject({
      status: "worker-failed",
      reason: "aborted",
      fallback: { workerTerminated: false },
    });
    expect(releasedWorkerCreations).toBe(0);
    expect(releasedClient.getDiagnostics()).toMatchObject({
      phase: "cold",
      operationReserved: false,
    });
    releasedClient.dispose();
  });

  it.each([
    ["external abort", "aborted"],
    ["release", "aborted"],
    ["epoch advance", "stale-epoch"],
    ["dispose", "disposed"],
  ] as const)(
    "settles a pending non-append snapshot on %s without advancing fake timers",
    async (transition, reason) => {
      vi.useFakeTimers();
      const clear = vi.spyOn(globalThis, "clearTimeout");
      const samples = new Float32Array(50_000 * 6);
      for (let index = 0; index < 50_000; index += 1) {
        const offset = index * 6;
        samples[offset] = index / 1_000;
        samples[offset + 2] = 0.5;
      }
      const external = new AbortController();
      let workerCreations = 0;
      const client = createStudioPhysicsParticleWorkerClient({
        currentEpoch: 1,
        workerFactory: () => {
          workerCreations += 1;
          return new MemoryWorker();
        },
      });
      try {
        const pending = client.render(
          wireRequest({ samples }),
          external.signal,
        );
        expect(vi.getTimerCount()).toBeGreaterThan(0);

        if (transition === "external abort") external.abort();
        else if (transition === "release") client.release();
        else if (transition === "epoch advance") client.advanceEpoch(2);
        else client.dispose();

        await expect(pending).resolves.toMatchObject(
          reason === "stale-epoch"
            ? { status: "rejected", reason }
            : { status: "worker-failed", reason },
        );
        expect(workerCreations).toBe(0);
        expect(clear).toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
        expect(client.getDiagnostics().operationReserved).toBe(false);
      } finally {
        client.dispose();
        clear.mockRestore();
      }
    },
  );

  it("owns all input and output transfer buffers", async () => {
    const source = wireRequest();
    const snapshot = snapshotStudioPhysicsParticleWorkerRequest(source);
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;
    const execute: StudioPhysicsParticleWorkerExecuteMessage = {
      type: "studio-physics-particle/execute",
      version: STUDIO_PHYSICS_PARTICLE_WORKER_PROTOCOL_VERSION,
      requestId: 1,
      workerSequence: 1,
      request: snapshot.request,
    };
    const requestTransfers =
      studioPhysicsParticleWorkerRequestTransfers(execute);
    expect(requestTransfers).toContain(snapshot.request.samples.buffer);
    expect(requestTransfers).not.toContain(source.samples.buffer);

    const receipt = await createStudioPhysicsParticleBrushProvider({
      epoch: 1,
    }).render(
      studioPhysicsParticleWireRequestToProviderRequest(
        snapshot.request,
        new AbortController().signal,
      ),
    );
    const result: StudioPhysicsParticleWorkerResultMessage = {
      type: "studio-physics-particle/result",
      version: STUDIO_PHYSICS_PARTICLE_WORKER_PROTOCOL_VERSION,
      requestId: 1,
      requestEpoch: 1,
      workerSequence: 1,
      result: { status: "completed", receipt },
    };
    const outputTransfers =
      studioPhysicsParticleWorkerResultTransfers(result);
    expect(outputTransfers).toContain(receipt.artifact?.path.positions.buffer);
    expect(outputTransfers).toContain(
      receipt.artifact?.deposition.alpha.buffer,
    );
  });

  it("strictly snapshots inbound and outbound envelopes", () => {
    const execute = snapshotStudioPhysicsParticleWorkerInboundMessage({
      type: "studio-physics-particle/execute",
      version: 1,
      requestId: 1,
      workerSequence: 1,
      request: wireRequest(),
    });
    expect(execute?.type).toBe("studio-physics-particle/execute");
    expect(snapshotStudioPhysicsParticleWorkerInboundMessage({
      ...execute,
      hidden: true,
    })).toBeNull();
    expect(snapshotStudioPhysicsParticleWorkerOutboundMessage({
      type: "studio-physics-particle/ready",
      version: 1,
      epoch: 0,
      workerSequence: 0,
    })).not.toBeNull();
  });

  it("handshakes the epoch and renders without a main-thread fallback", async () => {
    const workers: MemoryWorker[] = [];
    const client = createStudioPhysicsParticleWorkerClient({
      currentEpoch: 1,
      workerFactory: () => {
        const worker = new MemoryWorker();
        workers.push(worker);
        return worker;
      },
    });
    const source = wireRequest();
    const first = source.samples[0];
    const pending = client.render(source);
    source.samples.fill(99);
    const result = await pending;
    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      expect(result.receipt).toMatchObject({
        epoch: 1,
        sequence: 1,
        mode: "orbital",
        inputSamples: 2,
        spawnCount: 3,
        pathPointCount: 36,
      });
      expect(result.receipt.artifact?.emitterStations[0]).toBe(first);
    }
    expect(workers[0].inbound[0]).toMatchObject({
      type: "studio-physics-particle/advance-epoch",
      epoch: 1,
    });
    expect(workers[0].transfers.at(-1)).toContainEqual(
      expect.any(ArrayBuffer),
    );
    expect(client.getDiagnostics()).toMatchObject({
      phase: "ready",
      workerGeneration: 1,
      workerSequence: 1,
      mainThreadComputationFallback: false,
    });
    client.dispose();
  });

  it("copies completed output before exposing it to the caller", async () => {
    const worker = new MemoryWorker();
    worker.mutateOutputAfterEmit = true;
    const client = createStudioPhysicsParticleWorkerClient({
      currentEpoch: 1,
      workerFactory: () => worker,
    });
    const result = await client.render(wireRequest());
    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      expect(result.receipt.artifact?.path.positions[0]).not.toBe(91);
      expect(result.receipt.artifact?.deposition.alpha[0]).toBeGreaterThan(0);
    }
    client.dispose();
  });

  it("rejects an internally valid receipt for different request content", async () => {
    const worker = new MemoryWorker();
    worker.responseRecipe = {
      ...recipe(),
      common: {
        ...recipe().common,
        directionalForce: recipe().common.directionalForce + 1,
      },
    };
    const client = createStudioPhysicsParticleWorkerClient({
      currentEpoch: 1,
      workerFactory: () => worker,
    });
    await expect(client.render(wireRequest())).resolves.toMatchObject({
      status: "worker-failed",
      reason: "invalid-result",
      fallback: { workerTerminated: true },
    });
    expect(worker.terminated).toBe(true);
  });

  it("enforces one-operation backpressure without spawning another Worker", async () => {
    const worker = new MemoryWorker();
    worker.autoRespond = false;
    const client = createStudioPhysicsParticleWorkerClient({
      currentEpoch: 1,
      workerFactory: () => worker,
    });
    const first = client.render(wireRequest());
    await vi.waitFor(() => {
      expect(client.getDiagnostics().activeRequestId).not.toBeNull();
    });
    const second = await client.render(wireRequest());
    expect(second).toMatchObject({
      status: "worker-failed",
      reason: "backpressure",
      fallback: { mainThreadComputationFallback: false },
    });
    client.release();
    await expect(first).resolves.toMatchObject({
      status: "worker-failed",
      reason: "aborted",
    });
  });

  it("rolls hostile AbortSignal setup and cleanup back without wedging ownership", async () => {
    const worker = new MemoryWorker();
    const client = createStudioPhysicsParticleWorkerClient({
      currentEpoch: 1,
      workerFactory: () => worker,
    });
    const addFailure = new AbortController();
    Object.defineProperty(addFailure.signal, "addEventListener", {
      configurable: true,
      value(): never {
        throw new Error("hostile add");
      },
    });
    await expect(
      client.render(wireRequest(), addFailure.signal),
    ).resolves.toEqual({ status: "rejected", reason: "invalid-request" });
    expect(client.getDiagnostics()).toMatchObject({
      activeRequestId: null,
      operationReserved: false,
      workerSequence: 0,
    });

    const removeFailure = new AbortController();
    Object.defineProperty(removeFailure.signal, "removeEventListener", {
      configurable: true,
      value(): never {
        throw new Error("hostile remove");
      },
    });
    await expect(
      client.render(wireRequest(), removeFailure.signal),
    ).resolves.toMatchObject({
      status: "completed",
      receipt: { sequence: 1 },
    });
    await expect(client.render(wireRequest())).resolves.toMatchObject({
      status: "completed",
      receipt: { sequence: 2 },
    });
    client.dispose();
  });

  it("rechecks abort after listener setup without consuming request identity", async () => {
    const workers: MemoryWorker[] = [];
    const client = createStudioPhysicsParticleWorkerClient({
      currentEpoch: 1,
      workerFactory: () => {
        const worker = new MemoryWorker();
        workers.push(worker);
        return worker;
      },
    });
    const external = new AbortController();
    const originalAdd = external.signal.addEventListener;
    Object.defineProperty(external.signal, "addEventListener", {
      configurable: true,
      value(
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | AddEventListenerOptions,
      ): void {
        external.abort();
        originalAdd.call(this, type, listener, options);
      },
    });
    await expect(
      client.render(wireRequest(), external.signal),
    ).resolves.toMatchObject({
      status: "worker-failed",
      reason: "aborted",
    });
    expect(client.getDiagnostics()).toMatchObject({
      activeRequestId: null,
      operationReserved: false,
      workerSequence: 0,
    });
    await expect(client.render(wireRequest())).resolves.toMatchObject({
      status: "completed",
      receipt: { sequence: 1 },
    });
    expect(workers).toHaveLength(1);
    client.dispose();
  });

  it("does not create a Worker when candidate snapshot callbacks abort", async () => {
    const workers: MemoryWorker[] = [];
    const client = createStudioPhysicsParticleWorkerClient({
      currentEpoch: 1,
      workerFactory: () => {
        const worker = new MemoryWorker();
        workers.push(worker);
        return worker;
      },
    });
    const controller = new AbortController();
    const candidate = new Proxy(wireRequest(), {
      ownKeys(target) {
        controller.abort();
        return Reflect.ownKeys(target);
      },
    });
    await expect(client.render(candidate, controller.signal)).resolves.toMatchObject({
      status: "worker-failed",
      reason: "aborted",
      fallback: { workerTerminated: false },
    });
    expect(workers).toHaveLength(0);
    expect(client.getDiagnostics()).toMatchObject({
      phase: "cold",
      activeRequestId: null,
      operationReserved: false,
    });
    await expect(client.render(wireRequest())).resolves.toMatchObject({
      status: "completed",
      receipt: { sequence: 1 },
    });
    expect(workers).toHaveLength(1);
    client.dispose();
  });

  it("terminates a Worker returned after factory-time abort reentry", async () => {
    const worker = new MemoryWorker();
    const controller = new AbortController();
    const client: ReturnType<typeof createStudioPhysicsParticleWorkerClient> =
      createStudioPhysicsParticleWorkerClient({
        currentEpoch: 1,
        workerFactory: () => {
          controller.abort();
          return worker;
        },
      });
    await expect(
      client.render(wireRequest(), controller.signal),
    ).resolves.toMatchObject({
      status: "worker-failed",
      reason: "aborted",
      fallback: { workerTerminated: true },
    });
    expect(worker.terminated).toBe(true);
    expect(client.getDiagnostics()).toMatchObject({
      phase: "cold",
      workerGeneration: 1,
      activeRequestId: null,
      operationReserved: false,
    });
    client.dispose();
  });

  it("terminates a Worker returned after factory-time release reentry", async () => {
    const worker = new MemoryWorker();
    const client: ReturnType<typeof createStudioPhysicsParticleWorkerClient> =
      createStudioPhysicsParticleWorkerClient({
        currentEpoch: 1,
        workerFactory: () => {
          client.release();
          return worker;
        },
      });
    await expect(client.render(wireRequest())).resolves.toMatchObject({
      status: "worker-failed",
      reason: "aborted",
      fallback: { workerTerminated: true },
    });
    expect(worker.terminated).toBe(true);
    expect(client.getDiagnostics()).toMatchObject({
      phase: "cold",
      workerGeneration: 1,
      activeRequestId: null,
      operationReserved: false,
    });
    client.dispose();
  });

  it("terminates a Worker returned after factory-time epoch reentry", async () => {
    const worker = new MemoryWorker();
    const client: ReturnType<typeof createStudioPhysicsParticleWorkerClient> =
      createStudioPhysicsParticleWorkerClient({
        currentEpoch: 1,
        workerFactory: () => {
          expect(client.advanceEpoch(2)).toBe(true);
          return worker;
        },
      });
    await expect(client.render(wireRequest())).resolves.toEqual({
      status: "rejected",
      reason: "stale-epoch",
    });
    expect(worker.terminated).toBe(true);
    expect(client.getDiagnostics()).toMatchObject({
      phase: "cold",
      currentEpoch: 2,
      workerGeneration: 1,
      workerSequence: 0,
      activeRequestId: null,
      operationReserved: false,
    });
    client.dispose();
  });

  it("terminates a Worker returned after factory-time dispose reentry", async () => {
    const worker = new MemoryWorker();
    const client: ReturnType<typeof createStudioPhysicsParticleWorkerClient> =
      createStudioPhysicsParticleWorkerClient({
        currentEpoch: 1,
        workerFactory: () => {
          client.dispose();
          return worker;
        },
      });
    await expect(client.render(wireRequest())).resolves.toMatchObject({
      status: "worker-failed",
      reason: "disposed",
      fallback: { workerTerminated: true },
    });
    expect(worker.terminated).toBe(true);
    expect(client.getDiagnostics()).toMatchObject({
      phase: "disposed",
      workerGeneration: 1,
      activeRequestId: null,
      operationReserved: false,
    });
  });

  it("reserves ownership before candidate and signal callback reentry", async () => {
    const candidateWorker = new MemoryWorker();
    const candidateClient = createStudioPhysicsParticleWorkerClient({
      currentEpoch: 1,
      workerFactory: () => candidateWorker,
    });
    let candidateReentry:
      | Promise<Awaited<ReturnType<typeof candidateClient.render>>>
      | undefined;
    const source = wireRequest();
    const hostileCandidate = new Proxy(source, {
      ownKeys(target) {
        candidateReentry ??= candidateClient.render(wireRequest());
        return Reflect.ownKeys(target);
      },
    });
    await expect(
      candidateClient.render(hostileCandidate),
    ).resolves.toMatchObject({
      status: "completed",
      receipt: { sequence: 1 },
    });
    await expect(candidateReentry).resolves.toMatchObject({
      status: "worker-failed",
      reason: "backpressure",
    });
    candidateClient.dispose();

    const signalWorker = new MemoryWorker();
    const signalClient = createStudioPhysicsParticleWorkerClient({
      currentEpoch: 1,
      workerFactory: () => signalWorker,
    });
    const signal = new AbortController();
    const originalAdd = signal.signal.addEventListener;
    let signalReentry:
      | Promise<Awaited<ReturnType<typeof signalClient.render>>>
      | undefined;
    Object.defineProperty(signal.signal, "addEventListener", {
      configurable: true,
      value(
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | AddEventListenerOptions,
      ): void {
        signalReentry ??= signalClient.render(wireRequest());
        originalAdd.call(this, type, listener, options);
      },
    });
    await expect(
      signalClient.render(wireRequest(), signal.signal),
    ).resolves.toMatchObject({
      status: "completed",
      receipt: { sequence: 1 },
    });
    await expect(signalReentry).resolves.toMatchObject({
      status: "worker-failed",
      reason: "backpressure",
    });
    signalClient.dispose();
  });

  it.each(["error", "messageerror"] as const)(
    "hard-terminates on %s and cold-starts the next generation",
    async (failureType) => {
      const workers: MemoryWorker[] = [];
      const client = createStudioPhysicsParticleWorkerClient({
        currentEpoch: 1,
        workerFactory: () => {
          const worker = new MemoryWorker();
          worker.autoRespond = workers.length > 0;
          workers.push(worker);
          return worker;
        },
      });
      const failed = client.render(wireRequest());
      await vi.waitFor(() => {
        expect(client.getDiagnostics().activeRequestId).not.toBeNull();
      });
      workers[0].fail(failureType);
      await expect(failed).resolves.toMatchObject({
        status: "worker-failed",
        reason: "worker-unavailable",
        fallback: {
          workerTerminated: true,
          mainThreadComputationFallback: false,
        },
      });
      await expect(client.render(wireRequest())).resolves.toMatchObject({
        status: "completed",
      });
      expect(workers).toHaveLength(2);
      client.dispose();
    },
  );

  it("hard-terminates malformed output and refuses to compute locally", async () => {
    const worker = new MemoryWorker();
    worker.malformedResult = true;
    const client = createStudioPhysicsParticleWorkerClient({
      currentEpoch: 1,
      workerFactory: () => worker,
    });
    await expect(client.render(wireRequest())).resolves.toMatchObject({
      status: "worker-failed",
      reason: "protocol-error",
      fallback: {
        workerTerminated: true,
        mainThreadComputationFallback: false,
      },
    });
    expect(worker.terminated).toBe(true);
  });

  it("hard-terminates startup and operation timeouts", async () => {
    const startupWorker = new MemoryWorker();
    startupWorker.autoReady = false;
    const startupClient = createStudioPhysicsParticleWorkerClient({
      currentEpoch: 1,
      workerFactory: () => startupWorker,
      startupTimeoutMilliseconds: 5,
    });
    await expect(startupClient.render(wireRequest())).resolves.toMatchObject({
      status: "worker-failed",
      reason: "startup-timeout",
      fallback: { workerTerminated: true },
    });

    const operationWorker = new MemoryWorker();
    operationWorker.autoRespond = false;
    const operationClient = createStudioPhysicsParticleWorkerClient({
      currentEpoch: 1,
      workerFactory: () => operationWorker,
      operationTimeoutMilliseconds: 5,
    });
    await expect(operationClient.render(wireRequest())).resolves.toMatchObject({
      status: "worker-failed",
      reason: "operation-timeout",
      fallback: { workerTerminated: true },
    });
  });

  it("advancing the epoch rejects in-flight work and requires a cold Worker", async () => {
    const workers: MemoryWorker[] = [];
    const client = createStudioPhysicsParticleWorkerClient({
      currentEpoch: 1,
      workerFactory: () => {
        const worker = new MemoryWorker();
        worker.autoRespond = workers.length > 0;
        workers.push(worker);
        return worker;
      },
    });
    const stale = client.render(wireRequest());
    await vi.waitFor(() => {
      expect(client.getDiagnostics().activeRequestId).not.toBeNull();
    });
    expect(client.advanceEpoch(2)).toBe(true);
    await expect(stale).resolves.toEqual({
      status: "rejected",
      reason: "stale-epoch",
    });
    await expect(client.render(wireRequest({
      requestEpoch: 2,
    }))).resolves.toMatchObject({ status: "completed" });
    expect(workers).toHaveLength(2);
    client.dispose();
  });

  it("runs the host oracle, validates sequence, and transfers every output plane", async () => {
    const scope = new MemoryHostScope();
    const host = installStudioPhysicsParticleWorkerHost(scope, {
      initialEpoch: 1,
    });
    scope.dispatch({
      type: "studio-physics-particle/execute",
      version: STUDIO_PHYSICS_PARTICLE_WORKER_PROTOCOL_VERSION,
      requestId: 1,
      workerSequence: 1,
      request: wireRequest(),
    });
    await vi.waitFor(() => {
      expect(scope.outbound).toHaveLength(2);
    });
    const result = scope.outbound[1];
    expect(result.type).toBe("studio-physics-particle/result");
    if (result.type === "studio-physics-particle/result") {
      expect(result.result.status).toBe("completed");
      expect(scope.transfers[1].length).toBe(10);
    }
    expect(host.workerSequence()).toBe(1);
    host.dispose();
  });

  it("host fails malformed executor output closed inside the Worker", async () => {
    const scope = new MemoryHostScope();
    const host = installStudioPhysicsParticleWorkerHost(scope, {
      initialEpoch: 1,
      execute: async () => ({} as StudioPhysicsParticleBrushReceipt),
    });
    scope.dispatch({
      type: "studio-physics-particle/execute",
      version: STUDIO_PHYSICS_PARTICLE_WORKER_PROTOCOL_VERSION,
      requestId: 1,
      workerSequence: 1,
      request: wireRequest(),
    });
    await vi.waitFor(() => {
      expect(scope.outbound).toHaveLength(2);
    });
    expect(scope.outbound[1]).toMatchObject({
      type: "studio-physics-particle/result",
      result: {
        status: "worker-failed",
        reason: "invalid-result",
        fallback: { mainThreadComputationFallback: false },
      },
    });
    host.dispose();
  });
});
