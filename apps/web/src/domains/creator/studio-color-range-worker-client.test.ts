import { describe, expect, it } from "vitest";

import {
  STUDIO_COLOR_RANGE_DIRECT_MAX_PIXELS,
  createStudioColorRangeWorkerSession,
  type StudioColorRangeWorkerLike,
} from "./studio-color-range-worker-client";
import { executeStudioColorRangeWorkerRequest } from "./studio-color-range-worker-runtime";

import type {
  StudioColorRangeWorkerResponseMessage,
  StudioColorRangeWorkerRunMessage,
  StudioColorRangeWorkerRunRequest,
} from "./studio-color-range-worker-protocol";
import type { PixelSelection } from "./studio-selection-tools";

function requestFixture(
  width = 3,
  height = 2,
  data = new Uint8ClampedArray([
    220, 40, 40, 255,
    220, 40, 40, 255,
    40, 60, 220, 255,
    40, 60, 220, 255,
    60, 190, 90, 255,
    60, 190, 90, 255,
  ]),
): StudioColorRangeWorkerRunRequest {
  return {
    data,
    width,
    height,
    samples: [{ r: 220, g: 40, b: 40 }],
    fuzziness: 40,
    antiAlias: true,
    selection: null,
    combineMode: "add",
    aspect: height / width,
  };
}

class ControlledWorker implements StudioColorRangeWorkerLike {
  onmessage: StudioColorRangeWorkerLike["onmessage"] = null;
  onerror: StudioColorRangeWorkerLike["onerror"] = null;
  readonly messages: StudioColorRangeWorkerRunMessage[] = [];
  readonly transfers: Transferable[][] = [];
  terminateCount = 0;

  postMessage(message: StudioColorRangeWorkerRunMessage, transfer: Transferable[]): void {
    this.transfers.push(transfer);
    this.messages.push(structuredClone(message, { transfer }));
  }

  terminate(): void {
    this.terminateCount += 1;
  }

  emitReady(): void {
    this.emit({
      type: "studio-color-range/ready",
      version: 1,
    });
  }

  emitSuccess(requestId: number, selection: PixelSelection | null): void {
    this.emit({
      type: "studio-color-range/success",
      version: 1,
      requestId,
      selection,
    });
  }

  emitFailure(requestId: number, name: string, message: string): void {
    this.emit({
      type: "studio-color-range/failure",
      version: 1,
      requestId,
      error: { name, message },
    });
  }

  emitLoadError(message: string): void {
    this.onerror?.({ message });
  }

  emitRaw(message: unknown): void {
    this.onmessage?.({
      data: message as StudioColorRangeWorkerResponseMessage,
    } as MessageEvent<StudioColorRangeWorkerResponseMessage>);
  }

  private emit(message: StudioColorRangeWorkerResponseMessage): void {
    this.onmessage?.({ data: message } as MessageEvent<StudioColorRangeWorkerResponseMessage>);
  }
}

describe("createStudioColorRangeWorkerSession", () => {
  it("uses the bounded direct path for small requests and preserves exact core output", async () => {
    const input = requestFixture();
    const expected = executeStudioColorRangeWorkerRequest(input);
    const session = createStudioColorRangeWorkerSession({ executionMode: "direct" });

    await expect(session.run(input)).resolves.toEqual({
      execution: "direct",
      selection: expected,
    });
    expect(input.data.byteLength).toBe(24);
    session.dispose();
  });

  it("fails closed instead of running a large selection long task on the main thread", async () => {
    const width = Math.floor(Math.sqrt(STUDIO_COLOR_RANGE_DIRECT_MAX_PIXELS)) + 1;
    const height = width;
    const input = requestFixture(
      width,
      height,
      new Uint8ClampedArray(width * height * 4),
    );
    const session = createStudioColorRangeWorkerSession({ executionMode: "direct" });

    await expect(session.run(input)).rejects.toThrow(
      "편집 화면 멈춤을 막기 위해 메인 스레드에서 계산하지 않습니다",
    );
    expect(input.data.byteLength).toBe(width * height * 4);
    session.dispose();
  });

  it("transfers a dedicated RGBA buffer and reuses one warm Worker across completed runs", async () => {
    const worker = new ControlledWorker();
    let factoryCalls = 0;
    const session = createStudioColorRangeWorkerSession({
      workerFactory: () => {
        factoryCalls += 1;
        return worker;
      },
    });
    const firstInput = requestFixture();
    const first = session.run(firstInput);

    worker.emitReady();
    expect(firstInput.data.byteLength).toBe(0);
    expect(worker.transfers[0]).toHaveLength(1);
    const firstMessage = worker.messages[0]!;
    const firstExpected = executeStudioColorRangeWorkerRequest(firstMessage.request);
    worker.emitSuccess(firstMessage.requestId, firstExpected);
    await expect(first).resolves.toEqual({
      execution: "worker",
      selection: firstExpected,
    });

    const secondInput = requestFixture();
    const second = session.run(secondInput);
    expect(secondInput.data.byteLength).toBe(0);
    const secondMessage = worker.messages[1]!;
    expect(secondMessage.requestId).toBeGreaterThan(firstMessage.requestId);
    const secondExpected = executeStudioColorRangeWorkerRequest(secondMessage.request);
    worker.emitSuccess(secondMessage.requestId, secondExpected);
    await expect(second).resolves.toEqual({
      execution: "worker",
      selection: secondExpected,
    });
    expect(factoryCalls).toBe(1);
    expect(worker.terminateCount).toBe(0);

    session.dispose();
    expect(worker.terminateCount).toBe(1);
  });

  it("copies partial views into a dedicated transfer buffer without detaching the caller's owner", async () => {
    const owner = new ArrayBuffer(40);
    const partial = new Uint8ClampedArray(owner, 8, 24);
    partial.set(requestFixture().data);
    const worker = new ControlledWorker();
    const session = createStudioColorRangeWorkerSession({ workerFactory: () => worker });
    const pending = session.run(requestFixture(3, 2, partial));

    worker.emitReady();
    expect(owner.byteLength).toBe(40);
    expect(partial.byteLength).toBe(24);
    expect(worker.messages[0]!.request.data.byteOffset).toBe(0);
    expect(worker.messages[0]!.request.data.buffer.byteLength).toBe(24);
    worker.emitSuccess(worker.messages[0]!.requestId, null);
    await expect(pending).resolves.toEqual({ execution: "worker", selection: null });
    session.dispose();
  });

  it("aborts an in-flight epoch, terminates its Worker, and ignores any late result", async () => {
    const firstWorker = new ControlledWorker();
    const secondWorker = new ControlledWorker();
    const workers = [firstWorker, secondWorker];
    const session = createStudioColorRangeWorkerSession({
      workerFactory: () => workers.shift() ?? null,
    });
    const controller = new AbortController();
    const first = session.run(requestFixture(), { signal: controller.signal });
    workerReadyAndPosted(firstWorker);
    const firstRequestId = firstWorker.messages[0]!.requestId;

    controller.abort();
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    expect(firstWorker.terminateCount).toBe(1);
    firstWorker.emitSuccess(firstRequestId, null);

    const second = session.run(requestFixture());
    workerReadyAndPosted(secondWorker);
    const secondMessage = secondWorker.messages[0]!;
    secondWorker.emitSuccess(secondMessage.requestId, null);
    await expect(second).resolves.toEqual({ execution: "worker", selection: null });
    session.dispose();
  });

  it("supersedes a pending request with a fresh Worker epoch and rejects the old caller", async () => {
    const firstWorker = new ControlledWorker();
    const secondWorker = new ControlledWorker();
    const workers = [firstWorker, secondWorker];
    const session = createStudioColorRangeWorkerSession({
      workerFactory: () => workers.shift() ?? null,
    });
    const first = session.run(requestFixture());
    workerReadyAndPosted(firstWorker);
    const firstRejection = expect(first).rejects.toMatchObject({ name: "AbortError" });

    const second = session.run(requestFixture());
    await firstRejection;
    expect(firstWorker.terminateCount).toBe(1);
    workerReadyAndPosted(secondWorker);
    const secondMessage = secondWorker.messages[0]!;
    secondWorker.emitSuccess(secondMessage.requestId, null);
    await expect(second).resolves.toEqual({ execution: "worker", selection: null });
    session.dispose();
  });

  it("keeps pre-transfer and post-transfer Worker failures terminal", async () => {
    const loadFailureWorker = new ControlledWorker();
    const smallSession = createStudioColorRangeWorkerSession({
      workerFactory: () => loadFailureWorker,
    });
    const small = smallSession.run(requestFixture());
    loadFailureWorker.emitLoadError("chunk blocked by CSP");
    await expect(small).rejects.toMatchObject({
      name: "StudioColorRangeWorkerUnavailableError",
    });
    smallSession.dispose();

    const executionFailureWorker = new ControlledWorker();
    const workerSession = createStudioColorRangeWorkerSession({
      workerFactory: () => executionFailureWorker,
    });
    const posted = workerSession.run(requestFixture());
    workerReadyAndPosted(executionFailureWorker);
    const requestId = executionFailureWorker.messages[0]!.requestId;
    executionFailureWorker.emitFailure(requestId, "RangeError", "source is too large");
    await expect(posted).rejects.toMatchObject({
      name: "RangeError",
      message: "source is too large",
    });
    workerSession.dispose();
  });

  it("rejects an already-aborted request before creating or detaching anything", async () => {
    const controller = new AbortController();
    controller.abort();
    const input = requestFixture();
    let factoryCalls = 0;
    const session = createStudioColorRangeWorkerSession({
      workerFactory: () => {
        factoryCalls += 1;
        return new ControlledWorker();
      },
    });

    await expect(session.run(input, { signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(factoryCalls).toBe(0);
    expect(input.data.byteLength).toBe(24);
    session.dispose();
  });

  it.each([
    {
      label: "an unknown response type",
      response: (requestId: number) => ({
        type: "studio-color-range/result-v2",
        version: 1,
        requestId,
        selection: null,
      }),
    },
    {
      label: "an undefined selection",
      response: (requestId: number) => ({
        type: "studio-color-range/success",
        version: 1,
        requestId,
      }),
    },
    {
      label: "a non-finite selection coordinate",
      response: (requestId: number) => ({
        type: "studio-color-range/success",
        version: 1,
        requestId,
        selection: {
          subpaths: [{
            mode: "add",
            points: [
              { x: 0, y: 0 },
              { x: Number.NaN, y: 0 },
              { x: 0, y: Number.POSITIVE_INFINITY },
            ],
          }],
          featherPx: 0,
          invert: false,
        },
      }),
    },
    {
      label: "an oversized selection graph",
      response: (requestId: number) => ({
        type: "studio-color-range/success",
        version: 1,
        requestId,
        selection: {
          subpaths: Array.from({ length: 129 }, () => ({
            mode: "add",
            points: [
              { x: 0, y: 0 },
              { x: 1, y: 0 },
              { x: 0, y: 1 },
            ],
          })),
          featherPx: 0,
          invert: false,
        },
      }),
    },
  ])("fails closed for $label", async ({ response }) => {
    const worker = new ControlledWorker();
    const session = createStudioColorRangeWorkerSession({
      workerFactory: () => worker,
    });
    const pending = session.run(requestFixture());
    workerReadyAndPosted(worker);

    worker.emitRaw(response(worker.messages[0]!.requestId));

    await expect(pending).rejects.toThrow(
      "Worker가 올바르지 않은 선택 결과를 반환했습니다",
    );
    expect(worker.terminateCount).toBe(1);
    session.dispose();
  });
});

function workerReadyAndPosted(worker: ControlledWorker): void {
  worker.emitReady();
  expect(worker.messages).toHaveLength(1);
}
