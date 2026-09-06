import { afterEach, describe, expect, it, vi } from "vitest";

import { applyOutline, normalizeOutline } from "./studio-outline";
import {
  STUDIO_OUTLINE_WORKER_RUN_TIMEOUT_MS,
  createStudioOutlineWorkerSession,
  type StudioOutlineWorkerLike,
} from "./studio-outline-worker-client";
import {
  STUDIO_OUTLINE_WORKER_MAX_PIXELS,
  assertStudioOutlineImageData,
  studioOutlineSuccessTransfers,
  type StudioOutlineWorkerRequestMessage,
  type StudioOutlineWorkerResponseMessage,
  type StudioOutlineWorkerRunMessage,
  type StudioOutlineWorkerSuccessMessage,
} from "./studio-outline-worker-protocol";

function imageFixture(width = 5, height = 5) {
  const data = new Uint8ClampedArray(width * height * 4);
  const center = (Math.floor(height / 2) * width + Math.floor(width / 2)) * 4;
  data.set([12, 34, 56, 255], center);
  return { data, width, height };
}

function requestFixture() {
  return {
    imageData: imageFixture(),
    outline: normalizeOutline({ color: "#ff0000", width: 1, opacity: 100 }),
  };
}

class ApplyingWorker implements StudioOutlineWorkerLike {
  onmessage: StudioOutlineWorkerLike["onmessage"] = null;
  onerror: StudioOutlineWorkerLike["onerror"] = null;
  terminateCount = 0;
  postCount = 0;

  constructor() {
    queueMicrotask(() => {
      this.onmessage?.({
        data: { type: "studio-outline/ready", version: 1 },
      } as MessageEvent<StudioOutlineWorkerResponseMessage>);
    });
  }

  postMessage(
    message: StudioOutlineWorkerRequestMessage,
    transfer: Transferable[],
  ): void {
    this.postCount++;
    const received = structuredClone(message, { transfer });
    applyOutline(received.request.imageData, normalizeOutline(received.request.outline));
    const response: StudioOutlineWorkerSuccessMessage = {
      type: "studio-outline/success",
      version: 1,
      requestId: received.requestId,
      epoch: received.epoch,
      imageData: received.request.imageData,
    };
    const returned = structuredClone(response, {
      transfer: studioOutlineSuccessTransfers(response),
    });
    queueMicrotask(() => {
      this.onmessage?.({
        data: returned,
      } as MessageEvent<StudioOutlineWorkerResponseMessage>);
    });
  }

  terminate(): void {
    this.terminateCount++;
  }
}

class ManualWorker implements StudioOutlineWorkerLike {
  onmessage: StudioOutlineWorkerLike["onmessage"] = null;
  onerror: StudioOutlineWorkerLike["onerror"] = null;
  terminateCount = 0;
  readonly messages: StudioOutlineWorkerRunMessage[] = [];

  constructor() {
    queueMicrotask(() => {
      this.onmessage?.({
        data: { type: "studio-outline/ready", version: 1 },
      } as MessageEvent<StudioOutlineWorkerResponseMessage>);
    });
  }

  postMessage(
    message: StudioOutlineWorkerRequestMessage,
    transfer: Transferable[],
  ): void {
    this.messages.push(structuredClone(message, { transfer }));
  }

  emitSuccess(
    message: StudioOutlineWorkerRunMessage,
    overrides: Partial<Pick<StudioOutlineWorkerSuccessMessage, "epoch" | "requestId">> = {},
  ): void {
    this.onmessage?.({
      data: {
        type: "studio-outline/success",
        version: 1,
        requestId: overrides.requestId ?? message.requestId,
        epoch: overrides.epoch ?? message.epoch,
        imageData: imageFixture(
          message.request.imageData.width,
          message.request.imageData.height,
        ),
      },
    } as MessageEvent<StudioOutlineWorkerResponseMessage>);
  }

  terminate(): void {
    this.terminateCount++;
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe("studio outline Worker protocol", () => {
  it("validates exact RGBA dimensions and the bounded EDT memory budget", () => {
    expect(() => assertStudioOutlineImageData(imageFixture(2, 3))).not.toThrow();
    expect(() => assertStudioOutlineImageData({
      data: new Uint8ClampedArray(4),
      width: 2,
      height: 3,
    })).toThrow(/버퍼 길이/);
    expect(() => assertStudioOutlineImageData({
      data: new Uint8ClampedArray(4),
      width: STUDIO_OUTLINE_WORKER_MAX_PIXELS + 1,
      height: 1,
    })).toThrow(/안전 한도/);
  });
});

describe("createStudioOutlineWorkerSession", () => {
  it("reuses one persistent module Worker and transfers private RGBA ownership", async () => {
    const worker = new ApplyingWorker();
    const factory = vi.fn(() => worker);
    const session = createStudioOutlineWorkerSession({ workerFactory: factory });
    const firstRequest = requestFixture();
    const expected = requestFixture();
    applyOutline(expected.imageData, expected.outline);

    const firstPending = session.run(firstRequest, { epoch: 1 });
    await Promise.resolve();
    expect(firstRequest.imageData.data.byteLength).toBe(0);
    const first = await firstPending;
    const second = await session.run(requestFixture(), { epoch: 2 });

    expect(first.epoch).toBe(1);
    expect(Array.from(first.imageData.data)).toEqual(Array.from(expected.imageData.data));
    expect(second.epoch).toBe(2);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(worker.postCount).toBe(2);
    expect(worker.terminateCount).toBe(0);

    session.dispose();
    expect(worker.terminateCount).toBe(1);
  });

  it("terminates an aborted EDT and ignores its old Worker result without poisoning a newer epoch", async () => {
    const workers: ManualWorker[] = [];
    const session = createStudioOutlineWorkerSession({
      workerFactory: () => {
        const worker = new ManualWorker();
        workers.push(worker);
        return worker;
      },
    });
    const controller = new AbortController();
    const stale = session.run(requestFixture(), {
      epoch: 7,
      signal: controller.signal,
    });
    await Promise.resolve();
    const staleWorker = workers[0]!;
    const staleMessage = staleWorker.messages[0]!;
    const staleListener = staleWorker.onmessage;
    controller.abort();
    await expect(stale).rejects.toMatchObject({ name: "AbortError" });
    expect(staleWorker.terminateCount).toBe(1);

    staleListener?.({
      data: {
        type: "studio-outline/success",
        version: 1,
        requestId: staleMessage.requestId,
        epoch: staleMessage.epoch,
        imageData: imageFixture(),
      },
    } as MessageEvent<StudioOutlineWorkerResponseMessage>);
    const current = session.run(requestFixture(), { epoch: 8 });
    await Promise.resolve();
    const currentWorker = workers[1]!;
    const currentMessage = currentWorker.messages[0]!;
    currentWorker.emitSuccess(currentMessage);

    await expect(current).resolves.toMatchObject({ epoch: 8 });
    expect(currentWorker.terminateCount).toBe(0);
    session.dispose();
  });

  it("runs one transfer at a time and preserves another node queued behind an aborted owner", async () => {
    const workers: ManualWorker[] = [];
    const session = createStudioOutlineWorkerSession({
      workerFactory: () => {
        const worker = new ManualWorker();
        workers.push(worker);
        return worker;
      },
    });
    const activeController = new AbortController();
    const activeRequest = requestFixture();
    const queuedRequest = requestFixture();

    const active = session.run(activeRequest, {
      epoch: 1,
      signal: activeController.signal,
    });
    const queued = session.run(queuedRequest, { epoch: 1 });
    await Promise.resolve();
    const activeWorker = workers[0]!;

    expect(activeWorker.messages).toHaveLength(1);
    expect(activeRequest.imageData.data.byteLength).toBe(0);
    expect(queuedRequest.imageData.data.byteLength).toBeGreaterThan(0);

    activeController.abort();
    await expect(active).rejects.toMatchObject({ name: "AbortError" });
    await Promise.resolve();
    const replacementWorker = workers[1]!;

    expect(activeWorker.terminateCount).toBe(1);
    expect(replacementWorker.messages).toHaveLength(1);
    expect(queuedRequest.imageData.data.byteLength).toBe(0);
    replacementWorker.emitSuccess(replacementWorker.messages[0]!);
    await expect(queued).resolves.toMatchObject({ epoch: 1 });
    session.dispose();
  });

  it("serializes multiple healthy requests on one persistent Worker", async () => {
    const worker = new ManualWorker();
    const session = createStudioOutlineWorkerSession({ workerFactory: () => worker });
    const first = session.run(requestFixture(), { epoch: 1 });
    const second = session.run(requestFixture(), { epoch: 2 });
    await Promise.resolve();

    expect(worker.messages).toHaveLength(1);
    worker.emitSuccess(worker.messages[0]!);
    await expect(first).resolves.toMatchObject({ epoch: 1 });
    expect(worker.messages).toHaveLength(2);

    worker.emitSuccess(worker.messages[1]!);
    await expect(second).resolves.toMatchObject({ epoch: 2 });
    expect(worker.terminateCount).toBe(0);
    session.dispose();
  });

  it("drops a queued owner's abort without terminating another node's active EDT", async () => {
    const worker = new ManualWorker();
    const session = createStudioOutlineWorkerSession({ workerFactory: () => worker });
    const queuedController = new AbortController();
    const active = session.run(requestFixture(), { epoch: 1 });
    const queuedRequest = requestFixture();
    const queued = session.run(queuedRequest, {
      epoch: 1,
      signal: queuedController.signal,
    });
    await Promise.resolve();

    queuedController.abort();
    await expect(queued).rejects.toMatchObject({ name: "AbortError" });
    expect(worker.terminateCount).toBe(0);
    expect(queuedRequest.imageData.data.byteLength).toBeGreaterThan(0);

    worker.emitSuccess(worker.messages[0]!);
    await expect(active).resolves.toMatchObject({ epoch: 1 });
    expect(worker.messages).toHaveLength(1);
    session.dispose();
  });

  it("terminates a timed-out EDT and resumes the queued owner on a replacement Worker", async () => {
    vi.useFakeTimers();
    const workers: ManualWorker[] = [];
    const session = createStudioOutlineWorkerSession({
      workerFactory: () => {
        const worker = new ManualWorker();
        workers.push(worker);
        return worker;
      },
    });
    const timedOut = session.run(requestFixture(), { epoch: 3 });
    const queued = session.run(requestFixture(), { epoch: 4 });
    const timedOutRejection = expect(timedOut).rejects.toMatchObject({
      name: "TimeoutError",
    });
    await Promise.resolve();
    const timedOutWorker = workers[0]!;

    await vi.advanceTimersByTimeAsync(STUDIO_OUTLINE_WORKER_RUN_TIMEOUT_MS);
    await timedOutRejection;
    await Promise.resolve();
    const replacementWorker = workers[1]!;

    expect(timedOutWorker.terminateCount).toBe(1);
    expect(replacementWorker.messages).toHaveLength(1);
    replacementWorker.emitSuccess(replacementWorker.messages[0]!);
    await expect(queued).resolves.toMatchObject({ epoch: 4 });
    session.dispose();
  });

  it("fails closed and terminates the session on an epoch-mismatched response", async () => {
    const worker = new ManualWorker();
    const session = createStudioOutlineWorkerSession({ workerFactory: () => worker });
    const pending = session.run(requestFixture(), { epoch: 12 });
    await Promise.resolve();
    worker.emitSuccess(worker.messages[0]!, { epoch: 11 });

    await expect(pending).rejects.toThrow(/epoch/);
    expect(worker.terminateCount).toBe(1);
  });

  it("rejects when Worker construction is unavailable instead of running EDT synchronously", async () => {
    const request = requestFixture();
    const before = Array.from(request.imageData.data);
    const session = createStudioOutlineWorkerSession({ workerFactory: null });

    await expect(session.run(request, { epoch: 1 }))
      .rejects.toMatchObject({ name: "NotSupportedError" });
    expect(Array.from(request.imageData.data)).toEqual(before);
  });

  it("rejects an already-aborted signal before constructing a Worker", async () => {
    const factory = vi.fn(() => new ManualWorker());
    const session = createStudioOutlineWorkerSession({ workerFactory: factory });
    const controller = new AbortController();
    controller.abort();

    await expect(session.run(requestFixture(), {
      epoch: 1,
      signal: controller.signal,
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(factory).not.toHaveBeenCalled();
  });

  it("rejects malformed pixels before constructing a Worker", async () => {
    const factory = vi.fn(() => new ManualWorker());
    const session = createStudioOutlineWorkerSession({ workerFactory: factory });
    const request = requestFixture();
    request.imageData = {
      data: new Uint8ClampedArray(4),
      width: 2,
      height: 2,
    };

    await expect(session.run(request, { epoch: 1 })).rejects.toThrow(/버퍼 길이/);
    expect(factory).not.toHaveBeenCalled();
  });

  it("terminates a Worker that returns a malformed success buffer", async () => {
    const worker = new ManualWorker();
    const session = createStudioOutlineWorkerSession({ workerFactory: () => worker });
    const pending = session.run(requestFixture(), { epoch: 2 });
    await Promise.resolve();
    const message = worker.messages[0]!;
    worker.onmessage?.({
      data: {
        type: "studio-outline/success",
        version: 1,
        requestId: message.requestId,
        epoch: message.epoch,
        imageData: { data: new Uint8ClampedArray(4), width: 5, height: 5 },
      },
    } as MessageEvent<StudioOutlineWorkerResponseMessage>);

    await expect(pending).rejects.toThrow(/버퍼 길이/);
    expect(worker.terminateCount).toBe(1);
  });

  it("times out a Worker that never announces readiness", async () => {
    vi.useFakeTimers();
    const worker: StudioOutlineWorkerLike = {
      onmessage: null,
      onerror: null,
      postMessage: vi.fn(),
      terminate: vi.fn(),
    };
    const session = createStudioOutlineWorkerSession({ workerFactory: () => worker });
    const pending = session.run(requestFixture(), { epoch: 1 });
    const rejection = expect(pending).rejects.toThrow(/준비 시간이 초과/);

    await vi.advanceTimersByTimeAsync(3_000);
    await rejection;
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
