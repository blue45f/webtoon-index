import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_STUDIO_BG3D_GLB_BUDGET_PROFILES,
  type StudioBg3dGlbValidationOptions,
} from "./studio-bg3d-glb-validation";
import {
  STUDIO_BG3D_GLB_DIRECT_MAX_BYTES,
  StudioBg3dValidationWorkerClient,
  StudioBg3dValidationWorkerPool,
  disposeSharedStudioBg3dValidationWorker,
  studioBg3dGlbSupportsDirectValidation,
  validateStudioBg3dGlbOffMainThread,
  type StudioBg3dValidationWorkerLike,
} from "./studio-bg3d-glb-validation-worker-client";
import {
  STUDIO_BG3D_GLB_VALIDATION_WORKER_PROTOCOL_VERSION,
  type StudioBg3dGlbWorkerRequest,
} from "./studio-bg3d-glb-validation-worker-protocol";

import type { StudioBg3dKtx2TranscoderCapability } from "./studio-bg3d-ktx2-transcoder-contract";

const OPTIONS: StudioBg3dGlbValidationOptions = {
  declared: {
    byteSize: 4,
    sha256: "0".repeat(64),
    mimeType: "model/gltf-binary",
  },
  cumulative: { usedBytes: 0, maximumBytes: 1024 },
  profile: "desktop",
  budgets: DEFAULT_STUDIO_BG3D_GLB_BUDGET_PROFILES,
};

function optionsForByteLength(byteLength: number): StudioBg3dGlbValidationOptions {
  return {
    ...OPTIONS,
    declared: { ...OPTIONS.declared, byteSize: byteLength },
    cumulative: { usedBytes: 0, maximumBytes: byteLength },
  };
}

class FakeWorker implements StudioBg3dValidationWorkerLike {
  readonly messages: { message: StudioBg3dGlbWorkerRequest; transfer?: Transferable[] }[] = [];
  readonly messageListeners = new Set<(event: { readonly data: unknown }) => void>();
  readonly errorListeners = new Set<(event: { preventDefault?(): void }) => void>();
  readonly messageErrorListeners = new Set<(event: { preventDefault?(): void }) => void>();
  terminated = false;

  postMessage(message: StudioBg3dGlbWorkerRequest, transfer?: Transferable[]): void {
    this.messages.push({ message, transfer });
  }

  addEventListener(
    type: "message" | "error" | "messageerror",
    listener: ((event: { readonly data: unknown }) => void) | ((event: { preventDefault?(): void }) => void),
  ): void {
    if (type === "message") this.messageListeners.add(listener as (event: { readonly data: unknown }) => void);
    if (type === "error") this.errorListeners.add(listener as (event: { preventDefault?(): void }) => void);
    if (type === "messageerror") this.messageErrorListeners.add(listener as (event: { preventDefault?(): void }) => void);
  }

  removeEventListener(
    type: "message" | "error" | "messageerror",
    listener: ((event: { readonly data: unknown }) => void) | ((event: { preventDefault?(): void }) => void),
  ): void {
    if (type === "message") this.messageListeners.delete(listener as (event: { readonly data: unknown }) => void);
    if (type === "error") this.errorListeners.delete(listener as (event: { preventDefault?(): void }) => void);
    if (type === "messageerror") this.messageErrorListeners.delete(listener as (event: { preventDefault?(): void }) => void);
  }

  terminate(): void {
    this.terminated = true;
  }

  emitMessage(data: unknown): void {
    for (const listener of this.messageListeners) listener({ data });
  }

  emitError(): void {
    for (const listener of this.errorListeners) listener({ preventDefault: vi.fn() });
  }
}

afterEach(() => {
  disposeSharedStudioBg3dValidationWorker();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("StudioBg3dValidationWorkerClient", () => {
  it("transfers an owned byte snapshot and resolves a correlated validation result", async () => {
    const worker = new FakeWorker();
    const client = new StudioBg3dValidationWorkerClient({ workerFactory: () => worker });
    const source = new Uint8Array([1, 2, 3, 4]);
    const pending = client.validate(source, OPTIONS);
    const request = worker.messages[0];

    expect(request.message).toMatchObject({
      version: STUDIO_BG3D_GLB_VALIDATION_WORKER_PROTOCOL_VERSION,
      kind: "validate",
      requestId: 1,
    });
    expect(request.transfer).toEqual([
      (request.message as Extract<StudioBg3dGlbWorkerRequest, { readonly kind: "validate" }>).bytes,
    ]);
    expect(
      new Uint8Array(
        (request.message as Extract<StudioBg3dGlbWorkerRequest, { readonly kind: "validate" }>).bytes,
      ),
    ).toEqual(source);

    worker.emitMessage({
      version: STUDIO_BG3D_GLB_VALIDATION_WORKER_PROTOCOL_VERSION,
      kind: "result",
      requestId: 1,
      result: { ok: false, code: "invalid-magic", message: "sanitized" },
    });

    await expect(pending).resolves.toEqual({
      execution: "worker",
      selectedExecutionBackend: "worker",
      attemptedExecutionBackends: ["worker"],
      result: { ok: false, code: "invalid-magic", message: "sanitized" },
    });
    expect(source).toEqual(new Uint8Array([1, 2, 3, 4]));
    client.dispose();
  });

  it("hard-terminates an aborted WASM worker and recovers with a fresh realm", async () => {
    const workers: FakeWorker[] = [];
    const client = new StudioBg3dValidationWorkerClient({
      workerFactory: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker;
      },
    });
    const controller = new AbortController();
    const pending = client.validate(new Uint8Array([1, 2, 3, 4]), OPTIONS, controller.signal);
    controller.abort();

    await expect(pending).rejects.toMatchObject({
      code: "aborted",
    });
    expect(workers[0]?.messages.map(({ message }) => message.kind)).toEqual(["validate"]);
    expect(workers[0]?.terminated).toBe(true);

    workers[0]?.emitMessage({
      version: STUDIO_BG3D_GLB_VALIDATION_WORKER_PROTOCOL_VERSION,
      kind: "result",
      requestId: 1,
      result: { ok: false, code: "invalid-input", message: "late" },
    });

    const recovered = client.validate(new Uint8Array([5, 6, 7, 8]), OPTIONS);
    expect(workers).toHaveLength(2);
    workers[1]?.emitMessage({
      version: STUDIO_BG3D_GLB_VALIDATION_WORKER_PROTOCOL_VERSION,
      kind: "result",
      requestId: 2,
      result: { ok: false, code: "invalid-magic", message: "recovered" },
    });
    await expect(recovered).resolves.toMatchObject({ execution: "worker" });
    expect(client.lifecycleMetrics).toMatchObject({
      workersCreated: 2,
      workersTerminated: 1,
      workerRecoveries: 1,
      abortTerminations: 1,
      timeoutTerminations: 0,
    });
    client.dispose();
  });

  it("closes the abort race before posting validation bytes", async () => {
    const worker = new FakeWorker();
    const client = new StudioBg3dValidationWorkerClient({ workerFactory: () => worker });
    let abortedReads = 0;
    const signal = {
      get aborted() {
        abortedReads += 1;
        return abortedReads > 1;
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as AbortSignal;

    await expect(client.validate(new Uint8Array([1, 2, 3, 4]), OPTIONS, signal)).rejects.toMatchObject({
      code: "aborted",
    });
    expect(worker.messages).toEqual([]);
    client.dispose();
  });

  it("rejects all pending work on a worker failure and disposal is idempotent", async () => {
    const workers: FakeWorker[] = [];
    const client = new StudioBg3dValidationWorkerClient({
      workerFactory: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker;
      },
    });
    const first = client.validate(new Uint8Array([1, 2, 3, 4]), OPTIONS);
    const second = client.validate(new Uint8Array([5, 6, 7, 8]), OPTIONS);
    workers[0]?.emitError();

    await expect(first).rejects.toMatchObject({
      code: "worker-failed",
    });
    await expect(second).rejects.toMatchObject({
      code: "worker-failed",
    });

    const recovered = client.validate(new Uint8Array([9, 10, 11, 12]), OPTIONS);
    expect(workers).toHaveLength(2);
    workers[1]?.emitMessage({
      version: STUDIO_BG3D_GLB_VALIDATION_WORKER_PROTOCOL_VERSION,
      kind: "result",
      requestId: 3,
      result: { ok: false, code: "invalid-magic", message: "recovered" },
    });
    await expect(recovered).resolves.toMatchObject({ execution: "worker" });

    client.dispose();
    client.dispose();
    expect(workers.every((worker) => worker.terminated)).toBe(true);
    await expect(client.validate(new Uint8Array(), OPTIONS)).rejects.toMatchObject({ code: "disposed" });
  });

  it("fails closed when a worker sends an invalid protocol payload", async () => {
    const worker = new FakeWorker();
    const client = new StudioBg3dValidationWorkerClient({ workerFactory: () => worker });
    const pending = client.validate(new Uint8Array([1, 2, 3, 4]), OPTIONS);
    worker.emitMessage({ requestId: 1, kind: "result" });

    await expect(pending).rejects.toMatchObject({
      code: "protocol",
    });
    client.dispose();
  });

  it("terminates a timed-out worker, rejects its peers, and creates a clean worker for new work", async () => {
    vi.useFakeTimers();
    const workers: FakeWorker[] = [];
    const client = new StudioBg3dValidationWorkerClient({
      workerFactory: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker;
      },
      timeoutMs: 1_000,
    });
    const timedOut = client.validate(new Uint8Array([1, 2, 3, 4]), OPTIONS);
    const peer = client.validate(new Uint8Array([5, 6, 7, 8]), OPTIONS);
    const timedOutResult = timedOut.catch((error: unknown) => error);
    const peerResult = peer.catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(await timedOutResult).toMatchObject({ code: "timeout" });
    expect(await peerResult).toMatchObject({ code: "worker-failed" });
    expect(workers[0]?.terminated).toBe(true);

    const recovered = client.validate(new Uint8Array([9, 10, 11, 12]), OPTIONS);
    expect(workers).toHaveLength(2);
    workers[1]?.emitMessage({
      version: STUDIO_BG3D_GLB_VALIDATION_WORKER_PROTOCOL_VERSION,
      kind: "result",
      requestId: 3,
      result: { ok: false, code: "invalid-magic", message: "recovered" },
    });
    await expect(recovered).resolves.toMatchObject({ execution: "worker" });
    expect(client.lifecycleMetrics).toMatchObject({
      workersCreated: 2,
      workersTerminated: 1,
      workerRecoveries: 1,
      timeoutTerminations: 1,
    });
    client.dispose();
  });

  it("creates a fresh worker after a protocol failure", async () => {
    const workers: FakeWorker[] = [];
    const client = new StudioBg3dValidationWorkerClient({
      workerFactory: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker;
      },
    });
    const failed = client.validate(new Uint8Array([1, 2, 3, 4]), OPTIONS);
    workers[0]?.emitMessage({
      version: STUDIO_BG3D_GLB_VALIDATION_WORKER_PROTOCOL_VERSION,
      kind: "result",
      requestId: 1,
      result: { ok: false, code: "not-a-validator-code", message: "corrupt" },
    });
    await expect(failed).rejects.toMatchObject({ code: "protocol" });
    expect(workers[0]?.terminated).toBe(true);

    const recovered = client.validate(new Uint8Array([5, 6, 7, 8]), OPTIONS);
    expect(workers).toHaveLength(2);
    workers[1]?.emitMessage({
      version: STUDIO_BG3D_GLB_VALIDATION_WORKER_PROTOCOL_VERSION,
      kind: "result",
      requestId: 2,
      result: { ok: false, code: "invalid-magic", message: "recovered" },
    });
    await expect(recovered).resolves.toMatchObject({ execution: "worker" });
    client.dispose();
  });

  it("honors AbortSignal while the explicitly selected direct digest is in flight", async () => {
    const controller = new AbortController();
    let releaseDigest: ((value: Uint8Array) => void) | undefined;
    const digest = vi.fn(() => new Promise<Uint8Array>((resolve) => {
      releaseDigest = resolve;
    }));
    const pending = validateStudioBg3dGlbOffMainThread(
      new Uint8Array([1, 2, 3, 4]),
      { ...OPTIONS, digest },
      { executionBackend: "direct", signal: controller.signal },
    );
    await vi.waitFor(() => expect(digest).toHaveBeenCalledOnce());
    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: "aborted" });
    releaseDigest?.(new Uint8Array(32));
  });

  it("allows only bounded payloads to use the explicitly selected direct backend", async () => {
    const ceiling = STUDIO_BG3D_GLB_DIRECT_MAX_BYTES;
    expect(studioBg3dGlbSupportsDirectValidation(new ArrayBuffer(ceiling))).toBe(true);
    expect(studioBg3dGlbSupportsDirectValidation(new ArrayBuffer(ceiling + 1))).toBe(false);

    vi.stubGlobal("Worker", undefined);
    await expect(validateStudioBg3dGlbOffMainThread(
      new Uint8Array([1, 2, 3, 4]),
      OPTIONS,
    )).rejects.toMatchObject({
      code: "worker-failed",
      selectedExecutionBackend: "worker",
      attemptedExecutionBackends: ["worker"],
    });
    await expect(validateStudioBg3dGlbOffMainThread(
      new Uint8Array([1, 2, 3, 4]),
      OPTIONS,
      { executionBackend: "direct" },
    )).resolves.toMatchObject({
      execution: "direct",
      selectedExecutionBackend: "direct",
      attemptedExecutionBackends: ["direct"],
    });

    const large = new Uint8Array(ceiling + 1);
    await expect(validateStudioBg3dGlbOffMainThread(
      large,
      optionsForByteLength(large.byteLength),
      { executionBackend: "direct" },
    )).rejects.toMatchObject({
      code: "direct-input-too-large",
      selectedExecutionBackend: "direct",
      attemptedExecutionBackends: ["direct"],
    });
  });

  it("fails closed after Worker construction failure without running the direct backend", async () => {
    let constructions = 0;
    class ThrowingWorker {
      constructor() {
        constructions += 1;
        throw new Error("Worker construction blocked");
      }
    }
    vi.stubGlobal("Worker", ThrowingWorker);

    await expect(validateStudioBg3dGlbOffMainThread(
      new Uint8Array([1, 2, 3, 4]),
      OPTIONS,
    )).rejects.toMatchObject({
      code: "worker-failed",
      selectedExecutionBackend: "worker",
      attemptedExecutionBackends: ["worker"],
    });
    expect(constructions).toBe(1);

    await expect(validateStudioBg3dGlbOffMainThread(
      new Uint8Array([1, 2, 3, 4]),
      OPTIONS,
      { executionBackend: "direct" },
    )).resolves.toMatchObject({
      selectedExecutionBackend: "direct",
      attemptedExecutionBackends: ["direct"],
    });
    expect(constructions).toBe(1);
  });

  it("keeps selected Worker post and runtime failures terminal for their requests", async () => {
    let postConstructions = 0;
    class ThrowingPostWorker extends FakeWorker {
      constructor() {
        super();
        postConstructions += 1;
      }

      override postMessage(): void {
        throw new Error("post blocked");
      }
    }
    vi.stubGlobal("Worker", ThrowingPostWorker);
    await expect(validateStudioBg3dGlbOffMainThread(
      new Uint8Array([1, 2, 3, 4]),
      OPTIONS,
    )).rejects.toMatchObject({
      code: "worker-failed",
      selectedExecutionBackend: "worker",
      attemptedExecutionBackends: ["worker"],
    });
    expect(postConstructions).toBe(1);

    const runtimeWorkers: FakeWorker[] = [];
    class RuntimeFailureWorker extends FakeWorker {
      constructor() {
        super();
        runtimeWorkers.push(this);
      }
    }
    vi.stubGlobal("Worker", RuntimeFailureWorker);
    const runtimeFailure = validateStudioBg3dGlbOffMainThread(
      new Uint8Array([1, 2, 3, 4]),
      OPTIONS,
    );
    runtimeWorkers[0]?.emitError();
    await expect(runtimeFailure).rejects.toMatchObject({
      code: "worker-failed",
      selectedExecutionBackend: "worker",
      attemptedExecutionBackends: ["worker"],
    });
    expect(runtimeWorkers).toHaveLength(1);

    await expect(validateStudioBg3dGlbOffMainThread(
      new Uint8Array([1, 2, 3, 4]),
      OPTIONS,
      { executionBackend: "direct" },
    )).resolves.toMatchObject({
      selectedExecutionBackend: "direct",
      attemptedExecutionBackends: ["direct"],
    });
    expect(runtimeWorkers).toHaveLength(1);
  });

  it("rejects a main-realm Basis capability until the validation worker can self-attest", async () => {
    const workers: FakeWorker[] = [];
    class BrowserWorkerFake extends FakeWorker {
      constructor() {
        super();
        workers.push(this);
      }
    }
    vi.stubGlobal("Worker", BrowserWorkerFake);
    const outcome = validateStudioBg3dGlbOffMainThread(
      new Uint8Array([1, 2, 3, 4]),
      {
        ...OPTIONS,
        basisTranscoderCapability: Object.freeze({}) as StudioBg3dKtx2TranscoderCapability,
      },
    );

    await expect(outcome).rejects.toMatchObject({
      code: "basis-worker-attestation-required",
    });
    expect(workers).toHaveLength(0);

    await expect(validateStudioBg3dGlbOffMainThread(
      new Uint8Array([1, 2, 3, 4]),
      { ...OPTIONS, basisPayloadPreflight: async () => true },
    )).rejects.toMatchObject({ code: "basis-worker-attestation-required" });
    expect(workers).toHaveLength(0);

    await expect(validateStudioBg3dGlbOffMainThread(
      new Uint8Array([1, 2, 3, 4]),
      { ...OPTIONS, basisRuntimeProvider: async () => null },
    )).rejects.toMatchObject({ code: "basis-worker-attestation-required" });
    expect(workers).toHaveLength(0);
  });

  it("recreates the shared browser worker after a protocol failure", async () => {
    const workers: FakeWorker[] = [];
    class BrowserWorkerFake extends FakeWorker {
      constructor() {
        super();
        workers.push(this);
      }
    }
    vi.stubGlobal("Worker", BrowserWorkerFake);

    const failed = validateStudioBg3dGlbOffMainThread(new Uint8Array([1, 2, 3, 4]), OPTIONS);
    expect(workers).toHaveLength(1);
    workers[0]?.emitMessage({ requestId: 1, kind: "result" });
    await expect(failed).rejects.toMatchObject({ code: "protocol" });

    const recovered = validateStudioBg3dGlbOffMainThread(new Uint8Array([5, 6, 7, 8]), OPTIONS);
    expect(workers).toHaveLength(2);
    workers[1]?.emitMessage({
      version: STUDIO_BG3D_GLB_VALIDATION_WORKER_PROTOCOL_VERSION,
      kind: "result",
      requestId: 1,
      result: { ok: false, code: "invalid-magic", message: "recovered" },
    });
    await expect(recovered).resolves.toMatchObject({ execution: "worker" });
  });
});

describe("StudioBg3dValidationWorkerPool", () => {
  it("starts one worker lazily, expands only under contention, and reuses the idle slot", async () => {
    const workers: FakeWorker[] = [];
    const pool = new StudioBg3dValidationWorkerPool({
      workerFactory: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker;
      },
      maximumWorkers: 2,
    });

    expect(workers).toHaveLength(0);
    const first = pool.validate(new Uint8Array([1, 2, 3, 4]), OPTIONS);
    expect(workers).toHaveLength(1);
    const second = pool.validate(new Uint8Array([5, 6, 7, 8]), OPTIONS);
    expect(workers).toHaveLength(2);
    workers[1]?.emitMessage({
      version: STUDIO_BG3D_GLB_VALIDATION_WORKER_PROTOCOL_VERSION,
      kind: "result",
      requestId: 1,
      result: { ok: false, code: "invalid-magic", message: "second" },
    });
    await expect(second).resolves.toMatchObject({ execution: "worker" });

    const third = pool.validate(new Uint8Array([9, 10, 11, 12]), OPTIONS);
    expect(workers).toHaveLength(2);
    expect(workers[1]?.messages).toHaveLength(2);
    workers[1]?.emitMessage({
      version: STUDIO_BG3D_GLB_VALIDATION_WORKER_PROTOCOL_VERSION,
      kind: "result",
      requestId: 2,
      result: { ok: false, code: "invalid-magic", message: "third" },
    });
    await expect(third).resolves.toMatchObject({ execution: "worker" });
    workers[0]?.emitMessage({
      version: STUDIO_BG3D_GLB_VALIDATION_WORKER_PROTOCOL_VERSION,
      kind: "result",
      requestId: 1,
      result: { ok: false, code: "invalid-magic", message: "first" },
    });
    await expect(first).resolves.toMatchObject({ execution: "worker" });

    pool.dispose();
    expect(workers.every((worker) => worker.terminated)).toBe(true);
  });

  it("caps invalid maximums to one worker", () => {
    const workers: FakeWorker[] = [];
    const pool = new StudioBg3dValidationWorkerPool({
      workerFactory: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker;
      },
      maximumWorkers: Number.POSITIVE_INFINITY,
    });
    void pool.validate(new Uint8Array([1, 2, 3, 4]), OPTIONS).catch(() => undefined);
    void pool.validate(new Uint8Array([5, 6, 7, 8]), OPTIONS).catch(() => undefined);
    expect(workers).toHaveLength(1);
    pool.dispose();
  });
});
