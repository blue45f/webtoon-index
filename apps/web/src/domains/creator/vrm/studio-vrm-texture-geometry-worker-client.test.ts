import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildStudioVrmTextureGeometryTopologyInWorker,
  createStudioVrmTextureGeometryWorkerRequest,
  studioVrmTextureGeometrySupportsDirectExecution,
  type StudioVrmTextureGeometryWorkerLike,
} from "./studio-vrm-texture-geometry-worker-client";
import {
  STUDIO_VRM_TEXTURE_GEOMETRY_WORKER_PROTOCOL_VERSION,
  computeStudioVrmTextureGeometryWorkerTopology,
  type StudioVrmTextureGeometryWorkerRequest,
  type StudioVrmTextureGeometryWorkerResponse,
} from "./studio-vrm-texture-geometry-worker-protocol";

interface MessageEventLike {
  readonly data: unknown;
}

interface ErrorEventLike {
  preventDefault?(): void;
}

class FakeWorker implements StudioVrmTextureGeometryWorkerLike {
  readonly messages = new Set<(event: MessageEventLike) => void>();
  readonly errors = new Set<(event: ErrorEventLike) => void>();
  readonly messageErrors = new Set<(event: ErrorEventLike) => void>();
  posted: StudioVrmTextureGeometryWorkerRequest | null = null;
  transfers: Transferable[] = [];
  terminateCalls = 0;

  postMessage(
    message: StudioVrmTextureGeometryWorkerRequest,
    transfer: Transferable[],
  ): void {
    this.transfers = [...transfer];
    this.posted = structuredClone(message, { transfer }) as StudioVrmTextureGeometryWorkerRequest;
  }

  addEventListener(
    type: "message" | "error" | "messageerror",
    listener: ((event: MessageEventLike) => void) | ((event: ErrorEventLike) => void),
  ): void {
    if (type === "message") this.messages.add(listener as (event: MessageEventLike) => void);
    else if (type === "error") this.errors.add(listener as (event: ErrorEventLike) => void);
    else this.messageErrors.add(listener as (event: ErrorEventLike) => void);
  }

  removeEventListener(
    type: "message" | "error" | "messageerror",
    listener: ((event: MessageEventLike) => void) | ((event: ErrorEventLike) => void),
  ): void {
    if (type === "message") this.messages.delete(listener as (event: MessageEventLike) => void);
    else if (type === "error") this.errors.delete(listener as (event: ErrorEventLike) => void);
    else this.messageErrors.delete(listener as (event: ErrorEventLike) => void);
  }

  terminate(): void {
    this.terminateCalls += 1;
  }

  emitMessage(data: unknown): void {
    for (const listener of [...this.messages]) listener({ data });
  }

  emitError(type: "error" | "messageerror" = "error"): void {
    const event = { preventDefault: vi.fn() };
    const listeners = type === "error" ? this.errors : this.messageErrors;
    for (const listener of [...listeners]) listener(event);
  }
}

function square() {
  return {
    positions: new Float32Array([
      0, 0, 0,
      1, 0, 0,
      1, 1, 0,
      0, 1, 0,
    ]),
    uvs: new Float32Array([
      0, 0,
      1, 0,
      1, 1,
      0, 1,
    ]),
    indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
  };
}

function resultFor(
  request: StudioVrmTextureGeometryWorkerRequest,
  identity: Partial<Pick<
    StudioVrmTextureGeometryWorkerRequest,
    "requestId" | "generationId"
  >> = {},
): StudioVrmTextureGeometryWorkerResponse {
  return {
    version: STUDIO_VRM_TEXTURE_GEOMETRY_WORKER_PROTOCOL_VERSION,
    kind: "result",
    requestId: identity.requestId ?? request.requestId,
    generationId: identity.generationId ?? request.generationId,
    topology: computeStudioVrmTextureGeometryWorkerTopology(request),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("studio-vrm-texture-geometry-worker-client", () => {
  it("transfers owned snapshots, preserves source arrays, and accepts a verified result", async () => {
    const source = square();
    const worker = new FakeWorker();
    const pending = buildStudioVrmTextureGeometryTopologyInWorker(source, {
      workerFactory: () => worker,
    });
    const request = worker.posted;
    expect(request).not.toBeNull();
    if (!request) throw new Error("request missing");

    expect(worker.transfers).toHaveLength(3);
    expect(source.positions.byteLength).toBe(4 * 3 * Float32Array.BYTES_PER_ELEMENT);
    expect(source.uvs.byteLength).toBe(4 * 2 * Float32Array.BYTES_PER_ELEMENT);
    expect(source.indices.byteLength).toBe(6 * Uint16Array.BYTES_PER_ELEMENT);
    worker.emitMessage(resultFor(request));

    const result = await pending;
    expect(result).toMatchObject({
      execution: "worker",
      selectedExecutionBackend: "worker",
      attemptedExecutionBackends: ["worker"],
    });
    expect([...result.topology.triangleIslandIds]).toEqual([0, 0]);
    expect(worker.terminateCalls).toBe(1);
    expect(worker.messages.size).toBe(0);
    expect(worker.errors.size).toBe(0);
    expect(worker.messageErrors.size).toBe(0);
  });

  it("ignores stale identities without allowing them to settle the current job", async () => {
    const worker = new FakeWorker();
    const pending = buildStudioVrmTextureGeometryTopologyInWorker(square(), {
      workerFactory: () => worker,
    });
    const request = worker.posted;
    if (!request) throw new Error("request missing");
    let settled = false;
    void pending.finally(() => {
      settled = true;
    });

    worker.emitMessage(resultFor(request, { generationId: request.generationId + 1 }));
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(worker.terminateCalls).toBe(0);

    worker.emitMessage(resultFor(request));
    await expect(pending).resolves.toMatchObject({ execution: "worker" });
    expect(worker.terminateCalls).toBe(1);
  });

  it("fails a malformed response with the current identity as a protocol violation", async () => {
    const worker = new FakeWorker();
    const pending = buildStudioVrmTextureGeometryTopologyInWorker(square(), {
      workerFactory: () => worker,
    });
    const request = worker.posted;
    if (!request) throw new Error("request missing");

    worker.emitMessage({
      version: 1,
      kind: "result",
      requestId: request.requestId,
      generationId: request.generationId,
      topology: null,
    });
    await expect(pending).rejects.toMatchObject({ code: "protocol" });
    expect(worker.terminateCalls).toBe(1);
  });

  it("fails an identity-free message immediately instead of waiting for timeout", async () => {
    const worker = new FakeWorker();
    const pending = buildStudioVrmTextureGeometryTopologyInWorker(square(), {
      workerFactory: () => worker,
    });

    worker.emitMessage({ kind: "result", topology: null });
    await expect(pending).rejects.toMatchObject({ code: "protocol" });
    expect(worker.terminateCalls).toBe(1);
  });

  it("propagates a typed Worker budget failure and terminates its realm", async () => {
    const worker = new FakeWorker();
    const pending = buildStudioVrmTextureGeometryTopologyInWorker(square(), {
      workerFactory: () => worker,
    });
    const request = worker.posted;
    if (!request) throw new Error("request missing");

    worker.emitMessage({
      version: 1,
      kind: "error",
      requestId: request.requestId,
      generationId: request.generationId,
      code: "working-memory-budget-exceeded",
    });
    await expect(pending).rejects.toMatchObject({
      code: "working-memory-budget-exceeded",
    });
    expect(worker.terminateCalls).toBe(1);
  });

  it("aborts, removes listeners, and quarantines a late result", async () => {
    const worker = new FakeWorker();
    const controller = new AbortController();
    const pending = buildStudioVrmTextureGeometryTopologyInWorker(square(), {
      signal: controller.signal,
      workerFactory: () => worker,
    });
    const request = worker.posted;
    if (!request) throw new Error("request missing");

    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "aborted", name: "AbortError" });
    expect(worker.terminateCalls).toBe(1);
    worker.emitMessage(resultFor(request));
    expect(worker.terminateCalls).toBe(1);
  });

  it("times out a silent Worker and reports TimeoutError", async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const pending = buildStudioVrmTextureGeometryTopologyInWorker(square(), {
      timeoutMs: 25,
      workerFactory: () => worker,
    });
    const rejection = expect(pending).rejects.toMatchObject({
      code: "timeout",
      name: "TimeoutError",
    });

    await vi.advanceTimersByTimeAsync(25);
    await rejection;
    expect(worker.terminateCalls).toBe(1);
  });

  it.each(["error", "messageerror"] as const)(
    "fails closed when the Worker emits %s",
    async (type) => {
      const worker = new FakeWorker();
      const pending = buildStudioVrmTextureGeometryTopologyInWorker(square(), {
        workerFactory: () => worker,
      });
      worker.emitError(type);

      await expect(pending).rejects.toMatchObject({ code: "worker-failed" });
      expect(worker.terminateCalls).toBe(1);
    },
  );

  it("uses bounded direct execution only when selected before work", async () => {
    const request = createStudioVrmTextureGeometryWorkerRequest(square());
    expect(studioVrmTextureGeometrySupportsDirectExecution(request)).toBe(true);
    const workerFactory = vi.fn(() => new FakeWorker());
    const result = await buildStudioVrmTextureGeometryTopologyInWorker(square(), {
      executionBackend: "direct",
      workerFactory,
    });

    expect(result).toMatchObject({
      execution: "direct",
      selectedExecutionBackend: "direct",
      attemptedExecutionBackends: ["direct"],
    });
    expect([...result.topology.triangleIslandIds]).toEqual([0, 0]);
    expect(workerFactory).not.toHaveBeenCalled();
  });

  it("fails closed when the selected Worker is unavailable for every input size", async () => {
    await expect(buildStudioVrmTextureGeometryTopologyInWorker(
      square(),
      { workerFactory: null },
    )).rejects.toMatchObject({ code: "worker-unavailable" });
    await expect(buildStudioVrmTextureGeometryTopologyInWorker(
      square(),
      {
        workerFactory: () => {
          throw new Error("startup failed");
        },
      },
    )).rejects.toMatchObject({ code: "worker-unavailable" });

    const triangles = 4_097;
    const positions = new Float32Array(triangles * 3 * 3);
    const uvs = new Float32Array(triangles * 3 * 2);
    await expect(buildStudioVrmTextureGeometryTopologyInWorker(
      { positions, uvs },
      { workerFactory: null },
    )).rejects.toMatchObject({
      code: "worker-unavailable",
    });
  });

  it("rejects oversized explicit direct work without trying a Worker", async () => {
    const triangles = 4_097;
    const factory = vi.fn(() => new FakeWorker());
    await expect(buildStudioVrmTextureGeometryTopologyInWorker(square(), {
      executionBackend: "invalid" as never,
      workerFactory: factory,
    })).rejects.toMatchObject({ code: "invalid-input" });
    await expect(buildStudioVrmTextureGeometryTopologyInWorker(
      {
        positions: new Float32Array(triangles * 3 * 3),
        uvs: new Float32Array(triangles * 3 * 2),
      },
      {
        executionBackend: "direct",
        workerFactory: factory,
      },
    )).rejects.toMatchObject({ code: "direct-input-too-large" });
    expect(factory).not.toHaveBeenCalled();
  });

  it("rejects pre-abort and invalid timeout before creating a Worker", async () => {
    const factory = vi.fn(() => new FakeWorker());
    const controller = new AbortController();
    controller.abort();
    await expect(buildStudioVrmTextureGeometryTopologyInWorker(square(), {
      signal: controller.signal,
      workerFactory: factory,
    })).rejects.toMatchObject({ code: "aborted" });
    expect(factory).not.toHaveBeenCalled();

    await expect(buildStudioVrmTextureGeometryTopologyInWorker(square(), {
      timeoutMs: 0,
      workerFactory: factory,
    })).rejects.toMatchObject({ code: "invalid-input" });
    expect(factory).not.toHaveBeenCalled();
  });
});
