import { afterEach, describe, expect, it, vi } from "vitest";

import { applyHealCloneDabsFromSeparateRegions } from "./studio-heal-clone";
import {
  disposeStudioHealCloneModuleWorker,
  runStudioHealCloneWorker,
  type StudioHealCloneWorkerLike,
} from "./studio-heal-clone-worker-client";
import {
  studioHealCloneSuccessTransfers,
  type StudioHealCloneWorkerResponseMessage,
  type StudioHealCloneWorkerRunMessage,
  type StudioHealCloneWorkerRunRequest,
  type StudioHealCloneWorkerSuccessMessage,
} from "./studio-heal-clone-worker-protocol";

import type { StudioImageDataLike } from "./studio-filters";

function image(width: number, height: number): StudioImageDataLike {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      data[offset] = (x * 17 + y * 3) % 256;
      data[offset + 1] = (x * 5 + y * 11) % 256;
      data[offset + 2] = (x * 7 + y * 13) % 256;
      data[offset + 3] = 255;
    }
  }
  return { data, width, height };
}

function cloneImage(source: StudioImageDataLike): StudioImageDataLike {
  return {
    data: new Uint8ClampedArray(source.data),
    width: source.width,
    height: source.height,
  };
}

function request(): StudioHealCloneWorkerRunRequest {
  const src = image(16, 12);
  return {
    src,
    dst: cloneImage(src),
    dabs: [
      { srcX: 12, srcY: 4, destX: 4, destY: 8 },
      { srcX: 11, srcY: 5, destX: 5, destY: 8 },
    ],
    radiusPx: 2.5,
    hardness: 0.6,
    opacity: 0.75,
    mode: "clone",
  };
}

function applyRequest(input: StudioHealCloneWorkerRunRequest): StudioImageDataLike {
  applyHealCloneDabsFromSeparateRegions(
    input.src,
    input.dst,
    input.dabs,
    input.radiusPx,
    input.hardness,
    input.opacity,
    input.mode,
  );
  return input.dst;
}

class ApplyingWorker implements StudioHealCloneWorkerLike {
  onmessage: StudioHealCloneWorkerLike["onmessage"] = null;
  onerror: StudioHealCloneWorkerLike["onerror"] = null;
  postCount = 0;
  terminateCount = 0;
  transferCount = 0;

  constructor() {
    queueMicrotask(() => this.onmessage?.({
      data: { type: "studio-heal-clone/ready", version: 1 },
    } as MessageEvent<StudioHealCloneWorkerResponseMessage>));
  }

  postMessage(message: StudioHealCloneWorkerRunMessage, transfer: Transferable[]): void {
    this.postCount += 1;
    this.transferCount = transfer.length;
    const received = structuredClone(message, { transfer });
    const response: StudioHealCloneWorkerSuccessMessage = {
      type: "studio-heal-clone/success",
      version: 1,
      dst: applyRequest(received.request),
    };
    const returned = structuredClone(response, {
      transfer: studioHealCloneSuccessTransfers(response),
    });
    this.onmessage?.({ data: returned } as MessageEvent<StudioHealCloneWorkerResponseMessage>);
  }

  terminate(): void {
    this.terminateCount += 1;
  }
}

class ControlledApplyingWorker implements StudioHealCloneWorkerLike {
  onmessage: StudioHealCloneWorkerLike["onmessage"] = null;
  onerror: StudioHealCloneWorkerLike["onerror"] = null;
  postCount = 0;
  terminateCount = 0;
  private readonly pending: StudioHealCloneWorkerRunMessage[] = [];

  constructor() {
    queueMicrotask(() => this.onmessage?.({
      data: { type: "studio-heal-clone/ready", version: 1 },
    } as MessageEvent<StudioHealCloneWorkerResponseMessage>));
  }

  postMessage(message: StudioHealCloneWorkerRunMessage, transfer: Transferable[]): void {
    this.postCount += 1;
    this.pending.push(structuredClone(message, { transfer }));
  }

  releaseNext(): void {
    const message = this.pending.shift();
    if (!message) throw new Error("pending heal/clone request expected");
    const response: StudioHealCloneWorkerSuccessMessage = {
      type: "studio-heal-clone/success",
      version: 1,
      dst: applyRequest(message.request),
    };
    const returned = structuredClone(response, {
      transfer: studioHealCloneSuccessTransfers(response),
    });
    this.onmessage?.({ data: returned } as MessageEvent<StudioHealCloneWorkerResponseMessage>);
  }

  terminate(): void {
    this.terminateCount += 1;
  }
}

class HangingWorker implements StudioHealCloneWorkerLike {
  onmessage: StudioHealCloneWorkerLike["onmessage"] = null;
  onerror: StudioHealCloneWorkerLike["onerror"] = null;
  postCount = 0;
  terminateCount = 0;

  constructor(ready = true) {
    if (ready) queueMicrotask(() => this.onmessage?.({
      data: { type: "studio-heal-clone/ready", version: 1 },
    } as MessageEvent<StudioHealCloneWorkerResponseMessage>));
  }

  postMessage(message: StudioHealCloneWorkerRunMessage, transfer: Transferable[]): void {
    void message;
    void transfer;
    this.postCount += 1;
  }

  terminate(): void {
    this.terminateCount += 1;
  }
}

class PostTransferThrowWorker extends HangingWorker {
  override postMessage(message: StudioHealCloneWorkerRunMessage, transfer: Transferable[]): void {
    this.postCount += 1;
    structuredClone(message, { transfer });
    throw new Error("heal/clone transport failed after ownership transfer");
  }
}

class PostTransferErrorWorker extends HangingWorker {
  override postMessage(message: StudioHealCloneWorkerRunMessage, transfer: Transferable[]): void {
    this.postCount += 1;
    structuredClone(message, { transfer });
    queueMicrotask(() => this.onerror?.({ message: "heal/clone worker crashed" }));
  }
}

class MalformedResultWorker extends HangingWorker {
  override postMessage(message: StudioHealCloneWorkerRunMessage, transfer: Transferable[]): void {
    this.postCount += 1;
    structuredClone(message, { transfer });
    this.onmessage?.({ data: {
      type: "studio-heal-clone/success",
      version: 1,
      dst: { data: new Uint8ClampedArray(4), width: 16, height: 12 },
    } } as MessageEvent<StudioHealCloneWorkerResponseMessage>);
  }
}

class FailureResultWorker extends HangingWorker {
  override postMessage(message: StudioHealCloneWorkerRunMessage, transfer: Transferable[]): void {
    this.postCount += 1;
    structuredClone(message, { transfer });
    this.onmessage?.({ data: {
      type: "studio-heal-clone/failure",
      version: 1,
      error: { name: "RangeError", message: "synthetic heal/clone failure" },
    } } as MessageEvent<StudioHealCloneWorkerResponseMessage>);
  }
}

afterEach(() => {
  disposeStudioHealCloneModuleWorker();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("runStudioHealCloneWorker", () => {
  it.each([
    ["null factory", null],
    ["throwing factory", () => { throw new Error("blocked by CSP"); }],
  ] as const)("%s is unavailable instead of direct execution", async (_label, workerFactory) => {
    const input = request();
    await expect(runStudioHealCloneWorker(input, { workerFactory })).rejects.toMatchObject({
      name: "StudioHealCloneWorkerUnavailableError",
    });
    expect(input.src.data.byteLength).toBe(input.src.width * input.src.height * 4);
    expect(input.dst.data.byteLength).toBe(input.dst.width * input.dst.height * 4);
  });

  it("기본 module Worker를 연속 stroke에서 재사용하고 dispose 시 한 번 종료한다", async () => {
    let worker: ApplyingWorker | null = null;
    const WorkerConstructor = vi.fn(function MockWorker() {
      worker = new ApplyingWorker();
      return worker;
    });
    vi.stubGlobal("Worker", WorkerConstructor);

    await expect(runStudioHealCloneWorker(request())).resolves.toMatchObject({ execution: "worker" });
    await expect(runStudioHealCloneWorker(request())).resolves.toMatchObject({ execution: "worker" });

    expect(WorkerConstructor).toHaveBeenCalledOnce();
    expect(worker!.postCount).toBe(2);
    expect(worker!.terminateCount).toBe(0);
    disposeStudioHealCloneModuleWorker();
    expect(worker!.terminateCount).toBe(1);
  });

  it("45초 idle 뒤 공유 Worker를 종료하고 다음 요청에서 새 Worker를 만든다", async () => {
    vi.useFakeTimers();
    const workers: ApplyingWorker[] = [];
    const WorkerConstructor = vi.fn(function MockWorker() {
      const worker = new ApplyingWorker();
      workers.push(worker);
      return worker;
    });
    vi.stubGlobal("Worker", WorkerConstructor);

    const first = runStudioHealCloneWorker(request());
    await vi.advanceTimersByTimeAsync(0);
    await expect(first).resolves.toMatchObject({ execution: "worker" });
    await vi.advanceTimersByTimeAsync(44_999);
    expect(workers[0]!.terminateCount).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(workers[0]!.terminateCount).toBe(1);

    const recovered = runStudioHealCloneWorker(request());
    await vi.advanceTimersByTimeAsync(0);
    await expect(recovered).resolves.toMatchObject({ execution: "worker" });
    expect(WorkerConstructor).toHaveBeenCalledTimes(2);
  });

  it("dispose는 active/queued 작업을 취소하고 예전 세대가 Worker를 되살리지 못하게 한다", async () => {
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

    const pending = runStudioHealCloneWorker(request(), {
      operationTimeoutMilliseconds: 120_000,
    });
    const queued = runStudioHealCloneWorker(request());
    await vi.advanceTimersByTimeAsync(0);
    expect(firstWorker!.postCount).toBe(1);
    const disposed = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    const queuedDisposed = expect(queued).rejects.toMatchObject({ name: "AbortError" });
    disposeStudioHealCloneModuleWorker();
    const recovered = runStudioHealCloneWorker(request());

    await disposed;
    await queuedDisposed;
    await vi.advanceTimersByTimeAsync(0);
    await expect(recovered).resolves.toMatchObject({ execution: "worker" });
    expect(firstWorker!.terminateCount).toBe(1);
    expect(WorkerConstructor).toHaveBeenCalledTimes(2);
    expect(recoveredWorker!.terminateCount).toBe(0);
  });

  it("기본 module Worker 큐는 동시 호출도 capacity 1로 직렬 실행한다", async () => {
    let worker: ControlledApplyingWorker | null = null;
    vi.stubGlobal("Worker", vi.fn(function MockWorker() {
      worker = new ControlledApplyingWorker();
      return worker;
    }));

    const first = runStudioHealCloneWorker(request());
    const second = runStudioHealCloneWorker(request());
    await vi.waitFor(() => expect(worker!.postCount).toBe(1));

    worker!.releaseNext();
    await expect(first).resolves.toMatchObject({ execution: "worker" });
    await vi.waitFor(() => expect(worker!.postCount).toBe(2));
    worker!.releaseNext();
    await expect(second).resolves.toMatchObject({ execution: "worker" });
    expect(worker!.terminateCount).toBe(0);
  });

  it("명시적 workerFactory는 기존 one-shot 수명과 direct parity를 유지한다", async () => {
    const input = request();
    const expected = applyRequest(structuredClone(input));
    const worker = new ApplyingWorker();

    const result = await runStudioHealCloneWorker(input, { workerFactory: () => worker });

    expect(result.execution).toBe("worker");
    expect(result.dst.data).toEqual(expected.data);
    expect(input.src.data.byteLength).toBe(0);
    expect(input.dst.data.byteLength).toBe(0);
    expect(worker.transferCount).toBe(2);
    expect(worker.terminateCount).toBe(1);
  });

  it("서로 다른 source/destination ROI 크기를 두 버퍼만 전송하고 heal direct/Worker parity를 유지한다", async () => {
    const input: StudioHealCloneWorkerRunRequest = {
      src: image(9, 7),
      dst: image(13, 9),
      dabs: [
        { srcX: 5.25, srcY: 3, destX: 7.25, destY: 4 },
        { srcX: 6, srcY: 3.5, destX: 8, destY: 4.5 },
      ],
      radiusPx: 2.25,
      hardness: 0.45,
      opacity: 0.8,
      mode: "heal",
    };
    const expected = applyRequest(structuredClone(input));
    const worker = new ApplyingWorker();

    const workerResult = await runStudioHealCloneWorker(input, { workerFactory: () => worker });
    const directResult = await runStudioHealCloneWorker({
      src: image(9, 7),
      dst: image(13, 9),
      dabs: [
        { srcX: 5.25, srcY: 3, destX: 7.25, destY: 4 },
        { srcX: 6, srcY: 3.5, destX: 8, destY: 4.5 },
      ],
      radiusPx: 2.25,
      hardness: 0.45,
      opacity: 0.8,
      mode: "heal",
    }, { executionMode: "direct" });

    expect(worker.transferCount).toBe(2);
    expect(workerResult.dst).toMatchObject({ width: 13, height: 9 });
    expect(workerResult.dst.data).toEqual(expected.data);
    expect(directResult.dst.data).toEqual(expected.data);
  });

  it("in-flight abort는 warm Worker를 폐기하고 다음 호출에서 새 epoch를 만든다", async () => {
    let firstWorker: HangingWorker | null = null;
    let secondWorker: ApplyingWorker | null = null;
    const WorkerConstructor = vi.fn(function MockWorker() {
      if (WorkerConstructor.mock.calls.length === 1) {
        firstWorker = new HangingWorker();
        return firstWorker;
      }
      secondWorker = new ApplyingWorker();
      return secondWorker;
    });
    vi.stubGlobal("Worker", WorkerConstructor);
    const controller = new AbortController();

    const pending = runStudioHealCloneWorker(request(), { signal: controller.signal });
    await vi.waitFor(() => expect(firstWorker!.postCount).toBe(1));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(firstWorker!.terminateCount).toBe(1);

    await expect(runStudioHealCloneWorker(request())).resolves.toMatchObject({ execution: "worker" });
    expect(WorkerConstructor).toHaveBeenCalledTimes(2);
    expect(secondWorker!.terminateCount).toBe(0);
  });

  it("ready timeout은 unavailable로 실패하고 다음 호출에서 새 Worker로 복구한다", async () => {
    vi.useFakeTimers();
    let firstWorker: HangingWorker | null = null;
    let secondWorker: ApplyingWorker | null = null;
    const WorkerConstructor = vi.fn(function MockWorker() {
      if (WorkerConstructor.mock.calls.length === 1) {
        firstWorker = new HangingWorker(false);
        return firstWorker;
      }
      secondWorker = new ApplyingWorker();
      return secondWorker;
    });
    vi.stubGlobal("Worker", WorkerConstructor);

    const pending = runStudioHealCloneWorker(request(), { readyTimeoutMilliseconds: 5 });
    const rejection = expect(pending).rejects.toMatchObject({
      name: "StudioHealCloneWorkerUnavailableError",
    });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(6);
    await rejection;
    expect(firstWorker!.terminateCount).toBe(1);

    const recovered = runStudioHealCloneWorker(request());
    await vi.advanceTimersByTimeAsync(0);
    await expect(recovered).resolves.toMatchObject({ execution: "worker" });
    expect(WorkerConstructor).toHaveBeenCalledTimes(2);
    expect(secondWorker!.terminateCount).toBe(0);
  });

  it("operation timeout은 warm Worker를 종료하고 다음 호출에서 새 Worker로 복구한다", async () => {
    vi.useFakeTimers();
    let firstWorker: HangingWorker | null = null;
    let secondWorker: ApplyingWorker | null = null;
    const WorkerConstructor = vi.fn(function MockWorker() {
      if (WorkerConstructor.mock.calls.length === 1) {
        firstWorker = new HangingWorker();
        return firstWorker;
      }
      secondWorker = new ApplyingWorker();
      return secondWorker;
    });
    vi.stubGlobal("Worker", WorkerConstructor);

    const pending = runStudioHealCloneWorker(request(), { operationTimeoutMilliseconds: 5 });
    await vi.advanceTimersByTimeAsync(0);
    const timedOut = expect(pending).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(6);
    await timedOut;
    expect(firstWorker!.terminateCount).toBe(1);

    const recovered = runStudioHealCloneWorker(request());
    await vi.advanceTimersByTimeAsync(0);
    await expect(recovered).resolves.toMatchObject({ execution: "worker" });
    expect(WorkerConstructor).toHaveBeenCalledTimes(2);
    expect(secondWorker!.terminateCount).toBe(0);
  });

  it.each([
    ["malformed result", () => new MalformedResultWorker()],
    ["structured failure", () => new FailureResultWorker()],
    ["post-transfer throw", () => new PostTransferThrowWorker()],
    ["post-transfer error", () => new PostTransferErrorWorker()],
  ] as const)("%s 뒤 warm Worker를 폐기하고 detached direct fallback 없이 복구한다", async (_label, makeBroken) => {
    let broken: HangingWorker | null = null;
    let recovered: ApplyingWorker | null = null;
    const WorkerConstructor = vi.fn(function MockWorker() {
      if (WorkerConstructor.mock.calls.length === 1) {
        broken = makeBroken();
        return broken;
      }
      recovered = new ApplyingWorker();
      return recovered;
    });
    vi.stubGlobal("Worker", WorkerConstructor);
    const input = request();
    const sourceData = input.src.data;

    await expect(runStudioHealCloneWorker(input)).rejects.toThrow();
    expect(sourceData.byteLength).toBe(0);
    expect(broken!.terminateCount).toBe(1);

    await expect(runStudioHealCloneWorker(request())).resolves.toMatchObject({ execution: "worker" });
    expect(WorkerConstructor).toHaveBeenCalledTimes(2);
    expect(recovered!.terminateCount).toBe(0);
  });

  it("부분/shared view를 복제해 무관한 backing buffer를 detach하지 않는다", async () => {
    const base = request();
    const pixels = base.src.data.byteLength;
    const backing = new ArrayBuffer(pixels * 2 + 24);
    const srcData = new Uint8ClampedArray(backing, 8, pixels);
    const dstData = new Uint8ClampedArray(backing, pixels + 16, pixels);
    srcData.set(base.src.data);
    dstData.set(base.dst.data);
    const sentinel = new Uint8Array(backing, 0, 4);
    sentinel.set([4, 3, 2, 1]);

    const result = await runStudioHealCloneWorker({
      ...base,
      src: { ...base.src, data: srcData },
      dst: { ...base.dst, data: dstData },
    }, { workerFactory: () => new ApplyingWorker() });

    expect(result.execution).toBe("worker");
    expect(backing.byteLength).toBe(pixels * 2 + 24);
    expect(Array.from(sentinel)).toEqual([4, 3, 2, 1]);
  });

  it("잘못된 요청은 Worker 생성 전에 거부한다", async () => {
    const factory = vi.fn(() => new ApplyingWorker());
    const invalid = request();
    invalid.dst.data = new Uint8ClampedArray(4);

    await expect(runStudioHealCloneWorker(invalid, { workerFactory: factory })).rejects.toThrow(
      /버퍼 길이/u,
    );
    expect(factory).not.toHaveBeenCalled();
  });
});
