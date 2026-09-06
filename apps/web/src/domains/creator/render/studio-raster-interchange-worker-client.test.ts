import { describe, expect, it, vi } from "vitest";

import { decodeStudioRasterInterchange, encodeStudioRasterInterchange } from "./studio-raster-interchange";
import {
  STUDIO_RASTER_INTERCHANGE_DIRECT_MAX_BYTES,
  STUDIO_RASTER_INTERCHANGE_DIRECT_MAX_PIXELS,
  STUDIO_RASTER_INTERCHANGE_WORKER_OPERATION_TIMEOUT_DEFAULT_MS,
  STUDIO_RASTER_INTERCHANGE_WORKER_OPERATION_TIMEOUT_MAX_MS,
  decodeStudioRasterInterchangeAsync,
  encodeStudioRasterInterchangeAsync,
  type StudioRasterInterchangeWorkerLike,
} from "./studio-raster-interchange-worker-client";
import {
  STUDIO_RASTER_INTERCHANGE_WORKER_VERSION,
  type StudioRasterInterchangeWorkerRequest,
} from "./studio-raster-interchange-worker-protocol";

const bitmap = {
  width: 1,
  height: 1,
  data: new Uint8ClampedArray([10, 20, 30, 255]),
};

function oversizedQoiHeader(): Uint8Array {
  const bytes = new Uint8Array(22);
  bytes.set([0x71, 0x6f, 0x69, 0x66]);
  const view = new DataView(bytes.buffer);
  view.setUint32(4, 1_025);
  view.setUint32(8, 1_024);
  bytes[12] = 4;
  bytes[21] = 1;
  return bytes;
}

class FakeWorker implements StudioRasterInterchangeWorkerLike {
  onmessage: StudioRasterInterchangeWorkerLike["onmessage"] = null;
  onerror: StudioRasterInterchangeWorkerLike["onerror"] = null;
  onmessageerror:
    StudioRasterInterchangeWorkerLike["onmessageerror"] = null;
  terminate = vi.fn();

  constructor(
    private readonly autoRespond = true,
    private readonly postThrows = false,
  ) {}

  postMessage = vi.fn((request: StudioRasterInterchangeWorkerRequest) => {
    if (this.postThrows) {
      throw new DOMException("raw transfer failure", "DataCloneError");
    }
    if (!this.autoRespond) return;
    this.respond(request);
  });

  respond(
    request = this.postMessage.mock.calls.at(-1)?.[0],
  ): void {
    if (!request) throw new Error("A posted raster request is required.");
    if (request.type === "studio-raster-interchange/encode") {
      const encoded = encodeStudioRasterInterchange(request.format, {
        width: request.width,
        height: request.height,
        data: request.data,
      });
      queueMicrotask(() => this.onmessage?.({ data: {
        type: "studio-raster-interchange/encode-success",
        version: STUDIO_RASTER_INTERCHANGE_WORKER_VERSION,
        requestId: request.requestId,
        result: encoded,
      } } as MessageEvent));
      return;
    }
    const decoded = decodeStudioRasterInterchange(request.bytes, request.expectedFormat);
    queueMicrotask(() => this.onmessage?.({ data: {
      type: "studio-raster-interchange/decode-success",
      version: STUDIO_RASTER_INTERCHANGE_WORKER_VERSION,
      requestId: request.requestId,
      result: decoded,
    } } as MessageEvent));
  }

  ready(): void {
    this.onmessage?.({ data: {
      type: "studio-raster-interchange/ready",
      version: STUDIO_RASTER_INTERCHANGE_WORKER_VERSION,
    } } as MessageEvent);
  }

  runtimeError(message = "raw /private/codec.wasm panic"): void {
    this.onerror?.({
      message,
      preventDefault() {},
    });
  }

  messageError(): void {
    this.onmessageerror?.({ data: undefined } as MessageEvent<unknown>);
  }
}

describe("studio raster interchange worker client", () => {
  it("copies caller pixels, transfers them after ready and returns worker output", async () => {
    const worker = new FakeWorker();
    const promise = encodeStudioRasterInterchangeAsync("qoi", bitmap, {
      executionMode: "worker",
      workerFactory: () => worker,
    });
    worker.ready();
    const result = await promise;
    expect(result.execution).toBe("worker");
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    const request = worker.postMessage.mock.calls[0]?.[0];
    expect(request?.type).toBe("studio-raster-interchange/encode");
    if (request?.type !== "studio-raster-interchange/encode") throw new Error("encode request expected");
    expect(request.data).not.toBe(bitmap.data);
    expect([...bitmap.data]).toEqual([10, 20, 30, 255]);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(worker.onmessage).toBeNull();
    expect(worker.onerror).toBeNull();
    expect(worker.onmessageerror).toBeNull();
  });

  it("decodes in the Worker without detaching a caller-owned subarray", async () => {
    const encoded = encodeStudioRasterInterchange("qoi", bitmap).bytes;
    const owner = new Uint8Array(encoded.byteLength + 4);
    owner.set(encoded, 2);
    const source = owner.subarray(2, 2 + encoded.byteLength);
    const before = [...owner];
    const worker = new FakeWorker();
    const promise = decodeStudioRasterInterchangeAsync(source, "qoi", {
      executionMode: "worker",
      workerFactory: () => worker,
    });
    worker.ready();

    const result = await promise;
    expect(result.execution).toBe("worker");
    expect([...result.decoded.bitmap.data]).toEqual([...bitmap.data]);
    const request = worker.postMessage.mock.calls[0]?.[0];
    expect(request?.type).toBe("studio-raster-interchange/decode");
    if (request?.type !== "studio-raster-interchange/decode") throw new Error("decode request expected");
    expect(request.bytes).not.toBe(source);
    expect(request.bytes.byteOffset).toBe(0);
    expect([...owner]).toEqual(before);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("uses the direct codecs only when direct mode is selected before work", async () => {
    const workerFactory = vi.fn(() => new FakeWorker());
    const encoded = await encodeStudioRasterInterchangeAsync("pam", bitmap, {
      executionMode: "direct",
      workerFactory,
    });
    expect(encoded.execution).toBe("direct");
    expect(encoded.encoded.extension).toBe(".pam");

    const decoded = await decodeStudioRasterInterchangeAsync(
      encoded.encoded.bytes,
      "pam",
      { executionMode: "direct" },
    );
    expect(decoded.execution).toBe("direct");
    expect([...decoded.decoded.bitmap.data]).toEqual([...bitmap.data]);
    expect(workerFactory).not.toHaveBeenCalled();
  });

  it("keeps an unavailable selected Worker terminal for small work", async () => {
    await expect(encodeStudioRasterInterchangeAsync("pam", bitmap, {
      executionMode: "worker",
      workerFactory: null,
    })).rejects.toMatchObject({
      name: "StudioRasterInterchangeWorkerError",
      message: "래스터 Worker를 사용할 수 없습니다.",
    });
  });

  it("fails closed instead of directly encoding over-budget RGBA", async () => {
    const width = 1_025;
    const height = 1_024;
    const large = { width, height, data: new Uint8ClampedArray(width * height * 4) };
    expect(large.data.byteLength).toBeGreaterThan(STUDIO_RASTER_INTERCHANGE_DIRECT_MAX_BYTES);
    expect(width * height).toBeGreaterThan(STUDIO_RASTER_INTERCHANGE_DIRECT_MAX_PIXELS);

    await expect(encodeStudioRasterInterchangeAsync("qoi", large, {
      executionMode: "direct",
    })).rejects.toMatchObject({
      code: "WORKER_REQUIRED",
      message: expect.stringMatching(/Web Worker/u),
    });
  });

  it("fails closed before directly decoding over-budget input or pixel dimensions", async () => {
    await expect(decodeStudioRasterInterchangeAsync(
      new Uint8Array(STUDIO_RASTER_INTERCHANGE_DIRECT_MAX_BYTES + 1),
      undefined,
      { executionMode: "direct" }
    )).rejects.toMatchObject({ code: "WORKER_REQUIRED" });

    await expect(decodeStudioRasterInterchangeAsync(
      oversizedQoiHeader(),
      "qoi",
      { executionMode: "direct" }
    )).rejects.toMatchObject({
      code: "WORKER_REQUIRED",
      message: expect.stringMatching(/1,048,576픽셀/u),
    });
  });

  it("aborts before allocating or posting work", async () => {
    const controller = new AbortController();
    controller.abort();
    const factory = vi.fn(() => new FakeWorker());
    await expect(encodeStudioRasterInterchangeAsync("qoi", bitmap, {
      executionMode: "worker",
      signal: controller.signal,
      workerFactory: factory,
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(factory).not.toHaveBeenCalled();
  });

  it("aborts a pending decode and cleans up the Worker", async () => {
    const controller = new AbortController();
    const worker = new FakeWorker(false);
    const pending = decodeStudioRasterInterchangeAsync(new Uint8Array([1]), undefined, {
      executionMode: "worker",
      signal: controller.signal,
      workerFactory: () => worker,
    });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(worker.onmessage).toBeNull();
    expect(worker.onerror).toBeNull();
    expect(worker.onmessageerror).toBeNull();
  });

  it("fails closed if a selected Worker never becomes ready", async () => {
    vi.useFakeTimers();
    try {
      const worker = new FakeWorker(false);
      const promise = encodeStudioRasterInterchangeAsync("tga", bitmap, {
        executionMode: "worker",
        workerFactory: () => worker,
        readyTimeoutMs: 100,
      });
      const rejection = expect(promise).rejects.toMatchObject({
        name: "TimeoutError",
        message: expect.stringMatching(/준비 시간이 초과/u),
      });
      await vi.advanceTimersByTimeAsync(100);
      await rejection;
      expect(worker.terminate).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets large Worker work continue beyond the legacy ready timeout", async () => {
    vi.useFakeTimers();
    try {
      const width = 1_025;
      const height = 1_024;
      const large = {
        width,
        height,
        data: new Uint8ClampedArray(width * height * 4),
      };
      const worker = new FakeWorker(false);
      const pending = encodeStudioRasterInterchangeAsync("qoi", large, {
        executionMode: "worker",
        workerFactory: () => worker,
        readyTimeoutMs: 100,
        operationTimeoutMs: 5_000,
      });
      worker.ready();
      let settled = false;
      void pending.finally(() => {
        settled = true;
      });

      await vi.advanceTimersByTimeAsync(2_000);

      expect(settled).toBe(false);
      expect(worker.terminate).not.toHaveBeenCalled();
      worker.respond();
      const result = await pending;
      expect(result.execution).toBe("worker");
      expect(result.encoded.extension).toBe(".qoi");
      expect(worker.terminate).toHaveBeenCalledTimes(1);
      expect(worker.onmessage).toBeNull();
      expect(worker.onerror).toBeNull();
      expect(worker.onmessageerror).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds operation timeout independently up to ten minutes", async () => {
    expect(
      STUDIO_RASTER_INTERCHANGE_WORKER_OPERATION_TIMEOUT_DEFAULT_MS,
    ).toBe(120_000);
    expect(
      STUDIO_RASTER_INTERCHANGE_WORKER_OPERATION_TIMEOUT_MAX_MS,
    ).toBe(600_000);

    vi.useFakeTimers();
    try {
      const worker = new FakeWorker(false);
      const pending = decodeStudioRasterInterchangeAsync(
        new Uint8Array([1]),
        undefined,
        {
          executionMode: "worker",
          workerFactory: () => worker,
          operationTimeoutMs:
            STUDIO_RASTER_INTERCHANGE_WORKER_OPERATION_TIMEOUT_MAX_MS
            + 100_000,
        },
      );
      const rejection = expect(pending).rejects.toMatchObject({
        name: "TimeoutError",
        message: expect.stringMatching(/시간이 초과/u),
      });
      worker.ready();

      await vi.advanceTimersByTimeAsync(
        STUDIO_RASTER_INTERCHANGE_WORKER_OPERATION_TIMEOUT_MAX_MS - 1,
      );
      expect(worker.terminate).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);

      await rejection;
      expect(worker.terminate).toHaveBeenCalledTimes(1);
      expect(worker.onmessage).toBeNull();
      expect(worker.onerror).toBeNull();
      expect(worker.onmessageerror).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps runtime failure terminal before and after ready while hiding raw errors", async () => {
    const starting = new FakeWorker(false);
    const startingFailure = encodeStudioRasterInterchangeAsync("qoi", bitmap, {
      executionMode: "worker",
      workerFactory: () => starting,
    });
    starting.runtimeError("raw /private/startup-worker.js");
    await expect(startingFailure).rejects.toMatchObject({
      name: "StudioRasterInterchangeWorkerError",
    });
    expect(starting.terminate).toHaveBeenCalledTimes(1);

    const running = new FakeWorker(false);
    const failed = encodeStudioRasterInterchangeAsync("qoi", bitmap, {
      executionMode: "worker",
      workerFactory: () => running,
    });
    running.ready();
    running.runtimeError("raw /private/codec.wasm panic");
    const error = await failed.catch((reason: unknown) => reason);
    expect(error).toMatchObject({
      name: "StudioRasterInterchangeWorkerError",
    });
    expect(String((error as Error).message)).not.toContain("private");
    expect(String((error as Error).message)).not.toContain("wasm");
    expect(running.terminate).toHaveBeenCalledTimes(1);
    expect(running.onmessageerror).toBeNull();
  });

  it("fails closed if request transfer fails after ready", async () => {
    const worker = new FakeWorker(false, true);
    const pending = encodeStudioRasterInterchangeAsync("qoi", bitmap, {
      executionMode: "worker",
      workerFactory: () => worker,
    });

    worker.ready();

    await expect(pending).rejects.toMatchObject({
      name: "StudioRasterInterchangeWorkerError",
      message: "래스터 Worker 요청을 시작하지 못했습니다.",
    });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(worker.onmessageerror).toBeNull();
  });

  it("hard-terminates on message clone failures without direct fallback", async () => {
    const worker = new FakeWorker(false);
    const pending = encodeStudioRasterInterchangeAsync("qoi", bitmap, {
      executionMode: "worker",
      workerFactory: () => worker,
    });
    worker.ready();

    worker.messageError();

    await expect(pending).rejects.toMatchObject({
      name: "StudioRasterInterchangeWorkerError",
      message: "래스터 Worker 응답을 복제하지 못했습니다.",
    });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(worker.onmessage).toBeNull();
    expect(worker.onerror).toBeNull();
    expect(worker.onmessageerror).toBeNull();
  });

  it("fails fast for wrong request ids, operations and malformed pixels", async () => {
    const wrongIdWorker = new FakeWorker(false);
    const wrongId = encodeStudioRasterInterchangeAsync("qoi", bitmap, {
      executionMode: "worker",
      workerFactory: () => wrongIdWorker,
    });
    wrongIdWorker.ready();
    const encodeRequest = wrongIdWorker.postMessage.mock.calls[0]?.[0];
    if (
      !encodeRequest
      || encodeRequest.type !== "studio-raster-interchange/encode"
    ) {
      throw new Error("encode request expected");
    }
    wrongIdWorker.onmessage?.({
      data: {
        type: "studio-raster-interchange/encode-success",
        version: STUDIO_RASTER_INTERCHANGE_WORKER_VERSION,
        requestId: `${encodeRequest.requestId}-stale`,
        result: encodeStudioRasterInterchange("qoi", bitmap),
      },
    } as MessageEvent<unknown>);
    await expect(wrongId).rejects.toMatchObject({
      name: "StudioRasterInterchangeWorkerError",
      message: "래스터 Worker 응답 프로토콜이 올바르지 않습니다.",
    });
    expect(wrongIdWorker.terminate).toHaveBeenCalledTimes(1);

    const wrongOperationWorker = new FakeWorker(false);
    const wrongOperation = encodeStudioRasterInterchangeAsync("qoi", bitmap, {
      executionMode: "worker",
      workerFactory: () => wrongOperationWorker,
    });
    wrongOperationWorker.ready();
    const wrongOperationRequest =
      wrongOperationWorker.postMessage.mock.calls[0]?.[0];
    if (!wrongOperationRequest) throw new Error("request expected");
    wrongOperationWorker.onmessage?.({
      data: {
        type: "studio-raster-interchange/decode-success",
        version: STUDIO_RASTER_INTERCHANGE_WORKER_VERSION,
        requestId: wrongOperationRequest.requestId,
        result: {
          bitmap,
          format: "qoi",
          warnings: [],
        },
      },
    } as MessageEvent<unknown>);
    await expect(wrongOperation).rejects.toMatchObject({
      name: "StudioRasterInterchangeWorkerError",
    });
    expect(wrongOperationWorker.terminate).toHaveBeenCalledTimes(1);

    const malformedWorker = new FakeWorker(false);
    const malformed = decodeStudioRasterInterchangeAsync(
      encodeStudioRasterInterchange("qoi", bitmap).bytes,
      "qoi",
      { executionMode: "worker", workerFactory: () => malformedWorker },
    );
    malformedWorker.ready();
    const decodeRequest = malformedWorker.postMessage.mock.calls[0]?.[0];
    if (!decodeRequest) throw new Error("request expected");
    malformedWorker.onmessage?.({
      data: {
        type: "studio-raster-interchange/decode-success",
        version: STUDIO_RASTER_INTERCHANGE_WORKER_VERSION,
        requestId: decodeRequest.requestId,
        result: {
          bitmap: {
            width: 2,
            height: 2,
            data: new Uint8Array(4),
          },
          format: "qoi",
          warnings: [],
        },
      },
    } as MessageEvent<unknown>);
    await expect(malformed).rejects.toMatchObject({
      name: "StudioRasterInterchangeWorkerError",
    });
    expect(malformedWorker.terminate).toHaveBeenCalledTimes(1);
  });

  it("rejects Worker ready and operation timeouts without sync work", async () => {
    vi.useFakeTimers();
    try {
      const unavailable = new FakeWorker(false);
      const unavailablePromise = decodeStudioRasterInterchangeAsync(oversizedQoiHeader(), "qoi", {
        executionMode: "worker",
        workerFactory: () => unavailable,
        readyTimeoutMs: 100,
      });
      const unavailableAssertion = expect(unavailablePromise).rejects.toMatchObject({
        name: "TimeoutError",
      });
      await vi.advanceTimersByTimeAsync(100);
      await unavailableAssertion;

      const stalled = new FakeWorker(false);
      const stalledPromise = decodeStudioRasterInterchangeAsync(new Uint8Array([1]), undefined, {
        executionMode: "worker",
        workerFactory: () => stalled,
        readyTimeoutMs: 100,
        operationTimeoutMs: 100,
      });
      stalled.ready();
      const stalledAssertion = expect(stalledPromise).rejects.toMatchObject({
        name: "TimeoutError",
        message: expect.stringMatching(/시간이 초과/u),
      });
      await vi.advanceTimersByTimeAsync(100);
      await stalledAssertion;
      expect(stalled.terminate).toHaveBeenCalledTimes(1);
      expect(stalled.onmessage).toBeNull();
      expect(stalled.onerror).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
