import { afterEach, describe, expect, it, vi } from "vitest";

import {
  disposeStudioRetouchModuleWorker,
  runStudioRetouchWorker,
  type StudioRetouchWorkerLike,
} from "./studio-retouch-worker-client";
import {
  STUDIO_RETOUCH_DIRECT_MAX_IMAGE_PIXELS,
  studioRetouchSuccessTransfers,
  type StudioRetouchWorkerResponseMessage,
  type StudioRetouchWorkerRunMessage,
  type StudioRetouchWorkerRunRequest,
  type StudioRetouchWorkerSuccessMessage,
} from "./studio-retouch-worker-protocol";
import { applyStudioRetouchWorkerRequest } from "./studio-retouch-worker-runtime";

afterEach(() => {
  disposeStudioRetouchModuleWorker();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function request(kind: "dodge-burn" | "wet-mix" = "dodge-burn"): StudioRetouchWorkerRunRequest {
  const data = new Uint8ClampedArray(8 * 8 * 4);
  data.fill(128);
  for (let offset = 3; offset < data.length; offset += 4) data[offset] = 255;
  const common = { data, w: 8, h: 8, points: [{ x: 4, y: 4 }] };
  return kind === "dodge-burn"
    ? {
        kind,
        ...common,
        settings: {
          radiusPx: 3,
          hardness: 0.5,
          exposure: 50,
          mode: "dodge",
          range: "midtones",
          sponge: "saturate",
        },
      }
    : {
        kind,
        ...common,
        settings: {
          radiusPx: 3,
          hardness: 0.5,
          strength: 0.6,
          wetness: 0.5,
          pickup: 0.4,
          paintColor: { r: 20, g: 80, b: 220 },
        },
      };
}

class ApplyingWorker implements StudioRetouchWorkerLike {
  onmessage: StudioRetouchWorkerLike["onmessage"] = null;
  onerror: StudioRetouchWorkerLike["onerror"] = null;
  terminateCount = 0;
  postCount = 0;
  transferCount = 0;

  constructor() {
    queueMicrotask(() => this.onmessage?.({
      data: { type: "studio-retouch/ready", version: 1 },
    } as MessageEvent<StudioRetouchWorkerResponseMessage>));
  }

  postMessage(message: StudioRetouchWorkerRunMessage, transfer: Transferable[]): void {
    this.postCount += 1;
    this.transferCount = transfer.length;
    const received = structuredClone(message, { transfer });
    const result = applyStudioRetouchWorkerRequest(received.request);
    const response: StudioRetouchWorkerSuccessMessage = {
      type: "studio-retouch/success",
      version: 1,
      ...result,
    };
    const returned = structuredClone(response, {
      transfer: studioRetouchSuccessTransfers(response),
    });
    this.onmessage?.({ data: returned } as MessageEvent<StudioRetouchWorkerResponseMessage>);
  }

  terminate(): void {
    this.terminateCount += 1;
  }
}

class HangingWorker implements StudioRetouchWorkerLike {
  onmessage: StudioRetouchWorkerLike["onmessage"] = null;
  onerror: StudioRetouchWorkerLike["onerror"] = null;
  postCount = 0;
  terminateCount = 0;

  constructor(ready = true) {
    if (ready) queueMicrotask(() => this.onmessage?.({
      data: { type: "studio-retouch/ready", version: 1 },
    } as MessageEvent<StudioRetouchWorkerResponseMessage>));
  }

  postMessage(message?: unknown, transfer?: unknown): void {
    void message;
    void transfer;
    this.postCount += 1;
  }
  terminate(): void {
    this.terminateCount += 1;
  }
}

class LoadErrorWorker extends HangingWorker {
  constructor() {
    super(false);
    queueMicrotask(() => this.onerror?.({ message: "worker module failed" }));
  }
}

class ThrowingPostWorker extends HangingWorker {
  override postMessage(): void {
    throw new DOMException("blocked", "DataCloneError");
  }
}

class PostTransferThrowWorker extends HangingWorker {
  override postMessage(message: StudioRetouchWorkerRunMessage, transfer: Transferable[]): void {
    structuredClone(message, { transfer });
    throw new Error("worker transport threw after ownership transfer");
  }
}

class PostTransferFailureWorker extends HangingWorker {
  override postMessage(message: StudioRetouchWorkerRunMessage, transfer: Transferable[]): void {
    structuredClone(message, { transfer });
    queueMicrotask(() => this.onerror?.({ message: "worker crashed after ownership transfer" }));
  }
}

class MalformedFailureWorker extends HangingWorker {
  override postMessage(): void {
    this.onmessage?.({
      data: { type: "studio-retouch/failure", version: 1 },
    } as unknown as MessageEvent<StudioRetouchWorkerResponseMessage>);
  }
}

describe("runStudioRetouchWorker", () => {
  it("reuses one warm default module Worker across sequential retouch strokes", async () => {
    let worker: ApplyingWorker | null = null;
    const WorkerConstructor = vi.fn(function MockWorker() {
      worker = new ApplyingWorker();
      return worker;
    });
    vi.stubGlobal("Worker", WorkerConstructor);

    await expect(runStudioRetouchWorker(request("dodge-burn"))).resolves.toMatchObject({
      execution: "worker",
      kind: "dodge-burn",
    });
    await expect(runStudioRetouchWorker(request("wet-mix"))).resolves.toMatchObject({
      execution: "worker",
      kind: "wet-mix",
    });

    expect(WorkerConstructor).toHaveBeenCalledOnce();
    expect(worker!.postCount).toBe(2);
    expect(worker!.terminateCount).toBe(0);
    disposeStudioRetouchModuleWorker();
    expect(worker!.terminateCount).toBe(1);
  });

  it("disposes an idle shared Worker after 45 seconds and recreates it on demand", async () => {
    vi.useFakeTimers();
    const workers: ApplyingWorker[] = [];
    const WorkerConstructor = vi.fn(function MockWorker() {
      const worker = new ApplyingWorker();
      workers.push(worker);
      return worker;
    });
    vi.stubGlobal("Worker", WorkerConstructor);

    const first = runStudioRetouchWorker(request());
    await vi.advanceTimersByTimeAsync(0);
    await expect(first).resolves.toMatchObject({ execution: "worker" });
    await vi.advanceTimersByTimeAsync(44_999);
    expect(workers[0]!.terminateCount).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(workers[0]!.terminateCount).toBe(1);

    const recovered = runStudioRetouchWorker(request("wet-mix"));
    await vi.advanceTimersByTimeAsync(0);
    await expect(recovered).resolves.toMatchObject({ execution: "worker", kind: "wet-mix" });
    expect(WorkerConstructor).toHaveBeenCalledTimes(2);
  });

  it("dispose aborts active and queued work without resurrecting the old generation", async () => {
    vi.useFakeTimers();
    let firstWorker: HangingWorker | null = null;
    let recoveredWorker: ApplyingWorker | null = null;
    const WorkerConstructor = vi.fn(function MockWorker() {
      if (WorkerConstructor.mock.calls.length === 1) {
        firstWorker = new HangingWorker();
        return firstWorker;
      }
      recoveredWorker = new ApplyingWorker();
      return recoveredWorker;
    });
    vi.stubGlobal("Worker", WorkerConstructor);

    const pending = runStudioRetouchWorker(request(), { operationTimeoutMilliseconds: 120_000 });
    const queued = runStudioRetouchWorker(request("wet-mix"));
    await vi.advanceTimersByTimeAsync(0);
    expect(firstWorker!.postCount).toBe(1);
    const disposed = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    const queuedDisposed = expect(queued).rejects.toMatchObject({ name: "AbortError" });
    disposeStudioRetouchModuleWorker();
    const recovered = runStudioRetouchWorker(request("wet-mix"));

    await disposed;
    await queuedDisposed;
    await vi.advanceTimersByTimeAsync(0);
    await expect(recovered).resolves.toMatchObject({ execution: "worker", kind: "wet-mix" });
    expect(firstWorker!.terminateCount).toBe(1);
    expect(WorkerConstructor).toHaveBeenCalledTimes(2);
    expect(recoveredWorker!.terminateCount).toBe(0);
  });

  it("rejects a malformed failure payload and recreates the warm Worker", async () => {
    let broken: MalformedFailureWorker | null = null;
    let recovered: ApplyingWorker | null = null;
    const WorkerConstructor = vi.fn(function MockWorker() {
      if (WorkerConstructor.mock.calls.length === 1) {
        broken = new MalformedFailureWorker();
        return broken;
      }
      recovered = new ApplyingWorker();
      return recovered;
    });
    vi.stubGlobal("Worker", WorkerConstructor);

    await expect(runStudioRetouchWorker(request())).rejects.toThrow(/알 수 없는 응답/u);
    expect(broken!.terminateCount).toBe(1);
    await expect(runStudioRetouchWorker(request())).resolves.toMatchObject({ execution: "worker" });
    expect(WorkerConstructor).toHaveBeenCalledTimes(2);
    expect(recovered!.terminateCount).toBe(0);
  });

  it.each(["dodge-burn", "wet-mix"] as const)(
    "runs %s in one fresh-buffer Worker flight with exact direct parity",
    async (kind) => {
      const input = request(kind);
      const expectedRequest = structuredClone(input);
      const expected = applyStudioRetouchWorkerRequest(expectedRequest).data;
      const inputData = input.data;
      const worker = new ApplyingWorker();

      const result = await runStudioRetouchWorker(input, { workerFactory: () => worker });

      expect(result.execution).toBe("worker");
      expect(result.kind).toBe(kind);
      expect(result.data).toEqual(expected);
      expect(result.data === inputData).toBe(false);
      expect(inputData.byteLength).toBe(0);
      expect(worker.postCount).toBe(1);
      expect(worker.transferCount).toBe(1);
      expect(worker.terminateCount).toBe(1);
    },
  );

  it("clones partial views before transfer and leaves unrelated backing bytes attached", async () => {
    const base = request();
    const backing = new ArrayBuffer(base.data.byteLength + 16);
    const view = new Uint8ClampedArray(backing, 8, base.data.byteLength);
    view.set(base.data);
    const sentinel = new Uint8Array(backing, 0, 4);
    sentinel.set([4, 3, 2, 1]);

    const result = await runStudioRetouchWorker(
      { ...base, data: view },
      { workerFactory: () => new ApplyingWorker() },
    );

    expect(result.execution).toBe("worker");
    expect(backing.byteLength).toBe(base.data.byteLength + 16);
    expect(Array.from(sentinel)).toEqual([4, 3, 2, 1]);
  });

  it("rejects unavailable and pre-ready load failures without direct execution", async () => {
    for (const workerFactory of [
      null,
      () => { throw new Error("blocked by CSP"); },
      () => new LoadErrorWorker(),
    ] as const) {
      const input = request();
      const inputData = input.data;
      await expect(runStudioRetouchWorker(input, { workerFactory })).rejects.toMatchObject({
        name: "StudioRetouchWorkerUnavailableError",
      });
      expect(inputData.byteLength).toBe(8 * 8 * 4);
    }
  });

  it("rejects a synchronous post failure at the ownership boundary", async () => {
    const input = request();
    const data = input.data;
    await expect(runStudioRetouchWorker(input, {
      workerFactory: () => new ThrowingPostWorker(),
    })).rejects.toMatchObject({ name: "DataCloneError" });
    expect(data.byteLength).toBe(8 * 8 * 4);
  });

  it("keeps external abort classified separately from a recoverable operation timeout", async () => {
    const abortWorker = new HangingWorker();
    const controller = new AbortController();
    const aborted = runStudioRetouchWorker(request(), {
      signal: controller.signal,
      workerFactory: () => abortWorker,
    });
    const abortExpectation = expect(aborted).rejects.toMatchObject({ name: "AbortError" });
    await Promise.resolve();
    controller.abort();
    await abortExpectation;
    expect(abortWorker.terminateCount).toBe(1);

    vi.useFakeTimers();
    try {
      let timeoutWorker: HangingWorker | null = null;
      let recoveredWorker: ApplyingWorker | null = null;
      const WorkerConstructor = vi.fn(function MockWorker() {
        if (WorkerConstructor.mock.calls.length === 1) {
          timeoutWorker = new HangingWorker();
          return timeoutWorker;
        }
        recoveredWorker = new ApplyingWorker();
        return recoveredWorker;
      });
      vi.stubGlobal("Worker", WorkerConstructor);
      const timedOut = runStudioRetouchWorker(request(), {
        operationTimeoutMilliseconds: 5,
      });
      const timeoutExpectation = expect(timedOut).rejects.toMatchObject({ name: "TimeoutError" });
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(6);
      await timeoutExpectation;
      expect(timeoutWorker!.terminateCount).toBe(1);

      const recovered = runStudioRetouchWorker(request("wet-mix"));
      await vi.advanceTimersByTimeAsync(0);
      await expect(recovered).resolves.toMatchObject({ execution: "worker", kind: "wet-mix" });
      expect(WorkerConstructor).toHaveBeenCalledTimes(2);
      expect(recoveredWorker!.terminateCount).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails closed after ownership transfer instead of running a detached direct fallback", async () => {
    for (const workerFactory of [
      () => new PostTransferThrowWorker(),
      () => new PostTransferFailureWorker(),
    ]) {
      const input = request();
      const data = input.data;
      await expect(runStudioRetouchWorker(input, { workerFactory })).rejects.toThrow(
        /ownership transfer/u,
      );
      expect(data.byteLength).toBe(0);
    }
  });

  it("blocks an oversized explicit direct mode before a main-thread pixel loop can start", async () => {
    const pixels = STUDIO_RETOUCH_DIRECT_MAX_IMAGE_PIXELS + 1;
    const base = request();
    await expect(runStudioRetouchWorker({
      ...base,
      data: new Uint8ClampedArray(pixels * 4),
      w: pixels,
      h: 1,
    }, { executionMode: "direct" })).rejects.toThrow(/직접 계산 안전 상한/u);
  });
});
