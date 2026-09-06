import { afterEach, describe, expect, it } from "vitest";

import {
  createStudioPaperVectorRefinementWorkerClient,
  disposeStudioPaperVectorRefinementWorkerClient,
  getStudioPaperVectorRefinementWorkerClient,
  type StudioPaperVectorRefinementWorkerLike,
} from "./studio-paper-vector-refinement-worker-client";
import {
  STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_CAPABILITIES,
  STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_HARD_LIMITS,
  STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_PROTOCOL_VERSION,
  STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_RUNTIME_EPOCH,
  encodeStudioPaperVectorRefinementWorkerArtifact,
  type StudioPaperVectorRefinementWorkerExecuteMessage,
  type StudioPaperVectorRefinementWorkerInboundMessage,
} from "./studio-paper-vector-refinement-worker-protocol";

import type {
  StudioPaperVectorRefinementArtifact,
  StudioPaperVectorRefinementCapability,
  StudioPaperVectorRefinementRequest,
} from "./studio-paper-vector-refinement-provider";

interface MessageEventLike {
  readonly data: unknown;
}

interface ErrorEventLike {
  readonly error?: unknown;
  readonly message?: string;
  preventDefault?(): void;
}

const PATH = "M 0 0 L 10 10";
const HASH = `sha256:${"b".repeat(64)}` as const;

function request(
  requestSequence: number,
  engineEpoch = 4,
): StudioPaperVectorRefinementRequest {
  return {
    kind: "studio-paper-vector-refinement/request",
    version: 1,
    requestSequence,
    engineEpoch,
    stage: "settled",
    command: {
      kind: "simplify",
      pathData: PATH,
      tolerance: 1,
    },
  };
}

function artifact(
  message: StudioPaperVectorRefinementWorkerExecuteMessage,
): StudioPaperVectorRefinementArtifact {
  const command = message.command.kind === "boolean"
    ? message.command.operator
    : message.command.kind;
  const commandCapability = (
    message.command.kind === "boolean"
      ? `boolean:${message.command.operator}`
      : `refine:${message.command.kind}`
  ) as StudioPaperVectorRefinementCapability;
  const capabilitiesUsed = Object.freeze([
    commandCapability,
    "execution:settled-only",
    "project:ephemeral-isolated",
    "output:serializable-svg-path-data",
    "output:frozen-flattened-contours",
    "authority:none",
  ] satisfies readonly StudioPaperVectorRefinementCapability[]);
  return {
    kind: "studio-paper-vector-refinement/artifact",
    version: 1,
    pathData: PATH,
    contours: [
      Object.freeze({
        points: Object.freeze([0, 0, 10, 10]),
        closed: false,
      }),
    ],
    bounds: Object.freeze({
      minX: 0,
      minY: 0,
      maxX: 10,
      maxY: 10,
      width: 10,
      height: 10,
    }),
    empty: false,
    curveCount: 1,
    subpathCount: 1,
    receipt: Object.freeze({
      kind: "studio-paper-vector-refinement/receipt",
      version: 1,
      requestSequence: message.requestSequence,
      engineEpoch: message.engineEpoch,
      command,
      inputFingerprint: HASH,
      outputFingerprint: HASH,
      replayFingerprint: HASH,
      package: Object.freeze({ name: "paper", version: "0.12.18" }),
      execution: Object.freeze({
        stage: "settled",
        geometryBoundary: "studio-engine-vector-geometry-provider",
        project: "ephemeral-isolated",
        dynamicImport: true,
      }),
      budget: Object.freeze({
        inputPathDataCodeUnits: PATH.length,
        outputPathDataCodeUnits: PATH.length,
        outputCurveCount: 1,
        outputSubpathCount: 1,
        outputFlattenedPointCount: 2,
        delegatedPathNumberCurveAndWorkBudgets: true,
      }),
      authority: Object.freeze({
        mainScene: false,
        document: false,
        history: false,
        persistence: false,
        output: "settled-vector-refinement-suggestion",
      }),
      capabilitiesUsed,
      complete: true,
    }),
  };
}

class MemoryWorker implements StudioPaperVectorRefinementWorkerLike {
  readonly inbound: StudioPaperVectorRefinementWorkerInboundMessage[] = [];
  readonly transfers: Transferable[][] = [];
  terminated = false;
  preventedErrorCount = 0;
  autoReady = true;
  autoConfigure = true;
  autoRespond = true;

  readonly #messageListeners =
    new Set<(event: MessageEventLike) => void>();
  readonly #errorListeners =
    new Set<(event: ErrorEventLike) => void>();
  readonly #messageErrorListeners =
    new Set<(event: ErrorEventLike) => void>();

  public addEventListener(
    type: "message",
    listener: (event: MessageEventLike) => void,
  ): void;
  public addEventListener(
    type: "error" | "messageerror",
    listener: (event: ErrorEventLike) => void,
  ): void;
  public addEventListener(
    type: "message" | "error" | "messageerror",
    listener:
      | ((event: MessageEventLike) => void)
      | ((event: ErrorEventLike) => void),
  ): void {
    if (type === "message") {
      this.#messageListeners.add(
        listener as (event: MessageEventLike) => void,
      );
      if (this.autoReady && this.#messageListeners.size === 1) {
        queueMicrotask(() => {
          if (!this.terminated) this.emitReady();
        });
      }
      return;
    }
    (type === "error"
      ? this.#errorListeners
      : this.#messageErrorListeners
    ).add(listener as (event: ErrorEventLike) => void);
  }

  public removeEventListener(
    type: "message",
    listener: (event: MessageEventLike) => void,
  ): void;
  public removeEventListener(
    type: "error" | "messageerror",
    listener: (event: ErrorEventLike) => void,
  ): void;
  public removeEventListener(
    type: "message" | "error" | "messageerror",
    listener:
      | ((event: MessageEventLike) => void)
      | ((event: ErrorEventLike) => void),
  ): void {
    if (type === "message") {
      this.#messageListeners.delete(
        listener as (event: MessageEventLike) => void,
      );
      return;
    }
    (type === "error"
      ? this.#errorListeners
      : this.#messageErrorListeners
    ).delete(listener as (event: ErrorEventLike) => void);
  }

  public postMessage(
    message: StudioPaperVectorRefinementWorkerInboundMessage,
    transfer: Transferable[] = [],
  ): void {
    this.inbound.push(message);
    this.transfers.push(transfer);
    if (
      message.type === "studio-paper-vector-refinement/configure"
      && this.autoConfigure
    ) {
      queueMicrotask(() => {
        if (this.terminated) return;
        this.emit({
          type: "studio-paper-vector-refinement/configured",
          version: STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_PROTOCOL_VERSION,
          generation: message.generation,
          engineEpoch: message.engineEpoch,
        });
      });
      return;
    }
    if (
      message.type !== "studio-paper-vector-refinement/execute"
      || !this.autoRespond
    ) {
      return;
    }
    const encoded =
      encodeStudioPaperVectorRefinementWorkerArtifact(artifact(message));
    if (encoded === null) throw new Error("Invalid test artifact.");
    queueMicrotask(() => {
      if (this.terminated) return;
      this.emit({
        type: "studio-paper-vector-refinement/result",
        version: STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_PROTOCOL_VERSION,
        generation: message.generation,
        requestId: message.requestId,
        requestSequence: message.requestSequence,
        engineEpoch: message.engineEpoch,
        artifact: encoded,
      });
    });
  }

  public emit(data: unknown): void {
    for (const listener of this.#messageListeners) listener({ data });
  }

  public emitReady(): void {
    this.emit({
      type: "studio-paper-vector-refinement/ready",
      version: STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_PROTOCOL_VERSION,
      runtimeEpoch: STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_RUNTIME_EPOCH,
      executionLocality: "dedicated-worker",
      mainThreadFallback: false,
      capabilities: STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_CAPABILITIES,
      hardLimits: STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_HARD_LIMITS,
    });
  }

  public fail(type: "error" | "messageerror"): void {
    const listeners = type === "error"
      ? this.#errorListeners
      : this.#messageErrorListeners;
    for (const listener of listeners) {
      listener({
        message: "worker failed",
        preventDefault: () => {
          this.preventedErrorCount += 1;
        },
      });
    }
  }

  public terminate(): void {
    this.terminated = true;
  }
}

const clients: Array<ReturnType<
  typeof createStudioPaperVectorRefinementWorkerClient
>> = [];

afterEach(() => {
  for (const client of clients.splice(0)) client.dispose();
  disposeStudioPaperVectorRefinementWorkerClient();
});

describe("StudioPaperVectorRefinementWorkerClient", () => {
  it("configures once, reuses the Worker and transfers owned request buffers", async () => {
    const worker = new MemoryWorker();
    const client = createStudioPaperVectorRefinementWorkerClient({
      engineEpoch: 4,
      workerFactory: () => worker,
    });
    clients.push(client);

    const first = await client.refine(request(1));
    const second = await client.refine(request(2));

    expect(first).toMatchObject({
      status: "completed",
      artifact: {
        pathData: PATH,
        contours: [{ points: [0, 0, 10, 10], closed: false }],
      },
    });
    expect(second.status).toBe("completed");
    expect(
      worker.inbound.filter(
        (message) =>
          message.type === "studio-paper-vector-refinement/configure",
      ),
    ).toHaveLength(1);
    const executions = worker.inbound.filter(
      (message): message is StudioPaperVectorRefinementWorkerExecuteMessage =>
        message.type === "studio-paper-vector-refinement/execute",
    );
    expect(executions).toHaveLength(2);
    expect(worker.transfers[1]).toEqual([
      executions[0]?.command.kind === "boolean"
        ? executions[0].command.leftPathDataUtf8.buffer
        : executions[0]?.command.pathDataUtf8.buffer,
    ]);
    expect(worker.terminated).toBe(false);
    expect(client.snapshot()).toMatchObject({
      phase: "ready",
      generation: 1,
      engineEpoch: 4,
      mainThreadFallback: false,
    });
  });

  it("enforces one fail-fast process-wide operation lease", async () => {
    const firstWorker = new MemoryWorker();
    firstWorker.autoRespond = false;
    const secondWorker = new MemoryWorker();
    const firstClient = createStudioPaperVectorRefinementWorkerClient({
      engineEpoch: 4,
      workerFactory: () => firstWorker,
    });
    const secondClient = createStudioPaperVectorRefinementWorkerClient({
      engineEpoch: 4,
      workerFactory: () => secondWorker,
    });
    clients.push(firstClient, secondClient);
    const controller = new AbortController();

    const pending = firstClient.refine(
      { ...request(1), signal: controller.signal },
      { signal: controller.signal },
    );
    const rejected = await secondClient.refine(request(2));

    expect(rejected).toMatchObject({
      status: "rejected",
      reason: "backpressure",
    });
    expect(secondWorker.inbound).toHaveLength(0);
    controller.abort();
    await expect(pending).resolves.toMatchObject({
      status: "rejected",
      reason: "aborted",
    });
    expect(firstWorker.terminated).toBe(true);
  });

  it("terminates on an operation abort and starts a fresh generation", async () => {
    const firstWorker = new MemoryWorker();
    firstWorker.autoRespond = false;
    const secondWorker = new MemoryWorker();
    const workers = [firstWorker, secondWorker];
    const client = createStudioPaperVectorRefinementWorkerClient({
      engineEpoch: 4,
      workerFactory: () => workers.shift() ?? null,
    });
    clients.push(client);
    const controller = new AbortController();

    const pending = client.refine(
      { ...request(1), signal: controller.signal },
      { signal: controller.signal },
    );
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    controller.abort();
    await expect(pending).resolves.toMatchObject({
      status: "rejected",
      reason: "aborted",
    });
    expect(firstWorker.terminated).toBe(true);

    await expect(client.refine(request(2))).resolves.toMatchObject({
      status: "completed",
    });
    expect(client.snapshot()).toMatchObject({
      engineEpoch: 4,
      generation: 2,
      phase: "ready",
    });
  });

  it("terminates on timeout and Worker errors without advancing document epoch", async () => {
    const timeoutWorker = new MemoryWorker();
    timeoutWorker.autoRespond = false;
    const errorWorker = new MemoryWorker();
    errorWorker.autoRespond = false;
    const workers = [timeoutWorker, errorWorker];
    const client = createStudioPaperVectorRefinementWorkerClient({
      engineEpoch: 4,
      workerFactory: () => workers.shift() ?? null,
      operationTimeoutMilliseconds: 10,
    });
    clients.push(client);

    await expect(client.refine(request(1))).resolves.toMatchObject({
      status: "rejected",
      reason: "geometry-failed",
      detail: expect.stringContaining("timed out"),
    });
    expect(timeoutWorker.terminated).toBe(true);
    expect(client.snapshot()).toMatchObject({
      engineEpoch: 4,
      generation: 1,
      phase: "cold",
    });

    const pending = client.refine(request(2));
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    errorWorker.fail("error");
    await expect(pending).resolves.toMatchObject({
      status: "rejected",
      reason: "geometry-failed",
    });
    expect(errorWorker.preventedErrorCount).toBe(1);
    expect(errorWorker.terminated).toBe(true);
    expect(client.snapshot()).toMatchObject({
      engineEpoch: 4,
      generation: 2,
      phase: "cold",
    });
  });

  it("rejects unavailable and startup-stalled Workers without a main-thread fallback", async () => {
    const unavailable = createStudioPaperVectorRefinementWorkerClient({
      engineEpoch: 4,
      workerFactory: () => null,
    });
    clients.push(unavailable);
    await expect(unavailable.refine(request(1))).resolves.toMatchObject({
      status: "rejected",
      reason: "geometry-unavailable",
      detail: expect.stringContaining("Dedicated Worker API"),
    });
    expect(unavailable.snapshot()).toMatchObject({
      phase: "cold",
      generation: 1,
      mainThreadFallback: false,
    });

    const stalledWorker = new MemoryWorker();
    stalledWorker.autoReady = false;
    const stalled = createStudioPaperVectorRefinementWorkerClient({
      engineEpoch: 4,
      workerFactory: () => stalledWorker,
      startupTimeoutMilliseconds: 10,
    });
    clients.push(stalled);
    await expect(stalled.refine(request(2))).resolves.toMatchObject({
      status: "rejected",
      reason: "geometry-unavailable",
      detail: expect.stringContaining("startup timed out"),
    });
    expect(stalledWorker.terminated).toBe(true);
  });

  it("contains a startup Worker error without leaking its default page error action", async () => {
    const worker = new MemoryWorker();
    worker.autoReady = false;
    const client = createStudioPaperVectorRefinementWorkerClient({
      engineEpoch: 4,
      workerFactory: () => worker,
    });
    clients.push(client);

    const pending = client.refine(request(1));
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    worker.fail("error");

    await expect(pending).resolves.toMatchObject({
      status: "rejected",
      reason: "geometry-unavailable",
      detail: "worker failed",
    });
    expect(worker.preventedErrorCount).toBe(1);
    expect(worker.terminated).toBe(true);
    expect(client.snapshot()).toMatchObject({
      phase: "cold",
      active: false,
      globalLeaseOwned: false,
    });
  });

  it("preserves a bounded Worker construction failure for product diagnostics", async () => {
    const unavailable = createStudioPaperVectorRefinementWorkerClient({
      engineEpoch: 4,
      workerFactory: () => {
        throw new Error("module worker blocked by test policy");
      },
    });
    clients.push(unavailable);

    await expect(unavailable.refine(request(1))).resolves.toMatchObject({
      status: "rejected",
      reason: "geometry-unavailable",
      detail: "module worker blocked by test policy",
    });
  });

  it("advances epochs authoritatively and recreates a disposed singleton", async () => {
    const activeWorker = new MemoryWorker();
    activeWorker.autoRespond = false;
    const client = createStudioPaperVectorRefinementWorkerClient({
      engineEpoch: 4,
      workerFactory: () => activeWorker,
    });
    clients.push(client);
    const pending = client.refine(request(1));
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    expect(client.advanceEngineEpoch()).toBe(5);
    await expect(pending).resolves.toMatchObject({
      status: "rejected",
      reason: "epoch-mismatch",
    });
    expect(activeWorker.terminated).toBe(true);

    const singleton = getStudioPaperVectorRefinementWorkerClient({
      engineEpoch: 8,
      workerFactory: () => new MemoryWorker(),
    });
    singleton.dispose();
    const replacement = getStudioPaperVectorRefinementWorkerClient({
      engineEpoch: 8,
      workerFactory: () => new MemoryWorker(),
    });
    expect(replacement).not.toBe(singleton);
    expect(replacement.snapshot()).toMatchObject({
      phase: "cold",
      engineEpoch: 8,
    });
  });
});
