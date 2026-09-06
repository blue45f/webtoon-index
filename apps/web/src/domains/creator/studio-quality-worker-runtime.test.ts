import { describe, expect, it, vi } from "vitest";

import {
  STUDIO_QUALITY_WORKER_BUDGETS,
  STUDIO_QUALITY_WORKER_PROTOCOL_REVISION,
  type StudioQualityWorkerRequestMessage,
  type StudioQualityWorkerResponseMessage,
} from "./studio-quality-worker-protocol";
import {
  createStudioQualityWorkerRuntime,
} from "./studio-quality-worker-runtime";

import type {
  StudioPathOpsResult,
  StudioQualityEngine,
} from "./render/studio-canvaskit-adapter";

function fakeProvider(
  overrides: Partial<StudioQualityEngine> = {},
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
    pathOp(a, b, op) {
      return { ok: true, pathData: `${a}|${op}|${b}` };
    },
    strokeToPath(pathData, style) {
      return { ok: true, pathData: `${pathData}|stroke:${style.widthPx}` };
    },
    ...overrides,
  };
}

function initialize(epoch = 9) {
  return {
    type: "studio-quality/initialize" as const,
    protocolRevision: STUDIO_QUALITY_WORKER_PROTOCOL_REVISION,
    workerEpoch: epoch,
    clientBuild: "test",
  };
}

function request(
  requestId: number,
  epoch = 9,
): StudioQualityWorkerRequestMessage {
  return {
    type: "studio-quality/request",
    protocolRevision: STUDIO_QUALITY_WORKER_PROTOCOL_REVISION,
    workerEpoch: epoch,
    requestId,
    requestToken: `q:${epoch}:${requestId}:path-boolean`,
    operation: {
      kind: "path-boolean",
      a: `M${requestId} 0Z`,
      b: "M0 0Z",
      op: "union",
    },
  };
}

function mutablePortableGeometry() {
  return {
    kind: "studio-portable-path-geometry",
    version: 1,
    fillRule: "nonzero",
    flatnessPx: 0.25,
    bounds: {
      minX: 0,
      minY: 0,
      maxX: 10,
      maxY: 10,
      width: 10,
      height: 10,
    },
    contours: [
      {
        points: [0, 0, 10, 0, 0, 10],
        closed: true,
      },
    ],
    flattenedPointCount: 3,
    sourceCommandValueCount: 10,
  };
}

async function flushMicrotasks(rounds = 8): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await Promise.resolve();
  }
}

function harness(providerFactory: () => Promise<StudioQualityEngine> | StudioQualityEngine) {
  const messages: StudioQualityWorkerResponseMessage[] = [];
  const runtime = createStudioQualityWorkerRuntime({
    port: { postMessage: (message) => messages.push(message) },
    providerFactory,
  });
  return { messages, runtime };
}

describe("Studio quality Worker runtime", () => {
  it("constructs exactly one lazy provider per initialized Worker epoch", async () => {
    const providerFactory = vi.fn(() => fakeProvider());
    const { messages, runtime } = harness(providerFactory);

    expect(providerFactory).not.toHaveBeenCalled();
    expect(runtime.snapshot()).toMatchObject({
      state: "awaiting-initialize",
      providerFactoryCalls: 0,
    });
    runtime.handleMessage(initialize());
    await flushMicrotasks();

    expect(providerFactory).toHaveBeenCalledTimes(1);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      type: "studio-quality/ready",
      workerEpoch: 9,
      providerId: "canvaskit",
    });
    runtime.handleMessage(request(1));
    runtime.handleMessage(request(2));
    await flushMicrotasks();
    expect(providerFactory).toHaveBeenCalledTimes(1);
    expect(messages.filter((message) => message.type === "studio-quality/result")).toHaveLength(2);
  });

  it("executes both specialist operations and emits only cloned portable data", async () => {
    const embind = { delete: vi.fn() };
    const provider = fakeProvider({
      pathOp() {
        return {
          ok: true,
          pathData: "M0 0H10Z",
          embind,
        } as unknown as StudioPathOpsResult;
      },
    });
    const { messages, runtime } = harness(() => provider);
    runtime.handleMessage(initialize());
    await flushMicrotasks();
    runtime.handleMessage(request(1));
    runtime.handleMessage({
      type: "studio-quality/request",
      protocolRevision: STUDIO_QUALITY_WORKER_PROTOCOL_REVISION,
      workerEpoch: 9,
      requestId: 2,
      requestToken: "q:9:2:stroke-to-fill",
      operation: {
        kind: "stroke-to-fill",
        pathData: "M0 0L20 0",
        style: {
          widthPx: 7,
          cap: "round",
          join: "round",
          miterLimit: 4,
        },
      },
    });
    await flushMicrotasks();

    const results = messages.filter(
      (message) => message.type === "studio-quality/result",
    );
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      type: "studio-quality/result",
      protocolRevision: STUDIO_QUALITY_WORKER_PROTOCOL_REVISION,
      workerEpoch: 9,
      requestId: 1,
      requestToken: "q:9:1:path-boolean",
      operationKind: "path-boolean",
      providerId: "canvaskit",
      result: { ok: true, pathData: "M0 0H10Z" },
    });
    expect(results[0]).not.toHaveProperty("embind");
    expect(results[0]).not.toHaveProperty("result.embind");
    expect(results[1]).toMatchObject({
      operationKind: "stroke-to-fill",
      result: { ok: true, pathData: "M0 0L20 0|stroke:7" },
    });
  });

  it("projects and deep-snapshots portable geometry before posting", async () => {
    const sourceGeometry = mutablePortableGeometry();
    const providerResult = {
      ok: true,
      pathData: "M0 0H10L0 10Z",
      geometry: sourceGeometry,
      vendorPathHandle: { delete: vi.fn() },
    };
    const { messages, runtime } = harness(() =>
      fakeProvider({
        pathOp() {
          return providerResult as unknown as StudioPathOpsResult;
        },
      }),
    );

    runtime.handleMessage(initialize());
    await flushMicrotasks();
    runtime.handleMessage(request(1));
    await flushMicrotasks();

    const message = messages.find(
      (candidate) => candidate.type === "studio-quality/result",
    );
    expect(message).toBeDefined();
    if (message?.type !== "studio-quality/result") {
      throw new Error("Expected a quality Worker result.");
    }
    expect(message.result).not.toHaveProperty("vendorPathHandle");
    expect(message.result).toEqual({
      ok: true,
      pathData: "M0 0H10L0 10Z",
      geometry: mutablePortableGeometry(),
    });
    if (!message.result.ok || !message.result.geometry) {
      throw new Error("Expected a portable geometry snapshot.");
    }
    expect(Object.isFrozen(message.result.geometry)).toBe(true);
    expect(Object.isFrozen(message.result.geometry.bounds)).toBe(true);
    expect(Object.isFrozen(message.result.geometry.contours)).toBe(true);
    expect(Object.isFrozen(message.result.geometry.contours[0])).toBe(true);
    expect(Object.isFrozen(message.result.geometry.contours[0]?.points)).toBe(true);

    providerResult.pathData = "M999 999Z";
    sourceGeometry.bounds.maxX = 999;
    sourceGeometry.contours[0]!.points[0] = 999;
    sourceGeometry.contours.push({
      points: [50, 50, 60, 50, 50, 60],
      closed: true,
    });

    expect(message.result.pathData).toBe("M0 0H10L0 10Z");
    expect(message.result.geometry.bounds.maxX).toBe(10);
    expect(message.result.geometry.contours).toHaveLength(1);
    expect(message.result.geometry.contours[0]?.points[0]).toBe(0);
  });

  it("snapshots mutable request style before asynchronous execution", async () => {
    const observedWidths: number[] = [];
    const { runtime } = harness(() =>
      fakeProvider({
        strokeToPath(_pathData, style) {
          observedWidths.push(style.widthPx);
          return { ok: true, pathData: "M0 0Z" };
        },
      }),
    );
    runtime.handleMessage(initialize());
    await flushMicrotasks();
    const message = {
      type: "studio-quality/request" as const,
      protocolRevision: STUDIO_QUALITY_WORKER_PROTOCOL_REVISION,
      workerEpoch: 9,
      requestId: 1,
      requestToken: "q:9:1:stroke-to-fill",
      operation: {
        kind: "stroke-to-fill" as const,
        pathData: "M0 0L1 1",
        style: {
          widthPx: 4,
          cap: "round" as const,
          join: "round" as const,
          miterLimit: 4,
          dash: { pattern: [2, 1], phase: 0 },
        },
      },
    };
    runtime.handleMessage(message);
    message.operation.style.widthPx = 99;
    message.operation.style.dash.pattern[0] = 99;
    await flushMicrotasks();
    expect(observedWidths).toEqual([4]);
  });

  it("reports explicit provider initialization and capability failures", async () => {
    const initFailure = harness(() => {
      throw new Error("WASM unavailable");
    });
    initFailure.runtime.handleMessage(initialize());
    await flushMicrotasks();
    expect(initFailure.messages).toContainEqual(
      expect.objectContaining({
        type: "studio-quality/fatal",
        stage: "initialization",
        error: expect.objectContaining({ code: "provider-init-failed" }),
      }),
    );

    const capabilityFailure = harness(() =>
      fakeProvider({
        capabilities: {
          textShaping: false,
          pathBoolean: false,
          strokeToPath: true,
          fontSubsetting: false,
        },
      }),
    );
    capabilityFailure.runtime.handleMessage(initialize(10));
    await flushMicrotasks();
    expect(capabilityFailure.messages).toContainEqual(
      expect.objectContaining({
        type: "studio-quality/fatal",
        stage: "initialization",
        error: expect.objectContaining({ code: "provider-capability-missing" }),
      }),
    );
  });

  it("rejects request work until initialization completes", async () => {
    let resolveProvider!: (provider: StudioQualityEngine) => void;
    const providerPromise = new Promise<StudioQualityEngine>((resolve) => {
      resolveProvider = resolve;
    });
    const { messages, runtime } = harness(() => providerPromise);
    runtime.handleMessage(initialize());
    runtime.handleMessage(request(1));
    expect(messages).toContainEqual(
      expect.objectContaining({
        type: "studio-quality/failure",
        requestId: 1,
        error: expect.objectContaining({ code: "not-ready" }),
      }),
    );
    resolveProvider(fakeProvider());
    await flushMicrotasks();
    runtime.handleMessage(request(1));
    await flushMicrotasks();
    expect(messages).toContainEqual(
      expect.objectContaining({
        type: "studio-quality/result",
        requestId: 1,
      }),
    );
  });

  it("terminates fail-closed on malformed, future, duplicate-init, and wrong-epoch messages", async () => {
    const malformed = harness(() => fakeProvider());
    malformed.runtime.handleMessage({ type: "unexpected" });
    expect(malformed.runtime.snapshot().state).toBe("fatal");
    expect(malformed.messages[0]).toMatchObject({
      type: "studio-quality/fatal",
      error: { code: "invalid-message" },
    });

    const future = harness(() => fakeProvider());
    future.runtime.handleMessage({
      ...initialize(),
      protocolRevision: STUDIO_QUALITY_WORKER_PROTOCOL_REVISION + 1,
    });
    expect(future.messages[0]).toMatchObject({
      type: "studio-quality/fatal",
      error: { code: "unsupported-protocol" },
    });

    const duplicate = harness(() => fakeProvider());
    duplicate.runtime.handleMessage(initialize());
    await flushMicrotasks();
    duplicate.runtime.handleMessage(initialize());
    expect(duplicate.messages.at(-1)).toMatchObject({
      type: "studio-quality/fatal",
      error: { code: "invalid-message" },
    });

    const epoch = harness(() => fakeProvider());
    epoch.runtime.handleMessage(initialize());
    await flushMicrotasks();
    epoch.runtime.handleMessage(request(1, 10));
    expect(epoch.messages.at(-1)).toMatchObject({
      type: "studio-quality/fatal",
      error: { code: "epoch-mismatch" },
    });
  });

  it("requires strictly increasing request IDs and rejects duplicate/stale work", async () => {
    const pathOp = vi.fn(() => ({ ok: true, pathData: "M0 0Z" } as const));
    const { messages, runtime } = harness(() => fakeProvider({ pathOp }));
    runtime.handleMessage(initialize());
    await flushMicrotasks();
    runtime.handleMessage(request(5));
    runtime.handleMessage(request(5));
    runtime.handleMessage(request(4));
    await flushMicrotasks();

    expect(pathOp).toHaveBeenCalledTimes(1);
    expect(
      messages.filter(
        (message) =>
          message.type === "studio-quality/failure"
          && message.error.code === "stale-or-duplicate",
      ),
    ).toHaveLength(2);
  });

  it("enforces the bounded queue before provider execution begins", async () => {
    const pathOp = vi.fn(() => ({ ok: true, pathData: "M0 0Z" } as const));
    const { messages, runtime } = harness(() => fakeProvider({ pathOp }));
    runtime.handleMessage(initialize());
    await flushMicrotasks();
    for (
      let requestId = 1;
      requestId <= STUDIO_QUALITY_WORKER_BUDGETS.maxQueuedRequests + 1;
      requestId += 1
    ) {
      runtime.handleMessage(request(requestId));
    }
    expect(messages.at(-1)).toMatchObject({
      type: "studio-quality/failure",
      error: { code: "queue-full" },
    });
    await flushMicrotasks();
    expect(pathOp).toHaveBeenCalledTimes(
      STUDIO_QUALITY_WORKER_BUDGETS.maxQueuedRequests,
    );
  });

  it("cancels queued work without invoking the provider and rejects mismatched cancellation", async () => {
    const pathOp = vi.fn(() => ({ ok: true, pathData: "M0 0Z" } as const));
    const { messages, runtime } = harness(() => fakeProvider({ pathOp }));
    runtime.handleMessage(initialize());
    await flushMicrotasks();
    runtime.handleMessage(request(1));
    runtime.handleMessage({
      type: "studio-quality/cancel",
      protocolRevision: STUDIO_QUALITY_WORKER_PROTOCOL_REVISION,
      workerEpoch: 9,
      requestId: 1,
      requestToken: "wrong",
      operationKind: "path-boolean",
    });
    expect(messages.at(-1)).toMatchObject({
      type: "studio-quality/failure",
      error: { code: "operation-mismatch" },
    });
    runtime.handleMessage({
      type: "studio-quality/cancel",
      protocolRevision: STUDIO_QUALITY_WORKER_PROTOCOL_REVISION,
      workerEpoch: 9,
      requestId: 1,
      requestToken: "q:9:1:path-boolean",
      operationKind: "path-boolean",
    });
    await flushMicrotasks();
    expect(pathOp).not.toHaveBeenCalled();
    expect(messages).toContainEqual(
      expect.objectContaining({
        type: "studio-quality/cancelled",
        requestId: 1,
      }),
    );
    runtime.handleMessage({
      type: "studio-quality/cancel",
      protocolRevision: STUDIO_QUALITY_WORKER_PROTOCOL_REVISION,
      workerEpoch: 9,
      requestId: 1,
      requestToken: "q:9:1:path-boolean",
      operationKind: "path-boolean",
    });
    expect(messages.at(-1)).toMatchObject({
      type: "studio-quality/failure",
      error: { code: "already-settled" },
    });
  });

  it("cancels all admitted work and returns a terminal dispose receipt", async () => {
    const pathOp = vi.fn(() => ({ ok: true, pathData: "M0 0Z" } as const));
    const { messages, runtime } = harness(() => fakeProvider({ pathOp }));
    runtime.handleMessage(initialize());
    await flushMicrotasks();
    runtime.handleMessage(request(1));
    runtime.handleMessage(request(2));
    runtime.handleMessage({
      type: "studio-quality/dispose",
      protocolRevision: STUDIO_QUALITY_WORKER_PROTOCOL_REVISION,
      workerEpoch: 9,
    });
    await flushMicrotasks();

    expect(pathOp).not.toHaveBeenCalled();
    expect(
      messages.filter((message) => message.type === "studio-quality/cancelled"),
    ).toHaveLength(2);
    expect(messages.at(-1)).toEqual({
      type: "studio-quality/disposed",
      protocolRevision: STUDIO_QUALITY_WORKER_PROTOCOL_REVISION,
      workerEpoch: 9,
      acceptedThroughRequestId: 2,
    });
    expect(runtime.snapshot().state).toBe("disposed");
  });

  it("isolates provider execution failures and continues with later requests", async () => {
    const pathOp = vi.fn((a: string) => {
      if (a === "throw") throw new Error("provider exploded");
      return { ok: true, pathData: "M0 0Z" } as const;
    });
    const { messages, runtime } = harness(() => fakeProvider({ pathOp }));
    runtime.handleMessage(initialize());
    await flushMicrotasks();
    runtime.handleMessage({
      ...request(1),
      operation: {
        kind: "path-boolean",
        a: "throw",
        b: "M0 0Z",
        op: "union",
      },
    });
    runtime.handleMessage(request(2));
    await flushMicrotasks();
    expect(messages).toContainEqual(
      expect.objectContaining({
        type: "studio-quality/failure",
        requestId: 1,
        error: expect.objectContaining({ code: "provider-execution-failed" }),
      }),
    );
    expect(messages).toContainEqual(
      expect.objectContaining({
        type: "studio-quality/result",
        requestId: 2,
      }),
    );
    expect(runtime.snapshot().state).toBe("ready");
  });

  it("fails closed on invalid and oversized provider results", async () => {
    const oversized = `M${"0".repeat(
      STUDIO_QUALITY_WORKER_BUDGETS.maxOutputPathCodeUnits,
    )}`;
    const pathOp = vi
      .fn()
      .mockReturnValueOnce({ ok: true, pathData: "", embind: {} })
      .mockReturnValueOnce({ ok: true, pathData: oversized });
    const { messages, runtime } = harness(() =>
      fakeProvider({
        pathOp: pathOp as StudioQualityEngine["pathOp"],
      }),
    );
    runtime.handleMessage(initialize());
    await flushMicrotasks();
    runtime.handleMessage(request(1));
    runtime.handleMessage(request(2));
    await flushMicrotasks();
    expect(messages).toContainEqual(
      expect.objectContaining({
        type: "studio-quality/failure",
        requestId: 1,
        error: expect.objectContaining({ code: "provider-result-invalid" }),
      }),
    );
    expect(messages).toContainEqual(
      expect.objectContaining({
        type: "studio-quality/failure",
        requestId: 2,
        error: expect.objectContaining({ code: "output-budget-exceeded" }),
      }),
    );
  });
});
