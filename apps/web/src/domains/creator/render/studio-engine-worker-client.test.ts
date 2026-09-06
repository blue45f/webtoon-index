import { describe, expect, it } from "vitest";

import { STUDIO_POINTER_SAMPLE_ROLE_AUTHORITATIVE } from "../studio-shared-pointer-ring-buffer";

import {
  createStudioEngineWorkerSession,
  type StudioEngineWorkerLike,
} from "./studio-engine-worker-client";
import {
  STUDIO_ENGINE_EXECUTION_PROFILE,
  STUDIO_ENGINE_WORKER_BUDGETS,
  STUDIO_ENGINE_WORKER_PROTOCOL_REVISION,
  type StudioEngineCapabilitySnapshot,
  type StudioEngineHelloAckMessage,
} from "./studio-engine-worker-protocol";

import type {
  StudioEngineOffscreenSurface,
  StudioEngineTransientContext2d,
} from "./studio-engine-worker-runtime";

interface MessageEventLike {
  readonly data: unknown;
}

interface ErrorEventLike {
  preventDefault?(): void;
}

class FakeWorker implements StudioEngineWorkerLike {
  readonly posted: unknown[] = [];
  readonly transfers: Transferable[][] = [];
  terminateCalls = 0;
  throwOnPost = false;
  private readonly messageListeners =
    new Set<(event: MessageEventLike) => void>();
  private readonly errorListeners =
    new Set<(event: ErrorEventLike) => void>();

  postMessage(message: unknown, transfer: Transferable[]): void {
    if (this.throwOnPost) throw new Error("structured clone failed");
    this.posted.push(message);
    this.transfers.push(transfer);
  }

  addEventListener(
    type: "message" | "error" | "messageerror",
    listener:
      | ((event: MessageEventLike) => void)
      | ((event: ErrorEventLike) => void),
  ): void {
    if (type === "message") {
      this.messageListeners.add(listener as (event: MessageEventLike) => void);
    } else {
      this.errorListeners.add(listener as (event: ErrorEventLike) => void);
    }
  }

  removeEventListener(
    type: "message" | "error" | "messageerror",
    listener:
      | ((event: MessageEventLike) => void)
      | ((event: ErrorEventLike) => void),
  ): void {
    if (type === "message") {
      this.messageListeners.delete(listener as (event: MessageEventLike) => void);
    } else {
      this.errorListeners.delete(listener as (event: ErrorEventLike) => void);
    }
  }

  terminate(): void {
    this.terminateCalls += 1;
  }

  emit(data: unknown): void {
    for (const listener of Array.from(this.messageListeners)) {
      listener({ data });
    }
  }

  emitError(): void {
    for (const listener of Array.from(this.errorListeners)) {
      listener({ preventDefault: () => undefined });
    }
  }
}

const CAPABILITIES: StudioEngineCapabilitySnapshot = {
  offscreenCanvas: true,
  sharedArrayBuffer: true,
  crossOriginIsolated: true,
  webGpu: true,
  wasmSimd: true,
  memory64: true,
  hardwareConcurrency: 8,
  maxTextureDimension2D: 16_384,
};

const RING_ENVIRONMENT = {
  crossOriginIsolated: true,
  SharedArrayBuffer,
  Atomics,
} as const;

function ack(sessionEpoch = 17): StudioEngineHelloAckMessage {
  return {
    type: "studio-engine/hello-ack",
    protocolRevision: STUDIO_ENGINE_WORKER_PROTOCOL_REVISION,
    sessionEpoch,
    executionProfile: STUDIO_ENGINE_EXECUTION_PROFILE,
    engineBuild: "engine-test",
    limits: {
      maxInFlightCommands: STUDIO_ENGINE_WORKER_BUDGETS.maxInFlightCommands,
      maxPointerBatchSamples: STUDIO_ENGINE_WORKER_BUDGETS.maxPointerBatchSamples,
      maxPointerRingSamples: STUDIO_ENGINE_WORKER_BUDGETS.maxPointerRingSamples,
      maxDocumentPatchBytes: STUDIO_ENGINE_WORKER_BUDGETS.maxDocumentPatchBytes,
    },
  };
}

function createSession(worker: FakeWorker | null) {
  const timers = new Map<number, () => void>();
  let nextTimer = 1;
  const failures: string[] = [];
  const messages: unknown[] = [];
  const session = createStudioEngineWorkerSession({
    capabilities: CAPABILITIES,
    clientBuild: "client-test",
    sessionEpoch: 17,
    pointerRingCapacity: 8,
    pointerRingEnvironment: RING_ENVIRONMENT,
    workerFactory: () => worker,
    setTimeoutImpl: (callback) => {
      const handle = nextTimer;
      nextTimer += 1;
      timers.set(handle, callback);
      return handle;
    },
    clearTimeoutImpl: (handle) => {
      timers.delete(handle as number);
    },
    onFailure: (failure) => failures.push(failure.code),
    onMessage: (message) => messages.push(message),
  });
  return {
    session,
    failures,
    messages,
    fireTimer() {
      const entry = timers.entries().next();
      if (entry.done) return false;
      const [handle, callback] = entry.value;
      timers.delete(handle);
      callback();
      return true;
    },
  };
}

class FakeSurface implements StudioEngineOffscreenSurface {
  width = 1;
  height = 1;
  getContext(): StudioEngineTransientContext2d | null {
    return null;
  }
}

describe("Studio Engine Worker client handshake and ownership", () => {
  it("fails before Worker construction when a future-only capability is missing", async () => {
    const worker = new FakeWorker();
    let factoryCalls = 0;
    const session = createStudioEngineWorkerSession({
      capabilities: { ...CAPABILITIES, memory64: false },
      clientBuild: "client-test",
      sessionEpoch: 17,
      pointerRingCapacity: 8,
      pointerRingEnvironment: RING_ENVIRONMENT,
      workerFactory: () => {
        factoryCalls += 1;
        return worker;
      },
    });

    await expect(session.ready).rejects.toMatchObject({
      code: "future-capabilities-required",
      message: expect.stringContaining("memory64"),
    });
    expect(factoryCalls).toBe(0);
    expect(worker.posted).toEqual([]);
    expect(session.snapshot()).toMatchObject({
      phase: "failed",
      failure: { code: "future-capabilities-required" },
    });
  });

  it("posts hello, configures SAB without transferring it, then transfers the surface exactly once", async () => {
    const worker = new FakeWorker();
    const { session } = createSession(worker);
    expect(worker.posted[0]).toMatchObject({
      type: "studio-engine/hello",
      executionProfile: STUDIO_ENGINE_EXECUTION_PROFILE,
      sessionEpoch: 17,
    });
    expect(worker.transfers[0]).toEqual([]);

    worker.emit(ack());
    await expect(session.ready).resolves.toMatchObject({
      executionProfile: STUDIO_ENGINE_EXECUTION_PROFILE,
    });
    expect(worker.posted[1]).toMatchObject({
      type: "studio-engine/command",
      commandSequence: 1,
      command: { kind: "configure-pointer-ring" },
    });
    expect(worker.transfers[1]).toEqual([]);

    const surface = new FakeSurface();
    await expect(session.attachSurface({
      surface,
      surfaceId: "transient",
      width: 640,
      height: 480,
      devicePixelRatio: 2,
    })).resolves.toBe(2);
    expect(worker.posted[2]).toMatchObject({
      type: "studio-engine/runtime-command",
      message: {
        commandSequence: 2,
        command: {
          kind: "attach-surface",
          runtimeTransfer: { kind: "offscreen-canvas", slot: 0 },
        },
      },
      runtimeTransfers: [{
        kind: "offscreen-canvas",
        slot: 0,
        surface,
      }],
    });
    expect(worker.transfers[2]).toEqual([surface]);
    await expect(session.attachSurface({
      surface,
      surfaceId: "duplicate",
      width: 1,
      height: 1,
      devicePixelRatio: 1,
    })).rejects.toMatchObject({ code: "surface-already-transferred" });
    session.dispose();
  });

  it("closes the pointer producer and terminates when transfer throws", async () => {
    const worker = new FakeWorker();
    const { session, failures } = createSession(worker);
    worker.emit(ack());
    await session.ready;
    worker.throwOnPost = true;
    await expect(session.attachSurface({
      surface: new FakeSurface(),
      surfaceId: "transient",
      width: 100,
      height: 100,
      devicePixelRatio: 1,
    })).rejects.toMatchObject({ code: "transport" });
    expect(session.snapshot()).toMatchObject({
      phase: "failed",
      surfaceTransferred: true,
      failure: { code: "transport" },
    });
    expect(session.pointerProducer?.diagnostics().closed).toBe(true);
    expect(worker.terminateCalls).toBe(1);
    expect(failures).toEqual(["transport"]);
  });
});

describe("Studio Engine Worker client hostile and stale messages", () => {
  it("fails closed on a hostile handshake and handshake timeout", async () => {
    const hostileWorker = new FakeWorker();
    const hostile = createSession(hostileWorker);
    hostileWorker.emit({ type: "not-engine" });
    await expect(hostile.session.ready).rejects.toMatchObject({
      code: "protocol",
    });
    expect(hostileWorker.terminateCalls).toBe(1);

    const timeoutWorker = new FakeWorker();
    const timeout = createSession(timeoutWorker);
    expect(timeout.fireTimer()).toBe(true);
    await expect(timeout.session.ready).rejects.toMatchObject({
      code: "handshake-timeout",
    });
    expect(timeoutWorker.terminateCalls).toBe(1);
  });

  it("accepts one prefix and rejects its duplicate without mutating authority", async () => {
    const worker = new FakeWorker();
    const { session } = createSession(worker);
    worker.emit(ack());
    await session.ready;
    const receipt = {
      type: "studio-engine/accepted-prefix",
      protocolRevision: STUDIO_ENGINE_WORKER_PROTOCOL_REVISION,
      sessionEpoch: 17,
      acceptedThroughCommandSequence: 1,
      queuedCommands: 0,
      queuedPointerSamples: 0,
      pressure: "none",
    } as const;
    worker.emit(receipt);
    expect(session.snapshot()).toMatchObject({
      phase: "ready",
      lastAcceptedCommandSequence: 1,
    });
    worker.emit(receipt);
    expect(session.snapshot()).toMatchObject({
      phase: "failed",
      lastAcceptedCommandSequence: 1,
      failure: { code: "protocol" },
    });
    expect(worker.terminateCalls).toBe(1);
  });

  it("rejects stale epochs, frame receipts ahead of sent commands, and worker errors", async () => {
    const staleWorker = new FakeWorker();
    const stale = createSession(staleWorker);
    staleWorker.emit(ack());
    await stale.session.ready;
    staleWorker.emit({
      type: "studio-engine/frame",
      protocolRevision: STUDIO_ENGINE_WORKER_PROTOCOL_REVISION,
      sessionEpoch: 18,
      frameSequence: 1,
      acceptedThroughCommandSequence: 1,
      surfaceId: "transient",
      documentRevision: 0,
      presentedAt: 1,
      cpuMilliseconds: 0.2,
      gpuMilliseconds: null,
      pointerSamplesRendered: 1,
      droppedFrames: 0,
    });
    expect(stale.session.snapshot().phase).toBe("failed");

    const aheadWorker = new FakeWorker();
    const ahead = createSession(aheadWorker);
    aheadWorker.emit(ack());
    await ahead.session.ready;
    aheadWorker.emit({
      type: "studio-engine/frame",
      protocolRevision: STUDIO_ENGINE_WORKER_PROTOCOL_REVISION,
      sessionEpoch: 17,
      frameSequence: 1,
      acceptedThroughCommandSequence: 2,
      surfaceId: "transient",
      documentRevision: 0,
      presentedAt: 1,
      cpuMilliseconds: 0.2,
      gpuMilliseconds: null,
      pointerSamplesRendered: 1,
      droppedFrames: 0,
    });
    expect(ahead.session.snapshot().phase).toBe("failed");

    const errorWorker = new FakeWorker();
    const errored = createSession(errorWorker);
    errorWorker.emitError();
    await expect(errored.session.ready).rejects.toMatchObject({
      code: "worker-failed",
    });
    expect(errorWorker.terminateCalls).toBe(1);
  });
});

describe("Studio Engine Worker client pointer boundary transport", () => {
  it("writes authoritative samples to the shared ring and closes on dispose", async () => {
    const worker = new FakeWorker();
    const { session } = createSession(worker);
    worker.emit(ack());
    await session.ready;
    expect(session.writePointer({
      x: 1,
      y: 2,
      pressure: 0.5,
      tiltX: 0,
      tiltY: 0,
      twist: 0,
      time: 1,
      pointerId: 1,
      sequence: 1,
      role: STUDIO_POINTER_SAMPLE_ROLE_AUTHORITATIVE,
      channel: 0,
      flags: 1,
    })).toBe("written");
    expect(session.pointerProducer?.diagnostics().available).toBe(1);
    session.dispose();
    expect(session.pointerProducer?.diagnostics().closed).toBe(true);
    expect(session.writePointer({
      x: 2,
      y: 3,
      pressure: 0.5,
      tiltX: 0,
      tiltY: 0,
      twist: 0,
      time: 2,
      pointerId: 1,
      sequence: 2,
      role: STUDIO_POINTER_SAMPLE_ROLE_AUTHORITATIVE,
      channel: 0,
      flags: 2,
    })).toBe("unavailable");
  });
});
