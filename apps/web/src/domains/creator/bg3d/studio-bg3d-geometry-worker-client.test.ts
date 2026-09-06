import { afterEach, describe, expect, it, vi } from "vitest";

import {
  STUDIO_BG3D_GEOMETRY_WORKER_MAX_QUEUED_JOBS,
  StudioBg3dGeometryWorkerClient,
  type StudioBg3dGeometryWorkerLike,
} from "./studio-bg3d-geometry-worker-client";
import {
  STUDIO_BG3D_GEOMETRY_WORKER_MAX_OUTPUT_BYTES,
  STUDIO_BG3D_GEOMETRY_WORKER_MAX_TRIANGLES,
  STUDIO_BG3D_GEOMETRY_WORKER_MAX_VERTICES,
  STUDIO_BG3D_GEOMETRY_WORKER_PROTOCOL_VERSION,
  hasValidStudioBg3dCanonicalGeometryNumbers,
  isStudioBg3dCanonicalGeometryPayload,
  isStudioBg3dGeometryWorkerRequest,
  isStudioBg3dGeometryWorkerResponse,
  type StudioBg3dCanonicalGeometryPayload,
  type StudioBg3dGeometryWorkerFormat,
  type StudioBg3dGeometryWorkerRequest,
} from "./studio-bg3d-geometry-worker-protocol";

interface MessageEventLike { readonly data: unknown }
interface ErrorEventLike { preventDefault?(): void }

class FakeWorker implements StudioBg3dGeometryWorkerLike {
  readonly requests: StudioBg3dGeometryWorkerRequest[] = [];
  readonly transfers: Transferable[][] = [];
  readonly messageListeners = new Set<(event: MessageEventLike) => void>();
  readonly errorListeners = new Set<(event: ErrorEventLike) => void>();
  readonly messageErrorListeners = new Set<(event: ErrorEventLike) => void>();
  terminateCalls = 0;
  throwOnPost = false;

  postMessage(message: StudioBg3dGeometryWorkerRequest, transfer: Transferable[]): void {
    if (this.throwOnPost) throw new Error("post failed");
    this.requests.push(message);
    this.transfers.push(transfer);
  }

  addEventListener(
    type: "message" | "error" | "messageerror",
    listener: ((event: MessageEventLike) => void) | ((event: ErrorEventLike) => void),
  ): void {
    if (type === "message") this.messageListeners.add(listener as (event: MessageEventLike) => void);
    else if (type === "error") this.errorListeners.add(listener as (event: ErrorEventLike) => void);
    else this.messageErrorListeners.add(listener as (event: ErrorEventLike) => void);
  }

  removeEventListener(
    type: "message" | "error" | "messageerror",
    listener: ((event: MessageEventLike) => void) | ((event: ErrorEventLike) => void),
  ): void {
    if (type === "message") this.messageListeners.delete(listener as (event: MessageEventLike) => void);
    else if (type === "error") this.errorListeners.delete(listener as (event: ErrorEventLike) => void);
    else this.messageErrorListeners.delete(listener as (event: ErrorEventLike) => void);
  }

  terminate(): void {
    this.terminateCalls += 1;
  }

  emitMessage(data: unknown): void {
    for (const listener of this.messageListeners) listener({ data });
  }

  emitError(kind: "error" | "messageerror" = "error"): void {
    const listeners = kind === "error" ? this.errorListeners : this.messageErrorListeners;
    const event = { preventDefault: vi.fn() };
    for (const listener of listeners) listener(event);
  }
}

function trianglePayload(
  format: StudioBg3dGeometryWorkerFormat = "stl",
): StudioBg3dCanonicalGeometryPayload {
  const position = new Float32Array([
    0, 0, 0,
    1, 0, 0,
    0, 1, 0,
  ]);
  const normal = new Float32Array([
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
  ]);
  return {
    format,
    kind: "mesh",
    vertexCount: 3,
    triangleCount: 1,
    byteLength: position.byteLength + normal.byteLength,
    attributes: [
      {
        name: "position",
        itemSize: 3,
        count: 3,
        normalized: false,
        arrayType: "float32",
        buffer: position.buffer,
      },
      {
        name: "normal",
        itemSize: 3,
        count: 3,
        normalized: false,
        arrayType: "float32",
        buffer: normal.buffer,
      },
    ],
    index: null,
  };
}

function resultFor(worker: FakeWorker, payload = trianglePayload()): unknown {
  const request = worker.requests[0];
  return {
    version: STUDIO_BG3D_GEOMETRY_WORKER_PROTOCOL_VERSION,
    kind: "result",
    requestId: request.requestId,
    generationId: request.generationId,
    result: payload,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Studio BG3D geometry Worker protocol", () => {
  it("accepts only the exact bounded request and canonical result shapes", () => {
    const request = {
      version: STUDIO_BG3D_GEOMETRY_WORKER_PROTOCOL_VERSION,
      kind: "parse",
      requestId: 1,
      generationId: 2,
      format: "stl",
      sourceByteLength: 4,
      bytes: new ArrayBuffer(4),
      budgets: {
        maxOutputBytes: STUDIO_BG3D_GEOMETRY_WORKER_MAX_OUTPUT_BYTES,
        maxTriangles: STUDIO_BG3D_GEOMETRY_WORKER_MAX_TRIANGLES,
        maxVertices: STUDIO_BG3D_GEOMETRY_WORKER_MAX_VERTICES,
      },
    };
    expect(isStudioBg3dGeometryWorkerRequest(request)).toBe(true);
    expect(isStudioBg3dGeometryWorkerRequest({ ...request, extra: true })).toBe(false);
    expect(isStudioBg3dGeometryWorkerRequest({
      ...request,
      budgets: { ...request.budgets, maxVertices: request.budgets.maxVertices + 1 },
    })).toBe(false);
    expect(isStudioBg3dGeometryWorkerRequest({ ...request, sourceByteLength: 3 })).toBe(false);

    const payload = trianglePayload();
    expect(isStudioBg3dCanonicalGeometryPayload(payload, "stl")).toBe(true);
    expect(hasValidStudioBg3dCanonicalGeometryNumbers(payload)).toBe(true);
    expect(isStudioBg3dGeometryWorkerResponse({
      version: STUDIO_BG3D_GEOMETRY_WORKER_PROTOCOL_VERSION,
      kind: "result",
      requestId: 1,
      generationId: 2,
      result: payload,
    })).toBe(true);
    expect(isStudioBg3dCanonicalGeometryPayload({ ...payload, byteLength: payload.byteLength + 4 })).toBe(false);
    expect(isStudioBg3dCanonicalGeometryPayload({
      ...payload,
      attributes: [...payload.attributes].reverse(),
    })).toBe(false);
  });

  it("rejects non-finite attributes and out-of-range indices during main-realm revalidation", () => {
    const nonFinite = trianglePayload();
    new Float32Array(nonFinite.attributes[0].buffer)[1] = Number.NaN;
    expect(hasValidStudioBg3dCanonicalGeometryNumbers(nonFinite)).toBe(false);

    const indexed = trianglePayload("ply");
    const indices = new Uint32Array([0, 1, 3]);
    const hostile: StudioBg3dCanonicalGeometryPayload = {
      ...indexed,
      byteLength: indexed.byteLength + indices.byteLength,
      index: { count: 3, arrayType: "uint32", buffer: indices.buffer },
    };
    expect(isStudioBg3dCanonicalGeometryPayload(hostile, "ply")).toBe(true);
    expect(hasValidStudioBg3dCanonicalGeometryNumbers(hostile)).toBe(false);
  });
});

describe("StudioBg3dGeometryWorkerClient", () => {
  it("transfers owned input, reports monotonic progress, and accepts a correlated canonical result", async () => {
    const worker = new FakeWorker();
    const progress = vi.fn();
    const source = new Uint8Array([1, 2, 3, 4]).buffer;
    const client = new StudioBg3dGeometryWorkerClient({ workerFactory: () => worker });
    const pending = client.parse("stl", source, { onProgress: progress });
    const request = worker.requests[0];

    expect(request).toMatchObject({
      version: STUDIO_BG3D_GEOMETRY_WORKER_PROTOCOL_VERSION,
      kind: "parse",
      requestId: 1,
      generationId: 1,
      format: "stl",
      sourceByteLength: 4,
    });
    expect(worker.transfers[0]).toEqual([request.bytes]);
    worker.emitMessage({
      version: STUDIO_BG3D_GEOMETRY_WORKER_PROTOCOL_VERSION,
      kind: "progress",
      requestId: 1,
      generationId: 1,
      stage: "parsing",
      progress: 0.08,
    });
    worker.emitMessage({
      version: STUDIO_BG3D_GEOMETRY_WORKER_PROTOCOL_VERSION,
      kind: "progress",
      requestId: 1,
      generationId: 1,
      stage: "canonicalizing",
      progress: 0.72,
    });
    worker.emitMessage(resultFor(worker));

    await expect(pending).resolves.toMatchObject({ format: "stl", vertexCount: 3 });
    expect(progress.mock.calls.map(([value]) => value.stage)).toEqual([
      "queued",
      "parsing",
      "canonicalizing",
      "validating",
      "ready",
    ]);
    expect(worker.terminateCalls).toBe(1);
    client.dispose();
  });

  it("serializes concurrent jobs at capacity one and gives each generation a fresh Worker", async () => {
    const workers: FakeWorker[] = [];
    const client = new StudioBg3dGeometryWorkerClient({
      workerFactory: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker;
      },
    });
    const first = client.parse("stl", new ArrayBuffer(4));
    const second = client.parse("ply", new ArrayBuffer(4));
    expect(workers).toHaveLength(1);
    expect(workers[0].requests[0]).toMatchObject({ requestId: 1, generationId: 1 });

    workers[0].emitMessage(resultFor(workers[0]));
    await expect(first).resolves.toMatchObject({ format: "stl" });
    await vi.waitFor(() => expect(workers).toHaveLength(2));
    expect(workers[1].requests[0]).toMatchObject({ requestId: 2, generationId: 2, format: "ply" });
    workers[1].emitMessage(resultFor(workers[1], trianglePayload("ply")));
    await expect(second).resolves.toMatchObject({ format: "ply" });
    client.dispose();
  });

  it("ignores a stale generation and then rejects a correlated hostile result", async () => {
    const worker = new FakeWorker();
    const client = new StudioBg3dGeometryWorkerClient({ workerFactory: () => worker });
    const pending = client.parse("stl", new ArrayBuffer(4));
    const stale = resultFor(worker);
    worker.emitMessage({ ...stale as object, generationId: 99 });
    expect(worker.terminateCalls).toBe(0);

    const hostile = trianglePayload();
    new Float32Array(hostile.attributes[0].buffer)[0] = Number.POSITIVE_INFINITY;
    worker.emitMessage(resultFor(worker, hostile));
    await expect(pending).rejects.toMatchObject({ code: "protocol" });
    expect(worker.terminateCalls).toBe(1);
    client.dispose();
  });

  it("hard-terminates aborts and crashes, then recreates a clean Worker realm", async () => {
    const workers: FakeWorker[] = [];
    const client = new StudioBg3dGeometryWorkerClient({
      workerFactory: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker;
      },
    });
    const controller = new AbortController();
    const aborted = client.parse("stl", new ArrayBuffer(4), { signal: controller.signal });
    controller.abort();
    await expect(aborted).rejects.toMatchObject({ code: "aborted", name: "AbortError" });
    expect(workers[0].terminateCalls).toBe(1);

    const crashed = client.parse("ply", new ArrayBuffer(4));
    await vi.waitFor(() => expect(workers).toHaveLength(2));
    workers[1].emitError("messageerror");
    await expect(crashed).rejects.toMatchObject({ code: "worker-failed" });
    expect(workers[1].terminateCalls).toBe(1);

    const recovered = client.parse("stl", new ArrayBuffer(4));
    await vi.waitFor(() => expect(workers).toHaveLength(3));
    workers[2].emitMessage(resultFor(workers[2]));
    await expect(recovered).resolves.toMatchObject({ format: "stl" });
    client.dispose();
  });

  it("times out hard, rejects construction/post failures, and bounds queued ownership", async () => {
    vi.useFakeTimers();
    const timedWorker = new FakeWorker();
    const timedClient = new StudioBg3dGeometryWorkerClient({
      timeoutMs: 25,
      workerFactory: () => timedWorker,
    });
    const timed = timedClient.parse("stl", new ArrayBuffer(4));
    const timedResult = timed.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(25);
    expect(await timedResult).toMatchObject({ code: "timeout" });
    expect(timedWorker.terminateCalls).toBe(1);
    timedClient.dispose();
    vi.useRealTimers();

    const unavailable = new StudioBg3dGeometryWorkerClient({ workerFactory: () => null });
    await expect(unavailable.parse("stl", new ArrayBuffer(4))).rejects.toMatchObject({
      code: "worker-unavailable",
    });
    unavailable.dispose();

    const postFailureWorker = new FakeWorker();
    postFailureWorker.throwOnPost = true;
    const postFailure = new StudioBg3dGeometryWorkerClient({ workerFactory: () => postFailureWorker });
    await expect(postFailure.parse("stl", new ArrayBuffer(4))).rejects.toMatchObject({
      code: "worker-failed",
    });
    postFailure.dispose();

    const holdingWorker = new FakeWorker();
    const bounded = new StudioBg3dGeometryWorkerClient({ workerFactory: () => holdingWorker });
    const owned = Array.from(
      { length: STUDIO_BG3D_GEOMETRY_WORKER_MAX_QUEUED_JOBS + 1 },
      () => bounded.parse("stl", new ArrayBuffer(4)).catch((error: unknown) => error),
    );
    await expect(bounded.parse("stl", new ArrayBuffer(4))).rejects.toMatchObject({
      code: "capacity-exceeded",
    });
    bounded.dispose();
    expect(await Promise.all(owned)).toHaveLength(STUDIO_BG3D_GEOMETRY_WORKER_MAX_QUEUED_JOBS + 1);
  });
});
