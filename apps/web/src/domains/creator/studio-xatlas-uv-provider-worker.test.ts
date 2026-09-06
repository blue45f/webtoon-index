import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isStudioXAtlasUvResult,
  isStudioXAtlasUvWorkerInboundMessage,
  isStudioXAtlasUvWorkerOutboundMessage,
  STUDIO_XATLAS_UV_WORKER_PROTOCOL_VERSION,
  studioXAtlasUvRequestHash,
  studioXAtlasUvRequestTransfers,
  studioXAtlasUvResultHash,
  studioXAtlasUvResultTransfers,
  type StudioXAtlasUvWorkerInboundMessage,
  type StudioXAtlasUvWorkerOutboundMessage,
} from "./studio-xatlas-uv-provider-protocol";
import {
  createStudioXAtlasUvWorkerClient,
  type StudioXAtlasUvWorkerLike,
} from "./studio-xatlas-uv-provider-worker-client";
import {
  installStudioXAtlasUvWorkerHost,
  type StudioXAtlasUvWorkerHostScope,
} from "./studio-xatlas-uv-provider-worker-host";

import type {
  StudioXAtlasUvArtifact,
  StudioXAtlasUvRequest,
  StudioXAtlasUvResult,
  StudioXAtlasUvRuntime,
  StudioXAtlasUvRuntimeAtlas,
  StudioXAtlasUvRuntimeGeometry,
  StudioXAtlasUvRuntimeMeshInput,
} from "./studio-xatlas-uv-provider";

interface MessageEventLike {
  readonly data: unknown;
}

interface ErrorEventLike {
  preventDefault?(): void;
}

function uvRequest(
  requestEpoch = 1,
  documentEpoch = 7,
): StudioXAtlasUvRequest {
  return {
    operation: "unwrap-atlas",
    requestEpoch,
    documentEpoch,
    meshes: [{
      id: "triangle",
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      indices: new Uint16Array([0, 1, 2]),
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      uv: new Float32Array([0, 0, 1, 0, 0, 1]),
    }],
  };
}

function artifact(): StudioXAtlasUvArtifact {
  return {
    kind: "studio-xatlas-uv-atlas",
    version: 1,
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    uv: new Float32Array([0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2]),
    meshes: [{
      id: "triangle",
      sourceVertexCount: 3,
      vertexOffset: 0,
      vertexCount: 3,
      indexOffset: 0,
      indexCount: 3,
      atlasSegments: [{ indexOffset: 0, indexCount: 3, atlasIndex: 0 }],
    }],
    atlas: {
      width: 64,
      height: 64,
      count: 1,
      texelsPerUnit: 16,
    },
    receipt: {
      packageName: "xatlasjs",
      packageVersion: "0.2.0-fake",
      runtimeSource: "injected",
      intendedHost: "dedicated-worker",
      executionTopology: "single-dedicated-worker",
      rendererNeutral: true,
      defensiveInputCopy: true,
      defensiveOutputCopy: true,
      originalInputPreserved: true,
      nativeHandlesReturned: false,
      mainThreadFallback: false,
      atlasCleanup: "direct-destroyAtlas-finally",
      geometryCleanup: "release-typed-array-snapshots",
      wasmCleanup: "dedicated-worker-termination",
    },
  };
}

class EchoWorker implements StudioXAtlasUvWorkerLike {
  readonly inbound: StudioXAtlasUvWorkerInboundMessage[] = [];
  readonly transfers: Transferable[][] = [];
  terminated = false;
  autoReady = true;
  autoRespond = true;
  private readonly messageListeners = new Set<(event: MessageEventLike) => void>();
  private readonly errorListeners = new Set<(event: ErrorEventLike) => void>();

  addEventListener(
    type: "message" | "error" | "messageerror",
    listener: ((event: MessageEventLike) => void) | ((event: ErrorEventLike) => void),
  ): void {
    if (type === "message") {
      this.messageListeners.add(listener as (event: MessageEventLike) => void);
    } else {
      this.errorListeners.add(listener as (event: ErrorEventLike) => void);
    }
  }

  removeEventListener(
    type: "message" | "error" | "messageerror",
    listener: ((event: MessageEventLike) => void) | ((event: ErrorEventLike) => void),
  ): void {
    if (type === "message") {
      this.messageListeners.delete(listener as (event: MessageEventLike) => void);
    } else {
      this.errorListeners.delete(listener as (event: ErrorEventLike) => void);
    }
  }

  postMessage(
    message: StudioXAtlasUvWorkerInboundMessage,
    transfer: Transferable[] = [],
  ): void {
    this.inbound.push(message);
    this.transfers.push(transfer);
    if (message.type === "studio-xatlas-uv/configure" && this.autoReady) {
      queueMicrotask(() => this.emit({
        type: "studio-xatlas-uv/ready",
        version: STUDIO_XATLAS_UV_WORKER_PROTOCOL_VERSION,
      }));
      return;
    }
    if (message.type !== "studio-xatlas-uv/execute" || !this.autoRespond) return;
    queueMicrotask(() => {
      const result = { ok: true, artifact: artifact() } as const;
      this.emit({
        type: "studio-xatlas-uv/progress",
        version: STUDIO_XATLAS_UV_WORKER_PROTOCOL_VERSION,
        requestId: message.requestId,
        sequence: 1,
        mode: "pack",
        progress: 0.5,
      });
      this.emit({
        type: "studio-xatlas-uv/result",
        version: STUDIO_XATLAS_UV_WORKER_PROTOCOL_VERSION,
        requestId: message.requestId,
        result,
        binding: {
          requestEpoch: message.request.requestEpoch,
          documentEpoch: message.request.documentEpoch,
          requestHash: studioXAtlasUvRequestHash(message.request),
          resultHash: studioXAtlasUvResultHash(result),
        },
      });
    });
  }

  emit(message: StudioXAtlasUvWorkerOutboundMessage | unknown): void {
    for (const listener of this.messageListeners) listener({ data: message });
  }

  fail(): void {
    for (const listener of this.errorListeners) listener({});
  }

  terminate(): void {
    this.terminated = true;
  }
}

class MemoryHostScope implements StudioXAtlasUvWorkerHostScope {
  readonly outbound: Array<{
    readonly message: StudioXAtlasUvWorkerOutboundMessage;
    readonly transfer: Transferable[];
  }> = [];
  private readonly listeners = new Set<(event: MessageEventLike) => void>();

  addEventListener(
    _type: "message",
    listener: (event: MessageEvent<unknown>) => void,
  ): void {
    this.listeners.add(listener as (event: MessageEventLike) => void);
  }

  postMessage(
    message: StudioXAtlasUvWorkerOutboundMessage,
    transfer: Transferable[] = [],
  ): void {
    this.outbound.push({ message, transfer });
  }

  dispatch(data: unknown): void {
    for (const listener of this.listeners) listener({ data });
  }
}

class HostGeometry implements StudioXAtlasUvRuntimeGeometry {
  constructor(
    readonly id: string,
    readonly mesh: StudioXAtlasUvRuntimeMeshInput,
  ) {}

  release(): void {}
}

class HostRuntime implements StudioXAtlasUvRuntime {
  readonly packageVersion = "0.2.0-host";
  initialized = 0;

  async initialize(): Promise<void> {
    this.initialized += 1;
  }

  createGeometry(mesh: StudioXAtlasUvRuntimeMeshInput): StudioXAtlasUvRuntimeGeometry {
    return new HostGeometry(mesh.id, mesh);
  }

  async pack(
    geometries: readonly StudioXAtlasUvRuntimeGeometry[],
  ): Promise<StudioXAtlasUvRuntimeAtlas> {
    return {
      width: 64,
      height: 64,
      atlasCount: 1,
      meshCount: geometries.length,
      texelsPerUnit: 16,
      meshes: geometries.map((geometry) => {
        if (!(geometry instanceof HostGeometry)) throw new TypeError("foreign geometry");
        return {
          id: geometry.id,
          positions: geometry.mesh.positions,
          uv: new Float32Array([0, 0, 1, 0, 0, 1]),
          indices: geometry.mesh.indices,
          atlasSegments: [{ index: 0, count: 3, atlasIndex: 0 }],
        };
      }),
    };
  }

  async cleanupAtlas(): Promise<boolean> {
    return true;
  }

  dispose(): void {}
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Studio xatlas UV Worker boundary", () => {
  it("returns an explicit no-main-thread-fallback receipt on Worker construction failure", async () => {
    const client = createStudioXAtlasUvWorkerClient({
      requestEpoch: 1,
      documentEpoch: 7,
      workerFactory: () => {
        throw new Error("unavailable");
      },
    });

    await expect(client.execute(uvRequest())).resolves.toEqual({
      ok: false,
      reason: "worker-unavailable",
      detail: "xatlas dedicated Worker is unavailable: construction-failed",
      fallback: {
        kind: "no-fallback",
        workerAvailable: false,
        mainThreadFallback: false,
        originalInputPreserved: true,
        reason: "construction-failed",
      },
    });
    expect(client.getDiagnostics()).toMatchObject({
      phase: "unavailable",
      pendingRequestCount: 0,
    });
  });

  it("configures locally, copies caller buffers, reports progress, and validates output", async () => {
    const worker = new EchoWorker();
    const progress = vi.fn();
    const client = createStudioXAtlasUvWorkerClient({
      requestEpoch: 1,
      documentEpoch: 7,
      workerFactory: () => worker,
    });
    const candidate = uvRequest();
    const original = new Float32Array(candidate.meshes[0]!.positions);
    const result = await client.execute(candidate, { onProgress: progress });

    expect(result.ok).toBe(true);
    expect(progress).toHaveBeenCalledWith({
      sequence: 1,
      mode: "pack",
      progress: 0.5,
    });
    expect(candidate.meshes[0]?.positions).toEqual(original);
    expect(worker.inbound.map(({ type }) => type)).toEqual([
      "studio-xatlas-uv/configure",
      "studio-xatlas-uv/execute",
    ]);
    const execute = worker.inbound[1];
    if (execute?.type !== "studio-xatlas-uv/execute") return;
    expect(execute.request.meshes[0]?.positions).not.toBe(candidate.meshes[0]?.positions);
    expect(execute.request.meshes[0]?.positions).toEqual(candidate.meshes[0]?.positions);
    expect(worker.transfers[1]).toHaveLength(4);
    expect(isStudioXAtlasUvResult(result)).toBe(true);
    client.dispose();
    expect(worker.terminated).toBe(true);
  });

  it("rejects per-mesh geometry budgets and nested accessors before copying input", async () => {
    const clone = vi.spyOn(globalThis, "structuredClone");
    const worker = new EchoWorker();
    const client = createStudioXAtlasUvWorkerClient({
      requestEpoch: 1,
      documentEpoch: 7,
      workerFactory: () => worker,
    });
    const overPerMesh = uvRequest() as unknown as {
      meshes: Array<{
        positions: Float32Array;
        indices: Uint16Array | Uint32Array;
      }>;
    };
    overPerMesh.meshes[0]!.positions = new Float32Array((65_535 + 1) * 3);
    overPerMesh.meshes[0]!.indices = new Uint32Array([0, 1, 2]);
    await expect(client.execute(overPerMesh)).resolves.toMatchObject({
      ok: false,
      reason: "invalid-input",
    });
    expect(clone).not.toHaveBeenCalled();

    const getter = vi.fn(() => 8);
    const accessorRequest = uvRequest() as unknown as {
      options?: { chart?: Record<string, unknown> };
    };
    accessorRequest.options = { chart: {} };
    Object.defineProperty(accessorRequest.options.chart!, "maxIterations", {
      enumerable: true,
      get: getter,
    });
    await expect(client.execute(accessorRequest)).resolves.toMatchObject({
      ok: false,
      reason: "invalid-input",
    });
    expect(getter).not.toHaveBeenCalled();
    expect(clone).not.toHaveBeenCalled();
    clone.mockRestore();
  });

  it("rejects unbudgeted extra buffers instead of cloning unchecked fields", async () => {
    const clone = vi.spyOn(globalThis, "structuredClone");
    const workerFactory = vi.fn(() => new EchoWorker());
    const client = createStudioXAtlasUvWorkerClient({
      requestEpoch: 1,
      documentEpoch: 7,
      workerFactory,
    });
    const topLevelExtra = {
      ...uvRequest(),
      extra: new Uint8Array(1_024),
    };
    const meshExtra = {
      ...uvRequest(),
      meshes: [{
        ...uvRequest().meshes[0]!,
        extra: new Uint8Array(1_024),
      }],
    };
    const nestedOptionExtra = {
      ...uvRequest(),
      options: {
        chart: {
          extra: new Uint8Array(1_024),
        },
      },
    };

    for (const candidate of [topLevelExtra, meshExtra, nestedOptionExtra]) {
      await expect(client.execute(candidate)).resolves.toMatchObject({
        ok: false,
        reason: "invalid-input",
      });
    }
    expect(clone).not.toHaveBeenCalled();
    expect(workerFactory).not.toHaveBeenCalled();
    clone.mockRestore();
  });

  it("rejects SharedArrayBuffer-backed mesh views before Worker admission", async () => {
    if (typeof SharedArrayBuffer === "undefined") return;
    for (const field of ["positions", "indices", "normals", "uv"] as const) {
      const candidate = uvRequest();
      const source = candidate.meshes[0]![field];
      if (source === undefined) throw new TypeError(`${field} fixture is missing`);
      let shared: Float32Array | Uint16Array;
      if (field === "indices") {
        shared = new Uint16Array(new SharedArrayBuffer(source.byteLength));
        shared.set(source as Uint16Array);
      } else {
        shared = new Float32Array(new SharedArrayBuffer(source.byteLength));
        shared.set(source as Float32Array);
      }
      (candidate.meshes[0] as unknown as Record<string, unknown>)[field] = shared;
      const workerFactory = vi.fn(() => new EchoWorker());
      const client = createStudioXAtlasUvWorkerClient({
        requestEpoch: 1,
        documentEpoch: 7,
        workerFactory,
      });

      await expect(client.execute(candidate)).resolves.toMatchObject({
        ok: false,
        reason: "invalid-input",
      });
      expect(workerFactory).not.toHaveBeenCalled();
      client.dispose();
    }
  });

  it("uses intrinsic byte lengths so every copied mesh view is budgeted", async () => {
    const candidate = uvRequest();
    const mesh = candidate.meshes[0]!;
    const budgetWithoutPositions = mesh.indices.byteLength
      + mesh.normals!.byteLength
      + mesh.uv!.byteLength;
    Object.defineProperty(mesh.positions, "byteLength", {
      configurable: true,
      value: 0,
    });
    const workerFactory = vi.fn(() => new EchoWorker());
    const client = createStudioXAtlasUvWorkerClient({
      requestEpoch: 1,
      documentEpoch: 7,
      limits: { maxInputBytes: budgetWithoutPositions },
      workerFactory,
    });

    await expect(client.execute(candidate)).resolves.toMatchObject({
      ok: false,
      reason: "invalid-input",
    });
    expect(workerFactory).not.toHaveBeenCalled();
  });

  it("rejects typed-array prototype masquerading before canonical copies", async () => {
    const candidate = uvRequest();
    const masqueradingPositions = new Uint16Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    Object.setPrototypeOf(masqueradingPositions, Float32Array.prototype);
    (candidate.meshes[0] as unknown as Record<string, unknown>).positions =
      masqueradingPositions;
    const workerFactory = vi.fn(() => new EchoWorker());
    const client = createStudioXAtlasUvWorkerClient({
      requestEpoch: 1,
      documentEpoch: 7,
      workerFactory,
    });

    await expect(client.execute(candidate)).resolves.toMatchObject({
      ok: false,
      reason: "invalid-input",
    });
    expect(workerFactory).not.toHaveBeenCalled();
  });

  it("fails closed when a success binding does not match the admitted mesh", async () => {
    const worker = new EchoWorker();
    worker.autoRespond = false;
    const client = createStudioXAtlasUvWorkerClient({
      requestEpoch: 1,
      documentEpoch: 7,
      workerFactory: () => worker,
    });
    const candidate = uvRequest();
    const pending = client.execute(candidate);
    await vi.waitFor(() => {
      expect(worker.inbound.some(({ type }) => type === "studio-xatlas-uv/execute")).toBe(true);
    });
    const execute = worker.inbound.find(
      (message) => message.type === "studio-xatlas-uv/execute",
    );
    if (execute?.type !== "studio-xatlas-uv/execute") {
      throw new TypeError("execute message missing");
    }
    const validArtifact = artifact();
    const mismatched = {
      ...validArtifact,
      meshes: [{ ...validArtifact.meshes[0]!, id: "other-mesh" }],
    };
    const result = { ok: true, artifact: mismatched } as const;
    worker.emit({
      type: "studio-xatlas-uv/result",
      version: STUDIO_XATLAS_UV_WORKER_PROTOCOL_VERSION,
      requestId: execute.requestId,
      result,
      binding: {
        requestEpoch: execute.request.requestEpoch,
        documentEpoch: execute.request.documentEpoch,
        requestHash: studioXAtlasUvRequestHash(execute.request),
        resultHash: studioXAtlasUvResultHash(result),
      },
    });
    await expect(pending).resolves.toMatchObject({
      ok: false,
      reason: "invalid-provider-output",
    });
    expect(worker.terminated).toBe(true);
  });

  it("counts startup admissions for backpressure", async () => {
    const worker = new EchoWorker();
    worker.autoReady = false;
    const client = createStudioXAtlasUvWorkerClient({
      requestEpoch: 1,
      documentEpoch: 7,
      workerFactory: () => worker,
      maxPendingRequests: 1,
    });
    const first = client.execute(uvRequest());
    await vi.waitFor(() => expect(worker.inbound).toHaveLength(1));
    await expect(client.execute(uvRequest())).resolves.toMatchObject({
      ok: false,
      reason: "backpressure",
    });
    worker.emit({
      type: "studio-xatlas-uv/ready",
      version: STUDIO_XATLAS_UV_WORKER_PROTOCOL_VERSION,
    });
    await expect(first).resolves.toMatchObject({ ok: true });
  });

  it("hard-terminates the Worker on cancellation and request timeout", async () => {
    const cancelWorker = new EchoWorker();
    cancelWorker.autoRespond = false;
    const cancelClient = createStudioXAtlasUvWorkerClient({
      requestEpoch: 1,
      documentEpoch: 7,
      workerFactory: () => cancelWorker,
    });
    const controller = new AbortController();
    const cancelled = cancelClient.execute(uvRequest(), { signal: controller.signal });
    await vi.waitFor(() => expect(cancelWorker.inbound).toHaveLength(2));
    controller.abort();
    await expect(cancelled).resolves.toMatchObject({ ok: false, reason: "cancelled" });
    expect(cancelWorker.inbound.at(-1)?.type).toBe("studio-xatlas-uv/cancel");
    expect(cancelWorker.terminated).toBe(true);
    expect(cancelClient.getDiagnostics().phase).toBe("cold");

    vi.useFakeTimers();
    const timeoutWorker = new EchoWorker();
    timeoutWorker.autoRespond = false;
    const timeoutClient = createStudioXAtlasUvWorkerClient({
      requestEpoch: 1,
      documentEpoch: 7,
      workerFactory: () => timeoutWorker,
      requestTimeoutMs: 250,
    });
    const timedOut = timeoutClient.execute(uvRequest());
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(250);
    await expect(timedOut).resolves.toMatchObject({
      ok: false,
      reason: "time-budget-exceeded",
    });
    expect(timeoutWorker.terminated).toBe(true);
  });

  it("terminates active work when request or document epochs advance", async () => {
    const worker = new EchoWorker();
    worker.autoRespond = false;
    const client = createStudioXAtlasUvWorkerClient({
      requestEpoch: 1,
      documentEpoch: 7,
      workerFactory: () => worker,
    });
    const active = client.execute(uvRequest());
    await vi.waitFor(() => expect(worker.inbound).toHaveLength(2));
    expect(client.advanceEpochs(1, 8)).toBe(true);
    await expect(active).resolves.toMatchObject({
      ok: false,
      reason: "stale-document-epoch",
    });
    expect(worker.terminated).toBe(true);
    await expect(client.execute(uvRequest(1, 7))).resolves.toMatchObject({
      ok: false,
      reason: "stale-document-epoch",
    });
  });

  it("fails closed on malformed output and startup timeout", async () => {
    const malformedWorker = new EchoWorker();
    malformedWorker.autoRespond = false;
    const malformedClient = createStudioXAtlasUvWorkerClient({
      requestEpoch: 1,
      documentEpoch: 7,
      workerFactory: () => malformedWorker,
    });
    const pending = malformedClient.execute(uvRequest());
    await vi.waitFor(() => expect(malformedWorker.inbound).toHaveLength(2));
    malformedWorker.emit({ type: "legacy/success", data: [] });
    await expect(pending).resolves.toMatchObject({
      ok: false,
      reason: "worker-unavailable",
      fallback: { mainThreadFallback: false, reason: "protocol-error" },
    });

    vi.useFakeTimers();
    const startupWorker = new EchoWorker();
    startupWorker.autoReady = false;
    const startupClient = createStudioXAtlasUvWorkerClient({
      requestEpoch: 1,
      documentEpoch: 7,
      workerFactory: () => startupWorker,
      startupTimeoutMs: 250,
    });
    const startup = startupClient.execute(uvRequest());
    await vi.advanceTimersByTimeAsync(250);
    await expect(startup).resolves.toMatchObject({
      ok: false,
      reason: "worker-unavailable",
      fallback: { reason: "startup-timeout" },
    });
    expect(startupWorker.inbound.map(({ type }) => type)).toEqual([
      "studio-xatlas-uv/configure",
    ]);
  });

  it("host stays lazy for invalid requests and transfers valid typed-array results", async () => {
    const runtime = new HostRuntime();
    const runtimeLoader = vi.fn(() => runtime);
    const scope = new MemoryHostScope();
    installStudioXAtlasUvWorkerHost(scope, { runtimeLoader });
    scope.dispatch({
      type: "studio-xatlas-uv/configure",
      version: STUDIO_XATLAS_UV_WORKER_PROTOCOL_VERSION,
      requestEpoch: 1,
      documentEpoch: 7,
    });
    expect(scope.outbound[0]?.message).toEqual({
      type: "studio-xatlas-uv/ready",
      version: STUDIO_XATLAS_UV_WORKER_PROTOCOL_VERSION,
    });
    scope.dispatch({
      type: "studio-xatlas-uv/execute",
      version: STUDIO_XATLAS_UV_WORKER_PROTOCOL_VERSION,
      requestId: "invalid",
      request: {
        ...uvRequest(),
        meshes: [{
          ...uvRequest().meshes[0],
          indices: new Uint16Array([0, 1, 9]),
        }],
      },
    });
    await vi.waitFor(() => expect(scope.outbound).toHaveLength(2));
    expect(scope.outbound[1]?.message).toMatchObject({
      type: "studio-xatlas-uv/result",
      requestId: "invalid",
      result: { ok: false, reason: "invalid-input" },
    });
    expect(runtimeLoader).not.toHaveBeenCalled();

    scope.dispatch({
      type: "studio-xatlas-uv/execute",
      version: STUDIO_XATLAS_UV_WORKER_PROTOCOL_VERSION,
      requestId: "valid",
      request: uvRequest(),
    });
    await vi.waitFor(() => expect(scope.outbound).toHaveLength(3));
    expect(scope.outbound[2]?.message).toMatchObject({
      type: "studio-xatlas-uv/result",
      requestId: "valid",
      result: { ok: true },
    });
    expect(scope.outbound[2]?.transfer).toHaveLength(3);
    expect(runtime.initialized).toBe(1);

    scope.dispatch({ type: "legacy/run", requestId: "malformed" });
    expect(scope.outbound[3]?.message).toMatchObject({
      type: "studio-xatlas-uv/result",
      requestId: "malformed",
      result: { ok: false, reason: "invalid-input" },
    });
  });

  it("strictly validates messages and transfers only owned typed-array buffers", () => {
    const candidate = uvRequest();
    const inbound: StudioXAtlasUvWorkerInboundMessage = {
      type: "studio-xatlas-uv/execute",
      version: STUDIO_XATLAS_UV_WORKER_PROTOCOL_VERSION,
      requestId: "request-1",
      request: candidate,
    };
    expect(isStudioXAtlasUvWorkerInboundMessage(inbound)).toBe(true);
    expect(studioXAtlasUvRequestTransfers(candidate)).toEqual([
      candidate.meshes[0]!.positions.buffer,
      candidate.meshes[0]!.indices.buffer,
      candidate.meshes[0]!.normals!.buffer,
      candidate.meshes[0]!.uv!.buffer,
    ]);
    expect(isStudioXAtlasUvWorkerInboundMessage({ ...inbound, version: 99 })).toBe(false);

    const result: StudioXAtlasUvResult = { ok: true, artifact: artifact() };
    const outbound: StudioXAtlasUvWorkerOutboundMessage = {
      type: "studio-xatlas-uv/result",
      version: STUDIO_XATLAS_UV_WORKER_PROTOCOL_VERSION,
      requestId: "request-1",
      result,
      binding: {
        requestEpoch: candidate.requestEpoch,
        documentEpoch: candidate.documentEpoch,
        requestHash: studioXAtlasUvRequestHash(candidate),
        resultHash: studioXAtlasUvResultHash(result),
      },
    };
    expect(isStudioXAtlasUvWorkerOutboundMessage(outbound)).toBe(true);
    expect(studioXAtlasUvResultTransfers(result)).toEqual([
      result.artifact.positions.buffer,
      result.artifact.uv.buffer,
      result.artifact.indices.buffer,
    ]);
    expect(isStudioXAtlasUvWorkerOutboundMessage({
      ...outbound,
      result: {
        ok: true,
        artifact: {
          ...artifact(),
          indices: new Uint16Array([0, 1, 2]),
        },
      },
    })).toBe(false);
  });

  it("keeps all package execution behind the dedicated Worker with no fallback path", () => {
    const clientSource = readFileSync(
      fileURLToPath(new URL("./studio-xatlas-uv-provider-worker-client.ts", import.meta.url)),
      "utf8",
    );
    const hostSource = readFileSync(
      fileURLToPath(new URL("./studio-xatlas-uv-provider-worker-host.ts", import.meta.url)),
      "utf8",
    );
    const workerSource = readFileSync(
      fileURLToPath(new URL("./studio-xatlas-uv-provider.worker.ts", import.meta.url)),
      "utf8",
    );
    expect(clientSource).toContain(
      'new Worker(new URL("./studio-xatlas-uv-provider.worker.ts"',
    );
    expect(clientSource).toContain("mainThreadFallback: false");
    expect(clientSource).not.toContain('import("xatlas-three")');
    expect(hostSource).not.toContain('import("xatlas-three")');
    expect(workerSource).not.toContain('import("xatlas-three")');
    for (const source of [clientSource, hostSource, workerSource]) {
      expect(source).not.toMatch(/\bKonva\b|react-konva|WebGLRenderer|WebGPURenderer/);
      expect(source).not.toContain("getContext(");
    }
  });
});
