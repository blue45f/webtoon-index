import { afterEach, describe, expect, it, vi } from "vitest";

import { readStudioBg3dEditorSource } from "./read-studio-bg3d-editor-source";
import {
  STUDIO_BG3D_PHYSICS_TIMELINE_PROTOCOL_VERSION,
  STUDIO_BG3D_PHYSICS_TIMELINE_STEP_SECONDS,
  type StudioBg3dPhysicsTimelineWorkerRunMessage,
} from "./studio-bg3d-physics-timeline";
import {
  createStudioBg3dPhysicsTimelineWorkerSession,
  runStudioBg3dPhysicsTimeline,
  type StudioBg3dPhysicsTimelineWorkerLike,
} from "./studio-bg3d-physics-worker-client";

const background3dEditorSource = readStudioBg3dEditorSource();

class FakeWorker implements StudioBg3dPhysicsTimelineWorkerLike {
  readonly messages: StudioBg3dPhysicsTimelineWorkerRunMessage[] = [];
  readonly messageListeners = new Set<(event: { readonly data: unknown }) => void>();
  readonly errorListeners = new Set<(event: { preventDefault?(): void }) => void>();
  readonly messageErrorListeners = new Set<(event: { preventDefault?(): void }) => void>();
  terminateCalls = 0;

  postMessage(message: StudioBg3dPhysicsTimelineWorkerRunMessage): void {
    this.messages.push(message);
  }

  addEventListener(
    type: "message" | "error" | "messageerror",
    listener:
      | ((event: { readonly data: unknown }) => void)
      | ((event: { preventDefault?(): void }) => void),
  ): void {
    if (type === "message") {
      this.messageListeners.add(listener as (event: { readonly data: unknown }) => void);
    } else if (type === "error") {
      this.errorListeners.add(listener as (event: { preventDefault?(): void }) => void);
    } else {
      this.messageErrorListeners.add(listener as (event: { preventDefault?(): void }) => void);
    }
  }

  removeEventListener(
    type: "message" | "error" | "messageerror",
    listener:
      | ((event: { readonly data: unknown }) => void)
      | ((event: { preventDefault?(): void }) => void),
  ): void {
    if (type === "message") {
      this.messageListeners.delete(listener as (event: { readonly data: unknown }) => void);
    } else if (type === "error") {
      this.errorListeners.delete(listener as (event: { preventDefault?(): void }) => void);
    } else {
      this.messageErrorListeners.delete(listener as (event: { preventDefault?(): void }) => void);
    }
  }

  terminate(): void {
    this.terminateCalls += 1;
  }

  emitMessage(data: unknown): void {
    for (const listener of this.messageListeners) listener({ data });
  }

  emitError(kind: "error" | "messageerror" = "error"): void {
    const event = { preventDefault: vi.fn() };
    const listeners = kind === "error" ? this.errorListeners : this.messageErrorListeners;
    for (const listener of listeners) listener(event);
  }
}

function input() {
  return {
    world: {
      bodies: [{
        nodeId: "ball",
        motion: "dynamic" as const,
        collider: { kind: "sphere" as const, radius: 0.5 },
        mass: 1,
        friction: 0.6,
        restitution: 0.1,
        linearDamping: 0.05,
        angularDamping: 0.05,
      }],
      solverSubsteps: 2,
      allowSleep: true,
    },
    initialPoses: [{
      nodeId: "ball",
      position: [0, 2, 0] as const,
      rotation: [0, 0, 0, 1] as const,
    }],
    durationSeconds: 1,
    ground: { y: 0, friction: 0.8, restitution: 0.1 },
  };
}

function timelineBuffer(frameCount: number, bodyCount: number): ArrayBuffer {
  const transforms = new Float32Array(frameCount * bodyCount * 7);
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let bodyIndex = 0; bodyIndex < bodyCount; bodyIndex += 1) {
      const offset = (frame * bodyCount + bodyIndex) * 7;
      transforms[offset + 1] = 2;
      transforms[offset + 6] = 1;
    }
  }
  return transforms.buffer;
}

function successFor(
  request: StudioBg3dPhysicsTimelineWorkerRunMessage,
  overrides: Record<string, unknown> = {},
) {
  return {
    version: STUDIO_BG3D_PHYSICS_TIMELINE_PROTOCOL_VERSION,
    kind: "result",
    requestId: request.requestId,
    nodeIds: request.input.dynamicNodeIds,
    frameCount: request.input.frameCount,
    durationSeconds: request.input.durationSeconds,
    stepSeconds: STUDIO_BG3D_PHYSICS_TIMELINE_STEP_SECONDS,
    transformsBuffer: timelineBuffer(
      request.input.frameCount,
      request.input.dynamicNodeIds.length,
    ),
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("studio BG3D physics timeline Worker client", () => {
  it("creates the Worker lazily, ignores stale IDs, and terminates after a frozen result", async () => {
    const worker = new FakeWorker();
    const workerFactory = vi.fn(() => worker);
    const pending = runStudioBg3dPhysicsTimeline(input(), { workerFactory });
    const request = worker.messages[0];

    expect(workerFactory).toHaveBeenCalledOnce();
    expect(request).toMatchObject({
      version: STUDIO_BG3D_PHYSICS_TIMELINE_PROTOCOL_VERSION,
      kind: "run",
      input: {
        frameCount: 61,
        durationSeconds: 1,
        dynamicNodeIds: ["ball"],
      },
    });
    expect(Object.isFrozen(request.input)).toBe(true);

    worker.emitMessage(successFor(request, { requestId: request.requestId + 1 }));
    expect(worker.terminateCalls).toBe(0);
    worker.emitMessage(successFor(request));

    const result = await pending;
    expect(result).toMatchObject({
      nodeIds: ["ball"],
      frameCount: 61,
      durationSeconds: 1,
    });
    expect(result.transforms).toBeInstanceOf(Float32Array);
    expect(Object.isFrozen(result)).toBe(true);
    expect(worker.terminateCalls).toBe(1);
    expect(worker.messageListeners.size).toBe(0);
  });

  it("rejects invalid input and a pre-aborted signal without creating a Worker", async () => {
    const workerFactory = vi.fn(() => new FakeWorker());
    await expect(runStudioBg3dPhysicsTimeline(
      { ...input(), durationSeconds: 99 },
      { workerFactory },
    )).rejects.toMatchObject({ code: "invalid-request" });
    expect(workerFactory).not.toHaveBeenCalled();

    const controller = new AbortController();
    controller.abort();
    await expect(runStudioBg3dPhysicsTimeline(input(), {
      signal: controller.signal,
      workerFactory,
    })).rejects.toMatchObject({ code: "aborted", name: "AbortError" });
    expect(workerFactory).not.toHaveBeenCalled();
  });

  it("terminates on abort and ignores any response emitted afterward", async () => {
    const worker = new FakeWorker();
    const controller = new AbortController();
    const pending = runStudioBg3dPhysicsTimeline(input(), {
      signal: controller.signal,
      workerFactory: () => worker,
    });
    const request = worker.messages[0];
    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: "aborted" });
    expect(worker.terminateCalls).toBe(1);
    worker.emitMessage(successFor(request));
    expect(worker.terminateCalls).toBe(1);
  });

  it("fails closed on a correlated malformed payload or transfer length", async () => {
    const malformedWorker = new FakeWorker();
    const malformed = runStudioBg3dPhysicsTimeline(input(), {
      workerFactory: () => malformedWorker,
    });
    malformedWorker.emitMessage({ requestId: malformedWorker.messages[0].requestId });
    await expect(malformed).rejects.toMatchObject({ code: "protocol" });
    expect(malformedWorker.terminateCalls).toBe(1);

    const shortWorker = new FakeWorker();
    const short = runStudioBg3dPhysicsTimeline(input(), {
      workerFactory: () => shortWorker,
    });
    const request = shortWorker.messages[0];
    shortWorker.emitMessage(successFor(request, { transformsBuffer: new ArrayBuffer(4) }));
    await expect(short).rejects.toMatchObject({ code: "protocol" });
    expect(shortWorker.terminateCalls).toBe(1);
  });

  it("maps sanitized simulation failure and Worker error events", async () => {
    const simulationWorker = new FakeWorker();
    const simulation = runStudioBg3dPhysicsTimeline(input(), {
      workerFactory: () => simulationWorker,
    });
    simulationWorker.emitMessage({
      version: STUDIO_BG3D_PHYSICS_TIMELINE_PROTOCOL_VERSION,
      kind: "failure",
      requestId: simulationWorker.messages[0].requestId,
      code: "simulation-failed",
    });
    await expect(simulation).rejects.toMatchObject({ code: "simulation-failed" });

    const failedWorker = new FakeWorker();
    const failed = runStudioBg3dPhysicsTimeline(input(), {
      workerFactory: () => failedWorker,
    });
    failedWorker.emitError("messageerror");
    await expect(failed).rejects.toMatchObject({ code: "worker-failed" });
    expect(failedWorker.terminateCalls).toBe(1);
  });

  it("times out and terminates a hanging Worker", async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const pending = runStudioBg3dPhysicsTimeline(input(), {
      workerFactory: () => worker,
      timeoutMs: 100,
    });
    const outcome = pending.catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(100);
    expect(await outcome).toMatchObject({ code: "timeout" });
    expect(worker.terminateCalls).toBe(1);
  });

  it("reports Worker construction and postMessage failures without leaking a live Worker", async () => {
    await expect(runStudioBg3dPhysicsTimeline(input(), {
      workerFactory: () => {
        throw new Error("blocked by CSP");
      },
    })).rejects.toMatchObject({ code: "worker-failed" });

    const worker = new FakeWorker();
    worker.postMessage = () => {
      throw new Error("structured clone failed");
    };
    await expect(runStudioBg3dPhysicsTimeline(input(), {
      workerFactory: () => worker,
    })).rejects.toMatchObject({ code: "worker-failed" });
    expect(worker.terminateCalls).toBe(1);
  });
});

describe("studio BG3D persistent physics timeline Worker session", () => {
  it("serializes requests and reuses one Worker after successful jobs", async () => {
    const worker = new FakeWorker();
    const workerFactory = vi.fn(() => worker);
    const session = createStudioBg3dPhysicsTimelineWorkerSession({ workerFactory });

    const first = session.run(input());
    const second = session.run(input());
    expect(workerFactory).toHaveBeenCalledOnce();
    expect(worker.messages).toHaveLength(1);

    const firstRequest = worker.messages[0];
    worker.emitMessage(successFor(firstRequest));
    await expect(first).resolves.toMatchObject({ nodeIds: ["ball"], frameCount: 61 });
    expect(worker.messages).toHaveLength(2);
    expect(worker.messages[1].requestId).not.toBe(firstRequest.requestId);
    expect(workerFactory).toHaveBeenCalledOnce();
    expect(worker.terminateCalls).toBe(0);

    worker.emitMessage(successFor(worker.messages[1]));
    await expect(second).resolves.toMatchObject({ nodeIds: ["ball"], frameCount: 61 });
    expect(worker.terminateCalls).toBe(0);

    session.dispose();
    expect(session.disposed).toBe(true);
    expect(worker.terminateCalls).toBe(1);
    expect(worker.messageListeners.size).toBe(0);
  });

  it("removes an aborted queued job without interrupting the active Worker", async () => {
    const worker = new FakeWorker();
    const session = createStudioBg3dPhysicsTimelineWorkerSession({
      workerFactory: () => worker,
    });
    const first = session.run(input());
    const queuedAbort = new AbortController();
    const second = session.run(input(), { signal: queuedAbort.signal });

    expect(worker.messages).toHaveLength(1);
    queuedAbort.abort();
    await expect(second).rejects.toMatchObject({ code: "aborted", name: "AbortError" });
    expect(worker.messages).toHaveLength(1);
    expect(worker.terminateCalls).toBe(0);

    worker.emitMessage(successFor(worker.messages[0]));
    await expect(first).resolves.toMatchObject({ nodeIds: ["ball"] });
    session.dispose();
    expect(worker.terminateCalls).toBe(1);
  });

  it("rotates the Worker after an active abort and ignores the retired Worker's response", async () => {
    const retiredWorker = new FakeWorker();
    const replacementWorker = new FakeWorker();
    const workers = [retiredWorker, replacementWorker];
    const workerFactory = vi.fn(() => workers.shift() ?? null);
    const session = createStudioBg3dPhysicsTimelineWorkerSession({ workerFactory });
    const activeAbort = new AbortController();
    const first = session.run(input(), { signal: activeAbort.signal });
    const second = session.run(input());
    const retiredRequest = retiredWorker.messages[0];

    activeAbort.abort();
    await expect(first).rejects.toMatchObject({ code: "aborted" });
    expect(retiredWorker.terminateCalls).toBe(1);
    expect(retiredWorker.messageListeners.size).toBe(0);
    expect(replacementWorker.messages).toHaveLength(1);
    expect(workerFactory).toHaveBeenCalledTimes(2);

    retiredWorker.emitMessage(successFor(retiredRequest));
    expect(replacementWorker.terminateCalls).toBe(0);
    replacementWorker.emitMessage(successFor(replacementWorker.messages[0]));
    await expect(second).resolves.toMatchObject({ nodeIds: ["ball"] });

    session.dispose();
    expect(replacementWorker.terminateCalls).toBe(1);
  });

  it("rotates a timed-out Worker before starting the next queued request", async () => {
    vi.useFakeTimers();
    const timedOutWorker = new FakeWorker();
    const replacementWorker = new FakeWorker();
    const workers = [timedOutWorker, replacementWorker];
    const session = createStudioBg3dPhysicsTimelineWorkerSession({
      workerFactory: () => workers.shift() ?? null,
    });
    const first = session.run(input(), { timeoutMs: 100 });
    const firstOutcome = first.catch((error: unknown) => error);
    const second = session.run(input());

    await vi.advanceTimersByTimeAsync(100);
    expect(await firstOutcome).toMatchObject({ code: "timeout" });
    expect(timedOutWorker.terminateCalls).toBe(1);
    expect(replacementWorker.messages).toHaveLength(1);

    replacementWorker.emitMessage(successFor(replacementWorker.messages[0]));
    await expect(second).resolves.toMatchObject({ nodeIds: ["ball"] });
    session.dispose();
  });

  it("fails closed and rotates before continuing after a correlated protocol violation", async () => {
    const malformedWorker = new FakeWorker();
    const replacementWorker = new FakeWorker();
    const workers = [malformedWorker, replacementWorker];
    const session = createStudioBg3dPhysicsTimelineWorkerSession({
      workerFactory: () => workers.shift() ?? null,
    });
    const first = session.run(input());
    const second = session.run(input());

    malformedWorker.emitMessage({ requestId: malformedWorker.messages[0].requestId });
    await expect(first).rejects.toMatchObject({ code: "protocol" });
    expect(malformedWorker.terminateCalls).toBe(1);
    expect(replacementWorker.messages).toHaveLength(1);

    replacementWorker.emitMessage(successFor(replacementWorker.messages[0]));
    await expect(second).resolves.toMatchObject({ nodeIds: ["ball"] });
    session.dispose();
  });

  it("dispose rejects active and queued jobs, terminates once, and stays fail-closed", async () => {
    const worker = new FakeWorker();
    const workerFactory = vi.fn(() => worker);
    const session = createStudioBg3dPhysicsTimelineWorkerSession({ workerFactory });
    const firstOutcome = session.run(input()).catch((error: unknown) => error);
    const secondOutcome = session.run(input()).catch((error: unknown) => error);

    session.dispose();

    expect(await firstOutcome).toMatchObject({ code: "aborted", name: "AbortError" });
    expect(await secondOutcome).toMatchObject({ code: "aborted", name: "AbortError" });
    expect(worker.terminateCalls).toBe(1);
    expect(worker.messageListeners.size).toBe(0);
    await expect(session.run(input())).rejects.toMatchObject({ code: "aborted" });
    expect(workerFactory).toHaveBeenCalledOnce();

    session.dispose();
    expect(worker.terminateCalls).toBe(1);
  });

  it("keeps the reusable session behind the physics bundle boundary and modal lifecycle", () => {
    const dynamicImportIndex = background3dEditorSource.indexOf(
      'await import("./studio-bg3d-physics-worker-client")',
    );
    const staleGuardIndex = background3dEditorSource.indexOf(
      "abortController.signal.aborted || generation !== physicsGenerationRef.current",
      dynamicImportIndex,
    );
    const sessionFactoryIndex = background3dEditorSource.indexOf(
      "const workerSession = physicsWorkerSessionRef.current ??",
      dynamicImportIndex,
    );

    expect(dynamicImportIndex).toBeGreaterThanOrEqual(0);
    expect(staleGuardIndex).toBeGreaterThan(dynamicImportIndex);
    expect(sessionFactoryIndex).toBeGreaterThan(staleGuardIndex);
    expect(background3dEditorSource).toContain(
      "physicsWorkerSessionRef.current = workerSession;",
    );
    expect(background3dEditorSource).toContain(
      "physicsWorkerSessionRef.current?.dispose();",
    );
    expect(background3dEditorSource).toContain(
      "physicsWorkerSessionRef.current = null;",
    );
  });
});
