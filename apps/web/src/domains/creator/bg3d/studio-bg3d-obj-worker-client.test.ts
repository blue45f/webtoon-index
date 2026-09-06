import { afterEach, describe, expect, it, vi } from "vitest";

import {
  STUDIO_BG3D_OBJ_WORKER_MAX_OWNED_INPUT_BYTES,
  STUDIO_BG3D_OBJ_WORKER_MAX_QUEUED_JOBS,
  StudioBg3dObjWorkerClient,
  type StudioBg3dObjWorkerClientInput,
  type StudioBg3dObjWorkerLike,
} from "./studio-bg3d-obj-worker-client";
import {
  STUDIO_BG3D_OBJ_WORKER_PROTOCOL_VERSION,
  type StudioBg3dObjWorkerCanonicalResult,
  type StudioBg3dObjWorkerRequest,
} from "./studio-bg3d-obj-worker-protocol";

interface MessageEventLike { readonly data: unknown }
interface ErrorEventLike { preventDefault?(): void }

class FakeWorker implements StudioBg3dObjWorkerLike {
  readonly requests: StudioBg3dObjWorkerRequest[] = [];
  readonly transferredByteLengths: number[][] = [];
  readonly messageListeners = new Set<(event: MessageEventLike) => void>();
  readonly errorListeners = new Set<(event: ErrorEventLike) => void>();
  readonly messageErrorListeners = new Set<(event: ErrorEventLike) => void>();
  terminateCalls = 0;
  throwOnPost = false;

  postMessage(message: StudioBg3dObjWorkerRequest, transfer: Transferable[]): void {
    if (this.throwOnPost) throw new Error("post failed");
    this.transferredByteLengths.push(transfer.map((entry) =>
      entry instanceof ArrayBuffer ? entry.byteLength : 0));
    this.requests.push(structuredClone(message, { transfer }));
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

function input(
  suffix: string,
  options: { readonly objBytes?: number; readonly mtlBytes?: number } = {},
): StudioBg3dObjWorkerClientInput {
  const objBytes = options.objBytes ?? 4;
  const mtlBytes = options.mtlBytes ?? 3;
  const primaryPath = `models/${suffix}.obj`;
  const mtlPath = `models/${suffix}.mtl`;
  const materialLibraries = mtlBytes > 0
    ? [{ path: mtlPath, sourceByteLength: mtlBytes, bytes: new ArrayBuffer(mtlBytes) }]
    : [];
  return {
    primaryPath,
    bytes: new ArrayBuffer(objBytes),
    materialLibraries,
    resourcePaths: mtlBytes > 0 ? [mtlPath, primaryPath].sort() : [primaryPath],
  };
}

function canonicalResult(request: StudioBg3dObjWorkerRequest): StudioBg3dObjWorkerCanonicalResult {
  const sourceMtlPath = request.materialLibraries[0]?.path ?? null;
  const positions = new Float32Array([
    0, 0, 0,
    1, 0, 0,
    0, 1, 0,
  ]);
  const usedResourcePaths = sourceMtlPath
    ? [sourceMtlPath, request.primaryPath].sort()
    : [request.primaryPath];
  return {
    primaryPath: request.primaryPath,
    nodes: [{ name: "Triangle", parentIndex: null, renderableIndex: 0 }],
    renderables: [{
      kind: "mesh",
      name: "Triangle",
      vertexCount: 3,
      attributes: [{
        name: "position",
        itemSize: 3,
        count: 3,
        normalized: false,
        arrayType: "float32",
        buffer: positions.buffer,
      }],
      groups: [{ start: 0, count: 3, materialIndex: 0 }],
      materialSlots: [{
        name: "Default",
        canonicalMaterialIndex: 0,
        flatShading: false,
        vertexColors: false,
      }],
    }],
    materials: [{
      name: "Default",
      sourceMtlPath,
      synthesized: sourceMtlPath === null,
      ambient: [0, 0, 0],
      diffuse: [0.8, 0.8, 0.8],
      specular: [0, 0, 0],
      emissive: [0, 0, 0],
      shininess: 30,
      opacity: 1,
      textures: [],
    }],
    usedResourcePaths,
    metrics: {
      nodes: 1,
      meshes: 1,
      vertices: 3,
      triangles: 1,
      outputBytes: positions.byteLength,
      materials: 1,
      materialSlots: 1,
      usedResources: usedResourcePaths.length,
    },
  };
}

function responseFor(worker: FakeWorker, requestIndex = 0): unknown {
  const request = worker.requests[requestIndex];
  return {
    version: STUDIO_BG3D_OBJ_WORKER_PROTOCOL_VERSION,
    kind: "result",
    requestId: request.requestId,
    generationId: request.generationId,
    result: canonicalResult(request),
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("StudioBg3dObjWorkerClient", () => {
  it("transfers ownership, ignores stale responses, and reports monotonic correlated progress", async () => {
    const worker = new FakeWorker();
    const progress = vi.fn((event: { readonly stage: string }) => {
      if (event.stage === "parsing") throw new Error("observer failure");
    });
    const source = input("success");
    const client = new StudioBg3dObjWorkerClient({ workerFactory: () => worker });
    const pending = client.parse(source, { onProgress: progress });
    const request = worker.requests[0];

    expect(request).toMatchObject({
      requestId: 1,
      generationId: 1,
      primaryPath: "models/success.obj",
      sourceByteLength: 4,
    });
    expect(worker.transferredByteLengths[0]).toEqual([4, 3]);
    expect(source.bytes.byteLength).toBe(0);
    expect(source.materialLibraries[0]?.bytes.byteLength).toBe(0);
    expect(client.ownedInputBytes).toBe(7);

    worker.emitMessage({ ...responseFor(worker) as object, generationId: 99 });
    expect(worker.terminateCalls).toBe(0);
    worker.emitMessage({
      version: STUDIO_BG3D_OBJ_WORKER_PROTOCOL_VERSION,
      kind: "progress",
      requestId: 1,
      generationId: 1,
      stage: "parsing",
      progress: 0.1,
    });
    worker.emitMessage({
      version: STUDIO_BG3D_OBJ_WORKER_PROTOCOL_VERSION,
      kind: "progress",
      requestId: 1,
      generationId: 1,
      stage: "canonicalizing",
      progress: 0.7,
    });
    worker.emitMessage(responseFor(worker));

    await expect(pending).resolves.toMatchObject({ primaryPath: "models/success.obj" });
    expect(progress.mock.calls.map(([event]) => event.stage)).toEqual([
      "queued",
      "parsing",
      "canonicalizing",
      "validating",
      "ready",
    ]);
    expect(client.ownedInputBytes).toBe(0);
    expect(worker.terminateCalls).toBe(1);
    client.dispose();
  });

  it("serializes jobs at capacity one and creates a fresh module Worker for every job", async () => {
    const workers: FakeWorker[] = [];
    const client = new StudioBg3dObjWorkerClient({
      workerFactory: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker;
      },
    });
    const firstInput = input("first");
    const secondInput = input("second");
    const first = client.parse(firstInput);
    const second = client.parse(secondInput);

    expect(workers).toHaveLength(1);
    expect(firstInput.bytes.byteLength).toBe(0);
    expect(secondInput.bytes.byteLength).toBe(4);
    expect(client.queuedCount).toBe(1);
    workers[0].emitMessage(responseFor(workers[0]));
    await expect(first).resolves.toMatchObject({ primaryPath: "models/first.obj" });

    await vi.waitFor(() => expect(workers).toHaveLength(2));
    expect(workers[1].requests[0]).toMatchObject({ requestId: 2, generationId: 2 });
    expect(secondInput.bytes.byteLength).toBe(0);
    workers[1].emitMessage(responseFor(workers[1]));
    await expect(second).resolves.toMatchObject({ primaryPath: "models/second.obj" });
    expect(workers.map((worker) => worker.terminateCalls)).toEqual([1, 1]);
    client.dispose();
  });

  it("bounds both queued job count and detached-buffer byte ownership", async () => {
    const countWorker = new FakeWorker();
    const countClient = new StudioBg3dObjWorkerClient({ workerFactory: () => countWorker });
    const owned = Array.from(
      { length: STUDIO_BG3D_OBJ_WORKER_MAX_QUEUED_JOBS + 1 },
      (_, index) => countClient.parse(input(`count-${index}`)).catch((error: unknown) => error),
    );
    await expect(countClient.parse(input("count-overflow"))).rejects.toMatchObject({
      code: "capacity-exceeded",
    });
    expect(countClient.activeCount).toBe(1);
    expect(countClient.queuedCount).toBe(STUDIO_BG3D_OBJ_WORKER_MAX_QUEUED_JOBS);
    countClient.dispose();
    expect((await Promise.all(owned)).every((error) =>
      typeof error === "object" && error !== null && Reflect.get(error, "code") === "disposed"))
      .toBe(true);
    expect(countClient.ownedInputBytes).toBe(0);

    const byteWorker = new FakeWorker();
    const byteClient = new StudioBg3dObjWorkerClient({ workerFactory: () => byteWorker });
    const halfBudget = STUDIO_BG3D_OBJ_WORKER_MAX_OWNED_INPUT_BYTES / 2;
    let largeSequence = 0;
    const large = () => input(`large-${largeSequence += 1}`, {
      objBytes: 32 * 1024 * 1024,
      mtlBytes: halfBudget - 32 * 1024 * 1024,
    });
    const first = byteClient.parse(large()).catch((error: unknown) => error);
    const second = byteClient.parse(large()).catch((error: unknown) => error);
    expect(byteClient.ownedInputBytes).toBe(STUDIO_BG3D_OBJ_WORKER_MAX_OWNED_INPUT_BYTES);
    await expect(byteClient.parse(input("one-byte", { objBytes: 1, mtlBytes: 0 })))
      .rejects.toMatchObject({ code: "capacity-exceeded" });
    byteClient.dispose();
    await Promise.all([first, second]);
    expect(byteClient.ownedInputBytes).toBe(0);
  });

  it("removes queued aborts and queue timeouts without disturbing the active job", async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const client = new StudioBg3dObjWorkerClient({
      workerFactory: () => worker,
      executionTimeoutMs: 1_000,
      queueTimeoutMs: 25,
    });
    const active = client.parse(input("active"));
    const abortController = new AbortController();
    const aborted = client.parse(input("queued-abort"), { signal: abortController.signal });
    const timedOut = client.parse(input("queued-timeout"));
    const abortedOutcome = aborted.catch((error: unknown) => error);
    const timedOutOutcome = timedOut.catch((error: unknown) => error);

    expect(client.queuedCount).toBe(2);
    abortController.abort();
    expect(await abortedOutcome).toMatchObject({ code: "aborted", name: "AbortError" });
    expect(client.queuedCount).toBe(1);
    await vi.advanceTimersByTimeAsync(25);
    expect(await timedOutOutcome).toMatchObject({ code: "queue-timeout" });
    expect(client.queuedCount).toBe(0);
    expect(worker.terminateCalls).toBe(0);

    worker.emitMessage(responseFor(worker));
    await expect(active).resolves.toMatchObject({ primaryPath: "models/active.obj" });
    expect(client.ownedInputBytes).toBe(0);
    client.dispose();
  });

  it("hard-terminates an active abort and recovers in a fresh realm", async () => {
    const workers: FakeWorker[] = [];
    const client = new StudioBg3dObjWorkerClient({
      workerFactory: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker;
      },
    });
    const controller = new AbortController();
    const aborted = client.parse(input("abort-active"), { signal: controller.signal });
    controller.abort();
    await expect(aborted).rejects.toMatchObject({ code: "aborted", name: "AbortError" });
    expect(workers[0].terminateCalls).toBe(1);
    expect(client.ownedInputBytes).toBe(0);

    const recovered = client.parse(input("after-abort"));
    expect(workers).toHaveLength(2);
    workers[1].emitMessage(responseFor(workers[1]));
    await expect(recovered).resolves.toMatchObject({ primaryPath: "models/after-abort.obj" });
    client.dispose();
  });

  it("distinguishes construction and post failures and releases accounting", async () => {
    const unavailable = new StudioBg3dObjWorkerClient({
      workerFactory: () => { throw new Error("constructor blocked"); },
    });
    await expect(unavailable.parse(input("unavailable"))).rejects.toMatchObject({
      code: "worker-unavailable",
    });
    expect(unavailable.ownedInputBytes).toBe(0);
    unavailable.dispose();

    const postWorker = new FakeWorker();
    postWorker.throwOnPost = true;
    const postClient = new StudioBg3dObjWorkerClient({ workerFactory: () => postWorker });
    const postInput = input("post-failure");
    await expect(postClient.parse(postInput)).rejects.toMatchObject({ code: "post-failed" });
    expect(postInput.bytes.byteLength).toBe(4);
    expect(postWorker.terminateCalls).toBe(1);
    expect(postClient.ownedInputBytes).toBe(0);
    postClient.dispose();
  });

  it("hard-terminates crashes, message errors, protocol violations, and typed parse failures", async () => {
    const workers: FakeWorker[] = [];
    const client = new StudioBg3dObjWorkerClient({
      workerFactory: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker;
      },
    });

    const crashed = client.parse(input("crash"));
    workers[0].emitError("error");
    await expect(crashed).rejects.toMatchObject({ code: "worker-failed" });

    const messageError = client.parse(input("message-error"));
    workers[1].emitError("messageerror");
    await expect(messageError).rejects.toMatchObject({ code: "worker-failed" });

    const invalid = client.parse(input("protocol"));
    const invalidRequest = workers[2].requests[0];
    workers[2].emitMessage({
      version: STUDIO_BG3D_OBJ_WORKER_PROTOCOL_VERSION,
      kind: "result",
      requestId: invalidRequest.requestId,
      generationId: invalidRequest.generationId,
      result: null,
    });
    await expect(invalid).rejects.toMatchObject({ code: "protocol" });

    const parseFailure = client.parse(input("parse-failure"));
    const failedRequest = workers[3].requests[0];
    workers[3].emitMessage({
      version: STUDIO_BG3D_OBJ_WORKER_PROTOCOL_VERSION,
      kind: "error",
      requestId: failedRequest.requestId,
      generationId: failedRequest.generationId,
      code: "parse-failed",
    });
    await expect(parseFailure).rejects.toMatchObject({ code: "parse-failed" });

    expect(workers).toHaveLength(4);
    expect(workers.every((worker) => worker.terminateCalls === 1)).toBe(true);
    expect(client.ownedInputBytes).toBe(0);
    client.dispose();
  });

  it("hard-times out execution, then starts subsequent work in a clean Worker", async () => {
    vi.useFakeTimers();
    const workers: FakeWorker[] = [];
    const client = new StudioBg3dObjWorkerClient({
      executionTimeoutMs: 25,
      workerFactory: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker;
      },
    });
    const timed = client.parse(input("timeout"));
    const timedOutcome = timed.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(25);
    expect(await timedOutcome).toMatchObject({ code: "timeout" });
    expect(workers[0].terminateCalls).toBe(1);
    expect(client.ownedInputBytes).toBe(0);

    const recovered = client.parse(input("after-timeout"));
    expect(workers).toHaveLength(2);
    workers[1].emitMessage(responseFor(workers[1]));
    await expect(recovered).resolves.toMatchObject({ primaryPath: "models/after-timeout.obj" });
    client.dispose();
  });

  it("rejects progress regression as protocol failure", async () => {
    const worker = new FakeWorker();
    const client = new StudioBg3dObjWorkerClient({ workerFactory: () => worker });
    const pending = client.parse(input("progress-regression"));
    const request = worker.requests[0];
    worker.emitMessage({
      version: STUDIO_BG3D_OBJ_WORKER_PROTOCOL_VERSION,
      kind: "progress",
      requestId: request.requestId,
      generationId: request.generationId,
      stage: "canonicalizing",
      progress: 0.7,
    });
    worker.emitMessage({
      version: STUDIO_BG3D_OBJ_WORKER_PROTOCOL_VERSION,
      kind: "progress",
      requestId: request.requestId,
      generationId: request.generationId,
      stage: "parsing",
      progress: 0.8,
    });

    await expect(pending).rejects.toMatchObject({ code: "protocol" });
    expect(worker.terminateCalls).toBe(1);
    expect(client.ownedInputBytes).toBe(0);
    client.dispose();
  });

  it("disposes active and queued ownership exactly once and remains disposed", async () => {
    const worker = new FakeWorker();
    const client = new StudioBg3dObjWorkerClient({ workerFactory: () => worker });
    const first = client.parse(input("dispose-active"));
    const secondInput = input("dispose-queued");
    const second = client.parse(secondInput);
    const firstOutcome = first.catch((error: unknown) => error);
    const secondOutcome = second.catch((error: unknown) => error);
    expect(client.ownedInputBytes).toBe(14);

    client.dispose();
    client.dispose();
    expect(await firstOutcome).toMatchObject({ code: "disposed" });
    expect(await secondOutcome).toMatchObject({ code: "disposed" });
    expect(worker.terminateCalls).toBe(1);
    expect(secondInput.bytes.byteLength).toBe(4);
    expect(client.activeCount).toBe(0);
    expect(client.queuedCount).toBe(0);
    expect(client.ownedInputBytes).toBe(0);

    const rejectedInput = input("already-disposed");
    await expect(client.parse(rejectedInput)).rejects.toMatchObject({ code: "disposed" });
    expect(rejectedInput.bytes.byteLength).toBe(4);
  });
});
