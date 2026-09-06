import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyLiquifyDisplacement,
  buildLiquifyDisplacementField,
  type LiquifyDisplacementField,
} from "./studio-liquify";
import {
  disposeStudioLiquifyModuleWorker,
  runStudioLiquifyWorker,
  type StudioLiquifyWorkerLike,
} from "./studio-liquify-worker-client";
import {
  studioLiquifySuccessTransfers,
  type StudioLiquifyWorkerResponseMessage,
  type StudioLiquifyWorkerRunMessage,
  type StudioLiquifyWorkerRunRequest,
  type StudioLiquifyWorkerSuccessMessage,
} from "./studio-liquify-worker-protocol";

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
  return { data: new Uint8ClampedArray(source.data), width: source.width, height: source.height };
}

function fieldFixture(): LiquifyDisplacementField {
  return {
    originX: 1,
    originY: 1,
    width: 2,
    height: 2,
    dx: new Float32Array([0, 0.5, 1, 0]),
    dy: new Float32Array([0, 0, 0.5, 0]),
  };
}

function fieldRequest(): StudioLiquifyWorkerRunRequest {
  const src = image(4, 4);
  return { src, dst: cloneImage(src), field: fieldFixture() };
}

class ApplyingWorker implements StudioLiquifyWorkerLike {
  onmessage: StudioLiquifyWorkerLike["onmessage"] = null;
  onerror: StudioLiquifyWorkerLike["onerror"] = null;
  terminateCount = 0;
  postCount = 0;
  transferCount = 0;

  constructor() {
    queueMicrotask(() => this.onmessage?.({
      data: { type: "studio-liquify/ready", version: 1 },
    } as MessageEvent<StudioLiquifyWorkerResponseMessage>));
  }

  postMessage(message: StudioLiquifyWorkerRunMessage, transfer: Transferable[]): void {
    this.postCount += 1;
    this.transferCount = transfer.length;
    const received = structuredClone(message, { transfer });
    const field = "stroke" in received.request
      ? buildLiquifyDisplacementField(
          received.request.stroke.points,
          received.request.stroke.radiusPx,
          received.request.stroke.strength,
          received.request.region?.canvasWidth ?? received.request.src.width,
          received.request.region?.canvasHeight ?? received.request.src.height,
          received.request.stroke.options,
        )
      : received.request.field;
    if (field) applyLiquifyDisplacement(received.request.src, received.request.dst, field, {
      ...(received.request.region === undefined ? {} : { region: received.request.region }),
    });
    const response: StudioLiquifyWorkerSuccessMessage = {
      type: "studio-liquify/success",
      version: 1,
      applied: field !== null,
      dst: received.request.dst,
    };
    const returned = structuredClone(response, { transfer: studioLiquifySuccessTransfers(response) });
    this.onmessage?.({ data: returned } as MessageEvent<StudioLiquifyWorkerResponseMessage>);
  }

  terminate(): void {
    this.terminateCount += 1;
  }
}

class ControlledApplyingWorker implements StudioLiquifyWorkerLike {
  onmessage: StudioLiquifyWorkerLike["onmessage"] = null;
  onerror: StudioLiquifyWorkerLike["onerror"] = null;
  postCount = 0;
  terminateCount = 0;
  private readonly pending: StudioLiquifyWorkerRunMessage[] = [];

  constructor() {
    queueMicrotask(() => this.onmessage?.({
      data: { type: "studio-liquify/ready", version: 1 },
    } as MessageEvent<StudioLiquifyWorkerResponseMessage>));
  }

  postMessage(message: StudioLiquifyWorkerRunMessage, transfer: Transferable[]): void {
    this.postCount += 1;
    this.pending.push(structuredClone(message, { transfer }));
  }

  releaseNext(): void {
    const message = this.pending.shift();
    if (!message) throw new Error("pending liquify request expected");
    const field = "stroke" in message.request
      ? buildLiquifyDisplacementField(
          message.request.stroke.points,
          message.request.stroke.radiusPx,
          message.request.stroke.strength,
          message.request.region?.canvasWidth ?? message.request.src.width,
          message.request.region?.canvasHeight ?? message.request.src.height,
          message.request.stroke.options,
        )
      : message.request.field;
    if (field) applyLiquifyDisplacement(message.request.src, message.request.dst, field, {
      ...(message.request.region === undefined ? {} : { region: message.request.region }),
    });
    const response: StudioLiquifyWorkerSuccessMessage = {
      type: "studio-liquify/success",
      version: 1,
      applied: field !== null,
      dst: message.request.dst,
    };
    const returned = structuredClone(response, { transfer: studioLiquifySuccessTransfers(response) });
    this.onmessage?.({ data: returned } as MessageEvent<StudioLiquifyWorkerResponseMessage>);
  }

  terminate(): void {
    this.terminateCount += 1;
  }
}

class HangingWorker implements StudioLiquifyWorkerLike {
  onmessage: StudioLiquifyWorkerLike["onmessage"] = null;
  onerror: StudioLiquifyWorkerLike["onerror"] = null;
  postCount = 0;
  terminateCount = 0;

  constructor(ready = true) {
    if (ready) queueMicrotask(() => this.onmessage?.({
      data: { type: "studio-liquify/ready", version: 1 },
    } as MessageEvent<StudioLiquifyWorkerResponseMessage>));
  }

  postMessage(message: StudioLiquifyWorkerRunMessage, transfer: Transferable[]): void {
    void message;
    void transfer;
    this.postCount += 1;
  }

  terminate(): void {
    this.terminateCount += 1;
  }
}

class PostTransferThrowWorker extends HangingWorker {
  override postMessage(message: StudioLiquifyWorkerRunMessage, transfer: Transferable[]): void {
    this.postCount += 1;
    structuredClone(message, { transfer });
    throw new Error("liquify transport failed after ownership transfer");
  }
}

class PostTransferErrorWorker extends HangingWorker {
  override postMessage(message: StudioLiquifyWorkerRunMessage, transfer: Transferable[]): void {
    this.postCount += 1;
    structuredClone(message, { transfer });
    queueMicrotask(() => this.onerror?.({ message: "liquify worker crashed" }));
  }
}

class InvalidResultWorker extends ApplyingWorker {
  override postMessage(): void {
    this.onmessage?.({
      data: {
        type: "studio-liquify/success",
        version: 1,
        applied: true,
        dst: { data: new Uint8ClampedArray(4), width: 4, height: 4 },
      },
    } as MessageEvent<StudioLiquifyWorkerResponseMessage>);
  }
}

class MalformedFailureWorker extends HangingWorker {
  override postMessage(): void {
    this.postCount += 1;
    this.onmessage?.({
      data: { type: "studio-liquify/failure", version: 1 },
    } as unknown as MessageEvent<StudioLiquifyWorkerResponseMessage>);
  }
}

afterEach(() => {
  disposeStudioLiquifyModuleWorker();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("runStudioLiquifyWorker", () => {
  it.each([
    ["null factory", null],
    ["throwing factory", () => { throw new Error("blocked by CSP"); }],
  ] as const)("%s is unavailable instead of direct execution", async (_label, workerFactory) => {
    const input = fieldRequest();
    await expect(runStudioLiquifyWorker(input, { workerFactory })).rejects.toMatchObject({
      name: "StudioLiquifyWorkerUnavailableError",
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

    await expect(runStudioLiquifyWorker(fieldRequest())).resolves.toMatchObject({ execution: "worker" });
    await expect(runStudioLiquifyWorker(fieldRequest())).resolves.toMatchObject({ execution: "worker" });

    expect(WorkerConstructor).toHaveBeenCalledOnce();
    // Worker는 ready를 생성 시 한 번만 보내므로 두 번째 post 성공 자체가 ready 재대기 부재를 증명한다.
    expect(worker!.postCount).toBe(2);
    expect(worker!.terminateCount).toBe(0);
    disposeStudioLiquifyModuleWorker();
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

    const first = runStudioLiquifyWorker(fieldRequest());
    await vi.advanceTimersByTimeAsync(0);
    await expect(first).resolves.toMatchObject({ execution: "worker" });
    await vi.advanceTimersByTimeAsync(44_999);
    expect(workers[0]!.terminateCount).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(workers[0]!.terminateCount).toBe(1);

    const recovered = runStudioLiquifyWorker(fieldRequest());
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

    const pending = runStudioLiquifyWorker(fieldRequest(), {
      operationTimeoutMilliseconds: 120_000,
    });
    const queued = runStudioLiquifyWorker(fieldRequest());
    await vi.advanceTimersByTimeAsync(0);
    expect(firstWorker!.postCount).toBe(1);
    const disposed = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    const queuedDisposed = expect(queued).rejects.toMatchObject({ name: "AbortError" });
    disposeStudioLiquifyModuleWorker();
    const recovered = runStudioLiquifyWorker(fieldRequest());

    await disposed;
    await queuedDisposed;
    await vi.advanceTimersByTimeAsync(0);
    await expect(recovered).resolves.toMatchObject({ execution: "worker" });
    expect(firstWorker!.terminateCount).toBe(1);
    expect(WorkerConstructor).toHaveBeenCalledTimes(2);
    expect(recoveredWorker!.terminateCount).toBe(0);
  });

  it("잘못된 failure payload를 거부하고 다음 호출에서 새 warm Worker로 복구한다", async () => {
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

    await expect(runStudioLiquifyWorker(fieldRequest())).rejects.toThrow(/알 수 없는 응답/u);
    expect(broken!.terminateCount).toBe(1);
    await expect(runStudioLiquifyWorker(fieldRequest())).resolves.toMatchObject({ execution: "worker" });
    expect(WorkerConstructor).toHaveBeenCalledTimes(2);
    expect(recovered!.terminateCount).toBe(0);
  });

  it("기본 module Worker 큐는 동시 호출도 capacity 1로 직렬 실행한다", async () => {
    let worker: ControlledApplyingWorker | null = null;
    vi.stubGlobal("Worker", vi.fn(function MockWorker() {
      worker = new ControlledApplyingWorker();
      return worker;
    }));

    const first = runStudioLiquifyWorker(fieldRequest());
    const second = runStudioLiquifyWorker(fieldRequest());
    await vi.waitFor(() => expect(worker!.postCount).toBe(1));

    worker!.releaseNext();
    await expect(first).resolves.toMatchObject({ execution: "worker" });
    await vi.waitFor(() => expect(worker!.postCount).toBe(2));
    worker!.releaseNext();
    await expect(second).resolves.toMatchObject({ execution: "worker" });
    expect(worker!.terminateCount).toBe(0);
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

    const pending = runStudioLiquifyWorker(fieldRequest(), { signal: controller.signal });
    await vi.waitFor(() => expect(firstWorker!.postCount).toBe(1));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(firstWorker!.terminateCount).toBe(1);

    await expect(runStudioLiquifyWorker(fieldRequest())).resolves.toMatchObject({ execution: "worker" });
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

    const pending = runStudioLiquifyWorker(fieldRequest(), { operationTimeoutMilliseconds: 5 });
    await vi.advanceTimersByTimeAsync(0);
    const timedOut = expect(pending).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(6);
    await timedOut;
    expect(firstWorker!.terminateCount).toBe(1);

    const recovered = runStudioLiquifyWorker(fieldRequest());
    await vi.advanceTimersByTimeAsync(0);
    await expect(recovered).resolves.toMatchObject({ execution: "worker" });
    expect(WorkerConstructor).toHaveBeenCalledTimes(2);
    expect(secondWorker!.terminateCount).toBe(0);
  });

  it.each([
    ["post-transfer throw", () => new PostTransferThrowWorker()],
    ["post-transfer error", () => new PostTransferErrorWorker()],
  ] as const)("%s 뒤 warm Worker를 폐기하고 detached direct fallback 없이 복구한다", async (_label, createBroken) => {
    let broken: HangingWorker | null = null;
    let recovered: ApplyingWorker | null = null;
    const WorkerConstructor = vi.fn(function MockWorker() {
      if (WorkerConstructor.mock.calls.length === 1) {
        broken = createBroken();
        return broken;
      }
      recovered = new ApplyingWorker();
      return recovered;
    });
    vi.stubGlobal("Worker", WorkerConstructor);
    const request = fieldRequest();
    const sourceBuffer = request.src.data;

    await expect(runStudioLiquifyWorker(request)).rejects.toThrow();
    expect(sourceBuffer.byteLength).toBe(0);
    expect(broken!.terminateCount).toBe(1);
    await expect(runStudioLiquifyWorker(fieldRequest())).resolves.toMatchObject({ execution: "worker" });
    expect(WorkerConstructor).toHaveBeenCalledTimes(2);
    expect(recovered!.terminateCount).toBe(0);
  });

  it("worker 전송 결과가 direct 변위 결과와 일치하고 동기 응답 race를 허용한다", async () => {
    const src = image(4, 4);
    const expected = cloneImage(src);
    const field = fieldFixture();
    const retainedDx = new Float32Array(field.dx);
    const retainedDy = new Float32Array(field.dy);
    applyLiquifyDisplacement(src, expected, field);
    const worker = new ApplyingWorker();

    const result = await runStudioLiquifyWorker(
      { src, dst: cloneImage(src), field },
      { workerFactory: () => worker },
    );

    expect(result.execution).toBe("worker");
    expect(result.dst.data).toEqual(expected.data);
    expect(worker.transferCount).toBe(4);
    expect(worker.terminateCount).toBe(1);
    expect(field.dx.byteLength).toBe(retainedDx.byteLength);
    expect(field.dy.byteLength).toBe(retainedDy.byteLength);
    expect(field.dx).toEqual(retainedDx);
    expect(field.dy).toEqual(retainedDy);
  });

  it("stroke 요청은 points+settings를 Worker로 보내 field 생성과 적용을 한 경계에서 수행한다", async () => {
    const src = image(32, 24);
    const points = [{ x: 4, y: 12 }, { x: 20, y: 12 }];
    const field = buildLiquifyDisplacementField(points, 6, 0.8, 32, 24)!;
    const expected = cloneImage(src);
    applyLiquifyDisplacement(src, expected, field);
    const worker = new ApplyingWorker();

    const result = await runStudioLiquifyWorker({
      src,
      dst: cloneImage(src),
      stroke: { points, radiusPx: 6, strength: 0.8, options: { mode: "push" } },
    }, { workerFactory: () => worker });

    expect(result).toMatchObject({ execution: "worker", applied: true });
    expect(result.dst.data).toEqual(expected.data);
    // stroke 요청에는 메인 스레드에서 만든 dx/dy가 없으므로 RGBA 두 버퍼만 전송한다.
    expect(worker.transferCount).toBe(2);
  });

  it("explicit direct mode도 Worker 경로와 byte parity를 유지하고 no-op을 표시한다", async () => {
    const src = image(20, 20);
    const request = {
      src,
      dst: cloneImage(src),
      stroke: {
        points: [{ x: 10, y: 10 }] as const,
        radiusPx: 5,
        strength: 0.75,
        options: { mode: "bloat" as const },
      },
    };
    const expected = cloneImage(src);
    const field = buildLiquifyDisplacementField(
      request.stroke.points,
      request.stroke.radiusPx,
      request.stroke.strength,
      20,
      20,
      request.stroke.options,
    )!;
    applyLiquifyDisplacement(src, expected, field);

    const direct = await runStudioLiquifyWorker(request, { executionMode: "direct" });
    expect(direct).toMatchObject({ execution: "direct", applied: true });
    expect(direct.dst.data).toEqual(expected.data);

    const noOp = await runStudioLiquifyWorker({
      src: image(4, 4),
      dst: image(4, 4),
      stroke: { points: [{ x: 1, y: 1 }], radiusPx: 2, strength: 1 },
    }, { executionMode: "direct" });
    expect(noOp).toMatchObject({ execution: "direct", applied: false });
  });

  it("512px bloat 단일 dab은 필드 밖 RGB/alpha를 바꾸지 않고 direct와 동일하다", async () => {
    const src = image(512, 512);
    const field = buildLiquifyDisplacementField(
      [{ x: 256, y: 256 }],
      60,
      0.7,
      512,
      512,
      { mode: "bloat" },
    )!;
    const expected = cloneImage(src);
    applyLiquifyDisplacement(src, expected, field);
    const worker = new ApplyingWorker();

    const result = await runStudioLiquifyWorker(
      { src, dst: cloneImage(src), field },
      { workerFactory: () => worker },
    );

    expect(result.dst.data).toEqual(expected.data);
    const farPixelOffset = (20 * 512 + 20) * 4;
    expect(result.dst.data.slice(farPixelOffset, farPixelOffset + 4)).toEqual(
      expected.data.slice(farPixelOffset, farPixelOffset + 4),
    );
    let changedAlphaCount = 0;
    for (let offset = 3; offset < result.dst.data.length; offset += 4) {
      if (result.dst.data[offset] !== 255) changedAlphaCount += 1;
    }
    expect(changedAlphaCount).toBe(0);
  });

  it("src와 dst가 같은 버퍼여도 frozen source를 분리해 스캔 순서 오염을 막는다", async () => {
    const shared = image(4, 4);
    const frozen = cloneImage(shared);
    const expected = cloneImage(shared);
    const field = fieldFixture();
    applyLiquifyDisplacement(frozen, expected, field);

    const result = await runStudioLiquifyWorker(
      { src: shared, dst: shared, field },
      { workerFactory: () => new ApplyingWorker() },
    );

    expect(result.dst.data).toEqual(expected.data);
  });

  it("부분 view를 복제해 무관한 backing buffer와 형제 view를 detach하지 않는다", async () => {
    const backing = new ArrayBuffer(160);
    const srcData = new Uint8ClampedArray(backing, 8, 64);
    const dstData = new Uint8ClampedArray(backing, 80, 64);
    srcData.set(image(4, 4).data);
    dstData.set(srcData);
    const sentinel = new Uint8Array(backing, 0, 4);
    sentinel.set([4, 3, 2, 1]);

    const result = await runStudioLiquifyWorker({
      src: { data: srcData, width: 4, height: 4 },
      dst: { data: dstData, width: 4, height: 4 },
      field: fieldFixture(),
    }, { workerFactory: () => new ApplyingWorker() });

    expect(result.execution).toBe("worker");
    expect(backing.byteLength).toBe(160);
    expect(Array.from(sentinel)).toEqual([4, 3, 2, 1]);
  });

  it("잘못된 입력은 Worker 생성 전에, 잘못된 성공 결과는 적용 전에 거부한다", async () => {
    const factory = vi.fn(() => new ApplyingWorker());
    await expect(runStudioLiquifyWorker({
      src: { data: new Uint8ClampedArray(4), width: 2, height: 2 },
      dst: image(2, 2),
      field: fieldFixture(),
    }, { workerFactory: factory })).rejects.toThrow(/버퍼 길이/);
    expect(factory).not.toHaveBeenCalled();

    await expect(runStudioLiquifyWorker({
      src: image(4, 4),
      dst: image(4, 4),
      stroke: {
        points: [{ x: Number.NaN, y: 1 }],
        radiusPx: 2,
        strength: 1,
        options: { mode: "bloat" },
      },
    }, { workerFactory: factory })).rejects.toThrow(/점 좌표/);
    expect(factory).not.toHaveBeenCalled();

    const invalidWorker = new InvalidResultWorker();
    await expect(runStudioLiquifyWorker({
      src: image(4, 4),
      dst: image(4, 4),
      field: fieldFixture(),
    }, { workerFactory: () => invalidWorker })).rejects.toThrow(/버퍼 길이/);
    expect(invalidWorker.terminateCount).toBe(1);
  });
});
