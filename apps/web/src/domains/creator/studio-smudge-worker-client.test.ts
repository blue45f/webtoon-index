import { afterEach, describe, expect, it, vi } from "vitest";

import { smudgeStroke } from "./studio-smudge";
import {
  disposeStudioSmudgeModuleWorker,
  runStudioSmudgeWorker,
  type StudioSmudgeWorkerLike,
} from "./studio-smudge-worker-client";
import {
  studioSmudgeSuccessTransfers,
  type StudioSmudgeWorkerResponseMessage,
  type StudioSmudgeWorkerRunMessage,
  type StudioSmudgeWorkerRunRequest,
  type StudioSmudgeWorkerSuccessMessage,
} from "./studio-smudge-worker-protocol";

function request(): StudioSmudgeWorkerRunRequest {
  const data = new Uint8ClampedArray(12 * 10 * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = (offset * 7) % 256;
    data[offset + 1] = (offset * 11) % 256;
    data[offset + 2] = (offset * 13) % 256;
    data[offset + 3] = 255;
  }
  return {
    data,
    w: 12,
    h: 10,
    points: [{ x: 3, y: 4 }, { x: 8, y: 6 }],
    radiusPx: 3,
    strength: 0.55,
  };
}

class ApplyingWorker implements StudioSmudgeWorkerLike {
  onmessage: StudioSmudgeWorkerLike["onmessage"] = null;
  onerror: StudioSmudgeWorkerLike["onerror"] = null;
  postCount = 0;
  terminateCount = 0;

  constructor() {
    queueMicrotask(() => this.onmessage?.({
      data: { type: "studio-smudge/ready", version: 1 },
    } as MessageEvent<StudioSmudgeWorkerResponseMessage>));
  }

  postMessage(message: StudioSmudgeWorkerRunMessage, transfer: Transferable[]): void {
    this.postCount += 1;
    const received = structuredClone(message, { transfer });
    const { data, w, h, points, radiusPx, strength } = received.request;
    const response: StudioSmudgeWorkerSuccessMessage = {
      type: "studio-smudge/success",
      version: 1,
      data: smudgeStroke(data, w, h, points, radiusPx, strength),
    };
    const returned = structuredClone(response, {
      transfer: studioSmudgeSuccessTransfers(response),
    });
    this.onmessage?.({ data: returned } as MessageEvent<StudioSmudgeWorkerResponseMessage>);
  }

  terminate(): void {
    this.terminateCount += 1;
  }
}

class HangingWorker implements StudioSmudgeWorkerLike {
  onmessage: StudioSmudgeWorkerLike["onmessage"] = null;
  onerror: StudioSmudgeWorkerLike["onerror"] = null;
  postCount = 0;
  terminateCount = 0;

  constructor() {
    queueMicrotask(() => this.onmessage?.({
      data: { type: "studio-smudge/ready", version: 1 },
    } as MessageEvent<StudioSmudgeWorkerResponseMessage>));
  }

  postMessage(): void {
    this.postCount += 1;
  }

  terminate(): void {
    this.terminateCount += 1;
  }
}

class MalformedFailureWorker extends HangingWorker {
  override postMessage(): void {
    this.onmessage?.({
      data: { type: "studio-smudge/failure", version: 1 },
    } as unknown as MessageEvent<StudioSmudgeWorkerResponseMessage>);
  }
}

afterEach(() => {
  disposeStudioSmudgeModuleWorker();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("runStudioSmudgeWorker", () => {
  it("runs direct only when explicitly selected and rejects an unavailable Worker", async () => {
    const directInput = request();
    const expectedInput = structuredClone(directInput);
    const expected = smudgeStroke(
      expectedInput.data,
      expectedInput.w,
      expectedInput.h,
      expectedInput.points,
      expectedInput.radiusPx,
      expectedInput.strength,
    );
    await expect(runStudioSmudgeWorker(directInput, {
      executionMode: "direct",
    })).resolves.toEqual({ execution: "direct", data: expected });

    const workerInput = request();
    await expect(runStudioSmudgeWorker(workerInput, {
      workerFactory: null,
    })).rejects.toMatchObject({ name: "StudioSmudgeWorkerUnavailableError" });
    expect(workerInput.data.byteLength).toBe(workerInput.w * workerInput.h * 4);
  });

  it("keeps exact direct/worker parity and terminates an explicit one-shot Worker", async () => {
    const input = request();
    const expectedInput = structuredClone(input);
    const expected = smudgeStroke(
      expectedInput.data,
      expectedInput.w,
      expectedInput.h,
      expectedInput.points,
      expectedInput.radiusPx,
      expectedInput.strength,
    );
    const worker = new ApplyingWorker();

    const result = await runStudioSmudgeWorker(input, { workerFactory: () => worker });

    expect(result.execution).toBe("worker");
    expect(result.data).toEqual(expected);
    expect(input.data.byteLength).toBe(0);
    expect(worker.postCount).toBe(1);
    expect(worker.terminateCount).toBe(1);
  });

  it("reuses one warm default module Worker across sequential strokes", async () => {
    let worker: ApplyingWorker | null = null;
    const WorkerConstructor = vi.fn(function MockWorker() {
      worker = new ApplyingWorker();
      return worker;
    });
    vi.stubGlobal("Worker", WorkerConstructor);

    await expect(runStudioSmudgeWorker(request())).resolves.toMatchObject({ execution: "worker" });
    await expect(runStudioSmudgeWorker(request())).resolves.toMatchObject({ execution: "worker" });

    expect(WorkerConstructor).toHaveBeenCalledOnce();
    expect(worker!.postCount).toBe(2);
    expect(worker!.terminateCount).toBe(0);
    disposeStudioSmudgeModuleWorker();
    expect(worker!.terminateCount).toBe(1);
  });

  it("disposes an idle shared Worker after 45 seconds and recreates it on the next request", async () => {
    vi.useFakeTimers();
    const workers: ApplyingWorker[] = [];
    const WorkerConstructor = vi.fn(function MockWorker() {
      const worker = new ApplyingWorker();
      workers.push(worker);
      return worker;
    });
    vi.stubGlobal("Worker", WorkerConstructor);

    const first = runStudioSmudgeWorker(request());
    await vi.advanceTimersByTimeAsync(0);
    await expect(first).resolves.toMatchObject({ execution: "worker" });
    await vi.advanceTimersByTimeAsync(44_999);
    expect(workers[0]!.terminateCount).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(workers[0]!.terminateCount).toBe(1);

    const recovered = runStudioSmudgeWorker(request());
    await vi.advanceTimersByTimeAsync(0);
    await expect(recovered).resolves.toMatchObject({ execution: "worker" });
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

    const pending = runStudioSmudgeWorker(request(), { operationTimeoutMilliseconds: 120_000 });
    const queued = runStudioSmudgeWorker(request());
    await vi.advanceTimersByTimeAsync(0);
    expect(firstWorker!.postCount).toBe(1);
    const disposed = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    const queuedDisposed = expect(queued).rejects.toMatchObject({ name: "AbortError" });
    disposeStudioSmudgeModuleWorker();
    const recovered = runStudioSmudgeWorker(request());

    await disposed;
    await queuedDisposed;
    await vi.advanceTimersByTimeAsync(0);
    await expect(recovered).resolves.toMatchObject({ execution: "worker" });
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

    await expect(runStudioSmudgeWorker(request())).rejects.toThrow(/알 수 없는 응답/u);
    expect(broken!.terminateCount).toBe(1);
    await expect(runStudioSmudgeWorker(request())).resolves.toMatchObject({ execution: "worker" });
    expect(WorkerConstructor).toHaveBeenCalledTimes(2);
    expect(recovered!.terminateCount).toBe(0);
  });

  it("keeps unrelated bytes attached when transferring a partial view", async () => {
    const base = request();
    const backing = new ArrayBuffer(base.data.byteLength + 16);
    const view = new Uint8ClampedArray(backing, 8, base.data.byteLength);
    view.set(base.data);
    new Uint8Array(backing, 0, 4).set([9, 8, 7, 6]);

    await runStudioSmudgeWorker(
      { ...base, data: view },
      { workerFactory: () => new ApplyingWorker() },
    );

    expect(backing.byteLength).toBe(base.data.byteLength + 16);
    expect(Array.from(new Uint8Array(backing, 0, 4))).toEqual([9, 8, 7, 6]);
  });

  it("keeps abort classified separately from timeout and recovers after timeout", async () => {
    const abortWorker = new HangingWorker();
    const controller = new AbortController();
    const pending = runStudioSmudgeWorker(request(), {
      signal: controller.signal,
      workerFactory: () => abortWorker,
    });
    const aborted = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await Promise.resolve();
    controller.abort();
    await aborted;
    expect(abortWorker.terminateCount).toBe(1);

    vi.useFakeTimers();
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
    const timedOut = runStudioSmudgeWorker(request(), {
      operationTimeoutMilliseconds: 5,
    });
    const timedOutExpectation = expect(timedOut).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(6);
    await timedOutExpectation;
    expect(timeoutWorker!.terminateCount).toBe(1);

    const recovered = runStudioSmudgeWorker(request());
    await vi.advanceTimersByTimeAsync(0);
    await expect(recovered).resolves.toMatchObject({ execution: "worker" });
    expect(WorkerConstructor).toHaveBeenCalledTimes(2);
    expect(recoveredWorker!.terminateCount).toBe(0);
  });
});
